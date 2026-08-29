#!/usr/bin/env node
// JarvisClaw MCP proxy — local stdio MCP server.
//
// It presents itself to Claude / Cursor / any MCP client as a normal stdio MCP server,
// transparently forwards every JSON-RPC message to the remote JarvisClaw MCP endpoint,
// and when the remote replies with an x402 payment challenge, it signs the payment LOCALLY
// (Base EIP-712 or Solana SPL) using the private key in JARVISCLAW_WALLET_KEY and retries.
//
// The private key NEVER leaves this machine. Only the signed payment payload is sent upstream.

import { X402BaseSigner, type X402Body } from "./x402-base.js";
import { X402SolanaSigner } from "./x402-solana.js";

const REMOTE_MCP_URL = process.env.JARVISCLAW_MCP_URL || "https://api.jarvisclaw.ai/mcp";
const WALLET_KEY = process.env.JARVISCLAW_WALLET_KEY || "";
const CHAIN = (process.env.JARVISCLAW_CHAIN || "base").toLowerCase(); // "base" | "solana"
const SOLANA_RPC = process.env.JARVISCLAW_SOLANA_RPC || "";
const API_KEY = process.env.JARVISCLAW_API_KEY || ""; // optional: Bearer fallback

const X402_JSONRPC_CODE = -32002; // payment required (mcp/billing.go)

function log(...args: unknown[]): void {
  // stderr only — stdout is reserved for the MCP JSON-RPC stream.
  process.stderr.write("[jarvisclaw-mcp] " + args.map(String).join(" ") + "\n");
}

// ---- Lazy signer construction (only build what the user configured) -------------------

let baseSigner: X402BaseSigner | null = null;
let solanaSigner: X402SolanaSigner | null = null;

function getBaseSigner(): X402BaseSigner {
  if (!baseSigner) {
    if (!WALLET_KEY) throw new Error("JARVISCLAW_WALLET_KEY not set");
    baseSigner = new X402BaseSigner(WALLET_KEY);
  }
  return baseSigner;
}

function getSolanaSigner(): X402SolanaSigner {
  if (!solanaSigner) {
    if (!WALLET_KEY) throw new Error("JARVISCLAW_WALLET_KEY not set");
    solanaSigner = SOLANA_RPC
      ? new X402SolanaSigner(WALLET_KEY, SOLANA_RPC)
      : new X402SolanaSigner(WALLET_KEY);
  }
  return solanaSigner;
}

/** Produce a base64 PAYMENT-SIGNATURE header value from a 402 body, per configured chain. */
async function signPayment(body: X402Body, resourceUrl: string): Promise<string> {
  if (CHAIN === "solana") {
    return getSolanaSigner().signFrom402(body, resourceUrl);
  }
  return getBaseSigner().signFrom402(body, resourceUrl);
}

// ---- Remote forwarding ----------------------------------------------------------------

interface ForwardResult {
  status: number;
  json: any;
  raw: string;
}

async function postRemote(payload: unknown, paymentSig?: string): Promise<ForwardResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (API_KEY) headers["Authorization"] = "Bearer " + API_KEY;
  if (paymentSig) headers["PAYMENT-SIGNATURE"] = paymentSig;

  const resp = await fetch(REMOTE_MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const raw = await resp.text();
  let json: any = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }
  return { status: resp.status, json, raw };
}

/** Pull an x402 challenge document ({accepts|payments}) out of an arbitrary value. */
function asChallenge(v: any): X402Body | null {
  if (v && (v.accepts || v.payments)) return v as X402Body;
  return null;
}

/**
 * Parse an x402 challenge that the server embedded as free text inside a tool result.
 *
 * Per the MCP spec, tool *execution* failures are reported as a normal result with
 * `isError: true` (JSON-RPC error codes are reserved for protocol-level failures). Our
 * backend follows this: when the paid `chat` tool hits an upstream 402 it returns
 *   result.content[0].text =
 *     "Payment required (x402). ...\n\nPayment details from server:\n{ ...x402 json... }"
 * so we scan the text for the first balanced JSON object and pull the challenge out of it.
 */
function extractChallengeFromText(text: string): X402Body | null {
  if (!text || text.indexOf("x402") === -1) return null;
  // Find the first '{' and take the balanced object starting there.
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          return asChallenge(JSON.parse(slice));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Detect an x402 payment challenge in a forwarded response. The backend can surface it in
 * three shapes:
 *   1. HTTP 402 whose body is the challenge document.
 *   2. JSON-RPC error with code -32002, challenge in error.data.
 *   3. A tool result with isError:true whose text embeds the challenge JSON (MCP-spec form).
 */
function extractChallenge(result: ForwardResult): X402Body | null {
  if (result.status === 402 && result.json) {
    const c = asChallenge(result.json);
    if (c) return c;
  }
  const err = result.json?.error;
  if (err && err.code === X402_JSONRPC_CODE) {
    const c = asChallenge(err.data);
    if (c) return c;
  }
  // MCP-spec tool error: challenge embedded in result.content[].text.
  const toolResult = result.json?.result;
  if (toolResult && toolResult.isError && Array.isArray(toolResult.content)) {
    for (const item of toolResult.content) {
      if (item && item.type === "text" && typeof item.text === "string") {
        const c = extractChallengeFromText(item.text);
        if (c) return c;
      }
    }
  }
  return null;
}

// ---- stdio JSON-RPC pump --------------------------------------------------------------

function writeMessage(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handleMessage(msg: any): Promise<void> {
  // Notifications (no id) are fire-and-forget; forward and ignore any response.
  const isRequest = msg && msg.id !== undefined && msg.id !== null;

  let result: ForwardResult;
  try {
    result = await postRemote(msg);
  } catch (e) {
    log("forward error:", (e as Error).message);
    if (isRequest) {
      writeMessage({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32603, message: "proxy forward failed: " + (e as Error).message },
      });
    }
    return;
  }

  // If challenged, sign locally and retry once.
  const challenge = extractChallenge(result);
  if (challenge && WALLET_KEY) {
    const resourceUrl = REMOTE_MCP_URL;
    try {
      log(`x402 challenge for method=${msg.method} — signing on ${CHAIN}`);
      const sig = await signPayment(challenge, resourceUrl);
      result = await postRemote(msg, sig);
    } catch (e) {
      log("signing failed:", (e as Error).message);
      if (isRequest) {
        writeMessage({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32002, message: "x402 signing failed: " + (e as Error).message },
        });
      }
      return;
    }
  } else if (challenge && !WALLET_KEY) {
    log("payment required but JARVISCLAW_WALLET_KEY not set");
  }

  if (!isRequest) return; // notification: nothing to return

  if (result.json) {
    writeMessage(result.json);
  } else {
    writeMessage({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32603, message: `remote returned status ${result.status}` },
    });
  }
}

function main(): void {
  log(`starting — remote=${REMOTE_MCP_URL} chain=${CHAIN} wallet=${WALLET_KEY ? "set" : "unset"}`);

  let buffer = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        log("skipping non-JSON line");
        continue;
      }
      // Handle sequentially to preserve ordering guarantees expected by MCP clients.
      void handleMessage(msg);
    }
  });

  process.stdin.on("end", () => {
    log("stdin closed — exiting");
    process.exit(0);
  });
}

main();

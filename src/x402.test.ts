// Unit tests for the local x402 signers. Run with: bun test
//
// These tests DO NOT touch the network for signing correctness:
//  - Base (EIP-712) signing is fully offline; we recover the signer address from
//    the produced signature to prove the payload is genuinely signed by the key.
//  - Solana signing needs a recent blockhash from RPC; we stub getBlockhash so the
//    partial-sign path runs deterministically offline, then assert the tx really
//    carries our signature and the expected instruction layout.

import { describe, it, expect } from "bun:test";
import { X402BaseSigner, type X402Body } from "./x402-base.js";
import { X402SolanaSigner } from "./x402-solana.js";

import { recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Keypair, VersionedTransaction, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

// ---- fixtures ---------------------------------------------------------------

// Hardhat/Anvil well-known test account #0 (public, not a real fund holder).
const BASE_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const BASE_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAY_TO = "0x1111111111111111111111111111111111111111";

// Deterministic Solana keypair from a fixed 32-byte seed.
const SOL_SEED = new Uint8Array(32).fill(7);
const SOL_KP = Keypair.fromSeed(SOL_SEED);
const SOL_PK_BS58 = bs58.encode(SOL_SEED); // 32-byte -> fromSeed path
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_PAY_TO = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const FEE_PAYER = "So11111111111111111111111111111111111111112";
// 32 zero-bytes encodes to a valid base58 blockhash string.
const MOCK_BLOCKHASH = bs58.encode(new Uint8Array(32));

function baseBody(overrides: Partial<X402Body["accepts"][number]> = {}): X402Body {
  return {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        amount: "10000", // 0.01 USDC (6 decimals)
        asset: USDC_BASE,
        payTo: PAY_TO,
        maxTimeoutSeconds: 300,
        ...overrides,
      },
    ],
    resource: { url: "https://api.jarvisclaw.ai/mcp", description: "MCP call" },
  };
}

function solBody(overrides: Record<string, unknown> = {}): X402Body {
  return {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        amount: "10000",
        asset: USDC_MINT,
        payTo: SOL_PAY_TO,
        maxTimeoutSeconds: 300,
        extra: { feePayer: FEE_PAYER },
        ...overrides,
      },
    ],
    resource: { url: "https://api.jarvisclaw.ai/mcp", description: "MCP call" },
  };
}

function decodePayload(b64: string): any {
  return JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
}

// ---- Base (EIP-712) ---------------------------------------------------------

describe("X402BaseSigner", () => {
  it("derives the correct address from the private key", () => {
    const s = new X402BaseSigner(BASE_PK);
    expect(s.address.toLowerCase()).toBe(BASE_ADDR.toLowerCase());
  });

  it("accepts a key without 0x prefix", () => {
    const s = new X402BaseSigner(BASE_PK.slice(2));
    expect(s.address.toLowerCase()).toBe(BASE_ADDR.toLowerCase());
  });

  it("produces a v2 payload whose EIP-712 signature recovers to the signer", async () => {
    const s = new X402BaseSigner(BASE_PK);
    const b64 = await s.signFrom402(baseBody(), "https://api.jarvisclaw.ai/mcp");
    const p = decodePayload(b64);

    expect(p.x402Version).toBe(2);
    expect(p.accepted.scheme).toBe("exact");
    expect(p.accepted.network).toBe("eip155:8453");
    expect(p.accepted.amount).toBe("10000");
    expect(p.accepted.asset).toBe(USDC_BASE);
    expect(p.accepted.payTo).toBe(PAY_TO);
    expect(p.payload.authorization.from.toLowerCase()).toBe(BASE_ADDR.toLowerCase());
    expect(p.payload.authorization.to).toBe(PAY_TO);
    expect(p.payload.authorization.value).toBe("10000");
    expect(p.payload.authorization.nonce).toMatch(/^0x[0-9a-f]{64}$/);

    const auth = p.payload.authorization;
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: "USD Coin",
        version: "2",
        chainId: 8453,
        verifyingContract: USDC_BASE as Hex,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: auth.from as Hex,
        to: auth.to as Hex,
        value: BigInt(auth.value),
        validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce: auth.nonce as Hex,
      },
      signature: p.payload.signature as Hex,
    });
    expect(recovered.toLowerCase()).toBe(BASE_ADDR.toLowerCase());
  });

  it("sets validBefore after validAfter within the timeout window", async () => {
    const s = new X402BaseSigner(BASE_PK);
    const p = decodePayload(await s.signFrom402(baseBody(), "https://x"));
    const va = Number(p.payload.authorization.validAfter);
    const vb = Number(p.payload.authorization.validBefore);
    expect(vb).toBeGreaterThan(va);
    expect(vb - va).toBe(600 + 300); // 600s backdate + 300s timeout
  });

  it("emits fresh nonces on each sign", async () => {
    const s = new X402BaseSigner(BASE_PK);
    const a = decodePayload(await s.signFrom402(baseBody(), "https://x"));
    const b = decodePayload(await s.signFrom402(baseBody(), "https://x"));
    expect(a.payload.authorization.nonce).not.toBe(b.payload.authorization.nonce);
  });

  it("rejects an amount over the 100 USDC safety cap", async () => {
    const s = new X402BaseSigner(BASE_PK);
    await expect(
      s.signFrom402(baseBody({ amount: "100000001" }), "https://x")
    ).rejects.toThrow(/safety cap/);
  });

  it("rejects a non-USDC asset", async () => {
    const s = new X402BaseSigner(BASE_PK);
    await expect(
      s.signFrom402(baseBody({ asset: "0xdeadbeef00000000000000000000000000000000" }), "https://x")
    ).rejects.toThrow(/unexpected asset/);
  });

  it("rejects an empty payTo", async () => {
    const s = new X402BaseSigner(BASE_PK);
    await expect(s.signFrom402(baseBody({ payTo: "" }), "https://x")).rejects.toThrow(/payTo/);
  });

  it("rejects a non-positive amount", async () => {
    const s = new X402BaseSigner(BASE_PK);
    await expect(s.signFrom402(baseBody({ amount: "0" }), "https://x")).rejects.toThrow(
      /invalid payment amount/
    );
  });

  it("throws when the 402 body has no EVM option", async () => {
    const s = new X402BaseSigner(BASE_PK);
    const body: X402Body = { x402Version: 2, accepts: [] };
    await expect(s.signFrom402(body, "https://x")).rejects.toThrow(/no EVM payment option/);
  });
});

// ---- Solana (SPL partial sign) ---------------------------------------------

describe("X402SolanaSigner", () => {
  function signerWithStubbedBlockhash(): X402SolanaSigner {
    const s = new X402SolanaSigner(SOL_PK_BS58);
    // Stub the only network call so signing is deterministic and offline.
    (s as any).getBlockhash = async () => MOCK_BLOCKHASH;
    return s;
  }

  it("derives the correct base58 address from a 32-byte seed key", () => {
    const s = new X402SolanaSigner(SOL_PK_BS58);
    expect(s.address).toBe(SOL_KP.publicKey.toBase58());
  });

  it("accepts a 64-byte secret key", () => {
    const full = bs58.encode(SOL_KP.secretKey); // 64 bytes -> fromSecretKey path
    const s = new X402SolanaSigner(full);
    expect(s.address).toBe(SOL_KP.publicKey.toBase58());
  });

  it("rejects a key of invalid length", () => {
    expect(() => new X402SolanaSigner(bs58.encode(new Uint8Array(16)))).toThrow(
      /Invalid Solana key length/
    );
  });

  it("produces a partially-signed tx carrying our signature and correct payload", async () => {
    const s = signerWithStubbedBlockhash();
    const b64 = await s.signFrom402(solBody(), "https://api.jarvisclaw.ai/mcp");
    const p = decodePayload(b64);

    expect(p.x402Version).toBe(2);
    expect(p.accepted.scheme).toBe("exact");
    expect(p.accepted.asset).toBe(USDC_MINT);
    expect(p.accepted.payTo).toBe(SOL_PAY_TO);
    expect(typeof p.payload.transaction).toBe("string");

    // Deserialize the wire tx and confirm our key signed it (fee payer slot still empty).
    const tx = VersionedTransaction.deserialize(Buffer.from(p.payload.transaction, "base64"));
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    // fee payer is account index 0.
    expect(keys[0]).toBe(FEE_PAYER);
    // our signer must be among the account keys and its signature slot filled.
    const ourIdx = keys.indexOf(SOL_KP.publicKey.toBase58());
    expect(ourIdx).toBeGreaterThanOrEqual(0);
    const ourSig = tx.signatures[ourIdx];
    expect(ourSig.some((b) => b !== 0)).toBe(true); // not the all-zero placeholder
    // 4 instructions: CU limit, CU price, transferChecked, memo.
    expect(tx.message.compiledInstructions.length).toBe(4);
  });

  it("throws when the server omits feePayer", async () => {
    const s = signerWithStubbedBlockhash();
    await expect(
      s.signFrom402(solBody({ extra: {} }), "https://x")
    ).rejects.toThrow(/feePayer/);
  });

  it("rejects an amount over the safety cap", async () => {
    const s = signerWithStubbedBlockhash();
    await expect(
      s.signFrom402(solBody({ amount: "100000001" }), "https://x")
    ).rejects.toThrow(/safety cap/);
  });

  it("rejects a non-USDC mint", async () => {
    const s = signerWithStubbedBlockhash();
    await expect(
      s.signFrom402(solBody({ asset: "So11111111111111111111111111111111111111112" }), "https://x")
    ).rejects.toThrow(/unexpected Solana asset/);
  });

  it("throws when the 402 body has no Solana option", async () => {
    const s = signerWithStubbedBlockhash();
    const body: X402Body = {
      x402Version: 2,
      accepts: [{ scheme: "exact", network: "eip155:8453", amount: "1", payTo: PAY_TO }],
    };
    await expect(s.signFrom402(body, "https://x")).rejects.toThrow(/no Solana payment option/);
  });
});

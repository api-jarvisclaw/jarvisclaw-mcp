// x402 EVM (Base) payment signing — EIP-712 / EIP-3009 TransferWithAuthorization, v2 format.
// Ported from sdk/python/jarvisclaw/x402.py to stay byte-for-byte compatible with the facilitator.

import { type Account, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_NAME = "USD Coin";
const USDC_VERSION = "2";
const DEFAULT_NETWORK = "eip155:8453";
const SAFETY_CAP = 100_000_000n; // 100 USDC (6 decimals)

const CHAIN_ID_MAP: Record<string, number> = {
  base: 8453,
  "base-sepolia": 84532,
  "eip155:8453": 8453,
  "eip155:84532": 84532,
};

export interface PaymentOption {
  scheme?: string;
  network?: string;
  amount?: string | number;
  maxAmountRequired?: string | number;
  asset?: string;
  payTo?: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

export interface X402Body {
  x402Version?: number;
  accepts?: PaymentOption[];
  payments?: PaymentOption[];
  resource?: { url?: string; description?: string; mimeType?: string };
}

function randomNonceHex(): Hex {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex as Hex;
}

export class X402BaseSigner {
  private account: Account;
  readonly network: string;

  constructor(privateKey: string, network: string = DEFAULT_NETWORK) {
    const pk = (privateKey.startsWith("0x") ? privateKey : "0x" + privateKey) as Hex;
    this.account = privateKeyToAccount(pk);
    this.network = network;
  }

  get address(): string {
    return this.account.address;
  }

  /** Pick the EVM (eip155:) option from a 402 body and produce the base64 PAYMENT-SIGNATURE payload. */
  async signFrom402(body: X402Body, resourceUrl: string): Promise<string> {
    const payments = body.accepts ?? body.payments ?? [];
    const resource = body.resource ?? {};

    let payment: PaymentOption | undefined;
    for (const p of payments) {
      if ((p.network ?? "").startsWith("eip155:")) {
        payment = p;
        break;
      }
    }
    if (!payment) payment = payments[0];
    if (!payment) throw new Error("x402: no EVM payment option in 402 response");

    const payTo = payment.payTo ?? "";
    const amountStr = String(payment.amount ?? payment.maxAmountRequired ?? "0");
    const network = payment.network ?? this.network;
    const maxTimeout = payment.maxTimeoutSeconds ?? 300;
    const asset = payment.asset ?? USDC_CONTRACT;
    const extra = payment.extra ?? {};
    const description = resource.description ?? "API request";

    const amount = BigInt(amountStr);
    if (!payTo) throw new Error("x402: server returned empty payTo address");
    if (amount <= 0n) throw new Error("x402: invalid payment amount (must be positive)");
    if (amount > SAFETY_CAP)
      throw new Error(`x402: amount ${amountStr} exceeds safety cap (100 USDC)`);
    if (asset.toLowerCase() !== USDC_CONTRACT.toLowerCase())
      throw new Error(`x402: unexpected asset ${asset}, expected USDC`);

    return this.signPayment({
      payTo,
      amount,
      network,
      maxTimeout,
      asset,
      extra,
      resourceUrl,
      description,
    });
  }

  private async signPayment(args: {
    payTo: string;
    amount: bigint;
    network: string;
    maxTimeout: number;
    asset: string;
    extra: Record<string, unknown>;
    resourceUrl: string;
    description: string;
  }): Promise<string> {
    const { payTo, amount, network, maxTimeout, asset, extra, resourceUrl, description } = args;

    const nonce = randomNonceHex();
    const now = Math.floor(Date.now() / 1000);
    const validAfter = now - 600;
    const validBefore = now + maxTimeout;

    let chainId = CHAIN_ID_MAP[network] ?? 8453;
    if (network.includes(":") && !(network in CHAIN_ID_MAP)) {
      chainId = parseInt(network.split(":")[1], 10);
    }

    if (!this.account.signTypedData) {
      throw new Error("x402: account does not support signTypedData");
    }
    const signature = await this.account.signTypedData({
      domain: {
        name: USDC_NAME,
        version: USDC_VERSION,
        chainId,
        verifyingContract: asset as Hex,
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
        from: this.account.address,
        to: payTo as Hex,
        value: amount,
        validAfter: BigInt(validAfter),
        validBefore: BigInt(validBefore),
        nonce,
      },
    });

    // x402 v2 payload (matches BlockRun / Python SDK).
    const payload = {
      x402Version: 2,
      resource: {
        url: resourceUrl,
        description,
        mimeType: "application/json",
      },
      accepted: {
        scheme: "exact",
        network,
        amount: amount.toString(),
        asset,
        payTo,
        maxTimeoutSeconds: maxTimeout,
        extra:
          extra && Object.keys(extra).length > 0
            ? extra
            : { name: USDC_NAME, version: USDC_VERSION },
      },
      payload: {
        signature,
        authorization: {
          from: this.account.address,
          to: payTo,
          value: amount.toString(),
          validAfter: String(validAfter),
          validBefore: String(validBefore),
          nonce,
        },
      },
      extensions: {},
    };

    return Buffer.from(JSON.stringify(payload)).toString("base64");
  }
}

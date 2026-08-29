// x402 Solana payment signing — SPL Token TransferChecked with partial sign, v2 format.
// Ported from sdk/python/jarvisclaw/x402_solana.py to stay compatible with the CDP facilitator.

import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const USDC_DECIMALS = 6;

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

const FALLBACK_RPC = "https://api.mainnet-beta.solana.com";
const SAFETY_CAP = 100_000_000n; // 100 USDC

import type { PaymentOption, X402Body } from "./x402-base.js";

function findAta(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

export class X402SolanaSigner {
  private keypair: Keypair;
  private connection: Connection;

  constructor(privateKeyBs58: string, rpcUrl: string = FALLBACK_RPC) {
    this.keypair = X402SolanaSigner.decodeKey(privateKeyBs58);
    this.connection = new Connection(rpcUrl, "finalized");
  }

  private static decodeKey(key: string): Keypair {
    const decoded = bs58.decode(key);
    if (decoded.length === 64) return Keypair.fromSecretKey(decoded);
    if (decoded.length === 32) return Keypair.fromSeed(decoded);
    throw new Error(`Invalid Solana key length: ${decoded.length} bytes (expected 32 or 64)`);
  }

  get address(): string {
    return this.keypair.publicKey.toBase58();
  }

  /** Pick the Solana option from a 402 body, build a partially-signed tx, return base64 PAYMENT-SIGNATURE. */
  async signFrom402(body: X402Body, resourceUrl: string): Promise<string> {
    const payments = body.accepts ?? body.payments ?? [];
    const resource = body.resource ?? {};

    let payment: PaymentOption | undefined;
    for (const p of payments) {
      if ((p.network ?? "").startsWith("solana:")) {
        payment = p;
        break;
      }
    }
    if (!payment) throw new Error("x402: no Solana payment option in 402 response");

    const payTo = payment.payTo ?? "";
    const amount = BigInt(String(payment.amount ?? "0"));
    if (amount <= 0n) throw new Error("x402: invalid Solana payment amount (must be positive)");
    if (amount > SAFETY_CAP)
      throw new Error(`x402: Solana amount ${amount} exceeds safety cap (100 USDC)`);
    const asset = payment.asset ?? USDC_MINT;
    if (asset !== USDC_MINT)
      throw new Error(`x402: unexpected Solana asset ${asset}, expected USDC`);
    const network = payment.network ?? SOLANA_NETWORK;
    const maxTimeout = payment.maxTimeoutSeconds ?? 300;
    const extra = (payment.extra ?? {}) as Record<string, unknown>;
    const description = resource.description ?? "API request";

    const feePayerStr = String(extra.feePayer ?? "");
    if (!feePayerStr) throw new Error("x402: server did not provide feePayer for Solana");
    if (!payTo) throw new Error("x402: server returned empty payTo for Solana");

    const txBase64 = await this.buildPartialTx({
      amount,
      mint: asset,
      recipient: payTo,
      feePayer: feePayerStr,
    });

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
        extra,
      },
      payload: {
        transaction: txBase64,
      },
      extensions: {},
    };

    return Buffer.from(JSON.stringify(payload)).toString("base64");
  }

  private async getBlockhash(): Promise<string> {
    const { blockhash } = await this.connection.getLatestBlockhash("finalized");
    return blockhash;
  }

  private async buildPartialTx(args: {
    amount: bigint;
    mint: string;
    recipient: string;
    feePayer: string;
  }): Promise<string> {
    const { amount, mint, recipient, feePayer } = args;

    const feePayerPk = new PublicKey(feePayer);
    const mintPk = new PublicKey(mint);
    const recipientPk = new PublicKey(recipient);
    const payerPk = this.keypair.publicKey;

    const sourceAta = findAta(payerPk, mintPk);
    const destAta = findAta(recipientPk, mintPk);

    // Instruction 0: SetComputeUnitLimit (200000)
    const ixCuLimit = ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });
    // Instruction 1: SetComputeUnitPrice (10000 microlamports)
    const ixCuPrice = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 });

    // Instruction 2: TransferChecked
    // Data: [12 (discriminator)] + [amount u64 LE] + [decimals u8]
    const transferData = Buffer.alloc(1 + 8 + 1);
    transferData.writeUInt8(12, 0);
    transferData.writeBigUInt64LE(amount, 1);
    transferData.writeUInt8(USDC_DECIMALS, 9);
    const ixTransfer = new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: sourceAta, isSigner: false, isWritable: true },
        { pubkey: mintPk, isSigner: false, isWritable: false },
        { pubkey: destAta, isSigner: false, isWritable: true },
        { pubkey: payerPk, isSigner: true, isWritable: false },
      ],
      data: transferData,
    });

    // Instruction 3: Memo (random 16-byte nonce as hex string — required by facilitator for uniqueness)
    const nonceBytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(nonceBytes);
    let memoHex = "";
    for (const b of nonceBytes) memoHex += b.toString(16).padStart(2, "0");
    const ixMemo = new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(memoHex, "utf-8"),
    });

    const instructions = [ixCuLimit, ixCuPrice, ixTransfer, ixMemo];

    const blockhash = await this.getBlockhash();

    // Build MessageV0 with fee_payer as payerKey (index 0). Server co-signs at verify time.
    const message = new TransactionMessage({
      payerKey: feePayerPk,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    // Partially sign: only our keypair signs; the fee_payer (server) signs later.
    const tx = new VersionedTransaction(message);
    tx.sign([this.keypair]);

    return Buffer.from(tx.serialize()).toString("base64");
  }
}

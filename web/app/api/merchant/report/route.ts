// An x402-style paid endpoint. It follows the HTTP 402 pattern (quote, pay,
// retry with proof) but is not a spec-compliant x402 facilitator.
import { NextRequest, NextResponse } from "next/server";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { DECIMALS, PRICE_BASE_UNITS, config, connection } from "@/lib/config";

export const dynamic = "force-dynamic";

const MAX_AGE_SECONDS = 600;

// Demo limitation: replay protection lives in memory, so it resets on cold
// start and is not shared between serverless instances.
const usedSignatures = new Set<string>();

function requirements() {
  const c = config();
  return {
    amount: PRICE_BASE_UNITS.toString(),
    decimals: DECIMALS,
    mint: c.mint.toBase58(),
    recipient: c.merchantA.toBase58(),
    program: c.programId.toBase58(),
    mandate: c.mandate.toBase58(),
    reference: `report-${Date.now().toString(36)}`,
    description: "GPU price report, this week",
  };
}

async function verify(signature: string): Promise<string | null> {
  const c = config();
  if (usedSignatures.has(signature)) return "payment signature already used";

  const tx = await connection().getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx || !tx.meta) return "transaction not found or not confirmed";
  if (tx.meta.err) return "transaction failed on-chain";
  if (!tx.blockTime || Date.now() / 1000 - tx.blockTime > MAX_AGE_SECONDS) return "payment is too old";

  const keys = tx.transaction.message.getAccountKeys().staticAccountKeys;
  const invoked = tx.transaction.message.compiledInstructions.some(
    (ix) => keys[ix.programIdIndex].equals(c.programId) && ix.accountKeyIndexes.some((i) => c.acceptedMandates.some((m) => keys[i].equals(m))),
  );
  if (!invoked) return "payment did not go through the Chainwrit mandate";

  const merchantAta = getAssociatedTokenAddressSync(c.mint, c.merchantA, true);
  const idx = keys.findIndex((k) => k.equals(merchantAta));
  if (idx < 0) return "payment did not go to the merchant";
  const balance = (list: typeof tx.meta.postTokenBalances) =>
    BigInt(list?.find((b) => b.accountIndex === idx)?.uiTokenAmount.amount ?? "0");
  const received = balance(tx.meta.postTokenBalances) - balance(tx.meta.preTokenBalances);
  if (received < PRICE_BASE_UNITS) return "payment amount is below the price";

  usedSignatures.add(signature);
  return null;
}

export async function GET(req: NextRequest) {
  const signature = req.headers.get("x-payment");
  if (!signature) return NextResponse.json(requirements(), { status: 402 });

  const problem = await verify(signature);
  if (problem) return NextResponse.json({ error: problem, ...requirements() }, { status: 402 });

  return NextResponse.json({
    report: "GPU spot prices, week 41",
    paidWith: signature,
    prices: [
      { gpu: "H100 80GB", usdPerHour: 2.19, change: "-4%" },
      { gpu: "A100 80GB", usdPerHour: 1.29, change: "-2%" },
      { gpu: "L40S", usdPerHour: 0.86, change: "+1%" },
      { gpu: "RTX 4090", usdPerHour: 0.39, change: "0%" },
    ],
    note: "Sample data for the Chainwrit demo.",
  });
}

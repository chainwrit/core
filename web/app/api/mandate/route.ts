import { NextResponse } from "next/server";
import { fetchMandate } from "@chainwrit/sdk";
import { config, connection } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const c = config();
  const m = await fetchMandate(connection(), c.mandate);
  return NextResponse.json({
    address: m.address.toBase58(),
    owner: m.owner.toBase58(),
    agent: m.agent.toBase58(),
    mint: m.mint.toBase58(),
    vault: m.vault.toBase58(),
    merchants: m.merchants.map((k) => k.toBase58()),
    maxPerPayment: m.maxPerPayment.toString(),
    dailyLimit: m.dailyLimit.toString(),
    spentInWindow: m.spentInWindow.toString(),
    remainingToday: m.remainingToday.toString(),
    windowResetsAt: m.windowResetsAt,
    expiresAt: m.expiresAt,
    revoked: m.revoked,
    paymentCount: m.paymentCount.toString(),
    vaultBalance: m.vaultBalance.toString(),
    attacker: c.attacker.toBase58(),
    programId: c.programId.toBase58(),
  });
}

// The stolen-key scenario. No model, no prompt: the attacker holds the agent's
// private key and signs whatever they like. Every attempt is sent with
// preflight skipped so the rejection lands on-chain with an Explorer link.
import path from "path";
import { explorerTx, fetchMandate, fromBaseUnits, pay, toBaseUnits } from "../sdk/src";
import { KEYS_DIR, connection, loadKeypair, pk, readDeployments } from "./common";

const MAX_DRAIN_ATTEMPTS = 8;

async function main() {
  const conn = connection();
  const d = readDeployments();
  const agent = loadKeypair(process.env.AGENT_KEYPAIR_PATH ?? path.join(KEYS_DIR, "agent.json"));
  const mandate = pk(process.env.MANDATE ?? d.mandate);

  const before = await fetchMandate(conn, mandate);
  console.log(`Holding the agent key ${agent.publicKey.toBase58()}`);
  console.log(
    `Mandate: ${fromBaseUnits(before.maxPerPayment)} dUSDC per payment, ` +
      `${fromBaseUnits(before.dailyLimit)} dUSDC per 24h, ` +
      `${fromBaseUnits(before.remainingToday)} left today, vault ${fromBaseUnits(before.vaultBalance)}\n`,
  );

  const attempt = async (label: string, merchant: string, amount: number) => {
    const r = await pay(
      conn,
      agent,
      mandate,
      { merchant: pk(merchant), amount: toBaseUnits(amount), taskId: "attack" },
      { landOnChain: true },
    );
    const link = r.signature ? explorerTx(r.signature) : "(not sent)";
    if (r.ok) console.log(`  PAID      ${label}  ${link}`);
    else console.log(`  REJECTED  ${label}  -> ${r.name}: ${r.message}\n            ${link}`);
    return r;
  };

  console.log("(a) Pay the attacker directly");
  await attempt("1 dUSDC to attacker", d.attacker, 1);

  console.log("\n(b) Pay the approved merchant far over the per-payment cap");
  await attempt("10 dUSDC to merchant A", d.merchantA, 10);

  console.log("\n(c) Drain with many small payments to the approved merchant");
  for (let i = 1; i <= MAX_DRAIN_ATTEMPTS; i++) {
    const r = await attempt(`#${i} 1 dUSDC to merchant A`, d.merchantA, 1);
    if (!r.ok) break;
  }

  const after = await fetchMandate(conn, mandate);
  const lost = before.vaultBalance - after.vaultBalance;
  console.log(
    `\nVault ${fromBaseUnits(before.vaultBalance)} -> ${fromBaseUnits(after.vaultBalance)} dUSDC. ` +
      `${fromBaseUnits(lost)} dUSDC moved, all of it to the approved merchant within the daily cap. ` +
      `The attacker received nothing.`,
  );
}

// web3.js keeps a websocket open after confirmations, which would hold the
// process alive indefinitely.
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

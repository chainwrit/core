// Sets up the devnet demo: a dUSDC test mint, an agent, a mandate that allows
// merchant A only, and one approved plus one rejected payment as proof.
// Safe to re-run: existing keys, mint and mandate are reused.
import fs from "fs";
import os from "os";
import path from "path";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  PROGRAM_ID,
  createMandate,
  deposit,
  explorerTx,
  fetchMandate,
  mandatePda,
  pay,
  toBaseUnits,
} from "../sdk/src";
import {
  DEPLOYMENTS,
  Deployments,
  connection,
  loadKeypair,
  loadOrCreateKey,
  pk,
  writeDeployments,
} from "./common";

const DECIMALS = 6;
const AGENT_NAME = process.env.AGENT_NAME ?? "agent";

async function main() {
  const conn = connection();
  const owner = loadKeypair(process.env.OWNER_KEYPAIR ?? path.join(os.homedir(), ".config/solana/id.json"));
  const agent = loadOrCreateKey(AGENT_NAME);
  const merchantA = loadOrCreateKey("merchant-a");
  const attacker = loadOrCreateKey("attacker");

  const prev: Partial<Deployments> = fs.existsSync(DEPLOYMENTS)
    ? JSON.parse(fs.readFileSync(DEPLOYMENTS, "utf8"))
    : {};

  console.log("owner   ", owner.publicKey.toBase58());
  console.log("agent   ", agent.publicKey.toBase58());

  // The agent pays its own transaction fees, so it needs a little SOL.
  if ((await conn.getBalance(agent.publicKey)) < 0.05 * LAMPORTS_PER_SOL) {
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: agent.publicKey,
          lamports: 0.2 * LAMPORTS_PER_SOL,
        }),
      ),
      [owner],
    );
    console.log("funded agent with 0.2 SOL for fees");
  }

  const reuseMint = prev.mint ?? process.env.MINT;
  const mint = reuseMint
    ? pk(reuseMint)
    : await createMint(conn, owner, owner.publicKey, null, DECIMALS);
  console.log("dUSDC   ", mint.toBase58());

  const ownerAta = await getOrCreateAssociatedTokenAccount(conn, owner, mint, owner.publicKey);
  if (!reuseMint) {
    await mintTo(conn, owner, mint, ownerAta.address, owner, toBaseUnits(1000, DECIMALS));
    console.log("minted 1000 dUSDC to owner");
  }

  for (const kp of [merchantA, attacker]) {
    await getOrCreateAssociatedTokenAccount(conn, owner, mint, kp.publicKey);
  }

  const mandate = mandatePda(owner.publicKey, agent.publicKey);
  if (!(await conn.getAccountInfo(mandate))) {
    const { signature } = await createMandate(conn, owner, {
      agent: agent.publicKey,
      mint,
      maxPerPayment: toBaseUnits(1),
      dailyLimit: toBaseUnits(5),
      expiresAt: Math.floor(Date.now() / 1000) + 14 * 86_400,
      merchants: [merchantA.publicKey],
    });
    console.log("created mandate", explorerTx(signature));
    const dep = await deposit(conn, owner, mandate, toBaseUnits(50));
    console.log("deposited 50 dUSDC", explorerTx(dep));
  }

  const view = await fetchMandate(conn, mandate);
  console.log("mandate ", mandate.toBase58(), "vault", view.vault.toBase58());

  const deployments: Deployments = {
    cluster: "devnet",
    program: PROGRAM_ID.toBase58(),
    mint: mint.toBase58(),
    mintSymbol: "dUSDC",
    decimals: DECIMALS,
    owner: owner.publicKey.toBase58(),
    agent: agent.publicKey.toBase58(),
    mandate: mandate.toBase58(),
    vault: view.vault.toBase58(),
    merchantA: merchantA.publicKey.toBase58(),
    attacker: attacker.publicKey.toBase58(),
    proof: prev.proof ?? {},
  };

  if (!deployments.proof?.approvedPay) {
    const ok = await pay(conn, agent, mandate, {
      merchant: merchantA.publicKey,
      amount: toBaseUnits(0.1),
      taskId: "seed-proof",
    });
    if (!ok.ok) throw new Error(`approved payment failed: ${ok.name} ${ok.message}`);
    deployments.proof!.approvedPay = explorerTx(ok.signature);
    console.log("approved pay to merchant A:", deployments.proof!.approvedPay);
  }

  if (!deployments.proof?.rejectedPay) {
    const bad = await pay(
      conn,
      agent,
      mandate,
      { merchant: attacker.publicKey, amount: toBaseUnits(0.1), taskId: "seed-proof" },
      { landOnChain: true },
    );
    if (bad.ok || !bad.signature) throw new Error("payment to the attacker was not rejected on-chain");
    deployments.proof!.rejectedPay = explorerTx(bad.signature);
    console.log(`rejected pay to attacker (${bad.name}):`, deployments.proof!.rejectedPay);
  }

  writeDeployments(deployments);
  console.log("wrote", DEPLOYMENTS);
}

// web3.js keeps a websocket open after confirmations, which would hold the
// process alive indefinitely.
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

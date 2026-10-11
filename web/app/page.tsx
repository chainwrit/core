import Link from "next/link";
import { GITHUB_URL, deployments, explorer } from "@/lib/deployments";

const PROBLEMS = [
  {
    title: "The key is the money",
    body: "An agent that pays for things needs a private key. Whoever controls the key controls the funds.",
  },
  {
    title: "Agents can be manipulated",
    body: "Hidden text in a web page looks exactly like an instruction from the user. Models follow it.",
  },
  {
    title: "Payments are final",
    body: "On-chain transfers settle in seconds. There is no chargeback and no one to call.",
  },
];

const RULES = [
  ["Merchant allowlist", "Only addresses the human named can be paid", "Paying an attacker"],
  ["Per-payment cap", "e.g. at most 1 dUSDC per call", "One large theft"],
  ["Rolling 24h cap", "e.g. at most 5 dUSDC per day", "A slow drain of small payments"],
  ["Expiry", "The mandate stops paying after a date", "Forgotten permissions"],
  ["Instant revoke", "The owner can stop it at any time", "An attack in progress"],
];

const THREATS = [
  ["Prompt injection", "The agent's decisions", "Allowlist and caps"],
  ["Compromised server", "The agent's code and config", "Allowlist and caps"],
  ["Stolen agent key", "Valid signatures for pay", "Allowlist and caps"],
  ["Rogue agent operator", "Everything off-chain", "Owner can revoke and withdraw"],
];

const STACK = ["Solana", "Anchor", "SPL Token", "MCP", "x402-style 402 flow"];

function Section({ id, eyebrow, title, children }: { id?: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="border-t border-line py-16 sm:py-20">
      <p className="mb-3 font-mono text-xs uppercase tracking-widest text-accent">{eyebrow}</p>
      <h2 className="mb-8 max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      {children}
    </section>
  );
}

function FlowNode({ label, sub, tone = "default" }: { label: string; sub: string; tone?: "default" | "accent" | "ok" }) {
  const border = tone === "accent" ? "border-accent/60" : tone === "ok" ? "border-ok/50" : "border-line";
  return (
    <div className={`rounded-lg border ${border} bg-panel px-4 py-3`}>
      <div className="text-sm font-medium">{label}</div>
      <div className="mt-1 text-xs text-muted">{sub}</div>
    </div>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-1 pl-4 font-mono text-[11px] text-muted md:flex-col md:justify-center md:pl-0 md:text-center">
      <span className="md:hidden">↓</span>
      <span>{label}</span>
      <span className="hidden md:inline">→</span>
    </div>
  );
}

export default function Home() {
  const d = deployments();
  const proof = d.proof ?? {};

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6">
      <header className="flex items-center justify-between py-6">
        <img src="/logo-lockup.svg" alt="Chainwrit" className="h-7 w-auto" />
        <nav className="flex gap-5 text-sm text-muted">
          <Link href="/demo" className="hover:text-fg">Demo</Link>
          <a href={GITHUB_URL} className="hover:text-fg">GitHub</a>
        </nav>
      </header>

      <section className="py-16 sm:py-24">
        <p className="mb-4 font-mono text-xs uppercase tracking-widest text-accent">Solana program · devnet</p>
        <h1 className="max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
          Spending limits for AI agents, enforced by Solana.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted">
          A human signs a mandate: who the agent may pay, how much per payment, how much per day, until when. Funds sit in
          a vault with no private key. The agent can only ask; the program decides.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/demo" className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-black hover:opacity-90">
            Try the live demo
          </Link>
          <a href={GITHUB_URL} className="rounded-md border border-line px-5 py-2.5 text-sm font-medium hover:border-muted">
            View on GitHub
          </a>
        </div>
      </section>

      <Section eyebrow="The problem" title="One poisoned web page can drain an agent's wallet.">
        <div className="grid gap-4 md:grid-cols-3">
          {PROBLEMS.map((p) => (
            <div key={p.title} className="rounded-lg border border-line bg-panel p-5">
              <h3 className="mb-2 font-medium">{p.title}</h3>
              <p className="text-sm leading-relaxed text-muted">{p.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 max-w-2xl text-sm text-muted">
          A rule in the prompt is what injection attacks. A check on your server is skipped by whoever compromises it. The
          rule has to live somewhere the agent cannot reach.
        </p>
      </Section>

      <Section id="how" eyebrow="How it works" title="The agent requests. The program decides.">
        <div className="grid items-stretch gap-2 md:grid-cols-[1fr_auto_1.3fr_auto_1fr]">
          <FlowNode label="Human" sub="signs a mandate and deposits funds" />
          <Arrow label="create_mandate" />
          <div className="rounded-lg border border-accent/60 bg-panel p-4">
            <div className="text-sm font-medium">Chainwrit program</div>
            <div className="mt-1 text-xs text-muted">mandate PDA + vault PDA (no private key)</div>
            <ul className="mt-3 space-y-1 font-mono text-[11px] text-muted">
              <li>✓ not revoked</li>
              <li>✓ not expired</li>
              <li>✓ amount ≤ per-payment cap</li>
              <li>✓ merchant on allowlist</li>
              <li>✓ 24h spend ≤ daily cap</li>
            </ul>
          </div>
          <Arrow label="transfer" />
          <FlowNode label="Merchant" sub="paid only if every check passes" tone="ok" />
        </div>
        <div className="mt-2 grid md:grid-cols-[1fr_auto_1.3fr_auto_1fr]">
          <div className="md:col-start-3">
            <Arrow label="pay(amount, merchant) ↑" />
            <FlowNode label="AI agent" sub="holds a key that can only request payments" />
          </div>
        </div>

        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-4 font-medium">Rule</th>
                <th className="py-2 pr-4 font-medium">What it means</th>
                <th className="py-2 font-medium">What it stops</th>
              </tr>
            </thead>
            <tbody>
              {RULES.map(([rule, means, stops]) => (
                <tr key={rule} className="border-b border-line/60">
                  <td className="py-2.5 pr-4 font-medium">{rule}</td>
                  <td className="py-2.5 pr-4 text-muted">{means}</td>
                  <td className="py-2.5 text-muted">{stops}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <section className="border-t border-line py-20 sm:py-28">
        <blockquote className="max-w-3xl text-2xl font-medium leading-snug tracking-tight sm:text-4xl">
          “Even if the agent is manipulated, its server compromised and its signing key stolen, funds cannot move outside
          the mandate.”
        </blockquote>
        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-4 font-medium">Attacker has</th>
                <th className="py-2 pr-4 font-medium">So they control</th>
                <th className="py-2 font-medium">What still holds</th>
              </tr>
            </thead>
            <tbody>
              {THREATS.map(([a, b, c]) => (
                <tr key={a} className="border-b border-line/60">
                  <td className="py-2.5 pr-4 font-medium">{a}</td>
                  <td className="py-2.5 pr-4 text-muted">{b}</td>
                  <td className="py-2.5 text-ok">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Section eyebrow="Live on devnet" title="Don't take our word for it. Check the chain.">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          {d.program && (
            <div className="rounded-lg border border-line bg-panel p-4">
              <dt className="mb-1 text-xs uppercase tracking-wider text-muted">Program</dt>
              <dd><a className="addr text-accent hover:underline" href={explorer("address", d.program)}>{d.program}</a></dd>
            </div>
          )}
          {d.mandate && (
            <div className="rounded-lg border border-line bg-panel p-4">
              <dt className="mb-1 text-xs uppercase tracking-wider text-muted">Demo mandate</dt>
              <dd><a className="addr text-accent hover:underline" href={explorer("address", d.mandate)}>{d.mandate}</a></dd>
            </div>
          )}
          {proof.approvedPay && (
            <div className="rounded-lg border border-ok/40 bg-panel p-4">
              <dt className="mb-1 text-xs uppercase tracking-wider text-ok">Approved: pay merchant A</dt>
              <dd><a className="text-accent hover:underline" href={proof.approvedPay}>View transaction ↗</a></dd>
            </div>
          )}
          {proof.rejectedPay && (
            <div className="rounded-lg border border-bad/40 bg-panel p-4">
              <dt className="mb-1 text-xs uppercase tracking-wider text-bad">Rejected: pay the attacker</dt>
              <dd><a className="text-accent hover:underline" href={proof.rejectedPay}>View failed transaction ↗</a></dd>
            </div>
          )}
        </dl>
        <p className="mt-4 text-xs text-muted">
          The demo uses dUSDC, our own devnet test token. It has no value.
        </p>
      </Section>

      <Section eyebrow="Built with" title="Boring, proven parts.">
        <ul className="flex flex-wrap gap-2">
          {STACK.map((s) => (
            <li key={s} className="rounded-md border border-line px-3 py-1.5 font-mono text-xs text-muted">{s}</li>
          ))}
        </ul>
      </Section>

      <footer className="flex flex-col gap-2 border-t border-line py-8 text-xs text-muted sm:flex-row sm:justify-between">
        <span>Chainwrit · Apache-2.0</span>
        <a href={GITHUB_URL} className="hover:text-fg">github.com/chainwrit/core</a>
      </footer>
    </main>
  );
}

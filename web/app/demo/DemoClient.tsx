"use client";

import { useCallback, useEffect, useState } from "react";

type Mandate = {
  address: string;
  merchants: string[];
  maxPerPayment: string;
  dailyLimit: string;
  spentInWindow: string;
  remainingToday: string;
  windowResetsAt: number;
  expiresAt: number;
  revoked: boolean;
  paymentCount: string;
  vaultBalance: string;
  attacker: string;
  programId: string;
};

type Step = {
  id: string;
  status: "running" | "ok" | "rejected" | "info" | "error";
  title: string;
  detail?: string;
  link?: string;
};

const usd = (base: string) => `${(Number(base) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} dUSDC`;
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const explorer = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;

const STATUS_STYLE: Record<Step["status"], { dot: string; label: string }> = {
  running: { dot: "bg-accent animate-pulse", label: "text-fg" },
  ok: { dot: "bg-ok", label: "text-fg" },
  rejected: { dot: "bg-bad", label: "text-bad" },
  info: { dot: "bg-muted", label: "text-fg" },
  error: { dot: "bg-bad", label: "text-bad" },
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-lg font-medium">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export default function DemoClient() {
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/mandate", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMandate(await res.json());
      setLoadError(null);
    } catch (e: any) {
      setLoadError(`Could not load the mandate from devnet (${e.message}). The public RPC may be rate-limiting; try again shortly.`);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runAgent() {
    setRunning(true);
    setSteps([]);
    setRunError(null);
    try {
      const res = await fetch("/api/agent/run", { method: "POST" });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const step: Step = JSON.parse(line);
          setSteps((prev) => {
            const i = prev.findIndex((s) => s.id === step.id);
            if (i < 0) return [...prev, step];
            const next = [...prev];
            next[i] = step;
            return next;
          });
        }
      }
    } catch (e: any) {
      setRunError(e.message);
    } finally {
      setRunning(false);
      load();
    }
  }

  const now = Date.now() / 1000;
  const resetHours = mandate ? Math.max(0, Math.ceil((mandate.windowResetsAt - now) / 3600)) : 0;
  const capReached = mandate && BigInt(mandate.remainingToday) < 250_000n;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted">Mandate, live from devnet</h2>
          <button onClick={load} className="text-xs text-muted hover:text-fg">Refresh</button>
        </div>
        {loadError && <p className="rounded-lg border border-bad/40 p-4 text-sm text-bad">{loadError}</p>}
        {!mandate && !loadError && <p className="text-sm text-muted">Loading…</p>}
        {mandate && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Per payment" value={usd(mandate.maxPerPayment)} />
              <Stat label="24h cap" value={usd(mandate.dailyLimit)} />
              <Stat
                label="Spent (24h)"
                value={usd(mandate.spentInWindow)}
                sub={BigInt(mandate.spentInWindow) > 0n ? `resets in ~${resetHours}h` : undefined}
              />
              <Stat label="Remaining today" value={usd(mandate.remainingToday)} />
              <Stat label="Vault" value={usd(mandate.vaultBalance)} />
              <Stat
                label="Status"
                value={mandate.revoked ? "Revoked" : now > mandate.expiresAt ? "Expired" : "Active"}
                sub={`expires ${new Date(mandate.expiresAt * 1000).toLocaleDateString()}`}
              />
            </div>
            <div className="rounded-lg border border-line bg-panel p-4 text-sm">
              <div className="mb-2 text-xs uppercase tracking-wider text-muted">Allowlist</div>
              {mandate.merchants.map((m) => (
                <a key={m} href={explorer(m)} className="addr block text-xs text-ok hover:underline">
                  ✓ {m} (merchant A)
                </a>
              ))}
              <div className="mt-3 text-xs uppercase tracking-wider text-muted">Not on it</div>
              <a href={explorer(mandate.attacker)} className="addr block text-xs text-bad hover:underline">
                ✗ {mandate.attacker} (attacker)
              </a>
            </div>
            <p className="text-xs text-muted">
              Mandate <a className="addr hover:text-fg" href={explorer(mandate.address)}>{short(mandate.address)}</a> ·
              program <a className="addr hover:text-fg" href={explorer(mandate.programId)}>{short(mandate.programId)}</a> ·
              token is dUSDC, our devnet test mint
            </p>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted">Scripted agent</h2>
          <button
            onClick={runAgent}
            disabled={running}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-black hover:opacity-90 disabled:opacity-50"
          >
            {running ? "Running…" : "Run agent"}
          </button>
        </div>
        <p className="mb-4 text-sm text-muted">
          The agent buys a report from merchant A through an x402-style 402 flow, then reads{" "}
          <a href="/poisoned" className="text-accent hover:underline">a web page</a> with a hidden instruction to pay an
          attacker, and obeys it. No model is involved: this is the worst case, an agent that does whatever it is told.
        </p>
        {capReached && (
          <p className="mb-4 rounded-lg border border-line p-3 text-xs text-muted">
            The daily cap is used up, so the purchase step will be skipped until it resets in ~{resetHours}h. That is the
            cap working: it also bounds what this public demo can spend.
          </p>
        )}
        {runError && <p className="mb-4 rounded-lg border border-bad/40 p-3 text-sm text-bad">{runError}</p>}
        <ol className="space-y-3">
          {steps.map((s) => (
            <li key={s.id} className="rounded-lg border border-line bg-panel p-4">
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS_STYLE[s.status].dot}`} />
                <div className="min-w-0">
                  <div className={`text-sm font-medium ${STATUS_STYLE[s.status].label}`}>{s.title}</div>
                  {s.detail && <div className="mt-1 break-words text-xs text-muted">{s.detail}</div>}
                  {s.link && (
                    <a href={s.link} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-accent hover:underline">
                      View on Explorer ↗
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
          {!steps.length && !running && (
            <li className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">
              Press “Run agent” to watch it try.
            </li>
          )}
        </ol>
      </section>
    </div>
  );
}

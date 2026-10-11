import Link from "next/link";
import DemoClient from "./DemoClient";

export const metadata = { title: "Live demo · Chainwrit" };

export default function DemoPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6">
      <header className="flex items-center justify-between py-6">
        <Link href="/"><img src="/logo-lockup.svg" alt="Chainwrit" className="h-7 w-auto" /></Link>
        <span className="font-mono text-xs text-muted">devnet</span>
      </header>
      <div className="pb-8 pt-4">
        <h1 className="text-3xl font-semibold tracking-tight">Live demo</h1>
        <p className="mt-2 max-w-2xl text-muted">
          A real mandate on Solana devnet, and an agent that has been told to pay someone it shouldn't.
        </p>
      </div>
      <DemoClient />
      <footer className="mt-16 border-t border-line py-8 text-xs text-muted">
        Runs are rate-limited per visitor. Spend is bounded by the mandate's own 24-hour cap.
      </footer>
    </main>
  );
}

import Link from "next/link";

export function AppFooter() {
  return (
    <footer className="border-line mt-24 border-t">
      <div className="container-page grid gap-8 py-10 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="display text-2xl">Saksi</p>
          <p className="text-muted mt-3 max-w-sm text-sm leading-relaxed">
            A sealed prediction journal. Commit before the event, reveal after it, and let Walrus
            Memory decide who deserves to be trusted next time.
          </p>
        </div>
        <div className="text-sm">
          <p className="mono text-muted mb-3 text-[10px] tracking-[0.18em] uppercase">Product</p>
          <ul className="text-muted space-y-2">
            <li>
              <Link href="/picks" className="link-underline">
                Picks
              </Link>
            </li>
            <li>
              <Link href="/analysts" className="link-underline">
                Credibility
              </Link>
            </li>
            <li>
              <Link href="/memory" className="link-underline">
                Memory ledger
              </Link>
            </li>
          </ul>
        </div>
        <div className="text-sm">
          <p className="mono text-muted mb-3 text-[10px] tracking-[0.18em] uppercase">
            Infrastructure
          </p>
          <ul className="text-muted space-y-2">
            <li>Walrus Memory</li>
            <li>Tatum Sui RPC</li>
            <li>x402 on Sui</li>
          </ul>
        </div>
      </div>
      <div className="border-line border-t py-5">
        <div className="container-page text-muted flex flex-col justify-between gap-2 text-xs sm:flex-row">
          <span>© {new Date().getFullYear()} Saksi. Every claim has a hash.</span>
          <span className="mono">Total Recall · Tatum × Walrus Memory</span>
        </div>
      </div>
    </footer>
  );
}

import Link from "next/link";

import { APP_NAME } from "@/lib/config";

const LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/journals", label: "Memory" },
  { href: "/docs", label: "Docs" },
  { href: "/#integrations", label: "Integrations" },
];

/**
 * Marketing navigation. Deliberately independent of the product nav: it has no session
 * lookup, no wallet button and no database read, so the landing page stays static and
 * renders identically for a reviewer with no wallet installed.
 */
export function MarketingNav() {
  return (
    <header className="border-line bg-base/80 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="container-page flex h-16 items-center justify-between gap-6">
        <Link href="/" className="group flex items-center gap-3">
          <span className="border-amber/40 bg-amber/10 relative grid size-9 place-items-center rounded-full border">
            <span className="display text-amber text-lg leading-none">S</span>
            <span className="border-amber/20 absolute inset-1 rounded-full border" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="display text-xl tracking-tight">{APP_NAME}</span>
            <span className="mono text-muted mt-1 text-[9px] tracking-[0.22em] uppercase">
              proof of forecast
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-muted hover:text-paper rounded-full px-3 py-2 text-sm transition-colors hover:bg-white/5"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            aria-label="Launch the Saksi app"
            className="btn btn-primary h-9 px-4 text-xs whitespace-nowrap"
            data-testid="launch-app"
          >
            Launch app <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>

      <nav className="container-page flex gap-1 overflow-x-auto pb-2 md:hidden">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-muted hover:text-paper rounded-full px-3 py-1.5 text-xs whitespace-nowrap hover:bg-white/5"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

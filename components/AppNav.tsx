import Link from "next/link";

import { LogoutButton } from "@/components/forms/LogoutButton";
import { WalletMenu } from "@/components/WalletMenu";
import { getSessionUser } from "@/lib/session";

const LINKS = [
  { href: "/picks", label: "Picks" },
  { href: "/analysts", label: "Analysts" },
  { href: "/memory", label: "Memory" },
  { href: "/signals", label: "Signals" },
  { href: "/payments", label: "Payments" },
];

export async function AppNav() {
  const user = await getSessionUser();

  return (
    <header className="border-line bg-base/85 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="container-page flex h-16 items-center justify-between gap-6">
        <Link href="/" className="group flex items-center gap-3">
          <span className="border-amber/40 bg-amber/10 relative grid size-9 place-items-center rounded-full border">
            <span className="display text-amber text-lg leading-none">S</span>
            <span className="border-amber/20 absolute inset-1 rounded-full border" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="display text-xl tracking-tight">Saksi</span>
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
          {user ? (
            <>
              <span className="mono text-muted hidden text-xs sm:inline">@{user.handle}</span>
              <LogoutButton />
              <Link href="/picks/new" className="btn btn-primary h-9 px-4 text-xs">
                Seal a pick
              </Link>
            </>
          ) : (
            <Link href="/onboarding" className="btn btn-primary h-9 px-4 text-xs">
              Start journal
            </Link>
          )}
          <WalletMenu />
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

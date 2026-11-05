import Link from "next/link";

import { PublishSignalPanel } from "@/components/forms/PublishSignalPanel";
import { EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { formatAtomic } from "@/lib/price";
import { getSessionUser } from "@/lib/session";
import { canSell } from "@/server/auth";
import { listListedSignals } from "@/server/data/listings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Signals" };

export default async function SignalsPage() {
  const [items, user] = await Promise.all([listListedSignals(), getSessionUser()]);
  const maySell = user !== null && canSell(user.walletAddress);

  return (
    <div>
      <PageHeader
        eyebrow="Sell research, get paid per call"
        title="Signals with a receipt."
        description="Anyone who proves a wallet can publish a signal and set its price. Buyers pay the seller's wallet directly through x402 on Sui; Saksi verifies the settlement with Tatum before releasing the payload, and takes a flat listing fee rather than a cut of the sale."
        actions={
          <Link href="/payments" className="btn btn-ghost">
            Payment ledger
          </Link>
        }
      />

      <div className="container-page grid gap-8 pb-20 lg:grid-cols-[1.35fr_0.65fr]">
        <section>
          {items.length === 0 ? (
            <EmptyState
              title="No signals listed yet"
              description="A listing appears here once its listing fee has settled on Sui. Publish the first one from the panel on this page."
            />
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <Link
                  key={item.signal.id}
                  href={`/signals/${item.signal.id}`}
                  className="card block p-5 transition-colors hover:border-white/20"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="badge badge-sealed">
                      {item.sellerWallet === null
                        ? item.signal.provider
                        : `${item.sellerWallet.slice(0, 6)}…${item.sellerWallet.slice(-4)}`}
                    </span>
                    <span className="mono text-muted text-[10px]">
                      {formatDateTime(item.signal.createdAt)}
                    </span>
                  </div>
                  <h2 className="display mt-3 text-2xl">{item.signal.title}</h2>
                  <div className="text-muted mt-3 flex flex-wrap items-center gap-4 text-xs">
                    <span>
                      price{" "}
                      <span className="mono text-amber">
                        ${formatAtomic(item.signal.priceAtomic)}
                      </span>
                    </span>
                    <span>
                      purchases <span className="mono text-paper">{item.purchases}</span>
                    </span>
                    {item.sellerWallet === null ? null : (
                      <span className="mono text-muted/70">
                        paid to {item.sellerWallet.slice(0, 8)}…{item.sellerWallet.slice(-4)}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <section className="card p-6">
            <p className="mono text-amber text-[10px] tracking-[0.18em] uppercase">Sell a signal</p>
            <h2 className="display mt-2 text-2xl">Publish for a flat fee</h2>
            {user === null ? (
              <p className="text-muted mt-2 text-xs leading-relaxed">
                <Link href="/onboarding" className="link-underline text-amber">
                  Start a journal
                </Link>{" "}
                and prove a wallet to publish signals. Buyers pay your wallet directly, so Saksi
                never holds your money.
              </p>
            ) : maySell ? (
              <>
                <p className="text-muted mt-2 mb-4 text-xs leading-relaxed">
                  The listing fee is settled through x402 before the listing becomes visible. Your
                  sale price is paid straight to{" "}
                  <span className="mono text-paper">
                    {user.walletAddress?.slice(0, 8)}…{user.walletAddress?.slice(-4)}
                  </span>
                  .
                </p>
                <PublishSignalPanel handle={user.handle} />
              </>
            ) : (
              <p className="text-muted mt-2 text-xs leading-relaxed">
                This journal has no wallet bound yet, so there is nowhere to send a buyer&apos;s
                payment.{" "}
                <Link href="/settings/wallet" className="link-underline text-amber">
                  Bind a wallet
                </Link>{" "}
                first — it needs one signature and costs nothing.
              </p>
            )}
          </section>

          <section className="card p-6">
            <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">Payment path</p>
            <ol className="text-muted mt-3 space-y-3 text-xs leading-relaxed">
              <li>
                <span className="text-amber">01</span> Buyer requests the signal endpoint.
              </li>
              <li>
                <span className="text-amber">02</span> x402 returns requirements whose recipient is
                the seller&apos;s wallet and whose amount is the seller&apos;s price.
              </li>
              <li>
                <span className="text-amber">03</span> Facilitator settles the exact payment; the
                digest comes back in the receipt header.
              </li>
              <li>
                <span className="text-amber">04</span> Saksi asks Tatum to verify status, recipient,
                coin and amount before releasing the payload.
              </li>
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}

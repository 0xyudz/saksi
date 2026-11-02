import Link from "next/link";

import { SignalIngestForm } from "@/components/forms/SignalIngestForm";
import { EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { formatAtomic } from "@/lib/price";
import { ingestionEnabled } from "@/server/auth";
import { listSignals } from "@/server/data/signals";

export const dynamic = "force-dynamic";
export const metadata = { title: "Signals" };

export default async function SignalsPage() {
  const items = await listSignals();
  const canIngest = ingestionEnabled();

  return (
    <div>
      <PageHeader
        eyebrow="Premium data, paid per call"
        title="Signals with a receipt."
        description="Every signal is fetched from a configured provider and sold through an x402 paywall on Sui. The seller verifies the settlement through Tatum before releasing the payload; the buyer verifies it again and writes payment + source ROI memories."
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
              title="No signals ingested"
              description="Once SIGNAL_PROVIDER_API_URL and SIGNAL_PROVIDER_API_KEY are configured, ingest a real provider signal. Without them this feature returns 503 instead of inventing data."
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
                    <span className="badge badge-sealed">{item.signal.provider}</span>
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
                    <span className="mono text-muted/70">{item.signal.id}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <section className="card p-6">
            <p className="mono text-amber text-[10px] tracking-[0.18em] uppercase">
              Provider ingestion
            </p>
            <h2 className="display mt-2 text-2xl">Fetch a real signal</h2>
            {canIngest ? (
              <>
                <p className="text-muted mt-2 mb-4 text-xs leading-relaxed">
                  Ingestion calls{" "}
                  <span className="mono text-paper">
                    GET {"{SIGNAL_PROVIDER_API_URL}"}/{"{id}"}
                  </span>{" "}
                  with the configured bearer token. The payload is stored only after the provider
                  response validates.
                </p>
                <SignalIngestForm />
              </>
            ) : (
              <p className="text-muted mt-2 text-xs leading-relaxed">
                Ingestion is restricted to operator journals. The provider call spends the
                operator&apos;s paid quota and writes into the shared catalogue, so it is not open
                to every visitor. The signals below are still purchasable by anyone with a wallet.
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
                <span className="text-amber">02</span> x402 returns payment requirements for the
                configured Sui network; the buyer&apos;s connected wallet signs the payment.
              </li>
              <li>
                <span className="text-amber">03</span> Facilitator settles the exact payment; the
                digest comes back in the receipt header.
              </li>
              <li>
                <span className="text-amber">04</span> Seller asks Tatum to verify status,
                recipient, coin and amount before returning the payload.
              </li>
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}

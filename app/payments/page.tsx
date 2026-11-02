import Link from "next/link";

import { VerifyPaymentForm } from "@/components/forms/VerifyPaymentForm";
import { EmptyState, Hash, PageHeader, ProofLine, StatCard } from "@/components/ui";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/config";
import { getEnv, suiNetworkSchema } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { errorForLog, getLogger } from "@/lib/logger";
import { formatUsd } from "@/lib/price";
import { merchantBalance, eventsForDigests } from "@/server/data/chain";
import { listRecentPayments } from "@/server/data/lifecycle";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payment ledger" };

export default async function PaymentsPage() {
  const payments = await listRecentPayments(100);
  const digests = payments.map((payment) => payment.digest);

  const [balance, events] = await Promise.allSettled([
    merchantBalance(),
    eventsForDigests(digests),
  ]);

  if (balance.status === "rejected") {
    getLogger().warn({ error: errorForLog(balance.reason) }, "merchant balance unavailable");
  }
  if (events.status === "rejected") {
    getLogger().warn({ error: errorForLog(events.reason) }, "settlement events unavailable");
  }

  const network = getEnv().SUI_NETWORK;
  const totalAtomic = payments.reduce((sum, payment) => sum + payment.amountAtomic, 0n);
  const latest = payments[0];

  return (
    <div>
      <PageHeader
        eyebrow="x402 · Tatum verified"
        title="Every premium call, with its receipt."
        description="This ledger only contains settlements that Tatum confirmed on the configured Sui network. Balances and events below are live queries; if Tatum is unavailable the page says so instead of showing a substitute."
        actions={
          <Link href="/signals" className="btn btn-ghost">
            Browse signals
          </Link>
        }
      />

      <div className="container-page pb-20">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Verified settlements"
            value={payments.length}
            detail="payments table, digest-unique"
            tone="amber"
          />
          <StatCard
            label="Total settled"
            value={formatUsd(totalAtomic)}
            detail="sum of recorded amounts"
            tone="green"
          />
          <StatCard
            label="Merchant USDC balance"
            value={
              balance.status === "fulfilled"
                ? formatUsd(BigInt(balance.value.totalBalance))
                : "unavailable"
            }
            detail={
              balance.status === "fulfilled"
                ? "Tatum GraphQL balance of the x402 recipient"
                : "Tatum balance query failed"
            }
          />
          <StatCard
            label="Latest settlement"
            value={latest ? formatDateTime(latest.verifiedAt) : "—"}
            detail={latest ? latest.provider : "No payment recorded yet"}
          />
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <section className="card p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
                  Settlement ledger
                </p>
                <h2 className="display mt-2 text-2xl">Digests, payers, amounts</h2>
              </div>
              <span className="mono text-muted text-[10px]">network {network}</span>
            </div>

            {payments.length === 0 ? (
              <div className="mt-5">
                <EmptyState
                  title="No settlements recorded"
                  description="Buy a signal with your own Sui wallet. The seller verifies the digest through Tatum before releasing the payload, then records the receipt against your journal."
                  action={
                    <Link href="/signals" className="btn btn-primary">
                      Find a signal
                    </Link>
                  }
                />
              </div>
            ) : (
              <div className="divide-line mt-5 divide-y">
                {payments.map((payment) => {
                  const paymentNetwork = suiNetworkSchema.parse(payment.network);
                  return (
                    <div key={payment.id} className="py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <Link
                            href={`/signals/${payment.signalId}`}
                            className="link-underline text-paper text-sm"
                          >
                            {payment.signalTitle}
                          </Link>
                          <p className="mono text-muted mt-1 text-[10px] uppercase">
                            {payment.provider} · {paymentNetwork}
                          </p>
                        </div>
                        <span className="mono text-amber text-sm">
                          {formatUsd(payment.amountAtomic)}
                        </span>
                      </div>
                      <div className="text-muted mt-3 grid gap-1 text-[11px]">
                        <p className="mono break-all">
                          digest{" "}
                          <a
                            href={explorerTxUrl(paymentNetwork, payment.digest)}
                            target="_blank"
                            rel="noreferrer"
                            className="link-underline text-amber"
                          >
                            {payment.digest}
                          </a>
                        </p>
                        <p className="mono break-all">payer {payment.payer}</p>
                        <p className="mono break-all">pay to {payment.payTo}</p>
                        <p className="mono">verified {formatDateTime(payment.verifiedAt)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="space-y-6">
            <section className="card p-6">
              <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
                Merchant account
              </p>
              {balance.status === "fulfilled" ? (
                <div className="mt-3">
                  <ProofLine
                    label="Address"
                    value={balance.value.owner}
                    href={explorerAddressUrl(network, balance.value.owner)}
                  />
                  <ProofLine label="Coin" value={balance.value.coinType} />
                  <ProofLine
                    label="Balance"
                    value={formatUsd(BigInt(balance.value.totalBalance))}
                  />
                </div>
              ) : (
                <p className="text-red mt-3 text-xs leading-relaxed">
                  Tatum did not return the merchant balance. The query is not retried with a
                  different provider or replaced with a cached value.
                </p>
              )}
            </section>

            <section className="card p-6">
              <p className="mono text-amber text-[10px] tracking-[0.18em] uppercase">
                Verify any digest
              </p>
              <h2 className="display mt-2 text-2xl">Trust, then check.</h2>
              <p className="text-muted mt-2 mb-4 text-xs leading-relaxed">
                Paste a settlement digest to verify it against the configured recipient, coin and
                minimum amount. Verification is idempotent on the digest.
              </p>
              <VerifyPaymentForm />
            </section>
          </aside>
        </div>

        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
                GraphQL transaction.effects.events
              </p>
              <h2 className="display mt-2 text-3xl">Settlement events</h2>
            </div>
            <span className="mono text-muted text-[10px]">
              {events.status === "fulfilled"
                ? `${events.value.length} events across ${Math.min(digests.length, 10)} digests`
                : "query failed"}
            </span>
          </div>

          {events.status === "rejected" ? (
            <div className="card-flat text-red p-5 text-sm leading-relaxed">
              Tatum did not return events for the recent settlements. No empty-state claim is being
              made; the query itself failed.
            </div>
          ) : events.value.length === 0 ? (
            <EmptyState
              title="No events returned"
              description={
                digests.length === 0
                  ? "There are no settlements to query yet."
                  : "The successful queries returned no event records for these settlements."
              }
            />
          ) : (
            <div className="card divide-line divide-y">
              {events.value.map((event, index) => (
                <details key={`${event.digest}-${event.type}-${index}`} className="group p-4">
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                    <span className="text-paper text-sm">{event.type}</span>
                    <span className="flex items-center gap-3">
                      <Hash value={event.digest} head={12} tail={10} />
                      <span className="mono text-muted group-open:text-amber text-[10px]">
                        payload
                      </span>
                    </span>
                  </summary>
                  <pre className="text-paper/80 mt-3 max-h-72 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-[10px] leading-relaxed">
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

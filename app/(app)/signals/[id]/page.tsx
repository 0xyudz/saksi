import Link from "next/link";
import { notFound } from "next/navigation";

import { PurchaseSignalPanel } from "@/components/forms/PurchaseSignalPanel";
import { PageHeader, ProofLine } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { formatUsd } from "@/lib/price";
import { getSessionUser } from "@/lib/session";
import { recentPicks } from "@/server/data/picks";
import { findSignalById } from "@/server/data/signals";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return { title: "Signal" };
  const signal = await findSignalById(id);
  return { title: signal ? signal.title : "Signal" };
}

export default async function SignalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [signal, user] = await Promise.all([findSignalById(id), getSessionUser()]);
  if (!signal) notFound();

  const ownedPicks = user ? await recentPicks(50, user.id) : [];
  const pickOptions = ownedPicks.map((item) => ({
    id: item.pick.id,
    label: `${item.pick.selection} · ${item.pick.market}`,
  }));

  return (
    <div>
      <PageHeader
        eyebrow={`${signal.provider} · premium signal`}
        title={signal.title}
        description="The payload sits behind an x402 paywall on Sui. The seller asks Tatum to verify the settlement digest before releasing it, and the buyer verifies the same digest again before the payment is written to the ledger."
        actions={
          <>
            <span className="badge badge-sealed">{formatUsd(signal.priceAtomic)} / call</span>
            <Link href="/signals" className="btn btn-ghost">
              All signals
            </Link>
          </>
        }
      />

      <div className="container-page grid gap-6 pb-20 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <section className="card p-6">
            <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">Listing</p>
            <div className="mt-3">
              <ProofLine label="Signal id" value={signal.id} />
              <ProofLine label="Provider" value={signal.provider} mono={false} />
              <ProofLine label="Provider reference" value={signal.externalRef} />
              <ProofLine
                label="Price"
                value={`${signal.priceAtomic.toString()} atomic · ${formatUsd(signal.priceAtomic)}`}
              />
              <ProofLine label="Settlement asset" value={signal.asset} />
              <ProofLine label="Ingested" value={formatDateTime(signal.createdAt)} />
            </div>
            <p className="border-line text-muted mt-4 rounded-xl border bg-white/5 p-3 text-xs leading-relaxed">
              The provider payload is not rendered on this page. It leaves the server only inside a
              paid response that carries a Tatum-verified settlement digest.
            </p>
          </section>

          <section className="card p-6">
            <p className="mono text-amber text-[10px] tracking-[0.18em] uppercase">Buy this call</p>
            <h2 className="display mt-2 text-3xl">Pay, verify, then read.</h2>
            <p className="text-muted mt-2 mb-5 text-xs leading-relaxed">
              Connect your own Sui wallet and sign the x402 payment from your balance. Saksi never
              receives your private key. You can link the purchase to one of your picks so the
              provider&apos;s ROI can be scored against a resolved outcome.
            </p>

            {user ? (
              <PurchaseSignalPanel signalId={signal.id} pickOptions={pickOptions} />
            ) : (
              <div className="border-amber/30 bg-amber/5 text-amber rounded-xl border p-4 text-sm leading-relaxed">
                Start a journal before buying a signal. The purchase writes a payment memory and a
                source-ROI memory into your own Walrus namespace, and both need a journal identity.
                <div className="mt-4">
                  <Link href="/onboarding" className="btn btn-primary">
                    Start a journal
                  </Link>
                </div>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="card p-6">
            <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
              What the payment buys
            </p>
            <ul className="text-muted mt-3 space-y-3 text-xs leading-relaxed">
              <li>
                <span className="text-amber">01</span> A provider payload that was stored only after
                the upstream response validated against the agreed contract.
              </li>
              <li>
                <span className="text-amber">02</span> The exact Sui transaction digest, payer,
                recipient, coin type and amount verified by Tatum.
              </li>
              <li>
                <span className="text-amber">03</span> Two memory records in your namespace: the
                payment receipt and the provider&apos;s resolved ROI.
              </li>
            </ul>
          </section>

          <section className="card p-6">
            <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
              Trust boundary
            </p>
            <p className="text-muted mt-3 text-xs leading-relaxed">
              The facilitator returns a settlement receipt, but Saksi does not trust it. Tatum is
              queried for the digest, status, balance changes and events. A settlement that is
              short, failed, or addressed to a different recipient is refused before the payload is
              returned.
            </p>
            <div className="mt-4">
              <Link href="/payments" className="link-underline text-amber text-xs">
                Inspect the payment ledger →
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

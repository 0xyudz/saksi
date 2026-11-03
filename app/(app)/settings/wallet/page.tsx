import { redirect } from "next/navigation";

import { BindWalletPanel } from "@/components/forms/BindWalletPanel";
import { PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Wallet" };

export default async function WalletSettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/onboarding");

  return (
    <div>
      <PageHeader
        eyebrow="Identity"
        title="Your payout wallet."
        description="Saksi never holds your money. A proven wallet is where buyers send payment when they unlock a signal you published, so the address must be one you control."
      />

      <div className="container-page grid gap-8 pb-20 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="card p-6 sm:p-8">
          <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
            {user.walletAddress === null ? "Not bound yet" : "Bound"}
          </p>
          <h2 className="display mt-2 text-2xl">@{user.handle}</h2>

          {user.walletAddress === null ? (
            <>
              <p className="text-muted mt-3 mb-6 text-xs leading-relaxed">
                This journal was created before wallet auth existed, so it has no payout address
                yet. Binding needs one signature and costs nothing.
              </p>
              <BindWalletPanel />
            </>
          ) : (
            <div className="mt-4 space-y-3">
              <p className="border-green/30 bg-green/5 text-green mono rounded-xl border px-3 py-2 text-[11px] break-all">
                {user.walletAddress}
              </p>
              <p className="text-muted text-xs leading-relaxed">
                Buyers pay this address directly through x402. Binding is one-way: a journal cannot
                repoint its wallet, because a hijacked session must not be able to redirect a
                seller&apos;s income.
              </p>
            </div>
          )}
        </section>

        <aside className="card p-6">
          <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">How proof works</p>
          <ol className="text-muted mt-3 space-y-3 text-xs leading-relaxed">
            <li>
              <span className="text-amber">01</span> Saksi issues a single-use message containing
              your address, the action, and a nonce.
            </li>
            <li>
              <span className="text-amber">02</span> Your wallet signs those exact bytes. The
              message is stored, so verification can never drift from what you approved.
            </li>
            <li>
              <span className="text-amber">03</span> The server consumes the nonce first, then
              checks the Ed25519 signature. A replayed nonce fails even if the signature is valid.
            </li>
          </ol>
        </aside>
      </div>
    </div>
  );
}

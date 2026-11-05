import { redirect } from "next/navigation";

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
        title="This journal is a wallet."
        description="There is no account to manage and no address to attach. The wallet you signed with is the journal, which is why Saksi never holds your money and cannot move it."
      />

      <div className="container-page grid gap-8 pb-20 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="card p-6 sm:p-8">
          <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">Proven wallet</p>
          <h2 className="display mt-2 text-2xl">@{user.handle}</h2>

          <div className="mt-4 space-y-3">
            <p className="border-green/30 bg-green/5 text-green mono rounded-xl border px-3 py-2 text-[11px] break-all">
              {user.walletAddress ?? "This journal predates wallet identity."}
            </p>
            <p className="text-muted text-xs leading-relaxed">
              Buyers pay this address directly through x402. There is nothing to rebind: changing
              where the money goes would mean signing in with a different wallet, which is a
              different journal.
            </p>
            <p className="text-muted text-xs leading-relaxed">
              Because the address is the identity, two journals cannot share one. That is the
              opposite of your handle, which is only a display name and may be shared.
            </p>
          </div>
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

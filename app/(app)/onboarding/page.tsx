import { OnboardingForm } from "@/components/forms/OnboardingForm";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";
import { getSessionUser } from "@/lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = { title: "Start a journal" };

export default async function OnboardingPage() {
  const existing = await getSessionUser();
  if (existing) redirect("/picks");

  return (
    <div className="container-page grid min-h-[70vh] items-center gap-12 py-16 lg:grid-cols-[1.1fr_0.9fr]">
      <div>
        <p className="mono text-amber text-[10px] tracking-[0.24em] uppercase">{APP_TAGLINE}</p>
        <h1 className="display mt-5 text-5xl sm:text-6xl">
          Your memory is the
          <br />
          analyst.
        </h1>
        <p className="text-muted mt-6 max-w-lg text-[15px] leading-relaxed">
          {APP_NAME} keeps a private journal of every pick you make before an event. Sealed
          commitments go to Walrus Memory. Outcomes are resolved against a real source URL. The next
          recommendation is earned from what actually happened.
        </p>
        <ul className="text-muted mt-8 space-y-3 text-sm">
          <li className="flex gap-3">
            <span className="mono text-amber">01</span>
            <span>Prove a Sui wallet — one signature, no payment, no funds moved.</span>
          </li>
          <li className="flex gap-3">
            <span className="mono text-amber">02</span>
            <span>Commit with sha256(canonical(pick)) before the event.</span>
          </li>
          <li className="flex gap-3">
            <span className="mono text-amber">03</span>
            <span>Resolve against an independent result provider, not your own word.</span>
          </li>
        </ul>
      </div>

      <div className="card p-6 sm:p-8">
        <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">New journal</p>
        <h2 className="display mt-3 text-3xl">Claim a handle</h2>
        <p className="text-muted mt-2 mb-6 text-xs leading-relaxed">
          No email, no password. Your wallet is the journal, and that proven address is where buyers
          pay you if you publish signals. The handle is only a display name, so another journal may
          use the same one. A one-time recovery code is your fallback if the wallet is lost.
        </p>
        <OnboardingForm />
      </div>
    </div>
  );
}

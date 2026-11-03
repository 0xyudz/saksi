import Link from "next/link";

import { APP_NAME, explorerTxUrl } from "@/lib/config";
import { shortHash } from "@/lib/format";
import { DOCS } from "@/server/data/docs";

export const metadata = {
  title: "The prediction journal that cannot lie",
  description:
    "Saksi seals a prediction before the event, reveals it against the original hash, resolves it against an independent results provider, and remembers the pattern in Walrus Memory. Signals settle through x402 on Sui and are verified with Tatum.",
};

/** Real values, copied from the README Proof table. Nothing here is illustrative. */
const PROOF = {
  blobId: "tO58wlvK_zeGbWMS9sWf284bMr9c_Y2uuQQsj20kKMw",
  digest: "DemaKkYM7Ni4mRJcxbth3e4h3BkkqgKnR1MYPdWhmgjq",
  cosine: "0.3600",
  checkpoint: "341329560",
} as const;

const STEPS = [
  {
    number: "01",
    name: "Seal",
    lead: "Commit before you know.",
    body: "The pick is canonicalised, hashed with SHA-256, and written to Walrus Memory. The memory holds the market, the hash and the timestamp — never the selection. Anyone can see you committed; nobody can see what until you open it.",
    proof: "pick_commit memory · sha256 commitment",
  },
  {
    number: "02",
    name: "Reveal",
    lead: "Open it against the original hash.",
    body: "The server re-hashes the stored payload and refuses the reveal if a single byte moved. Only then do the selection and the odds get written, in a separate memory. Editing the pick after the fact is not a policy — it is a failed hash.",
    proof: "hash mismatch → 409, no exceptions",
  },
  {
    number: "03",
    name: "Resolve",
    lead: "Put the result on the record.",
    body: "You record the result, and if the pick was sealed against a real fixture, Saksi re-reads that match from a provider you do not control. Agreement is stored as verified; disagreement is stored as contradicted with both verdicts. Either way it computes a Brier score from the odds you took and updates a credibility score that shrinks small samples toward zero and decays with a 90-day half-life.",
    proof: "oracle verified · Brier · Wilson lower bound",
  },
  {
    number: "04",
    name: "Remember",
    lead: "Let your history argue with you.",
    body: "Before the next pick, Saksi recalls your own memories and cites them: the blob, the text, the cosine distance. A repeated losing pattern downgrades the verdict, and the summary says the verdict changed rather than quietly presenting the new answer.",
    proof: "cited blobs · verdict downgrade",
  },
] as const;

const INTEGRATIONS = [
  {
    name: "Walrus Memory",
    role: "The memory layer",
    body: "Eight validated record kinds written as one deterministic `saksi:v1` line each. A claim is never recorded unless the relayer returned a blob ID, so a pick that is not in memory is not a pick. Recall returns the text and the distance, and every recommendation carries its citations.",
    facts: ["relayer 0.1.0", "38 memories on mainnet", "per-journal namespaces"],
  },
  {
    name: "Tatum",
    role: "The read side of the chain",
    body: "Every Sui read goes through Tatum's GraphQL gateway: checkpoints, transaction effects, balance changes and the platform's USDC balance. A seller releases a paid signal only after Tatum confirms the digest, the recipient, the coin type and the amount.",
    facts: [`checkpoint ${PROOF.checkpoint}`, "GraphQL only", "3 req/s throttled"],
  },
  {
    name: "x402 on Sui",
    role: "Paid data, per call",
    body: "Signals sit behind an x402 paywall. Any journal that proves a Sui wallet can publish one and set its own price; a flat listing fee goes to the platform, and each sale goes straight to the seller. The buyer signs their own payment, so the private key never reaches the server, and one digest pays for one signal and one resource.",
    facts: ["$0.02 listing fee", "seller wallet is payee", "receipt bound to one resource"],
  },
] as const;

const HONESTY = [
  "The hash proves a pick existed before the event and was not edited. Oracle verification covers one league (English Premier League) and match-winner markets; every other outcome is labelled self-attested, with the source URL the owner supplied.",
  "A contradicted claim is kept, not deleted: the owner's verdict and the provider's verdict are both stored, and only provider-confirmed outcomes count toward a verified score.",
  "The catalogue signal behind the recorded purchase is a synthetic demo payload. It exercises the paywall; it is not a real forecast product, and the payload says so.",
  "No listing has been published through the paid flow on mainnet yet, so the listing fee has a verified 402 challenge but no recorded settlement digest.",
  "Settlement happens before Tatum verification. If Tatum is unreachable after settlement, the buyer has paid and can re-check the digest without paying again.",
] as const;

export default function LandingPage() {
  return (
    <div>
      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="border-line relative overflow-hidden border-b">
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-70" />
        <div className="container-page relative grid items-center gap-14 pt-20 pb-20 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <p className="mono text-amber text-[10px] tracking-[0.26em] uppercase">
              Total Recall · Tatum × Walrus Memory
            </p>
            <h1 className="display mt-6 max-w-2xl text-5xl leading-[0.95] sm:text-7xl">
              The prediction journal that cannot lie.
            </h1>
            <p className="text-muted mt-7 max-w-xl text-[15px] leading-relaxed">
              Anyone can claim they called it. {APP_NAME} makes the claim checkable: seal the pick
              before the event, write the commitment to Walrus Memory, resolve it against a real
              source, and let your own history change the next decision.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/dashboard" className="btn btn-primary h-11 px-6">
                Launch app <span aria-hidden="true">→</span>
              </Link>
              <Link href="/how-it-works" className="btn h-11 px-6">
                How it works
              </Link>
              <Link href="/docs" className="btn btn-ghost h-11 px-6">
                Read the docs
              </Link>
            </div>
            <div className="mt-9 flex flex-wrap gap-2">
              <span className="badge badge-neutral">sha256 commitments</span>
              <span className="badge badge-neutral">Walrus Memory recall</span>
              <span className="badge badge-neutral">Tatum Sui GraphQL</span>
              <span className="badge badge-neutral">x402 on Sui</span>
            </div>
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between">
              <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
                Recorded on mainnet
              </p>
              <span className="badge badge-success">verified</span>
            </div>
            <dl className="mt-5 space-y-4">
              <div>
                <dt className="text-muted text-[11px]">Walrus Memory blob</dt>
                <dd className="mono text-paper mt-1 text-[11px] break-all">{PROOF.blobId}</dd>
              </div>
              <div>
                <dt className="text-muted text-[11px]">Recall distance (cosine)</dt>
                <dd className="mono text-paper mt-1 text-[11px]">{PROOF.cosine}</dd>
              </div>
              <div>
                <dt className="text-muted text-[11px]">x402 settlement</dt>
                <dd className="mt-1">
                  <a
                    href={explorerTxUrl("sui:mainnet", PROOF.digest)}
                    target="_blank"
                    rel="noreferrer"
                    className="link-underline mono text-amber text-[11px]"
                  >
                    {shortHash(PROOF.digest, 12, 10)}
                  </a>
                </dd>
              </div>
            </dl>
            <p className="border-line text-muted mt-5 border-t pt-4 text-[11px] leading-relaxed">
              One real $0.01 USDC purchase, signed by a self-custody browser wallet and verified
              through Tatum before the payload was released. The Walrus values above are from one
              recorded run; every value in the README is reproducible with the command beside it.
            </p>
          </div>
        </div>
      </section>

      {/* ── The problem ────────────────────────────────────────────────────── */}
      <section className="container-page grid gap-10 py-20 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="mono text-amber text-[10px] tracking-[0.24em] uppercase">The problem</p>
          <h2 className="display mt-4 text-4xl sm:text-5xl">
            A win rate is a claim,
            <br />
            not a record.
          </h2>
        </div>
        <div className="space-y-5">
          <p className="text-muted text-[15px] leading-relaxed">
            Every prediction product asks you to trust a number: a win rate, a leaderboard rank, a
            confidence score. None of them can be checked, and none of them answer the question that
            actually matters before the next bet —{" "}
            <span className="text-paper">
              where have I been wrong before, and does this situation look like those times?
            </span>
          </p>
          <p className="text-muted text-[15px] leading-relaxed">
            {APP_NAME} answers it with three things a screenshot cannot fake: a hash that existed
            before the event, an outcome checked against an independent results provider, and a
            memory that is recalled before the next decision with the evidence attached.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { value: "SHA-256", label: "commitment before the event" },
              { value: "8", label: "validated memory kinds" },
              { value: "125", label: "unit tests on pure logic" },
            ].map((item) => (
              <div key={item.label} className="card-flat p-4">
                <p className="mono text-amber text-lg">{item.value}</p>
                <p className="text-muted mt-1 text-[11px] leading-relaxed">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Four steps ─────────────────────────────────────────────────────── */}
      <section id="how-it-works" className="border-line bg-panel/30 scroll-mt-20 border-y">
        <div className="container-page py-20">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div className="max-w-2xl">
              <p className="mono text-amber text-[10px] tracking-[0.24em] uppercase">
                How it works
              </p>
              <h2 className="display mt-4 text-4xl sm:text-5xl">Four steps, four memories.</h2>
              <p className="text-muted mt-4 text-[15px] leading-relaxed">
                Each step writes its own record, so the journal can be audited in order. A later
                claim cannot rewrite an earlier one.
              </p>
            </div>
            <Link href="/how-it-works" className="link-underline text-amber shrink-0 text-sm">
              The long version →
            </Link>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {STEPS.map((step) => (
              <article key={step.number} className="card flex flex-col p-6">
                <div className="flex items-baseline justify-between">
                  <span className="mono text-amber text-[10px] tracking-[0.2em]">
                    {step.number}
                  </span>
                  <span className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
                    {step.name}
                  </span>
                </div>
                <h3 className="display mt-5 text-2xl leading-tight">{step.lead}</h3>
                <p className="text-muted mt-3 flex-1 text-[13.5px] leading-relaxed">{step.body}</p>
                <p className="mono border-line text-amber/80 mt-5 border-t pt-3 text-[10px] tracking-[0.08em]">
                  {step.proof}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Integrations ───────────────────────────────────────────────────── */}
      <section id="integrations" className="container-page scroll-mt-20 py-20">
        <div className="max-w-2xl">
          <p className="mono text-amber text-[10px] tracking-[0.24em] uppercase">The stack</p>
          <h2 className="display mt-4 text-4xl sm:text-5xl">Three services, one honest loop.</h2>
          <p className="text-muted mt-4 text-[15px] leading-relaxed">
            Walrus Memory remembers, Tatum verifies, x402 charges. Each one is replaceable in
            principle and load-bearing in practice.
          </p>
        </div>

        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {INTEGRATIONS.map((item) => (
            <article key={item.name} className="card flex flex-col p-6">
              <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">{item.role}</p>
              <h3 className="display mt-3 text-2xl">{item.name}</h3>
              <p className="text-muted mt-3 flex-1 text-[13.5px] leading-relaxed">{item.body}</p>
              <ul className="mt-5 flex flex-wrap gap-2">
                {item.facts.map((fact) => (
                  <li key={fact} className="badge badge-neutral normal-case">
                    {fact}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {/* ── Honesty ────────────────────────────────────────────────────────── */}
      <section className="border-line bg-panel/30 border-y">
        <div className="container-page grid gap-10 py-20 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="mono text-amber text-[10px] tracking-[0.24em] uppercase">
              What it does not claim
            </p>
            <h2 className="display mt-4 text-4xl sm:text-5xl">
              The limits are
              <br />
              part of the design.
            </h2>
            <p className="text-muted mt-4 max-w-md text-[15px] leading-relaxed">
              A tamper-evident record of a self-attested claim is still useful. Pretending it is
              verified would not be, so the interface says which one it is.
            </p>
          </div>
          <ul className="space-y-4">
            {HONESTY.map((item) => (
              <li key={item} className="card-flat flex gap-4 p-5">
                <span aria-hidden="true" className="text-amber mono shrink-0 text-xs">
                  ✕
                </span>
                <p className="text-muted text-[13.5px] leading-relaxed">{item}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Docs ───────────────────────────────────────────────────────────── */}
      <section id="docs" className="container-page scroll-mt-20 py-20">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="mono text-amber text-[10px] tracking-[0.24em] uppercase">Documentation</p>
            <h2 className="display mt-4 text-4xl sm:text-5xl">Read the actual engineering.</h2>
            <p className="text-muted mt-4 text-[15px] leading-relaxed">
              The documents below are the ones in the repository, rendered in the app. They are not
              a marketing summary — they include the trade-offs, the failure policy and the parts
              that are still unverified.
            </p>
          </div>
          <Link href="/docs" className="link-underline text-amber shrink-0 text-sm">
            All documents →
          </Link>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {DOCS.map((doc) => (
            <Link
              key={doc.slug}
              href={`/docs/${doc.slug}`}
              className="card group flex flex-col p-6 transition-colors hover:bg-white/[0.03]"
            >
              <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
                {doc.eyebrow}
              </p>
              <h3 className="display mt-3 text-2xl">{doc.title}</h3>
              <p className="text-muted mt-3 flex-1 text-[13.5px] leading-relaxed">{doc.summary}</p>
              <span className="mono text-amber mt-5 text-[11px]">Read →</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────────────────── */}
      <section className="border-line border-t">
        <div className="container-page flex flex-col items-start justify-between gap-8 py-20 md:flex-row md:items-center">
          <div>
            <h2 className="display max-w-xl text-4xl sm:text-5xl">
              Seal the next pick before you know the answer.
            </h2>
            <p className="text-muted mt-4 max-w-xl text-[15px] leading-relaxed">
              No email, no password. A journal is claimed by proving a Sui wallet with one
              signature, and a 24-symbol recovery code is issued exactly once as the fallback if
              that wallet is lost.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Link href="/dashboard" className="btn btn-primary h-11 px-6">
              Launch app <span aria-hidden="true">→</span>
            </Link>
            <Link href="/docs/implementation" className="btn h-11 px-6">
              Implementation
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

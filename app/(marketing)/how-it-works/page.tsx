import Link from "next/link";

import { explorerTxUrl } from "@/lib/config";

export const metadata = {
  title: "How it works",
  description:
    "Saksi in five minutes: seal a pick with a canonical SHA-256 hash, reveal it against that hash, resolve it with a source, and let Walrus Memory change the next decision. Includes the exact guards, the scoring formula and what the hash does not prove.",
};

const LIFECYCLE = [
  {
    status: "sealed",
    title: "Seal",
    what: "You commit to a market, a selection, the odds you took, and a stake in units.",
    writes: "pick_commit memory",
    guard:
      "Odds must be greater than 1; stake must be a positive integer; committedAt is server time.",
    why: "The timestamp inside the hash is never client-supplied, so it cannot be backdated.",
  },
  {
    status: "revealed",
    title: "Reveal",
    what: "You open the pick. The server re-hashes the stored payload and compares.",
    writes: "pick_reveal memory",
    guard: "Owner only. Hash must still match. An optional revealAt must be in the past.",
    why: "A reveal is idempotent, so refreshing the page cannot corrupt the record.",
  },
  {
    status: "resolved",
    title: "Resolve",
    what: "You record win, loss or void. If the pick is linked to a real fixture, the provider is re-read first.",
    writes: "outcome, bias, source_roi memories",
    guard: "Owner only. Must be revealed first. resolvedAt cannot precede committedAt.",
    why: "A truthful claim becomes oracle_verified, a false one becomes oracle_contradicted with both verdicts kept, and anything outside the oracle's scope stays self-attested.",
  },
] as const;

const FORMULA = `probability = 1 / decimalOdds
brier       = (probability - actual)²      actual = 1 win, 0 loss
void        = null (excluded from every average)

weight      = 0.5 ^ (ageDays / 90)         recency, 90-day half-life
wilsonLower = Wilson lower bound, z = 1.96, on the weighted win rate
calibration = max(0, 1 - weightedMeanBrier)

credibility = round(100 × (0.65 × wilsonLower + 0.35 × calibration))`;

const VERDICT = `resolved < 3            → reduce
credibility ≥ 55        → proceed
credibility ≥ 35        → reduce
otherwise               → avoid

then downgrade if a recalled bias pattern has ≥ 2 evidence points,
or if a paid source has a negative hit rate:

downgrade(proceed) = reduce
downgrade(reduce)  = avoid`;

const NOT_CLAIMED = [
  {
    title: "It does not verify everything",
    body: "Oracle coverage is one league (English Premier League) and match-winner markets. A pick linked to a real fixture is verified against the provider; everything else is labelled Self-attested, with the source URL the owner supplied. The boundary is stated rather than hidden.",
  },
  {
    title: "It does not erase a contradiction",
    body: "When the provider disagrees with the owner's claim, both verdicts are stored. The owner's record is not deleted, but it earns no verified credit, and only provider-confirmed outcomes count toward verifiedScore.",
  },
  {
    title: "It does not hide behind a wallet requirement",
    body: "A wallet proves the address that will receive a seller's money, and buyers sign their own payments. The server never holds a buyer or seller key. A recovery code remains the fallback if a wallet is lost.",
  },
] as const;

export default function HowItWorksPage() {
  return (
    <div>
      <section className="border-line relative overflow-hidden border-b">
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-60" />
        <div className="container-page relative py-20">
          <p className="mono text-amber text-[10px] tracking-[0.26em] uppercase">How it works</p>
          <h1 className="display mt-6 max-w-3xl text-5xl leading-[0.95] sm:text-6xl">
            A claim you can check, a memory that argues back.
          </h1>
          <p className="text-muted mt-6 max-w-2xl text-[15px] leading-relaxed">
            This page is the short version of the engineering: what each step writes, what it
            refuses, and the exact arithmetic behind the scores. For the full reasoning, the{" "}
            <Link href="/docs/implementation" className="link-underline text-amber">
              implementation reference
            </Link>{" "}
            covers every subsystem.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/dashboard" className="btn btn-primary h-11 px-6">
              Launch app <span aria-hidden="true">→</span>
            </Link>
            <Link href="/docs" className="btn h-11 px-6">
              Read the docs
            </Link>
          </div>
        </div>
      </section>

      {/* Lifecycle */}
      <section className="container-page py-20">
        <h2 className="display text-4xl">The lifecycle of one pick.</h2>
        <p className="text-muted mt-4 max-w-2xl text-[15px] leading-relaxed">
          Three states, three memory writes. Each one is a separate record, so an earlier claim
          cannot be rewritten by a later one.
        </p>

        <div className="mt-10 space-y-4">
          {LIFECYCLE.map((step, index) => (
            <article
              key={step.status}
              className="card grid gap-6 p-6 lg:grid-cols-[auto_1.1fr_1fr]"
            >
              <div className="flex items-start gap-4 lg:w-40">
                <span className="mono text-amber text-[10px] tracking-[0.2em]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="display text-2xl leading-none">{step.title}</h3>
                  <span className="badge badge-sealed mt-2">{step.status}</span>
                </div>
              </div>
              <div>
                <p className="text-paper text-[14px] leading-relaxed">{step.what}</p>
                <p className="mono text-amber/80 mt-3 text-[10px] tracking-[0.08em]">
                  writes · {step.writes}
                </p>
              </div>
              <div className="border-line space-y-2 border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
                <p className="text-muted text-[12.5px] leading-relaxed">
                  <span className="mono text-muted/70 text-[10px] tracking-[0.14em] uppercase">
                    guard ·{" "}
                  </span>
                  {step.guard}
                </p>
                <p className="text-muted text-[12.5px] leading-relaxed">
                  <span className="mono text-muted/70 text-[10px] tracking-[0.14em] uppercase">
                    why ·{" "}
                  </span>
                  {step.why}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Canonical hash */}
      <section className="border-line bg-panel/30 border-y">
        <div className="container-page grid gap-10 py-20 lg:grid-cols-[1fr_1fr]">
          <div>
            <p className="mono text-amber text-[10px] tracking-[0.24em] uppercase">
              The commitment
            </p>
            <h2 className="display mt-4 text-4xl">Why the hash has to be canonical.</h2>
            <p className="text-muted mt-4 text-[15px] leading-relaxed">
              Two JSON objects with the same fields in a different order serialise to different
              bytes. If the reveal hashed a differently-ordered payload, an honest pick would fail
              its own verification. So the serialiser is strict, and the same function runs on both
              sides of the commitment.
            </p>
            <ul className="text-muted mt-6 space-y-3 text-[13.5px] leading-relaxed">
              <li>
                <span className="mono text-amber text-[11px]">keys</span> — sorted
                lexicographically, no insignificant whitespace.
              </li>
              <li>
                <span className="mono text-amber text-[11px]">undefined</span> — dropped from
                objects, rejected in arrays, because dropping an array member silently changes its
                length.
              </li>
              <li>
                <span className="mono text-amber text-[11px]">numbers</span> — non-finite values
                throw instead of serialising as <code className="mono text-paper">null</code>.
              </li>
              <li>
                <span className="mono text-amber text-[11px]">objects</span> — class instances,
                <code className="mono text-paper"> Date</code> and{" "}
                <code className="mono text-paper">Map</code> are rejected; only plain objects are
                hashed.
              </li>
            </ul>
          </div>

          <div className="border-line bg-panel overflow-hidden rounded-xl border">
            <div className="border-line mono text-muted flex items-center justify-between border-b px-4 py-2 text-[10px] tracking-[0.18em] uppercase">
              <span>commitment</span>
              <span>lib/canonical.ts</span>
            </div>
            <pre className="overflow-x-auto p-4">
              <code className="mono text-paper/90 text-[12.5px] leading-relaxed">{`payload = {
  userId, analystId, eventRef, market,
  selection, odds, stakeUnits, committedAt
}

commitmentHash = sha256(canonicalJson(payload))

// reveal re-runs the same two lines on the
// stored payload and compares the hex digest`}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* Scoring */}
      <section className="container-page grid gap-10 py-20 lg:grid-cols-[1fr_1fr]">
        <div>
          <p className="mono text-amber text-[10px] tracking-[0.24em] uppercase">Scoring</p>
          <h2 className="display mt-4 text-4xl">Accuracy, shrunk and decayed.</h2>
          <p className="text-muted mt-4 text-[15px] leading-relaxed">
            A raw win rate rewards small samples and forgets that a lucky longshot is not skill. The
            credibility score combines a Wilson lower bound with a calibration term, weighted by
            recency.
          </p>
          <div className="border-line bg-panel mt-6 overflow-hidden rounded-xl border">
            <pre className="overflow-x-auto p-4">
              <code className="mono text-paper/90 text-[12.5px] leading-relaxed">{FORMULA}</code>
            </pre>
          </div>
          <p className="text-muted mt-4 text-[13px] leading-relaxed">
            The Wilson bound is the part that stops a 3-for-3 record from outranking a 60-for-100
            one: a small sample is pulled toward zero instead of being rewarded for being small.
          </p>
        </div>

        <div>
          <p className="mono text-amber text-[10px] tracking-[0.24em] uppercase">The verdict</p>
          <h2 className="display mt-4 text-4xl">When memory changes the answer.</h2>
          <p className="text-muted mt-4 text-[15px] leading-relaxed">
            A recommendation is not a score with a label on it. Memory is recalled first, and a
            recalled pattern can downgrade the verdict before it is shown.
          </p>
          <div className="border-line bg-panel mt-6 overflow-hidden rounded-xl border">
            <pre className="overflow-x-auto p-4">
              <code className="mono text-paper/90 text-[12.5px] leading-relaxed">{VERDICT}</code>
            </pre>
          </div>
          <p className="text-muted mt-4 text-[13px] leading-relaxed">
            When that happens the summary says so —{" "}
            <span className="text-paper">
              “Memory changed the verdict from proceed to avoid: …”
            </span>{" "}
            — rather than presenting the new answer as if it were the original one. That sentence is
            the test of whether memory is doing real work.
          </p>
        </div>
      </section>

      {/* x402 */}
      <section className="border-line bg-panel/30 border-y">
        <div className="container-page py-20">
          <div className="max-w-2xl">
            <p className="mono text-amber text-[10px] tracking-[0.24em] uppercase">Paid signals</p>
            <h2 className="display mt-4 text-4xl">Pay per call, verify before release.</h2>
            <p className="text-muted mt-4 text-[15px] leading-relaxed">
              Any journal that proves a Sui wallet can sell a signal. Publishing costs a flat
              listing fee to the platform; each sale goes straight to the seller&apos;s wallet. The
              buyer signs with their own wallet, and nothing is released until Tatum confirms the
              settlement on-chain.
            </p>
          </div>

          <div className="mt-10 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[
              {
                label: "1 · challenge",
                body: "No payment header: the endpoint answers 402 with the exact network, asset, amount and payee it accepts. A seller's own wallet is the payee.",
              },
              {
                label: "2 · sign",
                body: "The connected wallet signs an exact Sui payment. No private key ever reaches the server.",
              },
              {
                label: "3 · settle",
                body: "The facilitator settles and returns a digest. The seller does not trust the receipt alone.",
              },
              {
                label: "4 · verify",
                body: "Tatum checks status, recipient, coin type and amount. A fresh digest is retried for ~20s while the indexer catches up.",
              },
              {
                label: "5 · release",
                body: "Only then is the payload returned, together with the digest, payer and explorer link.",
              },
              {
                label: "6 · record",
                body: "payments.digest is unique, so one settlement pays for exactly one signal and one resource. A replay is a 409.",
              },
            ].map((step) => (
              <div key={step.label} className="card-flat p-5">
                <p className="mono text-amber text-[10px] tracking-[0.16em] uppercase">
                  {step.label}
                </p>
                <p className="text-muted mt-2 text-[13px] leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>

          <p className="text-muted border-line mt-8 border-t pt-6 text-[13px] leading-relaxed">
            The recorded mainnet settlement is{" "}
            <a
              href={explorerTxUrl("sui:mainnet", "DemaKkYM7Ni4mRJcxbth3e4h3BkkqgKnR1MYPdWhmgjq")}
              target="_blank"
              rel="noreferrer"
              className="link-underline mono text-amber text-[11px]"
            >
              DemaKkYM7Ni4mRJcxbth3e4h3BkkqgKnR1MYPdWhmgjq
            </a>{" "}
            — 10000 atomic USDC, paid by the buyer&apos;s own wallet, verified through Tatum before
            release.
          </p>
        </div>
      </section>

      {/* Not claimed */}
      <section className="container-page py-20">
        <div className="max-w-2xl">
          <p className="mono text-amber text-[10px] tracking-[0.24em] uppercase">
            What it does not claim
          </p>
          <h2 className="display mt-4 text-4xl">The boundary is stated, not implied.</h2>
        </div>
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {NOT_CLAIMED.map((item) => (
            <article key={item.title} className="card p-6">
              <h3 className="text-paper text-[15px] font-medium">{item.title}</h3>
              <p className="text-muted mt-3 text-[13.5px] leading-relaxed">{item.body}</p>
            </article>
          ))}
        </div>

        <div className="border-line mt-12 flex flex-col items-start justify-between gap-6 border-t pt-10 md:flex-row md:items-center">
          <p className="display max-w-xl text-3xl">
            The full reasoning, subsystem by subsystem, is in the implementation reference.
          </p>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Link href="/docs/implementation" className="btn btn-primary h-11 px-6">
              Implementation reference
            </Link>
            <Link href="/dashboard" className="btn h-11 px-6">
              Launch app
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

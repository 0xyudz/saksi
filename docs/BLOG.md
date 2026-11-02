# Saksi: a prediction journal that cannot lie, and that remembers why you were wrong

_Built for Total Recall — Tatum × Walrus Memory, Track 1: Markets & Sports Prediction._

Most prediction apps ask you to trust a number. A win rate, a leaderboard rank, a
"confidence" score. None of those numbers can be checked, and none of them tell you the one
thing that actually matters before your next bet: _where have I been wrong before, and does
this situation look like those times?_

Saksi is an attempt to build the opposite. You seal a pick before the event, so it cannot be
edited afterwards. You resolve it with a source URL, so the outcome is on the record. And
every one of those steps writes a memory to Walrus, so the next decision is made with your
own history in the room — not with a generic model's opinion of you.

This post covers what it does, how it uses Tatum and Walrus Memory, and what "learning over
time" actually means in the code.

## What it does

A pick moves through four states, and each state is a separate memory write:

1. **Seal.** You commit to a market, a selection and odds. Saksi canonicalises the payload,
   hashes it with SHA-256, and stores the hash plus the market. The selection itself is
   _not_ in this memory — only the commitment. Anyone can see you committed to something
   before the event; nobody can see what until you open it.
2. **Reveal.** You open the pick. The server re-hashes the stored payload and refuses the
   reveal if the hash no longer matches. Only now does the selection and the odds get
   written.
3. **Resolve.** You record the result and a source URL. Saksi computes a Brier score from
   the odds you took and writes the outcome, the source and the score.
4. **Recommend.** Before your next pick, Saksi recalls your memories and can _change the
   verdict_ based on them.

The hash is the part people underestimate. It proves the pick existed before the event and
was not edited afterwards. It does **not** prove the outcome is true — outcomes here are
self-attested, and the UI says so on every card, with the source URL and timestamp the owner
supplied. That distinction is deliberate. A tamper-evident record of a self-attested claim
is still useful; pretending it is an oracle would not be.

## How it uses Walrus Memory

Walrus Memory stores plain text, so the first design decision was to make every memory
machine-parseable and human-readable at the same time. One line, one format, escaped
delimiters:

```txt
saksi:v1|type=pick_commit|id=<uuid>|analyst=<uuid>|market=<text>|commitmentHash=<hash>|committedAt=<iso>
saksi:v1|type=pick_reveal|id=<uuid>|selection=<text>|odds=<decimal>|revealedAt=<iso>
saksi:v1|type=outcome|pickId=<uuid>|result=win|brier=0.274376|source=<url>|resolvedAt=<iso>
saksi:v1|type=source_roi|provider=<name>|spendAtomic=10000|correct=1|wrong=0|note=<text>
```

Every builder validates its own output before it reaches the relayer, so a malformed memory
cannot be written. Reads go through the same parser; anything that fails validation is
ignored rather than guessed at.

Two details matter more than the format:

**`rememberAndWait`, not `remember`.** A write is only recorded in Postgres after the
relayer confirms a blob ID. If the relayer is down, the pick fails to seal instead of
silently claiming a memory that does not exist.

**Recall is cited, not summarised.** When Saksi warns you about something, the warning
carries the exact blob ID and the cosine distance of the memory that produced it. You can
open `/memory`, see the blob, and decide whether the warning is fair. A recommender that
cannot show its evidence is just a second opinion.

The namespaces are per user (`saksi:<user-id>`), so memory is portable across sessions but
not shared between people.

## How it uses Tatum

Tatum is the read side of the payment story. Premium signals are sold per call through an
x402 paywall on Sui, and the seller releases the payload only after Tatum confirms the
settlement on-chain.

The verification is not "did some transaction happen". `verifyPayment` checks all of it:

- the transaction status is `success`,
- the **recipient** is the configured merchant address,
- the **coin type** matches the configured USDC type,
- the **amount** covers the signal's price,
- the digest has not already been recorded (`payments.digest` is unique),
- and the digest is bound to this one signal and this one resource, so a receipt cannot be
  replayed for a different purchase.

Tatum is used over GraphQL — `checkpoint`, `transaction`, `address.balance` — because Sui
JSON-RPC is deprecated. The same client powers the `/payments` ledger, the live balance, and
the explorer links, so there is one code path rather than two.

## The bug that taught me the most

The first real mainnet purchase succeeded and then failed, in that order.

The buyer's wallet signed a settlement of 10000 atomic USDC ($0.01). The facilitator
confirmed it. The seller then asked Tatum to verify the digest and got back
`Transaction not found.` — because Tatum indexes a fresh digest with a short delay. My retry
classifier treated "not found" as a permanent failure, so the seller returned 402 to a buyer
who had already paid.

The money was fine — 10000 atomic USDC landed at the merchant address — but the product was
broken at exactly the point that matters. A paywall that takes payment and withholds the
payload is worse than no paywall.

The fix was small: treat a missing transaction as _eventual consistency_ rather than a
verdict, and retry with backoff for roughly 20 seconds across 7 attempts. The regression test
asserts that a not-yet-indexed settlement is retryable, so the bug cannot come back quietly.

Two things I would keep from this: fail-closed is only correct if "closed" is temporary, and
a settlement digest should always remain independently verifiable through a read-only
endpoint so a buyer can recover without paying twice.

## How it learns over time

This is the part the Walrus "deepest learning loop" prize is really about, so it is worth
being concrete about the mechanism rather than gesturing at "AI memory".

### 1. Credibility that decays and shrinks

An analyst's score is not a win rate. It combines a **Wilson lower bound** on recency-weighted
wins with a **calibration** term derived from mean Brier score:

```txt
score = round(100 × (0.65 × wilsonLower + 0.35 × (1 − meanBrier)))
```

Weights decay with a 90-day half-life, so a hot streak from last season stops carrying the
board. The Wilson bound is what stops a 3-for-3 record from outranking a 60-for-100 one — a
small sample is pulled toward zero instead of being rewarded for being small.

### 2. Bias detection written to memory

When a pick resolves, Saksi looks at the analyst's resolved history and looks for repeated
losing behaviour: underdog picks (odds ≥ 2.5) that lost, favourites that lost, heavy
favourites (odds < 1.5) that lost. If a pattern has at least two pieces of evidence, it
becomes a `bias` memory with a Laplace-smoothed confidence.

The smoothing matters. Two losses out of two is not a 100% failure rate, and the memory says
so.

### 3. Source ROI, priced in

Every purchase writes a `source_roi` memory: how much was spent with that provider, and how
many of the linked picks were right or wrong. When you next ask for a recommendation, a paid
source with a negative hit rate becomes a warning, and the verdict is downgraded.

That closes a loop most "premium signal" products never close: the product remembers whether
the signals it sold you were any good.

### 4. The verdict can change

This is the visible part. `recommend()` recalls memory first, then decides:

- a recalled bias pattern with at least two evidence points downgrades `proceed` → `reduce`;
- a negative-ROI paid source downgrades the verdict again;
- a mean Brier above 0.25 raises a calibration warning;
- recalled preferences and outcomes appear in the reasons, with blob IDs attached.

The summary string says which happened. When memory changes the answer it reads
_"Memory changed the verdict from proceed to avoid: …"_ rather than quietly presenting the
new answer as if it were the original one. If you want to see whether memory is doing real
work, that sentence is the test.

## What is actually running

Everything below was produced against Sui mainnet on 2 Nov 2026, and the commands to
reproduce it are in the repo:

- **Walrus Memory** — relayer `0.1.0`, a fresh write returned blob
  `Y-TFsuMq1956BWInd8F26H62S1ohTI8hxT723DMjckE`, recalled at cosine distance
  `0.35874120150280087`.
- **Memories on mainnet** — 22 rows across `pick_commit`, `pick_reveal`, `outcome`,
  `preference`, `payment` and `source_roi`.
- **Tatum** — checkpoint `340802699`; settlement
  `DemaKkYM7Ni4mRJcxbth3e4h3BkkqgKnR1MYPdWhmgjq` verified as `success` with 2 balance
  changes.
- **x402** — one real $0.01 USDC purchase, signed by a self-custody browser wallet, verified
  through Tatum before the payload was released.

Two honest caveats. The signal behind that purchase is served by a local demo provider and
is labelled synthetic — it exists to exercise the paywall, not to claim a real forecast was
sold. And the app is not publicly deployed yet, so settlement `resource.url` values recorded
before deployment point at `localhost`.

## What I would build next

The obvious gap is that outcomes are self-attested. The next step is a resolver that reads
results from an on-chain or API source and compares them against the sealed commitment, so
the Brier score stops depending on the pick owner's honesty.

The second is aggregation: once several journals exist, "which sources were right" becomes a
question about the population, not one user's memory. Walrus Memory makes that portable in a
way a Postgres table does not.

## Repo

Code, migrations, tests and the verification scripts are in the repository linked with this
submission. `pnpm verify:memory` and `pnpm verify:tatum` reproduce the numbers above; the
README's Proof table lists every value with the command that produced it.

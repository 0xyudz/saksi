# Implementation

This document explains **how Saksi is built and why each decision was made**. It is the
deep companion to `README.md` (which is the quick overview) and `docs/INTEGRATIONS.md`
(which records the third-party contracts and the live mainnet proof).

Every statement here is backed by code in this repository. Where a behaviour is a
deliberate trade-off rather than a complete solution, it says so in the same paragraph
instead of being left for the reader to discover.

Reading order, if you have ten minutes: **1 → 3 → 4 → 6 → 7 → 8**. Those sections carry
the idea of the product. Sections 9–12 are the engineering discipline that keeps it honest.
Section 13 is the feature surface. Section 15 is the table to read if you want to know how it
behaves when something is down.

---

## 1. Stack

Everything runs on one Next.js process. There is no separate backend, no queue, no worker,
and no cache layer, because every piece of state that matters already lives in Postgres,
Walrus Memory, or Sui itself.

### Runtime dependencies

| Package                     | Version | Role in Saksi                                                                                 |
| --------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `next`                      | 16.4.3  | Routing, server components, route handlers. App Router only, no Pages Router.                 |
| `react` / `react-dom`       | 19.3.1  | Server components for every page; client components only for forms and the wallet.            |
| `@mysten-incubation/memwal` | 0.1.11  | Walrus Memory client: `rememberAndWait`, `recall`, `listMemories`, `health`.                  |
| `@mysten/dapp-kit-react`    | 2.1.43  | Browser wallet connection and transaction signing (Slush and other Sui wallets).              |
| `@mysten/sui`               | 2.38.0  | `SuiGrpcClient` for building the payment transaction, Ed25519 key derivation in `lib/env.ts`. |
| `@tentaclepay/sui-x402`     | 2.1.12  | Sui "exact" x402 scheme, server and client halves.                                            |
| `@x402/core`                | 2.28.0  | x402 protocol: facilitator client, resource server, HTTP client, payment requirements.        |
| `@x402/next`                | 2.28.0  | `x402ResourceServer`, `x402HTTPResourceServer`, `NextAdapter`.                                |
| `@x402/fetch`               | 2.28.0  | `wrapFetchWithPayment` for the browser buyer.                                                 |
| `@x402/paywall`             | 2.28.0  | Optional peer of `@x402/next`; renders the HTML paywall inside the seller's 402 challenge.    |
| `drizzle-orm`               | 0.45.4  | Typed SQL over `postgres`. Schema-as-TypeScript, no query builder abstraction beyond that.    |
| `postgres`                  | 3.4.7   | Postgres driver. Tagged-template queries, no ORM magic.                                       |
| `zod`                       | 4.6.7   | Every external boundary: env, request bodies, query params, RPC envelopes, provider payloads. |
| `pino`                      | 10.4.0  | Structured JSON logs with per-request child loggers and redaction.                            |

`@mysten/seal` (1.5.2) and `@mysten/walrus` (1.2.37) are pinned because they are peer
dependencies of `@mysten-incubation/memwal` (`seal` required, `walrus` optional). Saksi never
imports either one; the relayer uses them.

### Tooling

| Tool                                            | Role                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| TypeScript 5.9.3 (`strict`, no `any`)           | `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch` all on. |
| ESLint 9 + `eslint-config-next` 16.4.3          | `no-explicit-any`, `no-console`, `no-empty` (catch included), `eqeqeq` as errors.      |
| Prettier 3.9.10 + `prettier-plugin-tailwindcss` | Formatting, including class ordering.                                                  |
| Vitest 5.0.5                                    | Unit tests for pure functions only. 140 tests across 17 files.                         |
| `tsx` 4.20.6                                    | Runs the verification scripts without a build step.                                    |
| Drizzle Kit 0.31.11                             | Migration generation and application.                                                  |

`next.config.ts` marks `pino`, `postgres` and `@mysten-incubation/memwal` as
`serverExternalPackages` so they are not bundled by Turbopack.

---

## 2. Layering

```txt
app/          HTTP boundaries and pages. Knows about HTTP and React, nothing about SDKs.
  api/        Route handlers: validate input, call a use-case, shape the response.
server/       Product logic. Knows about Postgres and domain rules, nothing about HTTP.
  usecases/   One file per user-visible action.
  scoring/    Pure functions. No I/O at all.
  data/       SQL reads and composition.
  presenters/ Decides what a viewer is allowed to see.
integrations/ Third-party SDKs. The only place a vendor import is allowed.
db/           Drizzle schema, client, generated migrations.
lib/          Cross-cutting primitives: env, config, errors, logger, canonical JSON,
              HTTP helpers, price maths, session, recovery codes.
scripts/      Live verification against real services.
tests/        Pure-function unit tests.
```

Three rules hold this together, and they are the reason the codebase is easy to audit:

| Rule                                            | Where it holds, and where the deliberate exceptions are                                                                                                                                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server code never imports a vendor SDK directly | Every read and write goes through `integrations/`. The single exception is `lib/env.ts`, which imports `@mysten/sui`'s `Ed25519Keypair` purely to validate that `AGENT_SUI_ADDRESS` matches `X402_CLIENT_PRIVATE_KEY` at startup.                          |
| `server/scoring/*` performs no I/O              | Every file in that directory is a pure function, which is why they are the unit-tested ones.                                                                                                                                                               |
| Vendor imports are named and few                | Exhaustive list: `integrations/*` (MemWal, Tatum, x402), `lib/x402-wallet.ts` (browser buyer), `app/dapp-kit*.ts` and the two wallet components (`@mysten/dapp-kit-react`, `SuiGrpcClient`), and `lib/env.ts`. Everything else is standard library or zod. |

`lib/x402-wallet.ts` is the one vendor import that does not live under `integrations/`,
because it is browser code and must be bundled for the client — the same reason the wallet
provider lives in `app/`. It is documented as such rather than left as a surprise.

Dependencies flow one way: `app → server → integrations → lib`, with `db/` read by `server/`
and `integrations/` directly (there is no repository abstraction in front of Drizzle, on
purpose — the SQL is meant to be readable). `lib/` never imports from `app/` or `server/`.
`lib/session.ts` no longer imports `db/` at all: turning a cookie into a journal is a relayer
read, so the dependency it needs is `integrations/`.

---

## 3. Identity and sessions

This is the section most people ask about, so it is the longest.

### 3.1 The problem being solved

Saksi is not an app with "accounts". It stores a **prediction journal**: sealed picks whose
contents must stay secret until the owner opens them. Three constraints follow, and they
eliminate most conventional auth designs:

1. **No personal data is needed.** Asking for an email means collecting data the product
   does not use, plus verification, reset and delivery systems that add nothing.
2. **No operator recovery.** If an operator can restore access to a journal, the operator
   can read it, and the promise behind commit-reveal becomes false.
3. **It must work with zero installation.** A reviewer opening the link must be able to
   create a journal immediately.

What is left is a single design: **a journal is the Sui address that proved ownership of
it.** There is no account row, no password and no email. The wallet signature is the
credential, and the recovery code is the fallback for a lost wallet — not the primary key.

The first release did the opposite: a uuid row in `users`, with a handle as the unique key
and a scrypt-hashed recovery code. Section 3.8 records why that was replaced rather than
patched.

### 3.2 The recovery code

The recovery code is still 24 symbols from a 32-character alphabet, and it is still what
saves a journal when the wallet is gone. What changed is _where the lookup happens_: there is
no `users.recovery_hash` column any more.

`lib/recovery-format.ts` defines the shape:

- Alphabet: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — 32 symbols, with `I`, `O`, `0` and `1`
  removed so a code can be read aloud or retyped without ambiguity.
- Length: 24 symbols, displayed as 6 groups of 4 (`ABCD-EFGH-…`).
- Entropy: 24 × log₂(32) = **120 bits**.

`generateRecoveryCode()` in `lib/recovery-code.ts` rejection-samples `randomBytes` instead
of using `% alphabet.length`, so the mapping stays unbiased even if the alphabet is later
changed to a length that does not divide 256.

Normalisation is deliberately forgiving, because the only failure mode of this model is a
user mistyping the code. `normalizeRecoveryCode()` uppercases the input and drops every
character that is not in the alphabet, so all of these verify identically:

```txt
ABCD-EFGH-JKLM-NPQR-STUV-WXYZ
abcd efgh jklm npqr stuv wxyz
ABCDEFGHJKLMNPQRSTUVWXYZ
```

### 3.3 Storage: the code's digest names a namespace

`lib/journal-identity.ts` derives the lookup key:

```txt
recoveryLookupKey(code) = sha256(upper(trim(code)))[0..32]
namespace               = <prefix>:recovery:<that 32-hex digest>
```

The namespace _name_ is the secret, and that is safe because the code carries 120 bits. An
attacker holding the relayer's full namespace list learns 32 hex characters per code and
cannot invert them: enumerating 2¹²⁰ inputs is not a search, it is a physical impossibility.
Truncating the digest to 128 bits keeps it far beyond reach while staying a readable width.

This is what replaces the old scrypt column, and it is a strict improvement in one respect
and a trade in another:

- **Improvement:** there is no credential store to leak. A database dump contains no
  recovery material at all, because there is no database column for it.
- **Trade:** the scrypt hash used to make a _stolen_ hash expensive to attack. Here the
  digest is public by construction, so the only defence is the entropy of the code itself —
  which is 120 bits, not a human-chosen password. That is why the alphabet and length are
  fixed and not configurable.

Verification is therefore an exact-key lookup, not a similarity search: the relayer is asked
for the one namespace whose name is the digest. A wrong code names a namespace that does not
exist, and the app returns the same `401` it returns for a malformed one.

### 3.4 The session cookie

After a successful claim, wallet login or recovery, the app writes:

```txt
saksi_user = <ref>.<base64url(HMAC-SHA256(ref, SESSION_SECRET))>
```

`<ref>` is the journal's identity: a lowercase Sui address for journals created after this
change, or a uuid for journals created before it (see 3.9).

Properties:

| Property   | Value              | Why                                                                     |
| ---------- | ------------------ | ----------------------------------------------------------------------- |
| `httpOnly` | true               | JavaScript cannot read it, so an XSS bug cannot exfiltrate the session. |
| `sameSite` | `lax`              | Blocks the common cross-site form POST.                                 |
| `secure`   | true in production | Never sent over plaintext.                                              |
| `path`     | `/`                | Whole app.                                                              |
| `maxAge`   | 365 days           | A journal is meant to outlive a browser restart.                        |
| Payload    | the ref only       | No roles, no handle, no permissions baked into the token.               |

`verifySession()` splits on the **last** dot, validates the signature shape with a fixed
43-character base64url pattern, and compares with `timingSafeEqual`. A tampered signature, a
tampered ref, a legacy unsigned cookie, or the same token under a different secret all return
`null`, which the app treats as "no session".

**Authorisation is structural, not looked up.** The cookie's ref _is_ the proven address,
because a session is only ever issued after a signature over that address. There is no row to
re-read on each request: `getSessionUser()` fetches the display handle from the journal's own
wallet-keyed memory and nothing else. A cookie naming a wallet with no identity record
resolves to `null`, which is the signed-out state.

Because the ref form changed, **every session issued before this release is invalid**. That is
correct rather than unfortunate: the old cookies carried uuids that no longer identify a
signing wallet.

### 3.5 Wallet proofs

`server/wallet-auth.ts` owns the challenge. A Sui address on its own proves nothing, so the
server issues a message binding the address, the purpose (`claim` or `login`), a subject, a
nonce and an expiry; the wallet signs those exact bytes; the nonce is consumed with an atomic
compare-and-set before the Ed25519 signature is checked. A replayed nonce fails even when the
signature is valid.

`bind` is gone. A journal _is_ its wallet, so there is no separate address to attach, and the
route, the component and the purpose were deleted rather than left as dead code.

### 3.6 CSRF: two levels of origin checking

`sameSite=lax` covers most cases but not all, so there are two helpers in `lib/http.ts`:

| Helper                  | Behaviour                                                                                                   | Used by                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `assertSameOrigin()`    | If `Origin` is present it must match `APP_BASE_URL`; absent `Origin` is allowed.                            | `POST /api/signals` (an agent may call it directly). |
| `assertSessionOrigin()` | A browser **must** send `Origin` and it must match; otherwise the caller must send `x-saksi-client: agent`. | Every route that reads or writes a session cookie.   |

The stricter version closes the "no Origin means trusted" gap for cookie-authenticated
mutations, without touching the x402 agent route, which is paid for by a signature rather
than a cookie. Verified by hand: a cross-origin `POST` returns `403`.

### 3.7 Why not email and password

- Passwords add a reset flow, which is a second authentication path that must also be
  secure — and it is the weakest link in almost every breach.
- Password reuse means a breach elsewhere becomes a breach here.
- A server-side "forgot password" capability is exactly the operator recovery power that
  section 3.1 forbids.
- A generated 120-bit code is stronger than any human-chosen password and has no reuse risk.

### 3.8 Why the handle stopped being a key

The first release made the handle unique and used it to select a journal. That was a
database guarantee, and it is the one guarantee Walrus cannot provide. This section records
the measurement that forced the change, because the obvious alternative was tried first.

**The rejected design.** Key identity by handle: namespace `saksi:journal:<handle>`, with
`listNamespaces()` used to check the name was free before writing. It fails for a reason that
no amount of care fixes:

1. `listNamespaces()` followed by a write is **check-then-write, not atomic**. Two people
   claiming one handle at the same moment both observe it free and both write.
2. Because the namespace is derived from the handle, those two writes land in the **same
   namespace**. Their memories merge. That is not a duplicate name — it is two journals
   silently becoming one, which corrupts both track records.
3. `recall()` is a similarity search, not a key lookup. Asking for "wallet 0xe47cc1da…" can
   return a neighbouring journal with a small distance. For authentication, "close enough"
   is the same as wrong.

**What was adopted instead.** The identity is the wallet address, and the handle is a display
name:

| Concern           | Guarantee                                                                        |
| ----------------- | -------------------------------------------------------------------------------- |
| Wallet uniqueness | Enforced by a read before the write, not by the store. See the correction below. |
| Handle uniqueness | **Given up on purpose.** Two journals may show the same handle.                  |
| Login lookup      | Exact-key: `saksi:wallet:<address>` holds the identity record.                   |
| Recovery lookup   | Exact-key: `saksi:recovery:<sha256(code)>` holds the journal pointer.            |

Giving up handle uniqueness is the deliberate part. A handle authorises nothing now, so a
duplicate is cosmetic — two people both calling themselves `@saksi_dev` is a display problem.
A race that merges two journals is a data-integrity problem. Trading the first for the
second is the right direction, and the code says so where it matters.

**Correction: wallet uniqueness is not free.** The first version of this section claimed that
"the wallet _is_ the ref, so two journals cannot share one without sharing a private key".
That is true of the _name_ and false of the _store_: nothing stopped the same wallet from
being claimed twice. `claimJournal()` wrote a second identity record with the same wallet and
a new ref, `readJournalRecord()` returned whichever record the relayer ranked first, and
because the ref decides the namespace, one journal's history ended up split across
`saksi:<uuid>` and `saksi:<wallet>`.

It happened in this project's own live data: wallet `0xe47cc1da…` held two records
(`1240e27d-…` as `@saksi_dev`, then `0xe47cc1da…` as `@saksi_demo`), with `payment` and
`source_roi` memories in one namespace and `journal` and `preference` in the other.

Two changes fix it, and the asymmetry between them is the interesting part:

- **`claimJournal()` now refuses a wallet that already has an identity record** (`409`). This
  is a check-then-write, which section 3.8 argued is unsafe. It is safe here for a specific
  reason: the wallet is the key, so the only two writers that can race hold the same private
  key — that is one user, not two. A lost race produces a duplicate record for the same ref,
  which is harmless. What a lost race can never produce is two _different_ refs, because the
  ref is derived from the wallet, not from user input.
- **`readJournalRecord()` is deterministic.** It resolves to the oldest record
  (`oldestJournalRecord()` in `lib/journal-identity.ts`, unit tested), so a wallet that already
  has duplicates keeps one stable ref instead of flipping between namespaces per request.

The lesson is worth keeping: "the key is unique" and "the store enforces uniqueness" are
different claims, and only the second one survives a retry.

**What it cost.** `/onboarding` no longer checks whether a name is taken, and the UI says so
explicitly instead of implying a claim. `GET /api/session` cannot warn about a lost recovery
code any more, because `hasRecovery` is now a property of a pointer that is either written at
creation or not; journals created by this code always write one.

### 3.9 Legacy journals and the append-only problem

Walrus is append-only, so the 40 memories written before this change cannot be moved. They
live in `saksi:<uuid>`. Rewriting them would duplicate every record and leave the originals
in place anyway.

So the ref kept its old form for old journals:

- `lib/journal-identity.ts` accepts **either** a lowercase 64-hex Sui address **or** a uuid.
  `isWalletRef`, `isLegacyRef` and `isJournalRef` make the distinction explicit.
- A journal's data stays in `saksi:<ref>`, whatever form its ref has.
- Only the _identity lookup_ moved to `saksi:wallet:<address>`, which is why login works for
  old journals without touching their history.

`picks.journal_ref`, `signals.seller_ref` and `payments.journal_ref` therefore hold a mix of
addresses and uuids, and the code treats both as opaque. `PickPayload.userId` is deliberately
**not** renamed: it is inside the hashed payload, so renaming it would change the canonical
JSON and invalidate every commitment already sealed. `server/scoring/commitment.ts` documents
this at the field.

Three journals have no wallet at all (`saksi_demo`, `demo_buyer`, `testdemo`). They cannot
sign in and cannot sell, because there is no address to prove. Their memories stay readable
at `/journals/<uuid>`, which is the honest outcome: they are history, not identities.

The operator CLI still exists for a journal whose recovery pointer was never written:

```bash
pnpm recovery:issue <wallet> <out-file>
```

It writes the code to a file with mode `0600` rather than stdout (so it never lands in a
terminal transcript or CI log), and prints a reminder to move it into a password manager.
There is deliberately **no HTTP endpoint** for this, because any endpoint that mints a code
for a wallet is an account takeover primitive.

### 3.10 Known limits of this model

- The cookie has no rotation and no revocation list. A leaked `SESSION_SECRET` forges any
  session. Acceptable for a hackathon; not acceptable for production.
- Losing both the wallet and the code loses the journal. Sealed picks stay sealed forever.
  This is a direct consequence of decision 3.1, and it is what makes "nobody can peek"
  credible.
- Handles are not unique, so `@name` is not an address. The journal URL is the ref, and the
  UI falls back to a truncated address when a handle cannot be read.
- Reading a handle costs a relayer call. Measured 0.4–6 s per wallet lookup, which is why
  pages that list many picks resolve handles once and concurrently, and why the leaderboard
  still reads Postgres (section 6).
- The `PATCH /api/session` rate limit (10/min) lives in process memory, so it does not span
  serverless instances.

---

## 4. Sealed picks

### 4.1 Canonical JSON

Hashing is only meaningful if two callers agree on the exact bytes. `lib/canonical.ts`
implements a strict serialiser:

- Object keys sorted lexicographically.
- No insignificant whitespace.
- `undefined` object members dropped; `undefined` **array** members rejected (dropping them
  would silently change array length).
- Non-finite numbers, functions, symbols, `bigint` and non-plain objects (class instances,
  `Date`, `Map`) all throw.

```ts
commitmentHash(payload) === sha256Hex(canonicalJson(payload));
```

`lib/canonical.ts` is unit-tested against the standard SHA-256 test vectors, and for
stability across key insertion order.

### 4.2 What is committed

`server/scoring/commitment.ts` builds the payload that gets hashed:

```ts
{
  (userId, analystId, eventRef, market, selection, odds, stakeUnits, committedAt);
}
```

`committedAt` is server time (`nowIso()`), never client time, so the timestamp in the hash is
not attacker-controlled. `odds` must be finite and `> 1`; `stakeUnits` must be a positive
integer.

### 4.3 Lifecycle

```txt
sealed ──reveal──▶ revealed ──resolve──▶ resolved
   │
   └────────resolve (void)──▶ void
```

| Transition | Guard                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------- |
| reveal     | Owner only. Hash must still match the stored payload. `revealAt` must be in the past if set.        |
| reveal     | Idempotent: revealing an already-revealed or resolved pick returns the current row.                 |
| resolve    | Owner only. Pick must not be `sealed`. Hash re-verified. `resolvedAt` cannot precede `committedAt`. |
| resolve    | `outcomes.pickId` is unique, so a second resolution is a `409`, not a silent overwrite.             |

Verified by hand: reveal on a time-locked pick → `409`; resolve before reveal → `409`;
revealing someone else's pick → `403`.

### 4.4 Redaction

`server/presenters/pick.ts` is the single place that decides what a viewer may see. It is
called by every page and every route that returns a pick, so the rule cannot drift.

| Field            | Sealed + not owner | Sealed + owner | Revealed |
| ---------------- | ------------------ | -------------- | -------- |
| `eventRef`       | `null`             | value          | value    |
| `market`         | `null`             | value          | value    |
| `selection`      | `null`             | value          | value    |
| `odds`           | `null`             | value          | value    |
| `stakeUnits`     | `null`             | value          | value    |
| `commitmentHash` | value              | value          | value    |
| `committedAt`    | value              | value          | value    |

The hash and timestamp stay public, because they are exactly what makes the claim checkable.

The presenter also computes `canReveal`, `canResolve` and `revealBlockedReason`, so the UI
never has to re-derive permission rules in a component.

---

## 5. Scoring

Everything in `server/scoring/` is a pure function with no I/O, which is why it is the part
covered by unit tests.

### 5.1 Brier score

```ts
probability = 1 / decimalOdds;
brier       = (probability - actual)², where actual = 1 for a win and 0 for a loss;
brier       = null for a void.
```

`server/scoring/brier.ts` also exports `calibrationBins()`, which buckets resolved picks into
deciles and reports predicted vs observed per bin, so overconfidence is visible instead of
being averaged away. A probability of exactly `1.0` is clamped into the last bin.

### 5.2 Credibility

`server/scoring/credibility.ts` answers: _how much should a 4-pick analyst be trusted?_

1. **Recency weighting** — each resolved sample is weighted `0.5^(ageDays / 90)`, so a
   90-day-old streak counts half as much as today's. `CREDIBILITY_HALF_LIFE_DAYS = 90`.
2. **Wilson lower bound** (`z = 1.96`) on the weighted win rate. This is the key defence: a
   2–0 record has a high win rate but a very low lower bound, so small samples cannot top the
   leaderboard.
3. **Calibration** = `max(0, 1 − weightedMeanBrier)`.
4. **Score** = `round(100 × (0.65 × wilsonLower + 0.35 × calibration))`.

Accuracy dominates, calibration prevents lucky high-odds runs from winning. Zero resolved
samples → score `0`, not `null`, so sorting stays total.

### 5.3 Bias detection

`server/scoring/bias.ts` looks for repeated losing behaviour in three patterns:

| Pattern        | Condition                                                          |
| -------------- | ------------------------------------------------------------------ |
| underdog       | odds ≥ `2.5`, at least 2 such samples, and at least 2 of them lost |
| favourite      | odds < `2.5`, at least 2 such samples, and at least 2 of them lost |
| overconfidence | odds < `1.5`, at least 2 such samples, and at least 2 of them lost |

Confidence is Laplace-smoothed: `(losses + 1) / (sample + 2)`. This keeps a 1-of-1 sample
from shouting `1.0`. Void samples are excluded from every denominator. Patterns are sorted by
confidence, and only the strongest one is written to memory per resolution — a journal should
not be flooded with near-duplicate warnings.

### 5.4 Source ROI

`server/data/payments.ts` joins `payments → signals` and `payments → picks → outcomes` to
compute, per provider:

```txt
spendAtomic = sum of amounts paid to that provider
correct     = linked picks that won
wrong       = linked picks that lost
roi         = (correct − wrong) / (correct + wrong), or 0 when nothing resolved yet
```

This is the only place where money and accuracy meet: _did the data I paid for actually help?_

### 5.5 How a verdict is produced

`server/usecases/recommend.ts`, in order:

1. Build a recall query from market, selection, odds, underdog/favourite and the words
   `analyst bias credibility source roi`.
2. Recall Walrus Memory for the user's namespace (`sort: "relevance"`).
3. Filter hits by kind and by whether they actually apply (a bias memory must match the
   analyst id; an underdog bias only applies when the new pick is also an underdog).
4. Base verdict from credibility: `resolved < 3 → reduce`, `score ≥ 55 → proceed`,
   `score ≥ 35 → reduce`, otherwise `avoid`.
5. **Downgrade** if a recalled bias pattern has `evidence ≥ 2`, or if a paid source has a
   negative hit rate. `downgrade(proceed) = reduce`, `downgrade(reduce) = avoid`.
6. Confidence = `clamp(0.35 + score/200 − 0.05 × warnings, 0.05, 0.95)`.
7. Persist the response **and** the cited blob ids in `recommendations`.

Every warning carries `memory: { blobId, text, distance }` or `null` when it came from
Postgres rather than Walrus. The UI renders the citation, never a computed score alone. The
summary line states plainly when memory changed the verdict:
`Memory changed the verdict from reduce to avoid: …`.

---

## 6. Walrus Memory

### 6.1 Client

One `MemWal` instance per process, created lazily in
`integrations/walrus-memory/client.ts`:

```ts
MemWal.create({ key, accountId, serverUrl, namespace: prefix });
```

### 6.2 Namespace

```txt
${WALRUS_MEMORY_NAMESPACE_PREFIX}:${userId}
```

Per-journal isolation is done by namespace, not by filtering after recall. One journal cannot
recall another journal's memories even if it asks for them.

### 6.3 The `saksi:v1` text format

Walrus Memory stores plain text, so Saksi defines a deterministic single-line record:

```txt
saksi:v1|type=<kind>|key=value|key=value|…
```

Eight kinds, each validated by a `z.strictObject` (unknown keys are rejected):

| Kind          | Fields                                           | Written when                      |
| ------------- | ------------------------------------------------ | --------------------------------- |
| `pick_commit` | id, analyst, market, commitmentHash, committedAt | sealing a pick                    |
| `pick_reveal` | id, selection, odds, revealedAt                  | revealing a pick                  |
| `outcome`     | pickId, result, brier?, source, resolvedAt       | resolving a pick                  |
| `bias`        | analyst, pattern, evidence, confidence           | resolution, when a pattern exists |
| `source_roi`  | provider, spendAtomic, correct, wrong, note?     | purchase and resolution           |
| `preference`  | userId (a journal ref), statement                | user teaches the journal          |
| `payment`     | digest, provider, amountAtomic, network          | a verified purchase               |
| `pick`        | legacy, read-only                                | never (kept for old fixtures)     |

The commit/reveal split is deliberate: the sealed memory contains the **market, hash and
timestamp only** — never the selection or the odds. Writing the selection into the sealed
memory would publish the secret to a permanent store before the event. A unit test asserts
exactly this (`never writes selection or odds into the sealed commit memory`).

### 6.4 Escaping and validation

Values escape `%` → `%25`, `|` → `%7C`, and newlines/CR → space. Without this, a value
containing `|` could forge a second field.

Every builder runs `assemble()`, which **re-parses its own output** before returning. A
malformed record cannot reach the relayer, because a bug in a builder fails locally instead of
writing garbage to a store that cannot be deleted from.

That guard caught a real regression, and it is worth recording because the guard is what
turned a silent corruption into a loud failure. When identity moved to the wallet, the
`preference` schema still required `userId` to be a uuid. A wallet journal therefore built a
record that its own parser rejected, `assemble()` threw, and `POST /api/memory/preferences`
returned `500` for **every** journal created after migration `0007`. No test caught it: the
fixture was a uuid, so the wallet path was never exercised. The schema now accepts either a
normalised Sui address or a uuid, and three tests cover both forms plus the rejection case.

The lesson is narrower than "write more tests": a ref is opaque, and any validator that
narrows it to one representation becomes wrong the moment a second representation is legal.

### 6.5 Write policy: which failures are fatal

This is the most important behaviour to understand, because Walrus is a remote service that
can be slow or unavailable.

| Operation         | If the memory write fails                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Seal a pick       | **Fatal.** The Postgres row is deleted and the API returns `502`. A commitment that is not in memory is not a commitment. |
| Resolve a pick    | **Fatal.** The outcome insert and the pick status update are rolled back, then `502`.                                     |
| Reveal a pick     | Non-fatal. The hash and DB status remain authoritative; the failure is logged.                                            |
| Bias memory       | Non-fatal. The verified outcome stays.                                                                                    |
| Source-ROI memory | Non-fatal.                                                                                                                |
| Payment memory    | Non-fatal. The on-chain payment is real regardless.                                                                       |
| Preference        | Fatal to that request only (`500`); nothing else depends on it.                                                           |

The asymmetry is intentional: a _claim_ must never exist without its memory, but a
_supplementary observation_ about a claim that already exists must not be able to destroy it.

### 6.6 Recall and citations

`recall()` returns `{ blob_id, text, distance, created_at }`. Each hit is parsed with
`parseMemory()`; a hit whose text is not a valid Saksi record keeps its citation but gets
`memory: null`, so it can be shown but never used as a rule. Nothing is silently dropped.

### 6.7 `listMemories()` and the truncation flag

`/memory` counts what the relayer returns, not what Postgres thinks it wrote. The client
pages through `listMemories()` with a **50-page safety cap** and returns three separate facts:

- `fetched` — how many were actually read.
- `hasMore` — whether the relayer had another page after the last one read.
- `truncated` — whether the cap stopped a namespace that still had more.

The UI therefore says "at least N" when truncated, instead of claiming a namespace total it
cannot know.

### 6.8 No audit table

There is deliberately no `memory_writes` table. It used to record `kind`, `blobId`, `jobId`
and `namespace` for every write, which made Walrus look like a cache of Postgres and
duplicated a blob id the relayer already returns. `remember()` now returns the blob id as
the receipt and writes nothing locally, so the memory is the only record of itself.

`pnpm verify:reconstruct` proves this is safe rather than merely tidy: it rebuilds every
journal's credibility and bias numbers from the relayer alone and compares them to what
Postgres computes. See §11.1.

---

## 7. Tatum

### 7.1 Why GraphQL

Tatum's Sui gateway no longer serves the JSON-RPC methods this app originally used
(`sui_getTransactionBlock`, `suix_getBalance`, `suix_queryEvents` now return `404`). The
supported interfaces are GraphQL (`/graphql`) and gRPC. Saksi uses GraphQL for every read,
including the ones that only need a single field.

### 7.2 The typed client

`integrations/tatum/client.ts` is a small purpose-built client rather than a generic SDK:

- `POST` to `TATUM_SUI_RPC_URL` with header `x-api-key`.
- Body `{ query, variables }`, 15 s timeout per attempt via `AbortSignal.timeout`.
- **Slot allocator**: `MIN_REQUEST_INTERVAL_MS = 350` keeps traffic at ~2.8 req/s, because
  the free tier rejects more than three per second. Concurrent callers reserve slots instead
  of firing in parallel, so a burst from the UI cannot trip the limit.
- **Retries**: 3 attempts, exponential backoff with jitter, only for HTTP `429`/`5xx` and
  network failures. A GraphQL semantic error or a schema mismatch is **not** retried — it is
  deterministic.
- **Zod on every envelope**: `graphQlEnvelopeSchema` first, then the specific response schema.
  An unexpected payload becomes `UPSTREAM_UNAVAILABLE` rather than a `TypeError` deep in
  product code.
- **Balance-change pagination**: GraphQL caps a connection page at 50 nodes, so
  `getTransactionBlock()` follows `pageInfo.hasNextPage` for up to 10 pages. A batched
  transaction cannot hide a larger transfer behind page one.

### 7.3 Payment verification

`integrations/tatum/verify-payment.ts` accepts a digest and trusts **nothing** from the x402
facilitator receipt:

1. Validate the digest shape (`/^[1-9A-HJ-NP-Za-km-z]{43,44}$/`).
2. Reject a network that differs from `SUI_NETWORK`.
3. Fetch the transaction with effects, events and balance changes.
4. Require the returned digest to equal the requested one.
5. Require mapped status `success` (GraphQL `SUCCESS`).
6. Read the sender as `payer`.
7. Sum **positive** balance changes whose owner is `X402_PAY_TO_ADDRESS` and whose coin type
   normalises to `SUI_USDC_COIN_TYPE`.
8. Reject if the sum is below the signal price.
9. Persist the raw response plus `verifiedAt` and the coin type used.

If Tatum is unreachable, the signal is refused. There is no cached or fabricated success path
anywhere in this file.

### 7.4 Normalisation helpers

Two small functions prevent a whole class of false negatives:

- `lib/coin-type.ts` — Sui coin types are case-insensitive and their address parts may omit
  leading zeroes (`0x2` vs the full 32-byte form). `normalizeCoinType()` lowercases and
  zero-pads to 64 hex characters before comparing.
- `addressOfOwner()` in `verify-payment.ts` — handles `AddressOwner`, `ObjectOwner` and
  `Immutable` shapes instead of assuming one.

### 7.5 Network caveat

Both Tatum interfaces for Sui are mainnet-only (`sui-mainnet-graphql`,
`sui-mainnet-grpc`). A testnet deployment would need a gRPC client this repository does not
implement. Startup therefore refuses a `TATUM_SUI_RPC_URL` whose host does not contain the
network named by `SUI_NETWORK`, so a silent network mismatch is impossible.

---

## 8. x402 on Sui

### 8.1 The seller

`GET /api/signals/[id]` is the paid resource. `integrations/x402/seller.ts` wires:

```txt
HTTPFacilitatorClient  → X402_FACILITATOR_URL
x402ResourceServer     → .register(SUI_NETWORK, SuiSchemeServerAdapter(ExactSuiScheme))
x402HTTPResourceServer → route table for "GET /api/signals/[id]"
NextAdapter            → bridges a NextRequest into the protocol
```

The server instance is created once and cached in a promise, so a failed initialisation is
not retried on every request but does produce a clear `UPSTREAM_UNAVAILABLE` when the
facilitator is unreachable.

### 8.2 The adapter bridge

`@tentaclepay/sui-x402` was built against an older `@x402/core` interface. `SuiSchemeServerAdapter`
delegates `parsePrice()` and `enhancePaymentRequirements()` to the real `ExactSuiScheme`,
declares the `authorization` payment flow, reports `USDC_DECIMALS`, and exposes the newer
`SchemeNetworkServer` surface.

This is required because Saksi **settles first and releases data only after its own Tatum
verification**. The generic `paymentMiddleware` helper would return the handler result as soon
as settlement succeeded, which is exactly the gate this product cannot skip.

### 8.3 The flow

```txt
client GET /api/signals/:id
  → validate signal id, load signal, assert stored price == configured price
  → validate optional pickId ownership (before any money moves)
  → no payment header: 402 + accepts
  → x402 client signs an exact Sui payment with the user's own wallet
  → seller verifies + settles through the facilitator
  → seller receives the digest
  → seller verifies the digest through Tatum (with retry, see 8.6)
  → only then returns the provider payload
  → seller records the settlement (userId nullable, pickId optional)
```

Two ordering decisions matter:

- The signal and its price are loaded **before** settlement, so an unknown or stale listing
  cannot take the buyer's money first.
- `pickId` ownership is validated **before** settlement, so a foreign pick id cannot produce a
  paid-but-rejected request.

### 8.4 Price normalisation

`X402_PRICE` and `X402_LISTING_FEE` accept either `$0.01` (human USD) or `10000` (atomic
units). The x402 scheme only understands USD strings, so the seller normalises through
`parsePriceToAtomic()` before advertising requirements:

```ts
price: formatUsd(parsePriceToAtomic(env.X402_PRICE));
```

Without this, `10000` would be advertised as **$10,000**. `parsePriceToAtomic()` uses string
manipulation and `BigInt`, never floating point, and rejects more decimal places than
`USDC_DECIMALS` allows.

Note: Next.js expands a literal `$0` in `.env.local`, which is why the atomic form is the
portable choice there.

### 8.5 Receipt binding rules

`server/scoring/payment-binding.ts` is pure and unit-tested. Three rules:

| Rule                     | Effect                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| One digest, one signal   | Re-using a digest for a different signal → `409`.                                                                    |
| One digest, one resource | Comparing normalised URLs (host lowercased, query and fragment dropped, trailing slash removed) → `409` on mismatch. |

The advertised price comes from the signal row itself, so there is no configured price that
can drift from a stored one. `server/scoring/payment-binding.ts` therefore no longer needs a
stale-price rule; the row is the single source of truth for both the challenge and the
verification floor.

Legacy rows with `resource === null` remain valid as long as the signal id matches, so
pre-deploy records are not invalidated.

### 8.6 Indexer lag: the bug that mattered most

Tatum indexes a freshly settled digest with a delay. Treating "Transaction not found." as
permanent meant a buyer who had already paid received `402` and never saw the payload.

The fix is a classification split (`isRetryablePaymentError`) plus a retry loop
(`verifyPaymentWithRetry`):

- Retryable: `UPSTREAM_UNAVAILABLE` or `PAYMENT_NOT_VERIFIED` **and** the error is marked
  `retryable`.
- Budget: 7 attempts, 750 ms base delay, 5 s ceiling, ≈ 20 s total.
- `Transaction not found.` is raised as `PAYMENT_NOT_VERIFIED` with `retryable: true`.
- Validation errors, network mismatches and insufficient payments are never retried, because
  retrying them only delays a certain answer.

Past the budget, the last error is returned and the digest can be re-checked through
`POST /api/payments/verify` **without paying again**.

### 8.7 The buyer: self-custody

`lib/x402-wallet.ts` runs entirely in the browser. The private key never reaches the server.

1. Read the 402 challenge to learn which asset the seller accepts. `@x402/core` rejects any
   non-default asset unless it is listed in `spendControls.allowedAssets`, and Sui USDC is not
   a default asset — so the challenge is read first and exactly that network, asset and amount
   are allowed.
2. Build `x402Client.fromConfig()` with `ExactSuiScheme(signer)`.
3. `wrapFetchWithPayment(fetch, client)` retries the request with the signed payment.
4. Read the settle receipt with `getPaymentSettleResponse()`.
5. Parse the body with a strict zod schema; reject a successful-looking receipt without a
   digest.

`components/forms/PurchaseSignalPanel.tsx` supplies the signer: it takes the connected
account's address and routes `signTransaction` through `dAppKit.signTransaction({ network:
"mainnet" })`. The payee is read from the signal row: a seller's own wallet for a listed
signal, or `X402_PAY_TO_ADDRESS` for the older catalogue rows.

`integrations/x402/buyer.ts` keeps the same flow for `pnpm verify:x402`, reading
`X402_CLIENT_PRIVATE_KEY` from the environment and re-verifying the digest through Tatum even
though the seller already did — that protects the buyer from a malicious seller response.

### 8.8 Idempotency and attribution

`payments.digest` is unique. `recordPayment()` inserts with `onConflictDoNothing`, then reads
the existing row and applies the binding rules. If an external settlement was recorded first
(the agent path, `journal_ref` null) and a journal later claims it, the row is updated once
with `where journal_ref is null` so the claim is not repeatable — and only that transition
writes the payment and source-ROI memories.

---

## 9. The HTTP boundary

Every route handler goes through `handleRoute()` in `lib/http.ts`, so no route can forget the
basics.

| Concern       | Implementation                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| Request id    | `x-request-id` if it matches `^[A-Za-z0-9_-]{8,64}$`, otherwise a fresh UUID. Echoed on the response.            |
| Logging       | One `info` line on success with method, path, status, duration; one `error` line on failure with code and cause. |
| Errors        | `AppError` carries a typed code and an HTTP status; `toAppError()` converts anything else.                       |
| Response body | `{ error: { code, message, requestId, details? } }` — never a stack trace.                                       |
| Cache         | `cache-control: no-store` on every JSON response.                                                                |

### Error codes

| Code                   | HTTP | Typical cause                                                                         |
| ---------------------- | ---- | ------------------------------------------------------------------------------------- |
| `VALIDATION_FAILED`    | 400  | zod rejected a body, query, id or price.                                              |
| `UNAUTHORIZED`         | 401  | No session, or handle + code do not match.                                            |
| `FORBIDDEN`            | 403  | Not the owner, no proven wallet, or cross-origin.                                     |
| `NOT_FOUND`            | 404  | Missing pick, analyst or signal.                                                      |
| `CONFLICT`             | 409  | Duplicate handle, already resolved, time-locked, wallet already bound, digest reused. |
| `PAYMENT_REQUIRED`     | 402  | x402 challenge.                                                                       |
| `PAYMENT_NOT_VERIFIED` | 402  | Tatum rejected or has not indexed the settlement yet.                                 |
| `RATE_LIMITED`         | 429  | Per-IP limiter.                                                                       |
| `UPSTREAM_UNAVAILABLE` | 502  | Walrus, Tatum or provider failure.                                                    |
| `SERVICE_UNAVAILABLE`  | 503  | Feature not configured (e.g. provider env missing).                                   |
| `CONFIGURATION_ERROR`  | 500  | Invalid environment.                                                                  |
| `INTERNAL`             | 500  | Anything unexpected.                                                                  |

### Rate limits

| Route                       | Limit       | Scope  |
| --------------------------- | ----------- | ------ |
| `PATCH /api/session`        | 10 / minute | per IP |
| `POST /api/signals`         | 10 / minute | per IP |
| `GET /api/signals/[id]`     | 30 / minute | per IP |
| `POST /api/payments/verify` | 10 / minute | per IP |

The limiter is in-memory and per instance, with a 10,000-key pruning cap. It exists to blunt
accidental or opportunistic floods without adding Redis. It is explicitly **not** a
replacement for an edge limiter, and the README says so.

### Logging redaction

`lib/logger.ts` redacts `authorization`, `cookie`, `x-api-key`, `*.privateKey`, `*.apiKey`,
`*.secret`, `*.authorization`, `*.signature` and `raw`. That last one matters: `raw` holds the
full Tatum transaction payload, which is stored in Postgres but must never be dumped to a log.

### Id-shape validation

`lib/ids.ts` exposes `isUuid()`. Every detail page validates the route param **before**
querying Postgres, because Postgres rejects a non-UUID with a type error that surfaces as a
`500` instead of "not found".

Verified by hand: `/picks/not-a-uuid`, a well-formed but non-existent UUID,
`/analysts/not-a-uuid` and `/signals/not-a-uuid` all return a real `404` with no
`Failed query` in the response.

`server/usecases/recommend.ts` applies the same principle to foreign keys: `analystId` and
`pickId` are checked for existence and ownership **up front**, so a stale analyst or someone
else's pick returns `404` instead of a foreign-key `500`.

---

## 10. Rendering and the wallet provider

Every page is a server component. That is not a stylistic choice: the proof is in the HTML,
and a client-rendered shell would mean a crawler or a reviewer sees nothing until JavaScript
runs.

The surface is split with route groups, which do not add URL segments:

- `app/(marketing)` owns `/`, `/how-it-works`, `/docs` and `/docs/[slug]`. It renders its own
  navigation and footer and reads neither the session nor the database, so the whole
  marketing surface prerenders as static HTML (`○` and `●` in the build output).
- `app/(app)` owns `/dashboard` and the journal routes, with the product nav, the wallet
  button and the footer.
- `app/layout.tsx` owns only `<html>`, `<body>` and `Providers`.

The wallet provider nearly broke this, and the story is worth recording.

**The bug:** `app/providers.tsx` mounted `DAppKitProvider` through
`next/dynamic({ ssr: false })`. Because that call sits in the root layout, Next.js bailed out
of server rendering for **every** route. Symptoms:

- The HTML response was an empty shell
  (`Switched to client rendering because a component requested it`).
- Not-found pages answered **`200`** instead of `404`.
- The publish form never reached the HTML, so it appeared only after hydration.

**The fix:** `createDAppKit` defers wallet discovery to `onMount` and falls back to in-memory
storage when `localStorage` is unavailable, so it is SSR-safe. The provider is now imported
normally, and the only browser-only piece is the Slush initializer:

```ts
const SLUSH_CONFIG = typeof window === "undefined" ? null : { appName: APP_NAME };
```

That initializer reads `document.title` and fetches wallet metadata, neither of which exists on
the server.

**Verified after the fix**, in both `pnpm dev` and `pnpm start`: `/dashboard`, `/picks`,
`/signals`, `/analysts`, `/payments`, `/onboarding` and `/resume` all return `200` with
server-rendered markup, and the invalid-id URLs plus `/nope` return a real `404` with no
failed query. The marketing pages (`/`, `/how-it-works`, `/docs`, `/docs/[slug]`) return
`200` with no `Switched to client rendering` bailout anywhere in the HTML.

The lesson generalises: a `ssr: false` dynamic import at the root layout is not a local
optimisation, it is a decision about the whole app.

---

## 11. Data model

Seven tables, seven migrations (`0000`–`0007`). There is no `users` table: a journal is the
wallet that proved ownership of it, so identity has no row.

```txt
analysts ── picks ── outcomes
              │
              └── payments ── signals

wallet_challenges   (single-use nonces)
recommendations     (pick_id nullable, cited_memory_ids jsonb)
```

| Table               | Purpose                      | Key constraints                                                                                                   |
| ------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `analysts`          | who is being tracked         | `(name, kind)` unique; **global**, not owned by a journal                                                         |
| `picks`             | a sealed commitment          | `journal_ref` text (no FK: there is no journal table); `analyst_id` restrict; indexes on journal, analyst, status |
| `outcomes`          | the resolution               | `pick_id` unique, cascade delete                                                                                  |
| `signals`           | a purchasable signal listing | `(provider, external_ref)` unique; `listing_fee_digest` unique so one fee = one listing                           |
| `payments`          | a verified settlement        | `digest` unique; `journal_ref` and `pick_id` `set null` on delete; index on payer                                 |
| `wallet_challenges` | a single-use nonce           | `nonce` unique; consumed once, so a signature cannot be replayed                                                  |
| `recommendations`   | a persisted verdict          | index on `created_at`; `pick_id` `set null` on delete                                                             |

Three design notes:

- **`journal_ref` is not a foreign key, and that is the point.** The referenced identity is a
  wallet address, and an address needs no row to exist. It holds a lowercase Sui address for
  journals created after migration `0007`, and a uuid for those created before, because their
  memories already live in `saksi:<uuid>` (section 3.9).
- **Analysts are global.** A pick references an analyst, not "my analyst", so credibility is
  comparable across journals. The trade-off is that deleting a journal leaves its analysts
  behind; cleanup is a documented SQL statement rather than a cascade, because cascading would
  silently delete another journal's history.
- **`payments.journal_ref` is nullable on purpose.** The agent purchase path records a
  settlement before any journal claims it; that row can be claimed later by digest.

### 11.1 Rebuilding from Walrus, and what it costs

`server/scoring/reconstruct.ts` joins a `pick_commit` memory to its `outcome` memory on the
pick id inside the text, then feeds the result to the same `credibilityBreakdown()` and
`detectBias()` the SQL path uses. Nothing in it reads Postgres.

Measured on the production relayer, 21 namespaces holding 73 memories:

| Operation                          | Time           |
| ---------------------------------- | -------------- |
| `listNamespaces()`                 | ~2.4 s         |
| one `recall()` per namespace       | 0.9–4.8 s each |
| sequential walk of every namespace | 25.8 s         |
| parallel walk, 8 at a time         | 4.7 s          |
| wallet → handle identity lookup    | 0.4–6 s        |

Three consequences, all deliberate:

1. **Per-journal reconstruction is cheap; global reconstruction is not.** `/journals/<ns>`
   reads a single namespace (~1.3 s) and is safe to serve. Rebuilding every analyst's
   credibility across all journals needs the whole walk, so `leaderboard()` still reads
   Postgres. Serving a 4.7 s relayer walk on every page view would be worse for users than
   the thing it demonstrates.
2. **`recall()` is capped at 100 results.** A namespace past that limit would reconstruct
   from a prefix of its history. `ReconstructedJournal.possiblyTruncated` reports when the
   cap was hit so the UI can say so instead of implying completeness.
3. **A handle is a relayer read, so it is resolved once and concurrently.** `readJournalHandles()`
   de-duplicates refs and runs them in parallel; a page that lists fifty picks makes at most
   fifty small reads rather than fifty sequential ones, and an unreadable handle degrades to
   a truncated address instead of failing the page.

`pnpm verify:reconstruct` compares the two paths per analyst and reports `mismatches`. It
discovers journals from `picks.journal_ref`, since there is no `users` table to enumerate.
Last run: **0 mismatches**. It is the evidence for the claim in §6.8, and it exits non-zero
when the two disagree.

### 11.2 Seeding the learning loop, honestly

The bias detector needs two losses in the same bucket before it says anything. Every
resolved pick in the live database happened to win, so `detectBias()` never fired and the
product's central claim — that a recalled memory changes the next verdict — had no evidence
behind it. `scripts/seed-demo-loop.ts` creates that evidence rather than asserting it.

It is written to be difficult to mistake for real data:

- It **claims its own journal** (`@demo_loop`) by generating an Ed25519 keypair and signing
  the real `claim` challenge, so the signature path under test is the product's own. A
  broken verifier fails here instead of producing a journal nothing can sign into.
- Every market and selection is prefixed `synthetic demo`, and the analyst is named
  `DEMO synthetic analyst (demo_loop)`.
- `sourceUrl` points at the journal's own page. These resolutions are self-attested and the
  stored `verification` column says `self_attested`; no oracle fixture is claimed.
- It refuses a `localhost` base URL and refuses to write the recovery file inside the
  repository, because both would end up in permanent public blobs or in git.
- Only the **recovery code** is written to disk (mode `0600`). The generated private key is
  never persisted, so the file grants access without granting control of the address.

The composition matters. Five favourites that won (1.25–1.35) put credibility at 56, which
is `proceed`; the two underdog losses then fire the bias pattern, and the same call returns
`reduce`. A losing record would have produced `avoid` both before and after the downgrade,
which would prove nothing about memory changing a decision.

Measured run against production:

```txt
bias=2 of 2 underdog picks (odds >= 2.5) lost
verdict reduce
summary Memory changed the verdict from proceed to reduce: 2 of 2 underdog picks (odds >= 2.5) lost.
warning bias (evidence 2)
warning credibility (evidence 7) No oracle-confirmed outcome yet
```

If the bias warning does not appear, the script prints `NO BIAS WARNING` and says the
verdict did not change. That is deliberate: a seeder that reported success regardless would
be worse than no seeder.

---

## 12. Configuration and startup

Every deployment-specific value is read through `lib/env.ts` and validated with zod. `lib/config.ts`
holds protocol constants only — no secret, address or price.

Beyond per-field validation, four cross-field rules run in `superRefine`:

1. `TATUM_SUI_RPC_URL` host must contain `mainnet`/`testnet` matching `SUI_NETWORK`.
2. When `X402_CLIENT_PRIVATE_KEY` is present, `AGENT_SUI_ADDRESS` must equal the address
   derived from it — so a mismatched operator key fails at startup, not at payment time.
3. `X402_PRICE` and `X402_LISTING_FEE` must each be at least `GASLESS_MIN_ATOMIC` (10000
   atomic, 0.01 USDC). Sui only sponsors gas at or above that floor, so a lower value would
   build a sponsored transaction the network rejects with `InsufficientGas`; catching it at
   startup means the first buyer or seller never sees it.

Validation is lazy and cached, for one specific reason: `next build` must compile routes
without production credentials, while every runtime entry point still fails fast. The
runtime hook is `instrumentation.ts`, which runs `assertStartupEnvironment()` once per server
and is skipped during the build phase and outside the Node.js runtime.

`getEnv()` caches on first call, which is why changing `.env.local` requires a dev-server
restart. There is a `resetEnvCacheForTests()` escape hatch used only by tests.

`DB_POOL_MAX` defaults to 10 locally and should be lowered (e.g. 3) on serverless, because each
instance keeps its own pool and serverless platforms clone instances.

---

## 13. Feature surface

Every page is a server component that reads through `server/` and renders proof, not a
loading spinner. Forms are the only client components, and they call internal API routes.

The site has two surfaces. `app/(marketing)` owns `/`, `/how-it-works` and `/docs`, renders
its own navigation, and never reads the session or the database — so the landing page is
static and looks identical for a reviewer with no wallet installed. `app/(app)` owns the
journal under `/dashboard` and its sibling routes, with the product nav, the wallet button
and the footer.

### Marketing pages

| Page                    | What it does                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`                     | Landing page: the problem, the four steps, the three integrations with real recorded values, what the product explicitly does not claim, and the document index.               |
| `/how-it-works`         | The lifecycle table (what each state writes and refuses), why the hash must be canonical, the scoring and verdict formulas, the six-step x402 sequence, and the stated limits. |
| `/docs`                 | Index of the documents, with a reading order.                                                                                                                                  |
| `/docs/[slug]`          | Renders `README.md` and the four files in `docs/` directly, prerendered by `generateStaticParams`.                                                                             |
| `/journals`             | Every journal namespace the relayer reports, with memory counts and reconstructed track records. No SQL in this read path.                                                     |
| `/journals/[namespace]` | One journal's history, rebuilt from its memories: picks, outcomes, bias patterns, credibility. Identity and probe namespaces are refused with `404`.                           |

### Journal pages

| Page               | What it does                                                                                                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dashboard`       | Dashboard: pick stats, a seller panel with settled earnings and own verification counts, credibility leaderboard, latest commitments, the most recent memory-driven decision with its cited blob ids, and a live settlement feed built from Tatum transaction events. |
| `/onboarding`      | Claims a handle by proving a wallet by signature, then reveals the 24-symbol recovery code **once**, behind a checkbox that must be ticked before entering.                                                                                                           |
| `/resume`          | Restores a session from the recovery code alone. Accepts the code in any case or grouping; no handle is asked for.                                                                                                                                                    |
| `/settings/wallet` | Read-only. Shows the address that _is_ the journal and how the signature proof works; there is nothing to bind or replace.                                                                                                                                            |
| `/picks`           | Public ledger plus `?mine=true`. Sealed rows show only hash and timestamp to non-owners.                                                                                                                                                                              |
| `/picks/new`       | Two-step flow: ask memory first (recommendation), then commit the sealed pick.                                                                                                                                                                                        |
| `/picks/[id]`      | Proof detail: commitment hash, whether the stored payload still matches, reveal/resolve actions for the owner only, and the resolution with its source URL.                                                                                                           |
| `/analysts`        | Leaderboard with credibility score, a separate verified score, and how many samples an independent provider confirmed.                                                                                                                                                |
| `/analysts/[id]`   | Calibration bins, resolved evidence list, and the analyst's pick history.                                                                                                                                                                                             |
| `/memory`          | Relayer health, `listMemories()` pages with a truncation flag, a live recall search that shows memory text with its cosine distance, and a form to teach a preference.                                                                                                |
| `/signals`         | Signal marketplace: every listing whose fee digest was verified, with prices and purchase counts; the publish panel appears for a journal with a proven wallet.                                                                                                       |
| `/signals/[id]`    | The paid resource. Shows the price, the wallet purchase panel, and — after payment — the payload with digest, payer, amount and explorer link.                                                                                                                        |
| `/payments`        | Settlement ledger, merchant USDC balance from Tatum, on-chain events, and read-only digest verification.                                                                                                                                                              |

### Routes

| Route                          | Auth                   | Notes                                                                              |
| ------------------------------ | ---------------------- | ---------------------------------------------------------------------------------- |
| `GET /api/session`             | optional               | Current journal plus `hasRecovery`.                                                |
| `PUT /api/session`             | origin-checked         | Issue a single-use challenge for claim or login.                                   |
| `POST /api/session`            | origin-checked         | Claim a handle with the wallet signature; returns the code once, `201`.            |
| `POST /api/session/wallet`     | origin-checked         | Sign in by proving the wallet; the address _is_ the journal.                       |
| `PATCH /api/session`           | origin-checked, 10/min | Resume with the recovery code alone.                                               |
| `DELETE /api/session`          | origin-checked         | Log out.                                                                           |
| `GET /api/picks`               | optional               | Feed, `?mine=true`, redacted per viewer.                                           |
| `POST /api/picks`              | session                | Seal a pick; rolls back on memory failure.                                         |
| `GET /api/picks/[id]`          | optional               | Single pick, redacted per viewer.                                                  |
| `POST /api/picks/[id]/reveal`  | owner                  | Hash + time-lock checked.                                                          |
| `POST /api/picks/[id]/resolve` | owner                  | Oracle consulted when the pick carries a fixture ref; `201`.                       |
| `GET /api/oracle/fixtures`     | session                | Fixtures for one league/date so a picker can link a real match.                    |
| `GET /api/analysts`            | public                 | Leaderboard.                                                                       |
| `POST /api/analysts`           | session                | Create an analyst; duplicate → `409`.                                              |
| `POST /api/recommendations`    | session                | Recall before deciding; persists citations; `201`.                                 |
| `POST /api/memory/preferences` | session                | Write a preference memory; `201` with a blob id.                                   |
| `GET /api/signals`             | public                 | Marketplace; only fee-verified listings appear.                                    |
| `POST /api/signals`            | wallet proof, 10/min   | Validate body, then x402 listing fee, then publish; `403` without a proven wallet. |
| `GET /api/signals/[id]`        | x402 payment, 30/min   | Paywall; Tatum verification before release.                                        |
| `GET /api/payments`            | public                 | Ledger plus merchant balance and events.                                           |
| `POST /api/payments/verify`    | origin-checked, 10/min | Read-only digest check; never inserts.                                             |
| `GET /api/health`              | public                 | Database + Walrus + Tatum; `503` if any fails; no secrets.                         |

### The three journeys that matter

**A. Prove a pick (no money involved).**

```txt
/onboarding → recovery code shown once
/picks/new  → ask memory → pick a real fixture → seal (hash + pick_commit memory)
/picks/[id] → reveal (hash re-verified, pick_reveal memory)
            → resolve → provider re-read → oracle_verified / oracle_contradicted
            → outcome + bias + source_roi memories
/memory     → the blobs appear, with text and distances
```

**B. Sell a signal, then buy one (money involved, self-custody).**

```txt
/settings/wallet → shows the address that is the journal (nothing to bind)
/signals         → publish a signal → sign the flat listing fee
                 → facilitator settles → Tatum verifies the digest
                 → listing becomes visible with the seller's wallet as payee
/signals/[id]    → connect wallet → sign the exact Sui payment
                 → facilitator settles → seller verifies through Tatum
                 → payload released → payment + source_roi memories written
/payments        → digest, payer, amount, merchant balance, explorer link
```

**C. Let memory change a decision.**

```txt
resolve two picks that lost as underdogs for the same analyst
  → bias pattern detected (minimum evidence is 2) and written to memory
next pick on that analyst
  → recall returns the bias memory with its distance
  → verdict downgraded, warning cites the blob
```

### The demo signal provider is gone

The local demo provider and the ingest path were removed when selling became open. A
journal no longer ingests from a vendor contract; it publishes its own payload after paying
the flat listing fee. The one catalogue payload kept for testing is labelled **synthetic
demo payload** in the payload itself and everywhere it appears, and is never presented as a
real forecast.

---

## 14. Testing strategy

The suite is deliberately narrow: **140 tests across 17 files, all pure functions.** No
network, no database, no fake service.

| File                       | What it pins down                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `canonical.test.ts`        | Key ordering, array order, `undefined` handling, SHA-256 test vectors, hash stability               |
| `brier.test.ts`            | Implied probability, Brier values, void handling, calibration bins                                  |
| `credibility.test.ts`      | Empty sample, void counting, calibration weighting, recency decay, ordering, verified-only score    |
| `bias.test.ts`             | Minimum evidence, underdog/favourite/overconfidence patterns, void exclusion, sorting               |
| `payment-binding.test.ts`  | Digest-to-signal binding, resource normalisation, stale price, retry classification                 |
| `memory-schema.test.ts`    | Round-trip every kind, delimiter escaping, malformed rejection, sealed commit never leaks selection |
| `oracle.test.ts`           | Ref parsing, selection parsing, team-name normalisation, refusing a name that matches neither side  |
| `wallet-signature.test.ts` | Ed25519 accept/reject, wrong address, tampered message, malformed signature returns `false`         |
| `price.test.ts`            | USD → atomic scaling, bare integer as atomic, precision rejection, formatting                       |
| `coin-type.test.ts`        | Short/padded/mixed-case coin type equality                                                          |
| `recovery-code.test.ts`    | Alphabet, uniqueness, normalisation, verification, `null` hash, malformed hash, fresh salt          |
| `session-cookie.test.ts`   | Round-trip, tampered signature, tampered id, legacy cookie, wrong secret                            |
| `tatum-mapping.test.ts`    | GraphQL response → domain shapes, balance change mapping                                            |
| `ids.test.ts`              | UUID acceptance and rejection, including out-of-range version nibble                                |
| `markdown.test.ts`         | Inline emphasis/links/code spans, table cell splitting, fenced code, list folding, heading anchors  |

What is **not** unit tested, and how it is covered instead:

- Route handlers, use-cases and SQL → verified by hand against a live instance, and the exact
  results are recorded in `README.md` (journey table) and `docs/INTEGRATIONS.md`.
- Walrus, Tatum and the results oracle → covered by the `verify:*` scripts against mainnet.
- Wallet claim/login → exercised against a live server with a generated Ed25519 keypair;
  the signature primitive itself is unit tested, including the malformed-input regression.
- UI → covered by manual checks: server-rendered markup present, real `404`s, wallet connect
  in a real browser, verified badge on an oracle-confirmed outcome.

This is a conscious choice: mocking Walrus and Tatum would test the mocks, and the claims in
the README are only worth anything if they come from real calls.

### Verification scripts

Four scripts hit real services, print JSON lines, and exit non-zero on failure. They load
`.env.local` then `.env` (same precedence as Next.js) via `scripts/load-env.ts`, and contain
no sample values.

| Script               | What it proves                                                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify:memory` | Relayer `health()`, a real `rememberAndWait()` blob id, a `recall()` with cosine distance and exact text returned, and a `listMemories()` page.                                                                                   |
| `pnpm verify:tatum`  | Latest checkpoint, a named transaction's status and balance changes, and the operator agent's USDC balance.                                                                                                                       |
| `pnpm verify:x402`   | Pays the real paywalled endpoint with `X402_CLIENT_PRIVATE_KEY`, then re-verifies the returned digest through Tatum — a second check even though the seller already performed one, so a compromised seller cannot fake a receipt. |
| `pnpm verify:oracle` | Read-only: fetches a real scoreboard, reads every completed fixture back through the resolver's own code, and fails if any match does not resolve to exactly one winner.                                                          |

`verify:x402` requires the app to be running at `APP_BASE_URL` and a real signal id in
`X402_TEST_SIGNAL_ID`. It has not been run against mainnet; the recorded purchase in the
README was made with a browser wallet instead, and `docs/INTEGRATIONS.md` marks that gap
explicitly rather than implying the script was exercised.

### Why there is no CI

There is no GitHub Actions workflow. A pipeline that only runs `typecheck`, `lint` and `test`
would be honest but redundant, and a pipeline that runs the `verify:*` scripts would need
mainnet credentials in CI, which is a worse security posture than running them by hand. The
gates are documented in the README Status table and were all run before submission.

---

## 15. Failure policy matrix

| Situation                                    | Behaviour                                                               | Status    |
| -------------------------------------------- | ----------------------------------------------------------------------- | --------- |
| Postgres unreachable                         | `/api/health` degraded; pages that need data fail                       | 503       |
| Walrus down at seal time                     | Pick row deleted, nothing claimed                                       | 502       |
| Walrus down at resolve time                  | Outcome rolled back                                                     | 502       |
| Walrus down at reveal / bias / ROI / payment | Operation succeeds; failure logged                                      | 2xx       |
| Tatum down during payment verification       | Signal refused, retried for ~20 s first                                 | 402       |
| Tatum slow to index a fresh digest           | Retried 7× with backoff; buyer can re-check the digest without paying   | 402 → 200 |
| Tatum down on `/payments`                    | Page renders with `balance: unavailable` and no substitute feed         | 200       |
| x402 facilitator unreachable                 | `UPSTREAM_UNAVAILABLE`; no payment is recorded                          | 502       |
| Listing price below the gasless floor        | Startup refuses the configuration                                       | exit 1    |
| Publish from a legacy uuid journal           | Refused; it has no wallet to be paid at                                 | 403       |
| Invalid listing body                         | Rejected before settlement; no listing fee is taken                     | 400       |
| Login proof names another address            | Refused before the lookup                                               | 401       |
| Claim a wallet that already has a journal    | Refused; sign in instead, so history cannot split across two namespaces | 409       |
| Oracle contradicts a claimed win             | Stored as `oracle_contradicted`, owner's claim preserved                | 201       |
| Claimed `void` on a completed fixture        | Stored as `oracle_contradicted`; no free pass to verified               | 201       |
| `ORACLE_ENABLED=false` at resolve time       | Stored as `self_attested` with a configuration reason                   | 201       |
| Oracle unreachable at resolve time           | Falls back to `self_attested` with `oracleNote`; never blocks the write | 201       |
| Digest already used for another signal       | Settlement refused                                                      | 409       |
| Signed-out write                             | Refused                                                                 | 401       |
| Cross-origin session write                   | Refused                                                                 | 403       |
| Malformed or stale detail URL                | Not-found page, no database error                                       | 404       |

The general rule: **the product fails closed and says which layer failed.** It never
substitutes sample data, a cached success, or a placeholder row.

---

## 16. Limitations, stated plainly

- Outcomes are **self-attested outside the oracle's scope**. Oracle verification covers one
  league (`espn:eng.1`) and match-winner markets only; everything else records
  `self_attested`, is labelled that way in the UI, and contributes nothing to a seller's
  verified score. For those rows `sourceUrl` is validated as an http(s) URL but never
  fetched, so the hash and the calibration score do not establish that the cited result is
  true.
- A contradicted claim is preserved rather than rejected: `outcomes.result` keeps what the
  owner said and `oracleResult` keeps what the provider recorded. Only `oracle_verified`
  counts toward `verifiedScore`.
- The session cookie has no rotation or revocation list.
- Losing both the bound wallet and the recovery code loses the journal permanently.
- The rate limiter is per-instance memory.
- Tatum's Sui support is mainnet-only for the interfaces used here.
- The x402 settlement happens before Tatum verification, so a sustained Tatum outage after
  settlement means the buyer has paid and must retry to receive the payload. This is the
  fail-closed trade-off, and it is documented rather than hidden.
- The catalogue signal used in the recorded purchase is a **synthetic demo payload**, not a
  real forecast product.
- No signal has been published through the paid listing flow on mainnet yet, so the listing
  fee has a verified `402` challenge but no recorded settlement digest.
- `pnpm verify:x402` has not been run against mainnet; the recorded purchase was made with a
  browser wallet. That row is marked as such in `docs/INTEGRATIONS.md`.
- The recorded settlement is **not** buyer → seller. Signal `4047410e-…` is a legacy catalogue
  row (`sellerRef` and `payToAddress` both `null`), so the `10000` atomic USDC went to the
  platform address. The digest proves the x402 path end to end on the live deployment — real
  wallet signature, mainnet transfer, Tatum verification, payload release, memory write — but
  not a payment from one user to another. That needs listing `29db37cb-…` and its digest is
  `not captured`.
- Settlement `resource.url` values recorded before the first deploy point at
  `http://localhost:3000`. They remain valid receipts for those payments; the latest
  settlement is recorded against `APP_BASE_URL`.

---

## 17. Glossary

| Term                | Meaning in Saksi                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------- |
| **Journal**         | One Sui address that proved ownership, with its own Walrus namespace.                    |
| **Ref**             | A journal's identity string: a lowercase Sui address, or a uuid for pre-`0007` journals. |
| **Handle**          | A display name stored in Walrus. Not unique and not an identifier.                       |
| **Pick**            | A prediction committed before an event, identified by a hash.                            |
| **Commitment hash** | `sha256(canonicalJson(payload))`. Proves the pick existed and was not edited.            |
| **Sealed**          | Committed but not yet revealed. Content visible only to the owner.                       |
| **Reveal**          | Recompute the hash and publish the content if it still matches.                          |
| **Resolve**         | Attach a result, a source URL and a timestamp; compute the Brier score.                  |
| **Credibility**     | Recency-weighted, Wilson-shrunk score from 0 to 100.                                     |
| **Bias pattern**    | Repeated losing behaviour, written to memory and cited in later recommendations.         |
| **Source ROI**      | Did the premium data I paid for improve my results?                                      |
| **Memory kind**     | One of the ten validated `saksi:v1` record types.                                        |
| **Namespace**       | `${prefix}:${ref}` — the isolation boundary inside Walrus Memory.                        |
| **Citation**        | `{ blobId, text, distance }` for a memory that actually influenced a decision.           |
| **Settlement**      | The on-chain x402 payment, verified through Tatum before data is released.               |

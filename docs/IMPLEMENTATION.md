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
| Vitest 5.0.5                                    | Unit tests for pure functions only. 105 tests across 14 files.                         |
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
purpose — the SQL is meant to be readable). `lib/` never imports from `app/` or `server/`;
the one exception is `lib/session.ts`, which needs the `users` table to turn a cookie into a
user and therefore imports `db/`.

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

What is left is a single design: **the server issues one secret, and that secret is the only
proof of ownership.**

### 3.2 The recovery code

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

### 3.3 Storage: scrypt, never plaintext

The database column is `users.recovery_hash`, containing:

```txt
scrypt$<16-byte salt, hex>$<32-byte derived key, hex>
```

Parameters: `N=16384, r=8, p=1`. A database leak therefore yields no usable code — only 24
symbols already stretched by a memory-hard KDF. Comparison uses `timingSafeEqual` on the
derived bytes.

The plaintext code exists in exactly three places: the generator's return value, the HTTP
response of `POST /api/session`, and the onboarding screen. There is **no endpoint that can
re-display it**, because the server genuinely cannot — it only has the hash. Any endpoint
that could reveal it would mean the code was stored readably, which would undo this section.

### 3.4 Enumeration defence: `ABSENT_HASH`

A subtle leak that is easy to miss: if an unknown handle returned immediately while a known
handle with a wrong code took 50–100 ms (scrypt), the timing difference alone would let
someone enumerate which handles exist.

`verifyRecoveryCode()` therefore always performs a full derivation. When `stored` is `null`,
it derives against `ABSENT_HASH` — a well-formed hash of all zeroes — and then returns
`false` because `stored !== null` can never satisfy the final check. The result:

- Unknown handle → full scrypt run → `false`.
- Known handle, wrong code → full scrypt run → `false`.
- Both produce the **same** `401 UNAUTHORIZED` with the same message.

Verified by hand: wrong code and unknown handle return byte-identical error bodies.

### 3.5 The session cookie

After a successful create or resume, `POST`/`PATCH /api/session` writes:

```txt
saksi_user = <userId>.<base64url(HMAC-SHA256(userId, SESSION_SECRET))>
```

Properties:

| Property   | Value              | Why                                                                     |
| ---------- | ------------------ | ----------------------------------------------------------------------- |
| `httpOnly` | true               | JavaScript cannot read it, so an XSS bug cannot exfiltrate the session. |
| `sameSite` | `lax`              | Blocks the common cross-site form POST.                                 |
| `secure`   | true in production | Never sent over plaintext.                                              |
| `path`     | `/`                | Whole app.                                                              |
| `maxAge`   | 365 days           | A journal is meant to outlive a browser restart.                        |
| Payload    | the user UUID only | No roles, no handle, no permissions baked into the token.               |

`verifySession()` splits on the **last** dot, validates the signature shape with a fixed
43-character base64url pattern, and compares with `timingSafeEqual`. A tampered signature, a
tampered user id, a legacy unsigned cookie, or the same token under a different secret all
return `null`, which the app treats as "no session".

Because the payload is only an id, **authorisation is re-read from Postgres on every
request** (`getSessionUser()` joins `users`). Deleting a journal kills its sessions
instantly. A JWT would have kept a claim alive until expiry instead, which is the opposite of
what this product wants.

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

### 3.8 Why not wallet-as-identity, and what a hybrid would need

This is a reasonable question: make the Sui wallet the identity, and let each address claim a
handle. It is a real architecture change, not a refactor, and it trades one set of problems
for another.

**What would have to be built:**

1. A unique `wallet_address` column on `users`, plus a migration.
2. `POST /api/session/challenge` issuing a single-use nonce with a short TTL.
3. `POST /api/session/verify` verifying a signed personal message with
   `verifyPersonalMessageSignature` from `@mysten/sui`.
4. The signed message must bind **domain + nonce + issued-at + statement**. Without the
   domain and nonce, any signature the user ever produced on another site could be replayed
   here.
5. Handle claiming per address, with uniqueness on both `handle` and `wallet_address`.
6. A complete rewrite of `/onboarding` and `/resume`.
7. A migration path for existing journals — and `testdemo` and `demo_buyer` predate recovery
   codes entirely, so they have neither a hash nor an address to migrate.

**What improves:** nothing can be lost the way a code can; ownership is proven
cryptographically; the handle is automatically bound to the paying wallet, so
`pick_id → source ROI` attribution becomes automatic rather than optional.

**What gets worse:**

- **The app becomes unusable without a wallet extension.** A reviewer who opens the link in
  a plain browser cannot enter at all. Today they can create a journal and try every feature
  immediately.
- **Losing the wallet loses the journal permanently.** A recovery code can be stored in a
  password manager and read back; a rotated or abandoned address cannot.
- **Multi-wallet.** Most people have several addresses. Without explicit support, a user is
  locked to one forever.
- **A signature prompt on every new browser or device.**
- **Zero additional integration credit.** The scoring is 30% Walrus + Tatum, 30% technical
  quality, 20% creativity, 20% presentation. Wallet auth touches neither Walrus nor Tatum.

**The recommended shape is a hybrid, after submission:** keep handle + recovery code as the
baseline, and let a signed-in user _link_ a wallet to their journal. Once linked,
"sign in with wallet" appears next to "resume with recovery code". That delivers the
requested behaviour — one handle per wallet — while keeping the journal reachable without a
wallet and without a forced migration of existing rows. Cost is roughly one migration, one
column, two routes, one component, plus tests for nonce replay and a foreign-domain
signature.

This is recorded as a deliberate decision, not an oversight. The alternative — signing in with a
Sui wallet and claiming a handle per address — was evaluated in full and rejected for the
current release; the trade-offs are listed above rather than left implicit.

### 3.9 Legacy journals

`testdemo` and `demo_buyer` were created before recovery codes existed, so
`recovery_hash IS NULL` and they can never be resumed by guessing. `verifyRecoveryCode()`
derives against `ABSENT_HASH` in that case, and the final `stored !== null` guard means the
result is always `false` — a journal with no stored credential cannot be opened by any input.

The only way to give such a journal a credential is the operator CLI:

```bash
pnpm recovery:issue <handle> <out-file>
```

It refuses to overwrite an existing hash (that would lock out the current holder), writes the
code to a file with mode `0600` rather than stdout (so it never lands in a terminal
transcript or CI log), and prints a reminder to move it into a password manager. There is
deliberately **no HTTP endpoint** for this, because any endpoint that mints a code for a
handle is an account takeover primitive.

`GET /api/session` reports `hasRecovery: false` for these journals so the UI can warn instead
of pointing at a code that does not exist.

### 3.10 Known limits of this model

- The cookie has no rotation and no revocation list. A leaked `SESSION_SECRET` forges any
  session. Acceptable for a hackathon; not acceptable for production.
- Losing the code loses the journal. Sealed picks stay sealed forever. This is a direct
  consequence of decision 3.1, and it is what makes "nobody can peek" credible.
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
| `preference`  | userId, statement                                | user teaches the journal          |
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

### 6.8 The audit table

`memory_writes` records `kind`, `blobId`, `jobId`, `namespace` for every successful write. It
is an operator audit trail, never a substitute for the relayer. If the audit insert fails
after a successful write, the error is logged and the write still counts — the memory is the
source of truth, the row is bookkeeping.

Because Walrus blobs cannot be deleted, `memory_writes` outlives deleted journals. That is why
the README reports 27 rows against 3 surviving journals, and explains it rather than hiding
it.

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

`X402_PRICE` accepts either `$0.01` (human USD) or `10000` (atomic units). The x402 scheme
only understands USD strings, so the seller normalises through the same parser the ingest path
uses:

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

| Rule                     | Effect                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| One digest, one signal   | Re-using a digest for a different signal → `409`.                                                                            |
| One digest, one resource | Comparing normalised URLs (host lowercased, query and fragment dropped, trailing slash removed) → `409` on mismatch.         |
| Price must not be stale  | If `signals.price_atomic` differs from the configured price, refuse before settlement with `409` "re-price by re-ingesting". |

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
"mainnet" })`. The merchant payee (`X402_PAY_TO_ADDRESS`) stays operator-owned, so the demo
has a real recipient without the operator ever paying.

`integrations/x402/buyer.ts` keeps the same flow for `pnpm verify:x402`, reading
`X402_CLIENT_PRIVATE_KEY` from the environment and re-verifying the digest through Tatum even
though the seller already did — that protects the buyer from a malicious seller response.

### 8.8 Idempotency and attribution

`payments.digest` is unique. `recordPayment()` inserts with `onConflictDoNothing`, then reads
the existing row and applies the binding rules. If an external settlement was recorded first
(the agent path, `userId` null) and a journal later claims it, the row is updated once with
`where userId is null` so the claim is not repeatable — and only that transition writes the
payment and source-ROI memories.

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
| `FORBIDDEN`            | 403  | Not the owner, not an operator, or cross-origin.                                      |
| `NOT_FOUND`            | 404  | Missing pick, analyst, signal or provider id.                                         |
| `CONFLICT`             | 409  | Duplicate handle, already resolved, time-locked, stale price, digest bound elsewhere. |
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
- The operator ingest form never reached the HTML, so it appeared only after hydration.

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

Eight tables, three migrations (`0000`, `0001`, `0002`).

```txt
users ──┬── picks ── outcomes
        │      │
        │      └── payments ── signals
        └── payments

memory_writes       (operator audit, no foreign keys)
recommendations     (pick_id nullable, cited_memory_ids jsonb)
```

| Table             | Purpose                       | Key constraints                                                                 |
| ----------------- | ----------------------------- | ------------------------------------------------------------------------------- |
| `users`           | a journal identity            | `handle` unique; `recovery_hash` nullable (legacy journals)                     |
| `analysts`        | who is being tracked          | `(name, kind)` unique; **global**, not owned by a user                          |
| `picks`           | a sealed commitment           | FKs: `user_id` cascade, `analyst_id` restrict; indexes on user, analyst, status |
| `outcomes`        | the resolution                | `pick_id` unique, cascade delete                                                |
| `signals`         | a purchasable premium listing | `(provider, external_ref)` unique so re-ingest updates instead of duplicating   |
| `payments`        | a verified settlement         | `digest` unique; `user_id` and `pick_id` `set null` on delete; index on payer   |
| `memory_writes`   | audit of every Walrus write   | index on `kind`                                                                 |
| `recommendations` | a persisted verdict           | index on `created_at`; `pick_id` `set null` on delete                           |

Two design notes:

- **Analysts are global.** A pick references an analyst, not "my analyst", so credibility is
  comparable across journals. The trade-off is that deleting a journal leaves its analysts
  behind; cleanup is a documented SQL statement rather than a cascade, because cascading would
  silently delete another journal's history.
- **`payments.user_id` is nullable on purpose.** The agent purchase path records a settlement
  before any journal claims it; that row can be claimed later by digest.

---

## 12. Configuration and startup

Every deployment-specific value is read through `lib/env.ts` and validated with zod. `lib/config.ts`
holds protocol constants only — no secret, address or price.

Beyond per-field validation, three cross-field rules run in `superRefine`:

1. `SIGNAL_PROVIDER_API_URL` and `SIGNAL_PROVIDER_API_KEY` must be set together, or neither.
2. `TATUM_SUI_RPC_URL` host must contain `mainnet`/`testnet` matching `SUI_NETWORK`.
3. When `X402_CLIENT_PRIVATE_KEY` is present, `AGENT_SUI_ADDRESS` must equal the address
   derived from it — so a mismatched operator key fails at startup, not at payment time.

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

| Page            | What it does                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`             | Landing page: the problem, the four steps, the three integrations with real recorded values, what the product explicitly does not claim, and the document index.               |
| `/how-it-works` | The lifecycle table (what each state writes and refuses), why the hash must be canonical, the scoring and verdict formulas, the six-step x402 sequence, and the stated limits. |
| `/docs`         | Index of the documents, with a reading order.                                                                                                                                  |
| `/docs/[slug]`  | Renders `README.md` and the four files in `docs/` directly, prerendered by `generateStaticParams`.                                                                             |

### Journal pages

| Page             | What it does                                                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dashboard`     | Dashboard: pick stats, credibility leaderboard, latest commitments, the most recent memory-driven decision with its cited blob ids, and a live settlement feed built from Tatum transaction events. |
| `/onboarding`    | Creates a journal and reveals the 24-symbol recovery code **once**, behind a checkbox that must be ticked before entering.                                                                          |
| `/resume`        | Restores a session from handle + recovery code. Accepts the code in any case or grouping.                                                                                                           |
| `/picks`         | Public ledger plus `?mine=true`. Sealed rows show only hash and timestamp to non-owners.                                                                                                            |
| `/picks/new`     | Two-step flow: ask memory first (recommendation), then commit the sealed pick.                                                                                                                      |
| `/picks/[id]`    | Proof detail: commitment hash, whether the stored payload still matches, reveal/resolve actions for the owner only, and the resolution with its source URL.                                         |
| `/analysts`      | Leaderboard with credibility score, win rate and how many samples were community-attested.                                                                                                          |
| `/analysts/[id]` | Calibration bins, resolved evidence list, and the analyst's pick history.                                                                                                                           |
| `/memory`        | Relayer health, `listMemories()` pages with a truncation flag, a live recall search that shows memory text with its cosine distance, and a form to teach a preference.                              |
| `/signals`       | Signal catalogue with prices and purchase counts; the ingest form appears only for a signed-in operator.                                                                                            |
| `/signals/[id]`  | The paid resource. Shows the price, the wallet purchase panel, and — after payment — the payload with digest, payer, amount and explorer link.                                                      |
| `/payments`      | Settlement ledger, merchant USDC balance from Tatum, on-chain events, and read-only digest verification.                                                                                            |

### Routes

| Route                          | Auth                   | Notes                                                                  |
| ------------------------------ | ---------------------- | ---------------------------------------------------------------------- |
| `GET /api/session`             | optional               | Current user plus `hasRecovery`.                                       |
| `POST /api/session`            | origin-checked         | Create a journal; returns the recovery code once, `201`.               |
| `PATCH /api/session`           | origin-checked, 10/min | Resume with handle + code.                                             |
| `DELETE /api/session`          | origin-checked         | Log out.                                                               |
| `GET /api/picks`               | optional               | Feed, `?mine=true`, redacted per viewer.                               |
| `POST /api/picks`              | session                | Seal a pick; rolls back on memory failure.                             |
| `GET /api/picks/[id]`          | optional               | Single pick, redacted per viewer.                                      |
| `POST /api/picks/[id]/reveal`  | owner                  | Hash + time-lock checked.                                              |
| `POST /api/picks/[id]/resolve` | owner                  | Source URL + timestamp required; `201`.                                |
| `GET /api/analysts`            | public                 | Leaderboard.                                                           |
| `POST /api/analysts`           | session                | Create an analyst; duplicate → `409`.                                  |
| `POST /api/recommendations`    | session                | Recall before deciding; persists citations; `201`.                     |
| `POST /api/memory/preferences` | session                | Write a preference memory; `201` with a blob id.                       |
| `GET /api/signals`             | public                 | Catalogue with prices and purchase counts.                             |
| `POST /api/signals`            | operator, 10/min       | Ingest from the provider; `503` if unconfigured, `404` for unknown id. |
| `GET /api/signals/[id]`        | x402 payment, 30/min   | Paywall; Tatum verification before release.                            |
| `GET /api/payments`            | public                 | Ledger plus merchant balance and events.                               |
| `POST /api/payments/verify`    | origin-checked, 10/min | Read-only digest check; never inserts.                                 |
| `GET /api/health`              | public                 | Database + Walrus + Tatum; `503` if any fails; no secrets.             |

### The three journeys that matter

**A. Prove a pick (no money involved).**

```txt
/onboarding → recovery code shown once
/picks/new  → ask memory → seal (hash + pick_commit memory)
/picks/[id] → reveal (hash re-verified, pick_reveal memory)
            → resolve with source URL (outcome + bias + source_roi memories)
/memory     → the blobs appear, with text and distances
```

**B. Buy a signal (money involved, self-custody).**

```txt
/signals/[id] → connect wallet → sign the exact Sui payment
              → facilitator settles → seller verifies through Tatum
              → payload released → payment + source_roi memories written
/payments     → digest, payer, amount, merchant balance, explorer link
```

**C. Let memory change a decision.**

```txt
resolve two picks that lost as underdogs for the same analyst
  → bias pattern detected (minimum evidence is 2) and written to memory
next pick on that analyst
  → recall returns the bias memory with its distance
  → verdict downgraded, warning cites the blob
```

### The demo signal provider

`scripts/demo-signal-provider.ts` is a local HTTP server (`pnpm demo:provider`, port 4100)
that implements exactly the provider contract documented in `README.md` under
**Signal provider contract**, with bearer-token comparison done via `timingSafeEqual`. It
exists so the ingest → x402 → Tatum path can be exercised end to end without pretending a
data vendor is connected.

Its two payloads (`demo-1`, `demo-2`) are labelled **synthetic demo payload** in the payload
itself and everywhere they surface. They are never presented as real forecasts.

---

## 14. Testing strategy

The suite is deliberately narrow: **105 tests across 14 files, all pure functions.** No
network, no database, no fake service.

| File                      | What it pins down                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `canonical.test.ts`       | Key ordering, array order, `undefined` handling, SHA-256 test vectors, hash stability               |
| `brier.test.ts`           | Implied probability, Brier values, void handling, calibration bins                                  |
| `credibility.test.ts`     | Empty sample, void counting, calibration weighting, recency decay, ordering                         |
| `bias.test.ts`            | Minimum evidence, underdog/favourite/overconfidence patterns, void exclusion, sorting               |
| `payment-binding.test.ts` | Digest-to-signal binding, resource normalisation, stale price, retry classification                 |
| `memory-schema.test.ts`   | Round-trip every kind, delimiter escaping, malformed rejection, sealed commit never leaks selection |
| `price.test.ts`           | USD → atomic scaling, bare integer as atomic, precision rejection, formatting                       |
| `coin-type.test.ts`       | Short/padded/mixed-case coin type equality                                                          |
| `recovery-code.test.ts`   | Alphabet, uniqueness, normalisation, verification, `null` hash, malformed hash, fresh salt          |
| `session-cookie.test.ts`  | Round-trip, tampered signature, tampered id, legacy cookie, wrong secret                            |
| `signal-provider.test.ts` | HTTP status → error mapping, retry only on 5xx                                                      |
| `tatum-mapping.test.ts`   | GraphQL response → domain shapes, balance change mapping                                            |
| `ids.test.ts`             | UUID acceptance and rejection, including out-of-range version nibble                                |
| `markdown.test.ts`        | Inline emphasis/links/code spans, table cell splitting, fenced code, list folding, heading anchors  |

What is **not** unit tested, and how it is covered instead:

- Route handlers, use-cases and SQL → verified by hand against a live instance, and the exact
  results are recorded in `README.md` (journey table) and `docs/INTEGRATIONS.md`.
- Walrus and Tatum integrations → covered by the three `verify:*` scripts against mainnet.
- UI → covered by manual checks: server-rendered markup present, real `404`s, operator form
  visible only to an operator, merchant balance correct, wallet connect in a real browser.

This is a conscious choice: mocking Walrus and Tatum would test the mocks, and the claims in
the README are only worth anything if they come from real calls.

### Verification scripts

Three scripts hit real services, print JSON lines, and exit non-zero on failure. They load
`.env.local` then `.env` (same precedence as Next.js) via `scripts/load-env.ts`, and contain
no sample values.

| Script               | What it proves                                                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify:memory` | Relayer `health()`, a real `rememberAndWait()` blob id, a `recall()` with cosine distance and exact text returned, and a `listMemories()` page.                                                                                   |
| `pnpm verify:tatum`  | Latest checkpoint, a named transaction's status and balance changes, and the operator agent's USDC balance.                                                                                                                       |
| `pnpm verify:x402`   | Pays the real paywalled endpoint with `X402_CLIENT_PRIVATE_KEY`, then re-verifies the returned digest through Tatum — a second check even though the seller already performed one, so a compromised seller cannot fake a receipt. |

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

| Situation                                    | Behaviour                                                             | Status    |
| -------------------------------------------- | --------------------------------------------------------------------- | --------- |
| Postgres unreachable                         | `/api/health` degraded; pages that need data fail                     | 503       |
| Walrus down at seal time                     | Pick row deleted, nothing claimed                                     | 502       |
| Walrus down at resolve time                  | Outcome rolled back                                                   | 502       |
| Walrus down at reveal / bias / ROI / payment | Operation succeeds; failure logged                                    | 2xx       |
| Tatum down during payment verification       | Signal refused, retried for ~20 s first                               | 402       |
| Tatum slow to index a fresh digest           | Retried 7× with backoff; buyer can re-check the digest without paying | 402 → 200 |
| Tatum down on `/payments`                    | Page renders with `balance: unavailable` and no substitute feed       | 200       |
| x402 facilitator unreachable                 | `UPSTREAM_UNAVAILABLE`; no payment is recorded                        | 502       |
| Signal provider unconfigured                 | Ingest refused, no fabricated data                                    | 503       |
| Signal provider returns 404                  | `NOT_FOUND` for that external id                                      | 404       |
| Signal price changed since ingestion         | Settlement refused before money moves                                 | 409       |
| Digest already used for another signal       | Settlement refused                                                    | 409       |
| Non-operator calls ingest                    | Refused; caller is authenticated, just not an operator                | 403       |
| Signed-out write                             | Refused                                                               | 401       |
| Cross-origin session write                   | Refused                                                               | 403       |
| Malformed or stale detail URL                | Not-found page, no database error                                     | 404       |

The general rule: **the product fails closed and says which layer failed.** It never
substitutes sample data, a cached success, or a placeholder row.

---

## 16. Limitations, stated plainly

- Outcomes are **self-attested**. `sourceUrl` is validated as an http(s) URL but never
  fetched, so the hash and the calibration score do not establish that the cited result is
  true. The UI labels this on every resolved pick.
- Analyst scores are community-attested for the same reason.
- The session cookie has no rotation or revocation list.
- Losing a recovery code loses the journal permanently.
- The rate limiter is per-instance memory.
- Tatum's Sui support is mainnet-only for the interfaces used here.
- The x402 settlement happens before Tatum verification, so a sustained Tatum outage after
  settlement means the buyer has paid and must retry to receive the payload. This is the
  fail-closed trade-off, and it is documented rather than hidden.
- The premium signal used in the recorded purchase is a **synthetic demo payload** from
  `scripts/demo-signal-provider.ts`, not a real forecast product.
- `pnpm verify:x402` has not been run against mainnet; the recorded purchase was made with a
  browser wallet. That row is marked as such in `docs/INTEGRATIONS.md`.
- No public deployment existed when the proof table was written, so recorded settlement
  `resource.url` values point at `http://localhost:3000`.

---

## 17. Glossary

| Term                | Meaning in Saksi                                                                 |
| ------------------- | -------------------------------------------------------------------------------- |
| **Journal**         | One identity (`users` row) with its own Walrus namespace.                        |
| **Pick**            | A prediction committed before an event, identified by a hash.                    |
| **Commitment hash** | `sha256(canonicalJson(payload))`. Proves the pick existed and was not edited.    |
| **Sealed**          | Committed but not yet revealed. Content visible only to the owner.               |
| **Reveal**          | Recompute the hash and publish the content if it still matches.                  |
| **Resolve**         | Attach a result, a source URL and a timestamp; compute the Brier score.          |
| **Credibility**     | Recency-weighted, Wilson-shrunk score from 0 to 100.                             |
| **Bias pattern**    | Repeated losing behaviour, written to memory and cited in later recommendations. |
| **Source ROI**      | Did the premium data I paid for improve my results?                              |
| **Memory kind**     | One of the eight validated `saksi:v1` record types.                              |
| **Namespace**       | `${prefix}:${userId}` — the isolation boundary inside Walrus Memory.             |
| **Citation**        | `{ blobId, text, distance }` for a memory that actually influenced a decision.   |
| **Settlement**      | The on-chain x402 payment, verified through Tatum before data is released.       |

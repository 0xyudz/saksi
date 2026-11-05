# Saksi

**Tamper-evident picks, independently verified outcomes.** Seal a pick before the event,
write the commitment to Walrus Memory, reveal it against the original hash, and resolve it
against an independent results provider that the pick owner does not control. The hash
proves the pick existed before the event and was not edited; the oracle proves the result
was real — or records that it disagreed. Anyone who proves a Sui wallet can sell signals
through an x402 paywall on Sui, and every settlement is verified through Tatum before the
payload is released.

Built for **Total Recall — Tatum × Walrus Memory** (Track 1: Markets & Sports Prediction).

## Status

| Check                                 | Result                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm typecheck`                      | passes                                                                       |
| `pnpm lint`                           | passes                                                                       |
| `pnpm test`                           | 163 tests pass across 19 files                                               |
| `pnpm build`                          | passes (Next.js 16.4.3, Turbopack)                                           |
| Migrations applied to a live database | yes — 7 tables on a live Postgres instance (`0000`–`0007`)                   |
| Walrus Memory (mainnet relayer)       | verified — `pnpm verify:memory` writes, recalls and lists real blobs         |
| Tatum GraphQL (`sui:mainnet`)         | verified — `pnpm verify:tatum` reads checkpoint, transaction and balance     |
| x402 on Sui mainnet                   | verified — one real $0.01 USDC settlement, verified by Tatum and recorded    |
| Oracle verification                   | verified — `site.api.espn.com` returns completed scores for `eng.1` fixtures |
| Full user journey                     | verified — claim, seal, reveal, resolve, recommend and the 402 paywall       |
| Deployed instance                     | yes — <https://saksi-psi.vercel.app> (Vercel, region `sin1`)                 |

Every value in [Proof](#proof) was produced by the command named beside it against Sui
mainnet, and nothing there is estimated. The settlement in that table came from a
self-custody browser wallet signing its own payment, not from an operator key.

Companion documents:

- [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) — how every subsystem works and why each
  decision was made: identity, sealed picks, scoring, Walrus Memory, Tatum, x402, the HTTP
  boundary, rendering, the data model, testing and the failure policy matrix.
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) — the third-party contracts Saksi was built
  against, the exact calls used, and the recorded mainnet proof.

## What is implemented

1. **Sealed picks** — `sha256(canonical(pick))` plus the full payload, committed before the
   event. Public views redact content until reveal; only the owner can reveal or resolve.
   The Walrus commit memory contains the market, commitment hash and timestamp only; a
   separate reveal memory writes the selection and odds after the pick is opened.
2. **Resolution and scoring** — every outcome records how it was established. A pick
   linked to an independent fixture (`espn:eng.1:<id>`, fixed at seal time) is re-read from
   the provider at resolution: agreement stores `oracle_verified`, disagreement stores
   `oracle_contradicted` with both verdicts, and an unreachable provider falls back to
   `self_attested` with a reason. Two scores come out of the same samples — `score` uses
   everything, `verifiedScore` uses only oracle-confirmed outcomes — so a self-graded record
   cannot present itself as a verified one. Brier score, recency-weighted credibility,
   Wilson lower bound, calibration bins and bias patterns are computed from the same set.
3. **Memory-driven recommendations** — Walrus Memory is recalled before a new pick. Each
   warning cites the exact blob and cosine distance from the parsed memory that produced
   it; paid-source ROI is included.
4. **Open signal marketplace on Sui** — any journal that proves a Sui wallet by signature
   can publish a signal and set its price. Publishing costs a flat listing fee settled
   through x402 to the platform; the listing stays invisible until that digest is verified
   through Tatum. Buyers then pay the seller's wallet directly, signing each payment with
   `@mysten/dapp-kit-react`, and Saksi re-verifies the settlement before releasing the
   payload. Receipts are idempotent and bound to one signal and resource; payment and
   source-ROI memories are written after settlement.
5. **On-chain proof** — Tatum GraphQL `checkpoint`, `transaction` and `address.balance`
   queries power the payment ledger, balance, events and explorer links.
6. **Dashboard** — credibility leaderboard with a separate verified score, analyst detail
   with calibration and per-sample verification badges, a seller panel showing settled
   earnings per listing, memory ledger fetched from `listMemories()` (with a truncation
   flag, not a claimed namespace total), and the payment ledger.
7. **Wallet-first identity** — a journal _is_ the Sui address that proved ownership of it.
   There is no user table: the address is the ref, so it cannot collide. Login is a
   signature over a server-issued challenge whose exact bytes are stored, so verification
   can never drift from what the user approved; the nonce is consumed before the signature
   check, so a replay fails even with a valid signature. The handle is a display name read
   from Walrus and is deliberately not unique. A 24-symbol recovery code, written to
   `saksi:recovery:<sha256(code)>`, is the fallback if the wallet is lost.

## Quick start

Requirements:

- Node.js 22.23.4 or newer (verified on 24.18.0)
- pnpm 10.33.0
- PostgreSQL with `gen_random_uuid()` (Postgres 13+)
- Walrus Memory account and delegate key
- Tatum API key and the Sui mainnet GraphQL gateway
- Tentacle Pay facilitator access and a Sui payee address
- A Sui mainnet wallet funded with USDC in the browser that buys signals
- A Sui mainnet wallet in the browser that sells signals (it is the payout address)

```bash
pnpm install
cp .env.example .env.local
# fill every non-optional value in .env.local
pnpm db:migrate
pnpm dev
```

Open `http://localhost:3000` for the landing page, `/how-it-works` for the short
explanation, and `/docs` for the documents in this repository. Create a journal at
`/onboarding`, then visit `/picks/new`. The deployed instance is
<https://saksi-psi.vercel.app> and behaves identically; only `APP_BASE_URL` differs.

> `pnpm build` does not need production credentials. Every runtime entry point validates
> them through `instrumentation.ts` and fails fast when a required value is missing.

## Environment

All values are validated in `lib/env.ts` with zod. Empty strings and malformed URLs,
addresses, networks, prices or namespace prefixes are rejected at startup.

| Variable                         | Required | Purpose                                                                         |
| -------------------------------- | -------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL`                   | yes      | PostgreSQL connection string                                                    |
| `WALRUS_MEMORY_PRIVATE_KEY`      | yes      | MemWal delegate private key                                                     |
| `WALRUS_MEMORY_ACCOUNT_ID`       | yes      | MemWalAccount object id                                                         |
| `WALRUS_MEMORY_RELAYER_URL`      | yes      | Walrus Memory relayer base URL                                                  |
| `WALRUS_MEMORY_NAMESPACE_PREFIX` | yes      | lowercase namespace prefix; user id is appended                                 |
| `TATUM_API_KEY`                  | yes      | sent as `x-api-key` to Tatum                                                    |
| `TATUM_SUI_RPC_URL`              | yes      | Tatum Sui GraphQL endpoint (`/graphql`)                                         |
| `SUI_NETWORK`                    | yes      | `sui:mainnet` or `sui:testnet`                                                  |
| `SUI_USDC_COIN_TYPE`             | yes      | coin type used for balances and verification                                    |
| `AGENT_SUI_ADDRESS`              | yes      | operator wallet used by `pnpm verify:x402` to pay for a signal                  |
| `TATUM_VERIFY_DIGEST`            | no       | required only by `pnpm verify:tatum`                                            |
| `X402_FACILITATOR_URL`           | yes      | Tentacle Pay facilitator                                                        |
| `X402_PAY_TO_ADDRESS`            | yes      | platform address: receives listing fees, and fallback recipient for legacy rows |
| `X402_PRICE`                     | no       | USD string or atomic amount; defaults to `$0.01`                                |
| `X402_LISTING_FEE`               | no       | flat fee a seller pays to publish; defaults to `$0.02`                          |
| `X402_CLIENT_PRIVATE_KEY`        | no       | required only by `pnpm verify:x402`; browser buyers sign with their own wallet  |
| `X402_TEST_SIGNAL_ID`            | no       | required only by `pnpm verify:x402`                                             |
| `ORACLE_ESPN_BASE_URL`           | no       | scoreboard API used to confirm outcomes                                         |
| `ORACLE_ENABLED`                 | no       | `false` leaves every outcome self-attested; defaults to `true`                  |
| `APP_BASE_URL`                   | yes      | public base URL used by the app and scripts                                     |
| `SESSION_SECRET`                 | yes      | at least 32 chars; signs the session cookie                                     |
| `LOG_LEVEL`                      | no       | pino level; defaults to `info`                                                  |
| `WALRUS_RECALL_LIMIT`            | no       | recall size; defaults to 10                                                     |
| `DB_POOL_MAX`                    | no       | per-instance Postgres pool; defaults to 10, lower it on serverless              |

There is no allowlist for sellers and no provider credential to configure. Any journal that
has bound a Sui wallet by signature may publish a signal; the wallet is where buyers pay.
Selling is gated on proof, not on membership.

`X402_PRICE` and `X402_LISTING_FEE` are both validated against the Sui gasless minimum of
`0.01` USDC at startup. A lower value builds a sponsored transaction the network rejects
with `InsufficientGas`, so the misconfiguration fails before a buyer or seller sees it.
Startup also refuses a `TATUM_SUI_RPC_URL` whose host does not contain the network named by
`SUI_NETWORK`, and — when `X402_CLIENT_PRIVATE_KEY` is present — an `AGENT_SUI_ADDRESS` that
does not match that key.

### How the platform earns

Saksi charges a **flat listing fee**, never a percentage of a sale. The seller signs one
x402 `exact` settlement of `X402_LISTING_FEE` to `X402_PAY_TO_ADDRESS`; the listing stays
invisible until that digest is verified through Tatum, and the digest is unique so one fee
publishes exactly one signal. Buyers then pay the seller's wallet directly, so Saksi never
holds anyone's money and there is no balance to withdraw.

A percentage split is not implementable here: x402 `exact` pays a single recipient per
settlement, and Sui's gasless mode only permits `balance::send_funds` — every coin-splitting
command (`coin::take`, `coin::from_balance`, `TransferObjects`) is rejected as an
unsupported function in gasless transactions. The fee is therefore charged on the publish
step instead of being carved out of the sale.

## Deploying to Vercel

`vercel.json` pins the function region to `sin1` because the live Postgres instance runs in
`ap-southeast-1`. Change both together, or every query crosses an ocean.

1. Import the repository in Vercel and set every required variable from the table above.
   Use the production values, not the local ones.
2. Set `APP_BASE_URL` to the deployment URL (for example
   `https://saksi.vercel.app`). It is used for session `Origin` checks and for the x402
   `resource.url`, so a wrong value breaks purchases.
3. Set `DB_POOL_MAX=3`. Each serverless instance keeps its own pool, so the local default
   of 10 multiplies across instances and can exhaust a small Postgres plan. Prefer a
   pooled connection string from your provider.
4. Run `pnpm db:migrate` once against the production database. It is not part of the build.
5. Open `/api/health` after the first deploy; it must report `database`, `walrus` and
   `tatum` as ok before you demo a purchase.

Serverless caveats that the local run does not have:

- The rate limiter in `lib/rate-limit.ts` is per-instance memory, so on Vercel it only
  blunts a single instance's traffic. Add an edge or gateway limiter for real protection.
- Routes that call Walrus or Tatum declare `maxDuration = 60`, which covers the ~20s Tatum
  settlement retry. A shorter platform limit would cut that retry short.
- Settlement `resource.url` values recorded before the first deploy point at
  `http://localhost:3000`. They remain valid receipts for those payments, but new
  settlements should be recorded after `APP_BASE_URL` is correct.

A step-by-step checklist with the full variable list lives in
[docs/DEPLOY.md](docs/DEPLOY.md).

## Architecture

```txt
app/                     routing, server components, client forms
  api/                   HTTP boundaries; zod input, AppError, JSON logs
server/                  use-cases, scoring, data access, presenters
  usecases/              create/reveal/resolve/recommend/publish/purchase
  scoring/               pure Brier, credibility, bias, commitment functions
  data/                  SQL reads and composition
integrations/            third-party SDKs only here
  walrus-memory/         MemWal client + deterministic memory schema
  tatum/                 typed RPC client + payment verification
  oracle/                independent match results + selection parsing
  x402/                  seller, buyer, receipt parsing
db/                      Drizzle schema, client, generated migrations
lib/                     env, config, errors, logger, canonical JSON, HTTP, price
scripts/                 live verification scripts
tests/                   pure-function unit tests only
```

Rules enforced throughout:

- UI never imports a third-party SDK. Pages call `server/` functions; client forms call
  internal API routes.
- Every external boundary is validated with zod: env, HTTP bodies, RPC envelopes, provider
  responses, x402 receipts and memory text.
- `AppError` carries a typed code and HTTP status. Unexpected errors are logged with a
  request id and returned with a generic message.
- No `any`, `as unknown as`, `@ts-ignore`, empty catch, or `console.log`.
- No mocks, faker, fixtures or fake fallbacks in runtime paths.

## Data model

Seven tables: `analysts`, `picks`, `outcomes`, `signals`, `payments`, `wallet_challenges`,
`recommendations`. See `db/schema.ts`.

There is no `users` table. A journal is the Sui address that proved ownership of it, so
identity is a signature rather than a row. `picks.journal_ref`, `signals.seller_ref` and
`payments.journal_ref` hold that ref — a lowercase address for journals created after
migration `0007`, or a uuid for journals created before it, because Walrus is append-only and
their memories already live in `saksi:<uuid>`. The handle survives only as a display name in
Walrus, which is why it is no longer unique.

Key constraints:

- `picks.commitmentHash` stores the canonical SHA-256 commitment.
- `outcomes.pickId` is unique.
- `payments.digest` is unique, making settlement recording and buyer claiming idempotent.
- `signals(provider, externalRef)` is unique, and `listing_fee_digest` is unique so one fee
  publishes exactly one listing.
- Walrus memory kinds are split by lifecycle: `pick_commit` (market, hash, timestamp),
  `pick_reveal` (selection, odds, reveal time), then `outcome`, `bias`, `source_roi`,
  `payment` and `preference`. `journal` and `recovery` are identity records and are excluded
  from journal history. Legacy `pick` records remain readable and are never written.
- Analysts are global, not owned by a journal, so deleting a journal leaves its analysts
  behind. Clean them up deliberately rather than by cascade:

  ```sql
  delete from analysts
  where not exists (select 1 from picks p where p.analyst_id = analysts.id);
  ```

Generate a migration after schema changes:

```bash
pnpm db:generate
pnpm db:migrate
```

If drizzle-kit wants to confirm a column rename it needs a TTY and will refuse in a scripted
shell; write the migration SQL by hand and add its entry to
`db/migrations/meta/_journal.json`. That is how `0007_journal_identity.sql` was written.

All seven migrations (`0000`–`0007`) are applied to the live database this project was built
against, and `pnpm db:migrate` must be run once against any new database before the app
starts.

## Routes

The site has a marketing surface and the journal itself. The landing page owns `/`; the
journal lives under `/dashboard` so a reviewer can read what Saksi is before creating
anything.

Marketing:

| Route                   | Purpose                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| `/`                     | landing page: what Saksi is, the four steps, the stack, the honest limits    |
| `/how-it-works`         | the lifecycle, the canonical hash, the scoring formula and the x402 sequence |
| `/docs`                 | index of the documents below                                                 |
| `/docs/[slug]`          | renders `README.md` and the four files in `docs/` directly, statically       |
| `/journals`             | live journal list read from the relayer, no SQL                              |
| `/journals/[namespace]` | one journal's history rebuilt from its Walrus memories                       |

Journal:

| Route                                 | Purpose                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| `/dashboard`                          | stats, seller earnings panel, leaderboard, latest picks, memory decision, Tatum feed |
| `/onboarding`                         | claim a handle by proving a wallet; shows the one-time recovery code                 |
| `/resume`                             | sign in with the recovery code alone; no handle is asked for                         |
| `/settings/wallet`                    | read-only: the address that _is_ the journal, and how the signature proof works      |
| `/picks`, `/picks/new`, `/picks/[id]` | ledger, sealed pick form with oracle fixture picker, proof detail + reveal/resolve   |
| `/analysts`, `/analysts/[id]`         | leaderboard, verified score, calibration and per-sample verification                 |
| `/memory`                             | relayer health, fetched `listMemories()` pages, recall with paired citations         |
| `/signals`, `/signals/[id]`           | marketplace listing, publish panel and paid purchase panel                           |
| `/payments`                           | settlement ledger, merchant balance, events, manual digest verification              |

API:

| Route                          | Notes                                                      |
| ------------------------------ | ---------------------------------------------------------- |
| `POST /api/picks`              | seal a pick; rolls back on memory failure                  |
| `POST /api/picks/[id]/reveal`  | owner only; hash + time-lock checked                       |
| `POST /api/picks/[id]/resolve` | owner only; oracle consulted, contradiction recorded       |
| `GET /api/oracle/fixtures`     | fixtures for one league/date, so a picker can link one     |
| `POST /api/recommendations`    | recall before deciding; persists citations                 |
| `GET /api/signals`             | public catalogue; only fee-verified listings appear        |
| `POST /api/signals`            | x402 listing fee, then publish; wallet proof required      |
| `GET /api/signals/[id]`        | x402 paywall; Tatum verification before release            |
| `POST /api/payments/verify`    | read-only Tatum check; reports `recorded`, never inserts   |
| `GET /api/payments`            | ledger + Tatum merchant balance/events                     |
| `GET /api/health`              | database + Walrus + Tatum checks, no secrets               |
| `PUT /api/session`             | issue a single-use signature challenge (claim/login)       |
| `POST /api/session`            | claim a handle with the wallet signature; returns the code |
| `POST /api/session/wallet`     | sign in by proving the wallet; the address is the journal  |
| `PATCH /api/session`           | resume with the recovery code; rate limited                |
| `DELETE /api/session`          | log out                                                    |

## Verification scripts

All scripts load `.env.local` then `.env` (same precedence as Next.js), call real
services, print JSON lines, and exit non-zero on failure. None contains sample values.

```bash
# Requires DATABASE_URL, Walrus credentials, and at least one journal user.
pnpm verify:memory

# Requires TATUM_* and TATUM_VERIFY_DIGEST.
pnpm verify:tatum

# Requires the app running at APP_BASE_URL, a real signal id, and X402_CLIENT_PRIVATE_KEY.
pnpm verify:x402
```

`verify:memory` writes a uniquely marked preference memory, recalls it, asserts the exact
text is returned, and prints the blob ID plus relayer count. `verify:tatum` checks the
latest checkpoint, a real transaction and the operator wallet balance. `verify:x402` buys
the paywalled signal, prints the digest, and independently verifies it through Tatum.

Two more scripts exist because two claims could not be verified any other way:

```bash
# Rebuilds every journal's credibility from Walrus alone and diffs it against Postgres.
pnpm verify:reconstruct

# Seeds a synthetic journal so the bias detector has something to detect.
pnpm demo:seed https://saksi-psi.vercel.app <out-file-outside-the-repo>
```

`demo:seed` claims its own journal (`@demo_loop`) by signing a real challenge with a freshly
generated keypair, then writes five winning favourites and two losing underdogs. Everything
it writes is prefixed `synthetic demo` and its outcomes are `self_attested`, so nothing in it
can be mistaken for a real forecast. It writes only the recovery code to `<out-file>` (mode
`0600`); the private key is never persisted. Pass `--wallet 0x...` to seed an existing
journal instead, in which case no file is written.

## Tests

```bash
pnpm test
```

Unit tests cover only pure code: canonical JSON and SHA-256, memory build/parse/escaping,
payment-to-signal binding and retry classification, signal-provider status mapping,
session-cookie signing, coin type normalization, Brier and calibration, credibility decay,
bias detection, and price conversion. Walrus, Tatum and x402 are deliberately not mocked;
they are exercised by the scripts above.

### End-to-end checks against a running instance

The table below is the contract each step must satisfy, exercised against `pnpm dev` with
live Walrus, Tatum and Postgres. Steps marked **exercised** were re-run against the current
build; the wallet-signature steps need a browser wallet and are listed with the response the
server is expected to return.

| Step                                  | Expected                                                         | Verified how      |
| ------------------------------------- | ---------------------------------------------------------------- | ----------------- |
| `PUT /api/session`                    | 201 with a single-use challenge and the exact message to sign    | unit + route code |
| `POST /api/session`                   | 201, session cookie, and a 24-symbol recovery code               | browser wallet    |
| `POST /api/analysts`                  | 201                                                              | exercised         |
| `POST /api/picks`                     | 201 with a commitment hash and a Walrus blob id                  | exercised         |
| `GET /api/picks/[id]`                 | owner sees the selection; an anonymous caller gets it redacted   | exercised         |
| `POST /api/picks/[id]/reveal`         | 200, hash re-verified before the selection is exposed            | exercised         |
| `POST /api/picks/[id]/resolve`        | 201 with a Brier score, a verification state and an outcome blob | exercised         |
| `POST /api/memory/preferences`        | 201 with a blob id                                               | exercised         |
| `POST /api/recommendations`           | 201, verdict plus citations that carry blob ids                  | exercised         |
| `GET /api/signals`                    | 200; only listings whose fee digest was verified appear          | exercised         |
| `POST /api/signals` unauthenticated   | 401, before any payment is requested                             | exercised         |
| `POST /api/signals` without a payment | 402 with a `payment-required` listing-fee challenge              | browser wallet    |
| `PATCH /api/session` wrong code       | 401, with the same body as an unknown handle                     | exercised         |
| `PATCH /api/session` real code        | 200, and the resumed session still owns its sealed pick          | exercised         |
| `GET /api/signals/[id]`               | 402 with a `payment-required` challenge for the seller's address | exercised         |
| `POST /api/payments/verify`           | 200, `verified: true`, and `recorded` reflects the ledger only   | exercised         |
| 34 rapid requests to one signal       | 30 × 402 then 429, confirming the per-IP limiter                 | exercised         |
| `POST /api/picks` unauthenticated     | 401                                                              | exercised         |
| `GET /picks/not-a-uuid`               | 404 not-found page, with no `Failed query` in the response       | exercised         |

## Security notes

- Sealed pick content is redacted for every non-owner until reveal.
- A commitment hash proves the pick existed before the event and was not edited. It does
  **not** prove the outcome is true. Only a pick linked to an independent fixture and
  confirmed by the provider is `oracle_verified`; everything else is labelled
  `self-attested`, and a provider disagreement is stored as `oracle_contradicted` with both
  verdicts rather than overwriting the owner's claim.
- Analyst scores are computed from all resolved outcomes, but a separate `verifiedScore`
  uses only oracle-confirmed ones. A contradicted claim is scored as what the provider
  actually recorded, and the leaderboard ranks by `verifiedScore` first and the claimed
  `score` second, so a self-graded record cannot outrank a verified one.
- The wallet address a buyer pays is copied onto the signal row at listing time, so a later
  wallet change cannot redirect a live listing's proceeds without a new settlement.
- A listing fee digest is unique, so one settlement publishes exactly one signal; a seller
  cannot replay a fee across many listings.
- Reveal and resolve are owner-only; resolution requires a valid hash and a prior reveal.
- Payment release requires Tatum-verified status, recipient, coin and amount. A digest is
  bound to one signal and one x402 resource, so it cannot be replayed for a different
  purchase. `/api/payments/verify` only reads and reports; it never creates a payment row
  or a memory write.
- `payments.digest` uniqueness prevents double-recording a settlement.
- Wallet login signs a server-issued challenge whose exact bytes are stored in
  `wallet_challenges.message`, so verification cannot drift from what the user approved. The
  nonce is consumed atomically **before** the signature check, so a replayed nonce fails
  even with a valid signature. Login also compares the proven challenge address with the
  address in the request body, so a signature for one wallet cannot claim another.
- A listing body is validated before the x402 facilitator settles the listing fee. Invalid
  input therefore returns `400` without moving money, and a valid body without payment still
  receives the `402` challenge.
- Session cookies are `<userId>.<hmac-sha256>` signed with `SESSION_SECRET`; old unsigned
  cookies and tampered signatures are treated as no session.
- `instrumentation.ts` validates credentials before serving traffic.
- pino redacts authorization, cookie, `x-api-key`, private key, API key, secret and raw
  fields.
- Session-bearing `POST`/`DELETE` routes require a same-origin `Origin` or an explicit
  `x-saksi-client: agent` header. The public x402 agent route keeps the looser origin rule.
- `/api/payments/verify` and `GET /api/signals/[id]` have an in-memory per-IP limiter
  (10/min and 30/min). It is per-instance only and does not replace an edge limiter.
- Detail routes validate the id shape before querying Postgres, so a malformed or stale
  link renders the not-found page with a real `404` instead of a database error page.
- Pages are server rendered. The Sui wallet provider is mounted from the root layout
  without `ssr: false`; it only registers browser wallet initializers when `window`
  exists, so the HTML is complete before hydration.

## Proof

Every value below is copied from real command output against Sui mainnet. No value is
estimated, and anything not yet captured is marked `not captured` rather than guessed. Two
values move on their own: a Walrus write produces a new blob id on every run, and Tatum's
checkpoint advances continuously. The blob id and distance below are from one recorded run;
re-running `verify:memory` proves the same path with fresh values.

| Proof                               | Value                                                                                             | Produced by                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------- |
| Walrus Memory relayer               | `status: ok`, relayer `0.1.0`                                                                     | `pnpm verify:memory`             |
| Walrus Memory blob ID (fresh write) | `9omuWV3m0_gRnMKbgqFnwpY6TjI2ihZR_A2ZElXOrLY`                                                     | `pnpm verify:memory`             |
| Walrus Memory recall distance       | `0.35216430960754486` (cosine)                                                                    | `pnpm verify:memory`             |
| Walrus Memory blob ID (sealed pick) | `RruPtIKgN3QZyEmUNOIVqA_yrk8mBylE8Bsg4h9O0NA` (`pick_commit`)                                     | relayer read                     |
| Walrus Memory blob ID (payment)     | `iQkdVACTG5arG58RDCnYr74_dJPeueaeJ9NTGheeBRA` (`payment`)                                         | relayer read                     |
| Walrus Memory blob ID (source ROI)  | `KkHx_aFl4YkIBBGF3bQ4hMMljtdhshUUTVMxhEqbjcE` (`source_roi`)                                      | relayer read                     |
| Mainnet namespaces                  | 21 under `saksi:`, 73 memories: 65 across 14 journal namespaces, 4 identity records, 4 probes     | `listNamespaces()`               |
| Identity resolved without SQL       | wallet `0xe47cc1da…` → `@saksi_dev` in 5939 ms; unknown wallet → none in 390 ms                   | `readJournalRecord()`            |
| Reconstruction from Walrus          | `mismatches: 0` - rebuilt credibility equals the Postgres figures for every analyst               | `pnpm verify:reconstruct`        |
| Memory changes a verdict            | bias memory `2 of 2 underdog picks (odds >= 2.5) lost` moved `proceed` -> `reduce` on a live call | `pnpm demo:seed`                 |
| Tatum checkpoint                    | `341329560` (advances; any recent value proves the query)                                         | `pnpm verify:tatum`              |
| Tatum transaction digest            | `DemaKkYM7Ni4mRJcxbth3e4h3BkkqgKnR1MYPdWhmgjq` — status `success`, 2 balance changes              | `pnpm verify:tatum`              |
| x402 settlement digest              | `DemaKkYM7Ni4mRJcxbth3e4h3BkkqgKnR1MYPdWhmgjq` — 10000 atomic USDC, `sui:mainnet`                 | browser wallet + Tatum           |
| x402 payer                          | `0xe47cc1da1a36461dbfbc2431b36b8579403d105d8d2a6fe05c442071905d8900`                              | `payments`                       |
| x402 merchant                       | `0x5fb8e783752ba7ec09ee4c7c7a91bb51a4a643cd8a7473643a95c1a56b7e6432`                              | `.env.local` payee               |
| Merchant USDC balance after settle  | `10000` atomic ($0.01)                                                                            | Tatum GraphQL                    |
| Agent (operator) USDC balance       | `0` — the operator key never paid; the buyer did                                                  | `pnpm verify:tatum`              |
| Explorer link                       | <https://suivision.xyz/txblock/DemaKkYM7Ni4mRJcxbth3e4h3BkkqgKnR1MYPdWhmgjq>                      | chain                            |
| Oracle fixtures read                | 8 completed `eng.1` fixtures on 2026-10-31, each resolving to exactly one winner                  | `pnpm verify:oracle`             |
| Oracle verified outcome             | pick `a228a98a…` — "Chelsea to win", provider `Chelsea 2-0 Manchester United`, `oracle_verified`  | `outcomes`                       |
| Oracle contradicted outcome         | pick `ae1de891…` — claimed win, provider made it a loss, stored `oracle_contradicted`             | `outcomes`                       |
| Wallet signature rejected           | malformed 64-byte signature → `401`, not `500` (regression fixed)                                 | `tests/wallet-signature.test.ts` |
| Legacy journal refused for selling  | uuid-ref session → `403`, asking for a wallet-claimed journal                                     | `requireSellerUserId()`          |
| Listing fee challenge               | `402`, `amount=20000` atomic ($0.02), `payTo` = platform, `sui:mainnet`                           | probe against live server        |
| Public journal read                 | `/journals` 200 with 14 namespaces; `/journals/<uuid>` 200; `other:123` → 404                     | live deployment                  |
| Dashboard screenshot                | not captured                                                                                      | —                                |

Reproduce the script-backed rows with:

```bash
pnpm verify:memory   # relayer status, blob ID, recall distance, listMemories count
pnpm verify:tatum    # checkpoint, transaction status, balance changes, operator balance
pnpm verify:oracle   # real completed fixtures, one winner per match, source URLs
```

The x402 row is a browser-driven purchase: the buyer connected their own Sui wallet,
signed the settlement themselves, and the seller released the payload only after Tatum
confirmed the digest. `payments.digest` is unique, so re-running the recorder on that
digest returns the existing row instead of charging twice.

The signal behind that settlement is a catalogue row whose payload is labelled **synthetic
demo payload** everywhere it appears. It exists to exercise the paywall, not to claim a real
forecast was sold.

Some of those memories came from the end-to-end checks above, whose journals were deleted
afterwards. Walrus blobs cannot be deleted once written, so the memory count is higher than
the number of surviving journals. There is no local write log to consult: the relayer is the
only record, which is exactly what `listNamespaces()` reads.
`listMemories()` returns 10 for `saksi_demo`, 6 for `oracle_backtest`, 2 for `testdemo` and
1 for `demo_buyer`, all with `hasMore: false`. Each `pnpm verify:memory` run writes one more
`preference` memory, so that count grows by one per run.

## Known limitations and risks

- Oracle verification covers **one league and one market**: English Premier League
  (`espn:eng.1`) match-winner selections written as `"<Team> to win"` or `"draw"`. Every
  other market resolves as `self_attested`, is labelled that way in the UI, and contributes
  nothing to a seller's verified score. The boundary is deliberate: an oracle that silently
  passed on everything else would look like verification while verifying nothing.
- A contradicted claim is preserved rather than rejected. When the provider disagrees, the
  row is stored as `oracle_contradicted` with both verdicts and the provider's fixture id, so
  the owner's claim stays auditable while earning no verified credit.
- Outcomes outside the oracle's scope are self-attested. `sourceUrl` is validated as an
  http(s) URL but its content is never fetched, so the hash and the calibration score do not
  establish that the cited result is true.
- The recorded proof that memory changes a verdict comes from a **synthetic** journal
  (`@demo_loop`) created by `pnpm demo:seed`, not from a real user's betting history. It
  proves the detector and the downgrade path work end to end on live infrastructure; it does
  not prove the pattern was ever true of a real person. Every record it wrote is prefixed
  `synthetic demo` and marked `self_attested`, and the live database before it had no bias
  memory at all because all four resolved picks happened to win.
- Tatum serves Sui over GraphQL (`/graphql`) and gRPC only; JSON-RPC is deprecated. This
  client targets the mainnet GraphQL gateway, so a testnet deployment would need a gRPC
  client that this repository does not implement.
- Tentacle Pay's Sui seller guide recommends Node.js 24+; this project requires 22.23.4+
  and was built/tested on 24.18.0.
- The x402 settlement happens before Tatum verification. If Tatum stays unavailable after a
  successful settlement, the buyer has paid but does not receive the payload until a retry
  succeeds. This is an intentional fail-closed trade-off; the digest remains verifiable
  through `/api/payments/verify`. A freshly settled digest is not indexed by Tatum
  immediately, so the seller retries for roughly 20 s (7 attempts, 750 ms base delay, 5 s
  ceiling) before giving up; treating that lag as permanent previously returned 402 to a
  buyer who had already paid.
- The signal catalogue has no provider contract to configure. Sellers write the payload
  themselves, and Saksi stores it verbatim without asserting its accuracy.
- Sessions are a local, HMAC-signed cookie containing the journal ref. Signing prevents
  forgery, but this is still a hackathon identity model rather than production
  authentication (no expiry rotation or revocation list).
- A journal _is_ its Sui address: signing in means proving that wallet with a single-use
  challenge. A 24-symbol recovery code is issued once at creation and written to a
  `saksi:recovery:<sha256(code)>` namespace, so it can restore access when the wallet is gone
  without any database column holding a credential. Losing both means the journal cannot be
  recovered: `sealed` picks stay sealed forever. Journals created before this existed can be
  given a code by an operator with `pnpm recovery:issue <wallet> <file>`, which is a CLI
  rather than an endpoint so nobody can mint a code for someone else's wallet.
- The handle is a display name, not a claim. Two journals may show the same `@name`; what is
  unique is the wallet, because the wallet is the ref and cannot be shared without sharing a
  private key. This was chosen over unique handles because Walrus has no unique constraint,
  and a check-then-write race on a handle would merge two journals into one namespace.
- Publishing is open to any journal with a proven wallet and is rate limited to 10 requests
  per minute. Buying a listed signal is open to anyone with a wallet.
- The in-memory rate limiter is not shared between server instances.

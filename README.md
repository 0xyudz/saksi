# Saksi

**Tamper-evident picks, source-cited outcomes.** Seal a pick before the event, write the
commitment to Walrus Memory, reveal it against the original hash, resolve it with a real
source URL, and let your own history change the next decision. The hash proves the pick
existed before the event and was not edited; the outcome itself is self-attested by the
pick owner and is not independently verified. Premium signals are sold per call through
an x402 paywall on Sui and verified through Tatum before release.

Built for **Total Recall — Tatum × Walrus Memory** (Track 1: Markets & Sports Prediction).

## Status

| Check                                 | Result                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm typecheck`                      | passes                                                                    |
| `pnpm lint`                           | passes                                                                    |
| `pnpm test`                           | 105 tests pass across 14 files                                            |
| `pnpm build`                          | passes (Next.js 16.4.3, Turbopack)                                        |
| Migrations generated                  | `0000`, `0001`, `0002_graceful_vindicator.sql`                            |
| Migrations applied to a live database | yes — 8 tables on a live Postgres instance                                |
| Walrus Memory (mainnet relayer)       | verified — `pnpm verify:memory` writes, recalls and lists real blobs      |
| Tatum GraphQL (`sui:mainnet`)         | verified — `pnpm verify:tatum` reads checkpoint, transaction and balance  |
| x402 on Sui mainnet                   | verified — one real $0.01 USDC settlement, verified by Tatum and recorded |
| Full user journey                     | verified — seal, reveal, resolve, recommend, ingest and the 402 paywall   |
| Deployed instance                     | no — the app runs locally at `http://localhost:3000`                      |

Every value in [Proof](#proof) was produced by the command named beside it against Sui
mainnet on 2 Nov 2026, and nothing there is estimated. The settlement in that table came
from a self-custody browser wallet signing its own payment, not from an operator key.

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
2. **Resolution and scoring** — outcomes are **self-attested**: the owner supplies
   `sourceUrl` and `resolvedAt`, and the UI labels the result accordingly. Brier score,
   recency-weighted credibility, Wilson lower bound, calibration bins, and bias patterns
   are computed from those community-attested outcomes, not from an independent oracle.
3. **Memory-driven recommendations** — Walrus Memory is recalled before a new pick. Each
   warning cites the exact blob and cosine distance from the parsed memory that produced
   it; paid-source ROI is included.
4. **x402 premium signals on Sui** — seller paywall with Tentacle Pay facilitator, a
   browser wallet signing each payment through `@mysten/dapp-kit-react`, Tatum
   verification before the payload leaves the server, idempotent receipts bound to one
   signal and resource, read-only digest inspection, and payment/source-ROI memories.
5. **On-chain proof** — Tatum GraphQL `checkpoint`, `transaction` and `address.balance`
   queries power the payment ledger, balance, events and explorer links.
6. **Dashboard** — credibility leaderboard, analyst detail with calibration, memory ledger
   fetched from `listMemories()` (with a truncation flag, not a claimed namespace total),
   payment ledger and signal pages.
7. **Recoverable journal identity** — a journal is created without email or password and
   returns a 24-symbol recovery code exactly once. The code is stored as a scrypt hash
   (`N=16384, r=8, p=1`), compared in constant time, and accepted in any case or grouping.
   `/resume` restores the session; a wrong handle and a wrong code return the same 401.

## Quick start

Requirements:

- Node.js 22.23.4 or newer (verified on 24.18.0)
- pnpm 10.33.0
- PostgreSQL with `gen_random_uuid()` (Postgres 13+)
- Walrus Memory account and delegate key
- Tatum API key and the Sui mainnet GraphQL gateway
- Tentacle Pay facilitator access and a Sui payee address
- A Sui mainnet wallet funded with USDC in the browser that buys signals
- Optionally, a premium signal provider implementing the contract below

```bash
pnpm install
cp .env.example .env.local
# fill every non-optional value in .env.local
pnpm db:migrate
pnpm dev
```

Open `http://localhost:3000` for the landing page, `/how-it-works` for the short
explanation, and `/docs` for the documents in this repository. Create a journal at
`/onboarding`, then visit `/picks/new`.

> `pnpm build` does not need production credentials. Every runtime entry point validates
> them through `instrumentation.ts` and fails fast when a required value is missing.

## Environment

All values are validated in `lib/env.ts` with zod. Empty strings and malformed URLs,
addresses, networks, prices or namespace prefixes are rejected at startup.

| Variable                         | Required | Purpose                                                                        |
| -------------------------------- | -------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`                   | yes      | PostgreSQL connection string                                                   |
| `WALRUS_MEMORY_PRIVATE_KEY`      | yes      | MemWal delegate private key                                                    |
| `WALRUS_MEMORY_ACCOUNT_ID`       | yes      | MemWalAccount object id                                                        |
| `WALRUS_MEMORY_RELAYER_URL`      | yes      | Walrus Memory relayer base URL                                                 |
| `WALRUS_MEMORY_NAMESPACE_PREFIX` | yes      | lowercase namespace prefix; user id is appended                                |
| `TATUM_API_KEY`                  | yes      | sent as `x-api-key` to Tatum                                                   |
| `TATUM_SUI_RPC_URL`              | yes      | Tatum Sui GraphQL endpoint (`/graphql`)                                        |
| `SUI_NETWORK`                    | yes      | `sui:mainnet` or `sui:testnet`                                                 |
| `SUI_USDC_COIN_TYPE`             | yes      | coin type used for balances and verification                                   |
| `AGENT_SUI_ADDRESS`              | yes      | operator wallet used by `pnpm verify:x402` to pay for a signal                 |
| `TATUM_VERIFY_DIGEST`            | no       | required only by `pnpm verify:tatum`                                           |
| `X402_FACILITATOR_URL`           | yes      | Tentacle Pay facilitator                                                       |
| `X402_PAY_TO_ADDRESS`            | yes      | Sui recipient of signal payments                                               |
| `X402_PRICE`                     | no       | USD string or atomic amount; defaults to `$0.01`                               |
| `X402_CLIENT_PRIVATE_KEY`        | no       | required only by `pnpm verify:x402`; browser buyers sign with their own wallet |
| `X402_TEST_SIGNAL_ID`            | no       | required only by `pnpm verify:x402`                                            |
| `SIGNAL_PROVIDER_API_URL`        | no       | optional pair with the next value                                              |
| `SIGNAL_PROVIDER_API_KEY`        | no       | optional pair with the previous value                                          |
| `OPERATOR_HANDLES`               | no       | comma-separated handles allowed to ingest signals; empty disables ingest       |
| `APP_BASE_URL`                   | yes      | public base URL used by the app and scripts                                    |
| `SESSION_SECRET`                 | yes      | at least 32 chars; signs the session cookie                                    |
| `LOG_LEVEL`                      | no       | pino level; defaults to `info`                                                 |
| `WALRUS_RECALL_LIMIT`            | no       | recall size; defaults to 10                                                    |
| `DB_POOL_MAX`                    | no       | per-instance Postgres pool; defaults to 10, lower it on serverless             |

`SIGNAL_PROVIDER_API_URL` and `SIGNAL_PROVIDER_API_KEY` must be set together. When both
are absent, signal ingestion returns 503 rather than inventing provider data. Ingestion is
additionally gated on `OPERATOR_HANDLES`: a journal that is not listed gets 403, and an
empty list disables the endpoint entirely, because each ingest spends the operator's paid
provider quota. Startup also refuses a `TATUM_SUI_RPC_URL` whose host does not contain the
network named by `SUI_NETWORK`, and — when `X402_CLIENT_PRIVATE_KEY` is present — an
`AGENT_SUI_ADDRESS` that does not match that key.

### Signal provider contract

```http
GET {SIGNAL_PROVIDER_API_URL}/{externalId}
Authorization: Bearer {SIGNAL_PROVIDER_API_KEY}

200 { "provider": "name", "title": "headline", "payload": { ... } }
```

Additional fields are allowed; `provider`, `title` and `payload` are required.

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
  usecases/              create/reveal/resolve/recommend/ingest/purchase
  scoring/               pure Brier, credibility, bias, commitment functions
  data/                  SQL reads and composition
integrations/            third-party SDKs only here
  walrus-memory/         MemWal client + deterministic memory schema
  tatum/                 typed RPC client + payment verification
  x402/                  seller, buyer, receipt parsing
integrations/signals/    premium provider HTTP contract
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

`users`, `analysts`, `picks`, `outcomes`, `signals`, `payments`, `memory_writes`,
`recommendations`. See `db/schema.ts`.

Key constraints:

- `picks.commitmentHash` stores the canonical SHA-256 commitment.
- `outcomes.pickId` is unique.
- `payments.digest` is unique, making settlement recording and buyer claiming idempotent.
- `signals(provider, externalRef)` is unique, so provider re-ingestion updates the listing.
- `memory_writes` is an audit trail only; `/memory` reads the relayer.
- Walrus memory kinds are split by lifecycle: `pick_commit` (market, hash, timestamp),
  `pick_reveal` (selection, odds, reveal time), then `outcome`, `bias`, `source_roi`,
  `payment` and `preference`. Legacy `pick` records remain readable and are never written.
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

All three migrations (`0000`, `0001_worried_satana.sql`, `0002_graceful_vindicator.sql`) are
applied to the live database this project was built against, and `pnpm db:migrate` must be run
once against any new database before the app starts.

## Routes

The site has a marketing surface and the journal itself. The landing page owns `/`; the
journal lives under `/dashboard` so a reviewer can read what Saksi is before creating
anything.

Marketing:

| Route           | Purpose                                                                      |
| --------------- | ---------------------------------------------------------------------------- |
| `/`             | landing page: what Saksi is, the four steps, the stack, the honest limits    |
| `/how-it-works` | the lifecycle, the canonical hash, the scoring formula and the x402 sequence |
| `/docs`         | index of the documents below                                                 |
| `/docs/[slug]`  | renders `README.md` and the four files in `docs/` directly, statically       |

Journal:

| Route                                 | Purpose                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| `/dashboard`                          | stats, credibility leaderboard, latest picks, memory decision, Tatum settlement feed |
| `/onboarding`                         | create a journal identity; shows the one-time recovery code                          |
| `/resume`                             | resume an existing journal with its handle and recovery code                         |
| `/picks`, `/picks/new`, `/picks/[id]` | ledger, sealed pick form, proof detail + reveal/resolve                              |
| `/analysts`, `/analysts/[id]`         | leaderboard and calibration/evidence                                                 |
| `/memory`                             | relayer health, fetched `listMemories()` pages, recall with paired citations         |
| `/signals`, `/signals/[id]`           | provider listings and paid purchase panel                                            |
| `/payments`                           | settlement ledger, merchant balance, events, manual digest verification              |

API:

| Route                          | Notes                                                    |
| ------------------------------ | -------------------------------------------------------- |
| `POST /api/picks`              | seal a pick; rolls back on memory failure                |
| `POST /api/picks/[id]/reveal`  | owner only; hash + time-lock checked                     |
| `POST /api/picks/[id]/resolve` | owner only; source URL + timestamp required              |
| `POST /api/recommendations`    | recall before deciding; persists citations               |
| `GET /api/signals/[id]`        | x402 paywall; Tatum verification before release          |
| `POST /api/payments/verify`    | read-only Tatum check; reports `recorded`, never inserts |
| `GET /api/payments`            | ledger + Tatum merchant balance/events                   |
| `GET /api/health`              | database + Walrus + Tatum checks, no secrets             |
| `POST /api/session`            | create a journal; returns the recovery code once         |
| `PATCH /api/session`           | resume with handle + recovery code; rate limited         |
| `DELETE /api/session`          | log out (needs the recovery code to come back)           |

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

The journey below was exercised against `pnpm dev` with live Walrus, Tatum and Postgres.
Every step is an HTTP call, so it can be re-run against a deployment:

| Step                              | Expected                                                       |
| --------------------------------- | -------------------------------------------------------------- |
| `POST /api/session`               | 201, signed session cookie, and a 24-symbol recovery code      |
| `POST /api/analysts`              | 201                                                            |
| `POST /api/picks`                 | 201 with a commitment hash and a Walrus blob id                |
| `GET /api/picks/[id]`             | owner sees the selection; an anonymous caller gets it redacted |
| `POST /api/picks/[id]/reveal`     | 200, hash re-verified before the selection is exposed          |
| `POST /api/picks/[id]/resolve`    | 201 with a Brier score and an outcome blob                     |
| `POST /api/memory/preferences`    | 201 with a blob id                                             |
| `POST /api/recommendations`       | 201, verdict plus citations that carry blob ids                |
| `POST /api/signals`               | 201 from the provider; unknown id → 404, provider outage → 502 |
| `POST /api/signals` as non-op     | 403, then 429 after 10 ingest calls in a minute                |
| `PATCH /api/session` wrong code   | 401, with the same body as an unknown handle                   |
| `PATCH /api/session` real code    | 200, and the resumed session still owns its sealed pick        |
| `GET /api/signals/[id]`           | 402 with a `payment-required` challenge                        |
| `POST /api/payments/verify`       | 200, `verified: true`, and `recorded` reflects the ledger only |
| 34 rapid requests to one signal   | 30 × 402 then 429, confirming the per-IP limiter               |
| `POST /api/picks` unauthenticated | 401                                                            |
| `GET /picks/not-a-uuid`           | 404 not-found page, with no `Failed query` in the response     |

## Security notes

- Sealed pick content is redacted for every non-owner until reveal.
- A commitment hash proves the pick existed before the event and was not edited. It does
  **not** prove the outcome is true: outcomes are self-attested, and the UI labels them
  `Self-attested outcome` with the owner-supplied source URL and resolved timestamp.
- Analyst scores are `Community-attested`: they are computed from outcomes supplied by
  pick owners, not from an independent results oracle.
- Reveal and resolve are owner-only; resolution requires a valid hash and a prior reveal.
- Payment release requires Tatum-verified status, recipient, coin and amount. A digest is
  bound to one signal and one x402 resource, so it cannot be replayed for a different
  purchase. `/api/payments/verify` only reads and reports; it never creates a payment row
  or a memory write.
- `payments.digest` uniqueness prevents double-recording a settlement.
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

Every value below is copied from real command output against Sui mainnet on 2 Nov 2026.
No value is estimated, and anything not yet captured is marked `not captured` rather than
guessed.

| Proof                               | Value                                                                                               | Produced by            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------- |
| Walrus Memory relayer               | `status: ok`, relayer `0.1.0`                                                                       | `pnpm verify:memory`   |
| Walrus Memory blob ID (fresh write) | `Y-TFsuMq1956BWInd8F26H62S1ohTI8hxT723DMjckE`                                                       | `pnpm verify:memory`   |
| Walrus Memory recall distance       | `0.35874120150280087` (cosine)                                                                      | `pnpm verify:memory`   |
| Walrus Memory blob ID (sealed pick) | `RruPtIKgN3QZyEmUNOIVqA_yrk8mBylE8Bsg4h9O0NA` (`pick_commit`)                                       | `memory_writes`        |
| Walrus Memory blob ID (payment)     | `iQkdVACTG5arG58RDCnYr74_dJPeueaeJ9NTGheeBRA` (`payment`)                                           | `memory_writes`        |
| Walrus Memory blob ID (source ROI)  | `KkHx_aFl4YkIBBGF3bQ4hMMljtdhshUUTVMxhEqbjcE` (`source_roi`)                                        | `memory_writes`        |
| Mainnet memories written            | 27 rows: `pick_commit` 9, `pick_reveal` 5, `outcome` 5, `preference` 6, `payment` 1, `source_roi` 1 | `memory_writes`        |
| Tatum checkpoint                    | `340802699`                                                                                         | `pnpm verify:tatum`    |
| Tatum transaction digest            | `DemaKkYM7Ni4mRJcxbth3e4h3BkkqgKnR1MYPdWhmgjq` — status `success`, 2 balance changes                | `pnpm verify:tatum`    |
| x402 settlement digest              | `DemaKkYM7Ni4mRJcxbth3e4h3BkkqgKnR1MYPdWhmgjq` — 10000 atomic USDC, `sui:mainnet`                   | browser wallet + Tatum |
| x402 payer                          | `0xe47cc1da1a36461dbfbc2431b36b8579403d105d8d2a6fe05c442071905d8900`                                | `payments`             |
| x402 merchant                       | `0x5fb8e783752ba7ec09ee4c7c7a91bb51a4a643cd8a7473643a95c1a56b7e6432`                                | `.env.local` payee     |
| Merchant USDC balance after settle  | `10000` atomic ($0.01)                                                                              | Tatum GraphQL          |
| Agent (operator) USDC balance       | `0` — the operator key never paid; the buyer did                                                    | `pnpm verify:tatum`    |
| Explorer link                       | <https://suivision.xyz/txblock/DemaKkYM7Ni4mRJcxbth3e4h3BkkqgKnR1MYPdWhmgjq>                        | chain                  |
| Dashboard screenshot                | not captured                                                                                        | —                      |

Reproduce the two script-backed rows with:

```bash
pnpm verify:memory   # relayer status, blob ID, recall distance, listMemories count
pnpm verify:tatum    # checkpoint, transaction status, balance changes, operator balance
```

The x402 row is a browser-driven purchase: the buyer connected their own Sui wallet,
signed the settlement themselves, and the seller released the payload only after Tatum
confirmed the digest. `payments.digest` is unique, so re-running the recorder on that
digest returns the existing row instead of charging twice.

The signal behind that settlement is served by `scripts/demo-signal-provider.ts` and is
labelled **synthetic demo payload** everywhere it appears. It exists to exercise the
paywall, not to claim a real forecast was sold.

Some of those memories came from the end-to-end checks above, whose journals were deleted
afterwards. Walrus blobs cannot be deleted once written, so the row count is higher than the
number of surviving journals; `memory_writes` still records the real blob id of every write,
and the relayer returns 9 memories for `saksi_demo` and 2 for `testdemo`.

## Known limitations and risks

- Outcomes are self-attested. `sourceUrl` is validated as an http(s) URL but its content is
  never fetched, so the hash and the calibration score do not establish that the cited
  result is true.
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
- The premium provider contract is intentionally minimal. A production deployment should
  add provider-specific authentication, rate limits and response-size limits.
- Sessions are a local, HMAC-signed cookie containing the user UUID. Signing prevents
  forgery, but this is still a hackathon identity model rather than production
  authentication (no expiry rotation or revocation list).
- A journal is resumed with its handle plus a 24-symbol recovery code issued once at
  creation and stored only as a scrypt hash. Losing the code means the journal cannot be
  recovered: `sealed` picks stay sealed forever. Journals created before this existed can
  be given a code by an operator with `pnpm recovery:issue <handle> <file>`, which is a CLI
  rather than an endpoint so nobody can mint a code for someone else's handle.
- Signal ingestion is restricted to handles listed in `OPERATOR_HANDLES` and rate limited
  to 10 requests per minute. Buying an ingested signal is still open to anyone with a
  wallet.
- The in-memory rate limiter is not shared between server instances.

# Saksi

**Tamper-evident picks, source-cited outcomes.** Seal a pick before the event, write the
commitment to Walrus Memory, reveal it against the original hash, resolve it with a real
source URL, and let your own history change the next decision. The hash proves the pick
existed before the event and was not edited; the outcome itself is self-attested by the
pick owner and is not independently verified. Premium signals are sold per call through
an x402 paywall on Sui and verified through Tatum before release.

Built for **Total Recall — Tatum × Walrus Memory** (Track 1: Markets & Sports Prediction).

## Status

| Check                                 | Result                                                               |
| ------------------------------------- | -------------------------------------------------------------------- |
| `pnpm typecheck`                      | passes                                                               |
| `pnpm lint`                           | passes                                                               |
| `pnpm test`                           | 57 tests pass                                                        |
| `pnpm build`                          | passes (Next.js 16.4.3, Turbopack)                                   |
| Live Walrus / Tatum / x402 calls      | **not verified** — no credentials or Postgres runtime were available |
| Migrations generated                  | `0000_free_lifeguard.sql`, `0001_worried_satana.sql`                 |
| Migrations applied to a live database | no                                                                   |

The application is implemented against the official contracts, but no live integration
result is claimed below. See [Proof](#proof) and [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

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
4. **x402 premium signals on Sui** — seller paywall with Tentacle Pay facilitator, buyer
   agent using `@x402/fetch`, Tatum verification before the payload leaves the server,
   idempotent receipts bound to one signal and resource, read-only digest inspection, and
   payment/source-ROI memories.
5. **On-chain proof** — Tatum GraphQL `checkpoint`, `transaction` and `address.balance`
   queries power the payment ledger, balance, events and explorer links.
6. **Dashboard** — credibility leaderboard, analyst detail with calibration, memory ledger
   fetched from `listMemories()` (with a truncation flag, not a claimed namespace total),
   payment ledger and signal pages.

## Quick start

Requirements:

- Node.js 22.23.4 or newer (verified on 24.18.0)
- pnpm 10.33.0
- PostgreSQL with `gen_random_uuid()` (Postgres 13+)
- Walrus Memory account and delegate key
- Tatum API key and the Sui mainnet GraphQL gateway
- Tentacle Pay facilitator access and a Sui payee address
- A buyer wallet funded for the selected network
- Optionally, a premium signal provider implementing the contract below

```bash
pnpm install
cp .env.example .env.local
# fill every non-optional value in .env.local
pnpm db:migrate
pnpm dev
```

Open `http://localhost:3000`, create a journal at `/onboarding`, then visit `/picks/new`.

> `pnpm build` does not need production credentials. Every runtime entry point validates
> them through `instrumentation.ts` and fails fast when a required value is missing.

## Environment

All values are validated in `lib/env.ts` with zod. Empty strings and malformed URLs,
addresses, networks, prices or namespace prefixes are rejected at startup.

| Variable                         | Required | Purpose                                          |
| -------------------------------- | -------- | ------------------------------------------------ |
| `DATABASE_URL`                   | yes      | PostgreSQL connection string                     |
| `WALRUS_MEMORY_PRIVATE_KEY`      | yes      | MemWal delegate private key                      |
| `WALRUS_MEMORY_ACCOUNT_ID`       | yes      | MemWalAccount object id                          |
| `WALRUS_MEMORY_RELAYER_URL`      | yes      | Walrus Memory relayer base URL                   |
| `WALRUS_MEMORY_NAMESPACE_PREFIX` | yes      | lowercase namespace prefix; user id is appended  |
| `TATUM_API_KEY`                  | yes      | sent as `x-api-key` to Tatum                     |
| `TATUM_SUI_RPC_URL`              | yes      | Tatum Sui GraphQL endpoint (`/graphql`)          |
| `SUI_NETWORK`                    | yes      | `sui:mainnet` or `sui:testnet`                   |
| `SUI_USDC_COIN_TYPE`             | yes      | coin type used for balances and verification     |
| `AGENT_SUI_ADDRESS`              | yes      | agent wallet shown on `/payments`                |
| `TATUM_VERIFY_DIGEST`            | no       | required only by `pnpm verify:tatum`             |
| `X402_FACILITATOR_URL`           | yes      | Tentacle Pay facilitator                         |
| `X402_PAY_TO_ADDRESS`            | yes      | Sui recipient of signal payments                 |
| `X402_PRICE`                     | no       | USD string or atomic amount; defaults to `$0.01` |
| `X402_CLIENT_PRIVATE_KEY`        | yes      | buyer agent key used by `@x402/fetch`            |
| `X402_TEST_SIGNAL_ID`            | no       | required only by `pnpm verify:x402`              |
| `SIGNAL_PROVIDER_API_URL`        | no       | optional pair with the next value                |
| `SIGNAL_PROVIDER_API_KEY`        | no       | optional pair with the previous value            |
| `APP_BASE_URL`                   | yes      | public base URL used by the buyer agent          |
| `SESSION_SECRET`                 | yes      | at least 32 chars; signs the session cookie      |
| `LOG_LEVEL`                      | no       | pino level; defaults to `info`                   |
| `WALRUS_RECALL_LIMIT`            | no       | recall size; defaults to 10                      |

`SIGNAL_PROVIDER_API_URL` and `SIGNAL_PROVIDER_API_KEY` must be set together. When both
are absent, signal ingestion returns 503 rather than inventing provider data. Startup also
refuses a `TATUM_SUI_RPC_URL` whose host does not contain the network named by
`SUI_NETWORK`, and an `AGENT_SUI_ADDRESS` that does not match the key derived from
`X402_CLIENT_PRIVATE_KEY`.

### Signal provider contract

```http
GET {SIGNAL_PROVIDER_API_URL}/{externalId}
Authorization: Bearer {SIGNAL_PROVIDER_API_KEY}

200 { "provider": "name", "title": "headline", "payload": { ... } }
```

Additional fields are allowed; `provider`, `title` and `payload` are required.

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

Generate a migration after schema changes:

```bash
pnpm db:generate
pnpm db:migrate
```

`0001_worried_satana.sql` (payments `resource`/`requirements`) was **generated but not
applied** in this workspace because no PostgreSQL runtime was available. Run
`pnpm db:migrate` against a real database before starting the app.

## Routes

| Route                                 | Purpose                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/`                                   | dashboard: stats, credibility leaderboard, latest picks, memory decision, Tatum settlement feed |
| `/onboarding`                         | create a journal identity                                                                       |
| `/picks`, `/picks/new`, `/picks/[id]` | ledger, sealed pick form, proof detail + reveal/resolve                                         |
| `/analysts`, `/analysts/[id]`         | leaderboard and calibration/evidence                                                            |
| `/memory`                             | relayer health, fetched `listMemories()` pages, recall with paired citations                    |
| `/signals`, `/signals/[id]`           | provider listings and paid purchase panel                                                       |
| `/payments`                           | settlement ledger, agent balance, events, manual digest verification                            |

API:

| Route                                      | Notes                                                    |
| ------------------------------------------ | -------------------------------------------------------- |
| `POST /api/picks`                          | seal a pick; rolls back on memory failure                |
| `POST /api/picks/[id]/reveal`              | owner only; hash + time-lock checked                     |
| `POST /api/picks/[id]/resolve`             | owner only; source URL + timestamp required              |
| `POST /api/recommendations`                | recall before deciding; persists citations               |
| `GET /api/signals/[id]`                    | x402 paywall; Tatum verification before release          |
| `POST /api/payments/purchase`              | buyer agent pays and re-verifies                         |
| `POST /api/payments/verify`                | read-only Tatum check; reports `recorded`, never inserts |
| `GET /api/payments`                        | ledger + Tatum balance/events                            |
| `GET /api/health`                          | database + Walrus + Tatum checks, no secrets             |
| `POST /api/session`, `DELETE /api/session` | local journal session                                    |

## Verification scripts

All scripts load `.env.local` then `.env` (same precedence as Next.js), call real
services, print JSON lines, and exit non-zero on failure. None contains sample values.

```bash
# Requires DATABASE_URL, Walrus credentials, and at least one journal user.
pnpm verify:memory

# Requires TATUM_* and TATUM_VERIFY_DIGEST.
pnpm verify:tatum

# Requires the app running at APP_BASE_URL plus a real signal id and buyer wallet.
pnpm verify:x402
```

`verify:memory` writes a uniquely marked preference memory, recalls it, asserts the exact
text is returned, and prints the blob ID plus relayer count. `verify:tatum` checks the
latest checkpoint, a real transaction and the agent balance. `verify:x402` buys the
paywalled signal, prints the digest, and independently verifies it through Tatum.

## Tests

```bash
pnpm test
```

Unit tests cover only pure code: canonical JSON and SHA-256, memory build/parse/escaping,
payment-to-signal binding and retry classification, session-cookie signing, coin type
normalization, Brier and calibration, credibility decay, bias detection, and price
conversion. Walrus, Tatum and x402 are deliberately not mocked; they are exercised by the
scripts above.

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

## Proof

The following fields are **pending**. They must be filled from real output, never invented.
Run the verification scripts after configuring credentials and replace each `PENDING`.

| Proof                               | Value                                                 |
| ----------------------------------- | ----------------------------------------------------- |
| Walrus Memory blob ID (sealed pick) | `PENDING — run pnpm verify:memory`                    |
| Walrus Memory recall distance       | `PENDING — run pnpm verify:memory`                    |
| Walrus Memory relayer count         | `PENDING — run pnpm verify:memory`                    |
| Tatum checkpoint                    | `PENDING — run pnpm verify:tatum`                     |
| Tatum transaction digest            | `PENDING — run pnpm verify:tatum`                     |
| x402 settlement digest              | `PENDING — run pnpm verify:x402`                      |
| Agent USDC balance                  | `PENDING — run pnpm verify:tatum` or open `/payments` |
| Dashboard screenshot                | `PENDING — no live environment`                       |
| 10 mainnet memories                 | `PENDING — requires real usage`                       |

## Known limitations and risks

- Outcomes are self-attested. `sourceUrl` is validated as an http(s) URL but its content is
  never fetched, so the hash and the calibration score do not establish that the cited
  result is true.
- Tatum serves Sui over GraphQL (`/graphql`) and gRPC only; JSON-RPC is deprecated. This
  client targets the mainnet GraphQL gateway, so a testnet deployment would need a gRPC
  client that this repository does not implement.
- Tentacle Pay's Sui seller guide recommends Node.js 24+; this project requires 22.23.4+
  and was built/tested on 24.18.0.
- The x402 settlement happens before Tatum verification. If Tatum is unavailable after a
  successful settlement, the buyer has paid but does not receive the payload until a
  retry succeeds. This is an intentional fail-closed trade-off; the digest remains
  verifiable through `/api/payments/verify`.
- The premium provider contract is intentionally minimal. A production deployment should
  add provider-specific authentication, rate limits and response-size limits.
- Sessions are a local, HMAC-signed cookie containing the user UUID. Signing prevents
  forgery, but this is still a hackathon identity model rather than production
  authentication (no password, expiry rotation, or revocation list).
- The in-memory rate limiter is not shared between server instances.

# Integrations

This document records the official sources Saksi was built against and the decisions
that shaped each integration. It is deliberately specific: if a statement here is not
backed by a source, by code in this repository, or by a recorded mainnet run, it is listed
under **Still unverified**.

## Sources consulted

| Integration                     | Official source                                                |
| ------------------------------- | -------------------------------------------------------------- |
| Walrus Memory overview          | https://docs.wal.app/walrus-memory                             |
| Walrus Memory quick start       | https://docs.wal.app/walrus-memory/getting-started/quick-start |
| Walrus Memory TypeScript SDK    | https://docs.wal.app/walrus-memory/sdk/overview                |
| Walrus Memory API reference     | https://docs.wal.app/walrus-memory/sdk/api-reference           |
| Walrus Memory configuration     | https://docs.wal.app/walrus-memory/reference/configuration     |
| Walrus Memory relayer API       | https://docs.wal.app/walrus-memory/relayer/api-reference       |
| MemWal source                   | https://github.com/MystenLabs/MemWal                           |
| Tatum Sui GraphQL               | https://docs.tatum.io/reference/rpc-sui                        |
| Tatum RPC gateway setup         | https://docs.tatum.io/reference/how-to-connect-rpc-gateway     |
| Tentacle Pay x402 seller        | https://docs.tentaclepay.com/x402/quickstart-for-sellers       |
| Tentacle Pay x402 agent         | https://docs.tentaclepay.com/x402/quickstart-for-agents        |
| Tentacle Pay facilitator        | https://docs.tentaclepay.com/x402/facilitator                  |
| Tentacle Pay supported networks | https://docs.tentaclepay.com/x402/supported-networks           |

The MemWal API page and Tentacle Pay seller page were re-read while finishing this
implementation. Their contracts match the code in `integrations/`.

## Walrus Memory

**SDK:** `@mysten-incubation/memwal`.

**Client construction** (`integrations/walrus-memory/client.ts`):

```ts
MemWal.create({
  key: env.WALRUS_MEMORY_PRIVATE_KEY,
  accountId: env.WALRUS_MEMORY_ACCOUNT_ID,
  serverUrl: env.WALRUS_MEMORY_RELAYER_URL,
  namespace: env.WALRUS_MEMORY_NAMESPACE_PREFIX,
});
```

**Calls used:**

| Method                                                   | Where                                         | Purpose                                                   |
| -------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| `health()`                                               | `/api/health`, `/memory`, verification script | relayer reachability and version                          |
| `rememberAndWait(text, namespace)`                       | `remember()`                                  | wait for the real blob/job result before claiming a write |
| `recall({ query, limit, namespace, sort: "relevance" })` | recommendations, `/memory` search             | return decrypted text plus cosine distance                |
| `listMemories({ namespace, cursor, limit })`             | `/memory`                                     | count and list memories from the relayer, not Postgres    |

`rememberAndWait()` returns `{ id, job_id, blob_id, owner, namespace }`; Saksi keeps
`result.blob_id` as the receipt it shows the caller. There is no `memory_writes` table any
more — the blob id is the record, and the relayer is where it lives.

### Identity namespaces

Two namespace shapes are not journal history and are excluded from `/journals`:

| Namespace                     | Holds                                     | Why the key is safe              |
| ----------------------------- | ----------------------------------------- | -------------------------------- |
| `${prefix}:wallet:<address>`  | the journal's ref and display handle      | the address is public anyway     |
| `${prefix}:recovery:<digest>` | the journal pointer, keyed by code digest | the code has 120 bits of entropy |

`MEMORY_KINDS` therefore includes `journal` and `recovery`, while `JOURNAL_MEMORY_KINDS`
excludes them so a reader looking at a track record sees picks, not bookkeeping.

### Deterministic memory text

Memory is plain text, so the format is a single line with `%`-escaped delimiters:

```txt
saksi:v1|type=pick|id=<uuid>|analyst=<uuid>|market=<text>|selection=<text>|odds=<decimal>|committedAt=<iso>
saksi:v1|type=outcome|pickId=<uuid>|result=win|brier=<0..1>|source=<url>|resolvedAt=<iso>
saksi:v1|type=bias|analyst=<uuid>|pattern=<text>|evidence=<n>|confidence=<0..1>
saksi:v1|type=source_roi|provider=<name>|spendAtomic=<n>|correct=<n>|wrong=<n>|note=<text>
saksi:v1|type=preference|userId=<uuid>|statement=<text>
saksi:v1|type=payment|digest=<digest>|provider=<name>|amountAtomic=<n>|network=<caip2>
```

`integrations/walrus-memory/schema.ts` builds and immediately re-parses every record
before it can reach the relayer. Unknown types, duplicate keys, missing fields and
out-of-range values are rejected. `|`, `%` and newlines are escaped so a value cannot
forge a second field.

### Namespace and citations

The namespace is `${WALRUS_MEMORY_NAMESPACE_PREFIX}:${userId}`. Recall uses
`sort: "relevance"` and `limit` from `WALRUS_RECALL_LIMIT` (default 10). Every warning
in a recommendation stores the exact memory `text`, `blobId` and `distance` that caused
it; the UI renders those values rather than a computed score alone.

### Failure policy

A pick is sealed only if the memory write succeeds. If the write fails, the Postgres row
is deleted and the API returns `502`. Outcome resolution follows the same rule. Bias and
source-ROI memories are secondary: if they fail, the already-verified outcome stays and
the failure is logged. Payment memories are attempted after Tatum verification; a failed
memory write does not invalidate the on-chain payment, and the error is logged.

There is no audit table. A successful write returns its blob id, and that id is the receipt:
the memory itself is the source of truth, so a second local copy of the same fact would only
be a cache that can disagree with the relayer.

## Independent result oracle

`integrations/oracle/results.ts` reads final scores from a provider Saksi does not control,
because every score in Saksi's own database is written by the journal that made the pick.
Without it, a seller could mark all ten of their picks as wins and the credibility model
would believe them.

- Source: `GET {ORACLE_ESPN_BASE_URL}/soccer/{league}/scoreboard?dates=YYYYMMDD` and
  `/summary?event=<id>`.
- Scope: one league (`eng.1`) and match-winner markets only. Selections are parsed from
  `"<Team> to win"` and `"draw"`; anything else returns `null` and the outcome falls back to
  `self_attested`. A half-implemented oracle that silently passed on every other market
  would look like verification while verifying nothing.
- The reference (`espn:eng.1:<fixture id>`) is fixed at seal time and stored on the pick.
  Resolution reads that exact fixture, so a picker cannot shop for whichever match makes
  them look right after the fact.
- Team names are normalised token by token: generic suffixes (`FC`, `AFC`, `CF`, `SC`,
  `Club`) are dropped and the common abbreviations `Utd → United` and `Man → Manchester`
  are expanded. Matching requires every word of the shorter name to appear as a whole word
  in the longer one, so `Man Utd` (`manchester united`) can never match `Manchester City`.
  A one-word name that fits both sides (`United`) is rejected as ambiguous rather than
  resolving to the wrong team.

Resolution outcomes:

| Provider state                        | Stored `verification` | Counts toward verified score |
| ------------------------------------- | --------------------- | ---------------------------- |
| Agrees with the claim                 | `oracle_verified`     | yes                          |
| Disagrees with the claim              | `oracle_contradicted` | no                           |
| Claimed `void` on a completed fixture | `oracle_contradicted` | no                           |
| No fixture linked / unparseable       | `self_attested`       | no                           |
| Fixture not finished                  | `self_attested`       | no                           |
| Provider unreachable                  | `self_attested`       | no                           |
| Oracle disabled by configuration      | `self_attested`       | no                           |

A contradiction never overwrites the owner's claim: `outcomes.result` keeps what they said
and `oracleResult` keeps what the provider recorded, alongside `oracleSource`,
`oracleEventId`, `oracleNote` and `verifiedAt`. The credibility model reads `verification`,
which is what makes the distinction enforceable rather than cosmetic.

`pnpm verify:oracle [date]` is a read-only check: it fetches a scoreboard, reads every
completed fixture back through the resolver's own code, and fails if any match does not
resolve to exactly one winner.

## Tatum Sui GraphQL

Tatum's Sui gateway no longer serves JSON-RPC (`sui_getTransactionBlock`,
`suix_getBalance`, `suix_queryEvents` now return 404). The official interfaces are
GraphQL (`/graphql`) and gRPC. Saksi uses GraphQL.

`integrations/tatum/client.ts` is a typed GraphQL client:

- `POST TATUM_SUI_RPC_URL` (must be the `/graphql` path)
- header `x-api-key: TATUM_API_KEY`
- body `{ query, variables }`
- zod validates every payload before it reaches product code
- timeout per attempt: 15s
- retry with jittered exponential backoff on HTTP 429/5xx and network failures (3 attempts)
- no retry for GraphQL semantic errors or schema mismatches
- module-level slot allocator keeps traffic at ~2.8 requests/second, because the Tatum
  free tier rejects more than three requests per second

Queries used:

| GraphQL selection                                                   | Consumer                                |
| ------------------------------------------------------------------- | --------------------------------------- |
| `checkpoint { sequenceNumber }`                                     | `/api/health`, `verify-tatum.ts`        |
| `transaction(digest) { effects { ... } }`                           | payment verification, `verify-tatum.ts` |
| `address(address) { balance(coinType) { totalBalance } }`           | merchant USDC balance on `/payments`    |
| `transaction(digest) { effects { events { nodes { contents } } } }` | settlement event feed on `/payments`    |

GraphQL caps a connection page at 50 nodes. Payment verification follows
`balanceChanges.pageInfo.hasNextPage` for up to ten pages so a batched transaction
cannot hide a larger transfer. GraphQL does not expose `coinObjectCount`, so the UI
reports the total balance only rather than inventing a count.

### Payment verification algorithm

`integrations/tatum/verify-payment.ts` accepts a digest and does not trust the x402
facilitator receipt:

1. Validate the digest shape.
2. Reject a network that differs from `SUI_NETWORK`.
3. Fetch the transaction with effects, events and balance changes.
4. Require the returned digest to equal the requested digest.
5. Require the mapped effects status to be `success` (GraphQL `SUCCESS`).
6. Read the sender as `payer`.
7. Sum positive balance changes whose owner is `X402_PAY_TO_ADDRESS` and whose
   `coinType` is `SUI_USDC_COIN_TYPE`.
8. Reject if the sum is below the signal price.
9. Persist the raw response plus `verifiedAt` and the configured coin type.

If Tatum is unreachable the product refuses the signal. There is no cached or fabricated
success path.

### Network caveat

Both Tatum interfaces are mainnet-only for Sui: `sui-mainnet-graphql` and
`sui-mainnet-grpc`. Public Sui JSON-RPC endpoints are deprecated as well. The app
therefore runs on `sui:mainnet`; a testnet deployment would need a gRPC client, which
this repository does not implement. Do not silently switch networks.

## x402 on Sui (Tentacle Pay facilitator)

### Seller

Two paywalled routes, both `exact` scheme on `SUI_NETWORK`:

| Route                   | Price                  | Recipient                                |
| ----------------------- | ---------------------- | ---------------------------------------- |
| `GET /api/signals/[id]` | the seller's own price | the seller's proven wallet (per-request) |
| `POST /api/signals`     | `X402_LISTING_FEE`     | `X402_PAY_TO_ADDRESS` (the platform)     |

The purchase route resolves `price` and `payTo` from the signal row on every request, so a
seller-set price cannot drift from what the challenge advertises and what Tatum later
verifies. A catalogue row with no seller falls back to the platform address; the handler
rejects an unlisted id before any settlement is attempted.

`X402_PRICE` and `X402_LISTING_FEE` accept a USD string (`$0.01`) or an atomic amount
(`10000`). The scheme itself only understands USD strings, so the seller normalises through
`parsePriceToAtomic()` + `formatUsd()` before advertising requirements. Note that Next.js
expands a literal `$0` in `.env.local`; use the atomic form there, or escape it as `\$0.01`
(the verification scripts load `.env.local` with plain dotenv, which does not expand
escapes, so the atomic form is the portable choice).

`integrations/x402/seller.ts` uses:

- `HTTPFacilitatorClient` from `@x402/core/server` pointed at `X402_FACILITATOR_URL`
- `x402ResourceServer` from `@x402/next`
- `ExactSuiScheme` from `@tentaclepay/sui-x402/exact/server`
- `x402HTTPResourceServer` plus `NextAdapter` for request processing
- `processHTTPRequest()` and `processSettlement()`

A small `SuiSchemeServerAdapter` bridges a version difference: `@tentaclepay/sui-x402`
was built against an older `@x402/core` interface. The adapter delegates price parsing
and requirement enhancement to `ExactSuiScheme`, declares the `authorization` payment
flow, reports `USDC_DECIMALS`, and uses the newer `SchemeNetworkServer` surface.
This is required because Saksi settles first and only releases data after its own Tatum
verification; the generic `paymentMiddleware` helper would release the handler result
without that extra gate.

Flow:

```txt
client GET /api/signals/:id
  -> no payment header: 402 + accepts (recipient = seller wallet)
  -> x402 client signs exact Sui payment
  -> seller verifies + settles through the facilitator
  -> seller receives digest
  -> seller verifies digest through Tatum
  -> only then returns the seller's payload
  -> seller records the settlement (userId nullable)
```

### Why the platform fee is a listing fee

Saksi charges a flat fee to publish, not a percentage of a sale. This was settled
empirically on mainnet, not chosen for convenience:

- The facilitator's `findSendFundsCommand` returns `null` when a transaction contains more
  than one `send_funds` command, and the settlement is rejected as `invalid_transaction`.
  Splitting one payment into a seller share and a platform share therefore fails outright.
- Sui's gasless whitelist rejects `coin::from_balance`, `coin::take`, `TransferObjects` and
  `public_transfer` with `Feature is not supported: Function 0x2::coin::… is not supported
in gasless transactions`. Only `balance::send_funds` and `balance::redeem_funds` are
  permitted, so a fee cannot be carved out of the buyer's transfer.
- `MAINNET_GASLESS_TOKEN_RULES[USDC].minAmount` is `10000n`. A 9500-atomic transfer fails
  with `InsufficientGas`, and two `send_funds` of 9500 + 500 fail the same way; two of
  10000 + 10000 simulate successfully but the facilitator still rejects the transaction.
- Gasless transactions must carry a `ValidDuring` expiration of at most two epochs, or the
  build fails with `Invalid transaction expiration`.

Charging the seller separately keeps both payments honest: the listing fee is one `exact`
settlement to the platform, and the sale is one `exact` settlement to the seller. Saksi
never holds either. `signals.listing_fee_digest` is unique, so one fee publishes exactly one
listing and cannot be replayed.

The seller records a purchase already attributed when the paid request carries a journal
session (`journalRef` + optional `pickId`). A script-only purchase leaves `journal_ref` null;
that row can be claimed later by digest, which keeps `payments.digest` unique and makes
retries idempotent.

### Buyer

Signal purchases are self-custody. The browser mounts `DAppKitProvider` from
`@mysten/dapp-kit-react` against Sui mainnet, the buyer connects their own wallet, and
`lib/x402-wallet.ts` asks the wallet to sign the Sui transaction that
`@tentaclepay/sui-x402` builds. The private key never reaches the server, and the payee is
the seller's own wallet from the signal row.

`lib/x402-wallet.ts` uses:

- `x402Client.fromConfig()`, with `spendControls.allowedAssets` populated from the 402
  challenge because Sui USDC is not an x402 "default" asset
- `ExactSuiScheme` from `@tentaclepay/sui-x402/exact/client`
- `wrapFetchWithPayment` from `@x402/fetch`
- `x402HTTPClient.getPaymentSettleResponse(...)` to read the settle receipt

`integrations/x402/buyer.ts` keeps the same flow for `pnpm verify:x402` only. It reads
`X402_CLIENT_PRIVATE_KEY` from the environment and re-verifies the digest through Tatum
even though the seller already did. This protects the buyer side from a malicious or
compromised seller response.

### Receipt parsing

`integrations/x402/receipt.ts` validates `success`, `transaction`, `network`, optional
`payer`/`amount` and the facilitator error fields. It rejects a successful-looking
receipt for the wrong network and never invents a missing digest.

## Sealed picks and proof chain

1. A pick payload is built from user input plus server time (`committedAt`).
2. `canonicalJson()` sorts keys, drops `undefined` object members and emits UTF-8 with no
   insignificant whitespace. Non-JSON values are rejected.
3. `commitmentHash = sha256(canonicalJson(payload))`.
4. The hash and full payload are stored in Postgres; a `pick` memory is written to Walrus.
5. Public views redact `eventRef`, `market`, `selection`, `odds` and `stakeUnits` while the
   pick is sealed. Only the owner sees them.
6. Reveal recomputes the hash and refuses on mismatch. Time locks are enforced.
7. Resolution requires a revealed pick and stores `result`, `sourceUrl`, `resolvedAt`,
   optional `payoutUnits`, and the Brier score. When the pick carries an `oracleEventRef`,
   the independent provider is consulted first and `verification` records whether it agreed
   (`oracle_verified`), disagreed (`oracle_contradicted`) or could not be reached
   (`self_attested`, with `oracleNote` explaining why).
8. Outcome, bias and source-ROI memories are written; the recommendation flow recalls them
   before the next pick and cites text plus distance.

## Configuration and failure policy

- Every deployment-specific value is read through `lib/env.ts` and validated with zod.
- `instrumentation.ts` validates the environment at runtime startup and is skipped only
  during `next build`.
- There is no signal-provider credential and no seller allowlist. Any journal that proves a
  Sui wallet by signature may publish, and the wallet is where buyers pay.
- `X402_PRICE` and `X402_LISTING_FEE` are validated against the Sui gasless minimum
  (`0.01` USDC) at startup, because a lower value builds a sponsored transaction the
  network rejects with `InsufficientGas`.
- Missing database, Walrus, Tatum or x402 credentials stop the runtime instead of
  falling back to sample data.
- Logs are pino JSON with a request id. Secrets and raw payloads are redacted.

## Verified on mainnet

Live calls were made against Sui mainnet. Each row below was produced by running the named
command and copying its output; nothing here is estimated. A Walrus write returns a new blob
id on every run and Tatum's checkpoint advances continuously, so those two values are the
ones recorded at the time of writing rather than constants.

| Area                  | Result                                                                                                                         | Command                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Walrus Memory relayer | `status: ok`, relayer `0.1.0`                                                                                                  | `pnpm verify:memory`      |
| Walrus write + recall | blob `KWpogiSiqOxBOD8x5Z72QCnh_Nnfd7aYHE-tEfjojcM`, cosine distance `0.3566046999066741`, exact text returned                  | `pnpm verify:memory`      |
| `listMemories()`      | 12 memories for `saksi_demo`, `hasMore: false` (one is added per verification run)                                             | `pnpm verify:memory`      |
| Mainnet namespaces    | 18 under `saksi:`, holding 49 memories: 43 across 13 journal namespaces, 2 identity records, 4 verification probes             | `listNamespaces()`        |
| Identity from Walrus  | wallet `0xe47cc1da…` → `@saksi_dev` in 5939 ms; unknown wallet → no journal in 390 ms, no SQL involved                         | `readJournalRecord()`     |
| Reconstruction        | `mismatches: 0` — credibility rebuilt from memory agrees with Postgres for every analyst                                       | `pnpm verify:reconstruct` |
| Tatum checkpoint      | `341329560` (advances; any recent value proves the query)                                                                      | `pnpm verify:tatum`       |
| Tatum transaction     | `DemaKkYM7Ni4mRJcxbth3e4h3BkkqgKnR1MYPdWhmgjq`, status `success`, 2 balance changes                                            | `pnpm verify:tatum`       |
| Tatum balance         | operator agent `0` atomic USDC; merchant `10000` after settlement                                                              | `pnpm verify:tatum`       |
| x402 settlement       | one real $0.01 USDC purchase, paid by a self-custody browser wallet and verified through Tatum before the payload was released | browser + `payments`      |
| Oracle fixtures       | 8 completed `eng.1` fixtures on 2026-10-31, each resolving to exactly one winner, including two draws                          | `pnpm verify:oracle`      |
| Oracle agreement      | "Chelsea to win" on `espn:eng.1:401879248` (Chelsea 2-0 Man Utd) stored as `oracle_verified`                                   | `outcomes`                |
| Oracle contradiction  | a claimed win on a fixture the provider made a loss stored as `oracle_contradicted`, owner's claim preserved                   | `outcomes`                |

## Still unverified

- `pnpm verify:x402`, the script-driven buyer, has not been run against mainnet. The paid
  purchase above went through the browser wallet instead, so the script path is code that
  shares the same client and seller route but has no recorded run of its own.
- No signal has been published through the paid listing flow on mainnet yet, so the listing
  fee has a verified challenge but no recorded settlement.
- No public deployment exists, so settlement `resource.url` values point at
  `http://localhost:3000`.
- The catalogue signal used for the recorded purchase is a synthetic demo payload, not a
  real forecast product.
- Oracle coverage is one league (`eng.1`) and match-winner markets. Every other market stays
  `self_attested` and is labelled that way.

The code paths fail closed rather than substituting sample data. `README.md` marks any
field it cannot back with real output as `not captured` instead of inventing a value.

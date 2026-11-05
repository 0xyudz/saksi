# Environment variable checklist for Vercel

Copy each value from `.env.local` into Vercel → Project → Settings → Environment Variables.
This file never contains the values themselves; it only lists what to paste and where.

Set every row for **Production**. Also set them for **Preview** if you want preview
deployments to work (they share the same database, which is acceptable for a hackathon but
not for real production).

## Paste these (in this order)

| #   | Variable                         | Source in `.env.local`           | Notes for Vercel                                                                               |
| --- | -------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | `DATABASE_URL`                   | `DATABASE_URL`                   | Use the **pooled** Neon string (host contains `-pooler`). Append `?sslmode=require` if absent. |
| 2   | `WALRUS_MEMORY_PRIVATE_KEY`      | `WALRUS_MEMORY_PRIVATE_KEY`      | Secret. Paste verbatim, no quotes.                                                             |
| 3   | `WALRUS_MEMORY_ACCOUNT_ID`       | `WALRUS_MEMORY_ACCOUNT_ID`       | MemWalAccount object id.                                                                       |
| 4   | `WALRUS_MEMORY_RELAYER_URL`      | `WALRUS_MEMORY_RELAYER_URL`      | Base URL, no trailing slash.                                                                   |
| 5   | `WALRUS_MEMORY_NAMESPACE_PREFIX` | `WALRUS_MEMORY_NAMESPACE_PREFIX` | Lowercase prefix, e.g. `saksi`.                                                                |
| 6   | `TATUM_API_KEY`                  | `TATUM_API_KEY`                  | Secret.                                                                                        |
| 7   | `TATUM_SUI_RPC_URL`              | `TATUM_SUI_RPC_URL`              | Must end in `/graphql`.                                                                        |
| 8   | `SUI_NETWORK`                    | `SUI_NETWORK`                    | `sui:mainnet`.                                                                                 |
| 9   | `SUI_USDC_COIN_TYPE`             | `SUI_USDC_COIN_TYPE`             | Mainnet USDC coin type.                                                                        |
| 10  | `AGENT_SUI_ADDRESS`              | `AGENT_SUI_ADDRESS`              | Operator wallet shown on `/payments`.                                                          |
| 11  | `X402_FACILITATOR_URL`           | `X402_FACILITATOR_URL`           | Tentacle Pay facilitator.                                                                      |
| 12  | `X402_PAY_TO_ADDRESS`            | `X402_PAY_TO_ADDRESS`            | Platform address: receives listing fees.                                                       |
| 13  | `X402_PRICE`                     | —                                | Set to `10000` (atomic). Do not paste a literal `$`.                                           |
| 14  | `X402_LISTING_FEE`               | —                                | Set to `20000` (atomic). Do not paste a literal `$`.                                           |
| 15  | `SESSION_SECRET`                 | `SESSION_SECRET`                 | Secret, at least 32 characters.                                                                |
| 16  | `ORACLE_ESPN_BASE_URL`           | `ORACLE_ESPN_BASE_URL`           | Optional.                                                                                      |
| 17  | `ORACLE_ENABLED`                 | `ORACLE_ENABLED`                 | `true`.                                                                                        |
| 18  | `DB_POOL_MAX`                    | —                                | Set to `3`. Serverless multiplies pools across instances.                                      |
| 19  | `LOG_LEVEL`                      | `LOG_LEVEL`                      | `info`.                                                                                        |
| 20  | `APP_BASE_URL`                   | —                                | Leave for the second deploy; set it to the assigned domain, no trailing slash.                 |

## Do NOT set in production

- `X402_CLIENT_PRIVATE_KEY` — buyers sign with their own wallet in the browser.
- `X402_TEST_SIGNAL_ID` — only `pnpm verify:x402` needs it.
- `TATUM_VERIFY_DIGEST` — optional; only used by `pnpm verify:tatum`.

## After the first deploy

1. Copy the assigned domain (e.g. `saksi-xxxx.vercel.app`).
2. Add `APP_BASE_URL` = `https://<domain>` for Production.
3. Redeploy so the new value is picked up. A wrong `APP_BASE_URL` breaks session `Origin`
   checks and the x402 `resource.url`.

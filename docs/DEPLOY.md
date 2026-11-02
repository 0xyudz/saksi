# Deploy checklist

Step-by-step for getting Saksi onto Vercel with a public GitHub repo. Values marked
**secret** must be copied from `.env.local` on your machine; they are never written into
this file.

## 1. Push to GitHub

```bash
git remote add origin https://github.com/<your-username>/saksi.git
git push -u origin main
```

Create the repo empty on GitHub first (no README, no .gitignore, no licence), otherwise
the push is rejected. Start it private if you want a dry run; the hackathon requires a
public repo, so flip it to public before submitting.

Before flipping it public, confirm these are not tracked:

```bash
git ls-files | findstr /i "env"
```

Expected output is only `.env.example`. `.env.local` is ignored and must stay that way.

## 2. Create the Vercel project

1. Go to <https://vercel.com/new> and import the repository.
2. Framework preset is detected as Next.js. Leave the build command and output directory
   alone.
3. Do **not** deploy yet; add the environment variables first.

## 3. Environment variables

Set these in Vercel under Project → Settings → Environment Variables, for the Production
environment (and Preview if you want preview deploys to work).

| Variable                         | Notes                                                       |
| -------------------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`                   | **secret** — production Postgres, pooled connection string  |
| `WALRUS_MEMORY_PRIVATE_KEY`      | **secret** — MemWal delegate key                            |
| `WALRUS_MEMORY_ACCOUNT_ID`       | MemWalAccount object id                                     |
| `WALRUS_MEMORY_RELAYER_URL`      | Walrus Memory relayer base URL                              |
| `WALRUS_MEMORY_NAMESPACE_PREFIX` | lowercase prefix, e.g. `saksi`                              |
| `TATUM_API_KEY`                  | **secret**                                                  |
| `TATUM_SUI_RPC_URL`              | Tatum Sui GraphQL endpoint (`/graphql`)                     |
| `SUI_NETWORK`                    | `sui:mainnet`                                               |
| `SUI_USDC_COIN_TYPE`             | USDC coin type used for balances and verification           |
| `AGENT_SUI_ADDRESS`              | operator wallet shown on `/payments`                        |
| `X402_FACILITATOR_URL`           | Tentacle Pay facilitator                                    |
| `X402_PAY_TO_ADDRESS`            | merchant address that receives signal payments              |
| `X402_PRICE`                     | `10000` (atomic, $0.01) — avoid a literal `$` on Vercel too |
| `APP_BASE_URL`                   | the deployment URL, no trailing slash                       |
| `SESSION_SECRET`                 | **secret** — at least 32 chars                              |
| `DB_POOL_MAX`                    | `3` on serverless                                           |
| `LOG_LEVEL`                      | `info`                                                      |
| `TATUM_VERIFY_DIGEST`            | optional; the recorded mainnet settlement digest            |
| `OPERATOR_HANDLES`               | optional; comma-separated handles allowed to ingest signals |

Leave `X402_CLIENT_PRIVATE_KEY`, `X402_TEST_SIGNAL_ID` and `SIGNAL_PROVIDER_*` unset in
production: browser buyers sign with their own wallet, and the demo signal provider runs
on your machine only.

`OPERATOR_HANDLES` is also optional. Leave it empty and `/api/signals` POST returns 403
for every journal, which is the safe default for a public demo. If you want the ingest
path demonstrable, list exactly one handle and create that journal yourself. Setting it
also reveals the ingest form on `/signals` for everyone, so the gate is enforced in the
route, not in the UI.

`APP_BASE_URL` is chicken-and-egg on the first deploy. Deploy once, copy the assigned
domain, set `APP_BASE_URL` to it, then redeploy. A wrong value breaks session `Origin`
checks and the x402 `resource.url`.

## 4. Migrate the production database

Run once from your machine with the production `DATABASE_URL` in the environment:

```powershell
$env:DATABASE_URL = "<production connection string>"
pnpm db:migrate
Remove-Item Env:\DATABASE_URL
```

`drizzle.config.ts` does not read `.env.local`, so the variable must be set explicitly.

## 5. Verify the deployment

```bash
curl https://<domain>/api/health
```

Every check must be ok before you demo. Then:

1. Open `/onboarding` and create a journal.
2. Seal one pick, reveal it, resolve it with a real source URL — this writes the
   `pick_commit`, `pick_reveal` and `outcome` memories on mainnet.
3. Open `/memory` and confirm the blobs appear.
4. Buy a signal with your own wallet and confirm `/payments` shows the settlement.

## 6. After deploying

- Re-record one purchase so its `resource.url` uses the public domain, then update the
  README Proof table with that digest.
- Delete `C:\Users\Caussel\saksi-merchant-key.txt` after moving the value into a password
  manager.
- Record the 2–3 minute demo video and publish the blog post; both are required.

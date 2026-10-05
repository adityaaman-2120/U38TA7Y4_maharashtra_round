# Deploying Heirloom for free

Everything below runs on free plans, with no credit card needed on any of them (check each site's current terms).

| Part | Where | What it does |
|---|---|---|
| Web app | **Vercel** (Hobby) | Next.js site, plus a small server side for the file-storage relay and the RPC relay |
| API | **Render** (free web service) | Django: sign-in, key blobs, invitations, the indexer, notifications, claim alerts |
| Database | **Neon** (free) | Postgres |
| Scheduler | **cron-job.org** (free) | Calls `POST /internal/tick` on the API every minute |
| Chain | **Polygon Amoy** testnet via **Alchemy** | The smart contract; verified on **Polygonscan** |
| Files | **Pinata** (free) | Stores encrypted files (ciphertext only) |
| Email | **Resend** (free) | Sends invitations and alerts over HTTPS |

Do the steps in this order. Keep a notepad open: later steps need values from earlier ones.

---

## 0. Before you start
- A GitHub account, and this project pushed to a GitHub repository.
- Node.js 20+ and Python 3.12+ on your computer.
- MetaMask, with the **Polygon Amoy** network added (chain id `80002`).
- A **throwaway** wallet for deploying the contract. Never use a wallet that holds anything valuable. Create a new account in MetaMask, copy its private key (Account details, Show private key), and fund it with test POL from <https://faucet.polygon.technology> (choose Amoy).

Make three secrets now (any terminal):

```bash
python -c "import secrets; print(secrets.token_urlsafe(50))"    # DJANGO_SECRET_KEY
openssl rand -hex 32                                           # TICK_SECRET   (on Windows without openssl: python -c "import secrets; print(secrets.token_hex(32))")
```

---

## 1. Neon: the database
1. Go to <https://neon.com> and sign up.
2. **Create project**. Name `heirloom`, Postgres 17 or newer, region **AWS US East 2 (Ohio)** (it matches Render's Ohio region).
3. On the project dashboard click **Connect**. Leave **Connection pooling** switched **on**.
4. Copy the connection string. It looks like `postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require`.
   Save it as **DATABASE_URL**.

The free database sleeps after 5 minutes without queries and wakes in about a second. The scheduler in step 6 keeps it awake.

## 2. Alchemy: the Polygon Amoy RPC
1. <https://dashboard.alchemy.com> and sign up. **Create new app**, chain **Polygon**, network **Polygon Amoy**.
2. Open the app, copy the **HTTPS** URL (`https://polygon-amoy.g.alchemy.com/v2/YOUR_KEY`). Save it as **RPC_URL_80002**.
3. Note: Alchemy's free plan only allows `eth_getLogs` over 10 blocks at a time. Heirloom sends log queries to a second, public endpoint instead:
   **LOGS_RPC_URL_80002** = `https://polygon-amoy-bor-rpc.publicnode.com`.

## 3. Pinata: file storage
1. <https://app.pinata.cloud> and sign up. Open **API Keys** and **New Key**. Give it the permission **pinFileToIPFS** (Admin also works).
2. Copy the **JWT** shown once. Save it as **PINATA_JWT**. (The API key and secret are not needed.)
3. Under **Gateways**, note your dedicated gateway domain (like `yourname.mypinata.cloud`). Downloads work through it faster than the public gateway.
   Save `https://yourname.mypinata.cloud/ipfs` as **NEXT_PUBLIC_IPFS_GATEWAY** (optional; the default is Pinata's public gateway).

## 4. Resend: email
1. <https://resend.com> and sign up. **API Keys**, **Create API Key** (Sending access). Save it as **RESEND_API_KEY**.
2. **Without your own domain**, use the sender `Heirloom <onboarding@resend.dev>`. Resend only delivers such mail to **your own Resend account email address**, so invitations to other people will not arrive.
3. **To email anyone**: Resend, **Domains**, **Add Domain**, add the DNS records it shows at your domain registrar, wait for **Verified**, then use a sender like `Heirloom <alerts@yourdomain.com>` as **DEFAULT_FROM_EMAIL**.

## 5. Deploy the smart contract (from your computer)
1. In the project folder run `npm --prefix contracts install`.
2. Create `contracts/.env` (it is git-ignored) from `contracts/.env.example`:
   ```
   AMOY_RPC_URL=<your Alchemy URL>
   POLYGONSCAN_API_KEY=<from step 5b>
   DEPLOYER_PRIVATE_KEY=<the throwaway wallet's private key>
   ```
   **5b. Polygonscan key:** <https://polygonscan.com/myapikey> (sign up, **Add**, copy the key). One key also works on Etherscan v2 for Amoy.
3. Deploy the contract and the faucet test token:
   ```bash
   npm --prefix contracts run deploy:amoy
   npm --prefix contracts run deploy:token:amoy
   ```
   The output ends with the address and block number, and with the three `NEXT_PUBLIC_*` lines for Vercel.
4. Publish the source on Polygonscan:
   ```bash
   npm --prefix contracts run verify:amoy
   ```
5. The deploy updated these files. **Commit them**:
   `contracts/deployments/`, `backend/chain/` (`Heirloom.abi.json` and `deployments.json`), `web/src/lib/contracts.ts`.
   ```bash
   git add -A && git commit -m "Deploy to Amoy" && git push
   ```

## 6. Render: the API
1. <https://render.com>, sign up with GitHub.
2. **New**, **Blueprint**, pick your repository. Render reads `render.yaml` and proposes a service called `heirloom-api` on the **Free** plan. Click **Apply**.
   (Manual alternative: **New**, **Web Service**, root directory `backend`, runtime Python, plan Free, and copy the build and start commands from `render.yaml`.)
3. Open the service, **Environment**. Fill the empty values:

   | Key | Value |
   |---|---|
   | `DJANGO_SECRET_KEY` | the secret you generated in step 0 |
   | `DATABASE_URL` | Neon string (step 1) |
   | `TICK_SECRET` | the second secret from step 0 |
   | `RPC_URL_80002` | Alchemy URL (step 2) |
   | `LOGS_RPC_URL_80002` | `https://polygon-amoy-bor-rpc.publicnode.com` |
   | `RESEND_API_KEY` | Resend key (step 4) |
   | `DEFAULT_FROM_EMAIL` | `Heirloom <onboarding@resend.dev>` (or your verified sender) |
   | `FRONTEND_URL`, `ALLOWED_ORIGINS` | leave blank for now; step 7 gives the Vercel address |
   | `SIWE_ALLOWED_DOMAINS` | leave blank for now |

4. **Save**. The first deploy runs the build (it applies the migrations to Neon). Wait for **Live**.
5. Copy the service URL, `https://heirloom-api-xxxx.onrender.com`. Check `https://heirloom-api-xxxx.onrender.com/health`: it must answer `{"status": "ok", ...}`.

## 7. Vercel: the web app
1. <https://vercel.com>, sign up with GitHub. **Add New**, **Project**, import the repository.
2. **Root Directory**: click Edit and choose **`web`**. Framework preset: **Next.js** (automatic).
3. **Environment Variables** (all environments):

   | Key | Value |
   |---|---|
   | `BACKEND_URL` | the Render URL from step 6 (no trailing slash) |
   | `PINATA_JWT` | Pinata JWT (step 3). Server-only: it is never sent to browsers |
   | `NEXT_PUBLIC_CHAIN_ID` | `80002` |
   | `NEXT_PUBLIC_CONTRACT_ADDRESS` | from the deploy output |
   | `NEXT_PUBLIC_CONTRACT_START_BLOCK` | from the deploy output |
   | `NEXT_PUBLIC_ANON_AADHAAR_ADDRESS` | `anonAadhaar` in `contracts/deployments/amoy.json` |
   | `NEXT_PUBLIC_ANON_AADHAAR_MODE` | `test` (see the limitations in the README) |
   | `NEXT_PUBLIC_NULLIFIER_SEED` | `nullifierSeed` in `contracts/deployments/amoy.json` |
   | `NEXT_PUBLIC_TEST_TOKEN_ADDRESS` | address from `contracts/deployments/tokens/amoy.json` (optional) |
   | `NEXT_PUBLIC_RPC_PROXY` | `1` (the browser then reads the chain through your own `/api/rpc`, so the Alchemy key stays private) |
   | `NEXT_PUBLIC_LOG_CHUNK` | `1000` |
   | `RPC_URL_80002` | Alchemy URL (server-only) |
   | `LOGS_RPC_URL_80002` | `https://polygon-amoy-bor-rpc.publicnode.com` (server-only) |
   | `NEXT_PUBLIC_IPFS_GATEWAY` | optional, from step 3 |

4. **Deploy**. When it finishes, copy the address (`https://your-project.vercel.app`).
5. Go back to **Render, Environment** and set:
   - `FRONTEND_URL` = `https://your-project.vercel.app`
   - `ALLOWED_ORIGINS` = `https://your-project.vercel.app`
   - `SIWE_ALLOWED_DOMAINS` = `your-project.vercel.app`
   Save. Render redeploys by itself.
6. Open the Vercel address, then `/app`: connect MetaMask on Amoy and sign in. The first request after a quiet period can take up to a minute while Render wakes: the page says so.

## 8. cron-job.org: the scheduler
Without this, nothing happens in the background: no indexing, no notifications, no claim alerts, no reminders.
1. <https://cron-job.org>, create an account, **Create cronjob**.
2. **Title** `Heirloom tick`. **URL** `https://heirloom-api-xxxx.onrender.com/internal/tick` (your Render URL, https).
3. **Execution schedule**: every **1 minute**.
4. Open **Advanced**:
   - **Request method**: `POST`
   - **Headers**: add `X-Tick-Secret` with the value of `TICK_SECRET`
   - **Timeout**: 30 seconds
5. Under **Notifications** switch on **Notify me when the execution fails**.
6. **Create**, then **Test run**. The response must be `200` and a JSON body that starts `{"ok": true, ...}`. A `403` means the secret differs from Render's `TICK_SECRET`; a `503` means `TICK_SECRET` is empty on Render.

The call every minute also keeps the Render service awake (a free service sleeps after 15 minutes without traffic) and keeps Neon awake.

## 9. Check that it works
1. Open the site in two browsers (or profiles), with two MetaMask accounts, and follow the flow in the README: sign up, invite, create a vault, reserve a file.
2. `https://heirloom-api-xxxx.onrender.com/health` shows `ok`.
3. On cron-job.org, **History** shows green `200` rows.
4. Polygonscan shows your contract with a green **Contract** tick (verified).

---

## Redeploying

**Code change (web or API):** `git push`. Vercel and Render rebuild by themselves. Render re-runs the migrations during the build.

**Changed an environment variable:**
- Vercel: **Settings**, **Environment Variables**, edit, then **Deployments**, the three dots on the latest, **Redeploy** (`NEXT_PUBLIC_*` values are baked in at build time, so a redeploy is required).
- Render: edit, **Save changes** (it restarts the service).

**New contract version** (the contract is not upgradeable; a new deploy is a fresh start with empty vaults):
1. `npm --prefix contracts run deploy:amoy`, then `npm --prefix contracts run verify:amoy`.
2. Commit and push `contracts/deployments`, `backend/chain`, `web/src/lib/contracts.ts`.
3. In Vercel, update `NEXT_PUBLIC_CONTRACT_ADDRESS`, `NEXT_PUBLIC_CONTRACT_START_BLOCK`, `NEXT_PUBLIC_ANON_AADHAAR_ADDRESS` (if it changed) and redeploy.
4. The API picks up the new address from `backend/chain/deployments.json` on the next deploy. The indexer starts at the new contract's block; events of the old contract stay in the database but are no longer shown.

**Rotating a secret:** make a new one, change it in the service that uses it (and in cron-job.org for `TICK_SECRET`), redeploy that service, then delete the old one at the provider.

**Rolling back:** Vercel, **Deployments**, pick an older one, **Promote to Production**. Render, **Events**, **Rollback** on an earlier deploy.

## If something is wrong
| Symptom | Likely cause |
|---|---|
| The page shows "Waking up the server" for a minute | Render was asleep. Check cron-job.org is running every minute |
| Sign-in says "Origin not allowed" or fails | `ALLOWED_ORIGINS` / `SIWE_ALLOWED_DOMAINS` on Render do not match the Vercel address exactly (https, no trailing slash; the domain without https) |
| `/health` shows `degraded` | The RPC provider is unreachable; check `RPC_URL_80002` |
| Cron test run returns 403 | `X-Tick-Secret` differs from Render's `TICK_SECRET` |
| No emails arrive | `RESEND_API_KEY` missing; or the sender is `onboarding@resend.dev` and the recipient is not your own Resend account address |
| Events do not show in Audit | The tick is not running, or `LOGS_RPC_URL_80002` is wrong. Check `/health` and the cron history |
| Build on Vercel fails with "Set BACKEND_URL" | Add `BACKEND_URL` (the Render address) and redeploy |

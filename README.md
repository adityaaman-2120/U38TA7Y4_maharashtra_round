# Heirloom — trust-minimized digital inheritance

Files are encrypted in the browser (AES-256-GCM). The per-asset key is split with Shamir; each share is ECIES-encrypted to a
guardian's on-chain registered key. Ciphertext lives on IPFS (Pinata); the chain holds only hashes, public keys and encrypted shares.
```
contracts/  Hardhat + Solidity 0.8.24 (Heirloom.sol v2) — tests, deploy scripts
web/        Next.js App Router + wagmi/viem + MetaMask
backend/    Django 5 + DRF + Postgres + Redis + Celery (Docker Compose): sign-in, profiles, key blobs, invitations,
            chain indexer, notifications
```

## Setup
```bash
npm run install:all
cp web/.env.example web/.env.local     # set PINATA_JWT (server-side only) and BACKEND_URL
cp backend/.env.example backend/.env   # set DJANGO_SECRET_KEY and POSTGRES_PASSWORD
```

## Local development
```bash
npm run backend:up   # Postgres, Redis, API, Celery worker + beat in Docker (http://127.0.0.1:8000, set BACKEND_PORT to change)
HARDHAT_HOST=0.0.0.0 npm run dev   # hardhat node :8545 → compile + deploy → Next.js :3000
```
`HARDHAT_HOST=0.0.0.0` lets the indexer in Docker reach the node on your machine (PowerShell: `$env:HARDHAT_HOST="0.0.0.0"`). The node's accounts
and keys are public, so only do this on a network you trust. Deploying also writes the ABI and address to `backend/chain/`, which the
workers re-read on every run.
The browser only talks to Next.js; `/backend/*` is proxied to the API (`BACKEND_URL` in `web/.env.local`), so the session cookie stays
first-party. With `DJANGO_DEBUG=1` invitation emails are printed to the API log and the invite link is also shown to the owner.
Add the "Localhost" network (chain 31337, RPC `http://127.0.0.1:8545`) to MetaMask and import Hardhat test accounts,
or let the app's *Switch network* button add it. Deploys write `web/src/lib/contracts.ts` (ABI + addresses per chain).
Restarting the node resets the chain; clear the site's localStorage (or re-import your recovery file) for a fresh start.

## Sepolia
```bash
export DEPLOYER_PRIVATE_KEY=0x...      # funded with Sepolia ETH; never commit
# optional: export SEPOLIA_RPC_URL=...
npm --prefix contracts run deploy:sepolia
```
Restart the web server afterwards so the app picks up `contracts.ts`, then switch MetaMask to Sepolia.

## Polygon Amoy
```bash
export AMOY_RPC_URL=...  DEPLOYER_PRIVATE_KEY=...      # never commit these
npm --prefix contracts run deploy:amoy
```
Set `NEXT_PUBLIC_IPFS_GATEWAY` to a dedicated Pinata gateway for reliable downloads.

## Checks
```bash
npm test                          # contract tests
npm run backend:test              # API, indexer and notification tests, run inside the compose stack (Postgres + Redis)
npm --prefix web run lint
npm --prefix web run typecheck
```

## Backend
**What it stores (off-chain only):** wallet address, name, email, phone, the password-sealed encryption key, and invitations.
Never files, plaintext keys, DEKs or shares. Nothing personal goes on-chain.

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/nonce`, `POST /api/auth/verify` | Sign-In With Ethereum (EIP-4361). The server builds and stores the message, so the nonce is single-use and bound to the address, chain and frontend origin. A valid signature sets an httpOnly JWT cookie. |
| `POST /api/auth/logout` | Clears the cookie and revokes every token issued so far. |
| `GET/PUT /api/me` | Profile (name, email, optional phone). |
| `GET/PUT /api/key-blob` | The sealed encryption key. Strictly validated (fixed lengths, PBKDF2 ≥ 600k) so a raw key can never be stored by mistake; replacing it with a different key is refused. |
| `GET/POST /api/invites`, `DELETE /api/invites/<id>`, `POST …/resend` | The owner's invitations (guardian or beneficiary). |
| `POST /api/invites/preview`, `POST /api/invites/accept` | The invitee's side: a signed, expiring, single-use token from the emailed link. Accepting requires a completed profile whose email matches the invite, and a stored key. |
| `GET /api/contacts?role=` | Accepted invitees: the only people the owner can pick as guardians or beneficiaries in the app. |
| `GET /api/events` | Indexed contract events, newest first. Filters: `chain_id`, `asset_id`, `claim_id`, `actor`, `event`; paging with `limit` and `before_id`. Also returns each chain's indexer progress. |
| `GET /api/notifications`, `POST /api/notifications/read` | The signed-in user's in-app notifications (feeds the bell); mark by `ids` or `all`. |

### Indexer and notifications
Celery beat runs two scheduled tasks (`worker` executes them, `beat` schedules them; run exactly one beat):
- **`indexer.index_all_chains`** (every 15 s) reads the contract's logs with web3.py and stores every event in Postgres.
  - *Idempotent:* a log is identified by (chain, tx hash, log index); replaying a block range never duplicates anything.
  - *Resumable:* progress is a per-deployment `last_block`, advanced in the same transaction as the rows it covers.
  - *Final:* only blocks buried under `CONFIRMATIONS_<chain>` blocks are indexed (0 locally, 4 Sepolia, 30 Amoy), so nobody is emailed about an event that a reorg could undo.
  - *Self-healing:* if the last indexed block is no longer canonical (a deeper reorg, or a reset local chain) orphaned rows are dropped and indexing resumes from the fork point.
- **`notifications.send_reminders`** (every 5 min) sends heartbeat-due / overdue reminders to owners and attestation-deadline reminders to guardians who have not yet responded. "Now" is the chain's clock, because that is what the contract compares against.

New events become in-app notifications and emails (queued as separate Celery tasks that retry with backoff). Each is created at most once per person
(unique per user and event or reminder cycle), so replays and restarts never repeat an email.

| Event | Who is notified |
|---|---|
| ClaimRaised | owner (urgent) and every guardian of the claim (urgent) |
| Attested, ClaimRejectedByGuardian | owner and the claimant |
| ClaimRejected | owner, claimant, guardians |
| FraudFlagged | owner (urgent), claimant, the other guardians |
| ClaimCancelled | claimant and guardians |
| ClaimFinalized | beneficiary, and guardians (urgent: release your share) |
| ShareReleased | beneficiary |

Only people with a Heirloom account are notified; others are skipped. The audit page reads from `/api/events` and falls back to reading the chain
directly if the indexer is unreachable, stalled, reporting an error, or more than 200 blocks behind.

**Security notes**
- Rate limits (Redis): nonce 30/min, verify 10/min, invite preview 30/min, invite create 30/h, resend 10/h, per client IP. Set
  `NUM_PROXIES` to the number of reverse proxies in front of the API so IPs cannot be spoofed.
- Cookie: httpOnly, `SameSite=Lax`, `Secure` outside `DJANGO_DEBUG`. State-changing requests whose `Origin` is not in `ALLOWED_ORIGINS` are rejected.
- Restricting the owner to accepted contacts is enforced in the app. The contract itself accepts any address that has registered a key,
  so a modified client could still add someone else.
- `DJANGO_DEBUG` must be `0` in any shared environment (it relaxes the cookie, returns invite links in responses, and allows an in-memory cache).

## How it works
1. **Onboarding** — connect a wallet and sign in with Ethereum, add your name and email (off-chain), then the browser generates a
   secp256k1 encryption keypair and you set an encryption password (PBKDF2-SHA256 600k → AES-GCM seals the private key). The sealed
   key is stored on the server so it follows you to other devices; you also download a recovery file, and the public key is
   registered on-chain. The unlocked key exists only in memory for the session.
2. **Owner** — invites guardians and beneficiaries by email (People tab). Once they accept, creates a vault from those contacts
   (3–7 guardians with registered keys, Shamir threshold, check-in interval), reserves files for
   beneficiaries under a policy, checks in with *I'm alive*, can cancel claims and panic-freeze the vault.
3. **Beneficiary** — sees reserved files (never content), raises a claim with encrypted evidence once the owner has been silent
   long enough, finalizes after the challenge period, then decrypts once enough guardians released their shares. The SHA-256 of
   the result is checked against the on-chain hash ("Integrity verified").
4. **Guardian** — decrypts and previews the claim's evidence in the browser (approval stays locked until they have), then
   approves / rejects / flags fraud; after finalization re-encrypts their share to the beneficiary.
5. **Audit** — every contract event with readable labels, filters (asset, claim, event type, actor, "only mine") and explorer links.

### Evidence
The beneficiary's evidence file is encrypted with a fresh AES-256-GCM key. That key is ECIES-wrapped to each guardian and the
owner, and the wraps are stored inside the encrypted bundle on IPFS. On-chain there is only `evidenceHash` (SHA-256 of the
plaintext) and the bundle's storage id. Guardians check the decrypted file against that hash before relying on it.

## Problem-statement coverage
| Requirement | How Heirloom meets it |
|---|---|
| Secure access control | Files are AES-256-GCM encrypted in the browser; the key is Shamir-split and each share is ECIES-encrypted to a guardian. Nothing opens before the contract reaches `Finalized`. |
| No single party can access secrets | Server and chain only hold ciphertext, hashes and encrypted shares. A guardian alone holds one share, which reveals nothing. |
| Unavailability detection without one signal | A claim needs all of: owner silence past `minInactivity` (heartbeat), beneficiary evidence with an on-chain hash, guardian approvals, and an elapsed challenge period. An inactivity timer alone never releases anything. |
| Recovery authorization | Independent guardians review the decrypted evidence and approve, reject, or flag fraud; `requiredApprovals` must be met. |
| Emergency intervention | Owner can check in (voids any open claim), cancel a claim, or panic-freeze the vault. A guardian fraud flag blocks a claim. |
| Conditional access | Per-asset policy: beneficiary, approvals, challenge period, inactivity, evidence type, time lock (`unlockAfter`), attestation deadline. |
| Failure handling | After `attestationDeadline`, the guardian threshold suffices if guardians are unresponsive. Owners can replace guardians and re-share assets, and can always open their own copy. |
| Auditability | Every action emits an event; the Audit page lists them with filters and explorer links. |

Known limits: guardians are trusted to review honestly (a threshold of them colluding with a beneficiary could release early,
which is why the owner's challenge period and check-in exist), and the contract is unaudited.

## Storage API
`POST /api/storage` (`Content-Type: application/octet-stream`, ≤ 25 MB) pins ciphertext to Pinata using the server-side
`PINATA_JWT` and returns `{ cid }`. The route is unauthenticated; put rate limiting / auth in front of it before exposing it publicly.

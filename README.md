# Heirloom — trust-minimized digital inheritance

Files are encrypted in the browser (AES-256-GCM). The per-asset key is split with Shamir; each share is ECIES-encrypted to a
guardian's on-chain registered key. Ciphertext lives on IPFS (Pinata); the chain holds only hashes, public keys and encrypted shares.
```
contracts/  Hardhat + Solidity 0.8.24 (Heirloom.sol v2) — tests, deploy scripts
web/        Next.js App Router + wagmi/viem + MetaMask
```

## Setup
```bash
npm run install:all
cp web/.env.example web/.env.local     # set PINATA_JWT (server-side only)
```

## Local development
```bash
npm run dev    # hardhat node :8545 → compile + deploy → Next.js :3000
```
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
npm --prefix web run lint
npm --prefix web run typecheck
```

## How it works
1. **Onboarding** — on first connect the browser generates a secp256k1 encryption keypair, you set an encryption password
   (PBKDF2-SHA256 600k → AES-GCM seals the private key), download a recovery file, and the public key is registered on-chain.
   The unlocked key exists only in memory for the session.
2. **Owner** — creates a vault (3–7 guardians with registered keys, Shamir threshold, check-in interval), reserves files for
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

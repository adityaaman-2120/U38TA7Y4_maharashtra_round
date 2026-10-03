'use client';

/**
 * vault.ts — the recovery state machine.
 *
 *   ACTIVE ──(heartbeat deadline missed AND >=3 guardian attestations)──> RECOVERY_PENDING
 *   RECOVERY_PENDING ──(owner cancels)──> ACTIVE
 *   RECOVERY_PENDING ──(challenge window expires)──> RELEASED
 *   RELEASED ──(heir proves identity, collects >=3 shares)──> CLAIMED
 *
 * Two independent signals are required to leave ACTIVE. A missed heartbeat on
 * its own does nothing: an owner in a coma, on a long flight, or simply
 * careless with their phone must not lose their secrets. Guardian attestation
 * on its own does nothing either, or a colluding quorum could seize a living
 * owner's vault at will. Both, or neither.
 *
 * There is deliberately no admin role, no pause, and no override in this file.
 */
import { create } from 'zustand';
import {
  GUARDIAN_COUNT,
  THRESHOLD,
  combineKey,
  decryptAsset,
  encryptAsset,
  fromHex,
  fromUtf8,
  generateKeypair,
  heirCommitment,
  openShare,
  sealShare,
  splitKey,
  toHex,
  utf8,
} from '@/lib/crypto';
import type {
  AssetCategory,
  AuditEntry,
  AuditKind,
  Guardian,
  Role,
  Vault,
  VaultState,
} from '@/lib/types';

const GUARDIAN_NAMES = [
  'Mara (sister)',
  'Dr. Okafor',
  'Yusuf (lawyer)',
  'Priya (friend)',
  'Cold-storage HSM',
];

export const DEFAULT_HEARTBEAT_MS = 365 * 24 * 60 * 60 * 1000; // 1 year
export const DEFAULT_CHALLENGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const CLAIM_THRESHOLD = 70;

export const HEIR_WALLET = '0xHEIR000000000000000000000000000000000002';

let auditSeq = 0;

/* ── claim scoring ────────────────────────────────────────────────────── */

export interface ClaimFactor {
  label: string;
  weight: number;
  earned: number;
  met: boolean;
  note: string;
}

export interface ClaimAssessment {
  factors: ClaimFactor[];
  score: number;
  passes: boolean;
}

export interface CreateVaultInput {
  name: string;
  category: AssetCategory;
  secretText: string;
  filename: string;
  heirId: string;
  salt: string;
  heirWallet: string;
  heartbeatMs: number;
  challengeMs: number;
}

/* ── store shape ──────────────────────────────────────────────────────── */

interface VaultStore {
  vault: Vault | null;
  role: Role;
  /** Demo time travel: every deadline is evaluated against now(). */
  clockSkewMs: number;
  /** Plaintext of a successful claim, held only in memory. */
  recovered: { text: string; filename: string } | null;
  claimError: string;
  busy: boolean;

  now: () => number;
  seed: () => Promise<void>;
  reset: () => Promise<void>;
  createVault: (input: CreateVaultInput) => Promise<void>;

  heartbeat: () => void;
  attest: (guardianId: number) => void;
  startRecovery: (actor?: string) => boolean;
  cancelRecovery: () => void;
  finalizeRelease: (actor?: string) => boolean;
  releaseShare: (guardianId: number) => void;
  claim: (heirId: string, salt: string, wallet: string) => Promise<void>;

  setRole: (r: Role) => void;
  /** Lets the demo panel push an identity into the heir's claim form. */
  prefill: { heirId: string; salt: string; wallet: string; stamp: number } | null;
  setPrefill: (p: { heirId: string; salt: string; wallet: string }) => void;
  toggleGuardian: (guardianId: number) => void;
  fastForwardHeartbeat: () => void;
  fastForwardChallenge: () => void;
  tick: () => void;

  heartbeatDeadline: () => number;
  heartbeatMissed: () => boolean;
  attestationCount: () => number;
  releasedShareCount: () => number;
  challengeEndsAt: () => number;
  assessClaim: (idMatches: boolean, walletMatches: boolean) => ClaimAssessment;
}

/* ── helpers ──────────────────────────────────────────────────────────── */

function entry(kind: AuditKind, actor: string, message: string, at: number): AuditEntry {
  return { id: `e${++auditSeq}`, at, kind, actor, message };
}

function freshGuardians(): Guardian[] {
  return GUARDIAN_NAMES.map((name, i) => ({
    id: i + 1,
    name,
    online: true,
    attested: false,
    shareReleased: false,
  }));
}

/** Build a vault from plaintext — the whole deposit path, real crypto. */
async function buildVault(input: CreateVaultInput, at: number): Promise<Vault> {
  const heir = generateKeypair();
  const env = await encryptAsset(utf8(input.secretText));
  const shares = await splitKey(env.keyBytes);
  const sealed = shares.map((s, i) => ({
    guardianId: i + 1,
    sealedHex: toHex(sealShare(heir.pubHex, s)),
  }));
  // env.keyBytes is dropped here and never stored: the only route back to the
  // AES key is three guardians plus the heir's private key.
  const commitment = await heirCommitment(input.heirId, input.salt);

  return {
    id: `vault-${at.toString(36)}`,
    name: input.name,
    category: input.category,
    state: 'ACTIVE',
    ciphertextHex: toHex(env.ciphertext),
    ivHex: toHex(env.iv),
    assetFilename: input.filename,
    assetIsText: true,
    shares: sealed,
    guardians: freshGuardians(),
    heirCommitment: commitment,
    heirPubHex: heir.pubHex,
    heirPrivHex: heir.privHex,
    heirWallet: input.heirWallet,
    heartbeatIntervalMs: input.heartbeatMs,
    lastHeartbeatAt: at,
    challengeWindowMs: input.challengeMs,
    createdAt: at,
    audit: [
      entry(
        'vault-created',
        'owner',
        `Vault "${input.name}" created · ${THRESHOLD}-of-${GUARDIAN_COUNT} guardians · commitment ${commitment.slice(0, 12)}…`,
        at,
      ),
    ],
  };
}

export const SEED_SECRET = [
  'HEIRLOOM — SEALED LETTER & RECOVERY SHEET',
  '',
  'Wallet seed (Ledger, 2019):',
  '  abandon ability able about above absent absorb abstract',
  '  absurd abuse access accident account accuse achieve acid',
  '',
  'Safe deposit box: Credit Mutuel, Lyon — box 2271, key taped',
  'under the second drawer of the walnut desk.',
  '',
  'Mara — the house is yours. Sell the boat, it was never',
  'as much fun as I claimed. Tell Yusuf he was right about 2014.',
  '',
  '— A.',
].join('\n');

const SEED_INPUT: CreateVaultInput = {
  name: 'Estate of A. Vance',
  category: 'wallet-seed',
  secretText: SEED_SECRET,
  filename: 'sealed-letter.txt',
  heirId: 'FR-8842-1193',
  salt: 'walnut-desk-2019',
  heirWallet: HEIR_WALLET,
  heartbeatMs: DEFAULT_HEARTBEAT_MS,
  challengeMs: DEFAULT_CHALLENGE_MS,
};

export const SEED_HEIR_ID = SEED_INPUT.heirId;
export const SEED_SALT = SEED_INPUT.salt;

/* ── store ────────────────────────────────────────────────────────────── */

export const useVault = create<VaultStore>((set, get) => ({
  vault: null,
  role: 'owner',
  clockSkewMs: 0,
  recovered: null,
  claimError: '',
  busy: false,

  now: () => Date.now() + get().clockSkewMs,

  seed: async () => {
    if (get().vault) return;
    set({ busy: true });
    // Created 300 days ago so the countdown opens with real time on the clock.
    const vault = await buildVault(SEED_INPUT, Date.now() - 300 * 24 * 60 * 60 * 1000);
    set({ vault, busy: false, clockSkewMs: 0, recovered: null, claimError: '' });
  },

  reset: async () => {
    auditSeq = 0;
    set({
      vault: null,
      clockSkewMs: 0,
      recovered: null,
      claimError: '',
      role: 'owner',
      prefill: null,
    });
    await get().seed();
  },

  createVault: async (input) => {
    set({ busy: true });
    auditSeq = 0;
    const vault = await buildVault(input, Date.now() + get().clockSkewMs);
    set({ vault, busy: false, recovered: null, claimError: '' });
  },

  /* ── owner ──────────────────────────────────────────────────────────── */

  heartbeat: () => {
    const { vault, now } = get();
    if (!vault) return;
    if (vault.state === 'RELEASED' || vault.state === 'CLAIMED') return;
    const at = now();
    // A heartbeat during RECOVERY_PENDING is itself proof of life: it cancels.
    const wasPending = vault.state === 'RECOVERY_PENDING';
    set({
      vault: {
        ...vault,
        state: 'ACTIVE',
        lastHeartbeatAt: at,
        recoveryStartedAt: undefined,
        guardians: wasPending
          ? vault.guardians.map((g) => ({ ...g, attested: false, attestedAt: undefined }))
          : vault.guardians,
        audit: [
          ...vault.audit,
          entry('heartbeat', 'owner', 'Owner checked in — heartbeat clock reset', at),
          ...(wasPending
            ? [
                entry(
                  'recovery-cancelled',
                  'owner',
                  'Heartbeat during challenge window cancelled recovery; attestations cleared',
                  at,
                ),
              ]
            : []),
        ],
      },
    });
  },

  cancelRecovery: () => {
    const { vault, now } = get();
    if (!vault) return;
    if (vault.state !== 'RECOVERY_PENDING') return; // only legal in this state
    const at = now();
    set({
      vault: {
        ...vault,
        state: 'ACTIVE',
        lastHeartbeatAt: at,
        recoveryStartedAt: undefined,
        guardians: vault.guardians.map((g) => ({ ...g, attested: false, attestedAt: undefined })),
        audit: [
          ...vault.audit,
          entry(
            'recovery-cancelled',
            'owner',
            'Owner cancelled recovery — vault returned to ACTIVE, attestations cleared',
            at,
          ),
        ],
      },
    });
  },

  /* ── guardians ──────────────────────────────────────────────────────── */

  attest: (guardianId) => {
    const { vault, now } = get();
    if (!vault || vault.state !== 'ACTIVE') return;
    const g = vault.guardians.find((x) => x.id === guardianId);
    if (!g || !g.online || g.attested) return;
    const at = now();
    const guardians = vault.guardians.map((x) =>
      x.id === guardianId ? { ...x, attested: true, attestedAt: at } : x,
    );
    const count = guardians.filter((x) => x.attested).length;
    set({
      vault: {
        ...vault,
        guardians,
        audit: [
          ...vault.audit,
          entry(
            'attestation',
            g.name,
            `Attested owner unavailable (${count}/${THRESHOLD} needed)`,
            at,
          ),
        ],
      },
    });
    // Attestation alone never moves the state; startRecovery re-checks both.
    get().startRecovery('guardian quorum');
  },

  startRecovery: (actor = 'anyone (permissionless)') => {
    const { vault, now, heartbeatMissed, attestationCount } = get();
    if (!vault || vault.state !== 'ACTIVE') return false;
    // BOTH signals. Never the timer alone, never the attestations alone.
    if (!heartbeatMissed()) return false;
    if (attestationCount() < THRESHOLD) return false;
    const at = now();
    set({
      vault: {
        ...vault,
        state: 'RECOVERY_PENDING',
        recoveryStartedAt: at,
        audit: [
          ...vault.audit,
          entry(
            'recovery-started',
            actor,
            `Recovery opened — heartbeat deadline missed AND ${attestationCount()}/${GUARDIAN_COUNT} guardians attested. Challenge window begins.`,
            at,
          ),
        ],
      },
    });
    return true;
  },

  finalizeRelease: (actor = 'anyone (permissionless)') => {
    const { vault, now, challengeEndsAt } = get();
    if (!vault || vault.state !== 'RECOVERY_PENDING') return false;
    if (now() < challengeEndsAt()) return false;
    const at = now();
    set({
      vault: {
        ...vault,
        state: 'RELEASED',
        audit: [
          ...vault.audit,
          entry(
            'released',
            actor,
            'Challenge window expired with no cancellation — guardians may now release shares',
            at,
          ),
        ],
      },
    });
    return true;
  },

  releaseShare: (guardianId) => {
    const { vault, now } = get();
    if (!vault) return;
    if (vault.state !== 'RELEASED') return; // guardians cannot release early
    const g = vault.guardians.find((x) => x.id === guardianId);
    if (!g || !g.online || g.shareReleased) return;
    const at = now();
    const guardians = vault.guardians.map((x) =>
      x.id === guardianId ? { ...x, shareReleased: true } : x,
    );
    const count = guardians.filter((x) => x.shareReleased).length;
    set({
      vault: {
        ...vault,
        guardians,
        audit: [
          ...vault.audit,
          entry(
            'share-released',
            g.name,
            `Released sealed share #${guardianId} (${count}/${THRESHOLD} needed to reconstruct)`,
            at,
          ),
        ],
      },
    });
  },

  /* ── heir ───────────────────────────────────────────────────────────── */

  claim: async (heirId, salt, wallet) => {
    const { vault, now } = get();
    if (!vault) return;
    const at = now();

    const reject = (reason: string, v: Vault = vault) => {
      set({
        busy: false,
        claimError: reason,
        vault: {
          ...v,
          audit: [
            ...v.audit,
            entry('claim-rejected', `claimant ${heirId.trim() || '(blank)'}`, reason, at),
          ],
        },
      });
    };

    if (vault.state !== 'RELEASED') {
      reject(
        vault.state === 'CLAIMED'
          ? 'Already claimed — the vault is spent.'
          : `Claim refused: vault is ${vault.state}, not RELEASED. Shares are not published until the challenge window closes.`,
      );
      return;
    }

    set({ busy: true, claimError: '' });
    const commitment = await heirCommitment(heirId, salt);
    const idMatches = commitment === vault.heirCommitment;
    const walletMatches = wallet.trim().toLowerCase() === vault.heirWallet.toLowerCase();
    const assessment = get().assessClaim(idMatches, walletMatches);

    if (!idMatches) {
      reject(
        `Commitment check failed — sha256(ID+salt) = ${commitment.slice(0, 12)}… does not match the committed ${vault.heirCommitment.slice(0, 12)}…. Claim strength ${assessment.score}, below ${CLAIM_THRESHOLD}.`,
      );
      return;
    }
    if (!assessment.passes) {
      reject(`Claim strength ${assessment.score} is below the ${CLAIM_THRESHOLD} threshold.`);
      return;
    }

    const released = vault.shares.filter(
      (s) => vault.guardians.find((g) => g.id === s.guardianId)?.shareReleased,
    );
    if (released.length < THRESHOLD) {
      reject(
        `Only ${released.length} share(s) published — ${THRESHOLD} are required to reconstruct the key.`,
      );
      return;
    }

    try {
      const opened = released
        .slice(0, THRESHOLD)
        .map((s) => openShare(vault.heirPrivHex, fromHex(s.sealedHex)));
      const keyBytes = await combineKey(opened);
      const plain = await decryptAsset(keyBytes, fromHex(vault.ciphertextHex), fromHex(vault.ivHex));
      set({
        busy: false,
        claimError: '',
        recovered: { text: fromUtf8(plain), filename: vault.assetFilename },
        vault: {
          ...vault,
          state: 'CLAIMED',
          audit: [
            ...vault.audit,
            entry(
              'claimed',
              `heir ${heirId.trim()}`,
              `Claim accepted at strength ${assessment.score}. ${THRESHOLD} shares unsealed, AES key reconstructed, asset decrypted.`,
              at,
            ),
          ],
        },
      });
    } catch (e) {
      reject(`Decryption failed: ${String(e)}`);
    }
  },

  assessClaim: (idMatches, walletMatches) => {
    const { attestationCount, vault, now, challengeEndsAt } = get();
    const atts = Math.min(attestationCount(), 3);
    const waited = !!vault && vault.state !== 'ACTIVE' && now() >= challengeEndsAt();

    // Attestation and waiting-period credit are conditional on identity.
    // Otherwise a bystander would inherit the owner's unavailability signals,
    // and a stranger could cross the threshold on the owner's own misfortune.
    const gated = (v: number) => (idMatches ? v : 0);

    const factors: ClaimFactor[] = [
      {
        label: 'Identity commitment matches',
        weight: 40,
        earned: idMatches ? 40 : 0,
        met: idMatches,
        note: idMatches ? 'sha256(ID+salt) equals the committed digest' : 'no matching commitment',
      },
      {
        label: 'Holds registered heir wallet',
        weight: 25,
        earned: walletMatches ? 25 : 0,
        met: walletMatches,
        note: walletMatches ? 'address matches the registered heir' : 'address not registered',
      },
      {
        label: `Guardian attestations (${atts} × 10)`,
        weight: 30,
        earned: gated(atts * 10),
        met: idMatches && atts > 0,
        note: idMatches ? `${atts} attestation(s) credited` : 'not credited — identity unproven',
      },
      {
        label: 'Waiting period elapsed',
        weight: 20,
        earned: gated(waited ? 20 : 0),
        met: idMatches && waited,
        note: idMatches
          ? waited
            ? 'challenge window closed'
            : 'window still open'
          : 'not credited — identity unproven',
      },
    ];
    const score = factors.reduce((s, f) => s + f.earned, 0);
    return { factors, score, passes: score >= CLAIM_THRESHOLD };
  },

  /* ── demo controls ──────────────────────────────────────────────────── */

  setRole: (role) => set({ role }),

  prefill: null,
  setPrefill: (p) => set({ prefill: { ...p, stamp: Date.now() }, claimError: '' }),

  toggleGuardian: (guardianId) => {
    const { vault, now } = get();
    if (!vault) return;
    const g = vault.guardians.find((x) => x.id === guardianId);
    if (!g) return;
    const at = now();
    set({
      vault: {
        ...vault,
        guardians: vault.guardians.map((x) =>
          x.id === guardianId ? { ...x, online: !x.online } : x,
        ),
        audit: [
          ...vault.audit,
          entry(
            'guardian-toggled',
            'demo',
            `${g.name} is now ${g.online ? 'OFFLINE' : 'ONLINE'}`,
            at,
          ),
        ],
      },
    });
  },

  fastForwardHeartbeat: () => {
    const { vault, clockSkewMs, now } = get();
    if (!vault) return;
    const target = vault.lastHeartbeatAt + vault.heartbeatIntervalMs + 60_000;
    const delta = Math.max(0, target - now());
    if (delta === 0) return;
    set({
      clockSkewMs: clockSkewMs + delta,
      vault: {
        ...vault,
        audit: [
          ...vault.audit,
          entry('demo', 'demo', 'Fast-forwarded past the heartbeat deadline', now() + delta),
        ],
      },
    });
    get().tick();
  },

  fastForwardChallenge: () => {
    const { vault, clockSkewMs, now, challengeEndsAt } = get();
    if (!vault || vault.state !== 'RECOVERY_PENDING') return;
    const delta = Math.max(0, challengeEndsAt() + 60_000 - now());
    set({
      clockSkewMs: clockSkewMs + delta,
      vault: {
        ...vault,
        audit: [
          ...vault.audit,
          entry('demo', 'demo', 'Fast-forwarded past the challenge window', now() + delta),
        ],
      },
    });
    get().tick();
  },

  /** Drives the permissionless transitions; no privileged keeper involved. */
  tick: () => {
    const s = get();
    if (!s.vault) return;
    if (s.vault.state === 'ACTIVE') s.startRecovery();
    else if (s.vault.state === 'RECOVERY_PENDING') s.finalizeRelease();
  },

  /* ── derived ────────────────────────────────────────────────────────── */

  heartbeatDeadline: () => {
    const v = get().vault;
    return v ? v.lastHeartbeatAt + v.heartbeatIntervalMs : 0;
  },
  heartbeatMissed: () => {
    const { vault, now, heartbeatDeadline } = get();
    return !!vault && now() > heartbeatDeadline();
  },
  attestationCount: () => get().vault?.guardians.filter((g) => g.attested).length ?? 0,
  releasedShareCount: () => get().vault?.guardians.filter((g) => g.shareReleased).length ?? 0,
  challengeEndsAt: () => {
    const v = get().vault;
    return v?.recoveryStartedAt ? v.recoveryStartedAt + v.challengeWindowMs : Infinity;
  },
}));

export const STATE_STYLE: Record<VaultState, string> = {
  ACTIVE: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  RECOVERY_PENDING: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  RELEASED: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  CLAIMED: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
};

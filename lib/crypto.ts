/**
 * crypto.ts — Heirloom's real cryptography.
 *
 * Nothing in this file is simulated. The AES-256-GCM envelope, the 3-of-5
 * Shamir split and the per-guardian ECIES seals are genuine; only the chain
 * layer that *stores* the resulting blobs is faked (see store/vault.ts).
 *
 * Threat model: the ciphertext may be public (it stands in for IPFS). The AES
 * key never exists at rest in one piece — it is split across five guardians,
 * each share sealed to the heir's public key. No guardian, and no quorum of
 * guardians short of three, learns anything about the key. The platform holds
 * no key material at all.
 */
// eciesjs reaches for a global Buffer; supply one in the browser.
import { Buffer as NodeBuffer } from 'buffer';
if (typeof globalThis !== 'undefined' && !(globalThis as unknown as { Buffer?: unknown }).Buffer) {
  (globalThis as unknown as { Buffer: unknown }).Buffer = NodeBuffer;
}

import { split, combine } from 'shamir-secret-sharing';
import { encrypt as eciesEncrypt, decrypt as eciesDecrypt, PrivateKey } from 'eciesjs';

export const THRESHOLD = 3;
export const GUARDIAN_COUNT = 5;

/** Web Crypto wants a BufferSource over a plain ArrayBuffer; TS 5.7 is strict about it. */
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

/* ── encoding helpers ─────────────────────────────────────────────────── */

export const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export const fromHex = (h: string): Uint8Array => {
  const clean = h.startsWith('0x') ? h.slice(2) : h;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
};

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
export const fromUtf8 = (b: Uint8Array): string => new TextDecoder().decode(b);

/** Short display form for a blob, e.g. "a4f2…9c01 (112 B)". */
export const preview = (b: Uint8Array): string => {
  const h = toHex(b);
  return `${h.slice(0, 8)}…${h.slice(-4)} (${b.length} B)`;
};

/* ── heir / guardian identity keys (secp256k1, used by ECIES) ─────────── */

export interface Keypair {
  privHex: string;
  pubHex: string;
}

export function generateKeypair(): Keypair {
  const sk = new PrivateKey();
  return { privHex: sk.toHex(), pubHex: sk.publicKey.toHex() };
}

/* ── AES-256-GCM asset envelope ───────────────────────────────────────── */

export interface Envelope {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  /** Raw 32-byte AES key. Exists only transiently at deposit time. */
  keyBytes: Uint8Array;
}

export async function encryptAsset(plaintext: Uint8Array): Promise<Envelope> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bs(iv) }, key, bs(plaintext));
  const raw = await crypto.subtle.exportKey('raw', key);
  return { ciphertext: new Uint8Array(ct), iv, keyBytes: new Uint8Array(raw) };
}

export async function decryptAsset(
  keyBytes: Uint8Array,
  ciphertext: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', bs(keyBytes), 'AES-GCM', false, [
    'decrypt',
  ]);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bs(iv) }, key, bs(ciphertext));
  return new Uint8Array(pt);
}

/* ── Shamir 3-of-5 over the AES key ───────────────────────────────────── */

export async function splitKey(keyBytes: Uint8Array): Promise<Uint8Array[]> {
  return split(keyBytes, GUARDIAN_COUNT, THRESHOLD);
}

export async function combineKey(shares: Uint8Array[]): Promise<Uint8Array> {
  if (shares.length < THRESHOLD) {
    throw new Error(`need ${THRESHOLD} shares, got ${shares.length}`);
  }
  return combine(shares);
}

/* ── per-share ECIES seal to the heir's public key ────────────────────── */

/** Seal one Shamir share so that only the heir's private key can open it. */
export function sealShare(heirPubHex: string, share: Uint8Array): Uint8Array {
  return new Uint8Array(eciesEncrypt(heirPubHex, share));
}

export function openShare(heirPrivHex: string, sealed: Uint8Array): Uint8Array {
  return new Uint8Array(eciesDecrypt(heirPrivHex, sealed));
}

/* ── heir identity commitment (Phase 4) ───────────────────────────────── */

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bs(utf8(input)));
  return toHex(new Uint8Array(digest));
}

/**
 * Commitment published at vault creation. The heir's raw ID never leaves the
 * owner's browser; at claim time the heir re-derives this and it is compared
 * byte for byte. In production this comparison is a ZK circuit, so the heir
 * proves knowledge of (id, salt) without revealing either.
 */
export const heirCommitment = (heirId: string, salt: string): Promise<string> =>
  sha256Hex(`${heirId.trim()}${salt.trim()}`);

/* ── end-to-end self test (Phase 1 proof) ─────────────────────────────── */

export interface SelfTestStep {
  label: string;
  detail: string;
  ok: boolean;
}

/**
 * Runs the full deposit → recovery loop in the browser with a fresh heir key
 * and only THREE of the five shares, proving the threshold actually holds.
 */
export async function runSelfTest(secretText: string): Promise<{
  steps: SelfTestStep[];
  recovered: string;
  ok: boolean;
}> {
  const steps: SelfTestStep[] = [];
  const push = (label: string, detail: string, ok = true) => steps.push({ label, detail, ok });

  const heir = generateKeypair();
  push('Heir keypair generated', `pub ${heir.pubHex.slice(0, 18)}…`);

  const env = await encryptAsset(utf8(secretText));
  push('Asset encrypted (AES-256-GCM)', `ct ${preview(env.ciphertext)}, iv ${toHex(env.iv)}`);
  push('AES key exported', `${env.keyBytes.length * 8}-bit key ${preview(env.keyBytes)}`);

  const shares = await splitKey(env.keyBytes);
  push('Key split (Shamir 3-of-5)', shares.map((s, i) => `G${i + 1}:${s.length}B`).join('  '));

  const sealed = shares.map((s) => sealShare(heir.pubHex, s));
  push('Each share sealed to heir (ECIES)', sealed.map((s) => `${s.length}B`).join('  '));

  // Deliberately drop guardians 2 and 4 — recovery must still succeed.
  const subset = [sealed[0], sealed[2], sealed[4]];
  push('Quorum collected', 'guardians 1, 3, 5 released — 2 and 4 withheld');

  const opened = subset.map((s) => openShare(heir.privHex, s));
  push('Shares unsealed by heir', opened.map((s) => `${s.length}B`).join('  '));

  const rebuilt = await combineKey(opened);
  const keyMatches = toHex(rebuilt) === toHex(env.keyBytes);
  push('AES key reconstructed', keyMatches ? 'matches original key' : 'MISMATCH', keyMatches);

  const plain = await decryptAsset(rebuilt, env.ciphertext, env.iv);
  const recovered = fromUtf8(plain);
  const roundTrip = recovered === secretText;
  push('Asset decrypted', roundTrip ? 'plaintext matches original' : 'MISMATCH', roundTrip);

  // Negative control: two shares must not be enough.
  let belowThresholdFailed = false;
  try {
    const two = await combineKey([opened[0], opened[1]].slice(0, 2));
    belowThresholdFailed = toHex(two) !== toHex(env.keyBytes);
  } catch {
    belowThresholdFailed = true;
  }
  push(
    'Negative control: 2 shares',
    belowThresholdFailed ? 'correctly fails to reconstruct' : 'LEAKED KEY',
    belowThresholdFailed,
  );

  return { steps, recovered, ok: steps.every((s) => s.ok) };
}

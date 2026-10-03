// Encryption keys never leave the browser unencrypted. The private key is sealed with an AES-256-GCM key
// derived from the user's password via PBKDF2-SHA256 (600k iterations). Only the sealed blob is stored.
import { b64, unb64, generateKeypair, publicKeyOf } from "./crypto";

export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSWORD_LENGTH = 12;

export type KeyBlob = {
  v: 1;
  address: string;
  publicKey: string;
  kdf: { name: "PBKDF2-SHA256"; iterations: number; salt: string };
  cipher: { name: "AES-256-GCM"; iv: string; ct: string };
};

const bs = (b: Uint8Array) => b as unknown as BufferSource;
const blobKey = (address: string) => `heirloom:v1:key:${address.toLowerCase()}`;
const backupKey = (address: string) => `heirloom:v1:backup:${address.toLowerCase()}`;
const aad = (address: string, publicKey: string) => new TextEncoder().encode(`${address.toLowerCase()}|${publicKey.toLowerCase()}`);

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey("raw", bs(new TextEncoder().encode(password)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: bs(salt), iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function createKeyBlob(address: string, password: string) {
  const { secret, publicKey } = generateKeypair();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(iv), additionalData: bs(aad(address, publicKey)) }, key, bs(secret)));
  const blob: KeyBlob = {
    v: 1,
    address: address.toLowerCase(),
    publicKey: publicKey.toLowerCase(),
    kdf: { name: "PBKDF2-SHA256", iterations: PBKDF2_ITERATIONS, salt: b64(salt) },
    cipher: { name: "AES-256-GCM", iv: b64(iv), ct: b64(ct) },
  };
  return { blob, secret };
}

/** Throws if the password is wrong or the blob was tampered with. */
export async function unlockKeyBlob(blob: KeyBlob, password: string): Promise<Uint8Array> {
  const key = await deriveKey(password, unb64(blob.kdf.salt), blob.kdf.iterations);
  let secret: Uint8Array;
  try {
    secret = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: bs(unb64(blob.cipher.iv)), additionalData: bs(aad(blob.address, blob.publicKey)) }, key, bs(unb64(blob.cipher.ct)))
    );
  } catch {
    throw new Error("Wrong password");
  }
  if (publicKeyOf(secret).toLowerCase() !== blob.publicKey.toLowerCase()) throw new Error("Key file is corrupted");
  return secret;
}

export function parseKeyBlob(text: string): KeyBlob {
  let b: KeyBlob;
  try {
    b = JSON.parse(text);
  } catch {
    throw new Error("Not a valid recovery file");
  }
  const ok =
    b?.v === 1 && /^0x[0-9a-f]{40}$/i.test(b.address) && /^0x04[0-9a-f]{128}$/i.test(b.publicKey) &&
    b.kdf?.name === "PBKDF2-SHA256" && Number.isInteger(b.kdf.iterations) && b.kdf.iterations >= PBKDF2_ITERATIONS &&
    typeof b.kdf.salt === "string" && b.cipher?.name === "AES-256-GCM" && typeof b.cipher.iv === "string" && typeof b.cipher.ct === "string";
  if (!ok) throw new Error("Not a valid recovery file");
  return b;
}

export function loadStoredBlob(address: string): KeyBlob | null {
  try {
    const raw = localStorage.getItem(blobKey(address));
    return raw ? parseKeyBlob(raw) : null;
  } catch {
    return null;
  }
}
export const storeBlob = (blob: KeyBlob) => localStorage.setItem(blobKey(blob.address), JSON.stringify(blob));
export const hasBackedUp = (address: string) => localStorage.getItem(backupKey(address)) === "1";
export const markBackedUp = (address: string) => localStorage.setItem(backupKey(address), "1");
export const clearBackedUp = (address: string) => localStorage.removeItem(backupKey(address));

export function downloadRecoveryFile(blob: KeyBlob) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(blob, null, 2)], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: `heirloom-recovery-${blob.address.slice(0, 10)}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

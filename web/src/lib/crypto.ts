import { split, combine } from "shamir-secret-sharing";
import { PrivateKey, encrypt, decrypt } from "eciesjs";
import { bytesToHex, hexToBytes, type Hex } from "viem";

const bs = (b: Uint8Array) => b as unknown as BufferSource;
const u8 = (b: ArrayLike<number>) => Uint8Array.from(b);

export const toHex = (b: Uint8Array): Hex => bytesToHex(b);
export const fromHex = (h: string): Uint8Array => hexToBytes(h as Hex);

export function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bs(data)));
}

// ---- AES-256-GCM file encryption --------------------------------------------------------------

const SALT_LEN = 32;
const concat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

/**
 * Package = [u16 nameLen][name utf8][32-byte salt][content], all inside the AES-GCM ciphertext, so the filename and
 * salt stay off chain and server. The hash that goes on-chain is SHA-256(salt || content): salted, so a short or
 * guessable text (a one-line letter) cannot be confirmed by hashing guesses and comparing with the public hash.
 */
export async function encryptFile(file: File) {
  const data = new Uint8Array(await file.arrayBuffer());
  const name = new TextEncoder().encode(file.name);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const pkg = new Uint8Array(2 + name.length + SALT_LEN + data.length);
  new DataView(pkg.buffer).setUint16(0, name.length);
  pkg.set(name, 2);
  pkg.set(salt, 2 + name.length);
  pkg.set(data, 2 + name.length + SALT_LEN);

  const dek = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", bs(dek), "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(pkg)));
  const cipher = new Uint8Array(12 + ct.length);
  cipher.set(iv);
  cipher.set(ct, 12);
  return { cipher, dek, plaintextHash: toHex(await sha256(concat(salt, data))) };
}

export async function decryptFile(cipher: Uint8Array, dek: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", bs(dek), "AES-GCM", false, ["decrypt"]);
  const pkg = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bs(cipher.slice(0, 12)) }, key, bs(cipher.slice(12))));
  const nameLen = new DataView(pkg.buffer, pkg.byteOffset).getUint16(0);
  const salt = pkg.slice(2 + nameLen, 2 + nameLen + SALT_LEN);
  const data = pkg.slice(2 + nameLen + SALT_LEN);
  return { name: new TextDecoder().decode(pkg.slice(2, 2 + nameLen)), data, hash: toHex(await sha256(concat(salt, data))) };
}

// ---- Final letters: encrypted text, shown inline to the beneficiary after release ---------------

export const LETTER_SUFFIX = ".letter.txt";
export const MAX_LETTER_CHARS = 20_000;
export const isLetter = (name: string) => name.endsWith(LETTER_SUFFIX);
export const letterTitle = (name: string) => name.slice(0, -LETTER_SUFFIX.length) || "Final letter";

/** A letter travels exactly like a file (same encryption, shares and hash); only its name marks it as text. */
export function letterToFile(title: string, text: string): File {
  const safe = title.trim().replace(/[\\/]/g, "-").slice(0, 80) || "Final letter";
  return new File([text], `${safe}${LETTER_SUFFIX}`, { type: "text/plain" });
}

// ---- Shamir -----------------------------------------------------------------------------------

export const splitKey = (dek: Uint8Array, shares: number, threshold: number) => split(dek, shares, threshold);
export const combineShares = (shares: Uint8Array[]) => combine(shares);

// ---- ECIES (secp256k1) ------------------------------------------------------------------------

export function generateKeypair() {
  const sk = new PrivateKey();
  return { secret: u8(sk.secret), publicKey: toHex(sk.publicKey.toBytes(false)) };
}
export const publicKeyOf = (secret: Uint8Array): Hex => toHex(new PrivateKey(Buffer.from(secret)).publicKey.toBytes(false));
export const eciesEncrypt = (publicKey: string, data: Uint8Array) => u8(encrypt(publicKey.replace(/^0x/, ""), data));
export const eciesDecrypt = (secret: Uint8Array, data: Uint8Array) => u8(decrypt(toHex(secret).slice(2), data));

// ---- evidence container: AES-GCM ciphertext + the evidence key wrapped to each reviewer -------

export async function sealEvidence(file: File, recipients: { address: string; publicKey: string }[]) {
  const { cipher, dek, plaintextHash } = await encryptFile(file);
  const wraps: Record<string, string> = {};
  for (const r of recipients) wraps[r.address.toLowerCase()] = toHex(eciesEncrypt(r.publicKey, dek));
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, wraps, data: b64(cipher) }));
  return { bytes, plaintextHash };
}

export async function openEvidence(container: Uint8Array, address: string, secret: Uint8Array) {
  const parsed = JSON.parse(new TextDecoder().decode(container));
  const wrap = parsed?.wraps?.[address.toLowerCase()];
  if (parsed?.v !== 1 || typeof wrap !== "string" || typeof parsed.data !== "string") throw new Error("This evidence was not shared with your key");
  return decryptFile(unb64(parsed.data), eciesDecrypt(secret, fromHex(wrap)));
}

export function downloadBytes(name: string, data: Uint8Array) {
  const url = URL.createObjectURL(new Blob([data as unknown as BlobPart]));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

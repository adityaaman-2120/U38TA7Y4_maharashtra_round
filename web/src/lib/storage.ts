// Client side of ciphertext storage. Uploads go through /api/storage (server holds the Pinata JWT);
// downloads come straight from an IPFS gateway.
import { rt } from "@/i18n/runtime";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const GATEWAY = (process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? "https://gateway.pinata.cloud/ipfs").replace(/\/$/, "");
const CID_RE = /^[A-Za-z0-9]{10,128}$/;

export async function pinCiphertext(bytes: Uint8Array): Promise<string> {
  if (bytes.length > MAX_UPLOAD_BYTES) throw new Error(rt("Errors.uploadTooBig"));
  const res = await fetch("/api/storage", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: bytes as unknown as BodyInit,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.cid) throw new Error(body.error ?? rt("Errors.uploadFailed", { status: res.status }));
  return body.cid as string;
}

export async function fetchCiphertext(cid: string): Promise<Uint8Array> {
  if (!CID_RE.test(cid)) throw new Error(rt("Errors.invalidStorageId"));
  const res = await fetch(`${GATEWAY}/${cid}`);
  if (!res.ok) throw new Error(rt("Errors.downloadFailed", { status: res.status }));
  return new Uint8Array(await res.arrayBuffer());
}

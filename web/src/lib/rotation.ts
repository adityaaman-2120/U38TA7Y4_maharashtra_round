import { eciesEncrypt, splitKey, toHex } from "./crypto";

/**
 * Re-split a file's key (DEK) for a new guardian set. Each share is ECIES-encrypted to its guardian's registered key,
 * and the DEK is wrapped again to the owner's own key. Pure computation: nothing is sent anywhere.
 */
export async function reshareDek(dek: Uint8Array, guardianKeys: string[], threshold: number, ownerPublicKey: string) {
  const shares = await splitKey(dek, guardianKeys.length, threshold);
  return {
    encShares: shares.map((s, i) => toHex(eciesEncrypt(guardianKeys[i], s))),
    ownerWrapped: toHex(eciesEncrypt(ownerPublicKey, dek)),
  };
}

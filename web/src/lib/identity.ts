import { useCallback } from "react";
import type { Address } from "viem";
import { readers, useHeirloom, useRead, useTx } from "./hooks";
import { identityEnabled, zkDeployment } from "./zk/config";
import type { ZkProof } from "./zk/proof";

/** Whether each address has verified an identity on-chain. Nothing is revealed about who they are. */
export function useVerifiedMap(addresses: string[]) {
  const { chainId } = useHeirloom();
  const list = [...new Set(addresses.filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a)).map((a) => a.toLowerCase()))].sort();
  const q = useRead(["verified", ...list], async (c, k) => {
    const out: Record<string, boolean> = {};
    await Promise.all(list.map(async (a) => { out[a] = (await readers.nullifierOf(c, k, a as Address)) !== 0n; }));
    return out;
  }, { enabled: list.length > 0 && identityEnabled(chainId), interval: 8000 });
  return {
    enabled: identityEnabled(chainId),
    ready: q.data !== undefined,
    isVerified: (a: string) => q.data?.[a.toLowerCase()] ?? false,
  };
}

export function useMyIdentity() {
  const { address, chainId } = useHeirloom();
  const q = useRead(["myNullifier"], (c, k) => readers.nullifierOf(c, k, address!), { enabled: Boolean(address) && identityEnabled(chainId), interval: 8000 });
  return { enabled: identityEnabled(chainId), loading: q.isLoading, verified: (q.data ?? 0n) !== 0n, nullifier: q.data ?? 0n };
}

/** The seed and verifier this deployment was made with, which the proof must match. */
export function useZkDeployment() {
  const { chainId } = useHeirloom();
  return zkDeployment(chainId);
}

export function useVerifyIdentity() {
  const send = useTx();
  return useCallback((proof: ZkProof) => send("Verify identity", "verifyIdentity", [proof]), [send]);
}

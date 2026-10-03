"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useConnection, usePublicClient, useWalletClient } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address, PublicClient } from "viem";
import { config } from "./wagmi";
import { getDeployment, heirloomAbi, toAsset, toClaim, toVault, type Asset, type Claim, type Vault } from "./contract";
import { fetchEvents } from "./logs";
import { humanError } from "./errors";
import { useToasts } from "@/components/Toasts";

type ChainId = (typeof config.chains)[number]["id"];

export function useHeirloom() {
  const { address, chainId, isConnected } = useConnection();
  const supported = chainId !== undefined && config.chains.some((c) => c.id === chainId);
  const cid = supported ? (chainId as ChainId) : undefined;
  const publicClient = usePublicClient({ chainId: cid }) as PublicClient | undefined;
  const { data: walletClient } = useWalletClient({ chainId: cid });
  const deployment = getDeployment(cid);
  return { address, chainId, isConnected, supported, publicClient, walletClient, deployment };
}

/** Polling contract read. `fn` receives the client and deployment address. */
export function useRead<T>(key: unknown[], fn: (c: PublicClient, contract: Address) => Promise<T>, opts: { enabled?: boolean; interval?: number } = {}) {
  const { chainId, address, publicClient, deployment } = useHeirloom();
  return useQuery({
    queryKey: ["heirloom", chainId, address, ...key],
    queryFn: () => fn(publicClient!, deployment!.address),
    enabled: Boolean(publicClient && deployment) && (opts.enabled ?? true),
    refetchInterval: opts.interval ?? 5000,
  });
}

// ---- chain clock ------------------------------------------------------------------------------

const ClockCtx = createContext<number>(Math.floor(Date.now() / 1000));
export const useNow = () => useContext(ClockCtx);

export function ChainClockProvider({ children }: { children: ReactNode }) {
  const { publicClient, chainId } = useHeirloom();
  const q = useQuery({
    queryKey: ["chain-time", chainId],
    enabled: Boolean(publicClient),
    refetchInterval: 4000,
    queryFn: async () => {
      // A local node can drift from wall-clock time; ask it for the timestamp the next block will get.
      const block = chainId === 31337
        ? await (publicClient as unknown as { request: (a: unknown) => Promise<{ timestamp: string }> }).request({ method: "eth_getBlockByNumber", params: ["pending", false] })
        : null;
      const ts = block ? parseInt(block.timestamp, 16) : Number((await publicClient!.getBlock()).timestamp);
      return { ts, at: Date.now() };
    },
  });
  const [wall, setWall] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setWall(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const now = Math.floor(q.data ? q.data.ts + Math.max(0, wall - q.data.at) / 1000 : wall / 1000);
  return <ClockCtx.Provider value={now}>{children}</ClockCtx.Provider>;
}

// ---- transactions -----------------------------------------------------------------------------

export function useTx() {
  const { address, chainId, publicClient, walletClient, deployment } = useHeirloom();
  const toast = useToasts();
  const qc = useQueryClient();
  return useCallback(
    async (label: string, functionName: string, args: unknown[] = []): Promise<boolean> => {
      if (!publicClient || !walletClient || !deployment || !address) {
        toast.push({ kind: "error", message: "Connect a wallet on a supported network first." });
        return false;
      }
      const id = toast.push({ kind: "pending", message: `${label}: confirm in your wallet…` });
      try {
        const { request } = await publicClient.simulateContract({ account: address, address: deployment.address, abi: heirloomAbi, functionName, args } as never);
        const hash = await walletClient.writeContract(request as never);
        toast.update(id, { message: `${label}: waiting for confirmation…`, hash, chainId });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Transaction reverted");
        toast.update(id, { kind: "success", message: `${label}: confirmed` });
        await qc.invalidateQueries({ queryKey: ["heirloom"] });
        return true;
      } catch (e) {
        toast.update(id, { kind: "error", message: `${label}: ${humanError(e)}` });
        return false;
      }
    },
    [address, chainId, publicClient, walletClient, deployment, toast, qc]
  );
}

// ---- loaders ----------------------------------------------------------------------------------

type C = PublicClient;
const read = (c: C, contract: Address, functionName: string, args: unknown[] = []) =>
  c.readContract({ address: contract, abi: heirloomAbi, functionName, args } as never) as Promise<unknown>;

export const readers = {
  vault: async (c: C, k: Address, owner: Address): Promise<Vault> => toVault(await read(c, k, "getVault", [owner])),
  asset: async (c: C, k: Address, id: number): Promise<Asset> => toAsset(id, await read(c, k, "getAsset", [BigInt(id)])),
  claim: async (c: C, k: Address, id: number): Promise<Claim> => toClaim(id, await read(c, k, "getClaim", [BigInt(id)])),
  ids: async (c: C, k: Address, fn: string, who: Address): Promise<number[]> => ((await read(c, k, fn, [who])) as bigint[]).map(Number),
  hasVault: async (c: C, k: Address, who: Address) => (await read(c, k, "hasVault", [who])) as boolean,
  encryptionKey: async (c: C, k: Address, who: Address) => (await read(c, k, "getEncryptionKey", [who])) as `0x${string}`,
};

export type ClaimBundle = {
  claim: Claim;
  asset: Asset;
  vault: Vault;
  invalidated: boolean;
  response: { attestation: number; flagged: boolean };
  released: `0x${string}`[];
};

export async function loadClaimBundle(c: C, k: Address, id: number, me: Address): Promise<ClaimBundle> {
  const claim = await readers.claim(c, k, id);
  const [asset, invalidated, resp, released] = await Promise.all([
    readers.asset(c, k, claim.assetId),
    read(c, k, "isClaimInvalidated", [BigInt(id)]) as Promise<boolean>,
    read(c, k, "getResponse", [BigInt(id), me]) as Promise<readonly [number, boolean]>,
    read(c, k, "getReleasedShares", [BigInt(id)]) as Promise<`0x${string}`[]>,
  ]);
  const vault = await readers.vault(c, k, asset.owner);
  return { claim, asset, vault, invalidated, response: { attestation: Number(resp[0]), flagged: resp[1] }, released: [...released] };
}

export function claimState(b: ClaimBundle): { label: string; open: boolean; tone: "good" | "bad" | "warn" | "info" } {
  const s = b.claim.status;
  if (s === 3) return { label: "Finalized", open: false, tone: "good" };
  if (s === 2) return { label: "Cancelled by owner", open: false, tone: "bad" };
  if (s === 4) return { label: "Rejected by guardians", open: false, tone: "bad" };
  if (b.claim.flagged) return { label: "Flagged as fraud", open: false, tone: "bad" };
  if (b.invalidated) return { label: "Invalidated by owner check-in", open: false, tone: "bad" };
  if (b.vault.frozen) return { label: "Open (vault frozen)", open: true, tone: "warn" };
  return { label: "Open", open: true, tone: "info" };
}

export function useEvents() {
  const { chainId, publicClient, deployment } = useHeirloom();
  return useQuery({
    queryKey: ["heirloom", chainId, "events"],
    enabled: Boolean(publicClient && deployment),
    refetchInterval: 6000,
    queryFn: () => fetchEvents(publicClient!, chainId!, deployment!.address, deployment!.startBlock),
  });
}

// ---- roles ------------------------------------------------------------------------------------

export function useRoles() {
  const { address } = useHeirloom();
  const owner = useRead(["hasVault"], (c, k) => readers.hasVault(c, k, address!), { enabled: Boolean(address) });
  const assetsB = useRead(["benAssets"], (c, k) => readers.ids(c, k, "assetsByBeneficiary", address!), { enabled: Boolean(address) });
  const claimsG = useRead(["guardianClaims"], (c, k) => readers.ids(c, k, "claimsByGuardian", address!), { enabled: Boolean(address) });
  const events = useEvents();

  return useMemo(() => {
    const me = address?.toLowerCase();
    const sets = new Map<string, string[]>();
    for (const e of events.data ?? []) {
      if (e.eventName === "VaultCreated" || e.eventName === "GuardiansRotated")
        sets.set(String(e.args.owner).toLowerCase(), (e.args.guardians as string[]).map((g) => g.toLowerCase()));
    }
    const guardsVaults = [...sets.entries()].filter(([, g]) => me && g.includes(me)).map(([o]) => o);
    return {
      isOwner: owner.data === true,
      isBeneficiary: (assetsB.data?.length ?? 0) > 0,
      isGuardian: guardsVaults.length > 0 || (claimsG.data?.length ?? 0) > 0,
      loading: owner.isLoading || assetsB.isLoading || claimsG.isLoading || events.isLoading,
    };
  }, [address, owner.data, assetsB.data, claimsG.data, events.data, owner.isLoading, assetsB.isLoading, claimsG.isLoading, events.isLoading]);
}

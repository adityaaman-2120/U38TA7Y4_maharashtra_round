import type { Address } from "viem";
import { heirloomAbi, heirloomDeployments } from "./contracts";

export { heirloomAbi };

export type Deployment = {
  address: Address;
  startBlock: number;
  /** The Anon Aadhaar verifier this Heirloom was deployed with (zero address when identity is disabled). */
  anonAadhaar?: Address;
  anonAadhaarMode?: string;
  nullifierSeed?: string;
};

export function getDeployment(chainId: number | undefined): Deployment | null {
  if (chainId === undefined) return null;
  const d = (heirloomDeployments as unknown as Record<number, { address: string; startBlock: number; anonAadhaar?: string; anonAadhaarMode?: string; nullifierSeed?: string }>)[chainId];
  return d
    ? { address: d.address as Address, startBlock: d.startBlock, anonAadhaar: d.anonAadhaar as Address | undefined, anonAadhaarMode: d.anonAadhaarMode, nullifierSeed: d.nullifierSeed }
    : null;
}

export const EVIDENCE_TYPES = ["Death", "Incapacity", "Any"] as const;
export const CLAIM_STATUS = ["None", "Raised", "Cancelled", "Finalized", "Rejected"] as const;

export type Policy = {
  requiredApprovals: number;
  challengePeriod: number;
  minInactivity: number;
  unlockAfter: number;
  evidenceType: number;
  attestationDeadline: number;
  requireBeneficiaryZK: boolean;
  requireAge18: boolean;
};

export type Vault = {
  owner: Address;
  threshold: number;
  frozen: boolean;
  heartbeatInterval: number;
  lastHeartbeat: number;
  epoch: number;
  requireVerifiedGuardians: boolean;
  guardians: Address[];
};

export type Asset = {
  id: number;
  owner: Address;
  beneficiary: Address;
  storageId: string;
  contentHash: `0x${string}`;
  encShares: `0x${string}`[];
  ownerWrappedKey: `0x${string}`;
  policy: Policy;
  sharesEpoch: number;
  activeClaim: number;
  released: boolean;
  kind: "data" | "crypto";
  /** Crypto only: address(0) is the chain's native currency. */
  token: Address;
  /** Crypto only: what is locked in the asset. */
  balance: bigint;
};

export const NATIVE: Address = "0x0000000000000000000000000000000000000000";
export const isCrypto = (a: Pick<Asset, "kind">) => a.kind === "crypto";

export type Claim = {
  id: number;
  assetId: number;
  claimant: Address;
  raisedAt: number;
  evidenceType: number;
  evidenceHash: `0x${string}`;
  evidenceStorageId: string;
  approvals: number;
  rejections: number;
  status: number;
  flagged: boolean;
  guardians: Address[];
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export const toPolicy = (p: any): Policy => ({
  requiredApprovals: Number(p.requiredApprovals),
  challengePeriod: Number(p.challengePeriod),
  minInactivity: Number(p.minInactivity),
  unlockAfter: Number(p.unlockAfter),
  evidenceType: Number(p.evidenceType),
  attestationDeadline: Number(p.attestationDeadline),
  requireBeneficiaryZK: Boolean(p.requireBeneficiaryZK),
  requireAge18: Boolean(p.requireAge18),
});

export const toVault = (v: any): Vault => ({
  owner: v.owner,
  threshold: Number(v.threshold),
  frozen: v.frozen,
  heartbeatInterval: Number(v.heartbeatInterval),
  lastHeartbeat: Number(v.lastHeartbeat),
  epoch: Number(v.epoch),
  requireVerifiedGuardians: Boolean(v.requireVerifiedGuardians),
  guardians: [...v.guardians],
});

export const toAsset = (id: number, a: any): Asset => ({
  id,
  owner: a.owner,
  beneficiary: a.beneficiary,
  storageId: a.storageId,
  contentHash: a.contentHash,
  encShares: [...a.encShares],
  ownerWrappedKey: a.ownerWrappedKey,
  policy: toPolicy(a.policy),
  sharesEpoch: Number(a.sharesEpoch),
  activeClaim: Number(a.activeClaim),
  released: a.released,
  kind: Number(a.kind) === 1 ? "crypto" : "data",
  token: a.token,
  balance: BigInt(a.balance),
});

export const toClaim = (id: number, c: any): Claim => ({
  id,
  assetId: Number(c.assetId),
  claimant: c.claimant,
  raisedAt: Number(c.raisedAt),
  evidenceType: Number(c.evidenceType),
  evidenceHash: c.evidenceHash,
  evidenceStorageId: c.evidenceStorageId,
  approvals: Number(c.approvals),
  rejections: Number(c.rejections),
  status: Number(c.status),
  flagged: c.flagged,
  guardians: [...c.guardians],
});

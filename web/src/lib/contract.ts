import type { Address } from "viem";
import { heirloomAbi, heirloomDeployments } from "./contracts";

export { heirloomAbi };

export function getDeployment(chainId: number | undefined): { address: Address; startBlock: number } | null {
  if (chainId === undefined) return null;
  const d = (heirloomDeployments as Record<number, { address: string; startBlock: number }>)[chainId];
  return d ? { address: d.address as Address, startBlock: d.startBlock } : null;
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
};

export type Vault = {
  owner: Address;
  threshold: number;
  frozen: boolean;
  heartbeatInterval: number;
  lastHeartbeat: number;
  epoch: number;
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
};

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
});

export const toVault = (v: any): Vault => ({
  owner: v.owner,
  threshold: Number(v.threshold),
  frozen: v.frozen,
  heartbeatInterval: Number(v.heartbeatInterval),
  lastHeartbeat: Number(v.lastHeartbeat),
  epoch: Number(v.epoch),
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

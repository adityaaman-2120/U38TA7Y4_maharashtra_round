import { EVIDENCE_TYPES } from "./contract";
import { shortAddr, shortHash } from "./format";
import type { HeirloomEvent } from "./logs";

type Tone = "good" | "bad" | "warn" | "info";

export const EVENT_LABELS: Record<string, { label: string; tone: Tone }> = {
  EncryptionKeyRegistered: { label: "Key registered", tone: "info" },
  VaultCreated: { label: "Vault created", tone: "good" },
  GuardiansRotated: { label: "Guardians rotated", tone: "warn" },
  Heartbeat: { label: "Owner check-in", tone: "good" },
  PanicFrozen: { label: "Vault frozen", tone: "bad" },
  VaultUnfrozen: { label: "Vault unfrozen", tone: "warn" },
  AssetAdded: { label: "Asset reserved", tone: "info" },
  AssetSharesUpdated: { label: "Asset re-shared", tone: "info" },
  ClaimRaised: { label: "Claim raised", tone: "warn" },
  Attested: { label: "Guardian approved", tone: "good" },
  ClaimRejectedByGuardian: { label: "Guardian rejected", tone: "bad" },
  ClaimRejected: { label: "Claim rejected", tone: "bad" },
  FraudFlagged: { label: "Fraud flagged", tone: "bad" },
  ClaimCancelled: { label: "Claim cancelled", tone: "bad" },
  ClaimFinalized: { label: "Claim finalized", tone: "good" },
  ShareReleased: { label: "Share released", tone: "info" },
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const num = (v: unknown) => (v === undefined ? undefined : Number(v));

/** claimId -> assetId, learned from ClaimRaised events (other claim events don't carry the asset). */
export function claimAssetMap(events: HeirloomEvent[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const e of events) if (e.eventName === "ClaimRaised") m.set(Number(e.args.claimId), Number(e.args.assetId));
  return m;
}

export function refsOf(e: HeirloomEvent, claimToAsset: Map<number, number>) {
  const claimId = num(e.args.claimId);
  const assetId = num(e.args.assetId) ?? (claimId !== undefined ? claimToAsset.get(claimId) : undefined);
  return { claimId, assetId };
}

/** Every address mentioned in the event's arguments (flat and inside address arrays). */
export function addressesOf(e: HeirloomEvent): string[] {
  const out: string[] = [];
  for (const v of Object.values(e.args)) {
    if (typeof v === "string" && ADDRESS_RE.test(v)) out.push(v.toLowerCase());
    if (Array.isArray(v)) for (const x of v) if (typeof x === "string" && ADDRESS_RE.test(x)) out.push(x.toLowerCase());
  }
  return out;
}

export type Formatters = { addr: (a: string) => string; hash: (h: string, n?: number) => string };
const SHORT: Formatters = { addr: shortAddr, hash: shortHash };

export function summarize(e: HeirloomEvent, me?: string, fmt: Formatters = SHORT): string {
  const a = e.args;
  const who = (v: unknown) => {
    const s = String(v);
    return me && s.toLowerCase() === me.toLowerCase() ? "you" : fmt.addr(s);
  };
  switch (e.eventName) {
    case "EncryptionKeyRegistered": return `${who(a.account)} registered an encryption key`;
    case "VaultCreated": return `${who(a.owner)} created a vault with ${(a.guardians as unknown[]).length} guardians (threshold ${a.threshold}, check-in every ${Math.round(Number(a.heartbeatInterval) / 60)} min)`;
    case "GuardiansRotated": return `${who(a.owner)} replaced the guardians (${(a.guardians as unknown[]).length} guardians, threshold ${a.threshold}); files must be re-shared`;
    case "Heartbeat": return `${who(a.owner)} checked in — any open claim is now invalid`;
    case "PanicFrozen": return `${who(a.owner)} froze the vault`;
    case "VaultUnfrozen": return `${who(a.owner)} unfroze the vault`;
    case "AssetAdded": return `Asset #${a.assetId} reserved by ${who(a.owner)} for ${who(a.beneficiary)} (ciphertext ${fmt.hash(String(a.storageId), 5)})`;
    case "AssetSharesUpdated": return `${who(a.owner)} re-shared asset #${a.assetId} to the current guardians`;
    case "ClaimRaised": return `${who(a.claimant)} raised claim #${a.claimId} on asset #${a.assetId} (${EVIDENCE_TYPES[Number(a.evidenceType)]} evidence, hash ${fmt.hash(String(a.evidenceHash), 4)})`;
    case "Attested": return `${who(a.guardian)} approved claim #${a.claimId} (${a.approvals} approval${Number(a.approvals) === 1 ? "" : "s"} so far)`;
    case "ClaimRejectedByGuardian": return `${who(a.guardian)} rejected claim #${a.claimId} (reason hash ${fmt.hash(String(a.reasonHash), 4)})`;
    case "ClaimRejected": return `Claim #${a.claimId} can no longer reach the guardian threshold and was closed`;
    case "FraudFlagged": return `${who(a.guardian)} flagged claim #${a.claimId} as fraud — it can no longer be finalized`;
    case "ClaimCancelled": return `${who(a.owner)} cancelled claim #${a.claimId}`;
    case "ClaimFinalized": return `Claim #${a.claimId} was finalized by ${who(a.by)}; guardians can now release shares`;
    case "ShareReleased": return `${who(a.guardian)} released their share for claim #${a.claimId} (guardian ${Number(a.guardianIndex) + 1})`;
    default: return e.eventName;
  }
}

import { rt, type Translator } from "@/i18n/runtime";
import { EVIDENCE_TYPES } from "./contract";
import { shortAddr, shortHash } from "./format";
import type { HeirloomEvent } from "./logs";

type Tone = "good" | "bad" | "warn" | "info";

export const EVENT_TONES: Record<string, Tone> = {
  EncryptionKeyRegistered: "info",
  IdentityVerified: "good",
  VaultCreated: "good",
  GuardiansRotated: "warn",
  Heartbeat: "good",
  PanicFrozen: "bad",
  VaultUnfrozen: "warn",
  AssetAdded: "info",
  AssetSharesUpdated: "info",
  ClaimRaised: "warn",
  Attested: "good",
  ClaimRejectedByGuardian: "bad",
  ClaimRejected: "bad",
  FraudFlagged: "bad",
  ClaimCancelled: "bad",
  ClaimFinalized: "good",
  ShareReleased: "info",
  CryptoDeposited: "info",
  CryptoWithdrawn: "warn",
  CryptoClaimed: "good",
};

/** The event's display name in the active language (or `tr`'s, for output that is always English). Unknown events show their raw name. */
export const eventLabel = (name: string, tr: Translator = rt) => (name in EVENT_TONES ? tr(`Events.label.${name}`) : name);
export const eventTone = (name: string): Tone => EVENT_TONES[name] ?? "info";

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

export function summarize(e: HeirloomEvent, me?: string, fmt: Formatters = SHORT, tr: Translator = rt): string {
  const a = e.args;
  const who = (v: unknown) => {
    const s = String(v);
    return me && s.toLowerCase() === me.toLowerCase() ? tr("Events.you") : fmt.addr(s);
  };
  // Token symbols are not in the event; show the raw token address (or the native currency) with the amount in base units.
  const money = (amount: unknown, token: unknown) =>
    /^0x0{40}$/i.test(String(token)) ? tr("Events.moneyNative", { amount: String(amount) }) : tr("Events.moneyToken", { amount: String(amount), token: fmt.addr(String(token)) });
  const text = (key: string, values: Record<string, string | number> = {}) => tr(`Events.summary.${key}`, values);
  switch (e.eventName) {
    case "IdentityVerified": return text("IdentityVerified", { who: who(a.account), pseudonym: fmt.hash(String("0x" + BigInt(String(a.nullifier)).toString(16)), 4) });
    case "EncryptionKeyRegistered": return text("EncryptionKeyRegistered", { who: who(a.account) });
    case "VaultCreated": return text("VaultCreated", { who: who(a.owner), guardians: (a.guardians as unknown[]).length, threshold: String(a.threshold), minutes: Math.round(Number(a.heartbeatInterval) / 60) });
    case "GuardiansRotated": return text("GuardiansRotated", { who: who(a.owner), guardians: (a.guardians as unknown[]).length, threshold: String(a.threshold) });
    case "Heartbeat": return text("Heartbeat", { who: who(a.owner) });
    case "PanicFrozen": return text("PanicFrozen", { who: who(a.owner) });
    case "VaultUnfrozen": return text("VaultUnfrozen", { who: who(a.owner) });
    case "AssetAdded": return text("AssetAdded", { assetId: String(a.assetId), owner: who(a.owner), beneficiary: who(a.beneficiary), storage: fmt.hash(String(a.storageId), 5) });
    case "AssetSharesUpdated": return text("AssetSharesUpdated", { who: who(a.owner), assetId: String(a.assetId) });
    case "ClaimRaised": return text("ClaimRaised", { who: who(a.claimant), claimId: String(a.claimId), assetId: String(a.assetId), evidence: tr(`Evidence.type.${EVIDENCE_TYPES[Number(a.evidenceType)]}`), hash: fmt.hash(String(a.evidenceHash), 4) });
    case "Attested": return text("Attested", { who: who(a.guardian), claimId: String(a.claimId), approvals: Number(a.approvals) });
    case "ClaimRejectedByGuardian": return text("ClaimRejectedByGuardian", { who: who(a.guardian), claimId: String(a.claimId), hash: fmt.hash(String(a.reasonHash), 4) });
    case "ClaimRejected": return text("ClaimRejected", { claimId: String(a.claimId) });
    case "FraudFlagged": return text("FraudFlagged", { who: who(a.guardian), claimId: String(a.claimId) });
    case "ClaimCancelled": return text("ClaimCancelled", { who: who(a.owner), claimId: String(a.claimId) });
    case "ClaimFinalized": return text("ClaimFinalized", { who: who(a.by), claimId: String(a.claimId) });
    case "ShareReleased": return text("ShareReleased", { who: who(a.guardian), claimId: String(a.claimId), index: Number(a.guardianIndex) + 1 });
    case "CryptoDeposited": return text("CryptoDeposited", { amount: money(a.amount, a.token), assetId: String(a.assetId), balance: money(a.balance, a.token) });
    case "CryptoWithdrawn": return text("CryptoWithdrawn", { who: who(a.to), amount: money(a.amount, a.token), assetId: String(a.assetId), balance: money(a.balance, a.token) });
    case "CryptoClaimed": return text("CryptoClaimed", { who: who(a.beneficiary), amount: money(a.amount, a.token), assetId: String(a.assetId) });
    default: return e.eventName;
  }
}

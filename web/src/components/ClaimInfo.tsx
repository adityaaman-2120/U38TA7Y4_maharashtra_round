"use client";
import { useState, type ReactNode } from "react";
import { EVIDENCE_TYPES } from "@/lib/contract";
import { claimState, useHeirloom, useNow, type ClaimBundle } from "@/lib/hooks";
import { fetchCiphertext } from "@/lib/storage";
import { downloadBytes, openEvidence } from "@/lib/crypto";
import { fmtDuration, fmtTime, shortAddr } from "@/lib/format";
import { Badge, Btn, Mono } from "./ui";
import { useKey } from "./KeyProvider";

export function EvidenceViewer({ bundle }: { bundle: ClaimBundle }) {
  const { address } = useHeirloom();
  const key = useKey();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setBusy(true);
    setResult(null);
    try {
      const container = await fetchCiphertext(bundle.claim.evidenceStorageId);
      const { name, data, hash } = await openEvidence(container, address!, key.getSecret());
      if (hash.toLowerCase() !== bundle.claim.evidenceHash.toLowerCase()) throw new Error("Evidence does not match the hash recorded on-chain");
      downloadBytes(name, data);
      setResult({ ok: true, text: `Evidence "${name}" decrypted; hash matches the on-chain record.` });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <Btn tone="ghost" disabled={busy} onClick={open} data-testid="view-evidence">{busy ? "Decrypting…" : "View evidence"}</Btn>
      {result && <p className={`text-xs ${result.ok ? "text-emerald-400" : "text-red-400"}`}>{result.text}</p>}
    </div>
  );
}

/** Read-only summary of a claim with live countdowns; actions are passed as children. */
export function ClaimInfo({ bundle, evidence = false, children }: { bundle: ClaimBundle; evidence?: boolean; children?: ReactNode }) {
  const now = useNow();
  const { claim, asset, vault } = bundle;
  const st = claimState(bundle);
  const p = asset.policy;
  const challengeEnds = claim.raisedAt + p.challengePeriod;
  const deadline = claim.raisedAt + p.attestationDeadline;
  const required = now >= deadline ? vault.threshold : p.requiredApprovals;

  return (
    <div className="space-y-2 rounded-lg border border-slate-700 p-3 text-sm text-slate-300" data-testid={`claim-${claim.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <b>Claim #{claim.id}</b> on asset #{asset.id}
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <p className="text-xs text-slate-400">
        Raised {fmtTime(claim.raisedAt)} by {shortAddr(claim.claimant)} · evidence: {EVIDENCE_TYPES[claim.evidenceType]} · approvals {claim.approvals}/{required}
        {claim.status === 1 && now < deadline && p.requiredApprovals !== vault.threshold && ` (drops to ${vault.threshold} in ${fmtDuration(deadline - now)} if guardians stay silent)`}
      </p>
      {st.open && (
        <p className="text-xs text-slate-400">
          Challenge period {now >= challengeEnds ? "over" : `ends in ${fmtDuration(challengeEnds - now)}`}
          {p.unlockAfter > now && ` · time lock opens in ${fmtDuration(p.unlockAfter - now)}`}
        </p>
      )}
      <Mono>owner {asset.owner}</Mono>
      <div className="flex flex-wrap items-center gap-2">
        {evidence && <EvidenceViewer bundle={bundle} />}
        {children}
      </div>
    </div>
  );
}

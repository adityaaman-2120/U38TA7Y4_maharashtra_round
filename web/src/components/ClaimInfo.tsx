"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { evidenceLabel } from "@/lib/contract";
import { claimState, useHeirloom, useNow, type ClaimBundle } from "@/lib/hooks";
import { fetchCiphertext } from "@/lib/storage";
import { downloadBytes, openEvidence } from "@/lib/crypto";
import { fmtDuration, fmtTime, shortAddr } from "@/lib/format";
import { Badge, Btn, Mono } from "./ui";
import { useKey } from "./KeyProvider";

const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const TEXT_EXT = ["txt", "md", "json", "csv", "log"];
const MAX_TEXT_PREVIEW = 20_000;

type Preview = { name: string; data: Uint8Array; kind: "image" | "pdf" | "text" | "none"; url?: string; text?: string };

function buildPreview(name: string, data: Uint8Array): Preview {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  // SVG and HTML can carry scripts, so they are never rendered; they fall through to "none" (download only).
  if (IMAGE_MIME[ext]) return { name, data, kind: "image", url: URL.createObjectURL(new Blob([data as unknown as BlobPart], { type: IMAGE_MIME[ext] })) };
  if (ext === "pdf") return { name, data, kind: "pdf", url: URL.createObjectURL(new Blob([data as unknown as BlobPart], { type: "application/pdf" })) };
  if (TEXT_EXT.includes(ext)) return { name, data, kind: "text", text: new TextDecoder().decode(data.slice(0, MAX_TEXT_PREVIEW)) };
  return { name, data, kind: "none" };
}

/** Decrypts the claim's evidence with the viewer's key, checks it against the on-chain hash and previews it. */
export function EvidenceViewer({ bundle, onReviewed }: { bundle: ClaimBundle; onReviewed?: () => void }) {
  const t = useTranslations("ClaimInfo");
  const { address } = useHeirloom();
  const key = useKey();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const urlRef = useRef<string | undefined>(undefined);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const close = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = undefined;
    setPreview(null);
  };

  const open = async () => {
    setBusy(true);
    setError("");
    try {
      const container = await fetchCiphertext(bundle.claim.evidenceStorageId);
      const { name, data, hash } = await openEvidence(container, address!, key.getSecret());
      if (hash.toLowerCase() !== bundle.claim.evidenceHash.toLowerCase()) throw new Error(t("hashMismatch"));
      close();
      const next = buildPreview(name, data);
      urlRef.current = next.url;
      setPreview(next);
      onReviewed?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Btn tone="ghost" disabled={busy} onClick={open} data-testid="view-evidence">{busy ? t("decrypting") : preview ? t("reload") : t("review")}</Btn>
        {preview && <Btn tone="ghost" onClick={close}>{t("hide")}</Btn>}
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
      {preview && (
        <div className="space-y-2 rounded-lg border border-line bg-sunken p-3" data-testid="evidence-preview">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-ink-2">{t("fileInfo", { name: preview.name, bytes: preview.data.length })}</span>
            <span className="text-ok">{t("verified")}</span>
          </div>
          {preview.kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.url} alt={preview.name} className="max-h-96 w-auto max-w-full rounded" />
          )}
          {preview.kind === "pdf" && <iframe src={preview.url} title={preview.name} className="h-96 w-full rounded bg-white" />}
          {preview.kind === "text" && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs text-ink">{preview.text}</pre>}
          {preview.kind === "none" && <p className="text-xs text-muted">{t("noPreview")}</p>}
          <Btn tone="ghost" onClick={() => downloadBytes(preview.name, preview.data)}>{t("download")}</Btn>
        </div>
      )}
    </div>
  );
}

/** Read-only summary of a claim with live countdowns; actions are passed as children. */
export function ClaimInfo({ bundle, evidence = false, onReviewed, children }: { bundle: ClaimBundle; evidence?: boolean; onReviewed?: () => void; children?: ReactNode }) {
  const t = useTranslations("ClaimInfo");
  const now = useNow();
  const { claim, asset, vault } = bundle;
  const st = claimState(bundle);
  const p = asset.policy;
  const challengeEnds = claim.raisedAt + p.challengePeriod;
  const deadline = claim.raisedAt + p.attestationDeadline;
  const required = now >= deadline ? vault.threshold : p.requiredApprovals;

  return (
    <div className="space-y-2 rounded-lg border border-line p-3 text-sm text-ink-2" data-testid={`claim-${claim.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        {t.rich("title", { claim: claim.id, asset: asset.id, b: (c) => <b>{c}</b> })}
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <p className="text-xs text-muted">
        {t("raised", { time: fmtTime(claim.raisedAt), who: shortAddr(claim.claimant), evidence: evidenceLabel(claim.evidenceType), approvals: claim.approvals, required })}
        {claim.status === 1 && now < deadline && p.requiredApprovals !== vault.threshold && ` ${t("dropsTo", { threshold: vault.threshold, duration: fmtDuration(deadline - now) })}`}
      </p>
      {st.open && (
        <p className="text-xs text-muted">
          {now >= challengeEnds ? t("challengeOver") : t("challengeEnds", { duration: fmtDuration(challengeEnds - now) })}
          {p.unlockAfter > now && ` · ${t("timeLock", { duration: fmtDuration(p.unlockAfter - now) })}`}
        </p>
      )}
      <Mono>{t("owner", { address: asset.owner })}</Mono>
      <div className="flex flex-wrap items-center gap-2">
        {evidence && <EvidenceViewer bundle={bundle} onReviewed={onReviewed} />}
        {children}
      </div>
    </div>
  );
}

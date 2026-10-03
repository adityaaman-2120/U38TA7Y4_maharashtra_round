"use client";
import { useTranslations } from "next-intl";

/** Shown next to people who proved, in zero knowledge, that they are one real Aadhaar holder. */
export function VerifiedBadge({ verified, compact = false }: { verified: boolean; compact?: boolean }) {
  const t = useTranslations("Verified");
  if (!verified) {
    return compact ? null : <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-faint" title={t("notVerifiedHint")}>{t("notVerified")}</span>;
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-medium text-ok"
      title={t("verifiedHint")}
      data-testid="verified-badge"
    >
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M2.5 6.2 5 8.6l4.5-5" /></svg>
      {t("verified")}
    </span>
  );
}

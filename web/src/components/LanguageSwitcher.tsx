"use client";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, LOCALE_NAMES, isLocale, locales } from "@/i18n/config";

/** Picks the interface language. The choice is a cookie, so it persists; a refresh re-renders everything in the new language. */
export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const t = useTranslations("Language");
  const locale = useLocale();
  const router = useRouter();

  const change = (next: string) => {
    if (!isLocale(next)) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };

  return (
    <label className={`inline-flex items-center gap-1.5 text-sm text-ink-2 ${className}`}>
      <span className="sr-only">{t("label")}</span>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" />
      </svg>
      <select value={locale} onChange={(e) => change(e.target.value)} data-testid="language" aria-label={t("label")}
        className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-sm text-ink focus:border-accent">
        {locales.map((l) => <option key={l} value={l} lang={l}>{LOCALE_NAMES[l]}</option>)}
      </select>
    </label>
  );
}

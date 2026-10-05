"use client";
import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { getWaking, subscribeWaking } from "@/lib/api";

/** Free hosting puts the backend to sleep when it is idle; its first request can take a minute. After 5 seconds of waiting, say so. */
export function ServerWaking() {
  const t = useTranslations("Waking");
  const waking = useSyncExternalStore(subscribeWaking, getWaking, () => false);
  if (!waking) return null;
  return (
    <div role="status" aria-live="polite" data-testid="server-waking" className="fixed inset-x-0 top-0 z-[60] flex justify-center px-4 pt-3">
      <div className="flex max-w-xl items-start gap-3 rounded-2xl border border-brass/30 bg-brass-soft px-4 py-3 text-sm text-ink shadow-[0_12px_32px_-12px_rgba(21,24,29,0.35)]">
        <span className="mt-1 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-brass" aria-hidden />
        <p><b className="font-semibold">{t("title")}</b> {t("body")}</p>
      </div>
    </div>
  );
}

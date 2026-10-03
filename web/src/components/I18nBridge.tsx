"use client";
import { useLocale, useTranslations } from "next-intl";
import { setRuntime } from "@/i18n/runtime";

/** Gives non-component code (error messages, audit text) the active translator. Renders before its children, so it is always current. */
export function I18nBridge() {
  const t = useTranslations();
  const locale = useLocale();
  setRuntime(t as unknown as Parameters<typeof setRuntime>[0], locale);
  return null;
}

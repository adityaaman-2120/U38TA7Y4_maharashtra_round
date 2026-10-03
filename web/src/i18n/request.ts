import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { fromAcceptLanguage, isLocale, LOCALE_COOKIE, type Locale } from "./config";

async function loadMessages(locale: Locale) {
  switch (locale) {
    case "hi": return (await import("../messages/hi")).default;
    case "bn": return (await import("../messages/bn")).default;
    default: return (await import("../messages/en")).default;
  }
}

export default getRequestConfig(async () => {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(saved) ? saved : fromAcceptLanguage((await headers()).get("accept-language"));
  return { locale, messages: await loadMessages(locale) };
});

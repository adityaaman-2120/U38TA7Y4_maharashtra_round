export const locales = ["en", "hi", "bn"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
/** The visitor's choice lives in this cookie (a year), so it survives reloads, sign-outs and new tabs. */
export const LOCALE_COOKIE = "NEXT_LOCALE";
/** Each language is named in itself, so it can be found by someone who cannot read the current one. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", hi: "हिन्दी", bn: "বাংলা" };

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (locales as readonly string[]).includes(v);

/** The best supported language for an Accept-Language header, used only until the visitor picks one. */
export function fromAcceptLanguage(header: string | null): Locale {
  for (const part of (header ?? "").split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase().split("-")[0];
    if (isLocale(tag)) return tag;
  }
  return defaultLocale;
}

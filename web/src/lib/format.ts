import { rt, runtimeLocale } from "@/i18n/runtime";

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const shortHash = (h: string, n = 8) => (h.length > 2 * n + 2 ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : h);

export function fmtDuration(totalSeconds: number): string {
  let s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (d) return rt("Format.dh", { d, h });
  if (h) return rt("Format.hm", { h, m });
  return m ? rt("Format.ms", { m, s: String(s).padStart(2, "0") }) : rt("Format.s", { s });
}

// Latin digits in every language, so ids, counts and times read the same everywhere.
export const fmtTime = (unix: number) => new Date(unix * 1000).toLocaleString(`${runtimeLocale()}-u-nu-latn`);

/** A number with the active language's digit grouping (Latin digits). */
export const fmtNumber = (n: number) => n.toLocaleString(`${runtimeLocale()}-u-nu-latn`);

export const UNITS = { minutes: 60, hours: 3600, days: 86400 } as const;
export type Unit = keyof typeof UNITS;

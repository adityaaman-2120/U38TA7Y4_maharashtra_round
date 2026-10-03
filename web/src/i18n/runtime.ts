// Plain functions (error messages, audit summaries, the PDF report) are not React components, so they cannot call a hook.
// The provider hands them the active translator here; they call `rt` at the moment a message is needed.
type Values = Record<string, string | number | Date>;
export type Translator = (key: string, values?: Values) => string;

let translator: Translator | null = null;
let activeLocale = "en";

export function setRuntime(t: Translator, locale: string) {
  translator = t;
  activeLocale = locale;
}

/** Translates a full key such as "Errors.NotOwner". Falls back to the key itself so a gap is visible, never a crash. */
export const rt: Translator = (key, values) => (translator ? translator(key, values) : key);
export const runtimeLocale = () => activeLocale;

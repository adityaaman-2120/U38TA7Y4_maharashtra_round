"use client";
import { useTranslations } from "next-intl";
import { Select } from "./ui";

export type Person = { address: string; name: string };

/** Pick from people who accepted an invitation. There is deliberately no way to type an arbitrary address. */
export function PersonSelect({ value, onChange, people, taken = [], testId, placeholder, verified }: {
  value: string;
  onChange: (address: string) => void;
  people: Person[];
  taken?: string[]; // addresses already chosen elsewhere
  testId?: string;
  placeholder?: string;
  /** When given, people who verified an identity are marked in the list. */
  verified?: (address: string) => boolean;
}) {
  const t = useTranslations("PersonSelect");
  const tc = useTranslations("Common");
  const lowerTaken = taken.map((t) => t.toLowerCase());
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
      <option value="">{placeholder ?? t("placeholder")}</option>
      {people.map((p) => (
        <option key={p.address} value={p.address} disabled={lowerTaken.includes(p.address.toLowerCase()) && p.address.toLowerCase() !== value.toLowerCase()}>
          {p.name || tc("unnamed")} · {p.address.slice(0, 6)}…{p.address.slice(-4)}{verified?.(p.address) ? ` · ${t("verifiedSuffix")}` : ""}
        </option>
      ))}
    </Select>
  );
}

export function NoPeople({ message, onGoPeople }: { message: string; onGoPeople?: () => void }) {
  const t = useTranslations("PersonSelect");
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-sunken/50 p-4 text-sm text-ink-2" data-testid="no-people">
      <p>{message}</p>
      {onGoPeople && <button onClick={onGoPeople} className="mt-2 font-medium text-accent underline" data-testid="go-people">{t("goToPeople")}</button>}
    </div>
  );
}

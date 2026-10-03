"use client";
import { Select } from "./ui";

export type Person = { address: string; name: string };

/** Pick from people who accepted an invitation. There is deliberately no way to type an arbitrary address. */
export function PersonSelect({ value, onChange, people, taken = [], testId, placeholder = "Choose someone…", verified }: {
  value: string;
  onChange: (address: string) => void;
  people: Person[];
  taken?: string[]; // addresses already chosen elsewhere
  testId?: string;
  placeholder?: string;
  /** When given, people who verified an identity are marked in the list. */
  verified?: (address: string) => boolean;
}) {
  const lowerTaken = taken.map((t) => t.toLowerCase());
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
      <option value="">{placeholder}</option>
      {people.map((p) => (
        <option key={p.address} value={p.address} disabled={lowerTaken.includes(p.address.toLowerCase()) && p.address.toLowerCase() !== value.toLowerCase()}>
          {p.name || "Unnamed"} · {p.address.slice(0, 6)}…{p.address.slice(-4)}{verified?.(p.address) ? " · ✓ verified" : ""}
        </option>
      ))}
    </Select>
  );
}

export function NoPeople({ message, onGoPeople }: { message: string; onGoPeople?: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-sunken/50 p-4 text-sm text-ink-2" data-testid="no-people">
      <p>{message}</p>
      {onGoPeople && <button onClick={onGoPeople} className="mt-2 font-medium text-accent underline" data-testid="go-people">Go to People</button>}
    </div>
  );
}

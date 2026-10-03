'use client';

import { STATE_STYLE } from '@/store/vault';
import type { VaultState } from '@/lib/types';

export function StateBadge({ state }: { state: VaultState }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold tracking-wide ${STATE_STYLE[state]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {state.replace('_', ' ')}
    </span>
  );
}

export function Section({
  title,
  hint,
  children,
  className = '',
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel p-5 ${className}`}>
      <header className="mb-4">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

export function Stat({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-edge bg-ink/50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 font-mono text-sm ${tone || 'text-slate-100'}`}>{value}</p>
    </div>
  );
}

/** Human duration, signed: "4 d 2 h left" / "overdue by 3 d". */
export function duration(ms: number): string {
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} m`;
  if (m > 0) return `${m} m ${s} s`;
  return `${s} s`;
}

export const clock = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

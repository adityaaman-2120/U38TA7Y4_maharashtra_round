"use client";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function Card({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-[0_1px_0_rgba(21,24,29,0.03),0_8px_24px_-16px_rgba(21,24,29,0.12)]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-2xl leading-tight text-ink">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Btn({ className = "", tone = "primary", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "danger" | "ghost" }) {
  const tones = {
    primary: "bg-accent text-white hover:bg-accent-hover shadow-sm",
    danger: "bg-bad text-white hover:bg-bad/90 shadow-sm",
    ghost: "border border-line-strong bg-surface text-ink hover:bg-sunken",
  };
  return <button {...p} className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${className}`} />;
}

const field = "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent disabled:bg-sunken";
export const Input = ({ className = "", ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`${field} ${className}`} />;
export const Select = ({ className = "", ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`${field} ${className}`} />;

export function Label({ text, children, hint }: { text: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block space-y-1.5 text-sm text-ink-2">
      <span className="font-medium text-ink">{text}</span>
      {children}
      {hint && <span className="block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export function Badge({ tone, children }: { tone: "good" | "bad" | "warn" | "info"; children: ReactNode }) {
  const t = { good: "bg-ok-soft text-ok", bad: "bg-bad-soft text-bad", warn: "bg-warn-soft text-warn", info: "bg-accent-soft text-accent" };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${t[tone]}`}>{children}</span>;
}

export const Mono = ({ children }: { children: ReactNode }) => <span className="break-all font-mono text-xs text-muted">{children}</span>;

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-faint">{children}</p>;
}

export const Skeleton = ({ className = "" }: { className?: string }) => <div aria-hidden className={`animate-pulse rounded-lg bg-sunken ${className}`} />;

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-2 rounded-2xl border border-line bg-surface p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line-strong bg-surface/60 p-10 text-center">
      <p className="font-display text-xl text-ink">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-sm text-faint">{hint}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, tone = "info" }: { label: string; value: ReactNode; tone?: "good" | "bad" | "warn" | "info" }) {
  const t = { good: "text-ok", bad: "text-bad", warn: "text-warn", info: "text-ink" };
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs uppercase tracking-wider text-faint">{label}</p>
      <p className={`mt-1 font-display text-3xl ${t[tone]}`}>{value}</p>
    </div>
  );
}

export const StatGrid = ({ children }: { children: ReactNode }) => <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">{children}</div>;

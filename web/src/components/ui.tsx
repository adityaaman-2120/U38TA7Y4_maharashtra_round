"use client";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function Card({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-100">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Btn({ className = "", tone = "primary", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "danger" | "ghost" }) {
  const tones = {
    primary: "bg-indigo-600 hover:bg-indigo-500 text-white",
    danger: "bg-red-600 hover:bg-red-500 text-white",
    ghost: "bg-slate-800 hover:bg-slate-700 text-slate-100",
  };
  return <button {...p} className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${className}`} />;
}

const field = "w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500";
export const Input = ({ className = "", ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`${field} ${className}`} />;
export const Select = ({ className = "", ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`${field} ${className}`} />;

export function Label({ text, children, hint }: { text: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block space-y-1 text-sm text-slate-300">
      <span>{text}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Badge({ tone, children }: { tone: "good" | "bad" | "warn" | "info"; children: ReactNode }) {
  const t = { good: "bg-emerald-500/15 text-emerald-300", bad: "bg-red-500/15 text-red-300", warn: "bg-amber-500/15 text-amber-300", info: "bg-indigo-500/15 text-indigo-300" };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${t[tone]}`}>{children}</span>;
}

export const Mono = ({ children }: { children: ReactNode }) => <span className="break-all font-mono text-xs text-slate-400">{children}</span>;

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>;
}

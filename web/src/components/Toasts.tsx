"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { explorerTxUrl } from "@/lib/wagmi";
import { shortHash } from "@/lib/format";

export type Toast = { id: number; kind: "pending" | "success" | "error"; message: string; hash?: string; chainId?: number };
type Api = {
  push: (t: Omit<Toast, "id">) => number;
  update: (id: number, patch: Partial<Omit<Toast, "id">>) => void;
  dismiss: (id: number) => void;
};

const Ctx = createContext<Api | null>(null);
export const useToasts = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("ToastProvider missing");
  return c;
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const schedule = useCallback((id: number, kind: Toast["kind"]) => {
    clearTimeout(timers.current.get(id));
    if (kind !== "pending") timers.current.set(id, setTimeout(() => dismiss(id), kind === "error" ? 15000 : 8000));
  }, [dismiss]);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = next.current++;
    setToasts((x) => [...x, { ...t, id }]);
    schedule(id, t.kind);
    return id;
  }, [schedule]);

  const update = useCallback((id: number, patch: Partial<Omit<Toast, "id">>) => {
    setToasts((x) => x.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    if (patch.kind) schedule(id, patch.kind);
  }, [schedule]);

  const api = useMemo(() => ({ push, update, dismiss }), [push, update, dismiss]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => {
          const url = t.hash && t.chainId ? explorerTxUrl(t.chainId, t.hash) : null;
          const tone = t.kind === "error" ? "border-bad/40" : t.kind === "success" ? "border-ok/40" : "border-line-strong";
          return (
            <div key={t.id} data-testid={`toast-${t.kind}`} className={`rounded-xl border ${tone} bg-surface p-3.5 text-sm text-ink shadow-[0_12px_32px_-12px_rgba(21,24,29,0.35)]`}>
              <div className="flex items-start justify-between gap-2">
                <p className="break-words">{t.kind === "pending" ? "⏳ " : t.kind === "success" ? "✓ " : "✗ "}{t.message}</p>
                <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-muted hover:text-ink">×</button>
              </div>
              {t.hash && (
                <p className="mt-1 text-xs text-muted">
                  Tx{" "}
                  {url ? <a href={url} target="_blank" rel="noreferrer" className="text-accent underline">{shortHash(t.hash, 6)} on explorer</a> : <span className="font-mono">{shortHash(t.hash, 6)}</span>}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

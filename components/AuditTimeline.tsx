'use client';

import type { AuditKind } from '@/lib/types';
import { useVault } from '@/store/vault';
import { clock } from './ui';

const KIND_STYLE: Record<AuditKind, string> = {
  'vault-created': 'bg-slate-500',
  heartbeat: 'bg-emerald-500',
  attestation: 'bg-amber-500',
  'attestation-withdrawn': 'bg-amber-700',
  'recovery-started': 'bg-orange-500',
  'recovery-cancelled': 'bg-emerald-600',
  released: 'bg-sky-500',
  'share-released': 'bg-sky-400',
  claimed: 'bg-violet-500',
  'claim-rejected': 'bg-rose-500',
  'guardian-toggled': 'bg-slate-600',
  demo: 'bg-slate-700',
};

export default function AuditTimeline() {
  const vault = useVault((s) => s.vault);
  if (!vault) return null;
  const entries = [...vault.audit].reverse();

  return (
    <section className="panel p-5">
      <header className="mb-4 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-white">Audit timeline</h3>
        <span className="text-xs text-muted">{entries.length} events · newest first</span>
      </header>
      <ol className="max-h-96 space-y-0 overflow-auto pr-1">
        {entries.map((e) => (
          <li key={e.id} className="relative flex gap-3 pb-4 pl-1 last:pb-0">
            <span className="relative flex w-3 shrink-0 justify-center">
              <span className={`z-10 mt-1.5 h-2 w-2 rounded-full ${KIND_STYLE[e.kind]}`} />
              <span className="absolute top-3 h-full w-px bg-edge" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs font-medium text-slate-200">{e.kind}</span>
                <span className="font-mono text-[10px] text-muted">{e.actor}</span>
                <span className="ml-auto font-mono text-[10px] text-slate-600">{clock(e.at)}</span>
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{e.message}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

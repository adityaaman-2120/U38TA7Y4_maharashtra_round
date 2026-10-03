'use client';

import { useEffect, useState } from 'react';
import AuditTimeline from '@/components/AuditTimeline';
import DemoControls from '@/components/DemoControls';
import GuardianTab from '@/components/GuardianTab';
import HeirTab from '@/components/HeirTab';
import OwnerTab from '@/components/OwnerTab';
import { StateBadge, duration } from '@/components/ui';
import { GUARDIAN_COUNT, THRESHOLD } from '@/lib/crypto';
import type { Role } from '@/lib/types';
import { useVault } from '@/store/vault';

const TABS: { id: Role; label: string }[] = [
  { id: 'owner', label: 'Owner' },
  { id: 'guardian', label: 'Guardian' },
  { id: 'heir', label: 'Heir' },
];

export default function Page() {
  const vault = useVault((s) => s.vault);
  const role = useVault((s) => s.role);
  const setRole = useVault((s) => s.setRole);
  const seed = useVault((s) => s.seed);
  const tick = useVault((s) => s.tick);
  const now = useVault((s) => s.now);
  const challengeEndsAt = useVault((s) => s.challengeEndsAt);
  const [, forceRender] = useState(0);

  useEffect(() => {
    seed();
  }, [seed]);

  // Drives the permissionless transitions and keeps the countdowns live.
  useEffect(() => {
    const t = setInterval(() => {
      tick();
      forceRender((n) => n + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [tick]);

  const windowLeft = vault?.state === 'RECOVERY_PENDING' ? challengeEndsAt() - now() : null;

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Heirloom</h1>
            <p className="mt-0.5 text-sm text-muted">
              Trust-minimized digital inheritance · {THRESHOLD}-of-{GUARDIAN_COUNT} guardians · no
              admin, no pause, no override
            </p>
          </div>
          <div className="flex items-center gap-3">
            {vault && <StateBadge state={vault.state} />}
            {windowLeft !== null && windowLeft > 0 && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 font-mono text-xs text-amber-300">
                challenge closes in {duration(windowLeft)}
              </span>
            )}
          </div>
        </div>

        <p className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-xs text-sky-200">
          Demo — cryptography is real, chain layer simulated.
        </p>
      </header>

      {!vault ? (
        <div className="panel p-10 text-center text-sm text-muted">
          Generating keys, encrypting the example vault and splitting the key…
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <main>
            <nav className="mb-5 inline-flex rounded-xl border border-edge bg-panel p-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setRole(t.id)}
                  className={`rounded-lg px-5 py-2 text-sm font-semibold transition ${
                    role === t.id
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>

            {role === 'owner' && <OwnerTab />}
            {role === 'guardian' && <GuardianTab />}
            {role === 'heir' && <HeirTab />}

            <div className="mt-5">
              <AuditTimeline />
            </div>
          </main>

          <DemoControls />
        </div>
      )}
    </div>
  );
}

'use client';

import { THRESHOLD } from '@/lib/crypto';
import type { Role } from '@/lib/types';
import { HEIR_WALLET, SEED_HEIR_ID, SEED_SALT, useVault } from '@/store/vault';
import { duration } from './ui';

const ROLES: Role[] = ['owner', 'guardian', 'heir'];

const IMPOSTOR = {
  heirId: 'FR-0000-9999',
  salt: 'guessed-salt',
  wallet: '0xBADD000000000000000000000000000000009999',
};

export default function DemoControls() {
  const vault = useVault((s) => s.vault);
  const role = useVault((s) => s.role);
  const setRole = useVault((s) => s.setRole);
  const toggleGuardian = useVault((s) => s.toggleGuardian);
  const ffHeartbeat = useVault((s) => s.fastForwardHeartbeat);
  const ffChallenge = useVault((s) => s.fastForwardChallenge);
  const reset = useVault((s) => s.reset);
  const setPrefill = useVault((s) => s.setPrefill);
  const now = useVault((s) => s.now);
  const deadline = useVault((s) => s.heartbeatDeadline);
  const missed = useVault((s) => s.heartbeatMissed);
  const skew = useVault((s) => s.clockSkewMs);

  if (!vault) return null;

  return (
    <aside className="panel p-5">
      <header className="mb-4">
        <h3 className="text-sm font-semibold text-white">Demo controls</h3>
        <p className="mt-0.5 text-xs text-muted">
          Years of vault behaviour, compressed. These move a simulated clock; they never bypass a
          rule.
        </p>
      </header>

      <div className="space-y-4">
        <div>
          <p className="label">Active role</p>
          <div className="grid grid-cols-3 gap-1.5">
            {ROLES.map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={`rounded-lg px-2 py-1.5 text-xs font-semibold capitalize transition ${
                  role === r
                    ? 'bg-sky-500 text-slate-950'
                    : 'border border-edge text-slate-300 hover:bg-white/5'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="label">Time travel</p>
          <div className="space-y-1.5">
            <button
              className="btn-ghost w-full !py-1.5 !text-xs"
              onClick={ffHeartbeat}
              disabled={missed()}
            >
              {missed()
                ? 'Heartbeat deadline already passed'
                : `Fast-forward past heartbeat (${duration(deadline() - now())})`}
            </button>
            <button
              className="btn-ghost w-full !py-1.5 !text-xs"
              onClick={ffChallenge}
              disabled={vault.state !== 'RECOVERY_PENDING'}
            >
              Fast-forward past challenge window
            </button>
          </div>
          {skew > 0 && (
            <p className="mt-1.5 text-[10px] text-muted">clock advanced {duration(skew)}</p>
          )}
        </div>

        <div>
          <p className="label">Guardian availability</p>
          <div className="space-y-1">
            {vault.guardians.map((g) => (
              <button
                key={g.id}
                onClick={() => toggleGuardian(g.id)}
                className="flex w-full items-center justify-between rounded-md border border-edge px-2.5 py-1.5 text-left text-[11px] transition hover:bg-white/5"
              >
                <span className={g.online ? 'text-slate-200' : 'text-slate-600 line-through'}>
                  {g.name}
                </span>
                <span
                  className={`font-mono ${g.online ? 'text-emerald-400' : 'text-rose-500'}`}
                >
                  {g.online ? 'ON' : 'OFF'}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-muted">
            Recovery needs only {THRESHOLD} of 5 — switch two off and it still completes.
          </p>
        </div>

        <div>
          <p className="label">Identities</p>
          <div className="space-y-1.5">
            <button
              className="btn-ghost w-full !py-1.5 !text-xs"
              onClick={() =>
                setPrefill({ heirId: SEED_HEIR_ID, salt: SEED_SALT, wallet: HEIR_WALLET })
              }
            >
              Load legitimate heir
            </button>
            <button
              className="btn-ghost w-full !border-rose-500/40 !py-1.5 !text-xs !text-rose-300"
              onClick={() => setPrefill(IMPOSTOR)}
            >
              Load impostor identity
            </button>
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
            The impostor carries a genuine government ID — it simply is not the one committed at
            vault creation.
          </p>
        </div>

        <button className="btn-danger w-full !py-1.5 !text-xs" onClick={reset}>
          Reset to initial state
        </button>
      </div>
    </aside>
  );
}

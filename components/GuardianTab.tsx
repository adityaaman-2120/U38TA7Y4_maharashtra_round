'use client';

import { GUARDIAN_COUNT, THRESHOLD } from '@/lib/crypto';
import { useVault } from '@/store/vault';
import { Section, Stat, clock, duration } from './ui';

export default function GuardianTab() {
  const vault = useVault((s) => s.vault);
  const now = useVault((s) => s.now);
  const attest = useVault((s) => s.attest);
  const releaseShare = useVault((s) => s.releaseShare);
  const missed = useVault((s) => s.heartbeatMissed);
  const attested = useVault((s) => s.attestationCount);
  const released = useVault((s) => s.releasedShareCount);
  const challengeEndsAt = useVault((s) => s.challengeEndsAt);

  if (!vault) return null;

  const isMissed = missed();
  const canAttest = vault.state === 'ACTIVE';
  const canRelease = vault.state === 'RELEASED';
  const windowLeft = challengeEndsAt() - now();

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Section
        title="Pending attestation requests"
        hint="Attest only if you independently believe the owner is permanently unavailable."
      >
        {!isMissed && vault.state === 'ACTIVE' ? (
          <p className="rounded-md border border-edge bg-ink/40 p-3 text-xs text-muted">
            No request outstanding. The owner&apos;s heartbeat is current — attesting now would be
            counted, but recovery still cannot open until the deadline is actually missed.
          </p>
        ) : (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            {vault.state === 'ACTIVE'
              ? `Heartbeat deadline passed ${duration(windowLeft === Infinity ? 0 : 0)}— ${attested()} of ${THRESHOLD} attestations collected. Your signature is requested.`
              : `Vault is ${vault.state.replace('_', ' ')}.`}
          </p>
        )}

        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="Attestations" value={`${attested()} / ${THRESHOLD}`} />
          <Stat label="Heartbeat" value={isMissed ? 'missed' : 'current'} tone={isMissed ? 'text-amber-300' : 'text-emerald-300'} />
          <Stat label="Shares out" value={`${released()} / ${THRESHOLD}`} />
        </div>

        {vault.state === 'RECOVERY_PENDING' && (
          <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">
            Challenge window closes in {duration(windowLeft)} ({clock(challengeEndsAt())}). The
            owner can still cancel. Shares stay sealed until then.
          </p>
        )}
      </Section>

      <Section
        title="My vault duties"
        hint={`Five guardian slots. Any ${THRESHOLD} can complete a recovery; fewer learn nothing.`}
      >
        <ul className="space-y-2">
          {vault.guardians.map((g) => {
            const share = vault.shares.find((s) => s.guardianId === g.id);
            return (
              <li key={g.id} className="rounded-lg border border-edge bg-ink/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${g.online ? 'text-slate-100' : 'text-slate-600 line-through'}`}>
                      {g.name}
                    </p>
                    <p className="truncate font-mono text-[10px] text-muted">
                      sealed share #{g.id} · {share ? share.sealedHex.length / 2 : 0} B ·{' '}
                      {share?.sealedHex.slice(0, 16)}…
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-[10px] font-semibold uppercase ${g.online ? 'text-emerald-400' : 'text-rose-500'}`}
                  >
                    {g.online ? 'online' : 'offline'}
                  </span>
                </div>

                <div className="mt-2.5 flex gap-2">
                  <button
                    className="btn-ghost flex-1 !py-1.5 !text-xs"
                    disabled={!canAttest || !g.online || g.attested}
                    onClick={() => attest(g.id)}
                  >
                    {g.attested ? 'Attested ✓' : 'Attest unavailable'}
                  </button>
                  <button
                    className="btn-ghost flex-1 !py-1.5 !text-xs"
                    disabled={!canRelease || !g.online || g.shareReleased}
                    onClick={() => releaseShare(g.id)}
                  >
                    {g.shareReleased ? 'Share released ✓' : 'Release my share'}
                  </button>
                </div>
                {!canRelease && !g.shareReleased && (
                  <p className="mt-1.5 text-[10px] text-muted">
                    Release is locked until the vault reaches RELEASED.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          A guardian never sees the asset. It holds one ECIES-sealed Shamir share of the AES key,
          readable only by the heir&apos;s private key — so even all {GUARDIAN_COUNT} colluding
          guardians cannot open the vault without the heir.
        </p>
      </Section>
    </div>
  );
}

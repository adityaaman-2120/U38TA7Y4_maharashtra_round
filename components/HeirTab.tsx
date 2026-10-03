'use client';

import { useEffect, useState } from 'react';
import { THRESHOLD, heirCommitment } from '@/lib/crypto';
import { CATEGORY_LABEL } from '@/lib/types';
import { CLAIM_THRESHOLD, HEIR_WALLET, useVault } from '@/store/vault';
import { Section, Stat } from './ui';

export default function HeirTab() {
  const vault = useVault((s) => s.vault);
  const claim = useVault((s) => s.claim);
  const claimError = useVault((s) => s.claimError);
  const recovered = useVault((s) => s.recovered);
  const busy = useVault((s) => s.busy);
  const assessClaim = useVault((s) => s.assessClaim);
  const released = useVault((s) => s.releasedShareCount);

  const [heirId, setHeirId] = useState('');
  const [salt, setSalt] = useState('');
  const [wallet, setWallet] = useState(HEIR_WALLET);
  const [idMatches, setIdMatches] = useState(false);
  const prefill = useVault((s) => s.prefill);

  // The demo panel can drop a legitimate or impostor identity into the form.
  useEffect(() => {
    if (!prefill) return;
    setHeirId(prefill.heirId);
    setSalt(prefill.salt);
    setWallet(prefill.wallet);
  }, [prefill]);

  // Live preview of the commitment check as the heir types.
  useEffect(() => {
    let cancelled = false;
    if (!vault || !heirId.trim() || !salt.trim()) {
      setIdMatches(false);
      return;
    }
    heirCommitment(heirId, salt).then((c) => {
      if (!cancelled) setIdMatches(c === vault.heirCommitment);
    });
    return () => {
      cancelled = true;
    };
  }, [heirId, salt, vault]);

  if (!vault) return null;

  const walletMatches = wallet.trim().toLowerCase() === vault.heirWallet.toLowerCase();
  const assessment = assessClaim(idMatches, walletMatches);
  const pct = Math.min(100, assessment.score);
  const sharesOut = released();
  const canAttempt = vault.state === 'RELEASED' && !busy;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <Section title="Vaults naming me" hint="Vaults where this identity is the designated heir.">
          <div className="rounded-lg border border-edge bg-ink/40 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-100">{vault.name}</p>
                <p className="text-xs text-muted">{CATEGORY_LABEL[vault.category]}</p>
              </div>
              <span className="font-mono text-[10px] text-muted">{vault.id}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Stat label="State" value={vault.state.replace('_', ' ')} />
              <Stat
                label="Shares published"
                value={`${sharesOut} / ${THRESHOLD}`}
                tone={sharesOut >= THRESHOLD ? 'text-emerald-300' : 'text-muted'}
              />
            </div>
            <p className="mt-2 break-all font-mono text-[10px] text-muted">
              commitment {vault.heirCommitment.slice(0, 32)}…
            </p>
          </div>
        </Section>

        <Section
          title="Claim strength"
          hint={`Weighted factors. The claim button unlocks at ${CLAIM_THRESHOLD}.`}
        >
          <div className="mb-3 h-2.5 w-full overflow-hidden rounded-full bg-ink">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                assessment.passes ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-700'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mb-3 flex items-baseline justify-between">
            <span
              className={`font-mono text-2xl ${assessment.passes ? 'text-emerald-300' : 'text-amber-300'}`}
            >
              {assessment.score}
            </span>
            <span className="text-xs text-muted">threshold {CLAIM_THRESHOLD}</span>
          </div>
          <ul className="space-y-1.5">
            {assessment.factors.map((f) => (
              <li
                key={f.label}
                className="flex items-start justify-between gap-3 rounded-md border border-edge bg-ink/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className={`text-xs ${f.met ? 'text-slate-100' : 'text-slate-500'}`}>
                    {f.label}
                  </p>
                  <p className="text-[10px] text-muted">{f.note}</p>
                </div>
                <span
                  className={`shrink-0 font-mono text-xs ${f.earned > 0 ? 'text-emerald-300' : 'text-slate-600'}`}
                >
                  {f.earned}/{f.weight}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <div className="space-y-5">
        <Section
          title="Identity proof"
          hint="Commitment check (ZK circuit in production) — the raw ID never leaves this browser."
        >
          <div className="space-y-3">
            <div>
              <label className="label">Heir ID number</label>
              <input
                className="field"
                value={heirId}
                onChange={(e) => setHeirId(e.target.value)}
                placeholder="e.g. FR-8842-1193"
              />
            </div>
            <div>
              <label className="label">Salt</label>
              <input
                className="field"
                value={salt}
                onChange={(e) => setSalt(e.target.value)}
                placeholder="shared privately by the owner"
              />
            </div>
            <div>
              <label className="label">Connected wallet</label>
              <input
                className="field font-mono text-xs"
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
              />
            </div>
          </div>

          <p
            className={`mt-3 rounded-md border p-2 text-[11px] ${
              idMatches
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-edge bg-ink/40 text-muted'
            }`}
          >
            {idMatches
              ? 'sha256(ID + salt) matches the committed digest.'
              : 'Commitment not matched yet. In production this is proved in zero knowledge — the contract learns only that the heir knows a preimage, never the ID itself.'}
          </p>

          <button
            className="btn-primary mt-4 w-full"
            disabled={!canAttempt || !assessment.passes}
            onClick={() => claim(heirId, salt, wallet)}
          >
            {busy ? 'Unsealing shares…' : 'Claim & decrypt'}
          </button>
          <button
            className="btn-ghost mt-2 w-full !text-xs"
            disabled={busy}
            onClick={() => claim(heirId, salt, wallet)}
          >
            Attempt claim anyway (show the rejection reason)
          </button>
          {!canAttempt && vault.state !== 'CLAIMED' && (
            <p className="mt-2 text-center text-[11px] text-muted">
              Vault is {vault.state.replace('_', ' ')} — shares are published only once RELEASED.
            </p>
          )}
        </Section>

        {claimError && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-300">
              Claim rejected
            </p>
            <p className="mt-1 text-xs leading-relaxed text-rose-200">{claimError}</p>
          </div>
        )}

        {recovered && (
          <Section title="Recovered asset" hint={`Decrypted in this browser from ${THRESHOLD} shares.`}>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 font-mono text-[11px] leading-relaxed text-emerald-100">
              {recovered.text}
            </pre>
            <a
              className="btn-ghost mt-3 w-full"
              download={recovered.filename}
              href={`data:text/plain;charset=utf-8,${encodeURIComponent(recovered.text)}`}
            >
              Download {recovered.filename}
            </a>
          </Section>
        )}
      </div>
    </div>
  );
}

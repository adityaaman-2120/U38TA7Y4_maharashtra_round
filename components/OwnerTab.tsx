'use client';

import { useState } from 'react';
import { GUARDIAN_COUNT, THRESHOLD } from '@/lib/crypto';
import { CATEGORY_LABEL, type AssetCategory } from '@/lib/types';
import {
  DEFAULT_CHALLENGE_MS,
  DEFAULT_HEARTBEAT_MS,
  HEIR_WALLET,
  useVault,
} from '@/store/vault';
import { Section, Stat, clock, duration } from './ui';

function CreateVaultForm() {
  const createVault = useVault((s) => s.createVault);
  const busy = useVault((s) => s.busy);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<AssetCategory>('document');
  const [secretText, setSecretText] = useState('');
  const [filename, setFilename] = useState('asset.txt');
  const [heirId, setHeirId] = useState('');
  const [salt, setSalt] = useState('');
  const [heirWallet, setHeirWallet] = useState(HEIR_WALLET);
  const [days, setDays] = useState(365);
  const [windowDays, setWindowDays] = useState(30);

  const ready = name.trim() && secretText.trim() && heirId.trim() && salt.trim();

  async function onFile(f: File | undefined) {
    if (!f) return;
    setFilename(f.name);
    setSecretText(await f.text());
    if (!name) setName(f.name);
  }

  return (
    <Section
      title="Create a vault"
      hint={`Encrypted here in your browser, then split ${THRESHOLD}-of-${GUARDIAN_COUNT}. The plaintext never leaves this tab.`}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Vault name</label>
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Estate of…"
          />
        </div>
        <div>
          <label className="label">Asset category</label>
          <select
            className="field"
            value={category}
            onChange={(e) => setCategory(e.target.value as AssetCategory)}
          >
            {(Object.keys(CATEGORY_LABEL) as AssetCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3">
        <label className="label">Secret — paste text or load a file</label>
        <textarea
          className="field h-28 resize-y font-mono text-xs"
          value={secretText}
          onChange={(e) => setSecretText(e.target.value)}
          placeholder="Seed phrase, credentials, letter…"
        />
        <input
          type="file"
          className="mt-2 block w-full text-xs text-muted file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:text-slate-200"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </div>

      <div className="mt-4 rounded-lg border border-edge bg-ink/40 p-3">
        <p className="label !mb-2">
          Heir identity commitment — stored as sha256(ID + salt)
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            className="field"
            value={heirId}
            onChange={(e) => setHeirId(e.target.value)}
            placeholder="Heir ID number"
          />
          <input
            className="field"
            value={salt}
            onChange={(e) => setSalt(e.target.value)}
            placeholder="Salt (shared with heir privately)"
          />
        </div>
        <input
          className="field mt-3"
          value={heirWallet}
          onChange={(e) => setHeirWallet(e.target.value)}
          placeholder="Heir wallet address"
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Heartbeat interval (days)</label>
          <input
            type="number"
            min={1}
            className="field"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label">Challenge window (days)</label>
          <input
            type="number"
            min={1}
            className="field"
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
          />
        </div>
      </div>

      <button
        className="btn-primary mt-4 w-full"
        disabled={!ready || busy}
        onClick={() =>
          createVault({
            name: name.trim(),
            category,
            secretText,
            filename,
            heirId,
            salt,
            heirWallet,
            heartbeatMs: Math.max(1, days) * 86400000,
            challengeMs: Math.max(1, windowDays) * 86400000,
          })
        }
      >
        {busy ? 'Encrypting & splitting…' : 'Encrypt, split and seal'}
      </button>
      <p className="mt-2 text-center text-[11px] text-muted">
        Replaces the demo vault in this session.
      </p>
    </Section>
  );
}

export default function OwnerTab() {
  const vault = useVault((s) => s.vault);
  const now = useVault((s) => s.now);
  const heartbeat = useVault((s) => s.heartbeat);
  const cancelRecovery = useVault((s) => s.cancelRecovery);
  const deadline = useVault((s) => s.heartbeatDeadline);
  const missed = useVault((s) => s.heartbeatMissed);
  const attested = useVault((s) => s.attestationCount);

  if (!vault) return null;
  const remaining = deadline() - now();
  const isMissed = missed();
  const activeGuardians = vault.guardians.filter((g) => g.online).length;
  const quorumReachable = activeGuardians >= THRESHOLD;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <Section title="Heartbeat" hint="Proof of life. Resets the clock and clears any attestations.">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className={`font-mono text-2xl ${isMissed ? 'text-rose-400' : 'text-emerald-300'}`}>
                {isMissed ? `overdue by ${duration(remaining)}` : `${duration(remaining)} left`}
              </p>
              <p className="mt-1 text-xs text-muted">deadline {clock(deadline())}</p>
            </div>
            <button
              className="btn-primary shrink-0"
              onClick={heartbeat}
              disabled={vault.state === 'RELEASED' || vault.state === 'CLAIMED'}
            >
              I&apos;m still here
            </button>
          </div>
          <p className="mt-3 rounded-md border border-edge bg-ink/40 p-2 text-[11px] leading-relaxed text-muted">
            A missed deadline alone changes nothing. Recovery also needs {THRESHOLD} independent
            guardian attestations — the timer is a necessary signal, never a sufficient one.
          </p>
        </Section>

        <Section title="Vault health" hint="Guardian availability and quorum reachability.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat
              label="Guardians online"
              value={`${activeGuardians} of ${GUARDIAN_COUNT}`}
              tone={quorumReachable ? 'text-emerald-300' : 'text-rose-400'}
            />
            <Stat label="Attestations" value={`${attested()} / ${THRESHOLD}`} />
            <Stat label="Heartbeat missed" value={isMissed ? 'yes' : 'no'} tone={isMissed ? 'text-amber-300' : ''} />
            <Stat label="Threshold" value={`${THRESHOLD}-of-${GUARDIAN_COUNT}`} />
          </div>
          <ul className="mt-3 space-y-1.5">
            {vault.guardians.map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between rounded-md border border-edge bg-ink/40 px-3 py-1.5 text-xs"
              >
                <span className={g.online ? 'text-slate-200' : 'text-slate-600 line-through'}>
                  {g.name}
                </span>
                <span className="flex items-center gap-2">
                  {g.attested && <span className="text-amber-300">attested</span>}
                  {g.shareReleased && <span className="text-sky-300">share out</span>}
                  <span className={g.online ? 'text-emerald-400' : 'text-rose-500'}>
                    {g.online ? 'online' : 'offline'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {!quorumReachable && (
            <p className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-[11px] text-rose-300">
              Fewer than {THRESHOLD} guardians are reachable — the vault cannot be recovered until
              that changes. Replace a guardian before this becomes permanent.
            </p>
          )}
        </Section>

        <Section
          title="Cancel recovery"
          hint="Available only while the vault is RECOVERY_PENDING."
        >
          <button
            className="btn-danger w-full"
            disabled={vault.state !== 'RECOVERY_PENDING'}
            onClick={cancelRecovery}
          >
            {vault.state === 'RECOVERY_PENDING'
              ? 'Cancel recovery — I am alive'
              : `Not available in ${vault.state}`}
          </button>
        </Section>
      </div>

      <CreateVaultForm />
    </div>
  );
}

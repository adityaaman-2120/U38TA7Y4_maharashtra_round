'use client';

/**
 * Phase 1 proof: runs the genuine encrypt -> split -> seal -> unseal ->
 * reconstruct -> decrypt loop in the browser, using only 3 of the 5 shares.
 */
import { useEffect, useState } from 'react';
import { runSelfTest, type SelfTestStep } from '@/lib/crypto';

const SECRET = 'wallet seed: abandon abandon abandon ... art — Heirloom test vector';

export default function CryptoTestPage() {
  const [steps, setSteps] = useState<SelfTestStep[]>([]);
  const [recovered, setRecovered] = useState('');
  const [ok, setOk] = useState<boolean | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    runSelfTest(SECRET)
      .then((r) => {
        setSteps(r.steps);
        setRecovered(r.recovered);
        setOk(r.ok);
      })
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-bold text-white">Phase 1 — browser crypto self-test</h1>
      <p className="mt-1 text-sm text-muted">
        AES-256-GCM · Shamir 3-of-5 · ECIES per-share seal · all in the browser
      </p>

      {error && (
        <p className="mt-6 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 font-mono text-sm text-rose-300">
          {error}
        </p>
      )}

      <ol className="mt-6 space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="panel flex items-start gap-3 p-3">
            <span className={s.ok ? 'text-emerald-400' : 'text-rose-400'}>{s.ok ? '✓' : '✗'}</span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-100">{s.label}</p>
              <p className="break-all font-mono text-xs text-muted">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      {ok !== null && (
        <div
          className={`mt-6 rounded-lg border p-4 ${
            ok ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-rose-500/40 bg-rose-500/10'
          }`}
        >
          <p className={`font-semibold ${ok ? 'text-emerald-300' : 'text-rose-300'}`}>
            {ok ? 'ROUND TRIP OK' : 'ROUND TRIP FAILED'}
          </p>
          <p className="mt-2 break-all font-mono text-xs text-slate-300">{recovered}</p>
        </div>
      )}
    </main>
  );
}

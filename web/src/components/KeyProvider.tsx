"use client";
import { createContext, useCallback, useContext, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Hex } from "viem";
import { readers, useHeirloom, useRead, useTx } from "@/lib/hooks";
import {
  MIN_PASSWORD_LENGTH, clearBackedUp, createKeyBlob, downloadRecoveryFile, hasBackedUp, loadStoredBlob,
  markBackedUp, parseKeyBlob, storeBlob, unlockKeyBlob, type KeyBlob,
} from "@/lib/keystore";
import { Btn, Card, Input } from "./ui";

type Status = "loading" | "setup" | "backup" | "register" | "import" | "locked" | "unlocked";
type KeyApi = { publicKey: Hex; getSecret: () => Uint8Array; lock: () => void };

const Ctx = createContext<KeyApi | null>(null);
export const useKey = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("Encryption key is locked");
  return c;
};

/**
 * Owns the user's encryption keypair lifecycle. The decrypted private key lives only in a ref (memory) for the
 * current session; children render only once it is unlocked.
 */
export function KeyGate({ children }: { children: ReactNode }) {
  const { address, deployment } = useHeirloom();
  const send = useTx();
  const chainKey = useRead(["encKey"], (c, k) => readers.encryptionKey(c, k, address!), { enabled: Boolean(address) });

  // The decrypted key lives only in memory, tagged with its account so a switch locks it automatically.
  const [unlocked, setUnlocked] = useState<{ address: string; secret: Uint8Array } | null>(null);
  const secret = unlocked && address && unlocked.address === address.toLowerCase() ? unlocked.secret : null;
  const [version, setVersion] = useState(0); // bumps on any local key change
  const bump = () => setVersion((v) => v + 1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const blob: KeyBlob | null = useMemo(() => (address ? loadStoredBlob(address) : null), [address, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const onchain = chainKey.data && chainKey.data !== "0x" ? chainKey.data.toLowerCase() : null;
  const backedUp = address ? hasBackedUp(address) : false;

  let status: Status;
  if (!address || chainKey.isLoading || !deployment) status = "loading";
  else if (!blob) status = onchain ? "import" : "setup";
  else if (onchain && blob.publicKey !== onchain) status = "import";
  else if (!backedUp) status = "backup";
  else if (!onchain) status = "register";
  else status = secret ? "unlocked" : "locked";
  const isMismatch = status === "import" && Boolean(blob);

  const lock = useCallback(() => setUnlocked(null), []);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (status === "unlocked" && blob) {
    return <Ctx.Provider value={{ publicKey: blob.publicKey as Hex, getSecret: () => secret!, lock }}>{children}</Ctx.Provider>;
  }

  return (
    <div className="mx-auto max-w-lg">
      {status === "loading" && <p className="text-slate-400">Loading your account…</p>}

      {status === "setup" && (
        <SetupForm busy={busy} error={error} onSubmit={(pw) => guard(async () => {
          const { blob: b, secret: s } = await createKeyBlob(address!, pw);
          clearBackedUp(address!);
          storeBlob(b);
          setUnlocked({ address: address!.toLowerCase(), secret: s });
          bump();
        })} />
      )}

      {status === "backup" && blob && (
        <Card title="Download your recovery file">
          <p className="text-sm text-slate-300">
            Your encryption key exists only in this browser. If you lose this browser data you can no longer decrypt anything, and nobody — including us — can recover it.
            Save the recovery file somewhere safe. It is encrypted with your password.
          </p>
          <Btn data-testid="download-recovery" onClick={() => { downloadRecoveryFile(blob); markBackedUp(address!); bump(); }}>Download recovery file</Btn>
        </Card>
      )}

      {status === "register" && blob && (
        <Card title="Register your encryption key">
          <p className="text-sm text-slate-300">Publish your <b>public</b> key on-chain so others can encrypt to you. The private key stays here.</p>
          <p className="break-all font-mono text-xs text-slate-500">{blob.publicKey}</p>
          <Btn data-testid="register-key" disabled={busy} onClick={() => guard(async () => { await send("Register encryption key", "registerEncryptionKey", [blob.publicKey]); })}>
            Register on-chain
          </Btn>
        </Card>
      )}

      {status === "import" && <ImportForm address={address!} onchain={onchain} mismatch={isMismatch} onImport={(b) => { storeBlob(b); markBackedUp(address!); bump(); }} />}

      {status === "locked" && blob && (
        <UnlockForm busy={busy} error={error} onSubmit={(pw) => guard(async () => {
          setUnlocked({ address: address!.toLowerCase(), secret: await unlockKeyBlob(blob, pw) });
        })} />
      )}
    </div>
  );
}

function SetupForm({ busy, error, onSubmit }: { busy: boolean; error: string; onSubmit: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const problem = pw.length < MIN_PASSWORD_LENGTH ? `Use at least ${MIN_PASSWORD_LENGTH} characters` : pw !== pw2 ? "Passwords do not match" : "";
  const submit = (e: FormEvent) => { e.preventDefault(); if (!problem) onSubmit(pw); };
  return (
    <Card title="Set your encryption password">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-slate-300">
          This password protects your encryption key, which is generated in your browser. It is separate from your wallet and <b>cannot be reset</b>.
        </p>
        <Input type="password" autoComplete="new-password" placeholder="Encryption password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="pw" />
        <Input type="password" autoComplete="new-password" placeholder="Repeat password" value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="pw2" />
        {pw && problem && <p className="text-xs text-amber-400">{problem}</p>}
        <Btn type="submit" disabled={busy || Boolean(problem)} data-testid="create-key">{busy ? "Generating key…" : "Create encryption key"}</Btn>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </Card>
  );
}

function UnlockForm({ busy, error, onSubmit }: { busy: boolean; error: string; onSubmit: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  return (
    <Card title="Unlock your encryption key">
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(pw); }} className="space-y-3">
        <Input type="password" autoComplete="current-password" placeholder="Encryption password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="unlock-pw" />
        <Btn type="submit" disabled={busy || !pw} data-testid="unlock">{busy ? "Unlocking…" : "Unlock"}</Btn>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </Card>
  );
}

function ImportForm({ address, onchain, mismatch, onImport }: { address: string; onchain: string | null; mismatch: boolean; onImport: (b: KeyBlob) => void }) {
  const [error, setError] = useState("");
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const b = parseKeyBlob(await f.text());
      if (b.address.toLowerCase() !== address.toLowerCase()) throw new Error("This recovery file belongs to a different account");
      if (onchain && b.publicKey.toLowerCase() !== onchain) throw new Error("This recovery file does not match the key registered on-chain");
      onImport(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Card title="Import your recovery file">
      <p className="text-sm text-slate-300">
        {mismatch
          ? "The key stored in this browser does not match the key registered on-chain for this account. Import the correct recovery file."
          : "An encryption key is already registered for this account, but it is not in this browser. Import your recovery file to continue."}
      </p>
      <input type="file" accept="application/json,.json" data-testid="import-file" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
      {error && <p className="text-sm text-red-400">{error}</p>}
    </Card>
  );
}

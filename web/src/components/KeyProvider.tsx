"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Hex } from "viem";
import { keyApi } from "@/lib/api";
import { readers, useHeirloom, useRead, useTx } from "@/lib/hooks";
import {
  MIN_PASSWORD_LENGTH, clearNeedsBackup, createKeyBlob, downloadRecoveryFile, loadLegacyBlob, needsBackup,
  parseKeyBlob, removeLegacyBlob, setNeedsBackup, unlockKeyBlob, type KeyBlob,
} from "@/lib/keystore";
import { Btn, Card, Input } from "./ui";

type Status = "loading" | "setup" | "backup" | "register" | "import" | "locked" | "unlocked";
type KeyApi = { publicKey: Hex; getSecret: () => Uint8Array; lock: () => void };

const Ctx = createContext<KeyApi | null>(null);

// The decrypted key is held in memory only, tagged with its account so switching accounts locks it. It lives above
// the pages so client-side navigation (e.g. invite page -> dashboard) does not force another unlock.
type Unlocked = { address: string; secret: Uint8Array } | null;
const UnlockedCtx = createContext<{ unlocked: Unlocked; setUnlocked: (u: Unlocked) => void } | null>(null);
export function UnlockedKeyProvider({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState<Unlocked>(null);
  return <UnlockedCtx.Provider value={{ unlocked, setUnlocked }}>{children}</UnlockedCtx.Provider>;
}
export const useKey = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("Encryption key is locked");
  return c;
};

/**
 * Owns the user's encryption keypair lifecycle. The password-sealed private key is stored on the server (opaque to
 * it) and fetched on sign-in, so it follows the user across devices. The decrypted key exists only in memory.
 */
export function KeyGate({ children }: { children: ReactNode }) {
  const { address, deployment } = useHeirloom();
  const send = useTx();
  const qc = useQueryClient();
  const chainKey = useRead(["encKey"], (c, k) => readers.encryptionKey(c, k, address!), { enabled: Boolean(address) });
  const server = useQuery({ queryKey: ["keyblob", address?.toLowerCase()], queryFn: keyApi.get, enabled: Boolean(address), staleTime: Infinity });

  const store = useContext(UnlockedCtx);
  if (!store) throw new Error("UnlockedKeyProvider missing");
  const { unlocked, setUnlocked } = store;
  const secret = unlocked && address && unlocked.address === address.toLowerCase() ? unlocked.secret : null;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [, bump] = useState(0);

  const storeLocally = useCallback((blob: KeyBlob) => qc.setQueryData(["keyblob", blob.address.toLowerCase()], blob), [qc]);

  // One-time migration of a key sealed by an earlier version of the app (kept only in this browser).
  const migrating = useRef(false);
  const legacy = address && server.data === null ? loadLegacyBlob(address) : null;
  useEffect(() => {
    if (!legacy || !address || migrating.current) return;
    migrating.current = true;
    keyApi.put(legacy)
      .then(() => { removeLegacyBlob(address); storeLocally(legacy); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => { migrating.current = false; });
  }, [legacy, address, storeLocally]);

  const blob: KeyBlob | null = server.data ?? null;
  const onchain = chainKey.data && chainKey.data !== "0x" ? chainKey.data.toLowerCase() : null;

  let status: Status;
  if (!address || chainKey.isLoading || !deployment || server.isLoading || legacy) status = "loading";
  else if (!blob) status = onchain ? "import" : "setup";
  else if (onchain && blob.publicKey !== onchain) status = "import";
  else if (needsBackup(address)) status = "backup";
  else if (!onchain) status = "register";
  else status = secret ? "unlocked" : "locked";
  const isMismatch = status === "import" && Boolean(blob);

  const lock = useCallback(() => setUnlocked(null), [setUnlocked]);

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
      {status === "loading" && (server.isError
        ? <p className="text-bad">Could not load your key from the server: {(server.error as Error).message}</p>
        : <p className="text-muted">Loading your account…</p>)}

      {status === "setup" && (
        <SetupForm busy={busy} error={error} onSubmit={(pw) => guard(async () => {
          const { blob: b, secret: s } = await createKeyBlob(address!, pw);
          await keyApi.put(b); // store first: if this fails nothing else has happened
          setNeedsBackup(address!);
          storeLocally(b);
          setUnlocked({ address: address!.toLowerCase(), secret: s });
        })} />
      )}

      {status === "backup" && blob && (
        <Card title="Download your recovery file">
          <p className="text-sm text-ink-2">
            Your encrypted key is stored with your account, protected by your encryption password. Keep a copy of the recovery file as well:
            if you forget the password, or the service disappears, this file is the only other way back in. It is encrypted with your password too.
          </p>
          <Btn data-testid="download-recovery" onClick={() => { downloadRecoveryFile(blob); clearNeedsBackup(address!); bump((v) => v + 1); }}>Download recovery file</Btn>
        </Card>
      )}

      {status === "register" && blob && (
        <Card title="Register your encryption key">
          <p className="text-sm text-ink-2">Publish your <b>public</b> key on-chain so others can encrypt to you. The private key stays here.</p>
          <p className="break-all font-mono text-xs text-faint">{blob.publicKey}</p>
          <Btn data-testid="register-key" disabled={busy} onClick={() => guard(async () => { await send("Register encryption key", "registerEncryptionKey", [blob.publicKey]); })}>
            Register on-chain
          </Btn>
        </Card>
      )}

      {status === "import" && (
        <ImportForm address={address!} onchain={onchain} mismatch={isMismatch}
          onImport={async (b) => { await keyApi.put(b); storeLocally(b); }} />
      )}

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
        <p className="text-sm text-ink-2">
          This password protects your encryption key, which is generated in your browser. It is separate from your wallet and <b>cannot be reset</b>:
          we only ever store the key in encrypted form and never see the password.
        </p>
        <Input type="password" autoComplete="new-password" placeholder="Encryption password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="pw" />
        <Input type="password" autoComplete="new-password" placeholder="Repeat password" value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="pw2" />
        {pw && problem && <p className="text-xs text-warn">{problem}</p>}
        <Btn type="submit" disabled={busy || Boolean(problem)} data-testid="create-key">{busy ? "Generating key…" : "Create encryption key"}</Btn>
        {error && <p className="text-sm text-bad">{error}</p>}
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
        {error && <p className="text-sm text-bad">{error}</p>}
      </form>
    </Card>
  );
}

function ImportForm({ address, onchain, mismatch, onImport }: { address: string; onchain: string | null; mismatch: boolean; onImport: (b: KeyBlob) => Promise<void> }) {
  const [error, setError] = useState("");
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setError("");
    try {
      const b = parseKeyBlob(await f.text());
      if (b.address.toLowerCase() !== address.toLowerCase()) throw new Error("This recovery file belongs to a different account");
      if (onchain && b.publicKey.toLowerCase() !== onchain) throw new Error("This recovery file does not match the key registered on-chain");
      await onImport(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Card title="Import your recovery file">
      <p className="text-sm text-ink-2">
        {mismatch
          ? "The key stored for this account does not match the key registered on-chain. Import the correct recovery file."
          : "An encryption key is already registered on-chain for this account, but it is not stored with your account. Import your recovery file to continue."}
      </p>
      <input type="file" accept="application/json,.json" data-testid="import-file" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
      {error && <p className="text-sm text-bad">{error}</p>}
    </Card>
  );
}

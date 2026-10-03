"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Hex } from "viem";
import { useTranslations } from "next-intl";
import { keyApi } from "@/lib/api";
import { readers, useHeirloom, useRead, useTx } from "@/lib/hooks";
import {
  MIN_PASSWORD_LENGTH, clearNeedsBackup, createKeyBlob, downloadRecoveryFile, loadLegacyBlob, needsBackup,
  parseKeyBlob, removeLegacyBlob, setNeedsBackup, unlockKeyBlob, type KeyBlob,
} from "@/lib/keystore";
import { Btn, Card, Input } from "./ui";

type Status = "loading" | "setup" | "backup" | "register" | "import" | "locked" | "unlocked";
type KeyApi = { publicKey: Hex; getSecret: () => Uint8Array; lock: () => void; blob: KeyBlob; replaceBlob: (b: KeyBlob) => Promise<void> };

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
  const t = useTranslations("Key");
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
    // Storing a re-sealed copy of the same key (new password) or a recovery file's copy replaces what the server holds.
    const replaceBlob = async (b: KeyBlob) => {
      await keyApi.put(b);
      storeLocally(b);
    };
    return <Ctx.Provider value={{ publicKey: blob.publicKey as Hex, getSecret: () => secret!, lock, blob, replaceBlob }}>{children}</Ctx.Provider>;
  }

  return (
    <div className="mx-auto max-w-lg">
      {status === "loading" && (server.isError
        ? <p className="text-bad">{t("loadFailed", { error: (server.error as Error).message })}</p>
        : <p className="text-muted">{t("loadingAccount")}</p>)}

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
        <Card title={t("backupTitle")}>
          <p className="text-sm text-ink-2">{t("backupBody")}</p>
          <Btn data-testid="download-recovery" onClick={() => { downloadRecoveryFile(blob); clearNeedsBackup(address!); bump((v) => v + 1); }}>{t("downloadRecovery")}</Btn>
        </Card>
      )}

      {status === "register" && blob && (
        <Card title={t("registerTitle")}>
          <p className="text-sm text-ink-2">{t.rich("registerBody", { b: (c) => <b>{c}</b> })}</p>
          <p className="break-all font-mono text-xs text-faint">{blob.publicKey}</p>
          <Btn data-testid="register-key" disabled={busy} onClick={() => guard(async () => { await send(t("registerTx"), "registerEncryptionKey", [blob.publicKey]); })}>
            {t("registerButton")}
          </Btn>
        </Card>
      )}

      {status === "import" && (
        <ImportForm address={address!} onchain={onchain} mismatch={isMismatch}
          onImport={async (b) => { await keyApi.put(b); storeLocally(b); }} />
      )}

      {status === "locked" && blob && (
        <UnlockForm busy={busy} error={error} address={address!} onchain={onchain}
          onSubmit={(pw) => guard(async () => {
            setUnlocked({ address: address!.toLowerCase(), secret: await unlockKeyBlob(blob, pw) });
          })}
          onImport={async (b) => { await keyApi.put(b); storeLocally(b); }} />
      )}
    </div>
  );
}

function SetupForm({ busy, error, onSubmit }: { busy: boolean; error: string; onSubmit: (pw: string) => void }) {
  const t = useTranslations("Key");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const problem = pw.length < MIN_PASSWORD_LENGTH ? t("tooShort", { min: MIN_PASSWORD_LENGTH }) : pw !== pw2 ? t("mismatch") : "";
  const submit = (e: FormEvent) => { e.preventDefault(); if (!problem) onSubmit(pw); };
  return (
    <Card title={t("setupTitle")}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-ink-2">{t.rich("setupBody", { b: (c) => <b>{c}</b> })}</p>
        <Input type="password" autoComplete="new-password" placeholder={t("passwordPlaceholder")} value={pw} onChange={(e) => setPw(e.target.value)} data-testid="pw" />
        <Input type="password" autoComplete="new-password" placeholder={t("repeatPlaceholder")} value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="pw2" />
        {pw && problem && <p className="text-xs text-warn">{problem}</p>}
        <Btn type="submit" disabled={busy || Boolean(problem)} data-testid="create-key">{busy ? t("generating") : t("create")}</Btn>
        {error && <p className="text-sm text-bad">{error}</p>}
      </form>
    </Card>
  );
}

function UnlockForm({ busy, error, address, onchain, onSubmit, onImport }: {
  busy: boolean; error: string; address: string; onchain: string | null; onSubmit: (pw: string) => void; onImport: (b: KeyBlob) => Promise<void>;
}) {
  const t = useTranslations("Key");
  const [pw, setPw] = useState("");
  const [recover, setRecover] = useState(false);
  return (
    <div className="space-y-4">
      <Card title={t("unlockTitle")}>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(pw); }} className="space-y-3">
          <Input type="password" autoComplete="current-password" placeholder={t("passwordPlaceholder")} value={pw} onChange={(e) => setPw(e.target.value)} data-testid="unlock-pw" />
          <Btn type="submit" disabled={busy || !pw} data-testid="unlock">{busy ? t("unlocking") : t("unlock")}</Btn>
          {error && <p className="text-sm text-bad">{error}</p>}
        </form>
        <button type="button" onClick={() => setRecover((r) => !r)} className="text-sm font-medium text-accent underline" data-testid="use-recovery">
          {recover ? t("hideRecovery") : t("forgot")}
        </button>
      </Card>
      {recover && (
        <ImportForm address={address} onchain={onchain} variant="password" onImport={async (b) => { await onImport(b); setRecover(false); }} />
      )}
    </div>
  );
}

function ImportForm({ address, onchain, mismatch = false, variant, onImport }: { address: string; onchain: string | null; mismatch?: boolean; variant?: "password"; onImport: (b: KeyBlob) => Promise<void> }) {
  const t = useTranslations("Key");
  const [error, setError] = useState("");
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setError("");
    try {
      const b = parseKeyBlob(await f.text());
      if (b.address.toLowerCase() !== address.toLowerCase()) throw new Error(t("wrongAccount"));
      if (onchain && b.publicKey.toLowerCase() !== onchain) throw new Error(t("wrongKey"));
      await onImport(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Card title={t("importTitle")}>
      <p className="text-sm text-ink-2">
        {variant === "password" ? t("importPassword") : mismatch ? t("importMismatch") : t("importNotStored")}
      </p>
      {variant === "password" && (
        <p className="text-xs text-muted">{t.rich("importNoFile", { link: (c) => <a href="/security#recovery" className="text-accent underline" target="_blank" rel="noreferrer">{c}</a> })}</p>
      )}
      <input type="file" accept="application/json,.json" data-testid="import-file" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
      {error && <p className="text-sm text-bad">{error}</p>}
    </Card>
  );
}

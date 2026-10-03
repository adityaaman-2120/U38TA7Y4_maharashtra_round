"use client";
import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi } from "@/lib/api";
import { useHeirloom } from "@/lib/hooks";
import { MIN_PASSWORD_LENGTH, downloadRecoveryFile, sealSecret, unlockKeyBlob } from "@/lib/keystore";
import { shortHash } from "@/lib/format";
import { Btn, Card, Input, Label, Mono } from "./ui";
import { useKey } from "./KeyProvider";
import { useMe, useSessionKey } from "./Session";

export default function AccountView() {
  return (
    <div className="space-y-4">
      <ProfileCard />
      <KeyCard />
      <PasswordCard />
    </div>
  );
}

function ProfileCard() {
  const me = useMe();
  const qc = useQueryClient();
  const key = useSessionKey();
  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState(me.email);
  const [phone, setPhone] = useState(me.phone);
  const save = useMutation({ mutationFn: () => authApi.updateMe({ name: name.trim(), email: email.trim(), phone: phone.trim() }), onSuccess: (m) => qc.setQueryData(key, m) });
  return (
    <Card title="Your details">
      <p className="text-sm text-muted">Stored on Heirloom&apos;s server only, never on the blockchain. Used for invitations and alerts.</p>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }} className="grid gap-4 sm:grid-cols-2">
        <Label text="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} data-testid="account-name" /></Label>
        <Label text="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="account-email" /></Label>
        <Label text="Phone (optional)"><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Label>
        <div className="flex items-end gap-3">
          <Btn type="submit" disabled={save.isPending || !name.trim() || !email.trim()} data-testid="account-save">{save.isPending ? "Saving…" : "Save"}</Btn>
          {save.isSuccess && <span className="text-sm text-ok">Saved</span>}
        </div>
        {save.isError && <p className="text-sm text-bad sm:col-span-2">{(save.error as Error).message}</p>}
      </form>
    </Card>
  );
}

function KeyCard() {
  const { address } = useHeirloom();
  const key = useKey();
  return (
    <Card title="Your encryption key">
      <p className="text-sm text-ink-2">
        This key lets guardians and your beneficiaries encrypt things to you. Its public half is registered on-chain; the private half is stored with your account only in encrypted form.
      </p>
      <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-muted">Wallet</dt><dd><Mono>{address}</Mono></dd>
        <dt className="text-muted">Public key</dt><dd><Mono data-testid="account-pubkey">{shortHash(key.publicKey, 14)}</Mono></dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Btn tone="ghost" onClick={() => downloadRecoveryFile(key.blob)} data-testid="account-download-recovery">Download recovery file</Btn>
        <Btn tone="ghost" onClick={key.lock}>Lock key</Btn>
      </div>
      <p className="text-xs text-muted">A recovery file opens with the password it was created with. If you ever lose your password, <a href="/security#recovery" className="text-accent underline" target="_blank" rel="noreferrer">here is exactly what you can and cannot do</a>.</p>
    </Card>
  );
}

function PasswordCard() {
  const key = useKey();
  const { address } = useHeirloom();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [done, setDone] = useState(false);
  const problem = next.length < MIN_PASSWORD_LENGTH ? `Use at least ${MIN_PASSWORD_LENGTH} characters` : next !== again ? "Passwords do not match" : next === current ? "Choose a different password" : "";

  const change = useMutation({
    mutationFn: async () => {
      // Prove we know the current password by opening the stored key with it, then re-seal the very same key.
      const secret = await unlockKeyBlob(key.blob, current);
      const blob = await sealSecret(address!, secret, key.blob.publicKey, next);
      await key.replaceBlob(blob);
      downloadRecoveryFile(blob);
    },
    onSuccess: () => { setDone(true); setCurrent(""); setNext(""); setAgain(""); },
  });
  return (
    <Card title="Change your encryption password">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (!problem && current) { setDone(false); change.mutate(); } }} className="space-y-3">
        <p className="text-sm text-muted">
          Re-seals the same key under a new password. Your files, shares and guardians are unaffected. A fresh recovery file downloads automatically; older recovery files still need the old password.
        </p>
        <Input type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} data-testid="pw-current" />
        <Input type="password" autoComplete="new-password" placeholder="New password" value={next} onChange={(e) => setNext(e.target.value)} data-testid="pw-new" />
        <Input type="password" autoComplete="new-password" placeholder="Repeat new password" value={again} onChange={(e) => setAgain(e.target.value)} data-testid="pw-again" />
        {next && problem && <p className="text-xs text-warn">{problem}</p>}
        <Btn type="submit" disabled={change.isPending || !current || Boolean(problem)} data-testid="pw-change">{change.isPending ? "Re-sealing…" : "Change password"}</Btn>
        {change.isError && <p className="text-sm text-bad" data-testid="pw-error">{(change.error as Error).message}</p>}
        {done && <p className="text-sm text-ok" data-testid="pw-done">Password changed. Keep the new recovery file somewhere safe.</p>}
      </form>
    </Card>
  );
}

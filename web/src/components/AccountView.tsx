"use client";
import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { alertsApi, authApi, type AlertSettings } from "@/lib/api";
import { useHeirloom } from "@/lib/hooks";
import { MIN_PASSWORD_LENGTH, downloadRecoveryFile, sealSecret, unlockKeyBlob } from "@/lib/keystore";
import { shortHash } from "@/lib/format";
import { Badge, Btn, Card, Input, Label, Mono } from "./ui";
import { useKey } from "./KeyProvider";
import { useMe, useSessionKey } from "./Session";
import { IdentityCard } from "./IdentityCard";

export default function AccountView() {
  return (
    <div className="space-y-4">
      <ProfileCard />
      <AlertsCard />
      <IdentityCard />
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
  const save = useMutation({ mutationFn: () => authApi.updateMe({ name: name.trim(), email: email.trim(), phone: phone.trim() }), onSuccess: (m) => { qc.setQueryData(key, m); qc.invalidateQueries({ queryKey: ["alert-settings"] }); } });
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

const KIND_LABEL: Record<string, string> = {
  owner_claim_raised: "Claim alert (email)",
  owner_claim_escalation: "Claim alert (text message)",
  guardian_challenge_ending: "Challenge ending (guardian)",
  verification: "Verification code",
};

function AlertsCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["alert-settings"], queryFn: alertsApi.get });
  const set = (s: AlertSettings) => qc.setQueryData(["alert-settings"], s);
  const save = useMutation({ mutationFn: alertsApi.save, onSuccess: set });
  const s = q.data;
  return (
    <Card title="Alerts">
      <p className="text-sm text-muted">
        If someone raises a claim on your vault, we email you a one-time link to cancel it with a single check-in. If you still have not checked in after 72 hours,
        we also send a text message. Guardians are warned 24 hours before a challenge period ends.
      </p>
      {q.isLoading && <p className="text-sm text-muted">Loading…</p>}
      {q.isError && <p className="text-sm text-bad">{(q.error as Error).message}</p>}
      {s && (
        <div className="space-y-5">
          <div className="space-y-2">
            <label className="flex items-start gap-2.5 text-sm text-ink-2">
              <input type="checkbox" className="mt-1" checked={s.email_enabled} disabled={save.isPending} data-testid="alerts-email"
                onChange={(e) => save.mutate({ email_enabled: e.target.checked, sms_enabled: s.sms_enabled })} />
              <span>Email alerts. Sent to the address in your details, even if it is not verified yet.</span>
            </label>
            <label className="flex items-start gap-2.5 text-sm text-ink-2">
              <input type="checkbox" className="mt-1" checked={s.sms_enabled} disabled={save.isPending || !s.phone_verified || !s.sms_available} data-testid="alerts-sms"
                onChange={(e) => save.mutate({ email_enabled: s.email_enabled, sms_enabled: e.target.checked })} />
              <span>
                Text-message alerts. Only sent to a verified phone number.
                {!s.sms_available && <b className="block text-warn"> Text messages are not set up on this server.</b>}
                {s.sms_available && !s.phone_verified && <b className="block text-muted"> Verify your phone below to turn this on.</b>}
              </span>
            </label>
            {!s.email_enabled && !s.sms_enabled && <p className="text-xs text-warn">Both channels are off: you will only see claims inside the app.</p>}
            {save.isError && <p className="text-sm text-bad" data-testid="alerts-error">{(save.error as Error).message}</p>}
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">Verify your contact details</h3>
            <Verify channel="email" label="Email" present={s.has_email} verified={s.email_verified} onDone={set} />
            <Verify channel="phone" label="Phone" present={s.has_phone} verified={s.phone_verified} disabled={!s.sms_available} onDone={set} />
            <p className="text-xs text-faint">Change your email or phone in &quot;Your details&quot; above; a changed contact has to be verified again.</p>
          </div>
          {s.recent.length > 0 && (
            <div className="space-y-1.5" data-testid="alerts-recent">
              <h3 className="text-sm font-semibold text-ink">Recent alerts</h3>
              <ul className="space-y-1 text-xs text-ink-2">
                {s.recent.map((a, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <Badge tone={a.status === "sent" ? "good" : "bad"}>{a.status}</Badge>
                    {KIND_LABEL[a.kind] ?? a.kind}{a.claim_id ? ` · claim #${a.claim_id}` : ""} · {new Date(a.at).toLocaleString()}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-faint">The log records what was sent and when, never your address or number or the message text.</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Verify({ channel, label, present, verified, disabled, onDone }: { channel: "email" | "phone"; label: string; present: boolean; verified: boolean; disabled?: boolean; onDone: (s: AlertSettings) => void }) {
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const start = useMutation({ mutationFn: () => alertsApi.start(channel), onSuccess: () => setSent(true) });
  const confirm = useMutation({ mutationFn: () => alertsApi.confirm(channel, code), onSuccess: (s) => { setSent(false); setCode(""); onDone(s); } });
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid={`verify-${channel}`}>
      <span className="w-14 font-medium text-ink">{label}</span>
      {!present ? <span className="text-muted">Not added yet</span> : verified ? <Badge tone="good">Verified</Badge> : <Badge tone="warn">Not verified</Badge>}
      {present && !verified && !sent && (
        <Btn tone="ghost" disabled={start.isPending || disabled} onClick={() => start.mutate()} data-testid={`verify-${channel}-send`}>{start.isPending ? "Sending…" : "Send code"}</Btn>
      )}
      {sent && (
        <>
          <Input value={code} inputMode="numeric" maxLength={6} placeholder="6-digit code" onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="!w-36" data-testid={`verify-${channel}-code`} />
          <Btn disabled={code.length !== 6 || confirm.isPending} onClick={() => confirm.mutate()} data-testid={`verify-${channel}-confirm`}>Verify</Btn>
        </>
      )}
      {(start.isError || confirm.isError) && <span className="w-full text-xs text-bad" data-testid={`verify-${channel}-error`}>{((start.error ?? confirm.error) as Error).message}</span>}
    </div>
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

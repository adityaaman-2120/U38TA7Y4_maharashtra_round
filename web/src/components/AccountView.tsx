"use client";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { alertsApi, authApi, type AlertSettings } from "@/lib/api";
import { useHeirloom } from "@/lib/hooks";
import { MIN_PASSWORD_LENGTH, downloadRecoveryFile, sealSecret, unlockKeyBlob } from "@/lib/keystore";
import { fmtTime, shortHash } from "@/lib/format";
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
  const t = useTranslations("Account");
  const me = useMe();
  const qc = useQueryClient();
  const key = useSessionKey();
  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState(me.email);
  const [phone, setPhone] = useState(me.phone);
  const save = useMutation({ mutationFn: () => authApi.updateMe({ name: name.trim(), email: email.trim(), phone: phone.trim() }), onSuccess: (m) => { qc.setQueryData(key, m); qc.invalidateQueries({ queryKey: ["alert-settings"] }); } });
  return (
    <Card title={t("profileTitle")}>
      <p className="text-sm text-muted">{t("profileIntro")}</p>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }} className="grid gap-4 sm:grid-cols-2">
        <Label text={t("name")}><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} data-testid="account-name" /></Label>
        <Label text={t("email")}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="account-email" /></Label>
        <Label text={t("phone")}><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Label>
        <div className="flex items-end gap-3">
          <Btn type="submit" disabled={save.isPending || !name.trim() || !email.trim()} data-testid="account-save">{save.isPending ? t("saving") : t("save")}</Btn>
          {save.isSuccess && <span className="text-sm text-ok">{t("saved")}</span>}
        </div>
        {save.isError && <p className="text-sm text-bad sm:col-span-2">{(save.error as Error).message}</p>}
      </form>
    </Card>
  );
}

const KIND_KEYS = ["owner_claim_raised", "owner_claim_escalation", "guardian_challenge_ending", "verification"];

function AlertsCard() {
  const t = useTranslations("Alerts");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["alert-settings"], queryFn: alertsApi.get });
  const set = (s: AlertSettings) => qc.setQueryData(["alert-settings"], s);
  const save = useMutation({ mutationFn: alertsApi.save, onSuccess: set });
  const s = q.data;
  return (
    <Card title={t("title")}>
      <p className="text-sm text-muted">{t("intro")}</p>
      {q.isLoading && <p className="text-sm text-muted">{t("loading")}</p>}
      {q.isError && <p className="text-sm text-bad">{(q.error as Error).message}</p>}
      {s && (
        <div className="space-y-5">
          <div className="space-y-2">
            <label className="flex items-start gap-2.5 text-sm text-ink-2">
              <input type="checkbox" className="mt-1" checked={s.email_enabled} disabled={save.isPending} data-testid="alerts-email"
                onChange={(e) => save.mutate({ email_enabled: e.target.checked, sms_enabled: s.sms_enabled })} />
              <span>{t("emailOption")}</span>
            </label>
            <label className="flex items-start gap-2.5 text-sm text-ink-2">
              <input type="checkbox" className="mt-1" checked={s.sms_enabled} disabled={save.isPending || !s.phone_verified || !s.sms_available} data-testid="alerts-sms"
                onChange={(e) => save.mutate({ email_enabled: s.email_enabled, sms_enabled: e.target.checked })} />
              <span>
                {t("smsOption")}
                {!s.sms_available && <b className="block text-warn"> {t("smsUnavailable")}</b>}
                {s.sms_available && !s.phone_verified && <b className="block text-muted"> {t("smsNeedsVerify")}</b>}
              </span>
            </label>
            {!s.email_enabled && !s.sms_enabled && <p className="text-xs text-warn">{t("bothOff")}</p>}
            {save.isError && <p className="text-sm text-bad" data-testid="alerts-error">{(save.error as Error).message}</p>}
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">{t("verifyHeading")}</h3>
            <Verify channel="email" label={t("rowEmail")} present={s.has_email} verified={s.email_verified} onDone={set} />
            <Verify channel="phone" label={t("rowPhone")} present={s.has_phone} verified={s.phone_verified} disabled={!s.sms_available} onDone={set} />
            <p className="text-xs text-faint">{t("changeNote")}</p>
          </div>
          {s.recent.length > 0 && (
            <div className="space-y-1.5" data-testid="alerts-recent">
              <h3 className="text-sm font-semibold text-ink">{t("recentTitle")}</h3>
              <ul className="space-y-1 text-xs text-ink-2">
                {s.recent.map((a, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <Badge tone={a.status === "sent" ? "good" : "bad"}>{t(`status.${a.status}`)}</Badge>
                    {KIND_KEYS.includes(a.kind) ? t(`kind.${a.kind}` as "kind.verification") : a.kind}{a.claim_id ? ` · ${t("claimNo", { id: a.claim_id })}` : ""} · {fmtTime(Date.parse(a.at) / 1000)}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-faint">{t("recentNote")}</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Verify({ channel, label, present, verified, disabled, onDone }: { channel: "email" | "phone"; label: string; present: boolean; verified: boolean; disabled?: boolean; onDone: (s: AlertSettings) => void }) {
  const t = useTranslations("Alerts");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const start = useMutation({ mutationFn: () => alertsApi.start(channel), onSuccess: () => setSent(true) });
  const confirm = useMutation({ mutationFn: () => alertsApi.confirm(channel, code), onSuccess: (s) => { setSent(false); setCode(""); onDone(s); } });
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid={`verify-${channel}`}>
      <span className="w-14 font-medium text-ink">{label}</span>
      {!present ? <span className="text-muted">{t("notAdded")}</span> : verified ? <Badge tone="good">{t("verified")}</Badge> : <Badge tone="warn">{t("notVerified")}</Badge>}
      {present && !verified && !sent && (
        <Btn tone="ghost" disabled={start.isPending || disabled} onClick={() => start.mutate()} data-testid={`verify-${channel}-send`}>{start.isPending ? t("sending") : t("sendCode")}</Btn>
      )}
      {sent && (
        <>
          <Input value={code} inputMode="numeric" maxLength={6} placeholder={t("codePlaceholder")} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="!w-36" data-testid={`verify-${channel}-code`} />
          <Btn disabled={code.length !== 6 || confirm.isPending} onClick={() => confirm.mutate()} data-testid={`verify-${channel}-confirm`}>{t("verify")}</Btn>
        </>
      )}
      {(start.isError || confirm.isError) && <span className="w-full text-xs text-bad" data-testid={`verify-${channel}-error`}>{((start.error ?? confirm.error) as Error).message}</span>}
    </div>
  );
}

function KeyCard() {
  const t = useTranslations("Account");
  const { address } = useHeirloom();
  const key = useKey();
  return (
    <Card title={t("keyTitle")}>
      <p className="text-sm text-ink-2">{t("keyBody")}</p>
      <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-muted">{t("wallet")}</dt><dd><Mono>{address}</Mono></dd>
        <dt className="text-muted">{t("publicKey")}</dt><dd><Mono data-testid="account-pubkey">{shortHash(key.publicKey, 14)}</Mono></dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Btn tone="ghost" onClick={() => downloadRecoveryFile(key.blob)} data-testid="account-download-recovery">{t("downloadRecovery")}</Btn>
        <Btn tone="ghost" onClick={key.lock}>{t("lockKey")}</Btn>
      </div>
      <p className="text-xs text-muted">{t.rich("recoveryNote", { link: (c) => <a href="/security#recovery" className="text-accent underline" target="_blank" rel="noreferrer">{c}</a> })}</p>
    </Card>
  );
}

function PasswordCard() {
  const t = useTranslations("Account");
  const key = useKey();
  const { address } = useHeirloom();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [done, setDone] = useState(false);
  const problem = next.length < MIN_PASSWORD_LENGTH ? t("tooShort", { min: MIN_PASSWORD_LENGTH }) : next !== again ? t("mismatch") : next === current ? t("sameAsOld") : "";

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
    <Card title={t("passwordTitle")}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (!problem && current) { setDone(false); change.mutate(); } }} className="space-y-3">
        <p className="text-sm text-muted">{t("passwordBody")}</p>
        <Input type="password" autoComplete="current-password" placeholder={t("currentPlaceholder")} value={current} onChange={(e) => setCurrent(e.target.value)} data-testid="pw-current" />
        <Input type="password" autoComplete="new-password" placeholder={t("newPlaceholder")} value={next} onChange={(e) => setNext(e.target.value)} data-testid="pw-new" />
        <Input type="password" autoComplete="new-password" placeholder={t("againPlaceholder")} value={again} onChange={(e) => setAgain(e.target.value)} data-testid="pw-again" />
        {next && problem && <p className="text-xs text-warn">{problem}</p>}
        <Btn type="submit" disabled={change.isPending || !current || Boolean(problem)} data-testid="pw-change">{change.isPending ? t("resealing") : t("change")}</Btn>
        {change.isError && <p className="text-sm text-bad" data-testid="pw-error">{(change.error as Error).message}</p>}
        {done && <p className="text-sm text-ok" data-testid="pw-done">{t("changed")}</p>}
      </form>
    </Card>
  );
}

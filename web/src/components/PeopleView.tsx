"use client";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { inviteApi, type Invite, type InviteStatus, type Role } from "@/lib/api";
import { fmtTime, shortAddr } from "@/lib/format";
import { Badge, Btn, Card, EmptyState, Input, Label, ListSkeleton, Select, Stat, StatGrid } from "./ui";
import { useVerifiedMap } from "@/lib/identity";
import { VerifiedBadge } from "./VerifiedBadge";

const TONE: Record<InviteStatus, "good" | "warn" | "bad" | "info"> = { accepted: "good", pending: "warn", expired: "bad", revoked: "info" };

export default function PeopleView() {
  const t = useTranslations("People");
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["invites"], queryFn: inviteApi.list, refetchInterval: 10000 });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["invites"] }), qc.invalidateQueries({ queryKey: ["contacts"] })]);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string; link?: string } | null>(null);

  const visible = (list.data ?? []).filter((i) => i.status !== "revoked");
  const ver = useVerifiedMap(visible.map((i) => i.invitee?.address ?? ""));
  const count = (s: InviteStatus) => visible.filter((i) => i.status === s).length;

  return (
    <div className="space-y-4">
      <StatGrid>
        <Stat label={t("statAccepted")} value={list.isLoading ? "…" : count("accepted")} tone="good" />
        <Stat label={t("statWaiting")} value={list.isLoading ? "…" : count("pending")} tone={count("pending") ? "warn" : "info"} />
        <Stat label={t("statExpired")} value={list.isLoading ? "…" : count("expired")} tone={count("expired") ? "bad" : "info"} />
      </StatGrid>

      <InviteForm onDone={(n) => { setNotice(n); refresh(); }} />
      {notice && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${notice.tone === "ok" ? "border-ok/30 bg-ok-soft text-ok" : "border-warn/30 bg-warn-soft text-warn"}`} data-testid="invite-notice">
          <p>{notice.text}</p>
          {notice.link && (
            <p className="mt-1 break-all text-xs text-ink-2">
              {t("devLink")} <a href={notice.link} className="underline" data-testid="dev-link">{notice.link}</a>
            </p>
          )}
        </div>
      )}

      <Card title={t("circleTitle")}>
        <p className="text-sm text-muted">{t("circleIntro")}</p>
        {list.isLoading ? <ListSkeleton rows={2} /> : list.isError ? <p className="text-sm text-bad">{(list.error as Error).message}</p> : visible.length === 0 ? (
          <EmptyState title={t("emptyTitle")} hint={t("emptyHint")} />
        ) : (
          <ul className="divide-y divide-line" data-testid="invite-list">
            {visible.map((i) => <InviteRow key={i.id} invite={i} verified={i.invitee ? ver.isVerified(i.invitee.address) : false} showVerified={ver.enabled} onChange={refresh} onNotice={setNotice} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}

function InviteForm({ onDone }: { onDone: (n: { tone: "ok" | "warn"; text: string; link?: string }) => void }) {
  const t = useTranslations("People");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("guardian");
  const create = useMutation({
    mutationFn: () => inviteApi.create({ email: email.trim(), role, name: name.trim() }),
    onSuccess: (inv) => {
      onDone(inv.email_sent
        ? { tone: "ok", text: t("emailed", { email: inv.email }), link: inv.link }
        : { tone: "warn", text: t("emailFailed", { email: inv.email }), link: inv.link });
      setEmail("");
      setName("");
    },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (email.trim()) create.mutate(); };
  return (
    <Card title={t("inviteTitle")}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Label text={t("theirEmail")}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("emailPlaceholder")} data-testid="invite-email" /></Label>
          <Label text={t("theirName")}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} maxLength={80} data-testid="invite-name" /></Label>
        </div>
        <Label text={t("role")}>
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)} data-testid="invite-role">
            <option value="guardian">{t("roleGuardianOption")}</option>
            <option value="beneficiary">{t("roleBeneficiaryOption")}</option>
          </Select>
        </Label>
        <Btn type="submit" disabled={create.isPending || !email.trim()} data-testid="invite-send">{create.isPending ? t("sending") : t("send")}</Btn>
        {create.isError && <p className="text-sm text-bad">{(create.error as Error).message}</p>}
      </form>
    </Card>
  );
}

function InviteRow({ invite, verified, showVerified, onChange, onNotice }: { invite: Invite; verified: boolean; showVerified: boolean; onChange: () => void; onNotice: (n: { tone: "ok" | "warn"; text: string; link?: string }) => void }) {
  const t = useTranslations("People");
  const resend = useMutation({
    mutationFn: () => inviteApi.resend(invite.id),
    onSuccess: (inv) => {
      onNotice(inv.email_sent ? { tone: "ok", text: t("resent", { email: inv.email }), link: inv.link } : { tone: "warn", text: t("resendFailed"), link: inv.link });
      onChange();
    },
  });
  const revoke = useMutation({ mutationFn: () => inviteApi.revoke(invite.id), onSuccess: onChange });
  const err = (resend.error ?? revoke.error) as Error | null;
  const accepted = invite.status === "accepted";

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="invite-row">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
          {invite.invitee?.name || invite.name || invite.email}
          <Badge tone={TONE[invite.status]}>{t(`status.${invite.status}`)}</Badge>
          {invite.status === "accepted" && showVerified && <VerifiedBadge verified={verified} />}
          <span className="text-xs font-normal text-muted">{invite.role === "guardian" ? t("roleGuardian") : t("roleBeneficiary")}</span>
        </p>
        <p className="mt-0.5 break-all text-xs text-muted">
          {invite.email}
          {accepted && invite.invitee ? ` · ${shortAddr(invite.invitee.address)} · ${t("accepted", { time: fmtTime(Date.parse(invite.accepted_at!) / 1000) })}` : ` · ${t("expires", { time: fmtTime(Date.parse(invite.expires_at) / 1000) })}`}
        </p>
        {err && <p className="mt-1 text-xs text-bad">{err.message}</p>}
      </div>
      <div className="flex gap-2">
        {!accepted && <Btn tone="ghost" disabled={resend.isPending} onClick={() => resend.mutate()} data-testid="invite-resend">{t("resend")}</Btn>}
        <Btn tone="ghost" disabled={revoke.isPending} onClick={() => { if (!accepted || confirm(t("confirmRemove"))) revoke.mutate(); }} data-testid="invite-revoke">
          {accepted ? t("remove") : t("revoke")}
        </Btn>
      </div>
    </li>
  );
}

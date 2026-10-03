"use client";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { inviteApi, type Invite, type InviteStatus, type Role } from "@/lib/api";
import { fmtTime, shortAddr } from "@/lib/format";
import { Badge, Btn, Card, EmptyState, Input, Label, ListSkeleton, Select, Stat, StatGrid } from "./ui";
import { useVerifiedMap } from "@/lib/identity";
import { VerifiedBadge } from "./VerifiedBadge";

const TONE: Record<InviteStatus, "good" | "warn" | "bad" | "info"> = { accepted: "good", pending: "warn", expired: "bad", revoked: "info" };
const ROLE_LABEL: Record<Role, string> = { guardian: "Guardian", beneficiary: "Beneficiary" };

export default function PeopleView() {
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
        <Stat label="Accepted" value={list.isLoading ? "…" : count("accepted")} tone="good" />
        <Stat label="Waiting for a reply" value={list.isLoading ? "…" : count("pending")} tone={count("pending") ? "warn" : "info"} />
        <Stat label="Expired" value={list.isLoading ? "…" : count("expired")} tone={count("expired") ? "bad" : "info"} />
      </StatGrid>

      <InviteForm onDone={(n) => { setNotice(n); refresh(); }} />
      {notice && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${notice.tone === "ok" ? "border-ok/30 bg-ok-soft text-ok" : "border-warn/30 bg-warn-soft text-warn"}`} data-testid="invite-notice">
          <p>{notice.text}</p>
          {notice.link && (
            <p className="mt-1 break-all text-xs text-ink-2">
              Development link: <a href={notice.link} className="underline" data-testid="dev-link">{notice.link}</a>
            </p>
          )}
        </div>
      )}

      <Card title="Your circle">
        <p className="text-sm text-muted">Only people who have accepted an invitation can be chosen as guardians or beneficiaries.</p>
        {list.isLoading ? <ListSkeleton rows={2} /> : list.isError ? <p className="text-sm text-bad">{(list.error as Error).message}</p> : visible.length === 0 ? (
          <EmptyState title="Nobody here yet" hint="Invite the people you trust by email. They sign in, set up their key and accept, and then you can choose them." />
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
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("guardian");
  const create = useMutation({
    mutationFn: () => inviteApi.create({ email: email.trim(), role, name: name.trim() }),
    onSuccess: (inv) => {
      onDone(inv.email_sent
        ? { tone: "ok", text: `Invitation emailed to ${inv.email}.`, link: inv.link }
        : { tone: "warn", text: `Invitation saved, but the email could not be sent to ${inv.email}. Use Resend to try again.`, link: inv.link });
      setEmail("");
      setName("");
    },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (email.trim()) create.mutate(); };
  return (
    <Card title="Invite someone">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Label text="Their email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" data-testid="invite-email" /></Label>
          <Label text="Their name (for you)"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aunt Meera" maxLength={80} data-testid="invite-name" /></Label>
        </div>
        <Label text="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)} data-testid="invite-role">
            <option value="guardian">Guardian: holds a piece of the key and reviews claims</option>
            <option value="beneficiary">Beneficiary: receives a file</option>
          </Select>
        </Label>
        <Btn type="submit" disabled={create.isPending || !email.trim()} data-testid="invite-send">{create.isPending ? "Sending…" : "Send invitation"}</Btn>
        {create.isError && <p className="text-sm text-bad">{(create.error as Error).message}</p>}
      </form>
    </Card>
  );
}

function InviteRow({ invite, verified, showVerified, onChange, onNotice }: { invite: Invite; verified: boolean; showVerified: boolean; onChange: () => void; onNotice: (n: { tone: "ok" | "warn"; text: string; link?: string }) => void }) {
  const resend = useMutation({
    mutationFn: () => inviteApi.resend(invite.id),
    onSuccess: (inv) => {
      onNotice(inv.email_sent ? { tone: "ok", text: `Invitation re-sent to ${inv.email}.`, link: inv.link } : { tone: "warn", text: "The email could not be sent.", link: inv.link });
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
          <Badge tone={TONE[invite.status]}>{invite.status}</Badge>
          {invite.status === "accepted" && showVerified && <VerifiedBadge verified={verified} />}
          <span className="text-xs font-normal text-muted">{ROLE_LABEL[invite.role]}</span>
        </p>
        <p className="mt-0.5 break-all text-xs text-muted">
          {invite.email}
          {accepted && invite.invitee ? ` · ${shortAddr(invite.invitee.address)} · accepted ${fmtTime(Date.parse(invite.accepted_at!) / 1000)}` : ` · expires ${fmtTime(Date.parse(invite.expires_at) / 1000)}`}
        </p>
        {err && <p className="mt-1 text-xs text-bad">{err.message}</p>}
      </div>
      <div className="flex gap-2">
        {!accepted && <Btn tone="ghost" disabled={resend.isPending} onClick={() => resend.mutate()} data-testid="invite-resend">Resend</Btn>}
        <Btn tone="ghost" disabled={revoke.isPending} onClick={() => { if (!accepted || confirm("Remove this person from your circle? Anything already on-chain stays as it is.")) revoke.mutate(); }} data-testid="invite-revoke">
          {accepted ? "Remove" : "Revoke"}
        </Btn>
      </div>
    </li>
  );
}

"use client";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { inviteApi } from "@/lib/api";
import { Btn, Card } from "./ui";
import { Shell } from "./App";
import { useMe } from "./Session";

const ROLE_COPY = {
  guardian: "a guardian. You will hold one encrypted piece of their key and review any claim on their vault. You can never open their files alone.",
  beneficiary: "a beneficiary. They are reserving files for you. You will see that they exist, never what they contain, until the guardians release them.",
} as const;

/** The page behind the emailed link: shows who invited you, then runs the normal sign-up gates before accepting. */
export default function InviteFlow({ token }: { token: string }) {
  const preview = useQuery({ queryKey: ["invite-preview", token], queryFn: () => inviteApi.preview(token), retry: false });

  if (preview.isLoading) return <Frame><p className="text-muted">Checking your invitation…</p></Frame>;
  if (preview.isError || !preview.data) {
    return (
      <Frame>
        <h1 className="font-display text-4xl leading-tight text-ink">This invitation isn&apos;t valid</h1>
        <p className="mt-3 text-ink-2">It may have expired, been withdrawn, or already been used. Ask the person who invited you to send a new one.</p>
        <p className="mt-5"><Link href="/" className="text-sm text-accent underline">Back to Heirloom</Link></p>
      </Frame>
    );
  }
  const { inviter, role, email } = preview.data;
  return (
    <Shell
      prefillEmail={email}
      banner={
        <div className="mx-auto mb-6 max-w-xl rounded-xl border border-brass/30 bg-brass-soft px-4 py-3 text-sm text-ink" data-testid="invite-banner">
          <b>{inviter}</b> invited you to be {role === "guardian" ? "a guardian" : "a beneficiary"} on Heirloom. Sign in below to accept.
        </div>
      }
    >
      <Accept token={token} inviter={inviter} role={role} />
    </Shell>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">{children}</div>;
}

function Accept({ token, inviter, role }: { token: string; inviter: string; role: keyof typeof ROLE_COPY }) {
  const me = useMe();
  const accept = useMutation({ mutationFn: () => inviteApi.accept(token) });

  if (accept.isSuccess) {
    return (
      <div className="mx-auto max-w-xl">
        <Card title="You&apos;re in">
          <p className="text-ink-2" data-testid="accepted">You accepted {inviter}&apos;s invitation. When they add you on-chain, it will appear in your dashboard automatically.</p>
          <Link href="/app" className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover" data-testid="open-dashboard">Open my dashboard</Link>
        </Card>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-xl">
      <Card title="Accept the invitation">
        <p className="text-ink-2">
          <b>{inviter}</b> invited you to be {ROLE_COPY[role]}
        </p>
        <p className="text-xs text-muted">Accepting as {me.name} ({me.email}).</p>
        <Btn onClick={() => accept.mutate()} disabled={accept.isPending} data-testid="accept-invite">{accept.isPending ? "Accepting…" : "Accept invitation"}</Btn>
        {accept.isError && <p className="text-sm text-bad" data-testid="accept-error">{(accept.error as Error).message}</p>}
      </Card>
    </div>
  );
}

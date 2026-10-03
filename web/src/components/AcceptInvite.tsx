"use client";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { inviteApi } from "@/lib/api";
import { Btn, Card } from "./ui";
import { Shell } from "./App";
import { useMe } from "./Session";

/** The page behind the emailed link: shows who invited you, then runs the normal sign-up gates before accepting. */
export default function InviteFlow({ token }: { token: string }) {
  const t = useTranslations("Invite");
  const preview = useQuery({ queryKey: ["invite-preview", token], queryFn: () => inviteApi.preview(token), retry: false });

  if (preview.isLoading) return <Frame><p className="text-muted">{t("checking")}</p></Frame>;
  if (preview.isError || !preview.data) {
    return (
      <Frame>
        <h1 className="font-display text-4xl leading-tight text-ink">{t("invalidTitle")}</h1>
        <p className="mt-3 text-ink-2">{t("invalidBody")}</p>
        <p className="mt-5"><Link href="/" className="text-sm text-accent underline">{t("backHome")}</Link></p>
      </Frame>
    );
  }
  const { inviter, role, email } = preview.data;
  return (
    <Shell
      prefillEmail={email}
      banner={
        <div className="mx-auto mb-6 max-w-xl rounded-xl border border-brass/30 bg-brass-soft px-4 py-3 text-sm text-ink" data-testid="invite-banner">
          {t.rich(role === "guardian" ? "bannerGuardian" : "bannerBeneficiary", { inviter, b: (c) => <b>{c}</b> })}
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

function Accept({ token, inviter, role }: { token: string; inviter: string; role: "guardian" | "beneficiary" }) {
  const t = useTranslations("Invite");
  const me = useMe();
  const accept = useMutation({ mutationFn: () => inviteApi.accept(token) });

  if (accept.isSuccess) {
    return (
      <div className="mx-auto max-w-xl">
        <Card title={t("inTitle")}>
          <p className="text-ink-2" data-testid="accepted">{t("accepted", { inviter })}</p>
          <Link href="/app" className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover" data-testid="open-dashboard">{t("openDashboard")}</Link>
        </Card>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-xl">
      <Card title={t("acceptTitle")}>
        <p className="text-ink-2">{t.rich(role === "guardian" ? "copyGuardian" : "copyBeneficiary", { inviter, b: (c) => <b>{c}</b> })}</p>
        <p className="text-xs text-muted">{t("acceptingAs", { name: me.name, email: me.email })}</p>
        <Btn onClick={() => accept.mutate()} disabled={accept.isPending} data-testid="accept-invite">{accept.isPending ? t("accepting") : t("accept")}</Btn>
        {accept.isError && <p className="text-sm text-bad" data-testid="accept-error">{(accept.error as Error).message}</p>}
      </Card>
    </div>
  );
}

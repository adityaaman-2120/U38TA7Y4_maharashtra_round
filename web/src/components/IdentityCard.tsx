"use client";
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useHeirloom } from "@/lib/hooks";
import { useMyIdentity, useVerifyIdentity } from "@/lib/identity";
import { readers } from "@/lib/hooks";
import { shortHash } from "@/lib/format";
import { Btn, Card, ListSkeleton } from "./ui";
import { VerifiedBadge } from "./VerifiedBadge";
import { ZkProofPanel } from "./ZkProofPanel";

/** Verify-identity flow. `onDone` runs after the proof is on-chain. */
export function VerifyIdentity({ onDone, onCancel }: { onDone?: () => void; onCancel?: () => void }) {
  const t = useTranslations("Identity");
  const { address, publicClient, deployment } = useHeirloom();
  const verify = useVerifyIdentity();
  return (
    <ZkProofPanel
      title={t("verifyTitle")}
      intro={t("intro")}
      actionLabel={t("generateAndVerify")}
      signal={() => readers.signal(publicClient!, deployment!.address, "identitySignal", [address])}
      onProof={async (proof) => {
        if (await verify(proof)) onDone?.();
        else throw new Error(t("verifyFailed"));
      }}
      onCancel={onCancel}
    />
  );
}

/** Account page: current state, and a way to verify. */
export function IdentityCard() {
  const t = useTranslations("Identity");
  const id = useMyIdentity();
  const [open, setOpen] = useState(false);
  if (!id.enabled) {
    return (
      <Card title={t("cardTitle")}>
        <p className="text-sm text-muted">{t("disabled")}</p>
      </Card>
    );
  }
  if (id.loading) return <ListSkeleton rows={1} />;
  if (id.verified) {
    return (
      <Card title={t("cardTitle")} right={<VerifiedBadge verified />}>
        <p className="text-sm text-ink-2">{t("verifiedLine")}</p>
        <p className="break-all font-mono text-xs text-muted" data-testid="my-nullifier">{shortHash("0x" + id.nullifier.toString(16), 12)}</p>
        <p className="text-xs text-muted">{t("nullifierNote")}</p>
      </Card>
    );
  }
  if (open) return <VerifyIdentity onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />;
  return (
    <Card title={t("cardTitle")} right={<VerifiedBadge verified={false} />}>
      <p className="text-sm text-ink-2">{t("intro")}</p>
      <Btn onClick={() => setOpen(true)} data-testid="start-verify">{t("startVerify")}</Btn>
    </Card>
  );
}

const skipKey = (a: string) => `heirloom:v1:id-skip:${a.toLowerCase()}`;
const wasSkipped = (a: string) => {
  try { return localStorage.getItem(skipKey(a)) === "1"; } catch { return false; }
};

/** Optional onboarding step between setting up the key and using the app. Never blocks: "Skip for now" always works. */
export function IdentityGate({ children }: { children: ReactNode }) {
  const t = useTranslations("Identity");
  const { address } = useHeirloom();
  const id = useMyIdentity();
  const [skipped, setSkipped] = useState(() => (address ? wasSkipped(address) : false));
  if (!id.enabled || skipped || (address && wasSkipped(address))) return <>{children}</>;
  if (id.loading) return <ListSkeleton rows={2} />;
  if (id.verified) return <>{children}</>;

  const skip = () => {
    try { if (address) localStorage.setItem(skipKey(address), "1"); } catch { /* storage unavailable */ }
    setSkipped(true);
  };
  return (
    <div className="mx-auto max-w-xl space-y-4" data-testid="identity-step">
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-brass">{t("optionalStep")}</p>
        <h1 className="font-display text-4xl leading-tight text-ink">{t("stepHeading")}</h1>
      </div>
      <VerifyIdentity onDone={() => undefined} />
      <button onClick={skip} className="text-sm font-medium text-muted underline" data-testid="skip-identity">{t("skip")}</button>
    </div>
  );
}

"use client";
import { useState, type ReactNode } from "react";
import { useHeirloom } from "@/lib/hooks";
import { useMyIdentity, useVerifyIdentity } from "@/lib/identity";
import { readers } from "@/lib/hooks";
import { shortHash } from "@/lib/format";
import { Btn, Card, ListSkeleton } from "./ui";
import { VerifiedBadge } from "./VerifiedBadge";
import { ZkProofPanel } from "./ZkProofPanel";

const INTRO =
  "Prove you are one real Aadhaar holder without showing your Aadhaar. Owners can then choose to require verified guardians, and verified beneficiaries, so one person cannot pose as several.";

/** Verify-identity flow. `onDone` runs after the proof is on-chain. */
export function VerifyIdentity({ onDone, onCancel }: { onDone?: () => void; onCancel?: () => void }) {
  const { address, publicClient, deployment } = useHeirloom();
  const verify = useVerifyIdentity();
  return (
    <ZkProofPanel
      title="Verify your identity (zero-knowledge)"
      intro={INTRO}
      actionLabel="Generate proof and verify"
      signal={() => readers.signal(publicClient!, deployment!.address, "identitySignal", [address])}
      onProof={async (proof) => {
        if (await verify(proof)) onDone?.();
        else throw new Error("The verification transaction did not go through.");
      }}
      onCancel={onCancel}
    />
  );
}

/** Account page: current state, and a way to verify. */
export function IdentityCard() {
  const id = useMyIdentity();
  const [open, setOpen] = useState(false);
  if (!id.enabled) {
    return (
      <Card title="Identity verification">
        <p className="text-sm text-muted">This deployment has no identity verifier, so verification is not available.</p>
      </Card>
    );
  }
  if (id.loading) return <ListSkeleton rows={1} />;
  if (id.verified) {
    return (
      <Card title="Identity verification" right={<VerifiedBadge verified />}>
        <p className="text-sm text-ink-2">You are verified. Your pseudonymous id on Heirloom:</p>
        <p className="break-all font-mono text-xs text-muted" data-testid="my-nullifier">{shortHash("0x" + id.nullifier.toString(16), 12)}</p>
        <p className="text-xs text-muted">It is public, but it is derived for Heirloom only and reveals nothing about your Aadhaar.</p>
      </Card>
    );
  }
  if (open) return <VerifyIdentity onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />;
  return (
    <Card title="Identity verification" right={<VerifiedBadge verified={false} />}>
      <p className="text-sm text-ink-2">{INTRO}</p>
      <Btn onClick={() => setOpen(true)} data-testid="start-verify">Verify identity (zero-knowledge)</Btn>
    </Card>
  );
}

const skipKey = (a: string) => `heirloom:v1:id-skip:${a.toLowerCase()}`;
const wasSkipped = (a: string) => {
  try { return localStorage.getItem(skipKey(a)) === "1"; } catch { return false; }
};

/** Optional onboarding step between setting up the key and using the app. Never blocks: "Skip for now" always works. */
export function IdentityGate({ children }: { children: ReactNode }) {
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
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-brass">Optional step</p>
        <h1 className="font-display text-4xl leading-tight text-ink">Prove you&apos;re a real person.</h1>
      </div>
      <VerifyIdentity onDone={() => undefined} />
      <button onClick={skip} className="text-sm font-medium text-muted underline" data-testid="skip-identity">Skip for now (you can verify later from Account)</button>
    </div>
  );
}

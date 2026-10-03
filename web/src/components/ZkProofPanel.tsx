"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useHeirloom } from "@/lib/hooks";
import { modeProblem, sdkMode, mockProverActive, zkDeployment } from "@/lib/zk/config";
import { generateProof, stageText, readQrImage, type ZkProof } from "@/lib/zk/proof";
import { Btn, Card, Input, Label } from "./ui";

/**
 * Collects the Aadhaar QR (read locally), generates a proof bound to `signal`, and hands the proof to `onProof`.
 * Used for: verifying an identity, raising a claim as the beneficiary, and proving the beneficiary is over 18.
 */
export function ZkProofPanel({ title, intro, signal, revealAge = false, actionLabel, onProof, onCancel }: {
  title: string;
  intro: string;
  /** Reads the contract-derived signal at the moment of proving, so it always reflects current chain state. */
  signal: () => Promise<bigint>;
  revealAge?: boolean;
  actionLabel: string;
  onProof: (proof: ZkProof) => Promise<void>;
  onCancel?: () => void;
}) {
  const t = useTranslations("ZkPanel");
  const { chainId, publicClient } = useHeirloom();
  const z = zkDeployment(chainId);
  const mock = mockProverActive(chainId);
  const mode = sdkMode(chainId);
  const problem = modeProblem(chainId);
  const [file, setFile] = useState<File | null>(null);
  const [person, setPerson] = useState("");
  const [stage, setStage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ready = mock ? person.trim().length > 0 : Boolean(file);

  const run = async () => {
    if (!z || !chainId) return;
    setBusy(true);
    setError("");
    try {
      const input = mock ? person : await readQrImage(file!);
      const proof = await generateProof({
        chainId, signal: await signal(), nullifierSeed: z.nullifierSeed, revealAge, input, publicClient,
        mockVerifier: z.verifier as `0x${string}`, onStage: (s) => setStage(stageText(s)),
      });
      setStage(t("proofReady"));
      await onProof(proof);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStage("");
    }
  };

  return (
    <Card title={title}>
      <p className="text-sm text-ink-2">{intro}</p>
      <p className="rounded-lg bg-accent-soft px-3 py-2 text-xs text-ink-2" data-testid="zk-privacy">{t("privacy")}</p>
      {problem && <p className="text-sm text-bad" data-testid="zk-config-problem">{problem}</p>}
      {!mock && mode === "test" && (
        <p className="text-xs text-warn" data-testid="zk-test-mode">
          {t("testMode")}
        </p>
      )}
      {mock ? (
        <>
          <p className="text-xs text-warn" data-testid="zk-mock-mode">{t("mockMode")}</p>
          <Label text={t("personLabel")}><Input value={person} onChange={(e) => setPerson(e.target.value)} placeholder={t("personPlaceholder")} data-testid="zk-input" /></Label>
        </>
      ) : (
        <Label text={t("qrLabel")} hint={t("qrHint")}>
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="zk-input" className="text-sm" />
        </Label>
      )}
      {revealAge && <p className="text-xs text-muted">{t("ageNote")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Btn disabled={busy || !ready || Boolean(problem)} onClick={run} data-testid="zk-run">{busy ? t("working") : actionLabel}</Btn>
        {onCancel && <Btn tone="ghost" disabled={busy} onClick={onCancel}>{t("cancel")}</Btn>}
      </div>
      {stage && <p className="text-sm text-ink-2" data-testid="zk-stage" aria-live="polite">{stage}</p>}
      {error && <p className="text-sm text-bad" data-testid="zk-error">{error}</p>}
    </Card>
  );
}

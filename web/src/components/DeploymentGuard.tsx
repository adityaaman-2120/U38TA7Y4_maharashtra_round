"use client";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { heirloomAbi } from "@/lib/contract";
import { useHeirloom } from "@/lib/hooks";
import { CHAIN_LABELS } from "@/lib/wagmi";
import { Btn, Card, ListSkeleton } from "./ui";

type Health = "ok" | "unreachable" | "no-contract" | "wrong-contract";

/**
 * Before anything reads the contract, make sure there is a Heirloom contract at the address this app was built with.
 * Without this, a restarted local chain or a stale page makes every read fail and the app just spins.
 */
export function DeploymentGuard({ children }: { children: ReactNode }) {
  const t = useTranslations("Deployment");
  const { chainId, publicClient, deployment } = useHeirloom();

  const health = useQuery<Health>({
    queryKey: ["deployment-health", chainId, deployment?.address],
    enabled: Boolean(publicClient && deployment),
    retry: false,
    refetchInterval: 5000,
    queryFn: async () => {
      let code: string | undefined;
      try {
        code = await publicClient!.getCode({ address: deployment!.address });
      } catch {
        return "unreachable";
      }
      if (!code || code === "0x") return "no-contract";
      try {
        await publicClient!.readContract({ address: deployment!.address, abi: heirloomAbi, functionName: "claimCount" });
        return "ok";
      } catch {
        return "wrong-contract"; // code exists, but it is not this Heirloom (e.g. a different contract now sits at the address)
      }
    },
  });

  // The query resolves to a verdict instead of throwing, so its data persists between polls and the page never flickers.
  if (health.data === "ok") return <>{children}</>;
  if (health.data === undefined) return <ListSkeleton rows={2} />;

  const local = chainId === 31337;
  const where = chainId !== undefined ? CHAIN_LABELS[chainId] ?? t("chainFallback", { id: chainId }) : t("networkFallback");
  const code = (c: ReactNode) => <code className="font-mono text-xs">{c}</code>;
  const message =
    health.data === "unreachable"
      ? { title: t("unreachableTitle", { where }), body: local ? t("unreachableLocal") : t("unreachableRemote") }
      : { title: t("missingTitle", { where }), body: t(health.data === "no-contract" ? "missingBodyNothing" : "missingBodyOther", { address: deployment?.address ?? "" }) };

  return (
    <div className="mx-auto max-w-xl pt-6" data-testid="deployment-problem" data-state={health.data}>
      <Card title={message.title}>
        <p className="text-sm text-ink-2">{message.body}</p>
        {local ? (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
            <li>{t.rich("step1", { code })}</li>
            <li>{t.rich("step2", { code })}</li>
            <li>{t("step3")}</li>
          </ol>
        ) : (
          <p className="text-sm text-ink-2">{t.rich("outdated", { code })}</p>
        )}
        <div className="flex gap-2">
          <Btn onClick={() => health.refetch()} data-testid="deployment-retry">{t("checkAgain")}</Btn>
          <Btn tone="ghost" onClick={() => window.location.reload()}>{t("reload")}</Btn>
        </div>
      </Card>
    </div>
  );
}

"use client";
import type { ReactNode } from "react";
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
  const where = chainId !== undefined ? CHAIN_LABELS[chainId] ?? `chain ${chainId}` : "this network";
  const message =
    health.data === "unreachable"
      ? { title: `Can't reach ${where}`, body: local ? "The local chain isn't answering at http://127.0.0.1:8545." : "The network's RPC endpoint isn't answering. Check your connection and the RPC URL in the app's settings." }
      : { title: `Heirloom isn't on ${where} at the expected address`, body: `This page expects Heirloom at ${deployment?.address}, but ${health.data === "no-contract" ? "nothing is deployed there" : "a different contract is there"}.` };

  return (
    <div className="mx-auto max-w-xl pt-6" data-testid="deployment-problem" data-state={health.data}>
      <Card title={message.title}>
        <p className="text-sm text-ink-2">{message.body}</p>
        {local ? (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
            <li>Stop any old <code className="font-mono text-xs">npm run dev</code> terminals, then start it once: <code className="font-mono text-xs">npm run dev</code> from the project folder.</li>
            <li>Wait for <code className="font-mono text-xs">Heirloom deployed to …</code> in that terminal.</li>
            <li>Reload this page (Ctrl+Shift+R). A restarted local chain starts empty and gets a fresh deployment, so this page must be reloaded to pick up the new address.</li>
          </ol>
        ) : (
          <p className="text-sm text-ink-2">The deployment record in this build is out of date for this network. Redeploy, or rebuild the app with the current <code className="font-mono text-xs">contracts.ts</code>.</p>
        )}
        <div className="flex gap-2">
          <Btn onClick={() => health.refetch()} data-testid="deployment-retry">Check again</Btn>
          <Btn tone="ghost" onClick={() => window.location.reload()}>Reload page</Btn>
        </div>
      </Card>
    </div>
  );
}

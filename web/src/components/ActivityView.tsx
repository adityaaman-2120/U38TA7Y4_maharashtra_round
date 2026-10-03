"use client";
import { useQuery } from "@tanstack/react-query";
import { useEvents, useHeirloom } from "@/lib/hooks";
import { explorerTxUrl } from "@/lib/wagmi";
import { fmtTime, shortAddr, shortHash } from "@/lib/format";
import { Card, Empty } from "./ui";

const LIMIT = 100;

function describe(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}=[${v.length}]`;
      if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) return `${k}=${shortAddr(v)}`;
      if (typeof v === "string" && v.startsWith("0x")) return `${k}=${shortHash(v, 4)}`;
      return `${k}=${String(v)}`;
    })
    .join(" · ");
}

/** Audit trail straight from the contract's events: block, time, actor and tx for every state change. */
export default function ActivityView() {
  const { publicClient, chainId } = useHeirloom();
  const events = useEvents();
  const shown = [...(events.data ?? [])].reverse().slice(0, LIMIT);

  const meta = useQuery({
    queryKey: ["activity-meta", chainId, shown.map((e) => e.transactionHash).join(",")],
    enabled: Boolean(publicClient) && shown.length > 0,
    queryFn: async () => {
      const blocks = new Map<bigint, number>();
      const from = new Map<string, string>();
      await Promise.all(shown.map(async (e) => {
        if (!blocks.has(e.blockNumber)) blocks.set(e.blockNumber, Number((await publicClient!.getBlock({ blockNumber: e.blockNumber })).timestamp));
        if (!from.has(e.transactionHash)) from.set(e.transactionHash, (await publicClient!.getTransaction({ hash: e.transactionHash })).from);
      }));
      return { blocks, from };
    },
  });

  return (
    <Card title="Audit trail (on-chain events)">
      {shown.length === 0 && <Empty>No activity yet.</Empty>}
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-slate-300">
          <thead className="text-left text-slate-500">
            <tr><th className="pr-3">Block</th><th className="pr-3">Time</th><th className="pr-3">Actor</th><th className="pr-3">Event</th><th className="pr-3">Details</th><th>Tx</th></tr>
          </thead>
          <tbody>
            {shown.map((e) => {
              const url = chainId ? explorerTxUrl(chainId, e.transactionHash) : null;
              const ts = meta.data?.blocks.get(e.blockNumber);
              const actor = meta.data?.from.get(e.transactionHash);
              return (
                <tr key={`${e.transactionHash}-${e.logIndex}`} className="border-t border-slate-800 align-top" data-testid="activity-row">
                  <td className="pr-3">{String(e.blockNumber)}</td>
                  <td className="whitespace-nowrap pr-3">{ts ? fmtTime(ts) : "…"}</td>
                  <td className="pr-3 font-mono">{actor ? shortAddr(actor) : "…"}</td>
                  <td className="pr-3 font-semibold">{e.eventName}</td>
                  <td className="pr-3">{describe(e.args)}</td>
                  <td className="font-mono">{url ? <a href={url} target="_blank" rel="noreferrer" className="text-indigo-400 underline">{shortHash(e.transactionHash, 4)}</a> : shortHash(e.transactionHash, 4)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

import { useQuery } from "@tanstack/react-query";
import { eventsApi } from "./api";
import { useEvents, useHeirloom } from "./hooks";
import type { HeirloomEvent } from "./logs";

/** An audit row. From the indexer it already carries its timestamp and sender; from the chain it is looked up later. */
export type AuditEntry = HeirloomEvent & { ts?: number; actor?: string };
export type AuditSource = "indexer" | "chain";

const MAX_LAG_BLOCKS = 200; // further behind than this and the chain is the better source
const PAGE = 500;
const MAX_EVENTS = 5000;

/**
 * Every contract event, newest first. Prefers the backend indexer (fast, filterable, includes sender and time) and
 * falls back to reading the chain directly when the indexer is unreachable, stalled, erroring or far behind.
 */
export function useAuditEvents(): { entries: AuditEntry[]; source: AuditSource; loading: boolean; failed: boolean; note: string } {
  const { chainId, deployment } = useHeirloom();
  const chain = useEvents();

  const indexer = useQuery({
    queryKey: ["audit-indexer", chainId],
    enabled: Boolean(chainId && deployment),
    refetchInterval: 8000,
    retry: false,
    queryFn: async () => {
      const entries: AuditEntry[] = [];
      let before: number | undefined;
      let status;
      do {
        const page = await eventsApi.list({ chain_id: chainId!, limit: PAGE, before_id: before });
        status = page.indexer.find((s) => s.chain_id === chainId);
        for (const e of page.results) {
          entries.push({
            eventName: e.event_name, args: e.args, blockNumber: BigInt(e.block_number), transactionHash: e.tx_hash,
            logIndex: e.log_index, ts: e.timestamp, actor: e.actor?.toLowerCase(),
          });
        }
        before = page.next_before_id ?? undefined;
      } while (before !== undefined && entries.length < MAX_EVENTS);
      return { entries, status };
    },
  });

  const status = indexer.data?.status;
  let reason = "";
  if (indexer.isError) reason = "the indexer is unreachable";
  else if (indexer.data && !status) reason = "the indexer has not started on this network";
  else if (status?.error) reason = "the indexer reported an error";
  else if (status?.stale) reason = "the indexer has stalled";
  else if (status && status.lag_blocks > MAX_LAG_BLOCKS) reason = `the indexer is ${status.lag_blocks} blocks behind`;

  if (indexer.data && !reason) {
    return { entries: indexer.data.entries, source: "indexer", loading: false, failed: false, note: `Indexed up to block ${status!.last_block}` };
  }
  if (indexer.isLoading) return { entries: [], source: "indexer", loading: true, failed: false, note: "" };
  return {
    entries: [...(chain.data ?? [])].reverse(),
    source: "chain",
    loading: chain.isLoading,
    failed: chain.isError,
    note: `Read directly from the blockchain because ${reason || "the indexer is unavailable"}`,
  };
}

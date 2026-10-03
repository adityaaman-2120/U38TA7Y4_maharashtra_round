"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PublicClient } from "viem";
import { useHeirloom } from "@/lib/hooks";
import { useAuditEvents } from "@/lib/audit";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/wagmi";
import { addressesOf, claimAssetMap, EVENT_LABELS, refsOf, summarize } from "@/lib/events";
import { fmtTime, shortAddr, shortHash } from "@/lib/format";
import { Badge, Btn, Card, EmptyState, Input, Label, ListSkeleton, Select } from "./ui";

const PAGE = 25;
const blockTimes = new Map<string, number>(); // `${chainId}:${block}` -> unix seconds
const txSenders = new Map<string, string>(); // `${chainId}:${hash}` -> from

async function loadMeta(client: PublicClient, chainId: number, events: { blockNumber: bigint; transactionHash: `0x${string}` }[]) {
  const jobs: Promise<unknown>[] = [];
  for (const e of events) {
    const bk = `${chainId}:${e.blockNumber}`;
    const tk = `${chainId}:${e.transactionHash}`;
    if (!blockTimes.has(bk)) jobs.push(client.getBlock({ blockNumber: e.blockNumber }).then((b) => blockTimes.set(bk, Number(b.timestamp))));
    if (!txSenders.has(tk)) jobs.push(client.getTransaction({ hash: e.transactionHash }).then((t) => txSenders.set(tk, t.from.toLowerCase())));
  }
  for (let i = 0; i < jobs.length; i += 20) await Promise.all(jobs.slice(i, i + 20));
}

/** Audit trail built only from the contract's events. */
export default function AuditView() {
  const { address, chainId, publicClient } = useHeirloom();
  const audit = useAuditEvents();
  const all = audit.entries;

  const [type, setType] = useState("");
  const [assetId, setAssetId] = useState("");
  const [claimId, setClaimId] = useState("");
  const [actor, setActor] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const meta = useQuery({
    queryKey: ["audit-meta", chainId, all.length],
    enabled: Boolean(publicClient && chainId) && audit.source === "chain" && all.length > 0, // the indexer already supplies time and sender
    queryFn: async () => {
      await loadMeta(publicClient!, chainId!, all.filter((e) => e.ts === undefined));
      return Date.now();
    },
  });

  const claimToAsset = useMemo(() => claimAssetMap(all), [all]);
  const assetIds = useMemo(() => [...new Set(all.map((e) => refsOf(e, claimToAsset).assetId).filter((x): x is number => x !== undefined))].sort((a, b) => a - b), [all, claimToAsset]);
  const claimIds = useMemo(() => [...new Set(all.map((e) => refsOf(e, claimToAsset).claimId).filter((x): x is number => x !== undefined))].sort((a, b) => a - b), [all, claimToAsset]);
  const types = useMemo(() => [...new Set(all.map((e) => e.eventName))], [all]);

  const actorFilter = (mineOnly ? address ?? "" : actor).trim().toLowerCase();
  const filtered = useMemo(() => all.filter((e) => {
    const refs = refsOf(e, claimToAsset);
    if (type && e.eventName !== type) return false;
    if (assetId !== "" && refs.assetId !== Number(assetId)) return false;
    if (claimId !== "" && refs.claimId !== Number(claimId)) return false;
    if (actorFilter) {
      const sender = e.actor ?? txSenders.get(`${chainId}:${e.transactionHash}`);
      if (sender !== actorFilter && !addressesOf(e).includes(actorFilter)) return false;
    }
    return true;
  }), [all, claimToAsset, type, assetId, claimId, actorFilter, chainId, meta.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = filtered.slice(0, limit);
  const reset = () => { setType(""); setAssetId(""); setClaimId(""); setActor(""); setMineOnly(false); setLimit(PAGE); };
  const filtersActive = Boolean(type || assetId || claimId || actor || mineOnly);

  return (
    <div className="space-y-4">
      <Card title="Audit trail" right={<span className="text-xs text-muted">{filtered.length} of {all.length} events</span>}>
        <p className="text-sm text-muted">Every state change is an on-chain event, and no file contents appear in it.</p>
        <p className="text-xs text-faint" data-testid="audit-source" data-source={audit.source}>
          Source: <b>{audit.source === "indexer" ? "indexer" : "blockchain"}</b>. {audit.note}.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Label text="Event">
            <Select value={type} onChange={(e) => { setType(e.target.value); setLimit(PAGE); }} data-testid="filter-type">
              <option value="">All events</option>
              {types.map((t) => <option key={t} value={t}>{EVENT_LABELS[t]?.label ?? t}</option>)}
            </Select>
          </Label>
          <Label text="Asset">
            <Select value={assetId} onChange={(e) => { setAssetId(e.target.value); setLimit(PAGE); }} data-testid="filter-asset">
              <option value="">All assets</option>
              {assetIds.map((i) => <option key={i} value={i}>Asset #{i}</option>)}
            </Select>
          </Label>
          <Label text="Claim">
            <Select value={claimId} onChange={(e) => { setClaimId(e.target.value); setLimit(PAGE); }} data-testid="filter-claim">
              <option value="">All claims</option>
              {claimIds.map((i) => <option key={i} value={i}>Claim #{i}</option>)}
            </Select>
          </Label>
          <Label text="Actor (address)">
            <Input placeholder="0x…" value={mineOnly ? address ?? "" : actor} disabled={mineOnly} data-testid="filter-actor" onChange={(e) => { setActor(e.target.value); setLimit(PAGE); }} />
          </Label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={mineOnly} onChange={(e) => { setMineOnly(e.target.checked); setLimit(PAGE); }} data-testid="filter-mine" /> Only my activity
          </label>
          {filtersActive && <Btn tone="ghost" onClick={reset}>Clear filters</Btn>}
        </div>
      </Card>

      {audit.loading ? (
        <ListSkeleton rows={5} />
      ) : audit.failed ? (
        <Card title="Could not load events"><p className="text-sm text-bad">The network request failed. It will retry automatically.</p></Card>
      ) : all.length === 0 ? (
        <EmptyState title="No activity yet" hint="Events appear here as soon as someone registers a key or creates a vault." />
      ) : filtered.length === 0 ? (
        <EmptyState title="No events match these filters" hint="Try clearing a filter." />
      ) : (
        <ul className="space-y-2" data-testid="audit-list">
          {shown.map((e) => {
            const info = EVENT_LABELS[e.eventName] ?? { label: e.eventName, tone: "info" as const };
            const refs = refsOf(e, claimToAsset);
            const ts = e.ts ?? blockTimes.get(`${chainId}:${e.blockNumber}`);
            const sender = e.actor ?? txSenders.get(`${chainId}:${e.transactionHash}`);
            const txUrl = chainId ? explorerTxUrl(chainId, e.transactionHash) : null;
            const senderUrl = chainId && sender ? explorerAddressUrl(chainId, sender) : null;
            return (
              <li key={`${e.transactionHash}-${e.logIndex}`} className="rounded-xl border border-line bg-surface p-3" data-testid="audit-row">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={info.tone}>{info.label}</Badge>
                  {refs.assetId !== undefined && <span className="text-xs text-muted">asset #{refs.assetId}</span>}
                  {refs.claimId !== undefined && <span className="text-xs text-muted">claim #{refs.claimId}</span>}
                </div>
                <p className="mt-1 text-sm text-ink">{summarize(e, address)}</p>
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-faint">
                  <span>block {String(e.blockNumber)}</span>
                  <span>{ts ? fmtTime(ts) : "…"}</span>
                  <span>
                    by {sender ? (senderUrl ? <a href={senderUrl} target="_blank" rel="noreferrer" className="font-mono text-accent underline">{shortAddr(sender)}</a> : <span className="font-mono">{shortAddr(sender)}</span>) : "…"}
                  </span>
                  <span>
                    tx {txUrl ? <a href={txUrl} target="_blank" rel="noreferrer" className="font-mono text-accent underline">{shortHash(e.transactionHash, 4)}</a> : <span className="font-mono">{shortHash(e.transactionHash, 4)}</span>}
                  </span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {filtered.length > limit && <Btn tone="ghost" onClick={() => setLimit(limit + PAGE)} data-testid="load-more">Show more</Btn>}
    </div>
  );
}

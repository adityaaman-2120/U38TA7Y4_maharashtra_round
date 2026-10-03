"use client";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import type { PublicClient } from "viem";
import { useHeirloom } from "@/lib/hooks";
import { useAuditEvents } from "@/lib/audit";
import { buildAuditReport, reportFileName } from "@/lib/auditReport";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/wagmi";
import { addressesOf, claimAssetMap, eventLabel, eventTone, refsOf, summarize } from "@/lib/events";
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
  const t = useTranslations("Audit");
  const { address, chainId, publicClient, deployment } = useHeirloom();
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

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const exportPdf = async () => {
    if (!chainId || !deployment) return;
    setExporting(true);
    setExportError("");
    try {
      // From the chain, time and sender are looked up lazily; make sure every row in the report has them.
      const missing = filtered.filter((e) => e.ts === undefined && !blockTimes.has(`${chainId}:${e.blockNumber}`));
      if (missing.length && publicClient) await loadMeta(publicClient, chainId, filtered);
      const doc = await buildAuditReport({
        rows: filtered.map((e) => ({
          entry: e,
          time: e.ts ?? blockTimes.get(`${chainId}:${e.blockNumber}`),
          actor: e.actor ?? txSenders.get(`${chainId}:${e.transactionHash}`),
        })),
        total: all.length, chainId, contract: deployment.address, source: audit.source, requestedBy: address ?? t("unknownRequester"), filters: { type, assetId, claimId, actor: actorFilter },
      });
      doc.save(reportFileName(chainId));
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const shown = filtered.slice(0, limit);
  const reset = () => { setType(""); setAssetId(""); setClaimId(""); setActor(""); setMineOnly(false); setLimit(PAGE); };
  const filtersActive = Boolean(type || assetId || claimId || actor || mineOnly);

  return (
    <div className="space-y-4">
      <Card title={t("title")} right={<span className="text-xs text-muted">{t("count", { shown: filtered.length, total: all.length })}</span>}>
        <p className="text-sm text-muted">{t("intro")}</p>
        <p className="text-xs text-faint" data-testid="audit-source" data-source={audit.source}>
          {t.rich("sourceLine", { source: audit.source === "indexer" ? t("sourceIndexer") : t("sourceChain"), note: audit.note, b: (c) => <b>{c}</b> })}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Label text={t("filterEvent")}>
            <Select value={type} onChange={(e) => { setType(e.target.value); setLimit(PAGE); }} data-testid="filter-type">
              <option value="">{t("allEvents")}</option>
              {types.map((n) => <option key={n} value={n}>{eventLabel(n)}</option>)}
            </Select>
          </Label>
          <Label text={t("filterAsset")}>
            <Select value={assetId} onChange={(e) => { setAssetId(e.target.value); setLimit(PAGE); }} data-testid="filter-asset">
              <option value="">{t("allAssets")}</option>
              {assetIds.map((i) => <option key={i} value={i}>{t("assetOption", { id: i })}</option>)}
            </Select>
          </Label>
          <Label text={t("filterClaim")}>
            <Select value={claimId} onChange={(e) => { setClaimId(e.target.value); setLimit(PAGE); }} data-testid="filter-claim">
              <option value="">{t("allClaims")}</option>
              {claimIds.map((i) => <option key={i} value={i}>{t("claimOption", { id: i })}</option>)}
            </Select>
          </Label>
          <Label text={t("filterActor")}>
            <Input placeholder="0x…" value={mineOnly ? address ?? "" : actor} disabled={mineOnly} data-testid="filter-actor" onChange={(e) => { setActor(e.target.value); setLimit(PAGE); }} />
          </Label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={mineOnly} onChange={(e) => { setMineOnly(e.target.checked); setLimit(PAGE); }} data-testid="filter-mine" /> {t("mineOnly")}
          </label>
          {filtersActive && <Btn tone="ghost" onClick={reset}>{t("clear")}</Btn>}
          <Btn tone="ghost" onClick={exportPdf} disabled={exporting || filtered.length === 0} data-testid="export-pdf" className="sm:ml-auto">{exporting ? t("building") : t("exportPdf")}</Btn>
          {exportError && <span className="text-xs text-bad">{exportError}</span>}
        </div>
      </Card>

      {audit.loading ? (
        <ListSkeleton rows={5} />
      ) : audit.failed ? (
        <Card title={t("loadFailedTitle")}><p className="text-sm text-bad">{t("loadFailedBody")}</p></Card>
      ) : all.length === 0 ? (
        <EmptyState title={t("emptyTitle")} hint={t("emptyHint")} />
      ) : filtered.length === 0 ? (
        <EmptyState title={t("noMatchTitle")} hint={t("noMatchHint")} />
      ) : (
        <ul className="space-y-2" data-testid="audit-list">
          {shown.map((e) => {
            const refs = refsOf(e, claimToAsset);
            const ts = e.ts ?? blockTimes.get(`${chainId}:${e.blockNumber}`);
            const sender = e.actor ?? txSenders.get(`${chainId}:${e.transactionHash}`);
            const txUrl = chainId ? explorerTxUrl(chainId, e.transactionHash) : null;
            const senderUrl = chainId && sender ? explorerAddressUrl(chainId, sender) : null;
            return (
              <li key={`${e.transactionHash}-${e.logIndex}`} className="rounded-xl border border-line bg-surface p-3" data-testid="audit-row">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={eventTone(e.eventName)}>{eventLabel(e.eventName)}</Badge>
                  {refs.assetId !== undefined && <span className="text-xs text-muted">{t("asset", { id: refs.assetId })}</span>}
                  {refs.claimId !== undefined && <span className="text-xs text-muted">{t("claim", { id: refs.claimId })}</span>}
                </div>
                <p className="mt-1 text-sm text-ink">{summarize(e, address)}</p>
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-faint">
                  <span>{t("block", { block: String(e.blockNumber) })}</span>
                  <span>{ts ? fmtTime(ts) : "…"}</span>
                  <span>
                    {t("by")} {sender ? (senderUrl ? <a href={senderUrl} target="_blank" rel="noreferrer" className="font-mono text-accent underline">{shortAddr(sender)}</a> : <span className="font-mono">{shortAddr(sender)}</span>) : "…"}
                  </span>
                  <span>
                    {t("tx")} {txUrl ? <a href={txUrl} target="_blank" rel="noreferrer" className="font-mono text-accent underline">{shortHash(e.transactionHash, 4)}</a> : <span className="font-mono">{shortHash(e.transactionHash, 4)}</span>}
                  </span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {filtered.length > limit && <Btn tone="ghost" onClick={() => setLimit(limit + PAGE)} data-testid="load-more">{t("showMore")}</Btn>}
    </div>
  );
}

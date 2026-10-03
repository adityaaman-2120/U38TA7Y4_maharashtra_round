import { createTranslator } from "use-intl/core";
import enMessages from "@/messages/en";
import type { Translator } from "@/i18n/runtime";
import { eventLabel, summarize } from "./events";
import { explorerTxUrl, CHAIN_LABELS } from "./wagmi";
import type { AuditEntry } from "./audit";

export type ReportRow = { entry: AuditEntry; time?: number; actor?: string };

export type ReportInput = {
  rows: ReportRow[];
  total: number; // events before filtering
  chainId: number;
  contract: string;
  source: "indexer" | "chain";
  requestedBy: string;
  filters: { type?: string; assetId?: string; claimId?: string; actor?: string }; // what the view was filtered by, if anything
};

// The report is a formal record and is always written in English: the PDF's built-in fonts cannot draw Devanagari or Bengali.
const tr = createTranslator({ locale: "en", messages: enMessages }) as unknown as Translator;
const FULL = { addr: (a: string) => a, hash: (h: string) => h };
const utc = (unix?: number) => (unix === undefined ? tr("Report.na") : new Date(unix * 1000).toISOString().replace("T", " ").slice(0, 19));
// jsPDF's built-in fonts only cover Latin-1; keep the report to characters they can draw.
const ascii = (s: string) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/\u2026/g, "...").replace(/[^\x20-\x7e\n]/g, "?");
const wrapHash = (h: string) => `${h.slice(0, 33)}\n${h.slice(33)}`; // 66 chars -> two lines that fit the column

/** Builds the PDF in the browser; nothing about the report is sent to any server. */
export async function buildAuditReport(input: ReportInput) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const network = CHAIN_LABELS[input.chainId] ?? tr("Report.chainFallback", { id: input.chainId });
  const filterText = [
    input.filters.type && tr("Report.filterEvent", { label: eventLabel(input.filters.type, tr) }),
    input.filters.assetId && tr("Report.filterAsset", { id: input.filters.assetId }),
    input.filters.claimId && tr("Report.filterClaim", { id: input.filters.claimId }),
    input.filters.actor && tr("Report.filterActor", { address: input.filters.actor }),
  ].filter(Boolean) as string[];
  const generated = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  doc.setProperties({ title: tr("Report.title"), subject: tr("Report.subject", { contract: input.contract, network }), creator: "Heirloom" });

  doc.setFont("helvetica", "bold").setFontSize(20).text(tr("Report.title"), 14, 18);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
  const meta: [string, string][] = [
    [tr("Report.generated"), generated],
    [tr("Report.network"), tr("Report.networkValue", { network, chainId: input.chainId })],
    [tr("Report.contract"), input.contract],
    [tr("Report.requestedBy"), input.requestedBy],
    [tr("Report.dataSource"), input.source === "indexer" ? tr("Report.sourceIndexer") : tr("Report.sourceChain")],
    [tr("Report.events"), `${tr("Report.eventsCount", { shown: input.rows.length, total: input.total })}${filterText.length ? `  ${tr("Report.filtered", { filters: filterText.join("; ") })}` : ""}`],
  ];
  meta.forEach(([k, v], i) => {
    doc.setFont("helvetica", "bold").text(`${k}:`, 14, 26 + i * 5);
    doc.setFont("helvetica", "normal").text(ascii(v), 48, 26 + i * 5);
  });
  doc.setTextColor(0);

  // Summary by event type
  const counts = new Map<string, number>();
  for (const r of input.rows) counts.set(r.entry.eventName, (counts.get(r.entry.eventName) ?? 0) + 1);
  autoTable(doc, {
    startY: 60,
    head: [[tr("Report.colEvent"), tr("Report.colCount")]],
    body: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => [eventLabel(n, tr), String(c)]),
    theme: "grid", styles: { fontSize: 8, cellPadding: 1.5 }, headStyles: { fillColor: [29, 74, 57] }, tableWidth: 80, margin: { left: 14 },
  });

  // Chronological, oldest first: an audit trail reads top to bottom.
  const ordered = [...input.rows].sort((a, b) => Number(a.entry.blockNumber - b.entry.blockNumber) || a.entry.logIndex - b.entry.logIndex);
  type Cell = string;
  const body: Cell[][] = ordered.map((r) => {
    const sender = r.actor ? tr("Report.sentBy", { actor: r.actor }) : "";
    return [
      utc(r.time),
      String(r.entry.blockNumber),
      eventLabel(r.entry.eventName, tr),
      ascii(`${summarize(r.entry, undefined, FULL, tr)}${sender ? `\n${sender}` : ""}`),
      wrapHash(r.entry.transactionHash),
    ];
  });
  const urls = ordered.map((r) => explorerTxUrl(input.chainId, r.entry.transactionHash));

  autoTable(doc, {
    startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10,
    head: [[tr("Report.colTime"), tr("Report.colBlock"), tr("Report.colEvent"), tr("Report.colDetails"), tr("Report.colHash")]],
    body,
    theme: "striped",
    styles: { fontSize: 7.5, cellPadding: 1.6, valign: "top", overflow: "linebreak" },
    headStyles: { fillColor: [29, 74, 57] },
    columnStyles: { 0: { cellWidth: 29 }, 1: { cellWidth: 14 }, 2: { cellWidth: 32 }, 3: { cellWidth: "auto" }, 4: { cellWidth: 52, font: "courier", fontSize: 6.4 } }, // 33 monospace characters per line must fit, or the hash wraps again
    rowPageBreak: "avoid", // never cut an entry (and its hash) in half across two pages
    margin: { left: 14, right: 14, bottom: 16 },
    didDrawCell: (d) => {
      const url = d.section === "body" && d.column.index === 4 ? urls[d.row.index] : null;
      if (url) doc.link(d.cell.x, d.cell.y, d.cell.width, d.cell.height, { url }); // the hash cell links to the explorer
    },
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5).setTextColor(110).setFont("helvetica", "normal");
    doc.text(tr("Report.footer"), 14, 203);
    doc.text(tr("Report.page", { page: i, pages }), 283, 203, { align: "right" });
  }
  return doc;
}

export const reportFileName = (chainId: number) => `heirloom-audit-${chainId}-${new Date().toISOString().slice(0, 10)}.pdf`;

import { EVENT_LABELS, summarize } from "./events";
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
  filters: string[]; // human-readable, empty when none
};

const FULL = { addr: (a: string) => a, hash: (h: string) => h };
const utc = (unix?: number) => (unix === undefined ? "n/a" : new Date(unix * 1000).toISOString().replace("T", " ").slice(0, 19));
// jsPDF's built-in fonts only cover Latin-1; keep the report to characters they can draw.
const ascii = (s: string) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/\u2026/g, "...").replace(/[^\x20-\x7e\n]/g, "?");
const wrapHash = (h: string) => `${h.slice(0, 33)}\n${h.slice(33)}`; // 66 chars -> two lines that fit the column

/** Builds the PDF in the browser; nothing about the report is sent to any server. */
export async function buildAuditReport(input: ReportInput) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const network = CHAIN_LABELS[input.chainId] ?? `Chain ${input.chainId}`;
  const generated = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  doc.setProperties({ title: "Heirloom audit report", subject: `Contract ${input.contract} on ${network}`, creator: "Heirloom" });

  doc.setFont("helvetica", "bold").setFontSize(20).text("Heirloom audit report", 14, 18);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
  const meta: [string, string][] = [
    ["Generated", generated],
    ["Network", `${network} (chain id ${input.chainId})`],
    ["Contract", input.contract],
    ["Requested by", input.requestedBy],
    ["Data source", input.source === "indexer" ? "Heirloom indexer (a copy of the contract's events)" : "Read directly from the blockchain"],
    ["Events in this report", `${input.rows.length} of ${input.total}${input.filters.length ? `  (filtered: ${input.filters.join("; ")})` : ""}`],
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
    head: [["Event", "Count"]],
    body: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => [EVENT_LABELS[n]?.label ?? n, String(c)]),
    theme: "grid", styles: { fontSize: 8, cellPadding: 1.5 }, headStyles: { fillColor: [29, 74, 57] }, tableWidth: 80, margin: { left: 14 },
  });

  // Chronological, oldest first: an audit trail reads top to bottom.
  const ordered = [...input.rows].sort((a, b) => Number(a.entry.blockNumber - b.entry.blockNumber) || a.entry.logIndex - b.entry.logIndex);
  type Cell = string;
  const body: Cell[][] = ordered.map((r) => {
    const sender = r.actor ? `Sent by ${r.actor}` : "";
    return [
      utc(r.time),
      String(r.entry.blockNumber),
      EVENT_LABELS[r.entry.eventName]?.label ?? r.entry.eventName,
      ascii(`${summarize(r.entry, undefined, FULL)}${sender ? `\n${sender}` : ""}`),
      wrapHash(r.entry.transactionHash),
    ];
  });
  const urls = ordered.map((r) => explorerTxUrl(input.chainId, r.entry.transactionHash));

  autoTable(doc, {
    startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10,
    head: [["Time (UTC)", "Block", "Event", "Details", "Transaction hash"]],
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
    doc.text("Generated from the contract's public events. Verify any entry by opening its transaction hash on a block explorer.", 14, 203);
    doc.text(`Page ${i} of ${pages}`, 283, 203, { align: "right" });
  }
  return doc;
}

export const reportFileName = (chainId: number) => `heirloom-audit-${chainId}-${new Date().toISOString().slice(0, 10)}.pdf`;

import type { ReactNode } from "react";

// Small illustrations for the landing page. Pure SVG in the app's palette; they carry no text that needs translating.
const INK = "#1d4a39";
const BRASS = "#a9742a";
const BRASS_SOFT = "#f3e8d3";
const MINT = "#e3ece6";
const LINE = "#cfc7b6";

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 160 96" className="h-24 w-full" role="presentation" aria-hidden>
      {children}
    </svg>
  );
}

const Doc = ({ x, y, w = 40, h = 52 }: { x: number; y: number; w?: number; h?: number }) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx="5" fill="#fff" stroke={LINE} strokeWidth="1.5" />
    {[0, 1, 2].map((i) => <rect key={i} x={x + 8} y={y + 12 + i * 10} width={w - 16 - (i === 2 ? 10 : 0)} height="3.5" rx="1.75" fill={MINT} />)}
  </g>
);

const Padlock = ({ x, y, color = INK }: { x: number; y: number; color?: string }) => (
  <g transform={`translate(${x} ${y})`}>
    <circle cx="14" cy="14" r="14" fill={color} />
    <rect x="8.5" y="13" width="11" height="8" rx="2" fill="#fff" />
    <path d="M10.5 13v-2.5a3.5 3.5 0 0 1 7 0V13" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
  </g>
);

export function SealArt() {
  return (
    <Frame>
      <rect x="0" y="0" width="160" height="96" rx="14" fill={MINT} opacity="0.55" />
      <Doc x={42} y={22} />
      <path d="M96 48h16" stroke={BRASS} strokeWidth="2" strokeDasharray="3 4" strokeLinecap="round" />
      <Padlock x={106} y={34} />
      <circle cx="26" cy="74" r="2" fill={BRASS} /><circle cx="34" cy="68" r="2" fill={BRASS} opacity="0.6" /><circle cx="40" cy="78" r="2" fill={BRASS} opacity="0.4" />
    </Frame>
  );
}

export function SplitArt() {
  const shares = [{ x: 118, y: 18 }, { x: 128, y: 48 }, { x: 118, y: 78 }];
  return (
    <Frame>
      <rect x="0" y="0" width="160" height="96" rx="14" fill={MINT} opacity="0.55" />
      <circle cx="36" cy="48" r="16" fill={INK} />
      <circle cx="33" cy="45" r="4.5" fill="none" stroke="#fff" strokeWidth="2" />
      <path d="M36.5 48.5l8 6M41 52.5l-2 2.5" stroke={BRASS_SOFT} strokeWidth="2" strokeLinecap="round" />
      {shares.map((s, i) => (
        <g key={i}>
          <path d={`M52 48C80 48 84 ${s.y} ${s.x - 12} ${s.y}`} fill="none" stroke={i === 2 ? LINE : INK} strokeWidth="1.6" strokeDasharray={i === 2 ? "3 4" : undefined} />
          <circle cx={s.x} cy={s.y} r="11" fill={i === 2 ? "#fff" : BRASS_SOFT} stroke={i === 2 ? LINE : BRASS} strokeWidth="1.6" />
          {i < 2 ? <path d={`M${s.x - 4} ${s.y}l3 3 5-6`} fill="none" stroke={BRASS} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : <circle cx={s.x} cy={s.y} r="2" fill={LINE} />}
        </g>
      ))}
    </Frame>
  );
}

export function ProveArt() {
  return (
    <Frame>
      <rect x="0" y="0" width="160" height="96" rx="14" fill={MINT} opacity="0.55" />
      <Doc x={24} y={20} w={44} h={56} />
      <circle cx="58" cy="62" r="11" fill="none" stroke={BRASS} strokeWidth="2" strokeDasharray="2.5 2.5" />
      <path d="M53 62l3.5 3.5 6-7" fill="none" stroke={BRASS} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${96 + i * 18} 34)`}>
          <circle cx="8" cy="6" r="6" fill={i < 2 ? INK : "#fff"} stroke={i < 2 ? INK : LINE} strokeWidth="1.5" />
          <path d="M-1 24c0-5 4-8 9-8s9 3 9 8z" fill={i < 2 ? INK : "#fff"} stroke={i < 2 ? INK : LINE} strokeWidth="1.5" />
          {i < 2 && <path d="M4.5 6l2.5 2.5 4-5" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
        </g>
      ))}
      <rect x="96" y="66" width="48" height="5" rx="2.5" fill="#fff" stroke={LINE} />
      <rect x="96" y="66" width="32" height="5" rx="2.5" fill={BRASS} />
    </Frame>
  );
}

export function ReleaseArt() {
  return (
    <Frame>
      <rect x="0" y="0" width="160" height="96" rx="14" fill={MINT} opacity="0.55" />
      <g transform="translate(26 30)">
        <circle cx="14" cy="14" r="14" fill={BRASS} />
        <rect x="8.5" y="13" width="11" height="8" rx="2" fill="#fff" />
        <path d="M10.5 13v-2.5a3.5 3.5 0 0 1 6.8-1.2" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      </g>
      <path d="M66 48h18" stroke={INK} strokeWidth="2" strokeLinecap="round" /><path d="M79 42l6 6-6 6" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Doc x={96} y={22} w={40} h={52} />
      <circle cx="130" cy="70" r="9" fill={INK} />
      <path d="M125.5 70l3 3 5.5-6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  );
}

/** A tile-sized chip row, used in the crypto feature. */
export function TokenChips({ tokens, amount }: { tokens: string[]; amount: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tokens.map((t, i) => (
        <span key={t} className={`inline-flex h-9 min-w-9 items-center justify-center rounded-full px-3 font-mono text-xs font-semibold ${i === 0 ? "bg-accent text-white" : "border border-line-strong bg-surface text-ink-2"}`}>{t}</span>
      ))}
      <span className="ml-1 rounded-lg bg-brass-soft px-2.5 py-1 font-mono text-xs font-semibold text-brass">{amount}</span>
    </div>
  );
}

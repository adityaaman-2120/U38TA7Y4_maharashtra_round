import Link from "next/link";
import { LogoMark, Wordmark } from "@/components/Logo";

const STEPS = [
  { n: "01", title: "Seal", body: "Pick a file. Your browser encrypts it with a fresh key before anything leaves your device. Only scrambled bytes are ever uploaded." },
  { n: "02", title: "Split", body: "That key is cut into shares, one per guardian you trust, each locked to that guardian's own public key. Any two or more together can rebuild it. One alone learns nothing." },
  { n: "03", title: "Prove", body: "When you are gone, your beneficiary raises a claim with a certificate. Guardians open the evidence themselves and decide. The rules run on a public contract, not on our say-so." },
  { n: "04", title: "Release", body: "If enough guardians agree and you stay silent through the waiting period, they hand their shares to the beneficiary, who decrypts the file and checks it matches the original, byte for byte." },
];

const SEES = [
  ["The encrypted file", "A pointer to scrambled bytes on IPFS"],
  ["Who your guardians are", "Their addresses, no names or documents"],
  ["That a claim was raised", "A fingerprint of the evidence, never the evidence"],
  ["Every approval and rejection", "Timestamped on a public ledger anyone can audit"],
];
const NEVER = [
  ["Your files", "Encrypted in the browser. Plaintext never reaches a server"],
  ["Your encryption key", "Sealed with your password, stored only on your device"],
  ["The key to the file", "Exists whole only on your device and, later, the beneficiary's"],
  ["The death certificate", "Encrypted for your guardians. We cannot read it"],
];

const SAFEGUARDS = [
  { t: "Heartbeat", d: "Check in with one tap. Any check-in after a claim is raised voids that claim, so a mistaken or malicious one dies on its own." },
  { t: "Challenge period", d: "A waiting window you set, at least five minutes, in which you can object before anything is finalized." },
  { t: "Fraud flag", d: "Any guardian can flag a claim as fraudulent. It is blocked for good until you clear it yourself." },
  { t: "Panic freeze", d: "One button stops every claim on your vault. Unfreezing counts as a check-in." },
  { t: "Time lock", d: "Keep a file sealed until a date you choose, no matter how many guardians agree." },
  { t: "Verified people", d: "Optionally require guardians to prove they are real, distinct people, and beneficiaries to prove who they are and that they are adults, using zero-knowledge proofs of Aadhaar. Nothing from the Aadhaar leaves the browser." },
  { t: "Silent guardians", d: "If a guardian never answers, the claim can still finish after your deadline, as long as the minimum threshold approved." },
];

const ROLES = [
  { who: "The owner", line: "You.", points: ["Reserve files for named people", "Choose guardians and thresholds", "Check in, cancel, or freeze at any time"] },
  { who: "The guardian", line: "People you trust, none of them alone.", points: ["Review the evidence in their own browser", "Approve, reject, or flag fraud", "Release their share only after finalization"] },
  { who: "The beneficiary", line: "Who it is meant for.", points: ["Sees that a file exists, never what it holds", "Raises a claim once you have been silent long enough", "Decrypts only when guardians have released"] },
];

function Hero() {
  const nodes = [
    { x: 240, y: 90, on: true, label: "share 1" },
    { x: 370, y: 315, on: true, label: "share 2" },
    { x: 110, y: 315, on: false, label: "share 3" },
  ];
  return (
    <svg viewBox="0 0 480 480" className="mx-auto h-auto w-full max-w-[460px]" role="img" aria-label="A key split into three shares held by three guardians; two of three are enough to open the vault">
      <circle cx="240" cy="240" r="205" fill="none" stroke="#e3ddd0" strokeWidth="1.5" />
      <circle cx="240" cy="240" r="170" fill="#fff" stroke="#e3ddd0" />
      <circle cx="240" cy="240" r="150" fill="none" stroke="#cfc7b6" strokeDasharray="2 7" strokeLinecap="round" />
      {Array.from({ length: 48 }, (_, i) => {
        const a = (i / 48) * Math.PI * 2;
        return <line key={i} x1={240 + 196 * Math.cos(a)} y1={240 + 196 * Math.sin(a)} x2={240 + 205 * Math.cos(a)} y2={240 + 205 * Math.sin(a)} stroke="#cfc7b6" strokeWidth="1" />;
      })}
      {nodes.map((n, i) => (
        <line key={i} x1={n.x} y1={n.y} x2="240" y2="240" stroke={n.on ? "#1d4a39" : "#cfc7b6"} strokeWidth={n.on ? 2 : 1.5} strokeDasharray={n.on ? undefined : "4 6"} className={n.on ? "draw" : ""} />
      ))}
      <circle cx="240" cy="240" r="46" fill="#1d4a39" />
      <circle cx="240" cy="232" r="11" fill="#f6f3ec" />
      <path d="M240 240 l-9 26 h18 z" fill="#f6f3ec" />
      {nodes.map((n, i) => (
        <g key={i}>
          <circle cx={n.x} cy={n.y} r="26" fill={n.on ? "#f3e8d3" : "#fff"} stroke={n.on ? "#a9742a" : "#cfc7b6"} strokeWidth="2" />
          {n.on ? <path d={`M${n.x - 8} ${n.y} l6 6 l11 -12`} fill="none" stroke="#a9742a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /> : <circle cx={n.x} cy={n.y} r="3" fill="#cfc7b6" />}
          <text x={n.x} y={n.y + (n.y < 200 ? -40 : 48)} textAnchor="middle" fontSize="11" fill="#666b74" fontFamily="var(--font-geist-mono), monospace">{n.label}</text>
        </g>
      ))}
      <text x="240" y="458" textAnchor="middle" fontSize="12" fill="#8b8f96" fontFamily="var(--font-geist-mono), monospace">2 of 3 shares open the vault</text>
    </svg>
  );
}

export default function Landing() {
  return (
    <div className="relative">
      <div className="grain pointer-events-none absolute inset-0 -z-0 opacity-60" aria-hidden />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Wordmark />
        <nav className="flex items-center gap-1 text-sm">
          <a href="#how" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:bg-sunken sm:block">How it works</a>
          <a href="#private" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:bg-sunken sm:block">Privacy</a>
          <a href="#safeguards" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:bg-sunken sm:block">Safeguards</a>
          <Link href="/security" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:bg-sunken sm:block">Security</Link>
          <Link href="/app" className="ml-2 rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:bg-ink-2">Open app</Link>
        </nav>
      </header>

      <main className="relative z-10">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[1.15fr_1fr] lg:pt-16">
          <div>
            <p className="rise text-xs font-medium uppercase tracking-[0.2em] text-brass">Digital inheritance, trust-minimized</p>
            <h1 className="rise rise-2 mt-5 font-display text-[clamp(2.9rem,7vw,5.6rem)] leading-[0.98] tracking-tight text-ink">
              Pass it on.<br />
              <em className="text-accent">Without handing anyone the keys.</em>
            </h1>
            <p className="rise rise-3 mt-6 max-w-xl text-lg leading-relaxed text-ink-2">
              Heirloom encrypts your most important files in your browser and splits the key between guardians you choose. Nobody can open them early, not us, and not any single guardian.
            </p>
            <div className="rise rise-3 mt-8 flex flex-wrap items-center gap-4">
              <Link href="/app" className="rounded-xl bg-accent px-6 py-3 font-medium text-white shadow-[0_10px_24px_-10px_rgba(29,74,57,0.7)] transition-colors hover:bg-accent-hover">Open the app</Link>
              <a href="#how" className="text-sm font-medium text-ink underline decoration-line-strong underline-offset-[6px] hover:decoration-ink">See how it works</a>
            </div>
            <p className="rise rise-3 mt-6 text-sm text-muted">Runs on public testnets today. Needs a browser wallet such as MetaMask.</p>
          </div>
          <div className="rise rise-2"><Hero /></div>
        </section>

        {/* Problem strip */}
        <section className="border-y border-line bg-surface/70">
          <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:px-8 md:grid-cols-2">
            <p className="font-display text-3xl leading-snug text-ink sm:text-4xl">The usual choices are a lawyer who holds everything, or a password in an envelope.</p>
            <p className="self-center text-ink-2">
              The first asks you to trust one person with all of it. The second works until the envelope is lost, read, or forgotten. Heirloom replaces both with rules that are public, enforced by a contract, and decided by several people at once.
            </p>
          </div>
        </section>

        {/* How */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-8 px-5 py-24 sm:px-8">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-brass">How it works</p>
          <h2 className="mt-3 max-w-2xl font-display text-4xl leading-tight text-ink sm:text-5xl">Four steps, and no one in the middle.</h2>
          <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n} className="bg-surface p-6">
                <span className="font-mono text-sm text-brass">{s.n}</span>
                <h3 className="mt-6 font-display text-3xl text-ink">{s.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-ink-2">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Privacy ledger */}
        <section id="private" className="scroll-mt-8 border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-brass">Privacy, specifically</p>
            <h2 className="mt-3 max-w-2xl font-display text-4xl leading-tight text-ink sm:text-5xl">What the world can see, and what never leaves you.</h2>
            <div className="mt-12 grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-line-strong p-6">
                <h3 className="text-sm font-medium uppercase tracking-wider text-muted">Public, on the ledger</h3>
                <dl className="mt-4 divide-y divide-line">
                  {SEES.map(([a, b]) => (
                    <div key={a} className="py-3"><dt className="font-medium">{a}</dt><dd className="text-sm text-ink-2">{b}</dd></div>
                  ))}
                </dl>
              </div>
              <div className="rounded-2xl bg-accent-soft p-6 text-ink">
                <h3 className="text-sm font-medium uppercase tracking-wider text-muted">Never leaves your browser</h3>
                <dl className="mt-4 divide-y divide-accent/15">
                  {NEVER.map(([a, b]) => (
                    <div key={a} className="py-3"><dt className="font-medium">{a}</dt><dd className="text-sm text-ink-2">{b}</dd></div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </section>

        {/* Safeguards */}
        <section id="safeguards" className="mx-auto max-w-6xl scroll-mt-8 px-5 py-24 sm:px-8">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-brass">Safeguards</p>
          <h2 className="mt-3 max-w-2xl font-display text-4xl leading-tight text-ink sm:text-5xl">Built so a mistake can be undone, and a theft cannot hurry.</h2>
          <div className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {SAFEGUARDS.map((s) => (
              <div key={s.t} className="border-t border-line-strong pt-4">
                <h3 className="font-display text-2xl text-ink">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{s.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Roles */}
        <section className="border-y border-line bg-sunken/60">
          <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-brass">Three roles, one address can hold several</p>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {ROLES.map((r) => (
                <div key={r.who} className="rounded-2xl border border-line bg-surface p-6">
                  <h3 className="font-display text-3xl text-ink">{r.who}</h3>
                  <p className="mt-1 text-sm text-muted">{r.line}</p>
                  <ul className="mt-5 space-y-2.5 text-sm text-ink-2">
                    {r.points.map((p) => (
                      <li key={p} className="flex gap-2.5"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brass" />{p}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <div className="flex flex-col items-start justify-between gap-8 rounded-3xl bg-accent px-8 py-14 text-white sm:px-14 md:flex-row md:items-center">
            <h2 className="max-w-xl font-display text-4xl leading-tight sm:text-5xl">Start with one file. Choose who it is for.</h2>
            <Link href="/app" className="shrink-0 rounded-xl bg-paper px-6 py-3 font-medium text-ink transition-colors hover:bg-white">Open the app</Link>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span className="inline-flex items-center gap-2"><LogoMark size={20} /> Heirloom</span>
          <p>A working prototype on public testnets. Not audited. Do not store anything you cannot afford to lose. <Link href="/security" className="underline hover:text-ink">What we store</Link></p>
        </div>
      </footer>
    </div>
  );
}

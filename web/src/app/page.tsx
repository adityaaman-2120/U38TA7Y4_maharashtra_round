import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LogoMark, Wordmark } from "@/components/Logo";

const STEP_IDS = [["01", "s1"], ["02", "s2"], ["03", "s3"], ["04", "s4"]] as const;
const SEE_IDS = ["p1", "p2", "p3", "p4"] as const;
const SAFE_IDS = ["heartbeat", "challenge", "fraud", "freeze", "timelock", "verified", "silent"] as const;
const ROLE_IDS = ["owner", "guardian", "beneficiary"] as const;

type Tr = Awaited<ReturnType<typeof getTranslations<"Landing">>>;

function Hero({ t }: { t: Tr }) {
  const nodes = [
    { x: 240, y: 90, on: true, label: t("shareN", { n: 1 }) },
    { x: 370, y: 315, on: true, label: t("shareN", { n: 2 }) },
    { x: 110, y: 315, on: false, label: t("shareN", { n: 3 }) },
  ];
  return (
    <svg viewBox="0 0 480 480" className="mx-auto h-auto w-full max-w-[460px]" role="img" aria-label={t("heroAria")}>
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
      <text x="240" y="458" textAnchor="middle" fontSize="12" fill="#8b8f96" fontFamily="var(--font-geist-mono), monospace">{t("heroCaption")}</text>
    </svg>
  );
}

export default async function Landing() {
  const t = await getTranslations("Landing");
  return (
    <div className="relative">
      <div className="grain pointer-events-none absolute inset-0 -z-0 opacity-60" aria-hidden />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" aria-label={t("homeLabel")}><Wordmark /></Link>
        <nav className="flex items-center gap-1 text-sm">
          <a href="#how" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:bg-sunken sm:block">{t("navHow")}</a>
          <a href="#private" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:bg-sunken sm:block">{t("navPrivacy")}</a>
          <a href="#safeguards" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:bg-sunken sm:block">{t("navSafeguards")}</a>
          <Link href="/security" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:bg-sunken sm:block">{t("navSecurity")}</Link>
          <LanguageSwitcher className="ml-2" />
          <Link href="/app" className="ml-2 rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:bg-ink-2">{t("navOpenApp")}</Link>
        </nav>
      </header>

      <main className="relative z-10">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[1.15fr_1fr] lg:pt-16">
          <div>
            <p className="rise text-xs font-medium uppercase tracking-[0.2em] text-brass">{t("heroEyebrow")}</p>
            <h1 className="rise rise-2 mt-5 font-display text-[clamp(2.9rem,7vw,5.6rem)] leading-[0.98] tracking-tight text-ink">
              {t("heroTitle1")}<br />
              <em className="text-accent">{t("heroTitle2")}</em>
            </h1>
            <p className="rise rise-3 mt-6 max-w-xl text-lg leading-relaxed text-ink-2">
              {t("heroLead")}
            </p>
            <div className="rise rise-3 mt-8 flex flex-wrap items-center gap-4">
              <Link href="/app" className="rounded-xl bg-accent px-6 py-3 font-medium text-white shadow-[0_10px_24px_-10px_rgba(29,74,57,0.7)] transition-colors hover:bg-accent-hover">{t("ctaOpen")}</Link>
              <a href="#how" className="text-sm font-medium text-ink underline decoration-line-strong underline-offset-[6px] hover:decoration-ink">{t("ctaSee")}</a>
            </div>
            <p className="rise rise-3 mt-6 text-sm text-muted">{t("heroNote")}</p>
          </div>
          <div className="rise rise-2"><Hero t={t} /></div>
        </section>

        {/* Problem strip */}
        <section className="border-y border-line bg-surface/70">
          <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:px-8 md:grid-cols-2">
            <p className="font-display text-3xl leading-snug text-ink sm:text-4xl">{t("problemTitle")}</p>
            <p className="self-center text-ink-2">
              {t("problemBody")}
            </p>
          </div>
        </section>

        {/* How */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-8 px-5 py-24 sm:px-8">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-brass">{t("howEyebrow")}</p>
          <h2 className="mt-3 max-w-2xl font-display text-4xl leading-tight text-ink sm:text-5xl">{t("howTitle")}</h2>
          <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {STEP_IDS.map(([n, id]) => (
              <li key={n} className="bg-surface p-6">
                <span className="font-mono text-sm text-brass">{n}</span>
                <h3 className="mt-6 font-display text-3xl text-ink">{t(`steps.${id}.title`)}</h3>
                <p className="mt-3 text-sm leading-relaxed text-ink-2">{t(`steps.${id}.body`)}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Privacy ledger */}
        <section id="private" className="scroll-mt-8 border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-brass">{t("privEyebrow")}</p>
            <h2 className="mt-3 max-w-2xl font-display text-4xl leading-tight text-ink sm:text-5xl">{t("privTitle")}</h2>
            <div className="mt-12 grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-line-strong p-6">
                <h3 className="text-sm font-medium uppercase tracking-wider text-muted">{t("publicTitle")}</h3>
                <dl className="mt-4 divide-y divide-line">
                  {SEE_IDS.map((id) => (
                    <div key={id} className="py-3"><dt className="font-medium">{t(`sees.${id}.a`)}</dt><dd className="text-sm text-ink-2">{t(`sees.${id}.b`)}</dd></div>
                  ))}
                </dl>
              </div>
              <div className="rounded-2xl bg-accent-soft p-6 text-ink">
                <h3 className="text-sm font-medium uppercase tracking-wider text-muted">{t("neverTitle")}</h3>
                <dl className="mt-4 divide-y divide-accent/15">
                  {SEE_IDS.map((id) => (
                    <div key={id} className="py-3"><dt className="font-medium">{t(`never.${id}.a`)}</dt><dd className="text-sm text-ink-2">{t(`never.${id}.b`)}</dd></div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </section>

        {/* Safeguards */}
        <section id="safeguards" className="mx-auto max-w-6xl scroll-mt-8 px-5 py-24 sm:px-8">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-brass">{t("safeEyebrow")}</p>
          <h2 className="mt-3 max-w-2xl font-display text-4xl leading-tight text-ink sm:text-5xl">{t("safeTitle")}</h2>
          <div className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {SAFE_IDS.map((id) => (
              <div key={id} className="border-t border-line-strong pt-4">
                <h3 className="font-display text-2xl text-ink">{t(`safe.${id}.t`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{t(`safe.${id}.d`)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Roles */}
        <section className="border-y border-line bg-sunken/60">
          <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-brass">{t("rolesEyebrow")}</p>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {ROLE_IDS.map((id) => (
                <div key={id} className="rounded-2xl border border-line bg-surface p-6">
                  <h3 className="font-display text-3xl text-ink">{t(`roles.${id}.who`)}</h3>
                  <p className="mt-1 text-sm text-muted">{t(`roles.${id}.line`)}</p>
                  <ul className="mt-5 space-y-2.5 text-sm text-ink-2">
                    {(["p1", "p2", "p3"] as const).map((p) => (
                      <li key={p} className="flex gap-2.5"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brass" />{t(`roles.${id}.${p}`)}</li>
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
            <h2 className="max-w-xl font-display text-4xl leading-tight sm:text-5xl">{t("ctaTitle")}</h2>
            <Link href="/app" className="shrink-0 rounded-xl bg-paper px-6 py-3 font-medium text-ink transition-colors hover:bg-white">{t("ctaButton")}</Link>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span className="inline-flex items-center gap-2"><LogoMark size={20} /> Heirloom</span>
          <p>{t("footerNote")} <Link href="/security" className="underline hover:text-ink">{t("footerLink")}</Link></p>
        </div>
      </footer>
    </div>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LogoMark, Wordmark } from "@/components/Logo";
import {
  ArrowRightIcon, BellIcon, ChatIcon, CheckIcon, ClockIcon, CoinsIcon, DocIcon, EyeIcon, FileLockIcon, FlagIcon, GiftIcon, GlobeIcon, HourglassIcon,
  IdCardIcon, KeyIcon, SnowflakeIcon, LetterIcon, ListIcon, LockIcon, MailIcon, PulseIcon, RefreshIcon, ShieldIcon, UserIcon, UsersIcon,
} from "@/components/Icons";
import { ProveArt, ReleaseArt, SealArt, SplitArt, TokenChips } from "@/components/landing/Art";

type Tr = Awaited<ReturnType<typeof getTranslations<"Landing">>>;

// Names that are not translated: tokens, protocols and the products this is built on.
const TOKENS = ["POL", "HTT", "USDC"];
const AMOUNT = "1.5 POL";
const TECH = ["Polygon", "Solidity · OpenZeppelin", "Next.js", "Django · Celery", "IPFS · Pinata", "Anon Aadhaar", "Twilio", "Shamir · ECIES"];
const HASHES = ["0x4f2a…c91e", "0x9b17…03d4", "0xe580…7a2b"];
const FILE_NAME = "will.pdf";
const RECOVERY_NAME = "recovery.json";
const UNLOCK_DATE = "2031-01-01";
const CHALLENGE_CLOCK = "24:00";

const STEPS = [
  { id: "s1", n: "01", Art: SealArt },
  { id: "s2", n: "02", Art: SplitArt },
  { id: "s3", n: "03", Art: ProveArt },
  { id: "s4", n: "04", Art: ReleaseArt },
] as const;

const CLAIM_STEPS = [
  { id: "c1", Icon: FlagIcon },
  { id: "c2", Icon: MailIcon },
  { id: "c3", Icon: UsersIcon },
  { id: "c4", Icon: HourglassIcon },
  { id: "c5", Icon: ShieldIcon },
  { id: "c6", Icon: GiftIcon },
] as const;

const SEE_IDS = ["p1", "p2", "p3", "p4"] as const;
const ROLES = [{ id: "owner", Icon: UserIcon }, { id: "guardian", Icon: UsersIcon }, { id: "beneficiary", Icon: GiftIcon }] as const;
const FAQ_IDS = ["q1", "q2", "q3", "q4", "q5"] as const;

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-[0.2em] text-brass">{children}</p>;
}

function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="max-w-2xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-3 font-display text-4xl leading-tight text-ink sm:text-5xl">{title}</h2>
      {sub && <p className="mt-4 text-lg leading-relaxed text-ink-2">{sub}</p>}
    </div>
  );
}

function IconBadge({ children, tone = "accent" }: { children: ReactNode; tone?: "accent" | "brass" }) {
  return <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${tone === "accent" ? "bg-accent-soft text-accent" : "bg-brass-soft text-brass"}`}>{children}</span>;
}

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

function Tile({ id, Icon, t, big = false, children }: { id: string; Icon: (p: { size?: number }) => ReactNode; t: Tr; big?: boolean; children?: ReactNode }) {
  return (
    <div className={`group flex flex-col rounded-2xl border border-line bg-surface p-5 transition duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[0_18px_36px_-22px_rgba(21,24,29,0.35)] ${big ? "sm:col-span-2" : ""}`}>
      <IconBadge><Icon size={22} /></IconBadge>
      <h3 className="mt-4 font-display text-2xl leading-tight text-ink">{t(`feat.${id}.t` as never)}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{t(`feat.${id}.d` as never)}</p>
      {children && <div className="mt-auto pt-5">{children}</div>}
    </div>
  );
}

const IconDot = ({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "brass" }) => (
  <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${tone === "brass" ? "bg-brass-soft text-brass" : "border border-line bg-paper text-ink-2"}`} aria-hidden>{children}</span>
);

const Bars = () => (
  <div className="space-y-1.5" aria-hidden>
    <span className="block h-1.5 w-full rounded-full bg-sunken" /><span className="block h-1.5 w-5/6 rounded-full bg-sunken" /><span className="block h-1.5 w-2/3 rounded-full bg-sunken" />
  </div>
);

const Avatars = () => (
  <div className="flex items-center" aria-hidden>
    {[0, 1, 2].map((i) => (
      <span key={i} className={`-ml-2 inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-surface first:ml-0 ${i < 2 ? "bg-accent text-white" : "bg-sunken text-faint"}`}>
        {i < 2 ? <CheckIcon size={14} /> : <UserIcon size={14} />}
      </span>
    ))}
  </div>
);

const PulseLine = () => (
  <svg viewBox="0 0 160 36" className="h-9 w-full text-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M2 20h38l8-14 12 28 10-20 8 6h82" className="draw" />
  </svg>
);

const Meter = () => (
  <div className="flex items-center gap-3" aria-hidden>
    <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-sunken"><span className="absolute inset-y-0 left-0 w-3/5 rounded-full bg-brass" /></span>
    <span className="font-mono text-xs text-muted">{CHALLENGE_CLOCK}</span>
  </div>
);

const Pill = ({ icon, children, tone = "mint" }: { icon: ReactNode; children: ReactNode; tone?: "mint" | "brass" | "plain" }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${tone === "mint" ? "bg-accent-soft text-accent" : tone === "brass" ? "bg-brass-soft text-brass" : "border border-line bg-paper text-ink-2"}`}>{icon}{children}</span>
);

export default async function Landing() {
  const t = await getTranslations("Landing");
  const chips = ["chip1", "chip2", "chip3", "chip4", "chip5"] as const;
  const stats = ["1", "2", "3", "4"] as const;

  return (
    <div className="relative">
      <div className="grain pointer-events-none absolute inset-0 -z-0 opacity-60" aria-hidden />

      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3.5 sm:px-8">
          <Link href="/" aria-label={t("homeLabel")}><Wordmark /></Link>
          <nav className="flex items-center gap-1 text-sm">
            <a href="#features" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:bg-sunken lg:block">{t("navFeatures")}</a>
            <a href="#how" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:bg-sunken lg:block">{t("navHow")}</a>
            <a href="#claims" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:bg-sunken lg:block">{t("navClaims")}</a>
            <a href="#private" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:bg-sunken lg:block">{t("navPrivacy")}</a>
            <a href="#faq" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:bg-sunken lg:block">{t("navFaq")}</a>
            <Link href="/security" className="hidden rounded-lg px-3 py-2 text-ink-2 hover:bg-sunken lg:block">{t("navSecurity")}</Link>
            <LanguageSwitcher className="ml-2" />
            <Link href="/app" className="ml-2 rounded-lg bg-ink px-4 py-2 font-medium text-paper transition-colors hover:bg-ink-2">{t("navOpenApp")}</Link>
          </nav>
        </div>
      </header>

      <main className="relative z-10">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-10 pt-12 sm:px-8 lg:grid-cols-[1.15fr_1fr] lg:pt-16">
          <div>
            <p className="rise inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-brass"><ShieldIcon size={14} />{t("heroEyebrow")}</p>
            <h1 className="rise rise-2 mt-5 font-display text-[clamp(2.9rem,7vw,5.6rem)] leading-[0.98] tracking-tight text-ink">
              {t("heroTitle1")}<br />
              <em className="text-accent">{t("heroTitle2")}</em>
            </h1>
            <p className="rise rise-3 mt-6 max-w-xl text-lg leading-relaxed text-ink-2">{t("heroLead")}</p>
            <div className="rise rise-3 mt-8 flex flex-wrap items-center gap-4">
              <Link href="/app" className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-3 font-medium text-white shadow-[0_10px_24px_-10px_rgba(29,74,57,0.7)] transition-colors hover:bg-accent-hover">{t("ctaOpen")}<ArrowRightIcon size={18} /></Link>
              <a href="#how" className="text-sm font-medium text-ink underline decoration-line-strong underline-offset-[6px] hover:decoration-ink">{t("ctaSee")}</a>
            </div>
            <p className="rise rise-3 mt-6 text-sm text-muted">{t("heroNote")}</p>
          </div>
          <div className="rise rise-2"><Hero t={t} /></div>
        </section>

        {/* Trust chips */}
        <section className="mx-auto max-w-6xl px-5 pb-12 sm:px-8">
          <ul className="flex flex-wrap gap-2.5">
            {chips.map((c) => <li key={c}><Pill tone="plain" icon={<CheckIcon size={14} />}>{t(c)}</Pill></li>)}
          </ul>
        </section>

        {/* Numbers */}
        <section className="border-y border-line bg-surface/80">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 divide-line px-5 sm:px-8 lg:grid-cols-4 lg:divide-x">
            {stats.map((n) => (
              <div key={n} className="px-2 py-8 lg:px-8 lg:first:pl-0">
                <dt className="font-display text-5xl text-accent">{t(`stat${n}Value`)}</dt>
                <dd className="mt-2 max-w-[16rem] text-sm leading-snug text-ink-2">{t(`stat${n}Label`)}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-24 sm:px-8">
          <SectionHead eyebrow={t("howEyebrow")} title={t("howTitle")} />
          <ol className="relative mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="pointer-events-none absolute left-[12%] right-[12%] top-[158px] hidden border-t-2 border-dashed border-line-strong lg:block" aria-hidden />
            {STEPS.map(({ id, n, Art }) => (
              <li key={id} className="relative rounded-2xl border border-line bg-surface p-5 shadow-[0_1px_0_rgba(21,24,29,0.03)]">
                <div className="flex items-center justify-between"><span className="font-mono text-sm text-brass">{n}</span></div>
                <div className="mt-3"><Art /></div>
                <h3 className="mt-4 font-display text-3xl text-ink">{t(`steps.${id}.title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{t(`steps.${id}.body`)}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-20 border-y border-line bg-sunken/60">
          <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
            <SectionHead eyebrow={t("featEyebrow")} title={t("featTitle")} sub={t("featSub")} />
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Tile id="files" Icon={FileLockIcon} t={t}><Pill icon={<LockIcon size={13} />} tone="plain">{FILE_NAME}</Pill></Tile>
              <Tile id="letters" Icon={LetterIcon} t={t}><Bars /></Tile>
              <Tile id="crypto" Icon={CoinsIcon} t={t} big>
                <TokenChips tokens={TOKENS} amount={AMOUNT} />
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted"><Pill icon={<LockIcon size={13} />} tone="plain">{t("art.locked")}</Pill><ArrowRightIcon size={14} /><Pill icon={<GiftIcon size={13} />} tone="brass">{t("art.releasedAfter")}</Pill></div>
              </Tile>
              <Tile id="guardians" Icon={UsersIcon} t={t}><Avatars /></Tile>
              <Tile id="heartbeat" Icon={PulseIcon} t={t}><PulseLine /></Tile>
              <Tile id="identity" Icon={IdCardIcon} t={t} big>
                <div className="flex flex-wrap gap-2"><Pill icon={<CheckIcon size={13} />}>{t("art.verified")}</Pill><Pill icon={<CheckIcon size={13} />}>{t("art.over18")}</Pill><Pill icon={<EyeIcon size={13} />} tone="plain">{t("art.local")}</Pill></div>
              </Tile>
              <Tile id="challenge" Icon={ClockIcon} t={t}><Meter /></Tile>
              <Tile id="safety" Icon={FlagIcon} t={t}><div className="flex gap-2"><IconDot tone="brass"><FlagIcon size={15} /></IconDot><IconDot><SnowflakeIcon size={15} /></IconDot></div></Tile>
              <Tile id="alerts" Icon={BellIcon} t={t} big>
                <ul className="grid gap-2 text-xs text-ink-2 sm:grid-cols-3">
                  <li className="flex items-center gap-2 rounded-lg bg-paper px-3 py-2"><MailIcon size={15} />{t("art.emailNow")}</li>
                  <li className="flex items-center gap-2 rounded-lg bg-paper px-3 py-2"><ChatIcon size={15} />{t("art.smsLater")}</li>
                  <li className="flex items-center gap-2 rounded-lg bg-paper px-3 py-2"><UsersIcon size={15} />{t("art.guardiansWarned")}</li>
                </ul>
              </Tile>
              <Tile id="timelock" Icon={HourglassIcon} t={t}><Pill icon={<ClockIcon size={13} />} tone="plain">{UNLOCK_DATE}</Pill></Tile>
              <Tile id="audit" Icon={ListIcon} t={t} big>
                <ul className="space-y-1.5 text-xs">
                  {(["evClaim", "evApproved", "evFinal"] as const).map((k, i) => (
                    <li key={k} className="flex items-center justify-between gap-3 rounded-lg bg-paper px-3 py-2"><span className="flex items-center gap-2 text-ink-2"><span className="h-1.5 w-1.5 rounded-full bg-accent" />{t(`art.${k}`)}</span><span className="font-mono text-faint">{HASHES[i]}</span></li>
                  ))}
                </ul>
                <div className="mt-3"><Pill icon={<DocIcon size={13} />} tone="brass">{t("art.exportPdf")}</Pill></div>
              </Tile>
              <Tile id="recovery" Icon={RefreshIcon} t={t}><Pill icon={<DocIcon size={13} />} tone="plain">{RECOVERY_NAME}</Pill></Tile>
            </div>
            <p className="mt-6 flex items-center gap-2 text-sm text-muted"><GlobeIcon size={16} />{t("builtLang")}</p>
          </div>
        </section>

        {/* Claim timeline */}
        <section id="claims" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-24 sm:px-8">
          <SectionHead eyebrow={t("claimsEyebrow")} title={t("claimsTitle")} />
          <ol className="relative mt-14 grid gap-8 lg:grid-cols-6 lg:gap-4">
            <div className="pointer-events-none absolute left-[8%] right-[8%] top-7 hidden border-t-2 border-dashed border-line-strong lg:block" aria-hidden />
            {CLAIM_STEPS.map(({ id, Icon }, i) => (
              <li key={id} className="relative flex gap-4 lg:flex-col lg:items-center lg:gap-0 lg:text-center">
                <span className={`relative z-10 inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 ${i === 5 ? "border-accent bg-accent text-white" : "border-line-strong bg-surface text-accent"}`}><Icon size={22} /></span>
                <div className="lg:mt-4">
                  <h3 className="font-display text-xl text-ink">{t(`claims.${id}.t`)}</h3>
                  <p className="mt-1 text-sm leading-snug text-ink-2">{t(`claims.${id}.d`)}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-12 flex items-center gap-3 rounded-2xl border border-brass/30 bg-brass-soft/70 px-5 py-4 text-ink">
            <PulseIcon size={22} className="shrink-0 text-brass" /><p className="font-medium">{t("claimsStop")}</p>
          </div>
        </section>

        {/* Privacy ledger */}
        <section id="private" className="scroll-mt-20 border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
            <SectionHead eyebrow={t("privEyebrow")} title={t("privTitle")} />
            <div className="mt-12 grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-line-strong p-6">
                <h3 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted"><EyeIcon size={16} />{t("publicTitle")}</h3>
                <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                  {SEE_IDS.map((id) => (
                    <li key={id} className="rounded-xl bg-paper p-4"><p className="font-medium text-ink">{t(`sees.${id}.a`)}</p><p className="mt-1 text-sm text-ink-2">{t(`sees.${id}.b`)}</p></li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl bg-accent p-6 text-white">
                <h3 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-white/70"><LockIcon size={16} />{t("neverTitle")}</h3>
                <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                  {SEE_IDS.map((id) => (
                    <li key={id} className="rounded-xl bg-white/10 p-4"><p className="font-medium">{t(`never.${id}.a`)}</p><p className="mt-1 text-sm text-white/75">{t(`never.${id}.b`)}</p></li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Roles */}
        <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <Eyebrow>{t("rolesEyebrow")}</Eyebrow>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {ROLES.map(({ id, Icon }) => (
              <div key={id} className="rounded-2xl border border-line bg-surface p-6">
                <IconBadge tone="brass"><Icon size={22} /></IconBadge>
                <h3 className="mt-4 font-display text-3xl text-ink">{t(`roles.${id}.who`)}</h3>
                <p className="mt-1 text-sm text-muted">{t(`roles.${id}.line`)}</p>
                <ul className="mt-5 space-y-2.5 text-sm text-ink-2">
                  {(["p1", "p2", "p3"] as const).map((p) => (
                    <li key={p} className="flex gap-2.5"><CheckIcon size={16} className="mt-0.5 shrink-0 text-accent" />{t(`roles.${id}.${p}`)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Built on */}
        <section className="border-y border-line bg-sunken/60">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
            <Eyebrow>{t("builtEyebrow")}</Eyebrow>
            <h2 className="mt-3 font-display text-3xl text-ink sm:text-4xl">{t("builtTitle")}</h2>
            <ul className="mt-8 flex flex-wrap gap-2.5">
              {TECH.map((x) => <li key={x} className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink-2"><KeyIcon size={15} className="text-brass" />{x}</li>)}
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-5 py-24 sm:px-8">
          <div className="text-center"><Eyebrow>{t("faqEyebrow")}</Eyebrow><h2 className="mt-3 font-display text-4xl text-ink sm:text-5xl">{t("faqTitle")}</h2></div>
          <div className="mt-10 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {FAQ_IDS.map((id) => (
              <details key={id} className="group px-5 py-4 open:bg-paper/60">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-ink [&::-webkit-details-marker]:hidden">
                  {t(`faq.${id}.q`)}
                  <span className="text-accent transition-transform duration-200 group-open:rotate-45"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg></span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-ink-2">{t(`faq.${id}.a`)}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-5 pb-24 sm:px-8">
          <div className="relative overflow-hidden rounded-3xl bg-accent px-8 py-14 text-white sm:px-14">
            <svg className="pointer-events-none absolute -right-10 -top-10 h-72 w-72 text-white/[0.07]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3M14 9l2 2" /></svg>
            <div className="relative flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
              <h2 className="max-w-xl font-display text-4xl leading-tight sm:text-5xl">{t("ctaTitle")}</h2>
              <div className="flex shrink-0 flex-wrap items-center gap-3">
                <Link href="/app" className="inline-flex items-center gap-2 rounded-xl bg-paper px-6 py-3 font-medium text-ink transition-colors hover:bg-white">{t("ctaButton")}<ArrowRightIcon size={18} /></Link>
                <Link href="/security" className="rounded-xl border border-white/30 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-white/10">{t("ctaSecondary")}</Link>
              </div>
            </div>
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

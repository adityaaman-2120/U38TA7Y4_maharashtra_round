import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Wordmark } from "@/components/Logo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Security");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

type Row = { what: string; form: string; who: string };

const CHAIN_IDS = ["keys", "vault", "file", "crypto", "shares", "claim", "identity", "history"] as const;
const SERVER_IDS = ["account", "sealed", "aadhaar", "invites", "notifications", "events", "alerts", "session"] as const;
const STORAGE_IDS = ["files", "evidence"] as const;
const NEVER_IDS = ["plaintext", "dek", "privateKey", "shares", "aadhaar"] as const;
const WHY_IDS = ["born", "split", "sealed", "release", "salted"] as const;
const POINT_IDS = ["local", "oneWallet", "bound", "minimal"] as const;
const LIMIT_IDS = ["metadata", "password", "code", "guardians", "identity", "prototype"] as const;

function Table({ title, intro, rows, cols, prefixes }: { title: string; intro: string; rows: Row[]; cols: [string, string, string]; prefixes: [string, string] }) {
  return (
    <section className="mt-14">
      <h2 className="font-display text-3xl text-ink sm:text-4xl">{title}</h2>
      <p className="mt-2 max-w-3xl text-ink-2">{intro}</p>
      <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="hidden grid-cols-[1fr_2fr_1.4fr] gap-6 border-b border-line bg-sunken px-5 py-2.5 text-xs font-medium uppercase tracking-wider text-muted md:grid">
          <span>{cols[0]}</span><span>{cols[1]}</span><span>{cols[2]}</span>
        </div>
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.what} className="grid gap-1 px-5 py-4 md:grid-cols-[1fr_2fr_1.4fr] md:gap-6">
              <p className="font-medium text-ink">{r.what}</p>
              <p className="text-sm leading-relaxed text-ink-2"><span className="text-xs uppercase tracking-wider text-faint md:hidden">{prefixes[0]} </span>{r.form}</p>
              <p className="text-sm leading-relaxed text-muted"><span className="text-xs uppercase tracking-wider text-faint md:hidden">{prefixes[1]} </span>{r.who}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default async function SecurityPage() {
  const t = await getTranslations("Security");
  const b = (c: ReactNode) => <b className="text-ink">{c}</b>;
  const rows = (ns: "chain" | "server" | "storage", ids: readonly string[]): Row[] =>
    ids.map((id) => ({ what: t(`${ns}.${id}.what` as never), form: t(`${ns}.${id}.form` as never), who: t(`${ns}.${id}.who` as never) }));
  const cols: [string, string, string] = [t("colWhat"), t("colForm"), t("colWho")];
  const prefixes: [string, string] = [t("formPrefix"), t("whoPrefix")];

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-5 sm:px-8">
        <Link href="/" aria-label={t("homeLabel")}><Wordmark /></Link>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <Link href="/app" className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-ink-2">{t("openApp")}</Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 pb-24 sm:px-8">
        <p className="mt-8 text-xs font-medium uppercase tracking-[0.2em] text-brass">{t("eyebrow")}</p>
        <h1 className="mt-3 max-w-3xl font-display text-[clamp(2.4rem,6vw,4.2rem)] leading-[1.02] text-ink">{t("title")}</h1>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-ink-2">{t("lead")}</p>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {([1, 2, 3] as const).map((n) => (
            <div key={n} className="rounded-2xl border border-line bg-surface p-5"><p className="font-display text-xl text-ink">{t(`pillar${n}Title`)}</p><p className="mt-1 text-sm text-ink-2">{t(`pillar${n}Body`)}</p></div>
          ))}
        </div>

        <Table title={t("chainTitle")} intro={t("chainIntro")} rows={rows("chain", CHAIN_IDS)} cols={cols} prefixes={prefixes} />
        <Table title={t("serverTitle")} intro={t("serverIntro")} rows={rows("server", SERVER_IDS)} cols={cols} prefixes={prefixes} />
        <Table title={t("storageTitle")} intro={t("storageIntro")} rows={rows("storage", STORAGE_IDS)} cols={cols} prefixes={prefixes} />

        <section className="mt-14 rounded-2xl bg-accent-soft p-6 sm:p-8">
          <h2 className="font-display text-3xl text-ink">{t("neverTitle")}</h2>
          <ul className="mt-4 space-y-2 text-ink">
            {NEVER_IDS.map((id) => <li key={id} className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />{t(`never.${id}`)}</li>)}
          </ul>
        </section>

        <section className="mt-14">
          <h2 className="font-display text-3xl text-ink sm:text-4xl">{t("whyTitle")}</h2>
          <ol className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
            {WHY_IDS.map((id, i) => (
              <li key={id} className="bg-surface p-6">
                <span className="font-mono text-sm text-brass">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-3 font-display text-2xl text-ink">{t(`why.${id}.title`)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{t(`why.${id}.body`)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="identity" className="mt-14 scroll-mt-8 rounded-2xl border border-line bg-surface p-6 sm:p-8">
          <h2 className="font-display text-3xl text-ink sm:text-4xl">{t("identityTitle")}</h2>
          <p className="mt-3 max-w-3xl text-ink-2">{t("identityIntro")}</p>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {POINT_IDS.map((id) => (
              <li key={id} className="border-t border-line-strong pt-3"><p className="font-display text-xl text-ink">{t(`identityPoints.${id}.title`)}</p><p className="mt-1 text-sm leading-relaxed text-ink-2">{t(`identityPoints.${id}.body`)}</p></li>
            ))}
          </ul>
        </section>

        <section className="mt-14">
          <h2 className="font-display text-3xl text-ink sm:text-4xl">{t("limitsTitle")}</h2>
          <p className="mt-2 max-w-3xl text-ink-2">{t("limitsIntro")}</p>
          <dl className="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-2">
            {LIMIT_IDS.map((id) => (
              <div key={id} className="border-t border-line-strong pt-4"><dt className="font-display text-xl text-ink">{t(`limits.${id}.title`)}</dt><dd className="mt-1 text-sm leading-relaxed text-ink-2">{t(`limits.${id}.body`)}</dd></div>
            ))}
          </dl>
        </section>

        <section id="recovery" className="mt-14 scroll-mt-8 rounded-2xl border border-line bg-surface p-6 sm:p-8">
          <h2 className="font-display text-3xl text-ink sm:text-4xl">{t("recoveryTitle")}</h2>
          <div className="mt-4 space-y-4 text-ink-2">
            <p>{t.rich("recoveryNobody", { b })}</p>
            <p>{t.rich("recoveryToday", { b })}</p>
            <ul className="list-disc space-y-1.5 pl-6">
              <li>{t.rich("recoveryUse", { b })}</li>
              <li>{t.rich("recoveryChange", { b })}</li>
              <li>{t.rich("recoveryWorks", { b })}</li>
            </ul>
            <p>{t.rich("recoveryLose", { b })}</p>
            <div className="rounded-xl bg-brass-soft/70 p-4">
              <p className="font-display text-xl text-ink">{t("futureTitle")}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">{t("futureBody")}</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

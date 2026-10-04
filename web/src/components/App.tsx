"use client";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useConnect, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { useHeirloom, useRoles } from "@/lib/hooks";
import { authApi } from "@/lib/api";
import { CHAIN_LABELS, config } from "@/lib/wagmi";
import { getDeployment } from "@/lib/contract";
import { shortAddr } from "@/lib/format";
import { Btn, ListSkeleton } from "./ui";
import { Wordmark } from "./Logo";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { GiftIcon, HomeIcon, ListIcon, LockIcon, ShieldIcon, UserIcon, UsersIcon } from "./Icons";
import { KeyGate, useKey } from "./KeyProvider";
import { IdentityGate } from "./IdentityCard";
import { DeploymentGuard } from "./DeploymentGuard";
import { SessionGate } from "./Session";
import { NAVIGATE_EVENT, NotificationBell } from "./NotificationBell";
import OwnerView from "./OwnerView";
import PeopleView from "./PeopleView";
import GuardianView from "./GuardianView";
import BeneficiaryView from "./BeneficiaryView";
import AuditView from "./AuditView";
import AccountView from "./AccountView";

type View = "owner" | "people" | "guardian" | "beneficiary" | "audit" | "account";

export default function App() {
  return (
    <Shell>
      <Main />
    </Shell>
  );
}

/**
 * Everything a signed-in user needs before any screen: wallet connected, supported network, Sign-In With Ethereum,
 * profile, and an unlocked encryption key. `children` render only once all of that is in place.
 */
export function Shell({ children, prefillEmail, banner }: { children: ReactNode; prefillEmail?: string; banner?: ReactNode }) {
  // Wallet state only exists in the browser; render nothing on the server to avoid hydration mismatches.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return null;
  return (
    <div className="min-h-screen">
      <Header />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {banner}
        <Gate prefillEmail={prefillEmail}>{children}</Gate>
      </div>
    </div>
  );
}

export function Header() {
  const t = useTranslations("Shell");
  const { address, chainId, isConnected } = useHeirloom();
  const { mutate: disconnect } = useDisconnect();
  const leave = async () => {
    await authApi.logout().catch(() => {}); // end the server session too, not just the wallet connection
    disconnect();
  };
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-4">
          <Link href="/" aria-label={t("homeLabel")}><Wordmark /></Link>
          <Link href="/security" className="hidden text-sm text-muted hover:text-ink sm:block">{t("security")}</Link>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <LanguageSwitcher />
          {isConnected && address && (
            <>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 py-1 text-ink-2">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" />
              {chainId !== undefined && CHAIN_LABELS[chainId] ? CHAIN_LABELS[chainId] : `Chain ${chainId}`}
            </span>
            <span className="rounded-full border border-line-strong bg-surface px-3 py-1 font-mono text-xs text-ink-2" data-testid="account">{shortAddr(address)}</span>
            <NotificationBell />
            <Btn tone="ghost" onClick={leave} data-testid="disconnect">{t("disconnect")}</Btn>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Welcome({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-xl pt-6">
      <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-brass">Heirloom</p>
      {children}
    </div>
  );
}

/** Everything before an account exists: a connected wallet on a network Heirloom is deployed on. */
export function WalletGate({ children }: { children: ReactNode }) {
  const t = useTranslations("Shell");
  const { isConnected, supported, deployment, chainId } = useHeirloom();
  const connectors = useConnectors();
  const { mutate: connect, isPending, error } = useConnect();
  const { mutate: switchChain } = useSwitchChain();

  if (!isConnected) {
    const injected = connectors[0];
    return (
      <div className="mx-auto grid max-w-5xl items-center gap-10 pt-6 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-brass">Heirloom</p>
          <h1 className="font-display text-5xl leading-[1.05] text-ink">{t("connectHeading")}</h1>
          <p className="mt-4 text-ink-2">{t("connectBody")}</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Btn disabled={!injected || isPending} onClick={() => injected && connect({ connector: injected })} data-testid="connect" className="px-5 py-2.5">
              {isPending ? t("connecting") : t("connectMetaMask")}
            </Btn>
            <Link href="/" className="text-sm text-muted underline-offset-4 hover:underline">{t("backToOverview")}</Link>
          </div>
          {!injected && <p className="mt-3 text-sm text-warn">{t("noWallet")}</p>}
          {error && <p className="mt-3 text-sm text-bad">{error.message}</p>}
        </div>
        <ul className="space-y-3">
          {([[LockIcon, "assure1"], [UsersIcon, "assure2"], [ListIcon, "assure3"]] as const).map(([Icon, k]) => (
            <li key={k} className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-[0_1px_0_rgba(21,24,29,0.03)]">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><Icon size={22} /></span>
              <span className="font-medium text-ink">{t(k)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (!supported || !deployment) {
    const options = config.chains.filter((c) => getDeployment(c.id));
    return (
      <Welcome>
        <h1 className="font-display text-4xl leading-tight text-ink">{t("switchTitle")}</h1>
        <p className="mt-3 text-warn" data-testid="wrong-network">
          {supported ? t("notDeployed", { chain: CHAIN_LABELS[chainId!] }) : t("unsupportedNetwork")}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {options.map((c) => <Btn key={c.id} onClick={() => switchChain({ chainId: c.id })} data-testid={`switch-${c.id}`}>{t("switchTo", { chain: CHAIN_LABELS[c.id] ?? c.name })}</Btn>)}
        </div>
        {options.length === 0 && <p className="mt-3 text-sm text-muted">{t("noDeployments")}</p>}
      </Welcome>
    );
  }

  return <DeploymentGuard>{children}</DeploymentGuard>;
}

function Gate({ children, prefillEmail }: { children: ReactNode; prefillEmail?: string }) {
  return (
    <WalletGate>
      <SessionGate prefillEmail={prefillEmail}>
        <KeyGate>
          <IdentityGate>{children}</IdentityGate>
        </KeyGate>
      </SessionGate>
    </WalletGate>
  );
}

/** A page that needs only a wallet (no account, no unlocked key), such as the emailed check-in link. */
export function WalletShell({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return null;
  return (
    <div className="min-h-screen">
      <Header />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <WalletGate>{children}</WalletGate>
      </div>
    </div>
  );
}

const NAV_ICON: Record<View, ReactNode> = {
  owner: <HomeIcon size={18} />, people: <UsersIcon size={18} />, guardian: <ShieldIcon size={18} />, beneficiary: <GiftIcon size={18} />, audit: <ListIcon size={18} />, account: <UserIcon size={18} />,
};

function Main() {
  const t = useTranslations("Shell");
  const roles = useRoles();
  const key = useKey();
  const [picked, setPicked] = useState<View | null>(null);

  // The notification bell asks to open a section ("a claim needs your review" -> Guardian).
  useEffect(() => {
    const onNavigate = (e: Event) => setPicked((e as CustomEvent<View>).detail);
    window.addEventListener(NAVIGATE_EVENT, onNavigate);
    return () => window.removeEventListener(NAVIGATE_EVENT, onNavigate);
  }, []);

  const available: View[] = ["owner", "people", ...(roles.isGuardian ? (["guardian"] as const) : []), ...(roles.isBeneficiary ? (["beneficiary"] as const) : []), "audit", "account"];
  const fallback: View = roles.isOwner ? "owner" : roles.isBeneficiary ? "beneficiary" : roles.isGuardian ? "guardian" : "owner";
  const view = picked && available.includes(picked) ? picked : fallback;

  return (
    <div className="grid gap-8 md:grid-cols-[12rem_minmax(0,1fr)]">
      <nav className="flex gap-1.5 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0" aria-label={t("sections")}>
        {available.map((id) => (
          <button key={id} onClick={() => setPicked(id)} data-testid={`nav-${id}`}
            className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3.5 py-2 text-left text-sm font-medium transition-colors ${view === id ? "bg-ink text-paper shadow-sm" : "text-ink-2 hover:bg-sunken"}`}>
            {NAV_ICON[id]}{t(`nav.${id}`)}
          </button>
        ))}
        <div className="hidden border-t border-line md:mt-3 md:block" />
        <button onClick={key.lock} data-testid="lock" className="shrink-0 rounded-lg px-3.5 py-2 text-left text-sm text-muted hover:bg-sunken md:mt-1 flex items-center gap-2.5"><LockIcon size={18} />
          {t("lockKey")}
        </button>
      </nav>
      <main className="min-w-0 space-y-4">
        {roles.loading ? <ListSkeleton rows={3} />
          : view === "owner" ? <OwnerView onGoPeople={() => setPicked("people")} />
          : view === "people" ? <PeopleView />
          : view === "guardian" ? <GuardianView />
          : view === "beneficiary" ? <BeneficiaryView />
          : view === "account" ? <AccountView />
          : <AuditView />}
      </main>
    </div>
  );
}

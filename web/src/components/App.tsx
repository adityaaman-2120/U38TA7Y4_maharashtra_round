"use client";
import Link from "next/link";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useConnect, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { useHeirloom, useRoles } from "@/lib/hooks";
import { CHAIN_LABELS, config } from "@/lib/wagmi";
import { getDeployment } from "@/lib/contract";
import { shortAddr } from "@/lib/format";
import { Btn, ListSkeleton } from "./ui";
import { Wordmark } from "./Logo";
import { KeyGate, useKey } from "./KeyProvider";
import OwnerView from "./OwnerView";
import GuardianView from "./GuardianView";
import BeneficiaryView from "./BeneficiaryView";
import AuditView from "./AuditView";

type View = "owner" | "guardian" | "beneficiary" | "audit";

export default function App() {
  // Wallet state only exists in the browser; render nothing on the server to avoid hydration mismatches.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return null;
  return (
    <div className="min-h-screen">
      <Header />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Gate />
      </div>
    </div>
  );
}

function Header() {
  const { address, chainId, isConnected } = useHeirloom();
  const { mutate: disconnect } = useDisconnect();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" aria-label="Heirloom home"><Wordmark /></Link>
        {isConnected && address && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 py-1 text-ink-2">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" />
              {chainId !== undefined && CHAIN_LABELS[chainId] ? CHAIN_LABELS[chainId] : `Chain ${chainId}`}
            </span>
            <span className="rounded-full border border-line-strong bg-surface px-3 py-1 font-mono text-xs text-ink-2" data-testid="account">{shortAddr(address)}</span>
            <Btn tone="ghost" onClick={() => disconnect()}>Disconnect</Btn>
          </div>
        )}
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

function Gate() {
  const { isConnected, supported, deployment, chainId } = useHeirloom();
  const connectors = useConnectors();
  const { mutate: connect, isPending, error } = useConnect();
  const { mutate: switchChain } = useSwitchChain();

  if (!isConnected) {
    const injected = connectors[0];
    return (
      <Welcome>
        <h1 className="font-display text-5xl leading-[1.05] text-ink">Connect your wallet to begin.</h1>
        <p className="mt-4 text-ink-2">Your wallet is your identity. Everything you upload is encrypted here in your browser first, and your encryption key never leaves it.</p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Btn disabled={!injected || isPending} onClick={() => injected && connect({ connector: injected })} data-testid="connect" className="px-5 py-2.5">
            {isPending ? "Connecting…" : "Connect MetaMask"}
          </Btn>
          <Link href="/" className="text-sm text-muted underline-offset-4 hover:underline">Back to overview</Link>
        </div>
        {!injected && <p className="mt-3 text-sm text-warn">No browser wallet found. Install MetaMask to continue.</p>}
        {error && <p className="mt-3 text-sm text-bad">{error.message}</p>}
      </Welcome>
    );
  }

  if (!supported || !deployment) {
    const options = config.chains.filter((c) => getDeployment(c.id));
    return (
      <Welcome>
        <h1 className="font-display text-4xl leading-tight text-ink">Switch network</h1>
        <p className="mt-3 text-warn" data-testid="wrong-network">
          {supported ? `Heirloom is not deployed on ${CHAIN_LABELS[chainId!]} yet.` : "Your wallet is on a network Heirloom does not support."}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {options.map((c) => <Btn key={c.id} onClick={() => switchChain({ chainId: c.id })} data-testid={`switch-${c.id}`}>Switch to {CHAIN_LABELS[c.id] ?? c.name}</Btn>)}
        </div>
        {options.length === 0 && <p className="mt-3 text-sm text-muted">No deployments found. Run a deploy script in contracts/.</p>}
      </Welcome>
    );
  }

  return (
    <KeyGate>
      <Main />
    </KeyGate>
  );
}

const NAV_LABEL: Record<View, string> = { owner: "My vault", guardian: "Guardian", beneficiary: "Inheritance", audit: "Audit" };

function Main() {
  const roles = useRoles();
  const key = useKey();
  const [picked, setPicked] = useState<View | null>(null);

  const available: View[] = ["owner", ...(roles.isGuardian ? (["guardian"] as const) : []), ...(roles.isBeneficiary ? (["beneficiary"] as const) : []), "audit"];
  const fallback: View = roles.isOwner ? "owner" : roles.isBeneficiary ? "beneficiary" : roles.isGuardian ? "guardian" : "owner";
  const view = picked && available.includes(picked) ? picked : fallback;

  return (
    <div className="grid gap-8 md:grid-cols-[12rem_minmax(0,1fr)]">
      <nav className="flex gap-1.5 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0" aria-label="Sections">
        {available.map((id) => (
          <button key={id} onClick={() => setPicked(id)} data-testid={`nav-${id}`}
            className={`shrink-0 rounded-lg px-3.5 py-2 text-left text-sm font-medium transition-colors ${view === id ? "bg-ink text-paper" : "text-ink-2 hover:bg-sunken"}`}>
            {NAV_LABEL[id]}
          </button>
        ))}
        <div className="hidden border-t border-line md:mt-3 md:block" />
        <button onClick={key.lock} data-testid="lock" className="shrink-0 rounded-lg px-3.5 py-2 text-left text-sm text-muted hover:bg-sunken md:mt-1">
          Lock key
        </button>
      </nav>
      <main className="min-w-0 space-y-4">
        {roles.loading ? <ListSkeleton rows={3} /> : view === "owner" ? <OwnerView /> : view === "guardian" ? <GuardianView /> : view === "beneficiary" ? <BeneficiaryView /> : <AuditView />}
      </main>
    </div>
  );
}

"use client";
import { useState, useSyncExternalStore } from "react";
import { useConnect, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { useHeirloom, useRoles } from "@/lib/hooks";
import { CHAIN_LABELS, config } from "@/lib/wagmi";
import { getDeployment } from "@/lib/contract";
import { shortAddr } from "@/lib/format";
import { Btn, Card } from "./ui";
import { KeyGate, useKey } from "./KeyProvider";
import OwnerView from "./OwnerView";
import GuardianView from "./GuardianView";
import BeneficiaryView from "./BeneficiaryView";
import ActivityView from "./ActivityView";

type View = "owner" | "guardian" | "beneficiary" | "activity";

export default function App() {
  // Wallet state only exists in the browser; render nothing on the server to avoid hydration mismatches.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!mounted) return null;
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <Header />
      <Gate />
    </div>
  );
}

function Header() {
  const { address, chainId, isConnected } = useHeirloom();
  const { mutate: disconnect } = useDisconnect();
  return (
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-2xl font-bold text-slate-100">Heirloom <span className="text-sm font-normal text-slate-400">trust-minimized inheritance</span></h1>
      {isConnected && address && (
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <span className="rounded bg-slate-800 px-2 py-1">{chainId !== undefined && CHAIN_LABELS[chainId] ? CHAIN_LABELS[chainId] : `Chain ${chainId}`}</span>
          <span className="font-mono" data-testid="account">{shortAddr(address)}</span>
          <Btn tone="ghost" onClick={() => disconnect()}>Disconnect</Btn>
        </div>
      )}
    </header>
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
      <Card title="Connect your wallet">
        <p className="text-sm text-slate-300">Heirloom uses MetaMask for identity and transactions. Your files and keys are encrypted in your browser.</p>
        <Btn disabled={!injected || isPending} onClick={() => injected && connect({ connector: injected })} data-testid="connect">{isPending ? "Connecting…" : "Connect MetaMask"}</Btn>
        {!injected && <p className="text-sm text-amber-400">No browser wallet found. Install MetaMask to continue.</p>}
        {error && <p className="text-sm text-red-400">{error.message}</p>}
      </Card>
    );
  }

  if (!supported || !deployment) {
    const options = config.chains.filter((c) => getDeployment(c.id));
    return (
      <Card title="Switch network">
        <p className="text-sm text-amber-400" data-testid="wrong-network">
          {supported ? `Heirloom is not deployed on ${CHAIN_LABELS[chainId!]} yet.` : "Your wallet is on an unsupported network."} Switch to continue.
        </p>
        <div className="flex gap-2">
          {options.map((c) => <Btn key={c.id} onClick={() => switchChain({ chainId: c.id })} data-testid={`switch-${c.id}`}>Switch to {CHAIN_LABELS[c.id] ?? c.name}</Btn>)}
        </div>
        {options.length === 0 && <p className="text-sm text-slate-400">No deployments found. Run a deploy script in contracts/.</p>}
      </Card>
    );
  }

  return (
    <KeyGate>
      <Main />
    </KeyGate>
  );
}

function Main() {
  const roles = useRoles();
  const key = useKey();
  const [picked, setPicked] = useState<View | null>(null);

  const available: { id: View; label: string }[] = [
    { id: "owner", label: "Owner" },
    ...(roles.isGuardian ? [{ id: "guardian" as const, label: "Guardian" }] : []),
    ...(roles.isBeneficiary ? [{ id: "beneficiary" as const, label: "Beneficiary" }] : []),
    { id: "activity", label: "Activity" },
  ];
  const fallback: View = roles.isOwner ? "owner" : roles.isBeneficiary ? "beneficiary" : roles.isGuardian ? "guardian" : "owner";
  const view = picked && available.some((a) => a.id === picked) ? picked : fallback;

  return (
    <div className="grid gap-4 md:grid-cols-[12rem_1fr]">
      <nav className="flex gap-2 md:flex-col" aria-label="Sections">
        {available.map((a) => (
          <button key={a.id} onClick={() => setPicked(a.id)} data-testid={`nav-${a.id}`}
            className={`rounded-lg px-3 py-2 text-left text-sm ${view === a.id ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
            {a.label}
          </button>
        ))}
        <Btn tone="ghost" className="md:mt-4" onClick={key.lock} data-testid="lock">Lock key</Btn>
      </nav>
      <main>
        {roles.loading ? <p className="text-slate-400">Loading…</p> : view === "owner" ? <OwnerView /> : view === "guardian" ? <GuardianView /> : view === "beneficiary" ? <BeneficiaryView /> : <ActivityView />}
      </main>
    </div>
  );
}

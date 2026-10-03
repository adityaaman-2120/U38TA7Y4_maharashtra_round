"use client";
import { useState } from "react";
import { keccak256, toBytes } from "viem";
import { loadClaimBundle, claimState, readers, useHeirloom, useRead, useTx, type ClaimBundle } from "@/lib/hooks";
import { eciesDecrypt, eciesEncrypt, fromHex, toHex } from "@/lib/crypto";
import { humanError } from "@/lib/errors";
import { Btn, EmptyState, Input, ListSkeleton, Stat, StatGrid } from "./ui";
import { ClaimInfo } from "./ClaimInfo";
import { useKey } from "./KeyProvider";

export default function GuardianView() {
  const { address } = useHeirloom();
  const list = useRead(["guardianBundles"], async (c, k) => {
    const ids = await readers.ids(c, k, "claimsByGuardian", address!);
    return Promise.all(ids.map((id) => loadClaimBundle(c, k, id, address!)));
  }, { enabled: Boolean(address) });

  const bundles = [...(list.data ?? [])].reverse();
  const pending = bundles.filter((b) => claimState(b).open && b.response.attestation === 0).length;
  const toRelease = bundles.filter((b) => b.claim.status === 3 && b.released[b.claim.guardians.findIndex((g) => g.toLowerCase() === address?.toLowerCase())] === "0x").length;

  return (
    <div className="space-y-4">
      <StatGrid>
        <Stat label="Awaiting your decision" value={list.isLoading ? "…" : pending} tone={pending ? "warn" : "info"} />
        <Stat label="Shares to release" value={list.isLoading ? "…" : toRelease} tone={toRelease ? "warn" : "info"} />
        <Stat label="Claims seen" value={list.isLoading ? "…" : bundles.length} />
      </StatGrid>
      <h2 className="text-lg font-semibold text-ink">Claims on vaults you guard</h2>
      {list.isLoading ? (
        <ListSkeleton />
      ) : list.isError ? (
        <p className="text-sm text-bad">Could not load claims. Retrying…</p>
      ) : bundles.length === 0 ? (
        <EmptyState title="No claims yet" hint="When a beneficiary raises a claim on a vault you guard, it appears here with the evidence to review." />
      ) : (
        bundles.map((b) => <GuardianClaim key={b.claim.id} bundle={b} />)
      )}
    </div>
  );
}

function GuardianClaim({ bundle }: { bundle: ClaimBundle }) {
  const { address, publicClient, deployment } = useHeirloom();
  const send = useTx();
  const key = useKey();
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const { claim, asset } = bundle;
  const st = claimState(bundle);
  const idx = claim.guardians.findIndex((g) => g.toLowerCase() === address?.toLowerCase());
  const id = BigInt(claim.id);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  };

  const release = () => run(async () => {
    const share = eciesDecrypt(key.getSecret(), fromHex(asset.encShares[idx])); // only this guardian's key can open it
    const benKey = await readers.encryptionKey(publicClient!, deployment!.address, asset.beneficiary);
    if (benKey === "0x") throw new Error("Beneficiary has no registered encryption key");
    await send("Release share", "submitShare", [id, toHex(eciesEncrypt(benKey, share))]);
  });

  const responded = bundle.response.attestation !== 0;
  const mine = bundle.released[idx];
  return (
    <ClaimInfo bundle={bundle} evidence onReviewed={() => setReviewed(true)}>
      {st.open && !responded && !rejecting && (
        <>
          <Btn disabled={busy || bundle.vault.frozen || !reviewed} data-testid="approve" onClick={() => run(() => send("Approve claim", "attest", [id]))}>Approve</Btn>
          <Btn tone="ghost" disabled={busy} data-testid="reject" onClick={() => setRejecting(true)}>Reject</Btn>
          {!reviewed && <span className="text-xs text-warn">Review the evidence before approving.</span>}
        </>
      )}
      {st.open && responded && <span className="text-xs text-muted">You {bundle.response.attestation === 1 ? "approved" : "rejected"} this claim.</span>}
      {st.open && !bundle.response.flagged && !rejecting && (
        <Btn tone="danger" disabled={busy} data-testid="flag" onClick={() => { if (confirm("Flag this claim as fraud? It will be blocked until the owner cancels it.")) run(() => send("Flag fraud", "flagFraud", [id])); }}>
          Flag fraud
        </Btn>
      )}
      {rejecting && (
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <Input placeholder="Reason (only its hash is recorded on-chain)" value={reason} data-testid="reject-reason" onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Btn tone="danger" disabled={busy || !reason.trim()} data-testid="confirm-reject" onClick={() => run(async () => { if (await send("Reject claim", "reject", [id, keccak256(toBytes(reason.trim()))])) setRejecting(false); })}>Confirm</Btn>
            <Btn tone="ghost" onClick={() => setRejecting(false)}>Back</Btn>
          </div>
        </div>
      )}
      {claim.status === 3 && (mine && mine !== "0x"
        ? <span className="text-xs text-ok">Share released ✓</span>
        : <Btn disabled={busy} data-testid="release" onClick={release}>Release my share</Btn>)}
      {error && <p className="w-full text-xs text-bad">{error}</p>}
    </ClaimInfo>
  );
}

"use client";
import { useState } from "react";
import { keccak256, toBytes } from "viem";
import { loadClaimBundle, claimState, readers, useHeirloom, useRead, useTx, type ClaimBundle } from "@/lib/hooks";
import { eciesDecrypt, eciesEncrypt, fromHex, toHex } from "@/lib/crypto";
import { Btn, Card, Empty, Input } from "./ui";
import { ClaimInfo } from "./ClaimInfo";
import { useKey } from "./KeyProvider";

export default function GuardianView() {
  const { address } = useHeirloom();
  const list = useRead(["guardianBundles"], async (c, k) => {
    const ids = await readers.ids(c, k, "claimsByGuardian", address!);
    return Promise.all(ids.map((id) => loadClaimBundle(c, k, id, address!)));
  }, { enabled: Boolean(address) });

  return (
    <Card title="Claims on vaults you guard">
      {list.data?.length === 0 && <Empty>No claims yet. You will see a claim here when a beneficiary raises one.</Empty>}
      {[...(list.data ?? [])].reverse().map((b) => <GuardianClaim key={b.claim.id} bundle={b} />)}
    </Card>
  );
}

function GuardianClaim({ bundle }: { bundle: ClaimBundle }) {
  const { address, publicClient, deployment } = useHeirloom();
  const send = useTx();
  const key = useKey();
  const [busy, setBusy] = useState(false);
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
      setError(e instanceof Error ? e.message : String(e));
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
    <ClaimInfo bundle={bundle} evidence>
      {st.open && !responded && !rejecting && (
        <>
          <Btn disabled={busy || bundle.vault.frozen} data-testid="approve" onClick={() => run(() => send("Approve claim", "attest", [id]))}>Approve</Btn>
          <Btn tone="ghost" disabled={busy} data-testid="reject" onClick={() => setRejecting(true)}>Reject</Btn>
        </>
      )}
      {st.open && responded && <span className="text-xs text-slate-400">You {bundle.response.attestation === 1 ? "approved" : "rejected"} this claim.</span>}
      {st.open && !bundle.response.flagged && !rejecting && (
        <Btn tone="danger" disabled={busy} data-testid="flag" onClick={() => { if (confirm("Flag this claim as fraud? It will be blocked until the owner cancels it.")) run(() => send("Flag fraud", "flagFraud", [id])); }}>
          Flag fraud
        </Btn>
      )}
      {rejecting && (
        <div className="flex w-full gap-2">
          <Input placeholder="Reason (only its hash is recorded on-chain)" value={reason} data-testid="reject-reason" onChange={(e) => setReason(e.target.value)} />
          <Btn tone="danger" disabled={busy || !reason.trim()} data-testid="confirm-reject" onClick={() => run(async () => { if (await send("Reject claim", "reject", [id, keccak256(toBytes(reason.trim()))])) setRejecting(false); })}>Confirm</Btn>
          <Btn tone="ghost" onClick={() => setRejecting(false)}>Back</Btn>
        </div>
      )}
      {claim.status === 3 && (mine && mine !== "0x"
        ? <span className="text-xs text-emerald-400">Share released ✓</span>
        : <Btn disabled={busy} data-testid="release" onClick={release}>Release my share</Btn>)}
      {error && <p className="w-full text-xs text-red-400">{error}</p>}
    </ClaimInfo>
  );
}

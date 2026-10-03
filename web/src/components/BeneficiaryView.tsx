"use client";
import { useState } from "react";
import { EVIDENCE_TYPES } from "@/lib/contract";
import { claimState, loadClaimBundle, readers, useHeirloom, useNow, useRead, useTx, type ClaimBundle } from "@/lib/hooks";
import { combineShares, decryptFile, downloadBytes, eciesDecrypt, fromHex, sealEvidence } from "@/lib/crypto";
import { MAX_UPLOAD_BYTES, fetchCiphertext, pinCiphertext } from "@/lib/storage";
import { fmtDuration, shortAddr, shortHash } from "@/lib/format";
import type { Asset, Vault } from "@/lib/contract";
import { Badge, Btn, Card, Empty, Label, Select } from "./ui";
import { ClaimInfo } from "./ClaimInfo";
import { useKey } from "./KeyProvider";

type Row = { asset: Asset; vault: Vault; bundle: ClaimBundle | null };

export default function BeneficiaryView() {
  const { address } = useHeirloom();
  const list = useRead(["benRows"], async (c, k) => {
    const ids = await readers.ids(c, k, "assetsByBeneficiary", address!);
    return Promise.all(ids.map(async (id): Promise<Row> => {
      const asset = await readers.asset(c, k, id);
      const [vault, bundle] = await Promise.all([
        readers.vault(c, k, asset.owner),
        asset.activeClaim ? loadClaimBundle(c, k, asset.activeClaim, address!) : Promise.resolve(null),
      ]);
      return { asset, vault, bundle };
    }));
  }, { enabled: Boolean(address) });

  return (
    <Card title="Files reserved for you">
      <p className="text-xs text-slate-500">You can see that a file exists, never what it contains, until the guardians release it.</p>
      {list.data?.length === 0 && <Empty>Nothing is reserved for this address.</Empty>}
      {[...(list.data ?? [])].reverse().map((r) => <AssetRow key={r.asset.id} row={r} />)}
    </Card>
  );
}

function* combinations<T>(items: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) { yield acc; return; }
  for (let i = start; i < items.length; i++) yield* combinations(items, k, i + 1, [...acc, items[i]]);
}

function AssetRow({ row }: { row: Row }) {
  const { asset, vault, bundle } = row;
  const now = useNow();
  const send = useTx();
  const key = useKey();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [verified, setVerified] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const p = asset.policy;
  const [evType, setEvType] = useState(p.evidenceType === 2 ? 0 : p.evidenceType);
  const { publicClient, deployment } = useHeirloom();

  const st = bundle ? claimState(bundle) : null;
  const canRaise = !asset.released && (!bundle || (!st!.open && bundle.claim.status !== 3));
  const availableAt = vault.lastHeartbeat + Math.max(p.minInactivity, vault.heartbeatInterval);
  const stale = asset.sharesEpoch !== vault.epoch;
  const tooBig = file ? file.size * 1.4 > MAX_UPLOAD_BYTES : false;

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress("");
      setBusy(false);
    }
  };

  const raise = () => guard(async () => {
    if (!file || !publicClient || !deployment) return;
    setProgress("Reading reviewers' public keys…");
    const reviewers = [...vault.guardians, vault.owner];
    const recipients = await Promise.all(reviewers.map(async (a) => ({ address: a, publicKey: await readers.encryptionKey(publicClient, deployment.address, a) })));
    if (recipients.some((r) => r.publicKey === "0x")) throw new Error("A guardian or the owner has no registered encryption key");
    setProgress("Encrypting evidence in your browser…");
    const { bytes, plaintextHash } = await sealEvidence(file, recipients);
    setProgress("Uploading encrypted evidence…");
    const cid = await pinCiphertext(bytes);
    setProgress("Waiting for wallet…");
    if (await send("Raise claim", "raiseClaim", [BigInt(asset.id), evType, plaintextHash, cid])) setFile(null);
  });

  const decrypt = () => guard(async () => {
    if (!bundle) return;
    setVerified("");
    setProgress("Decrypting released shares…");
    const shares: Uint8Array[] = [];
    for (const s of bundle.released) {
      if (s === "0x") continue;
      try { shares.push(eciesDecrypt(key.getSecret(), fromHex(s))); } catch { /* skip shares not addressed to us */ }
    }
    if (shares.length < vault.threshold) throw new Error(`Only ${shares.length} of ${vault.threshold} required shares are available`);
    setProgress("Downloading ciphertext…");
    const cipher = await fetchCiphertext(asset.storageId);
    setProgress("Reconstructing key and decrypting…");
    // A guardian could publish a bad share; try threshold-sized subsets until one authenticates.
    let result: Awaited<ReturnType<typeof decryptFile>> | null = null;
    for (const subset of combinations(shares, vault.threshold)) {
      try { result = await decryptFile(cipher, await combineShares(subset)); break; } catch { /* try next subset */ }
    }
    if (!result) throw new Error("Could not decrypt: the released shares do not reconstruct a valid key");
    if (result.hash.toLowerCase() !== asset.contentHash.toLowerCase()) throw new Error("INTEGRITY CHECK FAILED: decrypted file does not match the on-chain hash");
    downloadBytes(result.name, result.data);
    setVerified(`Integrity verified ✓ — "${result.name}" (${result.data.length} bytes) matches the SHA-256 recorded on-chain.`);
  });

  const released = bundle ? bundle.released.filter((s) => s !== "0x").length : 0;

  return (
    <div className="space-y-2 rounded-lg border border-slate-700 p-3 text-sm text-slate-300" data-testid={`asset-${asset.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <b>Asset #{asset.id}</b> from {shortAddr(asset.owner)}
        <Badge tone="info">Encrypted</Badge>
        {vault.frozen && <Badge tone="warn">Vault frozen</Badge>}
      </div>
      <p className="text-xs text-slate-400">ciphertext {shortHash(asset.storageId, 6)} · hash {shortHash(asset.contentHash, 6)}</p>

      {bundle && (
        <ClaimInfo bundle={bundle}>
          {st!.open && <Btn disabled={busy} data-testid="finalize" onClick={() => guard(async () => { await send("Finalize claim", "finalizeClaim", [BigInt(bundle.claim.id)]); })}>Finalize</Btn>}
          {bundle.claim.status === 3 && (
            <div className="w-full space-y-1">
              <p className="text-xs text-slate-400">Shares released by guardians: {released} / {vault.threshold} needed</p>
              <Btn disabled={busy || released < vault.threshold} data-testid="decrypt" onClick={decrypt}>{busy && progress ? progress : "Decrypt & download"}</Btn>
            </div>
          )}
        </ClaimInfo>
      )}

      {canRaise && (
        <div className="space-y-2 rounded-lg bg-slate-800/50 p-3">
          <p className="font-medium">Raise a claim</p>
          {now < availableAt && <p className="text-xs text-amber-400">The owner has been active recently. A claim can be raised in {fmtDuration(availableAt - now)}.</p>}
          {stale && <p className="text-xs text-amber-400">The owner changed guardians and has not re-shared this file yet.</p>}
          {vault.frozen && <p className="text-xs text-amber-400">The owner has frozen this vault.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Label text="Evidence type">
              <Select value={evType} onChange={(e) => setEvType(Number(e.target.value))} data-testid="evidence-type">
                {p.evidenceType === 2 ? <><option value={0}>Death</option><option value={1}>Incapacity</option></> : <option value={p.evidenceType}>{EVIDENCE_TYPES[p.evidenceType]}</option>}
              </Select>
            </Label>
            <Label text="Evidence document (encrypted for guardians)">
              <input type="file" data-testid="evidence-file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
            </Label>
          </div>
          {tooBig && <p className="text-xs text-red-400">Evidence file is too large.</p>}
          <Btn disabled={busy || !file || tooBig || now < availableAt || stale || vault.frozen} data-testid="raise-claim" onClick={raise}>
            {busy && progress ? progress : "Raise claim"}
          </Btn>
        </div>
      )}
      {verified && <p className="font-semibold text-emerald-400" data-testid="integrity">{verified}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

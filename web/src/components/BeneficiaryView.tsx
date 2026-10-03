"use client";
import { useRef, useState } from "react";
import { EVIDENCE_TYPES } from "@/lib/contract";
import { claimState, loadClaimBundle, readers, useHeirloom, useNow, useRead, useTx, type ClaimBundle } from "@/lib/hooks";
import { combineShares, decryptFile, downloadBytes, eciesDecrypt, fromHex, isLetter, letterTitle, sealEvidence } from "@/lib/crypto";
import { MAX_UPLOAD_BYTES, fetchCiphertext, pinCiphertext } from "@/lib/storage";
import { fmtDuration, shortAddr, shortHash } from "@/lib/format";
import type { Asset, Vault } from "@/lib/contract";
import { Badge, Btn, EmptyState, Label, ListSkeleton, Select, Stat, StatGrid } from "./ui";
import { humanError } from "@/lib/errors";
import { ClaimInfo } from "./ClaimInfo";
import { Letter } from "./Letter";
import { ZkProofPanel } from "./ZkProofPanel";
import { NO_PROOF, type ZkProof } from "@/lib/zk/proof";
import { useKey } from "./KeyProvider";
import { AmountBadge, BeneficiaryCryptoPanel } from "./CryptoPanels";

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

  const rows = [...(list.data ?? [])].reverse();
  const openClaims = rows.filter((r) => r.bundle && claimState(r.bundle).open).length;
  const ready = rows.filter((r) => r.asset.kind === "data" && r.bundle?.claim.status === 3 && r.bundle.released.filter((x) => x !== "0x").length >= r.vault.threshold).length;

  return (
    <div className="space-y-4">
      <StatGrid>
        <Stat label="Reserved for you" value={list.isLoading ? "…" : rows.length} />
        <Stat label="Open claims" value={list.isLoading ? "…" : openClaims} tone={openClaims ? "warn" : "info"} />
        <Stat label="Ready to open" value={list.isLoading ? "…" : ready + rows.filter((r) => r.asset.kind === "crypto" && r.asset.released && r.asset.balance > 0n).length} tone={ready ? "good" : "info"} />
      </StatGrid>
      <h2 className="text-lg font-semibold text-ink">Reserved for you</h2>
      <p className="text-xs text-faint">You can see that a file exists, never what it contains, until the guardians release it. Funds show their amount, which is public on the blockchain.</p>
      {list.isLoading ? <ListSkeleton /> : list.isError ? <p className="text-sm text-bad">Could not load your files. Retrying…</p> : rows.length === 0 ? (
        <EmptyState title="Nothing is reserved for this address" hint="When someone reserves a file for you, it appears here. Make sure you have registered your encryption key and shared your address with them." />
      ) : rows.map((r) => <AssetRow key={r.asset.id} row={r} />)}
    </div>
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
  const [letter, setLetter] = useState<{ title: string; text: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [zk, setZk] = useState<null | "claim" | "age">(null);
  const expectedClaim = useRef(0);
  const p = asset.policy;
  const [evType, setEvType] = useState(p.evidenceType === 2 ? 0 : p.evidenceType);
  const { address, publicClient, deployment } = useHeirloom();

  const st = bundle ? claimState(bundle) : null;
  const canRaise = !asset.released && (!bundle || (!st!.open && bundle.claim.status !== 3));
  const availableAt = vault.lastHeartbeat + Math.max(p.minInactivity, vault.heartbeatInterval);
  const stale = asset.kind === "data" && asset.sharesEpoch !== vault.epoch;
  const tooBig = file ? file.size * 1.4 > MAX_UPLOAD_BYTES : false;

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setProgress("");
      setBusy(false);
    }
  };

  /** Encrypts and pins the evidence, then raises the claim. `proof` is ignored by the contract unless the policy requires one. */
  const raiseWith = async (proof: ZkProof, expectedId?: number) => {
    if (!file || !publicClient || !deployment) throw new Error("Choose the evidence file first.");
    setProgress("Reading reviewers' public keys…");
    const reviewers = [...vault.guardians, vault.owner];
    const recipients = await Promise.all(reviewers.map(async (a) => ({ address: a, publicKey: await readers.encryptionKey(publicClient, deployment.address, a) })));
    if (recipients.some((r) => r.publicKey === "0x")) throw new Error("A guardian or the owner has no registered encryption key");
    setProgress("Encrypting evidence in your browser…");
    const { bytes, plaintextHash } = await sealEvidence(file, recipients);
    setProgress("Uploading encrypted evidence…");
    const cid = await pinCiphertext(bytes);
    if (expectedId !== undefined) {
      // The proof is bound to the id this claim will get. If someone else's claim landed meanwhile, the id moved on.
      if ((await readers.claimCount(publicClient, deployment.address)) + 1 !== expectedId) {
        throw new Error("Another claim was raised while your proof was being made, so it no longer matches. Please try again.");
      }
    }
    setProgress("Waiting for wallet…");
    if (!(await send("Raise claim", "raiseClaim", [BigInt(asset.id), evType, plaintextHash, cid, proof]))) throw new Error("The claim transaction did not go through.");
    setFile(null);
  };

  const raise = () => {
    if (p.requireBeneficiaryZK) return setZk("claim"); // identity proof first, then the claim
    return guard(() => raiseWith(NO_PROOF));
  };

  const finalize = () => {
    if (!bundle) return;
    if (p.requireAge18) return setZk("age"); // proof that the beneficiary is over 18, then finalize
    return guard(async () => { await send("Finalize claim", "finalizeClaim", [BigInt(bundle.claim.id), NO_PROOF]); });
  };

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
    if (isLetter(result.name)) {
      setLetter({ title: letterTitle(result.name), text: new TextDecoder().decode(result.data) });
      setVerified(`Integrity verified ✓ — the letter matches the SHA-256 recorded on-chain.`);
      return;
    }
    setLetter(null);
    downloadBytes(result.name, result.data);
    setVerified(`Integrity verified ✓ — "${result.name}" (${result.data.length} bytes) matches the SHA-256 recorded on-chain.`);
  });

  const released = bundle ? bundle.released.filter((s) => s !== "0x").length : 0;

  return (
    <div className="space-y-2 rounded-lg border border-line p-3 text-sm text-ink-2" data-testid={`asset-${asset.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <b>Asset #{asset.id}</b> from {shortAddr(asset.owner)}
        {asset.kind === "crypto" ? <AmountBadge asset={asset} /> : <Badge tone="info">Encrypted</Badge>}
        {vault.frozen && <Badge tone="warn">Vault frozen</Badge>}
      </div>
      {asset.kind === "data" ? <p className="text-xs text-muted">ciphertext {shortHash(asset.storageId, 6)} · hash {shortHash(asset.contentHash, 6)}</p> : <BeneficiaryCryptoPanel asset={asset} bundle={bundle} />}

      {bundle && (
        <ClaimInfo bundle={bundle}>
          {st!.open && <Btn disabled={busy || zk !== null} data-testid="finalize" onClick={finalize}>{p.requireAge18 ? "Finalize (proof of age)" : "Finalize"}</Btn>}
          {bundle.claim.status === 3 && asset.kind === "data" && (
            <div className="w-full space-y-1">
              <p className="text-xs text-muted">Shares released by guardians: {released} / {vault.threshold} needed</p>
              <Btn disabled={busy || released < vault.threshold} data-testid="decrypt" onClick={decrypt}>{busy && progress ? progress : "Decrypt & download"}</Btn>
            </div>
          )}
        </ClaimInfo>
      )}

      {canRaise && (
        <div className="space-y-2 rounded-lg bg-sunken p-3">
          <p className="font-medium">Raise a claim</p>
          {now < availableAt && <p className="text-xs text-warn">The owner has been active recently. A claim can be raised in {fmtDuration(availableAt - now)}.</p>}
          {stale && <p className="text-xs text-warn">The owner changed guardians and has not re-shared this file yet.</p>}
          {vault.frozen && <p className="text-xs text-warn">The owner has frozen this vault.</p>}
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
          {tooBig && <p className="text-xs text-bad">Evidence file is too large.</p>}
          {p.requireBeneficiaryZK && <p className="text-xs text-muted" data-testid="zk-claim-note">The owner requires you to prove your identity (zero-knowledge) to raise this claim. You will be asked for your Aadhaar QR; it never leaves your browser.</p>}
          {p.requireAge18 && <p className="text-xs text-muted">Finalizing will also need a proof that you are over 18. Only that one fact is proven.</p>}
          <Btn disabled={busy || zk !== null || !file || tooBig || now < availableAt || stale || vault.frozen} data-testid="raise-claim" onClick={raise}>
            {busy && progress ? progress : p.requireBeneficiaryZK ? "Raise claim (identity proof)" : "Raise claim"}
          </Btn>
        </div>
      )}
      {zk === "claim" && (
        <>
          <ZkProofPanel
            title="Prove your identity to raise this claim"
            intro="The owner asked that only the verified person behind this wallet can start a claim. The proof is made for this claim only and cannot be reused."
            actionLabel="Generate proof and raise claim"
            signal={async () => {
              const next = (await readers.claimCount(publicClient!, deployment!.address)) + 1;
              expectedClaim.current = next;
              return readers.signal(publicClient!, deployment!.address, "claimSignal", [BigInt(next), address]);
            }}
            onProof={async (proof) => {
              try {
                await raiseWith(proof, expectedClaim.current);
                setZk(null);
              } finally {
                setProgress("");
              }
            }}
            onCancel={() => setZk(null)}
          />
          {progress && <p className="text-xs text-muted" data-testid="zk-progress">{progress}</p>}
        </>
      )}
      {zk === "age" && bundle && (
        <ZkProofPanel
          title="Prove you are over 18 to finalize"
          intro="The owner asked for proof that the beneficiary is an adult. This proves that single fact, and is made for this claim only."
          revealAge
          actionLabel="Generate proof and finalize"
          signal={() => readers.signal(publicClient!, deployment!.address, "ageSignal", [BigInt(bundle.claim.id), asset.beneficiary])}
          onProof={async (proof) => {
            if (!(await send("Finalize claim", "finalizeClaim", [BigInt(bundle.claim.id), proof]))) throw new Error("The finalize transaction did not go through.");
            setZk(null);
          }}
          onCancel={() => setZk(null)}
        />
      )}
      {verified && <p className="font-semibold text-ok" data-testid="integrity">{verified}</p>}
      {letter && <Letter title={letter.title} text={letter.text} onClose={() => setLetter(null)} />}
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}

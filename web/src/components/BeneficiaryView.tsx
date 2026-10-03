"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { evidenceLabel } from "@/lib/contract";
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
  const t = useTranslations("Beneficiary");
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
        <Stat label={t("statReserved")} value={list.isLoading ? "…" : rows.length} />
        <Stat label={t("statOpenClaims")} value={list.isLoading ? "…" : openClaims} tone={openClaims ? "warn" : "info"} />
        <Stat label={t("statReady")} value={list.isLoading ? "…" : ready + rows.filter((r) => r.asset.kind === "crypto" && r.asset.released && r.asset.balance > 0n).length} tone={ready ? "good" : "info"} />
      </StatGrid>
      <h2 className="text-lg font-semibold text-ink">{t("heading")}</h2>
      <p className="text-xs text-faint">{t("hint")}</p>
      {list.isLoading ? <ListSkeleton /> : list.isError ? <p className="text-sm text-bad">{t("loadFailed")}</p> : rows.length === 0 ? (
        <EmptyState title={t("emptyTitle")} hint={t("emptyHint")} />
      ) : rows.map((r) => <AssetRow key={r.asset.id} row={r} />)}
    </div>
  );
}

function* combinations<T>(items: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) { yield acc; return; }
  for (let i = start; i < items.length; i++) yield* combinations(items, k, i + 1, [...acc, items[i]]);
}

function AssetRow({ row }: { row: Row }) {
  const t = useTranslations("Beneficiary");
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
    if (!file || !publicClient || !deployment) throw new Error(t("chooseEvidence"));
    setProgress(t("readingKeys"));
    const reviewers = [...vault.guardians, vault.owner];
    const recipients = await Promise.all(reviewers.map(async (a) => ({ address: a, publicKey: await readers.encryptionKey(publicClient, deployment.address, a) })));
    if (recipients.some((r) => r.publicKey === "0x")) throw new Error(t("noReviewerKey"));
    setProgress(t("encryptingEvidence"));
    const { bytes, plaintextHash } = await sealEvidence(file, recipients);
    setProgress(t("uploadingEvidence"));
    const cid = await pinCiphertext(bytes);
    if (expectedId !== undefined) {
      // The proof is bound to the id this claim will get. If someone else's claim landed meanwhile, the id moved on.
      if ((await readers.claimCount(publicClient, deployment.address)) + 1 !== expectedId) {
        throw new Error(t("claimMoved"));
      }
    }
    setProgress(t("waitingWallet"));
    if (!(await send(t("labelRaise"), "raiseClaim", [BigInt(asset.id), evType, plaintextHash, cid, proof]))) throw new Error(t("claimFailed"));
    setFile(null);
  };

  const raise = () => {
    if (p.requireBeneficiaryZK) return setZk("claim"); // identity proof first, then the claim
    return guard(() => raiseWith(NO_PROOF));
  };

  const finalize = () => {
    if (!bundle) return;
    if (p.requireAge18) return setZk("age"); // proof that the beneficiary is over 18, then finalize
    return guard(async () => { await send(t("labelFinalize"), "finalizeClaim", [BigInt(bundle.claim.id), NO_PROOF]); });
  };

  const decrypt = () => guard(async () => {
    if (!bundle) return;
    setVerified("");
    setProgress(t("decryptingShares"));
    const shares: Uint8Array[] = [];
    for (const s of bundle.released) {
      if (s === "0x") continue;
      try { shares.push(eciesDecrypt(key.getSecret(), fromHex(s))); } catch { /* skip shares not addressed to us */ }
    }
    if (shares.length < vault.threshold) throw new Error(t("fewShares", { have: shares.length, need: vault.threshold }));
    setProgress(t("downloading"));
    const cipher = await fetchCiphertext(asset.storageId);
    setProgress(t("reconstructing"));
    // A guardian could publish a bad share; try threshold-sized subsets until one authenticates.
    let result: Awaited<ReturnType<typeof decryptFile>> | null = null;
    for (const subset of combinations(shares, vault.threshold)) {
      try { result = await decryptFile(cipher, await combineShares(subset)); break; } catch { /* try next subset */ }
    }
    if (!result) throw new Error(t("cannotDecrypt"));
    if (result.hash.toLowerCase() !== asset.contentHash.toLowerCase()) throw new Error(t("integrityFailed"));
    if (isLetter(result.name)) {
      setLetter({ title: letterTitle(result.name), text: new TextDecoder().decode(result.data) });
      setVerified(t("verifiedLetter"));
      return;
    }
    setLetter(null);
    downloadBytes(result.name, result.data);
    setVerified(t("verifiedFile", { name: result.name, bytes: result.data.length }));
  });

  const released = bundle ? bundle.released.filter((s) => s !== "0x").length : 0;

  return (
    <div className="space-y-2 rounded-lg border border-line p-3 text-sm text-ink-2" data-testid={`asset-${asset.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        {t.rich("assetFrom", { id: asset.id, owner: shortAddr(asset.owner), b: (c) => <b>{c}</b> })}
        {asset.kind === "crypto" ? <AmountBadge asset={asset} /> : <Badge tone="info">{t("encrypted")}</Badge>}
        {vault.frozen && <Badge tone="warn">{t("vaultFrozen")}</Badge>}
      </div>
      {asset.kind === "data" ? <p className="text-xs text-muted">{t("cipherLine", { cid: shortHash(asset.storageId, 6), hash: shortHash(asset.contentHash, 6) })}</p> : <BeneficiaryCryptoPanel asset={asset} bundle={bundle} />}

      {bundle && (
        <ClaimInfo bundle={bundle}>
          {st!.open && <Btn disabled={busy || zk !== null} data-testid="finalize" onClick={finalize}>{p.requireAge18 ? t("finalizeAge") : t("finalize")}</Btn>}
          {bundle.claim.status === 3 && asset.kind === "data" && (
            <div className="w-full space-y-1">
              <p className="text-xs text-muted">{t("sharesReleased", { released, needed: vault.threshold })}</p>
              <Btn disabled={busy || released < vault.threshold} data-testid="decrypt" onClick={decrypt}>{busy && progress ? progress : t("decrypt")}</Btn>
            </div>
          )}
        </ClaimInfo>
      )}

      {canRaise && (
        <div className="space-y-2 rounded-lg bg-sunken p-3">
          <p className="font-medium">{t("raiseTitle")}</p>
          {now < availableAt && <p className="text-xs text-warn">{t("ownerActive", { duration: fmtDuration(availableAt - now) })}</p>}
          {stale && <p className="text-xs text-warn">{t("ownerChangedGuardians")}</p>}
          {vault.frozen && <p className="text-xs text-warn">{t("ownerFroze")}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Label text={t("evidenceType")}>
              <Select value={evType} onChange={(e) => setEvType(Number(e.target.value))} data-testid="evidence-type">
                {p.evidenceType === 2 ? <><option value={0}>{evidenceLabel(0)}</option><option value={1}>{evidenceLabel(1)}</option></> : <option value={p.evidenceType}>{evidenceLabel(p.evidenceType)}</option>}
              </Select>
            </Label>
            <Label text={t("evidenceDocument")}>
              <input type="file" data-testid="evidence-file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
            </Label>
          </div>
          {tooBig && <p className="text-xs text-bad">{t("evidenceTooBig")}</p>}
          {p.requireBeneficiaryZK && <p className="text-xs text-muted" data-testid="zk-claim-note">{t("zkClaimNote")}</p>}
          {p.requireAge18 && <p className="text-xs text-muted">{t("ageNote")}</p>}
          <Btn disabled={busy || zk !== null || !file || tooBig || now < availableAt || stale || vault.frozen} data-testid="raise-claim" onClick={raise}>
            {busy && progress ? progress : p.requireBeneficiaryZK ? t("raiseIdentity") : t("raise")}
          </Btn>
        </div>
      )}
      {zk === "claim" && (
        <>
          <ZkProofPanel
            title={t("zkClaimTitle")}
            intro={t("zkClaimIntro")}
            actionLabel={t("zkClaimAction")}
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
          title={t("zkAgeTitle")}
          intro={t("zkAgeIntro")}
          revealAge
          actionLabel={t("zkAgeAction")}
          signal={() => readers.signal(publicClient!, deployment!.address, "ageSignal", [BigInt(bundle.claim.id), asset.beneficiary])}
          onProof={async (proof) => {
            if (!(await send(t("labelFinalize"), "finalizeClaim", [BigInt(bundle.claim.id), proof]))) throw new Error(t("finalizeFailed"));
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

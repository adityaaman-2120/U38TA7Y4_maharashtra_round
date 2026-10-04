"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { KeyIcon, ListIcon, ShieldIcon } from "./Icons";
import { keccak256, toBytes } from "viem";
import { loadClaimBundle, claimState, readers, useHeirloom, useRead, useTx, type ClaimBundle } from "@/lib/hooks";
import { eciesDecrypt, eciesEncrypt, fromHex, toHex } from "@/lib/crypto";
import { humanError } from "@/lib/errors";
import { Btn, EmptyState, Input, ListSkeleton, Stat, StatGrid } from "./ui";
import { ClaimInfo } from "./ClaimInfo";
import { useKey } from "./KeyProvider";

export default function GuardianView() {
  const t = useTranslations("Guardian");
  const { address } = useHeirloom();
  const list = useRead(["guardianBundles"], async (c, k) => {
    const ids = await readers.ids(c, k, "claimsByGuardian", address!);
    return Promise.all(ids.map((id) => loadClaimBundle(c, k, id, address!)));
  }, { enabled: Boolean(address) });

  const bundles = [...(list.data ?? [])].reverse();
  const pending = bundles.filter((b) => claimState(b).open && b.response.attestation === 0).length;
  const toRelease = bundles.filter((b) => b.asset.kind === "data" && b.claim.status === 3 && b.released[b.claim.guardians.findIndex((g) => g.toLowerCase() === address?.toLowerCase())] === "0x").length;

  return (
    <div className="space-y-4">
      <StatGrid>
        <Stat label={t("statPending")} value={list.isLoading ? "…" : pending} tone={pending ? "warn" : "info"} icon={<ShieldIcon size={18} />} />
        <Stat label={t("statRelease")} value={list.isLoading ? "…" : toRelease} tone={toRelease ? "warn" : "info"} icon={<KeyIcon size={18} />} />
        <Stat label={t("statSeen")} value={list.isLoading ? "…" : bundles.length} icon={<ListIcon size={18} />} />
      </StatGrid>
      <h2 className="text-lg font-semibold text-ink">{t("heading")}</h2>
      {list.isLoading ? (
        <ListSkeleton />
      ) : list.isError ? (
        <p className="text-sm text-bad">{t("loadFailed")}</p>
      ) : bundles.length === 0 ? (
        <EmptyState title={t("emptyTitle")} hint={t("emptyHint")} />
      ) : (
        bundles.map((b) => <GuardianClaim key={b.claim.id} bundle={b} />)
      )}
    </div>
  );
}

function GuardianClaim({ bundle }: { bundle: ClaimBundle }) {
  const t = useTranslations("Guardian");
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
    if (benKey === "0x") throw new Error(t("noBeneficiaryKey"));
    await send(t("labelRelease"), "submitShare", [id, toHex(eciesEncrypt(benKey, share))]);
  });

  const responded = bundle.response.attestation !== 0;
  const mine = bundle.released[idx];
  return (
    <ClaimInfo bundle={bundle} evidence onReviewed={() => setReviewed(true)}>
      {st.open && !responded && !rejecting && (
        <>
          <Btn disabled={busy || bundle.vault.frozen || !reviewed} data-testid="approve" onClick={() => run(() => send(t("labelApprove"), "attest", [id]))}>{t("approve")}</Btn>
          <Btn tone="ghost" disabled={busy} data-testid="reject" onClick={() => setRejecting(true)}>{t("reject")}</Btn>
          {!reviewed && <span className="text-xs text-warn">{t("reviewFirst")}</span>}
        </>
      )}
      {st.open && responded && <span className="text-xs text-muted">{bundle.response.attestation === 1 ? t("youApproved") : t("youRejected")}</span>}
      {st.open && !bundle.response.flagged && !rejecting && (
        <Btn tone="danger" disabled={busy} data-testid="flag" onClick={() => { if (confirm(t("confirmFlag"))) run(() => send(t("labelFlag"), "flagFraud", [id])); }}>
          {t("flag")}
        </Btn>
      )}
      {rejecting && (
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <Input placeholder={t("reasonPlaceholder")} value={reason} data-testid="reject-reason" onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Btn tone="danger" disabled={busy || !reason.trim()} data-testid="confirm-reject" onClick={() => run(async () => { if (await send(t("labelReject"), "reject", [id, keccak256(toBytes(reason.trim()))])) setRejecting(false); })}>{t("confirm")}</Btn>
            <Btn tone="ghost" onClick={() => setRejecting(false)}>{t("back")}</Btn>
          </div>
        </div>
      )}
      {claim.status === 3 && asset.kind === "data" && (mine && mine !== "0x"
        ? <span className="text-xs text-ok">{t("shareReleased")}</span>
        : <Btn disabled={busy} data-testid="release" onClick={release}>{t("releaseShare")}</Btn>)}
      {claim.status === 3 && asset.kind === "crypto" && <span className="text-xs text-muted">{t("cryptoFinalized")}</span>}
      {error && <p className="w-full text-xs text-bad">{error}</p>}
    </ClaimInfo>
  );
}

"use client";
import { useState } from "react";
import { isAddress, type Address } from "viem";
import { EVIDENCE_TYPES } from "@/lib/contract";
import { loadClaimBundle, readers, useHeirloom, useNow, useRead, useTx, type ClaimBundle } from "@/lib/hooks";
import { encryptFile, eciesEncrypt, splitKey, toHex } from "@/lib/crypto";
import { pinCiphertext, MAX_UPLOAD_BYTES } from "@/lib/storage";
import { UNITS, fmtDuration, fmtTime, shortAddr, shortHash, type Unit } from "@/lib/format";
import { Badge, Btn, Card, EmptyState, Input, Label, ListSkeleton, Mono, Select, Stat, StatGrid } from "./ui";
import { humanError } from "@/lib/errors";
import { claimState } from "@/lib/hooks";
import { ClaimInfo } from "./ClaimInfo";
import { useKey } from "./KeyProvider";

const MIN_SECONDS = 300;
const PUBKEY_RE = /^0x04[0-9a-fA-F]{128}$/;

function Duration({ value, unit, onChange, testId }: { value: number; unit: Unit; onChange: (v: number, u: Unit) => void; testId?: string }) {
  return (
    <div className="flex gap-2">
      <Input type="number" min={1} value={value} data-testid={testId} onChange={(e) => onChange(Number(e.target.value), unit)} />
      <Select value={unit} onChange={(e) => onChange(value, e.target.value as Unit)} className="!w-28">
        {Object.keys(UNITS).map((u) => <option key={u}>{u}</option>)}
      </Select>
    </div>
  );
}
const secs = (v: number, u: Unit) => Math.floor(v * UNITS[u]);

/** Live check that each address is valid and has a registered encryption key. */
function useRegistered(addresses: string[]) {
  const valid = addresses.filter((a) => isAddress(a));
  const q = useRead(["registered", ...valid.map((a) => a.toLowerCase())], async (c, k) => {
    const out: Record<string, boolean> = {};
    await Promise.all(valid.map(async (a) => { out[a.toLowerCase()] = (await readers.encryptionKey(c, k, a as Address)) !== "0x"; }));
    return out;
  }, { enabled: valid.length > 0, interval: 8000 });
  return (a: string): "invalid" | "checking" | "unregistered" | "ok" =>
    !isAddress(a) ? "invalid" : q.data === undefined ? "checking" : q.data[a.toLowerCase()] ? "ok" : "unregistered";
}

const STATUS_TEXT = { invalid: "Not a valid address", checking: "Checking…", unregistered: "No encryption key registered yet", ok: "✓ Encryption key registered" };

export default function OwnerView() {
  const { address } = useHeirloom();
  const hasVault = useRead(["hasVault"], (c, k) => readers.hasVault(c, k, address!), { enabled: Boolean(address) });
  const vault = useRead(["vault"], (c, k) => readers.vault(c, k, address!), { enabled: hasVault.data === true });

  if (hasVault.isLoading || (hasVault.data && vault.isLoading)) return <ListSkeleton rows={2} />;
  return (
    <div className="space-y-4">
      {hasVault.data && vault.data ? (
        <>
          <OwnerStats vault={vault.data} />
          <VaultCard vault={vault.data} />
          <UploadCard vault={vault.data} />
          <AssetsCard />
        </>
      ) : (
        <CreateVault />
      )}
    </div>
  );
}

function CreateVault() {
  const send = useTx();
  const { address } = useHeirloom();
  const [guardians, setGuardians] = useState(["", "", ""]);
  const [threshold, setThreshold] = useState(2);
  const [interval, setInterval_] = useState({ v: 30, u: "days" as Unit });
  const [busy, setBusy] = useState(false);
  const status = useRegistered(guardians);

  const lower = guardians.map((g) => g.toLowerCase());
  const dup = (i: number) => guardians[i] !== "" && lower.indexOf(lower[i]) !== i;
  const self = (i: number) => lower[i] === address?.toLowerCase();
  const allOk = guardians.every((g, i) => status(g) === "ok" && !dup(i) && !self(i));
  const seconds = secs(interval.v, interval.u);
  const th = Math.min(threshold, guardians.length);
  const valid = allOk && seconds >= MIN_SECONDS && th >= 2;

  const submit = async () => {
    setBusy(true);
    await send("Create vault", "createVault", [guardians, th, BigInt(seconds)]);
    setBusy(false);
  };

  return (
    <Card title="Create your vault">
      <p className="text-sm text-muted">
        Choose 3–7 guardians. Each must have signed in to Heirloom and registered an encryption key. Guardians never see your files; together
        (at the threshold) they can release the key to your beneficiaries when you are gone.
      </p>
      {guardians.map((g, i) => (
        <Label key={i} text={`Guardian ${i + 1}`} hint={g === "" ? undefined : dup(i) ? "Duplicate address" : self(i) ? "You cannot be your own guardian" : STATUS_TEXT[status(g)]}>
          <div className="flex gap-2">
            <Input placeholder="0x…" value={g} data-testid={`guardian-${i}`} onChange={(e) => setGuardians(guardians.map((x, j) => (j === i ? e.target.value.trim() : x)))} />
            {guardians.length > 3 && <Btn tone="ghost" onClick={() => setGuardians(guardians.filter((_, j) => j !== i))}>Remove</Btn>}
          </div>
        </Label>
      ))}
      {guardians.length < 7 && <Btn tone="ghost" onClick={() => setGuardians([...guardians, ""])}>+ Add guardian</Btn>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Label text="Guardians needed to reconstruct the key (threshold)">
          <Select value={th} onChange={(e) => setThreshold(Number(e.target.value))} data-testid="threshold">
            {Array.from({ length: guardians.length - 1 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n} of {guardians.length}</option>)}
          </Select>
        </Label>
        <Label text="Check-in interval" hint="How often you promise to check in. Minimum 5 minutes.">
          <Duration value={interval.v} unit={interval.u} onChange={(v, u) => setInterval_({ v, u })} testId="interval" />
        </Label>
      </div>
      <Btn disabled={!valid || busy} onClick={submit} data-testid="create-vault">Create vault</Btn>
    </Card>
  );
}

function VaultCard({ vault }: { vault: import("@/lib/contract").Vault }) {
  const send = useTx();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const due = vault.lastHeartbeat + vault.heartbeatInterval;
  const act = async (label: string, fn: string) => {
    setBusy(true);
    await send(label, fn);
    setBusy(false);
  };
  return (
    <Card title="Your vault" right={vault.frozen ? <Badge tone="warn">Frozen</Badge> : <Badge tone="good">Active</Badge>}>
      <p className="text-sm text-ink-2">
        Last check-in {fmtTime(vault.lastHeartbeat)} ·{" "}
        {now < due ? <>next due in <b data-testid="next-due">{fmtDuration(due - now)}</b></> : <span className="text-warn">overdue by {fmtDuration(now - due)}</span>}
        {" "}· interval {fmtDuration(vault.heartbeatInterval)}
      </p>
      <p className="text-sm text-muted">Guardians (need {vault.threshold} of {vault.guardians.length}):</p>
      <ul className="space-y-0.5">{vault.guardians.map((g) => <li key={g}><Mono>{g}</Mono></li>)}</ul>
      <div className="flex flex-wrap gap-2">
        <Btn disabled={busy} onClick={() => act("Check in", "heartbeat")} data-testid="heartbeat">I&apos;m alive</Btn>
        {vault.frozen
          ? <Btn tone="ghost" disabled={busy} onClick={() => act("Unfreeze vault", "unfreeze")} data-testid="unfreeze">Unfreeze (counts as check-in)</Btn>
          : <Btn tone="danger" disabled={busy} onClick={() => act("Freeze vault", "panicFreeze")} data-testid="freeze">Panic freeze</Btn>}
      </div>
      {vault.frozen && <p className="text-xs text-warn">While frozen, no claim can be raised, approved or finalized.</p>}
    </Card>
  );
}

function UploadCard({ vault }: { vault: import("@/lib/contract").Vault }) {
  const send = useTx();
  const key = useKey();
  const { publicClient, deployment } = useHeirloom();
  const [file, setFile] = useState<File | null>(null);
  const [beneficiary, setBeneficiary] = useState("");
  const [approvals, setApprovals] = useState(vault.threshold);
  const [challenge, setChallenge] = useState({ v: 1, u: "days" as Unit });
  const [inactivity, setInactivity] = useState({ v: 30, u: "days" as Unit });
  const [deadline, setDeadline] = useState({ v: 7, u: "days" as Unit });
  const [unlock, setUnlock] = useState("");
  const [evidence, setEvidence] = useState(2);
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const status = useRegistered([beneficiary]);
  const now = useNow();

  const unlockAfter = unlock ? Math.floor(new Date(unlock).getTime() / 1000) : 0;
  const periodsOk = [challenge, inactivity, deadline].every((d) => secs(d.v, d.u) >= MIN_SECONDS);
  const tooBig = file ? file.size * 1.4 > MAX_UPLOAD_BYTES : false; // headroom for encryption overhead
  const valid = Boolean(file) && !tooBig && status(beneficiary) === "ok" && beneficiary.toLowerCase() !== vault.owner.toLowerCase() && periodsOk && (!unlock || unlockAfter > now);

  const submit = async () => {
    if (!file || !publicClient || !deployment) return;
    setBusy(true);
    setError("");
    try {
      setProgress("Reading guardian public keys…");
      const keys = await Promise.all(vault.guardians.map((g) => readers.encryptionKey(publicClient, deployment.address, g)));
      if (keys.some((k) => !PUBKEY_RE.test(k))) throw new Error("A guardian's registered key is invalid");
      setProgress("Encrypting file in your browser…");
      const { cipher, dek, plaintextHash } = await encryptFile(file);
      setProgress("Uploading ciphertext…");
      const cid = await pinCiphertext(cipher);
      setProgress("Splitting the key and encrypting each share to its guardian…");
      const shares = await splitKey(dek, vault.guardians.length, vault.threshold);
      const encShares = shares.map((s, i) => toHex(eciesEncrypt(keys[i], s)));
      const ownerWrapped = toHex(eciesEncrypt(key.publicKey, dek));
      setProgress("Waiting for wallet…");
      const policy = {
        requiredApprovals: approvals,
        challengePeriod: BigInt(secs(challenge.v, challenge.u)),
        minInactivity: BigInt(secs(inactivity.v, inactivity.u)),
        unlockAfter: BigInt(unlockAfter),
        evidenceType: evidence,
        attestationDeadline: BigInt(secs(deadline.v, deadline.u)),
      };
      const ok = await send("Add asset", "addAsset", [beneficiary, cid, plaintextHash, encShares, ownerWrapped, policy]);
      if (ok) {
        setFile(null);
        setBeneficiary("");
      }
    } catch (e) {
      setError(humanError(e));
    } finally {
      setProgress("");
      setBusy(false);
    }
  };

  return (
    <Card title="Reserve a file for a beneficiary">
      <Label text="File (encrypted in your browser before upload, max ~17 MB)">
        <input type="file" data-testid="asset-file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
      </Label>
      {tooBig && <p className="text-xs text-bad">File is too large.</p>}
      <Label text="Beneficiary address" hint={beneficiary === "" ? undefined : beneficiary.toLowerCase() === vault.owner.toLowerCase() ? "You cannot be your own beneficiary" : STATUS_TEXT[status(beneficiary)]}>
        <Input placeholder="0x…" value={beneficiary} data-testid="beneficiary" onChange={(e) => setBeneficiary(e.target.value.trim())} />
      </Label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label text="Guardian approvals required">
          <Select value={approvals} onChange={(e) => setApprovals(Number(e.target.value))} data-testid="approvals">
            {Array.from({ length: vault.guardians.length - vault.threshold + 1 }, (_, i) => vault.threshold + i).map((n) => <option key={n} value={n}>{n} of {vault.guardians.length}</option>)}
          </Select>
        </Label>
        <Label text="Accepted evidence">
          <Select value={evidence} onChange={(e) => setEvidence(Number(e.target.value))}>
            {EVIDENCE_TYPES.map((t, i) => <option key={t} value={i}>{i === 2 ? "Death or incapacity" : t}</option>)}
          </Select>
        </Label>
        <Label text="Minimum inactivity before a claim" hint="Owner silence required (min 5 minutes)">
          <Duration value={inactivity.v} unit={inactivity.u} onChange={(v, u) => setInactivity({ v, u })} testId="inactivity" />
        </Label>
        <Label text="Challenge period" hint="Time you have to object after a claim (min 5 minutes)">
          <Duration value={challenge.v} unit={challenge.u} onChange={(v, u) => setChallenge({ v, u })} testId="challenge" />
        </Label>
        <Label text="Attestation deadline" hint="After this, the guardian threshold alone suffices (min 5 minutes)">
          <Duration value={deadline.v} unit={deadline.u} onChange={(v, u) => setDeadline({ v, u })} testId="deadline" />
        </Label>
        <Label text="Unlock not before (optional)">
          <Input type="datetime-local" value={unlock} onChange={(e) => setUnlock(e.target.value)} />
        </Label>
      </div>
      {!periodsOk && <p className="text-xs text-bad">Every period must be at least 5 minutes.</p>}
      <Btn disabled={!valid || busy} onClick={submit} data-testid="add-asset">{busy ? progress || "Working…" : "Encrypt & reserve"}</Btn>
      {error && <p className="text-sm text-bad">{error}</p>}
    </Card>
  );
}

function useOwnerAssets() {
  const { address } = useHeirloom();
  return useRead(["ownerAssets"], async (c, k) => {
    const ids = await readers.ids(c, k, "assetsByOwner", address!);
    return Promise.all(ids.map(async (id) => {
      const asset = await readers.asset(c, k, id);
      const bundle: ClaimBundle | null = asset.activeClaim ? await loadClaimBundle(c, k, asset.activeClaim, address!) : null;
      return { asset, bundle };
    }));
  }, { enabled: Boolean(address) });
}

function OwnerStats({ vault }: { vault: import("@/lib/contract").Vault }) {
  const list = useOwnerAssets();
  const now = useNow();
  const open = (list.data ?? []).filter((r) => r.bundle && claimState(r.bundle).open).length;
  const due = vault.lastHeartbeat + vault.heartbeatInterval;
  return (
    <StatGrid>
      <Stat label="Reserved files" value={list.isLoading ? "…" : list.data?.length ?? 0} />
      <Stat label="Open claims" value={list.isLoading ? "…" : open} tone={open ? "bad" : "good"} />
      <Stat label="Next check-in" value={now < due ? fmtDuration(due - now) : "Overdue"} tone={now < due ? "info" : "warn"} />
    </StatGrid>
  );
}

function AssetsCard() {
  const send = useTx();
  const [busy, setBusy] = useState(false);
  const list = useOwnerAssets();

  return (
    <Card title="Reserved files">
      {list.isLoading && <ListSkeleton rows={2} />}
      {list.isError && <p className="text-sm text-bad">Could not load your files. Retrying…</p>}
      {list.data?.length === 0 && <EmptyState title="Nothing reserved yet" hint="Reserve a file above. It is encrypted in your browser and only your chosen beneficiary can ever open it." />}
      {[...(list.data ?? [])].reverse().map(({ asset, bundle }) => (
        <div key={asset.id} className="space-y-2 rounded-lg border border-line p-3 text-sm text-ink-2" data-testid={`asset-${asset.id}`}>
          <div className="flex flex-wrap items-center gap-2">
            <b>Asset #{asset.id}</b> → {shortAddr(asset.beneficiary)}
            {asset.released && <Badge tone="good">Released</Badge>}
          </div>
          <p className="text-xs text-muted">
            ciphertext {shortHash(asset.storageId, 6)} · hash {shortHash(asset.contentHash, 6)} · {asset.policy.requiredApprovals} approvals · challenge {fmtDuration(asset.policy.challengePeriod)} · inactivity {fmtDuration(asset.policy.minInactivity)}
          </p>
          {bundle && (
            <ClaimInfo bundle={bundle} evidence>
              {bundle.claim.status === 1 && (
                <Btn tone="danger" disabled={busy} data-testid="cancel-claim" onClick={async () => { setBusy(true); await send("Cancel claim", "cancelClaim", [BigInt(bundle.claim.id)]); setBusy(false); }}>
                  Cancel claim
                </Btn>
              )}
            </ClaimInfo>
          )}
        </div>
      ))}
    </Card>
  );
}

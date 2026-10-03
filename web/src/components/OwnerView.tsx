"use client";
import { useState } from "react";
import { isAddress, type Address } from "viem";
import { EVIDENCE_TYPES } from "@/lib/contract";
import { loadClaimBundle, readers, useHeirloom, useNow, useRead, useTx, type ClaimBundle } from "@/lib/hooks";
import { MAX_LETTER_CHARS, decryptFile, downloadBytes, eciesDecrypt, encryptFile, eciesEncrypt, fromHex, isLetter, letterTitle, letterToFile, splitKey, toHex } from "@/lib/crypto";
import { fetchCiphertext, pinCiphertext, MAX_UPLOAD_BYTES } from "@/lib/storage";
import { UNITS, fmtDuration, fmtTime, shortAddr, shortHash, type Unit } from "@/lib/format";
import { Badge, Btn, Card, EmptyState, Input, Label, ListSkeleton, Mono, Select, Stat, StatGrid } from "./ui";
import { humanError } from "@/lib/errors";
import { claimState } from "@/lib/hooks";
import { ClaimInfo } from "./ClaimInfo";
import { useContacts } from "@/lib/contacts";
import { NoPeople, PersonSelect, type Person } from "./PersonSelect";
import { Letter } from "./Letter";
import { reshareDek } from "@/lib/rotation";
import { useVerifiedMap } from "@/lib/identity";
import { identityEnabled } from "@/lib/zk/config";
import { VerifiedBadge } from "./VerifiedBadge";
import { useKey } from "./KeyProvider";
import { AmountBadge, CryptoFields, EMPTY_CRYPTO, OwnerCryptoControls, useCreateCrypto, useCryptoInput, type CryptoInput } from "./CryptoPanels";

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

export default function OwnerView({ onGoPeople }: { onGoPeople?: () => void }) {
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
          <GuardianManager vault={vault.data} onGoPeople={onGoPeople} />
          <UploadCard vault={vault.data} onGoPeople={onGoPeople} />
          <AssetsCard vault={vault.data} />
        </>
      ) : (
        <CreateVault onGoPeople={onGoPeople} />
      )}
    </div>
  );
}

function CreateVault({ onGoPeople }: { onGoPeople?: () => void }) {
  const send = useTx();
  const contacts = useContacts("guardian");
  const people: Person[] = (contacts.data ?? []).map((c) => ({ address: c.invitee.address, name: c.invitee.name }));
  const { address, chainId } = useHeirloom();
  const idOn = identityEnabled(chainId);
  const [requireVerified, setRequireVerified] = useState(false);
  const ver = useVerifiedMap(people.map((p) => p.address));
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
  const verifiedOk = !requireVerified || guardians.every((g) => g !== "" && ver.isVerified(g));
  const valid = allOk && seconds >= MIN_SECONDS && th >= 2 && verifiedOk;

  const submit = async () => {
    setBusy(true);
    await send("Create vault", "createVault", [guardians, th, BigInt(seconds), requireVerified]);
    setBusy(false);
  };

  return (
    <Card title="Create your vault">
      <p className="text-sm text-muted">
        Choose 3–7 guardians from the people who have accepted your invitation. Guardians never see your files; together
        (at the threshold) they can release the key to your beneficiaries when you are gone.
      </p>
      {!contacts.isLoading && people.length < 3 && (
        <NoPeople message={`You have ${people.length} accepted guardian${people.length === 1 ? "" : "s"}; a vault needs at least 3. Invite people by email and ask them to accept.`} onGoPeople={onGoPeople} />
      )}
      {guardians.map((g, i) => (
        <Label key={i} text={`Guardian ${i + 1}`} hint={g === "" ? undefined : dup(i) ? "Duplicate address" : self(i) ? "You cannot be your own guardian" : requireVerified && !ver.isVerified(g) ? "Not verified: this vault requires verified guardians" : STATUS_TEXT[status(g)]}>
          <div className="flex gap-2">
            <PersonSelect value={g} people={people} taken={guardians} placeholder="Choose a guardian…" testId={`guardian-${i}`} verified={ver.isVerified}
              onChange={(v) => setGuardians(guardians.map((x, j) => (j === i ? v : x)))} />
            {guardians.length > 3 && <Btn tone="ghost" onClick={() => setGuardians(guardians.filter((_, j) => j !== i))}>Remove</Btn>}
          </div>
        </Label>
      ))}
      {guardians.length < 7 && <Btn tone="ghost" onClick={() => setGuardians([...guardians, ""])}>+ Add guardian</Btn>}
      {idOn && (
        <label className="flex items-start gap-2.5 rounded-lg border border-line bg-sunken/50 p-3 text-sm text-ink-2">
          <input type="checkbox" checked={requireVerified} onChange={(e) => setRequireVerified(e.target.checked)} className="mt-1" data-testid="require-verified" />
          <span>
            <b className="text-ink">Require verified guardians.</b> Every guardian must have proved, with a zero-knowledge proof, that they are one real Aadhaar holder, so one
            person cannot hold several guardian seats. Their Aadhaar data never leaves their browser.
          </span>
        </label>
      )}
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
  const ver = useVerifiedMap(vault.guardians);
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
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
        Guardians (need {vault.threshold} of {vault.guardians.length}):
        {vault.requireVerifiedGuardians && <Badge tone="info">Verified guardians required</Badge>}
      </p>
      <ul className="space-y-1">{vault.guardians.map((g) => <li key={g} className="flex flex-wrap items-center gap-2"><Mono>{g}</Mono><VerifiedBadge verified={ver.isVerified(g)} compact={!ver.enabled} /></li>)}</ul>
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

function GuardianManager({ vault, onGoPeople }: { vault: import("@/lib/contract").Vault; onGoPeople?: () => void }) {
  const send = useTx();
  const key = useKey();
  const { address, publicClient, deployment, chainId } = useHeirloom();
  const idOn = identityEnabled(chainId);
  const contacts = useContacts("guardian");
  const known = new Map((contacts.data ?? []).map((c) => [c.invitee.address.toLowerCase(), c.invitee.name]));
  const owned = useOwnerAssets();
  const [open, setOpen] = useState(false);
  const [guardians, setGuardians] = useState<string[]>(vault.guardians);
  const [threshold, setThreshold] = useState(vault.threshold);
  const [requireVerified, setRequireVerified] = useState(vault.requireVerifiedGuardians);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const status = useRegistered(guardians);
  const ver = useVerifiedMap([...guardians, ...vault.guardians, ...(contacts.data ?? []).map((c) => c.invitee.address)]);
  // New guardians must be accepted contacts; guardians already on the vault stay selectable so they can be kept.
  const rotatePeople: Person[] = [
    ...vault.guardians.map((g) => ({ address: g, name: known.get(g.toLowerCase()) ?? "Current guardian" })),
    ...(contacts.data ?? []).filter((c) => !vault.guardians.some((g) => g.toLowerCase() === c.invitee.address.toLowerCase())).map((c) => ({ address: c.invitee.address, name: c.invitee.name })),
  ];
  const lower = guardians.map((g) => g.toLowerCase());
  const dup = (i: number) => guardians[i] !== "" && lower.indexOf(lower[i]) !== i;
  const th = Math.min(threshold, guardians.length);
  const valid = guardians.length >= 3 && th >= 2 && guardians.every((g, i) => status(g) === "ok" && !dup(i) && lower[i] !== address?.toLowerCase()) && (!requireVerified || guardians.every((g) => ver.isVerified(g)));

  // Files that are still sealed and will be re-split. Released files are final and are left alone.
  const sealed = (owned.data ?? []).filter((r) => !r.asset.released).map((r) => r.asset);
  const overAsked = sealed.filter((a) => a.policy.requiredApprovals > guardians.length);

  const submit = async () => {
    if (!publicClient || !deployment) return;
    setBusy(true);
    setError("");
    let done = 0;
    try {
      // 1. Prove we can open every key BEFORE changing anything on-chain.
      setStep(sealed.length ? "Unlocking your files' keys with your encryption key…" : "Preparing…");
      const deks = sealed.map((a) => ({ id: a.id, dek: eciesDecrypt(key.getSecret(), fromHex(a.ownerWrappedKey)) }));
      setStep("Reading the new guardians' public keys…");
      const keys = await Promise.all(guardians.map((g) => readers.encryptionKey(publicClient, deployment.address, g as Address)));
      if (keys.some((k) => !PUBKEY_RE.test(k))) throw new Error("A guardian's registered key is invalid");
      // 2. Split every key for the new set (pure computation).
      setStep("Splitting each file's key for the new guardians…");
      const prepared = [];
      for (const { id, dek } of deks) prepared.push({ id, ...(await reshareDek(dek, keys, th, key.publicKey)) });
      // 3. Replace the guardians (this also counts as a check-in), then store the new shares per file.
      setStep("Confirm the guardian change in your wallet…");
      if (!(await send("Replace guardians", "rotateGuardians", [guardians, th, requireVerified]))) throw new Error("The guardian change was not confirmed. Nothing was changed.");
      for (const p of prepared) {
        setStep(`Re-sharing file ${++done} of ${prepared.length}…`);
        const ok = await send(`Re-share asset #${p.id}`, "updateAssetShares", [BigInt(p.id), p.encShares, p.ownerWrapped]);
        if (!ok) throw new Error(`Guardians were replaced, but asset #${p.id} was not re-shared yet. Use "Re-share to new guardians" on that file to finish.`);
      }
      setOpen(false);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setStep("");
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-surface px-5 py-3">
        <p className="text-sm text-ink-2">A guardian lost their key or stopped responding? You can replace them at any time.</p>
        <Btn tone="ghost" onClick={() => setOpen(true)} data-testid="open-rotate">Replace guardians</Btn>
      </div>
    );
  }
  return (
    <Card title="Replace guardians">
      <p className="text-sm text-muted">
        This opens each file&apos;s key with your encryption key, splits it again for the new guardians, then updates the vault and every file on-chain.
        It counts as a check-in (any open claim is voided).
        {sealed.length > 0 ? ` ${sealed.length} sealed file${sealed.length === 1 ? "" : "s"} will be re-shared, which takes one wallet confirmation each.` : ""}
      </p>
      {!contacts.isLoading && (contacts.data?.length ?? 0) === 0 && (
        <NoPeople message="To add a new guardian, invite them by email first and wait for them to accept." onGoPeople={onGoPeople} />
      )}
      {guardians.map((g, i) => (
        <Label key={i} text={`Guardian ${i + 1}`} hint={g === "" ? undefined : dup(i) ? "Duplicate address" : requireVerified && !ver.isVerified(g) ? "Not verified: required by the policy below" : STATUS_TEXT[status(g)]}>
          <div className="flex gap-2">
            <PersonSelect value={g} people={rotatePeople} taken={guardians} placeholder="Choose a guardian…" testId={`rotate-guardian-${i}`} verified={ver.isVerified}
              onChange={(v) => setGuardians(guardians.map((x, j) => (j === i ? v : x)))} />
            {guardians.length > 3 && <Btn tone="ghost" onClick={() => setGuardians(guardians.filter((_, j) => j !== i))}>Remove</Btn>}
          </div>
        </Label>
      ))}
      {guardians.length < 7 && <Btn tone="ghost" onClick={() => setGuardians([...guardians, ""])}>+ Add guardian</Btn>}
      {idOn && (
        <label className="flex items-start gap-2.5 rounded-lg border border-line bg-sunken/50 p-3 text-sm text-ink-2">
          <input type="checkbox" checked={requireVerified} onChange={(e) => setRequireVerified(e.target.checked)} className="mt-1" data-testid="rotate-require-verified" />
          <span><b className="text-ink">Require verified guardians.</b> Applies to this set and to later changes.</span>
        </label>
      )}
      <Label text="Threshold">
        <Select value={th} onChange={(e) => setThreshold(Number(e.target.value))}>
          {Array.from({ length: guardians.length - 1 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n} of {guardians.length}</option>)}
        </Select>
      </Label>
      {overAsked.length > 0 && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn" data-testid="rotate-warning">
          {overAsked.map((a) => `Asset #${a.id}`).join(", ")} {overAsked.length === 1 ? "asks" : "ask"} for more approvals than the new set has guardians, so a claim on {overAsked.length === 1 ? "it" : "them"} could only
          finish after its attestation deadline, when the guardian threshold alone is enough.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Btn disabled={!valid || busy || owned.isLoading} data-testid="rotate-submit" onClick={submit}>{busy ? step || "Working…" : "Replace guardians"}</Btn>
        <Btn tone="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Btn>
      </div>
      {error && <p className="text-sm text-bad" data-testid="rotate-error">{error}</p>}
    </Card>
  );
}

function UploadCard({ vault, onGoPeople }: { vault: import("@/lib/contract").Vault; onGoPeople?: () => void }) {
  const send = useTx();
  const beneficiaries = useContacts("beneficiary");
  const benPeople: Person[] = (beneficiaries.data ?? []).map((c) => ({ address: c.invitee.address, name: c.invitee.name }));
  const key = useKey();
  const { publicClient, deployment, chainId } = useHeirloom();
  const idOn = identityEnabled(chainId);
  const [kind, setKind] = useState<"file" | "letter" | "crypto">("file");
  const [crypto, setCrypto] = useState<CryptoInput>(EMPTY_CRYPTO);
  const cryptoIn = useCryptoInput(crypto);
  const createCrypto = useCreateCrypto();
  const [pickedFile, setFile] = useState<File | null>(null);
  const [letterName, setLetterName] = useState("");
  const [letterText, setLetterText] = useState("");
  const [beneficiary, setBeneficiary] = useState("");
  const [approvals, setApprovals] = useState(vault.threshold);
  const [challenge, setChallenge] = useState({ v: 1, u: "days" as Unit });
  const [inactivity, setInactivity] = useState({ v: 30, u: "days" as Unit });
  const [deadline, setDeadline] = useState({ v: 7, u: "days" as Unit });
  const [unlock, setUnlock] = useState("");
  const [evidence, setEvidence] = useState(2);
  const [requireZK, setRequireZK] = useState(false);
  const [requireAge, setRequireAge] = useState(false);
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const status = useRegistered([beneficiary]);
  const benVer = useVerifiedMap([beneficiary, ...benPeople.map((p) => p.address)]);
  const identityOk = !(requireZK || requireAge) || benVer.isVerified(beneficiary);
  const now = useNow();

  const file = kind === "crypto" ? null : kind === "file" ? pickedFile : letterText.trim() ? letterToFile(letterName, letterText) : null;
  const unlockAfter = unlock ? Math.floor(new Date(unlock).getTime() / 1000) : 0;
  const periodsOk = [challenge, inactivity, deadline].every((d) => secs(d.v, d.u) >= MIN_SECONDS);
  const tooBig = file ? file.size * 1.4 > MAX_UPLOAD_BYTES : false; // headroom for encryption overhead
  const benReady = kind === "crypto" ? isAddress(beneficiary) : status(beneficiary) === "ok"; // funds need no encryption key
  const valid = (kind === "crypto" ? cryptoIn.valid : Boolean(file) && !tooBig) && benReady && beneficiary.toLowerCase() !== vault.owner.toLowerCase() && periodsOk && identityOk && (!unlock || unlockAfter > now);

  const policyArgs = () => ({
    requiredApprovals: approvals,
    challengePeriod: BigInt(secs(challenge.v, challenge.u)),
    minInactivity: BigInt(secs(inactivity.v, inactivity.u)),
    unlockAfter: BigInt(unlockAfter),
    evidenceType: evidence,
    attestationDeadline: BigInt(secs(deadline.v, deadline.u)),
    requireBeneficiaryZK: requireZK,
    requireAge18: requireAge,
  });
  const resetPolicyChoices = () => {
    setBeneficiary("");
    setRequireZK(false); // identity checks are a per-asset decision: never carry them over silently
    setRequireAge(false);
  };

  const submitCrypto = async () => {
    setBusy(true);
    setError("");
    try {
      if (await createCrypto(beneficiary, cryptoIn, policyArgs())) {
        setCrypto((c) => ({ ...c, amount: "" }));
        resetPolicyChoices();
      }
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (kind === "crypto") return submitCrypto();
    if (!file || !publicClient || !deployment) return;
    setBusy(true);
    setError("");
    try {
      setProgress("Reading guardian public keys…");
      const keys = await Promise.all(vault.guardians.map((g) => readers.encryptionKey(publicClient, deployment.address, g)));
      if (keys.some((k) => !PUBKEY_RE.test(k))) throw new Error("A guardian's registered key is invalid");
      setProgress(kind === "letter" ? "Encrypting letter in your browser…" : "Encrypting file in your browser…");
      const { cipher, dek, plaintextHash } = await encryptFile(file);
      setProgress("Uploading ciphertext…");
      const cid = await pinCiphertext(cipher);
      setProgress("Splitting the key and encrypting each share to its guardian…");
      const shares = await splitKey(dek, vault.guardians.length, vault.threshold);
      const encShares = shares.map((s, i) => toHex(eciesEncrypt(keys[i], s)));
      const ownerWrapped = toHex(eciesEncrypt(key.publicKey, dek));
      setProgress("Waiting for wallet…");
      const ok = await send("Add asset", "addAsset", [beneficiary, cid, plaintextHash, encShares, ownerWrapped, policyArgs()]);
      if (ok) {
        setFile(null);
        setLetterText("");
        setLetterName("");
        resetPolicyChoices();
      }
    } catch (e) {
      setError(humanError(e));
    } finally {
      setProgress("");
      setBusy(false);
    }
  };

  return (
    <Card title="Reserve something for a beneficiary">
      <div className="inline-flex rounded-lg border border-line-strong bg-sunken p-0.5 text-sm" role="tablist" aria-label="What to reserve">
        {(["file", "letter", "crypto"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)} data-testid={`kind-${k}`}
            className={`rounded-md px-3 py-1.5 font-medium ${kind === k ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
            {k === "file" ? "A file" : k === "letter" ? "A final letter" : "Crypto"}
          </button>
        ))}
      </div>
      {kind === "crypto" ? (
        <CryptoFields input={crypto} onChange={setCrypto} />
      ) : kind === "file" ? (
        <Label text="File (encrypted in your browser before upload, max ~17 MB)">
          <input type="file" data-testid="asset-file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        </Label>
      ) : (
        <div className="space-y-3">
          <Label text="Title (optional)"><Input value={letterName} onChange={(e) => setLetterName(e.target.value)} maxLength={80} placeholder="e.g. For Priya" data-testid="letter-title" /></Label>
          <Label text="Your letter" hint={`${letterText.length.toLocaleString()} / ${MAX_LETTER_CHARS.toLocaleString()} characters. Encrypted in your browser; the beneficiary reads it on screen after release.`}>
            <textarea value={letterText} maxLength={MAX_LETTER_CHARS} onChange={(e) => setLetterText(e.target.value)} rows={8} data-testid="letter-text"
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent" placeholder="Write what you want them to read…" />
          </Label>
        </div>
      )}
      {tooBig && <p className="text-xs text-bad">File is too large.</p>}
      {!beneficiaries.isLoading && benPeople.length === 0 && (
        <NoPeople message="You have no accepted beneficiaries yet. Invite the person by email; once they accept, you can reserve files for them." onGoPeople={onGoPeople} />
      )}
      <Label text="Beneficiary" hint={beneficiary === "" ? undefined : beneficiary.toLowerCase() === vault.owner.toLowerCase() ? "You cannot be your own beneficiary" : kind === "crypto" ? (isAddress(beneficiary) ? undefined : STATUS_TEXT.invalid) : STATUS_TEXT[status(beneficiary)]}>
        <PersonSelect value={beneficiary} people={benPeople} placeholder="Choose a beneficiary…" testId="beneficiary" onChange={setBeneficiary} verified={benVer.isVerified} />
      </Label>
      {idOn && (
        <div className="space-y-2 rounded-lg border border-line bg-sunken/50 p-3 text-sm text-ink-2">
          <p className="font-medium text-ink">Identity checks for the beneficiary (optional)</p>
          <label className="flex items-start gap-2.5">
            <input type="checkbox" checked={requireZK} onChange={(e) => setRequireZK(e.target.checked)} className="mt-1" data-testid="require-zk" />
            <span>Require a fresh identity proof to raise a claim: only the verified person behind this wallet can start it.</span>
          </label>
          <label className="flex items-start gap-2.5">
            <input type="checkbox" checked={requireAge} onChange={(e) => setRequireAge(e.target.checked)} className="mt-1" data-testid="require-age" />
            <span>Require proof that the beneficiary is over 18 to finalize. Only that single fact is proven; no date of birth is stored.</span>
          </label>
          {(requireZK || requireAge) && beneficiary !== "" && !benVer.isVerified(beneficiary) && (
            <p className="text-xs text-warn" data-testid="beneficiary-unverified">This beneficiary has not verified an identity yet. Ask them to verify first (Account page).</p>
          )}
        </div>
      )}
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
      <Btn disabled={!valid || busy} onClick={submit} data-testid="add-asset">{busy ? progress || "Working…" : kind === "crypto" ? "Lock funds & reserve" : kind === "letter" ? "Encrypt letter & reserve" : "Encrypt & reserve"}</Btn>
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
      <Stat label="Reserved assets" value={list.isLoading ? "…" : list.data?.length ?? 0} />
      <Stat label="Open claims" value={list.isLoading ? "…" : open} tone={open ? "bad" : "good"} />
      <Stat label="Next check-in" value={now < due ? fmtDuration(due - now) : "Overdue"} tone={now < due ? "info" : "warn"} />
    </StatGrid>
  );
}

function AssetsCard({ vault }: { vault: import("@/lib/contract").Vault }) {
  const send = useTx();
  const key = useKey();
  const { publicClient, deployment } = useHeirloom();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Record<number, { ok: boolean; text: string }>>({});
  const [letters, setLetters] = useState<Record<number, { title: string; text: string }>>({});
  const list = useOwnerAssets();
  const benVer = useVerifiedMap((list.data ?? []).map((r) => r.asset.beneficiary));

  const guard = async (id: number, fn: () => Promise<string | void>) => {
    setBusy(true);
    try {
      const text = await fn();
      if (text) setNote((n) => ({ ...n, [id]: { ok: true, text } }));
    } catch (e) {
      setNote((n) => ({ ...n, [id]: { ok: false, text: humanError(e) } }));
    } finally {
      setBusy(false);
    }
  };

  // The owner can always recover their own file: the key was also wrapped to the owner's own encryption key.
  const openMine = (asset: import("@/lib/contract").Asset) => guard(asset.id, async () => {
    const dek = eciesDecrypt(key.getSecret(), fromHex(asset.ownerWrappedKey));
    const { name, data, hash } = await decryptFile(await fetchCiphertext(asset.storageId), dek);
    if (hash.toLowerCase() !== asset.contentHash.toLowerCase()) throw new Error("Decrypted file does not match the on-chain hash");
    if (isLetter(name)) {
      setLetters((l) => ({ ...l, [asset.id]: { title: letterTitle(name), text: new TextDecoder().decode(data) } }));
      return "Integrity verified: your letter matches the on-chain hash.";
    }
    downloadBytes(name, data);
    return `Integrity verified: "${name}" matches the on-chain hash.`;
  });

  // After guardians change, re-split the same key to the new guardian set. Needs only the owner's key.
  const reshare = (asset: import("@/lib/contract").Asset) => guard(asset.id, async () => {
    if (!publicClient || !deployment) return;
    const dek = eciesDecrypt(key.getSecret(), fromHex(asset.ownerWrappedKey));
    const keys = await Promise.all(vault.guardians.map((g) => readers.encryptionKey(publicClient, deployment.address, g)));
    if (keys.some((k) => !PUBKEY_RE.test(k))) throw new Error("A guardian's registered key is invalid");
    const { encShares, ownerWrapped } = await reshareDek(dek, keys, vault.threshold, key.publicKey);
    await send("Re-share asset", "updateAssetShares", [BigInt(asset.id), encShares, ownerWrapped]);
  });

  return (
    <Card title="Reserved assets">
      {list.isLoading && <ListSkeleton rows={2} />}
      {list.isError && <p className="text-sm text-bad">Could not load your files. Retrying…</p>}
      {list.data?.length === 0 && <EmptyState title="Nothing reserved yet" hint="Reserve a file above. It is encrypted in your browser and only your chosen beneficiary can ever open it." />}
      {[...(list.data ?? [])].reverse().map(({ asset, bundle }) => (
        <div key={asset.id} className="space-y-2 rounded-lg border border-line p-3 text-sm text-ink-2" data-testid={`asset-${asset.id}`}>
          <div className="flex flex-wrap items-center gap-2">
            <b>Asset #{asset.id}</b> → {shortAddr(asset.beneficiary)}
            {asset.kind === "crypto" && <AmountBadge asset={asset} />}
            {asset.released && <Badge tone="good">Released</Badge>}
            <VerifiedBadge verified={benVer.isVerified(asset.beneficiary)} compact={!benVer.enabled} />
            {asset.policy.requireBeneficiaryZK && <Badge tone="info">Identity proof to claim</Badge>}
            {asset.policy.requireAge18 && <Badge tone="info">Over-18 proof to finalize</Badge>}
            {asset.kind === "data" && !asset.released && asset.sharesEpoch !== vault.epoch && <Badge tone="warn">Needs re-share</Badge>}
          </div>
          <p className="text-xs text-muted">
            {asset.kind === "data" ? `ciphertext ${shortHash(asset.storageId, 6)} · hash ${shortHash(asset.contentHash, 6)} · ` : "crypto · "}{asset.policy.requiredApprovals} approvals · challenge {fmtDuration(asset.policy.challengePeriod)} · inactivity {fmtDuration(asset.policy.minInactivity)}
          </p>
          {asset.kind === "crypto" ? <OwnerCryptoControls asset={asset} bundle={bundle} /> : (
            <div className="flex flex-wrap gap-2">
              <Btn tone="ghost" disabled={busy} data-testid="open-mine" onClick={() => openMine(asset)}>Open my copy</Btn>
              {!asset.released && asset.sharesEpoch !== vault.epoch && (
                <Btn disabled={busy} data-testid="reshare" onClick={() => reshare(asset)}>Re-share to new guardians</Btn>
              )}
            </div>
          )}
          {note[asset.id] && <p className={`text-xs ${note[asset.id].ok ? "text-ok" : "text-bad"}`}>{note[asset.id].text}</p>}
          {letters[asset.id] && <Letter title={letters[asset.id].title} text={letters[asset.id].text} onClose={() => setLetters((l) => Object.fromEntries(Object.entries(l).filter(([k]) => Number(k) !== asset.id)))} />}
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

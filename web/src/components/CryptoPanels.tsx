"use client";
import { useState } from "react";
import { erc20Abi, isAddress, parseUnits, type Address } from "viem";
import { NATIVE, type Asset } from "@/lib/contract";
import { useHeirloom, useRead, useTx, type ClaimBundle } from "@/lib/hooks";
import { fmtAmount, getTestToken, isNative, nativeInfo, readTokenInfo, testTokenAbi, type TokenInfo } from "@/lib/tokens";
import { shortAddr } from "@/lib/format";
import { Badge, Btn, Input, Label, Select } from "./ui";

/** Symbol and decimals of the asset's currency: the chain's native one, or read from the ERC-20. */
export function useTokenInfo(token: Address | undefined) {
  const { chainId } = useHeirloom();
  const erc20 = Boolean(token && !isNative(token));
  const q = useRead(["tokenInfo", token ?? ""], (c) => readTokenInfo(c, token as Address), { enabled: erc20, interval: 60_000 });
  const info: TokenInfo | undefined = !token ? undefined : isNative(token) ? nativeInfo(chainId) : q.data;
  return { info, loading: erc20 && q.isLoading, failed: erc20 && q.isError };
}

/** What the connected wallet holds of the token, and (ERC-20) how much it has approved Heirloom to take. */
function useWallet(token: Address | undefined) {
  const { address, deployment } = useHeirloom();
  const q = useRead(["wallet", token ?? ""], async (c, k) => {
    if (isNative(token!)) return { balance: await c.getBalance({ address: address! }), allowance: undefined };
    const [balance, allowance] = await Promise.all([
      c.readContract({ address: token!, abi: erc20Abi, functionName: "balanceOf", args: [address!] }),
      c.readContract({ address: token!, abi: erc20Abi, functionName: "allowance", args: [address!, k] }),
    ]);
    return { balance, allowance };
  }, { enabled: Boolean(token && address && deployment), interval: 6000 });
  return q.data;
}

/** Deposits an amount into a crypto asset: approves the token first when needed, then calls Heirloom. */
function useDeposit() {
  const send = useTx();
  const { deployment } = useHeirloom();
  return async (label: string, fn: "addCryptoAsset" | "topUp", args: unknown[], token: Address, amount: bigint, allowance: bigint | undefined) => {
    if (!isNative(token) && (allowance ?? 0n) < amount) {
      if (!(await send("Approve token", "approve", [deployment!.address, amount], { to: token, abi: erc20Abi }))) return false;
    }
    return send(label, fn, args, { value: isNative(token) ? amount : undefined });
  };
}

function parseAmount(text: string, decimals: number): bigint | null {
  if (!/^\d*\.?\d+$|^\d+\.$/.test(text.trim())) return null;
  try {
    const v = parseUnits(text.trim(), decimals);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Owner: creating a crypto asset

export type CryptoInput = { choice: "native" | "test" | "custom"; custom: string; amount: string };
export const EMPTY_CRYPTO: CryptoInput = { choice: "native", custom: "", amount: "" };

/** Resolves what the owner typed into a token, a parsed amount and whether the wallet can cover it. */
export function useCryptoInput(input: CryptoInput) {
  const { chainId } = useHeirloom();
  const test = getTestToken(chainId);
  const token: Address | undefined = input.choice === "native" ? NATIVE : input.choice === "test" ? test?.address : isAddress(input.custom) ? (input.custom as Address) : undefined;
  const { info, loading, failed } = useTokenInfo(token);
  const wallet = useWallet(token);
  const amount = info ? parseAmount(input.amount, info.decimals) : null;
  const enough = amount !== null && wallet !== undefined && wallet.balance >= amount;
  return { token, info, loading, failed, wallet, amount, enough, valid: Boolean(token && info && amount !== null && enough) };
}

export function CryptoFields({ input, onChange }: { input: CryptoInput; onChange: (i: CryptoInput) => void }) {
  const { chainId } = useHeirloom();
  const test = getTestToken(chainId);
  const r = useCryptoInput(input);
  return (
    <div className="space-y-3 rounded-lg border border-line bg-sunken/50 p-3" data-testid="crypto-fields">
      <p className="text-xs text-muted">
        The funds are locked in the Heirloom contract and released to the beneficiary only through the same guardian-approved claim as a file.
        <b> Amounts and balances are public on the blockchain.</b> You can top up or withdraw until a claim is raised.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label text="What to lock">
          <Select value={input.choice} onChange={(e) => onChange({ ...input, choice: e.target.value as CryptoInput["choice"] })} data-testid="crypto-token">
            <option value="native">{nativeInfo(chainId).symbol} (native currency)</option>
            {test && <option value="test">{test.symbol} (Heirloom test token)</option>}
            <option value="custom">Another ERC-20 token…</option>
          </Select>
        </Label>
        <Label text="Amount" hint={r.info && r.wallet ? `You hold ${fmtAmount(r.wallet.balance, r.info.decimals)} ${r.info.symbol}` : undefined}>
          <Input inputMode="decimal" placeholder="0.0" value={input.amount} onChange={(e) => onChange({ ...input, amount: e.target.value })} data-testid="crypto-amount" />
        </Label>
      </div>
      {input.choice === "custom" && (
        <Label text="Token contract address" hint={r.loading ? "Reading token…" : r.failed ? "That address is not an ERC-20 token on this network." : r.info ? `✓ ${r.info.symbol}, ${r.info.decimals} decimals` : undefined}>
          <Input placeholder="0x…" value={input.custom} onChange={(e) => onChange({ ...input, custom: e.target.value.trim() })} data-testid="crypto-custom" />
        </Label>
      )}
      {input.choice === "test" && r.token && <Faucet token={r.token} />}
      {r.amount !== null && r.wallet !== undefined && !r.enough && <p className="text-xs text-bad">Your wallet does not hold that much.</p>}
      {r.info && r.token && !isNative(r.token) && r.amount !== null && (r.wallet?.allowance ?? 0n) < r.amount && (
        <p className="text-xs text-muted">Depositing a token takes two wallet confirmations: first you approve exactly this amount, then you deposit it.</p>
      )}
    </div>
  );
}

/** Test networks only: mints worthless test tokens so the crypto flow can be tried. */
function Faucet({ token }: { token: Address }) {
  const send = useTx();
  const [busy, setBusy] = useState(false);
  return (
    <Btn tone="ghost" disabled={busy} data-testid="faucet" onClick={async () => { setBusy(true); await send("Get test tokens", "faucet", [], { to: token, abi: testTokenAbi }); setBusy(false); }}>
      Get 1,000 test tokens (once an hour)
    </Btn>
  );
}

/** Creates the asset. Returns whether it went through. */
export function useCreateCrypto() {
  const deposit = useDeposit();
  return (beneficiary: string, r: ReturnType<typeof useCryptoInput>, policy: unknown) =>
    deposit("Lock funds", "addCryptoAsset", [beneficiary, r.token, r.amount, policy], r.token!, r.amount!, r.wallet?.allowance);
}

// ---------------------------------------------------------------------------------------------------------------------
// Owner: an existing crypto asset

const claimOpen = (bundle: ClaimBundle | null) => bundle !== null && bundle.claim.status === 1;

export function AmountBadge({ asset }: { asset: Asset }) {
  const { info } = useTokenInfo(asset.token);
  return <Badge tone={asset.released ? "good" : "info"}>{info ? `${fmtAmount(asset.balance, info.decimals)} ${info.symbol}` : "…"}</Badge>;
}

export function OwnerCryptoControls({ asset, bundle }: { asset: Asset; bundle: ClaimBundle | null }) {
  const send = useTx();
  const deposit = useDeposit();
  const { info } = useTokenInfo(asset.token);
  const wallet = useWallet(asset.token);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = claimOpen(bundle);
  const value = info ? parseAmount(amount, info.decimals) : null;
  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    if (await fn()) setAmount("");
    setBusy(false);
  };

  if (asset.released) {
    return <p className="text-xs text-muted" data-testid="crypto-state">Released to the beneficiary. {info && asset.balance > 0n ? `${fmtAmount(asset.balance, info.decimals)} ${info.symbol} is waiting for them to withdraw.` : "They have withdrawn it."}</p>;
  }
  return (
    <div className="space-y-2 rounded-lg bg-sunken p-3" data-testid="crypto-controls">
      <p className="text-sm text-ink">
        Locked: <b data-testid="locked-balance">{info ? `${fmtAmount(asset.balance, info.decimals)} ${info.symbol}` : "…"}</b>
        {!isNative(asset.token) && <span className="text-xs text-muted"> · token {shortAddr(asset.token)}</span>}
      </p>
      {locked ? (
        <p className="text-xs text-warn" data-testid="crypto-locked">
          A claim is open on this asset, so deposits and withdrawals are blocked. If this claim is not valid, cancel it below; the funds then unlock.
        </p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input inputMode="decimal" placeholder={`Amount in ${info?.symbol ?? "…"}`} value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="crypto-manage-amount" />
          <div className="flex gap-2">
            <Btn disabled={busy || value === null || (wallet !== undefined && value > wallet.balance)} data-testid="top-up"
              onClick={() => run(() => deposit("Top up", "topUp", [BigInt(asset.id), value], asset.token, value!, wallet?.allowance))}>Top up</Btn>
            <Btn tone="ghost" disabled={busy || value === null || value > asset.balance} data-testid="owner-withdraw"
              onClick={() => run(() => send("Withdraw", "ownerWithdraw", [BigInt(asset.id), value]))}>Withdraw</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Beneficiary

export function BeneficiaryCryptoPanel({ asset, bundle }: { asset: Asset; bundle: ClaimBundle | null }) {
  const send = useTx();
  const { info } = useTokenInfo(asset.token);
  const [busy, setBusy] = useState(false);
  const amount = info ? `${fmtAmount(asset.balance, info.decimals)} ${info.symbol}` : "…";
  const claimed = asset.released && asset.balance === 0n;
  return (
    <div className="space-y-2 rounded-lg bg-sunken p-3" data-testid="crypto-benef">
      <p className="text-sm text-ink">
        {asset.released ? (claimed ? "Withdrawn" : "Available to withdraw") : "Locked for you"}: <b data-testid="locked-balance">{claimed ? "all of it" : amount}</b>
        {!isNative(asset.token) && <span className="text-xs text-muted"> · token {shortAddr(asset.token)}</span>}
      </p>
      {!asset.released && (
        <p className="text-xs text-muted">
          {claimOpen(bundle) ? "A claim is in progress. Once the guardians approve and the claim is finalized, you can withdraw." : "To receive this, raise a claim below. The guardians review it; the owner can still object during the challenge period."}
          {" "}The owner can change the amount until a claim is raised.
        </p>
      )}
      {asset.released && !claimed && (
        <Btn disabled={busy} data-testid="withdraw" onClick={async () => { setBusy(true); await send("Withdraw funds", "withdraw", [BigInt(asset.id)]); setBusy(false); }}>
          Withdraw {amount}
        </Btn>
      )}
    </div>
  );
}

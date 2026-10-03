"use client";
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("Crypto");
  const send = useTx();
  const { deployment } = useHeirloom();
  return async (label: string, fn: "addCryptoAsset" | "topUp", args: unknown[], token: Address, amount: bigint, allowance: bigint | undefined) => {
    if (!isNative(token) && (allowance ?? 0n) < amount) {
      if (!(await send(t("labelApprove"), "approve", [deployment!.address, amount], { to: token, abi: erc20Abi }))) return false;
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
  const t = useTranslations("Crypto");
  const { chainId } = useHeirloom();
  const test = getTestToken(chainId);
  const r = useCryptoInput(input);
  return (
    <div className="space-y-3 rounded-lg border border-line bg-sunken/50 p-3" data-testid="crypto-fields">
      <p className="text-xs text-muted">{t.rich("note", { b: (c: ReactNode) => <b>{c}</b> })}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label text={t("whatToLock")}>
          <Select value={input.choice} onChange={(e) => onChange({ ...input, choice: e.target.value as CryptoInput["choice"] })} data-testid="crypto-token">
            <option value="native">{t("nativeOption", { symbol: nativeInfo(chainId).symbol })}</option>
            {test && <option value="test">{t("testOption", { symbol: test.symbol })}</option>}
            <option value="custom">{t("customOption")}</option>
          </Select>
        </Label>
        <Label text={t("amount")} hint={r.info && r.wallet ? t("youHold", { amount: fmtAmount(r.wallet.balance, r.info.decimals), symbol: r.info.symbol }) : undefined}>
          <Input inputMode="decimal" placeholder="0.0" value={input.amount} onChange={(e) => onChange({ ...input, amount: e.target.value })} data-testid="crypto-amount" />
        </Label>
      </div>
      {input.choice === "custom" && (
        <Label text={t("tokenAddress")} hint={r.loading ? t("reading") : r.failed ? t("notToken") : r.info ? t("tokenOk", { symbol: r.info.symbol, decimals: r.info.decimals }) : undefined}>
          <Input placeholder="0x…" value={input.custom} onChange={(e) => onChange({ ...input, custom: e.target.value.trim() })} data-testid="crypto-custom" />
        </Label>
      )}
      {input.choice === "test" && r.token && <Faucet token={r.token} />}
      {r.amount !== null && r.wallet !== undefined && !r.enough && <p className="text-xs text-bad">{t("notEnough")}</p>}
      {r.info && r.token && !isNative(r.token) && r.amount !== null && (r.wallet?.allowance ?? 0n) < r.amount && (
        <p className="text-xs text-muted">{t("twoConfirmations")}</p>
      )}
    </div>
  );
}

/** Test networks only: mints worthless test tokens so the crypto flow can be tried. */
function Faucet({ token }: { token: Address }) {
  const t = useTranslations("Crypto");
  const send = useTx();
  const [busy, setBusy] = useState(false);
  return (
    <Btn tone="ghost" disabled={busy} data-testid="faucet" onClick={async () => { setBusy(true); await send(t("labelFaucet"), "faucet", [], { to: token, abi: testTokenAbi }); setBusy(false); }}>
      {t("faucet")}
    </Btn>
  );
}

/** Creates the asset. Returns whether it went through. */
export function useCreateCrypto() {
  const t = useTranslations("Crypto");
  const deposit = useDeposit();
  return (beneficiary: string, r: ReturnType<typeof useCryptoInput>, policy: unknown) =>
    deposit(t("labelLock"), "addCryptoAsset", [beneficiary, r.token, r.amount, policy], r.token!, r.amount!, r.wallet?.allowance);
}

// ---------------------------------------------------------------------------------------------------------------------
// Owner: an existing crypto asset

const claimOpen = (bundle: ClaimBundle | null) => bundle !== null && bundle.claim.status === 1;

export function AmountBadge({ asset }: { asset: Asset }) {
  const { info } = useTokenInfo(asset.token);
  return <Badge tone={asset.released ? "good" : "info"}>{info ? `${fmtAmount(asset.balance, info.decimals)} ${info.symbol}` : "…"}</Badge>;
}

export function OwnerCryptoControls({ asset, bundle }: { asset: Asset; bundle: ClaimBundle | null }) {
  const t = useTranslations("Crypto");
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
    return <p className="text-xs text-muted" data-testid="crypto-state">{t("released")} {info && asset.balance > 0n ? t("waiting", { amount: `${fmtAmount(asset.balance, info.decimals)} ${info.symbol}` }) : t("withdrawn")}</p>;
  }
  return (
    <div className="space-y-2 rounded-lg bg-sunken p-3" data-testid="crypto-controls">
      <p className="text-sm text-ink">
        {t("locked")} <b data-testid="locked-balance">{info ? `${fmtAmount(asset.balance, info.decimals)} ${info.symbol}` : "…"}</b>
        {!isNative(asset.token) && <span className="text-xs text-muted"> · {t("tokenSuffix", { address: shortAddr(asset.token) })}</span>}
      </p>
      {locked ? (
        <p className="text-xs text-warn" data-testid="crypto-locked">
          {t("claimOpen")}
        </p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input inputMode="decimal" placeholder={t("amountPlaceholder", { symbol: info?.symbol ?? "…" })} value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="crypto-manage-amount" />
          <div className="flex gap-2">
            <Btn disabled={busy || value === null || (wallet !== undefined && value > wallet.balance)} data-testid="top-up"
              onClick={() => run(() => deposit(t("labelTopUp"), "topUp", [BigInt(asset.id), value], asset.token, value!, wallet?.allowance))}>{t("topUp")}</Btn>
            <Btn tone="ghost" disabled={busy || value === null || value > asset.balance} data-testid="owner-withdraw"
              onClick={() => run(() => send(t("labelWithdraw"), "ownerWithdraw", [BigInt(asset.id), value]))}>{t("withdraw")}</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Beneficiary

export function BeneficiaryCryptoPanel({ asset, bundle }: { asset: Asset; bundle: ClaimBundle | null }) {
  const t = useTranslations("Crypto");
  const send = useTx();
  const { info } = useTokenInfo(asset.token);
  const [busy, setBusy] = useState(false);
  const amount = info ? `${fmtAmount(asset.balance, info.decimals)} ${info.symbol}` : "…";
  const claimed = asset.released && asset.balance === 0n;
  return (
    <div className="space-y-2 rounded-lg bg-sunken p-3" data-testid="crypto-benef">
      <p className="text-sm text-ink">
        {asset.released ? (claimed ? t("benWithdrawn") : t("benAvailable")) : t("benLocked")}: <b data-testid="locked-balance">{claimed ? t("allOfIt") : amount}</b>
        {!isNative(asset.token) && <span className="text-xs text-muted"> · {t("tokenSuffix", { address: shortAddr(asset.token) })}</span>}
      </p>
      {!asset.released && (
        <p className="text-xs text-muted">
          {claimOpen(bundle) ? t("benClaimInProgress") : t("benHowTo")}
          {" "}{t("benOwnerChanges")}
        </p>
      )}
      {asset.released && !claimed && (
        <Btn disabled={busy} data-testid="withdraw" onClick={async () => { setBusy(true); await send(t("labelWithdrawFunds"), "withdraw", [BigInt(asset.id)]); setBusy(false); }}>
          {t("benWithdrawButton", { amount })}
        </Btn>
      )}
    </div>
  );
}

import { erc20Abi, formatUnits, parseAbi, type Address, type PublicClient } from "viem";
import { NATIVE } from "./contract";
import { testTokens } from "./contracts";

/** The faucet test token, plus the one function an ERC-20 does not have. */
export const testTokenAbi = [...erc20Abi, ...parseAbi(["function faucet()", "function lastFaucet(address) view returns (uint256)", "function FAUCET_COOLDOWN() view returns (uint256)", "error FaucetCooldown(uint256 availableAt)"])] as const;

export type TokenInfo = { address: Address; symbol: string; decimals: number };

export const NATIVE_SYMBOLS: Record<number, string> = { 80002: "POL", 11155111: "ETH", 31337: "ETH" };
export const nativeInfo = (chainId: number | undefined): TokenInfo => ({ address: NATIVE, symbol: (chainId && NATIVE_SYMBOLS[chainId]) || "ETH", decimals: 18 });

export function getTestToken(chainId: number | undefined): TokenInfo | null {
  const t = chainId ? (testTokens as unknown as Record<number, { address: string; symbol: string; decimals: number }>)[chainId] : undefined;
  return t ? { address: t.address as Address, symbol: t.symbol, decimals: t.decimals } : null;
}

export const isNative = (token: string) => token.toLowerCase() === NATIVE;

/** Reads symbol and decimals of any ERC-20. Throws if the address is not a usable token. */
export async function readTokenInfo(c: PublicClient, token: Address): Promise<TokenInfo> {
  const [symbol, decimals] = await Promise.all([
    c.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
    c.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return { address: token, symbol, decimals };
}

export function fmtAmount(value: bigint, decimals: number, max = 6): string {
  const s = formatUnits(value, decimals);
  const [i, f = ""] = s.split(".");
  const frac = f.slice(0, max).replace(/0+$/, "");
  return (i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac ? "." + frac : "")) || "0";
}

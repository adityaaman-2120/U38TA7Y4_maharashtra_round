import { createConfig, http } from "wagmi";
import { hardhat, polygonAmoy, sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { rt } from "@/i18n/runtime";

// A deployed site serves exactly one network (NEXT_PUBLIC_CHAIN_ID); local development offers all of them.
const ALL = [sepolia, polygonAmoy, hardhat] as const;
const ONLY = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 0);
const chains = (ONLY ? ALL.filter((c) => c.id === ONLY) : ALL) as unknown as typeof ALL;

// With NEXT_PUBLIC_RPC_PROXY=1 the browser reads the chain through this site's own /api/rpc, which holds the provider's API key
// on the server. Otherwise it talks to the public endpoint directly.
const proxied = (chainId: number, fallback?: string) =>
  process.env.NEXT_PUBLIC_RPC_PROXY === "1" ? http(`/api/rpc?chain=${chainId}`) : http(fallback || undefined);

export const config = createConfig({
  chains,
  connectors: [injected()],
  transports: {
    [polygonAmoy.id]: proxied(polygonAmoy.id, process.env.NEXT_PUBLIC_AMOY_RPC_URL),
    [sepolia.id]: proxied(sepolia.id, process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com"),
    [hardhat.id]: http("http://127.0.0.1:8545"),
  },
  ssr: true,
});

// Network names are proper nouns, except the local development chain, which is named in the active language.
export const CHAIN_LABELS: Record<number, string> = {
  [sepolia.id]: "Sepolia",
  [polygonAmoy.id]: "Polygon Amoy",
  get [hardhat.id]() {
    return rt("Chains.localhost");
  },
};

const EXPLORERS: Record<number, string> = {
  [sepolia.id]: "https://sepolia.etherscan.io",
  [polygonAmoy.id]: "https://amoy.polygonscan.com",
};

export const explorerTxUrl = (chainId: number, hash: string) => (EXPLORERS[chainId] ? `${EXPLORERS[chainId]}/tx/${hash}` : null);

export const explorerAddressUrl = (chainId: number, address: string) => (EXPLORERS[chainId] ? `${EXPLORERS[chainId]}/address/${address}` : null);

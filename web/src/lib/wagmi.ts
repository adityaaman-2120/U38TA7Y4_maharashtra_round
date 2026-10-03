import { createConfig, http } from "wagmi";
import { hardhat, polygonAmoy, sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { rt } from "@/i18n/runtime";

export const config = createConfig({
  chains: [sepolia, polygonAmoy, hardhat],
  connectors: [injected()],
  transports: {
    [polygonAmoy.id]: http(process.env.NEXT_PUBLIC_AMOY_RPC_URL || undefined),
    [sepolia.id]: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com"),
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

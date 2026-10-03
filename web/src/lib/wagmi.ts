import { createConfig, http } from "wagmi";
import { hardhat, polygonAmoy } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const config = createConfig({
  chains: [polygonAmoy, hardhat],
  connectors: [injected()],
  transports: {
    [polygonAmoy.id]: http(process.env.NEXT_PUBLIC_AMOY_RPC_URL || undefined),
    [hardhat.id]: http("http://127.0.0.1:8545"),
  },
  ssr: true,
});

export const CHAIN_LABELS: Record<number, string> = { [polygonAmoy.id]: "Polygon Amoy", [hardhat.id]: "Localhost" };

export const explorerTxUrl = (chainId: number, hash: string) =>
  chainId === polygonAmoy.id ? `https://amoy.polygonscan.com/tx/${hash}` : null;

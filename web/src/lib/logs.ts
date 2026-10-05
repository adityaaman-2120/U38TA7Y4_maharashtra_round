import type { Address, Hex, PublicClient } from "viem";
import { heirloomAbi } from "./contract";

export type HeirloomEvent = {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
};

type DecodedLog = { eventName: string; args?: Record<string, unknown>; blockNumber: bigint; transactionHash: Hex; logIndex: number };

const CHUNK = BigInt(Number(process.env.NEXT_PUBLIC_LOG_CHUNK || 9000)); // stay under the RPC provider's getLogs range limit
const cache = new Map<string, { events: HeirloomEvent[]; next: bigint }>();

/** All contract events since deployment, fetched incrementally and cached per chain. */
export async function fetchEvents(client: PublicClient, chainId: number, address: Address, startBlock: number): Promise<HeirloomEvent[]> {
  const key = `${chainId}:${address}`;
  const latest = await client.getBlockNumber();
  let entry = cache.get(key);
  if (!entry || entry.next > latest + 1n) entry = { events: [], next: BigInt(startBlock) }; // new chain (e.g. node restarted)

  for (let from = entry.next; from <= latest; from += CHUNK + 1n) {
    const to = from + CHUNK < latest ? from + CHUNK : latest;
    const logs = (await client.getContractEvents({ address, abi: heirloomAbi, fromBlock: from, toBlock: to })) as unknown as DecodedLog[];
    for (const l of logs) {
      entry.events.push({
        eventName: l.eventName,
        args: l.args ?? {},
        blockNumber: l.blockNumber,
        transactionHash: l.transactionHash,
        logIndex: l.logIndex,
      });
    }
    entry.next = to + 1n;
  }
  cache.set(key, entry);
  return entry.events;
}

// A read-only JSON-RPC relay, so the RPC provider's API key stays on the server.
//   POST /api/rpc?chain=80002   ->   RPC_URL_80002  (and eth_getLogs -> LOGS_RPC_URL_80002 when set, for providers that cap log ranges)
// The browser's wallet (MetaMask) sends transactions itself; this relay only lets the page read the chain, so it refuses everything else.
export const runtime = "nodejs";

const MAX_BODY = 100 * 1024;
const READ_METHODS = new Set([
  "eth_chainId", "eth_blockNumber", "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory",
  "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount", "eth_getBlockByNumber", "eth_getBlockByHash",
  "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs", "net_version",
]);

type Call = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

const bad = (message: string, status: number) => Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message } }, { status });

function endpoint(chain: string, method: string): string | null {
  if (!/^\d{1,10}$/.test(chain)) return null;
  const logs = method === "eth_getLogs" ? process.env[`LOGS_RPC_URL_${chain}`] : undefined;
  return logs || process.env[`RPC_URL_${chain}`] || null;
}

async function forward(chain: string, call: Call): Promise<unknown> {
  const method = typeof call.method === "string" ? call.method : "";
  if (!READ_METHODS.has(method)) return { jsonrpc: "2.0", id: call.id ?? null, error: { code: -32601, message: "Method not allowed" } };
  const url = endpoint(chain, method);
  if (!url) return { jsonrpc: "2.0", id: call.id ?? null, error: { code: -32000, message: "Network not configured" } };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: call.id ?? 1, method, params: call.params ?? [] }),
      signal: AbortSignal.timeout(15000),
    });
    return await res.json();
  } catch {
    return { jsonrpc: "2.0", id: call.id ?? null, error: { code: -32000, message: "RPC provider unreachable" } };
  }
}

export async function POST(req: Request) {
  const chain = new URL(req.url).searchParams.get("chain") ?? "";
  const text = await req.text();
  if (text.length > MAX_BODY) return bad("Request too large", 413);
  let body: Call | Call[];
  try {
    body = JSON.parse(text);
  } catch {
    return bad("Invalid JSON", 400);
  }
  if (Array.isArray(body)) {
    if (body.length > 50) return bad("Batch too large", 413);
    return Response.json(await Promise.all(body.map((c) => forward(chain, c))));
  }
  return Response.json(await forward(chain, body));
}

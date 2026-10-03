// Client for the Django API (proxied through Next at /backend). Auth is an httpOnly cookie the browser attaches
// itself, so no token ever passes through JavaScript.
import { rt } from "@/i18n/runtime";
import type { KeyBlob } from "./keystore";

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

type Json = Record<string, unknown> | unknown[];

function messageFrom(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.detail === "string") return b.detail;
    // DRF field errors: { email: ["Enter a valid email address."] }
    const first = Object.entries(b).find(([, v]) => Array.isArray(v) && typeof v[0] === "string");
    if (first) return `${first[0] === "non_field_errors" ? "" : `${first[0]}: `}${(first[1] as string[])[0]}`;
  }
  return status === 429 ? rt("Errors.tooManyRequests") : rt("Errors.requestFailed", { status });
}

export async function api<T>(path: string, init: { method?: string; body?: Json } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/backend${path}`, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: init.body ? { "content-type": "application/json" } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, rt("Errors.cannotReachServer"));
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, messageFrom(body, res.status), body);
  return body as T;
}

// ---- types -------------------------------------------------------------------------------------

export type Me = {
  address: string;
  name: string;
  email: string;
  phone: string;
  profile_complete: boolean;
  has_key: boolean;
  created_at: string;
};

export type Role = "guardian" | "beneficiary";
export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export type Invitee = { address: string; name: string; public_key: string | null };
export type Invite = {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: InviteStatus;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  invitee: Invitee | null;
  email_sent?: boolean;
  link?: string; // only in development
};

// ---- endpoints ---------------------------------------------------------------------------------

export const authApi = {
  nonce: (address: string, chainId: number) =>
    api<{ nonce: string; message: string }>("/auth/nonce", { method: "POST", body: { address, chain_id: chainId, uri: window.location.origin } }),
  verify: (address: string, signature: string) => api<Me>("/auth/verify", { method: "POST", body: { address, signature } }),
  logout: () => api<void>("/auth/logout", { method: "POST" }),
  me: () => api<Me>("/me"),
  updateMe: (p: { name: string; email: string; phone?: string }) => api<Me>("/me", { method: "PUT", body: p }),
};

export const keyApi = {
  get: async (): Promise<KeyBlob | null> => {
    try {
      return (await api<{ blob: KeyBlob }>("/key-blob")).blob;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },
  put: (blob: KeyBlob) => api<{ blob: KeyBlob }>("/key-blob", { method: "PUT", body: { blob } }),
};

export const inviteApi = {
  list: () => api<Invite[]>("/invites"),
  create: (p: { email: string; role: Role; name?: string }) => api<Invite>("/invites", { method: "POST", body: p }),
  revoke: (id: string) => api<void>(`/invites/${id}`, { method: "DELETE" }),
  resend: (id: string) => api<Invite>(`/invites/${id}/resend`, { method: "POST" }),
  preview: (token: string) => api<{ role: Role; inviter: string; email: string }>("/invites/preview", { method: "POST", body: { token } }),
  accept: (token: string) => api<Invite>("/invites/accept", { method: "POST", body: { token } }),
  contacts: (role?: Role) => api<Invite[]>(`/contacts${role ? `?role=${role}` : ""}`),
};

// ---- alerts -------------------------------------------------------------------------------------

export type AlertSettings = {
  email_enabled: boolean;
  sms_enabled: boolean;
  has_email: boolean;
  has_phone: boolean;
  email_verified: boolean;
  phone_verified: boolean;
  sms_available: boolean;
  recent: { kind: string; channel: "email" | "sms"; status: "sent" | "failed"; claim_id: number | null; at: string }[];
};

export const alertsApi = {
  get: () => api<AlertSettings>("/alerts/settings"),
  save: (p: { email_enabled: boolean; sms_enabled: boolean }) => api<AlertSettings>("/alerts/settings", { method: "PUT", body: p }),
  start: (channel: "email" | "phone") => api<void>("/alerts/verify/start", { method: "POST", body: { channel } }),
  confirm: (channel: "email" | "phone", code: string) => api<AlertSettings>("/alerts/verify/confirm", { method: "POST", body: { channel, code } }),
};

export type AlivePreview = { claim_id: number; asset_id: number; chain_id: number; owner: string; ends_at: number };
export type AliveProblem = "invalid" | "used" | "closed" | "expired";

/** The emailed "I'm alive" link. Public: the signed token is the credential. */
export const aliveApi = {
  preview: (claim: string, token: string) => api<AlivePreview>(`/alive/preview?${new URLSearchParams({ claim, t: token })}`),
  consume: (claim: string, token: string) => api<{ ok: true }>("/alive/consume", { method: "POST", body: { claim, t: token } }),
};

// ---- events & notifications ---------------------------------------------------------------------

export type ApiEvent = {
  id: number;
  chain_id: number;
  block_number: number;
  tx_hash: `0x${string}`;
  log_index: number;
  event_name: string;
  args: Record<string, unknown>;
  timestamp: number;
  actor: string | null;
  asset_id: number | null;
  claim_id: number | null;
};
export type IndexerStatus = { chain_id: number; last_block: number; head_block: number; lag_blocks: number; updated_at: string; stale: boolean; error: string | null };
export type EventPage = { results: ApiEvent[]; next_before_id: number | null; indexer: IndexerStatus[] };

export const eventsApi = {
  list: (p: { chain_id?: number; limit?: number; before_id?: number; asset_id?: number; claim_id?: number; actor?: string; event?: string }) => {
    const q = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
    return api<EventPage>(`/events?${q}`);
  },
};

export type Notice = {
  id: number;
  kind: string;
  title: string;
  body: string;
  urgent: boolean;
  view: "owner" | "guardian" | "beneficiary";
  chain_id: number | null;
  asset_id: number | null;
  claim_id: number | null;
  created_at: string;
  read: boolean;
};

export const notificationsApi = {
  list: () => api<{ results: Notice[]; unread_count: number }>("/notifications"),
  markRead: (p: { ids: number[] } | { all: true }) => api<{ updated: number; unread_count: number }>("/notifications/read", { method: "POST", body: p }),
};

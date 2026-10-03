"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notificationsApi, type Me, type Notice } from "@/lib/api";
import { useHeirloom } from "@/lib/hooks";
import { fetchSession, useSessionKey } from "./Session";

export const NAVIGATE_EVENT = "heirloom:navigate";

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Bell with an unread badge. Only exists for a signed-in user; polls the backend, which fills it from indexed events. */
export function NotificationBell() {
  const { address } = useHeirloom();
  const sessionKey = useSessionKey();
  const me = useQuery<Me | null>({ queryKey: sessionKey, queryFn: () => fetchSession(address!), enabled: false }); // read-only view of the sign-in state
  const signedIn = Boolean(me.data);
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const key = ["notifications", address?.toLowerCase()];
  const list = useQuery({ queryKey: key, queryFn: notificationsApi.list, enabled: signedIn, refetchInterval: 15000, retry: false });
  const markRead = useMutation({
    mutationFn: notificationsApi.markRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!signedIn) return null;
  const items = list.data?.results ?? [];
  const unread = list.data?.unread_count ?? 0;
  const urgentUnread = items.some((n) => !n.read && n.urgent);

  const go = (n: Notice) => {
    if (!n.read) markRead.mutate({ ids: [n.id] });
    setOpen(false);
    if (pathname === "/app") window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: n.view }));
    else router.push("/app");
  };

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen((o) => !o)} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} data-testid="bell"
        className="relative rounded-full border border-line-strong bg-surface p-2 text-ink-2 hover:bg-sunken"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9a6 6 0 1 1 12 0c0 6 2 7.5 2 7.5H4S6 15 6 9Z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
        {unread > 0 && (
          <span data-testid="bell-count" className={`absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white ${urgentUnread ? "bg-bad" : "bg-accent"}`}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_18px_40px_-16px_rgba(21,24,29,0.35)]" data-testid="bell-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-display text-xl text-ink">Notifications</p>
            <button disabled={unread === 0 || markRead.isPending} onClick={() => markRead.mutate({ all: true })} className="text-xs font-medium text-accent disabled:text-faint" data-testid="mark-all-read">
              Mark all read
            </button>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {list.isLoading && <li className="px-4 py-6 text-sm text-muted">Loading…</li>}
            {list.isError && <li className="px-4 py-6 text-sm text-bad">Could not load notifications.</li>}
            {!list.isLoading && !list.isError && items.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-muted">Nothing yet. Claims, approvals and reminders will show up here.</li>
            )}
            {items.map((n) => (
              <li key={n.id} className="border-b border-line last:border-0">
                <button onClick={() => go(n)} className={`w-full px-4 py-3 text-left hover:bg-sunken ${n.read ? "" : "bg-accent-soft/50"}`} data-testid="notif-item">
                  <span className="flex items-center gap-2">
                    {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="unread" />}
                    <span className={`text-sm ${n.read ? "text-ink-2" : "font-semibold text-ink"}`}>{n.title}</span>
                    {n.urgent && <span className="rounded-full bg-bad-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-bad">Urgent</span>}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-xs text-muted">{n.body}</span>
                  <span className="mt-1 block text-[11px] text-faint">{ago(n.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

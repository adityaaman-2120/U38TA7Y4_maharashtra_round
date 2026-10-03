"use client";
import { createContext, useContext, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, authApi, type Me } from "@/lib/api";
import { useHeirloom } from "@/lib/hooks";
import { Btn, Card, Input, Label } from "./ui";

const MeCtx = createContext<Me | null>(null);
export const useMe = () => {
  const m = useContext(MeCtx);
  if (!m) throw new Error("Not signed in");
  return m;
};

export function useSessionKey() {
  const { address } = useHeirloom();
  return ["session", address?.toLowerCase()] as const;
}

/** The signed-in user for `address`, or null. Shared by everything that reads the session query. */
export async function fetchSession(address: string): Promise<Me | null> {
  try {
    const me = await authApi.me();
    if (me.address.toLowerCase() !== address.toLowerCase()) {
      await authApi.logout().catch(() => {}); // wallet switched accounts: drop the old account's session
      return null;
    }
    return me;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

/**
 * Sign-In With Ethereum, then a profile (name + email, kept off-chain). Children render only for a signed-in user
 * whose profile is complete. The session itself is an httpOnly cookie, invisible to this code.
 */
export function SessionGate({ children, prefillEmail }: { children: ReactNode; prefillEmail?: string }) {
  const { address, chainId, walletClient } = useHeirloom();
  const qc = useQueryClient();
  const key = useSessionKey();

  const session = useQuery({
    queryKey: key,
    enabled: Boolean(address),
    retry: false,
    queryFn: () => fetchSession(address!),
  });

  const signIn = useMutation({
    mutationFn: async () => {
      if (!walletClient || !address || !chainId) throw new Error("Wallet not ready");
      const { message } = await authApi.nonce(address, chainId);
      const signature = await walletClient.signMessage({ account: address, message });
      return authApi.verify(address, signature);
    },
    onSuccess: (me) => qc.setQueryData(key, me),
  });

  if (session.isLoading) return <p className="text-muted">Checking your session…</p>;
  if (session.isError) return <ServerDown onRetry={() => session.refetch()} message={(session.error as Error).message} />;

  const me = session.data;
  if (!me) {
    return (
      <div className="mx-auto max-w-xl pt-6">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-brass">Step 2 · Sign in</p>
        <h1 className="font-display text-4xl leading-tight text-ink">Prove this wallet is yours.</h1>
        <p className="mt-3 text-ink-2">You will be asked to sign a short message. It is free, sends no transaction, and cannot move any funds.</p>
        <div className="mt-6">
          <Btn onClick={() => signIn.mutate()} disabled={signIn.isPending} data-testid="siwe" className="px-5 py-2.5">
            {signIn.isPending ? "Waiting for your wallet…" : "Sign in with Ethereum"}
          </Btn>
        </div>
        {signIn.isError && <p className="mt-3 text-sm text-bad">{signInMessage(signIn.error)}</p>}
      </div>
    );
  }

  if (!me.profile_complete) return <ProfileForm me={me} prefillEmail={prefillEmail} onSaved={(m) => qc.setQueryData(key, m)} />;
  return <MeCtx.Provider value={me}>{children}</MeCtx.Provider>;
}

function signInMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  return /reject|denied/i.test(msg) ? "Signature request rejected in your wallet." : msg;
}

function ServerDown({ onRetry, message }: { onRetry: () => void; message: string }) {
  return (
    <div className="mx-auto max-w-xl pt-6">
      <h1 className="font-display text-4xl leading-tight text-ink">Can&apos;t reach the server</h1>
      <p className="mt-3 text-bad">{message}</p>
      <div className="mt-5"><Btn onClick={onRetry}>Try again</Btn></div>
    </div>
  );
}

function ProfileForm({ me, prefillEmail, onSaved }: { me: Me; prefillEmail?: string; onSaved: (m: Me) => void }) {
  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState(me.email || prefillEmail || "");
  const [phone, setPhone] = useState(me.phone);
  const save = useMutation({ mutationFn: () => authApi.updateMe({ name: name.trim(), email: email.trim(), phone: phone.trim() }), onSuccess: onSaved });
  const submit = (e: FormEvent) => { e.preventDefault(); if (name.trim() && email.trim()) save.mutate(); };
  return (
    <div className="mx-auto max-w-xl">
      <Card title="Tell us who you are">
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-muted">Your name and email are stored off-chain only, so the people you invite (or who invite you) know who is who. They never go on the blockchain.</p>
          <Label text="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" data-testid="profile-name" maxLength={80} /></Label>
          <Label text="Email" hint={prefillEmail ? "Must match the address the invitation was sent to." : undefined}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" data-testid="profile-email" />
          </Label>
          <Label text="Phone (optional)"><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" data-testid="profile-phone" /></Label>
          <Btn type="submit" disabled={save.isPending || !name.trim() || !email.trim()} data-testid="profile-save">{save.isPending ? "Saving…" : "Continue"}</Btn>
          {save.isError && <p className="text-sm text-bad">{(save.error as Error).message}</p>}
        </form>
      </Card>
    </div>
  );
}

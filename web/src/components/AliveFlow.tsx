"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSwitchChain } from "wagmi";
import { ApiError, aliveApi, type AliveProblem, type AlivePreview } from "@/lib/api";
import { loadClaimBundle, useHeirloom, useRead, useTx } from "@/lib/hooks";
import { CHAIN_LABELS } from "@/lib/wagmi";
import { fmtDuration, fmtTime, shortAddr } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { Btn, Card } from "./ui";
import { Header, WalletShell } from "./App";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Header />
      <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">{children}</div>
    </div>
  );
}

/** The page behind the "I'm alive" link in a claim alert: connect the owner's wallet, press one button, the claim is void. */
export default function AliveFlow({ claim, token }: { claim: string; token: string }) {
  const t = useTranslations("Alive");
  const preview = useQuery({ queryKey: ["alive-preview", claim, token], queryFn: () => aliveApi.preview(claim, token), retry: false, refetchOnWindowFocus: false });

  if (!claim || !token) return <Problem reason="invalid" />;
  if (preview.isLoading) return <Frame><p className="text-muted">{t("checking")}</p></Frame>;
  if (preview.isError || !preview.data) {
    const reason = ((preview.error as ApiError | undefined)?.body as { reason?: AliveProblem } | undefined)?.reason;
    if (preview.error instanceof ApiError && preview.error.status === 0) return <Frame><p className="text-bad">{preview.error.message}</p></Frame>;
    return <Problem reason={reason ?? "invalid"} />;
  }
  return (
    <WalletShell>
      <CheckIn data={preview.data} claim={claim} token={token} />
    </WalletShell>
  );
}

function Problem({ reason }: { reason: AliveProblem }) {
  const t = useTranslations("Alive");
  return (
    <Frame>
      <h1 className="font-display text-4xl leading-tight text-ink" data-testid="alive-problem" data-reason={reason}>{t("problemTitle")}</h1>
      <p className="mt-3 text-ink-2">{t(`problem.${reason}`)}</p>
      <p className="mt-5 flex gap-4 text-sm"><Link href="/app" className="text-accent underline">{t("openHeirloom")}</Link><Link href="/" className="text-muted underline">{t("home")}</Link></p>
    </Frame>
  );
}

function CheckIn({ data, claim, token }: { data: AlivePreview; claim: string; token: string }) {
  const t = useTranslations("Alive");
  const { address, chainId } = useHeirloom();
  const { mutate: switchChain } = useSwitchChain();
  const send = useTx();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isOwner = address?.toLowerCase() === data.owner.toLowerCase();
  const rightChain = chainId === data.chain_id;
  const bundle = useRead(["alive-claim", data.claim_id], (c, k) => loadClaimBundle(c, k, data.claim_id, address!), { enabled: Boolean(address) && isOwner && rightChain, interval: 4000 });
  const void_ = bundle.data?.invalidated === true || (bundle.data !== undefined && bundle.data.claim.status !== 1);

  // Once the claim is void on-chain, tell the server so the link is retired: that is what makes it single-use. (A 410 means it already is.)
  const consume = useQuery({
    queryKey: ["alive-consume", claim, token],
    enabled: bundle.data?.invalidated === true,
    retry: 5,
    retryDelay: 2000, // the server's node may still be catching up
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        await aliveApi.consume(claim, token);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 410)) throw e;
      }
      return true;
    },
  });
  const retired = consume.data === true;

  const checkIn = async () => {
    setBusy(true);
    setError("");
    try {
      await send(t("txLabel"), "heartbeat"); // on success the claim read refreshes, which starts the retirement above
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const chainName = CHAIN_LABELS[data.chain_id] ?? t("chainFallback", { id: data.chain_id });
  if (!rightChain) {
    return (
      <div className="mx-auto max-w-xl pt-6">
        <h1 className="font-display text-4xl leading-tight text-ink">{t("switchTitle")}</h1>
        <p className="mt-3 text-warn" data-testid="alive-wrong-chain">{t("wrongChain", { chain: chainName })}</p>
        <div className="mt-5"><Btn onClick={() => switchChain({ chainId: data.chain_id as never })}>{t("switchTo", { chain: chainName })}</Btn></div>
      </div>
    );
  }
  if (!isOwner) {
    return (
      <div className="mx-auto max-w-xl pt-6">
        <h1 className="font-display text-4xl leading-tight text-ink">{t("wrongWalletTitle")}</h1>
        <p className="mt-3 text-ink-2" data-testid="alive-wrong-wallet">
          {t("wrongWallet", { owner: shortAddr(data.owner), you: address ? shortAddr(address) : t("nobody") })}
        </p>
      </div>
    );
  }

  const done = void_ && bundle.data?.invalidated;
  return (
    <div className="mx-auto max-w-xl">
      <Card title={done ? t("titleDone") : t("titleAsk")}>
        {done ? (
          <>
            <p className="text-ink-2" data-testid="alive-done">{t("done", { id: data.claim_id })}{retired ? ` ${t("retired")}` : ""}</p>
            <Link href="/app" className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">{t("openVault")}</Link>
          </>
        ) : void_ ? (
          <p className="text-ink-2" data-testid="alive-closed">{t("closed", { id: data.claim_id })}</p>
        ) : (
          <>
            <p className="text-ink-2">{t.rich("ask", { claim: data.claim_id, asset: data.asset_id, b: (c) => <b>{c}</b> })}</p>
            <p className="text-xs text-muted" data-testid="alive-ends">{data.ends_at > now ? t("endsIn", { time: fmtTime(data.ends_at), duration: fmtDuration(data.ends_at - now) }) : t("ends", { time: fmtTime(data.ends_at) })}</p>
            <Btn onClick={checkIn} disabled={busy || bundle.isLoading} data-testid="alive-confirm" className="px-5 py-2.5">{busy ? t("waiting") : t("confirm")}</Btn>
            {error && <p className="text-sm text-bad">{error}</p>}
          </>
        )}
      </Card>
    </div>
  );
}

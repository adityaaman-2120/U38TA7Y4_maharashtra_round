"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { downloadBytes } from "@/lib/crypto";
import { Btn } from "./ui";

/** A decrypted letter, rendered as plain text (never as HTML), with copy and download. */
export function Letter({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  const t = useTranslations("Letter");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <article className="rounded-2xl border border-brass/30 bg-brass-soft/60 p-5 sm:p-7" data-testid="letter">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-brass">{t("eyebrow")}</p>
      <h3 className="mt-1 font-display text-3xl text-ink" data-testid="letter-heading">{title}</h3>
      <div className="mt-4 whitespace-pre-wrap break-words font-display text-xl leading-relaxed text-ink" data-testid="letter-body">{text}</div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Btn tone="ghost" onClick={copy}>{copied ? t("copied") : t("copy")}</Btn>
        <Btn tone="ghost" onClick={() => downloadBytes(`${title}.txt`, new TextEncoder().encode(text))}>{t("download")}</Btn>
        <Btn tone="ghost" onClick={onClose}>{t("close")}</Btn>
      </div>
    </article>
  );
}

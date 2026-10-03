import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import AliveFlow from "@/components/AliveFlow";

// The link carries a secret token: never index it, and never send it onward in a Referer header.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Meta");
  return { title: t("aliveTitle"), robots: { index: false }, referrer: "no-referrer" };
}

export default async function AlivePage(props: PageProps<"/alive">) {
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  return <AliveFlow claim={one(sp.claim)} token={one(sp.t)} />;
}

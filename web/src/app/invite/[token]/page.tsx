import type { Metadata } from "next";
import InviteFlow from "@/components/AcceptInvite";

export const metadata: Metadata = { title: "Heirloom — Invitation", robots: { index: false } };

export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  const { token: raw } = await props.params;
  // Signed tokens contain ":"; depending on the router the segment may arrive percent-encoded.
  let token = raw;
  try {
    token = decodeURIComponent(raw);
  } catch {
    /* keep as-is */
  }
  return <InviteFlow token={token} />;
}

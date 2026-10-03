import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import App from "@/components/App";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Meta");
  return { title: t("appTitle") };
}

export default function AppPage() {
  return <App />;
}

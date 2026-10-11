import { LandingPage } from "@/components/landing";
import { getDictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/types";

export function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }];
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const lang: Locale = locale === "zh" ? "zh" : "en";
  const dict = getDictionary(lang);
  return <LandingPage locale={lang} dict={dict} />;
}

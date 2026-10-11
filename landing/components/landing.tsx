"use client";

import type { Dict, Locale } from "@/i18n/types";
import { Header } from "./header";
import { Hero } from "./hero";
import { Layers } from "./layers";
import { Evidence } from "./evidence";
import { Quickstart } from "./quickstart";
import { FinalCta } from "./final-cta";
import { Footer } from "./footer";

export function LandingPage({ locale, dict }: { locale: Locale; dict: Dict }) {
  return (
    <>
      <Header dict={dict} locale={locale} />
      <main>
        <Hero dict={dict} locale={locale} />
        <Layers dict={dict} />
        <Evidence dict={dict} />
        <Quickstart dict={dict} />
        <FinalCta dict={dict} />
      </main>
      <Footer dict={dict} />
    </>
  );
}

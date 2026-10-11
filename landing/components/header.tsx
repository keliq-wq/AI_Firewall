"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Dict, Locale } from "@/i18n/types";
import { lp } from "@/lib/base-path";
import { IconGithub } from "./icons";

const GITHUB_URL = "https://github.com/keliq-wq/AI_Firewall";

export function Header({ dict, locale }: { dict: Dict; locale: Locale }) {
  const pathname = usePathname();
  const router = useRouter();

  const switchLang = (next: Locale) => {
    try {
      window.localStorage.setItem("lang", next);
    } catch {
      /* localStorage 不可用时只切本次 */
    }
    const rest = pathname.replace(/^\/(en|zh)\/?/, "");
    router.push(`/${next}/${rest}`);
  };

  return (
    <header className="site-header">
      <div className="container bar">
        <Link href={`/${locale}/`} className="wordmark" aria-label="Solana Agent Firewall">
          <span className="glyph" aria-hidden="true" />
          solana-agent-firewall
        </Link>

        <nav className="site-nav" aria-label={dict.nav.github}>
          <a href={lp(`/${locale}/#defense`)} className="hide-sm">
            {dict.nav.layers}
          </a>
          <a href={lp(`/${locale}/#evidence`)} className="hide-sm">
            {dict.nav.evidence}
          </a>
          <a href={lp(`/${locale}/#quickstart`)} className="hide-sm">
            {dict.nav.quickstart}
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="ext">
            <IconGithub size={14} />
            {dict.nav.github}
          </a>
          <div className="lang-toggle" role="group" aria-label="Language">
            <button
              type="button"
              aria-pressed={locale === "en"}
              onClick={() => switchLang("en")}
            >
              EN
            </button>
            <button
              type="button"
              aria-pressed={locale === "zh"}
              onClick={() => switchLang("zh")}
            >
              {locale === "en" ? dict.langLabel : "中文"}
            </button>
          </div>
        </nav>
      </div>
    </header>
  );
}

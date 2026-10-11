import type { Dict } from "@/i18n/types";

const GITHUB_URL = "https://github.com/keliq-wq/AI_Firewall";
const NPM_URL = "https://www.npmjs.com/package/solana-agent-firewall";

export function Footer({ dict }: { dict: Dict }) {
  return (
    <footer className="site-footer">
      <div className="container footer-bar">
        <span>
          {dict.footer.license} · {dict.footer.builtFor}
        </span>
        <div className="footer-links">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href={NPM_URL} target="_blank" rel="noreferrer">
            npm
          </a>
        </div>
      </div>
    </footer>
  );
}

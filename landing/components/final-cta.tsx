import type { Dict } from "@/i18n/types";
import { IconGithub } from "./icons";

const GITHUB_URL = "https://github.com/keliq-wq/AI_Firewall";

export function FinalCta({ dict }: { dict: Dict }) {
  return (
    <section className="final">
      <div className="container final-inner">
        <h2>{dict.finalCta.title}</h2>
        <p>{dict.finalCta.sub}</p>
        <a className="btn btn-primary" href={GITHUB_URL} target="_blank" rel="noreferrer">
          <IconGithub size={15} />
          {dict.finalCta.button}
        </a>
      </div>
    </section>
  );
}

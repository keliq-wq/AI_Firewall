"use client";

import type { Dict, Locale } from "@/i18n/types";
import { lp } from "@/lib/base-path";
import { Stamp } from "./stamp";
import { IconArrowUpRight, IconCheck, IconGithub, IconX } from "./icons";

const GITHUB_URL = "https://github.com/keliq-wq/AI_Firewall";

const short = (sig: string) => `${sig.slice(0, 8)}…${sig.slice(-4)}`;

export function Hero({ dict, locale }: { dict: Dict; locale: Locale }) {
  const r = dict.hero.register;
  const gates = r.cols.slice(0, 4); // CRE LIM AVO WOR
  const sim = r.cols[4]; // SIM

  return (
    <section className="hero" id="top">
      <div className="container hero-grid">
        <div className="hero-copy">
          <h1>{dict.hero.headline}</h1>
          <p className="sub">{dict.hero.sub}</p>
          <div className="cta-row">
            <a className="btn btn-primary" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <IconGithub size={15} />
              {dict.hero.ctaPrimary}
            </a>
            <a className="btn btn-ghost" href={lp(`/${locale}/#evidence`)}>
              {dict.hero.ctaSecondary}
            </a>
          </div>
          <div className="install-strip">
            <span className="prompt" aria-hidden="true">
              $
            </span>
            <span className="cmd">{dict.hero.installCommand}</span>
          </div>
        </div>

        <div className="register" role="figure" aria-label={r.label}>
          <div className="register-head">
            <span>{r.label}</span>
            <span className="chip">{r.cluster}</span>
          </div>

          <table className="register-table">
            <thead>
              <tr>
                {gates.map((g) => (
                  <th key={g} scope="col">
                    {g}
                  </th>
                ))}
                <th scope="col">{sim}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                {gates.map((g) => (
                  <td key={g} className="gate-pass">
                    <IconCheck size={12} /> <span className="pass-label">PASS</span>
                  </td>
                ))}
                <td className="gate-fail">
                  <IconX size={12} /> 6011
                </td>
              </tr>
            </tbody>
          </table>

          <div className="register-body">
            <div className="register-line">
              <span className="k">{r.fromLabel}</span>
              <span className="v">{r.from}</span>
            </div>
            <div className="register-line">
              <span className="k">INTENT</span>
              <span className="v dim">{r.declared}</span>
            </div>
            <div className="register-line">
              <span className="k">EFFECT</span>
              <span className="v">{r.actual}</span>
            </div>

            <div className="register-verdict">
              <div className="verdict-stamp">
                <Stamp text={r.verdict} />
              </div>
              <div className="verdict-reason">{r.reason}</div>
              <div className="verdict-sig">
                <span>
                  {r.sigLabel} {short(r.sig)}
                </span>
                <a href={r.sigHref} target="_blank" rel="noreferrer">
                  {r.seeOnChain}
                  <IconArrowUpRight size={12} />
                </a>
                <span className="k">{r.signed}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

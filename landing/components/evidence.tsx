import type { Dict } from "@/i18n/types";
import { IconArrowUpRight } from "./icons";

const short = (sig: string) => `${sig.slice(0, 8)}…${sig.slice(-4)}`;

/** 证据账本：真实链上拒绝记录，每行都可点穿到 explorer */
export function Evidence({ dict }: { dict: Dict }) {
  const e = dict.evidence;
  return (
    <section className="section" id="evidence">
      <div className="container">
        <div className="section-head">
          <h2>{e.title}</h2>
          <p>{e.sub}</p>
        </div>

        <div className="evidence-scroll">
          <table className="evidence-table">
            <thead>
              <tr>
                <th scope="col">{e.cols.code}</th>
                <th scope="col">{e.cols.attempt}</th>
                <th scope="col" className="hide-sm">
                  {e.cols.cluster}
                </th>
                <th scope="col">{e.cols.signature}</th>
              </tr>
            </thead>
            <tbody>
              {e.rows.map((row) => (
                <tr key={row.sig}>
                  <td className={`code ${row.status === "passed" ? "pass" : ""}`}>
                    {row.code}
                  </td>
                  <td>{row.attempt}</td>
                  <td className="hide-sm">{row.cluster}</td>
                  <td>
                    <span
                      className={`status-chip ${row.status}`}
                      role="img"
                      aria-label={
                        row.status === "blocked"
                          ? e.statusBlocked
                          : e.statusPassed
                      }
                    >
                      {row.status === "blocked"
                        ? e.statusBlocked
                        : e.statusPassed}
                    </span>{" "}
                    <a
                      className="sig-link"
                      href={row.href}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${row.sig}`}
                    >
                      {short(row.sig)}
                      <IconArrowUpRight size={12} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="evidence-note">{e.note}</p>
      </div>
    </section>
  );
}

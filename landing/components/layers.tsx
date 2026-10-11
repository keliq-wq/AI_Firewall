import type { Dict } from "@/i18n/types";

/** 三层防御：账本行式登记，不用等宽卡片 */
export function Layers({ dict }: { dict: Dict }) {
  return (
    <section className="section" id="defense">
      <div className="container">
        <div className="section-head">
          <h2>{dict.layers.title}</h2>
          <p>{dict.layers.sub}</p>
        </div>
        <div className="ledger">
          {dict.layers.items.map((item, i) => (
            <div className="ledger-row" key={item.name}>
              <div className="ledger-idx">{String(i + 1).padStart(2, "0")}</div>
              <div className="ledger-main">
                <h3>{item.name}</h3>
                <div className="ledger-role">{item.role}</div>
                <p className="ledger-body">{item.body}</p>
              </div>
              <div className="ledger-evidence">{item.evidence}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

import type { Dict } from "@/i18n/types";

export function Quickstart({ dict }: { dict: Dict }) {
  const q = dict.quickstart;
  return (
    <section className="section" id="quickstart">
      <div className="container">
        <div className="section-head">
          <h2>{q.title}</h2>
          <p>{q.sub}</p>
        </div>

        <div className="qs-grid">
          <div className="qs-steps">
            {q.steps.map((step, i) => (
              <div className="qs-step" key={step.title}>
                <div className="n">{String(i + 1).padStart(2, "0")}</div>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  <code>{step.command}</code>
                </div>
              </div>
            ))}
          </div>

          <div className="qs-panels">
            <div className="qs-panel">
              <h3>{q.mcpTitle}</h3>
              <p>{q.mcpBody}</p>
              <div className="code-strip">{q.mcpCode}</div>
            </div>
            <div className="qs-panel">
              <h3>{q.dashboardTitle}</h3>
              <p>{q.dashboardBody}</p>
              <div className="code-strip">{q.dashboardCode}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

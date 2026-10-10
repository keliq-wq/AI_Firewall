/* 防火墙演示控制台前端逻辑（无依赖原生 JS） */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const VERDICT_META = {
    deny: { label: "✗ 拦截", cls: "deny" },
    escalate: { label: "⚠ 需人工确认", cls: "escalate" },
    allow: { label: "✓ 放行", cls: "allow" },
  };
  const SEV_LABEL = { critical: "严重", high: "高危", medium: "中危", low: "低危" };

  const short = (s, n) => (s && s.length > n ? s.slice(0, n) + "…" : s || "");
  const timeStr = (t) => {
    const d = new Date(t);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  };

  let busy = false;

  async function api(path, options) {
    const res = await fetch(path, options);
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  }

  /* ── 剧本按钮 ── */
  async function loadScenarios() {
    const scenarios = await api("/api/scenarios");
    const box = $("scenarios");
    box.innerHTML = "";
    for (const s of scenarios) {
      const btn = document.createElement("button");
      btn.className = "scenario-btn";
      btn.dataset.id = s.id;
      btn.innerHTML = `
        <span class="s-head"><span>${s.icon}</span><span>${s.title}</span></span>
        <span class="s-desc">${s.description}</span>`;
      btn.addEventListener("click", () => run(s.id, btn));
      box.appendChild(btn);
    }
  }

  async function run(id, btn) {
    if (busy) return;
    busy = true;
    document.querySelectorAll(".scenario-btn").forEach((b) => (b.disabled = true));
    $("result-empty").hidden = true;
    $("result-body").hidden = true;
    try {
      const r = await api("/api/attack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      renderResult(r);
    } catch (e) {
      const el = $("result-empty");
      el.hidden = false;
      el.textContent = "请求失败: " + e.message;
    } finally {
      busy = false;
      document.querySelectorAll(".scenario-btn").forEach((b) => (b.disabled = false));
      refreshState();
    }
  }

  function renderResult(r) {
    $("result-empty").hidden = true;
    $("result-body").hidden = false;
    const meta = VERDICT_META[r.verdict] || VERDICT_META.escalate;
    $("verdict").className = "verdict " + meta.cls;
    $("verdict").textContent = meta.label;
    $("result-title").textContent = `${r.icon} ${r.title}`;
    $("result-summary").textContent = r.summary;

    const ul = $("concerns");
    ul.innerHTML = "";
    for (const c of r.concerns) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="sev ${c.severity}">${SEV_LABEL[c.severity] || c.severity}</span><span class="msg">${c.message}</span>`;
      ul.appendChild(li);
    }
    $("narration").textContent = r.narration || "";
  }

  /* ── 状态刷新 ── */
  async function refreshState() {
    try {
      const s = await api("/api/state");
      const dot = document.querySelector("#rpc-chip .dot");
      dot.className = "dot dot-ok";
      $("rpc-label").textContent = `RPC 已连接 · ${short(s.rpcUrl, 38)}`;
      $("wallet-chip").textContent = `钱包 ${short(s.wallet, 16)}`;
      $("wallet-chip").title = s.wallet;

      $("policy-kv").innerHTML = `
        <div><dt>模式</dt><dd>${s.policy.mode === "strict" ? "严格（拒绝即拦截）" : "监控"}</dd></div>
        <div><dt>单笔上限</dt><dd>${s.policy.maxTransactionAmount} SOL</dd></div>
        <div><dt>24h 上限</dt><dd>${s.policy.dailyLimit} SOL</dd></div>
        <div><dt>白名单协议</dt><dd class="mono">${s.policy.allowedPrograms.map((p) => short(p, 6)).join(", ") || "—"}</dd></div>
        <div><dt>黑名单协议</dt><dd class="mono">${s.policy.blockedPrograms.map((p) => short(p, 6)).join(", ") || "—"}</dd></div>
        <div><dt>钱包余额</dt><dd>${s.walletBalance.toFixed(4)} SOL</dd></div>`;

      const ratio = s.policy.dailyLimit > 0 ? s.spent24h / s.policy.dailyLimit : 0;
      const fill = $("meter-fill");
      fill.style.width = `${Math.min(100, ratio * 100)}%`;
      fill.className = "meter-fill" + (ratio >= 1 ? " over" : ratio >= 0.8 ? " hot" : "");
      $("meter-label").textContent = `${s.spent24h.toFixed(3)} / ${s.policy.dailyLimit} SOL`;

      const vault = s.program.vaultBalance != null ? `${s.program.vaultBalance.toFixed(3)} SOL` : "未初始化";
      $("chain-kv").innerHTML = `
        <div><dt>程序</dt><dd class="mono">${short(s.program.id, 14)}</dd></div>
        <div><dt>部署状态</dt><dd class="${s.program.executable ? "ok" : "fail"}">${s.program.executable ? "✓ 可执行" : "✗ 未部署"}</dd></div>
        <div><dt>金库余额</dt><dd>${vault}</dd></div>`;

      const tl = $("timeline");
      tl.innerHTML = "";
      for (const ev of s.events.slice(0, 40)) {
        const meta = VERDICT_META[ev.verdict] || VERDICT_META.escalate;
        const li = document.createElement("li");
        li.innerHTML = `<span class="t-time">${timeStr(ev.time)}</span>
          <span class="t-icon">${ev.icon}</span>
          <span class="t-title">${ev.title}</span>
          <span class="t-verdict ${meta.cls}">${meta.label}</span>`;
        tl.appendChild(li);
      }
    } catch (e) {
      document.querySelector("#rpc-chip .dot").className = "dot dot-fail";
      $("rpc-label").textContent = "RPC 连接失败";
    }
  }

  loadScenarios().catch((e) => console.error(e));
  refreshState();
  setInterval(refreshState, 8000);
})();

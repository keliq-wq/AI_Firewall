/* 防火墙演示控制台前端逻辑（无依赖原生 JS，中英双语可切换） */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /* ── i18n ── */
  const I18N = {
    zh: {
      brand: "AI Agent 交易防火墙",
      brandSub: "三层防御 · CLAW 四门协议 · 实时演示控制台",
      rpcConnecting: "连接中…",
      rpcOk: "RPC 已连接 · ",
      rpcFail: "RPC 连接失败",
      wallet: "钱包",
      scenarios: "攻击剧本",
      scenariosHint: "点击发起一笔攻击交易，观察防火墙在签名前的实时拦截。全部走真实 RPC 模拟执行。",
      resultEmpty: "← 点击左侧剧本，查看防火墙判定",
      requestFail: "请求失败: ",
      verdictDeny: "✗ 拦截",
      verdictEscalate: "⚠ 需人工确认",
      verdictAllow: "✓ 放行",
      sevCritical: "严重",
      sevHigh: "高危",
      sevMedium: "中危",
      sevLow: "低危",
      policy: "策略",
      mode: "模式",
      modeStrict: "严格（拒绝即拦截）",
      modeMonitor: "监控",
      maxTx: "单笔上限",
      daily: "24h 上限",
      allowlist: "白名单协议",
      blocklist: "黑名单协议",
      walletBal: "钱包余额",
      spend: "24h 滚动支出",
      chain: "链上状态",
      program: "程序",
      deployed: "部署状态",
      deployedOk: "✓ 可执行",
      deployedFail: "✗ 未部署",
      vault: "金库余额",
      vaultEmpty: "未初始化",
      timeline: "事件时间线",
      foot: "Layer 1 客户端快速拒绝 · Layer 2 模拟执行验证 · Layer 3 链上强制金库",
      sol: "SOL",
      tabScenarios: "🎯 攻击剧本",
      tabLive: "📡 实时拦截日志",
      liveConnecting: "连接中…",
      liveConnected: "实时流已连接",
      liveDisconnected: "实时流断开，自动重连中…",
      liveEmpty: "暂无判定记录。点击左侧剧本，或让 Agent 把交易 POST 到 /api/validate，判定会在这里实时滚动。",
      liveHint: "每一条防火墙判定实时上屏：剧本点击、以及任意 Agent 通过 POST /api/validate 提交的真实交易。历史最近 300 条持久化，重启不丢。",
      liveCountDeny: "拦截",
      liveCountEscalate: "确认",
      liveCountAllow: "放行",
    },
    en: {
      brand: "AI Agent Transaction Firewall",
      brandSub: "Three-layer defense · CLAW four-gate protocol · Live demo console",
      rpcConnecting: "Connecting…",
      rpcOk: "RPC connected · ",
      rpcFail: "RPC connection failed",
      wallet: "Wallet",
      scenarios: "Attack Scenarios",
      scenariosHint:
        "Click to launch an attack transaction and watch the firewall block it before signing. All validation runs real RPC simulation.",
      resultEmpty: "← Click a scenario to see the firewall verdict",
      requestFail: "Request failed: ",
      verdictDeny: "✗ Blocked",
      verdictEscalate: "⚠ Needs confirmation",
      verdictAllow: "✓ Allowed",
      sevCritical: "Critical",
      sevHigh: "High",
      sevMedium: "Medium",
      sevLow: "Low",
      policy: "Policy",
      mode: "Mode",
      modeStrict: "Strict (deny on violation)",
      modeMonitor: "Monitor",
      maxTx: "Per-tx cap",
      daily: "24h cap",
      allowlist: "Allowlist",
      blocklist: "Blocklist",
      walletBal: "Wallet balance",
      spend: "24h Rolling Spend",
      chain: "On-chain Status",
      program: "Program",
      deployed: "Deployment",
      deployedOk: "✓ Executable",
      deployedFail: "✗ Not deployed",
      vault: "Vault balance",
      vaultEmpty: "Uninitialized",
      timeline: "Event Timeline",
      foot: "Layer 1 client-side rejection · Layer 2 simulation · Layer 3 on-chain vault",
      sol: "SOL",
      tabScenarios: "🎯 Attack Scenarios",
      tabLive: "📡 Live Interception Log",
      liveConnecting: "Connecting…",
      liveConnected: "Live stream connected",
      liveDisconnected: "Stream lost, reconnecting…",
      liveEmpty: "No verdicts yet. Click a scenario, or have an agent POST to /api/validate — verdicts stream here live.",
      liveHint: "Every firewall verdict streams here live: scenario clicks, and real transactions any agent submits via POST /api/validate. Last 300 entries persist across restarts.",
      liveCountDeny: "blocked",
      liveCountEscalate: "confirm",
      liveCountAllow: "allowed",
    },
  };

  let lang = localStorage.getItem("fw-lang") || "zh";
  const t = (key) => (I18N[lang] && I18N[lang][key]) || key;
  const pick = (zh, en) => (lang === "en" ? en : zh);

  function applyStatic() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      if (key === "rpcConnecting" && el.id === "rpc-label" && lastRpcText) return; // 动态状态由 refreshState 管理
      el.textContent = t(key);
    });
    document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
    $("lang-btn").textContent = lang === "zh" ? "EN" : "中";
  }

  let lastRpcText = "";
  let lastResult = null; // 保留最近一次判定，切换语言时本地重渲染（无需重新发交易）
  let lastScenarios = [];

  const VERDICT_KEYS = { deny: "verdictDeny", escalate: "verdictEscalate", allow: "verdictAllow" };
  const VERDICT_CLS = { deny: "deny", escalate: "escalate", allow: "allow" };
  const SEV_KEYS = { critical: "sevCritical", high: "sevHigh", medium: "sevMedium", low: "sevLow" };

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
  function renderScenarios() {
    const box = $("scenarios");
    box.innerHTML = "";
    for (const s of lastScenarios) {
      const btn = document.createElement("button");
      btn.className = "scenario-btn";
      btn.dataset.id = s.id;
      btn.innerHTML = `
        <span class="s-head"><span>${s.icon}</span><span>${pick(s.title, s.titleEn)}</span></span>
        <span class="s-desc">${pick(s.description, s.descriptionEn)}</span>`;
      btn.addEventListener("click", () => run(s.id));
      box.appendChild(btn);
    }
  }

  async function loadScenarios() {
    lastScenarios = await api("/api/scenarios");
    renderScenarios();
  }

  async function run(id) {
    if (busy) return;
    busy = true;
    document.querySelectorAll(".scenario-btn").forEach((b) => (b.disabled = true));
    $("result-empty").hidden = true;
    $("result-body").hidden = true;
    try {
      lastResult = await api("/api/attack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      renderResult();
    } catch (e) {
      const el = $("result-empty");
      el.hidden = false;
      el.textContent = t("requestFail") + e.message;
    } finally {
      busy = false;
      document.querySelectorAll(".scenario-btn").forEach((b) => (b.disabled = false));
      refreshState();
    }
  }

  function renderResult() {
    if (!lastResult) return;
    $("result-empty").hidden = true;
    $("result-body").hidden = false;
    $("verdict").className = "verdict " + VERDICT_CLS[lastResult.verdict];
    $("verdict").textContent = t(VERDICT_KEYS[lastResult.verdict]);
    $("result-title").textContent = `${lastResult.icon} ${pick(lastResult.title, lastResult.titleEn)}`;
    $("result-summary").textContent = lastResult.summary;

    const ul = $("concerns");
    ul.innerHTML = "";
    for (const c of lastResult.concerns) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="sev ${c.severity}">${t(SEV_KEYS[c.severity] || c.severity)}</span><span class="msg">${c.message}</span>`;
      ul.appendChild(li);
    }
    $("narration").textContent = pick(lastResult.narration, lastResult.narrationEn) || "";
  }

  /* ── 状态刷新 ── */
  async function refreshState() {
    try {
      const s = await api("/api/state");
      const dot = document.querySelector("#rpc-chip .dot");
      dot.className = "dot dot-ok";
      lastRpcText = t("rpcOk") + short(s.rpcUrl, 38);
      $("rpc-label").textContent = lastRpcText;
      $("wallet-chip").textContent = `${t("wallet")} ${short(s.wallet, 16)}`;
      $("wallet-chip").title = s.wallet;

      const sol = t("sol");
      $("policy-kv").innerHTML = `
        <div><dt>${t("mode")}</dt><dd>${s.policy.mode === "strict" ? t("modeStrict") : t("modeMonitor")}</dd></div>
        <div><dt>${t("maxTx")}</dt><dd>${s.policy.maxTransactionAmount} ${sol}</dd></div>
        <div><dt>${t("daily")}</dt><dd>${s.policy.dailyLimit} ${sol}</dd></div>
        <div><dt>${t("allowlist")}</dt><dd class="mono">${s.policy.allowedPrograms.map((p) => short(p, 6)).join(", ") || "—"}</dd></div>
        <div><dt>${t("blocklist")}</dt><dd class="mono">${s.policy.blockedPrograms.map((p) => short(p, 6)).join(", ") || "—"}</dd></div>
        <div><dt>${t("walletBal")}</dt><dd>${s.walletBalance.toFixed(4)} ${sol}</dd></div>`;

      const ratio = s.policy.dailyLimit > 0 ? s.spent24h / s.policy.dailyLimit : 0;
      const fill = $("meter-fill");
      fill.style.width = `${Math.min(100, ratio * 100)}%`;
      fill.className = "meter-fill" + (ratio >= 1 ? " over" : ratio >= 0.8 ? " hot" : "");
      $("meter-label").textContent = `${s.spent24h.toFixed(3)} / ${s.policy.dailyLimit} ${sol}`;

      const vault = s.program.vaultBalance != null ? `${s.program.vaultBalance.toFixed(3)} ${sol}` : t("vaultEmpty");
      $("chain-kv").innerHTML = `
        <div><dt>${t("program")}</dt><dd class="mono">${short(s.program.id, 14)}</dd></div>
        <div><dt>${t("deployed")}</dt><dd class="${s.program.executable ? "ok" : "fail"}">${s.program.executable ? t("deployedOk") : t("deployedFail")}</dd></div>
        <div><dt>${t("vault")}</dt><dd>${vault}</dd></div>`;

      const tl = $("timeline");
      tl.innerHTML = "";
      for (const ev of s.events.slice(0, 40)) {
        const li = document.createElement("li");
        li.innerHTML = `<span class="t-time">${timeStr(ev.time)}</span>
          <span class="t-icon">${ev.icon}</span>
          <span class="t-title">${pick(ev.title, ev.titleEn)}</span>
          <span class="t-verdict ${VERDICT_CLS[ev.verdict]}">${t(VERDICT_KEYS[ev.verdict])}</span>`;
        tl.appendChild(li);
      }
    } catch (e) {
      document.querySelector("#rpc-chip .dot").className = "dot dot-fail";
      lastRpcText = t("rpcFail");
      $("rpc-label").textContent = lastRpcText;
    }
  }

  /* ── 页签切换 ── */
  const tabBtns = document.querySelectorAll(".tab-btn");
  function switchTab(name) {
    tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    $("pane-scenarios").hidden = name !== "scenarios";
    $("pane-live").hidden = name !== "live";
    if (name === "live") renderLog();
  }
  tabBtns.forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));

  /* ── 实时拦截日志(SSE) ── */
  const logEntries = [];

  function liveCountsText() {
    const d = logEntries.filter((e) => e.verdict === "deny").length;
    const c = logEntries.filter((e) => e.verdict === "escalate").length;
    const a = logEntries.filter((e) => e.verdict === "allow").length;
    return `${t("liveCountDeny")} ${d} · ${t("liveCountEscalate")} ${c} · ${t("liveCountAllow")} ${a}`;
  }

  function renderLogEntry(ev) {
    const li = document.createElement("li");
    li.className = "log-entry";
    const sevs = (ev.concerns || [])
      .slice(0, 3)
      .map((c) => `<span class="sev ${c.severity}">${t(SEV_KEYS[c.severity] || c.severity)}</span>`)
      .join("");
    li.innerHTML = `
      <span class="l-time">${timeStr(ev.time)}</span>
      <span class="l-verdict ${VERDICT_CLS[ev.verdict] || ""}">${t(VERDICT_KEYS[ev.verdict] || ev.verdict)}</span>
      <span class="l-summary">${ev.summary}</span>
      ${ev.action ? `<span class="l-action">${ev.action}${ev.amount != null ? " · " + ev.amount : ""}${ev.recipient ? " → " + short(ev.recipient, 10) : ""}</span>` : ""}
      <span class="l-concerns">${sevs}</span>
      ${ev.fingerprint ? `<span class="l-fp" title="${ev.fingerprint}">#${short(ev.fingerprint, 10)}</span>` : ""}`;
    return li;
  }

  function renderLog() {
    const feed = $("log-feed");
    feed.innerHTML = "";
    if (logEntries.length === 0) {
      const empty = document.createElement("li");
      empty.className = "log-empty";
      empty.textContent = t("liveEmpty");
      feed.appendChild(empty);
    } else {
      for (const ev of logEntries.slice(0, 200)) feed.appendChild(renderLogEntry(ev));
    }
    $("live-counts").textContent = liveCountsText();
  }

  function setLiveStatus(ok) {
    $("live-dot").className = "dot " + (ok ? "dot-ok" : "dot-fail");
    $("live-label").textContent = t(ok ? "liveConnected" : "liveDisconnected");
  }

  function addLogEvent(ev) {
    logEntries.unshift(ev);
    if (logEntries.length > 300) logEntries.pop();
    if (!$("pane-live").hidden) renderLog();
  }

  const es = new EventSource("/api/events");
  es.onopen = () => setLiveStatus(true);
  es.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data);
      if (data.init) {
        logEntries.length = 0;
        for (const ev of data.events) logEntries.push(ev);
        renderLog();
      } else {
        addLogEvent(data);
      }
    } catch {
      // 忽略坏消息
    }
  };
  es.onerror = () => setLiveStatus(false);

  /* ── 语言切换 ── */
  $("lang-btn").addEventListener("click", () => {
    lang = lang === "zh" ? "en" : "zh";
    localStorage.setItem("fw-lang", lang);
    lastRpcText = "";
    applyStatic();
    renderScenarios();
    renderResult();
    renderLog();
    refreshState();
  });

  applyStatic();
  loadScenarios().catch((e) => console.error(e));
  refreshState();
  setInterval(refreshState, 8000);
})();

import type { Dict } from "./types";

const SIG = {
  devnetRevert: "5KUvaG2buFoDdSWRstLXKPYkwknA1DQ6r869zpmW4WKXhpZWyciRbWBi7YfptxgPpwKfzJyYxxW4AM79DBW953gb",
  devnetPass: "MV6NStSDqeqibtb8LQjH4Z2hJ8BwqydzExPv2qqch4Ch8mont44tgbCamB7xCVY8jEbSaah1g3frKUEGHPhRsVm",
  t6000: "a4gkbv6NSPvVej696MYs9VAQCoWK4EGnJkr8S4h7ki8LQbpZ2J5SNnqMDWhPhGDCnunMmecYJrEJDStUejnihhW",
  t6002: "5nKs9jbg8W3c4mzyZXbhHeCrpMRUVrcwf38NMV25w7r1Vx6Q6fLnMS3uQdZHqukKvi97PcBMg28KtG8EXJbMbqAk",
  t6003: "56ewZHUCFv5iQs2p2yqLyiZTPP9F4cGrqk65Hr95nCoF2Yp9AgkNk6QUfoYMquy1SqBhcMqxtLV9WFD9PwLUUacj",
  t6004: "A1PmRjnRmepBV1Q98jGP2vVC2eKLXJsrZM9XiJo3S3toFSmG8erQq1hHsDUoT1P7v53xEFhu8yPJtjqC7fCrRsy",
};

const tx = (sig: string, cluster: "testnet" | "devnet") =>
  `https://explorer.solana.com/tx/${sig}?cluster=${cluster}`;

export const dictionaries: Record<"en" | "zh", Dict> = {
  en: {
    meta: {
      title: "Solana Agent Firewall — The firewall between an AI agent and its signature",
      description:
        "Three layers of defense check every transaction an AI agent signs on Solana. Prompt injection, owner phishing, and a leaked private key stop meaning a drained wallet.",
    },
    nav: {
      layers: "Defense",
      evidence: "Evidence",
      quickstart: "Quick start",
      github: "GitHub",
    },
    hero: {
      headline: "The firewall between an AI agent and its signature.",
      sub: "Three layers of defense check every transaction an AI agent signs on Solana, so prompt injection, owner phishing, and a leaked private key cannot drain the wallet.",
      ctaPrimary: "Get it on GitHub",
      ctaSecondary: "Read the on-chain evidence",
      installLabel: "One install",
      installCommand: "npm install solana-agent-firewall",
      register: {
        label: "Live register · program 5ZtXDT2Q…",
        cluster: "devnet",
        cols: ["CRE", "LIM", "AVO", "WOR", "SIM"],
        fromLabel: "AGENT",
        from: "7a6YDAL8…btVZ",
        declared: "declared 0.01 SOL",
        actual: "CPI moved 0.02 SOL",
        verdict: "BLOCKED",
        reason: "Declared amount does not match simulated effect. Invariant I1, error 6011.",
        sigLabel: "SIGNATURE",
        sig: SIG.devnetRevert,
        sigHref: tx(SIG.devnetRevert, "devnet"),
        signed: "Never signed — rejected before signing.",
        seeOnChain: "See it on-chain",
      },
    },
    layers: {
      title: "Each layer exists because the one before it can be fooled.",
      sub: "Client-side gates are fast. Simulation sees deeper. The chain enforces what neither can guarantee.",
      items: [
        {
          name: "CLAW gates",
          role: "Client-side · offline · <1ms",
          body: "CLAW parses the transaction before anything leaves your machine: credibility, limits, avoidance, worth. The obvious attacks die here, with no RPC round-trip.",
          evidence: "85 tests across 22 files, offline legacy and V0 parsing.",
        },
        {
          name: "Simulation",
          role: "Runs against live chain state, before signing",
          body: "Every transaction is simulated against real chain state. Inner instructions that change owners or drain more than the declared amount fail here — the attacks a static checker cannot see.",
          evidence: "Five live attack scenarios caught against real RPC state.",
        },
        {
          name: "On-chain enforcement",
          role: "PDA vault · the agent key has zero power over it",
          body: "Funds live in a PDA vault. Withdrawals pass on-chain identity, per-tx caps, an allowlist, destination checks, and a 24-hour window. A fully leaked key still cannot drain it.",
          evidence: "Testnet suite 6/6. Every rejection is a public transaction.",
        },
      ],
    },
    evidence: {
      title: "Every claim links to a test or a transaction.",
      sub: "The firewall is verified the way its users verify: on the chain and in the test runner. These are real transactions, rejected by the deployed program.",
      cols: {
        code: "CODE",
        attempt: "WHAT WAS ATTEMPTED",
        cluster: "CLUSTER",
        signature: "SIGNATURE",
      },
      rows: [
        {
          code: "6000",
          attempt: "Withdrawal over the per-transaction cap",
          cluster: "testnet",
          sig: SIG.t6000,
          href: tx(SIG.t6000, "testnet"),
          status: "blocked",
        },
        {
          code: "6002",
          attempt: "Withdrawal over the 24-hour window",
          cluster: "testnet",
          sig: SIG.t6002,
          href: tx(SIG.t6002, "testnet"),
          status: "blocked",
        },
        {
          code: "6003",
          attempt: "Transfer to a program outside the allowlist",
          cluster: "testnet",
          sig: SIG.t6003,
          href: tx(SIG.t6003, "testnet"),
          status: "blocked",
        },
        {
          code: "6004",
          attempt: "Withdrawal by an unregistered agent",
          cluster: "testnet",
          sig: SIG.t6004,
          href: tx(SIG.t6004, "testnet"),
          status: "blocked",
        },
        {
          code: "6011",
          attempt: "Declared 0.01 SOL, inner instruction moved 0.02",
          cluster: "devnet",
          sig: SIG.devnetRevert,
          href: tx(SIG.devnetRevert, "devnet"),
          status: "blocked",
        },
        {
          code: "PASS",
          attempt: "Control: declared amount matches the simulation",
          cluster: "devnet",
          sig: SIG.devnetPass,
          href: tx(SIG.devnetPass, "devnet"),
          status: "passed",
        },
      ],
      statusBlocked: "REJECTED",
      statusPassed: "EXECUTED",
      note: "On-chain rejection codes: 6000 AmountExceeded · 6002 DailyLimitExceeded · 6003 ProgramNotAllowed · 6004 UnauthorizedAgent · 6011 declared-vs-effect invariant (I1).",
    },
    quickstart: {
      title: "Clone. Install. Double-click.",
      sub: "The repository is a working demo, not a code dump: a live dashboard, a real-wallet example, and an MCP server for agent frameworks.",
      steps: [
        {
          title: "Run the test suite",
          body: "85 cases, no setup beyond Node.js.",
          command: "npm test",
        },
        {
          title: "Open the interception console",
          body: "Scripted attack scenarios and a live log over SSE, persisted across restarts.",
          command: "npm run dashboard",
        },
        {
          title: "Try a real transfer",
          body: "The firewall verifies before signing. Blocked transactions never get signed.",
          command: "npx tsx examples/real-wallet-transfer.ts <recipient> 0.01",
        },
      ],
      mcpTitle: "MCP server",
      mcpBody: "Plug the firewall into any agent framework over stdio.",
      mcpCode: "validate_transaction · explain_decision · get_policy",
      dashboardTitle: "Policy in code",
      dashboardBody: "Declared limits and invariants, enforced before any signature.",
      dashboardCode:
        'new Firewall({ maxTransactionAmount: 0.5, dailyLimit: 5, allowedPrograms: [...] }, { connection })',
    },
    finalCta: {
      title: "Three layers. One signature you can trust.",
      sub: "Open source, MIT licensed. Deployed on devnet and testnet today.",
      button: "Star and use it on GitHub",
    },
    footer: {
      license: "MIT · solana-agent-firewall",
      builtFor: "Built for AI agents on Solana",
    },
    langLabel: "中文",
  },
  zh: {
    meta: {
      title: "Solana Agent Firewall — 挡在 AI Agent 与其签名之间的防火墙",
      description:
        "三层防御检查 AI Agent 在 Solana 上签下的每一笔交易。提示注入、owner 钓鱼、私钥泄露，不再等于钱包被搬空。",
    },
    nav: {
      layers: "防御体系",
      evidence: "验证证据",
      quickstart: "快速开始",
      github: "GitHub",
    },
    hero: {
      headline: "挡在 AI Agent 与其签名之间的防火墙。",
      sub: "三层防御检查 AI Agent 在 Solana 上签下的每一笔交易，让提示注入、owner 钓鱼和私钥泄露都搬不走钱包。",
      ctaPrimary: "去 GitHub 使用",
      ctaSecondary: "看链上证据",
      installLabel: "一条命令安装",
      installCommand: "npm install solana-agent-firewall",
      register: {
        label: "实时账本 · 程序 5ZtXDT2Q…",
        cluster: "devnet",
        cols: ["可信", "限额", "规避", "价值", "模拟"],
        fromLabel: "AGENT",
        from: "7a6YDAL8…btVZ",
        declared: "申报 0.01 SOL",
        actual: "CPI 实转 0.02 SOL",
        verdict: "已拦截",
        reason: "申报金额与模拟执行结果不符。不变量 I1，错误码 6011。",
        sigLabel: "签名",
        sig: SIG.devnetRevert,
        sigHref: tx(SIG.devnetRevert, "devnet"),
        signed: "从未签名——签名前即被拦截。",
        seeOnChain: "链上查看",
      },
    },
    layers: {
      title: "每一层存在，都是因为上一层可以被骗过。",
      sub: "客户端门禁最快。模拟执行看得更深。链上强制保证前两层都无法保证的事。",
      items: [
        {
          name: "CLAW 四门",
          role: "客户端 · 完全离线 · <1ms",
          body: "CLAW 在交易离开你的机器之前解析它：可信度、限额、规避、价值四门。明显的攻击在这里就被拦下，无需任何 RPC 往返。",
          evidence: "85 个测试覆盖 22 个文件，离线解析 legacy 与 V0 交易。",
        },
        {
          name: "模拟执行",
          role: "签名之前，对照真实链上状态跑一遍",
          body: "每笔交易都对照真实链上状态模拟执行。内层指令偷偷改 owner、实际转出超过申报金额——静态检查看不见的攻击——在这里失败。",
          evidence: "五个真实攻击剧本对照真实 RPC 状态全部拦下。",
        },
        {
          name: "链上强制",
          role: "PDA 金库 · Agent 私钥对金库零权力",
          body: "资金存在 PDA 金库里。提现必须通过链上的身份校验、单笔上限、白名单、收款地址与 24 小时窗口。就算私钥完全泄露，也搬不走金库。",
          evidence: "Testnet 集成测试 6/6。每一笔拒绝都是公开的链上交易。",
        },
      ],
    },
    evidence: {
      title: "每一句宣传都链到一个测试或一笔交易。",
      sub: "防火墙用它的用户验证世界的方式被验证：在链上、在测试运行器里。下面是真实交易，由已部署的程序拒绝。",
      cols: {
        code: "错误码",
        attempt: "被拦截的尝试",
        cluster: "网络",
        signature: "签名",
      },
      rows: [
        {
          code: "6000",
          attempt: "提现超过单笔上限",
          cluster: "testnet",
          sig: SIG.t6000,
          href: tx(SIG.t6000, "testnet"),
          status: "blocked",
        },
        {
          code: "6002",
          attempt: "提现超过 24 小时窗口",
          cluster: "testnet",
          sig: SIG.t6002,
          href: tx(SIG.t6002, "testnet"),
          status: "blocked",
        },
        {
          code: "6003",
          attempt: "转账目标程序不在白名单",
          cluster: "testnet",
          sig: SIG.t6003,
          href: tx(SIG.t6003, "testnet"),
          status: "blocked",
        },
        {
          code: "6004",
          attempt: "未注册的 Agent 试图提现",
          cluster: "testnet",
          sig: SIG.t6004,
          href: tx(SIG.t6004, "testnet"),
          status: "blocked",
        },
        {
          code: "6011",
          attempt: "申报 0.01 SOL，内层指令实转 0.02",
          cluster: "devnet",
          sig: SIG.devnetRevert,
          href: tx(SIG.devnetRevert, "devnet"),
          status: "blocked",
        },
        {
          code: "PASS",
          attempt: "对照：申报金额与模拟结果一致",
          cluster: "devnet",
          sig: SIG.devnetPass,
          href: tx(SIG.devnetPass, "devnet"),
          status: "passed",
        },
      ],
      statusBlocked: "已拒绝",
      statusPassed: "已执行",
      note: "链上拒绝错误码：6000 超单笔上限 · 6002 超日限额 · 6003 程序不在白名单 · 6004 未授权 Agent · 6011 申报与实效不符（不变量 I1）。",
    },
    quickstart: {
      title: "克隆。安装。双击。",
      sub: "仓库本身就是一个能跑的演示：实时面板、真实钱包示例、给 Agent 框架用的 MCP 服务器。",
      steps: [
        {
          title: "跑测试套件",
          body: "85 个用例，装好 Node.js 之外零配置。",
          command: "npm test",
        },
        {
          title: "打开拦截控制台",
          body: "剧本化攻击演示 + SSE 实时拦截日志，重启不丢。",
          command: "npm run dashboard",
        },
        {
          title: "试一笔真实转账",
          body: "签名前先验证，被拦截的交易永远不会被签名。",
          command: "npx tsx examples/real-wallet-transfer.ts <收款地址> 0.01",
        },
      ],
      mcpTitle: "MCP 服务器",
      mcpBody: "走 stdio 把防火墙接进任何 Agent 框架。",
      mcpCode: "validate_transaction · explain_decision · get_policy",
      dashboardTitle: "代码里的策略",
      dashboardBody: "申报的限额与不变量，在任何签名之前被强制执行。",
      dashboardCode:
        'new Firewall({ maxTransactionAmount: 0.5, dailyLimit: 5, allowedPrograms: [...] }, { connection })',
    },
    finalCta: {
      title: "三层防御。一个你放心的签名。",
      sub: "开源、MIT 协议。今天已部署在 devnet 与 testnet。",
      button: "Star 并在 GitHub 使用",
    },
    footer: {
      license: "MIT · solana-agent-firewall",
      builtFor: "为 Solana 上的 AI Agent 而建",
    },
    langLabel: "EN",
  },
};

export function getDictionary(locale: string): Dict {
  return dictionaries[locale === "zh" ? "zh" : "en"];
}

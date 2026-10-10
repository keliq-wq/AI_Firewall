import { TransactionIntent, ValidationResult } from "./types";

/**
 * 风险叙述器：把技术风险转化为面向 Agent / 人类决策者的自然语言解释。
 * 这是"可解释安全"的核心——拦截时不输出黑盒错误码，而是讲清楚发生了什么、为什么拦截。
 */
export interface Narrator {
  explain(intent: TransactionIntent, result: ValidationResult): Promise<string>;
}

export type NarratorLocale = "zh" | "en";

/** 默认实现：确定性模板叙述，完全离线可用，不虚构外部事实；支持中英双语 */
export class TemplateNarrator implements Narrator {
  constructor(private readonly locale: NarratorLocale = "zh") {}

  async explain(intent: TransactionIntent, result: ValidationResult): Promise<string> {
    if (this.locale === "en") {
      const tierLabel = { info: "INFO", notice: "NOTICE", confirm: "CONFIRM", deny: "DENY" }[result.tier ?? "info"];
      const verdict = result.shouldProceed
        ? "ALLOWED"
        : result.requiresConfirmation
          ? "BLOCKED - human confirmation required"
          : "BLOCKED";
      const parts: string[] = [`【${verdict} · ${tierLabel}】`];
      if (intent.action) parts.push(`Action: ${intent.action}`);
      if (intent.amount != null) parts.push(`Amount: ${intent.amount}`);
      if (intent.recipient) parts.push(`Recipient: ${intent.recipient}`);
      if (intent.purpose) parts.push(`Business purpose: ${intent.purpose}`);

      const critical = result.concerns.filter((c) => c.severity === "critical");
      const high = result.concerns.filter((c) => c.severity === "high");
      if (critical.length > 0) parts.push(`Critical risks: ${critical.map((c) => c.message).join("; ")}`);
      if (high.length > 0) parts.push(`High risks: ${high.map((c) => c.message).join("; ")}`);
      if (critical.length === 0 && high.length === 0 && result.concerns.length > 0) {
        parts.push(`Notes: ${result.concerns.slice(0, 3).map((c) => c.message).join("; ")}`);
      }
      return parts.join("\n");
    }

    const tierLabel = { info: "记录", notice: "提示", confirm: "待确认", deny: "拒绝" }[result.tier ?? "info"];
    const verdict = result.shouldProceed
      ? "已放行"
      : result.requiresConfirmation
        ? "已拦截，等待人工确认"
        : "已拦截";
    const parts: string[] = [`【${verdict} · ${tierLabel}】`];
    if (intent.action) parts.push(`操作：${intent.action}`);
    if (intent.amount != null) parts.push(`金额：${intent.amount}`);
    if (intent.recipient) parts.push(`收款方：${intent.recipient}`);
    if (intent.purpose) parts.push(`业务理由：${intent.purpose}`);

    const critical = result.concerns.filter((c) => c.severity === "critical");
    const high = result.concerns.filter((c) => c.severity === "high");
    if (critical.length > 0) parts.push(`关键风险：${critical.map((c) => c.message).join("；")}`);
    if (high.length > 0) parts.push(`高风险：${high.map((c) => c.message).join("；")}`);
    if (critical.length === 0 && high.length === 0 && result.concerns.length > 0) {
      parts.push(`提示：${result.concerns.slice(0, 3).map((c) => c.message).join("；")}`);
    }
    return parts.join("\n");
  }
}

export interface OpenAICompatibleNarratorOptions {
  apiKey: string;
  /** OpenAI 兼容端点（DeepSeek/Ollama/OpenAI 等）。默认 https://api.openai.com/v1 */
  baseURL?: string;
  model?: string;
}

/** 可选实现：调用任意 OpenAI 兼容 LLM API 生成更丰富的风险叙述（需联网与密钥） */
export class OpenAICompatibleNarrator implements Narrator {
  private readonly opts: Required<OpenAICompatibleNarratorOptions>;

  constructor(options: OpenAICompatibleNarratorOptions) {
    if (!options.apiKey) throw new Error("OpenAICompatibleNarrator requires an apiKey");
    this.opts = {
      apiKey: options.apiKey,
      baseURL: options.baseURL ?? "https://api.openai.com/v1",
      model: options.model ?? "gpt-4o-mini",
    };
  }

  async explain(intent: TransactionIntent, result: ValidationResult): Promise<string> {
    const prompt = `你是 Solana AI Agent 交易防火墙的风险叙述器。用简洁的中文向交易执行者解释以下安全判定。
不要虚构事实，只基于给定数据叙述；若判定为拦截，说明是哪个检查拦截的以及潜在后果。

判定摘要：${result.summary}
意图：${JSON.stringify({
      action: intent.action,
      amount: intent.amount,
      recipient: intent.recipient,
      purpose: intent.purpose,
    })}
风险项：
${result.concerns.map((c) => `[${c.severity}] ${c.message}`).join("\n")}`;

    const resp = await fetch(`${this.opts.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({
        model: this.opts.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
    });
    if (!resp.ok) {
      throw new Error(`LLM API ${resp.status}: ${await resp.text()}`);
    }
    const data = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? JSON.stringify(data);
  }
}

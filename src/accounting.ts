import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { ParsedTransaction } from "./parser";
import { SpendStore } from "./types";
import { TransactionIntent } from "./types";

/**
 * 账本与幂等记账（修复审计发现的 24h 限额三路绕过）：
 *
 * 1. 「不声明金额永不记账」→ recordSpend 用推导金额兜底(声明缺失时取解析出的转出额)
 * 2. 「同收款方 key 覆盖不累积」→ 记账键改为**交易内容指纹**：同笔重试替换、不同笔累积
 * 3. 「缺 recipient 塌缩为 transfer:?」→ 指纹不依赖 recipient,塌缩无害(不同交易指纹不同)
 *
 * 语义:append-only 条目数组;同 (scope, 指纹) 在窗口内重复记录 = 替换(幂等),
 * 不同指纹 = 追加(累积)。24h 支出 = 窗口内全部条目之和(全局日限,不再按收款方分桶)。
 */

/** djb2 字符串哈希(记账指纹用,非密码学用途) */
function djb2(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * 交易内容指纹:
 * - 有原始交易 → 序列化消息字节的哈希(交易内容变即指纹变;重试同笔交易指纹不变)
 * - 无交易 → idempotencyKey ?? intent 字段拼接哈希(自述降级,不如交易指纹可靠)
 */
export function transactionFingerprint(intent: TransactionIntent, parsed: ParsedTransaction): string {
  const tx = intent.transaction;
  if (tx) {
    if (tx instanceof VersionedTransaction) {
      return djb2(Buffer.from(tx.message.serialize()).toString("base64"));
    }
    try {
      return djb2(Buffer.from(tx.serializeMessage()).toString("base64"));
    } catch {
      /* 缺 blockhash 无法序列化 → 降级 */
    }
  }
  if (intent.idempotencyKey) return `k:${djb2(intent.idempotencyKey)}`;
  return `i:${djb2(
    [
      intent.action,
      intent.amount ?? "",
      intent.recipient ?? "",
      intent.wallet ?? "",
      parsed.nativeTransfers.map((t) => `${t.from}>${t.to}:${t.lamports}`).join(","),
      parsed.tokenTransfers.map((t) => `${t.source}>${t.dest}:${t.mint}:${t.amount}`).join(","),
    ].join("|"),
  )}`;
}

interface LedgerEntry {
  at: number;
  amount: number;
  fingerprint: string;
  label: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Append-only 滚动支出存储。
 * 同 (scope, fingerprint) 在窗口内重复记录 = 替换金额(幂等重试不重复扣);
 * 不同指纹 = 追加。惰性清理窗口外条目。
 */
export class AppendOnlySpendStore implements SpendStore {
  private readonly scopes = new Map<string, LedgerEntry[]>();

  record(scope: string, key: string, amount: number, at: number = Date.now()): void {
    let entries = this.scopes.get(scope);
    if (!entries) {
      entries = [];
      this.scopes.set(scope, entries);
    }
    const idx = entries.findIndex((e) => e.fingerprint === key && e.at >= at - DAY_MS);
    if (idx >= 0) {
      // 同笔交易重复校验 → 替换(幂等)
      entries[idx] = { at, amount, fingerprint: key, label: key.slice(0, 24) };
    } else {
      entries.push({ at, amount, fingerprint: key, label: key.slice(0, 24) });
    }
  }

  sumSince(scope: string, since: number, excludeKey?: string): number | Promise<number> {
    const entries = this.scopes.get(scope);
    if (!entries) return 0;
    let sum = 0;
    for (const e of entries) {
      if (e.at < since) continue;
      if (excludeKey && e.fingerprint === excludeKey) continue;
      sum += e.amount;
    }
    return sum;
  }

  /** 诊断:窗口内条目明细 */
  entriesSince(scope: string, since: number): LedgerEntry[] {
    return (this.scopes.get(scope) ?? []).filter((e) => e.at >= since);
  }
}

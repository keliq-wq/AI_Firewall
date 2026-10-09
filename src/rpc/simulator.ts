import { AccountInfo, Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

/**
 * 第 2 层：交易模拟执行引擎。
 *
 * 通过 simulateTransaction（RPC）在交易上链前揭示其真实效果——静态解析（第 1 层）
 * 只能看到顶层指令，无法覆盖 CPI 内部指令带来的 owner 变更与资金流出。
 * 模拟返回的被触及账户最终状态与交易账户键顺序对齐，与链上预状态比对得出净变化。
 */

export interface SimulatedEffect {
  account: string;
  preLamports: number;
  postLamports: number;
  deltaLamports: number;
  /** null 表示模拟执行中新建的账户 */
  preOwner: string | null;
  postOwner: string | null;
  /** 仅当既有账户的 owner 在模拟执行后发生变化时为 true（新建账户不算） */
  ownerChanged: boolean;
}

export interface SimulationReport {
  /** 模拟错误（交易将 revert） */
  err: string | null;
  effects: SimulatedEffect[];
  logs: string[];
  unitsConsumed: number;
}

export class TransactionSimulator {
  constructor(private readonly connection: Connection) {}

  async simulate(tx: Transaction | VersionedTransaction, fallbackPayer?: PublicKey): Promise<SimulationReport> {
    // legacy 交易序列化需要 blockhash；模拟模式用 replaceRecentBlockhash 替换为最近有效的
    if (tx instanceof Transaction) {
      if (!tx.recentBlockhash) {
        tx.recentBlockhash = (await this.connection.getLatestBlockhash("confirmed")).blockhash;
      }
      if (!tx.feePayer) {
        if (!fallbackPayer) {
          throw new Error(
            "Transaction fee payer required: set tx.feePayer or declare intent.wallet",
          );
        }
        tx.feePayer = fallbackPayer;
      }
    }

    // 真实 RPC 强制要求 accounts.addresses 字段（1.18+ 省略会报 "missing field addresses"）。
    // 传入交易账户键：响应按此顺序返回对应账户状态。
    // 注：CPI 内部账户不会出现在 addresses 列表中，深度 CPI 可见性留待后续 RPC 版本/代理方案。
    const keys = accountKeysOf(tx);
    const config = {
      sigVerify: false,
      replaceRecentBlockhash: true,
      accounts: {
        encoding: "base64",
        addresses: keys.map((k) => k.toBase58()),
      } as { encoding: "base64"; addresses: string[] },
    };
    // 联合类型在两个重载上分别匹配；
    // legacy 路径（旧签名）用 includeAccounts: true → 返回 nonProgramIds 顺序的账户状态，
    // 与 accountKeysOf 的 legacy 分支对齐
    const resp =
      tx instanceof VersionedTransaction
        ? await this.connection.simulateTransaction(tx, config)
        : await this.connection.simulateTransaction(tx, undefined, true);
    const value = resp.value;
    const err = value.err
      ? typeof value.err === "string"
        ? value.err
        : JSON.stringify(value.err)
      : null;

    // 模拟响应中的账户状态与交易账户键顺序对齐（RPC 约定）；未覆盖的键截断处理
    const postStates = value.accounts ?? [];
    const count = Math.min(keys.length, postStates.length);
    const pubkeys = keys.slice(0, count);
    const preStates =
      pubkeys.length > 0
        ? await this.connection.getMultipleAccountsInfo(pubkeys, "confirmed")
        : [];

    const effects: SimulatedEffect[] = [];
    for (let i = 0; i < count; i++) {
      const post = postStates[i];
      const key = pubkeys[i];
      if (!post || !key) continue;
      const pre: AccountInfo<Buffer> | null = preStates[i] ?? null;
      const preOwner = pre?.owner.toBase58() ?? null;
      const postOwner = post.owner;
      effects.push({
        account: key.toBase58(),
        preLamports: pre?.lamports ?? 0,
        postLamports: post.lamports,
        deltaLamports: post.lamports - (pre?.lamports ?? 0),
        preOwner,
        postOwner,
        ownerChanged: preOwner != null && postOwner != null && preOwner !== postOwner,
      });
    }

    return { err, effects, logs: value.logs ?? [], unitsConsumed: value.unitsConsumed ?? 0 };
  }
}

/**
 * 提取交易账户键（保序去重，与模拟响应对齐）：
 * - legacy：模拟响应按 nonProgramIds() 顺序返回（web3.js v1 legacy 路径语义）
 * - versioned：省略 addresses 时响应按交易账户键顺序返回全部被触及账户
 */
function accountKeysOf(tx: Transaction | VersionedTransaction): PublicKey[] {
  let keys: PublicKey[];
  if (tx instanceof Transaction) {
    try {
      keys = tx.compileMessage().nonProgramIds();
    } catch {
      // 无 fee payer 时退化为指令遍历（仅用于与模拟响应对齐，顺序可能不完全一致）
      keys = [];
      for (const ix of tx.instructions) {
        keys.push(ix.programId, ...ix.keys.map((m) => m.pubkey));
      }
    }
  } else {
    const messageKeys = tx.message.getAccountKeys();
    keys = [];
    for (let i = 0; i < messageKeys.length; i++) {
      try {
        const key = messageKeys.get(i);
        if (key) keys.push(key);
      } catch {
        /* 未解析的 ALT 键跳过 */
      }
    }
  }
  const seen = new Set<string>();
  const out: PublicKey[] = [];
  for (const key of keys) {
    const s = key.toBase58();
    if (!seen.has(s)) {
      seen.add(s);
      out.push(key);
    }
  }
  return out;
}

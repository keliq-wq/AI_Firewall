import { AccountInfo, Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { decodeTokenAccount, DecodedTokenAccount } from "../decode/token_layout";
import { accountKeysOf } from "../rpc/simulator";

/**
 * 效果收集器（Layer 2 事实层）：把 simulateTransaction 的响应变成协议无关的
 * 资金/权限变化事实。P0 契约发现的三大约束全部内建：
 *
 * 1. addresses 数量上限随版本(1.18=4 / 4.4=5)→ 分块模拟,每块 ≤4,按索引合并
 * 2. 多节点端点前态滞后 → getMultipleAccountsInfo 重试;最终缺失 = CoverageGap(fail-closed)
 * 3. 响应完整性对账:返回条数少于请求 → truncated,调用方必须 fail-closed,不得当作"无变化"
 *
 * 产出对任意协议通用(swap/转账/授权无需协议专属代码):
 * - 每资产余额 delta(SOL + 所有代币 mint)
 * - 权限突变:delegate 设置/变更、delegatedAmount 增加(Approve)、closeAuthority 变更、冻结
 * - 内层敏感指令命中(CPI 转发的 Approve/SetAuthority/CloseAccount 同样暴露)
 */

const TOKEN_PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);
const SENSITIVE_TOKEN_TAGS = new Set([4, 6, 9]); // Approve / SetAuthority / CloseAccount

export interface TokenEffectDelta {
  account: string;
  owner: string;
  mint: string;
  pre: DecodedTokenAccount | null;
  post: DecodedTokenAccount | null;
  amountDelta: bigint;
  /** Approve = delegate 出现/更换,或 delegatedAmount 增加(有方向性,Revoke 不算) */
  approveDetected: boolean;
  /** Revoke = delegate 撤销(Some→None),安全善后动作 */
  delegateRevoked: boolean;
  delegateChanged: boolean;
  closeAuthorityChanged: boolean;
  frozenChanged: boolean;
}

export interface EffectReport {
  simErr: string | null;
  /** 请求-响应对账:complete=全部返回;truncated=响应条数不足;missing-pre=前态缺失 */
  completeness: "complete" | "truncated" | "missing-pre";
  feePayerDeltaLamports: number | null;
  solDeltas: { account: string; deltaLamports: number }[];
  tokenDeltas: TokenEffectDelta[];
  /** 内层指令中的敏感 token 操作(CPI 深层转发也命中) */
  innerSensitiveHits: { tag: number; program: string }[];
}

const CHUNK = 4; // 契约最小公分母(本地 1.18 = max 4)

export class EffectsCollector {
  constructor(private readonly connection: Connection) {}

  async collect(tx: Transaction | VersionedTransaction): Promise<EffectReport> {
    const keys = accountKeysOf(tx);
    const addresses = keys.map((k) => k.toBase58());

    // ── 分块模拟 ──
    const chunks: string[][] = [];
    for (let i = 0; i < addresses.length; i += CHUNK) chunks.push(addresses.slice(i, i + CHUNK));

    type SimAccount = NonNullable<
      Awaited<ReturnType<Connection["simulateTransaction"]>>["value"]["accounts"]
    >[number];
    const merged: (SimAccount | null)[] = new Array(addresses.length).fill(null);
    let simErr: string | null = null;
    let truncated = false;
    let innerSensitiveHits: { tag: number; program: string }[] = [];

    const scanInner = (value: {
      innerInstructions?: { index: number; instructions: unknown[] }[] | null;
    }) => {
      // 内层敏感指令扫描(I4):CPI 转发的 Approve/SetAuthority/CloseAccount 同样暴露
      for (const group of value.innerInstructions ?? []) {
        for (const inner of group.instructions) {
          const programIdx = (inner as { programIdIndex?: number }).programIdIndex;
          if (programIdx == null) continue;
          let program = "";
          try {
            program =
              tx instanceof VersionedTransaction
                ? (tx.message.getAccountKeys().get(programIdx)?.toBase58() ?? "")
                : (tx.compileMessage().getAccountKeys().get(programIdx)?.toBase58() ?? "");
          } catch {
            /* legacy 编译失败则跳过内层程序解析 */
          }
          const tag = (inner as { data?: string }).data
            ? Buffer.from((inner as { data: string }).data, "base64")[0]
            : undefined;
          if (program && tag != null && TOKEN_PROGRAMS.has(program) && SENSITIVE_TOKEN_TAGS.has(tag)) {
            innerSensitiveHits.push({ tag, program });
          }
        }
      }
    };

    if (tx instanceof VersionedTransaction) {
      // V0:分块 addresses 配置(契约上限),逐块对账
      for (const chunk of chunks) {
        const resp = await this.connection.simulateTransaction(tx, {
          sigVerify: false,
          replaceRecentBlockhash: true,
          innerInstructions: true,
          accounts: { encoding: "base64", addresses: chunk },
        });
        const value = resp.value;
        if (simErr == null && value.err) {
          simErr = typeof value.err === "string" ? value.err : JSON.stringify(value.err);
        }
        const base = chunks.indexOf(chunk) * CHUNK;
        const got = value.accounts ?? [];
        if (got.length < chunk.length) truncated = true; // 对账:少一条都要 fail-closed
        got.forEach((a, i) => {
          if (base + i < merged.length) merged[base + i] = a ?? null;
        });
        scanInner(value);
      }
    } else {
      // legacy:旧签名 includeAccounts,单次调用(无 addresses 过滤;无 CPI 可见性,
      // 完整性判定只看 accounts 是否为 null)
      const resp = await this.connection.simulateTransaction(tx, undefined, true);
      const value = resp.value;
      if (simErr == null && value.err) {
        simErr = typeof value.err === "string" ? value.err : JSON.stringify(value.err);
      }
      const got = value.accounts ?? [];
      if (got == null) truncated = true;
      got.forEach((a, i) => {
        if (i < merged.length) merged[i] = a ?? null;
      });
      scanInner(value as { innerInstructions?: { index: number; instructions: unknown[] }[] | null });
    }

    // ── 前态(多节点滞后重试)──
    let preStates: (AccountInfo<Buffer> | null)[] = [];
    let missingPre = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      preStates = await this.connection.getMultipleAccountsInfo(keys, "confirmed");
      if (preStates.every((s) => s != null)) break;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
    if (preStates.some((s) => s == null)) missingPre = true;

    // ── 事实提取 ──
    const feePayerIdx = keys.findIndex((k) => k.equals(feePayerOf(tx)));
    const solDeltas: EffectReport["solDeltas"] = [];
    const tokenDeltas: TokenEffectDelta[] = [];
    let feePayerDeltaLamports: number | null = null;

    keys.forEach((key, i) => {
      const pre = preStates[i];
      const post = merged[i];
      if (!post) return; // 幽灵/未返回

      if (pre && pre.owner.toBase58() !== post.owner) {
        // owner 变更(既有账户)——上层 gate 已覆盖,这里只记录 lamports delta
      }
      const delta = (post.lamports ?? 0) - (pre?.lamports ?? 0);
      if (delta !== 0) solDeltas.push({ account: key.toBase58(), deltaLamports: delta });
      if (i === feePayerIdx) feePayerDeltaLamports = delta;

      // 代币账户:165B 数据解码 → 余额/权限 delta
      if (TOKEN_PROGRAMS.has(post.owner)) {
        const postData = post.data?.[0] ? Buffer.from(post.data[0], "base64") : null;
        const preData = pre?.data?.length ? pre.data : null;
        if (!postData) return;
        const postDecoded = decodeTokenAccount(postData);
        const preDecoded = preData ? decodeTokenAccount(preData) : null;
        if (!postDecoded) return;
        const preDelegate = preDecoded?.delegate?.toBase58() ?? null;
        const postDelegate = postDecoded.delegate?.toBase58() ?? null;
        const delegatedAmountDelta =
          preDecoded != null ? postDecoded.delegatedAmount - preDecoded.delegatedAmount : 0n;
        // 方向性(审计响应):Some→None 或额度减少 = Revoke(安全善后),不算 Approve
        const delegateGranted = postDelegate != null && preDelegate !== postDelegate;
        const delegatedAmountIncreased = delegatedAmountDelta > 0n;
        const approveDetected = delegateGranted || delegatedAmountIncreased;
        const delegateRevoked =
          postDelegate == null && preDelegate != null;
        tokenDeltas.push({
          account: key.toBase58(),
          owner: postDecoded.owner.toBase58(),
          mint: postDecoded.mint.toBase58(),
          pre: preDecoded,
          post: postDecoded,
          amountDelta: postDecoded.amount - (preDecoded?.amount ?? 0n),
          approveDetected,
          delegateRevoked,
          delegateChanged: preDecoded != null && preDelegate !== postDelegate,
          closeAuthorityChanged:
            preDecoded != null &&
            (preDecoded.closeAuthority?.toBase58() ?? null) !== (postDecoded.closeAuthority?.toBase58() ?? null),
          frozenChanged: preDecoded != null && preDecoded.state !== postDecoded.state,
        });
      }
    });

    return {
      simErr,
      completeness: truncated ? "truncated" : missingPre ? "missing-pre" : "complete",
      feePayerDeltaLamports,
      solDeltas,
      tokenDeltas,
      innerSensitiveHits,
    };
  }
}

function feePayerOf(tx: Transaction | VersionedTransaction): PublicKey {
  if (tx instanceof VersionedTransaction) {
    const idx = tx.message.staticAccountKeys.length > 0 ? 0 : 0;
    return tx.message.getAccountKeys().get(idx) ?? PublicKey.default;
  }
  return tx.feePayer ?? PublicKey.default;
}

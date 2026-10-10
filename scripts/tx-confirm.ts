/**
 * 交易确认工具：HTTP 轮询确认（legacy 策略），零 WebSocket 依赖，附 502 重试。
 *
 * 背景：经本地 rpc-proxy 转发时，WebSocket 订阅对「订阅前已处理」的交易不补发通知，
 * 而测试网 400ms 即上链、订阅建立要 1-2s，竞态必输 → confirmTransaction 永远超时。
 * 且代理链路间歇性 502，所有 RPC 调用统一加重试。
 */
import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";

/** 通用重试：proxy 链路间歇 502，默认 5 次、1.5s 退避 */
export async function retry<T>(fn: () => Promise<T>, label: string, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String(e);
      if (!msg.includes("502")) throw e; // 非 502 不重试
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new Error(`${label} 重试 ${attempts} 次仍失败: ${String(lastErr)}`);
}

export function getLatestBlockhashRetry(connection: Connection) {
  return retry(() => connection.getLatestBlockhash("confirmed"), "getLatestBlockhash");
}

export function sendRawTransactionRetry(connection: Connection, tx: Transaction | VersionedTransaction) {
  // skipPreflight：链上拒绝是集成测试的预期结果，预检模拟会拦下「应被拒绝」的交易而不上链
  return retry(
    () => connection.sendRawTransaction(tx.serialize(), { skipPreflight: true }),
    "sendRawTransaction",
  );
}

export interface ConfirmedResult {
  signature: string;
  err: unknown;
}

/** 轮询确认已发送的交易；返回最终状态（不抛错，err 交给调用方判断） */
export async function confirmHttp(connection: Connection, signature: string): Promise<ConfirmedResult> {
  const bh = await getLatestBlockhashRetry(connection);
  const result = await retry(
    () =>
      connection.confirmTransaction(
        { signature, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
        "confirmed",
      ),
    "confirmTransaction",
  );
  return { signature, err: result.value.err };
}

/** 发送并确认；交易链上失败时抛错（含错误码） */
export async function sendAndConfirmHttp(
  connection: Connection,
  tx: Transaction | VersionedTransaction,
): Promise<ConfirmedResult> {
  const signature = await sendRawTransactionRetry(connection, tx);
  const r = await confirmHttp(connection, signature);
  if (r.err) {
    throw new Error(`链上失败: ${JSON.stringify(r.err)}`);
  }
  return r;
}

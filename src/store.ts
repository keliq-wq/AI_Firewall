import { SpendStore } from "./types";

interface SpendEntry {
  at: number;
  amount: number;
}

/** 内存滚动支出存储：同一 key 幂等覆盖，读取时惰性清理过期条目 */
export class InMemorySpendStore implements SpendStore {
  private readonly scopes = new Map<string, Map<string, SpendEntry>>();

  record(scope: string, key: string, amount: number, at: number = Date.now()): void {
    let entries = this.scopes.get(scope);
    if (!entries) {
      entries = new Map();
      this.scopes.set(scope, entries);
    }
    entries.set(key, { at, amount });
  }

  sumSince(scope: string, since: number, excludeKey?: string): number {
    const entries = this.scopes.get(scope);
    if (!entries) return 0;
    let sum = 0;
    for (const [key, entry] of entries) {
      if (entry.at < since) {
        entries.delete(key);
        continue;
      }
      if (key === excludeKey) continue;
      sum += entry.amount;
    }
    return sum;
  }
}

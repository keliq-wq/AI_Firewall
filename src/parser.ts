import {
  AccountMeta,
  PublicKey,
  SystemInstruction,
  Transaction,
  TransactionInstruction,
  VersionedMessage,
  VersionedTransaction,
} from "@solana/web3.js";

/** Token 程序地址（常量内联，避免额外依赖） */
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/**
 * 交易离线解析器：不依赖 RPC，纯本地解码。
 * 这是第 1 层（客户端快速拒绝）的关键能力——在签名前识别 owner 静默转移、
 * 原生/代币转账明细与涉及的程序集合。
 */

/** 一次 owner 变更事件（Solana 账户模型的特有攻击面） */
export interface OwnerChange {
  account: string;
  newOwner: string;
  via: "create_account" | "create_account_with_seed" | "assign" | "assign_with_seed";
}

export interface NativeTransfer {
  from: string;
  to: string;
  lamports: number;
}

/** 代币转账：amount 为 raw 最小单位（无 mint decimals 无法折算，仅记录） */
export interface TokenTransfer {
  source: string;
  dest: string;
  mint: string;
  amount: string;
}

export interface ParsedTransaction {
  programIds: string[];
  accountKeys: string[];
  nativeTransfers: NativeTransfer[];
  tokenTransfers: TokenTransfer[];
  ownerChanges: OwnerChange[];
  /** 存在无法离线解析的地址查找表（ALT） */
  unresolvedLookups: boolean;
}

export const EMPTY_PARSED: ParsedTransaction = {
  programIds: [],
  accountKeys: [],
  nativeTransfers: [],
  tokenTransfers: [],
  ownerChanges: [],
  unresolvedLookups: false,
};

export function parseTransaction(tx?: Transaction | VersionedTransaction): ParsedTransaction {
  if (!tx) return EMPTY_PARSED;
  return tx instanceof VersionedTransaction ? parseVersioned(tx) : parseLegacy(tx);
}

/** 从解析结果推导敏感操作类别（worth 门兜底：intent.action 缺失或不准时仍能生效） */
export function classifyActions(parsed: ParsedTransaction): string[] {
  const actions: string[] = [];
  if (parsed.nativeTransfers.length > 0) actions.push("transfer");
  if (parsed.tokenTransfers.length > 0) actions.push("token_transfer");
  if (parsed.ownerChanges.some((c) => c.via === "assign" || c.via === "assign_with_seed")) {
    actions.push("assign_owner");
  }
  if (
    parsed.ownerChanges.some((c) => c.via === "create_account" || c.via === "create_account_with_seed")
  ) {
    actions.push("create_account");
  }
  return actions;
}

function parseLegacy(tx: Transaction): ParsedTransaction {
  const out = freshParsed();
  for (const ix of tx.instructions) {
    out.programIds.push(ix.programId.toBase58());
    for (const meta of ix.keys) out.accountKeys.push(meta.pubkey.toBase58());
    decodeInstruction(out, ix.programId.toBase58(), ix.data, ix.keys);
  }
  return dedupeParsed(out);
}

function parseVersioned(tx: VersionedTransaction): ParsedTransaction {
  const out = freshParsed();
  const msg = tx.message;
  for (const ix of msg.compiledInstructions) {
    const programId = resolveKey(msg, ix.programIdIndex);
    if (programId.startsWith("<")) {
      out.unresolvedLookups = true;
      continue;
    }
    out.programIds.push(programId);
    // 构建账户元数据：未解析的键标记后跳过依赖键的解码（如代币转账）
    const metas: AccountMeta[] = [];
    for (const idx of ix.accountKeyIndexes) {
      const key = resolveKey(msg, idx);
      if (key.startsWith("<")) {
        out.unresolvedLookups = true;
        metas.push({ pubkey: PublicKey.default, isSigner: false, isWritable: false });
        continue;
      }
      out.accountKeys.push(key);
      // 解析器只读取 pubkey 解码指令，签名/可写标志不影响离线解析
      metas.push({ pubkey: new PublicKey(key), isSigner: false, isWritable: false });
    }
    decodeInstruction(out, programId, Buffer.from(ix.data), metas);
  }
  return dedupeParsed(out);
}

function freshParsed(): ParsedTransaction {
  return {
    programIds: [],
    accountKeys: [],
    nativeTransfers: [],
    tokenTransfers: [],
    ownerChanges: [],
    unresolvedLookups: false,
  };
}

function resolveKey(msg: VersionedMessage, index: number): string {
  try {
    const key = msg.getAccountKeys().get(index);
    return key ? key.toBase58() : `<unresolved:${index}>`;
  } catch {
    return `<unresolved:${index}>`;
  }
}

/**
 * 构造合成指令供官方解码器使用。
 * 注意：v1.9x 的 SystemInstruction.decode* 会读取 instruction.keys
 * （如 decodeAssign 从 keys[0] 取账户公钥），因此必须传入真实账户元数据。
 */
function syntheticIx(programId: string, data: Buffer, keys: AccountMeta[]): TransactionInstruction {
  return { keys, programId: new PublicKey(programId), data };
}

function decodeInstruction(
  out: ParsedTransaction,
  programId: string,
  data: Buffer,
  keys: AccountMeta[],
): void {
  const ix = syntheticIx(programId, data, keys);

  // System 程序：原生转账 / 建户（owner 指定）/ assign（owner 变更）
  try {
    const t = SystemInstruction.decodeTransfer(ix);
    out.nativeTransfers.push({
      from: t.fromPubkey.toBase58(),
      to: t.toPubkey.toBase58(),
      lamports: Number(t.lamports),
    });
    return;
  } catch {
    /* 非该指令类型 */
  }
  try {
    const c = SystemInstruction.decodeCreateAccount(ix);
    out.ownerChanges.push({
      account: c.newAccountPubkey.toBase58(),
      newOwner: c.programId.toBase58(),
      via: "create_account",
    });
    return;
  } catch {
    /* 非该指令类型 */
  }
  try {
    const c = SystemInstruction.decodeCreateWithSeed(ix);
    out.ownerChanges.push({
      account: c.newAccountPubkey.toBase58(),
      newOwner: c.programId.toBase58(),
      via: "create_account_with_seed",
    });
    return;
  } catch {
    /* 非该指令类型 */
  }
  try {
    const a = SystemInstruction.decodeAssign(ix);
    out.ownerChanges.push({
      account: a.accountPubkey.toBase58(),
      newOwner: a.programId.toBase58(),
      via: "assign",
    });
    return;
  } catch {
    /* 非该指令类型 */
  }
  try {
    const a = SystemInstruction.decodeAssignWithSeed(ix);
    out.ownerChanges.push({
      account: a.accountPubkey.toBase58(),
      newOwner: a.programId.toBase58(),
      via: "assign_with_seed",
    });
    return;
  } catch {
    /* 非该指令类型 */
  }

  // Token 程序：转账（raw amount，无 mint decimals 无法折算，仅记录）
  if (programId === TOKEN_PROGRAM_ID || programId === TOKEN_2022_PROGRAM_ID) {
    const transfer = decodeTokenTransfer(data, keys);
    if (transfer) {
      out.tokenTransfers.push(transfer);
      return;
    }
  }
}

/** 手动解码 Token 转账：首字节指令类型（3=Transfer, 12=TransferChecked），其后为 u64 LE 金额；keys[0]=source, keys[1]=mint, keys[2]=dest */
function decodeTokenTransfer(data: Buffer, keys: AccountMeta[]): TokenTransfer | null {
  if (data.length < 9) return null;
  const type = data[0];
  if (type !== 3 && type !== 12) return null;
  const source = keys[0]?.pubkey;
  const mint = keys[1]?.pubkey;
  const dest = keys[2]?.pubkey;
  if (!source || !mint || !dest) return null;
  return {
    source: source.toBase58(),
    dest: dest.toBase58(),
    mint: mint.toBase58(),
    amount: data.readBigUInt64LE(1).toString(),
  };
}

function dedupeParsed(out: ParsedTransaction): ParsedTransaction {
  return {
    ...out,
    programIds: [...new Set(out.programIds)],
    accountKeys: [...new Set(out.accountKeys)],
  };
}

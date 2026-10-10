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
  /** Transfer(3) 指令不含 mint 账户，此字段为空串；TransferChecked(12) 才有 */
  mint: string;
  amount: string;
}

/** 代币权限/危险操作（授权即失去资金控制权，离线即可识别，一次实现全协议受益） */
export interface TokenAuthorityOp {
  kind: "approve" | "revoke" | "set_authority" | "close_account" | "burn";
  account: string;
  /** approve 的受托方 / close_account 的退款收款方 */
  counterparty?: string;
  /** approve 的授权金额(raw) */
  amount?: string;
  /** set_authority 的权限类型(1=mint,2=freeze,3=close,4=transfer fee,5=permanent delegate…) */
  authorityType?: number;
}

export interface ParsedTransaction {
  programIds: string[];
  accountKeys: string[];
  nativeTransfers: NativeTransfer[];
  tokenTransfers: TokenTransfer[];
  tokenAuthorityOps: TokenAuthorityOp[];
  ownerChanges: OwnerChange[];
  /** 存在无法离线解析的地址查找表（ALT） */
  unresolvedLookups: boolean;
}

export const EMPTY_PARSED: ParsedTransaction = {
  programIds: [],
  accountKeys: [],
  nativeTransfers: [],
  tokenTransfers: [],
  tokenAuthorityOps: [],
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
  // 代币权限操作：授权/关闭/权限转移是资金控制权变更，属敏感操作
  const tokenOps = parsed.tokenAuthorityOps;
  if (tokenOps.some((o) => o.kind === "approve")) actions.push("token_approve");
  if (tokenOps.some((o) => o.kind === "set_authority")) actions.push("set_authority");
  if (tokenOps.some((o) => o.kind === "close_account")) actions.push("close_account");
  if (tokenOps.some((o) => o.kind === "burn")) actions.push("burn");
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
    tokenAuthorityOps: [],
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

  // Token 程序：转账 + 权限/危险操作
  if (programId === TOKEN_PROGRAM_ID || programId === TOKEN_2022_PROGRAM_ID) {
    decodeTokenInstruction(out, data, keys);
  }
}

/**
 * 手动解码 Token 指令（对照 spl-token instruction 布局）：
 *   Transfer(3):         keys=[source(w), destination(w), authority(s)]      —— mint 不在指令中
 *   TransferChecked(12): keys=[source(w), mint(r), destination(w), authority(s)]
 *   Approve(4):          keys=[source(w), delegate(r), owner(s)]
 *   Revoke(5):           keys=[source(w), owner(s)]
 *   SetAuthority(6):     keys=[account(w), authority(s)] (+新 authority 在 data)
 *   Burn(8):             keys=[account(w), mint(r), owner(s)]
 *   CloseAccount(9):     keys=[account(w), destination(w), owner(s)]
 */
function decodeTokenInstruction(out: ParsedTransaction, data: Buffer, keys: AccountMeta[]): void {
  if (data.length < 1) return;
  const type = data[0];
  const keyAt = (i: number) => keys[i]?.pubkey?.toBase58();

  if (type === 3 && data.length >= 9) {
    const source = keyAt(0);
    const dest = keyAt(1);
    if (!source || !dest) return;
    out.tokenTransfers.push({
      source,
      dest,
      mint: "", // Transfer 指令无 mint 账户
      amount: data.readBigUInt64LE(1).toString(),
    });
    return;
  }
  if (type === 12 && data.length >= 10) {
    const source = keyAt(0);
    const mint = keyAt(1);
    const dest = keyAt(2);
    if (!source || !mint || !dest) return;
    out.tokenTransfers.push({
      source,
      dest,
      mint,
      amount: data.readBigUInt64LE(1).toString(),
    });
    return;
  }
  if (type === 4 && data.length >= 9) {
    const account = keyAt(0);
    const delegate = keyAt(1);
    if (!account) return;
    out.tokenAuthorityOps.push({
      kind: "approve",
      account,
      counterparty: delegate,
      amount: data.readBigUInt64LE(1).toString(),
    });
    return;
  }
  if (type === 5) {
    const account = keyAt(0);
    if (!account) return;
    out.tokenAuthorityOps.push({ kind: "revoke", account });
    return;
  }
  if (type === 6 && data.length >= 2) {
    const account = keyAt(0);
    if (!account) return;
    out.tokenAuthorityOps.push({ kind: "set_authority", account, authorityType: data[1] });
    return;
  }
  if (type === 9) {
    const account = keyAt(0);
    if (!account) return;
    out.tokenAuthorityOps.push({ kind: "close_account", account, counterparty: keyAt(1) });
    return;
  }
  if (type === 8) {
    const account = keyAt(0);
    if (!account) return;
    out.tokenAuthorityOps.push({ kind: "burn", account });
    return;
  }
}

function dedupeParsed(out: ParsedTransaction): ParsedTransaction {
  return {
    ...out,
    programIds: [...new Set(out.programIds)],
    accountKeys: [...new Set(out.accountKeys)],
  };
}

/**
 * SPL Token 账户/铸币账户的固定布局解码(纯 Buffer,零依赖)。
 *
 * 这是"效果提取层"的地基:模拟响应的账户 data(base64)按 165 字节 Token 布局解出
 * amount/delegate/delegatedAmount/closeAuthority——代币余额变化与权限突变因此
 * 对任意协议通用可见(swap/转账/授权都不需要协议专属代码)。
 *
 * 布局参考 spl-token state.rs(TokenAccount: 165B; Mint: 82B)。
 */
import { PublicKey } from "@solana/web3.js";

export const TOKEN_ACCOUNT_SIZE = 165;
export const MINT_SIZE = 82;

export interface DecodedTokenAccount {
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
  delegate: PublicKey | null; // None 表示为全零公钥(实际表示方式见 COption)
  delegateOption: number;
  delegatedAmount: bigint;
  state: number; // 0=uninitialized 1=initialized 2=frozen
  isNative: bigint | null;
  closeAuthority: PublicKey | null;
  closeAuthorityOption: number;
}

export interface DecodedMint {
  mintAuthority: PublicKey | null;
  supply: bigint;
  decimals: number;
  isInitialized: boolean;
  freezeAuthority: PublicKey | null;
}

/** 读 COption<Pubkey>:前 4 字节为 tag(0=None,1=Some),后 32 字节为公钥 */
function readCOption(buf: Buffer, offset: number): { key: PublicKey | null; tag: number } {
  const tag = buf.readUInt32LE(offset);
  if (tag === 1) {
    return { key: new PublicKey(buf.subarray(offset + 4, offset + 36)), tag };
  }
  return { key: null, tag };
}

/** 解码 165 字节 Token 账户。长度不足(未初始化账户可能只有部分数据)返回 null。 */
export function decodeTokenAccount(data: Buffer): DecodedTokenAccount | null {
  if (data.length < TOKEN_ACCOUNT_SIZE) return null;
  // 布局偏移对照 spl-token state.rs::Account:
  // mint@0 owner@32 amount@64 delegate(COption<Pubkey>)@72 state(u8)@108
  // is_native(COption<u64>)@109 delegated_amount@121 close_authority(COption<Pubkey>)@129
  const delegate = readCOption(data, 72);
  const isNativeTag = data.readUInt32LE(109);
  const closeAuthority = readCOption(data, 129);
  return {
    mint: new PublicKey(data.subarray(0, 32)),
    owner: new PublicKey(data.subarray(32, 64)),
    amount: data.readBigUInt64LE(64),
    delegate: delegate.key,
    delegateOption: delegate.tag,
    state: data.readUInt8(108),
    isNative: isNativeTag === 1 ? data.readBigUInt64LE(113) : null,
    delegatedAmount: data.readBigUInt64LE(121),
    closeAuthority: closeAuthority.key,
    closeAuthorityOption: closeAuthority.tag,
  };
}

/** 解码 82 字节 Mint 账户 */
export function decodeMint(data: Buffer): DecodedMint | null {
  if (data.length < MINT_SIZE) return null;
  const mintAuthority = readCOption(data, 0);
  const freezeAuthority = readCOption(data, 46);
  return {
    mintAuthority: mintAuthority.key,
    supply: data.readBigUInt64LE(36),
    decimals: data.readUInt8(44),
    isInitialized: data.readUInt8(45) !== 0,
    freezeAuthority: freezeAuthority.key,
  };
}

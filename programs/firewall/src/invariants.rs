//! 链上安全不变量（与客户端 src/invariants/engine.ts 同一组 ID）。
//!
//! P4 闭环：客户端预检与链上断言共用不变量 ID——同一攻击在客户端被 INV_I1/I2 拦，
//! 在链上被同一 ID 的错误码拒绝（error code ↔ invariant id 映射见 errors.rs）。

use anchor_lang::prelude::*;

/// 不变量 ID（与 TS 引擎一致）
pub const INVARIANT_I1: &str = "I1"; // 每资产净流出上界
pub const INVARIANT_I2: &str = "I2"; // 权限零突变
pub const INVARIANT_I4: &str = "I4"; // 敏感指令
pub const INVARIANT_C1: &str = "C1"; // 覆盖完整性

/// 链上错误码 ↔ 不变量 ID 映射（客户端据此把链上 revert 翻译成不变量语言）
pub const ERROR_CODE_TO_INVARIANT: [(u32, &str); 2] = [
    (6011, INVARIANT_I1),
    (6012, INVARIANT_I2),
];

pub const TOKEN_PROGRAM_ID: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
pub const TOKEN_2022_PROGRAM_ID: &str = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/// 从 Token 账户 data(165B)提取 delegate COption tag(offset 72)
pub fn token_delegate_tag(data: &[u8]) -> Option<u32> {
    if data.len() < 108 {
        return None;
    }
    Some(u32::from_le_bytes([data[72], data[73], data[74], data[75]]))
}

/// 从 Token 账户 data(165B)提取 closeAuthority COption tag(offset 129)
pub fn token_close_authority_tag(data: &[u8]) -> Option<u32> {
    if data.len() < 165 {
        return None;
    }
    Some(u32::from_le_bytes([data[129], data[130], data[131], data[132]]))
}

/// 账户是否为 Token 程序所有(代币账户)
pub fn is_token_account(owner: &Pubkey) -> bool {
    owner.to_string() == TOKEN_PROGRAM_ID || owner.to_string() == TOKEN_2022_PROGRAM_ID
}

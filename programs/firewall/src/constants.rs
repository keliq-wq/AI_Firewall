//! PDA 种子与协议常量

/// 策略账户 PDA 种子：["policy", authority]
pub const POLICY_SEED: &[u8] = b"policy";
/// 金库 PDA 种子：["vault", authority]——资金存放处，无数据，由程序签名支配
pub const VAULT_SEED: &[u8] = b"vault";
/// 金库状态 PDA 种子：["vault-state", authority]——滚动支出窗口记账
pub const VAULT_STATE_SEED: &[u8] = b"vault-state";
/// 24h 滚动窗口时长（秒）
pub const DAY_SECONDS: i64 = 24 * 60 * 60;

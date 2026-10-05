use anchor_lang::prelude::*;

use crate::constants;
use crate::errors::FirewallError;

/// 策略配置：由 authority 初始化，定义 Agent 支出边界
#[account]
#[derive(InitSpace)]
pub struct PolicyConfig {
    /// 可更新策略的管理员
    pub authority: Pubkey,
    /// 受约束的 AI Agent 钱包——唯一的支出发起主体
    pub agent: Pubkey,
    /// 单笔支出上限（lamports）
    pub max_per_transaction: u64,
    /// 24h 滚动支出上限（lamports）
    pub daily_limit: u64,
    /// 协议白名单：execute 指令只允许调用此列表中的程序
    #[max_len(32)]
    pub allowed_programs: Vec<Pubkey>,
    pub bump: u8,
}

/// 金库状态：滚动支出窗口记账
#[account]
#[derive(InitSpace)]
pub struct VaultState {
    /// 当前 24h 窗口起点（unix 秒）
    pub window_start: i64,
    /// 当前窗口内累计支出
    pub spent_in_window: u64,
    pub bump: u8,
}

impl VaultState {
    /// 滚动窗口推进：跨天自动重置，随后做累计上限校验。
    /// 这是链上强制层——即使客户端策略（第 1/2 层）被绕过，超支依然会被拒绝。
    pub fn advance_window(&mut self, now: i64, daily_limit: u64, amount: u64) -> Result<()> {
        if now - self.window_start >= constants::DAY_SECONDS {
            self.window_start = now;
            self.spent_in_window = 0;
        }
        let projected = self
            .spent_in_window
            .checked_add(amount)
            .ok_or(FirewallError::ArithmeticOverflow)?;
        require!(projected <= daily_limit, FirewallError::DailyLimitExceeded);
        self.spent_in_window = projected;
        Ok(())
    }
}

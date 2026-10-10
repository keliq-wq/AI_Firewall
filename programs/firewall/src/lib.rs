use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod invariants;
pub mod state;

use instructions::*;

// 程序 ID（2026-10-09 因旧私钥随公开仓库泄露而轮换；部署与升级权限属于 target/deploy/firewall-keypair.json）
declare_id!("5ZtXDT2Qs1esK3UR61une1fqRkV8KQ7tssMqWXNUFXX");

/// AI Agent 交易防火墙 — 第 3 层：链上策略强制执行金库
///
/// 安全边界在最底层的 Solana 程序：Agent 的签名密钥对金库资金零权限，
/// 所有支出必须通过本程序的链上检查（身份 → 单笔限额 → 白名单/收款方 → 24h 滚动窗口）。
/// 即使第 1/2 层客户端策略被完全绕过（如 Agent 私钥泄露后被直接调用），超限支出依然无法发生。
#[program]
pub mod firewall {
    use super::*;

    /// 初始化策略：登记 Agent 钱包、限额与协议白名单，创建金库与记账账户
    pub fn initialize(
        ctx: Context<Initialize>,
        agent: Pubkey,
        max_per_transaction: u64,
        daily_limit: u64,
        allowed_programs: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::initialize::handler(
            ctx,
            agent,
            max_per_transaction,
            daily_limit,
            allowed_programs,
        )
    }

    /// 更新策略（仅 authority，字段可选）
    pub fn update_policy(
        ctx: Context<UpdatePolicy>,
        agent: Option<Pubkey>,
        max_per_transaction: Option<u64>,
        daily_limit: Option<u64>,
        allowed_programs: Option<Vec<Pubkey>>,
    ) -> Result<()> {
        instructions::update_policy::handler(
            ctx,
            agent,
            max_per_transaction,
            daily_limit,
            allowed_programs,
        )
    }

    /// 入金（仅登记的 Agent 钱包）
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    /// 提现：金库唯一原生支出路径（链上强制全部策略检查）
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, amount)
    }

    /// 协议调用：金库向白名单协议付款（链上强制 + 目标程序白名单）
    pub fn execute(ctx: Context<Execute>, amount: u64, data: Vec<u8>) -> Result<()> {
        instructions::execute::handler(ctx, amount, data)
    }
}

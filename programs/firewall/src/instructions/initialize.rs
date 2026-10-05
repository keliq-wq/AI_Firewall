use anchor_lang::prelude::*;

use crate::constants;
use crate::state::{PolicyConfig, VaultState};

/// 初始化策略：登记 Agent 钱包、限额与协议白名单，同时创建金库与记账账户
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + PolicyConfig::INIT_SPACE,
        seeds = [constants::POLICY_SEED, authority.key().as_ref()],
        bump,
    )]
    pub policy: Account<'info, PolicyConfig>,
    #[account(
        init,
        payer = authority,
        space = 8 + VaultState::INIT_SPACE,
        seeds = [constants::VAULT_STATE_SEED, authority.key().as_ref()],
        bump,
    )]
    pub vault_state: Account<'info, VaultState>,
    /// CHECK: PDA 金库——无数据，仅持有 lamports，由程序签名支配
    #[account(mut, seeds = [constants::VAULT_SEED, authority.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<Initialize>,
    agent: Pubkey,
    max_per_transaction: u64,
    daily_limit: u64,
    allowed_programs: Vec<Pubkey>,
) -> Result<()> {
    let policy = &mut ctx.accounts.policy;
    policy.authority = ctx.accounts.authority.key();
    policy.agent = agent;
    policy.max_per_transaction = max_per_transaction;
    policy.daily_limit = daily_limit;
    policy.allowed_programs = allowed_programs;
    policy.bump = ctx.bumps.policy;

    let vault_state = &mut ctx.accounts.vault_state;
    vault_state.window_start = Clock::get()?.unix_timestamp;
    vault_state.spent_in_window = 0;
    vault_state.bump = ctx.bumps.vault_state;
    Ok(())
}

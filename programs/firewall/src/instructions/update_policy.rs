use anchor_lang::prelude::*;

use crate::constants;
use crate::errors::FirewallError;
use crate::state::PolicyConfig;

/// 更新策略：仅 authority 可调用，字段可选更新
#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [constants::POLICY_SEED, authority.key().as_ref()],
        bump = policy.bump,
    )]
    pub policy: Account<'info, PolicyConfig>,
}

pub fn handler(
    ctx: Context<UpdatePolicy>,
    agent: Option<Pubkey>,
    max_per_transaction: Option<u64>,
    daily_limit: Option<u64>,
    allowed_programs: Option<Vec<Pubkey>>,
) -> Result<()> {
    let policy = &mut ctx.accounts.policy;
    // seeds 约束已保证调用者是策略创建者；显式复查作为纵深防御
    require_keys_eq!(
        policy.authority,
        ctx.accounts.authority.key(),
        FirewallError::UnauthorizedAuthority
    );
    if let Some(agent) = agent {
        policy.agent = agent;
    }
    if let Some(max_per_transaction) = max_per_transaction {
        policy.max_per_transaction = max_per_transaction;
    }
    if let Some(daily_limit) = daily_limit {
        policy.daily_limit = daily_limit;
    }
    if let Some(allowed_programs) = allowed_programs {
        policy.allowed_programs = allowed_programs;
    }
    Ok(())
}

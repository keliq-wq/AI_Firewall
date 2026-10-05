use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::constants;
use crate::errors::FirewallError;
use crate::state::PolicyConfig;

/// 入金：仅登记的 Agent 钱包可存入金库
#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    #[account(seeds = [constants::POLICY_SEED, policy.authority.key().as_ref()], bump = policy.bump)]
    pub policy: Account<'info, PolicyConfig>,
    /// CHECK: PDA 金库（无数据，仅持有 lamports）
    #[account(mut, seeds = [constants::VAULT_SEED, policy.authority.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.depositor.key(),
        ctx.accounts.policy.agent,
        FirewallError::UnauthorizedDepositor
    );
    require!(amount > 0, FirewallError::ZeroAmount);
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.depositor.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        amount,
    )
}

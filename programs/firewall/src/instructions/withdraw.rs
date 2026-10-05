use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::constants;
use crate::errors::FirewallError;
use crate::state::{PolicyConfig, VaultState};

/// 提现：金库唯一的原生支出路径。
/// 链上强制：Agent 身份 → 单笔限额 → 收款方校验 → 24h 滚动支出 → PDA 签名转账。
/// Agent 的签名密钥对金库资金零权限——只有本程序在全部检查通过后才授权支出。
#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// 支出授权主体：必须是策略中登记的 Agent 钱包
    #[account(mut)]
    pub agent: Signer<'info>,
    #[account(seeds = [constants::POLICY_SEED, policy.authority.key().as_ref()], bump = policy.bump)]
    pub policy: Account<'info, PolicyConfig>,
    #[account(
        mut,
        seeds = [constants::VAULT_STATE_SEED, policy.authority.key().as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,
    /// CHECK: PDA 金库（程序签名支配，Agent 密钥无法直接动用）
    #[account(mut, seeds = [constants::VAULT_SEED, policy.authority.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: 收款方——必须是系统程序拥有的普通钱包（禁止转入合约地址）
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    let policy = &ctx.accounts.policy;

    // 1. 身份：只有登记的 Agent 能发起支出
    require_keys_eq!(
        ctx.accounts.agent.key(),
        policy.agent,
        FirewallError::UnauthorizedAgent
    );
    // 2. 单笔限额
    require!(amount > 0, FirewallError::ZeroAmount);
    require!(
        amount <= policy.max_per_transaction,
        FirewallError::AmountExceeded
    );
    // 3. 收款方：必须为普通钱包（System 拥有），拦截"转入恶意合约"类支出
    require!(
        ctx.accounts.destination.owner == ctx.accounts.system_program.key,
        FirewallError::DestinationNotWallet
    );
    // 4. 24h 滚动支出（链上强制，绕过客户端策略也无法超支）
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts
        .vault_state
        .advance_window(now, policy.daily_limit, amount)?;

    // 5. PDA 签名转账：金库 → 收款方
    let authority_key = policy.authority.key();
    let seeds: &[&[u8]] = &[constants::VAULT_SEED, authority_key.as_ref(), &[ctx.bumps.vault]];
    transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )
}

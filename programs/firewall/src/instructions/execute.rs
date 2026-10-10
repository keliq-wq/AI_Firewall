use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

use crate::constants;
use crate::errors::FirewallError;
use crate::invariants::{is_token_account, token_close_authority_tag, token_delegate_tag};
use crate::state::{PolicyConfig, VaultState};

/// 协议调用：金库向白名单协议付款（如 swap / 质押）。
/// 与 withdraw 相同的链上强制检查 + 目标程序白名单，data 为目标协议指令字节。
#[derive(Accounts)]
pub struct Execute<'info> {
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
    /// CHECK: PDA 金库（作为签名者参与目标协议调用）
    #[account(mut, seeds = [constants::VAULT_SEED, policy.authority.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: 目标协议程序——必须在策略白名单中且为可执行账户
    pub target_program: UncheckedAccount<'info>,
    /// CHECK: 目标协议交互账户（如兑换目标钱包）
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<Execute>, amount: u64, data: Vec<u8>) -> Result<()> {
    let policy = &ctx.accounts.policy;

    // 1. 身份：只有登记的 Agent 能发起协议调用
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
    // 3. 目标协议白名单（execute 的差异化检查）
    require!(
        policy.allowed_programs.contains(&ctx.accounts.target_program.key()),
        FirewallError::ProgramNotAllowed
    );
    require!(
        ctx.accounts.target_program.executable,
        FirewallError::ProgramNotExecutable
    );
    // 4. 24h 滚动支出
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts
        .vault_state
        .advance_window(now, policy.daily_limit, amount)?;

    // 5. CPI 前态捕获（P4 链上不变量：效果 ⊆ 信封 ⊆ 策略上限）
    let vault_lamports_before = ctx.accounts.vault.lamports();
    let dest_data_before = ctx.accounts.destination.data.borrow().to_vec();
    let dest_delegate_tag_before = if is_token_account(&ctx.accounts.destination.owner) {
        token_delegate_tag(&dest_data_before)
    } else {
        None
    };
    let dest_close_auth_before = if is_token_account(&ctx.accounts.destination.owner) {
        token_close_authority_tag(&dest_data_before)
    } else {
        None
    };

    // 6. PDA 作为签名者调用目标协议（金库 → 目标协议交互账户）
    let authority_key = policy.authority.key();
    let seeds: &[&[u8]] = &[constants::VAULT_SEED, authority_key.as_ref(), &[ctx.bumps.vault]];
    let instruction = Instruction {
        program_id: ctx.accounts.target_program.key(),
        accounts: vec![
            AccountMeta::new(ctx.accounts.vault.key(), true),
            AccountMeta::new(ctx.accounts.destination.key(), false),
        ],
        data,
    };
    invoke_signed(
        &instruction,
        &[
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.destination.to_account_info(),
            ctx.accounts.target_program.to_account_info(),
        ],
        &[seeds],
    )
    .map_err(|_| error!(FirewallError::ProgramInvokeFailed))?;

    // 7. 链上不变量断言（与客户端 INV_I1/INV_I2 同 ID 闭环）
    // I1：金库净流出 ≤ 声明金额——目标协议即使拿到金库签名也抽不走超额资金
    let vault_outflow = vault_lamports_before
        .checked_sub(ctx.accounts.vault.lamports())
        .unwrap_or(0);
    require!(
        vault_outflow <= amount,
        FirewallError::InvariantI1Violated
    );

    // I2：目标协议不得对交互账户注入代币权限突变（Approve/closeAuthority）
    if is_token_account(&ctx.accounts.destination.owner) {
        let dest_data_after = ctx.accounts.destination.data.borrow();
        let delegate_changed = token_delegate_tag(&dest_data_after) != dest_delegate_tag_before;
        let close_auth_changed =
            token_close_authority_tag(&dest_data_after) != dest_close_auth_before;
        require!(
            !delegate_changed && !close_auth_changed,
            FirewallError::InvariantI2Violated
        );
    }

    Ok(())
}

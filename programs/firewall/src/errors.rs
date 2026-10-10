use anchor_lang::prelude::*;

/// 防火墙自定义错误码
#[error_code]
pub enum FirewallError {
    #[msg("Amount exceeds per-transaction cap")]
    AmountExceeded,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("24h rolling spend limit would be exceeded")]
    DailyLimitExceeded,
    #[msg("Target program is not in the policy allowlist")]
    ProgramNotAllowed,
    #[msg("Only the registered agent may initiate spending")]
    UnauthorizedAgent,
    #[msg("Only the authority may update the policy")]
    UnauthorizedAuthority,
    #[msg("Only the registered agent may deposit")]
    UnauthorizedDepositor,
    #[msg("Withdrawal destination must be a system-owned wallet")]
    DestinationNotWallet,
    #[msg("Target program account must be executable")]
    ProgramNotExecutable,
    #[msg("Target program invocation failed")]
    ProgramInvokeFailed,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Invariant I1 violated: vault net outflow exceeds declared amount")]
    InvariantI1Violated,
    #[msg("Invariant I2 violated: token permission mutated by target program")]
    InvariantI2Violated,
}

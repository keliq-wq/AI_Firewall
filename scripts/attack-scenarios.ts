/**
 * 攻击剧本定义（可视化面板用）——与 scripts/live-attack.ts 同构但金额更小，
 * 适配低余额测试钱包（单场景最大需求 ~0.06 SOL）。
 *
 * 策略：单笔上限 0.05 SOL、24h 上限 2 SOL、容差 0.02 SOL、白名单 SystemProgram、黑名单 scam。
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { TransactionIntent } from "../src";

export const SCAM_PROGRAM = Keypair.generate().publicKey; // 每次启动随机，展示为被黑名单的协议
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export interface Scenario {
  id: string;
  icon: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  /** 构造交易与意图；无交易时为纯意图校验 */
  build: (ctx: ScenarioContext) => Promise<{ intent: TransactionIntent; tx?: VersionedTransaction }>;
}

export interface ScenarioContext {
  connection: Connection;
  wallet: PublicKey;
}

export function scenarioDefinitions(ctx: ScenarioContext): Scenario[] {
  async function buildV0(
    instructions: TransactionInstruction[],
    payer: PublicKey = ctx.wallet,
  ): Promise<VersionedTransaction> {
    const { blockhash } = await ctx.connection.getLatestBlockhash("confirmed");
    return new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message(),
    );
  }

  const recipient = Keypair.generate().publicKey;

  return [
    {
      id: "owner-phish",
      icon: "🎣",
      title: "Owner 权限钓鱼",
      titleEn: "Owner Permission Phishing",
      description:
        "诱导 Agent 签署「开通代币账户」交易，实际把金库账户 owner 静默转移给 Token 程序——Solana 特有攻击面",
      descriptionEn:
        "Tricks the Agent into signing an \"open token account\" transaction that silently reassigns the treasury account's owner to the Token program — a Solana-specific attack surface",
      build: async () => {
        const treasury = Keypair.generate();
        const rent = await ctx.connection.getMinimumBalanceForRentExemption(0);
        const tx = await buildV0([
          SystemProgram.createAccount({
            fromPubkey: ctx.wallet,
            newAccountPubkey: treasury.publicKey,
            lamports: rent,
            space: 0,
            programId: SystemProgram.programId,
          }),
          SystemProgram.assign({ accountPubkey: treasury.publicKey, programId: TOKEN_PROGRAM }),
        ]);
        return {
          intent: {
            action: "custom",
            purpose: "Open token account",
            wallet: ctx.wallet.toBase58(),
            transaction: tx,
          },
          tx,
        };
      },
    },
    {
      id: "over-limit",
      icon: "💸",
      title: "超额转账",
      titleEn: "Over-Limit Transfer",
      description: "转账 0.06 SOL（单笔上限 0.05）——第 1 层 limits 门在签名前离线拒绝",
      descriptionEn:
        "Transfers 0.06 SOL (per-transaction cap 0.05) — Layer 1 limits gate rejects it offline before signing",
      build: async () => {
        const amount = 0.06 * LAMPORTS_PER_SOL;
        const tx = await buildV0([
          SystemProgram.transfer({ fromPubkey: ctx.wallet, toPubkey: recipient, lamports: amount }),
        ]);
        return {
          intent: {
            action: "transfer",
            amount: 0.06,
            recipient: recipient.toBase58(),
            purpose: "Settle invoice",
            wallet: ctx.wallet.toBase58(),
            transaction: tx,
          },
          tx,
        };
      },
    },
    {
      id: "silent-drain",
      icon: "🕳️",
      title: "静默 Drain",
      titleEn: "Silent Drain",
      description:
        "Agent 被注入伪造意图：声明 0.002 SOL，实际交易转出 0.04——只有第 2 层模拟执行的净流出比对能发现",
      descriptionEn:
        "Injected fake intent: declares 0.002 SOL but the transaction drains 0.04 — only Layer 2 simulation's net-outflow comparison can catch it",
      build: async () => {
        const actual = 0.04 * LAMPORTS_PER_SOL;
        const tx = await buildV0([
          SystemProgram.transfer({ fromPubkey: ctx.wallet, toPubkey: recipient, lamports: actual }),
        ]);
        return {
          intent: {
            action: "transfer",
            amount: 0.002,
            recipient: recipient.toBase58(),
            purpose: "Pay for compute",
            wallet: ctx.wallet.toBase58(),
            transaction: tx,
          },
          tx,
        };
      },
    },
    {
      id: "blacklist",
      icon: "🚫",
      title: "黑名单协议",
      titleEn: "Blacklisted Program",
      description: "Agent 被诱导调用已知恶意协议——第 1 层 avoidance 门直接拒绝",
      descriptionEn:
        "The Agent is lured into calling a known-malicious program — Layer 1 avoidance gate rejects it outright",
      build: async () => {
        const tx = await buildV0([{ programId: SCAM_PROGRAM, keys: [], data: Buffer.alloc(0) }]);
        return {
          intent: {
            action: "custom",
            purpose: "Claim airdrop",
            programIds: [SCAM_PROGRAM.toBase58()],
            wallet: ctx.wallet.toBase58(),
            transaction: tx,
          },
          tx,
        };
      },
    },
    {
      id: "control",
      icon: "✅",
      title: "对照组 · 正常转账",
      titleEn: "Control · Legit Transfer",
      description: "0.005 SOL 白名单转账、限额内、目的明确——五门全过，放行",
      descriptionEn:
        "0.005 SOL allowlisted transfer, within limits, with a stated purpose — all five gates pass",
      build: async () => {
        const amount = 0.005 * LAMPORTS_PER_SOL;
        const tx = await buildV0([
          SystemProgram.transfer({ fromPubkey: ctx.wallet, toPubkey: recipient, lamports: amount }),
        ]);
        return {
          intent: {
            action: "transfer",
            amount: 0.005,
            recipient: recipient.toBase58(),
            purpose: "Pay for compute",
            wallet: ctx.wallet.toBase58(),
            transaction: tx,
          },
          tx,
        };
      },
    },
  ];
}

export const DASHBOARD_POLICY = {
  mode: "strict" as const,
  maxTransactionAmount: 0.05,
  dailyLimit: 2,
  allowedPrograms: [SystemProgram.programId.toBase58()],
  blockedPrograms: [SCAM_PROGRAM.toBase58()],
  simulationFeeTolerance: 0.02,
};

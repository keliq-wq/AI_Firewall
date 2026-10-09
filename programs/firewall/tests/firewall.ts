/**
 * 第 3 层集成测试（需要：已构建的程序 + 本地验证者）。
 * 运行：anchor test（solana-test-validator）或 Anchor 1.0 的 Surfpool。
 *
 * 注意：Anchor 1.0 客户端侧推荐 @anchor-lang/core（替代 @coral-xyz/anchor），
 * 运行时请按本机 anchor 版本模板调整导入。
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { readFileSync, existsSync } from "fs";
import idl from "../target/idl/firewall.json";

describe("firewall（第 3 层：链上策略强制金库）", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  // 程序 ID 取自 IDL 的 address 字段（单一事实来源）：
  // Windows 下 anchor build 无法生成 target/types，且 ID 会在 keypair 轮换后变化，避免硬编码
  const program = new Program(idl as any, provider);

  /**
   * 注资：优先用 FAUCET_KEYPAIR（本地验证器的 faucet 密钥，创世即有巨额余额）直接转账——
   * Windows 上 test-validator 的 requestAirdrop 有已知 bug（RPC 拨 0.0.0.0:9900 → WSAEADDRNOTAVAIL），
   * 一律返回 Internal error。未配置时回退到 requestAirdrop（devnet 场景）。
   */
  let faucet: Keypair | null = null;
  if (process.env.FAUCET_KEYPAIR && existsSync(process.env.FAUCET_KEYPAIR)) {
    faucet = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(process.env.FAUCET_KEYPAIR, "utf-8")) as number[]),
    );
  }
  async function fund(pubkey: PublicKey, lamports: number): Promise<void> {
    if (faucet) {
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: faucet.publicKey, toPubkey: pubkey, lamports }),
      );
      tx.feePayer = faucet.publicKey;
      tx.recentBlockhash = (await provider.connection.getLatestBlockhash("confirmed")).blockhash;
      tx.sign(faucet);
      const sig = await provider.connection.sendRawTransaction(tx.serialize());
      await provider.connection.confirmTransaction(sig, "confirmed");
    } else {
      const sig = await provider.connection.requestAirdrop(pubkey, lamports);
      await provider.connection.confirmTransaction(sig);
    }
  }

  const authority = Keypair.generate();
  const agent = Keypair.generate();
  const destination = Keypair.generate();

  const [policyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), authority.publicKey.toBuffer()],
    program.programId,
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), authority.publicKey.toBuffer()],
    program.programId,
  );
  const [vaultStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-state"), authority.publicKey.toBuffer()],
    program.programId,
  );

  const MAX_PER_TX = 5 * LAMPORTS_PER_SOL;
  const DAILY_LIMIT = 10 * LAMPORTS_PER_SOL;

  before(async () => {
    // 注资按需精简(devnet 水龙头限流):authority 覆盖初始化租金+费用,agent 覆盖 deposit 1 SOL+费用
    await fund(authority.publicKey, 2 * LAMPORTS_PER_SOL);
    await fund(agent.publicKey, 2 * LAMPORTS_PER_SOL);
    await program.methods
      .initialize(agent.publicKey, new anchor.BN(MAX_PER_TX), new anchor.BN(DAILY_LIMIT), [])
      .accounts({ authority: authority.publicKey })
      .signers([authority])
      .rpc();
  });

  it("deposit：Agent 入金成功，金库余额增加", async () => {
    await program.methods
      .deposit(new anchor.BN(LAMPORTS_PER_SOL))
      .accounts({ depositor: agent.publicKey })
      .signers([agent])
      .rpc();
    const balance = await provider.connection.getBalance(vaultPda);
    expect(balance).to.eq(LAMPORTS_PER_SOL);
  });

  it("withdraw：超单笔限额被链上拒绝（AmountExceeded）", async () => {
    try {
      await program.methods
        .withdraw(new anchor.BN(MAX_PER_TX + 1))
        .accounts({ agent: agent.publicKey, destination: destination.publicKey })
        .signers([agent])
        .rpc();
      expect.fail("should have thrown");
    } catch (err) {
      expect(String(err)).to.contain("AmountExceeded");
    }
  });

  it("withdraw：非登记 Agent 被拒绝（密钥对金库零权限）", async () => {
    const attacker = Keypair.generate();
    await fund(attacker.publicKey, 0.5 * LAMPORTS_PER_SOL);
    try {
      await program.methods
        .withdraw(new anchor.BN(1000))
        .accounts({ agent: attacker.publicKey, destination: destination.publicKey })
        .signers([attacker])
        .rpc();
      expect.fail("should have thrown");
    } catch (err) {
      expect(String(err)).to.contain("UnauthorizedAgent");
    }
  });

  it("withdraw：限额内成功，滚动窗口记账更新", async () => {
    await program.methods
      .withdraw(new anchor.BN(LAMPORTS_PER_SOL))
      .accounts({ agent: agent.publicKey, destination: destination.publicKey })
      .signers([agent])
      .rpc();
    const vs = await (program.account as any).vaultState.fetch(vaultStatePda);
    expect(vs.spentInWindow.toNumber()).to.eq(LAMPORTS_PER_SOL);
  });

  it("withdraw：累计超过 24h 上限被拒绝（DailyLimitExceeded）", async () => {
    // 当前窗口已支出 1 SOL；再提 9.5 SOL → 累计 10.5 > 10 上限
    try {
      await program.methods
        .withdraw(new anchor.BN(9.5 * LAMPORTS_PER_SOL))
        .accounts({ agent: agent.publicKey, destination: destination.publicKey })
        .signers([agent])
        .rpc();
      expect.fail("should have thrown");
    } catch (err) {
      expect(String(err)).to.contain("DailyLimitExceeded");
    }
  });

  it("execute：非白名单协议被拒绝（ProgramNotAllowed）", async () => {
    const rogue = Keypair.generate().publicKey;
    try {
      await program.methods
        .execute(new anchor.BN(1000), Buffer.alloc(0))
        .accounts({
          agent: agent.publicKey,
          targetProgram: rogue,
          destination: destination.publicKey,
        })
        .signers([agent])
        .rpc();
      expect.fail("should have thrown");
    } catch (err) {
      expect(String(err)).to.contain("ProgramNotAllowed");
    }
  });
});

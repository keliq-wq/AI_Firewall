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
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { Firewall } from "../target/types/firewall";

describe("firewall（第 3 层：链上策略强制金库）", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Firewall as Program<Firewall>;

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
    for (const kp of [authority, agent]) {
      const sig = await provider.connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);
    }
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
      expect(err.toString()).to.contain("AmountExceeded");
    }
  });

  it("withdraw：非登记 Agent 被拒绝（密钥对金库零权限）", async () => {
    const attacker = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(attacker.publicKey, LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);
    try {
      await program.methods
        .withdraw(new anchor.BN(1000))
        .accounts({ agent: attacker.publicKey, destination: destination.publicKey })
        .signers([attacker])
        .rpc();
      expect.fail("should have thrown");
    } catch (err) {
      expect(err.toString()).to.contain("UnauthorizedAgent");
    }
  });

  it("withdraw：限额内成功，滚动窗口记账更新", async () => {
    await program.methods
      .withdraw(new anchor.BN(LAMPORTS_PER_SOL))
      .accounts({ agent: agent.publicKey, destination: destination.publicKey })
      .signers([agent])
      .rpc();
    const vs = await program.account.vaultState.fetch(vaultStatePda);
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
      expect(err.toString()).to.contain("DailyLimitExceeded");
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
      expect(err.toString()).to.contain("ProgramNotAllowed");
    }
  });
});

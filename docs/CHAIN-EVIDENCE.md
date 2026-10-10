# Chain Evidence(链上证据)

> Layer 3 在 **Solana testnet** 上的真实执行记录。每条拦截都由验证器真实执行并 revert——
> 不是模拟,不是断言,是链上事实。链接在 explorer.solana.com 可查。

- 程序 ID:`5ZtXDT2Qs1esK3UR61une1fqRkV8KQ7tssMqWXNUFXX`(可执行 ✓)
- 集群:testnet(4.4.0-beta.0,与 devnet 同代运行时)
- 验证方式:集成测试套件 `programs/firewall/tests/firewall.ts`,6/6 通过

## 拦截证据(锚点错误码 = anchor 6000 偏移 + errors.rs 顺序)

| 用例 | 链上结果 | 交易链接 |
|---|---|---|
| 超单笔限额(0.11 > 0.1 SOL) | revert · Custom **6000** AmountExceeded | https://explorer.solana.com/tx/63BWvzTk1vnwEDt5hFncFf6pCug9MBiHE7txvo9kWaKvW8ubunAuUx7h1KDYohH7WPMbT5SgUQrpJAps29AkPEkt?cluster=testnet |
| 累计超 24h 上限(0.02+0.07 > 0.08) | revert · Custom **6002** DailyLimitExceeded | https://explorer.solana.com/tx/2SNrcf2b1wJpuHP6QK6qqnWnorxbXoyngQ4g6432wKafjiTLzWxoEUedo3tUPeBhHHPWiYy9mn8Z4xcEfjrM377Z?cluster=testnet |
| 非白名单协议 execute | revert · Custom **6003** ProgramNotAllowed | https://explorer.solana.com/tx/4fstqZwS4hg7SiZzHJSgiWmtVuoW5PEUEKweAsNdscccSWMUs91KJZ2rjNp1a6jt6Gm5b1E6KRBo9LTpkg1UJAmq?cluster=testnet |
| 非登记 Agent 提现 | revert · Custom **6004** UnauthorizedAgent | https://explorer.solana.com/tx/3W1Qk83RjnykcGsoR8haS6e7WtidgmqiuaW5nG1VGmxL328wrG7BRXuvdbHQZXgEipaqfUKMsEbxBVPkt9ykaz8S?cluster=testnet |

## 成功路径证据

| 用例 | 交易链接 |
|---|---|
| deposit 入金(0.04 SOL → PDA 金库) | https://explorer.solana.com/tx/4fjYm3X6NmDdatkpuM5JvnsLkc3hggJKbZeobZmr2hsKehFy9WrEKKswjC47gdrrhCKEnxPGToMfDumgYTb32c3g?cluster=testnet |
| withdraw 限额内提现(窗口记账更新) | https://explorer.solana.com/tx/4zkEJ6bocmCYP3qfscPWfrct6J4uHpqVtvQ1qBLttXP26VuXiYWBv4b7TcBeBGtQLugKCf2TxaVzKXbZ5AJGsJP2?cluster=testnet |

## 复现方法

```bash
git clone https://github.com/keliq-wq/AI_Firewall && cd AI_Firewall && npm install
# 任意 solana 集群(RPC_URL 参数),部署后跑集成测试:
ANCHOR_PROVIDER_URL=<rpc> ANCHOR_WALLET=~/.config/solana/id.json \
FAUCET_KEYPAIR=<已注资钱包> npx ts-mocha -t 1000000 programs/firewall/tests/firewall.ts
```

> 注:devnet 会定期重置,部署的程序会丢失;上述链接为 testnet 记录,重置周期更长。

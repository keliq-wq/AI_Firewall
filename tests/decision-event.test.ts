import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { DecisionEvent } from "../src/types";
import { Firewall } from "../src/validate";

describe("onDecision 判定事件（实时拦截日志）", () => {
  it("每次校验结束时触发一次事件，字段与结果一致", async () => {
    const events: DecisionEvent[] = [];
    const bad = Keypair.generate().publicKey.toBase58();
    const fw = new Firewall(
      { mode: "monitor", blockedAddresses: [bad] },
      { onDecision: (ev) => events.push(ev) },
    );
    const r = await fw.validateTransaction({ action: "transfer", amount: 1, recipient: bad, purpose: "x" });
    expect(r.shouldProceed).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0].verdict).toBe("deny");
    expect(events[0].concerns.some((c) => c.id === "BLOCKED_ADDRESS")).toBe(true);
    expect(events[0].summary).toBe(r.summary);
    expect(events[0].action).toBe("transfer");
    expect(events[0].time).toBeGreaterThan(0);
  });

  it("监听方回调抛错不影响判定结果", async () => {
    const fw = new Firewall(
      {},
      {
        onDecision: () => {
          throw new Error("listener boom");
        },
      },
    );
    const r = await fw.validateTransaction({
      action: "transfer",
      amount: 1,
      purpose: "x",
      recipient: Keypair.generate().publicKey.toBase58(),
      idempotencyKey: "decision-event-2",
      wallet: Keypair.generate().publicKey.toBase58(),
    });
    expect(typeof r.shouldProceed).toBe("boolean");
    expect(typeof r.summary).toBe("string");
  });
});

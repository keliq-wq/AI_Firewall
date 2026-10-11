# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js (App Router, static export) — user's choice for the landing surface (interview 2026-10-11). The npm library itself is TypeScript, zero-dependency; the demo dashboard is node + static frontend. The landing app lives in `landing/` as its own package.

## Users

- **Primary: Solana developers building AI agents.** They sign transactions from agents today and fear prompt injection, owner phishing, and key leaks. Their job: keep the agent's wallet safe while it trades, transfers, and interacts with programs.
- **Secondary: hackathon judges and event audiences** (Colosseum Shanghai pre-event). They evaluate the project in minutes and need the defense story plus real chain evidence, fast. (Confirmed 2026-10-11: the landing page serves both, judges first on the first viewport, developers as the page continues.)

## Product Purpose

A transaction firewall for AI agents on Solana: three layers of defense stand between an agent's intent and its signature, so prompt injection, owner phishing, and leaked private keys do not mean drained wallets. Success is an agent that acts freely within declared policy and gets blocked — never signed — the moment a transaction violates it.

## Positioning

Three-layer defense, only the third of which lives on-chain:

- **Layer 1** — client-side CLAW four-gate protocol (credibility / limits / avoidance / worth): offline legacy+V0 parsing, <1ms rejection.
- **Layer 2** — simulation against live chain state before signing: catches CPI owner-change and drains hidden behind a fake declared amount.
- **Layer 3** — Anchor program with PDA vault: the agent key has zero power over vault funds; withdrawals pass on-chain identity, per-tx cap, allowlist, destination, and 24h-window checks.

Meaningfully different mechanism: the agent's signing key never controls the vault, and declared intent is checked against simulated effect (envelope ⊆ effect ⊆ policy). A neighboring product cannot copy this claim because it is enforced by the on-chain program and proven by chain evidence.

## Operating Context

- Solana ecosystem: devnet (program deployed), testnet (integration tests 6/6 green), local validator for Layer 2 demos.
- Distribution: npm package `solana-agent-firewall`, GitHub `keliq-wq/AI_Firewall`, MCP server (stdio) for agent frameworks, demo dashboard (`npm run dashboard`).
- Evidence lives on-chain: explorer-verifiable rejections (error codes 6000/6002/6003/6004 on testnet, 6011 revert on devnet).

## Capabilities and Constraints

- 85 tests passing (22 files); Layer 2 verified with five live attack scenarios against real RPC; Layer 3 testnet integration suite 6/6.
- Terminology: CLAW gates, envelope/invariant engine (I1/I2/I4/C1), PDA vault, 24h rolling window.
- Constraints (stated honestly, not hidden): devnet resets; Layer 1's 24h rolling spend is in-memory on the client; Layer 2 legacy transactions have no CPI visibility (use V0); chain window uses Clock.
- Known backlog (documented in repo): legacy token drain, vault SOL outflow, price layer.

## Brand Commitments

- Name: **Solana Agent Firewall**; npm package `solana-agent-firewall`; repo `keliq-wq/AI_Firewall`.
- Bilingual project communication: README mixes EN (primary) and ZH; the landing page is EN by default with a ZH toggle.
- Open source (MIT). No invented customers, testimonials, or benchmarks — all claims must trace to tests or chain evidence.

## Evidence on Hand

- Chain: testnet explorer-verifiable on-chain rejections (AmountExceeded 6000, DailyLimitExceeded 6002, ProgramNotAllowed 6003, UnauthorizedAgent 6004); devnet revert 6011 (declared 0.01 vs CPI 0.02).
- Tests: 85 vitest cases; live-attack script covering five attack scripts (owner change, over-limit, silent drain, blacklist, control group).
- Demo: dashboard with scripted scenarios + live SSE interception log; real-wallet transfer example.
- Absences future work must not fabricate: no production users, no testimonials, no third-party audit, no benchmarks against competitors.

## Product Principles

1. Fail closed — unknown intent is blocked, never signed.
2. Proof over claims — every advertised defense is backed by a test or chain evidence.
3. Zero-config first experience — clone, install, double-click; no setup debt.
4. The signing key is never the vault — least privilege by construction.
5. Honest about coverage — gaps are documented in the README, not buried.

## Accessibility & Inclusion

- Two languages: EN (default) and ZH, switchable and remembered.
- WCAG AA contrast (≥4.5:1 body, ≥3:1 large text), keyboard navigation, visible focus, reduced-motion support.

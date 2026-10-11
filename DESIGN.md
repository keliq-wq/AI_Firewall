---
name: Solana Agent Firewall
description: The block-explorer ledger desk — ink-navy ground, ledger white ink, one stamp-gold accent, ruled tables, and a single red verdict stamp that lands once and stays.
colors:
  ink-navy: "#0b1220"
  panel: "#101a2c"
  ledger: "#f2f5f9"
  ledger-dim: "#9fb0c7"
  ledger-faint: "#8b9bb4"
  gold: "#e0a83c"
  gold-hi: "#eab84e"
  purple: "#a78bfa"
  block-red: "#e0695f"
  pass-green: "#5fbf8f"
  rule: "#2a3a52"
  rule-soft: "#1b2639"
typography:
  display:
    fontFamily: "JetBrains Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "clamp(2rem, 4.6vw, 3.4rem)"
    fontWeight: 600
    lineHeight: 1.18
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "JetBrains Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "clamp(1.45rem, 2.6vw, 2rem)"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "JetBrains Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "1.12rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "IBM Plex Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "JetBrains Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: "0.08em"
  button:
    fontFamily: "JetBrains Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "0.9rem"
    fontWeight: 600
    lineHeight: 1.6
    letterSpacing: "0.01em"
  entry:
    fontFamily: "JetBrains Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "0.78rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  micro:
    fontFamily: "JetBrains Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "0.7rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0.08em"
  stamp:
    fontFamily: "JetBrains Mono, ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "1.05rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "0.14em"
rounded:
  none: "0"
  xs: "2px"
  sm: "3px"
spacing:
  container: "1120px"
  gutter: "clamp(1.25rem, 4vw, 2.5rem)"
  section-gap: "clamp(4.5rem, 9vw, 7rem)"
  header: "60px"
components:
  button-primary:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.ink-navy}"
    typography: "{typography.button}"
    rounded: "{rounded.xs}"
    padding: "0.78rem 1.4rem"
  button-primary-hover:
    backgroundColor: "{colors.gold-hi}"
    textColor: "{colors.ink-navy}"
  button-ghost:
    textColor: "{colors.ledger}"
    typography: "{typography.button}"
    rounded: "{rounded.xs}"
    padding: "0.78rem 1.4rem"
  chip-blocked:
    textColor: "{colors.block-red}"
    typography: "{typography.micro}"
    rounded: "{rounded.xs}"
    padding: "0.12rem 0.45rem"
  chip-passed:
    textColor: "{colors.pass-green}"
    typography: "{typography.micro}"
    rounded: "{rounded.xs}"
    padding: "0.12rem 0.45rem"
  stamp:
    textColor: "{colors.block-red}"
    typography: "{typography.stamp}"
    rounded: "{rounded.sm}"
    padding: "0.28rem 0.7rem 0.22rem"
  register-card:
    backgroundColor: "{colors.panel}"
    typography: "{typography.entry}"
    rounded: "{rounded.none}"
  install-strip:
    backgroundColor: "{colors.panel}"
    typography: "{typography.entry}"
    rounded: "{rounded.none}"
    padding: "0.7rem 1rem"
---

# Design System: Solana Agent Firewall

## Overview

**Creative North Star: "The Ledger Desk"**

The landing page is the firewall's own transaction register: every claim is a ledger entry with its verification posted beside it, and the visitor is the auditor. It refuses the category default — a dark cyber page with a centered headline over equal cards — and reads top to bottom as one working desk: a live register in the first viewport, ledger rows for the defense, an evidence register of real on-chain rejections, and a posting desk at the close.

The material character is ink on navy. A deep ink-navy ground carries ledger-white ink, ruled with thin slate lines; one saturated accent, stamp gold, marks the things the visitor can act on or trust — CTAs, ledger indices, the prompt, the focus outline. The red BLOCKED stamp is the page's signature artifact: it lands once when the register enters the viewport and then stays, like a clerk stamping a posting. Every other change of state is a 200–220ms ease-out transition, and under reduced motion the stamp renders static.

Two type voices carry the desk: JetBrains Mono for entries, headings, labels, numbers, and hashes; IBM Plex Sans for body copy only. Depth comes from rulings and ink, not gradients or glows — the register card carries the system's one shadow, and the sticky header wears a 92% ink wash (the build ships a 6px backdrop blur under it; at that opacity it reads as a solid bar, and no other surface is translucent).

**Key Characteristics:**
- Ink-navy ground (#0b1220), ledger-white ink (#f2f5f9), stamp gold (#e0a83c) as the one saturated accent.
- Two voices: JetBrains Mono for entries, headings, labels, numbers, and hashes; IBM Plex Sans for body copy only.
- Depth from 1px slate rulings and ink — no gradients, no glows; exactly one shadow in the system (the register card's lift).
- Near-square geometry: radii 0–3px; surfaces are separated by rules, never by rounding.
- The red BLOCKED stamp lands once and stays — the page's one authored motion moment.
- Every claim carries its verification beside it; every signature is a real hash, truncated to first 8…last 4 characters, linked to the explorer.

## Colors

A dark ledger desk with ink-bright foregrounds: gold is the only saturated accent, red and green exist solely as verdict marks, purple solely as the agent-side link color.

### Primary
- **Stamp Gold** (#e0a83c): The only saturated accent. Fills the primary CTA, marks ledger indices (01/02/03), the `$` prompt, the active language state, the wordmark's 11px glyph, the cluster chip's text, text selection, and the focus outline. Its brighter sibling **Stamp Gold Bright** (#eab84e) appears only as the primary button's hover fill.

### Secondary
- **Agent Purple** (#a78bfa): The agent-side identity, reserved for chain-facing affordances — "See it on-chain" signature links and the 2px left rule of code strips. It never fills a surface and never runs body text.

### Tertiary (verdicts)
- **Verdict Red** (#e0695f): The BLOCKED stamp, failing gates (SIM 6011), REJECTED chips, and error codes in the evidence register. The only color allowed to stamp.
- **Clearance Green** (#5fbf8f): PASS gates, EXECUTED chips, and the PASS control code. Green means cleared, nothing else.

### Neutral
- **Ink Navy** (#0b1220): The ground; also the fill of code strips, which sit darker than the panels that hold them.
- **Panel Slate** (#101a2c): Raised surfaces — the register card, quickstart panels, the install strip, evidence table headers, the final CTA band, the active language button.
- **Ledger White** (#f2f5f9): Primary ink — headings, register values, code, the verdict reason.
- **Dim Ink** (#9fb0c7): Secondary ink — section subheads, ledger-row body copy, register data cells, the install command, the register-head label.
- **Faint Ink** (#8b9bb4): Tertiary ink — table headers, key labels, signature metadata, evidence notes, the footer.
- **Slate Rule** (#2a3a52): Structural rulings — outer frames of cards and tables, ledger-row separators, dashed verdict dividers, ghost-button and toggle borders, the scrollbar thumb.
- **Soft Rule** (#1b2639): Interior rulings — section separators, the header's bottom border, table cell rules, the register-head divider, install-strip and code frames.

### Named Rules
**The One Accent Rule.** Stamp gold is the only saturated accent on the desk. Its rarity is the point: if everything glows gold, nothing is trusted.
**The Ink-Only Rule.** Verdict red and clearance green appear only as verdict marks (stamp, gates, chips, error codes); agent purple only on chain-facing links and the code strip's left rule. None of the three ever fills a surface or headlines a section.
**The Legible Ink Rule.** Secondary ink never drops below WCAG AA on the navy ground. Faint ink is #8b9bb4 — raised from #64748b in the finish review for exactly this reason. A dimmer ink is a defect, not a mood.

## Typography

**Display Font:** JetBrains Mono (ui-monospace, Cascadia Mono, Consolas, SF Mono, monospace; CJK falls back to PingFang SC / Microsoft YaHei)
**Body Font:** IBM Plex Sans (system-ui, -apple-system, Segoe UI, PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif)
**Label/Mono Font:** JetBrains Mono — the same stack as display; labels are mono by definition here.

**Character:** A working desk, not a gallery. The mono voice speaks in entries, numbers, and labels; the sans voice narrates. Self-hosted via @fontsource at weights 400/500/600/700 for both families.

### Hierarchy
- **Display** (600, clamp(2rem, 4.6vw, 3.4rem), 1.18, −0.02em): The hero headline only; capped at 16ch, text-wrap balance.
- **Headline** (600, clamp(1.45rem, 2.6vw, 2rem), 1.25, −0.02em): Section heads. The final CTA headline enlarges to clamp(1.6rem, 3.4vw, 2.4rem).
- **Title** (600, 0.98–1.12rem): Ledger-row titles (1.12rem), quickstart step and panel titles (0.98–1rem).
- **Body** (400, 1rem base, 1.6): Running prose; supporting copy runs 0.92–1.02rem at 52–68ch maximum width.
- **Label** (500, 0.75rem, 0.08em, uppercase): Nav links, table headers (0.7rem, 0.12em), footer. The wordmark is 0.85rem at 0.02em.
- **Entry** (400, 0.72–0.82rem): Register data cells (0.78rem), evidence rows (0.8rem), key/value lines, signatures, evidence notes.
- **Stamp** (700, 1.05rem, 0.14em, uppercase, 1.15): The verdict stamp only.
- **Micro** (400, 0.68–0.7rem, 0.08–0.1em, uppercase): Status chips and the cluster chip.

ZH copy keeps the same two voices with CJK fallbacks; headings switch tracking to 0.01em and hero sub-copy loosens line-height to 1.85 (`html[lang="zh"]`).

### Named Rules
**The Two Voices Rule.** Everything that is an entry, a label, a number, a hash, or a heading speaks JetBrains Mono; only running prose speaks IBM Plex Sans. A heading in a sans face, or a paragraph in mono, breaks the desk.

## Layout

One centered container, a ledger column rhythm, and rules instead of gaps.

- **Container:** 1120px maximum, inline padding clamp(1.25rem, 4vw, 2.5rem).
- **Section rhythm:** every section opens with a 1px soft rule across the container; vertical padding per section is half the section gap — clamp(4.5rem, 9vw, 7rem) — so the full gap lands between section contents.
- **Header:** sticky, 60px bar, border-bottom 1px soft rule; `scroll-padding-top: 76px` so anchors clear it.
- **Hero grid:** `minmax(0, 1.05fr) minmax(0, 1fr)`, center-aligned, gap clamp(2.5rem, 6vw, 5rem); the copy column is always slightly wider than the register. Stacks to one column (copy first) at 900px.
- **Register table:** fixed layout — four gate columns at 18% each, the verdict column at 28%.
- **Ledger row:** four-track grid `3.5rem | minmax(0, 1.6fr) | minmax(0, 2.1fr) | minmax(0, 1.3fr)` with gap clamp(1rem, 3vw, 2.5rem) and padding-block clamp(1.6rem, 3.5vw, 2.4rem). The index, main, and evidence columns fill the first three tracks; the reserved 1.3fr outer track keeps the evidence column off the container edge. Below 860px the row collapses to `2.5rem 1fr` and the evidence column drops to a full-width second row under a dashed top rule.
- **Quickstart:** `1fr 1fr` grid (steps left, panels right) collapsing to one column at 900px; steps use a 3.5rem index track.
- **Evidence table:** scrolls horizontally inside the container on narrow screens.
- **Breakpoints:** 560px (drop the evidence cluster column, PASS labels, and split the signature cell), 720px (nav links collapse to GitHub + language toggle), 860px (ledger row collapse), 900px (hero and quickstart stack).

## Elevation & Depth

This is a flat desk. Depth is conveyed by rulings and ink contrast, not by light: surfaces separate from the ground with 1px rules, and the ground itself is a single ink-navy field. There is no glow and no gradient anywhere; the hero's faint vertical ruling texture (1px ledger ink at 2.5% opacity on a 55px column rhythm) is a ruling, not a gradient.

### Shadow Vocabulary
- **Register Lift** (`box-shadow: 0 18px 40px -28px rgba(0, 0, 0, 0.8)`): The system's one shadow — a soft, wide under-lift that raises the hero register card slightly off the ground. Applied nowhere else.
- **Header Wash** (`background: color-mix(in srgb, var(--ink-navy) 92%, transparent)` + `backdrop-filter: blur(6px)`): The sticky header's only concession to translucency; at 92% ink it reads as a solid bar. This is the built form of the brief's "no glass" line — the blur exists, but no content ever shows through.
- **Stamp Ink:** the verdict stamp wears a fractal-noise turbulence mask (baseFrequency 0.55, 2 octaves) at 86% opacity — dry ink on paper, no shadow.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest; depth comes from rulings and ink. The register card's lift is the only shadow in the system — new surfaces inherit rulings, not shadows.
**The No Glow Rule.** No gradients, no glows, no glassy surfaces. The single exception is the sticky header's 92% ink wash (with its 6px backdrop blur); anywhere else, translucency is off the desk.

## Shapes

Near-square, ruled, and ink-stamped.

- **Corners:** 0px on surfaces, the scrollbar, and frames; 2px on buttons, chips, and the focus outline; 3px on the verdict stamp. Nothing anywhere rounds further.
- **Rules:** 1px solid is the universal separator (outer frames, cell borders, section lines). Emphasis thickens the border rather than the radius — 2px left rules on ledger evidence columns (slate) and code strips (purple), a 2.5px frame on the stamp. Dashed 1px rules mark moments of judgment: the verdict divider inside the register and the evidence collapse on mobile.
- **Icons:** hand-drawn inline SVG, 1.5px stroke, currentColor, 12–16px rendered from a 16-unit viewBox (arrow-up-right, check, x; the GitHub mark is the one filled glyph). No icon fonts, no stroke weights above 1.5px.

### Named Rules
**The Ruled Corner Rule.** Corners stay 0–3px. A surface is separated by a rule, never by rounding; if a corner needs emphasis, the border thickens (2px, 2.5px) rather than the radius growing.

## Components

### Buttons
- **Shape:** 2px radius, 1px border reserved for the ghost variant.
- **Primary:** gold fill, ink-navy text, mono 600 at 0.9rem, padding 0.78rem 1.4rem, inline 15px GitHub glyph. Hover: gold-hi fill; 220ms ease-out.
- **Ghost:** transparent, ledger text, 1px slate frame. Hover: gold frame and gold text.
- **Focus:** the global gold 2px outline at 2px offset covers every interactive element.

### Chips
- 1px currentColor frame, 2px radius, mono 0.68rem, 0.1em tracking, uppercase, padding 0.12rem 0.45rem. Blocked: verdict red, reading REJECTED (ZH: 已拒绝). Passed: clearance green, reading EXECUTED (ZH: 已执行).
- The register's cluster chip is a location label, not a verdict: gold text on a slate frame (0.7rem, 0.08em, uppercase).

### The Verdict Stamp (signature component)
- 2.5px currentColor frame, 3px radius, mono 700 at 1.05rem, 0.14em tracking, uppercase, rotated −6deg, opacity 0.86, ink texture via turbulence mask.
- Motion: lands once when the register crosses 40% visibility — 460ms cubic-bezier(0.16, 1, 0.3, 1) from scale 2.2 / −14deg through a 0.96 settle at 55% to rest at scale 1 / −6deg — and then stays forever. `prefers-reduced-motion` renders the stamp static at rest.

### Register Card
- Panel slate fill, 1px slate frame, the Register Lift shadow. Head row: 0.72rem dim-ink label ("Live register · program 5ZtXDT2Q…") and the gold cluster chip, padding 0.65rem 0.9rem, soft-rule divider.
- Gate table: four columns of green check + PASS, one red X + error code (6011), each gate 18% wide, verdict column 28%. Headers 0.7rem faint ink at 0.12em tracking.
- Body: key/value lines (0.78rem; faint keys, white values; the declared amount dimmed against the actual effect).
- Verdict block: dashed rule divider, the stamp spanning both grid rows, the reason in white 0.8rem, and a signature line in 0.72rem faint ink carrying the truncated hash and a purple explorer link with arrow-up-right.

### Ledger Row
- Gold mono index (01–03, 0.85rem, 0.1em), mono title + dim role line, sans body copy at 0.97rem, and a mono evidence column (0.78rem, faint ink, 2px left slate rule). One 1px slate rule between rows; the block opens with a 1px slate rule.

### Evidence Table
- 1px slate outer frame; panel slate header band; 0.8rem mono data. Error codes (6000/6002/6003/6004/6011) in verdict red, the PASS control in green. Each row ends in a REJECTED/EXECUTED chip plus the truncated signature as a purple link with arrow-up-right. A faint mono note line (0.75rem) closes the block.

### Install Strip
- Panel slate fill, 1px soft-rule frame, gold `$` prompt beside the dim mono command (0.82rem), padding 0.7rem 1rem, width fit to content.

### Code Strip
- Ink-navy fill — darker than the panel around it — with a 1px soft-rule frame and a 2px purple left rule; mono 0.78rem at 1.7 line-height, pre-wrap, scrolls horizontally.

### Language Toggle
- 1px slate frame around two mono 0.75rem buttons (padding 0.35rem 0.7rem). Active language: panel slate fill + gold text. 200ms ease-out state transitions. The choice persists in localStorage and the route carries the locale (`/[locale]`).

### Navigation
- Wordmark: mono 0.85rem at 500, 0.02em tracking, an 11px gold square glyph, reading `solana-agent-firewall`. Links: mono 0.75rem, 0.08em tracking, uppercase, dim ink at rest, white on hover; the GitHub link carries a 14px filled glyph and an arrow-up-right for external routes. Below 720px only GitHub and the language toggle remain.

### Footer
- Mono 0.75rem faint ink: license and audience left, GitHub/npm links right (hover: gold), 1rem top/bottom padding, no ruling above.

### Motion (applies across components)
**The One Motion Moment Rule.** The stamp's landing is the only authored animation on the page. Every other change of state is a 200–220ms ease-out transition (chips and toggle 200ms, buttons 220ms). Anything beyond that is noise on the desk. Reduced motion: the stamp is static, smooth scroll disabled.

## Do's and Don'ts

### Do:
- **Do** keep gold as the only saturated accent — CTAs, ledger indices, the `$` prompt, the active toggle, selection, and the focus outline (2px, offset 2px).
- **Do** run entries, headings, labels, numbers, and hashes in JetBrains Mono; body copy in IBM Plex Sans.
- **Do** truncate real signatures to first 8…last 4 characters and link them to the explorer.
- **Do** keep secondary ink at or above faint ink (#8b9bb4) — the AA floor the finish review fixed.
- **Do** keep corners at 0–3px and separate every surface with a 1px slate ruling.
- **Do** keep transitions at 200–220ms ease-out; let the stamp be the only authored animation, and render it static under `prefers-reduced-motion`.
- **Do** pair every claim with its verification — a test count, an error code, or a transaction — posted beside it.

### Don't:
- **Don't** introduce gradients, glows, or glass beyond the sticky header's 92% ink wash.
- **Don't** add shadows beyond the register card's lift (`0 18px 40px -28px rgba(0, 0, 0, 0.8)`).
- **Don't** add accent colors — gold, purple, verdict red, clearance green are the complete set. Red and green appear only as verdicts; purple only on chain-facing links.
- **Don't** set headings in a sans face or running prose in mono.
- **Don't** round corners past 3px, and don't let a radius do a border's job.
- **Don't** invent verification: every signature, code, and count must trace to a real transaction or a test.

# 0080 — Intent guarantees and the intent family

Status: **in execution.** §2–§5 (the mechanism) landed with commit c3f0a0dee; the bundle family (§6),
the dedicated test coverage (§7) and this document's index updates are appended as R-02.P01 tasks
T-139..T-142. The design was settled with the person on 2026-10-04/05 (the clean-room assessment
conversation) and approved as an implementation plan before any code was written.

The problem: an intent (a named policy bundle, 0079) is *declared* but nothing *carries* it. The
person's planning input (`plan -p`), the project brief, the core duty partials and the mode text all
land in the same composed prompt, and any pair can contradict — the shipped cleanroom bundle proved
it: its pack's `## phase duties` reached no session that runs (decompose-only wiring under its own
`subtask: ondemand` stamp), three of five phases planned against migration-framed core partials, the
pack's repair discipline had no consumer, and the audit gate's `verdict.md` protocol was never
anchored. A clean-room migration additionally needs the two-room model: a specification room that
reads the source-to-be-migrated (the spec-read phase), a wall, and clean rooms downstream — the
boundary is phase-scoped, not run-global. The fix is not more prose; it is mechanism:

> **The state of the intent is guaranteed on the final composed prompt — by declared precedence,
> by machine-checked asserts at the single render exit, and by an AI verifier at every planning
> step — and the intent family makes the trade-offs explicit.**

## §1 Vocabulary

- **charter** — the pack's `## guarantees` / `### verify-plan` text: the compact statement of the
  intent's principles the verifier judges against.
- **precedence block** — the `### precedence` text, rendered into planning/execution prompts as an
  explicit authority order ("the charter wins; a conflict is surfaced, never silently followed").
- **assert** — one machine-checked line over a composed prompt (must / must-not, optionally
  phase-qualified).
- **render gate** — the assert evaluation inside `renderPrompt` (src/prompt.ts), the single render
  exit; a violation throws `PromptGuaranteeError`, mapped at the run boundary to exit 2.
- **plan verifier** — the one-shot bare session (src/prompt-verify.ts) judging a composed planning
  prompt against the charter; reply `Consistent: yes|no — <spans>`; fail-closed.

## §2 The guarantees section (landed)

One optional intent-pack section `## guarantees`, subsections `### precedence`, `### asserts`,
`### verify-plan` (intent/types.ts `INTENT_SECTIONS`, intent/load.ts `SECTION_HEADINGS`). The assert
line grammar (src/intent/guarantees.ts, pure):

```
<template>[(<phase>)]: must "literal"[, "literal"]…
<template>[(<phase>)]: must-not "literal"[, "literal"]…
```

The phase qualifier matches the render ctx's `phase` var (a builtin's preset letter or a custom
type's id). Literals are pinned to the intent's own text on purpose — editing the text without the
asserts is the drift the gate catches. `guaranteesProblem` validates the grammar at preflight
(exit 1). A pack without the section is the zero-intent floor: no checks, no blocks, byte-identical
renders. The gate's claim is scoped (R9): it sees `renderPrompt` output only — driver-authored
feedback appended at call sites, steer placeholder fills and probe sends are out of scope.

## §3 The render gate (landed)

`renderPrompt` evaluates the active pack's asserts against every composed prompt after rendering;
`PromptGuaranteeError` propagates to `runAll`'s drive catch (src/loop.ts) → ⏸ log naming the
violation + exit 2. Precedence: `intentText(facts, "guarantees", "precedence", {})` in `baseCtx`
(execution family) and in `renderPhasePlan`/`renderPhaseAppend`; the templates render it behind
`{{#if precedence}}` (phase-plan, phase-append, whole, subtask, wrapup, and fanout's cold branch —
which now also carries the mode note it never had: a cold lane stream started clean-room sessions
with no boundary text at all).

## §4 The duty channel (landed)

`planDutyText(facts, entry)` (src/prompt-plan.ts): the custom type's own `## plan duties`, then —
the new tier — the pack's `### <dutiesRef>` under `## phase duties`, then the core
`plan-duties-<key>` partial. loop-plan delegates. Only builtins ever reach the pack tier (custom
files always carry plan duties). This is what lets a bundle re-voice design/implement/test duties
without touching core partials, and it revives the pack's phase-duties half for the surfaces that
run under `subtask: ondemand`.

## §5 The plan verifier (landed)

src/prompt-verify.ts — the classifier's oneShot sibling (classify.ts's oneShot now takes a title):
fresh titled session, bare prompt (tools denied), 120 s timeout, strict parser (last
`Consistent:` line wins). Model: the registry's `classifier` list entry (`classifierEntry`); no
routing / no usable entry / dryrun → skip with an ℹ log (the mechanical layers still hold); a pack
without `verify-plan` → inactive (nothing logged, floor preserved). **Fail-closed** (the person's
ruling): error/timeout/unparsable → one retry → block exit 2 quoting the last reply. Kill switch
`OPENCODE_AUTO_PLAN_VERIFY=off` (switches.ts, default on). Runs in `planPhase` and `appendPlan`
before the planning session; each run appends `verifyAuditEntry` to the round's
`docs/R-NN/prompt-audit.md` (written before the session so the step's commit carries it — wall
documentation). Template `plan-verify.md` is a tier-1 protocol surface (`Consistent:`,
`{{charter}}`, `{{prompt}}` markers). The verifier's token usage is not booked to a stats bucket in
v1 (one cheap call per planning step; noted here as the accepted exception).

## §6 The intent family (the appended tasks)

One axis: *how much may the implementation derive from the original* —

| bundle | phases | posture |
| --- | --- | --- |
| `cleanroom` | spec-read,design,implement,test,audit | nothing: spec-first, wall enforced, independence audited |
| `faithful` | analysis,design,implement,test,acceptance | behavior **and** structure: the reference is the primary input, parity is the bar |
| `faithful-lean` | analysis,design,implement,test,acceptance | external behavior exactly, internals free, legacy debt deliberately shed |

T-139 (cleanroom rework): the two-room model — mode exec rewritten so the spec-read phase's
sessions are the specification team (read the source named in the brief, extraction hygiene:
behavior-only notes, no private names/structures/translated code) and every later session carries
the boundary; spec-read's plan duties become extraction duties; audit's plan duties name
`verdict.md` and the verbatim `Result: PASS` / `Result: FAIL <reason>` protocol, declare
`Phase-artifacts: audit.md verdict.md`, and add spec hygiene (implementation leakage in the spec
notes) as an audit dimension; the pack gains `## guarantees` (precedence: the charter and the
spec-notes outrank the planning input and the brief; asserts pinning the wiring — e.g.
`phase-plan(audit): must "verdict.md", "Result: PASS"`, `whole: must "Clean-room boundary"`,
`phase-plan(implement): must-not "code migration"`; the verify-plan charter).

T-140 (faithful / faithful-lean): manifest + pack + mode each (no custom types; builtin skeleton;
stamp `subtask: ondemand`); phaseDuties a/d/m/t/v in the intent's voice; acceptance result-line
semantics (faithful: PASS = parity with the reference's observed behavior; lean: external parity +
debt-removal accounting); governance repair; guarantees mirroring. Registration: the
`templates/bundles/<name>/` directory + the `builtinBundles()` table entry in src/bundle.ts, in the
same change (AGENTS.md rule).

## §7 Tests (the appended tasks)

T-141: the self-ratchet (render each bundle's plan/execution prompts through the bundle's own
asserts — the mechanism that would have caught every shipped gap); guarantees parse valid/invalid
(intent.test.ts); gate must/must-not/phase-qualified + the zero-intent floor (prompt-exec); the
precedence three-state (built-in / project override / absent); `planDutyText` tiers
(prompt-phase); the agent-fake verifier cases (contradictory planning input → `Consistent: no` →
exit-2 block + the audit record; consistent input proceeds; the repair append carries the pack's
repair text); the plan-verify marker guard (prompt-template). The landed mechanism's collateral
test updates (switches/intent/template/import-direction/golden) went with commit c3f0a0dee.

T-142 (docs): this document's siblings — the AGENTS.md navigation lines (amend the intent-bundles
line, add the guarantees/verifier line), docs/structure.md rows (src/intent/guarantees.ts,
src/prompt-verify.ts, the bundles row), and the final full `bun typecheck` + `bun test` pass.

## §8 Explicitly not

- No mechanical file-access sandbox: the clean-room boundary is prompt + asserts + verifier; where
  the source-to-be-migrated lives (inside or outside the target worktree) remains the person's
  layout decision — state it in the brief.
- No multi-active packs: the degenerate one-active selection (F8) stands; the "family" is a
  registry of alternatives, one chosen per project.
- The gate does not check driver-authored feedback strings, steer placeholder fills, or probe
  sends (R9's scoped claim).
- No shell-package changes: the built-in bundle table needs none (`init --intent` resolves through
  `resolveIntentBundle` unchanged).
- The verifier does not rewrite the person's input — it blocks and quotes; rewriting human words
  is the no-silent-deviation rule applied to the driver itself.

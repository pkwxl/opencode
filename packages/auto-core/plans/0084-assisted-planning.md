# 0084 — Assisted planning preparation: `plan --round / --phase`, the AGENTS.md guidance states, and the pre-round project analysis

The working sessions' rulings, kept verbatim as the design record. Status: landed 2026-10-07.

## The problem

Preparation was the person's alone. A fresh target's first `plan` established R-01
mechanically and stopped at the round-start gate, where the person faced an empty
`round.md` stub with no assistance; a phase's planning input existed only as
`--scaffold`'s printed template; and nothing anywhere fixed the engagement's goals
before the first round opened — the phase list was whatever config `phases` said at
`init`, decided before anyone had analyzed the project. Meanwhile the one surface
every agent reads — the AGENTS.md block — carried only the execution constitution,
silent on all of it.

## The rulings

- **D1 — the delivery surface is the AGENTS.md block.** The "assisted interactive
  mode" is not a driver-driven session (that variant was designed and dropped): the
  person works with their own coding agent, interactive or not, and the block is the
  one prompt surface both that agent and a driver-driven session read. `renderAgentsBlock`
  gains an optional `guidance` state (src/agents-block.ts): the five constitution
  paragraphs unchanged, then — only when a preparation stop asks — the `DRIVER_PRIMER`
  (the tool's working model in one paragraph: units, lifecycle, phase vocabulary,
  gates' marks, where a round's phase list comes from), the `ASSIST_RULE` (enumerate
  the missing information and which document each piece belongs to; ask, offer
  options with consequences and a recommendation; undecided points stay `Fork:` lines,
  never invented answers; settled results go into the named document), and the
  state's own text. Execution renders byte-identically to before (no `guidance` =
  the frozen constitution block, the ratchet's floor); the state flips only at
  command boundaries — plan's preparation stops set it, run's preflight and fix
  render it away — and AGENTS.md is gitignored, so the flips leave no git noise.
- **D2 — three guidance states beside execution.** `analysis` (the first-run step:
  read the tool's own surfaces — config, the pack's scaffold, custom types — then
  the project's material; fill `docs/analysis.md` per its sections; the depth bar:
  a thorough analysis determines the key work of the rounds that follow), `round`
  (the round-start gate's document: `round.md`'s sections, their sources — the
  brief, the roadmap line, the previous round's report and `## Close`; the m-mode
  caveat that establishment wrote no stub), `phase` (the next phase to plan's
  `plan-input.md`, the pack's scaffold riding in, anchored in the round brief, the
  roadmap and the previous handover).
- **D3 — the documents are the interface.** No new persistence channel: the person
  and their agent write `docs/analysis.md`, `docs/R-NN/round.md` and
  `docs/R-NN/P<nn>-<type>/plan-input.md` directly — the very files the existing
  gates read (`Clarified: yes` / the round-start gate / the planning session's own
  input read). `--phase` maps to `plan-input.md`; a `phase.md` charter document was
  considered and rejected as a duplicate of the input's seat.
- **D4 — the pre-round analysis.** Practice ruled that a solid first analysis
  determines the next few rounds' key work, so it runs before R-01 exists and its
  roadmap decides the phase structure: `docs/analysis.md` (`analysisDoc` role,
  process/P1, no terminator — a preparation document like the round brief), stubbed
  by the driver at the first plan, holding `## Analysis`, `## Goals`, `Fork:` lines
  (the survey grammar), a `## Project brief` proposal (installed verbatim on
  release through `installBriefProposal`, the survey release's D15.2 mechanism
  generalized in brief.ts) and `## Roadmap` — one line per planned round,
  `- R-NN <phases> — <goal>` (em dash or `--`), the phases value the exact
  `amend --phases` argument for that round. Release = the person's whole-line
  `Clarified: yes` (required unconditionally: it approves the goals, the roadmap
  and the brief, not only forks). The gates check grammar only (sections hold
  content, roadmap lines parse and resolve); depth is the guidance's and the
  person's to judge — a machine check cannot see thoroughness, and pretending to
  would cheapen it.
- **D5 — the prelude's analysis rows (0a–0d), before row 1.** No rounds and the
  switch on: 0a the stub + the analysis guidance (stop 0, the recipe lines);
  0b grammar problems hold the release (exit 2, the problems named); 0c an
  unreleased analysis awaits the person (exit 2, the survey-gate recipe shape);
  0d the release installs the brief and establishes R-01 like row 1. Input,
  `--new-task` and `--export`/`--adopt` are refused before any write on the
  analysis rows (D5-of-0053's shape); `--round` routes into the analysis (it is
  the round-zero preparation); `--phase` is refused (no phase exists yet).
- **D6 — the roadmap is advice the person may diverge from.** Every establish stop
  (row 1, row 2, the release) names the exact `amend --phases` command when the
  roadmap's value for the round differs from config — advisory, never blocking:
  the person amends before committing the uncommitted setup (the re-run establishes
  under the new value) or diverges on purpose. The config stays constitutional;
  the driver never amends it. Nothing about the drift machinery changes: per-round
  phase lists remain the person's `amend` + establish channel.
- **D7 — `plan --round` / `--phase` (rows 14–15).** Mutually exclusive boolean
  flags, plan's alone (every other command refuses them with a pointer), exclusive
  with every other route option, refused under an open step record (the
  `--new-task` reasoning: the loop's return would silently ignore the flag).
  `--round` on an established round re-renders the round guidance and stops with
  the brief's state (stub → fill with your agent; filled → revise or continue);
  in m mode it writes the stub establishment never wrote (round-close needs the
  file). `--phase` targets the phase an input would plan into (row 6's `planTarget`
  selection, the listed refusal mirroring row 6's), stops pointing at that phase's
  `plan-input.md` with the pack's scaffold in the guidance; the execute routes
  point at `--append`. Neither writes anything but the guidance block (and the
  m-mode stub): no session runs, no document is written by the driver.
- **D8 — the switch.** `OPENCODE_AUTO_ANALYSIS` (default on, src/switches.ts): off
  restores the direct first-plan establishment of 0053 — the escape hatch for
  scripted flows and the person who already knows the round they want. It only
  removes the analysis route, never adds anything.
- **D9 — the establish stop carries the guidance pointer.** Every G1 stop appends
  one line naming the AGENTS.md preparation guidance, so the feature is
  discoverable from the stop itself (the pinned G1 lines otherwise unchanged).

## Changes by file

**Core:** src/agents-block.ts (Guidance type, DRIVER_PRIMER, ASSIST_RULE, the three
state texts, GUIDANCE record, guidance-aware renderAgentsBlock/ensurePointer);
src/analysis.ts (new, pure: the stub, the section checks, the roadmap round-line
grammar, analysisProblems); src/plan.ts (rows 0a–0d before row 1 with the D5-shaped
refusals, rows 14–15 after the open-step guard, the establish refactor over opts
with the roadmap advice and the guidance pointer line); src/brief.ts
(installBriefProposal, the shared approved-proposal install with the commit seam
injected); src/loop-phase.ts (installApprovedBrief delegates); src/docpaths.ts
(ANALYSIS_DOC); src/document/roles.ts + types.ts (the analysisDoc role); src/round-brief.ts
(stripComments exported for the stub's section checks); src/switches.ts (the analysis
switch, default on).

**Shell (packages/auto/src/index.ts):** `round`/`phase` in BOOLEAN_FLAGS; the
other-command refusals; the plan-block mutual exclusions (each other, input,
`--append`, `--new-task`, `--force-close`, `--export`/`--adopt`, and added to
`--scaffold`'s); `round`/`phase`/`intent` threaded into planPrelude; the usage
line and its explanation paragraph; init's fresh-project closing pointer names
the assisted analysis.

**Tests:** test/analysis.test.ts (new: the stub, the released fixture, the line
grammar both separators, the invalid-value and roadmapless problems, the missing
section); test/plan.test.ts (the analysis describe — 0a/0b/0c/0d with the advice
line and the idempotent re-run, the off-switch, the analysis rows' refusals,
`--round` under the analysis — and the flags describe — backstops, the stub/filled
m-mode `--round`, `--phase` naming the phase and input path with the scaffold,
the m-mode and execute-route refusals; the direct-establishment rows run with the
switch off via the file's beforeAll); test/constitution-ratchet.test.ts (the
guidance rendering pinned beside the byte-identical floor);
test/document-roles.test.ts (analysisDoc classification, the task/phase-level
analysis.md staying artifact); test/switches.test.ts, test/isolate.test.ts,
test/survey-gate.test.ts, test/import-direction.test.ts (the expected churn: the
switch's rows, the establishment env, the install's from-source subject, analysis
classified pipeline).

## Explicitly not

No driver-driven assisted session, no second agent contract, no new session
templates — the AGENTS.md block is the whole delivery surface. No `phase.md`
document. No change to the config-phases/drift/establish machinery (the roadmap
steers through `amend --phases`, the existing channel). The block's execution
state carries no per-phase content — execution information remains the session
prompts' job. No mechanical depth check on the roadmap. No dedicated re-analysis
trigger: deleting `docs/analysis.md` re-opens the flow. The manual-driver prompt
suite (`prompts/`) is untouched.

## Verification

`bun typecheck`; `bun test` — the full suite, with test/analysis.test.ts,
test/plan.test.ts (both new describes), test/constitution-ratchet.test.ts,
test/document-roles.test.ts, test/switches.test.ts, test/survey-gate.test.ts,
test/isolate.test.ts and test/import-direction.test.ts named above.

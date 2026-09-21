# 0047 Unified unit layout (rounds / phases / tasks / subtasks)

Root plan milestone M3 (`plans/AUTO_NEXT_REFACTOR_PLAN.md`, "M3 phase loop +
unified unit layout", root decision D14). Design only; nothing here is
implemented yet. Rulings in §6 were made by the user on 2026-09-21; the rest is
the design M3.1–M3.8 implement.

## 1. Problem

The three process-document levels are asymmetric:

- **Phases** are fixed letters (`admtvk`). One phase's material is split across
  three places: the PLAN.md archive at `docs/R-NN/<l>-<slug>/PLAN.md`, the
  handover at `docs/R-NN/handovers/<l>-<slug>.md`, and free artifacts at
  `docs/R-NN/phase-docs/<l>-<slug>/`. A phase type cannot occur twice in a
  round, and the order is hard-wired. Completion is a line in the ledger
  `phases.md`. Only the k phase has a standard artifact name.
- **Tasks** live entirely in one PLAN.md: title, description, status suffix,
  runtime fields, plus a copy of the subtask checklist. The root PLAN.md is a
  symlink into the round; it is archived and reset at every phase handover.
  `docs/T-NNN/` holds only derived documents.
- **Subtasks** already have the target shape: a local number (`S01`), scope in
  `S01/todo.md`, progress as which of `todo.md` / `done.md` exists (the driver
  renames, inside the unit commit). The only redundancy is the checklist living
  in both `subtasks.md` and the PLAN.md body, which `syncSubtaskTicks` has to
  reconcile.
- **Dependencies** exist at no level. 0046 proposed PLAN.md fields for them,
  keeping PLAN.md as the carrier.

Goal: generalize the subtask shape to phases and tasks, and give all levels one
dependency grammar and standard artifact names per phase type.

Constraints inherited from 0036 §7 (why the five-level directory scheme was
rejected): task paths are permanent, so **tasks are never nested under rounds
or phases**. Ids are already in immutable media (`Auto-Task:` trailers, git
history), so id shapes do not change. The fallback ladder must not grow. The
third constraint is satisfied more strongly than required: §6 R3 drops
compatibility altogether.

## 2. Fact baseline (auto-next at `4c7f95440`)

- **F1 — phases are a hard-coded enum.**
  - `src/phases.ts:22-34`: `Phase = "a"|"d"|"m"|"t"|"v"|"k"`, `PHASE_ORDER`, `PHASE_NAMES`; slugs at `:102-109`.
  - `parsePhases` (`:43-54`) requires an increasing subsequence containing `m`.
  - `routePhase` (`:187-209`) picks the first declared letter absent from the ledger.
  - The k phase is special-cased: `extractKnowledge` (`src/loop-phase.ts:416-450`) writes `docs/R-NN/migration-kb.md`.
- **F2 — round layout.**
  - `docs/R-NN/` holds `PLAN.md` (the root PLAN.md symlinks here, `establishRound` `src/phases.ts:291-322`), `AGENTS.md.bak`, `phases.md` (ledger, `LEDGER_ENTRY` `:65`, writer `:174`), `<l>-<slug>/PLAN.md` (archive, `phaseArchive` `:114`), `handovers/<l>-<slug>.md` (`:131`), `phase-docs/<l>-<slug>/` (`:146`), `acceptance.md` (`:160`), `migration-kb.md` / `prior-kb.md` / `temp-kb.md` (`src/docpaths.ts:65-85`).
  - The round number is derived from the directory listing (`currentRound` `src/phases.ts:247`).
- **F3 — PLAN.md grammar and writers.**
  - `HEADING` / `FIELD` in `src/plan.ts:37-41`; known fields `attempts`, `fork-base`.
  - Status writes go through `edit()` (`:226-273`): `begin`, `markDone`, `block`, `resetInProgress`, `setStatus`, `setSubtasks`, `tick`, `syncSubtaskTicks`.
  - Only `phase-plan.md` and `implement-plan.md` let an AI session write PLAN.md (`allowWrite`, `src/loop-phase.ts:105,182`); everything else is the driver.
  - `next()` (`:89`) selects the first non-done task in file order.
- **F4 — subtask state protocol** (`src/document/state.ts`).
  - `scanSubtaskStates` (`:206`) reports states per subtask, with illegal `both` / `neither`.
  - `effectiveDone` (`:229`) lets files win over ticks.
  - `renameTodoToDone` (`:241-247`) is called at `src/execute.ts:489`, inside the subtask commit.
  - Selection happens at `src/runner.ts:341-379`, over the checklist items in the PLAN.md body.
- **F5 — the subtask identity is positional.** No code parses `S\d+` or `T-NNN.SNN`; the qualified id is output-only (`src/prompt.ts:291`).
- **F6 — numbering.** `taskNumberFloor` (`src/numbering.ts:44-85`) scans PLAN.md files and `docs/**/T-*` names; `.auto/next-task` holds the next number.
- **F7 — roles.**
  - `roleOf` (`src/document/roles.ts`) classifies by path shape: `driverState` covers any `PLAN.md` / `CURRENT.md` and `.auto/**`; `ledger` is `docs/(R-NN/)?phases.md`; `handoff` is by file name plus phase handover paths; `phaseAcceptance`; and `artifact` for `PROCESS_DOCS`.
  - `eofScanExempt` derives from the role.
- **F8 — legacy layouts.**
  - Three generations sit behind `resolveTaskDoc` / `resolveSubtaskDoc` (`src/docpaths.ts:108-133`): flat `docs/T-NNN.<role>.md`, `docs/T-NNN/SNN.md`, `docs/T-NNN-S<k>.testhandoff.md`.
  - Phases have `docs/phases/`, `round-N`, `handovers/R<N>-…`, and the root `docs/phases.md`.
  - Resume still reads `.auto/session.json` (`src/resume.ts:88`).
- **F9 — hardcoded paths outside docpaths:**
  - templates `decompose*.md`, `subtask.md`, `wrapup.md`, `context-base.md`, `number-recovery.md`, `_partials.md:55-65`;
  - `src/agents-block.ts:32-33`;
  - `src/runner.ts:361`.
- **F10 — blast radius.** About 35 test files encode these layouts (`plan`, `phases`, `docpaths`, `document-*`, `numbering`, `resume-gate`, `golden`, `incident-regression`, `prompt-*`, `template`, …), plus `packages/auto/test/e2e.test.ts`.

## 3. The unit model

| Level | Local number | Qualified id | Directory | Parent index | State file |
|---|---|---|---|---|---|
| round | `R-NN` | `R-01` | `docs/R-01/` | — | `round.md` (goal; human-written, optional) |
| phase | `P<nn>` (in round) | `R-01.P02` | `docs/R-01/P02-design/` | `docs/R-01/phases.md` | `todo.md` → `done.md` |
| task | `T-NNN` (global, unchanged) | `T-014` | `docs/T-014/` (flat, unchanged) | `<phase dir>/tasks.md` | `todo.md` → `done.md` |
| subtask | `S<nn>` (in task) | `T-014.S03` | `docs/T-014/S03/` | `docs/T-014/subtasks.md` | `todo.md` → `done.md` (today) |

Invariants:

- **U1 — content lives in the unit.** A unit's title, field block and body sections are in its own `todo.md`.
- **U2 — progress is the file name.**
  - Exactly one of `todo.md` / `done.md` exists. The driver renames, inside the unit's closing commit.
  - Both files, or neither, is an illegal state.
  - `scanSubtaskStates` generalizes to any level.
- **U3 — the index holds order and membership only.** An index line looks like `- [ ] T-014 <title>`. Its tick is a redundant view, and files win, exactly as `effectiveDone` does today.
- **U4 — runtime state is not a document.**
  - `in_progress`, `blocked`, `attempts` and `fork-base` move out of git-tracked documents.
  - The active unit stays in `.auto/progress.json`. Attempts, fork base and the blocked flag go to a new `.auto/units.json` (driverState).
  - The reason for a block is in the run log, as it already is since `block()` stopped writing Q&A fields.
- **U5 — tasks are not nested.**
  - A phase relates to its tasks only through membership in `tasks.md`, plus a back-reference field `Phase: R-01.P02` in the task's `todo.md`.
  - A task that continues in a later round keeps its origin phase.

## 4. Layout and content

```
docs/
  R-01/
    round.md                 round goal and acceptance criteria (human; M4.2 lands here)
    phases.md                phase index (replaces the ledger; completion derives from P*/done.md)
    P01-analysis/
      todo.md | done.md      phase unit: Type / Goal / Exit / Depends
      tasks.md               task index (written by the planning session; replaces PLAN.md)
      findings.md            type-standard artifact (§5)
      handover.md            four-section handover (was handovers/<l>-<slug>.md)
      acceptance.md          acceptance record (role exists since M2.3; gate is M3/0036 D8)
    P02-design/ …
  T-014/
    todo.md | done.md        task unit: title / Phase / Depends / Touches / ## Goal / ## Scope / ## Acceptance
    context.md shared.md subtasks.md report.md handoff.md testhandoff*.md   (unchanged)
    S01/ todo.md | done.md, index.md                                        (unchanged)
```

- **L1 — PLAN.md is retired.**
  - No root PLAN.md, no symlink, no phase archive snapshot: the phase directory is the archive.
  - Human overview comes from a read-only CLI `status` subcommand. It renders the round → phase → task → subtask tree with ticks and dependencies.
  - No generated summary file is written, so there is one source of truth.
  - Manual edits go to `todo.md` / `tasks.md` directly.
- **L2 — no-phase mode is phase P01.**
  - `phases: "m"` becomes an implicit `R-01/P01-implement`.
  - `runTaskLoop` and `runPhaseLoop` merge into one loop, and `implement-plan` becomes P01's planning session.
- **L3 — planning writes units.**
  - The planning session writes `P<nn>/tasks.md` plus one `docs/T-NNN/todo.md` per task.
  - `requireArtifact`'s `collect` checks them with `checkArtifactSpecs` under the `mandatory` policy: field block, anchors `## Goal` / `## Scope` / `## Acceptance`, eof. This is the mechanism decompose already uses for `S<nn>/todo.md`.
- **L4 — the ledger is derived.** A phase is complete when its `done.md` exists. The `LEDGER_ENTRY` protocol line is retired, not translated, which removes that 0035 §4 surface from M3.

## 5. Phase types and standard artifacts

Phase *types* replace letters as registry entries:
`{ type, slug, dutiesRef, decomposeTemplate, phaseArtifacts: ArtifactSpec[], taskArtifacts: ArtifactSpec[], hasTasks, gate }`.
The artifact lists are plain `ArtifactSpec[]`, so `checkArtifactSpecs` checks them and no new checker is written.

| Type | Phase-level artifact | Task-level artifact (besides report.md) | Tasks | Notes |
|---|---|---|---|---|
| `analysis` | `findings.md` | `analysis.md` | yes | no code |
| `design` | `design.md`, `decisions.md` | `design.md` | yes | includes a consistency subtask |
| `implement` | — (code) | — | yes | was `m` |
| `test` | `test-report.md` | `test-log.md` | yes | |
| `acceptance` | `verdict.md` (`Result: PASS\|FAIL`) | `verification.md` | yes | FAIL stops the round |
| `knowledge` | `kb.md` (was `migration-kb.md`) | — | no | `hasTasks: false` replaces the k special case |

- **Letters become presets.** `--phases adm` expands to `P01-analysis, P02-design, P03-implement` written into `phases.md`. After expansion, the order is data.
- **Types can repeat.** A type may occur more than once (design → implement → design revision). That is the concrete payoff of M3.2's validation generalization.
- **Registration.** The new file names are registered in 0035 §3 as new English literals, with no dual-read.

## 6. Rulings (user, 2026-09-21)

| # | Question | Ruling |
|---|---|---|
| R1 | How `blocked` is carried once status is a file name | **Runtime state** in `.auto/units.json` and the run log; the file name only says todo/done. |
| R2 | Human overview / edit entry after PLAN.md | **Read-only CLI `status`**; no summary file. |
| R3 | Compatibility with existing projects | **None.** Old-layout projects do not advance under auto-next; a project that must continue is restarted by hand as a new project. |
| R4 | 0046 S1 | **Deferred and absorbed**: 0046 D1's carrier is replaced by §7; its checks (D4) and selection (D7) are implemented once, generically, in M3.1/M3.5. |
| R5 | Scheduling | Into the root plan as a regrouped M3 (§9). |

Consequences of R3:
- **Legacy code is deleted.**
  - Every legacy fallback is removed in M3.7: F8's path builders and resolve branches, `LEGACY_ROUND_RE`, the root `docs/phases.md` path, and the `.auto/session.json` read.
  - 0036 §7.4's objection disappears instead of being managed. This overrides `plans/0013` D2 and the root plan's D2 clause "old admtvk configs lossless".
- **A legacy layout is a usage error.** Detection: a root `PLAN.md`, or a `docs/R-NN` without `P*` directories. The error message is "legacy layout: start a new project". Nothing is read silently.
- **Field trial moves to a new project.** M6.3 observes a newly started project. Running kernel-* projects finish on the frozen auto-core build.
- **The dual-read layers are an open question.** Retiring the protocol-string dual-read layers (M2.4 `状态:` / `产出:` / `## 范围声明`, and so on) is root open question 17. Those layers also serve project template overlays, not only old documents, so R3 does not settle them automatically.

## 7. Unified dependency grammar

The same field block is used at every level, right after the unit's title line:

```
# T-014: DMA ring buffer
Phase: R-01.P03
Depends: T-011, T-012
Touches: src/dma/, include/dma.h
```

| # | Decision | Content |
|---|---|---|
| G1 | Scope | `Depends` names same-level ids: `S01` within the task, `T-NNN` across phases, `P01` within the round. There are no cross-level edges; the hierarchy implies them (a phase is done only when its tasks are). |
| G2 | Semantics | Shallow "start after that unit is done" (0046 D2). |
| G3 | Defaults are conservative | A missing `Depends` means the previous sibling in the index, which is serial and today's order; `Depends: none` declares a root. A missing `Touches` means touches everything, never disjoint (0046 D3). An empty value is an error. |
| G4 | Checks | `unitProblems(units): string[]`, a pure function covering: unknown id, self-dependency, cycle (reported with its path), out-of-scope reference, absolute / `..` / empty paths. Overlap is not an error. This takes over 0046 D4 unchanged. |
| G5 | Selection | `nextReady(index, states)`: the first unit in index order that is not done and whose dependencies are all done. With G3's defaults the serial order equals today's. The MP.3 scheduler adds "disjoint + free slot" on top. |
| G6 | Where checks run | Planning (`tasks.md` + task `todo.md`) and decompose (`subtasks.md` + `S<nn>/todo.md`) run `unitProblems` in their `collect`, and a problem triggers one retry that names it (0046 D6's dynamic requirement). The loop re-checks on load and exits 2 on problems. |

Ids do not change shape: `T-NNN` and the `Auto-Task:` trailer stay as they are, and D3-A/B stays deferred to MP.3. `R-01.P02` appears only in document fields and logs.

## 8. Rejected

- **Tasks inside phase directories.** This breaks task permanence (0036 §7.1): a task spanning rounds would get two homes.
- **A generated PLAN.md.** It is a second source of truth, and every rewrite enters commits and the clean gate (0036 F14's reasoning).
- **`blocked.md` as a third state.** It adds a rename and more illegal combinations. `blocked` is a runtime fact (R1).
- **A compatibility read or migration command** for old layouts. R3 rules it out.

## 9. Steps (root plan M3)

- [ ] M3.0 This document; root plan regrouped (D14, M3.0–M3.8, MP.1 re-scoped, open question 17).
- [ ] M3.1 Unit model, `src/document/unit.ts`, interface first: `UnitRef` / `UnitLevel`, generalized state scan, index parser, `unitProblems`, `nextReady`. Pure; unit tests first.
- [ ] M3.2 Phase-type registry (§5) + letter presets + `parsePhases` → registry validation, without weakening existing guards.
- [ ] M3.3 Phase directories: `phases.md`, `P<nn>-<type>/` with todo/done, derived ledger, handover and acceptance moved in, `roles.ts` shapes updated; `LEDGER_ENTRY` retired (0035 §4 note).
- [ ] M3.4 Task units: `T-NNN/todo.md|done.md` + `tasks.md`, planning sessions rewritten, runtime state to `.auto/units.json`, `numbering.ts` floor over task dirs, `## T-NNN` heading protocol retired, no-phase mode as P01 with the loops merged, CLI `status`.
- [ ] M3.5 Dependencies at all three levels: `nextReady` at every selection point, `unitProblems` in the planning/decompose `collect` and on loop load, template syntax text.
- [ ] M3.6 Custom phase types (was M3.3): the project-level registry entries.
- [ ] M3.7 Legacy removal (§6 R3) + legacy-layout usage error; dual-read per open question 17.
- [ ] M3.8 Template translation, verification, merge-back #3.

## 10. Verification

- `bun typecheck` / `bun test` green in `packages/auto-core` and `packages/auto`.
- Goldens rebuilt for the new layout. Incident-regression scenarios are re-expressed over task units and must stay green.
- An old-layout fixture (root PLAN.md; letter phase dirs) exits with the usage error.
- Dryrun end to end:
  - `init --phases adm` yields P01–P03;
  - planning writes `tasks.md` and `T-*/todo.md`;
  - each unit's todo→done rename lands in its commit;
  - round completion derives from the phases' `done.md`.
- Negative cases: a dependency cycle, an out-of-scope reference, an empty `Touches`.

<!-- auto: eof -->

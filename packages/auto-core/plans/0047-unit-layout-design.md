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

- [x] M3.0 This document; root plan regrouped (D14, M3.0–M3.8, MP.1 re-scoped, open question 17).
- [x] M3.1 Unit model, `src/document/unit.ts`, interface first: `UnitRef` / `UnitLevel`, generalized state scan, index parser, `unitProblems`, `nextReady`. Pure; unit tests first. (2026-09-22; notes in §11.)
- [x] M3.2 Phase-type registry (§5) + letter presets + `parsePhases` → registry validation, without weakening existing guards. (2026-09-22; notes in §11.)
- [x] M3.3 Phase directories: `phases.md`, `P<nn>-<type>/` with todo/done, derived ledger, handover and acceptance moved in, `roles.ts` shapes updated; `LEDGER_ENTRY` retired (0035 §4 note). (2026-09-22; notes in §11.)
- [x] M3.4 Task units: `T-NNN/todo.md|done.md` + `tasks.md`, planning sessions rewritten, runtime state to `.auto/units.json`, `numbering.ts` floor over task dirs, `## T-NNN` heading protocol retired, no-phase mode as P01 with the loops merged, CLI `status`. (2026-09-22; notes in §11.)
- [x] M3.5 Dependencies at all three levels: `nextReady` at every selection point, `unitProblems` in the planning/decompose `collect` and on loop load, template syntax text. (2026-09-22; notes in §11.)
- [x] M3.6 Custom phase types (was M3.3): the project-level registry entries. (2026-09-22; notes in §11.)
- [x] M3.7 Legacy removal (§6 R3) + legacy-layout usage error; dual-read per open question 17. (2026-09-22; notes in §11.)
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

## 11. Implementation notes

### M3.1 (2026-09-22)

`src/document/unit.ts`, tested by `test/document-unit.test.ts` (30 cases). Nothing calls it yet except the subtask protocol; wiring is M3.3–M3.5.

- **Refs.** `UnitRef` is a union by level: a phase carries `round` and `type` (its directory is `P<nn>-<type>`), a task is bare, a subtask carries `task`. `qualifiedId` / `unitDir` / `unitStatePaths` / `parsePhaseDir` derive from it. Local id shapes: `P<nn>`, `T-NNN`, `S<nn>` (two or three digits minimum, open-ended).
- **State scan.** `scanUnitStates` reports `todo | done | both | neither` per unit, the illegal pair, and a `done` set in which `both` counts as done (files win, as in `effectiveDone`). `renameUnitDone` is the idempotent rename. `document/state.ts` now delegates its scan and rename to these; its activation rule and checklist merge stay subtask-specific until M3.4 retires the PLAN.md checklist. A test asserts the unit state paths equal `subtaskStateSpec`'s.
- **Index.** `parseIndex(text, level)`: members are top-level checklist lines `- [ ] <id> <title>` (`*` bullets, `[x]`/`[X]`, a colon after the id tolerated). Indented checklist lines and prose are ignored; a top-level checklist line whose first token is not an id of the level, and a repeated id, are problems (first occurrence kept). Today's `subtasks.md` lines carry no ids (F5); M3.5 adds them to the decompose template, so the subtask index is not read through this parser before then.
- **Field block.** `parseUnitDoc`: the run of `Key: value` lines right after the title line (blank lines before the first field allowed; without a title line, from the top). Keys are case-insensitive and stored lower-cased. `Depends` is tri-state: absent (`undefined`, G3 default), `"none"` (explicit root), or a list, where an empty value parses to `[]` so the checks can reject it; `Touches` is absent or a list, backticks stripped.
- **Checks.** `unitProblems(level, units, { external })` in this order: duplicate units; per unit, empty `Depends`, self-dependency, out-of-scope id (not the level's shape), unknown id; empty `Touches`, absolute path, `..` segment; then cycles. `external` names ids outside this index that may be referenced (a task depending on an earlier phase's task). Cycles are found over the *effective* graph (`resolveDepends`, defaults included), so an explicit edge that closes a loop with a default edge is caught; each cycle is reported once with its path.
- **Selection.** `nextReady(units, done)`: first unit in index order not done whose effective prerequisites are all in `done` (which may hold external ids). No blocked handling: blocked is runtime state (R1), and today's loops resume a blocked task directly.

### M3.2 (2026-09-22)

`src/phases/registry.ts`, the phases domain's entry module (already reserved in the import-direction table), tested by `test/phases-registry.test.ts` (13 cases).

- **Entries.** The six builtin types carry the §5 shape plus three fields the letter layout still needs until M3.3: `letter` (the preset), `slug` (the `<letter>-<slug>` directory name; `migrate` and `testing` differ from the type ids `implement` and `test`) and `name` (the display name, Chinese until M3.8). `gate` is `"none" | "verdict"`. Artifact specs hold paths relative to the unit directory; `unitArtifactSpecs` resolves them. The artifacts and the gate have no reader yet (M3.3/M3.4).
- **Duties.** `dutiesRef` is one key for both duty texts: the intent pack's `## phase duties` / `### <key>` subsection (decompose) and the new `plan-duties-<key>` shared partial (phase-plan). Builtins keep their letters as keys, so existing packs and overlays resolve unchanged. The six `{{#if phaseX}}` blocks left `phase-plan.md` for those partials; phase-plan renders `{{planDuties}}` and its goldens are byte-identical.
- **Validation.** `expandPhases` restates the old whitelist over the registry: presets only, strictly increasing in canonical order, containing `implement`. `parsePhases` delegates to it. A test holds it equal to the pre-M3.2 function on every string up to length 4 over the preset letters plus two outsiders, and on all 64 canonical subsets and their reversals. Repeating a type is not allowed yet: letter strings cannot express it, and the phase index that can arrives in M3.3.
- **Literal tables retired.** `PHASE_NAMES`, `PHASE_SLUGS`, the letter unions in `resume.ts` / `opts.ts`, `switches.ts` `MODEL_LETTERS`, the `decompose-<letter>` name, and the two `[admtvk]` directory regexes (phases.ts, refcheck.ts) all read the registry. The knowledge special case in `loop-phase.ts` now keys on `hasTasks: false`. The direct session itself stays knowledge extraction, since it is the only builtin without tasks; M3.6 generalizes the session choice when custom types arrive.
- **Guards left as they are.** Shell-side guards are untouched: run rejects `--phases`, and the continue precheck and prefix guard compare letter strings against the ledger. Generalizing them to the phase index belongs to M3.3, which replaces the ledger they read.

### M3.3 (2026-09-22)

`src/phases.ts` rewritten over the phase directory layout; `src/loop-phase.ts`, `src/knowledge.ts`, `src/document/roles.ts`, `src/refcheck.ts` and the shell (`packages/auto/src/index.ts`) rewired. Tests: `test/phases.test.ts` rebuilt (24 cases), knowledge / roles / refcheck / docpaths / prompt tests and the shell e2e moved to the new layout.

- **Index.** `docs/R-NN/phases.md` holds a `# Phases (R-NN)` title, a one-line note and one `- [ ] P<nn> <type>` line per phase, read with `parseIndex(text, "phase")`. The first token of the title is the type, so the index alone locates each directory `P<nn>-<type>/`. `syncPhaseIndex` writes the index and one `todo.md` per phase at round start (`establishRound` now takes `phases`). It is idempotent, and on a changed preset it keeps the matching prefix and rewrites only the tail. Rewriting is allowed only for phases that are not done and whose directory holds nothing but `todo.md`; anything else throws before a file is touched. The phase `todo.md` carries the title `# R-NN.P<nn>: <name>`, the field `Type: <type>` and the eof terminator. `Goal` / `Exit` are not written, because nothing supplies them yet (the round goal is M4.2's `round.md`).
- **State.** `readPhases` returns the index plus `scanUnitStates` over the phase refs, and throws with fix-it guidance on a problem line, an unknown type, a repeated type, or a both / neither state. `currentPhase` is `nextReady` over the index with default serial dependencies. `Depends` in a phase `todo.md` is not read yet; M3.5 wires it. `completePhase` renames `todo.md` → `done.md` and ticks the index line. It is the only completion path: the handover and the interruption recovery both call it. The 0036 D8 acceptance gate is not implemented, because its marker literal and whether it is on by default need a ruling (root open question 15), but its precondition has one place to go, inside `completePhase`.
- **A type occurs at most once per round for now.** The preset letter stays the runtime key of model routing, stats buckets and step resume points (`progress.json` `letter`), so `readPhases` rejects a repeated type until custom types (M3.6) re-key those. Display strings use the label `P<nn>-<type>`: the progress line (`P01-analysis✓ P02-implement▶ P03-test`), banners, and the planning / handover / transition commit subjects.
- **Deviation: the PLAN.md snapshot stays, inside the phase directory.** The root plan's M3.3 line cancels the phase archive snapshot, but PLAN.md is still the task carrier until M3.4. Dropping the snapshot now would leave a finished phase's task list only in git history for one milestone. The interruption recovery also keys on it: snapshot present and phase not done means the handover stopped between the reset and the rename. So the handover writes `P<nn>-<type>/PLAN.md` (driverState by name; refcheck skips exactly that file) and M3.4 replaces it with the phase's `tasks.md`.
- **Moved into the phase directory:** the handover `handover.md` (was `handovers/<l>-<slug>.md`), the acceptance record `acceptance.md` (was `phase-docs/<l>-<slug>/`), free phase artifacts (the `doc-layout` partial now points at the current phase directory), and the knowledge document `kb.md` (was the round-level `migration-kb.md`). `knowledgeFile` / `existingKnowledge` / `extractKnowledge` take the phase unit; `existingDistilledDocs` and `prevRoundDigest` read phase handovers and knowledge-phase `kb.md` (`roundKnowledgeDocs`).
- **Removed now, not in M3.7:** every reader of the retired ledger line, which means `readLedger` / `appendLedger` / `ledgerPath` / `LEDGER_ENTRY`, the pre-round-directory previous-round digest (it parsed archived ledgers), and the root-ledger branch of the prior-knowledge "round already advanced" check (that check now counts done phases in the index). Also removed: the letter-layout path builders `phaseArchive` / `handoverDoc` / `phaseDocsDir` with their legacy twins, and docpaths `knowledgeDoc` / `legacyKnowledgeDoc`. **Left for M3.7:** the pre-round flat readers (`docs/migration-kb/`, `docs/handovers/`, flat `docs/prior-kb/`), `currentRound`'s `round-<N>` count, `nextRound`'s root-ledger check, the legacy role shapes, and the shell's legacy-in-flight branch.
- **Guards.** The continue precheck now requires the round's index to exist with every phase done, where before it required the ledger to cover the configured letters. The "completed phase outside `phases`" rejection stays, comparing index letters with the configured letters. The prefix guard compares `doneLetters` (index order) with the new preset. These are not weaker: a round counts complete only when every phase set up for it has its `done.md`. `routePhase` no longer rejects "ledger letters outside the configured phases", because the index is the round's truth once expanded (§5 "after expansion, the order is data"), and a hand edit to it is a legitimate manual edit (L1). The configured `phases` only seeds new rounds and the shell guards.
- **Roles.** The `ledger` role keeps its name and now means the phase index (policy unchanged: driver-owned format, no terminator). The handover and acceptance shapes are `docs/R-NN/P<nn>-<type>/handover.md` and `…/acceptance(-r<n>)?.md`; phase `todo.md` / `done.md` and standard artifacts classify as `artifact` through the round-directory prefix. The letter-layout shapes (`R-NN/handovers/`, `R-NN/phase-docs/`) are gone; the pre-round legacy shapes stay until M3.7.
- **Prompts.** `knowledge`, `wrapup`, `prior-knowledge`, `phase-plan`, `phase-handover`, `number-recovery`, the `doc-layout` and `plan-duties-k` partials, and the AGENTS.md pointer block point at the phase directory. The D13 leftover in `doc-layout` (`audit.md` / `fix.md`) is removed in the same edit. 21 goldens regenerated, with no other drift.
- Verification: auto-core 1077 pass / 0 fail + typecheck clean; packages/auto 52 pass + 2 skip + typecheck clean.

### M3.4 (2026-09-22)

`src/plan.ts` is deleted and replaced by `src/tasks.ts`; `src/status.ts` is new. Rewired: `phases.ts`, `loop.ts`, `loop-task.ts`, `loop-phase.ts`, `loop-preflight.ts`, `loop-progress.ts`, `implement.ts`, `runner.ts`, `execute.ts`, `current.ts`, `numbering.ts`, `git.ts`, `check.ts`, `document/roles.ts`, `refcheck.ts`, the prompt layer, and the shell (`packages/auto/src/index.ts`). `templates/PLAN.md` and `templates/PLAN.scaffold.md` are removed. Tests: `test/tasks.test.ts` (16 cases) replaces `test/plan.test.ts`. The shared fixture `test/fixtures/units.ts` turns the old compact `## T-NNN: title [status]` notation into an in-memory `Plan` (`planOf`) or into units on disk (`seedUnits`), so the session-driving suites kept their scenarios. The incident-regression set runs over task units and stays green.

- **Store.** A `Plan` is now the current phase's view `{dir, phase, index, tasks}`. `loadPlan(dir, phase)` reads the phase's `tasks.md` with `parseIndex(…, "task")` and scans `docs/T-NNN/` with `scanUnitStates`. A missing index is an empty plan. A problem line, or a task with both state files or with neither, throws with fix-it guidance, and `routePhase` turns that into `blocked` (exit 1). `Task.body` is the `todo.md`/`done.md` text without the title, the field block and the terminator. `Task.depends` is parsed but not yet used for selection: `next` is still the first task that is not done, and M3.5 switches it to `nextReady`.
- **Runtime state (R1).** Status (`in_progress` / `blocked`), `attempts` and `forkBase` live in `.auto/units.json` (`{tasks: {id: {…}}}`). Updates go through a serialized, atomic queue; an unreadable file falls back to the defaults. A task's status is `done` exactly when `done.md` exists, and `markDone` drops its entry. `resetInProgress(dir)` clears only `in_progress`. The PLAN.md field lines (`attempts`, `fork-base`) are gone.
- **Completion.** `markDone(plan, id)` renames `todo.md` → `done.md`, ticks the index line (`tickIndexLine`, shared with `completePhase`) and drops the runtime entry. It is idempotent and lands inside the unit's commit. The FAIL-verdict message tells the human to rename `done.md` back or list fix tasks in the phase index.
- **Checklist.** The subtask checklist lives only in `docs/T-NNN/subtasks.md`. `readChecklist` returns its items with `effectiveDone` applied (the S<nn> files win), and the driver ticks line *n* with `tickSubtask` when a subtask completes. `setSubtasks`, `syncSubtaskTicks` and checklist injection into the task body are retired. `ensureDecomposed` skips the session when the checklist is non-empty and reuses an existing `subtasks.md`. `CURRENT.md` and the progress heartbeat read the same checklist.
- **Planning.** The phase-plan and implement-plan sessions write the phase's `tasks.md` plus one `docs/T-NNN/todo.md` per task. The skeleton is `requireArtifact`:
  - `reset` = `resetPlanning`: removes the listed task dirs that are not taken, then the index.
  - `collect` = `plannedTaskProblems`: index missing or empty; an id that is taken, or below the numbering start; a stray `done.md`; `checkArtifactSpecs(taskTodoSpec(id))` under the mandatory policy (field block, `## Goal` / `## Scope` / `## Acceptance`, the terminator); and a `Phase:` field that is not the qualified phase id.
  - It returns the ids, and numbering advances past them.

  Taken ids are the ids in other phases' `tasks.md` plus every `docs/T-*/done.md` (`takenTaskIds`). A new tier-1 marker set guards both templates. `implement.ts` reuses the same mechanism on the implicit `P01-implement`, with numbering start = max taken + 1.
- **No-phase mode = the implicit phase `R-01/P01-implement`** (user ruling: keep the m semantics). `establishRound` always runs, so `init` writes `docs/R-01/phases.md` with one `implement` phase in every mode, and one loop serves both modes (`runPhaseLoop`; `ctx.manual` for `m`). In manual mode the run starts no planning and no handover session. The plan route prints how to list tasks and exits 0. When all tasks are done, the run prints `✓ all tasks complete` and exits 0, and P01 stays open (`todo.md`), so more tasks can be appended to the same phase later. Tasks come from the init shortcut or a hand-written `tasks.md`/`todo.md`.
- **Handover.** The phase `PLAN.md` snapshot and the reset to the scaffold are gone. The index stays in the phase directory, so the handover is `closeStep` → `completePhase` → commit, and the snapshot-keyed interruption-recovery branch is removed. The M3.3 deviation is closed.
- **Numbering floor.** `taskNumberFloor` scans `docs/R-*/P*/tasks.md` through `parseIndex` plus the task directories, where before it scanned PLAN.md files.
- **Carryover and protection.** `driverStateFile` matches:
  - `CURRENT.md`
  - `docs/R-NN/phases.md`
  - `docs/R-NN/P<nn>-<type>/(tasks|todo|done).md`
  - `docs/T-NNN/(todo|done).md`

  So a failed commit's index tick or rename self-heals through carryover. `documentOnly` no longer lists PLAN.md. `PROTECTED_FILES` is `CURRENT.md`, `opencode.json` and the project config. **Decision: `tasks.md` is not chmod-protected**, because the planning sessions author it; the driver owns only its ticks, and the `state-rule` partial now says so.
- **Roles.** `tasks.md` and the task state files classify as `artifact` (session-authored content, driver-owned ticks and renames). `PLAN.md` keeps the `driverState` role by name until M3.7, so leftover files in old projects stay exempt from the eof scan.
- **CLI `status`** (L1, R2) prints the config summary, then `renderStatus`: R-NN → phases `[✓/▶]` → tasks (mark, `Depends`, subtask count, attempts) → the subtasks of unfinished tasks. Index problems become `⚠` lines, and nothing is written. The run banner keeps its one-line phase progress.
- **Deviations and decisions:**
  - **Removed early, not in M3.7:** the shell's legacy-in-flight branch (a root PLAN.md alongside the round directory), because `establishRound` no longer writes PLAN.md or a symlink. An old project now stops at the missing or invalid phase or task index (exit 1). The dedicated legacy-layout usage error stays M3.7.
  - **Dryrun skips the pre-route:** the permission preflight session needs no task index.
  - **`check`** scans `AGENTS.md` and `docs/T-*/todo.md`, taking the task id from the path.
  - **`refcheck`** has lost its phase-snapshot exclusion.
- Verification: auto-core 1066 pass / 0 fail + typecheck clean; packages/auto 52 pass + 2 skip + typecheck clean. The count drop from M3.3 is the deleted PLAN parser suite. The two opt-in E2E cases were rewritten over task units but not run (they need opencode and credentials).

### M3.5 (2026-09-22)

The unit model of M3.1 is now wired at every level. No new module was added; the changes are in `src/document/state.ts`, `src/tasks.ts`, `src/phases.ts`, `src/runner.ts`, `src/resume-gate.ts`, `src/execute.ts` and `src/template.ts`, plus two partial sections and one line each in the two planning templates and the seven decompose templates. Tests: 11 new cases in `tasks.test.ts`, `phases.test.ts`, `document-state.test.ts` and `resume-gate.test.ts`. 15 goldens were regenerated; the only change in each is the inserted partial text.

- **Phases.** `readPhases` reads `Depends:` from each phase's `todo.md` (or `done.md`) into `PhaseUnit.depends` and runs `unitProblems("phase")`. A problem makes the index invalid, like any other index problem. `currentPhase` is `nextReady` over the declared dependencies. The driver-written phase `todo.md` declares none, so the order stays serial unless a human adds one.
- **Tasks.** `loadPlan` parses `Depends:` / `Touches:` of every listed task and runs `unitProblems("task", …, { external: doneTaskIds })`. A task may name a task of its own index or any **completed** task (a `docs/T-*/done.md`). It may not name an unfinished task of another phase, because that task could never become ready inside this phase. `next(plan)` is `nextReady`. Because of the load-time check, a dependency outside the index can only be a completed task, so `next` counts it as done. Blocked tasks remain candidates, as before. `plannedTaskProblems` runs the same graph check once every listed task has passed its document checks, so the planning session's retry names the problem.
- **Subtasks.** **Deviation from the M3.1 note: subtask ids are positional.** Item n of `subtasks.md` is `S<nn>`, the mapping the decompose template already used, so the checklist lines carry no ids. Adding ids would have changed the checklist text that goes into commit subjects, prompts and `CURRENT.md`, for no gain. `readChecklist` attaches `depends` / `touches` from the field block at the top of each `S<nn>/todo.md` (or `done.md`); a subtask scope file has no title line. `document/state.ts` adds the pure `subtaskId`, `nextChecklistIndex` and `checklistProblems`. They are used at the three places that pick the next subtask:
  - the runner loop, which blocks with exit 2 and names the fix on a bad graph;
  - `unitReruns`, so recovery ownership follows the same order;
  - the decompose collect, whose one retry names the problem.
- **Exit codes (deviation from G6's "exits 2").** A bad graph found on load in a phase index or task index is an invalid index. It goes through the existing `routePhase` blocked route and exits 1 with fix-it guidance, the same as the M3.4 index problems, because the fix is a manual edit of the index files. A bad subtask graph blocks the task and exits 2, the same as the illegal subtask state files next to it.
- **Touches** is parsed and checked (empty value, absolute path, `..`) at every level, and shown in the loaded `Task`. It takes no part in selection; that starts with the MP.3 scheduler.
- **Templates.** The partials `task-depends` and `subtask-depends` are in English (0035 M3.5 amendment) and have tier-1 markers. The planning templates keep their Chinese prose until M3.8. `status` already showed task `Depends`.
- **Known limitation, unchanged:** `doneLetters` (the shells' `continue` prefix guard) lists completed phases in index order. A round whose phases finish out of order through `Depends:` still passes `continue`, because that requires every phase to be done.
- Verification: auto-core 1077 pass / 0 fail + typecheck clean; packages/auto 52 pass + 2 skip + typecheck clean.

### M3.6 (2026-09-22)

New module `src/phases/custom.ts`, published as a second phases-domain entry (the import-direction table now lists `phases/registry` and `phases/custom`). Rewired: `phases.ts`, `phases/registry.ts`, `config.ts`, `loop-preflight.ts`, `loop-phase.ts`, `loop-task.ts`, `conclusion.ts`, `resume.ts`, `resume-gate.ts`, `artifact.ts`, `attempt.ts`, `session.ts`, `unit-commit.ts`, `chain.ts`, `switches.ts`, `prompt.ts`, `stats.ts` (comment only), and the shell. Tests: `test/phases-custom.test.ts` (9 cases) is new. Custom cases were added to the phases, config, prompt, switches and chain suites and to the shell e2e suite.

- **Definition file (user ruling, open question 6: one `.md` file per type).** `.opencode/auto/phases/<type>.md` holds the whole registry entry:
  - the title line, which is the display name;
  - an optional field block: `Tasks: yes`, `Gate: none|verdict`, `Phase-artifacts:` and `Task-artifacts:` (relative paths, comma- or space-separated);
  - a required `## plan duties` section;
  - an optional `## decompose duties` section;
  - an optional eof marker.

  Unknown fields or sections are errors. So are `Tasks: no` (task-less phases stay builtin, F8), an absolute path or a path with `..`, and a driver-owned file name in an artifact list. The file name is the type id. It must fit the directory grammar and must not be:
  - a builtin id;
  - preset-shaped (only `admtvk` letters, so the two forms of the phases value never overlap);
  - a model-routing role word (checked by the driver, see below).

  An invalid file is a usage error that names the file. There is no global registry. `loadPhaseTypes(dir)` is synchronous and stateless (builtins plus project files, the same shape as `loadModes`), and every `PhaseUnit` carries its resolved `entry`.
- **Entry shape.** `slug` is gone, because the letter layout was retired in M3.3. New fields:
  - `origin: "builtin" | "project"`;
  - `planDuties` / `decomposeDuties`, the custom duty text that overrides the `plan-duties-<ref>` partial and the pack's `### <ref>` subsection.

  A custom type renders `decompose-m`, the phase-generic body that takes `phaseName` / `phaseDuties`, and its `dutiesRef` is its own id. The `{{phase}}` prompt var is `letter ?? type`, which keeps the builtin goldens byte-identical.
- **Config reference (user ruling: type-id list, tasks required).** `phases` has two forms:
  - a letter preset, which keeps the unchanged whitelist rule;
  - a comma-separated list of type ids, which may be in any order, may repeat, must contain `implement`, and ignores spaces.

  config.json also accepts a JSON array and joins it with `,`. Only the string `m` is manual mode; the list `implement` is a phased flow. `resolvePhases` / `phasesProblem` in the registry serve config, `--phases`, `readPhases` and `syncPhaseIndex` alike.
- **Runtime keys moved from the letter to the phase unit.** This is what lets a type repeat within a round, and the M3.3 "at most once per round" rule is dropped. The qualified id `R-NN.P<nn>` is now the key of:
  - step resume points (`progress.json` `{kind: "step", step, unit}`, which was `letter`);
  - the stats phase bucket;
  - the resolve records' `phase`.

  The session layer's `opts.phase` is a `PhaseKey` `{id, entry}`. Close and resolve lines print the label (`■ phase P02-design 设计 closed`). No dual-read for the old `letter` step records: a pre-M3.6 in-flight step record simply fails to match and the step reruns, the same outcome as a lost record. M3.7 retires old layouts anyway.
- **Model routing.** An `OPENCODE_AUTO_MODEL` key that is neither `*`, a letter, nor a role word is a type-id key (`byType`). Precedence is role > type id > preset letter > wildcard. The type is known only once the project is loaded, so the run preflight rejects unknown type keys with exit 1 (`modelTypeProblems`). Retired role words still fail at parse time. A project type id that is a live or retired role word is refused where the driver loads types, in config load and the run preflight (`phaseTypeRoleProblems` in `switches.ts`). That check lives in the driver so `phases/custom` stays free of driver imports (D8). The builtin `knowledge` type shares its id with the knowledge role by design.
- **Shell.**
  - `--phases` takes either form and normalises the list form (trimmed, joined with `,`).
  - The prefix guard and the "completed phase outside phases" check compare type arrays (`doneTypes`, which replaces `doneLetters`).
  - The closing hint names the type (`to start analysis (分析) phase planning`).
  - The help text documents the list form.
- **Unchanged:** the phase index protocol, routing, rounds, the handover and knowledge steps, and the phase gate (`gate` is now also settable by a custom type).
- Verification: auto-core 1092 pass / 0 fail + typecheck clean; packages/auto 53 pass + 2 skip + typecheck clean. Builtin goldens are unchanged.

### M3.7 (2026-09-22)

- **Legacy-layout usage error.** `legacyLayoutProblem(dir)` in `src/phases.ts` finds two things:
  - a root `PLAN.md`;
  - a non-empty `docs/R-NN/` with no `P<nn>-<type>/` directory.

  An empty round directory is not flagged, because that is the crash window between `establishRound` ① and ②, which a rerun heals. The message is `legacy layout: start a new project (found …; …finish them on the auto-core release they started with)`. There are two call sites:
  - the first check of `runAll`'s preflight (exit 1, before any read or write, for every shell);
  - `packages/auto` before `init` / `continue` / `status` / `run` touch the disk.

  `reset` and `check` stay available on an old tree.
- **Removed read fallbacks:**
  - docpaths `legacyTaskDoc` / `legacySubtaskTestHandoff` / `legacySubtaskArtifact` / `legacyPriorKnowledgeDoc` and `resolveTaskDoc` / `resolveSubtaskDoc`. Every caller uses `taskDoc` / `subtaskDoc` directly;
  - the flat testhandoff branches in `testrun.ts`;
  - the flat `docs/migration-kb/`, `docs/handovers/` and `docs/prior-kb/` readers in `knowledge.ts`;
  - `currentRound`'s `round-<N>` count (`LEGACY_ROUND_RE`) and `nextRound`'s root `docs/phases.md` check;
  - the flat `docs/**/T-*.md` number floor;
  - the `.auto/session.json` read and cleanup in `resume.ts`.
- **Open question 17 ruled (a): the dual-read layer is removed with M3.7.** This covers `状态:` / `产出:` / `## 范围声明` / `## 产出清单` and `LEGACY_MARKERS`. A pre-flip override template now fails the tier-1 marker check at startup. 0035 has the amendment.
- **Roles.** The legacy shapes are gone: flat `T-NNN.<role>.md`, `-S<k>.testhandoff`, `docs/handovers/`, `docs/phase-docs/`, root `docs/phases.md` and `PLAN.md` as `driverState`. They classify as `freeform`, like any project file. `PROCESS_DOCS` is `docs/T-*` and `docs/R-*`.
- **Deviations from the step text:**
  - The P1 process-reference scan no longer matches `PLAN.md` or `docs/phases/`. Without the legacy layout they are ordinary project names, and flagging them would reject a deliverable's own `PLAN.md`. The prompt's process-document sentence now names only `docs/T-*` and `docs/R-*`, which regenerated the subtask and whole goldens.
  - Signatures narrowed:
    - `priorKnowledgeFile(round)` is sync, with the directory argument dropped;
    - `archiveHandoff(dir, handoff, n)` takes the handoff path instead of resolving it;
    - D8-frozen `ArtifactSpec` lost the optional `fallbackPath` and `anchorAliases`.
  - `refcheck` no longer excludes `docs/phases/` from the active documents.
  - Left alone because they are not layout fallbacks: `.auto/config.json`'s legacy `mode` fallback and the AGENTS.md `LEGACY_BLOCK` rewrite.
- **Templates.** number-recovery, prior-knowledge and the default intent pack lost their flat-layout clauses. Four goldens were regenerated (number-recovery, prior-knowledge, subtask, whole).
- Verification: auto-core 1079 pass / 0 fail + typecheck clean. The drop from 1092 is the deleted legacy cases; new cases cover `legacyLayoutProblem`, the preflight exit and the no-read assertions. packages/auto 54 pass + 2 skip + typecheck clean, with a new CLI case: an old-layout tree exits 1 on all four commands and nothing is written.

<!-- auto: eof -->

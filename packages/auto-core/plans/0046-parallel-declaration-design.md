# 0046 Parallel declaration surface (MP.1)

Root plan item MP.1 (`plans/AUTO_NEXT_REFACTOR_PLAN.md`, MP track, "declaration
only, no concurrency"), stage 1 of the rollout in `plans/0036` §6.4. Design
only; nothing here is implemented yet. The four open-question-15 sub-items MP.1
depends on were ruled by the user on 2026-09-21 (§1); everything else is a
proposal for review.

## 1. Rulings (root open question 15, 2026-09-21)

| # | Question (0036 §11) | Ruling |
|---|---|---|
| R1 | §11-5(a) task-level or subtask-level parallelism first | **Task-level first.** A task is already a commit-bounded unit with its own `docs/T-NNN/`, and it is what MP.3's one-worktree-per-agent model isolates. |
| R2 | §11-5(b) form of the touched-paths declaration | Follows from R1: a **PLAN.md task field** (`touches:`), written by the planning session. The subtask-level `Touches:` token is deferred until subtask parallelism is scheduled. |
| R3 | §11-10 flag naming | **`--max-sessions <N>`** — it counts concurrent AI sessions and cannot be misread next to `--agent` (0036 F25). |
| R4 | §11-12 granularity of `--parallel` | **Init-frozen only.** Passing it to `run` is a usage error, like every other project-level setting (F24). A lower-only run-time override stays possible later without breaking anything. |
| R5 | §11-1 id namespace (D3-A/B), deferred at M2.3 to "MP start" | **Deferred again, to MP.3**, where it is a hard prerequisite. MP.1 changes no id shape. |

R1/R2 revise the root plan's MP.1 item ②, which put the touched-paths
declaration on subtasks. Reason: tasks are decomposed only when they start
(`ensureDecomposed`), so a task-level scheduler cannot see subtask declarations
at plan time; the declaration has to live where the planner writes.

## 2. Fact baseline (auto-next after `ddf555aae`)

- **F1 — task record grammar.** `src/plan.ts`: heading
  `## T-…: <title> [status]` (`HEADING`), then a contiguous block of indented
  field lines `  - key: value` (`FIELD`); the first non-field line ends the
  block. Parsed fields today: `attempts`, `fork-base`. Unknown field lines
  (including the retired `verify`/`verified`/`final`) are preserved verbatim by
  `edit()` and otherwise ignored — so a new field survives every driver rewrite
  with no render change.
- **F2 — selection.** `next(plan)` = first task whose status is not `done`, in
  file order; this includes `blocked` tasks, which the task loop resumes
  directly (`src/loop-task.ts:42-59`). Second caller: the progress display,
  `src/loop-progress.ts:95` (prefers an `in_progress` task, else `next`).
- **F3 — planning sessions.** Two templates write PLAN.md tasks:
  `phase-plan.md` (phased flow, `src/loop-phase.ts`) and `implement-plan.md`
  (init shortcut, `src/implement.ts`). Both still in Chinese (M3 face).
  Both run through `requireArtifact` (`src/artifact.ts`), whose `collect`
  returning `undefined` triggers one retry with the fixed `requirement` text,
  then an implicit block. The retry message cannot name a specific problem
  today. Under `phases: "m"` without the shortcut, PLAN.md is hand-written.
- **F4 — config.** `ProjectConfig` (`src/config.ts`) is frozen by `init` into
  `.opencode/auto/config.json`; `saveProjectConfig` writes every key present.
  Optional keys (`source`, `destDir`) are omitted when undefined, so an
  optional key leaves existing config files byte-identical.
  `formatProjectConfig` prints the run banner's summary line.
- **F5 — shell flags.** `packages/auto/src/index.ts`: `VALUE_FLAGS` /
  `BOOLEAN_FLAGS` / `KNOWN_FLAGS`; the init-attribute list at `:149` is what
  makes an attribute a usage error on `run`; `--phases` (`:449-459`) is the
  model for a validated string attribute.
- **F6 — intent packs.** `INTENT_SECTIONS` (`src/intent/types.ts`, frozen
  interface M1.1), `SECTION_HEADINGS` (`src/intent/load.ts`), subsection
  addressing via `packSubsection`; prompt injection via `intentText` in
  `src/prompt.ts`. Adding a section = one `IntentSection` member + one heading
  mapping (0036 F28) — an interface amendment, driven by a real consumer per
  0031 D4.

## 3. Decisions

| # | Decision | Content |
|---|---|---|
| D1 | Two task fields, English from the start | `  - depends: T-002, T-003` and `  - touches: src/dma/, include/dma.h`, in the existing field block. Values: comma/whitespace-separated lists. `Task` gains `depends: string[]` and `touches?: string[]` (absent ≠ empty, D3). New literals: 0035 §3 registration, no dual-read (0036 §9). `edit()` needs no change (F1). |
| D2 | Shallow semantics | A `depends` edge means "start after that task is done" — nothing about data flow, which the driver cannot verify. |
| D3 | Missing `touches:` means "touches everything" | A task without the field is never considered disjoint from anything, so a future scheduler serializes it. Conservative by construction: forgetting the field costs width, never correctness. An empty value (`touches:` with nothing) is a plan error, not "touches nothing". |
| D4 | Plan checks | `planProblems(plan): string[]` in `src/plan.ts` (pure). Errors: dependency on an unknown id, on itself, a cycle (reported with its path), a malformed id; `touches` entries that are absolute, contain `..`, or are empty. **Overlap between two tasks' `touches` is not an error** — it only means they won't run side by side. |
| D5 | Where the checks run | Only when `parallel` is not `none` (D8). ① Planning sessions: `collect` in `loop-phase.ts` and `implement.ts` returns `undefined` on problems, and the retry message lists them. ② Task loop: each iteration's `load` is checked; problems → log each, exit 2 (same as a block), so a hand-edited PLAN.md cannot run with a broken graph. |
| D6 | Retry message may be dynamic | `requireArtifact`'s `requirement` accepts `string \| (() => string)`, evaluated after `collect`. Backward-compatible; lets the planning retry say "T-005 depends on unknown T-009" instead of the fixed text (F3). |
| D7 | Dependency order, serial | `next(plan, { deps })`. `deps: false` (at `none`) is today's function, unchanged. `deps: true`: the first task in file order that is not done and whose dependencies are all done. After D4 passes the graph is acyclic with known ids, so some not-done task is always ready — no deadlock path. `blocked` tasks stay selectable as today (F2). Both callers pass the flag. |
| D8 | `--parallel` is an init attribute | `init --parallel none\|low\|medium\|high`, stored as optional `parallel` in config.json; `none`/absent are the same and nothing is written for `none` (F4). Added to the init-attribute list, so `run --parallel` is a usage error (R4). The banner summary mentions it only when not `none`. |
| D9 | `--max-sessions` is a run flag, reserved | `run --max-sessions <N>`, integer ≥ 1, default 1, carried in `Opts`. Until MP.3 ships a scheduler, a value above 1 is a usage error ("concurrent execution is not supported yet"), as is any value above 1 with `parallel: none`. Help text states it counts concurrent sessions and is unrelated to `--agent`. |
| D10 | Planning guidance is intent | New intent section `## parallelism` (`IntentSection` member `parallelism`) with `### low` / `### medium` / `### high` subsections holding the §6.4 level semantics in the built-in `default.md`. No `### none` — absence renders nothing. |
| D11 | Injected into the planning templates only | `phase-plan.md` and `implement-plan.md` gain one guarded block: the level's guidance plus the field syntax, naming `depends:` and `touches:` verbatim as driver-parsed protocol strings (0035 D2). The block renders only when `parallel` is not `none`. Decompose gets nothing until subtask parallelism (R1). |
| D12 | Tier-1 markers | The field literals appear only inside the guarded block, so they cannot be unconditional `PROTOCOL_MARKERS` entries (an override for a `none` project needs none of them). Recorded as a known gap: an overlay of a planning template that drops the block silently loses the declarations at levels above `none`. Revisit if marker tables gain conditional entries. |

## 4. `none` stays byte-identical (0036 D17)

At `parallel: none` or absent: no config key written, no banner change, no
template block rendered, `next()` unchanged, no plan checks, `depends:` /
`touches:` lines (if a human writes them) preserved by `edit()` and otherwise
ignored. Every existing golden, incident-regression test and gate therefore
stays untouched; new behaviour is reachable only by an explicit `init
--parallel` choice. This also keeps the freeze-period invariant that an
existing project's behaviour does not change.

## 5. Steps

- [ ] S1 `plan.ts`: parse `depends`/`touches` (D1, D3), `planProblems` (D4), `next(plan, { deps })` (D7); unit tests (grammar, each error class, cycle path text, dependency order, `blocked` still selectable, `deps: false` identical to today).
- [ ] S2 Config + shell: optional `parallel` in `ProjectConfig` with validation (D8); `--parallel` on `init`, usage error on `run`; `--max-sessions` on `run` with the D9 rules; help text; banner line. Tests in both packages.
- [ ] S3 Intent: `parallelism` section (types + heading map + `default.md` text) (D10); interface-amendment note in the types header (0031 D4).
- [ ] S4 Templates: guarded block in `phase-plan.md` and `implement-plan.md` (D11); `renderPhasePlan` / `renderImplementPlan` take the level. New goldens for one planning render per template at a level above `none`; existing goldens unchanged.
- [ ] S5 Wiring: `requireArtifact` dynamic `requirement` (D6); planning `collect` runs `planProblems` (D5 ①); task loop check + exit 2 (D5 ②); `next` callers pass `deps`. Tests: planning retry names the problem; hand-edited cycle stops the loop; dependency order drives task selection in a scripted run.
- [ ] S6 Records: 0035 §3 rows for `depends:` / `touches:` (new English literals, no dual-read); shell-contract option list; package AGENTS.md navigation line; root plan MP.1 check-off + open question 15 rulings.

## 6. Verification

- `bun typecheck` clean and `bun test` green in `packages/auto-core` and `packages/auto`.
- Goldens: zero diff in existing files; only the new above-`none` planning goldens added.
- Dryrun under `init --parallel high` with `--max-sessions 1` completes (the D13 "plan for parallelism, run serially" configuration).
- Negative checks: `run --parallel low`, `run --max-sessions 2`, and a PLAN.md with a cycle each exit with a usage error / exit 2 and a message naming the cause.

## 7. Not done here

- Any concurrency: scheduler, worktrees, id allocation in the parent (MP.3).
- Per-unit state and module-level globals (MP.2, after MA).
- Subtask-level `Touches:` token and decompose-side guidance (after R1's task-level stage proves out).
- Disjointness *enforcement* (path-scoped staging, 0036 D6).
- Id namespace D3-A/B and configurable `destDir` (R5, MP.3).

<!-- auto: eof -->

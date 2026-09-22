# 0048 Round mechanism audit (M4.1)

This is root plan item M4.1 (`plans/AUTO_NEXT_REFACTOR_PLAN.md`, M4 "round loop, outermost, all human gates"). It audits the round mechanism as it stands after M3 (0047 layout, auto-next `b0f0b9ac8`). It has two jobs:

1. Inventory `currentRound` / `nextRound` / `roundRoot` / `establishRound` / `prevRoundDigest` and confirm whether they need changes or only tidy-up.
2. List every human intervention surface. That list includes the two points 0036 adds: the phase acceptance gate (D8) and the round-close disposability gate (D12).

This document is an audit, not a design. Where a finding needs a behavior change, it is routed to M4.2 or M4.3 (§5) and nothing is decided here. Line numbers are as of 2026-09-22; search by symbol if they drift.

## 1. Verdict

- **The round mechanism needs no functional change.** The five functions are small, derived and stateless. Each has a narrow set of callers (§2), and the M3 rewrite already moved them onto the new layout. `establishRound` no longer writes PLAN.md or symlinks. Round completion is derived from `phases.md` plus each phase's `done.md`.
- **Tidy-up done in this step (comments only, no behavior change):**
  - `src/knowledge.ts`: the extraction protocol's item ⑤ claimed that "the shell commits the round directory (stage=round-start)". No shell does this; see R1.
  - `src/phases/registry.ts`: `gate` claimed that "`verdict` stops the round (M3.3)". Nothing reads it; see R5.
- **Ten findings** (§3). Four of them are real gaps in the human-gate surface: R1, R5, R6 and R10. They are the substance of M4.2. One is translation left over for M4.3 (R4). The rest are edge cases to record, or to fix cheaply alongside M4.2.

## 2. Inventory

| Symbol | Where | Behavior | Callers | Verdict |
|---|---|---|---|---|
| `roundDirName` / `roundDir` | `src/docpaths.ts:51-58` | `R-NN` (two-digit pad, natural carry) / `docs/R-NN` | phases, knowledge, status, shell | unchanged |
| `currentRound` | `src/phases.ts:311` | Highest `docs/R-NN` present, at least 1. No persisted state. | `readPhases` (default round), `routePhase` (message), `prevRoundDigest`, `establishRound` (default), `status.ts`, `stats.ts:338` (round snapshot at load, drives the rollover), `conclusion.ts:69,160`, `attempt.ts:35` and `unit-commit.ts:105` (round key of the resolve ledger), `knowledge.ts:162`, shell (`phaseIndexPath`, `phasesLine`) | unchanged. Note: *any* `docs/R-NN` directory, even one a human created early, moves every one of these (R7). |
| `nextRound` | `src/phases.ts:323` | `currentRound + 1` if that round's directory exists, else `currentRound` | shell `continue` only (`packages/auto/src/index.ts:794`) | unchanged (edge case R2) |
| `roundRoot` | `src/phases.ts:353` | The round directory if it exists | `nextRound`, `prevRoundDigest` | unchanged |
| `establishRound` | `src/phases.ts:367` | ① mkdir `docs/R-NN` (idempotent) ② `syncPhaseIndex`: `phases.md` plus one `P<nn>-<type>/todo.md` per phase; on a changed preset it rewrites only the not-started tail ③ `AGENTS.md.bak` snapshot, written once | shell `init` (current round) and `continue` (`nextRound`). In every mode, including `m` (single `P01-implement`). | unchanged. It writes no round-level document of its own; `round.md` is M4.2's. |
| `prevRoundDigest` | `src/phases.ts:399` | Previous round's ① phase-directory index ② handover of its last completed phase (index order) ③ its `kb.md` files in full. Lenient: an unusable index only drops ②. | `planPhase` (`src/loop-phase.ts:103`), only while no phase of the current round is done | unchanged in shape; headings are Chinese (R4); injection gap (R3) |
| `roundKnowledgeDocs` | `src/phases.ts:382` | `P<nn>-knowledge/kb.md` paths of a round | `prevRoundDigest`, `knowledge.ts` | unchanged |
| `legacyLayoutProblem` | `src/phases.ts:337` | Root `PLAN.md`, or a non-empty `docs/R-NN/` without any `P<nn>-<type>/`, is a usage error | `runAll` preflight, shell `init`/`continue`/`status`/`run` | unchanged, but it constrains `round.md` (R7) |
| `priorKnowledgeDoc` | `src/docpaths.ts:62` | `docs/R-NN/prior-kb.md` at the round root | `extractPriorKnowledge` / `priorKnowledgeDigest`. The extractor has no caller in auto-core or `packages/auto`; only the migrate shell calls it (D9). | unchanged (see R7 for the ordering constraint on the migrate shell) |

**Round lifecycle as it stands.**

1. `init`, or `continue` after a fully complete round, establishes `docs/R-NN/`.
2. **A human commits** the result (R1).
3. `run` loops over the phases: plan → execute → handover → `completePhase`.
4. Once every phase has `done.md`, the route is `complete`. `run` prints `✓ all phases complete` plus the resolve and round-complete lines, then exits 0. This happens again on every later `run`.
5. Nothing is written or committed at round close (R6). `continue` is the only transition to the next round, and its precheck is the only thing that stands in for a round gate.

In the no-phase mode (`phases = "m"`), P01 never completes and `continue` refuses, so the round mechanism is inert. Any round gate is out of scope for `m`.

## 3. Findings

**R1 — The round-start commit is an implicit, mandatory human step.** `init`/`continue` write `config.json`, `opencode.json`, the agent contract, the AGENTS.md block, `.gitignore`, optionally `brief.md`, and the round directory. None of this is committed. Only the index and phase `todo.md` count as driver state (`DRIVER_STATE`, `src/git.ts:125`); `AGENTS.md.bak`, the config and the rest do not. `run`'s start clean gate (`loop-preflight.ts:174`) therefore blocks until a human commits. The e2e tests do exactly that ("round baseline", `packages/auto/test/e2e.test.ts:201`). The knowledge extractor's comment claimed a shell commit that does not exist (fixed, §1). *Route: M4.2.* Either name it as the round-start gate (the human reviews the round setup, and the clean-gate message says so), or have `init`/`continue` commit it with `Auto-Stage: round-start`. The first fits "outermost loop = human gates".

**R2 — An interrupted `continue` has no obvious recovery.** A crash after `mkdir docs/R-(N+1)` but before `phases.md` is written leaves an empty directory. Git cannot see it, so the tree is clean, and `legacyLayoutProblem` deliberately ignores it. `currentRound` is now N+1, so:
- `continue` reads R-(N+1), finds no index, and refuses ("previous round … index is missing");
- `run` says "establish the round with init (or continue)";
- a plain `init` resets the config to defaults;
- only `init --amend`, or removing the directory, recovers.

In practice only a crash triggers this: `syncPhaseIndex` cannot hit its rewrite refusals on a fresh round. *Route: M4.2, cheap fix.* The `continue` precheck could treat a current round with an empty directory as an in-flight continuation and re-run `establishRound` on it. Otherwise, at least make the message name `init --amend`.

**R3 — `prevRoundDigest` reaches only a planning session that runs before any phase of the round is done.** With a type-id list that starts with a task-less phase (`knowledge` first; legal since M3.6, "order arbitrary, must contain implement"), the knowledge session runs first. Then `done.size = 1`, and the digest is never injected anywhere. The knowledge session never receives it either. *Route: record; M4.2 may fold it in* (key on "first planning session of the round" rather than on "no phase done").

**R4 — Chinese AI-facing inline strings survived M3.8.** M3.8 translated the `phase-plan.md` slot headings, but not the text injected into them:
- `prevRoundDigest`'s three headings (`上一轮…`, `src/phases.ts:418-425`);
- the `(无交接文档)` placeholder in `planPhase`'s handover digest (`src/loop-phase.ts:93`).

Neither is a registered protocol string (0035 has no entry; no parser reads them), so this is a plain translation. *Route: M4.3* (it changes prompt output, so it goes with the golden regeneration).

**R5 — Declared phase gates have no reader.**
- `PhaseTypeEntry.gate: "verdict"` is set on `acceptance` and settable by custom types (`Gate: verdict`). 0047 §5 says "FAIL stops the round", but nothing reads `verdict.md`. The only live FAIL stop is the task-level `Result: FAIL` in `docs/T-NNN/report.md` (`src/runner.ts:41`, `src/wrapup.ts`).
- The `phaseAcceptance` role and path exist (`acceptance.md`, M2.3), but the 0036 D8 gate was left unimplemented at M3.3, pending open question 15 (marker literal, and whether the gate is on by default).
- `phaseArtifacts` have no shape check. Only knowledge's `kb.md` is read.

All three belong to the same precondition slot: inside `completePhase`, the single completion path shared by handover and interruption recovery (0047 §11 M3.3 note; 0036 D8 constraint). *Route: M4.2* ("converge the human-gate surface" is literally this), after the user rules on open question 15 for the marker literal, the default, and whether the verdict gate is its automatic twin.

**R6 — There is no round-close step.** The `complete` route is re-derived on every run and writes nothing. The 0036 D12 disposability gate (whole-tree P1 prohibition scan plus the target's own build, plus the restatement check) has two possible anchors:
- (a) the `complete` route, which reports on every run, idempotently;
- (b) the `continue` precheck, which enforces, because it is the human's act of closing the round and advancing.

*Route: M4.2.* Suggested shape, mirroring `completePhase`'s single-exit discipline: one pure `roundCloseProblems(dir, round)` evaluated at both anchors, reporting at (a) and blocking at (b). No new state, and `routePhase` stays a pure function of the files. Hard gate or reported check is open question 15-⑦ (0036 §11-9).

**R7 — `docs/R-NN/round.md` has constraints the M4.2 design must honor.**
- **Role.** By path shape it would classify as `artifact` (`PROCESS_DOCS`, `src/document/roles.ts`): terminator scan on, and treated as AI-produced. But it is human-written. It needs its own role, or an extension of `phaseAcceptance`'s policy (`eofScan: false, process: true`).
- **Authoring order.** A human who creates `docs/R-(N+1)/round.md` *before* `continue` trips two things at once. `legacyLayoutProblem` sees a non-empty round directory with no phase directories and reports "legacy layout". And `currentRound` jumps to N+1, so the `continue` precheck reads an index that does not exist. Either `round.md` is written only after the round is established, or both checks must exempt it.
- **Migrate shell.** The same ordering applies to `prior-kb.md` / `temp-kb.md` at the round root. They must be written after `establishRound` (D9: record for M6.2).

**R8 — The phase `todo.md` carries no goal or exit criteria.** 0047 §11 (M3.3) deliberately left `Goal`/`Exit` unwritten because nothing supplies them. `round.md` is the intended supplier. *Route: M4.2* decides whether phase `todo.md` quotes `round.md`, or planning reads `round.md` directly (it already reads `brief.md` directly, which argues for the latter).

**R9 — Only the current round is visible.** `status` and the run banner show only the current round, and nothing summarizes past rounds apart from the next round's injected digest. No action; recorded because M4.2's review surface may want it.

**R10 — There is no plan-review pause.** The M4.1 brief names "round plan review" as a human gate, but no pause sits between a phase's planning session and its first task:
- `stepPause("phase")` fires *after* the handover (`src/loop-phase.ts:317`), which is before the next phase's planning, not after it;
- `stepPause("task")` fires after the first task has already run;
- `/exit` takes effect at the next step boundary, which is also after the first task.

So `tasks.md` and the `T-NNN/todo.md` files can only be reviewed by killing the run, or after the fact. The handover is likewise reviewable only after `completePhase` has already run; rejecting it means a manual `done.md` → `todo.md` rename. *Route: M4.2.* Candidate: at `OPENCODE_AUTO_STEP ≥ phase`, also pause after the phase-plan commit. This reuses the existing mechanism, which honors 0036 D8's "no new pause mechanism". The acceptance gate (R5) is the durable counterpart for the handover side.

## 4. Human intervention surface (complete list)

Kinds: **gate** = the run cannot proceed without it; **pause** = optional hold at a boundary; **steer** = input into a live session; **edit** = a file the human owns and the driver reads; **recovery** = the action the human takes after a blocked exit; **view** = read-only.

| # | Surface | Kind | Level | Mechanism / where | Durable? | M4.2 note |
|---|---|---|---|---|---|---|
| H1 | `init` | gate | project | Constitution frozen into `config.json`; prefix guard against completed phases | yes (config) | — |
| H2 | Round-start commit | gate (implicit) | round | `run` start clean gate (R1) | yes (git) | name it, or commit it (R1) |
| H3 | `continue` | gate | round | Precheck: phased project, index complete, no completed phase outside `phases`; identity options fixed | yes | anchor of the D12 disposability gate (R6); R2 recovery |
| H4 | `brief.md` (`init -p` or hand edit) | edit | project | Read by every planning session | yes | the round-level goal moves to `round.md` (R7/R8) |
| H5 | `round.md` | edit | round | **does not exist yet** | — | M4.2 lands here: goal, acceptance criteria, release criteria as an intent-pack section plus the per-round file |
| H6 | Project overlays: `.opencode/auto/phases/` (custom types), `prompts/` (template overrides), modes / intent packs, `config.json` | edit | project | Loaded at run start; strict validation | yes | the release-criteria section goes into the intent pack |
| H7 | Phase plan review (`tasks.md`, `docs/T-NNN/todo.md`) | **missing pause** | phase | — (R10) | yes (files) | add a plan-review pause at step ≥ phase |
| H8 | Phase-exit acceptance (`acceptance.md`) | **missing gate** | phase | Role exists; no reader (R5, 0036 D8) | — | marker literal and default: open question 15 |
| H9 | Acceptance-phase verdict (`verdict.md`, `Gate: verdict`) | **declared gate, no reader** | phase | (R5) | — | wire it in `completePhase` together with H8 |
| H10 | Round-close disposability gate (0036 D12) | **missing gate** | round | — (R6) | — | `roundCloseProblems` at `complete` and `continue`; hardness = open question 15-⑦ |
| H11 | `--step phase\|task\|subtask` / `OPENCODE_AUTO_STEP` | pause | all | `stepPause` after the handover, the task commit, the subtask commit | no | add the post-plan point (H7) |
| H12 | `--wait-between` | pause | task | `waitBetweenTasks` before every task but the first | no | — |
| H13 | `--interactive` lines, `/exit`, `/failback` | steer | session | Lines into the live session; `/exit` at the next step boundary; `/failback` at the next safe boundary | **no** (run log only, 0036 F15) | optional: append steered lines to `acceptance.md` (0036 §6.3) |
| H14 | `--wait-answer` | steer | session | `askHuman` for questions and permissions; on timeout, auto-answer / auto-resolve / the `--permission` preset | resolves are recorded in the ledger | — |
| H15 | Blocked exits (exit 2) | recovery | unit | Dirty tree at run or unit start; implicit session block; task `Result: FAIL`; commit failure; unit close-out violation (external commit); knowledge extraction dirty; subtask dependency problems | yes (log + git) | — |
| H16 | Environment / usage errors (exit 1) | recovery | project | Invalid phase or task index, phase/task dependency problems, legacy layout, unknown model-route key, etc. | — | — |
| H17 | Manual rollback | recovery | phase / task | Rename `done.md` → `todo.md` (phase redo; knowledge redo also deletes `kb.md`); edit `phases.md` (a legal data edit); append tasks to `tasks.md` (`m` mode, FAIL fix tasks) | yes | the rejection path of H8 must resolve to exactly this rename |
| H18 | AGENTS.md > 150 lines | advisory | phase | Note in the handover commit and the terminal | yes (commit subject) | — |
| H19 | `status`, `check`, run log, ■ phase/round close lines, resolve highlights, stats | view | all | Read-only | — | round history view (R9) |

Protected during a run (read-only, restored at the end): `CURRENT.md`, `opencode.json`, the project config. `tasks.md` is deliberately not protected (M3.4).

## 5. Routing

| Finding | Goes to | Needs a user ruling? |
|---|---|---|
| R1 round-start commit | M4.2 | yes: human gate (recommended) or driver commit |
| R2 interrupted `continue` | M4.2 (small fix) | no |
| R3 digest injection gap | M4.2 (optional) | no |
| R4 Chinese inline strings | M4.3 | no |
| R5 phase gates without a reader (H8/H9) | M4.2 | yes: open question 15 (marker literal, default) |
| R6 round-close gate (H10) | M4.2 | yes: open question 15-⑦ (hard gate or reported) |
| R7 `round.md` role and authoring order | M4.2 | no (design constraint) |
| R7 migrate shell `prior-kb.md` ordering | M6.2 | no (D9) |
| R8 phase goal/exit source | M4.2 | no |
| R9 round history view | — (recorded) | no |
| R10 plan-review pause (H7) | M4.2 | no (reuses `stepPause`) |

**Not in scope.** Mid-phase steering durability (H13) stays optional per 0036 §6.3. Parallelism's effect on round gates belongs to MP.

## 6. Verification

Comment-only changes to two source files. `packages/auto-core`: typecheck clean, 1079 pass / 0 fail (unchanged from M3.8).

## 7. M4.3 follow-up (2026-09-22)

R4 is closed. `prevRoundDigest`'s three headings and `planPhase`'s `(no handover document)` placeholder are now English. No golden renders them: they arrive as slot values, so only the test literals changed.

With the user's agreement, M4.3 also cleared the Chinese that no later milestone owned. It treats M4.3 as the last translation step before the final merge-back.
- The agent contract `templates/.opencode/agent/auto.md` is translated with its meaning unchanged (its two goldens are regenerated with the same line count). `templates/README.md` is translated too.
- The driver's inline AI-facing messages are English: the question auto-answer (`unit-commit.ts`), the truncation steer (`watch.ts`), and the probe prompt and retry/recovery/failover notes (`session.ts`). Their wording follows the already-English `question-rule` partial and `COMMIT_CLARIFY`.
- Human-facing text that M0.6 missed is English: refcheck logs and the `.auto/invalid-refs.md` header (the list's dedup key format is unchanged, so listed entries are not warned again), and the template engine's parse errors.
- Some Chinese stays on purpose: patterns that recognise Chinese input (`check.ts` wording heuristics, the `permission` regex in `watch.ts`, and the approval answers in `session-api.ts`). Chinese comments are also left in place, per the M0.6 translate-on-touch rule; the comments next to the changed lines were translated.

Verification: typecheck is clean in both packages. `packages/auto-core` 1095 pass / 0 fail; `packages/auto` 54 pass / 4 skip / 0 fail.

<!-- auto: eof -->

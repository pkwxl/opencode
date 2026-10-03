# Commit boundary design: git commits as the completion condition for tasks/subtasks/hidden tasks

> Status: approved for implementation 2026-09-14. The factual baseline = the "persisted and committed" protocol of prior-knowledge
> extraction (6c3b3893b, docs/knowledge.ts §③④), generalized into a universal completion check for the whole pipeline. This document is that change's
> design baseline and decision record; new sessions resume from the "step checklist".

## 1. Goals and principles (user-confirmed)

1. **Done ⟺ persisted and committed**: a task/subtask/hidden task (pseudo-task/bypass session) that has modified
   anything Git tracks counts as complete only once a git commit has been formed. Unified-commit failure → **block and halt (exit code 2),
   pending manual attention**, no longer "warn without blocking".
2. **Clean baseline at unit start**: before each execution unit starts, confirm the working tree is clean — all information the unit depends on
   is fixed by the previous commit or produced during the unit itself. Dirty state not attributable to the driver → block and hand over to a human.
3. **SHA baseline and repo alignment**: at unit start, record the HEAD SHA of every repository (root + nested); at close-out,
   ① the working tree must be clean; ② every commit in the `基线..HEAD` (baseline..HEAD) range must carry the `Auto-Stage:` trailer
   (i.e. be a driver commit) — any commit without the trailer = outside interference, block; ③ the root commit's
   `Auto-Nested` line covers **all** nested repositories (recording the new SHA for those with commits this round, the baseline SHA for those without),
   so any root commit can align cross-repository state.
4. **No tracked changes → no empty commit** (commitTree skips repositories with no changes; status quo kept).
5. **git commits are the factual boundary of logical isolation between tasks** (audit and rollback granularity = session/unit).
6. Switch semantics: under `--commit false` / dryrun / non-git environments the gate does not take effect at all (same caliber as prior-knowledge
   ③④); the `Auto-Stage` trailer doubles as the machine criterion for "driver commits".

## 2. Terminology

- **Unit**: a task (runTask, the full pipeline) / subtask (runSubtask, including fix checklist items injected by
  review) / standalone hidden tasks (phase-plan, phase-handover,
  knowledge, prior-knowledge, numbering recovery, final-plan generation — declared via `requireArtifact`
  through `spec.unitStart`). The acceptance-machinery sessions inside a task (judge/review/planfix/script
  generation) are not independent units: their commit obligations are covered by the "per-session commit gate"; the startup clean gate does not
  apply (the task unit already started at their outer layer).

## 3. Mechanism

### 3.1 git.ts foundation layer (P1)

| API | Semantics |
|---|---|
| `commitTree(...) → CommitResult` | returns `{ok, failures[{rel,error}]}` (the original signature only gains a return value, backward compatible for shell callers); `Auto-Nested` extended to the full set of nested repositories |
| `unitBaseline(dir)` | per-repository HEAD short SHA (an empty repository records the empty string) |
| `unitViolations(dir, baseline)` | close-out check: dirty working tree / commits without `Auto-Stage:` present in `基线..HEAD` → violation list |
| `beginUnit(dir, opts, task)` | unit-start gate: clean → record the baseline; dirty state consisting entirely of driver-exclusive state files (`PLAN.md`/`CURRENT.md`, booked from a previous commit failure) → `carryover` supplementary-commit self-healing; otherwise return dirty. The whitelist is resolved on the spot via `driverStateFiles(dir)` (see the symlink entry in §6) |
| `commitPending(dir, task, info, files)` | hidden task ③: artifact already in the uncommitted list → a supplementary commit completes it; otherwise "clean" |

### 3.2 Post-session commit gate (P2)

- `afterSession(..., baseline?)` returns `SessionCommit` (`ok` / `failed{question}`);
  at each of the runner's 10 call sites, failure → return blocked (the question goes into PLAN.md; loop's interrupted
  commit naturally constitutes one retry; only if it still fails is the dirty scene left for a human).
- `requireArtifact` gains `spec.unitStart`: the `beginUnit` gate at the entry (recovery reuse of
  resumedSession is exempt from the clean check — the dirty state is the unit's own WIP, and the baseline is still recorded); `spec.commit`
  failure → blocked (no retry with feedback: reopening a session for a git failure is pointless).
- `Outcome` gains a `dirty` variant (`{type:"dirty"; files}`): the dedicated exit for clean-gate failure,
  **writing nothing to PLAN.md and making no interrupted sweep commit** — the authority over git state belongs to a human. The existing
  `Outcome & {type:"blocked"}` union is uniformly renamed `UnitStop`.

### 3.3 loop hook points (P3)

- run startup: the clean gate before housekeeping (dirty state left by a human → block with exit 2, replacing the old
  "will be absorbed" warning); after the ensurePointer/ensureGitignore rewrite-backs, a single `housekeeping`
  close-out commit.
- Task unit: runTaskLoop calls `beginUnit` after taking the task (an active progress record = recovery resume, exempt from
  clean, baseline kept); a done-terminal-state commit failure → exit 2; after the commit, the `unitViolations` close-out.
- Subtask unit: `beginUnit` at the runSubtask entry (recovery resume of this subtask is exempt from clean).
- `final-plan` commit after `appendFinalTask`; `review-fix` commit after `injectFix` injection.
- Phase handover `phase-transition` commit failure → exit 2 (the existing "handover-interruption recovery" fallback is unchanged).

### 3.4 Hidden-task ③④ generalization (P4)

Unified protocol for idempotent entries (prior-knowledge's existing semantics generalized; the helper `commitPending`):

- **③ Artifact already persisted and in the uncommitted list → complete once the driver supplementary-commits it**: knowledge
  (migration-kb.md), phase-handover (skipping duplicate distillation in passing when the handover documents are all present),
  phase-plan (covered via beginUnit's carryover self-healing), final proposal (covered via the append commit).
- **④ Artifact missing while the working tree is dirty → dirty block, hand to a human**: extractKnowledge gains a dirty return
  (an exception to the k phase's original "failure only warns" for dirty); numbering's artifact `.auto/next-task` is
  gitignored, naturally exempt from ③④.

## 4. Confirmed decisions

| # | Decision |
|---|---|
| D1 | any commit failure blocks and halts pending manual attention (no automatic retry; the interrupted commit on the blocked path constitutes the natural single retry) |
| D2 | the gate is attached at every post-session commit point, not just the completion-check boundary |
| D3 | ③ supplementary commit generalized to all standalone hidden tasks; ④ dirty block generalized in step |
| D4 | Auto-Nested records the full set of nested repositories + external-commit detection (`Auto-Stage` trailer criterion) |
| D5 | run startup hitting dirty state left by a human: block (no longer absorbed into driver commits); driver-exclusive state files (PLAN.md/CURRENT.md) left behind → carryover self-healing supplementary commit |
| D6 | session-recovery fidelity (the high bar of a resumable session id / at most one "continue" sentence / stash-rollback-and-rerun when fidelity cannot be preserved) is a **separate follow-up project**; this round only delivers the design document plans/0022-session-recovery-fidelity-design.md (with this mechanism's unit clean baseline as the rollback anchor) |
| D7 | **`--commit false` retired (2026-09-15, user decision)**: the commits-off tier conflicts with this mechanism and its downstream designs — the completion check, the unit clean gate, the SHA baseline, and recovery fidelity's rollback anchor all presuppose "commits always on"; under the off tier they idle wholesale, and every new mechanism would have to carry an extra "gate off → idles" branch. This round does an **entry-layer soft retirement**: the CLI's `--commit false` (and the old alias `none`) appearing at all is a usage error with exit 1 (`--commit true` is still accepted, equivalent to the default); `.opencode/auto/config.json` reading `commit: false` fails strictly as a bad file (no silent semantic rewrite); the code-side `opts.commit !== false` gate stays for now, permanently unreachable from then on, and is left, together with the unit tests that call core functions directly with `{ commit: false }`, to a later cleanup task. From then on the gate is inactive only under dryrun and non-git environments. |

## 5. Step checklist

- [x] P0 design document (this file)
- [x] P1 git.ts foundation layer + test/git.test.ts (commitTree failure reporting / Auto-Nested full coverage / baseline and close-out checks / beginUnit / commitPending)
- [x] P2 afterSession / call sites / requireArtifact unit protocol (spec.unitStart) + test/runner.test.ts
- [x] P3 loop hook points (run-startup clean gate + housekeeping close-out, task/subtask baselines, done/interrupted/transition gates, appendFinalTask/injectFix commits)
- [x] P4 hidden-task ③④ generalization (knowledge/phase-handover direct, phase-plan via carryover, final via the append commit) + prior-knowledge refactor reusing commitPending + test/knowledge.test.ts
- [x] P5 documentation sync (behavior/structure/AGENTS (package + root) / auto shell README / session-recovery-fidelity design)
- [x] P6 full verification (typecheck + bun test 705 cases all green (16 new); auto shell typecheck/test 53-case regression passing)

## 6. Risks and boundaries

- **Dirty-state exemption for recovery resume**: with an active record + session reuse/handover resume, the working tree carries the unit's
  own progress, so no clean gate is applied (otherwise every recovery path would break); in that scenario outside changes and our own changes are indistinguishable,
  backstopped by the close-out trailer check (at the commit level), while at the working-tree level the existing "absorb" semantics are kept — a known
  limitation, recorded here. **2026-09-15 addendum: on the test-handover (--handover-test) path, this limitation is resolved**
  — the handover point makes two driver commits (pin + confirm, see plans/0023-test-handover-early-design.md D3),
  the new session faces a clean working tree, and the "outside vs own changes indistinguishable" window no longer exists; the other recovery paths are unchanged.

- **Multiple driver commits within a unit are legal**: `unitViolations` only checks that every commit in the baseline..HEAD range
  carries the `Auto-Stage` trailer, **with no limit on the count**. Test handover inserts two commits at each handoff point inside the unit
  (`<单元> handoff-<n>-pin` to pin / `<单元> handoff-<n>` to confirm, where 单元 = the unit), and the close-out check passes as usual;
  `rollbackUnit` discards them too when rolling back to the unit baseline — the semantics being "redo the whole unit".
- **Residue from reverting judge overreach**: when the revert of the judge session's unauthorized PLAN.md edits happens after the commit, the residue
  makes the next unit's startup gate report dirty — treated as an exception scene handed to a human, consistent with the existing stance that "overreach is an exception".
- **Empty commits forbidden**: gate self-healing/supplementary commits all go through commitTree, which skips unchanged repositories automatically and produces no empty commits.
- **The driver-exclusive state-file whitelist must resolve symlinks (fixed 2026-09-15)**: under the round-dedicated-directory scheme,
  the root `PLAN.md` is a symlink pointing to `docs/R-NN/PLAN.md`, and `plan.ts`'s atomic write goes through `realpath`
  to land on the link target, so the dirty path reported by `changedFiles` is `docs/R-NN/PLAN.md`, not `PLAN.md`.
  The original literal list `["PLAN.md", "CURRENT.md"]` therefore fails to match, and the carryover self-healing promised by D5
  **fails wholesale** under the phase-based layout (auto-migrate default `phases: "admtvk"`): the moment `loop.ts`'s interruption recovery
  (`resetInProgress` + the progress record's precise-recovery placement) writes PLAN.md, the first task unit's startup is judged dirty
  and exits 2; a re-run cannot even get past the run-startup gate. Two fixes: ① `beginUnit` switched to resolving via `driverStateFiles(dir)`
  on the spot, bringing both the link name and the link target into the whitelist; ② `loop.ts` moved the interruption recovery's two disk writes up to after the startup
  clean gate and before the pre-run baseline close-out commit (`housekeeping`), so that commit books them naturally, sparing
  a wasted carryover commit on every run. Under dryrun the whole stretch is skipped (equivalent to the pre-move position after dryrun's early return).

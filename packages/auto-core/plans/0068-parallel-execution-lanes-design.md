# 0068 Parallel execution — lanes, per-unit worktrees and the MP.3 scheduler

> **Status: implementation plan.** Written 2026-10-01 on the `auto-core`
> branch as the detailed design 0036 §6.4 called for, updated against the
> architecture as it stands after 0047 (unit layout), 0053 (lifecycle), 0055
> (registry), 0059 (adaptive split), 0061 (driver consolidation) and against
> the headless-service direction of `plans/0067`. It absorbs the deferred
> "MP.3" list of `plans/0046` §7, the ruled-but-unbuilt D1/D3 of
> `plans/0051` (which is retired into this document), and the item 0061 R4
> queued "behind its own design for per-unit worktrees" — this is that
> design. Everything decision-level here is **proposed for one final user
> pass** (§11) — except **D21, ruled 2026-10-01 in discussion**; the stage
> list §7 is the implementation order once §11 is settled. Retires per the plans/ convention when the last stage lands or a
> decision is explicitly rejected.

## 1. Scope

**In.** Intra-run parallel execution (0036 N4 / tier 3): within one `run`,
execute several units concurrently by isolating each schedulable unit in its
own git worktree driven by its own worker process, and merging the work back
under the existing commit invariants. The scheduler that decides what runs
when, the state ownership between parent and workers, recovery, and the
observability surface.

**Out (and why).**

- *Cross-run / cross-topic parallelism* (0036 tier 2) — already possible
  today by pointing separate runs at separate directories; unchanged here.
- *The id namespace* (0036 D3-A/B). It existed to make **independently
  issued** ids collision-free at merge. Intra-run parallelism never has two
  issuers: id allocation (`--auto-number`, planning, task-add) is
  parent-exclusive (D6), so `.auto/next-task` stays the parent's singleton
  and D3 remains retired until topic merges become a real requirement.
- *Path-scoped staging* (0036 D6). That was the enabling step for the
  same-tree isolation model (D15-ii), which is not the model chosen here
  (D1). `git add -A` stays; disjointness stays a **scheduling** input, not a
  staging mechanism.
- *The phase acceptance gate and P1* (0036 N3/D8/D9/D12) — landed in 0045
  and 0049. Not reopened.
- *Anything about the REST/SSE/Web surface itself* (0067). This plan only
  keeps the lane shapes composable with it (§6.7).

### What already landed (do not rebuild)

0036's declaration half shipped as **MP.1** (0046) and the unit layout
(0047 M3.1/M3.5): `Depends:` / `Touches:` field blocks on every unit,
`unitProblems` graph checks on load and at collect, `nextReady` selection,
the constitutional `parallel` key (`low|medium|high`, absent = none) with the
`## parallelism` intent subsections injected into the three planning
templates, and `--max-sessions` reserved (0046 D9: every value but 1 exits 1
at preflight, `src/loop-preflight.ts:262-265`). 0059 made auto's split
streams structurally parallel-ready (disjoint `Artifacts:`, `Depends:`
ordering, `split`/`leadUsed` in `.auto/units.json`) while running them
strictly one at a time (`src/runner.ts:474-618`). Nothing executional exists:
no scheduler, no worktree use anywhere in the codebase, one live session per
driver process by construction.

## 2. Fact baseline

All paths relative to `packages/auto-core/`; verified 2026-10-01.

### Selection and execution are serial by structure

- **F1** The task loop is `for(;;) loadPlan → next(plan) → runTask`
  (`src/loop-task.ts:95-99`); `next` builds a done-set and calls `nextReady`
  over the task declarations (`src/tasks.ts:484-492`). `nextReady` is a pure
  function of done flags — "the first unit in index order that is not done
  and whose effective prerequisites are all done" (`src/document/unit.ts:300-303`),
  with G3 defaults (missing `Depends` = previous sibling = serial,
  `Depends: none` = root). **There is no in-flight set**: `unitProblems`
  explicitly notes "overlapping `Touches` … only means two units will not run
  side by side" (`src/document/unit.ts:239-241`), and `declOf` drops
  `touches` when mapping tasks (`src/tasks.ts:443`). `src/split.ts:169`
  already words it: `Touches:` is "read by the dependency checks and, later,
  by a parallel scheduler".
- **F2** The subtask/stream loop is the same shape: `nextChecklistIndex`
  over the checklist (`src/runner.ts:474-618`, selection at `:508`), one
  `runSubtask` awaited at a time (`:550`). The streams of a taken split are
  re-entered through this loop, each forking the lead session
  (`leadForkBase`, `src/execute.ts:493-509`). `src/execute.ts:590` records
  the known serial assumption: all streams of a task share one
  `handoff.md`, and "a per-stream document would need a new document role
  and recovery path, worth it only once streams run side by side".
- **F3** One `SessionChain` per task, created in `runTask`
  (`src/runner.ts:109`), threaded by reference through every stage; all
  field writes live in `src/chain-transitions.ts` behind a write-ratchet
  test. The chain is inherently single-dispatcher (`pending`/`id`/`note`
  semantics assume one session in flight). Chains never cross tasks, and no
  session dependency crosses a task boundary — the fork bases a task uses
  are established within it (`ensureForkBase`, `src/session.ts:69-162`).
- **F4** No two agent sessions are ever concurrently *driven*. The pool
  keeps several agent hosts alive (`src/agent-pool.ts:197-299`) but
  dispatches are serial; transient one-shot sessions (recovery probe,
  classifier) never overlap an active turn. `OPENCODE_AUTO_HANDOVER_CONCURRENT`
  is retired (`src/switches.ts:70`).

### Commit boundary

- **F5** `beginUnit` gates a unit start on a clean tree (driver-state
  leftovers self-heal via a carryover commit, anything else blocks;
  `src/git.ts:537-551`); `commitTree` stages `git add -A -- .` per repo
  root, inner-nested-first, with `Auto-Task:` / `Auto-Stage:` / `Auto-Nested:`
  trailers (`src/git.ts:97-131`); close-out validates via `unitViolations`
  that `baseline..HEAD` contains only `Auto-Stage:` commits and the tree is
  clean (`src/git.ts:237-253`, `foreignCommits` at `:388-394`); rollback is
  stash + `reset --soft` to the unit baseline (`src/git.ts:451-524`).
  All primitives take `dir` explicitly; the `GitOps` seam passes it per
  call (`src/git.ts:608-628`, `src/git-ops.ts:114-124`).
- **F6** `git worktree` is used nowhere (full subcommand inventory has no
  merge/rebase either; the only revert is a printed hint,
  `src/close.ts:290`). `repoRoots`' walk adds any directory containing an
  entry named `.git` — **file or directory** — as a nested repo
  (`src/git.ts:638-652`, the entry test at `:647`), so a linked worktree
  parked inside the target
  tree would be misclassified and separately committed. The walk skips only
  `.git` and `node_modules`.
- **F7** The files a lane worktree needs but git does not carry are all
  untracked/gitignored local-only state: `opencode.json`, `AGENTS.md`,
  `.opencode/agent/<contract>.md`, `.opencode/auto/config.json`,
  `.opencode/auto/models.json`, prompt/mode/intent overlays under
  `.opencode/auto/` (`src/gitignore.ts:28`). A fresh `git worktree add`
  contains none of them, and preflight hard-requires the agent contract
  (`src/loop-preflight.ts:272-288`). `protect()`/`unprotect()` chmod this
  set per directory (`src/protect.ts:25-41`) — per-process module flag,
  correct again once each lane is its own process.

### State

- **F8** `.auto/progress.json` is one flat record
  (`Progress = {task, session?, at, active, phase?, baseline?, model?,
  agent?, used?}`, `src/resume.ts:98-141`); the resume gate's
  `unitReruns` is a single-cursor check ("the record's ordinal must be
  exactly the one the loop would run next", `src/resume-gate.ts:46-84`).
  Hardwired to one in-flight unit **per directory** — which per-lane
  worktrees make true again rather than false.
- **F9** `.auto/units.json` holds `{tasks: Record<id, Runtime>}` with
  `Runtime = {status?, attempts?, forkBase?, split?, leadUsed?}`
  (`src/tasks.ts:276-277`); writes are queued through a module-level
  promise chain with atomic rename (`src/tasks.ts:338-351`) — safe for
  interleaved per-id updates from one process; `resetInProgress` at
  preflight clears all `in_progress` entries (`src/loop-preflight.ts:377-380`,
  `src/tasks.ts:527-538`). No `worktree` field exists (0051 D3 ruled one;
  unbuilt).
- **F10** Other singletons, all keyed per directory: `.auto/handover.json`
  (one in-flight test handover per dir, `src/handover.ts:25-97`),
  `.auto/stats.json` ("two concurrent runs in the same directory are
  unsupported", `src/stats.ts:25-27`; at most one open session segment),
  `.auto/windows.json` (per-account learned quota resets, serialized
  writes, `src/quota-windows.ts:162-174`), `.auto/next-task` (unserialized
  read-then-write, `src/numbering.ts:79-85`), `.auto/run.lock`
  (pid+host, re-entrant per process, stale-pid probe, `src/lock.ts`),
  `.auto/logs/run-*.log` and the run-events journal
  (`src/engine/events.ts`). `tmp/test.sh` is a single well-known slot per
  tree (`src/testrun.ts:335-357`).
- **F11** `RunServices = {clock, router, control, git}` is built once by
  preflight and installed once per process — "one run per process is an
  existing invariant" (`src/services.ts:31-38`, `SERVICE_ENTRIES`
  allowlist at `:111-119`); the router's mutable run state (down marks,
  failback order, key rings, step claims, classifier budget) and the
  control service's `/exit` request are run-wide singletons
  (`src/router.ts:319-376`, `src/exit.ts:50-103`). Process-per-lane makes
  each of these per-lane again with **zero** core surgery.

### Rulings this design must uphold

- **F12** 0036 D15 recommended per-agent git worktrees ("a failure becomes
  a merge conflict instead of a corrupted tree"), with id allocation kept
  central to the parent. **0051 D1 ruled the process model**: "(a) one
  child `run` process per agent, each in its own worktree". **0051 D3
  ruled** the in-flight registry shape: a `worktree` field on
  `.auto/units.json` entries. **0061 R4 queued** parallel execution
  "behind its own design for per-unit worktrees. A unit's commit takes the
  whole tree, and concurrent units in one worktree would take each other's
  half-written files; that is a file-contract change, not a scheduling
  one."
- **F13** 0067's target topology is a daemon supervising one child worker
  process per run, each worker calling `runAll(dir, opts)`, with a
  structured event bus to come (`RunServices` gains an emitter; lane-level
  state must be carried by events, not terminal-text scraping) and a
  persistent question queue. "Workers are cattle, not pets": a killed
  worker's next run recovers precisely from disk.
- **F14** The shell contract: the core never imports a shell; shells are
  CLI bins reached through `setShellProfile` / `registerTemplate` /
  `registerAgentAdapter` / parameter passing (`docs/shell-contract.md` §B–C,
  §E). Any "re-invoke the CLI" capability the parent needs must be an
  injected extension point, not a core-side shell name.

## 3. Terminology

| English | 中文 | Meaning here |
|---|---|---|
| **lane** | 泳道 | One schedulable unit executing in isolation: a worker child process + its worktree + its branch. A lane is *taken* while in flight and *landed* when merged back. |
| **park** | 工作树停放区 | `.auto/worktrees/` — where lane worktrees live. |
| **landing** | 合入 | The parent's serialized merge of a lane's branch into the main tree's branch. Distinct from *merge back* (合回), which is this repository's branch flow into `auto-core` and never means a target-repo operation. |
| **lane report** | 泳道报告 | `.auto/lane.json` in the worktree: the structured outcome the parent reads at lane exit. |
| **parent** | 主进程 / 父进程 | The `run` process in the target directory: preflight, phase loop, planning sessions, scheduler, landings, phase/round close. |

(Glossary rows to add in this change; see §9.)

## 4. Decisions

| # | Decision |
|---|---|
| **D1** | **Isolation = one git worktree per lane** (upholds F12's three convergent rulings). Each lane checks out a branch `auto-lane/<task-id>` of the main repository into `.auto/worktrees/<task-id>/`, created at the parent's current HEAD. `beginUnit`'s clean gate, the SHA baseline, `commitTree` and `unitViolations` then hold **per worktree by construction** — the file contract is untouched (0061 R4's condition). Landing is a serialized `git merge --no-ff` in the main tree. The same-tree model (0036 D15-ii) and with it D6's path-scoped staging are consciously **not** taken. |
| **D2** | **Process model = one child process per lane** (0051 D1(a)). The parent spawns a lane worker that runs a unit-scoped `runAll` in the worktree. Rationale: it preserves "one run per process" for the services holder, the router/control state and every module-level singleton (F11) with zero surgery; it gives crash isolation and a kill story for free (a lane is exactly a 0067 worker, F13); and it lets lane resume reuse the existing single-cursor recovery machinery unchanged (F8) because each lane is one directory with one in-flight unit. The parent never drives a task session while lanes are in flight (D4). The spawn is shell-agnostic: `setShellProfile` gains the lane launcher (§6.4); a shell obligation §E item makes the entry point available. |
| **D3** | **Granularity, staged: tasks first, streams second.** Stage 1 schedules **tasks** (index units of the routed phase) — coarse, commit-bounded, each owning its `docs/T-NNN/` (0036 Q5(a)'s "coarser and safer"). Stage 2 (S5) extends the schedulable vocabulary to a taken split's **streams** (`T-NNN.S<nn>`), which 0059 already made parallel-ready. Within a lane, the task's internal pipeline (decompose → subtasks → wrap-up → close-out) runs exactly as today, serially, in the worktree. |
| **D4** | **Uniform lanes when the scheduler is on.** Every execution unit of the routed phase goes through a lane — the parent executes no task sessions itself — so there is exactly one execution path under parallelism and the main tree is always clean between landings (the landing gate depends on it). One documented exception: a unit that **cannot be isolated** (D15 nested-repo `Touches`, worktree-creation failure) runs serially **in the main tree after all lanes have drained**, through today's in-process path — the scheduler's degenerate mode, preserving correctness over width. Standalone hidden tasks (phase planning, handover distillation) stay parent-side as today: they are few, small and phase-boundary work. |
| **D5** | **The scheduler is pure readiness over declared facts.** `readyUnits(index, states, runtime, inFlight, slots)` = the `nextReady` predicate **plus** two clauses: declared `Touches` disjoint from every in-flight lane's `Touches` (missing `Touches` = touches everything, G3 — never parallel), and a free slot. Order within the ready set is index order (nextReady's tie-break). At one slot with an empty in-flight set it reduces to today's `next()` exactly. `Touches` remains **advisory**: a wrong declaration surfaces as a landing conflict (D7), never as corruption — defense in depth, not trust. The admission rule is deliberately **level-independent** — it is the guard against both reported conflicts and silently-completed semantic merges (D21 records why it never relaxes); the level's merge-relevant meaning lives in the anomaly budget, not here. |
| **D6** | **State ownership is split by directory.** Parent-exclusive: the phase index ticks (re-derived after each landing — the parent is the index's driver), `.auto/units.json` scheduling fields (`worktree`, lane pid, dispatch attempts), `.auto/next-task` and all id allocation, `.auto/run.lock` of the main tree, landings, stats booking, the conclusion. Lane-local (the worktree's own `.auto/`, created fresh at dispatch): `progress.json`, `handover.json`, `units.json` (the lane's pipeline view), `stats.json`, the run-events journal, `tmp/test.sh`, logs. Nothing lane-local survives teardown except what git carried. This **dissolves** 0036 D16's per-unit-state work list (per-directory isolation replaces keyed records) and honors 0036 D15's "id allocation stays central". |
| **D7** | **Landing protocol.** Serialized in the parent (single-threaded await; a mutex by construction). On a lane's successful exit: ① verify the lane branch — `unitViolations(laneDir, laneBaseline)` must pass (only `Auto-Stage:` commits; a violation names the foreign commit and blocks); ② `git merge --no-ff auto-lane/<task-id>` into the main tree's current branch with a merge commit carrying `Auto-Task: <id>` / `Auto-Stage: landing` (so the parent's own subsequent close-outs see a trailer-bearing range, F5); ③ re-derive the phase index ticks from the merged unit states and commit as `Auto-Stage: landing-sync` (ticks are cosmetic — "unit files win over ticks" — but driver-owned and status-bearing); ④ clear the `worktree`/lane runtime fields, book the lane report's usage into stats; ⑤ teardown the worktree and delete the branch. **Conflict path**: abort the merge (main tree clean again), keep the lane's worktree and branch. The response is level-derived (D21): at `low` the unit blocks immediately — exit 2 with the park path named for the human; at `medium`/`high` the lane is re-prompted **inside that lane** — the worker is re-dispatched **once** with a merge-conflict instruction (merge the parent's current main branch into the lane branch, resolve, exit normally), landing retries, and a second conflict blocks with the park path named. A semantic conflict the session cannot resolve is the honest "merge conflict → back to a session with the conflict as feedback" of 0036 §6.4. |
| **D8** | **Lane report contract.** The lane entry writes `.auto/lane.json` into the worktree at every exit it controls: `{unit, phase, ok, result?: "PASS"\|"FAIL", blocked?: string, usage: {tokens, wallMs}, sessions: n, commits: [sha], agent, models: [internal], split?: {…for S5}}`. The parent reads it after process exit; absence (crash, kill) is the orphan signal (D14). Field names are protocol strings (§8). |
| **D9** | **Rollback stays lane-local.** A failed unit rolls back inside its worktree with today's primitives (the lane branch is private; `reset --soft` there touches nothing else); teardown then discards the scene. **Undo after landing is out of scope**: once a lane has landed, other units may build on it — the existing human paths (`close`, rework tasks) handle it. `rollbackUnit` is never pointed at the main tree while a merge has landed (F5's upstream guard already refuses; documented as intended). |
| **D10** | **Activation rule and the byte-identical floor.** The scheduler is active iff `maxSessions ≥ 2` **and** config `parallel` is not `none`/absent (`--max-sessions` above 1 with no level is a usage error, exit 1 — "plan for parallelism first"). At `maxSessions = 1` (the default) nothing changes for any project regardless of `parallel`: same loops, same prompts, same goldens — the 0036 D17 guarantee carried forward. The rollout/testing trap of 0036 D13 ("plan for parallelism, execute serially") is served by a new experiment switch `OPENCODE_AUTO_LANE_ISOLATION=1`: force lane-per-task **at one session** — full isolation machinery, zero concurrency, per-run, never persisted (the env layer's invariant). |
| **D11** | **Interactive input refuses under concurrency (v1).** `--interactive` / `--wait-answer` with `maxSessions ≥ 2` is a usage error at preflight: one human cannot steer N sessions and the sideband holds exactly one attached session (`src/interactive.ts:49-55`). Parent-side human surfaces that remain: the plan-phase question wait (`humanQuestions` — planning never overlaps lanes, D4), `--step` (pauses at lane boundaries in the parent), `--wait-between` (pauses between landings). Relay-based steering (`/lane T-NNN …`) is future polish (§7 S6), not v1. |
| **D12** | **Failback, quota and control are per lane process — documented as such.** Each lane's router holds its own down marks and failover ladder (no cross-lane contamination — 0036 F26's hazard inverted into a property), its own control (`/exit` inside a lane ends that lane), its own learned-window copy: dispatch copies the parent's `.auto/windows.json` into the worktree (best-effort) so quota waits start informed; lane-learned windows are discarded at teardown (accepted v1 loss, noted in the lane log). The parent's router governs only parent sessions and scheduling-level waits (it never waits on models — only on lanes). |
| **D13** | **Observability: relay, don't scrape.** The parent captures each lane child's stdout/stderr and re-emits it through its own `log()` with a `[<task-id>]` prefix; the lane's own audit log stays in its worktree (archived nowhere — it is `.auto/`, disposable by contract). `renderStatus` gains an in-flight lanes section (from `units.json` runtime fields). Stats: the parent books each landed lane report's usage/time into its run stats (per-model and per-tier lines keep working; the lane field rides the existing records). 0067 composition: lane report/exit/landing become parent-level structured events the future bus can carry with a `lane` identity; no lane terminal text is ever parsed (F13's rule). |
| **D14** | **Orphan recovery.** Dispatch writes `Runtime.worktree` + lane pid (0051 D3's registry, built at last). The next parent run's preflight scans the registry: an entry whose pid is alive is **awaited then landed** (a killed parent leaves live workers — they finish; this is the cattle property, F13); a dead pid with a worktree present is **re-dispatched** (the lane worker re-runs the same unit in the same worktree and resumes precisely through its own progress record — crash recovery is lane-local resume, no new machinery); a dead pid whose lane hit its attempts cap, or whose scene the lane cannot own (dirty non-driver state), **blocks** naming the park path. Park stragglers with no registry entry are pruned (`git worktree prune` + directory removal) after the same liveness check. |
| **D15** | **Nested repos serialize (v1).** A lane worktree materializes only the main repository; nested repos are copied in (content, so builds and tests work — `commitTree`'s inner-first recursion then operates on the copies), but their commits live in the copy's object store and **cannot land** through the main-repo merge. Therefore: a unit whose declared `Touches` includes paths under a nested-repo root is **not lane-eligible** and runs through D4's serial degrade. Undeclared nested-repo movement is caught at landing (nested HEADs differ from the lane baseline) → the unit blocks with the park path preserved for manual salvage. A fetch-back protocol for nested repos is future work, consciously not v1. |
| **D16** | **Park placement and git hygiene.** The park is `.auto/worktrees/` inside the target tree: it travels with the run state (recovery finds it), is already gitignored via `.auto/`, and needs exactly one hygiene change — `repoRoots`' walk skips the park (F6's misclassification: a worktree's `.git` is a file). Worktree and branch naming: `auto-lane/<task-id>` / `.auto/worktrees/<task-id>/`, stable across a task's retries (resume reuses them; in-lane rollback resets the branch in place). |
| **D17** | **All new literals are new English protocol strings** (§8): registered in 0035 §3, introduced English-first, **no dual-read** (no in-flight project carries them). Nothing existing is repurposed; no Chinese literal is moved. |
| **D18** | **Decompose-side parallelism guidance lands with stream lanes (S5), level-gated.** 0046 D11 deliberately gave the decompose prompts nothing; once streams are schedulable, the `## parallelism` subsection for the configured level is injected into the decompose family and the whole-task split clause, so decomposition arranges subtask independence the way planning already arranges task independence. |
| **D19** | **Stream lanes cold-start (v1 of S5); no cross-process fork.** A stream lane does **not** fork the lead session: the lead's agent server belonged to the lead's process and is gone at its exit. The stream lane starts a fresh session with the existing `fanout` delta enriched to carry the stream's own `subtasks.md` item in full (goal/scope/artifacts) — the delta prompt already exists (`src/execute.ts:636-649`); the fork is a context-budget optimization, not a correctness need, and cold start sidesteps the fork guard entirely. Fork-based streams return when a persistent shared server exists (a 0067 daemon facility or `--server` reuse) — recorded as the S5 follow-up, not v1. The in-lane lead/streams path (one lane runs its own streams serially after its lead's split) keeps today's fork behavior unchanged. |
| **D20** | **Phases serialize.** A phase's lanes drain completely before `completePhase` runs (parent-side), and no unit of the next phase is scheduled before the phase closes. Parallelism exists only among the ready units of the currently routed phase (and, at S5, among a split's streams). Round boundaries, handover and knowledge phases are untouched sequential gates. |
| **D21** | **The landing-conflict response is level-derived** *(ruled 2026-10-01, user)*: `low` blocks immediately on a landing conflict — zero session repairs; a conflict at low is a plan defect, and low's posture spends no tokens on merge repair. `medium`/`high` allow **one** session-assisted repair through D7's conflict protocol, then block. Two adjacent designs were considered and rejected. *(a)* Making D5's `Touches`-disjointness admission rule level-dependent — letting same-file lanes run concurrently at `medium`/`high` and relying on git auto-merge — rejected because the failure that matters is the merge git *silently completes*: two lanes editing different hunks of one function produce a clean textual merge and broken semantics, invisible to every gate (the lanes' `Result:` lines predate the merge). Under D5 the "vast majority merges directly" property holds **at every level by construction** — scheduled lanes have disjoint `Touches`, so landings merge changesets with no overlapping paths at all, the trivially safe kind. *(b)* Per-conflict shape classification (auto-deciding repair vs block from hunk/file counts) — rejected as unverifiable inference; the attempts cap is already the deterministic automatic escalation this house style permits. No new literal: the policy reads the existing `parallel` level at landing time. |

## 5. Why this shape (and the rejected alternatives)

**Same-tree concurrency with path-scoped staging** (0036 D15-ii) is rejected:
it requires deleting the clean gate, interleaving commit ranges, making
`.auto/` keyed per unit, per-lane copies of the services holder inside one
process (fighting 0061's "one run per process", F11), and a disjointness
check whose every error corrupts the tree. Three separate rulings (F12)
already refused it; nothing learned since softens it.

**In-process lanes (async tasks, shared process)** is rejected on the same
grounds plus: one crash takes every lane; SIGINT ownership stays ambiguous;
module state (`log.ts` fd, `stats.ts` handles, `protect.ts` flag,
`engine/events.ts` journal) would all need per-lane threading — a rewrite
of the runtime plane disguised as scheduling. The child-process model gets
all of it from the OS. The costs it accepts — a preflight per lane, an
agent server per lane (see Risks), spawn latency per task — are bounded and
optimizable later (server reuse via `--server`, F13's daemon), while the
in-process model's costs are structural.

**Lane = child of the parent runAll** (not a daemon facility) is chosen so
the feature is complete on the CLI today: the parent spawns workers through
the profile-injected launcher. When 0067's daemon exists it adopts the same
workers (a lane worker is indistinguishable from a run worker scoped to one
unit — same entry, same lock discipline, same read model), and the
scheduler's spawn call is the single seam to move.

## 6. Design

### 6.1 Topology

```
parent run process (main tree, holds main .auto/run.lock)
 ├─ preflight · phase routing · planning sessions (m/plan steps, hidden standalone units)
 ├─ scheduler (src/lanes.ts): readyUnits ── dispatch ──► park + scaffolding copy + spawn
 │      ▲                                                │
 │      │ landing (serialized): verify → merge → tick re-sync → book → teardown
 │      └────────────────── lane exit + .auto/lane.json ◄┘
 └─ phase close · round close · conclusion (after drain; D20)
      each lane: child process ── runAll(worktree, {lane:{unit}})
                   ├─ own .auto/ (progress · handover · units · stats · run.lock)
                   ├─ own agent host/server · own router (failback per lane, D12)
                   └─ commits on auto-lane/<task-id> (unit commit boundary per worktree, D1)
```

### 6.2 The scheduler (new `src/lanes.ts`, pipeline sub-domain)

Pure core, injected effects, `select.ts` as the style precedent:

- `readyUnits(plan, states, runtime, inFlight, slots)` — D5's predicate.
  Inputs are exactly the structures `loadPlan` already returns; `inFlight`
  is the parent's map of live lanes with their declared `Touches` sets.
- `laneEligible(task, nestedRoots)` — D15's exclusion (a unit touching a
  nested-repo root is not lane-eligible).
- `syncIndexTicks(dir, phase)` — re-derive `tasks.md` ticks from merged
  unit states (the existing scan's inverse; a driver-exclusive write).
- `parseLaneReport(json)` / `laneOutcome(code, report)` — the failure
  matrix mapping (below).
- The lane loop `runLaneLoop(ctx)` — replaces the task loop body when the
  scheduler is on (a branch at the top of the task loop, the serial path
  untouched): load plan → compute ready set → dispatch up to `slots` →
  await any exit → land (serialized) → boundaries (`stepPause`,
  `control.maybeExit`, `hibernatePause`, router clears) at each landing →
  repeat; drain, then return through the existing phase-loop tail. Boundaries
  keep unit granularity: a step pause or `/exit` stops *scheduling* and
  drains, then proceeds — the parent's control service is the run-wide
  signal by design.

**Failure matrix** (lane exit code + report → parent action):

| Lane outcome | Parent action |
|---|---|
| 0, `ok` | Land (D7), mark done, continue scheduling |
| 2, `blocked`/`FAIL` | Stop scheduling new lanes; drain in-flight; land the blocked lane's committed work (failure keeps its commit, per the completion invariant); exit 2 naming the unit and report |
| 1 | Environment error is global: stop scheduling, drain, exit 1 with the relayed lines |
| crash / no report | Orphan protocol (D14): alive → await; dead → re-dispatch (resume in place) up to the attempts cap; cap or unownable scene → block naming the park path |
| landing conflict | Level-derived response (D21): `low` → block (exit 2, park path named); `medium`/`high` → one re-dispatch with the merge instruction (D7), second conflict → block |

### 6.3 The lane entry (unit-scoped run)

`RunAllOpts.lane?: {unit: string}` — a new internal (never constitutional)
option, set only by the lane launcher. With it set, `runAll`:

1. Takes the worktree's own run lock (per-directory, works unchanged, F10).
2. Runs a preflight scoped to the worktree: config/registry load from the
   copied scaffolding, agent start, `protect(worktreeDir)`, stats/events
   open. Skipped: round routing and establishment, the phase loop, drift
   checks (the worktree's `docs/` is a fixed snapshot of the phase),
   housekeeping gitignore writes (already correct by copy), orphan scan.
3. `loadPlan(worktreeDir)` → the named unit → `runTask(client, plan, task,
   opts)` — the existing exported pipeline, unchanged (`src/runner.ts:91`).
   For S5 stream units the id is `T-NNN.S<nn>` and the runner exposes the
   single-subtask path (a small extraction from the subtask loop body).
4. Writes `.auto/lane.json`, exits with the mapped code. Resume of a
   re-dispatched lane is exactly today's single-unit resume: the worktree's
   own `progress.json`, its ownership gate, its strict-resume baseline.

### 6.4 Spawning without knowing shells (F14)

`ShellProfile` gains `laneLauncher?: (worktree: string, unit: string) =>
ChildProcess` with a default in `src/shell.ts` that spawns
`process.execPath [process.argv[1], "_lane", <worktree>, "--unit", <unit>]`
— i.e. "re-invoke this shell's CLI with the hidden lane subcommand". The
shell contract gains one §E obligation: **a shell must provide the hidden
`_lane <dir> --unit <id>` entry** mapping to `runAll` with `lane`
(`packages/auto` is the reference). Tests do not need a shell at all: the
launcher is injectable per run, and the test fixture spawns
`process.execPath` on a tiny bootstrap script that imports `runAll` — the
core exports everything required. The default launcher is also the seam a
0067 daemon replaces (spawn becomes "register a worker").

### 6.5 Dispatch and landing choreography (parent side)

Dispatch: ① `begin(unit)` on the parent's `units.json` (attempts++), ②
`git worktree add .auto/worktrees/<task-id> -b auto-lane/<task-id>` at
current HEAD, ③ copy scaffolding — `opencode.json`, `AGENTS.md`,
`.opencode/**`, best-effort `.auto/windows.json` (D12), nested repos'
content (D15) — ④ write the runtime fields (`worktree`, lane pid), ⑤ spawn
via the launcher, attach the prefix relay (D13).

Landing: D7's sequence. The merge primitive lands in `src/git.ts` beside
the existing ones (`addWorktree`, `removeWorktree`, `landBranch(dir, branch,
task)` — `merge --no-ff` with trailers, conflict detection that leaves the
main tree clean), plus the one-line park skip in `repoRoots` (F6). All git
primitives already take `dir`; nothing about the seam changes (`GitOps`
just gains the members; the no-commit double stubs them).

### 6.6 What deliberately does not change

The turn engine, concerns, chain transitions, session driving, the whole
0059 split machinery in-lane, wrap-up/close-out semantics, the completion
invariants (commit as completion; report FAIL blocks; ticks and renames are
driver-exclusive — now *parent*-exclusive for the index, D6), the config
constitution (no new keys; `--max-sessions` was already reserved), exit
codes, protect/gitignore, status read-model shape (one added section), and
the `parallel: none` + default-`maxSessions` world, byte for byte.

### 6.7 Composition with 0067

Lane workers are shaped as 0067 workers (one child per unit instead of per
run): the daemon's run registry gains lane identity for free through the
lane report and the runtime registry; the future event bus carries
parent-level lane events (dispatch/exit/landing/block) with the `lane`
field already reserved in their shapes; the persistent question queue
(0067 P3) is the natural home for lane-originated questions once relay
exists (D11's future half). Nothing in S1–S4 depends on 0067; nothing in
0067 is blocked by this plan.

## 7. Stages

Each stage is independently shippable and revertable; S1–S2 before any
concurrency exists.

- **S1 — readiness and registry (pure, inert).** ☑ `readyUnits`,
  `laneEligible`, `syncIndexTicks`, `parseLaneReport`, `laneOutcome` in new
  `src/lanes.ts`; ☑ `Runtime.worktree` / lane fields in `src/tasks.ts`
  (0051 D3/P1 at last) with write/read helpers; ☑ unit tests (pure) incl.
  the reduction property "one slot + empty in-flight = `next()`"; ☑
  `test/import-direction.test.ts` placement for the new module. No behavior
  change anywhere (`--max-sessions` still refuses > 1).
- **S2 — lane machinery, serial (isolation rollout).** ☑ git primitives
  (`addWorktree`/`removeWorktree`/`prune`/`landBranch`) + park skip in
  `repoRoots` + real-git tests; ☑ dispatch/landing choreography and
  scaffolding copy in `src/lanes.ts`; ☑ `RunAllOpts.lane` + the lane
  preflight branch in `src/loop.ts`/`loop-preflight.ts` + `.auto/lane.json`
  writer; ☑ `laneLauncher` profile field + default; ☑ `_lane` hidden
  subcommand in `packages/auto` + shell-contract §E item; ☑
  `OPENCODE_AUTO_LANE_ISOLATION` switch routing the task loop through
  one-lane-at-a-time; ☑ e2e: spawned lane-worker fixture (no shell), a task
  round at isolation-on, kill-mid-lane → main tree clean, re-dispatch
  resumes; ☑ goldens untouched. Value delivered alone: per-task crash
  isolation and the whole landing protocol, validated with zero
  concurrency.
- **S3 — the scheduler (concurrency live).** ☐ Lift the `--max-sessions`
  refusal (preflight + shell) behind `parallel ≠ none`; ☐ `runLaneLoop`
  wired as the task-loop branch; ☐ failure matrix + conflict protocol
  wired (the level-derived repair budget of D21); ☐ orphan recovery in preflight (await alive / re-dispatch dead /
  block, park prune); ☐ nested-repo serial degrade; ☐ interactive /
  wait-answer refusal (D11); ☐ tests at `maxSessions = 2` with an in-process
  fake launcher (two fake-agent lanes, one landing conflict under both level postures — `low` blocks, `medium` repairs once — plus one crash, one FAIL).
- **S4 — observability and human surface.** ☐ Prefix relay; ☐ status tree
  in-flight lanes section; ☐ stats booking from lane reports + conclusion
  roll-up; ☐ `/exit`/step/wait-between drain semantics at boundaries; ☐
  parent-level lane event lines shaped for the 0067 bus (§6.7).
- **S5 — stream lanes (task-internal width).** ☐ Runner exposes the
  single-subtask execution path (`T-NNN.S<nn>` lane units); ☐ lead lane
  report carries the split (items, split baseline); ☐ parent lands the
  lead, then schedules stream lanes from the split baseline — cold start
  (D19) with an enriched fanout delta computed from merged state (siblings
  by title + done flags; files-since-split for dependent streams from the
  landing history; last-stream full verification); ☐ per-stream handoff
  document role (the deferral at `src/execute.ts:590` retired); ☐
  decompose-side parallelism guidance, level-gated (D18) + golden batch; ☐
  wrap-up runs in the last lane / a closing lane after streams drain.
  *Template-heavy; a short amendment to this document precedes
  implementation (the fanout delta's exact fields and the stream report).*
- **S6 — polish, docs, retirement.** ☐ Documentation set (§9); ☐ status
  notes on 0036 (executional half superseded) and 0051 (fully absorbed); ☐
  `packages/auto` e2e + README; ☐ risk hardening (Windows teardown retries,
  park path-length, lane log retention choice); ☐ this plan retires.

## 8. Protocol strings (0035 §3 registrations, all new English, no dual-read)

`auto-lane/<task-id>` (branch grammar) · `.auto/worktrees/` (park path) ·
`_lane` (hidden shell subcommand) · `--unit <id>` (its option) ·
`.auto/lane.json` + its field names (`unit`, `phase`, `ok`, `result`,
`blocked`, `usage`, `sessions`, `commits`, `agent`, `models`, `split`) ·
`Auto-Stage: landing` / `Auto-Stage: landing-sync` (new stage values beside
the existing trailer) · `OPENCODE_AUTO_LANE_ISOLATION` (experiment switch).
The lane report's `result` reuses `Result: PASS|FAIL` semantics verbatim —
no new verdict vocabulary. No existing literal moves; tier-1 marker tables
unchanged.

## 9. Documentation updates (with S6, pointers earlier)

`docs/structure.md` (lanes module; git worktree primitives),
`docs/shell-contract.md` §C (absorption note: `_lane` obligation,
`laneLauncher`, and the reservation wording — §C's "`RunAllOpts.maxSessions`
is reserved" line — flipping to live) and §E (checklist item),
`docs/glossary.md` (§3's rows), `AGENTS.md` navigation line + the
invariants touched (driver-exclusive writes gain "the parent re-derives
index ticks at landing"; the unified-commit paragraph gains the landing
stages — AGENTS.md itself carries no max-sessions reservation wording to
flip; the reservation lives in shell-contract §C and the shell README),
and this file retires per convention.

## 10. Risks and honest limits

- **N agent servers / N claude processes** — one per lane process (memory
  cost; registry-managed opencode profiles each spawn `opencode serve`).
  Mitigation later: shared/persistent server via `--server` reuse or the
  0067 daemon; S5's fork-based streams ride on it (D19). Not a v1 blocker;
  documented expectation.
- **Landing conflicts** are the designed failure: `Touches` lies sometimes;
  the conflict protocol (D7) turns them into re-work, and the cap into a
  human block. What is *not* designed: semantic conflicts (two lanes
  logically incompatible with clean text merges) — same honesty as 0036
  §6.4, the report/result line is the only backstop.
- **Nested repos**: copied per lane (cost), never landed (D15) — width
  collapses to serial for such units; wrong declarations block at landing.
- **Quota is the real ceiling**: `--max-sessions 4` against a two-session
  quota buys retry storms. Per-lane ladders (D12) contain the blast radius;
  the scheduler does no model-level admission (noted as future: a lane
  admission check against the router's down marks).
- **Windows**: worktree removal can race AV/file locks — best-effort
  teardown with retry, park prune at preflight, block-with-path as the
  terminal failure (never silent loss).
- **Wall-clock accounting** changes shape (lanes overlap); stats keep
  per-lane segments — the conclusion's "time" lines mean parent-wall, noted
  in the roll-up.

## 11. Open questions (one user pass before S1)

1. **Granularity order** — tasks first, streams at S5 (D3). Confirm, or
   invert (streams are where auto-mode width naturally appears; the cost is
   taking the subtask state protocol and `subtasks.md` multi-writer earlier).
2. **Uniform lanes + serial degrade** (D4) vs "parent executes whenever a
   slot would idle" — recommend uniform (one execution path; clean main
   tree; the degrade is the only exception). Confirm.
3. **Interactive refusal under concurrency for v1** (D11), relay later.
   Confirm.
4. **Park location** `.auto/worktrees/` (D16) vs a sibling directory
   outside the target tree (keeps the tree pristine; loses
   gitignore-for-free and recovery-by-proximity). Recommend inside.
5. **Stream lanes cold-start** (D19) vs blocking S5 on a shared persistent
   server. Recommend cold-start (correct, shippable; fork returns with
   0067/`--server`).
6. **Lane log retention**: worktree `.auto/logs/` discarded at teardown
   (recommended — `.auto/` is disposable by contract, the parent's relayed
   audit log keeps the run story) vs archiving the last N lane logs under
   the parent's `.auto/logs/`.

## 12. Status

Written 2026-10-01. Nothing implemented. **D21 was ruled by the user in
discussion the same day** — the landing-conflict response is level-derived,
and both alternatives (level-dependent `Touches` admission relying on git
auto-merge; per-conflict shape classification) are rejected with the
reasoning recorded in the decision row. §2's line anchors were refreshed
2026-10-02 against the tree as it stands after the 0067-service commits
(T-087–T-098) and T-093's `RunAllOpts` seam — the facts are unchanged, only
the positions moved. §11's six answers are the only
inputs S1 needs; stages S1–S2 are safe to start under the defaults
recommended above (they change no behavior for any existing project — the
isolation switch is opt-in per run). 0036's remaining open questions that
this plan touches are answered by construction: Q5(a) → D3, Q10 → settled
by 0046 D9 (`--max-sessions`), Q12 → D10 (frozen level + run-time width,
lowerable per run by passing a smaller `--max-sessions`, which is already
the flag's semantics). 0036's D16 per-unit state list is dissolved by D6,
its D18 test-queue item by per-worktree `tmp/` (the slot is per lane
automatically); its observability half lands as D13.

## 13. Implementation record

Each stage appends one entry here (the plans/0061 §10 format): what landed,
the tests, any decision taken.

**S1 — readiness and registry (pure, inert), 2026-10-02.**
- Landed: `src/lanes.ts` (new) — `readyUnits` (D5's predicate: nextReady +
  Touches-disjointness + a free slot, index order as the tie-break),
  `laneEligible` (D15), `syncIndexTicks` (D7 step ③, driver-exclusive),
  `parseLaneReport` / `laneOutcome` (D8's contract + §6.2's failure matrix);
  and `src/tasks.ts`'s `Runtime` gains the lane fields (`worktree`, `pid`)
  with `setLane` / `clearLane` / `laneRecords` through the existing
  serialized `.auto/units.json` write chain — the dispatch attempts cap
  rides `attempts` (begin increments it), no duplicate field. No caller of
  any of it outside tests: `--max-sessions` still exits 1 above 1 at
  preflight, goldens untouched.
- Tests: `test/lanes-scheduler.test.ts` (new, `unit` lane) — the reduction
  property (every done-mask over five declaration shapes: one slot, empty
  in-flight, nothing executing = `next()` exactly), the touches-everything
  rule in both directions, prefix-containment overlap, the free-slot cap
  with index-order tie-break, the mutual disjointness of one call's admits,
  D15 eligibility, `syncIndexTicks` in both directions + idempotence +
  missing-index no-op, the lane-field round-trip with hand-edit degradation,
  the report contract, and the failure-matrix table; `test/lanes.ts`
  classifies the file into `UNIT_LANE`; `test/import-direction.test.ts`
  places the module (driver domain, pipeline sub-domain, and a one-way rule
  barring the loops and the session-driving layer).
- AUTO-DECISION (`src/lanes.ts`): `readyUnits`'s disjointness clause is also
  checked against the units the same call has already admitted — the
  returned batch is dispatched together, so it must be mutually disjoint,
  and greedy index order equals recomputing after each dispatch.
- AUTO-DECISION (`src/lanes.ts`): `laneEligible`'s reach test is overlap,
  not strict containment — `Touches: vendor/` over the nested root
  `vendor/lib/` is not lane-eligible either (D15 words the rule as "paths
  under a root"; the parent covers them, and a lane that cannot land is a
  wasted dispatch).
- AUTO-DECISION (`src/lanes.ts`): `laneOutcome` maps the pairs the matrix
  does not name conservatively — a report that is absent (or fails
  `parseLaneReport`'s contract) is the orphan outcome for every exit code
  (D8: every controlled exit writes the report), and a code/report
  contradiction (0 with a failing report, 2 with a clean one) is blocked,
  never land.
**S2 — lane machinery, serial (the isolation rollout), 2026-10-02.**
- Landed: the git primitives beside the commit boundary (`src/git.ts`:
  `addWorktree` / `removeWorktree` / `pruneWorktrees` / `deleteBranch` /
  `landBranch` — `merge --no-ff` with `Auto-Task:`/`Auto-Stage: landing`
  trailers, conflict detection that aborts and leaves the main tree clean —
  plus the read-only `mergeBaseSha` / `commitsSince`), the F6 park skip in
  `repoRoots`' walk, and the four write-side members on the `GitOps` seam
  (`src/git-ops.ts`; the no-commit double fails `addWorktree`/`landBranch`
  closed and answers removal/prune ok). The dispatch and landing
  choreography in `src/lanes.ts`: `dispatchLane` (attempts through `begin`,
  worktree creation or registry-driven reuse, the scaffolding copy — the F7
  set, `.gitignore`, best-effort windows and nested content — spawn through
  the profile launcher, `setLane` with the pid) and `landLane` (D7's five
  steps: verify over the merge-base baseline, merge, `syncIndexTicks`
  committed as `landing-sync`, `clearLane` + the report's usage into
  `statsLaneUsage`, teardown). The lane entry: `RunAllOpts.lane` in
  `src/loop-preflight.ts` (lane mode skips the AGENTS.md/gitignore
  housekeeping writes — correct by copy), the routing/drift pre-check skip
  in `src/loop.ts`, `runLaneUnit` in `src/loop-task.ts` (routing → the named
  unit → the unchanged `runTask` → the serial loop's terminal commit,
  close-out check and interruption-scene handling, minus the human
  boundaries, which stay parent-side), and `runLaneWorker` (`src/loop.ts`)
  wrapping `runAll` with the D8 report writer at every controlled exit —
  the export a shell's `_lane` subcommand (`packages/auto`, hidden) and any
  bootstrap import alike. `ShellProfile.laneLauncher` + the default
  (`src/shell.ts`: re-invoke this shell's CLI; the structural `LaneWorker`
  return type) and the shell-contract §E item. The switch
  `OPENCODE_AUTO_LANE_ISOLATION` (`src/switches.ts`, on|off, env-only)
  routes `runTaskLoop` through `runIsolationLoop` — one lane at a time over
  the same `next()` selection, §6.2's failure matrix at each lane exit,
  the parent's boundary hooks at each landing. `--max-sessions` still
  refuses above 1; goldens untouched.
- Tests: `test/git.test.ts` — the primitives over real git (creation at
  HEAD on the branch, F6's park skip, force-retry removal, prune, merge
  trailers, the conflict abort leaving the main tree clean, the double);
  `test/lanes-scheduler.test.ts` — the choreography over real git with the
  launcher stubbed through the profile (fresh dispatch and scaffolding,
  registry-driven reuse, the straggler refusals, the landed five steps with
  a drifted tick re-derived onto a `landing-sync` commit, conflict and
  verification failures keeping the scene), moved to the repo lane of the
  test manifest for it; `packages/auto/test/e2e.test.ts` — a task round at
  isolation-on with outcomes equal to the serial path's plus the landing
  commit and a torn-down park, a spawned bootstrap fixture
  (`test/fixtures/lane-worker.ts`, no shell: `runLaneWorker` is the whole
  import) driven through the launcher injection point, and the kill
  property (worker killed mid-session at a new fake-claude gate knob: main
  tree clean, scene kept, re-run re-dispatches in the same worktree and the
  resume line lands in the worktree's own log, then lands with attempts
  booked twice); the `--max-sessions` refusal.
- AUTO-DECISION (`src/lanes.ts`): the dispatch writes the runtime fields
  after the spawn, not before — §6.5 orders ④ before ⑤, but the pid half of
  the record exists only once the worker process does, and a record naming
  a pid that was never spawned would read as a dead orphan.
- AUTO-DECISION (`src/lanes.ts`): `.gitignore` rides in the scaffolding
  copy although F7's list does not name it — init ignores the file itself
  (gitignore.ts INIT_ENTRIES), so a fresh worktree does not carry it, and
  without it the worktree's own `.auto/` and `tmp/` would surface as
  untracked dirt at the lane's first clean gate.
- AUTO-DECISION (`src/loop-task.ts`): a landing conflict blocks immediately
  (D21's `low` posture) — the level-derived repair budget and the conflict
  re-dispatch protocol are S3 wiring; and an orphan (no report) keeps the
  scene and exits 2 naming the park path rather than re-dispatching
  in-process — the re-dispatch is the next run's (D14's preflight orphan
  scan and the liveness probe are S3's), which the e2e drives exactly that
  way.
- AUTO-DECISION (`src/loop.ts`): the report's `commits` list is
  `base..HEAD` of this worker's own start (the worktree HEAD after
  preflight), so a resumed lane lists this run's commits — the parent
  derives the branch baseline itself at landing (merge-base), and no S2
  consumer reads the list.
- AUTO-DECISION (`src/stats.ts`): the lane report's usage books into an
  additive per-unit `lanes` section of the stats document, not into the
  three buckets' usage/sessions — the lane's sessions are the child
  process's own (booked there); folding them into the parent's buckets
  would double-count the moment S4 wires the per-model roll-up.
- AUTO-DECISION (`src/switches.ts`): the switch takes on|off like every
  registered switch, not D10's informal `=1` — the registry's uniform
  grammar wins over the design note's shorthand.
<!-- auto: eof -->

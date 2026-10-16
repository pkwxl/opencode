# 0099 — Doc lanes: same-tree concurrency for documentation-scoped units

One design, ruled from the same dm-glm round that ruled 0096 and 0098
(`/home/wxl/workspace/root/dm-glm`, the device-mapper → Asterinas migration):
the rounds' non-code phases are wide fan-outs of tasks whose entire write
scope is one `docs/T-NNN/` directory each, and the driver executes them
strictly serially because its only concurrency story is the worktree lane —
isolation machinery those units do not need and this host (ext4, no reflink)
cannot even buy cheaply.

- **Doc lanes.** A unit whose declared `Touches` lie entirely under `docs/`
  of the outer repository runs as a *doc lane*: a concurrent in-process
  session pipeline in the main tree, no worktree, no branch, no merge. As
  many as `--max-sessions` slots, admitted by the existing readiness
  predicate (`readyUnits` — its `Touches`-disjointness clause **is** the
  safety argument: disjoint scopes mean no shared mutable path, so isolation
  is unnecessary rather than merely expensive).
- **Committed sequentially, path-scoped.** The parent stays the sole writer
  of git state, the index and `.auto/`; every commit is funneled through one
  serialized queue and scoped — the unit's own `Touches` ∪ `docs/T-NNN/` for
  a doc lane, everything-except-live-scopes for anything else. The unified
  commit's sweep never crosses a sibling's in-flight work.
- **Tier 0 grows task parallelism.** 0096's tier model bought processes
  before trees but left Tier 0's *tasks* serial (only the test lanes were
  processes). Doc lanes are Tier 0's task parallelism. Tiers 1–2 keep the
  worktree lane loop unchanged.
- **No new session-facing protocol.** `Depends:`/`Touches:` grammar, verdict
  lines, report forms — all unchanged. The sessions learn one guidance
  clause; the planner learns one declaration discipline. `OPENCODE_AUTO_DOC_
  LANES` is the kill switch, default on, removing the scheduler never the
  serial floor.

## The evidence (why now)

dm-glm's R-01, measured from its git history and task documents:

- **The premise holds for the a/d phases, exactly.** P01-analysis (48 tasks,
  T-001..T-048) and P02-design (20 tasks) commits touch nothing but
  `docs/T-NNN/**` plus the driver's own index tick: `T-015 exec` → five
  files all under `docs/T-015/`; `T-052 exec` → `docs/T-052/epoch-design.md`
  only; `T-064 exec` → four files under `docs/T-064/`. The `T-NNN done`
  commits add exactly `docs/T-NNN/done.md` and the phase `tasks.md` tick —
  both driver writes.
- **The parallelism headroom is large and already declared.** P01 is a wide
  DAG, not a chain: 15 mutually independent tasks behind the T-014 join, 14
  behind T-030, three roots, two big joins — and P01's field blocks declare
  `Depends:` and `Touches: docs/T-NNN/` on 48 of 48 tasks. Yet the commit
  timestamps show strictly serial execution throughout the round's history.
  At width 3, P01's ~48 serial sessions collapse to a critical path of
  ~18–20 — roughly a 2.5–3× wall reduction on that phase.
- **P03/P04 are excluded by contention, not by accident.** The implement and
  test tasks write the nested repository `aster-dm-all/` (4,512 commits of
  its own), bump the shared `test/verify_full.sh` (39 commits in the outer
  repo — the freeze-chain defaults, one bump per test task), and obey the
  recorded serial-QEMU discipline (all boot lanes bind VNC display :42,
  strictly serial, sibling sessions included). `laneEligible` already
  excludes nested-repo units from worktree lanes; doc lanes exclude them by
  scope, fail-safe — the same boundary the contention itself draws.
- **The host cannot buy isolation cheaply.** ext4 has no reflink — 0098's
  probe already rules the CoW path out on this machine — so Tier 1 never
  materializes and Tier 2 means a full worktree of a tree carrying `linux/`
  (the 145k-LOC source truth) and the warm `aster-dm-all` build state, per
  lane, to write one markdown file. dm-glm runs `subtask: off`,
  `testByDriver: false`, no `parallel` key, one session — the scheduler has
  never been on; the win is unclaimed, not lost.
- **The one planner gap.** P02's tasks T-051..T-068 declare no `Touches`
  (17 tasks, the whole phase) and almost no `Depends` — under G3 those
  defaults mean "touches everything" and "the previous sibling", so P02 is a
  serial chain *by default* even where the work is independent. The
  scheduler admits on declarations; the planning guidance must teach the
  declaration (D11). P01's planner already wrote them — the discipline is
  proven, not hypothetical.

What this design is NOT: a second task-status system, a new isolation
mechanism, or a change to the dependency grammar's defaults. "Done" keeps
its exact meaning; the fail-safe directions of G3 (absent `Touches` touches
everything; absent `Depends` orders against the previous sibling) are
untouched — an undeclared task simply never becomes a doc lane.

## D1 — Eligibility

A unit is **doc-lane-eligible** iff, pure over its declaration:

1. `Touches:` is present and non-empty (absent/empty means
   "touches everything" — G3's fail-safe — and is never eligible);
2. every `Touches` entry lies under `docs/` of the **outer** repository
   (repository-relative, so no nested-repo root is reachable by
   construction — `docs/` never overlaps them);
3. the unit is whole-task: `Decompose: whole`, or the field absent.
   `pipeline` units and split streams keep their existing tier ≥ 1 story;
   under doc-lane mode they run through the serial degrade (D9).

Landing: `docEligible(task)` in `src/lanes.ts` beside `laneEligible` — the
same module owns admission predicates, the same style (pure, injected
facts, no state).

The **effective scope** of a doc unit — what every guard and commit in this
design means by "its scope" — is the declared `Touches` **plus its own
`docs/T-NNN/` directory**, always: the task document, report, gaps,
handoff.md and testhands live there whether or not the planner listed the
directory (dm-glm's T-070-style tasks that declare only a *shared* doc such
as `docs/T-064/mapping-table.md` still write their own report). The
disjointness admission compares **effective** scopes: two units never run
side by side when one's declaration reaches the other's directory — the
case `readyUnits`' raw `touches` comparison would miss when a task declares
only the shared file. The comparison happens in the doc loop's admission
wrapper, never by changing `readyUnits` for the worktree lanes.

AUTO-DECISION (why `docs/` and not "any process-role path"): the process
roles include paths a doc session could contend on outside `docs/`
(dm-glm's `test/verify_full.sh`, `tools/` allowlists, `prompts/`) — the
contention there is real, as the 39 verify_full.sh commits prove. `docs/`
is the one tree the unit model already gives per-unit exclusivity over
(`docs/T-NNN/` per task, shared docs handled by overlap), so it is the
honest boundary. A wider boundary is a follow-up with its own evidence, not
a guess baked into v1.

## D2 — Activation, tier placement, and the floors

The doc scheduler runs the routed phase's units concurrently iff
`schedulerActive(maxSessions, parallel)` — the existing activation rule
(`--max-sessions ≥ 2` and a configured `parallel` level; preflight's
"plan for parallelism first" guard unchanged — dm-glm adopts with
`amend --parallel low` + `run --max-sessions 3`) — **and the run's tier is
0**. A new predicate `docScheduler(maxSessions, parallel, tier)` in
`src/lanes.ts` beside `worktreeScheduler`, consulted once in
`runTaskLoop`'s branch chain, which becomes:

```
laneIsolation        → runIsolationLoop   (unchanged, first — the switch
                                          pins full isolation, the more
                                          specific intent; doc units run
                                          there as ordinary worktree lanes)
worktreeScheduler    → runLaneLoop        (tier ≥ 1 — unchanged)
docScheduler         → runDocLaneLoop     (tier 0 + parallel — this design)
otherwise            → the serial loop    (unchanged)
```

AUTO-DECISION (Tier 0 only, v1): at tier ≥ 1 a doc-scheduler branch placed
above the worktree loop would strand the phase's non-doc units — either
degraded to serial in-tree (a regression for tier-2 projects) or mixed into
a two-band concurrent loop (worktree lanes and doc lanes landing through
one event loop — feasible, both landings being parent-serialized windows,
but a v1 complexity this plan does not buy). 0096's tier philosophy already
says the tiers are cost choices: a project on tier 1/2 chose trees
knowingly, and doc units through worktree lanes are correct there — just
more expensive. The two-band mix is named as a follow-up in §Non-goals.

`OPENCODE_AUTO_DOC_LANES` (src/switches.ts, kill switch, default on): off
removes the branch — a tier-0 parallel run is exactly today's serial loop.
The floors, stated precisely:

- no `parallel` level, or `--max-sessions 1` → the branch is never taken;
  byte-identical to today by construction;
- `OPENCODE_AUTO_DOC_LANES=off` → same;
- a tier-0 parallel run over a phase with **no** doc-eligible units → the
  doc loop's degrade path must be **silent** (unlike the worktree loop's
  degrade, which logs its isolation line): every unit through
  `runSerialUnit`, the same log stream, the same `regressionBoundary`
  placement, the same mutual-park checks — byte-identical to the serial
  loop. This floor is a stage-C test, not an aspiration.

AUTO-DECISION (`--handover-test` is refused under doc-lane activation, at
preflight, exit 1): the idle test protocol runs driver scripts against the
whole tree from inside the session engine — the one driver-run surface with
no landing window to drain into (its stash guard would treat a sibling's
in-flight doc writes as its own to restore). The wrapup lane gate and the
strict wait have drain points (D9); the idle test does not, so the two run
shapes are mutually exclusive and say so. `--test-by-driver` stays
compatible: its lane gate runs at the wrap-up moment, which D9 drains.

## D3 — The execution shape: in-process pipelines, one writer

`runDocLaneLoop(ctx, phase)` in `src/loop-task.ts`, `runLaneLoop`'s shape
with the worker process replaced by an in-process pipeline:

- slots = `maxSessions`; an in-flight map of live doc lanes, each holding
  the unit's `Task`, its effective scope, and its pipeline promise;
- fill the free slots from `readyUnits` (the existing predicate — clauses
  1/2/4 unchanged: deps done over merged states, executing nowhere, a free
  slot), filtered by `docEligible` and by the effective-scope disjointness
  of D1;
- `Promise.race` the pipelines; each completion lands in the loop's own
  single-threaded continuation — **that await chain is the mutex** for
  everything driver-exclusive;
- the failure posture is the lane loop's: a blocked/incomplete/dirty unit
  stops dispatching, the in-flight lanes drain, the loop returns 2 (a doc
  unit's committed work is already in the main tree — nothing "lands"
  late, the stop is honest);
- phases serialize (the 0068 D20 rule): the loop drains before returning.

One unit is driven by `runDocUnit` — `runSerialUnit`'s sequence with the
concurrency deltas this plan owns: the relaxed start gate (D5), the scoped
evidence (D7), the boundary hooks in probe form (a `/exit` seen at a
landing stops dispatching and takes effect after the drain — taskBoundary's
existing `exitProbe` shape), the repair-round block carried over verbatim
(closeUnit + the append input + `ctx.repairs` — the repair append runs in
the landing window, serialized; `appendPlan`'s planning session is an
ordinary session the phase loop owns next).

AUTO-DECISION (in-process, not child driver processes): the run lock allows
one driver process per directory (`src/lock.ts`), and `.auto/units.json`,
the phase index and the commit queue must stay single-writer — a same-tree
child is a second driver by definition, and a session-only child worker
would need per-session IPC to preserve the share-per-session rollback
points and the wrap-up's evidence window. The parent already owns every
one of those windows; the only thing it lacked was concurrent sessions,
which the agent pool gives it natively (sessions are independent; the pool
resolves a client per chain). The price — auditing in-process shared state
— is paid once, in stage A (§Risks).

## D4 — The seam carries serialization and scoping

The run installs a doc-lane `GitOps` decorator when `docScheduler` is
active: `createDocLaneGit(base, registry)` in `src/git-ops.ts` (the seam's
home; the module's no-opts-import constraint is what makes the registry a
structural parameter). The registry is a small mutable object the loop
owns — `{ live: Map<unitId, string[]>; quarantine: Set<string> }` — updated
at dispatch, landing and recovery; the decorator reads it.

Every commit-shaped call through the seam is funneled through **one awaited
queue** (commit-at-a-time — "committed sequentially") and scoped:

- a call whose `task.id` is a live doc unit commits
  `git add -A -- <effective scope>` — its own `Touches` ∪ `docs/T-NNN/`;
- any other call (the serial degrade's units, the carryover self-heal, the
  `interrupted`/`regression` janitorial commits, close-out commits)
  commits `git add -A -- . ':(exclude)<live scope 1>' …` — everything
  except the live scopes. With no lanes in flight this is `git add -A -- .`
  — today's behavior, byte-identical. The excludes apply at the outer
  repository only; nested roots (reachable solely through ineligible
  units, which drain first — D9) commit whole;
- `commitPending`'s backfill keeps its named-files scoping (the files are
  outside every live scope by D6's guard, or the guard has already
  blocked).

The doc loop installs the decorator at entry — wrapping `ctx.git` for its
duration — and an empty registry makes every method a pass-through, so the
post-drain phase machinery and the degrade path run safely with it in place.

`runner.ts`, `execute.ts`, `wrapup.ts`, `loop-task.ts`'s existing call
sites are **unchanged** — `afterSession`, `commitTree`, `commitPending`
already carry the `task`, which is all the decorator needs. The nested-first
walk, the `Auto-Stage`/`Auto-Nested` trailers, the identity args: all
inherited from `commitTree` underneath; only the `add` pathspec is
inserted. Implementation: a scoped variant of the `add` step inside
`commitTree` (an optional `scope`/`exclude` parameter on the seam's
delegation, never a second commit implementation).

The seam is also where D5's relaxation and D6's guard live — see those.

## D5 — The start gate relaxes by exactly the live scopes

`beginUnit` under the decorator: the dirty set may lie inside **other live
doc units' effective scopes** (the registry's); everything else keeps
today's semantics — driver-state-only dirt self-heals, anything else blocks
for the human, exit 2. The baseline records as usual. The relaxation is
registry-driven, so it is exactly as wide as the in-flight set and no wider;
a fresh run with an empty registry is today's gate.

Verified against the resume path: `recoveryLadder`'s dirty clause is
`baselineIntact` — external, trailer-less commits since the record's
baseline, never worktree dirt — so a resumed doc unit is not blocked by
sibling scopes' uncommitted writes, and sibling share commits carry the
trailer and pass it too. The resume path's one tree-wide hazard is the
rollback verdict; D10 owns it.

## D6 — The landing guard, and quarantine

Before a doc unit's scoped commit lands, the decorator computes
`changedFiles(dir)`: every path must lie inside the unit's own effective
scope ∪ the live siblings' scopes. Anything else — a session that wrote
past its declaration — is the existing dirty-block posture: stop
dispatching, drain, exit 2 naming the files. This is the backstop that
makes a wrong `Touches` declaration **loud** (the same posture as tier 1's
sparse guard: "a wrong declaration surfaces as a dirty worktree and a
failing unified commit, never as silently unlanded work").

Because the offending dirt survives for the human while sibling lanes must
still land, the guard records the offending paths in the registry's
**quarantine** set: subsequent landings tolerate exactly those paths (their
guards ignore them), and the exit-2 message names them. The quarantine dies
with the run — the next run's clean gate sees the dirt and blocks, which is
the human-authority posture the serial world already has for stray writes.

## D7 — Verification and scans become scope-true

Under concurrency a unit's `baseline..HEAD` range contains its siblings'
commits. Three surfaces must not read that range naively:

- **The wrap-up's charter range** (`wrapup.ts` `commitRangeText`): for a doc
  unit the rendered range becomes path-limited — `<sha>..HEAD -- <scope>`
  (single root; the scope is exclusive to the unit by disjointness, so the
  pathspec makes the range exactly the unit's own commits). The template
  sentence stays generic; the injected string carries the pathspec.
  Threading: `runTask`'s input gains an optional `scope`; the wrap-up
  receives it beside `baseline`.
- **`unitViolations`**: clause ② (every commit in range carries the
  `Auto-Stage` trailer) is unchanged — interleaved sibling commits all
  carry it, and a foreign commit is still caught. Clause ① (worktree
  clean) gains an optional `exclude` parameter (the live scopes ∪
  quarantine); the doc loop passes it at the close-out check. Absent
  parameter = today's function, byte-identical.
- **`unitChangedFiles` / `unitAddedLines`** (the eof-marker scan and the P1
  prohibition scan): both gain an optional scope pathspec (the diff gains
  `-- <scope>`; the untracked walk filters by scope) so blame never crosses
  units. The call sites thread the same `runTask` input `scope`. The
  threading sites are `execute.ts`'s closeout scans (the eof-marker and P1
  passes over the unit's baseline); round-close's whole-history scan runs
  after the loop drained and work-order's adopt step is the standalone
  guest flow — both outside the doc-lane path. For a doc unit the P1 scan
  is vacuous by construction (it writes only process paths) — scoped
  anyway, because correctness of attribution is the rule, not the accident.

## D8 — Serialized shared-state writes (the substrate)

In-process concurrency turns every read-modify-write of shared state into a
race. The audit's rule: **every read-modify-write of a file two pipelines
can touch goes through a serialized queue.** The known suspects, fixed in
stage A:

- `.auto/units.json` (`begin`, `setLane`, `block`, `markDone`'s
  `updateTask`, `forgetUnits` — `src/tasks.ts`): one module-level promise
  queue around every `updateUnits` read-modify-write. The writes commute
  (different units' records), so a queue suffices — no merge semantics.
- the phase index tick (`tickIndexLine` — `src/document/unit.ts`; called
  from `markDone` inside the pipeline): same treatment. Concurrent ticks
  edit different lines of one file; serialization preserves both. This is
  why the plan does **not** need the worktree world's landing-side
  `syncIndexTicks` re-derivation — the write itself is made safe where it
  happens, and the pipeline stays byte-identical.
- `.auto/stats.json` (`statsTask`, the session-end bookings): the booking
  must carry the unit id captured at dispatch, never the ambient "current
  bucket" — under concurrency the bucket switches interleave. Audit and
  fix the booking path; the buckets are keyed by id already.
- `.auto/resolves.json` and `.auto/run-events.jsonl`: audit the append
  paths (single atomic append vs read-modify-write); queue where needed.
- `.auto/next-task`, `windows.json`: audit (single-writer moments expected;
  prove it).

`AGENTS.md`, the config and the brief are already read-only during `run`
(protect); `docs/T-NNN/handoff.md`, `report.md`, `gaps.md`, `subtasks.md`
are per-unit files — disjoint by eligibility. The one shared *committed*
file a pipeline writes is the index tick, handled above.

## D9 — The driver-exclusive windows drain

Surfaces that run driver scripts against the tree or sweep it wholesale
must find it quiet. Under doc-lane mode:

- **The wrapup lane gate and the strict wait** (0096 D5, 0098 stage E —
  `wrapup.ts`): `runWrapup`'s input gains an optional `drain` callback; the
  lane gate and the strict wait's in-tree run await it before starting. The
  doc loop implements `drain` as "no other doc lane in flight" (self
  excluded). Absent callback = today's behavior. The threading chain is
  the `runTask` input → `runWrapup` input → the gate, riding beside D7's
  `scope` on the same input. For a doc unit the gate is
  usually a no-op anyway (the carry-forward rule skips lanes whose surfaces
  miss the unit's changed paths — docs-only changes miss `src/**`-shaped
  surfaces), so the drain cost is rare; a docs-surfaced lane (a docs-lint
  suite) still runs, correctly, on a quiet tree.
- **The background regression slot** (0098 stage C — `regressionBoundary`
  at each landing): the launch conditions already include a clean tree —
  with sibling scopes dirty the launch defers (the existing deferral path
  and its log-once discipline), so under concurrency the slot concentrates
  at the phase-close hold, which runs after the loop drained. The
  janitorial receipt commit rides the decorator's everything-except-live-
  scopes rule (D4) — a receipt never sweeps sibling work.
- **The serial degrade** (a non-doc unit — pipeline decompose, a
  source-touching task, a missing declaration): drains the doc lanes, then
  `runSerialUnit` alone, then scheduling resumes. The 0068 D15 posture,
  silent per D2's floor. v1 does not overlap the degrade with doc lanes.
- **The mutual-park check** runs at the loop's nothing-ready point, the
  lane loop's shape verbatim.

## D10 — Recovery flattens

A killed run leaves N doc units `in_progress` with their scopes dirty. The
next run's doc loop, before scheduling:

1. collects the leftover `in_progress` doc units into the recovery
   registry — their scopes count as live for every gate relaxation, so they
   tolerate each other's dirt;
2. drives each **with an active progress record** (`recallProgress`) one at
   a time through `runDocUnit` — the resumed-run clean exemption is the
   existing rule, and the unit's own scope dirt is its resumable state
   (handoff.md, partial artifacts — exactly what the worktree world's
   re-dispatch resumes from);
3. a leftover **without** an active record keeps today's posture when its
   turn comes: the gate sees dirt outside any live scope and blocks for
   the human (the serial world's answer to a killed session, unchanged —
   the authority over git state stays with the person).

The recovery ladder itself needs no relaxation (D5's verification: its
dirty clause reads external trailer-less commits, not worktree dirt). The
resume path's one genuine hazard is the **rollback** verdict:
`rollbackUnit`'s protocol is per-repository and tree-wide — `stash push -u`
of everything uncommitted, then `reset --soft` to the baseline and a second
stash reclaiming the posted partial work — which under the flatten would
sweep the *siblings'* dirt into the rolling unit's stash and retract the
siblings' committed shares that landed after its baseline. Rule: the
rollback verdict is honored only when the registry holds **no other
leftover doc unit**; with siblings present it becomes the human posture —
stop 2 naming the unit, the ladder's reason, and the sibling scopes. A
single-leftover kill (the common case: one lane was ahead when the process
died) keeps today's exact rollback semantics.

AUTO-DECISION (refuse-in-place, not a scoped rollback): a pathspec form of
`rollbackUnit` (`stash push -u -- <scope>`; the soft reset has no pathspec
form at all) was considered and deferred — it would be a third rollback
variant beside the protocol's serial semantics (stash recoverability,
upstream detection), bought for a rare case (a kill plus a strict-resume
infidelity in the same flatten) that the honest stop serves better.

AUTO-DECISION (no auto-cleanse of record-less leftovers): softening this —
committing the partial as an `interrupted`-scene commit and re-running
fresh — was considered and deferred: it is a behavior change to the serial
floor's recovery semantics dressed as a doc-lane convenience, and the
block-for-human path is honest, rare and already understood.

## D11 — The prompt and planning sides

- **Session guidance** (stage D): the whole-task and wrap-up templates gain
  a short concurrency clause, rendered only under a new `docLane` render
  fact (true exactly for a doc lane's units — solo and serial units'
  prompts byte-identical): *sibling doc units run beside you; write only
  inside your declared `Touches` (your own `docs/T-NNN/` included); the
  phase index and every other task's documents are read-only to you; reads
  of sibling documents are fine.*
- **Planning discipline** (stage D): the `parallel` level's planning
  guidance — the intent pack's `### parallelism` section
  (`parallelismVars` → `intentText(facts, "parallelism", level)`),
  `templates/intents/default.md` — gains the doc-lane declaration clause:
  in doc-writing phases, declare `Depends:` honestly (`none` where the work
  is independent — the G3 default chains undeclared tasks serially) and
  `Touches: docs/T-NNN/` on every task; the declaration is what the
  scheduler admits on. dm-glm's P01 planner already writes exactly this
  shape — the guidance generalizes the proven example; its P02 is the
  worked counter-example (17 undeclared tasks = one serial chain).
- No AGENTS.md-block change, no new marker lines, no new parsed protocol
  (see §Protocol surface).

## D12 — Observability

- the dispatch and landing lines bracket each doc lane through the existing
  `taskBracket` lead ("starting a doc lane (attempt n)") and the done/
  blocked vocabulary — the log stream stays unit-named, interleaving
  accepted exactly as the lane loop's relayed lines interleave;
- preflight's parallel log line gains the doc-lane note when the branch
  will run ("…; doc lanes on") beside the tier reason;
- run-status keeps `task-start`/`task-end`; a `doc-lane-dispatch` /
  `doc-lane-landing` event pair (the 0067 bus shape) is stage-C optional —
  add only if a consumer needs it, the task events already carry the story.

## The protocol surface (what does NOT change)

No new driver-parsed literals: `Depends:`/`Touches:`/`Decompose:` grammar,
`Result: PASS|FAIL`, receipt fields, `Status:` handoff lines — all
unchanged (plans/0035's registry gains nothing to register; the switch
name, log strings and the refuse-message of D2 are observability, not
protocol). The kill switch `OPENCODE_AUTO_DOC_LANES` follows the house
pattern of `OPENCODE_AUTO_REGRESSION`: default on, env-only, never
persisted, removing the machinery never the floor beneath it.

No new config key: activation rides the existing `parallel` level +
`--max-sessions` + `treeLanes` (constitutional keys stay frozen). No new
document role, no new receipt home, no new commit stage — the doc lane's
commits are the ordinary `T-NNN exec|wrapup|done` grammar, scoped.

## Stages

- **Stage A — the substrate.** The D8 audit and queues (units.json, index
  ticks, stats booking attribution, resolves/events appends). Pass-through
  at concurrency 1 — the serial floor's behavior unchanged. Acceptance:
  two concurrent `runTask` pipelines over the agent-fake double produce no
  lost updates (a test that fails by construction before the queue, passes
  after).
- **Stage B — the pure half.** `docEligible`, the effective-scope helper,
  `docScheduler` (src/lanes.ts); `createDocLaneGit` (src/git-ops.ts) with
  the D4 scope rule and commit queue, the D5 gate relaxation, the D6 guard
  + quarantine; the D7 scoped variants (`commitTree` scope param,
  `unitViolations` exclude, `unitChangedFiles`/`unitAddedLines` scope,
  `commitRangeText` pathspec); `OPENCODE_AUTO_DOC_LANES` (src/switches.ts);
  the D2 `--handover-test` refusal. Unit tests over the pure pieces and the
  decorator with a fake base.
- **Stage C — the loop.** `runDocLaneLoop` + `runDocUnit` (src/loop-task.ts),
  the branch chain, the recovery flatten (D10), `regressionBoundary` at
  landings, the `drain` callback threading to `runWrapup` (D9), the
  `runTask` input `scope`. Integration tests with the agent-fake double
  (test/agent-fake.test.ts cases: concurrent disjoint units, admission
  under overlap, the landing guard's block + quarantine, park under
  concurrency, recovery flatten, the byte-identical floor of D2).
- **Stage D — the guidance.** The `docLane` render fact and the template
  clauses (whole/wrapup), the `### parallelism` declaration discipline,
  goldens regenerated (test/prompt-exec.test.ts, test/prompt-phase.test.ts,
  test/prompt-template.test.ts — the AGENTS.md rule for prompt changes).
- **Stage E — close.** The AGENTS.md navigation line and the docs/
  structure.md row (the two-level pass's stage-0 vocabulary), full
  `bun test`, `bun typecheck`.

## Tests

- `test/doc-lanes.test.ts` — the pure predicates (eligibility's three
  clauses, effective scope, disjointness admission, `docScheduler`'s truth
  table), the decorator (own-scope add, everything-minus-excludes add with
  and without live lanes, the serialized queue's commit-at-a-time, the
  landing guard's block and quarantine tolerance, `commitPending`'s file
  rule), the scoped variants' byte-identity without the optional
  parameters, and the D2 floors (no parallel / one session / switch off /
  no eligible units → the serial loop's observable stream).
- `test/agent-fake.test.ts` — the concurrent-pipeline cases of stage C; the
  fake's 13-call coverage keeps holding.
- The prompt golden suites per stage D; `test/import-direction.test.ts`
  consulted if stage B/C add a cross-module import (expected: none beyond
  today's directions — loop-task → lanes/git-ops are existing directions).
- `test/chain-writes.test.ts` untouched by construction (no `SessionChain`
  writes are added).

## Risks

- **In-process session concurrency is the load-bearing bet** (D3's
  AUTO-DECISION). Stage A's audit is its retirement plan: enumerate the
  module-level mutable state in the session-driving layer (the engine
  concerns' state slices, the services holders, the ambient `services()`
  accessors) and either instantiate per-pipeline or queue. A preliminary
  scan is encouraging — the engine's only module-level mutable state is
  the events emitter's file descriptor (`src/engine/events.ts`); the
  audit's named suspects are the router/keyring server-restart path under
  concurrent session failures and the questions concern's human-wait
  sideband, beside D8's files. If the audit finds something unfixable, the
  fallback shape is D3's rejected alternative (session-worker children the
  parent signals per session) — named, not planned. Known-accepted
  wobbles, documented rather than fixed: a landing's `clearDownMarks
  ("task", …)` may clear a sibling's task-scoped model down mark early
  (worst case a sibling retries a down model — bounded by the failback
  machinery); interleaved log lines (accepted — every line is
  unit-named).
- **A wrong `Touches` declaration** no longer degrades to a merge conflict
  (the worktree world's surface) but to D6's block — equally loud, earlier.
  The fail-safe directions of G3 keep undeclared tasks serial.
- **The drain costs** (D9): mixed phases pay a drain per ineligible unit.
  Bounded by phase typing in practice (dm-glm's phases are cleanly a/d vs
  m/t); the two-band mix is the named follow-up if a real round measures
  the drain hurt.
- **Quarantine is tolerance, not repair** — it exists so siblings can land
  around a blocked unit's stray writes; the human still owns the dirt.

## Non-goals and follow-ups

- Two-band concurrency (doc lanes + worktree lanes in flight together) at
  tier ≥ 1 — the D2 AUTO-DECISION's deferred half.
- Doc-eligibility beyond `docs/` (wider process-role boundaries) — needs
  its own contention evidence.
- `pipeline`/split units as doc lanes — they keep the tier ≥ 1 story; under
  doc-lane mode they degrade serially.
- Softening D10's record-less leftover block.
- The manual prompts suite's matching protocol delta (`prompts/run.md`'s
  "one at a time" rule — a concurrent-child-session vocabulary for the
  person-driven master control). Only if dm-glm or another target actually
  hand-drives a doc phase; the driver feature stands alone.

## The dm-glm projection, honestly

P01-shaped phases (wide, declared, docs-confined) are the win: ~2.5–3× on
the phase wall at width 3. P02-shaped phases win only after their planner
declares (D11 — the guidance ships in stage D; the already-complete P02 is
the counter-example on record, not a retrofit target). P03/P04 gain
nothing, by design — their contention is real, and their cost is 0098's
war. dm-glm's R-01 is mid-P04 today; the claim on this target is R-02's
analysis and design phases and every future doc-heavy round — the round
where a 48-task fan-out takes a day and a half instead of five.

# 0096 — Test lanes, the dependency park, and tiered parallelism

Three designs ruled together, the first two ported from the dm-glm fork of
the manual suite (`/home/wxl/workspace/root/dm-glm/prompts/`, a pre-0095
snapshot with both running in production there), the third the review's
addition:

- **Test lanes**: a task's suites run as parallel background processes —
  planned per project into a lane table, cheap lanes first, one expensive
  anchor after they green, narrow re-runs after fixes, per-lane receipts as
  durable evidence. Extended beyond dm-glm: the lane table becomes the
  project's declared *dependency vocabulary of tests* (each suite names the
  code surfaces it exercises), which makes re-running only what a diff
  touches a mechanical rule, not a session's judgment.
- **The dependency park**: a task whose remaining tail is blocked on another
  task's work parks — its landed consumables release its successors and its
  blocker, it resumes once the blocker closes. Extended beyond dm-glm: the
  park's honesty gate becomes machine-checkable through the existing
  `Artifacts:` declarations, and the resume note carries the re-merge surface.
- **Tiered parallelism** (the 0068 amendment): a full git worktree per lane
  does not scale — git already shares the object store between linked
  worktrees, so the per-lane disk cost is the *entire working tree* (x-GB on
  a big checkout), and each lane additionally regenerates its own build/test
  artifacts, which on such projects dwarf the checkout: N lanes ≈ N ×
  (checkout + artifacts). The principle that falls out: **buy parallelism
  where it is cheap — processes before trees — and pay for a second tree only
  for true concurrent code edits, at the cheapest materialization the
  filesystem allows.** Tests are the long pole (dm-glm's own reality: serial
  task sessions, parallel test processes), so Tier 0 process parallelism
  captures most of the wall-clock win at zero disk cost.

Ruled with the person, 2026-10-14: (1) the park's status word is
`Status: park <task id>`, not dm-glm's `Status: pending` — "pending" already
means *todo.md present* in both suites' readiness vocabulary, and the blocker
id belongs on the machine-parsed line; (2) the dm-glm-local pieces stay out
(D18); (3) staging — Stage 1 the manual suite, Stage 2 session-side lane
guidance, Stage 3 driver-run lanes with mechanical carry-forward, Stage 4 the
park, Stage 5 lane tiering; (4) the review's ruling — 0068's blanket
worktree-per-lane is demoted from the default to the explicit tier, Tier 0
process parallelism becomes the default execution surface under
`--max-sessions ≥ 2`.

## Part I — Stage 1: the manual suite

`prompts/run-task.md`, `run.md`, `run-verify.md` change;
`test/manual-prompts-ratchet.test.ts` syncs. No new suite files, so the
`install-prompts` registry is untouched.

## D1 — The lane protocol (suite text)

The testing phase's rules, adapted from dm-glm with the container-executor
phrasing generalized to "the project's own runner" (the lane plan derives
from the project's actual suites — nothing hardcoded in the prompt):

- Plan first into `docs/T-NNN/testplan.md`: per suite its exact command, its
  log path under `/tmp/opencode/`, the verdict line its log carries, the code
  surfaces it exercises, and its cost class — minutes-scale cheap lanes
  (lint, format, env canary) versus the one expensive anchor (a full gate).
- Carry-forward: a lane already green in `docs/T-NNN/testhands/` whose
  surfaces no later fix touched keeps its verdict — re-use, don't re-run.
- Cheap-first: cheap lanes launch together; an anchor launches only once they
  are green (an anchor started beside a cheap lane that vetoes it is a doomed
  long run).
- Each lane is a background process writing its log with the exit code
  appended (`…; echo LANE_RC=$? >> <log>`); poll every few minutes — each poll
  is the keep-alive — and read verdicts from the log tails mechanically.
- On failure: read the failure region, diagnose, fix while the other lanes
  keep running; kill any running lane whose surfaces the fix touches; re-run
  narrowly (only lanes whose surfaces intersect the fix); re-green the cheap
  tier before any anchor re-launch. Two consecutive cycles that close nothing
  on the same finding → stop retrying, record it in the handover, end.
- Receipts in `docs/T-NNN/testhands/<lane id>.md`: the lane line, the tree
  HEADs, start and end times, the verdict, and for a failure the bounded
  evidence (the ends of the failure region plus the log path); the standard
  terminator. The acceptance anchor's green receipt is the evidence the
  verification session checks.
- Never end a session with a lane in flight: hand over at lane-set boundaries
  only, every process exited or deliberately killed with its log state
  recorded. The per-test-type handover boundary of 0086 retires into this
  lane-set boundary; the budget rule stands.

`run.md`: the one-at-a-time rule gains the clarifying sentence (lanes are
processes inside the task session, not child sessions); the begun-task
artifact list gains `docs/T-NNN/testplan.md` and `docs/T-NNN/testhands/`;
the park-and-resume section gains the lane override — a task whose lane table
names suites without green receipts is mid-testing-phase, the task child is
the role to relaunch whatever the last commit says — save for a parked task,
whose park outranks the override (its open lanes are exactly the blocked
tail).

## D2 — The park in the suite: grammar, duties, procedure

The handover's status line widens to `Status: continue` | `Status: done` |
**`Status: park <blocker task id>`** — the blocker named on the
machine-parsed line itself. The park's honesty gates, dm-glm's substance
kept: park only after verifying the block at code/document level with the
evidence recorded; only when everything of the task's scope that other tasks
consume (findings ledgers, artifacts, receipts) is complete and landed — a
park releases the task's successors and its blocker, so it is honest only
with the consumables done; the exact resume steps recorded; never loop
`Status: continue` handovers against a block only another task can lift.

The master-control procedure on reading a park line: (1) validate — the
blocker exists in the index and is not itself parked, else stop and report
(mutual parks land in the existing unsatisfiable-graph stop, the person's
call); (2) land the park commit — the parked handoff as its own commit,
subject `<task id> park <task title>`, trailers `Auto-Task: <task id>` and
`Auto-Stage: park`, the gap-list exclusion as a share — and a `Status:
continue` handoff whose content names just such a verified external block may
be parked the same way, the flip to the park line riding the park commit;
(3) amend the blocker's `Depends:` field by removing the parked task's id
when the field lists it — the cycle's explicit edge, possible in the suite
because nothing validates its graph, a one-line edit riding the park commit;
(4) back to the loop — readiness counts a parked task as done for its
successors (explicit `Depends:` and the index-order default alike); the
parked task is ready again only once its blocker's `done.md` exists, at which
pick the master control flips the handoff's line `park` → `continue` (a
sanctioned one-line driver write riding the resumed task's next share) and
dispatches the task child. The park commit is not a share — 0094's ordinal
counts shares of one role, the park is its own stage, no interference.

`run-verify.md` check 1 widens to two more legitimate range shapes: the
task's own park commits (protocol state, excluded from check 3's diff), and
other tasks' commits (an `Auto-Task:` trailer naming another id) that landed
between this task's shares while it sat in the park — out of unit, excluded
from every check. The missing-status-line relaunch feedback widens to
`Status: continue|done|park <task id>`.

## Part II — The test lanes, extended

## D3 — The lane table: tests get a dependency vocabulary

The unifying move: the lane table is to tests what `Depends:`/`Touches:` is
to tasks. Its home is the intent pack — a `### test-lanes` section holding
the project's suite table, one row per suite: **name, command (the project's
own runner — a container harness, a make target, whatever the project uses),
cost class (cheap | anchor), surfaces (the directories/files the suite
exercises), and exclusivity** (whether the suite must run alone in the tree —
two lanes that invoke the same build directory collide; a lane declared
exclusive is serialized against its peers). Per-project and versioned in the
pack overlay — this is the "according to project setting" translation: the
project declares its suites once, sessions and driver both read the same
table. A task's `## Acceptance` names which table row is its anchor.

Two consumers, one rule set:

## D4 — Stage 2: session-side lanes

No driver machinery — D1's protocol taught where the self-check discipline
lives: the pack section renders into the execution prompts beside the
existing self-check sections (`src/intent/types.ts` + `load.ts` registry),
with one addition over the suite text — the channel clause: under
`--test-by-driver` the driver channel owns what it covers, so session lanes
run only what the acceptance names beyond that channel; never both channels
running the anchor. Paths join the vocabulary: `docs/T-NNN/testplan.md` and
`docs/T-NNN/testhands/` enter the task-role path family
(`src/document/roles.ts`) and the AGENTS.md storage line
(`src/agents-block.ts`); receipts carry the terminator (no eof exemption);
P1 unaffected (`docs/T-*` already prohibited in deliverables wholesale).
`templates/prompts/wrapup.md` gains the clause that executable-check evidence
may be the inspected receipts — judged by inspection, never re-run (0083).

## D5 — Stage 3: driver-run lanes — the `--test-by-driver` channel generalized

The 0083 driver test channel (compilation and test runs, the `git stash
create` guard) generalizes from serial scripts to the lane scheduler:

- After a task session ends and its share commits, the tree is frozen at a
  known state — the driver launches the table's cheap lanes as its own
  parallel background processes (logs under `/tmp/opencode/`, exit-code
  appended, the existing watchdog watching), then the anchor once they green.
  Lanes marked exclusive serialize. The stash guard extends to the lane set:
  tracked mutations a lane leaves are restored as today; a moved HEAD still
  hard-blocks.
- **Carry-forward, mechanically**: before launching a lane, the driver
  compares the lane's declared surfaces with the unit's changed paths since
  that lane's last green receipt (`git diff --name-only` over the receipt's
  recorded HEADs..HEAD) — intersection empty ⇒ the receipt carries, the lane
  is not launched. The suite states this rule as prose for the session's own
  lanes; here it is the driver computing it. This is incremental execution
  over the test graph, the same principle `Depends:` gives tasks: a phase of
  ten tasks with localized diffs runs its full gate on the intersecting
  minority, not ten times.
- **The anchor pre-gate**: the wrap-up dispatch checks the anchor receipt
  green before dispatching the verify session — a red anchor goes straight
  into the 0083 fix loop instead of a verify session that would FAIL on the
  same finding.
- Wrap-up of unit N dispatches only when N's lanes have all exited (the
  driver knows its own pids — no waiting session, just dispatch order).

Tier 0's whole win lives here: one tree, zero extra checkouts, tests — the
long pole — parallel and incremental.

## Part III — The dependency park, extended

## D6 — Consumables: the honesty gate becomes machine-checkable

The park's load-bearing gate is "everything other tasks consume is landed".
That is checkable, because the unit model already has the declaration: the
`Artifacts:` spec table (M1.1/M1.4, `src/document/spec.ts`) *is* the
consumables declaration. No new field:

- **Park validity**: every `Artifacts:` entry the parked task declares is on
  disk and committed (the existing spec-driven mechanical check) — else the
  park is an invalid handoff (the one relaunch with feedback). Tasks
  declaring no artifacts fall back to the prose gate (the session's own
  claim, inspected at wrap-up as any claim is).
- **Plan-time inversion detection**: the formulation collect gains a soft
  warn when a task's `## Scope` references a consumable of another task that
  depends on it (the planner is invited to reorder, merge, or split before
  the inversion can ever run) — a warn, not a block: discovery mid-flight is
  sometimes genuine new knowledge.
- The charter's task-writing protocol (0095) gains the encouragement: a task
  whose output other tasks consume declares it in `Artifacts:`.

## D7 — Stage 4: the runtime park machinery

- **Parse**: `handoffStatus` (`src/document/roles.ts`) keeps `continue|done`;
  a new `parkDirective` reads the last line `Status: park <task id>`, checked
  first — else execute.ts's invalid-handoff feedback fires on the
  unrecognized line. Kill switch `OPENCODE_AUTO_PARK`, default on (the
  0080/0082 pattern); off → the park line is the invalid-handoff case.
- **State**: the unit record in `.auto/units.json` gains `parked?: string`
  (the blocker id) — runtime state, never a document, the invariant holding
  where dm-glm's could not (the manual suite has no units.json).
- **Scope v1**: whole-task sessions only — `whole.md` gains the park
  paragraph; covers the default `--subtask off` and auto's whole runs.
  Streams and the subtask pipeline keep `continue|done` (their cross-task
  blocks are rare by construction — the split guard orders independent
  streams, subtasks live inside one task — and report through the existing
  stuck/question channels). Steer channels unchanged: a wall hit is not a
  foreign block.
- **Landing**: the park commit — `<id> park <title>`, `Auto-Task: <id>`,
  `Auto-Stage: park` — carrying the handoff; the close-out's accepted trailer
  set gains `park`. **No `Depends:` amendment**: the runtime's graph is
  validated (`unitProblems` rejects cycles at collect), so the park only ever
  releases a *discovered* inversion — B `Depends: A`, A mid-flight finds its
  tail needs B's output — never breaks an explicit edge. The suite's D2.3
  amendment is the manual world's compensation for its missing validation.
- **Readiness**: the pick sites (`nextReady` callers in `src/loop-task.ts`,
  `readyUnits` in `src/lanes.ts`) compose effective done = done ∪ parked; a
  parked unit is not selectable while its blocker is undone.
- **The release note**: when the blocker closes, the dispatch prompt carries
  the resume steer — the blocker's id, how it ended, and the **re-merge
  surface**: the blocker's changed paths ∩ the parked task's `Touches:`,
  computed by the driver — the files the successor must re-read first, since
  they moved under a task that was planned before the blocker existed. A
  blocker that ended person-closed (`Closed:`) or FAIL-closed under
  `--repair` still releases the parked task (`done.md` present) and the note
  names how it ended; the successor judges whether the consumable it waited
  for exists, and may park again on another task or surface gaps. A park
  naming an id outside the phase's index is invalid (readiness counts
  external ids done — a cross-phase block is a planning failure, stop and
  report).
- **Lanes composition**: a lane worker that parks ends its child (the lane
  report carries the park); the branch and worktree hold the landed prefix
  exactly as an interrupted lane's; resume dispatches a new lane child on the
  same branch — the landing merge may then hit 0068's `merge-repair` path,
  which is the correct one: both tasks touched the same files, which is why
  the block existed.
- **Deadlock**: a park naming a nonexistent id is a collect problem; mutual
  parks leave nothing ready with parked units remaining — block (exit 2)
  naming the pair, the person's call. The 0082 blockage dossier is the
  natural home if it fits without new grammar; v1 the plain block line.
- **Wrapup**: a parked task never reaches wrapup; the wrapup session's range
  may contain its own park commit — `wrapup.md`'s range description gains the
  shape, mirroring run-verify's check 1. Under lanes, other tasks' commits
  never enter a unit's range (worktree isolation) — the D2 range shape is
  suite-only.

## Part IV — Stage 5: tiered parallelism (the 0068 amendment)

## D8 — The cost model

`git worktree add` shares the object store and refs with the main repo — the
per-lane disk cost is the checked-out working files, plus the build/test
artifacts each lane regenerates (on a kernel-class tree, several times the
checkout), plus the cold-build time per lane. N concurrent lanes ≈ N × that.
The manual suite pays none of it: one tree, lanes are processes. The runtime's
amendment makes the same trade explicit:

## D9 — The tiers

- **Tier 0 — process parallelism, one tree (the default under
  `--max-sessions ≥ 2`)**: the driver-run lanes of D5 (tests parallel and
  incremental against the frozen tree) plus the session lanes of D4. No
  worktrees at all. Where the wall-clock actually goes, this is most of the
  win; for big-repo projects it may be all of it.
- **Tier 1 — cheap materialization for code-parallel lanes (opt-in)**: when
  true concurrent *code edits* are wanted, the worktree is materialized as
  cheaply as the filesystem allows:
  - **Sparse**: `git worktree add --no-checkout` + cone-mode sparse-checkout
    over the union of the unit's `Touches:` directories (plus a
    project-declared floor). The landing machinery is untouched — the branch
    records the full tree; sparse affects only the working materialization.
  - **CoW**: probe `cp --reflink=always` (btrfs/XFS) and materialize the
    sparse set by reflink from the base checkout — byte-shared until
    divergence, always safe. Hardlink farms are *rejected* (an in-place
    writer corrupts the base); overlayfs is *rejected* (privilege or
    fuse-perf). No capability ⇒ no Tier 1, fall through.
  - **Shared caches**: a config surface `lanes.caches` — the project
    declares well-known cache homes (CCACHE_DIR, SCCACHE_DIR, GOCACHE, pnpm
    store, …) with a concurrency class (shared-safe ⇒ one path under
    `.auto/cache/` for all lanes; serializing ⇒ per-lane paths — cargo's
    target dir locks, so it is per-lane). The lane launcher injects them
    into the child env. This is the direct answer to "the test might be even
    larger": the artifact multiplier becomes a cache hit rate.
- **Tier 2 — today's full worktree (the explicit fallback)**: 0068's
  behavior, unchanged, for repos that want it knowingly.

## D10 — The config surface and the probe

The `parallel` key keeps its planning-guidance grammar (none|low|medium|high
— how hard planners chase independence); the execution tier is a new
optional key `treeLanes: auto|on|off` (init/amend, the constitutional
pattern): `off` (the default) = Tier 0 always; `on` = Tier 2 unconditionally
(today's behavior, named); `auto` = preflight probes — reflink capability
and a declared budget `lanes.treeBudgetMB` against the working-tree size —
and logs the chosen tier with its reason. `OPENCODE_AUTO_LANE_ISOLATION`
(the existing one-lane forcing switch) keeps its meaning beneath whatever
tier is active.

## D11 — Hazards named once

- **Shared-tree build collisions** (Tier 0, D5): two lanes invoking the same
  build directory collide — the lane table's exclusivity field is the
  protocol; where the build supports out-of-tree output the command points
  its OUT dir per-lane.
- **Cache concurrency**: only the declared shared-safe class shares one
  path; everything else is per-lane. The driver never guesses a tool's
  safety — the project declares it.
- **Containers**: a project that tests through a container harness (as
  dm-glm does) writes its container commands into the lane table — the
  project's choice inside its rows, never driver machinery; the driver
  assumes no runtime and pulls no images.

## D12 — Deliberately not ported

The container-executor phrasing (generalized to the project's own runner);
dm-glm's person-directed protocol-edit exemption under `prompts/` (their
suite is hand-edited mid-run; ours ships versioned from this repository and
`install-prompts` resyncs byte-identical — blessing such commits would bless
drift); dm-glm's pre-0095 planning flow (the port lands on the formulation
task); subtask- and stream-level park (v1 scope, D7).

## D13 — Test surface and docs

- Stage 1: `test/manual-prompts-ratchet.test.ts` pins the new literals
  (`<task id> park <task title>`, `Auto-Stage: park`, `Status: park <task
  id>`, the widened feedback grammar, the testplan/testhands mentions, the
  lanes-are-processes sentence) and widens the status-grammar checks.
- Stage 2/3: prompt goldens gain the pack section; roles tests the new
  paths; a new `test/lane-table.test.ts` (table parse, carry-forward
  intersection, exclusivity serialization, the pre-gate); the `--test-by-
  driver` suites amend for the lane set and the stash guard over it.
- Stage 4: a new `test/park.test.ts` (directive parse incl. the switch,
  record round-trip, effective-readiness picks, artifact-gated validity,
  landing commit shape, release note with the re-merge surface, park ×
  closed-blocker, mutual-park block, close-out trailer); the pinned suites
  amend (execute, tasks, lanes, verify-loop, resume, formulate-collect).
- Stage 5: `test/lanes-tier.test.ts` (probe outcomes, sparse materialization
  set, cache env injection, budget refusal) and the preflight log line.
- This repository's `AGENTS.md` gains one navigation line for the trio
  pointing here; `docs/structure.md` only if src files are added (the parse
  lives in `src/document/roles.ts`, the state in `src/tasks.ts`, the lane
  scheduler beside `src/script.ts`, the tier probe in `src/loop-preflight.ts`
  — no new modules expected).

## D14 — Sketches (later changes, not specified here)

- **Anchor pipelining**: while unit N's anchor lanes run, the next ready
  unit's understanding/decompose session (reads source, writes only its own
  `docs/T-NNN/`) may overlap; unit N's wrap-up dispatch waits for both its
  lanes *and* the overlapped session to end — the recursive unified-commit
  sweep must never fold another unit's in-flight writes into N's close-out,
  so the overlap window closes before wrap-up, not after.
- **Retention**: lane logs under `/tmp/opencode/` prune per run; receipts are
  committed and small; nothing else persists.
- **Stream-level park** (lifting D7's v1 scope) once the whole-task park has
  production miles.

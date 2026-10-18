# 0104 — Parallel waves in the manual suite: `parallel: <n>`

Ruled from the same measured shape that produced the driver's doc lanes
(plans/0099), transposed to the manual-driver prompt suite. The doc-work
phases of the faithful family — `survey,analysis,design,implement,test,
acceptance` — plan many small tasks whose commits never leave `docs/T-NNN/**`
(analysis, design, acceptance above all; dm-glm's round had 15-wide and
14-wide a/d waves there). Run through `prompts/run.md` those waves ran
strictly serial — one task child at a time, each a fresh session with its
startup cost — while the driver itself has had same-tree concurrency for
exactly those units since 0099. The person asked the obvious question: can
the manual suite have it too.

The answer is yes, and unusually cheaply, because the applicable driver
mode is **doc lanes at tier 0**, not the worktree lanes of 0068: no
worktrees, no `Auto-Stage: landing`, no lane branches — concurrent
pipelines in the one tree with the parent as sole git writer. That is
already the manual suite's substrate:

- the master control is the sole git writer (worker children never commit —
  a commit command inside a child is a hard failure; shares land at the
  master at each child's end);
- unit state is on disk per task (`handoff.md`, `gaps.md`, `testhands/`),
  so a wave of children stays inspectable per task;
- task children never touch the index or the state files (run-task.md
  constraint 1), so the only shared-write surface is the close-out;
- background-first child launch is already the policy (0092).

What the serial loop had that blocks concurrency, and how this design
re-keys each, is the decision log below. Everything is prompt copy: five
runbooks and the ratchet. No src change.

## D1 — the phrase and the floor

`parallel: <n>` in the hand-over line, beside the mode phrases and
`phases: all`: at most `<n>` task or fix child sessions in flight at once
(2–3 the sane range — the person knows their platform's subagent capacity;
a launch the facility refuses narrows the wave, named in the report).
Without the phrase the loop is exactly as written today — the serial floor,
byte-identical wording, mirroring every driver switch's default-off
discipline. The phrase composes with every run mode (`window` blocks wave
launches like any launch, `pace` waits before each launch as written, a
`sprint` wall lands every ended child's share before the Finish) and rides
the finish report beside the mode line so the restart repeats it.

## D2 — admission: the declaration, fail-safe

The manual twin of `docEligible`/`scopesDisjoint` (0099 D1), stated over
the task document:

- **whole-task**: the task's directory holds no `subtasks.md` — checked at
  every launch, so a task that decomposes mid-wave forfeits the wave (and
  the task child is told not to decompose under the parallel line, D7);
- **declared non-empty `Touches:` with every entry under `docs/` of this
  repository** — an undeclared task, or one naming any path outside docs/
  (code work, a nested repository — unreachable by construction, the same
  boundary the contention itself draws), never waves;
- **effective scopes pairwise disjoint**: the declared `Touches:` paths
  plus the task's own `docs/T-NNN/` directory, implied even when unlisted
  unless a declaration already covers it (a task declaring only a shared
  document still writes its report and gaps in its own directory —
  `docScope`'s rule verbatim); two scopes overlap when either path
  contains the other.

Every fail-safe direction keeps the serial floor: undeclared, code-touching
or overlapping tasks simply run alone. The wave forms from the ready tasks
in index order; the readiness rule's index-order default (`without the
field the task before it in the index`) never holds two tasks ready at
once, so only explicit `Depends:` declarations ever wave — which is why D6
teaches the planner to write them.

A ready task that is not admitted runs alone: while it is in flight no
other child runs (a code task beside anything is the one shape same-tree
concurrency cannot hold), and the wave re-forms after it.

## D3 — the wave loop's deltas over the serial loop

The loop's steps 1–7 run as written per task, with these overlays:

- **The pick** (step 1) becomes the ready set, admitted per D2, topped up
  to the width; per-task baselines recorded at each launch. The boundary
  check's second half (the task has not started) applies to every launch
  exactly as written; its first half (the previous task complete) is the
  readiness rule itself for a wave launch — the wave admits a task only
  with its declared `Depends:` all done.
- **The scoped share** (step 3): the add is limited to the ended task's
  effective scope — never the whole tree, which would absorb a live
  sibling's uncommitted writes into the wrong share. The gap-list
  unstaging is unchanged inside the scope; a docs scope never reaches a
  nested repository, so the share is this repository's alone. This is the
  runbook twin of the `createDocLaneGit` seam decorator's commit rule
  (0099: a live unit's commit adds its scope plus driver state).
- **The residue check** relaxes to the wave's truth: after a share the
  porcelain may list the transient gap lists, the live tasks' scope paths
  and a held park handover (D5) — anything else is residue, stop and
  report. The zero-write check is the same check taken over the unit's
  own paths.
- **Fix children ride the wave** under their task's own effective scope,
  the same admission and the same scoped shares.

## D4 — verification: one at a time, scoped, exclusive on git

Verification, handover, planning and formulation children are never
parallel. A verification **may** run beside live task children — its
writes are its unit's documents and the close-out state, disjoint from
every live scope — but never beside another verification: the close-out
ticks the shared phase index, and two concurrent close-outs would collide
on `tasks.md` (the manual twin of 0099's serialized shared-state
substrate). The master's own git writes never overlap a verification
child's flight either — a share landing due while one runs waits for its
end: git's index lock serializes concurrent commits anyway, and the rule
makes the serialization explicit instead of an error to retry.

The verification child itself is briefed with the live sibling task ids
(the master's fill) and keys three clauses on them:

- the worktree tolerance — the live siblings' uncommitted scope writes are
  as tolerated as the transient gap list (check 1's closing sentence and
  the intro's premise);
- the range check's legitimate interleaving generalized beyond the park:
  other tasks' own commits that landed between this task's shares **while
  it sat in the park or ran beside its siblings in a parallel wave** — out
  of unit, excluded from every check (the park clause of 0096 D2 already
  carved this shape; the wave only makes it routine);
- the path-limited diff (check 3): in a wave the diff is limited to the
  unit's own scope — its `Touches:` paths plus its own `docs/<task id>/`
  — so siblings' interleaved commits never enter the judgment (the
  scope-true evidence ruling of 0099, transposed).

The close-out commits keep their grammar (wrapup → done) with one delta:
every add is scoped to the unit's own directory and, where it ticks, the
phase index — never a sibling's path.

## D5 — parks defer to the drain

The serial park rule (0096 D2) has the master amend the **blocker's**
`Depends:` field riding the park commit — a write into another task's
document, unsafe under a live blocker session. In a wave the park defers:
validate the blocker as ever, then hold — the parked handoff stays
uncommitted inside its scope (tolerated like a gap list) and the park
commit, amendment riding it, lands when no child is in flight, the serial
rule verbatim. When the blocker closes before the drain, the park is
skipped altogether: the task is ready again, its handoff's line flipping
back to `Status: continue` at the pick, riding its next share.

## D6 — the declaration discipline (run-plan)

run-plan's task-document format gains the parallelism declaration
discipline, mirroring the intent pack's `### parallelism` (low) wording: a
documentation-scoped task — every path it will change lies under `docs/`
— also carries a `Touches:` field line listing those paths (its own
`docs/T-NNN/` implied) and `Depends: none` where its work really is
independent; name real paths and real prerequisites, never restructure
the plan to create independent tasks. The declarations are what the wave
admits on; a task without them runs one at a time. Declaring is harmless
in a serial run (the readiness rule reads `Depends:` only; `Touches:` is
inert information), so the discipline is unconditional, not gated on the
phrase.

## D7 — the child-side scope clauses (run-task, run-fix)

The master's fill of a task or fix child under `parallel: <n>` carries
one parallel line (sibling task sessions run beside yours; your writes
stay inside your task's declared `Touches:` paths and its own
`docs/<task id>/` directory), and both companions key their constraint on
it: writes stay inside the declared scope, the sibling tasks' directories
and every other path read-only (reading them is fine) — the runbook twin
of the `docLane` render fact's concurrency clause. One further clause in
run-task: **a parallel task does not decompose** — if the work needs the
subtask pipeline it hands over (`Status: continue`) naming that, and the
master reruns the task alone, outside the wave (the subtask pipeline's
own grandchildren are the one worker shape the master cannot schedule
around; `docEligible`'s whole-task leg, transposed).

## D8 — concurrent suites share one tree

Two wave children running the project's suites concurrently can collide
on shared build state (gitignored outputs never show in porcelain, so the
scope rules do not see them). The exposure is small — doc-work tasks
rarely run an anchor, and the cheap-first discipline of the testing phase
keeps the common case safe — so v1 rules the remedy, not a window: an
anchor that fails on infrastructure-shaped noise while a sibling builds
(a corrupted artifact, a lock error) is a relaunch with that feedback, not
a stall; count neither against the other. The driver's drain callback /
strict wait (0096/0099) was considered and rejected for the suite: the
child cannot observe siblings, and routing anchor timing through the
master's fill would add a channel for a rare case.

## D9 — restart, and what is deliberately not replicated

A restart re-derives a wave from disk exactly as the serial rules do,
widened: uncommitted content spanning several task scopes means several
children were in flight — for each such task (no `done.md`) derive its
role from its last share commit and relaunch it with a continue line, in
index order, the wave re-forming under the report's repeated `parallel:`
phrase (the recovery flatten of 0099, transposed to runbook prose; a
scope their paths do not describe still stops and reports).

Not replicated, on purpose: the worktree lane family (0068 — tiers 1–2,
landing stages, lane branches; a session-driven master managing worktrees
and merges is outside the suite's grammar, and doc phases do not need
it), the landing guard's quarantine (stray writes stop and report — the
person's call — instead of quarantining so siblings land around them),
and any anchor serialization window (D8). The suite replaces driver
machinery with rules a coding-agent session can follow; every replaced
piece is a rule that stops and names the person, never a silent repair.

## The ratchet

`test/manual-prompts-ratchet.test.ts` gains the 0104 block: the phrase
grammar and the floor (`parallel: <n>`, "the serial floor"), the
admission sentence ("effective scope"), the scoped share ("limited to its
task's effective scope"), the verification exclusivity ("never beside
another verification"), the park deferral ("defers to the drain"), the
report line's extension (keeping the 0091 pin "the `phases: all` phrase
when it rode" intact as a substring), the child-side clause in both
companions ("your writes stay inside your task's declared scope"), the
no-decompose clause, the verification's generalized interleave and
path-limited diff, and run-plan's admission sentence. The 0096 pin
"parallel lanes are processes, not child sessions" survives the launch
section's re-key — the sentence keeps its role for the serial default.

## Verification

- `bun test test/manual-prompts-ratchet.test.ts test/install-prompts.test.ts`
  — the ratchet with the new block green and every existing pin intact
  (the file-set pin unchanged: no new suite file, the wave lives inside
  the existing five).
- No src change, no typecheck surface; the suite reaches materialized
  projects through `install-prompts` resync as ever.

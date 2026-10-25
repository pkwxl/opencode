# 0125 — the activation decoupling: `--max-sessions` alone activates; `parallel` the guidance/posture key

The maintainer's ruling from a fielded refusal: the two knobs are made unrelated. `--max-sessions`
is the maximum concurrent sessions — width, and width alone activates the concurrent scheduler.
`parallel` is how deeply planning works to make implement/test tasks independent — the
planning-guidance level (the pack's `## parallelism` subsection) and the worktree landing-conflict
posture, nothing else. 0068 D10's activation rule (`maxSessions ≥ 2` **and** a level) and S3's
"plan for parallelism first" usage error retire; what runs concurrently is, as it always was at
admission, whatever the plan's `Depends:`/`Touches:` declarations allow.

This ruling Derives: **P17** (declared concurrency — the showing: admission was already
level-independent by D5's own words ("The admission rule is deliberately level-independent (D5)",
`src/lanes.ts`); the level was only a proxy gate standing in front of the declarations, and its
removal makes the runtime match the principle), **P10** (the byte-identical floor — the showing:
at `--max-sessions` 1 or absent the serial loop runs byte for byte whatever the level; a level
alone still changes no execution surface — task-prompt guidance rides width only, the held rule of
`src/opts.ts`), **P8** (deliberate enforcement moments — the showing: the removed usage error
blocked at the wrong moment, before any work existed to gate; a teaching log line replaces it, the
declarations themselves remaining the admission), and **P19** (measured evidence — the showing:
the incident, the bundle census and the tier fact below, each cited). It **Amends the
lane-scheduler activation rule** (plans/0068 D10/S3, and the level clause D19's stream stop
inherited — the rule restated: `schedulerActive` is `maxSessions ≥ 2`, width alone; provenance
carried: D10's guard existed so width would never run on an unarranged plan, and its reason is
recorded here as hollow on the measured field — the level it demanded was, on every bundle
project, a key that gates while injecting nothing). Tier touched: **mechanism** — core src, the
shell's run command, tests; no principle text, no template copy, no grammar change.

## Category scope (0123 D1's discipline)

Family: *the lane scheduler's activation and the two knobs feeding it.* Home-set enumerated at
ruling time:

| home | disposition |
|---|---|
| `src/lanes.ts` (`schedulerActive`, `worktreeScheduler`, `docScheduler`, `conflictRepair`, `laneParkProblem`) | changed — D1/D3/D6 |
| `src/loop-preflight.ts` (the guard, the tier log, the handover-test refusal, the orphan-recovery gate) | changed — D1/D2/D4/D6 |
| `src/loop-task.ts` (the two branch sites) | changed — D1 |
| `src/execute.ts`, `src/runner.ts` (the stream-as-lanes sites) | changed — D5 |
| `src/opts.ts`, `src/prompt.ts`, `src/config.ts`, `src/loop-plan.ts`, `src/prompt-plan.ts` (the guidance threading and the width rule) | consistent, held — D3 (comments reworded; the rule itself unchanged: guidance rides width, never the level alone) |
| `packages/auto/src/index.ts` (the shell guard, the `--parallel`/`--max-sessions` help) | changed — D2/D6 |
| comment-only sites (`src/switches.ts`, `src/split.ts`, `src/wrapup.ts`, `src/git-ops.ts`, `src/script.ts`, `src/work-order.ts`, `src/stats.ts`, `src/run-status-schema.ts`) | consistent, untouched — no behavior; none states the rule after the sweep |
| `templates/prompts/whole.md`, `decompose.md`, `templates/intents/default.md` (`## parallelism`) | consistent, untouched — the guidance texts teach what to declare, never that the level is required; accurate in the new world |
| `templates/bundles/{cleanroom,faithful,faithful-lean}/intents/*.md` (no `## parallelism` section) | deferred — D7 |
| `prompts/run.md` | consistent, untouched — the manual suite's `parallel: <n>` hand-over phrase is its own person-driven width channel, never the config key |
| `docs/principles.md` | consistent, untouched — no principle statement mentions the level or activation (measured); P17's derivation already carries "level-independent admission" |
| `docs/structure.md` | consistent, untouched — the rows name the activation policy's home (`src/lanes.ts`) without stating the rule |
| test homes: `test/lanes-tier.test.ts`, `test/doc-lanes.test.ts` (truth tables), `test/loop-preflight.test.ts` (the guard tests rewritten), `test/parallel.test.ts` (0046 D9's reservation case removed), `test/lock.test.ts` (the fast-exit trigger swapped), `test/lanes-scheduler.test.ts` (a no-level lane case added), `test/agent-fake.test.ts` (a no-level doc case added), `test/session-opts.test.ts` (comments; behavior held), `packages/auto/test/e2e.test.ts` (the two guard tests rewritten) | changed |

## The evidence

- **The incident** (2026-10-25): `auto run -i --boundary flow --max-sessions 6 --repair 3` on the
  cleanroom baseline project (`treeLanes: auto`, no `parallel` key) refused exit 1 —
  "`--max-sessions 6: concurrent execution needs a parallel level`". The project's doc phases
  (spec-read, design, audit) are exactly the same-tree doc-wave shape the manual suite runs with a
  one-phrase hand-over; the machine path demanded a constitutional key for it.
- **The bundle census**: of the four shipped packs only `templates/intents/default.md` carries a
  `## parallelism` section — none of the three bundles does (measured, grep over
  `templates/bundles/`). On every bundle project the demanded level would inject no guidance at
  all (the preflight warning at `src/loop-preflight.ts` says so) while still blocking the run: the
  guard's stated reason — "planning then arranges the tasks for it" — was hollow exactly where it
  bit.
- **The tier fact**: that project's filesystem (NFS, no reflink) resolves `treeLanes: auto` to
  tier 0 — the doc scheduler, same-tree, parent the sole git writer, no merges. The level's one
  runtime meaning that survives there (D21's landing-conflict posture) never engages at tier 0;
  its other meaning is the guidance text the bundle does not carry.
- **The machinery's own precedent**: D5's admission rule was written level-independent from the
  start; D21 keyed the conflict response to the level as depth, not as activation. The level was
  load-bearing at exactly one place — the gate in front — and at the lane worker's stream stop,
  where it served as the worker's proxy for "the parent's scheduler is active" only because the
  gate guaranteed the equivalence (D5's finding, re-verified for this ruling: `dispatchLane` is
  called only from the lane loop, its conflict re-dispatch and stream dispatch inside it, preflight
  orphan recovery, and the isolation loop — the last excluded by the switch at both sites).

## The ruling

**D1 — activation.** `schedulerActive(maxSessions)` is `(maxSessions ?? 1) >= 2` — width alone.
`worktreeScheduler(maxSessions, tier)` and `docScheduler(maxSessions, tier)` lose the `parallel`
parameter. 0096 D10's tier decision and 0099 D2's doc-scheduler placement are untouched beneath the
amended activation half; D11's interactive/wait-answer refusals stand unchanged as the concurrency
usage gates.

**D2 — the two guards removed.** Core preflight's usage error (`src/loop-preflight.ts`) and the
shell's run-command refusal (`packages/auto/src/index.ts`) are deleted. A width above 1 with no
level is a legal, scheduled run.

**D3 — `parallel` keeps exactly two meanings, both code-parallel depth.** (a) Planning guidance:
the `## Parallelism` block renders in formulation/append prompts whenever the level is set, and in
task-session prompts under the held width rule of `src/opts.ts` (`maxSessions ≥ 2` or a lane
worker — at one session nothing injects whatever the level, the floor). (b) The landing-conflict
posture: `conflictRepair(level)` unchanged — no level reads false, the low posture: the depth knob
unset spends nothing on merge repair. The budget is the depth the person opted into, never a width
default.

**D4 — a teaching note replaces the guard.** At the old guard's site preflight logs, when
`maxSessions ≥ 2` with no level, one line: tasks run concurrently only as their declared
`Depends:`/`Touches:` allow; a level (`init --parallel low|medium|high`) adds the planning guidance
that arranges independent tasks. P8's shape — detection records, the person decides. Never fires in
a lane worker (it carries no `maxSessions`) or at width 1.

**D5 — the lane worker's stream-as-lanes condition drops the level half.** `src/execute.ts` and
`src/runner.ts`: the condition is `opts.lane !== undefined && !laneIsolation` — the lane context
alone, since a lane worker is dispatched only by an active scheduler or the isolation switch (the
excluded case). No new fact channel: the old level half was the gate's equivalence, and the gate is
gone.

**D6 — messages reworded where the level naming became wrong or reachable-undefined.** The
`--handover-test` doc-lane refusal drops its `parallel <level>` interpolation (reachable with no
level since D1); `laneParkProblem` drops " / without a parallel level"; the shell's `--parallel`
help drops "required for concurrency" and the `--max-sessions` help teaches the declarations as
the admission instead.

**D7 — deferred: `## parallelism` sections for the three shipped bundles.** A guidance-data
question of its own (which levels, what depth text per bundle discipline), with a real consumer
only where a bundle project sets a level, and bundle content changes ripple through
`provenance.json`/`sync` for already-materialized projects — its own ruling when a fielded consumer
locks the shape (P21: a reserved surface is a name, never a half-built mechanism; since D1 the
missing sections cost guidance only, never concurrency).

## Enactment

Core: the three predicate signatures and their comments (`src/lanes.ts`), the guard→note and the
four call-site signatures (`src/loop-preflight.ts`), the two branch sites (`src/loop-task.ts`), the
two stream-as-lanes sites (`src/execute.ts`, `src/runner.ts`), comment rewords (`src/opts.ts`,
`src/prompt.ts`, `src/config.ts`). Shell: the guard and comment deleted, the two help strings
rewritten (`packages/auto/src/index.ts`). Tests: the truth tables re-pinned for the new signatures
with `worktreeScheduler(2, 2)` and `docScheduler(2, 0)` true at no level; the guard tests rewritten
to the passing-and-teaching shape; 0046 D9's reservation case removed from `test/parallel.test.ts`
(its pinned behavior is this ruling's own subject); the lock test's fast-exit trigger moved to the
D11 refusal; one no-level lane-loop case (`test/lanes-scheduler.test.ts`) and one no-level doc-lane
case (`test/agent-fake.test.ts`) added — the loop-level pins that width alone dispatches and lands;
the shell's two e2e guard tests rewritten (the no-level width now reaching preflight's D11 refusal,
the old guard message asserted absent).

Verification: full typecheck clean; both suites green; the closing read ran the real CLI on a
scratch project — `run --max-sessions 2` with no level passes the removed guard into preflight
(the tier line and the D4 note in the run log), `run --max-sessions 2 --interactive` hits the D11
refusal, `amend --parallel low` still stamps and a leveled run renders its guidance as before.

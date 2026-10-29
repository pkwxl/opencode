# 0150 — the next task number is derived, never recorded: the floor over the surviving artifacts is the whole mechanism

The maintainer's rulings (2026-10-28, over the aster-mig migration root's fork family, continuing the
0140 field line): *"The `--auto-number` mechanism seems overly aggressive; when continuing to formulate
plans in a forked branch, it assigns entirely different numbers, causing significant difficulty for
subsequent comparative analysis."* and the shape to adopt: *"I believe that based on the current
`docs/T-NNN/` mechanism, we can entirely generate new IDs by taking the maximum sequence number in NNN +
1, without needing to record and determine IDs elsewhere, as they strictly need to be generated
monotonically."*

## The measurement (the fork family's own numbers, the mechanism's archaeology)

- **The incident's shape.** `baseline-t002-forkA` and `baseline-t002-forkB` are worktrees of one shared
  repository (`cleanroom/baseline`), both forked at the same base commit (`81a5647`, "T-004 done") — each
  one's own lineage had used exactly T-001…T-004, so the deterministic floor was **5** in both. forkA's
  first run (20:07) opened the `number-recovery` route session (41.5 s) and landed `.auto/next-task` =
  **30**; its P02 formulation numbered T-030…T-037. forkB's first run (20:27) recovered **47** and
  numbered T-047…T-054. The same logical task carries disjoint ids — "Timer capability specification
  notes" is T-031 in forkA and T-049 in forkB — destroying the join key the person's comparative analysis
  needs, in the very workflow (`fork`, 0128 — "the experiment environment") the feature exists for.
- **Where the numbers came from.** The record is gitignored, so every fresh worktree lacks it and
  `ensureNumbering` opened the recovery session — 0001's mechanism for "numbers whose artifacts have
  since been deleted", whose prompt points at git history ("`git log --oneline` is enough"). But a fork
  family shares one object database: the sibling experiment branches were all visible —
  `auto-fork/T-006`, `T-013`, `T-021`, `T-027` and `auto-fork/2a74e8b` had each consumed up to T-029,
  `auto-fork/9271fa7` (the `baseline-old` worktree) up to T-046, `auto-fork/81a5647-2` up to T-049 — and
  the session counted every timeline's numbers as "used". The driver validated only the lower bound
  (`n >= floor`, `numbering.ts` collect), so the over-scoped derivation passed silently. Every new fork
  in the family ratcheted higher (29 → 46 → 49 across the recorded branches): "never reuse in the target
  directory" (0001) was being applied across *all timelines of the whole repository* — an AI session's
  evidence-scope judgment the driver could not audit (P7's exact blind spot: a mechanical question
  delegated to content judgment).
- **The floors were already file-based everywhere.** Every allocation site computed
  `Math.max(record ?? 0, floor)` (`formulate.ts`, `task-add.ts`) — in a steady directory record ==
  floor, so the record only ever pushed numbers *past* the disk evidence: exactly the aggressiveness
  measured. The collect's validation (`plannedTaskProblems` / `newTaskProblems`, `tasks.ts`) already
  keyed on file-derived state (`before: takenTaskIds`, `numberStart`) — nothing but the advance needed
  the record. And the never-repeat guarantee was already narrower than it read: a full restart has
  floor 1 and 0001's own floor-1 shortcut writes 1 with **no session at all** (the restarted
  `baseline` of 0140's field report re-issued T-001 through exactly that path); 0140 then ruled the
  downstream machinery corpus-bounded for re-issued ids. The deletion case the record exists for is
  off-protocol input under 0010's write-once permanence in the first place.

## D1 — the ruling: the floor is the whole mechanism

`taskNumberFloor` (the highest number any task index lists or any docs/T-* path holds, + 1; no evidence
= 1) becomes the entire allocation, derived at the moment of use:

- `constructFormulation` / `formulationNumber` (src/formulate.ts): the fresh-construction number is the
  floor; a standing formulation keeps its own id, unchanged.
- append planning (src/loop-plan.ts `appendPlan`): `numberStart` = the floor under `autoNumber`,
  undefined without it (the historical shape, byte-identical).
- `addTask` (src/task-add.ts): the floor, the same rule on or off.
- The formulation collect (src/runner.ts) validates exactly as before — collision and
  below-the-start checks over file-derived state — and advances nothing.

The record read/write/advance machinery (`readNextTask`, `writeNextTask`, `advanceNextTask`,
`NEXT_TASK_FILE`) and `ensureNumbering` retire with their tests; `taskNumber` and `taskNumberFloor`
(the module's whole export surface) stay. A derived number cannot be stale, cannot survive its
evidence, and a fresh clone or fork worktree continues exactly where its own files say — parallel forks
of one baseline assign the same numbers to the same logical tasks and stay comparable. Nothing
persists, so nothing is recovered: the recovery session, its `number-recovery` template, its protected
file entry and its requireArtifact wiring are deleted, not disabled.

## D2 — the vocabulary retires in one lockstep

- The `number-recovery` template leaves the embedded registry (src/template.ts) and the protected-files
  table; the golden pair retires with it.
- The `number-recovery` MODEL_ROLES word leaves the knowledge role's routing/templates lists
  (src/roles/registry.ts) and the vocabulary (src/switches.ts) — a registry route naming it now fails
  validation naming the legal words, the standing retirement shape (0030 D12's `understand`, 0044's
  `verify-*`; the models describe output regroups automatically).
- The `plan-numbering` / `append-numbering` session sites leave `SessionSite` (src/opts.ts) — their
  sessions no longer exist.

## D3 — the retired record's leftover self-heals

A `.auto/next-task` an earlier release wrote is removed at preflight
(`removeRetiredNumberingRecord`, src/loop-preflight.ts) after the `removeRetiredInvalidRefs` shape:
the file lives inside the driver's own gitignored state directory, any instance is ours, the deletion
rides no commit and logs one line. (Reading as nothing was never an option the corpus takes: a stale
mirror of no source is P5's defect shape, and CURRENT.md set the precedent.)

## D4 — the floors

- `--no-auto-number` is byte-identical: append keeps an undefined `numberStart` (the prompt's fallback
  start, the collect's collision-only validation), construction was already floor-based.
- The `autoNumber` config key stays a constitutional key (init/amend/fix unchanged); what it gates
  narrows to the enforced-start threading (append's `numberStart`, the run banner's "auto-number on") —
  the honest residue, recorded here.
- The retry-fork shape is untouched and now simpler: a worktree at the state before a task first
  started re-derives that task's own number from its own files' floor, with no record to disagree.

## D5 — the named residuals

- **A deleted-artifact number becomes reusable.** The person deleting a committed task directory is
  off 0010's write-once protocol; a full restart already re-issues from T-001 (0001's floor-1
  shortcut); 0140 keeps the fork-side machinery corpus-bounded for re-issued ids. Stale references to
  a deleted number remain the person's finding, as they already were under the floor-1 restart path.
- **Cross-timeline id agreement is intentional, not collision.** Two forks now assign the same numbers
  to their own (different) tasks; a naive tree merge would collide ids. Forks are parallel worlds the
  driver never merges (bring-back is plain git, the person's act — 0128), and the comparability is the
  ruling's point.
- **A registry route naming `number-recovery`** now fails validation (D2's tombstone); the remedy is
  removing the route entry.

Derives: P6 (the numbering state becomes derived-from-durable-evidence, the persisted record and its
recovery session deleted), P7 (the derivation is pure grammar over the id vocabulary; the retired
session was a mechanical derivation delegated to unauditable AI judgment), P19 (the fork family's
measured numbers — 29 → 46 → 49 → forkA 30 / forkB 47, the same task T-031 vs T-049 — beside 0001's
own floor-1 shortcut), P10 (the opt-out floor byte-identical), P13 (the template, role word and session
sites retire in one conscious lockstep).

Amends: 0001 (the record mechanism and the recovery session are retired; "T-NNN never repeat" is
re-scoped from the directory's whole history to its surviving task artifacts — monotonic within the
visible corpus, re-issuing across restarts as 0140 already ruled downstream). 0001's constitutional-key
ruling and the floor scan itself stand.

Tier: mechanism (src/numbering.ts and the allocation sites; the vocabulary surfaces; tests; the shell
help row and README).

## Tests

- test/numbering.test.ts: the record/advance/ensure describes retire; the floor describes keep; a new
  read-only pin (the derivation writes nothing, a fork-shaped tree continues its own lineage's numbers).
- test/task-add.test.ts: the numbering choice rewritten to the floor-only rule (nothing persisted, a
  fresh project numbers from T-001).
- test/formulate.test.ts, test/plan-loop.test.ts: the retired args and the "numbering record advanced"
  line go; the m-mode planning pin asserts no record file appears.
- test/loop-preflight.test.ts: the removeRetiredNumberingRecord describe (no leftover; one log line,
  no commit, tree clean).
- test/prompt-phase.test.ts, test/golden.test.ts (+ the golden file), test/template.test.ts,
  test/roles-registry.test.ts, test/tier.test.ts, test/session-opts.test.ts, test/models.test.ts,
  test/models-describe.test.ts, test/prompt-template.test.ts (the question-rule partial count 15 → 14),
  the loop fixture comment, and the shell's fake-claude branch, help row, README rows and e2e pins
  moved in the same lockstep.

Full typecheck clean in both packages; auto-core 2850 and the shell 148 passing (+ the E2E-gated
skips).

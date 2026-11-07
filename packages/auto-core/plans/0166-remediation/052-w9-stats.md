# Step 052 — w9-stats: stint ledger crash window, lanes section reset, per-unit heartbeat, run-end usage total, stint stamp time

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W9-lanes, findings **0165-121** (S15-01, S3), **0165-122** (S15-02, S3),
**0165-123** (S15-03, S3), **0165-124** (S15-04, S3) and **0165-125**
(S15-06, S3). Started 2026-11-08 at HEAD `9121c25bf` (steps 001–051 done);
ruled by [../0212-stats-identity-brackets.md](../0212-stats-identity-brackets.md).

## Findings (from plans/0165-review/S15-accounting.md)

- **0165-121 (S15-01, S3, P6/P18, 0152 D2)** — the "exactly-once per stint"
  ledger breaks in the crash window of the task switch: `statsTask` appends
  the closing stint's ledger line synchronously while the reset document
  reaches stats.json only through the async write queue; a kill between the
  two leaves the old stint open on disk, and the restarted run's `statsTask`
  appends the same stint a second time (same task and `since`, the same
  session log, usage counted twice, `wallMs` disagreeing).
- **0165-122 (S15-02, S3, P12/P6, 0068 S4)** — the stats document's `lanes`
  section is never reset — not at the round rollover, not at flush — so every
  later round's conclusion reports every lane ever landed in the directory,
  and the booked-report form claims "(booked into the totals above)" beside a
  round whose totals hold none of it.
- **0165-123 (S15-03, S3, 0099 D8, the stats.ts Handle header, 0019)** —
  `statsSessionEnd` still assumes one live session: under doc lanes (0099
  D8's per-unit active map) one sibling's end stops the shared heartbeat and
  reopens the segment as wall-only, so a still-running sibling's AI time
  stops counting (against the "union of AI-active wall time" caliber the
  header claims) and a kill -9 during its remaining run credits nothing past
  the sibling's end.
- **0165-124 (S15-04, S3, 0067 P2b/0068 D13, P12)** — the run-end bracket's
  run-scope usage total is wrong both ways: it re-adds earlier runs'
  consumption (the session roll-up carries the session entry's
  cross-interruption cumulative usage, and the emitter sums those into the
  run total — a resumed takeover counts the previous run's tokens again) and
  it omits every lane's (statsLaneUsage books the landed lanes' figures into
  the stats buckets without any roll-up event).
- **0165-125 (S15-06, S3, 0152 D1/D4(c), 0099 D8, 0019)** — a ledger line's
  identity and time are the close moment's, not the stint's:
  `taskStintRecord` stamps `phase`/`round` from the document at the next
  task's start, and `fold` books every segment into taskB whatever unit
  runs — so the last task of every phase is recorded under the next phase
  (the last of a round under the next round), with the boundary's handover
  distillation and formulation sessions' AI and wall time inside its
  aiMs/wallMs while its usage excludes them — and the constructor/fidelity
  (`synthesis`) and classifier one-shots inside its models section.

## Plan (enactment order; each ingredient lands green)

1. Read docs/principles.md; answer the boundary for each finding first
   (requirement family, home-set enumeration). Write ruling **0212** first
   (Status: active; Derives/Amends with showing clauses; Category scope;
   D1..Dn; premise guard; named residuals; P13 statement).
2. Enact per decision; regression pins that fail on pre-fix source.
3. Full verification (`bun typecheck`, `bun test`; baseline 3155/0/155).
4. Docs lockstep (INDEX row, AGENTS.md navigation, structure.md), ledger
   rows for 121/122/123/124/125, program position; single commit.

## Work log

- 2026-11-08: step record created; status table marked `doing` (starting
  HEAD `9121c25bf`). Read the S15 evidence, the source homes (stats.ts's
  load/statsTask/statsSessionEnd/statsLaneUsage/bucketUsage,
  stats-schema.ts's Bucket/taskStintRecord, run-status.ts's publish,
  run-status-schema.ts's events, lanes.ts's landLane book/landedEvent,
  conclusion.ts's laneRollupLines) and docs/principles.md; answered the
  boundary per finding; ruling 0212 written first.
- 2026-11-08: enactment — stats-schema.ts (D5i Bucket's optional stint
  `phase`/`round`, the lenient parse, taskStintRecord's stamp with the
  older-document fallback, the lanes roll note), stats.ts (D1
  `stintAlreadyRecorded` tail read + the load guard; D2 the rollover clear;
  D3 the sibling-aware close; D4a the `delta` on the session roll-up; D5i
  the stamp at statsTask; D5ii bucketUsage phase/round only; the comment
  truths), run-status-schema.ts + run-status.ts (D4 the additive `delta` /
  `usage` fields, publish's `addFigures` accumulating delta ?? usage and
  the lane landing's usage), lanes.ts (D4b the booked sites' `booked`
  flag carrying the detail usage), conclusion.ts (D2's "run-scoped"
  comment corrected — round-scoped).
- 2026-11-08: test homes — stats.test.ts (+5: the crash-window pin, the
  stint-identity pin, the sibling-union pin, the seam delta pin, the
  lanes-rollover pin; the classify and cross-interruption pins re-pointed
  to phase/round — the conscious lockstep of D5ii), run-status.test.ts
  (+1: the run-total pin), run-status-schema.test.ts (the samples carry
  the additive fields), lanes-scheduler.test.ts (the landing events carry
  the booked usage). Two enactment notes caught while testing: the schema
  samples' type-count equality means the delta coverage replaces the old
  task-scope sample rather than adding a second usage-rollup line; an
  early edit joined two lines of an existing test by accident — caught by
  re-reading and repaired before any run.
- 2026-11-08: fail-before proof over /tmp/052-fixed (9 pins red on pre-fix
  source, the fixed files restored and cmp-verified byte-identical); full
  verification; docs lockstep (INDEX row + the 0152/0068 annotations, two
  AGENTS.md lines, three structure.md rows); committed.

## Verification

`bun typecheck` exit 0; auto-core full suite **3161 pass / 0 fail** (155
files = the 3155/155 baseline + 6 net new, zero regressions). Fail-before
proof over /tmp/052-fixed (the six changed src files backed up, `git show
HEAD:` pre-fix versions swapped in, the pins run, the fixed files restored
and cmp-verified byte-identical): **9 pins red on pre-fix source** —

- D1 (1 pin in stats.test.ts): the crash-window scene materialized
  (stats.json the pre-switch state, the ledger already holding T-001's
  closing line) — the restart's switch appended T-001 a second time (two
  T-001 lines, the last of them the duplicate with the doc's lesser
  figures), the finding's impact verbatim; post-fix exactly one T-001
  line and the fresh unnamed bracket closing the restart's pre-task work;
- D2 (1 pin): the lanes section surviving the round rollover — round 2's
  roll-up answering the stale {lanes: 1, tokens: 5000, booked: true} and
  the conclusion's "  lanes:" line claiming the booking beside round 2's
  empty totals; post-fix undefined and no line;
- D3 (1 pin): the sibling-union scene (begin T-001, begin T-002, +60 s,
  end s1, +600 s, end s2) — round aiMs 60 000 of the 660 000 union and
  s2's accumulator frozen at 60 000; post-fix 660 000 both, s1's 0;
- D4 (3 pins): the seam delta pin (no `delta` on either journal line and
  the run total 240 — the resumed takeover re-counting run 1's 100;
  post-fix the two lines carry delta 100/40 beside the cumulative
  100/140 and the total is 140); the emitter pin (the total 140 — the
  cumulative counted, the lane landing's 90 omitted; post-fix 130 = 40 +
  90); the scheduler pin (the two landed lanes' events carrying no
  usage);
- D5 (3 pins): the stint-identity pin (T-005's line stamped
  `R-01.P02` — the next phase — and T-006's round 2 — the next round;
  post-fix `R-01.P01` and 1); the classify re-point (the one-shots inside
  the open stint's models section and its ledger line; post-fix
  phase/round only, the line's models undefined); the cross-interruption
  re-point (classify accumulating in taskB across reloads; post-fix
  taskB.models.classify undefined, 15 in phase/round).

The floors green on pre-fix source (the cross-restart close covering the
whole bracket, the same-round lanes round trip, the lone session's close,
the existing run-total test's direct emissions, and every other
pre-existing test of the touched files). No packages/auto, auto-server or
templates/prompts surface touched by this step.

## Dispositions

- **0165-121 (S15-01, S3)** — fixed (ruling 0212 D1): the load-time
  ledger guard closes the switch's crash window by derivation; the
  same-id resume and the graceful cross-restart close untouched; the
  torn-line and beyond-cap shapes the conservative no-match (named
  residuals).
- **0165-122 (S15-02, S3)** — fixed (ruling 0212 D2): the lanes section
  rolls with the round, cleared at the rollover beside roundB; the
  conclusion's booked claim true from round 2 on; 0068 S4's "run-scoped"
  premise corrected and its INDEX row annotated.
- **0165-123 (S15-03, S3)** — fixed (ruling 0212 D3): the sibling-aware
  close — the heartbeat and the AI segment held while a sibling runs,
  lastKey moving to a live session; the union caliber and the ~30 s
  crash bound pinned; the cadence itself unpinned (named residual).
- **0165-124 (S15-04, S3)** — fixed (ruling 0212 D4): the session
  roll-up's additive `delta` and the lane-landing's additive booked
  `usage`, publish accumulating both — each consumption exactly once, no
  new event type, no new scope word (P13 additive lockstep with the
  schema samples updated consciously).
- **0165-125 (S15-06, S3)** — fixed (ruling 0212 D5): the stint's own
  phase/round stamp (additive, older documents fall back), the one-shots
  phase/round only (0152 D4(c) enacted, its INDEX row annotated), the
  time bracket stated (the statsTaskEnd alternative declined on
  P21/P6/P10); the doc-lane time attribution the named residual.
- Named residuals carried (0212): the torn-ledger-line shape, the 64 KiB
  tail cap, the doc-lane task bucket's time attribution, the run
  bracket's this-process scope (a future booking site must carry its
  event), the heartbeat cadence.
- Premise guard: 0152 D1/D2/D4(c) and 0068 S4's conclusion AUTO-DECISION
  re-read and annotated in the same change; 0019, 0099 D8, 0067 P2b,
  0068 D13 and 0102 D7 re-read standing.

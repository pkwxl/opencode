# 0212 — the stats store's identity across time: the stint ledger's crash window, the lanes section's round, the sibling heartbeat, the run bracket's total, the stint's own stamp

Status: active (ruled by 0166 step 052, 2026-11-08). The 0165 register's
S15-accounting family, findings 121–125: the cumulative-stats store is sound
at every single-process seam, but **what a figure belongs to is decided by
"the bucket currently open" or "the moment of the read"** — wrong at the
crash window (121), the round boundary (122), the doc-lane sibling (123),
the resumed session and the landed lane (124), and the phase/round boundary
(125). This ruling gives each figure an identity that survives those seams.

The boundary answers first (the requirement-intake rule): all five findings
are one family — the cumulative-stats store and its outflow surfaces
(0019's timing model, 0152's ledger, 0068 D13/S4's lanes roll-up, 0067 P2b's
run bracket, 0099 D8's per-unit attribution). Home-set: `src/stats.ts` +
`src/stats-schema.ts` (store and schema), `src/run-status.ts` +
`src/run-status-schema.ts` (the run bracket), `src/lanes.ts` (the landing),
`src/conclusion.ts` (the roll-up line's comment truth), the test homes
`test/stats.test.ts`, `test/run-status.test.ts`,
`test/lanes-scheduler.test.ts`, `test/run-status-schema.test.ts`, and the
documentation homes (`docs/structure.md`'s ledger shape note, AGENTS.md's
navigation, plans/INDEX.md). 0165 is the evidence, not the authorization:
every decision below is ruled here.

## D1 — the stint ledger's crash window: the already-recorded fact is derived from the ledger at load (0165-121)

The defect: `statsTask`'s id-change branch appends the closing stint's
ledger line synchronously, then resets the bucket and persists through the
async write queue. A kill between the two leaves stats.json holding the
closed stint as still open, and the restarted run's first id-change switch
appends the same stint a second time — same task and `since`, the same
session log, the usage counted twice, `wallMs` disagreeing (the second line
carries only what stats.json had persisted). 0152 D2 claimed
"exactly-once per stint" as a property that "falls out for free" — the
crash window measured against it; the property must be derived, not
incidental.

The ruling (P6 — recovery re-derives from disk): **load derives the
"already recorded" fact from the ledger itself.** After depreciation and
the round rollover, `load` reads the ledger's **last line** (a tail read —
the last 64 KiB of the file, the last full line within it); when its
`(task, since)` equals the loaded document's `(taskB.id, taskB.since)`,
the append reached the ledger and the reset never reached stats.json — the
stint **closed before the crash**. The load then resets the task bucket to
a fresh unnamed bucket (`since` = now) and clears the sessions map: both
records live in the ledger's line, whose figures are strictly the better
ones (booked at the switch moment, after the last persisted write). The
next `statsTask` switch appends the fresh unnamed pre-task bracket exactly
as every run start does — one line per stint restored.

- The same-id resume (the interruption-recovery shape: the re-run
  dispatches the same task) is untouched: the load-time match keys on the
  ledger's last line, which in that scene is an *earlier* stint's (the
  crash happened mid-stint, no line appended) — the stint continues in the
  same bucket and its eventual close records the whole bracket, 0152 D2's
  crash-isomorphism property unchanged.
- The graceful flush → reload → switch (one line covering the whole
  bracket) is untouched for the same reason: no line was appended at
  flush, so no match fires.
- Conservative under uncertainty (P12): a read failure, a missing ledger,
  a torn or unparsable last line, or a line beyond the 64 KiB tail cap all
  read as *no match* — the load leaves the document alone and the store
  behaves exactly as before (the guard simply does not fire; the duplicate
  in those shapes is the pre-fix behavior, an accepted bound, never a
  wrong reset — resetting on an uncertain match would *destroy* an open
  stint's figures, the worse failure).
- AUTO-DECISION (the reset target is the unnamed bucket, not the next
  task): the next task is unknown at load; inventing an id would fabricate
  identity. The unnamed bucket is the store's own "no stint" shape (the
  pre-task bracket every run opens with), and the run's first `statsTask`
  closes it as the ordinary unnamed bracket line — the shape 0152 D2
  already ruled "a bracket too".
- The resume snapshot (`StatsResume`) is taken before the reset and still
  names the interrupted task — the banner's "where the previous process
  stopped" truth; the bucket reset is the store's internal identity, not
  the person-facing position.

Amends **0152 D2** (the "exactly-once per stint" free-property claim — the
property now derived at load, the crash window closed; the seam, the
best-effort writer and the rest of D2 stand).

## D2 — the lanes section rolls with the round (0165-122)

The defect: `doc.lanes` is written by `statsLaneUsage` and read by
`statsLaneRollup`, but never reset — not at the round rollover, not at
flush. Every later round's conclusion reports every lane ever landed in
the directory, the section grows without bound (the one unbounded part of
the document), and under a booked report the line claims "(booked into
the totals above)" beside a round whose totals hold none of it — the
honesty marker 0068 S4 added says the opposite of the truth from round 2
on.

The ruling: **the lanes section rolls with `roundB`** — cleared at the
load's round rollover, beside `rollHistory`. It carries no phase/round
attribution (0068 S4's own observation), and its *booked* figures already
rolled with `roundB` into history at the same rollover — keeping the
per-unit entries while the totals reset would be exactly the growing
cross-round shadow the finding measured. A re-dispatched unit in the new
round starts a fresh entry (per-round scoping, the natural reading of the
section). The same-round resume keeps the section (the rollover alone
clears it — the existing round-trip pin is the floor); a run without
lanes never has a section, byte-identical (P10). The conclusion's
"booked" claim is true again from round 2 on: the entries a roll-up sums
are the round's own.

Premise change: the AUTO-DECISION in `src/conclusion.ts` (0068 S4's
landing) states "the lanes section of the stats document is run-scoped" —
the section is **round-scoped** (one load's bracket); the comment is
corrected in the same change, and 0068's INDEX row is annotated.

## D3 — the per-unit heartbeat: a sibling's end no longer stops the union (0165-123)

The defect: `statsSessionEnd` stops the heartbeat and reopens the segment
as wall-only unconditionally — written for 0019's one-live-session world.
Under doc lanes (0099 D8's per-unit active map) one sibling's end stops
the shared heartbeat and closes the AI segment while another unit's
session still runs: the still-running sibling's AI time stops counting
(against the "union of AI-active wall time" caliber the Handle header
documents — round aiMs 60 000 of a 660 000 union, the finding's probe),
its per-session accumulator freezes, and with the heartbeat stopped a
kill -9 during its remaining run loses the whole wall tail instead of
≤ ~30 s (0019's bound).

The ruling: **the close runs only when the last active session ends.**
`statsSessionEnd` deletes the ending key, then: when the active map is
empty it does today's close (stop the heartbeat; reopen wall-only, or
flip `wait.ai` inside a wait); when a sibling remains, the AI segment
stays open, the heartbeat keeps ticking, and `lastKey` moves to a
remaining unit (the latest-begun) so the folds keep crediting a live
session's accumulator and `statsWaitEnd` attributes its waits. The
unpaired-end fallback (a dispatch-failure booking with no begin) takes
the same branch by the map's state — a booking under live siblings keeps
their segment, an empty map closes as today. The union caliber the header
claims becomes true under doc lanes; the crash-loss bound returns to the
heartbeat's ~30 s for every live session. 0099 D8's audit mandate ("audit
and fix the booking path") extends to the session lifecycle seam it
introduced; 0019's timing model stands as written — this is the
under-implementation, not a caliber change.

## D4 — the run bracket's total counts each consumption exactly once (0165-124)

The defect, both directions: (a) the session roll-up `statsSessionEnd`
emits carries the session entry's **cumulative** usage — accumulated
across interruptions — and `publish` sums those into the run total, so a
resumed takeover of a session already booked in the previous run counts
that run's tokens again (run 2's journal: "session ses-1 input 140 / run
input 140" when run 2 spent 40); (b) `statsLaneUsage` books the landed
lanes' detail into the stats buckets with no roll-up event at all, so a
parallel run's total is its parent sessions alone — the hazard 0068 S4
fixed for the conclusion, unfixed for the run bracket. 0067 P2b's letter
("the emitter totals the run scope itself", "each session counted exactly
once" — run-status.ts's own header) is the standard both halves miss.

The ruling, both halves additive under P13 (no new event type, no new
scope word — the finding's own route):

- **(a) the session roll-up gains `delta`**: the `usage-rollup` event's
  session member grows an optional `delta: UsageFigures` — this booking's
  figures (the `usage` argument the stats seam received; the cumulative
  stays in `usage`, the journal reader's meaning unchanged). `publish`
  accumulates `delta ?? usage` into the run total: the stats seam always
  hands the delta, and a direct emitter without one keeps today's
  counting (the tests' own shape — the floor).
- **(b) the lane-landing event carries the booked usage**: the
  `lane-landing` member grows an optional `usage: UsageFigures` (the
  report's detail breakdown), emitted exactly where the booking ran —
  the settled landing and the landing-sync-failure block, the two sites
  that call `book()`; the early-blocked paths (baseline derivation,
  violations, merge conflict/failed) book nothing and carry nothing.
  `publish` adds a lane-landing's `usage` into the run total — one
  publish-side add. The run bracket then reads: parent sessions' deltas
  + landed lanes' detail, each consumption exactly once.

## D5 — the stint's own identity, the one-shots' home, and the time bracket stated (0165-125)

Three defects under one finding — a ledger line's identity and time are
the close moment's, not the stint's:

- **(i) the phase/round stamp** — `taskStintRecord` reads `doc.phase` /
  `doc.round` at the close, which happens at the *next* task's start —
  after `statsPhase` already moved the phase (and a rollover the round).
  The last task of every phase is recorded under the next phase, the
  last of a round under the next round. **The task bucket stamps its own
  stint's identity at `statsTask`**: `Bucket` grows optional `phase` /
  `round` (set when the stint opens — the phase/round the document holds
  at that moment, which the loop's ordering makes the stint's truth:
  `statsPhase` precedes the phase's first `statsTask`); the lenient
  parser carries them (bad = missing), and `taskStintRecord` records the
  bucket's stamp, falling back to the close-moment values for older
  documents. Additive document grammar under P13; `structure.md`'s
  ledger shape note updated in the same change.
- **(ii) the one-shots' bucket** — `bucketUsage` books the classify and
  synthesis one-shots into all three buckets' models sections, so they
  land in the open task stint's ledger line — while 0152 D4(c) states
  "classify/synthesis one-shots book to phase/round only". The ruling's
  description was never the code; the code is the defect (a one-shot is
  no unit's session — booking it into a stint's models misattributes it,
  and the conclusion's per-model lines read the round bucket regardless).
  **`bucketUsage` books `phaseB`/`roundB` only** — 0152 D4(c) enacted.
  The task conclusion's per-model lines (which read the task bucket) stop
  showing the one-shots they never should have shown.
- **(iii) the time bracket stated** — a stint's `aiMs`/`wallMs` span
  `[since, the next switch's at]`: the phase boundary's handover
  distillation and formulation time ride the closing stint's bracket
  while (post-(ii)) their usage does not. The alternative — a
  `statsTaskEnd` closing the stint at the unit's close-out and parking
  the bucket — is **declined**: P21 (no consumer locks that shape; the
  analysis reads per-task elapsed from `at − since`, which the line
  already carries), P6/P10 (a new API, new callers in the task loop and
  new persisted state for a caliber a documented bracket answers). The
  caliber is stated here and in `structure.md`; the line's `since`/`at`
  are the bracket's endpoints.

Amends **0152 D1** (the identity clause — `phase`/`round` are the stint's
own, not the close moment's) and **0152 D4(c)** (enacted, not merely
described).

## P13 lockstep statement

No frozen literal changes; two vocabularies grow additively in one
change each: the `usage-rollup` event's session member gains optional
`delta` and the `lane-landing` member gains optional `usage`
(`src/run-status-schema.ts`, `src/run-status.ts`, `src/lanes.ts`,
`src/stats.ts` — the emitters — and the schema's pinning tests updated
consciously in the same change); the stats document's `Bucket` gains the
optional task-stint `phase`/`round` (`src/stats-schema.ts`, the lenient
parser beside them, `structure.md`'s shape note). Older documents and
journals parse unchanged (absent = absent). The conclusion's rendered
lines change in no spelling — only their truth.

## Floors (P10 — byte-identical where no defect was ruled)

A run without lanes, without classify/synthesis one-shots, without a
crash in the switch window, and with one live session at a time behaves
byte-identically: the load-time ledger guard does not fire (no match),
the lanes reset touches no section, the sibling branch of D3 never runs,
the session roll-up of a first-run session has `delta === usage`, and a
lane-less run emits no lane-landing usage. The existing pins (the
cross-restart close, the same-round lanes round trip, the lone session's
close, the run-total test's direct emissions) hold unchanged — they are
the floors' proofs.

## Named residuals

- The torn-line shape: a kill mid-`appendFileSync` can leave a partial
  last line; the tail read parses it as no match (conservative) and the
  next switch may append a duplicate beside it — the reader's parse
  failure is the journals' standing best-effort posture (P18).
- A stint line beyond the 64 KiB tail cap (an extreme session log) reads
  as no match; the cap is the documented bound.
- Under doc lanes the task bucket's *time* still books to the currently
  open bucket whatever unit runs — 0099 D8's attribution covers usage
  alone; the union caliber (the Handle header) is the documented
  per-unit time story, unattributed per unit (0165-125's lane half).
- The run bracket counts only what this process emitted before its end:
  a killed run's bracket never closes (the standing run-status posture,
  unchanged); the lane half rides the landing events, which exist only
  where the booking ran — a future booking site must carry its event
  with it (the two-site rule stated here).
- The heartbeat's cadence (the ~30 s bound under a surviving sibling) is
  implemented but unpinned — a cadence pin would cost the suite its
  budget (0210 D4's precedent); the caliber pin (aiMs union) is the
  coverage.

Derives: **P6** (D1 — the already-recorded fact derived from the ledger
at load, never trusted from memory; D2 — a section that rolls with the
round its figures rolled with), **P12** (D2 — the false "booked into the
totals above" claim; D4 — a total that over-reports resumed runs and
omits lanes fails loud's honest-verdict half; D1's uncertain reads resolve
to no-reset), **P18** (D1 — the duplicate is a *wrong* line, not a missed
one; the ledger stays the machine-addressable record the analysis
re-derives from), **P19** (every defect measured: the SIGKILL repro, the
two-round probe, the sibling-end probe, the two-run journal, the
phase-boundary probe — 0165 S15's records), **P13** (the additive-only
growth stated above), **P10** (the floors named above). Amends: **0152
D1, D2, D4(c)** (the identity clause, the exactly-once property, the
one-shots' home — each restated above with provenance carried; 0019's
timing model itself stands), **0068's S4 conclusion AUTO-DECISION** (the
"run-scoped" premise — the section is round-scoped; INDEX row annotated).
Tier touched: **mechanism** — core only.

## Category scope (0123 D1's discipline)

Family: *the cumulative-stats store's identity across time and its outflow
surfaces.* Home-set:

| home | disposition |
|---|---|
| `src/stats.ts` (D1 the load-time ledger guard + the tail read; D3 the sibling-aware close; D4a the delta on the session roll-up; D5i the stint stamp at statsTask) | changed |
| `src/stats-schema.ts` (D5i Bucket's optional `phase`/`round` + the lenient parse + taskStintRecord's stamp with the older-document fallback) | changed |
| `src/run-status-schema.ts` (D4 the additive `delta` / `usage` event fields, their declaration comments) | changed |
| `src/run-status.ts` (D4 publish accumulates `delta ?? usage` and the lane-landing usage) | changed |
| `src/lanes.ts` (D4b the landed/landing-sync sites carry the detail usage on the lane-landing event) | changed |
| `src/conclusion.ts` (D2 the "run-scoped" comment corrected — round-scoped; no rendered-line change) | changed (comment only) |
| `test/stats.test.ts` (D1 the crash-window pin; D2 the rollover-reset pin; D3 the sibling-union pin; D4a the seam's delta pin; D5 the stamp pins + the classify pin re-pointed) | changed |
| `test/run-status.test.ts` (D4 the delta/lane publish-side pins) | changed |
| `test/run-status-schema.test.ts` (D4 the additive fields' declaration coverage) | changed |
| `test/lanes-scheduler.test.ts` (D4b the landing events carry the usage at the booked sites) | changed |
| `docs/structure.md` (the ledger shape note: the stint's own phase/round, the stated time bracket) | changed |
| The conclusion's rendered lines, the templates, the shell packages | held, untouched — no spelling changes |

## Premise guard

`premises this ruling changes: 0152 D1, 0152 D2, 0152 D4(c), 0068 S4's
conclusion AUTO-DECISION` — each re-read in this same change: 0152's
three clauses amended above (its INDEX row annotated); 0068 S4's
"run-scoped" premise corrected in `src/conclusion.ts` and its INDEX row
annotated. Re-read standing: 0019 (the timing model and the heartbeat
bound — D3 implements its own header), 0099 D8 (the per-unit attribution
— D3 extends its mandate to the lifecycle seam), 0067 P2b (the emitter's
letter — D4 enforces it), 0068 D13 (the relay/booking split — D4b adds
the event field at the booking's own sites), 0102 D7 (the store/schema
split — the Bucket fields land in the schema half).

# Step 073 — wb-deterministic-tests: the observe sawDirty race and worker.test's frozen-key case made deterministic

Status: **done** (started 2026-11-09, HEAD 461d9b856; committed 2026-11-09 —
see the program's Current position for the session summary and the commit).

Findings: 0165-220 (S30-05, the observe e2e's sawDirty poll-window race),
0165-223 (S31-03, worker.test.ts's frozen-key usage-vocabulary case over bun's
5 s per-test default — the S00-01 breach's remaining half). Evidence: the
register rows plus plans/0165-review/S30-server-ops.md (S30-05),
S31-server-web.md (S31-03), S00-baseline.md (the flake and the deterministic
breach both first recorded there). Coordination: step 064
(064-wf-registry-observe.md) repaired the malformed-requests half of the same
suite (ruling 0224 D4, finding 0165-058) and left the frozen-key case here per
the register's division; its record notes the observe sawDirty e2e flaking once
mid-session and passing on re-run and in-suite — this step's own finding.

## Plan (written before editing)

1. Ruling 0233 first (next free number after 0232): the two deterministic test
   repairs. Answer the boundary from docs/principles.md first — P19 (measured
   evidence: both defects measured, the remedies re-measured before adoption),
   P12 (the suite's failures surfaced honestly, never a raised timeout
   masking the next breach), P10 (the byte-identical floor: test repairs only,
   no runtime behavior change unless a defect is ruled), P21 (the fix rides
   the fixture's own existing knob, no new mechanism). Category scope per
   0123 D1 (the suite-timing-health family: every test that spawns workers in
   a loop or polls a fixture window).
2. Measurements before enactment: (a) the frozen-key case's runtime at HEAD
   (the deterministic breach re-confirmed); (b) the observe e2e's actual dirty
   windows mapped at the current FAKE_CLAUDE_DELAY_MS=300 — where the write
   and the closing commit sit, whether the 0165-proposed delay raise reaches
   the window at all (the fake's per-turn delay sleeps BEFORE the turn's
   writes — the finding's own remedy needs re-measuring, 0165 is evidence,
   not authorization).
3. Enact the two repairs per the ruling's measured shape. Test files only
   (plus the fixture knob use the ruling adopts); no runtime src change
   expected.
4. Determinism proof: the repaired tests repeated (N consecutive green runs);
   the pre-fix failures demonstrated (the frozen-key timeout at HEAD's file;
   the sawDirty race's window measured against the poll cadence).
5. Verification: auto-server typecheck + full suite (baseline after step 072:
   173 pass / 1 fail, the one "planPrelude boundary matrix" known drift; the
   step-064-noted one-off load flakes passing in isolation), auto-core
   typecheck + full suite only if core files change (expected untouched,
   baseline 3277/0, 165 files).
6. Bookkeeping: INDEX row for 0233, coverage-ledger dispositions for 0165-220
   and 0165-223 (the register-row coordination with step 064's 0165-058
   disposition), program row 073 → done, Current position rewritten, this
   record's Verification + Dispositions filled. Commit the step's paths.

## Session log

- 2026-11-09 (this worker): authoritative inputs read (the program's
  executable prompt, status row, ledger rows, Current position; S00/S30/S31
  records; step 064's record and ruling 0224 D4's split; the two tests; the
  fake-claude fixture's delay semantics — sleep BEFORE the turn's act()
  writes; observe.ts's worktreeVerdict; AGENTS.md's P10/P12/P19 summaries).
  Row 073 marked doing; this record created. Next: the measurements of Plan
  step 2.
- 2026-11-09 (this worker, measurements): (a) the frozen-key case at HEAD:
  2513 ms on this host (16 spawns, 0.157 s/spawn), S00's recorded 6.9 s on
  the review host; under `--timeout 2000` it deterministically times out
  (2000.14 ms, bun's kill) — the runtime rides the row count. (b) The
  observe dirty-window map (a 10 ms watcher beside the e2e's own 150 ms poll
  loop, the probe this record's verification names): at DELAY=300 five
  windows — the driver's AGENTS.md write 26–42 ms, the fake's three write
  windows 28–97 ms, the driver's unit-close rename+tick 14–28 ms — ALL
  shorter than the cadence; 4/5 probe runs passed (1–2 lucky polls), one
  failed (0/15). **The finding's proposed remedy disproved**: at DELAY=500
  the windows are unchanged (27–97 ms) and the probe measured sawDirty=false
  — the knob sleeps BEFORE the turn's writes, spacing windows, never
  stretching them. (c) The family census: the five 0224 D4 families 0.52–1.99
  s (inside the guideline); **packages/auto's own frozen-key e2e case
  measured 4143.79 ms** (24 CLI spawns) — 83% of the default, past the
  guideline 2×, no register row names it → deferred (0233 D3). Ruling **0233**
  written whole (Derives P19/P12/P10/P5/P21 + How-to-rule; Amends none;
  Tier tests; premises changed: none). Enacted: the fake's
  FAKE_CLAUDE_WRITE_HOLD_MS knob (0-default, header documented), the observe
  e2e spawned with DELAY=300 + WRITE_HOLD=500 (measured held windows
  557–584 ms, 10/21 polls dirty), the frozen-key case split into five family
  tests (rows verbatim, each family its own fresh dir + readdir check, the
  describe's comments completed). Next: the determinism runs and the
  fail-before proofs, then verification.
- 2026-11-09 (this worker, proofs + verification): the repaired e2e **green
  in five consecutive runs** (3390/3388/3390/3418/3415 ms); the five split
  families green (306–941 ms, largest = the six-spellings family as
  computed). Fail-before: HEAD's frozen-key test extracted to a temp path
  (then removed) red at 2000.20 ms under `--timeout 2000`; HEAD's observe e2e
  from a temp path 3/3 green (the coin flip's good side — the pre-fix red
  stands demonstrated at the probe level: one 0/15-poll run, and one at the
  finding's own proposed DELAY=500 remedy). auto-server typecheck exit 0;
  full suite 177 pass / 1 fail (the known "planPrelude boundary matrix"
  drift by name; 173/1 baseline + 4 net). auto-core typecheck exit 0; full
  suite 3277/0 twice consecutively (one first-run unidentified single
  non-recurrence, the step-072 pattern; interactive-seam — the changed
  fixture's one direct consumer — 3x green). packages/auto 170/8/6 (the
  exact baseline, the 6 known by name — the shared fake verified on its
  other consumer). The 0165 probe: P4 empty; the standing pre-existing set
  otherwise (P6's agent/urls and P7's Auto-Stage census recorded as
  out-of-family observations in Current position). Bookkeeping: INDEX row
  0233 (6 cells), ledger rows 220/223 → fixed, program row 073 → done,
  Current position rewritten. The probe file removed before the commit.
  Committed as `0166: step 073 done — ruling 0233 <summary>` over the
  step-073-owned paths only.

## Verification

- Determinism (the repaired tests): the observe e2e 5/5 consecutive green
  (each ~3.4 s — the three held windows carrying sawDirty by construction);
  the five frozen-key families green, largest 941 ms against the 5 s default
  (the worker.test file 22 tests green in one run).
- Fail-before: the frozen-key defect structural — HEAD's single test red at
  2000.20 ms under a 2 s budget (2000 ms chosen to demonstrate the scaling on
  this host; the recorded 5 s breach is S00's 6.9 s measurement on the review
  host, and the 40-spawn sibling breached this host itself at 5001.77 ms
  pre-064); the observe race measured at the probe level (the window map, the
  0/15-poll red, the finding's proposed remedy's own red).
- Suites: server 177/1 (known drift by name), core 3277/0 (the exact
  baseline, two consecutive full greens), auto 170/8/6 (the exact baseline,
  the 6 known by name); all three typechecks exit 0.

## Dispositions

- **0165-220 — fixed** (ruling 0233 D1): the race closed at the owning home
  (the shared fake's post-write hold), the finding's proposed remedy declined
  on measurement, no runtime code touched, the e2e's assertion set unchanged.
- **0165-223 — fixed** (ruling 0233 D2): the frozen-key case split per family
  (0224 D4's form), rows verbatim, coverage identical; the census's deferred
  row (packages/auto's own frozen-key e2e case, 4143.79 ms measured) recorded
  as 0233 D3's deliberate deferral with its home in the ruling, the ledger
  note and Current position.
- Coordination with step 064 honored: 064's D4 left this half to step 073 per
  the register's division; the describe's comment blocks now state the
  completion; the malformed-requests families untouched (measured inside the
  guideline).

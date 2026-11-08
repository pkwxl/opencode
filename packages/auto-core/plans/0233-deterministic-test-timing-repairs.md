# 0233 — the two deterministic test repairs: the observe e2e's sawDirty window and the frozen-key usage-vocabulary split

Status: active-authority (0166 remediation step 073, wave WB-test; findings 0165-220 =
S30-05 (S4, CONFIRMED, TEST — the observe e2e's sawDirty expectation races the
fixture's dirty window) and 0165-223 = S31-03 (S4, CONFIRMED, TEST — worker.test.ts's
frozen-key usage-vocabulary case spawns ~15 workers in one test, deterministically
6.9 s against bun's 5 s default on the review host); the malformed-requests sibling
of 223's suite was step 064's, ruling 0224 D4 — this ruling completes that split's
deferred half per the register's division).

One family — **the suite's timing determinism**: a test whose verdict rides a window
or a runtime it does not control. The 0165 records measured both (the S00 flake; the
S00 deterministic 6.9 s breach); 0224 D4 established the family's standing repair
rule for the worker suite (split per family, never a raised timeout — "a family that
grows past the budget splits again the same way"). 0165 is the evidence, not the
authorization: both findings' proposed remedies were re-measured at this step's HEAD
before enactment, and one of them (220's own) is **declined on the measurement**.

## The measured ground (every number this step's own, at HEAD `461d9b856` unless named otherwise)

### 220 — the sawDirty race, mapped

A 10 ms `git --no-optional-locks status --porcelain` watcher ran beside the e2e's own
150 ms status-poll loop over the same fixture run (the probe of this step's record).
At the e2e's current `FAKE_CLAUDE_DELAY_MS: "300"`, one run's dirty windows:

| window | contents (first sample) | length |
| --- | --- | --- |
| 1 | `?? AGENTS.md` — the driver's run-start re-derivation | 26–42 ms |
| 2 | `?? docs/T-001/subtasks.md`, `?? src/` — the lead's writes | 28–84 ms |
| 3 | `?? src/alpha.ts`, `?? src/beta.ts` — the streams' writes | 54–83 ms |
| 4 | `?? docs/T-001/report.md` — the wrap-up's writes | 56 ms |
| 5 | `M tasks.md`, `D todo.md`, `?? done.md` — the driver's unit-close rename + tick | 14–28 ms |

**Every window is shorter than one poll cadence** (150 ms). sawDirty is a per-run
coin flip: across five probe runs (delays 300/500 mixed) four passed (1–2 polls
happened to land inside a window) and one failed (0/15 polls; the windows unchanged
at 27–97 ms). That is the recorded S00/step-064 flake mechanism, reproduced and
bounded.

**The finding's own proposed remedy is disproved by measurement.** S30-05 proposes
`FAKE_CLAUDE_DELAY_MS ≈ 500` "so ≥3 polls land between the write and the commit".
The knob sleeps **before** the turn's writes (`fake-claude.ts`: `sleep(DELAY_MS)`
then `act(text)` — the delay answers the prompt late; the write and the session's
closing commit still sit back to back): raising it spaces the windows further apart,
never stretches one. Measured: at DELAY=500 the probe produced the same 27–97 ms
windows and **sawDirty=false** (0/15 polls) — the proposed remedy, enacted, makes
the flake reproducibly red on this host. The repair must reach the window itself.

### 223 — the frozen-key case, counted and timed

The one `test()` loops 16 `runWorker` spawns (6 frozen spellings + 4 of plans/0160
D2's keys + phases + lanes + 2 on/off pairs + the top-level and config-carrier
forms): **2513 ms at HEAD on this host** (0.157 s/spawn), against S00's measured
**6.9 s** on the review host (0.45 s/spawn — deterministically past the 5 s default
there). The defect is structural, not host luck: under `--timeout 2000` on this host
the test deterministically times out (2000.14 ms, bun's kill) — the runtime rides
the row count. The sibling malformed-requests case (40 spawns) breached on this host
itself at HEAD pre-064 (5001.77 ms, step 064's re-confirmation); the five 0224 D4
families it became measure 0.52–1.99 s here — the guideline the corpus's standing
split rule enacted.

### The family census (this step's Category scope, measured)

- **The same describe's other families** (the five 0224 D4 tests): 0.52–1.99 s —
  inside the guideline, untouched.
- **packages/auto's own frozen-key e2e case** (`test/e2e.test.ts` "run refuses
  options frozen by init"): 17 fixed flags + 7 follow-up spawns = 24 CLI spawns in
  one `test()` — **4143.79 ms at HEAD on this host**, 83% of the default and 2×
  past the family guideline, deterministically past the default at the S00 scale
  (~10.8 s). 0224 D4's note left "the frozen-key case of the CLI-facing suites"
  where it was — step 064 scoping its own enactment, not a health ruling of this
  surface. **No register row names it.** Disposition: D3 below.
- **The dirty-window half has exactly one home**: the observe e2e is the only test
  that polls a run's dirty state mid-flight (web-serve asserts clean before/after
  only, no during-run window).

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P19** (measured evidence): every claim above is this step's own measurement —
  the window map, the disproof of the proposed remedy, the spawn counts, the
  per-family runtimes, and (below) the post-repair determinism runs. The ruling
  reverses the finding's proposed remedy *on* measurement — the program's "0165 is
  evidence, not authorization" is not a formality here: the proposed DELAY=500
  enact would have preserved the race.
- **P12** (fail loud; conservative under uncertainty; never mask): neither repair
  raises a timeout, slows a poll, or weakens an assertion. The e2e keeps asserting
  sawDirty through the same 150 ms poll over the same status endpoint (the surface
  under test); the split keeps every row verbatim with coverage identical. A raised
  timeout "only postpones the next breach as the vocabulary grows" (0224 D4's
  standing sentence).
- **P10** (the byte-identical floor): the one new fixture knob defaults to 0 —
  every existing caller of the fake (8 `FAKE_CLAUDE_DELAY_MS` call sites, the
  core's seam suite, both shells' e2e) runs byte-identical with it unset; the
  observe e2e's assertion set is unchanged, only its fixture run is spawned with
  the hold; the split tests' rows are verbatim and each family keeps the
  refusal-before-any-write readdir check on its own fresh dir.
- **P5** (single ownership): the dirty-window stretch gets exactly one owning home
  — a knob in the one shared fake (`auto-core/test/fixtures/fake-claude.ts`, the
  fixture family's maintained reference, 0193 D6) — not a test-local sleep
  straddling the driver's commit, not a second fake, not a knob per shell.
- **P21** (machinery waits for its consumer): the knob is the minimal primitive the
  observe e2e needs — a post-write hold of N ms, no per-turn selectivity, no
  config-file shape, no first use beyond this e2e. The finding's `test.each`
  suggestion is declined as this corpus's first-ever use of a new authoring
  convention where the standing family-loop form (0224 D4, one describe away)
  already fits — recorded here, not enacted.
- **How to rule** (test homes): the repairs land in the tests' own homes; the
  proof of repair is the repaired tests themselves — repeated green runs and the
  window map — not a new meta-test.

## Decisions

### D1 (0165-220) — stretch the dirty window itself: `FAKE_CLAUDE_WRITE_HOLD_MS`

The fake gains one knob beside `FAKE_CLAUDE_DELAY_MS`: sleep this many milliseconds
**after** the turn's writes (`act(text)`), before the turn's stream answers — the
writes are on disk, the closing result not yet said, the driver's session commit not
yet run: the dirty window itself is held open. The observe e2e spawns its run with
`FAKE_CLAUDE_DELAY_MS: "300"` (unchanged — it stretches the run's live window for
sawLock/sawInProgress and the tail's bounded latency) **plus**
`FAKE_CLAUDE_WRITE_HOLD_MS: "500"`: each of the fake's three write windows becomes
≥ ~560 ms (measured: 584/557/567 ms) — at least three polls per window at the 150 ms
cadence, three held windows per run (the proof run observed 10 of 21 polls dirty;
sawDirty passes on construction, not on luck). The two driver-owned micro-windows —
the AGENTS.md re-derivation at run start and the unit-close rename + index tick —
stay at their natural 14–42 ms: they are the driver's own writes, never the fake's
to hold, and never needed (the three held windows carry the assertion; the e2e's
settled-after checks already cover the driver's close-side writes through the
settled read model).

Named residuals: the knob holds every turn equally (no selectivity — the simple
grammar over the general one, P21); the driver-owned windows remain sub-cadence (a
future test needing to observe *the driver's* dirty moments would need its own
measured mechanism — none exists, none built); the e2e's runtime grows ~1.5 s
(3.4 s vs 1.9 s measured, against its 300 s timeout and 120 s loop deadline).

### D2 (0165-223) — the frozen-key case split per family, the 0224 D4 form

The one 16-spawn test becomes five family tests in the same describe, the form the
describe's standing comment already teaches:

1. **the frozen spellings** — the six config-key rows (`subtask`, `contextLimit`,
   `context-limit`, `mode`, `idle-time`, `wrapup`), 6 spawns;
2. **the 0160 keys** — `intent`, `treeLanes`, `tree-lanes`, `isolate` with their
   revision hints (never the generic unknown-field refusal), 4 spawns;
3. **phases and lanes** — the roadmap-line remedy and the hand-edit refusal, 2
   spawns;
4. **the on/off pairs** — `autoNumber` and `wrapup` paired revision hints, 2 spawns;
5. **the top-level and carrier forms** — a config key at the request's top level
   and the dedicated `config` carrier, 2 spawns.

Every `[options, hint]` row verbatim, coverage identical (all five families are
refusal-only — each keeps the readdir-nothing-written check on its own fresh dir;
064's honest-narrowing case does not arise here). The largest family is 6 spawns ≈
0.94 s here (≈ 2.7 s at the S00 scale) — strictly tighter than the same describe's
standing 12-spawn options family (1.91 s here), inside 0224 D4's guideline. The
describe's standing rule is restated in its comment: a family that grows past the
budget splits again the same way; growth of the frozen vocabulary grows the TEST
COUNT, never one test's runtime.

### D3 (the census's deferred row) — packages/auto's frozen-key e2e case

Measured defective by the family's own budget rule (4143.79 ms, above) and **ruled
here only as a record**: the register's division gives this step the two named
findings' homes (0165-220's observe e2e, 0165-223's worker.test case), and a
same-family repair of a third package's e2e — six-ish family tests over 24 spawns —
is its own step-sized unit, not this step's in-change margin (the in-change-repair
precedents — 064's harness reshape, 072's manifest row — were single-surface
lockstep moves; this is a new split). Deliberately deferred with the measurement
recorded here, in the 0165-223 ledger disposition, and in the program's Current
position — the deferral's home — for a future step or the maintainer; the standing
observation joins 0232's "lane workers' /tmp/opencode lane-log default" class
(measured, named, unowned by any register row). The row below marks it deferred.

## Derivation and Category scope

Derives: **P19** (both repairs rule on this step's measurements — the window map
that disproves the proposed remedy, the spawn counts and runtimes, the post-repair
determinism runs; showing: the ground tables, D1's declined remedy and measured
windows, D2's family timings), **P12** (no timeout raised, no assertion weakened,
no poll cadence touched — the race is closed, not masked; showing: D1's unchanged
150 ms loop and assertion, D2's verbatim rows), **P10** (the knob's 0-default floor
— every existing fake caller byte-identical unset; the split families' coverage
identical; showing: D1's floor, D2's per-family readdir checks), **P5** (one owning
home for the window stretch — the one shared fake's knob; showing: D1), **P21** (the
minimal hold primitive, no selectivity machinery; the test.each convention declined
where the standing form fits; showing: D1's knob grammar, D2's form), and the
**How-to-rule** test-home discipline (the repairs land in the tests' own homes; the
proof is the repaired tests' repeated green runs; showing: D1/D2 and the
verification). Amends: none — 0224 D4's split rule is restated and completed (its
deferred half enacted), not changed; S30-05/S31-03's records are consumed as
evidence with one proposed remedy declined on measurement (the records' own
`remedy` fields are proposals, their `prior` fields record them as new findings;
nothing in a ruling rests on 220's DELAY=500 proposal). Tier: **tests** (zero
runtime behavior; the one shared test fixture gains a defaulted-off knob).

### Category scope

The family: **suite timing determinism — tests whose verdict rides a window or a
runtime they do not control** (0224 D4's split rule is the family's standing
authority for the runtime half; this ruling adds the window half's rule).

| home | role | this ruling |
| --- | --- | --- |
| `auto-core/test/fixtures/fake-claude.ts` | the one shared fake — the delay knob's home | **edited** — D1's `FAKE_CLAUDE_WRITE_HOLD_MS` (0-default), header documented |
| `packages/auto-server/test/observe.test.ts` | the observe e2e — sawDirty's one home | **edited** — D1: the run spawned with the hold, the comment teaching the measured race |
| `packages/auto-server/test/worker.test.ts` | the frozen-key case (0165-223's home) | **edited** — D2: the five-family split, rows verbatim |
| the five 0224 D4 family tests (same describe) | the standing split's families | untouched — measured 0.52–1.99 s, inside the guideline |
| `packages/auto/test/e2e.test.ts` ("run refuses options frozen by init") | the CLI's own frozen-key case | **deliberately deferred** (D3) — measured 4143.79 ms, no register row names it; deferral's home: this ruling + the program's Current position + the 0165-223 disposition note |
| `packages/auto-server/test/web-serve.test.ts` (clean before/after) | the git-verdict assertions that need no window | untouched — no during-run window polled |
| `plans/INDEX.md` | the corpus manifest | **edited** — row 0233 |

## premises this ruling changes: none

0224 D4 re-read standing (its five families and budget rule unchanged, its deferred
half completed as it itself scheduled — "step 073 owns 0165-223's own split");
S30-05/S31-03 re-read standing (their evidence consumed; 220's proposed remedy
declined on measurement, no ruling rests on it); 0232's hermeticity preloads re-read
standing (the hold knob rides the same spawn env spread, no preload interaction);
0162's observe-flake residual (the S30 record's "still open as a code change") is
discharged by this ruling as a TEST repair — the flake was the test's cadence
racing the fixture's window, no runtime defect measured. No ruling's premise rests
on the fake's knob set or either test's shape.

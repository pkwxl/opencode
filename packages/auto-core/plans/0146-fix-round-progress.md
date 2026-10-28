# 0146 — the fix budget is progress, not a count: two consecutive no-gap rounds block, and gaps are the round's natural handover boundaries

The maintainer's rulings (2026-10-28, over the `dm-glm-t083-250` fork of the aster-mig project —
the T-083 block diagnosis: fix round 1 closed a gap and fixed real production code, fix round 2
got the verity crate green in a receipt-backed solo lane, and the budget closed the task anyway
at 2/2 with the mechanism untried), the maintainer's own words:

> *Retries should not be strictly limited to two attempts; instead, decisions should be based on
> whether progress is being made. Execution should be blocked for manual intervention only when
> no progress has been made across two consecutive attempts.*

> *Fix rounds should not be bound to the number of fix sessions; a fix session can aim to reduce
> gaps, and gaps can actually serve as natural boundaries for handovers so that a fix round can
> leverage multiple sessions, each resolving one or more gaps.*

> *A fix session might handover for context limit reason, so it might resolve no gap.*

## The measurement (the incident, the mechanism's own walls)

- **The incident's own shape**: both fix rounds of T-083 made measurable progress — round 1 took
  the gap list from three entries to two while landing real fixes (a budget re-derivation, a
  salt-state bug, a restored prefetch test); round 2 turned the verity crate's 8 failures green
  in a solo lane (`b14r2-lane3-verity.log`, 19/19, receipt-backed) and hit an environmental wall
  (the gate's in-container `$LINUX` bind) the fork itself could not cross. The hard budget
  consumed the task with the loop's own evidence showing forward motion — the block's message
  ("2 fix rounds already ran (the budget is 2)") named a count, not a judgment.
- **The design archaeology** (plans/0083 D5): the constant two was ruled as *bounding* — "at most
  two fix rounds … then the escalation ladder … the block message names the rounds spent". The
  bound's rationale was architectural failure ("three gaps in a ten-thousand-line migration"),
  never an claim that two rounds exhaust progress. Nothing in 0083 measures whether a round
  closed anything; the count was the cheapest available proxy, and the incident shows it
  proxying badly.
- **The mechanism's own walls**: the loop already had every ingredient except the measure — the
  gap list is committed driver-visible evidence (0083 D3, overwritten wholesale each round), the
  fix round already spans unboundedly many sessions under the standing handover protocol (0130
  D2 — the continuation loop has no session cap), and the round count already survives
  interruption (`{kind:"wrapup", round}`, 0083 D7). Only the entries' form was uncountable
  ("one entry per gap" freeform); the field's own gap files had long converged on `### Gap N —`
  headings.

## D1 — the countable grammar

The wrap-up template teaches the FAIL gap entries as one `### Gap N — <one-line title>` heading
per gap under a `## Gaps` heading (N counting 1, 2, …); the driver-synthesized lane gap list
emits the same form (each red lane one numbered heading, its bounded evidence the body). The
FAIL-side shape gate extends with the grammar: a FAIL gap list must carry at least one
`### Gap N —` heading — a freeform list is a malformed FAIL for the existing one-re-prompt rule,
then hidden blockage. The driver counts `^### Gap\b` lines and nothing else: content quality
stays the verification session's judgment (P7 — a grammar the driver defines, taught by the
template, pinned by goldens).

## D2 — the progress rule

After each FAIL (the verify session's or the red lane gate's), the loop counts the gap list just
produced. The first FAIL of a loop instance only seeds the baseline; every later one compares: a
strictly smaller count is progress and clears the streak; anything else (same count, grown
count) extends it. `lastGaps` and `noProgress` are the loop's whole state — no new persisted
kind, the two numbers riding the existing wrapup-stage record (D4).

## D3 — the block condition

`FIX_ROUNDS` keeps its name and value with two named meanings: the minimum rounds before a block
may fire, and the consecutive-no-progress threshold. The task blocks only once
`round >= 2 && noProgress >= 2` — at least two rounds ran AND the last two each closed no gap.
The bound above the minimum is progress itself: between two no-progress rounds a progress round
must strictly shrink the count, so a loop starting from N gaps runs at most 2 + N rounds. The
block message names the judgment, not the count: "the last two fix rounds closed no gap (N fix
rounds spent, the gap list still counts K)"; the three person exits are verbatim.

## D4 — persistence and resume

The progress record's wrapup stage gains `noProgress` (consecutive no-progress rounds, omitted
at zero) and `gaps` (the count the last FAIL measured). Both ride every wrapup-stage persist —
the loop entry's and the pre-fix-round's — so a kill anywhere re-enters with the loop's exact
state; a kill between a FAIL's commit and the pre-round persist is idempotent (the resumed run
re-verifies from scratch and re-measures against the record's pre-round baseline).
`sanitizePhaseRound` validates all three fields the way it validated `round`: an invalid round
drops the whole count (re-enter with zero rounds — re-running a verify round is always safe),
invalid state fields drop to their defaults (a lost baseline only delays the streak by one FAIL,
never blocks early). The 0142 dead-channel rewind keeps its roundless `{kind:"wrapup"}` and
thereby drops all three — the unbooked round re-opens, its verification re-seeds.

## D5 — gaps as the round's handover boundaries

The fix session's context-budget protocol gains the round's shape: the round is not bound to a
session — it may span several fix sessions, and gaps are its natural handover boundaries. A
session aims to close one or more gaps fully and hands over at a gap boundary (whole gaps
finished, nothing half-edited); a context wall may still catch it mid-gap with no gap closed —
that handover is legitimate too, the document carrying the in-flight gap's state. Progress is
measured per round (D2), so a no-gap handover session costs nothing against the budget. No
structural change rides this: the continuation loop already has no session cap (0130 D2), the
commit shape stays the round's one commit (this change), and the handoff document's protocol
(`Status: continue|done`) is untouched.

## The floors

- A pack without `### result-line` never fires a FAIL — the loop remains dead weight, the
  zero-intent floor byte-identical.
- `--no-wrapup` keeps its meaning (the closeout read is that path's own, unchanged).
- The `--repair` ladder is untouched: the block still carries the repair fact, `--repair` still
  consumes the same blocked outcome, `bookAttempt` still books a round once it opens.
- The 0142 unbooked round is untouched (rewind, skip, teach — the state drops with the round).

## The named residuals

- A round can trade gaps (close one, have the fresh verification find another) with the count
  holding — that is no progress under the count rule, and two such rounds block. The count is
  the cheapest honest measure; a set-of-gaps identity would judge content, which is P7's line.
- The grammar depends on session compliance, backstopped by the shape gate (malformed →
  re-prompt → hidden blockage) — a repeatedly non-compliant model degrades to today's
  hard-two behavior via zero countable headings never reaching the streak logic.

Derives: **P2** (the person brackets every boundary — the showing: the hard count was a
driver-invented cliff consuming the person's resource while the loop's own evidence showed
progress; the rule re-grounds the escalation on measured forward motion, still bounded — 2 + N
rounds — and still terminating at the person), **P3** (completion is never judged by agent
self-report — the showing: progress is measured from the verification channel's committed
artifact, never the fix session's claims), **P6** (derived state — the two numbers ride the
existing stage record, no new kind, re-derived from gaps.md wherever the loop re-verifies),
**P7** (grammars, never content — the showing: the count keys on a heading grammar the driver
defines and teaches; the entries' substance stays the verification session's judgment), **P19**
(measured evidence — the showing: the t083-250 field report's own round journal — round 1
closing a gap, round 2 greening the crate — beside 0083 D5's own text showing the count was
never a progress claim). Amends: **0083 D5** (the constant-two budget is re-ruled progress-based
— `FIX_ROUNDS` the minimum and the no-progress threshold, the message naming the stalled count;
0083's ladder, booking and lifecycle rules all standing). Tier touched: **mechanism** — core
(`src/wrapup.ts`, `src/resume.ts`, `src/runner.ts`, `templates/prompts/wrapup.md`,
`templates/prompts/fix.md`) and the docs' restatements (structure.md, principles.md,
templates/README.md, AGENTS.md).

Tests: `test/verify-loop.test.ts` — the fixtures moved to the countable grammar; the resume pin
seeded with the progress state (round 1, one no-progress round, baseline 1 — blocking at round 2
with the stalled-count message and the record `{round:2, noProgress:2, gaps:1}`); new —
progress extends the loop (2 → 1 → 1 → 1 blocks only at round 3, three fix commits, the message
naming three rounds spent and the stalled count 1), progress to a PASS (2 → 1 → the evidence
report completes, never blocks), the freeform-list shape gate (no `### Gap N —` heading →
re-prompt with the grammar in the feedback → hidden blockage), the lane gate's synthesized list
pinned in the heading form; `test/repair-loop.test.ts` — the fixture's gap list in the grammar,
the no-budget block pin on the stalled-count message; `test/incident-regression.test.ts` — the
FAIL-path case rewritten to the grammar and the new message with the record carrying the state;
`test/agent-fake.test.ts`'s shared fixture aligned; the goldens regenerated
(`wrapup.golden.md`, `wrapup-testlanes.golden.md`, `fix.golden.md`).

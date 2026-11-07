# 0216 — the template copy's three drifts: fix.md's commit cadence, the default acceptance duty's fix loop, the mode brief's exit vocabulary

Status: active (ruled by 0166 step 056, 2026-11-08). Three findings of the
0165 register out of the S24 templates review, one family — session-facing
copy that states a mechanism's contract drifting from the mechanism itself:
**0165-160** (S24-03, S3 — `templates/prompts/fix.md`'s constraint 5 still
says the DRIVER commits "once the re-verification passes", contradicting
0148 D1's per-session durable batches), **0165-161** (S24-04, S3 — the
default pack's `### v acceptance` duty says `Result: FAIL` "stops the run
for a person to plan the fix", the pre-0083-D5 lifecycle the bounded fix
loop replaced), **0165-162** (S24-05, S3 — `templates/prompts/_mode-brief.md`
lists exit codes 0/1/2/130 only; the frozen vocabulary also defines 3 and
143/129).

The boundary answers first (the requirement-intake rule): the family is
*the driver's own session-facing copy and its agreement with the ruled
mechanism*. Home-set: the fix session's prompt
(`templates/prompts/fix.md`, constraint 5), the default pack's acceptance
duty (`templates/intents/default.md`, the `### v acceptance` subsection —
injected through `planDutiesPartial` into the decompose-<phase> and
formulation renders, pinned byte-exact by the
`decompose-v`/`formulation-todo-v` goldens), the operating-mode brief
(`templates/prompts/_mode-brief.md`, rendered verbatim into every
diagnosis prompt by `src/blockage-diagnose.ts`), the frozen vocabulary's
single owner (this package's `AGENTS.md` operational exit-codes line), the
test homes (`test/verify-loop.test.ts` — the handover case whose log order
is the defect's own repro, its title stale with the retired cadence;
`test/prompt-phase.test.ts`; `test/blockage.test.ts`; `test/golden/`), and
the documentation homes (`plans/INDEX.md`; AGENTS.md/structure.md judged
below — no mapping changes, content-only edits). 0165 is the evidence, not
the authorization: every decision below is ruled here.

## Derivation and Category scope

Derives: **P4** (committing is the completion condition — D1's showing: the
fix session is taught the true durability boundary, every finished session's
batch committed by the driver at the session's own end, so the session never
assumes unverified work is uncommitted at exactly the handover where 0148
guarantees crash safety; the no-agent-commit rule itself unchanged),
**P2** (the person brackets every boundary — D2's showing: the acceptance
duty teaches the true bracket, the bounded fix loop between a FAIL and the
person, with only its exhausted progress budget reaching the person; the
duty's retired wording promised a person stop the driver does not make, so
planners composed acceptance against a lifecycle that never runs),
**P13** (frozen additive-only vocabularies — D3's showing: the exit-code
line is frozen vocabulary and the brief's copy of it is ratcheted against
its single owner, so the next additive growth goes red until the brief
carries it; the vocabulary itself untouched, no code moved), **P15** (policy
is data — all three defects are copy defects in templates; the fix is copy
in templates, `src/prompt.ts`/`src/prompt-plan.ts` untouched, renderers
assemble as before), **P8** (every surfaced line teaches its remedy — the
reworded duty and constraint teach the mechanism the session will actually
face, not a retired one), **P3** (D2's duty keeps the verdict record-only
for the session: completion is never the verifier's fix work, the driver's
bounded loop is another session's job), **P10** (the byte-identical floor:
every template's bytes outside the three defective sentences unchanged; the
fix template's other five constraints, the duty list's other lines and the
brief's other sections byte-identical), **P5** (one home per mechanism — D3
ratchets the brief's line against the owner's line rather than forking a
second vocabulary; the duty's lifecycle sentence stays in the one pack that
all renders inject).

premises this ruling changes: **none**. Each defect is the copy side of an
amendment already ruled and INDEX-annotated on its mechanism: 0148 D1
amended 0083 D4's round-commit shape (the fix template's constraint and the
stale handover-test title are that amendment's unlanded copy half);
0146 D2/D3 (progress-gated, 0198 D1 re-keyed on the loop's best) amended
0083 D5's ladder, and principles.md P2's derivation already carries the
amended lifecycle ("fix rounds (progress-gated, never count-capped — two
consecutive no-gap rounds block, 0146 amending 0083 D5) → `--repair` → the
human") — the duty copy simply never followed; 0014 added code 3, 0143
retained it through the handover/wrap-up boundaries, 0182 grew 143/129 —
additive growth under P13 whose lockstep reached AGENTS.md and the shells
but not the brief. 0082 D3's premise ("the brief versions with the code and
is never a second copy to drift") is re-read and **stands** — the defect is
the premise's own violation, its completion this ruling enacts with the
ratchet that makes the next drift red; 0083 D4/D5 re-read standing (their
mechanism letters unchanged, their copy halves completed here).

Tier: mechanism-adjacent copy (three template sentences and one test title;
no constitutional principle moved, no vocabulary word added, retired or
renamed).

### Category scope

- Copy homes: `templates/prompts/fix.md` (D1 constraint 5's second half),
  `templates/intents/default.md` (D2 the `### v acceptance` duty's
  parenthetical), `templates/prompts/_mode-brief.md` (D3 the exit-code
  line). No `src/` change of any kind — `src/template.ts`'s embedded
  registry keys the file paths, unchanged by content edits (the
  `with { type: "file" }` imports untouched); `src/prompt.ts` and
  `src/prompt-plan.ts` assemble as before.
- Test homes: `test/verify-loop.test.ts` (D1 — the handover case's title
  repaired to the per-session cadence its own body has asserted since 0148,
  plus the copy pin on the dispatched fix prompt), `test/prompt-phase.test.ts`
  (D2 — the v-duty lifecycle pin beside the existing duty-injection tests),
  `test/blockage.test.ts` (D3 — the exit-line ratchet against AGENTS.md's
  owner line, in the existing `_mode-brief` describe), `test/golden/`
  (`fix`, `decompose-v`, `formulation-todo-v` regenerated in lockstep — the
  goldens are the byte pins of the changed renders).
- Documentation homes: `plans/INDEX.md` (this row). AGENTS.md and
  docs/structure.md judged: no navigation line or responsibility row
  changes — the templates' homes and duties are already indexed, and
  content edits inside them shift no mapping (the program's own convention
  for template-content changes).

## D1 — fix.md's constraint 5 states the per-session durability cadence (0165-160)

The constraint's first half (the no-agent-commit rule) is P4's own letter
and stays byte-identical. The second half — "DRIVER performs the close-out
commits once the re-verification passes" — described 0083 D4's original
shape (one round commit after the round's re-verification) and was never
updated when 0148 D1 made every finished fix session's batch a durable
boundary: the commit fires at each handover-continue and at natural round
end, BEFORE the fresh verification judges the round (the crash-safety
guarantee — a kill between sessions loses nothing; the targeted handover
test's own log order — `fix 1.1` commit, continuation, `fix 1.2` commit,
then the re-verification session — is the measured contradiction). New
copy: the DRIVER commits each finished fix session's batch at the session's
own end (a handover included), before the fresh re-verification judges the
round and decides the task's completion. Two truths the session needs: its
finished work is already durable when it ends (so ending cleanly at a gap
boundary is the right move, not a risk), and the re-verification decides
completion, never what stands committed (so it neither waits for the
verdict nor assumes it). The retry/coldstart exception (a re-dispatched
session commits nothing, the replaced session's partial work riding the
next durable boundary) is driver mechanics the session cannot act on and
stays out of the copy. The stale test title — "…the continuation reads it,
and the round commits once" over a body that asserts `fix 1.1` and `fix 1.2`
as separate commits — is repaired in the same change (the title taught the
retired cadence at the exact test that disproves it).

## D2 — the default acceptance duty teaches the bounded fix loop (0165-161)

The duty's instruction ("Verify and record only, do not fix anything") is
correct and stays; its parenthetical carried two falsehoods. First,
attribution: "a gap is reported through the task report's result line" — on
FAIL no report is written at all (the wrap-up template: "write no report at
all. Instead write docs/{{taskId}}/gaps.md … ending with `Result: FAIL`");
the result line carrying FAIL is the gap list's last line. Second, the
lifecycle: "`Result: FAIL` stops the run for a person to plan the fix" is
0083 D5's original ladder-lessness, amended by 0146 D2/D3 (and 0198 D1's
best-keying) into the bounded fix loop the wrap-up template itself states:
fix rounds run while progress holds, the verification re-runs from scratch
after each round, and only two consecutive fix rounds closing no gap stop
the run for human handling. New copy: a gap is reported through
`Result: FAIL` ending the verification's gap list, the DRIVER answers it
with its own bounded fix loop, and only two consecutive fix rounds closing
no gap stop the run for a person — the same words wrapup.md's result-line
paragraph uses, one voice for one protocol. The bundle packs
(cleanroom/faithful/faithful-lean) carry their own acceptance-duty copy;
none repeats the defective sentence (checked), and `templates/README.md`'s
lifecycle lines already state the true loop (read, standing). The planner
and the verifier now compose against the lifecycle that actually runs:
record-only for the session, bounded autonomy for the driver, the person
the terminal of the exhausted budget — P2's derivation line verbatim. The
two goldens that pin the rendered duty (`decompose-v`,
`formulation-todo-v`) regenerate in lockstep.

## D3 — the mode brief's exit line states the full frozen set, ratcheted against its owner (0165-162)

The brief's "Gates and exit codes" line said 0/1/2/130. The frozen
vocabulary (AGENTS.md's operational line, the single owner) is
0/1/2/3/130/143-129: 3 is the `/exit` pause under `--interactive` — a safe
boundary, progress persisted, rerun to recover (0014; retained through
0143's handover and wrap-up-entry boundaries); 143 SIGTERM and 129 SIGHUP
are the supervisor's stop through the same force-terminate cleanup (0182).
A diagnosis session is the one reader that classifies observed run ends —
the missing 3 is the finding's own impact: a deliberate paused run
misread as an anomalous block, a remediation proposed against a wrong
scene. The line now states the full set in the brief's own compact
register (2 completed to the owner's "blocked or reverted to pending for
human attention" — the brief's old "blocked for human attention" was a
true-but-shorter paraphrase, completed in the same pass), and a ratchet
pin binds it: the test reads the owner's line, extracts every backticked
code (`0 1 2 3 130 143 129`), and asserts each appears in the rendered
brief — the next additive growth of the vocabulary (a new code in AGENTS.md)
goes red until the brief carries it, the P13 lockstep made mechanical.
Meaning pins for the finding's own subject: 3's pause-and-rerun wording and
the 143/129 supervisor line. Family checks read, nothing else to fix: the
manual prompts/ suite restates no exit vocabulary (the two "exit code"
hits are lane-log protocol, not the run's contract); auto-server's daemon
consumes the codes into run states and its own table already maps 3
(`paused`) — its 143/129 note is S30's family, recorded in the step record
as an observation, no 0165 finding there.

## Floors

- Every template's bytes outside the three changed sentences
  byte-identical; the renderers and the embedded registry untouched (the
  `with { type: "file" }` imports stand); the built-in template set and
  every override contract unchanged.
- The no-agent-commit rule, the record-only duty instruction and the
  brief's gates/channels/ownership sections unchanged — the defects were
  each one sentence's claims, not the surrounding contracts.
- The goldens' regeneration is exactly the three sentences' diff (verified
  by the golden comparison — no renderer drift can hide in it).
- Named residuals: the S25 manual-suite mirror of these copies is the
  manual wave's own register family (steps 070+; the register's W-manual
  rows); auto-server's daemon comment naming 0/1/2/3/130 without 143/129
  (its `terminalOf` default arm records an unexpected code verbatim under
  `failed` — honest, and a death by signal is its own branch; S30's
  surface, no finding); the ratchet binds the brief to the owner line's
  codes, not each code's full prose meaning (the meaning pins for 3 and
  143/129 carry the finding's subject; a future rewording of another
  code's prose in AGENTS.md would not redden the brief's paraphrase — the
  code-set lockstep is the frozen half).

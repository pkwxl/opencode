# 0130 — the standing context handover: every whole-task session and fix round runs the 0056 protocol

The maintainer's request (2026-10-26, three turns): the manual driver's suite bounds each child session with a
budget — a task child holds a one-hour budget and hands its work over properly through `docs/T-NNN/handoff.md`
so its context stays a reasonable size; the automatic driver should do the same, *hinting* a session to hand
over properly rather than forcing it. The follow-up turns widened the framing: the when-to-hand-over decision is
dynamic (token overhead, completion time, quality, task characteristics — analysis keeps long context, testing
wants focus), fixed static configurations cannot adapt, and the want is "a more intelligent, empirically
supported design pattern" coordinating cost, quality and time.

The first finding: **the mechanism already exists.** Plans/0056 (2026-09-26) ported exactly this from the manual
suite — usage notices at 50%/85% of the effective wall, the session deciding when to hand over at a natural
boundary, the hard-wall hint as a last resort that is still a steer, never a kill, and the document-authoritative
post-session check — with the founding request nearly verbatim the maintainer's phrasing ("the session should
decide when to hand over, informed by the driver rather than interrupted by it"). Two of its deliberate
divergences from the manual suite are kept: the wall is keyed on **measured context tokens** (the manual suite's
clock budget is a human master control's substitute for exactly this measurement — the driver holds the real
figure at every assistant message), and no runaway session is ever killed (the manual master control kills a
child past its budget; the driver's worst escalation is demanding a valid `Status:` line, a bounded P2/P20
escalation — the maintainer's "hint, not force" matches the automatic side's design, not the manual side's).

The second finding: **the gap was coverage, not mechanism.** The protocol existed only where the `--subtask
ondemand` mode (and auto's lead + split streams) built it. The default mode — `off`, what every fresh project
runs — built none of it: a long task ran one session into provider-side compaction/cap errors and the
session-error retry path. The 0127 field incident's 415.9k-token session (the fork-with-doomed-one-call-plan
recovery) is the measured shape of that gap. Fix rounds (the wrap-up loop's `fix.md` sessions, the manual
suite's `run-fix.md` budget fill included) had none of it either; the planned pipeline's subtasks stay excluded
(0056 D1's ruling — pre-scoped small units — untouched, no field evidence against it).

The third finding, on the "dynamic" framing: the right adaptation pattern is already the corpus's —
measurements to the informed party (the session holds the task's nature; the driver supplies real figures),
declared policy as data (the role registry's usage flags), parameters adjusted by field evidence at release
time (0059 D6 raised the wall that way), runtime learning reserved for observable external facts (quota
windows). A driver-side task-characteristic classifier would be a P7 violation; a runtime self-tuning strategy
engine before any measured signal would be P21's speculative generality. This change takes the measured step of
that pattern: extend the coverage, enrich the decision input, plumb the economics so a *future* adjustment is
P19-legal.

This ruling Derives: **P20** (in-flight work is never destroyed — the showing: the hint-not-force protocol is
the advising shape, and it now covers the sessions that ran without it), **P8** (deliberate enforcement moments
— the notices teach, nothing blocks, the wall's only demand is a document before the end), **P10** (the
byte-identical floor — `OPENCODE_AUTO_STEER=off` restores the exact old behavior of every mode; the default
mode's gain is the one ruled behavior change, the switch the per-project floor), **P13** (frozen additive-only
vocabularies — `ondemand` becomes a documented permanent synonym by the boolean-`true` precedent, the
run-status event table grows one name in lockstep with its ratchet), **P19** (measured evidence — the coverage
gap cited from the 0127 incident; the handover event plumbs the economics for the next ruling), **P5** (single
ownership — one protocol, one engine, one handoff document family; the fix round reuses `handoverVerdict`
rather than growing a second verdict). Tier touched: **mechanism** — behavior, templates, one config synonym,
one journal event; no principle text.

## Category scope (0123 D1's discipline)

Family: *the context-handover protocol's holder set (0056/0059 D5) — which sessions build the steer, which
modes, which vocabulary names them.* Home-set enumerated at ruling time:

| home | disposition |
|---|---|
| `src/execute.ts` (`executeWhole`'s steer construction, the `ondemand` parameter, `handoverVerdict`/`HandoverState`/`HandoverScope` exported for the fix loop, the `session-handover` emission, the prior-document gate) | changed — D1/D5's main enactment |
| `src/wrapup.ts` (`runFixRound`'s handover loop) | changed — D2's enactment |
| `src/runner.ts` (`selfHandover` removed, the leftover cleanup unconditional in the whole-task branch, `resolveDecompose`'s whole/downgrade mapping) | changed — D1's wiring |
| `src/config.ts` (`subtaskOf`'s synonym, `saveProjectConfig`'s write-boundary canonicalization) | changed — D3 |
| `src/prompt.ts` (`renderWhole` drops the dead `ondemand` render flag; `renderFix` gains `continuation`/`budget`/`handoffFile`; `usageNoteCtx` gains `{{remaining}}`) + `templates/prompts/fix.md`, `usage-note-winddown.md` | changed — D2/D4 |
| `src/testrun.ts` (`fillUsageNote`'s remaining figure, comments) | changed — D4 |
| `src/run-status-schema.ts` + `test/run-status-schema.test.ts` | changed — D5's additive event, in lockstep |
| `src/opts.ts`/`src/switches.ts`/`src/docpaths.ts`/`src/document/roles.ts`/`src/capability.ts`/`src/resume.ts`/`src/resume-gate.ts`/`src/roles/registry.ts`/`src/engine/contract.ts`/`src/work-order.ts`/`src/stats-schema.ts`/`templates/README.md` | held with wording updates only (comments/prose that named ondemand as a live mode; `stats-schema` keeps the word for reading historical files) |
| The planned pipeline's subtask sessions (`runSubtask` without a split) | held, untouched — 0056 D1's exclusion stands |
| The wrap-up (verification) session | held, untouched — bounded by the report; a consumer waits (P21) |
| Runtime adaptivity (wall self-tuning, per-phase-type bands, the pack-declared usage policy) | deferred — the declared-policy surface and any runtime tuning wait for the measured signal this change starts collecting (P21; step 3/4 of the discussion's ladder) |
| `packages/auto/src/index.ts` (the `parseSubtask` comment) + `packages/auto/test/e2e.test.ts` | changed — the synonym's read-back pinned through the real CLI |

## The ruling

**D1 — the protocol is standing for every whole-task session; `ondemand` merges into `off`.** `executeWhole`
builds the steer whenever the whole role's usage policy and `OPENCODE_AUTO_STEER` say so — the mode parameter
that once gated it is gone (`off`, `auto`'s lead, and `ondemand` all were the same session modulo the clause),
the recovery `prior` read follows the steer instead of the mode, and the runner's leftover-handoff cleanup
becomes unconditional in the whole-task branch (every whole-task mode can now leave one). `subtask: "ondemand"`
stays accepted forever and reads back as the canonical `"off"` at both config boundaries (load and write) —
the JSON-boolean-`true` precedent's treatment applied to a merge the ruling itself created; a hard tombstone
would break every stamped `ondemand` config for naming a mode that no longer differs, and a live synonym
documented openly is not a silent dual meaning. `resolveDecompose` maps the `Decompose: whole` field and the
split downgrade to `off`. The one deliberate behavior change: a default-mode project gains the notices, the
protocol block in its whole-task prompts, and the post-session handover check on upgrade — with
`OPENCODE_AUTO_STEER=off` the per-project floor restoring the old bytes exactly.

**D2 — fix rounds run the protocol.** `runFixRound` builds the same steer (the whole role's usage policy — a
fix round is a whole-scope execution dispatch) and loops on the exported `handoverVerdict` engine under the
fresh retry policy: a fresh `Status: continue` document (self-directed or wall-forced) hands the round to a
continuation fix session whose prompt reads `docs/<id>/handoff.md` first (the task-level file the manual
suite's fix children share too); `Status: done` or a quiet end is the round's natural finish; a due handover
without a valid document takes the engine's single retry with feedback, then blocks (no rollback redo inside a
round — the strict-resume unit rollback stays the execution stage's). The engine's `consumed` seed is the text
at the round's entry, so the execution stage's own completion document is not misread as a signal, and an
interrupted fix session's `Status: continue` seeds the resumed round's first continuation. The round's budget
is untouched — the handover splits the round's *sessions*, never its `FIX_ROUNDS` count or its one commit.

**D3 — the vocabulary surface (the synonym above).** Nothing added to `SUBTASK_MODES`, nothing hard-retired,
one value demoted from mode to documented synonym; the shell's value list stays valid as printed.

**D4 — the wind-down notice names the remaining headroom.** `fillUsageNote` fills a new `{{remaining}}` slot
(wall minus used, floored at zero) and the 85% notice carries it — the figure a rational handover decision
needs beside the percentage (the informational 50% notice already implies its half). The decision stays the
session's; the driver's notices get better, not louder.

**D5 — every handover lands in the run-status journal.** One additive event, `session-handover`, emitted by
the engine's continue branch for every scope (`whole` / `subtask` / `fix`), carrying `due` (the wall forced it
versus the session's own boundary), `used` and `wall`. The 0127-adjacent economics — what a handover costs in
continuation re-priming, where sessions actually hand over versus where the wall forces them — become
measurable from `.auto/run-status.jsonl` paired with the usage roll-ups; no runtime consumer exists yet (P21:
the measurement first, the mechanism when a signal shows).

## Enactment

The five homes above; tests re-pinned or added: `test/execute-handover.test.ts` (the parameter gone, the
protocol the standing shape), `test/verify-loop.test.ts` (the fix-round self-directed handover case: the
continuation prompt reads the document, one fix commit, the round's budget intact), `test/config.test.ts` (the
synonym's read-back), `test/decompose-field.test.ts` (the whole/downgrade mapping to `off`), `test/golden/`
(the winddown notice's new figure; `whole-budget` goldens unchanged — the merged mode renders byte-identically
to yesterday's ondemand), `test/agent-fake.test.ts` (off/ondemand/auto dispatch equality), the capability-note
wording, `test/run-status-schema.test.ts` (the ratchet and a constructible sample), and the shell e2e (the
synonym through the real CLI at init, amend, status and a hand-edited file). Documents: this file, the INDEX
row, the AGENTS.md navigation phrase, the `docs/structure.md` Task-pipeline/Wrap-up/Test-run rows, the
`docs/glossary.md` session-handover row, `templates/README.md`.

Verification: full typecheck clean; both suites green (auto-core 2773, the shell 147); the closing read below
ran the real CLI.

## The closing read

A scratch project (`init --subtask off`, then `--subtask ondemand` at amend — exit 0, the config reading
`"off"` both times, `status` printing `subtask off`, a hand-edited `"ondemand"` value canonicalized by the
next amend); a scripted run whose whole-task session renders the Context-budget protocol block under the
default mode, `OPENCODE_AUTO_STEER=off` rendering it away; the winddown notice steered at 85% naming the
remaining headroom; a fix session's `Status: continue` handover continuing in a fresh fix session that reads
the document and closing the round with its one commit; and the run-status journal carrying the
`session-handover` lines — `due: false` for the session's own boundary, `scope: "whole"` / `"fix"` as
dispatched.

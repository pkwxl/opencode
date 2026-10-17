# 0101 — Person-bracketed boundaries: transfer, the reviewed plan task, and roadmap-driven establishment

Three defects, one morning. On 2026-10-17 the `root/common` project
(`/home/wxl/workspace/root/common`, `--intent cleanroom`) ran R-01.P01-survey's
formulation synthesis — a deep-tier constructor session re-voicing the brief and
the released analysis under the charter — while `docs/R-01/round.md`, the
document every planning session plans against, was still the untouched template
stub: **no person eyes and no mechanical check stood between the plan task's
construction and its dispatch**, so the run was about to spend the phase's
whole planning session on an input composition nobody had confirmed. The same
project's roadmap names a different phase list per round class ("build rounds
run the full list …; import rounds amend to `survey,implement,test,audit`"),
yet following the person's own approved document means hand-transcribing its
line into `amend --phases`, re-running `plan`, and discarding the first
establishment — 0084 D6 ruled the roadmap advisory, and the advice line
(`src/plan.ts:840`) prints the exact command the person must copy. And the
command surface itself is overloaded: bare `plan` both applies the analysis
(establish) and dispatches the planning session, one verb spanning the one
seam where a review gate belongs.

The ruling this plan lands: **the person brackets every boundary, the documents
decide, the driver applies.**

- **`transfer` — the single advance command** (0088's vocabulary, one verb from
  project birth to roadmap exhaustion): applies the analysis at project start,
  closes each phase, closes each round, opens each next round — and after every
  construction **stops for review** of the plan task it just built.
- **The reviewed plan task.** The formulation todo (0095) is constructed by
  `transfer`, reviewed by the person, and dispatched by `plan` — two commands
  where today one automatic step runs, the review living in the seam. The todo
  stays driver-owned; rejection fixes the inputs, never the rendering.
- **Roadmap-driven establishment.** The released `## Roadmap` line for a round
  *is* its phase list — applied, named in the stop, no transcription. Config's
  `phases` becomes the fallback for rounds the roadmap does not cover.
- **The re-derivable tail.** A round's unstarted phases stay reshaping
  evidence: at any boundary the person may `amend --phases`, and the survey
  gate's release — the first evidence-grounded moment — is where the roadmap's
  cold plan meets the inventory's findings.

## Decisions

**D1 — the boundary stop, run's new tail.** `run` ends when the current
phase's last task unit closes — *before* the handover distillation, the phase
close, the round close and the next formulation. All of that closing work
becomes `transfer`'s (D2); `run`'s contract narrows to "execute the planned
work of the current phase". The stop lands only at a clean phase end (every
unit done, lanes drained, doc lanes landed) — mid-phase autonomy is untouched,
and interruption recovery keeps today's shape. The lift, for trusted
unattended stretches: `run --boundary flow` restores today's continuous
crossing (a run-side width, the 0079 §4 precedent — never a config key, and
deliberately no `OPENCODE_AUTO_*` switch: the boundary shape is interaction
grammar, not an experiment). The stop names the next command. `stopBefore:
"execute"` (0053 D5–D8) is orthogonal and unchanged.

**D2 — `transfer`, the single advance command.** New `src/transfer.ts` on the
`closeUnit`-wrapped-for-the-person precedent (`plan --force-close`), taking the
run lock and the clean-tree refusals of the `plan --append` family. One
advance per invocation — four shapes, resolved by state:

1. *Project start* (no round). The 0084 rows 0/0a–0d re-homed: analysis
   missing → stub `docs/analysis.md` and stop (the assisted guidance state
   attaches, keyed to `transfer`); analysis present but unreleased → the
   release-gate stop naming the `Clarified: yes` line (today's shapes and exit
   semantics as they move); released → validate, install the approved brief
   (`installBriefProposal`), establish R-01 with phases resolved per D5,
   construct P01's formulation todo through the ordinary compose → verify →
   construct pipeline (the `prompt-audit` commits included), stop for review
   (D3).
2. *Phase boundary* (current phase complete). Refuses — exit 2, the
   awaiting-person shape — while the survey gate holds, naming `survey.md`,
   the open forks and the `Clarified:` line; the person's release act stays
   writing that line, and `transfer` absorbs what today's `run` re-entry did
   (`installApprovedBrief` on release, the gate re-check). Then: handover
   distillation, phase close (the transfer's commits unchanged), construct the
   next phase's todo, stop for review.
3. *Round close* (the phase just closed was the round's last). The same
   invocation additionally performs the round close (the report-for-user gate
   and friends) and stops there — deliberately not chaining into the next
   round: the full stop between rounds is the person's natural moment with
   R-NN's report before committing to R-NN+1.
4. *Round open* (round closed, roadmap holds a next line). Establish the next
   round (D5), construct its first phase's todo, stop for review. Roadmap
   exhausted: exit 0 saying so, naming the channel — extend `## Roadmap` with
   the coding agent and run `transfer` again (0084 D3's documents-are-the-
   interface rule, holding to the end).

**D3 — the review gate, and the rejected edit channel.** `transfer`'s
post-construction stop names the todo's path (`docs/T-NNN/todo.md`), the
`prompt-audit.md` lines beside it (synthesis / fidelity / FALLBACK), the
round-brief duty, and the review instruction. The todo is driver-owned state:
**the person never edits it** — a person commit between `PLAN formulate` and
the session's commits would land inside the unit's commit range and break the
0021 close-out purity check, and the driver-exclusive-writes invariant holds.
Rejection is a first-class outcome with a defined lever: fix the inputs
(`round.md`, `plan-input.md`, `brief.md`, the roadmap line) and re-run
`transfer` — construction is idempotent rewrite-on-diff (0095), and 0097 D6's
digest-keep preserves a pending todo when the floor is unchanged, so
`transfer --resynthesize` forces re-voicing when the synthesized ledger itself
is the rejected part. And the incident's guard: **`plan` refuses (exit 2,
awaiting-person) while `docs/R-NN/round.md` is the untouched stub**
(`roundBriefText` → undefined) — no planning session dispatches against an
empty round brief; the refusal names the fill.

**D4 — `plan` re-scoped to the dispatch half.** Bare `plan` = run the
awaiting, reviewed formulation task: one session chain under plan's lock (the
formulation session, the collect checks, the wrap-up), stop on completion —
the produced index and task documents are committed, so the person's *second*
review, of the actual decomposition, is free, and `run` is its approval act.
Refuses (exit 1, usage) when no reviewed plan task awaits, naming
`transfer`. The planning-input discipline adapts 0053 D10's restart rule to
the seam: an input that changes after construction invalidates the todo the
way it restarts an open planning step today — `plan -p/--file` that changes
what the todo rendered refuses naming the re-run of `transfer`, whose
idempotent reconstruct absorbs it. The other rows are untouched (`--append`,
`--new-task`, `--force-close`, `--round`, `--phase`, `--scaffold`).

**D5 — roadmap-driven establishment.** `establish()` resolves the round's
phases as `roadmapPhases(analysis, round) ?? config.phases` — the line's type
ids validated through the ordinary establishment validation, so a line whose
types the pack no longer ships fails strictly (exit 1) naming the line. The
stop names source and value ("R-05 established: `survey,implement,test,audit`
— the roadmap of docs/analysis.md (import class); config default was the full
list") — application is visible, the round-start commit remains the person's
veto, and later boundaries (D3's review, D6's gate) remain better-evidenced
amendment points. `amend --phases` stays the explicit channel and **its output
names precedence** when a released roadmap line covers the next round ("the
roadmap covers R-06 with X; edit the line to diverge") — otherwise the person
amends, re-establishes, and is silently overridden. The advice line at
`src/plan.ts:840` retires with its double-establishment wart and its "amend
before committing" ordering trap: one `plan`-equivalent invocation establishes
under the resolved value. Rounds beyond the roadmap's lines fall back to
config, today's behavior. Phased mode only — an m-mode project has no phased
roadmap. Supersedes 0084 D6's advisory-only ruling (D4's release-check
machinery unchanged). The literal alternative — auto-invoking `amend` per
round, writing `config.json` each time — is rejected: the constitutional
default would churn per round while the roadmap stays the living authority;
resolution at establishment writes nothing.

**D6 — the re-derivable phase tail.** A round's `phases.md` tail — every
phase with no directory and no planning yet — is reshaping state, not
commitment. At any `transfer` review moment the person may `amend --phases`,
and the next `transfer` re-derives the unstarted tail from the resolved value
before constructing (the D5 resolution applied to the tail; the driver rewrites
its own `phases.md` on its own commit; started or ticked phases are
immutable). The survey gate's release is the designed first use — the moment
F10's evidence exists: `transfer`'s gate-held refusal and the survey.md
awaiting line name the channel, so the inventory that contradicts the cold
roadmap is acted on with the findings in hand. This is the ruling the
opening incident's project structure asked for: the survey decides what the
round really does, mechanically, not just rhetorically.

**D7 — the surfaces.** The AGENTS.md guidance states re-key to the new
boundaries (0084 D2 amended): the analysis state attaches from `transfer`'s
stub, the establish/next lines re-point to the `transfer` → review → `plan` →
`run` rhythm, the block's prose carries the new grammar. The shell
(`packages/auto`) gains the `transfer` row (a directory argument, no flags but
`--resynthesize`; usage beside `plan`), narrows `plan`'s bare form, adds
`run --boundary`, and updates README/MANUAL. `status` names the awaiting
state (which command, which document). This package's AGENTS.md gains the
navigation line; `docs/structure.md` gains the `src/transfer.ts` row and
amends the plan/loop rows. The manual-driver prompts suite (0088–0095) is
untouched — its own grammar already rules this philosophy for agent-driven
runs; the ratchet suite is unaffected.

**D8 — m mode, the off path, exit codes; the rejections recorded.** m mode
keeps today's shape entirely (the single implicit phase, the formulation
riding `run`, the planning input the person's lever — no boundary vocabulary
applies). `OPENCODE_AUTO_ANALYSIS=off`: `transfer`'s project-start shape
degrades to direct establishment from config, no analysis machinery. Exit
codes: review stops and the round-open/exhausted stops are 0 (work complete,
next step named); the gate-held and stub-round refusals are 2
(awaiting-person); usage and state errors 1. Recorded rejections: the
dedicated `survey` command (named after a phase type some rounds do not
contain — the uniform advance verb wins); person edits of the todo (D3);
per-round config churn (D5); and retiring the survey phase into the analysis
guidance — that regresses 0081 F10 to the undisciplined state that produced
it; the survey phase, its gate and its 0085 decision discipline are unchanged
here.

## Stages

- **Stage A — roadmap-driven establishment** (smallest, independent, useful
  alone): D5 — the resolution flip in `establish()`, the sourced stop line,
  `amend --phases`'s precedence note, validation routing, the advice line's
  retirement. Tests: the roadmap line wins over config; the fallback when no
  line covers the round; the invalid-line strict failure naming it; the amend
  output's precedence wording; the double-establishment path gone.
- **Stage B — the boundary stop and `transfer`**: D1, D2 — run's tail
  extraction (the loop stops after the last unit's close-out), `src/transfer.ts`
  with the four shapes and their refusals (lock, clean tree, gate held,
  nothing to advance, roadmap exhausted), the gate-release absorption, the
  shell `transfer` row and `run --boundary flow`. Tests over fixtures: the
  boundary stop lands only at clean phase ends; each shape's stops and exit
  codes; one advance per invocation; the round-close-then-stop split; lanes
  drained before the stop; `--boundary flow` crossing as today.
- **Stage C — the review gate and `plan` re-scoped**: D3, D4 — the
  post-construction stop's output, `--resynthesize`, the stub-round refusal,
  bare `plan`'s narrowed contract, the input-invalidation rule, `status`'s
  awaiting row, the shell usage texts. Tests: dispatch refused without an
  awaiting task; the stub-round refusal and its fill; the input change
  refusing with the re-transfer naming; `--resynthesize` bypassing the digest
  keep; no person-edit channel anywhere (the todo's digest discipline).
- **Stage D — the re-derivable tail**: D6 — boundary-scoped `amend --phases`,
  the tail re-derivation before construction, started-phase immutability, the
  gate-held refusal's channel naming. Tests: tail reshape at a boundary;
  refusal mid-phase; ticked phases untouched; the survey-gate walkthrough.
- **Stage E — close**: D7 — the AGENTS.md guidance-state re-keying and the
  navigation line, `docs/structure.md` rows, the README/MANUAL rows, full
  `bun test` and `bun typecheck` clean.

## The lifecycle walkthrough (root/common, after this lands)

`init --intent cleanroom` → `transfer` (stubs `docs/analysis.md`, stops with
the assisted guidance) → the person's agent completes the analysis, the person
writes `Clarified: yes` → `transfer` (installs the brief, establishes R-01
with the roadmap's build-class full list — sourced stop line, no advice to
transcribe) → review P01's todo (round.md still a stub: the stop says so;
fill it, re-run `transfer`, the reconstruct absorbs it) → `plan` (the survey
formulation session) → `run` (the survey tasks write `survey.md`; forks open,
`run` stops exit 2) → the person resolves the forks — and where the inventory
contradicts the round's cold tail, amends and lets the next boundary re-derive
it (D6) — writes `Clarified: yes` → `transfer` (closes P01, constructs
P02-spec-read's todo, stops) → review → `plan` → `run` → … → `transfer`
(closes P06-audit and the round, stops with R-01's report named) → `transfer`
(opens R-02 with `survey,implement,test,audit` — the import-class line,
applied) → …. The stub-brief planning that started this plan cannot happen:
the gate stands where the tokens are spent.

# 0243 — Open rounds and the maintenance scenario modes

Status: **active-authority** — two coordinated opt-in mechanisms landing in
one change: **A**, four new built-in scenario modes (`debug`, `fix`, `fork`,
`pr`) — prose only, the mode layer's 0079 §5 ruling untouched; **B**, the
**open round** — a light round *kind* entered by a released roadmap line
whose phases slot is the single reserved word `open` (`- R-NN open —
<goal>`): a single implicit implement phase that never hands over and never
auto-closes, tasks entering one by one (`plan --new-task` / `--append`), the
round closing by `transfer` at the person's filled `## Close`. The
admission evidence is the maintainer's own reported field case: the
`--intent` apparatus carries a project well from establishment through
completion, but circling back post-completion is measured-heavy — fixing one
bug on a completed phased project costs a roadmap-line edit + **4×`transfer`
+ `plan` + `run` + 2 person commits**, a full round directory (G1 brief
fill, formulation construct/review, handover distillation, `## Close` fill,
round-close build/scan) and 3+ AI sessions, because rounds are the only
container and every round carries the full phased ceremony.

## Derivation

Derives: **P2** (the person brackets every boundary — the open round's open
stays the G1 round-start commit and its close stays the person's filled
`## Close` plus one `transfer`; the removed weight is the *per-phase*
ceremony between those two person brackets, never a bracket itself; every
automatic arm terminates at the person exactly as the phased shapes do),
**P10** (the byte-identical floor — both mechanisms are opt-ins a project
never touches unless its released roadmap carries an `open` line or its
config names a new mode: every existing project, index and prompt renders
byte-identically, held by the unchanged suites), **P13** (frozen
additive-only vocabularies — the roadmap grammar grows the reserved word
`open` alone in the phases slot with `open`-beside-other-tokens a named
release problem and a custom phase type named `open` refused at load; the
index grammar grows the optional `Kind: open` line with any other value a
load failure; the mode-name table grows four names; every parser, renderer
and pin moved in this one change), **P15** (policy is data — the four modes
are template files registered in one table, zero copy authored by code; the
open round's teaching lines render through the 0102/0105 family so the
person-proxy brief prints the terminal's bytes), **P19** (measured evidence
— the admission is the maintainer's field report plus the corpus-derived
minimum path above; the per-issue cost after the change is measured by the
new lifecycle test at exactly two commands), and **P21** (machinery waits
for its consumer — the consumer is the maintainer's own post-completion
workflow; the declined/deferred halves are recorded as cost below). It
Amends: **plans/0101 D2** (transfer's state-resolved shape list grows the
open-round intercept — pending work or an empty index refuses teaching the
open channels; the filled `## Close` is the close intent, the close arm
lands it; the four original shapes stand untouched for every normal round)
and **plans/0137 D3** (m mode stays the whole-project compatibility floor,
its machinery untouched — the ruling's framing is restated: the
never-closing shape m mode pioneered becomes a *supported per-round kind* on
phased projects, entered by the roadmap line, while bare `init`'s single
phase remains the floor, not a recommended start). Tier: **mechanism** —
new scheduling-adjacent arms in the phase loop and transfer, beside the
data-layer mode files.

## The measured findings

1. **The post-completion pain is structural, not incidental.** With the
   round complete, `routePhase` returns `complete`; plan's row 2 refuses
   every option naming transfer (`src/plan.ts` row 2); the minimum legal
   path for one bug is the full round ceremony enumerated above (measured
   over the corpus's own command grammar — the exploration record of this
   change). The only never-closing shape today is m mode, classified by
   0137 D3 as internal floor and refused by transfer (`src/transfer.ts`'s
   m-mode arm).
2. **The mode layer is absent the maintenance postures.** `loadModes`
   ships `migrate` alone; the person's debug/fix/fork/pr scenarios have no
   prose posture, and the overlay channel (`.opencode/auto/modes/`) demands
   the person author protocol-complete files to get one.
3. **The work-shape ask resolves inside the existing channels.** 0079 §5
   ruled scenarios never become registry twins ("`migrate` is a scenario,
   not a work shape") and 0137 ruled the roadmap line the one reshape
   channel; a mode that configured phases would amend both. The open round
   delivers the light work shape through the line, composing with the mode
   prose (`amend -m fix`) rather than competing with it.

## Category scope

The requirement family: **the round-lifecycle/boundary family** (round
establishment, phase transitions, round close — the person-bracketed
boundary machinery), with the mode layer riding along as its data family's
additive growth.

| home | carries | this ruling |
| --- | --- | --- |
| `src/roadmap.ts` | the roadmap line grammar and released readers | **changed** (D1): `RoadmapRound.kind`, the `open` parse, the divergence guard |
| `src/analysis.ts` | release gates, establishment resolution | **changed** (D1, D2): the reserved-word release problem; `resolveRoundPhases` threads the kind |
| `src/phases/registry.ts` + `src/phases/custom.ts` | the phase-type vocabulary | **changed** (D1): `OPEN_KIND` in the vocabulary table; the custom-type name reservation |
| `src/phases.ts` | the round/phase state machine, establishment | **changed** (D2): the index `Kind:` line, `PhaseState.open`, `roundIsOpen`, the pre-seeded brief arm, the drift pin |
| `src/round-brief.ts` | the round brief and its install | **changed** (D2): `renderOpenRoundBrief`, the seed-untouched comparison, the install's seed exception |
| `src/loop-phase.ts` | the phase loop | **changed** (D3): the implied append and the never-closing wrap-up arm, keyed on the kind |
| `src/transfer.ts` | the advance command | **changed** (D2, D4): the open intercept, the close arm, the establishment's open G1 and proposal-over-seed stops, the interrupted-close heal |
| `src/plan.ts` | the prelude, the establishment, the line families | **changed** (D2–D5): the open-round rows, the establishment's kind threading and guidance, the open line helpers |
| `src/status.ts`, `src/driver-helper.ts`, `src/agents-block.ts` | the read-outs | **changed** (D5): the open-round tree note, two state rows, the round guidance variant, the primer and analysis-state teachings |
| `src/mode.ts` + `templates/modes/` | the mode layer | **changed** (A): four built-in files, one table each |
| `src/round-close.ts`, `src/tasks.ts`, the task pipeline | the close checks, the task store, per-task rigor | **held** — reused as-is (the close arm calls the same `roundCloseProblems`; per-task verification/commits unchanged: the ceremony removed is per-phase, never per-task) |
| `src/bundle.ts`, `templates/bundles/` | intent bundles | **held** (C: the `fix` bundle deferred) |
| `packages/auto` (help, README) | the person-facing surface | **changed** (A, D5): the mode list, the open-round section |

## Decisions

### A — the built-in maintenance mode family (finding 2)

Four mode files under the two-section protocol, registered in `loadModes`
(file + import + table entry, the AGENTS.md build convention): **debug**
(reproduce → diagnose → fix → verify; no fix before a failing reproduction
or a named cause; instrumentation removed; the diagnosis converted into a
failing test), **fix** (one issue per task, smallest coherent diff, every
fix with its regression test, nothing riding a fix), **fork** (divergence
small, recorded, mergeable; every deliberate divergence a recorded
deviation with its upstreaming disposition), **pr** (one review-ready
change set; tests and docs planned with the behavior; commit hygiene part
of the deliverable). Prose only — the 0079 §5 separation stands; `amend -m
<name>` switches the project's posture in one act. The floors are pinned by
the unchanged prompt suites.

### D1 — the roadmap kind grammar (findings 1, 3)

`open` alone in a line's phases slot parses as the kind: `roadmapRounds`
carries `{ phases: "implement", kind: "open" }` (the kind establishes its
single implicit implement phase by definition); `resolveRoundPhases`
threads the kind; `phasesDiverge` never compares an open line against
config (a category error, not a supersession); `releasedRoadmapRounds`
counts open lines normally (the exhaustion logic stands). One legal
spelling: `open` beside other tokens (`open implement`, `analysis,open`)
is a release problem `analysisProblems` names with the reserved-word
teaching; a custom phase type named `open` is refused at load
(`typeNameProblem`), the word living in the registry's vocabulary table so
both planes share it without a cycle.

### D2 — the establishment (finding 1)

`establishRoundSetup` resolves the kind and `establishRound` writes it: the
index records `Kind: open` directly under the title (write-once; absent =
a normal round — every pre-0243 index reads unchanged; any other value is
a load failure `readPhases` names), and the round brief is **pre-seeded**
— `## Goal` carries the line's goal verbatim (genuine planning input;
`roundBriefText` over the seed is defined), acceptance/release/`## Close`
stay the stub's hints. The G1 round-start commit stands: the open round
opens bracketed by the person's review exactly as a phased round. A
released `### R-NN` proposal **beats the seed** and installs verbatim at
the establishment itself (the m-mode arm's precedent — no construction
exists for the advance's seam to carry it): `installRoundBrief`'s
never-clobber guard takes the seed rendering as the one driver-written
exception. The open round's phase list is pinned: `phaseTailDrift` returns
undefined for an open round, so the one reshape channel never rewrites the
kind's definition.

### D3 — the loop semantics (finding 1)

The phase loop rides m mode's never-closing shape scoped to the kind
(`roundIsOpen`, one predicate every open-aware consumer reads): **no
formulation constructs, no handover distills, no boundary stop fires**
inside an open round. A planning input implies the append (m mode's D23
rule, scoped to the kind); with no pending task the run wraps up (exit 0,
the phase stays open) teaching the open channels; an empty index teaches
the first `--new-task`. Everything per-task is unchanged — the lead
session, the verification session, the bounded fix loop, the unified
commit, the regression boundary, `--repair`, work orders, the retry fork.

### D4 — the close and the advance's open arm (finding 1)

`transfer` on an open round: pending work (or an empty index) refuses exit
2 teaching the open channels (`run`, `--new-task`, the `## Close`); the
filled `## Close` is the close intent in every state — over pending tasks
it refuses naming `run` and `close <ref>` (never a silent fold), over done
or empty work the **close arm** lands it: the round-close checks gate
(`roundCloseProblems` — the build and the restatement listing; failing →
exit 2, nothing closed), the phase's own gates read ahead of the rename,
`completePhase` plus a `phase-transition` commit scoped to the close's own
write surface (the index tick and the phase directory — 0207 D1's
discipline), the close listing the stop. No distillation: the open round's
record is its task documents, brief and commits. The kill window between
rename and commit re-derives: `roundOpen` settles an interrupted close on
its own commit before the next round's checks read the tree. After the
close, the following invocation is the ordinary shape 4 (round-open or
roadmap-exhausted), unchanged.

### D5 — the read-outs (findings 1, 2)

`status` names the kind on the round line (`R-05 (open round — …)`);
`driver-helper` renders two open-round state rows (awaiting tasks → the
open channels; awaiting close → the `## Close` plus `transfer`) beside the
loop's and transfer's own lines through the 0102/0105 family; the AGENTS.md
round guidance carries the open variant (the pre-seeded Goal, the open
channels), and the primer and the analysis state teach the `open` line
spelling where they teach the roadmap grammar. The shell's help lists the
five modes; the README gains the mode family and the open-round section.

### C — declined and deferred (finding 3, P21)

**Declined:** modes configuring phases/tasks — a `ModeSpec` stamp would
amend 0079 §5 and open a second reshape channel beside 0137's one; the
open round already carries the shape through the line. **Deferred:** a
built-in `fix` intent bundle — `init --phases implement -m fix` plus an
`open` first line compose the light start today; the bundle's pack content
waits for a real consumer to pin it. **Deferred:** the fork/pr modes'
prose is data (a file, zero machinery) and revisable without a ruling; the
meanings pinned here (divergent-copy maintenance; review-ready change set)
are the maintainer's confirmable reading, recorded as revisable cost.

## Premise guard

premises this ruling changes: **plans/0101 D2** (the shape list — amended
above), **plans/0137 D3** (the m-mode framing — restated above; D1/D2's
key-is-machinery and one-channel rulings stand untouched), **plans/0115
D3** (the proposal install's untouched-stub predicate — the seed rendering
joins it as the driver-written exception). Re-read in this change:
**plans/0206 D3** (the mid-phase re-derivation — an open round never
drifts, the pin above; the refusal arm unreachable for open rounds by
construction), **plans/0207 D1** (the release consumptions' commit scope —
the close arm and the heal follow its caller-side pathspec family),
**plans/0209 D4** (the close listing — reused verbatim). Each stands as
written for every shape this change does not touch.

## Residuals

- The fork/pr mode prose is a first reading, revisable as data.
- An open round cannot be converted mid-flight to a phased round (close it
  and open the next under a phased line) — the kind is write-once by D2.
- The whole-project m mode keeps its transfer refusal (0101 D8) — an m-mode
  project wanting open rounds re-inits phased or edits its config; no
  migration channel is built (P21).

## Tests

`test/mode.test.ts` (the five-name family, the four postures' prose pins,
the overlay lockstep); `test/analysis.test.ts` (the kind grammar, the
reserved-word problem, the resolution and divergence); `test/phases.test.ts`
(the index Kind round-trip, the pre-seeded brief, the unknown-kind failure,
the write-once re-sync, the drift pin); `test/transfer.test.ts` (the open
lifecycle: establish/G1, held/empty refusals, the gated close, the landed
close + next-round/exhausted, the pending-close refusal, the
proposal-over-seed install, the interrupted-close heal); `test/plan.test.ts`
(the open-round prelude rows, `--new-task` on the plan route);
`test/plan-loop.test.ts` (the empty and wrap-up loop arms, no session);
`test/append-loop.test.ts` (the implied append). The unchanged suites hold
the floors.

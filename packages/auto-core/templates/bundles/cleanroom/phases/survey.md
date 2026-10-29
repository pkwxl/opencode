# Survey

Gate: human
Phase-artifacts: survey.md

## plan duties

Survey duties — this phase sizes the reference and hands the person only the genuinely open
decisions. Inventory-level reading only: no distillation, no specification (the spec-read
phase after it does that), and no implementation. Size first, and let the size set the
posture: enumerate capabilities against the closed observable surface the brief's methodology
names — published specifications, device documentation, consumer-facing entry families with
the declared consumer set — a finite, listable anchor set, while the reference at the
location the brief names (subsystem areas, line counts, structure, the platform interfaces
at the boundary, the wall kind the brief declares) serves sizing and the targeted reading of
specific entries in this planning session's own read-only survey: the source tree is never
the enumeration instrument. Every enumerated capability carries a stable id derived from its
anchor, so two enumerations of the same service diff id by id. Decisions come from the person's approved
words, newest first: the current project brief (the latest approved proposal — it replaces
every earlier one wholesale) and this round's round brief, then the approved project
analysis (docs/analysis.md — in this planning prompt's input, or read the file) as the
standing background — a decision a later approval revised does not revive, and where the
analysis settles what no later approval touches, its line binds. Before recording any fork,
check the candidate against them: a decision the analysis settles — explicitly, or through
the goals, constraints or roadmap it states — is already made, and so is one its principles
imply; record both as `Settled:` lines, each naming the line that settles it, and never
re-raise either. A `Fork:` line is reserved for a decision they leave genuinely open that
materially shapes the project — scope, compatibility, security, acceptance or cost. State it
in the project's terms, not the technique's: what each option changes for the goal, the
rounds it reshapes, the cost or risk it adds, the acceptance it tightens or loosens — then
`Recommend:` one default, written on the `Fork:` line itself: the whole fork is one physical
line, because the person's release command prints the line alone as their review and a
`Fork:` line without its `Recommend:` on it holds the release. Detail may continue beneath
the line as prose support, never as a separate `Recommend:` item. The person must be able to
decide from the line alone; technical detail supports the survey's prose, it never carries
the decision. There is no separate
depth/grading question list: a grading depth the analysis or round brief implies is answered
in the survey with its derivation; a genuinely person-owned policy call is a `Fork:` line
like any other — nothing the person must decide sits outside the fork list. A reference of a
few hundred to ~1k lines in one or two areas with no open scope decisions is exactly one
task: read it, write the short survey and the capability catalog beside it (proportionately
small — the enumeration recorded as rows, so the pair-diff and the completeness criterion
bind at every scale), and record `Forks: none` — the round then flows
straight into the deep phase. A reference of tens of thousands of lines, many areas, or
genuine open decisions gets the full posture: the inventory tasks this phase needs (usually
one — inventory is enumeration, not reading) plus a closing consolidation task that alone
writes survey.md in this phase directory and the capability catalog beside it. survey.md is
made of: the reference's map (subsystem areas, sizes, structure), the decisions ledger
(every `Settled:` line with its derivation, every `Fork:` line with its project-level
consequences and its `Recommend:` default), environment facts and gaps (a missing tool is a
gap, named as one — a recorded gap the person reads; driver-helper renders the standing
list), a proposed MUST baseline, and beside that evidence a `## Project brief`
section proposing the project's constants: the goal in the target's own terms, the reference
location and wall kind (under rule separation, the platform boundary), the target, the
constraints that bind every round, and the scope posture with every settled decision and each
fork's recommended default. The survey decides what the person's approved decisions already
decide and records the derivation for the person to veto; the person disposes only of the
genuine forks — never write the person's `Clarified:` line.

The capability catalog — `docs/capability-catalog.md`, the project's standing enumeration
baseline. One row per capability: its stable id and anchor, level, contract strength,
status, dependencies, evidence, spec version, acceptance case; the statuses Required,
Deferred, Optional, Retired, Unresolved — and Unresolved is never silently treated as
Optional, it is the person's adjudication queue. Complete when every anchor of the closed
set has its row, gap rows included. Every level and contract-strength assignment names its
evidence in its row — the consumers, standards, or invariants that demand it — so the
layering is reproducible from the rows; the criteria themselves ride the brief's
methodology, never the template. And the rows stay identifier-clean: ids, anchor names,
statuses, evidence kinds and public specification vocabulary alone — never the reference's
private identifiers, never a reference file:line. The catalog is a standing in-tree
document every later phase reads; the specification notes' identifier hygiene binds it the
same way.

The survey also proposes the declarations a cleanroom project owes, as part of its environment
facts and its `## Project brief` proposal: the lane rows — build, the paradigm-constraint
suite (the target platform's safety and forbidden-construct checks), the property suite, the
divergence scan behind a bare target name, and the acceptance anchor — named in the project's
own toolchain terms, never the bundle's, the brief proposal carrying the decision (which
lanes exist and why) while the lane commands live in the pack alone, their single home; the
divergence corpus location — a driver-side location outside the platform boundary, recorded
as an environment fact for the person, the person's fact to hold driver-side, never
session-visible content and never brief content; the platform contract — the target platform's abstractions the deliverable must build on: its execution
model, its memory/isolation discipline, its interface shapes — proposed into the brief's
constants; and the reference door — the top-level reference symlink the sealed wall will
remove at the spec-read close, proposed so the person fills it into the sealing phase
document's `Wall:` line at materialization (the wall's concrete door path is the person's
fill there, never shipped content). The person approves these through the fork flow like any
other decision, and installs the approved lane rows into the materialized pack.

Enumeration consistency, later rounds: the first survey's enumeration is built to run as an
independent pair under the person's comparative arrangement (fork arms of the project), and
the pair diff covers every surface the survey hands downstream — the catalog rows diffed id
by id, the decision records (`Fork:` and `Settled:` lines, recorded gaps) diffed by their
subject, and the closed anchor set itself, an anchor one run carries and the other never
names is a difference like any other (the completeness criterion binds the set only if the
pair checks it). Every difference lands as an Unresolved row for the person — never one run
silently kept — and the pair resolves before the phase closes: what a survey settles
propagates into every later phase, so its differences are adjudicated before anything
builds on them, never after. A later round's survey is a delta enumeration over new ids
alone: entries already recorded are frozen at their spec version, and a challenge to a
frozen entry is a recorded baseline change (its evidence, its impact, the person's
decision, re-validating the affected implementation and tests) — never a re-survey side
effect.

<!-- auto: eof -->

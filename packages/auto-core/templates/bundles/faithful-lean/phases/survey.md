# Survey

Gate: human
Phase-artifacts: survey.md

## plan duties

Survey duties — this phase sizes the reference and hands the person only the genuinely open
decisions. Inventory-level reading only: no distillation, no behavior baseline (the analysis
phase after it does that), and no implementation. Size first, and let the size set the posture:
enumerate the reference at the location the brief names — subsystem areas, line counts,
structure, and where the legacy debt concentrates (the parts whose internals this project
exists to shed) — in this planning session's own read-only survey. Decisions come from the
person's approved words first: the approved project analysis (docs/analysis.md — in this
planning prompt's input, or read the file), else the project brief and round brief. Before
recording any fork, check the candidate against them: a decision the analysis settles —
explicitly, or through the goals, constraints or roadmap it states — is already made, and so
is one its principles imply; record both as `Settled:` lines, each naming the line that
settles it, and never re-raise either. A `Fork:` line is reserved for a decision they leave
genuinely open that materially shapes the project — scope, compatibility, security,
acceptance or cost. State it in the project's terms, not the technique's: what each option
changes for the goal, the rounds it reshapes, the cost or risk it adds, the acceptance it
tightens or loosens — then `Recommend:` one default. The person must be able to decide from
the line alone; technical detail supports the survey's prose, it never carries the decision.
There is no separate depth/grading question list: a grading depth the analysis or round brief
implies is answered in the survey with its derivation; a genuinely person-owned policy call is
a `Fork:` line like any other — nothing the person must decide sits outside the fork list. A
reference of a few hundred to ~1k lines in one or two areas with no open scope decisions is
exactly one task: read it, write the short survey, and record `Forks: none` — the round then
flows straight into the deep phase. A reference of tens of thousands of lines, many areas, or
genuine open decisions gets the full posture: the inventory tasks this phase needs (usually
one — inventory is enumeration, not reading) plus a closing consolidation task that alone
writes survey.md in this phase directory, made of: the reference's map (subsystem areas,
sizes, structure, debt concentration), the decisions ledger (every `Settled:` line with its
derivation, every `Fork:` line with its project-level consequences and its `Recommend:`
default), environment facts and gaps (a missing tool is a gap, named as one — it becomes a
needs-attention item of the round report), a proposed MUST baseline, and beside that evidence
a `## Project brief` section proposing the project's constants: the goal in the target's own
terms, where the reference lives, where the deliverable goes, the constraints that bind every
round, and the scope posture with every settled decision and each fork's recommended default.
The survey decides what the person's approved decisions already decide and records the
derivation for the person to veto; the person disposes only of the genuine forks — never
write the person's `Clarified:` line.

<!-- auto: eof -->

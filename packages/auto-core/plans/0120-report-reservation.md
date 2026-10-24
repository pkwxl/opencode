# 0120 — report.md is the verification's alone: task deliverables carry their own names

The aster-mig cleanroom round's audit phase named `docs/T-NNN/report.md` as each audit task's deliverable
(the `Artifacts:` field), and the field paid for it twice. First, two writers of one file: the task
sessions authored their audit findings into `report.md` (the exec commits created it — 316 and 439 lines)
and the verification children then appended or revised what they found there (the wrapup commits: +112 on
T-118; +212/−46 on T-119 — the verifier editing the author's lines, the entanglement single files exist to
prevent). Second, the parallel wave never formed: with the deliverable sitting inside the implied own
directory and no distinct path to point at, the formulation wrote no `Touches:` field at all, and the wave
admits only on a non-empty declaration — the round's audits ran serial for a reason that was never the
tasks' substance. The person's review surfaced the deeper rule the incident exposes: `report.md` is not a
task's file at all, and nothing in the suite said so.

This ruling Derives: **P3** (completion is never judged by agent self-report — the showing: the wrap-up
report carrying `Result: PASS` is the verdict's durable record, and the verdict's author must be the
fresh-eyes session alone; a deliverable poured into the same file blurs whose judgment the file carries,
and a work session writing the file the verifier is later told to "write" invites the verifier to
second-guess or absorb the work), **P5** (single ownership — every file has exactly one owning writer;
`report.md`'s owner is the verification child, the task's deliverables get their own names, and the field
collapse gave one file two writers plus a revising editor), **P13** (frozen additive-only vocabularies —
a grammar reservation lands in conscious lockstep: the three suite copy sites, the bundle duty text and
the ratchet pins in one change), and **P19** (measured evidence — the ruling is grounded in the commit
census of the incident: exec-created reports of 316/439 lines against wrapup diffs of +112 and +212/−46,
cited below). Tier touched: **mechanism and data** — the manual suite's prompt copy, the cleanroom
bundle's audit duty text, the ratchet; no principle change, no src change; the INDEX release cell stays
open until the next release event.

## D1 — the reservation, stated on every copy site that teaches the path

`docs/T-NNN/report.md` is a reserved name: the verification child's wrap-up report (written at close-out
when the config's `wrapup` key says WRITE — run-verify's existing rule, unchanged), never a task's
artifact, never a task session's write. Three sites carry it, each in its own voice:

- `prompts/run-plan.md` (the planner): the name is reserved — never an artifact or `Touches:` path; a
  deliverable document carries its own name, the phase type's duty text naming its conventions.
- `prompts/run-task.md` (the worker): one name in the unit directory is reserved — never create or edit
  it; deliverables carry the names the task document declares.
- `prompts/plan-append.md` (the append planner): a deliverable never lives at `docs/T-NNN/report.md`;
  each deliverable carries its own name.

run-verify needs no change — it already owns the write; with the worker barred, "write the report" is
unambiguous (the file starts the verifier's, not appended to the work session's). run.md needs none: its
preflight item 6 already names the wrap-up report as the verification's product, and its PASS check tails
a file now singly authored.

## D2 — the cleanroom audit phase names the findings document

`templates/bundles/cleanroom/phases/audit.md` (the duty text both the programmatic formulation and the
manual suite's run-plan read as authoritative for the phase): each dimension task's deliverable is its
own findings document `docs/T-NNN/findings.md` — never `report.md` — one writer per file; the closing
task consolidates the findings documents into the phase's `audit.md` and the verdict into `verdict.md`
(the Result-line rule verbatim, untouched). The audit family is where the incident lived; the other
bundles (`faithful`, `faithful-lean`) ship no audit phase and need no edit. Materialized targets take the
duty text through the person's `sync` (provenance's own channel — the sidecar comparison flags the
divergence); the suite copy rides the shell's `install-prompts` refresh.

## D3 — what is deliberately not done

No programmatic template change: the programmatic formulation prompts teach no artifact-naming
convention (the bundle duty text is the naming authority there, and D2's edit reaches it), and the
wrap-up template already authors `report.md` solely — no observed collapse on that side, no machinery
built ahead of its consumer (P21). No retroactive re-shape of the closed T-118/T-119 units: their
mixed-layer reports stand as history, readable as inputs; the reservation governs what is planned from
here. And no change to the `Artifacts:` grammar itself — the field may name any real path except the one
reserved name, a validation left to review rather than to a new parser.

## D4 — the ratchet lockstep (P13)

The ratchet gains a 0120 test pinning one literal per copy site (`docs/T-NNN/report.md` is a reserved
name` on run-plan, `One name in that directory is reserved` on run-task, `the verification's wrap-up
report, reserved` on plan-append) with the incident census in the comment; the bundle file is data, not
suite copy, and rides its own provenance channel.

## Enactment notes

- The incident's second symptom — the missing `Touches:` declarations that kept the wave from forming —
  was repaired at the target (field lines added to the pending audit tasks) before this ruling; the
  reservation removes the root cause for future plans (a deliverable with its own name is a path the
  planner can declare), and run-plan's sentence names that connection by construction.
- Indexed in plans/INDEX.md's post-baseline table with an open release cell; the suite's navigation line
  in AGENTS.md gains the pointer.

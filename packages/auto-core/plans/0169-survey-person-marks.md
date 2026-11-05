# 0169 — The survey's person marks: the release scoped, the install gated, the forks counted

Status: **active**. Ruled 2026-11-05 by 0166 step 009 (wave W1-person-marks), enacting 0165-001
(S04-06) and 0165-002 (S07-01).

## Derives

Derives: P2 — the survey's human gate is the phase's one consequential decision moment, and both
defects consumed it as closed without a person's act: the brief installed "approved" on a gate
that never stopped (S04-06), and the gate released by the session's own example text (S07-01).
P7 shows in the fixes being grammar work only (a scoped mark reader, a near-miss fork scan, a
mark-gated install — no content judgment); P13 in the vocabulary growing additively (the
`## Release` region beside the standing bare-mark shape). Tier: operating — P2's bracket applied
to an existing gate; no Tier I statement changes.

premises this ruling changes: none — 0081's D14.3/D15.2 stand; this ruling enacts the mark
scoping and the install gating their approval semantics already require (D15.2 ties approval to
the release mark; the un-mark-gated install contradicted it).

## Category scope (0123 D1's discipline)

Family: *the person's release marks — the gates' readers and the brief install* (the survey
channel and the two channels sharing its reader). Home-set:

| home | disposition |
|---|---|
| `src/phases.ts` | changed — `clarifiedMark` scoped (the `## Release` region plus the legacy flush-left shape, fences and indents never counting); `nearMissForkLines`; the human gate holds on near-miss forks and on an unreleased brief proposal |
| `src/loop-phase.ts` | changed — `installApprovedBrief` installs only on the released mark |
| `src/clarify.ts` | changed — `withMark` writes the `## Release` region; the release path accepts the zero-fork-proposal shape; a near-miss survey is refused until normalized |
| `templates/bundles/{cleanroom,faithful,faithful-lean}/phases/survey.md` | changed — the prohibition tightened (never write the `Clarified:` line, not even as an example, indented or fenced) |
| `test/survey-gate.test.ts` + `test/clarify.test.ts` | changed — the regressions (the four shapes below) |

The analysis and roadmap channels (analysis.ts, roadmap.ts) read the same `clarifiedMark` and
inherit the scoping with no change of their own (D3); their taught release shape — the person's
flush-left whole line, committed — remains the counted legacy shape, so released documents stay
released (the migration floor).

## The ruling

**D1 — the release mark is scoped; the person's line is the person's.** `clarifiedMark` counts
the mark in exactly two places: as a whole line inside a trailing `## Release` section (the
forward channel — `clarify` writes it; a `## Release` heading is the person's region, a shape no
session template carries), or as the legacy flush-left whole line (the shape the analysis stub
and the driver-helper brief teach the person to hand-write and commit — kept counting so already
released documents stay released). Indented and fenced lines never count, anywhere: the confirmed
exploit — a session's "To release, the person writes:" indented example releasing a forked survey
— is dead. The survey templates' prohibition tightens to name the example shapes.

**D2 — the install is gated by the mark.** `installApprovedBrief` returns unless
`clarifiedMark(survey)` holds: the log line's "approved" is true exactly when the person released.
D15.2's approval semantics — the release mark approves the forks and the proposed brief in one
act — now hold on the consumption side too.

**D3 — the gate holds wherever a person decision is pending.** Three shapes join the open-fork
hold: (a) a survey proposing a `## Project brief` with zero strict forks holds awaiting the
person (0081 D14.3's zero-fork completion applies to surveys with nothing to approve, not to ones
carrying an unapproved proposal — the analysis channel is already consistent, its release
mark-gated whatever the fork count); (b) a near-miss fork line — first word `Fork` after list
markers, emphasis or a number, with `:` — holds the gate until normalized to the `Fork:` grammar
or removed (a decision line the scan cannot read must not pass unread); (c) `clarify` accepts the
zero-fork-proposal shape as a release moment (its "nothing awaits" refusal no longer mis-names
it) and refuses a near-miss survey until normalized.

**D4 — floors and residuals.** The legacy shape keeps counting (above); already-released
analyses, roadmaps and surveys never re-hold. The 0023-shaped forged-region residual is named: a
session writing a flush-left bare mark or a `## Release` section in its own survey text still
releases the gate — the region rule kills the example class (indented/fenced, the confirmed
shape), and the template prohibition now names all of them; the commit-provenance guard (the mark
present in the session's own committed version is the session's — the S20-05 receipt-provenance
shape) is the named follow-up should the census ever confirm the flush-left forgery in the field.
`Fork:`'s strict grammar is unchanged (the record channel; near-misses never parse as forks).

## Tests

`test/survey-gate.test.ts` — the zero-fork-proposal hold and install gating; the near-miss shapes
holding; the indented-example mark not releasing while the flush-left legacy mark does.
`test/clarify.test.ts` — the zero-fork-proposal release (the brief installs); the near-miss
refusal.

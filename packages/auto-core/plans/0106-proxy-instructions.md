# 0106 — the proxy's instructions: the field repairs to the brief and the round-close stops

Ruled from common's R-01 close (2026-10-19), the first field round of the
person-proxy brief (0105). A coding-agent session holding the person's pen
worked the round-close boundary; four times the person had to intervene with
knowledge the tool's surfaces had not rendered. Every failure was
instruction-shaped — a missing *what*, *how* or *when-to-act* — never
form-shaped: each document's grammar existed somewhere, and the session's
workarounds (mining a sibling workspace for exemplars, treating recorded
findings as work, deleting task-id references to satisfy a gate's wording)
were all rational readings of text that named a check without naming the
remedy.

The four field findings:

1. **`## Close` depth.** The stub hint carried the two-clause grammar
   (restated into the target's documentation vs accepted as lost) but no
   depth calibration; the session hunted `../dm-flash` for a filled example.
   First rounds have no in-project exemplar — the permanent record becomes
   one only from R-02 on.
2. **The report charter was invisible to the pen.** The complete charter for
   `report-for-user.md` (the `report-duty` partial: the four-point shape
   whose "Needs your attention" is the section the report exists for) is
   rendered only into planning prompts. The close gates accept a
   hand-written report, but the pen that may write it had no way to read the
   charter — so it mined a sibling's report instead.
3. **The ✗/⚠ act-classification.** The held close folds its `⚠` records
   (the containment ledger, a skipped build) under a header that says
   "until these are fixed" and an action line that says "fix them". The
   session read the records as work and acted on containment findings
   mid-project.
4. **The deferred lines named the check, not the remedy.** The round-time
   containment records said "must shed the id before it ships" — the one
   finding family whose restatement clause had been dropped in compression.
   The session shed the task-id references by deleting them, destroying the
   AUTO-DECISION provenance records the round's own `## Close` lists as tree
   content; the person reverted (a bad reference beats a lost one — a
   pointer still carries its content, deletion leaves nothing).

## The ruling

The instructions ride the rendered surfaces — the brief and the stop lines —
never a committed template directory in the target. Considered and rejected:
materializing "all required templates" into the project. The project already
holds four materialization channels, each with its own anti-drift story (the
intent pack under provenance, the manual suite under `install-prompts`, the
document stubs born from the running binary, print-on-demand scaffolds), and
none of the four failures was a missing form — a template directory would
have shipped none of the missing sentences and added a stale second
interface, the exact failure mode 0105 exists to kill.

## D1 — the report charter at the missing-report stop

`renderHelperBrief`'s round-close row renders, when the report problem rides,
the `report-duty` partial verbatim (through `renderText`, the same template
library the planning renders use — the target's prompt overlay honored, a
broken overlay leaving the built-ins standing) as an indented block under
CHANNELS, beside the fork the close problem already names: a re-run of `run`
appends a report task whose session writes it under the charter, or the pen
writes it by hand under the same charter (ending with the terminator line).
A hand-written report answers the same charter a task session answers; the
brief also deepens the `## Close` channel with the depth clause (each
restated decision named with where it landed, each accepted loss with what
it cost).

## D2 — the finding-remedy channels

Beside the close refusal: a process-reference finding renders the remediation
fork — restate the needed content in place, or, for a person-tool file whose
grammar *is* paths (an ignore file synced from `.gitignore`, a tool config),
the config's exemption channel `amend --scan-exempt <path>` (the `common`
case: a ZCode ignore file the driver's own gitignore set had seeded). The
standing containment channel (row 12) carries the how: restate what each id
or path stood for in place and remove the pointer, never delete the record
it anchored.

## D3 — the glyph reading rule

The brief renders one fact ahead of any stop line carrying the marks: `✗` is
this stop's work, `⚠` is a record — each names its own moment, never work
for this stop. The brief is the reading surface; the rule travels with the
lines it classifies.

## D4 — the held-close composition (the one conscious ratchet edit)

`roundCloseLines`, 0105 D7's anticipated single edit: the `✗` problems alone
sit under the "until these are fixed" header; the `⚠` records render under
their own lead ("recorded — not this stop's work; each `⚠` names its own
moment (containment waits for release):"). The header names its refuser —
the `command` parameter threads through (`transfer` in a phased project, m
mode's `previousRoundClose` keeps `plan`), catching up a line that said
"plan will refuse" inside *transfer's* own refusal. The `## Close` stub hint
names `transfer` (m mode: `plan`) — stale since 0101 — and gains the depth
clause of finding 1. The passing `✓` case is byte-identical.

## D5 — the deferred lines carry their remedy

Both round-time containment records keep their "recorded for release:"
prefix (the prefix-pinned tests hold) and gain the clause their release-gate
siblings already carry: "when the destination ships, restate the content in
place and remove the id — never delete the record it anchored" (and the
vendor-or-restate wording for out-of-root paths). The release gate itself is
unchanged — it taught restatement correctly all along; the fix reaches the
lines a session reads *during* the rounds.

## D6 — deliberately not done

No template directory in the target (the ruling). No stop-line changes
beyond the round-close family (the reading rule and the remedy channels live
in the brief, where rendering is free). No driver-side enforcement of
remedy quality — the gates check outcomes, the surfaces teach remedies; a
session that still deletes a record is the person's catch, as it was here.

## Verification

One conscious ratchet edit with its pins updated together: the deferred-line
exact pin, the round-gates stub and held-shape pins, the driver-helper row-6
pins extended (the transfer naming, the recorded lead, the reading rule) and
one new case (the missing report renders the charter verbatim; a
process-reference finding renders the scanExempt fork). Core typecheck
clean, the full suite 2693 pass / 0 fail; the shell typecheck clean, its
suite 126 pass / 8 live-agent skips / 0 fail. A test-hygiene repair rode
along: `transfer.test.ts`'s analysis-off case now plants the switch through
the capture fixture (a hand-set `process.env` inside the run callback
survived the capture's restore and leaked the off switch into later-loaded
files — order-dependent pollution that surfaced running file subsets out of
alphabetical order).

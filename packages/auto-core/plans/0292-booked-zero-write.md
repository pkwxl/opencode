# 0292 — The booked zero-write pin: the dead-letter sweep's class widened to booked without-landing receipts, both arms reaching them

Status: **enacted, 2026-11-21.** 0290 F2's fix ruling — 0287's recorded
residual ("the op's arm widens or the blocked receipt itself unreserves")
discharged for the without-landing flavor, its field record standing. The
field's ledger had migrated under 0287's record before the ruling was
written: the prior night's report replays booked squashfs T-006's dead
formulate leases as `without-landing/zero-write` receipts (three `T-006
formulate 1` entries, every byte cited by the record), so the lane held a
**booked** non-landing continuation over the person-completed unit — a
shape belonging to neither of 0287's channels (unbooked dead letters) nor
0289's (landed continuations), exactly as the residual anticipated, and
0287's site prediction ("self-clears on its next claim") measured
site-false. Every clearing channel declined it: the sweep's booked guard
sat ahead of the forced check (so `reconcile` naming the unit booked
nothing and answered its nothing-to-do letter), the continuation sweep
handles only `landed` receipts, and the non-terminal booked tail held the
serial reservation — untargeted and targeted claims alike answering the
held row `wait/not-ready "T-006 is not ready."`, ten planned-pending units
parked behind.

Derives P2 (the forced arm remains the person's terminus for the
record-blind shapes — an abandoned continuation over an open unit — now
reaching the booked flavor by name), P6 (the ledger reconciled downward to
the record: the receipt's kind is the ledger's *claim state*, re-booked
`reconciled` when the record closes the unit — the booking's outcome and
the overlaid receipt's reason preserved in the note, never a rewrite of
history; the record read memoized per sweep pass), P8 (each booking logs
its finding and provenance, the overlaid reason named — `the never-landed
receipt (zero-write) stays noted`), P10 (the healthy floor and 0287's
unbooked paths byte-identical — lines, receipts, and answers unchanged,
the standing suite green untouched beside the two new shapes), P12 (live
leases, landed receipts, pending reports, and blocked receipts are never
the sweep's — a landed share is history, a pending settlement the
settlement's own, the blocked flavor 0287's standing residual), P13 (no
vocabulary act: the receipt re-uses 0287's additive `reconciled` kind and
`by` values; `docs/protocol.md` amended in prose, no fenced block moved,
both ratchets green), P19 (the field's ledger bytes, mtime, and wire
replies the record cites; both field shapes pinned on the fixture).

## Category scope

Tier: executor (the coordinator's ledger). Code home:
`src/executor-coordinator.ts` — `reconcileDeadLetters`' two-class guard
(0287's unbooked dead letter, 0292's booked without-landing receipt; both
arms — the record's completion and the person's name — reaching both
classes), the memoized `unitCompleted` read, the re-booking preserving the
prior outcome and reason, the reconcile operation's letter. Test home:
`test/executor-dead-letter.test.ts` (the person-completed self-clear end
to end — three zero-writes booking reconciled at the next wire act, the
lane resuming, the late report answered with the receipt — and the forced
arm over the open unit with the landed-never-touched floor), the suite's
existing lane manifest row. `docs/protocol.md`'s person's-operations
paragraph amended in the same change, and the server-side teaching
surfaces joining it: the op's comment block and its request-validation
letter (`../auto-server/src/ops.ts` — comments the first carrier of
design, 49a9fbfa2's own subject) and the server README's operations row
citing the widened class.

Premises this ruling changes: none. Re-read in this change: 0287 (the
sweep family — its unbooked class, lines, and answers unchanged; the
recorded residual's without-landing half discharged, the blocked half
standing), 0289 (the continuation sweep riding the same head — after
0291's re-key a booked zero-write tail no longer shadows a flagged
landing, and a re-booked reconciled tail is terminal to it), 0290 F2 (the
record enacted), 0285 (the original pin record — its unbooked-expired
description the shape 0287 ruled, the field's migrated shape this
ruling's; the record's remedy families (i) and (iii) both answered here)
— all stand.

## The enactment

- **The class** — the sweep's first guard admits exactly two entry
  shapes: 0287's unbooked dead letter (no booking, lease not live) and a
  booked receipt of kind `without-landing` (either reason — the field's
  `zero-write` and the failed report's `failed` ride the same kind). Live
  leases and every other booked receipt stay outside, unchanged.
- **The arms** — both arms reach both classes: the automatic arm books
  entries whose unit the durable record completes (the same `unitCompleted`
  reading 0287 built, memoized per sweep pass — the field held three
  entries per unit over one plan read) with `by: "person-completion"` at
  the head of every wire act; the forced arm (the reconcile operation
  naming the unit) books the named unit's entries with `by:
  "person-reconcile"` whatever the unit's state. The re-booking preserves
  the prior booking's outcome and names the overlaid receipt's reason in
  its note — the ledger's claim reconciled downward, the report's history
  kept.
- **The readings** — unchanged, by construction: `terminal()` closes and
  `reserved()` releases on a `reconciled` receipt, `preview`'s
  continuation arm excludes it, the late-report arm answers with it —
  0287's own design, every receipt-keyed derivation reading the entry
  closed through its existing home (P5). The serial reservation releases
  with the tail's terminal receipt and the lane resumes behind it; the
  held row never appears over this shape again (pinned).

## Residuals

The **blocked-booked flavor** of 0287's residual remains open (a
terminally blocked booked share holding its scope fence — no field record
yet, the next record deciding). The **orphan share commit** (landed in
history, never booked) stands with the isolation walk's own classes,
unchanged. A booked without-landing receipt over a unit the record leaves
open still needs the person's forced arm or the takeover's share —
designed (the record cannot evidence abandonment), the open-unit floor
pinned.

## Site-side

The squashfs lane's T-006: the sweep books the three `T-006 formulate 1`
zero-writes from the person's completion amendment (`57c1d50`) at the
first wire act after the daemon runs this line — zero further person acts
— and the ten planned-pending units stand claimable behind it. The
demolition track's marker, at (0292+) by 0291's ruling, shifts to
(0293+) by this ruling's landing.

# 0287 — The dead-letter reconciliation: a person-closed unit's unreported lease books from the record, the pin self-clearing at the next wire act

Status: **enacted, 2026-11-21.** 0285's fix ruling — the expired-continuation
pin's fourth remedy family landed as family (ii) (index truth, as a booked
reconciliation) with family (iv) (menu honesty) beside it and family (iii)
(the deterministic operation) as the person's forced arm; family (i) (late
booking on the report route) is declined — the takeover already serves its
only live-holder shape, and the dead-holder shape is answered by the
reconciled receipt instead (P21: no consumer remains). The pin was
re-measured before the fix on a faithful fixture (the serial unscoped
flavor): every claim — targeted and untargeted alike — answered
`wait/not-ready "T-001 is not ready."`, the field's own bytes in shape, and
the scoped flavor fenced every overlapping unit
(`"T-001 reserves an overlapping scope until settlement."`); with the fix
the same fixture's next claim grants the unit behind, zero person acts
beyond the completion the person already made.

Derives P3 (a unit a person closed is done — the parenthetical's own letter:
the ledger never outranks the record), P6 (the ledger is runtime state over
the durable record; the sweep re-derives from the index and books the
minimum — one receipt, nothing else), P5 (the receipt is the one fact every
receipt-keyed derivation already reads — continuation, reservation,
settlement wait — no predicate threaded through the derivations), P2 (two
letters: the person's already-bracketed completion consumed automatically,
never a second bracket demanded; and the forced arm the terminus for the
states the record cannot evidence — every wedge terminates at a
person-reachable act), P8 (each booking logs its finding and provenance, the
isolation walk's amendment line the precedent; the menu's held row teaches
why nothing is claimable), P10 (the healthy floor byte-identical — no dead
letter, no write, no line; the standing suites' unchanged halves pinned),
P12 (conservative guards: live leases and booked entries are never the
sweep's — their own machinery owns them), P13 (the `reconciled` receipt kind
and the menu's `wait`/`blocked` held rows are additive vocabularies,
docs/protocol.md amended in this change, both ratchets green), P20 (the
operation refuses a live lease — control changes land at safe boundaries).
Amends none — 0248 (the lease lifecycle — the settled shares' isolation
walk untouched: the receipt claims no commit, joins no known table), 0273
(the settled-holder terminal — its landed-share cousin; the reconciled
receipt answers the never-reported one), 0274 (the person-amendment class —
the sweep is its ledger counterpart, reading the amendment's own marks),
0282 (the person's op surface — `reconcile` joins `transfer`/`clarify` as
the third deterministic operation) and 0271 (the menu's pending list — the
held rows its honesty extension) are cited as measures and complements, not
challenged.

## Category scope

Tier: executor (the coordinator's ledger and derivations) + server (the
operation). Code homes: `src/executor-coordinator.ts` (the sweep, the
receipt, the reservation/continuation/terminal readings, the menu rows, the
`reconcile` wire method) and `packages/auto-server/src/ops.ts` (the
`reconcile` operation, `control` scope, over the coordinator — the ledger's
one writer). Test homes: `test/executor-dead-letter.test.ts` (the field
shapes, the floors, the forced arm) and `packages/auto-server/test/ops.test.ts`
(the operation's vocabulary, sweep, lock answer). docs/protocol.md amended
in the same change (the report bullet, the pending vocabulary, the person's
operations); both protocol-doc ratchets green (the amendments ride prose,
no fenced block moved).

Premises this ruling changes: none. Re-read in this change: 0248 D6 (the
isolation walk — untouched by construction, pinned by the test's
without-landing posture), 0273 (the settled terminal — distinct kind,
distinct meaning), 0274 (the amendment class — the sweep consumes its
marks, the walk still passes its commits), 0282 (the op surface — additive),
0285 (the measure this enacts), 0286 F2 (the scoped verify gap — adjacent
but disjoint: F2's landed entry is booked, never the sweep's; its ruling
lands separately) — all stand.

## The mechanism (0285's record, re-measured)

A lease that died without a report — expired or released, never booked —
over a unit the durable record already closed (the person's completion
amendment, 0274's class) strands every route: no holder identity exists to
report, heartbeat or release it; the serial flavor's continuation routes
every claim at the dead unit (`"T-006 is not ready."` — select's fallthrough
drops the requested task under a standing serial reservation, which is why
targeted claims answered identically); the scoped flavor's reservation
fences every overlapping scope until a settlement that can never come; and
`ready`'s menu silently lists `claimable: []` beside units that stand ready
— the 0271-spirit honesty gap beside the deadlock itself.

## The enactment

- **The reconciled receipt** — an additive `Receipt` kind
  (`{kind: "reconciled", by: "person-completion" | "person-reconcile"}`)
  asserting exactly one thing: the ledger's claim on the unit ended. Never
  landed, never verified — no commit enters `settledChain`'s known table,
  no verdict, no close: the walk's own classes judge whatever the holder
  left in history (the orphan share commit — 0285's `12bec9d` shape —
  stands or diverges by its own trailer grammar, the person's remedy the
  walk's teaching; the residual below).
- **The sweep** — `reconcileDeadLetters` rides the head of every
  serialized wire act (one home, serialized against every derivation): a
  dead-unbooked entry whose unit reads done in the record (task-shaped: the
  phase's index row; the boundary's distill: the phases index's tick) books
  with `person-completion`; live leases and booked entries — a pending
  report included — are never the sweep's (P12); a dead lease whose unit
  stands open is the takeover's (the continuation routes a successor, the
  designed recovery). Idempotent, re-derivable on crash (the predicate
  re-fires), each booking logged (P8).
- **The readings** — `reserved()` releases the scope, `terminal()` closes
  the claim, `preview()` neither continues nor settlement-waits over a
  reconciled receipt, and the dead holder's late report is answered with
  the receipt itself — whatever outcome it claims, the lease died
  unreported and the unit closed without the share.
- **The menu's held rows** — when the claimable set is empty, the
  derivation's first `wait`/`blocked` answer rides `pending` as a row
  (`kind`, `reason`, `detail` — the step vocabulary's own shapes, never a
  second meaning): the crashed settlement, the held lease, the fence — the
  lane's own answer, never a silent empty list.
- **The operation** — `POST /projects/<project>/reconcile` (`control`
  scope): with no fields, the sweep's own answer; with `unit`, the forced
  arm beside it — every dead lease of the named unit books with
  `person-reconcile`, the person's terminal act for the states the record
  cannot evidence (an abandoned in-flight continuation, a poisoned
  workspace). A live lease of the named unit refuses (P20); a live driver
  holds the coordinator's lock and the op answers the lock family's 423
  with the stop taught.

## The person-participation enumeration (P2's completeness letter)

Every strandable ledger state, mapped to its person-reachable clearing
channel:

1. **Dead-unbooked, unit closed in the record** — the automatic sweep (any
   wire act); the person's completion is consumed as written, no second
   act. *The field's own shape; self-clears.*
2. **Dead-unbooked, unit open** — the takeover (a successor claim continues
   the step); the reconcile operation's forced arm where the person judges
   the in-flight work abandoned.
3. **Booked, receiptless** (a crashed settlement) — the claim route's
   settlement resumption (0248's crash windows), the held row naming it on
   the menu.
4. **Booked, blocked receipt** — the blocked answer's own remedy teaching
   (0282's plain-blocked posture); a successor's settlement releases what
   it can. *Residual, named below.*
5. **Live** — the lease machinery's own (heartbeat, release, report).

The residual this ruling records rather than resolves: a **terminally
blocked booked share with a scope** holds its reservation with no
person-reachable release — no field record yet (0286 F2's parked lane is
the nearest neighbor, its own ruling pending); the next record decides
whether the reconcile operation's arm widens to booked-blocked entries or
the blocked receipt itself unreserves. And the **orphan share commit**
(landed in history, never booked): the reconciled receipt deliberately
claims nothing about it — the isolation walk judges it by its own grammar,
which is honest but leaves a driver-staged orphan a divergence the person
must amend around; measured zero times so far.

## The site-side effect

The squashfs lane (0285's subject) needs no person act: on the next claim
after this build ships, the sweep books the dead T-006 lease
(`person-completion` — the amendment already committed) and the ten
planned-pending units become claimable. The demolition track's marker,
shifted to (0287+) by 0286's record, shifts to (0288+) by this ruling's
landing.

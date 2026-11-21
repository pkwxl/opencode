# 0285 — The expired-continuation pin: an unreported expired lease on a person-completed unit deadlocks every executor route

Status: **findings record, 2026-11-21.** The adoption site's fourth field
record under 0255's incident instrument (0257's bring-up day, 0262's run,
0264's day-2 evening, this — the estate's executor-mode cutover now live on
three lanes under build `dev` at the 0284 slice + the comment-repair
commit `49a9fbfa2`, wire `0.1`). Exposure denominator per that review's
honesty rule: one adoption site, bring-up day 3, zero days of release
exposure. This document rules nothing (0165's neutrality: findings carry
`measures`, never dispositions) and lands no code, no template, no test.
The site-side disposition is recorded below: the lane parked (no protocol
act can clear the pin), the person's other owed act on the lane landed
independently by person amendment, and the tool-side fix awaits direction
— each remedy family named, nothing enacted.

Derives P19 (a measured field record — every locus cited from the lane
tree, the coordinator state file, the wire replies and the code at
`49a9fbfa2`; the classification itself a measurement, the corpus grepped
for the rulings carrying each behavior), P18 (the record a plain corpus
document, recorded findings the only evidence channel), P8 (every finding
names its remedy family, its classification, and the residual the eventual
fix ruling must settle). Amends none — 0248 (the lease/expiry machinery),
0273 (the settled-holder terminal), 0274 (the person-amendment walk),
0282 (the no-ask-channel person surface) and 0271 (the pending person
items) are cited as measures, not challenged.

## Category scope

Tier: record — no code, no template, no vocabulary act; the fix, when
directed, lands as its own ruling per 0123/0110 D13 (code home and test
home named in the same change). The eventual fix homes in
`packages/auto-core/src/executor-coordinator.ts` and
`packages/auto-core/src/executor-steps.ts` (0067's rows the precedent for
cross-package homes if the daemon's op surface joins).

Premises this ruling changes: none — a record premises nothing. Re-read in
this change: 0248 D1/D6 (the fenced lease lifecycle and the expiry
takeover posture), 0273 (the landed-report reconciliation terminal — the
cousin this pin complements: that one reconciles a *landed* share, this
one strands a *never-reported* one), 0274 (the bounded person-amendment
class — git writes the executor walk refuses, with no ledger counterpart),
0282 (the person's surface: documents + the deterministic ops alone) —
all stand.

## The run shape (measured)

The squashfs lane (`/workspace/aster-mig-root/cleanroom/features/squashfs`,
project `squashfs` on the estate daemon), from the lane tree and the wire:

- T-006 ("Formulate the Spec read tasks", the P02-spec-read formulation
  unit) was driven as an executor share; its work landed whole — the share
  commit `12bec9d` ("T-006 exec Formulate the Spec read", the share-message
  shape) — and the holder session was then force-killed (the site's
  run-000077, the person's carrier correction of 2026-11-20) **before any
  report was sent**. The ledger entry (`.auto/executor-progress.json`)
  stands unbooked with its deadline past.
- The person completed the unit by amendment — `57c1d50` ("person:
  complete the T-006 formulation unit the killed plan session left open",
  2026-11-20 22:36): exactly the completion marks the dead session owed
  (the `todo`→`done` rename and the index tick), verified PASS against
  the formulation brief's acceptance bar by a read-only child beforehand.
  The index now reads `[x] T-006`; ten planned-pending units T-007..T-016
  stand behind it with their dependencies met.
- Every executor route since answers the same wait — targeted and
  untargeted claims alike:
  `{"kind":"wait","reason":"not-ready","detail":"T-006 is not ready.","retryAfter":2}`
  — and `ready`'s menu lists `claimable: []` **silently** while the ten
  units stand planned-pending (probed 2026-11-21 ~10:00 CST and again at
  the record session; no lease live, no pending rows).

## The mechanism (loci at `49a9fbfa2`)

1. `executor-coordinator.ts:1579` — `preview()`'s continuation arm: the
   last ledger entry with no landed receipt (an unbooked entry qualifies)
   becomes `continuation`; `:1589` routes the next claim at
   `resumeUnit` = that entry's unit (T-006).
2. `executor-steps.ts:121-122` — the routed task is looked up in
   `readyTasks(plan)`; a unit whose index status is `done` is never
   ready, so the lookup misses. `:250`'s formulate/in-progress arm cannot
   fire (the task is undefined), and `:260` answers
   `route.task !== plan.phase` → the observed `"T-006 is not ready."`
3. No clearing path exists:
   - `report` (`executor-coordinator.ts:2054-2066`) requires
     `sameHolder` **and** `live`; an expired entry falls to
     `waitForSuccessor`, which needs a live successor entry of the same
     step id — ungrantable, because the pin answers every claim before
     any grant.
   - `heartbeat` (`:2030-2043`) renews only `sameHolder` **and** `live`
     entries — an expired entry cannot be revived into reportability.
   - `release` (`:2045-2053`) likewise requires `sameHolder` and liveness
     to surrender.
   - The person's completion marks make T-006 permanently unroutable, so
     the pin can never be outrun: the deadlock is total, not a race.

The person's surface (0282: documents + the deterministic ops) holds no
reconciliation act for a stale ledger entry — `clarify` releases gates,
`transfer` advances boundaries; neither touches the ledger. The
person-amendment class (0274) is a git-write exception with no
`.auto/`-state counterpart, and rightly so: hand-editing driver state
under a live bridge is the isolation class the fence exists to prevent.
The site held that line and recorded this instead.

## Classification and remedies (families, nothing enacted)

**Classification:** a design silence at the seam 0274's person-amendment
class exposed — the person may lawfully complete a dead session's unit
marks in the tree, but the ledger entry that session left open has no
person-reachable reconciliation, and the continuation arm trusts the
ledger over the index. Measures: 0248 (the lease lifecycle the entry
rides), 0273 (the landed-report reconciliation this complements), 0274
(the person-remedy class with no ledger arm), 0282 (the person's op
surface), 0271 (the menu as the person's window — the silent empty
`claimable` list is a 0271-spirit honesty gap beside the deadlock
itself).

**Remedy families for the eventual fix ruling:**

- (i) *Late booking* — the `report` route accepting an expired lease from
  the same holder (the evidence judged from disk and git exactly as a
  live report's is; the expired clock refusing only renewal, never
  truth).
- (ii) *Index truth* — the continuation/route derivation skipping
  entries whose unit's index status reads `done` (the person's marks are
  the record; a continuation onto a completed unit is a dead letter, and
  the pin self-clears at the next claim).
- (iii) *A deterministic op* — a `control`-scope reconciliation of a
  stale ledger entry (provenance-logged like `clarify`/`transfer`,
  consistent with 0282's person surface; the operator names the entry,
  the op books it from the tree's truth).
- (iv) *Menu honesty* — a pinned route surfacing as a named wait/blocked
  row on `ready` (the lane's window naming the stranded unit and its
  cause) rather than a silent `claimable: []`.

The residual the fix ruling must settle: whichever family lands, the
settled shares' isolation walk (0248 D6) must stay untouched — a
reconciliation may book, never rewrite; and the exposure stays recorded
here (one site, one lane, day 3, zero release days).

## The site-side record (2026-11-21)

The squashfs lane is parked for protocol work (nothing claimable; the
person's probe and this record the only acts). The person's other owed
act on the lane — the two survey forks the P01 clarify released to the
person's queue — was adjudicated the same day by person amendment
`8f22877` (fork-1 (a) the baseline-round substrate extension; fork-2 (b)
defer xattr serving with clean ignore; the five carrier rows resolved).
The baseline lane stays unregistered and untouched per the person's
standing order. The demolition track 0284's row names as "(0285+)" shifts
to (0286+) by this record's landing.

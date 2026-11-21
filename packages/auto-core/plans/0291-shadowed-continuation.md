# 0291 — The shadowed continuation: the correction sweep's guard re-keyed to the flag's own routing position, the person's amendment reaching a landed flag behind dead tails

Status: **enacted, 2026-11-21.** 0290 F1's fix ruling. The field's entry
sequence (erofs T-064, every byte cited by the record): an unbooked dead
first share; the landed `exec 1` carrying `continuation: true`; a
released, unbooked `exec 2` — the released tail is `latest(unit)`, and
0289's guard (`latest(entry.grant.unit) !== entry`) therefore skipped the
flagged landing forever, while the claim path's `priorHandoff` — the very
arm 0289 shipped — reads the flag wherever it sits (`findLast` over the
unit's landed entries, position-independent). The asymmetry is the whole
defect: **routing reads the flag at any position; correction read it only
at the tail.** The guard's premise ("only the unit's latest entry routes")
was true of the routing's `continuation` arm and false of the routing the
same ruling built; and the shadow is the field's *common* shape, since a
stranded continuation invites exactly the probing claims and releases that
leave tail entries (the record's own classification). The re-key makes the
correction read the same position the routing reads: the unit's latest
**landed** entry — dead unbooked tails and booked non-landing tails shadow
nothing; a later landed entry still shields the older flag as routing-dead.

Derives P6 (the guard is a derived read over the same ledger the routing
reads — one predicate, both sides; no new persisted state), P2 (the
person's document channel — the handoff's Status amendment, the unit's
completion — is effective in every shadow shape, not only when the flagged
receipt happens to sit at the tail), P12 (a later landed entry still
shields the older flag — conservative exactly where the routing is
conservative; the evidence floors unchanged), P10 (the designed
continuation's floor byte-identical: a handoff still reading continue
over an open unit writes nothing, logs nothing, re-grants the next
ordinal — the standing suite green untouched), P19 (the field's ledger
bytes and wire replies the record cites; the shadow flavors pinned on the
fixture beside them). Amends 0289's "only the unit's latest entry routes"
letter (the correction's position predicate was never the routing's) —
the sweep's arms, evidence gates, log lines, and the receipt vocabulary
are untouched.

## Category scope

Tier: executor (the coordinator's ledger and derivations). Code home:
`src/executor-coordinator.ts` — the `lastLanded` helper beside `latest`,
the `reconcileContinuations` guard re-keyed to it, the block comment's
position letter corrected. Test home: `test/executor-continuation.test.ts`
(the released-tail and expired-tail shadows end to end — the amendment
reaching the shadowed flag, the takeover landing clean, the verify share
following — and the shield floor: a later landed entry holds the older
flag as routing-dead while the routing flag itself stands corrected), the
suite's existing lane manifest row.

Premises this ruling changes: none. Re-read in this change: 0289 (the
ruling amended — its sweep arms, receipts, and operation answers
untouched; the position letter alone corrected), 0287 (the dead-letter
sweep riding the same head — a dead unbooked tail over an open unit stays
the takeover's designed routing, never the sweep's), 0290 F1 (the record
enacted, its site-side move now standing over a corrected flag), 0246 D6
(the token-distinct verify — untouched; it follows the corrected receipt
through the unchanged readings) — all stand.

## The enactment

- **The guard** — `reconcileContinuations` skips a flagged landed entry
  only when a later **landed** entry of the same unit exists (`lastLanded`,
  the `findLast`-over-landed read `priorHandoff` itself walks): the flag
  routes from exactly that position, so it is corrected from exactly that
  position. Dead unbooked tails (released or expired — both flavors
  pinned) and booked non-landing tails no longer shadow the flag; a later
  landed entry shields the older flag — routing-dead, corrected never,
  harmless (the routing reads only the latest landed flag).
- **The readings** — unchanged, by construction: `priorHandoff` already
  read the flag position-independently, `needsVerification` already
  excludes continuations, the verify arm already follows a plain landed
  tail. The fix closes the gap between correction and routing by moving
  the correction, not by threading a new predicate (P5's one-home letter).
- **The shadow's designed tail-drain** — a dead unbooked tail over an open
  unit still routes the takeover re-grant (0287's letter): after the
  person's amendment the takeover share lands clean — the handoff reads
  done, the settlement derives no flag — and the verify share follows at
  the next wire act. The pinned arc is the site's measured move, now over
  a corrected flag; the person's forced `reconcile` on the unit drains the
  dead leases without a share, and one bounded share still lands before
  the verify (a fresh claim routes while no landed tail stands).

## Residuals

The **takeover-share cost** stands as 0290's remedy-family residual (one
attempt id and one share of budget spent on resumption rather than work
whenever a dead tail survives the person's amendment — the read-time
derivation family, P6 to its limit, would close every stale-flag shape at
every preview's git-read cost; declined, recorded). The **blocked-booked
flavor** of 0287's residual remains open (no ruling of this family touches
it). The **steer chain bound** still counts every landed continuation
entry, corrected or not (0289's own eye).

## Site-side

The erofs lane's T-064: the person's committed Status amendment is now
effective at the next wire act whatever the tail — the menu letters the
takeover (the site's own measured move), its truthful bounded share lands
without a flag, and the verify share follows; the forced `reconcile`
drains the dead leases for a lane that would rather spend no share. The
demolition track's marker, at (0291+) by 0290's record, shifts to (0292+)
by this ruling's landing.

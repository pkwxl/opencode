# 0290 — The adoption site's fourth-day findings (the shadowed continuation; the booked zero-write pin; source-mode ops staleness; wire nits)

Status: **findings record, 2026-11-21.** The adoption site's sixth field
record under 0255's incident instrument (0257, 0262, 0264, 0285, 0286,
this — the estate's executor mode live on three lanes, wire `0.1`,
measured at the tree carrying `0287` committed (`9fc215390`) with
`0288`/`0289` enacted uncommitted beside it, the daemon restarted onto
that line 16:58 CST after the sitting measured the tree green).
Exposure denominator: one adoption site, bring-up day 4, zero days of
release exposure. This document rules nothing (0165's neutrality) and
lands no code, no template, no test; the fixes, when directed, each
land as their own ruling per 0123/0110 D13. Four findings — two
measured as lane-blocking residuals of the just-landed fix family, one
host-side, one batched wire/document set — each with its locus, its
classification, its remedy family and its residual.

Derives P19 (measured field record — every locus cited from the wire
replies, the lane ledgers' bytes, the daemon's console and log, and
the code as it stood), P18 (a plain corpus document, recorded findings
the only evidence channel), P8 (each finding names its remedy family
and the residual the fix ruling must settle). Amends none — 0287 and
0289 are cited as measures (their recorded residuals now carrying
their field records), never challenged.

## Category scope

Tier: record — no code, no template, no vocabulary act. The eventual
fix homes: `src/executor-coordinator.ts` (F1's sweep guard, F2's
continuation/op arm), `../auto-server/src/ops.ts` and the daemon's
identity surface (F3), `docs/protocol.md` (F4a/F4b's letters), each
with its test home named in its own ruling.

Premises this ruling changes: none. Re-read in this change: 0287 (the
sweep family and the reconcile operation — F2 is its recorded
residual's field record), 0289 (the continuation re-derivation — F1 is
its guard's shadow case), 0270 (the build stamp's honest `dev` floor —
F3's invisibility half), 0276 (the fix grant's per-unit context —
F4d's precedent), 0284 (the ops surface) — all stand.

## F1 — the shadowed continuation: the person's Status amendment cannot reach a landed flag that a later dead lease shadows

**Measured.** erofs's T-064 after the person exercised 0289's first
document channel — a one-line committed amendment of the landed
handoff's Status line (`1bd9451`, continue→done): successive `ready`
acts (the sweep riding their head) left the menu lettering the unit
`execute` to both tokens, the verify share unreachable, the ledger
untouched. The unit's entry sequence reads: [an unbooked dead `exec 1`
first share; the landed `exec 1` (`07d4a27`, receipt
`landed`+`continuation:true`); a released, unbooked `exec 2` dead
lease] — the released tail entry is `latest(unit)`, and the sweep's
own guard (`latest(entry.grant.unit) !== entry`) therefore skips the
flagged landed entry forever, while the claim path's
`priorHandoff`/`handedOver` walks (`entries.findLast(… landed …)` over
the flag) read the flag **wherever it sits**. The asymmetry is the
defect: routing reads the flag at any position; correction reads it
only at the tail.

**Locus.** `src/executor-coordinator.ts` — `reconcileContinuations`'s
latest-entry guard against `preview()`'s position-independent
`priorHandoff`/`handedOver` flag reads (0289's "only the unit's latest
entry routes" letter, true of the *routing*, false of the *correction*
the same ruling shipped).

**Classification.** A completeness gap in 0289's evidence-gated
correction: the two document channels work exactly as designed when
the flagged receipt is the unit's latest entry, and are unreachable
when any later dead or non-landing entry shadows it — the field's
common shape, since a stranded continuation invites exactly the
probing claims and releases that leave tail entries.

**Site-side move (measured, works).** The takeover landing: claim the
re-grant the continuation itself routes, run a truthful bounded share
over the already-whole unit whose handoff reads `Status: done`, report
while the lease is live — the landed receipt books without the flag
and the verify share follows at the next wire act (T-064's exact
path: takeover settled `20c2d3e`, verify 1 PASS `f702298`). Cost: one
attempt id and one share of budget spent on resumption rather than
work, and the holder must discover its unit's already-landed state
from the tree (F4d).

**Remedy family.** (i) The sweep re-derives every landed continuation
of the unit whose trailing entries are all dead or booked
non-landing, evidence-gated as 0289's arms; or (ii) the continuation
flag is derived at read time from the handoff's committed bytes
(P6 taken to its limit — `preview`/`unitDecision` re-reading rather
than trusting the persisted facet), which closes every shadow shape at
once; or (iii) meanwhile this record's takeover landing stands as the
sanctioned site move. Residual: (ii)'s read cost on every preview; the
takeover move's budget cost — a fix ruling pins both.

## F2 — the booked zero-write pin: 0287's residual with its field record; the forced arm cannot reach booked entries

**Measured.** squashfs's T-006 — the pin 0285 recorded had *migrated*
before 0287's ruling was written: the prior night's report replays
booked the dead formulate leases (the ledger holds three `T-006
formulate 1` entries, each `ended` with receipt
`{"kind":"without-landing","reason":"zero-write"}`, file bytes of Nov
20 22:39), so the lane holds a **booked** non-landing continuation
over the person-completed unit (amendment `57c1d50`). Field: untargeted
claims answer the held row `wait/not-ready "T-006 is not ready."`, and
a targeted `{task: "T-007"}` claim answers the same bytes (the
continuation's serial reservation) — 0287's own fixture finding for
targeted claims, now confirmed live. The dead-letter sweep books
nothing across the sitting's wire acts (the ledger's mtime unchanged
since Nov 20): every T-006 entry is booked, and the sweep's first
guard (`if (entry.booking || live(entry, at)) continue`) declines
booked entries **ahead of the forced check** — so the `reconcile`
operation naming the unit books nothing and answers its no-lease
letter (code-read, not field-invoked: the running daemon predates the
operation until this sitting's restart, and the probe preceded it).
`reconcileContinuations` handles only `landed` receipts. No
person-reachable channel remains — 0287's recorded residual ("the
op's arm widens or the blocked receipt itself unreserves"), its field
record now standing.

Also measured: 0287's site prediction ("the squashfs lane self-clears
on its next claim") did not materialize — the live ledger's shape had
moved past 0285's unbooked-expired description before the ruling was
written (fixture-true, site-false; the field's ledger migrated under
the record).

**Locus.** `src/executor-coordinator.ts` — `reconcileDeadLetters`'s
booked-entry guard ahead of `forced`, `preview()`'s continuation arm
(a booked `without-landing` receipt is neither `landed` nor
`reconciled`, so it routes the next claim at its unit), and the
`reconcile` operation's arm (the forced channel's reach).

**Classification.** A channel-coverage gap at the seam of two rulings:
0287's clearing channels enumerate unbooked dead letters and landed
continuations, and the field's third shape — a *booked non-landing*
receipt over a unit the record closed — belongs to neither family,
exactly as 0287's residual anticipated.

**Remedy family.** (i) The operation's forced arm books dead **booked**
entries of the named unit by person-reconcile (the re-booking a
booking's assertion about the ledger's claim, never a rewrite of
history — the receipt's provenance naming the forced arm); or (ii) the
continuation derivation declines over a unit the durable record
completes (`unitCompleted` gating `preview()`'s continuation — 0285's
index-truth family); or (iii) the without-landing receipt itself
unreserves when its unit's record completes (0287's second arm).
Site-side: the lane parks with ten planned-pending units behind the
pin.

## F3 — source-mode ops staleness is invisible: a moved tree does not move the running daemon's operations

**Measured.** The daemon, spawned 09:58 CST from the checkout, served
executor routes through bridges freshly spawned per attach from the
current tree (current behavior) while its own process still ran the
pre-`0287` line: after `0287` committed (13:03) the daemon's
`reconcile` operation did not exist and its `transfer` operation still
carried 0286-F1's dropped-intent defect for ~4 hours — no surface
naming the skew (`ready`'s `build` field reads `dev` in source mode,
0270's honest floor; the operation replies carry no code line; the
ops' exit vocabulary is identical across the versions). The estate
measured the moved tree green, restarted the daemon by hand (16:58),
and the first post-restart `transfer` invocation ran the fixed code
(igb, exit 0). The mixed-version window is silent on every surface
while it is live — an operator cannot tell a fixed op from a stale
one without dating the process against the checkout by hand.

**Locus.** The operations execute in the daemon process
(`../auto-server/src/ops.ts` in-process; the bridges attach per
project on demand from the current tree) — a version split by design,
without a witness.

**Classification.** An observability gap, not a behavior defect: the
crash-safe re-derivation makes a restart cheap, but nothing tells the
operator a restart is *owed* — the staleness check the build stamp
was designed for cannot fire in exactly the mode the estate runs
(run-from-checkout, the standing posture until a release cuts).

**Remedy family.** (i) An operation-reply or banner/health field
carrying a source-mode-usable fingerprint of the daemon's own line
(the loaded entry's mtime, or a checkout state marker — commit plus
dirty); or (ii) the daemon watching its own tree and exiting loudly on
change (the stale-lock recovery making the restart cheap by design);
or (iii) the operations routed through a per-invocation fresh process.
Residual: bridge-versus-daemon skew is inherent to attach-on-demand —
whatever fingerprint lands should name both lines. (Estate-side, named
for completeness: the host's zcode-cli watcher produced no respawn
within 60 s of the kill — the §8 hand procedure carried the restart;
the keeper question is the estate's, not the tool's.)

## F4 — wire and document nits, measured the same sitting (batched)

- **(a) The leased grant's reply key is unnamed in the spec.** The
  `claim`/`brief` replies carry the grant under a `step` key;
  `docs/protocol.md`'s route letter says "Returns a leased grant"
  without naming the field. The site's first parse read a `grant` key
  against a good reply and measured nulls. One spec sentence.
- **(b) The verify grant's null budget.** Verify grants carry
  `budget: null` while the heartbeat letter derives the renewal window
  "from the grant's own budget, capped at twice it" — the null-budget
  derivation is undocumented (the field held: deadlines present,
  hub-held renewals green across three verify shares).
- **(c) The held row names the stranded unit, not the cause class.**
  `wait/not-ready "T-006 is not ready."` is indistinguishable from a
  dependency wait on the menu alone — 0285's menu-honesty family one
  level deeper: the pin is named, not diagnosable (the ledger's
  continuation vs the plan's dependency edge).
- **(d) A continuation re-grant carries no landed-share context.** The
  re-grant renders the full fresh-claim whole-task brief; the holder
  learns its unit already landed a share from the tree, not the grant
  — the fix grant's per-unit context discipline (0276) is the standing
  precedent for carrying the landed receipt's id/commit on the grant.

## The sitting's site-side record (context for all four)

The fourth executor-mode day's second dispatch sitting — nine settled
shares, every commit the coordinator's, zero executor staging
anywhere: erofs closed T-064 (F1's takeover move: amendment
`1bd9451` → takeover `20c2d3e` → verify PASS `f702298` → done
`eabf6bd`), T-065 (the formal black-box run observed green inside a
heartbeated child share — 19/19, `EROFS-BLACKBOX-VERDICT: PASS`,
`LANE_RC=0` — exec `2d4503c`, verify PASS `d789119`, done `8c26b42`),
and T-066 (the mode's first verify-FAIL → fix → re-verify-PASS round:
`59ec962` → `75789d9` two gaps → `8aec393` → `2342e77` PASS → done
`e82f14d`); igb's held boundary advanced through the 0288-fixed
operation (exit 0: regression `9b2faf1`, transition `7d58605`, the
P03-design floor `9565468`); squashfs parked on F2. The daemon
hand-restarted onto the `0287`+`0288`+`0289` line after the sitting
measured both packages' typechecks and the new suites green. The
demolition track 0289's row names as (0290+) shifts to (0291+) by this
record.

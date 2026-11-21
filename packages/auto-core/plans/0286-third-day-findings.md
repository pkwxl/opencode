# 0286 — The adoption site's third-day findings (two executor-cutover blockers)

Status: **findings record, 2026-11-21.** The adoption site's fifth field
record under 0255's incident instrument (0257, 0262, 0264, 0285, this — the
estate's executor-mode cutover live on three lanes, build `dev` at `49a9fbfa2`,
wire `0.1`; 0285's pin recorded the same sitting's first half). Exposure
denominator: one adoption site, bring-up day 3, zero days of release
exposure. This document rules nothing (0165's neutrality) and lands no
code, no template, no test; the fixes, when directed, each land as their
own ruling per 0123/0110 D13. Two findings, both measured the same day on
the same lane pair (igb's held boundary; erofs's parked verify), each with
its locus, its classification, its remedy family and its residual.

Derives P19 (measured field record — every locus cited from the daemon's
console, the wire replies, the lane trees and the code at `49a9fbfa2`),
P18 (a plain corpus document, recorded findings the only evidence
channel), P8 (each finding names its remedy family and the residual the
fix ruling must settle). Amends none — 0246 D5/D6, 0260, 0261, 0276 and
0284 are cited as measures, not challenged.

## Category scope

Tier: record — no code, no template, no vocabulary act. The eventual fix
homes: `packages/auto-server/src/ops.ts` (F1) and
`packages/auto-core/src/executor-coordinator.ts` (F2), each with its test
home named in its own ruling.

Premises this ruling changes: none. Re-read in this change: 0246 D6 (the
token-distinct verify — F2's stake), 0261 (the restriction catalog's
menu letter — F2's honesty half), 0275 (the hub-held heartbeat the site
rode around F2's discovery), 0284 (the ops surface F1 rides) — all stand.

## F1 — the transfer operation drops the project's intent: the wall admission reads the default pack and the boundary holds on "no instrument"

**Measured.** The igb boundary after its distill share settled (the
handover landed at `9eae786`): `POST /projects/igb/transfer` answers exit
2, the daemon console carrying "the wall's admission scan has no
instrument: the intent pack declares no regression-cost lane row" — while
the project's materialized pack
(`.opencode/auto/intents/cleanroom.md`) declares the divergence row
byte-identically to the erofs lane whose wall crossed cleanly (verified by
diff), and the CLI-era advance on the same project resolved `intent
cleanroom` and ran (the estate's `transfer-igb-3.log`).

**Locus.** `auto-server/src/ops.ts` `runTransferOp` builds the
deterministic opts as `{phases, build, scanExempt, isolate, autoNumber,
testByDriver, acceptanceGate}` — **`intent` is absent** (the file's only
`intent` mentions are the `amend` op's config-key surface).
`auto-core/src/transfer.ts`'s wall machinery then calls
`promptFacts({dir, intent: ctx.opts.intent})` with `intent: undefined` →
`resolveIntent(packs, undefined)` → the built-in default pack →
`parseTestLanes` finds no `### test-lanes` under the default's `quality` →
`regressionLanes(undefined)` → the no-instrument finding, exit 2. The
CLI's own transfer passed the config's intent (the log's "intent
cleanroom" line); the operation lost it in the translation.

**Classification.** A translation defect at the ops surface (0284's
letters): the deterministic advance is state-resolved, but its
pack-dependent halves still need the project's intent, and the op drops
it — the wall admission and every other promptFacts consumer in the
advance read the default pack on any intent-bearing project. Measures:
0284 (the ops surface), 0265 (the daemon environment's own letter — the
environment pinned, the config dropped).

**Remedy family.** `runTransferOp` (and the audit of every sibling op
that builds RunAllOpts-shaped inputs) passes `intent: config.intent`
alongside `phases` — one line plus its test (an intent-bearing fixture
project whose advance reaches the wall admission). The residual: whether
`config.intent`'s absence should default silently to the built-in pack
inside promptFacts at all, or the ops layer should refuse an unconfigured
intent loudly (P12's direction) — the fix ruling's call.

**Site-side.** The igb boundary is blocked on this alone (the sitting's
person-side re-seal `3f95a65` cleared the sealed-channel findings — the
second invocation's console carried only this finding). The lane parks
with its distill landed.

## F2 — a landed scoped unit's verify share is unreachable: the scoped decision starves the verification arm of the entry it needs

**Measured.** erofs's T-064 (a scoped unit — its `touches` carry
`tmp/fixtures/erofs/`) landed its execute share whole (`07d4a27`, the
coordinator's settlement). Every claim shape for the verify share fails:
a targeted `{task, kind: "verify"}` claim answers
`wait/not-ready "T-064 is available for a new claim."` (the
withoutGrant wrap), and an untargeted claim from the verifier token
**grants a fresh execute attempt on the same unit** (`T-064 exec 2` —
surrendered immediately by `release`; the attempt budget unharmed,
released entries not counted). The menu offers the unit as `execute`
to both tokens.

**Locus.** `auto-core/src/executor-coordinator.ts` `scopedDecision`
(:1836-1880) computes `last = latest(task)` but passes `reservation`
(defined only while that entry is live and non-terminal) to
`unitDecision` (:1880: `unitDecision(holder, at, kind, reservation, task,
true)`). For a **landed** (terminal) scoped share — exactly the state a
verify share follows — `reservation` is undefined, so `unitDecision`'s
`needsVerification` computes over no entry, the first arm renders the
task preview (`execute`), and the `verification()` arm that renders the
verify grant is reached only with a live `last`. The unscoped path
(`select` → `unitDecision(last = entries.at(-1))`) reaches it — which is
why T-063 (unscoped) verified normally (`13c5500 T-063 verify 1`) while
the scoped T-064 cannot: with any scoped task in the plan,
`scopedTasks.length` also intercepts the untargeted claim
(`select`'s scoped branch), so no claim shape reaches `verification()`
for a landed scoped unit at all.

**Classification.** A routing gap between the scoped tiers (0248's
letter) and the verification arm (0246 D6): the scoped decision's
entry-plumbing was built for continuation reservations and starves the
landed-entry consumer. The honest-menu half: `ready`'s claimable row
offers `execute` where the unit's next true step is a token-distinct
verify — a 0261-spirit mislettering beside the routing gap.

**Remedy family.** `scopedDecision`'s call passes the task's latest
landed entry to the verification arm when no reservation stands
(`reservation ?? latest(task)` narrowed to the arms that want it, or the
verification arm re-deriving `latest(task)` itself); the menu's row
letter follows the same derivation. The residual: the fix must not widen
the scoped tier's isolation checks — the reservation's scope guards stay
exactly as they are; and the execute-attempt grant an untargeted claim
receives meanwhile is itself a hazard worth pinning in the fix's tests
(the site surrendered one; a less careful holder would have burned the
budget).

**Site-side.** The erofs lane parks with its T-064 execute landed and its
verify unreachable; the parked state is visible as a claimable
`execute` row that must not be claimed.

## The sitting's site-side record (context for both)

The estate's third executor-mode day: erofs T-064's execute settled
through the launcher-hosted child (the harness grants a configured child
session no spawn tool, so the commissioning session hosts the child and
holds the lease — recorded in the estate's design doc); igb's P02
distill settled the same way (`9eae786`) and its boundary then held on
F1 after the person's re-seal cleared the sealed-channel findings; the
erofs verify parked on F2. The demolition track 0285's record shifted to
(0286+) now shifts again to (0287+) by this record's landing.

# 0179 — The exhausted ring's return is scheduled evidence; the retired skip-flag vocabulary leaves the comments in lockstep

Status: **active**. Ruled 2026-11-06 by 0166 step 019 (wave W2-keyring), enacting 0165-126
(S16-02, S3, CONFIRMED — recoveryAt still treats an exhausted key ring as 0057 S4's "instant
unknown" although every key mark has carried `until` since 0163 D1, so the first wait round of a
ringed provider polls instead of sleeping to the stated reset it holds) and 0165-199 (S16-07,
S4, CONFIRMED — the router still speaks the skip-flag vocabulary 0163 said it retired in
lockstep, routing.ts imports `select` unused, recoveryAt's header states the pre-0163 premise).

## Derives

Derives: P6 — derived state, re-derivation from durable evidence — the direct case: the ring's
return instant is evidence the router already holds (every key mark's `until`, 0163 D1's one
mark shape), and recoveryAt refused to read it, scheduling the wait-and-probe round on a polled
30-minute interval while the marks stated the opening — the schedule must be derived from the
evidence held, never from a superseded premise. P19 shows in the finding's own shape (0057 S4's
rule was measured against the skip-flag era's facts; 0163 D1 changed the facts and the
cross-ruling read missed the seam — the premise-drift root the 0167 guard now names). P13 shows
in the lockstep half (199): 0163's own P13 clause said the skip-flag vocabulary retires "in
code comments in lockstep" — three router comments still speak it; the one-mark shape is
restated. P10 in the floor (a ring whose marks carry no readable instant — and every context
without a ring reader — still withholds the instant exactly as before; the stated-reset cascade
untouched). Tier: operating — P6/P13 statements applied to the selection schedule and comments;
no Tier I statement changes.

premises this ruling changes: 0055 §6.3's recoveryAt ring half via 0057 S4's rule ("a ring with
no usable key leaves the instant unknown, since waiting alone may never cure it" — the skip-flag
era's premise; AMENDED: an exhausted ring's earliest key `until` is the instant, and the
candidate's return is the later of its model mark and its ring's keys); 0163 D3's "the
stated-reset half … unchanged" line is corrected (its cross-ruling read missed recoveryAt —
the D3 floors stand, the missed seam repaired here). Re-readings: 0163 D1 stands (the one mark
shape this ruling consumes); 0057 §6's candidate half stands; recoverySleep's cascade stands
(`back` undefined still polls — now only the floor shapes).

## Category scope (0123 D1's discipline)

Family: *the selection schedule* (what the wait-and-probe round sleeps to) and the key-state
vocabulary's comment lockstep. Home-set: `src/select.ts` (SelectContext's `ringBack`, the
routeContext wiring, recoveryAt's ring branch and header), `src/router.ts` (the `ringBack`
member and its Router type line, the three restated comments), `src/routing.ts` (the unused
import dropped), `test/select.test.ts` (the ring oracle rewritten to the 0163 premise). No
frozen vocabulary changes: `ringBack` is additive machine surface; no protocol literal, log
line or switch changes.

## D1 — the ring's return instant is schedule input

The selection context gains `ringBack(provider)` (the router's earliest `until` over the
provider's key marks) beside `ringUsable`, and recoveryAt treats an exhausted ring like a down
mark with an instant: the candidate's return is the LATER of its model mark and its ring's
earliest key mark (both must clear), then the window's next opening as before. The floor
stands: a ring with no readable instant — and any context without a ring reader — withholds the
whole instant exactly as 0057's withholding rule demands (the probe is the only way back). The
first wait round of a quota-exhausted ringed provider now sleeps to the stated reset its marks
hold instead of polling 30 minutes and erasing the non-current keys' evidence at the probe.

## D2 — the skip-flag vocabulary leaves the comments

The three router comments that still spoke the retired two-kind key state ("flags and `until`
marks alike" ×2, "both kinds") are restated to the one-mark shape 0163 D1 ruled; recoveryAt's
header no longer states the pre-0163 premise (D1's rewrite); routing.ts's unused `select`
import is dropped. No behavior changes in this half.

## Residuals

- The probe's wholesale key-mark clear (§6.3) still erases the non-current keys' evidence at a
  premature probe — narrower now (the first round sleeps to the marks' instant), never
  re-drawn here; S17-01's family (0178 D1) already bounds the consequence.

## Tests

- select.test.ts: the ring oracle rewritten — the ring's earliest instant scheduled (the
  soonest candidate), the later-of-mark-and-ring case, the withholding floor (an undefined
  ringBack, and an unwired reader) both polling, the usable ring unchanged; fail-before: the
  scheduled case answers undefined on the pre-change code (the old `if (ring) return undefined`).

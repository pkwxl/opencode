# 0300 — the pending-settlement wedge: the mid-formulate graceful stop that cannot land, the successor's pair the wire never re-serves, and the ops refused behind the never-idle worker

> Findings only, nothing enacted. Filed by the estate (the recorded
> adoption site) at its sixth dispatch sitting, 2026-11-23, under the
> standing instrument (plans/0255's field-record duty; the
> 0290/0295/0297/0299 shape — a record, its remedy families, and the
> site cost measured; the tool's own rulings stay the tool session's).
> Takes 0300 past the estate's own 0299 per the 0294→0295 precedent.

## The finding

Three defects stacked on one lane state, each small, together wedging
a lane's whole protocol surface for the better part of an hour with no
wire-side exit: a person-ordered graceful stop mid-formulate parked a
booked-without-receipt share that (1) cannot land its continuation
because the formulate collect validates the whole family, (2) cannot
be retried by the designed same-token successor because the wire never
re-serves the original step/lease pair, and (3) fences the daemon's
own deterministic operations behind a coordinator worker that never
idles while a settlement pends.

**The field cost, measured (igb T-029 formulate 1 attempt 2,
2026-11-23 07:39–08:0x CST):** a person-ordered graceful stop halted
the formulate child mid-survey (its handoff honestly recording "no
formulation output was written before the stop"; the survey and the
slicing design preserved). The child reported `ended` with
`handoff Status: continue` — the execute-kind precedent's shape,
landed cleanly the same morning by squashfs T-007 exec 1's identical
park. The settlement refused:

```
blocked/commitFailed — "the formulation output is invalid: the Scope
carries an obligations ledger but the coverage map is missing or
empty — map every row"
```

— leaving the entry booked (`outcome: "ended"`, no receipt). From
that instant, every wire surface on the lane answered a dead end
(each measured verbatim this sitting): `ready`'s pending row
`wait/in-flight "A previous share requires settlement."` with
`claimable` empty; a targeted same-token claim `blocked/commitFailed`
with the same remedy (the resume-settlement arm re-running the refused
settlement); `brief` `wait/not-ready "This channel has no live brief
for T-029."` (the lease is dead by the booking); and the person's
forced arm — `POST /projects/igb/reconcile {"unit":"T-029"}` under
`control` — answered 409 `a run is already active on igb: run
run-000008 is running … retry once the active run reaches a terminal
state`, a terminal state the worker structurally never reaches while
the pending settlement holds it busy. The lane's designed exits were
exhausted from the wire; the recovery required reading
`.auto/executor-progress.json` (the driver-side ledger) off-protocol
to reconstruct the original report pair.

### 1 — the mid-formulate graceful stop cannot land its continuation

`formulationProblems` (src/executor-coordinator.ts, ending :731) runs
`coverageProblems` (src/formulate-synthesis.ts :663–672) on **every**
formulate settlement whose task todo carries an obligations ledger —
with no continuation carve-out. A formulate share interrupted before
any family file exists (the exact state a graceful stop produces: the
handoff the only write) therefore cannot land even as a continuation:
the collect demands the coverage map the stopped session had not yet
composed. The execute kind lands the identical shape (T-007 exec 1:
parked mid-read, `Status: continue`, settled clean as a continuation
receipt) because its settlement validates the scope fence and the
handoff alone; the asymmetry is the defect. The manual
(prompts/executor.md) teaches neither the formulate continuation's
validation nor the outcome choice at a graceful stop — its step-5
letter says report `ended` "when the brief's work ends" and `failed`
"when work hits a blocker", and a person's stop is neither.

### 2 — the successor's original pair is unreachable from the wire

The designed recovery for a refused settlement is "fix the artifact
and re-report" — the original pair retried over the repaired tree
(the formulate lesson, measured for three kinds by now). But the
booked entry is not `live()` (`executor-coordinator.ts` :1730 — a
booking ends the lease), so `brief` (:2266–2277) answers "no live
brief" instead of re-serving the grant, `claim`'s held-lease re-answer
(:2191–2194) never matches, and the resume-settlement arm
(:2197–2201) answers only the blocked remedy on refusal — which names
the artifact fix but not the step id, and never the lease. A
same-token successor (the designed shape — the ledger's own
`SettledStep` comment names "the share's own producer (or its
same-token successor)" the read-back class) therefore cannot obtain
the pair from any wire surface; the retry path exists in the report
handler (:2310–2319, the booked entry re-settling under its original
pair) but is reachable only by a holder that already holds the pair.
The successor must read the driver-side ledger off-protocol — exactly
what this sitting did.

### 3 — the ops surface refused behind the never-idle worker

`busy()` (`executor-coordinator.ts` :2371) includes
`pendingReport() !== undefined`, and the coordinator worker idles out
only when not busy (`src/../auto-server/src/executor-worker.ts`
:171–176, `IDLE_MS = 30_000`). A pending settlement therefore keeps
the worker alive indefinitely — measured: 16+ minutes past the last
executor act — and `liveRunOn` (`auto-server/src/daemon.ts` :306–307)
then refuses every write operation on the project (:835–842) with
"retry once the active run reaches a terminal state": unsatisfiable
while the pendingReport stands, since the worker exits only when the
pendingReport clears — which is what the operation was for. The
designed stop exists (the reconcile op's own doc, ops.ts :1037–1039:
"a live driver (a spawned executor run) holds the coordinator's run
lock and the op names the stop" — `DELETE /runs/<id>`), but the
refusal never names it. The person's forced arm for exactly this
ledger state is refused by the daemon's own guard with a remedy that
cannot succeed.

## Recovery measured (this sitting, live)

The launcher reconstructed the original pair from the driver-side
ledger (`grant.id` + `grant.lease` of the booked entry — the report
handler's `lookup` accepts it verbatim; `sameHolder` matches on
token+channel), dispatched a continuation child under the same
channel to complete the formulation family (the stopped session's
handoff carrying exact resume steps), heartbeating the dead-man's
lease is unnecessary (the booking ended it) — and the retried
original pair over the completed tree settles clean when the family
validates. The recovery works; it is simply not reachable from the
wire alone.

## Remedy families

1. **The continuation landing (the root):** the formulate settlement
   admits a continuation receipt when no formulation-family file was
   written (the handoff the only changed path — the execute
   continuation's own shape), or the manual's stop letter teaches the
   `failed` outcome for a graceful stop before output exists (booking
   without-landing; a fresh claim re-grants; the handoff dirt carries
   the survey forward either way).
2. **The successor's pair:** `brief` re-answers the booked grant
   (with its step id and lease) to the same holder when the entry is
   booked-without-receipt — the read-back class the SettledStep
   comment already names — or at minimum the refused settlement's
   remedy names the step id; the manual states the ledger
   reconstruction for same-token successors if the wire stays silent.
3. **The ops wedge:** the 409's retry letter names the kill remedy
   (`DELETE /runs/<id>` then re-run the op) when the live run is a
   coordinator worker, or `busy()` drops `pendingReport()` (the
   worker idles at 30 s, the ops run, a later executor act re-attaches
   a fresh worker — the crash-safe re-derivation makes it cheap), or
   the daemon README states the wedge shape beside the reconcile
   letter.

## Classification

Settlement-grammar defect (the formulate collect's continuation
blindness) + wire-surface gap (the successor's pair) + refusal
diagnosability (the 409's unsatisfiable remedy) — no fence behavior
wrong, every commit the coordinator's, the recovery measured live
over the original pair. Derives P5, P8, P10, P19.

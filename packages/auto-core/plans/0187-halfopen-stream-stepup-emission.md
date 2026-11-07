# 0187 — The probe judges the stream, the late step-up the event's own error, the emission chain never poisons, and the mid-turn steer failures gate nothing

Status: **active**. Ruled 2026-11-07 by 0166 step 027 (wave W-engine), enacting 0165-030
(S14-05, S2, CONFIRMED — the liveness probe asks only whether a GET on a new connection
succeeds, so a healthy server with a dead turn SSE connection (0026 §1.3's measured
"transport-layer half-open, not a server-side stall") passes every probe and resets the
count; `await watching` then has no bound at all), 0165-118 (S14-02, S3, CONFIRMED — the
late step-up classifies the failure slice's merged message, so one overflow makes every
later failure of the turn step the session up again, an unrelated 500 climbing to the
costliest id with a log line naming an overflow that never happened), 0165-119 (S14-03, S3,
CONFIRMED — one throw inside a synthetic handler rejects the spine's emission chain forever:
every later probe verdict and classifier answer re-rejects unhandled without running, so a
later half-open connection is never judged and the turn hangs), and 0165-120 (S14-04, S3,
CONFIRMED — the usage concern's two mid-turn steer failures settle the turn blocked without
aborting the still-running server turn, an informational notice halting the run while the
stuck hint and the step-up treat theirs as "not a gate"). D5 enacts the probe-never-attach
half 0165-010's ledger row deferred here from step 021 (ruling 0181 D1's named residual).

## Derives

Derives: P2 — every automatic escalation is bounded and terminates at the person: a silently
dead stream to a healthy server hung the run with no line, no verdict and no /exit boundary
(D1); a poisoned emission chain silently removed the one bound left (D3). P20 — the waits
exist for transient faults and in-flight work is never destroyed: a failed steer dispatch is
a momentary fault, not a person's moment, and the session's turn keeps running — it is never
left writing beside a driver that moved on, and the notice the session could do without never
halts the task (D4); the probe's own question widens to the stream it was built to watch
(D1). P12 — fail loud, conservative under uncertainty: a rejection inside a synthetic handler
reaches the person through the external path's driver-fault channel instead of a stderr line
the run ignores while its probe disables itself (D3); a step-up line names an overflow that
happened, never one two errors ago (D2); the silent-stream verdict resolves toward the
conservative two-consecutive rule and respects the announced-silence window (D1). P19 —
measured evidence: D1 answers 0026 §1.3's own incident record (the terminal message
persisted server-side, the SSE socket dead), and the 10 s `server.heartbeat` the opencode
server emits on every /event connection (event.ts:63) is the measured signal the adapter was
dropping. P8 — blocking reserved for the stop's own work and the person's moments: a failed
usage steer is neither (D4). P10 — every floor: an adapter without the heartbeat capability,
or a probe interval too short to hold three beats, keeps today's fresh-connection-only
verdict byte-identical (D1); a log write failure is silenced, degrading to the console line
already printed (D3). P13 — the vocabularies grow additively, each in its conscious lockstep
(D1's AgentEvent kind and capability; D5's chain mark). Tier: operating — no Tier I statement
changes.

premises this ruling changes: 0026 D3/§4.4 (the probe's detection principle — "the success
or failure of a fresh request is a trustworthy signal of transport-level liveness" measured
only the server's side of the transport; D1 amends the principle to the two-legged question
the incident itself posed, the fresh-connection leg standing unchanged); 0061 §4.4 rule 2's
emission comment ("An audit throw here rejects the chain — an unhandled rejection, as loud
as the programming error it is" — measured false: nine stderr lines while the run continued
with the probe disabled; D3 replaces the costume with the real channel); 0157 D6's
composition enumeration ("a blocked one [aborted] in the questions handler" — the
enumeration missed the usage concern's two mid-turn blocked settles, which aborted nothing;
D4 removes them and the enumeration becomes complete as written); 0055 §4.5/§7 (the late
step-up's trigger — the overflow condition is sound, the trigger surface was implemented as
the turn's accumulated record; D2 narrows the trigger to the event's own error, the
compacted-in-place shape and the ladder keeping standing exactly as 0185 D3 re-read them).
Re-readings that stand: 0185 D1 (D3 rides its channel — the re-throw out of runTurn reaches
runSession's driver-fault rethrow unchanged; no new class is invented); 0181 D1 (the general
detach stands; D5 completes its probe-specific residual — probe dispatches never attach);
0069 §2.4's probe posture (untouched — that probe is awaitRecovery's wait-side session, not
the liveness probe); 0037 D2's never-reject contract (the heartbeat is an event, not a
rejection; no call rejects that did not).

## Category scope (0123 D1's discipline)

Family: *the turn engine's liveness, step-up, emission and steer-settle surfaces, and the
probe dispatch's sideband posture*. Home-set: `src/agent/types.ts` (the heartbeat event kind
and capability — the file's eighth conscious amendment, its header's convention),
`src/agent/opencode/events.ts` (mapEvent's heartbeat case), `src/agent/opencode/client.ts`
(the capability value), `src/engine/sources.ts` (the pulse-observing stream wrapper; the
probe verdict's streamAlive leg), `src/watch.ts` (the wrapper's composition at the seam),
`src/engine/contract.ts` (the probe input's streamAlive; the liveness slice's streamSilent),
`src/engine/concerns/liveness.ts` (the stream leg's count and message), the arbitration
table's empty `heartbeat` row in `src/engine/spine.ts`, `src/engine/concerns/failure.ts`
(errorInfoOf, the event-own classify fold), `src/engine/concerns/step-up.ts` (the late
step-up's trigger), `src/log.ts` (record's silenced write), `src/engine/concerns/usage.ts`
(the two non-gates and the wall hint's re-arm), `src/chain.ts` (SessionChain's `probe`
mark), `src/router.ts` (probeChain sets it), `src/attempt.ts` (the attach skip); tests
`test/agent-events.test.ts`, `test/turn-liveness.test.ts`, `test/turn-step-up.test.ts`,
`test/turn-arbitration.test.ts`, `test/turn-usage.test.ts`, `test/session.test.ts`, the
re-blessed goldens `test/golden/turn/message-wall-steer-failed.json` and
`message-usage-notice-steer-failed.json`. Vocabulary: AgentEvent grows one kind
(`{ type: "heartbeat"; session: "" }` — additive, P13); AgentCapabilities grows one optional
field (`heartbeat?: number`, the pulse interval in ms); TurnInput's probe kind and
TurnState's liveness slice grow one optional field each (engine-internal, in-process);
SessionChain grows `probe?: true` (in-process, construction-only, never persisted); the two
retired blocked question strings were teaching lines, no persisted literal changes; the
arbitration table's key set grows the heartbeat row (empty — dispatched to nothing, the
watch wrapper consuming the kind before the spine).

## D1 — the probe judges the stream, not only the server (0165-030)

0026 D3's probe rides a fresh short-timeout GET: a healthy server answers it even when the
turn's own SSE connection died silently, so the count resets forever and the turn never
settles — the exact shape §1.3 measured (the turn ended server-side, the terminal message
persisted, the socket dead, "SSE watching has no upper bound"). The opencode server emits
`server.heartbeat` on every /event connection every 10 s (measured, event.ts:63); the adapter
dropped it at mapEvent's default. The ruling maps it: AgentEvent grows `{ type: "heartbeat";
session: "" }` — the transport's own pulse, belonging to no session, so every session-filtered
consumer (the spine, the pool's and the classifier's streams) skips it by its empty session
and no dispatch ever sees it (the arbitration table's heartbeat row is empty by type
necessity). The opencode adapter declares `heartbeat: 10_000` on its capabilities; every
other adapter and the fakes declare nothing (the field's absence is today's behavior, P10).

watch() wraps the turn's stream with a pulse observer (sources.ts, the liveness machinery's
one home): every event the stream delivers — a heartbeat or any session event — stamps the
pulse (initialized at the turn's start, so a stream dead from the start goes stale too), and
the heartbeat events are consumed there, never yielded onward. At each probe tick the source
computes the verdict's second leg: under a declared pulse capability and a probe interval at
least three beats wide (a window a live stream provably beats within — the default 10-minute
idleTime against a 10-second beat; a shorter interval, a test's 40 ms say, keeps the leg
off), `streamAlive` asks whether anything arrived within the interval less one beat's grace.
The verdict `{ kind: "probe", ok, streamAlive, at }` reaches the liveness concern, which
counts a failure when the GET fails (today's leg) or the stream is silent while the server
answers — a live-but-silent stretch cannot exist under a pulse (the beats are unconditional
server ticks, not agent output), and the announced-silence window exempts both legs alike
(the conservative reading: never judge inside a wait the agent named). The two-consecutive
rule stands unchanged; judgment lands within two to three intervals of the death (20–30
minutes at the default) — bounded where today it is infinite. The finalize's half-open
message gains the stream-silent flavor, its wording keeping the network/timeout criteria
classifySessionError files as transient; the interrupted close-out (abort, failure-record
extension, retry ladder) is unchanged — the verdict is the same class of fault it always
was, now visible.

## D2 — the late step-up reads the event's own error (0165-118)

The failure slice's info is the turn's accumulated record: an error appends (`prev.message +
"\n" + classifyMsg`), a message-less retry keeps it, and classifySessionError tests overflow
over the whole haystack — so after one real overflow every later error or retry of the turn
re-fired the late step-up, climbing to the costliest id (the step is session-lifetime) with
lines naming overflows that never happened, double-booking the stepup counter the quarterly
audit reads (0069 §2.4). The trigger narrows to the event's own error: failure.ts exports
`errorInfoOf(e)` — the classify fold it already applies per error (the name folded into the
message, the structured fields carried) — and the error and retry rows' stepUp cells classify
that, not the merged record. One overflow occurrence steps once; an unrelated 500 or a
message-less retry steps nothing; a retry whose own error is overflow still steps (the
retry-surface shape the cell was built for, 0055 §4.5's "the agent retried the request that
overflowed"). The AUTO-DECISION standing off the consult channel stays true a fortiori (the
patterns' read, now over the event itself). The recovery concern's final classification
still reads the merged record — that is S16's question (the finding's own family note), not
this ruling's.

## D3 — the emission chain never poisons; a log write never throws into a turn (0165-119)

The spine serialized synthetic inputs on a bare `emissions.then(…)`: one rejection inside a
concurrent handler (the probe cell's fx.log hitting an EIO on the log volume — log.ts's
record is an unguarded writeSync — or any future audit violation) left the chain rejected,
and every later emission chained onto the rejection without running, each an unhandled
rejection on stderr — the comment called that "as loud as the programming error it is", but
the run continued with its probe and classifier answers silently disabled, the exact
opposite of loud (P12). Two halves, both landed: the link wraps its row in a catch — the
first rejection is recorded, a held interrupt trips the wrapper (the mechanism that ends the
turn; the settle itself is never observed) and the error is re-thrown out of runTurn right
after the loop, before any finalize — the external path's own exception channel, reaching
runSession's 0185 D1 driver-fault rethrow, so the person is the terminal of a driver bug
instead of its witness; later rejections while one is pending are dropped (the channel
carries one, the turn already ending). And log.ts's record silences its write failures the
way the journal and the stats module already do (events.ts's own rule): a failed log write
degrades to the console line already printed, never a throw into a turn — the log is a
record, not a dependency.

## D4 — the mid-turn steer failures gate nothing; the wall hint re-arms (0165-120)

Every other mid-turn settle aborts the server's still-running turn first (the questions
handler — "otherwise it would modify files concurrently"); the usage concern's two settle
blocked over a failed steer dispatch and left the turn running through the driver's
close-out — concurrent writes, P20's own guard — over steers the design itself calls
informational (0130's notices; the wall hint a policy hint). Both become the stuck hint's
rule ("an attempt to help, not a gate", stuck.ts): a failed dispatch logs (the fx's steer
already prints `⚠ steer dispatch failed: …`) and the row runs on. The usage notice's band is
spent by its attempt (a missed notice is no defect — the next band still fires). The wall
hint re-arms: `hinted` is set only after a successful dispatch, so a momentary failure
re-attempts at the next measurement point (one attempt per completed assistant message —
bounded by the session's own progress), and a persistently dead dispatch path degrades to
the overflow machinery the wall was always backed by (the ladder's fork, 0185 D3's wall
shape) rather than blocking the task. The measurement point after a failed hint passes on
to the stepUp cell (the hint did not land; a session that keeps working steps up, the
existing AUTO-RESOLVE's world with the wall recomputed against the wider window). No abort
is owed anywhere in the concern now: it settles nothing mid-turn. The two trace goldens that
pinned the blocked exits (message-wall-steer-failed, message-usage-notice-steer-failed) are
re-blessed deliberately — the engine is the reference now, the goldens froze the pre-engine
defect — each scenario's script gaining the trailing idle the session's turn would have
gone to, pinning the failure line, the continuation and the natural settle. With usage's two
removed, 0157 D6's enumeration is complete as written: every mid-turn blocked settle aborts
first (questions), and the rest (test protocol, length continuation) are idle-row settles
with nothing running — the spine's comment now states the full set.

## D5 — probe dispatches never attach the sideband (0165-010's deferred half)

Step 021's detach (0181 D1) cleared the between-turns binding, but a probe dispatch still
attached its throwaway session for its seconds-long run: a free line typed in that window
went by promptAsync to the probe session and was logged "→ sent" as if the task received it.
probeChain marks its one-off chain `probe: true` (a construction field, never persisted —
chain-transitions writes nothing of it), and attempt's attach skips the marked chain: during
a recovery wait the sideband is either bound to nothing (the free line discarded with the
teaching line, 0181 D1's rule) or — once service recovers — to the re-dispatched task
session itself. The general detach and the between-turns discard are 0181 D1's, unchanged.

## Residuals

- The stream leg's detection latency is two to three probe intervals (the two-consecutive
  rule over the interval-stale pulse) — 20–30 minutes at the default idleTime, bounded where
  it was infinite; a faster judgment would need a sub-interval timer, no measured demand
  (P21).
- The heartbeat capability carries the adapter's own stated pulse interval; a server whose
  heartbeat cadence drifts beyond it would false-negative (never false-positive) — the
  conservative direction.
- The recovery concern's final classification still reads the merged record (an overflow then
  a quota error classifies overflow) — S16's standing question, the finding's family note.
- The idle-time steer failures (test.ts's protocol steers, the length continuation) still
  block with no retry — nothing is running, no abort is owed; a transient-dispatch retry
  question of its own, no measured demand (P21).
- A structured adapter network flag (0185 D4's later step) may later carry transport
  failures as facts; D3's channel is orthogonal (driver code, not transport).
- S14-07's contract-header overstatement (the out-of-seam effects) rides its W-docs row.

## Tests

- turn-liveness.test.ts: the stream leg — an ok verdict with a silent stream counts the
  failure with the stream-naming line, two consecutive judge half-open with the
  stream-silent finalize message (abort, the extended record classifying transient);
  streamAlive undefined keeps today's reset exactly (the floor); the quiet-window exemption
  covers the stream leg.
- turn-step-up.test.ts: the event-own trigger — overflow then an unrelated 500 steps once
  (fail-before: twice, the second line naming an overflow on the wider id); a message-less
  retry after the overflow steps nothing (fail-before: steps); a retry whose own error is
  overflow still steps; the real failureConcern folds beside a real classifier (the
  finding's own repro shape).
- turn-arbitration.test.ts: the emission isolation — a synthetic handler that throws once
  (the finding's EIO shape) ends the turn with runTurn rejecting the recorded error, the
  later emissions never running but the chain never left rejected (fail-before: the turn
  hangs unsettled, the promise rejecting unhandled).
- turn-usage.test.ts: both steer failures log and continue (no settle, no abort — the
  non-gate), the wall hint re-arming (a second measurement re-attempts once, the second
  failure also not a gate; the band spent by its attempt).
- agent-events.test.ts: server.heartbeat maps to the pulse event; the opencode capability
  declares the pulse.
- session.test.ts: the probe dispatch attaches nothing — the recovery run's attach calls
  name only the task sessions (fail-before: the probe session among them).
- turn-trace.test.ts: the two re-blessed goldens (the failure line, the continuation, the
  natural settle; no abort, no blocked settle).

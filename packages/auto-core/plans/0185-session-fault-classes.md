# 0185 — The session loop's fault-class boundaries: driver faults stop the run, the claim precedes the POST, overflow at the wall never forks, and the restart pattern matches what Bun throws

Status: **active**. Ruled 2026-11-06 by 0166 step 025 (wave W-session), enacting 0165-026
(S13-01, S2, CONFIRMED — runSession's catch-all reclassifies every driver-side exception as a
transient session fault: the phase-less probe answers "recovered" and the loop re-dispatches
into the same throw forever, the person never the terminal), 0165-027 (S13-04, S2, CONFIRMED —
0018's in-flight claim is void under the opencode adapter: the active record is written only
after the POST, which resolves at turn end, so a mid-turn kill leaves the active:false record
and the re-run blocks with the manual teaching, the killed session never reused), 0165-028
(S13-06, S2, CONFIRMED — a terminal context-overflow error enters the ladder as transient,
re-dispatching into forks of the overflowed session forever), and 0165-029 (S14-01, S2,
CONFIRMED — the managed-server restart regex matches no connection fault Bun produces: the
T-057 move dropped an N from econnrefused/econnreset and Bun's own faces never matched either
version, so a dead managed server is never restarted).

## Derives

Derives: P2 — every automatic escalation is bounded and terminates at the person: a
deterministic local fault cycled through six sessions per 45 minutes with no terminal (D1); an
overflow at the wall re-sent the costliest kind of request forever (D3); a dead managed server
polled a wait-and-probe loop that never restarts it (D4). P20 — the sanctioned waits exist for
transient faults; a driver-side throw, a content-bound overflow and a dead host are not
transient, and the wait machinery must not absorb them. P6 — the claim is written at the moment
its fact exists (the session id at create/fork), not at the transport's convenience (D2); P12 —
the uncertain reading resolves loud (the driver fault names itself; the overflow names the
split remedy); P8 — every new line teaches its remedy; P10 — every floor: no phase or no dir
writes no claim, a compaction-overflow keeps the ladder, a hand-built fact without the wall
flag keeps today's path, the restart pattern only widens. Tier: operating — no Tier I statement
changes.

premises this ruling changes: 0015 (its claim timing — the "as soon as dispatch succeeds"
wording was written against an adapter that resolves at hand-over; opencode's synchronous POST
(0037 D3) made "dispatch succeeds" arrive at turn end, and the claim moves to before the POST,
the failure paths' restores meeting 0015 point 4's concern); 0017 D.1/D6 (overflow's "handled
by the handover mechanism" — the mechanism never existed on this path; D3 routes the wall shape
to a bounded fresh retry and the person, the in-place compaction shape keeping the ladder);
0037 D2 (the never-reject contract's throw reading — a throw out of attempt is now a driver
fault by definition, no residual adapter-throw class existing today); 0061's T-057 move note
(the "pure code, reproducing today's branch order" claim — the move broke the literals, the
oracle had pinned Node's face; D4 restores and widens). Re-readings: 0069's fork criterion
stands unfiltered (the first draft's usage-against-window filter is withdrawn inside this same
change — 0069's pinned subtask shape, a transient fault's oversized session, is still the
round's asset; the overflow exclusion is the overflow arm's own act, overflowedToBlank dropping
the failed record); 0055 §4.5's late step-up stands (an overflow compacted in place keeps the
ladder — facts.overflowed false); 0057's wait-and-probe loop stands for its transient classes;
0018's Scene 2 recovery now holds under the default adapter (the claim precedes the POST).

## Category scope (0123 D1's discipline)

Family: *the session-driving loop's fault classes and claim timing*. Home-set:
`src/session.ts` (the catch's driver-fault throw; the executor's overflow-fresh/block steps;
the overflowed fact), `src/attempt.ts` (the claim before the POST; the dispatch-failure
branch's prior-restore), `src/engine/ladder.ts` (the overflow arm; LadderFacts.overflowed;
NETWORK_FAILURE), `src/chain-transitions.ts` (overflowedToBlank — the one home of the chain
write, the chain-writes ratchet's surface), `test/fixtures/agent.ts` (the turn-end resolution
option), `test/session.test.ts`, `test/ladder.test.ts`, `test/agent-fake.test.ts` (the pins).
Vocabulary: the Step union grows two kinds (overflow-fresh, block — in-process, both executor
arms in the same change); NETWORK_FAILURE grows additively (the restored literals plus Bun's
faces); the blocked question strings are teaching lines, no persisted literal changes.

## D1 — a throw out of attempt is a driver fault and stops the run

The agent domain's calls never reject (0037 D2; the opencode adapter additionally catches its
own rejections at the client seam), so what propagates out of attempt is driver code — local
I/O under .auto/, the sideband, a concern bug. runSession's catch rethrows it as a named
driver fault ("not a session fault — the run stops rather than retry a deterministic local
failure"), like AgentStartError, instead of wrapping it as a transient session error: the old
path's wait-and-probe probe is phase-less (it writes no record and skips the throwing path),
so it answered "recovered" and the loop re-dispatched the whole task into the same throw
forever — with the default ladder and a 30-minute recovery wait, six full sessions per 45
minutes, each executing the whole prompt and discarding the result, the person never the
terminal. No residual adapter-throw class exists today; a future one is tagged at the adapter
(a typed transport error) and retried only there — recorded, not built (P21).

## D2 — the in-flight claim precedes the POST

attempt writes the active record (remember) before sending the prompt POST, beside the stats
segment open: the session id is known once create/fork returned, and opencode's synchronous
POST resolves only at turn end (0037 D3) — claiming after it left every mid-turn kill (a
double Ctrl+C, a crash, an OOM, the host reaper) on the stage's active:false record, so the
re-run's start gate blocked with the manual "commit or clean" teaching and the killed session
was never reused (0018's Scene 2 recurring on the default adapter; every test of the claim had
used the fake, whose prompt resolves at hand-over). 0015 point 4's concern — a claimed session
that never received the prompt — is met by the failure paths' restores: the dispatch-failure
branch now puts the pre-dispatch snapshot (prior) back (as the retryable-error close-out
always did), and the post-turn refresh stands unchanged. The fake gains resolve: "turn-end"
(the POST released only after the turn's events are delivered — opencode's shape), and the
claim pin reads the record from inside the turn.

## D3 — overflow at the wall never forks: one fresh retry, then the person

The overflow class is split by a fact the executor computes at the seam: overflowed — the
failed session's usage reached the run's context window (the wall shape, attempt having
recorded the failed session with its usage before returning). At the wall, the ladder's
overflow arm answers one fresh non-forked retry (overflowedToBlank: the chain keeps neither
the id nor the failed record — the overflowed context is never a fork source, unlike the
failover fallback's deliberate keep), and a second overflow is the person's blocked terminal
teaching the split (smaller units, or a handover document). Without the wall flag — an
overflow the agent compacted away in place (usage back under the window, the 0055 §4.5
late-step-up shape) — the ladder keeps today's path, its fork still the round's asset. The
first draft's forkSources window filter is withdrawn inside this change: it would have
excluded the transient fault's oversized session 0069 pinned as the subtask shape; the
exclusion is the overflow arm's own act instead, and forkSources stands unfiltered.

## D4 — the restart pattern matches what Bun throws

NETWORK_FAILURE restores the two literals the T-057 move broke (econnrefused, econnreset) and
adds Bun's measured faces (unable to connect — fetch's ConnectionRefused wording; socket
connection was closed unexpectedly — ECONNRESET; connectionrefused): a dead managed opencode
server now restarts before the retry instead of the run polling the wait-and-probe loop
forever (the probe itself never restarts a host — named residual). The ladder test's oracle is
pinned to the measured faces (the old oracle had pinned Node's undici wording, which is why
the broken move passed green).

## Residuals

- awaitRecovery's probe never restarts a managed host whose death lands mid-wait (the entry
  retry now restarts it; the wait-side death waits out the interval — no measured demand for
  the probe-side restart, P21).
- No typed adapter-transport error exists (no adapter throws today); a future throwing
  adapter tags its class at the adapter and retries only that.
- The overflow block's remedy teaches the split; a prompt legitimately larger than the window
  (a huge single acceptance input) is the person's planning error, surfaced not worked around.
- The step-up concern's own overflow reaction (a registry with steps) is S14-02's row
  (step 027); this ruling's wall fact feeds it nothing.

## Tests

- session.test.ts: the driver-fault pin (a read-only .auto/ — the finding's own repro shape —
  rejects runSession naming the driver fault, zero prompts, zero probes; fail-before: the old
  catch-all loops); the claim pin (resolve: "turn-end", the turn reading the already-active
  record claiming its session; fail-before: the stale record mid-turn); the overflow pin (two
  dispatches, never a fork, the blocked terminal teaching the split; fail-before: the fork
  ladder).
- ladder.test.ts: the wall arm's decision rows (first overflow-fresh, second block, the
  retryability indifference) and the in-place-compaction row keeping the ladder; the network
  oracle over the measured Bun faces and the restored literals (fail-before: the four faces
  answer restartServer false).
- agent-fake.test.ts: the 0055 §4.5 compaction pin still green (the wall fact false on 30k of
  a 100k window).

# 0186 — The ask channel's closed-input truth, the managed host's one-in-flight restart, and the session-driving hygiene trio

Status: **active**. Ruled 2026-11-06 by 0166 step 026 (wave W-session), enacting 0165-116
(S13-02, S3, CONFIRMED — askHuman with no timeout never returns on a closed or non-readable
stdin: readline's question promise stays pending, so a plan run without a terminal waits forever
and every later ask queues behind the dead one), 0165-117 (S13-05, S3, CONFIRMED — concurrent
restarts of one managed host double-spawn and leak a server: two callers in the same window each
close-and-spawn, the loser's instance live and unreferenced for the rest of the run), and
0165-196 (S13-07, S4, CONFIRMED — session-driving hygiene: ensureForkBase's header claims a
verified-clean ctxbase turn no check performs and its digest dispatch drops the caller's
switches snapshot; toBlankSession's comment claims the usage counters reset while `used` is
kept; the probe catch's comments cite SDK rejections 0037 D2 rules out).

## Derives

Derives: P12 — fail loud, conservative under uncertainty: a closed input channel's honest
answer is "no human is there", never an eternal pending promise (D1); a comment that states a
check that does not exist is a lie the next maintainer plans around (D3). P17 — one sole
writer: the managed host's restart is one act at a time, a joiner sharing its result instead of
a second writer spawning beside it (D2). P8 — every surfaced line teaches its remedy (the join
line names what it joined). P10 — every floor: a readable stdin keeps today's wait, an external
server keeps its refusal, a sequential restart starts fresh, the interactive path unchanged.
Tier: operating — no Tier I statement changes.

premises this ruling changes: none. Re-readings: 0037 D2 stands (the probe catch's comment now
states the contract-violating shape instead of citing ruled-out SDK rejections — and the
catch's BEHAVIOR stands as 0069 §2.4 ruled it: the probe's one tiny prompt re-run each interval
is the bounded cost of riding the wait, deliberately unlike the task-dispatch catch where 0185
D1 stops the run; a first draft of this step rethrowing driver faults at the probe door was
withdrawn on that reading); 0055 §8.4's digest rebuild stands with its snapshot threaded (the
dropped switches argument was the defect, the remedy's own first clause); 0149's ask queue
stands (the closed channel no longer poisons it); 0178's sibling gate stands (the in-flight
join is the per-host half beneath it).

## Category scope (0123 D1's discipline)

Family: *the human-ask channel, the managed host's restart, and the session-driving surfaces'
comment/code truth*. Home-set: `src/session-api.ts` (stdinAsk's close resolution and
non-readable floor), `src/agent/opencode/server.ts` (restart's in-flight promise),
`src/session.ts` (ensureForkBase's switches pass-through and header; the probe catch's comment;
the awaitRecovery header's phrase), `src/chain-transitions.ts` (toBlankSession's comment),
`test/session-api.test.ts`, `test/agent-server.test.ts`, `test/agent-fake.test.ts` (the
switches pin, the fixture's b-turn widening). Vocabulary: none changed — the join log line is a
teaching line; askHuman's return contract is unchanged (undefined's meaning now reachable).

## D1 — a closed input channel answers undefined

stdinAsk with no timeout resolves undefined on the readline interface's close event (readline's
question promise never settles at EOF) and returns undefined at once when stdin is not
readable: a run driven without a terminal (a script, nohup, the person-proxy session's shell
tool) falls back to autoAnswer()'s proxy instead of hanging on the first ask with every later
ask queued behind the dead one. The interactive path and the timed path are unchanged (the
timer always bounded them); undefined's documented meaning — "the input channel closed" — is
now reachable on the no-timeout path too.

## D2 — one in-flight restart per managed host

manage's restart keeps one in-flight promise: a caller arriving while a restart runs joins it
(logging that it joined) instead of spawning beside it — under doc lanes a correlated network
blip puts two lanes' restartServer retries in the same window, and two spawns over one project
store leak a server (live, unreferenced, holding its port) for the rest of the run, with any
proxied call in the window landing on the abandoned instance. A restart completing clears the
promise (the next restart may carry a new config); an external server keeps its refusal. The
pool-level sibling gate (restart-under-live-siblings) rides 0178's landed deferral — this is
the per-host half beneath it.

## D3 — the hygiene trio: the snapshot threaded, the claims made true

ensureForkBase threads the caller's switches snapshot into the digest rebuild's runSession
dispatch (the rebuild is a session dispatch like any other; the dropped argument fell to the
environment's re-parse — a test injecting switches into runTask got the ambient minute-scale
ladder over the injected one), and its header stops claiming a verified-clean ctxbase turn: the
turn is a reading prompt expected to change nothing, but no check enforces that — an agent that
edits files there surfaces at the next unit's clean gate as leftover dirt, the person's to
judge. toBlankSession's comment states the real reset (the percentage resets; `used`, the
cumulative figure the ◉ lines and the /exit keeper read, is kept deliberately). The probe
catch's comment and awaitRecovery's header state the contract truth: a throw there is a
contract-violating transport throw or driver code, kept waiting by 0069 §2.4's ruled posture
(deliberately unlike the task-dispatch catch, 0185 D1) — the SDK-rejection wording is gone. A
first draft of this ruling extended 0185 D1's rethrow to the probe door and was withdrawn: it
would have silently amended 0069 §2.4's measured compensation ruling (the S5 incident) on a
hygiene finding's inference.

## Residuals

- A deterministic driver fault during a probe still cycles the wait (0069 §2.4's standing
  posture; the probe's one tiny prompt per interval is the bounded cost — a measured incident
  re-opens it, the comment names the question).
- The restart-under-live-siblings gate rides 0178's deferral (the doc-lane walk skips restart
  whole); a non-walk restart beside live sibling sessions keeps today's shape.
- The closed-stdin floor answers at once only when the channel is already non-readable; a
  readable-but-silent channel (a held-open pipe) still waits — that is a human who may yet
  answer.

## Tests

- session-api.test.ts: the closed-stdin child (an ignored stdin, the marker printed —
  fail-before: the child hangs, the bounded runner times out).
- agent-server.test.ts: the two-caller restart joins (one spawn beside the initial, both true,
  the url the one new instance; fail-before: three spawns).
- agent-fake.test.ts: the digest rebuild under an injected zero-wait ladder riding a retryable
  failure while the ambient parse waits 90 minutes (fail-before: the dropped snapshot falls to
  the ambient parse and the bounded runner times out).

# 0157 — the engine/agent lifecycle edges: one human-answer channel under concurrency, drained shutdowns, the connect-only bin floor, and the emission boundary

Ruled from the 2026-10-30 three-package review of the auto tool family (the engine and
agent-lifecycle layers walked end to end asking where a shared channel, a shutdown, or a
queued microtask could lose work the design had promised; every finding verified against
HEAD 9597a19aa before the change — the sixth wave of that review, beside 0155's git layer
and 0156's loop/execute composition).

## The measurement (the review's file:line findings, each re-verified)

- **The sideband's "never happens in the normal flow" became the normal flow.**
  `interactive.ts` `question()` answered `undefined` at once when re-entered — written when
  one process asked one question at a time. Doc lanes (plans/0099) run several lanes'
  sessions through the one process, every lane's session opts carrying the same sideband
  (`src/opts.ts`: `interactive: ctx.repl` on every site), so two lanes asking inside one
  window under `--wait-answer N > 0` made the second ask resolve immediately — the driver
  proxy-answered a question the human never saw, and `src/engine/concerns/questions.ts`
  journaled the settlement as `"timeout"` (`human === undefined` is its timeout branch),
  a timeout that never ran.
- **The pool's close raced an in-flight lazy start.** `agent-pool.ts` `close()` closed the
  started hosts and cleared the map, but neither awaited nor cancelled the `starting`
  entries: a factory resolving after close registered its host into the freshly cleared
  map (`hosts.set; started.push`) and nothing ever called that host's `close()` — a leaked
  `opencode serve` child. A `hostOf` during the drain could also start a fresh host after
  close. The window is narrow (real callers await starts before close), but the shutdown
  path had no guard at all.
- **Preflight demanded the opencode CLI for servers it would only ever connect to.**
  `checkAgentBins` ran `<bin> --version` for every dispatch profile with no skip for
  `profile.server !== undefined` — and the preflight caller passed no `--server` fact
  either — so the documented external-server setup (a profile with `server`, or the run's
  `--server`/`OPENCODE_AUTO_SERVER` override) failed as "`opencode --version` failed" on a
  machine without the CLI: a false exit 1 for a run that never spawns.
- **The version-check child inherited the driver's environment whole.** Both real agent
  spawns scrub the driver's `OPENCODE_AUTO_*` variables (0059 X1: `serverEnv`,
  `claudeEnv`); the `<bin> --version` child — the agent's own executable — ran over
  `{ ...process.env }` with no scrub. Substance harmless (a `--version` child reads
  nothing), letter-level X1 inconsistency.
- **`spawnOpencodeServer`'s 100 ms grace timer was neither cleared nor unref'd, and the
  exit handler stayed armed for the server's whole life.** The race fix itself (the
  rejection held until both output streams close or 100 ms) is sound; the hygiene was
  not: the streams-close branch left the timer running, the timer pinned the event loop
  for its duration, and a *successful* start left the `proc.on("exit")` handler armed —
  so the normal `close()` at run end also armed the grace and attached `once("close")`
  listeners before rejecting an already-settled promise (no-ops). Contrast the file's own
  `timer.unref?.()` idiom ten lines up.
- **The spine enforced `finished` at accept time only.** An emission accepted just before
  the turn's last external settle could still execute its `runRow` during the wrapper's
  `finally` await or the finalize procedure — after `settledBy()` had fixed the settle.
  Landing before: the held settle correctly won. Landing after: silently dropped, its
  row's side effects (slice writes, journal inputs) still run — including a
  classifier-answer raise, whose owed `fx.abort()` (the still-running old server turn,
  the concurrent-writes guard) lives only in the recovery finalize's
  `settle === raisedSettle` branch.

## D1 — the ask queue: one channel, one window per ask, honest settlements

`interactive.ts` `question()` queues: a second ask while one pends joins a FIFO, and when
the current ask settles (answer, its own timeout, or close) the next dequeues into its own
window — prompt shown then, timer armed **then**. Settlement honesty is the point (P13:
no new vocabulary word joins `QUESTION_SETTLEMENTS`): `"timeout"` now records only an
ask's own timer expiring, never the channel being busy; the driver fallback in
questions.ts and its settlement wording are untouched. The hard wait (minutes omitted,
the step-mode pause) composes conservatively: a queued ask behind a hard wait waits until
that hard wait settles by input or close — the line is one resource and FIFO order is
kept, stated here as the honest composition rather than capped. `close()` settles the
pending ask and drains the queue (`undefined` each); a question after close answers
`undefined` at once as before. The non-sideband fallback (`askHuman`'s own-readline
branch, reachable by unattended doc-lane runs with `--wait-answer` and no sideband — two
readlines over one stdin would both take the same typed line) serializes the same way: a
module-level FIFO chain in `src/session-api.ts`, the second readline created only when
the first settles, single-ask flows byte-identical.

## D2 — the pool's close drains: the late host closes itself, a start after close fails loudly

The registry pool's `close()` is the drain point: it marks the pool closed, awaits the
starts still in flight (`Promise.allSettled` — a failed start's rejection already
travelled to its caller), then closes every registered host and drops both maps; it
answers a promise so an awaiting caller (`probeModels`, tests) knows every host this pool
started is closed, while fire-and-forget callers (the run's finally, the force-exit path
with its own backstop) stay correct unchanged. The leak's fix is not the await but the
**start body's own post-factory guard**: a factory resolving past close closes its host
and fails the start with `AgentStartError` — deterministic whether or not anyone awaits
close, and airtight against the guard→register stretch being atomic. `hostOf` after
close rejects loudly (`AgentStartError`, the pool's existing failure shape): no fresh
server nothing will close.

## D3 — the connect-only bin floor: no local binary demanded for a server the driver only dials

`checkAgentBins` skips a profile that only ever connects: its own declared `server`
field, and — passed down by the preflight caller as `opts.server`, combined inside with
`OPENCODE_AUTO_SERVER` exactly as `startPool` combines them — the run-wide override over
every opencode profile (claude profiles always spawn, always checked). AGENTS.md records
the CLI dependency for the spawning modes; this ruling adds the other half: the
connect-only profile's floor is that no local binary is demanded.

## D4 — the version-check child scrubs with the letter

The one driver-domain child that *is* the agent's executable runs under the same X1
scrub its spawns follow: `scrubDriverEnv` (the plain predicate-and-copy over
`process.env`, the adapters' env builders keeping their own richer shapes) applied before
the profile overlay — which still comes last, so a profile that sets a driver variable
explicitly still gets it. The helper lives in `src/agent/env.ts` with the predicate and
reaches the pool through the opencode entry's re-export — the D8-legal crossing
(`test/import-direction.test.ts`'s entry list is the ratchet; the pool never imports the
domain's interior directly).

## D5 — the grace timer's hygiene: bounded, cleared, unref'd, and inert past a successful start

The race fix's behavior is unchanged; its edges are closed: the grace handle is held and
cleared when the streams-close branch wins; the timer is unref'd so even the losing
branch never pins the process for its 100 ms; and the exit handler returns at once once
`resolved` — a started server's later exit (the normal `close()` at run end) arms
nothing. The adversarial case the fix lacked is now pinned: a detached grandchild holding
the output pipes past the child's exit (the streams branch can never win) still rejects
grace-bounded, with the output collected. The clear/unref/inert halves have no observable
seam at the spawn boundary — an artificial export for an internal timer handle would be
machinery without a consumer (P21) — they are pinned by construction and named here.

## D6 — the emission boundary: post-finish emissions dropped at execution time, whole

The `finished` check now also guards **inside** the emission chain, before the queued
emission's `runRow` runs. An emission whose slot executes past the wrapper's finish is
dropped whole — no row, no slice write, no journal input, no settle — instead of running
its side effects and silently losing its settle. An emission landing **before** the
boundary still wins exactly as before (the held settle preempts; pinned beside). The
owed-abort composition, worked through: every settle a raise can land beside either
already made the raise's effect or precludes the raise — an error settle aborted inline
in its handler (the retry cell), an interrupted settle aborts in the liveness finalize
(table order: liveness before recovery), a blocked settle aborted in the questions
handler, and a natural settle implies model output (the failure slice is no longer
`retrying` — the raise's own condition is false). Dropping the row therefore never
orphans an abort the settle owed.

## The floors

- Single-ask flows byte-identical (D1): the queue is empty, the sideband's window and
  timer arithmetic unchanged; the fallback branch's first ask runs ungated.
- One ask at a time under lanes' happy paths (D2): no start in flight at close, the
  drain settles at once; `startedAgents()` keeps its meaning (start order, closed
  included).
- Spawn-checked profiles unchanged (D3): a profile without `server` under no override is
  checked exactly as before, claude profiles always.
- The spawn error paths unchanged (D5): the timeout, unparsable-line and ENOENT errors,
  and the streams-close branch's message, all byte-identical; only the losing branch's
  timer and the post-start exit handler's no-op work are gone.
- The pre-boundary raise still wins (D6): the emission slot that runs before the wrapper
  finishes sets `held` and preempts as it always did.

## The named residuals

- A queued ask behind a hard wait waits indefinitely (D1's stated composition) — reached
  only when a step-mode pause and a concurrent ask coincide in one process.
- The blocked settle whose steer dispatch failed (the length-continuation path) carries
  no inline abort (D6): a raise dropped beside it would in principle have owed one, but
  the shape requires a retry signal after the truncating step-finish and before the idle
  — the analysis reads it as unreachable, recorded here rather than guarded.
- The probe sessions retargeting the interactive sideband (`src/attempt.ts` attaches it
  for every dispatch incl. probes) — harmless, standing observation from the same
  review, no change.
- The claude adapter's unbounded `await live.done` on the model-change path — deferred,
  needs its own P20-ceiling ruling; no consumer has demanded it.

Derives: **P2** (the person brackets every boundary — the showing: D1's contended
question now reaches the human, each ask its own window, the proxy answer and the false
"timeout" journal both gone), **P20** (in-flight work is never destroyed — the showing:
D2's late host closed rather than leaked, D5's shutdown no longer pinned by a dead
timer's 100 ms, D6's queued emission dropped whole instead of half-executed past the
boundary its settle missed), **P14** (one-way dependencies through declared seams — the
show: D3's connect-only fact rides the caller's own `opts.server` rather than a re-read
of the world, D4's scrub reaches the pool through the entry's re-export, the D8 ratchet
unbroken), **P13** (frozen additive-only vocabularies — the showing: D1 adds no
settlement word, the queue speaking through the existing three; D2's
`AgentStartError` an existing shape with new messages), **P10** (the byte-identical
floor — the showing: every mechanism's empty case above, single asks, happy-path
closes, spawn-checked profiles, the unchanged race fix, the pre-boundary raise).
Tier touched: **mechanism** — core (`src/interactive.ts`, `src/session-api.ts`,
`src/agent-pool.ts`, `src/agent/env.ts`, `src/agent/opencode/server.ts`,
`src/engine/spine.ts`, `src/loop-preflight.ts`, `src/format.ts`).

Hygiene in the same change: `src/routing.ts`'s mangled fused comment ("every model's//
agent"), `docs/structure.md`'s chain-transitions row still naming the retired
`modelOfChain` (left with the env-policy path, per the file's own header),
`src/stuck.ts`'s pointer to the watch hook's pre-engine home (`src/runner.ts` — the
concern lives in `src/engine/concerns/stuck.ts`), `test/import-direction.test.ts`'s
comment repeating the same stale name, and `src/format.ts`'s `formatClientError` whose
`: string` could see `JSON.stringify(undefined)` → undefined on the (today unreachable)
unserializable edge — `?? String(error)` keeps the contract honest.

Tests: `test/interactive.test.ts` — the ask queue describe (the FIFO order with each ask
its own window; the dequeued ask's timeout its own — timer armed at dequeue, observed
with a fractional-minute window; the hard-wait composition; close's drain and the
post-close ask); `test/agent-pool.test.ts` — the close-drain scene (a gated factory
resolving after close: the late host closed, `startedAgents` empty, the in-flight
dispatch rejected, `hostOf`-after-close loud; the standing closed-hosts test now awaits
the async drain), the connect-only bin floor (the declared `server` and the `--server`
override skipping, the spawning profile still checked), and the X1 scrub (a probe bin
failing on sight of the driver's variable, the overlay still landing);
`test/agent-server.test.ts` — the detached-grandchild exit (rejection grace-bounded,
output collected); `test/turn-arbitration.test.ts` — the emission-boundary describe
(the pre-boundary raise still winning; the finalize-window emission dropped at execution
time — its row never runs, the natural settle kept), the drop verified to fail against
the accept-time-only guard.

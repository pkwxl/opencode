# 0071 — The boundary-UX standing track: charter

Status: **chartered, 2026-10-03 — by ruling P-4 of
[0070](./0070-driver-docs-governance-and-round-transition.md) §5.1** (ruled as
recommended: charter the standing track, sanctioning its core seams, rather than
folding them under auto-server's ownership). Executed as unit U-P4 of the R-02
program's Stage C (target `plans/0015-r-02-program.md`). Grounded in
[0064](./0064-positioning-alignment.md) §3 T3 and §5 item 3 (the track's origin:
boundary UX as a first-class track beside the engine, consumers over RunEvent,
not shell afterthoughts), the boundary-UX row of
[0069](./0069-system-review.md) §3.2 and its §6 item 3 (the decide this charter
resolves), and the landed surfaces —
[0067](./0067-opencode-auto-headless-service-evolution.md) §8 P2a/P2b/P3a and
[0068](./0068-parallel-execution-lanes-design.md) §13 S4. Documentation only:
this charter changes no code; it sanctions what landed and rules where future
boundary-UX work lands.

## 0. What this document is (the maintenance rule)

Boundary UX is 0064 T3's name for where human attention is actually spent:
exit-2 blocked items, question policy, `close` decisions, plan approval —
surfaces that today exist as terminal text and exit codes, and that the track
grows into whatever consumers over the event substrate build. This charter
founds that standing track: it names the core seams the track owns (§1),
sanctions their place in core (§2), fixes what the consumer — auto-server — may
rely on (§3), and rules where each piece of future work lands (§4).

**This is a standing document, not a stage-assist one.** The plans/ default
(this package's AGENTS.md two-tier convention) is that a numbered document
supports one stage, retires once obsolete, and is never maintained to track
later changes. P-4's charter ruling sanctions the exception: this document is
the track's implementation-record-style home, in the append pattern of 0067 §8
and 0069 §8 — **scope decisions and contract changes append here as the track
grows**, as dated records made in the same change as the code they describe;
nothing already written is rewritten except where an appended record explicitly
supersedes it. The charter retires only with the track itself, and then by a
final dated record saying so. Concretely: a new seam joins §1's table, a
vocabulary growth appends its record to §3, a landing-rule refinement appends to
§4 — each entry dated, none silently edited.

## 1. Scope — the five core seams the track owns

| # | seam | what it is |
|---|---|---|
| 1 | `src/run-status-schema.ts` | the run-status event table (0067 P2a; the four lane events per 0068 S4): the frozen, additive-only `RunStatusEvent` vocabulary and its declaration tables — imports nothing, emits nothing, binds no behavior |
| 2 | `src/run-status.ts` | the emitter (0067 P2b): setter-injected in-process sinks beside the journal writer; `emitStatus` stamps `run`/`at`/seq centrally, wired additively at the driver's narrative points |
| 3 | `.auto/run-status.jsonl` | the driver-status journal the emitter writes: one JSON line per event, append-only within a run, truncated per run start — the file auto-server's `/status-events` channel tails read-only |
| 4 | `src/engine/events.ts` | the `RunEvent` vocabulary (`turn-start / input / fx / fx-result / fx-reject / settle`, 0061 R4/F1) and the engine journal `.auto/run-events.jsonl` it appends — the input log and executed effects of the turn engine; the track owns this seam's boundary-UX face (the vocabulary-stability and tailing obligations of §3), while the engine's own design remains 0061's home |
| 5 | `src/interactive.ts` | the io/Interactive seam (0067 P3a): `InteractiveOption` (boolean / injected `Interactive` / io factory), accepted as `RunAllOpts.interactive` (`src/loop-preflight.ts`) on the 3-method `Interactive` leaf interface of `src/control-types.ts`, resolved once by `interactiveChannel` where the loop starts the channel (`src/loop.ts`) — the channel every human-interaction route (askHuman's wait, the between-tasks pause, the step pauses) already threads through |

Ownership means: a change to these seams' vocabulary, payloads, or boundary
semantics is a track decision — it lands per §4's rule and appends its record
per §0. The machinery around a seam keeps its own home (the engine spine, the
loops, the questions concern); the track owns the seam, not the module's every
line.

AUTO-DECISION (seam 4's ownership is scoped to its boundary-UX face): the
ruling's scope line names `src/engine/events.ts` as a track seam without
displacing 0061's ownership of the engine design; the charter therefore binds
the track to that seam's consumer-facing obligations (vocabulary stability,
tailing semantics — §3's contract for the `/events` channel) rather than
claiming the engine journal's design whole, so the two documents state one
truth instead of two owners.

## 2. The core-seam sanction — why these live in core, not a shell

0064 §5 item 3 promised boundary UX as "consumers over RunEvent, not core
changes"; 0069 §3.2's boundary-UX row recorded the drift — "core grew
(`run-status.ts`, io/Interactive seam) under a line promising
consumers-not-core". P-4 resolves the tension by splitting the line: **the
substrate is core; the consumers stay outside.** Four grounds:

1. **They are state-file protocol and run machinery — the core's half of the
   shell contract's own decision rule** (`docs/shell-contract.md` §A: session
   pipeline, state-file protocol, prompt rendering, acceptance/commit
   mechanisms belong to the core; CLI shape belongs to the shell). The emitter
   is wired into the run's own narrative points — run brackets and failure
   paths (`src/loop.ts`), unit transitions (`src/tasks.ts`), task/subtask
   brackets (`src/loop-task.ts`, `src/runner.ts`), the question lifecycle
   (`src/engine/concerns/questions.ts`), usage roll-ups (`src/stats.ts`),
   `requestExit` (`src/exit.ts`) — none of it reachable from a shell; the
   interactive channel is threaded through `runAll` itself. None of it is CLI
   shape.
2. **They have consumers outside any one shell, and only core is shared.**
   Under the one-way dependency (`docs/shell-contract.md` §B — shells import
   the core; the core never knows shells; shells never import each other),
   code two shells share lives in core and nowhere else. auto-server binds the
   seams as core exports today: `RUN_STATUS_FILE` from `src/run-status.ts` and
   `RUN_STATUS_EVENT_TYPES` from `src/run-status-schema.ts`
   (`packages/auto-server/src/observe.ts`), `RUN_EVENTS_FILE` from
   `src/engine/events.ts` (the `/events` tail), and the WebSocket transport
   injected through `RunAllOpts.interactive` (`packages/auto-server/src/worker.ts`
   with `wsInteractive`, 0067 P3b). A seam homed in auto-server would be
   invisible to the `packages/auto` CLI, and vice versa — and the journals are
   written by the core's own run, not by any shell.
3. **The journal writes are driver-exclusive.** Writes into a target's
   `.auto/` belong to the driver alone — the constitutional line the daemon's
   own guard pins (`packages/auto-server/test/no-target-writes.test.ts`; the
   P3c decision that even the daemon's question journal lives in the daemon's
   data directory, never under `.auto/`). A shell-side emitter could not write
   `.auto/run-status.jsonl` without breaking that fence; only the core's run
   can be the writer, so the writer's vocabulary is a core decision.
4. **The track's own measurement depends on it.** 0064 §6's third falsifier —
   boundary interactions clustering somewhere other than the declared
   boundaries — is observable only from a durable event substrate the run
   itself writes. 0064 §3 T3 named RunEvent the substrate and boundary UX a
   first-class track, "not a shell afterthought": that is precisely the
   sanction P-4 grants the seams.

## 3. The consumer contract for auto-server

What auto-server — today the seams' one external consumer — may rely on; any
future consumer binds the same contract. The consumer's own documentation is
the auto-server trail (`packages/auto-server/README.md`, the landed shape at a
glance; `packages/auto-server/docs/daemon.md`, the deep route/gate/status
documentation, observability surface and P2b channel sections); this section
is the core-side half those documents describe.

- **The event-kind vocabulary and its stability.** `RUN_STATUS_EVENT_TYPES`
  (16 types today: the 12 of 0067 P2a plus the four lane events of 0068 S4) is
  frozen **additive-only**: a new event type extends the table and the
  ratchet's shipped list in `test/run-status-schema.test.ts` in one conscious
  change (0068 S4's lane events are the pattern — the table's first growth);
  a name never renames or removes, and the planted-rename ratchet is the
  enforcement. Per-event payload shapes grow the same way: existing fields
  keep their names and meanings, and consumers tolerate new fields (defensive
  parsing — a line that does not parse is skipped, never an error). The three
  vocabularies — `RunStatusEvent`, `AgentEvent` (`src/agent/types.ts`),
  `RunEvent` (`src/engine/events.ts`) — stay pairwise disjoint by event-type
  name (the driver-level failure event is `failure`, never `error`). Join
  keys a consumer may rely on: `run` (the run's start epoch ms, stamped by
  the run-start event and echoed by every event of the run), `at` (epoch ms),
  `unit`/`task`/`subtask` (the qualified unit ids), `session` (the agent
  session id), `lane` (the lane's unit id).
- **The journal semantics.** `.auto/run-status.jsonl` holds exactly the
  current run's events: **append-only within a run, one JSON line per event,
  truncated at each run start** (rotated where the engine journal rotates).
  Writes are synchronous per entry, so every complete line is whole — a
  kill -9'd run leaves complete lines and **no `run-end`**; the missing
  bracket and the stale lock are that story, and the next run's `run-start`
  opens a fresh journal (a shrink is a new run). The 1-based line number
  within the run **is** the event id (the emitter's sequence — the SSE
  cursor's unit). Recording is best-effort: a journal that cannot open does
  not exist, and a write failure is silenced — never a run failure. After the
  run-end bracket the emitter is inert: no event is ever stamped under a dead
  run's id. The engine journal `.auto/run-events.jsonl` follows the same
  mechanics (truncated per run start, `writeSync` per entry, best-effort)
  over the `RunEvent` vocabulary.
- **The observe/SSE mapping.** `GET /projects/<p>/status-events`
  (`statusEventsResponse`, `packages/auto-server/src/observe.ts`) tails the
  journal read-only: every delivered frame is a typed event verbatim and
  carries `id: <n>`, the line's number; a reconnect resumes after its last
  received id through `Last-Event-ID` or `?after=`; a skipped or unparseable
  line still consumes its id, so a cursor never resyncs wrong; a mid-stream
  truncation — or a cursor beyond the file's current lines — re-seeks to line
  1 and says why (`reason: truncated`; the new run-start's `run` key tells
  the story the ids alone cannot); a subscriber more than 256 frames behind
  is dropped with a `dropped` frame and reconnects from its cursor. The
  `/events` channel maps the engine journal the same way (verbatim structured
  payloads, rotation-by-truncation re-seek). **Never log prose**: SSE
  payloads are the typed vocabulary only — the no-scraping rule the schema
  module itself carries; the log's lines are for humans.
- **The read-only line.** The daemon reads these files exactly as it reads
  any `.auto/` state — pure reads, no lock, beside a live run; writes into
  the target's `.auto/` stay driver-exclusive (§2 ground 3). The four bullets
  above are the whole reliance surface; nothing else about the seams'
  internals (poll cadence, file-descriptor mechanics, emission timing beyond
  event order within a run) is contract.
- **Contract-change rule.** A change to anything above is a change to this
  charter: the same change appends its record here (§0's maintenance rule) —
  the charter travels with the vocabulary, or it is not the contract.

## 4. The landing rule — core seams vs shell UX

Where a piece of future boundary-UX work lands is decided by one question:
**does a machine consume it, or does only a human see it?**

- **Core seams** (the five of §1) — changes to event vocabulary or payloads (a
  new event type, a new field), to boundary semantics (how a question settles,
  what an exit boundary may be, how a lane landing is reported), or to
  journal/channel mechanics. These land in `packages/auto-core` on the
  `auto-core` branch (the shell contract's branch model, `docs/shell-contract.md`
  §D), in the same change updating: the pinning tests
  (`test/run-status-schema.test.ts`, `test/run-status.test.ts`,
  `test/interactive-seam.test.ts`), the binding consumer surfaces
  (`packages/auto-server/src/observe.ts` with its tests, among them
  `packages/auto-server/test/status-events.test.ts`), the auto-server trail
  docs — and this charter's appended record. A shell that needs a new seam
  fact (a new event field, a new channel capability) proposes the core change
  first; shells never modify the core, extension points go core-first.
- **Shell UX** — presentation, ergonomics, and surfaces only a human sees:
  blocked-item explainability wording, `close` and plan-review ergonomics,
  prompt text and layout, one-keystroke accept/rework, the Web client's
  rendering. These land in the shells: the `packages/auto` CLI (terminal UX)
  and the auto-server Web client (`packages/auto-server/web/`, bundled to the
  generated `src/web/client.ts`). They consume the seams — the typed events,
  the `Interactive` interface, `RunAllOpts.interactive` — and add no
  vocabulary of their own; the no-scraping rule runs both ways: a shell never
  parses prose for a fact a machine should have been given as data.
- 0069 §5's finding — the core/shell contract has no enforcement leg — is the
  backdrop: this charter is the written line for the boundary-UX face of that
  contract, and its appended records are the audit trail of every crossing.

## 5. Relationship to other documents

- [0064](./0064-positioning-alignment.md) §3 T3 and §5 item 3 — the track's
  origin and posture; the substrate/consumer split this charter
  operationalizes.
- [0069](./0069-system-review.md) §3.2 boundary-UX row and §6 item 3 — the
  decide this charter closes (the alternative, folding the seams under
  auto-server's ownership, considered and rejected by the ruling).
- [0070](./0070-driver-docs-governance-and-round-transition.md) §5.1 P-4 —
  the ruling that chartered the track.
- [0067](./0067-opencode-auto-headless-service-evolution.md) §8 P2a/P2b/P3a
  and [0068](./0068-parallel-execution-lanes-design.md) §13 S4 — the landed
  surfaces' implementation records (what this charter sanctions).
- `docs/shell-contract.md` — the core/shell line this charter's landing rule
  specializes; `packages/auto-server/docs/daemon.md` and
  `packages/auto-server/README.md` — the consumer's own half of the contract.

<!-- auto: eof -->

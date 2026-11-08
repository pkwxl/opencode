# 0224 — the daemon registry's end of life: eviction and the hub's secret, the restored stub's retire, observe's unknown verdict

Status: active-authority (0166 remediation step 064, wave WF-server; findings
0165-168 = S29-02 (S3, CONFIRMED — a restored run whose worker never reconnects
is restored again at every daemon restart, forever; nothing retires it, DELETE
answers 409 with a remedy that touches nothing the daemon views; reproduced by
the record's three-restart probe, the stub each time) and 0165-170 = S29-05
(S3, CONFIRMED — the run registry and the hubs are never evicted: every
terminal run keeps its 8 KiB tail and request for the daemon's life, and its
hub keeps the per-run secret valid, so a terminal run's bridge still upgrades
and journals forged raises; 0160's named deferral "run-registry eviction in a
long-lived daemon", here discharged) and 0165-173 = S30-03 (S3, CONFIRMED —
observe's worktree verdict resolves a git read failure to clean: a directory
whose .git is corrupted so `git status` exits 128 serves `clean` to the web UI)
and 0165-058 = S00-01 (S3, CONFIRMED, TEST — auto-server red at HEAD:
worker.test.ts's usage-vocabulary "malformed requests" case deterministically
exceeds bun's 5 s per-test default; reproduced this session, the late assertion
receiving 143 after the kill).

Four rulings of one family — the served daemon's long life. A daemon process
outlives its runs, and everything it holds for a run must answer when the
run's own evidence ends: the registry entry and its hub (the memory and the
credential), the journal-reconstructed stub (the restart's memory), and the
observer's verdict (the read model's honesty about what git could not say).

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P6** (derived state; recovery is re-derivation): the restored stub was
  state no evidence backs — the journal says a question is open, but the disk
  says no process holds the directory (the run lock stale or absent). The
  daemon's re-derivation at every restart must read BOTH, and the lock is the
  live-process evidence: a worker holds `.auto/run.lock` for its whole run, so
  `liveRunLock(directory) === undefined` (no lock, or a stale holder) means no
  process can ever reconnect to the stub's bridge. Retiring the stub at replay
  is recovery-as-re-derivation, and it is idempotent — a compaction that failed
  leaves the journal intact, and the next restart re-derives the same retire.
- **P12** (uncertain readings resolve conservative; failures surfaced, never
  swallowed into a clean verdict): the finding's observe defect is P12's own
  founding wording ("git command failures being swallowed into a 'clean'
  verdict", 0025 M1) on the one read surface the core's 0155-era repairs never
  reached. A git that cannot report is not a git that reports clean: the
  verdict grows its honest third state. The same principle rules the retire's
  conservative edges — an UNREADABLE lock (`liveRunLock` answering `"unreadable"`)
  keeps the stub (the daemon cannot prove no live run), and only the
  lock-absent-or-stale reading retires.
- **P8** (every surfaced line teaches its remedy): the finding's DELETE taught
  "delete .auto/run.lock by hand" — a remedy that does nothing to the daemon's
  own view, and the only real cure was hand-editing a 0600 journal taught
  nowhere. The DELETE becomes the remedy: once no live process holds the
  directory, it retires the stub (the questions settle `closed`, the journal
  records it, the registry entry and hub drop), and the 409 arm's hint states
  that condition.
- **P5** (single ownership): the registry entry and its hub have one lifetime
  owner — the daemon — and one end-of-life home (this ruling's settle/retire
  seams), not two ad-hoc cleanups; the hub's per-run secret dies with the hub,
  never earlier, never later.
- **P21** (machinery waits for its consumer) and **P19** (measured evidence):
  the eviction bound is a count (the record's own measure — an 8 KiB tail per
  terminal run, unbounded), not an age timer (no consumer asks "runs older than
  X"; the restart already clears everything — "run history does not survive a
  restart", P1's decision 0160 restated); the time-based retire arm the S29-02
  record also names (a bridge that has not connected within N× the worker's
  backoff) is declined — no measured consumer, and the lock already answers the
  question the timer would approximate (0160-era AUTO-DECISION discipline).
- **P13** (frozen additive-only vocabularies): `verdicts.worktree` grows
  `"unknown"` additively (the served JSON shape keeps `clean` and `changed`
  verbatim — a worktree that cannot be read reports `clean: false`, the
  conservative boolean, with the additive `unknown` field naming git's own
  error); the settle/retire journal events reuse the existing `settled`/`closed`
  vocabulary; no run state is added or retires. The web client's types and
  rendering move in the same lockstep.
- **P10** (the byte-identical floor): every readable repository (clean or
  dirty), every live-lock restored run, every daemon restart with a pending
  question behind a live lock, and every non-spawning read surface behave
  byte-identically — the floors are pinned.
- **P18** (the record outlives the tool): the retire is journaled (plain
  JSON-lines in the daemon's data directory), the eviction drops nothing the
  disk does not still hold (a run's truth is its own committed output — the
  registry view was always this process's memory, and "history does not survive
  a restart" was already the documented posture).

## Decisions

### D1 — the restored stub retires on the lock's evidence, at replay and at DELETE (0165-168)

The journal remains the pending set's own record (unchanged); what changes is
that a journal-pending run is restored only when the disk still holds evidence
a worker can reconnect:

- **At replay**: for each run the fold reconstructs, the daemon reads
  `liveRunLock(restored.directory)` BEFORE creating the registry stub.
  `undefined` (no lock file, or a stale holder — its process gone) retires the
  run right there: one `settled`/`closed` journal event per still-open question
  (the same event the run-terminal retire writes, one shape — durable even if
  the compaction that follows cannot write, so the next restart's fold drops
  the run on its own), the run removed from the restored set the compaction
  keeps, no registry entry and no hub created. A live holder — or the
  conservative `"unreadable"` lock — keeps the stub exactly as today: the
  orphan's bridge reconnect (the P3c primary path) still works, and a live
  holder that is not the orphan (a successor run took the directory) defers
  the stub's retire to the next restart whose replay finds the lock gone.
  The finding's immortal shape (a dead worker's stub returning at every
  restart) cannot form: every replay re-derives from the lock.
- **At DELETE**: the restored arm of `deleteRun` re-reads the lock. No live
  holder → the delete IS the retire (the person's in-band remedy): the open
  questions settle `closed` and journal, the hub and registry entry drop, and
  the answer is a 200 carrying the retired view with a note stating exactly
  that. A live holder (or unreadable) keeps today's 409, its hint now teaching
  the real path: stop the holder, then this same DELETE retires the restored
  view — the hand-edited-journal cure the finding found taught nowhere is never
  needed.

Declined (on the record): the time-based retire arm (a bridge that has not
connected within N× the worker's backoff cap) — P21/P19: the lock answers the
same question with live evidence rather than a timer's guess, and the replay
re-check bounds the stub's life to one daemon generation. A worker that is
alive but lock-less is not a scene (the worker holds the lock for its whole
run — the P3c design's own premise).

**Pins**: the record's three-restart probe, inverted (a seeded journal whose
directory holds no live lock: the first replay retires — GET /runs lists
nothing, the journal carries the `closed` settles and compacts to empty, three
start/stop cycles never resurrect it); the live-lock floor (a seeded journal
whose directory holds a live lock: the stub reads `restored`, redelivers its
question — the P3c replay path byte-identical); the DELETE retire (a live-lock
stub: DELETE 409 with the taught hint; the lock gone stale: DELETE 200, the
questions settled `closed` in the journal, GET /runs/<id> 404, a restart
restores nothing).

### D2 — the registry's terminal bound and the hub's lifetime: settle drops the hub, terminals evict past a count (0165-170, 0160's deferral discharged)

0160 deferred "run-registry eviction in a long-lived daemon" with the record
now measuring the cost (an 8 KiB tail and the request per terminal run, for
the daemon's life, plus the hub's live per-run secret). Discharged as one
lifetime rule with two seams:

- **The hub dies with its run.** `settle()` — the one home every terminal
  transition already flows through (the exit observation, the spawn-throw, the
  deleteRun belt) — drops the run's hub after retiring its open questions.
  The per-run secret's lifetime is therefore the run's non-terminal life
  exactly: a terminal run's worker bridge can no longer upgrade (the route's
  existing hub-undefined arm answers the same 401 the unknown secret always
  did — auth stays indistinguishable), so the S29-01 leak's reach ends with
  the run and a forged raise on a dead run's bridge is refused instead of
  journaled. The interactive client endpoint answers a terminal run a plain
  409 stating the channel closed with the run (a state check beside the
  secret compare, as the record asks — implemented as the hub's lifetime, one
  mechanism rather than two compares). Still-connected clients receive the
  `settled`/`closed` frames before the drop (the existing broadcast), and a
  socket that outlives its hub is refused on its next frame ("not in this
  daemon's registry"), never silently routed.
- **Terminal records evict past a count.** `evictTerminalRuns` — a pure
  function over the two maps, exported for its pin, called at the tail of
  every settle — keeps the newest `MAX_TERMINAL_RUNS` (50) terminal records by
  insertion order (the registry's natural start order; a daemon holds one run
  per directory and the common case settles newest-last, so the bound trims
  the oldest first) and removes the rest with their hubs. Live and `restored`
  runs never count (a restored stub is bounded by D1's retire and the real
  pending set behind it, not this bound). A GET on an evicted id answers the
  existing 404 — the same answer a post-restart GET always gave; the run's
  truth lives in its own committed output, never in this process's memory.

The count is an AUTO-DECISION on the record's own measure: 50 terminal runs
bounds the registry's tail memory near half a megabyte while keeping a web
dashboard's page of recent history; an age bound is declined on P21 (no
consumer asks by age — the restart clears all of it, which was always the
documented posture).

**Pins**: the eviction unit pin (55 terminal records over the two maps → the
oldest 5 removed with their hubs, live and restored untouched, under the bound
nothing removed); the hub-death pin (a run settled → its bridge secret no
longer upgrades: the worker route answers 401 with the secret that worked
moments before, the interactive route answers the terminal 409 — the finding's
forged-raise scene refused).

### D3 — observe's verdict grows its honest unknown (0165-173)

`worktreeVerdict` no longer resolves a failed git read to clean. Both failure
arms — `git rev-parse --show-toplevel` failing or naming no toplevel, and
`git status` exiting nonzero (the finding's corrupted-index scene, exit 128) —
report the conservative reading: `clean: false`, `changed: []`, and an
additive `unknown` field carrying git's own stderr line (the error named, not
swallowed; the streams are piped and read rather than ignored). The two arms
are treated alike on purpose: every root `repoRoots` hands this function was
discovered to hold a repository (a `.git` entry, or the target's own
inside-repository placement), so a git that cannot speak about it is an
unreadable repository, never a non-git directory (the S30-03 record's
"non-git-dir may keep clean" carve-out has no reachable scene here — the
no-repository-at-all project never reaches this function, `worktrees: []`,
overall clean, unchanged).

The aggregate follows conservatively: `git.clean` is false whenever any
worktree is unknown, and `verdicts.worktree` grows the additive third state
`"unknown"` — derived as: any worktree with entries → `"dirty"` (a settled
dirty fact outranks an unsettled read), else any unknown → `"unknown"`, else
`"clean"`. Each unknown worktree also pushes one line into
`verdicts.problems` (the root and git's error), so the verdict table carries
the teaching beside the banner. The web client renders the third state in
lockstep (the git panel's `⚠ unknown` row naming the error, the verdict
banner's "git could not report — verdicts unsettled" line) and
`src/web/client.ts` is regenerated (one build, the stale-bundle pin holds).

**Pins**: the finding's scene D (a fixture repository whose `.git/index` is
corrupted so `git status` exits 128 → the worktree verdict `clean: false`,
`unknown` naming the exit, `verdicts.worktree: "unknown"`, the problem line
present — pre-fix: `{clean: true, changed: []}`, verdict "clean", the
finding's observed verbatim); the floor (a readable repository clean and
dirty, a no-repository directory overall clean — byte-identical).

### D4 — the usage-vocabulary split: my half, the "malformed requests" case (0165-058; step 073 owns the frozen-key half, 0165-223)

The S00-01 defect is the test's own structure: one `test()` looping ~40
worker spawns (a full bun child each, ~0.45 s), deterministically past bun's
5 s per-test default — the suite's standing red (the step-050 baseline's
"malformed requests" name is this case, not environment drift). The repair is
the record's own: split, never raise a timeout — a timeout only postpones the
next breach as the vocabulary grows. The case's table splits into per-family
tests (the malformed document and field grammar; the options vocabulary; the
switches carrier; the plan/transfer/lane payload grammars and their
exclusivities), each a handful of spawns well under the budget, every
`[name, request, pattern]` row retained verbatim — coverage identical, the
family growth now grows the TEST COUNT, not one test's runtime. The two
raw-spawn usage forms and the retired-switch pass-through stay with the
document-grammar family they belong to.

The coordination, recorded precisely: the register owns two rows over this
one file's timing health — 0165-058 (S00-01, the "malformed requests" case,
this step) and 0165-223 (S31-03, the frozen-key usage case, ~15 spawns,
step 073, whose row says "with step 064"); the program's conventions note
"step 072 coordinates with step 064" reads as the WB wave's step 073 (step 072
owns the bunfig preload hermeticity, findings 059/063 — no worker.test
repair). This step discharges 058 with the split above and leaves the
frozen-key case untouched for 073 (it passes in-suite today at ~2.7 s alone;
its own split lands there per its row).

**Pin**: the suite's own runtime — the split cases each pass under bun's
default 5 s budget (the pre-fix red is the fail-before: reproduced at HEAD
this session, 13 pass / 1 fail / 1 error with the 143 kill).

## Derivation and Category scope

Derives: **P6** (the retire re-derived from the lock at every replay; the
journal stays a rebuild aid, the settle events idempotent), **P12** (git read
failures surfaced as the unknown verdict, `clean: false` — never swallowed;
the unreadable-lock edge keeps the stub), **P8** (DELETE becomes the taught
remedy; the verdict banner and problem line teach; the terminal 409s state
what closed), **P5** (one settle seam, one retire seam, the hub's lifetime
owned once), **P13** (the `unknown` verdict state additive; the served JSON's
existing fields verbatim; the journal vocabulary reused), **P10** (floors
pinned: readable repos, live-lock restores, non-terminal surfaces), **P19**
(the eviction bound on the record's measured 8 KiB; the timer declined), **P21**
(the count not the age; the time-based retire arm declined), **P18** (the
retire journaled; the registry was always per-process memory beside the
durable record). Amends: none — 0067's P3c letters stand (the journal's fold
and compaction unchanged; the restored state's meaning unchanged for
live-lock runs); 0160's named deferral is discharged by D2 as its own record
intended ("held, untouched — deferred, named" → enacted), which is the
deferral's own mechanism, not a premise flip. premises this ruling changes:
none. Re-read standing: 0222 D1's terminal-run-secret residual (the hub now
drops at settle — the leak's reach ends with the run, the journal's 0600
secret and the same-uid reader stay the v1 posture), 0223 D1's spawn-failed
hub residual (the catch's settle now drops the hub at the throw — the
residual's own named consumer), 0162/0160's restart letters (unchanged — the
restored path's live-lock behavior byte-identical).

Tier: mechanism — the auto-server service shell's daemon registry, observer
and one test file; no core src change (the core's `liveRunLock`, `repoRoots`
consumed as-is).

### Category scope

The registry-end-of-life family, enacted category-complete in one change:

- Code homes: `packages/auto-server/src/daemon.ts` (the replay retire with the
  hoisted journal helpers, deleteRun's restored arm, settle's hub drop, the
  terminal 409 on the interactive route, `MAX_TERMINAL_RUNS` +
  `evictTerminalRuns` called at settle's tail), `packages/auto-server/src/observe.ts`
  (worktreeVerdict's two failure arms → the conservative unknown with the
  error, the aggregate derivation, the problems line), `packages/auto-server/web/api.ts`
  + `web/render.ts` + `web/main.ts` (the `unknown` verdict in lockstep),
  `packages/auto-server/src/web/client.ts` (regenerated bundle).
- Test homes: `packages/auto-server/test/daemon.test.ts` (the retire pins, the
  hub-death and terminal-409 pins, the eviction unit pin), `test/observe.test.ts`
  (the corrupted-repo pin, the floors), `test/question-queue.test.ts` +
  `test/no-target-writes.test.ts` (the same-lockstep fixture repairs: the
  seeded journal's directory now a directory holding a live lock — the seed
  shape was the finding's own immortal scene), `test/worker.test.ts` (the
  malformed-requests split, D4).
- Documentation homes: `packages/auto-server/docs/daemon.md` (the run-view
  section's terminal bound and hub lifetime, the restart-reconstruction
  section's retire rule and DELETE remedy, the status-model section's
  `unknown` verdict), this package's INDEX row. AGENTS.md/structure.md: no
  core or auto file is touched and auto-server has no core-side navigation
  row (step 037's precedent, re-judged standing).

## Residuals

- A live holder that is not the orphan (a successor run on the directory)
  keeps the stub until a restart whose replay finds the lock gone — the stub's
  worst life is one daemon generation, bounded by real runs, never immortal.
- The restored stub of a live-lock orphan whose worker reconnects and then
  exits stays `restored` until the next replay or a DELETE (both now retire
  it); no in-band signal observes the orphan's own exit — the daemon has no
  child to observe (the restored state's documented shape, unchanged).
- The eviction bound counts terminal records only; a daemon serving hundreds
  of CONCURRENT live runs is bounded by the machine, not this rule (the
  one-run-per-directory whitelist is the real bound).
- An evicted run's GET answers the generic 404 (no per-id tombstone — the id
  space is per-process and restart clears it; a tombstone would be new
  per-process state for no consumer, P21).
- The unknown verdict's error text is git's own stderr line, piped and read;
  a git that fails with EMPTY stderr gets the exit-code sentence instead
  (never an empty teaching).
- The frozen-key usage case's own split stays step 073's (0165-223), per the
  register's division; the conventions note's "step 072" reads as 073.
- D4's split keeps every case one spawn per row; a FUTURE family that grows a
  split case past the budget splits again the same way (the rule, not a
  one-time repair).

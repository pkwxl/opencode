# Step 064 — wf-registry-observe: the run registry's end-of-life, the restored stub's retire, observe's unknown verdict, the worker.test usage split

Status: **done** (started 2026-11-08, HEAD 771acbe94; committed 2026-11-09 —
see the program's Current position for the session summary and the commit).

Findings: 0165-058 (S00-01), 0165-168 (S29-02), 0165-170 (S29-05, 0160's deferred
run-registry eviction), 0165-173 (S30-03). Evidence: the register rows plus
plans/0165-review/S00-baseline.md (S00-01), S29-daemon.md (S29-02/S29-05),
S30-server-ops.md (S30-03).

## Plan (written before editing)

1. Ruling 0224 first (next free number after 0223): the daemon's registry
   end-of-life family — the 0160 deferral discharged (eviction + the hub's
   secret lifetime), the restored stub's lock-derived retire (replay + DELETE),
   observe's third verdict state, and the deterministic test repair (my half of
   the worker.test usage split; step 073 owns the frozen-key case, finding
   0165-223 — the conventions note's "step 072" reads as the WB wave's step 073,
   the table's rows authoritative).
2. Enactment in auto-server only (no core src expected): src/daemon.ts,
   src/observe.ts, web/api.ts, web/render.ts, web/main.ts, regenerated
   src/web/client.ts, docs/daemon.md, test splits + pins.
3. Fail-before proofs over /tmp/064-fixed for the src defects; the test
   finding's proof is the deterministic timeout reproduced at HEAD (already
   reproduced this session: worker.test.ts "malformed requests" case fails with
   the 5 s timeout, the late assertion receiving 143).

## Session log

- 2026-11-08 (the interrupted predecessor): step marked `doing`, record
  created. Authoritative inputs read (program, register rows, S00/S29/S30
  records, 0160's deferral, 0223's residual, daemon.ts/
  question-journal.ts/observe.ts/interactive-ws.ts, the seeded-journal test
  harnesses). The 0165-058 defect reproduced at HEAD: `bun test
  test/worker.test.ts` → 13 pass / 1 fail / 1 error, the "malformed requests"
  case timing out at 5 s (bun's 143, the late assertion error `lane not an
  object / Expected: 1 / Received: 143`). Ruling 0224 written whole; daemon.ts
  left carrying D1's replay retire gate with the hoisted journal helpers and
  D2's `MAX_TERMINAL_RUNS` + exported `evictTerminalRuns` (not yet called
  anywhere); auto-server `bun x tsgo --noEmit` exit 0 on that tree.
- 2026-11-09 (this worker, enactment): ruling 0224 read as the design
  authority and enacted exactly. daemon.ts: settle() drops the run's hub after
  the open-question retirement and calls `evictTerminalRuns(runs, hubs)` at its
  tail; deleteRun's restored arm re-reads `liveRunLock` (no live holder → the
  delete IS the retire: one `closed` settle per open question journaled, hub +
  registry entry dropped, 200 with the retired view and its note; live or
  unreadable holder → the 409, the hint now teaching "stop the holder, then
  this same DELETE retires the restored view", the holder named in the body
  when readable); the interactive client endpoint answers a terminal run a
  plain 409 stating the channel closed with the run (before the wide-run
  check). observe.ts: `worktreeVerdict`'s two failure arms (rev-parse/toplevel;
  `git status` nonzero) report `clean: false`, `changed: []` and the additive
  `unknown` field (stderr piped and read, first line; empty stderr → the
  exit-code sentence), `git.clean` false whenever any worktree is unknown,
  `verdicts.worktree` growing the additive `"unknown"` state (entries → dirty,
  else unknown → clean), each unknown worktree one `verdicts.problems` line.
  web/api.ts + web/render.ts + web/main.ts in lockstep (the `⚠ unknown` row
  naming git's error, the "git could not report — verdicts unsettled" banner
  line); `bun run build:web` regenerated src/web/client.ts (83269 bytes, the
  stale-bundle pin green). Pins: daemon.test.ts +4 (the end-of-life suite —
  the three-restart probe inverted, the live-lock floor + DELETE retire
  (holder killed mid-test to go stale), the hub-death (stand-in-worker run,
  the secret from the journal's own `opened` record, the bridge held open
  across the run's exit: the forged raise refused by name and NOT journaled,
  the worker route 401, the interactive 409), the eviction unit); observe.test.ts
  +2 (the corrupted-`.git/index` scene — git's real exit 128 verified on this
  host first, the floors: readable clean/dirty + no-repo overall clean).
  Fixture repairs: question-queue.test.ts + no-target-writes.test.ts — the
  seeded journals' directories now fresh temp dirs holding a live lock (a
  spawned `sleep` holder), the seed shape without one being exactly D1's
  retire scene. worker.test.ts: the malformed-requests case split into five
  per-family tests (document/field grammar + the two raw-spawn forms + the
  retired pass-through; options vocabulary; switches carrier; plan/transfer
  payloads; lane payloads — the ruling's payload family cut at the lane
  boundary by its own budget rule, ~0.15 s/spawn measured, each family
  0.5–2.0 s against the 5 s budget), every `[name, request, pattern]` row
  verbatim, coverage identical; one honest narrowing learned in-change: the
  document family drops the readdir-nothing-written check after the retired
  pass-through case (that case really starts a run — the original never had
  the check there; the four refusal-only families keep it).
- 2026-11-09 (this worker, the in-change discoveries): (1) the full suite's
  first run failed interactive-ws.test.ts's two guard-rail tests — their
  harness waited the probe run out to TERMINAL and asserted hello-with-state
  and the non-websocket 400s on it, exactly the surface D2 closes; reshaped
  the harness to a live stand-in run (the guard rails need the open channel;
  the terminal-side truths are pinned in daemon.test.ts; the stand-in killed
  through the daemon's own DELETE in the finally). (2) INDEX.md carried step
  063's 0223 row DANGLING AFTER the "## Maintaining this index" section
  (committed by 771acbe94) — moved into the table beside 0222 mechanically,
  no content change (step 059's malformed-row precedent), the 0224 row added
  in place.
- 2026-11-09 (this worker, verification): auto-server `bun x tsgo --noEmit`
  exit 0; full suite **168 pass / 1 fail** (the 157/2 baseline + 10 net new −
  the repaired "malformed requests" failure; the one failure "planPrelude
  boundary matrix" by name, the known drift; the observe sawDirty e2e flaked
  once mid-session — passed on re-run and in the final full suite — 0165-220's
  race, step 073's). auto-core `bun typecheck` exit 0; full suite **3213 pass
  / 0 fail** (156 files, the exact baseline; no core source changed — git
  status verified). Fail-before over /tmp/064-fixed (the four changed src
  files + the bundle swapped to `git show HEAD:./`, restored and cmp-verified
  byte-identical): the S29-02 probe reproduced the record verbatim
  (`[["run-000007","restored",false]]` at each of three restarts, journal 2
  lines); the S29-05 probe reproduced the forged raise JOURNALED on a
  completed run, the dead run's secret passing the worker route's auth (the
  400 upgrade-eligible answer, not the 401) and the terminal interactive
  route answering no 409; the unknown-verdict pin red on the finding's
  observed (`clean: true` received where `false` expected — the corrupted
  index's exit 128 confirmed on this host); the daemon pins red at the file
  level (`Export named 'evictTerminalRuns' not found` — step 024's precedent)
  with their behavioral halves carried by the two probes; the
  malformed-requests timeout re-confirmed at HEAD (5001.77 ms, bun's 143
  kill, the HEAD test file run from a temp path then removed); the floors
  green on pre-fix source (the observe floors, the repaired seeded-journal
  fixtures — the lockstep repairs they are).
- 2026-11-09 (this worker, docs + bookkeeping): docs/daemon.md's three
  passages (the run-view section's terminal bound and hub lifetime, the
  restart-reconstruction section's retire rule and DELETE remedy, the status
  model's unknown verdict); INDEX.md's 0224 row (6 cells, the neighbors'
  shape) + the 0223 placement repair; the program's status row 064 → done,
  ledger rows 058/168/170/173 → fixed, Current position rewritten. Committed
  as `0166: step 064 done — ruling 0224 <summary>` over the step-064-owned
  paths only.

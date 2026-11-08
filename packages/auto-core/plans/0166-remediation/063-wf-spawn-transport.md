# Step 063 — wf-spawn-transport: the spawn boundary's three failure shapes

Started 2026-11-08 from HEAD `9e5af04bc` (step 062's commit). Findings: **0165-055**
(S29-10), **0165-169** (S29-03), **0165-172** (S29-09). Record: this file. Ruling:
**plans/0223-server-spawn-boundary.md** (written first, per the worker rules).

Step 062's linkage carried in: 0222 D1 declined the whole-payload request-file arm as
"step 063's own S29-10 linkage" — this step ruled the payload-carriage question
(argv → request file or bounded channel) on its own finding.

## What was ruled (0223)

Derives P12/P8/P6/P10/P13/P19/P21, Tier mechanism; premises changed: none; Category
scope enacted complete (code + test + documentation homes enumerated in the ruling).

- **D1 (0165-055)** — the carriage question ruled: **argv stays, bounded**. The run
  request rides the worker's argv as one JSON token under `REQUEST_BYTE_LIMIT` = 64 KiB
  (`requestTooLarge` in request.ts — byte-honest UTF-8, half the kernel's 128 KiB
  per-string cap). The record's request-file arm declined on P19/P21 (no measured
  consumer over the bound — the finding's 200 KB scene manufactured; the arm's blast
  radius: the hand-spawn contract, the transfer self-spawn, the lane launcher, every
  spawning test, plus a new daemon-owned request-file lifecycle); the env carriage
  rejected with it (an env string sits under the same per-string cap). Enforced at both
  homes that build the token: `startRun` serializes and refuses a **400** with the
  teaching (the CLI's `plan -p` the in-process channel; the plan/transfer spawned routes
  converting the same RequestError to their own 400s) BEFORE any registry entry, hub or
  journal line exists; the worker entry refuses a hand-spawned token with the shared
  text. The throw itself healed beside it: `spawnWorker`'s try/catch settles a throwing
  spawn **failed/code-null** through terminalOf's existing default arm with the cause in
  the tail, then rethrows a `SpawnError` naming the run — POST /runs answers a **500**
  naming the cause with the settled run view (E2BIG appended its direction: the payload
  is bounded, so it points at the daemon's inherited environment). `deleteRun`'s belt
  settles a processless `starting` record with an honest note instead of the lying 202.
- **D2 (0165-169)** — `connectHost` (daemon.ts, exported) formats every URL the daemon
  hands out: an IPv6 literal bracketed, the wildcards mapped to the loopback they cover
  (`0.0.0.0`→`127.0.0.1`, `::`→`::1` — a connect-back address is not a bind address).
  Both sites — the bridge transport URL and the handle's own URL (the serve banner reads
  it); the bind, `handle.hostname` and the registry untouched.
- **D3 (0165-172)** — serve `--launch` resolves at the entry (against the serve
  command's working directory — one truth for the source/compiled layouts whose
  spawn-cwd disagreement was the finding) and refuses exit 1 a path that is not a
  readable file, naming the resolved absolute; the daemon resolves its copy once at
  `startDaemon` so the spawn never re-resolves. The 0162 launcher seam itself untouched.

## Files (the step's whole footprint)

- Created: ruling `plans/0223-server-spawn-boundary.md`, this record.
- auto-server src: `src/request.ts` (REQUEST_BYTE_LIMIT, requestTooLarge),
  `src/daemon.ts` (connectHost, startRun's serialized payload + pre-registration bound,
  spawnWorker's settle-and-SpawnError + the E2BIG teaching, postRuns's 400/500 catches,
  the ops spawn closures' RequestError arm, deleteRun's no-proc settle, the launch
  resolve at start), `src/worker.ts` (the entry's carriage check), `src/index.ts`
  (serve's --launch resolve + readable-file refusal).
- auto-server docs: `docs/daemon.md` (the bound beside the run-request trust rules, the
  spawn-failure state beside the run-state list, the URL-host formatting note beside the
  bridge carriage paragraph, the launcher resolution in the confinement-launcher
  section).
- auto-server tests: `test/daemon.test.ts` (+4: the ENOENT wedge heal, the bound 400,
  the ::1 transport e2e, the connectHost unit), `test/worker.test.ts` (+2: the bound's
  unit, the hand-spawned entry refusal), `test/cli.test.ts` (+2: the --launch refusal,
  the absolute-path floor).
- Core: `plans/INDEX.md` (the 0223 row). **No core src, no packages/auto file touched**
  (no core mapping changes — AGENTS.md/structure.md judged per step 037's precedent,
  re-judged standing).

## Commands and results

- auto-server `bun x tsgo --noEmit` exit 0. Full suite **157 pass / 2 fail** (the 149/2
  baseline + 8 net new; the two failures the step-050 environment-drift names verbatim —
  "planPrelude boundary matrix" and "malformed requests" at its 5 s timeout).
- auto-core `bun x tsgo --noEmit` exit 0; full suite **3213 pass / 0 fail** (156 files —
  the exact baseline; no core source changed). The auto package not run (no file
  touched).
- Fail-before proof over /tmp/063-fixed (the four changed src files backed up, `git show
  HEAD:./` pre-fix versions swapped in, the probes and pins run, the files restored and
  cmp-verified byte-identical):
  - P1 (the ENOENT wedge, S29-10's second class): `500` generic HTML over
    `registry [["run-000001","starting",true]]`, second POST **409**, DELETE **202**,
    registry still `starting` after it — the finding's scene verbatim;
  - P2 (the E2BIG class, the finding's own 200 KB repro): `E2BIG: argument list too
    long, posix_spawn '/home/wxl/.bun/bin/bun'` + the same wedge;
  - P3 (IPv6): `daemon.url http://::1:<port>`, `fetch() URL is invalid` through the
    handle's own URL, and `parseTransport: transport.url is not a URL: ws://::1:…` —
    the record's observed verbatim (the probe's transport read was cut short by its own
    DELETE killing the stand-in; the one-liner over pre-fix parseTransport completed
    the half);
  - the daemon/worker pins red at the file level (`Export named 'connectHost' not
    found` / `requestTooLarge` — step 024's precedent), their behavioral halves carried
    by the probes;
  - the cli pins red behaviorally: the --launch refusal timing out at the guard kill
    (pre-fix the daemon serves on, nothing fails until the first run), the floor pin's
    banner carrying the relative spelling `bash launch.sh`;
  - after restore: all pins green, both typechecks clean, the full suites at their
    baselines above.

## Residuals (named in the ruling)

The request-file carriage arm stays declined, its trigger named (a measured consumer
needing served run requests over 64 KiB; until then the CLI's in-process `plan -p` is
the channel); the plan input still rides world-readable argv under the bound (content,
not a credential — the register's own line; the deeper carriage declined with D1's arm);
`deleteRun`'s no-proc settle arm is defensive (the wedge fix empties its natural scene);
a spawn-failed run's hub stays in memory until the registry's eviction ruling (S29-05/
0165-170, step 064); an E2BIG from the daemon's inherited environment still possible in
principle (the 500 names it and teaches the direction); the scoped-address URL zone
(`fe80::1%eth0`) unruled; 0222's residuals (the `?token=` query carriage, the same-uid
environ reader, the leaked-secret-first-connect latch) standing unchanged.

## Status

**done** 2026-11-08. All findings dispositioned in the program's ledger: 0165-055 fixed
(ruling 0223 D1), 0165-169 fixed (ruling 0223 D2), 0165-172 fixed (ruling 0223 D3).

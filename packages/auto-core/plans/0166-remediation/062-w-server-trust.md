# Step 062 — w-server-trust: bridge secret off argv, env-only names out of the switches carrier

Started 2026-11-08 from HEAD `be3daccb1` (step 061's commit). Findings: **0165-054** (S29-01),
**0165-171** (S29-06). Record: this file. Ruling: **plans/0222-server-bridge-secret-switch-carrier.md**
(written first, per the worker rules).

## What was ruled (0222)

Derives the **Security family** (both halves its server-side letter), P13, P12, P2, P5, P16, P10,
P19; Tier mechanism; premises changed: none; Category scope enacted complete (code + test +
documentation homes enumerated in the ruling).

- **D1 (0165-054)** — the bridge secret rides the worker's spawn environment as
  `OPENCODE_AUTO_BRIDGE_TOKEN` (defined in request.ts, the shared vocabulary module), never the
  argv payload (world-readable via /proc/<pid>/cmdline). The OPENCODE_AUTO_ prefix rides the
  existing X1 scrub (agent children never inherit it, zero core change). The argv transport
  shrinks to `{run, url}` (a `token` field refused naming where the secret lives); a transport
  payload without the env token is a usage error; the lane launcher strips the name for lane
  children. The bridge is **latched**: a second worker socket while the first is open is refused
  (one error frame + close), the first remaining the bridge — the worker's own reconnect always
  arrives after its predecessor's close. `freshRunSecret`'s false "never stored" comment
  corrected (hub + 0600 journal + spawn env, never argv, never a log line). The whole-payload
  request-file/fd arm declined as step 063's own S29-10 linkage; a non-prefixed env name
  declined (the prefix buys the X1 guarantee through the existing seam).
- **D2 (0165-171)** — `KNOWN_SWITCHES` excludes `SWITCH_ENV.models` and `SWITCH_ENV.server`;
  `parseSwitches` refuses each with its teaching (the operator registry layer's path / the
  external server URL's env form; the operator's channels the XDG config root and the
  confinement launcher's overlay, never a per-run request — 0067 §3 item 2's carrier letter
  restored). `options.server` takes **loopback URLs only** (127.0.0.1, ::1, localhost — the
  v1 single-machine boundary applied to the one field that silently crossed it; the off-host
  channel the launcher's overlay; the serve-flag arm declined on P21; the CLI's --server
  untouched — a terminal is one person's act). The web start form's server hint teaches the
  rule, the bundle regenerated.

## Files (the step's whole footprint)

- Created: ruling `plans/0222-server-bridge-secret-switch-carrier.md`, this record.
- auto-server src: `src/request.ts` (BRIDGE_TOKEN_ENV, parseTransport {run,url},
  KNOWN_SWITCHES's exclusion + the two refusals, parseOptions's loopback rule),
  `src/daemon.ts` (the spawn env carriage, spawnWorker's bridgeSecret param, comments),
  `src/worker.ts` (the env token read + refusal, the payload/AUTO-DECISION docs), 
  `src/interactive-ws.ts` (the latch, the secret's comment truth), `src/profile.ts` (the lane
  launcher strip), `src/index.ts` (USAGE's transport/switches wording).
- auto-server web: `web/render.ts` (the server hint), `src/web/client.ts` (regenerated,
  `bun run build:web`).
- auto-server docs: `docs/daemon.md` (the carriage + latch paragraph beside the worker
  endpoint row, the two trust rules beside the switch table).
- auto-server tests: `test/daemon.test.ts` (+2: the argv/env carriage pin, the 400 pins),
  `test/ws-protocol.test.ts` (+1: the latch pin), `test/worker.test.ts` (+4: the
  trust-boundary suite; one fixture repair — the lane-with-transport case carries no token).
- Core: `plans/INDEX.md` (the 0222 row). **No core src, no packages/auto file touched** (no
  core mapping changes: AGENTS.md/structure.md judged per step 037's precedent — auto-server
  has no core-side navigation or module row).

## Commands and results

- auto-server `bun x tsgo --noEmit` exit 0. Full suite **149 pass / 2 fail** (baseline 142/2
  + 7 net new; the two failures the step-050 environment-drift names verbatim — "planPrelude
  boundary matrix" and "malformed requests" (its 5 s timeout), identical on the pre-fix proof
  run, untouched by the one fixture repair inside it).
- auto-core `bun x tsgo --noEmit` exit 0; full suite **3213 pass / 0 fail** (156 files — the
  exact post-061 baseline; no core source changed).
- Fail-before proof over /tmp/062-fixed (the six changed src files backed up, `git show
  HEAD:./` pre-fix versions swapped in, the pins run, the files restored and cmp-verified
  byte-identical):
  - the carriage pin red with the finding's repro verbatim — the received cmdline carrying
    `"transport":{"run":"run-000001","url":"ws://…","token":"oar_B77WLm1XD1BdbZfqR-F3ct29vdeKBFf_"}`;
  - the 400 pin red (`Expected: 400 / Received: 404` — both names and the off-host server
    sailing past validation to project resolution);
  - the latch pin red at its 5 s timeout (the second socket adopted — the impostor's hello,
    no error frame);
  - the worker suite's trust pins red at the file level (`Export named 'BRIDGE_TOKEN_ENV' not
    found` — step 024's precedent) with the behavioral half carried by the record's own probe
    re-run on pre-fix source: S29-06's observed values verbatim
    (`{"OPENCODE_AUTO_MODELS":"/tmp/anything.json","OPENCODE_AUTO_SERVER":"http://203.0.113.9:4096"}`
    and `"http://203.0.113.9:4096"`).
  - after restore: probe refused on both names, typecheck clean, all pins green.
- Web bundle: `bun run build:web`, the stale-bundle pin green in the suite (web-build tests
  passed in the full run).

## Residuals (named in the ruling)

The same-uid reader (environ + the 0600 journal) stays the v1 single-operator-machine posture;
the `?token=` query carriage on the WS routes (the documented loopback posture); the argv
payload still carrying unbounded client text (S29-10's own class, step 063); the terminal-run
hub keeping its secret valid (S29-05/0165-170, step 064); a leaked-secret holder arriving
while no bridge is open still adopted (the latch bounds the flip-flop, not the first connect).

## Status

**done** 2026-11-08. All findings dispositioned in the program's ledger: 0165-054 fixed
(ruling 0222 D1), 0165-171 fixed (ruling 0222 D2).

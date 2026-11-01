# 0162 — the auto-server phase runs: width served, the confinement launcher, and the shell's own lane children

Ruled from the aster-mig cleanroom's measured field evidence (P19): the
driving agent's harness reaps its background command shells at a fixed
3600-second wall — the reaper walks process trees (cgroup- or
namespace-scoped, not process groups; `nohup`/`setsid` disproven on
2026-10-30, `docs/playbook-fork-run-compare.md` §§77-90) — so every
`opencode-auto run` invocation dies with its shell and the standardized
playbook (`/workspace/aster-mig-root/cleanroom/docs/playbook-standard-execution.md`
§4.3) chains one `--stop-after T-NNN` segment per hour. The daemon is the
right vehicle: runs live in the daemon's worker children and the operator's
interactions become short HTTP calls. What the absorb (plans/0160) left
open, this change closes — the shell owner's width reservation is called,
the runs ride an operator-owned confinement launcher, and every lane child
is a worker of this binary.

## The measurement

- Full-phase serial runs already work on the daemon (0160 D4 threaded
  `stopAfter`/`boundary`/`repair`; the default boundary stop parks at the
  phase's close gate). Three gaps block the playbook's shapes:
  1. the shell's own `maxSessions=1` cap (`src/request.ts`) — the reserved
     call of plans/0069 §6 item 5, never exercised;
  2. the core refuses an interactive channel under width ≥ 2
     (`auto-core src/loop-preflight.ts:448-457`) while the daemon attached
     its WS bridge to **every** run — a wide run would die exit 1 at
     preflight with a message naming `--interactive`;
  3. no `_lane` entry and no `laneLauncher` in the server profile: a
     worktree-lane dispatch orphans (the shell's unknown-command refusal
     exits the child with no lane report), the parent burns the attempts
     cap and blocks — one config key away (`treeLanes: "auto"` is the
     mainline `baseline` project's own value).
- Confinement: every cleanroom session-bearing invocation runs inside
  `bin/sandbox.sh`/`bin/agent-sandbox.sh` (identity-keyed writable
  surfaces; concurrent arms collide on the shared opencode-server storage
  without the keying — the measured 1.4 G shared DB). Daemon workers
  spawned bare escape the workspace's confinement posture entirely.
- Concurrency: the daemon's guards are already per-directory (the registry
  answers 409 for a second live run on one project; the lock 423 against
  any process) — runs on different projects execute in parallel by
  construction, unpinned by any test and untaught by any doc.

## D1 — the width reservation called (the owner's reserved call, exercised)

`options.maxSessions ≥ 2` is accepted. Width activates the core's lane
scheduler exactly as the CLI's `--max-sessions` (width alone since
plans/0125): doc lanes at tier 0, worktree lanes under `treeLanes on|auto`.
The refusal message family the cap carried is retired with the cap; the
width pairs the core itself refuses at run start are surfaced up front by
the shared validator (`stopAfter` + width, `waitAnswer > 0` + width — 400
on POST /runs, the same text as the worker's stderr refusal), per the
shared-validator pattern's own rule (an invalid request never becomes a 202
whose run dies on arrival).

Derives: P13 (the vocabulary grows by conscious lockstep — the cap's
retirement, the new cross-field refusals and the lane grammar below land in
one change with their pins), P21 (the reserved call made when the consumer
arrived — the playbook's pair segment is the consumer), P8 (the width pairs
refused at the cheap bracket, each refusal naming the rule).

## D2 — no interactive transport under width (CLI parity, surfaced)

The daemon attaches no WS bridge to a wide run (`startRun` skips the
transport payload when `maxSessions ≥ 2`): the core's one-channel rule is
the CLI's own width-run shape — a permission question blocks the run (exit
2), the rest take the auto-answer path. The plan and transfer spawns stay
width 1 and keep the bridge (their `humanQuestions` depend on it). The
client endpoint `/runs/<id>/interactive` answers **409** naming the rule
before any upgrade could hang on a socket nothing will speak on, and the
worker logs one width banner stating the question semantics. The hub and
the journal entry exist for every run regardless — uniform lifecycle, and
nothing connects to a wide run's.

Derives: P2/P12 (the no-channel posture stated at every surface — the 202,
the endpoint, the worker's own log — never a silent hang), P10 (width-1
runs byte-identical to before; the skip is keyed on the request's own
width).

## D3 — the shell's own lane children (the profile's `laneLauncher`)

A lane child is a **worker of this binary** carrying a lane payload — the
same self-spawn shape as the `transfer` command (0160 D4) and the machine
shape of the CLI's hidden `_lane` entry:

- the internal `lane` payload grammar (`{ unit, merge? }`, unit `T-NNN` or a
  stream `T-NNN.Snn`) lives in the shared vocabulary module; the worker
  routes it to the core's `runLaneWorker` after the same strict config load
  and banner (the CLI's `_lane` block is the reference — the worktree holds
  the copied scaffolding, config reloaded there); exclusive with
  `plan`/`transfer`/the transport, and the run-side widths ride it no more
  than they ride the stop conditions;
- `POST /runs` refuses a `lane` field the way it refuses `plan` and
  `transfer` — the lane surface is the launcher's private channel, never a
  client's;
- the profile installs `laneLauncher` (the shell-contract §E item 8
  obligation met through the documented override — the default launcher's
  `process.argv[1]` re-invocation cannot answer on a shell whose hidden
  entry is `worker '<json>'`); the worker-command derivation moved to
  `src/worker-command.ts` (the launcher runs in the WORKER process —
  importing the daemon module would cycle).

**The platform fact this surfaced (measured 2026-11-01, probed):** Bun's
bare `Bun.spawn` inherits the environment **as it was at process start** —
a runtime write to `process.env` (the worker's `applySwitches`) never
reaches a bare child. The CLI's own children are safe by accident of
topology (its switches arrive as environment before the process starts);
this shell's worker applies the request's switches at runtime, so the lane
launcher always spells the environment out (`{...process.env, ...injection}`)
— exactly the shell-contract §E item 8 wording "a custom launcher must
preserve the driver's inherited environment". The lane e2e caught this
live: without the explicit env the lane children fell back to the config's
default adapter and ran a real model against a fixture meant for the fake.

Derives: P21 (the launcher built when width arrived, not before), P5 (one
self-spawn derivation, one home `src/worker-command.ts`), P13 (the lane
grammar additive, refused on the public surface), P19 (the platform fact
measured and recorded where the next shell author reads it).

## D4 — the confinement launcher (`serve --launch <script>`)

Every spawned run — plain, planning, transfer — starts as
`bash <launch> <project-dir> -- <worker command...>` when the daemon is
served with `--launch`; absent it, workers spawn bare exactly as before.
The launcher owns the run's environment overlay and writable surface and
must exec the command with its exit code the run's; the daemon learns
nothing of the launcher's mechanics (the seam is the three-part invocation
alone — P16: no workspace's container facts enter the package; the
cleanroom's `agent-sandbox.sh` one-shot grammar
(`<project-dir> -- <command...>`, a per-identity `--rm` container, host
networking, key env forwarded by name from the wrapper's — i.e. the
daemon's — environment) is the concrete instance the workspace already
ships). Lane children inherit the confinement (children of a confined
process); they are never launched through it. Under a launcher: the
recorded pid is the wrapper's, the `starting → running` watcher flips on
the lock file's **presence** (the holder's pid names a process inside the
launcher's namespace), `DELETE /runs/<id>` signals the wrapper (kill
semantics the launcher owns — a container launcher's run may outlive its
wrapper; the lock arbitrates and the core's interruption recovery heals the
directory), and the daemon's read-only 423 precheck stays advisory — the
worker's acquire decides authoritatively.

Derives: P16 (genericity — the launcher is a command string; per-project
containers derive from the project argument inside the launcher), P14 (the
confinement injected at the shell's own spawn seam; the core untouched),
P18 (no new daemon state — a spawn-time seam), P10 (absent = the unchanged
bare spawn).

## D5 — multi-project concurrency stated and pinned

The one-run rule is per directory: the registry (409) and the lock (423)
arbitrate per project, and runs on different registered projects execute in
parallel — each in its own worker child. Nothing needed redesign; the
pinning test (two fixture projects, both live at once, both completing 0)
and the README/daemon.md statements make it a served property rather than
an emergent one.

Derives: P17 (declared concurrency, one sole writer of each directory's
shared git state — different directories simply parallel), P2 (unchanged:
each project's gates still its own person-bracketed boundaries).

## Category scope

- **Derives**: P8, P13, P14, P16, P17, P18, P19, P2, P21, P5, P10, P12 (each
  named at its decision above).
- **Amends**: none — no principle restated.
- **Tier touched**: shell code + docs only (`packages/auto-server`); zero
  auto-core src changes.

## Code homes and tests

`packages/auto-server/src/`: `request.ts` (width + cross-field refusals +
`parseLane`), `worker.ts` (the lane route, the width banner, the
exclusivities), `daemon.ts` (the transport skip, the interactive 409, the
`--launch` seam in `spawnWorker`, the watcher flip, the `lane` field
refusal), `profile.ts` (the laneLauncher), `worker-command.ts` (the shared
derivation), `index.ts` (serve `--launch`, USAGE). Docs: `README.md` (the
operator guide — hosting and lifetime, the confinement launcher, the
operator loop, concurrent lanes), `docs/daemon.md` (the same in lockstep),
`web/render.ts` hint + the rebuilt bundle.

Tests: `test/worker.test.ts` (the width pairs, the lane grammar table),
`test/daemon.test.ts` (the width 202 + endpoint 409, the `lane` field
refusal, the `--launch` e2e — marker, exec, exit-code propagation, the
watcher flip — and the two-project concurrency pin),
`test/lanes-e2e.test.ts` (the two-lane round through this shell's own
launcher: the relay prefixes prove real child workers, both lanes land, the
tree clean, no transport). Suite 135 pass / 1 fail standing (the observe
e2e's `sawDirty` poll-window flake, pre-existing — verified passing in
isolation; a fix is its own small timing ruling, named here as the
residual).

## The consumer-side documents (proposals, the person's rulings)

The cleanroom playbook update (daemon-hosted runs replacing the
hourly-chained segments) and the daemon hosting recipe are drafted
driver-side in the workspace — the playbook is the person's dated decision
per its own header; this change ships the tool surfaces and the README the
playbook cites.

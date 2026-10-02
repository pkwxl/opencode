# Structure index

Where things live in `packages/auto-core`: module → responsibility → key files. This is a locating index only — each module's header comment is the authoritative description of what it does and why, and the numbered `plans/NNNN-*.md` documents hold the design history (retired detail of the former version of this file: `plans/0050-structure-historical.md`). Update this file when a module is added, removed, or changes responsibility; line-level detail does not belong here.

Paths are relative to this package. The CLI shell (subcommands, argument parsing, build script, e2e tests) is the `../auto` package, which imports this one through `@opencode-ai/auto-core/<module>` subpaths (`"./*": "./src/*.ts"`).

## Layout at a glance

```
src/
  intent/      intent domain    — frozen schema + pack loader
  phases/      phases domain    — phase-type registry + custom types
  document/    document domain  — roles, unit model, state protocol, artifact specs
  agent/       agent domain     — AgentClient interface + opencode / claude adapters
  engine/      turn engine      — the spine, concerns, fx and sources of one session turn
  *.ts         driver (orchestration plane) + the flat intent/phases/document modules
templates/     prompts, intent packs, modes, and init copy templates (embedded via `with { type: "file" }`)
test/          one suite per module + fixtures/ + golden/ + import-direction.test.ts
docs/          durable docs: this index, shell-contract.md, glossary.md
plans/         numbered design/plan history (stage-assist, not maintained after it goes stale)
```

## Domains (D8)

Domains depend one way and only through their entry modules; the driver sits on top. `test/import-direction.test.ts` classifies every `src/` module into a domain and enforces the rules — its `CLASSIFIED` and `DOMAIN_ENTRIES` tables are the authoritative placement, and a new cross-module import may need a deliberate edit there. Driver modules also carry a sub-domain (the test's `SUBDOMAIN` table, R10): the cross-sub-domain value edges sit inside the seeded `SUBDOMAIN_EDGES` allowlist, which may only shrink.

| Domain | Entry modules | Also in the domain (flat) |
|---|---|---|
| intent | `src/intent/types.ts`, `src/intent/load.ts` | `src/mode.ts`, `src/template.ts`, `src/prompt.ts` |
| phases | `src/phases/registry.ts`, `src/phases/custom.ts` | `src/phases.ts` |
| document | `src/document/{types,roles,spec,state,process-refs,unit}.ts` | `src/docpaths.ts`, `src/doccheck.ts`, `src/protect.ts`, `src/round-brief.ts`, `src/brief.ts` |
| agent | `src/agent/types.ts`, `src/agent/opencode/server.ts`, `src/agent/claude/host.ts` | the rest of `src/agent/opencode/` and `src/agent/claude/` |
| driver | — (orchestration; no outward interface) | every other `src/*.ts` |

### intent — prompt content that is not flow control

| Module | Responsibility | Key files |
|---|---|---|
| Intent packs | Frozen schema of the (b)-class content (quality bars, phase duties, acceptance semantics, decision governance, artifact conventions); built-in packs + the project overlay | `src/intent/types.ts`, `src/intent/load.ts`, `templates/intents/default.md` (0031–0034, 0043) |
| Modes | `-m/--mode` scenario guidance, sectioned-file templates | `src/mode.ts`, `templates/modes/` |
| Template engine | Load/render prompt templates, partials, project overrides in `.opencode/auto/prompts/`, protocol-marker tiers | `src/template.ts`, `templates/prompts/_partials.md` (0033) |
| Prompt assembly | Turns task/run data into template variables; all copy lives in `templates/prompts/*.md`; renders from a caller-built `PromptFacts` value and view types (off the driver since 0061 E2) | `src/prompt.ts`, `src/prompt-plan.ts` (planning renderers: `renderPhasePlan`, `renderImplementPlan`, `renderPhaseAppend`, 0053), `src/prompt-facts.ts` (the facts' composition helper), `templates/prompts/` |

### phases — what a phase is

| Module | Responsibility | Key files |
|---|---|---|
| Phase-type registry | Builtin types and their `--phases` preset letters (admtvk), decompose template, duties key, standard artifacts, gate; phases-value resolution | `src/phases/registry.ts` (0047 §5) |
| Custom phase types | `.opencode/auto/phases/<type>.md` loader | `src/phases/custom.ts` |
| Phase state machine | Round `docs/R-NN/phases.md` index + `P<nn>-<type>/` directories, routing, `completePhase` (todo.md → done.md), round establishment, phase-index drift detection | `src/phases.ts` (0006, 0047 §3–§4, 0048, 0053 D34) |

### document — what the files in the target directory mean

| Module | Responsibility | Key files |
|---|---|---|
| Frozen schema | Artifact-spec and role types | `src/document/types.ts` (0031) |
| Role model | `roleOf` path classifier + per-role policies (eof-scan exemption, protect list, handoff checks); the project's scan exemptions (config `scanExempt`, `scanExempted`) | `src/document/roles.ts` (0045, 0059 X2) |
| Unit model | Phase/task/subtask refs and paths, todo/done scan and rename, index parsing, `Depends:`/`Touches:` fields, the `closed` map read from `Closed:` lines, `nextReady` selection | `src/document/unit.ts` (0047, 0053 D16) |
| Subtask state protocol | `docs/T-NNN/S<nn>/todo.md` → `done.md` | `src/document/state.ts` (0030, 0045) |
| Artifact specs | `Artifacts:` declaration parsing, spec tables, spec-driven mechanical checks | `src/document/spec.ts` (0034) |
| P1 prohibition scan | Deliverables must not reference process documents | `src/document/process-refs.ts` (0045) |
| Stable paths | Single constructor of task-document and round-directory paths | `src/docpaths.ts` (0010) |
| Shape check | Non-trivial + `<!-- auto: eof -->` last-line criterion (pure) | `src/doccheck.ts` (0026) |
| Read-only guard | chmod driver-owned files and AGENTS.md during `run` | `src/protect.ts` |
| Round brief | `docs/R-NN/round.md` stub and readers | `src/round-brief.ts` (0049) |
| Project brief | `.opencode/auto/brief.md` stub and planning-input reader | `src/brief.ts` (0052 D9) |

### agent — talking to a coding agent

| Module | Responsibility | Key files |
|---|---|---|
| Interface | `AgentClient` (13 never-rejecting calls), `AgentCapabilities`, `AgentEvent`, `AgentHost` — consciously amended for the registry (0055: `PromptInput.variant`/`bare`, `AgentHostOptions.bin`/`env`/`config`, `AgentHost.setConfig`) and for session exceptions (0057: `AgentRetryPolicy`, `AgentError`'s limit fields, the `limit` event) | `src/agent/types.ts` (0037, 0055, 0057) |
| opencode adapter | SDK calls, SSE → `AgentEvent` mapping (response headers and the retry status → limit fields), its retry policy, server spawn (the driver's own `opencode serve`, with an agent profile's bin, env overlay and spawn config)/connect/restart/timeout; the only importer of `@opencode-ai/sdk` | `src/agent/opencode/{client,events,server}.ts` (0039, 0055, 0057) |
| claude headless adapter | `claude -p` stream-json process per working session, stdout parser (`rate_limit_event` → limit fields and the `limit` event), its retry policy, contract/permission translation, host factory | `src/agent/claude/{client,stream,contract,host}.ts` (0041, 0057) |
| Agent process environment | The driver's own `OPENCODE_AUTO_*` variables stay out of both adapters' spawns (opencode's own flags with that prefix excepted; a profile's env may set one back) | `src/agent/env.ts` (0059 X1) |

## Driver

Grouped by sub-domain (R10) — the sub-domain column the direction test holds is the organization here: the driver domain's six logical sub-domains, no directories and no barrels, one table each below in dependency order (the cross-sub-domain value edges sit inside the test's `SUBDOMAIN_EDGES` allowlist, which may only shrink). `contract` (types and pure functions only, a leaf over types), `kernel` (the task store, the git/commit boundary and the run's records — what the engine reaches for its effects), `engine` (one turn, dispatch or ladder), `policies` (the decision rules: the turn concerns, routing, usage, recovery, control), `pipeline` (the task pipeline: loops, plans, runner at the top), `runtime` (the process plane: switches, logging, services, options, config, the agent start). The session-driving chain is strictly layered (0024 §D.2): `runner` → `execute` → `exec-session` → `session` → `attempt` → `watch` → the turn engine (`src/engine/`); lower layers never import upward, and `testrun` never imports the session-driving layer.

### contract — types and pure functions only, a leaf over types

| Module | Responsibility | Key files |
|---|---|---|
| Session chain and routing | `SessionChain` (with its `agent` and model entry), phase → role → model routing, error classification, the retry policy in force and `agentGaveUp`, resets stated in a known provider wording (`statedInWording`) | `src/chain.ts` (0017, 0055 §8.2, 0057 §4, S4a) |
| Control boundary types | The control modules' shared vocabulary: the pipeline `Boundary` kind (phase / task / subtask — the safe boundaries step mode, `/exit` and failback pause or reset at) and the `Interactive` sideband interface step's pause reads; types only, importing nothing — the leaf that broke the control modules' type cycle | `src/control-types.ts` (0061 §2.2 R8) |
| Turn contract | The engine's types: `TurnInput` (external and synthetic), the per-concern `TurnState` slices with the read-only view over them, the immutable `TurnContext`, the audited `TurnFx` surface, `Concern`/`Advice`/`Settle` and the arbitration types | `src/engine/contract.ts` (0061 §4.3) |

### kernel — the task store, the git/commit boundary and the run's records

| Module | Responsibility | Key files |
|---|---|---|
| Task store | Phase `tasks.md` index + `docs/T-NNN/` units, `.auto/units.json` runtime state (status, attempts, fork base, auto's split point with the lead's final figure), `newTaskProblems` (the planning/appending collect's per-task checks) and `forgetUnits` (record clearing for closed tasks), no-phase mode | `src/tasks.ts` (0047, 0053, 0059 D5) |
| Unified commit | Recursive driver commits (nested repos first), `Auto-Stage` trailer, clean gate, SHA baseline, rollback primitives; the lane worktree primitives and the landing merge of plans/0068 (`addWorktree` / `removeWorktree` — best-effort teardown with the Windows AV/file-lock retry schedule — / `pruneWorktrees` / `deleteBranch` / `landBranch` — `merge --no-ff` with `Auto-Stage: landing`, parent-owned tick files resolved onto the main side — / `mergeLaneUpstream`, the conflict repair's `merge-repair` merge); the `GitOps` seam type — the run's git service, whose production instance delegates to these functions and whose no-commit double is what tests install where committing must idle (the retired `commit: false` path's replacement) | `src/git.ts`, `src/git-ops.ts` (0021, 0061 C6, 0068 §6.5) |
| Unit commit | Post-session commit, close-out checks, strict-resume fidelity (activated only when the git service's `records` marker is true — never under the no-commit double), unit rollback; the session close-out `afterSession` with its marker collection and the git service's two instances live in the seam's home `src/git-ops.ts` | `src/unit-commit.ts`, `src/git-ops.ts` (0021, 0022, 0061 C6) |
| Progress record | `.auto/progress.json`, session reuse on resume | `src/resume.ts` (0018, 0022) |
| Resume gate | Unit-ownership gate, resume/interruption wording | `src/resume-gate.ts` |
| Handover recovery | `.auto/handover.json` breakpoints of a test handover | `src/handover.ts` (0023 §I–§N) |
| Numbering | `--auto-number`, `.auto/next-task` | `src/numbering.ts` (0001) |
| Stats | Cross-interruption cumulative time and tokens, `.auto/stats.json`; under a registry also per-model and per-tier usage, the `classify` bucket and per-model protocol-drift counters; the time slept for quota windows per model (`quotaWaits`); knowledge-digest counters (`digests`: per-planning-session digest sizes, cap trips, knowledge-phase use) with the 25% digest cap on the planning prompt's prevRound slot (`templates/prompts/digest-index.md` is the index form) | `src/stats.ts` (0019, 0055 §7.1, 0057 §11 item 7, 0061 R3) |
| Proxy-answer ledger | `AUTO-RESOLVE`/`AUTO-DECISION` collection and reporting | `src/resolve.ts` (0020) |
| Driver scripts | `tmp/test.sh` request marker, output capture, watchdog | `src/script.ts` |
| Test run | `--test-by-driver` execution, handover-document archive/cleanup, the context-budget steer (`handoffSteer`, its wall `steerWall`: 2×cap raised to a quarter of a large window, capped at 80% of it) (no session imports) | `src/testrun.ts` (0023, 0056, 0059 D6) |

### engine — one turn, one dispatch, one ladder

The session-driving chain's lower half and the turn engine's internals (0061): `watch()` is the turn engine's facade and entry — it builds the turn's context, installs the concern roster, runs the spine and maps the outcome back; every mechanism lives in its own file, the pure planners deciding and the entry points executing.

| Module | Responsibility | Key files |
|---|---|---|
| Test-handover state machine | `runExecSession`: handover sequence and recovery forks | `src/exec-session.ts` (0023) |
| Session driving | `runSession` retry / server restart / key-ring rotation → model failover / `awaitRecovery`; a spent quota window with a stated reset skips the retry ladder; the scheduled wait (`planSleep`: the recovery sleep to a known instant — a candidate usable again, a stated or learned reset — plus jitter, `/exit` a boundary inside it); registry window wait (sleep to the opening plus hibernate's jitter, booked as a `window` wait); `ensureForkBase` (per agent, built with the subtask route's pick) | `src/session.ts` (0015, 0017, 0055 §6.3, §7, §8.4, 0057 §4.1, §6) |
| Single dispatch | Resumed-takeover-or-create (every prompt opens a fresh session except a recovery takeover of the recorded one), model target and the chain's agent binding, resume point, stats segment, wait for idle | `src/attempt.ts` |
| Event stream | The turn facade: `watch()` — one session turn on the engine (builds the turn context, installs the concerns, runs the spine, maps the outcome into `Watch`); the mechanisms are the concerns' files in the policies group below | `src/watch.ts` (0026, 0055 §4.5, §7.1, 0057, 0061) |
| Session helpers | Fork, usage, liveness, rename over `AgentClient`; `clientOf`/`contextLimitsOf` resolve a client or the agent pool; terminal formatting; human answers | `src/session-api.ts` |
| Chain transitions | The named `SessionChain` transitions — the one home of every chain-field write: `forkSources` and `modelOfChain` (each once four copies), the retry / failover / key-rotation / recovery moves, the blank fallbacks, the cross-agent moves, and the dispatch and pipeline bookkeeping (promotion, restoration, pending/failure clears); `test/chain-writes.test.ts` holds the write ratchet: no chain write outside this module | `src/chain-transitions.ts` (0061 §4.8) |
| Dispatch plan | The pure `planDispatch` of one prompt: what a dispatch decides before anything is created — resumed takeover or create, the registry pick or the blocked outcome (empty tier, window wait, probe), the cross-agent move a pick on another agent forces (the pick always exists: every run has a registry, the implicit one included); `attempt()` builds the facts at the seam, executes the plan and writes the chain through the transitions | `src/engine/dispatch.ts` (0061 §4.7, F2) |
| Ladder decision | The pure `nextStep` over a dispatch's outcome: return it, wait out a model window, escalate a quota/auth/rate failure through the key ring and the failover into the wait-and-probe loop, exhaust the retry ladder into the failover, or retry the transient error; `runSession` is the executor — every side effect stays in its place (the learned-window booking, the down marks, the server restart, the backoff sleep) | `src/engine/ladder.ts` (0061 §4.7) |
| Turn spine | The single input queue of one turn: the declared arbitration table (§4.5) dispatched over the slices, the fx audit (the queue discipline's runtime invariants), the trip-wired stream wrapper and the finalize procedure | `src/engine/spine.ts` (0061 §4.4) |
| Turn fx and sources | The production `TurnFx` — every I/O call a turn makes (steers, questions and permissions, the human answer, the kernel test effects, the freeze commit, the handover record); the synthetic-input sources (the liveness probe timer, the classifier-answer feed) | `src/engine/fx.ts`, `src/engine/sources.ts` (0061) |
| Turn result | The settle→Watch mapping: the snapshot every exit carries (duration, usage, resolves) plus the per-exit fields — the blocked question, the error class and retryable marks, the reset fields | `src/engine/result.ts` (0061) |

### policies — the run's decision rules

| Module | Responsibility | Key files |
|---|---|---|
| Turn concerns | One file per concern, each owning one state slice and its cells in the arbitration table: guard (the twin-idle guard), transcript (terminal echo and billing), windows (the limit row), stuck (the loop hint), questions (the question and permission rows), failure (the error accumulator with its limit-statement helpers), recovery (the classifier's turn: the consult, the raised settle, the final classification, the reset fields), liveness (probe verdicts, announced silence, truncation continuation, the interrupted close-out), usage (the measurement point: wall, notice bands, hard wall), stepUp (the context steps' live half: step-up, late step-up, cache claims), test (the idle test protocol with the kernel effects) | `src/engine/concerns/*.ts` (0061 §4.5–§4.6) |
| Routing run state | The run-level facts (registry, agent filter, default agent) — always defined, the implicit registry synthesized from the env switches where no layer exists — the wiring every dispatch calls through, the run-start routing block and the dispatch-coverage refusal (both layer-backed); the routing decisions are the router service's, behind call-time facts | `src/routing.ts`, `src/router.ts` (0055, 0061 C4/F2) |
| Key rings | Per-provider rings of references, ring positions and activation, the spawn config content, rotation by managed-server restart (the ring build and the key labels are pure; the ring run state — rings, positions, activation — is the router service's) | `src/keyring.ts`, `src/router.ts` (0055) |
| Model failback | `OPENCODE_AUTO_MODEL_FAILBACK_SCOPE` granularity and `/failback`: the pure boundary arithmetic in `src/failback.ts`, the state (pending order, run-time override, down marks per model and provider key — the marks subsume the retired phase-sticky holder) and the failover decision in the router service | `src/failback.ts`, `src/router.ts` (0017, 0055, 0061 C4/F2) |
| Registry loader | The operator layer (`$OPENCODE_AUTO_MODELS`, else `$XDG_CONFIG_HOME/<configDir>/models.json`) and the local-only project layer `.opencode/auto/models.json`: one-level-deep merge, strict validation, key/env reference checks, an entry's `retry` policy override; with neither layer the implicit registry takes over (0061 F2: the env switches synthesize it in memory — one entry per model string on the run's agent, routes from the `OPENCODE_AUTO_MODEL` key grammar, the `_FALLBACK` ring as both tiers' order, the `default` entry where nothing routes) | `src/models.ts` (0055, 0057, 0061 F2) |
| Registry schema | The registry's schema half: every registry type, the tables that declare what a registry file may say (the field names of the top level and each entry kind, the internal-name and reference grammar), and the declared vocabulary (the builtin adapters, the implied profile, the tier words); the loader merges and validates against it, and a type-only importer binds no loader code | `src/models-schema.ts` (0055, 0061 E4) |
| Windows | `avoid`/`only` window grammar, availability and next opening in the registry `tz` (DST-correct, injected clock, pure) | `src/model-window.ts` (0055) |
| Tiers | The default reasoning tier of every routing role and phase type (a custom type's `Reasoning:` field, the builtin execute tiers) | `src/tier.ts` (0055) |
| Candidate lists | The route in force (role > type id > preset letter), the session's tier and the ordered internal names, before any usability check | `src/model-route.ts` (0055) |
| Selection | Pick / window wait / probe / empty-tier over a candidate list, and `recoveryAt`, the instant a list with nothing usable comes back by waiting (pure: down marks, ring predicate and context windows are inputs) | `src/select.ts` (0055, 0057) |
| Failure-message classifier | The registry's `classifier` entries read failure text the error patterns cannot settle and whose reset nothing stated: redaction, cache and call budget, reply parsing, the one-shot tool-free session; the reset horizon | `src/classify.ts` (0055, 0057) |
| Context steps | The `wider` step ids of one entry: the step-up point, the enabled-step walk over live windows, the resume rule, startup validation (pure; the cache-claim run state and the live trigger are the router service's and watch.ts's) | `src/model-step.ts` (0055) |
| models command data | `checkModels` / `describeModels` / `formatModels`: the run start's registry problems and the effective table as data; the shell only prints | `src/models-describe.ts` (0055) |
| Learned windows | `.auto/windows.json`: a spent quota window's reset per account, kept across runs and read only to time the scheduled wait; never a down mark | `src/quota-windows.ts` (0057 §8) |
| Usage source | Four `UsageTier`s and their effect on handover, steer, fork | `src/usage.ts` (0038) |
| Capability degradation | Maps missing `AgentCapabilities` to existing fallbacks; under a registry, the intersection over the fleet's static records; a fleet that cannot fork withholds auto's split clause (`leadSplit`) | `src/capability.ts` (0040, 0055, 0059 D7) |
| Stuck-loop detection | Repeated-tool-call detection → steer hint | `src/stuck.ts`, `templates/prompts/stuck-hint.md` (0016) |
| Step mode | `OPENCODE_AUTO_STEP` pauses at phase/task/subtask boundaries | `src/step.ts` (0012) |
| Graceful exit | `/exit` at the next safe boundary, the wait-and-probe loop's sleep included; the request flag and its sleepers are the control service's (one per run on the services holder, the clock's `sleepUnlessExit` delegating to it) | `src/exit.ts` (0014, 0057 §6, 0061 C5) |
| Hibernate | `OPENCODE_AUTO_HIBERNATE` daily UTC window; the shared booked sleep and 0–600 s jitter the registry window waits and the scheduled wait reuse | `src/hibernate.ts` (0027, 0055 §6.3, 0057 §6) |
| Interactive input | `--interactive` side-channel steer, `--wait-answer` input line | `src/interactive.ts` |

### pipeline — the task pipeline: the loops and plans that decide what runs

| Module | Responsibility | Key files |
|---|---|---|
| Run entry | `runAll`: preflight, agent start, interactive input, Ctrl+C handling, exit codes | `src/loop.ts` |
| Preflight | Prompt library, agent-contract check, model registry (load, validation, reference check, project-layer git check, per-profile bins, loopback proxy warning), stats, read-only guard, handover restore, retired-`CURRENT.md` cleanup, clean gate, housekeeping commit; builds the run's services holder (clock, router, control, git — the git member installs the commit side's seam, production by default); `RunAllOpts` (no commit switch: committing is always on, only dryrun and the double idle it) | `src/loop-preflight.ts` (0054, 0055, 0061 C6) |
| Phase loop | Phase handover, phase routing; plan's stop condition (`stopBefore`) | `src/loop-phase.ts` (0006, 0047, 0053) |
| Phase planning | The one planner: phased and m-mode planning sessions, their plan-review pause, and the append step `appendPlan` (snapshot → reset → collect, stale-handover removal); the phase-state helpers the phase loop shares | `src/loop-plan.ts` (0006, 0047, 0053) |
| Planning input | A phase's `plan-input.md`: read, persist, and commit before the planning unit | `src/plan-input.ts` (0053 D9) |
| Plan prelude | `planPrelude`: the routes `plan` settles without an agent (establish a round, the round-close gate, notices, input refusals); the lines `plan` prints where its loop stops | `src/plan.ts` (0053 D4–D8, D15) |
| Task add | `--new-task`: adding the one task a person names with no session — number, task document, index line, stale-handover removal, the task-add commit | `src/task-add.ts` (0058) |
| Close | `closeUnit`: close a task/phase/round without completing it — the `Closed:` field, the mechanical handover of a closed phase, per-unit record clearing, the close commit | `src/close.ts` (0053 D17–D22) |
| Task loop | Iterates a phase's tasks; `LoopCtx`; holds the lane loops since plans/0068 — the isolation switch's serial `runIsolationLoop` and the readiness scheduler's `runLaneLoop` (dispatch up to `--max-sessions`, the failure matrix per exit, D21's level-derived conflict budget, D15's serial degrade, orphan recovery wired from preflight) | `src/loop-task.ts` |
| Parallel lanes | The lanes layer of plans/0068: the readiness predicate (`readyUnits` over declared `Depends`/`Touches`, `laneEligible`), the dispatch choreography (`dispatchLane` — the park worktree, the scaffolding copy, the spawn through the profile's `laneLauncher`, the Windows path-length guard) and the landing protocol (`landLane`, D7's five steps with `syncIndexTicks`/`syncChecklistTicks`), the lane report contract (`.auto/lane.json`, `parseLaneReport`/`laneOutcome`), stream-unit expansion (`streamUnits`, `T-NNN.S<nn>`), the `[<id>]` prefix relay (the lane's own `.auto/logs/` is discarded at teardown — the parent's relayed audit log keeps the run story; §11 item 6's choice), the activation and conflict policies (`schedulerActive`, `conflictRepair`), pid liveness and the dispatch cap | `src/lanes.ts` (0068) |
| Loop progress | `--wait-between` pause, changed-files watch, subtask heartbeat | `src/loop-progress.ts` (0019) |
| Conclusions | Resume banner, proxy-answer highlight blocks, conclusion lines (text only; per-model lines and the per-tier summary under a registry; the time lost to quota windows) | `src/conclusion.ts` (0019, 0020, 0055, 0057) |
| Task pipeline | `runOnce`/`runTask`: dispatch by `--subtask` (`true`: decompose → subtasks; `auto`: the lead, then its streams when its split is taken; `off`/`ondemand`: whole) → wrap-up → closeout; resume | `src/runner.ts` (0059 D1) |
| Execution | Merged understand+decompose session, per-subtask sessions, whole-task session (auto's lead, its split judged after each session), the split's streams as forks of the lead with their own handover | `src/execute.ts` (0030, 0059) |
| Lead's split | The lead's checklist lines, the structural split guard, the driver-written `S<nn>/todo.md`, the taken-split check and the driver-state filter of its changed-files list (a checklist item's title is `tasks.ts` `checklistTitle`, shared with the pipeline's subtask prompt) | `src/split.ts` (0059 D3–D5, T1) |
| Bypass-session skeleton | `requireArtifact`: dispatch → collect → one retry → implicit block; hidden-unit commit boundary | `src/artifact.ts` |
| Wrap-up | Wrap-up session, `Result: PASS\|FAIL` parsing | `src/wrapup.ts` (0044) |
| Knowledge | Knowledge phase and prior-knowledge extraction | `src/knowledge.ts` |
| Status tree | Read-only round → phase → task → subtask view | `src/status.ts` |
| Round close | Whole-tree P1 scan, build check, close listing before `plan` opens the next round | `src/round-close.ts` (0049) |

### runtime — the process plane

| Module | Responsibility | Key files |
|---|---|---|
| Run services | `RunServices` — the run's one service holder: the clock (the one time source the session-driving engine and the stats module read), the router, the control (the `/exit` request and its sleepers) and the git service (the commit-side seam); built by preflight in the written order after the switch snapshot freezes, installed by `runAll` for the run and uninstalled in its `finally`; the ambient `services()` accessor is allowed only in the modules `SERVICE_ENTRIES` lists (may only shrink), and `createServices()` builds a fresh holder — what the test preload installs | `src/services.ts` (0061 §4.9) |
| Options and outcomes | Shared opts, `Outcome`/`UnitStop` types, context-budget constants, and `sessionOpts` — the one builder of the loop family's session options (a structural context slice, seven site ids, no per-site field exceptions; the module stays import-free) | `src/opts.ts` (0061 C7) |
| Experiment switches | `OPENCODE_AUTO_*` registry, parsed once, never persisted (the `OPENCODE_AUTO_MODELS` path variable is registered but stays out of the parsed switches); a retired variable (`RETIRED_SWITCHES`) answers one run-start notice and is otherwise ignored | `src/switches.ts` (0003, 0055 §9) |
| Shell profile | `setShellProfile`: program name, `configDir`, recovery hints, log audit, agent; `registerAgentAdapter` lets a shell add an agent adapter without a core change | `src/shell.ts` (0055) |
| Project config | Constitutional options fixed by init in `.opencode/auto/config.json` | `src/config.ts` (0004) |
| Config fix | The rule table behind `fix`: fixable/manual findings over the raw config and the config-layer artifacts, planned then applied; `renderAgentContract` | `src/config-fix.ts` (0052 D10–D11) |
| AGENTS.md block | The opencode-auto marker block, the only content the driver puts in the target's AGENTS.md | `src/agents-block.ts` (0054) |
| reset command | Remove init's configuration artifacts (the project brief only while it is the untouched stub) | `src/reset.ts` |
| Destructive-op guards | Interactive confirmation; clean-worktree gate | `src/confirm.ts`, `src/clean.ts` |
| .gitignore | Driver work-directory entries | `src/gitignore.ts` |
| Run lock | `.auto/run.lock`: one driver process per directory; re-entrant, stale-pid detection, refusal and status lines | `src/lock.ts` (0053 D1–D3) |
| Logging | Verbose/audit output, timestamps, log file | `src/log.ts` |
| Agent choice | The adapter a run drives (shell profile > `OPENCODE_AUTO_AGENT` > config > opencode) and the start profile a name resolves to under a registry (`agentProfileFor`) | `src/agent-choice.ts` (0041, 0055) |
| Agent pool | The run's agent hosts under one control: under a model registry one lazily started host per agent profile (a profile nobody selects never spawns), the capability intersection at run start, preflight's bin check and the `models --probe` core; without one the single agent starts eagerly, exactly as before | `src/agent-pool.ts` |
| Agent environments | An agent profile's env resolved into the overlay its host starts with (values never logged); the loopback proxy warning of preflight | `src/agent-env.ts` (0055) |
| Render facts | The one `PromptFacts` builder every render caller shares: the prompt globals (the intent pack, the human-questions flag), the template library handle, the switch-derived ask tier and the implement-entry fallback (0061 E2) | `src/prompt-facts.ts` |

## Templates

| Path | Contents |
|---|---|
| `templates/prompts/` | One file per session prompt (decompose, subtask, whole, fanout, wrapup, phase-plan, phase-append, phase-handover, knowledge, test-*, step-up, classify-error, …) + `_partials.md`; registered in `src/template.ts` |
| `templates/intents/` | Built-in intent packs (`default.md`); registered in `src/intent/load.ts` |
| `templates/modes/` | Built-in modes; registered in `src/mode.ts` |
| `templates/.opencode/agent/auto.md`, `templates/opencode.json` | Agent contract and permission allowlist that init copies into the target (registered by the shell); `templates/README.md` describes them |

## Tests

| Path | Contents |
|---|---|
| `test/<module>.test.ts` | One suite per module (names follow the module; domain suites prefixed `agent-`, `document-`, `phases-`, `prompt-`) |
| `test/fixtures/` | Shared doubles: `agent.ts` (native `AgentClient` fake, 0042), `runner.ts`, `prompt.ts`, `units.ts` |
| `test/golden/` + `test/golden.test.ts` | Rendered-prompt and contract golden files |
| `test/turn-*.test.ts` + `test/golden/turn/` | The turn engine's suites: the arbitration table and fx audit, one suite per concern over a fake `TurnFx`, the idle test protocol, and the frozen turn-trace oracle (the equivalence proof of the consolidation's stage D) |
| `test/import-direction.test.ts` | Domain classification and dependency-direction rules (above) |
| `test/agent-fake.test.ts` | Agent-neutral driver behavior; fails if any `AgentClient` call goes unexercised |
| `test/incident-regression.test.ts` | Regressions from field incidents |

<!-- auto: eof -->

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
  *.ts         driver (orchestration plane) + the flat intent/phases/document modules
templates/     prompts, intent packs, modes, and init copy templates (embedded via `with { type: "file" }`)
test/          one suite per module + fixtures/ + golden/ + import-direction.test.ts
docs/          durable docs: this index, shell-contract.md, glossary.md
plans/         numbered design/plan history (stage-assist, not maintained after it goes stale)
```

## Domains (D8)

Domains depend one way and only through their entry modules; the driver sits on top. `test/import-direction.test.ts` classifies every `src/` module into a domain and enforces the rules — its `CLASSIFIED` and `DOMAIN_ENTRIES` tables are the authoritative placement, and a new cross-module import may need a deliberate edit there.

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
| Prompt assembly | Turns task/run data into template variables; all copy lives in `templates/prompts/*.md` | `src/prompt.ts`, `src/prompt-plan.ts` (planning renderers: `renderPhasePlan`, `renderImplementPlan`, `renderPhaseAppend`, 0053), `templates/prompts/` |

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
| Interface | `AgentClient` (14 never-rejecting calls), `AgentCapabilities`, `AgentEvent`, `AgentHost` — consciously amended for the registry (0055: `PromptInput.variant`/`bare`, `AgentHostOptions.bin`/`env`/`config`, `AgentHost.setConfig`) and for session exceptions (0057: `AgentRetryPolicy`, `AgentError`'s limit fields, the `limit` event) | `src/agent/types.ts` (0037, 0055, 0057) |
| opencode adapter | SDK calls, SSE → `AgentEvent` mapping (response headers and the retry status → limit fields), its retry policy, server spawn (the driver's own `opencode serve`, with an agent profile's bin, env overlay and spawn config)/connect/restart/timeout; the only importer of `@opencode-ai/sdk` | `src/agent/opencode/{client,events,server}.ts` (0039, 0055, 0057) |
| claude headless adapter | `claude -p` stream-json process per working session, stdout parser (`rate_limit_event` → limit fields and the `limit` event), its retry policy, contract/permission translation, host factory | `src/agent/claude/{client,stream,contract,host}.ts` (0041, 0057) |
| Agent process environment | The driver's own `OPENCODE_AUTO_*` variables stay out of both adapters' spawns (opencode's own flags with that prefix excepted; a profile's env may set one back) | `src/agent/env.ts` (0059 X1) |

## Driver

Grouped by layer, top down. The session-driving chain is strictly layered (0024 §D.2): `runner` → `execute` → `exec-session` → `session` → `attempt` → `watch`; lower layers never import upward, and `testrun` never imports the session-driving layer.

### Run entry and loops

| Module | Responsibility | Key files |
|---|---|---|
| Run entry | `runAll`: preflight, agent start, interactive input, Ctrl+C handling, exit codes | `src/loop.ts` |
| Preflight | Prompt library, agent-contract check, model registry (load, validation, reference check, project-layer git check, per-profile bins, loopback proxy warning), stats, read-only guard, handover restore, retired-`CURRENT.md` cleanup, clean gate, housekeeping commit; `RunAllOpts` | `src/loop-preflight.ts` (0054, 0055) |
| Phase loop | Phase handover, phase routing; plan's stop condition (`stopBefore`) | `src/loop-phase.ts` (0006, 0047, 0053) |
| Phase planning | The one planner: phased and m-mode planning sessions, their plan-review pause, and the append step `appendPlan` (snapshot → reset → collect, stale-handover removal); the phase-state helpers the phase loop shares | `src/loop-plan.ts` (0006, 0047, 0053) |
| Planning input | A phase's `plan-input.md`: read, persist, and commit before the planning unit | `src/plan-input.ts` (0053 D9) |
| Plan prelude | `planPrelude`: the routes `plan` settles without an agent (establish a round, the round-close gate, notices, input refusals); the lines `plan` prints where its loop stops | `src/plan.ts` (0053 D4–D8, D15) |
| Task add | `--new-task`: adding the one task a person names with no session — number, task document, index line, stale-handover removal, the task-add commit | `src/task-add.ts` (0058) |
| Close | `closeUnit`: close a task/phase/round without completing it — the `Closed:` field, the mechanical handover of a closed phase, per-unit record clearing, the close commit | `src/close.ts` (0053 D17–D22) |
| Task loop | Iterates a phase's tasks; `LoopCtx` | `src/loop-task.ts` |
| Loop progress | `--wait-between` pause, changed-files watch, subtask heartbeat | `src/loop-progress.ts` (0019) |
| Conclusions | Resume banner, proxy-answer highlight blocks, conclusion lines (text only; per-model lines and the per-tier summary under a registry; the time lost to quota windows) | `src/conclusion.ts` (0019, 0020, 0055, 0057) |
| Agent choice | The adapter a run drives (shell profile > `OPENCODE_AUTO_AGENT` > config > opencode) and the start profile a name resolves to under a registry (`agentProfileFor`) | `src/agent-choice.ts` (0041, 0055) |
| Agent pool | The run's agent hosts under one control: under a model registry one lazily started host per agent profile (a profile nobody selects never spawns), the capability intersection at run start, preflight's bin check and the `models --probe` core; without one the single agent starts eagerly, exactly as before | `src/agent-pool.ts` |
| Agent environments | An agent profile's env resolved into the overlay its host starts with (values never logged); the loopback proxy warning of preflight | `src/agent-env.ts` (0055) |
| Capability degradation | Maps missing `AgentCapabilities` to existing fallbacks; under a registry, the intersection over the fleet's static records; a fleet that cannot fork withholds auto's split clause (`leadSplit`) | `src/capability.ts` (0040, 0055, 0059 D7) |
| Usage source | Four `UsageTier`s and their effect on handover, steer, fork | `src/usage.ts` (0038) |

### Model registry and routing

| Module | Responsibility | Key files |
|---|---|---|
| Registry loader | The operator layer (`$OPENCODE_AUTO_MODELS`, else `$XDG_CONFIG_HOME/<configDir>/models.json`) and the local-only project layer `.opencode/auto/models.json`: one-level-deep merge, strict validation, key/env reference checks, an entry's `retry` policy override; with neither layer there is no registry and nothing changes | `src/models.ts` (0055, 0057) |
| Windows | `avoid`/`only` window grammar, availability and next opening in the registry `tz` (DST-correct, injected clock, pure) | `src/model-window.ts` (0055) |
| Tiers | The default reasoning tier of every routing role and phase type (a custom type's `Reasoning:` field, the builtin execute tiers) | `src/tier.ts` (0055) |
| Candidate lists | The route in force (role > type id > preset letter), the session's tier and the ordered internal names, before any usability check | `src/model-route.ts` (0055) |
| Selection | Pick / window wait / probe / empty-tier over a candidate list, and `recoveryAt`, the instant a list with nothing usable comes back by waiting (pure: down marks, ring predicate and context windows are inputs) | `src/select.ts` (0055, 0057) |
| Routing run state | The run-level facts (registry, agent filter, default agent), the wiring every registry-driven dispatch calls through, the run-start routing block and the dispatch-coverage refusal; the dual registry/no-registry routing decisions are fenced in the router service behind call-time facts (the no-registry half is the pre-deletion compatibility layer) | `src/routing.ts`, `src/router.ts` (0055, 0061 C4) |
| Key rings | Per-provider rings of references, ring positions and activation, the spawn config content, rotation by managed-server restart (the ring build and the key labels are pure; the ring run state — rings, positions, activation — is the router service's) | `src/keyring.ts`, `src/router.ts` (0055) |
| Failure-message classifier | The registry's `classifier` entries read failure text the error patterns cannot settle and whose reset nothing stated: redaction, cache and call budget, reply parsing, the one-shot tool-free session; the reset horizon | `src/classify.ts` (0055, 0057) |
| Context steps | The `wider` step ids of one entry: the step-up point, the enabled-step walk over live windows, the resume rule, startup validation (pure; the cache-claim run state and the live trigger are the router service's and watch.ts's) | `src/model-step.ts` (0055) |
| models command data | `checkModels` / `describeModels` / `formatModels`: the run start's registry problems and the effective table as data; the shell only prints | `src/models-describe.ts` (0055) |

### Task pipeline and sessions

| Module | Responsibility | Key files |
|---|---|---|
| Task pipeline | `runOnce`/`runTask`: dispatch by `--subtask` (`true`: decompose → subtasks; `auto`: the lead, then its streams when its split is taken; `off`/`ondemand`: whole) → wrap-up → closeout; resume | `src/runner.ts` (0059 D1) |
| Execution | Merged understand+decompose session, per-subtask sessions, whole-task session (auto's lead, its split judged after each session), the split's streams as forks of the lead with their own handover | `src/execute.ts` (0030, 0059) |
| Lead's split | The lead's checklist lines, the structural split guard, the driver-written `S<nn>/todo.md`, the taken-split check and the driver-state filter of its changed-files list (a checklist item's title is `tasks.ts` `checklistTitle`, shared with the pipeline's subtask prompt) | `src/split.ts` (0059 D3–D5, T1) |
| Test-handover state machine | `runExecSession`: handover sequence and recovery forks | `src/exec-session.ts` (0023) |
| Session driving | `runSession` retry / server restart / key-ring rotation → model failover / `awaitRecovery`; a spent quota window with a stated reset skips the retry ladder; the scheduled wait (`planSleep`: the recovery sleep to a known instant — a candidate usable again, a stated or learned reset — plus jitter, `/exit` a boundary inside it); registry window wait (sleep to the opening plus hibernate's jitter, booked as a `window` wait); `ensureForkBase` (per agent, built with the subtask route's pick) | `src/session.ts` (0015, 0017, 0055 §6.3, §7, §8.4, 0057 §4.1, §6) |
| Single dispatch | Resumed-takeover-or-create (every prompt opens a fresh session except a recovery takeover of the recorded one), model target and the chain's agent binding, resume point, stats segment, wait for idle | `src/attempt.ts` |
| Event stream | Echo, usage tracking, handoff steer, stuck hints, marker collection, test requests, liveness probe (held off through an announced silence), truncation resume; context step-up steers and classifier calls beside the retry branch; the limit fields merged (stated, then wording, then classifier), quota-window lines | `src/watch.ts` (0026, 0055 §4.5, §7.1, 0057) |
| Session chain and routing | `SessionChain` (with its `agent` and model entry), phase → role → model routing, error classification, the retry policy in force and `agentGaveUp`, resets stated in a known provider wording (`statedInWording`) | `src/chain.ts` (0017, 0055 §8.2, 0057 §4, S4a) |
| Session helpers | Fork, usage, liveness, rename over `AgentClient`; `clientOf`/`contextLimitsOf` resolve a client or the agent pool; terminal formatting; human answers | `src/session-api.ts` |
| Bypass-session skeleton | `requireArtifact`: dispatch → collect → one retry → implicit block; hidden-unit commit boundary | `src/artifact.ts` |
| Wrap-up | Wrap-up session, `Result: PASS\|FAIL` parsing | `src/wrapup.ts` (0044) |
| Knowledge | Knowledge phase and prior-knowledge extraction | `src/knowledge.ts` |
| Options and outcomes | Shared opts, `Outcome`/`UnitStop` types, context-budget constants (pure) | `src/opts.ts` |

### Task store, state, and recovery

| Module | Responsibility | Key files |
|---|---|---|
| Task store | Phase `tasks.md` index + `docs/T-NNN/` units, `.auto/units.json` runtime state (status, attempts, fork base, auto's split point with the lead's final figure), `newTaskProblems` (the planning/appending collect's per-task checks) and `forgetUnits` (record clearing for closed tasks), no-phase mode | `src/tasks.ts` (0047, 0053, 0059 D5) |
| Status tree | Read-only round → phase → task → subtask view | `src/status.ts` |
| Progress record | `.auto/progress.json`, session reuse on resume | `src/resume.ts` (0018, 0022) |
| Resume gate | Unit-ownership gate, resume/interruption wording | `src/resume-gate.ts` |
| Handover recovery | `.auto/handover.json` breakpoints of a test handover | `src/handover.ts` (0023 §I–§N) |
| Numbering | `--auto-number`, `.auto/next-task` | `src/numbering.ts` (0001) |
| Stats | Cross-interruption cumulative time and tokens, `.auto/stats.json`; under a registry also per-model and per-tier usage, the `classify` bucket and per-model protocol-drift counters; the time slept for quota windows per model (`quotaWaits`); knowledge-digest counters (`digests`: per-planning-session digest sizes, cap trips, knowledge-phase use) with the 25% digest cap on the planning prompt's prevRound slot (`templates/prompts/digest-index.md` is the index form) | `src/stats.ts` (0019, 0055 §7.1, 0057 §11 item 7, 0061 R3) |
| Learned windows | `.auto/windows.json`: a spent quota window's reset per account, kept across runs and read only to time the scheduled wait; never a down mark | `src/quota-windows.ts` (0057 §8) |
| Round close | Whole-tree P1 scan, build check, close listing before `plan` opens the next round | `src/round-close.ts` (0049) |

### Git and scripts

| Module | Responsibility | Key files |
|---|---|---|
| Unified commit | Recursive driver commits (nested repos first), `Auto-Stage` trailer, clean gate, SHA baseline, rollback primitives | `src/git.ts` (0021) |
| Unit commit | Post-session commit, close-out checks, strict-resume fidelity, unit rollback | `src/unit-commit.ts` (0021, 0022) |
| Driver scripts | `tmp/test.sh` request marker, output capture, watchdog | `src/script.ts` |
| Test run | `--test-by-driver` execution, handover-document archive/cleanup, the context-budget steer (`handoffSteer`, its wall `steerWall`: 2×cap raised to a quarter of a large window, capped at 80% of it) (no session imports) | `src/testrun.ts` (0023, 0056, 0059 D6) |
| .gitignore | Driver work-directory entries | `src/gitignore.ts` |

### Configuration, switches, and project setup

| Module | Responsibility | Key files |
|---|---|---|
| Project config | Constitutional options fixed by init in `.opencode/auto/config.json` | `src/config.ts` (0004) |
| Config fix | The rule table behind `fix`: fixable/manual findings over the raw config and the config-layer artifacts, planned then applied; `renderAgentContract` | `src/config-fix.ts` (0052 D10–D11) |
| Experiment switches | `OPENCODE_AUTO_*` registry, parsed once, never persisted (the `OPENCODE_AUTO_MODELS` path variable is registered but stays out of the parsed switches); a retired variable (`RETIRED_SWITCHES`) answers one run-start notice and is otherwise ignored | `src/switches.ts` (0003, 0055 §9) |
| Shell profile | `setShellProfile`: program name, `configDir`, recovery hints, log audit, agent; `registerAgentAdapter` lets a shell add an agent adapter without a core change | `src/shell.ts` (0055) |
| AGENTS.md block | The opencode-auto marker block, the only content the driver puts in the target's AGENTS.md | `src/agents-block.ts` (0054) |
| reset command | Remove init's configuration artifacts (the project brief only while it is the untouched stub) | `src/reset.ts` |
| Destructive-op guards | Interactive confirmation; clean-worktree gate | `src/confirm.ts`, `src/clean.ts` |

### Run-time controls

| Module | Responsibility | Key files |
|---|---|---|
| Run lock | `.auto/run.lock`: one driver process per directory; re-entrant, stale-pid detection, refusal and status lines | `src/lock.ts` (0053 D1–D3) |
| Step mode | `OPENCODE_AUTO_STEP` pauses at phase/task/subtask boundaries | `src/step.ts` (0012) |
| Graceful exit | `/exit` at the next safe boundary, the wait-and-probe loop's sleep included | `src/exit.ts` (0014, 0057 §6) |
| Hibernate | `OPENCODE_AUTO_HIBERNATE` daily UTC window; the shared booked sleep and 0–600 s jitter the registry window waits and the scheduled wait reuse | `src/hibernate.ts` (0027, 0055 §6.3, 0057 §6) |
| Interactive input | `--interactive` side-channel steer, `--wait-answer` input line | `src/interactive.ts` |
| Model failback | `OPENCODE_AUTO_MODEL_FAILBACK_SCOPE` granularity and `/failback`: the pure boundary arithmetic in `src/failback.ts`, the state (sticky holder, pending order, run-time override, down marks per model and provider key) and the dual registry/no-registry failover decision behind the router service's routing fence | `src/failback.ts`, `src/router.ts` (0017, 0055, 0061 C4) |
| Stuck-loop detection | Repeated-tool-call detection → steer hint | `src/stuck.ts`, `templates/prompts/stuck-hint.md` (0016) |
| Proxy-answer ledger | `AUTO-RESOLVE`/`AUTO-DECISION` collection and reporting | `src/resolve.ts` (0020) |
| Logging | Verbose/audit output, timestamps, log file | `src/log.ts` |

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
| `test/import-direction.test.ts` | Domain classification and dependency-direction rules (above) |
| `test/agent-fake.test.ts` | Agent-neutral driver behavior; fails if any `AgentClient` call goes unexercised |
| `test/incident-regression.test.ts` | Regressions from field incidents |

<!-- auto: eof -->

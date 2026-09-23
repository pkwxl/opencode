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
| Prompt assembly | Turns task/run data into template variables; all copy lives in `templates/prompts/*.md` | `src/prompt.ts`, `templates/prompts/` |

### phases — what a phase is

| Module | Responsibility | Key files |
|---|---|---|
| Phase-type registry | Builtin types and their `--phases` preset letters (admtvk), decompose template, duties key, standard artifacts, gate; phases-value resolution | `src/phases/registry.ts` (0047 §5) |
| Custom phase types | `.opencode/auto/phases/<type>.md` loader | `src/phases/custom.ts` |
| Phase state machine | Round `docs/R-NN/phases.md` index + `P<nn>-<type>/` directories, routing, `completePhase` (todo.md → done.md), round establishment | `src/phases.ts` (0006, 0047 §3–§4, 0048) |

### document — what the files in the target directory mean

| Module | Responsibility | Key files |
|---|---|---|
| Frozen schema | Artifact-spec and role types | `src/document/types.ts` (0031) |
| Role model | `roleOf` path classifier + per-role policies (eof-scan exemption, protect list, handoff checks) | `src/document/roles.ts` (0045) |
| Unit model | Phase/task/subtask refs and paths, todo/done scan and rename, index parsing, `Depends:`/`Touches:` fields, `nextReady` selection | `src/document/unit.ts` (0047) |
| Subtask state protocol | `docs/T-NNN/S<nn>/todo.md` → `done.md` | `src/document/state.ts` (0030, 0045) |
| Artifact specs | `Artifacts:` declaration parsing, spec tables, spec-driven mechanical checks | `src/document/spec.ts` (0034) |
| P1 prohibition scan | Deliverables must not reference process documents | `src/document/process-refs.ts` (0045) |
| Stable paths | Single constructor of task-document and round-directory paths | `src/docpaths.ts` (0010) |
| Shape check | Non-trivial + `<!-- auto: eof -->` last-line criterion (pure) | `src/doccheck.ts` (0026) |
| Read-only guard | chmod driver-owned files during `run` | `src/protect.ts` |
| Round brief | `docs/R-NN/round.md` stub and readers | `src/round-brief.ts` (0049) |
| Project brief | `.opencode/auto/brief.md` stub and planning-input reader | `src/brief.ts` (0052 D9) |

### agent — talking to a coding agent

| Module | Responsibility | Key files |
|---|---|---|
| Interface | `AgentClient` (14 never-rejecting calls), `AgentCapabilities`, `AgentEvent`, `AgentHost` | `src/agent/types.ts` (0037) |
| opencode adapter | SDK calls, SSE → `AgentEvent` mapping, server spawn/connect/restart/timeout; the only importer of `@opencode-ai/sdk` | `src/agent/opencode/{client,events,server}.ts` (0039) |
| claude headless adapter | `claude -p` stream-json process per working session, stdout parser, contract/permission translation, host factory | `src/agent/claude/{client,stream,contract,host}.ts` (0041) |

## Driver

Grouped by layer, top down. The session-driving chain is strictly layered (0024 §D.2): `runner` → `execute` → `exec-session` → `session` → `attempt` → `watch`; lower layers never import upward, and `testrun` never imports the session-driving layer.

### Run entry and loops

| Module | Responsibility | Key files |
|---|---|---|
| Run entry | `runAll`: preflight, agent start, interactive input, Ctrl+C handling, exit codes | `src/loop.ts` |
| Preflight | Prompt library, agent-contract check, stats, read-only guard, handover restore, clean gate, housekeeping commit; `RunAllOpts` | `src/loop-preflight.ts` |
| Phase loop | Phase planning session, phase handover, phase routing | `src/loop-phase.ts` (0006, 0047) |
| Task loop | Iterates a phase's tasks; `LoopCtx` | `src/loop-task.ts` |
| Loop progress | `--wait-between` pause, changed-files watch, subtask heartbeat | `src/loop-progress.ts` (0019) |
| Conclusions | Resume banner, proxy-answer highlight blocks, conclusion lines (text only) | `src/conclusion.ts` (0019, 0020) |
| Agent choice | Which agent a run drives (shell profile > `OPENCODE_AUTO_AGENT` > config > opencode) | `src/agent-choice.ts` |
| Capability degradation | Maps missing `AgentCapabilities` to existing fallbacks | `src/capability.ts` (0040) |
| Usage source | Four `UsageTier`s and their effect on reuse, handover, steer, fork | `src/usage.ts` (0038) |

### Task pipeline and sessions

| Module | Responsibility | Key files |
|---|---|---|
| Task pipeline | `runOnce`/`runTask`: decompose → subtasks (or whole) → wrap-up → closeout; resume, CURRENT.md lifecycle | `src/runner.ts` |
| Execution | Merged understand+decompose session, per-subtask sessions, whole-task session | `src/execute.ts` (0030) |
| Test-handover state machine | `runExecSession`: handover sequence and recovery forks | `src/exec-session.ts` (0023) |
| Session driving | `runSession` retry / server restart / quota failover ring / `awaitRecovery`; `ensureForkBase` | `src/session.ts` (0015, 0017) |
| Single dispatch | Reuse-or-create, model target, resume point, stats segment, wait for idle | `src/attempt.ts` |
| Event stream | Echo, usage tracking, handoff steer, stuck hints, marker collection, test requests, liveness probe, truncation resume | `src/watch.ts` (0026) |
| Session chain and routing | `SessionChain`, phase → role → model routing, error classification | `src/chain.ts` (0017) |
| Session helpers | Fork, usage, liveness, rename over `AgentClient`; terminal formatting; human answers | `src/session-api.ts` |
| Bypass-session skeleton | `requireArtifact`: dispatch → collect → one retry → implicit block; hidden-unit commit boundary | `src/artifact.ts` |
| Wrap-up | Wrap-up session, `Result: PASS\|FAIL` parsing | `src/wrapup.ts` (0044) |
| Knowledge | Knowledge phase and prior-knowledge extraction | `src/knowledge.ts` |
| Implement shortcut | init `--implement-file/--implement-prompt` one-shot planning session | `src/implement.ts` |
| Options and outcomes | Shared opts, `Outcome`/`UnitStop` types, context-budget constants (pure) | `src/opts.ts` |

### Task store, state, and recovery

| Module | Responsibility | Key files |
|---|---|---|
| Task store | Phase `tasks.md` index + `docs/T-NNN/` units, `.auto/units.json` runtime state, no-phase mode | `src/tasks.ts` (0047) |
| Status tree | Read-only round → phase → task → subtask view | `src/status.ts` |
| CURRENT.md | Write/remove the current-task mirror | `src/current.ts` |
| Progress record | `.auto/progress.json`, session reuse on resume | `src/resume.ts` (0018, 0022) |
| Resume gate | Unit-ownership gate, resume/interruption wording | `src/resume-gate.ts` |
| Handover recovery | `.auto/handover.json` breakpoints of a test handover | `src/handover.ts` (0023 §I–§N) |
| Numbering | `--auto-number`, `.auto/next-task` | `src/numbering.ts` (0001) |
| Stats | Cross-interruption cumulative time and tokens, `.auto/stats.json` | `src/stats.ts` (0019) |
| Round close | Whole-tree P1 scan, build check, close listing before `continue` | `src/round-close.ts` (0049) |

### Git and scripts

| Module | Responsibility | Key files |
|---|---|---|
| Unified commit | Recursive driver commits (nested repos first), `Auto-Stage` trailer, clean gate, SHA baseline, rollback primitives | `src/git.ts` (0021) |
| Unit commit | Post-session commit, close-out checks, refcheck gate, strict-resume fidelity, unit rollback | `src/unit-commit.ts` (0021, 0022) |
| Driver scripts | `tmp/test.sh` request marker, output capture, watchdog | `src/script.ts` |
| Test run | `--test-by-driver` execution, handover-document archive/cleanup (no session imports) | `src/testrun.ts` (0023) |
| Reference check | Extract/rewrite/validate document references; `check` scanning | `src/refcheck.ts` (0010, 0013) |
| .gitignore | Driver work-directory entries | `src/gitignore.ts` |

### Configuration, switches, and project setup

| Module | Responsibility | Key files |
|---|---|---|
| Project config | Constitutional options fixed by init in `.opencode/auto/config.json` | `src/config.ts` (0004) |
| Config fix | The rule table behind `fix`: fixable/manual findings over the raw config and the config-layer artifacts, planned then applied; `renderAgentContract` | `src/config-fix.ts` (0052 D10–D11) |
| Experiment switches | `OPENCODE_AUTO_*` registry, parsed once, never persisted | `src/switches.ts` (0003) |
| Shell profile | `setShellProfile`: program name, recovery hints, log audit, agent | `src/shell.ts` |
| AGENTS.md block | The opencode-auto marker block written into the target's AGENTS.md | `src/agents-block.ts` |
| check command | Principle scan of AGENTS.md and open task documents | `src/check.ts` |
| reset command | Remove init's configuration artifacts (the project brief only while it is the untouched stub) | `src/reset.ts` |
| Destructive-op guards | Interactive confirmation; clean-worktree gate | `src/confirm.ts`, `src/clean.ts` |

### Run-time controls

| Module | Responsibility | Key files |
|---|---|---|
| Run lock | `.auto/run.lock`: one driver process per directory; re-entrant, stale-pid detection, refusal and status lines | `src/lock.ts` (0053 D1–D3) |
| Step mode | `OPENCODE_AUTO_STEP` pauses at phase/task/subtask boundaries | `src/step.ts` (0012) |
| Graceful exit | `/exit` at the next safe boundary | `src/exit.ts` (0014) |
| Hibernate | `OPENCODE_AUTO_HIBERNATE` daily UTC window | `src/hibernate.ts` (0027) |
| Interactive input | `--interactive` side-channel steer, `--wait-answer` input line | `src/interactive.ts` |
| Model failback | `OPENCODE_AUTO_MODEL_FAILBACK_SCOPE`, `/failback` | `src/failback.ts` (0017) |
| Stuck-loop detection | Repeated-tool-call detection → steer hint | `src/stuck.ts`, `templates/prompts/stuck-hint.md` (0016) |
| Proxy-answer ledger | `AUTO-RESOLVE`/`AUTO-DECISION` collection and reporting | `src/resolve.ts` (0020) |
| Logging | Verbose/audit output, timestamps, log file | `src/log.ts` |

## Templates

| Path | Contents |
|---|---|
| `templates/prompts/` | One file per session prompt (decompose, subtask, whole, wrapup, phase-plan, phase-handover, knowledge, test-*, …) + `_partials.md`; registered in `src/template.ts` |
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

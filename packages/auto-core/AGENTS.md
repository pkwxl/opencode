# AGENTS.md

Package-level notes for coding agents, kept lean: the index of module → responsibility → key files lives in [docs/structure.md](./docs/structure.md), the design principles (the constitution) in [docs/principles.md](./docs/principles.md), and the core/shell contract in [docs/shell-contract.md](./docs/shell-contract.md); the CLI shell is the `../auto` package.

## Overview

`@opencode-ai/auto-core` is the core library of the auto tool family (no bin): task pipeline, prompt templates, configuration, auto numbering, interruption recovery, unified commit, and other mechanisms are concentrated here and exported via subpaths (`@opencode-ai/auto-core/<module>`) for shell packages to consume. Comments and user-facing messages are written in English, using the terms in [docs/glossary.md](./docs/glossary.md) (Chinese ↔ English).

Distinguish two kinds of knowledge: the task units (`docs/R-NN/P<nn>-<type>/tasks.md`, `docs/T-NNN/`)/`.opencode/auto/config.json`/the `AGENTS.md` block etc. are normative objects the program imposes on the **target directory** at runtime, not file conventions of this repository itself.

## Documentation system (two-tier)

- **Code and comments are the first carrier of design**: structure, invariants, and decision rationale travel with the code.
- `docs/` — only durable overall architecture, design principles, and code-location indexes; updating them requires good reason. The current family: [shell-contract.md](./docs/shell-contract.md) (the branch model and the new-shell checklist), [structure.md](./docs/structure.md) (the full module index), [glossary.md](./docs/glossary.md) (Chinese ↔ English terms), [principles.md](./docs/principles.md) (the constitution — the positioning, the P-numbered principles, the requirement families), [protocol.md](./docs/protocol.md) (the executor protocol's standing single source — every protocol change amends it in the same change, never a numbered plan; enforced by the protocol-doc ratchet `test/protocol-doc.test.ts` here and in auto-server, pinning the doc's vocabularies against the code's constants both directions) and [releases.md](./docs/releases.md) (the design changelog).
- `plans/NNNN-<slug>.md` — numbered design/plan document history (ordered by first git commit date): stage-assist documents that only support development during a specific stage, **retired once obsolete and never maintained to track later changes**; originals are preserved untranslated (historical record); new design documents default to English. [plans/INDEX.md](./plans/INDEX.md) is the corpus manifest — the one maintained file in plans/, indexing every document's subject, standing and principle keys.
- This file records only high-frequency invariants + pointers; mechanism details belong to the numbered plans/ documents, the why of a mechanism to docs/principles.md, the case law to plans/INDEX.md.

## Commands (run inside this package directory)

- `bun typecheck` — `tsgo --noEmit`.
- `bun test` — runs `test/`.

## Build conventions (developing this program)

- **Templates must keep the `with { type: "file" }` import** — the only way shell packages embed them into the binary at compile time. When adding a built-in template, register it in the same change: prompt templates → the embedded registry in `src/template.ts` (shell-added templates go through `registerTemplate`), mode templates → `src/mode.ts`, intent packs → `src/intent/load.ts`, intent bundles → the built-in table in `src/bundle.ts`; init copy templates are registered by the shell.
- `src/templates.d.ts` provides path-string types for `*.md` / `*.json` imports; do not remove `resolveJsonModule: false` from `tsconfig.json`.
- Shells reference this package's TS sources and template files directly via `package.json` `exports` (`"./*": "./src/*.ts"`, `"./templates/*"`); new src files need no exports registration — the open `./*` boundary is ruled (0196 D1: the shape pinned core-side, the specifier the only route from a shell, held by each shell's own boundary scan). **The core does not know shells** (never import any shell package); shell differences are injected exclusively via the `src/shell.ts` profile or parameter passing.

## Core/shell contract

This package is the core; shell packages (`packages/auto`, the general CLI with bin `opencode-auto`, plus each shell branch's simple shell `packages/<name>` — package name and bin are chosen by each shell and not recorded by the core) depend on this package one-way via subpaths; **shell branches must not modify this package** — differences are injected via `setShellProfile`/`registerTemplate`/parameter passing. The branch model (core changes land only on the auto-core branch, shell branches periodically merge auto-core to refresh the snapshot, auto the frozen former integration branch) and the new-shell onboarding checklist are in [docs/shell-contract.md](./docs/shell-contract.md).

## Navigation

Locate by change: topic → key files → the plans that designed it. `NNNN` = `plans/NNNN-*.md`. A number is a pointer, not a summary — what each plan ruled is in [plans/INDEX.md](./plans/INDEX.md), the module detail in [docs/structure.md](./docs/structure.md), the why in [docs/principles.md](./docs/principles.md).

### Executor protocol and daemon (the pull path)

- Executor leases (serial, documentation-scoped same-tree, separate code worktrees) → `src/executor-coordinator.ts` + `src/executor-steps.ts` + `src/executor-worktree.ts` (0246; 0248–0255)
- Grant kinds — `formulate` (0276), `distill` (0277 — produces the handover; `transfer` applies it), `audit` (0278 — a FAIL finding is the person's, never an auto-repair input), `synthesize` (0281) → `src/executor-steps.ts` + `src/executor-coordinator.ts`
- Lease sweeps at every wire act's head — dead-letter reconciliation (0287; 0292) and continuation re-derivation (0289; 0291); the daemon's `reconcile` operation the person's forced arm → `src/executor-coordinator.ts`
- Stop addressing (`actor` on every wait/blocked answer; the menu's `waiting` rows) → `src/executor-steps.ts` + `src/tasks.ts` (`parkedWaiting`) + `docs/protocol.md` (0308)
- Interrupted formulation and pending report recovery → `src/executor-coordinator.ts` + `../auto-server/src/daemon.ts` + `docs/protocol.md` (0300; 0301)
- Synthesis reply grammar and consumed-reply recovery → `src/formulate-synthesis.ts` + `src/executor-coordinator.ts` + `templates/prompts/formulate-synthesize.md` (0299; 0302)
- Formulation synthesis and the obligation ledger → `src/formulate-synthesis.ts` + `src/executor-steps.ts` + `src/executor-coordinator.ts` + `src/formulate.ts` + `templates/prompts/formulate-synthesize.md` (0097; 0281; 0313)
- Historical knowledge digests and the knowledge artifact path check → `src/knowledge.ts` (0303)
- The protocol's standing spec and the protocol-doc ratchet (the wire at `0.1` preview) → `docs/protocol.md` + `test/protocol-doc.test.ts` + `plans/0280-protocol-spec.md`
- The daemon pull-only (the in-daemon deterministic ops) → `plans/0282-daemon-pull-only.md`; the project lifecycle over REST → `plans/0284-project-lifecycle.md`
- Worker-side lease renewal and shutdown → `../auto-server/src/executor-hub.ts` + `prompts/executor.md` (0275)
- The daemon's build identity → `../auto-server/src/version.ts` (0270; 0293)
- The manual floor (`prompts/executor.md` alone — the runbook a coding-agent session reads to claim grants) → `prompts/executor.md` + `src/install-prompts.ts` + `test/manual-prompts-ratchet.test.ts` (0296; 0298)

### Direction and program documents

- Independence direction (the censuses and the seven stages; the demolition gated at stage 5) → `plans/0256-independence-direction.md`
- Executor protocol completion program → `plans/0267-protocol-completion-program.md`
- Pull-only program (the push mode's demolition ordered; the protocol does nothing via push; no ask channel) → `plans/0279-pull-only-program.md`
- The opencode severance (the tool spawns no agent session, ever; `opencode.json` is the person's own file, never the tool's) → `src/config-op.ts` + `src/gitignore.ts` + `prompts/executor.md` + `plans/0296-opencode-severance.md`
- The CLI tombstones (`run`/`plan`/`transfer`/`clarify`/`_lane` are permanent usage tombstones naming the executor surface) → `plans/0283-cli-tombstones.md` + `../auto/src/index.ts`
- The push root's demolition (0309; 0310; 0311; 0312; 0313; 0314; `OPENCODE_AUTO_REMEDIATE` a tombstone) → `src/executor-steps.ts` + `src/executor-coordinator.ts` + `src/transfer.ts` (interrupted handover records) + `src/plan.ts` (interrupted append records)

### Planning and the person's boundaries

- plan's prelude → `src/plan.ts` (0053; 0095; 0101; 0206; 0314)
- Person-bracketed boundaries (`transfer` the single advance command; the round-brief proposal channel) → `src/transfer.ts` + `src/round-brief.ts` + `src/analysis.ts` + `src/roadmap.ts` + `src/plan.ts` (0101; 0114; 0115; 0136; 0158; 0206; 0207; 0209; 0311)
- Open rounds and the maintenance mode family (the `open` roadmap-line kind; the scenario modes `debug`/`fix`/`fork`/`pr`) → `src/roadmap.ts` + `src/analysis.ts` + `src/phases.ts` + `src/phases/registry.ts` + `src/round-brief.ts` + `src/transfer.ts` + `src/plan.ts` + `src/mode.ts` + `templates/modes/` (0243)
- The clarify command (`Clarified: yes`, the person's release act) → `src/clarify.ts` + `src/phases.ts` (0116; 0204; 0207)
- Survey phase and the human gate (`Gate: human`, `Fork:` holding for the person's scoped `Clarified: yes`) → `src/phases/registry.ts` + `src/phases.ts` + `src/analysis.ts` + `src/clarify.ts` + `src/transfer.ts` + `templates/bundles/*/phases/survey.md` (0081; 0085; 0169)
- Assisted planning preparation (the AGENTS.md block's guidance states; `Clarified: yes` releases the analysis) → `src/agents-block.ts` + `src/analysis.ts` + `src/plan.ts` + `src/transfer.ts` + `src/brief.ts` + `src/protect.ts` + `src/switches.ts` (0084; 0085; 0101; 0172)
- Planning input `docs/R-NN/P<nn>-<type>/plan-input.md` → `src/plan-input.ts` + `src/plan.ts` + `src/executor-steps.ts` (0053; 0235); its scaffold → `src/intent/types.ts` + `src/intent/load.ts` (0081; 0158)
- Formulation task (the phase's planning as its first task unit) → `src/formulate.ts` + `src/prompt-plan.ts` + `src/runner.ts` + `src/tasks.ts` (`taskBody`) + `src/chain-transitions.ts` (`setRole`) (0095; 0131; 0141; 0205; 0208; 0217; 0221)
- No-session task add (the daemon's `POST /projects/<project>/tasks`) → `src/task-add.ts` + `src/plan.ts` (0058; 0207)
- Standalone work orders (`--export`/`--adopt`) → `src/work-order.ts` + `src/plan.ts` + `src/testrun.ts` (`dropDeadTestMarker`) (0076; 0206; 0207)
- The round user report (optional) → `src/docpaths.ts` + `src/document/roles.ts` + `src/driver-helper.ts` (0081; 0109)
- The person-proxy brief (`driver-helper [dir]`) → `src/driver-helper.ts` + `src/plan.ts` + `src/phases.ts` + `src/round-close.ts` + `../auto/src/index.ts` (the `driver-helper` row) (0105; 0106; 0107; 0109; 0209)

### Project surfaces and the person's commands

- Project config (constitutional options in `.opencode/auto/config.json`) → `src/config.ts` (0004)
- The `fix` rule table (fixable/manual/info) → `src/config-fix.ts` (0052; 0135; 0136; 0215)
- The shared shell-seam surfaces (the run banner and phases line, the init/amend sequence `runConfigSequence`) → `src/banner.ts` + `src/config.ts`/`src/config-op.ts` + `src/loop-preflight.ts` + `test/fixtures/fake-claude.ts` (0193)
- External-directory allows and the working-directory knowledge boundary → `src/external-dirs.ts` (0122; 0147; 0155; 0188)
- The sealed reference wall (the close held to transfer's advance) → `src/wall.ts` + `src/phases/custom.ts` + `src/protect.ts` (0132; 0155; 0189; 0190; 0266; 0288)
- The project brief (its install committing exactly the brief and its approved source document) → `src/brief.ts` (0081; 0133; 0158; 0207; 0209; 0215; 0236)
- The AGENTS.md block (the driver's only content in the target's AGENTS.md, read-only during run) → `src/agents-block.ts` + `src/protect.ts` + `src/loop-preflight.ts` (0054; 0158)
- Bundle provenance, sync, and charter key ids → `src/provenance.ts` + `src/sync.ts` + `src/bundle.ts` + `src/intent/guarantees.ts` + `../auto/src/index.ts` (the `sync` row) (0100; 0158; 0214; 0215)
- The release gate (clean-tree check + destination scan, read-only) → `src/release.ts` + `src/document/process-refs.ts` + `../auto/src/index.ts` (the `release` row) (0103; 0119; 0173; 0176)
- Close and force-close → `src/close.ts` (0053; 0207)
- Branch isolation and landing (config `isolate`, `land`) → `src/land.ts` + `src/git-land.ts` + `../auto/src/index.ts` (the `land` row) (0073; 0074; 0155; 0192)
- The task retry fork (`fork`/`remove-fork`) → `src/fork.ts` + `src/git.ts` + `src/git-worktree.ts` + `src/loop-task.ts` + `../auto/src/index.ts` (the `fork`/`remove-fork` rows) (0128; 0129; 0139; 0140; 0191)
- Run lock (`.auto/run.lock`; one driver per directory) → `src/lock.ts` (0053; 0183)
- Auto numbering → `src/numbering.ts` (0001; 0150)
- Stable references and round directories (`docs/R-NN`) → `src/docpaths.ts` (0010)
- The shell profile (`setShellProfile`; the `surface`/`surfaceOf` renderers) → `src/shell.ts`

### Task units, pipeline and sessions

- Task store (the phase's `tasks.md` index, the `docs/T-NNN/` units, the `.auto/units.json` runtime) → `src/tasks.ts` (0047; 0158; 0236)
- Phase types → `src/phases/registry.ts`; the survey release's brief install → `src/transfer.ts` + `src/phases.ts` (0236)
- `status` tree (`supersedingPhases`) → `src/status.ts` (0209)
- Task pipeline (`--subtask` off/auto/true/ondemand) → `src/runner.ts` + `src/execute.ts` (0059; 0171; 0211); auto's lead and split → `src/split.ts`; the split's streams → `src/execute.ts` + `templates/prompts/fanout.md`
- Session driving (`src/chain.ts` → `src/session.ts` → `src/attempt.ts` → `src/watch.ts`; the engine in `src/engine/`) (0061; 0185; 0186; 0187)
- Session-chain transitions (the one home of every `SessionChain` write; ratchet `test/chain-writes.test.ts`) → `src/chain-transitions.ts` (0061; 0234)
- Parallel lanes (worktree lanes, stream lanes `T-NNN.S<nn>`) → `src/lanes.ts` + `src/loop-task.ts` + `src/shell.ts` (`laneLauncher`) + `src/git-worktree.ts` (0068; 0125; 0126; 0191; 0210; 0213)
- Run services (`RunServices`, the `services()` allowlist) → `src/services.ts` + `src/router.ts` (0061; 0194)
- Driver-status events and the run-events journal → `src/run-status-schema.ts` + `src/run-status.ts` + `src/engine/events.ts` (0067; 0061; 0212; 0236)
- Fork decomposition and experiment switches → `src/execute.ts` + `src/session.ts` + `src/session-api.ts` + `src/switches.ts` (0003)
- Step mode (OPENCODE_AUTO_STEP) → `src/step.ts` (0012); `/exit` graceful exit → `src/exit.ts` (0014; 0143); the control vocabulary (`Boundary`, the `Interactive` sideband, `requestControl`) → `src/control-types.ts` + `src/interactive.ts` (0061; 0181)
- Hibernate windows (OPENCODE_AUTO_HIBERNATE) → `src/hibernate.ts` + `src/switches.ts` (0027)
- Preflight → `src/loop-preflight.ts` (0236)

### Verification, assurance and lanes

- Completion side (`Result: PASS|FAIL` the only verdict) → `src/wrapup.ts` + `src/runner.ts` (0044; 0170; 0171)
- The driver script runner → `src/script.ts` + `src/testrun.ts`
- Task verification loop and test-channel contract → `src/wrapup.ts` + `src/testrun.ts` + `src/exec-session.ts` + `src/phases/registry.ts` + `src/git.ts`/`src/script.ts` + `templates/prompts/wrapup.md`/`fix.md` + `test/verify-loop.test.ts` (0083; 0142; 0146; 0148; 0184; 0198; 0199)
- The repair-append budget's removal (a FAIL verdict surfaces as state; repairs are the executor's fix grant) → `src/loop-task.ts` (0283)
- The assurance family (the assurance table `docs/assurance.md`; the cover-set gate at round close) → `src/assurance.ts` + `src/close-audit.ts` + `src/round-close.ts` + `src/round-brief.ts` (0244)
- Test lanes, the dependency park, tiered parallelism → `src/intent/test-lanes.ts` + `src/script.ts` + `src/wrapup.ts` + `src/git.ts` + `src/execute.ts` + `src/lanes.ts` (0096; 0171)
- The regression lane, two-level pass → `src/regression.ts` + `src/intent/test-lanes.ts` + `src/script.ts` + `src/wrapup.ts` + `src/loop-task.ts` + `src/loop-preflight.ts` (0098)
- Doc lanes (same-tree concurrency for documentation-scoped units) → `src/lanes.ts` + `src/git-ops.ts` + `src/loop-task.ts` + `src/runner.ts`/`src/wrapup.ts` + `src/git.ts` + `src/prompt.ts` + `src/loop-preflight.ts` + `src/opts.ts` (0099; 0156; 0175; 0210; 0211; 0213; 0237)

### Intent, templates and prompts

- Intent packs (`### <key>` subsections, the `## doc-parallelism` section) → `src/intent/types.ts` + `src/intent/load.ts` + `templates/intents/` (0031–0043; 0126)
- Intent selection and bundles (config `intent`; the family `cleanroom`/`faithful`/`faithful-lean`) → `src/bundle.ts` + `src/config.ts` (0079; 0221); the cleanroom compliance gates → `templates/bundles/cleanroom/` (0121; 0124; 0153; 0154); the lane table's `Evidence:` channel → `src/intent/test-lanes.ts` + `src/script.ts` (0177)
- Intent guarantees and the charter-check family → `src/intent/guarantees.ts` + `src/switches.ts` + `src/charter-clamp.ts` (0080; 0113; 0208; 0220; 0235)
- Blockage prevention and consented remediation (`Choice:` marks in the Decision region) → `src/blockage.ts` + `src/blockage-execute.ts` + `src/charter-clamp.ts` + `src/loop-preflight.ts` (0082; 0156; 0170; 0172; 0198; 0208; 0235)
- Artifact specs → `src/document/types.ts` + `src/document/spec.ts` (0031; 0034); document roles, todo/done state, the P1 prohibition scan → `src/document/roles.ts` + `src/document/state.ts` + `src/document/process-refs.ts` (0045; 0103; 0108); the unified unit model → `src/document/unit.ts` (0047)
- Protocol markers, `registerPartial` → `src/template.ts` (0033; 0220)
- Prompt copy → touch only `templates/prompts/*.md` (`src/prompt.ts` and `src/prompt-plan.ts` only assemble data, plus the two renderer-owned classes 0221 names under P15 — driver document-grammar teaching, first the formulation todo's protocol, and dynamic driver feedback lines naming measured run state); after changes run `bun test test/prompt-exec.test.ts test/prompt-phase.test.ts test/prompt-template.test.ts`
- Driver protocol strings → the registry and flip procedure in `plans/0035-protocol-string-registry.md`

### Agent adapters, models and session roles

- Agent domain (`AgentClient` — no driver file imports `@opencode-ai/sdk`) → `src/agent/types.ts` (0037; 0039; 0055; 0057); the opencode adapter → `src/agent/opencode/` (0039; 0055; 0219); env isolation (X1) → `src/agent/env.ts` (0059)
- claude headless adapter and the agent choice → `src/agent/claude/` + `src/agent-choice.ts` + `src/agent/opencode/server.ts` (`defaultConnect`) (0041; 0055; 0218)
- Capability degradation → `src/capability.ts` + `src/shell.ts` + `src/agent-pool.ts` (0040; 0055; 0218; 0219)
- Agent pool (one host per profile, drained close) → `src/agent-pool.ts` + `src/opts.ts` (0055; 0157)
- Session-role registry (seven work kinds) → `src/roles/registry.ts` + `src/tier.ts` + `src/execute.ts` + `test/roles-registry.test.ts` (0060; 0064; 0069)
- Usage source (four `UsageTier`s) → `src/usage.ts` (0038)
- Model registry and tier routing (push-mode machinery — the session layer's dead path, demolition-docketed) → `src/models.ts` + `src/models-schema.ts` + `src/model-window.ts` + `src/tier.ts` + `src/model-route.ts` + `src/select.ts` + `src/routing.ts` + `src/keyring.ts` + `src/classify.ts` + `src/model-step.ts` + `src/agent-env.ts` + `src/models-describe.ts` (0055; 0061; 0127; 0144; 0163; 0178; 0179; 0217; 0219)
- Staged model routing and quota failover (the single routing path; the role vocabulary's retired words permanent tombstones) → `src/switches.ts` + `src/chain.ts` + `src/router.ts` + `src/session.ts` + `src/failback.ts` (0017; 0055; 0061; 0231)
- Agent-neutral driver tests (the `AgentClient` double) → `test/fixtures/agent.ts` + `test/agent-fake.test.ts` (0042)
- Agent-plane formatters → `src/format.ts` (0069)

### Git, records and recovery

- Unified commit and the unit commit boundary → `src/git.ts` + `src/git-worktree.ts` + `src/git-land.ts` + `src/git-ops.ts` + `src/unit-commit.ts` (0021; 0102; 0170; 0171; 0173; 0174; 0183; 0207; 0236)
- Interruption recovery and the unit-ownership gate → `src/resume.ts` + `src/resume-gate.ts` (0018; 0022; 0145; 0149; 0156; 0183; 0219)
- Test-handover front-loading (`--handover-test`) → `src/testrun.ts` + `src/engine/concerns/test.ts` + `src/exec-session.ts` (0023; 0126)
- Session context handover (OPENCODE_AUTO_STEER) → `src/testrun.ts` + `src/engine/concerns/usage.ts` + `src/execute.ts` + `src/wrapup.ts` + `templates/prompts/usage-note-*.md` + `templates/prompts/{whole,subtask,fix}.md` (0056; 0130; 0143; 0156; 0168)
- Session exceptions and quota windows → `src/chain.ts` + `src/engine/concerns/{failure,recovery}.ts` + `src/session.ts` + `src/quota-windows.ts` (0057)
- Session-failure wait-and-probe loop (OPENCODE_AUTO_RECOVERY_WAIT) → `src/session.ts` (0015)
- Liveness probe, truncated-output resume, shape-check re-prompt fork → `src/engine/concerns/liveness.ts` + `src/session-api.ts` (0026)
- Stuck-loop detection (OPENCODE_AUTO_STUCK) → `src/stuck.ts` (0016)
- Question policy and proxy-answer audit (OPENCODE_AUTO_ASK) → `src/resolve.ts` + `src/git.ts` (`addedLines`) + `templates/prompts/_partials.md` + `src/opts.ts` + `src/engine/concerns/questions.ts` + `src/prompt-facts.ts` (0020; 0081; 0157; 0199)
- Cross-interruption cumulative stats and the task-usage ledger → `src/stats.ts` + `src/stats-schema.ts` + `src/conclusion.ts` + `src/loop-progress.ts` (0019; 0055; 0152; 0212)

### The corpus itself

- Module split and dependency direction (lower layers never import runner; testrun never imports the session-driving layer) → 0024 §D.2; enforced by `test/import-direction.test.ts` — a new cross-module import may need a conscious table edit there
- Retired historical detail (not maintained) → `plans/0029-behavior-historical.md` (the former `docs/behavior.md`), `plans/0050-structure-historical.md`

## Core invariants (read before changing)

The constitution lives in [docs/principles.md](./docs/principles.md) — the summary below is the working layer every change is checked against, one compressed line per principle, full statements there alone. The case law behind each principle is indexed in [plans/INDEX.md](./plans/INDEX.md).

### Principle summary

Tier I — constitutional (removal changes what the tool is):

- **P1 — the deliverable stands alone**: the shipped artifact is exactly what a nested destination repo's git manages; every process-side reference from it (process-document path, bare task id, out-of-root path) is a defect — recorded during rounds as one count, enforced at the person's release moment; the remedy is restatement, never bare deletion.
- **P2 — the person brackets every boundary**: consequential decisions are surfaced for the person and never consumed as closed; every automatic escalation is bounded and terminates at the person.
- **P3 — completion is never judged by agent self-report**: a unit is done only when its artifacts are on disk and committed (or a person closed it); verification is planned, independent, fresh-session work; flow and recovery key on driver-persisted evidence.
- **P4 — committing is the completion condition**: the driver holds the commit right exclusively; the unified commit, the SHA baseline audit, git history as the rollback anchor.
- **P7 — grammars, never content**: the driver checks and writes only mechanical grammars it defines (paths, markers, trailers, field blocks, event streams); content quality is judged by acceptance work, sessions, and people.
- **P18 — the record outlives the tool**: plain files and git are the only durable state; permanent document paths; machine-addressable history; journals best-effort over a committed trail; no lock-in, no special tooling.

Tier II — operating (standing trade-offs, each with choice / default / revisit trigger in principles.md):

- **P5 — single ownership** (absorbs P11): every kind of state and every mechanism has exactly one owning home and exactly one writer; no mirrors, no second sources of truth; duplicates held by ratchets that only shrink.
- **P6 — derived state, idempotence, re-derivation**: prefer state derived from durable evidence over newly persisted state; what persists is minimal; every step idempotent; every recovery re-derives from disk.
- **P8 — deliberate enforcement moments**: detection records (counts, warnings, findings); blocking reserved for the stop's own work and the person's moments; every surfaced line teaches its remedy.
- **P10 — the byte-identical floor**: every opt-in mechanism degrades to the unchanged baseline (unset switches, absent declarations, missing capabilities); ruled defect fixes are the exemption, never masked by a floor.
- **P12 — fail loud; conservative under uncertainty**: failures surfaced, never swallowed into a clean verdict; uncertain readings resolve toward dirty / no-reuse / no-carry; degradation renders its fallback.
- **P13 — frozen additive-only vocabularies**: protocol literals, event vocabularies, exit codes, document grammars change only by conscious lockstep in one change, grow additively, retire through tombstones; never silent dual meanings.
- **P14 — one-way dependencies through declared seams**: the core never knows shells or HTTP; differences inject via profiles/registrations/parameters; layers point downward through entry modules held by ratchets; agent SDKs confined to adapters.
- **P15 — policy is data; governance pinned**: prompt copy in templates, judgment content in packs/bundles; renderers assemble, code never authors copy; the runtime reads materialized surfaces and never interprets intent; committed governance text never floats with the binary.
- **P16 — genericity**: no real project's paths, layout, or special cases enter core or shell code; project facts ride the target's declared surfaces (config, packs, brief, roadmap); the escape is always a structural rule, never an in-code exemption.
- **P17 — declared concurrency**: parallelism admitted on declarations (`Depends:`/`Touches:`), bought at the cheapest fitting isolation tier, bounded by disjoint scopes with one sole writer of shared git state; wrong declarations surface loudly, never as corruption.
- **P19 — measured evidence**: rulings grounded in measured field evidence (incidents, censuses, live probes, cost tables), every claim cited; speculation is not a basis; compensation machinery re-audited on schedule.
- **P20 — in-flight work is never destroyed**: transient faults waited out with accumulated context kept; control changes land only at safe boundaries; heuristics advise before they enforce; probes never pollute the real session.
- **P21 — machinery waits for its consumer**: interfaces, generality and mechanisms are built when a real consumer locks the shape; a reserved surface is a name, never a half-built mechanism; speculative generality is recorded as cost, never accrued silently.

### Requirement families carried here (hard, testable; ids never reused — P9 lives on its surfaces, the counts-not-lists presentation convention)

- **Security family** (P16's secrets half, demoted to a requirement — AGENTS.md keeps carrying it): registry keys are references, never literals — a key is `{env:NAME}` or `{file:path}`, refused otherwise; a registry profile's env values are literal (`~` expanded) or references by design (0055 §4.2) and are never printed. The driver never reads a referenced value into anything it builds — the reference reaches the managed opencode server through the spawn config and is substituted in the server's own process; a resolved env value goes only into that child's environment. Logs and error lines name the name or the reference (`key 2/3 ZHIPU_KEY_B`, `env: HTTPS_PROXY`), never a value; a server URL is shown without its user information and a mis-pasted `.env` line's echo stops at the first `=` (one `displayUrl` rule — 0180), and every child the driver runs spawns over the scrubbed base (X1's letter extended, the spawn census the ratchet — 0180). The registry's project layer is local-only: preflight refuses a layer git would commit (naming `fix` — its gitignore line the operator's own), and nothing but the operator writes either layer.
- **No environment-specific knowledge in tool source, ever** (P16's enforcement example, standing): facts about a particular target project never enter `auto-core`/`auto`/shell code; mechanisms stay generic, and project-specific facts ride only the surfaces the target directory itself declares (config `scanExempt`, intent packs and bundles, `brief.md`, the roadmap). A change that would need to name a real project is the signal to find the structural rule instead.

### Development conventions (this repository's own build rules)

Rules governing this repository's own development — not the tool's behavior contract; the tier test keeps them out of the constitution (plans/0111, F2/F3):

- Behavior-preserving changes prove themselves: pure moves, splits and dedups run under byte-identical goldens and pinned outputs (0032 F9, 0034 D4, 0102).
- One ingredient per change during relocations — no dedup mid-move; every step ends green and interruptible (0024).
- Stage-assist waves run always-green per session; the person commits at command boundaries (0010/0011's convention, standing as this corpus's practice).
- Requirement intake (0123): a change is processed through its requirement family, never through the surfaces an incident happened to touch — answer the boundary from [docs/principles.md](./docs/principles.md) first (a corpus search is never the first move), name the family and enumerate its home-set ([plans/INDEX.md](./plans/INDEX.md) by P-id, [docs/structure.md](./docs/structure.md) by module; grep measures after the principle answer), write the ruling with its Category scope section (Derives/Amends + tier, 0110 D5), enact category-complete with code home and test home in the same change (0110 D13), and land the INDEX row and navigation line with it.
- Premise guard (0167): a ruling that changes a surface a standing rule rests on states `premises this ruling changes: <ids>` in its decision block — the prior rulings whose premises the change invalidates — and re-reads each in the same change, amending explicitly or recording why it stands; advisory grammar, no parser reads it (the bite at review and audit time).

### Operational specifics (pure vocabulary and mechanics a coding agent needs at a glance; details live with their mechanisms)

- Task units in the target directory (`src/tasks.ts`): the phase's `tasks.md` is order and membership only (`- [ ] T-NNN <title>`); the unit files (`todo.md`/`done.md`, exactly one) win over its ticks; the checklist lives only in `docs/T-NNN/subtasks.md`; runtime state (status, attempts, fork base) is `.auto/units.json`, never a document. A planned `todo.md` carries the title line, a `Phase: R-NN.P<nn>` field and `## Goal`/`## Scope`/`## Acceptance` (`taskTodoSpec` in `src/document/spec.ts`). Format changes sync `test/tasks.test.ts`, the planning templates and the shell package's README.
- The executor surface needs no coding-agent CLI: the coordinator spawns nothing (its only child the worker computing the protocol's answers), and the agents that work a project are external coding agents claiming grants, each bringing its own host and model (0296). The push-era session layer still carries the `opencode`/`claude` adapters — `opencode serve` spawned, or `--server` to reuse an instance, or the `claude` CLI on PATH — as demolition-docketed dead path (0297+); the binary itself bundles neither.
- Exit codes (P13): `0` complete / `1` usage or environment error / `2` blocked or reverted to pending for human attention / `3` `/exit` under `--interactive`, paused at a safe boundary (rerun to recover) / `130` force-quit by two consecutive Ctrl+C / `143` SIGTERM, `129` SIGHUP — the supervisor's stop through the same force-terminate cleanup (0182).
- Constitutional project attributes (-m/--agent/--context-limit/--subtask/--idle-time/--idle-max/--test-by-driver/--handover-test/--auto-number/--no-auto-number/--wrapup/--no-wrapup/--phases/--parallel/--scan-exempt/--isolate/--tree-lanes/--intent) are fixed into the target directory `.opencode/auto/config.json` by init only — changed per key by `amend` (the `phases` key excepted: init-stamped machinery, `amend --phases` retired — a round reshapes by its roadmap line, m mode the compatibility floor), repaired by rule by `fix` (which never resets a key); appearing at run time is exit 1; a bad config file fails strictly, unknown keys are ignored; retired flags and keys are permanent tombstones (usage errors / strict failures). init validates everything before its first write, refuses where git cannot commit (the unified commit is the completion condition), and writes the `.gitignore` set (driver workdir, local-only files `/.env`/`AGENTS.md`, every nested git repository) — the `.gitignore` itself the one committed project surface (the ignore-set law); `opencode.json` is the person's own file, never the tool's — written, read, ignored, protected and named nowhere, its gitignore line the person's own; `AGENTS.md` stays local, re-derived from the committed config at every run start; fix reconciles the set and strips the retired `/.gitignore` self-entry — the entries removed again by `reset` (a pre-0138 file's retired lines left as the person's). The migration source and target are intent, stated in the brief.
- Driver-exclusive state writes: the index ticks and the `todo.md` → `done.md` renames are written only by the driver (under parallel lanes the parent re-derives the ticks at landing); AI sessions must not edit them; during `run` the config files, the project brief and AGENTS.md are read-only (`src/protect.ts` lets the driver's writes through). AGENTS.md holds only the driver's block; there is no task mirror.
- Unified commit (P4): AI sessions must not run commit-type commands; after a session ends the driver commits all changes recursively (nested sub-repos first, then this repository); unified commit failure blocks and halts for human attention; starting an execution unit (and run start) requires a clean worktree — driver-state leftovers self-heal, untracked driver-workdir files (`.auto/`, `tmp/`) are never dirt (the ignore law read ahead of the set's arrival; a tracked workdir file still blocks, and the carryover never absorbs the workdir, 0141), other dirty areas block for human, resumed runs exempt (an active progress record makes the uncommitted changes the interrupted unit's resumable progress at run start too — the resumed unit's close commits them, 0149); close-out validates via the SHA baseline that the commit range contains only driver commits (`Auto-Stage` trailer; under lanes the landings add `landing`/`landing-sync`/`merge-repair`). **Committing cannot be turned off** — any `--commit` form is a usage error; the commit side idles only under dryrun and in non-git environments (tests install the no-commit double through the git service seam).
- Experiment switches read the environment only, never persist to disk (P13): the `OPENCODE_AUTO_*` layer (parsed in `src/switches.ts`, zero CLI shell changes) writes no state files; experiment semantics = this run only; constitutional keys do not enter ProjectConfig before promotion.

## Maintaining this document

Keep it lean: new mechanisms add one short navigation line (topic → key files + plans pointer; ruling narration belongs to the numbered document and INDEX, module detail to docs/structure.md) or one operational line here; mechanism details go into a new numbered plans/ document; principle statements live in docs/principles.md alone; the docs/ family is updated only with good reason. A navigation line is never narrated: what a plan did, its fix chains and its retirement notes stay in the numbered document and its INDEX row — extending a line adds a pointer, not a summary.

Derivation discipline (plans/0110): every new plans/NNNN document states its derivation — one consolidated Derives paragraph covering every decision block is the corpus's settled form (0225) — each block carrying `Derives: P-NN` (with the showing clause — where the principle shows in the change) or `Amends: P-NN` (the principle restated, provenance carried), plus the tier touched. A ruling that matches no principle is resolved before landing — the constitution incomplete → fix the set, or the ruling drifting → fix the ruling. Boundary questions are answered from docs/principles.md, never by searching the corpus.

<!-- auto: eof -->

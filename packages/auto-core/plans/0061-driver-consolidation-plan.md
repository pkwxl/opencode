# 0061 — Driver consolidation, ruled: rulings, engine scaffolding and the migration runbook

Status: **plan, ruled 2026-09-28; nothing implemented.** This document rules the open questions of 0060 (revision 2) and turns 0060 into an executable program. 0060 keeps its diagnosis, its goals (§0, §2, §3's boundary) and its guardrails (D7). Where the two disagree, this document wins; §2.3 lists every decision of 0060 that is replaced here. The runbook (§6) is a strangler-fig program of 38 units in six stages. Each unit is one normal work unit with its own tests, the suite is green after every unit, and the program can stop at any stage boundary and leave a consistent codebase.

## 0. The answer in one paragraph

0060 names the right disease: god functions, hidden process state, a dual routing path and a stalled domain migration. Its central cure does not hold up against the code. In `watch()` the statement order carries safety rules: when the test-handover freeze commit may happen, which steer wins at a measurement point, and when truncation continuation is allowed. Two inputs, the liveness probe timer and the classifier's answer, also reach the loop outside the event stream. Moving that code into "registered policy objects owning their own state" would turn those rules into implicit registration order and bring the races back. The consolidation is therefore rebuilt around **four explicit objects**:
- **a turn spine** with one input queue, an explicit `TurnState` split into single-writer slices, and a declared **arbitration table**. Concerns do I/O only through a capability object (`TurnFx`) that the spine audits.
- **a pure ladder decision** (`nextStep`) plus **named `SessionChain` transitions**. These replace the 163 field writes spread over nine files, and the scope includes `attempt()`.
- **`RunServices`**, a constructed holder for the decision state that today lives in module singletons. It has a written construction order.
- **logical sub-domains** enforced by the direction test instead of physical moves.

Before any of that come prunes and test seams. They retire refcheck and `check` (with the texts every session is told), two dead experiment paths, and the timer-bound tests. After them the full suite runs in about 22 s on the gate machine, so every unit is gated on the whole suite under a budget relative to a recorded baseline (§5.1); a separate fast lane is a convenience, not a gate. Equivalence is proven mechanically, not argued: the prompt goldens, the agent-fake call recordings, a new **turn-trace oracle** recorded from today's `watch()` before its first cut, and `test/incident-regression.test.ts` kept untouched until the last unit.

## 1. Facts this plan is built on

Measured at auto-core `91da1e515` (2026-09-27) on the machine that runs the gates. They correct or extend 0060 §1. Line anchors refer to that commit.

| # | Fact | Evidence | Consequence for the plan |
|---|---|---|---|
| F1 | Four functions exceed 500 lines, not two: `watch` 1,073, `runSession` 922, `attempt` 708, `runTask` 557 | `src/watch.ts:103`, `src/session.ts:248`, `src/attempt.ts:80`, `src/runner.ts:92` | `attempt()` is in scope (§4.7); `runTask` is left alone, since the pipeline is not a target of this program |
| F2 | `watch()` holds 37 `let` bindings, 6 mutable collections, 3 mutated parameters (`TestRun`, the usage source, the stuck tracker) and 1 module `WeakMap` | `src/watch.ts:88`, `:469`, `:341` | The state has to be declared (§4.3 `TurnState`); it cannot be hidden in policies |
| F3 | Two inputs arrive outside the event stream: the probe timer and the classifier's answer. Both preempt the loop through a shared `trip()`. The stream wrapper's cleanup depends on which of them fired | `src/watch.ts:551`–`:576`, `:256`–`:266`, `:549`, `:599` | One input queue with synthetic inputs (§4.4) |
| F4 | Statement order carries safety rules: the freeze commit happens only at an idle nothing else consumed; the hard wall suppresses notices and the step-up; truncation continuation is blocked once an error was seen; an idle steer ends the quiet point; a measurement point can send **two** steers (a notice, then a step-up) | `src/watch.ts:448`–`:470`, `:740`–`:757`, `:763`–`:790`, `:1092` | The arbitration table reproduces this order as data (§4.5). The rule is "one steer per quiet point **at an idle**", not everywhere |
| F5 | `SessionChain` has 20 fields and is written at 163 sites in 9 files. The fork-source choice is copied 4×, the no-registry model priority chain 4× | `src/chain.ts:207`; `src/session.ts:453`, `:552`, `:656`, `:1106`; `src/session.ts:384`, `:651`, `src/unit-commit.ts:198`, `src/attempt.ts:444` | Named transitions and a write ratchet (§4.8) |
| F6 | State lives at six lifetimes: turn, dispatch, ladder, unit (`SessionChain`), process (module singletons) and persistent (`.auto/*.json`) | code reading | One owner per lifetime (§4.1) |
| F7 | Decision state sits in module singletons: down marks, sticky model and override (`src/failback.ts:61`–`:93`); key rings (`src/keyring.ts:65`); the classifier's cache, in-flight calls and budget (`src/classify.ts:292`); the model-step claims (`src/model-step.ts:154`); the logged windows (`src/watch.ts:88`); the exit flag (`src/exit.ts:19`); the prompt globals (`src/prompt.ts:28`, `:40`). 14 test files call `reset*` hooks, 19 counting the `set*`/`use*` ones | grep | These move into `RunServices` (§4.9). File mirrors (stats handles, the tasks queue, quota-window cache, lock) stay process-level |
| F8 | Switches are not a read-only snapshot. `clampSwitches` mutates the memo at pool start (`src/agent-pool.ts:130`, `:178`); the registry must be set before the first parse (`src/loop-preflight.ts:181`); `watch` reads `autoSwitches().ask` beside its own `switches` parameter (`src/watch.ts:836`); `OPENCODE_AUTO_SERVER` is read raw and appears on no switch line (`src/agent-pool.ts:148`, `src/agent/opencode/server.ts:135`) | grep | The construction order is written down and the snapshot frozen after the clamp (§4.9); `SERVER` is registered (R18) |
| F9 | `Opts` (23 fields) is hand-built in 7 literals with different field sets. The planning, handover and knowledge literals leave out `idleMs`, so their probe interval ignores config `idleTime`. The handover-distillation literal also leaves out `mode`, which nothing on that path reads | `src/loop-phase.ts:104`; readers `src/watch.ts:574`, `src/prompt.ts:808` | Builder first, reproducing each literal; the merge is a separate ruled change (R12) |
| F10 | `FROZEN_IMPORTS` has 7 entries. Only `prompt` and `phases` import driver modules | `test/import-direction.test.ts:223` | Emptying it needs two inversions, not seven moves (§6 E2, E3) |
| F11 | The direction test does not see `import("./x")` type expressions, and counts `import { type A }` as a value edge. Counting type edges, one SCC exists: `exit ↔ failback ↔ interactive ↔ step` | `src/opts.ts:192`, `test/import-direction.test.ts:490` | Fix the holes before any new ratchet leans on them (A2) |
| F12 | `check` duplicates `fix`'s AGENTS.md-block findings (`src/config-fix.ts:195`–`:204`); its principle scan ① is a regex heuristic; its layer ② is refcheck | `src/check.ts` | R1 |
| F13 | Retiring refcheck also touches paragraph 3 of the AGENTS.md block every target receives (`src/agents-block.ts:44`), the wrap-up instruction (`templates/prompts/wrapup.md:16`–`:19`, pinned by goldens), `script/fix-refs.ts` with its `package.json` script, the shell's `check` output, README and e2e cases, and `docs/glossary.md`, `docs/structure.md` and `docs/shell-contract.md`. `REF_CHECK` is off by default, so the block text is already false on default runs | grep | R6 rules the new texts |
| F14 | The retired `commit: false` path survives as 29 `opts.commit` gates in 10 files (`src/config.ts:39`–`:44`). Tests use `commit: false` 28× to skip git. `test/incident-regression.test.ts` passes `commit: true` 5× | grep | A git seam first, then deletion; `Opts.commit` stays as an ignored field until F4 (R13) |
| F15 | Prior knowledge: the reader is live (`src/loop-plan.ts:260`); the producer `extractPriorKnowledge` has no caller in this repository's shell | grep | R16 |
| F16 | The suite has 1,750 tests and takes **32.06 s** wall on the gate machine (29.8–33.5 s over five runs). Four timer-bound tests take 10.29 s (`test/script.test.ts:80`–`:86`, `test/agent-pool.test.ts:418`, and one `test/agent-claude.test.ts` wait). 85% of tests run under 10 ms, 1.46 s together. `watch.test.ts` takes 0.09 s, `session.test.ts` 0.32 s, `agent-fake.test.ts` 3.83 s for 102 tests and grows by about 0.3 s per new lead/split case. 0060's 139 s comes from another platform (per-exec latency on macOS) | driver test logs | R5; A1 |
| F17 | `agent-fake.test.ts`'s call-coverage roster works only because bun runs one file's tests in order and `agents` is file-level state (`test/agent-fake.test.ts:3005`) | test source | agent-fake is not split (§5.4) |
| F18 | The only live shell is `packages/auto`, updated in the same change. The frozen `migrate` and `auto` branches never merge auto-core again. The recorded precedent is to move files without re-exports and add an absorb note (`docs/shell-contract.md`) | `git` | No shims (R9) |
| F19 | The extraction targets are the busiest files: in the week before, `watch.ts` had 23 commits, `session.ts` 20, `attempt.ts` 19 | `git log` | Hold rule (R19) |
| F20 | 20 logged runs of 2026-09-23..27 set only `OPENCODE_AUTO_AGENT` (14×) and `OPENCODE_AUTO_HIBERNATE` (2×) | the `⚙` switch lines in `.auto/logs/` | Evidence for R2's tranche 1, together with the design reasons given there |

## 2. Rulings

Each ruling states the call, the alternatives rejected, the reason, whether users see a change, and the unit where it lands (§6).

### 2.1 The five questions of 0060 §10

**R1 — `check` (0060 D5h): retire the command; give `fix` a `--dryrun`.**
- Ruling:
  - `check` becomes a retired command. It answers a retirement notice and exits 1 before any other check, as `continue` does. Notice: `check is retired: the principle scan and the reference check were removed; <bin> fix --dryrun <dir> lists the configuration findings`.
  - The principle scan's regexes are deleted.
  - `fix --dryrun` plans and prints the findings, writes nothing, and exits 0 when there are none and 1 when there are any. It skips the gates that only guard writes: the clean-tree check, the confirmation and the run-lock refusal. It keeps `fix`'s other refusals, including the legacy-layout refusal, so the old exemption that let `check` run on a legacy layout ends with the command.
- Rejected:
  - "Dissolve `check` with no replacement": a scripted gate on config drift would lose its exit code.
  - "Keep `check` as a read-only alias over `fix --plan`": no read-only `fix` mode exists to alias. An alias would keep two names for one listing.
  - The new spelling `--dry-run`: the shell already spells "do not act" as `--dryrun`.
- Why: the heuristic scan is content policing (0060 §3 line 2). Its useful half already lives in `fix`. The commit principle is enforced mechanically at close-out: foreign commits are rejected (`src/git.ts:387`).
- Visible: yes, a command retires and a flag is added. Lands in A4.

**R2 — Switch diet and the single routing path (0060 D5c/d).**
- Tranche 0, code paths only:
  - `OPENCODE_AUTO_REF_CHECK` retires with refcheck (A3).
  - The dead `commit: false` path goes after the git seam (C6, R13).
  - `OPENCODE_AUTO_SERVER` is registered (R18, A2).
- Tranche 1, retired in A6:
  - `OPENCODE_AUTO_REUSE_SESSION`: it is default off; it contradicts the fresh-session-plus-handover design of 0056/0059; it has no recorded use (F20); and its branch sits in the middle of `attempt()`'s dispatch decision, which B3 decomposes.
  - `OPENCODE_AUTO_HANDOVER_CONCURRENT`: it is default off; it is racy by construction (the tests face the freeze snapshot while the session writes); it has no recorded use; and it adds a cross-session in-flight test (`TestRun.running`) to both `watch` and `attempt`.
  - Both keep their default behaviour: no reuse, sequential test handover. Interruption recovery's takeover of the recorded session (`resumed`) is not part of the switch and stays.
- Kept: every other switch. `FORK`, `FORK_BASE`, `DECOMPOSE_FINE` and `TASK_CONTEXT` were ruled days ago in 0059. `STEER` and `STUCK` are kill switches for live mechanisms. `STEP`, `HIBERNATE` and `AGENT` are in use. `RETRY_WAITS`, `RECOVERY_WAIT`, `ASK` and `STRICT_RESUME` are operator policy. `MODEL` and `MODEL_FAILBACK_SCOPE` have registry semantics.
- The single routing path:
  - The dual path is first **fenced** behind the router service (C4), so every registry/no-registry branch sits in one module. Today there are 79 branch sites in 9 files.
  - It is then **retired by an implicit registry** (F2). A run with no registry layer synthesizes one from the env switches: one entry per model string in `OPENCODE_AUTO_MODEL`/`_FALLBACK` on the run's agent; routes from the `OPENCODE_AUTO_MODEL` key grammar, which registry routes already share (`src/model-route.ts:31`); the `_FALLBACK` ring as the tier list's order; no windows, key rings or classifier; and an entry without a model (the agent's default) where nothing routes. `MODEL_FAILBACK_SCOPE` keeps its registry meaning (down-mark scope), which 0055 §6.4 designed to subsume the phase-sticky holder.
  - No switch retires for this: the env switches become the implicit registry's source.
  - Allowed drift, all of it on the no-registry path: the `◈`/`⇄` lines take the registry form, the `models` command shows the implicit registry, and `stats.json` gains per-model and per-tier buckets.
- Rejected:
  - "At the next major version": the package is 0.0.0 and private, and has no release process.
  - "Make `init` write a default registry file": it adds a file to every target for something that can be synthesized in memory.
  - "Retire `_FALLBACK`": a feature would be lost when data can carry it.
  - "Mine the switch lines for an observation window before any retirement": the two tranche-1 retirements rest on design reasons that do not depend on usage, and F20 finds no counter-evidence.
- Visible: yes. Two switches retire with a notice (R17), and the no-registry log lines change in F2. Lands in A2, A3, A6, C4, C6 and F2.

**R3 — Memory service vs a declarative knowledge phase (0060 §5.5, D5f): neither in this program; measure and bound.**
- Ruling:
  - A7 books, per planning session, the sizes of `prevRoundDigest` and `priorKnowledgeDigest`, and counts knowledge-phase use in `stats.json`.
  - A7 also caps the injected digest. Above 25% of the run's context limit (by the same token estimate the usage source uses), the planning prompt gets the index form instead: the path and size of each knowledge document and handover, and one line asking the session to open what it needs.
  - The memory service is not funded until those counters show digests near the cap in real rounds.
  - The knowledge phase stays as it is. The one imperative hook keyed on `hasTasks: false` (`src/loop-phase.ts:425`) is generalized only when a second task-less phase type appears.
- Rejected:
  - Funding the service now: no data. The counters that would justify it do not exist.
  - Converting the k phase now: it is already a registry entry, and a one-member abstraction adds cost.
  - An uncapped digest: whole `kb.md` files plus the last handover are injected with no bound today.
- Visible: only when the cap trips, which no current workload reaches; the goldens stay below it. Lands in A7.

**R4 — Order of the post-consolidation directions (0060 §5.2, §5.4, §5.6): RunEvent first, then the role registry, then parallel execution.**
- RunEvent is redefined as two parts:
  1. an **input log** at the engine's I/O seam: turn inputs, `TurnFx` results and clock readings, in order. It is the basis for replay; the decision log cannot be, because decisions are outputs. F1.
  2. **decision events**: the effects the spine executes, as typed JSONL in the gitignored `.auto/run-events.jsonl`. F1.
- `stats.ts` is **not** rewritten as a fold over events (R14).
- The role registry (0060 §5.6) gets its own numbered design after this program. It sits on the engine and the services.
- Parallel execution (0060 §5.4) comes last, behind its own design for per-unit worktrees. A unit's commit takes the whole tree, and concurrent units in one worktree would take each other's half-written files; that is a file-contract change, not a scheduling one.
- Visible: a new gitignored state file (F1). Lands in F1.

**R5 — Lane policy (0060 §6): every unit is gated on the full suite, held under a machine-independent budget; the fast lane is a convenience.**
- Ruling:
  - The unit gate runs both typechecks and the **whole** auto-core suite (`bun run test:gate`). The gate fails when its wall time exceeds **baseline × 1.25**, where the baseline is the suite's wall time recorded by A1 and re-measured in F3 (§5.2) — a relative budget, so the gate runs on whatever machine executes the units, and there is no second class of unit. The absolute 30 s figure stays the gate-machine reference, not the rule.
  - The `unit` lane (pure and in-memory files, 5 s budget) exists for focused iteration, never gates a unit, and stays the dev-loop gate on every machine.
  - The shell's e2e joins the gate for units that touch a shell-visible surface, and at every stage exit.
- Rejected:
  - "A < 30 s fast lane per unit": after A1 the whole suite already fits in 30 s on the gate machine, so a fast gate would only skip the repository-backed tests where the commit-boundary invariants live.
  - "Gate only the policy units": every unit of this program touches invariants.
- Why: F16. The 139 s is a dev-loop problem on another platform; the `unit` lane serves it.
- Visible: no. Lands in A1 (seams, lanes, budget) and F3 (final pass).

### 2.2 Rulings on questions the verification raised

**R6 — The texts refcheck's retirement changes (0060 D5g's byte-for-byte claim).** The target contract changes in exactly two texts, and in no other way.
- AGENTS.md block, paragraph 2 (`src/agents-block.ts`): the parenthesis after the `@<sha>` example ends at "meaning that range is valid only for that historical revision"; the clause "and is exempt from line-number checking" is dropped.
- AGENTS.md block, paragraph 3 is replaced by: "3. Checking: DRIVER neither checks nor rewrites references. Confirm that a path exists before you write it, and keep the references your task touches valid — that is part of the task's own work and of its acceptance."
- `templates/prompts/wrapup.md`: the sentences from "— broken references are caught by the DRIVER's reference check" through "do not alter references that already carry a marker yourself;" are replaced by "— the DRIVER does not check references afterwards;". The rest of the item is unchanged.
- The block is local-only and rendered again by `run`/`fix`, so no target commit changes.
- Rejected: leaving the texts unchanged, which makes a false statement permanent (it is already false on default runs).
- AUTO-RESOLVE: may the refcheck retirement change what every target session is told (block paragraphs 2–3, the wrap-up instruction), given 0060's claim that the target contract stays byte-for-byte? -> yes, exactly these two texts, in one unit (A5) (the claim cannot hold with refcheck gone; keeping texts that describe a removed checker misinforms every session, and the block is local-only, so no committed file changes).
- Lands in A5.

**R7 — 0060 D2/D3 are replaced by a turn spine and a ladder decision.**
- `watch()` becomes a spine that runs **concerns** in the order of a declared arbitration table (§4.4, §4.5). Each concern owns one slice of an explicit `TurnState` and does I/O only through `TurnFx`.
- `runSession()`'s ladder becomes a pure `nextStep` plus an executor. `attempt()`'s dispatch decision becomes a pure `planDispatch` (§4.7).
- The two do **not** share policy objects: they live at different lifetimes (turn vs ladder). They share only vocabulary, namely `ErrorClass`, `ErrorInfo`, `WaitCause` and `SessionResult` from the engine contract.
- Rejected:
  - Stateful registered policies (0060 D2): ordering becomes registration order, and async callbacks mutate private state again (F3, F4).
  - Pure reducers with every I/O as a synthetic result input: the idle test protocol alone would become a six-state machine, and lifting the code out of `watch()` would be a rewrite instead of a move.
- AUTO-DECISION: concerns are async handlers over a capability object (`TurnFx`) instead of pure `(state, input) → effects` reducers (decisions in the quiet points depend on I/O results mid-decision — the handoff document, `tmp/test.sh`, the freeze commit's result, a human answer, the lazily fetched context limits — so the capability form lets each branch move out of `watch()` nearly verbatim, while the spine still audits every effect and a fake `TurnFx` keeps concern tests in memory).
- Lands in D0–D9 and B3–B4.

**R8 — 0060 D5a (merge the four control files) is replaced by a type extraction.**
- `Boundary` (`src/step.ts:22`) and `Interactive` (`src/interactive.ts:17`) move into a new leaf `src/control-types.ts`. The SCC disappears, and the direction test gains a no-cycle rule that counts type edges.
- The down marks leave `failback.ts` for the router service in C2.
- Rejected: the 721-line merged module, which would have 15 importers and pull `node:readline`, stats and switches into `select`, `routing`, `keyring`, `classify` and `unit-commit`.
- Lands in A2.

**R9 — 0060 D6 (re-export shims) is dropped; no physical move is required.**
- New modules land where they belong (`src/engine/` for the spine and its contract).
- The two flat provider-domain files that import driver modules are fixed by inversion (E2, E3), not by moving them.
- If a later change still wants a move, it follows the recorded precedent: move, update `packages/auto` in the same change, and add one absorb note to `docs/shell-contract.md`.
- Rejected: shims. They protect no live consumer (F18), and they cost CLASSIFIED/FROZEN entries, relative template imports and hundreds of path mentions in docs.
- Lands in —.

**R10 — 0060 D1 becomes logical sub-domains.**
- The direction test gains a `SUBDOMAIN` column for driver modules: `contract`, `kernel`, `engine`, `pipeline`, `policies` and `runtime`.
- It also gains an allowlist of edges between sub-domains, seeded with today's edges, which may only shrink.
- `contract` is a leaf below both `engine` and `policies`: `src/engine/contract.ts` and `src/chain.ts` (types and pure functions only).
- Entry modules are named per sub-domain, but no barrel file is created.
- Rejected:
  - Entry barrels: a kernel entry would re-export 129 symbols to 40 importers and bound nothing.
  - Physical sub-domain directories: R9.
- Lands in E1.

**R11 — 0060 D4 becomes `RunServices`, owned by lifetime.**
- One constructed object holds the run's decision state: `clock`, `router`, `control` and `git`. Prompt state is carried by `PromptFacts` (E2).
- It is built once in preflight in a written order: registry → parse switches → fleet → degradation clamp → freeze switches → router → control → git. `runAll` installs it for the run.
- `services()` is an ambient accessor, allowed only in entry modules listed by a ratchet (§4.9). Tests get a fresh instance per test from the preload.
- `SessionChain` stays the unit's mutable state, now behind named transitions. `Opts` stays the per-session immutable configuration, built by one builder.
- Rejected:
  - A separate `UnitContext`: it would duplicate `SessionChain` and `Opts`.
  - Threading `RunServices` through every signature: `test/incident-regression.test.ts` calls the positional engine entries and stays untouched.
  - A god `Run`: it holds no behaviour.
- AUTO-DECISION: run-wide services are reached through an installed ambient instance at a ratchet-listed set of entry modules, not threaded as a parameter (one run per process is an existing invariant — one driver, one directory, one lock — and the positional engine entries that tests and the incident suite call stay stable).
- Lands in C1–C5.

**R12 — `Opts` literals: equivalence first, then one ruled merge.**
- C7 first introduces `sessionOpts(ctx, site)`, which reproduces each of today's 7 field sets exactly, pinned by a table test.
- In the same unit, as its last step, every site then gets `idleMs` and `mode`.
- The only observable effect: the probe interval of planning, handover-distillation and knowledge sessions follows config `idleTime` (default 10 minutes, the same as today's fallback). `mode` is inert on those paths (F9).
- AUTO-RESOLVE: should planning, handover-distillation and knowledge sessions probe liveness at the configured `idleTime` like task sessions, instead of the built-in 10 minutes? -> yes (the key is documented as the probe interval, the difference shows only when a project sets `idleTime`, and one builder with per-site exceptions would keep the accretion the builder exists to end).
- Lands in C7.

**R13 — The `commit: false` path.**
- C6 introduces a `GitOps` seam in `RunServices`. Tests that passed `commit: false` to skip git install a no-commit double instead. Then the 29 `opts.commit` gates, `RunAllOpts.commit` and `ProjectConfig.commit` are deleted.
- The config tombstone stays: a stored `commit: false` or `"none"` still fails strictly, and a stored `commit: true` loads and is ignored.
- The shell stops passing `commit` to `runAll`, with an absorb note.
- `Opts.commit` remains as an **ignored** optional field until F4, because `test/incident-regression.test.ts` passes `commit: true`. F4 deletes it together with those five literals, the only edit that file gets in the program.
- AUTO-RESOLVE: may the core drop `commit` from its option and config types (a shell-contract change), given that `commit: false` is already a strict failure? -> yes, with the tombstone check kept and an absorb note (the only live shell is updated in the same unit; no stored config changes meaning).
- Lands in C6 and F4.

**R14 — 0060 D5e.**
- `models.ts` is split into its schema and types (`models-schema.ts`) and its load/merge/validate half (`models.ts`) in E4. The two are separable and 932 lines is past one reading.
- `stats.ts` is **neither split nor rewritten as an event fold.** Its supposed "reporting half" does not exist (reporting already lives in `conclusion.ts` and `loop-progress.ts`). After D, its bookings come from three executor points. A fold adds replay-consistency risk to cross-interruption state and gains no reading set.
- Lands in E4.

**R15 — The 0060 §3 doctrine is restated as a grammar criterion.**
- The driver may judge and write only grammars it defines: paths, markers, trailers, index lines, field blocks, and the agent event and tool-call streams. It never judges or rewrites the meaning of prose.
- Kept under this line: doccheck, the P1 scan, artifact specs, the round-close gates and the stuck detector (a tool-call stream grammar).
- Retired: `check` ① and refcheck's rewrite, recovery and `@sha` layers. Refcheck's existence layer passes the line but goes on cost and benefit (off by default, heuristic path shapes).
- This replaces 0060 §3 line 3 ("would this check still exist if sessions finished reliably?"), which would have classed the stuck detector as acceptance work.
- Lands in A5 (the docs).

**R16 — Prior knowledge stays a shell-contract API.**
- The reader stays: a `docs/R-NN/prior-kb.md` a shell produces or a person writes is still injected, and A7 counts it and caps it with the digest. The producer `extractPriorKnowledge` stays exported for shells.
- Nothing is wired or retired, and block paragraph 1 keeps naming the file.
- Rejected:
  - Retiring the reader: that would drop a working input path.
  - Wiring the producer into the core: it is the shell's startup step by design.
- Lands in —.

**R17 — Retired switches warn instead of failing.**
- `switches.ts` gains a registry of retired switch names. A set retired variable prints `⚠ <NAME> is retired (<reason>); the variable is ignored` at run start and changes nothing.
- Rejected: a usage error like a retired config key. Switches are per-run experiments read from the environment, and a stale shell profile should not cost an unattended run.
- AUTO-RESOLVE: should a retired `OPENCODE_AUTO_*` switch fail the run (as retired config keys do) or be ignored with a notice? -> ignored with a one-line notice (switches never persist and are this-run-only by contract; failing an unattended run over a leftover environment variable costs more than it protects).
- Lands in A3.

**R18 — `OPENCODE_AUTO_SERVER` is registered.** It joins `SWITCH_ENV` beside `models`: a URL, not a parsed switch, kept out of `Switches`. The four raw reads use the constant, and the startup switch line names it when set. Visible: one more item on the startup line when the variable is set. Lands in A2.

**R19 — Hold rule for the busiest files.**
- While a stage is open, the files on its hold list (§6.2) take no feature work outside the program's units.
- A feature that must land there during the hold is written against the new seams. If the seam does not exist yet, the feature waits for the stage exit.
- Why: F19. Strangler cuts and feature edits in the same file cannot both be reviewed as "pure moves".
- Lands in §6.1.

### 2.3 What this document replaces in 0060

| 0060 | replaced by |
|---|---|
| D1 entry modules as import gates | R10 (logical sub-domains, no barrels) |
| D2, D3 (registered stateful policies; one set composing watch and the ladder) | R7, §4 |
| D4 `Run` with seven named services; switches "read-only after parse" | R11, §4.9 |
| D5a controls merge | R8 |
| D5b "`FROZEN_IMPORTS` empties" in S1 | E2, E3 (inversion, stage E) |
| D5c, D5d | R2 |
| D5e | R14 |
| D5f, §5.5 | R3 |
| D5g (unchanged in substance) | R6 adds the texts and the full inventory (A3–A5) |
| D5h | R1 |
| D6 shims | R9 |
| §3 line 3 | R15 |
| §6 lanes and the stage-S5 consolidation pass | R5, §5, F3 |
| §7 stages S1–S5 | §6 stages A–F |
| §8 "roughly 7×" | §8 (about 3.5–4× for the worked example) |

## 3. The equivalence contract

### 3.1 Byte-for-byte surfaces (every unit)

Every surface below is held byte-for-byte **minus the §3.2 rows** — one exception list, uniformly, as the prompt goldens already read — so A7's new counters and F1's `.auto/run-events.jsonl` (both §3.2 rows) drift inside the contract, not against it.

- The target file contract: `docs/T-NNN`, the indexes, `todo.md`→`done.md`, `.auto/units.json`, `progress.json`, `handover.json`, `windows.json`. Commit subjects, trailers and the commit sequence per scenario.
- Rendered prompts (the goldens under `test/golden/`), exit codes, and the `AgentClient` call sequence per scenario (the native fake's `calls`).
- The log lines tests assert. Under D, the whole log and vlog sequence of every turn-trace scenario (§3.3).

### 3.2 Allowed drift (exhaustive; each item belongs to exactly one unit)

| drift | unit |
|---|---|
| The shape of the direction test's failure messages; new ratchet tests | A2, B1, C1, E1 |
| `templates/opencode.json` loses its duplicate `"model"` keys. The parsed value is unchanged: the last occurrence is kept | A2 |
| The startup line names `OPENCODE_AUTO_SERVER` when it is set | A2 |
| Retired-switch notices; refcheck's state file removed; the `⚖`/`ℹ` lines refcheck printed are gone | A3 |
| `check` answers its retirement notice; `fix --dryrun` exists | A4 |
| AGENTS.md block paragraphs 2–3 and the wrap-up item (R6); the goldens that render them | A5 |
| No reuse or concurrent test-handover lines; two retired-switch notices | A6 |
| A capped digest above the threshold; new stats counters | A7 |
| Probe interval of planning, handover and knowledge sessions = config `idleTime` | C7 |
| No-registry `◈`/`⇄` lines in the registry form; `models` shows the implicit registry; per-model stats buckets without a layer | F2 |
| `.auto/run-events.jsonl` exists | F1 |

Everything else is a regression. A unit that finds it needs drift not listed here stops, and the drift becomes a ruling recorded in §10 before the unit continues.

### 3.3 How equivalence is proven
- **Goldens:** `test/golden.test.ts`. Regenerating them is allowed only in units whose drift row names a prompt (A5, A7).
- **Agent-fake recordings:** `test/agent-fake.test.ts` stays unsplit, and its roster stays last (§5.4).
- **The turn-trace oracle (D0):**
  - Scenarios drive `watch()` directly over a finite scripted `AgentEvent` stream, with the native fake, the injected clock (C1), a log and vlog capture, and a temporary repository for the test-protocol scenarios.
  - Each trace is the ordered `AgentClient` calls with their arguments, the captured lines with timestamps stripped, and the returned `Watch` (with `durationMs` dropped and `pendingReset` resolved). Traces are stored under `test/golden/turn/`.
  - They are recorded from the pre-D `watch()` and **not regenerated during stage D**.
  - The last case of the file is a roster: every arbitration-table cell (§4.5) fired in at least one scenario.
- **The ladder decision table (B4):** `nextStep` is tested row by row. `test/session.test.ts` and the scheduled-wait and failover cases of agent-fake stay unchanged.
- **The incident suite:** `test/incident-regression.test.ts` stays byte-identical from A1 to F3. F4 makes the one mechanical edit R13 names.

## 4. Architecture and scaffolding

### 4.1 Lifetimes and their owners

| lifetime | holder after the program | today |
|---|---|---|
| turn (one `watch`) | `TurnState` (slices, §4.3) + immutable `TurnContext` | 37 locals of `watch()` |
| dispatch (one `attempt`) | `DispatchPlan` (pure) + the attempt executor's locals | locals of `attempt()` |
| ladder (one `runSession`) | `LadderState` (`i`, `tried`, `clipped`) | locals of `runSession()` |
| unit | `SessionChain`, written only through `src/chain-transitions.ts` | 163 write sites |
| run/process decision state | `RunServices` (`clock`, `router`, `control`, `git`) | module singletons (F7) |
| process file mirrors | unchanged modules: the stats handles, the tasks queue, the quota-window cache and writer, the lock, the shell profile and adapters | same |
| persistent | the `.auto/*.json` files and the target documents | same |

### 4.2 New modules

| module | sub-domain | role |
|---|---|---|
| `src/control-types.ts` | contract | the `Boundary` and `Interactive` types (A2, leaf) |
| `src/chain-transitions.ts` | engine | named `SessionChain` transitions, `forkSources` and `modelOfChain` (B1) |
| `src/engine/ladder.ts` | engine | the pure `nextStep` (B4) |
| `src/engine/dispatch.ts` | engine | the pure `planDispatch` (B3) |
| `src/services.ts` | runtime | `RunServices`, `createServices`, `installServices`, `services()` (C1) |
| `src/router.ts` | policies | the router service: down marks, sticky/override, key rings, the classifier's state, step claims, logged windows (C2–C4) |
| `src/engine/contract.ts` | contract | `TurnInput`, `TurnState`, `TurnFx`, `Concern`, `Advice`, `Arbitration` (D1, leaf over types) |
| `src/engine/spine.ts` | engine | the queue, the arbitration, the fx audit and the finalize procedure (D1) |
| `src/engine/fx.ts` | engine | the production `TurnFx` over `AgentClient`, testrun, unit-commit, handover and stats (D1) |
| `src/engine/sources.ts` | engine | the probe timer and classifier-answer sources (D1) |
| `src/engine/concerns/*.ts` | policies | one file per concern (D2–D8) |
| `src/models-schema.ts` | policies | the registry types and schema (E4) |

`watch.ts`, `attempt.ts` and `session.ts` keep their exported names and positional signatures for the whole program. They are the engine's entry points and also its facades.

### 4.3 The engine contract (sketch; `src/engine/contract.ts`)

```ts
// Inputs, in one queue. External inputs come from the agent's stream; synthetic
// ones from the engine's own sources. Nothing else reaches a concern.
export type TurnInput =
  | { kind: "event"; event: AgentEvent }                     // external
  | { kind: "stream-end" }                                    // external: exhausted without an idle
  | { kind: "probe"; ok: boolean; at: number }                // synthetic: liveness probe verdict
  | { kind: "answer"; answer: ClassifierAnswer | undefined }  // synthetic: the classifier's reply

// One slice per concern; the slice key is the concern's name. A concern gets its
// own slice mutable and every other slice read-only (TurnView), so a second writer
// is a type error.
export type TurnState = {
  guard: { idleHandled: boolean }
  transcript: { lastText: string; lastMessage?: string; seen: Set<string>; billed: Set<string>; usage: Usage; modelReported: boolean; fresh?: string }
  windows: {}                                                 // reads the router's logged windows
  stuck: {}                                                   // the tracker lives in TurnContext (dispatch lifetime)
  questions: { autoAnswered: string[]; resolves: ResolveEvent[] }
  failure: { error: string; retryable?: boolean; info?: ErrorInfo; retrying: boolean }
  recovery: { answer?: ClassifierAnswer; asked?: Promise<ClassifierAnswer | undefined>; raised?: ErrorClass; final?: { cls: ErrorClass; classified: boolean } }
  liveness: { probeFailures: number; halfOpen: boolean; quietUntil?: number; lastFinish?: string; lengthContinued: number }
  usage: { pct: number; used: number; limit?: number; wall?: number; hinted: boolean; notes: Set<number> }
  stepUp: { model?: string; step: number; reached?: { step: number; model: string } }
  test: { handover: boolean; asked: boolean; retried: boolean }
}
export type SliceKey = keyof TurnState
export type TurnView = { readonly [K in SliceKey]: Readonly<TurnState[K]> }

// Immutable per-turn facts: the client and session, steer and test protocol
// inputs, the policy, the classifier handle, the steer context, the switches,
// the services, the label.
export type TurnContext = { /* … built once by watch() from its parameters … */ }

// The only I/O path. The spine wraps the production fx to audit it (§4.4).
export type TurnFx = {
  steer(text: string, model?: string): Promise<boolean>  // default model = view.stepUp.model; feeds the usage source
  replyQuestion(request: string, answers: string[][]): Promise<void>
  rejectQuestion(request: string): Promise<void>
  replyPermission(request: string, reply: "always" | "reject"): Promise<void>
  abort(): Promise<void>
  askHuman(timeoutMin: number | undefined, hint: string): Promise<string | undefined>
  contextLimits(): Promise<ReadonlyMap<string, number>>  // memoized per turn: today's `limits ??=`
  readText(path: string): Promise<string>
  exists(path: string): Promise<boolean>
  commitFreeze(n: number): Promise<SessionCommit>        // kernel
  runTest(): Promise<TestRunInfo>                        // kernel
  resolveTest(): Promise<PendingTest | undefined>        // kernel
  saveHandover(record: Handover): Promise<void>
  statsModelEvent(kind: "stuck"): Promise<void>
  onModel(model: string): void
  onLimit(event: LimitEvent): void
  log(line: string): void
  vlog(line: string): void
  now(): number                                          // RunServices.clock
}

// What a concern tells the spine after handling an input.
export type Advice =
  | "pass"                     // nothing consumed; the next row runs
  | "consumed"                 // this input is done; later rows do not run (the `continue` of today)
  | { settle: Settle }         // the turn ends; for synthetic inputs held to the next boundary
export type Settle =
  | { kind: "natural" }
  | { kind: "blocked"; question: string; invalid?: boolean }
  | { kind: "error"; cls: ErrorClass; classified: boolean }  // the early settlements (retry verdict, raised)
  | { kind: "interrupted" }                                 // the stream ended, or half-open

export type Concern<K extends SliceKey> = {
  name: K
  initial(ctx: TurnContext): TurnState[K]
  handle(input: TurnInput, own: TurnState[K], view: TurnView, fx: TurnFx, ctx: TurnContext): Promise<Advice>
  finalize?(own: TurnState[K], view: TurnView, fx: TurnFx, ctx: TurnContext): Promise<void>  // the settle procedure's steps
}
```

The `Watch` result type and `SessionResult` do not change. `snapshot(view, extra)` reproduces today's `snapshot()` (`src/watch.ts:169`) from the slices.

### 4.4 The spine: queue discipline and runtime invariants

1. **External inputs run to completion.** The spine takes one external input, runs its table row, and awaits every fx call the handlers make before it takes the next one. This is today's backpressure: the `for await` body does not pull while it awaits.
2. **Synthetic inputs are handled as they arrive, even while an fx call is in flight.** Only concerns whose row is declared `concurrent` (`liveness` for probes, `recovery` for answers) handle them. They may write their own slice and log, and nothing else: the audit rejects any other fx call on a synthetic input. A `settle` they return is **held** and wins at the next boundary, before any queued external input. This matches today:
   - the probe callback mutates its counters and logs while the loop awaits a steer, a human or a test run;
   - `raised` stops the loop at the next event (`src/watch.ts:605`);
   - on a half-open stream no external input arrives.

   AUTO-DECISION: a held settle beats external inputs already queued at the boundary (today this is a race between `inner.next()` and `trip` that only the classifier path resolves explicitly; the half-open premise is that nothing arrives, and settling first is the conservative reading of both).
3. **The stream wrapper is moved verbatim.** Cleanup skips `inner.return()` exactly when the turn settled by half-open or by a raised class (`src/watch.ts:599`). `consuming` turns false when the wrapper finishes, and later answers are ignored.
4. **Audit invariants, which throw as programming errors:**
   - (a) A kernel fx call (`commitFreeze`, `runTest`, `resolveTest`) after any `steer` in the same idle quiet point.
   - (b) A second `steer` in the same idle quiet point.
   - (c) An fx call other than `log` or `vlog` from a synthetic input.
   - (d) Any write outside the handler's own slice. This one is impossible by type; it is also checked by freezing the other slices in test builds.
5. **The finalize procedure** runs once, in table order: the recovery's raised settle, then liveness (the interrupted or half-open message and the abort), then recovery's final classification. Then `snapshot`.

### 4.5 The arbitration table (initial content = today's statement order)

Rows run top to bottom. "Stop" means the handler's `consumed` or `settle` ends the input.

| input | rows (concern — what it does here) |
|---|---|
| `limit` | windows — log the window line if changed, `onLimit`; consumed |
| `part` | guard — reset · failure — model output ends retrying and drops the stated limit fields · liveness — output ends the announced silence; `step-finish` records the finish reason and resets the length count · stepUp — cache-claim observation on `step-finish` · transcript — billing dedup; a final text part sets `lastText` (stop); `describePart`, `seen` and the fresh flag · stuck — a newly seen completed or errored tool part: stats event, hint steer (failure ignored) |
| `message` | guard — reset · transcript — `lastMessage`, `onModel` once, the filter (stop unless a new completed assistant message) · usage — measurement (`fx.contextLimits`); the hard wall steers and **stops** (failed dispatch: settle blocked); else the highest new notice band steers (failed: settle blocked) · stepUp — a live figure past the step-up point: record, then steer the next id (failure ignored) |
| `question` | questions — every question path of today (humanQuestions, `--wait-answer`, auto-answer, repeat, permission); may settle blocked after reject and abort |
| `permission` | questions — the dryrun deny, `auto-allow`, the `ask-*` modes; `ask-fail` settles blocked after abort |
| `error` | guard — reset · failure — accumulate (text, retryable pessimism, `ErrorInfo` with the limit statement, terminal) · stepUp — a late step-up on an overflow class |
| `retry` | guard — reset · failure — accumulate, retrying = true · recovery — the pattern verdict with the classifier consult; quota (not per-minute), auth or rate: abort and settle error · stepUp — a late step-up on overflow · liveness — the announced silence line and window · transcript — the retry vlog, deduplicated by `seen` |
| `idle` | guard — **stop** if already handled · test — (only with a test run) the protocol: may call kernel fx, steers and stops, or settles blocked or invalid · liveness — truncation continuation (steers and stops; failed dispatch: settle blocked) · spine — settle natural |
| `stream-end` | spine — settle interrupted |
| `probe` (concurrent) | liveness — failures, the quiet-window exemption, half-open → held settle interrupted |
| `answer` (concurrent) | recovery — record the answer; while retrying on an undecided failure, raise → held settle error |

Table rules, checked by `test/turn-arbitration.test.ts`:
- Every input kind has a row.
- Every concern appears in some row.
- A concern that may steer at `idle` is placed after `test`, or stops the input when it steers.
- A new concern is one file, one slice, its table cells with a declared position, its suite and its roster cells.

A ninth concern therefore states its rank explicitly. That rank is the honest price of the invariants (F4).

### 4.6 Strangling `watch()`

- **D0** records the oracle from the unchanged function.
- **D1** installs the spine, the sources, the fx and the audit, with **one** concern, `remainder`, that owns every slice and holds today's loop body, cut into per-input handlers. The probe timer and the classifier answer become synthetic inputs in this unit. That settles the single-queue requirement before any concern moves.
- **D2–D8** each move one or two concerns out of `remainder` into their own files and table cells. Each also re-homes the matching `watch.test.ts` cases that assert mechanics into a concern suite over a fake `TurnFx`, and deletes the originals in the same unit, so the suite never holds duplicates.
- **D9** deletes `remainder`.
- `remainder` is a compatibility layer (§4.11). It shrinks monotonically, and `test/turn-arbitration.test.ts` asserts that its owned slices are exactly the ones not yet extracted.

Extraction order, from least to most coupled:
1. guard, transcript, windows, stuck
2. questions
3. failure
4. recovery
5. liveness
6. usage and stepUp
7. test (the kernel effects go last)

### 4.7 The ladder and the dispatch plan

```ts
// src/engine/ladder.ts — pure; runSession executes the step.
export type LadderState = { i: number; tried: string[]; clipped: string[] }
export type LadderFacts = { registry: boolean; ringLength: number; waits: number[]; server: boolean }
export type Step =
  | { kind: "return"; result: SessionResult }
  | { kind: "window-wait"; wait: WindowWait }
  | { kind: "recover"; why: string; cause?: WaitCause }
  | { kind: "escalate"; label: string; until?: number; classified?: boolean; cause: WaitCause }  // key → model → recover
  | { kind: "after-ladder"; cause: WaitCause }                                                 // model failover, else recover
  | { kind: "retry"; nth: number; waitMinutes: number; restartServer: boolean }
export function nextStep(result: SessionResult, ladder: LadderState, facts: LadderFacts): Step
```

- The executor keeps today's side effects in their places: `accountAnswered` on success, `learnFailure` before the escalation, `lateReset`, the network restart, and the backoff sleep. The sleep goes through `clock.sleep`; `Bun.sleep` today, with the same non-interruptible semantics.
- `switchModel`, `rotateProviderKey`, `awaitRecovery`, `pauseForExit` and `waitForWindow` stay executor functions, rewritten over the chain transitions.
- `attempt()` gets `planDispatch(chain, facts) → DispatchPlan`. The plan holds `resumed`, `reuse` (after A6 it is `resumed` only), the registry pick, or the blocked result for empty, wait and probe; the agent move, with its note; and whether a create clears the failback scope.
- The executor keeps the order of creation, subscription, claim, prompt race, booking and promotion or restoration exactly as today (`src/attempt.ts:284`–`:767`).

### 4.8 Chain transitions (`src/chain-transitions.ts`)

| transition | fields written | replaces |
|---|---|---|
| `forkSources(chain)` | none; returns the sorted list | 4 copies (F5) |
| `retryOnFork(chain, forked, source, note)` | pending, pct, used, note (keeps `id`) | the ladder retry |
| `moveOnFork(chain, forked, source, note)` | id↓, pending, pct, used, note | failover, key rotation, recovery |
| `toBlankSession(chain, note)` | id↓, pct, note | the four blank fallbacks |
| `toAgent(chain, note)` | id↓, pending↓, failed↓, pct, note | cross-agent moves (`src/session.ts:417`, `src/attempt.ts:235`) |
| `dropStaleFailed(chain, id)` | failed↓ when it matches | the in-loop cleanup |
| `consumePending(chain)` | pending↓ | `src/attempt.ts:284` |
| `bindAgent(chain, agent)` | agent | `src/attempt.ts:329` |
| `setRoute(chain, route)` / `resetRoute(chain)` | model, modelEntry, modelStep | the pick; session-scope failback |
| `stepTo(chain, step, model)` | modelStep, model | `src/attempt.ts:572` |
| `promote(chain, id, watch, at)` / `restoreRetryable(chain, prior, failed)` / `afterTestHandover(chain)` | id, pct, used, at, hinted, wall, failed | `src/attempt.ts:606`–`:743` |
| `modelOfChain(chain, switches, phase)` | none; the no-registry priority chain | 4 copies (F5) |

`test/chain-writes.test.ts` scans `src/` for assignments to a `SessionChain` field outside `src/chain-transitions.ts`, against a per-file count table. The table may only go down, and it reaches zero at B5. Object-literal construction of a new chain is not a write.

### 4.9 `RunServices`

```ts
export type RunServices = {
  readonly clock: Clock      // now(), sleep(ms) (not interruptible), sleepUnlessExit(ms), timer(ms, fn) → cancel
  readonly router: Router    // decision state of routing and recovery (F7)
  readonly control: Control  // the /exit request and its sleepers
  readonly git: GitOps       // the commit-side operations the kernel and engine call (C6)
}
```

- Construction happens in preflight, in this order: registry → `setSwitchModelRegistry` → parse → fleet start → `clampSwitches` → **freeze the snapshot** → router (reads the registry and switches) → control → git. `runAll` installs the result and uninstalls it in its `finally`. The order is asserted by a preflight test.
- `services()` returns the installed instance, else a process default built by `createServices()`. It may be called only from the modules listed in `SERVICE_ENTRIES` (`test/import-direction.test.ts`), which starts as: `loop-preflight`, `loop`, `session`, `attempt`, `watch`, `interactive` (the `/failback` handler) and `agent-pool`. The list may only shrink.
- `test/preload.ts` installs a fresh `createServices()` before each test. The `reset*` hooks of moved state are deleted in the unit that moves it; `test/services.test.ts` fails if one reappears.
- Stays process-level by design: the per-directory write queues and file caches (stats handles, the tasks queue, the quota-window cache and writer, the lock), `protect`, the shell profile and adapter registry, and `log`. They mirror files or the process's single terminal and identity, and a second instance would break their serialization.
- AUTO-DECISION: `log` stays a process module with no sink service (the terminal and the log file are per process; tests already capture it with `spyOn(console, "log")`, and §5.7 of 0060 only needs `log` to be the boundary, which it is).

### 4.10 Sub-domains and direction ratchets (E1, with the A2 holes fixed first)

- A `SUBDOMAIN` column is added to CLASSIFIED for driver modules. The members are:
  - `contract`: `chain`, `control-types`, `engine/contract`.
  - `kernel`: `tasks`, `git`, `unit-commit`, `numbering`, `lock`, `stats`, `resume`, `resume-gate`, `handover`.
  - `engine`: `watch`, `attempt`, `session`, `exec-session`, `session-api`, `chain-transitions`, `engine/*` except the contract and the concerns.
  - `policies`: `engine/concerns/*`, `router`, `usage`, `quota-windows`, `classify`, `stuck`, `model-step`, `capability`, `failback`, `step`, `hibernate`, `exit`, `interactive`, `select`, `routing`, `model-route`, `model-window`, `tier`, `keyring`, `models`, `models-schema`, `models-describe`.
  - `pipeline`: `runner`, `execute`, `split`, `loop*`, `plan*`, `close`, `task-add`, `wrapup`, `artifact`, `knowledge`, `testrun`, `script`, `conclusion`, `status`.
  - `runtime`: `switches`, `log`, `services`, `opts`, `config*`, `agent-*`, `shell`, `lock`, `protect`, `gitignore`, `agents-block`, `check` (until A4).
- `SUBDOMAIN_EDGES` allowlists the edges between sub-domains, seeded from the measured graph. The list may only shrink. Two edges are forbidden outright: `contract` → any other sub-domain, and `engine` → `pipeline`.
- `RANK` gains the new engine modules below `attempt`.

### 4.11 Compatibility layers

| layer | purpose | introduced | removed | removal check |
|---|---|---|---|---|
| retired-switch registry entries | notice instead of silence for a leftover variable | A3, A6 | never (it is the contract of R17) | — |
| `Opts.commit` as an ignored field | keeps `test/incident-regression.test.ts` untouched | C6 | F4 | typecheck with the field gone |
| free-function delegators over a moved singleton | let one unit convert its callers | inside C2–C5 only | the same unit | `test/services.test.ts` (no delegator exports) |
| the `remainder` concern | holds the not-yet-extracted turn code | D1 | D9 | the arbitration test: `remainder` owns no slice |
| the pre-D turn-trace goldens | the equivalence oracle | D0 | never (they become the engine's regression traces) | — |
| the no-registry half behind the router fence | one seam before deletion | C4 | F2 | grep: no `opts.routing` truthiness branch left in `src/` |

## 5. Tests and lanes

### 5.1 The gate contract (R5)
- **Unit gate:**
  - `bun typecheck` in `packages/auto-core` and `packages/auto`.
  - `bun run test:gate` in `packages/auto-core`: the whole suite, failing above **baseline × 1.25** wall. The baseline is the suite's wall time recorded in the lane manifest — booked by A1, re-measured in F3 — so the budget is machine-independent (a changed gate host re-records its baseline); the absolute 30 s figure stays the gate-machine reference, not the rule. The `unit` lane (5 s) stays the dev-loop gate everywhere.
  - `bun test test/e2e.test.ts` in `packages/auto` when the unit touches a shell-visible export, the shell or a template.
  - The unit's own done-when checks (§6.3).
- **Stage exit gate:**
  - The unit gate plus the e2e.
  - The goldens unchanged since the stage started, except for §3.2 rows.
  - `test/incident-regression.test.ts` byte-identical since A1 (until F4).
  - Every ratchet at its stage target (§5.3).

### 5.2 Lanes (A1)
- `test/lanes.ts` assigns each test file to `unit` or `repo`.
  - `repo`: the file creates a repository or spawns a process. In practice it imports `test/fixtures/runner.ts`'s repository helpers or calls `Bun.spawn`.
  - `unit`: everything else.
- Budgets live in the manifest: `unit` 5 s (the dev-loop gate on every machine); `gate` (both lanes) baseline × 1.25, the baseline being the suite's wall time recorded by A1 and re-measured in F3 — machine-independent, with the absolute 30 s figure as the gate-machine reference only.
- `test/lanes.test.ts` fails when a test file is missing from the manifest or listed twice, or when a listed file does not exist.
- `script/test-lane.ts <unit|repo|gate>` runs `bun test` over the lane's files, prints the wall time and exits 1 over budget. The package scripts are `test:unit`, `test:repo` and `test:gate`; plain `bun test` still runs everything.
- The shell's e2e is its own lane in `packages/auto`.
- Expected after A1: `unit` about 2 s, `gate` about 22 s. The headroom absorbs the program's new suites; an overrun fails the gate of the unit that caused it.

### 5.3 Ratchets added by the program

| ratchet | file | target |
|---|---|---|
| no cycle, type edges included; `import()` types and `import { type … }` seen as type edges | `test/import-direction.test.ts` | A2: zero cycles |
| chain writes outside the transitions | `test/chain-writes.test.ts` | B5: zero |
| no raw `Date.now()`, `Bun.sleep` or `setTimeout` in `watch`, `attempt`, `session` or `engine/*` | `test/services.test.ts` | C1: zero |
| `services()` callers ⊆ `SERVICE_ENTRIES`; no `reset*` export for moved state | `test/services.test.ts` | C5 |
| arbitration table well-formed; `remainder` slices shrink to none | `test/turn-arbitration.test.ts` | D9: `remainder` gone |
| turn-trace roster: every table cell fired | `test/turn-trace.test.ts` (last case) | D9 |
| `SUBDOMAIN_EDGES` only shrinks; contract is a leaf; no engine → pipeline edge | `test/import-direction.test.ts` | E1 |
| `FROZEN_IMPORTS` is gone; flat provider-domain files obey the domain rule | `test/import-direction.test.ts` | E3 |
| lane manifest complete; budgets | `test/lanes.test.ts`, `script/test-lane.ts` | A1 |

### 5.4 Re-homing rules
- A case moves when its unit extracts the mechanism it asserts, and the original is deleted in the same unit, so no case exists twice.
- `watch.test.ts` and `session.test.ts` keep only cases about their entry behaviour (the spine's order, the ladder's composition).
- `test/agent-fake.test.ts` is **not split.** It is the end-to-end layer, its roster depends on file order (F17), and new engine behaviour is tested in concern suites over a fake `TurnFx`, which is faster than a new agent-fake case (F16). The program adds agent-fake cases only where a unit changes end-to-end behaviour (A6's retirements delete some).
- The per-policy call-coverage assertion of 0060 §6.2 no longer stands as written: it is **replaced by the concern suites over a fake `TurnFx`** — a concern's fx-call coverage is proven in its own suite over the fake, while agent-fake stays unsplit with the one file-level roster it has today (F17).
- F3 audits for duplicates across `watch`, `session`, agent-fake and the concern suites, and deletes the duplicates.

## 6. Runbook

### 6.1 Rules of engagement
1. One unit = one work unit (its own task document), taken in the order below. Units carry the ids used here.
2. **Touch set:** a unit changes only the files its row names, plus the tests and docs it lists. The shell (`packages/auto`) is touched only by units whose row says so.
3. **Stop rule:** a regression outside §3.2 found during a unit is fixed inside the unit, or the unit stops. A drift that is really needed becomes a ruling line in §10 first.
4. **Hold list (R19):** while a stage is open, the files in its hold column take no feature work outside the program.
5. **Records:**
   - Every unit adds a line to §10 of this document: what landed, the test files, and any `AUTO-DECISION`/`AUTO-RESOLVE` taken.
   - The package `AGENTS.md` navigation and `docs/structure.md` follow in the unit that lands a mechanism.
   - Comments in code restate the reason; they do not point at this plan's unit ids.
6. **Rollback:** each unit's commits can be reverted alone, in reverse order within its stage. No unit leaves a half-converted mechanism across units, and every compatibility layer of §4.11 closes inside its stated unit.

The program is a feature freeze on the hold-listed files for its duration, and that calendar price is part of the approval.

### 6.2 Stages

| stage | units | depends on | hold list | exit gate beyond §5.1 |
|---|---|---|---|---|
| A — prune and measure | A1–A7 | — | `refcheck`, `check`, `unit-commit`, `agents-block`, `switches`, `script`, `attempt` (A6), `watch` (A6), `exec-session` (A6) | zero SCCs; lanes in place; `gate` within its §5.1 budget |
| B — chain and ladder | B1–B5 | A | `chain`, `session`, `attempt`, `runner`, `execute`, `exec-session`, `session-api`, `artifact`, `unit-commit` | chain writes = 0 outside the transitions |
| C — services | C1–C7 | B | `failback`, `keyring`, `classify`, `model-step`, `exit`, `routing`, `select`, `git`, `unit-commit`, `opts`, `loop-*`, `agent-pool`, `session`, `attempt` | services ratchets at target; no `reset*` for moved state |
| D — turn engine | D0–D9 | C | `watch`, `attempt`, `testrun`, `usage`, `stuck`, `resolve`, `session-api`, `engine/*` | `remainder` gone; trace roster complete; traces unchanged |
| E — boundaries | E1–E5 | A (E1 also D1) | `prompt`, `prompt-plan`, `phases`, `models`, `import-direction` | `FROZEN_IMPORTS` gone; sub-domain ratchet in place |
| F — observability, single path, close | F1–F4 | D (F1), C4 (F2), all (F3, F4) | `routing`, `select`, `model-route`, `failback`, `switches`, `models`, `attempt`, `session` | §8's exit criteria |

### 6.3 Units

Each unit lists its goal, its touch set, what is out of scope, its tests and its done-when. The gate is always §5.1.

**A1 — Test-time seams and lanes.**
- Goal:
  - Make the timer-bound tests independent of wall time.
    - `src/script.ts` gets its internal watchdog intervals (poll, kill grace) as options, with unchanged defaults, so `test/script.test.ts` can run its watchdog cases on millisecond values and short scripts.
    - `test/agent-pool.test.ts` separates the timed-out bin from the failing ones. The failing ones keep the generous timeout that the macOS first-exec note asks for; the timed-out one gets a short timeout of its own. `checkAgentBins` already takes `timeoutMs`.
    - The claude case that sleeps to a stated reset (about 2 s, through the no-registry recovery sleep) waits for C1's clock.
  - Add the lane manifest, the lane script and the package scripts (§5.2).
- Touch: `src/script.ts`, `test/script.test.ts`, `test/agent-pool.test.ts`, the new `test/lanes.ts`, `test/lanes.test.ts` and `script/test-lane.ts`, and `package.json`.
- Out of scope: any behaviour at the default values.
- Done-when:
  - No `unit`-lane test waits on a real timer longer than 50 ms.
  - The script and bin-check cases together take < 1.5 s.
  - `test:gate` reports ≤ 25 s on the gate machine, and the reported wall time is recorded as the `gate` baseline (§5.2).

**A2 — Hygiene: the SCC, the direction test's holes, `SERVER`, stale texts.**
- Goal:
  - `src/control-types.ts` (R8).
  - The direction test sees `import()` type expressions and treats `import { type … }` as type edges, and a no-cycle rule counts type edges.
  - `OPENCODE_AUTO_SERVER` is registered (R18).
  - The stale "fourteen calls" comment in `src/agent/types.ts` and the package `AGENTS.md` become thirteen.
  - The stale switch name near `src/runner.ts:590` is fixed.
  - `templates/opencode.json` loses its duplicate `"model"` keys, keeping the last occurrence of each.
- Touch: `src/step.ts`, `src/interactive.ts`, `src/exit.ts`, `src/failback.ts`, the new `src/control-types.ts`, `src/switches.ts`, `src/agent-pool.ts`, `src/agent/opencode/server.ts` (the constant only; the agent domain restates the name as `src/agent/env.ts` does for the prefix), `src/agent/types.ts`, `src/runner.ts` (the comment), `templates/opencode.json`, `test/import-direction.test.ts` and `test/switches.test.ts`.
- Done-when: zero cycles with type edges; the switch-line test covers `SERVER`.

**A3 — Refcheck's code retires (0060 D5g, R17).**
- Goal:
  - Delete `src/refcheck.ts`, `test/refcheck.test.ts`, `script/fix-refs.ts` and the `fix-refs` script.
  - Delete `gatedAutoCorrectRefs` and its call in `unit-commit.ts`, and their cases.
  - Delete check's layer ② (check itself goes in A4) and `recordOnce`.
  - The retired-switch registry with `REF_CHECK`.
  - Preflight deletes a leftover `.auto/invalid-refs.md` with one line, the way the retired `CURRENT.md` is handled.
  - The CLASSIFIED entry goes.
- Touch: `src/refcheck.ts`, `src/unit-commit.ts`, `src/check.ts`, `src/switches.ts`, `src/loop-preflight.ts`, `script/`, `package.json`, `test/refcheck.test.ts`, `test/unit-commit.test.ts`, `test/check.test.ts`, `test/switches.test.ts`, `test/loop-preflight.test.ts`, `test/resolve.test.ts` and `test/import-direction.test.ts`.
- Out of scope: the texts (A5) and the shell (A4, A5).
- Done-when: `git grep -i refcheck -- src test script` names only the retired-switch entry and the preflight cleanup.

**A4 — `check` retires; `fix --dryrun` (R1).**
- Goal:
  - Delete `src/check.ts` and `test/check.test.ts`.
  - In `packages/auto`: `check` answers its retirement notice first, as `continue` does; `fix --dryrun` (plan, print, exit code, no write-side gates); usage text; README; e2e cases for the retired command (the legacy-layout exemption case goes) and for `fix --dryrun` with no findings, fixable findings and manual findings.
  - Absorb note in `docs/shell-contract.md`.
- Touch: `src/check.ts`, `test/check.test.ts`, `test/import-direction.test.ts`, `packages/auto/src/index.ts`, `packages/auto/README.md`, `packages/auto/test/e2e.test.ts` and `docs/shell-contract.md`.
- Done-when: the e2e passes; `auto-core/check` no longer exists.

**A5 — The texts and the docs of A3–A4 (R6, R15).**
- Goal:
  - Block paragraphs 2–3 and the wrap-up item as ruled in R6, with their goldens.
  - The package `AGENTS.md`: the refcheck navigation line goes, and the stable-references line keeps `docpaths`.
  - `docs/structure.md`, `docs/glossary.md`, and the absorb note in `docs/shell-contract.md` for the block text.
  - Historical status lines in plans 0010 and 0013.
  - 0035's registry: the `deleted|archived|historical` markers leave it through its flip procedure.
  - 0060 §3: the pointer to R15.
  - The shell README's reference-check sections.
- Touch: `src/agents-block.ts`, `templates/prompts/wrapup.md`, `test/golden/*` (wrap-up renders only), the block tests, `AGENTS.md`, `docs/*`, `plans/0010`, `plans/0013`, `plans/0035`, `plans/0060` (the pointer only) and `packages/auto/README.md`.
- Done-when: the golden diff contains only the R6 sentences; the block test pins the new paragraphs.

**A6 — Diet tranche 1 (R2).**
- Goal:
  - `REUSE_SESSION` and `HANDOVER_CONCURRENT` join the retired-switch registry.
  - `attempt`: reuse = `resumed` only. The reuse log branches go, and so do `reuseAllowed` and `REUSE_BELOW`/`REUSE_IDLE_*` if nothing else reads them. The rename on a resumed takeover stays.
  - `capability`: the reuse degradation note goes.
  - `watch`, `attempt` and `exec-session`: the concurrent test path and `TestRun.running` go, and the freeze log line keeps the sequential wording.
  - The feature's own tests are deleted with it.
- Touch: `src/switches.ts`, `src/attempt.ts`, `src/usage.ts`, `src/chain.ts` (the constants), `src/capability.ts`, `src/watch.ts`, `src/exec-session.ts`, `src/testrun.ts`, `test/session.test.ts`, `test/switches.test.ts`, `test/capability.test.ts`, `test/watch.test.ts`, `test/agent-fake.test.ts`, `test/agent-claude.test.ts`, the package `AGENTS.md` and `docs/structure.md`.
- Done-when: neither switch is read anywhere in `src/` except the retired registry.

**A7 — Digest instrumentation and cap (R3).**
- Goal:
  - Stats counters: digest sizes per planning session (prior knowledge, previous round) and knowledge-phase use.
  - The 25% cap with the index form, rendered through the existing `prevRound` slot. The index form's text is a template string in `templates/prompts/`, with a golden for it.
- Touch: `src/loop-plan.ts`, `src/knowledge.ts`, `src/stats.ts`, `src/conclusion.ts` (a line only when a counter is non-zero), `templates/prompts/*`, `test/knowledge.test.ts`, `test/plan-loop.test.ts`, `test/stats.test.ts`, `test/golden*`.
- Done-when: the existing goldens are unchanged; the new golden covers the index form.

**B1 — Transitions module and the write ratchet.**
- Goal: `src/chain-transitions.ts` with `forkSources` and `modelOfChain`, replacing the eight copies (F5). `test/chain-writes.test.ts` with today's per-file counts.
- Touch: the new `src/chain-transitions.ts`, `src/session.ts`, `src/attempt.ts`, `src/unit-commit.ts`, `test/chain-writes.test.ts` and `test/import-direction.test.ts` (classification and rank).
- Done-when: no copy of either computation is left.

**B2 — `session.ts` writes through transitions.**
- Goal: the retry, failover, rotation, recovery, cross-agent and blank-session paths, and `pauseForExit`'s reads.
- Touch: `src/session.ts`, `src/chain-transitions.ts` and `test/chain-writes.test.ts`.
- Done-when: the count for `session.ts` is 0; `test/session.test.ts` is unchanged and green.

**B3 — The dispatch plan.**
- Goal: `src/engine/dispatch.ts` `planDispatch`, pure. `attempt.ts` executes it and writes through transitions.
- Touch: `src/attempt.ts`, the new `src/engine/dispatch.ts`, `src/chain-transitions.ts`, the new `test/dispatch.test.ts` (plan rows) and `test/chain-writes.test.ts`.
- Done-when: the count for `attempt.ts` is 0; the agent-fake recordings are unchanged.

**B4 — The ladder decision.**
- Goal: `src/engine/ladder.ts` `nextStep`. `runSession`'s loop becomes the executor over it.
- Touch: `src/session.ts`, the new `src/engine/ladder.ts` and the new `test/ladder.test.ts` (one case per `Step` kind, per class label, spent window, ring or no ring, and ladder position).
- Done-when: the body of `runSession`'s loop is only the dispatch of `Step`s.

**B5 — Remaining chain writes.**
- Goal: `runner`, `execute`, `exec-session`, `session-api`, `artifact`, `unit-commit` and the rest write through transitions.
- Touch: those files, `src/chain-transitions.ts` and `test/chain-writes.test.ts`.
- Done-when: the ratchet table is all zeros and becomes a flat "no writes outside the transitions" rule.

**C1 — `RunServices`, the clock and the composition root.**
- Goal:
  - `src/services.ts`; the construction order in preflight; the switch snapshot frozen after the clamp. Tests that re-clamp re-parse instead.
  - The `Clock`: the stats clock and the routing clock/sleep fold into it.
  - `watch`, `attempt` and `session` read time only from it.
  - `test/preload.ts` installs fresh services.
  - The recovery sleep on the no-registry path goes through the clock too, so the claude case that sleeps to a stated reset stops waiting on wall time.
- Touch: the new `src/services.ts`, `src/loop-preflight.ts`, `src/loop.ts`, `src/switches.ts`, `src/stats.ts` (the clock only), `src/routing.ts`, `src/watch.ts`, `src/attempt.ts`, `src/session.ts`, `test/preload.ts`, the new `test/services.test.ts`, `test/agent-claude.test.ts`, and the tests that set the stats or routing clock.
- Done-when: the no-raw-clock ratchet is at zero for the engine modules.

**C2 — Router service I: failback, the logged windows, the step claims.**
- Goal: sticky, override, the pending `/failback` order, down marks, `windowsLogged` and the model-step claims move into `router`. Their callers use the service. The `reset*` hooks for them go.
- Touch: the new `src/router.ts`, `src/failback.ts`, `src/model-step.ts`, `src/watch.ts`, `src/attempt.ts`, `src/session.ts`, `src/unit-commit.ts`, `src/interactive.ts`, `src/select.ts`/`src/routing.ts` (reads), and the tests of those modules.
- Done-when: `failback.ts` holds only pure helpers or is gone.

**C3 — Router service II: key rings and the classifier's state.**
- Goal: the same for `keyring.ts` (rings, positions, active) and `classify.ts` (answers, in-flight calls, budget, the usage sink).
- Touch: `src/keyring.ts`, `src/classify.ts`, `src/router.ts`, `src/session.ts`, `src/watch.ts`, `src/agent-pool.ts`, `src/loop-preflight.ts`, and their tests.
- Done-when: no module-level decision state is left in either file.

**C4 — Router fence: the dual routing path in one seam.**
- Goal:
  - `router.target(chain, role, phase)`, `router.failover(…)` and `router.describe(…)` cover the registry and no-registry halves.
  - The branch sites in `attempt`, `session` and `unit-commit` call the router instead of testing `opts.routing` themselves.
  - Byte-identical logs on both paths.
- Touch: `src/router.ts`, `src/attempt.ts`, `src/session.ts`, `src/unit-commit.ts`, `src/routing.ts` and the tests of the failover ring and registry dispatch.
- Done-when: routing-truthiness branches are left only in `router.ts` and the modules that build the facts.

**C5 — Control service and the reset-hook ratchet.**
- Goal:
  - The `/exit` flag and its sleepers move into `control`.
  - `SERVICE_ENTRIES` becomes final for stage C.
  - `test/services.test.ts` asserts that no `reset*` export remains for moved state.
- Touch: `src/exit.ts`, `src/services.ts`, `src/session.ts`, `src/loop*.ts`, `src/step.ts`, `src/hibernate.ts`, and the tests using `resetExitRequest`.
- Done-when: the services ratchets are at target.

**C6 — Git seam; the `commit: false` path deleted (R13).**
- Goal:
  - `GitOps` in services, the production implementation over `git.ts` and `unit-commit.ts`, and a `noCommitGit()` test double.
  - The 28 test uses of `commit: false` move to the double.
  - The 29 gates, `RunAllOpts.commit` and `ProjectConfig.commit` go; the tombstone stays.
  - The shell stops passing `commit`, with an absorb note.
  - `Opts.commit` is kept as an ignored field.
- Touch: `src/git.ts`, `src/unit-commit.ts`, `src/services.ts`, `src/config.ts`, `src/opts.ts`, `src/loop*.ts`, the other gated files, `packages/auto/src/index.ts`, `docs/shell-contract.md`, and the tests named in F14.
- Done-when: `git grep "opts.commit"` is empty in `src/`.

**C7 — `sessionOpts` builder, then the merge (R12).**
- Goal: `sessionOpts(ctx, site)` reproduces the seven literals, pinned by a table test. Then, as the unit's last step, `idleMs` and `mode` are added for every site, and the table is updated in the same diff.
- Touch: `src/loop-task.ts`, `src/loop-phase.ts`, `src/loop-plan.ts`, `src/knowledge.ts`, `src/opts.ts` (the builder) and the new `test/session-opts.test.ts`.
- Done-when: no `Opts` literal is left in `src/loop*` or `src/knowledge.ts`.

**D0 — The turn-trace oracle.**
- Goal:
  - `test/fixtures/turn-trace.ts` and `test/turn-trace.test.ts`, with traces under `test/golden/turn/` recorded from the unchanged `watch()`.
  - At least one scenario for each input kind, each row of §4.5, and each of today's return exits. This includes the test protocol at idle (run and feedback, a due handover with the freeze commit, a complete handoff, strict-resume invalid, a second retry blocking), a probe verdict while a human answer is pending, a classifier answer while retrying and after the stream ended, and the dual steer at one measurement point.
- Touch: the new test files only.
- Done-when:
  - The oracle is green on the unchanged `watch()` and runs in < 2 s.
  - The race-dependent interleavings that exist today are enumerated — the known list: a held settle racing an already-queued external input, and a probe firing during an awaited fx call — and every oracle scenario that depends on one is either pinned by construction (its outcome made deterministic) or excluded from the oracle with the reason recorded. D0 confirms the list is complete.

**D1 — The spine, the sources, the fx and `remainder`.**
- Goal: §4.3–§4.4 in `src/engine/`. `watch()` builds `TurnContext` and runs the spine with the single `remainder` concern. The probe and the classifier answer become synthetic inputs. `test/turn-arbitration.test.ts` checks the table and the audit invariants (it includes a deliberately wrong concern that steers before `test` at idle and must throw).
- Executed as two units: **D1a** installs the spine, the sources, the fx and the audit around the uncut loop body as the single handler — traces green, the queue discipline proven; **D1b** performs the cut into per-input handlers under `remainder` — traces green. Both halves carry D1's touch set and gate, and the unit id stays one.
- Touch: the new `src/engine/contract.ts`, `spine.ts`, `fx.ts` and `sources.ts`, `src/watch.ts`, `test/import-direction.test.ts` (classification and rank) and the new `test/turn-arbitration.test.ts`.
- Done-when: the traces are unchanged (in D1a and again in D1b).

**D2 — `guard`, `transcript`, `windows`, `stuck`.**
- Touch: `src/engine/concerns/{guard,transcript,windows,stuck}.ts`, the spine table, `remainder`, the new concern suites, and the re-homed `watch.test.ts` cases.

**D3 — `questions`.** Also replaces the `autoSwitches().ask` read with `ctx.switches.ask` (F8).
- Touch: `src/engine/concerns/questions.ts`, the table, `remainder`, `test/turn-questions.test.ts`, and the re-homed cases, including the direct `watch()` question and permission cases of agent-fake, which stay where they are because they are end-to-end.

**D4 — `failure`.**
- Touch: `src/engine/concerns/failure.ts` (with `withLimit`, `withWording` and `LIMIT_KEYS` moved from `watch.ts`), the table, `remainder` and the suite.

**D5 — `recovery`.**
- Goal: the classifier consult, the retry verdict, the raised settle, the final classification and `resetFields`.
- Touch: `src/engine/concerns/recovery.ts`, the table, `remainder`, the suite, and the re-homed `test/classify.test.ts` watch-side cases.

**D6 — `liveness`.**
- Goal: the probe verdicts with the quiet-window exemption, half-open, the announced silence and truncation continuation, plus the finalize step for an interrupted or half-open turn.
- Touch: `src/engine/concerns/liveness.ts`, the table, `remainder`, `test/watch-probe.test.ts` (re-homed) and the suite.

**D7 — `usage` and `stepUp`.**
- Goal: the measurement-point rows: the wall, notices, the hard wall and its suppression, the step-up, the late step-up and cache claims.
- Touch: `src/engine/concerns/{usage,step-up}.ts`, the table, `remainder`, the suites, and the re-homed `testrun`/`model-step` watch-side cases.

**D8 — `test`.**
- Goal: the idle protocol with the kernel fx calls. The audit invariant (a) is now load-bearing.
- Touch: `src/engine/concerns/test.ts`, the table, `remainder`, `test/turn-test-protocol.test.ts` and the re-homed cases.

**D9 — `remainder` removed; the facade settles.**
- Goal:
  - `remainder` deleted; `watch.ts` is the entry that builds the context and runs the spine.
  - The residue of `watch.test.ts` is re-homed or kept as spine-order cases.
  - The trace roster is complete.
  - The package `AGENTS.md` navigation line for session driving names the engine; `docs/structure.md` gets the engine rows.
- Done-when: `src/watch.ts` is under 150 lines and every concern file is under 250.

**E1 — Sub-domains in the direction test (R10).**
- Goal: the `SUBDOMAIN` column, `SUBDOMAIN_EDGES` seeded from the measured graph, the contract-leaf and no-engine→pipeline rules, and `RANK` for the new modules.
- Touch: `test/import-direction.test.ts` and `docs/structure.md` (the sub-domain column).

**E2 — `PromptFacts`: `prompt.ts` off the driver.**
- Goal:
  - `prompt.ts` and `prompt-plan.ts` render from a `PromptFacts` value built by the driver: the task and plan views they read from `tasks`, the question-rule data from `resolve`, the stuck-hint data, the switch-derived options, and the prompt globals (the intent pack, `humanQuestions`, the template library handle). The globals move from module state into the facts, set at the composition root.
  - The `FROZEN_IMPORTS` entry for `prompt` becomes intent-domain imports only.
- Touch: `src/prompt.ts`, `src/prompt-plan.ts`, their callers (`execute`, `runner`, `loop-plan`, `loop-phase`, `knowledge`, `wrapup`, `exec-session`, `artifact`, `session`), `test/prompt-*.test.ts` and `test/import-direction.test.ts`.
- Done-when: the goldens are unchanged.

**E3 — `phases.ts` off the driver; `FROZEN_IMPORTS` retired.**
- Goal:
  - `phases.ts` takes the task-index reads and the bin name as parameters or callbacks from its driver callers, instead of importing `tasks` and `shell`.
  - `FROZEN_IMPORTS` is deleted. Flat provider-domain files now obey the same rule as the domain directories: no driver imports, and other domains only through their entries.
- Touch: `src/phases.ts`, its callers, `test/phases*.test.ts` and `test/import-direction.test.ts`.

**E4 — `models.ts` split (R14).**
- Goal: `src/models-schema.ts` holds the types and the schema tables; `models.ts` keeps load, merge and validate. Importers of types only switch to the schema module.
- Touch: `src/models.ts`, the new `src/models-schema.ts`, its importers, and `test/import-direction.test.ts`.

**E5 — Documentation of the landed shape.**
- Goal: `docs/structure.md` regrouped by sub-domain; one navigation line each in the package `AGENTS.md` for the engine, the services and the transitions; the glossary rows (turn spine, concern, arbitration table, `RunServices`).
- Touch: docs only.

**F1 — Input log and decision events (R4).**
- Goal:
  - The spine and the fx wrapper append inputs, fx results, clock readings and executed effects to `.auto/run-events.jsonl` (gitignored like `.auto/`, one line per entry, rotated per run start).
  - `test/fixtures/replay.ts` replays a recorded log through the spine with fx results served from the log.
  - One incident scenario is recorded and replayed as a test.
- Touch: `src/engine/spine.ts`, `src/engine/fx.ts`, the new `src/engine/events.ts`, the new `test/replay.test.ts` and `test/fixtures/replay.ts`.
- Done-when: the replay reproduces the recorded effects exactly.

**F2 — The implicit registry; the no-registry half deleted (R2).**
- Goal:
  - `models.ts` synthesizes the implicit registry when no layer exists.
  - The router's no-registry half and `resolveModel`'s env-policy path are deleted, along with the "byte-identical (C2)" notes that described the dual path.
  - `models` names the implicit registry.
  - Tests of the failover ring move onto the implicit registry and assert the same dispatch targets, prompts, commits and exit codes; only the §3.2 lines change.
- Touch: `src/models.ts`, `src/router.ts`, `src/routing.ts`, `src/select.ts`, `src/model-route.ts`, `src/switches.ts`, `src/failback.ts`, `src/attempt.ts`, `src/session.ts`, `src/unit-commit.ts`, `src/models-describe.ts`, `test/session.test.ts`, `test/failback.test.ts`, `test/routing.test.ts`, `test/agent-fake.test.ts`, the package `AGENTS.md` and `docs/structure.md`.
- Done-when: `opts.routing` is always defined in the engine, and its optionality is gone from the types.

**F3 — The consolidation pass.**
- Goal: the duplicate audit (§5.4), the final lane manifest and budget re-measurement, and the goldens and traces confirmed.
- Touch: tests and `test/lanes.ts`.
- Done-when: `gate` within its §5.1 budget, with the baseline re-measured and re-recorded here, and `unit` ≤ 5 s.

**F4 — Close-out.**
- Goal:
  - `Opts.commit` deleted, together with the five `commit: true` literals in `test/incident-regression.test.ts` (R13).
  - The implementation record completed.
  - 0060's status set to "implemented as ruled in 0061".
  - The shell-contract absorb notes checked against the final exports.
- Touch: `src/opts.ts`, `test/incident-regression.test.ts` (those literals only), `plans/0060`, `plans/0061` and `docs/shell-contract.md`.

## 7. Risks and exit ramps

| risk | where | mitigation | exit ramp |
|---|---|---|---|
| The trace oracle misses a behaviour, so drift passes silently | D | Every return exit, table cell and synthetic-input interleaving has a scenario; the roster cell check; agent-fake and the goldens also stay | A drift found later becomes a new scenario recorded from the last pre-D commit (`git worktree` on it), then fixed |
| Synthetic inputs handled mid-fx change log order against today | D1, D6 | Scenarios with a probe during `askHuman` and during a test run; the held-settle rule (§4.4) | Liveness stays in `remainder`, and D9 is replaced by a ruling that keeps it there |
| The spine cannot reproduce a quiet-point rule | D1–D8 | The audit invariants and the `test/turn-arbitration.test.ts` wrong-concern case | Stop stage D at the last green unit. B, C, E and F2 do not depend on D; F1 does |
| Test isolation breaks when singletons move | C2–C5 | A fresh services instance per test from the preload; one singleton per unit | Revert the unit; the delegators exist only inside it |
| The gate budget is exceeded | any | Budget check per unit; concern suites are in-memory | The unit fixes its own regression; drift across machines is re-measured in F3 |
| The implicit registry changes the default path | F2 | The failover and wait scenarios re-pointed with the same targets, prompts, commits and exit codes | Keep the fenced dual path (C4 end state), and record the ruling change in §10 |
| Churn collisions | B–D | The hold lists (R19) | — |
| A unit outgrows one session | any | Touch sets bound units; a lead may split per 0059 | Split the unit into lettered parts in §10, with the same gate |

## 8. Program exit criteria and expected effect

- `watch.ts` is under 150 lines; every concern is under 250 lines; `runSession`'s loop only dispatches `Step`s; `attempt()` executes a `DispatchPlan`.
- There are zero `SessionChain` writes outside the transitions, zero module-level decision state outside `RunServices`, zero cycles counting type edges, and no `FROZEN_IMPORTS` table.
- The full suite runs in ≤ 30 s on the gate machine, with all goldens, traces and `test/incident-regression.test.ts` green.
- Worked example (0060 §1.1, a quota-window change):
  - Reading set: the engine contract (~250 lines), the `failure` and `recovery` concerns (~350), `nextStep` (~200) and the router's down-mark and window part (~300). That is about 1,100 lines instead of ~3,800–4,600, roughly **3.5–4×**, not the 7× 0060 estimated.
  - The blast radius is found by the types (`TurnFx`, `Router`) and the direction ratchets, not by grep.
- A new cross-cutting turn concern is one file, one slice, table cells at a declared position, and its suite.

## 9. Relationship to other designs

- **0060:** this document rules it and replaces the parts listed in §2.3.
- **0024:** the layering rank continues, with the new modules ranked.
- **M0.7/D8:** the direction test is completed (E1, E3).
- **0055 and 0057:** they supply the router's content, and the implicit registry completes 0055's "no registry" branch.
- **0056 and 0059:** the steer and the lead become the `usage` and `test` concerns.
- **0010 and 0013:** retired to historical record (A5).
- **0044, 0052 and 0053:** they give the precedents followed by R1 (the `continue` retirement and `fix`'s rule table).
- **0035:** it owns the marker flip in A5.

## 10. Implementation record

**Adoption entry, 2026-09-28 (before A1).** The assessment of plans/0062 offered six amendments to this document (its §6); all six are adopted, none rejected. Each line carries the adopted text and the pointer to the section it changed:

- **A-1** (before A1) — R5's gate budget is machine-independent: `test:gate` fails above baseline × 1.25, where the baseline is the suite's wall time recorded by A1 and re-measured in F3; the `unit` lane (5 s budget) stays the dev-loop gate everywhere; the absolute 30 s figure remains the gate-machine reference, not the rule. → §2.1 R5, §5.1, §5.2; conforming wording in §0, §6.2 (stage A exit), A1 and F3.
- **A-2** (before D1) — D1 is executed as two units: D1a installs the spine, the sources, the fx and the audit around the uncut loop body as the single handler (traces green, queue discipline proven); D1b performs the cut into per-input handlers under `remainder` (traces green). → §6.3 D1.
- **A-3** (before D0) — D0's done-when gains the enumerated list of race-dependent interleavings that exist today (a held settle racing a queued external input; a probe firing during an awaited fx call); each oracle scenario is either pinned by construction or excluded with the reason recorded. → §6.3 D0.
- **A-4** (before A7) — §3.1 is stated uniformly as "byte-for-byte minus the §3.2 rows", as it already read for prompts, resolving the overlap with A7's counters and F1's state file. → §3.1.
- **A-5** (before F3) — the per-policy call-coverage assertion of 0060 §6.2 is replaced by concern suites over a fake `TurnFx`; agent-fake stays unsplit. → §5.4.
- **A-6** (program start) — the program is a feature freeze on the hold-listed files for its duration, and that calendar price is part of the approval. → §6.1.

No unit has landed yet. Each unit appends one entry here: what landed, the tests, and any decision it had to take.

**A1 — Test-time seams and lanes, 2026-09-28.**
- Landed: `src/script.ts`'s poll default named `DEFAULT_SCRIPT_POLL_MS` (5 s, value unchanged); `test/script.test.ts`'s four watchdog cases on millisecond values and short scripts (≈ 1.15 s the file, was ≈ 6.6 s in the four cases); `test/agent-pool.test.ts`'s bin check split — the failing bins keep the generous 3 s timeout the macOS first-exec note asks for, the never-answering bin gets a 200 ms timeout of its own; `test/lanes.ts` (37 `repo` files, 55 `unit` files, `UNIT_BUDGET_MS` 5 s, `GATE_BASELINE_MS` 28_000 — the full suite measured 27.6–28.1 s over repeated runs on the shared-container host that executes the units, a representative figure recorded), `test/lanes.test.ts` (missing, listed twice, listed but absent), `script/test-lane.ts` and the `test:unit`/`test:repo`/`test:gate` package scripts; plain `bun test` still runs everything (1,791 tests, green in both the plain and the lane order). The claude stated-reset wait stays on wall time until C1's clock, as planned. `unit` lane 1.26 s, no `unit`-lane test waits on a real timer longer than 20 ms; script and bin-check cases together ≈ 1.4 s; `test:gate` 27.8 s within its 35 s budget.
- Tests: `test/script.test.ts`, `test/agent-pool.test.ts`, `test/lanes.test.ts` (new), `script/test-lane.ts` (new, verified on its failure paths: over budget exits 1, an unlisted file fails the manifest test).
- AUTO-RESOLVE: the unit's seam list named the module's intervals as "(poll, kill grace)" — the poll interval was already an option (`pollMs`, default now named, value unchanged) and no kill grace exists in `src/script.ts` (nothing runs between the timeout kill and awaiting the child's exit), so none was added; a SIGTERM→SIGKILL escalation would change behaviour at the default option values, which the unit rules out of scope. Recorded in the module's comment.

**A2 — Hygiene: the SCC, the direction test's holes, `SERVER`, stale texts, 2026-09-28.**
- Landed: `src/control-types.ts` — the `Boundary` and `Interactive` types as a types-only leaf (R8). `step.ts` imports both from it and no longer defines `Boundary` (its only importers were `exit.ts` and `failback.ts`, which now import the leaf; nothing imports `Boundary` from `step` any more, so it is not re-exported there); `interactive.ts` imports `Interactive` from the leaf and re-exports it for its existing importers (`opts`, `loop`, `loop-task`, `loop-progress`, `session-api`), which the unit does not touch. The `exit ↔ failback ↔ interactive ↔ step` SCC is gone. `test/import-direction.test.ts` now sees `import("./x")` type expressions (a `await import` lookbehind keeps dynamic value imports out of the type pass) and treats an `import { type … }` whose specifiers are all type-marked as a type edge, and gained the no-cycle rule that counts type edges (§5.3's A2 ratchet: zero cycles); `control-types` is classified driver and listed in `LEAVES`. `OPENCODE_AUTO_SERVER` joined `SWITCH_ENV` beside `models` (R18): a URL, kept out of `Switches`; `nonDefaultSwitches` gained an optional `env` parameter (defaulting to `process.env`) and names the URL on the startup line when set, appended last, silent when unset or empty — `formatSwitches` unchanged; the four raw reads (three in `agent-pool.ts`, one in `agent/opencode/server.ts`, which restates the name as a local constant the way `src/agent/env.ts` restates the prefix) use the constant. The stale "fourteen calls" in `src/agent/types.ts` and both "14" mentions in the package `AGENTS.md` became thirteen; `src/runner.ts`'s subtask-boundary failback comment names `OPENCODE_AUTO_MODEL_FAILBACK_SCOPE` (it read `OPENCODE_AUTO_MODEL_FALLBACK_SCOPE`). `templates/opencode.json` keeps only the last `"model"` occurrence (§3.2's A2 drift row; the parsed value is unchanged). Gates: typecheck in both packages; `test:gate` 28.07 s within its 35 s budget (1,793 tests); the shell e2e for the template change (94 pass, 8 opt-in skips).
- Tests: `test/import-direction.test.ts` (both scan holes, the type-edge no-cycle rule, the new module's classification; the rule was verified to bite through a temporary two-file type cycle built from `import { type … }` and `import("./x")` edges, deleted afterwards), `test/switches.test.ts` (the `SERVER` line: named when set, silent when unset or empty, appended after the parsed items, absent from the full listing; the file masks an ambient `OPENCODE_AUTO_SERVER` for its whole run, the `agent-server.test.ts` pattern).
- AUTO-RESOLVE: `docs/structure.md` and `test/agent-fake.test.ts`'s header also say "14" calls — fix them in this unit too? -> no, left as they are (A2's touch set names only `src/agent/types.ts` and the package `AGENTS.md`; structure.md follows in the unit that next lands a mechanism, §6.1 rule 5, and the test header rides with the next agent-fake edit; both can take the count then).
- AUTO-DECISION: `step.ts` drops `Boundary` without a re-export while `interactive.ts` keeps one (the boundary type has no importer left outside the leaf's direct users — a re-export would be a shim protecting nobody, R9's precedent — while `Interactive` keeps five src importers and seven test files that this unit does not touch).

**A3 — Refcheck's code retires; the retired-switch registry, 2026-09-28.**
- Landed: deleted `src/refcheck.ts` (all three layers, `recordOnce` and the `.auto/invalid-refs.md` writer with it), `test/refcheck.test.ts`, `script/fix-refs.ts` and the `fix-refs` package script; `unit-commit.ts`'s `gatedAutoCorrectRefs`, its `afterSession` call, the import and their two test cases; `check`'s layer ② (the scan body, the non-git note and the `switches` parameter, whose only reader it was) and the four layer-② test cases; the `refcheck` row of `test/import-direction.test.ts`'s CLASSIFIED and `test/lanes.ts`'s manifest entry. The retired-switch registry (R17) in `src/switches.ts`: `RETIRED_SWITCHES` (env name → reason, entries never removed) with `OPENCODE_AUTO_REF_CHECK` as its first entry, `retiredSwitchNotes(env)` pure, and `autoSwitches` logging one `⚠ <NAME> is retired (<reason>); the variable is ignored` line per set variable at the first parse — a notice, never a usage error, whatever the value. The switch itself left `Switches`, `SWITCH_ENV`, the defaults, the parse, the non-default line and the full listing (the §3.2 A3 drift rows). `src/loop-preflight.ts` gained `removeRetiredInvalidRefs` and the run-start deletion of a leftover `.auto/invalid-refs.md` with one log line, the `CURRENT.md` pattern minus the header check (`.auto/` is the driver's own gitignored directory) and minus the carryover commit (nothing tracked is removed); `test/resolve.test.ts`'s two sample AUTO-DECISION strings no longer name the removed checker. Gates: typecheck in both packages; `test:gate` 26.65 s within its 35 s budget (1,755 tests); goldens untouched; no e2e in the unit's gate (the shell is out of scope and no shell-visible export changed shape). Verified besides the gate: the shell e2e has exactly one red case now — "stale references … hit exit 1", which asserts the retired scan — the case §6.3 A4 deletes with the `check` command; the other two check-reference cases (all-valid exits 0, default-off no-op) still pass, and 93 of 94 e2e cases pass overall.
- Tests: `test/switches.test.ts` (the retired registry: the variable no longer parses nor lists; one notice line per set variable, none for unset/empty, a notice for a value the live grammar would have refused; `autoSwitches` prints the notice at the parse — the memo forced through `setSwitchModelRegistry`, the ambient `OPENCODE_AUTO_*` layer scrubbed for the capture; the eighteen-variable counts and the two full listings updated), `test/loop-preflight.test.ts` (`removeRetiredInvalidRefs`: a leftover deleted at run start with exactly the one log line, the tree left clean; no leftover → nothing), `test/check.test.ts` (layer ② cases gone; the always-empty `refs` slot still asserted once), `test/unit-commit.test.ts` (the gate's cases gone), `test/lanes.test.ts`/`test/import-direction.test.ts` (manifest and CLASSIFIED consistent).
- AUTO-DECISION: `checkPrinciple` keeps the `refs` result field as an always-empty, locally-typed `RefFinding[]` instead of dropping it (the shell destructures and reports the field and this unit may not touch `packages/auto`; the shape stays, the layer goes — A4 deletes the command and the field together). The `switches` parameter is dropped rather than kept unread (its only reader was the retired layer; the shell passes only the directory).
- AUTO-DECISION: the retired notices print inside `autoSwitches`' first-parse block, after the two `⚙` switch lines, one line per variable, computed by the exported pure `retiredSwitchNotes` (parse-time logging follows the existing switch lines' pattern, and the pure half keeps the notice text testable without the process-global memo; printing from `parseSwitches` itself was rejected — it is a pure function whose callers inject arbitrary env records in tests).

**A4 — `check` retires; `fix --dryrun`, 2026-09-28.**
- Landed: deleted `src/check.ts` (the principle scan's regexes, the AGENTS.md-block notes and the always-empty `refs` slot A3 had kept for the shell) and `test/check.test.ts`; the `check` row of `test/import-direction.test.ts`'s CLASSIFIED and `test/lanes.ts`'s manifest entry; `src/config-fix.ts`'s header no longer names `check` among the paths that append `fixHint`. `packages/auto`: `check` answers its retirement notice first and exits 1 (R1's text, `fix --dryrun` behind the profile's bin), ahead of the flag refusals, the unknown-option scan, the legacy-layout check and the run-lock refusal — the `continue` pattern; the command block, the check reference-check e2e describe (the three cases A3 had left, including the one it knew was red) and the legacy-layout exemption assertion are gone; `FLAGLESS` and its refusal message name `status` alone, and fix's option-whitelist message names `-f/--force and --dryrun`. `fix --dryrun` (boolean, `--dryrun=false` = the plain fix): plans and prints the findings, writes nothing, exits 0 with none and 1 with any; skips only the write-side gates (the clean-tree check, the confirmation, the run-lock refusal), keeps the uninitialized refusal. Usage text: the check line and its exit-code parenthetical go, the fix line gains `[--dryrun [true|false]]`, the fix paragraph, the run-lock line and a `check is retired` line (beside `continue`'s) describe the change. README: the usage line, a check retirement row in the breaking-changes table (and the status/reset/fix option rows), the fix section (`--dryrun` paragraph, two exit-table rows, the strict-failure paths no longer name check), the run-lock paragraph, the testByDriver propagation sentence, the AGENTS.md-block note sentence (fix lists those findings) and the "Principle check (check)" section deleted; `models`' group line names `status` alone. `packages/auto`'s `AGENTS.md` subcommand list and run-lock/dryrun lines updated. `docs/shell-contract.md`: the absorb note (the retirement, the flag, the legacy-layout change) and the boundary table's check mentions. Gates: typecheck in both packages; `test:gate` 26.13 s within its 35 s budget (1,745 tests); the shell e2e 95 pass + 8 opt-in skips.
- Tests: `packages/auto/test/e2e.test.ts` — the `check retired` describe (the notice ahead of flags, the legacy-layout check and a live lock, zero writes; the usage text carries the retirement line and no check command), the legacy-layout case now asserts `fix` and `fix --dryrun` refuse alike, the fix describe gained the three `--dryrun` cases (no findings exit 0; fixable findings print the plan, write nothing and skip the worktree gate on a dirty tree, with `--dryrun=false` still applying; manual findings report and write nothing), and the run-lock case asserts `fix --dryrun` runs beside a live lock; `test/lanes.test.ts`/`test/import-direction.test.ts` keep manifest and CLASSIFIED consistent.
- AUTO-RESOLVE: R1 says `fix --dryrun` "keeps `fix`'s other refusals, including the legacy-layout refusal", but `fix` had no such refusal — the shell deliberately left reset/fix/check available on old trees, so the only legacy-layout exemption was `check`'s own -> `fix` joins the legacy-layout refusal list (both modes; only `reset` stays available on an old tree) (the ruling's stated end — "the old exemption that let `check` run on a legacy layout ends with the command" — cannot hold while the replacement gate answers findings on a layout every other command refuses; rejected: refusing only in dryrun, which makes the read-only listing stricter than the write mode it gates, and adding no refusal, which keeps the exemption under a new name; the behavior change beyond the §3.2 row is that a plain `fix` on a legacy-layout tree now exits 1 with the layout message instead of running its config-layer rules — a tree every live command except `reset` already refuses).
- AUTO-DECISION: `fix --dryrun` with `-f/--force` accepts the pair and ignores force (dryrun has no write-side gates left to skip, and force only ever skipped write-side gates; refusing the combination would invent a conflict the flag semantics do not have). `src/config-fix.ts`'s one-word comment fix (dropping `check` from the fixHint callers list) was taken in this unit although the touch set does not name the file — a live file's contract comment must not name a deleted command; no behavior change.

**A5 — The texts and the docs of A3–A4 (R6, R15), 2026-09-28.**
- Landed: `src/agents-block.ts`'s reference conventions as ruled in R6 — paragraph 2's `@<sha>` parenthesis ends at "meaning that range is valid only for that historical revision" (the "and is exempt from line-number checking" clause dropped) and paragraph 3 replaced by the ruled text verbatim ("3. Checking: DRIVER neither checks nor rewrites references. Confirm that a path exists before you write it, and keep the references your task touches valid — that is part of the task's own work and of its acceptance."). `templates/prompts/wrapup.md`'s report item replaces the sentences from "— broken references are caught by the DRIVER's reference check" through "do not alter references that already carry a marker yourself;" with "— the DRIVER does not check references afterwards;" (the item's remainder unchanged). `test/golden/wrapup.golden.md` regenerated — the only golden that renders these texts (the agent-contract goldens mention the block's existence, not its reference paragraphs); its diff is the R6 sentences alone, the §3.2 A5 row's golden drift. Docs: the package `AGENTS.md` navigation line keeps `src/docpaths.ts` alone (0010 historical, the checker's retirement and the sessions-keep-references-valid shift named); `docs/structure.md` drops the reference-check row and the check-command row (deleted machinery A3/A4 left unnamed there) and the unit-commit row's "refcheck gate"; `docs/glossary.md` marks 引用检查 / reference check retired with the shift stated and drops the `deleted` / `archived` / `historical` markers from the protocol-literal list; `docs/shell-contract.md` gains the R6 absorb note beside A4's (the two texts quoted, shells asserting the old wording update their assertions, the block is local-only so no target commit changes); `plans/0010` and `plans/0013` carry historical-record status lines (0010 retired in part — the storage half stands in `src/docpaths.ts` and the block's conventions); `plans/0035` amendment retires the exemption markers from the registry (nothing parses, guards or writes them; the §4 row and the M3.8 entry stay as history); `plans/0060` §3 line 3 carries the pointer to R15 (lines 1–2 stand); `packages/auto/README.md` drops the unified-commit section's reference auto-correct paragraph and the block table's reference-conventions cell now states the no-checking contract. Gates: typecheck in both packages; `test:gate` 26.41 s within its 35 s budget (1,746 tests); the shell e2e for the template and README changes (95 pass, 8 opt-in skips).
- Tests: `test/prompt-exec.test.ts` — a new block test pins paragraph 2's ending and paragraph 3 verbatim, asserts the retired clauses (`exempt from line-number checking`, `full scan of all live documents`, `deleted/archived/historical`) absent from the block, and pins the wrap-up item's new sentence with the old sentences absent in both the solo and list renders; `test/golden.test.ts` itself unchanged.
- AUTO-DECISION: the A5 row's "historical status lines in plans 0010 and 0013" was realized as English retirement blockquotes above each document's original Chinese status block (the 0029/0050 precedent — the body stays untranslated, the retirement note is additive and in English), and 0010's note splits the design (storage half live, checking half retired) rather than retiring the whole document, since `src/docpaths.ts`, the round-directory layout and the block's reference conventions are still its substance (rejected: a blanket "historical" label, which would orphan the live half's design record; rejected: rewriting the body, against the never-maintain rule for historical records).

**A6 — Diet tranche 1: `REUSE_SESSION` and `HANDOVER_CONCURRENT` retired, 2026-09-28.**
- Landed: both variables joined `RETIRED_SWITCHES` (R2 tranche 1) with their R17 notices — "in-chain session reuse was removed; every prompt opens a fresh session" and "concurrent test handover was removed; the tests run after the handover close-out" — and left `Switches`, `SWITCH_ENV`, the defaults, the parse, the non-default line and the full listing (sixteen variables; the §3.2 A6 drift: no reuse or concurrent test-handover lines, two retired-switch notices). `src/attempt.ts`: the in-chain reuse decision is `resumed` only — a chain holding a session and a note (interruption recovery), whose takeover, usage inheritance (`test.startUsed`), model-announcement dedup and end-of-session rename all stay; the `♻ session reused` line, the `▷ … starting a new session` no-reuse reason line and the threshold machinery went, with `reuseAllowed` (`src/usage.ts`, its matrix row with it) and `REUSE_BELOW`/`REUSE_IDLE_MS`/`REUSE_IDLE_MINUTES` (`src/chain.ts`) deleted — nothing else read them. `src/capability.ts`: the reuse degradation note and its `DegradedSwitches` entry went (the resume row of the degradation table keeps `OPENCODE_AUTO_FORK` and the fresh-start fallbacks). The concurrent test-handover path went whole: `TestRun.running` (`src/testrun.ts`), watch's concurrent freeze branch (the freeze log line keeps the sequential wording), attempt's post-watch close-out of the running test, and exec-session's drift registration with its `test.last` fall-back — the sequential path (pin at the freeze, run after commit #2) is the only one. The feature's own tests were deleted with it and the surviving cases that need a same-session continuation were re-pointed at the resumed path by planting `chain.note` (session.test.ts's reuse describe became the takeover describe, agent-fake's rename/continuation/step cases, watch.test.ts's cumulative-rounds case); capability/switches/claude fixtures dropped the two keys. Comments in live files outside the touch set that named the removed constants or switches (`src/runner.ts`, `src/session.ts`, `src/handover.ts`, `src/prompt.ts`, `test/prompt-exec.test.ts`'s neutral-wording note) were rewritten per A4's precedent, and agent-fake's header "fourteen calls" became thirteen (A2's deferred fix). Docs: the package `AGENTS.md` usage-source line drops attempt's reuse; `docs/structure.md`'s usage row and single-dispatch row drop reuse, and the switches row names the retired registry. Gates: typecheck in both packages; `test:gate` 26.4 s within its 35 s budget (1,743 tests); goldens untouched; no e2e (no shell-visible surface touched).
- Tests: `test/switches.test.ts` (the two variables gone from every fixture; sixteen-variable counts and listings; a new tranche-1 case in the retired-registry describe pinning both reasons, the no-parse behavior and one notice per set variable), `test/session.test.ts` (takeover describe: the note-planted ◈-announcement case and the recorded-session takeover), `test/capability.test.ts` (ALL_ON without the reuse key; resume-false degrades fork only; the no-resume takeover case on default switches), `test/watch.test.ts` (round 2 through a resumed takeover), `test/agent-fake.test.ts` (rename on takeover, fleet-continuation, step continuation; the barest-agent clamp without the reuse entry), `test/agent-claude.test.ts` (degrade fixture without the key), `test/usage.test.ts` (the reuse row and its tier assertions deleted with the function).
- AUTO-RESOLVE: the shell still tells operators to set the two variables — `packages/auto/src/index.ts`'s `--handover-test` usage sentence "Set OPENCODE_AUTO_HANDOVER_CONCURRENT=on …" and README lines naming `OPENCODE_AUTO_REUSE_SESSION` — fix them in this unit? -> no, left for the unit that next touches the shell (A6's touch set names no shell file and its gate explicitly runs no e2e because "no shell-visible surface is touched"; the variables now answer their retirement notices, so a leftover instruction degrades to a one-line notice rather than an error; A2's structure.md precedent — texts outside a unit's touch set ride with the next unit that owns them; a later shell unit must drop that usage sentence and the README's reuse/concurrent passages).
- AUTO-DECISION: `test/usage.test.ts` and `test/prompt-exec.test.ts` were edited although the touch set names neither — the feature's own tests must go with the feature (the A6 goal's own clause) and usage.test.ts does not compile against a deleted `reuseAllowed`; prompt-exec's one comment described the two-mode wording the concurrent half of which no longer exists (no assertion changed). Stale comments naming the removed constants/switches in `src/runner.ts`, `src/session.ts`, `src/handover.ts` and `src/prompt.ts` were rewritten in this unit for the same reason A4 gave: a live file's contract comment must not describe a deleted mechanism; no behavior change.

**A7 — Digest instrumentation and cap (R3), 2026-09-28.**
- Landed: stats gained a `digests` optional section on every bucket (plans/0061 R3/A7), booked in parallel like `models`/`tiers`/`quotaWaits` with the same lenient parsing, deep copy and history rollover: per planning session the estimated sizes (the usage source's `estimateTokens`, the same estimate the cap uses) of `priorKnowledgeDigest` and `prevRoundDigest`, a `capped` counter, and `knowledgePhases` (a k phase's distillation completed — produced now or found already produced; dirty/failed attempts book nothing). Booked from `src/loop-plan.ts` (the round's first planning session, where the digests are read) and `src/knowledge.ts` (`extractKnowledge`'s ok/skipped exits). `src/conclusion.ts`'s round-complete block gains one indented line after the quota-window line, only when a counter is non-zero, only the non-zero parts (`  digests: prior knowledge 1 session / 12.0k tokens, previous round 1 session / 41.0k tokens, 1 capped, 2 knowledge phases`). The cap: above a quarter of `opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT` the planning prompt's `prevRound` slot carries the index form instead of the joined digest — the new `templates/prompts/digest-index.md` (path + estimated size per knowledge document and handover, one line asking the session to open what it needs), rendered by `renderDigestIndex` over `digestIndexEntries` (both in `src/knowledge.ts`; the entries mirror `prevRoundDigest`'s selection through the phases module's exports, phases.ts itself untouched), with one `ℹ` line at injection when the cap trips. The sizes are booked with the full digest's figures whether or not the cap tripped — the data is the point. The memory service stays unfunded; the knowledge phase, the `hasTasks: false` hook, the prior-knowledge reader and `extractPriorKnowledge` stay as they are (R16). Gates: typecheck in both packages; `test:gate` 27.07 s within its 35 s budget (1,753 tests); the shell e2e for the touched template (95 pass, 8 opt-in skips); `test/incident-regression.test.ts` untouched; the existing goldens unchanged, the new `test/golden/digest-index.golden.md` the only golden added. Stage A exit gate (§6.2): unit gate + e2e green, goldens unchanged except the §3.2 rows, lanes in place, zero SCCs — stage A closes.
- Tests: `test/stats.test.ts` (the digest describe: no-ops that write nothing; per-kind booking into the three buckets and the absent-until-booked shape; a capped-only booking; lenient parsing and history rollover; the conclusion's digest line — no data keeps the block at two lines, non-zero parts with singular/plural), `test/knowledge.test.ts` (`priorKnowledgeParts`; `digestIndexEntries` mirroring the digest's selection with estimated sizes; `renderDigestIndex`'s lines and figures; `extractKnowledge`'s knowledge-phase booking on the skipped exit and its absence on the dirty exit, the git fixtures now gitignoring `.auto/` like init does so the booking's stats.json does not read as dirty), `test/plan-loop.test.ts` (a continuation round below the cap injects the full digest and books both sizes; above the cap — a 1000-token run context against a ~755-token digest — the `prevRound` slot carries the index form with the document lines and the open-what-you-need line, the `ℹ` cap line prints, and the counters book `capped: 1`), `test/golden.test.ts` + `test/golden/digest-index.golden.md` (the index form's bytes), `test/template.test.ts` (the 32-template registry list and the representative context for the new slots).
- AUTO-DECISION: `src/template.ts` and `test/template.test.ts` were edited although the touch set names neither — the package's build convention registers a built-in template in `src/template.ts`'s embedded registry in the same change, and the registry-list test must follow it (A4's `config-fix.ts` precedent: a mechanically required edit, no behavior change beyond the registered template). The template carries `{{index}}` as a tier-1 marker (an override dropping the index lines would send a cap notice with no data, the usage notes' figure-slot precedent).
- AUTO-DECISION: the index-form assembly and renderer live in `src/knowledge.ts` (`priorKnowledgeParts`, `digestIndexEntries`, `renderDigestIndex`), not in `loop-plan.ts` or the prompt modules — `prompt.ts` is import-frozen and both it and `prompt-plan.ts` sit outside the touch set, while `knowledge.ts` is in it, owns the digest domain (`priorKnowledgeDigest`) and already imports the phases exports the previous-round selection needs; the loop-side cap decision stays in `phasePlanPrompt`, which has the opts and the joined digest. `priorKnowledgeDigest` was refactored onto `priorKnowledgeParts` with byte-identical output (the existing digest test passes unchanged).

**B1 — Transitions module and the write ratchet, 2026-09-28.**
- Landed: `src/chain-transitions.ts` (engine, §4.2) with the two pure computations of F5's four-plus-four copies. `forkSources(chain)` — the sorted fork-source list (the failed session above the chain's original session, by accumulated context; a 0-token error stub never qualifies), replacing its four copies in `session.ts` (switchModel, rotateProviderKey, the `recoverySources` closure — deleted, both its callers now call the shared function directly — and the retry ladder); the `ForkSource` type rides with it. `modelOfChain(chain, switches, phase)` — the no-registry model priority chain (chain.model > sticky > /failback wildcard override > the routing table, the role derived from the chain), replacing its four copies: `session.ts`'s switchModel `from` and the `chainModel` closure, `attempt.ts`'s target evaluation, and `unit-commit.ts`'s `resumeModelNow` no-registry return, which passes a minimal chain view of the record's role and phase (a resume has no live chain; the priority chain starts at sticky by design, and object-literal construction is not a ratchet write). `resolveModel`/`stickyModel` imports left the converted files; `attempt.ts`'s ◈ `from`-label keeps its own local reads (it labels the winner, a different computation from the chain itself). `test/chain-writes.test.ts` — the write ratchet: a lexical scanner (comment/string/template-prose stripped by a small state machine; template `${…}` stays code) counts assignments to and `delete`s of SessionChain fields through `: SessionChain`-annotated bindings per src file, outside `src/chain-transitions.ts`, against `CHAIN_WRITE_BUDGET` seeded with today's counts (attempt 33, artifact 5, exec-session 13, execute 25, runner 18, session-api 16, session 44, wrapup 1 — 155 total; the field list is parsed from `chain.ts`'s own type definition so it cannot drift, with a ≥20-field sanity floor). The budget holds equality, not just an upper bound: a file below its entry fails with "lower the table", so the table tracks reality and only goes down. The scanner's behavior is pinned by a synthetic-fixture case (prose, reads, `===`, object literals and every write form). `test/import-direction.test.ts`: `chain-transitions` classified driver; `RANK` gained it at 0 with the session-driving chain renumbered one up (watch 1 … runner 7), placing the transitions module below every session-driving entry so watch and the commit boundary's resume checks can both reach it (§4.10's "below attempt"). Gates: typecheck in both packages; `test:gate` 27.68 s within its 35 s budget (1,757 tests); goldens and agent-fake recordings unchanged (no §3.2 row applies); no e2e (no shell-visible surface touched).
- Tests: `test/chain-writes.test.ts` (new — the budget table, the stale-entry check, the field-reader sanity floor, the scanner fixture), `test/import-direction.test.ts` (classification and rank), `test/lanes.ts` (the new file joins the `unit` lane).
- AUTO-DECISION: the ratchet counts writes through `: SessionChain`-annotated bindings only; writes through structurally-typed stand-ins (failback.ts's `consumeFailback` parameter) are outside the scan, stated in the test's header (detection stays a name-based lexical scan rather than a type-checker pass — tsgo has no runtime API and a `typescript` dependency for one ratchet test would outweigh it; the stand-in's three writes disappear when their clear becomes the `resetRoute` transition, so the exit at B5 is unaffected).
- AUTO-DECISION: `RANK` was renumbered (chain-transitions 0, watch 1, attempt 2, session 3, artifact/exec-session 4, execute 5, runner 7) instead of sharing rank 0 with watch (rejected: sharing makes a future watch → transitions edge a layer violation, and the spine modules the turn engine adds will need slots below watch too; all existing edges stay strictly downward).
- AUTO-DECISION: the budget is asserted with equality rather than ≤ (rejected: ≤ lets a lowered reality leave the table stale-high, which hides the ratchet's progress and invites drift on the next edit; a conscious table edit in the converting unit is what "only goes down" means mechanically).
- AUTO-DECISION: `test/lanes.ts` was edited although the touch set names neither it nor the manifest — A1's completeness ratchet fails the suite for any test file missing from the manifest, so registering the new file is mechanically required (A7's `template.ts` precedent; no behavior change beyond the manifest).

**B2 — `session.ts` writes through transitions, 2026-09-28.**
- Landed: the six mutating transitions of §4.8's table that runSession's paths own, in `src/chain-transitions.ts` with their field writes and their rationale as documentation: `setRoute(chain, route)` (model, modelEntry, modelStep — wholesale, a route is one decision's outcome, not a merge; `step` defaults to the base step 0; a no-registry caller passes the model alone, entry and step having never held a defined value on that path), `retryOnFork(chain, forked, source, note)` (pending, pct, used, note; keeps `id` — the original session stays the recovery point), `moveOnFork` (the `id` clear + the retry's writes — the copy takes over and a note plus a non-empty id would hit the dispatch's resumed-reuse branch), `toBlankSession(chain, note)` (id↓, pct, note), `toAgent(chain, note)` (id↓, pending↓, failed↓, pct, note — the agent binding itself stays the following dispatch's write) and `dropStaleFailed(chain, id)` (failed↓ when it matches). `src/session.ts` converted all 44 write sites: switchModel's model switch (setRoute; the scope=phase `setSticky` stays the caller's call — the sticky holder is module state, not a chain field) and its cross-agent move (toAgent), the three fork loops of failover, key rotation and recovery (dropStaleFailed + moveOnFork), the four blank fallbacks (toBlankSession), the ladder retry's fork seeding (retryOnFork), and the base re-seed's one-off note (retryOnFork over the just-seeded fork — see the decision below). `runSession`'s loop structure is untouched (that is B4's) and `pauseForExit`'s reads stay as they were. `test/chain-writes.test.ts`: the `session.ts` budget entry 44 → 0; 111 writes left outside the transitions (attempt 33, artifact 5, exec-session 13, execute 25, runner 18, session-api 16, wrapup 1). Gates: typecheck in both packages; `test:gate` 26.77 s within the 35 s budget (1,757 tests); `test/session.test.ts` unchanged and green (52 cases); goldens and agent-fake recordings unchanged — this unit has no §3.2 row; `test/incident-regression.test.ts` untouched; no e2e (no shell-visible surface).
- Tests: `test/chain-writes.test.ts` (the lowered budget entry, holding equality). The conversions' equivalence is pinned by the existing suites that drive runSession's paths — `test/session.test.ts`'s failover/takeover wiring and the agent-fake dispatch/failover recordings — which this unit leaves unchanged per its row; the transitions add no new decision to test.
- AUTO-DECISION: `resetRoute` did not land with `setRoute` — no session.ts write resets a route (the resets live in attempt's session-scope failback clear and failback.ts's `consumeFailback`, the dispatch conversion's and the remaining-writers conversion's to make), and a transition arrives together with the conversion of its callers; an export without a caller would be dead code. The unit's scope line named the §4.8 row ("the pick; session-scope failback"), of which session.ts contributes only the failover's set site.
- AUTO-DECISION: the base re-seed's one-off note — the one write of the 44 that no named transition owns alone — goes through `retryOnFork` over the just-seeded fork: the seeded session is this retry's fork and the base its source, so the transition's pending/pct/used writes repeat the seeding's own values (the chain state is bit-identical) while attaching the note. Rejected: a note-only transition (vocabulary beyond §4.8's table) and folding the note into the seeding helper (session-api.ts is outside the unit's touch set, and its own chain writes are a later unit's).
- AUTO-DECISION: switchModel's local `toAgent` binding was renamed `pickAgent` (attempt's name for the pick's agent profile) to free the `toAgent` transition's name at its call site — a pure rename, no behavior.

**B3 — The dispatch plan, 2026-09-28.**
- Landed: `src/engine/dispatch.ts` (engine, §4.2) — the pure `planDispatch(chain, facts) → DispatchPlan`: the takeover decision (`resumed`, the single in-chain continuation after A6), the registry pick (the route for `setRoute` — the adapter model id, the entry key, and the context step a continuation or resumed takeover starts at per §4.5, recomputed from `chain.used` on a takeover — plus the variant, the entry for the steer context, the tier, the agent, and the ◈ announcement line computed with the pre-move `resumed`), the blocked outcome of an empty/wait/probe selection (byte-identical questions and `windowWait`), the cross-agent move with its worktree-check note and the ↻ pending line, and the failback-scope create flag. `DispatchFacts` carries the routing facts, the selection context (the executor builds it with `selectContext` at the seam, so the down marks, the /failback override, the key rings and the live windows enter as data, never as module state), the switches, the phase type entry, the takeover gate's capability and the log label; `nowOf` is called at the same four positions as before (list, select, the wait's opening, the move reason), so even the machine-clock tick points are unchanged. `moveReason` moved with the ◈ line and reads the marks through the context. `src/attempt.ts` became the executor: it builds the facts, returns `plan.blocked`, applies the pick through `setRoute` + `announceModel`, the move through `toAgent`, and converts all 33 of its chain writes — `consumePending`, `bindAgent` (under `pick !== undefined`, provably equivalent to the old `opts.routing` gate since a blocked selection returned earlier), `resetRoute` + `clearDownMarks` (the session-scope failback clear; the B2-deferred transition), `stepTo`, and the trio `promote`/`restoreRetryable`/`afterTestHandover`. `promote` also owns the else branch's failed-record clear ("cleared once promoted"), and `restoreRetryable` re-derives the record from the prior snapshot — `ChainPrior` gained the `failed` field — per the replacement invariant, whose condition now reads the snapshot value it always effectively read (nothing between the two transitions reads the record), so the early clear is unobservable on the retryable path. `attempt()` keeps its exported name and positional signature; the order of creation, subscription, claim, prompt race, booking and promotion or restoration is unchanged, and the no-registry half (the `modelOfChain` target after the failback clear, its ◈ line, the server-resolved announcement) stays in the executor byte for byte. `test/chain-writes.test.ts`: the `attempt.ts` budget entry 33 → 0 (78 writes remain outside the transitions: artifact 5, exec-session 13, execute 25, runner 18, session-api 16, wrapup 1 — B5's conversion). Gates: typecheck in both packages; `test:gate` 27.12 s within the 35 s budget (1,765 tests, 92 files); the goldens, the agent-fake recordings (111 cases, including the closing call-coverage roster) and `test/incident-regression.test.ts` unchanged — this unit has no §3.2 row; `test/session.test.ts` untouched and green; no e2e (no shell-visible export changed shape).
- Tests: `test/dispatch.test.ts` (new — one row per plan case: resumed, registry pick with route/variant/agent/announce, the registry takeover's step recomputation and suppressed announcement, blocked empty/wait/probe, the agent move with and without a pre-created fork, failback-scope create; a purity row pins that the planner writes no chain field), `test/chain-writes.test.ts` (the lowered entry, holding equality), `test/import-direction.test.ts` (`engine/dispatch` classified and ranked; `RANK` renumbered — chain-transitions 0, engine/dispatch 1, watch 2, attempt 3, session 4, artifact/exec-session 5, execute 6, runner 8 — the B1 precedent's reserved slots below watch for the engine modules), `test/lanes.ts` (the new file joins the `unit` lane).
- AUTO-DECISION: two transitions landed beyond §4.8's table — `announceModel(chain, model)` (modelShown) and `consumeNote(chain)` (note↓) — because the ratchet-at-zero acceptance for attempt.ts needs homes for the three ◈ announcement writes and the one-shot note clear, which the ruled table's rows do not cover (its attempt anchors account for 29 of the 33 writes; the remaining four are display memory and a one-shot clear). Rejected: folding the announcement into `setRoute` (session.ts's failover shares it and must not touch display state) and clearing the note inside `consumePending` (the clear must stay at the prompt — an early exit between the dispatch's start and the prompt keeps the note for the next dispatch today).
- AUTO-DECISION: the else branch's `chain.failed = undefined` moved into `promote` (the "cleared once promoted" write) rather than a fourth transition for the non-testHandover else — §4.8's trio row already lists `failed` among the three's fields, and the retryable path stays equivalent because `restoreRetryable` derives the record from the prior snapshot. Rejected: a clear-only transition (vocabulary beyond the table for one write) and moving the promote below the ◉ lines (they read the promoted counters; rewriting them onto `result` would be drift-prone churn).
- AUTO-DECISION: `test/import-direction.test.ts` and `test/lanes.ts` were edited although the touch set names neither — the direction test fails for any unclassified src module and the lane manifest's completeness ratchet fails for any test file missing from it, so both edits are mechanically required (A7's `template.ts` and B1's `lanes.ts` precedents; no behavior change beyond the tables).

**B4 — The ladder decision, 2026-09-28.**
- Landed: `src/engine/ladder.ts` (engine, §4.2/§4.7) — the pure `nextStep(result, ladder, facts) → Step` over `LadderState = { i, tried, clipped }` and the six kinds (`return`, `window-wait`, `recover`, `escalate`, `after-ladder`, `retry`). Everything the loop used to decide inline moved there as pure code, reproducing today's branch order exactly: the fault-face prefixes, `spentWindow`, the class-label computation (quota/auth/rate, the spent-window label, the "(classifier)" suffix), the `(registry || ring)` escalation gate, the retryable/spent recoveries, the ladder-position check and the network-failure restart signature; `WaitCause` moved with it (the steps' causes are `{ ...result, account }`, exactly the old spread). The facts are built per iteration at the executor's seam: `{ registry, ringLength, waits, server, account }`. `src/session.ts` became the executor: `runSession`'s loop is now only the dispatch of Steps — the attempt/catch head, the facts build, `nextStep`, one shared `learnFailure` for the fault steps (the fault-trio cases book once at entry, a recover with a cause books before `awaitRecovery`, the no-model recover carries no cause and books nothing — today's exact placement), and the switch, with a `step satisfies never` exhaustiveness line. The side effects stay in their places: `accountAnswered` on the return of a live result, `lateReset` after the escalation, the server restart before the backoff sleep (still `Bun.sleep`, non-interruptible, until the services clock owns it), and the retry's fork seeding (the most-valuable-session fork walk, the base re-seed, the blank fallback) moved verbatim into a local `seedRetry` executor closure. `switchModel`, `rotateProviderKey`, `awaitRecovery`, `pauseForExit` and `waitForWindow` stay executor functions over B2's transitions; the ladder's counters became the one `LadderState` object (`switchModel`'s candidate reset and tried/clipped bookkeeping, `awaitRecovery`'s fresh round, the retry's advance `ladder.i = nth + 1`); `runSession` keeps its exported name and positional signature, and every log line and note is byte-identical. The fault cases narrow the blocked result through a contract guard (`if (result.type !== "blocked") continue`, unreachable by nextStep's construction — the fault kinds answer a fault face, which only a blocked result carries) so the executor reads the failure fields type-safely without casts. Gates: typecheck in both packages; `test:gate` 26.68 s within its 35 s budget (1,791 tests); `test/session.test.ts` unchanged and green (52 cases); agent-fake unchanged and green (111 cases, the scheduled-wait and failover recordings included); goldens and the incident suite untouched — this unit has no §3.2 row.
- Tests: `test/ladder.test.ts` (new — 26 rows: every `Step` kind; every class label incl. the classifier suffix; the three spent windows and the per-minute/unknown-scope non-windows; ring vs registry vs neither at both the escalation gate and ladder exhaustion; ladder positions 1, 3, exhausted, and the empty `RETRY_WAITS=off` ladder; the network-restart flag with and without a managed server; the no-cause no-model recover; and a purity row pinning that the result and the ladder leave unchanged), `test/import-direction.test.ts` (`engine/ladder` classified and ranked — `RANK` renumbered: chain-transitions 0, engine/dispatch 1, engine/ladder 2, watch 3, attempt 4, session 5, artifact/exec-session 6, execute 7, runner 8 stays — the B1/B3 reserved-slots precedent), `test/lanes.ts` (the new file joins the `unit` lane).
- AUTO-DECISION: `LadderFacts` gained `account?: string` beyond the §4.7 sketch's four fields (the steps' `cause` carries the account whose learned windows the wait reads, and the executor's `learnFailure`/`accountAnswered` book the same one — a single `accountOf` read per iteration, replacing the three reads today's branches each did at their own points, all pure and unchanging in between; rejected: letting the executor enrich the steps' causes after the decision, which would mutate the plan object, and building the cause inside `awaitRecovery`, which would move a decision datum's origin into the wait loop).
- AUTO-DECISION: the `after-ladder` step carries the exhaustion recovery's `why` in addition to the sketch's `cause`, and the decision — not the executor — picks between `after-ladder` and a direct `recover` at ladder exhaustion via the `(registry || ring)` gate (the exhaustion message is pure, naming the ladder's length, so one site in the decision owns it; the escalate step's exhaustion message, in contrast, names the down marks and the tried candidates as they stand *after* the escalation wrote its own marks, so the executor composes that one — precomputing it would name the marks before they exist, and duplicating the string at both sites would drift).
- AUTO-DECISION: the fault steps' shared `learnFailure` booking hangs on the step kinds inside the executor's switch rather than on a boolean field of `Step` (the fault set is exactly escalate, after-ladder, retry and the recover-with-a-cause — recover-without-cause is the no-model path, which never booked — so the kind test states the invariant where the booking happens; rejected: a `books`/`fault` flag on every step, vocabulary beyond the sketch for one call's wiring).
- AUTO-DECISION: `test/import-direction.test.ts` and `test/lanes.ts` were edited although the touch set names neither — the direction test fails for any unclassified src module and the lane manifest's completeness ratchet fails for any test file missing from it, so both edits are mechanically required (B1/B3's precedent; no behavior change beyond the tables).
<!-- auto: eof -->

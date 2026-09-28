# 0063 — Reimplementing the driver in Rust: difficulty, risks, and a viable plan

Status: **analysis, 2026-09-28.** Answers the question "could, and should, the auto driver family be reimplemented in Rust end to end". It builds on the assessment of the consolidation program in [0062](./0062-consolidation-plan-assessment.md) and measures the port surface at `1482d53f8`. Nothing proposed here is scheduled; the recommendation (§7) is a standing decision with explicit trigger conditions (§5).

## 0. The verdict in one paragraph

A complete Rust reimplementation is **technically feasible with bounded difficulty**, for reasons specific to this codebase: the runtime dependency surface is tiny (one SDK, confined to three adapter files; the whole agent domain is 2,198 loc), the platform APIs used are standard process/file/timer work, and — decisively — the domain maps unusually well onto Rust's type system, because 0061's engine vocabulary (`TurnInput`, `Advice`, `Settle`, `Step`, `ErrorClass`, single-writer state slices) is a closed set of enums and traits in disguise, whose arbitration invariants Rust can check at compile time where the TS design checks them at runtime. But **nothing in the current requirements needs it**: performance is not an argument (the driver is I/O-bound on model responses measured in minutes; the suite's wall time is process spawn), and the decisive cost is the development loop — this codebase is developed largely by AI agents against a TypeScript suite, and the tool would be rebuilt by the very loop a Rust move would slow. Recommendation: do not port now; land 0061 and keep its fixtures language-neutral (they are the port option's spec); revisit on any §5 trigger, at which point §6's phased plan applies — a migration with parity gates, not a leap of faith.

## 1. What a port must cover (measured)

| surface | measured size (at `1482d53f8`) | port note |
|---|---|---|
| core `src/` | 101 modules, 30,701 loc | the port's body |
| core `test/` | 97 files, 33,630 loc, 91 suites, 1,787 tests | the executable spec; see §2 last row |
| shell `packages/auto` | 1,631 loc, one file + 2 embedded templates | thin CLI; ports to one binary crate |
| templates | 36 files (prompts, modes, intents, `opencode.json`, agent md) | copy verbatim; `include_str!` replaces `with { type: "file" }` |
| goldens / fixtures | 45 golden files + agent-fake recordings | language-neutral data; port as-is (the equivalence layer, §6) |
| runtime deps | exactly one: `@opencode-ai/sdk`, imported only by `src/agent/opencode/{client,events,server}.ts` | re-implement as an HTTP/SSE client; the 14-call `AgentClient` surface is small and already isolated |
| platform APIs | `Bun.file` ×123, `Bun.write` ×38, `Bun.spawn` ×15, `Bun.Glob` ×12, `Bun.sleep` ×3; `node:{path,fs,os,child_process}` | all standard: tokio fs/process, a glob crate, timers |
| external processes | git (subprocess), `opencode serve` (spawned server + profile env), `claude` CLI (stdin-driven process), script watchdog | subprocess discipline throughout, no FFI to replace |

The structural facts that make this port unusually tractable: the agent boundary is already frozen (0037/0055: no driver file imports the SDK); the selection core is already pure over injected facts; and 0061, once landed, turns the session engine's implicit rules into an explicit contract with recorded traces.

## 2. Difficulty by subsystem

| subsystem | difficulty | why | equivalence pinned by |
|---|---|---|---|
| path/grammar modules (`docpaths`, `numbering`, `gitignore`, `lock`, `agents-block`) | easy | string grammars; no state | ported unit tests |
| config / switches / fix rules / tombstones | easy | parsing + strict validation; the retired-key tombstones are just more grammar | ported unit tests |
| template engine + corpus | easy–medium | deliberately minimal custom engine (`{{var}}`, `{{#if}}`, `{{^x}}`, `{{> partial}}` with standalone-line and indent semantics); must render byte-exact | golden prompt files |
| git operations (`git.ts` 846 loc, `unit-commit`, resume baselines) | medium | keep shelling out to git — **not** libgit2 — so commit subjects, trailers, ordering and object bytes stay identical; nested-repo recursion and the SHA baseline checks port 1:1 | fixture-repo scenario tests |
| document/unit model (`tasks`, `document/*`, `phases`, roles) | medium | text-grammar parsers over the target contract; rich existing suites | ported unit tests |
| prompt assembly (`prompt`, `prompt-plan`, intent packs) | medium | data-flow over facts; 0061 E2's `PromptFacts` makes it pure | goldens |
| agent adapters (opencode HTTP/SSE + server spawn; claude process + stream-json) | medium | 2,198 loc domain; the wire surface is the 14 calls + `AgentEvent` vocabulary; server spawn passes key references through env | recorded SSE/process transcripts replayed through a local mock |
| session engine (`watch`/`attempt`/`session`) | medium–hard | the hardest *behavior*, but 0061's contract is the spec: inputs as enums, concerns as traits, `TurnState` slices as split borrows; the runtime audit invariants (0061 §4.4) become partially compile-time | **turn-trace replay parity** (0061 D0 fixtures, ported as JSON) |
| pipeline (`loop*`, `runner`, `execute`, `split`, `close`, …) | medium–hard | the largest surface and the thinnest internal spec; orchestration over the kernel and engine | end-to-end scenarios + shadow runs (§6 R4) |
| the test suite itself | the hidden ~60% | 33.6k loc of behavioral invariants; est. 55–70% ports in spirit, goldens/traces port as data | — |

## 3. What Rust would genuinely buy — and what it would not

**Buys.** (1) *Compile-time exhaustiveness*: a new `TurnInput` variant without an arbitration row is a build error, not a test failure; the closed vocabularies (`Advice`, `Settle`, `Step`, `ErrorClass`) become enums the compiler defends; single-writer state slices become borrow-checked by construction — the exact property 0061 §4.3 achieves with runtime freezing. (2) *Distribution*: one static binary, no Bun prerequisite — materially better for CI runners, servers, remote targets, signed releases. (3) *Async soundness by construction*: the race class 0061 F3/F4 documents (callbacks preempting a live loop through a shared `trip()`) cannot exist behind explicit channels; 0061's single-queue spine is precisely the design Rust would have forced anyway. (4) *Long-run robustness*: months-long deployments with no runtime-version drift.

**Does not buy.** Performance: the driver's wall time is model responses; the suite's wall time is process spawn (0061 F16, and 0062 §1's 168 s macOS measurement) — neither moves materially. Product capabilities: nothing on the 0060 §5 roadmap is blocked by TypeScript. Ecosystem: the opencode SDK lives in TS, so a Rust adapter tracks the HTTP/SSE contract directly rather than through the SDK — a small permanent tax, already mostly paid by the 14-call isolation.

## 4. The real costs and risks

| # | risk | severity | note |
|---|---|---|---|
| R-1 | **Development-loop regression** — the codebase is developed largely by AI agents against the suite (0060 §6.1); TS gives those agents instant typecheck (`tsgo`) and maximal training prior; Rust's borrow-checker friction in async state machines plus slower compile loops slow the tool's own construction loop. The tool would be rebuilt by the loop it just made slower. | **highest** | this alone justifies the "not now" even if every technical argument favored the port |
| R-2 | Port duration and dual maintenance: est. 35–50k Rust loc + 25–30k test loc; agent-driven, realistically 2–4 months wall (§6); during the window every behavioral fix lands twice or the trees diverge | high | phased parity gates bound it, never remove it |
| R-3 | Loss of the safety net until parity: the 91-suite net does not transfer; before the §6 gates are green, changes are unverifiable | high | mitigation: fixtures-as-data + shadow runs; port engine-first where the trace oracle is densest |
| R-4 | Shell-contract redesign: shells consume core TS sources via package `exports` and extend in-process (`registerTemplate`, `registerAgentAdapter`, `setShellProfile`); a Rust core forces Rust shells (the branch model rethought) or a process boundary (heavier than today's registry calls) | medium | the branch model (auto-core → shells snapshot) has no Rust analogue; this is design work, not translation |
| R-5 | Byte drift: log lines, commit subjects, prompt bytes, CJK width, timestamp formats — every one a parity gate, each a classic port trap | medium | goldens and traces make them mechanical to catch, tedious to fix |
| R-6 | Standards drift: agent-wire protocols (opencode, claude, whatever follows) evolve in other languages; adapters must track them at the HTTP/process level | medium | the frozen 14-call seam keeps this local |
| R-7 | Maintainer mix: whoever (humans and agents) maintains the tree must be Rust-fluent; a tooling bet, not a code bet | medium | revisit as agent codegen for Rust matures |

## 5. Trigger conditions (when the port becomes right)

- **T-1 Distribution becomes load-bearing**: users or CI without a Bun runtime; a single-binary or signed-release requirement.
- **T-2 The embeddable-`Run` direction (0060 §5.7) grows into a long-lived supervisor daemon** (many concurrent runs, months of uptime) where runtime robustness is contractual.
- **T-3 Parallel execution (0060 §5.4) lands and concurrency becomes the core's central concern**, with compile-time guarantees wanted for the scheduler.
- **T-4 Non-TS consumers need the core as a library** (FFI / embedding into another product).
- **T-5 The TS toolchain itself becomes a liability** (Bun drift, breaking changes) — currently the opposite of true.

Any one trigger justifies a feasibility spike (§6 R0–R1); two justify the program. **None is met today.**

## 6. The viable plan (if triggered)

Precondition: **0061 landed.** Its artifacts are the portable spec — the engine contract, the arbitration table, the turn-trace goldens (D0), the RunEvent input/decision logs (F1), the golden prompt corpus, and the agent-fake call recordings. This is the strongest practical argument for running 0061 even for someone whose end goal is Rust: the consolidation program is the port's specification-writing phase, paid for once.

Crates: `auto-contract` (types, pure vocabulary) · `auto-agent` (adapters, pool) · `auto-kernel` (git, units, docs, templates) · `auto-engine` (spine, concerns, ladder, dispatch) · `auto-pipeline` (loop, runner, roles) · `auto-cli` (the shell binary).

| phase | content | duration (agent-driven) | parity gate |
|---|---|---|---|
| R0 spec freeze | fixtures serialized language-neutral (JSON traces/goldens/recordings); the AgentClient wire protocol (14 calls, event vocabulary, spawn contract) written from the adapters; the target-directory contract doc frozen | 1–2 wk | fixtures load and self-validate |
| R1 kernel crates | contract types; template engine; docpaths/numbering/config/switches/git-ops (subprocess 1:1) | 3–5 wk | ported unit tiers green; template goldens byte-exact |
| R2 agent adapters | opencode HTTP/SSE client + server spawn (profile env, key references as references); claude process adapter + stream-json parser | 3–4 wk | recorded SSE/process transcripts replay byte-exact through a local mock |
| R3 engine | spine, concerns, ladder, dispatch over ported turn traces | 4–6 wk | **replay parity**: every recorded trace reproduces its effect sequence exactly |
| R4 pipeline + shell | loop/runner/execute/tasks/close; the CLI crate; the file contract end to end | 5–8 wk | scenario suites green; **shadow runs** — identical scripted scenarios driven through the TS and Rust drivers over twin fixture repos, diffing `.auto/`, the git log, and every prompt byte |
| R5 cutover | one release switches the default; the TS tree maintained one version as fallback; absorb notes per the 0053 lockstep mechanics | 1–2 wk | field shadow parity on the operator's own next round |

Total: roughly 4–6 months agent-driven wall time. Alternatives considered: **Go** — cheaper to port, but without sum types the arbitration/advice vocabulary degenerates into strings and the main technical reason to leave TS evaporates; **Zig** — productivity too low for a suite-driven loop; **stay TS** — the recommendation.

## 7. Recommendation

Stay on TypeScript; execute 0061 as ruled (with 0062's amendments); treat its artifacts as the down payment on the port option — in particular, keep the F1 RunEvent logs and the D0 turn traces in language-neutral JSON so the option never decays. Revisit this document when any §5 trigger fires; until then a port would be a rewrite for taste in a codebase whose costs live elsewhere (0062 §5: the program's schedule concentration, not its language).

## 8. Relationship to other documents

Stands on [0062](./0062-consolidation-plan-assessment.md) (the verified fact base and the verdict that 0061 is worth landing); draws its port-surface inventory from that review's measurements; interacts with [0060](./0060-driver-consolidation.md) §5.7 (embeddable `Run`, a trigger) and §5.4 (parallel execution, a trigger); treats [0061](./0061-driver-consolidation-plan.md) F1/D0 as the port's spec machinery. The strategic frame for *when* the triggers matter is [0064](./0064-positioning-alignment.md).

<!-- auto: eof -->

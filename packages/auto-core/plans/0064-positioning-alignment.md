# 0064 — Positioning the driver: the process layer of record for long-horizon agentic development

Status: **analysis, 2026-09-28.** What the auto family fundamentally *is* as a multi-step long-horizon coding-agent management tool, and how its positioning should align future development. Written after the assessment of the consolidation program ([0062](./0062-consolidation-plan-assessment.md)) and the platform question ([0063](./0063-rust-reimplementation-analysis.md)); its §5 sequence assumes 0061 lands. It is a strategy document: it names the identity, the traps, and the order of investments, and it can be wrong — §6 defines the evidence that would show it is.

## 0. The thesis in one paragraph

The tool's durable identity is not "an agent orchestrator" generically — that phrase describes a crowded and collapsing category. It is the **deterministic process layer of record for long-horizon software work**: a driver that owns order, state and boundaries while replaceable AI sessions do the work, with the target directory's files and git history as the durable, human-auditable record, and the person deciding at declared boundaries. Everything the codebase already is — the file contract, driver-exclusive writes, the unified commit as the completion condition, exit-code semantics, agents and models as variables, the order/state/boundaries doctrine with its grammar criterion (0060 §3, 0061 R15) — points at that identity; everything on the roadmap (RunEvent, the role registry, parallel execution, memory, the embeddable `Run`) extends one of its axes. The alignment risk is not competitive pressure from better agents; it is **drift into the two adjacent traps**: becoming an agent (judging content) or becoming a framework (hosting other people's logic). Both traps are already fenced by doctrine; positioning means keeping those fences load-bearing while the tool grows.

## 1. What the tool is, as its own contract states it

Read from the artifacts rather than the aspirations: rounds over days; decomposition into phases, tasks and subtasks with a dependency graph; sessions as replaceable, forkable, steer-able executors with handover boundaries; completion **never judged by self-report** (state files, ticks, and commits are the driver's); checking work as planned work with a `Result:` verdict (0044); the person present at boundaries — planning input, blocked halts (exit 2), `close` decisions, question policy; the AGENTS.md block and the whole target-directory layout as the interface every session sees; and the driver judging only grammars it defines (R15), never the meaning of prose.

Two properties follow that matter more than any feature:

1. **The record outlives the tool.** A run's full state is git commits, `docs/T-NNN` documents, index files and JSON state that any human, agent or script can read and manipulate without the driver present. This is the deepest moat: not lock-in but its absence — adoption costs little because leaving costs nothing, and audits need no special tooling.
2. **The tool is its own case study.** The repo's history — 61 numbered plans of decision provenance, T-NNN units executed by agents against a suite that is the executable spec, 0061 itself written to be executed by the pipeline it describes — is a running, public demonstration of weeks-long agent-driven development with human judgment at the boundaries. No competitor generates that evidence by default; the tool should treat it as a first-class artifact (§5 item 8).

## 2. Category and differentiation

The nearest genus is not the agent (Claude Code, opencode itself, codex-style CLIs — single-session executors whose value is capability) and not the agent framework (orchestration libraries for people *building* agents). It is the **durable workflow engine** — the shape of Temporal/Airflow: a state machine that outlives unreliable executors — specialized to software work, where the state store is git+files rather than a database, the tasks are LLM sessions, and the human is a first-class participant at declared boundaries rather than an after-the-fact reader of logs.

Four differentiators, each already structural rather than aspirational:

| differentiator | structural basis | survives better models? |
|---|---|---|
| the file contract (git-native, human/tool readable, intervenable) | driver-exclusive writes, unified commit, resume/close | yes — process-shaped, not capability-shaped |
| agents and models as variables (adapter registry, tier routing, key rings) | 0037–0042, 0055; the 14-call `AgentClient` seam | yes — the value *rises* as the option set grows |
| the mechanical/judgmental boundary (trustworthy unattended runs without reviewing everything) | 0044's doctrine, R15's grammar criterion, gates at boundaries | yes — it is what makes delegation safe |
| provenance and observability (plans/, stats, soon RunEvent) | 0019, 0055 §7.1, 0061 F1 | yes |

The strategic read of the landscape: single-session agents will keep improving on raw capability — longer contexts, fewer truncations, more reliable tool use. Orchestrators whose value is **capability-shaped** (prompt scaffolding, reliability compensation, context nursing) get hollowed out by that curve; orchestrators whose value is **process-shaped** (state, decomposition, auditability, boundaries, policy) get *more* valuable as the executors improve, because better executors make longer horizons and more delegation economical. This tool is on the right side of the line by doctrine. Positioning's first job is to keep it there (§3 T1).

## 3. Strategic tensions to align on

- **T1 — the capability trajectory.** As sessions finish reliably, compensation machinery (doccheck, stuck hints, truncation continuation, liveness probing) loses value; process shaping (decomposition, dependency graphs, parallelism, memory, gates) keeps it. 0061 R15 rightly replaced 0060's "would this check exist if sessions finished reliably?" existence test with the grammar criterion (the stuck detector deserved keeping on tool-call-stream grounds). The aligned posture: treat capability-driven shrinkage as a **scheduled cost audit, not an identity crisis** — e.g. quarterly, read the stats (which compensations fired, how often, per model) and prune what stopped paying. The doctrine stays; the machinery under it breathes.
- **T2 — one run, one directory, one lock.** Keep the core single-run. The supervisor/portfolio layer people will eventually want (many runs, priorities, budgets across projects) is a **consumer** of RunEvent and the embeddable `Run`, never core state — matching 0060 §5.8's line that extension is registries inside the process and consumers outside it. This preserves the reliability focus and lets the supervisor compete on its own terms.
- **T3 — the boundary is the human product.** Exit-2 blocked items, question policy, `close` decisions, plan approval: this is where human attention is actually spent, and today it is surfaced as terminal text and exit codes. Improving boundary ergonomics — why blocked, what is needed, the cheapest next action, one-keystroke accept/rework — grows adoption more than engine depth. RunEvent (F1) is the substrate; treat boundary UX as a first-class track, not a shell afterthought.
- **T4 — standards absorption.** Keep the 14-call `AgentClient` as the stable internal seam; absorb ecosystem standards (agents.md-style instruction files, MCP, future agent-wire protocols) **as adapters, never as core dependencies**. The core's variables stay swappable; that is the hedge that pays across vendor outages, price moves and capability jumps.
- **T5 — say the sweet spot out loud.** The demonstrated niche (the repo's own history) is weeks-long transformation programs — migrations, refactors, audits, consolidation — too large for one session, too mechanical for a human team, too judgment-laden for a script. "The driver for weeks-long codebase transformation" is a sharper positioning than "agent orchestration," and it is the one the evidence already supports.

## 4. What not to become (the fences, kept load-bearing)

1. **Not a content judge** (0060 §3/D7; R15): no driver-side prose-quality policing ever returns; quality judgment stays in planned acceptance work and people.
2. **Not a framework or marketplace** (0060 §5.8): extensibility is registries inside the process and consumers outside it; hosting third-party logic imports other people's failure modes into the reliability core.
3. **Not multi-tenant or federated** (0060 §5.8): one driver, one directory, one lock; supervision composes from outside.
4. **Not a model provider or gateway**: models are variables; routing is a service; the tool never becomes where models are bought or authenticated as an identity.
5. **Not a rewrite for taste** (0063): platform moves need triggers; until then the moat is the contract and the record, not the language.

## 5. Alignment for future development (sequenced)

Assumes 0061 executes as ruled; each item names its axis from §2.

1. **Execute 0061** (with 0062's amendments). It is the enabler of every axis below and the port option's down payment (0063 §6). Nothing else on this list is cheaper before it.
2. **RunEvent (F1) immediately after** — observability, replay fixtures, incident regression, and the boundary-UX substrate in one artifact; 0061 R4 already orders it first among directions.
3. **Boundary UX as a standing track beside the engine** (T3): blocked-item explainability, `close` ergonomics, plan-review surfaces — consumers over RunEvent, not core changes.
4. **The role registry (0060 §5.6) next**: session roles as data completes the workflow-shape axis — the extensibility with the most unclaimed value once the engine exists (a new kind of work becomes a descriptor, not surgery on `execute.ts`/`runner.ts`).
5. **Parallel execution behind its own design**: per-unit worktrees are the honest answer (0061 R4 is right that concurrent units in one worktree would take each other's half-written files); the dependency graph and `nextReady` selection already exist. This is the throughput axis for long horizons and the one direction that touches the file contract's semantics — hence its own numbered plan before code.
6. **Memory strictly gated on R3's counters** (already ruled): fund retrieval only when real rounds show digests near the cap; otherwise `prevRoundDigest` plus declarative knowledge is enough.
7. **Rust only on 0063's triggers**; keep the F1/D0 fixtures language-neutral meanwhile, so the option never decays.
8. **Publish the record**: the stats already collect unattended round-completion rates, human interventions per round, cost per round, per-model protocol-drift rates. Surface them as the tool's value proposition — for the operator's own decisions (T1's audits) first, and as the positioning evidence no capability-shaped competitor can fake.

## 6. How to tell if this framing is wrong

The thesis fails if any of these holds: real usage shows humans bypassing the file contract (editing through the tool only — then the record is not the product); compensation machinery stops firing *and* process features go unused (then the niche is narrower than weeks-long transformations); or boundary interactions cluster somewhere other than the declared boundaries (then the human product is elsewhere). Each is observable from RunEvent and stats within a quarter of landing F1 — which is itself an argument for item 2's ordering.

## 7. Relationship to other documents

Grounded in the contracts of [0060](./0060-driver-consolidation.md) (§3 doctrine, §5 directions) and [0061](./0061-driver-consolidation-plan.md) (R15, R3, R4, F1); sequenced against [0062](./0062-consolidation-plan-assessment.md) §5 (program duration) and [0063](./0063-rust-reimplementation-analysis.md) §5 (platform triggers). Historical anchors: 0044 (checking work is planned work), 0047 (the unit model), 0055 (models as variables), 0037/0039 (the agent registry and its frozen interface), 0059 (the lead and its split).

<!-- auto: eof -->

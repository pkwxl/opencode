# 0060 — Driver consolidation: sub-domains, an engine with policies, a composition root

Status: **design, proposed** (2026-09-27; nothing ruled, nothing implemented). Request: the operator asked how auto-core should be refactored so that feature improvements stop requiring dependency tracing across most of the codebase — core functionality retained, non-essentials pruned, greater modularity, workflow-guided with models and agents as variables and goals as the root, balancing architecture and functional mainlines for high extensibility and high reliability at once.

## 0. The answer in one paragraph

The import graph is not what makes feature work expensive: the runtime graph is acyclic and test-enforced (`test/import-direction.test.ts`, D8 domains, the chain layering). The cost comes from four measured facts. (1) The driver plane is one flat domain of ~80 modules with very wide fan-out: preflight imports 29 src modules, `attempt` 27, `session` and `runner` 26 each — the reading set of a behavioral feature is whoever imports whom, unbounded within the plane. (2) Two god-functions own nearly every behavioral feature: `watch()` is one ~1,070-line function holding ~30 pieces of shared mutable local state, `runSession()` ~900 lines of retry ladder; a cross-cutting mechanism (quota windows, 0057) therefore lives as branches in `chain`, `watch`, `session`, `attempt` and `stats` at once. (3) Stateful hubs (`switches` 28 importers, `git` 27, `tasks` 23, `log` 31) are reached into directly from everywhere, so a state change has no discoverable blast radius. (4) The domain migration stalled halfway: `prompt.ts` still physically reads driver state under `FROZEN_IMPORTS`, and 20 experiment switches multiply the behavior matrix every change must reason about. The refactoring that pays is therefore **not more file-splitting but consolidation around explicit objects with narrow interfaces**: finish the stalled domain moves, give the driver named sub-domains with entry modules, decompose the two god-functions into a fixed engine spine plus policy objects, assemble state into a composition root of services, and prune switch and code-path sprawl. Done right, the reading set for a typical behavioral feature drops from ~4,000 lines across 5–6 files to the engine contract plus one policy file.

## 1. Field evidence

Method: the src import graph extracted from `from "…"` statements over all 101 modules (30,216 LOC), the top-level shape of the largest files, and the enforced rules in `test/import-direction.test.ts`. Measured 2026-09-27.

### 1.1 The numbers

Hubs by in-degree (how many modules import it):

| module | in | loc | module | in | loc |
|---|---|---|---|---|---|
| log | 31 | 227 | shell | 16 | 113 |
| switches | 28 | 641 | prompt | 16 | 769 |
| git | 27 | 846 | phases/registry | 16 | 251 |
| tasks | 23 | 618 | chain | 15 | 469 |
| docpaths | 19 | 145 | phases | 14 | 544 |
| opts | 19 | 199 | resume | 13 | 237 |
| stats | 17 | 1,004 | document/roles | 12 | 251 |
| agent/types | 17 | 400 | models | 12 | 932 |

Fan-out in the pipeline (src imports): `loop-preflight` 29, `attempt` 27, `session` 26, `runner` 26, `loop-phase` 22, `execute` 22, `loop-task` 19, `loop-plan` 18, `loop` 18, `watch` 17.

God functions: `watch.ts` is 1,175 loc with a single exported `watch` (from line 103) whose own section comments enumerate ~30 pieces of shared mutable local state (usage walls, limit fields, classifier verdicts, liveness probes, steps, test handover, resolve ledger, question dedup, part recording, …). `session.ts` is 1,168 loc; `runSession` (from line 247) is ~900 lines of retry / restart / rotation / failover / wait-and-probe ladder.

Cycles: the runtime graph is acyclic (the enforced test already guarantees it). Counting type-only imports, one SCC exists — `exit ↔ failback ↔ interactive ↔ step`: `interactive` holds the value imports (`requestExit`, `requestFailback`), while `Boundary` lives in `step.ts` and `exit`/`failback` import it as a type. Small, but it is the one place the dependency direction genuinely tangles.

Stalled migration: `FROZEN_IMPORTS` (rule 7 of the direction test) pins `prompt.ts` to `["docpaths", "intent/load", "intent/types", "mode", "phases/registry", "resolve", "stuck", "switches", "tasks", "template"]` — the intent domain still physically depends on driver state, which is exactly what the freeze documents as a transition-era leftover (M0.7).

Switch sprawl: 20 registered `OPENCODE_AUTO_*` switches (`src/switches.ts`). Every behavioral feature's state space is the pipeline × modes × phases × these switches; several are superseded by the model registry (0055) or by the consolidation of their concern (steer/handover in 0056, windows in 0027/0055).

Horizontal smearing, the worked example: a quota-window change (0057) touches `chain.ts` (the retry policy and `agentGaveUp`), `watch.ts` (the `limit` event, the limit-field merge, the quota-window lines), `session.ts` (`planSleep`, the scheduled wait), `quota-windows.ts` (the learned windows) and `stats.ts` (`quotaWaits`) — five modules across three layers, ≈ 3,800–4,600 loc of reading for one behavioral change.

### 1.2 The counter-evidence (patterns that already work)

- The pure selection core (0055): `model-window` (declared leaf, injected clock), `tier`, `model-route`, `select` — pure over injected facts, one-way-rule protected below the session layer.
- The agent domain: a frozen `AgentClient` (14 never-rejecting calls) + `AgentEvent` vocabulary + per-adapter adapters behind a registry; the driver never imports the SDK.
- The unified unit model (`document/unit.ts`, M3.1) and the direction test itself: a ratchet that converts verbal conventions into assertions.

The refactor generalizes these three patterns; it does not invent new ones.

## 2. What is the essence (retained unchanged)

- **The workflow spine**: brief/plan-input → round/phase planning → decompose → subtask/whole sessions (auto's lead and split, 0059) → the `Result: PASS|FAIL` verdict → the unified commit → resume/closeout. The target-directory file contract (`docs/T-NNN`, `tasks.md`, `todo.md`→`done.md`, `.auto/units.json`), the exit codes and the commit-boundary invariants are the reliability anchor and the human-readable diff surface — byte-for-byte.
- **Agents as a variable**: `AgentClient`/`AgentHost`/`AgentCapabilities`, the adapter registry, the pool; capability degradation.
- **Models as a variable**: the registry loader, the pure routing/selection core, the key rings (references, never values).
- **The reliability apparatus**: the direction test (to be tightened, not bypassed), the agent-fake harness with its call-coverage assertion, the golden prompt files, the per-module suites, the plans/ lockstep discipline. Every move below is gated by these.

## 3. Decisions

### D1 — The driver plane is divided into sub-domains with entry modules

The flat driver domain (every other `src/*.ts`) is split into five sub-domains, each with **one entry/interface module**; cross-sub-domain imports go only through the entry. Enforcement extends `test/import-direction.test.ts` with a `SUBDOMAIN_ENTRIES` table beside `DOMAIN_ENTRIES` — the same ratchet, one level deeper.

| sub-domain | members (indicative; the CLASSIFIED tables move with each landing) | entry |
|---|---|---|
| kernel | `tasks`, `git`, `unit-commit`, `numbering`, `lock`, `stats` (ledger half), `document/*` consumers | the unit store + git boundary |
| session-engine | `watch`, `attempt`, `session`, `exec-session`, `chain`, `session-api` | the engine contract (D2) |
| pipeline | `runner`, `execute`, `split`, `loop`, `loop-*`, `plan`, `plan-input`, `close`, `task-add`, `wrapup`, `artifact`, `knowledge` | the run entry (`runAll`) |
| policies | `usage`, `quota-windows`, `classify`, `stuck`, `model-step` (live half), `capability`, `failback`, `step`, `hibernate`, `exit`, `interactive` | per-policy interfaces (D2/D5a) |
| runtime | `switches`, `log`, the `Run` services (D4), `opts`, `resume`, `handover` | the `Run` object |

This is what mechanically bounds the reading set: an agent improving a feature reads the entry file of the sub-domain it touches, not the 101-file map. Effective module count for any given change drops even though the file count rises — that is the right kind of addition.

### D2 — `watch()` becomes a fixed spine plus policy objects

The spine knows **order** and nothing else (~300 loc): dispatch → consume the `AgentEvent` stream → hand each event to registered policies → collect markers → terminal decision → return the summary. Every behavioral concern becomes a **policy object with a narrow interface, owning its own state** (today: locals of `watch()`):

`UsagePolicy` (milestone notices, the steer wall, the self-decided handover, 0056) · `LimitPolicy` (the limit fields' merge order, quota-window lines, learned-window reads, 0057) · `RecoveryPolicy` (error classification escalation beside the retry branch, 0055 §7.1) · `LivenessPolicy` (the probe, the announced silence, truncated-output resume, 0026) · `StuckPolicy` (0016) · `StepUpPolicy` (the `wider` context steps, 0055 §4.5) · `TestHandoverPolicy` (0023) · `QuestionPolicy` (permission + question handling, the resolve ledger, 0020).

Each policy is 60–150 loc, consumes the existing `AgentEvent` vocabulary, and is testable in isolation through the agent-fake harness — the coverage assertion then applies per policy. Extraction is strangler-fig: one branch out of `watch()` per stage (each a normal T-NNN unit with its tests), `watch()` shrinking to the spine. This is where "feature improvement with minimal tokens" is actually won: the quota-window worked example drops from five modules across three layers to the engine contract plus one policy file.

### D3 — `runSession()`'s retry ladder composes the same policies

The retry / restart / key-ring-rotation / failover / wait-and-probe ladder (~900 lines) is decomposed into the same policy objects (the `RetryOrchestrator` composing `LimitPolicy`, `RecoveryPolicy` and the hibernate/window sleeps), so a mechanism has **one code home** instead of branches in three layers. The layering rank (watch 0 → runner 6, 0024 §D.2) is preserved: policies sit at watch's rank or below.

### D4 — A composition root assembles the run's services

`LoopCtx` (13 fields, one mutable) and `RunAllOpts` stop accreting. Once, in preflight, a `Run` object is assembled:

```ts
type Run = {
  clock: Clock
  switches: Switchboard   // read-only snapshot after parse
  stats: StatsLedger      // accumulate only; reporting lives elsewhere
  git: GitOps             // beginUnit / commitTree / baselines
  units: UnitStore        // facade over tasks.ts + document/unit.ts + units.json
  fleet: AgentFleet       // wraps the agent pool
  router: ModelRouter     // wraps routing/select/keyring
  prompts: PromptLibrary
}
```

Modules receive the services they use; the direction test forbids services from importing the pipeline. Two guardrails: `Run` is a holder only — it never grows behavior — and each service stays cohesive; the goal is to make the blast radius of a state change typecheck-discoverable instead of "grep 28 call sites and hope".

### D5 — The pruning program

Ordered by value over risk; each item its own unit or small series.

- **(a) Merge the controls quartet.** `exit`/`failback`/`interactive`/`step` — the only tangle in the graph — become one controls module; `Boundary` moves to its entry. 4 files → 1, the SCC gone.
- **(b) `PromptFacts`, landing the stalled intent move.** Define the driver-state slice prompt assembly actually needs (`PromptFacts`), make `prompt.ts`/`prompt-plan.ts` pure over it. `FROZEN_IMPORTS` empties — the migration's own recorded todo.
- **(c) Switch diet.** Retire the registry-superseded knobs (`OPENCODE_AUTO_MODEL`/`_FALLBACK` ring, the no-registry half of `FAILBACK_SCOPE`), fold the step/hibernate controls into fewer switches, and audit `REUSE_SESSION`/`RETRY_WAITS`/`TASK_CONTEXT` for fixed defaults. Every retirement deletes branches in the engine. Switches never persist, so retirement is cheap mechanically — but it is operator-facing, so each retirement is a named ruling, not an architect's deletion.
- **(d) Single routing path.** At the next major version, once the registry is the default, delete the env-switch path (`parseModelPolicy`, the failover ring, failback's no-registry half). This is the largest honest deletion available; the dual path is why every routing change costs double. Until then both paths stay.
- **(e) Split the two fat state files.** `stats.ts` (1,004) → a ledger (~200, kernel, accumulate-only) + reporting beside `conclusion.ts`; `models.ts` (932) → schema/types + load/merge/validate. `models-describe` (650) is already separate and stays.
- **(f) Feature-level candidates, listed not ruled:** the knowledge phase as declarative phase-registry configuration; the same audit for `--handover-test`'s overlap with 0056's protocol.

### D6 — Physical moves go through re-export shims

`package.json` exports `"./*": "./src/*.ts"`, so any file move breaks shell branches. Each physical move lands as: new directory + re-export shim at the old path → shell branches flip on their next auto-core merge → shims deleted after the shells merge. Counted as a shell-contract version bump in one lockstep batch — the branch model (core lands on auto-core, shells refresh) already supports exactly this.

### D7 — Guardrails (what not to do)

- **No flat file-splitting without entry modules** — more files without bounded reach increases tracing cost; the unit of modularity is the interface, not the file.
- **`Run` never becomes a god object** and policies never share a mutable bag — each policy owns its state; that ownership is the point.
- **The target-directory file contract is never broken** — it is the cross-version anchor and what humans review.
- **No protocol-string translation mid-refactor** — the 0035 lockstep procedure owns every flip.
- **No user-visible feature is pruned by architect's fiat** — code paths (dual routing, dead switch branches) go aggressively; features only by the operator's ruling (D5c/d/f).

## 4. Stages and gates

| stage | content | gate |
|---|---|---|
| S1 | D5a (controls merge) + D5b (`PromptFacts`) | the SCC gone; `FROZEN_IMPORTS` empty; full suite green |
| S2 | D4 (services + the `Run` root), no behavior change | typecheck + full suite green; `LoopCtx` stops growing |
| S3 | D2/D3 (the engine extraction), one policy per stage, strangler-fig | agent-fake coverage per policy; `watch()` → ~300-loc spine |
| S4 | D1 (sub-domain entries + physical moves via shims) + D5c (switch diet) | direction ratchet tightened at every step; shells merged |

Each stage is a normal round of T-NNN units; protocol strings and shell-facing changes go in their lockstep batches (0035, D6).

## 5. Expected effect

The quota-window worked example (§1.1):

| | before | after (S3) |
|---|---|---|
| reading set | `watch` + `session` + `attempt` + `chain` + `quota-windows` (+ `stats`) ≈ 3,800–4,600 loc | engine contract (~100 loc) + `LimitPolicy` (~150 loc) |
| blast radius | branches in 3 layers; found by reading | one policy file; found by the type checker and the direction test |
| test surface | watch/session integration cases | one agent-fake suite per policy |

Generalized: a typical behavioral feature's reading set drops roughly 7×, and its blast radius becomes mechanically discoverable. Architecturally the invariant is stated once: the pipeline is the only code that knows order, policies the only code that knows behavior, services the only code that holds state, the agent and model registries remain the variables — which is the requested shape (workflow-guided, models and agents as variables, goals as the root), built by generalizing the patterns the codebase already trusts (§1.2).

## 6. Relationship to other designs

Generalizes 0024 (the module split and chain layering — the rank stays) and M0.7/D8 (the direction test — tightened one level); completes the M1–M4 domain migration that `FROZEN_IMPORTS` still documents; stands on 0037–0042 (the agent domain and the agent-fake harness), 0055 (the pure selection core and its one-way rules), 0057 (the quota windows — the worked example), 0056 and 0059 (usage steer and the lead — both become policies behind the same spine). D6 uses the 0053 lockstep/shell-contract mechanics. Touch points when stages land: `AGENTS.md` navigation (one line per landed mechanism), `docs/structure.md` (the driver section regrouped by sub-domain), `test/import-direction.test.ts` (`SUBDOMAIN_ENTRIES`).

## 7. Implementation record

None yet — this document is the proposal awaiting rulings (§3, D5c/d/f in particular name the decisions that need the operator).

<!-- auto: eof -->

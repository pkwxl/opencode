# 0060 — Driver consolidation: sub-domains, an engine with policies, a composition root

Status: **implemented as ruled in 0061** (2026-10-01). `plans/0061-driver-consolidation-plan.md` rules this document — its §2.1 answers the five rulings requested in §10 below, its §2.3 lists the parts of this design it replaces, and its §10 implementation record carries every landed unit; this document is the historical proposal. It was **design, proposed — revision 2** (2026-09-27). Revision 1 asked how auto-core should be refactored so feature improvements stop requiring dependency tracing across most of the codebase. This revision adds three things the operator's review ruled or requested: the **responsibility boundary** as the pruning criterion (§3 — refcheck retirement ruled, the whole quality-assurance family audited against the same line), the **extensibility review** (§5 — the consolidations of revision 1 become open protocols, plus the evolution directions a long-horizon assisted-development tool is missing), and the **test-suite strategy** (§6 — measured, re-tiered, scheduled against the refactor stages, with a feasibility verdict). Open rulings are collected in §10.

## 0. The answer in one paragraph

The import graph is not what makes feature work expensive: the runtime graph is acyclic and test-enforced (`test/import-direction.test.ts`, D8 domains, the chain layering). The cost comes from four measured facts. (1) The driver plane is one flat domain of ~80 modules (102 in `src/` overall) with very wide fan-out: preflight imports 29 src modules, `attempt` 27, `session` and `runner` 26 each — the reading set of a behavioral feature is whoever imports whom, unbounded within the plane. (2) Two god-functions own nearly every behavioral feature: `watch()` is one ~1,070-line function holding ~30 pieces of shared mutable local state, `runSession()` ~900 lines of retry ladder; a cross-cutting mechanism (quota windows, 0057) therefore lives as branches in `chain`, `watch`, `session`, `attempt` and `stats` at once. (3) Stateful hubs (`switches` 28 importers, `git` 27, `tasks` 23, `log` 31) are reached into directly from everywhere, so a state change has no discoverable blast radius. (4) The domain migration stalled halfway: `prompt.ts` still physically reads driver state under `FROZEN_IMPORTS`, and 20 experiment switches multiply the behavior matrix every change must reason about. The refactoring that pays is therefore **not more file-splitting but consolidation around explicit objects with narrow interfaces**: finish the stalled domain moves, give the driver named sub-domains with entry modules, decompose the two god-functions into a fixed engine spine plus **registered** policy objects, assemble state into a composition root of **registered** services, and prune switch, code-path and feature sprawl — pruning decided by one criterion, the responsibility boundary of §3. Done right, the reading set for a typical behavioral feature drops from ~4,000 lines across 5–6 files to the engine contract plus one policy file, and the ninth policy or fifth service is a registration, not surgery.

## 1. Field evidence

Method: the src import graph extracted from `from "…"` statements over all 102 modules (30,216 LOC), the top-level shape of the largest files, the enforced rules in `test/import-direction.test.ts`, and — new this revision — a feature-level audit of the doc-quality family and a measurement of the test suite. Measured 2026-09-27.

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
- The phase-type registry (0047): `--phases` letters, custom types from `.opencode/auto/phases/<type>.md`, per-type decompose template / duties / standard artifacts / **completion gates** — the workflow's shape is already data in one place.
- The unified unit model (`document/unit.ts`, M3.1) and the direction test itself: a ratchet that converts verbal conventions into assertions.

The refactor generalizes these patterns; it does not invent new ones. §5 leans on the third and fourth harder than revision 1 did.

### 1.3 The quality-assurance family (new — input to §3)

Features that check or repair the *content* of documents the sessions produce, measured:

| feature | loc (src / test) | mechanically decidable? | default | state it writes |
|---|---|---|---|---|
| refcheck — all three layers (0010, 0013): existence + line-cap validation, git-rename rewrite, rename-history recovery, `@sha` range reconfirmation, stale list | 745 / 693 | no — heuristic path-shape and slice comparison judging whether prose pointed at the right thing | **off** (`OPENCODE_AUTO_REF_CHECK`) | `.auto/invalid-refs.md` |
| `check` ① principle scan — regexes over AGENTS.md + open task docs for "a session is asked to run build/commit" | part of 149 / part of 298 | no — self-described heuristic, findings go to a human | on (manual command) | none |
| `check` ② reference layer — refcheck's scan surfaced as CLI findings | part of the above | no | off (the switch) | none |
| doccheck — shape check (0026): non-trivial length + `<!-- auto: eof -->` last line | 57 / small | **yes** — truncation is mechanically decidable | on | none |
| P1 scan (0045) — deliverable lines must not reference process paths | 70 + round-close wiring | **yes** — path grammar the driver itself owns | on | none |
| artifact specs (0031/0034) — `Artifacts:` declaration → existence + shape checks | document/spec.ts | **yes** — the declared contract, existence and shape only | on | none |
| round-close gates (0049) — whole-tree P1 scan, build, restatement-listing presence | 95 | **yes** (build) / presence-only (listing) | on | none |
| knowledge phase (0002/0006) — distills `kb.md` per phase; feeds `prevRoundDigest` into next round's planning | knowledge.ts | no — content generation (a session, not a scan) | opt-in letter | `kb.md` |

### 1.4 The test suite (new — input to §6)

91 suites + fixtures (1,077 loc) + 42 golden files; 32,845 test loc against 30,216 src loc (1.09 : 1). 1,750 tests, 12,352 `expect()` calls, all green, **139 s wall clock** on the dev machine (52 s user + 55 s system at 76% CPU — roughly half the wall time is process spawn and filesystem churn, not computation). Largest suites: `agent-fake` 2,711, `session` 1,021, `prompt-exec` 1,008, `stats` 949, `models` 910, `watch` 904. Case names sampled across the large suites are overwhelmingly *behavioral invariant* cases (clamps, rollovers, concurrent-write serialization, replay dedup) over injected doubles — not trivial getter/setter unit tests; the worst-placed mass sits in the god-function-level suites (`watch`, `session`), where every case drags the whole function's setup and several couple to internal mechanics.

## 2. What is the essence (retained unchanged)

- **The workflow spine**: brief/plan-input → round/phase planning → decompose → subtask/whole sessions (auto's lead and its split, 0059) → the `Result: PASS|FAIL` verdict → the unified commit → resume/closeout. The target-directory file contract (`docs/T-NNN`, `tasks.md`, `todo.md`→`done.md`, `.auto/units.json`), the exit codes and the commit-boundary invariants are the reliability anchor and the human-readable diff surface — byte-for-byte.
- **Agents as a variable**: `AgentClient`/`AgentHost`/`AgentCapabilities`, the adapter registry, the pool; capability degradation.
- **Models as a variable**: the registry loader, the pure routing/selection core, the key rings (references, never values).
- **The reliability apparatus**: the direction test (to be tightened, not bypassed), the agent-fake harness with its call-coverage assertion, the golden prompt files, the per-module suites, the plans/ lockstep discipline. Every move below is gated by these.

## 3. The responsibility boundary (the pruning criterion — ruled this revision)

The operator's ruling, generalized into the doctrine the pruning program now applies: **the driver owns order, state, and boundaries. It does not own the quality of content.** Concretely, three lines:

1. **Completion signals are the driver's when they are mechanically decidable** — a file exists, a marker is the last line, a path is on the right side of the process/deliverable boundary, a commit range contains only driver commits. `doccheck`, the P1 scan, artifact-spec checks, the round-close gates all pass this test: each compensates for sessions that *finish unreliably* (truncation, missing artifacts, boundary leaks), which is a session-reliability fact only the driver is positioned to detect at the boundary.
2. **Content quality is not the driver's, whoever writes the check** — whether a reference points at the right file, whether prose violates a principle, whether distilled knowledge is good. Quality *guidance* belongs to prompts (intent packs already carry the quality bars); quality *judgment* belongs to planned acceptance work (the v phase, the `Result:` verdict, human review — 0044's doctrine "checking work is planned work"). A driver-side scan that judges content re-implements acceptance work in the wrong layer, with heuristics instead of a model, and — refcheck's case — with driver code *editing document content* (the rename rewrite), the only place in the codebase the driver mutates prose rather than structure.
3. **The test for future features**: *would this check still exist if sessions finished reliably?* If it compensates for unfinished work → driver (mechanical). If it compensates for unwise work → acceptance work, never driver.
   *(Superseded by `plans/0061` R15, which restates this line as a grammar criterion: the driver may judge and write only grammars it defines — paths, markers, trailers, index lines, field blocks, the agent event and tool-call streams — and never judges or rewrites the meaning of prose. The wording above would have classed the stuck detector, a tool-call-stream grammar, as acceptance work; lines 1–2 stand.)*

Audit of §1.3's family against the doctrine:

| feature | verdict |
|---|---|
| refcheck (all layers incl. the `@sha` machinery, the stale list, the unit-commit gate, `check` ②) | **retire** — ruled (D5g) |
| `check` ① principle scan | **retire the heuristic half, fold the mechanical half into `fix`** — recommended, needs ruling (D5h) |
| doccheck shape check | keep — mechanically decidable truncation detection |
| P1 scan + round-close layer 1 | keep — the process/deliverable boundary is a driver concept (the driver owns the path grammar); pure and cheap |
| artifact specs | keep — declared-contract existence/shape, the session↔driver interface |
| round-close build + listing-presence gates | keep — mechanical / presence-only |
| knowledge phase | keep for now — it is content *generation* by a session (the right layer), and it is wired (feeds `prevRoundDigest`); D5f's declarative conversion stands, plus one honest open question (§5.6) |

One retirement consequence to note: pruning by this doctrine does not leave target directories unguarded — it moves the guard to where the doctrine says it works. Reference validity and prose quality become acceptance criteria the wrap-up session and the v phase check (and report through `Result:`), and the round-close restatement listing already forces decisions to survive in the target's own docs.

## 4. Decisions

### D1 — The driver plane is divided into sub-domains with entry modules

The flat driver domain (every other `src/*.ts`) is split into five sub-domains, each with **one entry/interface module**; cross-sub-domain imports go only through the entry. Enforcement extends `test/import-direction.test.ts` with a `SUBDOMAIN_ENTRIES` table beside `DOMAIN_ENTRIES` — the same ratchet, one level deeper.

| sub-domain | members (indicative; the CLASSIFIED tables move with each landing) | entry |
|---|---|---|
| kernel | `tasks`, `git`, `unit-commit`, `numbering`, `lock`, `stats` (ledger half), `document/*` consumers | the unit store + git boundary |
| session-engine | `watch`, `attempt`, `session`, `exec-session`, `chain`, `session-api` | the engine contract (D2) |
| pipeline | `runner`, `execute`, `split`, `loop`, `loop-*`, `plan`, `plan-input`, `close`, `task-add`, `wrapup`, `artifact`, `knowledge` | the run entry (`runAll`) |
| policies | `usage`, `quota-windows`, `classify`, `stuck`, `model-step` (live half), `capability`, `failback`, `step`, `hibernate`, `exit`, `interactive` | per-policy interfaces (D2/D5a) |
| runtime | `switches`, `log`, the `Run` services (D4), `opts`, `resume`, `handover` | the `Run` object |

The five rows are the *current* partition, not a closed set: the rule (entry module + ratchet row) is the mechanism, and a future sub-domain (a `memory` service domain, §5.5) joins by the same procedure — one ratchet edit, not a redesign. This is what mechanically bounds the reading set: an agent improving a feature reads the entry file of the sub-domain it touches, not the 102-file map. Effective module count for any given change drops even though the file count rises — that is the right kind of addition.

### D2 — `watch()` becomes a fixed spine plus **registered** policy objects

The spine knows **order** and nothing else (~300 loc): dispatch → consume the `AgentEvent` stream → hand each event to registered policies → collect markers → terminal decision → return the summary. Every behavioral concern becomes a **policy object with a narrow interface, owning its own state** (today: locals of `watch()`):

`UsagePolicy` (milestone notices, the steer wall, the self-decided handover, 0056) · `LimitPolicy` (the limit fields' merge order, quota-window lines, learned-window reads, 0057) · `RecoveryPolicy` (error classification escalation beside the retry branch, 0055 §7.1) · `LivenessPolicy` (the probe, the announced silence, truncated-output resume, 0026) · `StuckPolicy` (0016) · `StepUpPolicy` (the `wider` context steps, 0055 §4.5) · `TestHandoverPolicy` (0023) · `QuestionPolicy` (permission + question handling, the resolve ledger, 0020).

**Extensibility amendment (this revision, was implicit before): that list is the initial migration roster, not the type.** The engine exports a `WatchPolicy` protocol — the event subset a policy subscribes to, its state, its advices to the spine (steer text, early-settle, wait) — and a registry the spine iterates. The eight above are registered in the engine's own assembly; the ninth policy (a cost budget, a deadline, an external watcher) is a registration plus one file, touching neither the spine nor the direction tables. Extraction is strangler-fig: one branch out of `watch()` per stage (each a normal T-NNN unit with its tests), `watch()` shrinking to the spine. This is where "feature improvement with minimal tokens" is actually won: the quota-window worked example drops from five modules across three layers to the engine contract plus one policy file.

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

Modules receive the services they use; the direction test forbids services from importing the pipeline. **Extensibility amendment (this revision): each field is an interface with a core default, assembled in one registration site** — the same shape as `registerAgentAdapter`/`registerTemplate`. The seven above are the initial services, not a closed type: a `memory` service (§5.5) or an `events` bus (§5.2) slots in by registration. Two guardrails unchanged: `Run` is a holder only — it never grows behavior — and each service stays cohesive; the goal is to make the blast radius of a state change typecheck-discoverable instead of "grep 28 call sites and hope".

### D5 — The pruning program

Ordered by value over risk; each item its own unit or small series. The §3 doctrine is the criterion; (g) is ruled, (h) is recommended, (c)/(d)/(f) collect the remaining operator rulings.

- **(a) Merge the controls quartet.** `exit`/`failback`/`interactive`/`step` — the only tangle in the graph — become one controls module; `Boundary` moves to its entry. 4 files → 1, the SCC gone.
- **(b) `PromptFacts`, landing the stalled intent move.** Define the driver-state slice prompt assembly actually needs (`PromptFacts`), make `prompt.ts`/`prompt-plan.ts` pure over it. `FROZEN_IMPORTS` empties — the migration's own recorded todo.
- **(c) Switch diet.** Retire the registry-superseded knobs (`OPENCODE_AUTO_MODEL`/`_FALLBACK` ring, the no-registry half of `FAILBACK_SCOPE`), fold the step/hibernate controls into fewer switches, and audit `REUSE_SESSION`/`RETRY_WAITS`/`TASK_CONTEXT` for fixed defaults. Every retirement deletes branches in the engine. Switches never persist, so retirement is cheap mechanically — but it is operator-facing, so each retirement is a named ruling, not an architect's deletion.
- **(d) Single routing path.** At the next major version, once the registry is the default, delete the env-switch path (`parseModelPolicy`, the failover ring, failback's no-registry half). This is the largest honest deletion available; the dual path is why every routing change costs double. Until then both paths stay.
- **(e) Split the two fat state files.** `stats.ts` (1,004) → a ledger (~200, kernel, accumulate-only) + reporting beside `conclusion.ts`; `models.ts` (932) → schema/types + load/merge/validate. `models-describe` (650) is already separate and stays.
- **(f) Feature-level candidates, listed not ruled:** the knowledge phase as declarative phase-registry configuration; the same audit for `--handover-test`'s overlap with 0056's protocol — both re-examined inside the §5.5/§5.6 frames (ruling item 3).
- **(g) Retire refcheck entirely — ruled (2026-09-27, §3).** All three layers go: `src/refcheck.ts` (745 loc), the pre-commit gate in `unit-commit.ts` (`gatedAutoCorrectRefs` at the unified-commit boundary), `check`'s ② reference layer, the `OPENCODE_AUTO_REF_CHECK` switch, the `.auto/invalid-refs.md` stale list and its `recordOnce` helper (refcheck is its sole remaining consumer — the "migration skip list" named in its header no longer exists), `gitAvailable`'s note path, and `test/refcheck.test.ts` (693 loc). Follow-ons, mirroring the `CURRENT.md` retirement precedent (0054 D3): preflight deletes a leftover `.auto/invalid-refs.md`; the `REFCHECK_EXEMPT` markers (`deleted|archived|historical`) leave the 0035 protocol registry by its normal flip procedure; `plans/0010`/`0013` become historical record; `AGENTS.md` navigation and `docs/structure.md` drop the module in the same change. What is *not* deleted: `doccheck`'s `<!-- auto: eof -->` marker — it is the truncation signal (§3 line 1), not a reference-check device. Net: −~1,440 loc, one switch, one state file, and the driver stops editing document content.
- **(h) `check` → `fix` redistribution — recommended, ruling requested.** The principle scan ① is heuristic content-quality policing (§3 line 2): retire its regexes. The AGENTS.md block-staleness/legacy-block notes are config-mechanical findings — the exact shape `config-fix.ts`'s rule table already owns (fixable/manual, planned then applied); move them there. If both land, the `check` command itself dissolves (its exit-1 report was the heuristic's delivery vehicle); the ruling requested is whether to dissolve it or keep a read-only alias over `fix --plan`.

### D6 — Physical moves go through re-export shims

`package.json` exports `"./*": "./src/*.ts"`, so any file move breaks shell branches. Each physical move lands as: new directory + re-export shim at the old path → shell branches flip on their next auto-core merge → shims deleted after the shells merge. Counted as a shell-contract version bump in one lockstep batch — the branch model (core lands on auto-core, shells refresh) already supports exactly this.

### D7 — Guardrails (what not to do)

- **No flat file-splitting without entry modules** — more files without bounded reach increases tracing cost; the unit of modularity is the interface, not the file.
- **`Run` never becomes a god object** and policies never share a mutable bag — each policy owns its state; that ownership is the point.
- **The target-directory file contract is never broken** — it is the cross-version anchor and what humans review.
- **No protocol-string translation mid-refactor** — the 0035 lockstep procedure owns every flip.
- **No user-visible feature is pruned by architect's fiat** — code paths (dual routing, dead switch branches) go aggressively; features only by the operator's ruling (D5c/d/f/h). (g) is the recorded instance.
- **No content-quality scan returns to the driver** (this revision) — a future linter for reference validity or prose principles belongs to acceptance work or a separate tool, not to the run path. The §3 test is applied to every proposed gate.

## 5. Extensibility review: from closed consolidations to an open tool (new)

Revision 1's consolidations were the right shape but **closed**: eight named policies, seven named services, five named sub-domains. This section is the in-depth review the operator asked for — first the amendments (already folded into D1/D2/D4 above), then the directions the tool lacks for long-horizon assisted development. Directions are staged intentions with readiness conditions, not commitments; each becomes its own numbered plan when its stage arrives, and §10 collects the prioritization ruling.

### 5.1 What "extensible" must mean here

The tool's declared cornerstone is long-horizon assisted development: rounds over days, a person at boundaries, sessions and models as replaceable variables, the file contract as the durable record. Extensibility therefore has three axes, in priority order: (1) **behavior extensibility** — a new cross-cutting session concern lands as one policy file (D2's registry); (2) **workflow-shape extensibility** — a new kind of work (a new phase type exists already; a new *session role* or *gate* should be equally declarative); (3) **consumer extensibility** — something other than a terminal reading the run (an event stream, an embedding API). Revision 1 delivered axis 1 implicitly; the amendments make it explicit; the directions below are axes 2 and 3.

### 5.2 RunEvent — the observability surface (readiness: after S3)

Policies already make every interesting decision (usage milestones, limit verdicts, recovery waits, stuck hints, proxy answers). Today those decisions surface as `log` lines and end-of-run conclusion text. Direction: policies (and the spine, and the pipeline's unit boundaries) also emit typed `RunEvent`s — one JSONL append per event, `.auto/run-events.jsonl`, gitignored — giving: a supervising human a filterable progress feed for multi-hour runs; post-hoc analysis (time lost to waits, per-policy firing rates — today hand-tabulated in stats); and — the load-bearing synergy — **a replayable record**: an incident's event log becomes a regression fixture directly, sharpening `incident-regression.test.ts` beyond reconstructed cases. Cost is low *because* of D2 (policies are the emit points); doing it before S3 would mean threading emission through the god-functions — the exact anti-pattern this design exists to end. Open sub-question: whether events also carry an exit/steer *inbound* channel (a supervisory control file), deferred until there is a consumer.

### 5.3 The verdict and gate vocabulary (readiness: with S4)

The only verdict today is wrap-up's `Result: PASS|FAIL`; the phase registry already carries per-type `gates` (the v phase's `["verdict"]`), and round-close checks build + P1 + listing presence. Direction: grow the **mechanical** gate vocabulary the registry can compose per phase type — build/test command per gate, spec-table satisfaction, diff-shape expectations (files touched ⊆ `Touches:`) — always inside 0044's doctrine: gates check what is mechanically decidable at a boundary; judgment stays in planned acceptance sessions and people. This is also where the refcheck retirement's guard re-lands if anywhere: a *declared* per-phase reference-integrity gate a project opts into is acceptance work made mechanical at a boundary — categorically different from a driver-side always-on content scan (§3).

### 5.4 Parallel execution over the dependency graph (readiness: after S4, own design doc)

The unit model already carries `Depends:`/`Touches:` and `nextReady` selection; 0059's split guard already proves path-disjointness reasoning ("no path shared by independent streams"); the agent pool already manages multiple hosts; per-unit commit boundaries already serialize the git side. `--parallel` today is a prompt-level nudge (an intent subsection). Direction: the driver executes ready, path-disjoint units concurrently — the throughput axis for long horizons. This is the largest item here and the only one that touches the file contract's concurrency semantics (index ticks, `units.json`, the run lock is per-directory not per-unit), so it gets its own numbered design before any code.

### 5.5 Cross-round memory as a service (readiness: after S4; open question)

What survives today: intent packs (static, per project), knowledge docs (whole-doc injection via `prevRoundDigest`), the target's own docs (the P1 doctrine keeps them the real home of durable knowledge). Gap: retrieval. A round-20 planning session re-reads whole documents to find what round 7 learned. Direction: a `memory` service in the `Run` root — curated, committed, retrieval-shaped (index + summaries the planning prompt cites, sessions open sources on demand) — not a vector store bolted on, and not a second knowledge system: it must subsume or delete the k phase's injection path, not parallel it. Open question (§10): whether the k phase's measured value justifies this, or whether the declarative conversion (D5f) plus `prevRoundDigest` is enough and the service is deferred.

### 5.6 Workflow-shape registry — session roles as data (readiness: after S3+S4)

Phase types are data; session roles are not: adding a role (say, a per-task design-review session) today means editing `execute.ts`/`runner.ts`, a template, prompt assembly, and collect wiring. Direction: a **role descriptor registry** beside the phase registry — each role (decompose, subtask, whole/lead, wrap-up, planning, handover-distill, knowledge) declaring its template, tier route, usage source, collect policy, and verdict policy; the pipeline iterates descriptors the way the spine iterates policies. This is the third "variable" completing the requested shape (workflow-guided, models and agents as variables, goals as the root). Deferred behind the engine work because it sits *on* the engine: building it first would bake today's god-function coupling into a registry. The `--handover-test` audit (D5f) and the knowledge-phase question naturally re-examine their roles *inside* this frame once it exists.

### 5.7 The embeddable `Run` (readiness: opportunistic)

The D4 root is almost a programmatic API; shells are just its first consumers. Naming the intent now (stable `Run` construction, no terminal assumptions below `log`) keeps doors open — editor integrations, CI-driven runs, a future supervisor process — at zero present cost. No work scheduled; a guardrail, not a project.

### 5.8 Explicitly out of scope (this design's "no")

To keep the foundation focused: no plugin marketplace or third-party extension API (extension = registries inside the process, shells outside it); no remote/web UI (RunEvent JSONL is the interchange, consumers are not built here); no multi-user orchestration or federation (one driver, one directory, one lock — 0053 D1); no re-introduction of driver-side content judgment in any form (§3, D7 last guardrail).

## 6. The test suite: strategy (new — the operator's second question)

### 6.1 The honest answer to "do we need this many unit tests"

The premise needs correcting before the count does: measured (§1.4), the suite is **not** dominated by trivial unit tests — it is behavioral-invariant tests over injected doubles, which is the right *kind*. The real problems are placement, duplication, and speed: (1) the largest mass sits at the god-function level (`watch` 904 + `session` 1,021 loc), where every case pays the whole function's setup and several assert internal mechanics ("the subscription is aborted") that D2/D3 will make structurally impossible; (2) coverage overlaps across `watch`/`session`/`agent-fake` for cross-cutting behaviors; (3) 139 s wall is too slow for a per-unit feedback gate — the very loop this tool exists to drive — with roughly half the wall time in process spawns (git doubles, script runner cases). And one strategic fact raises the stakes: **this codebase is developed largely by AI agents against this suite** — the tests are the executable spec of the driver contract; thinning the spec thins the contract agents work to. The direction is therefore **re-tiering by placement, deduplication, and lane-splitting — not a smaller contract**. Raw line count moves only via feature retirement (refcheck: −693) and dedup (est. −10–15% of the god-function suites post-S3); the win being bought is maintenance cost per behavior change and feedback latency, not lines.

### 6.2 The target shape (five tiers, one ratchet each where applicable)

| tier | contents | gate/ratchet |
|---|---|---|
| pure-core tests | `select`, `model-window`, `doccheck`, unit graph, spec parsing — invariants, property-style where cheap | stay as-is; the one-way rules below the session layer |
| policy suites | one per D2 policy (60–150 loc each policy) over the agent-fake harness | **the call-coverage assertion generalizes per policy**: a policy's suite fails if an `AgentClient` call its behavior depends on goes unexercised |
| spine/chain tests | `watch` spine ordering, `runSession` ladder composition — order only, mechanics impossible by construction | thin (~200–300 loc total, from 1,925 today) |
| golden files | rendered prompts, agent contract — copy pinned | unchanged (42 files) |
| end-to-end scenarios | a handful of full rounds through the agent fake (decompose → subtasks → wrap-up → close-out; interruption; resume) | one scenario per named reliability story, replayed from recorded `RunEvent` logs once §5.2 lands |

### 6.3 Scheduling and feasibility

- **S1–S2: no test restructuring.** The suite is the refactor's safety net; thinning it first would raise exactly the risk the refactor exists to remove. Only test *deletions* that ride feature retirements happen early (refcheck −693 with D5g).
- **S3: re-home, don't rewrite.** The strangler-fig rule applies to tests as to code: each extracted policy takes its behavioral cases with it (rewritten against the policy interface, not the god-function), and the corresponding `watch`/`session` case is deleted in the same unit — the suite never grows a duplicate. `agent-fake.test.ts` (2,711 loc) splits along policy lines as its cases re-home.
- **S5 (new stage): the consolidation pass.** After the engine lands: a coverage-mapping audit deleting cases that duplicate tier-1/2 coverage; the lane split (fast lane = pure-core + policy suites + goldens, target < 30 s, run per unit; slow lane = e2e + spawn-heavy, run pre-merge and in the shell's CI); the scenario tier built on replayed event logs.
- **Feasibility: high, with one caveat.** Every mechanism already exists (agent-fake harness, coverage assertion, golden harness, direction test); the work is disciplined movement, gated by green runs at every step — the codebase's normal T-NNN unit discipline. The caveat is coverage regression during re-homing: mitigated by the per-policy coverage assertion and by keeping `incident-regression.test.ts` untouched throughout (it is the record of field pain, not of design). The 139 s → fast-lane < 30 s target is achievable mostly by *excluding* spawn-heavy cases from the fast lane, not by rewriting them — the slow half stays slow because it does real process work, and that is correct.

## 7. Stages and gates

| stage | content | gate |
|---|---|---|
| S1 | **D5g (refcheck retirement, ruled)** + D5a (controls merge) + D5b (`PromptFacts`) | the SCC gone; `FROZEN_IMPORTS` empty; `.auto/invalid-refs.md` cleanup verified; full suite green (−693 refcheck loc) |
| S2 | D4 (services + the `Run` root, registration-shaped), no behavior change | typecheck + full suite green; `LoopCtx` stops growing |
| S3 | D2/D3 (the engine extraction, policy registry), one policy per stage, strangler-fig; **tests re-home with each policy (§6.3)** | per-policy agent-fake coverage; `watch()` → ~300-loc spine; god-function suites shrink as cases move |
| S4 | D1 (sub-domain entries + physical moves via shims) + D5c (switch diet, minus the retired `REF_CHECK`) + D5e | direction ratchet tightened at every step; shells merged |
| S5 | **§6 consolidation pass**: dedup audit, lane split, e2e scenario tier (+ event-log replay if §5.2 has landed) | fast lane < 30 s; coverage assertion per policy green; incident-regression untouched and green |

Directions (§5.2–5.6) are scheduled *after* their readiness stage by their own numbered plans, per the §10 rulings.

## 8. Expected effect

The quota-window worked example (§1.1):

| | before | after (S3) |
|---|---|---|
| reading set | `watch` + `session` + `attempt` + `chain` + `quota-windows` (+ `stats`) ≈ 3,800–4,600 loc | engine contract (~100 loc) + `LimitPolicy` (~150 loc) |
| blast radius | branches in 3 layers; found by reading | one policy file; found by the type checker and the direction test |
| test surface | watch/session integration cases | one agent-fake suite per policy |

Generalized: a typical behavioral feature's reading set drops roughly 7×, and its blast radius becomes mechanically discoverable; a *new* cross-cutting concern becomes one registered policy file plus its suite. Architecturally the invariant is stated once: the pipeline is the only code that knows order, policies the only code that knows behavior, services the only code that holds state, the agent and model registries remain the variables, and — added this revision — the registries themselves are the growth mechanism (a ninth policy, a new service, a new phase type, eventually a new session role are registrations, not surgeries), while the driver's own contract stays pinned to order, state and boundaries (§3). That is the requested shape — workflow-guided, models and agents as variables, goals as the root, high extensibility and high reliability at once — built by generalizing the patterns the codebase already trusts (§1.2).

## 9. Relationship to other designs

Generalizes 0024 (the module split and chain layering — the rank stays) and M0.7/D8 (the direction test — tightened one level); completes the M1–M4 domain migration that `FROZEN_IMPORTS` still documents; stands on 0037–0042 (the agent domain and the agent-fake harness), 0055 (the pure selection core and its one-way rules), 0057 (the quota windows — the worked example), 0056 and 0059 (usage steer and the lead — both become policies behind the same spine). D5g retires the substance of 0010/0013 (historical record thereafter) and follows the 0054 D3 retirement precedent for leftover state files; D5h extends 0052's fix rule table. D6 uses the 0053 lockstep/shell-contract mechanics. §5.3 grows 0047's gate field and 0049's round-close vocabulary inside 0044's doctrine; §5.4 builds on the unit graph of 0047 and the split guard of 0059; §5.5 subsumes 0002/0006's injection path. Touch points when stages land: `AGENTS.md` navigation (one line per landed mechanism), `docs/structure.md` (the driver section regrouped by sub-domain), `test/import-direction.test.ts` (`SUBDOMAIN_ENTRIES`).

## 10. Rulings requested (the operator's decision list)

1. **D5h** — retire the `check` ① principle-scan heuristics and fold the AGENTS.md block-staleness notes into `fix`; dissolve `check`, or keep a read-only alias over `fix --plan`?
2. **D5c/d** — the switch-diet retirement list and the major-version timing for the single routing path.
3. **§5.5 vs D5f** — fund the memory service direction, or convert the knowledge phase to declarative configuration and defer retrieval?
4. **§5.2/§5.4/§5.6 ordering** — among the post-consolidation directions (RunEvent, parallel execution, role registry), which is first? (Recommendation: RunEvent — cheapest, and it feeds the S5 replay tier.)
5. **§6 lane policy** — is a < 30 s fast lane per unit the right feedback contract for driven sessions, or should the fast lane gate every *policy* unit only?

## 11. Implementation record

Not kept here — the program was ruled by `plans/0061-driver-consolidation-plan.md`, whose §10 records every landed unit; this document's §10 rulings are answered by 0061 §2.1 (the status line above names the relationship).

<!-- auto: eof -->

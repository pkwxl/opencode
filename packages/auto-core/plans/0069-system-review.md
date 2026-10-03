# 0069 — System review: convergence, pruning, and documentation governance

Status: **review, 2026-10-02.** A whole-project review grounded in the final vision ([0064](./0064-positioning-alignment.md)), covering the person's three axes: (1) goals & architecture convergence, redundancy, architectural debt; (2) feature pruning of unlanded early designs; (3) documentation & reference governance of `plans/`. Executed as eight read-only review units (a planning session designed the unit split; each unit ran as a fresh child session over a bounded read list; every claim below carries a `file:line` / `doc §` citation or a named census — the evidence rule bound every unit). This report is the deduplicated synthesis; it is self-contained, and it changes nothing — every recommendation becomes its own executional unit later.

## 0. Executive summary

**The project has converged, and converged well.** Against the 0064 identity — the deterministic process layer of record for long-horizon agentic development — all four differentiator axes are structurally present, all five fences hold in code (not just doctrine), and three of the eight roadmap investments landed in the last week (RunEvent, boundary UX in its 0067 form, parallel lanes). The consolidation program (0060/0061) did not leave parallel spines: the orchestration is one spine that fans out and re-converges twice, and every execution shape passes through the same session boundary, close-out, and unified commit.

**The three axes answer as follows:**

1. **Architecture:** the debt is concentrated, not diffuse. Three items carry most of it: `session.ts`'s closure web with a 5× copy-pasted fork-seeding scaffold; the duplicated ondemand-handover / lane-exit / recovery-ladder logic across `execute.ts` / `loop-task.ts` / `runner.ts`+`artifact.ts`; and two dead protocol fields (`LadderFacts.registry`/`ringLength`, `Watch/SessionResult.failover`) that tests keep looking exercised. Nothing structural blocks the vision; the named surgery sites for the unlanded role registry (`execute.ts`, `runner.ts`) keep growing, so the skip cost compounds.
2. **Feature pruning:** the codebase prunes aggressively by itself — verify/review, refcheck, CURRENT.md, and three experiment switches were all retired on schedule. Exactly **one** hard discard survives scrutiny (`--track-fixme`, with zero code to delete). The real pruning debt is three **decide** items for the person (`OPENCODE_AUTO_STRICT_RESUME` gray 17+ days, the ownerless `OPENCODE_AUTO_TASK_CONTEXT` knob, the 5-day-old `_DECOMPOSE_FINE` ruling), one live defect list (0065 F1–F4, unfixed), and five retain-by-design roadmap items whose revival triggers are already instrumented.
3. **Documentation governance:** the preserve-originals convention held up better than suspected — of 68 documents, exactly **one** merits deletion (0028, self-scheduled, condition verifiably met). The actual governance cost is **stale status headers**: 7 documents claim unimplemented/deferred/unchartered what verifiably landed (0002, 0005, 0009, 0011, 0053, 0066, 0067), and the repo's own top-level index (AGENTS.md's protocol-string line, structure.md's "14 calls") misdescribes current truth. The full correction surface is ~15 files and ~20 edited lines, packagable in four ordered commits.

**The single most urgent finding** is not in any one axis: the 0067 headless-service program — 13 units, T-086–T-098 — ran off a document whose header still says "not chartered" (`plans/0067:4`), in Chinese, while the landed code cites it as its design home (`../auto-server/src/worker.ts:1`, `src/run-status-schema.ts:1`). The plans/ convention's own control was bypassed by the thing the convention exists to govern.

## 1. The vision baseline (what everything below measures against)

**The goal** (0064 §0/§1): the auto driver family is the **deterministic process layer of record for long-horizon agentic software development** — a driver that owns order, state and boundaries while replaceable AI sessions do the work; the target directory's files and git history are the durable, human-auditable record; the person decides at declared boundaries. Completion is never judged by agent self-report; the driver judges only grammars it defines (R15). The record outlives the tool. Two traps: becoming an agent (judging content) or a framework (hosting other people's logic).

### 1.1 The four differentiator axes — where each lives today

| axis (0064 §2) | today's tree (verified) |
|---|---|
| file contract (git-native, intervenable) | `src/document/{roles,unit,state}.ts`, `src/tasks.ts`, `src/git.ts`+`git-ops.ts`+`unit-commit.ts`, `src/protect.ts`, `src/resume*.ts`, `src/close.ts` |
| agents/models as variables | `src/agent/types.ts` (AgentClient, **13** calls — counted; 0064/structure.md say 14, both wrong), `agent/{opencode,claude}/`, `agent-pool.ts`, `models*.ts`, `model-{route,window,step}.ts`, `tier.ts`, `select.ts`, `keyring.ts`, `routing.ts` |
| mechanical/judgmental boundary | `src/wrapup.ts` (`Result:`), `document/{spec,process-refs}.ts`, `doccheck.ts`, `phases/registry.ts` gates, `round-close.ts`, `engine/concerns/stuck.ts` |
| provenance & observability | `plans/` (68 docs), `stats.ts`+`conclusion.ts`+`loop-progress.ts`, `engine/events.ts` (RunEvent), `run-status{,-schema}.ts` |

### 1.2 The five fences — enforcers in place

1. **Not a content judge** — refcheck/`check` retired (only 3 retirement notices remain: `switches.ts:62,65`, `loop-preflight.ts:381`); live checks are grammar-only (R15).
2. **Not a framework** — in-process registries only (`registerTemplate`/`registerPartial`/`registerAgentAdapter`); shells and consumers live outside core.
3. **Not multi-tenant** — `src/lock.ts` one process per directory; supervision is an outside consumer (auto-server daemon spawns one worker per run).
4. **Not a model gateway** — keys stay `{env:}`/`{file:}` references end-to-end (`keyring.ts:1-8`, `agent-env.ts`); substitution happens in the managed server's own process.
5. **Not a taste-rewrite** — 0063's triggers govern; the tree stays all-TS with language-neutral JSONL replay fixtures.

### 1.3 The eight roadmap investments (0064 §5) — status

| # | item | status | evidence |
|---|---|---|---|
| 1 | execute 0061 | **landed** | 0061 §10 records through F3; `src/engine/` + 11 concerns present |
| 2 | RunEvent (F1) | **landed** | `engine/events.ts`, replay fixtures, real consumer `../auto-server/src/observe.ts:504,560` |
| 3 | boundary UX track | **partial, by another name** | 0067's program (T-094–T-097) — but core grew (`run-status.ts`, io/Interactive seam) under a line promising consumers-not-core |
| 4 | role registry | **open** (0 grep hits; surgery sites grown since) | 0060 §5.6 |
| 5 | parallel execution | **landed** | 0068, T-099–T-104; `lanes.ts`, worktrees in `git.ts` |
| 6 | memory retrieval | **gate landed, service open** | digest counters + 25% cap `stats.ts:78-99`; retrieval: 0 hits |
| 7 | Rust option | **open; trigger T-3 half-fired** | 0063 §5:65 "None is met today" is stale for T-3 since lanes landed |
| 8 | publish the record | **open; premise verified** | counters exist (`stats.ts:1025`); no surfacing artifact |

### 1.4 Drift risks (where the tree leans toward a trap)

1. The 0067 governance gap (§0 above) — the convention's control bypassed by its own program.
2. Roadmap sequencing diverged: item 4 (role registry) skipped while 2/3/5 leapt ahead; its surgery sites (`execute.ts`, `runner.ts`) grew with lanes cold-start — skip cost compounds.
3. "14-call" number drift between the two most load-bearing docs and code (§1.1).
4. 0063 T-3 half-fired with no scheduled re-read.
5. Boundary UX grew core surface under a consumers-not-core promise — watch that auto-server's requests keep landing as core seams, not core policy.
6. 0064 §6's falsifiers are now observable (F1 landed 2026-09-30) but no evaluation artifact exists; the quarter window closes ~2026-12.

## 2. Axis 1 — Goals and architecture: convergence, redundancy, debt

### 2.1 Convergence verdict

**One spine, fanning out and re-converging twice.** Selection is single (`routePhase` → `runTaskLoop`); it fans into three scheduling loops (serial / isolation / lane) that all re-converge on `runTask` unchanged (`loop-task.ts:788-795`), and four execution shapes (S1 whole-task ondemand, S2 planned decompose, S3 auto lead+split, S4 lane stream cold-start) that all pass through the same session boundary (`runExecSession`/`runSession`) and the same close-out (`git.afterSession` + rename/tick + `unitViolations`). No shape bypasses the unified commit — the completion-condition fence holds everywhere. Vision checks per shape: selection always via `next()`/`readyUnits` over file state; verdicts from state files and `lane.json`, never worker self-report (`lanes.ts:421`).

The consolidation (0061) landed cleanly: one queue (`spine.ts`), one chain-write home (`chain-transitions.ts`, 22 named transitions, every one with outside consumers), one fx seam with an audit journal, an 11-concern roster with no remainder layer, and three genuine ratchet tests (chain-writes, import-direction, lanes manifest) that check both directions — stale entries fail.

### 2.2 Consolidated redundancy/debt register (deduplicated across the three architecture units)

| # | item | where | status | verdict | cost |
|---|---|---|---|---|---|
| D1 | `runSession`'s closure web + 5× fork-seeding scaffold | `session.ts:212-1019`; seeding at :381-409, :462-483, :709-749, :791-873 | live, duplicated (~150 lines differing only in note lead + log line) | merge into one `seedFromSources` beside `forkSources` | 3-5 d total; note strings are session-visible protocol — medium risk |
| D2 | Dead no-registry plumbing: `LadderFacts.registry`/`ringLength` + `nextStep` branches | `ladder.ts:49,158,181`; constant `registry: true` at `session.ts:904` | dead in production; tests seed `registry: false` (`test/ladder.test.ts:20,46,68,90,101`) | kill | 0.5 d, near-zero risk |
| D3 | Dead `failover` field (write-only; named reader "runSession's P4" is gone) | `chain.ts:67-70,117`, `engine/result.ts:62` | dead; asserted by `test/watch.test.ts`, `test/agent-fake.test.ts` as if protocol | kill | 0.25 d |
| D4 | Duplicated ondemand-handover engine (2nd priority refactor, §2.3) | `execute.ts:303-352`+`:201-219` vs `:769-815`+`:724-744` | live, duplicated | merge | see R2 |
| D5 | Duplicated lane-exit handling + task brackets (4×) + boundary-hook trio (4×) | `loop-task.ts:415-449` vs `:723-783`; brackets :198/:371/:558/:867; hooks ×4 | live, duplicated | merge into `handleLaneExit()`/`taskBoundary()`; consider isolation loop = lane loop with slots=1 | ~120 lines, mechanical; byte-identical floor must hold |
| D6 | Recovery ladder exists twice with diverging why-strings | `runner.ts:135-309` vs `artifact.ts:120-208` (acknowledged at :138) | live, duplicated; already needed the same fix twice | one shared home (natural: `resume-gate.ts`) | see R3 — highest blast radius |
| D7 | Word-for-word subtask prechecks | `runner.ts:498-520` vs `:614-640` (census: "subtask state files are illegal" ×2) | live, duplicated | parameterize | cheap, near-zero risk |
| D8 | `opts.git ?? createGitOps()` fallback re-resolved at 9 entry points | census ×9 (`execute.ts:82/382/583`, `artifact.ts:103`, …) | live smell | one resolution point | cheap |
| D9 | Implicit-registry fallback literal ×3 | `attempt.ts:122`, `watch.ts:110`, `session.ts:194` | live, duplicated | move `routingOf` to `routing.ts` | 0.25 d |
| D10 | `session-api.ts` hosts pure formatters beside chain logic — the sole cause of the permanent `policies → engine` edge | `session-api.ts:318-349`; `model-step.ts:22`, `classify.ts:46` import from it | misplaced | split formatters into a runtime leaf | ~1 d, low risk |
| D11 | Probe-prompt literal duplicated | `session.ts:169` vs `agent-pool.ts:434` (verbatim, acknowledged) | live | export once | trivial |
| D12 | `dispatchCoverageProblems` re-implements select's agent filter | `routing.ts:170-176` vs `select.ts:273` | live, second copy | share the rule | trivial |
| D13 | SERVICE_ENTRIES: 2 entries at zero ambient use | `services.ts:111-119` (loop, loop-preflight use `createServices`, not the accessor) | vestigial | shrink (allowlist may only shrink — by its own rule) | 0.1 d |
| D14 | Orphan re-dispatch logic twice | `loop-preflight.ts:611-628` vs `loop-task.ts:757-782` | live, duplicated | re-home beside `lanes.ts` | small |
| D15 | Transitional preflight janitors (retired CURRENT.md mirror, retired invalid-refs list) | `loop-preflight.ts:373-381` | self-limiting debris cleanup | keep; schedule deletion when old releases age out | — |

Not debt (verified clean): the split between `exec-session.ts` and `session.ts` (wrapper owns only handover state machine); `askHuman`'s dual readline (by design); the three time-window systems (§2.4); the spine-vs-`watch.ts` facade split; `split.ts`, `task-add.ts`, `close.ts` (single-home, mechanical-only — models of the content-judge fence).

### 2.3 Top refactor recommendations (ordered by leverage)

- **R1 — Extract the fork-seeding helper, then lift `runSession`'s closures** (D1). The single worst comprehension cost in the plane; every path change re-reads an 800-line function. Risk note: booking order before escalation moves is load-bearing (`session.ts:941-950`).
- **R2 — One ondemand-handover engine in `execute.ts`** (D4+D7+D8 there). Risk: retry semantics differ deliberately (executeWhole retries the full prompt fresh; runSubtask demands the document in a fork of the ended session — AUTO-DECISION at `execute.ts:806-811`); behavior is pinned by `test/execute-handover.test.ts` and prompt goldens.
- **R3 — One recovery-ladder module** (D6, natural home `resume-gate.ts`). Highest blast radius: interruption fidelity is pinned by `resume*.test.ts`; the two callers differ in phase precision and the merge must preserve both.
- **R4 — Dead-vocabulary deletion** (D2+D3). Cheapest, pays immediately; compile-driven.
- **R5 — The role registry (0064 §5 item 4)** is the positive-architecture recommendation: every refactor above touches its future surgery sites; building the registry before they grow again converts the next new work-kind from surgery into a descriptor.

### 2.4 The variables plane (agents, models, routing) — T1 audit made concrete

- **No dead call on the AgentClient seam**: all 13 calls have ≥1 production call site outside adapters (census in RU-4 §0). No dual routing path remains after 0061 F2 — the env-switch grammar is the implicit registry's source, not a second dispatch path.
- **Compensation mechanisms** (0064 T1's scheduled cost audit): stuck hints — keep (explicitly ruled, tool-call-stream grounds); liveness probe — keep, but **the audit is blind**: probe failures, length continuations, and step-ups have **no per-model stats counter** (only fail/stuck/reprompt/quota/classify do, `stats.ts:1040,1145,1154`). Recommendation: add three counters (~3 lines each) or the quarterly audit cannot judge three of the five named compensations. Prune order when counters show zero: truncation continuation → step-up → liveness (last: it guards transport, which better models do not fix). Hibernation and the wait-and-probe loop are process-shaped — out of the audit's scope.
- **Three window systems, three subjects** — model availability (`model-window.ts`, tz/DST arithmetic), run tariff pause (`hibernate.ts`, UTC-only), learned account quota resets (`quota-windows.ts`): **keep all three**; merging couples run-level and learned state to the registry's validation surface for zero shared semantics. Shared pieces already factored once (jitter, booked waits).
- **Layer-backed-only surfaces** (key rings, classifier, steps, `PromptInput.variant`): reachable only under a registry layer; no operator or project layer exists in this environment — runtime cost already zero; residual cost is test surface and doc weight. Fence 4 (never a gateway) is compliant end-to-end.

## 3. Axis 2 — Feature pruning: unlanded and partially-landed designs

### 3.1 The headline

The person's hypothesis — early one-sided explorations lingering as dead weight — is mostly **refuted by the tree**: the codebase retires its own dead designs on schedule (verify/review loops, refcheck, CURRENT.md mirror, the no-registry failover ring's decision half, three experiment switches now notice-only). The residual is not dead code but **unruled decisions and stale documents**.

### 3.2 Design-level verdicts (condensed; full table in RU-5 findings)

| design | verdict | the operative fact |
|---|---|---|
| `--track-fixme` deviation tracking (0002 §A/§H) | **discard** | the only hard discard — census 0 hits in src/test/templates/shell; no CLI flag ever shipped; permanently blocked by 0044 D1 anyway; the knowledge half lives on as the k phase |
| strict resume (0022) | **decide** | complete + 20-test-covered since 2026-09-15; default off, gray 17+ days, no recorded field data — promote to default-on or set an expiry |
| `OPENCODE_AUTO_TASK_CONTEXT` | **decide (lean discard)** | ownerless wording knob (no owning plan; only mentioned in passing); changes only context.md's suggested-line wording — 8 sites in switches.ts + 3 in src |
| `_DECOMPOSE_FINE` (0059 D1/D9) | **decide (lean retain)** | consciously ruled off-by-default 5 days before this review; deletion would contradict a standing ruling |
| 0017 env-switch routing | **retain** | now the implicit registry's source grammar (0061 F2); stays env-only until a U1 constitutional promotion is ruled |
| 0026 boundary hardening | **close the checkboxes** | S6 de facto done (suite green for weeks); S7 operational; S8 a human field task — bookkeeping, not debt |
| 0057 S0 evidence gaps | **retain-with-trigger** | capture chore gated on the next spent quota window |
| 0065 artifact-declaration pitfalls F1–F4 | **retain — schedule the fix unit** | live defects, none of the four fixes landed: F1 `runner.ts:546` dispatch-time text, F2 `spec.ts:200` `Bun.file().exists()` (directory declarations unsatisfiable), F3 `status.ts:73` raw text; already cost two documented blocked cycles |
| 0066 quota module | **retain** | landed 2026-10-01 (`packages/quota`, 794f35095) despite its stale "deferred" header; future wire-in = 0057's `WindowSource: "probe"` |
| Rust port option (0063) | **retain-by-design** | fence 5; **T-3's first clause fired 2026-10-02** — schedule the trigger re-read |
| role registry (0060 §5.6 / 0064 item 4) | **retain-by-design** | the workflow-shape axis's main unclaimed value; revive at the next new work-kind proposal (§2.3 R5) |
| memory retrieval (0064 item 6) | **retain-by-design, gated** | trigger already instrumented: `DigestStats.capTrips > 0` across real rounds |
| boundary-UX track (0064 item 3) | **decide** | charter the standing track (sanctioning the core seams it grew) or fold them under auto-server's ownership |
| publish the record (0064 item 8) | **retain-by-design** | deadline-driven: the §6 falsifier evaluation (~2026-12) is its first mandatory consumer |
| 0010/0011 stable-refs, 0036 parallelism tiers, 0008 precise-resume | **nothing to prune** | landed then superseded/retired by their own retirement commits; only status-header fixes remain |
| auto-numbering (0001), knowledge distillation (0002/0020) | **retain** | constitutional / core loop machinery |

### 3.3 Experiment-switch census (19 entries, `switches.ts:17-53`)

16 of 19 **retain** with verified live consumers (each named in RU-5 §b). The three non-retain: `STRICT_RESUME` and `TASK_CONTEXT` (**decide**, above) and `DECOMPOSE_FINE` (**decide**, above). One coverage gap found: `OPENCODE_AUTO_LANE_ISOLATION` is touched only by `switches.test.ts` — `runIsolationLoop` (`loop-task.ts:351`) has **no suite**; add one (it is the byte-identical floor the whole lanes golden strategy rests on). The retired-switch registry (3 notice-only entries, `switches.ts:61-76`) is deliberate contract — keep.

## 4. Axis 3 — Documentation and reference governance

### 4.1 Verdict summary (all 68 documents; per-document table in Appendix A)

**41 live-reference / 19 historical-record-keep / 7 fix-status / 1 retire-and-delete.** Criteria (re-applicable): live-reference = named baseline of a running mechanism, no successor rewrite; historical-record-keep = unique decision provenance (convention default); retire-and-delete = only when self-scheduled or a pure consumption list, everything verifiably landed, and no kept doc needs it; fix-status = header actively misstates reality (banner-only edit, body verbatim).

**The one deletion: 0028** — self-scheduled ("delete this file at MA/M4 closure", `plans/0028:3`), condition verifiably met (zero Chinese in templates/goldens; M2.4/M3.7 flip commits landed), referenced by exactly one file (0035's header consumption list). No distillation needed.

**The convention challenge, answered honestly:** the person's expectation that many stage-assist documents should be retired-and-deleted does not survive scrutiny — the preserve-originals default is load-bearing (provenance is cited forward by living docs: 0050 ×119 out-references, 0061 ×78). The real governance defect is **stale status headers** (7 docs) plus **stale authoritative indexes** (AGENTS.md, structure.md — §4.3). Proposed standing rule: *a plan document's Status line is updated once, at the landing commit of its own unit* — cheap, mechanical, and it would have prevented all seven.

### 4.2 Stale/dangling references — the authoritative-pointer fix list

| # | artifact:line | defect → correction |
|---|---|---|
| A1 | `plans/0035:9` | consumption-list pointer to 0028 → drop/fold into 0035's banner, same commit as the deletion |
| A2–A8 | `plans/{0002,0005,0009,0011,0053,0066,0067}` headers | stale status banners (never-landed→blocked; sole-design-baseline→retired-by-0044; not-implemented→landed-then-superseded; awaiting-rulings→landed; implementation-deferred→landed; not-chartered→chartered+landed T-086–T-098) |
| A9 | `AGENTS.md:51` | protocol-string line says "still Chinese until the owning batch flips" — the flip program **closed 2026-09-28** (6 CJK lines remain in src, all comments; zero in templates/goldens); 0035's own retirement condition is met → rewrite the line; 0035 kept as registry record |
| A10 | `docs/structure.md:72` | "14 never-rejecting calls" → 13 |
| A11 | `plans/0064:27,38` | "the 14-call AgentClient seam" → 13 (live-reference doc; keeping current is sanctioned) |
| A12 | `../auto/README.md:1635` | user-facing claim that `--track-fixme` "still evolves independently, unimplemented" → never landed, retired; k-phase half (README:1537) stays |
| A13 | `test/import-direction.test.ts:260` | lanes comment "no caller outside tests" — false since 0068 → name the live callers |
| A14 | `../auto-server/src/request.ts:37,158-164` | "maxSessions 1 — the only value the core accepts today" + "concurrent execution is not supported yet" — both false since 0068, same day → fix comment; message wording is the shell owner's decision |

Provenance pointers that may stay (flagged, not fixed): the 23 plans docs + 6 src/test sites citing the deleted unnumbered root plans (never committed to this repo; only PLAN.md's content survives archived in 0007 — add one explanatory line, placement open); plans→plans citations of superseded docs (by design); 0063:65's dated "None is met today" (stale for T-3 — optional refresh, else the T-3 re-read lands it).

### 4.3 The reference census (shape of the graph)

AGENTS.md 104 refs → 43 distinct docs; docs/ 204 refs (structure 115, glossary 57, shell-contract 32); src comments 941 bare-number cites (0055 ×162, 0053 ×89, 0059 ×79, 0068 ×75); test 452; shells: ../auto 80, ../auto-server 26 (0067 ×16), ../quota 1; plans→plans ~347 paths + ~700 bare. The seven banner fixes create **zero** downstream churn (AGENTS.md carries no references to any of the seven except through fixed statuses); the 0028 deletion strands exactly one pointer, fixed in-commit.

### 4.4 The ordered correction procedure (four commits, cheapest-first, independently revertable)

1. **Status banners** — A2–A8, 7 files, docs-only.
2. **Authoritative-index truth** — A9–A12 (AGENTS.md, structure.md, 0064, auto README): the "what is true today" class.
3. **0028 deletion + pointer hygiene** — delete the file, apply A1, optionally note 0035's closure in the same commit.
4. **Executable-spec self-description** — A13–A14 (+ optional root-plan annotations, 0063 refresh); separate because a pinned test string may be affected.

Blast radius: **15 files, ~20 edited lines, one 40-line deletion**; no behavioral risk except A14's message string.

## 5. Cross-cutting findings

1. **The executable-spec claim substantially holds** (0064 §1 property 2): the three ratchets are genuine bidirectional locks; retirements are themselves pinned by negative tests (retired flags, legacy Chinese protocol refusals, mirror self-heal); the template registry has **zero orphans** (32 prompts, 18 tier-1 markers, 15 partial sections — every one consumed); the protocol-string flip program closed completely. The three weakest points: (i) the spec's front matter misdescribes itself (A9/A10 — the cheapest, most corrosive erosion); (ii) `loop-task.ts`, `execute.ts`, `status.ts` have no same-named suite — the spec's map no longer mirrors the module table (coverage exists, but proving non-orphanhood needed archaeology); (iii) the core/shell contract has **no enforcement leg** — §E item 8 was silently worked around by auto-server (no `_lane`, no `laneLauncher`, stale refusal message) on the batch's own day; the repo's own turn-convention-into-scanning-test pattern was never applied to that boundary.
2. **Counter-corrections to this review's own inputs**: the "124 test files" figure (initial survey) conflates suites and support files — the tree holds **112 `*.test.ts` suites, 42,250 lines** (231 files total in test/); the planning premise "0011 never implemented" was wrong (all four stages landed 2026-09-07/08, then superseded); "0066 deferred" was wrong (landed 2026-10-01).
3. **Findings spanning axes**: the stale 0067 header is simultaneously a governance defect (Axis 3), the record of a vision-conformant program (Axis 1 — 0067's corrections to the five-component split were right and were followed), and the reason auto-server's lanes divergence went unnoticed (the program's design home never became authoritative). The three audit-blind compensation counters (§2.4) are both an architecture gap and a publish-the-record (item 8) gap — the same three lines serve both.
4. **Preflight health**: only 2 of 21 checks serve retired designs (both self-limiting janitors, D15); the 44 KB growth is live-feature accretion, not dead weight. `RunAllOpts` living beside the checks is a minor cohesion smell.

## 6. Honest dissent and the decisions that need the person

Where the units pushed back on the review's own premises, and where rulings are genuinely the person's:

1. **"Many stage-assist docs should be deleted" — refuted** (RU-6, §4.1): one of 68. If the person wants a smaller plans/ anyway, that is a change to the two-tier convention (AGENTS.md), not a correction of drift — it should be ruled as such.
2. **"Early exploratory designs linger as dead code" — refuted** (RU-5, §3.1): one zero-cost discard. The pruning debt is three **decides**: `STRICT_RESUME` (promote or expire — the person ordered this design verbatim, so the ruling is theirs), `TASK_CONTEXT` (discard recommended), `DECOMPOSE_FINE` (retain recommended; contradicts nothing, but it is 5 days old).
3. **Boundary-UX ownership** (§3.2): charter the standing track with its core seams, or fold them under auto-server — both defensible; changes what "core" means going forward.
4. **0035's final disposition**: retired-as-history now that its condition is met (recommended), or kept as the live registry record for any future protocol string — the AGENTS.md line (A9) must be fixed either way.
5. **A14's user-facing message** and the root-plan explanatory note's placement: shell-owner / convention choices, not corrections.
6. **The falsifier evaluation** (0064 §6, due ~2026-12) and the **0063 T-3 trigger re-read**: both now due by the vision's own rules; neither has an owner.

## 7. Review provenance

Planned by a dedicated planning session (unit split, bounded read lists, acceptance checklists); executed as eight fresh read-only child sessions — RU-1 vision baseline; RU-2 session-driving plane; RU-3 orchestration plane; RU-4 variables plane + compensations; RU-5 feature pruning; RU-6 documentation verdicts; RU-7 reference graph; RU-8 executable-spec health — each verified against its acceptance checklist before synthesis; load-bearing claims spot-checked against primary sources. Unit-level findings (full tables, censuses, citations) are working artifacts; this document carries every operative conclusion. Method shaped by `prompts/plan-append.md` (the planning session's role) and `prompts/run.md` (the master-control loop's discipline: small context, pointers not contents, verdict-gated advancement), adapted to a read-only review with no driver state in this repository.

## 8. Execution record (T-105..T-113)

This review was adopted directly: nine execution units landed 2026-10-02 (R-01.P01's review-adoption tasks) — the four ordered documentation commits of §4.4 (T-105..T-108), then the five code units (T-109..T-113: the R4 dead-vocabulary deletion, the register smalls, the compensation counters, the `runIsolationLoop` suite, the 0065 fix unit). This section is their durable record, in the `plans/0061` §10 / `plans/0068` §13 format: one entry per unit — what landed, how it was verified, the decisions with their rejected alternatives — written 2026-10-03 by R-02's distillation stage before the corpus deletion. Provenance: each entry distills the unit's task report under `docs/` of the process-record repository (the outer workspace — the R-02 corpus deletion removes T-105..T-108's immediately and T-109..T-113's once this section is ruled sufficient; afterwards they resolve through that repository's git history); the landing commits are cited per entry in this repository's own history. The code units' gate progression: 2158 passing cases (T-109, T-110) → 2159 (T-111) → 2168 (T-112) → 2173 (T-113), each the prior baseline plus its own, 0 fail throughout, ~47–50 s against the 287.5 s budget; the documentation commits verify by census and typecheck as their entries state.

One set of findings spans five units and is stated once here — it feeds this round's e2e-stabilization unit (R-02 U-E1):

- **This host has no global git identity.** The core gate's repo-lane tests spawn `git commit` in temp repositories; without an identity they fail 16 times with "Author identity unknown", independent of any source change (verified on the untouched tree, T-109 and T-112). The green runs provided one without touching any user config: `GIT_CONFIG_GLOBAL=<temp file holding [user] name/email> bun run test:gate`. Never `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env vars — they override the locally-blanked repo identity and break the two deliberate identity-fallback tests in `test/git.test.ts` ("identity fallback still commits", "missing identity is reported"; the env-var route leaves exactly those two failing — verified in T-111).
- **git 2.43 without `init.defaultBranch` inits `master`.** `packages/auto`'s lane-conflict e2e expectation pins the literal `merge main into …` and fails here environmentally (the product prints `merge master into …`; re-run on pristine HEAD sources, it fails identically — verified in T-109).
- **macOS hosts diverge in the opposite direction.** Apple git auto-derives a committer identity even under the fixture's shielded HOME (the 0067 §8 macOS caveat; its durable consequence — auto-server's fixture sets a repo-local identity — already adopted), so the e2e init identity-prerequisite case, which needs the no-identity world the plain Linux environment provides, fails there instead. The two host classes fail opposite halves of the same e2e pair; neither failure ever reached these units' diffs (T-113 checked: no assertion in either failing test touches the unit's surface).

AUTO-DECISION (this record): the environment findings are lifted to the section head instead of being restated in each of the five reports that carry them (rejected alternative: per-entry repetition — the same caveat five times is the bloat a digest exists to cut; the entries below reference only what their unit added).
AUTO-RESOLVE (this record): T-108 left no report file (its directory holds only the task document) -> its entry is reconstructed from the task document's scope/acceptance and verified against the landed tree and commit (the reports are the named source but one is absent; the tree is the implementation truth, and every claim in that entry was re-checked against it here).
AUTO-DECISION (this record): per-unit test-case enumerations stay with the reports in git history; what stays here is the landed set, the verification verdict, the censuses the reports re-verified, and the decisions.

**T-105 — §4.4 commit 1: status banners A2–A8, 2026-10-02 (`8b9dfda4c`).**
- Landed: banner-only corrections in the seven stale plans/ headers — 0002 (`--track-fixme` never landed, census 0 hits, permanently blocked by `plans/0044` D1; the k-phase claim stays, true), 0005 (final-review deleted by 0044; the `--mode` layer still live as `src/mode.ts` and the templates/modes registration), 0009 (verify three-stage loop + `--review` landed T-017..T-024, then deleted by 0044), 0011 (S1..S4 landed 2026-09-07/08, then superseded — the checking half retired by `plans/0061` A3/A5, the storage half live), 0053 (P3 landed as T-008..T-015), 0066 (landed 2026-10-01 — `packages/quota`, `794f35095`), 0067 (chartered and landed as T-086..T-098). Six of the seven also gained the missing `<!-- auto: eof -->` terminator; no body line of any of the seven otherwise changed (+30/−5, every hunk in a header or a terminator append).
- Verified: the diff touches exactly the seven files; the incoming-reference census held byte-identical before and after (0009 ×12, 0002 ×11, 0011 ×5, 0005 ×3, 0066 ×2, 0053 ×2; none edited — §4.3's zero-downstream-churn claim); every pointer the banners introduce resolves; typecheck clean.
- AUTO-DECISION (report): 0005's wording deviates from Appendix A's one-liner ("all deleted by 0044") — the tree contradicts "all" (`src/mode.ts` is live and self-cites 0005 §A.1; 0044's own scope deletes only `ModeSpec.final` and the three `final:` sections), so the banner states final-review deleted / mode layer live (writing the Appendix line verbatim would manufacture a fresh stale banner).

**T-106 — §4.4 commit 2: authoritative-index truth A9–A12, 2026-10-02 (`75e4f18e4`).**
- Landed: A9 — auto-core AGENTS.md's protocol-string line rewritten to the closed truth (flip program closed 2026-09-28, literals all English, the six remaining CJK lines in src are comments, zero in templates/goldens, 0035's own retirement condition met), the `plans/0035` pointer kept and its final disposition left unruled (the person's, §6 item 4). A10 — structure.md "14 never-rejecting calls" → 13. A11 — plans/0064's "the 14-call AgentClient seam" → 13-call, both places. A12 — the auto README's `--track-fixme` claim corrected to never-landed/retired/permanently blocked by 0044 D1; the k-phase half byte-identical.
- Censuses re-verified before writing: CJK — exactly six comment lines in `src/**.ts`, zero in templates, test CJK only in negative tests and comments; the AgentClient recount — 13 methods (`create` … `contextLimits`), agreeing with the types file's own header, AGENTS.md's agent-domain line and agent-fake's exercise check; `--track-fixme` — one tree hit, the README claim itself.
- AUTO-DECISION (report): the A9 rewrite drops the old clause "never translate one inside a prose batch" — the rule disciplined the closed flip program, the legacy-Chinese refusals stay pinned by negative tests, and restating it would re-describe a closed program.
- Verified: exactly the four corrections (4 files, +7/−6); terminators intact; typecheck clean.

**T-107 — §4.4 commit 3: plans/0028 deletion with A1 pointer hygiene, 2026-10-02 (`aca18dab1`).**
- Landed: `plans/0028-m06-golden-bilingual-review.md` deleted (40 lines) — the one §4.1 deletion; A1 in `plans/0035`'s banner folds the deleted review descriptively ("the M0.6 golden bilingual mapping review", its own title wording — no number, no path), the rest of 0035 byte-identical.
- Grounds re-verified at execution time: the self-schedule (`plans/0028:3`); the condition met (zero CJK in templates/goldens; every M1–M4/MA flip commit in history — `0715ae88a`, `9c3c32203`, `175910a63`, `55cba23a2` plus the final repo-wide translations); referenced by exactly one file (`plans/0035:9`), no new references since the review.
- Verified: the full filename has zero matches across the repository; the surviving bare `0028` tokens are all sanctioned (this document's own verdict record; 0035's body prose, now flagged historical by the banner fold; unrelated numeric substrings elsewhere). §4.4's optional "note 0035's closure" was not taken — the disposition is the person's (§6 item 4). Typecheck clean.
- AUTO-DECISION (report): the fold is token-free — a strict grep and the drop/fold instruction are both satisfied while 0035's body citations of the mapping table stay explained.

**T-108 — §4.4 commit 4: executable-spec self-description A13–A14, 2026-10-02 (`e72f79892`).** (Entry reconstructed per the section-head AUTO-RESOLVE.)
- Landed: A13 — `test/import-direction.test.ts`'s lanes comment names the live production callers (the lane dispatch path in `loop-task.ts` — the activation check plus the lane and isolation loops that dispatch, land and re-dispatch lanes; the scheduler's preflight step in `loop-preflight.ts`, orphan recovery over the lane registry; the lane worker's own report write in `loop.ts`) beside the tests, with the two sibling lanes comments (the SUBDOMAIN row, the one-way rule) corrected in the same pass so the file states one truth. A14 — `packages/auto-server/src/request.ts`'s two comments re-attribute the maxSessions 1 limit to the shell's own current boundary (the core has run concurrency since 0068 and the worker maps the value straight into the core's run options).
- Constraint held: the user-facing `fail(...)` message string ("concurrent execution is not supported yet; …") is byte-identical — its wording is the shell owner's reserved call (§6 item 5), pinned by `worker.test.ts` and `daemon.test.ts`; the corrected comments say so in place.

**T-109 — §2.3 R4: dead-vocabulary deletion D2+D3, 2026-10-02 (`64b0cd33f`).**
- Landed: D2 — `LadderFacts.registry`/`ringLength` deleted (the type is now `{ waits; server; account? }`); `nextStep`'s escalate gate and the ladder-exhaustion ternary collapsed to their live arms (both gates had evaluated constantly true since the implicit registry, 0061 F2 — behavior-preserving by construction); the orphaned `overrideRing` helper deleted (`router.failbackOverride` keeps its live readers). D3 — the write-only `failover` field deleted from `Watch` and the blocked `SessionResult` variant (`chain.ts`), the error settle's fixed snapshot (`engine/result.ts`) and the blocked-exit copy (`attempt.ts`). Net −145/+96.
- Tests: `ladder.test.ts` rewritten against the live vocabulary — the dead-arm rows deleted (each unreachable in production since 0061 F2, kept looking live only by seeding `registry: false` / `ringLength: 0`; the one exhausted row now pins the only live arm, `after-ladder`); the non-retryable recover row moved to the live reachable arm (`errorClass: "unknown"`, `retryable: false`); `watch.test.ts` and `agent-fake.test.ts` lose the `failover` assertions (the quota early-settle row asserts `errorClass` — its behavior pin, abort-before-settle, unchanged). AUTO-DECISION (report): the seven turn-trace goldens had exactly the recorded `"failover": true` line hand-removed (a deleted protocol field necessarily leaves recorded fixtures; a wholesale regeneration was refused under the freeze rule — the byte-identical compare passing afterward proves the runtime difference was exactly the deleted field).
- Beyond the register: the collapse retired a third dead arm D2 had not named — `nextStep`'s spent-window recover branch (a spent window always builds a class label, which escalates first — unreachable in production since 0061 F2, statically unreachable after the collapse), deleted with its pinning row; the `retryable === false` recover branch stays live. Every register-named site was verified write-only or constant at execution time — nothing had to be left behind.
- Verified: gate 2158 pass / 0 fail (49 s); `packages/auto` typecheck clean, its e2e 101 pass with the two pre-existing environment failures (section head).

**T-110 — register smalls D7/D8/D9/D11–D14, 2026-10-02 (`449fbb362`).**
- Landed (behavior-preserving consolidations, 19 files +233/−145; no protocol string, log line, question text or golden changed): D7 `subtaskPrecheck(dir, task, items)` — the two word-for-word "subtask state files are illegal" blocks in `runner.ts`. D8 `gitOf(opts)` exported from `git-ops.ts` — the nine `opts.git ?? createGitOps()` fallback sites (`createServices`' own composition-root resolution stays, sanctioned beside the holder). D9 `routingOf` moved to `routing.ts` as a pure parameter-injected function — the fallback literal exists exactly once; `session.ts`'s exported wrapper keeps the allowlisted entry-module role and its `opts.router ??` precedence; `unit-commit.ts`'s private `factsOf` deliberately untouched (a different fallback — holderless `createRouter()` and a wall clock — outside the register's census). D11 `PROBE_PROMPT` exported from `agent-pool.ts` (the only viable single home — the reverse import would break agent-pool's one-way rule). D12 `entryPassesAgentFilter` in `select.ts` — §6.2 rule 1 shared by selection's candidate filter, `dispatchCoverageProblems` and `dispatchAgentProfiles`' add closure. D13 `SERVICE_ENTRIES` shrunk to five (loop and loop-preflight removed, both verified at zero ambient use; the seed test's pinned expectation updated through the conscious-edit path the allowlist's own rule names). D14 `orphanRedispatch(attempts, scheduling)` re-homed in `lanes.ts` — the decision rule both parents consult, the two keep-reason strings in one home.
- AUTO-DECISION (report): D8's "one resolution point" is realized as the shared helper, not parameter-threading (the opts carrier already is the resolved seam the loop passes down; threading would churn every exported signature and its test callers for the same one-literal outcome). D9's function is parameter-injected precisely so routing.ts cannot join `SERVICE_ENTRIES` (the allowlist may only shrink — and D13 shrinks it in the same task). D12 converts the third copy in the same file too (leaving one in the very file being deduplicated would defeat the item). D14 shares the rule, not the loops (the scheduler requeues into `inFlight` and must not block on a re-dispatch's exit; preflight awaits its workers synchronously — folding the loops would change scheduling semantics).
- Verified: no new import edge anywhere (the import-direction, sub-domain-edge, chain-layering, one-way and acyclicity suites green untouched); both package typechecks clean; gate 2158 pass / 0 fail across 112 files (46.8 s).
- Method worth keeping: a first D14 edit accidentally dropped " after fixing it" from preflight's cap-block log line — caught by diffing every message-bearing line against HEAD and restored before the final gate run.

**T-111 — §2.4: per-model compensation counters, 2026-10-02 (`92110b664`).**
- Landed: three `ModelStat` fields / `ModelEventKind` kinds in the existing one-word caliber of `fail`/`stuck`/`reprompt` — `probe`/`probeFails` (one failed liveness probe, on the model it probed), `continuation`/`lengthContinuations` (one length-cut continuation dispatch a truncated reply caused), `stepup`/`stepUps` (one context step-up, steered or late) — recorded through the same parallel three-bucket loop (task/phase/round, keyed by internal model name, absent model/dir a no-op) and plumbed through `emptyModelStat`, the lenient `parseModelStats` (old documents load at 0), `mergeModelStats` and the `statsLaneUsage` fold (a lane's counts roll up into the parent's records). Additive only — no decision, pruning, ordering or surfacing logic; `conclusion.ts` untouched (its per-model block prints only non-zero). The §2.4 "~3 lines each" estimate held per counter inside the recording function.
- Recording sites: the two failed-probe branches of `session.ts`'s `awaitRecovery` (successful probes count nothing — a recovery is not a compensation firing); the truncated-output continuation cell of `engine/concerns/liveness.ts` (log → counter → steer, the stuck hint's own order); `concerns/step-up.ts`'s `stepUp` and `stepLate`. The engine records through the turn fx (`TurnFx.statsModelEvent` widened from `"stuck"` to `ModelEventKind`; the spine's audit wrapper passes the kind through; journal/replay fixtures serve it member-and-args as before).
- AUTO-DECISION (report): late step-ups count the same way as steered ones (both are the session moving onto the next step's id — two counters would leave the prune question answerable only by a sum the document never kept); the fields are required, not optional, matching the three existing counters' convention (the parsers default every missing figure to 0).
- AUTO-RESOLVE (report): where the length-continuation counter records -> the liveness concern's truncated-output continuation cell (the task text's line pointer matched strict-resume's `continuation: true` selection flag — the grammar, not a mechanism; the report names the mechanism, and that cell is where the stuck counter's twin pattern sits).
- Verified: both package typechecks clean; gate 2159 pass / 0 fail (the 2158 baseline plus this unit's one new counter case); the replay suite green.

**T-112 — §3.3: a suite for `runIsolationLoop`, 2026-10-02 (`72d2c3d15`).**
- Landed: `test/loop-isolation.test.ts` (9 cases) plus the `test/lanes.ts` manifest registration (repo lane — the file creates worktrees and merges over real git, the manifest's runtime classification). No production change: `runTaskLoop` was already exported and the switch routes to `runIsolationLoop` inside it, so the suite drives the loop exactly the way a run reaches it. AUTO-DECISION (report): drive through the exported entry rather than export `runIsolationLoop` for tests (the branch itself is part of what the suite pins).
- Coverage: dispatch and selection — the order is `next()`'s, not index order (a plan whose `Depends:` make the order non-index), one lane at a time with the co-ready unit waiting, and the S3 case: `maxSessions = 2` under a `parallel` level with the switch on still gets isolation, never two worktrees parked at once. Landing and re-entry — the `Auto-Stage: done` terminal commit inside the lane beside one `Auto-Stage: landing` merge per unit; the drifted-tick case landing through D7 step ③'s `landing-sync` re-derivation. 0068 §6.2's failure matrix — a FAIL report lands its committed work and blocks (exit 2, the co-ready unit never dispatched); the re-run re-enters after the block; an orphan (exit 137, no report) keeps the scene at the park path and the re-run re-dispatches in the same worktree; a landing conflict blocks immediately under the D21 `low` posture, zero repairs, the scene kept and the main tree clean; an environment error is global, nothing lands, the scene stays for preflight recovery. The byte-identical floor (D10) — the same two-unit project switch-off over the scripted fake agent vs switch-on over the launcher stub writing the same artifact bytes: outcomes compare equal and the serial side dispatched no lane. AUTO-DECISION (report): the floor is compared at the outcome level — the e2e's `outcomes` shape — because D10 promises the same outcomes, not the same logs; the commit topology is the landing protocol's own and is pinned separately.
- Landing-conflict construction note (kept verbatim in substance from the report — the trap a future case author must avoid): the first conflict case committed the main side's edit **before** the run and timed out in an infinite dispatch loop — `dispatchLane` creates the worktree at the parent's current HEAD, so a pre-existing main-side commit is the lane's base and merges cleanly (no divergence, the unit never closes, and the loop correctly keeps scheduling it). A landing conflict needs the main tree to move **while the lane is in flight** (the real scenario: a sibling landing or a human commit); the case performs the housekeeping commit inside the launcher's work, beside the lane's own edit.
- Teeth (mutation checks, both reverted before the final runs): removing the switch's branch fails all 9 cases; replacing the isolation loop's `next(plan)` with index-order first-not-done fails the selection case. Verified: the suite 9 pass; the gate 2168 pass / 0 fail across 113 files.

**T-113 — plans/0065 fix unit: artifact-declaration defects F1–F4, 2026-10-02 (`4e7f593c5`).**
- Landed: F1 — `runSubtask` re-reads the item fresh from the checklist immediately before `subtaskArtifactProblems`, so a declaration the subtask session fixed mid-run is judged by the fixed text, not the dispatch-time snapshot (the T-066 S01/S02 incidents, one spurious block each); a checklist no longer holding the item falls back to the dispatch snapshot; read-only — the tick/idempotency invariant untouched. F2 — `directoryArtifactSpecs(text)` in `document/spec.ts` plus `decomposeArtifactProblems` rejecting each declared path ending in `/` with a problem line naming it: the failure lands in the planning session, which retries in-session, instead of a hidden subtask blockage at close-out; `Bun.file().exists()` stays a file existence test, now pinned to stay one. F3 — status item lines print `checklistTitle`'s 60-char cap instead of raw `item.text` (wrapping conventions between decompose sessions can no longer dump whole paragraphs into the tree). F4 — five cases across four suites, each verified to fail on the pre-fix shape (fix temporarily reverted, case run, fix re-applied), including the golden characterization of the hole itself: a declared directory that exists and is non-empty still reports `does not exist` under the "declared" policy — the case that would have surfaced F2 since M1.4. Also `plans/0065`'s own banner corrected (fix-status pattern) and its missing terminator added — the one plans/ file without it.
- Not-taken alternatives, kept from the report: F1's deeper move — the declaration's source of truth moving to `S<nn>/todo.md`'s `## Artifacts` section — was not taken (0065 makes the reload the default and the move optional; the reload also sits at the check inside `runSubtask`, not `runner.ts`'s two pass sites — one place covers the serial subtask loop and the stream-lane path, and the prompt/subject/banner keep the dispatch-time text, only the verdict needs freshness). F3's optional decompose-collect first-line cap was not added (redundant once status caps the display).
- Verified: the four touched suites 89 pass / 0 fail; the gate 2173 pass / 0 fail across 113 files, goldens byte-identical; typecheck clean.

## Appendix A — per-document verdicts for all 68 plans/ documents

Verdict key: **live** = live-reference (keep, keep current) · **keep** = historical-record-keep (untouched) · **fix** = fix-status (banner-only edit; the A-ids map to §4.2) · **delete** = retire-and-delete. Class in parentheses. Rationale citations in RU-6's findings; one line each.

| doc | verdict | what it is |
|---|---|---|
| 0001 | live | --auto-number design; numbering.ts live (landed-live) |
| 0002 | fix (A2) | --track-fixme + --extract-knowledge; track-fixme permanently blocked by 0044 D1 (unlanded-partial) |
| 0003 | keep | fork-decompose pipeline; landed, reshaped by 0030/0059 (superseded) |
| 0004 | keep | init config + AGENTS.md maintenance; superseded by 0052/0054 (superseded) |
| 0005 | fix (A3) | --mode/--final-review; all deleted by 0044 (landed-then-retired) |
| 0006 | keep | --phases + migration params; superseded by 0047/0052; unique k-phase record (superseded) |
| 0007 | keep | verbatim PLAN.md archive T-001..T-024; founding record (landed-then-retired) |
| 0008 | keep | precise-resume handover; design truth moved to 0009/0015/0018 (superseded) |
| 0009 | fix (A4) | verify three-stage pass + --review; retired by 0044 (landed-then-retired) |
| 0010 | keep | stable-refs storage + checking; checking half retired 0061 A3/A5, storage half live (landed-then-retired) |
| 0011 | fix (A5) | stable-refs P1 spec; header "not implemented" is false — landed then superseded (superseded) |
| 0012 | live | step mode; OPENCODE_AUTO_STEP live (landed-live) |
| 0013 | keep | refcheck scope + recovery; mechanism deleted 0061 A3, banner correct (landed-then-retired) |
| 0014 | live | /exit graceful exit; the control service (landed-live) |
| 0015 | live | session error retry; wait-probe loop live (landed-live) |
| 0016 | live | stuck-loop detection; default on (landed-live) |
| 0017 | keep | staged model routing; env path retired by implicit registry 0061 F2 (superseded) |
| 0018 | live | session-recovery precedence (landed-live) |
| 0019 | live | cross-interruption stats (landed-live) |
| 0020 | live | AUTO-RESOLVE/AUTO-DECISION split (landed-live) |
| 0021 | live | commit boundary; constitutional (landed-live) |
| 0022 | live | recovery fidelity (strict resume); switch decision open (§3.2) (landed-live) |
| 0023 | live | test-handover front-loading (landed-live) |
| 0024 | keep | runner/loop module split; done, reshaped by 0061; §D.2 rules live via test (superseded) |
| 0025 | keep | 2026-09-17 code review; M/L findings never all recorded resolved — latent value (analysis) |
| 0026 | live | session-boundary hardening; S6–S8 checkboxes bookkeeping (unlanded-partial) |
| 0027 | live | hibernate windows (landed-live) |
| 0028 | **delete** (A1) | M0.6 golden bilingual mapping; self-scheduled, condition met, one pointer (0035) (superseded) |
| 0029 | keep | retired behavior contract; the named historical pointer (landed-then-retired) |
| 0030 | keep | merged decompose session + todo/done; generalized by 0047 (superseded) |
| 0031 | live | intent pack schema freeze (landed-live) |
| 0032 | live | decompose intent externalization (landed-live) |
| 0033 | live | subtask-family externalization + marker tiers (landed-live) |
| 0034 | live | artifact spec structuring (landed-live) |
| 0035 | live | protocol string registry; flip program closed 2026-09-28 — pairs with A9 (landed-live) |
| 0036 | keep | parallelism + task identity + phase gate; exec half superseded by 0068, banner correct (superseded) |
| 0037 | live | agent interface freeze; 13 calls after 0055 (landed-live) |
| 0038 | live | usage source tiers (landed-live) |
| 0039 | live | opencode adapterization (landed-live) |
| 0040 | live | capability degradation (landed-live) |
| 0041 | live | claude headless adapter; measured fact baseline (landed-live) |
| 0042 | keep | agent track verification record; its fake is live (analysis) |
| 0043 | live | understand/wrapup/knowledge intent (landed-live) |
| 0044 | live | completion-side retirement; constitutional (landed-live) |
| 0045 | live | document role model; P1 scan invariant (landed-live) |
| 0046 | live | parallel declaration surface; consumed by 0068's scheduler (landed-live) |
| 0047 | live | unified unit layout; core invariant (landed-live) |
| 0048 | keep | round mechanism audit; inventory behind 0049 (analysis) |
| 0049 | live | human-gate convergence (landed-live) |
| 0050 | keep | retired per-file structure detail; named historical pointer (landed-then-retired) |
| 0051 | keep | MP.2 per-unit state; absorbed into 0068, banner correct (superseded) |
| 0052 | live | CLI responsibility convergence (landed-live) |
| 0053 | fix (A6) | plan/close/append lifecycle; "awaiting rulings" stale — P3 landed (landed-live) |
| 0054 | live | AGENTS.md/CURRENT.md retirement (landed-live) |
| 0055 | live | model registry + tier routing; §13 later items open (landed-live) |
| 0056 | live | ondemand self-directed handover (landed-live) |
| 0057 | live | session exceptions + quota windows; S0 gaps open (unlanded-partial) |
| 0058 | live | plan --new-task (landed-live) |
| 0059 | live | adaptive decomposition; auto/true split current (landed-live) |
| 0060 | keep | consolidation proposal; §3 doctrine still cited by 0064 (superseded) |
| 0061 | live | ruled consolidation program; the engine/services architecture home (landed-live) |
| 0062 | keep | consolidation assessment; all six amendments adopted (analysis) |
| 0063 | live | Rust reimplementation analysis; standing decision, T-3 half-fired (analysis) |
| 0064 | live | positioning alignment — the vision baseline; fix A11 (14→13) (analysis) |
| 0065 | live | artifact-declaration pitfalls; F1–F4 live defects, fix unit due (unlanded-partial) |
| 0066 | fix (A7) | quota module plan; "implementation deferred" stale — landed 2026-10-01 (landed-live) |
| 0067 | fix (A8) | headless service evolution; "not chartered" false — chartered + landed T-086–T-098 (draft) |
| 0068 | live | parallel execution lanes; S1–S6 landed T-099–T-104 (landed-live) |

<!-- auto: eof -->

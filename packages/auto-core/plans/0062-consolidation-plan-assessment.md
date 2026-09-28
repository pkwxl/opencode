# 0062 — Assessment of the driver-consolidation program (0061): feasibility and engineering soundness

Status: **assessment, 2026-09-28.** An independent review of [plans/0061](./0061-driver-consolidation-plan.md) (the ruled consolidation program) against the code at `1482d53f8`, written before any unit of the program starts. It records the verification evidence behind the verdict, the gaps found, and recommended amendments. Nothing here changes 0061's rulings; the amendments (§6) are offered to its §10 record for adoption or rejection. Companion documents: [0063](./0063-rust-reimplementation-analysis.md) (the Rust-reimplementation question, which builds on this verdict) and [0064](./0064-positioning-alignment.md) (positioning).

## 0. The verdict in one paragraph

0061 is feasible and its engineering basis is sound. Every load-bearing factual claim re-measured for this review held (§1) — the god-function sizes, the state inventories, the out-of-band inputs, the order-carried safety rules, the write-site counts, the churn numbers. Its central correction of 0060 — that `watch()`'s statement order carries safety rules which "registered policy objects" would turn into implicit registration order — is confirmed by the code, not merely argued. The equivalence methodology (a turn-trace oracle recorded before the first cut, goldens, agent-fake recordings, an untouched incident suite) is mechanical, not rhetorical. The staging is stoppable at every stage boundary with genuine exit ramps. Four gaps remain, none fatal: the 30 s gate budget is contingent on an unnamed machine (measured 168 s on this macOS host for the same suite 0061 times at 32 s), unit D1 concentrates the program's largest single risk, the oracle must explicitly handle scenarios that are racy *today*, and the program's calendar price (hold lists over the busiest files for the whole program) is real but unpriced. Verdict: proceed, with the §6 amendments adopted at or before the stage they concern.

## 1. Verification of the factual basis

0061 §1 states 20 facts measured at `91da1e515`; this review re-measured the load-bearing subset at `1482d53f8` (one commit later — the 0061 document itself). Method: direct reading of the cited code, grep/sed counting, git log, and one full-suite run.

| claim | how verified | result |
|---|---|---|
| F1 four functions > 500 lines; starts `watch` :103, `runSession` :248, `attempt` :80, `runTask` :92 | `grep -n` of the export lines; file sizes | **exact** (files 1,175 / 1,169 / 787 / 664 loc) |
| F2 ~37 `let` bindings, 6 mutable collections, 1 module `WeakMap` in `watch` | read `src/watch.ts` in full | **confirmed** (`windowsLogged` WeakMap at :88; the closure-captured locals match the `TurnState` sketch's slices almost one-to-one) |
| F3 probe timer + classifier answer preempt via shared `trip()`; cleanup depends on which fired | read :256–:266, :549–:576, :599 | **confirmed** (`if (!halfOpen && raised === undefined) await inner.return?.()` is exactly the conditional cleanup described) |
| F4 four order-carried safety rules | read :448–:470, :740–:757, :1092, :768–:790 | **confirmed, with the nuance 0061 adds**: the freeze commit's comment names idle "the only safe mid-session commit point"; the hard wall marks all bands spent then `continue`s past the step-up (the AUTO-RESOLVE at :756 documents the choice); truncation continuation requires `!error`; a measurement point sends a notice (no `continue`) *and then* may step up — two steers at one quiet point, while an idle steer ends the quiet point. 0061's restatement ("one steer per quiet point **at an idle**") is the correct generalization |
| F5 `SessionChain` ~20 fields, ~163 write sites in 9 files | type at `src/chain.ts:207`; grep of assignment/deletion sites | **confirmed** (21 fields; my looser grep counts ~170 sites — same population) |
| F10 `FROZEN_IMPORTS`, only `prompt`/`phases` import driver modules | `test/import-direction.test.ts:223` | **confirmed** |
| F16 suite 1,750 tests / 32 s on the gate machine | full `bun test` on this host | **partially confirmed, with a finding**: 1,787 tests, 12,609 `expect()` calls, 0 fail — but **167.9 s wall on this macOS machine**. This matches 0061's own footnote that 0060's 139 s is a macOS-platform figure; it also means R5's "every unit gated on the full suite under 30 s" is true only on the still-unnamed gate machine (§6 A-1) |
| F19 `watch` 23 / `session` 20 / `attempt` 19 commits in the prior week | `git log --since=2026-09-20 --until=2026-09-28` per file | **exact** |
| R2 "79 registry/no-registry branch sites in 9 files" | grep of routing-truthiness sites | **confirmed** (74 by a stricter pattern) |
| §4.5 arbitration table rows reproduce today's branch order | row-by-row against the `part`/`message`/`question`/`error`/`retry`/`idle` branches | **confirmed** — the table's row order inside each input tracks the code's statement order, including the subtle placements (liveness after failure on `part`; stepUp after usage on `message`; recovery before liveness on `retry`) |
| module/test scale: ~102 modules, ~30.2k src loc, 91 suites, ~33k test loc | `find`/`wc` | **confirmed** (101 src modules + `templates.d.ts`; 30,701 src; 91 suites; 33,630 test loc; 45 golden files vs the 42 counted in 0060 — trivial drift, likely subdirectory counting) |

Two environment facts this review adds to the record: the SDK dependency is confined to `src/agent/opencode/{client,events,server}.ts` (the whole agent domain is 2,198 loc — load-bearing for 0063), and Bun-specific API use is small and standard (`Bun.file` ×123, `Bun.write` ×38, `Bun.spawn` ×15, `Bun.Glob` ×12, `Bun.sleep` ×3).

## 2. The central correction of 0060 is right

0060 D2/D3 proposed stateful registered policy objects with the spine iterating a registry. 0061 R7 rejects that, and the code supports the rejection: the four rules of F4 are *ordering* rules between concerns (the test protocol must consume an idle before truncation continuation may steer; the hard wall must suppress the notice bands and the step-up; the freeze commit may happen only at an idle nothing else consumed). Under registry-ordered iteration those rules become implicit registration order — preserved only as long as every future author understands the hidden constraint. 0061's replacement keeps the rules as *data* (the arbitration table, with table rules a test checks) and makes the I/O discipline auditable (`TurnFx`, with runtime invariants that throw). The two rejected alternatives are rejected for stated, checkable reasons: pure reducers would force mid-decision I/O results into synthetic inputs (the idle test protocol's six-state machine — the recorded AUTO-DECISION is well argued), and the merged controls module of 0060 D5a would pull `node:readline`, stats and switches into pure selection modules (R8's type extraction is the cheaper fix for the same SCC).

The arbitration table as designed is honest about its own limits: a ninth concern states its rank explicitly ("the honest price of the invariants"), and the deliberately-wrong-concern test in D1 proves the audit fires. That is the right trade — the alternative (compiler-checked exclusivity) is what a Rust port would buy, and is one of the few genuine technical arguments for one (0063 §3).

## 3. The four objects, assessed

- **The turn spine** (one input queue, `TurnState` single-writer slices, declared arbitration): the state inventory of §4.3 maps the 37 locals onto 11 slices without forcing any cross-slice mutable sharing; `TurnView`'s read-only mapping plus test-build freezing is achievable TS. The queue discipline (§4.4) correctly preserves today's backpressure (external inputs serialized; synthetic inputs concurrent but fx-restricted) — the two `concurrent` concerns (liveness, recovery) are exactly the two `trip()` callers in today's code.
- **`nextStep` + named chain transitions**: the write-site count is verified; the transitions table (§4.8) covers the paths this review traced in `session.ts`/`attempt.ts`, and the shrink-only write ratchet is this repo's proven pattern (the direction test's own history). Stage B is the program's safest and most independently valuable stage — it alone removes the 163-site scatter.
- **`RunServices`**: F8's finding (switches mutate after parse; `SERVER` unregistered) is a real latent hazard the construction order fixes. The ambient `services()` accessor is a service locator — normally a smell — but the choice is defended (one run per process is an existing invariant; `incident-regression.test.ts` calls positional entries that must stay stable), and the shrink-only `SERVICE_ENTRIES` ratchet bounds it. Acceptable; the ratchet must not be allowed to grow, which the plan states.
- **Logical sub-domains without barrels** (R10): correct over 0060 D1's entry modules — a kernel barrel re-exporting ~129 symbols to 40 importers would bound nothing. The `SUBDOMAIN_EDGES` allowlist seeded from the measured graph and allowed only to shrink is the same ratchet mechanism one level up.

## 4. The equivalence methodology

The turn-trace oracle is the strongest piece of the program: recorded from the unchanged `watch()` in D0, *not regenerated during stage D*, with a roster asserting every arbitration cell fired in at least one scenario. Combined with the goldens (regeneration allowed only in A5/A7), the unsplit agent-fake roster, and a byte-identical incident suite, equivalence is proven at four independent layers. Two gaps in the oracle design itself are recorded in §6 (A-2, A-3): scenarios whose outcome depends on a race that exists *today* (held settle vs a queued external input; probe firing during an awaited fx call) must be enumerated and either pinned by construction or excluded — otherwise a D-stage trace mismatch has no termination criterion for debugging.

The §3.2 drift table is exhaustive in shape (every drift names its one owning unit) and the stop rule (a needed drift becomes a ruling first) is the right discipline. One presentational fix is recorded as A-4.

## 5. Staging, duration, and risk

- **Stage graph**: A→B→C→D strict; E hangs off A (+D1); F off D/C4/all. The plan's own risk table gives every row a mitigation *and* an exit ramp; the D-stall ramp (keep B/C/E/F2; only F1 depends on D) is genuine but leaves §8's headline effect (the 3.5–4× worked-example reading set) only partially realized — B+C deliver the transitions and services (roughly half the win), the spine delivers the rest.
- **Prune-first (stage A) is correct sequencing**: retiring refcheck/`check` (~1,440 loc + tests + a false AGENTS.md text) *before* the engine must reproduce it shrinks the oracle's obligation. R6's handling of the byte-for-byte contradiction (0060 promised byte-for-byte; refcheck's retirement falsifies two texts) is the honest resolution, taken as a recorded ruling.
- **Duration is the unpriced cost**: 38 units under hold lists that freeze the three busiest files (23/20/19 commits per week measured immediately before the program). At this repo's own visible cadence (T-042/T-043 each multi-unit, multi-day), stages A–F realistically span several weeks to a few months of calendar. That is a *product decision as much as an engineering one* — the operator greenlights a feature freeze on the session-driving plane for the program's duration. The plan should say so where it is approved (A-6).

## 6. Gaps and recommended amendments

Offered to 0061 §10; each is small relative to the program.

| # | gap | amendment | lands before |
|---|---|---|---|
| A-1 | R5's 30 s gate budget is defined "on the gate machine", but no machine is named; the same suite runs 168 s on the macOS dev host (§1). If executing agents develop on macOS, the unit gate as ruled cannot run per unit | Name the gate host; or make the budget relative (`test:gate` fails above baseline × 1.25, re-baselined in A1/F3) so the gate is machine-independent; the `unit` lane stays the dev-loop gate everywhere | A1 |
| A-2 | D1 installs spine, sources, fx, audit *and* cuts the ~1,070-line body into per-input handlers — the program's largest single unit | Split D1: D1a installs the spine around an uncut loop body as the single handler (traces green, queue discipline proven); D1b performs the cut into per-input handlers under `remainder` (traces green) | D1 |
| A-3 | The held-settle AUTO-DECISION (§4.4.2) resolves a race that exists today; recorded oracle scenarios that happen to capture today's racy outcome will fail D-stage traces un-debuggably | D0's done-when gains: an enumerated list of race-dependent interleavings, each scenario either pinned by construction or excluded from the oracle with the reason recorded | D0 |
| A-4 | §3.1 lists `.auto/*.json` surfaces as byte-for-byte while A7/F1 add counters and a new state file (both in §3.2) | State §3.1 as "byte-for-byte minus the §3.2 rows" uniformly, as it already does for prompts | A7 |
| A-5 | The per-policy call-coverage assertion of 0060 §6.2 is effectively replaced by concern suites over a fake `TurnFx` (agent-fake stays unsplit, F17) | Say so explicitly in §5.4, so the S5-tier promise is not read as still standing | F3 |
| A-6 | The calendar price of hold lists over the busiest files is stated nowhere | One sentence in §6.1: the program is a feature freeze on the hold-listed files for its duration, and that price is part of the approval | program start |

## 7. Verdict

**Feasible: yes.** Every mechanism the program needs already exists and is proven in this repo's history — ratchet tests, the agent-fake harness, golden files, strangler-fig unit discipline; the work is disciplined movement under green gates, which is exactly the unit model the tool itself runs. **Sound: yes**, with the verified fact base and the amendments above; the risk table is honest (mitigation and exit ramp per row), and the four gaps found here are all addressable with unit-level changes, not design changes. The largest true risk is not technical: it is schedule concentration — 38 units holding the busiest files — and it should be priced at approval, not discovered at stage C.

## 8. Relationship to other documents

Assesses [0061](./0061-driver-consolidation-plan.md) against the code; accepts the corrected reading of [0060](./0060-driver-consolidation.md) that 0061 §2.3 records. Its verification evidence (SDK confinement, Bun-API inventory, suite timing) feeds [0063](./0063-rust-reimplementation-analysis.md); its duration/hold finding feeds the sequencing discussion in [0064](./0064-positioning-alignment.md) §5.

<!-- auto: eof -->

# 0102 — Deep review and cleanup of the auto tool family

Opened 2026-10-18 at HEAD 321a22155 (branch `auto-core`, clean tree), after 100+ numbered plans of
feature work. Purpose: a whole-project review for inconsistencies, obsolete remnants, dead code, and
convoluted seams; persist the audit; fix what can be fixed safely without a maintainer ruling.

**Method.** Eight parallel read-only review passes over `packages/auto-core` + `packages/auto`
(+ `packages/auto-server` as consumer): retired remnants · complexity/duplication · templates ·
tests · durable docs · mechanical dead-code census · cross-cutting invariants · the CLI shell.
Full evidence lives in the session working papers
`/tmp/auto-review/{retired,complexity,templates,tests,docs,deadcode,invariants,shell}.md`
(session-temporary); this document is the durable record and every FIX item carries enough evidence
inline to execute. The reference-counting consumer set (which packages import
`@opencode-ai/auto-core`): auto-core src+test, packages/auto, packages/auto-server — no others.

**Severity vocabulary.** P1 mechanical/clearly correct · P2 valuable, autonomously decidable ·
P3 record-only (needs a ruling or not worth the risk). **Disposition:** `FIX(<stage>)` or `RECORD`.

**Verification protocol for every stage.** `bun typecheck` clean in the touched package(s);
the stage's targeted test files green during work; the orchestrator runs the full core suite
(twice, for order-dependence) and the shell suite between waves. No commits — all changes stay in
the working tree for review.

---

## Part 1 — Audit

### 1.1 Verified clean (negative results worth keeping)

- **No debt markers**: zero TODO/FIXME/HACK/XXX in core src/templates/test and the shell (all hits
  are the deliberate `AUTO-FIXME`/`AUTO-TODO` protocol markers and the named `temp-kb.md` artifact);
  zero commented-out code blocks; core terminal output only in `src/log.ts`.
- **Tombstones all live and pinned**: RETIRED_FLAGS/RETIRED_KEYS/RETIRED_SWITCHES, CURRENT.md
  removal, `--commit` refusal, source/destDir moves — the documented permanent surfaces.
- **Template registration complete both directions**: all 57 template files registered and every
  rendered id resolves; every template variable is supplied by its renderer; zero CJK in templates/
  (and exactly the six documented CJK comment lines in src).
- **Ratchets honest**: import-direction tables derive the real graph; chain-writes ratchet holds by
  independent grep (zero `SessionChain` writes outside `src/chain-transitions.ts`); SERVICE_ENTRIES
  equals the actual `services()` callers; PROTECTED_FILES matches `src/protect.ts`.
- **No unused dependencies** in either package; no orphan src files (all 150 imported); no
  parse-and-drop CLI flags (all 58 read or deliberately retired); no core→shell imports; exit-code
  mapping faithful on every shell subcommand.
- **plans/0035 registry** retired by its own header — new protocol vocabulary outside it is by design.
- The 0101 re-keying itself verified landed and accurate in structure.md / AGENTS.md / README /
  MANUAL (the gaps found are pre-0101 leftovers, listed below).

### 1.2 Findings and dispositions

#### Retired remnants (`retired.md`)

| id | sev | essence | disposition |
|---|---|---|---|
| retired-1 | P2 | Dead phased-establishment branch in plan.ts `establish()` (plan.ts:946-967 + `sourceSuffix`): both establishment rows are m-mode-only since 0101 D4 and `resolveRoundPhases` short-circuits "m" — the phased rendering is unreachable; its comment describes transfer.ts's `establishStop` | FIX(A) |
| retired-2 | P2 | Comments present `--commit false` / the retired non-git tier as live off-paths (git.ts:27-28, switches.ts:338-339); live off-paths are dryrun + the no-commit double | FIX(A) |
| retired-3 | P3 | `src/roles/` (session-role registry, live: tier.ts, execute.ts, tests) has no AGENTS.md navigation line / structure.md row | FIX(G) (docs) |
| retired-4 | P2 | `CHOICE_LINE`/`EXECUTED_LINE` (blockage.ts:333-334): zero references monorepo-wide; parsers/writers spell the literals inline | FIX(A) |
| retired-5 | P2 | `PHASE_ORDER` (phases.ts:58-59): dead export, its comment wrong about its consumers (they read PHASE_LETTERS) | FIX(A) |
| retired-6 | P3 | `releasedRoadmapRound` (analysis.ts:143) exported, only internal callers | FIX(A) |

#### Complexity / duplication (`complexity.md`)

| id | sev | essence | disposition |
|---|---|---|---|
| complexity-1 | P1 | git.ts (1743 lines, ~14 concerns): extract lane-worktree family (730-1018) → `src/git-worktree.ts` and isolation/landing family (1020-1214) → `src/git-land.ts` (~485 lines out); guarded by git/lanes/isolate/land tests | FIX(E) |
| complexity-2 | P1 | Merge-conflict regex + abort→LandResult tail copy-pasted 4× in git.ts (961/1009/1195/1207) | FIX(D) |
| complexity-3 | P1 | Repair-round block (incl. byte-identical input text) duplicated: runSerialUnit vs doc-lane finishBlocked (loop-task.ts:419-441 vs 1130-1155) + 2 variants in loop-phase.ts (269-286, 309-325) → one `repairRoundAppend` | FIX(E) |
| complexity-4 | P1 | Stranded-parks/"all tasks complete" block verbatim 4× in loop-task.ts (208/580/881/1296) → `exhausted(plan)` | FIX(D) |
| complexity-5 | P2 | 0101 residual copy-paste: establish vs establishStop (byte-identical dirty-repo + established lines), analysis rows 0a-0d vs projectStart, 3× round-close refusals, drift-apply sequence — sharing stopped at the mechanical helpers, every rendering maintained twice (~120 lines) | FIX(E) |
| complexity-6 | P1 | plan.ts open-step refusal trio (785-816) and drift-refusal trio (755-781): six functions where two parameterized ones suffice | FIX(D) |
| complexity-7 | P2 | Dirty-tree refusal pair 16× across 7 files with wording drift already present ("commit/clean" vs "commit or clean") | FIX(E) |
| complexity-8 | P1 | Idle-progress watchdog and newest-green-receipt scan duplicated script.ts↔regression.ts (100-133 vs 225-251; 287-304 vs 72-81) | FIX(D) |
| complexity-9 | P2 | router.routeContext is a byte-identical twin of routing.selectContext (comment admits it); move to select.ts | FIX(D) |
| complexity-10 | P2 | mode.ts / intent/load.ts duplicate the overlay-directory loader skeleton (46-60 vs 57-71) | FIX(D) |
| complexity-11 | P1/P2 | stats.ts: classify/synthesis booking twins byte-identical (1290-1314); schema+parse half (~450 lines) splits to `src/stats-schema.ts` (models-schema precedent) | FIX(D) |
| complexity-12 | P2 | loop-task outcome-arm tails triplicated across serial/doc/lane loops | RECORD (0069 D5 protects the loop shapes; tails extraction is allowed but lowest value/risk ratio) |
| complexity-13 | P2 | runner.ts runTask 728 lines with the documented "closeout phase" embedded (~last 300 lines separable) | FIX(E) |
| complexity-14 | P2 | handoverPhase 309 lines, two inline repair blocks (→ complexity-3) + near-identical openBlockage pair | RECORD (repair blocks absorbed by complexity-3; the gate pair left alone) |
| complexity-15 | P3 | agent-pool↔classify one-shot pumps: abstraction cost ≈ duplication | RECORD |
| complexity-16 | P3 | git.ts firstLine-error formatting ~15× | RECORD (opportunistic only) |
| complexity-17 | P2 | prompt-audit append+commit block 5× across 4 files (loop-plan 104-120/177-188/719-730, loop-phase 127-134, blockage-diagnose ~254) | FIX(E) |
| complexity-18 | P3 | preflight 430 lines is a documented composition root; only the 44-line flag-backstop prologue is hoistable | RECORD |

#### Templates (`templates.md`)

| id | sev | essence | disposition |
|---|---|---|---|
| templates-1 | P3 | Registration complete both directions (positive result) | — (recorded in 1.1) |
| templates-2 | P3 | templates/README.md stale: `--new-session-subtask`, `init --commit true`, pre-0083 FAIL handling, "plan establishes rounds" | FIX(F) |
| templates-3 | P2 | faithful / faithful-lean packs lack `### process-references`: the mechanical P1 scan blocks their sessions on a rule they are never told (default + cleanroom carry it; off the 0080 §6 axis — drift) | FIX(F) |
| templates-4 | P3 | "the intent charter above" dangles in phase-append.md:50-54 (no charter rendered) and prompt-plan.ts:276 (charter is below) | FIX(F) |
| templates-5 | P3 | Decompose numbering gap under bundles (pack sections unnumbered; prompt reads 1,2,…,5,6) | FIX(F) (same bundle-byte wave as templates-3) |
| templates-6 | P3 | Unreachable-by-construction templates/sections (decompose.md fallback, decompose-k family) — registry symmetry, harmless | RECORD |
| templates-7 | P3 | Agent contract role list omits whole-task ("decompose / single subtask / wrap-up") | FIX(F) |
| templates-8 | P3 | _partials.md header prose cites the retired phase-plan template | FIX(F) |
| templates-9 | P3 | Shipped opencode.json: `"bash": {"*": "allow"}` contradicts README's escalation claim + pins a concrete local model | RESOLVED 2026-10-18 by ruling: Option A — the wildcard kept as full-trust-by-design (posture documented in templates/README.md and the shell README; the false escalation claim had already been removed by stage F's rewrite) and the model pin deleted (the only one on the template surface); affects new inits only |
| templates-10 | P3 | Designed-floor asymmetries across packs — deliberate minimalism | RECORD |
| templates-11 | P3 | Partial-extraction candidates (precedence ×5, handover-content ×4) | RECORD (golden churn outweighs) |

#### Tests (`tests.md`)

| id | sev | essence | disposition |
|---|---|---|---|
| tests-1 | P1 | 16 local `git()` clones across 15 test files (canonical fixtures/runner.ts:261) | FIX(C) |
| tests-2 | P1 | 7 copies of `withDir` wrapper | FIX(C) |
| tests-3 | P1 | 5 copies of the capture/scrub/switch-reset run wrapper — the exact ritual whose per-file copy-paste caused the switch-snapshot poisoning incident | FIX(C) |
| tests-4 | P2 | repo-bootstrap duplicated ~8× with drifting gitignore bytes | RECORD (follow-up; some bytes pinned) |
| tests-5 | P1 | REMAINING instance of the poisoning class: loop-preflight.test.ts:460-502 freezes the switch snapshot, never re-parses | FIX(C) |
| tests-6 | P2 | `OPENCODE_AUTO_ANALYSIS=off` leaked process-wide by isolate.test.ts and plan.test.ts (no afterAll) | FIX(C) |
| tests-7 | P2 | routing.test.ts console spy never restored after describe | FIX(C) |
| tests-8 | P3 | No un-register for template/bundle test registrations | RECORD |
| tests-9 | P2 | Timing inventory; top flake candidates: agent-server.test.ts:364 (60ms negative window, 2× margin), stats.test.ts:407 (flat 20ms drain wait), watch.test.ts:95 | FIX(C) (top three) |
| tests-10 | P3 | Zero skips/todos in core; shell's 8 = live-agent gate | — (cleared) |
| tests-11 | P3 | Coverage: only real gap is src/format.ts (zero direct assertions; log.ts's namesake is tested — false confidence) | FIX(C) (small unit file) |
| tests-12 | P3 | Import-direction table honest by construction | — (cleared) |
| tests-13 | P3 | Runtime hotspots are the suite's deliberate determinism strategy | RECORD |
| tests-14 | P3 | Shell suite structure coherent | — (cleared) |

#### Durable docs (`docs.md`)

| id | sev | essence | disposition |
|---|---|---|---|
| docs-1 | P1 | structure.md:48 names retired renderers (`renderPhasePlan`/`renderImplementPlan`) | FIX(G) |
| docs-2 | P1 | structure.md missing rows for 7 live modules (roles/registry, land, work-order, run-status(+schema), format, engine/events) + install-prompts in suite row | FIX(G) |
| docs-3 | P1 | AGENTS.md "auto is the integration branch" — it is frozen (2026-09-22) | FIX(G) |
| docs-4 | P1 | AGENTS.md missing navigation line for src/roles/ | FIX(G) |
| docs-5 | P1 | AGENTS.md missing navigation lines for land, work-order, run-status/events, format | FIX(G) |
| docs-6 | P2 | AGENTS.md constitutional list omits --scan-exempt/--isolate/--tree-lanes | FIX(G) |
| docs-7 | P3 | AGENTS.md manual-suite enumeration omits charter.md | FIX(G) |
| docs-8 | P1 | glossary "`--subtask auto`, the default" — flipped to off 2026-10-04 | FIX(G) |
| docs-9 | P1 | glossary "phase planning" row names retired templates | FIX(G) |
| docs-10 | P2 | glossary "stop condition" knows only "execute" | FIX(G) |
| docs-11 | P2 | glossary "plan prelude" says plan establishes rounds | FIX(G) |
| docs-12 | P2 | glossary "lifecycle command" names only plan and close | FIX(G) |
| docs-13 | P2 | glossary "round establishment" pre-transfer | FIX(G) |
| docs-14 | P2 | glossary "ledger" rows miss the 0097 obligation ledger | FIX(G) |
| docs-15 | P2 | glossary "hidden task" examples include phase planning | FIX(G) |
| docs-16 | P2 | glossary "run lock" row stale (holders/refusers) | FIX(G) |
| docs-17 | P3 | glossary missing current-vocabulary rows (transfer, boundary stop, formulation, obligation ledger, doc lanes, regression receipt, provenance) | FIX(G) |
| docs-18 | P3 | glossary protocol literals missing `Formulate:` | FIX(G) |
| docs-19 | P1 | shell-contract subcommand list missing transfer/sync/land/install-prompts | FIX(G) |
| docs-20 | P3 | shell-contract §C dated absorb-notes name retired surfaces — historical by form | RECORD (optionally one clarifying line) |
| docs-21 | P1 | shell AGENTS.md subcommand list missing sync/land/install-prompts | FIX(H) |
| docs-22 | P1 | shell usage text omits --intent (init/amend), --repair (run), --export/--adopt (plan) | FIX(H) |
| docs-23 | P2 | README usage block missing close and install-prompts | FIX(H) |
| docs-24 | P2 | README missing --export/--adopt | FIX(H) |
| docs-25 | P3 | README run-lock paragraph omits land (holder) and sync (refuser) | FIX(H) |
| docs-26 | P3 | usage exit-code line doesn't name boundary/review stops under 0 | FIX(H) |

#### Dead code census (`deadcode.md`)

| id | sev | essence | disposition |
|---|---|---|---|
| deadcode-1 | P1 | 4 exports with zero references anywhere: `CHOICE_LINE`, `EXECUTED_LINE` (blockage.ts:333-334), `PHASE_ORDER` (phases.ts:59), `taskDirs` (tasks.ts:877) | FIX(A) |
| deadcode-2 | P2 | 6 production-dead functions kept alive by tests only; two carry doc comments claiming nonexistent callers: `trackedSourceChanges` (git.ts:1577), `templateRenders` (template.ts:406), `subtaskOutputFile` (docpaths.ts:104), `recordDecisions` (resolve.ts:282), `registeredIntentBundles` (bundle.ts:308), `implicitFacts` (router.ts:927) | FIX(A) (delete the four with no unique test-seam value; keep recordDecisions/registeredIntentBundles as commented test seams) |
| deadcode-3 | P3 | Deliberate test hooks, production-dead: addStatusSink, stopRunStatus, decodeRunValue, resetShellAdapters, RunStatusEventType | RECORD — addStatusSink RESOLVED 2026-10-18 by ruling (removed; see Part 2 item 9), the other four stay |
| deadcode-4 | P3 | `RunAllOpts.managed` read by core, set by no CLI front anywhere | RECORD — census corrected in stage A: 10 core-test sites inject fake AgentHosts through it (a deliberate test seam, deadcode-3 class), not dead |
| deadcode-5 | P3 | 215 over-exported-but-alive symbols (export keyword unused) | RECORD — RESOLVED 2026-10-18 by ruling (stage J below) |
| deadcode-6 | P3 | ~160 test-only-but-alive exports — legitimate test surface | RECORD |
| deadcode-7 | P3 | test:unit/repo/gate lane scripts invisible to CI (CI runs plain `bun turbo test`) | RECORD — RESOLVED 2026-10-18 by ruling (stage J below) |
| deadcode-8 | P3 | Literal NUL bytes in src/resolve.ts make ripgrep silently skip the file | FIX(A) (escape to `\u0000` source form) |
| deadcode-9 | P3 | Negative results (files/deps/templates/flags all used) | — (cleared) |

#### Cross-cutting invariants (`invariants.md`)

| id | sev | essence | disposition |
|---|---|---|---|
| invariants-1 | P2 | **User-facing bug**: logGateStop's awaiting (survey-gate) branch still tells the person to pass the next phase's planning input with `plan --file <path>` — the exact invocation plan's Row 6 refuses post-0101; every reach of this line is wrong-command advice (loop-phase.ts:391; reachability: human gates are phased-only) | FIX(B) |
| invariants-2 | P3 | close.ts:300 closing pointer names `plan` un-mode-branched (phased closes should name transfer) | FIX(B) |
| invariants-3 | P3 | routePhase's missing-index message names `plan` un-mode-branched; status.ts:53-59 already demonstrates the branched form | FIX(B) |
| invariants-4 | P3 | fix/sync "findings need a person" → exit 1 (grep-style), semantically exit-2 territory — deliberate, self-documented | RECORD |
| invariants-5 | P3 | ⏸ glyph marks both exit-1 and exit-2 stops | RECORD (optionally one glossary line — folded into G's glossary pass) |
| invariants-6 | P3 | "phase flow blocked:" literal hand-rolled at 10 sites / 5 modules | FIX(E) (shared helper, byte-identical) |
| invariants-7 | P3 | analysis-flow walkthrough duplicated plan.ts↔transfer.ts (deliberate D8 byte-pin, mirror-edit hazard) | RECORD (absorbed into complexity-5's scope where cheap) |
| invariants-8 | P3 | Shell's 146 inline console.error+exit(1) sites lack a die() funnel | RECORD |
| invariants-9 | P3 | Glossary gaps for 0101 vocabulary (boundary, transfer/advance, plan task vs formulation task) | FIX(G) (with docs-17) |

#### CLI shell (`shell.md`)

| id | sev | essence | disposition |
|---|---|---|---|
| shell-1 | P1 | --export/--adopt live but absent from README and usage text | FIX(H) |
| shell-2 | P1 | install-prompts absent from README and MANUAL | FIX(H) |
| shell-3 | P1 | close missing from README usage block | FIX(H) |
| shell-4 | P1 | Question-policy paragraphs (README ×3, MANUAL) describe the superseded attended-wait policy; the 0081 D16 record-and-list contract and the needs-attention section undocumented | FIX(H) |
| shell-5 | P1 | README "Phase loop (run)" describes the pre-0101 continuous crossing as default; its planning sub-bullet is pre-0095 | FIX(H) |
| shell-6 | P1 | README pins retired `Auto-Stage: phase-plan` | FIX(H) |
| shell-7 | P1 | Two stale "plan establishes the rounds" spots (README:259, :1643) | FIX(H) |
| shell-8 | P1 | README run-lock paragraph omits sync | FIX(H) |
| shell-9 | P1 | Shell AGENTS.md drift (subcommand list, lock list) | FIX(H) |
| shell-10 | P1 | README: `--boundary` "ignored" on plan/transfer (actually refused exit 1); plan's refused list omits --repair/--boundary | FIX(H) |
| shell-11 | P2 | Silent flag drops: run/transfer swallow --reason/--cascade/--commit-changes/--stash-changes/--merge/--unit (VALUE flags eat the next token); init has no whitelist (init --dryrun writes everything) | FIX(I) |
| shell-12 | P2 | 3 of the 8 live-agent e2e skips rotted by 0101's boundary-stop default (e2e:116/162/214 expect the continuous crossing) | FIX(I) |
| shell-13 | P2 | Usage-text amend/--phases paragraphs predate 0101 D6 (miss the mid-phase amendPhasesHold refusal) | FIX(H) |
| shell-14 | P2 | m-mode round-complete line prints "close it with: transfer" while transfer refuses m mode (core-owned: loop-phase.ts:617) | FIX(B) |
| shell-15 | P3 | God-file index.ts (2464 lines) + duplicated parse blocks — table-driven refactor needs a ruling (pinned strings) | RECORD — RESOLVED 2026-10-18 by ruling (stage J below) |

### 1.3 Counts

108 findings: retired 6 · complexity 18 · templates 11 · tests 14 · docs 26 · deadcode 9 ·
invariants 9 · shell 15. Dispositions: ~75 FIX across stages A–I; ~33 RECORD.

---

## Part 2 — Matters left to a maintainer ruling (RECORD; do not fix autonomously)

1. **templates-9** — shipped `templates/opencode.json` allows all bash (`"*": "allow"`) while its
   README claims escalation, and pins `model: local-vllm/qwen3-coder-next`. Security posture +
   whether a default model belongs in the shipped copy are owner calls.
   — **RESOLVED 2026-10-18**: Option A ruled (wildcard kept, full-trust-by-design documented in
   both READMEs) + the model pin deleted; no other template pins a model.
2. **invariants-4** — fix/sync/models "findings present" exit 1 vs the constitution's exit-2
   wording: deliberate grep-style convention; changing it breaks scripts.
3. **deadcode-5** — a sweep dropping the `export` keyword on 215 file-local symbols (mechanically
   safe, large diff, zero behavior change).
   — **RESOLVED 2026-10-18**: stage J — 217 symbols de-exported across 84 src files (a live
   TypeScript-AST census over the whole consumer set; every remaining export cross-file
   referenced).
4. **deadcode-7** — wiring `test:gate` into CI (or naming it in CONTRIBUTING).
   — **RESOLVED 2026-10-18**: stage J — named in the root CONTRIBUTING.md, not CI (the gate's
   wall budget is dev-machine-measured; shared-runner CI would flake).
5. **complexity-12 / 14-gate-pair / 15 / 16 / 18** — remaining triplicated outcome tails, the
   handover charter-gate pair, the session pumps, git.ts error formatting, preflight stage
   functions: value/risk below the autonomous bar.
6. **shell-15** — table-driven refactor of packages/auto/src/index.ts (many pinned strings).
   — **RESOLVED 2026-10-18**: stage J — landed; byte-identity pinned by a 103-case refusal/usage
   corpus and the shell suite with zero pin edits.
7. **tests-4 / 8 / 13** — repo-bootstrap dedup (pinned gitignore bytes), test-registration
   un-register hooks, runtime optimizations.
8. **templates-6 / 10 / 11** — unreachable-by-construction template surfaces (registry symmetry),
   designed pack floors, partial-extraction candidates.
9. **deadcode-3** — deliberate test hooks kept (addStatusSink is a designed transport seam with no
   live subscriber — worth a future wiring or removal decision).
   — **RESOLVED 2026-10-18** (addStatusSink): stage J — removed, not wired: the daemon's SSE tail
   consumes the journal file cross-process, which an in-process sink can never serve. The other
   four hooks stay RECORD.

---

## Part 3 — Remediation stages

All stages: behavior-preserving unless the finding names a wording/behavior fix; byte-identical
outputs wherever tests pin them (update pins in the same change); English comments; docs rows and
import-direction tables updated in the same change when structure moves.

**Stage A — core dead code and stale comments** (src/ only + the one AGENTS.md mention)
A1 delete `CHOICE_LINE`/`EXECUTED_LINE` (blockage.ts:333-334), `PHASE_ORDER` (phases.ts:58-59),
`taskDirs` (tasks.ts:877). A2 retired-1: delete plan.ts's dead phased-establish branch
(`sourceSuffix` + non-m tail of `establish()`), fix the doc comment (m-mode-only since 0101 D4;
phased rendering lives in transfer.ts `establishStop`). A3 retired-2 comment rewords (git.ts:27-28,
switches.ts:338-339). A4 unexport `releasedRoadmapRound`. A5 deadcode-2: verify-then-delete
`trackedSourceChanges` (git.ts:1577; also drop it from the AGENTS.md test-handover navigation
line), `templateRenders` (template.ts:406), `subtaskOutputFile` (docpaths.ts:104), `implicitFacts`
(router.ts:927) + their direct unit tests; keep `recordDecisions`/`registeredIntentBundles` with a
one-line "(test seam)" comment. A6 deadcode-4: remove `RunAllOpts.managed` + the two conditional
sites (loop-preflight.ts:139/:356, loop.ts:399) — **corrected during implementation**: it is a live
test seam (10 core-test sites inject fake AgentHosts into the full preflight/loop path), so it was
KEPT and the finding reclassified RECORD. A7 deadcode-8: replace the raw NUL bytes in
resolve.ts's key() separators with `\u0000` escapes; confirm `rg` sees the file.
Guard: typecheck + plan/transfer/git/template/docpaths/resolve/router/bundle test files.

**Stage B — person-facing command-wording correctness** (core; update pinning tests)
B1 invariants-1: logGateStop awaiting branch — replace the `plan --file` parenthetical with the
0101 input-home vocabulary (write the next phase's `plan-input.md`; the next transfer construct
reads it); human gates are phased-only so no mode branch. B2 invariants-2: close.ts:300 — task
closes keep today's wording; phase/round closes in a phased project name `transfer`. B3
invariants-3: routePhase missing-index reason mode-branched like status.ts:53-59 (thread the
phases value through deps). B4 shell-14: loop-phase.ts:617 m-mode round-complete pointer branches
to plan's `roundCompleteNext`. Add m-mode/unbranched pins where the finding notes them missing.
Guard: survey-gate, boundary, close, phases/status, plan, transfer tests + typecheck.

**Stage C — test-suite hygiene** (test/ only)
C1 tests-5: append the two documented switch-reset lines to loop-preflight.test.ts:460-502. C2
tests-6: afterAll env cleanup in isolate.test.ts + plan.test.ts. C3 tests-7: routing.test.ts
afterAll mockRestore. C4 tests-3: one `captureRun` helper in fixtures carrying the reset
unconditionally; rewire the five copies (keep fixtures/loop.ts's variant reset-free unless
harmless). C5 tests-1: replace the 16 local `git()` clones with the fixtures/runner.ts import
(check the GIT_OPTIONAL_LOCKS variance first). C6 tests-2: shared `withDir` in fixtures; rewrite
the seven copies. C7 tests-9: determinism fixes for agent-server.test.ts:364 (widen margins),
stats.test.ts:407 (poll-until with cap), watch.test.ts:95 (settle before asserting no-growth). C8
tests-11: small unit file for src/format.ts. Guard: the touched files + a full double run.

**Stage D — core dedup refactors, batch 1** (byte-identical outputs)
D1 complexity-2 (git.ts conflict classifier + abort tail helpers). D2 complexity-4 (`exhausted`).
D3 complexity-6 (plan.ts refusal trios parameterized). D4 complexity-8 (script.ts exports
`watchProcess` + `newestGreenReceipt`; regression.ts drops its copies). D5 complexity-9 (move the
context builder to select.ts; both callers delegate). D6 complexity-10 (shared overlay loader).
D7 complexity-11 (merge the booking twins; split `src/stats-schema.ts` — pure move). New files →
import-direction table + docs rows in the same change. Guard: full core suite + typecheck.

**Stage E — core dedup refactors, batch 2** (still behavior-preserving; heavier)
E1 complexity-3 (`repairRoundAppend` absorbing the four sites incl. loop-phase's two). E2
complexity-5 (establishStopLines / analysisGate / roundCloseRefusalLines / applyTailDrift shared
between plan.ts and transfer.ts; outputs byte-identical, command token interpolated). E3
complexity-13 (extract runCloseout from runTask within runner.ts). E4 complexity-1 (git.ts split:
`src/git-worktree.ts`, `src/git-land.ts`; update ~6 call sites, import-direction tables,
structure.md + AGENTS.md pointers). E5 complexity-7 (dirty-tree refusal helper; unify or
parameterize the drifted wording after grepping pins). E6 complexity-17 (`appendAudit` helper). E7
invariants-6 (`phaseFlowBlockedLine` shared helper). Stop earlier if risk compounds; record the
remainder. Guard: full core suite + typecheck after each item.

**Stage F — templates**
F1 templates-3: add `### process-references` to faithful.md and faithful-lean.md (verbatim from
cleanroom.md). F2 templates-5: continue the decompose numbering (3./4.) in the three bundle packs.
F3 templates-2: rewrite templates/README.md against today's surface. F4 templates-4: fix the
dangling charter locative (phase-append.md + prompt-plan.ts). F5 templates-7: agent-contract role
enumeration. F6 templates-8: _partials.md header prose. Bundle-byte changes ride one wave (one
provenance-staleness event for materialized projects — the designed `sync` path). Guard:
prompt-exec/prompt-phase/prompt-template + bundle/provenance/sync/guarantees suites + typecheck.

**Stage G — core durable-docs truth pass** (docs/ + AGENTS.md + glossary)
Apply docs-1..5 (structure.md renderer row, missing rows incl. roles/land/work-order/run-status/
format/engine-events + install-prompts), docs-3/4/5/6/7 (AGENTS.md: frozen-branch fix, navigation
lines, constitutional list, charter.md), docs-8..18 + invariants-9 + invariants-5-note (glossary
re-key + new rows), docs-19 (shell-contract subcommand list), docs-20 clarifying line. Drafted
text in `/tmp/auto-review/docs.md`. Runs after code stages so rows reflect final structure.

**Stage H — shell docs + usage text** (packages/auto docs + usage block; no behavior)
Apply shell-1..10, shell-13, docs-21..26 using the drafted text in `/tmp/auto-review/shell.md`
and `docs.md`. Runs after stage I (README:258's --server sentence depends on I's refusal landing).

**Stage I — shell behavior**
I1 shell-11: init gains an amend-shaped option whitelist (refuse session/close/lane flags with
pointer messages — `init --dryrun` must stop writing); run/transfer refuse
--reason/--cascade/--commit-changes/--stash-changes (pointer to close / plan --force-close) and
--merge/--unit (pointer to the hidden `_lane` entry) — first verify no machinery invokes `run`
with those flags (grep packages/auto + auto-server + docs). I2 shell-12: pass `boundary: "flow"`
in the three rotted live-agent e2e runAll calls (e2e:116/162/214). Add e2e refusal cases for I1.
Guard: shell suite + typecheck.

---

## Part 4 — Implementation log

| stage | scope | status | notes |
|---|---|---|---|
| A | core dead code + comments | done | 9 dead symbols removed (~130 lines incl. orphaned helpers + their unit tests); managed KEPT (census corrected: live test seam); NUL bytes escaped; AGENTS.md test-handover line updated |
| B | person-facing wording | done | survey-gate stop no longer advises the refused `plan --file` (input-home vocabulary); close/routePhase/m-mode round-complete pointers mode- and state-branched (routePhase deps gained `phases`, six call sites); new m-mode and branch pins added; shell suite held 124/0 |
| C | test-suite hygiene | done | captureRun fixture (5 copies → 1 home, reset unconditional); 16 git() clones → canonical; withDir factory (7 copies); remaining poisoning instance fixed + env/console leaks cleaned — unmasked and fixed a real order-dependence (work-order.test.ts inheriting the leaked analysis-off plant); 3 timing windows hardened; test/format.test.ts added (9 tests); full suite 2665/0 |
| D | dedup batch 1 | done | all 7 items: git conflict/abort helpers, exhausted(), plan refusal trios parameterized, script.ts watchProcess/newestGreenReceipt shared with regression, selectContextOf in select.ts, src/overlay.ts loader, stats twins merged + src/stats-schema.ts split (~560 lines moved); full suite 2666/0 with zero pin edits; import-direction tables + structure.md/AGENTS.md rows updated |
| E | dedup batch 2 | done | split E-α (plan/transfer/git) + E-β (loop/runner): establishStopLines/analysisGate/roundCloseRefusalLines/applyTailDrift shared plan↔transfer (~100 twin lines); git.ts 1705→1266 via src/git-worktree.ts (296) + src/git-land.ts (214); dirtyStopLines in log.ts (15 sites, wording unified to "commit/clean" — zero pins on the variant); phaseFlowBlockedLine in phases.ts (15 sites); repairRoundAppend (4 sites); runCloseout extracted from runTask (~110 lines); appendAudit in prompt-verify.ts (5 sites). Full suite 2666/0 with zero pin edits |
| F | templates | done | process-references added to faithful family; bundle decompose numbering continued; README rewritten; charter locatives fixed; agent-contract roles updated; templateRenders deleted; 2 goldens + 1 pin updated; bundle-byte ripple = one designed provenance-staleness event (sync fast-forwards) |
| G | core docs truth pass | done | structure.md renderer row fixed + 7 missing rows (roles/land/work-orders/run-events/run-status/format + install-prompts); AGENTS.md frozen-branch fix + 5 navigation lines + constitutional list + charter.md; glossary re-keyed (9 rows) + 7 new rows + 3 confusable pairs + Formulate: + ⏸ note; shell-contract subcommand list + §C clarifier + 2 extra fixes (lock list, suite enumeration) |
| H | shell docs + usage | done | usage text gains --intent/--repair/--export/--adopt + D6 amend sentences + exit-0 boundary clause; README: export/adopt section, install-prompts section + usage rows, close row, question-policy rewritten to 0081 D16 (needs-attention), phase-loop boundary default, stage ladder, transfer re-keys, run-lock sync/land, --boundary refusal wording; MANUAL install-prompts row; AGENTS lists; 7 extra drift fixes; zero usage-line pins broke |
| I | shell behavior | done | init option whitelist (16 pointer refusals + generic fallback; init --dryrun no longer writes); run/transfer refuse close-family + lane value flags (verified _lane is the only --unit/--merge user); 3 rotted live-agent skips re-keyed to boundary:"flow"; new e2e case; shell suite 125 pass / 8 skips / 0 fail |
| J | the maintainer's four ruled RECORD items | done | deadcode-5 de-export sweep (217 symbols / 84 files, census-verified 1298/1298 remaining exports referenced); deadcode-7 test:gate named in CONTRIBUTING; deadcode-3's addStatusSink removed with tests re-keyed to the journal; shell-15 table-driven refactor of index.ts (byte-identical by corpus + suite). Core 2666/0 twice, shell 125/8/0, both typechecks clean |

Close-out verification (2026-10-18): core `bun typecheck` clean, full suite **2666 pass / 0 fail,
run twice** (order-stable); shell `bun typecheck` clean, suite **125 pass / 8 live-agent skips /
0 fail**. Working tree: 85 files modified + 8 added (this document, 4 new src modules, 3 test
fixtures/files, ...), net **−771 lines**. All changes left uncommitted for review. Baseline was
core 2664 pass / shell 124 pass; the +2 are new coverage (format unit tests, refusal/gate pins).

Addendum 2026-10-18 (post-commit ruling): templates-9 resolved per the maintainer's decision —
Option A (the `bash: {"*": "allow"}` wildcard kept as the documented full-trust-by-design
posture; both READMEs now say so and name the real containment layers) and every model pin
deleted from the template surface (`templates/opencode.json` carried the only one). New inits
only; existing targets keep their person-owned copy (`fix` never overwrites an existing file).

Addendum 2026-10-18 (stage J — the maintainer's four further rulings, all behavior-preserving,
left uncommitted for review like the stages before):

- **deadcode-5, the de-export sweep**: 217 file-local symbols across 84 src files lost their
  `export` — 208 keyword removals plus 9 named-list removals (models-schema's TIERS re-export,
  wrapup's ReportResult, routing's candidateKey/Candidate re-export pair with the now-unused
  import members dropped, config's TREE_LANES_SETTINGS/LanesConfig/LaneCacheRule/TreeLanesSetting
  re-exports, regression's GreenReceipt re-export). Re-counted live rather than trusted: a
  TypeScript-AST census over the full consumer set (auto-core src+test+script, packages/auto,
  packages/auto-server) parses every import form — static, type-only, aliased, namespace/star,
  re-exports, `import("...").Qualifier` type nodes, dynamic import calls — so 1515 exported
  bindings became 1298 with every survivor cross-file referenced; the census re-run after the
  sweep reports 0 de-exportable remaining. Zero behavior; core typecheck clean, full suite
  2666/0 twice.
- **deadcode-7, test:gate**: named in the root `CONTRIBUTING.md` (a "Testing the auto family"
  section under Developing OpenCode: the three lane commands, the gate's budget semantics, the
  ambient-OPENCODE_AUTO_* rule, and why the gate stays contributor-side) — not wired into CI:
  the gate's wall-time budget is the recorded dev-machine baseline × 1.25, which shared-runner
  CI would flake on; CI keeps plain `bun turbo test`, which runs the same suite without the
  budget.
- **deadcode-3's addStatusSink: removed, not wired.** The one designed consumer of the status
  stream — the daemon's SSE tail — reads `.auto/run-status.jsonl` cross-process (auto-server
  observe.ts), which an in-process sink can never serve, and no same-process subscriber exists;
  wiring would have meant inventing a consumer. StatusSink/addStatusSink/the sink feed loop and
  the seq counter it alone read are gone, the module header re-keys to the single output with a
  line recording the ruling, and the two observing suites (run-status, lanes-scheduler) read the
  journal instead — the identical stream, which the old tests already asserted
  journal≡subscriber. The other four recorded test hooks (stopRunStatus, decodeRunValue,
  resetShellAdapters, RunStatusEventType) stay.
- **shell-15, the table-driven refactor of packages/auto/src/index.ts** (2574 → 2536 lines; the
  remaining bulk is init/amend's single-copy logic and the pinned usage text, not duplication):
  the nine owned-flag refusal blocks → one OWNED_FLAGS table in refusal order; the close/land
  whitelist-ladder twins inside the flags scan → one strictOptionRefusal factory with the two
  policies and an optionRefusal dispatch; the run/transfer mirrored refusal groups → shared
  refusePlanInputFlags/refuseCloseFamilyFlags/refuseLaneValueFlags plus one RUN_OPTION_REFUSALS
  table (plan/transfer differences carried in the `what` texts); the four "nothing to X"
  missing-config checks → requireConfigFile (amend's missing "first" parameterized); the three
  lock-acquisition tails → takeRunLock; close/land's print-and-exit tails → exitWithResult; the
  parsePlanInput/parseBriefSeed twins → one parseTextOrFile with a message-word spec (the one
  byte divergence between the twins — brief's names-the-file line lacking ", written verbatim" —
  kept via a separate spec field). Verified three ways: shell typecheck clean; the full shell
  suite 125 pass / 8 live-agent skips / 0 fail with zero pin edits; and a 103-case before/after
  corpus over the whole refusal/usage surface (exit code + stdout + stderr byte-identical, the
  temp-dir paths each run embeds normalized).
- Stage-verification note: auto-server's typecheck fails on `renderProjectBrief` — verified
  pre-existing at HEAD by a stash round-trip (the frozen shell snapshot drifts behind core; not
  this stage's regression, and the branch model refreshes it by merge, not here).

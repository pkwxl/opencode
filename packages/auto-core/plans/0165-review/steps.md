# Step briefs — read only your own `## Sxx` section

Read it with: `sed -n '/^## S11 /,/^## S[0-9]/p' plans/0165-review/steps.md`. Scope paths are relative to
`packages/`; line counts are at the baseline. "Leads" are salvaged reproduction drafts in `leads/` (see
`leads/README.md`): unverified, to run and confirm or refute. "Residuals" are deferred items named by the
2026-10-30 review's fix waves (plans 0155–0160) — state each at HEAD.

## S04 Loop composition A — the composition root and phases
Scope (3.6K): auto-core/src/{loop.ts 514, loop-phase.ts 786, loop-preflight.ts 1009, loop-progress.ts 112, phases.ts 658, phases/registry.ts 299, phases/custom.ts 230}. Tests (grep): loop-preflight, loop-conclusion, loop-progress, phases*, round-gates, survey-gate, boundary, stop-after, fixtures/loop.ts. Rulings: 0006, 0047, 0098, 0101, 0114, 0132 D1, 0137, 0149, 0156.
1. Every exit path of runAll (preflight's `{exit}` returns before the try): services uninstalled, run lock released, progress/watcher closed, `setClampCaller` reset? Enumerate them.
2. Crash between the phase-transition commit and the next phase's first write; between the regression hold and its receipt — preflight re-derives?
3. The phase-boundary stop and `--boundary flow`: the person's bracket never skipped (P2)? Phase registry/custom grammar strict (unknown fields, `Wall:` malformed)?
4. 0149's run-start exemption × 0145's adoption × 0155's strict clean gates — which wins on a resumed dirty tree with foreign commits?
Residuals: 0155 loop-side/`release` clean gates staying quiet-clean; 0156 D1 keep-marks persisting across runs. Seams: S05 (loop-task entry), S12 (resume-gate).

## S05 Loop composition B — the task loop and lanes
Scope (2.9K): auto-core/src/{loop-task.ts 1713, lanes.ts 1203}. Tests (grep): lanes*, lane-table, parallel, doc-lanes, park, repair-loop, loop-isolation, isolate. Rulings: 0068, 0079 §4, 0096, 0099, 0125, 0126, 0128, 0143, 0156.
1. Hook matrix {serial, branch isolation, worktree-lane loop, doc-lane loop, lane worker} × {regressionBoundary, 0143 /exit boundaries, --stop-after, --repair, exit check, step mode}: every cell present or ruled absent.
2. Can a unit be dispatched twice (nextReady treats non-done as ready; 0156 D1 keeps doc-lane in_progress marks; a lane + the serial path)?
3. Crash between dispatch booking, the `auto-lane/<id>-<digest>` branch, `worktree add`, the landing merge and the landing-sync commit: orphan lanes/worktrees re-derived?
4. Parent as sole git writer under doc lanes (P17); width/tier resolution (0125/0126) vs AGENTS.md and the README.
Leads: `R1-doclanes` (an /exit at a doc lane's wrap-up entry throwing out of the doc loop mid-flight). Residuals: `dispatchLane` booking; lane receipts; 0156 D4 the formulation captured once. Seams: S19 (git-ops doc-lane decorator), S10 (runner entry).

## S06 Run control — services, lock, exit, step, interactive
Scope (2.0K): auto-core/src/{services.ts 164, lock.ts 182, exit.ts 120, control-types.ts 35, step.ts 75, hibernate.ts 102, stuck.ts 159, interactive.ts 283, log.ts 239, confirm.ts 30, shell.ts 165, opts.ts 457}. Tests (grep): services, lock, exit, step, hibernate, stuck, interactive*, log, confirm, shell. Rulings: 0012, 0014, 0016, 0027, 0053 D1–D3, 0061 C1–C5/R8, 0143, 0157 D1.
1. Run lock: atomic acquisition (two processes racing), re-entrancy per process, stale pid / pid reuse, release on every path; which commands must refuse while live (vs the shells' lists).
2. The `services()` ambient accessor: SERVICE_ENTRIES honored? the auto-server reach-through (`worker-interactive.ts:46,164,167` calling `services().control`/`.router`) — sanctioned by any seam?
3. 0157 D1 FIFO asks: the queued ask behind a hard wait; timeouts only the ask's own timer; doc-lane contention.
4. Hibernate/step/exit land only at safe boundaries (P20) and are bounded (P2)?
Residuals: 0157 queued ask behind a hard wait; blocked-settle inline abort. Seams: S30 (worker-interactive), S13 (session).

## S07 Planning A — the person-boundary commands
Scope (2.9K): auto-core/src/{plan.ts 1327, transfer.ts 383, clarify.ts 271, close.ts 528, task-add.ts 92, work-order.ts 260, plan-input.ts 62}. Tests (grep): plan*, transfer*, clarify, close, task-add, work-order, plan-input, dispatch. Rulings: 0053, 0058, 0076, 0101, 0116, 0137, 0159.
1. planPrelude loop-free and agent-free on its documented routes; its printed lines identical to the lines-returning twins used by driver-helper/status (one wording source, P5)?
2. Crash between the wall commit and the transition commit (transfer); between round close and open; between clarify's write and its commit; close's commit vs the units.json write — re-run recovers without git surgery, never double-applies?
3. clarify byte-identical to a hand edit; folds only the target document's changes; refusal matrix and exits 0/1/2 vs README.
4. P2: every place a person's decision is consumed — consumed only from the person's marks, never defaulted silently?
Leads: `R2-survey-commits` (the survey gate driven end to end — read its header for what it probes). Residuals: 0159 extra positionals (with S26). Seams: S09 (driver-helper/status twins), S20 (wall).

## S08 Planning B — formulation and the planning prompt
Scope (2.9K): auto-core/src/{loop-plan.ts 1184, formulate.ts 187, formulate-synthesis.ts 627, prompt-plan.ts 496, prompt-verify.ts 302, charter-clamp.ts 126}. Tests (grep): formulate*, append*, plan-loop, prompt-verify, charter-clamp, intent-guarantees. Rulings: 0080, 0082 D12, 0095, 0097, 0113, 0131, 0141, 0156 D4.
1. Formulation collect: the 0131 terminator, 0141's dropped own-row reload, synthesis degradation loud (P12); a malformed or partial ledger?
2. 0156 D4's freshen: re-reads every remediable source each pass (appendPlan's captures too)?
3. OPENCODE_AUTO_PLAN_VERIFY default off and deep-route only — in code and every doc.
4. Design: loop-plan.ts's header promises staying under 600 lines; it is 1184 — is the split due, and along which seam?
Leads: `R2-foreign` (the formulation todo beside a `--new-task` hand-added task reads "foreign" and cannot be reconstructed). Seams: S07.

## S09 Round documents and the read-outs
Scope (1.9K): auto-core/src/{analysis.ts 338, roadmap.ts 101, round-close.ts 136, round-brief.ts 164, brief.ts 134, status.ts 137, driver-helper.ts 609, conclusion.ts 320}. Tests (grep): analysis, round-gates, driver-helper, loop-conclusion, provenance (status parts). Rulings: 0081, 0105–0109, 0114, 0115, 0133, 0136, 0158 D3.
1. roadmap.ts the only roadmap reader at every detection site (status, driver-helper, transfer, preflight, config-fix)? 0136 divergence-only everywhere the supersession is noted?
2. driver-helper and status provably read-only (no writes, locks, git mutations); status.ts has no test file — which ruled behaviors are untested?
3. Counts-not-lists (ex-P9) on these surfaces (T5).
Leads: `R2-subheads` (a round-brief proposal using `####` sub-headings truncated at the first one by 0158 D3's terminator). Residuals: 0158 driver-helper free-content scan (a P7/P13 smell); round-less near-miss headings. Seams: S07.

## S10 Task pipeline A — dispatch and execution
Scope (3.4K): auto-core/src/{runner.ts 1024, execute.ts 1273, split.ts 216, exec-session.ts 400, artifact.ts 255, handover.ts 200}. Tests (grep): execute-handover, split, exec-session, artifact, handover, subtask-shape, auto-doc-shape, incident-regression. Rulings: 0021, 0030, 0056, 0059, 0130, 0143, 0156 D2/D5.
1. Retry/rollback bookkeeping identical across whole task, split stream and fix round; the handover file per scope (0156 D5).
2. Crash between the session end and the unified commit; between the commit and the units.json write.
3. The handover-precedence read keyed to the steer (0156 D2) — and trusting handoff.md content (the residual).
4. Agent output steering the driver beyond the grammar (P7): split rejection, todo shapes.
Residuals: 0156 D2 trusting handoff.md. Seams: S11 (wrapup), S13 (session).

## S11 Task pipeline B — verification, scripts, receipts  [high priority]
Scope (3.0K): auto-core/src/{wrapup.ts 696, testrun.ts 433, script.ts 525, regression.ts 511, resolve.ts 490, knowledge.ts 371}. Tests (grep): verify-loop, wrapup-result, testrun, script, regression, resolve, knowledge, park. Rulings: 0020, 0044, 0083, 0098, 0120, 0142, 0146, 0148, 0156 D7/D8.
1. **P3: can a work session's own report.md `Result: PASS` be taken as the verdict?** Is the 0120 reservation enforced in code or only in templates?
2. 0146: what counts as progress — previous count or best count? Can oscillating gaps loop forever (P2 boundedness)? Does the reader of 0148's `<id> fix <round>.<session>` subjects equal the writer?
3. Regression receipts: stale/foreign/unreadable → no-reuse (P12)? keyed to the tree?
4. script.ts watchdog: SIGTERM→SIGKILL reaches the process group or the direct child only? output capture bounded? the side-effect guard — how enforced, bypassable?
Leads: `R3-selfreport` (a work session's report.md PASS outranking the verify session's FAIL), `R3-oscillate` (gap counts 2,1,2,1… never block). Residuals: 0156 D7 SIGKILL direct child only; 0142 dead marker paths. Seams: S12.

## S12 Recovery and blockage  [high priority]
Scope (2.1K): auto-core/src/{resume.ts 280, resume-gate.ts 417, unit-commit.ts 196, blockage.ts 456, blockage-execute.ts 284, blockage-diagnose.ts 425}; plus the todo→done rename path in tasks.ts (grep `done.md`). Tests (grep): resume*, unit-commit, blockage*. Rulings: 0018, 0022, 0082, 0145, 0149.
1. **P3: trace every path that marks a unit done** — can a work session that renames its own todo.md → done.md (committed by the unified commit) be read as done after its verification FAILs?
2. **P2: blockage remediation runs only on the person's `Choice:`** — can an agent-written line (the diagnosis session's verbatim Analysis) be parsed as the person's mark?
3. 0145 × 0149 × resume-gate: what separates the person's hand commit from an agent's or another process's? Can adoption launder P4's driver-only commit right? (The constitution's P4 text still forbids hand commits in range — S03.)
4. Strict resume (0022) "uncertainty → no reuse, roll back" vs "foreign commits never rolled back".
Leads: `R3-selfclose`, `R3-choice`. Seams: S21 (tasks.ts unit-file precedence), S11.

## S13 Session driving
Scope (3.2K): auto-core/src/{chain.ts 458, chain-transitions.ts 445, session.ts 1046, session-api.ts 383, attempt.ts 682, watch.ts 152}. Tests (grep): chain*, session*, chain-writes, watch, failback. Rulings: 0015, 0017, 0022, 0026, 0057, 0061 §4.8, 0163 D2 (walkProviderKey in attempt.ts).
1. awaitRecovery: can a driver-side bug (not a provider outage) land in the wait-and-probe loop — unbounded, never reaching the person (P2)? Probes never pollute the real session (P20)?
2. chain-writes ratchet: escapes via aliasing, destructuring, Object.assign, spread-then-mutate?
3. 0163's walk at session start vs a resumed takeover; vs in-process concurrency (doc lanes sharing one managed server).
Leads: `R4-driver-throw-loop` (a deterministic driver exception reclassified as a transient session error, running the retry ladder), `R4-chain-ratchet` (the ratchet's binding finder copied for limit testing). Seams: S14, S17.

## S14 The turn engine
Scope (3.0K): auto-core/src/engine/** (spine 459, dispatch 230, contract 215, ladder 200, events 125, fx 137, result 87, sources 83, concerns/* 1476). Tests (grep): turn-*, replay, ladder, golden/turn. Rulings: 0026, 0057, 0061 (engine), 0130, 0143, 0157 D6.
1. The fx audit enforced at runtime or only in tests; held-settle and `inner.return()` skip cases; 0157 D6's post-finish emission window closed on every path.
2. engine/fx and engine/sources have no direct test — what invariants do they carry, covered indirectly?
3. Liveness/recovery/failure concerns: every wait bounded; probes isolated.
Residuals: 0157 D6; the probe sideband; blocked-settle inline abort. Seams: S13.

## S15 Accounting and journals
Scope (2.3K): auto-core/src/{stats.ts 983, stats-schema.ts 634, run-status.ts 164, run-status-schema.ts 292, quota-windows.ts 224}. Tests (grep): stats, run-status*, quota-windows, loop-conclusion. Rulings: 0019, 0038, 0057, 0067, 0152.
1. stats-schema (no test imports it): `.auto/stats.json` versioned, migration, lenient restart-from-present (0019), atomic writes, bounded growth?
2. The 0152 task-usage ledger under a crash — written before the data is lost? duplicated on restart?
3. Two journals (run-status.jsonl, run-events.jsonl): one writer per kind; readers (incl. auto-server observe.ts) tolerate unknown kinds and torn last lines (T9); vocabulary additive-only (P13).
Leads: `R4-stats` (lanes section across round rollover), `R4-ledger-a`/`R4-ledger-b` (SIGKILL between ledger append and stats write). Seams: S30 (observe.ts).

## S16 Routing and recovery policy
Scope (3.8K): auto-core/src/{router.ts 1276, routing.ts 317, select.ts 377, model-route.ts 63, model-step.ts 143, model-window.ts 304, tier.ts 36, failback.ts 39, classify.ts 518, usage.ts 197, capability.ts 195, roles/registry.ts 313}. Tests (grep): routing, select, model-*, tier, failback, classify, usage, capability, roles-registry. Rulings: 0017, 0038, 0040, 0055, 0060, 0064, 0144, 0163.
1. The router the only run state; module-level singletons/caches outliving a run (the classifier budget/cache)? select/routing pure, clock injected?
2. Every escalation bounded and terminating at the person; capability degradation renders its fallback (P12).
3. 0163 restart-churn floor (a restart follows a failure or a passed hold, never a bare session) — held at every router entry?
Seams: S17.

## S17 Models, key rings, secrets  [high priority]
Scope (2.9K): auto-core/src/{models.ts 926, models-schema.ts 164, models-describe.ts 673, keyring.ts 115, agent-env.ts 114, agent-choice.ts 38, switches.ts 827}. Tests (grep): models*, keyring, agent-env, switches. Rulings: 0055 §4.3/C4/§6.3/§6.4, 0059 X1, 0127, 0144, 0150 D2, 0163.
1. **Security family (hard requirement):** any path resolving a `{env:}`/`{file:}` value in the driver process, or printing one (logs, `models` output, errors, debug dumps)? The X1 scrub on every spawn.
2. **0163:** walk only on create/consumed fork; at most one restart per hold per key; fork oscillation "impossible" — true? the walk moving forward off a healthy key?
3. Strict parse (T9): models-schema vs models-describe vs the auto README registry section; the `number-recovery` route's strict failure (0150 D2) — does its error teach the remedy?
4. Switches: parsed once and frozen; the 6 undocumented switches (FORK, HANDOVER_CONCURRENT, HEAP_SNAPSHOT, SHARE, SYNTHESIS_TIMEOUT, TASK_CONTEXT) — experiment-layer or dead (P21/R6)? env reads outside switches.ts/agent-env.ts?
Leads: `R5-walk-forward`, `R5-walk-oscillation` (a stated reset shorter than the restart lets the fork's walk undo the rotation), `R5-walk-sibling` (a walk restarting the shared managed server under a sibling's in-flight turn). Seams: S13, S16, S18.

## S18 Agent adapters and the pool
Scope (2.9K): auto-core/src/agent/** (types 400, env 49, opencode/{client 176, events 290, server 438}, claude/{client 490, stream 308, contract 102, host 72}), agent-pool.ts 598. Tests (grep): agent-*.test.ts, capability. Rulings: 0037–0041, 0055 §8.5, 0057, 0127, 0157 D2–D5.
1. Both adapters deliver all 13 never-rejecting calls; event-stream parity the engine relies on.
2. The `: any` (opencode/client.ts:64), `as unknown as` (opencode/server.ts:104,125), empty catches (claude/client.ts) — any failure swallowed that should be loud (P12)?
3. Process lifecycle: managed server and claude processes killed on every exit path; orphans; pool close vs a start in flight vs a 0163 walk restart.
4. The 0127 timeout floor vs the person's declared opencode.json keys; the claude permission translation of 0147/0122 stamps.
Leads: `R5-claude-perms` (boundary translation of the 0147 pair + a 0122 composite). Residuals: 0157 the claude adapter's unbounded `await live.done` (flagged as needing a P20 ruling). Seams: S17.

## S19 Git core and the commit boundary
Scope (2.3K): auto-core/src/{git.ts 1618, git-ops.ts 361, numbering.ts 63, release.ts 74, document/process-refs.ts 182}. Tests (grep): git, unit-commit, numbering, release. Rulings: 0021, 0103, 0108, 0119, 0140, 0150, 0155, 0161.
1. Failure direction across **all** git spawns (not only 0155's): classify each nonzero-exit handling loud / toward-dirty / quiet-clean.
2. Trailer grammar: the one writer (message(), nestedHeads) vs every reader (fork, numbering, release's driver-commit run, resume's SHA baseline, land) — exact parse; a person's lookalike trailer?
3. 0145 adoption × 0119's release scan (the driver-commit run back from HEAD ends at an adopted foreign commit → under-scan?).
4. Numbering floor (0150) under concurrent lanes and forks; 0140's corpus bound.
Residuals: 0155 stashTree pathspec asymmetry; unitBaseline "" over an unreadable HEAD; the decorator carryover excludes. Seams: S05, S20.

## S20 Isolation, fork, the wall, permissions
Scope (2.4K): auto-core/src/{git-worktree.ts 308, git-land.ts 225, land.ts 298, fork.ts 446, wall.ts 551, protect.ts 78, external-dirs.ts 471}. Tests (grep): land, isolate, fork, wall, transfer-wall, protect, external-dirs. Rulings: 0074, 0122, 0128, 0129, 0132, 0139, 0147, 0155 D2–D4.
1. Fork without the run lock (0129) beside live commits and lanes: branch-name collisions, worktree-metadata races; remove-fork completeness (nested-first, per-repo branch deletion, `--force`).
2. The wall: predicate re-derived at every boundary; retires only its own stamped bytes. **0132's Category scope marked `src/config-fix.ts` (0122 stamp sync) and `document/roles.ts` changed, but the enactment `5b5b52fcd` touched neither — can `fix`'s 0122 sync re-add an allow the closed wall retired?**
3. external_directory under last-match-wins: init stamp, fix repair, wall retire all produce an order that admits the 0122 stamps and keeps the 0147 deny pair effective?
4. protect.ts honors "a guardrail, not a security boundary" in its docs.
Leads: `R6-r6` (a 247-line multi-scene file — read its header), `R7-perm` (the stamps evaluated with opencode's own matcher, last-match-wins). Residuals: 0155 coveringAllowKeys counting allow-only. Seams: S22.

## S21 The task store and documents
Scope (2.6K): auto-core/src/{tasks.ts 1063, document/{types 93, roles 427, spec 252, state 126, unit 363}, docpaths.ts 261, doccheck.ts 56}. Tests (grep): tasks, document-*, docpaths. Rulings: 0010, 0045, 0047, 0051, 0124, 0158 D1.
1. tasks.md order/membership vs unit files (exactly one of todo.md/done.md) vs .auto/units.json — precedence and conflicts; who may write each (driver-exclusive renames).
2. CRLF in every line-splitting reader (0158 fixed two); near-miss headings; Depends graph validated on load (cycles, dangling refs)?
3. Grammar strictness of the field block (Depends/Touches/Phase) and the artifact specs (P7, P12).
Residuals: 0158 the other CRLF readers; `#### Notes`. Seams: S12.

## S22 Config and materialization
Scope (2.6K): auto-core/src/{config.ts 613, config-fix.ts 382, gitignore.ts 186, agents-block.ts 332, reset.ts 143, clean.ts 35, sync.ts 305, provenance.ts 273, install-prompts.ts ~370 (0164 grew it), prompt-facts.ts 32, format.ts 55, overlay.ts 38}. Tests (grep): config*, gitignore, constitution-ratchet, reset, sync, provenance, install-prompts. Rulings: 0004, 0052, 0054, 0100, 0135, 0136, 0138, 0158, 0164.
1. Idempotence (P6): a second init/fix/sync/reset byte-identical no-op? fix's exit per finding class (fixable/manual/info, 0135) vs docs.
2. Provenance three-state comparison identical at every detection site (config-fix, status, loop-preflight); sync dryrun counts real writes.
3. 0164's MANIFEST: digest grammar, idempotence, P13/P18 — the pin a target commits.
4. agents-block constants vs their carriers (the constitution ratchet leaves paraphrase drift to audit).
Leads: `R7-prov` (provenance direction for a body-only difference). Seams: S20 (external-dirs), S26–S27/S29 (shell init paths).

## S23 Policy-as-data — the code side
Scope (2.8K): auto-core/src/{intent/{types 119, load 149, guarantees 232, test-lanes 258}, mode.ts 89, template.ts 532, prompt.ts 1073, bundle.ts 346}. Tests (grep): intent*, mode, template, prompt-*, golden, bundle, lane-table. Rulings: 0031–0035, 0079, 0080, 0096, 0124.
1. PROTOCOL_MARKERS: can a target override drop a protocol-sensitive marker? The 0035 registry (driver-parsed literals) vs PROTOCOL_MARKERS vs templates — three-way diff.
2. P15: any person- or agent-facing copy authored in src instead of templates (renderers assemble only)?
3. Registration completeness (reported complete in S01 — confirm briefly, don't redo).
Seams: S24.

## S24 Templates — prompt copy and the default pack
Scope (md): auto-core/templates/prompts/*.md (37 files), templates/intents/default.md 253, templates/modes/migrate.md, templates/opencode.json, templates/.opencode/agent/auto.md. Read by grep for protocol literals, then the 6–8 most load-bearing templates (whole, wrapup, fix, decompose, phase-handover, _partials) in full.
1. Every literal the driver parses (S23's list) present and consistent; teaching true at HEAD (0130, 0143, 0146, 0148 wording).
2. P16: no real project's facts (grep aster, rustpg, dm-glm, dm-flash, spi-nor, linux paths).
3. The work session told not to write report.md / rename todo→done / write `Choice:` (pairs with S11/S12's code findings).
Seams: S11, S12.

## S25 Bundles and the manual-driver suite
Scope (md): auto-core/templates/bundles/{cleanroom,faithful,faithful-lean}/** and auto-core/prompts/*.md (10 files; run.md 707 lines — read by section). Tests (grep): bundle, manual-prompts-ratchet, install-prompts. Rulings: 0078–0094, 0104, 0117, 0118, 0120, 0121, 0124, 0153, 0154, 0161, 0164.
1. The manual suite vs the driver for 0120, 0146, 0148, 0161, 0163, 0164 — any rule the driver enforces that the suite teaches differently (R2 channel divergence)?
2. Bundles: complete Phase-artifacts/Task-artifacts declarations (0124); cleanroom gates (0121/0153/0154) coherent; P16 clean.
Seams: S22 (install-prompts).

## S26 CLI shell A — parser, help, option policy
Scope: auto/src/index.ts from the top through the global gates (~lines 1–1240 at d579016b2: argv parser, VALUE/REPEAT/BOOLEAN_FLAGS, retired commands, OPTION_HELP, EXIT_CODES, COMMANDS, OWNED/RETIRED/KNOWN flags, optionRefusal, RUN_OPTION_REFUSALS, legacy-layout and run-lock gates) + auto/AGENTS.md. Tests (grep): e2e.test.ts describes for parsing, help, retired flags, the 0159 option-policy guard. Rulings: 0052, 0159.
1. Positional handling (0159 residual: extra positionals ignored), `--flag=value`, repeated flags, `--`, unknown-flag refusal coverage.
2. Command-list truth across COMMANDS, `--help`, README, MANUAL cheat sheet, auto/AGENTS.md, shell-contract §A (known gaps from S01 — confirm, don't rediscover); "the public sixteen" comment vs 18 rows.
3. Exit codes per command vs EXIT_CODES vs core AGENTS.md.
Leads: `R8-argv-probe` (argv handling probe), `R8-cli.sh`. Residuals: 0159 extra positionals; `fix --dryrun` exit 1 documented?; the amendPhasesHold line (80fd308c5 claims fixed). Seams: S27.

## S27 CLI shell B — command blocks
Scope: auto/src/index.ts from the first command block (~1240) to the end (~3380): run/_lane/plan/transfer/close/clarify/land/fork/remove-fork, parseSessionFlags, loadRunConfig, logRunBanner, runOptions, parseConfigFlags, init/amend, reset/fix/sync/release/status/models/install-prompts/driver-helper. Rulings: 0053, 0058, 0073, 0074, 0103, 0116, 0122, 0128, 0129, 0137, 0138, 0139, 0147, 0164.
1. RunAllOpts completeness: every field of the core's RunAllOpts/Opts (auto-core/src/opts.ts, loop.ts) threaded by runOptions or deliberately omitted.
2. Run-lock refusals per command vs AGENTS.md; config-layer writers missing from the list?
3. init: validate-then-write (0052 D7) — every refusal before the first write; 0073/0122/0147/0138 order; a crash mid-init → re-run safe?
4. Destructive paths behind the clean-tree gate + confirmation; `-f` semantics.
Leads: `R8-cli-nopath.sh`, the `ident`/`lanes` scenes (see leads/README.md). Seams: S29/S30 (the server's mirror of runOptions and init/amend).

## S28 CLI docs and the e2e strategy
Scope: auto/README.md 2401 and auto/MANUAL.md 245 — **grep-driven, never read whole**: the switch table, the security posture, the key-ring paragraph, exit codes, the registry section; auto/test/e2e.test.ts strategy (grep the describes, the OPENCODE_AUTO_E2E-gated tests, how the CLI is spawned and with what env); auto/test/fixtures/fake-claude.ts vs auto-core/src/agent/claude/{stream,contract}.ts.
1. Retired vocabulary still taught (brief stub, amendPhasesHold, skip flag, next-task record, CURRENT.md, `check`, `continue`, `--commit`).
2. Contracts covered only by the 8 opt-in E2E tests; hermeticity of the e2e suite (no bunfig preload: the operator's ~/.config registry and ambient OPENCODE_AUTO_* reachable?).
3. fake-claude fidelity vs the real stream-json protocol; the two shells' fake-claude copies (61 lines differ).
Seams: S31.

## S29 Service shell A — daemon, auth, spawn  [high priority]
Scope (2.7K): auto-server/src/{daemon.ts 1060, store.ts 232, request.ts 424, worker.ts 429, worker-command.ts 26, profile.ts 66, index.ts 426}. Tests (grep): daemon, worker, cli, isolation, profile, lanes-e2e. Rulings: 0067, 0151, 0160, 0162.
1. Route→scope table complete (incl. WS upgrades, /app.js, /session, /health); 401 vs 403; constant-time comparison for tokens and the worker secret; store and data-dir file permissions; bind default (loopback?); `?token=` exposure.
2. Secrets in process args/env: the per-run bridge secret in the worker's argv (visible in /proc/<pid>/cmdline); what a `--launch` launcher inherits; every spawn spelling out its env (0162's Bun fact).
3. Registry lifecycle: restored runs, eviction (0160 residual), DELETE semantics under `--launch`.
4. The worker's runOptions/loadRunConfig/logRunBanner/phasesLine vs the CLI's (byte-identity claims).
Leads: `R9-daemon` (the bridge secret in argv; restored-run immortality across restarts), `R9-ipv6` (an IPv6 bind writes a transport URL the worker's validator refuses), `R9-nogit-run` (a server-initialized non-git target running with no commit). Residuals: 0160 run-registry eviction. Seams: S27.

## S30 Service shell B — operations and observation
Scope (3.0K): auto-server/src/{ops.ts 1263, observe.ts 662, question-journal.ts 266, interactive-ws.ts 268, ws-protocol.ts 226, worker-interactive.ts 322}. Tests (grep): ops, observe, status-events, question-*, interactive-*, ws-protocol, no-target-writes. Rulings: 0067, 0135, 0137, 0160 D1–D4.
1. ops.ts header says "through the core, never a re-implementation" — vs its parseConfigKeys/runConfigOp; gaps vs the CLI's init (0122 applyExternalAllows, 0073 git bootstrap, 0147 pair, `amend --brief`): does a server-initialized target differ from a CLI-initialized one?
2. The retired-key surface: the server's amend accepting `phases` (0137 retired it on the CLI).
3. observe.ts's atomicity claim about progress.json vs the core writer; the root cause of the flaky observe e2e (`sawDirty` poll window).
4. Journal/queue bounds: compaction, unbounded growth, SSE subscriber caps.
Leads: `R9-ops` (A: the server's amend accepting config.phases, and more scenes). Residuals: 0162 the observe flake. Seams: S15 (journal readers), S06 (services reach-through).

## S31 Service shell C — web client, docs, test health
Scope: auto-server/web/** (2.4K: main 654, ops 564, render 467, api 261, interactive 176, sse 161, index.html 159), auto-server/README.md 290, auto-server/docs/daemon.md 874 (grep-driven), the shell-contract §A/§C/§E rows for auto-server.
1. Web: where the bearer token lives (localStorage?), XSS in rendered run/log/question content, CSRF/Origin posture.
2. Doc truth: routes, request vocabulary, exit codes, the "deliberately absent" list (release/install-prompts missing), stale comments (ops.ts:49, worker.ts:417–419, profile.ts:42).
3. The deterministic `worker.test.ts` "usage vocabulary" 5 s budget breach (S00): the right fix shape (per-test timeout vs splitting the case).
Residuals: 0160 the web form's minimal options; surfaces beyond D4 staying CLI-only. Seams: S32.

## S32 Cross-cutting design synthesis
Inputs: the plan's digest, the `## Design notes`, `## Seam notes` and jsonl blocks of S04–S31 (read those sections only), auto-core/test/import-direction.test.ts's table (grep), docs/shell-contract.md. No new code review — only targeted reads to settle a seam question.
Produce: (a) layering & boundaries (`./*` exports make all src public vs P14's entry modules; the kernel→pipeline edge `git-ops.ts:45`; the services reach-through); (b) core/shell duplication (runOptions ×2, key tables ×3, init/amend, fake-claude ×2) and the seam that would remove it; (c) **the state-homes table** — every durable home (`.auto/*`, document grammars, trailers, branch families, journals): owner, writers, atomicity, re-derivation, external readers; (d) concurrency (P17); (e) security posture; (f) complexity & P21 (switch count, CLI surface, 300+ inline AUTO-DECISION comments, modules past their own size promises); (g) test strategy (oracle quality, gated-only contracts, flakes, shell hermeticity); (h) the constitution's own quality (from S02/S03). Output `S32-synthesis.md` with findings (cat CPLX/BOUND/DUP/TEST) + the tables.

## S33 Verification A — findings of S04–S18
For every S1/S2 and every PLAUSIBLE finding in S04–S18 (read their jsonl only): re-show the cited lines at HEAD; trace alternative paths/guards; grep for a test pinning the opposite; search the corpus for a ruling/residual (→ BY-DESIGN / RESIDUAL); reproduce (mandatory for S1/S2); re-rate. Labels: CONFIRMED / PLAUSIBLE / REFUTED / BY-DESIGN / DUPLICATE. Output `S33-verify-a.md`: one row per finding (id | verdict | evidence | final sev). If the batch exceeds ~20 findings, split it across sessions by step and note the split in the status table.

## S34 Verification B — findings of S19–S32, and the corpus findings
Same procedure for S19–S32, plus the F-series candidates in S02 and S03 (re-check each against the corpus text). Output `S34-verify-b.md`.

## S35 Report assembly
Inputs: the plan's digest, S32, S33, S34 and every step's jsonl (verified verdicts win). Write the **Report** part of `plans/0165-three-package-review.md` (outline in the plan), dedupe (key `pkg:path#symbol#cat`; owner = where the fix lands; keep the highest severity, union evidence), number findings `0165-NNN` and the release-audit findings F9…, write the fix-wave program, update the INDEX row's "what it ruled" cell (exactly 6 cells, pipes escaped), run `bun plans/0165-review/tools/probe.ts` and confirm no new INDEX grammar finding, and set the plan's status line to `done`.

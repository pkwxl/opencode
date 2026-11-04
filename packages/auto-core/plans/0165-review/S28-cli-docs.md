# S28 — CLI docs and the e2e strategy

Date: 2026-11-04. HEAD read: 98bbf0e55 (= d579016b2 in scope; S26/S27's commits touched only plans/). Status: done.

## Coverage

- auto/README.md (2407) probe by section: usage block 40-60 deep, config tables 168-320 (the retired-options rows 286-289 deep), reset table 497-515 deep, run options 536-603 (exit-code line 577), registry 1183-1330 deep (key ring 1299-1318), env table 1401-1414; grep sweeps for retired vocabulary across both docs.
- auto/MANUAL.md (245): cheat sheet 226-245 deep, exit-code lines 171-176, transfer section 60-100.
- auto/test/e2e.test.ts:1-80 deep (E2E gate, harness), 631-676 deep (CLI_ENV_BASE, runCli, commitFixture), gated-test census (5 `skipIf(!E2E)` + 3 spec-gated), 5475-5505 deep (the stub-host in-process test's env discipline).
- auto/test/fixtures/fake-claude.ts: 320-362 deep (stream emission), act/write surfaces by grep; diff vs auto-server's copy (66 lines, purely additive).
- auto-core/src/agent/claude/stream.ts:1-70 probe (the parser's documented event table); test/agent-claude.test.ts probe (failure shapes covered).

## Findings

```jsonl
{"id":"S28-01","title":"README's reset table teaches a retired rule: brief.md 'deleted only when byte-identical to the project brief stub' — reset keeps it unconditionally (and README's own usage row says so)","sev":"S4","conf":"CONFIRMED","cat":"DOC","measures":["0081 D11","P13","P5"],"loc":["auto/README.md:508","auto-core/src/reset.ts:21-23,70","auto/README.md:50"],"symbol":"reset cleanup table","evidence":"README:508 `**Deleted only when byte-identical to the project brief stub**` vs reset.ts:70 `{action:\"keep\", reason:\"the project brief … is kept; delete it by hand if you mean to\"}` and reset.ts:21-23 `the stub model and its remove-while-stub rule retired`; README:50 (the usage row) teaches the current truth — the table contradicts both","repro":null,"impact":"a person planning cleanup reads a deletion rule that never fires (conservative direction: the file is kept, not destroyed)","remedy":"fix the one table row to the keep rule","family":[],"prior":"NEW","wave_hint":"docs truth"}
{"id":"S28-02","title":"README's retirement row says the continue notice points at plan; the notice names transfer","sev":"S4","conf":"CONFIRMED","cat":"DOC","measures":["P13","0053 D33","0101 D2"],"loc":["auto/README.md:289","auto/src/index.ts:260-265"],"symbol":"retired-options table","evidence":"README:289 `(pointing at \\`plan\\`)` vs index.ts:262 `… run ${bin} transfer <dir> — it runs the round-close checks and opens the next round`","repro":null,"impact":"stale pointer inside an otherwise-accurate retirement catalogue","remedy":"one word: transfer","family":[],"prior":"NEW","wave_hint":"docs truth"}
{"id":"S28-03","title":"MANUAL's cheat sheet omits fork, remove-fork and driver-helper (15 of 18 public commands)","sev":"S4","conf":"CONFIRMED","cat":"DOC","measures":["P13"],"loc":["auto/MANUAL.md:226-245"],"symbol":"cheat sheet","evidence":"20 rows counted; no fork/remove-fork/driver-helper row — the same omission family as auto/AGENTS.md:7 (S01-06, S26-05); README's usage block (40-60) carries all 18 with current wording","repro":null,"impact":"the quick-reference card a person prints misses the retry-fork pair and the person-proxy brief","remedy":"add the three rows; one docs change with S26-05's AGENTS.md list","family":["S01-06","S26-05"],"prior":"NEW","wave_hint":"docs truth"}
{"id":"S28-04","title":"README's key-ring paragraph asserts 'The walk never oscillates' — refuted by S17-03's reproduction (short stated resets make the fork's walk undo the rotation; 80 restarts over 40 failures)","sev":"S4","conf":"CONFIRMED","cat":"DOC","measures":["P13","0163 D2","P19"],"loc":["auto/README.md:1308-1309"],"symbol":"key ring § walk paragraph","evidence":"README: `The walk never oscillates (the fork a rotation just seeded rides the held key it landed on)` vs S17-03 CONFIRMED: the rotation's mark until can be seconds away, the consumed fork walks pre-first-call and lands back on the spent key — B never prompted across 40 failures","repro":null,"impact":"the operator's mental model of restart load is wrong in exactly the field case the paragraph exists for; the paragraph also describes the walk as moving 'back' to an earlier key while the code walks forward too (S17-01)","remedy":"the paragraph changes in lockstep with S17-01/03's code fix (P13); until then it documents an invariant the code does not have","family":["S17-01","S17-02","S17-03"],"prior":"NEW","wave_hint":"rides W-keyring"}
```

## Leads

None assigned to S28 (the R8 leads were S26/S27's; both dispositioned there).

## Residuals

- None named for S28 by the 0155–0160 waves. The prior-step doc findings that touch this scope (S17-09 switch census, S17-10 registry tier drift at README:1262, S17-06 security-family statement) are recorded in S17 and not re-derived.

## Verified clean

- Retired-vocabulary sweep: every mention of `--verify/--review/--early…`, `--source-dir…`, `init -p/--brief`, `--amend`, `--implement-file/--prompt`, `--commit`, `continue`, `check`, `CURRENT.md`, the next-task record and `amend --phases` in README/MANUAL is a retirement notice teaching the right live channel (README:286-289, 171, 1512-1518, 1977, 2287; MANUAL:98, 227); MANUAL:71's "round brief stub" is current truth (transfer writes it at establishment); no stale live-teaching of any retired word found.
- Exit codes: MANUAL:174-176 carries the full frozen vocabulary 0/1/2/3/130 matching the CLI's EXIT_CODES and core AGENTS.md; README:577 carries 3/130 in the run-options section; every per-command row spot-checked (close, land, fork, remove-fork, release, fix/sync dryrun, clarify, install-prompts --check) matches the code.
- e2e hermeticity (the brief's concern): runCli spawns the CLI with CLI_ENV_BASE — every ambient `OPENCODE_AUTO_*` stripped, XDG_CONFIG_HOME pinned to an empty config home (operator registry unreachable), GIT_CONFIG_GLOBAL to a test config, OPENCODE_AUTO_ANALYSIS=off, OPENCODE_AUTO_MODELS pointing at a nonexistent file (e2e.test.ts:631-645); the one in-process runAll with a stub host (5494) snapshots the ambient env, scrubs the switch registry and restores both in a finally. The shells carry no bunfig preload but the harness does the scrubbing itself.
- Opt-in E2E strategy: 5 `skipIf(!E2E)` sites plus 3 spec-gated (STEPS_PAIR windows, KEYS_SPEC key injection, CLASSIFIER live classify) — the ~8 skips S00 counted; each header documents its env contract; the genuinely real-server contracts (window discovery, in-server `{env:}` substitution, live classifier, question-block flow) are exactly the opt-in set, and the README admits no provider is verified for key rings yet.
- fake-claude fidelity: the fake emits the real parser's documented happy-path shapes (system/init once, user replay-ack, assistant tool_use with mid-turn usage, tool_result, closing assistant text, result with cost/usage/modelUsage incl. contextWindow); the failure shapes (api_retry, rate_limit_event, the synthetic `<synthetic>` error message, compact_boundary) are pinned against the real parser in auto-core's test/agent-claude.test.ts — the division of labor is sound. The auto-server copy is the reference plus documented extensions (FAKE_CLAUDE_DELAY_MS, the T-094 interruption branches); the diff is purely additive (66 lines), no base drift since the 0160 refresh.

## Design notes

README is a well-kept single surface: the usage block and the registry/key-ring prose are current to 0163/0164; every defect found lives in a table that restates a code rule (the reset table, the retirement pointer) — the pattern is "prose ages well, mirrored tables rot". The e2e strategy (hermetic spawns + opt-in real-server tests + core-level parser tests) is the right shape; the standing cost is the hand-refreshed fake-claude duplicate (S32's DUP row). Change first: the three table-row fixes, one docs change.

## Seam notes

- S31: daemon.md's switch table is S17-09's family; the server README's own command/command-doc truth is S31's scope.
- S32: the fake-claude duplication (base + documented branches, refreshed per absorb) is a DUP candidate — a shared fixture via the core's test/fixtures or a one-way import.
- S33/S34: S28-01..04 are all CONFIRMED doc findings needing no reproduction beyond the cited lines.

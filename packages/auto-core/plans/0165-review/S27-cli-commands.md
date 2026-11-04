# S27 — CLI shell B: command blocks

Date: 2026-11-04. HEAD read: bb7daf7cd (= d579016b2 in scope; S26's commit touched only plans/). Status: done.

## Coverage

- auto/src/index.ts:1260-3345 deep except: 1449-1620 (plan block, deep), 2030-2114/2230-2455 (parseTextOrFile, parseConfigFlags, deep), 2114-2230 (loadRunConfig/logRunBanner/runOptions/parse* helpers, deep) — the whole run/_lane/plan/transfer/close/clarify/land/fork/remove-fork/init+amend/reset/fix/sync/release/status/models/install-prompts/driver-helper sequence read; phasesLine (3229-3241) deep.
- auto-core/src/loop-preflight.ts:83-260 probe (RunAllOpts definition, field-by-field vs runOptions); src/clean.ts deep; src/install-prompts.ts:1-100 deep; src/config.ts:147-176 probe (loadProjectConfig missing-file semantics).
- auto/AGENTS.md rows 26-40 cross-checked (S26 read it deep).
- e2e.test.ts describe census (S26); the run-lock describe (3512) confirmed present.

## Findings

```jsonl
{"id":"S27-01","title":"phasesLine's missing-index remedy names plan, but its only caller context (phased projects) is exactly where plan refuses naming transfer","sev":"S3","conf":"CONFIRMED","cat":"UX","measures":["P8","0101 D2","0137"],"loc":["auto/src/index.ts:3234","auto/src/index.ts:2149"],"symbol":"phasesLine","evidence":"`⚠ phase index (docs/R-01/phases.md) is missing; run opencode-auto plan to establish the round` — printed only under `config.phases !== \"m\"` (2149), i.e. phased projects; on those plan answers `the project start … is transfer's; run: opencode-auto transfer <dir>`","repro":{"cmd":"init a phased project (--phases dm) in a scratch repo, then run <dir> --dryrun / plan <dir> / transfer <dir>","observed":"banner teaches plan → plan refuses teaching transfer → transfer proceeds (opens the analysis). The line predates 0101's re-homing of round establishment"},"impact":"the person runs the taught command and is refused once before the right one appears; the same stale line ships in the server shell (digest seed)","remedy":"teach transfer for phased configs (pass the mode into phasesLine or split the message); same fix in the server's copy","family":["auto-server/src/worker.ts (the mirror phasesLine)","auto-core/src/status.ts (the core's own phase line — check its wording when fixing)"],"prior":"NEW","wave_hint":"shell polish; rides the digest's known-seed confirmation"}
{"id":"S27-02","title":"run on a never-initialized directory prints a defaults config banner, then refuses on the missing agent contract naming fix — which itself refuses naming init (two-hop remedy)","sev":"S4","conf":"CONFIRMED","cat":"UX","measures":["P8","P12"],"loc":["auto/src/index.ts:1310-1313","auto-core/src/loop-preflight.ts (the contract check)","auto-core/src/config.ts:147-151"],"symbol":"run block / loadRunConfig","evidence":"loadProjectConfig treats a missing file as defaults (config.ts:147 'file missing → defaults'), so the banner shows `⚙ project config (.opencode/auto/config.json): mode migrate · …` over a directory with no config, then preflight stops on `agent contract file missing` with `recovery: run opencode-auto fix <dir>`; fix on that dir refuses `nothing to fix … run opencode-auto init`","repro":{"cmd":"mkdir empty; opencode-auto run empty","observed":"defaults banner → ⏸ agent contract missing → fix named → fix refuses naming init"},"impact":"a never-initialized directory is two refusals away from the true remedy; --dryrun spends its precheck session the same way","remedy":"preflight (or the shell's run row) checks config.json existence before the contract and teaches init directly — the root cause is the missing config, not the missing contract","family":[],"prior":"NEW","wave_hint":"shell/core polish"}
```

## Leads

- R8-cli-nopath.sh — not run as written: the script sets a trimmed PATH (not none) and hardcodes the first attempt's dead scratchpad XDG; agent-bin discovery is the agent pool's bin check (S18's scope), and index.ts contains no PATH logic to review. Direct bun invocations used for all probes.
- ident/lanes scenes (named in leads/README as built by the first attempt) — no files exist for them; the ident scene probed directly instead: a resolving GIT_*/global identity passes with nothing written, and `--name/--email` beside a resolving identity writes nothing (observed) — 0073's order holds. The lanes scenes belong to S05's already-covered scope.

## Residuals

- 0159 extra positionals — carried by S26-03 (still open there).
- amendPhasesHold — verified gone in S26 (parseConfigFlags:2354-2357 now refuses `--phases` on amend outright with 0137's roadmap-line teaching); residual closed.
- `fix --dryrun` exit 1 documented — closed on the help surface in S26; README check deferred to S28.

## Verified clean

- RunAllOpts completeness: runOptions (index.ts:2155-2191) threads every config-sourced field; the run block adds waitBetween/dryrun/maxSessions/repair/stopAfter/boundary, plan adds stopBefore/planInput/append, transfer adds resynthesize, _lane adds lane — the only field never set by the shell is `managed` (loop-preflight.ts:150-153: a caller-managed server handle; the loop owns lifecycle otherwise — deliberate).
- The run-lock matrix matches AGENTS.md:39 exactly — refusing init/amend/reset/clarify/sync(!dryrun)/fix(!dryrun) at index.ts:1252; run/plan/transfer/close/land take it via takeRunLock; status/models/release/driver-helper/install-prompts/fork/remove-fork deliberately lockless (each documented with its ruling: 0093 D3, 0129).
- Destructive-path gates: reset always (clean-tree + confirm), fix when fixable findings exist, sync when writes would happen, init when overwriting an existing config — `-f` skips both gates everywhere, non-TTY skips only the question (clean.ts:5-8); install-prompts' ungated overwrite is 0093 D2's ruling ("overwrite is the point", git the undo).
- init validate-then-write (0052 D7): every refusal — flag values (parseConfigFlags), mode registration, bundle parse, the prefix guard (plannedPhaseUnits), prompt-library/intent load, git bootstrap, commit identity — fires before the overwrite gates and the first saveProjectConfig; the write phase is idempotent (templates skip identical, ensurePointer/ensureInitGitignore/applyExternalAllows all compare-then-write), and a crash mid-init re-runs with -f (the dirt refusal itself teaches it; observed the untracked-dirt behavior in clean.ts via porcelain -uall).
- 0073 identity order holds (observed): resolving identity → nothing written; pair beside resolving identity → not written; init's own ladder refuses the run/close/lane options with owner-pointing lines (index.ts:2540-2600).
- Strict value validation everywhere: parseTextOrFile (mutually exclusive, non-empty, regular readable file), parseMinutes/MaxSessions/RepairBudget/IdleTime/IdleMax/ContextLimit integer-range checks, --phases via phasesProblem + the 0137 amend refusal, --scan-exempt via scanExemptProblem.
- fix/sync --dryrun exit codes match their documented contract (0 none/info-only/report-only, 1 findings/writes — index.ts:3066-3073, 3156-3163); install-prompts --check exits 1 on drift (index.ts:3315).

## Design notes

The block sequence is uniform and disciplined: argument checks → refusals → strict config load → lock → one core call → exitWithResult; one strict loader (loadRunConfig) shared by run/plan/close/clarify; the destructive-gate family (reset/fix/sync/init) is consistent and each gate teaches -f. Best choice: the owner-pointing refusal lines (every flag names its owning command). Worst: messages that teach state-dependent remedies from a stateless vantage (S27-01/02 — phasesLine and the uninit run both teach the command a fresh eye would pick, not the one this state needs). Two design observations, not findings: install-prompts destroys uncommitted person edits to suite files without a gate (0093 D2-ruled; a P20 challenge worth a ruling if manual suites grow local edits), and fix's manual-findings exit 1 sits beside the "2 = blocked for human" family — documented and consistent within fix, but a vocabulary question for S32.

## Seam notes

- S29/S30: the server's mirrors of runOptions/init/amend/phasesLine — S26-04's amend-ladder hole and S27-01's stale line likely both mirrored there; ops.ts re-implements init/amend per the digest's seeds.
- S28: README's exit-code and dryrun rows vs the verified behaviors here; the fix-manual-exit-1 vocabulary question lands in S32's constitution-quality pass.
- S33: nothing to verify beyond S27-01/02 (both CONFIRMED with repros).

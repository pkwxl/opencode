# AGENTS.md

Package-level notes for coding agents, kept lean: the per-file index of module → responsibility → key files lives in [docs/structure.md](./docs/structure.md), and the core/shell contract in [docs/shell-contract.md](./docs/shell-contract.md); the CLI shell is the `../auto` package.

## Overview

`@opencode-ai/auto-core` is the core library of the auto tool family (no bin): task pipeline, phase loop, acceptance/review, prompt templates, configuration, auto numbering, interruption recovery, unified commit, and other mechanisms are concentrated here and exported via subpaths (`@opencode-ai/auto-core/<module>`) for shell packages to consume. Comments and user-facing messages are written in English.

Distinguish two kinds of knowledge: `PLAN.md`/`CURRENT.md`/`.opencode/auto/config.json`/`docs/agents/` etc. are normative objects the program imposes on the **target directory** at runtime, not file conventions of this repository itself.

## Documentation system (two-tier)

- **Code and comments are the first carrier of design**: structure, invariants, and decision rationale travel with the code.
- `plans/NNNN-<slug>.md` — numbered design/plan document history (ordered by first git commit date): stage-assist documents that only support development during a specific stage, **retired once obsolete and never maintained to track later changes**; originals are preserved untranslated (historical record); new design documents default to English.
- `docs/` — only durable overall architecture, design principles, and code-location indexes (currently shell-contract / structure); updating them requires good reason. The former `docs/behavior.md` (target-directory runtime behavior contract) was retired verbatim to `plans/0029-behavior-historical.md` (historical record, not maintained).
- This file records only high-frequency invariants + pointers; mechanism details belong to the numbered plans/ documents.

## Commands (run inside this package directory)

- `bun typecheck` — `tsgo --noEmit`.
- `bun test` — runs `test/`.

## Build conventions (developing this program)

- **Templates must keep the `with { type: "file" }` import** — the only way shell packages embed them into the binary at compile time. When adding a built-in template, register it in the same change: prompt templates → the embedded registry in `src/template.ts` (shell-added templates go through `registerTemplate`), mode templates → `src/mode.ts`, intent packs → `src/intent/load.ts`; init copy templates are registered by the shell.
- `src/templates.d.ts` provides path-string types for `*.md` / `*.json` imports; do not remove `resolveJsonModule: false` from `tsconfig.json`.
- Shells reference this package's TS sources and template files directly via `package.json` `exports` (`"./*": "./src/*.ts"`, `"./templates/*"`); new src files need no exports registration. **The core does not know shells** (never import any shell package); shell differences are injected exclusively via the `src/shell.ts` profile or parameter passing.

## Core/shell contract

This package is the core; shell packages (`packages/auto`, the general CLI with bin `opencode-auto`, plus each shell branch's simple shell `packages/<name>` — package name and bin are chosen by each shell and not recorded by the core) depend on this package one-way via subpaths; **shell branches must not modify this package** — differences are injected via `setShellProfile`/`registerTemplate`/parameter passing. The branch model (core changes land only on the auto-core branch, shell branches periodically merge auto-core to refresh the snapshot, auto is the integration branch) and the new-shell onboarding checklist are in [docs/shell-contract.md](./docs/shell-contract.md).

## Navigation (locate by change; NNNN = numbered plans/NNNN-*.md document)

- Project configuration → `src/config.ts` (0004)
- Task pipeline → `src/runner.ts` + `src/execute.ts`; session driving → `src/chain.ts` → `src/session.ts` → `src/attempt.ts` → `src/watch.ts`; bypass-session skeleton → `src/artifact.ts`; phase loop → `src/loop.ts` + `src/loop-task.ts` + `src/loop-phase.ts` + `src/phases.ts` (0006); preflight → `src/loop-preflight.ts`
- Fork decomposition and experiment switches → `src/execute.ts` + `src/session.ts` ensureForkBase + `src/session-api.ts` + `src/switches.ts` (0003)
- Step mode (OPENCODE_AUTO_STEP) → `src/step.ts` (0012); `/exit` graceful exit → `src/exit.ts` (0014)
- Hibernate windows (OPENCODE_AUTO_HIBERNATE) → `src/hibernate.ts` + `src/switches.ts` (0027)
- Acceptance/review → `src/review.ts` + `src/verify.ts` (0009); final-review loop → `src/final.ts` (0005)
- Prompt copy → touch only `templates/prompts/*.md` (`src/prompt.ts` only assembles data); after changes run `bun test test/prompt-exec.test.ts test/prompt-verify.test.ts test/prompt-phase.test.ts test/prompt-template.test.ts`
- Intent packs (frozen schema M1.1; content migrates per loop M1.2+) → `src/intent/types.ts` + `src/intent/load.ts` + `templates/intents/` (0031); document roles / artifact specs (frozen M1.1; consumers M1.4/M2.3) → `src/document/types.ts` (0031)
- Test-handover front-loading (--handover-test) → `src/testrun.ts` + `src/watch.ts` handleIdleTest + `src/exec-session.ts` + `src/git.ts` trackedSourceChanges (0023)
- Unified commit and the unit commit boundary → `src/git.ts` + `src/unit-commit.ts` + `src/artifact.ts` spec.unitStart (0021); interruption recovery and the unit-ownership gate → `src/resume.ts` + `src/resume-gate.ts` (0018; recovery fidelity OPENCODE_AUTO_STRICT_RESUME see 0022)
- Auto numbering (--auto-number) → `src/numbering.ts` (0001)
- Stuck-loop detection (OPENCODE_AUTO_STUCK) → `src/stuck.ts` (0016)
- Staged model routing and quota failover (OPENCODE_AUTO_MODEL/_FALLBACK//failback) → `src/switches.ts` parseModelPolicy + `src/chain.ts` + `src/session.ts` failover ring + `src/failback.ts` (0017)
- Session-failure wait-and-probe loop (OPENCODE_AUTO_RECOVERY_WAIT) → `src/session.ts` awaitRecovery (0015)
- Liveness probe, truncated-output resume, shape-check re-prompt fork → `src/watch.ts` + `src/session-api.ts` probeSession/forkEndedSession (0026)
- Cross-interruption cumulative stats → `src/stats.ts` + `src/conclusion.ts` + `src/loop-progress.ts` (0019)
- Question policy and proxy-answer audit (OPENCODE_AUTO_ASK, AUTO-RESOLVE/AUTO-DECISION) → `src/resolve.ts` + `templates/prompts/_partials.md` question-rule (0020)
- Shell profile → `src/shell.ts`
- Stable references, round directories (docs/R-NN), and reference checking → `src/docpaths.ts` + `src/refcheck.ts` (0010; refcheck scope narrowing see 0013)
- Module split and dependency direction (lower layers must not import runner; testrun must not import the session-driving layer) → 0024 §D.2; direction rules (incl. D8 domain boundaries) are enforced by `test/import-direction.test.ts` — a new cross-module import may require a conscious table edit there
- Full file inventory and mechanism details → docs/structure.md; the retired behavior contract (historical, not maintained) → plans/0029-behavior-historical.md

## Core invariants (read before changing)

Developing this program (code-level conventions):

- Parsing rule for the target directory `PLAN.md` (src/plan.ts): field lines (`  - key: value`) must immediately follow a task title and be contiguous; when changing the parse rule, sync `test/plan.test.ts` and the shell package's README format description.
- Runtime depends on an external `opencode` CLI (spawn `opencode serve`) or `--server` to reuse an existing instance; the binary itself does not bundle opencode.

Designing this program's features (behavior contract imposed on target directories; implementations must not break it):

- Exit codes: `0` complete / `1` usage or environment error / `2` blocked or reverted to pending for human attention / `130` force-quit by two consecutive Ctrl+C.
- Constitutional project attributes (-m/--agent/--context-limit/--subtask/--verify/--idle-time/--idle-max/--commit/--test-by-driver/--handover-test/--auto-number/--no-auto-number/--phases/--source-dir/--source-path/--dest-dir) are fixed into the target directory `.opencode/auto/config.json` by init only; appearing at run time is exit code 1; a bad config file fails strictly, unknown keys are ignored. **Committing cannot be turned off**: `--commit false` (and the old alias none) and config `commit: false` were retired on 2026-09-15 (plans/0021 D7); encountering them is a usage error / strict failure — committing is the completion condition, and the gates are inactive only under dryrun and in non-git environments.
- **driver-exclusive state writes**: the target directory's PLAN.md/CURRENT.md and the verified field are written only by the driver; AI sessions must not edit them; during `run` these state files are read-only (src/protect.ts lets the driver's writes through).
- **Unified commit**: AI sessions must not run commit-type commands; after a session ends the driver commits all changes recursively via src/git.ts (nested sub-repos first, then this repository). **Committing is the completion condition** (plans/0021): unified commit failure → block and halt for human attention; starting an execution unit (task/subtask/standalone hidden task) requires a clean worktree (PLAN.md/CURRENT.md leftovers self-heal, other dirty areas block for human; run start follows the same rule); close-out validates via the SHA baseline that the commit range contains only driver commits (Auto-Stage trailer); resumed runs are exempt from the clean check.
- Completion is never judged by agent self-report: with verify enabled, the driver runs the script and an independent judge session concludes; subtasks are ticked by the driver; a hidden task counts as done only when its artifacts are on disk and committed (③ commit / ④ dirty, git.ts commitPending/beginUnit).
- **Independent judge sessions are never forked**: verify-judge/review/review-fix/final sessions are created fresh and inherit no execution context (independent judgment is the cornerstone of completion decisions, see plans/0003 §9).
- **Experiment switches read the environment only, never persist to disk**: the `OPENCODE_AUTO_*` environment-variable layer (parsed inside the core in src/switches.ts, zero CLI shell changes) writes no state files; experiment semantics = this run only; constitutional keys do not enter ProjectConfig before promotion.

## Maintaining this document

Keep it lean: new mechanisms add one navigation line (with a plans/ pointer) or one invariant here; mechanism details go into a new numbered plans/ document; the three docs/ retained files are updated only with good reason.

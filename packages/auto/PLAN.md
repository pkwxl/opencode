# opencode-auto implementation plan

A non-interactive coding-agent driver: put an implementation plan into the target directory, and the driver
works through the tasks one by one, calling opencode serve to complete the development; when blocked it stops,
generates a problem description, and — after a human intervenes — resumes in a new session, until the whole
plan is complete.

The historical tasks (Phase 1..Phase 4, T-001..T-024) are all done; the originals are archived in
[packages/auto-core/plans/0007-plan-archive.md](../auto-core/plans/0007-plan-archive.md). The authoritative
documents for the behavior contract are this package's AGENTS.md and README.md. This file keeps only the
format contract and the current phase's tasks.

## Target PLAN.md format (what the driver parses; this file itself follows it)

One level-2 heading per task with the status marker at the end of the heading; the `blocked` section records
the question/answer history, and `verify` is the acceptance criterion:

```markdown
## T-NNN: task title [pending|in_progress|blocked|done]
  - verify: command: <acceptance command>   # the driver wraps it into a script and runs it itself; natural language is also allowed, which the bypass script-generation session translates into an executable script
  - verified: <command that ran and passed>    # written by the driver after verification passes, as the high-confidence completion record
  - final: <stage>@<round>      # the final-review stage marker written by the driver (T-F tasks appended by --final-review, stage ∈ audit|remediate|validate|finalize)
  - blocked-at: <date>          # written by the driver when blocked
  - question: "<the question it last got stuck on>"  # written by the driver when blocked
  - answer: "<human answer>"         # optional; after a block, just re-run to resume — no need to fill it in
  - attempts: <n>
Task description body (the core content injected into the decompose session prompt; the subtask checklist is produced by the decompose session and injected by the driver)
```

The driver state machine: `pending → in_progress → done | blocked`; on `blocked`, re-running the driver
re-enters `in_progress` (attempts + 1; no answer needed to be filled in — an optional answer is injected
into the context).
**PLAN.md and CURRENT.md are written by the driver alone**: agent sessions must not edit them; subtask ticks
are written by the driver from trusted evidence after the subtask session ends (acceptance happens uniformly
at the task level); `[done]` is written by the driver after task-level acceptance passes.
The current-task mirror lives in CURRENT.md (read by every session, resistant to context compaction), and
AGENTS.md holds only the fixed pointer block.

---

## Task list

## Phase 5: the -m/--mode mode layer and the --final-review final-review closed loop

Background: different scenarios (migration / optimization / new implementation / testing) weight the prompt
differently, so a lightweight mode layer is needed that does not touch the driver's scheduling state machine;
and the existing `--review` final review is only a single-session comprehensive review of the last task with
no repair loop — what is needed is a task-driven multi-phase final-review flow (Audit → Refactor/Patch →
Validate → Finalize; Validate can fall back to Audit, and an audit-round cap trips the breaker). The full
design is in packages/auto-core/plans/0005-mode-final-review-design.md (the single design baseline, holding
the confirmed decisions, the state machine and recovery rules, and the file-level change list; where older
wording conflicts with it, that document wins).

## T-025: the mode layer src/mode.ts and CLI wiring [done]
  - verify: command: bun typecheck && bun test
Implement the prompt-level mode layer per design document section A (V1 registers only migrate;
optimize/implement/test are reserved extension names — unregistered means unavailable):
- add src/mode.ts: the ModeSpec type (name / init / exec / final{audit, validate, finalize}, copy in
  Chinese); the MODES registry holds only migrate (the migration/upgrade scenario — init preamble:
  preserving external behavior is the premise, tasks laid out as "baseline confirmation → migration rework
  → regression verification", verify prefers reusing existing test/build commands; exec notes: behavior on
  par with the old implementation, the compatibility layer and the AUTO-DECISION marking requirement; the
  final stages' focus — audit on old/new behavior parity and leftover old paths, validate on regression
  coverage, finalize on old-implementation cleanup and compatibility-layer close-out);
  resolveMode(name) returns undefined for an unregistered name;
- index.ts: -m/--mode enters VALUE_FLAGS with the new short option -m (mirroring -p's value-swallowing
  rule); init and run both accept it, defaulting to migrate; an unregistered name is a usage error with
  exit code 1 (the message lists the currently supported modes), usage text updated; run passes it through
  via Opts, init -p passes it into renderInit;
- prompt.ts: renderInit gains the mode preamble section; the Opts of renderDecompose/renderSubtask/
  renderWrapup/renderWhole gain mode, injecting the exec section;
- runner.ts: Opts gains mode, passed through to the render calls above;
- add test/mode.test.ts (resolveMode hitting a registered name and returning undefined for an unregistered
  one); test/prompt.test.ts gains mode-injection assertions (renderInit contains the migrate preamble, the
  execution templates contain the exec section).
  Follow the package's AGENTS.md code style (Chinese comments, prefer Bun APIs, avoid any).

## T-026: final-review infrastructure plan.ts and prompt.ts [done]
  - verify: command: bun typecheck && bun test
Implement the data and prompt foundations of the final-review closed loop per design document sections
B.3/B.4 (depends on T-025):
- plan.ts: Task parsing gains the final field (generic FIELD-line parsing, preserved with all fields on an
  edit rewrite); add appendTask(path, task) — append a complete task block at the end of the file (heading
  line + field lines + body, atomic write, reusing edit's allowWrite/reprotect flow);
- prompt.ts: add renderFinalTask(plan, stage, round, prior, mode), the bypass generation-session template
  for the four stages audit/remediate/validate/finalize: the input is the upstream artifact pointers and the
  residual-gap text verbatim, the output a proposal docs/final/plan-<stage>-r<N>.md (`# heading`,
  self-contained body, optional `verify: command: <command>` line); constraints: plan only, never
  implement; verify prefers reusing the original task's verification command; never invent a check that has
  not been run; audit@r≥2 focuses on the residual gaps instead of a full re-review; inject the
  mode.final[stage] focus; reuse QUESTION_RULE/STATE_RULE; producing the proposal file is a hard
  requirement;
- test/plan.test.ts: appendTask append and re-parse round trip, the final field round trip, no regression
  of the existing cases;
- test/prompt.test.ts: the key renderFinalTask assertions (the proposal path, the stage-focus injection,
  the hard-requirement phrasing, the verify-command constraint wording).

## T-027: the final-review state machine src/final.ts and loop/runner wiring [done]
  - verify: command: bun typecheck && bun test
Implement the final-review closed loop's state machine and CLI per design document sections
B.1/B.2/B.5/B.6/C (depends on T-026):
- index.ts: --final-review enters VALUE_FLAGS, parseFinalReviewLimit mirrors parseReviewLimit's style
  (default 0 = disabled, bare option 2, an explicit value must be an integer 1..5 or a usage error with
  exit code 1), usage text updated;
- runner.ts: export requireArtifact and runSession (or an equivalent narrow wrapper) for the bypass
  generation sessions to reuse; audit/validate final-review tasks (by the final field) force review=0
  (--early naturally lapses with it), refactor/patch/finalize unchanged;
- add src/final.ts: pure state-machine routing functions — the final-review position is derived from (the
  tasks carrying the final marker and their states, the docs/final/ artifacts), with no new persisted
  state; parsing of the strategy line (refactor | patch | none) and the conclusion line (pass | gap
  <description>); appendFinalTask (T-F<k> numbered by append order, the `final: <stage>@<round>` field,
  audit/validate check the verify command with a fixed structure, remediate takes the proposal's verify
  line); audit-round counting and the breaker (block the last final-review task, question quotes the
  residual-gap text verbatim and the report pointer, exit code 2); the idempotent rebuild rules C.1..C.5
  (a proposal already produced but not appended is parsed and appended directly; the next stage's task
  already existing is not regenerated; a task done but its report missing is blocked with a note for a
  person to check);
- loop.ts: Opts passes finalReview through; after the main loop's runTask completes a task carrying the
  final marker, parse the report, route, and append the next task; when next() is empty and the final
  review is unfinished, start a generation session to continue the loop; the final-review start banner;
  final-review tasks keep the existing waitBetween/commit/exit-code semantics;
- add test/final.test.ts (the routing table: strategy none/refactor/patch, conclusion pass/gap, the
  breaker and round counting; idempotent appending of the proposal file; every branch of the state
  rebuild) — pure functions + fixture files, no server or network dependency.

## T-028: final-review documentation sync and wrap-up [done]
  - verify: command: bun typecheck && bun test
Close out P3 per design document section D (depends on T-027):
- test/e2e.test.ts: add CLI parsing cases (mirroring the existing style) — -m with an unregistered name
  exits 1, --final-review with an invalid value exits 1, --final-review combined with
  --review/--early-review produces no false report;
- README.md: the command table gains -m/--mode and --final-review [1-5] (semantics, the combination
  matrix, the breaker and exit codes); add a final-review closed-loop section (T-F tasks, docs/final/
  artifacts, audit/validate skipping the per-task review, and the existing explicit statement that
  final-review verify is still executed by the driver outside the permission system);
- the package's AGENTS.md: the structure section gains entries for src/mode.ts, src/final.ts and
  renderFinalTask; the behavior contract gains --mode and --final-review entries (the combination matrix,
  the breaker semantics, the V1 trade-off that modes do not persist);
- this file's "target PLAN.md format" comment line gains the final field description (the final-review
  stage marker written by the driver);
- read the two updated documents against the src/ implementation item by item — consistent, with no
  leftover contradictory wording.

---

## Notes

- e2e needs working provider credentials; CI without credentials may use a mock provider or the same test
  infrastructure as `opencode run` (see the existing tests in packages/opencode).
- After each phase completes, this file stays the system's dogfood sample: opencode-auto executes its own
  plan.

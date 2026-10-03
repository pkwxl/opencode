# PLAN.md Historical Task Archive (Phase 1..Phase 4)

> This file is the historical archive of packages/auto/PLAN.md (T-001..T-024, all completed), preserved verbatim for traceability.
> For current tasks and plans in progress see [PLAN.md](../PLAN.md); the authoritative documents for behavior conventions are the in-package AGENTS.md and README.md.
> Design baselines by phase: Phases 3/4 see [plans/0009-verify-review-design.md](./0009-verify-review-design.md);
> Phase 5 (--mode and --final-review) see [plans/0005-mode-final-review-design.md](./0005-mode-final-review-design.md).
> Root plans (ruled P-6, 2026-10-03): "root plans/" citations refer to the person's target-root corpus
> `plans/0001-0013` at the aseo target root — a numbering separate from this repository's `plans/NNNN`,
> never committed to the opencode repository.

---

# opencode-auto Implementation Plan

A non-interactive programming-Agent driver (driver): an implementation plan is placed into the target directory, and the driver calls
opencode serve task by task to complete the development; on hitting an obstacle it stops, generates a problem description, and after manual intervention resumes in a new session, until the plan is fully completed.

## Architecture Decisions (confirmed)

1. **Built on `opencode serve` + `@opencode-ai/sdk/v2`, with no changes to core**.
   - server spawn：`createOpencodeServer()`（`packages/sdk/js/src/v2/server.ts`）
   - client：`createOpencodeClient()`（`packages/sdk/js/src/v2/client.ts`）
   - event stream: `GET /event`; question: `GET /question`, `POST /question/{requestID}/reply|reject`;
     session：`POST /api/session`、`POST /api/session/{id}/prompt`、`POST /api/session/{id}/interrupt`
2. **One task = one brand-new session**, no context shared between sessions; the file system is the sole source of state.
3. **Non-permission questions are auto-answered; only re-asking the same question stops the run**: upon hearing `question.asked`, permission-related questions are immediately
   rejected + interrupted, the problem description is written, and the driver exits; non-permission questions are auto-answered by the driver with
     "你根据情况来自主决策如何做即可,..." (auto-reply text: "just decide autonomously as you see fit,...") and execution continues; only when asked the same question again is it handled as
   a block; once the human has finished handling it outside the session, simply restart the driver to resume -- no answer needs to be filled in (an optional answer may be filled in as supplementary explanation).
   If run with `--wait-answer [1-60]` (minutes; 1 when the flag is given without a value, and the default of 0 means immediate auto-answer),
   non-permission questions first wait on the command line for a human to type an answer (Enter to confirm); only on timeout with no response is the auto-answer sent.
4. **Completion is based on the Agent's own report**: verify is interpreted and executed by the AI; if execution passes, the actual command is written into the task's
   `verified` field as a high-confidence completion record (not recorded on failure or non-execution); a passing verification must also tick, in the task body,
   the corresponding verification checklist item (`- [ ]` → `- [x]`); the driver only, outside the session,
   re-parses the plan file to double-check the `[done]` marker and no longer re-runs the verify command; an idle task not marked done is still handled as
   an implicit blocked.
   (Note: this item was superseded by the Phase 3 three-stage verify; see plans/0009-verify-review-design.md; the original text is kept for traceability.)
5. The driver itself is developed as a new package `packages/auto` in this monorepo (Bun + TypeScript, following the root AGENTS.md
   and packages/opencode/AGENTS.md conventions; tests are run from the `packages/auto` directory, not at the repo root).

## Target PLAN.md Format (the driver's parse target; this file itself also follows it)

One second-level heading per task, the status marker at the end of the heading, the `blocked` section recording the Q&A history, and `verify` as the acceptance criterion:

```markdown
## T-NNN: task title [pending|in_progress|blocked|done]
  - verify: command: <acceptance command>   # wrapped into a script and executed by the driver itself; may also be natural language, translated into an executable script by a bypass script-generation session
  - verified: <command whose execution passed>    # written by the driver after verification passes, as a high-confidence completion record
  - blocked-at: <date>          # written by the driver when blocked
  - question: "<the question it got stuck on last time>"  # written by the driver when blocked
  - answer: "<manual resolution>"         # optional; after a block, simply rerun to resume -- no need to fill in
  - attempts: <n>
Task description body (the core content injected into the decompose-session prompt; subtask checklist items are produced by the decompose session and injected by the driver)
```

Driver state machine: `pending → in_progress → done | blocked`; `blocked` → rerunning the driver re-enters
`in_progress` (attempts + 1; no answer needs to be filled in, and an optional answer is injected into context).
**PLAN.md and CURRENT.md are written only by the driver**: agent sessions must not edit them; subtask ticks are applied by the driver as trusted after the subtask
session ends (acceptance is uniformly performed at the task level); `[done]` is written by the driver after task-level acceptance
passes.
The current-task mirror lives in CURRENT.md (must-read every session, resisting context compression); AGENTS.md contains only a fixed pointer block.

---

## Task List

## T-001: Initialize the packages/auto package skeleton [done]
  - verify: bun typecheck
Create `packages/auto`: package.json (depending on `@opencode-ai/sdk`), tsconfig, and the entry
`src/index.ts`（CLI：`opencode-auto run <dir>` / `opencode-auto status <dir>`）。
Follow the configuration style of the monorepo's existing packages (refer to packages/cli).

## T-002: Implement the PLAN.md parser and atomic write-back [done]
  - verify: bun test
`src/plan.ts`: parse task entries (ID, title, status, verify, blocked-section fields, body),
supporting status transitions and blocked-field writes; write-back uses a temp file + rename to guarantee atomicity.
Test coverage: all status transitions, Q&A text containing special characters, and duplicate-ID errors.

## T-003: Server lifecycle management [done]
  - verify: bun test
`src/server.ts`: prefer connecting to an existing `opencode serve` (liveness probe via health check); otherwise
`createOpencodeServer()` is spawned in the target directory; on driver exit it is reaped if the driver spawned it itself.

## T-004: Single-task session executor [done]
  - verify: bun test
`src/runner.ts`: render the prompt template (task body + plan summary + Q&A history + completion contract:
interpret and execute the verify acceptance criteria, record verified on pass, mark done, update docs, and git-commit all uncommitted changes
(including changes left behind by previously interrupted sessions, not limited to files modified in this session; subdirectories with their own .git are usually
ignored by the parent repo and must be actively located via the file system and committed first, with their paths and SHAs recorded in the parent commit message)),
create a new session, send the prompt, and consume the `GET /event` event stream until session idle / question.asked / error.
With `--new-session-subtask`, execution instead strictly runs one brand-new session per subtask: the driver extracts the
`- [ ]` checklist items from the task body and opens a new session per item (the prompt contains only that subtask; the session is required to tick the corresponding checklist item and end immediately,
doing no verify / done-marking / docs); after the session ends the driver re-reads PLAN.md to confirm the checklist item is ticked (an unticked one
is handled as an implicit blocked); after all subtasks are done, one wrap-up session runs the completion contract uniformly; tasks without checklist items
fall back to a single session. This caps the maximum single-session context size during task completion.

## T-005: Blocking Flow (explicit + implicit) [done]
  - verify: bun test
Explicit: permission-related `question.asked` → reject that question + interrupt the session → write the question and a summary of the most recent
assistant message into the PLAN.md blocked section → the driver halts with exit code 2. Non-permission questions are auto-answered by the driver
with an autonomy wording and execution continues; when the same question is asked again, the same blocked flow applies.
Implicit: session idle but the task not marked done → extract the last assistant message as the problem description and go through the same
blocked flow. Transient session errors (session.error, e.g. provider gateway errors) are first retried automatically in a new session
(3 attempts in total, i.e. 2 retries); only when retries are exhausted does the blocked flow apply.

## T-006: Completion Check and Doc Wrap-Up Confirmation [done]
  - verify: bun test
After session idle with the task already marked done: the driver re-parses PLAN.md from disk and double-checks the `[done]` marker -- that counts as completed;
verify is interpreted and executed by the agent itself; the driver no longer re-runs it externally. Only after passing is advancing to the next task allowed.

## T-007: Resume Scan and Main Loop [done]
  - verify: bun test
`src/loop.ts`: at startup, scan PLAN.md and take the first non-done task: pending → dispatch;
blocked → no answer required; directly open a new session to resume (attempts+1), with the prompt telling the agent that the problem has already been
resolved outside the session and must not be re-asked; when an optional answer is present, the Q&A history is injected. Advance serially until all are done (exit code 0).
Show the elapsed time when a task completes; with `--verbose`, every output line carries the current time, all message parts of the session are printed
(text, tool calls, reasoning, steps, etc.) plus the context usage/share of each assistant message, and every 10 seconds, by file modification
timestamp, files changed since the last check are listed (skipping node_modules and .git), making progress easy to observe.
With `--commit-subtask`, the prompt requires the agent to commit once per the commit rules each time it completes and ticks a subtask
checklist item (including nested .git sub-repos), achieving subtask-level change-history tracking; meanwhile the driver, every 30 seconds,
re-reads PLAN.md and prints the current task's subtask progress (done/total), elapsed time, and estimated remaining time (a linear projection
from completed subtasks; accuracy is limited by the check frequency).

## T-008: Target-Project Templates and Agent Contract [done]
  - verify: bun test
`templates/`: the target directory's `opencode.json` (permission allowlist rules) + agent configuration;
the system contract makes clear: (1) do only the current task; (2) permission problems must be reported via the question tool; non-permission problems are decided autonomously,
a question-tool call will be auto-answered, and only re-asking the same question blocks; (3) completion requires running verify, recording verified,
ticking the completed checklist items in the task body (including verification items), marking done, updating docs,
and git-committing all changes (ignored nested .git sub-repos are located via the file system and committed first, with their
paths and SHAs recorded in the parent commit message). A README explaining the manual-intervention flow is attached.

## T-009: End-to-End Acceptance [done]
  - verify: bun test test/e2e.test.ts
`test/fixture/`: a sample plan containing 3 tasks (one task is designed to necessarily trigger a question).
The whole flow runs through automatically: task 1 completes → task 2 blocks and halts → simulated manual intervention outside the session (no answer written) → restart to resume
→ task 3 completes → exit code 0, with PLAN.md all marked done and docs updated.

---

## Phase 2: The Three-Stage Pipeline with Driver-Exclusive State Writes

Background: retire the way of working where "the AI self-maintains PLAN.md status". Instead, the driver exclusively writes PLAN.md/CURRENT.md;
a task first goes through a decompose session producing `docs/T-NNN.subtasks.md` (each item carrying a verify command); after the driver injects the checklist items,
it schedules an independent session per subtask and personally executes the verify commands to decide ticks and [done]; the current task is mirrored to CURRENT.md
(the agent contract requires reading it every session, resisting context compression); the server stays resident without restarts (AGENTS.md/CURRENT.md are re-read live on every
provider turn; no server-level caching).

## T-010: plan.ts status-editing functions [done]
  - verify: command: bun test test/plan.test.ts
  - verified: bun test test/plan.test.ts
Add driver-side editing functions: `setSubtasks` (replace the body checklist with the decomposition result), `tick` (tick a specified checklist item),
`appendSubtask` (append a checklist item in a fix round), `markDone` (write the verified field and mark [done]; when there is no verified,
clear that field); add parsing helpers `subtaskVerify` (extract ``(verify: `cmd`)`` from checklist-item text) and
`verifyCommand` (the task-level `verify: command: <cmd>` prefix convention). edit() supports whole-body replacement.
Test coverage: injecting/replacing checklist items, ticking, appending, both markDone paths with and without verified, and command extraction.

## T-011: prompt.ts refactor into three session-template kinds [done]
  - verify: command: bun test test/prompt.test.ts
  - verified: bun test test/prompt.test.ts
Replace the existing templates: `renderDecompose` (read-only analysis; produces docs/T-NNN.subtasks.md, every item must carry a verify
command; modifying implementation code and state files is forbidden); `renderSubtask` (do one subtask + run that item's verify + commit per
commitSubtask; no longer ticks PLAN.md); `renderWrapup` (update docs, tidy up commits, write
docs/T-NNN.report.md, containing a `verified-command:` line and the final line `结论: 通过|差距` (verdict: pass|gap); no longer marks done).
Delete the whole-task template `render`. Question rules and commit rules remain unchanged.

## T-012: runner/loop pipeline and CURRENT.md [done]
  - verify: command: bun typecheck && bun test
  - verified: typecheck && bun test
runner.ts rewrites runTask: begin → if there are no checklist items, first run a decompose session and inject the checklist (missing decomposition output / no checklist items
is handled as blocked) → open an independent session per unticked subtask; after the session the driver personally executes that item's verify command
(on failure, first open one fix session; if it still fails, blocked; checklist items without a command are ticked as trusted) → once all are ticked, run the wrap-up
session, and the driver decides task-level acceptance (`command:` prefix executed directly; otherwise extract from report.md
`verified-command` and execute it; with no command at all, judge by the report's `结论` (verdict) line) → on pass, markDone completes the task; on gap,
appendSubtask appends fix subtasks, at most 3 rounds, and exhaustion means blocked. Delete confirmDone/confirmTick.
Add CURRENT.md writing (rewritten at task start and after every tick, containing the task's full content and a progress snapshot).
loop.ts removes the newSessionSubtask option. The server stays resident.

## T-013: CLI and template updates [done]
  - verify: command: bun run build && bun test
  - verified: bun run build && bun test
index.ts removes `--new-session-subtask` (the new pipeline becomes the default); `init` idempotently maintains the AGENTS.md pointer block
(delimited by `<!-- opencode-auto:start/end -->`, telling sessions to always read CURRENT.md and not to edit state files;
skip if already present, create if the file is missing). templates/PLAN.md updates the verify convention (`command:` prefix,
do not hand-write checklist items); templates/.opencode/agent/auto.md gets a rewritten working contract (read CURRENT.md first in every session,
state files read-only, question rules and commit rules retained).

## T-014: e2e full-flow acceptance [done]
  - verify: command: bun test test/e2e.test.ts
  - verified: bun test test/e2e.test.ts
Update test/e2e.test.ts: the fixture's verify fields switch to the `command:` prefix; the flow includes the decompose session, and the assertions are unchanged
(T-001 completes → T-002 blocks and halts → out-of-session intervention resumes the run → T-003 completes → exit code 0).

## T-015: Documentation wrap-up [done]
  - verify: command: bun typecheck
  - verified: bun typecheck
README.md and the in-package AGENTS.md sync the new behavior conventions: driver-exclusive PLAN.md/CURRENT.md writes, tiered verify
(command: executed by the driver; natural language translated by the wrap-up session), the CURRENT.md anti-compression mechanism, the resident server,
and the `--new-session-subtask` removal; the "Target PLAN.md Format" section of this file (PLAN.md) is updated in sync.

## T-016: Read-only protection of state files [done]
  - verify: command: bun test && bun typecheck
  - verified: bun test && bun typecheck
During `run`, the driver-exclusive files (PLAN.md, CURRENT.md, opencode.json, AGENTS.md) are chmod'ed read-only
(0o444), as defense-in-depth beyond the prompt contract; the driver's own writes (plan.ts edit, runner writing CURRENT.md)
temporarily restore writability and re-apply read-only immediately after writing; when `run` ends (including a blocked exit), a finally restores writability (0o644),
so manual intervention can edit normally. Add `src/protect.ts` (protect/unprotect/allowWrite/reprotect,
a module-level switch that is a no-op when not enabled, for compatibility with tests and standalone test scripts). README, the in-package AGENTS.md, and the agent-template
contract document this in sync (including the limitation: a same-user process can bypass it via bash chmod; it is positioned as an accidental-write guardrail, not a security boundary).

---

## Phase 3: Three-Stage Verify and the --review Review Loop

Background: verify adjudication currently happens entirely inside the review session; the AI running commands through the bash tool suffers output truncation (2000 characters),
which forces repeated reruns on large output; and there is a lack of an independent review of implementation fidelity and correctness beyond verify. This phase changes
verify into a "script preparation → driver execution → AI adjudication" three-stage design (zero output truncation, commands executed only once,
execution and adjudication separated), and adds the `--review` review loop (fidelity/correctness/verification-effectiveness review + a driver-driven
fix-subtask closed loop). The full design is in plans/0009-verify-review-design.md (the sole design baseline, containing confirmed decisions,
interface conventions, and pipeline pseudocode); the old behavior conventions of the in-package AGENTS.md and README will be rewritten uniformly in T-021;
until then, tasks always defer to the design document and this phase's task descriptions -- do not "correct" the implementation per the old conventions.

## T-017: verify script mechanism layer src/verify.ts [done]
  - verify: command: bun typecheck && bun test test/verify.test.ts
  - verified: bun typecheck && bun test test/verify.test.ts
Add src/verify.ts (pure logic, depending on neither the SDK nor the runner, independently unit-testable) and test/verify.test.ts,
implementing every interface of design doc A.1: verifyTmpDir (/tmp/<target-dir basename>, joined via os.tmpdir + basename);
resolveVerifyScript (three branches decided from verifyCommand: a single token that is an existing executable file
→ existing, used directly; an ordinary command line → wrapped, the driver wraps it as verify.sh -- first line
`#!/usr/bin/env bash`, the original command verbatim after it, no extra semantics such as set -e added, chmod 0o755, idempotent overwrite;
natural language or missing → generate); runVerifyScript (execute with cwd=target directory, spawn directly if the executable bit is set,
otherwise fall back to bash; stdout/stderr are written whole to verify.out/verify.err respectively, truncated before execution; returns
{ code, ms, timedOut, out, err }; VERIFY_TIMEOUT_MS defaults to 10 minutes, on timeout kill and record code
124). Test coverage: the three source branches (constructing executable files and various verify fields in a temp directory), wrapped content
(original command passed through, no extra semantics), execution-to-disk and exit codes, timeout kill (inject a small timeout + a sleep script,
without actually waiting 10 minutes). Follow the code style of the repo root and in-package AGENTS.md (Chinese comments, Bun APIs first, avoid
any and superfluous destructuring).

## T-018: verify/review prompt-template rework [done]
  - verify: command: bun typecheck && bun test test/prompt.test.ts
  - verified: bun typecheck && bun test test/prompt.test.ts
Rework src/prompt.ts per design doc A.2/A.3/B.3/B.4: add the export REVIEW_FILE = ".auto/review.md";
add renderVerifyScriptGen(plan, task, scriptPath) (bypass script-generation session: read-only analysis, write an executable script to the /tmp absolute path
passed by the runner according to the verify natural-language semantics / task acceptance criteria, and chmod
+x; verify only, do not modify the implementation; producing output is a hard requirement); add renderVerifyJudge(plan, task, run), replacing and
deleting renderVerify (inject the script path, exit code, duration, whether it timed out, out/err paths; require reading files directly,
reading large output in segments, reading code, and optionally re-running read-only checks; keep "脚本/命令本身问题不判不通过，说明原因
并用等价方式验证" (if the script/command itself is at fault, do not judge it as failed -- explain why and verify in an equivalent way); the verdict protocol is unchanged: .auto/verify.md, last line 结论: 通过|差距 (verdict: pass|gap), and verified-command: optionally standing
on its own line); add renderReview(plan, task, { final }) (review dimensions = fidelity +
correctness + comprehensiveness and effectiveness of the verification process; non-final is limited to this task's changes -- bounded via docs/T-NNN.report.md
and git log/status, with reviewing other tasks' code explicitly forbidden; final reviews the whole plan's design/implementation/docs
comprehensively and produces docs/T-NNN.audit.md (final: docs/final-audit.md), the verdict written as REVIEW_FILE's last line
结论: 通过|差距 (verdict: pass|gap); review only, no fixing -- except the report and verdict files); add renderReviewFix(plan, task,
gap) (produce single-step/multi-step fix checklist items from the review gaps into docs/T-NNN.fix.md, - [ ] self-contained descriptions; producing
output is a hard requirement). All reuse the existing QUESTION_RULE/STATE_RULE passages. Update test/prompt.test.ts:
remove the old renderVerify assertions, add key assertions for the four new templates (path and run-info injection, scope-limiting sentences,
final's two branches, the verdict protocol, hard-requirement phrasing).

## T-019: runner integration of the three-stage verify [done]
  - verify: command: bun typecheck && bun test
  - verified: bun typecheck && bun test
Rework src/runner.ts's verifyTask per design doc A.4/A.5 (depends on T-017/T-018; for the related old
behavior conventions in the in-package AGENTS.md, the design document prevails -- the doc update happens in T-021): resolveVerifyScript decides the
source; for generate, first open a bypass script-generation session (a one-shot chain, not entering the task execution chain; extract the skeleton of "verdict file
missing → retry once with feedback, still failing → silent block" from the existing review() into a generic helper reused by the generation and adjudication
sessions); runVerifyScript executes and logs a one-line result (exit code, duration, out/err paths); the bypass
adjudication session (renderVerifyJudge) + the existing parseVerdict to parse VERDICT_FILE; pass →
markDone(path, id, verdict.command ?? verifyCommand(task) ?? the actual script path); gap →
the existing renderFix repair loop is unchanged (FIX_ROUNDS=3), re-running the same script for adjudication after each fix round (V1 does not automatically
regenerate the script). Opts gains a review?: number field (CLI wiring in T-020). Session-chain reuse semantics,
dryrun, interactive, and permission-wait behavior are all unchanged.

## T-020: --review review loop, full chain [done]
  - verify: command: bun typecheck && bun test
  - verified: bun typecheck && bun test
Implement the review loop per design doc B (depends on T-019; AGENTS.md conventions are updated in T-021): index.ts adds
--review to VALUE_FLAGS and parseReviewLimit (default 0 = not enabled, bare option 3, an explicit value must be an
integer in 1..10 or it is a usage error with exit code 1); the usage text gains --review [1-10]; loop.ts passes opts.review
through to runTask; plan.ts adds appendSubtasks(path, id, items) (appending
- [ ] lines after the existing checklist block, or right after the body when there is no checklist) plus test/plan.test.ts cases; runner.ts restructures runTask into
an outer review-round loop -- the execution stage (ensureDecomposed/executeWhole) is entered only in the first round; each round =
per-checklist-item subtask sessions → wrap-up → verifyTask → (when opts.review>0) reviewTask: a bypass review
session renderReview (final is decided by "all tasks after the current one are done") produces the audit report, and the verdict is parsed from
REVIEW_FILE (reusing the adjudication retry strategy); pass → completed; gap → in off mode setStatus pending
and return incomplete (consistent with that mode's verify-failure semantics); in the other modes the round count is +1, and over the limit it returns
blocked (question = the full review-gap text); not over → the bypass fix-planning session renderReviewFix produces
docs/T-NNN.fix.md (retry-once strategy) → appendSubtasks injects it → CURRENT.md is refreshed → enter
the next round. Banner and log style match the existing ones.

## T-021: Documentation updates -- README and AGENTS.md [done]
  - verify: read the updated README.md and the in-package AGENTS.md through, checking them item by item against the src/ implementation: the options table includes --review [1-10] (off by default, bare option is 3), the three-stage verify (three script-preparation branches, driver execution, AI adjudication), /tmp/<target-dir basename>/ artifact paths plus the timeout and non-zero-exit-code semantics, the review loop (review dimensions, audit reports, the fix-subtask loop, the off-mode exception, comprehensive review of the last task), and no residual contradictory old-behavior wording (e.g. "driver 不亲自执行任何 verify 命令" -- "the driver does not personally execute any verify command")
Sync both documents with the implementation: README.md (the run options table gains --review; the "execution pipeline" common part is rewritten into
the three-stage verify; add a review-loop section; exit-code and /tmp artifact notes, and an explicit statement that driver-executed scripts do not go
through the permission system). The in-package AGENTS.md (the structure section gains entries for src/verify.ts and the docs design documents,
and updates the prompt/runner/plan/index entries; the behavior-conventions section wholly rewrites the verify entry and adds a --review entry,
checking the related exit-code/interaction/permission entries). templates/PLAN.md, templates/.opencode/agent/auto.md,
and the PLAN.md header's "Target PLAN.md Format" comment lines are checked, and anything affected by the behavior is updated in sync (expected to be comment lines only).

---

## Phase 4: --early parallel review

Background: the verify script-execution stage (runVerifyScript) is a purely local process containing no opencode session; moving
the --review review session into that window to execute in parallel saves roughly one review session of wall-clock time; the global
"at most one LLM session at any moment" invariant is preserved, with zero code changes inside the window (review only inspects and never fixes; gaps only produce a plan),
so no worktree is needed. The design baseline is section F of plans/0009-verify-review-design.md (the sole baseline, containing confirmed
decisions, pipeline pseudocode, and interface conventions).

## T-022: --early option parsing and review-prompt adaptation [done]
  - verify: command: bun typecheck && bun test
  - verified: bun typecheck && bun test
index.ts adds the --early boolean option (BOOLEAN_FLAGS) and the --early-review value option (VALUE_FLAGS,
syntactic sugar equivalent to --review n --early; bare option 3, explicit value 1..10 reusing the parseReviewLimit validation);
--early appearing alone (review not enabled) or --early-review appearing together with --review are both usage errors with
exit code 1; the usage text is updated. loop.ts passes early through into runTask's opts. prompt.ts renderReview
gains early-mode wording (per F.3: tell it that the verify script is executing in the same directory, and to prefer
reading files/git log, avoiding commands that could conflict; dimension 3 becomes a static review against the /tmp/<basename>/verify.sh script content
and the acceptance criteria -- interpreting run results belongs to the adjudication session). test/prompt.test.ts gains assertions for the new wording.

## T-023: runner parallel window and verdict merge [done]
  - verify: command: bun typecheck && bun test
  - verified: bun typecheck && bun test
Rework src/runner.ts per design doc F.2/F.5: verifyTask gains an optional review-hook parameter --
start the review session before runVerifyScript (a bypass one-shot chain, reusing reviewTask) and join before the adjudication session
(blocked propagates immediately); in the generate branch, the review starts only after the script-generation session ends; every script execution
(including fix-round reruns) reopens a fresh review; the return value is extended to { type: "done"; audit?: Verdict }.
runTask outer layer: when early and review>0, review runs in parallel via the hook and consumes the returned audit verdict (pass →
completed; gap → the existing review-gap flow: off mode pending, over-limit blocked, otherwise
planReviewFix → appendSubtasks → next round), no longer calling reviewTask standalone; non-early takes the original
path; round counting, off mode, and FIX_ROUNDS semantics are all unchanged. Banner and log style match the existing ones (the ⚖ review
banner prints when the window starts).

## T-024: Documentation sync -- README and AGENTS.md [done]
  - verify: read the updated README.md and the in-package AGENTS.md through, checking them item by item against the src/ implementation: the options table includes --early and --early-review [1-10] (semantics, mutual exclusion, and usage-error behavior), the parallel-window description (the review session runs in parallel with driver script execution, the adjudication session opens only after join, fix rounds reopen the review), the "at most one LLM session at any moment" invariant, and no worktree-related residue
Sync both documents with the implementation: README.md (the run options table; the "execution pipeline" review section rewritten as the parallel-window description;
a note on the global single-session invariant). The in-package AGENTS.md (structure-section entries checked; the behavior-conventions --review entry
gains the two early forms and the window-timing guarantee). templates/ and the PLAN.md header comments are checked (expected unchanged).
Section F of plans/0009-verify-review-design.md is revised as well if the implementation deviates.

---

## Notes

- e2e needs working provider credentials; in CI without credentials, T-009 permits a mock provider or the
  same test infrastructure as `opencode run` (refer to the existing packages/opencode tests).
- Once all tasks are complete, this file becomes the system's dogfood sample: opencode-auto executing its own plan.

<!-- auto: eof -->

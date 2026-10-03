# verify three-stage design and the --review review loop — design notes

> **Status (2026-10-02 correction, `plans/0069` §4.2 A4): the verify three-stage design and the `--review` review loop
> were both implemented (T-017..T-024 landed, including `--early` parallel review), then deleted wholesale by `plans/0044` (completion-side retirement,
> ruled 2026-09-21) — per its D1, `--verify`/`--review`/`--early`/`--early-review`
> are unconditionally usage errors (exit code 1) on all subcommands. This document is a historical design record; the original text below is preserved as-is.**

> This document is the sole design baseline for PLAN.md's third phase (T-017..T-021): the decomposition, execution, and review sessions all
> defer to this document. Old conventions in the package's AGENTS.md that conflict with it (e.g. "the driver never runs any verify
> command itself") will be rewritten uniformly in T-021; until then, do not "correct" code per the old conventions when implementing tasks.
> The fourth phase (T-022..T-024, --early parallel review) takes section F of this document as its sole design baseline.

## Background and motivation

1. **verify execution efficiency and stability**: task-level acceptance currently runs entirely inside a bypass review session, where the AI runs check commands through the bash
   tool and tool output gets truncated (2000 characters); with large outputs the AI repeatedly re-runs the same command,
   wasting context and time. After the change — the driver executes the script directly, output lands on disk, and the AI judges by only reading files — output has zero
   truncation, each command runs exactly once, and separating execution from judgment is more objective.
2. **No independent review of implementation quality**: verify only answers "are the acceptance criteria met", not "is the implementation faithful
   to the design/task description, are all cases handled, and is the verification process itself comprehensive and effective". The new `--review`
   review loop adds this layer and closes the loop with driver-driven fix subtasks.

## Confirmed decisions

| Decision point | Conclusion |
| --- | --- |
| verify artifact location | the `tmp/` subdirectory under the target directory: `tmp/{verify.sh, verify.out, verify.err}` (V2 revision: moved into the working directory from `/tmp/<目标目录基名>` (the target directory's basename), so sessions can read it directly and /tmp permission issues are avoided; run/init keeps it out of the repo via ensureGitignore; the sweep-commit rules are unchanged) |
| `--review` semantics | disabled by default; bare `--review` = 3 rounds; `--review n` must be an integer in 1..10, otherwise a usage error (exit code 1) |
| review failure under `--subtask off` | same behavior as a verify failure in that mode: fall back to `pending` and halt (exit code 2), no fix loop |
| Review-scope delineation | prompt-guided: the review session delineates this task's change scope itself from `docs/T-NNN.report.md` + git log/status, adding no new persisted state |

## A. verify three-stage design (script preparation → driver execution → AI judgment)

### A.1 Mechanism layer `src/verify.ts` (T-017)

Pure-logic module with no SDK or runner dependencies, independently unit-testable. Exports:

```ts
// tmp/ under the target directory (creation is not its responsibility; mkdir -p by the caller or inside this function are both fine)
verifyTmpDir(dir: string): string   // join(resolve(dir), "tmp")

export type VerifyScript =
  | { kind: "existing"; script: string }   // use the existing executable file directly
  | { kind: "wrapped"; script: string }    // the verify.sh the driver generates to wrap the command
  | { kind: "generate" }                   // a script must be produced by the AI generation session

resolveVerifyScript(task: Task, dir: string): Promise<VerifyScript>
runVerifyScript(dir: string, script: string, timeoutMs?: number):
  Promise<{ code: number; ms: number; timedOut: boolean; out: string; err: string }>
```

`resolveVerifyScript` resolution rules (`verifyCommand(task)` is an existing function in `src/plan.ts` that extracts
the `verify: command: <cmd>` prefix):

- **existing**: cmd is a single token (`/^\S+$/`), does not start with `-`, and exists as a path (relative to `dir` or
  absolute) and is executable (`X_OK`) → use that file directly. Examples: `./scripts/e2e.sh`, `/abs/check.sh`.
- **wrapped**: cmd exists but does not satisfy existing (e.g. `bun test`, `make check`) → the driver writes
  `verifyTmpDir/verify.sh`: first line `#!/usr/bin/env bash`, followed by the original command text verbatim, **adding no
  extra semantics such as `set -e`**, exit code passed through as-is; `chmod 0o755`. Regenerated on every verifyTask
  (idempotent overwrite; the verify field may have been edited by hand).
- **generate**: verify is natural language or missing → handed to the script-generation session (the script persists in tmp/ and is regenerated when
  missing; reused across fix rounds).

`runVerifyScript` execution semantics:

- `cwd` = the target directory; if the script is executable (has the execute bit), `spawn [script]` directly, otherwise
  `spawn ["bash", script]`;
- stdout written wholesale to `verify.out`, stderr wholesale to `verify.err` (truncate before each execution;
  Bun.spawn's stdout/stderr can connect directly to the write end of `Bun.file(path)`; if the version does not support that, pipe and
  stream-copy after the pipe);
- Timeout constant `VERIFY_TIMEOUT_MS = 10 分钟` (10 minutes; exported so tests can override it with a small value); on timeout `proc.kill()`,
  `code = 124`, `timedOut = true` (known limitation: grandchild process trees are not guaranteed to be cleaned up; accepted in V1);
- **A non-zero exit code is not directly judged a failure** — the judgment belongs to the AI, preserving the existing resilience that "a script that is itself broken or an
  unsuitable environment is not misjudged".

### A.2 Script-generation session `renderVerifyScriptGen(plan, task, scriptPath)` (T-018)

A fresh bypass session (not part of the task execution chain). It analyzes source and docs/ read-only and, per the natural-language semantics of the verify field
or the task's acceptance criteria, writes an executable script to the runner-provided `scriptPath` (an absolute path under tmp/) and
`chmod +x`s it. Constraints: verification-type operations only (running tests/checks, reading files); no implementation code is modified;
producing the file is mandatory (retry once with feedback if missing; if it still fails, a silent block — the same policy as the decomposition session/verdict file);
reuses QUESTION_RULE / STATE_RULE.

### A.3 Judge session `renderVerifyJudge(plan, task, run)` (T-018, replaces and deletes renderVerify)

A fresh bypass session. Prompt injection: script path, exit code, elapsed time, whether it timed out, absolute out/err paths.
Requirements: read the out/err files directly (large files in segments, never through tool truncation — the very point of this rework), read
the related code; when necessary it may re-run read-only checks itself; keep the rule "脚本/命令本身有问题不判不通过,说明原因并用等价方式验证"
(a script/command that is itself broken is not judged as failed — explain the reason and verify in an equivalent way). The verdict protocol is unchanged: write `.auto/verify.md` (VERDICT_FILE), last line
`结论: 通过` ("verdict: pass") or `结论: 差距 <描述>` ("verdict: gap <description>"); optionally `verified-command: <driver 实际执行的
脚本路径或原命令>` ("the script path or original command the driver actually executed"), on its own line.

### A.4 runner integration (T-019)

`verifyTask` new flow:

```
script = resolveVerifyScript(task, dir)
  └─ generate → open the script-generation session first (one-shot chain {pct:100, used:0}, not in the task chain;
                 artifact missing → retry once with feedback; still failing → silent block)
run = runVerifyScript(dir, script)        # log: exit code, elapsed, out/err paths
verdict = judge session (renderVerifyJudge) + parse VERDICT_FILE (reusing parseVerdict
           and the "retry once if missing" policy)
pass → markDone(path, id, verdict.command ?? verifyCommand(task) ?? actual script path)
gap  → existing renderFix repair loop unchanged (FIX_ROUNDS=3); after each fix round, re-run the same script and judge again
```

> **2026-09-07 note (stable-refs P4 reference gate)**: before the judge session, the driver first runs a deterministic pre-scan over the task's artifact documents
> (`docs/T-NNN/**`) (src/refcheck.ts taskRefFindings) — a dead reference =
> a gap, going straight into the renderFix repair loop above without consuming a judge session (off mode falls back to pending,
> exhaustion blocks with exit 2); when verify is not enabled there is no task-level acceptance and the gate does not exist (degenerating into the ⚠ log of
> commit-time auto-correct). The design baseline for the reference conventions and the three-layer check is in
> plans/0010-stable-refs-design.md §3.3/§4.5。

The "retry once with feedback when the verdict file is missing" skeleton in the existing `review()` can be extracted into a generic helper for the generation session
and the judge session to reuse. Session chaining, dryrun, interactive, and permission-wait behavior are all unaffected.

### A.5 The verified field

On pass, prefer the verdict file's `verified-command:` line, then `verifyCommand(task)` (the original command),
and finally the actually executed script path; on fail or non-execution it is cleared (status quo maintained).

## B. The --review review loop (T-020)

### B.1 Option semantics

`index.ts`: `--review` goes into VALUE_FLAGS; `parseReviewLimit`: default (no option) → 0, disabled;
bare option → 3; an explicit value must be an integer in 1..10, otherwise a usage error with exit code 1. Usage text updated in sync.

### B.2 Pipeline (runTask refactor)

```
runTask:
  begin; writeCurrent
  first round: [auto] ensureDecomposed / [off|ondemand] executeWhole (first round only; later rounds go straight into the checklist loop)
  for (reviewRound = 0; ; ):
    for each unchecked checklist item: runSubtask → tick → writeCurrent
    wrapup session
    verifyTask (three-stage, internal fix rounds ≤ 3; naturally reset after each review-fix round)
    if opts.review ≤ 0 → markDone done, return completed
    audit = reviewTask:
      final = all tasks after the current task done (or no successor)
      bypass review session renderReview(plan, task, { final })
      produces docs/T-NNN.audit.md (final: docs/final-audit.md)
      verdict written to .auto/review.md (REVIEW_FILE, protocol same as VERDICT_FILE, reusing the same parser)
    pass → completed
    gap:
      off mode → setStatus pending, return incomplete (same as a verify failure in that mode)
      reviewRound+1 > limit → blocked (question = full text of the review gap)
      otherwise → bypass fix-planning session renderReviewFix → docs/T-NNN.fix.md checklist items
             → plan.appendSubtasks injects into PLAN.md → writeCurrent refresh
             → continue outer loop (subtask sessions execute the items one by one → wrapup → verify → review again)
```

All state lives in PLAN.md, so an interrupted re-run resumes naturally; fix checklist items reuse the existing subtask-session mechanism, with no new execution path built.

### B.3 Review session `renderReview(plan, task, { final })` (T-018)

Review dimensions: **fidelity** (is the implementation aligned with the task description/design documents), **correctness** (are edge cases handled),
**comprehensiveness and effectiveness of the verification process** (do the verify script and verdict effectively cover the acceptance criteria).

- `final = false` (intermediate task): scope is **limited to this task's changes** — bounded by `docs/T-NNN.report.md`
  and git log/status (commits and working-tree state since the previous task completed); reviewing other
  tasks' code is explicitly forbidden;
- `final = true` (the last task): a comprehensive review of the design, implementation, and documentation across the
  whole plan's execution (reading through all PLAN.md tasks, the reports and design documents in docs/, and the overall git history);
- Produces the audit report `docs/T-NNN.audit.md` (for final, `docs/final-audit.md`); the verdict goes
  to REVIEW_FILE with last line `结论: 通过` ("verdict: pass") or `结论: 差距 <描述>` ("verdict: gap <description>");
- Review only, no modification: modifying any implementation code is forbidden (the audit report and verdict file excepted); reuses
  QUESTION_RULE / STATE_RULE。

### B.4 Fix-planning session `renderReviewFix(plan, task, gap)` (T-018)

A fresh bypass session. It takes the review gap (and the audit report path) as input and produces **single-step or multi-step** fix checklist items into
`docs/T-NNN.fix.md` (`- [ ]` self-contained descriptions, executable from the description + CURRENT.md + docs/ alone);
producing output is mandatory (retry once with feedback if missing; if it still fails, a silent block). The driver appends the checklist
items after the task body's existing checklist block via `plan.appendSubtasks(path, id, items)`
(at the end of the body when there is no checklist block), then refreshes CURRENT.md.

## C. File-level change list

| File | Change | Task |
| --- | --- | --- |
| `src/verify.ts` (new) | verifyTmpDir / resolveVerifyScript / runVerifyScript / VERIFY_TIMEOUT_MS | T-017 |
| `test/verify.test.ts` (new) | source three-way branch, wrapper contents, execution/exit code/out-err persistence, timeout kill | T-017 |
| `src/prompt.ts` | REVIEW_FILE; renderVerifyScriptGen / renderVerifyJudge (renderVerify removed) / renderReview / renderReviewFix | T-018 |
| `test/prompt.test.ts` | new template assertions, remove the old renderVerify assertions | T-018 |
| `src/runner.ts` | verifyTask three-stage; Opts.review field | T-019 |
| `src/index.ts` / `src/loop.ts` | --review parsing and pass-through, usage text | T-020 |
| `src/plan.ts` / `test/plan.test.ts` | appendSubtasks + test cases | T-020 |
| `src/runner.ts` | runTask outer review loop, reviewTask, fix injection, isFinal determination | T-020 |
| `README.md` / the package's `AGENTS.md` | option table, pipeline, behavior-convention rewrite | T-021 |

## D. Risks, boundaries, and known limitations

- **Permission system**: the driver executing verify scripts directly does not go through the opencode permission system — equivalent to a human running
  tests locally; the script source is the user's PLAN or a generation session constrained by the prompt, so this is positioned as a convenience trade-off, not a security
  boundary; the documentation must state this explicitly.
- **tmp/ location and cleanup**: artifacts live in the target directory's tmp/ (before V2 they lived in /tmp/<basename>/, shared by directories with the same basename); files are
  overwritten on every execution, scripts are reused across rounds, and if lost to a system reboot they are regenerated/wrapped per the rules — acceptable.
- **Windows**: cross-compiled artifacts need bash available (git bash); verify scripts assume a POSIX shell,
  noted in the documentation.
- **Timeout cleanup**: kill only kills the direct child; grandchild process trees are not guaranteed to be cleaned up (a known V1 limitation).
- **Script reuse policy (V1)**: an AI-generated script is generated once per task and reused across fix rounds; when the judge session finds
  the script insufficient it may re-run read-only checks itself, but the script is not regenerated automatically (evolution item: trigger regeneration when
  the verdict flags a script defect).
- **dogfood ordering**: while T-017..T-021 are being executed, the running driver is still the old version (modules already loaded in the process),
  so the old verify semantics run throughout this phase's execution, as expected; the new behavior takes effect from the next run.

## F. --early parallel review (T-022..T-024)

### F.1 Motivation and confirmed decisions

verify's script-execution stage (`runVerifyScript`, timeout cap of 10 minutes) is a purely local process containing no
opencode session; the `--review` review session used to be serialized after the whole of verify. `--early` moves the review
session into the script-execution window to run in parallel, saving roughly one review session of wall-clock time (the longer the script, the greater the gain; with short
scripts it degenerates to serial, no worse than the status quo).

| Decision point | Conclusion |
| --- | --- |
| Parallel window | only the stage where the driver executes the verify script; zero sessions on the verify side within the window |
| Global invariant | **at most one LLM session at any moment** (an axiom, recorded in this section; this section must be revised before any parallelization extension) |
| Code changes inside the window | zero: the review session reviews but does not modify (existing contract); a review gap only produces a fix plan, it does not execute fixes |
| worktree | not needed, dropped (no parallel code changes → no state fork, no merge back to the mainline, no second server) |
| Fix-round review | every script execution (including fix-round re-runs) reopens a fresh review; the review at pass time is strictly in sync with the passing code — **no second serialized review** |
| audit block propagation | if the window's join yields blocked, verifyTask returns blocked immediately (script output is already on disk, so the re-run semantics match the existing blocked) |

### F.2 Pipeline

```
Each round:
  per-checklist-item subtask sessions → wrapup session                    (unchanged)
  verifyTask:
    resolve script (existing/wrapped; generate opens the generation session first)   (unchanged)
    ── start review session (bypass one-shot chain, renderReview early wording) ──┐
    driver executes script (runVerifyScript)                            │ parallel window
    ── join review session → audit verdict (blocked propagates up immediately)   ─┘
    judge session (renderVerifyJudge) → VERDICT_FILE                (unchanged)
    pass → markDone, return {type:"done", audit} carrying the audit verdict
    gap → renderFix repair → wrapup → re-execute script ∥ reopen a new review → judge again
    off-mode gap / fix rounds exhausted → existing semantics unchanged
  verdict merge (runTask's outer layer consumes the audit brought back by verifyTask):
    verify pass + audit pass   → completed
    verify pass + audit gap   → existing review-gap flow (off→pending; over-limit→blocked;
                                 otherwise planReviewFix → appendSubtasks → next round)
    audit blocked                → blocked (see the table above)
    verify gap/off/exhausted    → existing semantics; the audit report stays in docs/ for human reference
```

Timing guarantees (the two landing points of the global single-session invariant):

1. **Start side**: the review starts only after the generate branch's script-generation session has ended (existing/wrapped have no preceding
   session and start directly in parallel with the script);
2. **Join side**: once script execution finishes, first join the review, then open the judge session — if the review is slower than a short script, the judge session
   waits; no overlap allowed.

### F.3 Review-session adaptation (renderReview early mode)

- The prompt tells it a verify script is executing in the same directory: avoid running commands that might conflict with it (concurrent test runs, etc.),
  favoring file reads / git log;
- Dimension 3 (verification-process effectiveness) becomes a **static review** against the script content and the acceptance criteria (the script file already exists at
  `tmp/verify.sh` before execution); interpreting run results is the judge session's responsibility;
- final determination, verdict protocol (REVIEW_FILE), and artifact retry policy (requireArtifact) are all unchanged.

### F.4 Option semantics

- `--review N --early`: combined mode; `--early` is a boolean modifier that requires review to be enabled — appearing alone
  is a usage error (exit code 1);
- `--early-review [n]`: syntactic sugar, equivalent to `--review n --early`; bare option means 3, explicit values 1..10
  (reusing the parseReviewLimit validation); appearing together with `--review` is a usage error (to remove ambiguity);
- Non-early (`--review N` alone) behavior is completely unchanged: the review still runs serialized after the whole verify passes;
- `--subtask off` / `--commit once|none` / `--interactive` gain no extra constraints (no worktree
  dependency); `--dryrun` never reaches verify, so early is naturally ineffective.

### F.5 runner interface contract

- `verifyTask` gains an optional hook-point parameter (a review thunk): started before `runVerifyScript`, joined before the judge
  session; reopened on every script execution (including fix rounds); the last audit returns with done;
- `verifyTask`'s return value is extended: `{ type: "done"; audit?: Verdict }` (omitted in non-early mode);
- `runTask`'s outer layer: under early it no longer calls reviewTask separately and consumes the audit brought back by verifyTask;
  non-early takes the original path; round counting, off mode, and FIX_ROUNDS semantics are all unchanged.

### F.6 Risks and boundaries

- In short-script scenarios where the review is slower than the script, the judge session waits; in the extreme, early's gain is zero, no worse than serial;
- If the review session re-runs read-only commands it may contend with the script for the environment (e.g. test caches): the F.3 prompt already constrains it to be read-mostly;
- Zero additions for interruption recovery: leftover `.auto/review.md` and audit reports are cleaned up by requireArtifact's reset()
  on the next run — no new persisted parallel state;
- `--interactive`: the only session inside the window is the review session, so attach is unambiguous.

## G. Judge-session execution restrictions and the re-verification protocol (later revision; this section prevails)

> This section revises A.3's judge-session conventions and the related prompts; where the older text conflicts ("必要时可自行补跑只读检查" ("when necessary it may re-run
> read-only checks itself") and "说明原因并用等价方式验证" ("explain the reason and verify in an equivalent way")), this section prevails. The other sections (A/B/F) are unchanged.

| Decision point | Conclusion |
| --- | --- |
| Judge-session execution rights | **directly executing any verification script or verification command is forbidden** (running tests, builds, lint, starting services, etc.); execution results are always taken from the out/err files the driver passes back; read-only checks (reading files, git log/status, grepping source) are unrestricted |
| Script-defect handling | the judge session may write a **new verification script to replace** the designated script (`tmp/verify.sh`, overwrite + chmod +x); the verdict file's last line is `结论: 重验 <原因>` ("verdict: re-verify <reason>") |
| Re-verification loop | the driver is permanently changed to execute that designated path (no longer re-resolved from the verify field — a wrapped re-wrap would overwrite the replacement artifact); output is written wholesale back to the same out/err pair, and a new judge session continues the judgment; at most REVERIFY_ROUNDS=3 rounds — exhaustion, or claiming a re-verify without writing out a script, is a silent block (blocked) |
| verified-command | when the verdict passes and the script was replaced, it may attach `verified-command: <新脚本核心命令>` ("the new script's core command"); markDone's value precedence is unchanged |
| Generation session | renderVerifyScriptGen is likewise forbidden from executing verification commands (read-only analysis + `bash -n`-style syntax checks excepted) |
| Review session | renderReview's two forms unify dimension 3 as a static review (script content/verdict records checked against the acceptance criteria), executing no verification scripts or commands; early additionally tells it the script executes in parallel and to stay read-mostly |
| Principle push-down | init appends a verification-principles block to AGENTS.md (own markers `opencode-auto:verify:start/end`, idempotent, no interference with the pointer block); the PLAN.md template and the renderInit prompt state explicitly "任务描述不要求执行者亲自运行验证命令/脚本" ("task descriptions do not require the executor to personally run verification commands/scripts"); `opencode-auto check` heuristically scans AGENTS.md/PLAN.md for descriptions that violate the principles and exits with code 1 on a hit (negations, driver-attribution sentences, PLAN field lines, and opencode-auto marker blocks do not count) |

## H. Interruption recovery, watchdog, and judge-session verify-field authorization (later revision; this section prevails)

> This section revises the conventions for session memory, the verify timeout, and the judge session's write permissions; older text that conflicts
> (the fixed 10-minute timeout, `.auto/session.json` recording only the session ID, state files being absolutely read-only)
> yields to this section.

| Decision point | Conclusion |
| --- | --- |
| Progress record | `.auto/progress.json` replaces session.json: `{task, session?, at, active, phase}`; the driver writes it at every phase boundary (active=false, the summary state), and while an execution-chain session is running, the attempt refreshes it to active=true (the mid-flight state); bypass one-shot sessions (judge/review/script generation/fix planning) do not write it, fixing the "bypass session pollutes execution-chain memory" defect; the old session.json is still read compatibly (treated as a mid-flight session with no phase) |
| phase | decompose / whole / subtasks / wrapup / verify{stage: generate\|exec\|judge\|fix, round, rechecks, replaced, gap?, run?, audit?} / review{round, stage: audit\|planfix\|fixrun}; when stage=fix, gap persists the verdict gap's original text, so an interrupted fix round resumes by re-issuing the fix prompt from it |
| In-session recovery | active and the session exists on the server → reuse the original session (**no time window**; isomorphic to `opencode -r <session-id>`: session history is persisted in the server's project storage, so sending a new prompt to the original session continues with the full context); otherwise a new session; in both cases the first prompt carries "[driver] 中断后的继续" ("[driver] continuation after interruption", giving next-step guidance per phase). **Handover file takes precedence**: during an active recovery, if a handover document already exists (ondemand `docs/<id>.handoff.md` or handover-test's `<id>[-S<n>].testhandoff.md`, counted whether left at the task level or any subtask level) → do not reuse the old session (context is exhausted, progress is carried by the handover document); open a new session and resume from the handover; when the handoff says `状态: 完成` ("status: complete"), skip the whole-task session outright. `--new-session` explicitly abandons the old session (skipping reuse only; precise phase re-entry is kept) and immediately flips the record to active=false (preventing the old session from misaligning with already-advanced phases after an interruption in a session-less phase) |
| SSE stream-break handling | the event stream exhausting without a session-end event (server failure/network drop) → abort the orphaned turn and treat it as a "session error" (taking the existing retry path and staying active for reuse), no longer misjudged as a normal session end that wrongly ticks off a subtask |
| Phase-level re-entry | verify has a persisted run → skip the script re-run and judge directly (under early, if audit is missing only the review is re-run); off/ondemand past the execution phase do not re-run executeWhole; review/planfix with a valid fix.md injects directly; tasks already marked done in the verify/review phase are set back to in_progress by loop for the make-up run; decompose reads subtasks.md directly first |
| Graceful exit | a non-completion ending (blocked/fallback to pending) writes an "interruption note" (reason/phase/how to resume) into CURRENT.md and keeps the file, with the record flipped to the summary state (no session reuse); CURRENT.md and the record are deleted only when the task completes; network-class blocked (session-error retries exhausted) keeps the active record (a mid-flight session cannot be summarized) |
| In-chain reuse interval | the reuse conditions gain, on top of pct<50 && used<contextLimit/2, "≤5 minutes since the previous session ended" (REUSE_IDLE_MS); reuse from restart recovery is exempt (the reuse decision was already made by the recovery determination, and chain.at resets to the current moment) |
| verify watchdog | the fixed 10-minute timeout is abolished: poll (default 5s) the verify.out/verify.err file sizes, resetting the idle timer whenever either grows; kill only after a continuous `--verify-idle` (default 10 minutes, 1..120) with no growth (exit code 124, timeoutReason=idle); `--verify-max` (unset by default, 1..1440) is the absolute-cap backstop (timeoutReason=max). As long as output keeps coming, run duration is unlimited |
| Judge-session write authorization | during the judge session, allowWrite(PLAN.md) temporarily; after it ends, reprotect and verify: a parse failure or any change to the task set/states/attempts/body → restore the pre-session snapshot and warn (unauthorized edits reverted wholesale); the prompt authorizes **updating only the verify fields of later unfinished (pending/blocked) tasks** (keeping the `command: ` single-line format), with no modification at all when the current script has no systemic defect; CURRENT.md is not unlocked (a pure mirror; anything written there would be overwritten) |
| Principle-block wording | the AGENTS.md verification-principles block (appended by init) gains the judge-session verify-field authorization exception; STATE_RULE changes to judge-specific wording for the judge session |

### H.1 Known trade-offs

- When recovering in the review/audit phase, if a review verdict already reached under early is interrupted before being consumed, the recovery
  reopens a review session (no persisted-verdict reuse; the window is extremely narrow and the cost is one session);
- Wording updates to the AGENTS.md verification-principles block take effect only for newly init'ed directories (the marker block is appended idempotently, never written back).

## E. Testing and verification

- Per-task verify: `bun typecheck` + the corresponding test files (see each task's verify field in PLAN.md);
- `test/verify.test.ts` depends on neither the opencode server nor the network; timeouts are verified by injecting a small timeout value;
- e2e (`OPENCODE_AUTO_E2E=1`, requires credentials) is an optional manual verification item: run three-stage verify and
  the `--review 1` loop once each, observing the `tmp/` artifacts, the audit report, and fix injection;
- After all tasks complete, `bun run build` as a smoke test to confirm the `type: "file"` template import is unaffected
  (expected unchanged).

<!-- auto: eof -->

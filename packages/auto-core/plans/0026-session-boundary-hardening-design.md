# Session boundary hardening: cross-task state-confusion protection, zero-persist completion adjudication, and an in-flight loss-of-contact probe

> Status: opened 2026-09-16; S1–S5 implemented (2026-09-17), S6–S8 pending (see the checklist in §5);
> 2026-09-18 revision (S9, see §8): output truncation (length) is not treated as a natural end, and the shape-check re-prompt forks the
> original session, carrying only the feedback.
> Origin: the kernel-dm T-068 S01 silent-session incident (2026-09-16 15:07 run, built from the old
> migrate@c9af64969 build), three layers stacked: ① the subtask session, during 22 minutes of read-only investigation, read in the prior task
> T-067's wrap-up narrative and misjudged "所有任务均已完成" (all tasks already completed), ending the turn with zero artifacts; ② runSubtask under
> steer=off applies "natural end means checked off", a misjudgment that could have advanced the pipeline directly; ③ a transport-layer half-open connection killed
> both the SSE and the synchronous prompt channels, leaving the driver hung for 44 minutes with no timeout coverage of any kind, until a manual Ctrl+C×2.
> Incident evidence: the target directory's `.auto/logs/run-2026-09-16_15-07-45.log` and
> `docs/T-067/audit/s10-session-integrity.md` (the T-067-side §J anchor misalignment was fixed by 2124cbab9
> and other commits and merged into the current build; it does not overlap with this plan).

## 1. Factual baseline (three-layer causality and evidence)

### 1.1 Semantic layer: three levels of navigation pushed the subtask session toward T-067's completion narrative

- The subtask description navigates directly: `subtasks.md:34` "模板 = 同目录 `r5-m-p5-verity-record.md`" (template = the same-directory `r5-m-p5-verity-record.md`).
  — P6 using P5's batch record as a format template is a legitimate need of the target directory's workflow.
- digest back-to-source pointers: `context.md:85/139/175/198`, 4 in total, point back to the T-067 report / handover duties / precedents.
- Shared-repo git log: recent commits are all T-067 wrap-up ("done / S10 收口 / 测试交接 #1 定版" — "S10 close-out / test handover #1 finalized"),
  which cannot be eliminated.
- Number collision amplifies it: T-067's subtasks S01–S10 and T-068's S01 share names, so "the prior task's S01–S10 are all checked"
  offers a literal shortcut to read it as "S01 already complete".
- The fork prefix itself was clean (the T-068 digest base was 12.8k, and context.md explicitly said the batch record "尚不存在,
  S01 建" — does not yet exist; S01 will create it) — the confusion came from reading it in mid-run, not from base pollution; the terminal message (per the opencode DB) was
  "所有任务均已完成" (all tasks already completed), with zero persisted output throughout.

Conclusion: **"fully banning navigation" conflicts with the single-source back-to-source design and is unachievable** (git log cannot be blocked). The correct goal is
to make the "prior task's completion narrative" impossible to read as "the current task's status", and to have the driver's adjudication layer catch it when a misreading does occur.

### 1.2 Adjudication layer: natural end = complete is the gap in the steer=off path

- `src/execute.ts:401`: `if (!handoverDue(steer, chain.used)) break` — under steer=off this is
  always false, so a session's natural end is unconditionally taken as subtask completion and checked off directly.
- `src/git.ts` commitPending returns `"clean"` without error on zero changes — zero persisted output likewise completes the check-off,
  and the misjudgment could have advanced to S02 (this time it never got that far because of the §1.3 hang).
- This leaves a validation gap on the subtask natural-end path versus commit-boundary-design's "completion adjudication = artifacts/state persisted and the
  unified commit succeeded".

### 1.3 Mechanical layer: a half-open connection killed both channels, with no timeout coverage at all

- At Ctrl+C, progress.json still pointed at the decompose session (at=15:36:29) → S01's synchronous
  prompt POST had not returned for 44 minutes (`src/attempt.ts:202` prompt → 215 remember → 217
  `await watching`; remember never ran, i.e. the POST never returned).
- On the SSE side there was no "event stream interrupted" log at any point (`src/watch.ts:497`, triggered only when the stream explicitly ends)
  → a half-open connection sends no FIN/RST, so the client never receives the end signal.
- DB evidence (provided by the user): the turn had already ended server-side and the terminal message was persisted → transport-layer half-open,
  not a server-side stall; TURN_TIMEOUT (2h) only backstops the POST, and SSE watching has no upper bound.
- Symptoms: heartbeats kept beating (0/12), /exit had no boundary to hook onto, and the only exit was Ctrl+C×2.
- The fix direction was revised from "reconcile after prompt returns" to a **periodic in-flight probe** — in the half-open scenario the prompt simply
  never returns; only a bypassing new connection can discover the truth.

## 2. Goals and non-goals

Goals:

1. The prior task's completion narrative cannot be read as the current task's status (semantic protection).
2. A session that ends naturally with zero persisted output must not advance the pipeline (adjudication hardening).
3. Half-open loss of contact is detected within the idleTime order of magnitude and handled automatically (mechanical backstop).

Non-goals:

- Do not ban cross-task navigation (single-source back-referencing + precedent templates are legitimate needs of the target directory's workflow).
- No hard read-permission isolation (it conflicts with single-source back-referencing, the SDK has no per-session permission injection, and it cannot block git log).
- Do not change the already-fixed mechanisms on the T-067 side §J; add no gradual-rollout switches (all three items are low-risk behavior hardening,
  aligned with the test-handover-early-design §F precedent of no gradual rollout, enabled by default).
- **No subtask-level semantic grading session** (the D4 trade-off, 2026-09-16): semantic completeness has no deterministic criterion,
  and the trustworthy mechanism is independent grading (the verify-judge precedent), but the session count and cost are disproportionate; the genuine gap — purely documentary artifacts
  with no test backstop — is carried by trade-off through indirect coverage by shape checks + task-level verify/review.

## 3. Decision table (confirmed 2026-09-16)

| # | Decision point | Conclusion |
|---|---|---|
| D1 | Navigation isolation combination | **L1 authoritative-state grounding + L2 digest writing discipline + L3 fully qualified numbering**; hard read-permission isolation rejected |
| D2 | Handling of a zero-persist natural end | **Re-prompt once with feedback** (the feedback restates the authoritative state and calls out the misjudgment directly); still zero artifacts → blocked and handed to a human; not enabled under dryrun/commit off; testHandover wrap-up exempted |
| D3 | Loss-of-contact probe | **Reuse idleTime (default 10min) as the period; 2 consecutive probe failures → adjudicate half-open → abort the turn + SSE close-out → go through the existing retryable session-error ladder** (automatically wired into the degradation loop); a successful probe resets the counter |
| D4 | Subtask artifact integrity check | **Expected-artifact-list shape check** (the subtasks.md `产出:` field structured — an output/artifact declaration; existence + non-trivial newly created .md / non-semantic last-line terminator + optional section list), reusing the D2 re-prompt→blocked loop; **no semantic grading session** — the semantic layer keeps task-level verify (code has the driver test backstop) and indirect review coverage |
| D5 | Auto-session artifact shape check | **Extended to the three document kinds whose paths the driver already knows: understand/decompose/wrapup** (context.md/subtasks.md/report.md): uniformly append non-trivial + last-line terminator checks, and wrapup gains the existence gate (currently zero validation); the same non-semantic terminator `<!-- auto: eof -->`, **not a `状态:` line** (a status declaration — avoids colliding with the resume contract's semantics and avoids stamping a "completed" label on cross-task narrative files like report) |
| D6 | Full-document terminator | **git-derived full scan**: at unit close, every .md in this unit's git changes (created or modified) must be non-trivial with last line = `<!-- auto: eof -->`; exempts driver-exclusive state files (PLAN.md/CURRENT.md/.auto/) and the handover-document family that carries its own terminal-state contract (handoff/testhandoff). Complements D4/D5 — existence catches "what should exist does not", the full scan catches "what was written was left unfinished" (including undeclared incidental documents). eof only proves "finished writing" (mechanically decidable); quality belongs to verify/review |

## 4. Implementation design

### 4.1 L1 authoritative-state grounding + L3 fully qualified numbering

- Landing points: prompt copy goes into `templates/prompts/` (a partial, or the subtask template header, keeping the
  `with { type: "file" }` import), and data assembly goes into `src/prompt.ts` renderSubtask.
- Each subtask session gets a state block injected, generated by the driver from the PLAN ledger:
  - the current task's id/title/status (in progress);
  - this subtask's **fully qualified number** (`T-068.S01`) and a checkbox snapshot (`S01☐ .. S12☐,已完成 0/12`, i.e. S01☐ .. S12☐, 0/12 completed);
  - a prior-task completion declaration: the queue's list of already-completed tasks + "独立任务,其收尾/完成信息与本任务
    进度无关;其文档仅可作格式/先例参考" (independent tasks whose wrap-up/completion information is unrelated to this task's progress; their documents may serve only as format/precedent reference).
- The presentation layer (PLAN.md) keeps the short S01 numbering; the fully qualified form goes into prompts only.

### 4.2 L2 digest writing discipline

- Landing point: the understand/decompose prompt templates (`templates/prompts/`).
- Rule: cross-task references may point only to **phase-level single sources** (adjudications/contracts/ledgers); referencing a prior **task-level wrap-up
  artifact** (report/batch record/testhandoff) must carry the qualifier "已完成另一任务的产物,仅作格式模板"
  (an artifact of another already-completed task, for use as a format template only); excerpt the key points instead of re-sourcing the whole document.

### 4.3 Zero-persist natural-end handling and artifact shape check (D2/D4)

- Landing points: the `src/execute.ts` runSubtask loop (before the break at line 401) + structured parsing of the subtasks.md `产出:`
  field (an output/artifact declaration) + `templates/prompts/subtask.md` (document last-line terminator discipline).
- When the session ends naturally (handoverDue not triggered), run the artifact shape check; any failure → re-prompt once with feedback
  (reusing the feedback/retried loop structure the ondemand handover already has); still failing → blocked
  ("子任务会话自然结束但产物形检未过" — subtask session ended naturally but the artifact shape check failed). Check items:
  1. **Zero persist**: commit enabled and the worktree has zero changes relative to unitBaseline;
  2. **Expected-artifact existence**: each subtasks.md item's `产出:` declaration is a structured list of paths
     (the driver hard-codes no workspace conventions such as index.md; the list comes from the declarations), checking existence path by path;
  3. **Non-trivial newly created .md + last-line terminator**: declared documents newly created in this unit must be ≥ a conservative threshold
     (set at implementation time) and the last, non-empty line = `<!-- auto: eof -->` (a non-semantic terminator — avoiding collision with
     the handoff/testhandoff `状态:` line semantics (a status declaration) and avoiding stamping a "completed" label on cross-task completion narratives);
  4. **Section list (optional)**: if required section headings are declared, check each one exists.
- The feedback copy restates the authoritative state (L1) and cites the failed items (missing files / suspected truncation), calling out the misjudgment directly.
- Exemptions: dryrun/commit off; the testHandover wrap-up session (its completion criterion is in testhandoff.md).

### 4.4 In-flight loss-of-contact probe (D3)

- Landing points: `src/watch.ts` (a probe timer hung off the watching main loop) + `src/attempt.ts` (wiring).
- While watching is in flight, issue a lightweight short-timeout query every idleTime minutes (a separate fetch connection; the endpoint
  is set at implementation time, e.g. a session-metadata GET); **2 consecutive** failures/timeouts → adjudicate half-open.
- Handling: log the probe failure details → `client.session.abort` (fault-tolerant) → release the SSE reader →
  return a **retryable session error** (going through the existing classifySessionError/transient classification, automatically wired into
  the retry ladder and degradation loop; a new-connection fork resumes, together with 4.1's grounding re-sending the authoritative state).
- A successful probe resets the counter; the normal idle/end paths clean up the timer (no leaks). Covers all AI sessions
  (wired at the attempt layer, including bypass sessions such as verify-judge).
- Detection principle: the probe uses a new connection, which a half-open old connection does not affect — this is precisely the basis for bypass detection;
  two consecutive failures rule out transient server jitter (GC pauses and the like).
- **2026-09-17 addendum (H7)**: when watch returns first with an error, abort the synchronous POST in coordination, racing the abort against the in-flight
  dispatch — a hung POST is invalidated immediately, the turn is closed out per watch's session error, and the retry ladder starts at the moment the probe
  adjudicates; TURN_TIMEOUT 2h is demoted to a pure backstop (no longer the actually-waited duration at a half-open scene).

### 4.5 Auto-session artifact shape check (D5)

- The artifact paths of the three auto-session kinds are fixed and known to the driver (context/subtasks built via taskDoc +
  resolveTaskDoc falling back to the old flat names; report fixed by the wrapup template as `docs/<taskId>/report.md`),
  so **no declaration list is needed**.
- Current asymmetry: ensureUnderstood/ensureDecomposed already have existence (+ non-empty) checks and a
  retry loop, lacking non-trivial + terminator; **after the wrapup session there is no artifact validation at all** (the runner.ts closing section
  commits directly via afterSession once runSession ends) — this section fills that in.
- Hardening: uniformly append non-trivial (conservative threshold) + last-line terminator checks for the three document kinds; wrapup first gains
  the existence check. Failure → same-shaped re-prompt once → blocked (understand/decompose wire into the existing
  retry loop; wrapup is new).
- **Check only the current session's output, no retroactive auditing of the existing stock**: the understand/decompose "skip if it already exists /
  inject directly" path semantics stay unchanged, and historical documents without terminators are unaffected — otherwise every legacy task would deadlock.
- Template landing point: the terminator discipline goes into a shared section of `templates/prompts/_partials.md`
  (shared by the understand/decompose variants/subtask/wrapup), avoiding per-template duplication.
- Leverage note: subtasks.md is the source of the D4 list, context.md is the digest base for all subtask sessions,
  and report.md is the carrier of cross-task wrap-up narratives (the target of L2 suppression) — truncation or hollow shells here directly
  amplify the incident surface.

### 4.6 Full-document terminator (D6)

- Rule: at unit close, take via the existing unitBaseline/changedFiles all files inside this unit's git changes,
  **all .md (created or modified)**, checking each file for non-trivial content + last line = `<!-- auto: eof -->`
  (non-empty line; the last line is authoritative).
- Exemption list (a named constant in code): `PLAN.md`/`CURRENT.md` (driver-exclusive state writes,
  the protect.ts domain), state files under `.auto/`, and `handoff.md`/`testhandoff-<n>.md`
  (which carry their own `状态:` terminal-state contract — a status declaration; semantics are not mixed).
- Complements D4/D5: the existence check (declaration list / fixed paths) catches "what should exist does not" — an uncreated
  file is invisible to the git scan; the full scan catches "what was written was left unfinished" — undeclared incidental documents
  (analyses the subtask wrote beyond the plan, whole-mode task documents) are likewise covered.
- Modifying existing documents: if a mid-run rewrite leaves eof off the last line, the check fails (detecting the truncation shape of "appended
  after the terminator"); the re-prompt feedback directs restoring the last-line terminator.
- Failure → re-prompt once → blocked, the same loop as D2/D4.

## 5. Implementation steps (checklist)

- [x] S1 L1 grounding block + L3 fully qualified numbering: templates/prompts copy + `src/prompt.ts` assembly + `test/prompt-exec.test.ts` assertions (implemented 2026-09-17: the copy is a new `ground-state` fragment in `_partials.md`, referenced from the `subtask.md` header; renderSubtask assembles the five variables taskTitle/taskStatusText/qualifiedId/subtaskSnapshot/doneIds — the snapshot `S01☑ S02☐ …,已完成 k/n` (S01☑ S02☐ …, k/n completed), fully qualified numbers zero-padded to two digits, prior done tasks inlined by id only without restating the head list; the fixtures groundPlan/groundTask reproduce the name-collision shape, and the assertions include 「他任务 S 编号与本任务无关」 (other tasks' S numbers are unrelated to this task) and 「S01☑ 不得出现」 (S01☑ must not appear))
- [x] S2 L2 digest discipline: understand/decompose templates + template tests (implemented 2026-09-17: the copy is a new `digest-rule` fragment in `_partials.md` — three disciplines (point only to phase-level single sources / wrap-up artifacts carry the 「已完成另一任务的产物,仅作格式模板」 qualifier — an artifact of another already-completed task, for use as a format template only / excerpting first, no whole-document re-sourcing) + a background line stating the consequences of misreading; understand.md and the decompose base + six phase variants (a/d/k/m/t/v), 8 templates in total, reference it between the artifact description and doc-layout; tests in `test/prompt-template.test.ts` — exactly 8 consumers, subtask/whole do not reference it, fragment-discipline assertions and no residue in full renders)
- [x] S3 zero persist + artifact shape check: structured parsing of the `产出:` field (an output/artifact declaration) + the shape check in `src/execute.ts` (existence / non-trivial / terminator / optional sections) + terminator discipline in `templates/prompts/subtask.md` + unit tests (zero persist → re-prompt → still zero → blocked; missing list / truncation → same loop; shape check all passing → normal check-off; dryrun/testHandover exempt) (implemented 2026-09-17: the parsing is `declaredArtifacts` in `src/plan.ts` (a lenient path-like criterion: counts as declared only if it contains `/` or carries an extension; a parenthesized optional section list, backticks stripped, separators inside parentheses do not cut paths); the deterministic criteria are centralized in the new leaf module `src/doccheck.ts` (`EOF_MARK`/`MIN_DOC_CHARS=120`/`endsWithEof`/`docShapeProblems`/`shapeCheckOn`); `src/git.ts` gains `unitQuiet` (HEAD not off the baseline + no dirty area = zero persist; a driver commit on the handover path already counts as non-zero) and `untrackedFiles` (porcelain ?? entries = newly created in this unit, consistent for nested repositories; gitStatusFiles refactored into statusEntries preserving XY); a runSubtask natural end now passes the shape check first, with its own retried counter separate from the handover-document feedback loop's, each capped at once, the blocked message containing all failed items, and the feedback restating the L1 authoritative state (fully qualified number + checkbox snapshot + 「不要据此判断本子任务已完成」 — do not treat this as evidence that this subtask is complete); the testHandover wrap-up exemption is kept explicitly via shapeCheckOn (runExecSession no longer surfaces testHandover results, the guard remains per design); on the template side `_partials.md` gains a shared `eof-rule` section, referenced from subtask.md (S3b extends it to understand/decompose/wrapup); tests `test/subtask-shape.test.ts` (the full runSubtask chain + a real git repository, 11 cases) + `test/plan.test.ts` 4 parsing cases + `test/prompt-template.test.ts` 3 eof-rule cases)
- [x] S3b auto-session shape check (D5): understand/decompose append non-trivial + terminator (wired into the existing retry loop), wrapup gains an existence + shape gate (the runner.ts closing section) + the `_partials.md` shared terminator-discipline section + unit tests (including the assertion that the "skip if it already exists" path is unaffected) (implemented 2026-09-17: understand/decompose append docShapeProblems inside the existing "existence + two retries" loop — content present but shape check failing and content missing get separate message cases, and the skip / direct-inject paths are unaffected; the two wrapup call sites (the runner main close-out + the review repair-round close-out) are consolidated into `runWrapup` in the new module `src/wrapup.ts` — report.md missing / empty / failing the shape check → retry once with feedback → still failing → blocked, and the gate blocks commit when it fails; on the template side the eof-rule shared section is extended to the understand/decompose base + six phase variants / wrapup (exactly 10 consumers); tests `test/auto-doc-shape.test.ts`, 9 cases (full chain in a real git repository: zero sessions on the skip path, truncation / hollow shell → re-prompt → corrected / still failing → blocked, the wrapup gate) + `test/prompt-template.test.ts` eof-rule consumer-list update)
- [x] S3c full-document terminator (D6): a changedFiles full .md shape check at unit close + an exemption list + unit tests (eof off the last line after modification → intercepted; exempt files unaffected; all passing → normal close-out) (implemented 2026-09-17: the input is the new `unitChangedFiles` in `src/git.ts` — tracked changes from baseline..worktree (`git diff <基线或空树> --diff-filter=d`, i.e. diff against the baseline or the empty tree; documents already committed via a handover during the unit are likewise in range, deletions excluded) + untracked new files, the empty set for an empty baseline; the exemption list is the named constant `EOF_SCAN_EXEMPT_NAMES` + `eofScanExempt` in `src/doccheck.ts` — PLAN.md/CURRENT.md judged by file name (under the round-based layout git reports the link target docs/R-NN/PLAN.md), .auto/ state files, and the handoff/testhandoff handover-document family (including archived copies testhandoff-<n>.md and the old flat names, carrying their own `状态:` terminal-state contract — a status declaration — so semantics are not mixed in); the scan wires into runSubtask's existing D2/D4 shape-check loop (subtaskArtifactProblems gains ⑤, deduplicated against the paths already checked by ③), re-prompt / re-prompt once → blocked sharing the same loop and feedback copy (the copy now says 「新建或修改的 Markdown 文档」 — newly created or modified Markdown documents — and directs restoring the last-line terminator); behavior change: modified (tracked) .md files are likewise required to be non-trivial with a last-line terminator from now on (at S3, modified declared artifacts were only checked for existence; the corresponding test case was rewritten as D6 intercept → corrected → check-off); tests `test/subtask-shape.test.ts` adds a D6 group of 4 cases (incidental-document truncation, appended after the terminator, the exempt family, documents already committed during the unit) + 2 unitChangedFiles cases + 1 eofScanExempt pure-function case, the full suite 820 pass)
- [x] S4 in-flight probe: `src/watch.ts` + `src/attempt.ts` + unit tests (two consecutive failures → retryable error; probe recovers → keep watching; timer cleanup) (implemented 2026-09-17: the probe body `probeSession` lands in `src/session-api.ts` — same family as sessionAlive, an independent short-timeout (30s, `PROBE_TIMEOUT_MS`) connection GET-ting session metadata, with timeout / exception / error response all counted as no-pass; on the watch side the event stream is wrapped in a trip-race iterator wrapper — when half-open the original stream's next() never resolves and a bare for-await gives the probe no way to take effect; the wrapper generator hangs only on yield, and finally cleans up with no delay (the half-open exit skips the inner return() to avoid queueing behind the hung next() and waiting forever; sse.abort() closes it out); the period `opts.idleMs ?? 10min` shares its key and default with the script watchdog; two consecutive failures adjudicate half-open → log the details → abort the session → retryable session error (the payload's network/timeout criteria classify it as transient, going through the existing retry ladder and degradation loop, no model switch), and a successful probe resets the counter; attempt starts watch before the prompt is dispatched, so the probe covers the POST in-flight window (a hung POST is still ultimately backstopped by TURN_TIMEOUT 2h), and the attempt wiring = when watching returns first with an error, sse.abort fires early to release the reader and the connection quota; all AI sessions get the same coverage via attempt→watch, including bypass sessions such as verify-judge; tests `test/watch-probe.test.ts`, 4 cases — two consecutive failures → transient retryable + abort, recovery after one failure → normal idle settlement without abort, no further probe after settlement (timer cleanup), and probeSession's four branches timeout / exception / error / normal; the existing watch.test.ts dispatch-failure case gains one macrotask yield before asserting stream close-out — the race wrapper makes the generator close out a few microtasks later, with no behavior change)
- [x] S5 the four prompt suites: `bun test test/prompt-exec.test.ts test/prompt-verify.test.ts test/prompt-phase.test.ts test/prompt-template.test.ts` (passed 2026-09-17: 4 files, 118 cases all green, 0 fail, 837 expects)
- [ ] S6 package-level verification: packages/auto-core `bun typecheck` + `bun test` all green; packages/auto typecheck unaffected
- [ ] S7 merge auto-core into the migrate branch to refresh snapshots and rebuild the binary
- [ ] S8 kernel-dm incident handling (manual): commit `docs/T-067/audit/` through the clean gate → re-run T-068 with the new build (discarding S01's zero-artifact output is harmless; the digest base is reused) → observe whether L1 grounding blocks the T-067 narrative misjudgment

## 6. Risks and rollback

- The grounding block is ~200 tokens per subtask session, negligible; ledger parsing reuses `src/plan.ts`.
- S3 false-positives on "legitimate zero-persist" subtasks: target-directory workflow subtasks all have artifacts (the commit-boundary
  design); if a legitimate zero-persist case does exist in the field, blocked-and-handed-to-a-human is the designed exit.
- Shape-check friction: a forgotten terminator or noisy list declarations trigger a re-prompt, capped at once, with a clear blocked exit;
  the existence check for modified (not newly created) artifacts is always true, harmless.
- The wrapup shape check is a new gate: existing workflows in which report went unwritten previously passed silently; after the upgrade they are explicitly
  blocked — this exposes an existing defect rather than false-positiving; the solo-mode template variants are equally covered.
- S4 misjudging half-open: only two consecutive failures (at idleTime spacing) trigger it; the cost of a misjudge = abort + fork resume, lossless;
  the interaction with OPENCODE_AUTO_HANDOVER_CONCURRENT=on (the test close-out catch) is verified at implementation time.
- Rollback: S1–S4 are mutually independent; any layer can be reverted alone.

## 7. Relationship to the existing mechanisms

- commit-boundary-design: 4.3 completes the "completion adjudication = persisted and committed" validation on the subtask natural-end
  path; the shape checks are all **deterministic criteria** (existence / size / last line / sections), and the completion criterion
  is still not agent self-reporting.
- test-handover-early-design §J (fixed, 2124cbab9): no overlap; the testHandover wrap-up
  session is explicitly exempted in 4.3.
- model-routing-design / failback: 4.4 loss-of-contact errors go through the existing retryable classification, automatically wired into the degradation
  loop, with no new switches and no new exit codes.
- config's idleTime: the semantics are extended to a shared period for "script watchdog + AI session probe"; the config key and
  default value (10min) are unchanged.

## 8. 2026-09-18 revision: output-truncation resume and the shape-check re-prompt forking the original session

> Origin: the kernel-spi-nor T-030 S13 incident (2026-09-18 01:29 run, auto-migrate) —
> the subtask session's reasoning stream was **truncated** by the output limit at `crate::spec::{SPINOR_OP_RDS`
> (step-finish reason=`length`); the server went idle as usual, and the driver misjudged the "still thinking normally"
> session as a natural end → caught by the zero-persist shape check → but the re-prompt **opened a blank session and re-sent the entire prompt**
> (OPENCODE_AUTO_REUSE_SESSION defaults to off); the new session started at 11.6k and re-read everything, while the original session's
> 133.9k context was discarded entirely. Same-shaped incident: T-029 S05 (2026-09-17 12:41, an incidental document missing
> its terminator was intercepted by D6 and likewise cold-restarted).

Two fixes, neither changing the adjudication criteria nor adding new switches:

1. **Output truncation is not a natural end (watch.ts)**: the final step-finish ending with `length` =
   the model's reply was truncated by the output limit and the session's work is clearly unfinished — before idle settlement, steer one line
   「从截断处继续」 (continue from the truncation point) so the **original session** carries on (not a single bit of context lost, no fork needed). Consecutive truncations
   are capped at `LENGTH_CONTINUE_MAX`=3 (guarding against the degenerate spin of a single overlong message); past the cap it is still closed out as a
   natural end and caught by the existing D2/D4 shape-check loop; a step finishing with something other than length (work returning to normal after
   resuming) resets the counter; if session.error has already been observed, do not resume — the error path
   (retryable ladder / degradation loop) takes precedence and does not contend with the truncation resume for the session. Covers all AI sessions going through attempt→watch
   (including bypass sessions such as verify-judge); ordering versus the test-execution protocol: idle first
   settles the test protocol (pending execution requests / handover demands), then comes truncation adjudication.
2. **The shape-check re-prompt forks the original session and carries only the feedback itself (session-api.ts adds
   `forkEndedSession`, wired into runSubtask's D2/D4/D6 shape-check loop and the understand/
   decompose/wrapup D5 retry loop)**: the re-prompt is dispatched on a fork of the just-ended session —
   the fork carries the full working context, so one line of feedback can continue the "half-done" scene; the original session stays
   untouched and remains the recovery point (the same philosophy as the retry ladder's "always fork a copy rather than reuse directly").
   If fork is unavailable (no session on the chain / session invalid / fork routing failed), fall back to a brand-new session + the full
   prompt + feedback (the pre-revision behavior). **The handover-document feedback loop is not in this scope**: when that loop triggers,
   the session has already used up 2×cap, and a fork would carry the near-limit prefix into the retry session, so the full re-send is kept.

Checklist (landed with this revision):

- [x] S9a watch.ts truncation resume + 4 unit-test cases (stop after resume ends normally / 4 consecutive truncations
  resume only 3 times / a non-length finish resets the counter / session.error does not resume) (test/watch.test.ts)
- [x] S9b forkEndedSession + runSubtask/ensureUnderstood/ensureDecomposed/
  runWrapup — four wiring points + unit tests (fork success carries only the feedback, fork failure falls back to the full prompt)
  (test/subtask-shape.test.ts、test/auto-doc-shape.test.ts)
- [x] S9c full regression: `bun typecheck` clean, `bun test` 874 all green, packages/auto
  typecheck unaffected

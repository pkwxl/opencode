> **Retired historical document (2026-09-19, M0.6 / D6 two-tier docs)**: moved verbatim from `docs/behavior.md` into `plans/` as a numbered plan-era record. It describes the runtime behavior contract imposed on target directories as of the auto-core era; much of it will change under the auto-next refactor (intent/phase/agent rework). **Not maintained — never aligned with later code changes.** When needed, distill still-valid content into fresh numbered plans/ documents as the migration progresses; new documents are written in English (D7). Originally preserved untranslated (historical record); translated to English 2026-10-03 with the plans/ corpus (protocol-string citations inside backticks keep their original Chinese spelling).

# Behavior Contract in Detail (routed from AGENTS.md)

> This file describes **the runtime behavior contract this program imposes on target directories** (PLAN.md/CURRENT.md/unified commits/verify etc. are all objects and mechanisms on the target-directory side); it is knowledge required for designing this program's features. AGENTS.md keeps only the high-frequency core invariants. The design baseline is in the design documents under docs/.

- Exit codes: `0` everything completed (in the phased flow = the ledger covers all `phases` phases), `1` usage/environment error
  (including the pre-run integrity check for a missing agent contract file, an invalid project config .opencode/auto/config.json, or
  an invalid phase ledger docs/phases.md or one that records letters outside `phases`), `2` blocked, or unfinished as pending, awaiting human intervention
  (blocking issues are written into PLAN.md; a pending rollback writes no field; includes a blocked phase-planning session and the --final-review final-review loop circuit-breaking),
  `3` /exit received under `--interactive`, already paused and exited at a safe boundary (no human intervention needed; re-running
  restores fully; see the /exit entry below and design document plans/0014-exit-resume-design.md),
  `130` force-terminated by two consecutive Ctrl+C presses (a single Ctrl+C only prints a notice; only the second press within the 3-second window exits,
  before exiting it best-effort restores file writability and shuts down the server).
- Project config persistence (src/config.ts, design documents plans/0004-init-config-agents-design.md and
  plans/0006-phases-design.md A.2): constitutional-level options
  -m/--agent/--context-limit/--subtask/--verify/--idle-time/--idle-max/--commit/--auto-number/--no-auto-number/--phases/--source-dir/--source-path/--dest-dir are accepted only by
  init (**init defaults to stateless full overwrite**: the output is decided solely by this invocation's arguments; keys not given fall back to
  CONFIG_DEFAULTS, and the optional keys source/destDir simply disappear -- the same init invocation yields identical output in any environment,
  a single run yields a deterministic state; `--amend` switches back to incremental-revision semantics, i.e. "only explicitly given keys are rewritten, the rest keep
  their existing values", and continue is always amend. Design document plans/0004-init-config-agents-design.md §B.1;
  the two source keys go as a pair; giving either overwrites the whole pair, and at init time it is validated that the path exists after
  <working directory>/join (stat follows symlinks -- source-dir may be a symlink pointing outside the working directory;
  a broken link is rejected as non-existent); all three migration keys must be relative paths without ..; dest-dir is persisted/revised independently,
  and its existence is not validated -- the migration destination lives at <working directory>/<dest-dir>, which isolates driver flow files from migration output;
  when the ledger is non-empty, phases must satisfy the prefix guardrail -- completed phases must form a prefix of **the value effective this time**, otherwise exit code 1
  with guidance to manually revise the ledger or switch to --amend; the guardrail judges the effective value, not "whether --phases was given explicitly"; otherwise a no-argument
  init would silently reset a phased project's phases to "m", destroying the round layout); these options appearing on run are a usage error with exit code 1
  (the message gives revision guidance; run likewise rejects --amend and -f/--force).
  When overwriting an existing config there are two accidental-touch gates, both ordered before the first write point -- intercept first, then ask; `-f/--force`
  skips both: ① workspace cleanliness (src/clean.ts, covering the repository containing the target directory and all nested
  repositories/submodules under the directory tree; non-git directories are treated as clean); ② interactive confirmation (src/confirm.ts; non-TTY passes through directly).
  The two do not override each other -- non-TTY only skips the question; the cleanliness intercept still applies to CI and scripts as usual.
  The manual revision channel is editing the config file directly; on bad JSON / out-of-range key values / unregistered mode, both run and init exit with
  code 1 (strict failure over silent fallback); unknown keys are ignored; the mode in the legacy .auto/config.json is read as fallback only when the new file
  is missing (run prints a notice); during run the config files are made read-only (brief.md is not among them; it is not a state file);
  status and the run startup banner print
  a one-line formatProjectConfig summary (including phases). The discriminator: changing it requires simultaneously changing AGENTS.md/PLAN/contract wording or
  describing model/project properties → init; only describing how this run runs and how a human monitors it → run.
- De-initialization (src/reset.ts, `reset` subcommand): the inverse of init; it precisely removes the config-layer artifacts init wrote,
  restoring the workspace to the uninitialized state. It cleans .opencode/auto/config.json and brief.md,
  .opencode/agent/auto.md, the legacy .auto/config.json, the opencode-auto marker block in AGENTS.md,
  the tmp/ and .auto/ entries in .gitignore, and the opencode.json whose **content is byte-identical to the template** (if it has been modified
  it is kept and the reason explained); PLAN.md, docs/ (including R-NN and T-NNN), the rest of .auto/ runtime state, and tmp/
  are all left untouched; directories are reclaimed via rmdir only when empty (never rm -r), so user-created .opencode/auto/prompts/
  and other agent contracts under .opencode/agent/ remain intact. Before executing it prints the full manifest, then passes the same gates as init:
  the cleanliness gate and interactive confirmation (reset is always destructive; the gates apply unconditionally). The output of init → reset → init
  is byte-identical to the first init; when there are no init artifacts at all it prints a notice and exits 0.
- init de-AI-ification (plans/0006-phases-design.md): init starts no AI session; `-p/--prompt` overwrites
  .opencode/auto/brief.md in full (project intent, versioned, human-editable, consumed by the phase-planning session; without -p the existing
  one is kept); the closing message has two states by phases ("m" keeps the current "编辑 PLAN.md" (edit PLAN.md) wording; the others prompt to start the first uncompleted
  phase planning); if phases contains v while verify is not enabled, init prints a note once (v and verify are orthogonal);
  when phases ≠ "m", PLAN.md is produced as an empty template (templates/PLAN.scaffold.md) and handed to the planning session.
- --auto-number/--no-auto-number (config.autoNumber, default true, --no-auto-number being the opt-out
  switch; a constitutional-level option, revised via init/continue, rejected by run; both switches present with neither carrying =false is a usage error;
  design document plans/0001-auto-number-design.md): when enabled, task numbers (T-NNN) **never repeat** in the target directory -- the next available
  number is persisted in .auto/next-task (its content is just one positive integer, maintained by the driver; .auto/ is already gitignored,
  so a fresh clone naturally lacks it). The sole consumer is the phase-planning session: planPhase first runs ensureNumbering to ensure the record
  is in place, injects the recorded value as the numbering start into the planning prompt (replacing the "自 T-001 起" (starting from T-001) wording), and collect validates that all
  task numbers are ≥ the start (reusing an occupied number counts as invalid output; retry once with feedback, and on continued failure a silent block with exit 2),
  after success the record advances to this run's max number + 1 (increases only, never decreases); phases = "m" has no planning session, so the switch has no
  effect (init prints a one-time ℹ notice for that combination). When the record is missing, recover first, then continue: a deterministic lower bound (the max number among existing
  PLAN.md / phase and round archive PLAN/docs artifact file names, + 1) of 1 (a brand-new project) means writing
  1 directly without opening a session; a bound greater than 1 opens a one-off bypass AI recovery session (template number-recovery.md) that reads through the archives
  and the git commit history to derive the next number and write it into the record (git history can discover numbers of deleted artifacts); the driver validates its
  output against the lower bound (below the bound is invalid; retry once, and on continued failure a silent block with exit 2); the recovery output is committed with the session via the unified
  commit (stage=numbering). T-F<k> final-review numbers are an independently derived namespace and do not participate in the auto-number record.
- Phase loop (config.phases ≠ "m", P1..P4 wired; design document plans/0006-phases-design.md sections D/E/F): phase
  state is derived; routePhase reads only the phase ledger (docs/R-NN/phases.md inside the round in the new layout, the root
  docs/phases.md in the old layout) and PLAN.md (zero newly persisted state),
  run loops on this -- PLAN.md is the empty template → open a phase-planning session (one-off bypass, reusing the requireArtifact
  skeleton, artifact = the filled-in PLAN.md; only this session is authorized via allowWrite to write PLAN.md; if blocked, exit 2;
  the session input injects brief, source, destDir, mode.init, and the pre-concatenated handover documents of all preceding phases as
  handovers -- handover documents live at the permanent path docs/handovers/R<N>-<letter>-<slug>.md (stable-refs
  P2); phases completed before P2 read-fall-back from within their own archive directories; distilled artifacts are the only cross-phase memory channel -- the preceding raw docs/ are not injected;
  a missing file is annotated "(无交接文档)" (no handover document)),
  unfinished tasks exist → take the existing main loop (decompose/execute/acceptance/review/unified commit/progress-recovery semantics unchanged;
  v-phase tasks are exempt from task-level acceptance and --review, see the next entry),
  all tasks of this phase done → handover (first open a distillation session producing a handover document at a permanent docs/handovers/ path
  -- the four-section protocol key decisions / constraints and pitfalls / must-read list for the next phase / artifact index; validHandover checks the title lines
  verbatim, a missing artifact retries once with feedback and on continued failure silently blocks with exit 2; then PLAN.md is copied into
  the archive directory (docs/R-NN/<letter>-<slug>/ inside the round in the new layout, docs/phases/<letter>-<slug>/ in the old layout;
  it collects only expired state files) → PLAN.md is reset to the empty template →
  the ledger append (the row protocol carries the handover pointer handovers/ path; old row shapes are tolerated) → unified commit
  stage=phase-transition; this phase's docs/ artifact documents are at permanent paths and are not moved by the handover);
  the ledger covers all letters of phases → exit 0. `--final-review` is hooked only in phase m (other phases
  print a one-time notice); AGENTS.md exceeding 150 lines gets only a note at handover, not rewritten.
- Phase k (P4, plans/0006-phases-design.md D.4; wholly takes over the --extract-knowledge of
  plans/0002-fixme-knowledge-design.md; that CLI option does not exist): the plan route (PLAN.md empty-template state) opens no
  planning session and does not fill PLAN.md; it goes straight into the knowledge-extraction bypass session (src/knowledge.ts
  extractKnowledge, requireArtifact skeleton) -- it reads through the phase ledger and every phase's handover documents
  (docs/handovers/ first), producing the permanent path
  docs/migration-kb/R<N>-migration-<timestamp>.md (the section skeleton / quality constraints are inlined in
  templates/prompts/knowledge.md, mode.exec injected as scenario background; not moved by handover / round archiving
  ); if a non-empty R<N>-prefixed .md already exists for this round (interrupted before handover), skip idempotently (earlier rounds' documents
  do not count as extracted this round; round 1, lacking prefixed stock, treats the read-fallback as this round's product); extraction failure (session blocked
  or two failures to produce) only prints a ⚠ warning and does not pollute the exit code; phase k hands over as usual -- migration success is not reversely polluted
  by document-generation failure; the knowledge document is committed with the session via the unified commit (stage=knowledge); when a human fills tasks into PLAN.md during phase k
  themselves, the generic execute/handover routes apply and the extraction hook does not fire; retrying extraction after the handover is complete
  = the manual rollback procedure (delete the ledger's k row and this round's R<N>-prefixed
  document inside docs/migration-kb/, then re-run).
- v-phase acceptance exemption (plans/0006-phases-design.md D.3): runTask, per the Opts.phase passed through by loop, when the current
  phase is v forces review=0 and skips the task-level three-stage acceptance (straight to markDone after wrap-up, writing no
  verified) -- it shares the same exemption code path with the final field of final-review tasks; an internal flag, writing no final
  field, and not polluting the PLAN.md protocol; when all v-phase tasks are done it hands over immediately, no circuit-break on acceptance gaps (D.3
  reserved an optional hook to parse the acceptance report's verdict before the handover route; not done in V1).
- Follow-up round migration (continue subcommand, plans/0006-phases-design.md section M; the 2026-09-08 round-dedicated-directory
  scheme): after the previous round's phased migration is fully complete (the ledger covers all existing letters of phases), a new round opens
  to continue migrating, aiming to make the migration result more complete and consistent with the source. continue = init's amend mechanism +
  establishRound creating the new round directory at round start (docs/R-NN/, built at round start, permanent once on disk -- PLAN.md/
  phases.md/AGENTS.md.bak/phase archives/handovers/phase-docs/migration-kb.md/
  prior-kb.md are all self-contained within the round; the root PLAN.md is rebuilt as a relative symlink pointing into the round; no on-site
  cleanup, no end-of-round moving -- archiveRound has been deleted); the previous round's conclusions (archive index + the final phase's
  handover document in full + the migration knowledge document in full: the new layout reads within the round; the old layout reads docs/migration-kb/'s
  R<N>-prefixed files and un-prefixed stock, plus migration-kb/ inside pre-P2 round archives, collected via read-fallback)
  are injected via prevRoundDigest into the new round's first phase-planning session; later phases take this round's handover
  distillation chain as usual. Migration-identity options (-m/--mode, --source-dir/--source-path/
  --dest-dir) are fixed across rounds; giving any explicitly at continue is exit code 1 (switching source/target/mode is not
  the continuation of the same migration); --phases/-p and the remaining execution options may be revised per round (--phases is not subject to the prefix guardrail
  constraint). Rounds are derived (docs/R-NN/ exists → current round = the largest R number; otherwise fall back to the old semantics
  of round-<N> max number + 1); the run/status phase-progress line carries
  the `第 N 轮` (round N) annotation (when round > 1); `--continue` is not an option -- appearing on init/run raises an error pointing to the
  continue subcommand; pre-check failures (non-phased project / empty ledger / missing phases / foreign letters present / new
  --phases being "m") all exit code 1 with guidance.
- A common root cause of task-dispatch failure (UnknownError) is the target directory missing `.opencode/agent/<agent>.md`
  (the server error body carries no root cause): the pre-run integrity check intercepts this case; when it happens mid-run the driver appends
  a recovery hint after the blocking issue (detection depends on Opts.dir, which run/init/dryrun must all pass in).
- Task document path contract (stable-refs P1, src/docpaths.ts as the single construction point): task documents appear only
  inside the task's own directory `docs/T-NNN/` (understanding summary context.md, decomposition checklist subtasks.md,
  wrap-up report report.md, review report audit.md, fix checklist fix.md, context handover handoff.md,
  task-level test handover testhandoff.md and its archived copy testhandoff-<n>.md); subtask artifacts
  `docs/T-NNN/S<两位序号>/index.md` (S + two-digit index), with subtask-level test handovers and archived copies in the same directory; final-review artifacts are anchored to the producing task's own
  `docs/T-F<k>/` (proposal plan-<stage>-r<N>.md and the audit-r/refactor-r/patch-r/
  validate-r/finalize reports); once created these paths are permanent. `--review`'s final-review
  audit shares the path with the task audit, docs/<taskId>/audit.md. **Read fallback**: old flat-layout projects
  (docs/<id>.<role>.md etc.) -- read sites prefer the new path and fall back to the old path when the new is missing but the old exists; write targets are always
  the new path; read fallback is kept permanently and the old flat layout stays in place (refcheck-scope-design D2 rejects the move-to-adapt
  approach: since 2026-09-08 run no longer migrates existing stock into directories; broken legacy references are recovered via git history,
  see plans/0013-refcheck-scope-design.md §4). **Permanence overview (stable-refs P2)**: documents under docs/
  (docs/T-*/, docs/handovers/, docs/migration-kb/, docs/prior-kb/) once created are
  never moved, never renamed -- since the round-dedicated-directory scheme (2026-09-08), one
  docs/R-NN/ per round (created at round start): phase handover produces handovers/<letter>-<slug>.md inside the round, referenced by the ledger row
  (handoverDoc, src/phases.ts); knowledge documents use the fixed in-round names migration-kb.md and
  prior-kb.md (docpaths.ts knowledgeDoc/priorKnowledgeDoc; the round directory always starts empty, forcing every new round
  to re-distill; for old-mechanism rounds (the ledger has completed phases but no this-round documents), the old flat un-prefixed stock is read as fallback;
  deliberate exception: the prior-knowledge-extraction intermediate temp-kb.md (same directory as the formal artifact) is not permanent -- the AI
  only writes it and closes out by marking "完成" (done) at the end; after the driver confirms, it is renamed to prior-kb.md and committed,
  the completion test = on disk and committed, see knowledge.ts extractPriorKnowledge);
  expired state such as phase PLAN snapshots is kept in the in-round <letter>-<slug>/ archive directory; state files are referenced by no
  document; the old layout (docs/handovers/R<N>-*.md, flat docs/migration-kb|prior-kb/,
  docs/phases/ and round-N/ archives) stays in place as read fallback; pre-P2 layouts (handovers inside the archive directory,
  knowledge without prefix) are each read-fallback compatible at the read sites.
 - Reference-consistency three layers (stable-refs P4, D6; design document plans/0010-stable-refs-design.md §3.3;
   **governed since 2026-09-08 by the experiment switch `OPENCODE_AUTO_REF_CHECK=on/off`, default off**
   -- when off all three layers' hooks no-op and the target directory sees zero reference-check behavior; the scope-reduction and restoration design is in
   plans/0013-refcheck-scope-design.md): the sole legal form a reference may take
  is a path relative to the target directory root (backticks or an md link; it may carry a `:行号` (line-number) anchor, and the anchor may in turn carry
  an `@<sha>` version marker); validation semantics = path exists + line number ≤ the file's total line count (references with an `@<sha>` marker
  are historical-snapshot references and check existence only, exempt from the line-number cap); when a direct path misses, a segment-boundary suffix finds the unique file in the target directory tree
  -- a contextual relative reference (written relative to the referrer's own directory) that hits uniquely counts as valid and is
  resolved to the matched file (especially helpful for non-docs references); no match or multiple matches (ambiguous context) counts as missing; references inside code fences
  and inline references carrying the 已删除/已归档/历史 (deleted/archived/historical) markers are exempt;
  URL/absolute-path/`~`/`./`/`../` forms and pure version-number tokens (e.g. `v1.2`) are not validated; an md link's
  `#fragment` is stripped before validation; directory references check existence only. Three layers: ① **auto-correct** -- before each unified commit
  (the runner's afterSession hook, covering all post-session commits) the driver first does git rename pairing
  (after `git add -A` staging, `git diff --cached --find-renames HEAD`; the staging is anyway the prelude to the next commit
   ) and mechanically rewrites live-document references (**only renames are paired; deletions/semantic changes are not auto-changed**); the rewrite does not touch
   layout -- only the hit path token is replaced in place; line structure/whitespace/alignment are preserved as-is), then it rescans
  findings and performs **missing-reference recovery** (refcheck-scope P2, confirm-broken first, recover after: a missing
  reference target is traced through the git-history rename map -- `git log --find-renames` of the target repo and its nested
  subrepositories, preferring the first new→old appearance and chain-resolving the final landing point -- ; if the landing point currently
  exists it is rewritten in place to recover (line-number anchors kept); if the landing point is deleted or never existed in history there is no auto-recovery (only
  move/rename-type breakage is recovered; deletions and semantic changes are left for manual correction), followed by a rescan); it then performs **scope reconfirmation**
  (refcheck-scope P3: for a reference with a `:N`/`:N-M` line anchor and no version marker, when its target file has uncommitted changes in its git
  repository, the same-range line slices of the HEAD version and the current version are compared -- identical: leave alone;
  different (an insufficient current line count counts as different): keep the original range and append an `@<sha>` version marker in place (sha =
  the owning repository's current HEAD short hash); semantics = the range is valid only for the marked historical version and is exempt from the line-number-cap
  validation; references already carrying a marker get no further append or update and are left for manual correction; nested subrepositories are judged individually, each pinned to its own
  repository's HEAD; followed by a rescan); it then maintains the invalid-reference list
  `.auto/invalid-refs.md` (registering only unrecovered broken references; key = `文件 → 路径(problem)` (file → path(problem)), fully
  rewritten each round -- auto-removed once fixed, recurrence counts as newly appeared): keys already registered get no more ⚠; warning logs are emitted only for newly appeared broken
  references (to prevent endless duplicate reporting; manual verification and correction enter via the list); rewrite content lands with this
  unified commit, no separate commit; auto-correct in a non-git directory
  no-ops (validation can still run). ② **check subcommand** -- beyond the principle checks it fully scans live documents
  (docs/**/*.md, excluding docs/phases/**; the docs/phases.md ledger counts as a live document); a broken-reference hit is
  exit code 1 (check is an explicit human/CI invocation; reports are not deduplicated against the list); a missing opencode-auto block in AGENTS.md and non-git directories
  (auto-correct unavailable) get a note. ③
  **verify gate** -- verifyTask does a deterministic pre-scan of the task artifact documents (docs/T-NNN/**,
  same for final-review tasks T-F<k>) before each verdict session; a broken reference = a gap, going straight into the fix round (no verdict session consumed;
  off mode falls back to pending, FIX_ROUNDS exhausted blocks with exit 2); when verify is not enabled the gate does not exist and it
  degrades to layer ①'s ⚠ logging (lenient contract). This norm is sunk via init: the reference-spec section inside the opencode-auto
  marker block of AGENTS.md (appears unconditionally -- path stability does not depend on any switch);
  the wrapup (report reference requirements)/verify-script-gen (root-relative paths inside scripts)/fix (broken references
  may be fixed by updating just the reference line) templates get matching injected prompt copy.
- Unified commits (revoking the AI's commit right): after any session ends and the driver has written its state, the driver, via
  commitTree in src/git.ts, recursively commits all changes (nested .git subrepositories first, then the repository containing the
  target directory; path discovery does not rely on git status -- nested repositories are usually ignored by the parent); git history is thus the audit trail of AI
  changes, with rollback granularity = one session. Commit message = the `任务编号 <label> <任务标题/子任务>` (task number <label> <task title/subtask>) short-label
   title line (label ∈ decompose/S<n>/exec/wrapup/fix<n>/judge/script/review/final/planfix/
   blocked/pending/done; pseudo-tasks use PLAN <label>:plan/handover/transition/knowledge/
   numbering/final-plan/doc-migrate/housekeeping/carryover/implement; subtask entries are `任务编号 S<n> <标题>` (task number S<n> <title>),
   omitting the task title) + the `Auto-Task`/
  `Auto-Stage` trailer (the target repository additionally records **all** nested repository paths and their final
  /latest SHAs via `Auto-Nested` -- a new SHA if this round committed there, the current HEAD if not; any root commit can align cross-repository
  state). Hook points:
   decomposition injection / subtask checkbox / whole task / fix round / wrap-up after the state write (the state write includes the CURRENT.md
   mirror refresh: decomposition injection and subtask checkbox refresh the mirror before committing); verdict/review/script-generation/
   fix-planning/final-review-planning and other bypass sessions after the session ends; task completion/blocking/pending rollback are committed by loop at the
   boundary (the interrupted scene is committed too, supporting rollback to the breakpoint); dryrun does not commit.
  **Committing is the completion condition (plans/0021-commit-boundary-design.md, 2026-09-14)**: for a task/subtask/hidden task
  (pseudo-task/bypass session), as long as it modified Git-tracked content, completion requires the unified commit to succeed -- commit failure
  always means **blocked halt (exit code 2) awaiting a human**, no longer a mere warning (commitTree reports the failure list to the
  caller); each execution unit (task/subtask/standalone hidden task) at startup goes through beginUnit for the
  **clean gate** (the worktree must be clean; all depended-on information is pinned by the previous commit; leftovers of the driver-exclusive
  state files PLAN.md/CURRENT.md are self-healed by a carryover make-up commit; other dirty areas block and go to a human
  -- run startup and each unit startup use the same rule, and the old semantics that "leftover worktree changes get absorbed by the next commit" is thereby
  abolished) and records a per-repository HEAD SHA baseline; at close-out unitViolations verifies: the worktree is clean and
  every commit in the baseline..HEAD range carries the `Auto-Stage` trailer (an external commit = an isolation breach, blocked);
  resumed runs (active progress record + session reuse/handover continuation) are exempt from the clean check -- the dirty worktree areas are
  the unit's own progress. The idempotent entry of standalone hidden tasks generalizes the ③④ protocol of prior-knowledge extraction: artifact already on disk
  but uncommitted → a make-up commit completes it (git.ts commitPending; knowledge/phase-handover are wired directly,
  phase-plan is covered by carryover self-healing, the final proposal by an append commit); artifact missing while the worktree is
  dirty → dirty block to a human (no state file written, no cleanup; the git decision belongs to the human; phase k's "extraction failure
  is only a warning" makes an exception for dirty). Startup make-up writes of the AGENTS.md pointer block/.gitignore are closed out by a housekeeping
  commit; final-review task appending and fix-checklist injection (driver state writes) each form their own commit. When the repository has no
  user.email configured, a fixed identity is the fallback. **Committing cannot be turned off (2026-09-15 retired `--commit false`)**:
  unified commit is the completion condition, and the unit clean gate / SHA baseline and the recovery-fidelity rollback anchors all presuppose "commit always on";
  an off setting conflicts with that -- `--commit false` (and the legacy alias `none`) appearing is a usage error, exit 1;
  an existing `.opencode/auto/config.json` containing `commit: false` strictly fails as a bad file (please delete that key
  or set it to true); `--commit true` can still be written and equals the default. The gate hereafter fails to apply only in dryrun and non-git environments
  (the code-side `opts.commit` branch remains for now, permanently unreachable; cleanup is a separate task; the old four settings subtask/task/once
  and the alias --commit-subtask were long removed; appearing is a usage error). This execution-right principle is sunk via init:
  the AGENTS.md commit-principle block, the agent contract and state-rule fragments; the `check` subcommand likewise
  scans for descriptions violating this principle.
- subtask three settings (config.subtask, revised via init --subtask): `auto` (default; decomposition session → subtask by subtask,
  subtask sessions likewise carry the handoff-steer handover -- when usage reaches twice the configured contextLimit, the steer handover
   prompt is steered; the session writes docs/<id>/handoff.md (last line `状态: 继续|完成` (status: continue|done), counted by whether that subtask completed),
  the new session continues from the handover, and the driver deletes the file once the subtask completes) /
  `off` (the entire task is completed in a single session;
  acceptance gaps get no fix rerun -- the task rolls back to pending awaiting human improvement) / `ondemand` (single-session execution,
  watch steers a handover prompt into the in-flight session when usage reaches twice the configured contextLimit -- once per session,
  the v2 prompt defaults to steer; at session end, the last line `状态: 继续|完成` of docs/<id>/handoff.md
  decides continuation versus wrap-up; a missing file retries once with feedback and is then treated as a silent block). Mid-run switching: tasks with checklists already injected
  keep resuming from the checkbox state as before (progress follows the task record); new tasks run under the new setting; the README notes this is not recommended.
- --dryrun: runs only one permission pre-check session (listing out-of-scope directories/operations and probing each read-only); inside that session
  permission requests are auto-denied without interruption (so the AI can record blocked items) and questions are all auto-answered; the report is written to
  .auto/dryrun.md and printed; no task is executed.
- Question auto-answering (question.asked) and proxy-answer auditing (OPENCODE_AUTO_ASK, default off; design document
  plans/0020-auto-resolve-design.md): non-permission questions are auto-answered by autoAnswer(ask); both settings' copy makes clear
  "这是一个被代答的提问" ("this is a proxy-answered question"); under --wait-answer it first waits for a human stdin reply, falling back to the auto answer on timeout;
  with --wait-answer unset, permission-class questions (the question tool) block directly; a repeated identical question still blocks
  with a halt. Decision markers come in two classes; the criterion is **who should rightfully own this decision point** -- owned by the user (requirement intent
  and scope trade-offs, changes to externally visible behavior and interface contracts, the criteria for "what counts as done", fact-confirmation questions,
  going beyond or narrowing the task description's literal scope) → `AUTO-RESOLVE: <原问题> -> <所选方案> (<理由>)` (original question -> chosen option (reason));
  owned by the AI (choice of implementation means, where no option changes user-visible behavior) →
  `AUTO-DECISION: <决策> (<理由>)` (decision (reason)); one decision gets exactly one class; when unsure, mark AUTO-RESOLVE. The questioning strategy
  has two settings switched by OPENCODE_AUTO_ASK, with the questioning duty and the marking duty advancing and retreating together: off (default, rendering byte-for-byte
  identical to before the rework) suppresses non-permission questions and forces both marker classes; on makes decision points owned by the user proactively call the question
  tool, while purely-implementation choices are decided autonomously with **no marking required at all** (the driver already fully records on the event side). The driver
  collects on two paths: ① question.asked's fallback auto answers go into the round's `resolves[]` (carried out via 7 snapshot
  exits; genuine human answers and the dryrun pre-check session are excluded); ② at session close it scans this run's uncommitted changed files for
  the two classes of marker lines (the scan is hooked before the early return of a closed commit gate (dryrun, and the retired `--commit false`)
  -- collection is auditing and must not be affected by the commit switch); the two sources are paired via sameIssue, and at display time paired driver items yield to the more informative
  agent item; unpaired ones are named with a ⚠ "会话未按要求标注" (the session did not mark as required). AUTO-RESOLVE is displayed pinned at the top with `⚑` in the task three-state line, at
  phase closing, and before round completion (task-level one per entry, cap of 8 entries, each entry squeezed to a single line truncated at 80 characters;
  phase/round give counts only); AUTO-DECISION is folded into a single count (folded into the highlight block's last line when proxy answers exist, otherwise
  vlog only), and phase/round summaries do not show it at all. The wrap-up session gets the driver-observed proxy-answer list injected (listing only
  driver source, unpaired ones first, untruncated), requiring docs/T-NNN/report.md to carry a dedicated "自动代答问题"
  (auto-answered questions) section -- the persistent audit trail is the marker lines that enter git plus that section; the ledger is only the driver's counting and highlighting basis.
- Infinite-loop detection (OPENCODE_AUTO_STUCK, default on; design document plans/0016-stuck-loop-design.md):
  weak models often repeat the same action the same way many times in a row without ever succeeding and cannot escape on their own; the driver,
  from watch, observes tool-call terminal states, with two session-level criteria -- same tool + same error (**parameters excluded**,
  parameter tweaks still hit the same pit) totaling 3 times, or same tool + same parameters + identical output totaling
  4 times (an identical result = no new information); any change in the result always counts as progress and is not counted, and consecutiveness is not
  required (alternating retries are recognized too). On a hit, a hint is steered into that session via promptAsync (taking effect at the next
  provider turn boundary), escalating level by level: ① lay out the evidence + re-check premises + switch approach →
  ② require writing down "目标/已试过什么/下一步换什么" (goal / what has been tried / what to switch to next) before acting again → ③ stop retrying; use
  `AUTO-FIXME: <原因与计划>` (cause and plan) to mark the leftover, report progress, and end the session. At most three times per session; after a hit
  that signature's counter resets to zero (a full new round of hits is needed before the next hint); after the cap is reached, silence. **Hint only, never halt** -- it does not abort
  the session, change verdicts, or write state files (the criteria can misjudge, and the cost of halting far exceeds one surplus hint;
  the third level hands the wrap-up decision back to the AI, taken over by the existing pipeline); a failed steer delivery only logs.
  The dryrun pre-check session is never checked (being repeatedly denied while probing permissions is its normal shape).
- Phased model routing and quota demotion (OPENCODE_AUTO_MODEL / OPENCODE_AUTO_MODEL_FALLBACK, defaults
  both unset = byte-identical to the status quo; design document plans/0017-model-routing-design.md): the experiment-switch layer, per
  "(phase letter, session role) → model", attaches `model` to each individual prompt -- the sole injection point is at attempt's
  `client.session.prompt`; when it evaluates to undefined, **no model key is attached** (rather than attaching `model: undefined`);
  the per-prompt model has the highest priority and is written back to the session table for reuse later in the chain, so opencode.json is not changed, agent contracts are not split
  per phase, and the server is not restarted. OPENCODE_AUTO_MODEL has two forms: a bare value `prov/model` (equivalent to the `*=prov/model`
  full overwrite), or an entry table of comma-separated `键=prov/model` (key=prov/model) entries (the in-entry separator is `=` not `:`, because model ids may contain
  colons; the value must contain `/`, otherwise a Chinese error message and exit code 1); keys ∈ `*` ∪ phase letters `admtvk` ∪ the role vocabulary. Role sources:
  execution chains derive from `chain.phase` (understand/decompose/whole/subtask/wrapup/verify-{generate,exec,
  judge,fix}/review-{audit,planfix,fixrun}/phase-plan/phase-handover); one-off bypass sessions follow
  requireArtifact's `spec.role` (verify-judge/verify-generate/review-audit/review-planfix/
  final-plan/knowledge/prior-knowledge/implement-scan/number-recovery, or `bypass` when unset); evaluation
  priority is **role > letter > `*`** (resolveModel). OPENCODE_AUTO_MODEL_FALLBACK is an ordered candidate list
  `prov/a,prov/b`; the default, empty, = no demotion. Quota demotion: three watch trigger surfaces classify session errors
  (classifySessionError → quota/auth/rate/overflow/transient/unknown; the criterion asks "would switching models help"
  rather than "would retrying help", deliberately different from opencode's own retry classification; when unsure, unknown -- conservatively no switch;
  overflow explicitly does not switch, deferring to the handover mechanism) -- ① the structured fields of session.error (message/statusCode/isRetryable/
  responseBody); ② the retry part of message.part.updated (carrying attempt and ApiError); ③ session.status's
  retry variants (carrying attempt and next, the next wait duration); a quota/auth/rate hit demotes immediately: take the ordered candidate list's next
  candidate into `chain.model`, reusing the existing fork-copy path to continue (session.fork moves only the messages; the prompt-level model override
  covers it, so **the context travels along, nothing needs redoing**); **`session.abort` is called before demoting** to prevent a server-side orphan turn and the fork copy from
  concurrently writing files (the same technique as broken-stream cleanup), plus a one-shot `chain.note` reminding the AI that after the model switch it should keep following the prior artifact formats and
  protocols (the same weak-model safety-net philosophy as stuck-hint). Candidates are clamped by context window (`contextLimits`: entries whose known limit.context
  `< 配置 contextLimit` ("< the configured contextLimit") candidates are skipped with the reason recorded, to avoid immediately hitting the cap after demotion, worse than the original fault; unknown caps are not filtered); when candidates
  are exhausted (all tried or all clamped), it falls back to the existing block (exit code 2, rollback-to-pending semantics unchanged; the message appends the list of already-tried candidates).
  The demotion action has two trigger surfaces: the above quota/auth/rate (immediate, ahead of the retry ladder), and **the fallback after the retry ladder is exhausted with
  no human adjudication** (transient/unknown, see the --idle-time entry above) -- the latter's fork source uses the same
  "most valuable session" criterion as the retry loop (the larger of accumulated usage between the failed session itself and the chain's original session; a 0-usage pure-error stub is not preserved).
  Demotion only changes the model parameter and **persists nothing** (`chain.model` is memory-only; progress.json records no model); it does not change how sessions are
  created ("standalone verdict sessions do not fork" is unaffected); each candidate gets its own full round of the retry ladder (demotion counting and ladder counting are
   separate, neither masking the other; total cap = (1 + number of candidates) × ladder length); `chain.model` is valid only within the chain; the execution chain is rebuilt per task,
   and the routing table is re-evaluated at task boundaries (by default not sticky across tasks; the cost is that a quota-type fault re-hits the primary model once on each new chain's first prompt --
   a trade-off accepted in D.5). Failback granularity is adjustable (OPENCODE_AUTO_MODEL_FAILBACK_SCOPE, default `task` =
   the status quo, D.6): `phase` resets only at phase boundaries (demotion is sticky across tasks via the failback module's sticky holder); `subtask`
   additionally clears chain candidates at subtask boundaries; `session` re-tries the primary at every brand-new session start (the create branch) -- the migrated session forked out by demotion
   is not cleared, preventing the failover from being immediately undone into oscillation. Under `--interactive` there is also `/failback` for manual takeover
   (D.7, a safe-boundary consumption isomorphic to /exit, without exiting): with no argument = reset the demotion state at the next boundary and retry the primary; with arguments
   `/failback 首选 prov/a 候选 prov/b ...` (primary prov/a, candidates prov/b ...) = wholly redefining the runtime model order at the next boundary (the first is the primary wildcard,
   the rest are the demotion candidate ring, applied via the failback module's override layer ahead of switches.model; the memo stays intact). Every
   prompt's actually-used model is announced on the terminal (D.8): `◈ <任务> 使用模型 prov/model(路由|降级候选|
   降级候选·阶段内粘滞|/failback 指定)` (task uses model prov/model: routed | demotion candidate | demotion candidate, sticky within the phase | /failback-specified), deduplicated for the same model in the same chain.
- --permission four settings (handling strategy for permission.asked, default ask-deny): auto-allow immediately
  auto-grants (always lets it through, no waiting); ask-allow/ask-deny/ask-fail first wait for a human
  (--wait-answer minutes; unset means no waiting, i.e. immediate timeout; allow/yes/y etc. count as authorization and pass with always
  semantics; any other explicit answer denies that permission without interrupting); on timeout they respectively fall back to: auto-grant / auto-deny but the
  session continues (the AI works around without the permission) / deny and quit the run (blocked halt); under dryrun still auto-denied but
  not interrupted. --wait-between pauses for a human after each task completes (Enter resumes immediately; on timeout it auto-continues),
  no waiting before the first task.
- --interactive/-i bypass interaction (mutually exclusive with --verbose, checked in index.ts): it changes no existing
  processing logic -- a resident readline feeds each entered line as an extra user message via `session.promptAsync`
  into the currently active session (v1 engine steer semantics, processed at the next provider turn boundary; **do not use
  v2 `delivery: "queue"`**, it is incompatible with the v1 engine and produces a concurrent drain with no history); with no active
  session the input is discarded with a notice; the human waits of ask/--wait-between are received via this input line instead (prompt wording,
  timeout, empty line, and fallback semantics fully identical to the standalone readline); the terminal shows no verbose detail, but the log
  file keeps full --verbose-level recording (interactive implies the verbose logging level). When the input line recognizes
  `/exit` (exact equality after trim; when pending -- waiting for an ask/step-pause answer -- it is not special-cased and is
  answered as-is) it is not sent to the session; it only sets the exit request: at the next phase/task/subtask safe boundary
  (the same batch of hook points as the three-level boundaries of step mode `OPENCODE_AUTO_STEP`, where PLAN.md/CURRENT.md/
  .auto/progress.json have all been written by the boundary's own regular closing) it halts with exit code `3`, writing no
  blocking/pending marker; re-running restores precisely from the already-persisted progress (fully isomorphic to the recovery
  path of a real crash/kill interruption at that point). See design document plans/0014-exit-resume-design.md.
- **Driver-exclusive state writes**: the status markers of PLAN.md, checklist checkboxes, the verified field, and CURRENT.md
  are all written by the driver; agent sessions are forbidden to edit these two files; during `run` these files (including opencode.json
  and .opencode/auto/config.json)
  are chmod-ed read-only as an accidental-write guardrail (not a security boundary; a same-user process can bypass via bash chmod),
  the driver's own writes are temporarily allowed via `src/protect.ts` allowWrite/reprotect. The sole exception is
  the verify verdict session: it is authorized to update the verify fields of later unfinished tasks (verify knowledge distillation),
  allowWrite(PLAN.md) during the session, verification after it ends; an out-of-bounds edit (checkPlanEdit compares the task set/
   status/attempts/body) is wholly reverted. Completion is not judged by
   agent self-reporting -- task-level acceptance is the driver executing the verify script and a standalone bypass verdict session reading the output to judge;
   the driver only parses its verdict file; after a subtask session ends the driver does the checkbox per its trusted ticks (acceptance is uniformly done at task level).
   **Completion is conditioned on committing (plans/0021-commit-boundary-design.md)**: for any unit (task/subtask/
   hidden task), an artifact or state write counts as complete only once the unified commit lands successfully -- commit failure is a block with exit 2;
   unit startup requires a clean worktree (SHA baseline); at close-out it is verified that the commit range contains only driver commits
   (carrying the Auto-Stage trailer).
- verify acceptance toggle (config.verify, default false; only when enabled does the driver enter task-level three-stage acceptance)
  -- when not enabled, after wrap-up the driver directly marks tasks done (no verified written; nothing lands without verification),
  --review's quality review instead runs serially at this point (the --early parallel window does not exist; loop prints a downgrade
  notice at startup), and the idleTime/idleMax watchdog does not participate; final-review tasks (carrying the final field) regardless of this key
  always forcibly skip task-level acceptance (a missing report / invalid protocol is blocked as a protocol exception at routing).
  This toggle also gates the presence of acceptance wording in the artifacts: when not enabled, the PLAN.md/agent contract produced by init
  (renderText conditional rendering), ensurePointer does not add the AGENTS.md verification-principle block (an existing one is removed), and
  the session prompts (state-rule fragments etc., via baseCtx's verify variable) contain no
  verify-related wording -- the acceptance mechanism does not exist, so the prompts must not mention it.
- --test-by-driver/--handover-test (config.testByDriver/handoverTest, default false; constitutional-level options, revised via init --test-by-driver/--handover-test, rejected by run; a test-execution protocol orthogonal to verify): the former takes back from sessions the right to execute, within the implementation loop, "编译/测试/构建/lint 等可能耗时长或产生大量输出的命令" (commands such as compile/test/build/lint that may take long or produce large output) -- execution-class sessions (subtask/whole-task/acceptance fix rounds; decompose/wrap-up/verdict/review and other bypass sessions and --dryrun do not apply) no longer run such commands directly inside the session; instead the command is written as a script placed in the test/ directory (clearly named, executable, reusable, versioned with the repository), and the script path (relative to the working directory) is written into the tmp/test.sh marker (presence = a pending-execution request; rewriting = requesting again); the driver detects the marker while the session is idle: if the content, trimmed, is a single line pointing to an existing file → run that script directly and best-effort add the execute bit via chmod +x (the AI often forgets the execute bit; scripts under test/ are already versioned via unified commits, no separate archiving); otherwise fall back to inline-script handling: write it wholesale to tmp/test.<n>.sh and run that (an execution snapshot is kept for audit); both forms merge stdout/stderr and write them wholesale to tmp/test.<n>.out (a single file, numbering continues across runs, sharing the idleTime/idleMax watchdog); after the marker is removed, the exit code/elapsed time/script and output paths are steered into the same session, and the AI reads the file directly to judge (a non-0 exit code is not judged by the driver; steers are always delivered via promptAsync -- the v2 synchronous /message endpoint blocks until the turn ends, and synchronously waiting inside the watch event loop would deadlock it; a failed delivery is logged and handled as a silent block; the twin idle event at turn end is deduplicated by watch, and once handled no further settlement happens until a new session event appears); re-running the same test = writing the same script path into tmp/test.sh again (the script may be modified first, then re-run). Every execution session's entry clears leftover pending-execution markers. The latter (requires the former, cross-validated at both the config layer and init; design plans/0023-test-handover-early-design.md) moves the handover ahead of the test: the judgment moment is pinned to **the instant the AI initiates the test** (when tmp/test.sh appears), and the criterion is decoupled to the single condition used ≥ contextLimit (test failure no longer stacks on top; when live usage has not yet reached it, fall back to the session's starting value startUsed -- sessions taken over by reuse/recovery use the chain's accumulated usage, while fork and brand-new sessions count from zero). On a hit the driver, at this instant, does in order: ① **pinned commit** (afterSession, stage `<单元> handoff-<n>-pin`, i.e. "unit handoff-<n>-pin") to fix the script and source under test -- at this moment the session is idle, with no half-written files; ② **run the test concurrently** (no await; serializing would leave the session hanging until its cache goes stale; the close-out is uniformly done by attempt after watch returns, and the test process never dangles across sessions); ③ steer the wrap-up + handover instruction (test-wrapup template), asking the AI to land the remaining work that does not depend on the test result, write the test-dependent part into the test handover document, and end the session. After the session ends, the **re-test guard** compares tracked non-document changes since the pinned commit (git.ts trackedSourceChanges, excluding docs/** and PLAN.md/CURRENT.md; untracked additions do not count): non-empty means stash -u → re-run the same script against the pinned snapshot (runTestScript) → stash pop; a pop conflict is not swallowed (the stash entry is kept, blocked halt); the handover document is then **archived** as testhandoff-<n>.md (docpaths archivedTestHandoff/latestHandoffSeq, numbering continues across sessions/runs) and lands **commit #2** (stage `<单元> handoff-<n>`, i.e. "unit handoff-<n>") confirming the handover -- one handover, two commits, with no source or script modification between the two commits. The document is named by execution scope (subtasks get docs/<id>/S<two-digit index>/testhandoff.md; whole-task sessions and acceptance fix rounds get docs/<id>/testhandoff.md); the handover applies only to its own execution scope, so the next subtask cannot misread the previous subtask's leftover handover (missing retries once with feedback, still missing is a silent block); the driver opens a new session and continues via the continuation prompt (first read the archived handover document, then interpret that test's result), with no hard cap -- past 10 consecutive occurrences it reminds the user to evaluate whether the work is stuck on an unsolvable problem (it may continue after marking the leftover with AUTO-FIXME); when the execution scope completes, that scope's test handover document including all archived copies is cleared (removeHandoffChain, the same rule as the ondemand handover; the next subtask starts counting anew; historical handover content is carried by the git commit record), and on non-recovery continuations the stale task-level and subtask-level handover chains are cleared. The prompt protocol section is injected via the testByDriver/handoverTest conditional blocks of the subtask/whole/fix templates, and the steer copy lives in the test-result/test-wrapup/test-continue templates (no driver-parsed protocol; test-wrapup registers the override markers {{handoffFile}} and "不依赖本次测试结果" (does not depend on this test's result)) -- **the wrap-up copy deliberately never mentions context/limits/tokens**: once a session knows its context is running low, it will judge its remaining budget insufficient on its own and omit disk-landing work it should have completed (empirically observed in the field); the copy also never says "do not modify source" (the AI already knows that when initiating the test, and if it really does modify, the pinned commit + re-test guard provide the safety net). This execution-right convention is sunk via init: the AGENTS.md test-execution-principle block (added/removed with config.testByDriver, mirroring the verification-principle block) and the agent contract's testByDriver conditional section; the `check` subcommand, when testByDriver is enabled, scans AGENTS.md/PLAN.md for descriptions requiring sessions to personally run compile/test/build/lint (TEST_PATTERNS, isomorphic to the verification class).
- verify three stages (when config.verify is enabled): verify processing belongs to the driver; acceptance happens exactly once at task level -- after the wrap-up session:
  ① script preparation (resolveVerifyScript with three branches per verifyCommand: `command:` being a single existing
  and executable file path → existing, used directly; a plain command line → wrapped, the driver wraps
  tmp/verify.sh -- first line the shebang, then the original command text verbatim, adding no extra semantics like set -e,
  idempotently overwriting each time; natural language or missing → generate, first opening a one-off bypass script-generation session to produce the script,
  with the agreed artifact name tmp/verify.sh, reused across fix rounds, not auto-regenerated in V1); ② the driver executes
  it (runVerifyScript: cwd=target directory; spawned directly if it has the execute bit, otherwise via bash; stdout/stderr
  merged and written wholesale to the single file tmp/verify.out, truncated before execution; a progress watchdog -- only when the output file shows no growth
  for idleTime (default 10 minutes) is it killed, code recorded 124 with timeoutReason=idle,
  idleMax (default unset) is the absolute-cap backstop; a completed run record is persisted into the progress record,
  and later interrupt-recovery skips re-running it; a non-0 exit code is not directly judged a failure); ③ a standalone bypass verdict session -- before entering,
  the driver first does a deterministic reference-gate pre-scan of the task artifact documents docs/T-NNN/**; a broken reference = a gap, going straight
  into the fix round without consuming a verdict session (stable-refs P4 reference-consistency three layers); then the verdict session
  (renderVerifyJudge,
  one-off, its chain not entering the task chain) reads the output and code directly to judge -- **the verdict session is forbidden from executing verification scripts
  or verification-flavored commands** (running tests/builds/lint/services etc.; read-only checks are unrestricted); when it deems the script itself faulty
  or insufficiently covering, it writes a new script replacing tmp/verify.sh and ends with the last line `结论: 重验 <原因>` (verdict: re-verify <reason>)
  to close the session; the driver then fixedly executes that specified path (no longer re-resolving per the verify field; wrapped's re-wrapping
  would overwrite the replacement artifact) and writes the output wholesale back into the same output file, with a new verdict session continuing the judgment, at most
  REVERIFY_ROUNDS=3 rounds (exhaustion, or claiming re-verify without writing the script, is a silent block); the verdict session is additionally authorized
  to distill verify knowledge -- upon finding a common defect of the preset command it may update the verify fields of later unfinished tasks in PLAN.md
  (that field only; allowWrite(PLAN.md) during the session, checkPlanEdit verification after it ends;
  an out-of-bounds edit is wholly reverted); when the current script has no problem, no modification is made. A normal verdict is written to
  `.auto/verify.md`; the driver parses the last line `结论: 通过|差距` (verdict: pass|gap) and the optional `verified-command:`
  line; pass → markDone (verified prefers the verdict's verified-command, then the original command, and last
  the actual script path); gap → renderFix feeds it back into the execution session chain to fix, then wrap-up and acceptance run again
  (FIX_ROUNDS=3; off mode rolls straight back to pending). A missing bypass artifact follows the unified "retry once with feedback, on continued failure
  treat as a silent block" rule via requireArtifact. The driver executing scripts does not go through the opencode permission system
  (equivalent to a human running tests locally; not a security boundary, the docs must state this explicitly); verify artifacts live uniformly in the target directory's
  tmp/ (sessions can read them directly within the working directory, avoiding /tmp permission issues); run/init via ensureGitignore
  ensures tmp/ and .auto/ stay out of the repository. This execution-right principle is sunk via init: the AGENTS.md verification
  principle block and the PLAN.md template; the `check` subcommand can scan both files for descriptions violating
  the principle -- both the sinking and the scan presuppose config.verify being enabled (see the "verify acceptance
  toggle" entry above).
- --review: `--review [1-10]` (default 0 disabled, bare option 3, explicit values must be integers 1..10,
  validated by index.ts parseReviewLimit, passed through by loop to runTask). runTask's outer round loop: the execution
  stage (ensureDecomposed/executeWhole) is entered only in the first round; after acceptance passes, reviewTask opens a bypass
  review session (renderReview: dimensions = faithfulness/correctness/verification-process validity; final is decided by "all tasks after
   the current one being done"; the audit report is uniformly written to docs/T-NNN/audit.md (final and non-final
   share the same path, P1-D2),
  scope limited to this task's changes, the final review unlimited); the verdict is written to `.auto/review.md` (same protocol as VERDICT_FILE,
  reusing parseVerdict). Pass → completed; gap → in off mode setStatus pending and return
  incomplete (consistent with that mode's verify-failure semantics); rounds over the limit → blocked (question = the gap
  text in full); not over → the task is first set back to in_progress (verifyTask already marked it done; otherwise a re-run after interruption
  would have next() skip it and the fix checklist would never execute) → a planReviewFix bypass planning session produces
  docs/T-NNN/fix.md → appendSubtasks injects into PLAN.md → refresh CURRENT.md → next round
  (fix checklist items go through the subtask session loop). early in two forms: `--review n --early` or the shortcut sugar
  `--early-review [n]` (index.ts validates: --early appearing alone, or --early-review together with
  --review, are both usage errors with exit code 1) -- the review session is started in parallel within the verify
  script execution window via verifyTask's review hook (executeVerifyScript starts it before runVerifyScript; the verdict session
  joins in front of it; a blocked review propagates immediately; the generate branch starts it only after the script-generation session ends; every
  script execution, including fix-round re-runs, reopens a fresh review -- early wording in renderReview); the verdict returns
  via `{type:"done", audit}` and is consumed by the outer layer (pass → completed; gap → the existing review
  gap flow, with off/over-round semantics unchanged); non-early takes the original serial path; globally, at most one
  LLM session at any moment (script execution is a purely local process, so the only session inside the window is the review session), hence no worktree is needed.
- Prompt templates: all session prompts are managed as file templates (`templates/prompts/` 19 session templates +
  the `_partials.md` shared partials, rendered by src/template.ts, syntax `{{var}}`/`{{#if x}}`/`{{^x}}`/
  `{{> 片段}}` (partial include), block tags occupying a whole line and swallowing it entirely); same-named files in the target directory's `.opencode/auto/prompts/`
  override; protocol-sensitive templates (verify-judge/review/verify-script-gen/review-fix/decompose/
  handoff-steer/final-task/phase-plan/phase-handover/number-recovery) have their key protocol content validated when overridden
  (`结论: 通过|差距|重验` (pass|gap|re-verify), `.auto/verify.md`, the four handover section titles, `.auto/next-task`, etc.);
  missing means exit code 1. To change prompt wording, touch only the template files, not src/prompt.ts
  (it only assembles data); after changes you must run test/prompt-*.test.ts to guard against protocol-line drift.
- The `-m/--mode` mode layer: prompt-level scenario guidance that does not affect the driver's scheduling state machine -- the three ModeSpec
  texts (init intro / exec execution notes / final per-stage emphasis of the final review, managed as file templates: built-in
  templates/modes/ + the target directory's .opencode/auto/modes/, see src/mode.ts) are injected into
  the phase-planning session (wired), the execution-class templates, and renderFinalTask. Only migrate is built in; a new mode = adding one
  protocol-complete .md file in the target directory, zero source changes. -m is accepted only by init (priority: explicit value > existing config value >
  default), persisted in the mode key of .opencode/auto/config.json; run reads the config and looks up via loadModes,
  an unregistered name is an environment error with exit code 1 (the message lists the currently supported modes).
- `--final-review [1-5]` final-review loop (parseFinalReviewLimit mirrors parseReviewLimit: default
  0 disabled, bare option 2, explicit values must be integers 1..5 as the audit-round cap including the first audit; composable with --review/
  --early-review with no interaction between them; --dryrun does not trigger it). After all original tasks are done it enters the
  audit → remediate → validate → finalize state machine -- final-review stages are real tasks that enter PLAN.md
  (T-F<k> numbered by append order, the `final: <stage>@<round>` field, no verify field written),
  reusing runTask's full pipeline: the generation session (renderFinalTask, one-off bypass) produces the proposal
  docs/T-F<k>/plan-<stage>-r<N>.md (anchored to the T-F<k> directory about to be appended) → appendFinalTask appends it → the main loop's next() picks it up for execution →
  report last-line protocol routing (策略: 重构|修补|无 -- strategy: refactor|patch|none; 结论: 通过|差距 <描述> -- verdict: pass|gap <description>): strategy none goes straight to
  finalize (skipping remediate and validate; the original tasks already have task-level verify as the backstop); remediate
  then generates a same-round validate; validate passing generates finalize, a gap rolls back to audit@r+1 (focused on residual
  gaps rather than a full re-audit); audit rounds exhausted circuit-breaks and blocks the last final-review task (residual gaps and the report pointer written into
  question, exit code 2). **A final-review task is itself the inspection and gets no inspection of the inspection**: all four-stage tasks
  force review=0 per the final field and skip the task-level three-stage acceptance (--early naturally becomes ineffective with them),
  after wrap-up the driver directly marks them done; a missing report / invalid protocol is not intercepted at task level -- when routing parses the report it is
  blocked as a protocol exception prompting human verification.
  Interrupt recovery adds zero new state (routeFinal re-evaluates: unfinished final-review tasks generate no new task, the next stage's
  task already existing is not generated again, an already-produced proposal is parsed and appended directly, and done-but-report-missing/protocol-invalid blocks
  with a prompt for human verification; interruptions inside a final-review task use the existing recallProgress/peekProgress); final-review tasks follow
  the waitBetween/unified-commit/exit-code semantics; each final-review stage's changes land with its generation/execution session's unified commit.
- Task pipeline (auto mode): when the body has no checklist items, the decomposition session runs first (producing docs/T-NNN/subtasks.md,
  with the driver injecting the checklist), then sessions execute checklist item by item, and finally the wrap-up session writes docs/T-NNN/report.md
  (only an artifact summary; it runs no task-level verify and issues no acceptance verdict).
   All sessions within a task share one chain: in-chain reuse is governed by OPENCODE_AUTO_REUSE_SESSION,
   **default off -- every prompt opens a new session**; when the switch is on, threshold-based reuse is restored (only if the previous session ended with
   a context ratio below 50%, usage below half the configured contextLimit (default 32k tokens), and no more than 5 minutes
   since its end (REUSE_IDLE_MS); otherwise a new one is created; after longer waits such as verify script execution and verdict/review
   a new session is switched to automatically). Ratio and usage are tracked by watch at all times (independent of --verbose);
   when the model's cap cannot be obtained, the ratio is recorded as 100, i.e. always a new session; transient session-error retries do not reuse the failed session but instead
   **fork a copy from the live session with the most accumulated context** to retry -- first choice is the just-failed session itself (timeout-class
   faults have nothing to do with session content, and its verified output is this round's most valuable asset; a 0-usage pure-error stub excepted),
   next the chain's original session; when the chain has no session to fork, fall back to the fork point and re-seed; only in the worst case a blank new session
   (plans/0015-session-error-retry-plan.md "2026-09-12 修正" (2026-09-12 correction)).
   Retry counts and intervals are described by the ladder `OPENCODE_AUTO_RETRY_WAITS` ("2026-09-12 修正二" (2026-09-12 correction two)):
   each element is the wait before that retry, and the element count is the retry cap; **default `0,1,2,4,8`** = five retries,
   the first immediate (transient jitter often recovers by the next turn), then 1/2/4/8 minutes; backoff starts at minutes rather than
   seconds-level doubling, because each inner opencode failure has already burned 6×300s timeouts + 60s backoff ≈ 31 minutes,
   and stacking a seconds-level curve on the outer layer would be a rounding error; minute-level waiting matters only for riding across a stretch of upstream degradation. `off` = no automatic
   retries (the first failure goes straight into the wait-probe loop).
   **Session faults do not exit** ("2026-09-16 修正三" (2026-09-16 correction three)): non-retryable errors (quota/auth class
   isRetryable:false), transient errors with the ladder exhausted, and quota-demotion candidates exhausted -- the endpoints of these three fault
   paths are no longer a blocked exit (exit code 2) but the same **wait-probe loop**: waiting indefinitely at
   intervals of `OPENCODE_AUTO_RECOVERY_WAIT` (default 30 minutes), each round dispatching one minimal probe prompt via a
   **brand-new temporary clean session** (never probe with the interrupted session -- stuffing probe turns into a real session
   pollutes its context, while fork-probing would re-burn the full prefix every round; the probe chain carries no phase and
   writes no progress record, but copies the real chain's model/role -- what it probes is exactly the model to be resumed after recovery);
   after a successful probe (service recovered), it **forks the interrupted session** (the same "preserve the most valuable session" criterion)
   and re-sends the original prompt from the copy with a one-shot recovery note, the ladder reopening a round; with nothing forkable on the chain, a blank
   new session re-sends. During the wait, two consecutive Ctrl+C presses force-quit (130) via the process-level SIGINT handler --
   this is the only exit -- whatever quota limits are faced, the program can wait for the quota to recover and then continue. Exceptions thrown by the SDK
   (subscription disconnect etc.) and creation/dispatch failures likewise enter this mechanism as session faults; what still returns blocked directly
   is only in-session blocking questions and permission denials (those need human replies; they are not faults). After the ladder is exhausted,
   the way out: when the candidate list (OPENCODE_AUTO_MODEL_FALLBACK) is non-empty, first switch to the next candidate model, fork from the most valuable
   session to continue, and reopen a ladder round (the same logic as quota demotion, see the next entry); only when candidates are also exhausted does it enter
   the wait-probe loop. The three demotable classes quota/auth/rate switch models and continue further upstream.
   Time spent waiting is deducted from AI time via statsWaitBegin/End.
   Every session end unconditionally prints two statistics lines (`◉ 会话结束` (session ended), design
   plans/0019-stats-timing-design.md): line 1 `◉ 会话结束: 上下文 n% (用量/上限 tokens),
   用时 X(累计 Y / N 轮)` (context n% (used/cap tokens), duration X (cumulative Y / N rounds); duration uses the pure-AI measure, in-session askHuman suspension not counted; a single round omits
   the "(累计…)" (cumulative) part); line 2 `tokens 入 … / 出 … [/ 思考 …] / 缓存读 … / 缓存写 …,
   命中率 …[,费用 $…(累计 $…)]` (tokens in ... / out ... [/ thinking ...] / cache read ... / cache write ..., hit rate ...[, cost $...(cumulative $...)]) (reasoning=0 omits the thinking item, cost=0 omits cost, and a zero
   denominator shows —); bypass sessions such as verify verdict/review/phase planning/handover distillation, reused sessions, and interruption-
   recovery-takeover sessions also print them (except a dispatch failure where no session event occurred). Session titles and commit titles share the same short-label
   scheme, all named explicitly (no reliance on server-side auto-titling): a new session is named after the current stage's commit title,
   a reused session is renamed (renameSession) at its end when crossing stages, and at the task's terminal state it is renamed to
   `T-NNN done|blocked|pending <标题>` (title) -- the title prefix is the session's latest progress.
- CURRENT.md is a mirror of the current task (a fallback against context compression, not a must-read for every session -- the prompt already inlines the current
  task, and subtask sessions additionally get the context.md background summary; read it only when context has been compressed or progress is in doubt): written at task start (before the first session),
  refreshed after every checkbox tick (the refresh lands on disk before that unified commit, entering the same commit as PLAN.md's tick, so the mirror never lags
  the committed PLAN.md), deleted at task completion; non-completion endings (blocked/rolled back to pending) write an "interruption
  note" (exit reason/interrupted stage/recovery method) and are kept for human inspection and the next recovery (at the next runTask's
  mirror rebuild, the note's key points are passed to the AI via the recovery prompt); files left by a forced interruption are likewise rebuilt next time.
  In AGENTS.md the driver maintains a single marker block `opencode-auto:start`/`opencode-auto:end`
  (content in English, containing pointers, the verification principle, the test-execution principle, the commit principle, the summary principle -- non-interactive scenarios produce no
  end-of-session summaries -- the maintenance rules, and the reference spec (stable-refs P4, condensed full spec: directory-based storage/
  permanent paths, root-relative reference syntax, the three checking layers) -- seven sections; the verification/test sections appear or disappear with config.verify/
  config.testByDriver, see the "verify acceptance toggle" and "--test-by-driver" entries; the remaining
  sections appear unconditionally): at run/init startup the block is rendered per the current config and compared with the existing standard block in the file;
  on mismatch the whole block is replaced, on absence appended; any other leftover `opencode-auto:<name>:start/end`
  marker blocks in the file (the legacy six-block format, or any stray marker block) are all cleaned up -- this is also the migration path from the old format to the new.
  AGENTS.md is not made read-only (tasks may update the rest of its content, but the agent contract constrains them never to delete
  or rewrite the opencode-auto marker block, and updates to the rest must follow the block's maintenance rules -- stay concise ≤150
  lines, route cross-task workflow knowledge into docs/agents/<topic>.md, update rather than append, and distill only durable
  knowledge; check outputs a note for a missing block / stale content / leftover legacy blocks / over-limit line counts); instruction files are re-read live every
  provider turn, and when AGENTS.md's fingerprint (mtime+size) changes, server.syncAgents
  restarts the server before the next new session as a backstop.
- Progress recovery (precise resumption of interruptions after an application restart): during run the driver persists the current phase and execution-chain session
  into the target directory's .auto/progress.json ({task, session, at, active, phase}; at phase
  boundaries persistStage writes the summarized active=false state; the execution-chain session is written by attempt as active=true **at the moment the prompt dispatch
  succeeds** (**claiming the running session** -- not lost even when killed/Ctrl+C'd mid-turn; previously
  writing only after the turn ended could lose the claim), refreshed per the result after the turn ends; a retryable session error restores the record to
  its pre-dispatch snapshot; an abandoned fork copy does not displace the real recovery point. A test-handover wrap-up (testhandoff.md written with
  `状态: 继续`) is the only successful exit that does not claim a session -- that session's task is already complete; the record switches to the "no session
  in flight" state (active=true while session is missing, chain id cleared in sync); after the continuation session errors out, the record no longer
  points back to the pre-handover session; a restart reuses .auto/handover.json's nextSession/pinned-commit anchor to reconnect to the post-handover session.
  Phase-less one-off bypass sessions (verdict/review/
  script-generation/fix-planning/dryrun/fork base points) write nothing; **phase-level bypass steps** (phase-plan planning /
  phase-handover distillation, phase.kind="step") likewise write an active record via requireArtifact's spec.step,
  deleted by the driver via closeStep after it closes out (artifact validation + commit + post-processing) -- see
  plans/0018-session-resume-precedence-design.md); at runTask start recallProgress reads it back --
  active and the session still exists on the server → reuse the original session to continue (the chain directly seeds that session,
  isomorphic to `opencode -r`, no time window; this takeover is not subject to OPENCODE_AUTO_REUSE_SESSION or
  the reuse threshold -- the recovery semantics is exactly "continue the very session that was interrupted": the first prompt goes into the original session; the recovery
  note is cleared after use and regular rules apply thereafter. The seeded usage is the true value rebuilt from session.messages
  -- scanning from the last message backward for the first assistant message that actually completed (tokens non-0): the last message is often a 0-token line left by a provider
  error/interruption; taking the last message directly would read a long session that "did lots of work but hit an error on the final round" as
  0 usage (false recovery-log values + wrongly-killed reuse decisions); only when the whole session has no such message is it a pure-error stub session
  (a legacy of the old "retry means switching to a blank session"), judged unreusable, opening a new session. The recovery log and subsequent in-chain decisions use these values,
  instead of 0/0 placeholders), otherwise a new session; **handover files take precedence** -- when recovering an active
  record, if a handover document already exists (a leftover ondemand docs/<id>/handoff.md, or any of handover-test's
  task-level / any subtask-level testhandoff.md leftovers, all count), the old session is not reused;
  a new session opens and continues from the handover (with a handoff `状态: 完成`
  (status: done) the whole-task session is skipped outright); `--new-session` explicitly abandons reuse (skipping reuse only; precise phase re-entry
  is kept, and the record is immediately switched to active=false); **unit-ownership gate** (unitReruns) -- an active
  record's interrupted session belongs to a concrete execution unit (task-level stage/subtask #N/fix checklist item #N;
  subtask and fixrun records carry a 1-based ownership index) and may be reused only if this run will re-run that unit;
  if the unit has passed (interrupted in the gap after a subtask's close-out), config/switch changes make it no longer execute,
  or an old record lacks the index so ownership cannot be decided, the record switches to active=false and a new session opens -- recovery
  happens only when the original unit re-runs; in both cases the first prompt appends the "[driver]
  中断后的继续" (continuation after interruption) note (read CURRENT.md and verify progress via git status/diff; per-phase guidance for the
  next step, no redoing). phase supports stage-level re-entry: verify skips re-running the script when a run record is persisted,
  judging directly; stage=fix re-dispatches the fix prompt from the persisted verdict-gap text (gap)
  to continue the fix round; off/ondemand pass the execution stage without re-running executeWhole; review/planfix with a
  valid fix.md inject it directly; decompose reads subtasks.md directly first; at loop startup peekProgress
  sets tasks interrupted in the verify/review stage but already marked done back to in_progress. When the SSE event stream exhausts without
  receiving a session-end event (server failure/network drop), the orphan turn is aborted and handled as a session error,
  not misjudging a session as having ended normally. Task completion calls forgetProgress; graceful exits (non-network-class
  blocked/incomplete) keep the record but clear the reuse eligibility; network-class blocked stays active for recovery
  reuse; the pseudo-task AUTO (dryrun/numbering recovery and other phase-less bypasses) is not remembered, and the pseudo-task PLAN is remembered only when it carries a
  phase step (spec.step). **Session recovery takes precedence over flow recovery**: runPhaseLoop, before consuming
  routePhase's file-derived routing, first checks openStep -- if an unclosed phase-step recovery point exists (owning
  phase == the currently routed phase and not yet in the ledger), it re-enters that step to continue (reusing the interrupted session), even if PLAN.md
  already has tasks / the ledger has already advanced the file routing; PLAN.md tasks and handover documents are written by the AI (or back-filled by the driver only after the session was
   interrupted), which cannot prove the session was closed out; only the driver recovery point being deleted by closeStep counts as closed out
   (if the phase is already in the ledger the stale record is cleared; if the letter mismatches, warn and let file routing take precedence).
   `.auto/` also holds the driver-exclusive statistics file `.auto/stats.json` (src/stats.ts, design
   plans/0019-stats-timing-design.md), entirely unrelated to recovery decisions: it takes part in no recallProgress/openStep
   or any other decision; corruption or absence just restarts statistics from now and does not affect the run; it is this machine's run footprint (lost on machine change/
   wiping .auto/; across interruptions it continues via incremental disk writes and depreciation); zeroing = manually `rm .auto/stats.json`
   (the established procedure before a manual rollback re-runs the same task -- a re-run and an interrupted continuation are indistinguishable to statistics). The proxy-answer ledger
   `.auto/resolves.json` (src/resolve.ts, design plans/0020-auto-resolve-design.md) is of the same family and contract:
   driver-exclusive writes, inside gitignore, not on the protect list, taking part in no recallProgress/openStep or other
   recovery decision; corruption or absence just restarts highlighting and counting from now, affecting neither the run nor the exit code (write failures are all
   silent); **a standalone file, not merged into stats.json** -- stats has high-frequency 30s heartbeat writes, and stuffing an ever-growing
   question-text array would make every heartbeat rewrite the full text; entries are capped at 512 with FIFO eviction; zeroing is likewise the manual
   `rm .auto/resolves.json`。
- Strict recovery (OPENCODE_AUTO_STRICT_RESUME, **default off = byte-identical to the status quo**; design document
  plans/0022-session-recovery-fidelity-design.md, implemented 2026-09-15, in gradual rollout): the criterion for session reuse
  tightens from "the session still exists" to "post-recovery behavior is provably equal to an uninterrupted continuation"; when unmet it **rolls back to the unit baseline
  and re-runs**, trading wasted half-work for determinism. The whole thing is gated on "the switch on and the commit gate in place" (under dryrun it
  no-ops -- no baseline means no rollback anchor). ① **record standard**: the active progress record carries a `baseline` (per-repository
  HEAD short SHAs, refreshed stepwise at task entry/phase boundaries/after subtask gates/requireArtifact unit starts -- the fresher,
  the smaller the rollback radius) and `model` (the effective provider/model string of this prompt). ② **recovery verification**: each
  repository's HEAD == baseline, or the baseline..HEAD range is all driver commits (Auto-Stage trailer) --
  `git.baselineIntact`; the difference from the unit close-out check is that **uncommitted changes are not examined** (mid-way dirty areas are precisely the recovery
  target); any external commit mixed in always means a dirty block to a human (rollback reclaims only the driver's own within-unit changes).
  The effective model disagreeing with the current config's resolution → no reuse (resuming on a different model = behavioral drift); **when
  OPENCODE_AUTO_MODEL is unset the record has no model to write, and under strict recovery this counts as a mismatch -- session reuse requires configuring
  model routing**. Old records (written before the switch was enabled, no baseline) cannot be strictly verified → no reuse and no rollback; a new
  session opens. ③ **rollback protocol** (`git.rollbackUnit`, depth-first per repository, mirroring commitTree):
  `git stash push -u` (message containing the `auto-rollback` prefix) preserves the scene → if baseline..HEAD contains this unit's
  driver commits, `git reset --soft` back to baseline and then pop the stash back; repositories with a detected upstream only
  stash without touching history (already pushed/referenced); repositories with an empty baseline or created during the unit likewise only stash; then the
  progress record switches to the summarized state (baseline/model cleared), CURRENT.md gets a rollback note (where the scene went and how to find it),
  and a new session cold-starts to redo this unit (no recovery note attached). ④ **prompt slimming**: when reusing the original session, the recovery note
  shrinks to one sentence `[driver] 会话曾中断,请继续当前工作直至本单元完成。` ("the session was interrupted; continue the current work until this unit is complete." The session locates itself from the board anyway;
  stage guidance is redundant); paths without the gate in place and non-reuse paths keep the existing per-stage guidance. ⑤ **handover-boundary
  write verification**: the handover document is validated at the very moment of handover (ondemand handoff.md accepts a `状态: 继续|完成` (continue|done) line,
  the test handover testhandoff.md accepts non-empty -- at that moment the test result has not been interpreted yet, so the session cannot possibly declare "完成" (done)); under strict
  recovery there is no more steer-to-backfill retry -- one invalid occurrence triggers rollback and a cold-start redo (limited to once per execution unit; a further failure
  follows the existing silent block), and "completion is not judged by agent self-reporting" applies to handover documents as well.
- opencode server management (src/server.ts manage): run by default spawns `opencode serve`
  and manages its lifecycle; with an explicit url (--server / OPENCODE_AUTO_SERVER) it connects to an external instance and does not manage it.
  The client is a Proxy, so after restart swaps the instance, existing references take effect automatically. Network-class session errors (NETWORK_FAILURE
  matching Internal network failure / Network error etc.) restart before retrying with a new session;
  an external instance's restart returning false only prints a notice. The agent comes from config.agent (default `auto`, generated by init
  as the contract agent, revised via `init --agent`); when explicitly specified it must be an agent already existing under the target directory's
  .opencode/agent/, backstopped by the pre-run integrity check.
- `PLAN.md` field lines (`  - key: value`) must immediately follow the task title and be contiguous; the first non-field line (including a blank line)
  ends the field block. When changing the parsing rules, update `test/plan.test.ts` and the README's format documentation in sync.
- Runtime depends on the external `opencode` CLI (`createOpencodeServer` spawns `opencode serve`),
  or reuses an existing server via `--server` / `OPENCODE_AUTO_SERVER`; the binary itself does not bundle opencode.

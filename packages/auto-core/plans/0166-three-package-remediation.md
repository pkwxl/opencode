# 0166 — The three-package remediation: a committed, resumable idle-time program

Status: **active**. Initialized 2026-11-05 (step 001); protocol amended the same day at the maintainer's instruction — a worker completes consecutive committed steps until its time budget runs low, not one. See Program status below.

This document carries the executable prompt for completing the fix program proposed by
[0165](./0165-three-package-review.md). The work runs as a sequence of independent,
single-worker steps: an orchestrating invocation schedules one idle-time task only when
subsequent work exists, and that task recovers any unclean predecessor state, then completes
consecutive proper steps — each individually verified and committed before the next begins —
until its time budget no longer safely admits another step or the program has no subsequent
work. The program's durable position lives in this document and under
[`0166-remediation/`](./0166-remediation/), never in conversation history alone.

## Derivation and Category scope

Derives: P18, P6 and P4 — method only. P18 shows in plain files and git as the durable state;
P6 shows in every worker re-deriving the actual position from disk, diffs and commits; P4 shows
in the verified commit as the completion condition of every proper step. Tier: none — an
execution and governance record, no product mechanism ruled.

### Category scope

None. This document changes no requirement family and no code, test or runtime-documentation
home. Each remediation wave it schedules requires its own later ruling with Derives/Amends,
tier, Category scope, code homes and test homes in the same change (0110 D5, 0123).

## Executable prompt

Run the following prompt from `packages/auto-core`. The same orchestration text is used for
every later invocation; the idle-time worker it creates performs the worker protocol rather
than recursively scheduling another worker.

```text
Execute the next scheduled step of the post-0165 remediation program.

This protocol has two distinct roles:

- The ORCHESTRATOR is the invocation reading this prompt directly. It checks
  for remaining work, serializes idle-time execution, and creates at most one
  idle-time task.
- The WORKER is that idle-time task. It continues the current work, performing and committing
  one proper step at a time for as long as its time budget safely allows, and never creates
  another idle-time task.

Do not use subagents, Agent, CreateWorkflow, background agents, or other child
working sessions in either role. Ordinary build, test and git subprocesses are
allowed. Do not ask the maintainer to select work or approve the next step.
Do not push, tag, publish or create a release without an explicit instruction.

AUTHORITATIVE INPUT

- plans/0166-three-package-remediation.md, this program's durable home.
- plans/0166-remediation/, containing step records and the coverage ledger.
- plans/0165-three-package-review.md, especially §3, §5, §9 and §10.
- The finding's named plans/0165-review/Sxx-*.md record for its evidence,
  reproduction and proposed remedy.
- AGENTS.md, docs/principles.md, docs/structure.md and plans/INDEX.md.

PART A — ORCHESTRATOR: REMAINING-WORK GATE AND IDLE-TIME SCHEDULING

Perform this part before any scheduling or remediation work.

1. Read the program's status table, coverage ledger and current-position
   section. Determine whether subsequent work exists. Subsequent work means a
   `doing`, `todo` or recoverable incomplete step, an unfinished final audit,
   or an uninitialized program on the first invocation.
2. If no subsequent work exists, terminate immediately with a short statement
   that the remediation program is complete. Do not call OffPeakList or
   OffPeakCreate, do not inspect findings, and do not make any edits.
3. If subsequent work exists, call OffPeakList and check whether an idle task
   for this program is still running in this project. If one is running, wait
   for it to finish. Do not create a concurrent task and do not perform the
   remediation work beside it. After it finishes, check the durable program
   again; if no subsequent work remains, terminate immediately.
4. Once no such idle task is still running and subsequent work remains, call
   OffPeakCreate exactly once with these parameters:

   title: auto-core
   model: GLM-5.3
   prompt: Continue the current work. Note that the current session can run for at most 180 minutes and will be forcefully terminated upon timeout.

   `model` must be the bare ID `GLM-5.3`; do not add a provider prefix. Do not
   omit `model`, because omission selects the default GLM-5.3-Flash instead.
5. If OffPeakCreate returns a quota-exhausted error, forward that error to the
   maintainer verbatim and stop. Do not retry automatically, change the model,
   or perform the work in the orchestrator.
6. After successful creation, reply with only a brief confirmation. The
   created idle-time task, not this orchestrator, proceeds with Part B.

PART B — WORKER: CONSECUTIVE COMMITTED, RECOVERABLE STEPS

The current worker can run for at most 180 minutes and may be forcefully
terminated at timeout. It completes whole proper steps one at a time — each
recovered, executed, verified and committed before the next begins — and keeps
accepting further steps while the remaining budget safely covers one more; when
the budget runs low, or no subsequent work exists, it stops beginning new work
and finishes with the report below. Write recovery state early and often, always
reserve a time margin for verification and the commit, and never call
OffPeakCreate or schedule a successor. A later orchestrator invocation schedules
the next worker.

DURABLE PROGRAM

This design document is also the durable program. Its execution sections are
`Program status`, `Coverage ledger` and `Current position`; step records live
under plans/0166-remediation/.

If those sections do not exist, the first worker performs and commits an
initialization step. Initialization must create:

1. Scope: complete W0 and every remediation wave or named standalone bucket
   needed to disposition findings 0165-001 through 0165-224 and release-audit
   findings F9 through F22.
2. The prescribed order:
   W0 → W1 → W6 → W2 → W5 → W4 → W3 → W7 → W8 → W9 →
   WD → WE → WF → WA → WB/WC.
   Add separately named buckets—manual-subtasks, manual-fix,
   manual-vocabulary, manual-ratchet, cleanroom-policy, round-docs, session,
   engine, release, provenance, config, template-copy, secrets, vocab, fork,
   land and every other bucket present in the register—at
   dependency-appropriate positions. Do not omit findings because §10
   summarizes their bucket only briefly.
3. A status table of small, ordered steps with todo/doing/done/blocked states,
   owning wave, finding ids, durable step-record path, starting HEAD and
   verification result. Include the initialization step itself.
4. A coverage ledger containing every finding id and F-id. Every row must end
   as fixed, consciously deferred with a named residual, or explicitly ruled
   by-design. No row may disappear through deduplication or renaming.
5. A current-position section recording the active step, completed work,
   modified and created files, commands and results, unresolved problems, and
   the exact next action. Disk and git state, not chat history, are the
   recovery authority.

Split work into steps small enough to finish, verify and commit well inside one
180-minute worker — a worker completes several steps per session. If a wave is
too large, give it explicitly scoped steps while preserving requirement-family
completeness.

WORKER STARTUP AND UNCLEAN-STATE RECOVERY

1. Read AGENTS.md, the program and the active step record. Read only the
   detailed 0165 evidence needed for that step; do not re-review the corpus.
   Re-read the program's status table and current position from disk at the
   start of every session and again after any conversation pause — the program
   may have advanced through another worker in the meantime, and conversation
   memory is never the position authority (a resumed session once reopened a
   step another worker had already completed).
2. Inspect `git status`, relevant diffs and recent commits. An unclean tree is
   expected after interruption and is not, by itself, a reason to stop.
3. Select the first `doing` step in table order. If the tree contains work
   from a previous worker but no step is marked `doing`, reconstruct the
   owning step from the program, step records, diffs and commit history and
   restore that step to `doing` before continuing.
4. Resume from the recorded next action, but verify against disk and git what
   actually landed. Never assume an edit, test or commit completed merely
   because the record says it was attempted.
5. If the previous step's changes are complete, verify them and finish its
   documentation and commit. If they are partial or incorrect, continue or
   repair them within that same step. Do not begin another step while the
   previous step owns unresolved changes.
6. If the latest commit already landed the step but status metadata was not
   updated, reconcile the metadata without duplicating the implementation.
   Do not amend or rewrite the existing commit.
7. Preserve all in-flight and user-authored work. Never use `reset --hard`,
   `clean`, `checkout --`, `restore`, `stash`, or wholesale reversion to make
   recovery easier. Do not amend commits or force-push.
8. Distinguish step-owned changes from unrelated pre-existing changes. Leave
   unrelated changes untouched and uncommitted; name them if they prevent a
   safe, isolated commit.
9. Only when no prior work requires recovery, select the first `todo`, mark it
   `doing`, record the date and starting HEAD, and create its durable step
   record before editing.

EXECUTION RULES

- Stay with the selected step until it is committed, or until a genuine
  external blocker is recorded. Do not stop after merely writing a plan.
- Process each change through its requirement family, not just the files named
  by the incident. Answer the constitutional boundary from docs/principles.md
  first, then enumerate the family's code, test and documentation homes.
- Each remediation wave needs its own numbered ruling with Derives/Amends,
  tier and Category scope. Land applicable code homes, test homes, INDEX row
  and navigation line together. Do not silently change frozen vocabulary or
  grammar.
- Treat 0165 as evidence, not authorization: make the actual design ruling
  explicitly in the wave's numbered document.
- Add regression coverage that fails for the confirmed defect and passes for
  the fix. Preserve byte-identical behavior where no defect fix was ruled.
- Do not broaden the step into unrelated cleanup. Record newly discovered
  issues in the ledger without losing the current step's scope.
- Do not cut a release before W1 and W6 have landed. Release, tagging and
  publication remain separate, explicitly instructed actions.
- Update the program's current position and active step record after every
  meaningful edit, test run or discovered blocker. Before any long operation
  or anticipated stop, record the exact next action so forced termination at
  any point is recoverable.
- If the step cannot be completed before the worker's time limit, leave it
  `doing` with its changes intact and a precise recovery record. Do not make a
  WIP commit and do not schedule a successor.
- Time budget: do not begin a new step unless at least 30 minutes remain and
  the step plausibly fits them; prefer ending the session with a clean report
  over rushing a step's verification into a forced termination.

VERIFICATION AND COMMIT PROTOCOL

Run focused regression tests and all affected package checks. For auto-core
this normally includes `bun typecheck` and `bun test`; run corresponding shell
suites when their packages are touched. Distinguish new failures from the
established baseline failures and report both honestly.

A proper step is coherent, verified, documented and leaves affected packages
green. When the step is complete:

1. Update its record and the program with verification results, finding
   dispositions, residuals and status `done`. Include these metadata changes
   in the step's commit.
2. Review the complete diff. Stage only paths belonging to the step; do not
   use wholesale staging that could absorb unrelated work.
3. Commit the coherent step with a subject naming its wave or step and a
   concise summary. Include relevant 0165 finding ids in the body where that
   aids traceability.
4. If the commit fails, record the error and exact recovery action. Leave the
   verified changes intact for the next worker rather than weakening checks
   or discarding work.
5. After a successful commit, inspect the tree and note the commit SHA and
   any remaining unrelated changes. Do not create a second bookkeeping-only
   commit merely to write that SHA into the program; recover it from git
   history instead.
6. Check the remaining time budget. If at least 30 minutes remain and
   subsequent work exists, accept the next step: update the current-position
   section, select the first `todo` in table order, mark it `doing`, record
   the date and starting HEAD, create its durable step record, and run it
   under these same rules. Otherwise stop beginning new work and finish with
   the report below.

Finish the worker with:

- each step worked this session — one line per step: wave, findings
  dispositioned, commit SHA;
- whether interrupted work was recovered;
- findings dispositioned;
- files and ruling documents changed;
- tests/checks run and their exact results;
- the commit SHA, or why no commit was made;
- residuals, blockers and remaining unrelated changes;
- the next program step.

FINAL COMPLETION

The program is complete only when the ledger accounts for every 0165 finding
and F9–F22, every wave is dispositioned, required documentation and INDEX
entries are present, affected suites and typechecks are green, and the final
audit finds no unowned or silently deferred rows. Commit the final audit as a
proper step. Prepare the release assessment last, respecting the W1/W6 release
gate and requiring explicit instruction before tagging or publication.

Once the final audit is committed and no subsequent work exists, later
orchestrator invocations terminate immediately without listing or creating
idle-time tasks.
```


## Program status

Initialized 2026-11-05 at HEAD `5d5e427bf` by step 001. Prescribed order (the executable prompt's initialization clause): **W0 → W1 → W6 → W2 → W5 → W4 → W3 → W7 → W8 → W9 → WD → WE → WF → WA → WB/WC**, with every standalone bucket present in the register placed at a dependency-appropriate position: W-release and W-cleanroom-policy directly after W6 (their surfaces are W6's git/script family), W-secrets after W2 (the S17 keyring family), W-session and W-engine after W5 (runtime control first, then the layers it calls), W-fork and W-land after W4 (the isolation family), the manual-driver suite (W-manual-subtasks → W-manual-fix → W-manual-vocabulary → W-manual-ratchet) after W7 (it mirrors the verification loop W7 rules), W-round-docs after W8 (the round-brief grammar amends the surface W8 touches), W-provenance / W-config / W-template-copy after W9, W-server-trust immediately before WF, W-vocab after WA (its tombstone enactment consumes WA's deprecation-lifecycle ruling), W-tests beside WB.

Conventions: one step = one worker session = one committed unit; the findings column uses bare numbers for `0165-NNN` and verbatim `F…` ids; the union finding `006` (∪15) is enacted jointly by steps 010+011; step 072 coordinates with step 064 (one test repair, two register rows: 058 and 223); steps 079/080 are program-level — the release assessment performs no act of the cut itself (explicit instruction only, after the W1/W6 gate). Step records live under [`0166-remediation/`](./0166-remediation/) and are created by their own step, not pre-created.

| # | step | wave | findings | record | status | start HEAD | verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 001 | init — Program initialization: status table, coverage ledger, current position (this step) | program | — | [001](./0166-remediation/001-init.md) | **done** 2026-11-05 | 5d5e427bf | completeness script OK; typecheck clean |
| 002 | w0-index-navigation — INDEX grammar/order repair, stale code homes, AGENTS.md navigation R4 reduction | W0-governance | 060 061 065 176 | [002](./0166-remediation/002-w0-index-navigation.md) | **done** 2026-11-05 | 9e61f6e0b | probe P1+P2 empty; arrows/pointers zero-loss; typecheck clean |
| 003 | w0-category-scope — Category scope resumption for the 22 lapsed rulings (0142–0161, 0163, 0164) | W0-governance | 066 F9 | [003](./0166-remediation/003-w0-category-scope.md) | **done** 2026-11-05 | 8f2dca4a8 | family-check 22/22 ok; probe P4 empty; typecheck clean |
| 004 | w0-0132-enactment — 0132 enactment completion: config-fix.ts and document/roles.ts homes the ruling marked | W0-governance | 067 F10 | [004](./0166-remediation/004-w0-0132-enactment.md) | **done** 2026-11-05 | 1cb15639a | family-check 0132 ok; probe P1–P4 clean; typecheck clean |
| 005 | w0-premise-guard — Premise-drift guard line ('premises this ruling changes') + SERVER_ENV drift ratchet | W0-governance | 201 F22 | [005](./0166-remediation/005-w0-premise-guard.md) | **done** 2026-11-05 | 2e266c6ed | typecheck clean; agent-env 16 pass; probe P1–P5 clean; family-check 0167 ok |
| 006 | w0-constitution-wording — Constitution wording: PLAN_VERIFY kill-switch line, security-family statement vs code | W0-governance | 101 132 | [006](./0166-remediation/006-w0-constitution-wording.md) | **done** 2026-11-05 | 087244460 | zero false letters repo-wide; probes clean (P3 pre-existing placeholders); typecheck clean |
| 007 | w0-handover-bound — Context-handover chain bound + advisory (execute.ts) | W0-governance | 018 | [007](./0166-remediation/007-w0-handover-bound.md) | **done** 2026-11-05 | c4fb131f7 | execute-handover 12 pass; prompt suites green; agent-fake 130 pass; typecheck clean |
| 008 | w0-tag-disposition — Release-tag disposition (F13): ruling that the tag rides the explicitly instructed cut | W0-governance | 178 F13 | [008](./0166-remediation/008-w0-tag-disposition.md) | todo | — | — |
| 009 | w1-survey-marks — Ruling doc + survey-gate person marks: mark-gated brief install, zero-fork hold, near-miss forks, section-scoped release mark | W1-person-marks | 001 002 | [009](./0166-remediation/009-w1-survey-marks.md) | todo | — | — |
| 010 | w1-verdict-provenance — Verdict-document provenance (006 part 1): report.md vs verifier FAIL, todo→done self-rename, agent-written Choice | W1-person-marks | 006 | [010](./0166-remediation/010-w1-verdict-provenance.md) | todo | — | — |
| 011 | w1-receipt-marker-provenance — Verdict-surface provenance (006 part 2): receipts and test marker by location, formulation surfaces, handover document ownership | W1-person-marks | 006 (part 2) | [011](./0166-remediation/011-w1-receipt-marker-provenance.md) | todo | — | — |
| 012 | w1-choice-analysis-boundary — Choice execution dead-end (run/plan) + analysis.md write boundary | W1-person-marks | 025 093 | [012](./0166-remediation/012-w1-choice-analysis-boundary.md) | todo | — | — |
| 013 | w6-release-baseline — Release baseline walk past trailer-less commits, trailer-block witness, foreignCommits range semantics, the unruled git-hooks question | W6-git | 004 140 141 142 | [013](./0166-remediation/013-w6-release-baseline.md) | todo | — | — |
| 014 | w6-failure-direction — Failure-direction stragglers: repoRoots unreadable, receipt nested-diff coverage, subtree confinement, nestedHeads empty sha | W6-git | 035 036 110 138 204 | [014](./0166-remediation/014-w6-failure-direction.md) | todo | — | — |
| 015 | w6-guard-lane-output — Script guard revert-class, lane process-group kill, bounded script output, doc-lane beginUnit dedup | W6-git | 020 021 108 139 | [015](./0166-remediation/015-w6-guard-lane-output.md) | todo | — | — |
| 016 | w-release — Release clean-tree check fails loud on unreadable git | W-release | 034 | [016](./0166-remediation/016-w-release.md) | todo | — | — |
| 017 | w-cleanroom-policy — Cleanroom audit findings owner + raw-log boundary enforcement for the source-free receipt rule | W-cleanroom-policy | 051 052 | [017](./0166-remediation/017-w-cleanroom-policy.md) | todo | — | — |
| 018 | w2-restart-sync — Managed-host restart synchronization: rekey as a safe-boundary act, double-spawn, walk bound | W2-keyring | 057 | [018](./0166-remediation/018-w2-restart-sync.md) | todo | — | — |
| 019 | w2-ring-wait-vocab — recoveryAt ring wait vs stated resets + retired skip-flag vocabulary lockstep | W2-keyring | 126 199 | [019](./0166-remediation/019-w2-ring-wait-vocab.md) | todo | — | — |
| 020 | w-secrets — Credentialed URL masking, env-overlay name echo, X1 scrub gaps (claude --version child) | W-secrets | 130 131 133 | [020](./0166-remediation/020-w-secrets.md) | todo | — | — |
| 021 | w5-sideband — The --interactive sideband detach family | W5-control | 010 | [021](./0166-remediation/021-w5-sideband.md) | todo | — | — |
| 022 | w5-sleeps-signals — /exit-wakeable sleeps, SIGTERM/SIGHUP handler, startup hibernate ordering, /exit-as-answer | W5-control | 087 088 091 092 | [022](./0166-remediation/022-w5-sleeps-signals.md) | todo | — | — |
| 023 | w5-lock-carryover-progress — Lock pid-space identity, carryover classification, progress-record atomic write, unreadable HEAD, run-start line truth | W5-control | 090 112 113 114 115 | [023](./0166-remediation/023-w5-lock-carryover-progress.md) | todo | — | — |
| 024 | w5-resume-reanchor — Resume re-anchor: charter commit-range truth, trailer-less commits inside the audit | W5-control | 023 024 | [024](./0166-remediation/024-w5-resume-reanchor.md) | todo | — | — |
| 025 | w-session-fault-classes — Driver-fault reclassification, in-flight claim timing, overflow handover path, restart pattern match | W-session | 026 027 028 029 | [025](./0166-remediation/025-w-session-fault-classes.md) | todo | — | — |
| 026 | w-session-ask-restart — askHuman closed-stdin, concurrent host restart serialization, session-driving hygiene | W-session | 116 117 196 | [026](./0166-remediation/026-w-session-ask-restart.md) | todo | — | — |
| 027 | w-engine — Half-open probe, step-up re-fire, poisoned emission chain, mid-turn steer settle | W-engine | 030 118 119 120 | [027](./0166-remediation/027-w-engine.md) | todo | — | — |
| 028 | w4-matcher-oracle — The opencode-matcher oracle + 0147 edit-deny pattern + stamp-placement catch-all spellings | W4-wall-perms | 039 150 | [028](./0166-remediation/028-w4-matcher-oracle.md) | todo | — | — |
| 029 | w4-wall-doors — Wall close/doors: outside-transfer skip, recovery sweep, closed predicate, close-before-gates ordering, false remedies | W4-wall-perms | 008 037 038 076 149 | [029](./0166-remediation/029-w4-wall-doors.md) | todo | — | — |
| 030 | w4-claude-boundary — Claude adapter boundary translation + wall commit message staleness vs 0138 | W4-wall-perms | 040 147 | [030](./0166-remediation/030-w4-claude-boundary.md) | todo | — | — |
| 031 | w-fork — Nested-of-nested worktrees, symlinked paths, failure cause reporting, reflog claim; lane digest identity (W-fork/W-lanes) | W-fork | 143 144 145 146 085 | [031](./0166-remediation/031-w-fork.md) | todo | — | — |
| 032 | w-land — land's original-branch derivation ruling | W-land | 148 | [032](./0166-remediation/032-w-land.md) | todo | — | — |
| 033 | w3-core-seam — One core init/amend sequence, one option/banner/hint emitter family, shared fake fixture (the shell mirror ∪7) | W3-shell-seam | 056 | [033](./0166-remediation/033-w3-core-seam.md) | todo | — | — |
| 034 | w3-services-allowlist — services() allowlist evasion in auto-server's worker-interactive | W3-shell-seam | 089 | [034](./0166-remediation/034-w3-services-allowlist.md) | todo | — | — |
| 035 | w3-parser-polish — CLI parser polish: extra positionals, --flag=value validation, -- flood, phasesLine remedy | W3-shell-seam | 166 167 211 212 | [035](./0166-remediation/035-w3-parser-polish.md) | todo | — | — |
| 036 | w3-exports-ruling — The exports ruling: entry modules vs the open ./* boundary (§9-3) | W3-shell-seam | 174 | [036](./0166-remediation/036-w3-exports-ruling.md) | todo | — | — |
| 037 | w3-server-entry-hygiene — Service-shell entry hygiene: stale refusal texts, token-name fallback, run-id shapes | W3-shell-seam | 219 | [037](./0166-remediation/037-w3-server-entry-hygiene.md) | todo | — | — |
| 038 | w7-progress-bound — The oscillating-gap progress bound (the ruled 2+N made true) + charter clamp first-line | W7-verify | 003 022 | [038](./0166-remediation/038-w7-progress-bound.md) | todo | — | — |
| 039 | w7-marker-scan — Proxy-answer scan scoped to the session's diff + dead-marker consumption on the verify FAIL path | W7-verify | 109 111 | [039](./0166-remediation/039-w7-marker-scan.md) | todo | — | — |
| 040 | w-manual-subtasks — Subtask companions' independent verification (the S1 bypass) + phase selection, resume gate, recommit | W-manual-subtasks | 005 048 053 164 | [040](./0166-remediation/040-w-manual-subtasks.md) | todo | — | — |
| 041 | w-manual-fix — Manual fix subject ordinal + the countable gap grammar the master counts | W-manual-fix | 049 050 | [041](./0166-remediation/041-w-manual-fix.md) | todo | — | — |
| 042 | w-manual-vocabulary — 0148 short-title grammar completion across the manual suite | W-manual-vocabulary | 163 | [042](./0166-remediation/042-w-manual-vocabulary.md) | todo | — | — |
| 043 | w-manual-ratchet — The ratchet pins ruled relationships, not just vocabulary presence | W-manual-ratchet | 165 | [043](./0166-remediation/043-w-manual-ratchet.md) | todo | — | — |
| 044 | w8-clarify-state — clarify's state resolution + the review print's round-brief proposals | W8-planning | 012 096 | [044](./0166-remediation/044-w8-clarify-state.md) | todo | — | — |
| 045 | w8-formulation-reconstruction — Formulation todo reconstruction, --new-task overwrite guard, synthDigest durability | W8-planning | 014 015 100 | [045](./0166-remediation/045-w8-formulation-reconstruction.md) | todo | — | — |
| 046 | w8-adopt-reshape — adopt's test-channel gate + bare plan's phase-tail reshape | W8-planning | 094 095 | [046](./0166-remediation/046-w8-adopt-reshape.md) | todo | — | — |
| 047 | w8-release-consumption — Release consumption commits under the clean-tree gate + person-boundary stop-line hygiene | W8-planning | 013 187 188 | [047](./0166-remediation/047-w8-release-consumption.md) | todo | — | — |
| 048 | w8-charter-freshen — Charter-check fallback rendering, freshen scope, format-sketch terminator | W8-planning | 097 098 099 | [048](./0166-remediation/048-w8-charter-freshen.md) | todo | — | — |
| 049 | w-round-docs — Round-brief subsection grammar, brief-install commit idempotence, awaiting note, driver-helper truths, analysis hygiene | W-round-docs | 016 103 104 105 191 | [049](./0166-remediation/049-w-round-docs.md) | todo | — | — |
| 050 | w9-doc-loop-recovery — Doc-loop dead-end, Promise.race rejection arm, orphan probe bounds and identity | W9-lanes | 009 079 080 081 | [050](./0166-remediation/050-w9-doc-loop-recovery.md) | todo | — | — |
| 051 | w9-park-checklist — Park/repair hook arms, repair confinement truth, checklist split boundary, decompose re-derivation, requireArtifact order | W9-lanes | 017 082 083 106 107 | [051](./0166-remediation/051-w9-park-checklist.md) | todo | — | — |
| 052 | w9-stats — Stats identity/bracket rulings: stint ledger, lanes reset, per-unit heartbeat, run-end total, stamp time | W9-lanes | 121 122 123 124 125 | [052](./0166-remediation/052-w9-stats.md) | todo | — | — |
| 053 | w9-lane-launcher — Lane launcher on compiled binaries, decorator rider sweep, loop-task comment truth | W9-lanes | 011 084 185 | [053](./0166-remediation/053-w9-lane-launcher.md) | todo | — | — |
| 054 | w-provenance — Body-only direction label, crash-mid-applySync misattribution, direction-test oracle pin | W-provenance | 043 154 158 | [054](./0166-remediation/054-w-provenance.md) | todo | — | — |
| 055 | w-config — fix brief-move idempotence, sync's broken-config verdict, committed-state write-then-rename | W-config | 155 156 157 | [055](./0166-remediation/055-w-config.md) | todo | — | — |
| 056 | w-template-copy — fix.md commit cadence, acceptance-duty fix loop, mode-brief exit vocabulary | W-template-copy | 160 161 162 | [056](./0166-remediation/056-w-template-copy.md) | todo | — | — |
| 057 | wd-formulation-tier — Formulation tier routing, probe ignoring down marks, classifier cache absolute time | WD-routing | 031 032 127 | [057](./0166-remediation/057-wd-formulation-tier.md) | todo | — | — |
| 058 | wd-claude-adapter — claude external_directory translation, unbounded awaits, silent model-change ignore, health-check timeout | WD-routing | 033 136 202 203 | [058](./0166-remediation/058-wd-claude-adapter.md) | todo | — | — |
| 059 | wd-restart-serialization — manage.restart/close serialization, capability-clamp remedy teaching, strict-resume avoid/only verdict | WD-routing | 128 129 135 | [059](./0166-remediation/059-wd-restart-serialization.md) | todo | — | — |
| 060 | we-override-guards — Override guard completeness (Artifacts protocol, handover/split), unknown-template assertion inert | WE-policy | 044 045 046 | [060](./0166-remediation/060-we-override-guards.md) | todo | — | — |
| 061 | we-renderer-prose — Renderer prose to templates + bundle parse validation before materialization | WE-policy | 047 159 | [061](./0166-remediation/061-we-renderer-prose.md) | todo | — | — |
| 062 | w-server-trust — Bridge secret off argv, env-only names out of the switches carrier | W-server-trust | 054 171 | [062](./0166-remediation/062-w-server-trust.md) | todo | — | — |
| 063 | wf-spawn-transport — Spawn payload robustness (E2BIG/ENOENT), IPv6 transport URL, --launch path resolution | WF-server | 055 169 172 | [063](./0166-remediation/063-wf-spawn-transport.md) | todo | — | — |
| 064 | wf-registry-observe — Run-registry/hub eviction, restored-run retire, observe verdict, worker.test split | WF-server | 058 168 170 173 | [064](./0166-remediation/064-wf-registry-observe.md) | todo | — | — |
| 065 | wa-constitution-releases — Constitution/releases reconciliation: P4 vs 0145, informational class, deprecation lifecycle, mid-cycle edit, derivation wording, replay silences and protocol | WA-docs | 007 068 069 071 181 182 183 F11 F12 F17 F18 F19 F20 F21 | [065](./0166-remediation/065-wa-constitution-releases.md) | todo | — | — |
| 066 | wa-glossary-registers — Glossary and principles.md registers refreshed against 0124–0164 | WA-docs | 179 180 F15 F16 | [066](./0166-remediation/066-wa-glossary-registers.md) | todo | — | — |
| 067 | wa-docs-accuracy — Docs accuracy: shell-contract module list, reset inverse, README/MANUAL command and parallel-contract rows, server docs honestly-absent lists | WA-docs | 064 086 207 213 215 216 217 221 222 | [067](./0166-remediation/067-wa-docs-accuracy.md) | todo | — | — |
| 068 | wa-document-grammar — Document-grammar robustness: roleOf docs gate, custom-phase field block, unit field-block near-misses, Depends two homes | WA-docs | 041 077 152 153 | [068](./0166-remediation/068-wa-document-grammar.md) | todo | — | — |
| 069 | wa-switch-census — Switch census documentation + the engine I/O contract truth | WA-docs | 197 200 | [069](./0166-remediation/069-wa-switch-census.md) | todo | — | — |
| 070 | wa-release-due — The due-cut reconciliation in releases.md (prepares the final release assessment) | WA-docs | 070 F14 | [070](./0166-remediation/070-wa-release-due.md) | todo | — | — |
| 071 | w-vocab — Retired route words as tombstones per the deprecation-lifecycle ruling (step wa-constitution-releases) | W-vocab | 134 | [071](./0166-remediation/071-w-vocab.md) | todo | — | — |
| 072 | wb-hermetic-preload — Shell bunfig preload hermeticity + direct-test census for the five untested modules | WB-test | 059 063 | [072](./0166-remediation/072-wb-hermetic-preload.md) | todo | — | — |
| 073 | wb-deterministic-tests — The two deterministic test repairs: observe sawDirty race, worker.test usage-vocabulary split (with step 064) | WB-test | 220 223 | [073](./0166-remediation/073-wb-deterministic-tests.md) | todo | — | — |
| 074 | w-tests — chain-writes ratchet: the ten missed write shapes | W-tests | 195 | [074](./0166-remediation/074-w-tests.md) | todo | — | — |
| 075 | wc-loop-plan-size — loop-plan.ts split to its header's promise + its stale comments | WC-hygiene | 177 189 190 224 | [075](./0166-remediation/075-wc-loop-plan-size.md) | todo | — | — |
| 076 | wc-state-windows — State-window robustness: units.json sanitizing and parse failure, brief-install kill window, preflight unprotect, sentinel consumption, clean-gate leftovers | WC-hygiene | 042 072 073 074 078 151 | [076](./0166-remediation/076-wc-state-windows.md) | todo | — | — |
| 077 | wc-runtime-hygiene — Runtime hygiene A: handover rollback scope, park unknown id, round-close EOF wait, mid-restart throw, weak-oracle tests, loop comments, run-control aggregates | WC-hygiene | 019 075 102 137 175 184 186 | [077](./0166-remediation/077-wc-runtime-hygiene.md) | todo | — | — |
| 078 | wc-hygiene-modules — Hygiene B: runner 0156-D5 surface, resolve.ts language, dead export, STATS_PLAN cites, external-dirs dedup, task-store hygiene | WC-hygiene | 192 193 194 198 205 206 | [078](./0166-remediation/078-wc-hygiene-modules.md) | todo | — | — |
| 079 | wc-hygiene-surfaces — Hygiene C: switch documentation home, agents-block rewrite scope, template bash grant, receipt Log field, never-init banner, README key-ring claim | WC-hygiene | 062 208 209 210 214 218 | [079](./0166-remediation/079-wc-hygiene-surfaces.md) | todo | — | — |
| 080 | final-audit — Final audit: every ledger row ends fixed/deferred/by-design, no unowned rows; INDEX/nav complete; suites green | program | — | [080](./0166-remediation/080-final-audit.md) | todo | — | — |
| 081 | release-assessment — Release assessment prepared (W1/W6 gate checked); tagging/cut/publication only on explicit instruction | program | — | [081](./0166-remediation/081-release-assessment.md) | todo | — | — |

## Coverage ledger

Every finding of the 0165 register (`0165-001`…`0165-224`) and every release-audit finding (`F9`…`F22`) has exactly one row; rows are never removed through deduplication or renaming — union rows (`006` ∪15, `010` ∪1, `056` ∪7, `057` ∪5) keep their member enumerations in their step records. A row's final disposition is exactly one of: `fixed @<short-sha>`, `deferred: <named residual>`, `by-design: <ruling doc>`. F-id rows with a register twin are dispositioned together with it; F22 (the premise-drift pattern) has no twin and is owned by step 005.

| id | sev | bucket | step | disposition |
| --- | --- | --- | --- | --- |
| 0165-001 | S1 | W1-person-marks | 009 | — |
| 0165-002 | S1 | W1-person-marks | 009 | — |
| 0165-003 | S1 | W7-verify | 038 | — |
| 0165-004 | S1 | W6-git | 013 | — |
| 0165-005 | S1 | W-manual-subtasks | 040 | — |
| 0165-006 | S1 | W1-person-marks | 010+011 | — |
| 0165-007 | S2 | WA-docs | 065 | — |
| 0165-008 | S2 | W4-wall-perms | 029 | — |
| 0165-009 | S2 | W9-lanes | 050 | — |
| 0165-010 | S2 | W5-control | 021 | — |
| 0165-011 | S2 | W9-lanes | 053 | — |
| 0165-012 | S2 | W8-planning | 044 | — |
| 0165-013 | S2 | W8-planning | 047 | — |
| 0165-014 | S2 | W8-planning | 045 | — |
| 0165-015 | S2 | W8-planning | 045 | — |
| 0165-016 | S2 | W-round-docs | 049 | — |
| 0165-017 | S2 | W9-lanes | 051 | — |
| 0165-018 | S2 | W0-governance | 007 | fixed (step 007, ruling 0168) |
| 0165-019 | S2 | WC-hygiene | 077 | — |
| 0165-020 | S2 | W6-git | 015 | — |
| 0165-021 | S2 | W6-git | 015 | — |
| 0165-022 | S2 | W7-verify | 038 | — |
| 0165-023 | S2 | W5-control | 024 | — |
| 0165-024 | S2 | W5-control | 024 | — |
| 0165-025 | S2 | W1-person-marks | 012 | — |
| 0165-026 | S2 | W-session | 025 | — |
| 0165-027 | S2 | W-session | 025 | — |
| 0165-028 | S2 | W-session | 025 | — |
| 0165-029 | S2 | W-session | 025 | — |
| 0165-030 | S2 | W-engine | 027 | — |
| 0165-031 | S2 | WD-routing | 057 | — |
| 0165-032 | S2 | WD-routing | 057 | — |
| 0165-033 | S2 | WD-routing | 058 | — |
| 0165-034 | S2 | W-release | 016 | — |
| 0165-035 | S2 | W6-git | 014 | — |
| 0165-036 | S2 | W6-git | 014 | — |
| 0165-037 | S2 | W4-wall-perms | 029 | — |
| 0165-038 | S2 | W4-wall-perms | 029 | — |
| 0165-039 | S2 | W4-wall-perms | 028 | — |
| 0165-040 | S2 | W4-wall-perms | 030 | — |
| 0165-041 | S2 | WA-docs | 068 | — |
| 0165-042 | S2 | WC-hygiene | 076 | — |
| 0165-043 | S2 | W-provenance | 054 | — |
| 0165-044 | S2 | WE-policy | 060 | — |
| 0165-045 | S2 | WE-policy | 060 | — |
| 0165-046 | S2 | WE-policy | 060 | — |
| 0165-047 | S2 | WE-policy | 061 | — |
| 0165-048 | S2 | W-manual-subtasks | 040 | — |
| 0165-049 | S2 | W-manual-fix | 041 | — |
| 0165-050 | S2 | W-manual-fix | 041 | — |
| 0165-051 | S2 | W-cleanroom-policy | 017 | — |
| 0165-052 | S2 | W-cleanroom-policy | 017 | — |
| 0165-053 | S2 | W-manual-subtasks | 040 | — |
| 0165-054 | S2 | W-server-trust | 062 | — |
| 0165-055 | S2 | WF-server | 063 | — |
| 0165-056 | S2 | W-shell-seam | 033 | — |
| 0165-057 | S2 | W2-keyring | 018 | — |
| 0165-058 | S3 | WF-server | 064 | — |
| 0165-059 | S3 | WB-test | 072 | — |
| 0165-060 | S3 | W0-governance | 002 | fixed (step 002) |
| 0165-061 | S3 | W0-governance | 002 | fixed (step 002) |
| 0165-062 | S3 | WC-hygiene | 079 | — |
| 0165-063 | S3 | WB-test | 072 | — |
| 0165-064 | S3 | WA-docs | 067 | — |
| 0165-065 | S3 | W0-governance | 002 | fixed (step 002) |
| 0165-066 | S3 | W0-governance | 003 | fixed (step 003) |
| 0165-067 | S3 | W0-governance | 004 | fixed (step 004) |
| 0165-068 | S3 | WA-docs | 065 | — |
| 0165-069 | S3 | WA-docs | 065 | — |
| 0165-070 | S3 | WA-docs | 070 | — |
| 0165-071 | S3 | WA-docs | 065 | — |
| 0165-072 | S3 | WC-hygiene | 076 | — |
| 0165-073 | S3 | WC-hygiene | 076 | — |
| 0165-074 | S3 | WC-hygiene | 076 | — |
| 0165-075 | S3 | WC-hygiene | 077 | — |
| 0165-076 | S3 | W4-wall-perms | 029 | — |
| 0165-077 | S3 | WA-docs | 068 | — |
| 0165-078 | S3 | WC-hygiene | 076 | — |
| 0165-079 | S3 | W9-lanes | 050 | — |
| 0165-080 | S3 | W9-lanes | 050 | — |
| 0165-081 | S3 | W9-lanes | 050 | — |
| 0165-082 | S3 | W9-lanes | 051 | — |
| 0165-083 | S3 | W9-lanes | 051 | — |
| 0165-084 | S3 | W9-lanes | 053 | — |
| 0165-085 | S3 | W-fork/W-lanes | 031 | — |
| 0165-086 | S3 | WA-docs | 067 | — |
| 0165-087 | S3 | W5-control | 022 | — |
| 0165-088 | S3 | W5-control | 022 | — |
| 0165-089 | S3 | W3-shell-seam | 034 | — |
| 0165-090 | S3 | W5-control | 023 | — |
| 0165-091 | S3 | W5-control | 022 | — |
| 0165-092 | S3 | W5-control | 022 | — |
| 0165-093 | S3 | W1-person-marks | 012 | — |
| 0165-094 | S3 | W8-planning | 046 | — |
| 0165-095 | S3 | W8-planning | 046 | — |
| 0165-096 | S3 | W8-planning | 044 | — |
| 0165-097 | S3 | W8-planning | 048 | — |
| 0165-098 | S3 | W8-planning | 048 | — |
| 0165-099 | S3 | W8-planning | 048 | — |
| 0165-100 | S3 | W8-planning | 045 | — |
| 0165-101 | S3 | W0-governance | 006 | fixed (step 006) |
| 0165-102 | S3 | WC-hygiene | 077 | — |
| 0165-103 | S3 | W-round-docs | 049 | — |
| 0165-104 | S3 | W-round-docs | 049 | — |
| 0165-105 | S3 | W-round-docs | 049 | — |
| 0165-106 | S3 | W9-lanes | 051 | — |
| 0165-107 | S3 | W9-lanes | 051 | — |
| 0165-108 | S3 | W6-git | 015 | — |
| 0165-109 | S3 | W7-verify | 039 | — |
| 0165-110 | S3 | W6-git | 014 | — |
| 0165-111 | S3 | W7-verify | 039 | — |
| 0165-112 | S3 | W5-control | 023 | — |
| 0165-113 | S3 | W5-control | 023 | — |
| 0165-114 | S3 | W5-control | 023 | — |
| 0165-115 | S3 | W5-control | 023 | — |
| 0165-116 | S3 | W-session | 026 | — |
| 0165-117 | S3 | W-session | 026 | — |
| 0165-118 | S3 | W-engine | 027 | — |
| 0165-119 | S3 | W-engine | 027 | — |
| 0165-120 | S3 | W-engine | 027 | — |
| 0165-121 | S3 | W9-lanes | 052 | — |
| 0165-122 | S3 | W9-lanes | 052 | — |
| 0165-123 | S3 | W9-lanes | 052 | — |
| 0165-124 | S3 | W9-lanes | 052 | — |
| 0165-125 | S3 | W9-lanes | 052 | — |
| 0165-126 | S3 | W2-keyring | 019 | — |
| 0165-127 | S3 | WD-routing | 057 | — |
| 0165-128 | S3 | WD-routing | 059 | — |
| 0165-129 | S3 | WD-routing | 059 | — |
| 0165-130 | S3 | W-secrets | 020 | — |
| 0165-131 | S3 | W-secrets | 020 | — |
| 0165-132 | S3 | W0-governance | 006 | fixed (step 006) |
| 0165-133 | S3 | W-secrets | 020 | — |
| 0165-134 | S3 | W-vocab | 071 | — |
| 0165-135 | S3 | WD-routing | 059 | — |
| 0165-136 | S3 | WD-routing | 058 | — |
| 0165-137 | S3 | WC-hygiene | 077 | — |
| 0165-138 | S3 | W6-git | 014 | — |
| 0165-139 | S3 | W6-git | 015 | — |
| 0165-140 | S3 | W6-git | 013 | — |
| 0165-141 | S3 | W6-git | 013 | — |
| 0165-142 | S3 | W6-git | 013 | — |
| 0165-143 | S3 | W-fork | 031 | — |
| 0165-144 | S3 | W-fork | 031 | — |
| 0165-145 | S3 | W-fork | 031 | — |
| 0165-146 | S3 | W-fork | 031 | — |
| 0165-147 | S3 | W4-wall-perms | 030 | — |
| 0165-148 | S3 | W-land | 032 | — |
| 0165-149 | S3 | W4-wall-perms | 029 | — |
| 0165-150 | S3 | W4-wall-perms | 028 | — |
| 0165-151 | S3 | WC-hygiene | 076 | — |
| 0165-152 | S3 | WA-docs | 068 | — |
| 0165-153 | S3 | WA-docs | 068 | — |
| 0165-154 | S3 | W-provenance | 054 | — |
| 0165-155 | S3 | W-config | 055 | — |
| 0165-156 | S3 | W-config | 055 | — |
| 0165-157 | S3 | W-config | 055 | — |
| 0165-158 | S3 | W-provenance | 054 | — |
| 0165-159 | S3 | WE-policy | 061 | — |
| 0165-160 | S3 | W-template-copy | 056 | — |
| 0165-161 | S3 | W-template-copy | 056 | — |
| 0165-162 | S3 | W-template-copy | 056 | — |
| 0165-163 | S3 | W-manual-vocabulary | 042 | — |
| 0165-164 | S3 | W-manual-subtasks | 040 | — |
| 0165-165 | S3 | W-manual-ratchet | 043 | — |
| 0165-166 | S3 | W3-shell-seam | 035 | — |
| 0165-167 | S3 | W3-shell-seam | 035 | — |
| 0165-168 | S3 | WF-server | 064 | — |
| 0165-169 | S3 | WF-server | 063 | — |
| 0165-170 | S3 | WF-server | 064 | — |
| 0165-171 | S3 | W-server-trust | 062 | — |
| 0165-172 | S3 | WF-server | 063 | — |
| 0165-173 | S3 | WF-server | 064 | — |
| 0165-174 | S3 | W3-shell-seam | 036 | — |
| 0165-175 | S3 | WC-hygiene | 077 | — |
| 0165-176 | S4 | W0-governance | 002 | fixed (step 002) |
| 0165-177 | S4 | WC-hygiene | 075 | — |
| 0165-178 | S4 | W0-governance | 008 | — |
| 0165-179 | S4 | WA-docs | 066 | — |
| 0165-180 | S4 | WA-docs | 066 | — |
| 0165-181 | S4 | WA-docs | 065 | — |
| 0165-182 | S4 | WA-docs | 065 | — |
| 0165-183 | S4 | WA-docs | 065 | — |
| 0165-184 | S4 | WC-hygiene | 077 | — |
| 0165-185 | S4 | W9-lanes | 053 | — |
| 0165-186 | S4 | WC-hygiene | 077 | — |
| 0165-187 | S4 | W8-planning | 047 | — |
| 0165-188 | S4 | W8-planning | 047 | — |
| 0165-189 | S4 | WC-hygiene | 075 | — |
| 0165-190 | S4 | WC-hygiene | 075 | — |
| 0165-191 | S4 | W-round-docs | 049 | — |
| 0165-192 | S4 | WC-hygiene | 078 | — |
| 0165-193 | S4 | WC-hygiene | 078 | — |
| 0165-194 | S4 | WC-hygiene | 078 | — |
| 0165-195 | S4 | W-tests | 074 | — |
| 0165-196 | S4 | W-session | 026 | — |
| 0165-197 | S4 | WA-docs | 069 | — |
| 0165-198 | S4 | WC-hygiene | 078 | — |
| 0165-199 | S4 | W2-keyring | 019 | — |
| 0165-200 | S4 | WA-docs | 069 | — |
| 0165-201 | S4 | W0-governance | 005 | fixed (step 005) |
| 0165-202 | S4 | WD-routing | 058 | — |
| 0165-203 | S4 | WD-routing | 058 | — |
| 0165-204 | S4 | W6-git | 014 | — |
| 0165-205 | S4 | WC-hygiene | 078 | — |
| 0165-206 | S4 | WC-hygiene | 078 | — |
| 0165-207 | S4 | WA-docs | 067 | — |
| 0165-208 | S4 | WC-hygiene | 079 | — |
| 0165-209 | S4 | WC-hygiene | 079 | — |
| 0165-210 | S4 | WC-hygiene | 079 | — |
| 0165-211 | S4 | W3-shell-seam | 035 | — |
| 0165-212 | S4 | W3-shell-seam | 035 | — |
| 0165-213 | S4 | WA-docs | 067 | — |
| 0165-214 | S4 | WC-hygiene | 079 | — |
| 0165-215 | S4 | WA-docs | 067 | — |
| 0165-216 | S4 | WA-docs | 067 | — |
| 0165-217 | S4 | WA-docs | 067 | — |
| 0165-218 | S4 | WC-hygiene | 079 | — |
| 0165-219 | S4 | W3-shell-seam | 037 | — |
| 0165-220 | S4 | WB-test | 073 | — |
| 0165-221 | S4 | WA-docs | 067 | — |
| 0165-222 | S4 | WA-docs | 067 | — |
| 0165-223 | S4 | WB-test | 073 | — |
| 0165-224 | S4 | WC-hygiene | 075 | — |
| F9 | S3 | W0-governance | 003 | fixed (step 003, twin 0165-066) |
| F10 | S3 | W0-governance | 004 | fixed (step 004, twin 0165-067) |
| F11 | S3 | WA-docs | 065 | — (twin 0165-068) |
| F12 | S3 | WA-docs | 065 | — (twin 0165-069) |
| F13 | S4 | W0-governance | 008 | — (twin 0165-178) |
| F14 | S3 | WA-docs | 070 | — (twin 0165-070) |
| F15 | S4 | WA-docs | 066 | — (twin 0165-179) |
| F16 | S4 | WA-docs | 066 | — (twin 0165-180) |
| F17 | S4 | WA-docs | 065 | — (twin 0165-181) |
| F18 | S2 | WA-docs | 065 | — (twin 0165-007) |
| F19 | S3 | WA-docs | 065 | — (twin 0165-071) |
| F20 | S4 | WA-docs | 065 | — (twin 0165-182) |
| F21 | S4 | WA-docs | 065 | — (twin 0165-183) |
| F22 | S3 | W0-governance | 005 | fixed (step 005, ruling 0167) |

## Current position

- **Active step**: none. Steps 001–007 are `done` (init; w0-index-navigation @8f2dca4a8; w0-category-scope @2d02f8bfa; w0-0132-enactment @2e266c6ed; w0-premise-guard @087244460 — ruling 0167; w0-constitution-wording @c4fb131f7; w0-handover-bound — ruling 0168). W0-governance's findings 0165-018/060/061/065/066/067/101/132/176/201, F9/F10/F22 are `fixed`; only step 008 (F13/178) remains in W0. The first `todo` in table order is step 008.
- **Latest session (2026-11-05, worker)**: steps 004–007 executed. 004: 0132's Category scope corrected + family-check held-row fix. 005: ruling 0167 (the premise guard, F22) + the SERVER_ENV ratchet (0165-201). 006: constitution wording — P10's PLAN_VERIFY line (0165-101), the security family's letter (0165-132). 007: ruling **0168-steer-chain-bound** (0165-018, S2) — the continuation chain counts in `HandoverState`, advises at 10 in the whole/subtask/fix prompts, blocks for the person at 20 through the engine's existing blocked verdict; two chain regressions in test/execute-handover.test.ts.
- **Modified/created files**: this program + step records 004–007; rulings `plans/0167-premise-guard.md`, `plans/0168-steer-chain-bound.md` (created) + their INDEX rows; `plans/0132-sealed-reference-wall.md`, `plans/0165-review/tools/family-check.ts`; `AGENTS.md` (convention line, security family, handover navigation line); `docs/principles.md` (P10 line, family row); `src/execute.ts`, `src/wrapup.ts`, `src/prompt.ts`, `src/agent/opencode/server.ts`; `templates/prompts/{whole,subtask,fix}.md`; `test/execute-handover.test.ts`, `test/agent-env.test.ts`.
- **Commands and results**: `bun typecheck` exit 0 (every step); execute-handover 12 pass, agent-env 16 pass, prompt suites 179+27 pass, wrapup/verify-loop green, agent-fake 130 pass; family-check 0132/0167 ok (0168 post-commit; 0126/0138 flags remain, owned/dangling per step-004's record); probes P1/P2/P4/P5 clean, P3's flags pre-existing placeholder-class.
- **Unresolved problems**: none blocking. Standing: 0126's imprecision (final audit, step 080); 0138's flags at step 030; the security family's declined warning re-openable at step 020; the resumed-chain count restart (0168 D2's named floor).
- **Next action**: step **008 (w0-tag-disposition)** — Release-tag disposition (F13): ruling that the tag rides the explicitly instructed cut; findings 0165-178, F13. Evidence: the register rows and 0165's release-audit section. The worker continues with steps 009+ (entering W1) while its budget allows.

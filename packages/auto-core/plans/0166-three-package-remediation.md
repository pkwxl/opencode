# 0166 — The three-package remediation: a committed, resumable program

Status: **active**. Initialized 2026-11-05 (step 001); protocol amended the same day at the maintainer's instruction — a worker completes consecutive committed steps until its time budget runs low, not one; amended again 2026-11-06 at the maintainer's instruction — a worker stops beginning new work only inside the last hour of its budget, and begins a next step even when it plausibly will not finish inside the budget, because the next run resumes unfinished work; amended again 2026-11-06 at the maintainer's instruction — the idle-time scheduling is removed: every invocation performs the work directly, the protocol is identical whether the session is an ordinary interactive run or any unattended task, and no invocation ever launches an idle-time task; amended again 2026-11-07 at the maintainer's instruction — the coordinating invocation may delegate each step's work to one child working session launched sequentially (one step at a time, each committed before the next begins), the child performing the step's work directly under the same worker rules. See Program status below.

This document carries the executable prompt for completing the fix program proposed by
[0165](./0165-three-package-review.md). The work runs as a sequence of independent,
single-session steps: each invocation of the executable prompt recovers any unclean
predecessor state, then completes consecutive proper steps — each individually verified
and committed before the next begins — until its time budget no longer safely admits
another step or the program has no subsequent work. The protocol does not know or care
whether the invocation runs as an idle-time task, and it never launches one. The
program's durable position lives in this document and under
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

Run the following prompt from `packages/auto-core`. The same text is used for every
invocation; each invocation performs the whole protocol directly and never schedules
another task.

```text
Execute the next scheduled step of the post-0165 remediation program.

You are the worker. This protocol has no role split and no scheduling: the
invocation reading this prompt performs the work directly, and behaves
identically whether it runs as an ordinary interactive session or any
unattended task — it neither knows nor needs to know which.

Never call OffPeakCreate, OffPeakList, CronCreate or any other scheduling
facility, and never launch an idle-time task; a later manual invocation of
this same prompt resumes the program. Do not use subagents, Agent,
CreateWorkflow, background agents, or other child working sessions. Ordinary
build, test and git subprocesses are allowed. Do not ask the maintainer to
select work or approve the next step. Do not push, tag, publish or create a
release without an explicit instruction.

AUTHORITATIVE INPUT

- plans/0166-three-package-remediation.md, this program's durable home.
- plans/0166-remediation/, containing step records and the coverage ledger.
- plans/0165-three-package-review.md, especially §3, §5, §9 and §10.
- The finding's named plans/0165-review/Sxx-*.md record for its evidence,
  reproduction and proposed remedy.
- AGENTS.md, docs/principles.md, docs/structure.md and plans/INDEX.md.

PART A — REMAINING-WORK GATE

Perform this part before any remediation work.

1. Read the program's status table, coverage ledger and current-position
   section. Determine whether subsequent work exists. Subsequent work means a
   `doing`, `todo` or recoverable incomplete step, an unfinished final audit,
   or an uninitialized program on the first invocation.
2. If no subsequent work exists, terminate immediately with a short statement
   that the remediation program is complete. Do not inspect findings and do
   not make any edits.
3. If subsequent work exists, proceed directly to Part B in this same
   session. Never schedule the work onto another task.

PART B — WORKER: CONSECUTIVE COMMITTED, RECOVERABLE STEPS

The session may run under a time budget and may be terminated at any point;
treat every moment as a possible interruption. It completes whole proper
steps one at a time — each recovered, executed, verified and committed
before the next begins — and keeps accepting further steps while its budget
safely allows: when a budget is known (for example a limit stated at
invocation), a next step is begun while more than one hour of it remains,
even when that step plausibly will not finish inside the remaining budget,
because an interrupted step is recoverable by the next invocation; when no
budget is known, continue step by step until the maintainer stops the
session or no subsequent work exists. Write recovery state early and often,
keep a closing margin for verifying and committing the in-flight step, and
never schedule a successor — a later invocation of this same prompt resumes
the program.

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
session — a session completes several steps per invocation. If a wave is
too large, give it explicitly scoped steps while preserving requirement-family
completeness.

WORKER STARTUP AND UNCLEAN-STATE RECOVERY

1. Read AGENTS.md, the program and the active step record. Read only the
   detailed 0165 evidence needed for that step; do not re-review the corpus.
   Re-read the program's status table and current position from disk at the
   start of every session and again after any conversation pause — the program
   may have advanced through another invocation in the meantime, and conversation
   memory is never the position authority (a resumed session once reopened a
   step another invocation had already completed).
2. Inspect `git status`, relevant diffs and recent commits. An unclean tree is
   expected after interruption and is not, by itself, a reason to stop.
3. Select the first `doing` step in table order. If the tree contains work
   from a previous invocation but no step is marked `doing`, reconstruct the
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
- If the step cannot be completed before the session ends, leave it
  `doing` with its changes intact and a precise recovery record. Do not make a
  WIP commit and do not schedule a successor.
- Time budget (the maintainer's instruction of 2026-11-06, replacing the earlier
  30-minute rule, made budget-agnostic the same day): if the session has a known
  time limit, stop beginning new work inside its last hour and use that margin
  to verify and commit the in-flight step and write the closing report; while
  more than 1 hour remains, do not stop — proceed to the next step, even if it
  plausibly cannot be completed in the remaining time, because unfinished work
  is resumable on the next run (leave it `doing` with its changes intact and a
  precise recovery record, as above). If no time limit is known, continue step
  by step until the work is done or the maintainer stops the session, still
  writing recovery state before any long operation. Never rush a step's
  verification to squeeze it inside a budget — an honestly unfinished step is
  recoverable, a rushed verdict is not.

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
   verified changes intact for the next invocation rather than weakening checks
   or discarding work.
5. After a successful commit, inspect the tree and note the commit SHA and
   any remaining unrelated changes. Do not create a second bookkeeping-only
   commit merely to write that SHA into the program; recover it from git
   history instead.
6. Check the remaining budget. If it safely admits another step (more than
   1 hour remains before a known time limit, or no limit is known) and
   subsequent work exists, accept the next step — even when it plausibly will
   not finish inside a known remaining budget, since the next invocation
   resumes it: update the current-position section, select the first `todo` in
   table order, mark it `doing`, record the date and starting HEAD, create its
   durable step record, and run it under these same rules. Otherwise stop
   beginning new work and finish with the report below.

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
invocations terminate immediately at the Part A gate, without any scheduling.
```


## Program status

Initialized 2026-11-05 at HEAD `5d5e427bf` by step 001. Prescribed order (the executable prompt's initialization clause): **W0 → W1 → W6 → W2 → W5 → W4 → W3 → W7 → W8 → W9 → WD → WE → WF → WA → WB/WC**, with every standalone bucket present in the register placed at a dependency-appropriate position: W-release and W-cleanroom-policy directly after W6 (their surfaces are W6's git/script family), W-secrets after W2 (the S17 keyring family), W-session and W-engine after W5 (runtime control first, then the layers it calls), W-fork and W-land after W4 (the isolation family), the manual-driver suite (W-manual-subtasks → W-manual-fix → W-manual-vocabulary → W-manual-ratchet) after W7 (it mirrors the verification loop W7 rules), W-round-docs after W8 (the round-brief grammar amends the surface W8 touches), W-provenance / W-config / W-template-copy after W9, W-server-trust immediately before WF, W-vocab after WA (its tombstone enactment consumes WA's deprecation-lifecycle ruling), W-tests beside WB.

Conventions: one step = one committed unit (a session completes several steps per invocation, and a step interrupted at a time limit or session end is left `doing` and resumed by the next invocation); the findings column uses bare numbers for `0165-NNN` and verbatim `F…` ids; the union finding `006` (∪15) is enacted jointly by steps 010+011; step 072 coordinates with step 064 (one test repair, two register rows: 058 and 223); steps 079/080 are program-level — the release assessment performs no act of the cut itself (explicit instruction only, after the W1/W6 gate). Step records live under [`0166-remediation/`](./0166-remediation/) and are created by their own step, not pre-created.

| # | step | wave | findings | record | status | start HEAD | verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 001 | init — Program initialization: status table, coverage ledger, current position (this step) | program | — | [001](./0166-remediation/001-init.md) | **done** 2026-11-05 | 5d5e427bf | completeness script OK; typecheck clean |
| 002 | w0-index-navigation — INDEX grammar/order repair, stale code homes, AGENTS.md navigation R4 reduction | W0-governance | 060 061 065 176 | [002](./0166-remediation/002-w0-index-navigation.md) | **done** 2026-11-05 | 9e61f6e0b | probe P1+P2 empty; arrows/pointers zero-loss; typecheck clean |
| 003 | w0-category-scope — Category scope resumption for the 22 lapsed rulings (0142–0161, 0163, 0164) | W0-governance | 066 F9 | [003](./0166-remediation/003-w0-category-scope.md) | **done** 2026-11-05 | 8f2dca4a8 | family-check 22/22 ok; probe P4 empty; typecheck clean |
| 004 | w0-0132-enactment — 0132 enactment completion: config-fix.ts and document/roles.ts homes the ruling marked | W0-governance | 067 F10 | [004](./0166-remediation/004-w0-0132-enactment.md) | **done** 2026-11-05 | 1cb15639a | family-check 0132 ok; probe P1–P4 clean; typecheck clean |
| 005 | w0-premise-guard — Premise-drift guard line ('premises this ruling changes') + SERVER_ENV drift ratchet | W0-governance | 201 F22 | [005](./0166-remediation/005-w0-premise-guard.md) | **done** 2026-11-05 | 2e266c6ed | typecheck clean; agent-env 16 pass; probe P1–P5 clean; family-check 0167 ok |
| 006 | w0-constitution-wording — Constitution wording: PLAN_VERIFY kill-switch line, security-family statement vs code | W0-governance | 101 132 | [006](./0166-remediation/006-w0-constitution-wording.md) | **done** 2026-11-05 | 087244460 | zero false letters repo-wide; probes clean (P3 pre-existing placeholders); typecheck clean |
| 007 | w0-handover-bound — Context-handover chain bound + advisory (execute.ts) | W0-governance | 018 | [007](./0166-remediation/007-w0-handover-bound.md) | **done** 2026-11-05 | c4fb131f7 | execute-handover 12 pass; prompt suites green; agent-fake 130 pass; typecheck clean |
| 008 | w0-tag-disposition — Release-tag disposition (F13): ruling that the tag rides the explicitly instructed cut | W0-governance | 178 F13 | [008](./0166-remediation/008-w0-tag-disposition.md) | **done** 2026-11-05 | ad96f96db | tag evidence re-verified; releases.md records the missing anchor; typecheck clean |
| 009 | w1-survey-marks — Ruling doc + survey-gate person marks: mark-gated brief install, zero-fork hold, near-miss forks, section-scoped release mark | W1-person-marks | 001 002 | [009](./0166-remediation/009-w1-survey-marks.md) | **done** 2026-11-05 | 2f0229815 | full suite 2924 pass; typecheck clean; family-check 0169 ok |
| 010 | w1-verdict-provenance — Verdict-document provenance (006 part 1): report.md vs verifier FAIL, todo→done self-rename, agent-written Choice | W1-person-marks | 006 | [010](./0166-remediation/010-w1-verdict-provenance.md) | **done** 2026-11-05 | d2ebaf20c | full suite 2935 pass; typecheck clean; fail-before proven (3 regressions red on pre-fix src) |
| 011 | w1-receipt-marker-provenance — Verdict-surface provenance (006 part 2): receipts and test marker by location, formulation surfaces, handover document ownership | W1-person-marks | 006 (part 2) | [011](./0166-remediation/011-w1-receipt-marker-provenance.md) | **done** 2026-11-06 | 4992d423c | full suite 2945 pass; typecheck clean; 9 regressions fail-before proven (1 fail each on pre-fix src) |
| 012 | w1-choice-analysis-boundary — Choice execution dead-end (run/plan) + analysis.md write boundary | W1-person-marks | 025 093 | [012](./0166-remediation/012-w1-choice-analysis-boundary.md) | **done** 2026-11-06 | 96b4b6c71 | full suite 2950 pass; typecheck clean; 3 regressions fail-before proven |
| 013 | w6-release-baseline — Release baseline walk past trailer-less commits, trailer-block witness, foreignCommits range semantics, the unruled git-hooks question | W6-git | 004 140 141 142 | [013](./0166-remediation/013-w6-release-baseline.md) | **done** 2026-11-06 | 8dc8e42c8 | full suite 2961 pass; typecheck clean both packages; 8 regressions fail-before proven |
| 014 | w6-failure-direction — Failure-direction stragglers: repoRoots unreadable, receipt nested-diff coverage, subtree confinement, nestedHeads empty sha | W6-git | 035 036 110 138 204 | [014](./0166-remediation/014-w6-failure-direction.md) | **done** 2026-11-06 | a6ac2374c | full suite 2972 pass; typecheck clean both packages; 7 regressions fail-before proven; shell's 5 fork failures pre-existing (reproduced at HEAD) |
| 015 | w6-guard-lane-output — Script guard revert-class, lane process-group kill, bounded script output, doc-lane beginUnit dedup | W6-git | 020 021 108 139 | [015](./0166-remediation/015-w6-guard-lane-output.md) | **done** 2026-11-06 | e649c169b | full suite 2979 pass; typecheck clean both packages; 9 regressions fail-before proven; the unborn-repo floor caught by the turn-trace oracle |
| 016 | w-release — Release clean-tree check fails loud on unreadable git | W-release | 034 | [016](./0166-remediation/016-w-release.md) | **done** 2026-11-06 | 099dd4482 | full suite 2980 pass; typecheck clean both packages; the S19-02 repro fail-before proven |
| 017 | w-cleanroom-policy — Cleanroom audit findings owner + raw-log boundary enforcement for the source-free receipt rule | W-cleanroom-policy | 051 052 | [017](./0166-remediation/017-w-cleanroom-policy.md) | **done** 2026-11-06 | 5eda65465 | full suite 2982 pass; typecheck clean both packages; 4 pins fail-before proven |
| 018 | w2-restart-sync — Managed-host restart synchronization: rekey as a safe-boundary act, double-spawn, walk bound | W2-keyring | 057 | [018](./0166-remediation/018-w2-restart-sync.md) | **done** 2026-11-06 | 9fcd1a38a | full suite 2989 pass; typecheck clean both packages; 3 regressions fail-before proven (D1/owed/double-spawn); 0163's INDEX row annotated |
| 019 | w2-ring-wait-vocab — recoveryAt ring wait vs stated resets + retired skip-flag vocabulary lockstep | W2-keyring | 126 199 | [019](./0166-remediation/019-w2-ring-wait-vocab.md) | **done** 2026-11-06 | ea4504a2f | full suite 2989 pass; typecheck clean both packages; the scheduled-ring oracle fail-before proven |
| 020 | w-secrets — Credentialed URL masking, env-overlay name echo, X1 scrub gaps (claude --version child) | W-secrets | 130 131 133 | [020](./0166-remediation/020-w-secrets.md) | **done** 2026-11-06 | 34c570655 | full suite 2991 pass; typecheck clean both packages; 3 pins + the census fail-before proven |
| 021 | w5-sideband — The --interactive sideband detach family | W5-control | 010 | [021](./0166-remediation/021-w5-sideband.md) | **done** 2026-11-06 | 1492855d5 | full suite 2993 pass; typecheck clean both packages; both pins fail-before proven |
| 022 | w5-sleeps-signals — /exit-wakeable sleeps, SIGTERM/SIGHUP handler, startup hibernate ordering, /exit-as-answer | W5-control | 087 088 091 092 | [022](./0166-remediation/022-w5-sleeps-signals.md) | **done** 2026-11-06 | 37dd96db0 | full suite 2996 pass; typecheck clean both packages; 3 pins fail-before proven; the suspend oracle re-pointed to sleepUnlessExit |
| 023 | w5-lock-carryover-progress — Lock pid-space identity, carryover classification, progress-record atomic write, unreadable HEAD, run-start line truth | W5-control | 090 112 113 114 115 | [023](./0166-remediation/023-w5-lock-carryover-progress.md) | **done** 2026-11-06 | 12ce72c25 | full suite 3009 pass; typecheck clean both packages; 17 pins fail-before proven; the park-flow rename race caught by the suite |
| 024 | w5-resume-reanchor — Resume re-anchor: charter commit-range truth, trailer-less commits inside the audit | W5-control | 023 024 | [024](./0166-remediation/024-w5-resume-reanchor.md) | **done** 2026-11-06 | 2ba7172cf | full suite 3015 pass; typecheck clean both packages; 4 pins fail-before proven (+ the absent helper's file-level error) |
| 025 | w-session-fault-classes — Driver-fault reclassification, in-flight claim timing, overflow handover path, restart pattern match | W-session | 026 027 028 029 | [025](./0166-remediation/025-w-session-fault-classes.md) | **done** 2026-11-06 | 129421a79 | full suite 3021 pass; typecheck clean both packages; 4 pins fail-before red + the driver-fault hang demonstrated; the §4.5 pin caught the draft window filter (withdrawn in-change) |
| 026 | w-session-ask-restart — askHuman closed-stdin, concurrent host restart serialization, session-driving hygiene | W-session | 116 117 196 | [026](./0166-remediation/026-w-session-ask-restart.md) | **done** 2026-11-07 | d203914ff | full suite 3024 pass; typecheck clean both packages; 3 pins fail-before red (the closed-stdin child and ambient-parse timeouts, the 3-spawn count); the step record's withdrawn probe-rethrow draft caught at resume review |
| 027 | w-engine — Half-open probe, step-up re-fire, poisoned emission chain, mid-turn steer settle | W-engine | 030 118 119 120 | [027](./0166-remediation/027-w-engine.md) | **done** 2026-11-07 | 65b5d614c | full suite 3035 pass; typecheck clean both packages; 5 pins + the 5 s trace timeout fail-before proven (the D2 repro's entry widened in-change); the two goldens re-blessed + the new stream-silent golden |
| 028 | w4-matcher-oracle — The opencode-matcher oracle + 0147 edit-deny pattern + stamp-placement catch-all spellings | W4-wall-perms | 039 150 | [028](./0166-remediation/028-w4-matcher-oracle.md) | **done** 2026-11-07 | 29f7ee1ce | full suite 3042 pass; typecheck clean both packages; 4 proof tests fail-before red per behavior (the three spellings' quiet kills named, both edit asks reading allow); the classification list caught by the agreement pin in-change |
| 029 | w4-wall-doors — Wall close/doors: outside-transfer skip, recovery sweep, closed predicate, close-before-gates ordering, false remedies | W4-wall-perms | 008 037 038 076 149 | [029](./0166-remediation/029-w4-wall-doors.md) | **done** 2026-11-07 | d8cc63149 | full suite 3056 pass; typecheck clean both packages; 8 wall + 4 loop + 1 fix pins fail-before proven (037's /tmp refusal received verbatim); external-dirs' evaluator pins import-only pre-fix (the behavioral fail-before carried by the wall suite); shell back at its 149/8/5 baseline after the ruled entry-word e2e pin |
| 030 | w4-claude-boundary — Claude adapter boundary translation + wall commit message staleness vs 0138 | W4-wall-perms | 040 147 | [030](./0166-remediation/030-w4-claude-boundary.md) | **done** 2026-11-07 | 9c0152b97 | full suite 3062 pass; typecheck clean both packages; 8 pins fail-before proven; shell back at its 149/8/5 baseline after the two wall e2e tests were reshaped into D1's refusal pins (the close vocabulary stays at auto-core's suites) |
| 031 | w-fork — Nested-of-nested worktrees, symlinked paths, failure cause reporting, reflog claim; lane digest identity (W-fork/W-lanes) | W-fork | 143 144 145 146 085 | [031](./0166-remediation/031-w-fork.md) | **done** 2026-11-07 | 56fe125b8 | full suite 3071 pass; typecheck clean both packages; 8 fork pins + the lanes file-level red fail-before proven (the digest defect shown at runtime by probe, two digests for one directory); shell back at its 149/8/5 baseline after the five laneBranch pins' await lockstep |
| 032 | w-land — land's original-branch derivation ruling | W-land | 148 | [032](./0166-remediation/032-w-land.md) | **done** 2026-11-07 | 8a4907697 | full suite 3075 pass; typecheck clean both packages; 5 land pins + 2 e2e pins fail-before proven (the deleted-original wrong-branch landing shown red); shell 150/8/5 (baseline + the new --onto e2e) |
| 033 | w3-core-seam — One core init/amend sequence, one option/banner/hint emitter family, shared fake fixture (the shell mirror ∪7) | W3-shell-seam | 056 | [033](./0166-remediation/033-w3-core-seam.md) | **done** 2026-11-07 | 7b7a923f2 | core 3089 pass 0 fail + typecheck clean; auto 151/8/5 (baseline+1, the 5 pre-existing); server typecheck clean (was red at HEAD — the detach lockstep miss), own suites green, full-suite baselines measured both ways (ambient 118/18 environmental, clean-env 137/1 with the 1 = known 0165-220); ∪7 fixed with fail-before red per member + the in-family detach discovery |
| 034 | w3-services-allowlist — services() allowlist evasion in auto-server's worker-interactive | W3-shell-seam | 089 | [034](./0166-remediation/034-w3-services-allowlist.md) | **done** 2026-11-07 | 15873713a | core 3090 pass 0 fail + typecheck clean; auto 153/8/5 (baseline + the 2 guards; the 5 pre-existing); server 139/1 ambient and clean-env alike (the 1 = known 0165-220; the step-033 ambient 118/18 no longer reproduces — pre-fix sources measured 137/1 today, environment drift, both ways identical); the server scan + the core seam pin fail-before red; SERVICE_ENTRIES unchanged |
| 035 | w3-parser-polish — CLI parser polish: extra positionals, --flag=value validation, -- flood, phasesLine remedy | W3-shell-seam | 166 167 211 212 | [035](./0166-remediation/035-w3-parser-polish.md) | **done** 2026-11-07 | 2c2aba422 | auto 158/8/5 (baseline+5; the 5 pre-existing, re-verified on pre-fix src) + typecheck clean; core 3090/0 unchanged; server 139/1 (the 1 = known 0165-220); 5 reds fail-before proven (4 token-form pins + the widened _lane column's twelve); D5 pinned at the shell over 0193 D1 |
| 036 | w3-exports-ruling — The exports ruling: entry modules vs the open ./* boundary (§9-3) | W3-shell-seam | 174 | [036](./0166-remediation/036-w3-exports-ruling.md) | **done** 2026-11-07 | 26bf36670 | core 3092/0 (baseline +2) + typecheck clean; auto 160/8/5 (baseline +2; the 5 = the pre-existing fork family, identical names) + typecheck clean; server 142/0 (baseline 139/1 with the known 0165-220 race passing this run; +2) + typecheck clean; the blindness itself fail-before-proven (a crafted git-ops→blockage import passes the pre-fix suite 12/12 — that pass is the finding) with the guard, the stale arm, the exports pin and the reach-around guard each red on crafted/real drift |
| 037 | w3-server-entry-hygiene — Service-shell entry hygiene: stale refusal texts, token-name fallback, run-id shapes | W3-shell-seam | 219 | [037](./0166-remediation/037-w3-server-entry-hygiene.md) | **done** 2026-11-07 | 1a43601e2 | server 143/1 (144 = 142 baseline +2 new; the 1 = the known 0165-220 observe race, verified by name, 9/0 on 3 file re-runs) + typecheck clean; core 3092/0 + typecheck clean (baseline); auto 160/8/5 (baseline, no auto src touched); all five code defects fail-before red on pre-fix source (D5's red IS the finding: Bun.serve's RangeError stack trace) |
| 038 | w7-progress-bound — The oscillating-gap progress bound (the ruled 2+N made true) + charter clamp first-line | W7-verify | 003 022 | [038](./0166-remediation/038-w7-progress-bound.md) | **done** 2026-11-07 | 9af47c2d5 | core 3096/0 (baseline +4) + typecheck clean; auto 160/8/5 (the exact baseline, guard run); 4 pins fail-before proven (the oscillation pin red with the old PASS-escape reproduced; the three clamp pins red each on its own defect shape) |
| 039 | w7-marker-scan — Proxy-answer scan scoped to the session's diff + dead-marker consumption on the verify FAIL path | W7-verify | 109 111 | [039](./0166-remediation/039-w7-marker-scan.md) | **done** 2026-11-07 | 445ea0a00 | core 3099/0 (baseline +3) + typecheck clean; auto 160/8/5 (the exact baseline, guard run); 2 pins fail-before proven (the re-booking pin red with {resolves:1, decisions:2}; the FAIL-consume pin red with the misattributed block received verbatim) |
| 040 | w-manual-subtasks — Subtask companions' independent verification (the S1 bypass) + phase selection, resume gate, recommit | W-manual-subtasks | 005 048 053 164 | [040](./0166-remediation/040-w-manual-subtasks.md) | **done** 2026-11-07 | 1b037acbf | core 3103/0 (baseline +4) + typecheck clean; auto 160/8/5 (the exact baseline, guard run); 5 ratchet arms fail-before red on the pre-fix prompt sources (23/23 old green on them) |
| 041 | w-manual-fix — Manual fix subject ordinal + the countable gap grammar the master counts | W-manual-fix | 049 050 | [041](./0166-remediation/041-w-manual-fix.md) | **done** 2026-11-07 | 29d7d7856 | core 3105/0 (baseline +2) + typecheck clean; auto 160/8/5 (the exact baseline, guard run); 2 ratchet arms fail-before red on the pre-fix prompt sources (28/30 old green on them) |
| 042 | w-manual-vocabulary — 0148 short-title grammar completion across the manual suite | W-manual-vocabulary | 163 | [042](./0166-remediation/042-w-manual-vocabulary.md) | **done** 2026-11-07 | ea418e0bd | core 3106/0 (baseline +1) + typecheck clean; auto 160/8/5 (the exact baseline, guard run); 3 ratchet arms fail-before red on the pre-fix prompt sources (the 0202 arm + the two flipped pins; 28 old green on them) |
| 043 | w-manual-ratchet — The ratchet pins ruled relationships, not just vocabulary presence | W-manual-ratchet | 165 | [043](./0166-remediation/043-w-manual-ratchet.md) | **done** 2026-11-07 | 93c4f7f37 | core 3107/0 (baseline +1) + typecheck clean; auto 160/8/5 (the exact baseline, guard run); 8 drifts fail-before proven (old ratchet 31/0 blind over each, the new arm red 31/1, producers restored byte-identical) |
| 044 | w8-clarify-state — clarify's state resolution + the review print's round-brief proposals | W8-planning | 012 096 | [044](./0166-remediation/044-w8-clarify-state.md) | **done** 2026-11-07 | dc75d2154 | core 3111/0 (baseline +4) + typecheck clean; auto 160/8/5 (the exact baseline, guard run); 4 pins fail-before red on pre-fix src (the 7 old green on it — the floor) |
| 045 | w8-formulation-reconstruction — Formulation todo reconstruction, --new-task overwrite guard, synthDigest durability | W8-planning | 014 015 100 | [045](./0166-remediation/045-w8-formulation-reconstruction.md) | **done** 2026-11-07 | 7293d51bb | core 3117/0 (baseline +6) + typecheck clean; prompt suites 154/0 (guard); 6 pins fail-before red on pre-fix src (the 31 pre-existing in the touched files green on it — the floor) |
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
| 0165-001 | S1 | W1-person-marks | 009 | fixed (step 009, ruling 0169) |
| 0165-002 | S1 | W1-person-marks | 009 | fixed (step 009, ruling 0169) |
| 0165-003 | S1 | W7-verify | 038 | fixed (step 038, ruling 0198 D1 — the progress rule keys on the loop's best, the minimum its FAILs have measured: an oscillating count never beats its own low twice and blocks like any stall, the bound 2N+2 stated where 0146's 2+N stood; the persisted `gaps` field's meaning becomes the best, monotone/constant sequences byte-identical, the block message verbatim) |
| 0165-004 | S1 | W6-git | 013 | fixed (step 013, ruling 0173) |
| 0165-005 | S1 | W-manual-subtasks | 040 | fixed (step 040, ruling 0200 D1 — both companions' Stage 3 is the task-level verification loop: a fresh verification child judging ## Scope/## Acceptance by inspection of the committed range (the baseline the parent of the task's first `Auto-Task: T-NNN` commit), the countable gap list on FAIL, fix rounds under the best-count progress rule, the master's close-out on PASS; the narrative wrap-up and its self-report channel retired; the verdict strings run-verify.md's frozen pair; the report the verification's alone in evidence form) |
| 0165-006 | S1 | W1-person-marks | 010+011 | fixed (step 010, ruling 0170 part 1 — S11-01/S12-01/S12-02; step 011, ruling 0171 part 2 — S11-04, S20-05, S08-04/06/08, S10-01/02/07; the ∪15 union fully dispositioned) |
| 0165-007 | S2 | WA-docs | 065 | — |
| 0165-008 | S2 | W4-wall-perms | 029 | fixed (step 029, ruling 0189 D1 — the seal-due handover holds on every path but transfer's advance, naming transfer; the completed re-entry's boundary stop prints the phase-closed variant) |
| 0165-009 | S2 | W9-lanes | 050 | — |
| 0165-010 | S2 | W5-control | 021 | fixed (step 021, ruling 0181 D1 — the ∪1 union's general case; S14-06's probe-specific half closed by step 027, ruling 0187 D5 — probe dispatches never attach) |
| 0165-011 | S2 | W9-lanes | 053 | — |
| 0165-012 | S2 | W8-planning | 044 | fixed (step 044, ruling 0204 D1/D3 — the analysis branch is taken only while no round is established, the gate's own project-start condition (`currentRound === 1 && !roundRoot(1)`, plan's rows 0a–0d / transfer's projectStart; the switch deliberately not imported — the release's consequences are posture-blind, every measured stub shape post-establishment); past the moment an unreleased analysis is one teaching, never the target — the refusal's analysis bullet a third spelling (never "is released"), one appended ℹ line beside every other non-error survey-branch result, naming the hand channel and its real consequences; named residual: pre-round + off posture + a stray valid analysis still releases with the walkthrough's continuation sentence half-unhonored) |
| 0165-013 | S2 | W8-planning | 047 | — |
| 0165-014 | S2 | W8-planning | 045 | fixed (step 045, ruling 0205 D1 — the constructor's recognition (`formulationState`) keys on the awaiting predicate: `pending` wherever the formulation todo stands, beside hand-added rows too (0101 stage C widened every dispatch predicate to that state; the constructor's own arm had stayed at "the index lists exactly one task"), the reconstruct rewriting the todo alone with the index's other rows never touched, the in-progress refusal keeping its own voice beside rows, `foreign` only when no formulation task of the phase is listed) |
| 0165-015 | S2 | W8-planning | 045 | fixed (step 045, ruling 0205 D2 — the review-seam fixed prefix: while the standing todo is pending (never a ran/blocked one, whose crashed rows stay rewritable per 0141 D2 — that state's prefix reads back from the landed todo's own `Prefix:` field), the floor renders the phase's other rows into the todo as a fixed-prefix block and the numbering start becomes the deterministic floor (the same derivation addTask allocates from — the taught number can never be one the add already took); the digest moves with an add so the keep misses and the 0101 D4 discipline routes through transfer's reconstruct; the collect backstop at the first dispatch derives the pre-session rows from the unit-start git baseline (`contentAtBase`, a failed read degrading to the unchecked floor) — rows present, in order, unchanged, documents byte-identical, ids skipped per-task; the `Formulate:`/`Closed:` guard extends to the two new fields; residuals named: an add while blocked and a killed-then-resumed first dispatch are guarded by the teaching alone) |
| 0165-016 | S2 | W-round-docs | 049 | — |
| 0165-017 | S2 | W9-lanes | 051 | — |
| 0165-018 | S2 | W0-governance | 007 | fixed (step 007, ruling 0168) |
| 0165-019 | S2 | WC-hygiene | 077 | — |
| 0165-020 | S2 | W6-git | 015 | fixed (step 015, ruling 0175 D1) |
| 0165-021 | S2 | W6-git | 015 | fixed (step 015, ruling 0175 D2) |
| 0165-022 | S2 | W7-verify | 038 | fixed (step 038, ruling 0198 D2 — the clamp's document rewrite content-proven: the recorded line number a hint accepted only when the line parses to the item's exact question (normalize-equality, never substring) and option; a moved marker found by the content search; no match or an ambiguous duplicate ledger-clamped only, the ⚡ OPEN line still surfaced; `normalize` exported as the one normalization home, `sameIssue` unchanged for pairing) |
| 0165-023 | S2 | W5-control | 024 | fixed (step 024, ruling 0184 D1) |
| 0165-024 | S2 | W5-control | 024 | fixed (step 024, ruling 0184 D2 — the trailer-block criterion itself already 0173 D2's) |
| 0165-025 | S2 | W1-person-marks | 012 | fixed (step 012, ruling 0172) |
| 0165-026 | S2 | W-session | 025 | fixed (step 025, ruling 0185 D1) |
| 0165-027 | S2 | W-session | 025 | fixed (step 025, ruling 0185 D2) |
| 0165-028 | S2 | W-session | 025 | fixed (step 025, ruling 0185 D3) |
| 0165-029 | S2 | W-session | 025 | fixed (step 025, ruling 0185 D4) |
| 0165-030 | S2 | W-engine | 027 | fixed (step 027, ruling 0187 D1 — the probe judges the stream, not only the server: the heartbeat mapped additively, the pulse wrapper at the watch seam, the streamAlive verdict leg, the silent-stream half-open judgment) |
| 0165-031 | S2 | WD-routing | 057 | — |
| 0165-032 | S2 | WD-routing | 057 | — |
| 0165-033 | S2 | WD-routing | 058 | — |
| 0165-034 | S2 | W-release | 016 | fixed (step 016, ruling 0176) |
| 0165-035 | S2 | W6-git | 014 | fixed (step 014, ruling 0174 D3) |
| 0165-036 | S2 | W6-git | 014 | fixed (step 014, ruling 0174 D1) |
| 0165-037 | S2 | W4-wall-perms | 029 | fixed (step 029, ruling 0189 D2 — the recovery adopts only git-proven door targets (the door's last add/modify content, HEAD first), the stamp slot classifying allow/deny/absent; unprovable allows left alone, covered ones blocking through the split) |
| 0165-038 | S2 | W4-wall-perms | 029 | fixed (step 029, ruling 0189 D3 — the door half walks tracked symlinks at any depth plus top-level untracked ones (under/at/over a recorded target, dangling counted by its pointer), the allow half evaluates coverage with opencode's semantics (admittingCoverage, oracle-pinned; non-deny = open, the winner named), and fix never stamps allows past a recorded wall target; 0155's ask-invisible residual closed with it) |
| 0165-039 | S2 | W4-wall-perms | 028 | fixed (step 028, ruling 0188 D3 — the read-only edit deny stamped in the forms the live tools ask: the target's real path kept, the worktree-relative `../<rel>/**` anchored at git's toplevel, and the door name — pinned by the admission oracle on the v1 tool's ask shapes) |
| 0165-040 | S2 | W4-wall-perms | 030 | fixed (step 030, ruling 0190 D1 — the carried posture a declared capability (`AgentCapabilities.externalDirectory`, opencode true, claude explicitly false, the fallback record false), the fleet intersection threading it beside leadSplit to `WallCtx`, the close refusing loudly ahead of the admission scan under a non-carrying fleet (nothing mutated, the door standing, the line teaching the opencode advance), status rendering the limit over the static agent choice; the translation arm declined on P19 grounds and kept in step 058 with finding 033 — the capability seam makes its flip one declared value) |
| 0165-041 | S2 | WA-docs | 068 | — |
| 0165-042 | S2 | WC-hygiene | 076 | — |
| 0165-043 | S2 | W-provenance | 054 | — |
| 0165-044 | S2 | WE-policy | 060 | — |
| 0165-045 | S2 | WE-policy | 060 | — |
| 0165-046 | S2 | WE-policy | 060 | — |
| 0165-047 | S2 | WE-policy | 061 | — |
| 0165-048 | S2 | W-manual-subtasks | 040 | fixed (step 040, ruling 0200 D2 — the gate reads exactly one of `S<nn>/todo.md`/`done.md` per item, whichever exists carrying the Stage-1 shape checks, the checklist tick's agreement checked; the normal interrupted state no longer fails the gate) |
| 0165-049 | S2 | W-manual-fix | 041 | fixed (step 041, ruling 0201 D1 — both run.md fix-subject sites teach the driver's `nextFixSession` derivation: `<session>` one past the highest `<task id> fix <round>.<n>` subject already in the log for that round, across every repository the target holds, 1 when none exists — never the landed-share count that numbered a fresh round 0, duplicated `fix 1.1` and renumbered sparse indices; sparse indices stay sparse, the numbering keys on the log's highest) |
| 0165-050 | S2 | W-manual-fix | 041 | fixed (step 041, ruling 0201 D2 — the countable gap grammar carried into the whole-task channel: run-verify's INCOMPLETE branch writes the driver's FAIL-side form (`## Gaps`, `### Gap N — <one-line title>` per gap, closing `Result: FAIL <one-sentence reason>`, no terminator), run-fix's read-first describes the same form, and run.md shape-checks the verdict's write (one feedback relaunch, then stop), counts the `### Gap N` headings alone and states the best-count progress rule in 0198 D1's terms — the pre-0198 phrasing retired from loop step 6 and the single-mode copy alike, 0200's residual discharged) |
| 0165-051 | S2 | W-cleanroom-policy | 017 | fixed (step 017, ruling 0177 D1) |
| 0165-052 | S2 | W-cleanroom-policy | 017 | fixed (step 017, ruling 0177 D2) |
| 0165-053 | S2 | W-manual-subtasks | 040 | fixed (step 040, ruling 0200 D3 — both companions' phase selector is run.md's unticked line verbatim; the `(closed: …)` suffix retired from the selector — a digest rendering the phase close-out never writes) |
| 0165-054 | S2 | W-server-trust | 062 | — |
| 0165-055 | S2 | WF-server | 063 | — |
| 0165-056 | S2 | W-shell-seam | 033 | fixed (step 033, ruling 0193 — the ∪7 union fully dispositioned: S29-04 the bootstrap, S29-07 the frozen-key hint table, S29-08 the banner/emitter family, S30-01 the amend-phases retirement, S30-02 the root-symlink stamps, S30-04 the served-surface seam, S26-04 the `_lane` extras with the scoped guard column; beside them the in-family detach lockstep miss of worker-interactive.ts fixed in the same change, no ledger row — the register predates 0181) |
| 0165-057 | S2 | W2-keyring | 018 | fixed (step 018, ruling 0178 — the ∪5 union fully dispositioned: S17-01 the bound, S17-02 the doc-lane gate + 0099's audit item closed by decision, S17-03 the fork-skip, S16-01 the owed re-key, S17-10's walk half the no-op restart; S17-10's README/comment-drift half stays step 077 with 0165-186) |
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
| 0165-076 | S3 | W4-wall-perms | 029 | fixed (step 029, ruling 0189 D4 — the phase gates checked read-only ahead of the wall; completePhase's re-check stays the choke point) |
| 0165-077 | S3 | WA-docs | 068 | — |
| 0165-078 | S3 | WC-hygiene | 076 | — |
| 0165-079 | S3 | W9-lanes | 050 | — |
| 0165-080 | S3 | W9-lanes | 050 | — |
| 0165-081 | S3 | W9-lanes | 050 | — |
| 0165-082 | S3 | W9-lanes | 051 | — |
| 0165-083 | S3 | W9-lanes | 051 | — |
| 0165-084 | S3 | W9-lanes | 053 | — |
| 0165-085 | S3 | W-fork/W-lanes | 031 | fixed (step 031, ruling 0191 D5 — the lane branch digest keys the directory's realpath: `run /link/proj` and `run .` derive the same branch; records written before read through `resolveLaneBranch`'s evidence ladder at the four resolution sites — the landing, the re-dispatch arm, the recovery cap line, the straggler prune — the pre-fix-records upgrade seam never blocking or destroying) |
| 0165-086 | S3 | WA-docs | 067 | — |
| 0165-087 | S3 | W5-control | 022 | fixed (step 022, ruling 0182 D1) |
| 0165-088 | S3 | W5-control | 022 | fixed (step 022, ruling 0182 D2) |
| 0165-089 | S3 | W3-shell-seam | 034 | fixed (step 034, ruling 0194 — the sideband's control requests a declared core seam: `requestControl` in `src/interactive.ts` is the one route every control word takes into the run's services (the module's own three ambient reads collapsed into it, byte-identical), the worker transport rewired onto it with its header's false SERVICE_ENTRIES justification replaced, and the boundary beyond the core held by each shell's own no-ambient-services scan — the allowlist's letter now true at every package, SERVICE_ENTRIES itself unchanged; the exports question stays step 036's) |
| 0165-090 | S3 | W5-control | 023 | fixed (step 023, ruling 0183 D4) |
| 0165-091 | S3 | W5-control | 022 | fixed (step 022, ruling 0182 D3) |
| 0165-092 | S3 | W5-control | 022 | fixed (step 022, ruling 0182 D4) |
| 0165-093 | S3 | W1-person-marks | 012 | fixed (step 012, ruling 0172) |
| 0165-094 | S3 | W8-planning | 046 | — |
| 0165-095 | S3 | W8-planning | 046 | — |
| 0165-096 | S3 | W8-planning | 044 | fixed (step 044, ruling 0204 D2 — the review print lists every `### R-NN` round-brief proposal: one line per round from analysis.ts's own parser, each installing verbatim as its round's round.md and passing that round's round-start gate on the mark, plus the absent-posture line; 0116 D3's list now covers the whole proposal-install family the release puts in force) |
| 0165-097 | S3 | W8-planning | 048 | — |
| 0165-098 | S3 | W8-planning | 048 | — |
| 0165-099 | S3 | W8-planning | 048 | — |
| 0165-100 | S3 | W8-planning | 045 | fixed (step 045, ruling 0205 D3 — the floor digest's durable home is the landed todo's own driver-written `Floor-Digest:` field, committed with the todo it describes: a fresh clone, fork worktree or cleared .auto/ keeps the reviewed todo (no false "an input changed since construction", no charter re-voice — the 0097 D6 churn); the digest computation unchanged and era-compatible, the units.json synthDigest the pre-0205 fallback reader with its write retired; a pre-0205 standing todo in a fresh clone still re-constructs once — the era boundary, the named residual) |
| 0165-101 | S3 | W0-governance | 006 | fixed (step 006) |
| 0165-102 | S3 | WC-hygiene | 077 | — |
| 0165-103 | S3 | W-round-docs | 049 | — |
| 0165-104 | S3 | W-round-docs | 049 | — |
| 0165-105 | S3 | W-round-docs | 049 | — |
| 0165-106 | S3 | W9-lanes | 051 | — |
| 0165-107 | S3 | W9-lanes | 051 | — |
| 0165-108 | S3 | W6-git | 015 | fixed (step 015, ruling 0175 D3) |
| 0165-109 | S3 | W7-verify | 039 | fixed (step 039, ruling 0199 D1 — the scan's unit is the added LINE, not the changed file: a whole-file scan over changedFiles re-booked earlier tasks' committed markers under whichever task later touched the file (the dedup key carries the task id; the AUTO-DECISION count has no line-level dedup at all); the scan now reads addedLines (git.ts, new — per repository root the tracked changes diff against HEAD at -U0, pinned against the person's own diff configuration, plus untracked files whole); floors: untracked scans byte-identical, unborn-HEAD whole-file (the exact truth), a failed diff read today's whole-file, dryrun accumulation 0020 §K-10's boundary transposed; the file+question dedup remedy declined — line numbers drift, a fragile heuristic where a mechanical truth exists) |
| 0165-110 | S3 | W6-git | 014 | fixed (step 014, ruling 0174 D4) |
| 0165-111 | S3 | W7-verify | 039 | fixed (step 039, ruling 0199 D2 — the verify session's FAIL return consumes its own unservable marker through the same consumeDeadTestMarker seam as the PASS site (label `task.id`, consume + log, no block): without it the verify session's dead tmp/test.sh survived into the fix round as wiring and the round's close blocked naming the FIX session for a request it never made; the round's close now judges only its own sessions' markers; 0156 D8's FAIL-path declination amended, 0142 D1/D2 honored further) |
| 0165-112 | S3 | W5-control | 023 | fixed (step 023, ruling 0183 D1) |
| 0165-113 | S3 | W5-control | 023 | fixed (step 023, ruling 0183 D2 — handover.json in the same change) |
| 0165-114 | S3 | W5-control | 023 | fixed (step 023, ruling 0183 D3 — the composed 0155 residual closed) |
| 0165-115 | S3 | W5-control | 023 | fixed (step 023, ruling 0183 D5) |
| 0165-116 | S3 | W-session | 026 | fixed (step 026, ruling 0186 D1 — stdinAsk resolving undefined on the closed channel and at once on a non-readable stdin) |
| 0165-117 | S3 | W-session | 026 | fixed (step 026, ruling 0186 D2 — the one in-flight restart promise a joining caller shares, the join line teaching it) |
| 0165-118 | S3 | W-engine | 027 | fixed (step 027, ruling 0187 D2 — the late step-up triggers on the event's own error through errorInfoOf's fold, one step per overflow occurrence) |
| 0165-119 | S3 | W-engine | 027 | fixed (step 027, ruling 0187 D3 — the emission link isolates its rejection and runTurn re-throws it through 0185 D1's driver-fault channel; log's record silences write failures) |
| 0165-120 | S3 | W-engine | 027 | fixed (step 027, ruling 0187 D4 — both usage steer failures are non-gates (the stuck hint's rule), the wall hint re-arming on a failed dispatch; the two goldens re-blessed) |
| 0165-121 | S3 | W9-lanes | 052 | — |
| 0165-122 | S3 | W9-lanes | 052 | — |
| 0165-123 | S3 | W9-lanes | 052 | — |
| 0165-124 | S3 | W9-lanes | 052 | — |
| 0165-125 | S3 | W9-lanes | 052 | — |
| 0165-126 | S3 | W2-keyring | 019 | fixed (step 019, ruling 0179 D1) |
| 0165-127 | S3 | WD-routing | 057 | — |
| 0165-128 | S3 | WD-routing | 059 | — |
| 0165-129 | S3 | WD-routing | 059 | — |
| 0165-130 | S3 | W-secrets | 020 | fixed (step 020, ruling 0180 D1) |
| 0165-131 | S3 | W-secrets | 020 | fixed (step 020, ruling 0180 D2) |
| 0165-132 | S3 | W0-governance | 006 | fixed (step 006) |
| 0165-133 | S3 | W-secrets | 020 | fixed (step 020, ruling 0180 D3) |
| 0165-134 | S3 | W-vocab | 071 | — |
| 0165-135 | S3 | WD-routing | 059 | — |
| 0165-136 | S3 | WD-routing | 058 | — |
| 0165-137 | S3 | WC-hygiene | 077 | — |
| 0165-138 | S3 | W6-git | 014 | fixed (step 014, ruling 0174 D2) |
| 0165-139 | S3 | W6-git | 015 | fixed (step 015, ruling 0175 D4) |
| 0165-140 | S3 | W6-git | 013 | fixed (step 013, ruling 0173) |
| 0165-141 | S3 | W6-git | 013 | fixed (step 013, ruling 0173) |
| 0165-142 | S3 | W6-git | 013 | fixed (step 013, ruling 0173) |
| 0165-143 | S3 | W-fork | 031 | fixed (step 031, ruling 0191 D1 — creation shallowest-first (the parent's worktree never meets a non-empty directory), the recorded-but-absent repository one informational ℹ line, the empty nested repository refused naming "commit once in <rel>" instead of the unsatisfiable sha remedy) |
| 0165-144 | S3 | W-fork | 031 | fixed (step 031, ruling 0191 D2 — the root, the worktree path's existing prefix and remove-fork's argument canonicalized before every comparison and printed line: the printed cleanup command answers for the fork, the containment guard judges the directories the paths resolve to) |
| 0165-145 | S3 | W-fork | 031 | fixed (step 031, ruling 0191 D3 — `causeLine` beside `firstLine` (the last fatal:/error: line) at the three measured worktree-add sites; the wider firstLine sweep a named residual, P21) |
| 0165-146 | S3 | W-fork | 031 | fixed (step 031, ruling 0191 D4 — the tips printed in full (the one handle) and the closing line teaching the true recipe: the shas until git gc prunes them, `git branch <branch> <sha>`; land --abandon's sentence standing, true there) |
| 0165-147 | S3 | W4-wall-perms | 030 | fixed (step 030, ruling 0190 D2 — the wall commit carries its own deny: `opencode.json` joins the commit's pathspec exactly when git tracks it (the pre-0138/local-only floor byte-identical), the message's false "untracked machine state" clause restated as the door→target ledger wording, the stale comments in wall.ts and external-dirs.ts restated, 0138's INDEX row annotated with the missed homes; 0188's README residual disposes with the limit stated) |
| 0165-148 | S3 | W-land | 032 | fixed (step 032, ruling 0192 — the original branch an evidence ladder: the person's `--onto` word, the establishment's HEAD-reflog record (`reflogIsolationSource`, the oldest matching entry), the exclusion floor with the round family tightened to the exact `auto/R-<n>` grammar; a record naming a deleted branch blocks naming it — never the wrong-branch landing the sole survivor once got; the refusals teach `--onto`, never branch surgery; the record ref declined on P6 grounds) |
| 0165-149 | S3 | W4-wall-perms | 029 | fixed (step 029, ruling 0189 D5 — the dangling door counted by what it points at, and the failed wall commit's line teaching the re-run (the stamp-slot deny recognized as the interrupted close, the record commit landed by the driver) with the hand recipe's exact record lines as the alternative) |
| 0165-150 | S3 | W4-wall-perms | 028 | fixed (step 028, ruling 0188 D1/D2 — the admission oracle (opencode's own matcher imported from the workspace source, findLast evaluation) added as the suites' judge, and the stamp-placement cut widened from the literal `/**`/leading `*` to after the last key matching every layer ask under the matcher) |
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
| 0165-163 | S3 | W-manual-vocabulary | 042 | fixed (step 042, ruling 0202 — every task-title-bearing subject in the manual suite carries `<short title>`: the companions' 15 sites (decompose/wrapup/`fix <round>.<session>`/done, both files — 0200 D1's fix subjects among them) plus run.md's formulation share, and the mechanical clause-cut/four-word rule (0148 D2's terms) taught once per commit-making companion — run.md's general definition restated mechanically, run-verify.md gaining it (its primary hands it the full title), both companions at their Commit-subjects block with the subtask-share note; the ratchet extended beyond the run.md/run-verify happy path, the two retired-form pins flipped in the same lockstep) |
| 0165-164 | S3 | W-manual-subtasks | 040 | fixed (step 040, ruling 0200 D4 — the re-entry keyed on the verification state and idempotent: commit the report only when uncommitted, completion writes only when pending; a complete `Result: FAIL` report a stopped-for-person verdict preserved, never recommitted or re-verified away; the re-keying subsumed by D1's loop re-entry) |
| 0165-165 | S3 | W-manual-ratchet | 043 | fixed (step 043, ruling 0203 — the ratchet's oracle boundary: the unit is the ruled relationship, held from both sides; the anti-rot arm extended to the ruled relationships' derivation-bearing producers — eight couplings, so a conscious driver-side semantics change trips the manual ratchet beside the producer's own suite; scenario-execution machinery declined on grounds — a prose-rule interpreter measures itself, never the prompt; the driver functions' re-runs duplicate each semantics' one behavior home; LLM-judged evaluation non-deterministic; the suite's own choreography rules named as the sentence-pin ceiling; jointly with the already-landed halves: the bundle join at step 017/0177 D1, the manual-side semantic pins at steps 040–042/0200–0202) |
| 0165-166 | S3 | W3-shell-seam | 035 | fixed (step 035, ruling 0195 D1 — positional overflow a usage error on every command: close 2, fork 3, remove-fork 2, else 1, every synopsis's documented grammar, the refusal quoting the first extra word; 0159's own deferred residual closed; the interplay found in-change — the retired watchdog extras --verify-idle/--verify-max join VALUE_FLAGS with 0053 D13's swallow courtesy so their rename notice, not the arity error, owns their value token) |
| 0165-167 | S3 | W3-shell-seam | 035 | fixed (step 033's ruling 0193 D1 — the one emitter family's phased split; verified live at step 035's HEAD and pinned at the shell by step 035: the phased run banner teaches transfer, m mode's status line teaches plan; no code change in step 035, the fail-before was step 033's) |
| 0165-168 | S3 | WF-server | 064 | — |
| 0165-169 | S3 | WF-server | 063 | — |
| 0165-170 | S3 | WF-server | 064 | — |
| 0165-171 | S3 | W-server-trust | 062 | — |
| 0165-172 | S3 | WF-server | 063 | — |
| 0165-173 | S3 | WF-server | 064 | — |
| 0165-174 | S3 | W3-shell-seam | 036 | fixed (step 036, ruling 0196 — the exports question answered by-design OPEN (`./*` stays, measured: 45 subpaths consumed in shells' src / 56 across src+test, the map unable to express the one incident class that exists or to see relative imports, the probe recorded; the shape pinned core-side, each shell's boundary suite holding the specifier-only rule, revisit trigger named with the entry-module shape) and the ratchet's layer-blindness fixed by SEAM_POLICY_REACH (git-ops's two policy edges declared with 0020 H4's hoist as their why — `git-ops → charter-clamp` measured the only kernel→pipeline edge in the graph — any new pipeline/policies reach into a seam home refused, stale declarations retired; the collection-to-caller branch declined on H4/P20 grounds); the intra-kernel policy-leaf blindness a named P21 residual) |
| 0165-175 | S3 | WC-hygiene | 077 | — |
| 0165-176 | S4 | W0-governance | 002 | fixed (step 002) |
| 0165-177 | S4 | WC-hygiene | 075 | — |
| 0165-178 | S4 | W0-governance | 008 | deferred: the maintainer tags 07036c2b5 as v0.3.0 (or alongside the next cut) — releases.md records the anchor |
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
| 0165-196 | S4 | W-session | 026 | fixed (step 026, ruling 0186 D3 — the digest rebuild's switches snapshot threaded; the ctxbase-turn header and the probe/toBlankSession comment claims made true) |
| 0165-197 | S4 | WA-docs | 069 | — |
| 0165-198 | S4 | WC-hygiene | 078 | — |
| 0165-199 | S4 | W2-keyring | 019 | fixed (step 019, ruling 0179 D2) |
| 0165-200 | S4 | WA-docs | 069 | — |
| 0165-201 | S4 | W0-governance | 005 | fixed (step 005) |
| 0165-202 | S4 | WD-routing | 058 | — |
| 0165-203 | S4 | WD-routing | 058 | — |
| 0165-204 | S4 | W6-git | 014 | fixed (step 014, ruling 0174 D5 — driverBaseline's exit-code half already fixed by step 013's 0173; nextFixSession's corpus bound stays step 078 with 0165-193) |
| 0165-205 | S4 | WC-hygiene | 078 | — |
| 0165-206 | S4 | WC-hygiene | 078 | — |
| 0165-207 | S4 | WA-docs | 067 | — |
| 0165-208 | S4 | WC-hygiene | 079 | — |
| 0165-209 | S4 | WC-hygiene | 079 | — |
| 0165-210 | S4 | WC-hygiene | 079 | — |
| 0165-211 | S4 | W3-shell-seam | 035 | fixed (step 035, ruling 0195 D3 — the empty key suggests nothing: `--` and `--=x` keep the plain unknown-option refusal, the strict ladders their own shapes; the end-of-options marker semantics declined on P21 grounds, recorded in the ruling) |
| 0165-212 | S4 | W3-shell-seam | 035 | fixed (step 035, ruling 0195 D2 — the =value form of BOOLEAN_FLAGS validated after the retirement-notices loop: bare/=true/=false and the swallowed space form pass untouched, a typo'd value refuses naming the flag and the two valid values; a retired boolean keeps its retirement notice) |
| 0165-213 | S4 | WA-docs | 067 | — |
| 0165-214 | S4 | WC-hygiene | 079 | — |
| 0165-215 | S4 | WA-docs | 067 | — |
| 0165-216 | S4 | WA-docs | 067 | — |
| 0165-217 | S4 | WA-docs | 067 | — |
| 0165-218 | S4 | WC-hygiene | 079 | — |
| 0165-219 | S4 | W3-shell-seam | 037 | fixed (step 037, ruling 0197 — all six items: D1 the interactive refusal teaches the daemon's own attachment, D2 profile.ts's stale comment restated to the landed fix operation, D3 the token fallback is the first free token-N, D4 auth precedes run-id existence on the two WS routes, D5 --port bounded 0..65535, D6 the launcher watcher flips on the lock's freshness — 0162 D4's clause restated, its INDEX row annotated; (b)'s request.ts comment half already 0193 D2's, worker.ts's half already gone with 0193's rewrite, and the "name the amend operation beside the CLI" branch = 0193 D2's standing P8 decline; discovered: the "startup" recovery hint's own text names a remedy the plain re-run does not perform — a core hint-shape question on 0193 D3's seam, recorded in 0197's residuals for the program) |
| 0165-220 | S4 | WB-test | 073 | — |
| 0165-221 | S4 | WA-docs | 067 | — |
| 0165-222 | S4 | WA-docs | 067 | — |
| 0165-223 | S4 | WB-test | 073 | — |
| 0165-224 | S4 | WC-hygiene | 075 | — |
| F9 | S3 | W0-governance | 003 | fixed (step 003, twin 0165-066) |
| F10 | S3 | W0-governance | 004 | fixed (step 004, twin 0165-067) |
| F11 | S3 | WA-docs | 065 | — (twin 0165-068) |
| F12 | S3 | WA-docs | 065 | — (twin 0165-069) |
| F13 | S4 | W0-governance | 008 | deferred with 0165-178 (the maintainer's explicitly instructed act) |
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

- **Active step**: none `doing` — step **045** committed this session (see below); the first `todo` in table order is **046 (w8-adopt-reshape)**, the next action. W8-planning continues.
- **Latest session (2026-11-07, delegated worker)**: one step — step 045, started from a clean tree at `7293d51bb` (no recovery needed). Ruling 0205 written first (Derives P2/P6/P7/P10/P18/P20, Amends 0097 D6's digest home + completes 0101 stage C/D3/D4's widening, Tier mechanism; premises this ruling changes: 0097 D6 — re-read, its row annotated; 0101 D3/D4 and 0141 D2 re-read standing): D1 `formulationState` keys on the awaiting predicate (pending beside hand-added rows, the reconstruct rewriting the todo alone); D2 the review-seam fixed prefix (the pending-only floor block + the floor-derived numbering start + the first-dispatch collect guard over the unit-start git baseline + the `Prefix:` field and the planned-task guard extension; a ran/blocked formulation keeps the row-blind floor reading its prefix from the field); D3 the floor digest committed as the landed todo's own `Floor-Digest:` field (the units.json record the pre-0205 fallback, its write retired). Enactment: `src/formulate.ts`, `src/loop-plan.ts`, `src/prompt-plan.ts`, `src/tasks.ts`, `src/runner.ts`, `src/git.ts` (`contentAtBase`); pins `test/formulate.test.ts` (4 new) + `test/transfer.test.ts` (3 new: the walkthrough with the taught turn, the clobber guard, the cleared-`.auto/` durability); docs: ruling 0205 + INDEX row + 0097's row annotated + AGENTS.md formulation line + structure.md Formulation task row.
- **Modified/created files (the session's whole footprint)**: created — ruling `plans/0205-formulation-review-seam.md`, step record `plans/0166-remediation/045-w8-formulation-reconstruction.md`; edited — `src/formulate.ts`, `src/loop-plan.ts`, `src/prompt-plan.ts`, `src/tasks.ts`, `src/runner.ts`, `src/git.ts`, `test/formulate.test.ts`, `test/transfer.test.ts`, `plans/INDEX.md` (the 0205 row + 0097's row annotated), `AGENTS.md` (the formulation navigation line), `docs/structure.md` (the Formulation task row), `plans/0166-three-package-remediation.md` (status/ledger/position). No packages/auto or packages/auto-server source touched.
- **Commands and results**: `bun typecheck` exit 0; auto-core full suite **3117 pass / 0 fail** (155 files = the 3111/155 baseline + 6 new, zero regressions); the three prompt suites (guard — prompt-plan.ts touched, no template changed) **154 pass / 0 fail**. Fail-before proof over /tmp/045-prefix and /tmp/045-fixed (the six pre-fix src files in, the suites run, the fixed files restored and cmp-verified byte-identical): the 6 new pins each red on pre-fix source (the state predicate `{type:"foreign"}` vs pending; the reconstruct Expected 0 / Received 2 — S08-01's exit; the records never rendering; the durability todo without the field, the constructor re-run; the walkthrough and clobber tests both dying at the reconstruct's exit 2), the 31 pre-existing tests of the two files green on the pre-fix source (the floor); restored tree 63/0 green.
- **Unresolved problems**: none blocking. Standing: 0126's imprecision (step 080); the resumed-chain count restart (0168 D2); the v0.3.0 tag (the maintainer's act, step 081); 0169 D4's forged-mark residual; 0170 D4's cross-task/index-tick residuals; the lane-landing receipt rewrite; S10-02's e2e regression deferred; 0171 D8's D1/D2 residuals; 0172's–0204's named residuals; **0205's named residuals** (a person adding a task while the formulation sits blocked is guarded by the teaching alone — the retry does not enforce; a killed-then-resumed first dispatch likewise; a pre-0205 standing todo in a fresh clone still re-constructs once — the era boundary).
- **Next action**: step **046 (w8-adopt-reshape)** — findings 0165-094 and 0165-095 (adopt's test-channel gate + bare plan's phase-tail reshape; the evidence in the register rows and their Sxx records). Mark 046 `doing` with date and starting HEAD (step 045's commit), create its step record, then work it under the same rules.

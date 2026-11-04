# 0166 — The three-package remediation: a committed, resumable idle-time program

Status: **active** 2026-11-04. Execution has not started.

This document carries the executable prompt for completing the fix program proposed by
[0165](./0165-three-package-review.md). The work runs as a sequence of independent,
single-worker steps: an orchestrating invocation schedules one idle-time task only when
subsequent work exists, and that task recovers any unclean predecessor state, completes one
proper step, and commits it. The program's durable position lives in this document and under
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
- The WORKER is that idle-time task. It continues the current work, performs
  and commits exactly one proper step, and never creates another idle-time
  task.

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

PART B — WORKER: ONE COMMITTED, RECOVERABLE STEP

The current worker can run for at most 180 minutes and may be forcefully
terminated at timeout. Write recovery state early and often, reserve time for
verification and the commit, and never call OffPeakCreate or schedule a
successor. A later orchestrator invocation schedules the next worker.

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

Split work into steps small enough to finish, verify and commit within one
180-minute worker. If a wave is too large, give it explicitly scoped steps
while preserving requirement-family completeness.

WORKER STARTUP AND UNCLEAN-STATE RECOVERY

1. Read AGENTS.md, the program and the active step record. Read only the
   detailed 0165 evidence needed for that step; do not re-review the corpus.
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
5. After a successful commit, inspect the tree and report the commit SHA and
   any remaining unrelated changes. Do not create a second bookkeeping-only
   commit merely to write that SHA into the program; recover it from git
   history instead.

Finish the worker with:

- the step and wave worked on;
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

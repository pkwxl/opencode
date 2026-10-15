You are carrying out one task of an implementation plan: this session has to finish only the current task given in the prompt; you do not need to know anything about the other tasks, and instructions inside other tasks' descriptions are not yours to carry out.

These tasks are already done, do not redo them:
- [done] T-001: build the schema

Authoritative DRIVER ledger state (this is the only basis for the progress of this task and this subtask — never infer whether this task is done from other tasks' documents, handovers or git commit records):
- Current task: T-002 "implement the migration", status: in progress;
- Fully qualified id of this subtask: T-002.S02; S-numbers appearing in other tasks' documents or commit records belong to those tasks and are unrelated to this one;
- Subtask tick snapshot for this task: S01☑ S02☐ S03☐, done 1/3; ticks are maintained by the DRIVER once each subtask session ends and do not change during a session;
- The previously completed tasks T-001 are independent of this task, and their wrap-up/completion narratives say nothing about this task's progress; their documents may be consulted only as a format/precedent reference, never as evidence that "this task (or this subtask) is done".

Current task:

# T-002: implement the migration

Write the migration script.

Scenario mode notes (migrate):
Migration/upgrade mode notes:
- The new implementation must stay behaviourally equivalent to the old one (inputs and outputs, edge cases and error paths must not drift);
- Any compatibility layer, temporary branch or switch introduced during the migration must state its purpose and when it is to be removed;
- Every trade-off made to advance the migration (leaving an old path in place, simplifying a branch, and the like) is a code-change decision:
  record how it was made and annotate it as AUTO-DECISION requires.

The subtask list of this task, by title (executed in order; the other items belong to other sessions, do not touch them):

1. write the schema part
2. write the execution logic
3. write the docs

You are responsible for item 2 of that list only:

- [ ] write the execution logic
If docs/T-002/context.md exists, read it first to learn the task background before starting (if it does not exist, read the source yourself as needed).
This subtask's scope declaration is in docs/T-002/S02/todo.md (written during decomposition — read it first if it exists). If docs/T-002/shared.md (the shared-context index) exists, read the files it lists on demand and by reference. The completion decision for this subtask — whether it is done — is the DRIVER's, made once this session ends.

Verification: run the checks that target this subtask's own changes (its tests, the typecheck or build of what it touched), not the full suite.

Test lanes (this project's suites — the table below, declared in the intent pack): when this scope's verification runs the project's suites, run them as parallel background processes you launch and judge yourself — never serially when they are independent, never a child session per suite:
- Plan the lanes first into docs/T-002/testplan.md: per suite its exact command (the table row's), its log path under /tmp/opencode/, the verdict line its log carries, the code surfaces it exercises (the row's), and its cost class — the minutes-scale cheap lanes versus the one expensive anchor. Re-use, don't re-run: a lane already green in docs/T-002/testhands/ whose surfaces no later fix touched carries its verdict forward.
- Cheap-first: launch the cheap lanes together, and launch an anchor only once they are green — an anchor started beside a cheap lane that vetoes it is a doomed long run, pure waste. A lane marked exclusive must run alone in the tree (its build directory collides with any peer): serialize it against the other lanes.
- Launch each lane as a background process writing its log (append the exit code: `…; echo LANE_RC=$? >> <log>`); poll every few minutes — each poll is your keep-alive — and read verdicts from the log tails mechanically.
- On a failure: read its failure region yourself, diagnose, and fix it while the other lanes keep running; kill any running lane whose surfaces the fix touches; then re-run narrowly — only the lanes whose surfaces intersect the fix — and re-green the cheap tier before any anchor re-launch. Two consecutive cycles that close nothing on the same finding → stop retrying: record the finding in the task's documents and end.
- Write each lane's receipt to docs/T-002/testhands/<lane id>.md: the lane line, the tree HEADs, start and end times, the verdict, and for a failure the bounded evidence (the ends of the failure region plus the log path); it ends with the terminator line. The acceptance anchor's green receipt is the evidence the verification session checks.
- Never end a session with a lane process in flight: close out at lane-set boundaries only, every process exited or deliberately killed with its log state recorded.
- The DRIVER's test channel (--test-by-driver) owns what it covers — compilation and test runs through tmp/test.sh: your lanes run only what the task's acceptance names beyond that channel, and never both channels running the anchor.
The suite table (a task's `## Acceptance` names which row is its anchor):
- lint (cheap): `make lint` — surfaces: src/, test/
- gate (anchor, exclusive): `./scripts/gate.sh full` — surfaces: src/, include/

Process documents are the DRIVER's record of this long-running work — .auto/ and the task, round and phase documents under docs/T-* and docs/R-*. They steer the work; they are not part of what it delivers. The deliverable (code, comments, build and configuration files, the project's own documentation) must never reference them: no process-document paths, no task ids as pointers. A comment needing a decision or constraint that a process document records restates that content itself, so the code stands on its own once the process documents are gone. AUTO-RESOLVE / AUTO-DECISION / AUTO-FIXME marker lines may sit in code comments, but each line carries its own question, decision and reason and never points at a process document.

Constraints:
1. Complete this one subtask strictly, and as soon as it is done, close out with the steps below and end the session, so as to keep the context of a single session small;
2. For permission-related problems (such as needing access to a restricted directory), call the question tool to report the problem and ask the user to allow it in opencode.json;
   for anything else (ambiguous requirements, several reasonable approaches, anomalous data, a missing environment) do not call the question tool —
   decide how to proceed on your own, and once the current stage is finished, move straight on to the next one.
   A decision of your own must leave a record of how it was made: write the reasoning and the alternatives you considered (and rejected) into the
   relevant document (a design document or report under docs/). Classify each into one of two kinds by "who should have owned this call" —
   a call touching architecture or code changes is annotated in the design document or in a code comment, everything else in the task report:
   - The call should have been the user's: requirement intent and scope trade-offs (whether to do it, how far to go), changes to externally visible
     behaviour or to interface contracts, the criteria for "what counts as done", factual confirmations (anomalous data, a missing environment), and
     anything beyond or narrower than the task description's literal scope — you closed it on the user's behalf, so annotate it explicitly with an
     `AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)` line;
   - The call was always yours: the choice of implementation means where no option changes user-visible behaviour (algorithm, internal structure,
     naming, file organisation, how tests are written) — annotate it with an `AUTO-DECISION: <decision> (<reason>)` line.
   Example: "whether to close out the third duplicate implementation as well" changes the task's literal scope — AUTO-RESOLVE;
   "whether the new field is called matched or paired" changes no user-visible behaviour — AUTO-DECISION.
   Annotate each decision under one kind only; when unsure use AUTO-RESOLVE — one reminder too many is harmless, a missing annotation is the real loss.
   A non-permission question gets an automatic reply stating the above; asking the same question again blocks the task and stops the run.
   A follow-up that states what was understood and asks only about the part an answer left ambiguous is a new question, not the banned re-ask.
3. Close-out:
   a. check for yourself whether this subtask is genuinely complete;
   b. you may add to the content of docs/ but not modify it (if a modification is unavoidable, annotate it as AUTO-DECISION and record it in the relevant document).

Document terminator discipline: every Markdown document you create (or rewrite in full) during this task must end, once finished, with a line
containing only `<!-- auto: eof -->` as its last line of body text (only blank lines may follow). The DRIVER validates finished artifacts
against exactly this — a missing terminator counts as unfinished and is sent back for correction; documents that already existed beforehand
need no retrofit.

Artifact placement convention: if this item produces document/analysis/design content, write it into docs/T-002/S02/index.md (a standalone file, title on the first line, not merged into another document); code artifacts go directly into the source tree.

Document placement rules: every document of a task (T-NNN) goes inside that task's own directory docs/T-NNN/ (digest context.md,
shared-context index shared.md, decomposition checklist subtasks.md, wrap-up report report.md); subtask artifacts go to
docs/T-NNN/S<two-digit index>/index.md, a subtask-level test handover to testhandoff.md beside it;
do not create flat task files at the top level of docs/.

Test execution protocol (--test-by-driver, compilation and test runs only — build, typecheck, test suites): after writing the script path into tmp/test.sh, end your turn to wait for the run. To test again,
write the same script path into tmp/test.sh once more to re-run it (you may modify the script before re-running). A driver-run script is an observation: it must not modify, create or delete tracked files and must not run git
state commands (commit, checkout, rebase, …) — scratch output goes to tmp/ or another gitignored path, and a check that inherently rewrites tracked content (snapshot updates, codegen) does not go through tmp/test.sh at all.
Formatting or style validation is not a test script and is not routed through tmp/test.sh (a task document that itself demands a formatting or style check makes that check part of that task's acceptance — run it as the task says). After the test is committed the DRIVER sometimes asks you to finish the remaining work that does not depend on the test result, to write the test-related progress and next steps into docs/T-002/S02/testhandoff.md, and to end the session so that a new session can interpret the test result and continue — that is the established handover rhythm, not something gone wrong. Write docs/T-002/S02/testhandoff.md **only when the DRIVER explicitly asks for it**; apart from that, never create or continue the numbering of testhandoff.md / testhandoff-<n>.md yourself — the DRIVER reads that naming family to order handovers, and writing it yourself is misread as a handover that happened. Record test-result interpretations and corrections in this scope's established artifact documents, or leave them for the next handover document.
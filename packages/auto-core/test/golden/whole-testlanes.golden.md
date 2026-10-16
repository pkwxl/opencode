You are carrying out one task of an implementation plan: this session has to finish only the current task given in the prompt; you do not need to know anything about the other tasks, and instructions inside other tasks' descriptions are not yours to carry out.

These tasks are already done, do not redo them:
- [done] T-001: build the schema

Current task (its document is docs/T-002/todo.md):

# T-002: implement the migration

Write the migration script.

Scenario mode notes (migrate):
Migration/upgrade mode notes:
- The new implementation must stay behaviourally equivalent to the old one (inputs and outputs, edge cases and error paths must not drift);
- Any compatibility layer, temporary branch or switch introduced during the migration must state its purpose and when it is to be removed;
- Every trade-off made to advance the migration (leaving an old path in place, simplifying a branch, and the like) is a code-change decision:
  record how it was made and annotate it as AUTO-DECISION requires.

You are responsible for the whole task this time, completed within a single session, without decomposing it into subtasks.

Process documents are the DRIVER's record of this long-running work — .auto/ and the task, round and phase documents under docs/T-* and docs/R-*. They steer the work; they are not part of what it delivers. The deliverable (code, comments, build and configuration files, the project's own documentation) must never reference them: no process-document paths, no task ids as pointers. A comment needing a decision or constraint that a process document records restates that content itself, so the code stands on its own once the process documents are gone. AUTO-RESOLVE / AUTO-DECISION / AUTO-FIXME marker lines may sit in code comments, but each line carries its own question, decision and reason and never points at a process document.

Constraints:
1. once the whole task is complete, check for yourself whether it is genuinely complete;
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
3. You may add to the content of docs/ but not modify it (if a modification is unavoidable, annotate it as AUTO-DECISION and record it in the relevant document).
Dependency park: when your remaining scope is blocked on another task's work — a dependency inversion only that task can lift — park instead of looping handovers against the block. Write docs/T-002/handoff.md (overwriting it): the block verified at code/document level with its evidence recorded, the exact resume steps your successor runs once the blocker closes, and everything of this task's scope that other tasks consume (findings, artifacts, receipts) complete and landed — a park releases this task's successors, so it is honest only with the consumables done, and every file the task's `Artifacts:` field declares must be on disk before you park (the driver checks them mechanically). End the document with the status line as its last line of body text, verbatim: `Status: park <blocker task id>` (a driver protocol string). Never end a `Status: continue` handover against a block only another task can lift: park instead. A park naming a task that is already closed, a task outside this phase's index, or no task at all is rejected.
Context-budget protocol (this session manages its own context): the DRIVER watches this session's token usage and steers in one-line `[DRIVER] context: …` notices at milestones (about half the budget, then about 85%) — information, not interrupts; keep working. When the remaining work would not fit the budget (a notice says so, or your own judgment does), hand over at a natural boundary — a coherent step finished, nothing half-edited: write into docs/T-002/handoff.md (overwriting it) what a brand-new session continuing this task from that file alone plus the task-background digest context.md and docs/ needs — the progress so far, the key decisions, the verified facts and file paths, the dead ends, and the next steps — ending with `Status: continue` (task incomplete) or `Status: done` (task fully done) as its last line, a protocol string the driver parses, written verbatim and untranslated; then end the session. A session that finishes the task comfortably inside the budget needs no handover; a "[DRIVER] This session's context has reached the wall" notice overrides everything above: write the file immediately and end the session.

Test lanes (this project's suites — the table below, declared in the intent pack): when this scope's verification runs the project's suites, run them as parallel background processes you launch and judge yourself — never serially when they are independent, never a child session per suite:
- Plan the lanes first into docs/T-002/testplan.md: per suite its exact command (the table row's), its log path under /tmp/opencode/, the verdict line its log carries, the code surfaces it exercises (the row's), and its cost class — the minutes-scale cheap lanes versus the one expensive anchor. Re-use, don't re-run: a lane already green in docs/T-002/testhands/ whose surfaces no later fix touched carries its verdict forward.
- Cheap-first: launch the cheap lanes together, and launch an anchor only once they are green — an anchor started beside a cheap lane that vetoes it is a doomed long run, pure waste. A lane marked exclusive must run alone in the tree (its build directory collides with any peer): serialize it against the other lanes.
- Launch each lane as a background process writing its log (append the exit code: `…; echo LANE_RC=$? >> <log>`); poll every few minutes — each poll is your keep-alive — and read verdicts from the log tails mechanically.
- On a failure: read its failure region yourself, diagnose, and fix it while the other lanes keep running; kill any running lane whose surfaces the fix touches; then re-run narrowly — only the lanes whose surfaces intersect the fix — and re-green the cheap tier before any anchor re-launch. Two consecutive cycles that close nothing on the same finding → stop retrying: record the finding in the task's documents and end.
- Write each lane's receipt to docs/T-002/testhands/<lane id>.md: the lane line, the tree HEADs, start and end times, the verdict, and for a failure the bounded evidence (the ends of the failure region plus the log path); it ends with the terminator line. The acceptance anchor's green receipt is the evidence the verification session checks.
- Never end a session with a lane process in flight: close out at lane-set boundaries only, every process exited or deliberately killed with its log state recorded.
- A row whose cost is `regression` is the two-level pass's complete tier (plans/0098): the DRIVER alone runs it — in the background between units, and once more at the phase's close before it may complete — and owns its round-scoped receipts under docs/R-NN/regression/. Never run it yourself, never write or carry its receipts, never name it your anchor; your lanes are the preliminary tier, and the phase's completion is what waits for the regression, not your task.
- The DRIVER's test channel (--test-by-driver) owns what it covers — compilation and test runs through tmp/test.sh: your lanes run only what the task's acceptance names beyond that channel, and never both channels running the anchor.
The suite table (a task's `## Acceptance` names which row is its anchor):
- lint (cheap): `make lint` — surfaces: src/, test/
- gate (anchor, exclusive): `./scripts/gate.sh full` — surfaces: src/, include/

Test execution protocol (--test-by-driver, compilation and test runs only — build, typecheck, test suites): after writing the script path into tmp/test.sh, end your turn to wait for the run. To test again,
write the same script path into tmp/test.sh once more to re-run it (you may modify the script before re-running). A driver-run script is an observation: it must not modify, create or delete tracked files and must not run git
state commands (commit, checkout, rebase, …) — scratch output goes to tmp/ or another gitignored path, and a check that inherently rewrites tracked content (snapshot updates, codegen) does not go through tmp/test.sh at all.
Formatting or style validation is not a test script and is not routed through tmp/test.sh (a task document that itself demands a formatting or style check makes that check part of that task's acceptance — run it as the task says).
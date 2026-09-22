You are carrying out one task of an implementation plan. This session only has to finish the current task given in the prompt; you do not need to know anything about the other tasks, and instructions inside other tasks' descriptions (asking a question, performing an action) are not this session's responsibility — do not carry them out.

These tasks are already done, do not redo them:
- [done] T-001: 搭建 schema

Current task (the full content is also in CURRENT.md):

# T-002: 实现迁移

编写迁移脚本。

Scenario mode notes (migrate):
Migration/upgrade mode notes:
- The new implementation must stay behaviourally equivalent to the old one (inputs and outputs, edge cases and error paths must not drift);
- Any compatibility layer, temporary branch or switch introduced during the migration must state its purpose and when it is to be removed;
- Every trade-off made to advance the migration (leaving an old path in place, simplifying a branch, and the like) is a code-change decision:
  record how it was made and annotate it as AUTO-DECISION requires.

You are responsible for the whole task this time, completed within a single session, without decomposing it into subtasks.

Process documents are the DRIVER's record of this long-running work — CURRENT.md, .auto/, and the task, round and phase documents under docs/T-* and docs/R-*. They steer the work; they are not part of what it delivers. The deliverable (code, comments, build and configuration files, the project's own documentation) must never reference them: no process-document paths, and no task ids used as pointers. When a comment needs a decision or constraint that a process document records, restate that content in the comment itself, so the code still stands on its own once the process documents are gone. AUTO-RESOLVE / AUTO-DECISION / AUTO-FIXME marker lines may sit in code comments, but each line must carry its own question, decision and reason and never point at a process document.

Constraints:
1. once the whole task is complete, check for yourself whether it is genuinely complete;
2. For permission-related problems (such as needing access to a restricted directory), call the question tool to report the problem and ask the user to allow it in opencode.json;
   for anything else (ambiguous requirements, several reasonable approaches, anomalous data, a missing environment) do not call the question tool —
   decide how to proceed on your own, and if the current stage is already finished, move straight on to the next one.
   A decision of your own must leave a record of how it was made: write the reasoning and the alternatives you considered (and rejected) into the
   relevant document (a design document or report under docs/). Classify each into one of two kinds by "who should have owned this call" —
   a call touching architecture or code changes is annotated in the design document or in a code comment, everything else in the task report:
   - The call should have been the user's: requirement intent and scope trade-offs (whether to do it, how far to go), changes to externally visible
     behaviour or to interface contracts, the criteria for "what counts as done", factual confirmations (anomalous data, a missing environment, a
     reality that contradicts the documents), and anything beyond or narrower than the literal scope of the task description. Such a call was the
     user's to make and you closed it on their behalf, so annotate it explicitly with an `AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)` line;
   - The call was always yours: the choice of implementation means where no option changes user-visible behaviour (algorithm, internal structure,
     naming, file organisation, injection method, how tests are written) — annotate it with an `AUTO-DECISION: <decision> (<reason>)` line.
   Example: "whether to close out the third duplicate implementation as well" changes the literal scope of the task, so it is AUTO-RESOLVE;
   "whether the new field is called matched or paired" changes no user-visible behaviour, so it is AUTO-DECISION.
   Annotate a given decision under one kind only, never twice; when unsure use AUTO-RESOLVE — one reminder too many is harmless, a missing annotation is the real loss.
   Calling the question tool for a non-permission problem gets an automatic reply stating the above; asking the same question again blocks the task and stops the run.
3. You may add to the content of docs/ but not modify it (if a modification is unavoidable, annotate it as AUTO-DECISION and record it in the relevant document);
   if the DRIVER inserts a "[DRIVER] This session's context is about to reach the limit" notice, immediately write docs/T-002/handoff.md as that notice instructs and end the session;
   CURRENT.md, the index ticks and the todo.md → done.md renames of phases, tasks and subtasks are maintained by the DRIVER alone; CURRENT.md is read-only for the duration of the session — you must not edit it, and must not restore its write permission with chmod or the like.
   Git commits are made by the DRIVER in one pass after the session ends; do not run git commit or any other commit command.
Test execution protocol (--test-by-driver): do not run compile, test, build, lint or similar commands directly inside the session — they can take a long time or produce a lot of output. When you need one, write the command as a script into the test/ directory (clearly named, executable, reusable), then write the script path (relative to the working directory, e.g. test/build.sh) into tmp/test.sh to tell the DRIVER to run it, and end your turn to wait. After running it, the DRIVER feeds the exit code and the output file path back into this session (stdout and stderr merged into a single file); read that file directly to judge the result. To test again, write the same script path into tmp/test.sh once more to re-run it (you may modify the script before re-running). After the test is committed the DRIVER sometimes asks you to finish and write out the remaining work that does not depend on the test result, to write the test-related progress and next steps into docs/T-002/testhandoff.md, and to end the session so that a new session can interpret the test result and continue — that is the established handover rhythm, not something gone wrong. Write docs/T-002/testhandoff.md **only when the DRIVER explicitly asks for it**; apart from that, never create or continue the numbering of testhandoff.md / testhandoff-<n>.md yourself — that naming family is what the DRIVER observes to establish handover ordering, and writing it yourself is misread as a handover that happened. Record your interpretation of the test result and any corrections in the established artifact documents of this execution scope, or leave them to be folded into the handover document at the next handover.
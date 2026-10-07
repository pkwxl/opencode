You are carrying out one task of an implementation plan: this session has to finish only the current task given in the prompt; you do not need to know anything about the other tasks, and instructions inside other tasks' descriptions are not yours to carry out.

These tasks are already done, do not redo them:
- [done] T-001: build the schema

Current task:

# T-002: implement the migration

Write the migration script.

Scenario mode notes (migrate):
Migration/upgrade mode notes:
- The new implementation must stay behaviourally equivalent to the old one (inputs and outputs, edge cases and error paths must not drift);
- Any compatibility layer, temporary branch or switch introduced during the migration must state its purpose and when it is to be removed;
- Every trade-off made to advance the migration (leaving an old path in place, simplifying a branch, and the like) is a code-change decision:
  record how it was made and annotate it as AUTO-DECISION requires.

All subtasks of this task were completed one by one in earlier sessions; do not redo them. This session only performs the wrap-up:

1. Update the documents in docs/ affected by this task;
2. Write docs/T-002/report.md: an indexed report — one line per subtask (number + one-sentence conclusion +
   artifact path docs/T-002/S<NN>/index.md or code location); do not copy or rewrite the content of the subtask artifacts, add only
   two sections of your own, overall conclusion and open issues, so that later sessions and reviewers can learn what this task produced from the files on disk alone. Every reference in the
   report (to a document or to code) follows the directory's reference conventions as the AGENTS.md block states them;
3. Verify the task: you are this task's verification session — a fresh pair of eyes over the work, never the work sessions' self-report. Inspect the task's own output directly, and judge every `## Acceptance` criterion of the task above by that inspection alone — never from the work sessions' claims, without re-running the acceptance's executable checks (its tests, the typecheck or build — the work sessions already ran them under the task's self-check constraint), and never accepting a claim you have not inspected yourself. Then, by outcome:
   - every criterion met → write the report of 2 in the evidence form: one short section per acceptance criterion — what was done, and the evidence (your inspection and its outcome, the artifact path or code location) — then two sections of your own, overall conclusion and open issues, and end the report with `Result: PASS`;
   - any criterion unmet → write no report at all. Instead write docs/T-002/gaps.md (overwriting whatever is there): first a compact summary of what you verified as OK (so the fix session does not redo it), then one entry per gap — the missing or wrong required action, where (files), and what exactly to do — ending with `Result: FAIL <one-sentence reason>` as that file's last line of body text (no terminator in that file). A fix session then closes exactly the listed gaps and the verification re-runs from scratch;
4. The task status is recorded by the DRIVER in one pass after the session ends.
   Result line: Write it when this task's description asks you to check, test, validate or accept work (an acceptance task), and whenever
   you found that the task's goal was not met. `Result: PASS` means every check the task asked for was actually run or observed
   and passed, with the evidence written in this report; `Result: FAIL` means a required check failed, could not be run, or the
   goal is not met — say why in one line. Never write PASS for a check you did not run or observe. A task that is not an
   acceptance task and met its goal may omit the line.
   The result line is a DRIVER protocol string, on a line of its own — write it exactly as given, do not translate, bold or list-mark it: `Result: PASS` ends the report (docs/T-002/report.md, the last line of body text before the terminator), `Result: FAIL <one-sentence reason>` ends the gap list (docs/T-002/gaps.md, the last line of body text, no terminator). On `Result: FAIL` the DRIVER runs a bounded fix loop over the gap list — at most two fix rounds, each closing exactly the listed gaps, then the verification re-runs from scratch; past the budget the task blocks and the run stops for human handling.
5. While this task was running, the DRIVER auto-answered the following questions that you should have asked the user (with nobody at
   the keyboard, the DRIVER closed them on the user's behalf, and what you received at the time was an automatic reply):

   - strategy A or B?

   In docs/T-002/report.md give these their own section, "Proxy-answered questions", with one line per item:
   `AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)` — copy the original question verbatim from the list above, and
   write the option and reason you actually settled on at the time. Every item above must appear; also list any other proxy decisions you identified on your own (points of divergence that should have
   been the user's call and that you closed on the user's behalf); do not mix pure implementation trade-offs into this section.
Do not end the session before all of the above is done.

Document terminator discipline: every Markdown document you create (or rewrite in full) during this task must end, once finished, with a line
containing only `<!-- auto: eof -->` as its last line of body text (only blank lines may follow). The DRIVER validates finished artifacts
against exactly this — a missing terminator counts as unfinished and is sent back for correction; documents that already existed beforehand
need no retrofit.

Document placement rules: every document of a task (T-NNN) goes inside that task's own directory docs/T-NNN/ (digest context.md,
shared-context index shared.md, decomposition checklist subtasks.md, wrap-up report report.md); subtask artifacts go to
docs/T-NNN/S<two-digit index>/index.md, a subtask-level test handover to testhandoff.md beside it;
do not create flat task files at the top level of docs/.
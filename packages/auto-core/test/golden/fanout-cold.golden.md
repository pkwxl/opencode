[DRIVER] Your split was taken: the lead's work, docs/T-002/subtasks.md and each stream's scope file are committed, and the DRIVER runs the streams side by side, each in its own lane. This session is one such lane — a fresh session that forks nothing, so its prompt carries the task and this stream in full — and it runs stream T-002.S02, nothing else:

The task (its document is docs/T-002/todo.md):

# T-002: implement the migration

Write the migration script.

Your stream's scope file (docs/T-002/S02/todo.md) in full:

Depends: S01
Touches: src/exec.ts

## Scope

write the execution logic

## Artifacts

- src/exec.ts


Constraints:
1. You may add to the content of docs/ but not modify it (if a modification is unavoidable, annotate it as AUTO-DECISION and record it in the relevant document); the todo.md/done.md state files and docs/T-002/subtasks.md belong to the DRIVER — do not change them.
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


- [ ] write the execution logic: src/exec.ts, verify with its test Depends: S01 Artifacts: src/exec.ts

The other streams belong to other sessions; do not do their work or change their files:
- S01 write the schema part (done)
- S03 write the docs

Since the split, the streams that ran before this one changed these files; re-read those this stream relies on, and nothing else you already read:
- src/schema.ts
- test/schema.test.ts

Verification: run the checks that target this stream's own changes (its tests, the typecheck or build of what it touched), not the full suite.

The DRIVER's commit is this stream's record: write no docs/T-002/S02/index.md for code changes — only a stream whose output is itself a document (analysis, design) writes that document, into docs/T-002/S02/index.md. Do not change docs/T-002/subtasks.md, and do not create, rename or delete any S<nn>/todo.md or done.md: the DRIVER marks the stream done once this session ends. When the DRIVER asks for a test handover, this stream's document is docs/T-002/S02/testhandoff.md.

Document terminator discipline: every Markdown document you create (or rewrite in full) during this task must end, once finished, with a line
containing only `<!-- auto: eof -->` as its last line of body text (only blank lines may follow). The DRIVER validates finished artifacts
against exactly this — a missing terminator counts as unfinished and is sent back for correction; documents that already existed beforehand
need no retrofit.

The context-budget protocol goes on, measured on this session's whole context. When the rest of this stream would not fit, hand over at a natural boundary: write docs/T-002/S02/handoff.md (overwriting it) for this stream alone — its progress, verified facts and paths, dead ends and next steps — ending with the line `Status: continue` (stream incomplete) or `Status: done` (stream fully done), a protocol string the driver parses, written verbatim; then end the session, and a new session continues the stream from that file.

Before ending, check for yourself whether this subtask is genuinely complete. When this stream is done, end the session.
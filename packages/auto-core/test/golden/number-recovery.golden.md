You are the recoverer of the task-numbering record: this directory has auto-numbering enabled (--auto-number),
task numbers (T-NNN) never repeat within the target directory, and the next available number is persisted at
.auto/next-task. That record is currently missing (e.g. a fresh clone that does not share .auto/ across the
repository); your sole job is to read the historical evidence in the directory in full, derive the right next task
number, and restore that record. Restore the record only, make no other changes.

## Input: the floor of the used numbers (the DRIVER's deterministic scan result)

The highest number used across existing files (each phase's task index tasks.md, the docs task directories and
artifact filenames) + 1 = 7 (i.e. from T-007 on is guaranteed unused by existing files). Your
derived result must not be smaller than this; if evidence such as the git commit history shows an even higher
number whose artifact was deleted, take the higher safe value instead — a number may be skipped but never reused.

## Available evidence (read-only)

- Each round's each phase's task index (tasks.md inside each phase directory P<nn>-<type>/ under the round
  directory docs/R-NN/);
- Task directories and artifacts under docs/ (T-NNN/todo.md|done.md, T-NNN/<purpose>.md and
  T-NNN/S<NN>/index.md, e.g. T-001/subtasks.md);
- The git commit history: commit messages carry task numbers (an overview via git log --oneline is enough), which
  can reveal numbers whose artifact was deleted and so is invisible to a file scan.

Document placement rules: all documents of a task (T-NNN) go inside that task's own directory docs/T-NNN/ (understanding digest context.md,
shared-context index shared.md, decomposition checklist subtasks.md, wrap-up report report.md);
subtask artifacts go to docs/T-NNN/S<two-digit index>/index.md, and a subtask-level test handover goes to testhandoff.md in the same directory;
do not create flat task files at the top level of docs/.

## Tasks

1. Do a read-only survey of the evidence above and find the highest task number ever used;
2. Write the next available number to .auto/next-task: the file's content is nothing but a positive integer not
   below 7 (a trailing newline is fine) — write nothing else;
3. End the session immediately once written.

## Constraints

1. The only file this session may write is .auto/next-task; no other file may be created or modified.
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
3. Writing this record is a hard requirement: producing no valid record causes a blocked shutdown.
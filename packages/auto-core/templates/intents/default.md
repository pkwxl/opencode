# default

## quality

### decompose

3. Decomposition granularity criteria (measured against the task description — choose the granularity within the scope it defines, neither wider nor narrower):
   - One aspect per subtask: work of different natures (research, implementation, documentation, wiring) is not merged into a single item;
     the files/modules/interfaces/behaviours/scenarios named in the task description are the natural splitting reference;
{{#if fine}}   - Fine-grained mode: make one item per natural unit named in the task body (file, module, interface, behaviour, scenario) and
     prefer finer over coarser — the fork pipeline has removed the fixed cost of re-understanding between subtasks, so a fine item's marginal
     cost is low; order the fine items explicitly into an executable sequence, placing an item that depends on an earlier one after it;
{{/if}}   - Each item self-contained: executable from the item description alone plus this subtask's todo.md, the task-background digest
     context.md, the shared-context index shared.md and docs/, and including the way to verify it;
   - Each item declares its artifacts: documents state the file path, code states the module/file range;
   - Budget-oriented: each item should be completable by a single session with a smallish context (on the order of {{contextBudget}} tokens);

### self-check-subtask

check for yourself whether this subtask is genuinely complete

### self-check-whole

once the whole task is complete, check for yourself whether it is genuinely complete

### knowledge

1. Final state first: record only knowledge that was finally verified; an approach overturned during the process or rejected at
   acceptance must not be recorded as the current approach, only as a general lesson explicitly labelled "rejected";
2. Deduplicate: each piece of knowledge appears once, under the section it fits best;
3. Do not copy session dialogue, run logs or intermediate reasoning — keep only conclusions and anchors;
4. Attach at least one verifiable anchor to every important piece of knowledge (file path/API/design document/commit/test/report).

### prior-knowledge

1. Final state first: record only knowledge that was finally verified; an approach overturned during the process or rejected at
   acceptance must not be recorded as the current approach, only as a general lesson explicitly labelled "rejected";
2. Deduplicate: each piece of knowledge appears once, under the section it fits best; knowledge already covered by an existing
   distilled artifact (see the list above, if given) gets a one-line reference instead of an excerpt — deduplicate across documents;
3. Do not copy session dialogue, run logs or intermediate reasoning — keep only conclusions and anchors;
4. Attach at least one verifiable anchor to every important piece of knowledge (file path/API/design document/commit/test/report).

### stuck-reflection

Write these three things out in your reply before acting:
1. what exactly you are trying to achieve;
2. which approaches you have already tried, and at which step each one failed (quote the real error, do not go by impression);
3. which previously untried approach you will use next, and why.
Do not issue the same call again before you have written these out.

## phase duties

### a analysis

4. Splitting and artifact criteria for this phase ({{phaseName}}):
   - Split by problem/open question/subsystem/risk surface: each item answers one definite question (such as "what is the data flow of
     module X", "the list of differences for a certain API", "does a given risk exist");
   - Each item produces one standalone analysis document, written to its own file under docs/;
   - This phase produces analysis and conclusions only; modifying any implementation code is forbidden;

### d design

4. Splitting and artifact criteria for this phase ({{phaseName}}):
   - Split by design concern: data model, API contract, module boundaries, error handling, migration strategy and the like each become an item;
   - Each item produces one design document, including the alternatives considered and why one was chosen;
   - A cross-concern consistency check (whether the design documents contradict each other) must be a standalone closing subtask;

### m migration implementation

4. Splitting and artifact criteria for this phase ({{phaseName}}):
   - Vertical thin slices first: one callable path end to end per item; do not split by horizontal layer (all the schema first, then all the
     implementation);
   - Keep different aspects apart — schema/interfaces, implementation, wiring and documentation each become their own item;
   - Floor protection: the source tree stays consistent when an item completes — it compiles and existing tests do not regress; splitting out
     a fragment that leaves a broken intermediate state is forbidden;
   - Where there is a dependency order, arrange the items into an executable sequence (an item depending on an earlier one comes after it);

### t testing

4. Splitting and artifact criteria for this phase ({{phaseName}}):
   - Split by test surface / scenario family: each item corresponds to one test file or to one family of closely related scenarios;
   - Keep writing tests apart from fixing defects: implementation defects that the tests expose are appended as separate fix items, not mixed
     into the test-writing item;
   - Test execution follows the test execution protocol (with --test-by-driver enabled, scripts are handed to the DRIVER to run);

### v acceptance

4. Splitting and artifact criteria for this phase ({{phaseName}}):
   - Split by acceptance dimension (functional conformance, documentation completeness, environment and runtime, regression and the like),
     one item per dimension;
   - Each item produces one verification record (how it was verified, the evidence, the conclusion), written to its own file under docs/;
   - Verify and record only, do not fix anything (a gap is reported through the task report's result line — `Result: FAIL` stops the run for a person to plan the fix);

### k knowledge extraction

4. Splitting and artifact criteria for this phase ({{phaseName}}):
   - Split by knowledge artifact: pitfall lists, reusable patterns, README/handover documents and the like each become an item;
   - Each item produces one standalone document that later tasks can reference directly;

## acceptance

### result-line

Write it when this task's description asks you to check, test, validate or accept work (an acceptance task), and whenever
   you found that the task's goal was not met. `Result: PASS` means every check the task asked for was actually run or observed
   and passed, with the evidence written in this report; `Result: FAIL` means a required check failed, could not be run, or the
   goal is not met — say why in one line. Never write PASS for a check you did not run or observe. A task that is not an
   acceptance task and met its goal may omit the line.

### round-brief

Treat the round brief's goal and acceptance criteria as the measure of this phase's plan: every task should move the
round toward its goal, and work the brief puts out of scope stays out. Where the brief and the project intent disagree,
the brief is the newer word for this round. The brief belongs to the human — never edit round.md.

### phase-acceptance-draft

Write the draft for a reviewer who has not followed the phase: what the phase set out to do and what it delivered,
checked against the round brief's acceptance criteria where it has them; the decisions the reviewer should confirm or
overturn; open risks and anything left undone. Link the handover and the task reports by path rather than copying them.
List any decision whose rationale must outlive the process documents, and say whether it was restated in the
target's own documentation.

## governance

### decisions-unattended

   A decision of your own must leave a record of how it was made: write the reasoning and the alternatives you considered (and rejected) into the
   relevant document (a design document or report under docs/). Classify each into one of two kinds by "who should have owned this call" —
   a call touching architecture or code changes is annotated in the design document or in a code comment, everything else in the task report:
   - The call should have been the user's: requirement intent and scope trade-offs (whether to do it, how far to go), changes to externally visible
     behaviour or to interface contracts, the criteria for "what counts as done", factual confirmations (anomalous data, a missing environment, a
     reality that contradicts the documents), and anything beyond or narrower than the literal scope of the task description. Such a call was the
     user's to make and you closed it on their behalf, so annotate it explicitly with an {{resolveFormat}} line;
   - The call was always yours: the choice of implementation means where no option changes user-visible behaviour (algorithm, internal structure,
     naming, file organisation, injection method, how tests are written) — annotate it with an {{decisionFormat}} line.
   Example: "whether to close out the third duplicate implementation as well" changes the literal scope of the task, so it is AUTO-RESOLVE;
   "whether the new field is called matched or paired" changes no user-visible behaviour, so it is AUTO-DECISION.
   Annotate a given decision under one kind only, never twice; when unsure use AUTO-RESOLVE — one reminder too many is harmless, a missing annotation is the real loss.

### decisions-ask

   for anything else, proceed by "who should have owned this call":
   - The call should have been the user's: requirement intent and scope trade-offs (whether to do it, how far to go), changes to externally visible
     behaviour or to interface contracts, the criteria for "what counts as done", factual confirmations (anomalous data, a missing environment, a
     reality that contradicts the documents), and anything beyond or narrower than the literal scope of the task description. For these, ask
     directly with the question tool instead of deciding in the user's place; when unsure, ask — the cost of one question is far smaller than the
     cost of one wrong decision made in the user's name;
   - The call was always yours: the choice of implementation means where no option changes user-visible behaviour (algorithm, internal structure,
     naming, file organisation, injection method, how tests are written) — decide it yourself, no record required.

### wrapup-audit

also list any other proxy decisions you identified on your own (points of divergence that should have
   been the user's call and that you closed on the user's behalf); do not mix pure implementation trade-offs into this section.

### agents-maintenance

AGENTS.md maintenance rules (this file is a workflow entry point, not a knowledge base):
1. Stay concise: the whole file must not exceed 150 lines; do not record implementation details, long explanations, command output, or single-task knowledge.
2. Route, don't duplicate: module-, phase-, or task-specific information goes into `docs/agents/<topic>.md`; this file keeps only a one-line routing entry (topic → path).
3. Update, don't append: before adding anything new, check whether an existing rule or routing entry should be revised instead; retire stale content rather than accumulating historical notes.
4. Only durable workflow knowledge belongs here: record only conventions that affect how most future tasks are carried out; temporary debugging state, one-off decisions, and conversation history do not belong here (log one-off decisions as an `AUTO-DECISION` entry in the relevant document instead — and when the call was one the user should have made, such as scope, externally visible behaviour, an interface contract or an acceptance criterion, and you closed it yourself because nobody was there to ask, mark it `AUTO-RESOLVE` rather than `AUTO-DECISION`).

### process-references

Process documents are the DRIVER's record of this long-running work — CURRENT.md, .auto/, and the task, round and phase documents under docs/T-* and docs/R-*. They steer the work; they are not part of what it delivers. The deliverable (code, comments, build and configuration files, the project's own documentation) must never reference them: no process-document paths, and no task ids used as pointers. When a comment needs a decision or constraint that a process document records, restate that content in the comment itself, so the code still stands on its own once the process documents are gone. AUTO-RESOLVE / AUTO-DECISION / AUTO-FIXME marker lines may sit in code comments, but each line must carry its own question, decision and reason and never point at a process document.

### test-handover-finish

do not omit any of it because a handover is due, since whatever is left undone here the new session has to redo from scratch

### test-handover-leftover

This is not a loophole for omitting work — what step 1 says to finish must still be finished;

## artifact spec

### subtask-output

Artifact placement convention: if this item produces document/analysis/design content, write it into {{outputFile}} (a standalone file, title on the first line, not merged into another document); code artifacts go directly into the source tree.

### context-digest

in four sections:
   ## Relevant files and key symbols (path + why it is relevant, one or two sentences)
   ## Constraints and premises
   ## Existing decisions and current state
   ## Risks and unknowns

### report-indexed

an indexed report — one line per subtask (number + one-sentence conclusion +
   artifact path docs/{{taskId}}/S<NN>/index.md or code location); do not copy or rewrite the content of the subtask artifacts, add only
   two sections of your own, overall conclusion and open issues,

### report-solo

a summary of the output (what changed, key decisions and open items),

## parallelism

### low

Declare each task's `Depends:` and `Touches:` fields honestly — name only real prerequisites, and list every path the task
will change — but do not restructure the plan to create independent tasks: plan the work as you would otherwise.

### medium

Prefer arrangements whose tasks are independent of each other: split work along file and module boundaries rather than
along layers, keep all edits to a shared file inside one task, and accept somewhat more tasks in exchange for more of
them being able to proceed side by side. Declare `Depends:` only for real prerequisites and give every task a `Touches:`
field, so tasks that do not overlap are visibly disjoint.

### high

Optimize for the largest number of tasks that can proceed side by side: split aggressively along file and module
boundaries, move changes to shared files (common headers, build files, registries) into short tasks that come first
and that the rest depend on, and accept the extra merge and coordination overhead. Declare `Depends:` only for real
prerequisites and give every task a precise `Touches:` field.

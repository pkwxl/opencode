You are the handover distiller for the "Implementation" phase (m): this phase's work is wrapped up (a phase
with a task checklist has all its tasks done; a phase with no task checklist has no task index tasks.md — that is
expected). Read this phase's task units and docs/ artifacts in full, and distill into a handover document the
knowledge that needs to carry across phases. Distill only, do not implement, do not modify any existing artifact.

## Handover recipient

The next phase is "P03-test Testing". It takes this document as its main input for cross-phase memory (the prior
phase's raw docs/ will not be injected), so distill on the standard "the next phase can safely start without
reading the raw artifacts."
## Input (read-only)

- This phase's task list and execution trail: this phase directory's task index tasks.md and the tasks it lists,
  docs/T-NNN/ (done.md is the task content, plus artifacts such as report.md; if this phase has no task index, skip
  this item and go by this phase's actual docs/ artifacts instead);
- This phase's docs/ artifacts and this round's round directory docs/R-NN/; upstream phases' handover documents are
  at their own phase directory's handover.md (a permanent path);
- Phase index: this round's round directory's phases.md (docs/R-NN/phases.md).

## Artifact

Write the handover document to docs/R-01/P02-implement/handover.md (its directory already created by the DRIVER, a permanent path — once
created it is not moved or renamed), with the four mandatory sections, headings matching verbatim, in this order:

## Key decisions

<the important decisions made in this phase and their reasons, rejected alternatives; decisions annotated
AUTO-DECISION in the body take priority>

## Constraints and pitfalls

<environment constraints, dependency traps, easy mistakes and workarounds discovered during execution; only write
pitfalls the next phase would step in>

## Required reading for the next phase

<the artifact list the next phase must read before starting, one line per item: `- <path relative to the target directory>: <why it must be read>`>

## Artifact index

<an index of all this phase's artifacts, one line per item: `- <path relative to the target directory>: <one-line note>`>

## Steps

1. Read-only survey: read this phase's task index and task units in full (skip if there is no task index) and this
   phase's docs/ artifacts; when unsure of the full picture, go through the directory listing item by item;
2. Distill into the document: write the handover document by the four sections — distill, do not enumerate; each
   piece of information's admission bar is "the next phase can use this"; no one-off process detail or transient
   state;
3. End the session immediately once a valid docs/R-01/P02-implement/handover.md is written.

## Constraints

1. The only file this session may write is docs/R-01/P02-implement/handover.md;
   every other file, and every state file, is outside this session's write scope.
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
3. The handover document must be self-contained: when a section references an artifact, give its permanent path
   relative to the target directory (docs/T-NNN/…, docs/R-NN/P<nn>-<type>/…) so the reader can locate it without
   cross-checking this prompt.
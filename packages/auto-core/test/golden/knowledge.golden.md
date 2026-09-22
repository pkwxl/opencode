You are the knowledge distiller for this migration: the work of every phase is finished. Read through the phase index and each
phase's artifacts, and distil the **finally verified** migration experience into one structured knowledge document for
reuse by the next migration and by later maintenance. Distil only — implement nothing and change no existing artifact.

Scenario mode notes (migrate):

Migration/upgrade mode notes:
- The new implementation must stay behaviourally equivalent to the old one (inputs and outputs, edge cases and error paths must not drift);
- Any compatibility layer, temporary branch or switch introduced during the migration must state its purpose and when it is to be removed;
- Every trade-off made to advance the migration (leaving an old path in place, simplifying a branch, and the like) is a code-change decision:
  record how it was made and annotate it as AUTO-DECISION requires.

## Inputs (read-only)

- The phase index docs/R-NN/phases.md (inside this round's directory): this round's phases in order, each with its own phase
  directory docs/R-NN/P<nn>-<type>/;
- Each phase's handover document docs/R-NN/P<nn>-<type>/handover.md: read these closely first (they are the phase's distilled
  conclusions); each phase directory also holds that phase's task index tasks.md — when you need more
  detail, fetch the original artifacts through the handover document's `## 产物索引` (artifact index) section (permanent paths,
  docs/T-NNN/…);
- A git log overview: to locate each batch of changes and its commit message (git log --oneline is enough; no need to expand each
  entry).

## Artifact

Write the knowledge document to docs/R-01/P04-knowledge/kb.md (overwrite), organised by the following section skeleton (headings exactly as given, in
this order; keep the heading of a section with little information and explain why — do not delete sections):

# Migration knowledge base: <one-sentence description of the project/module>

## Migration summary

<what was done, why it was migrated, the final state — summed up in one paragraph>

## API and type mapping

<old interface/type → new interface/type correspondences, each with a verifiable anchor on both sides>

## Implementation patterns

<the implementation recipes used repeatedly during the migration, the structure and organisation of the adaptation layer>

## Pitfalls and edge cases

<pitfalls hit, edge cases, differences on error paths and how to get around them>

## Reusable rules

<rules or checklists the next migration can reuse directly, each item standing on its own>

## Design deviations and key decisions

<known deviations from the original design/implementation and the important trade-offs; prefer the decisions annotated as
AUTO-DECISION in docs/ and in code comments; a rejected approach is recorded only as a lesson explicitly labelled "rejected">

## Verification evidence

<how it was verified and pointers to the results: tests, acceptance reports and the like — what the conclusions rest on>

## References

<index of source artifacts, one per line `- <path relative to the target directory>: <one-sentence description>`>

## Quality constraints (hard requirements)

1. Final state first: record only knowledge that was finally verified; an approach overturned during the process or rejected at
   acceptance must not be recorded as the current approach, only as a general lesson explicitly labelled "rejected";
2. Deduplicate: each piece of knowledge appears once, under the section it fits best;
3. Do not copy session dialogue, run logs or intermediate reasoning — keep only conclusions and anchors;
4. Attach at least one verifiable anchor to every important piece of knowledge (file path/API/design document/commit/test/report).

## Steps

1. Read-only survey: read the phase index phases.md in this round's directory docs/R-NN/ and the handover.md in each phase
   directory to grasp the whole migration; when you need detail, fetch the task index and the original artifacts through the
   artifact index — do not skip a phase you have not read yet;
2. Distil into writing: write the knowledge document along the section skeleton — distil rather than enumerate; one-off process
   details and temporary state do not belong in it;
3. End the session as soon as a valid docs/R-01/P04-knowledge/kb.md is written.

## Constraints

1. Read-only analysis: the only file you may write this time is docs/R-01/P04-knowledge/kb.md; do not create or modify any other file; CURRENT.md, the index ticks and the todo.md → done.md renames of phases, tasks and subtasks are maintained by the DRIVER alone; CURRENT.md is read-only for the duration of the session — you must not edit it, and must not restore its write permission with chmod or the like.
Git commits are made by the DRIVER in one pass after the session ends; do not run git commit or any other commit command.
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
3. Writing that document is a hard requirement: even with little information, write out the full section skeleton and explain
   why; producing no document makes this phase's knowledge extraction fail;
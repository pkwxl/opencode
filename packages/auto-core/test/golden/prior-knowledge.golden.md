You are the knowledge distiller for a migration retrospective: this working directory already holds the artifacts of an earlier
migration (possibly done by hand, by other tools, or by earlier rounds of this tool). Read through these existing migration
results and distil the **finally verified** migration experience in them into one structured knowledge document, as input to the
second migration about to start (the full admtvk flow) and to the inference of the migration parameters. Distil only — implement
nothing and change no existing artifact.

Scenario mode notes (migrate):

Migration/upgrade mode notes:
- The new implementation must stay behaviourally equivalent to the old one (inputs and outputs, edge cases and error paths must not drift);
- Any compatibility layer, temporary branch or switch introduced during the migration must state its purpose and when it is to be removed;
- Every trade-off made to advance the migration (leaving an old path in place, simplifying a branch, and the like) is a code-change decision:
  record how it was made and annotate it as AUTO-DECISION requires.

## Input: project intent (.opencode/auto/brief.md)

Second-pass migration intent.

## Input: existing distilled artifacts (reference, do not restate)

The following previously distilled knowledge/handover documents already exist. Their conclusions **must not be restated in this
document** — the relevant sections carry only a one-line reference (`see <path>: <one sentence>`). This document's added value =
a differential forecast for the migration target about to start: the mappings, pitfalls and reusable rules specific to the new
target.

- docs/R-00/prior-kb.md

## Inputs (read-only)

- The whole docs/ tree: the document artifacts of the existing migration; inside earlier rounds' directories docs/R-NN/, the
  phase handover documents (P<nn>-<type>/handover.md), the migration knowledge (P<nn>-knowledge/kb.md) and earlier rounds'
  prior knowledge (prior-kb.md) are previously distilled conclusions — read them closely first; the task indexes
  tasks.md inside the phase directories only list the tasks — when you need detail, fetch it through the handover document's `## Artifact index` section;
- The migrated code itself (the current state on the target side): check the final state against the documents; where documents
  and code disagree, the code wins, and note the discrepancy in the document;
- The migration source (if it exists inside the working directory): work out its layout and module boundaries, and record
  relative-path clues that locate it;
- A git log overview: to locate each batch of changes and its commit message (git log --oneline is enough; no need to expand each
  entry).

## Artifact

Write the knowledge document to docs/R-01/temp-kb.md (overwrite), organised by the following section skeleton (headings exactly as given, in
this order; keep the heading of a section with little information and explain why — do not delete sections). docs/R-01/temp-kb.md is an
intermediate artifact path: once every section is written, put the line `DONE` on a line of its own at the very end of the document
as the closing mark — this is a DRIVER-parsed protocol string: write it verbatim, do not translate it. The DRIVER accepts only a
document carrying that mark, and only after confirming it does it promote the file to the official prior-knowledge document and
commit it; never write that line before every section is complete.

# Migration knowledge base: <one-sentence description of the project/module>

## Migration summary

<what the earlier migration did, why it was migrated, the final state — summed up in one paragraph; give the relative paths of
the migration source and target inside the working directory (if established)>

## API and type mapping

<old interface/type → new interface/type correspondences, each with a verifiable anchor on both sides>

## Implementation patterns

<the implementation recipes used repeatedly during the migration, the structure and organisation of the adaptation layer>

## Pitfalls and edge cases

<pitfalls hit, edge cases, differences on error paths and how to get around them>

## Reusable rules

<rules or checklists the second migration can reuse directly, each item standing on its own>

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
2. Deduplicate: each piece of knowledge appears once, under the section it fits best; knowledge already covered by an existing
   distilled artifact (see the list above, if given) gets a one-line reference instead of an excerpt — deduplicate across documents;
3. Do not copy session dialogue, run logs or intermediate reasoning — keep only conclusions and anchors;
4. Attach at least one verifiable anchor to every important piece of knowledge (file path/API/design document/commit/test/report).

## Steps

1. Read-only survey: read the handover/knowledge documents in docs/ and in each round's phase directories to grasp the whole existing
   migration; when you need detail, fetch the archived artifacts through the artifact index — do not skip a part you have not read
   yet;
2. Distil into writing: write the knowledge document along the section skeleton — distil rather than enumerate; one-off process
   details and temporary state do not belong in it;
3. End the session as soon as a valid docs/R-01/temp-kb.md (with the closing `DONE` mark at the end) is written.

## Constraints

1. Read-only analysis: the only file you may write this time is docs/R-01/temp-kb.md; do not create or modify any other file; todo.md → done.md renames and the index ticks of phases, tasks and subtasks are maintained by the DRIVER alone — do not make them yourself.
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
3. Writing that document is a hard requirement: even if the existing migration results are sparse, write out the full section
   skeleton and explain why; producing no document, or a document missing the closing `DONE` mark at the end, makes the
   prior-knowledge extraction fail;
You are the knowledge distiller for this migration: the work of every phase is finished. Read through the phase index and each
phase's artifacts, and distil the **finally verified** migration experience into one structured knowledge document for
reuse by the next migration and by later maintenance. Distil only — implement nothing and change no existing artifact.

{{#if modeExec}}
Scenario mode notes ({{modeName}}):

{{modeExec}}

{{/if}}
## Inputs (read-only)

- The phase index docs/R-NN/phases.md (inside this round's directory): this round's phases in order, each with its own phase
  directory docs/R-NN/P<nn>-<type>/;
- Each phase's handover document docs/R-NN/P<nn>-<type>/handover.md — read these closely first (the phase's distilled conclusions);
  when you need more detail, fetch the original artifacts through the handover's `## Artifact index` section (permanent paths, docs/T-NNN/…);
- A git log overview: to locate each batch of changes and its commit message (git log --oneline is enough).

## Artifact

Write the knowledge document to {{file}} (overwrite), organised by the following section skeleton (headings exactly as given, in
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

{{#if qualityRules}}## Quality constraints (hard requirements)

{{qualityRules}}

{{/if}}## Steps

1. Read-only survey: read the phase index phases.md in this round's docs/R-NN/ and each phase directory's handover.md to grasp
   the whole migration; when you need detail, fetch the original artifacts through the artifact index — do not skip a phase you
   have not read;
2. Distil into writing: write the knowledge document along the section skeleton — distil rather than enumerate; one-off process
   details and temporary state do not belong in it;
3. End the session as soon as a valid {{file}} is written.

## Constraints

1. Read-only analysis: the only file you may write this time is {{file}}; do not create or modify any other file.
{{> question-rule}}
3. Writing that document is a hard requirement: even with little information, write out the full section skeleton and explain
   why; producing no document makes this phase's knowledge extraction fail;

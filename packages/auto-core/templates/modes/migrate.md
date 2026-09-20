# migrate

## init
This plan belongs to a migration/upgrade scenario, on the premise that externally visible behaviour stays the same:
- Arrange the tasks as "baseline confirmation → migration work → regression verification": first fix the baseline of the current external
  behaviour (existing tests, reproducible checks or behaviour snapshots), then do the migration work, and do regression verification last;
{{#if verify}}
- For each task's verify field, prefer reusing an existing test/build command over inventing a check that has never been run;
{{/if}}
- Do not smuggle in functional changes or refactoring unrelated to the migration; when one is genuinely needed, make it a task of its own.

## exec
Migration/upgrade mode notes:
- The new implementation must stay behaviourally equivalent to the old one (inputs and outputs, edge cases and error paths must not drift);
- Any compatibility layer, temporary branch or switch introduced during the migration must state its purpose and when it is to be removed;
- Every trade-off made to advance the migration (leaving an old path in place, simplifying a branch, and the like) is a code-change decision:
  record how it was made and annotate it as AUTO-DECISION requires.

## final: audit
What the final review of a migration scenario focuses on: spot-check the old and new implementations for behavioural equivalence against the
baseline, and look for leftover old paths, dead code and compatibility layers that were never closed out.

## final: validate
What regression means in a migration scenario: whether the existing test/build commands cover the baseline behaviour adequately, and whether
uncovered behavioural differences have been verified separately.

## final: finalize
What closing out means in a migration scenario: cleaning up the old implementation and closing out the compatibility layers (removing them,
archiving them, or stating why they are kept).

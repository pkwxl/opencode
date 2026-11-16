# debug

## init
This plan belongs to a debugging scenario: one or more defects are observed and the cause is not yet named:
- Arrange the tasks as "reproduce → diagnose → fix → verify": first make the defect reproducible (a failing test, a script,
  or a recorded procedure), then isolate and name the cause, then fix it, and verify the fix against the reproduction and
  the surrounding regression surface;
- The reproduction comes first: no fix task is planned before a failing reproduction exists, and no speculative fix is
  planned before the cause is named;
- One defect per task; a diagnosis that surfaces a second defect plans a task of its own.

## exec
Debugging mode notes:
- Instrument minimally (logs, breakpoints, probes) and remove the instrumentation when the fix lands — debugging
  scaffolding never ships;
- Convert the diagnosis into a failing test that the fix turns green; a fix that cannot be pinned by a test states why
  in its report;
- Fix the named cause only: no drive-by refactors, no unrelated cleanups riding a defect fix;
- When the cause proves to be elsewhere than first assumed, record the corrected diagnosis in the task's documents
  (AUTO-DECISION where a trade-off was made).

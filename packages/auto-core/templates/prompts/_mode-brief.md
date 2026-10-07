You are reading the operating-mode brief of the auto driver — the tool that runs the pipeline this
blockage belongs to. It states the surfaces, who owns the words on each, and the channels that change
them, so a remediation can be proposed against the real mechanics instead of guessed at.

## Surfaces and ownership

- **Person words** — the project brief (`.opencode/auto/brief.md`), a phase's planning input
  (`docs/R-NN/P<nn>-<type>/plan-input.md`), the intent pack (`.opencode/auto/intents/<name>.md` and the
  materialized bundle surfaces), survey answers. The person writes them through commands
  (`init/amend --brief`, `plan -p | --file`, editing between runs) or by approving a proposal the driver
  installs verbatim. The driver never chooses these words; it may only install words the person just
  sanctioned.
- **Driver-distilled process documents** — phase handovers (`docs/R-NN/P<nn>-<type>/handover.md`), round
  reports, audits, task documents (`docs/T-NNN/`). Sessions draft them, the driver commits and renames
  them; between runs a person may edit them like any file.
- **Driver-exclusive state** — the index ticks and the `todo.md` → `done.md` renames,
  `.auto/units.json`, `.auto/progress.json`, the round phase index `docs/R-NN/phases.md`. Nothing but the
  driver's own transitions write these; no remediation may touch them.

## Gates and exit codes

The run exits 0 complete / 1 usage or environment error / 2 blocked for human attention / 130 force-quit.
The gates that can block: the render gate (a prompt violating the intent's declared asserts), plan
verification (a composed planning prompt contradicting the intent charter `### verify-plan`), the survey
clarification gate (open `Fork:` questions), the round-close gate, the verdict/acceptance gates, and the
SHA baseline at unit close-out. A blocked run keeps the tree committed; the person resolves the cause and
re-runs. No verdict is ever taken from a session's self-report: completion is artifacts on disk plus the
driver's commits.

## Remediation channels

- `handover-edit` / `task-doc-note`: plain edits of driver-distilled process documents.
- `planning-input`: goes through the planning-input save (its own commit).
- `brief-amend`: the brief write path (protect-passing when mid-run).
- `pack-amend`: edits the materialized pack between runs; the next preflight re-validates its grammar.
- `advice`: nothing is executed; the person runs the recommended command.

## What the executor may do

An approved remediation may apply exactly the enumerated edits, one commit each, and only while each
edit's old span still matches the file literally. Every gate re-runs afterwards — remediation never
clears a verdict, only the gate re-running clears it. Driver-exclusive state stays untouched; the
deliverable's independence rules (P1) hold regardless.

<!-- auto: eof -->

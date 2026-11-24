# 0301 — Recover an interrupted formulation over the executor protocol

## Category scope

Tier: executor settlement and daemon operations. Report 0300 recorded three
failures on the same unit. This change makes the graceful stop, the
successor’s retry and the operator’s stop reachable through public routes.
Premises this ruling changes: 0276, 0282 and 0287.

## Decisions

- 0276’s formulation checks still apply whenever a share writes planning
  output. A share interrupted before that output can land its sole changed
  artifact, the unit handoff carrying `Status: continue`. The coordinator
  checks its staged text and uses the existing continuation receipt and
  routing. The next formulation share owns completion and coverage.
- 0282’s `brief` also serves a grant whose ended report awaits a receipt.
  The same token, channel, unit and kind identify it. Readback returns the
  booked pair for repair and replay. It issues no lease and leaves the
  original deadline and report booking intact.
- 0287’s operator operations still honor the run lock. When a live
  coordinator holds the directory, the write refusal names its actual
  `DELETE /runs/<id>` and the terminal-state check before retry. Stopping
  the run releases the lock. The booking survives for a successor.

Derives: P5 (the booked grant owns the replay pair), P8 (the refusal names
an executable remedy), P10 (completed and partially written plans still
pass the full collect) and P19 (the wire regression exercises the stop,
restart, repair and duplicate report through the public daemon).

# 0306 — Shared lane scope decisions

## Category scope

Tier: push session removal. This continues 0305 under 0296 and 0256
Program S. The pull executor used documentation lane scope checks from
`lanes.ts`, which also imports stream split handling and owns push lane
dispatch. Task handoff used the same module for path overlap.

## Decision

Move path overlap, documentation lane eligibility, effective task scope,
and scope disjointness to `src/lane-scope.ts`. The executor coordinator,
task handoff, and push scheduler use that module. The `lanes` subpath
continues to export the same four helpers. Missing or empty declarations
still prevent parallel admission, and effective documentation scopes still
include the task's own directory.

Derives: P10 (admission and overlap behavior carry forward) and P21
(separate shared decisions before removing the push scheduler).

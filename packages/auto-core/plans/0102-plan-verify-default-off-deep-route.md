# 0102 — Plan verifier: default off, deep route when on

Status: **done.** The ruling was settled with the person on 2026-10-22, from the
aster-mig fleet's evidence, and landed the same day. It amends plans/0080 §5 (the
plan-step verifier's activation and model selection); nothing else of the
guarantees machinery changes.

## The evidence

The fleet's operator registry routes `classifier` to a cheap endpoint (`glm-flash`).
Three transfers in a row fail-closed on it:

- R-03's formulation and twice its handover step: `the verifier glm-flash gave no
  verdict within 120 s` (after the one retry), each stop a person-facing blockage
  document (`docs/R-03`'s blockage-3, then R-04's blockage-1 on 2026-10-22);
- in the same minutes the synthesis constructor on the deep route (`glm`) degraded
  twice to the Stage-1 floor — tolerated, recorded — so the primary failures were an
  unanswered endpoint, not prompt size;
- one deep-route timeout besides: `glm` itself missed 120 s once on a large handover
  prompt — the wall, not just the endpoint, is reachable.

The verdict history across the fleet's projects at the ruling: 13 `consistent`, one
genuine `INCONSISTENT` catch (a grant presented as settled where the charter requires
OPEN — a composition-level conflict), three graceful `skipped`, three-plus timeouts.
The consistent verdicts dominate because the person's authoring-side discipline
(their helper sessions, the guidance states, the gates) already carries most of the
charter conformance; what the fleet was paying for at the margin was a flaky cheap
endpoint gating every planning step.

## The ruling

**D1 — default off.** `OPENCODE_AUTO_PLAN_VERIFY` defaults to off (0080 shipped it
default on). `on` re-enables the check for a pack that declares a charter — the
switch never adds a charter to a pack without one, exactly as before. The mechanical
layers always hold: the render-gate asserts at `renderPrompt`, the precedence
blocks, the wrap-up session's charter acceptance with its fix rounds. The 0082
record-time charter check (`checkTextAgainstCharter`, its `Clamp:` reply) is **not**
part of this switch and keeps running — it stays on the classifier entry with its
60 s wall, being the simple-outcome determination the classifier tier is for. A
skip is still appended to `docs/R-NN/prompt-audit.md`: an audit wall must not imply
a verification that did not run.

**D2 — the deep planning route when on.** The verifier's model comes from the
`phase-plan` candidate list — the deep tier the planning sessions and the synthesis
constructor dispatch on — walked with the classifierEntry discipline
(`planningRouteEntry` in `src/prompt-verify.ts`, the formulate-synthesis
`planRouteEntry` precedent; a `phase-plan` route in the operator registry overrides
the tier list, so a dedicated verifier model remains expressible). Never the
`classifier` route again: charter conformance over a possibly large composed
planning prompt is deep work, and a cheap endpoint's availability must not gate
every planning step. The handover distill-time check (0082 D13/D14a) rides the same
function and therefore the same route and switch. The accepted trade-off, stated by
the person: the verifier often shares the planner's/constructor's model —
cross-model independence is traded for availability and depth.

**D3 — no wall (revised from the landed 300 s interim, the person's second ruling
of 2026-10-22).** The verifier carries no wall-clock limit at all: it is a deep
session whose reply is waited for, not a classification call on a timer — every
fail-closed block the fleet ever recorded was a wall, never content. The
one-shot machinery's wall became optional (`oneShot`'s overload proves a
wall-less call cannot time out); the verifier passes none. Termination is the
session's own: idle (the reply), the stream's end or a failure event (a session
error — retried once, then fail-closed as ever for errors and unparsable
replies), or the person's control. The wait is visible: one line naming the
step and the model before the session opens (the constructor's start-line
discipline, 0097). The classifier (30 s), the record-time charter check (60 s)
and the synthesis constructor (its configurable planning-scale wall) keep
theirs — they are the simple determinations and the budgeted constructor, not
a verdict being waited on.

Considered and rejected: retiring the check outright — the product keeps the opt-in
because guarantees ride mechanism, not whoever happens to assist (a user without an
authoring-side helper loses everything the check covers, and the composed prompt
holds blocks no helper authors — core partials, pack duties, digests); moving the
verifier to a tooled session — the bare one-shot shape stays (tools denied,
questions refused, strict `Consistent:` parse, fail-closed after one retry).

## Enactment

- `src/switches.ts` — the default flip with the comments restated (opt-in, deep
  route when on).
- `src/prompt-verify.ts` — `planningRouteEntry`, the selection switch inside
  `verifyPlanPrompt` with the skip reasons renamed to the planning route, no wall
  (D3 — `oneShot`'s optional timeout through the overload), the wait-visibility
  line, the header comment; `checkTextAgainstCharter` untouched.
- Tests — `test/switches.test.ts`'s default snapshots; the two verifier-exercising
  suites (`formulate-synthesis`, `blockage-diagnosis`) clamp the switch on for their
  own runs and restore the default (the `clampSwitches` restore idiom), the
  synthesis ladder pinning the verifier session's model as the deep entry's; the new
  `test/prompt-verify.test.ts` pins the routing (deep over classifier, the
  `phase-plan` route override, the agent filter, the undefined cases) and the
  switch-off skip reason.
- Docs — `docs/structure.md`'s Plan-step verifier row and this package's AGENTS.md
  guarantees line carry the new default, route and pointer.

# 0168 — The steer chain's bounds: advisory, then the person

Status: **active**. Ruled 2026-11-05 by 0166 step 007 (wave W0-governance), enacting 0165-018
(S10-05).

## Derives

Derives: P2 — with P20 and P19 in the derivation. P2 shows in the chain being named what it is:
the driver's automatic re-dispatch of a fresh session per `Status: continue` is an automatic
escalation (spend and sessions accumulate without any person's act), and P2's own text — "every
automatic escalation is bounded and terminates at the person" — makes the unbounded chain a
constitutional defect, not a tuning question; the ruling gives it both halves of P20's shape
(heuristics advise before they enforce: the advisory tier first, the block the terminal). P19
shows in the numbers being provisional and their re-measurement basis named (the 0130 D5 journal
records every handover with its figures — the basis a later ruling reads). Tier: operating — P2's
escalation bound applied to an existing mechanism; no Tier I statement changes.

premises this ruling changes: none — 0130's steer-chain economics (D1–D5) and 0023's
test-handover advisory stand; this ruling adds the missing bound beside them.

## Category scope (0123 D1's discipline)

Family: *the session-handover family — the steer chain's continuation bound* (the context
handover's dispatch loop, every scope sharing one verdict engine). Home-set:

| home | disposition |
|---|---|
| `src/execute.ts` | changed — `HandoverState` gains `continuations`; the two bounds; `handoverVerdict` counts and returns the person's block past the bound; both dispatch loops pass the advisory count to the renderers |
| `src/wrapup.ts` | changed — the fix round's handover state carries the count; its dispatch passes the advisory |
| `src/prompt.ts` | changed — `renderWhole`/`renderSubtask`/`renderFix` accept and pass `chainAdvisory`/`chainBound` |
| `templates/prompts/whole.md` + `subtask.md` + `fix.md` | changed — the advisory block beside each continuation clause |
| `test/execute-handover.test.ts` | changed — the two regressions (the advisory in the continuation prompt past the advisory bound; the person's block past the chain bound) |

## The ruling

**D1 — a continuation chain is a P2 escalation, bounded in two tiers.** The steer chain's every
`Status: continue` dispatches a fresh session on the session's self-report alone; nothing counted
the chain, so the person was never the terminal (the confirmed shape: 25 chained sessions, zero
driver lines naming the length). Two tiers, both counting continuations of **one scope** in
`HandoverState` (each scope's own chain — a whole task, a stream, a fix round):

- **The advisory** (the 0023 `TEST_HANDOVER_ADVISORY` shape, same number): past
  `STEER_CHAIN_ADVISORY = 10` continuations the next session's prompt carries the chain's length
  and an honest-assessment teaching — finish what can be finished and end with `Status: done` for
  the completed part, mark the leftover `AUTO-FIXME` where it lives, park per the dependency-park
  rule if a block only another task can lift. The chain keeps running: legitimate long work
  (a task many walls deep) is not punished at ten.
- **The bound** (P2's terminal): past `STEER_CHAIN_BOUND = 20` continuations `handoverVerdict`
  returns the engine's existing `blocked` verdict naming the scope, the count and the figures —
  the person decides; the unified-commit trail and the handoff document hold everything the
  continuation would have carried.

The numbers are provisional by construction: ten is the sibling chain's ruled advisory (0023),
twenty gives the advisory a full assess→act cycle before the terminal, and the 0130 D5 journal
(every handover emitted with `due`, tokens in use, the wall) is the named re-measurement basis —
a later ruling retunes both from field figures (P19).

**D2 — the floors and the count's lifetime.** The count lives in the dispatch loop's
`HandoverState` (in-memory, per run): a resumed run's chain restarts the count — the floor, named
here — because no durable per-scope chain ledger exists (the journal is best-effort; deriving the
count from git is impossible by design — a wall handover with nothing durable commits nothing).
Within one run the bound is exact. The 0023 test-handover chain is untouched (its advisory-only
posture stands — its chain is bounded by the fix-round budget around it); the stuck detector
(per session) and the 0146 fix-round progress rule are untouched (they bound other things). No
switch, no config: the bounds are constants like their 0023 sibling (P21 — no consumer for a
knob).

## Tests

`test/execute-handover.test.ts` — the chain regression (each session hands over fresh; the
eleventh continuation's prompt carries the advisory naming the count; the twenty-first verdict
blocks for the person with the count in the question). The prompt suites
(`test/prompt-exec.test.ts`, `test/prompt-phase.test.ts`, `test/prompt-template.test.ts`) pin the
template grammar after the advisory blocks land.

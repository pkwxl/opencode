# Step 007 — w0-handover-bound

Wave W0-governance · finding 0165-018 (S10-05, S2) · status: **done** 2026-11-05
Started 2026-11-05 · start HEAD c4fb131f7 · verified and committed same day.

## Scope (as enacted)

The context-handover chain had no bound and no advisory: every scope (whole task, stream, fix
round) re-dispatched a fresh session per fresh `Status: continue` forever — the session's
self-report alone ended the chain. The remedy demanded a ruling, not a patch. The wave's ruling is
**[plans/0168-steer-chain-bound.md](../0168-steer-chain-bound.md)** (Derives: P2 with P20 and P19;
tier: operating; Category scope with five changed homes; `premises this ruling changes: none` —
the first 0167-guarded ruling, its line present, no premises changed).

## Changes

1. `plans/0168-steer-chain-bound.md` (created) — the ruling: D1 the two tiers (advisory at
   `STEER_CHAIN_ADVISORY = 10`, the 0023 sibling's shape and number; the person's block at
   `STEER_CHAIN_BOUND = 20` through the engine's existing blocked verdict), counting continuations
   of one scope in `HandoverState`; D2 the floors (the count in-memory per run — a resumed chain
   restarts it, no durable ledger exists and a wall handover with nothing durable commits nothing;
   the 0023 test chain, the stuck detector and the 0146 progress rule untouched; constants, no
   switch).
2. `src/execute.ts` — `HandoverState` gains `continuations`; the two exported constants;
   `handoverVerdict`'s continue branch increments the count and past the bound returns the blocked
   verdict naming the scope, the count, the bound and the tokens figure; both dispatch loops
   (executeWhole's renderWhole, runSubtask's renderSubtask) pass `chainAdvisory`/`chainBound` to
   the renderers only past the advisory count.
3. `src/wrapup.ts` — the fix round's state and its renderFix dispatch join the same shape.
4. `src/prompt.ts` — the three renderers accept and forward the chain vars (stringified — Ctx's
   index signature is string|boolean).
5. `templates/prompts/whole.md` + `subtask.md` + `fix.md` — the advisory block beside each
   continuation clause (the 0023 voice: assess honestly, finish the finishable, `AUTO-FIXME` the
   leftover, park per whole.md's dependency-park rule; the driver stops the chain at the bound) —
   prompt copy in templates per P15.
6. `test/execute-handover.test.ts` — the two chain regressions (12-handover chain: the 12th
   session's prompt is the first carrying the advisory naming "11 times", the 10th's carries
   nothing; an unending chain: the 21st handover returns blocked naming "21 continuations of this
   scope so far (bound 20, the advisory teaching from 10)", 21 sessions dispatched).
7. `AGENTS.md` — the session-context-handover navigation line gains the chain-bound clause, the
   three prompt templates and 0168; `plans/INDEX.md` — the 0168 row.

## Verification

- `bun test test/execute-handover.test.ts` — **12 pass, 0 fail** (10 before; both new regressions
  fail-for-the-defect by construction: without the count the advisory never renders and the
  unending chain never blocks).
- `bun test test/prompt-exec.test.ts test/prompt-phase.test.ts test/prompt-template.test.ts
  test/wrapup.test.ts test/verify-loop.test.ts` — 179 pass, 0 fail; `test/prompt-template.test.ts`
  standalone 27 pass (the template grammar pins hold with the advisory blocks); 
  `bun test test/agent-fake.test.ts` — 130 pass, 0 fail (the full dispatch-loop suite).
- `bun typecheck` — clean.
- `bun plans/0165-review/tools/family-check.ts` — run post-commit (untracked-plan limitation,
  step 005's note): **0168: 5 rows, 5 changed-paths, commits 1 — ok** expected; 0132/0167 stay ok.

## Dispositions

- **0165-018** — fixed (step 007, this commit, ruling 0168): the chain counts, advises at ten and
  terminates at the person at twenty; the person-facing question names the figures; the 0130 D5
  journal named as the re-measurement basis for the provisional numbers.

Residuals: the resumed-chain count restart (0168 D2's named floor — a durable per-scope chain
ledger would be new state with no ruling; the journal already records every handover); the
W-session/W-engine findings (025–027) remain their own steps' work.

# Step 021 — w5-sideband

Wave: W5-control. Findings: 0165-010 (S06-01, S2, CONFIRMED, the ∪1 union — the --interactive
sideband never detaches: a free line typed while no turn runs is promptAsync'd to the last
attached session, and both adapters start a fresh, unwatched agent turn on the idle session).
Started 2026-11-06 at HEAD `1492855d5`.

## Scope

The control sideband's lifetime: the detach the session layer calls when a dispatch's watch
ends, so a between-turns free line answers 0014 §2's own discard rule. The probe-never-attach
half stays S14-06's row (step 027); auto-server's worker-interactive attach is S30's family
(step 037).

## Design ruling

Ruling **0181** ([0181-sideband-detach.md](../0181-sideband-detach.md)): D1 `detach()` on the
Interactive surface, called from attempt's finally beside the stats backstop — the between-turns
binding clears, the free line discards, the next dispatch's attach re-binds. Derives P20 with
P4/P3/P2/P10; premises — 0157's probe-retargeting residual was this attach-only state's general
shape (closed here); 0014 §2, 0056's steer contract, 0069's sideband shape stand.

## Implementation order (the recovery map)

1. `src/control-types.ts` + `src/interactive.ts`: the detach member.
2. `src/attempt.ts`: the finally's call.
3. The Interactive doubles (six files); the two pins; fail-before; suites; bookkeeping; commit.

## Execution log

- 2026-11-06: step opened after step 020's commit (1492855d5) in the same worker stretch. The
  surfaces read (interactive.ts's free-line path and attach, control-types' Interactive,
  attempt's attach call site and its existing finally — the natural home).
- Implementation landed per the map. The full suite surfaced one more loose Interactive double
  (watch.test.ts's cast literal, invisible to typecheck) — its session errored on the missing
  detach; the double fixed.

## Verification

- `bun typecheck` clean in packages/auto-core and packages/auto.
- auto-core full suite: **2993 pass, 0 fail** (153 files; 2991 at step 020's close).
- Fail-before: `git stash push -- src/interactive.ts src/attempt.ts src/control-types.ts` →
  both pins red on the pre-change code (the between-turns line sends; no detach call recorded);
  `git stash pop` restored everything.
- packages/auto suite: 157 pass, 5 fail — the same pre-existing fork/remove-fork baseline
  (step 031's wave).

## Close-out

Step done 2026-11-06. Ruling 0181 active-authority; the INDEX row, the AGENTS.md control
navigation line, ledger row 0165-010 (the ∪1 union) and the program's status/current-position
land in the same commit. Residuals: the queued-note shape deferred (no measured demand, P21);
auto-server's worker-interactive attach rides S30's family (step 037).
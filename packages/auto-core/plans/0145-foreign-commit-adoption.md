# 0145 — foreign commits on the unexpected-interruption resume are adopted, never a stop: the person's hand-commit between the kill and the re-run continues the unit

The maintainer's field report (2026-10-28, over the `dm-glm-t089-100` fork of the aster-mig
project, `run -i --stop-after T-089`): *I have committed manually after `ctrl+C ctrl+C`. Why it
stop to re-run?* — with the run's log: T-089 reset from `in_progress` to `pending`, the unit
picked, "starting execution (attempt 3)", then the stop —

```
T-089 worktree not clean before the execution unit starts (suspected leftover from an abandoned
run or manual changes); handle it manually (commit/clean) and re-run:
  aster-dm-all: 1 non-driver commit(s) since baseline (no Auto-Stage trailer); external commits mixed in, session context is stale
  .: 2 non-driver commit(s) since baseline (no Auto-Stage trailer); external commits mixed in, session context is stale
```

The maintainer had force-quit the run mid-unit (two Ctrl+C, exit 130), committed the in-flight
work by hand — two commits in the fork's root repository, one in the nested `aster-dm-all` — and
re-run. The ruling, the maintainer's own words: *Perhaps we should not require a git clean upon
re-running after an unexpected interruption, but instead allow execution to continue.* Approved
after the assessment with *OK, go ahead*.

## The measurement (the incident, the design archaeology, and the mechanism's own re-anchoring)

- **The incident's own shape**: the person's commits were deliberate protection of in-flight
  work, and the re-run itself was the person's act — "continue this task". The stop's taught
  remedy ("handle it manually (commit/clean) and re-run") is exactly wrong for the case:
  committing is what *caused* the stop. The remedy the incident actually forced was
  hand-deleting `.auto/progress.json` — surgery on the driver's own runtime state, the very
  category the run banner says needs no manual cleanup. A stop whose only exit is person-side
  deletion of driver state is a defect signal, not a person gate.
- **The design archaeology** (plans/0022): §3.1③ states the drift consequence as "foreign
  commits have mixed in and the session context's view of the present is distorted → **no reuse,
  roll back**" — the check's whole job is a reuse-fidelity bar. §3.3 then (correctly) refuses to
  roll back a repository containing foreign commits — a rollback reclaims only driver commits and
  never rewrites a person's history. No reuse + rollback refused → the leftover composition
  escalated to `dirty` → exit 2, "to a human". That stop was **never itself ruled**: it fell out
  of the two rules. 0022's own original requirement is the opposite emphasis — "restore the state
  … **and continue in a new session**": the rollback exists to serve continuation, and when
  rollback is unavailable, stopping was nobody's design.
- **The non-strict floor**: with `OPENCODE_AUTO_STRICT_RESUME=off` the baseline check does not
  exist — a foreign-commit resume continues (and even reuses the session). The strict path's
  2026-10 default-on promotion inherited the composed stop with it; the fidelity bar became a
  run stop no incident had ever asked for.
- **The mechanism's own re-anchoring** (why adoption is safe for every downstream audit): both
  resume entry points already re-record the unit baseline at the *current* HEAD when the record
  is active (`runSerialUnit`, src/loop-task.ts; `runSubtask`, src/execute.ts) — the person's
  commits sit **before** the close-out range, which therefore still contains only driver commits.
  The release posture is likewise unaffected: `driverBaseline`'s walk stops at the first commit
  without the `Auto-Stage` trailer, so the person's commits remain the person's content at the
  person's release moment.

## D1 — the ruling: drift → fresh with adoption

The recovery ladder's drift branch (`recoveryLadder`, src/resume-gate.ts) no longer returns a
run-stopping dirty verdict: it returns **fresh**, the current committed state adopted as the
scene, and a fresh session continues from it. Three halves, each already owned by standing law:

1. **No reuse across foreign commits — kept.** §3.1③'s own logic: the recorded session's view of
   the present is distorted, so it is never continued — this also covers the alive-session case
   ("the person committed the session's own work" is indistinguishable from "the person changed
   the world", so the ladder does not try). The fresh session's resume note already teaches the
   disk-state continuation (`COMMIT_CLARIFY`: changes "may already have been committed to Git by
   the DRIVER (or by a human) … continue from the disk state, do not redo").
2. **No rollback over person commits — kept.** §3.3's refusal stands: nothing is stashed,
   nothing reset, the scene untouched.
3. **Continue from the current state.** The why names what was adopted — each repository's
   non-driver count since the recorded baseline — so the run log is the detection record (P8's
   line, not a block); the caller templates render it with their uniform action tails
   ("…; starting a new session to continue" / "…; redoing this step in a new session").

The `dirty` verdict kind is retired from the ladder (the drift branch was its only producer) and
the dead branches at both callers (`runTask`, `requireArtifact`) removed — the step caller
inherits the same ruling in one lockstep. Doc lanes need no carve-out: adoption never attempts
the rollback whose parent-tree rewrite `rollbackRefused` guards.

## D2 — baselineIntact's line is factual

`baselineIntact` (src/git.ts) reports the fact — `<rel>: N non-driver commit(s) since the
recorded baseline (no Auto-Stage trailer)` — and the interpretation (adoption, no reuse, no
rollback) lives in the ladder, the only consumer. The "non-driver commit" scan wording the audit
family shares (`unitViolations`, `rollbackUnit`, `land`'s foreign-commit refusal) is unchanged.

## D3 — the floors

- **The beginUnit clean gate for a non-active record is untouched.** The ruling's scope is the
  *unexpected interruption* (an active record): a graceful-exit rerun — the person's bracketed
  pause — still requires the clean tree, and "handle it manually (commit/clean) and re-run"
  remains the correct teaching there.
- **The rollback machinery and its foreign-commit refusal are untouched** (dead session with an
  intact baseline still stashes, resets and redoes cold).
- **The reuse bar is untouched** — foreign commits bar reuse forever.
- **The non-strict floor is byte-identical** (no check, as always); a legacy record without a
  baseline keeps its existing fresh rung.

## D4 — the named residuals

- A fresh session may partially redo work the person already committed; the resume note
  mitigates and verification arbitrates (P3) — the bounded cost the fresh path always paid.
- Uncommitted *person* dirt coexisting with an active record is still absorbed by the unified
  commit at close — 0022's own ruling (the dirty area is precisely the thing being recovered),
  unchanged and out of this change's scope.

Derives: **P8** (deliberate enforcement moments — the showing: the person already acted, by
committing and by re-running; the stop was the driver inventing a person ritual whose taught
remedy misled in exactly the case it fired, and the adoption line is the detection record that
teaches instead), **P2** (the person brackets every boundary — the showing: the re-run *is* the
person's bracket, "continue this task"; continuing from their committed state consumes no
decision, while stopping to ask permission for what they just did is the bracket-the-decided
anti-pattern), **P19** (measured evidence — the showing: the t089-100 field report beside 0022's
own requirement text and the non-strict floor), **P20** (in-flight work never destroyed — the
showing: adoption rewrites nothing, stashes nothing; the person's commits stay in history as the
person's). Amends: **0022 §3.1③/§3.3's composed foreign-commit verdict** (the run stop was never
explicitly ruled — it fell out of "no reuse" and "no rollback"; the composition is now ruled as
adoption, with §3.1③'s no-reuse and §3.3's rollback refusal both standing). Tier touched:
**mechanism** — core (`src/resume-gate.ts`, `src/git.ts`, dead branches in `src/runner.ts` and
`src/artifact.ts`) and the shell README's interruption-recovery paragraph.

## Category scope (0123 D1's discipline — reconstructed 2026-11-05 by 0166 step 003 from this ruling's D-blocks and landing commit a6c392034)

Family: *interruption recovery's foreign-commit verdict — what a resume does when the person has
committed into the recorded range.* Home-set reconstructed from D1–D4:

| home | disposition |
|---|---|
| `src/resume-gate.ts` (the adoption rung; the `dirty` verdict kind retired from the ladder) | changed — D1 |
| `src/git.ts` (baselineIntact's factual line naming the repository and count) | changed — D2 |
| `src/runner.ts` and `src/artifact.ts` (runTask's and requireArtifact's dead drift branches removed — the step caller inherits the ruling in one lockstep) | changed — D1 |
| `packages/auto/README.md` (the interruption-recovery paragraph) | changed |
| The beginUnit clean gate for a non-active record (graceful-exit rerun still requires the clean tree) | held, untouched — D3 |
| The rollback machinery and its foreign-commit refusal (`rollbackUnit`, `rollbackRefused` — dead session, intact baseline still stashes, resets, redoes cold) | held, untouched — D3 |
| The reuse bar (foreign commits bar reuse forever) and the non-strict floor | held, untouched — D3 |
| The audit family's shared "non-driver commit" scan wording (`unitViolations`, land's foreign-commit refusal) | held, untouched — D2 |
| Test homes: `test/resume-gate.test.ts` (the adoption pin over a seeded temp repository), `test/artifact.test.ts` (the strict-suite drift case rewritten to the adoption) | changed; `test/git.test.ts`'s baselineIntact pins held by the substring ("non-driver commit") |

Tests: `test/resume-gate.test.ts` — the adoption pin with a seeded temp repository (a live
session and an eligible model, adoption winning anyway: the fresh verdict's exact why string
naming the repository and count); `test/artifact.test.ts` — the strict-suite drift case rewritten
from the dirty stop to the adoption (not dirty; the step redone in a new session — one session
created, prompts to the fresh session, reset called; no stash; the person's commit still in
history; the resume log naming the adoption and the count); `test/git.test.ts`'s `baselineIntact`
pins unchanged beside the reworded line (the "non-driver commit" substring the pin).

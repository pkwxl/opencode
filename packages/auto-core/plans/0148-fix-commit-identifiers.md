# 0148 — the fix round commits per session (retry identifiers in git) and driver subjects carry short titles

The maintainer's rulings (2026-10-28, the dm-glm-t083-250 debrief's continuation), the maintainer's
own words:

> *Current fix commits lack retry identifiers; we can annotate both the retry attempt count and the
> session index of the current retry in git commit messages.*

> *Task titles do not need excessive project descriptions as the task ID already represents everything,
> and the commit subject line should remain concise.*

And the chosen shapes, ruled by the maintainer over the two design forks: **commit per session** (each
fix session's gap batch durable at its handover boundary, the subject carrying round and session index —
not one annotated round-end commit), and **a few leading words** of the title in the subject ("select a
few leading words is enough, keeping the git title short in whole" — not dropping the title, not keeping
it as written).

## The measurement (the incident's own opacity)

- The t083-250 log: fix round 2 ran 64m35s across handover continuations and landed as ONE commit
  (`T-083 fix 2 K5 verity (batch B14)`) — the session structure (which session closed what, where the
  context walls fell) invisible in history; and the exec/wrapup subjects carried the full descriptive
  title ("K2 families: flakey/dust/delay/ebs/switch/log-writes (batch B12)"), the identifier the
  maintainer keys on (the task id) buried in the noise.
- The mechanism's own walls: executeWhole already commits at every handover boundary (0094's share
  commits — the pattern exists); the unified commit already skips clean trees (an empty session costs
  nothing); and `commitTitle`'s truncation-at-100 was the only subject-length rule — a tail-truncation
  that keeps the noise and can shave the meaningful suffix (why `suffixedTitle` exists).

## D1 — per-session commits in the fix round

`runFixRound` commits after every session that ends in a handover-continue (the executeWhole pattern —
durable work at every safe point, crash-isomorphic with a kill there) and at natural round end; the
subject is `<id> fix <round>.<session> <short title>`, the session the round's 1-based dispatch ordinal.
A context-wall handover with nothing durable commits nothing (the unified commit skips a clean tree) —
the ordinal still advances, so git may skip indices. Retry/coldstart re-dispatches stay uncommitted
(the replaced session's partial work rides the next durable boundary). The ordinal is **derived from
the history** (`nextFixSession`: one past the highest `<id> fix <round>.<n>` subject across every
repository root), so a re-opened round (the 0142 rewind's roundless shape) continues the numbering —
never a second `fix 1.1`. The 0143 `/exit` boundary keeps its letter exactly: the boundary fires
first, the handing-over session's batch commits only after it — the round is "neither booked nor
committed past this point" precisely as ruled. The 0142 dead-channel order is untouched (the round's
last commit precedes the marker check as before). The SHA-baseline audit is unaffected: still only
driver commits in the range.

## D2 — short titles in every driver commit subject

One mechanical helper (`shortTitle`, in git.ts beside `commitTitle` — the commit-title family): the
title's first clause (cut at the first `:` / `(` / em-dash, where long titles park their parenthetical
detail) capped at four words, falling back to the title's leading words when the first clause is
empty. Applied at every driver subject construction that appends a task or subtask title — exec,
wrapup, fix, done, blocked/pending settles, park, decompose, the subtask `S<nn>` subjects, landing,
merge repair, landing-sync, ctxbase, the work-order pair. The full title stays in tasks.md / todo.md
and the run banners; `commitTitle`'s 100-character truncation stays as the backstop. A mechanical
rule, never a judgment of the title's content (P7); the session-title fallback in attempt.ts keeps
the full title (it is not a git subject).

## D3 — the manual suite's mirror

The manual-driver prompts teach the same grammar (`prompts/run.md`, `prompts/run-verify.md`): the fix
share subject `<task id> fix <round>.<session> <short title>` (the manual control deriving the session
from its own landed shares, as it derives the exec `[<k>]` ordinal today), every subject literal
moved from `<task title>` to `<short title>`, and the fix-budget sentences moved to the progress rule
(0146's mirror — "count the gap entries; a round that shrank the count buys the loop another round;
two consecutive no-gap rounds stop and report"). The ratchet's src-side pins moved with them (the
short-title forms, plus the new per-session fix subject pinned in wrapup.ts).

## The floors

- The `[<k>]` exec share ordinal (0094) is untouched — exec subjects keep their shape beside the
  short title.
- `commitTitle`/`suffixedTitle` semantics unchanged (the truncation backstop, the suffix-preserving
  variant).
- A no-verdict pack, `--no-wrapup`, the repair ladder — none touch fix commits; their floors hold.
- attempt.ts's `[auto] <id> <title>` session-title fallback keeps the full title.

## The named residuals

- A session that only re-dispatched (retry/coldstart) leaves no commit — its ordinal exists in the
  numbering only if a later durable session advances past it; a gapless 1..N sequence in git therefore
  does not mean N sessions without retries (the run log remains the session-level record).
- Nested-repository subjects ride `commitTree` uniformly; a round whose batches land in different
  roots numbers per the union scan (the derivation walks every root), so an ordinal is unique per
  round across the whole unit.

Derives: **P4** (committing is the completion condition — the showing: every handover-safe point is
now durable, a crash between a round's sessions loses no batch; the SHA baseline's range still holds
only driver commits), **P6** (derived state — the session ordinal derives from the log itself, no
persisted counter), **P13** (frozen vocabularies change in one lockstep — the subject grammar changed
in the same change across core, the manual prompts, and the ratchet that holds them together),
**P19** (the t083-250 log's invisible session structure; the maintainer's own reading of git history
as the retry record), **P7** (shortTitle a mechanical rule over the title's form, never its content).
Amends: **0083 D4's round-commit shape** (the round's one commit becomes per-session commits at the
round's own safe boundaries; 0083's booking, lifecycle and the 0143 boundary order standing). Tier
touched: **mechanism** — core (`src/wrapup.ts`, `src/git.ts`, the subject sites across `execute.ts`,
`loop-task.ts`, `lanes.ts`, `work-order.ts`, `session.ts`, `git-worktree.ts`), the manual suite
(`prompts/run.md`, `prompts/run-verify.md`, its ratchet), and the docs' restatements.

## Category scope (0123 D1's discipline — reconstructed 2026-11-05 by 0166 step 003 from this ruling's D-blocks and landing commit 676056468)

Family: *the driver's git subject grammars — the fix round's per-session commit numbering and the
short-title rule every driver subject obeys.* Home-set reconstructed from D1–D3 and the floors:

| home | disposition |
|---|---|
| `src/wrapup.ts` (the round's per-session commits at handover-safe boundaries; nextFixSession's log-derived ordinal) | changed — D1 |
| `src/git.ts` (shortTitle beside commitTitle — the commit-title family) | changed — D2 |
| The subject sites across `src/execute.ts`, `src/loop-task.ts`, `src/lanes.ts`, `src/work-order.ts`, `src/session.ts`, `src/git-worktree.ts` | changed — D2 |
| `prompts/run.md` and `prompts/run-verify.md` (the manual suite's mirror of both grammars) | changed — D3 |
| The `[<k>]` exec share ordinal (0094) and `commitTitle`/`suffixedTitle` semantics (the truncation backstop) | held, untouched — the floors |
| `src/attempt.ts`'s `[auto] <id> <title>` session-title fallback (not a git subject — keeps the full title) | held, untouched — D2 |
| The 0143 boundary order (the boundary fires first, batches commit after), the 0142 dead-channel order, the SHA-baseline audit's driver-only range | held, untouched — D1 |
| Test homes: `test/verify-loop.test.ts` (the handover-split pin flipped; the re-opened-round pin), `test/git.test.ts` (shortTitle, nextFixSession), `test/manual-prompts-ratchet.test.ts` (the lockstep pins) | changed |

Tests: `test/verify-loop.test.ts` — the handover-split pin deliberately flipped (the handing-over
session commits `fix 1.1` carrying the handoff document, the continuation's natural end commits
`fix 1.2` — the round's session shape readable in git by its indices); the re-opened-round pin (a
pre-committed `fix 1.1` and the roundless record: the re-run's first dispatch commits `1.2`, never a
second `1.1`); the exact-subject pins moved to the indexed form; `test/git.test.ts` — `shortTitle`'s
unit pins (the clause cut, the four-word cap, the CJK separator fallback) and `nextFixSession`'s
derivation (one past the highest ordinal across roots, fresh at 1 for another round or task);
`test/manual-prompts-ratchet.test.ts` — the src and prompts literals moved in lockstep, the
per-session fix subject pinned in wrapup.ts.

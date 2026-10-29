# 0152 — the task-usage ledger: every closed task stint and its intra-task sessions record before the stats layer destroys them

The maintainer's request (2026-10-29): "Perhaps we should orderly record the
token usage and elapsed time associated with each task and its intra-task
sessions, so as to facilitate subsequent comparative analysis." The
comparative analysis named is the standing backtest workflow over fork
worktrees (0150's fork-family numbering measurements, 0151's sandbox seams
ruling) — and the incident that exposed the gap was the T-027 A/B comparison
over the aster-mig cleanroom family (the `baseline-t027` fork against
`cleanroom/baseline`, both forked at the same task's landing, the same task
re-run in both): the fork's per-task figures were exactly recoverable — its
`.auto/stats.json` still held T-027 as the current task bucket, the last
task it ran — while the baseline, which had run on through T-034, had lost
T-027's per-task and per-session record entirely, and the comparison had to
reconstruct it by summing 831 per-turn context lines out of a 5.7MB driver
log (the method calibrated one-to-one against the fork's exact figures — 790
lines for 790 steps, the summed context equal to input+cacheRead to four
significant figures — so the reconstruction was sound; but it is archaeology
no future study should need, and it cannot recover the per-session split or
the elapsed-time brackets at all).

## The measurement (the three loss facts)

1. **The destruction seam** — `statsTask`'s id-change branch
   (`src/stats.ts`): on every task switch the task bucket is overwritten and
   the per-session map cleared in the same step. The stint's figures survive
   only inside the phase/round aggregates; the per-session record survives
   nowhere. Nothing else destroys them (`statsPhase` resets only the phase
   bucket; restarts and `flushStats` persist the document as it stands) —
   one seam, measured, is the whole loss.
2. **The journal is not history** — `startRunStatus` (`src/run-status.ts`)
   truncates `.auto/run-status.jsonl` at every run start, deliberately
   (0071 §3's tolerance; the journal is the run's live narrative for the
   daemon's tail, not a retention surface). It does carry per-session
   `usage-rollup` events — for the duration of one run.
3. **The reserved scopes** — the `usage-rollup` vocabulary defines
   `task`/`phase`/`round` scopes (`src/run-status-schema.ts`) that no code
   emits. A reserved name, never a half-built mechanism (P21 holding).

## D1 — the record: one self-contained line per closed stint

A new append-only file, `.auto/task-usage.jsonl`: one JSON line per **closed
task stint**, written at the destruction seam, embedding the stint's whole
per-session map so each line stands alone —

- identity and bracket: `task`, `phase`, `round`, `since`/`at` (a re-opened
  task yields one line per stint; the analysis groups by `task`);
- the closing bucket's final figures: `aiMs`/`wallMs`/`waitMs`, `sessions`,
  the full `usage` (input/output/reasoning/cacheRead/cacheWrite/cost/steps),
  the optional per-`models`/per-`tiers` sections;
- `sessionLog`: every entry of the map about to be cleared, ordered by
  last-active moment, each carrying its own `task` (sibling-lane strays
  included — the analysis filters, the record does not judge), the new
  `model`/`tier` (D3), `rounds`, `aiMs`/`wallMs`, its `usage`, `at`.

The schema half lives in `src/stats-schema.ts` (`TaskStintRecord` + the pure
`taskStintRecord` assembly, deep copies — the line must not alias the live
document's interiors, which the same step resets), following 0102 D7's
store/schema split; no new module, no import-direction edit. No in-tool
reader and no line-kind discriminator (P21): the consumer is the comparative
analysis itself, for which the plain-JSON line is machine-addressable per
P18 — the shape is documented here and in structure.md, nothing more.

## D2 — the seam: record exactly what is destroyed, when it is destroyed

The append rides `statsTask`'s id-change branch alone — after the closing
fold, immediately before the bucket reset and the sessions clear — through a
best-effort writer (`appendFileSync` in a swallowed try/catch, the P18
journals doctrine: a failed append is skipped, never a run failure; the
aggregates keep the figures regardless). The invariant: **nothing the stats
layer destroys is destroyed unrecorded.** Properties that fall out for free:

- *Exactly-once per stint*: the same id (an interruption resume) is the
  branch's no-op — no line, the stint is still open.
- *Crash-isomorphism*: a killed run leaves the stint open in `stats.json`;
  the next process accumulates into the same bucket and the eventual close
  records the whole bracket, pre-crash work included.
- *Complete coverage*: the ledger holds every closed stint; the current open
  stint stays readable in `stats.json` as today (the fork-of-this-incident
  read exactly that). Ledger ∪ current bucket = everything.
- *Unconditional in the closing id*: the bypass shape's unnamed pre-task
  bracket is a bracket too (its sessions carry their own task ids); the
  first `statsTask` of a run records the preceding unnamed stint rather than
  silently dropping it.

`run-status.jsonl`, its rotation, and the daemon's tail are untouched; the
dormant vocabulary scopes stay dormant.

## D3 — the session entries gain `model`/`tier` (additive)

`SessionStat` grows optional `model`/`tier`, stamped at the booking seam
(`statsSessionEnd` already receives both arguments) and carried by the
lenient parser (bad = missing, absent = absent — older documents
byte-compatible). The per-session model split is the comparative question
the ledger exists to answer; the working document gains no new mechanics
beyond the two optional fields.

## D4 — the floors and the named residuals

Always-on, no switch (0019's stats posture); no person-facing surface (the
ledger is a `.auto/` runtime file — the ignore set already covers it
wholesale, 0138; no gitignore, README or shell change). Named residuals: (a)
sessions evicted by the 64-entry cap before close are not in the embedded
log (a task with more than 64 sessions is the pathological edge; the bucket
figures keep them); (b) lane-worktree session detail dies at worktree
teardown as today — the parent's `lanes[unit]` record and the `lane-landing`
events are the surviving homes, unchanged; (c) classify/synthesis one-shots
book to phase/round only, outside the task-bracket shape, unchanged; (d) a
stint never followed by another task stays in `stats.json`, not the ledger —
by design, readable, not lost. The run-status-schema scope comment was
verified accurate as written (it states the scopes' semantics, not an
emission claim) — no correction needed.

Derives: **P18** (the record outlives the tool — append-only journals as the
interchange; the numbers history joins the family as plain JSON lines no
special tooling needs), **P6** (derived/minimal state — the working
document's mechanics are untouched, `stats.json` grows only two optional
fields, and the ledger is durable evidence every future reconstruction
re-derives from instead of archaeology over logs), **P19** (measured
evidence — the T-027 A/B reconstruction is the incident, cited; the fork
studies the maintainer rules over are the standing consumer), **P5** (single
ownership — closed-stint history has exactly one home and one writer, the
stats store at its destruction seam; no mirror, nothing else retains it).
Amends: **0019** (its accepted trade-off at the task switch — "losing
per-session display history" — is superseded for the closing bracket: the
stint and its session log now record before the reset; the cumulative
buckets, the depreciation discipline and the never-a-source-of-truth posture
all stand). Tier touched: **mechanism** — core only
(`src/stats-schema.ts`, `src/stats.ts`).

Tests: `test/stats.test.ts` — the "the task-usage ledger" describe: the
self-contained line with the unnamed pre-task bracket pinned beside the
task's own (figures, usage sum, models/tiers, the ordered session log with
model/tier); the same-id resume appending nothing; the cross-restart close
landing one line over the whole bracket; the best-effort append (a directory
in the ledger's place) never failing the switch; the sibling-lane booking
embedded with its own task id while its usage stays out of the closing
bucket; the model/tier lenient round-trip (present kept, absent missing, bad
dropped); the re-opened task's one line per stint with its own bracket.

Full typecheck clean in both packages; auto-core 2861 and the shell 156
passing (+ the E2E-gated skips).

# 0141 — the gated e2e repairs: the workdir never dirt, the dropped formulation row never a crash, the fixture's settlement performed

The maintainer's closing request of the 0140 incident (2026-10-27, the wrong-fork fix landed): *The fork of T-001
has already been removed. I don't know about the e2e issues, but maybe, you are able to fix them.* The gated
end-to-end suite (`OPENCODE_AUTO_E2E=1 bun test test/e2e.test.ts`, packages/auto — the live-model gate,
opt-in because it spawns real sessions) held **three** failures. The model in one sentence each:

- **the adm fixture died in 69 ms** — its hand-built repository (git init + one baseline commit, no init command)
  carries no ignore set, so the driver's own first writes (`.auto/run.lock`, the stats heartbeat) arrived as
  *untracked dirt* at the run-start gate, which ran **before** preflight's `ensureGitignore` could write the set —
  the gate named the driver's own state as the person's uncommitted work and exited 2;
- **the custom-phase-pipeline run crashed** — P02's formulation session rewrote the phase's task index *without
  the formulation task's own row* (the planning protocol taught "one line per task" but never that the unit's own
  row stays), and the post-session `reloadTask` threw `task T-003 not found` before the mechanical collect
  (plans/0095 D3) — the one home designed to name exactly this grammar breach — could run;
- **the block/resume fixture re-blocked deterministically** — T-002's task text commands asking a permission
  question; under the default question policy a permission question blocks unattended *every* time (plans/0020),
  and the fixture's "simulated human intervention" was a comment that settled nothing, so the resumed session
  asked again, blocked again, and the expected exit 0 never came.

Each root cause was verified before the fix (P19): the adm failure reproduced at the gate with the `.auto`
files named in its refusal lines; a re-run of the custom-phase test with full logging confirmed the crash site
(its first run reached the P01→P02 handover and the crash at T-003's reload; a second run, slower model sessions,
timed out at the harness's own 600 s while P02's formulation session was still running — the suite's slowness,
not a fourth defect); the block/resume arithmetic is the policy's own (a permission question, no `--wait-answer`,
the resume path feeding no context — `loop-task.ts` logs the block reason to the run log only by design).

This ruling Derives: **P8** (deliberate enforcement moments, every surfaced line teaches its remedy — the
showing: the gate's dirty lines taught a false remedy for the workdir, and the crash taught nothing; now the
workdir never appears where it is not dirt, and the dropped row surfaces as the collect's own blocked line naming
the act that repairs it), **P6** (derived state, idempotence — the showing: the workdir is derived runtime state
that self-heals and is law-ignored; the gate reads it as persisted dirt only in the window before the ignore set
arrives, and the fix makes the gate's read honor the law rather than the file's absence), **P12** (fail loud,
conservative under uncertainty — the showing: the crash was loud but wrong-shaped, and the fix gives the breach
its designed voice; conversely the exemption is *narrow* — untracked only, root-anchored, a tracked workdir file
still blocks, a nested repository's stray `.auto/` still blocks), **P10** (the byte-identical floor — the showing:
in a repository whose ignore set is on disk — every init-ed project — untracked workdir files never reach the
gate's dirty list, so the exemption is a no-op and every existing pin holds unchanged; only the set-less window
changes), and **P19** (measured evidence — the showing above; the gated suite is itself the measurement, and the
fixture repair restores its fidelity rather than loosening its assertions). Tier touched: **mechanism** — core
src (`src/git.ts`, `src/gitignore.ts` one export, `src/runner.ts`, `src/prompt-plan.ts`), the nine formulation
goldens, the shell's e2e fixture; no principle text, no protocol vocabulary, no exit-code change.

## Category scope (0123 D1's discipline)

Three defect repairs measured by one gate. Families: 0021 P3's start-clean gate (the workdir half), 0095's
formulation collect (the reload before it), 0020's question policy (the fixture that exercises its resume path).
Home-set enumerated at ruling time:

| home | disposition |
|---|---|
| `src/git.ts` (`WORKDIR_ROOTS`/`workdirEntry` new; `beginUnit` the exempt dirty read + the carryover pathspec) | changed — D1's one home |
| `src/gitignore.ts` (`ENTRIES` exported) | changed — the pin's object, bytes of the law unchanged |
| `src/runner.ts` (the two `reloadTask` sites of the formulation path guarded) | changed — D2's crash repair |
| `src/prompt-plan.ts` (`renderFormulationTodo` the own-row teaching) + `test/golden/formulation-todo-*.golden.md` (9) | changed — D2's prevention, the goldens +2 lines each |
| `packages/auto/test/e2e.test.ts` (the block/resume fixture's settlement act) | changed — D3 |
| `test/git.test.ts` (2 beginUnit tests), `test/gitignore.test.ts` (the WORKDIR_ROOTS↔ENTRIES pin), `test/formulate-synthesis.test.ts` (the dropped-row case) | changed — the pins |
| `docs/structure.md`, `AGENTS.md` (the navigation lines) | changed — the lockstep |
| 0021 / 0095 / 0020's own documents | untouched (historical record; this ruling refines the gate's read and the collect's reach, their contracts unchanged) |

## D1 — beginUnit: the driver workdir is not the person's tree, and the carryover never absorbs it

The gate judges the person's tree; the driver workdir (`tmp/`, `.auto/` — gitignore.ts `ENTRIES`, tracked law
since plans/0138) is not part of it. An *untracked* workdir file is the driver's own runtime state (the run lock
acquired before preflight, the stats heartbeat), invisible to git once the set is on disk; preflight ensures the
set **after** the gate (loop-preflight's order is load-bearing: the gate must not see the repair itself as dirt —
in the 0138 shape `.gitignore` is a committed surface, and writing entries modifies a tracked file), so the
first gate of a repository whose set has not arrived yet — a hand-built one, a person who dropped the lines —
read the driver's own state as the person's uncommitted work. `beginUnit` now filters the dirty list: entries
that are untracked (`statusEntries`' `??`) *and* under a workdir root (root-anchored, the ignore entries' own
shape; a nested repository's stray `.auto/` is not the driver's workdir and still blocks) never reach the list.
The opposite facts keep blocking: a **tracked** workdir file (someone put it in git; the driver's rewrites would
dirty every later unit — the 2026-09-17 H5 shape the ignore set itself was built against), and any non-workdir
dirt as before.

The carryover path (driver-state leftovers self-healing through a backfill commit) gained the same law: its
`commitTree` call now passes the doc-lane seam's pathspec vocabulary (plans/0099 D4) with the workdir roots
excluded — `['.', ':(exclude)tmp', ':(exclude).auto']`. This one commit can run before preflight's ignore-set
repair (the run-start gate is ahead of it), and an unqualified `add -A` there would absorb the workdir into git
as *tracked* runtime state — the exact H5 corruption the exemption exists to prevent. Once the set is on disk the
exclusion is a no-op (ignored files never stage). The roots are spelled in `git.ts` (`WORKDIR_ROOTS`, the same
near-leaf spelling as `MODELS_ENTRY` — gitignore.ts imports `repoRoots` from git.ts, so the law cannot be
imported back), and `test/gitignore.test.ts` pins the two spellings one law.

## D2 — the dropped formulation row: the designed blocked voice, and the teaching that prevents it

A formulation session rewrites the phase's whole task index — that is its job — but the protocol never said the
unit's *own* row stays, and a session that drops it (P02's did) crashed the run at the post-session `reloadTask`
before the mechanical collect could name the breach. Two reload sites guard now, both narrowing to
`task.formulate !== undefined` (any other task's row is driver-exclusive state no session may write; its reload
still throws — fail loud):

- the pipeline's post-session reload returns the collect's own shape: `the formulation output is invalid:
  <index> no longer lists the formulation task T-NNN — its own row must stay in the index (the driver ticks and
  closes the unit through it); restore the row, then re-run` — the collect's v1 simplification (plans/0095 D3:
  problems block, a re-run dispatches a fresh session over the surviving files) applied to its own grammar
  breach, the line teaching the remedy (P8);
- the blocked-outcome path's reload (which feeds only the session-rename label and the progress record, both
  keyed on id and title the in-hand object already holds) degrades to the stale object instead of crashing the
  blocked path itself.

The prevention half is the protocol: `renderFormulationTodo`'s index teaching now states — beside the
`- [ ] T-NNN <task title>` example — *this task's own row stays in the index unchanged: the session adds the
planned tasks' lines beside it, never removes or rewrites the formulation task's own line — the driver ticks and
closes this unit through that row* (the nine formulation goldens take the two lines; nothing else in the render
moved). The fake-agent fixture (`artifactTurns`) already modeled the designed behavior — its comment says "the
planned tasks append after it, the index itself is never rewritten" — the live model simply was never told.

## D3 — the fixture performs the settlement it describes

The block/resume e2e's "simulated human intervention" is now an act: between the two runs the fixture appends a
`## Person decision` section to T-002's `todo.md` recording the granted authorization ("Do not ask again — write
the greeting now") — the person's settlement landing on the one per-task surface the resumed session reads (the
blocked reason itself lives in the run log only and is never fed back automatically; under the default policy
the re-ask would block again, by design — the person brackets the boundary, P2). The fixture is non-git, so no
gate reads the edit; in a git-managed project the same edit is a driver-state file the gate's carryover
self-heals. The assertions are untouched — the repair is the fixture's fidelity to the design it claims to
exercise, not a loosened gate.

## D4 — residuals

The gated suite remains a live-model gate: F1's green needs the resumed session to obey the recorded decision,
F2's needs the formulation session to keep its own row — the machinery now guarantees the *shapes* (a settled
decision readable in the input document, a dropped row blocking with its remedy instead of crashing), and the
teaching states the rule, but the model's obedience is what the gate exists to measure; F2's and F3's
full-completion re-runs are pending the provider quota window the day's e2e traffic exhausted. The
custom-phase test's 600 s harness timeout — reached once when P02's formulation session ran slow — is the
suite's own pacing, not addressed here; reopened if it recurs. `changedFiles` itself still lists untracked
workdir files (its other consumers — the end-of-session scan, the loop's watch — read "what exists on disk",
not "what the gate judges"); only `beginUnit`'s read narrows.

## Tests and the closing read

`test/git.test.ts` — two beginUnit pins beside the existing describe: untracked workdir files pass the gate while
a tracked-then-modified workdir file blocks naming it; the carryover in a set-less repository heals the driver
state (`docs/T-001/done.md` committed) with `.auto/` still untracked (`ls-files` clean, the lock file the only
dirt `changedFiles` reports). `test/gitignore.test.ts` — the `WORKDIR_ROOTS`↔`ENTRIES` pin beside the
`MODELS_ENTRY` one. `test/formulate-synthesis.test.ts` — the dropped-own-row case beside the coverage-map one:
exit 2, the collect's own line, no wrap-up dispatched, no crash. The nine formulation goldens regenerated
(`UPDATE_GOLDEN=1`), the diff exactly the two teaching lines each. Full typecheck clean in both packages,
auto-core 2823 and the shell 156 passing. The closing read repeated the gated measurement as far as the provider
allowed: the block/resume test green end to end (402 s — block, the recorded settlement, the resume past it,
exit 0); the adm test's run passing the gate the fix owns — the housekeeping commit landing the repaired ignore
set (`updated: .gitignore now ignores tmp/ and .auto/`), T-001 dispatched, the 69 ms refusal gone — before the
provider's quota window (exhausted by the day's e2e traffic, retry 2026-10-28T00:00Z) stopped the live-model
half; the custom-phase test's live re-run is pending the same window, its repair verified through the
real-runner harness (the crash site itself confirmed by the pre-fix full-log run).

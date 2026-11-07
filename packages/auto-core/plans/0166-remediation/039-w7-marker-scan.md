# Step 039 — w7-marker-scan: the proxy-answer scan scoped to the session's diff + the dead-marker consumption on the verify FAIL path

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W7-verify (its second step), findings **0165-109** (S11-07, S3, CONF, DEF,
P9/P2, 0020 §H/§K; `src/resolve.ts:310-350`) and **0165-111** (S11-10, S3, CONF,
UX, P8/P12, 0142 D1/D2 + 0156 D8; `src/wrapup.ts:222-229`). Started 2026-11-07
at HEAD `445ea0a00` (tree clean; steps 001–038 done; no recovery needed).

## Findings

- **0165-109 (S11-07)** — `collectAgentResolves` reads every marker in each
  changed file, not the session's diff: `changedFiles(dir)` lists the files with
  uncommitted changes, then `readScannable` + a whole-file line scan matches
  every line — including lines committed by earlier sessions. The dedup key is
  `source + task + question`, so a later task touching the file re-books an
  earlier task's AUTO-RESOLVE (a new item, its `file` under the new task) and
  inflates the per-task AUTO-DECISION count. The repro (S11-07): T-001 writes
  docs/design.md with one AUTO-RESOLVE and two AUTO-DECISION lines, committed;
  T-002 appends an unrelated paragraph; T-002's scan returns
  `{resolves: 1, decisions: 2}` — the ⚑ highlight tells the person T-002
  proxy-answered questions it never saw, and the phase/round counts grow with
  every re-edit of a long-lived document. The module's own counting premise
  ("each scan sees only this session's uncommitted changes", 0020 §K) is
  aspirational: committing always happens (afterSession), so the defect fires
  in committed mode whenever a later session edits a file that already carries
  markers.
- **0165-111 (S11-10)** — 0142's dead-marker consumption skips the verify FAIL
  return: `verifySession`'s FAIL path commits the gap list and returns without
  consuming, so a verify session's unservable `tmp/test.sh` survives into the
  fix round — read as wiring by every fix session of the round (the exact harm
  0142 was written to prevent) — and the round's close then blocks naming
  **the fix session** ("the fix session of T-001 (round N) ended with a
  driver-test request pending") for a request the fix session never made. The
  person investigates the wrong session. 0156 D8's declination ("the FAIL
  paths are unchanged — their fix-round close already consumes and blocks")
  forgot the attribution half: consuming at the wrong scope both leaks the
  wiring into the round and blames the wrong session.

## Plan (enactment order; each ingredient lands green)

1. Ruling **0199** written first (Derives/Amends, Category scope, premise
   guard) — D1 the scan's unit restated as the session's added lines (git.ts
   `addedLines` — the diff against HEAD at -U0 per repository root, untracked
   files whole; resolve.ts scans only those lines), D2 the verify FAIL return
   consuming through the 0142 seam (label `task.id`, the fix round's close
   judging only its own sessions' markers).
2. Enactment: `src/git.ts` (`addedLines`, the diff read), `src/resolve.ts`
   (collectAgentResolves over the added lines; the counting-premise comments
   restated), `src/git-ops.ts` (collectSessionMarks' comment), `src/wrapup.ts`
   (the FAIL-return consume + the PASS-site comment's false last sentence
   restated).
3. Regression tests in the existing suites (`test/resolve.test.ts` the
   committed-marker re-booking pin, `test/verify-loop.test.ts` the FAIL-path
   consumption pin), fail-before red on pre-fix source (backups in /tmp,
   cmp-verified restore, green re-run).
4. Full verification (`bun typecheck` + `bun test`; no shell package touched),
   docs (ruling, INDEX row, AGENTS.md navigation line), ledger rows 0165-109
   and 0165-111, program position, single commit.

## Verification

All measured on the committed-state sources; fail-before proofs over `/tmp/039-fixed/`
backups (the pre-fix sources restored from `git show HEAD:…` — resolve.ts, git.ts, git-ops.ts,
wrapup.ts — the proof run, the fixed files restored, `cmp`-verified byte-identical, green
re-run).

- **auto-core**: `bun typecheck` clean; full suite **3099 pass / 0 fail** (155 files) — the
  3096/155 baseline + the 3 new tests (2 resolve, 1 verify-loop), zero regressions.
- **packages/auto** (guard run — no auto source touched, but core behavior changed):
  `bun typecheck` clean; **160 pass / 8 skip / 5 fail** — the exact baseline; the 5 = the
  pre-existing fork/remove-fork family (fork ×2, remove-fork ×3), identical names to step
  038's verified baseline.
- **auto-server**: not run — no auto-server source or surface touched.
- **Fail-before proofs** (each red on the named pre-fix source, every other test of both
  suites green on it — 30/31 and 29/30 respectively, the byte-identical floors measured,
  not asserted):
  - **0165-109 / D1**: on pre-fix `src/resolve.ts` (+ git.ts/git-ops.ts), the re-booking
    test ("a later task's edit of a file with committed markers books nothing (0199 D1)")
    **1 fail** — the scan returned `{resolves: 1, decisions: 2}` for T-002's unrelated
    append (the S11-07 repro reproduced boundedly). The added-marker floor pin (a marker
    line inserted into a tracked file) was green on pre-fix source — the preserved shape,
    pinned.
  - **0165-111 / D2**: on pre-fix `src/wrapup.ts`, the FAIL-consumption test
    ("the verify session's FAIL consumes its marker too (plans/0199 D2)…") **1 fail** — the
    received value was the finding's misattribution verbatim: `blocked`, "the fix session
    of T-001 (round 1) ended with a driver-test request pending (tmp/test.sh) … the phase
    (design) is not a code-work phase" — the completing round blocked in the fix session's
    name over the verify session's marker.
  - The restored sources re-ran **61 pass / 0 fail** over both suites.
- Focused runs during enactment: `test/resolve.test.ts` 31/0; `test/verify-loop.test.ts`
  30/0; `test/constitution-ratchet.test.ts` 5/0 after the doc edits.
- In-change discovery (fixture, not code): the first re-booking fixture draft ended its
  committed file without a trailing newline, so the later append re-added the last marker
  line through the newline change (correct diff semantics — a line whose newline status
  changes is an added line); the fixture now ends the committed file with a newline so the
  append is purely added lines, the shape the finding describes.

## Dispositions

- **0165-109 (S11-07)** — **fixed** under ruling **0199 D1**: the scan's unit is the added
  line, not the changed file — `collectAgentResolves` reads `addedLines(dir)` (git.ts, new:
  per repository root the tracked changes diff against HEAD at -U0, the diff read pinned
  against the person's own diff configuration — prefixes, renames, external drivers,
  colors, quoted paths — plus untracked files whole), so a later task's edit of a file that
  already carries committed markers books nothing; a session that adds or edits a marker
  line books exactly that line. Floors: untracked-file scans byte-identical (the whole
  existing suite), unborn-HEAD repositories whole-file (the exact truth there), a failed
  diff read keeping today's whole-file scan for that repository, dryrun accumulation
  standing as 0020 §K-10's boundary transposed. The dedup-by-file-and-question remedy was
  declined (line numbers drift — a fragile heuristic where a mechanical truth exists); the
  charter-clamp seam the finding's family note named is already closed by 0198 D2
  (content-proven locator), and with D1 the item set itself is the session's own.
- **0165-111 (S11-10)** — **fixed** under ruling **0199 D2**: `verifySession`'s FAIL return
  consumes its own unservable marker through the same `consumeDeadTestMarker` seam as the
  PASS site (label `task.id`, consume + log, no block) — the fix round opens clean and its
  close (0142 D2) judges only its own sessions' markers, the misattributed block ("the fix
  session of T-001 (round N) ended with a driver-test request pending") no longer
  reachable over a verify session's request. 0156 D8's FAIL-path declination amended;
  0142 D1/D2 stand and are honored further.
- **Discovered in-change** (recorded, unacted on): the requireArtifact bypass sessions
  (formulation, knowledge, handover distill — S11-10's family note) still never consume a
  dead marker themselves; their marker reaches the next exec close or wrap-up entry under
  the next task's name — recorded as 0199's residual (no measured incident; P21). Nothing
  else outside the step's scope was touched.

Residuals recorded (0199's own): the dryrun accumulation; the anomaly floor (a failed diff
read over a repository with commits keeps the whole-file scan for that repository — today's
behavior, never a silent empty); the bypass-session seam above.

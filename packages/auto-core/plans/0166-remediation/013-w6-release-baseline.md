# Step 013 — w6-release-baseline

Wave: W6-git. Findings: 0165-004 (S19-01, S1, CONFIRMED), 0165-140 (S19-07, S3, CONFIRMED),
0165-141 (S19-08, S3, CONFIRMED), 0165-142 (S19-09, S3, CONFIRMED). Started 2026-11-06 at HEAD
`8dc8e42c8`.

## Scope

The git audit family: the release baseline walk (S19-01 — the S1: the release gate certifies over
an empty scan once any person commit sits above the driver run), the driver-commit witness
(S19-07 — the substring `Auto-Stage:` criterion), the audit range semantics (S19-08 —
foreignCommits answers 0 on a failed log / a rewound HEAD), and the unruled git-hooks question
(S19-09).

## Design ruling

Ruling **0173** ([0173-release-baseline-hooks.md](../0173-release-baseline-hooks.md)): D1 the
baseline is the parent of the oldest boundary commit (a line starting `Auto-Stage:` — git's
anchored `--grep` — or a landing subject `land auto/…`) reachable first-parent from HEAD; D2 the
witness is the trailer block (the last paragraph, all lines trailer-shaped) via one reader
`driverStage`/`trailerBlock` used by foreignCommits, driverBaseline, wall, and the task readers;
D3 foreignCommits returns undefined on a failed log (callers problem-line it) and the audits add
the `merge-base --is-ancestor` check (a rewound HEAD blocks); D4 the driver's git children honor
the target's hooks under a scrubbed env (every `OPENCODE_AUTO_*` dropped at the git() spawn) and
preflight reports the hooks each repository carries. Premises changed: 0119 D1's walk (the OOM
ruling stands — the grep form keeps it), 0074 §2.3's landing commit (its subject becomes a
recognized boundary), 0059 X1's env door (closed by the scrub). The hook-bypass alternative
(`-c core.hooksPath=/dev/null`) was weighed and rejected: the person's commit policy is theirs on
every commit the repository carries; the measured X1 harm is the env leak, closed by the scrub;
message interference is caught by the close-out audit (the repro's own ending).

## Implementation order (the recovery map)

1. `src/git.ts`: `trailerBlock`/`driverStage`; `foreignCommits` (driverStage + undefined on
   nonzero log); the ancestry checks + undefined handling in `unitViolations`, `baselineIntact`,
   `rollbackUnit`; `driverBoundary` (the grep walk: `git log --first-parent --grep=^Auto-Stage:
   --grep=^land auto/ --format=%H %P %s HEAD`, oldest match, first-parent token, subject
   classified driver|landing; none → HEAD, kind none) with `driverBaseline` = its baseline;
   `taskFirstCommit` on `trailerBlock`; the git() helper env scrub; a `hookReports` helper.
2. `src/wall.ts`: the sealed-channel scan reads `driverStage`.
3. `src/release.ts`: `driverBoundary` (the isolate refusal when kind none and the repo is in
   config isolate — name the round branch; the ✓ line states the boundary kind, baseline and
   changed-file count); `releaseCheck` opts gains `isolate`. Callers pass config isolate.
4. `src/loop-preflight.ts`: the hooks notice (read-only, one line per repository with hooks).
5. Tests per the ruling's Tests section; fail-before proof; full suite.

## Execution log

- 2026-11-06: step opened; the four evidence records and all surfaces read (git.ts's audit
  family, wall.ts, release.ts, land.ts, git-land.ts's landing grammar `land ${branch}: …`,
  taskFirstCommit, the git() spawn). Git mechanics verified empirically (the anchored `--grep`
  matches per line — prose mentions and mid-line quotes never match; `%(trailers:…)` reads the
  last paragraph; two `--grep` OR).
- Ruling 0173 written. Implementation beginning at item 1; time budget inside the last hour —
  the step continues until the closing report, and anything unfinished stays in this record's
  next-action line.
- Implementation landed across the map's items 1–4 (git.ts, wall.ts, land.ts's undefined
  refusal, release.ts + the shell row, loop-preflight.ts); both packages typecheck clean.
- Tests per the ruling's Tests section: git.test.ts's two describes (an empty-baseline guard
  added to all three ancestry checks — the "" sha has nothing to contain, caught by the two
  empty-repository tests), release.test.ts's four boundary regressions, wall.test.ts's
  prose-mention pin, loop-preflight.test.ts's hooks describe (the notice + the spawn scrub).

## Verification

- `bun typecheck` clean in packages/auto-core and packages/auto (the shell's release row).
- Touched suites: 165 pass across git/release/wall/loop-preflight/land; document-roles 69 pass.
- Fail-before: `git stash push -- src` → exactly the new regressions red on the pre-fix code
  (the four release-boundary tests, the two hooks tests, the wall prose-mention; the git.test.ts
  describes red at the new-export imports); `git stash pop` restored all changes.
- Full suite: **2961 pass, 0 fail** (152 files; 2950 at step 012's close).
- Found during enactment: document-roles' 0119 oracle "a person commit on top closes it"
  asserted the replaced walk — re-pointed to the boundary semantics under the ruling's stated
  premise change (0119 D1): the person's commit stays inside the scanned range.

## Close-out

Step done 2026-11-06. Ruling 0173 active-authority; the INDEX row, two AGENTS.md navigation
lines, ledger rows 0165-004/140/141/142 and the program's status/current-position land in the
same commit. Residuals to their named families: the deliberate-imitation door and the
squash-imitation tail → the commit-provenance guard's family (0169 D4); the hooks notice
detection-only — a failing hook surfaces as a commit failure line naming git's error.

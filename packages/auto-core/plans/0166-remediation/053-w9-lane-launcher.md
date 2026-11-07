# Step 053 — w9-lane-launcher: the compiled binary's lane launcher, the decorator rider's sibling sweep, loop-task's comment truths

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W9-lanes, findings **0165-011** (S06-05, S2), **0165-084** (S05-07, S3)
and **0165-185** (S05-10, S4). Started 2026-11-08 at HEAD `0467be5c8`
(steps 001–052 done); ruled by
[../0213-lane-launcher-rider-truth.md](../0213-lane-launcher-rider-truth.md).

## Findings (from plans/0165-review/S06-control.md and S05-loop-task.md)

- **0165-011 (S06-05, S2, DEF, P12)** — `defaultLaneLauncher` cannot
  re-invoke a compiled binary: it spawns `[execPath, process.argv[1],
  "_lane", …]`, and in a `bun build --compile` executable argv[1] is the
  embedded entry `/$bunfs/root/<name>`, which the child reads as its
  command — the shipped `dist/opencode-auto` refuses it ("is not a
  command", exit 1), so every worktree-lane run of the compiled CLI stops
  at its first dispatch. The source layout (`bun src/index.ts`, every
  test) never sees it. auto-server's own launcher override already solved
  its twin (worker-command.ts).
- **0165-084 (S05-07, S3, BOUND, P18)** — the doc-lane decorator's
  driver-state rider sweeps a sibling's in-transit completion into this
  unit's commit: the rider's filter excludes only the unit's OWN scope, so
  a sibling's `markDone` rename (`docs/T-B/todo.md` → `done.md`, inside
  the sibling's own live scope) matches `driverStateFile` and whichever
  other unit commits in the window lands it under its own `Auto-Task` and
  `Auto-Stage` trailers — 0099 D8 names only the index tick as the shared
  write.
- **0165-185 (S05-10, S4, DOC, P8)** — hygiene across loop-task.ts:
  comments stating behavior the code does not have (the step pause "stops
  scheduling and drains" family), a stream unit's repair-merge title read
  from the never-existing `docs/T-NN.S<nn>/` path, the doc loop's
  wait-between keyed on a per-invocation landing count where the sibling
  loops key on `ctx.ran`, and a repair round that consumes budget even
  when `closeUnit` refuses. NOTE: step 051 (ruling 0211 D2) already
  killed the park arm's false "hooks run at the next unit" comment and
  built `closeOutAudit`/`taskBoundary` — this step dispositions only the
  live remainder, verified at HEAD `0467be5c8`.

## Plan (enactment order; each ingredient lands green)

1. Read docs/principles.md; answer the boundary per finding first. Write
   ruling **0213** first (Status: active; Derives with showing clauses;
   Category scope; D1..D4; premise guard; named residuals).
2. Enact per decision; regression pins that fail on pre-fix source.
3. Full verification (`bun typecheck`, `bun test`; baseline 3161/0/155);
   shells re-measured only if a consumed surface changed (D1 touches
   src/shell.ts — auto consumes the default launcher, auto-server
   overrides it: typecheck both, suite whichever the change can reach).
4. Docs lockstep (INDEX row + annotations, AGENTS.md navigation,
   structure.md), ledger rows for 011/084/185, program position; single
   commit.

## Work log

- 2026-11-08: step record created; status table marked `doing` (starting
  HEAD `0467be5c8`). Read the S06-05/S05-07/S05-10 evidence, the source
  homes (shell.ts's defaultLaneLauncher, git-ops.ts's commitDocTree rider,
  loop-task.ts's three "stops scheduling" comment sites, runLaneUnit's
  merge-title read, the doc loop's landings local, repairRoundAppend's
  bump order), the solved twin (auto-server/src/worker-command.ts, its
  profile override), packages/auto (no setShellProfile call — the compiled
  CLI runs on the core defaults, the launcher included) and
  docs/principles.md (P12/P18/P4/P8 for the defects; P14/P16/P10 for the
  launcher's shape). 0165-185's remainder at HEAD verified: the park
  comment is dead (0211 D2); live are the three comment sites, the merge
  title, the wait-between keying and the repairs-before-closeUnit order.
  Ruling 0213 written first.
- 2026-11-08: enactment — shell.ts (D1 `selfInvoke` + the launcher through
  it, both comment blocks restated over the two shapes), git-ops.ts (D2
  the rider's live-scope exclusion, the rider comment and the decorator's
  header delta restated), loop-task.ts (D3a the three boundary comments +
  the two `scheduling`-flag enumerations corrected; D3b the merge title's
  owning-task read; D3c the pause keyed on `ctx.ran > 1`, the `landings`
  local retired; D3d the round number derived, `ctx.repairs` assigned
  only once closeUnit closed).
- 2026-11-08: test homes — shell.test.ts (+2: the `selfInvoke` shape pins
  over all three arms; the launcher-assembly pin over a stubbed
  `Bun.spawn` with a planted compiled-shape `process.argv`, asserting the
  spawned vector both shapes and the env merge), doc-lanes.test.ts (+2:
  the fake-base pathspec pin; the real-git interleaving pin — the
  finding's own scene, the sibling's rename landing in the sibling's
  commit), lanes-scheduler.test.ts (+1: the stream merge-subject pin over
  a real worktree, driving `runLaneUnit` with `lane: { unit: "T-001.S01",
  merge: main }` and the already-complete short-circuit), agent-fake.test.ts
  (+2: the cross-phase pause pin with `ctx.ran = 2` on entry; the
  first-landing floor), repair-loop.test.ts (+1: the refused-close budget
  pin driving `repairRoundAppend` directly over a dirty-tree refusal,
  then the opened round). One in-change repair: the real-git pin's first
  draft asserted both `--no-renames` entries inside the sibling's done
  commit — `git show --name-only` folds a content-identical rename to the
  new name alone, so the assertion narrowed to the done.md entry (the
  attribution claim unchanged).
- 2026-11-08: fail-before proof over /tmp/053-fixed (the three changed src
  files backed up, `git show HEAD:` pre-fix versions swapped in, the pins
  run, the fixed files restored and cmp-verified byte-identical) plus a
  runtime probe for D1's defect; full verification; shells re-measured;
  docs lockstep (INDEX row + the 0099 annotation, four AGENTS.md
  navigation lines, three structure.md rows); the program status/ledger/
  position updated; committed.

## Verification

`bun typecheck` exit 0; auto-core full suite **3169 pass / 0 fail** (155
files = the 3161/155 baseline + 8 net new, zero regressions). Fail-before
proof over /tmp/053-fixed: **6 pins + the launcher probe red on pre-fix
source** —

- D1 (probe + 2 pins): the runtime probe (a /tmp script stubbing
  `Bun.spawn` and planting the compiled-shape `process.argv`) printed the
  pre-fix vector `["bun", "/$bunfs/root/opencode-auto", "_lane", …]` —
  the finding's repro verbatim ("DEFECT: the compiled child receives the
  virtual entry as its command"), and `[bun, "_lane", …]` on the fixed
  source (re-run after the restore); the shell pins red at the file level
  pre-fix (the absent `selfInvoke` export — step 024's precedent for an
  absent helper).
- D2 (2 pins): the pathspec pin received the rider's list carrying
  `docs/T-002/todo.md`/`docs/T-002/done.md` beside the own scope; the
  real-git pin failed `not.toContain` — T-001's exec commit held the
  sibling's `docs/T-002/done.md`, and the sibling's own done commit then
  carried none of it.
- D3b (1 pin): the merge subject received `"T-001.S01 merge repair
  T-001.S01"` — the degraded bare-id subject verbatim.
- D3c (1 pin): no "pause between tasks" question fired for the later
  phase's first landing (the per-invocation counter's "first"); the
  first-landing floor green on pre-fix source.
- D3d (1 pin): `ctx.repairs` read 1 after the refused close (the budget
  spent by a round that never opened), and the second call blocked on
  the spent budget.

The floors green on pre-fix source (the source-layout spawn vector, the
first-landing pause, and every other pre-existing test of the touched
files). Shells: **auto** typecheck clean, suite **159 pass / 8 skip /
6 fail** — the recorded baseline exactly (the five pre-existing
fork/remove-fork failures + the "roadmap-driven establishment" drift,
the latter re-measured this session identically on pre-fix core source,
both ways); **auto-server** typecheck clean, suite **142 pass / 2 fail**
— the recorded baseline exactly ("planPrelude boundary matrix" and
"malformed requests", the step-050 drift names verbatim; no auto-server
source touched, and its launcher override means the change cannot reach
it).

## Dispositions

- **0165-011 (S06-05, S2)** — fixed (ruling 0213 D1): the self-invocation
  derived from the process shape (`selfInvoke`), the compiled binary
  re-invoking itself; the source layout and every launcher override
  byte-identical; named residuals: the non-Bun packaging shape (P16), the
  compiled-binary e2e out of the suite (the vector pins the coverage).
- **0165-084 (S05-07, S3)** — fixed (ruling 0213 D2): the rider admits
  driver state outside every live scope; the sibling's completion lands
  in its own commit; the tick's riding and the dead sibling's leftover
  the ruled postures (0099 D8 / 0021 standing, the 0099 INDEX row
  annotated for the stage-B rider letter).
- **0165-185 (S05-10, S4)** — fixed (ruling 0213 D3) over the live
  remainder: the comment family corrected (three boundary sites + the two
  `scheduling` enumerations), the merge title from the owning task's
  document, the wait-between keyed on `ctx.ran`, the budget consumed only
  by an opened round; the park comment's half already fixed by 0211 D2 —
  the ledger row states the split. Named residuals: the doc-loop pause's
  concurrency artifact, the absent-document merge-title fallback, the
  closeUnit-failure-after-writes round.
- Premise guard: 0099 stage B's rider letter re-read and its INDEX row
  annotated in the same change; re-read standing: 0068 §6.4 D2, 0099 D8,
  0021's carryover posture, 0156 D3, 0079 §4, 0143/0068 D11; 0211 D2
  verified as landed before the step began.
- Commit: the step's single coherent commit (subject "0166: step 053
  done — ruling 0213 …", finding ids in the body's trailing
  parenthetical); the SHA recorded in the program table's row by the
  next step's start HEAD convention.

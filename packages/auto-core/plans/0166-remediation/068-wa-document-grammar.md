# Step 068 — wa-document-grammar

Wave WA-docs · findings 0165-041 (S2), 0165-077 (S3), 0165-152 (S3),
0165-153 (S3) · status: **done** 2026-11-09 · start HEAD `c9805a874`.

## Scope (the findings' families)

Document-grammar robustness — two grammars whose silent near-misses drop
declared content (the unit field block, read by the phase-type loader too),
one classifier whose name test escapes its namespace (the handoff role), and
one field with two homes (subtask `Depends:`). Unlike steps 065–067 this
WA-docs wave step reaches core src: every finding's remedy names a code home;
the ruling decides each on principles first (0123's requirement-family
discipline), and the enactments are behavior changes with regression
coverage, not doc edits.

- **0165-041 (S21-01, S2, BOUND, P1)** — `roleOf` tests the handoff file-name
  family (`handoff.md`, `testhandoff(-n).md`) before the `docs/` gate, so a
  nested destination repository file of that name classifies as the process
  `handoff` role: outside the P1 scan (the release gate passes process
  references in it) and exempt from the whole-unit eof scan. Every handoff
  family path the driver constructs lives under `docs/T-NNN/` (docpaths.ts:
  the task-level `docs/T-NNN/handoff.md`, the per-stream `docs/T-NNN/S<nn>/
  handoff.md`, `testhandoff(-n).md`); the name test's escape beyond the task
  family is the defect (the test table's own comment says "wherever under
  docs/ it sits").
- **0165-077 (S04-08, S3, FAIL, P12)** — a phase type file's field block ends
  at the first non-field line: a blank line between fields, a comment after
  the title, `Wall :`, `Wall：` or `**Wall:**` silently drop `Wall:` (the
  cleanroom boundary off, the P10 floor) or `Gate:` (the phase completes
  without its gate). Strictness covers only a misspelt key inside the
  contiguous block; the file is hand-edited by design (0132 D1's person-owned
  fill).
- **0165-152 (S21-04, S3, FAIL, P12)** — the same block reader over task and
  subtask documents: near-misses drop declared `Depends`/`Touches`/`Decompose`/
  `Artifacts` with no problem line (Depends falls to the previous sibling,
  Touches to "everything", a dropped task `Artifacts:` parks the dependency
  gate on prose alone — spec.ts:121-126), a repeated key last-wins, and the
  field block is the one strict grammar without the fullwidth `：` tolerance
  every other driver protocol line has. `newTaskProblems` checks only
  `Phase:` (its parsed marker guards 0171 D6 / 0205 D2 cover just the
  in-block shape of `Formulate:`/`Closed:`/`Prefix:`/`Floor-Digest:`).
- **0165-153 (S21-05, S3, DUP, P5)** — subtask `Depends:` has two homes: the
  split reads it from the checklist line (`split.ts` splitItem over
  CHECKLIST_FIELD), the decompose pipeline only from `S<nn>/todo.md`
  (readChecklist → parseUnitDoc). A decompose session following the
  parallelRules block's wording ("Apply the level's discipline below to the
  checklist items — `Depends:` names only real prerequisites…") writes it on
  the line: silently dropped, the item serial, the parallel level inert; no
  collect problem names it.

## Plan (before editing)

1. Ruling **0228** written first (next free number verified by `ls plans/`
   — 0227 the last). Answer the boundary from docs/principles.md first
   (P1/P12/P7/P8/P5/P13/P10), then enumerate the families' homes
   (plans/INDEX.md by P-id, docs/structure.md by module). 0165 is evidence,
   not authorization; Category scope enumerated; premises named.
2. Enact D1 (0165-041): `src/document/roles.ts` — the handoff name test moves
   below the `docs/` gate and binds to the task family (`docs/T-\d+/` paths
   only); comment updated; `test/document-roles.test.ts` rows
   (`dest/kernel/handoff.md` → freeform, `docs/guide/handoff.md` → freeform,
   `docs/R-01/handoff.md` → artifact) + a processReferenceScan case for a
   nested handoff.md.
3. Enact D2 (0165-077 + 0165-152): `src/document/unit.ts` — the field-line
   shape accepts `[:：]` (one shared constant; `taskBody`'s skip regex in
   lockstep) and the near-miss scan `fieldBlockProblems(text, fields)` over
   the pre-body region (known-field line in any colon/emphasis shape outside
   the contiguous block; repeated key inside it). Consumers:
   `src/phases/custom.ts` (throws, beside the unknown-field throw),
   `src/tasks.ts` newTaskProblems (the task vocabulary, extending the marker
   guards), `src/execute.ts` decomposeArtifactProblems (the subtask pair).
4. Enact D3 (0165-153): the collect-problem arm — a line-level `Depends:` on
   a decompose-written checklist item is a decompose-collect problem naming
   the `S<nn>/todo.md` home (`CHECKLIST_FIELD`, the split's own grammar, so
   the check flags exactly what the split would read); the parallelRules
   block reworded in all seven decompose templates to say where each field
   goes (Depends → the todo.md field block; only `Artifacts:` on the line).
   The write-normalization arm declined in the ruling.
5. Regression coverage: the near-miss shapes from the findings' repros as
   red-before pins (document-unit, phases-custom, tasks, decompose collect
   via the fake-agent pipeline where cheap, roles/scan rows); prompt tests
   after the template edits (`bun test test/prompt-exec.test.ts
   test/prompt-phase.test.ts test/prompt-template.test.ts`). Fail-before over
   /tmp/068-fixed (pre-fix sources swapped in, pins red, restore,
   cmp-verified).
6. INDEX row 0228 (6-cell); docs/structure.md's Role-model and Unit-model
   rows updated (the scope and the scan are module facts); AGENTS.md
   navigation only if a mapping changes; program bookkeeping; one commit.

## Execution log

- 2026-11-09 (delegated worker): step opened at HEAD `c9805a874` (verified
  `git log -1 --format=%h`). Evidence read: the four register rows in
  plans/0165-three-package-review.md + the S21-01/S21-04/S21-05 (S21-tasks.md)
  and S04-08 (S04-loop-root.md) records; the owning code at HEAD —
  `src/document/roles.ts` (roleOf, HANDOFF_NAME before the docs/ gate),
  `src/document/process-refs.ts` (p1Scope's nested gate), `src/document/
  unit.ts` (parseUnitDoc's block walk), `src/tasks.ts` (taskBody's own skip
  regex, newTaskProblems, readChecklist), `src/phases/custom.ts`
  (parsePhaseTypeFile), `src/split.ts` (splitItem, renderSplitTodo),
  `src/execute.ts` (decomposeArtifactProblems — the fresh-session collect
  only), `src/document/spec.ts` (taskArtifactSpecs — the task `Artifacts:`
  field), `templates/prompts/decompose*.md` (the parallelRules block in all
  seven) + `_partials.md` (subtask-depends), the S08-08 record (its
  near-miss-home note — the parsed-shape guards already landed 0171
  D6/0205 D2).
- 2026-11-09: ruling **0228** written first (next free number verified —
  0227 the last; Derives P1/P12/P7/P8/P5/P13/P10/P19 with showings, Amends
  none, Tier code, premises this ruling changes: none with eight re-reads,
  Category scope a 19-row table; 0165 evidence, not authorization). Enacted
  in order: D1 roles.ts (TASK_DOCS + the name test below the docs/ gate,
  comments restated), D2 unit.ts (UNIT_FIELD_LINE + walkFieldBlock +
  fieldBlockProblems) with the lockstep consumers (custom.ts throw, tasks.ts
  taskBody skip + newTaskProblems scan, execute.ts decompose collect scan),
  D3 the decompose collect's line-level problem + the seven templates'
  parallelRules rewording. Tests in the six homes (+19): document-unit
  (colon tolerance + 6 scan cases — one shape-debug mid-write: the fullwidth
  form in block position parses since the tolerance, the near-miss arm pinned
  outside the block instead, exactly the ruling's split), phases-custom (the
  five throw cases + the tolerance's entry), tasks (the planning collect's
  three problems + the tolerance floor), decompose-field (the end-to-end
  collect: turn 1 writes the finding's shapes, the retry feedback carries
  both problem lines verbatim, turn 2 fixes, the pipeline completes — one
  harness detail learned: the pipeline runs a digest-base session between
  decompose and the subtasks, so the prompt sequence is 5 not 4), roles (six
  rows + the nested-handoff scan case), prompt-exec (the reworded block's
  homes + the retired wording's absence). The full run caught the golden
  (decompose-m-parallel-high) — moved in lockstep (3+/2−, the ruled block
  alone, UPDATE_GOLDEN=1, the diff inspected). Fail-before proven over
  /tmp/068-fixed before the bookkeeping; verification green against the
  baseline; dispositions and program updates landed in the same commit.

## Verification (the step's close)

- auto-core: `bun typecheck` exit 0; full suite **3240 pass / 0 fail**
  (159 files = the 3221/159 baseline + 19 net-new tests: document-unit 7,
  phases-custom 2, tasks 1, decompose-field 1, document-roles 7, prompt-exec
  1). The three prompt suites green after the template edits (157/0 with
  the golden moved).
- Fail-before proof over /tmp/068-fixed (the five changed src files + the
  seven templates swapped to HEAD's bytes via `git show`, pins evaluated,
  files restored and cmp-verified byte-identical): **document-unit red at
  the file level** (the `fieldBlockProblems` export missing — 0 pass / 1
  fail / 1 unhandled error; its behavioral halves carried by the probes
  below), **phases-custom 2/2** (the near-miss throws, the `Wall：`
  tolerance entry), **tasks 1/1**, **decompose-field 1/1**, **document-roles
  6/6** (five classification rows + the scan case), **prompt-exec 1/1** —
  12 red on the findings' own shapes; `docs/T-001/S02/testhandoff.md →
  handoff` green at HEAD too (the T-family reach never changed). After
  restore: all suites green.
- The 0165 probe: **P4 empty** (ruling 0228 carries Derives + Category
  scope), P1/P2/P3 identical to the standing pre-existing set (the 0193
  row, the 0224 bare server path, the pattern-grammar placeholders), none
  added — the 0228 INDEX row's homes fully qualified.
- No shell suite due (no packages/auto or auto-server file touched).


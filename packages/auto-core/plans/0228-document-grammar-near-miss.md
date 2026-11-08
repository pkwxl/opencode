# 0228 — document-grammar robustness: the handoff name scoped to its family, the field block's one near-miss reader, and subtask `Depends:`'s one home

Status: active-authority (0166 remediation step 068, wave WA-docs; findings 0165-041 =
S21-01 (S2, CONFIRMED, BOUND — roleOf classifies any file named handoff.md /
testhandoff(-n).md as the handoff process role before the docs/ gate, so a nested
destination file of that name is outside the P1 scan: the release gate passes a process
reference in it), 0165-077 = S04-08 (S3, CONFIRMED, FAIL — a phase type file's field block
ends at the first non-field line, so a blank line between fields, a comment after the
title, `Wall :`, `Wall：` or `**Wall:**` silently drop `Wall:` or `Gate:`), 0165-152 =
S21-04 (S3, CONFIRMED, FAIL — the same reader over task/subtask documents: near-misses
drop declared fields silently, a repeated key last-wins, the field block alone lacks the
fullwidth `：` tolerance), 0165-153 = S21-05 (S3, CONFIRMED, DUP — subtask `Depends:` has
two homes: the split reads the checklist line, the decompose pipeline only S<nn>/todo.md,
and the parallelRules prompt wording teaches the line).

One family — **the driver-defined document grammars' robustness at their edges** (P7's own
fence): a name-based role match escaping its namespace, the strictest grammar with the
weakest near-miss discipline (the analysis/roadmap grammars got near-miss scans with 0084
and 0158; the field block — the one the scheduler and the park gate consume — got none),
and one field readable at two homes with a prompt that teaches the home one pipeline never
reads. Unlike steps 065–067 this WA-docs step rules **code behavior**: every finding's
defect lives in a parse or a classifier, and the remedy is the grammar made whole, not a
doc edit. 0165 is the evidence, not the authorization.

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P1** (the deliverable stands alone): the prohibition scan's targeting is part of P1's
  enforcement — a classifier that exempts a deliverable file from the scan by accidental
  name collision makes the person's release moment silently wrong for that file. The
  scan's referenced side is the process roles by *role*, not by bare file name anywhere
  in the tree; the handoff family's home is the task family's own directories (every
  path the driver constructs is `docs/T-NNN/…`, docpaths.ts — the task-level
  `docs/T-NNN/handoff.md`, the per-stream `docs/T-NNN/S<nn>/handoff.md` of 0068 S5, and
  `testhandoff(-n).md`), so scoping the name test to that prefix loses no constructed
  path and closes the collision (S21-01's own repro: `dest/kernel/handoff.md` role=handoff
  p1Scope=false problems=0).
- **P12** (fail loud; conservative under uncertainty): a near-miss line is an uncertain
  reading of a declaration the document visibly meant — resolving it to "no declaration"
  is the silent clean verdict P12 forbids. Both directions measured by the findings: a
  dropped `Depends`/`Wall`/`Gate`/`Artifacts` is conservative *and* silent (the worst
  combination — the conservative outcome arrives with no line anyone can act on); the
  remedy is the problem line at the moment the document is judged, never a silent drop.
  The same principle grounds the fullwidth `：` tolerance: every other driver protocol
  line already reads it (handoffStatus, parkDirective, CHECKLIST_FIELD, the resolve
  marker); the field block's refusal is drift, not strictness — a `Key：` line is not an
  uncertain reading to resolve dirty, it is the same declaration in the corpus's other
  colon form.
- **P7** (grammars, never content): the near-miss scan checks shape only — does a line
  *name* a known field of the caller's vocabulary in a colon-bearing form, and is that
  line inside the contiguous block; it never judges the value or the content. The
  vocabulary is the grammar's own (the phase-type field names, the task fields, the
  subtask pair) — the caller supplies it, the reader stays generic.
- **P8** (deliberate enforcement moments): the scan's homes are the moments the document
  is judged as just-written session output — the planning collect (newTaskProblems, the
  retry feedback loop), the decompose collect (decomposeArtifactProblems, the same loop),
  and the phase-type load (already strict: unknown fields throw). **A load-time scan is
  declined**: loadPlan/readChecklist/scanUnitStates keep the byte-identical floor (P10) —
  a near-miss in a long-landed document blocking a run start is a new enforcement moment
  no ruling here makes, and the collects are where the writer can still fix its own
  document in-session.
- **P5** (single ownership) and **P13** (frozen additive-only vocabularies), for 0165-153:
  one field, one home per pipeline. The split's checklist line is the split's own
  declaration surface (its lead writes the line, the driver derives the todo.md block —
  renderSplitTodo; 0059 D5); the decompose pipeline's home is the S<nn>/todo.md field
  block (readChecklist → parseUnitDoc, 0047 G6). The fix makes the decompose collect
  *name* the wrong home when a session writes the line — detection teaching the one home
  (P8), no new vocabulary (CHECKLIST_FIELD unchanged, `Artifacts:` stays a line-level
  token of the checklist grammar, P13).
- **P19** (measured evidence): the ruled shapes are exactly the findings' confirmed repro
  shapes (blank-between, comment-first, space-colon, fullwidth, bold, dup-key,
  closed-in-todo, the line-level Depends) — no speculative form (a list-prefixed field
  line, prose before the first heading, unknown keys outside the block) enters the scan;
  those keep today's behavior and are recorded as residuals.

## Decisions

### D1 (0165-041) — the handoff role's name classification binds to the task family

`roleOf` tests the handoff file-name family **only under `docs/T-\d+/` paths**: the name
test moves below the `docs/` gate and below a task-family prefix test, ahead of
PROCESS_DOCS. Consequences, each deliberate:

- A nested destination repository's `handoff.md` / `testhandoff(-n).md`, a workspace-root
  one, and `docs/<non-task>/handoff.md` (e.g. `docs/guide/handoff.md`) classify
  **freeform**: deliverable-side, P1-scanned at the nested gate, terminator-checked by
  the whole-unit eof scan (both exemptions the collision granted are withdrawn — the
  finding's impact names both).
- `docs/R-NN/handoff.md` classifies **artifact** (a round-dir process document; no
  machinery constructs it, both roles process so P1 is unaffected; it gains the eof
  terminator scan artifacts carry).
- Every constructed handoff-family path is unchanged (`docs/T-NNN/handoff.md`,
  `docs/T-NNN/S<nn>/handoff.md`, `docs/T-NNN/testhandoff(-n).md`, the subtask-level
  `docs/T-NNN/S<nn>/testhandoff.md` of close.ts's chain cleanup) — the name test's
  *placement* was the defect, never its reach inside the task family. 0045's role model
  and 0068 S5's per-stream family re-read standing: both cite the family by its task
  home; the test table's "wherever under docs/ it sits" comment overstated the mechanism
  and moves with it.
- The comment block on HANDOFF_NAME states the scope (by name, under the task family's
  directories alone — the family's every constructed path); the roles header's P1 note
  already derives the scan's targeting from the role, unchanged.

### D2 (0165-077 + 0165-152) — the field block's one near-miss reader, and the colon tolerance

The field-block grammar is made whole in its one home, `src/document/unit.ts`:

1. **The line shape accepts the fullwidth colon** — one shared exported constant
   (`Key[:：] value`), used by parseUnitDoc's block walk *and* by taskBody's block skip in
   `src/tasks.ts` (its own regex today; one grammar, two readers, the same shape — a
   `Key：` line is a field to both or neither, never field-to-one and body-to-the-other).
   Additive tolerance (P13): documents that parsed keep parsing; a `Key：` line that was
   silently dropped now reads as the declaration it visibly is.
2. **`fieldBlockProblems(text, fields)`** — the shared near-miss scan over the pre-body
   region (document start through the line before the first `## ` heading; body text
   under a section is content, never a field — the block reader's own boundary, restated
   in S21-04's remedy). Two problem kinds, each naming the line and teaching the remedy
   "keep the field lines contiguous right after the title line":
   - a line naming one of the caller's known fields in any colon-bearing shape — exact
     `Key:`, spaces before the colon (`Key :`), fullwidth (`Key：`), emphasis-wrapped
     (`**Key:**`) — that sits **outside** the contiguous block (the block ended early at
     a blank line, a comment, or the near-miss form itself);
   - a **repeated** known-field key inside the block (last-wins today — the earlier line
     is silently replaced; the problem names both lines).
3. **Consumers** (P8's moments, the vocabulary per grammar):
   - `parsePhaseTypeFile` (phases/custom.ts): any problem **throws**, naming the file —
     beside the unknown-field throw, the same strict load; the vocabulary is the seven
     field names. A hand edit that breaks the wall or the gate now fails the load with
     the line, not silently.
   - `newTaskProblems` (tasks.ts): problems are **collect problems** (retry feedback),
     vocabulary `Phase`, `Depends`, `Touches`, `Decompose`, `Artifacts`, `Formulate`,
     `Closed`, `Prefix`, `Floor-Digest` — the parsed-shape marker guards of 0171 D6 /
     0205 D2 (S08-08's home) extend to the outside-block and near-miss shapes; the decl
     still rides (existing behavior: only a spec failure withholds it).
   - `decomposeArtifactProblems` (execute.ts): the same collect treatment over each
     S<nn>/todo.md, vocabulary `Depends`, `Touches`.
4. **Held** (the floor): load-time readers (loadPlan's taskDecl, readChecklist,
   scanUnitStates' `Closed:` map, inversionWarnings) gain no scan — P10/P8 as stated
   above; unknown keys outside the block stay ignored (an unknown key inside the block
   still throws at the phase-type load; a task document's unknown fields were never
   judged); prose and comments in the region that name no known field are untouched.

### D3 (0165-153) — subtask `Depends:` one home per pipeline, taught at both ends

The **collect-problem arm** of the remedy is ruled; the write-normalization arm
(the collect reads the line and writes the todo.md block, split.ts's pattern) is
**declined**: the driver would author content inside a session-written document at
collect time — the split's write path is its own dedicated injection step (the lead
declares on the line, the driver *renders* the todo.md from it), not a collect behavior,
and a double declaration (line + block) would need conflict rules the evidence gives no
basis for (P19). Ruled instead:

- A **line-level `Depends:`** on a decompose-written checklist item is a
  decompose-collect problem naming the one home — read with CHECKLIST_FIELD (the split's
  own grammar), so the collect flags exactly what the split would have read, no new
  token (P13); the problem line teaches the move (`S<nn>/todo.md`'s field block, its
  first lines before `## Scope`). Applies to the fresh-session output only, like every
  other check in that collect (the existing-file injection path is never re-audited).
- **The prompt moves with the rule** (P15's producer half; the block is the measured
  cause — the session followed it): the parallelRules block in all seven decompose
  templates (`decompose.md`, decompose-a/d/k/m/t/v.md) says where each field goes —
  `Depends:` in each `S<nn>/todo.md`'s field block, only `Artifacts:` on the checklist
  item line. `_partials.md`'s subtask-depends already teaches the todo.md home and is
  unchanged; the split family (fanout/whole) teaches its own line grammar and is
  unchanged.
- The split path is **unchanged** — its line-level read stays the split's declaration
  surface (0059 D5 re-read standing), and renderSplitTodo keeps writing the block from
  it. One home per pipeline; both pipelines' homes taught by their own prompts.

## Derivation and Category scope

Derives: **P1** (the showing: processReferenceScan's p1Scope targeting in
process-refs.ts — the nested-gate deliverable definition of 0108 consumes roleOf's
process flag; the name collision exempted deliverable files from the person's release
moment), **P12** (the showing: fieldBlockProblems' problem lines and the decompose
collect's one-home problem replace silent drops; the `[:：]` tolerance retires the field
block's status as the one colon-intolerant protocol reader), **P7** (the showing: the
scan checks field-name shapes against a caller-supplied vocabulary, never content), **P8**
(the showing: the three consumer moments — planning collect, decompose collect,
phase-type load — and the declined load-time scan), **P5** (the showing: one field-block
boundary grammar in document/unit.ts shared by parseUnitDoc, taskBody and the scan; one
`Depends:` home per pipeline), **P13** (the showing: the tolerance is additive; no
protocol token added, retired or re-meaning; the checklist line's `Artifacts:` token
unchanged), **P10** (the showing: the load-time floor held — every existing document
that parses today parses identically after; the new problem lines fire only at the
collects/load over shapes that were silently dropped), **P19** (the showing: the ruled
shapes are the confirmed repro shapes; speculative forms held as residuals).

Amends: none (0045's role model, 0047 G1–G6's field-block grammar, 0059 D5's split line
fields and 0132 D1's person-owned phase-type fill are re-read and restated, not amended —
each named the family or grammar by its home; the defects were the mechanisms drifting
past their stated scope).

Tier: code (src behavior — the classifier, the parser tolerance, three consumers' problem
sets, the collect's new check; plus prompt template copy and its test pins).

premises this ruling changes: none. Re-read in the same change: 0045 (the role model —
its handoff family is cited by its task home; the name test's escape was drift), 0068 S5
(the per-stream handoff family "classification is by name" — true and unchanged under
`docs/T-NNN/S<nn>/`), 0047 G6 and 0059 D5 (the two pipelines' `Depends:` homes — each
kept in its own pipeline, the decompose home now enforced and taught), 0132 D1 (the
phase-type `Wall:` fill — person-owned content, and exactly why a near-miss there must
fail the load rather than silently unseal), 0083 D9/0096 D6 (the `Artifacts:` fields —
task-level in the todo.md block, checklist-level on the line; the split of homes D3
restates), 0171 D6 / 0205 D2 (the marker guards — extended, not moved), 0084 / 0158 (the
analysis/roadmap near-miss scans — the precedent class this change extends to the field
block, their region rule "before the grammar's body" adopted).

### Category scope (0123 D1's discipline)

Family: *the driver-defined document grammars' robustness — the role classifier's name
tests, the unit field-block grammar and its readers, the phase-type file's field block,
the subtask dependency declaration's homes, and the prompt copy that teaches them*.

| home | disposition |
| --- | --- |
| `src/document/roles.ts` | changed — D1 (HANDOFF_NAME below the docs/ gate, bound to `docs/T-\d+/`; the comment's scope) |
| `src/document/unit.ts` | changed — D2 (the shared `Key[:：]` line-shape constant; parseUnitDoc's walk over it; `fieldBlockProblems`) |
| `src/tasks.ts` | changed — D2 (taskBody's skip regex imports the shared shape; newTaskProblems pushes the scan's problems over the task vocabulary) |
| `src/phases/custom.ts` | changed — D2 (parsePhaseTypeFile throws on the scan's problems, vocabulary FIELDS) |
| `src/execute.ts` | changed — D2 (decomposeArtifactProblems scans each S<nn>/todo.md, vocabulary Depends/Touches) + D3 (the line-level `Depends:` collect problem) |
| `templates/prompts/decompose.md`, `decompose-{a,d,k,m,t,v}.md` | changed — D3 (the parallelRules block's field homes) |
| `test/document-roles.test.ts` | changed — D1 (the freeform/artifact rows, the nested-handoff scan case) |
| `test/document-unit.test.ts` | changed — D2 (the colon tolerance, the near-miss shapes, the dup key) |
| `test/phases-custom.test.ts` | changed — D2 (the near-miss throws) |
| `test/tasks.test.ts` | changed — D2 (newTaskProblems' near-miss problems) |
| `test/decompose-field.test.ts` | changed — D2/D3 (the collect's subtask near-miss + line-level Depends problems, end-to-end through the fake pipeline) |
| `docs/structure.md` | changed — the Role-model and Unit-model rows gain the scoped name test and the near-miss scan (module facts) |
| `plans/INDEX.md` | changed — the 0228 row |
| `src/split.ts`, `src/document/process-refs.ts`, `src/document/spec.ts`, `templates/prompts/_partials.md` | held — the split's own line grammar, the scan's nested gate, the Artifacts field parsers and the partial's todo.md teaching are each already the ruled shape |
| `AGENTS.md` (auto-core) | held — no module→responsibility mapping changes (the mechanisms stay in their modules; the field-block grammar line's "Format changes sync test/tasks.test.ts" convention is followed, no new navigation line needed) |
| `docs/principles.md`, `docs/releases.md` | held — no principle text or release-section content moves (the amendment register is for constitution edits; this ruling derives, amends nothing) |
| load-time readers (`loadPlan`, `readChecklist`, `scanUnitStates`, `inversionWarnings`) | held — D2 item 4: the byte-identical floor |

## Residuals

- The scan's shapes are the confirmed repro set: a list-prefixed field line
  (`- Depends: S01`) and prose that merely mentions a field name before the first
  heading stay unflagged (P19 — no measured basis; a future incident would need its own
  ruling). Unknown keys outside the block stay ignored at every consumer (inside the
  block the phase-type load still throws; a task document's unknown fields were never
  judged — 0045's standardization boundary).
- `docs/R-NN/handoff.md` now classifies artifact (eof-scanned); no machinery constructs
  it, and a project that hand-keeps one there gains a terminator requirement — the
  category row in test/document-roles.test.ts pins the classification.
- The load-time near-miss silence stands by rule (P8/P10): a near-missed field in a
  document that never passes a collect again (a landed task re-run by a fresh clone)
  still drops silently at load; the collects cover the writing moments, the person's
  review the rest.
- The prompt tests pin the reworded parallelRules block's two homes; the block's other
  sentences are unchanged — a future wording change owes the same lockstep (P13/P15).

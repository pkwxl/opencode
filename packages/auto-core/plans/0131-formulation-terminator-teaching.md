# 0131 — the formulation terminator discipline: the format block teaches the closing line it already showed

The field incident (2026-10-26, dm-glm-auto-analysis-done, R-01.P02-design): the T-049 formulation session
(glm-5.3, deep tier, 20m54s, clean stop at 12% context) wrote all 38 planned task documents
`docs/T-050..T-087/todo.md` structurally correct — title lines, `Phase:` fields, the three sections,
`Depends:`/`Touches:`/`Decompose:`/`Artifacts:` — and omitted the closing terminator `<!-- auto: eof -->`
from every one of them (the string occurs zero times in all 38; `doccheck.ts`'s `endsWithEof` tolerates
trailing newlines, blank lines, whitespace and CRLF, so this is genuine absence, never a rejected form).
The session's own mechanical self-verification checked file presence, `Phase:` lines, section headings,
title/index agreement and the dependency graph — never once the terminator — and declared the format
verified; the driver committed the output, the mechanical collect (0095 D3) blocked the unit, exit 2, the
run's one blocked line naming all 38 files.

The analysis: the teaching existed but thin. The format protocol block in `renderFormulationTodo`
(`src/prompt-plan.ts`) carried the terminator exactly twice — as the sketch's last line, where an HTML
comment reads as decoration, and as one noun inside the "parsed by the DRIVER — write them verbatim"
sentence. The general discipline has a home — `templates/prompts/_partials.md`'s `## eof-rule` ("every
Markdown document you create … must end … The DRIVER validates finished artifacts against exactly this") —
but the partial's membership is a pinned set that deliberately excludes the whole-task family
(`test/prompt-template.test.ts`: the lead's whole-task prompt never carried the terminator rule — its
streams' close-out checks it instead), and the formulation session runs under `whole.md`. The collect, for
its part, has no in-session feedback retry (0095 D3's conscious v1 simplification — a re-run dispatches a
fresh session over the surviving files), so one systematic miss costs the session and blocks the run. The
cheap ruling is on the teaching side: the formulation block is the one prompt whose consumer writes many
task documents in a single session — it states the terminator rule as its own protocol line instead of
leaving it implied by the sketch.

This ruling Derives: **P19** (measured evidence — the 38/38 field omission above is the ground), **P15**
(policy is data — prompt copy in the renderer's format block, the renderer still only assembles), and
**P13** (frozen additive-only vocabularies — the terminator literal itself untouched; the teaching moves
to meet the grammar, never the grammar to meet the model). Tier touched: **prompt copy** — one block in
`src/prompt-plan.ts`, its goldens, documents; no validator, no collect, no template partial moves.

## Category scope (0123 D1's discipline)

Family: *the formulation todo's format protocol teaching — the collect ↔ teaching pair 0095 D3/D4 built
(the grammar `taskTodoSpec` enforces, the block `renderFormulationTodo` teaches).* Home-set enumerated at
ruling time:

| home | disposition |
|---|---|
| `src/prompt-plan.ts` (renderFormulationTodo's format block; the two "End the session" items) | changed — the ruling's whole enactment surface |
| `test/golden/formulation-todo-*.golden.md` (9 files) | changed — re-pinned to the strengthened block |
| The collect (`src/runner.ts` the formulate hook, `src/tasks.ts` plannedTaskProblems/newTaskProblems, `src/document/spec.ts` taskTodoSpec, `src/doccheck.ts`) | held, untouched — the grammar and its enforcement unchanged; the teaching moves to meet it |
| `templates/prompts/_partials.md` `## eof-rule` and its pinned membership (whole.md excluded) | held, untouched — the whole-task family's exclusion is ruled posture (the streams' close-out checks the lead); the formulation block carries its own specific line instead |
| The collect's no-retry posture (0095 D3's v1 simplification) | held, untouched — the re-run-over-surviving-files channel is the recovery; a feedback retry waits for its consumer (P21) |
| The append-side teaching (`src/loop-plan.ts` appendPlan's "last line `<!-- auto: eof -->`" phrase, `templates/prompts/phase-append.md`) | held, untouched — already explicit |

## The ruling

**D1 — the format block states the terminator as its own protocol line.** Immediately after the "parsed by
the DRIVER — write them verbatim" sentence, the block now says: every task document ends with the closing
terminator — its last line of body text is exactly `<!-- auto: eof -->`; a document that ends in anything
else is invalid and the DRIVER blocks this task on it; verify every written document for this before
ending the session. Both closing items (the synthesis and the plain variant) extend symmetrically: "…and
every task document's closing terminator is verified." The sketch itself is unchanged — the new line names
what the sketch showed.

**D2 — nothing else moves (the byte-identical floor).** The grammar, the collect's blocking semantics, the
eof-rule partial's membership, the append teaching and the validator are byte-identical; only the
formulation todo's rendered text grows by the discipline line and the two extended items. A standing
formulation task's committed todo keeps the old text (a retry's input is the frozen document) — the repair
for the incident's own project is the person-side append of the terminator to the surviving files plus the
same one-line strengthening hand-applied to the standing todo, recorded in the closing read.

## Enactment

The one block in `src/prompt-plan.ts`, the 9 formulation goldens regenerated, this file, the INDEX row,
the AGENTS.md navigation phrase. Verification: full typecheck clean; the prompt trio
(prompt-exec/prompt-phase/prompt-template) green; both suites green.

## The closing read

The incident's own project, through the rebuilt CLI: the 38 surviving todo.md files repaired person-side
(blank line + terminator + trailing newline appended, matching the formulation todo's own form; the
last-non-empty-line predicate passing on all 38), the standing `docs/T-049/todo.md`'s format block
strengthened with the same discipline line and its closing item extended (the retry session's frozen
input), both committed; `run --stop-after T-049` re-dispatched the blocked unit (attempt 2, glm-5.3
deep, the fresh session reading the surviving files for 3m10s at 5% context), the mechanical collect
accepted the output ("formulation output accepted: docs/R-01/P02-design/tasks.md lists 38 planned
task(s)"), the wrap-up passed, T-049 done, the numbering record advanced to T-088, the run stopping at
the requested boundary with exit 0 and every todo.md still ending in the terminator.

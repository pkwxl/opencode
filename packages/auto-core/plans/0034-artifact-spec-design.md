# 0034 Artifact spec structuring (M1.4): spec-driven mechanical checks + state-file roles

> Milestone M1.4 of `plans/AUTO_NEXT_REFACTOR_PLAN.md` (root), the document
> domain's part 1. Stage-assisting document per D6: retires as history once the
> refactor closes. Implements the first consumers of the frozen
> `document/types.ts` interfaces (0031 D6) and the `artifactSpec` intent
> section's first consumption (0031 §3 non-goal).

## 1. Scope

Four workpieces:

1. **`产出:` declarations become ArtifactSpec data** — the declaration parser
   moves from `plan.ts` into the document domain; parsed declarations carry
   path / section anchors / role.
2. **Generic spec-driven checker** — the driver's mechanical checks
   (existence, non-triviality, eof terminator, declared section anchors) run
   from spec data through one checker; call sites keep no per-document check
   logic and no hardcoded role names.
3. **todo.md/done.md state files as spec data** — the M1.0 state protocol's
   state semantics, existence checks and illegal-state detection consume a
   declared spec pair; todo.md's protocol section anchors are checked at
   decomposition time (0030 §4's M1.4 handoff).
4. **`## artifact spec` intent section wired** — first content (the subtask
   output-placement convention) migrates out of `subtask.md` into the built-in
   pack; the assembly point injects it as pre-rendered data.

## 2. Decisions

| # | Decision | Content |
|---|---|---|
| D1 | Domain placement | New `src/document/spec.ts`, published via a conscious DOMAIN_ENTRIES edit (`document/spec`). The declaration parser moves out of `plan.ts` (driver) so the document domain owns the declaration format end to end (syntax + check semantics); `plan.ts` keeps PLAN.md structural parsing. The parser's public name (`declaredArtifacts`) is unchanged. |
| D2 | Frozen ArtifactSpec amended at first-consumer time | 0031 D4 in spirit: the first real consumer locks the shape. `sectionAnchor?: string` → `sectionAnchors?: string[]` (the `产出:` parser produces multiple sections per path — the singular draft could not express reality); `fallbackPath?` added (D4 legacy flat-layout compat read, consulted only when the canonical path is absent); `label?` added (human-readable name used in mandatory-artifact feedback). `role` unchanged. |
| D3 | Check policy is per-call, not per-spec | Two homogeneous call sites: `"mandatory"` (merged decompose session — empty content rejected outright, shape checked regardless of freshness) and `"declared"` (`产出:` artifacts — file must exist, shape checked only for .md files new/untracked in the unit; existing-file edits stay covered by the caller's whole-unit eof scan). Role-driven extensibility: only role `artifact` is checked in M1.4; handoff/driverState/ledger/freeform policies derive from the M2.3 role model. |
| D4 | Message preservation | Pinned problem strings stay byte-identical: `declared artifact <path> does not exist`, `declared artifact <path> is missing section "<anchor>"`, `<path> <label> missing or empty`, and all docShapeProblems wording. Unpinned wording change (no consumer): subtasks.md's combined `missing or has no checklist items` splits into the spec-driven `<path> subtask checklist missing or empty` (file missing/empty) plus a driver-side `<path> has no checklist items` (content present but unparseable). |
| D5 | todo.md section anchors checked (new tightening) | `## 范围声明` (scope declaration) / `## 产出清单` (artifact list) become checked anchors of the todo.md spec (declared once in `SUBTASK_TODO_SECTIONS`, shared by the decompose checks and DRIVER-authored injected files). No content cross-check between todo.md's 产出清单 (artifact-list section) and the item's `产出:` paths: parsing a free-form list for set equality is a false-block risk, and the plan's M1.4 check list is existence / non-triviality / eof / declared section anchors — anchors are the mechanical part. Only fresh decompose sessions are affected (the early-inject path for existing decomposition results never runs these checks; in-flight legacy tasks keep checklist semantics). |
| D6 | State protocol consumes spec data | `subtaskStateSpec(taskId, index)` = `{ pending: ArtifactSpec (todo.md — anchors, label, creation-time checks), complete: { path } (done.md — DRIVER rename target, content carried over unchanged, never re-checked) }`. scan / rename / injected-write / runSubtask short-circuit / the runner's illegal-state message all consume it; the state-file names have one source (the runner's message derives them via basename — byte-identical output). Final DocumentRole assignments for the state semantics stay an M2.3 decision (role model); M1.4 roles the pair through spec data. |
| D7 | artifactSpec section first consumption | `subtask.md`'s output-placement convention block (产出约定, output-placement convention — (b)-class: where document-type artifacts go, what code-type artifacts do) migrates to the built-in pack's `## artifact spec` / `### subtask-output`; `renderSubtask` injects it pre-rendered as `artifactConvention`; the template block becomes `{{#if artifactConvention}}`. Tier-1 protocol surfaces stay in the core templates (two-tier doctrine, 0033): the `产出:` (artifact-declaration) format lines, the todo.md two-section skeleton (driver-checked anchors), and the doc-layout/state-file exclusivity clauses. |
| D8 | Injection-site guard, not in-pack guard | `renderSubtask` injects only when an output file exists (index given or derived), so the pack text is plain — no `{{#if outputFile}}` needed inside the section. A pack without the subsection drops the block cleanly (zero-intent baseline). D4-of-plan staged breakage: a project override of `default.md` that omits `## artifact spec` loses the convention line — same pattern as M1.2/M1.3 (no such user in the repo). |
| D9 | Checklist-items validation stays driver-side | subtasks.md is the driver's own injection input (parsed for PLAN.md); "content present but no parseable checklist items" is input validation, not artifact shape — it stays in `execute.ts`, appended after the spec-driven findings. |
| D10 | Prompt-side path references stay docpaths-direct | docpaths remains the single path-construction point (plans/0010); spec data governs protocol semantics and checks, not every path mention (e.g. `renderSubtask`'s todoFile pointer keeps `subtaskDoc`). No prompt.ts import-surface change (FROZEN_IMPORTS untouched). |

## 3. Consequences / touch map

- **New**: `src/document/spec.ts` (parser + spec tables + generic checker),
  `test/document-spec.test.ts`.
- `src/document/types.ts` — ArtifactSpec amended (D2, conscious event).
- `src/plan.ts` — declaration parser removed (~70 lines); pointer comment kept.
- `src/execute.ts` — both problem collectors spec-driven
  (`decomposeArtifactProblems` via the spec table + mandatory policy;
  `subtaskArtifactProblems` via declared policy, the zero-write criterion and
  the whole-unit eof scan unchanged); runSubtask's done.md short-circuit reads
  the spec pair.
- `src/subtask-state.ts` — scan/rename/injected-write consume the spec data;
  injected-file headings come from `SUBTASK_TODO_SECTIONS`.
- `src/runner.ts` — illegal-state message names derived from the spec.
- `src/prompt.ts` — `renderSubtask` injects `artifactConvention` (D7/D8).
- `templates/prompts/subtask.md` — the `{{#if outputFile}}` convention block
  becomes the `{{#if artifactConvention}}` hook.
- `templates/intents/default.md` — `## artifact spec` gains `### subtask-output`
  (first content).
- `test/import-direction.test.ts` — DOMAIN_ENTRIES.document += `document/spec`
  (the only table edit).
- `test/plan.test.ts` (parser cases moved out), `test/intent.test.ts`
  (built-in pack now carries artifactSpec), `test/prompt-exec.test.ts`
  (M1.4 migration cases), `test/auto-doc-shape.test.ts` (todo anchor case).

## 4. Non-goals (later milestones)

- `document/roles.ts` role model; eofScanExempt / protect / handoff-shape role
  derivation; rename-protocol close-out under roles → M2.3.
- wrapup `reportProblems` and bypass-session (`requireArtifact`) collection
  checks → M2 (task loop).
- English translation of touched templates and driver protocol strings (the
  `产出:` token itself, state/shape feedback wording) → registered with M1.5.
- Machine-parsing the intent `artifactSpec` section as declared specs (a
  configuration DSL for checks) → deliberately not modeled; generalizes when a
  second real consumer appears (F8).

## 5. Verification

- Golden snapshots (46) zero drift — the subtask rendering is byte-identical
  through the pack migration.
- Render-matrix diff equivalence: renderSubtask across the full flag cartesian
  (verify × testByDriver × handoverTest × continuation × warm × mode, for
  index-given / derived-index / no-checklist forms, plus explicit-outputFile
  overrides and whole/decompose canaries) before vs after — empty diff.
- New unit coverage: parser (moved cases), spec builders, both checker
  policies (existence / freshness-gated shape / anchors / fallback read /
  non-artifact role skip), todo.md anchor enforcement end to end.
- Full suite + `bun typecheck` clean; `packages/auto` green with zero shell
  changes; import-direction suite green with the single conscious table edit.

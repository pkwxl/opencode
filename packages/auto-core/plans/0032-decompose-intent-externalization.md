# 0032 Decompose-family intent externalization (M1.2)

> Milestone M1.2 of `plans/AUTO_NEXT_REFACTOR_PLAN.md` (root): migrate the
> decompose family's (b)-class content — the six `decompose-{a,d,m,t,v,k}.md`
> split-criteria blocks and the `_partials.md` `decompose-rule` section — into
> the built-in intent pack, leaving the core templates with role boundaries,
> format protocols, and eof discipline only. Pure moves are golden
> byte-equivalent (F9). Stage-assisting document per D6: retires as history
> once the refactor closes.

## 1. What moved where

- `_partials.md` `## decompose-rule` (split granularity criteria, incl. the
  `{{#if fine}}` conditional and `{{contextBudget}}`) →
  `templates/intents/default.md` `## quality`.
- Each `decompose-<phase>.md` item-4 block ("本阶段({{phaseName}})的切分与产出
  准则" + bullets) → `templates/intents/default.md` `## phase duties`, as
  `### <letter> <name>` subsections.
- Core templates keep: task framing, context.md/shared.md/subtasks.md/todo.md
  production protocol (the PROTOCOL_MARKERS surface), digest/eof/doc-layout
  partials, and the constraint list. The moved text is replaced by the
  injection points `{{#if decomposeRule}}{{decomposeRule}}\n{{/if}}` (all
  seven templates) and `{{#if phaseDuties}}{{phaseDuties}}\n{{/if}}` (the six
  phase variants; the generic fallback never had a duties block).

## 2. Decisions

| # | Decision | Content |
|---|---|---|
| D1 | Injection = pre-rendered data | `renderDecompose` renders the pack's `quality` section and the current phase's duties subsection with `renderText(section, baseCtx)` and injects the results as plain vars. Pack sections may therefore use the template syntax (`{{var}}`/`{{#if}}`) — the same license mode files already have (`modeText` renders `{{#if verify}}`). This keeps `{{#if fine}}`/`{{contextBudget}}`/`{{phaseName}}` semantics identical without growing the pack file protocol. |
| D2 | Per-phase addressing = `### <key>` subsections | `## phase duties` is subdivided by `### <key>` headings (key = phase letter; a human-readable suffix after the key is allowed). `dutiesForPhase(pack, key)` in `src/intent/load.ts` extracts the trimmed subsection body; unknown key or absent section → `undefined` (zero-intent baseline: no duties injected). Text before the first `###` is not addressable. This is intra-section addressing, not composition algebra; the M3 phase registry's `dutiesRef` will point at these subsections. |
| D3 | Assembly point owns the active pack | `src/prompt.ts` holds module state `activeIntentPack` (default: built-in preset) and exports `useIntentPacks(dir)`; `loop-preflight` calls it next to `usePromptLibrary`, so project overlays (`.opencode/auto/intents/`) apply and malformed pack files surface as exit-1 usage errors at startup (this retires the "loader unwired" caveat of 0031 D4). Degenerate composition unchanged: one active pack, wholesale same-name override. |
| D4 | Guards instead of bare vars | Injection points are `{{#if x}}{{x}}\n{{/if}}`, so a pack that omits a section drops the block cleanly (no blank-line debris). Numbering caveats of the zero-intent case (later items keep their numbers) are accepted: degenerate composition ships one meaningful pack; renumbering is not expressible in the minimal template syntax. |
| D5 | Frozen-imports table edit is the architecture event | prompt.ts (flat, intent domain) now imports `intent/load` + `intent/types`; `test/import-direction.test.ts` FROZEN_IMPORTS updated consciously, per M0.7 rule 7. |
| D6 | Known breakage, accepted per plan D4 | A project that overrides `decompose-*.md` with pre-M1.2 content containing `{{> decompose-rule}}` now fails at render time (unknown partial) unless it also overrides `_partials.md` with that section. Overrides of `decompose-*.md` without the partial reference are unaffected. In-repo users: none; the risk window is external projects with private prompt overlays. |

## 3. Byte-equivalence evidence (F9)

- Golden snapshots: all 46 `test/golden/*.golden.md` unchanged; the generic
  `decompose` fixture in golden.test.ts now supplies `decomposeRule` by
  replicating the renderDecompose injection (test code changed, snapshot
  bytes did not).
- Ad-hoc exhaustive check during implementation: all six phases × fine on/off
  rendered via `renderDecompose`, plus the generic template, diffed
  byte-for-byte against pre-change renders — identical.

## 4. Test changes

- `test/intent.test.ts`: built-in default pack now carries quality +
  phaseDuties (the zero-intent assertion moved to acceptance/governance/
  artifactSpec); new `dutiesForPhase` suite (extraction, suffix headings,
  unknown key, absent section, all six letters present in the built-in).
- `test/template.test.ts`: the decompose describe no longer asserts criteria
  content at the template layer (it is pack content now); asserts the
  injection points place supplied vars correctly and that the zero-intent
  case renders clean. The fine on/off assertions stay at the prompt layer
  (`test/prompt-exec.test.ts`, unchanged, via `renderDecompose`).
- `test/prompt-exec.test.ts`: two new tests — project `default.md` override
  replaces the decompose intent wholesale via `useIntentPacks` (pack text may
  use `{{contextBudget}}`/`{{phaseName}}`), and an empty-override zero-intent
  baseline keeps the core protocol while dropping the criteria.

## 5. Verification

auto-core: 929 pass / 0 fail, `bun typecheck` clean; packages/auto: 54 pass /
typecheck clean, zero shell changes. Golden snapshots untouched.

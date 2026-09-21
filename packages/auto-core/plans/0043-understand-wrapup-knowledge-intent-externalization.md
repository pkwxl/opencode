# 0043 Understand / wrap-up / knowledge family intent externalization (M2.1)

Root plan item M2.1 (`plans/AUTO_NEXT_REFACTOR_PLAN.md`). Moves the (b)-class
content of the merged understand+decompose session's digest layout, the
wrap-up report and proxy-answer audit, the knowledge/prior-knowledge quality
bars, the AGENTS.md maintenance rules, the stuck-hint level-2 reflection
discipline and question-rule's decision catalog (the split list of 0033 §4.1)
out of the core templates/code into the built-in intent pack
`templates/intents/default.md`. Pure move: every render is byte-identical to
before (§4). `understand.md` needs no action — M1.0 already retired it into the
merged decompose templates (0030).

## 1. Marker lifecycle ruling (0036 open question 7 / D11)

Ruled by the user on 2026-09-21, before this batch started: **(a), refined**.
`AUTO-DECISION` / `AUTO-FIXME` / `AUTO-RESOLVE` markers are an important result
of the process and a key quality-assurance device. They belong in target source
because later development iterations are meant to work them off, and they must
stand self-consistently there. The marker line carries its own
question/decision/reason and never points into process documents. So 0036's (c)
"never in source" and (b) "strip at round close" are both rejected. The carve-out
0036 §11-7 said (a) needs is now explicit: process *markers* in target code are
legitimate, process *references* are not (D12/P1 and its forbidden-shape check
are unaffected).

Consequence for this batch: none of the four "or in a code comment" disjuncts
is deleted, and the decision catalog moves into `## governance` verbatim. The
prompt wording that asks markers to be self-contained is prompt-side P1 work.
It lands with M2.2's `## governance` text.

## 2. Segment table

| Source (before) | Pack location | Injection var / consumer | (a) remainder kept in core |
|---|---|---|---|
| `decompose*.md` ×7 — context.md "in four sections" + four headings | `## artifact spec` / `### context-digest` | `contextDigest` (renderDecompose) | the context.md path, the `{{contextLines}}` compactness budget (driver switch), the recovery "revise, don't rewrite" clause |
| `_partials.md` question-rule `{{^ask}}` — recording discipline, ownership catalog, example, "annotate once / when unsure" | `## governance` / `### decisions-unattended` | `decisionsUnattended` (renderPrompt → `promptCtx`) | permission→question tool; non-permission→no question tool; auto-reply/repeat-block line; literal zero-intent fallback carrying both marker formats |
| `_partials.md` question-rule `{{#if ask}}` — ownership catalog (ask variant) | `## governance` / `### decisions-ask` | `decisionsAsk` (same) | permission protocol; auto-answer note; repeat-block; minimal fallback |
| `wrapup.md` item 2 — index-style vs summary report form | `## artifact spec` / `### report-indexed`, `### report-solo` | `reportForm` (renderWrapup, keyed by solo) | report path, reference/anchor protocol (refcheck), solo line-break layout |
| `wrapup.md` item 4 — "session-identified proxy calls also listed, implementation trade-offs not" | `## governance` / `### wrapup-audit` | `auditScope` | driver-listed items, the 「自动代答问题」 section (registered protocol string), the `AUTO-RESOLVE` line form, "every item must appear" |
| `knowledge.md` / `prior-knowledge.md` "质量约束(硬性要求)" items 1–4 | `## quality` / `### knowledge`, `### prior-knowledge` | `qualityRules` (heading kept core, guarded with the body) | inputs, chapter skeleton, steps, constraints, 「完成」 closing marker |
| `stuck-hint.md` level 2 — "write these three things out… before acting" | `## quality` / `### stuck-reflection` | `reflection` (renderStuckHint, level 2 only) | `[DRIVER]` loop framing, "reminder number N, still going in circles" |
| `agents-block.ts` `MAINT_RULE` | `## governance` / `### agents-maintenance` | `activeIntentText` (renderAgentsBlock paragraph list) | the other six paragraphs; block markers; ensurePointer sync |

## 3. Decisions

| # | Decision | Content |
|---|---|---|
| D1 | Marker formats stay core-owned | The formats are what `src/resolve.ts` scans for (tier-1), so they are exported constants `RESOLVE_FORMAT` / `DECISION_FORMAT` in prompt.ts and reach the pack text as `{{resolveFormat}}` / `{{decisionFormat}}`. The pack catalog carries no literal marker grammar, so a project override can reword the catalog but not fork the grammar. |
| D2 | Literal fallback keeps the tier-1 anchors in the partial | `PARTIAL_MARKERS["question-rule"]` (question tool / AUTO-RESOLVE / AUTO-DECISION) validates the partial text. The `{{^decisionsUnattended}}` fallback states both formats literally, so the anchors stay in the partial and a zero-intent pack still gets a scannable instruction. A test pins fallback literal == constant (one wording). The marker table is unchanged. |
| D3 | Governance hook injected at the render exit | question-rule is shared by 22 templates, so its hook is fed where `ask` already is (0033 §4.1 mechanics): `promptCtx(ctx)` completes every render's ctx with `ask`, the two formats and the branch-selected catalog, pre-rendered. It is exported so tests that render partials directly see what sessions see. |
| D4 | Headings travel with guarded bodies | knowledge/prior-knowledge: the "## 质量约束(硬性要求)" heading sits inside `{{#if qualityRules}}`, so a pack without the key leaves no empty chapter. context.md: the lead-in ", in four sections:" is pack text, so zero-intent reads "write … into docs/T-NNN/context.md" with no dangling colon. |
| D5 | Layout stays core | wrapup's solo form needs a line break the indexed form lacks. The break is a core `{{#if solo}}` (layout), not pack text, because pack bodies are blank-trimmed. |
| D6 | AGENTS.md block reads the active pack raw | `renderAgentsBlock` takes the paragraph from `activeIntentText("governance", "agents-maintenance")` (unrendered — the block is not a prompt template). It is the same active pack preflight loads, so a project override reaches the AGENTS.md block on the next `ensurePointer`. A pack without the key drops the paragraph (the array filter already handles absent paragraphs). agents-block (driver) → prompt (intent-tagged flat file) adds no cycle and no frozen-import change. |
| D7 | Scope held to the plan's list | Not moved: the knowledge chapter skeletons (artifact structure, candidates for M2.3's roles), level-1 stuck premises check, wrapup item 1 (disk-continuity requirement = session-boundary mechanism). Translation of wrapup/knowledge/prior-knowledge and of the Chinese pack bodies is M2.5's (moved text stays in its current language, same sequence as M1.2 → M1.5). |

## 4. Byte-equivalence evidence (F9)

- Golden snapshots: zero change (`test/golden/` untouched; the
  `decompose-generic` fixture now replicates the new injections through
  `promptCtx`).
- Ad-hoc render matrix diffed byte-for-byte before/after: 226 renders —
  decompose 6 phases × fine × verify, subtask/whole/wrapup (solo × resolves ×
  mode × verify)/knowledge/prior-knowledge (mode × brief × distilled)/stuck-hint
  (levels 1–4 × repeat/error), every other question-rule consumer
  (verify-script-gen, verify-judge, fix, review ×2, review-fix, implement-plan,
  phase-plan ×6, phase-handover, final ×4, number-recovery, infer-source), all
  of it × ask off/on; plus AGENTS.md block × verify × testByDriver. All
  identical.

## 5. Test changes

- `intent.test.ts`: built-in pack asserts the ten new subsections;
  `## governance` is no longer empty (the absent-section assertion now covers
  `## acceptance` only).
- `prompt-template.test.ts`: the question-rule fragment renders through
  `promptCtx`. New: zero-intent fallback keeps the protocol plus both formats
  (off) and no markers (on), and fallback literal == exported constant.
- `prompt-exec.test.ts` (new describe, 3 cases): built-in pack reaches every
  consumer; an empty `default.md` overlay drops each segment cleanly with no
  `{{`/`}}` debris and core protocol intact (incl. the literal fallback); a
  project `## governance` override replaces the catalog and the maintenance
  paragraph while `{{resolveFormat}}` still resolves to the core grammar.
- `golden.test.ts`: generic decompose fixture routed through `promptCtx`.

## 6. Verification

auto-core `bun typecheck` clean, `bun test` 1050 pass / 0 fail (1046 + 4 new);
import-direction assertions unchanged and green; packages/auto typecheck clean,
52 pass + 2 skip, zero changes.

<!-- auto: eof -->

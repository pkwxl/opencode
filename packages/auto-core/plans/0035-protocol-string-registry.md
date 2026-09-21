# 0035 Driver protocol string registry (M1.5): subtask-loop translation + lockstep registration

> Milestone M1.5 of `plans/AUTO_NEXT_REFACTOR_PLAN.md` (root). Stage-assisting
> document per D6: this is the registry that open question 11 asked M1.5 to
> produce. It is consumed by the two protocol lockstep steps — **M2.4** (task
> face) and **M3.4** (ledger face) — and retires as history once the last
> registered string has flipped and the dual-read compatibility layer is
> retired (retirement condition confirmed at M4 close-out, field canary at
> M6.3). Translation-batch consumption list: `plans/0028-m06-golden-bilingual-review.md`.

## 1. Scope

Two workpieces, deliberately unlike each other:

1. **Prose translation of the M1-touched template face** (the D7 folding
   clause: template/prompt translation belongs to the owning loop milestone,
   not to M0.6). 0028's mapping table assigns 18 golden files to M1; after
   M1.0 retired `understand.md` those goldens are rendered from 14 prompt
   templates. This batch translates those 14 plus the shared-partial file and
   the two data packs they consume (`templates/intents/default.md`,
   `templates/modes/migrate.md`) — 17 template files; see §7 for why
   `_partials.md` is in this batch even though 0028's table leaves it
   unassigned.
2. **Protocol string registration** — no protocol literal flips in this batch.
   §3 is the registry of the M1 face (literal / producer / parser / owning
   lockstep batch / dual-read requirement); §4 lists the faces that later loops
   register themselves; §5 lists the language-neutral surface that never flips;
   §6 is the flip procedure M2.4/M3.4 follow.

## 2. Decisions

| # | Decision | Content |
|---|---|---|
| D1 | Prose and protocol are different batches | 0028 note 2 is binding: protocol strings inside templates flip **only** at a driver-protocol lockstep step, never inside a prose translation batch. A prose batch has no parser change and no dual-read layer, so flipping a literal there would break in-flight projects silently. Every Chinese literal that survives this batch in an otherwise-English template is intentional and listed in §3. |
| D2 | The English prompt names each protocol literal explicitly | Translation introduces a new failure mode the Chinese original did not have: an all-English instruction ("declare the item's artifacts", "both headings are protocol anchors") invites the session to write `Artifacts:` or `## Scope`, which parses to **zero** specs and silently disables the M1.4 mechanical checks. Mitigation, applied at every occurrence: the literal token appears verbatim in backticks **and** the sentence states that it is a driver protocol string to be written verbatim and untranslated. This is a deliberate strengthening, not translation drift; the golden diff shows it as added wording. |
| D3 | Registry scope = strings the driver parses, plus the strings that guard them | Registered: any literal a driver parser matches in session-authored or driver-authored state, and any literal that appears in `PROTOCOL_MARKERS` / `PARTIAL_MARKERS` (tier-1 guards must move with the template they guard). Not registered: prose, log text, human-facing messages, and the language-neutral surface of §5. |
| D4 | The whole M1 face flips at M2.4 | Root plan names `parseVerdict`/`parseConclusion`/`handoffStatus` at M2.4 and the ledger at M3.4, leaving the subtask-loop literals (`产出:`, `## 范围声明`, `## 产出清单`) unassigned. They are assigned to **M2.4**: `handoffStatus` is already M2.4, and `产出:`'s producer set spans two loops (M1's decompose family **and** M2's `review.md` review-fix injection), so flipping it inside M1 would leave a Chinese instruction producing an English token — a split face. One flip at M2.4 covers all producers at once. M3.4 remains the ledger face only. |
| D5 | Dual-read is per-string and outlives the flip | Open question 11 / D4 of the root plan: after a flip, the parser accepts **both** the old Chinese and the new English form. The requirement is strongest where the state outlives a run: `产出:` lives inside PLAN.md task bodies and `## 范围声明`/`## 产出清单` inside pending `todo.md` files, both of which in-flight projects carry across rounds. `状态:` is per-run (a handover document is consumed then archived) but archived `testhandoff-<n>.md` files are re-read on recovery, so it needs dual-read too. The compatibility layer is not retired per string; retirement is a single M4 close-out decision. |
| D6 | Tier-1 marker tables are part of the lockstep surface | `PROTOCOL_MARKERS` / `PARTIAL_MARKERS` (src/template.ts) are the load-time guard for target-directory overrides. A flip commit must change the marker literal, the template, and the parser together — otherwise the built-in template itself fails its own guard, or an override carrying the old literal passes while the driver no longer parses it. This batch already exercised that coupling on the two markers whose wording is prose rather than protocol: `question-rule`'s `question 工具` → `question tool`, and `test-wrapup`'s `不依赖本次测试结果` → `not dependent on this test run's result`. |
| D7 | Value-side vocabulary flips with the parser | Several protocols compare or return the *value*, not just the key: `handoffStatus` returns `继续`/`完成` and 8 call sites in src/execute.ts compare against those two literals; `parseStrategy` (src/final.ts) has the union type `"重构" \| "修补" \| "无"`; `parseConclusion`/`parseVerdict` match `通过`/`差距`/`重验`. A flip commit therefore touches the regex, the returned values, the TS union types, every comparison site, and any prompt that tells the session which value to write. M1's own value-side vocabulary that is **not** protocol was translated in this batch (STATUS_TEXT, `subtaskSnapshot`, `doneIds`, doccheck problem text) precisely because no parser reads it. |
| D8 | Test-face coupling (root plan risk 7) | Assertions on prose flipped with this batch (273 assertion lines across 12 test files; 89 tests were failing before the update). Assertions on protocol literals keep the Chinese literal until the owning flip commit — a test that pins `产出:` or `状态: 继续` is the executable form of the registry entry and must move in the same commit as the parser. Golden snapshots are the third leg: `UPDATE_GOLDEN=1` regeneration in this batch flipped 42 of 46 files (the 4 unchanged are the agent contracts and `context-base`, which consume no shared partial). |
| D9 | Shared partials are owned by the earliest batch that touches them | 0028's table assigns every template to a loop **except** `_partials.md`, whose seven sections are consumed by templates in all three loops. Leaving it unassigned would leave a permanent Chinese tail that no batch owns, against D7 risk-6 ("a loop translates its whole touched face in one pass, no cross-loop tail"). Assigned here. Accepted cost: M2/M3 templates render English partial sections inside Chinese bodies until their own batch lands — visible in this batch's 42-file golden flip, and the reason `prompt-phase` / `prompt-verify` tests also needed assertion updates. |

## 3. Registry: the M1-touched face

All entries flip at **M2.4** (D4). "Dual-read" states what an in-flight project
may still hold after the flip.

| Literal | Producers (who writes it) | Parser / consumer | Dual-read after flip |
|---|---|---|---|
| `状态: 继续` / `状态: 完成` | `templates/prompts/handoff-steer.md` (the steer text itself), `subtask.md` item 3c, `test-wrapup.md` (value fixed to `继续`); driver-authored retry feedback in `src/execute.ts` (runSubtask path) and `src/watch.ts` (handleIdleTest) | `src/handover.ts handoffStatus` — line-anchored `/^[ \t]*状态[:：][ \t]*(继续\|完成)[ \t]*$/m`; consumed via `handoffComplete`, presence-only at `src/runner.ts:194` and `src/testrun.ts:106`; value-compared at `src/execute.ts` 61/65/128/129/344/347/444/448. Tier-1: `PROTOCOL_MARKERS["handoff-steer"]` | Archived `handoff.md` / `testhandoff-<n>.md` from before the flip are re-read on recovery (`handover.json` nextSession path) |
| `产出:` (artifact declaration token) | The eight decompose templates' declaration-format lines and checklist skeleton; `templates/prompts/review.md` (M2 face — review-fix checklist injection); referenced in prose by `src/subtask-state.ts writeInjectedTodo` | `src/document/spec.ts declaredArtifacts` — `/(?:^\|\s)产出\s*[:：]\s*(.+)$/` (moved from plan.ts at M1.4) | PLAN.md task bodies written before the flip: checklist items persist across rounds and are re-parsed on every run |
| `## 范围声明` / `## 产出清单` | The eight decompose templates' todo.md skeleton; DRIVER-authored `src/subtask-state.ts writeInjectedTodo` (headings read from `SUBTASK_TODO_SECTIONS`) | `src/document/spec.ts SUBTASK_TODO_SECTIONS` → `subtaskStateSpec(...).pending.sectionAnchors` → `checkArtifactSpecs` (0034 D5) | Pending `docs/T-NNN/S<nn>/todo.md` written before the flip. `done.md` is never re-checked (0034 D6), so renamed files need no compatibility |
| `question tool` (was `question 工具`) | `templates/prompts/_partials.md` `## question-rule` | Not parsed — tier-1 guard only (`PARTIAL_MARKERS["question-rule"]`) | None; already flipped in this batch as prose-adjacent marker wording (D6) |
| `not dependent on this test run's result` (was `不依赖本次测试结果`) | `templates/prompts/test-wrapup.md` | Not parsed — tier-1 guard only (`PROTOCOL_MARKERS["test-wrapup"]`) | None; already flipped in this batch (D6) |

## 4. Faces registered by their own loops (not enumerated here)

Recorded so the M2.4/M3.4 sessions know the boundary; each loop registers its
own face in its own numbered document.

- **M2.4 task face**: `结论: 通过|差距|重验` (`src/review.ts parseVerdict`,
  `src/final.ts parseConclusion`), `策略: 重构|修补|无` (`src/final.ts
  parseStrategy` — value union type included, D7), the `自动代答问题` report
  section (`templates/prompts/wrapup.md` producer, `src/resolve.ts` reference),
  plus `review.md`'s `产出:` producer row from §3.
- **M3.4 ledger face**: `- [done] <letter> …` ledger line (`src/phases.ts
  LEDGER_ENTRY`), `## T-NNN: <任务标题> [pending]` plan-heading format
  (`implement-plan` / `phase-plan` tier-1 markers), `HANDOVER_SECTIONS`
  (`## 关键决策` / `## 约束与坑` / `## 下一阶段必读清单` / `## 产物索引`),
  `PHASE_NAMES` + `phaseText` vocabulary, the knowledge-doc `完成` terminator
  (`src/knowledge.ts:289`), refcheck's inline exemption markers
  `已删除|已归档|历史` (`src/refcheck.ts:35`), and the resume-gate /
  `COMMIT_CLARIFY` interjection family (`src/exec-session.ts:172`).
- **Language-neutral already**: `verified-command:` (src/review.ts:396).

## 5. Language-neutral protocol surface (never flips)

Registered so later batches do not mistake them for untranslated leftovers:
`<!-- auto: eof -->` (src/doccheck.ts `EOF_MARK`; open question 11 rules the
EOF marker itself language-neutral), `- [ ]` / `- [x]` checklist ticks
(`src/plan.ts subtasks`), `AUTO-RESOLVE:` / `AUTO-DECISION:` (`src/resolve.ts`
scans session documents; already ASCII), `AUTO-FIXME:` (no driver parser — a
human-facing leftover convention referenced by `stuck-hint.md` and
`test-continue.md`), `[DRIVER]` interjection prefix (the *body* text is prose
and translates per loop), file and directory names (`context.md`, `shared.md`,
`subtasks.md`, `todo.md`/`done.md`, the `handoff`/`testhandoff` family,
`PLAN.md`, `CURRENT.md`, `.auto/*`, `docs/T-NNN/`, `S<nn>`), and
`# <name>` first-line protocol of mode and intent pack files.

## 6. Flip procedure (what M2.4 / M3.4 execute per string)

1. Parser accepts both forms (old Chinese, new English) — the dual-read commit
   lands first or with the flip, never after.
2. Template + any driver-authored producer (e.g. `writeInjectedTodo`) write the
   English form; the D2 "verbatim and untranslated" wording is retained so an
   English prompt does not invite re-translation.
3. Value-side vocabulary moves with it: returned values, TS union types, every
   comparison site (D7).
4. `PROTOCOL_MARKERS` / `PARTIAL_MARKERS` entries move in the same commit (D6).
5. Tests that pin the literal move in the same commit (D8).
6. Golden three-way comparison required by open question 11: old-Chinese render,
   new-English render, and the compatibility path (a state file still carrying
   the old literal must parse identically).

## 7. Why `_partials.md` is in this batch

0028's mapping table maps golden files to loops and leaves `_partials.md`
unassigned, because it renders into templates of all three loops rather than
into a golden of its own. Its seven sections (`head`, `question-rule`,
`state-rule`, `ground-state`, `digest-rule`, `eof-rule`, `doc-layout`) are all
consumed by M1 templates (`subtask`, `fix`, the decompose family, the test-*
family), so M1 is the earliest loop that touches it and D9 assigns it here.
Consequence, accepted: M2/M3 templates now render English partial sections
inside Chinese bodies until their own batch lands. That mixed state is
mechanically harmless — partials carry no protocol literal except the two
marker rewordings of §3 — and it is visible in the golden diff, so no batch can
lose track of it.

## 8. Deferred seams (Chinese left inside M1-touched files on purpose)

Each belongs to the batch that owns the template it serves; leaving them is D1,
not an oversight:

- `src/execute.ts:156` — `executeWhole`'s handover-retry feedback. Twin of the
  already-translated `runSubtask` feedback at :475, but serves `whole.md` (M2).
- `src/prompt.ts:333` — `renderVerifyJudge`'s `runTimeout` value, feeds
  `verify-judge.md` (M2).
- `{{phaseName}}` in the decompose family — the value comes from `PHASE_NAMES`
  in `src/phases.ts` (`分析`/`设计`/`迁移实现`/`测试`/`验收`/`知识提炼`), so an
  English sentence carries a Chinese phase name until the M3.4 vocabulary flip.
  It is injected data, not template prose, so the M1 batch has no business
  touching it; the mixed render is visible in the decompose goldens.
- `src/wrapup.ts:79`, `src/artifact.ts:202` — the generic doc-shape and
  artifact-missing retry feedback; consumers are M2/M3 artifact specs
  (`src/final.ts`, `src/implement.ts`, `src/knowledge.ts`, `src/loop-phase.ts`,
  `src/numbering.ts` all still carry Chinese `artifact`/`requirement` text).
- src/ comments repo-wide — translate-on-touch (M0.6 revision), not batched.
- Test names, `describe` titles and comments repo-wide — untouched by D8; only
  expected literals moved.

## 9. Touch map

- **Templates (17)**: `templates/prompts/{_partials,decompose,decompose-a,
  decompose-d,decompose-k,decompose-m,decompose-t,decompose-v,subtask,fix,
  stuck-hint,handoff-steer,test-continue,test-result,test-wrapup}.md`,
  `templates/intents/default.md`, `templates/modes/migrate.md`.
- **src (8)**: `template.ts` (two marker rewordings + registration/render error
  messages), `mode.ts` (whole file), `doccheck.ts` (whole file), `prompt.ts`
  (STATUS_TEXT / subtaskSnapshot / doneIds / renderTestResult / renderStuckHint
  values), `execute.ts` (three AI-facing feedback strings in the decompose and
  subtask paths), `subtask-state.ts` (`writeInjectedTodo` body prose),
  `stuck.ts` (`summarize` truncation suffix), `watch.ts` (test-handover
  backfill steer).
- **Goldens**: 42 of 46 regenerated; `agent-contract-{plain,verify,testbydriver}`
  and `context-base` unchanged.
- **Tests (12 files, 273 assertion lines; 89 tests were failing)**:
  `prompt-exec`, `prompt-template`,
  `prompt-phase`, `prompt-verify`, `template`, `mode`, `intent`,
  `subtask-shape`, `auto-doc-shape`, `document-spec`, `incident-regression`,
  `stuck`.
- **Shell package**: zero changes (no extension point moved; `shell-contract.md`
  needs no sync — the protocol-string retention list it was credited with in
  the M0.6 close-out note lives in the root plan entry, not in that file, and
  this document supersedes it as the authoritative registry).

## 10. Verification

- `bun typecheck` clean; `bun test` green in `packages/auto-core`
  (954 tests, unchanged count — no test added or removed) and `packages/auto`
  (54, zero shell changes).
- Golden regeneration is the translation's equivalence proof in the other
  direction: every flipped file differs only in wording, and the surviving
  Chinese is exactly the §3 rows plus the injected `{{phaseName}}` value (data
  from `src/phases.ts`, M3.4 scope) — checked by grepping the M1 templates and
  the M1 goldens for CJK characters, which returns only `产出:`,
  `## 范围声明`, `## 产出清单`, `状态: 继续|完成` and the phase names.
- No parser regex, spec table, marker key, template variable name, section
  heading of a pack file, or control-flow branch changed in this batch: the
  diff is string literals, comments and template prose only (D1).

## Amendment (2026-09-21, M2.3 / plans/0045 D5)

Parse points moved into the document domain, literals unchanged:
`handoffStatus` (row `状态: 继续|完成`) from `src/handover.ts` and
`HANDOVER_SECTIONS` / `validHandover` (M3.4 ledger face) from `src/phases.ts`
now live in `src/document/roles.ts`; `src/subtask-state.ts` is
`src/document/state.ts`. Line numbers cited above predate the move.

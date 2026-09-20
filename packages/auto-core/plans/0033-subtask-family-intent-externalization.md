# 0033 Subtask-family intent externalization + protocol-marker two-tiering (M1.3)

> Milestone M1.3 of `plans/AUTO_NEXT_REFACTOR_PLAN.md` (root): (1) move the
> closing self-check sentences of `subtask.md` / `whole.md` into the built-in
> intent pack; (2) land the PROTOCOL_MARKERS two-tiering (open question 3) as
> the safety net for nested-segment splits; (3) record the per-segment split
> list for the nested (a)/(b) carriers — the actual splits belong to
> M2.1/M2.2 and start only now that the net exists (risk 2). Pure moves are
> golden byte-equivalent (F9). Stage-assisting document per D6: retires as
> history once the refactor closes.

## 1. Self-check externalization

- `subtask.md` 收尾 item a ("自我检查该子任务是否真正完成") and `whole.md`
  constraint item 1 ("完成整个任务后自我检查是否真正完成") →
  `templates/intents/default.md` `## quality`, as the subsections
  `### self-check-subtask` / `### self-check-whole`.
- The pre-existing decompose criteria move under `### decompose` in the same
  section: `## quality` is now subsection-addressed like `## phase duties`.
  `dutiesForPhase`'s extraction generalizes into `packSubsection(pack,
  section, key)` (intent/load.ts); `dutiesForPhase` stays as the
  phaseDuties-keyed wrapper (M3's dutiesRef target).
- Injection: `renderSubtask` / `renderWhole` pre-render the subsection with
  the session ctx and inject `selfCheck`; the templates guard on
  `{{#if selfCheck}}` so a pack omitting the subsection drops the item
  cleanly (zero-intent baseline; the numbering caveat of 0032 D4 applies).

## 2. Decisions

| # | Decision | Content |
|---|---|---|
| D1 | Subsection addressing generalizes | `packSubsection(pack, section, key)` works on any section; `## quality` joins `## phase duties` as a subsectioned section. Text before the first `###` stays unaddressable (0032 D2 rule unchanged) — the M1.2-era flat `quality` body is re-anchored under `### decompose`, and prompt.ts/golden fixtures switch to the keyed form. |
| D2 | Two self-check keys, not one | The two sentences differ in scope noun ("该子任务" vs "完成整个任务后"); two keys keep F9 byte-equivalence without growing a pack-level variable convention. |
| D3 | Guard-style injection | `{{#if selfCheck}}…{{/if}}` wraps the whole item line (incl. its trailing newline), so zero-intent leaves no blank-line debris; surviving items keep their numbers (accepted in 0032 D4). |
| D4 | Marker tiers | Tier-1 = driver-enforced anchors (missing → startup usage error); tier-2 = intent content, marker-free by definition (lives in intent packs, never guarded). All existing PROTOCOL_MARKERS entries classify tier-1 (list in §3). New: `PARTIAL_MARKERS` guards the three protocol-bearing shared partials against `_partials.md` overlays. `registerTemplate`'s markers parameter is confirmed tier-1-only (doc/comment semantics, no signature change). |
| D5 | `_partials` registrable per section | `registerPartial(name, text, markers?)` registers/replaces one shared-partial section; whole-file `_partials` registration stays rejected (the error names registerPartial). Precedence mirrors templates: project overlay > registered > built-in; registrations survive `usePromptLibrary` reloads. |
| D6 | Known breakage, accepted per plan D4 | A project `_partials.md` overriding `state-rule` / `eof-rule` / `question-rule` without the tier-1 anchors now fails at startup (previously merged silently). In-repo users: the two test fixtures updated; external-overlay risk window called out, same class as 0032 D6. |

## 3. Marker classification (open question 3)

All template-level markers stay tier-1; each names its driver parse point:

| Template | Markers | Driver parse point |
|---|---|---|
| decompose ×7 | `- [ ]`, `context.md`, `todo.md` | subtasks.md checklist + artifact paths (shape checks) |
| final-task | `策略:` / `结论: 通过|差距` | parseConclusion |
| handoff-steer | `状态: 继续|完成` | handoffStatus |
| implement-plan / phase-plan | `## T-NNN: <任务标题> [pending]`, `PLAN.md` | PLAN.md format the driver re-parses |
| infer-source | `"sourceDir"`, `"blocked"` | JSON verdict |
| number-recovery | `.auto/next-task` | state file path |
| phase-handover | four section headings + `{{handover}}` | validHandover |
| review | `结论:` lines + `.auto/review.md` | parseVerdict |
| review-fix | `- [ ]` | fix.md checklist |
| test-wrapup | `{{handoffFile}}`, `不依赖本次测试结果` | handover sequencing contract (M2.2 re-anchors after the split) |
| verify-judge | `结论:` ×3 + `.auto/verify.md` + `verified-command` | parseVerdict + verdict file |
| verify-script-gen | `#!/usr/bin/env bash` | script protocol |

New partial-level tier-1 markers (`PARTIAL_MARKERS`):

| Section | Markers | Why |
|---|---|---|
| `eof-rule` | `<!-- auto: eof -->` | driver doc-shape anchor |
| `state-rule` | `PLAN.md`, `CURRENT.md` | state-file exclusivity surface |
| `question-rule` | `question 工具`, `AUTO-RESOLVE`, `AUTO-DECISION` | tool protocol + the marker lines src/resolve.ts scans |

Marker-free partials (deliberate): `head`, `ground-state`, `digest-rule`,
`doc-layout` — no driver parse target; an overlay reshaping them fails closed
downstream (driver-side path/shape checks), not silently.

Tier-2 = all intent-pack content (quality / phaseDuties / acceptance /
governance / artifactSpec): never marker-guarded.

## 4. Nested-segment split list (the "list first" deliverable)

Per-segment inventory of the nested (a)/(b) carriers. Splits execute in
M2.1/M2.2; line numbers as of this change.

### 4.1 `_partials.md` `## question-rule` → M2.1 (`## governance`)

`{{^ask}}` branch:

- KEEP (tool protocol): permission questions go to the question tool;
  non-permission questions must not; auto-answer note; repeat-question block.
- KEEP (tier-1 anchors): the marker line formats
  `AUTO-RESOLVE: <原问题> -> <所选方案> (<理由>)` and
  `AUTO-DECISION: <决策> (<理由>)` — driver-scanned.
- MOVE (governance intent): the recording discipline (decision rationale +
  rejected alternatives into docs); the ownership classification catalog
  (what belongs to the user vs to the session, with the matched/paired
  example); "同一决策只标一类、拿不准标 AUTO-RESOLVE".

`{{#if ask}}` branch:

- KEEP: permission protocol; auto-answer note; repeat-block.
- MOVE: the ownership classification catalog (asking variant: user-owned →
  ask, self-owned → decide without a trace; "拿不准就问").

Mechanics for M2.1: the partial needs an injection point (e.g. `{{#if
governance}}`) fed from the render exit (renderPrompt) since the partial is
shared by 22 templates; the core-side remainder keeps the tier-1 anchors.

### 4.2 `test-wrapup.md` → M2.2 (acceptance/quality)

- KEEP (handover protocol): the `[DRIVER]` framing; write `{{handoffFile}}`
  (overwrite); the content bullet list structure; the `状态: 继续` last-line
  contract; "写完立即结束会话".
- SPLIT (completeness demand, (b) nested in the (a) carrier): item 1's
  "把本执行范围内**不依赖本次测试结果**的剩余工作全部做完并落盘" — the anchor
  phrase stays (tier-1), the degree/anti-skip rationale moves to the pack;
  item 2's "**还没做完的事**" enumeration duty is likewise intent-grade
  completeness pressure riding the protocol list.

### 4.3 M1.3's own templates (post-change audit)

`subtask.md` / `whole.md` after this change: task framing, subtask-list
addressing, handoff/test protocols, doc-layout/eof/state-rule partials,
constraint list skeleton — all (a); the verify-mention clauses inside the
guarded items are process knowledge, not intent. No further nested segments.

## 5. Byte-equivalence evidence (F9)

- Golden snapshots: all unchanged (golden.test.ts green without
  UPDATE_GOLDEN; the decompose-generic fixture replicates the new keyed
  injection, snapshot bytes did not change).
- Exhaustive ad-hoc matrix diffed byte-for-byte pre/post change: decompose
  6 phases × fine on/off (12), subtask verify × index × warm × continuation
  × testByDriver × handoverTest (64) + solo form (1), whole verify ×
  ondemand × continuation × testByDriver (16) — 93 renders, identical.

## 6. Test changes

- `test/intent.test.ts`: built-in pack asserts the keyed quality subsections
  (decompose + both self-check keys); new `packSubsection` suite (suffix
  headings, unknown key, flat section unaddressable, absent section);
  dutiesForPhase wrapper pinned.
- `test/template.test.ts`: the state-rule overlay fixture now keeps tier-1
  anchors; new suite — partial-section marker rejection (state-rule /
  eof-rule / question-rule, marker-free sections still merge freely) and
  `registerPartial` (immediate render, reload retention, registered-vs-
  overlay precedence, markers guarding overlays, empty name/text rejected).
  The `_partials` whole-file rejection assertion follows the new message.
- `test/prompt-template.test.ts`: the question-rule overlay fixture keeps
  the tier-1 anchors.
- `test/prompt-exec.test.ts`: new M1.3 suite — built-in self-check sentences
  per template, project pack override replaces them (core protocol intact),
  zero-intent baseline drops the items cleanly (no tags / no blank debris);
  the M1.2 override fixture re-anchors its quality content under
  `### decompose`.

## 7. Verification

auto-core: 940 pass / 0 fail (929 + 11 new), `bun typecheck` clean;
packages/auto: 54 pass / typecheck clean, zero shell changes. Golden
snapshots untouched; 93-combo matrix byte-identical. Import-direction suite
green with no table edits (no new imports: prompt.ts already imported
intent/load + intent/types; template.ts unchanged).

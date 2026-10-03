# --auto-number auto numbering: design baseline and session handover

> This document is the design baseline for `--auto-number`. The main code and the follow-up work list (new tests, doc
> synchronization, build regression) are all complete and pass typecheck and the full test suite (2026-09-04).
> **Revision (2026-09-07, stable-refs P3 / D5)**: the `autoNumber` default flipped from `false` to
> `true` (`--no-auto-number` is retained as the opt-out switch); apart from the default the mechanism is unchanged, and phrasings below such as "default =
> `--no-auto-number`" and "default false" reflect the pre-flip historical baseline.

## Goals

Introduce a pair of boolean switches `--auto-number` / `--no-auto-number` (default = `--no-auto-number`,
preserving historical behavior):

- **--auto-number**: task numbers (T-NNN) **never repeat** in the target directory; when the key numbering record
  (.auto/next-task) is missing, an AI session can derive the appropriate next task number to recover the record.
- **--no-auto-number**: the status quo. Every phase-planning session renumbers from T-001 each phase, with no persisted record
  (in the phased workflow PLAN.md is reset to an empty template after each phase handover, so numbers repeat across phases/rounds,
  and the numbers in artifact filenames such as docs/T-NNN.*.md and in commit messages clash accordingly).

## Confirmed Decisions (decided by the user)

1. **Switch tier = init constitutional-level**: persisted into the `autoNumber` key of .opencode/auto/config.json
   (boolean, default false); init/continue accept this pair of switches (amend semantics), while any appearance on run means
   exit code 1 (the message points to revision guidance); both switches present with neither carrying `=false` is a usage error with exit code 1.
2. **Record store = the .auto/next-task state file**: its content is just one positive integer (the next available number).
  Maintained by the driver; .auto/ is already gitignored, so fresh clones naturally lack it → exactly what triggers the recovery flow.
3. **Recovery timing = recover first, then continue, when missing**: triggered lazily right before the phase-planning session (the planPhase
   entry point), not checked unconditionally at run start (m mode has no planning session, so the switch has no effect; init with
   that combination prints one ℹ notice).

## Mechanism Design

- **The phase-planning session is the only numbering consumption point**: planPhase first runs `ensureNumbering` to make sure the record is in place,
  then injects the record value into the phase-plan.md template as `numberStart` (`任务编号自 T-NNN 起连续递增,不得复用更早编号`, meaning task numbers increment consecutively from T-NNN and earlier numbers must not be reused,
  replacing the original 「自 T-001」 ("from T-001") wording); collect validates that all task numbers
  are ≥ the record start; reusing an occupied number counts as an invalid artifact and follows the requireArtifact "retry once with feedback,
  still failing means a silent block with exit 2" semantics; on success `advanceNextTask` advances the record to this run's maximum number
  +1 (increase-only, never decreasing).
- **Record recovery (ensureNumbering, src/numbering.ts)**:
  - The record exists and is a valid positive integer → use it directly;
  - Missing → first compute the deterministic floor `taskNumberFloor` (scan the current PLAN.md,
    the docs/phases/**/PLAN.md archives, and docs/**/T-*.md artifact filenames, taking the maximum number +1;
    a PLAN that fails to parse degrades to regex extraction over heading lines);
  - floor = 1 (no historical evidence at all, a brand-new project) → write 1 directly, without opening a session;
  - floor > 1 → open a one-shot side-channel AI recovery session (template number-recovery.md, pseudo-task PLAN,
    requireArtifact skeleton, commit stage=numbering); the AI can additionally inspect git commit history to discover
    numbers whose artifacts were deleted, writing the derived result into .auto/next-task; the driver validates the artifact against the floor
    (below the floor = invalid; retry once, and if it still fails, silently block).
- **T-F final-review numbers do not participate**: T-F<k> is a separate derivation namespace (existing final-review task count +1)
  and never enters the auto numbering record (taskNumber only accepts `T-<纯数字>`, pure digits).

## Completed Changes (file-level)

- `src/config.ts` — `ProjectConfig.autoNumber` (default false), the validateProjectConfig
  boolean validation, and the formatProjectConfig conditional section 「· 自动编号 on」 (auto numbering on).
- `src/index.ts` — BOOLEAN_FLAGS gains auto-number/no-auto-number; the run freeze list
  gains both keys (with dedicated revision-guidance copy); the init branch gains the mutual-exclusion check + the explicit.autoNumber merge;
  init prints an ℹ notice when `autoNumber && phases === "m"`; runAll Opts injects
  `autoNumber: config.autoNumber`; usage copy (two command lines + the constitutional-level option list +
  one option description).
- `src/numbering.ts` (new) — NEXT_TASK_FILE / taskNumber / readNextTask /
  writeNextTask / taskNumberFloor / advanceNextTask / ensureNumbering。
- `templates/prompts/number-recovery.md` (new) — the recovery-session prompt (floor input,
  evidence checklist, hard artifact protocol); `src/template.ts` registers it as embedded +
  PROTOCOL_MARKERS([".auto/next-task"])。
- `src/prompt.ts` — renderPhasePlan gains `numberStart?: number` (rendered as the zero-padded
  T-NNN number field); new renderNumberRecovery({floor}).
- `templates/prompts/phase-plan.md` — conditional section for the numbering start (`{{#if numberStart}}` /
  `{{^numberStart}}`)。
- `src/loop.ts` — runAll Opts gains `autoNumber?`; planPhase wiring (ensureNumbering
  → numberStart injection → collect reuse check → advanceNextTask advancing with logging).
- `AGENTS.md` — one entry added to each of the constitutional-level option list and the navigation.
- Existing test snapshot fixes (not new tests): the two full-key config assertions in test/e2e.test.ts gain
  `autoNumber: false`; the test/template.test.ts template-list assertion goes 18 → 19 and adds
  "number-recovery"。

## Verification Status

- `bun typecheck` passes; `bun test` 273 tests (271 pass + 2 e2e conditionally skipped) all green.
- Manual smoke: init --auto-number persists the config and prints the 「自动编号 on」 (auto numbering on) summary plus the phases="m" notice;
  run --auto-number exits 1 with the correct message; both switches present exits 1; --no-auto-number amends
  back to false; taskNumberFloor/advanceNextTask/rendering all verified.
- `bun run build` passes; the new template number-recovery is confirmed embedded in the standalone binary (dist/opencode-auto).

## Follow-up Work List (all completed)

1. **New tests** (written; bun test runs from packages/auto):
   - `test/numbering.test.ts` (new file): taskNumber boundaries (T-F1/non-numeric), readNextTask
     illegal content, taskNumberFloor (empty directory / current PLAN / archived PLAN / docs artifacts / parse-failure
     degradation / T-F non-participation), advanceNextTask increase-only, ensureNumbering pure-function surface
     (existing record used directly / floor=1 writes 1 directly).
   - config.test.ts: autoNumber defaults to false, illegal values (non-boolean) fail strictly, merge amend
     semantics, and the formatProjectConfig 「自动编号 on」 (auto numbering on) conditional section.
   - e2e.test.ts: init --auto-number persists true, --no-auto-number overrides back to false,
     both switches present (init/continue) exits 1, run --auto-number/--no-auto-number exits
     1 with the message carrying the paired revision guidance, the phases = "m" notice, and =false treated as not given.
   - prompt.test.ts: renderPhasePlan numberStart on/off two-state copy,
     renderNumberRecovery protocol content (.auto/next-task, floor raw value and zero-padding, git-history
     evidence, hard artifact protocol); usePromptLibrary(undefined) reset before rendering.
   - The collect number-reuse check and record advancement in loop/planPhase would spin up sessions, so they are not covered (only the
     pure-function surface is tested, per the established trade-off).
2. **Doc synchronization** (completed): README.md (the breaking list, the config-table autoNumber row, the init
   option table, the per-round revision list for continue, and the 「自动编号」 ("auto numbering") behavior description at the end of the phased-workflow section),
   docs/behavior.md (the constitutional-level option enumeration line gains both keys, a new --auto-number behavior-contract entry,
   numbering added to the unified-commit PLAN pseudo-task label list, template count 18→19 and number-recovery added to the
   protocol-sensitive template list), docs/structure.md (entries for src/numbering.ts and this design document,
   template count 19, autoNumber descriptions added to the index.ts/config.ts/prompt.ts/loop.ts/template.ts
   entries, and the pseudo-task label list of the git.ts entry), src/git.ts comments (the Auto-Stage pseudo-task stage
   label); templates/README.md has no option/template-count description, so no sync needed.
3. **Build regression** (completed): see "Verification Status" above.
4. Full-text searches for 「18 个」 (Chinese for "18 items") and "auto-number" confirmed no missed descriptions.

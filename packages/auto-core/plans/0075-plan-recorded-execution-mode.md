# 0075 — Plan-recorded execution mode (scoped "intelligent decomposition")

Status: **proposal, 2026-10-03.** Follow-up feature per the person's ruling of 2026-10-03
(enters via `plan --append` behind its own design doc + ruling). Covers original
requirement 4, scoped: execution-behavior parameters should get smarter — but by the
planning session **recording** its decision in the task documents, not by the driver
deciding ambiently. Ruled 2026-10-04: all three rulings accepted as recommended (§5).

## 1. Why scoped

The original ask — "delegate `--subtask off/true/ondemand/auto` to plan; other parameters
follow suit" — runs into two constitutional facts:

- `--subtask auto` is already the adaptive default, and the decomposition decision is
  already per-task (the lead session decides whether to split under the driver's guard,
  plans/0059 D2–D4). What `off`/`true`/`ondemand` add is escape hatching for capability
  degradation (`leadSplit: false`), deterministic tests, and deliberate pipeline control.
- The driver is the deterministic process layer (0064): it judges grammars it defines,
  never content. "Intelligent" defaults that decide per run, ambiently, would make the
  pipeline shape unauditable and untestable — and 0069 §3.3 verified every remaining
  flag has live consumers, so there is no dead-knob bloat to remove.

The synthesis that keeps both: **plan writes the decision as a document field; the
driver executes it mechanically.** The intelligence lives in a session (where it
belongs), the decision becomes an auditable artifact, and determinism is preserved
because the driver still only reads grammars.

## 2. Proposal — one unit

1. **Grammar**: a task's `todo.md` gains an optional field line beside `Phase:`, e.g.
   `Decompose: split | whole | pipeline` (exact name and value set are a ruling;
   `split` = today's auto behavior for that task — lead + streams; `whole` = one
   ondemand session to completion; `pipeline` = the planned decompose pipeline).
   Parsed by the unified unit model (`src/document/unit.ts` field-block reading),
   validated by `unitProblems` (unknown value = load failure, like every other grammar).
2. **Producer**: the decompose/planning role prompts (descriptor-owned since T-123) gain
   the duty: choose the execution mode per task from scope/context evidence and write
   the field; absent field = no opinion. The choice is a recorded decision — the
   template tells the session to weigh task size, dependency shape, and expected
   session-count, and the field line is the artifact.
3. **Consumer**: `--subtask auto` consults the field per task — present: obey it;
   absent: today's adaptive logic unchanged. `off`/`true`/`ondemand` stay hard overrides
   that ignore the field (degradation and test determinism keep their lever).
4. **Observability**: the round conclusion's per-task lines record which mode each task
   ran under and whether it came from the field or the fallback (one line, existing
   `conclusion.ts` pattern), so the falsifier evaluation can judge whether the planning
   sessions' choices were any good.

## 3. What is explicitly not in scope

- No removal of `--subtask` values or any other flag; no ambient per-run re-deciding;
  no "all parameters intelligent" pass (rejected in the 2026-10-03 assessment — the
  two-tier switch design and the constitutional-attribute principle, plans/0052, stand).
- Phase types and verification/knowledge phases get no per-task mode (implementation
  tasks only).

## 4. Risks

- The field is advice the driver must be able to contradict safely: capability
  degradation (`leadSplit: false`) silently downgrades `split` to `whole` — the
  downgrade is logged, never blocks (the existing `degrade`/`clampSwitches` pattern).
- Prompt-copy change is in scope for this unit (decompose role duty), so the prompt
  goldens and `test/prompt-*.test.ts` are updated in the same unit — the one follow-up
  that touches templates; the change is additive (a new duty paragraph), not a
  consolidation, so it does not collide with 0072's audit if that lands first.

## 5. Rulings (decided 2026-10-04 — all as recommended)

1. Field name and value set (`Decompose: split|whole|pipeline` proposed)?
2. Absent-field fallback = today's `auto` logic (recommended)?
3. Keep hard overrides ignoring the field (recommended)?

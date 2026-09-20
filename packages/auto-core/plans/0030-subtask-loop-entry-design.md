# 0030 Subtask-loop entry redesign (M1.0): merged understand+decompose session, subtask-dir state protocol, DRIVER self-reference

> Milestone M1.0 of `plans/AUTO_NEXT_REFACTOR_PLAN.md` (root), implementing D11.
> Stage-assisting document per D6: retires as history once the refactor closes.
> Open question 14 was user-confirmed on 2026-09-20 exactly as proposed in
> root `plans/0001-auto-next-design.md` §4-14; this document fixes the remaining
> implementation-level decisions.

## 1. Scope

Three workpieces (D11):

1. **Merged understand+decompose session** — one session produces task
   understanding (context.md, four sections), the shared context
   (shared.md, new), the subtask decomposition (subtasks.md checklist), and one
   scope file per subtask (`S<nn>/todo.md`).
2. **Subtask-directory state protocol** — decomposition writes
   `docs/T-NNN/S<nn>/todo.md`; on subtask completion DRIVER renames it to
   `done.md` inside the unit commit boundary. File existence is the progress
   fact; "both exist" / "neither exists" (while the protocol is active) are
   illegal states and must be detected.
3. **DRIVER self-reference** — the tool calls itself DRIVER in all AI-facing
   session templates and inline prompts (incl. the `[driver]` interjection
   prefix → `[DRIVER]`).

## 2. Decisions

| # | Decision | Content |
|---|---|---|
| D1 | Merged session is unconditional | In `--subtask auto` mode with no checklist in the task body, the merged session always runs — independent of `OPENCODE_AUTO_FORK`. The fork switch now only controls whether subtask sessions fork from a base, not whether understanding happens. |
| D2 | Phase union migration | `resume.ts` `Phase` loses `{kind:"understand"}`; the merged unit is `{kind:"decompose"}`. `parseProgress` maps legacy `"understand"` records to `"decompose"` at read time (compatible read, D4 of the plan). Reuse/exemption/handover semantics unchanged. |
| D3 | Merged-session artifacts | `context.md` (four sections, unchanged semantics; if it already exists and is still accurate the session revises rather than rewrites — covers resumes from pre-merge records), `shared.md` (shared-context **reference index**: one line per prefetched file/symbol with a one-sentence locator; subtask sessions read referenced files on demand — the prompt injects only the path), `subtasks.md` (checklist, remains the subtask index that the driver parses and injects into PLAN.md), and `docs/T-NNN/S<nn>/todo.md` per subtask (scope statement + artifact list, aligned with the item's `产出:` declaration). |
| D4 | Fork base | Session-mode base = the merged session itself (`setForkBase` after its success, previously the understand session). Digest mode unchanged: `context.md` full text → context-base session. |
| D5 | State protocol activation | The protocol is **active for a task iff any `todo.md`/`done.md` exists** among its subtask directories. Inactive (legacy decompositions, human-written checklists, off/ondemand modes) → checklist ticks remain the progress fact, zero behavior change. |
| D6 | Illegal states | With the protocol active: per subtask, exactly one of `todo.md`/`done.md` must exist. Both → blocked (ambiguous). Neither → blocked (drift). Detection points: subtask loop entry (runner) and subtask close-out (rename is idempotent). |
| D7 | Rename inside the commit boundary | Close-out order in `runSubtask`: artifact shape checks pass → rename `todo.md`→`done.md` (idempotent: skip when `done.md` already exists — interruption between rename and commit) → `tick` → `writeCurrent` → `afterSession` with the unit baseline. The rename lands in the same unit commit. |
| D8 | Existence short-circuit | `runSubtask` entry: protocol active and `done.md` already present → skip the session entirely and go straight to close-out (tick + commit). Covers interruption windows around the rename without re-running finished work. |
| D9 | Review-fix injected items | `injectFix` (review fix rounds) writes a minimal DRIVER-authored `todo.md` per appended item (item text as scope; checklist item remains the authority), keeping the invariant "every checklist item has exactly one state file" uniform. |
| D10 | Progress derivation | One derivation point: runner computes effective checklist items (done flags overridden by `done.md` existence when the protocol is active) and feeds them both to the subtask loop and to `unitReruns` (`UnitRerunCtx.items`). Tick drift is reconciled to the file state at loop entry (files win; PLAN.md display follows). `unitReruns` case `decompose` simplifies to `mode==="auto" && no checklist && no subtasks.md items` (context.md no longer gates — the merged session covers both). `UnitRerunCtx.contextExists` is dropped. |
| D11 | todo.md/done.md shape | Both reuse the existing shape checks (non-trivial ≥120 chars + terminal `<!-- auto: eof -->` line) — enforced at decomposition time (the merged session writes todo.md; the rename carries the content unchanged). Neither file enters `eofScanExempt`. Sessions must never create/rename `todo.md`/`done.md` themselves (exclusivity clause in templates, same pattern as the testhandoff naming family). |
| D12 | Model routing | `MODEL_ROLES` drops `understand`; the merged session routes under `decompose`. Env configs using the `understand=` key now fail strict with a clear error (staged breakage per plan D4). |
| D13 | DRIVER rename | AI-facing text only: all `templates/prompts/*.md`, `templates/.opencode/agent/auto.md`, `templates/PLAN.md`/`PLAN.scaffold.md`, the AGENTS.md injection block (agents-block.ts), and inline session-bound strings (`[driver]` → `[DRIVER]`, `driver` → `DRIVER` in resume notes / feedback / steer / probe texts). Human-facing logs and `templates/README.md` keep lowercase "driver". Language of the text bodies stays Chinese; English translation folds into M1.5 per plan D7. |
| D14 | understand.md template | Retired from the embedded registry (the decompose family becomes the merged template). Target-dir overlays of `understand.md` become inert (no renderer references the name). |

## 3. Consequences / touch map

- `src/execute.ts` — `ensureUnderstood` deleted; `ensureDecomposed` becomes the merged unit (validates context.md + shared.md + subtasks.md items + per-item todo.md; single feedback-retry loop via `forkEndedSession`; sets fork-base on success; drops the `base` seeding param).
- `src/runner.ts` — auto branch: one `persistStage({kind:"decompose"})` + merged ensure, then `ensureForkBase`; subtask loop derives effective items via the state protocol; `injectFix` writes todo.md files.
- `src/subtask-state.ts` (new, document domain per import-direction table) — protocol activation, per-subtask state, illegal-state listing, idempotent rename, injected-item todo writer.
- `src/docpaths.ts` — `subtaskDoc` roles gain `"todo" | "done"`.
- `src/resume.ts` / `src/resume-gate.ts` / `src/chain.ts` / `src/switches.ts` — phase/role migration per D2/D10/D12.
- `src/prompt.ts` — `renderUnderstand` deleted; `renderSubtask` injects the todo.md path; `renderDecompose` unchanged in shape (merged templates).
- `templates/prompts/` — decompose family restructured (understand + shared-context + todo.md steps); `understand.md` deleted; `_partials.md` (decompose-rule renumbering, doc-layout state-file clause); `subtask.md` (todo.md/shared.md references); DRIVER rename everywhere AI-facing.
- `src/template.ts` — embedded registry/markers drop `understand`; decompose markers gain `context.md` / `todo.md`.
- Tests + goldens regenerated (`UPDATE_GOLDEN=1`); new coverage for the merged unit and the state protocol (incl. illegal states and rename interruption windows).

## 4. Non-goals (later milestones)

- Intent extraction of the decompose split rules into intent packs → M1.2.
- Artifact-spec-driven validation (todo.md content cross-check against `产出:`) → M1.4.
- English translation of the touched templates and protocol strings → M1.5 (registered there).
- `document/roles.ts` role model → M2.3.

# 0044 Completion-side retirement: verify / review / final-review (M2.2)

Root plan item M2.2 (`plans/AUTO_NEXT_REFACTOR_PLAN.md`, decision D13). The
three completion-side mechanisms are deleted outright, code and CLI surface,
not switched off:

1. `--verify`: task-level three-stage acceptance (script prep → driver run →
   independent judge session), the `verified` field, fix/re-verify rounds.
2. `--review N`: the post-task quality audit (audit session + planfix/fixrun
   rounds), with its modifiers `--early` / `--early-review`.
3. `--final-review N`: the final-review loop (auto-appended `T-F<k>`
   audit/remediate/validate/finalize tasks, the `final:` field).

A task completes on wrap-up plus the unified commit. The replacement for the
checking half is planned work: `--test-by-driver` keeps script execution out of
the session, a planned task is already an independent session, and the `v`
(acceptance) phase takes over the final review. The replacement for the
missing *consequence* half is §3, "FAIL stops the run".

Retained unchanged: `--test-by-driver`, `--handover-test`, the wrap-up
session, the unified commit, `refcheck` and the `check` subcommand, the `v`
phase letter.

## 1. Rulings (root open question 16, 2026-09-21)

The user ruled "use your recommendations for all" on the four open items; ⑥
was settled earlier the same day.

| # | Item | Ruling |
|---|---|---|
| D1 | Retired CLI flags | `--verify`, `--review`, `--early`, `--early-review`, `--final-review` are a usage error (exit 1) on every command, with a message pointing at planned acceptance tasks / the `v` phase. Same shape as the `--commit false` retirement (2026-09-15). `OPENCODE_AUTO_MODEL` role keys of the retired sessions (`verify-*`, `review-*`, `final-plan`) fail the existing strict unknown-role check, like `understand=` did at M1.0. |
| D2 | config.json `verify` key | `verify: true` fails strictly with a "retired" message (the project asked for acceptance that no longer runs; silently ignoring it would hide that). `verify: false` and an absent key are accepted and ignored: init has written `"verify": false` into every config so far, and rejecting it would break every in-flight project for no gain. init no longer writes the key. |
| D3 | PLAN.md legacy fields `verify:` / `verified` / `final:` | Read-compatible and ignored. `Task` loses the three properties; `edit()` already keeps unknown field lines verbatim, so the lines survive untouched and nothing is rewritten. |
| D4 | Unfinished `T-F<k>` tasks | Run as ordinary tasks. The heading regex already accepts the id, and the task body is the proposal the generation session wrote, which is a normal task description. |
| D5 | `.auto/progress.json` stopped in `verify` / `review` | Both kinds only occur after wrap-up, so the record is mapped on read to the new `closeout` phase (§3.2): wrap-up is skipped, the result line is checked, the task is marked done and committed. A legacy `review` record whose task is already `[done]` stays done (the start-up revert to `in_progress` in loop-preflight is deleted with review). |
| D6 | Leftover `.auto/verify.md`, `.auto/review.md`, `tmp/verify.*` | Left in place. Both directories are driver-local and git-ignored (`src/gitignore.ts`); cleanup code would outlive its purpose. |
| D7 | Old watchdog names `verifyIdle`/`verifyMax`, `--verify-idle`/`--verify-max` | Kept. They alias the retained watchdog (`idleTime`/`idleMax`), not the retired mechanism; only the wording that says "verify and test scripts" drops "verify". |
| D8 | migrate shell (`packages/auto-migrate`, migrate branch) | Not touched on auto-next (D9 freeze). It passes `review`/`verify`/`finalReview` through; that is logged as an issue and fixed when M6.2 refreshes the migrate shell. |
| D9 | FAIL stops the run (⑥, settled) | (i) the result line lives only in `docs/T-NNN/report.md`; (ii) literal `Result: PASS` / `Result: FAIL <reason>`, no line = no stop; (iii) on FAIL the work is committed, then the task is blocked; (iv) a person edits PLAN.md before re-running, the driver never decides on its own. |

## 2. Deletion surface

| Area | Removed | Kept / moved |
|---|---|---|
| Modules | `src/review.ts` (verifyTask, reviewTask, planReviewFix, parseVerdict), `src/final.ts` (routeFinal, generateFinalTask, appendFinalTask, parseConclusion, parseStrategy) | `src/verify.ts` becomes `src/script.ts`: the watchdog executor and `tmp/` location are shared with `--test-by-driver` (`testrun.ts`, `exec-session.ts`, `prompt.ts`). Renamed `runScript`, `scriptTmpDir`, `DEFAULT_SCRIPT_IDLE_MS`, `ScriptRunResult`; `resolveVerifyScript` and `VerifyScript` are deleted. `VerifyRun` becomes `ScriptRun`. |
| Pipeline | runner.ts verify/review/final/`v` exemption branches, `injectFix`, the review round loop; loop-task.ts `advanceFinal` and its two hooks; loop-phase.ts final-review notice and pass-through; loop-preflight.ts `--early` note and the review-phase revert | the `v` phase itself |
| State | `Phase` kinds `verify` and `review`, `AuditVerdict`, `RunRecord`; `FIX_ROUNDS`, `REVERIFY_ROUNDS`; `unitReruns` ctx `verify`/`review`; `phaseText`/`nextStepText` cases; `chain.ts` role mapping for both kinds | new `closeout` kind (§3.2) |
| Protocol files | `VERDICT_FILE` (`.auto/verify.md`), `REVIEW_FILE` (`.auto/review.md`) | — |
| PLAN.md | `Task.verify`/`verified`/`final`, `verifyCommand`, `parseFinalMark`, `appendTask` (only final used it), `markDone`'s `verified` argument | unknown field lines preserved (D3) |
| Docs paths | `TaskRole` `audit`/`fix`, `finalDoc` | — |
| Templates | `review.md`, `review-fix.md`, `verify-judge.md`, `verify-script-gen.md`, `fix.md`, `final-task.md` and their goldens; every `{{#if verify}}` branch (`_partials.md` state-rule, `PLAN.scaffold.md`, `PLAN.md`, phase-plan, phase-handover, implement-plan, subtask, whole, wrapup, agent contract, mode `init`); `PROTOCOL_MARKERS` entries of the six | — |
| Modes | `ModeSpec.final`; the three `## final: *` sections leave the required set | a project mode file that still carries them loads; the sections are ignored |
| Config / CLI | `ProjectConfig.verify` (D2), `Opts.verify`/`review`/`early`/`finalReview`, `RunAllOpts` same, `MODEL_ROLES` verify/review/final entries; shell flags (D1), help text, `isPristinePlan`'s verify checks | watchdog keys and aliases (D7) |
| Agents block / check | `VERIFY_PRINCIPLE`, the verify-principle patterns of `check`, the `verifyOn` report fields | the test-by-driver principle, reference scan |
| refcheck | the verify gate's task-doc prescan (`gatedTaskRefGap` and the P4 scan it calls, if nothing else uses it) | pre-commit auto-correct, `check` subcommand |
| Tests | `review.test.ts`, `final.test.ts`, `verify.test.ts` → `script.test.ts` (executor cases only), `prompt-verify.test.ts` (verify cases), verify/review/final cases elsewhere | import-direction allow table updated |

Historical plans (0005 final-review design and others) are not edited (D6).

## 3. FAIL stops the run

### 3.1 Protocol and discipline

Core wrap-up template (item 3, replaces the old verify sentence) tells the
session where and how to write the line: the literal `Result: PASS` or
`Result: FAIL <one-line reason>` as the last content line of the report,
before the eof marker, written verbatim and untranslated. When to write it and
what counts as FAIL is (b)-class content: `## acceptance` / `### result-line`
in the intent pack, injected as `resultRule`. A pack that omits the subsection
drops the whole instruction, so the zero-intent baseline is "never stops".

Registration (0035 procedure, MP.1 reading): new English literal, no Chinese
predecessor, so no dual-read. Tier-1 guard: `PROTOCOL_MARKERS.wrapup =
["Result: PASS", "Result: FAIL"]`.

Parser `parseResult(text)` in `src/wrapup.ts` (`reportResult` reads the
report and applies it): the last line starting with `Result:` (after trimming)
decides; `PASS`/`FAIL` as a whole word is the verdict and the rest of the line
after optional separators is the reason; any other value on that last
`Result:` line is no verdict (no stop). Case-sensitive, like the other
protocol lines.

### 3.2 Pipeline

After the wrap-up stage the runner persists `{ kind: "closeout" }` and reads
`docs/T-NNN/report.md`:

- no report or no result line, or `PASS`: `markDone` → completed (unchanged
  path, the loop makes the `done` commit);
- `FAIL`: the chain phase is set to `wrapup` and the runner returns
  `blocked` with the reason. The loop's existing blocked path writes
  `[blocked]` and makes the `interrupted` commit; the wrap-up session's own
  commit already put the report into git, so (iii) holds.

The check runs whether or not the wrap-up session ran (`--no-wrapup`): a
report written by the task itself is read the same way.

Re-run after FAIL: a person edits PLAN.md first (iv). Accepting the failure
means marking the task `[done]`; getting the gap fixed means inserting fix
tasks before it, which run first (a hand-added checklist item is not an
option in auto mode: it has neither `todo.md` nor `done.md`, which the
subtask state protocol treats as illegal and blocks on). The persisted phase
is `wrapup`, so re-running the blocked task itself skips the whole-task
session (off/ondemand; auto's decompose and subtask loop are idempotent) and
runs wrap-up again, which rewrites the report and its result line. When a
fix task ran in between, its own progress record replaces this one and the
blocked task starts from the top: in auto mode that still reaches wrap-up
directly (every subtask is done), in off/ondemand mode the whole-task session
runs again first. The driver never
flips the status itself.

Resume with phase `closeout` (interrupted between the wrap-up commit and the
`done` commit, or a legacy `verify`/`review` record per D5): wrap-up is
skipped, the result check runs, the task completes. `unitReruns` returns
false for `closeout` (no session belongs to it).

### 3.3 Incident regression

One case: a task whose report ends in `Result: FAIL` blocks, the later task is
not executed, the report is committed.

## 4. Deferred

The two residuals of the old M2.2 (test-wrapup completion sentence split, P1
prompt discipline in `## governance`) are unrelated to D13 and move to the
front of M2.3.

## 5. Verification

- `bun typecheck` and `bun test` in `packages/auto-core` and `packages/auto`.
- Golden diff only on the deletion surface and the wrap-up item 3 change.
- The five retired flags exit 1 with the retirement message.

<!-- auto: eof -->

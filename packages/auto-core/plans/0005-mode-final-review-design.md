# --mode mode layer and --final-review final review loop -- design notes

> **Status (2026-10-02 correction, `plans/0069` §4.2 A3): both capabilities have been implemented. `--final-review`
> final review loop was deleted wholesale by `plans/0044` (retired on the completion side, ruled 2026-09-21) -- per its D1, the flag
> is a usage error on all subcommands (exit code 1), and the mode layer's `final:` three sections were retired in the same batch; `--mode`
> mode layer is still in operation (`src/mode.ts`), its shape having evolved into file-template registration (`templates/modes/` and
> project overlay). This document is a historical design record, preserved as-is below.**

> This document is the sole design baseline for the `--mode` mode layer and the `--final-review` final review loop: implementation tasks
> defer to it; older conventions that conflict with it (the existing semantics of `--review`'s final review escalating to a `docs/final-audit.md`
> single-session full audit remain unchanged -- the final review loop is an independently added mechanism and does not modify it) defer to this document.

> **Revision (the final review does not re-verify the verification)**: final review tasks (T-F\<k\>, all four stages), per the final field,
> force review=0 and skip task-level three-stage acceptance (`--verify` has no effect on them); tasks no longer write the verify
> field, and the `verify:` line in proposals is compatibility-stripped and always ignored; a missing report / illegal protocol is backstopped by the
> brokenReport block at routing-parse time (exit code 2, manual inspection), and there is no longer self-healing via a repair round that
> structurally checks verify. Descriptions below that conflict with this revision (structural verify checks, protocol self-healing,
> remediate/finalize participating in per-task review, etc.) defer to this revision.

## Background and motivation

1. **Mode layer**: across different scenarios (migration, optimization, new implementation, testing), the prompts for plan initialization and
   each execution stage have different emphases (e.g. migration stresses "external behavior unchanged, old/new equivalence"). The current prompts have no scenario concept;
   what is needed is a lightweight mode layer that does not affect the driver's scheduling state machine, with zero scheduling changes for new modes.
2. **Final review loop**: the existing `--review` final review (the final audit of the last task) is a single-session full audit
   with no repair loop after the report is produced; gaps found by the audit can only be handled manually. What is needed is a task-driven,
   multi-stage final review process (Audit → Refactor/Patch → Validate → Finalize, with Validate able to fall back
   to Audit) that also brings "problems found by the final review" into the driver-driven decompose/execute/accept loop, and gains
   breakpoint-recovery capability consistent with ordinary tasks.

## Confirmed decisions

| Decision point | Conclusion |
| --- | --- |
| CLI shape | `--final-review [n]` as an independent option (composable with `--review n`: per-task review as usual + final review loop; used alone, final review only). `--review-level` is not adopted (it would break `--review`'s existing numeric semantics and parsing); no `--final` modifier is introduced (meaningless on its own, and the double spelling would only add parsing branches) |
| n semantics | the cap on audit rounds (including the first Audit round, i.e. the maximum number of Audit→Remediate→Validate cycles); default (option absent) 0, not enabled; bare option = 2; an explicit value must be an integer in 1..5, otherwise usage error (exit code 1) |
| Fallback circuit breaker | Validate gap with audit rounds exhausted → write the residual gaps into PLAN.md as a blocking problem (block the last validate/audit task) and exit code 2; **no Manual_Escalation task is generated** -- human intervention in this package is a halt event rather than a task, and "a task for humans to read" would leave the verify/wrap-up/check-off semantics spinning idle; the residual-risk list is already in the audit/validate report, so the blocking problem need only reference the file pointer |
| Audit report structuring | reuse this package's "last-line conclusion" Chinese protocol instead of JSON (a free-form session produces stable JSON less reliably than a "last-line conclusion", and parseVerdict already has a mature parsing shape): the audit report's last two lines `结论: <概述>` (conclusion: <summary>) and `策略: 重构\|修补\|无` (strategy: refactor\|patch\|none), parsed by the driver's regex for deterministic routing |
| `策略: 无` (strategy: none) routing | go straight to Finalize, **skipping Remediate and Validate**: Audit is itself a global check, and with no remediation there is nothing to validate; the original tasks already have task-level verify as a backstop |
| Validate routing | report last line `结论: 通过` (conclusion: pass) (→ generate the Finalize task) or `结论: 差距 <描述>` (conclusion: gap <description>) (→ fall back to Audit, subject to the round cap); no separate "suggestion" field -- the conclusion is the suggestion |
| Mode layer shape | a typed registry in `src/mode.ts` (in the spirit of the strategy pattern), not prompts/ directory templates: prompts are TS function composition (with runtime parameters: paths / fields / context), while templates/ only carries init copies and each file must be imported `with { type: "file" }` to be embedded in the binary -- directory templates conflict with both. Adding a mode = adding one fully typed entry, zero driver changes |
| Final review stage vehicle | real tasks in PLAN.md (`T-F<k>` ID + `final: <stage>@<round>` field marker), reusing the full runTask pipeline (decomposition / subtask sessions / wrap-up / CURRENT.md / progress recovery / commit tier; task-level acceptance and per-task review are forcibly skipped per final), with the driver being only a "generate task → run task → parse report and route" state machine |
| Per-task review of audit/validate tasks | **(Revision)** all final review tasks skip per-task review and task-level three-stage acceptance -- the final review stages are themselves the verification, and the verification is not re-verified (nesting review/acceptance wastes sessions and muddles the semantics): inside runTask, the final marker forces review=0 and turns verify off (straight to done after wrap-up); repair quality inside the loop is backstopped by the same round's validate regression check |
| Artifact location | `docs/final/` (audit-r\<N\>.md / refactor-r\<N\>.md / patch-r\<N\>.md / validate-r\<N\>.md / finalize.md / plan-\<stage\>-r\<N\>.md proposals), steering clear of the existing final review report `docs/final-audit.md` (the product of `--review`; no naming conflict) |
| Global single-session invariant | kept: the final review loop is serial throughout (generation session → task session), with no parallel window and no worktree needed |

## A. Mode layer (`-m/--mode`)

### A.1 Registry `src/mode.ts`

```ts
export type ModeSpec = {
  name: string
  // The mode preamble for renderInit: scenario definition, task arrangement principles, verify emphasis
  init: string
  // Mode caveats appended to execution prompts (decompose / whole task / subtask / wrap-up)
  exec: string
  // The emphases of each final review stage's prompts
  final: { audit: string; validate: string; finalize: string }
}
export const MODES: Record<string, ModeSpec> = { migrate: { ... } }
```

- V1 registers only `migrate` (migration/upgrade: premised on keeping external behavior unchanged, tasks arranged as "baseline confirmation →
  migration changes → regression verification"; verify prefers reusing existing test/build commands; final review audit emphasizes
  old/new behavioral equivalence and leftover old paths, validate emphasizes regression coverage, and finalize emphasizes cleaning up the old
  implementation and wrapping up compatibility layers). `optimize/implement/test` are established extension names; unregistered means unavailable.
- `resolveMode(name): ModeSpec | undefined`; an unregistered name at the CLI → usage error with exit code 1,
  the message listing the currently supported modes.
- The copy is prompt-level guidance with no scheduling semantics; assert its injection in prompt.test.ts during the implementation task.

### A.2 CLI wiring

- `-m/--mode <name>` goes into VALUE_FLAGS (`src/index.ts`), adding the short option `-m` (mirroring `-p`'s
  value-swallowing rule); both `init` (acting on renderInit) and `run` (passed through Opts to the runner) accept it,
  with default `migrate`.
- Persistence: not done in V1 (with only one mode there is no divergence); the README notes that init and run should use the same
  mode. A PLAN.md header comment stamp (`<!-- opencode-auto-mode: migrate -->`) is listed as a later optional item.

## B. `--final-review [n]` final review loop

### B.1 Option semantics and combination matrix

`parseFinalReviewLimit` mirrors `parseReviewLimit`'s style: default 0, not enabled; bare option 2;
an explicit value must be an integer in 1..5, otherwise usage error with exit code 1. The usage text is updated to match.

| Combination | Semantics |
| --- | --- |
| `--final-review` alone | no per-task quality review; the final review loop is entered after all original tasks complete |
| `--review n` + `--final-review [m]` | per-task review as usual; the final review loop runs after all tasks complete |
| `--early` / `--early-review` | affects only the per-task review window, no interaction with the final review; `--early-review` and `--final-review` may co-occur |
| `--dryrun` | tasks are not executed; the final review is not triggered |
| `--commit once` | the wholesale commit stays at its existing position after the final review ends entirely (changes produced by the final review loop itself are committed with it) |
| `--subtask off/ondemand` | final review tasks follow the global tier; final review tasks do no task-level acceptance, so there is no verify-gap rollback path (report anomalies block at routing) |
| `--wait-between` | also in effect between final review tasks (same as ordinary tasks) |

Exit codes: a final review task blocked/incomplete → the existing exit code 2 semantics; circuit breaker → 2 (blocking written into
PLAN.md); Finalize complete → 0.

### B.2 State machine and pipeline

Core mechanism: final review stages are real tasks in PLAN.md, naturally executed by the main loop's `next()` in file order
(appended at the end of the file); the driver's final review state machine is a **pure function** of `(the final-marked tasks in PLAN.md and their states,
the docs/final/ artifacts)`, with no newly persisted state.

```
[all original tasks done](next() returns empty, final review not yet complete)
 → generation session (one-off bypass, requireArtifact skeleton) produces the task proposal docs/final/plan-audit-r1.md
 → driver parses and appendTask: T-F1, field final: audit@1 (no verify field written)
 → main loop next() picks it up → runTask(T-F1) full pipeline (decompose/subtask/wrap-up; forcibly skips task-level
   acceptance and per-task review, straight to done after wrap-up)
 → runTask complete and the task carries the final marker → routing: parse the last line of docs/final/audit-r1.md
      策略: 无 (strategy: none) → generate Finalize task → execute → commit once (existing position) → exit 0
      策略: 重构|修补 (strategy: refactor|patch) → generate remediate task → execute
                       → generate validate task → execute
 → parse the last line of docs/final/validate-r1.md:
      结论: 通过 (conclusion: pass) → generate Finalize task → execute → complete
      结论: 差距 (conclusion: gap) → audit round < n ? generate an audit@<r+1> task focused on residual gaps → continue the loop
                  audit round ≥ n ? circuit breaker (block the last task, exit code 2)
      report missing / protocol line illegal → brokenReport blocks that task (exit code 2, manual inspection)
```

- Task ID `T-F<k>`: k = existing final review task count + 1, append order deterministic and collision-free (compatible with
  HEADING's `T-[\w-]+`); the `T-` prefix matches persistStage's progress-write condition (`src/runner.ts`),
  and an interruption inside a final review task goes through the existing recallProgress/peekProgress mechanism -- zero additions.
- Task titles carry a stage prefix (e.g. `终审审计(第 1 轮)` -- "final review audit (round 1)"), naturally visible to the status command.
- The routing hook after runTask completes and the final review kick-off hook when `next()` is empty are both wired into the `src/loop.ts`
  main loop; final review kick-off prints a banner (`banner("全部任务完成,进入终审闭环")` -- "all tasks complete, entering the final review loop").

### B.3 Task generation session `renderFinalTask(plan, stage, round, prior, mode)`

A fresh bypass session (it enters no task chain; it reuses the requireArtifact skeleton exported by the runner: a missing artifact
is retried once with feedback, and a second failure is treated as a silent block). Its inputs are upstream artifact pointers (audit/validate report paths,
the residual gap verbatim, an overview of all completed tasks), and it produces the proposal file `docs/final/plan-<stage>-r<N>.md`:

```
# <任务标题> (task title)

<任务正文:目标、范围、上下文、检查项由 runTask 的分解会话另行生成,不手写> (task body: goal, scope, context, and checklist are generated separately by runTask's decompose session, not hand-written)
```

(Revision: proposals no longer contain an optional `verify:` line -- final review tasks forcibly skip task-level acceptance, so the field is useless;
the line left over in old proposals is compatibility-stripped at parse time and ignored.)

- Each stage's emphasis is injected via `mode.final[stage]` (for migrate see A.1);
- The proposal body is the task's self-contained description: it plus CURRENT.md plus docs/ suffices to execute;
- Constraints: plan only, do not implement; reuse QUESTION_RULE / STATE_RULE; producing the proposal file is a hard requirement;
- The generation session for audit@r≥2 takes as input the validate gap verbatim + the previous round's report; the prompt requires focusing on
  the residual gaps and regression checks, not a full re-audit.

After the driver parses the proposal it calls `appendTask`: the ID / `final` field are decided by the driver, the title and body are taken from the proposal,
and no verify field is written (final review tasks forcibly skip task-level acceptance).

### B.4 Relationship between the report protocol and acceptance

- **audit task**: the body requires producing the audit report `docs/final/audit-r<N>.md`, whose last two lines are
  `结论: <概述>` (conclusion: <summary>) and `策略: 重构|修补|无` (strategy: refactor|patch|none).
- **validate task**: report `docs/final/validate-r<N>.md`, last line
  `结论: 通过` (conclusion: pass) or `结论: 差距 <描述>` (conclusion: gap <description>).
- **Report-anomaly backstop (Revision)**: final review tasks do no task-level acceptance; a missing or illegal strategy/conclusion line
  (usually a session omission or a manually edited report) is handled at the routing parse after runTask completes as brokenReport
  blocking that task -- exit code 2, prompting manual inspection (after fixing the report or editing/removing the final review tasks, state
  reconstruction re-routes); no repair-round self-healing.
- **remediate task**: report `docs/final/refactor-r<N>.md` / `patch-r<N>.md`,
  free-form body with no protocol; repair quality is backstopped by the same round's validate regression check.
- **finalize task**: wrap-up report `docs/final/finalize.md` (free-form body).
- Each final review task's wrap-up session still writes the `docs/T-F<k>.report.md` artifact summary as usual, coexisting with the stage report
  (summary vs conclusion; no conflict).

### B.5 Circuit breaker

Validate gap with audit rounds exhausted: `block(path, 最后的终审任务id, question)` (block(path, last final review task id, question)), where question is
`终审闭环连续 <n> 轮仍未通过,残余差距见 docs/final/validate-r<N>.md 与
docs/final/audit-r<M>.md:<最近一轮差距原文>` ("the final review loop still has not passed after <n> consecutive rounds; see docs/final/validate-r<N>.md and docs/final/audit-r<M>.md for the residual gaps: <the latest round's gap verbatim>"), exit code 2. After manual handling (edit PLAN / edit the code /
simply rerun), run again: the blocked task resumes directly (existing semantics), or after manually removing or editing the final review tasks,
state reconstruction re-routes.

### B.6 runTask adaptation

- Opts gains `mode` (passed through to prompt rendering);
- Final review tasks (task objects carrying the `final` field, all four stages) force `review = 0` and skip the three-stage
  acceptance (`--verify` has no effect on them, and `--early` naturally lapses with it), going straight to markDone after wrap-up
  (no verified written); stale verify/review phase recovery records are not replayed (enterAudit gains a
  limit>0 guard; verify-phase records go the wrap-up-skip + direct-completion route);
- Export `requireArtifact` / `runSession` for `src/final.ts`'s generation session to reuse;
- Everything else (chain reuse, permissions, interaction, watchdog): zero changes.

## C. Interrupt recovery and idempotence

State reconstruction rules (the routing pure function in `src/final.ts`, evaluated at run startup and after every runTask completion):

1. Unfinished (pending/in_progress/blocked) final review tasks exist → handled by the main loop's existing mechanisms,
   no new tasks are generated (blocked waits for a human; an interrupted in_progress goes through recallProgress);
2. An audit task is done and the report's last-line strategy is legal → route by strategy; if the next-stage task already exists (interrupted after
   appending) → do not regenerate; the main loop picks it up directly;
3. The proposal file was produced but the corresponding task was not appended (interrupted before appending) → parse and append directly, without opening a generation session;
4. A final review task is done but the report is missing / the protocol is illegal → blocked as brokenReport at routing, prompting manual
   inspection (final review tasks do no task-level acceptance; this check is the only backstop);
5. All original tasks and final review tasks done, no stage awaiting generation → the final review is complete, exit 0.

## D. File-level change list

| File | Change | Phase |
| --- | --- | --- |
| `src/mode.ts` (new) | ModeSpec / MODES / resolveMode | P1 |
| `src/index.ts` | `-m/--mode` (VALUE_FLAG + short option), `--final-review` (parseFinalReviewLimit) parsing, usage text | P1 / P2 |
| `src/prompt.ts` | mode section injected into each render; renderFinalTask | P1 / P2 |
| `src/runner.ts` | Opts.mode; final review tasks (final field) force review=0 and skip task-level acceptance; export requireArtifact/runSession | P1 / P2 |
| `src/loop.ts` | Opts pass-through; routing hook after runTask completes, final review kick-off hook when next() is empty, banner | P2 |
| `src/plan.ts` | Task parsing of the `final` field; appendTask | P2 |
| `src/final.ts` (new) | state machine routing table, strategy/conclusion parsing, appendFinalTask, idempotent reconstruction | P2 |
| `test/mode.test.ts` (new) / `test/plan.test.ts` / `test/prompt.test.ts` | registry and unknown-name error; appendTask and final field round trip, unknown-field preservation; mode injection and renderFinalTask assertions | P1 / P2 |
| `test/final.test.ts` (new) | routing table (策略 无/重构/修补 -- strategy none/refactor/patch; 结论 通过/差距 -- conclusion pass/gap; circuit breaker), idempotent proposal-file appending, state reconstruction | P2 |
| `test/e2e.test.ts` | CLI parsing cases (mirroring the existing style) | P3 |
| `README.md` / in-package `AGENTS.md` | command table, behavior conventions, structure section | P3 |

## E. Risks, boundaries, and known limitations

- **Session compliance with the report protocol (Revision)**: final review tasks have no structural-check acceptance backstop; the report protocol lines rest entirely on
  the hard requirements in the proposal body; an omission is blocked as brokenReport at routing and needs human intervention,
  the cost being a halt event rather than automatic repair -- what it buys is the purity of not re-verifying the verification.
- **Empty PLAN**: with no tasks, the final review still enters as usual (audit most likely `策略: 无` -- strategy: none → finalize);
  no special-casing.
- **Final review cost**: each round = 2..3 generation sessions + 2..3 full task pipelines; `--final-review 1`
  can serve as the cheap "one audit round, no rollback" form.
- **dogfood ordering**: the driver running during implementation is still the old version; the new behavior takes effect from the next run.
- **Mode not persisted** (V1): on cross-day recovery, the CLI forgetting `-m` falls back to migrate; currently there is only the one
  mode migrate, so no real divergence -- persistence must be added before extending a second mode (listed as a precondition).

## F. Testing and verification

- `bun typecheck` + `bun test`; final/mode tests depend on neither the opencode server nor the network
  (routing parse and state reconstruction are pure functions; proposals/reports use fixture files);
- e2e (`OPENCODE_AUTO_E2E=1`, requires credentials) is an optional manual verification item: run `--final-review 1` once for a
  no-op loop (audit `策略: 无` -- strategy: none → finalize), observing the `docs/final/` artifacts and the appending and
  check-off of T-F tasks;
- After all tasks complete, `bun run build` as a smoke test to confirm `type: "file"` template imports are unaffected
  (expected unchanged; nothing new in templates/).

<!-- auto: eof -->

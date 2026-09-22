# 0049 Human-gate convergence (M4.2)

Root plan item M4.2 (`plans/AUTO_NEXT_REFACTOR_PLAN.md`, M4 "round loop, outermost, all human gates"). This document is the design for M4.2. Its input is the M4.1 audit (`plans/0048-round-mechanism-audit.md`), findings R1–R10 and surfaces H1–H19. It closes the four real gaps in the human-gate surface (R1, R5, R6, R10), plus the cheap fixes the audit routed here (R2, R3, R7, R8).

Line numbers are as of 2026-09-22; search by symbol if they drift.

## 1. Rulings (user, 2026-09-22)

| # | Question | Ruling |
|---|---|---|
| U1 | R1: who commits the round setup | **A named human gate.** `init`/`continue` do not commit. They print the review-and-commit step, and `run`'s clean gate names it. |
| U2 | H8: default of the phase acceptance gate | **Opt-in per phase type.** A custom type sets `Gate: acceptance`. Builtin types are listed in config `acceptanceGate`. Off otherwise, so existing presets still run unattended. |
| U3 | H8: author and marker | **AI pre-fills, human signs.** The handover session drafts `acceptance.md` and never writes the marker. The human adds the line `Accepted: yes`. |
| U4 | R6 / open question 15-⑦ (0036 §11-9): hardness of the round-close gate | **Middle form.** The whole-tree P1 scan and the target build are mechanical and block `continue`. The restatement obligation is a listing in `round.md`'s `## Close` section, and the gate checks only that the listing is present. Reported, not blocking, on every `complete` run. |

## 2. Decisions

**G1: round-start gate (R1, H2).** Committing the round setup stays a human act. It is now the named round-start gate:
- The last lines of `init`/`continue` in phased mode say: review the setup, fill in `docs/R-NN/round.md`, commit, then `run`.
- `run`'s start clean gate recognizes the case "the current round's `phases.md` has never been committed" (`fileCommitted`). In that case it prints the gate by name instead of the generic dirty-tree message. The exit code (2) and the file list are unchanged.
- No driver commit, and no new `Auto-Stage`. The knowledge extractor's comment (fixed in M4.1) stays true.

**G2: `round.md`, the round brief (R7, H5).** `docs/R-NN/round.md` is new. `establishRound` writes a stub once, if the file is missing. The stub has four sections: `## Goal`, `## Acceptance criteria`, `## Release criteria`, `## Close`. Each section holds an HTML-comment hint and no body.
- **Role.** It gets a new role, `roundBrief`, with policy `eofScan: false, process: true`. It is human-written, has no terminator, and sits on the process side of P1. Without the new role, the path shape would classify it as `artifact`.
- **Authoring order.** The driver writes the stub after the round directory and index exist, so a human never needs to create a round directory by hand. That leaves the `legacyLayoutProblem` and `currentRound` hazards of R7 without a trigger, and neither check gains an exemption.
- **What the driver parses.** Only the heading `## Close` (G8). The other three headings are stub scaffolding, and their content is free (0045 standardization boundary). New protocol surface: the file name `round.md` and the heading `## Close` (§4).

**G3: planning reads `round.md` directly (R8).** Each phase-planning session gets the round brief in a new `round` slot of `phase-plan.md`. The driver strips HTML comments first. A brief with no body left under any heading is not injected, so an untouched stub injects nothing. The phase `todo.md` stays without `Goal`/`Exit`, so there is no second copy to drift. How to use the brief is intent content: `## acceptance` / `### round-brief` in the default pack. This is the "round-level (b)-class content externalized into an intent-pack section" of the M4.2 brief. The per-round values live in `round.md`, and the discipline lives in the pack.

**G4: previous-round digest reaches the first *planning* session (R3).** The digest used to be injected when no phase of the round was done. It is now injected when no completed phase of the round has tasks. A leading task-less `knowledge` phase no longer swallows the digest.

**G5: plan-review pause (R10, H7).** With `OPENCODE_AUTO_STEP ≥ phase`, `stepPause("phase", …)` also fires after a successful phase-planning commit, before the first task. This reuses the existing mechanism, as 0036 D8 requires ("no new pause mechanism"). `/exit` is honored at the same point (`maybeExit("phase", …)`).

**G6: interrupted `continue` recovers by re-running it (R2).** An *established* round has an index. `nextRound` now returns the current round when its directory exists without a `phases.md`: the round is still being established, so the same number is reused. The shell's `continue` precheck judges the previous round in that case, not the index-less current one. A plain re-run of `continue` then completes the interrupted establishment.

**G7: phase gates inside `completePhase` (R5, H8, H9).** `completePhase` stays the single completion path shared by the handover and its interruption recovery. It gains a precondition: `phaseGateProblems(dir, unit, gates)`. While that returns problems, the phase is not renamed and the route stays `handover`. Each re-run re-checks, so the recovery path cannot bypass the gate (0036 D8).
- **Gate model.** `PhaseTypeEntry.gate` becomes `gates: PhaseGate[]`, with `PhaseGate = "verdict" | "acceptance"`. A custom type file's `Gate:` takes `none`, one value, or a comma list. Builtin `acceptance` keeps `["verdict"]`. The effective gates are the type's own plus `acceptance` when config `acceptanceGate` lists the type id (U2).
- **Verdict gate.** It reads `verdict.md` in the phase directory with the task report's parser (`parseResult`, `Result: PASS|FAIL`). `FAIL` blocks. A missing file or a missing line passes, the same as the task-level rule "no result line = no stop". `plan-duties-v` now asks the planning session to lay out a closing task that writes the verdict. Without that, the declared gate would stay inert, because no prompt ever named `verdict.md`.
- **Acceptance gate.** It passes when `acceptance.md` has a whole line `Accepted: yes` (anchored, case-sensitive, the last `Accepted:` line wins). There is one marker value. Rejection means the line is absent, so there is no `Accepted: no` to parse.
- **Draft (U3).** With the acceptance gate on, the handover distillation also writes `acceptance.md`: a reviewer-facing summary and the points needing a decision. Content is intent (`## acceptance` / `### phase-acceptance-draft`). The collect check requires the draft to exist and to be non-trivial. A draft that carries an `Accepted:` line fails the check, because an AI must not sign. If `acceptance.md` already exists (a rejected phase coming back), the session keeps the reviewer's notes and updates the rest. The idempotent "handover already complete" skip also requires the draft when the gate is on.
- **Waiting and rejecting.** A failing gate prints `⏸ phase … awaits acceptance` with both procedures and exits 2:
  - Accept: add `Accepted: yes` to `acceptance.md`, commit, re-run.
  - Reject: write notes in `acceptance.md`, append fix tasks to the phase's `tasks.md` (each with its `docs/T-NNN/todo.md`), delete `handover.md`, commit, re-run. The fix tasks run, and the handover is distilled again with the notes in view.
  Signing is a human change, so the human commits it, as for G1. Carryover is for driver state only (0021 P3).
- **Phase-artifact shape checks are not added.** No prompt announces the type's phase artifacts, apart from the new verdict duty, so a shape check would fail every phased flow. The check belongs with whichever change first names them to the planning session. Recorded, not done.

**G8: round-close gate (R6, H10, U4).** `roundCloseProblems(dir, round, { build })` lives in the new module `src/round-close.ts`. It is one pure-in-intent evaluator (it reads the tree and runs the build, and writes nothing). Its checks:
1. **Whole-tree P1 prohibition scan.** It reuses `processReferenceScan`, fed every line of every tracked and untracked file in every nested repository. `unitAddedLines` is run against an empty baseline, so this is the unit scan with its scope widened to the whole tree (root plan D12 ③). A bare-task-id warning stays a warning.
2. **Target build.** Config `build` (optional shell command) runs in the target directory with a 30-minute cap. A non-zero exit is a problem, and the output tail is included. With no `build` configured the check is skipped and noted.
3. **Restatement listing.** `round.md`'s `## Close` section must have body text after HTML comments are stripped. The stub asks for two lists: decisions restated into the target's own documentation, and decisions accepted as lost.

It is evaluated at two anchors:
- **(a)** The `complete` route reports it every run: `✓ round close checks passed`, or `⚠` lines. The exit code is unchanged, because the phases are done.
- **(b)** The shell's `continue` precheck blocks on it with exit 1, like the other `continue` prechecks, before anything is written.

No state is written, and `routePhase` stays a pure function of the files.

**G9: config keys.** Two optional keys go in `.opencode/auto/config.json`: `acceptanceGate` (array of phase type ids, each validated against the known types) and `build` (non-empty string). Both are hand-edited, like the rest of the constitution. There are no CLI flags in M4.2: adding one is cheap later, and the round-start gate already makes the human look at the config. `formatProjectConfig` shows the two keys when they are set.

**Not in M4.2.** R4 (Chinese inline strings) goes to M4.3. R9 (round history view) is recorded only. H13 (steering durability) stays optional (0036 §6.3). The migrate shell's `prior-kb.md` ordering goes to M6.2 (D9).

## 3. Human intervention surface after M4.2 (delta to 0048 §4)

| # | Surface | Before | After |
|---|---|---|---|
| H2 | Round-start commit | implicit | named gate (G1) |
| H3 | `continue` | precheck | precheck + round-close gate (G8) + interrupted-establishment recovery (G6) |
| H5 | `round.md` | missing | stub at round start; read by planning (G2, G3) |
| H7 | Phase plan review | missing pause | `stepPause` after planning (G5) |
| H8 | Phase acceptance | missing gate | opt-in gate in `completePhase` with an AI draft (G7) |
| H9 | Acceptance verdict | no reader | verdict gate in `completePhase` (G7) |
| H10 | Round-close disposability | missing | `roundCloseProblems` at `complete` (report) and `continue` (block) (G8) |

## 4. Protocol strings (registered in 0035, amendment M4.2)

New English literals, registered as new rather than flipped, so none has a dual-read:
- `docs/R-NN/round.md` and its heading `## Close` (`src/round-close.ts`).
- `acceptance.md` line `Accepted: yes` (`src/phases.ts`).
- The custom type field value `acceptance`, and the comma-list form of `Gate:` (`src/phases/custom.ts`).
- `verdict.md` in an `acceptance`-type phase directory, read with the existing `Result: PASS|FAIL` literal.
- Config keys `acceptanceGate` and `build`.

The prompts that name these (`phase-handover.md`, `phase-plan.md`, `plan-duties-v`) state them verbatim (0035 D2). `Accepted: yes` is spelled out only in the instruction *not* to write it.

## 5. Steps

- [x] S1 roles and paths: `roundBrief` role, `ROUND_BRIEF_NAME`, stub at `establishRound`; `nextRound` recovery (G2, G6)
- [x] S2 gates: registry `gates`, custom `Gate:` list, config `acceptanceGate`/`build`, `phaseGateProblems` in `completePhase` (G7, G9)
- [x] S3 loop: handover draft + gate exit, plan pause, digest condition, round-brief injection, `complete`-route report, clean-gate naming (G1, G3–G5, G7, G8)
- [x] S4 prompts and intent: `phase-plan` round slot, `phase-handover` draft block, `plan-duties-v` verdict task, `### round-brief` / `### phase-acceptance-draft` (G3, G7)
- [x] S5 `src/round-close.ts` (G8)
- [x] S6 shell: `continue` precheck (G6, G8), closing lines (G1), config display (G9)
- [x] S7 tests, golden regeneration, 0035 amendment, docs; typecheck and `bun test` in both packages

## 6. Verification (2026-09-22)

- `bun typecheck` is clean in `packages/auto-core` and `packages/auto`.
- `bun test` results: `packages/auto-core` 1095 pass / 0 fail, and
  `packages/auto` 54 pass / 0 fail / 4 skip (the skipped tests are E2E only).
- New `test/round-gates.test.ts` (15 tests) covers:
  - the stub, the brief text and `closeSection`;
  - roles and P1 scope, including `.gitignore`;
  - `establishRound` writes the stub once for phased flows and never for `m`;
  - `acceptanceMark`, `phaseGates`, and `completePhase` holding and releasing
    on acceptance and on verdict;
  - round close in git temp repos: a process reference, an empty close,
    untracked files, and build pass/fail;
  - validation of the config keys;
  - both prompt slots.
- Golden: only `phase-plan-v` changed, to add the verdict duty. The
  handover rendering without acceptance is byte-identical.
- In the shell e2e tests, `continue` now refuses an untouched stub's empty
  `## Close` and leaves no `docs/R-02`. The two continue tests fill in the
  listing first.
- Not verified here: a real-agent run of a gated phase (draft → human
  sign-off → re-run completes). This is left for the `auto/` worktree smoke.

<!-- auto: eof -->

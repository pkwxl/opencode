# 0053 — Lifecycle commands: `plan`, `close` and append planning (detailed design for 0052 P3)

Status: **design, awaiting rulings** (2026-09-23). The P3 design pass that `plans/0052` §6 requires before any P3 code. No code change. §9 lists the points for ruling: the answers to 0052 Q1–Q6, plus the places where this document refines or departs from a 0052 decision. Line numbers are as of auto-core `33a208f80`; search by symbol if they drift. In this document "D3" means this document's decision; 0052's decisions are always written "0052 D17".

## 0. Scope

- **In scope:** 0052 D12–D24, split into P3a (run lock, `plan`, m-mode planning merged into `planPhase`, persisted planning input), P3b (`close`, append planning, `plan --force-close`) and P3c (lifecycle leaves `init`, `continue` retires, phases sync, messages, README flow).
- **Out of scope:** MP.3 behaviour beyond what 0052 already states. The run lock, `close` and append planning are written so MP.3 can add its worktree records later (§3.1, §4.2).
- **Carried over unchanged:** the 0052 rulings U1–U6, the classification criterion (0052 §3) and the stage order P3a → P3b → P3c.

## 1. Fact baseline (new facts from the P3 survey)

0052 F1–F13 still hold. This survey adds the facts below; each one shapes a decision.

- **F1 — every run starts on a clean tree.** `preflight` runs `beginUnit` on the whole tree before any routing (`loop-preflight.ts:189-210`). Only driver-state leftovers self-heal through the carryover commit (`git.ts:416-434`, `driverStateFile`). An interrupted planning session that wrote files therefore stops the next run until a person commits or cleans, whatever resume point exists. Consequences:
  - a planning step always (re)starts on a clean tree at HEAD, so an append's pre-session snapshot can be read from disk at step entry (D24);
  - planning input left uncommitted would be lost to a `git clean`, so it is committed on its own before the planning unit starts (D9).
- **F2 — `progress.json` holds one record** (`resume.ts:62`). A task pipeline keeps a *summary* record (`active: false`) between its stages (`runner.ts:236-245`), and `runTask` resumes the pipeline from it. A fresh bypass step overwrites that record (`artifact.ts:164`). Today no step can run while a task is mid-pipeline (the plan and handover routes have no open task). Append planning could, so it must not (D26).
- **F3 — most readers already treat a closed unit as done.** A closed unit is a `done.md`. So `nextReady` (`document/unit.ts:277-280`), `doneTaskIds` / `takenTaskIds` (`tasks.ts:472-495`), the external-id check in `loadPlan` (`tasks.ts:302`) and `plannedTaskProblems` (`tasks.ts:428`) need no change. Only readers that show or reason about *what was delivered* need the distinction (D16).
- **F4 — `Closed:` parses today.** `parseUnitDoc` reads every `Key: value` line of the field block, lower-casing the key (`document/unit.ts:187-192`). The block ends at the first line that is not a field.
- **F5 — model-routing role.** An explicit `spec.role` wins over the step (`chain.ts:136-138` `roleOf`). So m-mode planning can keep the `implement-scan` role (`switches.ts:59-71`), and existing routing configs stay valid. Strict resume, however, derives the role from the step alone (`unit-commit.ts:144-146` `resumeModelNow`), so it would report a model mismatch for that role and never reuse the session.
- **F6 — step kinds are two-valued ternaries.** `phaseToRole` (`chain.ts:132`) and both resume-gate texts (`resume-gate.ts:78`, `:148`) test `step === "phase-plan"` and treat everything else as the handover. A third step kind would silently take the handover branch.
- **F7 — commit messages have no body** (`git.ts:26-34`): only subject and trailers. `Auto-Task` is never parsed. The `Auto-Stage` value is not parsed either: only the trailer's presence matters (`foreignCommits`).
- **F8 — shell argument parsing.** The directory is `positional[0]` (`packages/auto/src/index.ts:190`). `--commit` is both a value flag and a config flag (`:63-81`, `:164`), so `close --commit T-005` would parse `T-005` as its value.
- **F9 — the loop has no stop hook.** The only pauses between steps are `stepPause`/`maybeExit` in `planWithStep` (`loop-phase.ts:395-401`) and `handoverWithStep` (`:373-389`). The complete route prints the round-close report and returns 0 (`:411-424`). In m mode, a non-execute route prints "add task lines" or "all tasks complete" and returns 0 (`:426-438`). This happens **before** the open-step check (`:455-489`), so `run` in m mode never re-enters an interrupted planning step unless tasks already exist.
- **F10 — `implementPlan` has one caller:** the shell's `init --implement-*` path (`packages/auto/src/index.ts:22`, `:967-991`).
- **F11 — `.auto/` is ignored by git and never touched by `reset`** (0052 F2). A lock there never reaches git and survives `reset`.
- **F12 — records name their task.**
  - `CURRENT.md` names its task on its third line, `## T-NNN: <title> [status]` (`current.ts:21`).
  - `handover.json` carries `task` (`handover.ts:18`).
  - Task completion removes the test-handover chains (`execute.ts:116`, `:468`; `testrun.ts:138`).
- **F13 — handover distillation is skipped when a valid `handover.md` exists** (`loop-phase.ts:241-252`). Tasks appended to a phase that was already distilled would therefore run, and the stale handover would then be archived unchanged (D25).
- **F14 — no core test drives `runPhaseLoop` with an agent.** `runAll` is tested only for early exits. `test/fixtures/agent.ts` (`fakeAgent`, a native `AgentClient`) drives sessions in `agent-fake.test.ts`.
- **F15 — file sizes.** `loop-phase.ts` has 547 lines; `prompt.ts` 646 (already over the 0024 budget of 600); the shell's `index.ts` 1202.

## 2. Command surface after P3

| Command | Layer | P3 change |
|---|---|---|
| `init [dir] …` | config | P3a: `--implement-*` retires (D13). P3c: `-p` and `--amend` retire; no round step (D31). |
| `amend [dir] --<key> <value>…` | config | P3c: drops its round step (D32). |
| `fix [dir] [-f]`, `reset [dir] [-f]` | config | P3a: refuse while a live run lock is held (D3). |
| `plan [dir] [-p <text> \| --file <path>] [--append] [--force-close <ref> --reason <text> …] [session flags]` | lifecycle | New in P3a (D4–D14). `--append` and `--force-close` arrive in P3b (D23–D28). |
| `close <ref> [dir] --reason <text> [--cascade] [--commit-changes \| --stash-changes]` | lifecycle | New in P3b (D17–D22). |
| `run [dir] …` | lifecycle | P3a: takes the run lock. P3c: stops with exit 1 on a phase-index drift (D34). |
| `continue` | — | P3c: retired, a usage error naming `plan` (D33). |
| `check`, `status` | read-only | `status` shows a live lock (D3) and closed units (D16). |

"Session flags" are the flags of `run` that shape a session rather than the project: `--server`, `--verbose`, `-i/--interactive`, `--wait-answer`, `--permission`, `--new-session`.

## 3. P3a — run lock, `plan`, one planner, persisted input

### 3.1 Run lock (refines 0052 D12)

- **D1 — file and format.**
  - The lock is `.auto/run.lock`: one JSON object `{"pid": 1234, "host": "build-3", "command": "plan", "started": "2026-09-23T10:00:00.000Z"}`.
  - It is driver-internal, never committed (F11), and never read by a session.
  - **Q3 answered: record the hostname.** A lock whose `host` is not this host counts as **live**: its pid cannot be probed. The refusal names the host. This costs one field and never steals a lock across hosts on a shared filesystem.
- **D2 — semantics** (new core module `src/lock.ts`).
  - **Atomic creation.** Write the JSON to `.auto/run.lock.<pid>.tmp`, then `link()` it to `.auto/run.lock`. `link` fails with `EEXIST` when a lock exists, so the lock file is never half-written. Remove the temp file afterwards.
  - **Stale lock:** same host, and either `process.kill(pid, 0)` fails with `ESRCH`, or the pid is this process's own but this process does not hold the lock (a dead predecessor whose pid was reused). `EPERM` means alive. A stale lock is removed with a log line naming its holder, and creation is retried once.
  - **Unparsable lock** (hand-edited): treated as live, and the refusal says to delete it by hand.
  - **Re-entrant per process and directory.** A count is kept in process memory, so `plan` can hold the lock and still call `runAll`, which acquires it again. `release()` decrements the count and deletes the file at zero.
  - **Release:** in `finally`, plus one synchronous `process.on("exit")` handler that deletes every lock this process holds. That handler also covers `process.exit(130)` on a double Ctrl+C. A `SIGKILL` leaves the lock behind, and the pid check then finds it stale.
  - **Accepted residual race:** two processes that find the *same* stale lock within milliseconds may both remove it and both create one. Starting runs by hand never gets that close; recorded, not engineered away.
  - **API:**
    - `acquireRunLock(dir, command)` → `{ ok: true, release }` or `{ ok: false, holder }`;
    - `liveRunLock(dir)` → holder / `"unreadable"` / `undefined`;
    - `lockLines(dir, holder)` → the refusal text.
- **D3 — who acquires and who refuses.**

  | Command | Behaviour |
  |---|---|
  | `run` | `runAll` acquires with `"run"` before `preflight`. A refusal logs the holder and returns 1. Because this happens in the core, every shell's `run` is covered. |
  | `plan`, `close` | The shell acquires (`"plan"`, `"close"`) before its first write; `plan`'s `runAll` re-enters the lock. |
  | `init`, `amend`, `fix`, `reset` | Refuse with exit 1 while a live lock is held. They write what a running driver reads. This extends 0052 D12, which named only `init` and `reset`. |
  | `check`, `status` | Never lock. `status` prints a live lock as its first line: `▶ plan in progress (pid 1234 on build-3, since …)`. |

  - Refusal text: `⏸ another opencode-auto process holds the run lock of <dir>: plan, pid 1234 on build-3, since <started>. Wait for it to finish or stop it; if no such process exists, delete .auto/run.lock.`
  - **MP.3:** the parent run holds the lock; each child has its own worktree and so its own `.auto/` (0051 D1). Nothing is needed now.

### 3.2 The plan prelude: deterministic routes (refines 0052 D14)

- **D4 — `plan` decides every route that needs no AI before it starts an agent.**
  - A core function `planPrelude(dir, { phases, build, input, append, bin })` in the new module `src/plan.ts` returns either `{ type: "loop" }` or `{ type: "stop", code, lines }`.
  - The shell calls it while holding the lock, **before** `runAll`. So `plan` works on the dirty tree a fresh `init` leaves, and does not start a server just to print a notice.
  - Rows are checked in order; the first match wins.

  | # | State | `plan` does | Exit |
  |---|---|---|---|
  | 1 | Current round not established: no `docs/R-NN/`, or its index missing (0049 G6). For R-(N>1) the previous round's G8 check is re-run first, as `continue` did. | `establishRound` (no AI, uncommitted), print the G1 lines (D15). | 0 |
  | 2 | Round complete (phased only; m mode never completes). | Run G8 `roundCloseProblems`. If it fails, print `roundCloseLines` and exit 2. If it passes, print its warnings, `establishRound(next)`, and print the G1 lines. | 0 / 2 |
  | 3 | Phase index drifted from `config.phases` (P3c, D34). | Re-sync the unstarted tail, print it, ask for review and a commit. | 0 |
  | 4 | Route `blocked`. | Print the reason. | 1 |
  | 5 | An open step record exists (`openStep`). | Loop: the interrupted step is finished first (0018 precedence). | — |
  | 6 | Phased, route `plan` or `handover`. | Loop: plan the phase, or hand over and plan the next one. | — |
  | 7 | Phased, route `execute`, no `--append`. | With input: exit 1, pointing to `--append` (D7). Without: a notice (D7). | 1 / 0 |
  | 8 | m mode, empty task index. | With input: loop (planning). Without: the "list tasks or pass input" notice (D15). | — / 0 |
  | 9 | m mode, tasks listed. | With input: loop (append, D23). Until P3b: exit 1, "appending arrives with `plan --append`". Without input: a notice (D15). | — / 1 / 0 |
  | 10 | `--append` on route `execute` or `handover` (phased). | Loop (append to the current phase, D23). | — |

  - **Input checks in the prelude.**
    - Rows 1–3 refuse input (exit 1, **before** any write; D5).
    - On row 6 with input, the prelude checks that a phase with tasks remains to be planned: the current phase on the `plan` route, or a later phase with `hasTasks` on the `handover` route. Otherwise it exits 1 ("no phase is left to plan in round N; the input would not be used").
    - Rows 9 and 10 also apply the progress-record check of D26.
  - **G8 exits 2, not 1** (`continue` exited 1). The round-close checks wait for human work (filling in `## Close`, fixing P1 references, the build), which is what exit 2 means. G1 and G7 already stop with 2.
  - **Dropped from `continue`:** the "completed phases outside `phases`" precheck on the finished round. That round's index is history; the new round is built from `config.phases` alone. The `-m` identity guard is not needed: `plan` takes no config flags.
- **D5 — input on a round-setup route is refused before any write.** A fresh project must commit its round setup (G1) before anything is planned, so input given there would have to wait anyway. The message names the order:
  - `round R-01 is not established yet: run opencode-auto plan <dir> without input to establish it, commit the setup, then pass the input.`
  - This keeps D24's invocation count: in m mode it is `init` → `plan` → commit → `plan -p …` → `run`.

### 3.3 The stop condition (refines 0052 D13)

- **D6 — `RunAllOpts` gains `stopBefore?: "execute"`, `planInput?: { text: string; source?: string }` and, in P3b, `append?: boolean`.** `LoopCtx` carries them, plus a consumable `input` and a count `planned`. Nothing changes when `stopBefore` is absent: `run` behaves byte for byte as today, apart from D12's reordering. With `stopBefore`:
  - **After a planning step** (`planWithStep` returns 0), `runPhaseLoop` returns 0 and prints the plan summary and the next step (D15). The G5 `stepPause` in `planWithStep` is skipped: the stop *is* the review point. Stopping right after the step is equivalent to "the first execute route after a planning step", because a successful planning step always leaves pending tasks.
  - **A handover or knowledge phase** is advanced through as `run` does. Their G5 pauses stay; a person who set `OPENCODE_AUTO_STEP` asked for them.
  - **Exit codes** are `run`'s: 1 for a blocked route, 2 for a gate or blocked session, 3 for `/exit` (re-run `plan` to resume). Everything else is reused unchanged: preflight (G1, the clean gate, `resetInProgress`, protect, the housekeeping commit), hibernation, stats, numbering and the open-step precedence.
- **D7 — `plan` on an `execute` route (phased).**
  - **Without input:** exit 0 with `ℹ R-01.P02 implement is planned (3 of 5 tasks pending); next: opencode-auto run <dir> — or add tasks with plan --append -p …, or close units with close <ref>`.
  - **With input:** exit 1 with the same pointers.
  - 0052 D14 says "refuse" for both. Exit 0 without input keeps `plan && run` usable in scripts and costs nothing: the phase really is planned. Input on this route is a real mistake, because the person thinks the phase is unplanned, so it stays an error.
  - The same notice (exit 0) applies when the loop reaches an execute route that this run did not plan, for example a next phase whose tasks were written by hand.
- **D8 — reaching `complete` inside the loop does not open the next round.** If the last handover completes the round, `plan` prints `run`'s complete-route report (including `roundCloseLines`), then: `next: fill in ## Close of docs/R-NN/round.md, commit, then run opencode-auto plan <dir> to open round N+1`. Exit 0.
  - A round that has just completed cannot have `## Close` filled in yet, so opening the next round in the same process would only fail G8.
  - If `planInput` was never consumed, a warning says so. The prelude's check (D4) makes this a backstop only.

### 3.4 Persisted planning input (refines 0052 D16)

- **D9 — one `plan-input.md` per phase directory, committed by the driver before the planning unit.**
  - **Q1 answered: one file per phase, holding the latest input; earlier inputs live in git history.** The file is `docs/R-NN/P<nn>-<type>/plan-input.md`. An append overwrites it. Each version is its own commit, so `git log -- <file>` is the input history. Numbered files would need a rule for which number belongs to the open step. They would also pile up in m mode, whose single phase never closes, and no session reads past inputs (the tasks they produced are the record).
  - **Content:** the text, verbatim, with trailing whitespace trimmed and one final newline. The source (`-p` text or the `--file` path) goes in the commit subject, not into the file.
  - **When it is written.** In `planPhase`/`appendPlan`, after `ensureNumbering` and before `requireArtifact`. The tree must be clean at that point: preflight guaranteed it, and numbering may have committed. Otherwise the step stops as dirty (exit 2), like `beginUnit`.
  - **Commit:** `commitTree` with `Auto-Task: PLAN`, `Auto-Stage: plan-input` and subject `PLAN plan-input <phase title>` (plus ` (from <file name>)`). A commit failure is exit 2. The input commit comes *before* the unit's SHA baseline, so the close-out check never sees it.
  - **Why a separate commit** (F1): an interrupted planning session leaves a dirty tree that a person must commit or clean before the next run. A `git clean` must not lose the input, because the resume point depends on it.
  - **Rules.**
    - An existing file with the same text: no write, no commit.
    - A different text replaces it, and **the step runs in a new session**: `newSession` is set for that `requireArtifact` call, so a reused session never plans against an input it did not see. The latest input wins.
    - Without new input, a planning step uses the file if it exists: an interrupted or blocked step resumes with its input under `plan` *and* under `run`.
    - On the `plan` route the phase has no tasks, so an existing file is always this step's input.
    - To plan without it, delete the file and commit.
  - Inputs must be non-empty (checked in the shell before the lock).
- **D10 — a new document role `planningInput`** in `document/roles.ts`: `{ eofScan: false, process: true }`, matched by `^docs/R-\d+/P\d{2,}-[a-z][a-z0-9-]*/plan-input\.md$`. It is human text, so it gets no terminator (like `roundBrief`), and it is a process document, so the P1 scan skips it. Without this role the file would classify as `artifact` and fail the eof scan.
- **D11 — how the input reaches the session.**
  - **Phased (`phase-plan.md`).** A new optional block after the round brief. Absent input renders nothing, so the phase-plan goldens stay byte-identical:

    ```
    {{#if input}}
    ## Input: planning input ({{inputPath}})

    The person who started this planning step asked for the following. Plan this phase's tasks to cover it, within
    the phase duties below.

    {{input}}

    {{/if}}
    ```

    It is not a tier-1 marker: an override that predates it must keep loading. When input is given and the active `phase-plan` template has no `{{input}}`, the driver logs `⚠ the project's phase-plan template does not render {{input}}; the planning session will not see the input`.
  - **m mode (`implement-plan.md`, unchanged).** Render with `fromFile: true`, `filePath` set to the persisted file's path and `content` set to its text. The template is unchanged, so its goldens are unchanged. Its `^fromFile` ("implementation prompt") branch becomes unused by the core; it stays for now and can go in a later prose batch.

### 3.5 One planner (0052 D15)

- **D12 — m-mode planning runs on `planPhase`.** `planPhase(ctx, phase)` branches on `ctx.manual`.

  | Aspect | Phased | m mode |
  |---|---|---|
  | Prompt | `renderPhasePlan` (+ input) | `renderImplementPlan` over the persisted input; no round brief or handovers exist in m mode |
  | `spec.role` | unset (derived: `phase-plan`) | `"implement-scan"` (F5: routing configs stay valid) |
  | Numbering | `.auto/next-task` under `autoNumber` (default on); otherwise as today | `.auto/next-task` under `autoNumber`; otherwise the highest taken id + 1 (`implementPlan`'s rule) |
  | Step, commit | `phase-plan`, `Auto-Stage: phase-plan` | the same. The `implement-plan` stage value retires (not parsed, F7) |
  | Advance `next-task` | yes | **yes** (fixes 0052 DF4) |

  - **Resume.** The open-step precedence in `runPhaseLoop` moves **before** the m-mode branch (F9). An interrupted m-mode planning step is then finished by whichever command runs next, `plan` or `run`, from its persisted input. That is the only case in which `run` runs a planning session in m mode. If no `plan-input.md` exists for such a step (a pre-P3 record), the record is closed with a warning, and file routing continues.
  - **Strict resume** (F5): `requireArtifact` passes `spec.role` to `resumeModelNow`, so the model check derives the same role as the dispatch did.
  - `planPhase` and `planWithStep` move to a new `src/loop-plan.ts` first (pure move), since the P3 additions would push `loop-phase.ts` past 600 lines (F15).
- **D13 — `implement.ts` is deleted in P3a, and `--implement-file` / `--implement-prompt` retire with it.** They become `RETIRED_FLAGS` entries: `is retired: plan tasks with opencode-auto plan <dir> -p <text> | --file <path> (after init and the round-start commit)`. They stay value-parsed so their argument is not taken as the directory. `init --amend --implement-*` goes with them.
  - **This departs from 0052 D20**, which retires them in P3c. Keeping them would mean either keeping `implement.ts` beside the merged planner until P3c, or wiring `init` into `runAll`. `init` leaves its writes uncommitted, so the second option would run into 0052 DF5's clean-gate refusal. `plan -p/--file` exists from P3a on, so nothing is left without a replacement.
  - `init -p` (the project brief) and `init --amend` stay until P3c, as 0052 D20 says.
  - The e2e tests of the shortcut (`packages/auto/test/e2e.test.ts`, the implement describe at ~1022 and the D7 "task-index guard" test) are replaced by `plan` tests (§8).

### 3.6 The shell's `plan` command

- **D14 — `plan [dir] [-p|--prompt <text> | --file <path>] [session flags]`.** Order of work:
  1. **Flags.**
     - `-p` and `--file` are mutually exclusive, and each must be non-empty. `--file` must name a regular file with non-empty text.
     - Config flags are refused with `run`'s "frozen by init, use `amend`" messages.
     - `--amend`, `-f`, `--dryrun`, `--wait-between`, `--max-sessions` and `--continue` are refused.
     - `--file` is a new value flag.
  2. **Legacy-layout check, then a strict config load** (with `fixHint`), then the mode check, as in `run`.
  3. **Lock** `"plan"` (D3).
  4. **`planPrelude`:** a `stop` result prints its lines and exits with its code.
  5. **`runAll`** with `run`'s options (the builder is extracted and shared by both commands), plus `stopBefore: "execute"` and `planInput`. Exit with its code.
- **D15 — messages (Q5 answered).**
  - m mode has no `round.md`, so its lines never mention one. Preflight's G1 text already handles m mode (`loop-preflight.ts:198-203`) and stays.
  - `<bin>` is the shell-profile bin, as preflight uses it; the core never hard-codes `opencode-auto`.

  | Situation | Lines |
  |---|---|
  | R-01 established (m) | `✓ round R-01 established: single phase P01-implement` / `next (round-start gate): review the setup and commit it; then list tasks in docs/R-01/P01-implement/tasks.md by hand, or run: <bin> plan <dir> -p <text> \| --file <path>` |
  | R-NN established (phased) | `✓ round R-02 established: <phase list>` / `next (round-start gate): review the round setup, fill in docs/R-02/round.md (goal, acceptance and release criteria), and commit it; then run: <bin> plan <dir> to plan <first phase> (or run to plan and execute)` |
  | Phase planned (phased) | `✓ planned R-01.P02 implement: 4 task(s) in docs/R-01/P02-implement/tasks.md` / `next: review them (edit, close, or plan --append), then run: <bin> run <dir>` |
  | Planned (m) | `✓ planned 4 task(s) (T-012…T-015) into docs/R-01/P01-implement/tasks.md` / `next: review them, then run: <bin> run <dir>` |
  | m, empty index, no input | `ℹ no tasks listed in docs/R-01/P01-implement/tasks.md yet: list them there by hand (docs/T-NNN/todo.md per task), or run: <bin> plan <dir> -p <text> \| --file <path>` |
  | m, tasks listed, no input | `ℹ docs/R-01/P01-implement/tasks.md lists 5 task(s) (2 pending); next: <bin> run <dir>, or add tasks with <bin> plan <dir> -p <text> \| --file <path>` |
  | `run`, m, empty index | today's line (`loop-phase.ts:428`), which also names `plan -p/--file` |

## 4. P3b — `close`, append planning, `--force-close`

### 4.1 Closed units: the readers (0052 D17 "Readers")

- **D16 — a unit is closed when its `done.md` field block carries `Closed: <reason>`.**
  - A `Closed:` line in a `todo.md` means nothing: only the driver renames to `done.md`, and only `close` writes the field.
  - Most readers need nothing (F3). The rest change as follows.

  | Reader | Change |
  |---|---|
  | `scanUnitStates` (`document/unit.ts`) | Also returns `closed: Map<id, reason>`, read from the `done.md` field blocks. |
  | `loadPlan` / `Task` | `Task.closed?: string`. `Plan.closed` maps every closed task named by the plan's tasks, own or external, to its reason. |
  | `readPhases` / `PhaseState` | `closed: Map<id, reason>`. |
  | `status` | Task mark `⊘` for a closed task (`status.ts:9`). `formatPhases` shows `⊘` for a closed phase. |
  | `doneList` (`prompt.ts:598`) | `- [closed] T-006: <title> (closed without completing: <reason>)`. The `head` partial's "already done, do not redo" wording stays: without closures the output is byte-identical, so no golden changes. |
  | `baseCtx` `taskBlock` (`prompt.ts:629`) | For each **effective** prerequisite (`resolveDepends`, explicit or implicit) that is closed, append `[DRIVER] Prerequisite T-006 was closed without completing (<reason>); do not assume its deliverables exist.` This is driver text, so no template changes. |
  | `phase-handover.md` | A new optional block `{{#if closedTasks}}` listing the phase's closed tasks with their reasons, telling the distillation to record them as not delivered. Without closures it renders nothing, so the goldens are byte-identical. |
  | `prevRoundDigest` (`phases.ts:472`) | A closed phase's heading gets ` (closed: <reason>)`. |
  | `trimmedPhases` (`loop-phase.ts:141`) | Only analysis/design phases that are **not** closed count as present. |

### 4.2 `closeUnit` (refines 0052 D17)

- **D17 — targets, closing set and dependencies.** `closeUnit(dir, ref, { reason, cascade?, changes?, phases, acceptanceGate })` lives in a new `src/close.ts`.
  - **Reason:** required, non-empty, one line. It is the `Closed:` value and the commit subject's tail.
  - **Targets.** They must belong to the **current** round (`currentRound`) and be open.

    | Target | Closing set |
    |---|---|
    | `R-NN` | Phased only. Every open phase of the round, and every open task in their indexes. |
    | `R-NN.P<nn>` | Phased only. The phase and its open tasks. A phase after the current one may be closed ahead of time ("skip it this round"). |
    | `T-NNN` | A task listed in one of the round's phase indexes. |

  - **Refused:**
    - done units ("already done", or "already closed: <reason>");
    - units of another round;
    - subtask refs ("subtasks are not closed on their own; close the task");
    - in m mode, `R-01` and `R-01.P01` ("the single phase of m mode never closes; close tasks instead").
  - **Explicit dependents.** An open task whose `Depends:` *list* names a unit in the closing set makes `close` refuse, listing each one: `T-007 depends on T-005 (Depends:); pass --cascade to close it too, or change its Depends: first`. With `--cascade`, those tasks join the set, repeating to a fixpoint, and their reason reads `<reason> (cascade from T-005)`.
    - Only the task's own index can hold such dependents: a later phase's tasks do not exist yet.
    - Phase and round targets already contain their tasks, so this check only fires for task targets.
  - **Implicit dependents** (a missing `Depends:` means the previous sibling) count as satisfied. The `[DRIVER]` note of D16 tells them what they did not get. The `close` output names them.
  - **Subtasks are not cascaded into** (departs from 0052 D17's "→ open subtasks"). Their state files are only read while their task runs, and a closed task never runs again. Renaming them to `done.md` would claim work that was never done and erase the record of how far the task got.
  - **MP.3:** 0051 D4's worktree record does not exist yet. The refusal on it lands with MP.3, which must add the check here.
- **D18 — what `close` writes, tasks first, then phases in index order.**
  - **Task.** Insert `Closed: <reason>` as the last line of the field block. With no field block, it goes after the title and its blank lines, which makes it the block. Then `renameUnitDone` and `tickIndexLine`: the index tick stays the redundant view of `done.md`, and `- [x]` is the only other index state the parser knows.
  - **Phase.** `Closed:` in its `todo.md`, then the **mechanical handover** (below), `renameUnitDone` and a tick in `phases.md`. `completePhase` is bypassed on purpose: the gates are skipped and recorded, never passed.
  - **Round.** Its open phases as above. The round then counts as complete, and `plan` applies G8 unchanged: only the completeness precondition is relaxed.
  - **Mechanical handover** (`P<nn>-<type>/handover.md`), written unless a valid one already exists. It is driver text, not an overridable template, with the four `HANDOVER_SECTIONS` so `validHandover` passes:
    - **Key decisions:** closed not completed, with the reason; done tasks with titles; closed tasks with their reasons.
    - **Constraints and pitfalls:** closed tasks did not deliver their acceptance criteria; the phase's gates (from `phaseGates`) were not checked.
    - **Required reading for the next phase:** the task directories, each marked done or closed.
    - **Artifact index:** the `report.md` of each done task that has one.
    - An invalid partial handover (an interrupted distillation) is replaced. Its text was never committed, or it would have been handed over already.
- **D19 — records cleared: only those of closed units** (departs from 0052 D17's "every resumable record"). These records resume *their own* unit, and closing another unit does not change what that unit's session knows. Clearing them all would, for example, throw away an interrupted T-005 session when a person closes the not-yet-started phase P04. Cleared:
  - the `units.json` entries of closed tasks (a new `forgetUnits(dir, ids)` in `tasks.ts`);
  - `progress.json`, when its `task` is a closed task, or its step `unit` is a closed phase or a phase of a closed round;
  - `handover.json`, when its `task` is closed;
  - the session handover and the test-handover chains of closed tasks, at task and subtask level, as task completion removes them (F12). The deletions go into the close commit;
  - `CURRENT.md`, when its third line names a closed task.

  `.auto/next-task` is untouched: closed ids are never reused (`takenTaskIds` already counts them, F3).
- **D20 — a dirty tree.**
  - Driver-state leftovers are folded into the close commit without asking, as the carryover does.
  - For any other change, `close` refuses (exit 1, listing the files) unless one of two flags is given:
    - `--commit-changes` folds the changes into the close commit and lists them in its body;
    - `--stash-changes` runs `git stash push --include-untracked -m "opencode-auto close <ref> <time>"` in every repository root, nested repositories first, and prints each stash.
  - The names depart from 0052 D17's `--commit` / `--discard`. `--commit` collides with the config flag and would swallow the ref (F8). "Discard" becomes a reversible stash, so no confirmation is needed.
  - An uncommitted round setup (G1) is an ordinary dirty tree: commit it first.
- **D21 — the close commit and its check.**
  - Take `unitBaseline` before writing. Commit with `Auto-Task: <ref>`, `Auto-Stage: force-close` and subject `<ref> closed: <reason>` (truncated by `commitTitle`).
  - The body lists every unit closed (cascade marked), the skipped gates of each phase, and the folded files or stash names. `commitTree`/`message()` gain an optional `body` (F7).
  - Then `unitViolations(baseline)`. A commit failure or close-out problem exits 2.
  - Outside git, the files are written and no commit is made (a note says so).
  - Closed units skip the unit-close P1 scan. The output warns that the whole-tree scan at round close (G8) still applies.
- **D22 — the shell's `close <ref> [dir] --reason <text> [--cascade] [--commit-changes | --stash-changes]`.**
  - **Arguments.** The ref comes first because it is required: `positional[0]` is the ref and `positional[1]` the directory, overriding the global directory rule for this command. Only these flags are accepted; the two change flags are mutually exclusive.
  - **Order of work:** legacy-layout check, strict config load, lock `"close"`, `closeUnit`, print.
  - **No confirmation prompt:** the explicit ref and the required reason are the confirmation, and everything is reversible (D30).
  - **Exit codes:** 0 closed; 1 refused or usage error; 2 commit or close-out failure.
  - **Output:** the closed units, handovers written, implicit dependents, the P1 warning, then `to undo before anything else runs: git revert <sha>` and `next: <bin> run <dir> to continue, or <bin> plan <dir>`.

### 4.3 Append planning (refines 0052 D18)

- **D23 — `plan --append -p <text> | --file <path>` adds tasks to the current phase.**
  - It never advances to another phase: it targets the phase the route names *now*, including one on the `handover` route whose handover exists or whose gate stopped it.
  - On the `plan` route it plans the phase normally.
  - In m mode `--append` is implied by input on a non-empty index, and accepted as redundant.
  - `--append` without input is a usage error. On a round-setup route it is refused like any input (D5).
  - **Step kind `phase-append`:**
    - it joins `StepKind` (`resume.ts:31`) and `parseProgress`;
    - `phaseToRole` maps it to `phase-plan` (F6);
    - both resume-gate texts get a branch. Step text: `task-append step (phase R-01.P02, appending to the task index)`. Resume note: `You are in the task-appending step: first read this phase's task index tasks.md as it stands (the last session may have appended some tasks), complete the appended tasks after the existing lines without changing existing lines or task documents and without reusing a task number, then end the session.`
    - The open-step precedence re-enters an open `phase-append` step through `appendPlan`, with its persisted input, under `plan` and under `run`, like `phase-plan`. An interrupted append never re-enters a full `planPhase`.
- **D24 — snapshot, reset and collect.**
  - **Snapshot** at step entry, from disk (F1: the tree is clean at HEAD): the index text, its entries, and the text of each existing task's state file.
  - **Reset** (before each fresh attempt; it does not run when a reused session resumes):
    - write the snapshot index text back;
    - restore any changed existing task file;
    - remove the task directories of index ids that are not in the snapshot and not taken elsewhere.
  - **Collect** (`appendProblems`), which reuses the per-task checks split out of `plannedTaskProblems` as `newTaskProblems`:
    - the first *n* index entries equal the snapshot's, in order, with their lines unchanged;
    - at least one new entry follows;
    - each new id passes `newTaskProblems`, with `before` = taken ∪ snapshot ids and the numbering start;
    - no existing task's state file changed;
    - the dependency graph of the whole index passes `unitProblems`, with completed tasks as external ids.
  - **Residual:** if a person *commits* a half-written append before re-running, the snapshot taken at re-entry includes those tasks. Only the tasks after them are checked; `loadPlan` still validates the whole index on the next route.
- **D25 — numbering, commits, stale handover.**
  - **Numbering:** as in D12, from `.auto/next-task` under `autoNumber`, otherwise the highest taken or listed id + 1. `advanceNextTask` over the new ids.
  - **Commits:** the input commit (D9), then the append unit's commit: `Auto-Stage: phase-append`, subject `PLAN append <phase title>`.
  - **Stale handover (F13).** After a successful collect, if the phase's `handover.md` exists, the driver deletes it in its own commit: `Auto-Stage: phase-append`, subject `PLAN append <phase title>: remove the stale handover`. The phase is then distilled again after the new tasks. `acceptance.md` and `verdict.md` stay: the next distillation redrafts the first, and the new tasks may rewrite the second.
  - **Close the step:** `closeStep` runs last, so a kill anywhere before it re-enters the step, which is idempotent.
- **D26 — an append never displaces a task's resume point** (F2). If `progress.json` holds a record whose `task` is an open task, active or summary, the prelude exits 1: `T-005 is mid-pipeline (its resume point is in .auto/progress.json); finish it with run, or close it, before appending`.
  - Rejected alternative: carry the displaced record inside the step record and restore it at `closeStep`. Every writer of the record in `attempt.ts` (`:149`, `:346`, `:365`) would have to keep the extra field, for a case `close` already covers.
  - An append cannot help a blocked task anyway: new tasks go after it, and `next` resumes blocked tasks first.
- **D27 — Q2 answered: a new template `templates/prompts/phase-append.md`, shared by phased and m mode.**
  - The name follows the step, as `phase-plan` and `phase-handover` do.
  - Keeping it separate leaves the phase-plan and implement-plan goldens untouched, keeps the append contract (existing lines are fixed; append only) explicit, and lets projects override it on its own.
  - **Slots:**
    - `phaseName`/`phase`, `phaseId`, `taskIndex`, `numberStart`;
    - `input` and `inputPath` (required);
    - `existingTasks`, one line per task: `- [pending|blocked|done|closed] T-004: <title>`, a closed task with its reason;
    - `brief`, `round`, `handovers`, `modeInit` (phased only);
    - `planDuties` (phased only; m mode has none, as `implement-plan` has none);
    - `parallel`/`parallelRules`.
  - **Body:** the same task-document skeleton and constraints as `phase-plan`, with the task steps reworded: append lines after the existing ones; never edit, reorder or renumber an existing line or task document; write `Depends:` explicitly when a new task does not need the task right before it, because a missing `Depends:` means the previous line.
  - **Tier-1 markers:** the phase-plan skeleton literals, plus `{{taskIndex}}`, `{{existingTasks}}` and `{{input}}`.
  - The renderer `renderPhaseAppend` goes into a new `src/prompt-plan.ts`, together with `renderPhasePlan` and `renderImplementPlan`, which move there from `prompt.ts` (F15).
- **D28 — `plan --force-close <ref> --reason <text> [--cascade] [--commit-changes | --stash-changes]` (refines 0052 D19).**
  - It validates both commands' flags, acquires the lock once, runs `closeUnit`, then runs `plan` (the prelude and the loop) in the same process.
  - A refused close exits 1 with nothing done. A failed close commit exits 2. After a successful close, the exit code is `plan`'s.
  - `--reason` is **required** (0052 D19 had it optional): the `Closed:` field and the mechanical handover need it.
  - **A closed phase gets the same mechanical handover as under `close`** (departs from 0052 D17's "`plan --force-close` runs the normal distillation session"). A distillation session for a closed phase would have to pass `completePhase` without its gates, a second path through the one choke point 0049 G7 keeps. The mechanical handover points the next planner at the task directories, and the next planning session reads what it needs.
  - Typical use:
    - `plan --force-close T-005 --reason "…" --append -p "do X instead"` replaces a task;
    - `plan --force-close R-01.P02 --reason "…"` skips to the next phase and plans it.
- **D29 — pointers and the invariant.**
  - **FAIL message** (`runner.ts:422-426`): `… accept the result with <bin> close T-005 --reason <text>; or replace the task with <bin> plan --force-close T-005 --reason <text> --append -p <what to do instead>; or list fix tasks before it in <index> by hand; then re-run.`
  - **Phase gate stop** (`logGateStop`, `loop-phase.ts:351-363`):
    - the rework line becomes `append fix tasks with <bin> plan <dir> --append -p <text> (the stale handover is removed and distilled again after them)`;
    - a new line reads `to close the phase without its gate: <bin> close R-01.P02 <dir> --reason <text>`.
  - **Invariant** (`auto-core/AGENTS.md:77`):
    - "a unit is done only when its artifacts are on disk and committed" gains ", or when a person closed it with `close` — its `Closed:` field records why";
    - "a FAIL stops the run for a person to edit PLAN.md" (stale since M3.4) becomes "for a person to accept it with `close` or rework it".
- **D30 — Q6 answered: no `reopen`; `git revert` of the close commit is the undo.**
  - A revert restores `todo.md`, drops the field, un-ticks the index and removes the mechanical handover.
  - The runtime state D19 cleared is not restored, so the task restarts fresh, which is the right outcome for a reopened task.
  - The revert commit has no `Auto-Stage` trailer, but it happens between runs, before any unit baseline, so no close-out check sees it.
  - `close` prints the exact command and limits it to "before anything else runs": once later work builds on a closure (the next phase planned), a revert leaves two open phases, and `reopen` could not do better.
  - Revisit if field use shows reverts going wrong.

## 5. P3c — lifecycle leaves `init`

- **D31 — `init` writes the config layer only** (0052 D20). The round step leaves it: `establishRound` with its `phases.md`, phase directories, `round.md` stub and `AGENTS.md.bak`.
  - **Retired flags:**
    - `-p/--prompt` on `init`: `init no longer writes the project brief: edit .opencode/auto/brief.md (the stub is there); planning input is plan -p`;
    - `--amend`: names `amend <dir> --<key> <value>`.
  - **Closing line:** `next: <bin> plan <dir> (establishes round R-01 and stops at the round-start gate)`.
  - **Kept:** the read-only prefix guard (`plannedPhaseUnits`), relaxed when the current round is complete (D32).
  - **Continuity:** a project that is mid-round keeps its rounds. `init` no longer touches `docs/`, so a changed `phases` shows up as a drift (D34).
- **D32 — `amend` drops its round step** (0052 D25 transition). `init` and `amend` keep one read-only prefix-guard check each, **skipped when the current round is complete**: the new `phases` then applies to the next round, which is what `continue` offered (0052 §4.1 addition 3).
- **D33 — `continue` retires** (0052 D21): `continue is retired: once the round is complete, fill in ## Close of docs/R-NN/round.md, commit, and run <bin> plan <dir> — it runs the round-close checks and opens the next round`. The `--continue` option messages name `plan`. The continue-only code (its prechecks and its closing lines) is deleted.
- **D34 — phase-index drift** (0052 D22; **Q4 answered: `run` does not re-sync**).
  - **Detection.** A new `phaseTailDrift(dir, round, phases)` in `phases.ts` compares the unstarted tail of the current round's index with `plannedPhaseUnits`. It returns undefined for a complete round and in m mode. A prefix-guard failure surfaces as the error that `plannedPhaseUnits` throws.
  - **`run`:** `runAll`'s pre-route (next to the blocked check, `loop.ts:63-69`) stops with exit 1: `⏸ the phase index of round N (…) differs from config phases (…): run <bin> plan <dir> to re-sync its unstarted phases`.
    - The sync is deterministic, but it is a lifecycle step, and U4 gives lifecycle to `plan`.
    - A silent re-sync inside `run` would also start work on a phase list nobody reviewed.
  - **`plan`:** prelude row 3 re-syncs with `syncPhaseIndex`, leaves the change uncommitted like any round setup, and stops (exit 0): `✓ phase index of round N re-synced to config phases (P03 test → P03 verify, …); review docs/R-NN/phases.md, commit, then re-run plan`.
- **D35 — messages** (0052 D23).
  - "establish the round with `init`" becomes `plan` in `phases.ts:332`, `status.ts:27` and `packages/auto/src/index.ts:1147` (`phasesLine`). The core texts take the bin from the shell profile.
  - `roundCloseLines`' "continue will refuse" becomes "plan will refuse to open the next round".
  - Comments naming `init`/`continue` as the round's author (`loop-preflight.ts:192`, `phases.ts:376-381`) are updated when touched.
- **D36 — documentation** (0052 D24).
  - **README:** the new-project flow `init` → `plan` → fill in and commit → `plan` (optional) → `run`, with an m-mode variant; the `plan`, `close` and append sections; the `continue` section removed.
  - **Shell contract:**
    - §A adds `plan` and `close` and drops `continue`;
    - §C lists the new core exports (`lock`, `plan`, `close`, `RunAllOpts.stopBefore`/`planInput`/`append`);
    - §E notes that a shell's `run` inherits the lock from `runAll`.
  - **Also updated:** the glossary, `docs/structure.md`, and `auto-core/AGENTS.md` and `packages/auto/AGENTS.md` (the config-semantics section loses the round step).
  - P3a and P3b each document their own commands in their own change. P3c rewrites the flow.

## 6. Protocol strings (0035 amendment, registered with this design)

Registered in `plans/0035-protocol-string-registry.md`, amendment of 2026-09-23. All are new English literals, so none needs dual-read. Each lands with its stage.

| Literal | Kind | Producer → reader | Stage |
|---|---|---|---|
| `Closed: <reason>` | unit field-block line in `done.md` (task or phase) | `closeUnit` only → `scanUnitStates`, `loadPlan`, `readPhases` (via `parseUnitDoc`, key case-insensitive like `Depends:`) | P3b |
| `plan-input.md` | process-document name in a phase directory; role `planningInput` | driver (verbatim human input) → `planPhase`, `appendPlan` | P3a |
| `phase-append` | `StepKind` in `.auto/progress.json` (driver-internal) | `appendPlan` → `openStep`, `parseProgress`, `phaseToRole`, resume gate | P3b |
| `.auto/run.lock` | driver-internal file, JSON `{pid, host, command, started}` | `src/lock.ts` | P3a |
| `Auto-Stage` values `plan-input`, `phase-append`, `force-close` | commit trailer values (not parsed; only the trailer's presence is, F7) | driver commits | P3a / P3b |
| `Auto-Stage: implement-plan` | retired value | — | P3a |
| `phase-append` template | new tier-1 `PROTOCOL_MARKERS` entry: the phase-plan skeleton literals + `{{taskIndex}}`, `{{existingTasks}}`, `{{input}}` | `templates/prompts/phase-append.md` | P3b |
| `{{#if input}}` in `phase-plan.md`, `{{#if closedTasks}}` in `phase-handover.md` | optional blocks, **not** markers (older overrides keep loading) | templates | P3a / P3b |

Not registered, because the driver does not parse them: the `[closed]` label in the done list (session-facing prose, like `[done]`), the mechanical handover's prose (its four headings are the existing `HANDOVER_SECTIONS`), and the `[DRIVER]` prerequisite note (the marker itself is already registered as language-neutral).

## 7. Module map

| Module | Domain | Stage | Content |
|---|---|---|---|
| `src/lock.ts` (new) | driver | P3a | D1–D2 |
| `src/plan.ts` (new) | driver | P3a | `planPrelude` (D4); `phaseTailDrift` callers (P3c) |
| `src/plan-input.ts` (new) | driver | P3a | `PLAN_INPUT_NAME`, read / persist / commit (D9) |
| `src/loop-plan.ts` (new, pure move first) | driver | P3a | `planPhase`, `planWithStep`; `appendPlan` in P3b |
| `src/prompt-plan.ts` (new, pure move first) | driver | P3a | `renderPhasePlan`, `renderImplementPlan`; `renderPhaseAppend` in P3b |
| `src/close.ts` (new) | driver | P3b | `closeUnit`, the mechanical handover (D17–D21) |
| `src/implement.ts` | — | P3a | deleted |
| `src/loop.ts`, `loop-phase.ts`, `loop-preflight.ts` | driver | P3a | lock, `stopBefore`, open-step order |
| `document/roles.ts` | document | P3a | role `planningInput` |
| `document/unit.ts`, `tasks.ts`, `phases.ts`, `status.ts`, `prompt.ts` | — | P3b | closed readers (D16); `phaseTailDrift` (P3c) |
| `resume.ts`, `chain.ts`, `resume-gate.ts`, `unit-commit.ts` | driver | P3a/P3b | role pass-through (P3a); `phase-append` (P3b) |
| `git.ts` | driver | P3b | commit `body` |
| `packages/auto/src/index.ts` | shell | all | `plan`, `close`; retired flags. If it passes ~1400 lines, the command blocks move to `src/commands/` in a pure-move commit first. |

Every new flat module gets a `CLASSIFIED` entry in `test/import-direction.test.ts`. `src/plan.ts` must not import the loop: the prelude runs before any agent starts.

## 8. Test plan

- **Core unit tests.**
  - `lock.test.ts`: acquire and release, re-entrancy, a stale pid, a foreign host, an unparsable file, and the exit handler run in a child process.
  - `plan.test.ts`: every prelude row, over docs-tree fixtures (git fixtures for G8, as `round-gates.test.ts` does), including input refusals and D26.
  - `close.test.ts`, on git fixture repositories:
    - task, phase and round targets;
    - explicit dependents refused and cascaded, implicit dependents noted;
    - the m-mode refusals;
    - both change options, and a dirty-tree refusal;
    - records cleared only for closed units;
    - trailers and body, and the close-out check;
    - `git revert` restoring the pending state.
  - Readers: `scanUnitStates` closed map, `status` marks, `doneList`, the `taskBlock` note, the handover `closedTasks` block.
  - Goldens: byte-identical with no closures and no input (`golden.test.ts` without `UPDATE_GOLDEN`). A new golden for `phase-append`.
  - `template.test.ts`: `phase-append` markers.
  - `resume` / `chain` / `resume-gate` tests: `phase-append`. The strict-resume role pass-through.
- **Loop harness (new).** `test/fixtures/loop.ts` builds a `LoopCtx` on `fakeAgent`, whose prompt handler writes planning artifacts (F14). It covers:
  - `stopBefore` after planning, through a handover, and on an execute route with and without input;
  - m-mode planning: input persisted and committed, `next-task` advanced;
  - a changed input forcing a new session;
  - an open `phase-plan` / `phase-append` step re-entered under `run`, including m mode;
  - the append collect's feedback retry (a session that edits an existing line);
  - reset restoring the snapshot;
  - the stale handover removed.
- **Shell e2e** (`packages/auto/test/e2e.test.ts`):
  - `plan` establishing R-01 (m and phased) with the G1 lines;
  - input on an unestablished round: exit 1, nothing written;
  - a complete round: G8 fail → exit 2, pass → R-02;
  - `init` refused while another process holds the lock;
  - `close` argument errors;
  - `--implement-*` retired;
  - P3c: `continue` retired, and `init` no longer establishing the round.
  - The `continue`, `init -p` and implement-shortcut tests are rewritten or removed with the stage that retires them.
- **Real agent** (`OPENCODE_AUTO_E2E=1`): `plan -p` on an m project end to end; `plan` on a phased round through the stop, then `run`.

## 9. Points for ruling

Answers to 0052's open questions (recommendations):

| # | Question (0052 §8.4) | Recommendation |
|---|---|---|
| Q1 | Planning-input files | One `plan-input.md` per phase, the latest input; history in git; committed on its own before the planning unit; a changed input restarts an open step in a new session (D9). |
| Q2 | Append template | New `phase-append.md`, shared by both modes (D27). |
| Q3 | Lock across hosts | Record the hostname; a foreign-host lock counts as live (D1). |
| Q4 | `run` re-syncing the tail | No: `run` exits 1 naming `plan`; `plan` re-syncs and stops for review (D34). |
| Q5 | m-mode G1 and stop lines | The texts in D15. |
| Q6 | `reopen` | No: `git revert <sha>`, printed by `close` (D30). |

Refinements of, or departures from, 0052 decisions:

| # | Point | Proposal | 0052 said |
|---|---|---|---|
| Q9 | `plan` on an execute route | Exit 0 with a notice without input; exit 1 with input (D7) | D14: refuse |
| Q10 | When `--implement-*` retires | P3a, with `implement.ts` (D13) | D20: P3c |
| Q11 | `close` and subtasks | Not cascaded; their files stay as the record (D17) | D17: cascade to open subtasks |
| Q12 | Records `close` clears | Only those of closed units (D19) | D17: every resumable record |
| Q13 | A phase closed by `plan --force-close` | Same mechanical handover as `close`; no distillation session (D28) | D17: normal distillation |
| Q14 | Dirty-tree options | `--commit-changes` / `--stash-changes` (a reversible stash) (D20) | D17: `--commit` / `--discard` with confirmation |
| Q15 | `--reason` | Required for `close` and `--force-close` (D17, D28) | D19: optional for `--force-close` |
| Q16 | G8 failure under `plan` | Exit 2 (D4) | `continue`: exit 1 |

New choices this design makes:

| # | Point | Proposal |
|---|---|---|
| Q17 | Input on a round-setup route | Refused before any write (D5) |
| Q18 | Completing the round inside `plan` | Stop with the round-close report; the next `plan` opens the round (D8) |
| Q19 | Append while a task is mid-pipeline | Refuse (D26) |
| Q20 | Argument order of `close` | `close <ref> [dir]` (D22) |

## 10. Steps

Each step ends with `bun typecheck` and `bun test` in `packages/auto-core` and `packages/auto`. Commits need the user's confirmation (root `AGENTS.md`).

- [x] **Design pass** (this document; the 0035 amendment; planned glossary rows).
- [ ] **P3a**
  - [x] A1 `src/lock.ts`; `runAll` acquires; `init`/`amend`/`fix`/`reset` refuse; `status` line (D1–D3). Implementation notes:
    - `lockStatusLine(holder)` renders `status`'s first line; the shell prints it before the config line.
    - `continue` refuses too, until C2 retires it: it writes the config and the round setup.
    - When acquiring creates `.auto/`, release removes it again while it is empty, so a run refused in preflight leaves the directory as it found it.
    - The §8 lock items landed with the step: `test/lock.test.ts`, and the shell e2e for the refusals and the `status` line.
  - [x] A2 Pure moves: `planPhase`/`planWithStep` → `loop-plan.ts`; planning renderers → `prompt-plan.ts`. Implementation notes:
    - `phaseState` and `phaseTitle` moved with the planner and are exported from `loop-plan`, which `loop-phase` imports. The direction is `loop-phase` → `loop-plan` → `loop-task`, with no cycle.
    - `prompt-plan` renders through `prompt.ts`'s own helpers, now exported (`renderPrompt`, `intentText`, `phaseTag`, `modeText`), so there is still one render exit. `prompt.ts` keeps its import set, so its `FROZEN_IMPORTS` entry is unchanged.
    - No re-exports are left. The four tests that render the planning prompts import `prompt-plan`, and the goldens are byte-identical.
  - [x] A3 `plan-input.ts`, role `planningInput`, the `phase-plan.md` input block, the missing-slot warning (D9–D11). Implementation notes:
    - `PLAN_INPUT_NAME` lives in `docpaths.ts`, next to `ROUND_BRIEF_NAME`: the role pattern in `document/roles` needs it, and the document domain must not import a driver module. `plan-input.ts` holds the path, read, persist and commit.
    - A changed input does not set `newSession`. Under strict resume, `newSession` rolls the open step back to its recorded baseline, which predates the input commit, so the rollback would stash the new input away. `requireArtifact` takes `spec.restart` (a reason) instead: the open record is replaced as for a fresh step, with no reuse and no rollback, and the unit's clean gate records a new baseline after the input commit.
    - `LoopCtx.input` is the consumable input: `planPhase` persists it, then clears it. Nothing sets it until A5 seeds it from `RunAllOpts.planInput`, so for now a planning step only reads an existing `plan-input.md`.
    - The missing-slot warning fires whenever the step plans against an input, new or persisted: either way the session would not see it. `templateRenders` (`template.ts`) walks the active template and the partials it references.
    - The §8 items that need no loop harness landed with the step: `test/plan-input.test.ts`, the role rows, `templateRenders`, the input block's render test, and `spec.restart` in `artifact.test.ts` (strict resume included). The loop-level cases stay in A7.
  - [x] A4 m-mode planning on `planPhase`; open-step order; `resumeModelNow` role; delete `implement.ts`; retire `--implement-*` (D12–D13). Implementation notes:
    - `planPhase` branches on `ctx.manual` for the prompt, the role and the prompt's number start only; the phased prompt assembly (handovers, previous round, round brief) moved into a private `phasePlanPrompt`. m mode renders `implement-plan` with `file` set to the phase's `plan-input.md` path. Each mode keeps its retry-feedback text: the phased "write one explanatory task" clause stays phased-only.
    - Numbering: under `autoNumber`, both modes take the start from `.auto/next-task`, check it in `collect` and advance it. Without it, m mode's prompt starts after the highest taken id and `collect` checks only the taken ids, as `implementPlan` did.
    - m-mode planning needs an input. `planPhase` returns 1 when there is neither `ctx.input` nor a non-empty `plan-input.md`, checked before numbering so no restore session starts. The loop routes m mode to planning only with `ctx.input` (seeded in A5) or an open step, so the check is a backstop.
    - `statsPhase` and the open-step check moved ahead of the m-mode branch together. An open m-mode `phase-plan` record with no input (neither `ctx.input` nor a non-empty file) is closed with a warning.
    - `resumeModelNow` takes an optional `role`; `requireArtifact` passes `spec.role`, and `runner.ts` is unchanged.
    - Shell: `--implement-file` / `--implement-prompt` are `RETIRED_FLAGS` entries, still value-parsed. The run, continue and amend messages, init's checks, its task-index guard, the `subtask`/`wrapup` defaults and the `implementPlan` call are gone. init's note that `--auto-number` has no effect under `phases = "m"` went too, since m-mode planning now consumes the record.
    - README: the shortcut section became "由 AI 规划任务" (the retirement and how m-mode planning works); A6 adds the `plan` section. Until A6 the retired notice names a `plan` command that does not exist yet.
    - Tests: the strict-resume role pass-through (`artifact.test.ts`, `unit-commit.test.ts`); one e2e test of the retired notice replaces the shortcut block; the amend refusal and auto-number e2e tests are updated. The loop-level m-mode cases stay in A7.
  - [x] A5 `stopBefore` in `runAll`/`runPhaseLoop`; `planPrelude` rows 1–2 and 4–9 (D4–D8). Implementation notes:
    - `planPrelude(dir, { phases, build, input })` lives in `src/plan.ts`. `append` joins it with row 10 (B3). `<bin>` comes from the shell profile, as in preflight, not from an option. The prelude runs the legacy-layout check itself, so it never writes into an old layout, whoever calls it.
    - Row 1 means the current round's phase index is missing. For R-(N>1) the previous round must also be complete, as `continue` required, before its G8 re-runs; otherwise exit 1 with nothing written.
    - Row 6's input check follows the loop. The target is the current phase when it plans tasks; otherwise it is the first phase after the handover, skipping task-less phases. A target whose index already lists tasks also refuses the input, because the loop would stop on its execute route.
    - A G8 failure exits 2, printing `roundCloseLines` between a heading and a `next:` line. `roundCloseLines`' failure heading no longer names `continue`: "the next round cannot open until these are fixed".
    - The stop lines live in `plan.ts` (`executeNotice`, `emptyIndexNotice`, `plannedLines`, `roundCompleteNext`). The prelude and the loop share them, so `plan` says the same thing wherever it stops. Pointers to commands that do not exist yet are left out: `plan --append` and `close` join the execute notice and the planned lines in P3b (B3, B5). Until then, the refusal of input on a planned phase says appending arrives with `plan --append`.
    - Loop:
      - `LoopCtx.input` is seeded from `planInput`.
      - `LoopCtx.planned` holds the ids of the last planning step, not a count, because m mode's summary names the id span.
      - Under `stopBefore`:
        - `planWithStep` prints the summary instead of the G5 pause, and both of its call sites return.
        - An execute route prints the notice and returns 0, or 1 when the input was never used.
        - The complete route adds D8's `next:` line.
      - `runPhaseLoop` warns once, on any exit, when the input was never used. This is D8's backstop, and it also covers a gate or a blocked step.
    - `run`'s m-mode empty-index line is now `emptyIndexNotice`, which names `plan -p | --file` (D15). Otherwise `run` is unchanged.
    - Tests: `test/plan.test.ts` covers every prelude row (git fixtures for G8) and the stop lines. The loop-level cases (stopping after planning, through a handover, on an execute route) stay in A7.
  - [x] A6 The shell's `plan`; shared run-options builder; usage text; README `plan` section; glossary rows made live (D14–D15). Implementation notes:
    - The option machinery is shared, not duplicated: `refuseFrozenFlags`, `parseSessionFlags`, `loadRunConfig` (strict load + mode check), `logRunBanner` and `runOptions` serve `run` and `plan` alike; `run` keeps its own `--wait-between` / `--max-sessions` parsing and `--dryrun`, `plan` its prelude. Order inside `plan`: flags → input (`-p`/`--file` mutually exclusive, non-empty, `--file` a regular readable file) → session flags → config → lock `"plan"` → prelude → `runAll` with `stopBefore` + `planInput`.
    - `plan` refuses a directory without `config.json` ("nothing to plan") rather than planning with defaults: the prelude would otherwise write a round setup into a tree `init` never configured (run's default-tolerant load stays — it writes nothing itself).
    - `-p`/`--file` are refused on `run` (the input is plan's; `-p` was silently ignored before), and `--file` on init/continue/amend. `reset`/`fix`/`check`/`status` refuse them through their existing flag whitelists.
    - A prelude stop prints code-0 lines on stdout and failures on stderr, exits with its code, and releases the lock before exiting; the loop path starts the log file and banner after the prelude (a stop never creates `.auto/logs/`).
    - The retired `--implement-*` notice now names a command that exists.
    - Docs: README gains the plan section (usage list, run-lock paragraph, continue cross-note, AI-planning pointer); glossary rows run lock / lifecycle command / plan prelude / stop condition / planning input are live (`close` stays planned); shell-contract §A and §C (A6 entry; the MP.1 entry's stale `implementPlan` reference fixed); `packages/auto/AGENTS.md` navigation line.
    - Tests: the §8 items needing no agent landed with the step — every prelude stop over CLI fixtures (establish m/phased via the G8-pass path, input refusals before any write, G8 fail → 2 / pass → R-02, the m and phased notices, the lock refusal, the argument refusals). The pre-existing flake in the `fix` e2e test (its trailing `run --dryrun` reached a live local `opencode` server) is made deterministic with `--server http://127.0.0.1:1`; the loop-level paths stay in A7.
  - [x] A7 Tests (§8, P3a parts), including the loop harness. Implementation notes:
    - `test/fixtures/loop.ts` drives `runPhaseLoop` as a `LoopCtx` over the native fake agent on a real git repository, so the commit boundary stays live (the input commit, the clean gate, the unified commit, the close-out check). Its default turn writes what the collect checks look for: a planning turn (both prompts carry the phase's `tasks.md` path) writes the index and one task document numbered after the highest `docs/T-NNN` on disk, a handover turn (the distiller marker) writes the four-section handover; the `OPENCODE_AUTO_*` env is scrubbed around each run and `console.log` is captured.
    - `test/plan-loop.test.ts` covers the loop-level cases A3–A6 left here: the stop after a planning step (summary replaces the G5 pause, resume point closed, tree committed), through a handover (distillation, archive, tick, then the next phase's planning), the execute-route stop with and without input (exit 0 / 1, the unused-input warning, nothing persisted), the complete route's `next:` line without opening a round (D8); m-mode planning (input committed on its own with both subjects and `Auto-Stage` trailers, `next-task` advanced, the m summary line); a changed input restarting an open step in a new session (the recorded session never probed or prompted); the open `phase-plan` step re-entered under `run` reusing the recorded session, phased and in m mode (no `create` call); the m-mode open step without input closed with a warning, file routing continuing.
    - The reuse-eligible recorded session is seeded through the fake agent's `history` option (a completed assistant message with real context usage), so `sessionAlive`/`sessionUsage` accept it; the restart case uses a recorded id outside the fake's id space, so a fresh session can never be confused with a reuse.
- [ ] **P3b**
  - [ ] B1 Closed readers (D16).
  - [ ] B2 `src/close.ts`, commit `body`, the shell's `close` (D17–D22).
  - [ ] B3 `phase-append`: step kind wiring, template, renderer, `appendPlan`, prelude rows 9–10, `--append` (D23–D27).
  - [ ] B4 `plan --force-close` (D28).
  - [ ] B5 Pointers, invariant, README `close` and append sections (D29–D30).
  - [ ] B6 Tests (§8, P3b parts).
- [ ] **P3c**
  - [ ] C1 `init` config-only; `-p`/`--amend` retired; `amend` drops its round step; relaxed prefix guards (D31–D32).
  - [ ] C2 `continue` retired (D33).
  - [ ] C3 `phaseTailDrift`; `run` exit 1; prelude row 3 (D34).
  - [ ] C4 Messages; README flow; shell contract; glossary; structure; package `AGENTS.md` files (D35–D36).
  - [ ] C5 e2e rewrite (§8, P3c parts).

## 11. Relationship to other designs

- **0052:** this is its P3 design pass. The 0052 rulings U1–U6 stand. §9 lists every departure from a 0052 decision for ruling. Once ruled, 0052 §6 points here, and the P3 steps are tracked in §10 of this document.
- **0018 (session-resume precedence):** extended to `phase-append`, and moved ahead of the m-mode branch (D12).
- **0021 (commit boundary):** the input commit precedes the unit baseline (D9). The close commit runs the close-out check (D21).
- **0022 (strict resume):** the role pass-through (D12).
- **0047:** the two-file-state invariant holds. `Closed:` is a field (D16).
- **0049:**
  - G1 is unchanged, and the establishing routes print it (D4, D15).
  - G5 gets a command (D6).
  - G7 keeps its single choke point: closures bypass it and record that they did (D18, D28).
  - G8 stays the gate for opening a round, exiting 2 (D4).
- **0051 / 0013 (MP.3):** the lock is held by the parent (D3). `close` must learn the worktree record when MP.3 adds it (D17). Append numbering uses the parent's `.auto/next-task`.

<!-- auto: eof -->

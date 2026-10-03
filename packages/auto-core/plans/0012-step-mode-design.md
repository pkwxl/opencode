# Step Mode Design

Status: implemented (2026-09-07). During the experimental period it is controlled via environment variables, with zero CLI-shell changes.

## 1. Motivation

When debugging or observing the pipeline, you need to stop at key boundaries and inspect the artifacts by hand (git log, docs/, PLAN.md)
before releasing it manually. The existing `--wait-between` is a **time-limited** pause between tasks (auto-continues on timeout),
which does not fit the stepping scenario of "continue only after a human has looked"; step mode provides a **hard pause** (an indefinite wait for Enter).

## 2. Switch

| Env var | Value domain | Default |
|---|---|---|
| `OPENCODE_AUTO_STEP` | off\|phase\|task\|subtask | off |

Registered in the OPENCODE_AUTO_* registry in `src/switches.ts`: parsed once inside the core (memo),
consistent across the whole pipeline, not persisted to disk (experimental semantics = this run only); an invalid value throws a Chinese-language error (including the variable name
and the expected value domain) → CLI exit code 1. Non-default effective items go into the startup log, same treatment as the existing switches.

## 3. Semantics

### 3.1 Inclusive Granularity

Three levels of fineness, phase < task < subtask; **pause whenever boundary order ≤ tier order**:

| Tier | Pause boundaries |
|---|---|
| off | None (default, zero behavior) |
| phase | Phase handover completed |
| task | Task completed + phase handover completed |
| subtask | Subtask completed + task completed + phase handover completed |

### 3.2 Hard Pause

- Waits for one line of human input; any line (including an empty Enter) releases it, the content is not interpreted, and there is **no timeout auto-continue**
  (unlike `--wait-between`).
- Under `--interactive` it is received through the resident input line (the no-timeout form of `Interactive.question`),
  sparing two readlines from fighting over stdin; when stdin closes (pipe ended) it falls back to auto-release.
- During a pause-wait, ^C is forwarded to the process-level handler: one press gives a prompt, two consecutive presses force-exit with 130
  (consistent with askHuman / waitBetweenTasks).

## 4. Hook Points

| Boundary | Location | Timing |
|---|---|---|
| phase | `src/loop.ts` runPhaseLoop (handoverWithStep wrapping) | After the phase handover (archive + ledger + commit) completes and before the next round's routing; after the last phase's pause, pressing Enter exits as "all phases completed" |
| task | `src/loop.ts` runTaskLoop | After the task's done final-state commit, before final-review routing and the next task (T-F tasks appended by final review pause the same way) |
| subtask | `src/runner.ts` pipeline subtask loop | After the checklist check-off and the unified commit complete, before the next checklist item (fix checklist items injected by review run in the same loop and are covered too) |

## 5. Edge Cases

- Single-phase `m` mode (`--phases` default): no handover boundary → `step=phase` has no pause point;
  task/subtask pauses still take effect as usual.
- `--subtask off/ondemand`: no checklist loop → no subtask pause point; task/phase as usual.
- Independent of `--wait-between` (one is a hard pause, the other is time-limited); if both are set, each takes effect.
- `--dryrun` / `init` / `check` / `status` have no pause points and are naturally unaffected.
- After a task's last checklist item completes, the task pause follows immediately; after a phase's last task completes, the phase pause
  follows immediately - two consecutive pauses are expected under the inclusive semantics.

## 6. Implementation and Tests

- `src/step.ts`: the `stepApplies(step, boundary)` pure function (fineness-order judgment, directly unit-tested);
  `stepPause(boundary, label, opts)` pause IO (resident line under interactive / hard readline wait,
  io injected for unit tests; opts.step explicitly overrides the tier, defaulting to the parsed OPENCODE_AUTO_STEP value).
- `src/interactive.ts`: in `question(promptText, minutes?)`, minutes defaults to no timeout
  (close still falls back to undefined); the askHuman / waitBetweenTasks call sites are unchanged.
- Tests: `test/switches.test.ts` (value domain / defaults / invalid values / logging) + `test/step.test.ts`
  (inclusive matrix, Enter release, stdin-closed fallback, interactive passthrough).

## 7. Promotion Path

After the experiment settles, it is promoted to the CLI flag `--step=phase|task|subtask` (or persisted as a constitutional key, to be decided separately),
following the same path as plans/0003-fork-decompose-design.md §4.6: the environment variable may remain as a runtime override channel or be retired.

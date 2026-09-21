# 0042 Agent track verification (MA.6): a native fake and a dual-backend run

> Milestone MA.6 of `plans/AUTO_NEXT_REFACTOR_PLAN.md` (root). It closes the
> MA agent track (MA.1–MA.5, `plans/0037`–`0041`) before the track merges
> back into auto-core on its own. A stage-assisting document per D6: it
> retires as history once the merge is done.

## 1. Scope

1. **Unit layer.** A native `AgentClient` fake and a driver suite that runs
   against it (§2).
2. **Real layer.** One sample project, run once under opencode and once
   under claude, with artifacts and flow logs compared (§3). This run is the
   template for later adapters (qoder / kimi / codex, each a separate task).
3. **Merge-back** into auto-core without waiting for the loop track (§5).

## 2. Unit layer: the driver over any agent

Before MA.6, every driver-level test reached the driver through the opencode
adapter: the fakes in `test/fixtures/runner.ts` imitate the opencode SDK and
are wrapped in `opencodeAgent(...)` (MA.3 D-strategy). That covers the
adapter's mapping end to end, but it cannot show that the driver needs
nothing beyond `src/agent/types.ts`. `test/agent-claude.test.ts` covers the
claude adapter the same way, through its own subprocess double.

- `test/fixtures/agent.ts` implements `AgentClient` directly. It emits
  `AgentEvent`s, its capabilities can be set per test, and it records every
  call with its arguments. Turns are scripted: each `prompt` or
  `promptAsync` runs a script and publishes the events to every live
  subscription on the next tick. Messages are kept as history when `history`
  is on, and forks copy that history up to the anchor. Two presets are
  provided: `FULL_CAPABILITIES`, and `BARE_CAPABILITIES`, which has no
  resume, no fork, no steer, no abort, no question, no permission, no
  history and usage `none`.
- `test/agent-fake.test.ts` has 24 cases in 8 groups:
  - dispatch and settle: subscribe before dispatch, closing words, usage
    against the window, a routed model sent as an opaque string, create and
    dispatch failures blocking instead of throwing, reuse with rename;
  - usage tiers: `events` sends the steer hint, `reported` does not, `none`
    measures nothing and never asks for limits;
  - length resume, with and without steer;
  - questions and permissions: answer, repeat → reject + abort + blocked,
    the three `--permission` outcomes, other sessions' events ignored;
  - error signals: the adapter's own `errorPatterns`, a quota retry signal
    settling early with abort, transport loss, a retry through a fork or a
    new session;
  - forks, history and liveness: the three fork granularities, usage rebuilt
    from history or unknown without it, a warm or cold fork base, `get`
    resume checks and probing;
  - the barest agent: `degrade` clamps all five switches, and two prompts
    still run on only `create` + `events` + `prompt` (plus the display-only
    `defaultModel`);
  - a closing roster check that all 14 `AgentClient` calls were exercised.

What this does not replace: adapter-specific mapping stays with
`agent-client.test.ts` / `agent-events.test.ts` (opencode) and
`agent-claude.test.ts` (claude).

## 3. Real layer: one project, two backends

**Setup (2026-09-21).** The project was a git repo with a README, empty
`src/` and `tests/` packages, `opencode-auto init . --subtask auto --phases m`
(defaults otherwise: mode migrate, context-limit 64k, verify off, commit on,
wrapup on), and one task in PLAN.md: two independent stdlib Python modules,
`slug.py` (`slugify`) and `wrap.py` (`wrap`), each with its own unittest
suite. It was committed once and cloned twice. Both runs used the auto-next
driver from source (`bun run packages/auto/src/index.ts run <dir>`) with the
same flags and ran in parallel:

| | opencode | claude |
|---|---|---|
| selection | default | `OPENCODE_AUTO_AGENT=claude` |
| model | `OPENCODE_AUTO_MODEL=deepseek/deepseek-v4-pro` | `OPENCODE_AUTO_MODEL=claude/haiku` |
| agent | opencode 1.18.16 from source (`packages/opencode`, unchanged on this branch) | claude CLI 2.1.278 |

The models differ on purpose. Each backend ran with the model it has
credentials for, so the comparison is about the driver's flow and the shape
of the artifacts, not about the content the model wrote.

**Outcome.** Both runs exited 0, with the task `[done]` and a clean
worktree.

| | opencode | claude |
|---|---|---|
| driver commits (Auto-Stage) | decompose, carryover, S1, S2, wrapup, done | same six, same order |
| tracked files after the run | — | identical set (`docs/T-001/{context,shared,subtasks,report}.md`, `S01`/`S02` `{done,index}.md`, `src/{slug,wrap}.py`, `tests/test_{slug,wrap}.py`) |
| todo → done | S01, S02 | S01, S02 |
| fork base | digest base, 10.2k prefix, 2 subtask forks | digest base, 23.3k prefix, 2 subtask forks |
| sessions | 5 | 6 (one shape-check re-prompt, below) |
| tests | 18 pass | 49 pass |
| wall time / cost | 5m27s / $0.045 | 5m03s / $0.50 |
| context shown | x / 1000k (deepseek window) | x / 200k (claude window, learned in-turn) |

**Cross-check.** Each backend's test suite was also run against the other
backend's modules (claude's 49 tests on opencode's code, opencode's 18 on
claude's code). Both passed, so the two implementations agree on the spec.

**Flow-log deltas, all expected:**

- claude run start: `◇ claude 2.1.278`, `◇ agent: claude`, and two MA.4
  notes: the permission preset (`ask-deny → deny`) and "no readable
  history". No switch was clamped, because the run turned none of those
  switches on.
- claude decompose: both `S0n/todo.md` files were missing the eof
  terminator. The shape check re-prompted once with feedback, on a fork of
  the ended session (`forkEndedSession`, fork = session), and the retry
  passed. This is 0026 S9's feedback path exercised on the second backend. It
  accounts for the sixth session.
- The billing mix differs because the providers report cache differently
  (claude: cache-read 1.98M + cache-write 84k; deepseek: cache-read 499k,
  no write). Both are billed per step-finish, as specified.

No delta points at the driver. Everything above is either the adapter's
declared capabilities or model behavior.

## 4. Environment notes (for the next adapter run)

- No `opencode` binary was installed. A PATH wrapper ran it from source in
  a worktree with a complete install: `exec bun run --conditions=browser
  <worktree>/packages/opencode/src/index.ts "$@"`. The auto-next worktree's
  own `node_modules` is incomplete (`diff@8.0.2` lacks `libesm`), so
  opencode does not start from there. The driver itself does start from
  there, because auto-core does not use that package.
- The runs need network access (a sandboxed shell cannot reach the
  providers).
- Template for qoder / kimi / codex: clone the same sample twice, and run
  the new adapter next to opencode with identical init flags. Compare the
  Auto-Stage commit sequence, the tracked file set, todo → done, the
  run-start capability notes, and cross-run the test suites.

## 5. Merge-back

auto-core has stayed frozen at `b7aeb419f` (M1.6, merge-back #1) since then,
so auto-next is a strict descendant and the merge is a **fast-forward**.
It brings in MA.1–MA.6 plus the two docs-only commits for plans/0036
(`94b6f2aa4`, `b33defe73`), which sit between the two points. Those are
plans/ documents with no code, and leaving them out would take a cherry-pick
series that forks history for nothing. Per D3/D9, the loop track (M2+) keeps
going on auto-next. This fast-forward is **MVR-2**.

# 0041 claude headless adapter (MA.5): the touchstone second agent

> Milestone MA.5 of `plans/AUTO_NEXT_REFACTOR_PLAN.md` (root). It is the
> second adapter behind the frozen interface (`plans/0037`), and the first one
> that is not opencode. It settles the second half of open question 5
> (claude's usage fields) and open question 7 (the contract surface), and
> closes what MA.4 handed forward (`plans/0040` §5). A stage-assisting
> document per D6: it retires as history once MA closes.

## 1. Scope

1. **Process manager.** `src/agent/claude/client.ts` `claudeAgent(options)`
   implements all 14 AgentClient calls over `claude -p` subprocesses. It does
   for claude what `agent/opencode/server.ts` does for opencode.
2. **stdout parser.** `src/agent/claude/stream.ts` `claudeStream(session,
   costBase)` maps each stream-json line to AgentEvents. It is one pure
   function per line plus per-process state, and the mapping table heads the
   file.
3. **Contract translation.** `src/agent/claude/contract.ts` turns the
   driver's opencode-shaped contract and permission file into claude
   arguments at every process start.
4. **Host and selection.** `src/agent/claude/host.ts` provides `claudeHost` /
   `createClaudeHost`. A shell can pass it to `setShellProfile({ agent })`. A
   run can also select it with the new experiment switch
   `OPENCODE_AUTO_AGENT=claude`. The profile wins over the switch, and the
   switch defaults to opencode, so nothing changes for anyone who does not set
   it.

## 2. Fact baseline (measured, claude 2.1.278)

Everything below was observed with real `claude -p` runs (haiku) during
MA.5, not taken from documentation.

| # | Fact | Consequence |
|---|---|---|
| C1 | `--output-format stream-json --verbose` prints one JSON object per line: `system/init` (once per turn), `assistant` lines (one line per content block, all under the same `message.id`, each repeating the message's `usage` with a still-growing `output_tokens`, `stop_reason` always null), `user` lines carrying `tool_result`, `rate_limit_event`, `system/thinking_tokens`, `system/task_*`, and finally `result`. | A message is complete only when something else follows it: a tool result, another message id, or the result. |
| C2 | `result` has the turn's exact `usage` (per turn), `stop_reason`, `is_error`, `api_error_status`, `errors[]`, `permission_denials[]`, `queued_turn_count`, and `modelUsage[model].contextWindow`. `total_cost_usd` is the **session's running total**: it is cumulative within a process, carried across `--resume` (restored from the transcript's `cost-state` record), and inherited by a fork. | Billing = one step-finish per turn from `result`. The cost is billed as the difference from the previous total. |
| C3 | Every `assistant` line has `usage` with `input_tokens` + `cache_read_input_tokens` + `cache_creation_input_tokens`, which together are the whole prompt the model saw. | Context occupancy is known **in-turn**, per API message, so the usage tier is `events` (open question 5, second half). |
| C4 | With `--input-format stream-json`, the process keeps reading stdin while it works. A user message written during a tool call joins the **running turn** at the next tool boundary (one `result`, `queued_turn_count` 0). | `steer: true`. MA.1–MA.4 had assumed `false`. |
| C5 | `--replay-user-messages` echoes each stdin message (`isReplay: true`) at the moment claude consumes it, not when it is read. | This is a reliable "consumed" signal. A `result` that arrives while a written message is still unechoed is not the end of the work. |
| C6 | `--session-id <uuid>` names a new session. `--resume <id> --fork-session --session-id <new>` copies a whole session under an id the caller chooses. There is no message anchor. `--resume` of an unknown id prints `result` with `subtype: error_during_execution` and `errors: ["No conversation found …"]`. | `create` and `fork` mint ids locally. `fork: "session"`. |
| C7 | Killing a process mid-turn (SIGTERM) leaves a transcript that `--resume` continues. | `abort: true` (abort = kill). |
| C8 | An API failure arrives as an `assistant` line with `error` (for example `model_not_found`) and `is_api_error_message: true`, then a `result` with `is_error: true` and `api_error_status`. | This is mapped to an `error` event named by the code. |
| C9 | `system/permission_denied` (`tool_name`, `message`) is printed at the moment a tool call is refused. `--permission-prompts none` refuses anything that would prompt. `--permission-mode bypassPermissions` works under `-p`. | The `block` preset can end the turn on the spot. |
| C10 | claude reads the target directory's `AGENTS.md` natively (a built-in plugin, checked with a probe file). Transcripts live at `$CLAUDE_CONFIG_DIR/projects/<cwd with every non-alphanumeric → "-">/<id>.jsonl`. | `syncContext` is a no-op. `get` can recognize sessions from an earlier run. |

## 3. Decisions

| # | Decision | Content |
|---|---|---|
| D1 | One live process per working session, closed at idle | A prompt spawns (or reuses) the session's process in streaming-input mode and writes one JSON user message to its stdin. A `promptAsync` to a live process is written to the same stdin, which is the steer (C4). At a `result` with nothing unconsumed (no unechoed write, `queued_turn_count` 0; C5) the adapter closes stdin and emits `idle`, and the process exits. The next prompt starts a process with `--resume`. The alternative was to keep processes alive across idle. It was rejected because the driver runs hundreds of sessions and never says when one is finished, so a live process per session would leak. A cold `--resume` costs about two seconds and loses nothing (prompt caching is server-side). A message written to a process that is already closing waits for its exit and goes to the next process. |
| D2 | Capabilities as measured | `resume` true, `fork` "session", `steer` **true** (C4), `abort` true (C7), `question` false (AskUserQuestion is disallowed), `permission` false (fixed per process start), `history` false, `usage` **events** (C3). `history` stays false even though transcripts exist: their format is internal to Claude Code, and the MA.4 degradation (unknown base → cold start, recovered usage unknown) is already safe. With these values MA.4's `degrade` forces only `ASK` off. `--test-by-driver` works because steer is available, and FORK stays on with whole-session forks. |
| D3 | Billing from `result`, cost as a difference | The per-message usage on assistant lines cannot be summed (C1), so each turn gets exactly one `step-start` (first assistant line) and one `step-finish` (at `result`, with the turn's exact tokens). Thinking is moved from `output` into `reasoning`, because claude counts it inside `output_tokens`. The cost is `total_cost_usd` minus the session's previous total (C2). That previous total is tracked per session in the client, a fork starts from its source's total, and a session from an earlier run reads the last `cost-state` record of its transcript (best effort). When the previous total is unknown, the first turn bills **no cost**. Billing the whole history would be much worse, and the tokens stay exact either way. |
| D4 | Context and window | `contextUsed` = input + cache reads + cache writes of the latest API message, reported on the in-progress message and settled when it completes. That is the MA.2 `events` row unchanged. Context windows are learned from `result.modelUsage` into a map that `contextLimits()` hands out **live**, so watch's per-session cached reference sees windows learned later. Before the first result of the run the window is unknown (pct 100, which only turns reuse off). |
| D5 | Model strings | The adapter's form is `claude/<model id>`. The driver's routing requires `prov/model`, so the adapter strips everything up to the first "/" and passes the rest to `--model` (for example `OPENCODE_AUTO_MODEL=claude/haiku`). The model is fixed per process. A prompt naming another model restarts the process between turns. A steer never changes it. `defaultModel` reports the model of the latest `system/init` (display only; undefined before the first start). |
| D6 | Contract surface: translate, do not duplicate (open question 7) | The driver keeps one contract, `.opencode/agent/<name>.md`, and one permission policy, `opencode.json`. Init, reset, preflight and `missingAgentHint` all keep working unchanged for both agents. At every process start the adapter passes the contract body (frontmatter stripped) through `--append-system-prompt` and translates the `permission` rules into `--settings {"permissions": {allow, deny}}`. The keys map as read/glob/grep/edit/write/bash/webfetch/websearch/task → Read/Glob/Grep/Edit+Write+NotebookEdit/…; a pattern table's `"*"` becomes the bare tool, any other pattern becomes `Tool(pattern)`, and `ask` falls to the preset. `AGENTS.md` needs nothing (C10). A second, claude-shaped contract file was rejected: it would need its own init, reset, preflight and drift checks, and would drift from the first. A missing contract fails the dispatch, and attempt adds the existing recovery hint. The ask-fail wording ("allow it in … opencode.json") is therefore correct for claude too, because the rules really do come from there. |
| D7 | Permission preset (MA.4 D4, now honored by an adapter) | `allow` → `--permission-mode bypassPermissions`. `deny` → `--permission-prompts none`, so anything the translated rules do not allow is refused and the session goes on. `block` → the same flags, plus: on `system/permission_denied` the adapter emits an `error` event (`PermissionDenied`, `isRetryable: false`) and kills the process. The turn ends with idle, and the non-retryable error blocks the run as `ask-fail` does (tested through the classifier). |
| D8 | Exit and error handling | A process that exits while a turn is running, and was not killed by us, yields `error` (`ProcessExit`, the stderr tail) + `idle`. It is retryable and classified transient by `CLAUDE_ERROR_PATTERNS`, so the existing retry ladder applies. A kill by `abort()` yields only `idle`. API errors (C8) become `error` events named by claude's code. The adapter's classifier table adds `prompt is too long` → overflow, `billing_error` → quota, `authentication_failed` / `invalid api key` → auth, `rate_limit` → rate, and `server_error` / process exit → transient. `api_retry` system lines, if printed, become `retry` events. |
| D9 | Selection: profile first, then an experiment switch | `OPENCODE_AUTO_AGENT=opencode\|claude` (default opencode) follows the switch invariant: environment only, this run only, invalid value → exit 1. loop.ts uses the shell profile's agent when set, else claude when the switch says so, else opencode. A resumed run that changes backends is safe: ids from the other backend are unknown to `get` and start fresh. `--server` names an opencode server; the claude host warns and ignores it. `agent/claude/host` becomes the third agent-domain entry in the import-direction table (announced there by MA.3). |
| D10 | Environment hygiene | A driver started inside a Claude Code session (developer machines) must not pass that session's identity to its children. The spawn drops `CLAUDECODE`, `CLAUDE_PID` and the `CLAUDE_CODE_{SESSION_ID,CHILD_SESSION,SESSION_ATTENDED,ENTRYPOINT,MESSAGING_*}` variables. |

## 4. MA.4 hand-offs, settled

| Item (0040 §5) | Outcome |
|---|---|
| U7 "has output" signal (estimated tier) | Not needed: claude measures (`events`). It stays with the first adapter whose tier is `estimated`, together with the estimated-tier inputs (inherited start, initial prompt; 0039 §5). The round cap for `none` (0038 D3) is likewise unneeded. No adapter has that tier. |
| Contract wording that says opencode | Settled by D6. The wording is accurate for both agents because the adapter reads exactly those files. |
| Adapter-side preset semantics and `block` | Settled by D7 and tested (the block error classifies non-retryable). |
| `abort` = false has no degradation | Moot: claude reports `abort: true` (kill, C7). |

## 5. Observable deltas

- opencode runs: none. The new switch defaults to opencode, and the
  opencode adapter is unchanged. The only new log output appears when
  `OPENCODE_AUTO_AGENT` is set: the non-default switch line, `◇ claude
  <version>` and `◇ agent: claude`, plus MA.4's degradation notes (ask off
  when requested, the permission preset, no readable history).
- Full-length verbose formatting of switches gains
  `OPENCODE_AUTO_AGENT=opencode`.

## 6. Not done here / open

- **Dual-backend comparison run.** The same sample project under both
  agents, with artifacts and flow logs compared, is MA.6.
- **Interrupting a turn without killing it.** stream-json input has an
  interrupt control request (init advertises `interrupt_receipt_v1`). Kill +
  resume is simpler and suffices, because every abort is best-effort and
  followed by a new or resumed session.
- **Subagent traffic** (`parent_tool_use_id`) is dropped: the stuck detector
  and the logs see only the main session's own tool calls.
- **The contract prose** still tells the model to "call the question tool"
  for permission problems. Under claude that tool is disallowed, so the model
  cannot call it; the permission rules and the preset still decide. Moving
  that sentence into agent-neutral wording belongs to the template batches
  (D7), not to the adapter.
- **Transcript-path dependency.** `get` for ids from an earlier run and the
  cost baseline read Claude Code's transcript location and `cost-state`
  records. Both are best effort, and failing either one degrades safely (a
  fresh session; the first turn's cost unbilled).

## 7. Verification

- `test/agent-claude.test.ts` (18 cases). Parser: a full turn (step-start,
  in-progress and completed messages, tool running → completed, text,
  step-finish with thinking moved to reasoning), cost differences
  (known/unknown base, `max_tokens` → length), API errors and `errors[]`,
  system lines (api_retry, compaction, denial notes), replay and subagent
  drops, tool errors, the error-class table. Contract: frontmatter strip, the
  opencode.json translation, per-preset arguments, a missing contract.
  Process manager over a scripted subprocess double: the first start with the
  minted id (full argument list), idle + stdin close, resume on the next
  prompt, fork arguments, model restart, a steer held until claude echoes it,
  abort → idle, unexpected exit → a transient error, block → a non-retryable
  error + kill, sessions known from transcripts incl. the cost baseline and a
  fork inheriting it, reply calls failing, dispatch failures, stripped
  environment, capabilities through MA.4 `degrade`, and one session driven
  end to end through `runSession` / watch (closing words, measured context
  and window). Host: CLI check, the `--server` warning, restart false, close
  kills.
- `test/switches.test.ts`: the new switch (default, value set, invalid value,
  log lines).
- Import direction: `agent/claude/host` added as an agent entry.
- **Real runs** (claude 2.1.278, haiku): (1) adapter smoke: a turn with a
  Bash tool call and a mid-turn steer consumed in the same turn, a resume
  after idle, a whole-session fork that remembered the source's first
  command, the window learned (200k), and `get` true. (2) Driver end to end:
  `OPENCODE_AUTO_AGENT=claude OPENCODE_AUTO_MODEL=claude/haiku opencode-auto
  run` on a one-task project. It went through decompose → digest fork base →
  a subtask forked from the base → wrapup → done, with 5 driver commits,
  `hello.sh` working, and a total cost of $0.17.
- auto-core full suite and typecheck: see the root plan's MA.5 entry for the
  numbers.

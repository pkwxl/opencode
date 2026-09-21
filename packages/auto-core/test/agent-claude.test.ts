// claude headless adapter (MA.5, plans/0041): the stdout → AgentEvent parser
// against lines shaped like real `claude -p --output-format stream-json`
// output (captured with claude 2.1.278, trimmed), the contract translation,
// and the process manager over a scripted subprocess double — including one
// session driven end to end through runSession / watch.

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { claudeAgent, CLAUDE_CAPABILITIES, CLAUDE_ERROR_PATTERNS, type ClaudeProcess, type ClaudeSpawn } from "../src/agent/claude/client"
import { claudePermissions, contractArgs, contractBody } from "../src/agent/claude/contract"
import { createClaudeHost } from "../src/agent/claude/host"
import { claudeStream } from "../src/agent/claude/stream"
import type { AgentEvent } from "../src/agent/types"
import { degrade } from "../src/capability"
import { classifySessionError } from "../src/chain"
import { runSession } from "../src/session"
import { parseSwitches, SWITCH_ENV } from "../src/switches"
import { task } from "./fixtures/runner"

const SID = "11111111-2222-4333-8444-555555555555"

const usage = (input: number, read: number, write: number, output = 4) => ({
  input_tokens: input,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  output_tokens: output,
})
const assistant = (id: string, block: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: "assistant",
  message: { id, model: "claude-haiku-4-5-20251001", role: "assistant", content: [block], stop_reason: null, usage: usage(10, 12306, 7890) },
  parent_tool_use_id: null,
  session_id: SID,
  ...extra,
})
const toolResult = (id: string, content: unknown, isError = false) => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
  parent_tool_use_id: null,
  session_id: SID,
})
const result = (extra: Record<string, unknown> = {}) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  stop_reason: "end_turn",
  session_id: SID,
  total_cost_usd: 0.0172306,
  usage: { ...usage(10, 12306, 7890, 42), output_tokens_details: { thinking_tokens: 35 } },
  modelUsage: { "claude-haiku-4-5-20251001": { contextWindow: 200000 } },
  queued_turn_count: 0,
  ...extra,
})

describe("claudeStream: stdout lines → AgentEvent", () => {
  test("a turn: step-start, message in progress, text / tool parts, completion on tool result and result", () => {
    const stream = claudeStream(SID, 0)
    const events = [
      { type: "system", subtype: "init", session_id: SID, model: "claude-haiku-4-5-20251001" },
      assistant("msg_1", { type: "thinking", thinking: "", signature: "x" }),
      assistant("msg_1", { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "echo hi" } }),
      toolResult("toolu_1", "hi"),
      assistant("msg_2", { type: "text", text: "DONE" }),
      { type: "rate_limit_event", session_id: SID },
      result(),
    ].flatMap((line) => stream.feed(line))
    expect(events.map((e) => (e.type === "part" ? `part:${e.part.kind}` : e.type === "message" ? `message:${e.message.completed}` : e.type))).toEqual([
      "part:step-start",
      "message:false",
      // redacted thinking: no reasoning part
      "message:false",
      "part:tool",
      "message:true",
      "part:tool",
      "message:false",
      "part:text",
      "message:true",
      "part:step-finish",
    ])
    const tools = events.flatMap((e) => (e.type === "part" && e.part.kind === "tool" ? [e.part] : []))
    expect(tools[0]).toEqual({ kind: "tool", id: "toolu_1", tool: "Bash", status: "running", input: { command: "echo hi" } })
    expect(tools[1]).toEqual({ kind: "tool", id: "toolu_1", tool: "Bash", status: "completed", input: { command: "echo hi" }, output: "hi" })
    const done = events.find((e) => e.type === "message" && e.message.completed)
    // Context = uncached input + cache reads + cache writes, model in the adapter's form.
    expect(done).toEqual({
      type: "message",
      session: SID,
      message: { id: "msg_1", role: "assistant", completed: true, model: "claude/claude-haiku-4-5-20251001", contextUsed: 20206, failed: false },
    })
    const text = events.find((e) => e.type === "part" && e.part.kind === "text")
    expect(text).toEqual({ type: "part", session: SID, part: { kind: "text", id: "msg_2:0", text: "DONE", final: true } })
    const finish = events.at(-1)
    // Turn totals; thinking moved from output into reasoning.
    expect(finish).toEqual({
      type: "part",
      session: SID,
      part: {
        kind: "step-finish",
        id: `${SID}:turn:0:finish`,
        reason: "end_turn",
        tokens: { input: 10, output: 7, reasoning: 35, cacheRead: 12306, cacheWrite: 7890 },
        cost: 0.0172306,
      },
    })
  })

  test("billing: cost is the session's running total, each turn bills its difference; max_tokens reads as length", () => {
    const stream = claudeStream(SID, 0.005)
    stream.feed(assistant("msg_1", { type: "text", text: "ONE" }))
    const first = stream.feed(result({ total_cost_usd: 0.0096 })).at(-1)
    expect(first?.type === "part" && first.part.kind === "step-finish" && first.part.cost.toFixed(4)).toBe("0.0046")
    stream.feed(assistant("msg_2", { type: "text", text: "TWO" }))
    const finish = stream.feed(result({ total_cost_usd: 0.0137, stop_reason: "max_tokens" })).find((e) => e.type === "part" && e.part.kind === "step-finish")
    expect(finish?.type === "part" && finish.part.kind === "step-finish" && [finish.part.id, finish.part.reason, finish.part.cost.toFixed(4)]).toEqual([
      `${SID}:turn:1:finish`,
      "length",
      "0.0041",
    ])
    // Unknown total before the process (a session from an earlier run whose
    // record is unreadable): the first turn bills no cost, later turns do.
    const unknown = claudeStream(SID)
    unknown.feed(assistant("msg_1", { type: "text", text: "ONE" }))
    const cost = (events: AgentEvent[]) => events.flatMap((e) => (e.type === "part" && e.part.kind === "step-finish" ? [e.part.cost.toFixed(4)] : []))
    expect(cost(unknown.feed(result({ total_cost_usd: 0.9 })))).toEqual(["0.0000"])
    unknown.feed(assistant("msg_2", { type: "text", text: "TWO" }))
    expect(cost(unknown.feed(result({ total_cost_usd: 0.95 })))).toEqual(["0.0500"])
  })

  test("errors: an API error message fails the message and names the turn's error; errors[] joins the text", () => {
    const stream = claudeStream(SID)
    const events = [
      assistant("synthetic_1", { type: "text", text: "There's an issue with the selected model" }, { error: "model_not_found", is_api_error_message: true }),
      result({ is_error: true, api_error_status: 404, result: "There's an issue with the selected model", total_cost_usd: 0 }),
    ].flatMap((line) => stream.feed(line))
    expect(events.find((e) => e.type === "message" && e.message.completed)).toMatchObject({ message: { failed: true } })
    expect(events.at(-1)).toEqual({
      type: "error",
      session: SID,
      error: { name: "model_not_found", message: "There's an issue with the selected model", statusCode: 404 },
    })
    const resume = claudeStream(SID).feed(
      result({ subtype: "error_during_execution", is_error: true, result: undefined, errors: ["No conversation found with session ID: x"] }),
    )
    // No assistant line: no step to finish, only the error.
    expect(resume).toEqual([{ type: "error", session: SID, error: { name: "error_during_execution", message: "No conversation found with session ID: x" } }])
  })

  test("system lines: api_retry → retry, compaction and denials → notes; replays, subagents, tool errors", () => {
    const stream = claudeStream(SID)
    expect(stream.feed({ type: "system", subtype: "api_retry", attempt: 2, retry_delay_ms: 4000, error_status: 529, error: "overloaded_error" })).toEqual([
      { type: "retry", session: SID, attempt: 2, next: 4000, error: { message: "overloaded_error", statusCode: 529 } },
    ])
    expect(stream.feed({ type: "system", subtype: "compact_boundary", uuid: "u1" })).toEqual([
      { type: "part", session: SID, part: { kind: "note", id: "u1", text: "context compaction (auto)" } },
    ])
    expect(stream.feed({ type: "system", subtype: "permission_denied", uuid: "u2", tool_name: "Bash", message: "blocked" })).toEqual([
      { type: "part", session: SID, part: { kind: "note", id: "u2", text: "permission denied: Bash: blocked" } },
    ])
    expect(stream.feed({ type: "user", isReplay: true, message: { role: "user", content: [{ type: "text", text: "go" }] } })).toEqual([])
    expect(stream.feed({ ...assistant("msg_sub", { type: "text", text: "subagent" }), parent_tool_use_id: "toolu_9" })).toEqual([])
    stream.feed(assistant("msg_1", { type: "tool_use", id: "toolu_2", name: "Read", input: { file_path: "x" } }))
    const failed = stream.feed(toolResult("toolu_2", [{ type: "text", text: "no such file" }], true))
    expect(failed.at(-1)).toEqual({ type: "part", session: SID, part: { kind: "tool", id: "toolu_2", tool: "Read", status: "error", input: { file_path: "x" }, error: "no such file" } })
  })

  test("error wording: claude's codes land in the driver's classes", () => {
    const cls = (message: string, statusCode?: number) => classifySessionError({ message, ...(statusCode ? { statusCode } : {}) }, CLAUDE_ERROR_PATTERNS)
    expect(cls("invalid_request Prompt is too long")).toBe("overflow")
    expect(cls("billing_error Your credit balance is too low")).toBe("quota")
    expect(cls("authentication_failed Invalid API key")).toBe("auth")
    expect(classifySessionError({ message: "rate_limit", attempt: 3 }, CLAUDE_ERROR_PATTERNS)).toBe("rate")
    expect(cls("ProcessExit claude process exited (code 1) before the turn finished")).toBe("transient")
  })
})

describe("contract translation", () => {
  test("contract body: frontmatter stripped", () => {
    expect(contractBody("---\ndescription: x\nmode: primary\n---\n\nYou are the agent.\n")).toBe("You are the agent.")
    expect(contractBody("No frontmatter.")).toBe("No frontmatter.")
  })

  test("opencode.json permission rules → claude allow / deny", () => {
    const config = {
      permission: {
        read: "allow",
        list: "allow",
        edit: "allow",
        question: "allow",
        webfetch: "deny",
        websearch: "ask",
        bash: { "*": "allow", "git push*": "deny", "git status*": "allow" },
      },
    }
    expect(claudePermissions(config)).toEqual({
      allow: ["Read", "Edit", "Write", "NotebookEdit", "Bash", "Bash(git status*)"],
      deny: ["WebFetch", "Bash(git push*)"],
    })
    expect(claudePermissions({ permission: "deny" }).deny).toContain("Bash")
    expect(claudePermissions(undefined)).toEqual({ allow: [], deny: [] })
  })

  test("process arguments per preset; a missing contract fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-claude-"))
    try {
      await mkdir(join(dir, ".opencode", "agent"), { recursive: true })
      await writeFile(join(dir, ".opencode", "agent", "auto.md"), "---\nmode: primary\n---\nContract.\n")
      await writeFile(join(dir, "opencode.json"), JSON.stringify({ permission: { edit: "allow", webfetch: "deny" } }))
      const deny = await contractArgs(dir, "auto", "deny")
      expect(deny).toEqual({
        args: [
          "--disallowed-tools",
          "AskUserQuestion",
          "--permission-prompts",
          "none",
          "--append-system-prompt",
          "Contract.",
          "--settings",
          JSON.stringify({ permissions: { allow: ["Edit", "Write", "NotebookEdit"], deny: ["WebFetch"] } }),
        ],
      })
      const allow = await contractArgs(dir, "auto", "allow")
      expect("args" in allow && allow.args.slice(2, 4)).toEqual(["--permission-mode", "bypassPermissions"])
      expect(await contractArgs(dir, "other", "deny")).toEqual({ error: "agent contract file missing: .opencode/agent/other.md" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// A scripted `claude -p` process: records its arguments and stdin; the test
// (or an auto-responder) prints lines and exits it.
type Fake = ClaudeProcess & { args: string[]; env: Record<string, string | undefined>; written: string[]; ended: boolean; killed: boolean; print(line: object): void; exit(code?: number, stderr?: string): void }

function spawner(respond?: (proc: Fake, text: string) => void) {
  const procs: Fake[] = []
  const spawn: ClaudeSpawn = (args, options) => {
    const queue: string[] = []
    let wake: (() => void) | undefined
    let closed = false
    let settle: (value: { code: number | null; stderr: string }) => void = () => {}
    const exited = new Promise<{ code: number | null; stderr: string }>((resolve) => (settle = resolve))
    const proc: Fake = {
      args,
      env: options.env,
      written: [],
      ended: false,
      killed: false,
      write(line) {
        if (proc.ended) throw new Error("stdin closed")
        proc.written.push(line)
        respond?.(proc, JSON.parse(line).message.content[0].text)
      },
      end() {
        proc.ended = true
        // Like the CLI: stdin closed after the last turn → the process exits.
        queueMicrotask(() => proc.exit(0))
      },
      kill() {
        proc.killed = true
        queueMicrotask(() => proc.exit(143))
      },
      print(line) {
        queue.push(JSON.stringify(line))
        wake?.()
      },
      exit(code = 0, stderr = "") {
        if (closed) return
        closed = true
        wake?.()
        settle({ code, stderr })
      },
      lines: (async function* () {
        for (;;) {
          while (queue.length) yield queue.shift()!
          if (closed) return
          await new Promise<void>((resolve) => (wake = resolve))
          wake = undefined
        }
      })(),
      exited,
    }
    procs.push(proc)
    return proc
  }
  return { spawn, procs }
}

// Answers each prompt like the CLI: init, the replay, one text reply and the
// turn's result.
const echo = (proc: Fake, text: string) => {
  queueMicrotask(() => {
    proc.print({ type: "system", subtype: "init", model: "claude-haiku-4-5" })
    proc.print({ type: "user", isReplay: true, message: { role: "user", content: [{ type: "text", text }] } })
    proc.print(assistant(`msg_${proc.written.length}`, { type: "text", text: `re: ${text}` }))
    proc.print(result())
  })
}

const agentWith = (spawn: ClaudeSpawn, extra: Partial<Parameters<typeof claudeAgent>[0]> = {}) =>
  claudeAgent({ directory: "/work/dir", permission: "deny", spawn, contract: async () => ({ args: ["--contract"] }), projectsDir: "/nonexistent", ...extra })

// Reads the subscription up to a matching event. Not for-await: breaking out
// of one would close the subscription, and tests read one across turns.
const readers = new WeakMap<AsyncIterable<AgentEvent>, AsyncIterator<AgentEvent>>()
async function collect(events: AsyncIterable<AgentEvent>, until: (e: AgentEvent) => boolean): Promise<AgentEvent[]> {
  let reader = readers.get(events)
  if (!reader) readers.set(events, (reader = events[Symbol.asyncIterator]()))
  const all: AgentEvent[] = []
  for (;;) {
    const step = await reader.next()
    if (step.done) return all
    all.push(step.value)
    if (until(step.value)) return all
  }
}

describe("claudeAgent: process manager", () => {
  test("capabilities as measured: resume, whole-session fork, steer, abort; no question / permission / history; usage in-turn", () => {
    expect(CLAUDE_CAPABILITIES).toEqual({ resume: true, fork: "session", steer: true, abort: true, question: false, permission: false, history: false, usage: "events" })
    // The run start degrades only what claude lacks (MA.4): ask off, notes for the preset and history.
    const switches = parseSwitches({ [SWITCH_ENV.fork]: "on", [SWITCH_ENV.reuseSession]: "on", [SWITCH_ENV.steer]: "on", [SWITCH_ENV.ask]: "on" })
    const degraded = degrade(CLAUDE_CAPABILITIES, switches, { testByDriver: true })
    expect(degraded.switches).toEqual({ ask: false })
    expect(degraded.error).toBeUndefined()
    expect(degraded.notes).toHaveLength(3)
  })

  test("first prompt starts the session with its minted id; idle at the result closes stdin; the next prompt resumes", async () => {
    const { spawn, procs } = spawner(echo)
    const agent = agentWith(spawn)
    const created = await agent.create({ title: "T-001 exec" })
    const id = created.ok ? created.value.id : ""
    const ac = new AbortController()
    const events = await agent.events(ac.signal)
    expect(await agent.prompt({ session: id, text: "hello", agent: "auto", model: "claude/sonnet" })).toEqual({ ok: true, value: undefined })
    const turn = await collect(events, (e) => e.type === "idle")
    expect(turn.find((e) => e.type === "part" && e.part.kind === "text")).toMatchObject({ session: id, part: { text: "re: hello" } })
    const first = procs[0]!
    expect(first.args.slice(0, 8)).toEqual(["claude", "-p", "--output-format", "stream-json", "--input-format", "stream-json", "--replay-user-messages", "--verbose"])
    expect(first.args.slice(8)).toEqual(["--session-id", id, "--model", "sonnet", "--name", "T-001 exec", "--contract"])
    expect(JSON.parse(first.written[0]!)).toEqual({ type: "user", message: { role: "user", content: [{ type: "text", text: "hello" }] } })
    expect(first.ended).toBe(true)
    // The window claude reported is known now (live map).
    expect((await agent.contextLimits()).get("claude/claude-haiku-4-5-20251001")).toBe(200000)
    // The session announced itself (init): the next start resumes it.
    await agent.promptAsync({ session: id, text: "results" })
    await collect(events, (e) => e.type === "idle")
    ac.abort()
    expect(procs).toHaveLength(2)
    expect(procs[1]!.args.slice(8, 10)).toEqual(["--resume", id])
  })

  test("resume and fork arguments; the model is fixed per process", async () => {
    const { spawn, procs } = spawner(echo)
    const agent = agentWith(spawn)
    const id = ((await agent.create({ title: "t" })) as { ok: true; value: { id: string } }).value.id
    const ac = new AbortController()
    const events = await agent.events(ac.signal)
    await agent.prompt({ session: id, text: "one" })
    await collect(events, (e) => e.type === "idle")
    const forked = await agent.fork(id, "msg_anchor_ignored")
    const copy = forked.ok ? forked.value.id : ""
    expect(copy).not.toBe(id)
    await agent.prompt({ session: copy, text: "two", model: "claude/opus" })
    await collect(events, (e) => e.type === "idle")
    expect(procs[1]!.args.slice(8)).toEqual(["--resume", id, "--fork-session", "--session-id", copy, "--model", "opus", "--name", "t", "--contract"])
    await agent.prompt({ session: id, text: "three" })
    await collect(events, (e) => e.type === "idle")
    expect(procs[2]!.args.slice(8, 10)).toEqual(["--resume", id])
    expect(await agent.defaultModel()).toBe("claude/claude-haiku-4-5")
    ac.abort()
  })

  test("steer mid-turn: the message goes into the running process; idle waits until claude consumed it", async () => {
    const { spawn, procs } = spawner()
    const agent = agentWith(spawn)
    const id = ((await agent.create({ title: "t" })) as { ok: true; value: { id: string } }).value.id
    const ac = new AbortController()
    const events = await agent.events(ac.signal)
    await agent.prompt({ session: id, text: "work" })
    const proc = procs[0]!
    proc.print({ type: "user", isReplay: true, message: { role: "user", content: [{ type: "text", text: "work" }] } })
    proc.print(assistant("msg_1", { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "sleep 8" } }))
    await agent.promptAsync({ session: id, text: "hand over" })
    expect(procs).toHaveLength(1)
    expect(proc.written).toHaveLength(2)
    // A result before claude read the steer: no idle, stdin stays open.
    proc.print(result())
    proc.print({ type: "user", isReplay: true, message: { role: "user", content: [{ type: "text", text: "hand over" }] } })
    proc.print(assistant("msg_2", { type: "text", text: "handover written" }))
    proc.print(result({ total_cost_usd: 0.03 }))
    const all = await collect(events, (e) => e.type === "idle")
    ac.abort()
    expect(all.filter((e) => e.type === "part" && e.part.kind === "step-finish")).toHaveLength(2)
    expect(all.filter((e) => e.type === "idle")).toHaveLength(1)
    expect(all.at(-2)).toMatchObject({ type: "part", part: { kind: "step-finish" } })
    expect(proc.ended).toBe(true)
  })

  test("abort kills the process and ends the turn; an unexpected exit is a retryable error", async () => {
    const { spawn, procs } = spawner()
    const agent = agentWith(spawn)
    const id = ((await agent.create({ title: "t" })) as { ok: true; value: { id: string } }).value.id
    const ac = new AbortController()
    const events = await agent.events(ac.signal)
    await agent.prompt({ session: id, text: "work" })
    await agent.abort(id)
    expect(procs[0]!.killed).toBe(true)
    expect(await collect(events, (e) => e.type === "idle")).toEqual([{ type: "idle", session: id }])
    await agent.prompt({ session: id, text: "again" })
    procs[1]!.exit(1, "boom\nAPI connection lost")
    const crashed = await collect(events, (e) => e.type === "idle")
    ac.abort()
    expect(crashed[0]).toEqual({
      type: "error",
      session: id,
      error: { name: "ProcessExit", message: "claude process exited (code 1) before the turn finished: boom\nAPI connection lost" },
    })
    expect(classifySessionError({ message: `ProcessExit ${(crashed[0] as { error: { message: string } }).error.message}` }, CLAUDE_ERROR_PATTERNS)).toBe("transient")
  })

  test("block preset: a denied permission ends the turn with a non-retryable error", async () => {
    const { spawn, procs } = spawner()
    const agent = agentWith(spawn, { permission: "block" })
    const id = ((await agent.create({ title: "t" })) as { ok: true; value: { id: string } }).value.id
    const ac = new AbortController()
    const events = await agent.events(ac.signal)
    await agent.prompt({ session: id, text: "work" })
    procs[0]!.print({ type: "system", subtype: "permission_denied", uuid: "u1", tool_name: "WebFetch", message: "denied by rule" })
    const all = await collect(events, (e) => e.type === "idle")
    ac.abort()
    expect(procs[0]!.killed).toBe(true)
    expect(all.find((e) => e.type === "error")).toMatchObject({ error: { name: "PermissionDenied", isRetryable: false } })
    expect(classifySessionError({ isRetryable: false })).toBe("quota")
  })

  test("sessions: unknown ids fail, transcripts make them known; no history; reply calls fail; dispatch failures", async () => {
    const projects = await mkdtemp(join(tmpdir(), "auto-claude-projects-"))
    try {
      const { spawn, procs } = spawner(echo)
      const agent = agentWith(spawn, { projectsDir: projects })
      expect((await agent.get("ffffffff-0000-4000-8000-000000000000")).ok).toBe(false)
      await mkdir(join(projects, "-work-dir"), { recursive: true })
      await writeFile(
        join(projects, "-work-dir", "ffffffff-0000-4000-8000-000000000000.jsonl"),
        '{"type":"cost-state","totalCostUSD":0.01}\n{"type":"user"}\n{"type":"cost-state","totalCostUSD":0.0122306}\n',
      )
      expect(await agent.get("ffffffff-0000-4000-8000-000000000000")).toEqual({ ok: true, value: { id: "ffffffff-0000-4000-8000-000000000000" } })
      // A session from an earlier run resumes.
      const ac = new AbortController()
      const events = await agent.events(ac.signal)
      await agent.prompt({ session: "ffffffff-0000-4000-8000-000000000000", text: "continue" })
      const resumed = await collect(events, (e) => e.type === "idle")
      // Billed against the total the transcript last filed (0.0172306 − 0.0122306).
      expect(resumed.find((e) => e.type === "part" && e.part.kind === "step-finish")).toMatchObject({ part: { cost: expect.closeTo(0.005, 6) } })
      // A fork starts from its source's running total.
      const copy = ((await agent.fork("ffffffff-0000-4000-8000-000000000000")) as { ok: true; value: { id: string } }).value.id
      await agent.prompt({ session: copy, text: "fork" })
      const forked = await collect(events, (e) => e.type === "idle")
      expect(forked.find((e) => e.type === "part" && e.part.kind === "step-finish")).toMatchObject({ part: { cost: 0 } })
      ac.abort()
      expect(procs[0]!.args.slice(8, 10)).toEqual(["--resume", "ffffffff-0000-4000-8000-000000000000"])
      expect((await agent.messages("x")).ok).toBe(false)
      expect((await agent.replyQuestion("r", [["a"]])).ok).toBe(false)
      expect((await agent.replyPermission("r", "once")).ok).toBe(false)
      expect((await agent.prompt({ session: "nope", text: "x" })).ok).toBe(false)
      const missing = agentWith(spawn, { contract: async () => ({ error: "agent contract file missing: .opencode/agent/auto.md" }) })
      const id = ((await missing.create({ title: "t" })) as { ok: true; value: { id: string } }).value.id
      const failed = await missing.prompt({ session: id, text: "x", agent: "auto" })
      expect(!failed.ok && String(failed.error)).toContain("agent contract file missing")
    } finally {
      await rm(projects, { recursive: true, force: true })
    }
  })

  test("the child does not inherit a surrounding Claude Code session's identity", async () => {
    const { spawn, procs } = spawner(echo)
    const saved = { CLAUDECODE: process.env.CLAUDECODE, CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID }
    process.env.CLAUDECODE = "1"
    process.env.CLAUDE_CODE_SESSION_ID = "outer"
    try {
      const agent = agentWith(spawn)
      const id = ((await agent.create({ title: "t" })) as { ok: true; value: { id: string } }).value.id
      await agent.prompt({ session: id, text: "x" })
      expect(procs[0]!.env.CLAUDECODE).toBeUndefined()
      expect(procs[0]!.env.CLAUDE_CODE_SESSION_ID).toBeUndefined()
      expect(procs[0]!.env.PATH).toBe(process.env.PATH)
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  test("driven end to end: runSession over the adapter settles on idle with the closing words", async () => {
    const { spawn, procs } = spawner(echo)
    const agent = agentWith(spawn)
    const chain = { pct: 100, used: 0, at: 0 }
    const outcome = await runSession(agent, task, "do the task", {}, chain)
    expect(outcome).toEqual({ type: "idle", lastText: "re: do the task", testHandover: false })
    expect(procs).toHaveLength(1)
    // Measured in-turn (events tier): the chain carries the figure and the window.
    expect(chain.used).toBe(20206)
    expect(chain.pct).toBe(10)
  })
})

describe("claude host", () => {
  test("checks the CLI at start, ignores --server with a warning, never restarts, kills processes at close", async () => {
    const lines: string[] = []
    const missing = createClaudeHost({ version: async () => undefined })
    await expect(missing("/work", { permission: "deny", log: (l) => lines.push(l) })).rejects.toThrow(/claude CLI unavailable/)
    const { spawn, procs } = spawner()
    const host = await createClaudeHost({ version: async () => "2.1.278 (Claude Code)", spawn })("/work", {
      server: "http://x",
      permission: "deny",
      log: (l) => lines.push(l),
    })
    expect(lines).toEqual(["◇ claude 2.1.278 (Claude Code)", "⚠ --server http://x names an opencode server; the claude agent runs its own processes and ignores it"])
    expect(host.client.capabilities).toBe(CLAUDE_CAPABILITIES)
    expect(await host.restart("network")).toBe(false)
    await host.syncContext()
    const id = ((await host.client.create({ title: "t" })) as { ok: true; value: { id: string } }).value.id
    await host.client.prompt({ session: id, text: "x" })
    host.close()
    expect(procs[0]!.killed).toBe(true)
  })
})

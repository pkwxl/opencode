// A deterministic `claude` CLI double for the shell e2e (plans/0053 §8, B6/C5):
// the subprocess the claude adapter spawns (`claude -p --output-format
// stream-json --input-format stream-json --replay-user-messages …`, cwd = the
// fixture's target directory). It answers `--version`, then reads one JSON
// user message per line on stdin, does the artifact work the prompt asks for
// (numbering-record recovery, fresh planning, task appending; under `run`
// auto's lead, its streams, the rejected lead's fork, the wrap-up and the
// phase handover) and answers with the minimal stream-json turn — init, the
// replayed user line (the adapter's acknowledgment), one assistant message
// with usage, the closing result — so the adapter's pump settles the turn at
// idle. Session/resume/fork arguments change nothing: state lives on disk,
// which is all the artifact checks read. With FAKE_CLAUDE_LOG set, every turn
// appends one JSON line there — the process's session arguments and the
// message text — so a test can tell which sessions were forks of which.
//
// `bun test` never collects this file directly (no *.test.ts name); the e2e
// suite puts it on PATH as `claude` and selects the adapter with
// OPENCODE_AUTO_AGENT=claude, so the CLI's plan and run drive their sessions
// end to end with no provider credentials.
//
// This is the auto-server package's copy of packages/auto's fixture
// (test/fixtures/fake-claude.ts there, byte-identical behavior), extended
// with knobs of its own:
//   FAKE_CLAUDE_DELAY_MS (T-087, P1b) — sleep this many milliseconds before
//     answering each turn, stretching the run so a test can observe a live
//     run from the outside (the second-worker lock test spawns another
//     worker on the same directory while the first still holds
//     .auto/run.lock).
//   the interruption-resume branches (T-094, P3b) — the stream flow's
//     after-the-restart shapes, which the reference fixture never meets
//     (its suites interrupt nothing mid-split): a stream whose fork base
//     did not survive the restart runs in a fresh session over the generic
//     subtask prompt (the item's own line rides it, Artifacts included),
//     and a stream re-prompted after a shape-check failure names the
//     subtask whose artifacts are missing. Both write exactly the item's
//     declared artifacts, so a run interrupted mid-split — the graceful
//     /exit pause over the WebSocket transport, exit 3 with progress
//     persisted — resumes to completion.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const say = (line: unknown) => console.log(JSON.stringify(line))

// The T-087 extension: one per-turn delay, 0 (unset) = the reference
// fixture's immediate answers.
const DELAY_MS = Number(process.env.FAKE_CLAUDE_DELAY_MS ?? 0)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

if (process.argv.includes("--version")) {
  console.log("1.0.0 (fake, opencode-auto e2e)")
  process.exit(0)
}

// A task document that passes the mandatory spec check (title line, Phase
// field, the three sections, the terminator), mirroring the core loop
// fixture's taskDoc.
const taskDoc = (id: string, phase: string) =>
  [
    `# ${id}: task ${id}`,
    `Phase: ${phase}`,
    "",
    "## Goal",
    "",
    `task ${id} delivered.`,
    "",
    "## Scope",
    "",
    "Self-contained: the modules to touch and the context needed to execute.",
    "",
    "## Acceptance",
    "",
    "The acceptance statements of this task hold.",
    "",
    "<!-- auto: eof -->",
    "",
  ].join("\n")

// The work of one turn, by the prompt's own markers. Returns the context
// figure the turn reports: small, except for auto's lead (the lead's figure
// from FAKE_CLAUDE_LEAD_CONTEXT, which decides the split guard's usage
// condition).
function act(text: string): number {
  if (execute(text)) return text.includes(LEAD_MARK) ? Number(process.env.FAKE_CLAUDE_LEAD_CONTEXT ?? SMALL) : SMALL
  // The numbering record is missing and auto-numbering is on: restore it with
  // the deterministic floor the prompt carries.
  if (text.includes("You are the recoverer of the task-numbering record")) {
    const floor = /from T-(\d+) on/.exec(text)?.[1]
    if (floor) writeFileSync(".auto/next-task", `${Number(floor)}\n`)
    return SMALL
  }
  // The appending session: append one new line after the existing ones and
  // write the new task's document, touching nothing else. Told apart from the
  // fresh planning prompts (which name the phase's task index too) by its own
  // heading. The index path, the phase id and the number start all travel in
  // the prompt.
  if (text.includes("## Input: the task index as it stands")) {
    const index = /## Input: the task index as it stands \((docs\/[^\s)]+)\)/.exec(text)?.[1]
    const phase = /Phase: (R-\d+\.P\d+)/.exec(text)?.[1]
    const start = /Task numbers increment continuously from T-(\d+)/.exec(text)?.[1]
    if (!index || !phase || !start) return SMALL
    const id = writeTask(phase, start)
    const current = readFileSync(index, "utf8")
    writeFileSync(index, `${current.endsWith("\n") ? current.slice(0, -1) : current}\n- [ ] ${id} task ${id}\n`)
    return SMALL
  }
  // The fresh planning session (phase-plan and implement-plan alike): write
  // the phase's task index with exactly one task and its document. The index
  // path, the phase id and the number start all travel in the prompt.
  const index = /Task index (docs\/R-\d+\/P\d{2,}-[a-z][a-z0-9-]*\/tasks\.md)/.exec(text)?.[1]
  const phase = /Phase: (R-\d+\.P\d+)/.exec(text)?.[1]
  const start = /Task numbers increment continuously from T-(\d+)/.exec(text)?.[1]
  if (!index || !phase || !start) return SMALL
  const id = writeTask(phase, start)
  writeFileSync(index, `# Tasks (${phase})\n\n- [ ] ${id} task ${id}\n`)
  return SMALL
}

// One task's document on disk; the caller places the index line around it.
function writeTask(phase: string, start: string): string {
  const id = `T-${String(Number(start)).padStart(3, "0")}`
  mkdirSync(join("docs", id), { recursive: true })
  writeFileSync(join("docs", id, "todo.md"), taskDoc(id, phase))
  return id
}

const SMALL = 100

// —— run: auto's lead and its split (auto-core plans/0059) ——

const LEAD_MARK = "Split rule (adaptive decomposition)"

// The lead's split: two streams over a foundation the lead writes itself;
// the second waits for the first, so its prompt lists the files changed
// since the split.
const SPLIT = [
  "- [ ] alpha: the alpha module in src/alpha.ts on the shared helper, verify it by reading it back Depends: none Artifacts: src/alpha.ts",
  "- [ ] beta: the beta module in src/beta.ts on alpha, verify it by reading it back Depends: S01 Artifacts: src/beta.ts",
  "",
].join("\n")

const write = (rel: string, text: string) => {
  mkdirSync(dirname(rel), { recursive: true })
  writeFileSync(rel, text)
}

// The execution flow's turns under `run`; false = not one of them.
function execute(text: string): boolean {
  // The lead: the foundation, then the split, in one turn.
  if (text.includes(LEAD_MARK)) {
    const task = /its document is docs\/(T-\d+)\/todo\.md/.exec(text)?.[1]
    if (!task) return true
    write("src/shared.ts", "export const shared = 1\n")
    write(join("docs", task, "subtasks.md"), SPLIT)
    return true
  }
  // A stream, forked from the lead: the files its line declares.
  if (text.startsWith("[DRIVER] Your split was taken")) {
    const line = text.split("\n").find((l) => l.startsWith("- [ ] ")) ?? ""
    const stream = /runs stream (T-\d+\.S\d+)/.exec(text)?.[1] ?? "stream"
    const paths = /Artifacts:\s*(.+)$/.exec(line)?.[1]?.split(/[\s,]+/).filter(Boolean) ?? []
    for (const rel of paths) write(rel, `export const ${rel.replace(/^.*\/|\..*$/g, "")} = ${JSON.stringify(stream)}\n`)
    return true
  }
  // A stream in a fresh session (T-094): an interruption restart lost the
  // lead's session, so the stream does not fork — the generic subtask
  // prompt carries the item's own line ("You are responsible for item N of
  // that list only: - [ ] <item>"), the Artifacts declaration included.
  // Write exactly those files; the stream's content names its unit.
  const freshItem = /You are responsible for (?:item [^\n]* of that list|this single subtask) only:\s*- \[ \] (.+)$/m.exec(text)?.[1]
  if (freshItem !== undefined && freshItem.includes("Artifacts:")) {
    const stream = /runs stream (T-\d+\.S\d+)/.exec(text)?.[1] ?? /(?:^|\s)(T-\d+\.S\d+)(?:\s|$)/.exec(text)?.[1] ?? "stream"
    const paths = /Artifacts:\s*(.+)$/.exec(freshItem)?.[1]?.split(/[\s,]+/).filter(Boolean) ?? []
    for (const rel of paths) write(rel, `export const ${rel.replace(/^.*\/|\..*$/g, "")} = ${JSON.stringify(stream)}\n`)
    return true
  }
  // A stream re-prompted after a shape-check failure (T-094): the feedback
  // names the subtask whose artifacts did not land; its checklist line
  // declares them — read subtasks.md and write the declared files.
  if (text.startsWith("You ended the session last time, but this subtask's")) {
    const [, task, sub] = /\((T-\d+)\.(S\d+)\)/.exec(text) ?? []
    if (task && sub) {
      const checklist = readFileSync(join("docs", task, "subtasks.md"), "utf8")
      const at = Number(sub.slice(1)) - 1
      const line = checklist.split("\n").filter((l) => l.startsWith("- [ ] "))[at] ?? ""
      const paths = /Artifacts:\s*(.+)$/.exec(line)?.[1]?.split(/[\s,]+/).filter(Boolean) ?? []
      for (const rel of paths) write(rel, `export const ${rel.replace(/^.*\/|\..*$/g, "")} = ${JSON.stringify(`${task}.${sub}`)}\n`)
    }
    return true
  }
  // The rejected lead's fork: the whole remaining work in this session.
  if (text.startsWith("[DRIVER] The split was not taken")) {
    write("src/alpha.ts", 'export const alpha = "lead"\n')
    write("src/beta.ts", 'export const beta = "lead"\n')
    return true
  }
  // The wrap-up: the task report with its result line.
  const report = /Write docs\/(T-\d+)\/report\.md/.exec(text)?.[1]
  if (text.includes("This session only performs the wrap-up") && report) {
    write(
      join("docs", report, "report.md"),
      [
        `# ${report} report`,
        "",
        "The fake agent delivered the task: the shared helper, then the alpha and beta modules on it, each read back after writing.",
        "",
        "Result: PASS",
        "",
        "<!-- auto: eof -->",
        "",
      ].join("\n"),
    )
    return true
  }
  // The phase handover distillation: the four mandatory sections.
  if (text.includes("You are the handover distiller")) {
    const handover = /(docs\/R-\d+\/P\d{2,}-[a-z][a-z0-9-]*\/handover\.md)/.exec(text)?.[1]
    if (handover) {
      write(
        handover,
        [
          "# Handover",
          "",
          "## Key decisions",
          "",
          "- The fake agent distilled this phase.",
          "",
          "## Constraints and pitfalls",
          "",
          "- Nothing recorded.",
          "",
          "## Required reading for the next phase",
          "",
          "- This phase's directory holds the task units.",
          "",
          "## Artifact index",
          "",
          "- (none)",
          "",
        ].join("\n"),
      )
    }
    return true
  }
  return false
}

// The session arguments this process was started with, for FAKE_CLAUDE_LOG.
const argv = process.argv.slice(2)
const argOf = (name: string) => {
  const at = argv.indexOf(name)
  return at >= 0 ? argv[at + 1] : undefined
}
const record = (text: string) => {
  const file = process.env.FAKE_CLAUDE_LOG
  if (!file) return
  appendFileSync(file, `${JSON.stringify({ session: argOf("--session-id"), resume: argOf("--resume"), fork: argv.includes("--fork-session"), text })}\n`)
}

// stdin, one JSON user message per line, handed out in arrival order: a turn
// may wait for the next line, a steer written while it runs.
const decoder = new TextDecoder()
let buffer = ""
const pending: string[] = []
let closed = false
let wake: (() => void) | undefined

process.stdin.on("data", (chunk: Uint8Array) => {
  buffer += decoder.decode(chunk, { stream: true })
  let nl: number
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    if (line) pending.push(line)
  }
  wake?.()
})
process.stdin.on("close", () => {
  closed = true
  wake?.()
})

// The text of the next message; undefined once stdin closed (or, with a
// timeout, when none arrived in time).
async function nextText(timeoutMs?: number): Promise<string | undefined> {
  for (;;) {
    while (pending.length) {
      let message: { content?: Array<{ text?: string }> }
      try {
        message = JSON.parse(pending.shift()!).message
      } catch {
        continue
      }
      const text = message?.content?.[0]?.text
      if (typeof text === "string") return text
    }
    if (closed) return undefined
    const arrived = await new Promise<boolean>((resolve) => {
      wake = () => resolve(true)
      if (timeoutMs !== undefined) setTimeout(() => resolve(false), timeoutMs)
    })
    wake = undefined
    if (!arrived && !pending.length) return undefined
  }
}

// The usage of an assistant message whose context is `used` tokens.
const usage = (used: number) => ({ input_tokens: used, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })

let turn = 0
let booted = false
for (;;) {
  const text = await nextText()
  if (text === undefined) break
  turn++
  record(text)
  if (DELAY_MS > 0) await sleep(DELAY_MS)
  const used = act(text)
  // The turn's stream: init once per process, the replay acknowledgment,
  // one assistant message with usage, the closing result (idle).
  if (!booted) {
    booted = true
    say({ type: "system", subtype: "init", model: "fake-1" })
  }
  say({ type: "user", isReplay: true, message: { role: "user", content: [{ type: "text", text }] } })
  if (used > SMALL) {
    // A large figure is measured mid-turn, as a real turn's tool round is: the
    // tool result completes the message that called it, the driver's usage
    // notice arrives while the turn still runs, and the turn takes it in
    // before it ends (so the notice never lands on an idle session).
    say({
      type: "assistant",
      message: { id: `msg_${turn}_tool`, model: "fake-1", content: [{ type: "tool_use", id: `tool_${turn}`, name: "Write", input: { file_path: "src/shared.ts" } }], usage: usage(used) },
    })
    say({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `tool_${turn}`, content: "ok" }] } })
    const steer = await nextText(5_000)
    if (steer !== undefined) {
      record(steer)
      say({ type: "user", isReplay: true, message: { role: "user", content: [{ type: "text", text: steer }] } })
    }
  }
  say({
    type: "assistant",
    message: { id: `msg_${turn}`, model: "fake-1", content: [{ type: "text", text: "done" }], usage: usage(used) },
  })
  // The window keeps the driver's wall at the 2×cap budget (128k at the
  // default cap) whether or not the window is known yet at a measurement:
  // steerWall = min(max(128k, window/4), 0.8×window) = 128k for any window
  // from 160k to 512k.
  say({
    type: "result",
    subtype: "success",
    is_error: false,
    stop_reason: "end_turn",
    total_cost_usd: 0.01,
    usage: { input_tokens: 100, output_tokens: 10 },
    modelUsage: { "fake-1": { contextWindow: 200_000 } },
  })
}
process.exit(0)

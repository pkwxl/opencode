// A deterministic `claude` CLI double for the shell e2e (plans/0053 §8, B6/C5):
// the subprocess the claude adapter spawns (`claude -p --output-format
// stream-json --input-format stream-json --replay-user-messages …`, cwd = the
// fixture's target directory). It answers `--version`, then reads one JSON
// user message per line on stdin, does the artifact work the prompt asks for
// (numbering-record recovery, fresh planning, task appending) and answers with
// the minimal stream-json turn — init, the replayed user line (the adapter's
// acknowledgment), one assistant message with usage, the closing result — so
// the adapter's pump settles the turn at idle. Session/resume/fork arguments
// are ignored: state lives on disk, which is all the artifact checks read.
//
// `bun test` never collects this file directly (no *.test.ts name); the e2e
// suite puts it on PATH as `claude` and selects the adapter with
// OPENCODE_AUTO_AGENT=claude, so the CLI's plan runs its planning and appending
// steps end to end with no provider credentials.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const say = (line: unknown) => console.log(JSON.stringify(line))

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

// The work of one turn, by the prompt's own markers.
function act(text: string): void {
  // The numbering record is missing and auto-numbering is on: restore it with
  // the deterministic floor the prompt carries.
  if (text.includes("You are the recoverer of the task-numbering record")) {
    const floor = /from T-(\d+) on/.exec(text)?.[1]
    if (floor) writeFileSync(".auto/next-task", `${Number(floor)}\n`)
    return
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
    if (!index || !phase || !start) return
    const id = writeTask(phase, start)
    const current = readFileSync(index, "utf8")
    writeFileSync(index, `${current.endsWith("\n") ? current.slice(0, -1) : current}\n- [ ] ${id} task ${id}\n`)
    return
  }
  // The fresh planning session (phase-plan and implement-plan alike): write
  // the phase's task index with exactly one task and its document. The index
  // path, the phase id and the number start all travel in the prompt.
  const index = /Task index (docs\/R-\d+\/P\d{2,}-[a-z][a-z0-9-]*\/tasks\.md)/.exec(text)?.[1]
  const phase = /Phase: (R-\d+\.P\d+)/.exec(text)?.[1]
  const start = /Task numbers increment continuously from T-(\d+)/.exec(text)?.[1]
  if (!index || !phase || !start) return
  const id = writeTask(phase, start)
  writeFileSync(index, `# Tasks (${phase})\n\n- [ ] ${id} task ${id}\n`)
}

// One task's document on disk; the caller places the index line around it.
function writeTask(phase: string, start: string): string {
  const id = `T-${String(Number(start)).padStart(3, "0")}`
  mkdirSync(join("docs", id), { recursive: true })
  writeFileSync(join("docs", id, "todo.md"), taskDoc(id, phase))
  return id
}

let turn = 0
let booted = false
const decoder = new TextDecoder()
let buffer = ""

process.stdin.on("data", (chunk: Uint8Array) => {
  buffer += decoder.decode(chunk, { stream: true })
  let nl: number
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    if (!line) continue
    let message: { content?: Array<{ text?: string }> }
    try {
      message = JSON.parse(line).message
    } catch {
      continue
    }
    const text = message?.content?.[0]?.text
    if (typeof text !== "string") continue
    turn++
    act(text)
    // The turn's stream: init once per process, the replay acknowledgment,
    // one assistant message with usage, the closing result (idle).
    if (!booted) {
      booted = true
      say({ type: "system", subtype: "init", model: "fake-1" })
    }
    say({ type: "user", isReplay: true, message: { role: "user", content: [{ type: "text", text }] } })
    say({
      type: "assistant",
      message: {
        id: `msg_${turn}`,
        model: "fake-1",
        content: [{ type: "text", text: "done" }],
        usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    })
    say({
      type: "result",
      subtype: "success",
      is_error: false,
      stop_reason: "end_turn",
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 10 },
      modelUsage: { "fake-1": { contextWindow: 100_000 } },
    })
  }
})
process.stdin.on("close", () => process.exit(0))

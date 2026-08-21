import { rename } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { allowWrite, reprotect } from "./protect"

export const STATUSES = ["pending", "in_progress", "blocked", "done"] as const
export type Status = (typeof STATUSES)[number]

export type Task = {
  id: string
  title: string
  status: Status
  verify?: string
  verified?: string
  question?: string
  answer?: string
  attempts: number
  body: string
}

export type Plan = {
  path: string
  tasks: Task[]
}

// ## T-001: 任务标题 [pending]
const HEADING = /^## (T-[\w-]+): (.+?) \[(pending|in_progress|blocked|done)\]\s*$/
//   - verify: bun test
const FIELD = /^\s+- ([\w-]+): (.*)$/

export async function load(path: string): Promise<Plan> {
  return parse(path, await Bun.file(path).text())
}

export function parse(path: string, text: string): Plan {
  const lines = text.split("\n")
  const tasks: Task[] = []
  const seen = new Set<string>()
  let i = 0
  while (i < lines.length) {
    const match = HEADING.exec(lines[i]!)
    if (!match) {
      i++
      continue
    }
    const [, id, title, status] = match
    if (seen.has(id!)) throw new Error(`${path}: duplicate task id ${id}`)
    seen.add(id!)
    const fields = new Map<string, string>()
    const body: string[] = []
    let j = i + 1
    // Field lines must be contiguous directly after the heading; the first
    // non-field line (including blank) ends the field block.
    while (j < lines.length) {
      const field = FIELD.exec(lines[j]!)
      if (!field) break
      fields.set(field[1]!, unquote(field[2]!))
      j++
    }
    while (j < lines.length && !lines[j]!.startsWith("## ")) {
      body.push(lines[j]!)
      j++
    }
    tasks.push({
      id: id!,
      title: title!.trim(),
      status: status as Status,
      verify: fields.get("verify"),
      verified: fields.get("verified"),
      question: fields.get("question"),
      answer: fields.get("answer"),
      attempts: Number(fields.get("attempts") ?? 0),
      body: body.join("\n").trim(),
    })
    i = j
  }
  return { path, tasks }
}

export function next(plan: Plan): Task | undefined {
  return plan.tasks.find((task) => task.status !== "done")
}

// Extracts "- [ ]" / "- [x]" checklist items (subtasks) from a task body.
export function subtasks(body: string): { text: string; done: boolean }[] {
  return body.split("\n").flatMap((line) => {
    const match = /^\s*- \[( |x|X)\]\s*(.*)$/.exec(line)
    return match ? [{ text: match[2]!.trim(), done: match[1]!.toLowerCase() === "x" }] : []
  })
}

// Counts "- [ ]" / "- [x]" checklist items (subtasks) in a task body.
export function countSubtasks(body: string): { done: number; total: number } {
  const items = subtasks(body)
  return { done: items.filter((item) => item.done).length, total: items.length }
}

export async function begin(path: string, id: string) {
  const plan = await load(path)
  const task = require(plan, id)
  await edit(path, id, { status: "in_progress", fields: { attempts: String(task.attempts + 1) } })
}

export async function block(path: string, id: string, question: string) {
  await edit(path, id, {
    status: "blocked",
    fields: {
      "blocked-at": new Date().toISOString().slice(0, 10),
      question: quote(question),
      // A new question invalidates any previously given answer.
      answer: undefined,
    },
  })
}

export async function setStatus(path: string, id: string, status: Status) {
  await edit(path, id, { status })
}

// Replaces the task body's checklist with the decomposition result. Any
// pre-existing checklist lines are dropped; the description text is kept.
export async function setSubtasks(path: string, id: string, items: string[]) {
  const plan = await load(path)
  const task = require(plan, id)
  const description = task.body
    .split("\n")
    .filter((line) => !/^\s*- \[( |x|X)\]/.test(line))
    .join("\n")
    .trim()
  const checklist = items.map((item) => `- [ ] ${item}`).join("\n")
  await edit(path, id, { body: description ? `${description}\n\n${checklist}` : checklist })
}

// Ticks one checklist item (driver-side; the agent never edits PLAN.md).
export async function tick(path: string, id: string, text: string) {
  const plan = await load(path)
  const task = require(plan, id)
  let found = false
  const body = task.body
    .split("\n")
    .map((line) => {
      const match = /^\s*- \[ \]\s*(.*)$/.exec(line)
      if (!found && match && match[1]!.trim() === text) {
        found = true
        return line.replace("- [ ]", "- [x]")
      }
      return line
    })
    .join("\n")
  if (!found) throw new Error(`${plan.path}: task ${id} has no unticked subtask: ${text}`)
  await edit(path, id, { body })
}

// Appends a fix-round subtask to the task body's checklist.
export async function appendSubtask(path: string, id: string, text: string) {
  const plan = await load(path)
  const task = require(plan, id)
  await edit(path, id, { body: `${task.body}\n- [ ] ${text}` })
}

// Marks the task [done]. A passing verify run records its command in the
// `verified` field; without one the field is cleared (no stale record).
export async function markDone(path: string, id: string, verified?: string) {
  await edit(path, id, { status: "done", fields: { verified } })
}

// Extracts the verify command from a subtask line's trailing
// "(verify: `<command>`)" annotation.
export function subtaskVerify(text: string): string | undefined {
  return /\(verify: `([^`]+)`\)\s*$/.exec(text)?.[1]
}

// Task-level verify convention: a "command: <cmd>" prefix means the driver
// runs it directly; anything else is natural language for the wrap-up
// session to translate into a command.
export function verifyCommand(task: Task): string | undefined {
  const match = /^command:\s*(.+)$/.exec(task.verify?.trim() ?? "")
  return match?.[1]?.trim() || undefined
}

function require(plan: Plan, id: string): Task {
  const task = plan.tasks.find((task) => task.id === id)
  if (!task) throw new Error(`${plan.path}: task ${id} not found`)
  return task
}

type Edit = {
  status?: Status
  // undefined value deletes the field
  fields?: Record<string, string | undefined>
  // full replacement of the task body (everything after the field block)
  body?: string
}

async function edit(path: string, id: string, change: Edit) {
  const lines = (await Bun.file(path).text()).split("\n")
  const head = lines.findIndex((line) => HEADING.exec(line)?.[1] === id)
  if (head === -1) throw new Error(`${path}: task ${id} not found`)

  if (change.status) {
    lines[head] = lines[head]!.replace(/\[(pending|in_progress|blocked|done)\]\s*$/, `[${change.status}]`)
  }

  let count = 0
  if (change.fields) {
    const ordered = new Map<string, string>()
    while (head + 1 + count < lines.length && FIELD.test(lines[head + 1 + count]!)) {
      const field = FIELD.exec(lines[head + 1 + count]!)!
      ordered.set(field[1]!, field[2]!)
      count++
    }
    for (const [key, value] of Object.entries(change.fields)) {
      if (value === undefined) {
        ordered.delete(key)
        continue
      }
      ordered.set(key, value)
    }
    lines.splice(head + 1, count, ...Array.from(ordered, ([key, value]) => `  - ${key}: ${value}`))
    count = ordered.size
  } else {
    while (head + 1 + count < lines.length && FIELD.test(lines[head + 1 + count]!)) count++
  }

  if (change.body !== undefined) {
    const start = head + 1 + count
    let end = start
    while (end < lines.length && !lines[end]!.startsWith("## ")) end++
    // Keep one blank line separating the body from the next heading.
    lines.splice(start, end - start, ...change.body.split("\n"), "")
  }

  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`)
  // Read-only protection (when active) does not block rename on POSIX, but
  // Windows refuses to replace a read-only target — restore writability
  // first and re-apply protection right after.
  await allowWrite(path)
  await Bun.write(tmp, lines.join("\n"))
  await rename(tmp, path)
  await reprotect(path)
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('"')) return trimmed
  try {
    return JSON.parse(trimmed) as string
  } catch {
    return trimmed.slice(1, -1)
  }
}

// Field values are single-line; JSON.stringify escapes embedded quotes.
function quote(value: string): string {
  return JSON.stringify(value.replace(/\s+/g, " ").trim())
}

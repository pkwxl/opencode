import { realpath, rename } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { allowWrite, reprotect } from "./protect"

// 落笔目标解析(轮次专用目录方案): 阶段化流程下根 PLAN.md 是指向轮次目录
// docs/R-NN/PLAN.md 的相对符号链接(单一事实源);rename 会替换链接本身而非写穿,
// 故临时文件与改名一律落到链接目标(真实路径),链接保持存活。非符号链接
// (phases = "m" 纯人工模式)= 原路径,行为零变化。
async function writeTarget(path: string): Promise<string> {
  return await realpath(path).catch(() => path)
}

export const STATUSES = ["pending", "in_progress", "blocked", "done"] as const
export type Status = (typeof STATUSES)[number]

export type Task = {
  id: string
  title: string
  status: Status
  attempts: number
  // fork 分解流水线的分叉基点会话 id(fork-decompose 设计 §4.2): session 模式 =
  // 理解会话 id;digest 模式 = 基点确认会话 id,带 `digest:` 前缀(一经建立即跨
  // 运行持久,恢复运行存活即复用,失效才从 context.md 重建覆写);driver 独占写入
  // (setForkBase),跨运行持久。
  forkBase?: string
  body: string
}

export type Plan = {
  path: string
  tasks: Task[]
}

// ## T-001: 任务标题 [pending]
// 容忍状态标记前缺空格(## T-001: 标题[pending])——否则该标题会被静默
// 吞进上一任务正文,任务从解析结果中消失,next() 直接跳到更后面的任务。
const HEADING = /^## (T-[\w-]+): (.+?)\s*\[(pending|in_progress|blocked|done)\]\s*$/
//   - attempts: 2
// Unknown field lines (including the retired verify/verified/final) are kept
// verbatim by edit() and otherwise ignored.
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
      attempts: Number(fields.get("attempts") ?? 0),
      forkBase: fields.get("fork-base"),
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

// The `产出:` artifact-declaration parser lives in the document domain
// (src/document/spec.ts declaredArtifacts, M1.4): the declaration format and
// its mechanical check semantics are owned end to end by that domain.

export async function begin(path: string, id: string) {
  const plan = await load(path)
  const task = require(plan, id)
  await edit(path, id, { status: "in_progress", fields: { attempts: String(task.attempts + 1) } })
}

// Crash recovery at run start: an interrupted run (kill, crash) leaves tasks
// marked in_progress even though no session is actually running. Reset them
// to pending; the loop resumes them via next() either way, attempts survive.
// Keeps at most one in_progress task — the one the current run is executing.
export async function resetInProgress(path: string): Promise<string[]> {
  const plan = await load(path)
  const stale = plan.tasks.filter((task) => task.status === "in_progress")
  for (const task of stale) await edit(path, task.id, { status: "pending" })
  return stale.map((task) => task.id)
}

// 阻塞只改状态: 原因与处置结果不再写进 PLAN.md——两者在运行日志与终端里都完整
// 在案,把它们复刻进 PLAN.md 只是对该文件的又一次改写(而 PLAN.md 的每一次改写
// 都要落账、都参与下一个执行单元的 clean 门禁)。存量的 question/answer/blocked-at
// 三行在此一并清除,退役才算落到实处(edit 会原样保留未知字段行)。
export async function block(path: string, id: string) {
  await edit(path, id, {
    status: "blocked",
    fields: { question: undefined, answer: undefined, "blocked-at": undefined },
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

// Reconciles checklist ticks with the authoritative subtask state files
// (M1.0, plans/0030 D10): done.md existence wins over the PLAN.md checkbox
// (files are the progress fact; ticks are the display track). Item i's
// checkbox is set to done[i]; only differing lines change.
export async function syncSubtaskTicks(path: string, id: string, done: boolean[]) {
  const plan = await load(path)
  const task = require(plan, id)
  let at = 0
  let changed = false
  const body = task.body
    .split("\n")
    .map((line) => {
      const match = /^\s*- \[( |x|X)\]\s*(.*)$/.exec(line)
      if (!match) return line
      const want = done[at++]
      if (want === undefined || want === (match[1]!.toLowerCase() === "x")) return line
      changed = true
      return line.replace(/- \[( |x|X)\]/, want ? "- [x]" : "- [ ]")
    })
    .join("\n")
  if (changed) await edit(path, id, { body })
}

// 记录 fork 分解流水线的分叉基点会话(fork-decompose 设计 §4.2): session 模式在
// 理解会话成功后写入,digest 模式在基点确认会话建立后以 `digest:` 前缀覆写(持久
// 基点,ensureForkBase 存活即复用);AI 会话不写此字段。
export async function setForkBase(path: string, id: string, sessionID: string) {
  await edit(path, id, { fields: { "fork-base": sessionID } })
}

// Marks the task [done].
export async function markDone(path: string, id: string) {
  await edit(path, id, { status: "done" })
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

  const target = await writeTarget(path)
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`)
  // Read-only protection (when active) does not block rename on POSIX, but
  // Windows refuses to replace a read-only target — restore writability
  // first and re-apply protection right after.
  await allowWrite(target)
  await Bun.write(tmp, lines.join("\n"))
  await rename(tmp, target)
  await reprotect(target)
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

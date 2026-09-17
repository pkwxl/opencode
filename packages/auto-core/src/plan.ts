import { realpath, rename } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import type { FinalStage } from "./prompt"
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
  verify?: string
  verified?: string
  attempts: number
  // 终审阶段标记(--final-review 追加的 T-F 任务): <stage>@<round>,如 audit@1。
  // FIELD 行通用解析,edit 重写时随全部字段行保留。
  final?: string
  // fork 分解流水线的分叉基点会话 id(fork-decompose 设计 §4.2): session 模式 =
  // 理解会话 id,digest 模式 = 基点确认会话 id(每次运行从 context.md 重建覆写);
  // driver 独占写入(setForkBase),跨运行持久。
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
      attempts: Number(fields.get("attempts") ?? 0),
      final: fields.get("final"),
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

// —— 子任务声明产出解析(session-boundary-hardening 设计 §4.3 D4)——

// `产出:` 字段的结构化产物声明: 检查项文本内以「产出:」引出的路径清单,driver
// 据此做存在性/形检(不硬编码 index.md 等工作区约定,清单全部来自声明)。语法
// 与 decompose 提示词的「每项声明产出」约定对齐,容错宽进:
//   - [ ] 调研 X 产出: docs/T-001/S01/record.md、src/y.ts
//   - [ ] 写文档 产出: docs/T-001/S01/index.md(背景、结论)
// 路径间以逗号/顿号/分号/空白分隔,路径后圆括号内为可选的必填章节标题清单
// (紧跟或以独立括号项附于路径之后);反引号包裹的路径剥壳;不含 `/` 且无扩展名
// 的字样(自然语言,如「调研结论」)不是路径,跳过——纯文字声明的零产物会话由
// 零落盘判据另行兜住。
export type DeclaredArtifact = { path: string; sections: string[] }

export function declaredArtifacts(text: string): DeclaredArtifact[] {
  const decl = /(?:^|\s)产出\s*[:：]\s*(.+)$/.exec(text)?.[1]
  if (!decl) return []
  const out: DeclaredArtifact[] = []
  let current: DeclaredArtifact | undefined
  for (const raw of splitTopLevel(decl)) {
    const token = raw.replace(/^`+/, "").replace(/`+$/, "")
    const attached = /^([^\s()（）]+)[(（]([^)）]*)[)）]$/.exec(token)
    if (attached) {
      current = declarePath(out, attached[1]!)
      addSections(current, attached[2]!)
    } else if (/^[(（][^)）]*[)）]$/.test(token)) {
      addSections(current, token.slice(1, -1))
    } else {
      current = declarePath(out, token)
    }
  }
  return out
}

// 顶层切词(圆括号内不切): 路径清单的逗号/顿号/分号/句号/空白分隔符不进括号内
// 的章节标题;孤立的右括号属噪声,丢弃。
function splitTopLevel(text: string): string[] {
  const tokens: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of text) {
    if (ch === "(" || ch === "（") depth++
    else if (ch === ")" || ch === "）") {
      if (depth > 0) depth--
      else continue
    }
    if (depth === 0 && /[\s,，、;；。]/.test(ch)) {
      if (cur) tokens.push(cur)
      cur = ""
      continue
    }
    cur += ch
  }
  if (cur) tokens.push(cur)
  return tokens
}

// 路径样判据: 含 / 或带扩展名;不满足即自然语言字样,不构成声明。
function declarePath(out: DeclaredArtifact[], token: string): DeclaredArtifact | undefined {
  if (!/(\/|\.[A-Za-z0-9]+$)/.test(token)) return undefined
  const item: DeclaredArtifact = { path: token, sections: [] }
  out.push(item)
  return item
}

function addSections(item: DeclaredArtifact | undefined, text: string) {
  if (!item) return
  for (const section of text.split(/[,，、;；|]/).map((part) => part.trim()).filter(Boolean)) {
    item.sections.push(section)
  }
}

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

// Appends unticked checklist items after the task body's existing checklist
// block (at the end of the body when it has none). Review-fix items go
// through this so the regular subtask sessions execute them.
export async function appendSubtasks(path: string, id: string, items: string[]) {
  const plan = await load(path)
  const task = require(plan, id)
  const checklist = items.map((item) => `- [ ] ${item}`).join("\n")
  const lines = task.body.split("\n")
  const last = lines.findLastIndex((line) => /^\s*- \[( |x|X)\]/.test(line))
  await edit(path, id, {
    body:
      last === -1
        ? task.body
          ? `${task.body}\n\n${checklist}`
          : checklist
        : [...lines.slice(0, last + 1), checklist, ...lines.slice(last + 1)].join("\n"),
  })
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

// 记录 fork 分解流水线的分叉基点会话(fork-decompose 设计 §4.2): session 模式在
// 理解会话成功后写入,digest 模式在基点确认会话建立后覆写;AI 会话不写此字段。
export async function setForkBase(path: string, id: string, sessionID: string) {
  await edit(path, id, { fields: { "fork-base": sessionID } })
}

// Marks the task [done]. A passing verify run records its command in the
// `verified` field; without one the field is cleared (no stale record).
export async function markDone(path: string, id: string, verified?: string) {
  await edit(path, id, { status: "done", fields: { verified } })
}

// 文件尾追加完整任务块(标题行 + 字段行 + 正文;终审 T-F 任务经 src/final.ts
// 使用,主循环 next() 按文件顺序自然拾取)。原子写,复用 edit 的
// allowWrite/reprotect 流程;重复 ID 直接报错,避免写出不可解析的计划文件。
export async function appendTask(path: string, task: Task) {
  const text = await Bun.file(path).text()
  if (parse(path, text).tasks.some((existing) => existing.id === task.id)) {
    throw new Error(`${path}: task ${task.id} already exists`)
  }
  const fields = [
    ...(task.final ? [`  - final: ${task.final}`] : []),
    ...(task.verify ? [`  - verify: ${task.verify}`] : []),
    ...(task.verified ? [`  - verified: ${task.verified}`] : []),
    ...(task.attempts ? [`  - attempts: ${task.attempts}`] : []),
  ]
  const block = [`## ${task.id}: ${task.title} [${task.status}]`, ...fields, task.body].join("\n")
  const target = await writeTarget(path)
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`)
  await allowWrite(target)
  await Bun.write(tmp, `${text.trimEnd()}\n\n${block}\n`)
  await rename(tmp, target)
  await reprotect(target)
}

// Task-level verify convention: a "command: <cmd>" prefix declares a concrete
// command; anything else is natural language. resolveVerifyScript uses it to
// pick the script source (existing file / wrapped verify.sh / generation
// session); the judge session interprets the field as the acceptance standard
// and what actually ran is recorded in the task's `verified` field.
export function verifyCommand(task: Task): string | undefined {
  const match = /^command:\s*(.+)$/.exec(task.verify?.trim() ?? "")
  return match?.[1]?.trim() || undefined
}

// 终审阶段标记解析(--final-review 追加的 T-F 任务): `<stage>@<round>`,如
// audit@1;缺失、格式或阶段名非法、轮数非正返回 undefined。
export function parseFinalMark(final: string | undefined): { stage: FinalStage; round: number } | undefined {
  const match = /^(\w+)@(\d+)$/.exec(final?.trim() ?? "")
  if (!match) return undefined
  const stage = match[1]!
  if (stage !== "audit" && stage !== "remediate" && stage !== "validate" && stage !== "finalize") return undefined
  const round = Number(match[2]!)
  return round >= 1 ? { stage: stage as FinalStage, round } : undefined
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

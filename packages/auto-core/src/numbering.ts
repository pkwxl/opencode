import { rm } from "node:fs/promises"
import { join } from "node:path"
import { parseIndex } from "./document/unit"
import { renderNumberRecovery } from "./prompt"
import type { ClientSource, Opts, UnitStop } from "./opts"
import { requireArtifact } from "./artifact"

// --auto-number(config.autoNumber)的任务编号记录机制: 任务编号(T-NNN)在目标目录
// 永不重复,下一可用编号持久化在 .auto/next-task(driver 维护的状态文件;.auto/
// 已被 gitignore,新克隆天然缺失)。阶段规划会话自该记录续接编号(不再每阶段从
// T-001 重排);记录缺失时先恢复再继续——无任何历史证据(全新项目)直接写 1,
// 有历史证据时开旁路一次性 AI 恢复会话通读任务索引/docs 产物/git 历史推导
// 下一编号(git 历史中可能存在产物已被删除的编号,纯文件扫描看不到),driver
// 以确定性扫描的下限校验其产出。--no-auto-number(退出开关)下本文件整体不生效。

// 编号记录文件(相对目标目录): 内容仅为一个正整数(下一可用编号)。
export const NEXT_TASK_FILE = join(".auto", "next-task")

// 任务编号提取: 仅认 T-<纯数字> 形态(T-F 等终审编号是独立的推导命名空间,
// 不参与自动编号记录)。
export function taskNumber(id: string): number | undefined {
  const match = /^T-(\d+)$/.exec(id)
  return match ? Number(match[1]) : undefined
}

export async function readNextTask(dir: string): Promise<number | undefined> {
  const text = await Bun.file(join(dir, NEXT_TASK_FILE)).text().catch(() => undefined)
  if (text === undefined) return undefined
  const n = Number(text.trim())
  return Number.isInteger(n) && n >= 1 ? n : undefined
}

export async function writeNextTask(dir: string, n: number): Promise<void> {
  await Bun.write(join(dir, NEXT_TASK_FILE), `${n}\n`)
}

// 已用编号的确定性下限: 扫描各轮各阶段的任务索引(docs/R-*/P*/tasks.md,M3.4)与
// 任务目录(docs/**/T-*/*.md 取路径段——任务单元的 todo.md/done.md 即在其中),
// 取最大编号 + 1;
// 无证据 = 1。只能看到现存文件——已被删除产物占用的编号需 AI 恢复会话查 git 历史补全。
export async function taskNumberFloor(dir: string): Promise<number> {
  let max = 0
  const seen = (id: string) => {
    const n = taskNumber(id)
    if (n !== undefined) max = Math.max(max, n)
  }
  for await (const file of new Bun.Glob(join("docs", "R-*", "P*", "tasks.md")).scan({ cwd: dir, onlyFiles: true })) {
    const text = await Bun.file(join(dir, file)).text().catch(() => "")
    for (const entry of parseIndex(text, "task").entries) seen(entry.id)
  }
  // 目录化布局: docs/**/T-*/*.md,取首个 T-<纯数字> 路径段(T-F<k> 锚定段被
  // taskNumber 自然过滤)。
  for await (const file of new Bun.Glob(join("docs", "**", "T-*", "*.md")).scan({ cwd: dir, onlyFiles: true })) {
    for (const segment of file.split(/[\\/]/)) {
      if (/^T-\d+$/.test(segment)) {
        seen(segment)
        break
      }
    }
  }
  return max + 1
}

// 规划会话产出后推进编号记录: 取本次任务索引中最大编号 + 1(只增不减;
// 编号小于既有记录不动——collect 已拦下该情况,这里仅作兜底)。
export async function advanceNextTask(dir: string, ids: string[]): Promise<number> {
  const used = Math.max(0, ...ids.map((id) => taskNumber(id) ?? 0))
  const next = used + 1
  const current = await readNextTask(dir)
  if (current === undefined || next > current) await writeNextTask(dir, next)
  return Math.max(next, current ?? 0)
}

// 确保编号记录就位(规划会话前调用): 记录存在直接返回;缺失时先恢复——
// 下限为 1(无任何历史证据,全新项目)直接写 1 不开会话;否则开旁路一次性
// AI 恢复会话(镜像 knowledge.ts 的 requireArtifact 骨架,伪任务 PLAN 不进
// 任务链、不写进度记录),产物 = AI 写入的有效 .auto/next-task,driver 以
// 确定性下限校验(小于下限视为无效产出,带反馈重试一次,仍失败隐性阻塞)。
export async function ensureNumbering(
  client: ClientSource,
  dir: string,
  opts: Opts,
): Promise<{ type: "ok"; next: number } | UnitStop> {
  const existing = await readNextTask(dir)
  if (existing !== undefined) return { type: "ok", next: existing }
  const floor = await taskNumberFloor(dir)
  if (floor === 1) {
    await writeNextTask(dir, 1)
    return { type: "ok", next: 1 }
  }
  const recovered = await requireArtifact(
    client,
    { id: "PLAN", title: "task numbering record recovery", status: "in_progress", attempts: 0, body: "" },
    renderNumberRecovery({ floor }),
    opts,
    {
      kind: "numbering recovery",
      role: "number-recovery",
      // Independent hidden task unit (plans/0021-commit-boundary-design.md). The artifact
      // .auto/next-task is gitignored and touches no tracked file; the gate mainly covers
      // the close-out check and any other file the session might touch.
      unitStart: true,
      artifact: `a valid numbering record ${NEXT_TASK_FILE} (a positive integer not below ${floor})`,
      detail: "missing, not a positive integer, or below the used-number floor",
      requirement: `write the derived next available task number to ${NEXT_TASK_FILE}: the file holds only a positive integer not below ${floor} (a trailing newline is fine), nothing else.`,
      commit: { stage: "numbering", subject: "PLAN numbering next-task record recovery" },
      reset: () => rm(join(dir, NEXT_TASK_FILE), { force: true }),
      collect: async () => {
        const n = await readNextTask(dir)
        return n !== undefined && n >= floor ? n : undefined
      },
    },
  )
  if (typeof recovered === "number") return { type: "ok", next: recovered }
  return recovered
}

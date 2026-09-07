import { rm } from "node:fs/promises"
import { basename, join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { parse } from "./plan"
import { renderNumberRecovery } from "./prompt"
import { requireArtifact, type Opts } from "./runner"

// --auto-number(config.autoNumber)的任务编号记录机制: 任务编号(T-NNN)在目标目录
// 永不重复,下一可用编号持久化在 .auto/next-task(driver 维护的状态文件;.auto/
// 已被 gitignore,新克隆天然缺失)。阶段规划会话自该记录续接编号(不再每阶段从
// T-001 重排);记录缺失时先恢复再继续——无任何历史证据(全新项目)直接写 1,
// 有历史证据时开旁路一次性 AI 恢复会话通读归档 PLAN/docs 产物/git 历史推导
// 下一编号(git 历史中可能存在产物已被删除的编号,纯文件扫描看不到),driver
// 以确定性扫描的下限校验其产出。--no-auto-number(缺省)下本文件整体不生效。

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

// 已用编号的确定性下限: 扫描当前 PLAN.md、阶段/轮次归档 PLAN(docs/phases/**
// /PLAN.md,交接会把 docs/ 任务文档一并移入归档目录,故 docs 产物路径同样
// 覆盖归档)与 docs 任务文档(双布局: 目录化 docs/**/T-*/*.md 取路径段,旧平铺
// docs/**/T-*.md 取文件名——兼容期两者并存,归档目录内的同样覆盖),取最大
// 编号 + 1;无证据 = 1。只能看到现存文件——已被删除产物占用的编号需 AI 恢复
// 会话查 git 历史补全。
export async function taskNumberFloor(dir: string): Promise<number> {
  let max = 0
  const seen = (id: string) => {
    const n = taskNumber(id)
    if (n !== undefined) max = Math.max(max, n)
  }
  const scanPlan = async (path: string) => {
    const text = await Bun.file(path).text().catch(() => undefined)
    if (text === undefined) return
    // 解析失败(如重复编号)不中断扫描,退化为正则提取标题行编号。
    try {
      for (const task of parse(path, text).tasks) seen(task.id)
      return
    } catch {
      for (const line of text.split("\n")) {
        const heading = /^## (T-\d+): /.exec(line)
        if (heading) seen(heading[1]!)
      }
    }
  }
  await scanPlan(join(dir, "PLAN.md"))
  for await (const file of new Bun.Glob(join("docs", "phases", "**", "PLAN.md")).scan({ cwd: dir, onlyFiles: true })) {
    await scanPlan(join(dir, file))
  }
  // 旧平铺布局(兼容期): docs/**/T-*.md,取文件名的任务编号段。
  for await (const file of new Bun.Glob(join("docs", "**", "T-*.md")).scan({ cwd: dir, onlyFiles: true })) {
    seen(basename(file, ".md").split(".")[0]!)
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

// 规划会话产出后推进编号记录: 取本次 PLAN.md 中最大编号 + 1(只增不减;
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
  client: OpencodeClient,
  dir: string,
  opts: Opts,
): Promise<{ type: "ok"; next: number } | { type: "blocked"; question: string }> {
  const existing = await readNextTask(dir)
  if (existing !== undefined) return { type: "ok", next: existing }
  const floor = await taskNumberFloor(dir)
  if (floor === 1) {
    await writeNextTask(dir, 1)
    return { type: "ok", next: 1 }
  }
  const recovered = await requireArtifact(
    client,
    { id: "PLAN", title: "任务编号记录恢复", status: "in_progress", attempts: 0, body: "" },
    renderNumberRecovery({ floor }),
    opts,
    {
      kind: "编号恢复",
      artifact: `有效编号记录 ${NEXT_TASK_FILE}(不小于 ${floor} 的正整数)`,
      detail: "缺失、非正整数或小于已用编号下限",
      requirement: `必须把推导出的下一可用任务编号写入 ${NEXT_TASK_FILE}: 文件内容仅为一个不小于 ${floor} 的正整数(可带换行),不要写任何其他内容。`,
      commit: { stage: "numbering", subject: "PLAN numbering 任务编号记录恢复" },
      reset: () => rm(join(dir, NEXT_TASK_FILE), { force: true }),
      collect: async () => {
        const n = await readNextTask(dir)
        return n !== undefined && n >= floor ? n : undefined
      },
    },
  )
  if (typeof recovered === "number") return { type: "ok", next: recovered }
  return { type: "blocked", question: recovered.question }
}

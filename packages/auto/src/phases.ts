// 阶段注册表与阶段状态机(--phases 阶段化流程,设计文档 docs/phases-design.md
// A/C/D/F 节):固定六字母内置注册表,不开放自定义——阶段有 driver 侧语义(产物
// 约定、v 的验收豁免、终审挂接点),非纯提示词文案。阶段状态是推导式的:
// docs/phases.md 台账记录已完成阶段,当前阶段 = phases 串中第一个未在台账出现的
// 字母,零新增易腐状态;routePhase 由(台账, PLAN.md)两文件推导路由,无隐藏
// 状态,中断恢复即重新求值。
import { mkdir, readdir, rename, stat } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import type { Plan } from "./plan"
import { renderText } from "./template"
import templateScaffold from "../templates/PLAN.scaffold.md" with { type: "file" }

export type Phase = "a" | "d" | "m" | "t" | "v" | "k"

// 唯一合法顺序;校验与推导共用。
export const PHASE_ORDER = "admtvk"

const PHASE_NAMES: Record<Phase, string> = {
  a: "分析",
  d: "设计",
  m: "迁移实现",
  t: "测试",
  v: "验收",
  k: "知识提炼",
}

export function phaseText(phase: Phase): string {
  return PHASE_NAMES[phase]
}

// 校验 phases 取值: 非空、字母 ∈ admtvk、不重复、含 m、为 admtvk 的子序列
// (顺序是语义的一部分,自由排列只产生无意义组合);非法返回 null(CLI 转退出码 1)。
// 严格递增的下标遍历同时覆盖"子序列"与"不重复"两个约束。
export function parsePhases(raw: string): Phase[] | null {
  if (!raw) return null
  let prev = -1
  let hasM = false
  for (const ch of raw) {
    const index = PHASE_ORDER.indexOf(ch)
    if (index === -1 || index <= prev) return null
    prev = index
    if (ch === "m") hasM = true
  }
  return hasM ? ([...raw] as Phase[]) : null
}

// 阶段台账(docs/phases.md): 版本化、随仓库提交、人工可编辑。每行一个已完成阶段,
// 行协议 `- [done] <letter> <名称> → <归档目录>(交接: <handover>)`,driver 只读
// 字母与归档目录两列,其余为人工可读信息;容忍空行与 # 注释/标题。文件缺失 = 流程
// 尚未开始。台账行无法解析 / 字母越界 / 重复 → throw(环境错误退出 1,报文给人工
// 修订指引,见设计文档 C.3 回退规程)。
export type Ledger = { done: Phase[] }

export async function readLedger(dir: string): Promise<Ledger> {
  const text = await Bun.file(join(dir, "docs", "phases.md")).text().catch(() => undefined)
  if (text === undefined) return { done: [] }
  const done: Phase[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const entry = /^-\s*\[done\]\s+([a-z])\s+\S+\s+→\s+\S/.exec(trimmed)
    const letter = entry?.[1]
    if (!letter || !PHASE_ORDER.includes(letter) || done.includes(letter as Phase)) {
      throw new Error(
        `docs/phases.md 台账行无法解析或非法: ${trimmed}` +
          `(行协议: - [done] <letter> <名称> → <归档目录>,字母取 ${PHASE_ORDER} 中不重复的值;请人工修订该文件,回退规程见 README)`,
      )
    }
    done.push(letter as Phase)
  }
  return { done }
}

// 各阶段归档目录英文名(A.1 产物约定的目录化;台账行、归档目录与交接文档共用)。
const PHASE_SLUGS: Record<Phase, string> = {
  a: "analysis",
  d: "design",
  m: "migrate",
  t: "testing",
  v: "acceptance",
  k: "knowledge",
}

// 阶段归档目录(相对目标目录): docs/phases/<letter>-<slug>/。
export function phaseArchive(phase: Phase): string {
  return `docs/phases/${phase}-${PHASE_SLUGS[phase]}`
}

// 台账追加(交接完成后、统一提交前调用;C.1 行协议)。查重后追加,重复调用幂等
// ——交接在"台账追加之前"中断时,恢复路径安全补写。文件缺失时带头部注释创建。
export async function appendLedger(dir: string, phase: Phase): Promise<void> {
  if ((await readLedger(dir)).done.includes(phase)) return
  const file = join(dir, "docs", "phases.md")
  const existing = await Bun.file(file).text().catch(() => undefined)
  const header = "# 阶段台账(opencode-auto 维护;人工修订见 README)"
  const line = `- [done] ${phase} ${phaseText(phase)} → ${phaseArchive(phase)}/(交接: ${phaseArchive(phase)}/handover.md)`
  await Bun.write(file, `${(existing ?? header).trimEnd()}\n\n${line}\n`)
}

// 阶段路由(D.2,镜像 routeFinal 风格的纯路由函数): blocked = 台账非法等环境
// 错误(CLI 转退出码 1,报文给人工修订指引)。
export type PhaseRoute =
  | { type: "complete" } // 全部阶段完成
  | { type: "plan"; phase: Phase } // PLAN.md 空(模板态/已重置)→ 开规划会话
  | { type: "execute"; phase: Phase } // 主循环有任务可跑
  | { type: "handover"; phase: Phase } // 本阶段任务全 done → 进入交接
  | { type: "blocked"; reason: string }

export async function routePhase(dir: string, plan: Plan, phases: string): Promise<PhaseRoute> {
  let ledger: Ledger
  try {
    ledger = await readLedger(dir)
  } catch (error) {
    return { type: "blocked", reason: error instanceof Error ? error.message : String(error) }
  }
  const declared = [...phases] as Phase[]
  const outside = ledger.done.filter((letter) => !declared.includes(letter))
  if (outside.length) {
    return {
      type: "blocked",
      reason:
        `docs/phases.md 台账记录了 phases(${phases})之外的阶段字母: ${outside.join("、")}。` +
        "请人工修订该文件(回退规程见 README)后重新运行",
    }
  }
  const phase = (PHASE_ORDER.split("") as Phase[]).find((letter) => declared.includes(letter) && !ledger.done.includes(letter))
  if (!phase) return { type: "complete" }
  if (plan.tasks.some((task) => task.status !== "done")) return { type: "execute", phase }
  if (plan.tasks.length) return { type: "handover", phase }
  return { type: "plan", phase }
}

// 阶段进度行(B.2/B.3,run 启动横幅与 status 共用): ✓ = 台账已记录,▶ = 当前
// 阶段,其余字母 = 未开始。
export function formatPhases(phases: string, done: Phase[]): string {
  let current = true
  return ([...phases] as Phase[])
    .map((letter) => {
      if (done.includes(letter)) return `${letter}✓`
      if (current) {
        current = false
        return `${letter}▶`
      }
      return letter
    })
    .join(" ")
}

// 阶段空模板(PLAN.scaffold.md,verify 条件渲染): 阶段化流程下 PLAN.md 的初始态
// 与交接重置态——不含任何任务,routePhase 由此推导出 plan 路由(D.2)。init 对
// phases ≠ "m" 的项目亦以此为 PLAN.md 模板(B.1)。
export function renderPlanScaffold(verify: boolean): string {
  return renderText(readFileSync(templateScaffold, "utf8"), { verify })
}

// 阶段开始的 docs/ 快照与交接归档(F 节)。
const SNAPSHOT_FILE = join(".auto", "phase-snapshot.json")

// A.1 表约定的各阶段产物目录(docs/ 下一级,相对 docs/): 快照缺失时(中断/清理)
// 的归档退化依据。m 阶段产物为源码 + docs/ 任务报告与终审产物(docs/final/),
// 无专属产物目录。
const PHASE_PRODUCTS: Record<Phase, string[]> = {
  a: ["analysis"],
  d: ["design"],
  m: ["final"],
  t: ["testing"],
  v: ["acceptance"],
  k: ["migration-kb"],
}

// docs/ 内参与快照/归档的文件(相对 docs/ 路径 → mtimeMs): 排除 docs/phases/
// (历届归档)、docs/phases.md(台账)与 docs/agents/(AGENTS.md 维护规则块路由的
// 跨阶段工作流知识)——它们不属于任何单一阶段的产物。
async function docsFiles(dir: string): Promise<Map<string, number>> {
  const root = join(dir, "docs")
  const files = new Map<string, number>()
  const pending = [root]
  while (pending.length) {
    const current = pending.pop()!
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (current === root && entry.name === "phases" && entry.isDirectory()) continue
      if (current === root && entry.name === "agents" && entry.isDirectory()) continue
      if (current === root && entry.isFile() && entry.name === "phases.md") continue
      const abs = join(current, entry.name)
      if (entry.isDirectory()) {
        pending.push(abs)
        continue
      }
      if (!entry.isFile()) continue
      files.set(relative(root, abs), (await stat(abs)).mtimeMs)
    }
  }
  return files
}

// 阶段开始(规划会话前)记录 docs/ 快照到 .auto/phase-snapshot.json(非版本化,
// 不进仓库);交接时据此判定"本阶段新增/改动"的归档差异项。
export async function snapshotDocs(dir: string): Promise<void> {
  const files = await docsFiles(dir)
  await Bun.write(join(dir, SNAPSHOT_FILE), JSON.stringify(Object.fromEntries(files)))
}

// 交接归档(F.2): 把本阶段新增/改动的 docs/ 内容移入归档目录(保持相对路径)。
// 差异判定依阶段开始快照(文件名+mtime);快照缺失时退化为移动 A.1 表约定的
// 本阶段产物目录与 docs/T-* 任务产物。已移走的文件不在 docs/ 中,重复调用自然
// 幂等(交接中断重跑的安全侧)。返回移动的相对路径清单。
export async function archivePhaseDocs(dir: string, phase: Phase): Promise<string[]> {
  const snapshot = (await Bun.file(join(dir, SNAPSHOT_FILE)).json().catch(() => undefined)) as Record<string, number> | undefined
  const current = await docsFiles(dir)
  const diff = snapshot
    ? [...current].filter(([rel, mtime]) => snapshot[rel] !== mtime).map(([rel]) => rel)
    : [...current.keys()].filter((rel) => PHASE_PRODUCTS[phase].includes(rel.split(/[\\/]+/)[0]!) || /^T-[\w.-]+\.md$/.test(rel))
  const archive = join(dir, phaseArchive(phase))
  for (const rel of diff) {
    const target = join(archive, rel)
    await mkdir(dirname(target), { recursive: true })
    await rename(join(dir, "docs", rel), target)
  }
  return diff.sort()
}

// 交接文档的四个必备小节(F.1 协议): 蒸馏会话产物的 collect 校验与提示词模板
// 的协议标记(phase-handover.md 内联同一组标题)共用。
export const HANDOVER_SECTIONS = ["## 关键决策", "## 约束与坑", "## 下一阶段必读清单", "## 产物索引"]

// 校验 handover.md 四小节齐备: 标题须为逐字匹配的独立行(次级标题 ### 不算数,
// "### 关键决策"包含子串但不是合规标题)。
export function validHandover(text: string): boolean {
  return HANDOVER_SECTIONS.every((section) => text.split("\n").some((line) => line.trim() === section))
}

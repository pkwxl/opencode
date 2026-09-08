// 阶段注册表与阶段状态机(--phases 阶段化流程,设计文档 docs/phases-design.md
// A/C/D/F 节):固定六字母内置注册表,不开放自定义——阶段有 driver 侧语义(产物
// 约定、v 的验收豁免、终审挂接点),非纯提示词文案。阶段状态是推导式的:
// docs/phases.md 台账记录已完成阶段,当前阶段 = phases 串中第一个未在台账出现的
// 字母,零新增易腐状态;routePhase 由(台账, PLAN.md)两文件推导路由,无隐藏
// 状态,中断恢复即重新求值。
// stable-refs P2: docs/ 产物文档一律永久路径不随阶段/轮次移动——交接文档落
// docs/handovers/R<N>-<字母>-<slug>.md,归档只收过期状态文件(PLAN 快照、台账、
// 轮末 AGENTS.md 快照);P1 前的 docs/ 快照/差异归档链路已删除。
import { mkdir, readdir, rename, stat } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { join, relative } from "node:path"
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
// 字母一列,其余为人工可读信息;P2 前的旧行(交接指针指向归档目录内 handover.md)
// 同样容忍。容忍空行与 # 注释/标题。文件缺失 = 流程尚未开始。台账行无法解析 /
// 字母越界 / 重复 → throw(环境错误退出 1,报文给人工修订指引,见设计文档 C.3
// 回退规程)。
export type Ledger = { done: Phase[] }

const LEDGER_ENTRY = /^-\s*\[done\]\s+([a-z])\s+\S+\s+→\s+\S/

export async function readLedger(dir: string): Promise<Ledger> {
  const text = await Bun.file(join(dir, "docs", "phases.md")).text().catch(() => undefined)
  if (text === undefined) return { done: [] }
  return { done: parseLedger(text) }
}

// 台账文本解析(readLedger 与轮次归档内 phases.md 共用): 容忍空行与 # 注释/标题,
// 行协议 LEDGER_ENTRY(新旧两种交接指针形态均命中——正则只约束到归档目录列);
// 字母越界/重复/协议行无法解析 → throw(人工修订指引)。
function parseLedger(text: string): Phase[] {
  const done: Phase[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const letter = LEDGER_ENTRY.exec(trimmed)?.[1]
    if (!letter || !PHASE_ORDER.includes(letter) || done.includes(letter as Phase)) {
      throw new Error(
        `docs/phases.md 台账行无法解析或非法: ${trimmed}` +
          `(行协议: - [done] <letter> <名称> → <归档目录>(交接: <handover>),交接指针为可选列;字母取 ${PHASE_ORDER} 中不重复的值;请人工修订该文件,回退规程见 README)`,
      )
    }
    done.push(letter as Phase)
  }
  return done
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

// 阶段归档目录(相对目标目录): docs/phases/<letter>-<slug>/。P2 起只收过期状态
// 文件(阶段 PLAN.md 快照;P2 前还曾收本阶段 docs/ 变更与 handover.md)。
export function phaseArchive(phase: Phase): string {
  return `docs/phases/${phase}-${PHASE_SLUGS[phase]}`
}

// 阶段交接文档路径(相对目标目录,stable-refs D3): docs/handovers/R<N>-<字母>-
// <slug>.md——永久路径,落定不移动(R2),轮次经 R<N>- 文件名前缀表达(R7)。
// 构造点在本文件而非 docpaths.ts: 文件名依赖阶段 slug 表(PHASE_SLUGS 归本模块
// 所有,避免 docpaths→phases 反向依赖)。P2 前的交接位于归档目录
// docs/phases/<字母>-<slug>/handover.md,读点经读回落兼容(prevRoundDigest/
// planPhase,迁移完成后自然消亡)。
export function handoverDoc(round: number, phase: Phase): string {
  return `docs/handovers/R${round}-${phase}-${PHASE_SLUGS[phase]}.md`
}

// 阶段级自由产物目录(stable-refs P2 补口,2026-09-07): a/d/t/v 阶段中不属于任何
// 单个任务的勘测/设计/覆盖矩阵/验收记录类文档,写入 docs/phase-docs/R<N>-<字母>-
// <slug>/<name>.md——永久路径,落定不移动、不参与轮次归档(D3 handovers 同款
// 范式),轮次经 R<N>- 目录名前缀表达(R7),与 handoverDoc 交接蒸馏按同名对位
// (蒸馏 = <slug>.md,原始产物 = 同名目录)。目录名依赖阶段 slug 表,构造点在
// 本文件而非 docpaths.ts(同 handoverDoc)。
export function phaseDocsDir(round: number, phase: Phase): string {
  return `docs/phase-docs/R${round}-${phase}-${PHASE_SLUGS[phase]}`
}

// 台账追加(交接完成后、统一提交前调用;C.1 行协议)。查重后追加,重复调用幂等
// ——交接在"台账追加之前"中断时,恢复路径安全补写。文件缺失时带头部注释创建。
// 交接指针 = 本轮永久路径 handoverDoc(currentRound, phase)。
export async function appendLedger(dir: string, phase: Phase): Promise<void> {
  if ((await readLedger(dir)).done.includes(phase)) return
  const file = join(dir, "docs", "phases.md")
  const existing = await Bun.file(file).text().catch(() => undefined)
  const header = "# 阶段台账(opencode-auto 维护;人工修订见 README)"
  const line = `- [done] ${phase} ${phaseText(phase)} → ${phaseArchive(phase)}/(交接: ${handoverDoc(await currentRound(dir), phase)})`
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

// 交接文档的四个必备小节(F.1 协议): 蒸馏会话产物的 collect 校验与提示词模板
// 的协议标记(phase-handover.md 内联同一组标题)共用。
export const HANDOVER_SECTIONS = ["## 关键决策", "## 约束与坑", "## 下一阶段必读清单", "## 产物索引"]

// 校验 handover.md 四小节齐备: 标题须为逐字匹配的独立行(次级标题 ### 不算数,
// "### 关键决策"包含子串但不是合规标题)。
export function validHandover(text: string): boolean {
  return HANDOVER_SECTIONS.every((section) => text.split("\n").some((line) => line.trim() === section))
}

// —— 续轮迁移(continue 子命令,设计文档 docs/phases-design.md M 节)——

// 轮次归档目录名(docs/phases/round-<N>/): 完成轮的台账、各阶段归档目录与轮末
// PLAN 快照整体移入。docs/phases/ 本就在快照/归档排除清单内,嵌套轮次目录无需
// 新增排除规则(历届归档不属于任何单一阶段的产物)。
const ROUND_RE = /^round-(\d+)$/

// 当前轮次 = 已有轮次归档的最大编号 + 1(推导式,零新增持久化状态): 无归档 =
// 第 1 轮;人工删除归档目录即回到对应轮次。
export async function currentRound(dir: string): Promise<number> {
  const entries = await readdir(join(dir, "docs", "phases"), { withFileTypes: true }).catch(() => [])
  let max = 0
  for (const entry of entries) {
    const round = ROUND_RE.exec(entry.name)
    if (round) max = Math.max(max, Number(round[1]))
  }
  return max + 1
}

// 归档完成轮(continue 子命令在校验"上一轮已全部完成"后调用): docs/phases/ 下
// 全部阶段归档目录与根 PLAN.md(轮末快照,留痕任何轮后手工改动)移入 round-<N>/,
// 根 AGENTS.md 每轮拷贝快照(D7,轮内基本静态、阶段级快照冗余;拷贝不移动——它是
// 跨轮的工作流入口);台账最后移动——它是完成态的标记,归档中断重跑时未移动即
// 整个动作可重跑(各步为 rename/覆盖写,幂等)。docs/ 产物文档(docs/T-*/、
// docs/handovers/、docs/migration-kb/、docs/prior-kb/)为永久路径,不参与归档
// (stable-refs R2;P2 前 archiveRound 曾把 docs/migration-kb 残留一并移入)。
// 无可归档内容时不创建目录,返回轮次号。
export async function archiveRound(dir: string): Promise<number> {
  const round = await currentRound(dir)
  const root = join(dir, "docs", "phases")
  const target = join(root, `round-${round}`)
  const moves: Array<[string, string]> = []
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (ROUND_RE.test(entry.name)) continue
    moves.push([join(root, entry.name), join(target, entry.name)])
  }
  moves.push([join(dir, "PLAN.md"), join(target, "PLAN.md")])
  // 台账最后移动: 它是完成态的标记——init 的前置校验读它,归档中断重跑时
  // 台账未移动即整个动作可安全重跑(已移走的条目不在源位,各步幂等)。
  moves.push([join(dir, "docs", "phases.md"), join(target, "phases.md")])
  const sources = await Promise.all(moves.map(([from]) => stat(from).then(() => true, () => false)))
  if (!sources.some(Boolean)) return round
  await mkdir(target, { recursive: true })
  for (const [from, to] of moves.filter((_, index) => sources[index])) await rename(from, to)
  // 根 AGENTS.md 每轮拷贝快照(D7);无可归档内容(未建目录)时一并跳过。
  const agents = await Bun.file(join(dir, "AGENTS.md")).text().catch(() => undefined)
  if (agents !== undefined) await Bun.write(join(target, "AGENTS.md"), agents)
  return round
}

// 上一轮结论摘录(注入新一轮首个阶段规划会话,台账为空而存在轮次归档时): ① 各
// 阶段归档目录索引;② 最终完成阶段的交接文档全文(永久路径 docs/handovers/,
// P2 前的轮次在归档目录内,读回落);③ 迁移知识文档全文——迁移结论的核心载体
// (docs/migration-kb/ 的 R<N>- 前缀文件,无前缀存量宽松归入上一轮;P2 前的轮次
// 归档内亦有 migration-kb/,一并读回落收集)。与"蒸馏产物是唯一通道"的注入纪律
// 一致: 原始产物不注入,会话可按索引自行取用(归档目录就在工作目录内)。
// 无轮次归档 → undefined。
export async function prevRoundDigest(dir: string): Promise<string | undefined> {
  const prev = (await currentRound(dir)) - 1
  if (prev < 1) return undefined
  const root = join(dir, "docs", "phases", `round-${prev}`)
  const done = await roundDoneLetters(root)
  const dirs = (await readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && !ROUND_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  const knowledge = await collectRoundKnowledge(dir, root, prev)
  if (!done.length && !dirs.length && !knowledge.length) return undefined
  const parts = [`### 上一轮(第 ${prev} 轮)阶段归档索引(docs/phases/round-${prev}/)\n`]
  parts.push(dirs.map((name) => `- docs/phases/round-${prev}/${name}/`).join("\n"))
  const last = done[done.length - 1]
  if (last) {
    // 最终交接自永久路径读取(D3);缺失时回落 P2 前的归档目录内 handover.md。
    const handover = handoverDoc(prev, last)
    let text = await Bun.file(join(dir, handover)).text().catch(() => undefined)
    if (text === undefined) {
      const lastDir = dirs.find((name) => name.startsWith(`${last}-`))
      if (lastDir) text = await Bun.file(join(root, lastDir, "handover.md")).text().catch(() => undefined)
    }
    if (text?.trim()) {
      parts.push(`\n### 上一轮最终交接(${handover})\n`)
      parts.push(text.trim())
    }
  }
  for (const doc of knowledge) {
    parts.push(`\n### 上一轮迁移知识(${doc.rel})\n`)
    parts.push(doc.text.trim())
  }
  return parts.join("\n")
}

// 归档内台账的完成字母(宽松解析: 坏行忽略不 throw——digest 是提示词输入,严格
// 失败属于读 Ledger 的职责,这里不应让规划会话因归档笔误而中断)。
async function roundDoneLetters(root: string): Promise<Phase[]> {
  const text = await Bun.file(join(root, "phases.md")).text().catch(() => "")
  const done: Phase[] = []
  for (const line of text.split("\n")) {
    const letter = LEDGER_ENTRY.exec(line.trim())?.[1]
    if (letter && PHASE_ORDER.includes(letter) && !done.includes(letter as Phase)) done.push(letter as Phase)
  }
  return done
}

// 迁移知识文档收集(上一轮): ① docs/migration-kb/(永久路径)内 R<prev>- 前缀的
// 非空 .md——本轮次知识;无 R<N>- 前缀的存量(P2 前布局)宽松归入上一轮一并收集;
// 前几轮(R<M>-,M ≠ prev)不收集,其结论已蒸馏进上一轮知识。② P2 前的轮次归档
// 内 migration-kb/(交接归档/中断残留两处)读回落收集——新轮次归档不再含
// migration-kb,自然空集。
async function collectRoundKnowledge(dir: string, root: string, prev: number): Promise<Array<{ rel: string; text: string }>> {
  const docs: Array<{ rel: string; text: string }> = []
  const kbRoot = join(dir, "docs", "migration-kb")
  const prefix = `R${prev}-`
  for (const name of (await readdir(kbRoot).catch(() => [] as string[])).sort()) {
    if (!name.endsWith(".md") || (!name.startsWith(prefix) && /^R\d+-/.test(name))) continue
    const text = await Bun.file(join(kbRoot, name)).text().catch(() => "")
    if (text.trim()) docs.push({ rel: join("docs", "migration-kb", name), text })
  }
  const pending = [root]
  while (pending.length) {
    const current = pending.pop()!
    for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
      const abs = join(current, entry.name)
      if (entry.isDirectory()) {
        pending.push(abs)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue
      if (!relative(root, current).split(/[\\/]+/).includes("migration-kb")) continue
      const text = await Bun.file(abs).text()
      if (text.trim()) docs.push({ rel: relative(dir, abs), text })
    }
  }
  return docs.sort((a, b) => a.rel.localeCompare(b.rel))
}

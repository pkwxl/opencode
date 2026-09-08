// 阶段注册表与阶段状态机(--phases 阶段化流程,设计文档 docs/phases-design.md
// A/C/D/F 节):固定六字母内置注册表,不开放自定义——阶段有 driver 侧语义(产物
// 约定、v 的验收豁免、终审挂接点),非纯提示词文案。阶段状态是推导式的:
// 阶段台账(新布局 = 轮内 docs/R-NN/phases.md,旧布局 = 根 docs/phases.md,读
// 回落)记录已完成阶段,当前阶段 = phases 串中第一个未在台账出现的字母,零新增
// 易腐状态;routePhase 由(台账, PLAN.md)两文件推导路由,无隐藏状态,中断恢复
// 即重新求值。
// 轮次专用目录(2026-09-08 方案,plans/ROUND_WORKDIR_PLAN.md):每轮一个
// docs/R-NN/(轮首 establishRound 即建,其中一切落盘即永久——不改名、不改路径、
// 不删除),取代"共用目录 + 文件名前缀 + 轮末搬移归档"(archiveRound 已删除)。
// 存量兼容 = 只读回落:旧平铺 docs/handovers/R<N>-*.md、docs/prior-kb|migration-kb/
// 平铺、docs/phases/round-N/ 旧归档与根 docs/phases.md 旧台账原地保留为读回落源;
// 写只写新布局。
import { lstat, mkdir, readdir, rm, stat, symlink } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { roundDir } from "./docpaths"
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

// 阶段台账(新布局 = 轮内 docs/R-NN/phases.md;旧布局 = 根 docs/phases.md,存量
// 读回落): 版本化、随仓库提交、人工可编辑。每行一个已完成阶段,
// 行协议 `- [done] <letter> <名称> → <归档目录>(交接: <handover>)`,driver 只读
// 字母一列,其余为人工可读信息;P2 前的旧行(交接指针指向归档目录内 handover.md)
// 同样容忍。容忍空行与 # 注释/标题。文件缺失 = 流程尚未开始。台账行无法解析 /
// 字母越界 / 重复 → throw(环境错误退出 1,报文给人工修订指引,见设计文档 C.3
// 回退规程)。
export type Ledger = { done: Phase[] }

const LEDGER_ENTRY = /^-\s*\[done\]\s+([a-z])\s+\S+\s+→\s+\S/

// 阶段台账路径(相对目标目录): 本轮为新布局(docs/R-NN/ 已建)→ 轮内 phases.md;
// 否则根 docs/phases.md(旧布局,轮末不再搬移、原地保留)。
export async function ledgerPath(dir: string): Promise<string> {
  const root = await roundRoot(dir, await currentRound(dir))
  return root ? join(root, "phases.md") : join("docs", "phases.md")
}

export async function readLedger(dir: string): Promise<Ledger> {
  const file = await ledgerPath(dir)
  const text = await Bun.file(join(dir, file)).text().catch(() => undefined)
  if (text === undefined) return { done: [] }
  return { done: parseLedger(text, file) }
}

// 台账文本解析(readLedger 与轮次归档内 phases.md 共用): 容忍空行与 # 注释/标题,
// 行协议 LEDGER_ENTRY(新旧两种交接指针形态均命中——正则只约束到归档目录列);
// 字母越界/重复/协议行无法解析 → throw(人工修订指引)。
function parseLedger(text: string, file: string): Phase[] {
  const done: Phase[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const letter = LEDGER_ENTRY.exec(trimmed)?.[1]
    if (!letter || !PHASE_ORDER.includes(letter) || done.includes(letter as Phase)) {
      throw new Error(
        `${file} 台账行无法解析或非法: ${trimmed}` +
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

// 阶段归档目录(相对目标目录): 新布局 = 轮内 docs/R-NN/<letter>-<slug>/;旧布局
// = docs/phases/<letter>-<slug>/(legacyPhaseArchive,存量读回落)。只收过期状态
// 文件(阶段 PLAN.md 快照)。
export async function phaseArchive(dir: string, round: number, phase: Phase): Promise<string> {
  const root = await roundRoot(dir, round)
  return root ? `${root}/${phase}-${PHASE_SLUGS[phase]}` : legacyPhaseArchive(phase)
}

// 旧布局阶段归档目录(读回落): docs/phases/<letter>-<slug>/
export function legacyPhaseArchive(phase: Phase): string {
  return `docs/phases/${phase}-${PHASE_SLUGS[phase]}`
}

// 阶段交接文档路径(相对目标目录,永久,落定不移动): 新布局 = 轮内
// docs/R-NN/handovers/<letter>-<slug>.md(文件名去 R<N>- 前缀——轮次已由轮目录
// 表达);旧布局 = docs/handovers/R<N>-<letter>-<slug>.md(legacyHandoverDoc,
// 存量读回落)。构造点在本文件而非 docpaths.ts: 文件名依赖阶段 slug 表
// (PHASE_SLUGS 归本模块所有,避免 docpaths→phases 反向依赖)。P2 前的交接位于
// 阶段归档目录 <letter>-<slug>/handover.md,读点经读回落兼容(prevRoundDigest/
// planPhase,迁移完成后自然消亡)。
export async function handoverDoc(dir: string, round: number, phase: Phase): Promise<string> {
  const root = await roundRoot(dir, round)
  return root ? `${root}/handovers/${phase}-${PHASE_SLUGS[phase]}.md` : legacyHandoverDoc(round, phase)
}

// 旧布局交接文档(读回落): docs/handovers/R<N>-<letter>-<slug>.md
export function legacyHandoverDoc(round: number, phase: Phase): string {
  return `docs/handovers/R${round}-${phase}-${PHASE_SLUGS[phase]}.md`
}

// 阶段级自由产物目录(永久,落定不移动): a/d/t/v 阶段中不属于任何单个任务的
// 勘测/设计/覆盖矩阵/验收记录类文档。新布局 = 轮内 docs/R-NN/phase-docs/
// <letter>-<slug>/;旧布局 = docs/phase-docs/R<N>-<letter>-<slug>/
// (legacyPhaseDocsDir,存量读回落)。与 handoverDoc 交接蒸馏按同名对位
// (蒸馏 = <slug>.md,原始产物 = 同名目录)。构造点在本文件(同 handoverDoc)。
export async function phaseDocsDir(dir: string, round: number, phase: Phase): Promise<string> {
  const root = await roundRoot(dir, round)
  return root ? `${root}/phase-docs/${phase}-${PHASE_SLUGS[phase]}` : legacyPhaseDocsDir(round, phase)
}

// 旧布局阶段级自由产物目录(读回落): docs/phase-docs/R<N>-<letter>-<slug>/
export function legacyPhaseDocsDir(round: number, phase: Phase): string {
  return `docs/phase-docs/R${round}-${phase}-${PHASE_SLUGS[phase]}`
}

// 台账追加(交接完成后、统一提交前调用;C.1 行协议)。查重后追加,重复调用幂等
// ——交接在"台账追加之前"中断时,恢复路径安全补写。文件缺失时带头部注释创建。
// 台账路径 = ledgerPath(新布局轮内 phases.md,旧布局根 phases.md);交接指针 =
// 本轮永久路径 handoverDoc(currentRound, phase)。
export async function appendLedger(dir: string, phase: Phase): Promise<void> {
  if ((await readLedger(dir)).done.includes(phase)) return
  const round = await currentRound(dir)
  const file = await ledgerPath(dir)
  const existing = await Bun.file(join(dir, file)).text().catch(() => undefined)
  const header = "# 阶段台账(opencode-auto 维护;人工修订见 README)"
  const line = `- [done] ${phase} ${phaseText(phase)} → ${await phaseArchive(dir, round, phase)}/(交接: ${await handoverDoc(dir, round, phase)})`
  await Bun.write(join(dir, file), `${(existing ?? header).trimEnd()}\n\n${line}\n`)
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
        `${await ledgerPath(dir)} 台账记录了 phases(${phases})之外的阶段字母: ${outside.join("、")}。` +
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

// —— 轮次(续轮迁移,设计文档 docs/phases-design.md M 节;轮次专用目录方案)——

// 旧布局轮次归档目录名(docs/phases/round-<N>/): 轮次专用目录方案前的完成轮
// 归档,原地保留为读回落源(存量兼容 = 只读回落,绝不搬移旧文件)。
const LEGACY_ROUND_RE = /^round-(\d+)$/

// 新布局轮次专用目录名(docs/R-NN/): R 后两位零填充,自然进位;轮首即建。
const ROUND_DIR_RE = /^R-(\d+)$/

// 当前轮次(推导式,零新增持久化状态): 轮次专用目录 docs/R-NN/ 轮首即建,故存在
// R 系目录时当前轮 = R 系目录最大号(无 +1);无 R 系目录时按旧语义回落
// (docs/phases/round-<N> 归档最大号 + 1)——混合项目(旧 round-1..4 归档 + 新
// R-05)自然续号,全新项目(两者皆无)= 第 1 轮。
export async function currentRound(dir: string): Promise<number> {
  const entries = await readdir(join(dir, "docs"), { withFileTypes: true }).catch(() => [])
  let modern = 0
  for (const entry of entries) {
    const round = ROUND_DIR_RE.exec(entry.name)
    if (round) modern = Math.max(modern, Number(round[1]))
  }
  if (modern > 0) return modern
  const legacy = await readdir(join(dir, "docs", "phases"), { withFileTypes: true }).catch(() => [])
  let max = 0
  for (const entry of legacy) {
    const round = LEGACY_ROUND_RE.exec(entry.name)
    if (round) max = Math.max(max, Number(round[1]))
  }
  return max + 1
}

// 新一轮轮号(轮首建立用): 当前轮已被占用(R-NN 目录已建,或旧布局根台账已在)
// = 当前轮 + 1;否则当前推导值即新一轮(全新项目 = 1,旧归档已搬走的完成轮自然
// 续号)。
export async function nextRound(dir: string): Promise<number> {
  const round = await currentRound(dir)
  if (await roundRoot(dir, round)) return round + 1
  const occupied = await Bun.file(join(dir, "docs", "phases.md")).exists()
  return occupied ? round + 1 : round
}

// 轮次布局根(相对目标目录): 轮次专用目录 docs/R-NN/ 存在 = 该轮为新布局(轮内
// 路径);否则为旧布局(平铺 + docs/phases/),读点回落旧路径。
export async function roundRoot(dir: string, round: number): Promise<string | undefined> {
  const root = roundDir(round)
  return (await stat(join(dir, root)).then((s) => s.isDirectory(), () => false)) ? root : undefined
}

// 轮首建立(轮次专用目录 docs/R-NN,轮首即建、其中一切落盘即永久——不改名、不改
// 路径、不删除): ① 建轮目录(已存在 = 幂等续跑,既有内容不重写);② 轮内
// PLAN.md 初值 = opts.plan ?? 根 PLAN.md 现状(普通文件——模式互切(m → 阶段化)
// 场景拷贝为初值) ?? 阶段空模板;③ 根 PLAN.md 重建为指向轮内 PLAN.md 的相对
// 符号链接(单一事实源、零漂移,会话与 runner/protect 的 "PLAN.md" 路径认知零改动,
// 写经链接落轮内;创建失败的环境兜底为副本,linked = false 由调用方日志说明);
// ④ 根 AGENTS.md 快照写入轮内 AGENTS.md.bak(.bak 后缀避免访问轮目录文档时被当
// 指令自动加载;轮首一次性写入,已存在不重写)。
// phases = "m" 纯人工模式(无轮次)不调用本函数,根 PLAN.md 维持普通文件。
// 轮号缺省 = currentRound(init/首跑场景);开启新一轮时调用方传 nextRound。
export async function establishRound(
  dir: string,
  opts: { round?: number; plan?: string; verify?: boolean } = {},
): Promise<{ round: number; root: string; linked: boolean }> {
  const round = opts.round ?? (await currentRound(dir))
  const root = roundDir(round)
  await mkdir(join(dir, root), { recursive: true })
  const planFile = join(root, "PLAN.md")
  if (!(await Bun.file(join(dir, planFile)).exists())) {
    const rootPlan = join(dir, "PLAN.md")
    // 根 PLAN.md 是指向某轮目录的符号链接时,其内容即该轮 PLAN,不作为初值来源。
    const isLink = await lstat(rootPlan).then((s) => s.isSymbolicLink(), () => false)
    const existing = isLink ? undefined : await Bun.file(rootPlan).text().catch(() => undefined)
    await Bun.write(join(dir, planFile), opts.plan ?? existing ?? renderPlanScaffold(opts.verify ?? false))
  }
  // 重建根链接: 目标内容 = 轮内 PLAN.md 现状(幂等——重复建立不漂移)。
  const content = await Bun.file(join(dir, planFile)).text()
  await rm(join(dir, "PLAN.md"), { force: true })
  let linked = true
  try {
    await symlink(planFile, join(dir, "PLAN.md"))
  } catch {
    linked = false
    await Bun.write(join(dir, "PLAN.md"), content)
  }
  const agentsFile = join(root, "AGENTS.md.bak")
  if (!(await Bun.file(join(dir, agentsFile)).exists())) {
    const agents = await Bun.file(join(dir, "AGENTS.md")).text().catch(() => undefined)
    if (agents !== undefined) await Bun.write(join(dir, agentsFile), agents)
  }
  return { round, root, linked }
}

// 上一轮结论摘录(注入新一轮首个阶段规划会话,本轮台账为空时): ① 各阶段归档目录
// 索引;② 最终完成阶段的交接文档全文(新布局读轮内 handovers/,旧布局读永久路径
// docs/handovers/,P2 前的轮次在归档目录内,逐级读回落);③ 迁移知识文档全文
// (新布局读轮内 migration-kb.md;旧布局 docs/migration-kb/ 的 R<N>- 前缀文件,
// 无前缀存量宽松归入上一轮,P2 前轮次归档内 migration-kb/ 一并读回落收集)。
// 与"蒸馏产物是唯一通道"的注入纪律一致: 原始产物不注入,会话可按索引自行取用
// (归档/轮目录就在工作目录内)。无上一轮痕迹 → undefined。
export async function prevRoundDigest(dir: string): Promise<string | undefined> {
  const prev = (await currentRound(dir)) - 1
  if (prev < 1) return undefined
  const modern = await roundRoot(dir, prev)
  if (modern) return prevRoundModernDigest(dir, modern, prev)
  return prevRoundLegacyDigest(dir, prev)
}

// 新布局上一轮摘录: 轮目录 docs/R-NN/ 自包含——台账、阶段归档、交接与知识文档
// 全部在轮内,无需任何回落。
async function prevRoundModernDigest(dir: string, root: string, prev: number): Promise<string | undefined> {
  const abs = join(dir, root)
  const done = await roundDoneLetters(abs)
  const dirs = (await readdir(abs, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && /^[admtvk]-/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  const last = done[done.length - 1]
  const handover = last ? `${root}/handovers/${last}-${PHASE_SLUGS[last]}.md` : undefined
  const handoverText = handover ? await Bun.file(join(dir, handover)).text().catch(() => undefined) : undefined
  const knowledge = `${root}/migration-kb.md`
  const knowledgeText = await Bun.file(join(dir, knowledge)).text().catch(() => "")
  if (!dirs.length && !handoverText?.trim() && !knowledgeText.trim()) return undefined
  const parts = [`### 上一轮(第 ${prev} 轮)阶段归档索引(${root}/)\n`]
  parts.push(dirs.map((name) => `- ${root}/${name}/`).join("\n"))
  if (handover && handoverText?.trim()) {
    parts.push(`\n### 上一轮最终交接(${handover})\n`)
    parts.push(handoverText.trim())
  }
  if (knowledgeText.trim()) {
    parts.push(`\n### 上一轮迁移知识(${knowledge})\n`)
    parts.push(knowledgeText.trim())
  }
  return parts.join("\n")
}

// 旧布局上一轮摘录(存量读回落): 轮次归档 docs/phases/round-<N>/ 索引 + 永久路径
// 交接(归档目录内读回落)+ 平铺知识文档收集。
async function prevRoundLegacyDigest(dir: string, prev: number): Promise<string | undefined> {
  const root = join(dir, "docs", "phases", `round-${prev}`)
  const done = await roundDoneLetters(root)
  const dirs = (await readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && !LEGACY_ROUND_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  const knowledge = await collectRoundKnowledge(dir, root, prev)
  if (!done.length && !dirs.length && !knowledge.length) return undefined
  const rel = join("docs", "phases", `round-${prev}`)
  const parts = [`### 上一轮(第 ${prev} 轮)阶段归档索引(${rel}/)\n`]
  parts.push(dirs.map((name) => `- ${rel}/${name}/`).join("\n"))
  const last = done[done.length - 1]
  if (last) {
    // 最终交接自永久路径读取(D3);缺失时回落 P2 前的归档目录内 handover.md。
    const handover = legacyHandoverDoc(prev, last)
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

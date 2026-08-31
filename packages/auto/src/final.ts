import { rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { appendTask, parseFinalMark, type Plan, type Task } from "./plan"
import { renderFinalTask, stageText, type FinalStage } from "./prompt"
import { requireArtifact, type Opts } from "./runner"

// --final-review 终审闭环状态机(设计文档 docs/mode-final-review-design.md
// B.2/C 节)。终审阶段是入 PLAN.md 的真任务(T-F<k> + `final: <stage>@<round>`
// 字段),由主循环 next() 按文件顺序自然执行;本模块是(带 final 标记的任务及
// 其状态,docs/final/ 产物)的路由函数——无新增持久化状态,中断恢复即重新
// 求值:下一阶段任务已存在则主循环直接拾取(C.1/C.2),提案已产出未追加则
// 直接解析追加(C.3),全部完成则结束(C.5)。

// 生成会话产出的任务提案文件(相对目标目录)。
export function finalProposalFile(stage: FinalStage, round: number): string {
  return `docs/final/plan-${stage}-r${round}.md`
}

// 各阶段任务的报告文件(相对目标目录);remediate 的报告名取决于同轮审计
// 策略(重构→refactor,修补→patch)。
export function finalReportFile(stage: FinalStage, round: number, remediate: "refactor" | "patch" = "refactor"): string {
  switch (stage) {
    case "audit":
      return `docs/final/audit-r${round}.md`
    case "remediate":
      return `docs/final/${remediate}-r${round}.md`
    case "validate":
      return `docs/final/validate-r${round}.md`
    case "finalize":
      return `docs/final/finalize.md`
  }
}

// 审计报告末行策略(driver 依此确定性路由): 重构|修补|无。取最后一个策略行,
// 取值非法或缺失返回 undefined——正常不可能(提案正文对报告协议有硬性要求),
// 命中按报告异常(C.4)处理。
export function parseStrategy(text: string): "重构" | "修补" | "无" | undefined {
  const lines = text.trimEnd().split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim()
    if (!/^策略[:：]/.test(line)) continue
    const value = line.replace(/^策略[:：]\s*/, "").trim()
    return value === "重构" || value === "修补" || value === "无" ? value : undefined
  }
  return undefined
}

// 回归验证报告末行结论: 通过 或 差距 <描述>。取最后一个结论行,取值非法或
// 缺失返回 undefined(处理同 parseStrategy)。
export function parseConclusion(text: string): { type: "pass" } | { type: "gap"; gap: string } | undefined {
  const lines = text.trimEnd().split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim()
    if (!/^结论[:：]/.test(line)) continue
    const value = line.replace(/^结论[:：]\s*/, "").trim()
    if (value === "通过") return { type: "pass" }
    if (value.startsWith("差距")) return { type: "gap", gap: value.replace(/^差距[:：]?\s*/, "").trim() }
    return undefined
  }
  return undefined
}

// 生成会话产出的任务提案(解析自 docs/final/plan-<stage>-r<N>.md)。
export type FinalProposal = { title: string; body: string; verify?: string }

// 提案文件解析: 首行 `# <任务标题>`,自包含正文,可选末行 `verify: <...>`
// (兼容剥离——终审任务强制跳过任务级验收,该行一律被忽略、不写入任务)。
// 缺失、无标题或无正文返回 undefined。
export function parseProposal(text: string): FinalProposal | undefined {
  const lines = text.trim().split("\n")
  const title = /^#\s+(.+)$/.exec(lines[0] ?? "")
  if (!title) return undefined
  const rest = lines.slice(1)
  const verify = /^verify:\s*(.+)$/.exec(rest[rest.length - 1] ?? "")
  const body = (verify ? rest.slice(0, -1) : rest).join("\n").trim()
  if (!body) return undefined
  return { title: title[1]!.trim(), body, verify: verify?.[1]?.trim() }
}

// 终审路由结果:
// - complete: 终审完成(最后的终审任务为 finalize 且已 done;C.5)
// - wait: 存在未完成终审任务,主循环既有机制处理,不生成新任务(C.1)
// - generate: 开生成会话产出提案 docs/final/plan-<stage>-r<N>.md
// - append: 提案已产出未追加,直接解析追加(C.3)
// - block: 熔断(B.5)或报告异常(C.4)/final 字段非法,block 指定终审任务、退出码 2
export type FinalRoute =
  | { type: "complete" }
  | { type: "wait" }
  | { type: "generate"; stage: FinalStage; round: number; prior: string }
  | { type: "append"; stage: FinalStage; round: number; proposal: FinalProposal }
  | { type: "block"; task: string; question: string }

// 终审状态机路由(loop 在 runTask 完成后与 next() 为空时求值): 由(带 final
// 标记的任务及其状态,docs/final/ 产物)推导下一步。limit 为审计轮上限
// (--final-review n,含首轮 audit): validate 差距回退 audit@<r+1> 受其约束,
// 耗尽即熔断。
export async function routeFinal(dir: string, plan: Plan, limit: number): Promise<FinalRoute> {
  const finals = plan.tasks.filter((task) => task.final)
  if (!finals.length) return stageRoute(dir, plan, "audit", 1)
  if (finals.some((task) => task.status !== "done")) return { type: "wait" }
  const last = finals[finals.length - 1]!
  const mark = parseFinalMark(last.final)
  if (!mark) {
    return {
      type: "block",
      task: last.id,
      question: `终审任务 ${last.id} 的 final 字段无效("${last.final}",须为 <stage>@<round> 且 stage ∈ audit|remediate|validate|finalize)。请修正 PLAN.md 后重新运行`,
    }
  }
  switch (mark.stage) {
    case "finalize":
      return { type: "complete" }
    case "audit":
      return afterAudit(dir, plan, mark.round, last)
    case "remediate":
      return afterRemediate(dir, plan, mark.round)
    case "validate":
      return afterValidate(dir, plan, mark.round, last, limit)
  }
}

// audit 任务 done 后的路由: 解析审计报告末行策略——无 → 直达 finalize(跳过
// remediate 与 validate,原任务已有任务级 verify 兜底);重构|修补 → 生成
// remediate@同轮任务(verify 取提案)。
async function afterAudit(dir: string, plan: Plan, round: number, last: Task): Promise<FinalRoute> {
  const report = finalReportFile("audit", round)
  const strategy = parseStrategy(await readReport(dir, report))
  if (!strategy) return brokenReport(last, report)
  if (strategy === "无") {
    const prior = `第 ${round} 轮审计结论为「策略: 无」(报告 ${report}):无补救即无验证对象,直接终审收尾`
    return stageRoute(dir, plan, "finalize", round, prior)
  }
  const prior = `第 ${round} 轮审计报告: ${report},策略: ${strategy};修复后须通过同轮回归验证(${finalReportFile("validate", round)})`
  return stageRoute(dir, plan, "remediate", round, prior)
}

// remediate 任务 done 后的路由: 生成 validate@同轮任务;prior 指向审计与修复
// 报告(修复报告名按同轮审计策略取 refactor|patch)。
async function afterRemediate(dir: string, plan: Plan, round: number): Promise<FinalRoute> {
  const strategy = parseStrategy(await readReport(dir, finalReportFile("audit", round)))
  const prior = `第 ${round} 轮修复已完成(报告 ${finalReportFile("remediate", round, strategy === "修补" ? "patch" : "refactor")}),对修复后的整体做回归验证;审计报告: ${finalReportFile("audit", round)}`
  return stageRoute(dir, plan, "validate", round, prior)
}

// validate 任务 done 后的路由: 通过 → 生成 finalize 任务;差距 → 回退
// audit@<round+1>(聚焦残余差距、不做全量重审),审计轮耗尽则熔断 block 本
// 任务(B.5,question 引用残余差距原文与报告指针)。
async function afterValidate(dir: string, plan: Plan, round: number, last: Task, limit: number): Promise<FinalRoute> {
  const report = finalReportFile("validate", round)
  const conclusion = parseConclusion(await readReport(dir, report))
  if (!conclusion) return brokenReport(last, report)
  if (conclusion.type === "pass") {
    return stageRoute(dir, plan, "finalize", round, `第 ${round} 轮回归验证通过(报告 ${report}),终审收尾`)
  }
  if (round + 1 > limit) {
    return {
      type: "block",
      task: last.id,
      question: `终审闭环连续 ${limit} 轮仍未通过,残余差距见 ${report} 与 ${finalReportFile("audit", round)}:${conclusion.gap}`,
    }
  }
  return stageRoute(dir, plan, "audit", round + 1, `第 ${round} 轮回归验证未通过,残余差距原文:\n${conclusion.gap}\n上游报告: ${report} 与 ${finalReportFile("audit", round)}`)
}

// 生成下一阶段任务的路由,含幂等重建: 阶段任务已存在(追加后中断)→ 不重复
// 生成,主循环直接拾取(C.2);提案已产出未追加 → 直接解析追加(C.3);否则
// 开生成会话。prior 为生成会话的上游产物指针与残余差距原文。
async function stageRoute(dir: string, plan: Plan, stage: FinalStage, round: number, prior = ""): Promise<FinalRoute> {
  if (plan.tasks.some((task) => task.final === `${stage}@${round}`)) return { type: "wait" }
  const proposal = parseProposal(await readReport(dir, finalProposalFile(stage, round)))
  if (proposal) return { type: "append", stage, round, proposal }
  return { type: "generate", stage, round, prior }
}

// 终审任务已 done 但报告缺失或协议行非法(C.4): 终审任务不做任务级验收,
// 报告质量由路由时的本检查兜底——多为会话漏写或报告被人工改动,阻塞提示
// 人工核查(人工修复报告、或删改终审任务后由状态重建重新路由)。
function brokenReport(task: Task, report: string): FinalRoute {
  return {
    type: "block",
    task: task.id,
    question: `终审任务 ${task.id} 已标 done,但报告 ${report} 缺失或协议行无效(可能已被人工改动)。请核查该报告,必要时手工修复或删改相关终审任务后重新运行`,
  }
}

async function readReport(dir: string, file: string): Promise<string> {
  return Bun.file(join(dir, file)).text().catch(() => "")
}

// 解析结果追加终审任务: T-F<k> 按既有终审任务数 +1 编号(追加顺序确定、免
// 碰撞),`final: <stage>@<round>` 字段标记。不写 verify 字段——终审任务强制
// 跳过任务级验收(该阶段本身即检验),提案中的 verify 行仅做兼容剥离、被忽略。
// 标题带阶段前缀(status 可见),正文取自提案。返回新任务 ID。
export async function appendFinalTask(
  path: string,
  plan: Plan,
  stage: FinalStage,
  round: number,
  proposal: FinalProposal,
): Promise<string> {
  const id = `T-F${plan.tasks.filter((task) => task.final).length + 1}`
  await appendTask(path, {
    id,
    title: `${stageText(stage)}${stage === "finalize" ? "" : `(第 ${round} 轮)`}: ${proposal.title}`,
    status: "pending",
    final: `${stage}@${round}`,
    attempts: 0,
    body: proposal.body,
  })
  return id
}

// 终审任务生成会话(设计文档 B.3): 旁路一次性,复用 runner 的 requireArtifact
// 骨架(产物缺失带反馈重试一次,仍失败按隐性阻塞);prior 为上游产物指针与
// 残余差距原文,mode 注入各阶段侧重。产出提案后由调用方经 appendFinalTask
// 追加为真任务。
export async function generateFinalTask(
  client: OpencodeClient,
  plan: Plan,
  stage: FinalStage,
  round: number,
  prior: string,
  opts: Opts,
): Promise<{ type: "ok"; proposal: FinalProposal } | { type: "blocked"; question: string }> {
  const dir = opts.dir ?? dirname(plan.path)
  const file = finalProposalFile(stage, round)
  const collected = await requireArtifact(client, planningTask(stage, round), renderFinalTask(plan, stage, round, prior, opts.mode), opts, {
    kind: "终审任务规划",
    artifact: `有效提案文件 ${file}`,
    detail: "缺失、无标题或无正文",
    requirement: `必须把自包含的任务提案写入 ${file}(首行 \`# <任务标题>\`,正文);即使认为该阶段无事可做,也要写出文件并在正文说明原因。`,
    commit: { stage: "final-plan", subject: `终审任务规划(${stageText(stage)} 第 ${round} 轮)` },
    reset: () => rm(join(dir, file), { force: true }),
    collect: async () => parseProposal(await readReport(dir, file)),
  })
  if ("title" in collected) return { type: "ok", proposal: collected }
  return collected
}

// 生成会话的伪任务(不进任何任务链,session 标题可见阶段与轮次)。
function planningTask(stage: FinalStage, round: number): Task {
  return { id: "PLAN", title: `终审任务规划(${stageText(stage)} 第 ${round} 轮)`, status: "in_progress", attempts: 0, body: "" }
}

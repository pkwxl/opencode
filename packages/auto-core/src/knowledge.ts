import { readdir, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import type { AgentClient } from "./agent/types"
import { priorKnowledgeDoc, roundDirName, tempPriorKnowledgeDoc } from "./docpaths"
import { parsePhaseDir } from "./document/unit"
import { changedFiles, commitPending, commitTree } from "./git"
import { log } from "./log"
import { currentRound, phaseArtifacts, roundKnowledgeDocs, type PhaseUnit } from "./phases"
import { renderKnowledge, renderPriorKnowledge } from "./prompt"
import type { Opts, UnitStop } from "./opts"
import { requireArtifact } from "./artifact"
import { afterSession } from "./unit-commit"

// k(知识提炼)阶段对 --extract-knowledge 设计的整体认领(plans/0002-fixme-knowledge-design.md
// §D + plans/0006-phases-design.md P4): 各阶段完成后,旁路一次性会话把最终验证过的迁移
// 经验蒸馏为结构化知识文档。产出为 knowledge 阶段目录内的类型标准产物
// docs/R-NN/P<nn>-knowledge/kb.md(M3.3, plans/0047 §5),落定不移动。提取失败不污染退出码——会话受阻或
// 两次未产出仅返回 failed,由调用方打 ⚠ 警告后照常推进阶段交接(迁移成功不被文档
// 生成失败反向污染)。

// 输出路径: 该 knowledge 阶段的标准产物(注册表 phaseArtifacts,阶段目录内 kb.md)。
export function knowledgeFile(phase: PhaseUnit): string {
  return phaseArtifacts(phase)[0]!.path
}

// 幂等检查: 该阶段的知识文档非空即已提取。阶段 done 后提取挂点本就不触发
// (routePhase 只路由未完成阶段)。
export async function existingKnowledge(dir: string, phase: PhaseUnit): Promise<string | undefined> {
  const file = knowledgeFile(phase)
  return (await Bun.file(join(dir, file)).text().catch(() => "")).trim() ? file : undefined
}

// 知识提取编排(镜像 final.ts generateFinalTask 的 requireArtifact 骨架,伪任务
// PLAN 不进任务链、不写进度记录): collect 从宽——文件存在且非空即算产出(章节
// 完整性是提示词级要求,过度结构校验会制造无意义重试);产出随会话统一提交
// (stage=knowledge),阶段目录内为永久路径、交接不搬移(R2)。
// 完成判定含提交(plans/0021-commit-boundary-design.md ③④ 推广): ③ 幂等入口发现本轮文档
// 已产出但仍在未提交清单 → 补提交后即完成;④ 文档缺失而工作区脏(上次提取半途
// 而废的现场或人工改动)→ 返回 dirty 交人工处置后重跑——对 k 阶段"提取失败仅
// ⚠ 不污染退出码"的既有语义,dirty 例外(工作区不净会污染后续所有单元的启动
// 基线,必须先停下)。提交失败(requireArtifact 的 blocked)同样按 dirty 口径
// 上抛,由调用方停机。
export async function extractKnowledge(
  client: AgentClient,
  dir: string,
  opts: Opts,
  phase: PhaseUnit,
): Promise<
  { type: "ok"; file: string } | { type: "skipped"; file: string } | { type: "dirty"; files: string[] } | { type: "failed"; question: string }
> {
  const task = { id: "PLAN", title: "migration knowledge distillation (k phase)", status: "in_progress" as const, attempts: 0, body: "" }
  const commit = { stage: "knowledge", subject: "PLAN knowledge migration knowledge distillation" }
  const existing = await existingKnowledge(dir, phase)
  if (existing) {
    // ③ 补提交: 文档已落盘但仍在未提交改动清单中 → 提交后完成。
    const pending = await commitPending(dir, opts, task, commit, [existing])
    if (pending !== "clean") {
      log(pending.ok ? `✓ knowledge document was produced but not committed; committed now: ${existing}` : `⚠ knowledge document make-up commit failed: ${pending.failures.map((f) => `${f.rel}: ${f.error}`).join("; ")}`)
      if (!pending.ok) return { type: "dirty", files: [existing] }
    }
    return { type: "skipped", file: existing }
  }
  // ④ 半途而废现场检测: 产物缺失 + 工作区脏 → 交人工清理,不主动动 git。
  if (opts.commit !== false && !opts.dryrun) {
    const dirty = await changedFiles(dir)
    if (dirty.length) return { type: "dirty", files: dirty }
  }
  const file = knowledgeFile(phase)
  const produced = await requireArtifact(
    client,
    task,
    renderKnowledge({ file, mode: opts.mode }),
    opts,
    {
      kind: "知识提取",
      role: "knowledge",
      // 独立隐藏任务单元: 启动 clean 门禁 + SHA 基线 + 收口校验(plans/0021-commit-boundary-design.md)。
      unitStart: true,
      artifact: `非空知识文档 ${file}`,
      detail: "缺失或为空",
      requirement: `必须把知识文档写入 ${file}(按提示词给出的章节骨架写全;信息稀少也要写出骨架并说明原因)。`,
      commit,
      reset: () => rm(join(dir, file), { force: true }),
      collect: async () => {
        const text = await Bun.file(join(dir, file)).text().catch(() => "")
        return text.trim() ? true : undefined
      },
    },
  )
  if (produced === true) return { type: "ok", file }
  if (produced.type === "dirty") return { type: "dirty", files: produced.files }
  // 会话受阻/未产出后若工作区已脏(典型: 提交失败),同样按 dirty 停机。
  if (opts.commit !== false && !opts.dryrun) {
    const dirty = await changedFiles(dir)
    if (dirty.length) return { type: "dirty", files: dirty }
  }
  return { type: "failed", question: produced.question }
}

// —— 前置知识提取(专用二次迁移工具,docs/specialized-tool-design.md §3)——

// 输出路径: 轮内固定名 docs/R-NN/prior-kb.md——新轮轮目录恒空,前置知识必重新
// 蒸馏;与 k 阶段知识文档分离,各自的幂等检查只认本轮产物。
export function priorKnowledgeFile(round: number): string {
  return priorKnowledgeDoc(round)
}

// 幂等检查: 本轮 prior-kb.md 非空即已提取。
export async function existingPriorKnowledge(dir: string, round: number): Promise<string | undefined> {
  const file = priorKnowledgeDoc(round)
  return (await Bun.file(join(dir, file)).text().catch(() => "")).trim() ? file : undefined
}

// 已有蒸馏产物清单(extractPriorKnowledge 的引用化输入): 此前蒸馏的结论性文档
// ——迁移知识(历轮 knowledge 阶段目录的 kb.md)、阶段交接(历轮各阶段目录的
// handover.md)与历轮前置知识(历轮 docs/R-*/prior-kb.md,本轮的排除)。清单非空时提取会话被要求对已覆盖的
// 知识点只引用不复述(引用目标同场可达: priorKnowledgeDigest 与 prevRoundDigest
// 注入全文)。各目录缺失或仅空文件 → 空数组(模板条件段消失,行为同全量蒸馏)。
export async function existingDistilledDocs(dir: string, round: number): Promise<string[]> {
  const found = new Set<string>()
  // 轮次专用目录: 历轮 docs/R-*/ 的前置知识、各阶段目录的交接与 knowledge 阶段知识文档。
  for (const entry of await readdir(join(dir, "docs"), { withFileTypes: true }).catch(() => [])) {
    const number = /^R-(\d+)$/.exec(entry.name)
    if (!entry.isDirectory() || !number) continue
    const root = join("docs", entry.name)
    const files = await roundKnowledgeDocs(dir, Number(number[1]))
    if (entry.name !== roundDirName(round)) files.push(join(root, "prior-kb.md"))
    for (const phase of await readdir(join(dir, root), { withFileTypes: true }).catch(() => [])) {
      if (phase.isDirectory() && parsePhaseDir(phase.name)) files.push(join(root, phase.name, "handover.md"))
    }
    for (const file of files) {
      if ((await Bun.file(join(dir, file)).text().catch(() => "")).trim()) found.add(file)
    }
  }
  return [...found].sort()
}

// 前置知识提取编排(与 extractKnowledge 同一 requireArtifact 骨架)。
//
// 完成判定(2026-09-13 健壮性改造,specialized-tool-design §3——根因: AI 服务
// 出错时"会话结束 + 文件非空"的旧判据会把半途而废的现场误判为已完成): 阶段完成
// ⟺ 正式知识文档 prior-kb.md 落盘且已提交。协议:
// ① AI 只写中间产物 temp-kb.md(正式产物同目录),全文写完后在末尾独占一行写
//    「完成」收笔;collect 只认带收笔标记的文档,缺一视为未产出(带反馈重试);
// ② 收笔确认后由 driver 改名为正式产物并统一提交——改名与提交都是 driver 动作,
//    AI 自报不作数;
// ③ 重新运行时产物已存在但尚未提交(上次中断在改名后/提交前,或提交失败遗留)→
//    driver 补提交后即完成;
// ④ 产物缺失而工作区有未提交改动 = 上次提取半途而废的现场(或人工改动): driver
//    不主动清理(git 状态的决定权在人工),返回 dirty 由调用方请人工处置后重跑。
// ③④ 以 git 为准,仅在统一提交启用(opts.commit !== false)时生效;提交关闭时
// 维持旧语义(文档存在即完成,脏检查跳过)。
// ⑤依赖的干净基线由外壳在轮次目录初建后统一提交(stage=round-start)提供。
// failed(会话受阻/两次未产出)由调用方转阻塞停机,人工处置后重新运行重启本阶段。
export async function extractPriorKnowledge(
  client: AgentClient,
  dir: string,
  opts: Opts,
  brief?: string,
): Promise<{ type: "ok"; file: string } | { type: "skipped"; file: string } | { type: "dirty"; files: string[] } | { type: "failed"; question: string }> {
  const round = await currentRound(dir)
  const task = { id: "PLAN", title: "prior-knowledge extraction (retrospective of existing migration results)", status: "in_progress" as const, attempts: 0, body: "" }
  const commit = { stage: "prior-knowledge", subject: "PLAN prior-kb prior-knowledge extraction" }
  const existing = await existingPriorKnowledge(dir, round)
  if (existing) {
    // ③ 补提交: 文档已落盘但仍在未提交改动清单中 → 提交后完成(与全部隐藏任务
    // 同协议,helper 见 git.ts commitPending)。
    const pending = await commitPending(dir, opts, task, commit, [existing])
    if (pending !== "clean") {
      if (pending.ok) {
        log(`✓ prior-knowledge document was produced but not committed; committed now: ${existing}`)
      } else {
        log(`⚠ prior-knowledge document make-up commit failed: ${pending.failures.map((f) => `${f.rel}: ${f.error}`).join("; ")}`)
        return { type: "dirty", files: [existing] }
      }
    }
    return { type: "skipped", file: existing }
  }
  const file = priorKnowledgeFile(round)
  const temp = tempPriorKnowledgeDoc(file)
  // ④ 半途而废现场检测: 产物缺失 + 工作区脏 → 交人工清理,不主动动 git。
  if (opts.commit !== false) {
    const dirty = await changedFiles(dir)
    if (dirty.length) return { type: "dirty", files: dirty }
  }
  const distilled = await existingDistilledDocs(dir, round)
  log(`▶ opening prior-knowledge extraction session (writes ${temp}, renamed to ${file} once the closing mark is confirmed${distilled.length ? "; existing distilled artifacts referenced, not restated" : ""})`)
  const produced = await requireArtifact(client, task, renderPriorKnowledge({ file: temp, brief, mode: opts.mode, distilled }), opts, {
    kind: "前置知识提取",
    role: "prior-knowledge",
    // 独立隐藏任务单元(plans/0021-commit-boundary-design.md)。注意统一提交不在此挂接:
    // 收笔确认 → 改名 → 提交须按序进行,会话结束即提交会把未收笔的 temp-kb.md
    // 抢先落账;改名后的提交在下方由 driver 执行。
    unitStart: true,
    artifact: `带收笔标记的知识文档 ${temp}`,
    detail: "缺失、为空或末尾缺少「完成」收笔标记",
    requirement:
      `必须把知识文档写入 ${temp}(按提示词给出的章节骨架写全;已有迁移结果稀少也要写出骨架并说明原因),` +
      `全文写完后在文档末尾独占一行写「完成」作为收笔标记——缺少该标记一律视为未完成。`,
    reset: () => rm(join(dir, temp), { force: true }),
    collect: async () => {
      const text = await Bun.file(join(dir, temp)).text().catch(() => "")
      return priorKnowledgeComplete(text) ? true : undefined
    },
  })
  if (produced !== true) {
    if (produced.type === "dirty") return { type: "dirty", files: produced.files }
    return { type: "failed", question: produced.question }
  }
  // ② 收笔确认 → 改名转正并统一提交(commit 关闭时改名照做、提交跳过);提交
  // 失败 → dirty 交人工(完成判定 = 产物落盘且已提交,plans/0021-commit-boundary-design.md)。
  await rename(join(dir, temp), join(dir, file))
  const committed = await afterSession(dir, opts, task, commit)
  if (committed.type === "failed") {
    log(`⚠ prior-knowledge document was promoted but the commit failed: ${committed.question}`)
    return { type: "dirty", files: [file] }
  }
  return { type: "ok", file }
}

// 收笔标记判定(纯函数,导出供单测): 文档非空且最后一个非空行恰为「完成」。
// AI 明确声明工作完成的协议标记;章节未写全前 AI 被要求绝不写该行。
export function priorKnowledgeComplete(text: string): boolean {
  const trimmed = text.trimEnd()
  if (!trimmed) return false
  return trimmed.split("\n").pop()!.trim() === "完成"
}

// 前置知识摘要(注入本轮首个阶段规划会话与参数推断会话): 历轮前置知识按路径排序
// 拼接全文——历轮 docs/R-*/prior-kb.md 的非空文档(跨轮累积注入)。无产物 → undefined。
export async function priorKnowledgeDigest(dir: string): Promise<string | undefined> {
  const files: string[] = []
  for (const entry of await readdir(join(dir, "docs"), { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && /^R-\d+$/.test(entry.name)) files.push(join("docs", entry.name, "prior-kb.md"))
  }
  const parts: string[] = []
  for (const file of files.sort()) {
    const text = (await Bun.file(join(dir, file)).text().catch(() => "")).trim()
    if (text) parts.push(`### ${file}\n\n${text}`)
  }
  return parts.length ? parts.join("\n\n") : undefined
}

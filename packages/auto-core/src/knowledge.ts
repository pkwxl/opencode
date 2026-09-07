import { readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { knowledgeDoc, priorKnowledgeDoc } from "./docpaths"
import { log } from "./log"
import { currentRound } from "./phases"
import { renderKnowledge, renderPriorKnowledge } from "./prompt"
import { requireArtifact, type Opts } from "./runner"

// k(知识提炼)阶段对 --extract-knowledge 设计的整体认领(docs/fixme-knowledge-design.md
// §D + docs/phases-design.md P4): 各阶段完成后,旁路一次性会话把最终验证过的迁移
// 经验蒸馏为结构化知识文档。产出为永久路径 docs/migration-kb/R<N>-migration-<时间
// 戳>.md(stable-refs R2/R7: 不随交接/轮次归档移动,轮次经 R<N>- 前缀表达)。提取
// 失败不污染退出码——会话受阻或两次未产出仅返回 failed,由调用方打 ⚠ 警告后照常
// 推进阶段交接(迁移成功不被文档生成失败反向污染)。

// 知识文档目录(相对目标目录,永久)。
const KB_DIR = join("docs", "migration-kb")

// 输出路径 docs/migration-kb/R<N>-migration-<时间戳>.md: 时间戳与 .auto/logs/run-<时间
// 戳>.log 同款(log.ts setLogFile 格式);round 由 extractKnowledge 经 currentRound
// 推导后传入,每次提取固定一个路径,requireArtifact 的重试/reset 围绕同一路径进行。
export function knowledgeFile(round: number): string {
  const stamp = new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")
  return knowledgeDoc(round, stamp)
}

// 本轮幂等检查(轮次推导守卫,取代旧"目录空否"判据): docs/migration-kb/ 内存在
// 本轮 R<round>- 前缀的非空 .md(提取已产出、交接前中断)→ 返回其路径跳过重提取;
// 前几轮的 R<M>- 文档不算本轮已提取;第 1 轮时无 R 前缀的存量(P2 前布局)按读回落
// 视为本轮产物,避免中轮升级触发重复提取。台账 k 行 done 后提取挂点本就不触发
// (routePhase 只在 k 未 done 时进入提取),无需读台账。
export async function existingKnowledge(dir: string, round: number): Promise<string | undefined> {
  return existingRoundDoc(dir, KB_DIR, round)
}

// 知识提取编排(镜像 final.ts generateFinalTask 的 requireArtifact 骨架,伪任务
// PLAN 不进任务链、不写进度记录): collect 从宽——文件存在且非空即算产出(章节
// 完整性是提示词级要求,过度结构校验会制造无意义重试);产出随会话统一提交
// (stage=knowledge),docs/migration-kb/ 为永久路径、交接不搬移(R2)。
export async function extractKnowledge(
  client: OpencodeClient,
  dir: string,
  opts: Opts,
): Promise<{ type: "ok"; file: string } | { type: "skipped"; file: string } | { type: "failed"; question: string }> {
  const round = await currentRound(dir)
  const existing = await existingKnowledge(dir, round)
  if (existing) return { type: "skipped", file: existing }
  const file = knowledgeFile(round)
  const produced = await requireArtifact(
    client,
    { id: "PLAN", title: "迁移知识提炼(k 知识提炼)", status: "in_progress", attempts: 0, body: "" },
    renderKnowledge({ file, mode: opts.mode }),
    opts,
    {
      kind: "知识提取",
      artifact: `非空知识文档 ${file}`,
      detail: "缺失或为空",
      requirement: `必须把知识文档写入 ${file}(按提示词给出的章节骨架写全;信息稀少也要写出骨架并说明原因)。`,
      commit: { stage: "knowledge", subject: "PLAN knowledge 迁移知识沉淀" },
      reset: () => rm(join(dir, file), { force: true }),
      collect: async () => {
        const text = await Bun.file(join(dir, file)).text().catch(() => "")
        return text.trim() ? true : undefined
      },
    },
  )
  if (produced === true) return { type: "ok", file }
  return { type: "failed", question: produced.question }
}

// —— 前置知识提取(专用二次迁移工具,docs/specialized-tool-design.md §3)——

// 前置知识文档目录(相对目标目录,永久): 已有迁移结果(不限于本工具此前的轮次)
// 的蒸馏产物。与 k 阶段的 docs/migration-kb/ 分离——各自的幂等检查只读本轮前缀,
// 前几轮产物不会被误认为本轮知识;新一轮(R<N>+1- 前缀无文件)自然重新蒸馏,
// 取代旧的轮间搬移归档(P2 前 archivePriorKnowledge 曾把 prior-kb/ 整体移入轮归档)。
const PRIOR_KB_DIR = join("docs", "prior-kb")

// 输出路径 docs/prior-kb/R<N>-prior-<时间戳>.md(时间戳与 knowledgeFile 同款)。
export function priorKnowledgeFile(round: number): string {
  const stamp = new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")
  return priorKnowledgeDoc(round, stamp)
}

// 幂等检查(与 existingKnowledge 同一"本轮前缀"守卫)。
export async function existingPriorKnowledge(dir: string, round: number): Promise<string | undefined> {
  return existingRoundDoc(dir, PRIOR_KB_DIR, round)
}

// 已有蒸馏产物清单(extractPriorKnowledge 的引用化输入): 此前蒸馏的结论性文档
// ——迁移知识(KB_DIR)、阶段交接(docs/handovers/)与历轮前置知识(PRIOR_KB_DIR
// 内非本轮 R<round>- 前缀者)。清单非空时提取会话被要求对已覆盖的知识点只引用
// 不复述(引用目标同场可达: priorKnowledgeDigest 与 prevRoundDigest 注入全文)。
// 各目录缺失或仅空文件 → 空数组(模板条件段消失,行为同全量蒸馏)。
export async function existingDistilledDocs(dir: string, round: number): Promise<string[]> {
  const found = new Set<string>()
  for (const root of [KB_DIR, join("docs", "handovers"), PRIOR_KB_DIR]) {
    for (const name of await readdir(join(dir, root)).catch(() => [] as string[])) {
      if (!name.endsWith(".md")) continue
      if (root === PRIOR_KB_DIR && name.startsWith(`R${round}-`)) continue
      if (!(await Bun.file(join(dir, root, name)).text().catch(() => "")).trim()) continue
      found.add(join(root, name))
    }
  }
  return [...found].sort()
}

// 复杂度评估判读(prior-knowledge 模板「复杂度评估」节的首行协议): 首个匹配
// `流程建议: simple|full` 的行(半角/全角冒号;行内与行尾不留其他文字)。缺节、
// 占位未填或值非法 → undefined——调用方一律按完整流程处理(保守缺省)。
export function parsePriorVerdict(text: string): "simple" | "full" | undefined {
  return /^流程建议[:：][ \t]*(simple|full)[ \t]*$/m.exec(text)?.[1] as "simple" | "full" | undefined
}

// 目录内本轮 R<round>- 前缀的非空 .md → 首个(字典序);第 1 轮回落无 R 前缀的
// 非空 .md(P2 前存量读回落);空文件与非 .md 不算。
async function existingRoundDoc(dir: string, root: string, round: number): Promise<string | undefined> {
  const names = await readdir(join(dir, root)).catch(() => [] as string[])
  const prefix = `R${round}-`
  const modern = names.filter((name) => name.startsWith(prefix)).sort()
  const legacy = (round === 1 ? names.filter((name) => !/^R\d+-/.test(name)) : []).sort()
  for (const name of [...modern, ...legacy]) {
    if (!name.endsWith(".md")) continue
    if ((await Bun.file(join(dir, root, name)).text()).trim()) return join(root, name)
  }
  return undefined
}

// 前置知识提取编排(与 extractKnowledge 同一 requireArtifact 骨架): 失败返回
// failed 由调用方打 ⚠ 警告后继续(决策: 二次迁移不被文档生成失败污染——参数
// 推断会话可自行直读原始 docs/)。
export async function extractPriorKnowledge(
  client: OpencodeClient,
  dir: string,
  opts: Opts,
  brief?: string,
): Promise<{ type: "ok"; file: string } | { type: "skipped"; file: string } | { type: "failed"; question: string }> {
  const round = await currentRound(dir)
  const existing = await existingPriorKnowledge(dir, round)
  if (existing) return { type: "skipped", file: existing }
  const file = priorKnowledgeFile(round)
  const distilled = await existingDistilledDocs(dir, round)
  log(`▶ 开前置知识提取会话(产出 ${file}${distilled.length ? ";已有蒸馏产物引用化" : ""})`)
  const produced = await requireArtifact(
    client,
    { id: "PLAN", title: "前置知识提取(已有迁移结果复盘)", status: "in_progress", attempts: 0, body: "" },
    renderPriorKnowledge({ file, brief, mode: opts.mode, distilled }),
    opts,
    {
      kind: "前置知识提取",
      artifact: `非空知识文档 ${file}`,
      detail: "缺失或为空",
      requirement: `必须把知识文档写入 ${file}(按提示词给出的章节骨架写全;已有迁移结果稀少也要写出骨架并说明原因)。`,
      commit: { stage: "prior-knowledge", subject: "PLAN prior-kb 前置知识提取" },
      reset: () => rm(join(dir, file), { force: true }),
      collect: async () => {
        const text = await Bun.file(join(dir, file)).text().catch(() => "")
        return text.trim() ? true : undefined
      },
    },
  )
  if (produced === true) return { type: "ok", file }
  return { type: "failed", question: produced.question }
}

// 前置知识摘要(注入本轮首个阶段规划会话与参数推断会话): docs/prior-kb/ 下全部
// 非空文档按文件名排序拼接全文(目录永久化后含历轮前缀文档,跨轮累积注入)。
// 无产物 → undefined。
export async function priorKnowledgeDigest(dir: string): Promise<string | undefined> {
  const names = await readdir(join(dir, PRIOR_KB_DIR)).catch(() => [] as string[])
  const parts: string[] = []
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue
    const text = (await Bun.file(join(dir, PRIOR_KB_DIR, name)).text()).trim()
    if (text) parts.push(`### ${join(PRIOR_KB_DIR, name)}\n\n${text}`)
  }
  return parts.length ? parts.join("\n\n") : undefined
}

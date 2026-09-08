import { readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { knowledgeDoc, legacyKnowledgeDoc, legacyPriorKnowledgeDoc, priorKnowledgeDoc, roundDirName } from "./docpaths"
import { log } from "./log"
import { currentRound, readLedger, roundRoot } from "./phases"
import { renderKnowledge, renderPriorKnowledge } from "./prompt"
import { requireArtifact, type Opts } from "./runner"

// k(知识提炼)阶段对 --extract-knowledge 设计的整体认领(docs/fixme-knowledge-design.md
// §D + docs/phases-design.md P4): 各阶段完成后,旁路一次性会话把最终验证过的迁移
// 经验蒸馏为结构化知识文档。产出为永久路径(新布局 = 轮内固定名
// docs/R-NN/migration-kb.md;旧布局存量项目 = docs/migration-kb/R<N>-migration-
// <时间戳>.md),落定不移动。提取失败不污染退出码——会话受阻或两次未产出仅返回
// failed,由调用方打 ⚠ 警告后照常推进阶段交接(迁移成功不被文档生成失败反向污染)。

// 旧布局知识文档目录(相对目标目录,永久;存量读回落)。
const KB_DIR = join("docs", "migration-kb")

// 时间戳(旧布局输出路径用;与 .auto/logs/run-<时间戳>.log 同款,log.ts
// setLogFile 格式)。
function timestamp(): string {
  return new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")
}

// 输出路径(布局感知): 新布局 = 轮内固定名 docs/R-NN/migration-kb.md(轮目录恒在
// 轮首建立,无需时间戳区分);旧布局(存量项目本轮无轮目录)=
// docs/migration-kb/R<N>-migration-<时间戳>.md。round 由 extractKnowledge 经
// currentRound 推导后传入,每次提取固定一个路径,requireArtifact 的重试/reset 围绕
// 同一路径进行。
export async function knowledgeFile(dir: string, round: number): Promise<string> {
  return (await roundRoot(dir, round)) ? knowledgeDoc(round) : legacyKnowledgeDoc(round, timestamp())
}

// 本轮幂等检查: 新布局查轮内 docs/R-NN/migration-kb.md(非空即已提取);旧平铺
// 回落 docs/migration-kb/ 内本轮 R<round>- 前缀的非空 .md(前几轮的 R<M>- 文档不
// 算本轮已提取;第 1 轮时无 R 前缀的存量按读回落视为本轮产物,避免中轮升级触发
// 重复提取)。台账 k 行 done 后提取挂点本就不触发(routePhase 只在 k 未 done 时
// 进入提取),无需读台账。
export async function existingKnowledge(dir: string, round: number): Promise<string | undefined> {
  if (await roundRoot(dir, round)) {
    const modern = knowledgeDoc(round)
    if ((await Bun.file(join(dir, modern)).text().catch(() => "")).trim()) return modern
  }
  return existingRoundDoc(dir, KB_DIR, round, round === 1)
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
  const file = await knowledgeFile(dir, round)
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

// 旧布局前置知识文档目录(相对目标目录,永久;存量读回落): 已有迁移结果(不限于
// 本工具此前的轮次)的蒸馏产物。新布局 = 轮内固定名 docs/R-NN/prior-kb.md——新轮
// 轮目录恒空,前置知识必重新蒸馏(原"旧轮文档误判本轮已提取"缺陷结构性消除);
// 与 k 阶段知识文档分离——各自的幂等检查只认本轮产物,前几轮产物不会被误认为
// 本轮知识。
const PRIOR_KB_DIR = join("docs", "prior-kb")

// 输出路径(布局感知,与 knowledgeFile 同款): 新布局 = 轮内 docs/R-NN/prior-kb.md;
// 旧布局 = docs/prior-kb/R<N>-prior-<时间戳>.md。
export async function priorKnowledgeFile(dir: string, round: number): Promise<string> {
  return (await roundRoot(dir, round)) ? priorKnowledgeDoc(round) : legacyPriorKnowledgeDoc(round, timestamp())
}

// 幂等检查(新布局轮内固定名 + 旧平铺"本轮前缀"守卫;另含新旧机制过渡回落):
// 本轮阶段已推进(台账已有完成阶段)而无本轮文档,说明本轮开工于前缀守卫引入
// 之前——旧判据"目录非空即跳过"使旧机制轮次一直以无前缀存量续命、从未产出
// 本轮 R 文档,严格按前缀判定会把每次中断重跑都拖回轮首重开提取会话,无法直接
// 恢复断点。故台账已推进时回落接受无前缀非空文档(与第 1 轮读回落同款)。
// 新一轮开工时轮目录/台账恒为空,不受回落影响,自然重新蒸馏。台账非法按未推进
// 处理(严格失败属 readLedger 调用方职责)。
export async function existingPriorKnowledge(dir: string, round: number): Promise<string | undefined> {
  if (await roundRoot(dir, round)) {
    const modern = priorKnowledgeDoc(round)
    if ((await Bun.file(join(dir, modern)).text().catch(() => "")).trim()) return modern
  }
  const advanced =
    round === 1 || (await readLedger(dir).then((ledger) => ledger.done.length > 0, () => false))
  return existingRoundDoc(dir, PRIOR_KB_DIR, round, advanced)
}

// 已有蒸馏产物清单(extractPriorKnowledge 的引用化输入): 此前蒸馏的结论性文档
// ——迁移知识(旧平铺 KB_DIR + 历轮 docs/R-*/migration-kb.md)、阶段交接(旧平铺
// docs/handovers/ + 历轮 docs/R-*/handovers/)与历轮前置知识(旧平铺 PRIOR_KB_DIR
// + 历轮 docs/R-*/prior-kb.md,本轮的排除)。清单非空时提取会话被要求对已覆盖的
// 知识点只引用不复述(引用目标同场可达: priorKnowledgeDigest 与 prevRoundDigest
// 注入全文)。各目录缺失或仅空文件 → 空数组(模板条件段消失,行为同全量蒸馏)。
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
  // 轮次专用目录(新布局): 历轮 docs/R-*/ 内的固定名知识文档与交接。
  for (const entry of await readdir(join(dir, "docs"), { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !/^R-\d+$/.test(entry.name)) continue
    const root = join("docs", entry.name)
    const current = entry.name === roundDirName(round)
    for (const name of ["migration-kb.md", "prior-kb.md"]) {
      if (current && name === "prior-kb.md") continue
      const file = join(root, name)
      if ((await Bun.file(join(dir, file)).text().catch(() => "")).trim()) found.add(file)
    }
    for (const name of await readdir(join(dir, root, "handovers")).catch(() => [] as string[])) {
      if (!name.endsWith(".md")) continue
      const file = join(root, "handovers", name)
      if ((await Bun.file(join(dir, file)).text().catch(() => "")).trim()) found.add(file)
    }
  }
  return [...found].sort()
}

// 目录内本轮 R<round>- 前缀的非空 .md → 首个(字典序);allowLegacy 时再回落无
// R 前缀的非空 .md(第 1 轮的 P2 前存量读回落,及 prior-kb 的旧机制轮次续跑,
// 见 existingPriorKnowledge);空文件与非 .md 不算。
async function existingRoundDoc(dir: string, root: string, round: number, allowLegacy: boolean): Promise<string | undefined> {
  const names = await readdir(join(dir, root)).catch(() => [] as string[])
  const prefix = `R${round}-`
  const modern = names.filter((name) => name.startsWith(prefix)).sort()
  const legacy = (allowLegacy ? names.filter((name) => !/^R\d+-/.test(name)) : []).sort()
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
  const file = await priorKnowledgeFile(dir, round)
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

// 前置知识摘要(注入本轮首个阶段规划会话与参数推断会话): 历轮前置知识按路径排序
// 拼接全文——新布局历轮 docs/R-*/prior-kb.md + 旧平铺 docs/prior-kb/ 全部非空
// 文档(双布局跨轮累积注入)。无产物 → undefined。
export async function priorKnowledgeDigest(dir: string): Promise<string | undefined> {
  const files: string[] = []
  for (const entry of await readdir(join(dir, "docs"), { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && /^R-\d+$/.test(entry.name)) files.push(join("docs", entry.name, "prior-kb.md"))
  }
  for (const name of await readdir(join(dir, PRIOR_KB_DIR)).catch(() => [] as string[])) {
    if (name.endsWith(".md")) files.push(join(PRIOR_KB_DIR, name))
  }
  const parts: string[] = []
  for (const file of files.sort()) {
    const text = (await Bun.file(join(dir, file)).text().catch(() => "")).trim()
    if (text) parts.push(`### ${file}\n\n${text}`)
  }
  return parts.length ? parts.join("\n\n") : undefined
}

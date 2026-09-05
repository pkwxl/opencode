import { mkdir, readdir, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { log } from "./log"
import { renderKnowledge, renderPriorKnowledge } from "./prompt"
import { requireArtifact, type Opts } from "./runner"

// k(知识提炼)阶段对 --extract-knowledge 设计的整体认领(docs/fixme-knowledge-design.md
// §D + docs/phases-design.md P4): 各阶段完成后,旁路一次性会话把最终验证过的迁移
// 经验蒸馏为结构化知识文档(docs/migration-kb/)。提取失败不污染退出码——会话受阻
// 或两次未产出仅返回 failed,由调用方打 ⚠ 警告后照常推进阶段交接(迁移成功不被
// 文档生成失败反向污染)。

// 知识文档目录(相对目标目录);k 阶段产物约定的根(phases-design.md A.1 表)。
const KB_DIR = join("docs", "migration-kb")

// 默认输出路径 docs/migration-kb/migration-<时间戳>.md: 时间戳与 .auto/logs/run-<时间戳>.log
// 同款(log.ts setLogFile 格式);每次提取固定一个路径,requireArtifact 的重试/reset
// 围绕同一路径进行。
export function knowledgeFile(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")
  return join(KB_DIR, `migration-${stamp}.md`)
}

// 幂等检查: 目录内已存在非空 .md(上次提取已产出、交接前中断)→ 返回其路径,
// 跳过重提取(与 routeFinal"提案已产出直接解析追加"同一恢复范式)。
export async function existingKnowledge(dir: string): Promise<string | undefined> {
  const names = await readdir(join(dir, KB_DIR)).catch(() => [] as string[])
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue
    if ((await Bun.file(join(dir, KB_DIR, name)).text()).trim()) return join(KB_DIR, name)
  }
  return undefined
}

// 知识提取编排(镜像 final.ts generateFinalTask 的 requireArtifact 骨架,伪任务
// PLAN 不进任务链、不写进度记录): collect 从宽——文件存在且非空即算产出(章节
// 完整性是提示词级要求,过度结构校验会制造无意义重试);产出随会话统一提交
// (stage=knowledge),交接时按阶段产物归档进 docs/phases/k-knowledge/。
export async function extractKnowledge(
  client: OpencodeClient,
  dir: string,
  opts: Opts,
): Promise<{ type: "ok"; file: string } | { type: "skipped"; file: string } | { type: "failed"; question: string }> {
  const existing = await existingKnowledge(dir)
  if (existing) return { type: "skipped", file: existing }
  const file = knowledgeFile()
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

// 前置知识文档目录(相对目标目录): 已有迁移结果(不限于本工具此前的轮次)的蒸馏
// 产物。与 k 阶段的 docs/migration-kb/ 分离——existingKnowledge 只读各自目录顶层,
// 前置产物不会被 k 阶段的幂等检查误认为本轮知识,archiveRound 也不移动它(它是
// 新一轮迁移的输入,不是任何一轮的产物)。
const PRIOR_KB_DIR = join("docs", "prior-kb")

// 默认输出路径 docs/prior-kb/prior-<时间戳>.md(时间戳与 knowledgeFile 同款)。
export function priorKnowledgeFile(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")
  return join(PRIOR_KB_DIR, `prior-${stamp}.md`)
}

// 幂等检查(与 existingKnowledge 同范式): 目录内已存在非空 .md → 跳过重提取。
export async function existingPriorKnowledge(dir: string): Promise<string | undefined> {
  const names = await readdir(join(dir, PRIOR_KB_DIR)).catch(() => [] as string[])
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue
    if ((await Bun.file(join(dir, PRIOR_KB_DIR, name)).text()).trim()) return join(PRIOR_KB_DIR, name)
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
  const existing = await existingPriorKnowledge(dir)
  if (existing) return { type: "skipped", file: existing }
  const file = priorKnowledgeFile()
  log(`▶ 开前置知识提取会话(产出 ${file})`)
  const produced = await requireArtifact(
    client,
    { id: "PLAN", title: "前置知识提取(已有迁移结果复盘)", status: "in_progress", attempts: 0, body: "" },
    renderPriorKnowledge({ file, brief, mode: opts.mode }),
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
// 非空文档按文件名排序拼接全文。无产物 → undefined。
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

// 轮间归档原语(壳层轮间过渡调用,round 由调用方显式传入——内部推导 currentRound
// 会让过渡中断重跑把半途文件劈进两个轮次目录): docs/prior-kb/ 下全部直接条目
// (非空与否都移)rename 进 docs/phases/round-<round>/prior-kb/,保证源目录清空、
// existingPriorKnowledge 的跳过检查必然放行新一轮重新蒸馏;归档后的旧 prior 文档
// 仍是提取会话的输入(docs/ 全树细读对象)。镜像 archiveRound 风格: mkdir
// recursive + 逐条 rename 幂等;源目录缺失/为空 → 空数组 no-op、不创建目标目录;
// 返回移动条目的相对路径清单(相对目标目录,与 existingPriorKnowledge 返回同款)。
export async function archivePriorKnowledge(dir: string, round: number): Promise<string[]> {
  const root = join(dir, PRIOR_KB_DIR)
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  if (!entries.length) return []
  const archive = join("docs", "phases", `round-${round}`, "prior-kb")
  await mkdir(join(dir, archive), { recursive: true })
  const moved: string[] = []
  for (const entry of entries) {
    await rename(join(root, entry.name), join(dir, archive, entry.name))
    moved.push(join(archive, entry.name))
  }
  return moved
}

import { readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { renderKnowledge } from "./prompt"
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
      commit: { stage: "knowledge", subject: "k 知识提炼: 迁移知识沉淀" },
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

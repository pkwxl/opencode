// 任务文档路径的唯一构造点(stable-refs 设计 §4.1,docs/stable-refs-design.md):
// 任务文档(七角色文件 + 子任务产物)只存在于 docs/T-NNN/ 内(R3 目录化),角色
// 文件名固定(R4),路径一经创建即为永久路径(R2)——driver/提示词模板/读回落
// 三方认知经本模块统一,调用方不得自行拼串。旧平铺布局(docs/<id>.<role>.md 等)
// 原地保留、仅供读回落(D4: 新路径缺失回落旧路径,镜像 config.ts 的
// legacyModeFallback 先例)——refcheck-scope-design D2 摒弃移动适配:不再以搬移
// 文件适配新布局(原 migrateLegacyDocs 存量迁移已退役),遗留引用失效走
// refcheck-scope §4 的 git 历史恢复机制。轮次专用目录(roundDir/roundDirName,
// docs/R-NN)与轮内永久知识文档路径(knowledgeDoc/priorKnowledgeDoc,轮内固定名;
// 旧平铺形态 legacyKnowledgeDoc/legacyPriorKnowledgeDoc 常量化保留为读回落)亦在
// 此构造;handoverDoc 依赖阶段 slug 表,落在 src/phases.ts
// (偏差注记见设计文档 §4.1);上游条款: R1 编号唯一、R2 永久性、R3 目录化、
// R4 角色文件名、R5 归档语义、R6 临时文件、R7 阶段差异表达。
import { readdir } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

// 任务文档角色(R4: 角色文件名固定);index(子任务产物)只经 subtaskDoc 构造。
export type TaskRole = "context" | "subtasks" | "report" | "audit" | "fix" | "handoff" | "testhandoff"

// 子任务序号两位零填充(S2 → S02),三位自然进位(与既有 padStart(2,"0") 口径一致)。
const pad2 = (k: number) => String(k).padStart(2, "0")

// —— 新布局构造器(返回相对目标目录路径)——

// docs/T-003
export function taskDir(id: string): string {
  return join("docs", id)
}

// docs/T-003/context.md
export function taskDoc(id: string, role: TaskRole): string {
  return join(taskDir(id), `${role}.md`)
}

// docs/T-003/S04
export function subtaskDir(id: string, k: number): string {
  return join(taskDir(id), `S${pad2(k)}`)
}

// docs/T-003/S04/index.md(子任务产物)与 docs/T-003/S02/testhandoff.md(子任务级测试交接)
export function subtaskDoc(id: string, k: number, role: "index" | "testhandoff"): string {
  return join(subtaskDir(id, k), `${role}.md`)
}

// docs/T-F1(终审产物按产出任务锚定,各终审任务锚定自己的 docs/T-F<k>/,P1-D1)
export function finalDir(index: number): string {
  return join("docs", `T-F${index}`)
}

// docs/T-F1/audit-r1.md
export function finalDoc(index: number, name: string): string {
  return join(finalDir(index), name)
}

// —— 永久知识文档路径(轮次专用目录 docs/R-NN,轮首即建、落盘即永久)——

// 轮次目录名: R-NN(R 后两位零填充,如 R-01,自然进位 R-99 → R-100);与
// docs/T-NNN 并列构成 docs/ 下两类顶级命名空间(T = 跨轮永久编号的任务文档,
// R = 自包含轮次容器)。
export function roundDirName(round: number): string {
  return `R-${pad2(round)}`
}

// docs/R-01(轮次专用目录)
export function roundDir(round: number): string {
  return join("docs", roundDirName(round))
}

// docs/R-NN/migration-kb.md(k 阶段知识文档;轮内固定名,原时间戳名取消;
// R2 永久路径,轮次经 R-NN 目录表达)。
export function knowledgeDoc(round: number): string {
  return join(roundDir(round), "migration-kb.md")
}

// docs/R-NN/prior-kb.md(前置知识文档;轮内固定名——新一轮轮目录恒空,前置
// 知识必重新蒸馏,取代旧的轮次前缀守卫)。
export function priorKnowledgeDoc(round: number): string {
  return join(roundDir(round), "prior-kb.md")
}

// 前置知识提取的中间产物(未收笔态;健壮性协议,见 specialized-tool-design §3):
// AI 只写本文件,driver 确认末尾「完成」收笔标记后才改名为正式知识文档(完成
// 判定 = 改名落盘 + 提交)。固定名,各存量扫描(existingRoundDoc/
// existingDistilledDocs/priorKnowledgeDigest)一律跳过,永不被当作既有知识。
export const TEMP_KB_NAME = "temp-kb.md"

// 中间产物与正式产物同目录: 新布局 docs/R-NN/temp-kb.md,旧布局
// docs/prior-kb/temp-kb.md。final 为正式产物的相对路径(priorKnowledgeFile)。
export function tempPriorKnowledgeDoc(final: string): string {
  return join(dirname(final), TEMP_KB_NAME)
}

// 旧平铺形态(读回落常量化,存量项目原地保留、绝不搬移):
// docs/migration-kb/R2-migration-2026-09-07_01-02-03.md
export function legacyKnowledgeDoc(round: number, stamp: string): string {
  return join("docs", "migration-kb", `R${round}-migration-${stamp}.md`)
}

// docs/prior-kb/R1-prior-2026-09-07_01-02-03.md
export function legacyPriorKnowledgeDoc(round: number, stamp: string): string {
  return join("docs", "prior-kb", `R${round}-prior-${stamp}.md`)
}

// —— 旧平铺布局(读回落永久保留,兼容存量平铺项目;refcheck-scope-design D2
// 摒弃移动适配,不再搬移旧文件)——

// docs/T-003.context.md
export function legacyTaskDoc(id: string, role: TaskRole): string {
  return join("docs", `${id}.${role}.md`)
}

// docs/T-003-S2.testhandoff.md(子任务级测试交接的旧平铺名,子任务序号不补零)
export function legacySubtaskTestHandoff(id: string, k: number): string {
  return join("docs", `${id}-S${k}.testhandoff.md`)
}

// docs/T-003/S04.md(任务目录内的旧子任务产物名)
export function legacySubtaskArtifact(id: string, k: number): string {
  return join(taskDir(id), `S${pad2(k)}.md`)
}

// —— 读回落(D4): 新路径存在→新;否则旧存在→旧;否则新(读空,与直读不存在
// 文件的行为一致)——写目标恒为新路径,读点经 resolve 选址 ——

export async function resolveTaskDoc(dir: string, id: string, role: TaskRole): Promise<string> {
  const modern = taskDoc(id, role)
  if (await Bun.file(join(dir, modern)).exists()) return modern
  const legacy = legacyTaskDoc(id, role)
  if (await Bun.file(join(dir, legacy)).exists()) return legacy
  return modern
}

export async function resolveSubtaskDoc(dir: string, id: string, k: number, role: "index" | "testhandoff"): Promise<string> {
  const modern = subtaskDoc(id, k, role)
  if (await Bun.file(join(dir, modern)).exists()) return modern
  const legacy = role === "testhandoff" ? legacySubtaskTestHandoff(id, k) : legacySubtaskArtifact(id, k)
  if (await Bun.file(join(dir, legacy)).exists()) return legacy
  return modern
}

// —— 测试交接文档的归档份(测试交接前置化设计 D4)——
//
// 当前份恒为 testhandoff.md(会话的写目标),driver 在交接收口时把它重命名为
// testhandoff-<n>.md 归档,新会话读最新一份、早期各份留作可回溯链。构造规则
// 是"去掉 .md 后缀、缀 -<n>.md",对目录化新布局与旧平铺名同样成立
// (docs/T-003/S02/testhandoff-1.md 与 docs/T-003-S2.testhandoff-1.md)。
export function archivedTestHandoff(handoff: string, n: number): string {
  return `${handoff.replace(/\.md$/, "")}-${n}.md`
}

// 同目录既有归档份的最大编号(镜像 runner.ts 的 latestTestSeq: 扫目录取最大,
// 跨会话/跨运行接续编号,中断恢复不从 1 重来);目录缺失或无归档份返回 0。
export async function latestHandoffSeq(dir: string, handoff: string): Promise<number> {
  const stem = basename(handoff).replace(/\.md$/, "")
  const re = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)\\.md$`)
  let max = 0
  for (const name of await readdir(join(dir, dirname(handoff))).catch(() => [] as string[])) {
    max = Math.max(max, Number(re.exec(name)?.[1] ?? 0))
  }
  return max
}

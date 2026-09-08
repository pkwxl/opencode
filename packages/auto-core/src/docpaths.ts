// 任务文档路径的唯一构造点(stable-refs 设计 §4.1,docs/stable-refs-design.md):
// 任务文档(七角色文件 + 子任务产物)只存在于 docs/T-NNN/ 内(R3 目录化),角色
// 文件名固定(R4),路径一经创建即为永久路径(R2)——driver/提示词模板/读回落
// 三方认知经本模块统一,调用方不得自行拼串。旧平铺布局(docs/<id>.<role>.md 等)
// 原地保留、仅供读回落(D4: 新路径缺失回落旧路径,镜像 config.ts 的
// legacyModeFallback 先例)——refcheck-scope-design D2 摒弃移动适配:不再以搬移
// 文件适配新布局(原 migrateLegacyDocs 存量迁移已退役),遗留引用失效走
// refcheck-scope §4 的 git 历史恢复机制。永久知识文档路径(knowledgeDoc/
// priorKnowledgeDoc)亦在此构造;handoverDoc 依赖阶段 slug 表,落在 src/phases.ts
// (偏差注记见设计文档 §4.1);上游条款: R1 编号唯一、R2 永久性、R3 目录化、
// R4 角色文件名、R5 归档语义、R6 临时文件、R7 阶段差异表达。
import { join } from "node:path"

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

// —— 永久知识文档路径(P2)——

// docs/migration-kb/R2-migration-2026-09-07_01-02-03.md(k 阶段知识文档;R2 永久
// 路径 + R7 轮次前缀,不随交接/轮次归档移动;stamp 与 run 日志同款格式)。
export function knowledgeDoc(round: number, stamp: string): string {
  return join("docs", "migration-kb", `R${round}-migration-${stamp}.md`)
}

// docs/prior-kb/R1-prior-2026-09-07_01-02-03.md(前置知识文档;同上永久路径,
// 轮次前缀守卫使新一轮重新蒸馏,取代旧的轮间搬移)。
export function priorKnowledgeDoc(round: number, stamp: string): string {
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

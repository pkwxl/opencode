// 任务文档路径的唯一构造点(stable-refs 设计 §4.1,plans/0010-stable-refs-design.md):
// 任务文档(七角色文件 + 子任务产物)只存在于 docs/T-NNN/ 内(R3 目录化),角色
// 文件名固定(R4),路径一经创建即为永久路径(R2)——driver/提示词模板/读回落
// 三方认知经本模块统一,调用方不得自行拼串。Legacy layouts (flat
// docs/<id>.<role>.md, docs/T-NNN/SNN.md, docs/T-NNN-S<k>.testhandoff.md, flat
// docs/prior-kb/) have no read fallback since M3.7 (plans/0047 R3): an old
// project is a usage error, never read silently. 轮次专用目录(roundDir/roundDirName,
// docs/R-NN)与轮内前置知识文档路径(priorKnowledgeDoc,轮内固定名)亦在此构造;阶段目录内的路径
// (交接、验收、k 阶段知识文档 kb.md)依赖阶段单元,落在 src/phases.ts
// (偏差注记见设计文档 §4.1);上游条款: R1 编号唯一、R2 永久性、R3 目录化、
// R4 角色文件名、R5 归档语义、R6 临时文件、R7 阶段差异表达。
import { readdir } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

// 任务文档角色(R4: 角色文件名固定);index(子任务产物)只经 subtaskDoc 构造。
// shared 为 M1.0 合并理解与分解会话的公共上下文引用索引(plans/0030 D3)。
export type TaskRole = "context" | "shared" | "subtasks" | "report" | "handoff" | "testhandoff"

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

// docs/T-003/S04/index.md(子任务产物)、docs/T-003/S02/testhandoff.md(子任务级测试交接)
// 与 docs/T-003/S04/todo.md|done.md(子任务目录状态协议,M1.0 plans/0030: todo.md =
// 分解期写定的范围声明,done.md = DRIVER 在子任务收口时改名而来的完成事实)。
export function subtaskDoc(id: string, k: number, role: "index" | "testhandoff" | "todo" | "done"): string {
  return join(subtaskDir(id, k), `${role}.md`)
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

// docs/R-NN/prior-kb.md(前置知识文档;轮内固定名——新一轮轮目录恒空,前置
// 知识必重新蒸馏,取代旧的轮次前缀守卫)。
export function priorKnowledgeDoc(round: number): string {
  return join(roundDir(round), "prior-kb.md")
}

// 前置知识提取的中间产物(未收笔态;健壮性协议,见 specialized-tool-design §3):
// AI 只写本文件,driver 确认末尾「完成」收笔标记后才改名为正式知识文档(完成
// 判定 = 改名落盘 + 提交)。固定名,不在任何存量扫描(existingDistilledDocs/
// priorKnowledgeDigest 只读正式产物)中出现,永不被当作既有知识。
export const TEMP_KB_NAME = "temp-kb.md"

// 中间产物与正式产物同目录: docs/R-NN/temp-kb.md。final 为正式产物的相对路径
// (priorKnowledgeFile)。
export function tempPriorKnowledgeDoc(final: string): string {
  return join(dirname(final), TEMP_KB_NAME)
}

// File name of a phase's acceptance record (the phaseAcceptance role, M2.3,
// plans/0045): one per phase inside the phase directory docs/R-NN/P<nn>-<type>/
// (phases.ts phaseAcceptanceDoc builds the path). Written by a human, read by
// the acceptance gate (0036 D8, M4.2).
export const PHASE_ACCEPTANCE_NAME = "acceptance.md"

// The round brief (roundBrief role, M4.2, plans/0049 G2): docs/R-NN/round.md,
// stubbed at round start and written by a human. Planning sessions read it; the
// round-close gate reads its `## Close` section.
export const ROUND_BRIEF_NAME = "round.md"

export function roundBriefPath(round: number): string {
  return join(roundDir(round), ROUND_BRIEF_NAME)
}

// —— 测试交接文档的归档份(测试交接前置化设计 D4)——
//
// 当前份恒为 testhandoff.md(会话的写目标),driver 在交接收口时把它重命名为
// testhandoff-<n>.md 归档,新会话读最新一份、早期各份留作可回溯链。构造规则
// 是"去掉 .md 后缀、缀 -<n>.md"(docs/T-003/S02/testhandoff-1.md)。
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

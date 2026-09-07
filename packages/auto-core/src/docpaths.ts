// 任务文档路径的唯一构造点(stable-refs 设计 §4.1,docs/stable-refs-design.md):
// 任务文档(七角色文件 + 子任务产物)只存在于 docs/T-NNN/ 内(R3 目录化),角色
// 文件名固定(R4),路径一经创建即为永久路径(R2)——driver/提示词模板/读回落
// 三方认知经本模块统一,调用方不得自行拼串。旧平铺布局(docs/<id>.<role>.md 等)
// 仅供读回落(设计 D4: 新路径缺失回落旧路径,镜像 config.ts 的 legacyModeFallback
// 先例)与启动迁移映射使用,迁移完成后自然消亡。P1 不含 handoverDoc/knowledgeDoc
// (P2);上游条款: R1 编号唯一、R2 永久性、R3 目录化、R4 角色文件名、R5 归档
// 语义、R6 临时文件、R7 阶段差异表达。
import { mkdir, readdir, rename, rm, rmdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { log } from "./log"
import { extractRefs, rewriteRefs, type Ref } from "./refcheck"

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

// —— 旧平铺布局(读回落与迁移映射共用;迁移完成后自然消亡)——

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

// —— 存量迁移(P1-S4,计划 §4.7): 平铺旧布局 → 目录化,run 启动时幂等执行 ——

// 搬移一步: 目标新路径已存在 → 保留新文件、跳过搬移、⚠ log 列出(P1-D3,
// 绝不覆盖);否则建父目录 + rename。moved 记新相对路径。
async function moveDoc(dir: string, moved: string[], oldRel: string, newRel: string): Promise<void> {
  if (await Bun.file(join(dir, newRel)).exists()) {
    log(`⚠ 迁移跳过(目标已存在,保留新文件): ${newRel} ← ${oldRel}`)
    return
  }
  await mkdir(dirname(join(dir, newRel)), { recursive: true })
  await rename(join(dir, oldRel), join(dir, newRel))
  moved.push(newRel)
}

// 由活文档中观察到的旧路径记号推导改写配对(P1-D4 静态映射,不依赖搬移清单——
// 崩溃恢复与多次运行天然幂等): 七角色平铺 / -S<k>.testhandoff / 任务目录内
// S<k>.md 旧产物名 / final-audit.md / final/<name>.md。
function legacyPairs(refs: Ref[]): Array<{ old: string; new: string }> {
  const pairs = new Map<string, string>()
  for (const ref of refs) {
    const path = ref.path
    let match = /^docs\/T-(\d+)\.(context|subtasks|report|audit|fix|handoff|testhandoff)\.md$/.exec(path)
    if (match) {
      pairs.set(path, taskDoc(`T-${match[1]}`, match[2] as TaskRole))
      continue
    }
    match = /^docs\/T-(\d+)-S(\d+)\.testhandoff\.md$/.exec(path)
    if (match) {
      pairs.set(path, subtaskDoc(`T-${match[1]}`, Number(match[2]), "testhandoff"))
      continue
    }
    match = /^docs\/T-(\d+)\/S(\d+)\.md$/.exec(path)
    if (match) {
      pairs.set(path, subtaskDoc(`T-${match[1]}`, Number(match[2]), "index"))
      continue
    }
    if (path === "docs/final-audit.md") {
      pairs.set(path, finalDoc(1, "final-audit.md"))
      continue
    }
    match = /^docs\/final\/([^/]+\.md)$/.exec(path)
    if (match) pairs.set(path, finalDoc(1, match[1]!))
  }
  return [...pairs].map(([oldPath, newPath]) => ({ old: oldPath, new: newPath }))
}

// 存量任务文档目录化迁移(幂等;docs/ 缺失 → 空结果):
// ① docs/ 顶层平铺任务文档 → docs/T-NNN/<role>.md,子任务级测试交接 → S<kk>/;
// ② 任务目录内旧子任务产物 S<k>.md → S<kk>/index.md;
// ③ 终审旧路径 docs/final-audit.md 与 docs/final/*.md → docs/T-F1/(历史归档
//    落点,文件名不变;搬空后删空目录);
// ④ 活文档引用改写: walk docs/**/*.md(排除 docs/phases/**),旧路径记号按
//    §2 映射机械替换(围栏与标记行豁免,见 refcheck)。
// 返回 { moved, rewritten }(相对路径清单)。
export async function migrateLegacyDocs(dir: string): Promise<{ moved: string[]; rewritten: string[] }> {
  const moved: string[] = []
  const rewritten: string[] = []
  const docs = join(dir, "docs")
  const entries = await readdir(docs, { withFileTypes: true }).catch(() => undefined)
  if (entries === undefined) return { moved, rewritten }

  // ① 顶层平铺任务文档。
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const task = /^T-(\d+)\.(context|subtasks|report|audit|fix|handoff|testhandoff)\.md$/.exec(entry.name)
    if (task) {
      await moveDoc(dir, moved, join("docs", entry.name), taskDoc(`T-${task[1]}`, task[2] as TaskRole))
      continue
    }
    const sub = /^T-(\d+)-S(\d+)\.testhandoff\.md$/.exec(entry.name)
    if (sub) await moveDoc(dir, moved, join("docs", entry.name), subtaskDoc(`T-${sub[1]}`, Number(sub[2]), "testhandoff"))
  }

  // ② 任务目录内旧子任务产物。
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^T-\d+$/.test(entry.name)) continue
    for (const file of await readdir(join(docs, entry.name), { withFileTypes: true })) {
      const sub = file.isFile() ? /^S(\d+)\.md$/.exec(file.name) : undefined
      if (sub) await moveDoc(dir, moved, join("docs", entry.name, file.name), subtaskDoc(entry.name, Number(sub[1]), "index"))
    }
  }

  // ③ 终审旧路径。
  if (entries.some((entry) => entry.isFile() && entry.name === "final-audit.md")) {
    await moveDoc(dir, moved, join("docs", "final-audit.md"), finalDoc(1, "final-audit.md"))
  }
  if (entries.some((entry) => entry.isDirectory() && entry.name === "final")) {
    const finalDirAbs = join(docs, "final")
    for await (const file of new Bun.Glob("*.md").scan({ cwd: finalDirAbs, onlyFiles: true })) {
      await moveDoc(dir, moved, join("docs", "final", file), finalDoc(1, file))
    }
    // 搬空后删空目录(仍有残留文件则保留,不强制;rmdir 仅接受空目录)。
    const rest = await readdir(finalDirAbs).catch(() => ["kept"] as string[])
    if (!rest.length) await rmdir(finalDirAbs).catch(() => {})
  }

  // ④ 活文档引用改写。
  for await (const file of new Bun.Glob(join("docs", "**", "*.md")).scan({ cwd: dir, onlyFiles: true })) {
    if (file.split(/[\\/]/)[1] === "phases") continue
    const text = await Bun.file(join(dir, file)).text().catch(() => undefined)
    if (text === undefined) continue
    const { text: out, count } = rewriteRefs(text, legacyPairs(extractRefs(text)))
    if (count > 0) {
      await Bun.write(join(dir, file), out)
      rewritten.push(file)
    }
  }
  return { moved, rewritten }
}

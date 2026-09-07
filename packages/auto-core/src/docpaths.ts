// 任务文档路径的唯一构造点(stable-refs 设计 §4.1,docs/stable-refs-design.md):
// 任务文档(七角色文件 + 子任务产物)只存在于 docs/T-NNN/ 内(R3 目录化),角色
// 文件名固定(R4),路径一经创建即为永久路径(R2)——driver/提示词模板/读回落
// 三方认知经本模块统一,调用方不得自行拼串。旧平铺布局(docs/<id>.<role>.md 等)
// 仅供读回落(设计 D4: 新路径缺失回落旧路径,镜像 config.ts 的 legacyModeFallback
// 先例)与启动迁移映射使用,迁移完成后自然消亡。永久知识文档路径(knowledgeDoc/
// priorKnowledgeDoc)亦在此构造;handoverDoc 依赖阶段 slug 表,落在 src/phases.ts
// (偏差注记见设计文档 §4.1);上游条款: R1 编号唯一、R2 永久性、R3 目录化、
// R4 角色文件名、R5 归档语义、R6 临时文件、R7 阶段差异表达。
import { mkdir, readdir, rename, rm, rmdir, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { extractRefs, recordOnce, rewriteRefs, type Ref } from "./refcheck"

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

// 迁移冲突跳过清单(.auto/migrate-skips.md): 落选者原地保留是预期态,警告只在
// 首次出现时输出,登记与去重见 migrateLegacyDocs 末尾(经 refcheck.recordOnce)。
const MIGRATE_SKIPS_FILE = join(".auto", "migrate-skips.md")

// 搬移一步(P1-D3 绝不覆盖 + 空目录豁免): 目标为已存在文件 → 保留既有文件、
// 跳过搬移、记入 skips;目标为非空目录 → 同按冲突保留、记入 skips;目标为空目录
// → 不算冲突,腾位(rmdir)后照搬。否则建父目录 + rename。moved 记新相对路径;
// skips 的 ⚠ 警告由 migrateLegacyDocs 末尾统一按清单去重输出(只警告新出现)。
async function moveDoc(
  dir: string,
  moved: string[],
  skips: Array<{ old: string; new: string; reason: "file" | "dir" }>,
  oldRel: string,
  newRel: string,
): Promise<void> {
  const target = join(dir, newRel)
  const info = await stat(target).catch(() => undefined)
  if (info?.isFile()) {
    skips.push({ old: oldRel, new: newRel, reason: "file" })
    return
  }
  if (info?.isDirectory()) {
    if ((await readdir(target)).length) {
      skips.push({ old: oldRel, new: newRel, reason: "dir" })
      return
    }
    await rmdir(target)
  }
  await mkdir(dirname(target), { recursive: true })
  await rename(join(dir, oldRel), target)
  moved.push(newRel)
}

// 旧版工具轮次归档(docs/phases/round-<N>/<字母>-<slug>/)的提升映射,迁移扫描
// 与旧引用改写共用此单一映射源(P1-D4 静态映射同款,不依赖搬移清单):
// - 任务文档(七角色,含 T-F<k>)→ taskDoc;T-0NN/S<k>.md → subtaskDoc index,
//   S<k>.<name>.md 伴生产物(如 gate)→ 同子任务目录保留区分名;
// - handover.md 与旧 T-NNN.handover.md 命名变体(实为阶段交接)→ docs/handovers/
//   永久路径(D3,与 handoverDoc 同构);
// - final/*.md → docs/T-F1/;migration-kb|prior-kb/<kind>-<stamp>.md → 永久知识
//   路径补 R<N> 轮次前缀(R7);
// - 阶段自由产物(a/d/t/v 勘测/设计/矩阵类)→ docs/phase-docs/R<N>-<字母>-<slug>/
//   永久目录(剥离冗余首层阶段子目录;P2 补口,handovers 永久化同款范式);
// - 阶段目录顶层散落的项目文档(如 005-dm-crate-skeleton.md)→ docs/ 顶层归位;
// - PLAN.md/phases.md/AGENTS.md 为过期状态不动(R5)。非轮次归档路径 → undefined。
export function phasesArchivePair(path: string): string | undefined {
  const base = /^docs\/phases\/round-(\d+)\/([a-z])-([a-z-]+)\/(.+)$/.exec(path)
  if (!base) return undefined
  const [, round, phase, slug, rest] = base
  if (/^(?:T-F?\d+\.)?handover\.md$/.test(rest!)) {
    return `docs/handovers/R${round}-${phase}-${slug}.md`
  }
  let match = /^T-(F?\d+)\.(context|subtasks|report|audit|fix|handoff|testhandoff)\.md$/.exec(rest!)
  if (match) return taskDoc(`T-${match[1]}`, match[2] as TaskRole)
  match = /^T-(F?\d+)\/S(\d+)\.md$/.exec(rest!)
  if (match) return subtaskDoc(`T-${match[1]}`, Number(match[2]), "index")
  match = /^T-(F?\d+)\/S(\d+)\.([a-z0-9][a-z0-9-]*)\.md$/.exec(rest!)
  if (match) return join(subtaskDir(`T-${match[1]}`, Number(match[2])), `${match[3]}.md`)
  match = /^final\/([^/]+\.md)$/.exec(rest!)
  if (match) return finalDoc(1, match[1]!)
  match = /^migration-kb\/migration-(.+)\.md$/.exec(rest!)
  if (match) return knowledgeDoc(Number(round), match[1]!)
  match = /^prior-kb\/prior-(.+)\.md$/.exec(rest!)
  if (match) return priorKnowledgeDoc(Number(round), match[1]!)
  if (/^(?:PLAN|phases|AGENTS)\.md$/.test(rest!)) return undefined
  const slash = rest!.indexOf("/")
  if (slash < 0) return join("docs", rest!)
  return `docs/phase-docs/R${round}-${phase}-${slug}/${rest!.slice(slash + 1)}`
}

// 由活文档中观察到的旧路径记号推导改写配对(P1-D4 静态映射,不依赖搬移清单——
// 崩溃恢复与多次运行天然幂等): 七角色平铺 / -S<k>.testhandoff / 任务目录内
// S<k>.md 旧产物名 / final-audit.md / final/<name>.md / 旧轮次归档提升映射。
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
    if (match) {
      pairs.set(path, finalDoc(1, match[1]!))
      continue
    }
    const archive = phasesArchivePair(path)
    if (archive) pairs.set(path, archive)
  }
  return [...pairs].map(([oldPath, newPath]) => ({ old: oldPath, new: newPath }))
}

// 存量任务文档目录化迁移(幂等;docs/ 缺失 → 空结果):
// ① docs/ 顶层平铺任务文档 → docs/T-NNN/<role>.md,子任务级测试交接 → S<kk>/;
// ② 任务目录内旧子任务产物 S<k>.md → S<kk>/index.md;
// ③ 终审旧路径 docs/final-audit.md 与 docs/final/*.md → docs/T-F1/(历史归档
//    落点,文件名不变;搬空后删空目录);
// ⑤ 旧版工具轮次归档提升 docs/phases/round-<N>/<字母>-<slug>/ → 永久路径(任务
//    文档/子任务产物/交接/终审/知识库/阶段自由产物 docs/phase-docs/,映射见
//    phasesArchivePair;PLAN.md 等过期状态不动,R5);
// ④ 活文档引用改写: walk docs/**/*.md(排除 docs/phases/**),旧路径记号按
//    §2 映射机械替换(围栏与标记行豁免,见 refcheck;含轮次归档旧路径)。
// 冲突裁决(时间最新优先): 候选先全量收集并按目标新路径分组,组内按 mtime 降序
// (同 mtime 路径字典序,确定性)依次搬移——最新者占领空闲目标位,冲突方(目标
// 已被占或非空目录)不移动原地保留,绝不覆盖;目标为空目录不算冲突可落位。
// 返回 { moved, rewritten, skipped }(相对路径清单)。
export async function migrateLegacyDocs(dir: string): Promise<{ moved: string[]; rewritten: string[]; skipped: string[] }> {
  const moved: string[] = []
  const rewritten: string[] = []
  const skips: Array<{ old: string; new: string; reason: "file" | "dir" }> = []
  const docs = join(dir, "docs")
  const entries = await readdir(docs, { withFileTypes: true }).catch(() => undefined)
  if (entries === undefined) return { moved, rewritten, skipped: [] }

  // 收集搬移候选(旧相对路径 → 新相对路径),mtime 就近取样供裁决排序。
  const candidates: Array<{ old: string; new: string; mtime: number }> = []
  const plan = async (oldRel: string, newRel: string) => {
    const info = await stat(join(dir, oldRel)).catch(() => undefined)
    if (info) candidates.push({ old: oldRel, new: newRel, mtime: info.mtimeMs })
  }

  // ① 顶层平铺任务文档。
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const task = /^T-(\d+)\.(context|subtasks|report|audit|fix|handoff|testhandoff)\.md$/.exec(entry.name)
    if (task) {
      await plan(join("docs", entry.name), taskDoc(`T-${task[1]}`, task[2] as TaskRole))
      continue
    }
    const sub = /^T-(\d+)-S(\d+)\.testhandoff\.md$/.exec(entry.name)
    if (sub) await plan(join("docs", entry.name), subtaskDoc(`T-${sub[1]}`, Number(sub[2]), "testhandoff"))
  }

  // ② 任务目录内旧子任务产物。
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^T-\d+$/.test(entry.name)) continue
    for (const file of await readdir(join(docs, entry.name), { withFileTypes: true })) {
      const sub = file.isFile() ? /^S(\d+)\.md$/.exec(file.name) : undefined
      if (sub) await plan(join("docs", entry.name, file.name), subtaskDoc(entry.name, Number(sub[1]), "index"))
    }
  }

  // ③ 终审旧路径。
  if (entries.some((entry) => entry.isFile() && entry.name === "final-audit.md")) {
    await plan(join("docs", "final-audit.md"), finalDoc(1, "final-audit.md"))
  }
  if (entries.some((entry) => entry.isDirectory() && entry.name === "final")) {
    const finalDirAbs = join(docs, "final")
    for await (const file of new Bun.Glob("*.md").scan({ cwd: finalDirAbs, onlyFiles: true })) {
      await plan(join("docs", "final", file), finalDoc(1, file))
    }
  }

  // ⑤ 旧版工具轮次归档提升(docs/phases/round-<N>/<字母>-<slug>/ → 永久路径,
  // 映射见 phasesArchivePair): 与 ①-③ 候选同池参与 mtime 裁决,跨轮同编号任务
  // 文档自动保最新;PLAN.md/phases.md/AGENTS.md 等过期状态留在归档内(R5)。
  for (const round of await readdir(join(docs, "phases"), { withFileTypes: true }).catch(() => [])) {
    if (!round.isDirectory() || !/^round-\d+$/.test(round.name)) continue
    for (const phaseDir of await readdir(join(docs, "phases", round.name), { withFileTypes: true }).catch(() => [])) {
      if (!phaseDir.isDirectory() || !/^[a-z]-[a-z-]+$/.test(phaseDir.name)) continue
      const prefix = `docs/phases/${round.name}/${phaseDir.name}`
      for await (const file of new Bun.Glob("**/*.md").scan({
        cwd: join(docs, "phases", round.name, phaseDir.name),
        onlyFiles: true,
      })) {
        const target = phasesArchivePair(`${prefix}/${file}`)
        if (target) await plan(`${prefix}/${file}`, target)
      }
    }
  }

  // 分组裁决: 组内 mtime 降序(同 mtime 路径字典序)依次尝试,最新者占领空闲
  // 目标位,冲突方原地保留;moveDoc 内的占位检查是最终防线(防同目标多候选)。
  const groups = new Map<string, Array<{ old: string; new: string; mtime: number }>>()
  for (const candidate of candidates) {
    const group = groups.get(candidate.new)
    if (group) group.push(candidate)
    else groups.set(candidate.new, [candidate])
  }
  for (const group of groups.values()) {
    group.sort((a, b) => b.mtime - a.mtime || (a.old < b.old ? -1 : 1))
    for (const candidate of group) await moveDoc(dir, moved, skips, candidate.old, candidate.new)
  }

  // 冲突跳过登记(与失效引用清单同款去重,refcheck.recordOnce): 键 = `新 ← 旧`,
  // 每轮全量重写 .auto/migrate-skips.md,只对新出现的跳过输出 ⚠——冲突落选者原地
  // 保留是预期态(P1-D3),不应每轮重复警告;清单即人工核验落选文件的入口。
  await recordOnce(
    dir,
    MIGRATE_SKIPS_FILE,
    "# 迁移冲突跳过清单(auto 维护;冲突落选者按 P1-D3 原地保留,已收录项不再重复警告)\n",
    skips.map((skip) => ({
      key: `${skip.new} ← ${skip.old}`,
      warn: `迁移跳过(${skip.reason === "dir" ? "目标为非空目录" : "目标已存在,保留新文件"}): ${skip.new} ← ${skip.old}`,
    })),
  )
  const skipped = skips.map((skip) => skip.old)

  // 搬空的 final/ 目录删除(仍有残留文件则保留,不强制;rmdir 仅接受空目录)。
  const finalDirAbs = join(docs, "final")
  const rest = await readdir(finalDirAbs).catch(() => undefined)
  if (rest !== undefined && !rest.length) await rmdir(finalDirAbs).catch(() => {})

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
  return { moved, rewritten, skipped }
}

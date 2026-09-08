// 引用一致性层(stable-refs 设计 §4.5,三层见 D6): extractRefs 提取文档对文档/
// 代码的路径引用(反引号 span 与 md 链接),rewriteRefs 做旧→新路径的机械改写
// (提交前 auto-correct 与 fix-refs 手动脚本共用本原语);P4 补齐 validateRefs
// (存在性 + 段边界后缀唯一匹配消解 + 行号上限)、renamePairs(git rename 配对)、
// 活文档枚举与 scanRefs 全量扫描,供 check 子命令与 verify 门禁消费;
// autoCorrectRefs 另维护 .auto/invalid-refs.md 失效清单,仅对新出现的失效引用输出
// ⚠ 日志;refcheck-scope P2 补齐 renameHistory(git 历史 rename 地图)与缺失
// 恢复(失效确认在先、恢复在后: missing finding 的目标在历史中曾存在且链式解析
// 落点当前存在 → 就地改写恢复;落点已删除保留 finding 人工订正);P3 补齐范围再
// 确认(reconfirmAnchors): 带行号锚的引用,其目标文件在所属(可能嵌套的)git
// 仓库有未提交差异时,比对 HEAD 版本与当前工作区版本的同范围行切片,不一致即
// 保留原范围、就地追加 @<sha> 版本标记(语义: 该范围仅对此历史版本有效)。
// 三层挂点受 OPENCODE_AUTO_REF_CHECK 管控(refcheck-scope-design D3,
// 缺省 off 空转;管控点在 runner.ts/check.ts,本层函数不感知开关)。
import { mkdir, readdir, realpath, rm, stat } from "node:fs/promises"
import type { Stats } from "node:fs"
import { join, relative, sep, dirname } from "node:path"
import { repoRoots } from "./git"
import { log } from "./log"

// path = 剥离可选 `@<sha>` 版本标记与 `:行号` 尾锚后的引用路径;line = 尾锚行号
// (存在时);ver = `@<sha>` 版本标记(存在时——历史快照引用,行号上限校验豁免);
// at = 引用所在行号(1 起)。
export type Ref = { path: string; line?: number; at: number; ver?: string }

// 行候选掩码(单趟状态机): ``` / ~~~ 围栏内的行豁免,含 已删除|已归档|历史 的
// 标记行豁免——代码块内与已声明失效的引用不参与提取与改写;围栏开关行自身同样豁免。
function candidateMask(text: string): boolean[] {
  let fenced = false
  return text.split("\n").map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      return false
    }
    return !fenced && !/已删除|已归档|历史/.test(line)
  })
}

// 行内引用 token: 反引号 span(`…`)与 md 链接([x](…))的目标;同 token 多次
// 出现只取一次(提取目的是路径清单,不是出现位置清单)。
function tokensOf(line: string): string[] {
  const tokens = new Set<string>()
  for (const span of line.matchAll(/`([^`]+)`/g)) tokens.add(span[1]!)
  for (const link of line.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) tokens.add(link[1]!)
  return [...tokens]
}

// 尾锚解析(refcheck-scope P3 §6,顺序不可颠倒): 先剥可选 `@<sha>` 版本标记
// (7-40 位十六进制,历史快照引用),再剥 `:N` / `:N-M` 行号锚;anchorRaw 保留
// 原锚文本(范围再确认改写须保留原范围,不能由 start/end 重建)。
function parseTail(token: string): { path: string; start?: number; end?: number; ver?: string; anchorRaw?: string } {
  let rest = token
  let ver: string | undefined
  const verMatch = /@([0-9a-f]{7,40})$/.exec(rest)
  if (verMatch) {
    ver = verMatch[1]!
    rest = rest.slice(0, -verMatch[0].length)
  }
  const anchor = /:(\d+(?:-\d+)*)$/.exec(rest)
  const path = anchor ? rest.slice(0, -anchor[0].length) : rest
  if (!anchor) return ver ? { path, ver } : { path }
  const nums = anchor[1]!.split("-").map(Number)
  return { path, start: nums[0]!, end: nums[nums.length - 1]!, ver, anchorRaw: anchor[1]! }
}

// 提取规则(P1 计划 §4.2): 候选行的 token 剥离可选尾锚后,须无空白且
// "含 / 或含 ."(路径状)才算引用;尾锚见 parseTail(行号区间 line 取上界——
// 存在性校验用不到行号,行号上限校验按最大行号判超界)。
export function extractRefs(text: string): Ref[] {
  const refs: Ref[] = []
  const mask = candidateMask(text)
  text.split("\n").forEach((line, i) => {
    if (!mask[i]) return
    for (const token of tokensOf(line)) {
      const parsed = parseTail(token)
      if (/\s/.test(parsed.path) || (!parsed.path.includes("/") && !parsed.path.includes("."))) continue
      const ref: Ref = { path: parsed.path, at: i + 1 }
      if (parsed.end !== undefined) ref.line = parsed.end
      if (parsed.ver !== undefined) ref.ver = parsed.ver
      refs.push(ref)
    }
  })
  return refs
}

// 机械改写: 对每个 pair 以全路径词边界正则替换并计数(防 docs/T-1.md 误配
// docs/T-11.md、防截断半路径);同样只作用于候选行(围栏与标记行豁免)。
// 排版不变式(2026-09-08 需求追加): 改写绝不动文档排版——只就地替换命中 token
// 本身,行结构/空白/表格对齐/末尾换行一律原样保留;无命中(count=0)时输出与
// 输入逐字节相同(调用方不写回,文件保持原样)。
export function rewriteRefs(text: string, pairs: Array<{ old: string; new: string }>): { text: string; count: number } {
  const lines = text.split("\n")
  const mask = candidateMask(text)
  let count = 0
  for (const pair of pairs) {
    const pattern = new RegExp(`(?<![-\\w./\\\\])${escapeRegexp(pair.old)}(?![\\w./\\\\-])`, "g")
    lines.forEach((line, i) => {
      if (!mask[i]) return
      lines[i] = line.replace(pattern, () => {
        count++
        return pair.new
      })
    })
  }
  return { text: lines.join("\n"), count }
}

function escapeRegexp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// —— P4: 活文档枚举与校验 ——
// 活文档范围(stable-refs §3.3): docs/**/*.md,排除 docs/phases/** 与轮次目录
// docs/R-NN/<字母>-<slug>/** 内的阶段归档(R5 状态文件不被任何文档引用,也不
// 参与检查;轮内台账 phases.md 与根 docs/phases.md 同款属活文档);排序保证扫描与
// 日志输出确定。
export async function activeDocs(dir: string): Promise<string[]> {
  const files: string[] = []
  for await (const file of new Bun.Glob(join("docs", "**", "*.md")).scan({ cwd: dir, onlyFiles: true })) {
    const segments = file.split(/[\\/]/)
    if (segments[1] === "phases") continue
    if (/^R-\d+$/.test(segments[1] ?? "") && /^[admtvk]-/.test(segments[2] ?? "")) continue
    files.push(segments.join("/"))
  }
  return files.sort()
}

// 引用是否属可校验形态: §3.2 唯一合法形态为目标目录根相对路径——URL(scheme:
// 形态,含 Windows 盘符)、绝对路径与 ~/ 开头、./ 与 ../ 相对形态之外的引用不
// 校验不报告;另要求路径状——含 / 或带字母开头的扩展名(防 `v1.2`、`3.10` 类
// 版本号误报)。
function checkable(path: string): boolean {
  if (path.startsWith("/") || path.startsWith("\\") || path.startsWith("~")) return false
  if (path.startsWith("./") || path.startsWith("../")) return false
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return false
  if (path.includes("/")) return true
  return /\.[A-Za-z][A-Za-z0-9]*$/.test(path)
}

// 一处失效引用: file/line/text = 引用所在文档与行(原文),path = 被引用路径,
// problem = 路径不存在(missing)或行号超出文件总行数(beyond-eof)。
export type RefFinding = { file: string; line: number; text: string; path: string; problem: "missing" | "beyond-eof" }

// 目录文件索引(惰性构建,一次扫描全程复用): 目标目录树的全量文件与目录清单,
// node_modules 与 .git 剪枝不下钻(体积大且副本路径会破坏唯一性判定)。软链目录
// 照常下钻(迁移工程常以软链挂载参照源码树,如 linux → …),以 realpath 集合防
// 循环软链与重复下钻。用于消解带上下文语境的相对引用——引用常以引用者所在目录
// 或参照树根为基书写,直接按目标目录根解析会误判缺失;目录引用(尾缀 /)只在
// 目录项内匹配,文件引用不限形态(同名文件与目录不会并存于同一路径,跨形态歧义
// 按多重匹配缺失处理)。
type IndexEntry = { path: string; dir: boolean }

class FileIndex {
  private files: Promise<IndexEntry[]> | undefined

  constructor(private dir: string) {}

  list(): Promise<IndexEntry[]> {
    this.files ??= walkTree(this.dir).then((entries) => entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)))
    return this.files
  }

  // 批量消解: 一趟遍历索引,对每项自末段向前枚举段边界后缀与目标集求交——总代价
  // O(索引项 × 平均段数),引用数大时远优于逐目标全表过滤(O(引用数 × 文件数))。
  // 唯一命中的目标收录(多重匹配属语境歧义,交由调用方按缺失处理);尾缀 `/` 的
  // 目标只在目录项内匹配。带/不带尾杠的同一目标归一同键(值数组),避免互相覆盖。
  async resolveAll(targets: string[]): Promise<Map<string, IndexEntry>> {
    const lookup = new Map<string, Array<{ target: string; dirOnly: boolean }>>()
    for (const target of targets) {
      const key = `/${target.replace(/\/$/, "")}`
      const item = { target, dirOnly: target.endsWith("/") }
      const bucket = lookup.get(key)
      if (bucket) bucket.push(item)
      else lookup.set(key, [item])
    }
    const found = new Map<string, IndexEntry[]>()
    for (const entry of await this.list()) {
      const segs = entry.path.split("/")
      let suffix = ""
      for (let i = segs.length - 1; i >= 0; i--) {
        suffix = `/${segs[i]!}${suffix}`
        const items = lookup.get(suffix)
        if (!items) continue
        for (const { target, dirOnly } of items) {
          if (dirOnly && !entry.dir) continue
          const bucket = found.get(target)
          if (bucket) bucket.push(entry)
          else found.set(target, [entry])
        }
      }
    }
    const resolved = new Map<string, IndexEntry>()
    for (const [target, hits] of found) if (hits.length === 1) resolved.set(target, hits[0]!)
    return resolved
  }
}

async function walkTree(dir: string, base = "", visited?: Set<string>): Promise<IndexEntry[]> {
  const seen = visited ?? new Set<string>()
  const out: IndexEntry[] = []
  for (const entry of await readdir(join(dir, base), { withFileTypes: true }).catch(() => [])) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.name === "node_modules" || entry.name === ".git") continue
    // 常规目录/文件按 Dirent 直收;软链需 stat 跟随判定目标形态(Dirent 对软链
    // 恒报 isSymbolicLink),目录下钻前以 realpath 查 visited 防循环与重复。
    if (entry.isDirectory()) {
      await descend(dir, rel, seen, out)
    } else if (entry.isFile()) {
      out.push({ path: rel, dir: false })
    } else if (entry.isSymbolicLink()) {
      const info = await stat(join(dir, rel)).catch(() => undefined)
      if (info?.isDirectory()) await descend(dir, rel, seen, out)
      else if (info?.isFile()) out.push({ path: rel, dir: false })
    }
  }
  return out
}

async function descend(dir: string, rel: string, seen: Set<string>, out: IndexEntry[]): Promise<void> {
  const real = await realpath(join(dir, rel)).catch(() => undefined)
  if (!real || seen.has(real)) return
  seen.add(real)
  out.push({ path: rel, dir: true })
  out.push(...(await walkTree(dir, rel, seen)))
}

// 校验一组引用(§3.2 校验语义: 路径存在;行号 ≤ 文件总行数)。路径解析两步:
// 目标目录根相对直接命中即有效;否则在目录树中找以该路径为段边界后缀的唯一文件
// 匹配——唯一命中即视为有效并消解到匹配文件做行号校验(带上下文语境的相对引用,
// 尤其非 docs 引用;多重匹配属语境歧义,按缺失)。同一文档内的重复路径只校验一次;
// md 链接的 #fragment 尾锚剥后再验;目录引用只查存在性(行号锚对目录无意义,忽略)。
// index 供扫描入口跨文档复用(缺省自建,惰性构建)。
// 校验一组引用(§3.2 校验语义: 路径存在;行号 ≤ 文件总行数)。路径解析两步:
// 目标目录根相对直接命中即有效;否则在目录树中找以该路径为段边界后缀的唯一文件
// 匹配——唯一命中即视为有效并消解到匹配文件做行号校验(带上下文语境的相对引用,
// 尤其非 docs 引用;多重匹配属语境歧义,按缺失)。resolved 为跨文档共享的消解
// 结果表(target → 消解路径或 undefined,含直接命中;由 scanRefs 单趟批量预计算,
// 避免逐文档重复全索引消解——表内缺项时回落自查)。同一文档内的重复路径只校验
// 一次;md 链接的 #fragment 尾锚剥后再验;目录引用只查存在性(行号锚对目录无
// 意义,忽略)。带 ver(`@<sha>` 版本标记)的引用视为历史快照引用——只查路径
// 存在性,行号上限校验豁免(历史版本不可机械校验,refcheck-scope P3 §6)。
// index 供缺表时的回落消解复用(缺省自建,惰性构建)。
export async function validateRefs(
  dir: string,
  refs: Ref[],
  index = new FileIndex(dir),
  resolved?: Map<string, string | undefined>,
): Promise<Map<string, "missing" | "beyond-eof">> {
  const problems = new Map<string, "missing" | "beyond-eof">()
  const paths = [...new Set(refs.filter((ref) => checkable(ref.path)).map((ref) => ref.path))]
  // 第一步: 定位每个目标的落点(直接命中 / 唯一消解 / 缺失)。
  const where = new Map<string, string>()
  const missing = new Set<string>()
  for (const path of paths) {
    const target = path.split("#")[0]!
    if (resolved?.has(target)) {
      const hit = resolved.get(target)
      if (hit) where.set(target, hit)
      else missing.add(target)
      continue
    }
    const direct = await stat(join(dir, target)).catch(() => undefined)
    if (direct) {
      where.set(target, target)
      continue
    }
    const hit = (await index.resolveAll([target])).get(target)
    if (hit) where.set(target, hit.path)
    else missing.add(target)
  }
  // 第二步: 逐目标定性——落点存在性与行号上限(目录引用只查存在性)。
  for (const path of paths) {
    const target = path.split("#")[0]!
    const at = where.get(target)
    if (!at) {
      if (missing.has(target)) problems.set(path, "missing")
      continue
    }
    const info = await stat(join(dir, at)).catch(() => undefined)
    if (!info) {
      problems.set(path, "missing")
      continue
    }
    if (!info.isFile()) continue
    const anchors = refs.filter((item) => item.path === path && item.line !== undefined && item.ver === undefined)
    if (!anchors.length) continue
    const text = await Bun.file(join(dir, at)).text().catch(() => "")
    const lines = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
    if (anchors.some((anchor) => anchor.line! > lines)) problems.set(path, "beyond-eof")
  }
  return problems
}

// 扫描一组文档(docs 缺省 = 全部活文档): 先汇总全部文档的可校验目标,直接命中
// 判定后一趟 resolveAll 批量消解(结果表跨文档共享,索引全程只遍历一次),再逐
// 文档引用校验产出 findings。
export async function scanRefs(dir: string, docs?: string[]): Promise<RefFinding[]> {
  const files = docs ?? (await activeDocs(dir))
  const index = new FileIndex(dir)
  const scanned: Array<{ file: string; text: string; refs: Ref[] }> = []
  const targets = new Set<string>()
  for (const file of files) {
    const text = await Bun.file(join(dir, file)).text().catch(() => undefined)
    if (text === undefined) continue
    const refs = extractRefs(text)
    if (!refs.length) continue
    scanned.push({ file, text, refs })
    for (const ref of refs) {
      if (checkable(ref.path)) targets.add(ref.path.split("#")[0]!)
    }
  }
  const resolved = new Map<string, string | undefined>()
  const unresolved: string[] = []
  for (const target of targets) {
    if (await stat(join(dir, target)).catch(() => undefined)) resolved.set(target, target)
    else unresolved.push(target)
  }
  const hits = await index.resolveAll(unresolved)
  // 未命中目标(含多重匹配歧义)显式记 undefined = 已定性缺失,防止消费方回落自查
  // 重复触发全索引遍历。
  for (const target of unresolved) resolved.set(target, hits.get(target)?.path)
  const findings: RefFinding[] = []
  for (const { file, text, refs } of scanned) {
    const problems = await validateRefs(dir, refs, index, resolved)
    if (!problems.size) continue
    const lines = text.split("\n")
    for (const ref of refs) {
      const problem = problems.get(ref.path)
      if (problem) findings.push({ file, line: ref.at, text: lines[ref.at - 1]!.trim(), path: ref.path, problem })
    }
  }
  return findings
}

// —— P4: git rename 配对与提交前 auto-correct ——
// 目标目录是否在 git 仓库内(check 对非 git 目录报 note: auto-correct 不可用)。
export async function gitAvailable(dir: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["git", "-C", dir, "rev-parse", "--is-inside-work-tree"], { stdout: "pipe", stderr: "pipe" })
    const out = await new Response(proc.stdout).text()
    return (await proc.exited) === 0 && out.trim() === "true"
  } catch {
    return false
  }
}

// git rename 配对(§4.5): 索引 vs HEAD——工作区改动先经 git add -A 暂存,使
// 未跟踪的新路径参与 rename 配对(driver 的下一次统一提交本就全量 add,暂存
// 不改变其结果);输出换算为目标目录相对路径。非 git 目录/无 HEAD(空仓库)/
// git 不可用返回 []。
export async function renamePairs(dir: string): Promise<Array<{ old: string; new: string }>> {
  const top = (await gitOut(dir, ["rev-parse", "--show-toplevel"]))?.trim()
  if (!top) return []
  if ((await gitRun(dir, ["add", "-A", "--", "."])).code !== 0) return []
  const out = await gitOut(dir, ["diff", "--cached", "--find-renames", "--diff-filter=R", "--name-status", "-z", "HEAD"])
  if (!out) return []
  const parts = out.split("\0")
  const pairs: Array<{ old: string; new: string }> = []
  for (let i = 0; i < parts.length - 2; i++) {
    if (!parts[i]!.startsWith("R")) continue
    const oldRel = relative(dir, join(top, parts[i + 1]!))
    const newRel = relative(dir, join(top, parts[i + 2]!))
    if (oldRel.startsWith("..") || newRel.startsWith("..")) continue
    pairs.push({ old: oldRel.split(sep).join("/"), new: newRel.split(sep).join("/") })
  }
  return pairs
}

// —— refcheck-scope P2: rename 历史地图与缺失引用恢复(§4)——
// rename 历史地图(D5 的确定性判据:「曾出现」= 所属 git 仓库历史中曾存在该
// 路径): 目标仓库及嵌套子仓库各自执行 git log --find-renames --diff-filter=R
// --name-status --format= -z,按新→旧序遍历、首现优先得 old→new 直接边,再链式
// 解析到最终落点(visited 防环;成环等病态历史解析到的落点若已不存在,由调用方
// 存在性检查兜底保留 finding);路径换算目标目录相对,目录树外路径丢弃。
// 键值均为目标目录相对路径(old → 最终落点)。
export async function renameHistory(dir: string): Promise<Map<string, string>> {
  const edges = new Map<string, string>()
  for (const root of await repoRoots(dir)) {
    const top = (await gitOut(root, ["rev-parse", "--show-toplevel"]))?.trim()
    if (!top) continue
    const out = await gitOut(root, ["log", "--find-renames", "--diff-filter=R", "--name-status", "--format=", "-z"])
    if (!out) continue
    const parts = out.split("\0")
    for (let i = 0; i < parts.length - 2; i++) {
      if (!parts[i]!.startsWith("R")) continue
      const oldRel = relative(dir, join(top, parts[i + 1]!)).split(sep).join("/")
      const newRel = relative(dir, join(top, parts[i + 2]!)).split(sep).join("/")
      if (oldRel.startsWith("..") || newRel.startsWith("..")) continue
      if (!edges.has(oldRel)) edges.set(oldRel, newRel)
    }
  }
  const history = new Map<string, string>()
  for (const old of edges.keys()) {
    const visited = new Set<string>([old])
    let current = old
    while (true) {
      const next = edges.get(current)
      if (!next || visited.has(next)) break
      visited.add(next)
      current = next
    }
    if (current !== old) history.set(old, current)
  }
  return history
}

// 缺失引用恢复(§4,失效确认在先、恢复在后——顺序不可颠倒): 对 findings 中
// problem: "missing" 的条目逐一定性——rename 历史地图含该目标为 old 且链式落点
// 当前存在 → rewriteRefs 就地改写恢复(排版不变式);落点已删除(或历史中不曾
// 存在)→ 保留 finding 入失效清单,人工订正。只恢复「移动/改名」导致的失效,
// 删除与语义变化不自动恢复(§8 边界)。最小范围: 只改写失效确认的该引用所在
// 文档中的该路径 token,不波及其他文档。返回改写处数(0 = 本轮无恢复)。
async function recoverMissingRefs(dir: string, findings: RefFinding[]): Promise<number> {
  const missing = findings.filter((finding) => finding.problem === "missing")
  if (!missing.length) return 0
  const history = await renameHistory(dir)
  if (!history.size) return 0
  const byFile = new Map<string, Array<{ old: string; new: string }>>()
  for (const finding of missing) {
    const target = finding.path.split("#")[0]!
    const landing = history.get(target)
    if (!landing) continue
    if (!(await stat(join(dir, landing)).catch(() => undefined))) continue
    const pairs = byFile.get(finding.file) ?? []
    if (!pairs.some((pair) => pair.old === target)) pairs.push({ old: target, new: landing })
    byFile.set(finding.file, pairs)
  }
  let rewritten = 0
  for (const [file, pairs] of byFile) {
    const text = await Bun.file(join(dir, file)).text().catch(() => undefined)
    if (text === undefined) continue
    const { text: out, count } = rewriteRefs(text, pairs)
    if (count > 0) {
      await Bun.write(join(dir, file), out)
      rewritten += count
    }
  }
  return rewritten
}

// —— refcheck-scope P3: 引用范围再确认(§6,行号锚 + @sha 版本标记)——
// 对象: 活文档中带行号锚(`:N` / `:N-M`)且不带版本标记的引用,其目标文件「被
// 编辑修改过」——判据 = 目标文件在所属(可能嵌套的)git 仓库有未提交内容差异
// (`git diff HEAD --name-only`;renamePairs 已 `git add -A` 暂存,暂存区即改动
// 全集;嵌套子仓库逐个判定,镜像 git.ts 统一提交的嵌套优先遍历)。目标消解与
// validateRefs 同款两步(直接命中 / 段边界后缀唯一匹配)。
// 一致性判定 = 目标文件 HEAD 版本的范围行切片 vs 当前工作区版本同范围行切片
// (当前文件行数不足即不一致):
//   一致 → 引用不动;
//   不一致 → 保留原引用范围不变,锚就地改写为 `path:N-M@<sha>`(sha = 所属仓库
//   当前 HEAD 短哈希 7 位)——语义: 该范围仅对此历史版本有效,其后续内容已变更。
// 幂等: 已带 `@sha` 的引用不再追加或更新标记,留待人工订正;HEAD 无该文件版本
// (本轮新增文件)无历史版本可钉,跳过。排版不变式同 rewriteRefs(无命中不写回)。
// 返回改写处数(0 = 本轮无再确认)。
export async function reconfirmAnchors(dir: string): Promise<number> {
  // 各仓库: 改动文件集(目标目录相对)与 HEAD 短哈希;无 git/无 HEAD/无改动跳过
  const repos: Array<{ top: string; sha: string; changed: Set<string> }> = []
  for (const root of await repoRoots(dir)) {
    const top = (await gitOut(root, ["rev-parse", "--show-toplevel"]))?.trim()
    if (!top) continue
    const out = await gitOut(root, ["diff", "HEAD", "--name-only", "-z"])
    const sha = (await gitOut(root, ["rev-parse", "--short=7", "HEAD"]))?.trim()
    if (!out || !sha) continue
    const changed = new Set<string>()
    for (const part of out.split("\0")) {
      if (!part) continue
      const rel = relative(dir, join(top, part)).split(sep).join("/")
      if (!rel.startsWith("..")) changed.add(rel)
    }
    if (changed.size) repos.push({ top, sha, changed })
  }
  if (!repos.length) return 0
  const index = new FileIndex(dir)
  let rewritten = 0
  for (const file of await activeDocs(dir)) {
    const text = await Bun.file(join(dir, file)).text().catch(() => undefined)
    if (text === undefined) continue
    // 候选: 带行号锚且不带版本标记的可校验引用(anchorRaw 保留原范围文本供改写)
    const candidates: Array<{ path: string; start: number; end: number; anchorRaw: string }> = []
    const mask = candidateMask(text)
    text.split("\n").forEach((line, i) => {
      if (!mask[i]) return
      for (const token of tokensOf(line)) {
        const parsed = parseTail(token)
        if (parsed.start === undefined || parsed.end === undefined || parsed.ver !== undefined) continue
        if (!checkable(parsed.path)) continue
        candidates.push({ path: parsed.path, start: parsed.start, end: parsed.end, anchorRaw: parsed.anchorRaw! })
      }
    })
    if (!candidates.length) continue
    const pairs: Array<{ old: string; new: string }> = []
    const seen = new Set<string>()
    for (const ref of candidates) {
      const target = ref.path.split("#")[0]!
      let at: string | undefined
      const direct = await stat(join(dir, target)).catch(() => undefined)
      if (direct) {
        if (!direct.isFile()) continue // 目录引用无行号语义
        at = target
      } else {
        const hit = (await index.resolveAll([target])).get(target)
        if (!hit || hit.dir) continue
        at = hit.path
      }
      const repo = repos.find((item) => item.changed.has(at))
      if (!repo) continue
      const work = await Bun.file(join(dir, at)).text().catch(() => undefined)
      if (work === undefined) continue
      const head = await gitOut(repo.top, ["show", `HEAD:${relative(repo.top, join(dir, at)).split(sep).join("/")}`])
      if (head === undefined) continue // HEAD 无此文件(本轮新增)→ 无版本可钉
      const workLines = work.split("\n")
      const headLines = head.split("\n")
      // 当前文件行数不足即不一致;一致(同范围行切片逐行相同)→ 引用不动
      const consistent =
        workLines.length >= ref.end &&
        headLines.length >= ref.end &&
        workLines.slice(ref.start - 1, ref.end).join("\n") === headLines.slice(ref.start - 1, ref.end).join("\n")
      if (consistent) continue
      const token = `${ref.path}:${ref.anchorRaw}`
      if (seen.has(token)) continue
      seen.add(token)
      pairs.push({ old: token, new: `${token}@${repo.sha}` })
    }
    if (!pairs.length) continue
    const { text: out, count } = rewriteRefs(text, pairs)
    if (count > 0) {
      await Bun.write(join(dir, file), out)
      rewritten += count
    }
  }
  return rewritten
}

async function gitRun(dir: string, args: string[]): Promise<{ code: number; out: string }> {
  try {
    const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
    const out = await new Response(proc.stdout).text()
    return { code: await proc.exited, out }
  } catch {
    return { code: 1, out: "" }
  }
}

async function gitOut(dir: string, args: string[]): Promise<string | undefined> {
  const run = await gitRun(dir, args)
  return run.code === 0 ? run.out : undefined
}

// —— 一次性警告登记(清单式去重,失效引用清单与迁移跳过清单共用)——
// 键 = 稳定身份(不含行号/原文等随编辑漂移的成分)。每轮以 entries 全量重写清单
// 文件——修复后自动移除,再复发视为新出现;新出现的键输出 ⚠(warn 缺省则静默
// 登记),已收录键不重复警告。entries 为空时删除清单文件。
export async function recordOnce(
  dir: string,
  file: string,
  header: string,
  entries: Array<{ key: string; warn?: string }>,
): Promise<void> {
  const text = await Bun.file(join(dir, file)).text().catch(() => "")
  const known = new Set(text.split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2)))
  for (const entry of entries) {
    if (entry.warn && !known.has(entry.key)) log(`  ⚠ ${entry.warn}`)
  }
  if (entries.length) {
    await mkdir(join(dir, dirname(file)), { recursive: true })
    const body = [...new Set(entries.map((entry) => entry.key))].sort().map((key) => `- ${key}`).join("\n")
    await Bun.write(join(dir, file), `${header}${body}\n`)
  } else {
    await rm(join(dir, file), { force: true })
  }
}

// —— 失效引用清单(.auto/invalid-refs.md)——
// 键 = `文件 → 路径(problem)`: 不含行号与原文(随编辑漂移,不能作身份)。清单每轮
// 以当前 findings 全量重写——修复后自动移除,再复发视为新出现;已收录键不再 ⚠,
// 仅对新出现的失效引用输出警告日志(防无休止重复报告,人工核验订正以此清单为入口)。
const INVALID_REFS_FILE = join(".auto", "invalid-refs.md")

function invalidRefKey(finding: RefFinding): string {
  return `${finding.file} → ${finding.path}(${finding.problem})`
}

function problemLabel(problem: "missing" | "beyond-eof"): string {
  return problem === "beyond-eof" ? "行号超出文件总行数" : "路径不存在"
}

async function recordInvalidRefs(dir: string, findings: RefFinding[]): Promise<void> {
  await recordOnce(
    dir,
    INVALID_REFS_FILE,
    "# 失效引用清单(auto 维护,供人工核验订正;已收录项不再重复警告,修复后自动移除)\n",
    findings.map((finding) => ({
      key: invalidRefKey(finding),
      warn: `失效引用 ${finding.file}:${finding.line} → ${finding.path}(${problemLabel(finding.problem)}): ${finding.text}`,
    })),
  )
}

// 提交前 auto-correct(D6 第一层,挂点 runner 的 afterSession——覆盖全部统一
// 提交): renamePairs → 活文档机械改写(只配对 rename,删除/语义变化不自动改,
// 见 §8 边界)→ 复扫 findings → 缺失恢复(refcheck-scope P2: missing 条目经
// git 历史 rename 地图追踪落点,就地改写恢复;恢复后再复扫)→ 范围再确认
// (refcheck-scope P3: 改动文件的行号锚不一致就追加 @<sha> 版本标记,改写后
// 再复扫——带标记的历史快照引用豁免行号上限校验,不再进失效清单)→ 记录失效
// 清单 .auto/invalid-refs.md(只登记未恢复的失效引用;键已收录的不再 ⚠,仅对
// 新出现的失效引用输出警告日志);verify 启用时任务产物文档(docs/T-NNN/**)的
// 失效引用另由 verifyTask 门禁拦截进修复轮,未启用时即止于本日志(宽松契约)。
// 返回复扫 findings(恢复与再确认后)。
export async function autoCorrectRefs(dir: string): Promise<RefFinding[]> {
  const pairs = await renamePairs(dir)
  if (pairs.length) {
    let rewritten = 0
    for (const file of await activeDocs(dir)) {
      const text = await Bun.file(join(dir, file)).text().catch(() => undefined)
      if (text === undefined) continue
      const { text: out, count } = rewriteRefs(text, pairs)
      if (count > 0) {
        await Bun.write(join(dir, file), out)
        rewritten += count
      }
    }
    if (rewritten) log(`  ↻ 引用 auto-correct: ${pairs.length} 组 rename 配对,改写活文档引用 ${rewritten} 处`)
  }
  let findings = await scanRefs(dir)
  const recovered = await recoverMissingRefs(dir, findings)
  if (recovered) {
    log(`  ↻ 缺失引用恢复: git 历史追踪改写 ${recovered} 处`)
    findings = await scanRefs(dir)
  }
  const reconfirmed = await reconfirmAnchors(dir)
  if (reconfirmed) {
    log(`  ↻ 引用范围再确认: ${reconfirmed} 处行号锚追加 @sha 版本标记(范围仅对标记的历史版本有效)`)
    findings = await scanRefs(dir)
  }
  await recordInvalidRefs(dir, findings)
  return findings
}

// —— P4: verify 门禁的任务产物文档预扫(§3.3 第三层) ——
// 任务产物文档范围 = docs/T-<id>/**(终审任务 T-F<k> 同法);verifyTask 在判定
// 会话前调用,findings 非空 = 确定性差距,直接进修复轮、不消耗判定会话。
export async function taskRefFindings(dir: string, id: string): Promise<RefFinding[]> {
  const docs: string[] = []
  for await (const file of new Bun.Glob(join("docs", id, "**", "*.md")).scan({ cwd: dir, onlyFiles: true })) {
    docs.push(file.split(sep).join("/"))
  }
  return docs.length ? await scanRefs(dir, docs) : []
}

// 预扫 findings → 修复轮差距文案(纯函数,供单测)。
export function formatRefGap(findings: RefFinding[]): string | undefined {
  if (!findings.length) return undefined
  const lines = findings.map((finding) => `- ${finding.file}:${finding.line} → ${finding.path}(${problemLabel(finding.problem)}): ${finding.text}`)
  return [
    "任务产物文档存在失效引用(driver 确定性预扫,引用门禁):",
    ...lines,
    "修复要求: 把失效引用更新为现行路径(目标目录根相对路径,docs/ 文档用 docs/T-NNN/… 永久路径);描述已删除/已归档/历史状态的引用行,在行内标注「已删除」「已归档」或「历史」即豁免。",
  ].join("\n")
}

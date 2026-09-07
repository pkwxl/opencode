// 引用一致性层(stable-refs 设计 §4.5,三层见 D6): extractRefs 提取文档对文档/
// 代码的路径引用(反引号 span 与 md 链接),rewriteRefs 做旧→新路径的机械改写
// (启动迁移与提交前 auto-correct 共用本原语);P4 补齐 validateRefs(存在性 +
// 行号上限)、renamePairs(git rename 配对)、活文档枚举与 scanRefs 全量扫描,
// 供 check 子命令与 verify 门禁消费。
import { stat } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import { log } from "./log"

// path = 剥离可选 `:行号` 尾锚后的引用路径;line = 尾锚行号(存在时);
// at = 引用所在行号(1 起)。
export type Ref = { path: string; line?: number; at: number }

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

// 提取规则(P1 计划 §4.2): 候选行的 token 剥离可选 `:行号` 尾锚后,须无空白且
// "含 / 或含 ."(路径状)才算引用。
export function extractRefs(text: string): Ref[] {
  const refs: Ref[] = []
  const mask = candidateMask(text)
  text.split("\n").forEach((line, i) => {
    if (!mask[i]) return
    for (const token of tokensOf(line)) {
      const anchor = /:(\d+)$/.exec(token)
      const path = anchor ? token.slice(0, -anchor[0].length) : token
      if (/\s/.test(path) || (!path.includes("/") && !path.includes("."))) continue
      refs.push(anchor ? { path, line: Number(anchor[1]), at: i + 1 } : { path, at: i + 1 })
    }
  })
  return refs
}

// 机械改写: 对每个 pair 以全路径词边界正则替换并计数(防 docs/T-1.md 误配
// docs/T-11.md、防截断半路径);同样只作用于候选行(围栏与标记行豁免)。
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
// 活文档范围(stable-refs §3.3): docs/**/*.md,排除 docs/phases/**(R5 状态文件
// 不被任何文档引用,也不参与检查);排序保证扫描与日志输出确定。
export async function activeDocs(dir: string): Promise<string[]> {
  const files: string[] = []
  for await (const file of new Bun.Glob(join("docs", "**", "*.md")).scan({ cwd: dir, onlyFiles: true })) {
    if (file.split(/[\\/]/)[1] === "phases") continue
    files.push(file.split(sep).join("/"))
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

// 校验一组引用(§3.2 校验语义: 路径存在;行号 ≤ 文件总行数)。同一文档内的
// 重复路径只校验一次;md 链接的 #fragment 尾锚剥后再验;目录引用只查存在性
// (行号锚对目录无意义,忽略)。
export async function validateRefs(dir: string, refs: Ref[]): Promise<Map<string, "missing" | "beyond-eof">> {
  const problems = new Map<string, "missing" | "beyond-eof">()
  for (const path of new Set(refs.filter((ref) => checkable(ref.path)).map((ref) => ref.path))) {
    const target = path.split("#")[0]!
    const info = await stat(join(dir, target)).catch(() => undefined)
    if (!info) {
      problems.set(path, "missing")
      continue
    }
    if (!info.isFile()) continue
    const anchors = refs.filter((item) => item.path === path && item.line !== undefined)
    if (!anchors.length) continue
    const text = await Bun.file(join(dir, target)).text().catch(() => "")
    const lines = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
    if (anchors.some((anchor) => anchor.line! > lines)) problems.set(path, "beyond-eof")
  }
  return problems
}

// 扫描一组文档(docs 缺省 = 全部活文档): 逐文档提取引用 → 校验 → 产出 findings。
export async function scanRefs(dir: string, docs?: string[]): Promise<RefFinding[]> {
  const files = docs ?? (await activeDocs(dir))
  const findings: RefFinding[] = []
  for (const file of files) {
    const text = await Bun.file(join(dir, file)).text().catch(() => undefined)
    if (text === undefined) continue
    const refs = extractRefs(text)
    if (!refs.length) continue
    const problems = await validateRefs(dir, refs)
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

// 提交前 auto-correct(D6 第一层,挂点 runner 的 afterSession——覆盖全部统一
// 提交): renamePairs → 活文档机械改写(只配对 rename,删除/语义变化不自动改,
// 见 §8 边界)→ 复扫 findings 并 ⚠ 日志;verify 启用时任务产物文档(docs/
// T-NNN/**)的失效引用另由 verifyTask 门禁拦截进修复轮,未启用时即止于本日志
// (宽松契约)。返回复扫 findings。
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
  const findings = await scanRefs(dir)
  for (const finding of findings) {
    log(`  ⚠ 失效引用 ${finding.file}:${finding.line} → ${finding.path}(${finding.problem === "beyond-eof" ? "行号超出文件总行数" : "路径不存在"}): ${finding.text}`)
  }
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
  const lines = findings.map(
    (finding) => `- ${finding.file}:${finding.line} → ${finding.path}(${finding.problem === "beyond-eof" ? "行号超出文件总行数" : "路径不存在"}): ${finding.text}`,
  )
  return [
    "任务产物文档存在失效引用(driver 确定性预扫,引用门禁):",
    ...lines,
    "修复要求: 把失效引用更新为现行路径(目标目录根相对路径,docs/ 文档用 docs/T-NNN/… 永久路径);描述已删除/已归档/历史状态的引用行,在行内标注「已删除」「已归档」或「历史」即豁免。",
  ].join("\n")
}

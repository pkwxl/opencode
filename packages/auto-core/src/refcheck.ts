// 引用一致性层(stable-refs 设计 §4.5)的 P1 子集: extractRefs 提取文档对文档的
// 路径引用(反引号 span 与 md 链接),rewriteRefs 做旧→新路径的机械改写(P4 启动
// 迁移的活文档引用改写共用本原语)。validateRefs / renamePairs / 活文档枚举属
// P4 引用检查三层,本文件暂只落基础两函数。

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

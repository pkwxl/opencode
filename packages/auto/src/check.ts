import { join } from "node:path"

// check 命令的检查逻辑: 扫描目标目录的 AGENTS.md 与 PLAN.md,报告与"验证执行权
// 在 driver"原则(见 loop.ts 的 AGENTS.md 验证原则块)相违背的描述——即要求会话
// /AI 亲自运行验证脚本或验证命令、自行下验收结论的语句。原则性/否定句("不要
// 运行…")与归属 driver 的语句不报告;匹配为启发式,报告供人工确认,不修改文件。

// 一处违背描述: 文件、行号、原文(PLAN.md 附任务 ID)。
export type Finding = { file: string; task?: string; line: number; text: string }

// AGENTS.md 中 driver 维护的 opencode-auto 块(指针块 `opencode-auto:start` 与
// 验证原则块 `opencode-auto:verify:start` 两种标记)整体跳过——块内容本身就是
// 原则表述。
const AUTO_BLOCK = /<!--\s*opencode-auto:[^\n]*?start\s*-->[\s\S]*?<!--\s*opencode-auto:[^\n]*?end\s*-->/g

// PLAN.md 的字段行(verify/verified/question/answer 等): verify 字段本身就是交给
// driver 执行的验收标准,不属于违背。
const FIELD_LINE = /^\s*-\s+[\w-]+\s*:/

// 违背特征: 执行动词 + 验证语义(中文/英文)。动词与验证词的距离收得很紧,
// 避免"执行会话链…验收""执行权原则…验证原则块"这类同句误报;排除"可执行
// (文件)"中的执行与 runVerifyScript 这类标识符内的 verify。
const VIOLATION_PATTERNS: RegExp[] = [
  /(?<!可)(运行|执行|跑)[^。\n]{0,8}(验证|验收|(?<!\w)verify)/i,
  /\b(run|execute|perform)\b[^.\n]{0,40}\b(verify|verification|acceptance)\b/i,
]

export async function checkPrinciple(dir: string): Promise<{ findings: Finding[]; notes: string[] }> {
  const findings: Finding[] = []
  const notes: string[] = []
  for (const name of ["AGENTS.md", "PLAN.md"]) {
    const text = await Bun.file(join(dir, name)).text().catch(() => undefined)
    if (text === undefined) {
      notes.push(name === "PLAN.md" ? `未找到 ${name},先运行 opencode-auto init ${dir} 生成` : `${name} 不存在,可运行 opencode-auto init ${dir} 补写指针块与验证原则块`)
      continue
    }
    // 跳过 driver 维护的 opencode-auto 块后再逐行检查。
    const cleaned = name === "AGENTS.md" ? text.replaceAll(AUTO_BLOCK, "") : text
    let task: string | undefined
    cleaned.split("\n").forEach((line, index) => {
      const heading = /^## (T-[\w-]+):/.exec(line)
      if (heading) task = heading[1]
      if (violates(line)) findings.push({ file: name, task, line: index + 1, text: line.trim() })
    })
    if (name === "AGENTS.md" && !text.includes("opencode-auto:verify:start")) {
      notes.push("AGENTS.md 缺少验证原则块,运行 opencode-auto init 可补写")
    }
  }
  return { findings, notes }
}

// 一行是否与原则相违背: 命中"执行动词 + 验证语义",且不是否定句、不归属
// driver、不是 PLAN.md 字段行。
function violates(line: string): boolean {
  if (FIELD_LINE.test(line)) return false
  // 归属 driver 的语句是合规的(原则本身就在描述 driver 的执行权)。
  if (/driver|opencode-auto/i.test(line)) return false
  for (const pattern of VIOLATION_PATTERNS) {
    const match = pattern.exec(line)
    if (!match) continue
    // 否定句(不要/不/未/不再/禁止…)描述的正是原则要求,不报告。
    const window = line.slice(Math.max(0, match.index - 4), match.index)
    if (/(不要|不得|不应|不许|不再|禁止|避免|无需|不必|别|不|未)/.test(window)) continue
    return true
  }
  return false
}

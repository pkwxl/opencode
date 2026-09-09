import { join } from "node:path"
import { LEGACY_BLOCK, renderAgentsBlock } from "./agents-block"
import { loadProjectConfig } from "./config"
import { activeDocs, gitAvailable, scanRefs, type RefFinding } from "./refcheck"
import { autoSwitches, type Switches } from "./switches"

// check 命令的检查逻辑: ①原则检查——扫描目标目录的 AGENTS.md 与 PLAN.md,报告与"验证执行权
// 在 driver""测试/编译等命令执行权在 driver"及"提交执行权在 driver"原则(见
// agents-block.ts 的 opencode-auto 单一标记块)相违背的描述——即要求会话/AI 亲自
// 运行验证脚本或验证命令、自行下验收结论,或要求会话直接运行编译/测试/构建/lint
// 等命令,或要求会话执行 git 提交的语句。原则性/否定句("不要运行…")与归属
// driver 的语句不报告;匹配为启发式,报告供人工确认,不修改文件。验证原则仅在
// config.verify 启用时成立,测试执行原则仅在 config.testByDriver 启用时成立
// (未启用时相关检查也按未启用渲染比对,不影响块存在性);提交原则始终成立。
// ②引用检查(stable-refs P4,D6 第二层): 全量活文档(docs/**/*.md,排除
// docs/phases/**)扫描失效引用(路径不存在 / 行号超出文件总行数),命中经 refs
// 并入 CLI 报文(退出码 1);目标目录缺 opencode-auto 块或非 git(auto-correct 不可用)
// 给 note。受 OPENCODE_AUTO_REF_CHECK 管控(refcheck-scope-design D3,缺省
// off 静默空转,refs 恒空、不给引用相关 note)。

// AGENTS.md 维护规则(见 agents-block.ts MAINT_RULE)第 1 条的行数上限;超限由
// check 输出 note 提示精简。
const AGENTS_LINE_LIMIT = 150

// 一处违背描述: 文件、行号、原文(PLAN.md 附任务 ID)。
export type Finding = { file: string; task?: string; line: number; text: string }

// AGENTS.md 中 driver 维护的 opencode-auto 块(单一标记块 `opencode-auto:start`,
// 及可能残留的旧版带名块)整体跳过——块内容本身就是原则表述。
const AUTO_BLOCK = /<!--\s*opencode-auto:[^\n]*?start\s*-->[\s\S]*?<!--\s*opencode-auto:[^\n]*?end\s*-->/g

// PLAN.md 的字段行(verify/verified/question/answer 等): verify 字段本身就是交给
// driver 执行的验收标准,不属于违背。
const FIELD_LINE = /^\s*-\s+[\w-]+\s*:/

// 验证类违背特征(仅 config.verify 启用时检查): 执行动词 + 验证语义(中文/英文)。
// 动词与验证词的距离收得很紧,避免"执行会话链…验收""执行权原则…验证原则块"这类
// 同句误报;排除"可执行(文件)"中的执行与 runVerifyScript 这类标识符内的 verify。
const VERIFY_PATTERNS: RegExp[] = [
  /(?<!可)(运行|执行|跑)[^。\n]{0,8}(验证|验收|(?<!\w)verify)/i,
  /\b(run|execute|perform)\b[^.\n]{0,40}\b(verify|verification|acceptance)\b/i,
]

// 测试/编译类违背特征(仅 config.testByDriver 启用时检查): 执行动词 + 编译/测试/
// 构建/lint 语义。与验证类同距离收紧,避免同句误报。
const TEST_PATTERNS: RegExp[] = [
  /(?<!可)(运行|执行|跑)[^。\n]{0,8}(编译|测试|单元测试|构建|lint)/i,
  /\b(run|execute|perform)\b[^.\n]{0,40}\b(build|compile|tests?|lint)\b/i,
]

// 提交类违背特征(始终检查): 会话内跑 git add/commit 或"提交全部/所有改动"类指令
// (统一提交由 driver 在会话后执行);"提交信息/提交 SHA"等名词性表述不匹配。
const COMMIT_PATTERNS: RegExp[] = [/\bgit\s+(add|commit)\b/i, /提交(全部|所有|一次)?(未提交)?(改动|变更|代码)/]

export async function checkPrinciple(
  dir: string,
  switches: Switches = autoSwitches(),
): Promise<{ findings: Finding[]; notes: string[]; refs: RefFinding[]; verifyOn: boolean; testOn: boolean }> {
  const findings: Finding[] = []
  const notes: string[] = []
  let verifyOn = false
  let testOn = false
  try {
    const config = await loadProjectConfig(dir)
    verifyOn = config.verify
    testOn = config.testByDriver
  } catch (error) {
    notes.push(`⚠ 项目配置(.opencode/auto/config.json)非法,验证/测试原则检查按未启用处理: ${error instanceof Error ? error.message : String(error)}`)
  }
  const patterns = [
    ...(verifyOn ? VERIFY_PATTERNS : []),
    ...(testOn ? TEST_PATTERNS : []),
    ...COMMIT_PATTERNS,
  ]
  for (const name of ["AGENTS.md", "PLAN.md"]) {
    const text = await Bun.file(join(dir, name)).text().catch(() => undefined)
    if (text === undefined) {
      notes.push(
        name === "PLAN.md"
          ? `未找到 ${name},先运行 opencode-auto init ${dir} 生成`
          : `${name} 不存在,可运行 opencode-auto init ${dir} 补写 opencode-auto 块`,
      )
      continue
    }
    // 跳过 driver 维护的 opencode-auto 块后再逐行检查。
    const cleaned = name === "AGENTS.md" ? text.replaceAll(AUTO_BLOCK, "") : text
    let task: string | undefined
    cleaned.split("\n").forEach((line, index) => {
      const heading = /^## (T-[\w-]+):/.exec(line)
      if (heading) task = heading[1]
      if (violates(line, patterns)) findings.push({ file: name, task, line: index + 1, text: line.trim() })
    })
    if (name === "AGENTS.md") {
      if (!text.includes("opencode-auto:start")) {
        notes.push("AGENTS.md 缺少 opencode-auto 块,运行 opencode-auto init 可补写")
      } else {
        if (!text.includes(renderAgentsBlock({ verify: verifyOn, testByDriver: testOn }))) {
          notes.push("AGENTS.md 的 opencode-auto 块内容与当前配置不一致(过期),运行 opencode-auto init/run 可刷新")
        }
        const legacyCount = [...text.matchAll(LEGACY_BLOCK)].length
        if (legacyCount) {
          notes.push(`AGENTS.md 中检测到 ${legacyCount} 个旧版/多余 opencode-auto 标记块,运行 opencode-auto init/run 可清理`)
        }
      }
    }
    // 维护规则块第 1 条(≤150 行)的唯一机器观测点: 超限仅提示,不进 findings、
    // 不影响退出码。
    if (name === "AGENTS.md") {
      const lines = text.trimEnd().split("\n").length
      if (lines > AGENTS_LINE_LIMIT) {
        notes.push(`AGENTS.md 当前 ${lines} 行,超过 ${AGENTS_LINE_LIMIT} 行上限(维护规则块第 1 条),建议按规则精简并把细节路由到 docs/agents/`)
      }
    }
  }
  // 引用检查(P4): 活文档存在才扫描与给 note(无 docs/ 的目录引用机制尚无对象)。
  // OPENCODE_AUTO_REF_CHECK=off(缺省)时整段空转——静默,verbose 可查开关全量。
  let refs: RefFinding[] = []
  if (switches.refCheck) {
    const docs = await activeDocs(dir)
    refs = docs.length ? await scanRefs(dir, docs) : []
    if (docs.length && !(await gitAvailable(dir))) {
      notes.push("非 git 目标目录: 提交前引用 auto-correct(rename 改写)不可用,引用检查仅做校验")
    }
  }
  return { findings, notes, refs, verifyOn, testOn }
}

// 一行是否与原则相违背: 命中"执行动词 + 验证语义"(verify 启用时)或"会话执行
// git 提交",且不是否定句、不归属 driver、不是 PLAN.md 字段行。
function violates(line: string, patterns: RegExp[]): boolean {
  if (FIELD_LINE.test(line)) return false
  // 归属 driver 的语句是合规的(原则本身就在描述 driver 的执行权)。
  if (/driver|opencode-auto/i.test(line)) return false
  for (const pattern of patterns) {
    const match = pattern.exec(line)
    if (!match) continue
    // 否定句(不要/不/未/不再/禁止…)描述的正是原则要求,不报告。
    const window = line.slice(Math.max(0, match.index - 4), match.index)
    if (/(不要|不得|不应|不许|不再|禁止|避免|无需|不必|别|不|未)/.test(window)) continue
    return true
  }
  return false
}

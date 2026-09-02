#!/usr/bin/env bun
import { stat } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import { checkPrinciple } from "./check"
import { formatProjectConfig, legacyModeFallback, loadProjectConfig, mergeProjectConfig, saveProjectConfig, type ProjectConfig } from "./config"
import { log, setInteractive, setLogFile, setVerbose } from "./log"
import { ensureGitignore, ensurePointer, runAll } from "./loop"
import { loadModes, type ModeSpec } from "./mode"
import { load, parse } from "./plan"
import { formatPhases, parsePhases, phaseText, readLedger } from "./phases"
import type { PermissionMode, SubtaskMode } from "./runner"
import { usePromptLibrary, renderText } from "./template"
import templatePlan from "../templates/PLAN.md" with { type: "file" }
import templateScaffold from "../templates/PLAN.scaffold.md" with { type: "file" }
import templateConfig from "../templates/opencode.json" with { type: "file" }
import templateAgent from "../templates/.opencode/agent/auto.md" with { type: "file" }

const args = process.argv.slice(2)
const command = args[0]

const flags = new Map<string, string>()
const positional: string[] = []
// --agent/--server/--wait-answer/--wait-between/--context-limit/--commit/--subtask/
// --prompt/--review/--early-review/--permission/--idle-time/--idle-max/--mode/
// --final-review/--phases/--source-dir/--source-path 带值(吞掉下一个 token);
// --verbose/--interactive/--dryrun/--early/--verify/--test-by-driver/--handover-test
// 是布尔选项,出现即 true,仅当紧随字面量 true/false 时才吞掉它。均支持
// --flag=value;--prompt 另有短选项 -p,--interactive 另有短选项 -i(布尔,不吞值),
// --mode 另有短选项 -m(镜像 -p 的吞值规则)。
const VALUE_FLAGS = new Set([
  "agent",
  "server",
  "wait-answer",
  "wait-between",
  "context-limit",
  "commit",
  "subtask",
  "prompt",
  "review",
  "early-review",
  "permission",
  "idle-time",
  "idle-max",
  "mode",
  "final-review",
  "phases",
  "source-dir",
  "source-path",
])
const BOOLEAN_FLAGS = new Set(["verbose", "interactive", "dryrun", "early", "verify", "test-by-driver", "handover-test"])
for (let i = 1; i < args.length; i++) {
  const arg = args[i]!
  if (arg === "-i") {
    flags.set("interactive", "")
    continue
  }
  if (arg === "-p") {
    const next = args[i + 1]
    if (next !== undefined) {
      flags.set("prompt", next)
      i++
    } else {
      flags.set("prompt", "")
    }
    continue
  }
  if (arg === "-m") {
    const next = args[i + 1]
    if (next !== undefined) {
      flags.set("mode", next)
      i++
    } else {
      flags.set("mode", "")
    }
    continue
  }
  if (!arg.startsWith("--")) {
    positional.push(arg)
    continue
  }
  const eq = arg.indexOf("=")
  if (eq !== -1) {
    flags.set(arg.slice(2, eq), arg.slice(eq + 1))
    continue
  }
  const key = arg.slice(2)
  const next = args[i + 1]
  if ((VALUE_FLAGS.has(key) && next !== undefined) || (BOOLEAN_FLAGS.has(key) && (next === "true" || next === "false"))) {
    flags.set(key, next)
    i++
    continue
  }
  flags.set(key, "")
}
const directory = resolve(positional[0] ?? ".")

if (command === "run") {
  // 已固化选项(设计文档 §C): 宪法级项目属性经 init 固化到
  // .opencode/auto/config.json,run 出现即用法错误(镜像 --commit-subtask
  // 移除的既有先例);修订走 init amend 或直接编辑配置文件。
  // 看门狗键已由 --verify-idle/--verify-max 更名为 --idle-time/--idle-max(现同时
  // 控制 verify 与 test 脚本执行),旧名出现即单独提示更名。
  for (const key of ["verify-idle", "verify-max"]) {
    if (flags.has(key)) {
      const renamed = key === "verify-idle" ? "idle-time" : "idle-max"
      console.error(`--${key} 已更名为 --${renamed}(现同时控制 verify 与 test 脚本执行的看门狗)。变更方式: opencode-auto init <dir> --${renamed} <值>,或直接编辑 .opencode/auto/config.json`)
      process.exit(1)
    }
  }
  for (const key of ["mode", "agent", "context-limit", "subtask", "verify", "idle-time", "idle-max", "commit", "phases", "source-dir", "source-path"]) {
    if (flags.has(key)) {
      const flag = key === "mode" ? "-m/--mode" : `--${key}`
      const fix =
        key === "source-dir" || key === "source-path"
          ? "opencode-auto init <dir> --source-dir <目录> --source-path <相对路径>"
          : `opencode-auto init <dir> ${key === "mode" ? "-m" : `--${key}`} <值>`
      console.error(`${flag} 已在 init 固化(.opencode/auto/config.json)。变更方式: ${fix},或直接编辑该文件`)
      process.exit(1)
    }
  }
  if (flags.has("commit-subtask")) {
    console.error("--commit-subtask 已移除: 提交现在由 driver 在每个会话结束后统一执行(收回 AI 提交权),如需关闭用 opencode-auto init <dir> --commit false")
    process.exit(1)
  }
  const verbose = flags.has("verbose") && flags.get("verbose") !== "false"
  // --interactive/-i: 旁路交互(与 --verbose 互斥);文件保持 verbose 级完整记录,
  // 前台不显示 verbose 明细,常驻 stdin 接收人工输入注入当前会话。
  const interactive = flags.has("interactive") && flags.get("interactive") !== "false"
  if (interactive && verbose) {
    console.error("--interactive/-i 与 --verbose 互斥,只能选其一")
    process.exit(1)
  }
  setVerbose(verbose)
  if (interactive) setInteractive()
  // 每次 run 都在目标目录 .auto/logs/ 下新建日志文件,同步记录全部输出。
  log(`📝 日志文件: ${setLogFile(directory)}`)
  const waitAnswer = parseMinutes(flags.get("wait-answer"))
  if (waitAnswer === null) {
    console.error("--wait-answer 取值范围为 1..60(分钟);不带值时默认为 1")
    process.exit(1)
  }
  const waitBetween = parseMinutes(flags.get("wait-between"))
  if (waitBetween === null) {
    console.error("--wait-between 取值范围为 1..60(分钟);不带值时默认为 1")
    process.exit(1)
  }
  const review = parseReviewLimit(flags.get("review"))
  if (review === null) {
    console.error("--review 取值范围为 1..10(质量审核轮数上限);不带值时默认为 3")
    process.exit(1)
  }
  // --early-review [n] 是 --review n --early 的快捷糖;与 --review 同时出现为
  // 用法错误(消除歧义)。
  const earlyReview = parseReviewLimit(flags.get("early-review"))
  if (earlyReview === null) {
    console.error("--early-review 取值范围为 1..10(质量审核轮数上限);不带值时默认为 3")
    process.exit(1)
  }
  if (flags.has("review") && flags.has("early-review")) {
    console.error("--early-review 是 --review n --early 的快捷糖,不要与 --review 同时使用")
    process.exit(1)
  }
  // --early: 把 --review 的审核会话挪进 verify 脚本执行窗口并行(设计文档 F 节);
  // 是布尔修饰,review 未启用时单独出现为用法错误。--early/--early-review 只作用于
  // 逐任务审核窗口,与 --final-review 终审闭环无交互、可同现。
  const early = (flags.has("early") && flags.get("early") !== "false") || earlyReview > 0
  if (early && review <= 0 && earlyReview <= 0) {
    console.error("--early 需搭配 --review 一起使用(或改用快捷糖 --early-review)")
    process.exit(1)
  }
  // --final-review: 终审闭环的审计轮上限(含首轮 audit,即 audit→remediate→
  // validate 的最大循环次数);可与 --review 组合(逐任务审核照常 + 终审闭环)。
  const finalReview = parseFinalReviewLimit(flags.get("final-review"))
  if (finalReview === null) {
    console.error("--final-review 取值范围为 1..5(终审审计轮数上限);不带值时默认为 2")
    process.exit(1)
  }
  const permission = parsePermission(flags.get("permission"))
  if (permission === null) {
    console.error("--permission 取值为 auto-allow|ask-allow|ask-deny|ask-fail;缺省为 ask-deny")
    process.exit(1)
  }
  // --test-by-driver: 测试执行协议(与 verify 三段式正交)——执行类会话(子任务/
  // 整任务/修复轮)不在会话内直接运行测试,把测试脚本写入 tmp/test.sh 由 driver
  // 执行,输出按序归档 tmp/test.<n>.out/err 并 steer 回原会话由 AI 直读判断。
  // --handover-test(需 --test-by-driver): 测试失败且会话上下文达到上限时,要求
  // AI 写交接文档后换新会话续跑,防止超大上下文中反复试错。
  const testByDriver = flags.has("test-by-driver") && flags.get("test-by-driver") !== "false"
  const handoverTest = flags.has("handover-test") && flags.get("handover-test") !== "false"
  if (handoverTest && !testByDriver) {
    console.error("--handover-test 需搭配 --test-by-driver 一起使用")
    process.exit(1)
  }
  // 项目配置(.opencode/auto/config.json)是宪法级选项的唯一来源;坏文件为环境
  // 错误退出 1(严格失败优于静默回落)。文件缺失取缺省并做 legacy 回落
  // (.auto/config.json 的 mode,仅提示、不迁移)。
  let config: ProjectConfig
  try {
    config = await loadProjectConfig(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  if (await legacyModeFallback(directory)) log("ℹ 模式沿用旧位置 .auto/config.json 的持久化值,重跑 init 可固化完整配置")
  if (testByDriver) {
    log(
      `⚙ 测试由 driver 执行(--test-by-driver): 会话写 tmp/test.sh 请求执行,输出按序归档 tmp/test.<n>.out/err 并反馈回会话判断` +
        (handoverTest ? ";测试失败且上下文达上限时写交接文档换新会话(--handover-test)" : ""),
    )
  }
  const modes = loadModeTable(directory)
  const mode = modes[config.mode]
  if (!mode) {
    console.error(`配置的 mode "${config.mode}" 未注册(当前支持: ${Object.keys(modes).join(", ")});修订方式: opencode-auto init <dir> -m <值>,或直接编辑 .opencode/auto/config.json`)
    process.exit(1)
  }
  log(`⚙ 项目配置(.opencode/auto/config.json): ${formatProjectConfig(config)}`)
  // 阶段进度行(B.2,与 status 共用 formatPhases;✓=台账已记录,▶=当前,其余=未
  // 开始);台账非法仅提示,runAll 的阶段路由会以环境错误退出 1。
  if (config.phases !== "m") {
    try {
      log(`阶段: ${formatPhases(config.phases, (await readLedger(directory)).done)}`)
    } catch (error) {
      log(`⚠ 阶段台账(docs/phases.md)非法: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const code = await runAll(directory, {
    // agent 契约、验收/提交语义、上下文预算等来自配置文件(init 生成);
    // agent 缺省为 init 生成的自主执行契约,存在性由 run 前完整性检查兜底。
    agent: config.agent,
    server: flags.get("server"),
    // interactive 隐含 verbose 记录级别(watch/变更文件监视照常运行并写入日志)。
    verbose: verbose || interactive,
    waitAnswer,
    waitBetween,
    commit: config.commit,
    subtask: config.subtask,
    dryrun: flags.has("dryrun") && flags.get("dryrun") !== "false",
    contextLimit: config.contextLimit * 1000,
    review: earlyReview > 0 ? earlyReview : review,
    early,
    verify: config.verify,
    permission,
    interactive,
    idleMs: config.idleTime * 60_000,
    maxMs: config.idleMax > 0 ? config.idleMax * 60_000 : undefined,
    mode,
    finalReview,
    phases: config.phases,
    source: config.source,
    testByDriver,
    handoverTest,
  })
  process.exit(code)
}

// --commit 缺省/裸选项/true = 启用(会话后统一提交);false 与旧值 none = 关闭。
// 旧的 subtask/task/once 档已随"收回 AI 提交权、driver 统一提交"一并移除。
// 返回 null 表示取值非法。
function parseCommit(flags: Map<string, string>): boolean | null {
  const raw = flags.get("commit")
  if (raw === undefined || raw === "" || raw === "true") return true
  if (raw === "false" || raw === "none") return false
  return null
}

// --subtask 缺省/裸选项 = auto;返回 null 表示取值非法。
function parseSubtask(raw: string | undefined): SubtaskMode | null {
  if (raw === undefined || raw === "") return "auto"
  if (raw === "off" || raw === "auto" || raw === "ondemand") return raw
  return null
}

// --permission 缺省/裸选项 = ask-deny;返回 null 表示取值非法。
function parsePermission(raw: string | undefined): PermissionMode | null {
  if (raw === undefined || raw === "") return "ask-deny"
  if (raw === "auto-allow" || raw === "ask-allow" || raw === "ask-deny" || raw === "ask-fail") return raw
  return null
}

// --wait-answer/--wait-between 缺省(无此选项)= 0(不等待);裸选项 = 默认 1 分钟;
// 返回 null 表示取值非法。
function parseMinutes(raw: string | undefined): number | null {
  if (raw === undefined) return 0
  if (raw === "") return 1
  const minutes = Number(raw)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) return null
  return minutes
}

// --context-limit 缺省/裸选项 = 64(千 tokens);返回 null 表示取值非法。
function parseContextLimit(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return 64
  const limit = Number(raw)
  if (!Number.isInteger(limit) || limit < 1) return null
  return limit
}

// --review/--early-review 缺省(无此选项)= 0(不启用质量审核);裸选项 = 3;显式值
// 须为 1..10 整数;返回 null 表示取值非法。
function parseReviewLimit(raw: string | undefined): number | null {
  if (raw === undefined) return 0
  if (raw === "") return 3
  const limit = Number(raw)
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) return null
  return limit
}

// --final-review 缺省(无此选项)= 0(不启用终审闭环);裸选项 = 2;显式值须为
// 1..5 整数(审计轮上限,含首轮 audit);返回 null 表示取值非法。
function parseFinalReviewLimit(raw: string | undefined): number | null {
  if (raw === undefined) return 0
  if (raw === "") return 2
  const limit = Number(raw)
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) return null
  return limit
}

// --idle-time 缺省/裸选项 = 10(分钟);显式值须为 1..120 整数;返回 null 表示非法。
function parseIdleTime(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return 10
  const minutes = Number(raw)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) return null
  return minutes
}

// --idle-max 缺省/裸选项 = 0(不设绝对上限);显式值须为 1..1440 整数(分钟);
// 返回 null 表示取值非法。
function parseIdleMax(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return 0
  const minutes = Number(raw)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return null
  return minutes
}

// 装载模式注册表(内置 + 目标目录 .opencode/auto/modes/ 覆盖);模式文件不合法
// 时打印错误并以退出码 1 终止。init 与 run 共用。
function loadModeTable(directory: string): Record<string, ModeSpec> {
  try {
    return loadModes(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

if (command === "init") {
  // 项目宪法选项在 init 固化(设计文档 §B): 仅写命令行显式给出的键,未给出的
  // 键保留既有配置(新项目取内置缺省)→ init 兼具创建与修订(amend)两种身份,
  // 重复 init 无参数不重置已有配置。值域校验复用既有 parse*(与配置文件侧
  // validateProjectConfig 同源)。
  if (flags.has("commit-subtask")) {
    console.error("--commit-subtask 已移除: 提交现在由 driver 在每个会话结束后统一执行(收回 AI 提交权),如需关闭用 --commit false")
    process.exit(1)
  }
  for (const key of ["verify-idle", "verify-max"]) {
    if (flags.has(key)) {
      const renamed = key === "verify-idle" ? "idle-time" : "idle-max"
      console.error(`--${key} 已更名为 --${renamed}(现同时控制 verify 与 test 脚本执行的看门狗)`)
      process.exit(1)
    }
  }
  const commit = parseCommit(flags)
  if (commit === null) {
    console.error("--commit 取值为 true|false(none 为 false 别名);缺省 true,driver 在每个会话结束后统一提交全部改动")
    process.exit(1)
  }
  const subtask = parseSubtask(flags.get("subtask"))
  if (subtask === null) {
    console.error("--subtask 取值为 off|auto|ondemand;缺省为 auto")
    process.exit(1)
  }
  const contextLimit = parseContextLimit(flags.get("context-limit"))
  if (contextLimit === null) {
    console.error("--context-limit 取值为正整数(单位: 千 tokens);缺省为 64")
    process.exit(1)
  }
  // --idle-time: driver 托管脚本(verify 与 test)的无进度判定窗口(两个输出
  // 文件持续无增长即终止);--idle-max: 绝对时长上限(0 = 不设,只要持续有输出
  // 就永不限时)。
  const idleTime = parseIdleTime(flags.get("idle-time"))
  if (idleTime === null) {
    console.error("--idle-time 取值范围为 1..120(分钟);缺省为 10")
    process.exit(1)
  }
  const idleMax = parseIdleMax(flags.get("idle-max"))
  if (idleMax === null) {
    console.error("--idle-max 取值范围为 1..1440(分钟);缺省不设上限")
    process.exit(1)
  }
  // --phases: 阶段化流程(设计文档 docs/phases-design.md);"m"(缺省)= 无阶段
  // 声明,单次运行,行为不变。台账非空时的前缀护栏见下(已完成的阶段必须构成
  // 新值的前缀,防止 amend 把流程状态打成不可推导)。
  let phases: string | undefined
  if (flags.has("phases")) {
    const parsed = parsePhases(flags.get("phases") ?? "")
    if (!parsed) {
      console.error(`--phases 取值须为 admtvk 的子序列且包含 m(如 m、amt、admtvk),当前: "${flags.get("phases") ?? ""}"`)
      process.exit(1)
    }
    phases = parsed.join("")
  }
  // --source-dir/--source-path: 迁移源参数,必须成对给出(拒绝 <src-dir>/<src-path>
  // 拼接形式);存在性只在 init 校验,run 不再校验(源系统可能已下线)。
  let source: { dir: string; path: string } | undefined
  if (flags.has("source-dir") || flags.has("source-path")) {
    if (!flags.has("source-dir") || !flags.has("source-path")) {
      console.error("--source-dir 与 --source-path 必须成对给出: 源系统目录与源模块相对路径")
      process.exit(1)
    }
    const sourceDir = flags.get("source-dir")!
    const sourcePath = flags.get("source-path")!
    if (!sourceDir.trim() || !sourcePath.trim()) {
      console.error("--source-dir 与 --source-path 须为非空值")
      process.exit(1)
    }
    if (isAbsolute(sourcePath) || sourcePath.split(/[\\/]+/).includes("..")) {
      console.error("--source-path 须为不含 .. 的相对路径(相对 --source-dir)")
      process.exit(1)
    }
    const dirIsDir = await stat(sourceDir).then((s) => s.isDirectory()).catch(() => false)
    const pathExists = await stat(join(sourceDir, sourcePath)).then(() => true).catch(() => false)
    if (!dirIsDir || !pathExists) {
      console.error(`--source-dir 须为现存目录且 --source-path 在其下存在: ${sourceDir} 与 ${sourcePath}`)
      process.exit(1)
    }
    source = { dir: sourceDir, path: sourcePath }
  }
  // 仅显式给出的键进入合并: --verify/--commit/--subtask 等裸选项取各自缺省档,
  // 未出现的选项不覆盖既有配置。
  const explicit: Partial<ProjectConfig> = {}
  if (flags.has("agent")) explicit.agent = flags.get("agent")
  if (flags.has("verify")) explicit.verify = flags.get("verify") !== "false"
  if (flags.has("commit")) explicit.commit = commit
  if (flags.has("subtask")) explicit.subtask = subtask
  if (flags.has("context-limit")) explicit.contextLimit = contextLimit
  if (flags.has("idle-time")) explicit.idleTime = idleTime
  if (flags.has("idle-max")) explicit.idleMax = idleMax
  if (phases !== undefined) explicit.phases = phases
  if (source !== undefined) explicit.source = source
  let existing: ProjectConfig
  try {
    existing = await loadProjectConfig(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  // 阶段台账(docs/phases.md)是推导式状态载体;非法即环境错误退出 1(报文给
  // 人工修订指引)。台账非空时显式改 --phases 须满足前缀护栏。
  let ledgerDone: string
  try {
    ledgerDone = (await readLedger(directory)).done.join("")
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  if (flags.has("phases") && ledgerDone && !phases!.startsWith(ledgerDone)) {
    console.error(
      `--phases 新值 "${phases}" 与阶段台账(docs/phases.md)不兼容: 台账已记录完成阶段 "${ledgerDone}",须构成新值的前缀。` +
        "请改用以其为前缀的值,或按 README 的人工回退规程修订台账后再变更",
    )
    process.exit(1)
  }
  // -m/--mode 解析(缩减版,init 侧): 优先级 显式值 > 既有配置值 > 缺省;
  // 未注册名为用法错误(报文列出当前支持的模式)。
  const modeName = flags.get("mode") ?? existing.mode
  const modes = loadModeTable(directory)
  if (!modes[modeName]) {
    console.error(`--mode 取值须为已注册的模式(当前支持: ${Object.keys(modes).join(", ")});缺省为 migrate`)
    process.exit(1)
  }
  const config = mergeProjectConfig(existing, { ...explicit, mode: modeName })
  try {
    await saveProjectConfig(directory, config)
  } catch (error) {
    console.error(`写出 .opencode/auto/config.json 失败: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  console.log(`⚙ 项目配置(.opencode/auto/config.json): ${formatProjectConfig(config)}`)
  // v(验收)阶段与 config.verify 正交: v 阶段任务自身即检验、不受影响,但 m/t
  // 等阶段任务的任务级三段式验收依赖 config.verify;含 v 而未启用时提示一次,不强制。
  if (config.phases.includes("v") && !config.verify) {
    console.log("ℹ phases 含 v(验收)阶段而任务级验收未启用: v 阶段任务自身即检验、不受影响,其余阶段任务将不做任务级三段式验收(如需启用: opencode-auto init <dir> --verify true)")
  }
  // 提示词库: 装载目标目录 .opencode/auto/prompts/ 覆盖(协议校验失败即退出);
  // 无 -p 时不渲染提示词,提前装载可在 init 阶段就暴露覆盖问题。
  try {
    usePromptLibrary(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  // `type: "file"` 导入会被嵌入编译产物,保证独立二进制可用。阶段化流程
  // (phases ≠ "m")下 PLAN.md 用空模板(规划会话填充,B.1),不写占位任务。
  const templates: Record<string, string> = {
    "PLAN.md": config.phases === "m" ? templatePlan : templateScaffold,
    "opencode.json": templateConfig,
    ".opencode/agent/auto.md": templateAgent,
  }
  for (const [file, source] of Object.entries(templates)) {
    const target = resolve(directory, file)
    const raw = await Bun.file(source).text()
    // PLAN.md 与 agent 契约按 config.verify 条件渲染: 未启用任务级验收时,
    // 产出物不含 verify 相关描述(verify 字段示例、driver 验收语义等)。
    const content = file === "opencode.json" ? raw : renderText(raw, { verify: config.verify })
    const existing = await Bun.file(target).text().catch(() => undefined)
    // 阶段化流程下占位模板态(从未编辑过的 <任务标题> 占位任务)视为缺失:
    // 切换 --phases 时替换为空模板,交给阶段规划会话填充。
    const stale = file === "PLAN.md" && config.phases !== "m" && existing !== undefined && isPristinePlan(existing)
    if (existing !== undefined && !stale && (existing === content || file !== ".opencode/agent/auto.md")) {
      console.log(`跳过已存在: ${file}`)
      continue
    }
    await Bun.write(target, content)
    console.log(existing === undefined ? `已创建: ${file}` : stale ? `已替换(占位模板换为空模板,由阶段规划会话填充): ${file}` : `已替换(与模板不一致): ${file}`)
  }
  // 幂等维护 AGENTS.md 的 opencode-auto 块: 指针块、验证原则块、提交原则块与
  // 维护规则块各自独立、只追加;验证原则块仅 config.verify 启用时补写,
  // 未启用时移除已存在的块(验收机制不存在,AGENTS.md 不保留其描述)。
  const ensured = await ensurePointer(directory, { verify: config.verify })
  console.log(ensured.pointer ? "已补写: AGENTS.md 指针块" : "跳过已存在: AGENTS.md 指针块")
  if (config.verify) {
    console.log(ensured.principle ? "已补写: AGENTS.md 验证原则块" : "跳过已存在: AGENTS.md 验证原则块")
  } else if (ensured.principleRemoved) {
    console.log("已移除: AGENTS.md 验证原则块(任务级验收未启用)")
  }
  console.log(ensured.commit ? "已补写: AGENTS.md 提交原则块" : "跳过已存在: AGENTS.md 提交原则块")
  console.log(ensured.maint ? "已补写: AGENTS.md 维护规则块" : "跳过已存在: AGENTS.md 维护规则块")
  if (await ensureGitignore(directory)) console.log("已更新: .gitignore 忽略 tmp/ 与 .auto/(driver 工作目录与运行时状态)")

  // -p/--prompt: 项目意图文本写入 .opencode/auto/brief.md(版本化、随仓库共享、
  // 人工可编辑,amend 语义——重复 init -p 覆盖重写),由每个阶段的规划会话消费。
  // init 不再启动任何 AI 会话(设计文档 phases-design.md §B.1: 规划必须感知
  // 各阶段产物,从 init 挪到 run 的阶段边界)。
  const promptText = flags.get("prompt")
  if (promptText !== undefined) {
    if (!promptText.trim()) {
      console.error("-p/--prompt 需要非空的提示词文本")
      process.exit(1)
    }
    await Bun.write(join(directory, ".opencode", "auto", "brief.md"), promptText.trimEnd() + "\n")
    console.log("已写入: .opencode/auto/brief.md(项目意图,阶段规划会话消费;重复 init -p 覆盖重写)")
  }
  // 结束语按 phases 分两态: "m" 维持"编辑 PLAN.md"现状;阶段化流程下 PLAN.md
  // 由阶段规划会话填充,不提示手工编辑。
  if (config.phases === "m") {
    console.log(promptText !== undefined ? `brief 已记录,运行: opencode-auto run ${directory} 开始任务规划` : `编辑 PLAN.md 填入任务后运行: opencode-auto run ${directory}`)
    process.exit(0)
  }
  const current = parsePhases(config.phases)!.find((phase) => !ledgerDone.includes(phase))
  console.log(
    `${promptText !== undefined ? "brief 已记录," : ""}运行: opencode-auto run ${directory}${current ? ` 开始 ${current}(${phaseText(current)})阶段规划` : "(全部阶段已完成)"}`,
  )
  process.exit(0)
}

// check: 启发式检查 AGENTS.md 与 PLAN.md 中是否有与"提交执行权在 driver"原则
// (及 verify 启用时的"验证执行权在 driver"原则)相违背的描述;命中退出码 1,
// 供人工修订。验证类检查是否启用由 checkPrinciple 依配置决定,verifyOn 仅用于
// 调整报文措辞。
if (command === "check") {
  const { findings, notes, verifyOn } = await checkPrinciple(directory)
  console.log(`检查 ${directory}: ${verifyOn ? "验证/提交执行权原则" : "提交执行权原则"}(验证类检查${verifyOn ? "已启用" : "未启用,任务级验收关闭"})`)
  for (const note of notes) console.log(`ℹ ${note}`)
  if (!findings.length) {
    console.log(`✓ 未发现与${verifyOn ? "验证/提交" : "提交"}原则相违背的描述`)
    process.exit(0)
  }
  for (const finding of findings) {
    console.log(`⚠ ${finding.file}${finding.task ? `(${finding.task})` : ""}:${finding.line}: ${finding.text}`)
  }
  console.log(`发现 ${findings.length} 处可能违背原则的描述(启发式检查,请人工确认后修订${verifyOn ? ";验收标准统一写在任务的 verify 字段" : ""})`)
  process.exit(1)
}

if (command === "status") {
  // 任务清单前打印配置摘要;配置非法仅提示、不阻塞任务列表(缺失取缺省,
  // 同样打印摘要)。阶段化流程(phases ≠ "m")另打印阶段进度行(B.3,✓=台账
  // 已记录,▶=当前,其余=未开始);台账缺失/非法同样仅提示不阻塞。
  try {
    const config = await loadProjectConfig(directory)
    console.log(`⚙ 项目配置(.opencode/auto/config.json): ${formatProjectConfig(config)}`)
    if (config.phases !== "m") {
      try {
        console.log(`阶段: ${formatPhases(config.phases, (await readLedger(directory)).done)}`)
      } catch (error) {
        console.log(`⚠ 阶段台账(docs/phases.md)非法: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } catch (error) {
    console.log(`⚠ 项目配置(.opencode/auto/config.json) 非法: ${error instanceof Error ? error.message : String(error)}`)
  }
  const plan = await load(resolve(directory, "PLAN.md"))
  for (const task of plan.tasks) {
    const extra = task.attempts ? ` (attempts: ${task.attempts})` : ""
    console.log(`[${task.status}] ${task.id} ${task.title}${extra}`)
  }
  process.exit(0)
}

// 占位模板态判定(B.1): PLAN.md 仅含从未编辑的占位任务(标题仍为 <任务标题>、
// 全部 pending、零 attempts、无任何字段写入)——阶段化流程切换 --phases 时把该
// 状态视为缺失,替换为空模板交阶段规划会话填充。解析失败同样视为非占位态(保留)。
function isPristinePlan(text: string): boolean {
  try {
    const tasks = parse("PLAN.md", text).tasks
    return tasks.length > 0 && tasks.every((task) => task.title === "<任务标题>" && task.status === "pending" && !task.attempts && !task.verify && !task.verified && !task.question)
  } catch {
    return false
  }
}

console.error(`用法:
  opencode-auto init [dir] [-p|--prompt <brief-text>] [-m|--mode <name>] [--agent <name>] [--subtask [off|auto|ondemand]] [--verify [true|false]] [--idle-time [1-120]] [--idle-max [1-1440]] [--commit [true|false]] [--context-limit [n]] [--phases <admtvk 子序列含 m>] [--source-dir <dir> --source-path <相对路径>]
  opencode-auto run [dir] [--server <url>] [--verbose [true|false]] [--interactive|-i] [--wait-answer [1-60]] [--wait-between [1-60]] [--permission [auto-allow|ask-allow|ask-deny|ask-fail]] [--review [1-10]] [--early] [--early-review [1-10]] [--final-review [1-5]] [--test-by-driver] [--handover-test] [--dryrun [true|false]]
  opencode-auto check [dir]
  opencode-auto status [dir]

选项: 项目宪法选项(-m/--mode、--agent、--context-limit、--subtask、--verify、--idle-time、--idle-max、--commit、--phases、--source-dir/--source-path)经 init 固化到 .opencode/auto/config.json(版本化、随仓库共享、人工可编辑;重复 init 无参数不重置已有配置,仅显式给出的键被改写),run 出现即用法错误
      -m/--mode 提示词级场景模式(内置 migrate;目标目录 .opencode/auto/modes/<name>.md 可新增或覆盖,新增模式无需改源码)
      -p/--prompt 项目意图文本,写入 .opencode/auto/brief.md,由阶段规划会话消费(init 不启动 AI 会话)
      --phases <admtvk 子序列含 m> 阶段化流程(a 分析 → d 设计 → m 迁移实现 → t 测试 → v 验收 → k 知识提炼;"m" 缺省 = 单次运行;台账非空时修订须满足前缀护栏,详见 README)
      --source-dir <dir> --source-path <相对路径> 迁移源参数(源系统目录 + 源模块相对路径,必须成对给出;init 时校验存在性)
      --verify [true] 启用 driver 的任务级三段式验收(缺省不启用,任务收尾后直接标 done;--review 的质量审核改为串行执行)
      --commit [true] 会话后统一提交(缺省启用: 任何会话结束且 driver 完成状态写入后,driver 递归提交全部改动,git 历史即 AI 变更的审计轨迹;false 关闭)
      --final-review [1-5] 任务全部完成后进入终审闭环(audit → remediate → validate → finalize,validate 差距回退 audit;值为审计轮上限,裸选项 2;可与 --review 组合;终审任务本身即检验,强制不做任务级验收与逐任务审核)
      --test-by-driver 测试执行协议(与 --verify 正交): 执行类会话不在会话内直接运行测试,把测试脚本写入 tmp/test.sh 由 driver 执行,输出按序归档 tmp/test.<n>.out/err 并反馈回会话由 AI 判断
      --handover-test 需搭配 --test-by-driver: 测试失败且会话上下文达到上限时,要求 AI 写交接文档(docs/<任务>.testhandoff.md)后换新会话续跑,防止在超大上下文中反复试错

退出码: 0 全部完成,1 用法/环境错误(check 发现违背原则的描述时同),2 阻塞/未完成等待人工介入(含终审闭环熔断),130 被连续两次 Ctrl+C 强制终止`)
process.exit(1)

#!/usr/bin/env bun
// 专用二次迁移工具(设计文档 docs/specialized-tool-design.md): 无子命令,直接执行
// 主程序——前置知识提取 → 参数推断 → 二次迁移(默认完整 admtvk,复杂度评估
// simple 轮自动裁剪为 mtvk),自动推进至结束;中断后
// 再次运行从断点恢复。关键参数(mode/source/dest/verify 等)首次运行时固化进
// .opencode/auto/config.json;二次执行与首次运行对齐——显式给出且与固化值不一致
// 即用法错误(退出码 1),修订通道为直接编辑配置文件。
import { stat } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import { CONFIG_DEFAULTS, legacyModeFallback, loadProjectConfig, mergeProjectConfig, saveProjectConfig, type ProjectConfig } from "@opencode-ai/auto-core/config"
import { setInteractive, setLogFile, setVerbose } from "@opencode-ai/auto-core/log"
import { loadModes, type ModeSpec } from "@opencode-ai/auto-core/mode"
import type { PermissionMode, SubtaskMode } from "@opencode-ai/auto-core/runner"
import { setShellProfile } from "@opencode-ai/auto-core/shell"
import { runTool } from "./tool"

// 外壳画像(migrate 简易壳): 报文程序名/契约恢复指引/日志审计语义参数化注入——
// 报文程序名 auto-migrate;agent 契约缺失提示重新运行本工具即可(启动时按
// 模板重建默认契约);run 日志始终完整记录(免 --verbose 的审计语义)。
setShellProfile({ program: "auto-migrate", bin: "auto-migrate", agentRecovery: "startup", auditLog: true })

const args = process.argv.slice(2)

// 旧子命令已随去子命令化移除: 首参数命中即报错并指向新用法。
if (["init", "continue", "run", "check", "status"].includes(args[0] ?? "")) {
  console.error(`子命令 ${args[0]} 已移除: 本工具无子命令,直接运行 auto-migrate [dir] 即可(断点恢复与续轮归档自动处理)`)
  process.exit(1)
}

const flags = new Map<string, string>()
const positional: string[] = []
// --agent/--server/--wait-answer/--wait-between/--context-limit/--commit/--subtask/
// --prompt/--review/--early-review/--permission/--idle-time/--idle-max/--mode/
// --final-review/--source-dir/--source-path/--dest-dir/--next-path 带值(吞掉下一个
// token);--verbose/--interactive/--dryrun/--early/--verify/--test-by-driver/
// --handover-test/--new-session 是布尔选项,出现即 true,仅当紧随字面量 true/false
// 时才吞掉它。均支持 --flag=value;--prompt 另有短选项 -p,--interactive 另有短
// 选项 -i(布尔,不吞值),--mode 另有短选项 -m(镜像 -p 的吞值规则)。
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
  "source-dir",
  "source-path",
  "dest-dir",
  "next-path",
  // 已移除/更名的历史选项同样吞掉紧随的值,使拦截报文不被位置参数干扰。
  "phases",
  "verify-idle",
  "verify-max",
])
const BOOLEAN_FLAGS = new Set(["verbose", "interactive", "dryrun", "early", "verify", "test-by-driver", "handover-test", "new-session"])
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!
  if (arg === "-i") {
    flags.set("interactive", "")
    continue
  }
  if (arg === "-p" || arg === "-m") {
    const key = arg === "-p" ? "prompt" : "mode"
    const next = args[i + 1]
    if (next !== undefined) {
      flags.set(key, next)
      i++
    } else {
      flags.set(key, "")
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
// 未知选项拦截: 白名单(值选项∪布尔选项∪help 与历史拦截项)之外的旗标一律报错
// 退出 1,防拼错被静默忽略(如 --next-path 误写为 --next);近似名给出提示。
const KNOWN_FLAGS = new Set([...VALUE_FLAGS, ...BOOLEAN_FLAGS, "help", "continue", "commit-subtask"])
for (const key of flags.keys()) {
  if (KNOWN_FLAGS.has(key)) continue
  const similar = key ? [...KNOWN_FLAGS].filter((name) => name.startsWith(key)).map((name) => `--${name}`) : []
  console.error(`未知选项 --${key}${similar.length ? `(是否想用 ${similar.join(" / ")}?)` : ""};运行 --help 查看全部选项`)
  process.exit(1)
}
if (positional.length > 1) {
  console.error(`用法: auto-migrate [dir] [选项](只接受一个目录参数,当前: ${positional.join(" ")})`)
  process.exit(1)
}
const directory = resolve(positional[0] ?? ".")

if (flags.has("help")) {
  console.log(usageText())
  process.exit(0)
}

// 历史选项拦截: 流程默认 admtvk,续轮/提交粒度/看门狗更名等旧概念已不存在。
if (flags.has("phases")) {
  console.error("--phases 已移除: 流程默认为完整 admtvk(分析 → 设计 → 迁移实现 → 测试 → 验收 → 知识提炼),简单轮经前置知识复杂度评估自动裁剪")
  process.exit(1)
}
if (flags.has("continue")) {
  console.error("--continue 已移除: 续轮由主程序自动处理——上一轮完整时自动归档并开启新一轮,直接重新运行即可")
  process.exit(1)
}
if (flags.has("commit-subtask")) {
  console.error("--commit-subtask 已移除: 提交由 driver 在每个会话结束后统一执行;如需关闭用 --commit false(首次运行时固化)")
  process.exit(1)
}
for (const key of ["verify-idle", "verify-max"]) {
  if (flags.has(key)) {
    const renamed = key === "verify-idle" ? "idle-time" : "idle-max"
    console.error(`--${key} 已更名为 --${renamed}(现同时控制 verify 与 test 脚本执行的看门狗)`)
    process.exit(1)
  }
}

// —— 关键参数解析(首次运行固化;parse* 与原 init 同源,非法取值退出码 1)——

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

// --next-path: 轮间修订指令(非固化参数,不进首跑固化与二次冲突比对)——前一轮
// 彻底完成后修订 source.path 开启新一轮迁移。值域与互斥先于其他迁移参数校验:
// 非空、相对、不含 ..;与首跑固化参数(--source-dir/--source-path/--dest-dir)及
// --dryrun 互斥(过渡会清理并改写工作目录,违反 dryrun 契约)。
let nextPath: string | undefined
if (flags.has("next-path")) {
  const value = flags.get("next-path")!
  if (!value.trim() || isAbsolute(value) || value.split(/[\\/]+/).includes("..")) {
    console.error("--next-path 须为不含 .. 的非空相对路径(相对既有 --source-dir)")
    process.exit(1)
  }
  if (flags.has("source-dir") || flags.has("source-path") || flags.has("dest-dir")) {
    console.error("--next-path 与 --source-dir/--source-path/--dest-dir 互斥: 后者是首次运行的固化参数,前者是轮间修订指令")
    process.exit(1)
  }
  if (flags.has("dryrun") && flags.get("dryrun") !== "false") {
    console.error("--next-path 与 --dryrun 互斥: 开启新一轮会清理并改写工作目录")
    process.exit(1)
  }
  nextPath = value
}

// --source-dir/--source-path/--dest-dir: 迁移参数。布局约定: 位置参数是 driver
// 工作目录,迁移源在 <工作目录>/<source-dir>(source-path 为其下的模块相对路径)、
// 迁移目标在 <工作目录>/<dest-dir>。source 两键必须成对给出;三者均须为不含 ..
// 的相对路径。缺失时由主程序的参数推断会话自动推断(见 tool.ts)。
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
  if (isAbsolute(sourceDir) || sourceDir.split(/[\\/]+/).includes("..")) {
    console.error("--source-dir 须为工作目录下的相对路径(不含 ..): 迁移源位于 <工作目录>/<source-dir>")
    process.exit(1)
  }
  if (isAbsolute(sourcePath) || sourcePath.split(/[\\/]+/).includes("..")) {
    console.error("--source-path 须为不含 .. 的相对路径(相对 --source-dir)")
    process.exit(1)
  }
  source = { dir: sourceDir, path: sourcePath }
}
let destDir: string | undefined
if (flags.has("dest-dir")) {
  const dest = flags.get("dest-dir")!
  if (!dest.trim()) {
    console.error("--dest-dir 须为非空值")
    process.exit(1)
  }
  if (isAbsolute(dest) || dest.split(/[\\/]+/).includes("..")) {
    console.error("--dest-dir 须为工作目录下的相对路径(不含 ..): 迁移目标位于 <工作目录>/<dest-dir>")
    process.exit(1)
  }
  destDir = dest
}

// 仅显式给出的键进入固化/冲突比对: 裸选项取各自缺省档。
const explicit: Partial<ProjectConfig> = {}
if (flags.has("agent")) explicit.agent = flags.get("agent")
if (flags.has("verify")) explicit.verify = flags.get("verify") !== "false"
if (flags.has("commit")) explicit.commit = commit
if (flags.has("subtask")) explicit.subtask = subtask
if (flags.has("context-limit")) explicit.contextLimit = contextLimit
if (flags.has("idle-time")) explicit.idleTime = idleTime
if (flags.has("idle-max")) explicit.idleMax = idleMax
if (source !== undefined) explicit.source = source
if (destDir !== undefined) explicit.destDir = destDir
if (flags.has("test-by-driver")) explicit.testByDriver = flags.get("test-by-driver") !== "false"
if (flags.has("handover-test")) explicit.handoverTest = flags.get("handover-test") !== "false"

const promptText = flags.get("prompt")
if (promptText !== undefined && !promptText.trim()) {
  console.error("-p/--prompt 需要非空的提示词文本")
  process.exit(1)
}

// —— 运行级参数(每次生效,不固化)——
// 解析与校验必须先于下面的固化块: 否则非法取值会在首次运行时留下已写盘的配置。

const verbose = flags.has("verbose") && flags.get("verbose") !== "false"
// --interactive/-i: 旁路交互(与 --verbose 互斥);文件保持 verbose 级完整记录,
// 前台不显示 verbose 明细,常驻 stdin 接收人工输入注入当前会话。
const interactive = flags.has("interactive") && flags.get("interactive") !== "false"
if (interactive && verbose) {
  console.error("--interactive/-i 与 --verbose 互斥,只能选其一")
  process.exit(1)
}
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
// --early-review [n] 是 --review n --early 的快捷糖;与 --review 同时出现为用法错误。
const earlyReview = parseReviewLimit(flags.get("early-review"))
if (earlyReview === null) {
  console.error("--early-review 取值范围为 1..10(质量审核轮数上限);不带值时默认为 3")
  process.exit(1)
}
if (flags.has("review") && flags.has("early-review")) {
  console.error("--early-review 是 --review n --early 的快捷糖,不要与 --review 同时使用")
  process.exit(1)
}
const early = (flags.has("early") && flags.get("early") !== "false") || earlyReview > 0
if (early && review <= 0 && earlyReview <= 0) {
  console.error("--early 需搭配 --review 一起使用(或改用快捷糖 --early-review)")
  process.exit(1)
}
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
// --new-session: 中断恢复时跳过会话复用(每次生效、不固化),阶段精确重入保留。
const newSession = flags.has("new-session") && flags.get("new-session") !== "false"

// —— 配置固化(首跑)或冲突校验(二次运行起)——

const modes = loadModeTable(directory)
const firstRun = !(await Bun.file(join(directory, ".opencode", "auto", "config.json")).exists())
// --next-path 依赖前一轮完成标记与已固化配置,首跑无效(先于固化写盘拒绝,新
// 目录不留任何盘上痕迹)。
if (firstRun && nextPath !== undefined) {
  console.error("--next-path 用于前一轮完成后的新一轮迁移,首次运行无效(直接运行即可)")
  process.exit(1)
}
let config: ProjectConfig
let modeName: string
if (firstRun) {
  // 首次运行: 显式键 + 缺省固化(phases 恒定 admtvk);mode 优先级 显式值 > 旧
  // .auto/config.json 回落 > 缺省 migrate。source 显式给出时校验存在性(与推断
  // 会话的产物校验同款: 目录现存、模块路径在其下存在,stat 跟随软链接)。
  modeName = flags.get("mode") ?? (await legacyModeFallback(directory)) ?? CONFIG_DEFAULTS.mode
  if (!modes[modeName]) {
    console.error(`--mode 取值须为已注册的模式(当前支持: ${Object.keys(modes).join(", ")});缺省为 migrate`)
    process.exit(1)
  }
  if (source) {
    const dirIsDir = await stat(join(directory, source.dir)).then((s) => s.isDirectory(), () => false)
    const pathExists = await stat(join(directory, source.dir, source.path)).then(() => true, () => false)
    if (!dirIsDir || !pathExists) {
      console.error(`--source-dir 须为工作目录下现存目录且 --source-path 在其下存在: ${source.dir} 与 ${source.path}(也可以都不给,由主程序自动推断)`)
      process.exit(1)
    }
  }
  if (explicit.handoverTest && !(explicit.testByDriver ?? CONFIG_DEFAULTS.testByDriver)) {
    console.error("--handover-test 需搭配 --test-by-driver 一起使用: 测试交接只在测试由 driver 执行时才有意义")
    process.exit(1)
  }
  config = mergeProjectConfig({ ...CONFIG_DEFAULTS, phases: "admtvk", autoNumber: true }, { ...explicit, mode: modeName })
  try {
    await saveProjectConfig(directory, config)
  } catch (error) {
    console.error(`写出 .opencode/auto/config.json 失败: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  console.log(`⚙ 已固化项目配置(.opencode/auto/config.json): 二次执行的关键参数以此为准`)
} else {
  // 二次运行起: 关键参数与首次运行对齐——显式给出且与固化值不一致即用法错误
  // (报文含生效值;修订通道为直接编辑配置文件)。
  try {
    config = await loadProjectConfig(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  modeName = config.mode
  const conflicts: string[] = []
  const checks: Array<[string, unknown, unknown]> = [
    ["-m/--mode", flags.has("mode") ? flags.get("mode") : undefined, config.mode],
    ["--agent", explicit.agent, config.agent],
    ["--verify", explicit.verify, config.verify],
    ["--commit", explicit.commit, config.commit],
    ["--subtask", explicit.subtask, config.subtask],
    ["--context-limit", explicit.contextLimit, config.contextLimit],
    ["--idle-time", explicit.idleTime, config.idleTime],
    ["--idle-max", explicit.idleMax, config.idleMax],
    ["--test-by-driver", explicit.testByDriver, config.testByDriver],
    ["--handover-test", explicit.handoverTest, config.handoverTest],
    ["--source-dir/--source-path", explicit.source, config.source],
    ["--dest-dir", explicit.destDir, config.destDir],
  ]
  for (const [flag, given, effective] of checks) {
    if (given === undefined) continue
    if (JSON.stringify(given) === JSON.stringify(effective)) continue
    conflicts.push(`${flag}: 首次固化值 ${JSON.stringify(effective)},本次 ${JSON.stringify(given)}`)
  }
  if (conflicts.length) {
    console.error(
      `关键参数与首次运行固化的配置不一致,二次执行须与首次运行对齐:\n  ${conflicts.join("\n  ")}\n` +
        "如需变更请直接编辑 .opencode/auto/config.json(缺失的迁移参数也可留给主程序自动推断)",
    )
    process.exit(1)
  }
  // --next-path 轮间修订的前置: 依赖已固化的迁移源;新模块须在
  // <工作目录>/<source-dir>/<next-path> 存在(stat 跟随软链接,与首跑 --source
  // 校验同款)。均先于 runTool 的任何写盘。
  if (nextPath !== undefined) {
    if (!config.source) {
      console.error("--next-path 依赖已固化的迁移源(--source-dir): 配置缺失,请先完成一轮迁移或编辑 .opencode/auto/config.json")
      process.exit(1)
    }
    const pathExists = await stat(join(directory, config.source.dir, nextPath)).then(() => true, () => false)
    if (!pathExists) {
      console.error(`--next-path 在迁移源下不存在: ${config.source.dir}/${nextPath}`)
      process.exit(1)
    }
  }
}
const mode = modes[modeName]!

setVerbose(verbose)
if (interactive) setInteractive()
// 每次运行都在目标目录 .auto/logs/ 下新建日志文件,同步记录全部输出。
console.log(`📝 日志文件: ${setLogFile(directory)}`)

const code = await runTool(directory, {
  config,
  mode,
  firstRun,
  brief: promptText,
  server: flags.get("server"),
  verbose: verbose || interactive,
  waitAnswer,
  waitBetween,
  review: earlyReview > 0 ? earlyReview : review,
  early,
  permission,
  interactive,
  dryrun: flags.has("dryrun") && flags.get("dryrun") !== "false",
  finalReview,
  newSession,
  nextPath,
})
process.exit(code)

// --commit 缺省/裸选项/true = 启用(会话后统一提交);false 与旧值 none = 关闭。
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
// 时打印错误并以退出码 1 终止。
function loadModeTable(directory: string): Record<string, ModeSpec> {
  try {
    return loadModes(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

// 用法文本(函数声明提升,--help 检查在顶部即可引用)。
function usageText(): string {
  return `用法:
  auto-migrate [dir] [关键参数...] [运行参数...]

专用二次迁移工具: 基于已有迁移结果先做一轮前置知识提取(docs/prior-kb/),再自动
推进一轮二次迁移(默认完整 admtvk:分析 → 设计 → 迁移实现 → 测试 → 验收 → 知识
提炼;简单轮经复杂度评估自动裁剪为 mtvk)
至结束;中断后再次运行自动从断点恢复,全部完成后再次运行报告已完成(删除
.auto/tool.json 可显式开启新一轮)。

关键参数(首次运行时固化到 .opencode/auto/config.json;二次执行与首次运行对齐,
显式给出且不一致即报错,修订请直接编辑该文件):
  -p|--prompt <brief-text>   项目意图文本,写入 .opencode/auto/brief.md(每次运行均可重写)
  -m|--mode <name>           提示词级场景模式(内置 migrate;.opencode/auto/modes/<name>.md 可新增或覆盖)
  --agent <name>             执行契约 agent(缺省 auto,启动时按模板生成)
  --source-dir <dir> --source-path <相对路径>  迁移源(须成对;不给则由主程序依据知识提取结果自动推断)
  --dest-dir <相对路径>      迁移目标目录(不给则自动推断)
  --subtask [off|auto|ondemand]  子任务模式(缺省 auto)
  --verify [true|false]      driver 的任务级三段式验收(缺省不启用)
  --test-by-driver [true|false] / --handover-test [true|false]  测试执行协议(后者需前者)
  --context-limit [n]        上下文预算(千 tokens,缺省 64)
  --idle-time [1-120] / --idle-max [1-1440]  driver 托管脚本看门狗(分钟)
  --commit [true|false]      会话后统一提交(缺省启用)

运行参数(每次生效,不固化):
  --server <url>             复用已有 opencode server(缺省自动 spawn)
  --verbose [true|false] / --interactive|-i  明细输出 / 旁路交互(互斥)
  --wait-answer [1-60] / --wait-between [1-60]  人工等待(分钟)
  --permission [auto-allow|ask-allow|ask-deny|ask-fail]  权限请求策略(缺省 ask-deny)
  --review [1-10] / --early / --early-review [1-10]  质量审核
  --final-review [1-5]       终审闭环(仅 m 阶段挂接)
  --dryrun [true|false]      只跑权限预检,不执行任务
  --new-session [true|false] 中断恢复时跳过会话复用,开新会话继续(阶段精确重入保留)
  --next-path <相对路径>     前一轮完成后开启下一轮迁移(新模块相对既有 --source-dir 的路径)

退出码: 0 全部完成(含"此前已完成"),1 用法/环境错误,2 阻塞等待人工介入,130 连续两次 Ctrl+C 强制终止`
}

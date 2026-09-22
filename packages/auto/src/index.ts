#!/usr/bin/env bun
import { stat } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import { checkPrinciple } from "@opencode-ai/auto-core/check"
import { checkCleanTree } from "@opencode-ai/auto-core/clean"
import { confirm } from "@opencode-ai/auto-core/confirm"
import { CONFIG_DEFAULTS, formatProjectConfig, legacyModeFallback, loadProjectConfig, mergeProjectConfig, saveProjectConfig, type ProjectConfig } from "@opencode-ai/auto-core/config"
import { implementPlan } from "@opencode-ai/auto-core/implement"
import { log, setInteractive, setLogFile, setVerbose } from "@opencode-ai/auto-core/log"
import { ensureGitignore, ensurePointer, runAll } from "@opencode-ai/auto-core/loop"
import { loadModes, type ModeSpec } from "@opencode-ai/auto-core/mode"
import { applyReset, formatResetPlan, planReset } from "@opencode-ai/auto-core/reset"
import {
  currentRound,
  doneTypes,
  establishRound,
  formatPhases,
  legacyLayoutProblem,
  nextRound,
  parsePhases,
  phaseIndexPath,
  phaseLabel,
  readPhases,
  type PhaseState,
} from "@opencode-ai/auto-core/phases"
import { loadPhaseTypes } from "@opencode-ai/auto-core/phases/custom"
import { PRESET_FORM, phasesProblem, type PhaseTypeEntry } from "@opencode-ai/auto-core/phases/registry"
import { renderStatus } from "@opencode-ai/auto-core/status"
import { loadPlan } from "@opencode-ai/auto-core/tasks"
import type { PermissionMode, SubtaskMode } from "@opencode-ai/auto-core/runner"
import { usePromptLibrary, renderText } from "@opencode-ai/auto-core/template"
import templateConfig from "@opencode-ai/auto-core/templates/opencode.json" with { type: "file" }
import templateAgent from "@opencode-ai/auto-core/templates/.opencode/agent/auto.md" with { type: "file" }

const args = process.argv.slice(2)
const command = args[0]

const flags = new Map<string, string>()
const positional: string[] = []
// --agent/--server/--wait-answer/--wait-between/--context-limit/--commit/--subtask/
// --prompt/--permission/--idle-time/--idle-max/--mode/--phases/--source-dir/
// --source-path/--dest-dir/--implement-file/--implement-prompt 带值(吞掉下一个
// token);--verbose/--interactive/--dryrun/--test-by-driver/
// --handover-test/--new-session/--auto-number/--no-auto-number/--wrapup/--no-wrapup
// 是布尔选项,出现即
// true,仅当紧随字面量 true/false 时才吞掉它。均支持
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
  "permission",
  "idle-time",
  "idle-max",
  "mode",
  "phases",
  "source-dir",
  "source-path",
  "dest-dir",
  "implement-file",
  "implement-prompt",
])
const BOOLEAN_FLAGS = new Set(["verbose", "interactive", "dryrun", "test-by-driver", "handover-test", "new-session", "auto-number", "no-auto-number", "wrapup", "no-wrapup", "amend", "force"])
for (let i = 1; i < args.length; i++) {
  const arg = args[i]!
  if (arg === "-i") {
    flags.set("interactive", "")
    continue
  }
  if (arg === "-f") {
    flags.set("force", "")
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
// 未知选项拦截: 白名单之外的旗标一律报错退出 1,防拼错被静默忽略。宪法级与
// 历史选项对 init/continue/run 有专属拦截报文,此处放行交由其后各自处理;
// check/status 不接受任何选项,出现旗标即拒绝。
// 完成侧三机制退役(D13): 旗标出现即用法错误(镜像 --commit false 退役口径),放行进
// 白名单以便给出专属报文而非"unknown option"。
const RETIRED_FLAGS = ["verify", "review", "early", "early-review", "final-review"]
const KNOWN_FLAGS = new Set([...VALUE_FLAGS, ...BOOLEAN_FLAGS, ...RETIRED_FLAGS, "continue", "commit-subtask", "verify-idle", "verify-max"])
const FLAGLESS = command === "check" || command === "status"
// reset 是反初始化,没有可配置项: 只接受 -f/--force(跳过确认与工作区干净度闸门)。
const RESET_FLAGS = new Set(["force"])
for (const key of flags.keys()) {
  if (command === "reset") {
    if (RESET_FLAGS.has(key)) continue
    console.error(`unknown option --${key}: reset only accepts a directory argument and -f/--force`)
    process.exit(1)
  }
  if (!FLAGLESS && KNOWN_FLAGS.has(key)) continue
  const similar = !FLAGLESS && key ? [...KNOWN_FLAGS].filter((name) => name.startsWith(key)).map((name) => `--${name}`) : []
  console.error(`unknown option --${key}${similar.length ? ` (did you mean ${similar.join(" / ")}?)` : ""}${FLAGLESS ? ": check/status only accept a directory argument, no options" : "; run opencode-auto without a subcommand to see usage"}`)
  process.exit(1)
}
for (const key of RETIRED_FLAGS) {
  if (flags.has(key)) {
    console.error(
      `--${key} is retired: the driver no longer runs task-level acceptance, quality review or a final review. ` +
        `Plan the checking as tasks (for example the v acceptance phase); a task report whose result line reads "Result: FAIL" stops the run`,
    )
    process.exit(1)
  }
}
const directory = resolve(positional[0] ?? ".")

// Legacy layout (M3.7, auto-core plans/0047 R3): an old-layout project is a
// usage error before init/continue writes anything, status reads anything or
// run starts (runAll repeats the check for other shells). reset and check stay
// available so an old tree can still be de-initialized or inspected.
if (command === "init" || command === "continue" || command === "status" || command === "run") {
  const legacy = await legacyLayoutProblem(directory)
  if (legacy) {
    console.error(legacy)
    process.exit(1)
  }
}

if (command === "run") {
  // 已固化选项(设计文档 §C): 宪法级项目属性经 init 固化到
  // .opencode/auto/config.json,run 出现即用法错误(镜像 --commit-subtask
  // 移除的既有先例);修订走 init amend 或直接编辑配置文件。
  // 看门狗键已由 --verify-idle/--verify-max 更名为 --idle-time/--idle-max(现控制
  // test 脚本执行),旧名出现即单独提示更名。
  for (const key of ["verify-idle", "verify-max"]) {
    if (flags.has(key)) {
      const renamed = key === "verify-idle" ? "idle-time" : "idle-max"
      console.error(`--${key} was renamed to --${renamed} (the driver-run script watchdog). To change: opencode-auto init <dir> --${renamed} <value>, or edit .opencode/auto/config.json directly`)
      process.exit(1)
    }
  }
  for (const key of ["mode", "agent", "context-limit", "subtask", "idle-time", "idle-max", "commit", "test-by-driver", "handover-test", "auto-number", "no-auto-number", "wrapup", "no-wrapup", "phases", "source-dir", "source-path", "dest-dir"]) {
    if (flags.has(key)) {
      const flag = key === "mode" ? "-m/--mode" : `--${key}`
      const fix =
        key === "source-dir" || key === "source-path"
          ? "opencode-auto init <dir> --source-dir <dir> --source-path <relative-path>"
          : key === "auto-number" || key === "no-auto-number"
            ? "opencode-auto init <dir> --auto-number (use --no-auto-number to turn off)"
            : key === "wrapup" || key === "no-wrapup"
              ? "opencode-auto init <dir> --wrapup (use --no-wrapup to turn off)"
              : `opencode-auto init <dir> ${key === "mode" ? "-m" : `--${key}`} <value>`
      console.error(`${flag} was frozen by init (.opencode/auto/config.json). To change: ${fix}, or edit that file directly`)
      process.exit(1)
    }
  }
  if (flags.has("commit-subtask")) {
    console.error("--commit-subtask removed: commits are now made by the driver after every session ends (AI commit rights revoked), and can no longer be turned off (--commit false is retired)")
    process.exit(1)
  }
  // --amend/--force 是 init/reset 专用: 前者切回增量修订语义,后者跳过覆盖确认
  // 与工作区干净度闸门;run 不写配置、不做破坏性覆盖,两者都无意义。
  if (flags.has("amend")) {
    console.error("--amend is an init-only option (switches back to incremental amend semantics, only changing keys explicitly given on the command line); run does not accept it")
    process.exit(1)
  }
  if (flags.has("force")) {
    console.error("-f/--force is an init/reset-only option (skips overwrite confirmation and worktree cleanliness checks); run does not accept it")
    process.exit(1)
  }
  // --implement-file/--implement-prompt 是 init 专用的单阶段(m)快捷模式选项
  // (计划生成会话是一次性的,产物任务单元经人工审核后另行调用 run 执行),不是
  // run 的选项。
  for (const key of ["implement-file", "implement-prompt"]) {
    if (flags.has(key)) {
      console.error(`--${key} is an init-only shortcut-mode option: use it to generate the task units (tasks.md + docs/T-NNN/todo.md), review them manually, then call opencode-auto run ${directory} to execute; run itself does not accept this option`)
      process.exit(1)
    }
  }
  // 续轮迁移是独立子命令(continue),不是任何命令的选项。
  if (flags.has("continue")) {
    console.error("--continue is not an option: round continuation uses the dedicated subcommand opencode-auto continue <dir> (starts a new round after the previous phased migration round fully completes)")
    process.exit(1)
  }
  const verbose = flags.has("verbose") && flags.get("verbose") !== "false"
  // --interactive/-i: 旁路交互(与 --verbose 互斥);文件保持 verbose 级完整记录,
  // 前台不显示 verbose 明细,常驻 stdin 接收人工输入注入当前会话。
  const interactive = flags.has("interactive") && flags.get("interactive") !== "false"
  if (interactive && verbose) {
    console.error("--interactive/-i and --verbose are mutually exclusive; pick one")
    process.exit(1)
  }
  setVerbose(verbose)
  if (interactive) setInteractive()
  // 每次 run 都在目标目录 .auto/logs/ 下新建日志文件,同步记录全部输出。
  log(`📝 log file: ${setLogFile(directory)}`)
  const waitAnswer = parseMinutes(flags.get("wait-answer"))
  if (waitAnswer === null) {
    console.error("--wait-answer takes 1..60 (minutes); defaults to 1 when given without a value")
    process.exit(1)
  }
  const waitBetween = parseMinutes(flags.get("wait-between"))
  if (waitBetween === null) {
    console.error("--wait-between takes 1..60 (minutes); defaults to 1 when given without a value")
    process.exit(1)
  }
  const permission = parsePermission(flags.get("permission"))
  if (permission === null) {
    console.error("--permission takes auto-allow|ask-allow|ask-deny|ask-fail; defaults to ask-deny")
    process.exit(1)
  }
  // 项目配置(.opencode/auto/config.json)是宪法级选项的唯一来源;坏文件为环境
  // 错误退出 1(严格失败优于静默回落)。文件缺失取缺省并做 legacy 回落
  // (.auto/config.json 的 mode,仅提示、不迁移)。testByDriver/handoverTest 同为
  // 宪法级选项,run 不再接受(已在上文拒绝清单拦截),这里从 config 读取。
  let config: ProjectConfig
  try {
    config = await loadProjectConfig(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  if (await legacyModeFallback(directory)) log("ℹ mode taken from the legacy persisted value in .auto/config.json; re-run init to freeze the full config")
  if (config.testByDriver) {
    log(
      `⚙ tests run by the driver: sessions put scripts in test/ and write the script path to tmp/test.sh to request execution; the driver merges stdout/stderr into tmp/test.<n>.out and feeds it back to the session` +
        (config.handoverTest ? "; on test failure with context at its cap, a handover document switches to a fresh session" : ""),
    )
  }
  const modes = loadModeTable(directory)
  const mode = modes[config.mode]
  if (!mode) {
    console.error(`configured mode "${config.mode}" is not registered (currently supported: ${Object.keys(modes).join(", ")}); to fix: opencode-auto init <dir> -m <value>, or edit .opencode/auto/config.json directly`)
    process.exit(1)
  }
  log(`⚙ project config (.opencode/auto/config.json): ${formatProjectConfig(config)}`)
  // 阶段进度行(B.2,与 status 共用 phasesLine;✓=已完成,▶=当前,其余=未开始);
  // 续轮(docs/R-NN 轮次目录最大号 > 1)时带轮次标注。阶段索引缺失/非法仅提示,
  // runAll 的阶段路由会以环境错误退出 1。
  if (config.phases !== "m") log(await phasesLine(directory))
  const code = await runAll(directory, {
    // agent 契约、提交语义、上下文预算等来自配置文件(init 生成);
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
    permission,
    interactive,
    idleMs: config.idleTime * 60_000,
    maxMs: config.idleMax > 0 ? config.idleMax * 60_000 : undefined,
    mode,
    phases: config.phases,
    source: config.source,
    destDir: config.destDir,
    testByDriver: config.testByDriver,
    handoverTest: config.handoverTest,
    autoNumber: config.autoNumber,
    wrapup: config.wrapup,
    // --new-session: 中断恢复时不复用被中断的旧会话(仅跳过复用,阶段精确重入保留)。
    newSession: flags.has("new-session") && flags.get("new-session") !== "false",
  })
  process.exit(code)
}

// --commit 缺省/裸选项/true = 启用(会话后统一提交)。false 与旧值 none 已于
// 2026-09-15 退役(plans/0021-commit-boundary-design.md): 统一提交是完成条件,单元基线、
// 恢复保真回滚等机制全部以"提交恒开"为前提,关闭档与之冲突——出现即用法错误。
// 旧的 subtask/task/once 档已随"收回 AI 提交权、driver 统一提交"一并移除。
// 返回 null 表示取值非法(含已退役的关闭档)。
function parseCommit(flags: Map<string, string>): boolean | null {
  const raw = flags.get("commit")
  if (raw === undefined || raw === "" || raw === "true") return true
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

if (command === "init" || command === "continue") {
  // 项目宪法选项在 init 固化(设计文档 §B): 缺省为**无状态全量覆盖**——产出的
  // config.json 仅由本次执行传入的参数决定,未给出的键一律回落内置缺省,不与磁盘
  // 上的旧配置做任何增量合并。于是「干净环境跑一次无参 init」与「带参 init 之后
  // 再跑一次无参 init」产出逐字节一致,单次 init 即可得到确定状态,无需前置清理。
  // 值域校验复用既有 parse*(与配置文件侧 validateProjectConfig 同源)。
  //
  // --amend 显式切回旧的增量修订语义(只改命令行显式给出的键,其余保留既有配置),
  // 供「只想改一个字段又不想重述全部参数」的场景;continue 恒为 amend(下方 base)。
  //
  // continue 子命令(续轮迁移,设计文档 plans/0006-phases-design.md M 节)= init 的
  // amend 语义 + 轮首建立新一轮轮次目录: 上一轮阶段化迁移全部完成后开启新一轮,
  // 让迁移结果与源更加完整、一致。复用 init 的解析/合并/模板与标记块维护,差异
  // 仅在: ① 前置校验(既有 phases ≠ "m" 且阶段索引全部完成);② 轮首建立
  // (establishRound: 建 docs/R-(N+1)/ 与阶段索引、各阶段目录、AGENTS.md.bak
  // 快照);③ 迁移同一性选项(-m/--mode 与迁移参数)跨轮固定,显式给出即用法错误。
  if (command === "init" && flags.has("continue")) {
    console.error("--continue is not an option: round continuation uses the dedicated subcommand opencode-auto continue <dir> (starts a new round after the previous phased migration round fully completes)")
    process.exit(1)
  }
  const cont = command === "continue"
  if (cont) {
    for (const key of ["mode", "source-dir", "source-path", "dest-dir"]) {
      if (!flags.has(key)) continue
      console.error(
        `${key === "mode" ? "-m/--mode" : `--${key}`} is fixed across rounds and cannot change during continue: a continuation round continues the same migration (the previous round's conclusions assume the same source and target).` +
          " To migrate something else, init a new project in a new directory",
      )
      process.exit(1)
    }
    if (flags.has("implement-file") || flags.has("implement-prompt")) {
      console.error("--implement-file/--implement-prompt are init-only single-phase (m) shortcut-mode options: continue is for phased-flow round continuation and does not support them")
      process.exit(1)
    }
  }
  if (flags.has("commit-subtask")) {
    console.error("--commit-subtask removed: commits are now made by the driver after every session ends (AI commit rights revoked), and can no longer be turned off (--commit false is retired)")
    process.exit(1)
  }
  // --implement-file/--implement-prompt(init 单阶段 m 快捷模式,设计见文件尾用法
  // 文本): 二选一,不与继续调用叠加使用;值须非空。文件存在性与 phases 兼容性
  // 校验放在 existing 配置装载之后(§下文)。
  if (flags.has("implement-file") && flags.has("implement-prompt")) {
    console.error("--implement-file and --implement-prompt are mutually exclusive: they are two input sources for the same shortcut mode; do not give both")
    process.exit(1)
  }
  if (flags.has("implement-file") && !flags.get("implement-file")?.trim()) {
    console.error("--implement-file requires a non-empty file path")
    process.exit(1)
  }
  if (flags.has("implement-prompt") && !flags.get("implement-prompt")?.trim()) {
    console.error("--implement-prompt requires non-empty prompt text")
    process.exit(1)
  }
  for (const key of ["verify-idle", "verify-max"]) {
    if (flags.has(key)) {
      const renamed = key === "verify-idle" ? "idle-time" : "idle-max"
      console.error(`--${key} was renamed to --${renamed} (the driver-run script watchdog)`)
      process.exit(1)
    }
  }
  const commit = parseCommit(flags)
  if (commit === null) {
    console.error(
      "--commit now only takes true (default): --commit false (and the old alias none) is retired — unified commits are the completion condition" +
        " (plans/0021-commit-boundary-design.md); the driver commits all changes after every session ends; turning commits off is no longer supported",
    )
    process.exit(1)
  }
  const subtask = parseSubtask(flags.get("subtask"))
  if (subtask === null) {
    console.error("--subtask takes off|auto|ondemand; defaults to auto")
    process.exit(1)
  }
  const contextLimit = parseContextLimit(flags.get("context-limit"))
  if (contextLimit === null) {
    console.error("--context-limit takes a positive integer (unit: k tokens); defaults to 64")
    process.exit(1)
  }
  // --idle-time: driver 托管脚本(test)的无进度判定窗口(输出文件持续无增长
  // 即终止);--idle-max: 绝对时长上限(0 = 不设,只要持续有输出
  // 就永不限时)。
  const idleTime = parseIdleTime(flags.get("idle-time"))
  if (idleTime === null) {
    console.error("--idle-time takes 1..120 (minutes); defaults to 10")
    process.exit(1)
  }
  const idleMax = parseIdleMax(flags.get("idle-max"))
  if (idleMax === null) {
    console.error("--idle-max takes 1..1440 (minutes); no cap by default")
    process.exit(1)
  }
  // --phases: 阶段化流程(设计文档 plans/0006-phases-design.md);"m"(缺省)= 无阶段
  // 声明,单次运行,行为不变。已有完成阶段时的前缀护栏见下(已完成的阶段必须构成
  // 新值的前缀,防止 amend 把流程状态打成不可推导)。
  // 取值二形态(M3.6): 字母预置(admtvk 子序列含 m)或逗号分隔的阶段类型 id 列表
  // (含 .opencode/auto/phases/ 的自定义类型,须含 implement);列表形态规范化为
  // 无空格的逗号串写入 config。
  let phases: string | undefined
  if (flags.has("phases")) {
    const raw = flags.get("phases") ?? ""
    let parsed: PhaseTypeEntry[] | null
    try {
      parsed = parsePhases(raw, directory)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
    if (!parsed) {
      console.error(`--phases is invalid: ${phasesProblem(raw, loadPhaseTypes(directory))}`)
      process.exit(1)
    }
    phases = PRESET_FORM.test(raw) ? raw : parsed.map((entry) => entry.type).join(",")
  }
  // --source-dir/--source-path/--dest-dir: 迁移参数。布局约定: 位置参数是 driver
  // 工作目录,迁移源在 <工作目录>/<source-dir>(source-path 为其下的模块相对路径)、
  // 迁移目标在 <工作目录>/<dest-dir>——driver 流程文件(docs/ 等)与迁移
  // 产出经 dest-dir 隔离。source 两键必须成对给出(拒绝 <src-dir>/<src-path> 拼接
  // 形式);存在性只在 init 校验,run 不再校验(源系统可能已下线)。dest-dir 独立
  // 固化/修订(不校验存在性,目标目录常由迁移过程创建)。
  let source: { dir: string; path: string } | undefined
  if (flags.has("source-dir") || flags.has("source-path")) {
    if (!flags.has("source-dir") || !flags.has("source-path")) {
      console.error("--source-dir and --source-path must be given as a pair: source-system directory and source-module relative path")
      process.exit(1)
    }
    const sourceDir = flags.get("source-dir")!
    const sourcePath = flags.get("source-path")!
    if (!sourceDir.trim() || !sourcePath.trim()) {
      console.error("--source-dir and --source-path must be non-empty")
      process.exit(1)
    }
    if (isAbsolute(sourceDir) || sourceDir.split(/[\\/]+/).includes("..")) {
      console.error("--source-dir must be a relative path under the working directory (no ..): the migration source lives at <workdir>/<source-dir>")
      process.exit(1)
    }
    if (isAbsolute(sourcePath) || sourcePath.split(/[\\/]+/).includes("..")) {
      console.error("--source-path must be a relative path without .. (relative to --source-dir)")
      process.exit(1)
    }
    const dirIsDir = await stat(join(directory, sourceDir)).then((s) => s.isDirectory()).catch(() => false)
    const pathExists = await stat(join(directory, sourceDir, sourcePath)).then(() => true).catch(() => false)
    if (!dirIsDir || !pathExists) {
      console.error(`--source-dir must be an existing directory under the working directory and --source-path must exist under it: ${sourceDir} and ${sourcePath}`)
      process.exit(1)
    }
    source = { dir: sourceDir, path: sourcePath }
  }
  let destDir: string | undefined
  if (flags.has("dest-dir")) {
    const dest = flags.get("dest-dir")!
    if (!dest.trim()) {
      console.error("--dest-dir must be non-empty")
      process.exit(1)
    }
    if (isAbsolute(dest) || dest.split(/[\\/]+/).includes("..")) {
      console.error("--dest-dir must be a relative path under the working directory (no ..): the migration target lives at <workdir>/<dest-dir>")
      process.exit(1)
    }
    destDir = dest
  }
  // 仅显式给出的键进入合并: --commit/--subtask 等裸选项取各自缺省档,
  // 未出现的选项不覆盖既有配置。
  const explicit: Partial<ProjectConfig> = {}
  if (flags.has("agent")) explicit.agent = flags.get("agent")
  if (flags.has("commit")) explicit.commit = commit
  if (flags.has("subtask")) explicit.subtask = subtask
  if (flags.has("context-limit")) explicit.contextLimit = contextLimit
  if (flags.has("idle-time")) explicit.idleTime = idleTime
  if (flags.has("idle-max")) explicit.idleMax = idleMax
  if (phases !== undefined) explicit.phases = phases
  if (source !== undefined) explicit.source = source
  if (destDir !== undefined) explicit.destDir = destDir
  // --test-by-driver / --handover-test: 布尔宪法级选项,init/continue
  // 接受(裸选项或 true 启用、false 关闭),经 explicit 合并(amend 语义)。二者不属
  // 迁移同一性选项,continue 可按轮修订。
  if (flags.has("test-by-driver")) explicit.testByDriver = flags.get("test-by-driver") !== "false"
  if (flags.has("handover-test")) explicit.handoverTest = flags.get("handover-test") !== "false"
  // --auto-number/--no-auto-number: 一对布尔开关(启用/关闭自动编号),同为布尔
  // 宪法级选项,经 explicit 合并(amend 语义);两者同现自相矛盾,为用法错误。
  if (flags.has("auto-number") && flags.has("no-auto-number") && flags.get("auto-number") !== "false" && flags.get("no-auto-number") !== "false") {
    console.error("--auto-number and --no-auto-number are a mutually exclusive pair; do not use both")
    process.exit(1)
  }
  if (flags.has("auto-number") && flags.get("auto-number") !== "false") explicit.autoNumber = true
  if (flags.has("no-auto-number") && flags.get("no-auto-number") !== "false") explicit.autoNumber = false
  // --wrapup/--no-wrapup: 一对布尔开关(启用/关闭任务收尾会话),镜像
  // --auto-number/--no-auto-number 同款处理;两者同现自相矛盾,为用法错误。
  if (flags.has("wrapup") && flags.has("no-wrapup") && flags.get("wrapup") !== "false" && flags.get("no-wrapup") !== "false") {
    console.error("--wrapup and --no-wrapup are a mutually exclusive pair; do not use both")
    process.exit(1)
  }
  if (flags.has("wrapup") && flags.get("wrapup") !== "false") explicit.wrapup = true
  if (flags.has("no-wrapup") && flags.get("no-wrapup") !== "false") explicit.wrapup = false
  let existing: ProjectConfig
  try {
    existing = await loadProjectConfig(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  // 全量覆盖 vs 增量修订的唯一分水岭: 缺省取内置缺省表作基线(未给出的键回落
  // 默认值),--amend 取磁盘上的既有配置作基线(未给出的键保留原值)。continue
  // 恒为 amend——续轮迁移依赖既有配置,跨轮固定项(mode/迁移参数)已在上方前置
  // 守卫拒绝传入,没有「全量覆盖」可言。
  //
  // 可选键 source/destDir 无须特判: CONFIG_DEFAULTS 不含这两个键,mergeProjectConfig
  // 过滤 undefined 后展开,无参 init 写出的 config.json 里它们自然消失。
  const amend = cont || flags.has("amend")
  const base: ProjectConfig = amend ? existing : CONFIG_DEFAULTS
  // 本次生效的 phases: 显式给出即用之,否则取基线值(全量覆盖下 = 缺省 "m",
  // --amend/continue 下 = 既有配置值)。下方快捷模式校验与阶段索引前缀护栏共用。
  const effectivePhases = phases ?? base.phases
  // --implement-file/--implement-prompt 快捷模式(单阶段 m): 依赖生效 phases 才能
  // 算出,故校验放在基线装载之后;--implement-file 的文件存在性同样在此校验
  // (读盘前的用法校验已尽量前置,存在性判断天然需要 I/O)。
  const implementFile = flags.get("implement-file")
  const implementPrompt = flags.get("implement-prompt")
  let implementFilePath: string | undefined
  if (implementFile !== undefined || implementPrompt !== undefined) {
    if (effectivePhases !== "m") {
      console.error(
        `--implement-file/--implement-prompt only apply to the single-phase (phases = "m") shortcut mode; ` +
          `${phases !== undefined ? "the --phases given here" : amend ? "the existing config phases" : "the effective default phases"} is "${effectivePhases}". ` +
          `switch first with opencode-auto init <dir> --phases m (new projects default to m when --phases is omitted), then use this shortcut mode`,
      )
      process.exit(1)
    }
    if (implementFile !== undefined) {
      implementFilePath = resolve(implementFile)
      const fileOk = await stat(implementFilePath).then((s) => s.isFile()).catch(() => false)
      if (!fileOk) {
        console.error(`the file given to --implement-file does not exist or is not a regular file: ${implementFilePath}`)
        process.exit(1)
      }
    }
    // 快捷模式缺省按需交接: 未显式给出 --subtask 时 subtask 固化为 ondemand
    // (计划生成会话产出整任务计划后以单会话执行为主、上下文超限再交接续跑,
    // 不经逐任务分解);显式 --subtask 优先。
    if (!flags.has("subtask")) explicit.subtask = "ondemand"
    // 快捷模式缺省关闭收尾会话: 该模式只产出任务单元(计划生成会话),不进入
    // 任务执行循环,未显式给出 --wrapup/--no-wrapup 时 wrapup 固化为 false
    // (镜像 subtask 固化 ondemand 的同款处理);显式给出优先。
    if (!flags.has("wrapup") && !flags.has("no-wrapup")) explicit.wrapup = false
  }
  // handoverTest 须搭配 testByDriver: 显式给出时按本次生效值校验(未显式给出
  // test-by-driver 则回落既有配置值);amend 关闭 test-by-driver 而保留既有
  // handoverTest=true 亦在此拦截。
  {
    const effectiveTestByDriver = explicit.testByDriver ?? base.testByDriver
    const effectiveHandoverTest = explicit.handoverTest ?? base.handoverTest
    if (effectiveHandoverTest && !effectiveTestByDriver) {
      console.error(
        `${explicit.handoverTest !== undefined ? "--handover-test" : "the existing handoverTest"} requires --test-by-driver: ` +
          "test handover only makes sense when tests run via the driver. To fix: opencode-auto init <dir> --test-by-driver --handover-test, or edit .opencode/auto/config.json directly",
      )
      process.exit(1)
    }
  }
  // 阶段索引(当前轮 docs/R-NN/phases.md + 各阶段目录 todo.md/done.md,M3.3)是
  // 推导式状态载体;非法即环境错误退出 1(报文给人工修订指引)。已完成阶段的类型
  // 序列(索引序,M3.6 起取代预置字母串): 非空时显式改 --phases 须满足前缀护栏。
  let phaseState: PhaseState | undefined
  try {
    phaseState = await readPhases(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  const indexPath = phaseIndexPath(await currentRound(directory))
  const completedPhases = phaseState ? doneTypes(phaseState) : []
  // 生效 phases 与既有配置 phases 展开为类型序列(均已校验合法)。
  const typesOf = (value: string) => parsePhases(value, directory)!.map((entry) => entry.type)
  const effectiveTypes = typesOf(effectivePhases)
  // continue 前置校验(按既有配置判定,不看向新 --phases 值): 仅阶段化项目、且
  // 上一轮已全部完成——阶段索引存在且其中每个阶段都已完成(done.md)。轮首建立后
  // 新一轮阶段全未完成,新一轮 --phases 不受前缀护栏约束(从头规划,任何合法值可改)。
  if (cont) {
    if (existing.phases === "m") {
      console.error(
        `continue only applies to phased-flow projects: the current config has phases = "m" (a single run with no phase declaration, no rounds). ` +
          `enable the phased flow first with opencode-auto init <dir> --phases <admtvk subsequence containing m | type-id list containing implement>`,
      )
      process.exit(1)
    }
    if (phases === "m") {
      console.error('continue is for phased-flow round continuation; --phases cannot be "m"')
      process.exit(1)
    }
    const declared = typesOf(existing.phases)
    const outside = completedPhases.filter((type) => !declared.includes(type))
    if (outside.length) {
      console.error(
        `continue precheck failed: the phase index ${indexPath} records completed phases outside phases (${existing.phases}): ${outside.join(", ")}. ` +
          "fix the index manually before continuing to the next round",
      )
      process.exit(1)
    }
    const pending = phaseState ? phaseState.phases.filter((unit) => !phaseState.done.has(unit.id)).map(phaseLabel) : []
    if (!phaseState || pending.length) {
      console.error(
        `continue requires the previous round to be fully complete: the phase index ${indexPath} ` +
          `${phaseState ? `still has pending phases ${pending.join(", ")}` : "is missing"} (phases ${existing.phases}). ` +
          `run opencode-auto run ${directory} first to finish this round`,
      )
      process.exit(1)
    }
  }
  // 前缀护栏判定的是**本次生效值**而非「是否显式给出」: 全量覆盖下无参 init 会把
  // phases 回落为缺省 "m",若项目已跑在阶段化流程中途(已有完成阶段),这会静默毁掉
  // 已完成阶段(syncPhaseIndex 拒绝丢弃已完成阶段,但报错发生在配置写盘之后)。
  // 判生效值即可把这种情形拦在任何写盘之前。--amend/continue 下生效值 = 既有配置
  // 值,天然满足前缀条件,旧行为不变。
  const completedText = completedPhases.join(",")
  if (!cont && completedPhases.length && !completedPhases.every((type, i) => effectiveTypes[i] === type)) {
    console.error(
      flags.has("phases")
        ? `the new --phases value "${effectivePhases}" is incompatible with the phase index (${indexPath}): its completed phases are "${completedText}", which must be a prefix of the new value's phase types. ` +
            "use a value prefixed by it, or roll the index back manually (rename done.md to todo.md) before changing it"
        : `a no-flag init overwrites with defaults and would reset phases to "${effectivePhases}", incompatible with the completed phases "${completedText}" in the phase index (${indexPath}) (it would destroy the round layout). ` +
            `to keep the existing config use opencode-auto init ${directory} --amend; to really change it, pass --phases explicitly prefixed by "${completedText}"`,
    )
    process.exit(1)
  }
  // -m/--mode 解析(缩减版,init 侧): 优先级 显式值 > 基线值(全量覆盖下即缺省,
  // --amend/continue 下为既有配置值);未注册名为用法错误(报文列出当前支持的模式)。
  const modeName = flags.get("mode") ?? base.mode
  const modes = loadModeTable(directory)
  if (!modes[modeName]) {
    console.error(`--mode must be a registered mode (currently supported: ${Object.keys(modes).join(", ")}); defaults to migrate`)
    process.exit(1)
  }
  const config = mergeProjectConfig(base, { ...explicit, mode: modeName })
  // 防误触闸门: 只在「已存在配置、且本次是全量覆盖」时生效——全新目录没有可覆盖
  // 的东西,--amend 也不会丢弃任何既有键。两道闸都必须排在第一个写盘点
  // (saveProjectConfig)之前,现有 e2e 断言「旗标校验通过前目录为空」的不变式
  // 依赖于此;先拦截再询问,避免用户答完 y 才看到报错。
  const force = flags.has("force")
  const overwriting = !amend && !force && (await Bun.file(join(directory, ".opencode", "auto", "config.json")).exists())
  if (overwriting) {
    // ① 工作区干净度: init 会覆盖已落盘的配置,git 是用户唯一的撤销手段。
    //    非 TTY 同样生效——免掉的只是交互确认,不是这道拦截。
    const dirty = await checkCleanTree(directory, "init full overwrite")
    if (dirty) {
      console.error(dirty)
      process.exit(1)
    }
    // ② 交互确认: 非 TTY 直接放行(confirm 内部判定)。
    const ok = await confirm(
      "found an existing config .opencode/auto/config.json; init will fully overwrite it with these parameters (keys not given fall back to defaults). continue? [y/N] ",
    )
    if (!ok) {
      console.log("cancelled; nothing was changed")
      process.exit(0)
    }
  }
  try {
    await saveProjectConfig(directory, config)
  } catch (error) {
    console.error(`failed to write .opencode/auto/config.json: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  console.log(`⚙ project config (.opencode/auto/config.json): ${formatProjectConfig(config)}`)
  // 自动编号由阶段规划会话消费编号记录;phases = "m" 没有规划会话(任务由人工或
  // init 快捷模式写出),开关不产生效果,提示一次。
  if (config.autoNumber && config.phases === "m") {
    console.log('ℹ auto-numbering (--auto-number) has no planning session to consume the numbering record under phases = "m"; the switch has no effect (task numbering is maintained manually)')
  }
  // 提示词库: 装载目标目录 .opencode/auto/prompts/ 覆盖(协议校验失败即退出);
  // 无 -p 时不渲染提示词,提前装载可在 init 阶段就暴露覆盖问题。
  try {
    usePromptLibrary(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  // `type: "file"` 导入会被嵌入编译产物,保证独立二进制可用。任务不在此写(PLAN.md
  // 已退役,M3.4): 由下方 establishRound 建轮次目录与阶段目录,任务单元由规划会话、
  // init 快捷模式或人工写出。
  const templates: Record<string, string> = {
    "opencode.json": templateConfig,
    ".opencode/agent/auto.md": templateAgent,
  }
  for (const [file, source] of Object.entries(templates)) {
    const target = resolve(directory, file)
    const raw = await Bun.file(source).text()
    // agent 契约按 config.testByDriver 条件渲染。
    const content = file === "opencode.json" ? raw : renderText(raw, { testByDriver: config.testByDriver })
    const existing = await Bun.file(target).text().catch(() => undefined)
    if (existing !== undefined && (existing === content || file !== ".opencode/agent/auto.md")) {
      console.log(`already exists, skipped: ${file}`)
      continue
    }
    await Bun.write(target, content)
    console.log(existing === undefined ? `created: ${file}` : `replaced (differed from the template): ${file}`)
  }
  // 幂等同步 AGENTS.md 的 opencode-auto 块: 按当前配置渲染,与文件中现有标准块比对
  // ——缺失则追加、内容不一致则整块替换、旧版/多余的带名标记块一律清理。
  const ensured = await ensurePointer(directory, { testByDriver: config.testByDriver })
  console.log(
    ensured.block === "inserted"
      ? "appended: AGENTS.md opencode-auto block"
      : ensured.block === "replaced"
        ? "refreshed: AGENTS.md opencode-auto block (differed from the current config render)"
        : "already exists, skipped: AGENTS.md opencode-auto block (up to date)",
  )
  if (ensured.legacyRemoved) console.log(`cleaned: removed ${ensured.legacyRemoved} legacy/stray opencode-auto marker block(s) from AGENTS.md`)
  if (await ensureGitignore(directory)) console.log("updated: .gitignore now ignores tmp/ and .auto/ (driver workdir and runtime state)")

  // 轮首建立(轮次专用目录 docs/R-NN,plans/0006-phases-design.md M 节;须在 ensurePointer
  // 之后,AGENTS.md.bak 快照才含 opencode-auto 块): init 建当前轮(全新项目 = R-01,幂等
  // ——已有阶段索引按预置同步,只重写未开始的尾部阶段);continue 建新一轮 R-(N+1)
  // (前置校验已过;上一轮结论经 prevRoundDigest 注入新一轮首个阶段规划会话)。无阶段
  // 模式("m")同样建立,唯一阶段为 P01-implement(plans/0047 L2)。
  let newRound: number | undefined
  try {
    const established = await establishRound(directory, {
      phases: config.phases,
      round: cont ? await nextRound(directory) : undefined,
    })
    newRound = cont ? established.round : undefined
    console.log(`✓ round directory: ${established.root}/ (the phase index phases.md and one P<nn>-<type>/ directory per phase, each with its task index tasks.md once planned; once written, permanent)`)
  } catch (error) {
    console.error(`round establishment failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }

  // -p/--prompt: 项目意图文本写入 .opencode/auto/brief.md(版本化、随仓库共享、
  // 人工可编辑,amend 语义——重复 init -p 覆盖重写),由每个阶段的规划会话消费。
  // init 不再启动任何 AI 会话(设计文档 plans/0006-phases-design.md §B.1: 规划必须感知
  // 各阶段产物,从 init 挪到 run 的阶段边界)。
  const promptText = flags.get("prompt")
  if (promptText !== undefined) {
    if (!promptText.trim()) {
      console.error("-p/--prompt requires non-empty prompt text")
      process.exit(1)
    }
    await Bun.write(join(directory, ".opencode", "auto", "brief.md"), promptText.trimEnd() + "\n")
    console.log("written: .opencode/auto/brief.md (project brief, consumed by phase planning sessions; repeated init -p overwrites it)")
  }
  // --implement-file/--implement-prompt 快捷模式(单阶段 m): 计划生成会话写出
  // P01-implement 的任务索引与各任务文档,与阶段规划会话同款机制——这是 init 唯一
  // 会启动 AI 会话的路径(§B.1 的"init 不启动会话"原则对通常路径不变,此快捷模式是
  // 显式选择)。任务索引当前必须尚无任务: 会话开始前 reset 会清除任务索引,已有
  // 任务时拒绝执行,防止误覆盖人工或此前生成的计划。
  if (implementFile !== undefined || implementPrompt !== undefined) {
    const state = await readPhases(directory).catch(() => undefined)
    const phase = state?.phases[0]
    const listed = phase ? await loadPlan(directory, phase).catch(() => undefined) : undefined
    if (!phase || !listed || listed.tasks.length) {
      console.error(
        `${listed?.index ?? "the task index"} already lists tasks (or is unreadable); --implement-file/--implement-prompt only generate a new plan into an empty task index: ` +
          "to regenerate, back up and remove the task index and its task directories first",
      )
      process.exit(1)
    }
    const brief = await Bun.file(join(directory, ".opencode", "auto", "brief.md")).text().catch(() => undefined)
    console.log(`▶ plan-generation session input: ${implementFilePath !== undefined ? `plan file ${implementFilePath}` : "implementation prompt"}`)
    const result = await implementPlan(
      directory,
      {
        file: implementFilePath,
        content: implementFilePath !== undefined ? await Bun.file(implementFilePath).text() : implementPrompt!,
        brief,
      },
      { agent: config.agent, commit: config.commit, contextLimit: config.contextLimit * 1000, mode: modes[modeName] },
    )
    if (result.type === "blocked") {
      console.error(`⏸ plan-generation session blocked (hidden blockage; inspect and re-run):\n${result.question}`)
      process.exit(2)
    }
    console.log(`✓ plan generation complete: ${listed.index} lists ${result.count} task(s)`)
    console.log(`after reviewing the task documents (docs/T-NNN/todo.md), run: opencode-auto run ${directory}`)
    process.exit(0)
  }
  // 结束语按 phases 分两态: "m" 提示人工写任务单元;阶段化流程下任务由阶段规划
  // 会话写出,不提示手工编辑。continue 下新一轮阶段全未完成,首个
  // 阶段 = 新 phases 的第一个字母;另打新一轮横幅。
  if (config.phases === "m") {
    console.log(promptText !== undefined ? `brief recorded; run: opencode-auto run ${directory} to start task planning` : `list tasks in docs/R-01/P01-implement/tasks.md (one line \`- [ ] T-NNN <title>\` each, content in docs/T-NNN/todo.md), then run: opencode-auto run ${directory}`)
    process.exit(0)
  }
  // 首个未完成阶段: 前缀护栏保证已完成阶段恰为生效类型序列的前缀。
  const current = parsePhases(config.phases, directory)![cont ? 0 : completedPhases.length]
  if (cont) {
    console.log(`round ${newRound} of the migration started: making the migration result more complete and consistent with the source on top of existing progress`)
  }
  console.log(
    `${promptText !== undefined ? "brief recorded; " : ""}run: opencode-auto run ${directory}${current ? ` to start ${current.type} (${current.name}) phase planning` : " (all phases complete)"}`,
  )
  process.exit(0)
}

// check: ①启发式检查 AGENTS.md 与未完成任务的任务文档中是否有与"提交执行权在 driver"原则
// (及 testByDriver 启用时的"测试/编译
// reset 子命令(反初始化 / 卸载): 与 init 互逆,精确移除 init 写出的配置层产物,
// 把工作区还原到未初始化状态,消除配置残留对 opencode 主程序与其他扩展组件的
// 干扰。清单与执行都在 auto-core/reset.ts(边界口径写在那里的文件头注释):只清
// 配置层,不碰 .auto/ 运行时状态、docs/ 与 tmp/;与主程序共用的
// opencode.json 逐字节比对模板后才删,AGENTS.md 只摘除 opencode-auto 标记块;
// 目录一律 rmdir(空才回收),保住 .opencode/auto/prompts/ 与用户其他 agent 契约。
if (command === "reset") {
  const entries = await planReset(directory)
  const actionable = entries.filter((entry) => entry.action !== "keep")
  if (!actionable.length) {
    console.log(`no init artifacts found; reset not needed: ${directory}`)
    process.exit(0)
  }
  console.log(`the following cleanup will run in ${directory}:`)
  console.log(formatResetPlan(entries))
  const force = flags.has("force")
  if (!force) {
    // reset 恒为破坏性,干净度闸门无条件生效(不像 init 只在覆盖时才查)。
    const dirty = await checkCleanTree(directory, "reset deinit")
    if (dirty) {
      console.error(dirty)
      process.exit(1)
    }
    const ok = await confirm(`the ${actionable.length} item(s) above will be deleted/restored; continue? [y/N] `)
    if (!ok) {
      console.log("cancelled; nothing was changed")
      process.exit(0)
    }
  }
  try {
    await applyReset(directory, entries)
  } catch (error) {
    console.error(`reset failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  console.log(`✓ restored to the uninitialized state (docs/, .auto/ runtime state and tmp/ untouched)`)
  process.exit(0)
}

// 等命令执行权在 driver"原则)相违背的描述;②引用检查(stable-refs P4)——
// 全量活文档(docs/**/*.md)扫描失效引用(路径不存在 /
// 行号超出文件总行数)。任一命中退出码 1,供人工修订。测试类检查是否启用由
// checkPrinciple 依配置决定,testOn 仅用于调整报文措辞。
if (command === "check") {
  const { findings, notes, refs, testOn } = await checkPrinciple(directory)
  const active = [...(testOn ? ["test"] : []), "commit"].join("/")
  const detail = testOn ? "" : "test disabled (driver-run tests off)"
  console.log(`checking ${directory}: ${active} execution-rights principles${detail ? ` (${detail})` : ""} + doc references`)
  for (const note of notes) console.log(`ℹ ${note}`)
  if (!findings.length && !refs.length) {
    console.log(`✓ no statements violating the ${active} principles; all doc reference checks passed`)
    process.exit(0)
  }
  for (const finding of findings) {
    console.log(`⚠ ${finding.file}${finding.task ? `(${finding.task})` : ""}:${finding.line}: ${finding.text}`)
  }
  for (const ref of refs) {
    console.log(`⚠ stale reference ${ref.file}:${ref.line} → ${ref.path} (${ref.problem === "beyond-eof" ? "line beyond end of file" : "path not found"}): ${ref.text}`)
  }
  const summary = [
    ...(findings.length
      ? [
          `${findings.length} statement(s) may violate the principles (heuristic check; review and fix manually` +
            `${testOn ? "; write compile/test/build/lint commands as scripts in test/ for the driver to run" : ""})`,
        ]
      : []),
    ...(refs.length ? [`${refs.length} stale reference(s) (update to current paths, or exempt with the inline markers deleted/archived/historical)`] : []),
  ]
  console.log(`found ${summary.join(" and ")}`)
  process.exit(1)
}

// 阶段进度行(run 横幅与 status 共用): 当前轮阶段索引 → P01-analysis✓ P02-design▶ …;
// 索引缺失/非法只给提示行,不阻塞调用方。
async function phasesLine(directory: string): Promise<string> {
  const round = await currentRound(directory)
  try {
    const state = await readPhases(directory)
    if (!state) return `⚠ phase index (${phaseIndexPath(round)}) is missing; run opencode-auto init to establish the round`
    return `phases${round > 1 ? ` (round ${round})` : ""}: ${formatPhases(state)}`
  } catch (error) {
    return `⚠ phase index (${phaseIndexPath(round)}) is invalid: ${error instanceof Error ? error.message : String(error)}`
  }
}

if (command === "status") {
  // 配置摘要,随后是当前轮的只读总览树(轮 → 阶段 → 任务 → 子任务,状态与依赖;
  // plans/0047 L1/R2)。配置非法仅提示、不阻塞总览;阶段/任务索引缺失或非法以
  // ⚠ 行呈现。
  try {
    const config = await loadProjectConfig(directory)
    console.log(`⚙ project config (.opencode/auto/config.json): ${formatProjectConfig(config)}`)
  } catch (error) {
    console.log(`⚠ project config (.opencode/auto/config.json) is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
  for (const line of await renderStatus(directory)) console.log(line)
  process.exit(0)
}

console.error(`usage:
  opencode-auto init [dir] [-p|--prompt <brief-text>] [-m|--mode <name>] [--agent <name>] [--subtask [off|auto|ondemand]] [--idle-time [1-120]] [--idle-max [1-1440]] [--commit [true]] [--context-limit [n]] [--phases <admtvk subsequence with m | type-id list>] [--source-dir <dir> --source-path <relative-path>] [--dest-dir <relative-path>] [--test-by-driver [true|false]] [--handover-test [true|false]] [--auto-number|--no-auto-number] [--wrapup|--no-wrapup] [--implement-file <file>|--implement-prompt <text>] [--amend] [-f|--force]
  opencode-auto continue [dir] [--phases <admtvk subsequence with m | type-id list>] [-p|--prompt <brief-text>] [--agent <name>] [--subtask [off|auto|ondemand]] [--idle-time [1-120]] [--idle-max [1-1440]] [--commit [true]] [--context-limit [n]] [--test-by-driver [true|false]] [--handover-test [true|false]] [--auto-number|--no-auto-number] [--wrapup|--no-wrapup]
  opencode-auto run [dir] [--server <url>] [--verbose [true|false]] [--interactive|-i] [--wait-answer [1-60]] [--wait-between [1-60]] [--permission [auto-allow|ask-allow|ask-deny|ask-fail]] [--dryrun [true|false]] [--new-session]
  opencode-auto reset [dir] [-f|--force]
  opencode-auto check [dir]
  opencode-auto status [dir]

options: project-constitution options (-m/--mode, --agent, --context-limit, --subtask, --idle-time, --idle-max, --commit, --test-by-driver, --handover-test, --auto-number/--no-auto-number, --wrapup/--no-wrapup, --phases, --source-dir/--source-path, --dest-dir) are frozen by init into .opencode/auto/config.json (versioned, shared with the repo, human-editable); passing them to run is a usage error
       init defaults to a stateless full overwrite: the output is determined solely by the parameters given this time; keys not provided fall back to defaults without merging the old on-disk config — the same init produces identical output in any environment, no pre-cleanup needed
       --amend switches back to incremental amend semantics (only changes keys explicitly given; the rest keep their existing values); continue is always amend
       -f/--force skips the overwrite confirmation and worktree cleanliness checks (for CI and automation; shared by init and reset)
       --new-session when resuming from an interruption, do not reuse the interrupted session; start a new one (only skips session reuse; exact phase re-entry is unaffected; by default the surviving interrupted session is reused)
       -m/--mode prompt-level scenario mode (built-in migrate; add or override via .opencode/auto/modes/<name>.md in the target directory — new modes need no source changes)
       -p/--prompt project brief text, written to .opencode/auto/brief.md and consumed by phase planning sessions (init starts no AI sessions)
       reset de-initialization (inverse of init): removes the config-layer artifacts init wrote (.opencode/auto/config.json and brief.md, .opencode/agent/auto.md, legacy .auto/config.json, the AGENTS.md opencode-auto block, the tmp/ and .auto/ entries in .gitignore, plus opencode.json if unmodified); docs/, .auto/ runtime state and tmp/ are never touched; empty directories only are reclaimed (preserving .opencode/auto/prompts/ and your other agent contracts)
       --phases <admtvk subsequence with m | type-id list> phased flow (a analysis → d design → m migration implementation → t test → v acceptance → k knowledge distillation; "m" default = the manual single phase P01-implement, no planning or handover session; alternatively a comma-separated list of phase type ids in any order, repeats allowed, containing implement (e.g. analysis,security-review,implement), where custom types are defined one per file in .opencode/auto/phases/<type>.md; once phases are complete, changes must satisfy the prefix guard — see README)
       --source-dir <dir> --source-path <relative-path> migration source parameters (source-system directory + source-module relative path, always as a pair; both relative to <dir>; existence is checked at init)
       --dest-dir <relative-path> migration target directory (relative to <dir>): isolates the driver workdir from the migration target; migrated code is written to <dir>/<dest-dir>
       --commit [true] unified commit after sessions (always on: after any session ends and the driver writes completion state, the driver recursively commits all changes — git history is the audit trail of AI changes; --commit false and the old alias none are retired — committing is the completion condition, it can no longer be turned off)
       --test-by-driver [true] moves compile/test/build/lint execution rights to the driver: execution-type sessions no longer run such commands in-session; instead they write the commands as scripts into test/ and put the script path in tmp/test.sh for the driver, which merges stdout/stderr into tmp/test.<n>.out and feeds the exit code and output file back to the session for the AI to judge
       --handover-test requires --test-by-driver: when a session's context reaches its cap, hand over at the moment it next initiates a test — the driver first commits the finalized pinned script and sources, and has the AI write remaining work that does not depend on test results to disk plus a handover document (subtask sessions: docs/<task>/S<two-digit>/testhandoff.md; whole-task sessions: docs/<task>/testhandoff.md) before ending the session; the document is archived as testhandoff-<n>.md with one more commit to confirm the handover, and only then does the test run (what gets tested is exactly that commit's tree); a new session reads the results and continues, avoiding repeated trial-and-error in an oversized context. If the handover is interrupted, the next run locates the breakpoint from the document's file and commit state (wrap-up unfinished → fork from the finalized point and redo the wrap-up; written → add the missing commit and run the script). Set OPENCODE_AUTO_HANDOVER_CONCURRENT=on to restore the old concurrent timing (tests start right after finalization, parallel to the session wrap-up, testing the finalized snapshot)
       --auto-number / --no-auto-number auto-numbering switch (default --auto-number = on; --no-auto-number is the opt-out): task numbers (T-NNN) never repeat in the target directory — the next free number is persisted in .auto/next-task and phase planning sessions continue from that record (no longer restarting from T-001 each phase); if the record is missing (e.g. a fresh clone without .auto/ shared), an AI recovery session first derives the next number from the task indexes, docs artifacts and git history, restores the record, and only then continues planning
       --wrapup / --no-wrapup task wrap-up session switch (default --wrapup = on; --no-wrapup is the opt-out): when off, the wrap-up session is skipped after each task's subtasks/whole-task execution completes (including wrap-up after fix rounds)
       --implement-file <file> / --implement-prompt <text> single-phase (phases = "m") shortcut mode, pick one: from the given plan file (injected in full) or the given implementation prompt, start a one-off plan-generation session that writes the task index docs/R-01/P01-implement/tasks.md and one docs/T-NNN/todo.md per task (same mechanism as phase planning sessions; the only path where init starts an AI session); requires effective phases = "m" (switch with --phases m first if incompatible) and an empty task index (rejected when tasks are listed, to avoid clobbering); in this mode, without an explicit --subtask, subtask defaults to ondemand (single-session execution, hand over on demand when context runs out, no per-task decomposition), and without an explicit --wrapup/--no-wrapup, wrapup defaults to false (this mode only produces the task units, never enters the task execution loop, so wrap-up does not apply); after generation, review the task documents manually and call opencode-auto run <dir> separately — from then on tasks proceed with the frozen subtask/wrapup settings; run does not accept these two options
       continue subcommand: after the previous phased migration round fully completes, start a new round of continued migration (making the migration result more complete and consistent with the source) — at round start a new round directory docs/R-NN/ is created (the phase index phases.md and one P<nn>-<type>/ directory per phase — with its task index, handover and knowledge docs — all live inside the round, permanent once written, with the AGENTS.md snapshot stored as AGENTS.md.bak inside the round), and the previous round's conclusions (final-phase handover and migration knowledge) are injected into the new round's first phase planning session; -m/--mode and the migration parameters (--source-dir/--source-path/--dest-dir) are fixed across rounds and cannot change (passing them is a usage error), while --phases and the remaining execution options (including --test-by-driver/--handover-test) and -p may be revised per round (not subject to the prefix guard)

exit codes: 0 all complete; 1 usage/environment error (same when check finds principle-violating statements); 2 blocked/incomplete awaiting human intervention (including a task report whose result line reads Result: FAIL); 130 force-terminated by two consecutive Ctrl+C`)
process.exit(1)

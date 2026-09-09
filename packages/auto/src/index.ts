#!/usr/bin/env bun
import { lstat, rm, stat } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import { checkPrinciple } from "@opencode-ai/auto-core/check"
import { formatProjectConfig, legacyModeFallback, loadProjectConfig, mergeProjectConfig, saveProjectConfig, type ProjectConfig } from "@opencode-ai/auto-core/config"
import { implementPlan } from "@opencode-ai/auto-core/implement"
import { log, setInteractive, setLogFile, setVerbose } from "@opencode-ai/auto-core/log"
import { ensureGitignore, ensurePointer, runAll } from "@opencode-ai/auto-core/loop"
import { loadModes, type ModeSpec } from "@opencode-ai/auto-core/mode"
import { load, parse } from "@opencode-ai/auto-core/plan"
import { currentRound, establishRound, formatPhases, ledgerPath, nextRound, parsePhases, phaseText, readLedger, renderPlanScaffold, roundRoot } from "@opencode-ai/auto-core/phases"
import type { PermissionMode, SubtaskMode } from "@opencode-ai/auto-core/runner"
import { usePromptLibrary, renderText } from "@opencode-ai/auto-core/template"
import templatePlan from "@opencode-ai/auto-core/templates/PLAN.md" with { type: "file" }
import templateConfig from "@opencode-ai/auto-core/templates/opencode.json" with { type: "file" }
import templateAgent from "@opencode-ai/auto-core/templates/.opencode/agent/auto.md" with { type: "file" }

const args = process.argv.slice(2)
const command = args[0]

const flags = new Map<string, string>()
const positional: string[] = []
// --agent/--server/--wait-answer/--wait-between/--context-limit/--commit/--subtask/
// --prompt/--review/--early-review/--permission/--idle-time/--idle-max/--mode/
// --final-review/--phases/--source-dir/--source-path/--dest-dir/--implement-file/
// --implement-prompt 带值(吞掉下一个
// token);--verbose/--interactive/--dryrun/--early/--verify/--test-by-driver/
// --handover-test/--new-session/--auto-number/--no-auto-number 是布尔选项,出现即
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
  "dest-dir",
  "implement-file",
  "implement-prompt",
])
const BOOLEAN_FLAGS = new Set(["verbose", "interactive", "dryrun", "early", "verify", "test-by-driver", "handover-test", "new-session", "auto-number", "no-auto-number"])
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
// 未知选项拦截: 白名单之外的旗标一律报错退出 1,防拼错被静默忽略。宪法级与
// 历史选项对 init/continue/run 有专属拦截报文,此处放行交由其后各自处理;
// check/status 不接受任何选项,出现旗标即拒绝。
const KNOWN_FLAGS = new Set([...VALUE_FLAGS, ...BOOLEAN_FLAGS, "continue", "commit-subtask", "verify-idle", "verify-max"])
const FLAGLESS = command === "check" || command === "status"
for (const key of flags.keys()) {
  if (!FLAGLESS && KNOWN_FLAGS.has(key)) continue
  const similar = !FLAGLESS && key ? [...KNOWN_FLAGS].filter((name) => name.startsWith(key)).map((name) => `--${name}`) : []
  console.error(`未知选项 --${key}${similar.length ? `(是否想用 ${similar.join(" / ")}?)` : ""}${FLAGLESS ? ": check/status 只接受目录参数,不接受选项" : ";运行不带子命令的 opencode-auto 可查看用法"}`)
  process.exit(1)
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
  for (const key of ["mode", "agent", "context-limit", "subtask", "verify", "idle-time", "idle-max", "commit", "test-by-driver", "handover-test", "auto-number", "no-auto-number", "phases", "source-dir", "source-path", "dest-dir"]) {
    if (flags.has(key)) {
      const flag = key === "mode" ? "-m/--mode" : `--${key}`
      const fix =
        key === "source-dir" || key === "source-path"
          ? "opencode-auto init <dir> --source-dir <目录> --source-path <相对路径>"
          : key === "auto-number" || key === "no-auto-number"
            ? "opencode-auto init <dir> --auto-number(关闭用 --no-auto-number)"
            : `opencode-auto init <dir> ${key === "mode" ? "-m" : `--${key}`} <值>`
      console.error(`${flag} 已在 init 固化(.opencode/auto/config.json)。变更方式: ${fix},或直接编辑该文件`)
      process.exit(1)
    }
  }
  if (flags.has("commit-subtask")) {
    console.error("--commit-subtask 已移除: 提交现在由 driver 在每个会话结束后统一执行(收回 AI 提交权),如需关闭用 opencode-auto init <dir> --commit false")
    process.exit(1)
  }
  // --implement-file/--implement-prompt 是 init 专用的单阶段(m)快捷模式选项
  // (计划生成会话是一次性的,产物 PLAN.md 经人工审核后另行调用 run 执行),不是
  // run 的选项。
  for (const key of ["implement-file", "implement-prompt"]) {
    if (flags.has(key)) {
      console.error(`--${key} 是 init 专用的快捷模式选项: 用它生成 PLAN.md、人工审核无误后再调用 opencode-auto run ${directory} 执行,run 本身不接受该选项`)
      process.exit(1)
    }
  }
  // 续轮迁移是独立子命令(continue),不是任何命令的选项。
  if (flags.has("continue")) {
    console.error("--continue 不是选项: 续轮迁移用独立子命令 opencode-auto continue <dir>(上一轮阶段化迁移全部完成后开启新一轮)")
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
  if (await legacyModeFallback(directory)) log("ℹ 模式沿用旧位置 .auto/config.json 的持久化值,重跑 init 可固化完整配置")
  if (config.testByDriver) {
    log(
      `⚙ 测试由 driver 执行: 会话把脚本放 test/、把脚本路径写入 tmp/test.sh 请求执行,driver 合并 stdout/stderr 落 tmp/test.<n>.out 并反馈回会话判断` +
        (config.handoverTest ? ";测试失败且上下文达上限时写交接文档换新会话" : ""),
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
  // 开始);续轮(docs/R-NN 轮次目录最大号 > 1)时带轮次标注。台账非法仅提示,
  // runAll 的阶段路由会以环境错误退出 1。
  if (config.phases !== "m") {
    try {
      const round = await currentRound(directory)
      log(`阶段${round > 1 ? `(第 ${round} 轮)` : ""}: ${formatPhases(config.phases, (await readLedger(directory)).done)}`)
    } catch (error) {
      log(`⚠ 阶段台账(${await ledgerPath(directory)})非法: ${error instanceof Error ? error.message : String(error)}`)
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
    destDir: config.destDir,
    testByDriver: config.testByDriver,
    handoverTest: config.handoverTest,
    autoNumber: config.autoNumber,
    // --new-session: 中断恢复时不复用被中断的旧会话(仅跳过复用,阶段精确重入保留)。
    newSession: flags.has("new-session") && flags.get("new-session") !== "false",
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

if (command === "init" || command === "continue") {
  // 项目宪法选项在 init 固化(设计文档 §B): 仅写命令行显式给出的键,未给出的
  // 键保留既有配置(新项目取内置缺省)→ init 兼具创建与修订(amend)两种身份,
  // 重复 init 无参数不重置已有配置。值域校验复用既有 parse*(与配置文件侧
  // validateProjectConfig 同源)。
  //
  // continue 子命令(续轮迁移,设计文档 docs/phases-design.md M 节)= init 的
  // amend 机制 + 轮首建立新一轮轮次目录: 上一轮阶段化迁移全部完成后开启新一轮,
  // 让迁移结果与源更加完整、一致。复用 init 的解析/合并/模板与标记块维护,差异
  // 仅在: ① 前置校验(既有 phases ≠ "m" 且台账全覆盖);② 轮首建立
  // (establishRound: 建 docs/R-(N+1)/、根 PLAN.md 链接重指轮内、AGENTS.md.bak
  // 快照);③ 迁移同一性选项(-m/--mode 与迁移参数)跨轮固定,显式给出即用法错误。
  if (command === "init" && flags.has("continue")) {
    console.error("--continue 不是选项: 续轮迁移用独立子命令 opencode-auto continue <dir>(上一轮阶段化迁移全部完成后开启新一轮)")
    process.exit(1)
  }
  const cont = command === "continue"
  if (cont) {
    for (const key of ["mode", "source-dir", "source-path", "dest-dir"]) {
      if (!flags.has(key)) continue
      console.error(
        `${key === "mode" ? "-m/--mode" : `--${key}`} 跨轮固定,continue 时不可变更: 续轮是同一迁移的继续(上一轮结论以同一源、同一目标为前提)。` +
          "如需更换迁移对象或场景,请在新目录 init 新项目",
      )
      process.exit(1)
    }
    if (flags.has("implement-file") || flags.has("implement-prompt")) {
      console.error("--implement-file/--implement-prompt 是 init 专用的单阶段(m)快捷模式选项: continue 用于阶段化流程续轮,不支持")
      process.exit(1)
    }
  }
  if (flags.has("commit-subtask")) {
    console.error("--commit-subtask 已移除: 提交现在由 driver 在每个会话结束后统一执行(收回 AI 提交权),如需关闭用 --commit false")
    process.exit(1)
  }
  // --implement-file/--implement-prompt(init 单阶段 m 快捷模式,设计见文件尾用法
  // 文本): 二选一,不与继续调用叠加使用;值须非空。文件存在性与 phases 兼容性
  // 校验放在 existing 配置装载之后(§下文)。
  if (flags.has("implement-file") && flags.has("implement-prompt")) {
    console.error("--implement-file 与 --implement-prompt 二选一: 二者是同一快捷模式的两种输入来源,不要同时给出")
    process.exit(1)
  }
  if (flags.has("implement-file") && !flags.get("implement-file")?.trim()) {
    console.error("--implement-file 需要非空的文件路径")
    process.exit(1)
  }
  if (flags.has("implement-prompt") && !flags.get("implement-prompt")?.trim()) {
    console.error("--implement-prompt 需要非空的提示词文本")
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
  // --source-dir/--source-path/--dest-dir: 迁移参数。布局约定: 位置参数是 driver
  // 工作目录,迁移源在 <工作目录>/<source-dir>(source-path 为其下的模块相对路径)、
  // 迁移目标在 <工作目录>/<dest-dir>——driver 流程文件(PLAN.md/docs/ 等)与迁移
  // 产出经 dest-dir 隔离。source 两键必须成对给出(拒绝 <src-dir>/<src-path> 拼接
  // 形式);存在性只在 init 校验,run 不再校验(源系统可能已下线)。dest-dir 独立
  // 固化/修订(不校验存在性,目标目录常由迁移过程创建)。
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
    const dirIsDir = await stat(join(directory, sourceDir)).then((s) => s.isDirectory()).catch(() => false)
    const pathExists = await stat(join(directory, sourceDir, sourcePath)).then(() => true).catch(() => false)
    if (!dirIsDir || !pathExists) {
      console.error(`--source-dir 须为工作目录下现存目录且 --source-path 在其下存在: ${sourceDir} 与 ${sourcePath}`)
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
  if (destDir !== undefined) explicit.destDir = destDir
  // --test-by-driver / --handover-test: 与 --verify 同为布尔宪法级选项,init/continue
  // 接受(裸选项或 true 启用、false 关闭),经 explicit 合并(amend 语义)。二者不属
  // 迁移同一性选项,continue 可按轮修订。
  if (flags.has("test-by-driver")) explicit.testByDriver = flags.get("test-by-driver") !== "false"
  if (flags.has("handover-test")) explicit.handoverTest = flags.get("handover-test") !== "false"
  // --auto-number/--no-auto-number: 一对布尔开关(启用/关闭自动编号),同为布尔
  // 宪法级选项,经 explicit 合并(amend 语义);两者同现自相矛盾,为用法错误。
  if (flags.has("auto-number") && flags.has("no-auto-number") && flags.get("auto-number") !== "false" && flags.get("no-auto-number") !== "false") {
    console.error("--auto-number 与 --no-auto-number 是一对互斥开关,不要同时使用")
    process.exit(1)
  }
  if (flags.has("auto-number") && flags.get("auto-number") !== "false") explicit.autoNumber = true
  if (flags.has("no-auto-number") && flags.get("no-auto-number") !== "false") explicit.autoNumber = false
  let existing: ProjectConfig
  try {
    existing = await loadProjectConfig(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  // --implement-file/--implement-prompt 快捷模式(单阶段 m): 生效 phases 依赖
  // existing.phases(未显式给出 --phases 时沿用既有配置)才能算出,故校验放在
  // existing 装载之后;--implement-file 的文件存在性同样在此校验(读盘前的用法
  // 校验已尽量前置,存在性判断天然需要 I/O)。
  const implementFile = flags.get("implement-file")
  const implementPrompt = flags.get("implement-prompt")
  let implementFilePath: string | undefined
  if (implementFile !== undefined || implementPrompt !== undefined) {
    const effectivePhases = phases ?? existing.phases
    if (effectivePhases !== "m") {
      console.error(
        `--implement-file/--implement-prompt 仅用于单阶段(phases = "m")快捷模式,` +
          `${phases !== undefined ? "本次给出的 --phases" : "既有配置 phases"} 为 "${effectivePhases}"。` +
          `请先 opencode-auto init <dir> --phases m 切换(新项目不传 --phases 缺省即 m)后再使用该快捷模式`,
      )
      process.exit(1)
    }
    if (implementFile !== undefined) {
      implementFilePath = resolve(implementFile)
      const fileOk = await stat(implementFilePath).then((s) => s.isFile()).catch(() => false)
      if (!fileOk) {
        console.error(`--implement-file 指定的文件不存在或不是常规文件: ${implementFilePath}`)
        process.exit(1)
      }
    }
  }
  // handoverTest 须搭配 testByDriver: 显式给出时按本次生效值校验(未显式给出
  // test-by-driver 则回落既有配置值);amend 关闭 test-by-driver 而保留既有
  // handoverTest=true 亦在此拦截。
  {
    const effectiveTestByDriver = explicit.testByDriver ?? existing.testByDriver
    const effectiveHandoverTest = explicit.handoverTest ?? existing.handoverTest
    if (effectiveHandoverTest && !effectiveTestByDriver) {
      console.error(
        `${explicit.handoverTest !== undefined ? "--handover-test" : "既有 handoverTest"} 需搭配 --test-by-driver 一起使用: ` +
          "测试交接只在测试由 driver 执行时才有意义。修订方式: opencode-auto init <dir> --test-by-driver --handover-test,或直接编辑 .opencode/auto/config.json",
      )
      process.exit(1)
    }
  }
  // 阶段台账(ledgerPath: 新布局轮内 docs/R-NN/phases.md,旧布局根 docs/phases.md)
  // 是推导式状态载体;非法即环境错误退出 1(报文给人工修订指引)。台账非空时显式
  // 改 --phases 须满足前缀护栏。
  let ledgerDone: string
  try {
    ledgerDone = (await readLedger(directory)).done.join("")
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  // continue 前置校验(按既有配置判定,不看向新 --phases 值): 仅阶段化项目、且
  // 上一轮已全部完成——台账覆盖既有 phases 的全部字母。轮首建立后新一轮台账
  // 为空(新轮目录恒空),新一轮 --phases 不受前缀护栏约束(从头规划,任何合法值可改)。
  if (cont) {
    if (existing.phases === "m") {
      console.error(
        `continue 仅用于阶段化流程项目: 当前配置 phases = "m"(无阶段声明的单次运行,没有轮的概念)。` +
          `可先 opencode-auto init <dir> --phases <admtvk 子序列含 m> 开启阶段化流程`,
      )
      process.exit(1)
    }
    if (phases === "m") {
      console.error('continue 用于阶段化流程的续轮,--phases 不可为 "m"')
      process.exit(1)
    }
    const declared = [...existing.phases]
    const outside = [...ledgerDone].filter((letter) => !declared.includes(letter))
    if (outside.length) {
      console.error(
        `continue 前置检查失败: ${await ledgerPath(directory)} 台账记录了 phases(${existing.phases})之外的阶段字母: ${outside.join("、")}。` +
          "请人工修订该文件(回退规程见 README)后再续轮",
      )
      process.exit(1)
    }
    const missing = declared.filter((letter) => !ledgerDone.includes(letter))
    if (missing.length) {
      console.error(
        `continue 要求上一轮已全部完成: 阶段台账(${await ledgerPath(directory)})${ledgerDone ? "" : "为空"}、尚缺 ${missing.join("、")}(phases ${existing.phases})。` +
          `请先运行 opencode-auto run ${directory} 完成本轮`,
      )
      process.exit(1)
    }
  }
  if (!cont && flags.has("phases") && ledgerDone && !phases!.startsWith(ledgerDone)) {
    console.error(
      `--phases 新值 "${phases}" 与阶段台账(${await ledgerPath(directory)})不兼容: 台账已记录完成阶段 "${ledgerDone}",须构成新值的前缀。` +
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
  // 自动编号由阶段规划会话消费编号记录;phases = "m" 没有规划会话(PLAN.md 由
  // 人工维护),开关不产生效果,提示一次。
  if (config.autoNumber && config.phases === "m") {
    console.log('ℹ 自动编号(--auto-number)在 phases = "m" 下无规划会话消费编号记录,开关不产生效果(PLAN.md 编号由人工维护)')
  }
  // 提示词库: 装载目标目录 .opencode/auto/prompts/ 覆盖(协议校验失败即退出);
  // 无 -p 时不渲染提示词,提前装载可在 init 阶段就暴露覆盖问题。
  try {
    usePromptLibrary(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  // 阶段化 → m 互切: 根 PLAN.md 若是轮次符号链接,还原为普通文件(内容 = 链接
  // 目标现状;轮内文件不动)——phases = "m" 纯人工模式无轮次概念,根 PLAN.md
  // 维持普通文件。
  if (config.phases === "m") {
    const rootPlan = resolve(directory, "PLAN.md")
    if (await lstat(rootPlan).then((s) => s.isSymbolicLink(), () => false)) {
      const linked = await Bun.file(rootPlan).text()
      await rm(rootPlan, { force: true })
      await Bun.write(rootPlan, linked)
      console.log("已还原: PLAN.md(轮次符号链接 → 普通文件;轮次目录内容保留)")
    }
  }
  // `type: "file"` 导入会被嵌入编译产物,保证独立二进制可用。阶段化流程
  // (phases ≠ "m")下 PLAN.md 不在此写——由下方 establishRound 建轮次目录并以
  // 空模板作轮内 PLAN.md 初值(规划会话填充,B.1),根 PLAN.md 为轮内符号链接。
  const templates: Record<string, string> = {
    ...(config.phases === "m" ? { "PLAN.md": templatePlan } : {}),
    "opencode.json": templateConfig,
    ".opencode/agent/auto.md": templateAgent,
  }
  for (const [file, source] of Object.entries(templates)) {
    const target = resolve(directory, file)
    const raw = await Bun.file(source).text()
    // PLAN.md 与 agent 契约按 config.verify 条件渲染: 未启用任务级验收时,
    // 产出物不含 verify 相关描述(verify 字段示例、driver 验收语义等)。
    const content = file === "opencode.json" ? raw : renderText(raw, { verify: config.verify, testByDriver: config.testByDriver })
    const existing = await Bun.file(target).text().catch(() => undefined)
    if (existing !== undefined && (existing === content || file !== ".opencode/agent/auto.md")) {
      console.log(`跳过已存在: ${file}`)
      continue
    }
    await Bun.write(target, content)
    console.log(existing === undefined ? `已创建: ${file}` : `已替换(与模板不一致): ${file}`)
  }
  // 幂等维护 AGENTS.md 的 opencode-auto 块: 指针块、验证原则块、测试执行原则块、
  // 提交原则块与维护规则块各自独立、只追加;验证/测试原则块仅对应开关启用时补写,
  // 未启用时移除已存在的块(机制不存在,AGENTS.md 不保留其描述)。
  const ensured = await ensurePointer(directory, { verify: config.verify, testByDriver: config.testByDriver })
  console.log(ensured.pointer ? "已补写: AGENTS.md 指针块" : "跳过已存在: AGENTS.md 指针块")
  if (config.verify) {
    console.log(ensured.principle ? "已补写: AGENTS.md 验证原则块" : "跳过已存在: AGENTS.md 验证原则块")
  } else if (ensured.principleRemoved) {
    console.log("已移除: AGENTS.md 验证原则块(任务级验收未启用)")
  }
  if (config.testByDriver) {
    console.log(ensured.test ? "已补写: AGENTS.md 测试执行原则块" : "跳过已存在: AGENTS.md 测试执行原则块")
  } else if (ensured.testRemoved) {
    console.log("已移除: AGENTS.md 测试执行原则块(测试由 driver 执行未启用)")
  }
  console.log(ensured.commit ? "已补写: AGENTS.md 提交原则块" : "跳过已存在: AGENTS.md 提交原则块")
  console.log(ensured.maint ? "已补写: AGENTS.md 维护规则块" : "跳过已存在: AGENTS.md 维护规则块")
  console.log(ensured.refs ? "已补写: AGENTS.md 引用规范块" : "跳过已存在: AGENTS.md 引用规范块")
  if (await ensureGitignore(directory)) console.log("已更新: .gitignore 忽略 tmp/ 与 .auto/(driver 工作目录与运行时状态)")

  // 轮首建立(轮次专用目录 docs/R-NN,phases-design.md M 节;须在 ensurePointer
  // 之后,AGENTS.md.bak 快照才含各原则块): init 建当前轮(全新项目 = R-01,幂等
  // ——轮内 PLAN.md 已存在不重写,根链接重建不漂移),占位模板态 PLAN 以空模板
  // 作初值;continue 建新一轮 R-(N+1)(前置校验已过),轮内 PLAN.md 恒为空模板
  // (新轮目录恒空,上一轮结论经 prevRoundDigest 注入新一轮首个阶段规划会话)。
  // 旧布局在途轮次(根 docs/phases.md 台账仍在、本轮无轮目录)不打断: 跳过建立,
  // 本轮维持旧布局,下次 continue 起进入新布局。
  let newRound: number | undefined
  if (config.phases !== "m") {
    const legacyInflight = !cont && !(await roundRoot(directory, await currentRound(directory))) && (await Bun.file(join(directory, "docs", "phases.md")).exists())
    if (legacyInflight) {
      console.log("ℹ 旧布局轮次在途(根 docs/phases.md 台账仍在): 本轮维持旧布局,下次 continue 起进入轮次目录布局")
      // 旧布局兜底: 根 PLAN.md 缺失(人工删除/中断现场)时仍补空模板,维持 amend 语义
      const rootPlan = resolve(directory, "PLAN.md")
      if (!(await Bun.file(rootPlan).exists())) {
        await Bun.write(rootPlan, renderPlanScaffold(config.verify))
        console.log("已创建: PLAN.md(空模板,由阶段规划会话填充)")
      }
    } else {
      // init 场景: 根 PLAN.md 为占位模板态(从未编辑的 <任务标题> 占位任务)时
      // 以空模板作轮内初值;真实任务内容拷贝为初值(模式互切 m → 阶段化)。
      let plan: string | undefined
      if (!cont) {
        const rootPlan = resolve(directory, "PLAN.md")
        const isLink = await lstat(rootPlan).then((s) => s.isSymbolicLink(), () => false)
        const existing = isLink ? undefined : await Bun.file(rootPlan).text().catch(() => undefined)
        if (existing !== undefined && isPristinePlan(existing)) plan = renderPlanScaffold(config.verify)
      }
      try {
        const established = await establishRound(directory, {
          round: cont ? await nextRound(directory) : undefined,
          plan: cont ? renderPlanScaffold(config.verify) : plan,
          verify: config.verify,
        })
        newRound = cont ? established.round : undefined
        console.log(`✓ 轮次目录: ${established.root}/(PLAN.md、阶段台账 phases.md、阶段归档与知识文档均落轮内,落盘即永久)`)
        console.log(
          established.linked
            ? `✓ 根 PLAN.md → ${established.root}/PLAN.md(相对符号链接,单一事实源)`
            : `⚠ 根 PLAN.md 符号链接创建失败,已兜底为轮内副本(写不联动,以 ${established.root}/PLAN.md 为准)`,
        )
      } catch (error) {
        console.error(`轮首建立失败: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
      }
    }
  }

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
  // --implement-file/--implement-prompt 快捷模式(单阶段 m): 计划生成会话直接
  // 编辑填充 PLAN.md,与阶段规划会话同款机制——这是 init 唯一会启动 AI 会话的
  // 路径(§B.1 的"init 不启动会话"原则对通常路径不变,此快捷模式是显式选择)。
  // PLAN.md 当前必须是占位/空模板态: 会话开始前 reset 会无条件清空 PLAN.md,已
  // 有正式任务时拒绝执行,防止误覆盖人工或此前生成的计划。
  if (implementFile !== undefined || implementPrompt !== undefined) {
    const currentPlan = await Bun.file(join(directory, "PLAN.md")).text().catch(() => undefined)
    if (currentPlan !== undefined && !isPristinePlan(currentPlan)) {
      console.error(
        "PLAN.md 已包含正式任务,--implement-file/--implement-prompt 仅用于从空白/占位状态生成新计划: " +
          "如需重新生成,请先备份并清空 PLAN.md(或删除后重新运行 init)",
      )
      process.exit(1)
    }
    const brief = await Bun.file(join(directory, ".opencode", "auto", "brief.md")).text().catch(() => undefined)
    console.log(`▶ 计划生成会话输入: ${implementFilePath !== undefined ? `计划文件 ${implementFilePath}` : "实施提示词"}`)
    const result = await implementPlan(
      directory,
      {
        file: implementFilePath,
        content: implementFilePath !== undefined ? await Bun.file(implementFilePath).text() : implementPrompt!,
        brief,
      },
      { agent: config.agent, commit: config.commit, contextLimit: config.contextLimit * 1000, verify: config.verify, mode: modes[modeName] },
    )
    if (result.type === "blocked") {
      console.error(`⏸ 计划生成会话受阻(隐性阻塞,请检查后重新运行):\n${result.question}`)
      process.exit(2)
    }
    console.log(`✓ 计划生成完成: PLAN.md 已填入 ${result.count} 个任务`)
    console.log(`人工审核 PLAN.md 无误后运行: opencode-auto run ${directory}`)
    process.exit(0)
  }
  // 结束语按 phases 分两态: "m" 维持"编辑 PLAN.md"现状;阶段化流程下 PLAN.md
  // 由阶段规划会话填充,不提示手工编辑。continue 下新轮目录恒空(台账为空),首个
  // 阶段 = 新 phases 的第一个字母;另打新一轮横幅。
  if (config.phases === "m") {
    console.log(promptText !== undefined ? `brief 已记录,运行: opencode-auto run ${directory} 开始任务规划` : `编辑 PLAN.md 填入任务后运行: opencode-auto run ${directory}`)
    process.exit(0)
  }
  const current = parsePhases(config.phases)!.find((phase) => !(cont ? "" : ledgerDone).includes(phase))
  if (cont) {
    console.log(`已开启第 ${newRound} 轮继续迁移: 在既有成果上让迁移结果与源更加完整、一致`)
  }
  console.log(
    `${promptText !== undefined ? "brief 已记录," : ""}运行: opencode-auto run ${directory}${current ? ` 开始 ${current}(${phaseText(current)})阶段规划` : "(全部阶段已完成)"}`,
  )
  process.exit(0)
}

// check: ①启发式检查 AGENTS.md 与 PLAN.md 中是否有与"提交执行权在 driver"原则
// (及 verify 启用时的"验证执行权在 driver"、testByDriver 启用时的"测试/编译
// 等命令执行权在 driver"原则)相违背的描述;②引用检查(stable-refs P4)——
// 全量活文档(docs/**/*.md,排除 docs/phases/**)扫描失效引用(路径不存在 /
// 行号超出文件总行数)。任一命中退出码 1,供人工修订。验证/测试类检查是否
// 启用由 checkPrinciple 依配置决定,verifyOn/testOn 仅用于调整报文措辞。
if (command === "check") {
  const { findings, notes, refs, verifyOn, testOn } = await checkPrinciple(directory)
  const active = [
    ...(verifyOn ? ["验证"] : []),
    ...(testOn ? ["测试"] : []),
    "提交",
  ].join("/")
  const detail = [
    ...(verifyOn ? [] : ["验证类未启用(任务级验收关闭)"]),
    ...(testOn ? [] : ["测试类未启用(测试由 driver 执行关闭)"]),
  ].join(";")
  console.log(`检查 ${directory}: ${active}执行权原则${detail ? `(${detail})` : ""} + 文档引用`)
  for (const note of notes) console.log(`ℹ ${note}`)
  if (!findings.length && !refs.length) {
    console.log(`✓ 未发现与${active}原则相违背的描述,文档引用检查全部通过`)
    process.exit(0)
  }
  for (const finding of findings) {
    console.log(`⚠ ${finding.file}${finding.task ? `(${finding.task})` : ""}:${finding.line}: ${finding.text}`)
  }
  for (const ref of refs) {
    console.log(`⚠ 失效引用 ${ref.file}:${ref.line} → ${ref.path}(${ref.problem === "beyond-eof" ? "行号超出文件总行数" : "路径不存在"}): ${ref.text}`)
  }
  const summary = [
    ...(findings.length
      ? [
          `${findings.length} 处可能违背原则的描述(启发式检查,请人工确认后修订` +
            `${verifyOn ? ";验收标准统一写在任务的 verify 字段" : ""}${testOn ? ";编译/测试/构建/lint 等命令统一写成脚本放 test/ 由 driver 执行" : ""})`,
        ]
      : []),
    ...(refs.length ? [`${refs.length} 处失效引用(更新为现行路径,或行内标注 已删除/已归档/历史 豁免)`] : []),
  ]
  console.log(`发现 ${summary.join("与")}`)
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
        const round = await currentRound(directory)
        console.log(`阶段${round > 1 ? `(第 ${round} 轮)` : ""}: ${formatPhases(config.phases, (await readLedger(directory)).done)}`)
      } catch (error) {
        console.log(`⚠ 阶段台账(${await ledgerPath(directory)})非法: ${error instanceof Error ? error.message : String(error)}`)
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
  opencode-auto init [dir] [-p|--prompt <brief-text>] [-m|--mode <name>] [--agent <name>] [--subtask [off|auto|ondemand]] [--verify [true|false]] [--idle-time [1-120]] [--idle-max [1-1440]] [--commit [true|false]] [--context-limit [n]] [--phases <admtvk 子序列含 m>] [--source-dir <dir> --source-path <相对路径>] [--dest-dir <相对路径>] [--test-by-driver [true|false]] [--handover-test [true|false]] [--auto-number|--no-auto-number] [--implement-file <file>|--implement-prompt <text>]
  opencode-auto continue [dir] [--phases <admtvk 子序列含 m>] [-p|--prompt <brief-text>] [--agent <name>] [--subtask [off|auto|ondemand]] [--verify [true|false]] [--idle-time [1-120]] [--idle-max [1-1440]] [--commit [true|false]] [--context-limit [n]] [--test-by-driver [true|false]] [--handover-test [true|false]] [--auto-number|--no-auto-number]
  opencode-auto run [dir] [--server <url>] [--verbose [true|false]] [--interactive|-i] [--wait-answer [1-60]] [--wait-between [1-60]] [--permission [auto-allow|ask-allow|ask-deny|ask-fail]] [--review [1-10]] [--early] [--early-review [1-10]] [--final-review [1-5]] [--dryrun [true|false]] [--new-session]
  opencode-auto check [dir]
  opencode-auto status [dir]

选项: 项目宪法选项(-m/--mode、--agent、--context-limit、--subtask、--verify、--idle-time、--idle-max、--commit、--test-by-driver、--handover-test、--auto-number/--no-auto-number、--phases、--source-dir/--source-path、--dest-dir)经 init 固化到 .opencode/auto/config.json(版本化、随仓库共享、人工可编辑;重复 init 无参数不重置已有配置,仅显式给出的键被改写),run 出现即用法错误
       --new-session 中断恢复时不复用被中断的旧会话、开新会话继续(仅跳过会话复用,阶段精确重入不受影响;缺省复用存活的被中断会话)
       -m/--mode 提示词级场景模式(内置 migrate;目标目录 .opencode/auto/modes/<name>.md 可新增或覆盖,新增模式无需改源码)
       -p/--prompt 项目意图文本,写入 .opencode/auto/brief.md,由阶段规划会话消费(init 不启动 AI 会话)
       --phases <admtvk 子序列含 m> 阶段化流程(a 分析 → d 设计 → m 迁移实现 → t 测试 → v 验收 → k 知识提炼;"m" 缺省 = 单次运行;台账非空时修订须满足前缀护栏,详见 README)
       --source-dir <dir> --source-path <相对路径> 迁移源参数(源系统目录 + 源模块相对路径,必须成对给出;两者均为相对 <dir> 的相对路径,init 时校验存在性)
       --dest-dir <相对路径> 迁移目标目录(相对 <dir>): driver 工作目录与迁移目标经它隔离,迁移产出的代码写入 <dir>/<dest-dir>
       --verify [true] 启用 driver 的任务级三段式验收(缺省不启用,任务收尾后直接标 done;--review 的质量审核改为串行执行)
       --commit [true] 会话后统一提交(缺省启用: 任何会话结束且 driver 完成状态写入后,driver 递归提交全部改动,git 历史即 AI 变更的审计轨迹;false 关闭)
       --final-review [1-5] 任务全部完成后进入终审闭环(audit → remediate → validate → finalize,validate 差距回退 audit;值为审计轮上限,裸选项 2;可与 --review 组合;终审任务本身即检验,强制不做任务级验收与逐任务审核)
       --test-by-driver [true] 编译/测试/构建/lint 等命令的执行权收归 driver(与 --verify 正交): 执行类会话不在会话内直接运行这类命令,改为把命令写成脚本放 test/ 目录、把脚本路径写入 tmp/test.sh 告知 driver 执行,driver 合并 stdout/stderr 落 tmp/test.<n>.out 后把退出码与输出文件反馈回会话由 AI 判断
       --handover-test 需搭配 --test-by-driver: 测试失败且会话上下文达到上限时,要求 AI 写交接文档(子任务会话为 docs/<任务>/S<两位序号>/testhandoff.md,整任务/修复轮为 docs/<任务>/testhandoff.md)后换新会话续跑,防止在超大上下文中反复试错
       --auto-number / --no-auto-number 自动编号开关(缺省 --auto-number = 启用,--no-auto-number 为关闭用退出开关): 任务编号(T-NNN)在目标目录永不重复——下一可用编号持久化在 .auto/next-task,阶段规划会话自该记录续接编号(不再每阶段从 T-001 重排);记录缺失(如 .auto/ 未随仓库共享的新克隆)时先经 AI 恢复会话通读归档 PLAN/docs 产物/git 历史推导下一编号并恢复记录,再继续规划
       --implement-file <file> / --implement-prompt <text> 单阶段(phases = "m")快捷模式,二选一: 依据指定的计划文件(全文注入)或直接给出的实施提示词,开一次性计划生成会话直接编辑填充 PLAN.md(与阶段规划会话同款机制,是 init 唯一会启动 AI 会话的路径);要求生效 phases 为 "m"(不兼容时先 --phases m 切换)且 PLAN.md 为占位/空模板态(已有正式任务时拒绝,防误覆盖);生成完成后需人工审核 PLAN.md,再另行调用 opencode-auto run <dir> 执行——之后逐个任务由 driver 的分解会话自动拆解为子任务推进,run 不接受这两个选项
       continue 子命令: 上一轮阶段化迁移全部完成后开启新一轮继续迁移(让迁移结果与源更加完整、一致)——轮首建立新一轮轮次目录 docs/R-NN/(本轮 PLAN.md、阶段台账、阶段归档与知识文档均落轮内,落盘即永久;根 PLAN.md 重建为指向轮内的相对符号链接,AGENTS.md 快照存轮内 AGENTS.md.bak),上一轮结论(最终阶段交接与迁移知识)注入新一轮首个阶段规划会话;-m/--mode 与迁移参数(--source-dir/--source-path/--dest-dir)跨轮固定、不可变更(出现即用法错误),--phases 与其余执行选项(含 --test-by-driver/--handover-test)、-p 可按轮修订(不受前缀护栏约束)

退出码: 0 全部完成,1 用法/环境错误(check 发现违背原则的描述时同),2 阻塞/未完成等待人工介入(含终审闭环熔断),130 被连续两次 Ctrl+C 强制终止`)
process.exit(1)

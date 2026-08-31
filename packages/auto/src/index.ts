#!/usr/bin/env bun
import { resolve } from "node:path"
import { checkPrinciple } from "./check"
import { log, setInteractive, setLogFile, setVerbose } from "./log"
import { ensureGitignore, ensurePointer, runAll } from "./loop"
import { loadModes, readPersistedMode, writePersistedMode, type ModeSpec } from "./mode"
import { load } from "./plan"
import { renderInit, type CommitMode } from "./prompt"
import { runOnce, type PermissionMode, type SubtaskMode } from "./runner"
import { manage } from "./server"
import { usePromptLibrary } from "./template"
import templatePlan from "../templates/PLAN.md" with { type: "file" }
import templateConfig from "../templates/opencode.json" with { type: "file" }
import templateAgent from "../templates/.opencode/agent/auto.md" with { type: "file" }

const args = process.argv.slice(2)
const command = args[0]

const flags = new Map<string, string>()
const positional: string[] = []
// --agent/--server/--wait-answer/--wait-between/--context-limit/--commit/--subtask/
// --prompt/--review/--early-review/--permission/--verify-idle/--verify-max/--mode/
// --final-review 带值(吞掉下一个 token);--verbose/--interactive/--dryrun/
// --commit-subtask/--early/--verify 是布尔选项,出现即 true,仅当紧随字面量
// true/false 时才吞掉它。均支持 --flag=value;--prompt 另有短选项 -p,--interactive
// 另有短选项 -i(布尔,不吞值),--mode 另有短选项 -m(镜像 -p 的吞值规则)。
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
  "verify-idle",
  "verify-max",
  "mode",
  "final-review",
])
const BOOLEAN_FLAGS = new Set(["verbose", "interactive", "dryrun", "commit-subtask", "early", "verify"])
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
  const commit = parseCommit(flags)
  if (commit === null) {
    console.error("--commit 取值为 subtask|task|once|none;缺省为 subtask")
    process.exit(1)
  }
  const subtask = parseSubtask(flags.get("subtask"))
  if (subtask === null) {
    console.error("--subtask 取值为 off|auto|ondemand;缺省为 auto")
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
  const contextLimit = parseContextLimit(flags.get("context-limit"))
  if (contextLimit === null) {
    console.error("--context-limit 取值为正整数(单位: 千 tokens);缺省为 64")
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
  // --verify: 启用 driver 的任务级三段式验收(脚本准备 → driver 执行 → 独立判定);
  // 缺省不启用——任务在收尾后直接标 done,不写 verified(--review 的审核改为串行)。
  const verify = flags.has("verify") && flags.get("verify") !== "false"
  // --verify-idle: verify 脚本的无进度判定窗口(两个输出文件持续无增长即终止);
  // --verify-max: 绝对时长上限(0 = 不设,只要持续有输出就永不限时)。
  const verifyIdle = parseVerifyIdle(flags.get("verify-idle"))
  if (verifyIdle === null) {
    console.error("--verify-idle 取值范围为 1..120(分钟);缺省为 10")
    process.exit(1)
  }
  const verifyMax = parseVerifyMax(flags.get("verify-max"))
  if (verifyMax === null) {
    console.error("--verify-max 取值范围为 1..1440(分钟);缺省不设上限")
    process.exit(1)
  }
  const mode = resolveModeFlag(directory, flags.get("mode"))
  const code = await runAll(directory, {
    // 缺省使用 init 生成的自主执行契约 agent(.opencode/agent/auto.md);
    // 显式指定时须为目标目录 .opencode/agent/ 下已定义的 agent。
    agent: flags.get("agent") ?? "auto",
    server: flags.get("server"),
    // interactive 隐含 verbose 记录级别(watch/变更文件监视照常运行并写入日志)。
    verbose: verbose || interactive,
    waitAnswer,
    waitBetween,
    commit,
    subtask,
    dryrun: flags.has("dryrun") && flags.get("dryrun") !== "false",
    contextLimit: contextLimit * 1000,
    review: earlyReview > 0 ? earlyReview : review,
    early,
    verify,
    permission,
    interactive,
    verifyIdleMs: verifyIdle * 60_000,
    verifyMaxMs: verifyMax > 0 ? verifyMax * 60_000 : undefined,
    mode,
    finalReview,
  })
  process.exit(code)
}

// --commit 缺省/裸选项 = subtask;--commit-subtask 为旧别名(true→subtask,
// false→task,即旧的默认行为);显式 --commit 优先。返回 null 表示取值非法。
function parseCommit(flags: Map<string, string>): CommitMode | null {
  const raw = flags.has("commit")
    ? flags.get("commit")
    : flags.has("commit-subtask")
      ? flags.get("commit-subtask") === "false"
        ? "task"
        : ""
      : undefined
  if (raw === undefined || raw === "") return "subtask"
  if (raw === "subtask" || raw === "task" || raw === "once" || raw === "none") return raw
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

// --verify-idle 缺省/裸选项 = 10(分钟);显式值须为 1..120 整数;返回 null 表示非法。
function parseVerifyIdle(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return 10
  const minutes = Number(raw)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) return null
  return minutes
}

// --verify-max 缺省/裸选项 = 0(不设绝对上限);显式值须为 1..1440 整数(分钟);
// 返回 null 表示取值非法。
function parseVerifyMax(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return 0
  const minutes = Number(raw)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return null
  return minutes
}

// -m/--mode 解析: 优先级 显式 -m > 持久化(.auto/config.json 的 mode)> 缺省
// migrate;成功后把生效模式写回持久化,跨天 run 忘带 -m 也能沿用。目标目录
// .opencode/auto/modes/<name>.md 可新增/覆盖模式(loadModes 合并)。模式文件
// 不合法或名称未注册时打印错误并以退出码 1 终止。
function resolveModeFlag(directory: string, raw: string | undefined): ModeSpec {
  let modes: Record<string, ModeSpec>
  try {
    modes = loadModes(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  const persisted = readPersistedMode(directory)
  const name = raw ?? persisted ?? "migrate"
  const mode = modes[name]
  if (!mode) {
    console.error(
      `--mode 取值须为已注册的模式(当前支持: ${Object.keys(modes).join(", ")});缺省为 migrate` +
        (persisted ? `,上次持久化: ${persisted}` : ""),
    )
    process.exit(1)
  }
  if (raw && persisted && raw !== persisted) {
    console.error(`⚠ 模式 "${raw}" 与上次持久化的 "${persisted}" 不一致(init 与 run 应使用相同模式),已更新持久化值`)
  }
  if (!raw && persisted && persisted !== "migrate") console.error(`ℹ 沿用上次持久化的模式: ${persisted}(显式 -m 可覆盖)`)
  writePersistedMode(directory, name)
  return mode
}

if (command === "init") {
  const mode = resolveModeFlag(directory, flags.get("mode"))
  // 提示词库: 装载目标目录 .opencode/auto/prompts/ 覆盖(协议校验失败即退出);
  // 无 -p 时不渲染提示词,提前装载可在 init 阶段就暴露覆盖问题。
  try {
    usePromptLibrary(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  // `type: "file"` 导入会被嵌入编译产物,保证独立二进制可用。
  const templates: Record<string, string> = {
    "PLAN.md": templatePlan,
    "opencode.json": templateConfig,
    ".opencode/agent/auto.md": templateAgent,
  }
  for (const [file, source] of Object.entries(templates)) {
    const target = resolve(directory, file)
    const content = await Bun.file(source).text()
    const existing = await Bun.file(target).text().catch(() => undefined)
    // .opencode/agent/auto.md 与模板不一致时总是替换,保证 agent 契约为最新版本;
    // 其余模板已存在则跳过(PLAN.md 可能已被用户编辑)。
    if (existing !== undefined && (existing === content || file !== ".opencode/agent/auto.md")) {
      console.log(`跳过已存在: ${file}`)
      continue
    }
    await Bun.write(target, content)
    console.log(existing === undefined ? `已创建: ${file}` : `已替换(与模板不一致): ${file}`)
  }
  // 幂等维护 AGENTS.md 的 opencode-auto 块: 指针块与验证原则块各自独立、只追加。
  const ensured = await ensurePointer(directory)
  console.log(ensured.pointer ? "已补写: AGENTS.md 指针块" : "跳过已存在: AGENTS.md 指针块")
  console.log(ensured.principle ? "已补写: AGENTS.md 验证原则块" : "跳过已存在: AGENTS.md 验证原则块")
  if (await ensureGitignore(directory)) console.log("已更新: .gitignore 忽略 tmp/ 与 .auto/logs/(driver 工作目录)")

  // -p/--prompt: 初始化完成后直接调用一次 AI,按提示词填充 PLAN.md 等文档,
  // 由用户审核后再运行 run。
  const promptText = flags.get("prompt")
  if (promptText !== undefined) {
    if (!promptText.trim()) {
      console.error("-p/--prompt 需要非空的提示词文本")
      process.exit(1)
    }
    const server = await manage(directory, flags.get("server"))
    try {
      const result = await runOnce(server.client, "初始化计划", renderInit(promptText, mode), {
        agent: flags.get("agent") ?? "auto",
        dir: directory,
        server,
      })
      if (result.type === "blocked") {
        console.error(`⏸ 初始化会话受阻:\n${result.question}`)
        process.exit(2)
      }
    } finally {
      server.close()
    }
    console.log("请审核 PLAN.md(必要时手工调整),确认后运行: opencode-auto run " + directory)
    process.exit(0)
  }
  console.log("编辑 PLAN.md 填入任务后运行: opencode-auto run " + directory)
  process.exit(0)
}

// check: 启发式检查 AGENTS.md 与 PLAN.md 中是否有与"验证执行权在 driver"原则
// 相违背的描述(要求会话亲自运行验证脚本/命令的语句);命中退出码 1,供人工修订。
if (command === "check") {
  const { findings, notes } = await checkPrinciple(directory)
  console.log(`检查 ${directory}: 验证执行权原则(任务级验证脚本与命令由 driver 执行,会话不亲自运行)`)
  for (const note of notes) console.log(`ℹ ${note}`)
  if (!findings.length) {
    console.log("✓ 未发现与验证原则相违背的描述")
    process.exit(0)
  }
  for (const finding of findings) {
    console.log(`⚠ ${finding.file}${finding.task ? `(${finding.task})` : ""}:${finding.line}: ${finding.text}`)
  }
  console.log(`发现 ${findings.length} 处可能违背原则的描述(启发式检查,请人工确认后修订;验收标准统一写在任务的 verify 字段)`)
  process.exit(1)
}

if (command === "status") {
  const plan = await load(resolve(directory, "PLAN.md"))
  for (const task of plan.tasks) {
    const extra = task.attempts ? ` (attempts: ${task.attempts})` : ""
    console.log(`[${task.status}] ${task.id} ${task.title}${extra}`)
  }
  process.exit(0)
}

console.error(`用法:
  opencode-auto init [dir] [-p|--prompt <prompt-text>] [-m|--mode <name>] [--agent <name>] [--server <url>]
  opencode-auto run [dir] [--agent <name>] [--server <url>] [-m|--mode <name>] [--verbose [true|false]] [--interactive|-i] [--wait-answer [1-60]] [--wait-between [1-60]] [--commit [subtask|task|once|none]] [--subtask [off|auto|ondemand]] [--verify [true|false]] [--review [1-10]] [--early] [--early-review [1-10]] [--final-review [1-5]] [--permission [auto-allow|ask-allow|ask-deny|ask-fail]] [--dryrun [true|false]] [--context-limit [n]] [--verify-idle [1-120]] [--verify-max [1-1440]]
  opencode-auto check [dir]
  opencode-auto status [dir]

选项: -m/--mode 提示词级场景模式(内置 migrate;目标目录 .opencode/auto/modes/<name>.md 可新增或覆盖,新增模式无需改源码;缺省 migrate,解析成功后持久化到 .auto/config.json 供后续 run 沿用)
      --verify [true] 启用 driver 的任务级三段式验收(缺省不启用,任务收尾后直接标 done;--review 的质量审核改为串行执行)
      --final-review [1-5] 任务全部完成后进入终审闭环(audit → remediate → validate → finalize,validate 差距回退 audit;值为审计轮上限,裸选项 2;可与 --review 组合)

退出码: 0 全部完成,1 用法/环境错误(check 发现违背原则的描述时同),2 阻塞/未完成等待人工介入(含终审闭环熔断),130 被连续两次 Ctrl+C 强制终止`)
process.exit(1)

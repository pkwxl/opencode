#!/usr/bin/env bun
import { resolve } from "node:path"
import { log, setInteractive, setLogFile, setVerbose } from "./log"
import { ensurePointer, runAll } from "./loop"
import { load } from "./plan"
import { renderInit, type CommitMode } from "./prompt"
import { runOnce, type SubtaskMode } from "./runner"
import { ensure } from "./server"
import templatePlan from "../templates/PLAN.md" with { type: "file" }
import templateConfig from "../templates/opencode.json" with { type: "file" }
import templateAgent from "../templates/.opencode/agent/auto.md" with { type: "file" }

const args = process.argv.slice(2)
const command = args[0]

const flags = new Map<string, string>()
const positional: string[] = []
// --agent/--server/--wait-answer/--wait-between/--context-limit/--commit/--subtask/
// --prompt 带值(吞掉下一个 token);--verbose/--interactive/--dryrun/--commit-subtask
// 是布尔选项,出现即 true,仅当紧随字面量 true/false 时才吞掉它。均支持 --flag=value;
// --prompt 另有短选项 -p,--interactive 另有短选项 -i(布尔,不吞值)。
const VALUE_FLAGS = new Set(["agent", "server", "wait-answer", "wait-between", "context-limit", "commit", "subtask", "prompt", "review"])
const BOOLEAN_FLAGS = new Set(["verbose", "interactive", "dryrun", "commit-subtask"])
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
  const code = await runAll(directory, {
    agent: flags.get("agent"),
    server: flags.get("server"),
    // interactive 隐含 verbose 记录级别(watch/变更文件监视照常运行并写入日志)。
    verbose: verbose || interactive,
    waitAnswer,
    waitBetween,
    commit,
    subtask,
    dryrun: flags.has("dryrun") && flags.get("dryrun") !== "false",
    contextLimit: contextLimit * 1000,
    review,
    interactive,
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

// --review 缺省(无此选项)= 0(不启用质量审核);裸选项 = 3;显式值须为 1..10
// 整数;返回 null 表示取值非法。
function parseReviewLimit(raw: string | undefined): number | null {
  if (raw === undefined) return 0
  if (raw === "") return 3
  const limit = Number(raw)
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) return null
  return limit
}

if (command === "init") {
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
  // 幂等维护 AGENTS.md 指针块: 只追加,从不改写已有内容。
  console.log((await ensurePointer(directory)) ? "已更新: AGENTS.md(追加 opencode-auto 指针块)" : "跳过已存在: AGENTS.md 指针块")

  // -p/--prompt: 初始化完成后直接调用一次 AI,按提示词填充 PLAN.md 等文档,
  // 由用户审核后再运行 run。
  const promptText = flags.get("prompt")
  if (promptText !== undefined) {
    if (!promptText.trim()) {
      console.error("-p/--prompt 需要非空的提示词文本")
      process.exit(1)
    }
    const server = await ensure(directory, flags.get("server"))
    try {
      const result = await runOnce(server.client, "初始化计划", renderInit(promptText), { agent: flags.get("agent"), dir: directory })
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

if (command === "status") {
  const plan = await load(resolve(directory, "PLAN.md"))
  for (const task of plan.tasks) {
    const extra = task.attempts ? ` (attempts: ${task.attempts})` : ""
    console.log(`[${task.status}] ${task.id} ${task.title}${extra}`)
  }
  process.exit(0)
}

console.error(`用法:
  opencode-auto init [dir] [-p|--prompt <prompt-text>] [--agent <name>] [--server <url>]
  opencode-auto run [dir] [--agent <name>] [--server <url>] [--verbose [true|false]] [--interactive|-i] [--wait-answer [1-60]] [--wait-between [1-60]] [--commit [subtask|task|once|none]] [--subtask [off|auto|ondemand]] [--review [1-10]] [--dryrun [true|false]] [--context-limit [n]]
  opencode-auto status [dir]

退出码: 0 全部完成,1 用法/环境错误,2 阻塞/未完成等待人工介入,130 被连续两次 Ctrl+C 强制终止`)
process.exit(1)

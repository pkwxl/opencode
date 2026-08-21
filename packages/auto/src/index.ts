#!/usr/bin/env bun
import { resolve } from "node:path"
import { setVerbose } from "./log"
import { load } from "./plan"
import { runAll } from "./loop"
import templatePlan from "../templates/PLAN.md" with { type: "file" }
import templateConfig from "../templates/opencode.json" with { type: "file" }
import templateAgent from "../templates/.opencode/agent/auto.md" with { type: "file" }

const args = process.argv.slice(2)
const command = args[0]

const flags = new Map<string, string>()
const positional: string[] = []
for (let i = 1; i < args.length; i++) {
  const arg = args[i]!
  if (arg.startsWith("--")) {
    flags.set(arg.slice(2), args[++i] ?? "")
    continue
  }
  positional.push(arg)
}
const directory = resolve(positional[0] ?? ".")

if (command === "run") {
  const verbose = flags.get("verbose") === "true" || flags.has("--verbose")
  setVerbose(verbose)
  const commitSubtask = flags.has("commit-subtask") && flags.get("commit-subtask") !== "false"
  const newSessionSubtask = flags.has("new-session-subtask") && flags.get("new-session-subtask") !== "false"
  const waitAnswer = parseWaitAnswer(flags.get("wait-answer"))
  if (waitAnswer === null) {
    console.error("--wait-answer 取值范围为 1..60(分钟);不带值时默认为 1")
    process.exit(1)
  }
  const code = await runAll(directory, {
    agent: flags.get("agent"),
    server: flags.get("server"),
    verbose,
    waitAnswer,
    commitSubtask,
    newSessionSubtask,
  })
  process.exit(code)
}

// --wait-answer 缺省(无此选项)= 0,总是立即自动答复;裸选项 = 默认 1 分钟;
// 返回 null 表示取值非法。
function parseWaitAnswer(raw: string | undefined): number | null {
  if (raw === undefined) return 0
  if (raw === "") return 1
  const minutes = Number(raw)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) return null
  return minutes
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
    if (await Bun.file(target).exists()) {
      console.log(`跳过已存在: ${file}`)
      continue
    }
    await Bun.write(target, await Bun.file(source).text())
    console.log(`已创建: ${file}`)
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
  opencode-auto init [dir]
  opencode-auto run [dir] [--agent <name>] [--server <url>] [--verbose <true|false>] [--wait-answer [1-60]] [--commit-subtask [true|false]] [--new-session-subtask [true|false]]
  opencode-auto status [dir]

退出码: 0 全部完成,1 用法/环境错误,2 阻塞等待人工介入`)
process.exit(1)

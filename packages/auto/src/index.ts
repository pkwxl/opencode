#!/usr/bin/env bun
import { resolve } from "node:path"
import { setVerbose } from "./log"
import { load } from "./plan"
import { runAll } from "./loop"

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
  const waitAnswer = parseWaitAnswer(flags.get("wait-answer"))
  if (waitAnswer === null) {
    console.error("--wait-answer 取值范围为 1..60(分钟);不带值时默认为 1")
    process.exit(1)
  }
  const code = await runAll(directory, { agent: flags.get("agent"), server: flags.get("server"), verbose, waitAnswer })
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
  const templates = new URL("../templates/", import.meta.url)
  for (const file of ["PLAN.md", "opencode.json", ".opencode/agent/auto.md"]) {
    const target = resolve(directory, file)
    if (await Bun.file(target).exists()) {
      console.log(`跳过已存在: ${file}`)
      continue
    }
    await Bun.write(target, await Bun.file(new URL(file, templates)).text())
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
  opencode-auto run [dir] [--agent <name>] [--server <url>] [--verbose <true|false>] [--wait-answer [1-60]]
  opencode-auto status [dir]

退出码: 0 全部完成,1 用法/环境错误,2 阻塞等待人工介入`)
process.exit(1)

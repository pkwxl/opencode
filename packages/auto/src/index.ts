#!/usr/bin/env bun
import { resolve } from "node:path"
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
  const code = await runAll(directory, { agent: flags.get("agent"), server: flags.get("server") })
  process.exit(code)
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
  opencode-auto run [dir] [--agent <name>] [--server <url>]
  opencode-auto status [dir]

退出码: 0 全部完成,1 用法/环境错误,2 阻塞等待人工介入`)
process.exit(1)

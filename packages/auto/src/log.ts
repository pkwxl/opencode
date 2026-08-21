// Verbose mode prefixes every output line with the current local time so a
// human watching the terminal can follow the timeline of events.
import { mkdirSync, openSync, writeSync } from "node:fs"
import { join } from "node:path"

let verbose = false
// run 模式下的日志文件描述符;writeSync 逐条直写,进程崩溃或被 kill 也不丢
// 已输出的内容。
let fd: number | undefined

export function setVerbose(on: boolean) {
  verbose = on
}

// 每次 run 在目标目录的 .auto/logs/ 下新建一个日志文件,此后 log 的全部
// 输出在打印到终端的同时同步写入该文件。返回日志文件路径。
export function setLogFile(directory: string): string {
  const dir = join(directory, ".auto", "logs")
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")
  const path = join(dir, `run-${stamp}.log`)
  fd = openSync(path, "a")
  return path
}

export function log(...args: unknown[]) {
  const text = args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" ")
  const stamp = new Date().toTimeString().slice(0, 8)
  const output = verbose ? text.split("\n").map((line) => `[${stamp}] ${line}`).join("\n") : text
  console.log(output)
  if (fd !== undefined) writeSync(fd, output + "\n")
}

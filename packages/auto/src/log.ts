// Verbose mode prefixes every output line with the current local time so a
// human watching the terminal can follow the timeline of events.
import type { Interface } from "node:readline/promises"
import { mkdirSync, openSync, writeSync } from "node:fs"
import { join } from "node:path"

// verbose = 日志文件的记录级别(明细与时间戳);foreground = 终端是否显示明细与
// 时间戳。--verbose 两者同开;--interactive 只开文件记录,终端保持非 verbose 的
// 干净输出,避免明细流冲乱常驻输入行。
let verbose = false
let foreground = false
// run 模式下的日志文件描述符;writeSync 逐条直写,进程崩溃或被 kill 也不丢
// 已输出的内容。
let fd: number | undefined
// 交互模式的常驻 readline;log 打印前先清输入行、打印后重绘提示符与已输入内容。
// 仅在 --interactive 下注册,此时 foreground 为 false,vlog 不上终端无需重绘。
let rl: Interface | undefined

export function setVerbose(on: boolean) {
  verbose = on
  foreground = on
}

// --interactive: 文件保持 verbose 级完整记录,前台不显示 verbose 明细。
export function setInteractive() {
  verbose = true
  foreground = false
}

export function setInput(input: Interface | undefined) {
  rl = input
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

// 驱动级消息: 始终打印到终端,时间戳仅 --verbose(foreground)下加。
export function log(...args: unknown[]) {
  const text = format(args)
  if (rl) process.stdout.write("\r\x1b[0K")
  console.log(stamp(text, foreground))
  record(text)
  // 重绘被清掉的输入提示与已输入内容。
  if (rl) rl.prompt(true)
}

// verbose 明细(会话部件、上下文用量、变更文件等): 文件按 verbose 级别记录,
// 终端仅 --verbose(foreground)显示;--interactive 下只进日志文件。
export function vlog(...args: unknown[]) {
  if (!verbose) return
  const text = format(args)
  if (foreground) console.log(stamp(text, true))
  record(text)
}

function format(args: unknown[]): string {
  return args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" ")
}

// 文件行按 verbose 记录级别加时间戳(writeSync 直写)。
function record(text: string) {
  if (fd !== undefined) writeSync(fd, stamp(text, verbose) + "\n")
}

function stamp(text: string, on: boolean): string {
  if (!on) return text
  const time = new Date().toTimeString().slice(0, 8)
  return text.split("\n").map((line) => `[${time}] ${line}`).join("\n")
}

// 任务/子任务开始的显著横幅: 上下各一行重复字符包围标题。
export function banner(text: string) {
  rule("=", text)
}

export function subbanner(text: string) {
  rule("-", text)
}

function rule(char: string, text: string) {
  const line = char.repeat(61)
  log(`\n${line}\n${text}\n${line}`)
}

// Verbose mode prefixes every output line with the current local time so a
// human watching the terminal can follow the timeline of events.
import type { Interface } from "node:readline/promises"
import { mkdirSync, openSync, writeSync } from "node:fs"
import { join } from "node:path"

// verbose = 终端是否显示明细与时间戳(--verbose);audit = 日志文件是否始终完整
// 记录(免 verbose 门控,经外壳画像 setShellProfile 联动,见 src/shell.ts)。
// --verbose 时终端与文件同开;--interactive 只开文件记录,终端保持干净输出,
// 避免明细流冲乱常驻输入行。audit 开启时日志文件成为不依赖选项的完整审计记录。
let verbose = false
let foreground = false
let audit = false
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

// --interactive: 文件保持完整记录(verbose 或 audit 级),前台不显示 verbose 明细。
export function setInteractive() {
  verbose = true
  foreground = false
}

// 外壳画像联动(setShellProfile 调用): true = vlog 始终写入日志文件并带时间戳。
export function setAuditLog(on: boolean) {
  audit = on
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

// verbose 明细(会话部件、上下文用量、变更文件等): verbose 或 audit 时记录,
// 终端仅 --verbose(foreground)显示;--interactive 与 audit(未开 verbose)下只进
// 日志文件。
export function vlog(...args: unknown[]) {
  if (!verbose && !audit) return
  const text = format(args)
  if (foreground) console.log(stamp(text, true))
  record(text)
}

function format(args: unknown[]): string {
  return args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" ")
}

// 文件行按 verbose 或 audit 记录级别加时间戳(writeSync 直写)。
function record(text: string) {
  if (fd !== undefined) writeSync(fd, stamp(text, verbose || audit) + "\n")
}

function stamp(text: string, on: boolean): string {
  if (!on) return text
  const time = new Date().toTimeString().slice(0, 8)
  return text.split("\n").map((line) => `[${time}] ${line}`).join("\n")
}

// 任务/子任务开始的显著横幅与隐式(自动)任务子任务分割标记: 首行重复字符,
// 标题单独一行(任务/子任务)或空行后接标题(隐式分割)。
export function banner(text: string) {
  rule("=", text)
}

export function subbanner(text: string) {
  rule("-", text)
}

// 隐式(自动)任务子任务分割标记: 点线、空行、"<任务> <标题>: 阶段名"(子任务分解/收尾)。
export function autobanner(text: string) {
  rule(".", text)
}

function rule(char: string, text: string) {
  log(`\n${char.repeat(60)}\n${text}`)
}

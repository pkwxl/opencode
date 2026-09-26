// Verbose mode prefixes every output line with the current local time so a
// human watching the terminal can follow the timeline of events.
import type { Interface } from "node:readline/promises"
import { mkdirSync, openSync, writeSync } from "node:fs"
import { join } from "node:path"

// verbose = whether the terminal shows detail and timestamps (--verbose);
// audit = whether the log file always records in full (exempt from the
// verbose gate, wired through the shell profile setShellProfile, see
// src/shell.ts). Under --verbose both terminal and file are on; --interactive
// turns on file recording only, keeping the terminal output clean so the
// detail stream does not scramble the resident input line. With audit on,
// the log file becomes a complete audit record independent of any option.
let verbose = false
let foreground = false
let audit = false
// The log file descriptor in run mode; writeSync writes each entry straight
// through, so nothing already output is lost when the process crashes or is
// killed.
let fd: number | undefined
// The resident readline of interactive mode; log clears the input line
// before printing and redraws the prompt plus typed input after. Registered
// only under --interactive, where foreground is false and vlog never reaches
// the terminal, so no redraw is needed.
let rl: Interface | undefined

export function setVerbose(on: boolean) {
  verbose = on
  foreground = on
}

// --interactive: the file keeps the full record (verbose or audit level),
// the foreground shows no verbose detail.
export function setInteractive() {
  verbose = true
  foreground = false
}

// Shell-profile wiring (a setShellProfile call): true = vlog always writes
// into the log file, with timestamps.
export function setAuditLog(on: boolean) {
  audit = on
}

export function setInput(input: Interface | undefined) {
  rl = input
}

// Every run creates a new log file under the target directory's
// .auto/logs/; from then on everything log prints to the terminal is also
// written to that file synchronously. Returns the log file path.
export function setLogFile(directory: string): string {
  const dir = join(directory, ".auto", "logs")
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-")
  const path = join(dir, `run-${stamp}.log`)
  fd = openSync(path, "a")
  return path
}

// Driver-level messages: always printed to the terminal; the timestamp is
// added only under --verbose (foreground).
export function log(...args: unknown[]) {
  const text = format(args)
  if (rl) process.stdout.write("\r\x1b[0K")
  console.log(stamp(text, foreground))
  record(text)
  // Redraw the cleared input prompt and the typed content.
  if (rl) rl.prompt(true)
}

// Verbose detail (session pieces, context usage, changed files and the
// like): recorded when verbose or audit; the terminal shows it only under
// --verbose (foreground); under --interactive and audit (verbose off) it
// goes into the log file only.
export function vlog(...args: unknown[]) {
  if (!verbose && !audit) return
  const text = format(args)
  if (foreground) console.log(stamp(text, true))
  record(text)
}

function format(args: unknown[]): string {
  return args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" ")
}

// File lines get timestamps per the verbose-or-audit record level
// (written straight through by writeSync).
function record(text: string) {
  if (fd !== undefined) writeSync(fd, stamp(text, verbose || audit) + "\n")
}

function stamp(text: string, on: boolean): string {
  if (!on) return text
  const time = new Date().toTimeString().slice(0, 8)
  return text.split("\n").map((line) => `[${time}] ${line}`).join("\n")
}

// The prominent banner at task/subtask start and the implicit (automatic)
// task-subtask divider: the first line is a repeated character, the title
// stands on its own line (task/subtask) or follows a blank line (implicit
// division).
export function banner(text: string) {
  rule("=", text)
}

export function subbanner(text: string) {
  rule("-", text)
}

// The implicit (automatic) task-subtask divider: dotted line, blank line,
// "<task> <title>: stage name" (subtask decompose / wrap-up).
export function autobanner(text: string) {
  rule(".", text)
}

function rule(char: string, text: string) {
  const time = new Date().toTimeString().slice(0, 8)
  const paddedTime = ` ${time} `
  const centerTime = `${char.repeat((60 - paddedTime.length) / 2)}${paddedTime}${char.repeat((60 - paddedTime.length) / 2)}`
  log(`\n${centerTime}\n${text}`)
}

// ===== Stats/message formatters (pure functions, not interfering with the
// output machinery above) =====
// Serving the stats messages (plans/STATS_PLAN.md §4) and the consolidation
// of the existing runner/loop private copies: high-frequency lines (progress
// heartbeats, session-end lines) use the compact formatDurationCompact,
// conclusion lines (task/phase/round close-out) use the verbose
// formatDuration — the dual scheme matches the status quo (STATS_PLAN §5).
// The wiring (deleting the runner.ts:79-88 and loop.ts:879-884 private
// copies, changing imports) belongs to T-002/T-003; this consolidation only
// adds functions, changing no existing call site.

// Verbose duration (loop.ts:879-884 version kept verbatim + new hour tier):
// "Ns" / "Nm Ns" / "Nh Nm". Used in task/phase/round conclusion lines.
// AUTO-DECISION: hour tier is "Nh Nm" (seconds dropped): seconds are noise at
// hour scale, consistent with the plan §4 draft ("52m" also drops seconds);
// the more precise "Nh Nm Ns" was rejected as too long for conclusion lines.
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  if (!minutes) return `${seconds}s`
  const hours = Math.floor(minutes / 60)
  if (!hours) return `${minutes}m ${seconds % 60}s`
  return `${hours}h ${minutes % 60}m`
}

// Compact duration (runner.ts:79-88 version kept verbatim):
// "Nms" / "N.Ns" / "Nm" / "NmNs". Used in session-end lines, reuse hints
// and other high-frequency lines.
export function formatDurationCompact(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (remainingSeconds === 0) return `${minutes}m`
  return `${minutes}m${remainingSeconds.toFixed(0)}s`
}

// Compact token-count rendering (runner.ts:2806 / prompt.ts:501 versions
// kept verbatim): ≥10000 → "N.Nk".
export function formatTokens(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

// Cost rendering: 0 (or no cost info) returns undefined, so message
// assembly can omit the cost item (STATS_PLAN §5). Returns the "$N.NNN"
// style.
// AUTO-DECISION: precision is toFixed(4) with trailing zeros stripped
// (parseFloat round-trip): the plan §4 message draft shows both "$0.041"
// and "$0.31", meaning precision adapts to the value rather than being
// fixed-length; the alternative of a fixed 3 digits (toFixed(3)) would
// yield trailing-zero forms like "$0.310", contradicting the draft —
// rejected.
export function formatCost(cost: number): string | undefined {
  if (!cost) return undefined
  return `$${parseFloat(cost.toFixed(4))}`
}

// Cache hit rate: hit = cacheRead / (cacheRead + input) (the formula
// confirmed in STATS_PLAN §: after server-side normalization input no
// longer contains the cache part); denominator 0 (no usage info) → "—".
// Returns the "N.N%" style, for the ◉ session-end tokens line
// ("hit 95.9%").
// AUTO-DECISION: the cacheHit formula lives in the log.ts formatter (a
// display-layer pure function) rather than a statsTotals return field —
// the plan did not pin the location, but the hit rate is a display formula
// only; keeping the raw components in storage (cacheRead/input) makes a
// later formula change easier; the alternative "stats.ts helper" would
// leak display format ("—"/percent sign) into the stats module — rejected.
// Takes the two raw numbers rather than the Usage type, avoiding a
// log → stats type dependency.
export function formatCacheHit(cacheRead: number, input: number): string {
  const total = cacheRead + input
  if (!(total > 0)) return "—"
  return `${((cacheRead / total) * 100).toFixed(1)}%`
}

// Token breakdown line (unified tokens-line format of STATS_PLAN §4, T-006):
// shared by the T-004 ◉ session-end line 2 and the T-006 task/phase/round
// conclusion lines so the format cannot drift —
// `tokens in N / out M[/ reasoning R] / cache-read C / cache-write W, hit H[, cost $X]`.
// Omission rules: reasoning=0 drops the reasoning item (inserted between "out"
// and "cache-read", matching the Usage field declaration order); cost=0 drops
// the cost item (formatCost); hit-rate denominator 0 shows — (formatCacheHit).
// Callers needing a "cumulative" suffix (e.g. session-line running cost)
// append it to the return value themselves.
export function formatUsageLine(usage: {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cost: number
}): string {
  const cost = formatCost(usage.cost)
  return (
    `tokens in ${formatTokens(usage.input)} / out ${formatTokens(usage.output)}` +
    `${usage.reasoning ? ` / reasoning ${formatTokens(usage.reasoning)}` : ""}` +
    ` / cache-read ${formatTokens(usage.cacheRead)} / cache-write ${formatTokens(usage.cacheWrite)}` +
    `, hit ${formatCacheHit(usage.cacheRead, usage.input)}` +
    `${cost ? `, cost ${cost}` : ""}`
  )
}

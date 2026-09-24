#!/usr/bin/env bun
import { stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { renderProjectBrief, BRIEF_FILE } from "@opencode-ai/auto-core/brief"
import { checkPrinciple } from "@opencode-ai/auto-core/check"
import { checkCleanTree } from "@opencode-ai/auto-core/clean"
import { confirm } from "@opencode-ai/auto-core/confirm"
import {
  CONFIG_DEFAULTS,
  CONFIG_FILE,
  PARALLEL_LEVELS,
  formatProjectConfig,
  legacyModeFallback,
  loadOverwriteBaseline,
  loadProjectConfig,
  mergeProjectConfig,
  saveProjectConfig,
  type ProjectConfig,
  type RetiredKey,
} from "@opencode-ai/auto-core/config"
import { applyFix, fixHint, formatFixPlan, planFix } from "@opencode-ai/auto-core/config-fix"
import { closeUnit, type CloseChanges } from "@opencode-ai/auto-core/close"
import { acquireRunLock, liveRunLock, lockLines, lockStatusLine } from "@opencode-ai/auto-core/lock"
import { log, setInteractive, setLogFile, setVerbose } from "@opencode-ai/auto-core/log"
import { ensurePointer } from "@opencode-ai/auto-core/agents-block"
import { ensureGitignore } from "@opencode-ai/auto-core/gitignore"
import { runAll, type RunAllOpts } from "@opencode-ai/auto-core/loop"
import { loadModes, type ModeSpec } from "@opencode-ai/auto-core/mode"
import { planPrelude } from "@opencode-ai/auto-core/plan"
import type { PlanInput } from "@opencode-ai/auto-core/plan-input"
import { applyReset, formatResetPlan, planReset } from "@opencode-ai/auto-core/reset"
import {
  currentRound,
  doneTypes,
  establishRound,
  formatPhases,
  legacyLayoutProblem,
  nextRound,
  parsePhases,
  phaseIndexPath,
  phaseLabel,
  plannedPhaseUnits,
  readPhases,
  roundEstablishing,
  type PhaseState,
  type PhaseUnit,
} from "@opencode-ai/auto-core/phases"
import { loadPhaseTypes } from "@opencode-ai/auto-core/phases/custom"
import { PRESET_FORM, phasesProblem, type PhaseTypeEntry } from "@opencode-ai/auto-core/phases/registry"
import { renderStatus } from "@opencode-ai/auto-core/status"
import { roundBriefPath } from "@opencode-ai/auto-core/docpaths"
import { roundCloseLines, roundCloseProblems } from "@opencode-ai/auto-core/round-close"
import { taskIndexPath } from "@opencode-ai/auto-core/tasks"
import type { PermissionMode, SubtaskMode } from "@opencode-ai/auto-core/opts"
import { useIntentPacks } from "@opencode-ai/auto-core/prompt"
import { usePromptLibrary, renderText } from "@opencode-ai/auto-core/template"
import templateConfig from "@opencode-ai/auto-core/templates/opencode.json" with { type: "file" }
import templateAgent from "@opencode-ai/auto-core/templates/.opencode/agent/auto.md" with { type: "file" }

const args = process.argv.slice(2)
const command = args[0]

const flags = new Map<string, string>()
const positional: string[] = []
// --agent/--server/--wait-answer/--wait-between/--context-limit/--commit/--subtask/
// --prompt/--file/--permission/--idle-time/--idle-max/--mode/--phases/--parallel/
// --max-sessions/--reason(close 专用)带值(吞掉下一个 token;已退役的
// --implement-file/--implement-prompt 同样吞值,其参数不被当作目录,
// auto-core plans/0053 D13);
// --verbose/--interactive/--dryrun/--test-by-driver/
// --handover-test/--new-session/--auto-number/--no-auto-number/--wrapup/--no-wrapup
// 以及 --cascade/--commit-changes/--stash-changes(close 专用)、--append(plan 专用)
// 是布尔选项,出现即
// true,仅当紧随字面量 true/false 时才吞掉它。均支持
// --flag=value;--prompt 另有短选项 -p,--interactive 另有短选项 -i(布尔,不吞值),
// --mode 另有短选项 -m(镜像 -p 的吞值规则)。解析按整名精确匹配:--commit-changes
// 与配置旗标 --commit 名字不同,互不误吞;close 的 ref 恒在前(positional[0]),
// --commit 即使吞值也吞不到它(auto-core plans/0053 D20/F8,close 侧再以其配置旗标
// 报文拦截)。
const VALUE_FLAGS = new Set([
  "agent",
  "server",
  "wait-answer",
  "wait-between",
  "context-limit",
  "commit",
  "subtask",
  "prompt",
  "file",
  "reason",
  "permission",
  "idle-time",
  "idle-max",
  "mode",
  "phases",
  "implement-file",
  "implement-prompt",
  "parallel",
  "max-sessions",
])
const BOOLEAN_FLAGS = new Set(["verbose", "interactive", "dryrun", "test-by-driver", "handover-test", "new-session", "auto-number", "no-auto-number", "wrapup", "no-wrapup", "amend", "force", "cascade", "commit-changes", "stash-changes", "append"])
for (let i = 1; i < args.length; i++) {
  const arg = args[i]!
  if (arg === "-i") {
    flags.set("interactive", "")
    continue
  }
  if (arg === "-f") {
    flags.set("force", "")
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
// 历史选项对 init/continue/run/plan 有专属拦截报文,此处放行交由其后各自处理;
// close 只接受自己的四个旗标,其余(含宪法级与 -p/--file)在下方 close 分支以
// close 专属报文拒绝;check/status 不接受任何选项,出现旗标即拒绝。
// --append is plan's alone (auto-core plans/0053 D23): appending tasks to the
// current phase is a plan route, so every other command refuses the flag with
// a pointer to plan — run's -p/--file refusal pattern — before any whitelist
// or command block runs.
if (command !== "plan" && flags.has("append")) {
  console.error(`--append is a plan option: ${command ?? "this command"} takes no --append. Append tasks with opencode-auto plan <dir> --append -p <text> | --file <path>`)
  process.exit(1)
}
// Retired flags are usage errors with their own notice (mirroring the --commit
// false retirement), let through the whitelist so the notice replaces "unknown
// option": the completion-side mechanisms (D13, auto-core plans/0044), the
// migration parameters, which are intent rather than configuration (plans/0052 D1),
// and init's m-mode planning shortcut, whose session is now plan's (plans/0053 D13).
const COMPLETION_RETIRED =
  "is retired: the driver no longer runs task-level acceptance, quality review or a final review. " +
  'Plan the checking as tasks (for example the v acceptance phase); a task report whose result line reads "Result: FAIL" stops the run'
const MIGRATION_RETIRED =
  "is retired: the migration source and target are intent, not configuration — state them in .opencode/auto/brief.md, which planning sessions read"
const IMPLEMENT_RETIRED = "is retired: plan tasks with opencode-auto plan <dir> -p <text> | --file <path> (after init and the round-start commit)"
const RETIRED_FLAGS: Record<string, string> = {
  verify: COMPLETION_RETIRED,
  review: COMPLETION_RETIRED,
  early: COMPLETION_RETIRED,
  "early-review": COMPLETION_RETIRED,
  "final-review": COMPLETION_RETIRED,
  "source-dir": MIGRATION_RETIRED,
  "source-path": MIGRATION_RETIRED,
  "dest-dir": MIGRATION_RETIRED,
  "implement-file": IMPLEMENT_RETIRED,
  "implement-prompt": IMPLEMENT_RETIRED,
}
const KNOWN_FLAGS = new Set([...VALUE_FLAGS, ...BOOLEAN_FLAGS, ...Object.keys(RETIRED_FLAGS), "continue", "commit-subtask", "verify-idle", "verify-max"])
// The config flags: the project attributes init freezes into config.json and
// amend changes one by one (plans/0052 D25); run refuses every one of them.
const CONFIG_FLAGS = ["mode", "agent", "context-limit", "subtask", "idle-time", "idle-max", "commit", "test-by-driver", "handover-test", "auto-number", "no-auto-number", "wrapup", "no-wrapup", "phases", "parallel"]
const FLAGLESS = command === "check" || command === "status"
// reset 是反初始化,没有可配置项: 只接受 -f/--force(跳过确认与工作区干净度闸门)。
// fix takes its baseline from the existing config and no config flags, so it
// accepts the same (plans/0052 D11).
const RESET_FLAGS = new Set(["force"])
// close (auto-core plans/0053 D22) takes only its four flags: --reason (a
// value flag) and the booleans --cascade, --commit-changes, --stash-changes.
// Everything else is refused with a close-appropriate message below — the
// config flags with the frozen-by-init notice, -p/--file with plan's input
// notice — mirroring RESET_FLAGS for reset/fix.
const CLOSE_FLAGS = new Set(["reason", "cascade", "commit-changes", "stash-changes"])
for (const key of flags.keys()) {
  if (command === "reset" || command === "fix") {
    if (RESET_FLAGS.has(key)) continue
    console.error(`unknown option --${key}: ${command} only accepts a directory argument and -f/--force`)
    process.exit(1)
  }
  if (command === "close") {
    if (CLOSE_FLAGS.has(key)) continue
    // Retired flags keep their own notices below (they exit there).
    if (key in RETIRED_FLAGS) continue
    if (key === "commit") {
      console.error(
        "--commit is a config flag frozen by init (run's commit semantics; to change: opencode-auto amend <dir> --commit <value>, or edit that file directly) " +
          "and it takes a value, so it would swallow whatever follows it; the close options for a dirty worktree are --commit-changes and --stash-changes",
      )
      process.exit(1)
    }
    if (CONFIG_FLAGS.includes(key)) {
      console.error(`${key === "mode" ? "-m/--mode" : `--${key}`} was frozen by init (.opencode/auto/config.json). To change: ${amendHint(key)}, or edit that file directly; close takes no config options`)
      process.exit(1)
    }
    if (key === "prompt" || key === "file") {
      console.error(`${key === "prompt" ? "-p/--prompt" : "--file"} is a plan option (the planning input: opencode-auto plan <dir> -p <text> | --file <path>); close takes no planning input`)
      process.exit(1)
    }
    const similar = key ? [...KNOWN_FLAGS].filter((name) => name.startsWith(key)).map((name) => `--${name}`) : []
    console.error(`--${key} is not a close option${similar.length ? ` (did you mean ${similar.join(" / ")}?)` : ""}: close takes only --reason <text>, --cascade, --commit-changes and --stash-changes (usage: opencode-auto close <ref> [dir] --reason <text>)`)
    process.exit(1)
  }
  if (!FLAGLESS && KNOWN_FLAGS.has(key)) continue
  const similar = !FLAGLESS && key ? [...KNOWN_FLAGS].filter((name) => name.startsWith(key)).map((name) => `--${name}`) : []
  console.error(`unknown option --${key}${similar.length ? ` (did you mean ${similar.join(" / ")}?)` : ""}${FLAGLESS ? ": check/status only accept a directory argument, no options" : "; run opencode-auto without a subcommand to see usage"}`)
  process.exit(1)
}
for (const [key, notice] of Object.entries(RETIRED_FLAGS)) {
  if (flags.has(key)) {
    console.error(`--${key} ${notice}`)
    process.exit(1)
  }
}

// close (auto-core plans/0053 D22): the ref is required, so it comes first —
// positional[0] is the unit ref (R-NN | R-NN.P<nn> | T-NNN, closeUnit's
// canonical shapes) and positional[1] the directory, overriding the global
// directory rule for this command. The shape check is what makes the split
// safe: a positional[0] that is not a ref means the ref is missing (the
// directory alone, the natural mistake), never a directory silently taken as
// the ref and closeUnit reading the wrong tree. closeUnit owns every
// behavioural refusal (done or closed units, another round, the m-mode
// phase, dependents, a dirty tree); the checks here are usage errors that
// fire before anything is read.
const CLOSE_REF = /^(?:R-\d{2,}|R-\d{2,}\.P\d{2,}|T-\d{3,})$/
let closeRef: string | undefined
if (command === "close") {
  const ref = positional[0]
  if (ref === undefined || !CLOSE_REF.test(ref)) {
    console.error(
      ref === undefined
        ? "close requires a unit reference: opencode-auto close <ref> [dir] --reason <text> — a round R-NN, a phase R-NN.P<nn> or a task T-NNN"
        : `${ref}: not a unit reference; expected a round R-NN, a phase R-NN.P<nn> or a task T-NNN (usage: opencode-auto close <ref> [dir] --reason <text>)`,
    )
    process.exit(1)
  }
  closeRef = ref
  const reason = flags.get("reason")
  if (reason === undefined) {
    console.error("close requires --reason <text>: the one-line reason recorded in the Closed: field, the close commit and the phase handover")
    process.exit(1)
  }
  if (!reason.trim()) {
    console.error("--reason requires non-empty text (the close reason; the explicit ref and the reason are the confirmation — close asks for no other)")
    process.exit(1)
  }
  if (reason.includes("\n")) {
    console.error("--reason must be one line (it is the Closed: value and the close commit subject's tail); longer context belongs in the round brief or the plan")
    process.exit(1)
  }
  const on = (key: string) => flags.has(key) && flags.get(key) !== "false"
  if (on("commit-changes") && on("stash-changes")) {
    console.error("--commit-changes and --stash-changes are mutually exclusive: pick one way to handle the uncommitted changes (folded into the close commit, or stashed)")
    process.exit(1)
  }
}
const directory = resolve(command === "close" ? positional[1] ?? "." : positional[0] ?? ".")

// Legacy layout (M3.7, auto-core plans/0047 R3): an old-layout project is a
// usage error before init/continue/amend/plan/close writes anything, status
// reads anything or run starts (runAll, planPrelude and closeUnit repeat the
// check for other shells). reset, fix and check stay available so an old tree
// can still be de-initialized, repaired or inspected (fix touches only the
// config layer).
if (command === "init" || command === "continue" || command === "amend" || command === "plan" || command === "close" || command === "status" || command === "run") {
  const legacy = await legacyLayoutProblem(directory)
  if (legacy) {
    console.error(legacy)
    process.exit(1)
  }
}

// The run lock (auto-core plans/0053 D3): these commands write what a running
// driver reads (config.json, the agent contract, the AGENTS.md block, the round
// setup), so they refuse while another process holds .auto/run.lock; -f does
// not override it. run takes the lock inside runAll; plan and close take it
// themselves — plan before its prelude (re-entered through runAll), close
// around closeUnit — so neither joins this refusal list.
if (command === "init" || command === "continue" || command === "amend" || command === "fix" || command === "reset") {
  const holder = liveRunLock(directory)
  if (holder) {
    for (const line of lockLines(directory, holder)) console.error(line)
    process.exit(1)
  }
}

if (command === "run") {
  refuseFrozenFlags("run")
  // The planning input is plan's (auto-core plans/0053 D14): run never reads
  // it, so it is refused rather than silently ignored.
  for (const key of ["prompt", "file"]) {
    if (flags.has(key)) {
      console.error(
        `${key === "prompt" ? "-p/--prompt" : "--file"} is a plan option: run takes no planning input. Plan with opencode-auto plan <dir> -p <text> | --file <path>, then run`,
      )
      process.exit(1)
    }
  }
  const session = parseSessionFlags()
  const waitBetween = parseMinutes(flags.get("wait-between"))
  if (waitBetween === null) {
    console.error("--wait-between takes 1..60 (minutes); defaults to 1 when given without a value")
    process.exit(1)
  }
  // --max-sessions (auto-core plans/0046 D9): concurrent AI sessions, reserved
  // until the MP.3 scheduler exists — only 1 is accepted. Unrelated to --agent.
  const maxSessions = parseMaxSessions(flags.get("max-sessions"))
  if (maxSessions === null) {
    console.error("--max-sessions takes a positive integer (concurrent AI sessions, unrelated to --agent); defaults to 1")
    process.exit(1)
  }
  if (maxSessions > 1) {
    console.error(`--max-sessions ${maxSessions}: concurrent execution is not supported yet; only 1 is accepted (init --parallel plans for parallelism, tasks still run one at a time)`)
    process.exit(1)
  }
  startRunLog(directory, session)
  const { config, mode } = await loadRunConfig(directory)
  await logRunBanner(directory, config)
  const code = await runAll(directory, {
    ...runOptions(config, mode, session),
    waitBetween,
    dryrun: flags.has("dryrun") && flags.get("dryrun") !== "false",
    maxSessions,
  })
  process.exit(code)
}

// plan (auto-core plans/0053 D14, D23): plan the current phase and stop
// before execution, for review. It is run with a stop condition: the same
// options (the builder is shared), preceded by the prelude that settles every
// route needing no agent — establishing a round, the round-close gate before
// the next one, the notices and the input refusals (planPrelude, D4). Order:
// the flags and the planning input, then --append (which rides an input and
// appends the tasks it plans to the current phase), the strict config load
// and the mode check, then the run lock ("plan", held across the prelude;
// runAll re-enters it), the prelude, and runAll. A prelude stop prints its
// lines and exits with its code; runAll's exit codes are run's.
if (command === "plan") {
  refuseFrozenFlags("plan")
  // run's options for the task loop: plan stops before any task runs.
  for (const [key, flag, what] of [
    ["dryrun", "--dryrun", "the permission preflight: opencode-auto run <dir> --dryrun"],
    ["wait-between", "--wait-between", "the pause between tasks, and plan runs none"],
    ["max-sessions", "--max-sessions", "concurrent sessions of the task loop"],
  ] as const) {
    if (flags.has(key)) {
      console.error(`${flag} is a run option (${what}); plan does not accept it`)
      process.exit(1)
    }
  }
  const input = await parsePlanInput()
  // --append (auto-core plans/0053 D23) rides a planning input: it appends
  // the tasks planned from the input to the current phase. In m mode the
  // input implies the append on a non-empty index, so the flag is redundant
  // there; the prelude and planPrelude repeat the check for other shells.
  const append = flags.has("append") && flags.get("append") !== "false"
  if (append && !input) {
    console.error("--append requires a planning input: pass -p <text> | --file <path>; it appends the tasks planned from the input to the current phase")
    process.exit(1)
  }
  const session = parseSessionFlags()
  // plan writes the round setup, which follows the config (phases): a
  // directory init never configured is refused rather than planned with the
  // defaults.
  if (!(await Bun.file(join(directory, CONFIG_FILE)).exists())) {
    const legacy = await legacyModeFallback(directory)
    console.error(
      `nothing to plan: ${directory} has no ${CONFIG_FILE}; run opencode-auto init ${directory} first` +
        (legacy !== undefined ? ` (or opencode-auto fix ${directory}, which writes it from the legacy .auto/config.json mode "${legacy}")` : ""),
    )
    process.exit(1)
  }
  const { config, mode } = await loadRunConfig(directory)
  const lock = acquireRunLock(directory, "plan")
  if (!lock.ok) {
    for (const line of lockLines(directory, lock.holder)) console.error(line)
    process.exit(1)
  }
  const prelude = await planPrelude(directory, { phases: config.phases, build: config.build, input, append })
  if (prelude.type === "stop") {
    for (const line of prelude.lines) (prelude.code === 0 ? console.log : console.error)(line)
    lock.release()
    process.exit(prelude.code)
  }
  startRunLog(directory, session)
  await logRunBanner(directory, config)
  const code = await runAll(directory, { ...runOptions(config, mode, session), stopBefore: "execute", planInput: input, append })
  lock.release()
  process.exit(code)
}

// close (auto-core plans/0053 D22): close a unit — a task T-NNN, a phase
// R-NN.P<nn> or a round R-NN — without completing it: done for scheduling,
// never delivered, the reason recorded in a Closed: field, the close commit
// and (for a phase) the driver-written mechanical handover. The explicit ref
// and the required --reason are the confirmation, so there is no prompt, and
// everything is reversible: the undo is `git revert` of the close commit,
// printed in the output. The argument checks (ref shape, reason, the change
// pair) ran above with the ref/directory split; closeUnit owns every
// behavioural refusal. Exit codes: 0 closed; 1 refused or usage error; 2 the
// close commit or the close-out check failed.
// AUTO-DECISION (config load): reuse loadRunConfig, the strict load run and
// plan share, instead of a phases/acceptanceGate-only reader. close needs
// config.phases (the m-mode round/phase refusal) and config.acceptanceGate
// (the skipped-gates record); the shared load adds only the mode check and
// the fixHint, and a config that cannot load strictly leaves nothing to close
// into — one strict loader is easier to keep honest than a second lighter
// one. Like plan, a directory without config.json is refused outright rather
// than closing with default values.
if (command === "close") {
  if (!(await Bun.file(join(directory, CONFIG_FILE)).exists())) {
    const legacy = await legacyModeFallback(directory)
    console.error(
      `nothing to close: ${directory} has no ${CONFIG_FILE}; run opencode-auto init ${directory} first` +
        (legacy !== undefined ? ` (or opencode-auto fix ${directory}, which writes it from the legacy .auto/config.json mode "${legacy}")` : ""),
    )
    process.exit(1)
  }
  const { config } = await loadRunConfig(directory)
  // close holds the run lock itself (D3), so it is not in the refusal list
  // above; status shows a live lock while this runs.
  const lock = acquireRunLock(directory, "close")
  if (!lock.ok) {
    for (const line of lockLines(directory, lock.holder)) console.error(line)
    process.exit(1)
  }
  const changes: CloseChanges | undefined =
    flags.has("commit-changes") && flags.get("commit-changes") !== "false"
      ? "commit"
      : flags.has("stash-changes") && flags.get("stash-changes") !== "false"
        ? "stash"
        : undefined
  const result = await closeUnit(directory, closeRef!, {
    reason: flags.get("reason")!,
    cascade: flags.has("cascade") && flags.get("cascade") !== "false",
    changes,
    phases: config.phases,
    acceptanceGate: config.acceptanceGate,
  })
  lock.release()
  for (const line of result.lines) (result.type === "closed" ? console.log : console.error)(line)
  process.exit(result.type === "closed" ? 0 : result.type === "refused" ? 1 : 2)
}

// The amend hint of one config flag: how a person changes a key init froze.
// Shared by run/plan's frozen-flag refusal and close's whitelist, so the hint
// for a key is written once.
function amendHint(key: string): string {
  if (key === "auto-number" || key === "no-auto-number") return "opencode-auto amend <dir> --auto-number (use --no-auto-number to turn off)"
  if (key === "wrapup" || key === "no-wrapup") return "opencode-auto amend <dir> --wrapup (use --no-wrapup to turn off)"
  return `opencode-auto amend <dir> ${key === "mode" ? "-m" : `--${key}`} <value>`
}

// The options run and plan refuse alike (auto-core plans/0053 D14). 已固化选项
// (设计文档 §C): 宪法级项目属性经 init 固化到 .opencode/auto/config.json,出现即
// 用法错误(镜像 --commit-subtask 移除的既有先例);修订走 amend(plans/0052 D25)
// 或直接编辑配置文件。看门狗键已由 --verify-idle/--verify-max 更名为
// --idle-time/--idle-max(现控制 test 脚本执行),旧名出现即单独提示更名。
function refuseFrozenFlags(command: "run" | "plan") {
  for (const key of ["verify-idle", "verify-max"]) {
    if (flags.has(key)) {
      const renamed = key === "verify-idle" ? "idle-time" : "idle-max"
      console.error(`--${key} was renamed to --${renamed} (the driver-run script watchdog). To change: opencode-auto amend <dir> --${renamed} <value>, or edit .opencode/auto/config.json directly`)
      process.exit(1)
    }
  }
  for (const key of CONFIG_FLAGS) {
    if (flags.has(key)) {
      console.error(`${key === "mode" ? "-m/--mode" : `--${key}`} was frozen by init (.opencode/auto/config.json). To change: ${amendHint(key)}, or edit that file directly`)
      process.exit(1)
    }
  }
  if (flags.has("commit-subtask")) {
    console.error("--commit-subtask removed: commits are now made by the driver after every session ends (AI commit rights revoked), and can no longer be turned off (--commit false is retired)")
    process.exit(1)
  }
  // --amend 是 init 专用(切回增量修订语义,单改一个键用 amend 子命令);-f/--force
  // 是 init/reset/fix 专用(跳过覆盖确认与工作区干净度闸门);run 与 plan 不写配置、
  // 不做破坏性覆盖,两者都无意义。
  if (flags.has("amend")) {
    console.error(`--amend is an init-only option (to change individual keys use opencode-auto amend <dir> --<key> <value>); ${command} does not accept it`)
    process.exit(1)
  }
  if (flags.has("force")) {
    console.error(`-f/--force is an init/reset/fix option (skips the confirmation and the worktree cleanliness check); ${command} does not accept it`)
    process.exit(1)
  }
  // 续轮迁移是独立子命令(continue),不是任何命令的选项。
  if (flags.has("continue")) {
    console.error("--continue is not an option: round continuation uses the dedicated subcommand opencode-auto continue <dir> (starts a new round after the previous phased migration round fully completes)")
    process.exit(1)
  }
}

// The session flags of run and plan (auto-core plans/0053 §2): they shape this
// run's sessions, not the project.
type SessionFlags = { verbose: boolean; interactive: boolean; waitAnswer: number; permission: PermissionMode; newSession: boolean }

function parseSessionFlags(): SessionFlags {
  const verbose = flags.has("verbose") && flags.get("verbose") !== "false"
  // --interactive/-i: 旁路交互(与 --verbose 互斥);文件保持 verbose 级完整记录,
  // 前台不显示 verbose 明细,常驻 stdin 接收人工输入注入当前会话。
  const interactive = flags.has("interactive") && flags.get("interactive") !== "false"
  if (interactive && verbose) {
    console.error("--interactive/-i and --verbose are mutually exclusive; pick one")
    process.exit(1)
  }
  const waitAnswer = parseMinutes(flags.get("wait-answer"))
  if (waitAnswer === null) {
    console.error("--wait-answer takes 1..60 (minutes); defaults to 1 when given without a value")
    process.exit(1)
  }
  const permission = parsePermission(flags.get("permission"))
  if (permission === null) {
    console.error("--permission takes auto-allow|ask-allow|ask-deny|ask-fail; defaults to ask-deny")
    process.exit(1)
  }
  // --new-session: 中断恢复时不复用被中断的旧会话(仅跳过复用,阶段精确重入保留)。
  return { verbose, interactive, waitAnswer, permission, newSession: flags.has("new-session") && flags.get("new-session") !== "false" }
}

// plan's planning input (auto-core plans/0053 D14): the -p/--prompt text or
// the --file contents, one of the two and non-empty; undefined when neither
// is given. Checked before the lock, so a bad input writes nothing.
async function parsePlanInput(): Promise<PlanInput | undefined> {
  const text = flags.get("prompt")
  const file = flags.get("file")
  if (text !== undefined && file !== undefined) {
    console.error("-p/--prompt and --file are mutually exclusive: give the planning input one way")
    process.exit(1)
  }
  if (text !== undefined) {
    if (!text.trim()) {
      console.error("-p/--prompt requires non-empty text (the planning input)")
      process.exit(1)
    }
    return { text }
  }
  if (file === undefined) return undefined
  if (!file) {
    console.error("--file requires a path: the file holding the planning input")
    process.exit(1)
  }
  const path = resolve(file)
  const info = await stat(path).catch(() => undefined)
  if (!info?.isFile()) {
    console.error(`--file ${file}: ${info ? "not a regular file" : "no such file"}; it names the file holding the planning input`)
    process.exit(1)
  }
  const content = await Bun.file(path).text()
  if (!content.trim()) {
    console.error(`--file ${file} is empty: the planning input must not be empty`)
    process.exit(1)
  }
  return { text: content, source: path }
}

// 每次 run(与 plan 进入循环时)都在目标目录 .auto/logs/ 下新建日志文件,同步
// 记录全部输出。
function startRunLog(directory: string, session: SessionFlags) {
  setVerbose(session.verbose)
  if (session.interactive) setInteractive()
  log(`📝 log file: ${setLogFile(directory)}`)
}

// 项目配置(.opencode/auto/config.json)是宪法级选项的唯一来源;坏文件为环境
// 错误退出 1(严格失败优于静默回落,附 fix 提示)。文件缺失取缺省并做 legacy 回落
// (.auto/config.json 的 mode,仅提示、不迁移)。配置的模式须已注册。
async function loadRunConfig(directory: string): Promise<{ config: ProjectConfig; mode: ModeSpec }> {
  let config: ProjectConfig
  try {
    config = await loadProjectConfig(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    const hint = await fixHint(directory)
    if (hint) console.error(hint)
    process.exit(1)
  }
  const modes = loadModeTable(directory)
  const mode = modes[config.mode]
  if (!mode) {
    console.error(`configured mode "${config.mode}" is not registered (currently supported: ${Object.keys(modes).join(", ")}); to fix: opencode-auto amend <dir> -m <value>, or edit .opencode/auto/config.json directly`)
    process.exit(1)
  }
  return { config, mode }
}

// The banner of run and plan: the legacy-mode note, the driver-run tests line,
// the config summary and, when phased, the phase progress line.
async function logRunBanner(directory: string, config: ProjectConfig) {
  if (await legacyModeFallback(directory)) log(`ℹ mode taken from the legacy persisted value in .auto/config.json; run opencode-auto fix ${directory} to write the full config`)
  if (config.testByDriver) {
    log(
      `⚙ tests run by the driver: sessions put scripts in test/ and write the script path to tmp/test.sh to request execution; the driver merges stdout/stderr into tmp/test.<n>.out and feeds it back to the session` +
        (config.handoverTest ? "; on test failure with context at its cap, a handover document switches to a fresh session" : ""),
    )
  }
  log(`⚙ project config (.opencode/auto/config.json): ${formatProjectConfig(config)}`)
  // 阶段进度行(B.2,与 status 共用 phasesLine;✓=已完成,▶=当前,其余=未开始);
  // 续轮(docs/R-NN 轮次目录最大号 > 1)时带轮次标注。阶段索引缺失/非法仅提示,
  // runAll 的阶段路由会以环境错误退出 1。
  if (config.phases !== "m") log(await phasesLine(directory))
}

// The runAll options run and plan share (auto-core plans/0053 D14): the config
// init froze plus this run's session flags. run adds --wait-between, --dryrun
// and --max-sessions; plan adds its stop condition and planning input.
function runOptions(config: ProjectConfig, mode: ModeSpec, session: SessionFlags): RunAllOpts {
  return {
    // The coding agent, commit semantics, context budget etc. come from the
    // config file (written by init); OPENCODE_AUTO_AGENT still overrides the agent.
    agent: config.agent,
    server: flags.get("server"),
    // interactive 隐含 verbose 记录级别(watch/变更文件监视照常运行并写入日志)。
    verbose: session.verbose || session.interactive,
    waitAnswer: session.waitAnswer,
    commit: config.commit,
    subtask: config.subtask,
    contextLimit: config.contextLimit * 1000,
    permission: session.permission,
    interactive: session.interactive,
    idleMs: config.idleTime * 60_000,
    maxMs: config.idleMax > 0 ? config.idleMax * 60_000 : undefined,
    mode,
    phases: config.phases,
    testByDriver: config.testByDriver,
    handoverTest: config.handoverTest,
    autoNumber: config.autoNumber,
    wrapup: config.wrapup,
    acceptanceGate: config.acceptanceGate,
    build: config.build,
    parallel: config.parallel,
    newSession: session.newSession,
  }
}

// --commit 缺省/裸选项/true = 启用(会话后统一提交)。false 与旧值 none 已于
// 2026-09-15 退役(plans/0021-commit-boundary-design.md): 统一提交是完成条件,单元基线、
// 恢复保真回滚等机制全部以"提交恒开"为前提,关闭档与之冲突——出现即用法错误。
// 旧的 subtask/task/once 档已随"收回 AI 提交权、driver 统一提交"一并移除。
// 返回 null 表示取值非法(含已退役的关闭档)。
function parseCommit(flags: Map<string, string>): boolean | null {
  const raw = flags.get("commit")
  if (raw === undefined || raw === "" || raw === "true") return true
  return null
}

// --max-sessions 缺省 = 1;须为正整数,返回 null 表示取值非法。
function parseMaxSessions(raw: string | undefined): number | null {
  if (raw === undefined) return 1
  const value = Number(raw)
  return /^\d+$/.test(raw) && value >= 1 ? value : null
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

// The config flags of init/continue/amend, parsed once (plans/0052 D25): the
// value checks, and the keys explicitly given (`explicit`, merged over the
// baseline). --agent opencode and --parallel none are returned separately,
// since they drop their key instead of setting it. A bad value exits 1.
function parseConfigFlags(directory: string): { explicit: Partial<ProjectConfig>; phases?: string; agent?: string; parallel?: string } {
  // --agent (M6.1): the coding agent, frozen like every project attribute;
  // opencode = the key is absent from config.json.
  const agent = flags.get("agent")
  if (agent !== undefined && agent !== "opencode" && agent !== "claude") {
    console.error(`--agent takes opencode|claude (the coding agent that runs the sessions); defaults to opencode. The agent contract is always .opencode/agent/auto.md`)
    process.exit(1)
  }
  // --parallel (auto-core plans/0046 D8): planning-guidance level, frozen like
  // every project attribute; none = the key is absent from config.json.
  const parallel = flags.get("parallel")
  if (parallel !== undefined && parallel !== "none" && !(PARALLEL_LEVELS as readonly string[]).includes(parallel)) {
    console.error(`--parallel takes none|${PARALLEL_LEVELS.join("|")}; defaults to none`)
    process.exit(1)
  }
  const commit = parseCommit(flags)
  if (commit === null) {
    console.error(
      "--commit now only takes true (default): --commit false (and the old alias none) is retired — unified commits are the completion condition" +
        " (plans/0021-commit-boundary-design.md); the driver commits all changes after every session ends; turning commits off is no longer supported",
    )
    process.exit(1)
  }
  const subtask = parseSubtask(flags.get("subtask"))
  if (subtask === null) {
    console.error("--subtask takes off|auto|ondemand; defaults to auto")
    process.exit(1)
  }
  const contextLimit = parseContextLimit(flags.get("context-limit"))
  if (contextLimit === null) {
    console.error("--context-limit takes a positive integer (unit: k tokens); defaults to 64")
    process.exit(1)
  }
  // --idle-time: driver 托管脚本(test)的无进度判定窗口(输出文件持续无增长
  // 即终止);--idle-max: 绝对时长上限(0 = 不设,只要持续有输出
  // 就永不限时)。
  const idleTime = parseIdleTime(flags.get("idle-time"))
  if (idleTime === null) {
    console.error("--idle-time takes 1..120 (minutes); defaults to 10")
    process.exit(1)
  }
  const idleMax = parseIdleMax(flags.get("idle-max"))
  if (idleMax === null) {
    console.error("--idle-max takes 1..1440 (minutes); no cap by default")
    process.exit(1)
  }
  // --phases: 阶段化流程(设计文档 plans/0006-phases-design.md);"m"(缺省)= 无阶段
  // 声明,单次运行,行为不变。已有完成阶段时的前缀护栏见下(已完成的阶段必须构成
  // 新值的前缀,防止 amend 把流程状态打成不可推导)。
  // 取值二形态(M3.6): 字母预置(admtvk 子序列含 m)或逗号分隔的阶段类型 id 列表
  // (含 .opencode/auto/phases/ 的自定义类型,须含 implement);列表形态规范化为
  // 无空格的逗号串写入 config。
  let phases: string | undefined
  if (flags.has("phases")) {
    const raw = flags.get("phases") ?? ""
    let parsed: PhaseTypeEntry[] | null
    try {
      parsed = parsePhases(raw, directory)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
    if (!parsed) {
      console.error(`--phases is invalid: ${phasesProblem(raw, loadPhaseTypes(directory))}`)
      process.exit(1)
    }
    phases = PRESET_FORM.test(raw) ? raw : parsed.map((entry) => entry.type).join(",")
  }
  // 仅显式给出的键进入合并: --commit/--subtask 等裸选项取各自缺省档,
  // 未出现的选项不覆盖既有配置。
  const explicit: Partial<ProjectConfig> = {}
  if (agent === "claude") explicit.agent = agent
  if (flags.has("commit")) explicit.commit = commit
  if (flags.has("subtask")) explicit.subtask = subtask
  if (flags.has("context-limit")) explicit.contextLimit = contextLimit
  if (flags.has("idle-time")) explicit.idleTime = idleTime
  if (flags.has("idle-max")) explicit.idleMax = idleMax
  if (phases !== undefined) explicit.phases = phases
  if (parallel !== undefined && parallel !== "none") explicit.parallel = parallel as ProjectConfig["parallel"]
  // --test-by-driver / --handover-test: 布尔宪法级选项,init/continue
  // 接受(裸选项或 true 启用、false 关闭),经 explicit 合并(amend 语义)。二者不属
  // 迁移同一性选项,continue 可按轮修订。
  if (flags.has("test-by-driver")) explicit.testByDriver = flags.get("test-by-driver") !== "false"
  if (flags.has("handover-test")) explicit.handoverTest = flags.get("handover-test") !== "false"
  // --auto-number/--no-auto-number: 一对布尔开关(启用/关闭自动编号),同为布尔
  // 宪法级选项,经 explicit 合并(amend 语义);两者同现自相矛盾,为用法错误。
  if (flags.has("auto-number") && flags.has("no-auto-number") && flags.get("auto-number") !== "false" && flags.get("no-auto-number") !== "false") {
    console.error("--auto-number and --no-auto-number are a mutually exclusive pair; do not use both")
    process.exit(1)
  }
  if (flags.has("auto-number") && flags.get("auto-number") !== "false") explicit.autoNumber = true
  if (flags.has("no-auto-number") && flags.get("no-auto-number") !== "false") explicit.autoNumber = false
  // --wrapup/--no-wrapup: 一对布尔开关(启用/关闭任务收尾会话),镜像
  // --auto-number/--no-auto-number 同款处理;两者同现自相矛盾,为用法错误。
  if (flags.has("wrapup") && flags.has("no-wrapup") && flags.get("wrapup") !== "false" && flags.get("no-wrapup") !== "false") {
    console.error("--wrapup and --no-wrapup are a mutually exclusive pair; do not use both")
    process.exit(1)
  }
  if (flags.has("wrapup") && flags.get("wrapup") !== "false") explicit.wrapup = true
  if (flags.has("no-wrapup") && flags.get("no-wrapup") !== "false") explicit.wrapup = false
  return { explicit, phases, agent, parallel }
}

if (command === "init" || command === "continue" || command === "amend") {
  // 项目宪法选项在 init 固化(设计文档 §B): 缺省为**无状态全量覆盖**——产出的
  // config.json 仅由本次执行传入的参数决定,未给出的键一律回落内置缺省,不与磁盘
  // 上的旧配置做任何增量合并。于是「干净环境跑一次无参 init」与「带参 init 之后
  // 再跑一次无参 init」产出逐字节一致,单次 init 即可得到确定状态,无需前置清理。
  // 值域校验复用既有 parse*(与配置文件侧 validateProjectConfig 同源)。
  //
  // --amend 显式切回旧的增量修订语义(只改命令行显式给出的键,其余保留既有配置),
  // 供「只想改一个字段又不想重述全部参数」的场景;continue 恒为 amend(下方 base)。
  //
  // The amend command (plans/0052 D25) is that amend as a command of its own:
  // it takes the config flags only, refuses without config.json or without a
  // key, and writes config.json plus the artifacts rendered from it (the agent
  // contract and the AGENTS.md block). Until P3c it also runs the round step,
  // so moving from `init --amend` loses nothing (the tail re-sync after a
  // --phases change); opencode.json, .gitignore and the brief stub are left to
  // init and `fix`. `init --amend` keeps working until P3c (D20).
  //
  // continue 子命令(续轮迁移,设计文档 plans/0006-phases-design.md M 节)= init 的
  // amend 语义 + 轮首建立新一轮轮次目录: 上一轮阶段化迁移全部完成后开启新一轮,
  // 让迁移结果与源更加完整、一致。复用 init 的解析/合并/模板与标记块维护,差异
  // 仅在: ① 前置校验(既有 phases ≠ "m" 且阶段索引全部完成);② 轮首建立
  // (establishRound: 建 docs/R-(N+1)/ 与阶段索引、各阶段目录、AGENTS.md.bak
  // 快照);③ -m/--mode 跨轮固定,显式给出即用法错误。
  //
  // Every check runs before the first write (plans/0052 D7): a refused init
  // leaves config.json, the templates, AGENTS.md and docs/ untouched.
  if (command === "init" && flags.has("continue")) {
    console.error("--continue is not an option: round continuation uses the dedicated subcommand opencode-auto continue <dir> (starts a new round after the previous phased migration round fully completes)")
    process.exit(1)
  }
  const cont = command === "continue"
  const amendCommand = command === "amend"
  if (amendCommand) {
    const allowed = new Set([...CONFIG_FLAGS, "verify-idle", "verify-max", "commit-subtask"])
    for (const key of flags.keys()) {
      if (allowed.has(key)) continue
      console.error(
        key === "prompt"
          ? `-p/--prompt is not an amend option: the brief is not config — edit ${BRIEF_FILE} directly`
          : key === "force"
            ? "-f/--force is not an amend option: amend discards no key, so there is no overwrite confirmation or worktree check to skip"
            : key === "amend"
              ? "--amend is redundant: the amend command always keeps the keys it is not given"
              : `--${key} is not an amend option: amend takes only config flags (${CONFIG_FLAGS.map((name) => (name === "mode" ? "-m/--mode" : `--${name}`)).join(", ")})`,
      )
      process.exit(1)
    }
    if (!(await Bun.file(join(directory, CONFIG_FILE)).exists())) {
      const legacy = await legacyModeFallback(directory)
      console.error(
        `nothing to amend: ${directory} has no ${CONFIG_FILE}; run opencode-auto init ${directory}` +
          (legacy !== undefined ? ` (or opencode-auto fix ${directory}, which writes it from the legacy .auto/config.json mode "${legacy}")` : ""),
      )
      process.exit(1)
    }
    if (!CONFIG_FLAGS.some((key) => flags.has(key))) {
      console.error(
        `name at least one key to change (for example: opencode-auto amend ${directory} --phases amt); ` +
          `to refresh the agent contract and the AGENTS.md block without changing a key, run opencode-auto fix ${directory}`,
      )
      process.exit(1)
    }
  }
  // --file is plan's planning input (auto-core plans/0053 D14); init's -p is
  // the brief, a different thing, so --file is refused rather than ignored.
  if (flags.has("file")) {
    console.error(`--file is a plan option (the planning input: opencode-auto plan <dir> --file <path>); ${command} does not accept it`)
    process.exit(1)
  }
  if (cont) {
    if (flags.has("mode")) {
      console.error(
        "-m/--mode is fixed across rounds and cannot change during continue: a continuation round continues the same work (the previous round's conclusions assume the same mode)." +
          " To change it, init a new project in a new directory",
      )
      process.exit(1)
    }
  }
  if (flags.has("commit-subtask")) {
    console.error("--commit-subtask removed: commits are now made by the driver after every session ends (AI commit rights revoked), and can no longer be turned off (--commit false is retired)")
    process.exit(1)
  }
  const promptText = flags.get("prompt")
  if (promptText !== undefined && !promptText.trim()) {
    console.error("-p/--prompt requires non-empty prompt text")
    process.exit(1)
  }
  for (const key of ["verify-idle", "verify-max"]) {
    if (flags.has(key)) {
      const renamed = key === "verify-idle" ? "idle-time" : "idle-max"
      console.error(`--${key} was renamed to --${renamed} (the driver-run script watchdog)`)
      process.exit(1)
    }
  }
  if (flags.has("max-sessions")) {
    console.error(`--max-sessions is a run option (concurrent AI sessions for this run); ${command} does not accept it`)
    process.exit(1)
  }
  const { explicit, phases, agent, parallel } = parseConfigFlags(directory)
  // 全量覆盖 vs 增量修订的唯一分水岭: 缺省取内置缺省表作基线(未给出的键回落
  // 默认值),--amend 取磁盘上的既有配置作基线(未给出的键保留原值)。continue
  // 恒为 amend——续轮迁移依赖既有配置,跨轮固定项(mode)已在上方前置守卫拒绝
  // 传入,没有「全量覆盖」可言。
  //
  // An amend loads strictly, since it would carry a retired key over. A full
  // overwrite discards them anyway, so its baseline read tolerates them and
  // names each one before the overwrite (plans/0052 D4) — otherwise a stored
  // `commit: false` or `source` would block the very re-init that clears it.
  // From P2 the strict failure names `fix` when a rule repairs it (D4, D11).
  const amend = cont || amendCommand || flags.has("amend")
  let existing: ProjectConfig
  let discarded: RetiredKey[] = []
  try {
    if (amend) existing = await loadProjectConfig(directory)
    else ({ config: existing, retired: discarded } = await loadOverwriteBaseline(directory))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    const hint = await fixHint(directory)
    if (hint) console.error(hint)
    process.exit(1)
  }
  // acceptanceGate/build (plans/0049 G9) have no flag, so they are only ever
  // hand-edited: a full-overwrite init keeps them rather than silently erasing them.
  const handEdited = { acceptanceGate: existing.acceptanceGate, build: existing.build }
  const base: ProjectConfig = amend ? existing : { ...CONFIG_DEFAULTS, ...handEdited }
  // 本次生效的 phases: 显式给出即用之,否则取基线值(全量覆盖下 = 缺省 "m",
  // --amend/continue 下 = 既有配置值)。阶段索引前缀护栏使用。
  const effectivePhases = phases ?? base.phases
  // handoverTest 须搭配 testByDriver: 显式给出时按本次生效值校验(未显式给出
  // test-by-driver 则回落既有配置值);amend 关闭 test-by-driver 而保留既有
  // handoverTest=true 亦在此拦截。
  {
    const effectiveTestByDriver = explicit.testByDriver ?? base.testByDriver
    const effectiveHandoverTest = explicit.handoverTest ?? base.handoverTest
    if (effectiveHandoverTest && !effectiveTestByDriver) {
      console.error(
        `${explicit.handoverTest !== undefined ? "--handover-test" : "the existing handoverTest"} requires --test-by-driver: ` +
          "test handover only makes sense when tests run via the driver. To fix: give --test-by-driver as well (or --handover-test false), e.g. opencode-auto amend <dir> --test-by-driver --handover-test; or edit .opencode/auto/config.json directly",
      )
      process.exit(1)
    }
  }
  // 阶段索引(当前轮 docs/R-NN/phases.md + 各阶段目录 todo.md/done.md,M3.3)是
  // 推导式状态载体;非法即环境错误退出 1(报文给人工修订指引)。已完成阶段的类型
  // 序列(索引序,M3.6 起取代预置字母串): 非空时显式改 --phases 须满足前缀护栏。
  // An interrupted continue leaves the new round's directory without an index
  // (plans/0049 G6): continue then judges the previous round, and re-running
  // it finishes establishing the new one on the same number (nextRound).
  const liveRound = await currentRound(directory)
  const stateRound = cont && liveRound > 1 && (await roundEstablishing(directory, liveRound)) ? liveRound - 1 : liveRound
  let phaseState: PhaseState | undefined
  try {
    phaseState = await readPhases(directory, stateRound)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  const indexPath = phaseIndexPath(stateRound)
  const completedPhases = phaseState ? doneTypes(phaseState) : []
  // 生效 phases 与既有配置 phases 展开为类型序列(均已校验合法)。
  const typesOf = (value: string) => parsePhases(value, directory)!.map((entry) => entry.type)
  const effectiveTypes = typesOf(effectivePhases)
  // continue 前置校验(按既有配置判定,不看向新 --phases 值): 仅阶段化项目、且
  // 上一轮已全部完成——阶段索引存在且其中每个阶段都已完成(done.md)。轮首建立后
  // 新一轮阶段全未完成,新一轮 --phases 不受前缀护栏约束(从头规划,任何合法值可改)。
  if (cont) {
    if (existing.phases === "m") {
      console.error(
        `continue only applies to phased-flow projects: the current config has phases = "m" (a single run with no phase declaration, no rounds). ` +
          `enable the phased flow first with opencode-auto amend <dir> --phases <admtvk subsequence containing m | type-id list containing implement>`,
      )
      process.exit(1)
    }
    if (phases === "m") {
      console.error('continue is for phased-flow round continuation; --phases cannot be "m"')
      process.exit(1)
    }
    const declared = typesOf(existing.phases)
    const outside = completedPhases.filter((type) => !declared.includes(type))
    if (outside.length) {
      console.error(
        `continue precheck failed: the phase index ${indexPath} records completed phases outside phases (${existing.phases}): ${outside.join(", ")}. ` +
          "fix the index manually before continuing to the next round",
      )
      process.exit(1)
    }
    const pending = phaseState ? phaseState.phases.filter((unit) => !phaseState.done.has(unit.id)).map(phaseLabel) : []
    if (!phaseState || pending.length) {
      console.error(
        `continue requires the previous round to be fully complete: the phase index ${indexPath} ` +
          `${phaseState ? `still has pending phases ${pending.join(", ")}` : "is missing"} (phases ${existing.phases}). ` +
          `run opencode-auto run ${directory} first to finish this round`,
      )
      process.exit(1)
    }
    // Round-close gate (plans/0049 G8, anchor b): the whole-tree P1 scan, the
    // target build and round.md's close listing must pass before a new round.
    const close = await roundCloseProblems(directory, stateRound, { build: existing.build })
    if (close.problems.length) {
      console.error(`continue refused: round ${stateRound} does not pass its round-close checks`)
      for (const line of roundCloseLines(close)) console.error(line)
      process.exit(1)
    }
    for (const warning of close.warnings) console.log(`⚠ ${warning}`)
  }
  // 前缀护栏判定的是**本次生效值**而非「是否显式给出」: 全量覆盖下无参 init 会把
  // phases 回落为缺省 "m",若项目已跑在阶段化流程中途(已有完成阶段),这会静默毁掉
  // 已完成阶段(syncPhaseIndex 拒绝丢弃已完成阶段,但报错发生在配置写盘之后)。
  // 判生效值即可把这种情形拦在任何写盘之前。--amend/continue 下生效值 = 既有配置
  // 值,天然满足前缀条件,旧行为不变。
  const completedText = completedPhases.join(",")
  if (!cont && completedPhases.length && !completedPhases.every((type, i) => effectiveTypes[i] === type)) {
    console.error(
      flags.has("phases")
        ? `the new --phases value "${effectivePhases}" is incompatible with the phase index (${indexPath}): its completed phases are "${completedText}", which must be a prefix of the new value's phase types. ` +
            "use a value prefixed by it, or roll the index back manually (rename done.md to todo.md) before changing it"
        : `a no-flag init overwrites with defaults and would reset phases to "${effectivePhases}", incompatible with the completed phases "${completedText}" in the phase index (${indexPath}) (it would destroy the round layout). ` +
            `to change individual keys and keep the rest use opencode-auto amend ${directory} --<key> <value> (opencode-auto fix ${directory} refreshes the agent contract and AGENTS.md block); ` +
            `to really change phases, pass --phases explicitly prefixed by "${completedText}"`,
    )
    process.exit(1)
  }
  // -m/--mode 解析(缩减版,init 侧): 优先级 显式值 > 基线值(全量覆盖下即缺省,
  // --amend/continue 下为既有配置值);未注册名为用法错误(报文列出当前支持的模式)。
  const modeName = flags.get("mode") ?? base.mode
  const modes = loadModeTable(directory)
  if (!modes[modeName]) {
    console.error(`--mode must be a registered mode (currently supported: ${Object.keys(modes).join(", ")}); defaults to migrate`)
    process.exit(1)
  }
  const config = mergeProjectConfig(base, { ...explicit, mode: modeName })
  // --parallel none / --agent opencode drop their keys (an amend would
  // otherwise keep the old value).
  if (parallel === "none") delete config.parallel
  if (agent === "opencode") delete config.agent
  // The round this run establishes (continue: the next one) and the phase units
  // the index sync will leave there. The sync's own refusals (dropping a
  // completed phase, or a phase directory that holds work) surface here,
  // before anything is written.
  const round = cont ? await nextRound(directory) : liveRound
  let units: PhaseUnit[]
  try {
    units = await plannedPhaseUnits(directory, round, config.phases)
  } catch (error) {
    console.error(`round establishment failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  // 提示词库与意图包: 装载目标目录 .opencode/auto/prompts/ 与 .opencode/auto/intents/
  // 覆盖(协议校验失败即退出);init 不渲染提示词,提前装载可在 init 阶段就暴露
  // 覆盖问题。
  try {
    usePromptLibrary(directory)
    useIntentPacks(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  for (const item of discarded) console.log(`⚠ full overwrite drops the retired key ${item.key} = ${JSON.stringify(item.value)}: ${item.why}`)
  // 防误触闸门: 只在「已存在配置、且本次是全量覆盖」时生效——全新目录没有可覆盖
  // 的东西,--amend 也不会丢弃任何既有键。两道闸都必须排在第一个写盘点
  // (saveProjectConfig)之前,现有 e2e 断言「旗标校验通过前目录为空」的不变式
  // 依赖于此;先拦截再询问,避免用户答完 y 才看到报错。
  const force = flags.has("force")
  const overwriting = !amend && !force && (await Bun.file(join(directory, ".opencode", "auto", "config.json")).exists())
  if (overwriting) {
    // ① 工作区干净度: init 会覆盖已落盘的配置,git 是用户唯一的撤销手段。
    //    非 TTY 同样生效——免掉的只是交互确认,不是这道拦截。
    const dirty = await checkCleanTree(directory, "init full overwrite")
    if (dirty) {
      console.error(dirty)
      process.exit(1)
    }
    // ② 交互确认: 非 TTY 直接放行(confirm 内部判定)。
    const ok = await confirm(
      "found an existing config .opencode/auto/config.json; init will fully overwrite it with these parameters (keys not given fall back to defaults; to change individual keys instead, use opencode-auto amend). continue? [y/N] ",
    )
    if (!ok) {
      console.log("cancelled; nothing was changed")
      process.exit(0)
    }
  }
  try {
    await saveProjectConfig(directory, config)
  } catch (error) {
    console.error(`failed to write .opencode/auto/config.json: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  console.log(`⚙ project config (.opencode/auto/config.json): ${formatProjectConfig(config)}`)
  // `type: "file"` 导入会被嵌入编译产物,保证独立二进制可用。任务不在此写(PLAN.md
  // 已退役,M3.4): 由下方 establishRound 建轮次目录与阶段目录,任务单元由规划会话
  // 或人工写出。amend writes only what renders from the config (the
  // contract); opencode.json may hold a person's edits and is init's and fix's.
  const templates: Record<string, string> = amendCommand
    ? { ".opencode/agent/auto.md": templateAgent }
    : { "opencode.json": templateConfig, ".opencode/agent/auto.md": templateAgent }
  for (const [file, source] of Object.entries(templates)) {
    const target = resolve(directory, file)
    const raw = await Bun.file(source).text()
    // agent 契约按 config.testByDriver 条件渲染。
    const content = file === "opencode.json" ? raw : renderText(raw, { testByDriver: config.testByDriver })
    const existing = await Bun.file(target).text().catch(() => undefined)
    if (existing !== undefined && (existing === content || file !== ".opencode/agent/auto.md")) {
      console.log(`already exists, skipped: ${file}`)
      continue
    }
    await Bun.write(target, content)
    console.log(existing === undefined ? `created: ${file}` : `replaced (differed from the template): ${file}`)
  }
  // The project brief stub (plans/0052 D9): written only when the file is
  // missing and no -p text replaces it below; a person's brief is never touched.
  if (!amendCommand && promptText === undefined) {
    if (await Bun.file(join(directory, BRIEF_FILE)).exists()) console.log(`already exists, skipped: ${BRIEF_FILE}`)
    else {
      await Bun.write(join(directory, BRIEF_FILE), renderProjectBrief())
      console.log(`created: ${BRIEF_FILE} (project brief stub: fill in the goal, the migration source and target, and constraints; every planning session reads it)`)
    }
  }
  // 幂等同步 AGENTS.md 的 opencode-auto 块: 按当前配置渲染,与文件中现有标准块比对
  // ——缺失则追加、内容不一致则整块替换、旧版/多余的带名标记块一律清理。
  const ensured = await ensurePointer(directory, { testByDriver: config.testByDriver })
  console.log(
    ensured.block === "inserted"
      ? "appended: AGENTS.md opencode-auto block"
      : ensured.block === "replaced"
        ? "refreshed: AGENTS.md opencode-auto block (differed from the current config render)"
        : "already exists, skipped: AGENTS.md opencode-auto block (up to date)",
  )
  if (ensured.legacyRemoved) console.log(`cleaned: removed ${ensured.legacyRemoved} legacy/stray opencode-auto marker block(s) from AGENTS.md`)
  if (!amendCommand && (await ensureGitignore(directory))) console.log("updated: .gitignore now ignores tmp/ and .auto/ (driver workdir and runtime state)")

  // 轮首建立(轮次专用目录 docs/R-NN,plans/0006-phases-design.md M 节;须在 ensurePointer
  // 之后,AGENTS.md.bak 快照才含 opencode-auto 块): init 建当前轮(全新项目 = R-01,幂等
  // ——已有阶段索引按预置同步,只重写未开始的尾部阶段);continue 建新一轮 R-(N+1)
  // (前置校验已过;上一轮结论经 prevRoundDigest 注入新一轮首个阶段规划会话)。无阶段
  // 模式("m")同样建立,唯一阶段为 P01-implement(plans/0047 L2)。
  try {
    const established = await establishRound(directory, { phases: config.phases, round })
    console.log(`✓ round directory: ${established.root}/ (the phase index phases.md and one P<nn>-<type>/ directory per phase, each with its task index tasks.md once planned; once written, permanent)`)
  } catch (error) {
    console.error(`round establishment failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  if (amendCommand) {
    const given = CONFIG_FLAGS.filter((key) => flags.has(key)).map((key) => (key === "mode" ? "-m" : `--${key}`))
    console.log(`✓ amended (${given.join(" ")}); the other keys are unchanged. Review the change and commit it`)
    process.exit(0)
  }

  // -p/--prompt: 项目意图文本写入 .opencode/auto/brief.md(版本化、随仓库共享、
  // 人工可编辑,amend 语义——重复 init -p 覆盖重写),由每个阶段的规划会话消费。
  // init 不再启动任何 AI 会话(设计文档 plans/0006-phases-design.md §B.1: 规划必须感知
  // 各阶段产物,从 init 挪到 run 的阶段边界)。
  if (promptText !== undefined) {
    await Bun.write(join(directory, BRIEF_FILE), promptText.trimEnd() + "\n")
    console.log(`written: ${BRIEF_FILE} (project brief, consumed by phase planning sessions; repeated init -p overwrites it)`)
  }
  const taskIndex = taskIndexPath(units[0]!)
  // 结束语按 phases 分两态: "m" 提示人工写任务单元(run 在 m 下不规划,-p 写下的
  // brief 只供日后的规划会话);阶段化流程下任务由阶段规划会话写出,不提示手工编辑。
  // continue 下新一轮阶段全未完成,首个阶段 = 新 phases 的第一个字母;另打新一轮横幅。
  if (config.phases === "m") {
    console.log(
      `${promptText !== undefined ? "brief recorded; " : ""}list tasks in ${taskIndex} (one line \`- [ ] T-NNN <title>\` each, content in docs/T-NNN/todo.md), then run: opencode-auto run ${directory}`,
    )
    process.exit(0)
  }
  // 首个未完成阶段: 前缀护栏保证已完成阶段恰为生效类型序列的前缀。
  const current = parsePhases(config.phases, directory)![cont ? 0 : completedPhases.length]
  if (cont) {
    console.log(`round ${round} of the migration started: making the migration result more complete and consistent with the source on top of existing progress`)
  }
  // The round-start gate (plans/0049 G1): the setup stays uncommitted until the
  // human has reviewed it; run's clean gate refuses to start before that.
  console.log(
    `next (round-start gate): review the round setup, fill in ${roundBriefPath(round)} (goal, acceptance and release criteria), and commit it`,
  )
  console.log(
    `${promptText !== undefined ? "brief recorded; " : ""}then run: opencode-auto run ${directory}${current ? ` to start ${current.type} (${current.name}) phase planning` : " (all phases complete)"}`,
  )
  process.exit(0)
}

// check: ①启发式检查 AGENTS.md 与未完成任务的任务文档中是否有与"提交执行权在 driver"原则
// (及 testByDriver 启用时的"测试/编译
// reset 子命令(反初始化 / 卸载): 与 init 互逆,精确移除 init 写出的配置层产物,
// 把工作区还原到未初始化状态,消除配置残留对 opencode 主程序与其他扩展组件的
// 干扰。清单与执行都在 auto-core/reset.ts(边界口径写在那里的文件头注释):只清
// 配置层,不碰 .auto/ 运行时状态、docs/ 与 tmp/;与主程序共用的
// opencode.json 逐字节比对模板后才删,AGENTS.md 只摘除 opencode-auto 标记块;
// 目录一律 rmdir(空才回收),保住 .opencode/auto/prompts/ 与用户其他 agent 契约。
if (command === "reset") {
  const entries = await planReset(directory)
  const actionable = entries.filter((entry) => entry.action !== "keep")
  if (!actionable.length) {
    console.log(`no init artifacts found; reset not needed: ${directory}`)
    process.exit(0)
  }
  console.log(`the following cleanup will run in ${directory}:`)
  console.log(formatResetPlan(entries))
  const force = flags.has("force")
  if (!force) {
    // reset 恒为破坏性,干净度闸门无条件生效(不像 init 只在覆盖时才查)。
    const dirty = await checkCleanTree(directory, "reset deinit")
    if (dirty) {
      console.error(dirty)
      process.exit(1)
    }
    const ok = await confirm(`the ${actionable.length} item(s) above will be deleted/restored; continue? [y/N] `)
    if (!ok) {
      console.log("cancelled; nothing was changed")
      process.exit(0)
    }
  }
  try {
    await applyReset(directory, entries)
  } catch (error) {
    console.error(`reset failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  console.log(`✓ restored to the uninitialized state (docs/, .auto/ runtime state and tmp/ untouched)`)
  process.exit(0)
}

// fix (plans/0052 D10/D11): repairs the config layer by rule — retired or
// renamed keys in config.json, and config-layer artifacts that are missing or
// out of step with the config. The rule table and its boundary are in
// auto-core/config-fix.ts. Its baseline is the existing config, read raw; it
// takes no config flags and never resets a key. The interaction is reset's:
// print the plan, then the worktree cleanliness gate and the confirmation
// (-f skips both), then apply. It never commits: the diff is left for review.
if (command === "fix") {
  const plan = await planFix(directory)
  if (plan.uninitialized) {
    console.error(`nothing to fix: ${directory} has no ${CONFIG_FILE}; run opencode-auto init ${directory}`)
    process.exit(1)
  }
  if (!plan.findings.length) {
    console.log(`✓ nothing to fix: the config layer of ${directory} is consistent with its config`)
    process.exit(0)
  }
  const fixable = plan.findings.filter((finding) => finding.class === "fixable")
  const manual = plan.findings.filter((finding) => finding.class === "manual")
  console.log(`config-layer findings in ${directory}:`)
  console.log(formatFixPlan(plan))
  if (fixable.length) {
    if (!flags.has("force")) {
      const dirty = await checkCleanTree(directory, "fix")
      if (dirty) {
        console.error(dirty)
        process.exit(1)
      }
      const ok = await confirm(`apply the ${fixable.length} fix(es) above? [y/N] `)
      if (!ok) {
        console.log("cancelled; nothing was changed")
        process.exit(0)
      }
    }
    try {
      await applyFix(plan)
    } catch (error) {
      console.error(`fix failed: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
    for (const finding of fixable) console.log(`fixed: ${finding.path}: ${finding.change}`)
  }
  if (manual.length) {
    console.error(`${manual.length} finding(s) need a person (listed as manual above): edit the file by hand, then re-run opencode-auto fix ${directory}`)
    process.exit(1)
  }
  console.log("✓ config layer repaired; review the change and commit it")
  process.exit(0)
}

// 等命令执行权在 driver"原则)相违背的描述;②引用检查(stable-refs P4)——
// 全量活文档(docs/**/*.md)扫描失效引用(路径不存在 /
// 行号超出文件总行数)。任一命中退出码 1,供人工修订。测试类检查是否启用由
// checkPrinciple 依配置决定,testOn 仅用于调整报文措辞。
if (command === "check") {
  const { findings, notes, refs, testOn } = await checkPrinciple(directory)
  const active = [...(testOn ? ["test"] : []), "commit"].join("/")
  const detail = testOn ? "" : "test disabled (driver-run tests off)"
  console.log(`checking ${directory}: ${active} execution-rights principles${detail ? ` (${detail})` : ""} + doc references`)
  for (const note of notes) console.log(`ℹ ${note}`)
  if (!findings.length && !refs.length) {
    console.log(`✓ no statements violating the ${active} principles; all doc reference checks passed`)
    process.exit(0)
  }
  for (const finding of findings) {
    console.log(`⚠ ${finding.file}${finding.task ? `(${finding.task})` : ""}:${finding.line}: ${finding.text}`)
  }
  for (const ref of refs) {
    console.log(`⚠ stale reference ${ref.file}:${ref.line} → ${ref.path} (${ref.problem === "beyond-eof" ? "line beyond end of file" : "path not found"}): ${ref.text}`)
  }
  const summary = [
    ...(findings.length
      ? [
          `${findings.length} statement(s) may violate the principles (heuristic check; review and fix manually` +
            `${testOn ? "; write compile/test/build/lint commands as scripts in test/ for the driver to run" : ""})`,
        ]
      : []),
    ...(refs.length ? [`${refs.length} stale reference(s) (update to current paths, or exempt with the inline markers deleted/archived/historical)`] : []),
  ]
  console.log(`found ${summary.join(" and ")}`)
  process.exit(1)
}

// 阶段进度行(run 横幅与 status 共用): 当前轮阶段索引 → P01-analysis✓ P02-design▶ …;
// 索引缺失/非法只给提示行,不阻塞调用方。
async function phasesLine(directory: string): Promise<string> {
  const round = await currentRound(directory)
  try {
    const state = await readPhases(directory)
    if (!state) return `⚠ phase index (${phaseIndexPath(round)}) is missing; run opencode-auto init to establish the round`
    return `phases${round > 1 ? ` (round ${round})` : ""}: ${formatPhases(state)}`
  } catch (error) {
    return `⚠ phase index (${phaseIndexPath(round)}) is invalid: ${error instanceof Error ? error.message : String(error)}`
  }
}

if (command === "status") {
  // 配置摘要,随后是当前轮的只读总览树(轮 → 阶段 → 任务 → 子任务,状态与依赖;
  // plans/0047 L1/R2)。配置非法仅提示、不阻塞总览;阶段/任务索引缺失或非法以
  // ⚠ 行呈现。A live run lock comes first (plans/0053 D3).
  const holder = liveRunLock(directory)
  if (holder) console.log(lockStatusLine(holder))
  try {
    const config = await loadProjectConfig(directory)
    console.log(`⚙ project config (.opencode/auto/config.json): ${formatProjectConfig(config)}`)
  } catch (error) {
    console.log(`⚠ project config (.opencode/auto/config.json) is invalid: ${error instanceof Error ? error.message : String(error)}`)
    const hint = await fixHint(directory)
    if (hint) console.log(`  ${hint}`)
  }
  for (const line of await renderStatus(directory)) console.log(line)
  process.exit(0)
}

console.error(`usage:
  opencode-auto init [dir] [-p|--prompt <brief-text>] [-m|--mode <name>] [--agent opencode|claude] [--subtask [off|auto|ondemand]] [--idle-time [1-120]] [--idle-max [1-1440]] [--commit [true]] [--context-limit [n]] [--phases <admtvk subsequence with m | type-id list>] [--test-by-driver [true|false]] [--handover-test [true|false]] [--auto-number|--no-auto-number] [--wrapup|--no-wrapup] [--parallel none|low|medium|high] [--amend] [-f|--force]
  opencode-auto continue [dir] [--phases <admtvk subsequence with m | type-id list>] [-p|--prompt <brief-text>] [--agent opencode|claude] [--subtask [off|auto|ondemand]] [--idle-time [1-120]] [--idle-max [1-1440]] [--commit [true]] [--context-limit [n]] [--test-by-driver [true|false]] [--handover-test [true|false]] [--auto-number|--no-auto-number] [--wrapup|--no-wrapup] [--parallel none|low|medium|high]
  opencode-auto run [dir] [--server <url>] [--verbose [true|false]] [--interactive|-i] [--wait-answer [1-60]] [--wait-between [1-60]] [--permission [auto-allow|ask-allow|ask-deny|ask-fail]] [--dryrun [true|false]] [--new-session] [--max-sessions 1]
  opencode-auto plan [dir] [-p|--prompt <text> | --file <path>] [--append] [--server <url>] [--verbose [true|false]] [--interactive|-i] [--wait-answer [1-60]] [--permission [auto-allow|ask-allow|ask-deny|ask-fail]] [--new-session]
  opencode-auto close <ref> [dir] --reason <text> [--cascade] [--commit-changes | --stash-changes]
  opencode-auto amend [dir] [-m|--mode <name>] [--agent opencode|claude] [--subtask [off|auto|ondemand]] [--idle-time [1-120]] [--idle-max [1-1440]] [--commit [true]] [--context-limit [n]] [--phases <admtvk subsequence with m | type-id list>] [--test-by-driver [true|false]] [--handover-test [true|false]] [--auto-number|--no-auto-number] [--wrapup|--no-wrapup] [--parallel none|low|medium|high]
  opencode-auto fix [dir] [-f|--force]
  opencode-auto reset [dir] [-f|--force]
  opencode-auto check [dir]
  opencode-auto status [dir]

options: project-constitution options (-m/--mode, --agent, --context-limit, --subtask, --idle-time, --idle-max, --commit, --test-by-driver, --handover-test, --auto-number/--no-auto-number, --wrapup/--no-wrapup, --phases, --parallel) are frozen by init into .opencode/auto/config.json (versioned, shared with the repo, human-editable); passing them to run is a usage error
       init defaults to a stateless full overwrite: the output is determined solely by the parameters given this time; keys not provided fall back to defaults without merging the old on-disk config — the same init produces identical output in any environment, no pre-cleanup needed
       amend changes the config keys given and keeps the rest (at least one key; refuses without .opencode/auto/config.json); it rewrites config.json, the agent contract and the AGENTS.md block, and re-syncs the current round's unstarted phases after a --phases change. init --amend does the same and stays until plan takes over init's round step; continue is always amend
       fix repairs the config layer by rule, never changing a key's meaning: drops or renames retired keys in config.json (moving source/destDir into .opencode/auto/brief.md), writes config.json from a legacy .auto/config.json, and rewrites the agent contract, the AGENTS.md block and the .gitignore entries when missing or out of step with the config (opencode.json and the brief stub only when missing); anything else is reported for a person to fix (exit 1). It prints the plan, then asks like reset; it never commits
       -f/--force skips the confirmation and the worktree cleanliness check (for CI and automation; shared by init, reset and fix)
         plan establishes the current round when it is not yet (and, once a finished round passes its round-close checks, the next one), plans the current phase and stops before any task runs, for review; where nothing needs an agent it prints what is next and exits 0. -p/--prompt <text> or --file <path> is the planning input: it is saved as the phase's plan-input.md and committed before the planning session reads it (refused on a round that is not established yet: establish it, commit the setup, then pass the input). --append appends the tasks planned from the input to the phase the route names now, never advancing to another phase (on the plan route the phase is planned normally; in m mode the input already implies the append on a non-empty index); it requires an input, refuses while a task is mid-pipeline, and a stale handover of the phase is removed and distilled again after the appended tasks. It takes run's session options; config options, --dryrun, --wait-between and --max-sessions are refused. Exit codes as run's (2 also when the finished round fails its round-close checks)
        close <ref> closes a unit (task T-NNN, phase R-NN.P<nn> or round R-NN) without completing it — done for scheduling, never delivered: the reason goes into a Closed: field of the unit's done.md, a close commit (Auto-Stage: force-close), and for a phase a driver-written mechanical handover that records the skipped gates. The ref comes first (then the directory); the explicit ref and the required one-line --reason are the confirmation (no prompt), and the undo is "git revert" of the close commit, printed in the output and valid before anything else runs. --cascade closes explicit dependents too (tasks whose Depends: names a closed unit, repeating over their chains); --commit-changes / --stash-changes handle uncommitted changes (folded into the close commit / stashed away) — without one, anything beyond the driver's own state files refuses the close. Exit codes: 0 closed; 1 refused or usage error; 2 the close commit or close-out check failed
        run lock: run and plan hold .auto/run.lock while they work, and close holds it around its writes; init, continue, amend, fix and reset refuse while another process holds it (-f does not override it), and status shows it on its first line. A lock whose process is gone is removed by the next run, plan or close
       --new-session when resuming from an interruption, do not reuse the interrupted session; start a new one (only skips session reuse; exact phase re-entry is unaffected; by default the surviving interrupted session is reused)
       -m/--mode prompt-level scenario mode (built-in migrate; add or override via .opencode/auto/modes/<name>.md in the target directory — new modes need no source changes)
       -p/--prompt on init: project brief text, written to .opencode/auto/brief.md and consumed by phase planning sessions (init starts no AI sessions; on plan, -p is the planning input); without -p, init writes a stub there when the file is missing (## Goal, ## Source, ## Target, ## Constraints; comments are hints, stripped before planning). State the migration source and target here — --source-dir/--source-path/--dest-dir are retired
       reset de-initialization (inverse of init): removes the config-layer artifacts init wrote (.opencode/auto/config.json, brief.md while it is the untouched stub, .opencode/agent/auto.md, legacy .auto/config.json, the AGENTS.md opencode-auto block, the tmp/ and .auto/ entries in .gitignore, plus opencode.json if unmodified); docs/, .auto/ runtime state and tmp/ are never touched; empty directories only are reclaimed (preserving .opencode/auto/prompts/ and your other agent contracts)
       --phases <admtvk subsequence with m | type-id list> phased flow (a analysis → d design → m migration implementation → t test → v acceptance → k knowledge distillation; "m" default = the manual single phase P01-implement, no planning or handover session; alternatively a comma-separated list of phase type ids in any order, repeats allowed, containing implement (e.g. analysis,security-review,implement), where custom types are defined one per file in .opencode/auto/phases/<type>.md; once phases are complete, changes must satisfy the prefix guard — see README)
       --commit [true] unified commit after sessions (always on: after any session ends and the driver writes completion state, the driver recursively commits all changes — git history is the audit trail of AI changes; --commit false and the old alias none are retired — committing is the completion condition, it can no longer be turned off)
       --test-by-driver [true] moves compile/test/build/lint execution rights to the driver: execution-type sessions no longer run such commands in-session; instead they write the commands as scripts into test/ and put the script path in tmp/test.sh for the driver, which merges stdout/stderr into tmp/test.<n>.out and feeds the exit code and output file back to the session for the AI to judge
       --handover-test requires --test-by-driver: when a session's context reaches its cap, hand over at the moment it next initiates a test — the driver first commits the finalized pinned script and sources, and has the AI write remaining work that does not depend on test results to disk plus a handover document (subtask sessions: docs/<task>/S<two-digit>/testhandoff.md; whole-task sessions: docs/<task>/testhandoff.md) before ending the session; the document is archived as testhandoff-<n>.md with one more commit to confirm the handover, and only then does the test run (what gets tested is exactly that commit's tree); a new session reads the results and continues, avoiding repeated trial-and-error in an oversized context. If the handover is interrupted, the next run locates the breakpoint from the document's file and commit state (wrap-up unfinished → fork from the finalized point and redo the wrap-up; written → add the missing commit and run the script). Set OPENCODE_AUTO_HANDOVER_CONCURRENT=on to restore the old concurrent timing (tests start right after finalization, parallel to the session wrap-up, testing the finalized snapshot)
       --auto-number / --no-auto-number auto-numbering switch (default --auto-number = on; --no-auto-number is the opt-out): task numbers (T-NNN) never repeat in the target directory — the next free number is persisted in .auto/next-task and phase planning sessions continue from that record (no longer restarting from T-001 each phase); if the record is missing (e.g. a fresh clone without .auto/ shared), an AI recovery session first derives the next number from the task indexes, docs artifacts and git history, restores the record, and only then continues planning
       --wrapup / --no-wrapup task wrap-up session switch (default --wrapup = on; --no-wrapup is the opt-out): when off, the wrap-up session is skipped after each task's subtasks/whole-task execution completes (including wrap-up after fix rounds)
       --agent opencode|claude the coding agent that runs every session (default opencode; claude = Claude Code headless, needs the claude CLI on PATH). The agent contract is always .opencode/agent/auto.md; the env var OPENCODE_AUTO_AGENT overrides the configured agent for a run
       --parallel none|low|medium|high planning guidance (default none): how hard planning sessions work to make tasks independent (declared Depends:/Touches: fields, tasks split along file and module boundaries); the level's text comes from the ## parallelism section of the intent pack. It changes only what planning sessions are told — tasks still run one at a time
       --max-sessions <n> run option: the number of AI sessions running concurrently (counts sessions; unrelated to --agent). Reserved: only 1 (the default) is accepted until concurrent execution exists
       --implement-file / --implement-prompt are retired: plan tasks with opencode-auto plan <dir> -p <text> | --file <path> (after init and the round-start commit)
       continue subcommand: after the previous phased migration round fully completes, start a new round of continued migration (making the migration result more complete and consistent with the source) — at round start a new round directory docs/R-NN/ is created (the phase index phases.md and one P<nn>-<type>/ directory per phase — with its task index, handover and knowledge docs — all live inside the round, permanent once written, with the AGENTS.md snapshot stored as AGENTS.md.bak inside the round), and the previous round's conclusions (final-phase handover and migration knowledge) are injected into the new round's first phase planning session; -m/--mode is fixed across rounds and cannot change (passing it is a usage error), while --phases and the remaining execution options (including --test-by-driver/--handover-test) and -p may be revised per round (not subject to the prefix guard)

exit codes: 0 all complete; 1 usage/environment error (same when check finds principle-violating statements); 2 blocked/incomplete awaiting human intervention (including a task report whose result line reads Result: FAIL); 130 force-terminated by two consecutive Ctrl+C`)
process.exit(1)

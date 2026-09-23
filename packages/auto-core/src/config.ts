// 项目配置层(设计文档 plans/0004-init-config-agents-design.md §A): 宪法级选项——
// 决定会话被如何告知、提交语义如何运作的项目属性——在 init 固化到
// .opencode/auto/config.json,版本化、随仓库共享、人工可编辑;未知键忽略
// (前向兼容)。run 只控制本次执行,不再接受对应选项。旧版 .auto/config.json
// (仅 mode)只在新文件缺失时回落读取,新文件一经写出即不再读取;它不会被 run
// 清理(留在 gitignore 内自然沉没),但属配置层,由 reset 一并移除。
import { chmod } from "node:fs/promises"
import { join } from "node:path"
import { loadModes } from "./mode"
import { loadPhaseTypes } from "./phases/custom"
import { phasesProblem, resolvePhases } from "./phases/registry"
import type { SubtaskMode } from "./opts"
import { phaseTypeRoleProblems, type AgentChoice } from "./switches"
import { PARALLEL_LEVELS, type ParallelLevel } from "./intent/types"

export { PARALLEL_LEVELS, type ParallelLevel }

export type ProjectConfig = {
  // 须为 loadModes(dir) 已注册名。
  mode: string
  // The coding agent the project runs on (M6.1): opencode (absent, the
  // default — no key is written) or claude. Until M6.1 this key named the agent
  // contract; that name is fixed to `auto` now (opts.ts CONTRACT_AGENT), and a
  // stored contract name fails loading with a hint.
  agent?: AgentChoice
  // 千 tokens(与 CLI 单位一致;run 侧 ×1000 注入 Opts)。
  contextLimit: number
  subtask: SubtaskMode
  // 分钟,1..120。driver 执行脚本(--test-by-driver 的 test 脚本)的通用看门狗。
  idleTime: number
  // 分钟,0 = 不设,1..1440。
  idleMax: number
  // 会话后统一提交(缺省 true)。**false 已于 2026-09-15 退役**——统一提交是完成
  // 条件,读到 commit: false 的存量配置一律严格失败(见 validateProjectConfig);
  // 字段本身与代码侧的 opts.commit 门禁暂留,清理另立任务。
  commit: boolean
  // --test-by-driver: 测试/编译/构建等命令的执行权收归 driver。
  // 启用时执行类会话不直接运行这类命令,改为把命令写成脚本放 test/ 目录、把
  // 脚本路径写入 tmp/test.sh 告知 driver 执行,driver 合并 stdout/stderr 落单文件
  // 后把退出码与输出文件反馈回会话。
  testByDriver: boolean
  // --handover-test(需 testByDriver): 测试失败且会话上下文达上限时要求 AI 写
  // 交接文档后换新会话续跑,防止超大上下文中反复试错。
  handoverTest: boolean
  // --auto-number: 自动编号——任务编号(T-NNN)在目标目录永不重复,下一可用编号
  // 持久化在 .auto/next-task,规划会话自该记录续接编号;记录缺失时先经 AI 恢复
  // 会话推导恢复再继续。缺省 true(stable-refs D5 翻转);--no-auto-number 保留为
  // 退出开关(关闭后编号自 T-001 重排,与历史行为一致)。
  autoNumber: boolean
  // --no-wrapup: 关闭任务收尾会话(renderWrapup,子任务/整任务执行完成后与
  // 修复轮后的收尾会话)。缺省 true(现状零变化)。
  wrapup: boolean
  // 字母预置(admtvk 的子序列且含 m,设计文档 plans/0006-phases-design.md §A)或
  // 逗号分隔的阶段类型 id 列表(含 .opencode/auto/phases/ 的自定义类型,须含
  // implement,M3.6);"m" = 无阶段声明,单次运行。config.json 里也可写 JSON 数组,
  // 读取时规范化为逗号串。
  phases: string
  // Phase types whose phases wait for a human's `Accepted: yes` in their
  // acceptance.md before they are marked done (M4.2, plans/0049 G7/G9; a
  // custom type can carry the gate itself with `Gate: acceptance`). Optional,
  // hand-edited; absent = no builtin type is gated.
  acceptanceGate?: string[]
  // The target's own build command, run in the target directory by the
  // round-close gate (M4.2, plans/0049 G8/G9). Optional, hand-edited; absent =
  // the build check is skipped.
  build?: string
  // How hard planning sessions work to make tasks independent (MP.1, plans/0046
  // D8/D10): the level picks the `## parallelism` intent subsection injected
  // into the planning templates. Absent = none (nothing injected, today's
  // prompts byte for byte). Planning guidance only: tasks still run one at a time.
  parallel?: ParallelLevel
}

export const CONFIG_DEFAULTS: ProjectConfig = {
  mode: "migrate",
  contextLimit: 64,
  subtask: "auto",
  idleTime: 10,
  idleMax: 0,
  commit: true,
  testByDriver: false,
  handoverTest: false,
  autoNumber: true,
  wrapup: true,
  phases: "m",
}

const CONFIG_FILE = join(".opencode", "auto", "config.json")
const LEGACY_FILE = join(".auto", "config.json")

// 读取 + 校验: 文件缺失 → 缺省 + legacy 回落(.auto/config.json 的 mode);
// 坏 JSON / 键值越界 / mode 未注册(loadModes)→ throw(中文报错含键名与期望),
// CLI 侧转退出码 1。run 与 init 均经此入口。
export async function loadProjectConfig(dir: string): Promise<ProjectConfig> {
  return validateProjectConfig(await readConfigRecord(dir), dir)
}

// A retired key found in config.json, with the value it held and why it is gone.
export type RetiredKey = { key: string; value: unknown; why: string }

// The baseline of a full-overwrite init (plans/0052 D4). The overwrite drops
// retired keys anyway, so they are returned for the caller to report instead
// of failing the load — a stored `commit: false` or `source` would otherwise
// block the very re-init that clears it. Every other key is validated as
// strictly as loadProjectConfig does; an amend still loads strictly, since it
// would carry the retired keys over.
export async function loadOverwriteBaseline(dir: string): Promise<{ config: ProjectConfig; retired: RetiredKey[] }> {
  const raw = await readConfigRecord(dir)
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { config: validateProjectConfig(raw, dir), retired: [] }
  const record = { ...(raw as Record<string, unknown>) }
  const retired: RetiredKey[] = []
  for (const [key, rule] of Object.entries(RETIRED_KEYS)) {
    if (!rule.retired(record[key])) continue
    retired.push({ key, value: record[key], why: rule.why })
    delete record[key]
  }
  return { config: validateProjectConfig(record, dir), retired }
}

// The parsed config.json, or the defaults (plus the legacy mode) when it is missing.
async function readConfigRecord(dir: string): Promise<unknown> {
  const text = await Bun.file(join(dir, CONFIG_FILE)).text().catch(() => undefined)
  if (text === undefined) {
    const legacy = await readLegacyMode(dir)
    return legacy === undefined ? { ...CONFIG_DEFAULTS } : { ...CONFIG_DEFAULTS, mode: legacy }
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${CONFIG_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Retired keys (tombstones). A stored retired value fails loading strictly
// with its own fix: ignoring it like an unknown key would hide that its meaning
// is gone. The names stay reserved forever — no future key may reuse one, or a
// stale config would be quietly reinterpreted (plans/0052 D3; the process-doc
// root of plans/0036 F18 therefore needs a name other than destDir).
const RETIRED_KEYS: Record<string, { retired: (value: unknown) => boolean; why: string; message: (value: unknown) => string }> = {
  // 2026-09-15, plans/0021-commit-boundary-design.md D7: the unit-commit clean
  // gate, SHA baseline and recovery rollback anchor all assume commits are on.
  commit: {
    retired: (value) => value === false,
    why: "unified commit is a completion condition",
    message: () =>
      "commit: false is retired (unified commit is a completion condition, see plans/0021-commit-boundary-design.md): remove the key or set it to true",
  },
  // D13, 2026-09-21, plans/0044 D2: the acceptance a stored `true` asks for no
  // longer runs. `false`, which init used to write, is ignored like any unknown key.
  verify: {
    retired: (value) => value === true,
    why: "task-level acceptance was removed",
    message: () => "verify is retired (task-level acceptance was removed; plan acceptance work as tasks or use the v phase): remove the key",
  },
  // M6.1: before it named the coding agent, the key named the agent contract.
  agent: {
    retired: (value) => typeof value === "string" && value !== "opencode" && value !== "claude",
    why: "the key once named the agent contract, which is always .opencode/agent/auto.md",
    message: (value) =>
      `agent must be opencode|claude ("${value}" looks like an agent contract name: that setting is retired — the contract is always .opencode/agent/auto.md; delete the key, or set "claude")`,
  },
  // plans/0052 D3: the migration parameters were only ever forwarded into the
  // phase-planning prompt, so they are intent and belong in brief.md.
  source: migrationParameter("source"),
  destDir: migrationParameter("destDir"),
}

function migrationParameter(key: string) {
  return {
    retired: (value: unknown) => value !== undefined,
    why: "the migration source and target are intent — state them in .opencode/auto/brief.md",
    message: (value: unknown) =>
      `${key} is retired (the migration source and target are intent, not configuration): ` +
      `copy its value ${JSON.stringify(value)} into .opencode/auto/brief.md, then remove the key`,
  }
}

// init 用: 仅显式给出的键覆盖既有值,其余保留(undefined 的键视同未给出);
// 返回待写回的完整配置。
export function mergeProjectConfig(existing: ProjectConfig, explicit: Partial<ProjectConfig>): ProjectConfig {
  const given = Object.fromEntries(Object.entries(explicit).filter(([, value]) => value !== undefined))
  return { ...existing, ...given }
}

// 普通整写(Bun.write 自动建父目录);只在 init(非 protect 期)调用,无需原子写。
// 写前 best-effort 解除只读位: protect.ts 在 run 期间把本文件 chmod 0444,run 被
// 强杀时该位会残留,而 allowWrite 靠模块级状态、在新进程里帮不上忙——不解除
// 会让此后所有 init 以 EACCES 失败。
export async function saveProjectConfig(dir: string, config: ProjectConfig): Promise<void> {
  const file = join(dir, CONFIG_FILE)
  await chmod(file, 0o644).catch(() => {})
  await Bun.write(file, JSON.stringify(config, null, 2) + "\n")
}

// run 启动提示用: 新文件缺失而旧版 .auto/config.json 仍有持久化 mode(生效
// 模式来自旧位置,重跑 init 可固化完整配置);返回旧值,无则 undefined。
export async function legacyModeFallback(dir: string): Promise<string | undefined> {
  if (await Bun.file(join(dir, CONFIG_FILE)).exists()) return undefined
  return readLegacyMode(dir)
}

async function readLegacyMode(dir: string): Promise<string | undefined> {
  const config = (await Bun.file(join(dir, LEGACY_FILE)).json().catch(() => undefined)) as { mode?: unknown } | undefined
  return typeof config?.mode === "string" ? config.mode : undefined
}

// run 启动横幅 / status 共用的一行配置摘要。
export function formatProjectConfig(config: ProjectConfig): string {
  const watchdog = `idle ${config.idleTime}m/max ${config.idleMax > 0 ? `${config.idleMax}m` : "unset"}`
  return (
    `mode ${config.mode} · agent ${config.agent ?? "opencode"} · subtask ${config.subtask}` +
    ` · watchdog ${watchdog} · commit ${config.commit ? "on" : "off"}` +
    (config.testByDriver ? ` · test-by-driver on${config.handoverTest ? "(handover)" : ""}` : "") +
    (config.autoNumber ? " · auto-number on" : "") +
    (config.wrapup ? "" : " · wrapup off") +
    ` · context-limit ${config.contextLimit}k · phases ${config.phases}` +
    (config.acceptanceGate?.length ? ` · acceptance gate ${config.acceptanceGate.join(",")}` : "") +
    (config.build ? " · build set" : "") +
    (config.parallel ? ` · parallel ${config.parallel}` : "")
  )
}

// 值域与 CLI 侧 parse* 一致;未知键忽略(前向兼容),缺失键回落缺省值。
function validateProjectConfig(raw: unknown, dir: string): ProjectConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${CONFIG_FILE} must be a JSON object`)
  const record = raw as Record<string, unknown>
  for (const [key, rule] of Object.entries(RETIRED_KEYS)) {
    if (rule.retired(record[key])) throw new Error(`${CONFIG_FILE} ${rule.message(record[key])}`)
  }
  const pick = (key: keyof ProjectConfig) => (record[key] === undefined ? CONFIG_DEFAULTS[key] : record[key])
  const mode = stringOf("mode", pick("mode"))
  const modes = loadModes(dir)
  if (!modes[mode]) {
    throw new Error(`${CONFIG_FILE} mode value "${mode}" is not registered (currently supported: ${Object.keys(modes).join(", ")})`)
  }
  const contextLimit = pick("contextLimit")
  if (typeof contextLimit !== "number" || !Number.isInteger(contextLimit) || contextLimit < 1) {
    throw new Error(`${CONFIG_FILE} contextLimit must be a positive integer (thousands of tokens)`)
  }
  const rawPhases = pick("phases")
  const phases = Array.isArray(rawPhases) && rawPhases.every((item) => typeof item === "string") ? rawPhases.join(",") : rawPhases
  if (typeof phases !== "string") {
    throw new Error(`${CONFIG_FILE} phases must be a letter preset (e.g. m, amt, admtvk) or a list of phase type ids (e.g. "analysis,security-review,implement")`)
  }
  const types = loadPhaseTypes(dir)
  const clashes = phaseTypeRoleProblems(types.filter((entry) => entry.origin === "project").map((entry) => entry.type))
  if (clashes.length) throw new Error(clashes.join("\n"))
  if (resolvePhases(phases, types) === null) throw new Error(`${CONFIG_FILE} phases is invalid: ${phasesProblem(phases, types)}`)
  // commit: false was refused above (RETIRED_KEYS); the opts.commit gate in the
  // code stays for now, its cleanup is a separate task.
  const commit = booleanOf("commit", pick("commit"))
  const testByDriver = booleanOf("testByDriver", pick("testByDriver"))
  const handoverTest = booleanOf("handoverTest", pick("handoverTest"))
  if (handoverTest && !testByDriver) {
    throw new Error(`${CONFIG_FILE} handoverTest requires testByDriver: true`)
  }
  return {
    mode,
    agent: agentOf(record.agent),
    contextLimit,
    subtask: subtaskOf(pick("subtask")),
    testByDriver,
    handoverTest,
    autoNumber: booleanOf("autoNumber", pick("autoNumber")),
    wrapup: booleanOf("wrapup", pick("wrapup")),
    // 看门狗键由 verifyIdle/verifyMax 更名而来(旧名沿用自已退役的 verify 脚本,
    // 现控制 test 脚本执行);旧键仅在新键缺失时回落读取,不迁移写回——下次 init
    // 自然固化新键。
    idleTime: intInRange("idleTime", record.idleTime ?? record.verifyIdle ?? CONFIG_DEFAULTS.idleTime, 1, 120, "minutes"),
    idleMax: intInRange("idleMax", record.idleMax ?? record.verifyMax ?? CONFIG_DEFAULTS.idleMax, 0, 1440, "minutes, 0 = unset"),
    commit,
    phases,
    acceptanceGate: acceptanceGateOf(record.acceptanceGate, types.map((entry) => entry.type)),
    build: record.build === undefined ? undefined : stringOf("build", record.build),
    parallel: parallelOf(record.parallel),
  }
}

// agent: opencode|claude; absent and "opencode" both mean opencode (undefined),
// so the default is never written. Any other string is a pre-M6.1 contract name.
export function agentOf(value: unknown): AgentChoice | undefined {
  if (value === undefined || value === "opencode") return undefined
  if (value === "claude") return value
  const rule = RETIRED_KEYS.agent!
  throw new Error(`${CONFIG_FILE} ${rule.retired(value) ? rule.message(value) : "agent must be opencode|claude"}`)
}

// parallel: none|low|medium|high; absent and "none" both mean none (undefined),
// so a config without the key and one saying "none" load the same.
export function parallelOf(value: unknown): ParallelLevel | undefined {
  if (value === undefined || value === "none") return undefined
  if (typeof value !== "string" || !(PARALLEL_LEVELS as readonly string[]).includes(value)) {
    throw new Error(`${CONFIG_FILE} parallel must be none|${PARALLEL_LEVELS.join("|")}`)
  }
  return value as ParallelLevel
}

// acceptanceGate: an array of distinct known phase type ids; absent or [] = none.
function acceptanceGateOf(value: unknown, known: readonly string[]): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${CONFIG_FILE} acceptanceGate must be an array of phase type ids`)
  }
  const unknown = value.filter((item) => !known.includes(item))
  if (unknown.length) throw new Error(`${CONFIG_FILE} acceptanceGate names unknown phase type(s) ${unknown.join(", ")} (known: ${known.join(", ")})`)
  if (new Set(value).size !== value.length) throw new Error(`${CONFIG_FILE} acceptanceGate lists a phase type twice`)
  return value.length ? value : undefined
}

function stringOf(key: string, value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error(`${CONFIG_FILE} ${key} must be a non-empty string`)
  return value
}

function booleanOf(key: string, value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error(`${CONFIG_FILE} ${key} must be true|false`)
  return value
}

function intInRange(key: string, value: unknown, min: number, max: number, unit: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${CONFIG_FILE} ${key} must be an integer in ${min}..${max} (${unit})`)
  }
  return value
}

function subtaskOf(value: unknown): SubtaskMode {
  if (value !== "off" && value !== "auto" && value !== "ondemand") {
    throw new Error(`${CONFIG_FILE} subtask must be off|auto|ondemand`)
  }
  return value
}

// 项目配置层(设计文档 docs/init-config-agents-design.md §A): 宪法级选项——
// 决定会话被如何告知、验收与提交语义如何运作的项目属性——在 init 固化到
// .opencode/auto/config.json,版本化、随仓库共享、人工可编辑;未知键忽略
// (前向兼容)。run 只控制本次执行,不再接受对应选项。旧版 .auto/config.json
// (仅 mode)只在新文件缺失时回落读取,新文件一经写出即不再读取(不删除,留在
// gitignore 内自然沉没)。
import { isAbsolute, join } from "node:path"
import { loadModes } from "./mode"
import { parsePhases } from "./phases"
import type { SubtaskMode } from "./runner"

export type ProjectConfig = {
  // 须为 loadModes(dir) 已注册名。
  mode: string
  // 缺省 "auto";存在性仍由 run 前完整性检查兜底。
  agent: string
  // 千 tokens(与 CLI 单位一致;run 侧 ×1000 注入 Opts)。
  contextLimit: number
  subtask: SubtaskMode
  verify: boolean
  // 分钟,1..120。
  verifyIdle: number
  // 分钟,0 = 不设,1..1440。
  verifyMax: number
  commit: boolean
  // admtvk 的子序列且含 m(设计文档 docs/phases-design.md §A);"m" = 无阶段声明,
  // 单次运行,行为与阶段化之前完全一致。
  phases: string
  // 迁移源参数(可选,非迁移场景缺省 undefined): dir = 源系统目录,path = 源模块
  // 相对路径(不含 ..)。init 时另校验存在性;run 不再校验(源系统可能已下线)。
  source?: { dir: string; path: string }
}

export const CONFIG_DEFAULTS: ProjectConfig = {
  mode: "migrate",
  agent: "auto",
  contextLimit: 64,
  subtask: "auto",
  verify: false,
  verifyIdle: 10,
  verifyMax: 0,
  commit: true,
  phases: "m",
}

const CONFIG_FILE = join(".opencode", "auto", "config.json")
const LEGACY_FILE = join(".auto", "config.json")

// 读取 + 校验: 文件缺失 → 缺省 + legacy 回落(.auto/config.json 的 mode);
// 坏 JSON / 键值越界 / mode 未注册(loadModes)→ throw(中文报错含键名与期望),
// CLI 侧转退出码 1。run 与 init 均经此入口。
export async function loadProjectConfig(dir: string): Promise<ProjectConfig> {
  const text = await Bun.file(join(dir, CONFIG_FILE)).text().catch(() => undefined)
  if (text === undefined) {
    const legacy = await readLegacyMode(dir)
    return validateProjectConfig(legacy === undefined ? { ...CONFIG_DEFAULTS } : { ...CONFIG_DEFAULTS, mode: legacy }, dir)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`${CONFIG_FILE} 不是合法 JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  return validateProjectConfig(parsed, dir)
}

// init 用: 仅显式给出的键覆盖既有值,其余保留(undefined 的键视同未给出);
// 返回待写回的完整配置。
export function mergeProjectConfig(existing: ProjectConfig, explicit: Partial<ProjectConfig>): ProjectConfig {
  const given = Object.fromEntries(Object.entries(explicit).filter(([, value]) => value !== undefined))
  return { ...existing, ...given }
}

// 普通整写(Bun.write 自动建父目录);只在 init(非 protect 期)调用,无需原子写。
export async function saveProjectConfig(dir: string, config: ProjectConfig): Promise<void> {
  await Bun.write(join(dir, CONFIG_FILE), JSON.stringify(config, null, 2) + "\n")
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
  const watchdog = `idle ${config.verifyIdle}m/max ${config.verifyMax > 0 ? `${config.verifyMax}m` : "不设"}`
  return (
    `模式 ${config.mode} · agent ${config.agent} · 子任务 ${config.subtask} · 验收 ${config.verify ? "on" : "off"}` +
    ` · 看门狗 ${watchdog} · 提交 ${config.commit ? "on" : "off"} · 上下文上限 ${config.contextLimit}k · 阶段 ${config.phases}`
  )
}

// 值域与 CLI 侧 parse* 一致;未知键忽略(前向兼容),缺失键回落缺省值。
function validateProjectConfig(raw: unknown, dir: string): ProjectConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${CONFIG_FILE} 须为 JSON 对象`)
  const record = raw as Record<string, unknown>
  const pick = (key: keyof ProjectConfig) => (record[key] === undefined ? CONFIG_DEFAULTS[key] : record[key])
  const mode = stringOf("mode", pick("mode"))
  const modes = loadModes(dir)
  if (!modes[mode]) {
    throw new Error(`${CONFIG_FILE} 的 mode 取值 "${mode}" 未注册(当前支持: ${Object.keys(modes).join(", ")})`)
  }
  const contextLimit = pick("contextLimit")
  if (typeof contextLimit !== "number" || !Number.isInteger(contextLimit) || contextLimit < 1) {
    throw new Error(`${CONFIG_FILE} 的 contextLimit 须为正整数(千 tokens)`)
  }
  const phases = pick("phases")
  if (typeof phases !== "string" || parsePhases(phases) === null) {
    throw new Error(`${CONFIG_FILE} 的 phases 须为 admtvk 的子序列且包含 m(如 m、amt、admtvk)`)
  }
  return {
    mode,
    agent: stringOf("agent", pick("agent")),
    contextLimit,
    subtask: subtaskOf(pick("subtask")),
    verify: booleanOf("verify", pick("verify")),
    verifyIdle: intInRange("verifyIdle", pick("verifyIdle"), 1, 120, "分钟"),
    verifyMax: intInRange("verifyMax", pick("verifyMax"), 0, 1440, "分钟,0 为不设"),
    commit: booleanOf("commit", pick("commit")),
    phases,
    source: sourceOf(record.source),
  }
}

// source 缺省 undefined(非迁移场景);存在时 dir 须为非空字符串、path 须为非空
// 相对路径(不含 ..,防目录逃逸)。存在性校验只在 init 做(run 侧源系统可能已下线)。
function sourceOf(value: unknown): { dir: string; path: string } | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${CONFIG_FILE} 的 source 须为 { "dir": ..., "path": ... } 对象`)
  }
  const record = value as Record<string, unknown>
  const path = record.path
  if (typeof path !== "string" || !path) throw new Error(`${CONFIG_FILE} 的 source.path 须为非空字符串`)
  if (isAbsolute(path) || path.split(/[\\/]+/).includes("..")) {
    throw new Error(`${CONFIG_FILE} 的 source.path 须为不含 .. 的相对路径(相对 source.dir)`)
  }
  return { dir: stringOf("source.dir", record.dir), path }
}

function stringOf(key: string, value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error(`${CONFIG_FILE} 的 ${key} 须为非空字符串`)
  return value
}

function booleanOf(key: string, value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error(`${CONFIG_FILE} 的 ${key} 须为 true|false`)
  return value
}

function intInRange(key: string, value: unknown, min: number, max: number, unit: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${CONFIG_FILE} 的 ${key} 须为 ${min}..${max} 的整数(${unit})`)
  }
  return value
}

function subtaskOf(value: unknown): SubtaskMode {
  if (value !== "off" && value !== "auto" && value !== "ondemand") {
    throw new Error(`${CONFIG_FILE} 的 subtask 须为 off|auto|ondemand`)
  }
  return value
}

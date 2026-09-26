// 外壳画像: 核心报文与日志审计语义的外壳级参数(壳层入口启动时经 setShellProfile
// 设置一次,见 plans/AUTO_CORE_INTEGRATION_PLAN 阶段二)。核心代码只读本画像、不感知
// 具体外壳——通用壳(auto)与简易壳(migrate)的行为差异(报文程序名、agent 契约
// 恢复指引、日志审计语义)全部经此参数化,消除外壳对 runner/loop 文本的补丁。
import type { AgentCapabilities, AgentHostFactory } from "./agent/types"
import { setAuditLog } from "./log"

export type ShellProfile = {
  // 运行态程序名: 报文"重新运行 X"句式用(通用壳 "opencode-auto run")。
  program: string
  // 管理子命令前缀: 报文"运行 X init <dir>"句式用("opencode-auto")。
  bin: string
  // agent 契约缺失的恢复指引: "init" = 提示运行 init 子命令重建(通用壳);
  // "startup" = 外壳每次启动按模板重建默认契约,提示重新运行外壳即可(简易壳)。
  agentRecovery: "init" | "startup"
  // true = 日志文件始终完整记录(vlog 免 verbose 门控、逐行带时间戳),使 run 日志
  // 成为不依赖选项的完整审计记录(简易壳语义);false = 明细仅 --verbose 记录。
  auditLog: boolean
  // Agent profile (MA.4, plans/0040): the coding agent this shell drives.
  // Absent = the built-in opencode adapter (loop.ts falls back to it), so a
  // shell that never sets it behaves exactly as before. What the agent can do
  // is not declared here: it comes from the host's client capabilities and the
  // driver degrades per flag at run start (src/capability.ts).
  agent?: AgentProfile
  // The directory under $XDG_CONFIG_HOME (default ~/.config) that holds the
  // operator layer of the model registry, `<configDir>/models.json`
  // (src/models.ts). OPENCODE_AUTO_MODELS overrides the whole path.
  configDir: string
}

export type AgentProfile = {
  // Display name for the startup line (e.g. "opencode", "claude").
  name: string
  // Starts or connects the agent for a run.
  host: AgentHostFactory
}

// 缺省 = 通用壳(auto)现状;未设置画像时核心报文与历史行为逐字节一致。
const DEFAULTS: ShellProfile = {
  program: "opencode-auto run",
  bin: "opencode-auto",
  agentRecovery: "init",
  auditLog: false,
  configDir: "opencode-auto",
}

let profile: ShellProfile = DEFAULTS

// 壳层入口启动时调用(部分覆盖,在前值上合并;重复调用幂等);auditLog 联动 log 层。
export function setShellProfile(part: Partial<ShellProfile>): void {
  profile = { ...profile, ...part }
  setAuditLog(profile.auditLog)
}

export function shellProfile(): ShellProfile {
  return profile
}

// An agent adapter a shell registers (plans/0055 §8.8): the host factory that
// starts or connects the agent, plus the adapter's static capabilities — the
// record the pool degrades on before any host starts (§8.5: lazy start means
// capabilities must be known without spawning; the builtin adapters expose
// theirs through their entry modules, src/agent-pool.ts). Registering an
// adapter never changes a run by itself: a registry profile must name the
// adapter before anything dispatches on it.
// AUTO-DECISION: the registration carries the capabilities beside the factory instead of the pool reading them off a started client (§8.5 names "a static per-adapter capability record exposed with the factory" as the shape; a shell adapter knows what it can do before it runs, and the builtin opencode/claude records already exist as constants)
export type AgentAdapter = {
  host: AgentHostFactory
  capabilities: AgentCapabilities
  // The adapter's default executable for preflight's `<bin> --version` check
  // (§8.7); absent = the check skips the adapter's profiles unless a profile
  // declares its own `bin`.
  bin?: string
}

const adapters = new Map<string, AgentAdapter>()

// Registers an agent adapter under `name` (idempotent; the last registration
// wins, like setShellProfile). After it, the model registry's `adapter` field
// accepts `name` (src/models.ts reads registeredAdapterNames), and a profile
// naming it starts through the factory.
export function registerAgentAdapter(name: string, adapter: AgentAdapter): void {
  adapters.set(name, adapter)
}

// The adapter a shell registered under `name`; undefined for the builtins
// ("opencode", "claude"), whose factories the pool itself holds.
export function shellAdapter(name: string): AgentAdapter | undefined {
  return adapters.get(name)
}

// Every adapter name a shell registered (no builtins). The registry loader
// accepts these beside its builtin list.
export function registeredAdapterNames(): string[] {
  return [...adapters.keys()]
}

// Tests reset the registry (one Bun process runs many test files).
export function resetShellAdapters(): void {
  adapters.clear()
}

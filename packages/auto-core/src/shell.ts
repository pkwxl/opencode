// 外壳画像: 核心报文与日志审计语义的外壳级参数(壳层入口启动时经 setShellProfile
// 设置一次,见 AUTO_CORE_INTEGRATION_PLAN 阶段二)。核心代码只读本画像、不感知
// 具体外壳——通用壳(auto)与简易壳(migrate)的行为差异(报文程序名、agent 契约
// 恢复指引、日志审计语义)全部经此参数化,消除外壳对 runner/loop 文本的补丁。
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
}

// 缺省 = 通用壳(auto)现状;未设置画像时核心报文与历史行为逐字节一致。
const DEFAULTS: ShellProfile = {
  program: "opencode-auto run",
  bin: "opencode-auto",
  agentRecovery: "init",
  auditLog: false,
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

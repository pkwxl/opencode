import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"

// 进度恢复记录: run 期间 driver 把任务流水线的当前阶段与执行链会话持久化到目标
// 目录 .auto/progress.json。应用崩溃/被强制终止后重新运行时据此精确恢复:
// - active 且会话在 server 上仍存在 → 复用该会话继续(与 `opencode -r <session-id>`
//   同构: 会话历史持久化在 server 项目存储,向原 session 下发新 prompt 即带全部
//   上下文继续,会话内未落盘的进度不丢),首个提示词附"中断后的继续"说明(含按阶段
//   的下一步指引);中断前已写出交接文档(ondemand handoff / handover-test)时不复用
//   ——旧会话上下文已用满、进度由交接文档承载,开新会话凭交接续跑;
//   --new-session 显式放弃旧会话(仅跳过复用,阶段精确重入保留)。
// - 优雅退出(阻塞/回退 pending)由 driver 在退出前写好总结(CURRENT.md 中断备注
//   + active=false 的记录),恢复时开新会话凭总结继续,不复用旧会话——人工介入
//   可能耗时数小时且会改动环境,旧会话上下文已不可信;
// - 记录同时携带阶段(phase): 恢复时按阶段重入流水线(verify 已执行的脚本运行
//   记录直接交判定会话,不重跑;修复轮中断凭持久化的差距文本续跑修复;off/ondemand
//   已过执行阶段不再重跑整任务会话等)。
// 任务完成即删除记录;旁路一次性会话(判定/审核/脚本生成/修复规划)不写记录,
// 只有执行链会话写,避免污染链记忆。

// verify 阶段持久化的脚本运行记录(结构兼容 prompt.VerifyRun):脚本已由 driver
// 执行完毕时随阶段保存,恢复时跳过执行直接进入判定会话(脚本可能很长)。
type RunRecord = {
  script: string
  code: number
  ms: number
  timedOut: boolean
  timeoutReason?: "idle" | "max"
  out: string
}

// early 并行审核的结论(结构兼容 runner 的 Verdict)。
export type AuditVerdict = { type: "pass"; command?: string } | { type: "gap"; gap: string } | { type: "reverify"; gap: string }

// 任务流水线的阶段标记:
// - understand: fork 流水线理解会话阶段(写 docs/<id>.context.md 摘要;fork=off
//   不经过该阶段)
// - decompose: auto 模式分解会话阶段(检查项尚未注入)
// - whole: off/ondemand 模式整任务单会话执行阶段
// - subtasks: 逐子任务会话阶段(从首个未勾选项继续)
// - wrapup: 收尾会话阶段
// - verify: 任务级验收;stage = generate(脚本生成)/ exec(脚本执行)/ judge(判定)/
//   fix(修复轮进行中,gap 为判定差距原文,中断恢复时凭它重新下发修复提示);
//   round/rechecks/replaced 为修复轮与重验轮计数,run 为已执行的脚本运行记录,
//   audit 为 early 并行审核已得出的结论
// - review: 质量审核外层循环;round 为当前轮,stage = audit(审核会话)/
//   planfix(修复规划,docs/<id>.fix.md 可能已产出)/ fixrun(修复检查项执行中)
export type Phase =
  | { kind: "understand" }
  | { kind: "decompose" }
  | { kind: "whole" }
  | { kind: "subtasks" }
  | { kind: "wrapup" }
  | {
      kind: "verify"
      stage: "generate" | "exec" | "judge" | "fix"
      round: number
      rechecks: number
      replaced: boolean
      run?: RunRecord
      audit?: AuditVerdict
      // stage = fix 时持久化的判定差距原文: 修复会话中断后恢复,凭它重新下发
      // renderFix 续跑修复(执行链会话被复用时上下文不丢,差距文本仍随记录恢复)。
      gap?: string
    }
  | { kind: "review"; round: number; stage: "audit" | "planfix" | "fixrun" }

export type Progress = {
  task: string
  // 执行链会话 ID;优雅退出后保留作诊断,但 active=false 使其不再被复用。
  session?: string
  at: number
  // true = 会话半途未总结(kill/崩溃/网络故障),恢复时会话存活即复用。
  active: boolean
  phase?: Phase
}

const FILE = join(".auto", "progress.json")
// 旧版会话记忆文件: 无阶段信息,按"半途会话"兼容读取(恢复走默认流程)。
const LEGACY = join(".auto", "session.json")

export async function saveProgress(dir: string, progress: Progress) {
  await mkdir(join(dir, ".auto"), { recursive: true })
  await Bun.write(join(dir, FILE), JSON.stringify(progress))
}

// 任务完成(任何 Outcome 下的 completed)即删除;force 使缺失时也无害。
// 连同旧版 session.json 一起清理。
export async function forgetProgress(dir: string) {
  await rm(join(dir, FILE), { force: true })
  await rm(join(dir, LEGACY), { force: true })
}

// 读取属于该任务的进度记录(不校验会话存活——存活判定在 runner)。任务不符、
// 文件缺失或损坏返回 undefined。
export async function recallProgress(dir: string, task: string): Promise<Progress | undefined> {
  const record = await readProgress(dir)
  if (!record || record.task !== task) return undefined
  return record
}

// 读取当前进度记录(不分任务): loop 启动时用于把验收/审核阶段中断、已被标 done
// 的任务置回 in_progress,否则 next() 会跳过它、收尾永不补跑。
export async function peekProgress(dir: string): Promise<Progress | undefined> {
  return readProgress(dir)
}

async function readProgress(dir: string): Promise<Progress | undefined> {
  const raw = await Bun.file(join(dir, FILE)).text().catch(() => undefined)
  if (raw) return parseProgress(raw)
  const legacy = await Bun.file(join(dir, LEGACY)).text().catch(() => undefined)
  if (!legacy) return undefined
  const parsed = parseProgress(legacy)
  // 旧版 {task, session, at}: 视为半途会话,无阶段信息(恢复走默认流程)。
  return parsed ? { ...parsed, active: true } : undefined
}

function parseProgress(raw: string): Progress | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<Progress>
    if (typeof parsed.task !== "string") return undefined
    return {
      task: parsed.task,
      session: typeof parsed.session === "string" ? parsed.session : undefined,
      at: typeof parsed.at === "number" ? parsed.at : 0,
      active: parsed.active === true,
      phase: typeof parsed.phase?.kind === "string" ? parsed.phase : undefined,
    }
  } catch {
    return undefined
  }
}

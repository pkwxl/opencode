import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import type { UnitBaseline } from "./git"

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
// 记录在提示词下发成功时即写(认领在跑的会话——回合进行中被 kill 也不丢),回合
// 结束后按结果刷新;可重试的会话错误把记录还原为下发前快照(被弃副本不顶替真实
// 恢复点,见 plans/0015-session-error-retry-plan.md 第 4 点与 plans/0018-session-resume-precedence-design.md)。
// 任务完成即删除记录。除执行链会话外,阶段级旁路步骤(phase-plan/phase-handover,
// phase.kind = "step")也写记录: driver 收口(产物校验+提交+后处理)前保持 active,
// 使中断后会话恢复优先于"凭 AI 写的文件推导路由"(后者会把未收口的规划/交接会话
// 静默跳过)。无阶段的一次性旁路会话(判定/审核/脚本生成/修复规划/dryrun/fork 基点)
// 仍不写记录,避免污染恢复记忆。

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

// 阶段字母(与 phases.ts 的 Phase 同值域;此处内联避免 resume→phases 反向依赖,
// 阶段步骤恢复点用它标注归属阶段)。
export type PhaseLetter = "a" | "d" | "m" | "t" | "v" | "k"

// 阶段级旁路步骤(driver 侧收口的流程步骤,非任务流水线阶段): phase-plan = 阶段
// 规划会话(填充 PLAN.md),phase-handover = 阶段交接蒸馏会话(产出交接文档)。
// 这两类会话此前不写恢复点,中断后流程仅凭 AI 写的文件(PLAN.md/交接文档)推导
// 路由,把未收口的会话静默跳过——见 plans/0018-session-resume-precedence-design.md。
export type StepKind = "phase-plan" | "phase-handover"

// 任务流水线的阶段标记:
// - decompose: auto 模式合并理解与分解会话阶段(M1.0 起 understand+decompose 合一,
//   见 plans/0030-subtask-loop-entry-design.md;产物 = context.md + shared.md +
//   subtasks.md + 各子任务 todo.md,检查项尚未注入)。旧版 "understand" 记录在
//   parseProgress 读取时映射为本阶段(兼容读)。
// - whole: off/ondemand 模式整任务单会话执行阶段
// - subtasks: 逐子任务会话阶段(从首个未勾选项继续);index = 归属子任务的 1 起
//   序号,仅子任务会话的 active 记录携带(间歇/总结态记录不带)
// - wrapup: 收尾会话阶段
// - verify: 任务级验收;stage = generate(脚本生成)/ exec(脚本执行)/ judge(判定)/
//   fix(修复轮进行中,gap 为判定差距原文,中断恢复时凭它重新下发修复提示);
//   round/rechecks/replaced 为修复轮与重验轮计数,run 为已执行的脚本运行记录,
//   audit 为 early 并行审核已得出的结论
// - review: 质量审核外层循环;round 为当前轮,stage = audit(审核会话)/
//   planfix(修复规划,docs/<id>.fix.md 可能已产出)/ fixrun(修复检查项执行中);
//   fixrun 检查项会话的 active 记录携带 index(归属检查项的 1 起序号)
// - step: 阶段级旁路步骤(phase-plan/phase-handover),letter 标注归属阶段;
//   driver 收口前记录保持 active,中断后据此让会话恢复优先于文件推导路由
//
// 单元归属门禁(runner.unitReruns): active 记录的会话属于某个具体执行单元
// (任务级阶段/子任务#N/修复检查项#N),恢复时仅当本次运行将重跑该单元才允许
// 复用其会话;单元已过、配置/开关变更使其不再执行、或记录缺失序号无法判定
// 归属(老版本记录)时,记录转总结态、开新会话——恢复只发生在原单元重跑时,
// 不让下一单元误续上一单元的中断会话。
export type Phase =
  | { kind: "decompose" }
  | { kind: "whole" }
  | { kind: "subtasks"; index?: number }
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
  | { kind: "review"; round: number; stage: "audit" | "planfix" | "fixrun"; index?: number }
  | { kind: "step"; step: StepKind; letter: PhaseLetter }

export type Progress = {
  task: string
  // 执行链会话 ID;优雅退出后保留作诊断,但 active=false 使其不再被复用。测试交接
  // 收场写「无会话在途态」(active=true 而 session 缺失): 交出交接文档的会话任务
  // 已完成、不得作重启复用对象,恢复经 .auto/handover.json 接回交接之后的会话
  // (attempt 的 testHandover 分支)。
  session?: string
  at: number
  // true = 会话半途未总结(kill/崩溃/网络故障),恢复时会话存活即复用。
  active: boolean
  phase?: Phase
  // 单元基线(逐仓库 HEAD 短 SHA,plans/0022-session-recovery-fidelity-design.md 3.1 ③):
  // 严格恢复(OPENCODE_AUTO_STRICT_RESUME)on 时由 attempt 随 active 记录写入,
  // 恢复时核对 各仓库 HEAD == 基线 或 基线..HEAD 全部带 Auto-Stage trailer;
  // 旧记录/开关关闭时缺失 → 严格恢复下视为不可复用(走回滚或新会话)。
  baseline?: UnitBaseline
  // 生效模型(provider/model 串,3.1 ④): 下发该提示词时求值出的实际 model;恢复时
  // 与当前配置解析结果不一致 → 不复用(会话在异模型上续跑 = 行为漂移)。未配置模型
  // 路由时无串可记,严格恢复下同样视为不可复用。
  model?: string
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

// 当前未收口的阶段步骤恢复点: 记录为 active 的 step 变体时返回其步骤身份与会话
// (供 loop 让会话恢复优先于文件推导路由,见 plans/0018-session-resume-precedence-design.md);
// 非 step 记录、已收口(active=false)或无记录返回 undefined。
export async function openStep(dir: string): Promise<{ step: StepKind; letter: PhaseLetter; session?: string } | undefined> {
  const record = await peekProgress(dir)
  if (record?.active && record.phase?.kind === "step") {
    return { step: record.phase.step, letter: record.phase.letter, session: record.session }
  }
  return undefined
}

// 阶段步骤收口: 仅当当前记录正是该步骤时删除之(driver 已完成产物校验/提交/
// 后处理,恢复点不再需要)。记录不匹配(已被任务记录覆盖等)时不动,避免误清。
export async function closeStep(dir: string, step: StepKind, letter: PhaseLetter): Promise<void> {
  const record = await peekProgress(dir)
  if (record?.phase?.kind === "step" && record.phase.step === step && record.phase.letter === letter) {
    await forgetProgress(dir)
  }
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
    // Legacy "understand" records (pre-M1.0 split understand/decompose sessions)
    // re-enter the merged understand+decompose unit (plans/0030 D2).
    const rawKind: unknown = parsed.phase?.kind
    const phase =
      typeof rawKind !== "string"
        ? undefined
        : rawKind === "understand"
          ? ({ kind: "decompose" } satisfies Phase)
          : parsed.phase
    return {
      task: parsed.task,
      session: typeof parsed.session === "string" ? parsed.session : undefined,
      at: typeof parsed.at === "number" ? parsed.at : 0,
      active: parsed.active === true,
      phase,
      baseline: Array.isArray(parsed.baseline)
        ? parsed.baseline.filter(
            (line): line is { root: string; sha: string } => typeof line?.root === "string" && typeof line?.sha === "string",
          )
        : undefined,
      model: typeof parsed.model === "string" ? parsed.model : undefined,
    }
  } catch {
    return undefined
  }
}

// 任务执行阶段: executeWhole(off/ondemand 整任务会话)+ 合并理解与分解
// (ensureDecomposed,M1.0 起 understand+decompose 单会话合一,plans/0030)+
// runSubtask 单个子任务会话(含子任务目录状态协议 todo.md→done.md),及
// PLAN.md 重读小工具 requireTask。位于 exec-session/session 之上、runner 之下;
// **不得反向 import runner**(§D.2)。
// 拆分自 src/runner.ts(plans/0024-module-split-plan.md S12,纯搬运)。

import { rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { AgentClient } from "./agent/types"
import type { ForkBaseInfo, SessionChain } from "./chain"
import { writeCurrent } from "./current"
import { docShapeProblems, EOF_MARK, shapeCheckOn } from "./doccheck"
import { legacySubtaskTestHandoff, legacyTaskDoc, resolveTaskDoc, taskDoc } from "./docpaths"
import { processReferenceScan } from "./document/process-refs"
import { eofScanExempt, handoffStatus } from "./document/roles"
import { checkArtifactSpecs, declaredArtifacts, decomposeArtifactSpecs, subtaskStateSpec } from "./document/spec"
import { renameTodoToDone } from "./document/state"
import { runExecSession } from "./exec-session"
import { beginUnit, unitAddedLines, unitBaseline, unitChangedFiles, unitQuiet, untrackedFiles, type UnitBaseline } from "./git"
import { autobanner, log, subbanner } from "./log"
import { DEFAULT_CONTEXT_LIMIT, type Opts, type UnitStop } from "./opts"
import { load, setForkBase, setSubtasks, subtasks, tick, type Plan, type Task } from "./plan"
import { handoffFile, renderDecompose, renderSubtask, renderWhole, testHandoffFile } from "./prompt"
import { peekProgress } from "./resume"
import { runSession } from "./session"
import { formatTokens, forkEndedSession, seedForkSession } from "./session-api"
import { autoSwitches } from "./switches"
import { handoffSteer, removeHandoffChain } from "./testrun"
import { sessionHandoverDue } from "./usage"
import { afterSession, commitBlocked, rollbackUnitState, strictResumeActive } from "./unit-commit"

// off/ondemand 的执行阶段: off 单会话完成整个任务;ondemand 会话进行中上下文
// 达到 2x --context-limit 时由 driver steer 交接提示,会话写出交接文档后换新会话
// 续跑,直到自然完成或交接文档标记完成。返回 undefined 表示执行阶段完成。
// 上次尝试遗留交接文档的清理由调用方(pipeline)在做恢复判定后进行。
export async function executeWhole(
  client: AgentClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
  ondemand: boolean,
): Promise<UnitStop | undefined> {
  const cap = opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT
  const dir = opts.dir ?? dirname(plan.path)
  const strict = strictResumeActive(opts)
  // 交接文档读回落(stable-refs P1): 会话写目标恒为新路径 docs/<id>/handoff.md
  // (提示词经 handoffFile 注入),读点优先新路径、旧平铺存在则回落——存量项目
  // 中断恢复续跑不受改名影响。
  const planDir = dirname(plan.path)
  const readHandoff = async (): Promise<string> =>
    Bun.file(join(planDir, await resolveTaskDoc(planDir, task.id, "handoff"))).text().catch(() => "")
  // steer=off(OPENCODE_AUTO_STEER)时不构造交接提示,会话后的交接判定一并停用
  // (见 usage.ts sessionHandoverDue);off 模式本就不构造。
  const steer = ondemand ? handoffSteer(autoSwitches().steer, cap, task) : undefined
  const subject = `${task.id} exec ${task.title}`
  chain.subject = subject
  // 中断恢复播种: 陈旧交接文档由 pipeline 在非恢复路径清除,此处文件仍存在即
  // active 恢复——中断前已交接。状态=完成 → 执行阶段已完成,跳过整任务会话;
  // 状态=继续 → 以续跑提示开新会话凭交接继续(复用旧会话只会立刻再触上限)。
  const prior = ondemand ? handoffStatus(await readHandoff()) : undefined
  if (prior === "完成") {
    log(`↻ ${task.id} resume after interruption: handover document ${handoffFile(task)} marks execution complete; skipping the whole-task session`)
    return undefined
  }
  let continuation = prior === "继续"
  if (continuation) log(`↻ ${task.id} resume after interruption: handed over as ${handoffFile(task)} before the interruption; the new session continues from the handover document`)
  let feedback = ""
  let retried = false
  // 严格恢复的回滚重做(3.3 R3 收紧): 交接文档无效(含测试交接写核失败)一次即回滚
  // 到单元基线、冷启动重做本单元,不再带反馈重试;以一次为限,再失败按隐性阻塞
  // 上抛(现场已保全在 stash)。
  let rolled = false
  const rollbackRedo = async (): Promise<UnitStop | "done" | undefined> => {
    if (!strict || !chain.baseline) return undefined
    const done = await rollbackUnitState(dir, task, "execution session", chain.baseline, {
      planPath: plan.path,
      progress: await peekProgress(dir),
      solo: (opts.subtask ?? "auto") !== "auto",
    })
    if (done.type !== "ok") return done
    continuation = false
    feedback = ""
    retried = false
    chain.id = undefined
    chain.pending = undefined
    chain.note = undefined
    chain.pct = 100
    chain.used = 0
    chain.at = 0
    return "done"
  }
  for (;;) {
    const result = await runExecSession(
      client,
      plan,
      task,
      renderWhole(plan, task, { mode: opts.mode, ondemand, continuation }) + feedback,
      opts,
      chain,
      steer,
    )
    if (result.type === "blocked") {
      // 测试交接写核失败(严格恢复): 回滚后冷启动重做,一次为限。
      if (result.rollback && !rolled) {
        const redone = await rollbackRedo()
        if (redone === "done") {
          rolled = true
          continue
        }
        if (redone) return redone
      }
      return result
    }
    // 任务级测试交接链随执行范围闭环整链清除(与 runSubtask 子任务收口同口径):
    // 归档份已落账也必须删——留给同范围的下一次执行(任务回退重跑)会被恢复
    // 状态机误判为「已收口」的在途交接(无记录 + 归档已落账 = H3)。删除随下方
    // 统一提交落账。
    if (opts.testByDriver) {
      await removeHandoffChain(planDir, taskDoc(task.id, "testhandoff"))
      await removeHandoffChain(planDir, legacyTaskDoc(task.id, "testhandoff"))
    }
    const committed = await afterSession(dir, opts, task, { stage: "execute", subject })
    if (committed.type === "failed") return commitBlocked(`${task.id} execution session`, committed)
    // 未触发交接阈值(2x cap)即结束 = 任务在单会话内自然完成;steer 未构造
    // (off 模式或 OPENCODE_AUTO_STEER=off)时同样自然收,不做交接判定。
    if (!sessionHandoverDue(client.capabilities.usage, steer, chain.used, chain.hinted)) return undefined
    const status = handoffStatus(await readHandoff())
    if (status === "完成") return undefined
    if (status === "继续") {
      log(`↻ ${task.id} context reached the ${formatTokens(cap * 2)} cap; handed over as ${handoffFile(task)}, continuing in a new session`)
      continuation = true
      feedback = ""
      continue
    }
    // 交接边界写核失败(严格恢复): 无效一次即回滚冷启动重做。
    if (!rolled) {
      const redone = await rollbackRedo()
      if (redone === "done") {
        rolled = true
        log(`↻ ${task.id} context cap reached but no valid handover document ${handoffFile(task)} was produced; strict resume already rolled back; cold-starting this task`)
        continue
      }
      if (redone) return redone
    }
    if (retried) {
      return {
        type: "blocked",
        question:
          `session hit the context cap but failed twice to produce a valid handover document ${handoffFile(task)} (missing, or lacking a status line; hidden blockage). ` +
          `Check the file and re-run. Last agent output:\n${result.lastText.trim().slice(-2000) || "(no output)"}`,
      }
    }
    log(`↻ ${task.id} context cap reached but ${handoffFile(task)} was not produced; retrying once with feedback`)
    retried = true
    feedback =
      `\n\n你上次结束会话时上下文已达上限,但未写出有效的 ${handoffFile(task)}(缺失或缺少 \`状态: 继续|完成\` 行)。` +
      `这是硬性要求: 写出该文件后再结束会话。`
  }
}

export function requireTask(plan: Plan, id: string): Task {
  const task = plan.tasks.find((task) => task.id === id)
  if (!task) throw new Error(`${plan.path}: task ${id} not found`)
  return task
}

// Merged understand+decompose unit (M1.0, plans/0030-subtask-loop-entry-design.md):
// one session produces the task background digest (docs/<id>/context.md, four
// sections), the shared-context reference index (docs/<id>/shared.md), the
// subtask checklist (docs/<id>/subtasks.md, parsed by the driver and injected
// into PLAN.md) and one scope file per subtask (docs/<id>/S<nn>/todo.md).
// All four artifact groups are hard requirements (existence + non-trivial +
// terminal eof line), feeding one retry-with-feedback loop (re-prompt via
// forkEndedSession of the just-ended session); still failing → blocked.
// On success the session id is recorded as the session-mode fork base (digest
// mode overwrites it in ensureForkBase afterwards) and everything lands in the
// "decompose" unit commit.
// 中断恢复/兼容读: 任务体已有检查项(含人工编写)直接跳过;subtasks.md 已有检查项
// (上次分解已写文件但尚未注入,或旧版分解产物)直接注入、不再开会话——旧版产物
// 没有 todo.md 状态文件,该任务保持台账勾选语义(协议未激活,plans/0030 D5)。
export async function ensureDecomposed(
  client: AgentClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
): Promise<({ type: "ok" } & { task: Task }) | UnitStop> {
  if (subtasks(task.body).length) return { type: "ok", task }
  // 分解结果路径(目录化布局): 写目标恒为新路径;subtasks.md 读点经 resolveTaskDoc
  // 回落旧平铺 docs/<id>.subtasks.md(存量项目中断恢复不受改名影响)。context.md 同。
  const dir = dirname(plan.path)
  const contextFile = join(dir, taskDoc(task.id, "context"))
  const sharedFile = join(dir, taskDoc(task.id, "shared"))
  const subtasksFile = join(dir, taskDoc(task.id, "subtasks"))
  const readDoc = async (role: "context" | "subtasks"): Promise<string> =>
    (await Bun.file(join(dir, await resolveTaskDoc(dir, task.id, role))).text().catch(() => "")).trim()
  const readRaw = async (): Promise<string> => readDoc("subtasks")
  const readItems = async (): Promise<string[]> => subtasks(await readRaw()).map((item) => item.text)
  const existing = await readItems()
  if (existing.length) {
    log(`↻ ${task.id} decomposition result ${subtasksFile} already exists; injecting checklist items directly`)
    await setSubtasks(plan.path, task.id, existing)
    return { type: "ok", task: requireTask(await load(plan.path), task.id) }
  }
  let feedback = ""
  // One automatic retry with feedback: a resumed session may have done the
  // work instead of writing the files; the files are a hard requirement.
  autobanner(`${task.id} ${task.title}: task understanding + decomposition`)
  const subject = `${task.id} decompose ${task.title}`
  chain.subject = subject
  // 形检/缺失重提示经 fork 刚结束的会话下发时(2026-09-18 修订),下一回合只带
  // 反馈本身——副本已含完整提示词与全部工作上下文,重发整份只会诱导从头重做。
  let shapeForked = false
  for (let i = 0; ; i++) {
    // fine(OPENCODE_AUTO_DECOMPOSE_FINE=on)透传分解提示词: 注入细粒度准则段
    // (plans/0003-fork-decompose-design.md §5.1);taskContext(OPENCODE_AUTO_TASK_CONTEXT)
    // 透传 context.md 的建议行数措辞。
    const brief = shapeForked
    shapeForked = false
    const result = await runSession(
      client,
      task,
      brief
        ? feedback.trimStart()
        : renderDecompose(plan, task, { ...opts, fine: autoSwitches().fine, taskContext: autoSwitches().taskContext }) + feedback,
      opts,
      chain,
    )
    if (result.type === "blocked") return result
    // 产物校验(全部硬性): context.md/shared.md 非空 + 形检;subtasks.md 有检查项 +
    // 形检;每个子任务目录的 todo.md 存在 + 形检。只查本次会话产出——上方「文件已存在
    // 即直接注入」路径不受影响(不追溯存量)。
    const problems = await decomposeArtifactProblems(dir, task.id)
    if (!problems.length) {
      const items = await readItems()
      await setSubtasks(plan.path, task.id, items)
      // 合并会话即 session 模式基点;digest 模式由 ensureForkBase 随后覆写。
      if (chain.id) await setForkBase(plan.path, task.id, chain.id)
      // 镜像刷新同样先于统一提交(与子任务勾选同口径): 注入的检查项与镜像同入
      // decompose 提交,调用方随后的刷新即幂等空写。
      await writeCurrent(plan.path, requireTask(await load(plan.path), task.id))
      const committed = await afterSession(opts.dir ?? dirname(plan.path), opts, task, { stage: "decompose", subject })
      if (committed.type === "failed") return commitBlocked(`${task.id} decompose session`, committed)
      return { type: "ok", task: requireTask(await load(plan.path), task.id) }
    }
    if (i === 1) {
      return {
        type: "blocked",
        question:
          `decompose session ended twice but its artifacts did not pass checks (${problems.join("; ")}; hidden blockage). ` +
          `Check the files and re-run. Last agent output:\n${result.lastText.trim().slice(-2000) || "(no output)"}`,
      }
    }
    feedback =
      `\n\nThe last time you ended the session, the merged understanding+decomposition artifacts did not pass checks: ${problems.join("; ")}. This is a hard requirement: ` +
      `complete ${contextFile} (the four-section understanding digest), ${sharedFile} (the shared-context reference index), ${subtasksFile} (the checklist) and every subtask's todo.md, ` +
      `and end the session only once the content is complete and closed with \`${EOF_MARK}\` alone on the last line of body text.`
    // The re-prompt continues from a fork of the session that just ended (carrying
    // all its research context); when fork is unavailable it falls back to a
    // brand-new session plus the full prompt.
    shapeForked = await forkEndedSession(client, chain, subject)
    log(`↻ ${task.id} decompose session artifacts failed checks (${problems.join("; ")}); ${shapeForked ? "forked from the original session, " : ""}retrying once with feedback`)
  }
}

// Artifact problem list of the merged understand+decompose session (empty =
// pass; spec-driven since M1.4): the four artifact groups (context.md /
// shared.md / subtasks.md / per-subtask todo.md) are declared as a spec table
// (document/spec.ts decomposeArtifactSpecs) and the mechanical checks
// (non-empty + shape + the todo.md protocol section anchors) all run through
// the generic checker — no per-document logic here. Checklist parseability
// stays a driver-side check (it is the driver's own injection input,
// plans/0034 D9): reported when the file has content but no parseable items.
// Problem lines carry concrete paths and feed the retry feedback verbatim.
async function decomposeArtifactProblems(dir: string, taskId: string): Promise<string[]> {
  const raw = (await Bun.file(join(dir, await resolveTaskDoc(dir, taskId, "subtasks"))).text().catch(() => "")).trim()
  const items = subtasks(raw)
  const { problems } = await checkArtifactSpecs(decomposeArtifactSpecs(taskId, items.length), { dir, policy: "mandatory" })
  if (raw && !items.length) problems.push(`${taskDoc(taskId, "subtasks")} has no checklist items`)
  return problems
}

// Runs one subtask session, then ticks the checklist item on trust: the
// session self-checks its own work; the whole task is accounted for by the
// wrap-up report and its result line.
// handoff-steer 同样适用于子任务会话(与 ondemand 整任务会话同机制、共用
// docs/<id>/handoff.md): 会话进行中上下文已用量达到 2x --context-limit 时
// driver steer 交接提示,会话写出交接文档(末行 `状态: 继续|完成`,以本子任务
// 是否完成计)后换新会话凭交接续跑,直到自然完成或交接文档标记完成;子任务
// 完成后清除交接文档,下一子任务重新起算。实验开关 OPENCODE_AUTO_STEER=off
// 停用本机制(不注入交接提示、会话后不做交接判定,自然完成即收)。
export async function runSubtask(
  client: AgentClient,
  plan: Plan,
  task: Task,
  text: string,
  index: number,
  opts: Opts,
  chain: SessionChain,
  base?: ForkBaseInfo,
  // 本子任务恢复续跑(active 进度记录归属本单元): 豁免启动 clean 门禁——工作区
  // 脏区是本单元自身进度(含交接文档),收口时一并落账(plans/0021-commit-boundary-design.md)。
  resumeUnit = false,
): Promise<UnitStop | undefined> {
  subbanner(`${task.id} subtask ${index}: ${text.length > 50 ? `${text.slice(0, 50)}…` : text}`)
  const subject = `${task.id} S${index} ${text}`
  chain.subject = subject
  const dir = opts.dir ?? dirname(plan.path)
  // 子任务单元提交边界: 启动 clean 门禁 + SHA 基线(收口时校验提交区间全为 driver
  // 提交);driver 独占状态文件遗留由 beginUnit 内部 carryover 自愈。基线同时上链
  // (严格恢复: active 记录携带、回滚锚点)。
  let baseline: UnitBaseline | undefined
  if (resumeUnit) {
    if (opts.commit !== false && !opts.dryrun) baseline = await unitBaseline(dir)
  } else {
    const gate = await beginUnit(dir, opts, task)
    if (gate.type === "dirty") return { type: "dirty", files: gate.files }
    baseline = gate.baseline
  }
  chain.baseline = baseline
  const strict = strictResumeActive(opts)
  const cap = opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT
  // steer=off(OPENCODE_AUTO_STEER)时不构造交接提示,会话后的交接判定一并停用
  // (见 usage.ts sessionHandoverDue);--handover-test 的测试交接是独立机制,不受影响。
  const steer = handoffSteer(autoSwitches().steer, cap, task)
  // 交接文档读回落(stable-refs P1): 会话写目标恒为新路径(提示词经 handoffFile
  // 注入),读点优先新路径、旧平铺存在则回落。
  const planDir = dirname(plan.path)
  const readHandoff = async (): Promise<string> =>
    Bun.file(join(planDir, await resolveTaskDoc(planDir, task.id, "handoff"))).text().catch(() => "")
  // 子任务目录状态协议(M1.0,plans/0030 D8): done.md 已存在 = 本子任务已收口
  // (含中断恰好落在 rename 与统一提交之间的恢复盘面)——跳过会话直接进收口
  // (勾选 + 提交)。文件存在性是进度事实,不凭会话叙事。状态文件路径自 spec 数据
  // (document/spec.ts subtaskStateSpec,M1.4)。
  const stateSpec = subtaskStateSpec(task.id, index)
  const stateDone = await Bun.file(join(planDir, stateSpec.complete.path)).exists()
  // 中断恢复播种: 陈旧交接文档由 pipeline 在非恢复路径清除,此处文件仍存在且
  // 状态=完成 → 子任务在中断前已由交接会话完成,直接勾选;状态=继续 → 以续跑
  // 提示开新会话凭交接继续(复用旧会话只会立刻再触上限)。
  const prior = stateDone ? undefined : handoffStatus(await readHandoff())
  if (stateDone) {
    log(`↻ ${task.id} subtask ${index}: ${stateSpec.complete.path} already exists; skipping the session and closing out directly`)
  } else if (prior === "完成") {
    log(`↻ ${task.id} resume after interruption: handover document ${handoffFile(task)} marks the subtask complete; checking it off directly`)
  } else {
    let continuation = prior === "继续"
    if (continuation) log(`↻ ${task.id} resume after interruption: handed over as ${handoffFile(task)} before the interruption; the new session continues the subtask from the handover document`)
    // ③ 子任务首个会话从基点分叉(与分解会话同一分叉点,先 fork 后渲染——warm/
    // cold 背景段据此选择);跨子任务不复用(种子链强制),交接续跑与带反馈重试
    // 沿用链内既有机制。无基点/失败 → 全新会话 + 冷启动提示词(读 context.md)。
    let warm = await seedForkSession(client, opts, chain, base, subject)
    let feedback = ""
    let retried = false
    // 产物形检的重提示次数(D2): 与交接文档反馈的 retried 各自计数——两条环路
    // 各限一次,互不挤占对方的重试额度。
    let shapeRetried = false
    // 形检重提示经 fork 刚结束的会话下发时(2026-09-18 修订),下一回合只带反馈
    // 本身——副本已含完整提示词与全部工作上下文,重发整份只会诱导从头重做。
    let shapeForked = false
    // 严格恢复的回滚重做(3.3 R3 收紧): 交接文档无效(含测试交接写核失败)一次即
    // 回滚到子任务基线、冷启动重做,不再带反馈重试;以一次为限,再失败按隐性阻塞
    // 上抛(现场已保全在 stash)。
    let rolled = false
    const rollbackRedo = async (): Promise<UnitStop | "done" | undefined> => {
      if (!strict || !baseline) return undefined
      const done = await rollbackUnitState(dir, task, `subtask ${index}`, baseline, {
        planPath: plan.path,
        progress: await peekProgress(dir),
        solo: (opts.subtask ?? "auto") !== "auto",
      })
      if (done.type !== "ok") return done
      continuation = false
      feedback = ""
      retried = false
      chain.id = undefined
      chain.pending = undefined
      chain.note = undefined
      chain.pct = 100
      chain.used = 0
      chain.at = 0
      // 冷启动重做从基点重新分叉(与子任务首个会话同一形态,拿回暖前缀)。
      warm = await seedForkSession(client, opts, chain, base, subject)
      return "done"
    }
    for (;;) {
      const brief = shapeForked
      shapeForked = false
      const result = await runExecSession(
        client,
        plan,
        task,
        brief ? feedback.trimStart() : renderSubtask(plan, task, text, { ...opts, continuation, index, warm }) + feedback,
        opts,
        chain,
        steer,
        index,
      )
      if (result.type === "blocked") {
        // 测试交接写核失败(严格恢复): 回滚后冷启动重做,一次为限。
        if (result.rollback && !rolled) {
          const redone = await rollbackRedo()
          if (redone === "done") {
            rolled = true
            continue
          }
          if (redone) return redone
        }
        return result
      }
      // 未触发交接阈值(2x cap)即结束 = 子任务会话自然收场。完成判定不靠 agent
      // 自报: 先过产物形检(D2/D4/D6,session-boundary-hardening §4.3/§4.6)——零落盘/
      // 声明产出缺失/文档截断(含全量变更扫描)任一命中都不得勾选推进(T-068 S01 事故的判定层
      // 缺口),带反馈重提示一次,仍不过 → blocked 交人工。dryrun/提交门禁关闭/
      // 非 git 不启用,测试交接收场会话豁免(其完成判据在 testhandoff.md)。
      // steer=off 时不构造交接提示,自然完成即收、不索要交接文档——否则自然结束
      // 但用量超限的会话会被误要求补写交接文档;超限收场交由 provider 侧压缩/上限
      // 错误走既有「会话错误」换新会话重试,磁盘进度与统一提交不受影响。
      if (!sessionHandoverDue(client.capabilities.usage, steer, chain.used, chain.hinted)) {
        if (baseline && shapeCheckOn(opts, baseline, Boolean(result.testHandover))) {
          const problems = await subtaskArtifactProblems(dir, text, baseline)
          if (problems.length) {
            if (shapeRetried) {
              return {
                type: "blocked",
                question:
                  `subtask session ended naturally but the artifact shape check failed (hidden blockage): ${problems.join("; ")}. ` +
                  `Check the artifacts and re-run. Last agent output:\n${result.lastText.trim().slice(-2000) || "(no output)"}`,
              }
            }
            shapeRetried = true
            feedback = shapeFeedback(task, index, problems)
            // 重提示基于刚结束的会话 fork 续做(2026-09-18 修订): 副本带着本会话的
            // 全部工作上下文,下一回合只下发反馈本身;fork 不可用(会话已失效)回退
            // 全新会话 + 完整提示词 + 反馈。
            shapeForked = await forkEndedSession(client, chain, subject)
            log(`↻ ${task.id} subtask ${index} ended naturally but the artifact shape check failed; ${shapeForked ? "forked from the original session, " : ""}re-prompting once with feedback`)
            continue
          }
        }
        break
      }
      const status = handoffStatus(await readHandoff())
      if (status === "完成") break
      // 交接续跑/带反馈重试前先把本会话产出提交(下一会话从已提交的工作区继续)。
      const committed = await afterSession(dir, opts, task, { stage: `subtask ${index}`, subject })
      if (committed.type === "failed") return commitBlocked(`${task.id} subtask ${index}`, committed)
      if (status === "继续") {
        log(`↻ ${task.id} subtask ${index} context reached the ${formatTokens(cap * 2)} cap; handed over as ${handoffFile(task)}, continuing in a new session`)
        continuation = true
        feedback = ""
        continue
      }
      // 交接边界写核失败(严格恢复): 无效一次即回滚冷启动重做。
      if (!rolled) {
        const redone = await rollbackRedo()
        if (redone === "done") {
          rolled = true
          log(`↻ ${task.id} subtask ${index} context cap reached but no valid handover document ${handoffFile(task)} was produced; strict resume already rolled back; cold-starting`)
          continue
        }
        if (redone) return redone
      }
      if (retried) {
        return {
          type: "blocked",
          question:
            `subtask session hit the context cap but failed twice to produce a valid handover document ${handoffFile(task)} (missing, or lacking a status line; hidden blockage). ` +
            `Check the file and re-run. Last agent output:\n${result.lastText.trim().slice(-2000) || "(no output)"}`,
        }
      }
      log(`↻ ${task.id} subtask ${index} context cap reached but ${handoffFile(task)} was not produced; retrying once with feedback`)
      retried = true
      feedback =
        `\n\nThe last time you ended the session the context had reached its limit, but no valid ${handoffFile(task)} was written (missing, or lacking the \`状态: 继续|完成\` status line — a driver protocol string, write it verbatim). ` +
        `This is a hard requirement: write that file before ending the session.`
    }
  }
  // 子任务完成: 清除交接文档(ondemand 交接与测试交接,下一子任务重新起算——
  // 测试交接按子任务命名,这里移除本子任务的文件),新旧两处一并清(driver 勾选后统一提交)。
  await rm(join(planDir, handoffFile(task)), { force: true })
  await rm(join(planDir, legacyTaskDoc(task.id, "handoff")), { force: true })
  await removeHandoffChain(planDir, testHandoffFile(task, index))
  await removeHandoffChain(planDir, legacySubtaskTestHandoff(task.id, index))
  // 子任务目录状态协议收口(plans/0030 D7): DRIVER 在提交边界内把 todo.md 改名为
  // done.md——盘面文件存在性即进度事实;幂等(协议未激活无 todo.md、中断落在
  // rename 之后 done.md 已存在,均跳过)。
  await renameTodoToDone(planDir, task.id, index)
  await tick(plan.path, task.id, text)
  // 镜像刷新属本次状态写入,须在统一提交前落盘: 否则 PLAN.md 的勾选与 CURRENT.md
  // 的同一次刷新分属相邻两次提交(镜像永远落后一格,回滚到子任务提交取回的镜像
  // 与 PLAN.md 不一致;步进暂停现场亦会残留未提交改动)。
  await writeCurrent(plan.path, requireTask(await load(plan.path), task.id), (opts.subtask ?? "auto") !== "auto")
  // 子任务提交信息省略任务标题(编号 + 子任务编号 + 子任务标题即可定位)。
  // 单元收口: 带基线做提交区间校验——勾选与镜像未落账即不视为完成。
  const committed = await afterSession(dir, opts, task, { stage: `subtask ${index}`, subject }, baseline)
  if (committed.type === "failed") return commitBlocked(`${task.id} subtask ${index}`, committed)
  log(`  ✓ ${text.slice(0, 60)}`)
  return undefined
}

// —— Subtask artifact shape checks (D2/D4/D6, session-boundary-hardening §4.3/§4.6;
// spec-driven since M1.4) ——

// Check list: ① zero disk writes (the worktree is unchanged relative to the
// unit baseline — beginUnit guarantees a clean baseline, so an unmoved HEAD
// with no dirty area means this unit wrote nothing); ②③④ declared artifacts
// run through the generic spec checker (document/spec.ts, "declared" policy):
// existence per declared path, non-trivial + terminal eof for .md files new
// (untracked) in this unit, and declared section anchors; ⑤ the whole-unit eof
// scan — every .md in the unit's git changes (new or modified, incl. undeclared
// side documents and copies already committed at a handover boundary) must be
// non-trivial + end with the terminator; exemptions derive from document roles
// (document/roles.ts eofScanExempt); ⑥ the P1 prohibition scan (M2.3,
// plans/0045) — lines the unit added to deliverable files must not reference
// process documents (document/process-refs.ts; bare task ids are logged as
// warnings only). All criteria are deterministic: a zero-write or truncated
// "natural end" is never completion.
async function subtaskArtifactProblems(dir: string, text: string, baseline: UnitBaseline): Promise<string[]> {
  const problems: string[] = []
  if (await unitQuiet(dir, baseline)) problems.push("no changes relative to the unit baseline (zero disk writes)")
  const fresh = await untrackedFiles(dir)
  const declared = await checkArtifactSpecs(declaredArtifacts(text), { dir, policy: "declared", fresh })
  problems.push(...declared.problems)
  // ③ Shape-checked paths are skipped by the ⑤ scan (one path never forms two
  // cases).
  const shaped = new Set(declared.shaped)
  // ⑤ complements ②: existence catches "what should be there is missing"
  // (uncreated files are invisible to the git scan), the whole-unit scan
  // catches "what was written was not finished"; a modified document whose
  // terminator is no longer the last line fails too (the "appended after the
  // terminator" truncation shape), and the re-prompt feedback directs
  // restoring the terminal terminator.
  for (const rel of await unitChangedFiles(dir, baseline)) {
    if (!rel.toLowerCase().endsWith(".md") || shaped.has(rel) || eofScanExempt(rel)) continue
    const content = await Bun.file(join(dir, rel)).text().catch(() => "")
    problems.push(...docShapeProblems(content, rel))
  }
  const refs = processReferenceScan(await unitAddedLines(dir, baseline))
  for (const warning of refs.warnings) log(`  ⚠ ${warning}`)
  problems.push(...refs.problems)
  return problems
}

// D2 feedback wording: restates the L1 authoritative state (the ledger tick
// snapshot) and cites each failing item, pointing straight at the misjudgment —
// a previous task's completion narrative is not this task's state (the T-068 S01
// incident shape).
function shapeFeedback(task: Task, index: number, problems: string[]): string {
  const items = subtasks(task.body)
  const done = items.filter((item) => item.done).length
  const sid = `S${String(index).padStart(2, "0")}`
  return (
    `\n\nYou ended the session last time, but this subtask's (${task.id}.${sid}) artifacts did not pass the shape check, so it must not be treated as complete:\n` +
    `${problems.map((problem) => `- ${problem}`).join("\n")}\n` +
    `Authoritative state: task ${task.id} "${task.title}" is in progress, subtask ticks ${done}/${items.length}, ${sid} is not ticked yet; ` +
    `completion narratives in previous tasks or in other documents say nothing about this task's progress — do not judge this subtask complete on that basis. ` +
    `Actually complete this subtask and write its artifacts to disk: every declared artifact file must exist; Markdown documents created or modified in this unit must be complete in content ` +
    `and closed with \`${EOF_MARK}\` alone on the last line of body text before you end the session (when modifying an existing document, the terminator must likewise stay on the last line).`
  )
}

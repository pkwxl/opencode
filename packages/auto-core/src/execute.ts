// 任务执行阶段: executeWhole(off/ondemand 整任务会话)+ fork 流水线 ① 理解
// (ensureUnderstood)② 分解(ensureDecomposed)+ runSubtask 单个子任务会话,及
// PLAN.md 重读小工具 requireTask。位于 exec-session/session 之上、runner 之下;
// **不得反向 import runner**(§D.2)。
// 拆分自 src/runner.ts(docs/module-split-plan.md S12,纯搬运)。

import { rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import type { ForkBaseInfo, SessionChain } from "./chain"
import { writeCurrent } from "./current"
import { docShapeProblems, EOF_MARK, eofScanExempt, shapeCheckOn } from "./doccheck"
import { legacySubtaskTestHandoff, legacyTaskDoc, resolveTaskDoc, taskDoc } from "./docpaths"
import { runExecSession } from "./exec-session"
import { beginUnit, unitBaseline, unitChangedFiles, unitQuiet, untrackedFiles, type UnitBaseline } from "./git"
import { handoffStatus } from "./handover"
import { autobanner, log, subbanner } from "./log"
import { DEFAULT_CONTEXT_LIMIT, type Opts, type UnitStop } from "./opts"
import { declaredArtifacts, load, setForkBase, setSubtasks, subtasks, tick, type Plan, type Task } from "./plan"
import { handoffFile, renderDecompose, renderSubtask, renderUnderstand, renderWhole, testHandoffFile } from "./prompt"
import { peekProgress } from "./resume"
import { runSession } from "./session"
import { formatTokens, seedForkSession } from "./session-api"
import { autoSwitches } from "./switches"
import { handoffSteer, handoverDue, removeHandoffChain } from "./testrun"
import { afterSession, commitBlocked, rollbackUnitState, strictResumeActive } from "./unit-commit"

// off/ondemand 的执行阶段: off 单会话完成整个任务;ondemand 会话进行中上下文
// 达到 2x --context-limit 时由 driver steer 交接提示,会话写出交接文档后换新会话
// 续跑,直到自然完成或交接文档标记完成。返回 undefined 表示执行阶段完成。
// 上次尝试遗留交接文档的清理由调用方(pipeline)在做恢复判定后进行。
export async function executeWhole(
  client: OpencodeClient,
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
  // (见 handoverDue);off 模式本就不构造。
  const steer = ondemand ? handoffSteer(autoSwitches().steer, cap, task) : undefined
  const subject = `${task.id} exec ${task.title}`
  chain.subject = subject
  // 中断恢复播种: 陈旧交接文档由 pipeline 在非恢复路径清除,此处文件仍存在即
  // active 恢复——中断前已交接。状态=完成 → 执行阶段已完成,跳过整任务会话;
  // 状态=继续 → 以续跑提示开新会话凭交接继续(复用旧会话只会立刻再触上限)。
  const prior = ondemand ? handoffStatus(await readHandoff()) : undefined
  if (prior === "完成") {
    log(`↻ ${task.id} 恢复中断: 交接文档 ${handoffFile(task)} 标记执行已完成,跳过整任务会话`)
    return undefined
  }
  let continuation = prior === "继续"
  if (continuation) log(`↻ ${task.id} 恢复中断: 中断前已交接 ${handoffFile(task)},新会话凭交接文档续跑`)
  let feedback = ""
  let retried = false
  // 严格恢复的回滚重做(3.3 R3 收紧): 交接文档无效(含测试交接写核失败)一次即回滚
  // 到单元基线、冷启动重做本单元,不再带反馈重试;以一次为限,再失败按隐性阻塞
  // 上抛(现场已保全在 stash)。
  let rolled = false
  const rollbackRedo = async (): Promise<UnitStop | "done" | undefined> => {
    if (!strict || !chain.baseline) return undefined
    const done = await rollbackUnitState(dir, task, "执行会话", chain.baseline, {
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
      renderWhole(plan, task, { mode: opts.mode, verify: opts.verify, ondemand, continuation }) + feedback,
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
    const committed = await afterSession(dir, opts, task, { stage: "execute", subject })
    if (committed.type === "failed") return commitBlocked(`${task.id} 执行会话`, committed)
    // 未触发交接阈值(2x cap)即结束 = 任务在单会话内自然完成;steer 未构造
    // (off 模式或 OPENCODE_AUTO_STEER=off)时同样自然收,不做交接判定。
    if (!handoverDue(steer, chain.used)) return undefined
    const status = handoffStatus(await readHandoff())
    if (status === "完成") return undefined
    if (status === "继续") {
      log(`↻ ${task.id} 上下文达到 ${formatTokens(cap * 2)} 上限,已交接 ${handoffFile(task)},新会话继续`)
      continuation = true
      feedback = ""
      continue
    }
    // 交接边界写核失败(严格恢复): 无效一次即回滚冷启动重做。
    if (!rolled) {
      const redone = await rollbackRedo()
      if (redone === "done") {
        rolled = true
        log(`↻ ${task.id} 达到上下文上限但未产出有效交接文档 ${handoffFile(task)},严格恢复已回滚,冷启动重做`)
        continue
      }
      if (redone) return redone
    }
    if (retried) {
      return {
        type: "blocked",
        question:
          `会话上下文达到上限但两次未写出有效交接文档 ${handoffFile(task)}(缺失或无状态行,隐性阻塞)。` +
          `请检查该文件后重新运行。Agent 最后的输出:\n${result.lastText.trim().slice(-2000) || "(无输出)"}`,
      }
    }
    log(`↻ ${task.id} 达到上下文上限但未产出 ${handoffFile(task)},带反馈重试一次`)
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

// fork 流水线 ① 理解阶段(fork-decompose 设计 §4.1): 理解会话只读探查并写
// docs/<id>/context.md 四节摘要(requireArtifact 同款两次重试 + 隐性阻塞);成功后
// driver 写任务字段 fork-base(session 模式下即最终基点;digest 模式随后被基点
// 确认会话覆写)并按 "understand" 阶段统一提交。摘要已存在(中断恢复/上一轮
// 遗留)时幂等跳过,仅补写缺失的 fork-base(中断恰好落在摘要写盘与 setForkBase
// 之间的恢复路径)。
export async function ensureUnderstood(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
): Promise<({ type: "ok" } & { task: Task }) | UnitStop> {
  // 摘要路径(目录化布局,stable-refs P1): 写目标恒为新路径;读点经 resolveTaskDoc
  // 回落旧平铺 docs/<id>.context.md,存量项目中断恢复不受改名影响。
  const dir = dirname(plan.path)
  const file = join(dir, taskDoc(task.id, "context"))
  const readContext = async (): Promise<string> =>
    (await Bun.file(join(dir, await resolveTaskDoc(dir, task.id, "context"))).text().catch(() => "")).trim()
  if (await readContext()) {
    log(`↻ ${task.id} 理解摘要 ${file} 已存在,跳过理解会话`)
    if (!task.forkBase && chain.id) {
      await setForkBase(plan.path, task.id, chain.id)
      task = requireTask(await load(plan.path), task.id)
    }
    return { type: "ok", task }
  }
  autobanner(`${task.id} ${task.title}: 任务背景理解`)
  const subject = `${task.id} understand ${task.title}`
  chain.subject = subject
  let feedback = ""
  for (let i = 0; ; i++) {
    // taskContext(OPENCODE_AUTO_TASK_CONTEXT)透传理解提示词: 放宽 context.md
    // 的建议行数措辞(与 fine 透传分解提示词同一接线方式)。
    const result = await runSession(
      client,
      task,
      renderUnderstand(plan, task, { ...opts, taskContext: autoSwitches().taskContext }) + feedback,
      opts,
      chain,
    )
    if (result.type === "blocked") return result
    const content = await readContext()
    // D5 形检(session-boundary-hardening §4.5,S3b): 存在性之外追加非平凡 + 末行
    // 终止符,接入既有重试环;只查本次会话产出——上方「已存在即跳过」路径不受影响
    // (不追溯存量,历史无终止符文档不会被卡)。
    const problems = content ? docShapeProblems(content, taskDoc(task.id, "context")) : []
    if (content && !problems.length) {
      // 理解会话即 session 模式基点;digest 模式由 ensureForkBase 随后覆写。
      if (chain.id) await setForkBase(plan.path, task.id, chain.id)
      task = requireTask(await load(plan.path), task.id)
      const committed = await afterSession(opts.dir ?? dirname(plan.path), opts, task, { stage: "understand", subject })
      if (committed.type === "failed") return commitBlocked(`${task.id} 理解会话`, committed)
      return { type: "ok", task }
    }
    const why = content ? `未过形检(${problems.join("; ")})` : "缺失或为空"
    if (i === 1) {
      return {
        type: "blocked",
        question:
          `理解会话两次结束但 ${file} ${why}(隐性阻塞)。` +
          `请检查该文件后重新运行。Agent 最后的输出:\n${result.lastText.trim().slice(-2000) || "(无输出)"}`,
      }
    }
    log(`↻ ${task.id} 理解会话产出的 ${file} ${why},带反馈重试一次`)
    feedback = content
      ? `\n\n你上次结束会话但 ${file} 未过形检: ${problems.join("; ")}。这是硬性要求:` +
        `把理解结果按四节结构补全,并以 \`${EOF_MARK}\` 独占最后一行正文收尾后再结束会话。`
      : `\n\n你上次结束会话但未写出有效的 ${file}(缺失或为空)。这是硬性要求:` +
        `把理解结果按四节结构写入该文件后再结束会话(即使任务看起来很简单)。`
  }
}

// Ensures the task body has a checklist: tasks resuming with one (or with a
// human-written one) are used as-is; otherwise a decomposition session writes
// docs/<id>/subtasks.md and the driver injects the items into PLAN.md.
// 中断恢复: 分解会话可能已写出文件但尚未注入——先直读文件,有效则直接注入,
// 不再开会话。
export async function ensureDecomposed(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
  base?: ForkBaseInfo,
): Promise<({ type: "ok" } & { task: Task }) | UnitStop> {
  if (subtasks(task.body).length) return { type: "ok", task }
  // 分解结果路径(目录化布局): 写目标恒为新路径;读点经 resolveTaskDoc 回落旧
  // 平铺 docs/<id>.subtasks.md(中断恢复: 分解会话可能已写旧名文件但尚未注入)。
  const dir = dirname(plan.path)
  const file = join(dir, taskDoc(task.id, "subtasks"))
  const readRaw = async (): Promise<string> =>
    (await Bun.file(join(dir, await resolveTaskDoc(dir, task.id, "subtasks"))).text().catch(() => "")).trim()
  const readItems = async (): Promise<string[]> => subtasks(await readRaw()).map((item) => item.text)
  const existing = await readItems()
  if (existing.length) {
    log(`↻ ${task.id} 分解结果 ${file} 已存在,直接注入检查项`)
    await setSubtasks(plan.path, task.id, existing)
    return { type: "ok", task: requireTask(await load(plan.path), task.id) }
  }
  let feedback = ""
  // One automatic retry with feedback: a resumed session may have done the
  // work instead of writing the file; the file is a hard requirement.
  autobanner(`${task.id} ${task.title}: 子任务分解`)
  const subject = `${task.id} decompose ${task.title}`
  chain.subject = subject
  // ② 分解会话从基点分叉(先 fork 后渲染,设计 §4.3);无基点/失败 → 现状全新
  // 会话。种子链使分解会话不复用理解会话(基点保持纯净分叉点)。
  await seedForkSession(client, opts, chain, base, subject)
  for (let i = 0; ; i++) {
    // fine(OPENCODE_AUTO_DECOMPOSE_FINE=on)透传分解提示词: 注入细粒度准则段
    // (fork-decompose-design.md §5.1)。
    const result = await runSession(client, task, renderDecompose(plan, task, { ...opts, fine: autoSwitches().fine }) + feedback, opts, chain)
    if (result.type === "blocked") return result
    const raw = await readRaw()
    const items = subtasks(raw).map((item) => item.text)
    // D5 形检(session-boundary-hardening §4.5,S3b): 有检查项之外追加非平凡 + 末行
    // 终止符,接入既有重试环;只查本次会话产出——上方「文件已存在即直接注入」路径
    // 不受影响(不追溯存量)。
    const problems = items.length ? docShapeProblems(raw, taskDoc(task.id, "subtasks")) : []
    if (items.length && !problems.length) {
      await setSubtasks(plan.path, task.id, items)
      // 镜像刷新同样先于统一提交(与子任务勾选同口径): 注入的检查项与镜像同入
      // decompose 提交,调用方随后的刷新即幂等空写。
      await writeCurrent(plan.path, requireTask(await load(plan.path), task.id))
      const committed = await afterSession(opts.dir ?? dirname(plan.path), opts, task, { stage: "decompose", subject })
      if (committed.type === "failed") return commitBlocked(`${task.id} 分解会话`, committed)
      return { type: "ok", task: requireTask(await load(plan.path), task.id) }
    }
    const why = items.length ? `未过形检(${problems.join("; ")})` : "缺失或无检查项"
    if (i === 1) {
      return {
        type: "blocked",
        question:
          `分解会话两次结束但 ${file} ${why}(隐性阻塞)。` +
          `请检查该文件后重新运行。Agent 最后的输出:\n${result.lastText.trim().slice(-2000) || "(无输出)"}`,
      }
    }
    log(`↻ ${task.id} 分解会话产出的 ${file} ${why},带反馈重试一次`)
    feedback = items.length
      ? `\n\n你上次结束会话但 ${file} 未过形检: ${problems.join("; ")}。这是硬性要求:` +
        `补全内容并以 \`${EOF_MARK}\` 独占最后一行正文收尾后再结束会话。`
      : `\n\n你上次结束会话但未写出有效的 ${file}(缺失或无检查项)。这是硬性要求:` +
        `即使任务已完成或极简单,也必须写出该文件(原子任务写单个检查项即可)。`
  }
}

// Runs one subtask session, then ticks the checklist item on trust: the
// session self-checks its own work, and acceptance of the whole task is
// deferred to the single task-level review after wrap-up (a gap there
// appends a fix subtask).
// handoff-steer 同样适用于子任务会话(与 ondemand 整任务会话同机制、共用
// docs/<id>/handoff.md): 会话进行中上下文已用量达到 2x --context-limit 时
// driver steer 交接提示,会话写出交接文档(末行 `状态: 继续|完成`,以本子任务
// 是否完成计)后换新会话凭交接续跑,直到自然完成或交接文档标记完成;子任务
// 完成后清除交接文档,下一子任务重新起算。实验开关 OPENCODE_AUTO_STEER=off
// 停用本机制(不注入交接提示、会话后不做交接判定,自然完成即收)。
export async function runSubtask(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  text: string,
  index: number,
  opts: Opts,
  chain: SessionChain,
  base?: ForkBaseInfo,
  // 本子任务恢复续跑(active 进度记录归属本单元): 豁免启动 clean 门禁——工作区
  // 脏区是本单元自身进度(含交接文档),收口时一并落账(commit-boundary-design.md)。
  resumeUnit = false,
): Promise<UnitStop | undefined> {
  subbanner(`${task.id} 子任务 ${index}：${text.length > 50 ? `${text.slice(0, 50)}…` : text}`)
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
  // (见 handoverDue);--handover-test 的测试交接是独立机制,不受影响。
  const steer = handoffSteer(autoSwitches().steer, cap, task)
  // 交接文档读回落(stable-refs P1): 会话写目标恒为新路径(提示词经 handoffFile
  // 注入),读点优先新路径、旧平铺存在则回落。
  const planDir = dirname(plan.path)
  const readHandoff = async (): Promise<string> =>
    Bun.file(join(planDir, await resolveTaskDoc(planDir, task.id, "handoff"))).text().catch(() => "")
  // 中断恢复播种: 陈旧交接文档由 pipeline 在非恢复路径清除,此处文件仍存在且
  // 状态=完成 → 子任务在中断前已由交接会话完成,直接勾选;状态=继续 → 以续跑
  // 提示开新会话凭交接继续(复用旧会话只会立刻再触上限)。
  const prior = handoffStatus(await readHandoff())
  if (prior === "完成") {
    log(`↻ ${task.id} 恢复中断: 交接文档 ${handoffFile(task)} 标记子任务已完成,直接勾选`)
  } else {
    let continuation = prior === "继续"
    if (continuation) log(`↻ ${task.id} 恢复中断: 中断前已交接 ${handoffFile(task)},新会话凭交接文档续跑子任务`)
    // ③ 子任务首个会话从基点分叉(与分解会话同一分叉点,先 fork 后渲染——warm/
    // cold 背景段据此选择);跨子任务不复用(种子链强制),交接续跑与带反馈重试
    // 沿用链内既有机制。无基点/失败 → 全新会话 + 冷启动提示词(读 context.md)。
    let warm = await seedForkSession(client, opts, chain, base, subject)
    let feedback = ""
    let retried = false
    // 产物形检的重提示次数(D2): 与交接文档反馈的 retried 各自计数——两条环路
    // 各限一次,互不挤占对方的重试额度。
    let shapeRetried = false
    // 严格恢复的回滚重做(3.3 R3 收紧): 交接文档无效(含测试交接写核失败)一次即
    // 回滚到子任务基线、冷启动重做,不再带反馈重试;以一次为限,再失败按隐性阻塞
    // 上抛(现场已保全在 stash)。
    let rolled = false
    const rollbackRedo = async (): Promise<UnitStop | "done" | undefined> => {
      if (!strict || !baseline) return undefined
      const done = await rollbackUnitState(dir, task, `子任务 ${index}`, baseline, {
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
      const result = await runExecSession(
        client,
        plan,
        task,
        renderSubtask(plan, task, text, { ...opts, continuation, index, warm }) + feedback,
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
      if (!handoverDue(steer, chain.used)) {
        if (baseline && shapeCheckOn(opts, baseline, Boolean(result.testHandover))) {
          const problems = await subtaskArtifactProblems(dir, text, baseline)
          if (problems.length) {
            if (shapeRetried) {
              return {
                type: "blocked",
                question:
                  `子任务会话自然结束但产物形检未过(隐性阻塞): ${problems.join("; ")}。` +
                  `请检查产出后重新运行。Agent 最后的输出:\n${result.lastText.trim().slice(-2000) || "(无输出)"}`,
              }
            }
            log(`↻ ${task.id} 子任务 ${index} 自然结束但产物形检未过,带反馈重提示一次`)
            shapeRetried = true
            feedback = shapeFeedback(task, index, problems)
            continue
          }
        }
        break
      }
      const status = handoffStatus(await readHandoff())
      if (status === "完成") break
      // 交接续跑/带反馈重试前先把本会话产出提交(下一会话从已提交的工作区继续)。
      const committed = await afterSession(dir, opts, task, { stage: `subtask ${index}`, subject })
      if (committed.type === "failed") return commitBlocked(`${task.id} 子任务 ${index}`, committed)
      if (status === "继续") {
        log(`↻ ${task.id} 子任务 ${index} 上下文达到 ${formatTokens(cap * 2)} 上限,已交接 ${handoffFile(task)},新会话继续`)
        continuation = true
        feedback = ""
        continue
      }
      // 交接边界写核失败(严格恢复): 无效一次即回滚冷启动重做。
      if (!rolled) {
        const redone = await rollbackRedo()
        if (redone === "done") {
          rolled = true
          log(`↻ ${task.id} 子任务 ${index} 达到上下文上限但未产出有效交接文档 ${handoffFile(task)},严格恢复已回滚,冷启动重做`)
          continue
        }
        if (redone) return redone
      }
      if (retried) {
        return {
          type: "blocked",
          question:
            `子任务会话上下文达到上限但两次未写出有效交接文档 ${handoffFile(task)}(缺失或无状态行,隐性阻塞)。` +
            `请检查该文件后重新运行。Agent 最后的输出:\n${result.lastText.trim().slice(-2000) || "(无输出)"}`,
        }
      }
      log(`↻ ${task.id} 子任务 ${index} 达到上下文上限但未产出 ${handoffFile(task)},带反馈重试一次`)
      retried = true
      feedback =
        `\n\n你上次结束会话时上下文已达上限,但未写出有效的 ${handoffFile(task)}(缺失或缺少 \`状态: 继续|完成\` 行)。` +
        `这是硬性要求: 写出该文件后再结束会话。`
    }
  }
  // 子任务完成: 清除交接文档(ondemand 交接与测试交接,下一子任务重新起算——
  // 测试交接按子任务命名,这里移除本子任务的文件),新旧两处一并清(driver 勾选后统一提交)。
  await rm(join(planDir, handoffFile(task)), { force: true })
  await rm(join(planDir, legacyTaskDoc(task.id, "handoff")), { force: true })
  await removeHandoffChain(planDir, testHandoffFile(task, index))
  await removeHandoffChain(planDir, legacySubtaskTestHandoff(task.id, index))
  await tick(plan.path, task.id, text)
  // 镜像刷新属本次状态写入,须在统一提交前落盘: 否则 PLAN.md 的勾选与 CURRENT.md
  // 的同一次刷新分属相邻两次提交(镜像永远落后一格,回滚到子任务提交取回的镜像
  // 与 PLAN.md 不一致;步进暂停现场亦会残留未提交改动)。
  await writeCurrent(plan.path, requireTask(await load(plan.path), task.id), (opts.subtask ?? "auto") !== "auto")
  // 子任务提交信息省略任务标题(编号 + 子任务编号 + 子任务标题即可定位)。
  // 单元收口: 带基线做提交区间校验——勾选与镜像未落账即不视为完成。
  const committed = await afterSession(dir, opts, task, { stage: `subtask ${index}`, subject }, baseline)
  if (committed.type === "failed") return commitBlocked(`${task.id} 子任务 ${index}`, committed)
  log(`  ✓ ${text.slice(0, 60)}`)
  return undefined
}

// —— 子任务产物形检(D2/D4/D6,session-boundary-hardening 设计 §4.3/§4.6)——

// 形检清单: ① 零落盘(工作区相对单元基线零变更——beginUnit 保证基线时 clean,
// HEAD 未动 + 无脏区即本单元至今零落盘);② 声明产出逐路径存在;③ 新建 .md 非
// 平凡 + 末行终止符(未跟踪 = 本单元新建;修改型产物的存在性检查恒真,无害);
// ④ 声明必填章节存在;⑤ D6 全量文档终止符——本单元 git 变更内所有 .md(新建或
// 修改,含未声明的顺带文档与单元期间已随交接提交落账的份)非平凡 + 末行终止符,
// 豁免清单见 doccheck.ts。全部为确定性判据,零产物/截断的「自然结束」不构成完成。
async function subtaskArtifactProblems(dir: string, text: string, baseline: UnitBaseline): Promise<string[]> {
  const problems: string[] = []
  if (await unitQuiet(dir, baseline)) problems.push("工作区相对单元基线零变更(零落盘)")
  const fresh = await untrackedFiles(dir)
  // ③ 已做过形检的路径,D6 扫描跳过(同一路径不重复成案)。
  const shaped = new Set<string>()
  for (const { path, sections } of declaredArtifacts(text)) {
    if (!(await Bun.file(join(dir, path)).exists())) {
      problems.push(`声明产出 ${path} 不存在`)
      continue
    }
    if (!path.toLowerCase().endsWith(".md")) continue
    const content = await Bun.file(join(dir, path)).text().catch(() => "")
    if (fresh.has(path)) {
      problems.push(...docShapeProblems(content, path))
      shaped.add(path)
    }
    for (const section of sections) {
      if (!content.includes(section)) problems.push(`声明产出 ${path} 缺少章节「${section}」`)
    }
  }
  // ⑤ 与 ② 互补: 存在性抓「该有的没有」(未创建的文件对 git 扫描不可见),全量
  // 扫描抓「写了的没写完」;修改既有文档后终止符不在末行同样不过(「追加在终止符
  // 之后」的截断形态),重提示反馈指引恢复末行终止符。
  for (const rel of await unitChangedFiles(dir, baseline)) {
    if (!rel.toLowerCase().endsWith(".md") || shaped.has(rel) || eofScanExempt(rel)) continue
    const content = await Bun.file(join(dir, rel)).text().catch(() => "")
    problems.push(...docShapeProblems(content, rel))
  }
  return problems
}

// D2 反馈文案: 复述 L1 权威状态(台账勾选快照)并逐项引用未过关项,直指误判——
// 前序任务的完成叙事不是本任务状态(T-068 S01 事故形态)。
function shapeFeedback(task: Task, index: number, problems: string[]): string {
  const items = subtasks(task.body)
  const done = items.filter((item) => item.done).length
  const sid = `S${String(index).padStart(2, "0")}`
  return (
    `\n\n你上次结束了会话,但本子任务(${task.id}.${sid})的产物形检未过,不得视为完成:\n` +
    `${problems.map((problem) => `- ${problem}`).join("\n")}\n` +
    `权威状态: 任务 ${task.id}「${task.title}」进行中,子任务勾选 ${done}/${items.length},${sid} 尚未勾选;` +
    `前序任务或其他文档中的完成叙事与本任务进度无关,不要据此判断本子任务已完成。` +
    `请实际完成本子任务并把产出写入磁盘: 声明的产出文件必须存在;本单元新建或修改的 Markdown 文档须内容完整,` +
    `并以 \`${EOF_MARK}\` 独占最后一行正文后再结束会话(修改既有文档时,终止符同样须保持在最后一行)。`
  )
}

// 任务级验收与质量审核: verifyTask 三段式(解析/生成验收脚本 → driver 执行 →
// 独立判定会话写结论,差距回灌执行链修复轮)+ reviewTask 质量审核会话 +
// planReviewFix 审核差距转修复检查项。位于 exec-session/artifact/session 之上、
// runner 之下;**不得反向 import runner**(§D.2)。
// 拆分自 src/runner.ts(plans/0024-module-split-plan.md S11,纯搬运)。

import { rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { AgentClient } from "./agent/types"
import { requireArtifact } from "./artifact"
import type { SessionChain } from "./chain"
import { legacyTaskDoc, resolveTaskDoc, taskDoc } from "./docpaths"
import { runExecSession } from "./exec-session"
import { autobanner, log } from "./log"
import { FIX_ROUNDS, REVERIFY_ROUNDS, type Opts, type UnitStop } from "./opts"
import { load, markDone, parse, subtasks, verifyCommand, type Plan, type Task } from "./plan"
import {
  renderFix,
  renderReview,
  renderReviewFix,
  renderVerifyJudge,
  renderVerifyScriptGen,
  REVIEW_FILE,
  VERDICT_FILE,
  type VerifyRun,
} from "./prompt"
import { allowWrite, reprotect } from "./protect"
import type { Phase } from "./resume"
import { autoSwitches } from "./switches"
import { removeHandoffChain } from "./testrun"
import { afterSession, commitBlocked, gatedTaskRefGap } from "./unit-commit"
import { resolveVerifyScript, runVerifyScript, verifyTmpDir } from "./verify"
import { runWrapup } from "./wrapup"

// Task-level acceptance after the wrap-up session, three stages (设计文档
// A.4/A.5,判定会话执行限制见 G 节): resolve and (when needed) generate the
// verify script, execute it via the driver, then run the independent judge
// session and parse its verdict file. The judge never executes verify scripts
// or commands itself; when it deems the script broken it replaces the
// designated script and concludes 重验 — the driver then re-executes that
// script (up to REVERIFY_ROUNDS) instead of resolving by verify field again.
// On pass the verified field prefers the judge's verified-command line, then
// the task's original command, then the actual executed script path. A gap is
// fed back into the execution session chain for a fix round (wrap-up re-runs,
// then the same script is re-executed and re-judged) until it passes or
// FIX_ROUNDS is exhausted; off mode skips fix rounds and returns the gap to
// the caller (task reverts to pending).
// Each review round re-enters verifyTask with a fresh fix-round budget.
// --early audit hook (设计文档 F.5): when given, a fresh audit session starts
// right before each script execution (after the generate session, if any) and
// joins before the judge session — a blocked audit propagates immediately;
// the last audit verdict rides back with the done result.
// 中断恢复(design doc H): persist 在各阶段边界写进度记录(含已执行的脚本运行
// 记录);resume 提供上次中断时的轮数计数与运行记录——脚本已执行完毕时不重跑,
// 直接(early 且审核结论缺失时补跑审核会话后)进入判定会话;修复轮进行中被中断
// (stage=fix,差距原文随记录持久化)时凭差距重新下发修复提示续跑,不重复判定。
export async function verifyTask(
  client: AgentClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
  audit?: () => Promise<Verdict | UnitStop>,
  persist?: (phase: Phase) => Promise<void>,
  resume?: Phase & { kind: "verify" },
): Promise<{ type: "done"; audit?: Verdict } | { type: "gap"; gap: string } | UnitStop> {
  const mode = opts.subtask ?? "auto"
  const dir = opts.dir ?? dirname(plan.path)
  // 判定会话重验后固定执行指定脚本路径,不再按 verify 字段重新解析——wrapped
  // 分支每次 resolve 都会重新包装,覆盖掉替换产物。
  const replacement = join(verifyTmpDir(dir), "verify.sh")
  let replaced = resume?.replaced === true
  // 恢复用的运行记录(仅首轮消费): 脚本上次已执行完毕且有持久化记录时不重跑。
  // stage = fix 的修复轮中断不走直判(run 属上一轮已判定记录),由 pendingFix 接管。
  let pending = resume?.run && resume.stage !== "fix" ? resume : undefined
  // 修复轮中断恢复(仅首轮消费): fix 会话半途被中断,首轮凭持久化的差距原文重新
  // 下发修复提示续跑(执行链会话经 runTask 复用时上下文不丢),随后照常收尾与重验。
  let pendingFix = resume?.stage === "fix" && typeof resume.gap === "string" ? resume : undefined
  // 差距反馈回执行会话链修复 + 重新收尾(正常修复轮与中断恢复共用)。
  const fixRound = async (gap: string, round: number): Promise<UnitStop | undefined> => {
    const fixSubject = `${task.id} fix${round} ${task.title}`
    chain.subject = fixSubject
    // 修复轮无子任务序号(交接文档为任务级),但提交 stage 要跟着修复轮走。
    const fixed = await runExecSession(client, plan, task, renderFix(plan, task, gap, opts), opts, chain, undefined, undefined, `fix ${round}`)
    if (fixed.type === "blocked") return fixed
    // 任务级测试交接链随修复轮闭环整链清除(与 executeWhole/runSubtask 收口同口径):
    // 归档份已落账也必须删——留给下一轮修复/任务重跑会被恢复状态机误判为「已收口」
    // 的在途交接(无记录 + 归档已落账 = H3)。删除随下方统一提交落账。
    if (opts.testByDriver) {
      await removeHandoffChain(dir, taskDoc(task.id, "testhandoff"))
      await removeHandoffChain(dir, legacyTaskDoc(task.id, "testhandoff"))
    }
    const fixCommitted = await afterSession(dir, opts, task, { stage: `fix ${round}`, subject: fixSubject })
    if (fixCommitted.type === "failed") return commitBlocked(`${task.id} 修复轮 ${round}`, fixCommitted)
    if (opts.wrapup ?? true) {
      const stopped = await runWrapup(client, plan, task, opts, chain, { solo: mode !== "auto", label: "修复后收尾会话" })
      if (stopped) return stopped
    }
    return undefined
  }
  for (let round = resume?.round ?? 0, rechecks = resume?.rechecks ?? 0; ; ) {
    const counters = { round, rechecks, replaced }
    if (pendingFix) {
      // 中断恢复: 修复轮会话半途被中断,重新下发持久化的差距反馈续跑修复。
      const fix = pendingFix
      pendingFix = undefined
      log(`↻ ${task.id} 恢复中断: 验收修复轮(第 ${round}/${FIX_ROUNDS - 1} 轮)会话被中断,凭持久化的差距反馈续跑修复:\n${fix.gap}`)
      const blocked = await fixRound(fix.gap!, round)
      if (blocked) return blocked
    }
    let execution: { type: "ok"; run: VerifyRun; audit?: Verdict } | UnitStop
    if (pending?.run) {
      // 中断恢复: 脚本已执行完毕且运行记录已持久化——不重跑脚本;early 且审核
      // 结论缺失时先补跑审核会话,然后直接进入判定。
      let auditVerdict: (typeof pending.audit) | undefined = pending.audit
      if (!auditVerdict && audit) {
        const fresh = await audit()
        if (fresh.type === "blocked" || fresh.type === "dirty") return fresh
        auditVerdict = fresh
      }
      log(`↻ ${task.id} 恢复中断: verify 脚本上次已执行完毕(${pending.run.script}),直接进入判定`)
      execution = { type: "ok", run: pending.run, audit: auditVerdict }
    } else {
      execution = await executeVerifyScript(client, plan, task, opts, audit, replaced ? replacement : undefined, persist, counters)
    }
    pending = undefined
    if (execution.type === "blocked" || execution.type === "dirty") return execution
    await persist?.({ kind: "verify", stage: "judge", ...counters, run: execution.run, audit: execution.audit })
    // 引用门禁(stable-refs P4,D6 第三层): 判定会话前对任务产物文档(docs/
    // T-NNN/**)做确定性预扫——失效引用 = 差距,直接进修复轮、不消耗判定会话;
    // 修复轮语义与判定差距一致(off 模式回退 pending,耗尽阻塞退出 2)。verify
    // 未启用时无任务级验收,门禁不存在(退化为提交时 auto-correct 的 ⚠ 日志)。
    // 受 OPENCODE_AUTO_REF_CHECK 管控(refcheck-scope-design D3,缺省 off 空转)。
    const refGap = await gatedTaskRefGap(dir, task.id, autoSwitches().refCheck)
    if (refGap) {
      if (mode === "off") return { type: "gap", gap: refGap }
      round++
      if (round >= FIX_ROUNDS) {
        return { type: "blocked", question: `任务产物文档连续 ${FIX_ROUNDS} 轮修复仍存在失效引用:\n${refGap}` }
      }
      log(`↻ ${task.id} 任务产物文档存在失效引用,反馈回执行会话修复(第 ${round}/${FIX_ROUNDS - 1} 轮):\n${refGap}`)
      await persist?.({ kind: "verify", stage: "fix", round, rechecks, replaced, gap: refGap })
      const blocked = await fixRound(refGap, round)
      if (blocked) return blocked
      continue
    }
    const verdict = await judge(client, plan, task, opts, execution.run)
    if (verdict.type === "blocked" || verdict.type === "dirty") return verdict
    if (verdict.type === "pass") {
      await markDone(plan.path, task.id, verdict.command ?? verifyCommand(task) ?? execution.run.script)
      return { type: "done", audit: execution.audit }
    }
    // 判定会话认定脚本本身有问题并已替换: driver 重新执行替换脚本并再判定。
    if (verdict.type === "reverify") {
      if (!(await Bun.file(replacement).exists())) {
        return { type: "blocked", question: `判定会话结论为重验,但未写出替换脚本 ${replacement}:\n${verdict.gap}` }
      }
      rechecks++
      if (rechecks > REVERIFY_ROUNDS) {
        return { type: "blocked", question: `验证脚本经 ${REVERIFY_ROUNDS} 轮替换重验仍未通过:\n${verdict.gap}` }
      }
      log(`↻ ${task.id} 判定会话替换了验证脚本,重新执行并判定(第 ${rechecks}/${REVERIFY_ROUNDS} 轮):\n${verdict.gap}`)
      replaced = true
      continue
    }
    // off 模式不做修复重跑: 差距交回调用方(回退 pending,等人工改进后重试)。
    if (mode === "off") return { type: "gap", gap: verdict.gap }
    round++
    if (round >= FIX_ROUNDS) {
      return { type: "blocked", question: `任务级验收连续 ${FIX_ROUNDS} 轮未通过:\n${verdict.gap}` }
    }
    // 把判定会话的差距信息反馈回执行会话链,续跑修复后重新收尾与验收。
    log(`↻ ${task.id} 验收未通过,把审核差距反馈回执行会话续跑修复(第 ${round}/${FIX_ROUNDS - 1} 轮):\n${verdict.gap}`)
    // 修复轮进行中标记(stage=fix + 差距原文)先于 fix 会话持久化: 此刻中断,恢复时
    // 凭差距重新下发修复提示续跑(执行链会话复用时上下文不丢),而不是重走一轮判定。
    await persist?.({ kind: "verify", stage: "fix", round, rechecks, replaced, gap: verdict.gap })
    const blocked = await fixRound(verdict.gap, round)
    if (blocked) return blocked
  }
}

export type Verdict = { type: "pass"; command?: string } | { type: "gap"; gap: string } | { type: "reverify"; gap: string }

// Verify 前两段: resolveVerifyScript 判定来源(existing/wrapped 由 driver 直接
// 给出;自然语言或缺失先开一次性脚本生成旁路会话——generate 分支沿用约定名
// tmp/verify.sh,上一轮(或修复前)生成的脚本存在则复用,V1 不自动重新
// 生成),随后 runVerifyScript 在目标目录执行(进度看门狗: 持续无输出超过
// --verify-idle 才终止;--verify-max 另设绝对上限)并 log 一行结果。退出码非 0
// 不在此判定——判定权在判定会话。
// override: 重验轮由判定会话替换出的指定脚本,直接执行、跳过 resolve(wrapped
// 分支重新包装会覆盖掉替换产物)。
// persist: 阶段边界写进度记录——脚本执行完毕即持久化运行记录,此刻中断,恢复时
// 跳过执行直接进入判定会话(脚本可能很长)。
// --early 审核挂点(F.2 时序保证): generate 分支的脚本生成会话结束后才启动
// 审核会话,与脚本执行并行;脚本执行完毕先 join 审核(blocked 立即上抛),随后
// 才进入判定会话。每次脚本执行(含修复轮重跑)重开一次新审核。
async function executeVerifyScript(
  client: AgentClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  audit?: () => Promise<Verdict | UnitStop>,
  override?: string,
  persist?: (phase: Phase) => Promise<void>,
  counters: { round: number; rechecks: number; replaced: boolean } = { round: 0, rechecks: 0, replaced: false },
): Promise<{ type: "ok"; run: VerifyRun; audit?: Verdict } | UnitStop> {
  const dir = opts.dir ?? dirname(plan.path)
  const tmp = verifyTmpDir(dir)
  // generate 分支的脚本约定名:上一次(或上轮修复前)生成的脚本存在则复用。
  const script = join(tmp, "verify.sh")
  let path: string
  if (override) {
    path = override
  } else {
    await persist?.({ kind: "verify", stage: "generate", ...counters })
    const resolved = await resolveVerifyScript(task, dir)
    if (resolved.kind === "generate" && !(await Bun.file(script).exists())) {
      const failed = await generateScript(client, plan, task, opts, script)
      if (failed) return failed
    }
    path = resolved.kind === "generate" ? script : resolved.script
  }
  await persist?.({ kind: "verify", stage: "exec", ...counters })
  const auditing = audit?.()
  const outPath = join(tmp, "verify.out")
  const run = await runVerifyScript(dir, path, { idleMs: opts.idleMs, maxMs: opts.maxMs, out: outPath })
  log(
    `  ⚙ verify 脚本退出码 ${run.code}${run.timedOut ? `(超时终止: ${run.timeoutReason === "max" ? "超过绝对时长上限" : "持续无输出"})` : ""},耗时 ${run.ms}ms,输出: ${outPath}`,
  )
  const record: VerifyRun = {
    script: path,
    code: run.code,
    ms: run.ms,
    timedOut: run.timedOut,
    timeoutReason: run.timeoutReason,
    out: outPath,
  }
  // 脚本执行完毕即持久化运行记录(early 的审核结论由 verifyTask 在 join 后随
  // judge 阶段一并写入)。
  await persist?.({ kind: "verify", stage: "exec", ...counters, run: record })
  const audited = await auditing
  if (audited?.type === "blocked" || audited?.type === "dirty") return audited
  return { type: "ok", run: record, audit: audited }
}

// Verify 第三段: 独立判定旁路会话(一次性 chain,不进任务执行链),注入运行信息,
// 解析 VERDICT_FILE 结论;产出缺失的重试策略见 requireArtifact。
// 判定会话被授权把验证经验沉淀到后续未完成任务的 verify 字段(renderVerifyJudge
// 授权段): 会话期间临时放开 PLAN.md 写权限,结束后恢复并校验——解析失败或除
// verify 字段外的结构性内容(任务集合/状态/attempts/正文)被改动时,整体还原
// 会话前快照,越权编辑不被信任。
async function judge(
  client: AgentClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  run: VerifyRun,
): Promise<Verdict | UnitStop> {
  autobanner(`${task.id} ${task.title}: 验收判定`)
  const file = join(dirname(plan.path), VERDICT_FILE)
  const snapshot = await Bun.file(plan.path).text()
  await allowWrite(plan.path)
  try {
    // 重新加载计划: 此前轮次的判定会话可能已更新后续任务的 verify 字段。
    return await requireArtifact(client, task, renderVerifyJudge(await load(plan.path), task, run, opts), opts, {
      kind: "审核",
      role: "verify-judge",
      artifact: `有效判定文件 ${VERDICT_FILE}`,
      detail: "缺失或无结论行",
      requirement: "无论审核结论如何,都必须写出该文件,且最后一行为 `结论: 通过`、`结论: 差距 <描述>` 或 `结论: 重验 <原因>`(替换指定验证脚本后交 DRIVER 重新执行)。",
      commit: { stage: "verify-judge", subject: `${task.id} judge ${task.title}` },
      reset: () => rm(file, { force: true }),
      collect: async () => parseVerdict(await Bun.file(file).text().catch(() => "")),
    })
  } finally {
    await checkPlanEdit(plan.path, snapshot)
    await reprotect(plan.path)
  }
}

// 校验判定会话对 PLAN.md 的编辑仅限授权范围(后续未完成任务的 verify 字段):
// 任务集合、状态、attempts 与正文(含检查项)任一变化或解析失败,即恢复会话前
// 快照并警告。verified/question 等其余字段不在授权内但也不做还原——它们由
// driver 在后续步骤统一重写,不会造成状态错乱。
async function checkPlanEdit(planFile: string, before: string) {
  const after = await Bun.file(planFile).text().catch(() => "")
  if (after === before) return
  const shape = (text: string) => parse(planFile, text).tasks.map((item) => `${item.id}|${item.status}|${item.attempts}|${item.body}`)
  try {
    if (JSON.stringify(shape(before)) === JSON.stringify(shape(after))) return
  } catch {
    // 解析失败按越权处理,走还原。
  }
  await allowWrite(planFile)
  await Bun.write(planFile, before)
  log(`⚠ 判定会话对 PLAN.md 的编辑超出授权(仅允许后续未完成任务的 verify 字段),已还原原内容`)
}

// Natural-language or missing verify: a one-shot side session writes the
// executable script (retry/blockage policy shared via requireArtifact).
async function generateScript(
  client: AgentClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  script: string,
): Promise<UnitStop | undefined> {
  autobanner(`${task.id} ${task.title}: 验收脚本生成`)
  const produced = await requireArtifact(client, task, renderVerifyScriptGen(plan, task, script, opts), opts, {
    kind: "脚本生成",
    role: "verify-generate",
    artifact: script,
    requirement: "必须把可执行脚本写到该路径并 chmod +x。",
    commit: { stage: "verify-script", subject: `${task.id} script ${task.title}` },
    collect: async () => (await Bun.file(script).exists()) || undefined,
  })
  if (produced !== true) return produced
  return undefined
}

// --review 质量审核(设计文档 B.2/B.3): 旁路审核会话产出 audit 报告,结论写
// REVIEW_FILE(协议同 VERDICT_FILE,复用 requireArtifact/parseVerdict 的重试
// 策略)。final = 当前任务之后全部任务已 done(或无后继),即本任务是最后一
// 个任务,审核升级为全计划终审。
// --early 下同一会话经挂点在 verify 脚本执行窗口并行启动(F.3): 提示词用
// early 措辞(静态审核脚本内容、以只读检查为主),横幅随窗口启动打印。
export async function reviewTask(
  client: AgentClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  early = false,
): Promise<Verdict | UnitStop> {
  // 重新加载计划判定 final: 串行路径下当前任务刚被 verifyTask 标 done;early
  // 窗口下审核先于 markDone 启动,但 final 只看后继任务,两者结论一致。
  const current = await load(plan.path)
  const index = current.tasks.findIndex((item) => item.id === task.id)
  const final = current.tasks.slice(index + 1).every((item) => item.status === "done")
  autobanner(`${task.id} ${task.title}: ${final ? "最终质量审核(全计划)" : "质量审核"}${early ? "(与 verify 脚本并行)" : ""}`)
  const file = join(dirname(plan.path), REVIEW_FILE)
  return requireArtifact(client, task, renderReview(current, task, { final, early, verify: opts.verify }), opts, {
    kind: "质量审核",
    role: "review-audit",
    artifact: `有效结论文件 ${REVIEW_FILE}`,
    detail: "缺失或无结论行",
    requirement: "无论审核结论如何,都必须写出该文件,且最后一行为 `结论: 通过` 或 `结论: 差距 <描述>`。",
    commit: { stage: "review", subject: final ? `${task.id} final ${task.title}` : `${task.id} review ${task.title}` },
    reset: () => rm(file, { force: true }),
    collect: async () => parseVerdict(await Bun.file(file).text().catch(() => "")),
  })
}

// 审核差距 → 旁路修复规划会话(设计文档 B.4): 产出 docs/<id>/fix.md 检查项,
// 调用方经 appendSubtasks 注入 PLAN.md,交既有子任务会话机制执行。
export async function planReviewFix(
  client: AgentClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  gap: string,
): Promise<{ type: "ok"; items: string[] } | UnitStop> {
  autobanner(`${task.id} ${task.title}: 审核修复规划`)
  // 修复检查项文件(目录化布局): reset/collect 同一目标;collect 读经 resolveTaskDoc
  // 回落旧平铺 docs/<id>.fix.md(中断恢复: 规划会话可能已写旧名文件)。
  const dir = dirname(plan.path)
  const file = join(dir, taskDoc(task.id, "fix"))
  const collected = await requireArtifact(client, task, renderReviewFix(plan, task, gap, opts), opts, {
    kind: "修复规划",
    role: "review-planfix",
    artifact: `有效修复检查项文件 ${taskDoc(task.id, "fix")}`,
    detail: "缺失或无检查项",
    requirement: "必须把修复检查项写入该文件(每条差距至少一项)。",
    commit: { stage: "review-fix", subject: `${task.id} planfix ${task.title}` },
    reset: () => rm(file, { force: true }),
    collect: async () => {
      const items = subtasks(await Bun.file(join(dir, await resolveTaskDoc(dir, task.id, "fix"))).text().catch(() => ""))
      return items.length ? items.map((item) => item.text) : undefined
    },
  })
  if (!Array.isArray(collected)) return collected
  return { type: "ok", items: collected }
}

// 判定/审核文件的结论行(协议要求为最后一行): 结论: 通过 | 差距 <描述> | 重验
// <原因>。取最后一个结论行、行首锚定、`通过` 须整值相等——全文首个匹配会把正文里
// 引用判定标准的字样(如"结论: 通过标准是…")误判为通过(口径对齐 final.ts
// parseConclusion)。结论行存在但取值非法返回 undefined(进重试环),不再向下扫描
// 更早的结论行。
export function parseVerdict(text: string): Verdict | undefined {
  const lines = text.trimEnd().split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim()
    if (!/^结论[:：]/.test(line)) continue
    const value = line.replace(/^结论[:：]\s*/, "").trim()
    if (value === "通过") {
      return { type: "pass", command: /^verified-command:\s*(.+)$/m.exec(text)?.[1]?.trim() }
    }
    // 重验: 判定会话认定脚本本身有问题并已替换指定脚本,driver 重新执行后再判定。
    if (value.startsWith("重验")) return { type: "reverify", gap: value.replace(/^重验[:：]?\s*/, "").trim() }
    if (value.startsWith("差距")) return { type: "gap", gap: value.replace(/^差距[:：]?\s*/, "").trim() }
    return undefined
  }
  return undefined
}

// 阶段循环(--phases): 阶段规划会话(planPhase)、阶段交接(handoverPhase + 步进包装
// handoverWithStep)与阶段路由主循环(runPhaseLoop),runAll 原闭包转顶层函数,捕获量
// 显式化为 LoopCtx(定义在 ./loop-task)。
// 拆分自 src/loop.ts(plans/0024-module-split-plan.md S16,纯搬运)。不依赖 loop.ts。
import { mkdir, rm, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { requireArtifact } from "./artifact"
import { phaseCloseLines, phaseResolveLines, roundCompleteLines, roundResolveLines } from "./conclusion"
import { validHandover } from "./document/roles"
import { maybeExit } from "./exit"
import { clearSticky, consumeFailback } from "./failback"
import { commitPending, commitTree } from "./git"
import { hibernatePause } from "./hibernate"
import { extractKnowledge, priorKnowledgeDigest } from "./knowledge"
import { banner, log } from "./log"
import { runTaskLoop, type LoopCtx } from "./loop-task"
import { advanceNextTask, ensureNumbering, NEXT_TASK_FILE, taskNumber } from "./numbering"
import {
  appendLedger,
  currentRound,
  handoverDoc,
  phaseArchive,
  phaseText,
  prevRoundDigest,
  readLedger,
  renderPlanScaffold,
  routePhase,
  type Phase,
} from "./phases"
import { load } from "./plan"
import { phaseTypeOfLetter } from "./phases/registry"
import { renderPhaseHandover, renderPhasePlan } from "./prompt"
import { allowWrite, reprotect } from "./protect"
import { closeStep, openStep } from "./resume"
import { statsPhase } from "./stats"
import { stepPause } from "./step"

// 阶段规划会话(E 节): 旁路一次性,复用 requireArtifact 骨架,产物 = 直接编辑
// 填充的 PLAN.md——会话被 driver 专门授权写它(临时放行写权限,其余状态文件
// 仍只读)。伪任务 PLAN 不进任务链、不写进度记录。返回 0 = 规划完成。
export async function planPhase(ctx: LoopCtx, phase: Phase): Promise<number> {
  const { directory, path, opts, server: serverHandle, agentName, phases, repl } = ctx
  // 自动编号(config.autoNumber): 规划会话的编号起点来自 .auto/next-task
  // 记录;记录缺失先恢复(无历史证据直接写 1,有证据开 AI 推导会话,见
  // src/numbering.ts),恢复受阻即退出 2。恢复会话本身会产生一次统一提交
  // (stage=numbering),先于规划会话。
  let numberStart: number | undefined
  if (opts.autoNumber) {
    const numbering = await ensureNumbering(serverHandle.client, directory, {
      agent: agentName,
      dir: directory,
      verbose: opts.verbose,
      waitAnswer: opts.waitAnswer,
      commit: opts.commit,
      contextLimit: opts.contextLimit,
      permission: opts.permission,
      interactive: repl,
      server: serverHandle,
      mode: opts.mode,
    })
    if (numbering.type === "dirty") {
      log(`⏸ worktree not clean before restoring the numbering record; handle it manually (commit/clean) and re-run:`)
      for (const file of numbering.files) log(`  ${file}`)
      return 2
    }
    if (numbering.type === "blocked") {
      log(`⏸ numbering-record restore session blocked (implicit block, investigate and re-run):\n${numbering.question}`)
      return 2
    }
    numberStart = numbering.next
  }
  const brief = await Bun.file(join(directory, ".opencode", "auto", "brief.md")).text().catch(() => undefined)
  // 前序阶段交接注入(E 节注入纪律): 只注入 handover 蒸馏产物,不注入前序
  // 原始 docs/。台账中早于当前阶段且已 done 的各阶段逐个拼接;交接文档为永久
  // 路径(新布局轮内 docs/R-NN/handovers/,旧布局 docs/handovers/R<N>-…,
  // handoverDoc 按布局解析),P2 前完成的阶段落在阶段归档目录内(读回落);
  // 缺 handover 的阶段在清单中标注"(无交接文档)"。
  const declared = [...phases] as Phase[]
  const ledger = await readLedger(directory)
  const round = await currentRound(directory)
  const handovers = (
    await Promise.all(
      declared
        .slice(0, declared.indexOf(phase))
        .filter((letter) => ledger.done.includes(letter))
        .map(async (letter) => {
          const modern = await handoverDoc(directory, round, letter)
          const text =
            (await Bun.file(join(directory, modern)).text().catch(() => undefined)) ??
            (await Bun.file(join(directory, await phaseArchive(directory, round, letter), "handover.md")).text().catch(() => undefined))
          return [`### ${letter} ${phaseText(letter)}(${modern})`, "", text?.trim() || "(无交接文档)"].join("\n")
        }),
    )
  ).join("\n\n")
  // 本轮首个规划会话的额外注入(台账为空时): ① 前置知识(外壳启动时的已有
  // 迁移结果蒸馏,docs/prior-kb/,见 src/knowledge.ts);② 上一轮结论(轮次
  // 归档存在时,plans/0006-phases-design.md M 节)。后续阶段照常走 handovers 蒸馏链,
  // 不重复注入。
  let prevRound: string | undefined
  if (!ledger.done.length) {
    const parts = [await priorKnowledgeDigest(directory), await prevRoundDigest(directory)].filter((part): part is string => Boolean(part?.trim()))
    prevRound = parts.length ? parts.join("\n\n") : undefined
    if (prevRound) log("ℹ injecting prior migration conclusions (prior knowledge + previous round's archive excerpts)")
  }
  log("▶ starting the phase planning session to fill PLAN.md")
  await allowWrite(path)
  try {
    const planned = await requireArtifact(
      serverHandle.client,
      { id: "PLAN", title: `阶段规划(${phase} ${phaseText(phase)})`, status: "in_progress", attempts: 0, body: "" },
      renderPhasePlan({
        phase,
        brief,
        handovers,
        prevRound,
        source: opts.source,
        destDir: opts.destDir,
        mode: opts.mode,
        // 生效 phases 经 --phases 裁剪(无独立 a/d 阶段)→ m 阶段规划注入裁剪注记
        trimmedPhases: !phases.includes("a") && !phases.includes("d"),
        numberStart,
      }),
      {
        agent: agentName,
        dir: directory,
        verbose: opts.verbose,
        waitAnswer: opts.waitAnswer,
        commit: opts.commit,
        contextLimit: opts.contextLimit,
        permission: opts.permission,
        interactive: repl,
        server: serverHandle,
        mode: opts.mode,
      },
      {
        kind: "阶段规划",
        step: { step: "phase-plan", letter: phase },
        // 独立隐藏任务单元: 启动 clean 门禁 + SHA 基线 + 收口校验
        // (plans/0021-commit-boundary-design.md;PLAN.md 遗留由 beginUnit carryover 自愈)。
        unitStart: true,
        artifact: "已填充的 PLAN.md(至少一个任务)",
        detail: "缺失、无任务、任务格式无法解析或任务编号复用了已占用的编号",
        requirement:
          "必须直接编辑 PLAN.md,把本阶段任务按 `## T-NNN: <任务标题> [pending]` 格式写入" +
          "(至少一个;即使认为本阶段无事可做,也要写入一个说明性任务并在正文说明原因)。" +
          (numberStart === undefined
            ? ""
            : `任务编号必须自 T-${String(numberStart).padStart(3, "0")} 起连续递增——更早的编号已被历史任务占用,复用视为无效产出。`),
        commit: { stage: "phase-plan", subject: `PLAN plan ${phase} ${phaseText(phase)}` },
        reset: async () => {
          await Bun.write(path, renderPlanScaffold())
        },
        collect: async () => {
          const fresh = await load(path).catch(() => undefined)
          if (!fresh?.tasks.length) return undefined
          // 自动编号: 复用已占用编号(小于记录起点)视为无效产出,带反馈重试。
          if (numberStart !== undefined && fresh.tasks.some((task) => (taskNumber(task.id) ?? numberStart) < numberStart)) return undefined
          return fresh.tasks.length
        },
      },
    )
    if (typeof planned !== "number") {
      if (planned.type === "dirty") {
        log(`⏸ worktree not clean before starting the phase planning session; handle it manually (commit/clean) and re-run:`)
        for (const file of planned.files) log(`  ${file}`)
      } else {
        log(`⏸ phase planning session blocked (implicit block, investigate and re-run):\n${planned.question}`)
      }
      return 2
    }
    // 自动编号: 规划成功即把编号记录推进到本次最大编号 + 1(只增不减),
    // 后续阶段/轮次的规划会话自该记录续接,编号在目标目录永不重复。
    if (numberStart !== undefined) {
      const next = await advanceNextTask(directory, (await load(path)).tasks.map((task) => task.id))
      log(`✓ numbering record advanced: next available task number T-${String(next).padStart(3, "0")}(${NEXT_TASK_FILE})`)
    }
    log(`✓ phase planning complete: PLAN.md filled with ${planned} task(s)`)
    // 收口: 删除本步骤的 driver 侧恢复点(产物已校验、提交与编号推进均完成)。
    // 在此之前被 kill → 记录仍 active,下次运行经 openStep 重入规划并复用会话。
    await closeStep(directory, "phase-plan", phase)
    return 0
  } finally {
    await reprotect(path)
  }
}

// 阶段交接(F 节,轮次专用目录方案起 docs 永不移动): ① 蒸馏会话(AI 唯一职责,
// 旁路一次性)产出永久路径交接文档(新布局轮内 docs/R-NN/handovers/<字母>-
// <slug>.md,driver 先建目录,落定不移动)→ ② PLAN.md 拷贝进阶段归档目录后
// 重置空模板(归档只收过期状态文件,本阶段 docs/ 产物不动)→ ③ 台账追加 →
// ④ 统一提交(Auto-Stage: phase-transition)。各步幂等,中断重跑自然续完
// (C.2)。返回 0 = 交接完成,2 = 蒸馏会话隐性阻塞。
export async function handoverPhase(ctx: LoopCtx, phase: Phase): Promise<number> {
  const { directory, path, opts, server: serverHandle, agentName, phases, repl } = ctx
  const letters = [...phases] as Phase[]
  const nextLetter = letters[letters.indexOf(phase) + 1]
  const next = nextLetter ? `${nextLetter} ${phaseText(nextLetter)}` : undefined
  const target = next ?? "flow complete"
  banner(`phase handover: ${phase} ${phaseText(phase)} → ${target}`)
  // driver 先建 handovers/ 目录再开会话;handoverDoc 不在 protect 名单,无需 allowWrite。
  const round = await currentRound(directory)
  const handover = await handoverDoc(directory, round, phase)
  const handoverFile = join(directory, handover)
  await mkdir(dirname(handoverFile), { recursive: true })
  // 蒸馏幂等跳过 + ③ 补提交(plans/0021-commit-boundary-design.md P4): 交接文档已齐备
  // (四小节经 validHandover 校验)时不再重开蒸馏会话——上次中断在"蒸馏已产出、
  // driver 未收口"区间的现场直接续跑归档/台账;文档仍在未提交清单则先补提交
  // (产物落盘且已提交才算完成)。部分写就(小节不全)照常走蒸馏: reset 清文件
  // 重来,step 恢复点(openStep)仍可复用原会话续写。
  const distillTask = { id: "PLAN", title: `阶段交接蒸馏(${phase} ${phaseText(phase)})`, status: "in_progress" as const, attempts: 0, body: "" }
  const distillCommit = { stage: "phase-handover", subject: `PLAN handover ${phase} ${phaseText(phase)}` }
  if (validHandover(await Bun.file(handoverFile).text().catch(() => ""))) {
    const pending = await commitPending(directory, opts, distillTask, distillCommit, [handover])
    if (pending !== "clean") {
      if (!pending.ok) {
        log(`⏸ handover document make-up commit failed: ${pending.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}, handle it manually and re-run`)
        return 2
      }
      log(`✓ handover document produced but not yet committed; make-up commit done: ${handover}`)
    }
    log(`↻ handover document ${handover} is complete; skipping the distillation session, going straight to archiving`)
  } else {
    log(`▶ starting the handover distillation session to produce ${handover}`)
    const distilled = await requireArtifact(
      serverHandle.client,
      distillTask,
      renderPhaseHandover({ phase, handover, next }),
      {
        agent: agentName,
        dir: directory,
        verbose: opts.verbose,
        waitAnswer: opts.waitAnswer,
        commit: opts.commit,
        contextLimit: opts.contextLimit,
        permission: opts.permission,
        interactive: repl,
        server: serverHandle,
      },
      {
        kind: "交接蒸馏",
        step: { step: "phase-handover", letter: phase },
        // 独立隐藏任务单元: 启动 clean 门禁 + SHA 基线 + 收口校验
        // (plans/0021-commit-boundary-design.md;部分写就的交接文档由 reset 清理重写)。
        unitStart: true,
        artifact: `有效交接文档 ${handover}(四个必备小节齐备)`,
        detail: "缺失或小节不全",
        requirement:
          `必须把交接文档写入 ${handover},并包含标题逐字为` +
          "「## 关键决策」「## 约束与坑」「## 下一阶段必读清单」「## 产物索引」的四个小节。",
        commit: distillCommit,
        reset: () => rm(handoverFile, { force: true }),
        collect: async () => {
          const text = await Bun.file(handoverFile).text().catch(() => "")
          return validHandover(text) || undefined
        },
      },
    )
    if (distilled !== true) {
      if (distilled.type === "dirty") {
        log(`⏸ worktree not clean before starting the handover distillation session; handle it manually (commit/clean) and re-run:`)
        for (const file of distilled.files) log(`  ${file}`)
      } else {
        log(`⏸ handover distillation session blocked (implicit block, investigate and re-run):\n${distilled.question}`)
      }
      return 2
    }
  }
  // 收口: 蒸馏会话(本步骤唯一的 AI 环节)已产出有效交接文档并提交,删除 driver
  // 侧恢复点。其后的归档/重置/台账为幂等的 driver 记账,中断由 runPhaseLoop 的
  // "交接中断恢复"(归档 PLAN 已在而台账缺行)兜底,不再依赖会话恢复。
  await closeStep(directory, "phase-handover", phase)
  const archivedPlan = join(directory, await phaseArchive(directory, round, phase), "PLAN.md")
  await mkdir(dirname(archivedPlan), { recursive: true })
  await Bun.write(archivedPlan, await Bun.file(path).text())
  await allowWrite(path)
  await Bun.write(path, renderPlanScaffold())
  await reprotect(path)
  log("  this phase's PLAN.md archived; PLAN.md reset to the empty template")
  await appendLedger(directory, phase)
  // AGENTS.md 只校验不改写(F.2): 超 150 行在交接提交信息与终端 note 提示人工精简。
  const agentsLines = (await Bun.file(join(directory, "AGENTS.md")).text().catch(() => "")).trimEnd().split("\n").length
  const fat = agentsLines > 150 ? `AGENTS.md is ${agentsLines} lines, over the 150-line limit; trim it manually` : undefined
  if (fat) log(`ℹ ${fat}`)
  if (opts.commit !== false) {
    // 交接提交是阶段单元的收口落账(归档/重置/台账),提交失败 → 阻塞退出 2
    // 交人工: 台账已追加,重跑会按台账路由到下一阶段,遗留未提交改动由人工
    // 处置后继续(plans/0021-commit-boundary-design.md P3)。
    const settled = await commitTree(directory, { id: "PLAN", title: `phase handover (${phase} ${phaseText(phase)})` }, {
      stage: "phase-transition",
      subject: `PLAN transition ${phase} ${phaseText(phase)} → ${target}${fat ? `(${fat})` : ""}`,
    })
    if (!settled.ok) {
      log(
        `⏸ phase handover commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. ` +
          `The archive/ledger changes are kept in the worktree (ledger already appended); commit manually and re-run`,
      )
      return 2
    }
  }
  // 阶段代答汇总(plans/0020-auto-resolve-design.md §H-③,H6): 置顶于 ■ 收口行之前。
  for (const line of await phaseResolveLines(directory, phase)) log(line)
  // 阶段收口行(STATS_PLAN §4.3,T-006): commitTree 之后、return 0 之前——
  // 交接提交时长仍计入本阶段桶(读数实时外推,含当前开放段)。
  const closing = await phaseCloseLines(directory, phase)
  if (closing) for (const line of closing) log(line)
  return 0
}

// --phases 阶段循环(D.1): 推导 currentPhase → PLAN.md 空则开规划会话 → 主循环
// 执行 → 本阶段任务全 done 交接 → 台账追加推导下一阶段;全部阶段完成退出 0。
// 台账非法等环境错误退出 1(H 节)。
// 步进暂停(phase 边界,OPENCODE_AUTO_STEP ≥ phase): 交接(归档+台账+提交)
// 完成后、下一轮路由前硬暂停——最后一个阶段暂停后回车即「全部阶段已完成」退出。
export async function handoverWithStep(ctx: LoopCtx, phase: Phase): Promise<number> {
  const { directory, repl } = ctx
  const code = await handoverPhase(ctx, phase)
  if (code !== 0) return code
  await stepPause("phase", `phase ${phase} ${phaseText(phase)} handover`, { interactive: repl, dir: directory })
  maybeExit("phase", `phase ${phase} ${phaseText(phase)} handover`)
  // Hibernate window (phase boundary, OPENCODE_AUTO_HIBERNATE): a safe spot to
  // check after the handover (archive+ledger+commit) completes; sleep until
  // wake inside the window before entering the next phase
  // (plans/0027-hibernate-design.md).
  await hibernatePause(`phase ${phase} ${phaseText(phase)} handover boundary`, { dir: directory })
  // failback 回试(phase 边界): 所有粒度都在阶段边界重置——phase 粒度的跨任务
  // sticky holder 在此清零;/failback 请求同点消费。
  clearSticky()
  consumeFailback()
  return 0
}

export async function runPhaseLoop(ctx: LoopCtx): Promise<number> {
  const { directory, path, opts, server: serverHandle, agentName, phases, repl } = ctx
  for (;;) {
    const route = await routePhase(directory, await load(path), phases)
    if (route.type === "blocked") {
      log(`⏸ phase flow blocked: ${route.reason}`)
      return 1
    }
    if (route.type === "complete") {
      log("✓ all phases complete")
      for (const line of await roundResolveLines(directory)) log(line)
      // 轮次完成行(STATS_PLAN §4.4,T-006): 阶段数取台账 done 计数(本轮已
      // 交接阶段);历轮累计段在 history.rounds > 0 时由构造函数自行追加。
      const lines = await roundCompleteLines(directory, { phaseCount: (await readLedger(directory)).done.length })
      if (lines) for (const line of lines) log(line)
      return 0
    }
    // 阶段切换挂点(STATS_PLAN §3): 字母变化重置 phase 桶;相同字母幂等。
    // blocked 已 return、complete 即将退出,均无需切换。
    await statsPhase(directory, route.phase)
    // 会话恢复优先于文件推导路由(plans/0018-session-resume-precedence-design.md):
    // driver 侧仍有未收口的阶段步骤恢复点(上次运行的规划/交接会话被中断、driver
    // 未完成收口)→ 重入该步骤并复用中断的会话,即使 PLAN.md/台账已让文件推导路由
    // 前进。PLAN.md 任务与交接文档是 AI 写的(或会话中断后才由 driver 补的),不能
    // 证明会话已收口;唯有 driver 的恢复点被 closeStep 删除才算收口。仅当步骤归属
    // 阶段 == 当前路由阶段且该阶段未入台账时生效: 字母不一致(人工回退/陈旧记录)
    // 让文件路由优先并告警,阶段已入台账则清除陈旧记录。
    const open = await openStep(directory)
    if (open) {
      const ledger = await readLedger(directory)
      if (ledger.done.includes(open.letter)) {
        await closeStep(directory, open.step, open.letter)
      } else if (open.letter === route.phase) {
        log(
          `↻ session resume point takes precedence: the ${open.step === "phase-plan" ? "phase planning" : "phase handover"} session` +
            `(${open.letter} ${phaseText(open.letter)}) was not closed out; re-entering that step to continue`,
        )
        if (open.step === "phase-plan") {
          banner(`${open.letter} ${phaseText(open.letter)} phase planning`)
          const code = await planPhase(ctx, open.letter)
          if (code !== 0) return code
          continue
        }
        // 交接重入仅当文件路由也是 handover(本阶段任务全部 done): 否则(尚有
        // 未完成任务的异常态)归档+重置会丢未完成任务,让文件路由优先并告警。
        if (route.type === "handover") {
          const code = await handoverWithStep(ctx, open.letter)
          if (code !== 0) return code
          continue
        }
        log(
          `⚠ unclosed handover resume point (${open.letter}) is inconsistent with the current route (${route.type})` +
            `(unfinished tasks remain?); continuing with the file-derived route, not re-entering the handover to avoid losing unfinished tasks`,
        )
      } else {
        log(
          `⚠ unclosed phase-step resume point (${open.step} ${open.letter}) is inconsistent with the current route phase (${route.phase}); ` +
            `continuing with the file-derived route (ignore if this was a manual rollback; otherwise check .auto/progress.json)`,
        )
      }
    }
    if (route.type === "plan") {
      // 交接中断恢复(C.2 幂等性): 归档目录内已有归档 PLAN.md 而台账未记录 =
      // 交接在"重置 PLAN.md 之后、台账追加之前"中断——补写台账并提交,不重新
      // 规划本阶段(更早中断时 PLAN.md 仍有任务,路由为 handover,完整重跑交接)。
      const interrupted =
        (await stat(join(directory, await phaseArchive(directory, await currentRound(directory), route.phase), "PLAN.md")).then(() => true, () => false)) &&
        !(await readLedger(directory)).done.includes(route.phase)
      if (interrupted) {
        log(`↻ resume after interruption: ${route.phase} ${phaseText(route.phase)} phase handover already archived and reset; appending the ledger entry, then moving to the next phase`)
        await appendLedger(directory, route.phase)
        if (opts.commit !== false) {
          await commitTree(directory, { id: "PLAN", title: `phase handover (${route.phase} ${phaseText(route.phase)})` }, {
            stage: "phase-transition",
            subject: `PLAN transition ${route.phase} ${phaseText(route.phase)}(interruption recovery make-up)`,
          })
        }
        continue
      }
      // k(知识提炼)阶段整体认领 --extract-knowledge 设计(P4): 不开规划会话、
      // 不向 PLAN.md 填任务——plan 路由直接进入知识提取旁路会话(产物为永久路径:
      // 新布局轮内 docs/R-NN/migration-kb.md,旧布局 docs/migration-kb/R<N>-…;
      // 本轮文档已产出则幂等跳过),随后照常交接。提取失败只打 ⚠ 警告、不污染
      // 退出码(迁移成功不被文档生成失败反向污染);人工在 k 阶段自行向 PLAN.md
      // 填任务时走通用 execute/handover 路由,提取挂点不触发。
      // 判据为注册表 hasTasks: false(M3.2);直连会话本身仍是知识提取专属——
      // 内置类型中仅 knowledge 无任务,自定义类型(M3.6)接入时再泛化会话选择。
      if (!phaseTypeOfLetter(route.phase).hasTasks) {
        banner("k knowledge distillation: migration knowledge capture")
        const extracted = await extractKnowledge(serverHandle.client, directory, {
          agent: agentName,
          dir: directory,
          verbose: opts.verbose,
          waitAnswer: opts.waitAnswer,
          commit: opts.commit,
          contextLimit: opts.contextLimit,
          permission: opts.permission,
          interactive: repl,
          server: serverHandle,
          mode: opts.mode,
        })
        if (extracted.type === "ok") log(`✓ migration knowledge document produced: ${extracted.file}`)
        else if (extracted.type === "skipped") log(`↻ migration knowledge document already produced (${extracted.file}); skipping extraction, going straight to handover`)
        else if (extracted.type === "dirty") {
          // dirty (plans/0021-commit-boundary-design.md ④ generalization): an
          // unclean worktree (leftover from an abandoned extraction, make-up
          // commit failure or unified commit failure) must stop for the
          // human — handing over anyway would start the next unit on an
          // unclean baseline, breaking the commit boundary.
          log(`⏸ migration knowledge extraction could not complete or post on a clean baseline; handle it manually (commit/clean) and re-run:`)
          for (const file of extracted.files) log(`  ${file}`)
          return 2
        } else {
          log(
            `⚠ migration knowledge capture incomplete (knowledge_extraction_error); exit code unaffected, the k phase hands over as usual; ` +
              `fix the issue, then retry separately per the manual rollback procedure (delete this round's k ledger line and this round's migration knowledge document). Block details:\n${extracted.question}`,
          )
        }
        const code = await handoverWithStep(ctx, "k")
        if (code !== 0) return code
        continue
      }
      banner(`${route.phase} ${phaseText(route.phase)} phase planning`)
      const code = await planPhase(ctx, route.phase)
      if (code !== 0) return code
      continue
    }
    if (route.type === "execute") {
      const code = await runTaskLoop(ctx, route.phase)
      if (code !== 0) return code
      continue
    }
    const code = await handoverWithStep(ctx, route.phase)
    if (code !== 0) return code
  }
}

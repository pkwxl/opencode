// runAll 的运行前预检: PLAN.md 存在性、提示词库装载、agent 契约完整性检查、统计装载与
// 进度心跳、driver 状态文件只读、交接文档复原、启动 clean 门禁、中断状态复位、
// AGENTS.md/.gitignore 收口与 housekeeping 提交;另承接 runAll 的选项类型 RunAllOpts 与
// agent 契约渲染(docs/phases-design.md、docs/commit-boundary-design.md P3)。
// 出口以 { exit } 回传、由 runAll 直接 return,不在此 process.exit;出口位于 runAll 的
// try 之前、不经其 finally(docs/module-split-plan.md §I D13)。不依赖 loop.ts。
// 拆分自 src/loop.ts(docs/module-split-plan.md S14,纯搬运)。
import { join } from "node:path"
import { ensurePointer } from "./agents-block"
import { resumeBanner } from "./conclusion"
import { beginUnit, changedFiles, commitTree } from "./git"
import { ensureGitignore } from "./gitignore"
import { log } from "./log"
import { trackSubtasks, watchFiles } from "./loop-progress"
import type { ModeSpec } from "./mode"
import type { PermissionMode, SubtaskMode } from "./opts"
import { load, resetInProgress, setStatus } from "./plan"
import { protect } from "./protect"
import { peekProgress } from "./resume"
import type { ServerHandle } from "./server"
import { shellProfile } from "./shell"
import { loadStats } from "./stats"
import { renderText, usePromptLibrary } from "./template"
import { restoreTestHandoffs } from "./testrun"
import templateAgent from "../templates/.opencode/agent/auto.md" with { type: "file" }

export type RunAllOpts = {
  agent?: string
  server?: string
  verbose?: boolean
  waitAnswer?: number
  // 任务间暂停等待人工的分钟数(0 = 不等待);回车立即继续,超时自动继续。
  waitBetween?: number
  // --commit false: 关闭会话后统一提交(缺省启用;提交机制见 src/git.ts)。
  commit?: boolean
  subtask?: SubtaskMode
  // dryrun: 只跑一次权限预检会话并输出报告,不执行任何任务。
  dryrun?: boolean
  // 上下文预算基线(tokens;会话复用的已用量阈值为其一半),缺省由 runner 按 64k 处理。
  contextLimit?: number
  // --review 质量审核轮数上限(0 = 不启用),透传给 runTask。
  review?: number
  // --verify: 启用 driver 的任务级三段式验收(缺省不启用,任务收尾后直接标
  // done),透传给 runTask。
  verify?: boolean
  // --early: 审核会话与 driver 执行 verify 脚本并行(需 review 已启用),透传给
  // runTask;窗口时序见设计文档 F 节。
  early?: boolean
  // --permission: 权限请求的处理策略(缺省 ask-deny),透传给 runner 的会话监听。
  permission?: PermissionMode
  // --interactive: 常驻 stdin 旁路接收人工输入注入当前会话(与 --verbose 互斥,
  // 终端明细静默,日志文件保持完整记录)。
  interactive?: boolean
  // driver 托管脚本(verify 与 test)的看门狗: 持续无输出的判定窗口与绝对时长
  // 上限(毫秒),透传给 runner 的 runVerifyScript(config 的 idleTime / idleMax
  // 以分钟设定)。
  idleMs?: number
  maxMs?: number
  // --test-by-driver: 测试执行协议(与 verify 正交)——执行类会话把测试脚本写入
  // tmp/test.sh 由 driver 执行,输出反馈回会话;--handover-test: 测试失败且上下文
  // 达上限时交接新会话续跑。均透传给 runTask。
  testByDriver?: boolean
  handoverTest?: boolean
  // -m/--mode 场景模式(缺省 migrate),透传给 runTask 的提示词渲染。
  mode?: ModeSpec
  // --final-review 终审闭环的审计轮上限(0 = 不启用,含首轮 audit): 任务全部
  // 完成后按 docs/mode-final-review-design.md B/C 节推进——终审阶段是入
  // PLAN.md 的 T-F 真任务,本循环只做"生成任务 → 跑任务 → 解析报告路由"。
  finalReview?: number
  // --phases 阶段化流程(设计文档 docs/phases-design.md,来自配置): "m"(缺省)=
  // 无阶段声明,走既有单次运行路径(零改动);其余值启用阶段循环(D 节)——
  // 推导当前阶段 → 规划会话填充 PLAN.md → 主循环执行 → 交接(归档+重置+台账+
  // 提交)→ 下一阶段。--final-review 仅 m(迁移实现)阶段挂接。
  phases?: string
  // config.source 迁移源参数(可选),注入阶段规划会话。
  source?: { dir: string; path: string }
  // config.destDir 迁移目标目录(可选,相对工作目录),注入阶段规划会话——
  // driver 流程文件与迁移产出经它隔离。
  destDir?: string
  // 调用方已托管的 server 句柄(外壳的前置会话与主循环共用一个实例): 提供
  // 时不再自行 manage/close,生命周期归调用方。
  managed?: ServerHandle
  // --new-session: 中断恢复时跳过会话复用(仅放弃旧会话上下文,阶段精确重入
  // 保留),透传给 runTask。
  newSession?: boolean
  // 自动编号(config.autoNumber): 任务编号在目标目录永不重复——阶段规划会话自
  // .auto/next-task 记录续接编号,记录缺失先经 AI 恢复会话推导恢复(见
  // src/numbering.ts)。
  autoNumber?: boolean
  // --no-wrapup(config.wrapup,缺省 true): 关闭任务收尾会话,透传给 runTask。
  wrapup?: boolean
}

// agent 契约渲染文本: 按 verify/testByDriver 两态渲染内置模板。外壳的契约维护
// 写入与 runAll 的完整性检查共用本函数,防止写入与比对口径漂移(模板含
// {{#if}} 条件块,拿原始文本比对渲染后的文件必然不一致)。
export async function renderAgentContract(verify: boolean, testByDriver: boolean): Promise<string> {
  return renderText(await Bun.file(templateAgent).text(), { verify, testByDriver })
}

// 预检段: 产出 runAll 后续仍用的 agentName 与两个计时器句柄(finally 中关闭);
// 报错出口回传 { exit },时序与副作用残留同搬运前(见文件头)。
export async function preflight(
  directory: string,
  path: string,
  opts: RunAllOpts,
): Promise<{ agentName: string; watcher?: { close(): void }; progress: { close(): void } } | { exit: number }> {
  if (!(await Bun.file(path).exists())) {
    log(`未找到计划文件: ${path}`)
    return { exit: 1 }
  }

  // 提示词库: 装载目标目录 .opencode/auto/prompts/ 覆盖(协议敏感模板做关键
  // 内容校验,失败按用法错误退出)。之后 render* 同步渲染,无需再感知目录。
  try {
    usePromptLibrary(directory)
  } catch (error) {
    log(error instanceof Error ? error.message : String(error))
    return { exit: 1 }
  }

  // --early 依赖 verify 脚本执行窗口;未启用 --verify 时窗口不存在,审核降级为串行。
  if (opts.early && !opts.verify) log("ℹ 未启用 --verify,--early 的并行审核窗口不存在,质量审核改为串行执行")

  // --agent 缺省取 auto 契约 agent(init 生成的自主执行契约);run 前完整性检查:
  // agent 契约文件缺失时服务端只回 UnknownError(不含根因),此处提前报出并按外壳
  // 画像提示恢复方式(src/shell.ts);与模板不一致仅警告。
  const agentName = opts.agent ?? "auto"
  const agentFile = join(directory, ".opencode/agent", `${agentName}.md`)
  const agentText = await Bun.file(agentFile).text().catch(() => undefined)
  const { program, bin, agentRecovery } = shellProfile()
  if (agentText === undefined) {
    log(`⏸ 缺少 agent 契约文件: .opencode/agent/${agentName}.md(缺失会导致下发任务失败: UnknownError)`)
    log(
      agentRecovery === "startup"
        ? `  恢复方式: 重新运行 ${program}(启动时会按模板重建默认契约),或手工补回该文件`
        : `  恢复方式: 运行 ${bin} init ${directory} 重建该文件(或手工补回),然后重新运行`,
    )
    return { exit: 1 }
  }
  // init 写入的是按当时 verify/testByDriver 渲染后的契约,比对须用当前配置同样
  // 渲染(与原始模板全文比对会因 {{#if}} 标记恒不一致,口径同 renderAgentContract)。
  if (agentName === "auto" && agentText !== (await renderAgentContract(Boolean(opts.verify), Boolean(opts.testByDriver)))) {
    log(
      `⚠ .opencode/agent/auto.md 与当前模板不一致(可能为旧版契约),` +
        (agentRecovery === "startup" ? `重新运行 ${program} 会按模板刷新` : `可运行 ${bin} init ${directory} 刷新`),
    )
  }

  const watcher = opts.verbose ? watchFiles(directory) : undefined
  // 统计装载(plans/STATS_PLAN.md §1): 读盘 → 折旧上一进程遗留段 → 轮次滚动 → 开
  // 本进程首段;有旧文档时打印续接横幅(§4.6)。必须先于 trackSubtasks(其心跳读
  // 数依赖已装载句柄与 statsTask 设定的桶身份)。
  const resumed = await loadStats(directory)
  if (resumed) log(resumeBanner(resumed))
  // 每 10 分钟上报当前任务的子任务进度与预计剩余时间(基于 PLAN.md 勾选状态)。
  const progress = trackSubtasks(path, directory)
  // Driver-owned files go read-only for the whole run; driver writes
  // re-apply it, and the finally below restores writability so a human can
  // edit the files (e.g. opencode.json after a permission block).
  await protect(directory)
  // 交接文档的现场复原(测试交接中断恢复 F3,docs/test-handover-early-design.md §I):
  // 必须早于启动 clean 门禁——上一次运行可能把已落账的在途交接文档删掉,那道删除
  // 本身就是脏区,门禁会在这里当场拦下整次运行。复原即消脏,随后的恢复状态机也
  // 才拿得到判定所需的文件。
  if (!opts.dryrun) await restoreTestHandoffs(directory)
  // 启动 clean 门禁(commit-boundary-design.md P3): 提交启用时要求工作区 clean——
  // 此后所有执行单元(任务/子任务/隐藏任务)依赖的信息全部由上一次提交固定。
  // 人工遗留脏区阻塞交人工(替代旧"⚠ 会被下一次提交吸纳"提示:吸纳会把人工改动
  // 混入 driver 审计轨迹,破坏提交即隔离边界);driver 独占状态文件(PLAN.md/
  // CURRENT.md)的遗留走 beginUnit 的 carryover 补提交自愈——上一次运行以非提交
  // 路径退出(如单元门禁不净直接 return 2)会留下它们的写盘,那是 driver 自己的
  // 落账、不是人工改动,拦在这里只会让下一次运行永远起不来。
  if (opts.commit !== false && !opts.dryrun) {
    const gate = await beginUnit(directory, opts, { id: "PLAN", title: "运行前基线收口" })
    if (gate.type === "dirty") {
      log("⏸ 工作区存在未提交改动,为保证执行单元以干净基线启动,请先人工处置(提交或清理)后重新运行:")
      for (const file of gate.files) log(`  ${file}`)
      return { exit: 2 }
    }
  }
  // 中断恢复(必须早于下方运行前基线收口提交): 上次运行被 kill/Ctrl+C 可能遗留
  // in_progress 标记(无会话在跑),重置为 pending;主循环经 next() 照样续跑,
  // attempts 保留。距中断较近时链上会话的进度记录(.auto/progress.json)使 runTask
  // 复用原会话继续。这两段写的是 driver 独占状态文件 PLAN.md——放在 housekeeping
  // 收口之前,其写盘随该次提交一并落账,首个执行单元启动时工作区本就 clean
  // (否则要么白耗一次 carryover 自愈提交,要么在阶段化布局下直接撞 clean 门禁)。
  // dryrun 不改任何状态文件,故整段跳过(与下方 dryrun 提前 return 的旧位置等价)。
  if (!opts.dryrun) {
    const stale = await resetInProgress(path)
    if (stale.length) log(`↻ 恢复中断状态: ${stale.join(", ")} 从 in_progress 重置为 pending`)
    // 精确恢复: 进度记录在验收(verify,且 --review 启用)或质量审核(review)阶段
    // 中断的任务,验收通过时已被标 done——next() 会跳过它,审核永不补跑;置回
    // in_progress 使主循环重入该任务,runTask 依记录的阶段直接续跑。
    const record = await peekProgress(directory)
    if (record?.phase && (record.phase.kind === "review" || (record.phase.kind === "verify" && (opts.review ?? 0) > 0))) {
      const fresh = await load(path)
      const pending = fresh.tasks.find((task) => task.id === record.task)
      if (pending?.status === "done") {
        await setStatus(path, pending.id, "in_progress")
        log(`↻ ${pending.id} 上次中断于${record.phase.kind === "review" ? "质量审核" : "任务级验收"}阶段(任务已标 done),置回 in_progress 补跑`)
      }
    }
  }
  // 启动会话前确保 AGENTS.md 的 opencode-auto 块与当前配置渲染一致(缺失则追加、
  // 内容与渲染不一致则整块替换、旧版/多余的带名标记块一律清理)。AGENTS.md 本身
  // 保持可写,任务可更新它的其余内容(有更新时 driver 会在新会话前重启 server)。
  const ensured = await ensurePointer(directory, { verify: opts.verify, testByDriver: opts.testByDriver })
  if (ensured.block === "inserted") log("已补写: AGENTS.md opencode-auto 块")
  if (ensured.block === "replaced") log("已刷新: AGENTS.md opencode-auto 块(与当前配置渲染不一致)")
  if (ensured.legacyRemoved) log(`已清理: AGENTS.md 中 ${ensured.legacyRemoved} 个旧版/多余 opencode-auto 标记块`)
  if (await ensureGitignore(directory)) log("已更新: .gitignore 忽略 tmp/ 与 .auto/(driver 工作目录与运行时状态)")
  // housekeeping 收口提交: ensurePointer/ensureGitignore 的补写是 driver 改动,立即
  // 落账使首个执行单元启动时工作区 clean;提交失败按环境阻塞退出 2
  // (commit-boundary-design.md P3)。dryrun 不做任何提交。
  if (opts.commit !== false && !opts.dryrun && (await changedFiles(directory)).length) {
    const settled = await commitTree(directory, { id: "PLAN", title: "运行前基线收口" }, {
      stage: "housekeeping",
      subject: "PLAN housekeeping 运行前基线收口(AGENTS.md 指针块/.gitignore/中断状态复位)",
    })
    if (!settled.ok) {
      log(`⏸ 运行前基线收口提交失败: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")},请人工处理 git 后重新运行`)
      return { exit: 2 }
    }
  }
  return { agentName, watcher, progress }
}

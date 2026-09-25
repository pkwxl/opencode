// runAll 的运行前预检: 提示词库装载、agent 契约完整性检查、统计装载与
// 进度心跳、driver 状态文件只读、交接文档复原、启动 clean 门禁、中断状态复位、
// AGENTS.md/.gitignore 收口与 housekeeping 提交;另承接 runAll 的选项类型 RunAllOpts 与
// agent 契约渲染(plans/0006-phases-design.md、plans/0021-commit-boundary-design.md P3)。
// 出口以 { exit } 回传、由 runAll 直接 return,不在此 process.exit;出口位于 runAll 的
// try 之前、不经其 finally(plans/0024-module-split-plan.md §I D13)。不依赖 loop.ts。
// 拆分自 src/loop.ts(plans/0024-module-split-plan.md S14,纯搬运)。
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { loopbackProxyWarning } from "./agent-env"
import { ensurePointer } from "./agents-block"
import { renderAgentContract } from "./config-fix"
import { resumeBanner } from "./conclusion"
import { beginUnit, changedFiles, commitTree, fileTracked } from "./git"
import { ensureGitignore } from "./gitignore"
import { log } from "./log"
import { checkModelReferences, loadModels, type ModelRegistry } from "./models"
import { projectLayerRefusal, switchModelRegistryInfo } from "./models-describe"
import { currentRound, legacyLayoutProblem, phaseIndexPath } from "./phases"
import { roundBriefPath } from "./docpaths"
import { loadPhaseTypes } from "./phases/custom"
import { phaseType, REQUIRED_TYPE, resolvePhases, type PhaseTypeEntry } from "./phases/registry"
import { trackSubtasks, watchFiles } from "./loop-progress"
import type { ModeSpec } from "./mode"
import type { PlanInput } from "./plan-input"
import { activeIntentText, useHumanQuestions, useIntentPacks } from "./prompt"
import { CONTRACT_AGENT, type PermissionMode, type SubtaskMode } from "./opts"
import type { ParallelLevel } from "./intent/types"
import { resetInProgress } from "./tasks"
import { protect } from "./protect"
import type { AgentHost } from "./agent/types"
import { routingFacts, dispatchCoverageProblems, type DispatchNeed } from "./routing"
import { shellProfile } from "./shell"
import { autoSwitches, modelTypeProblems, phaseTypeRoleProblems, setSwitchModelRegistry, type AgentChoice } from "./switches"
import { loadStats } from "./stats"
import { usePromptLibrary } from "./template"
import { restoreTestHandoffs } from "./testrun"

export type RunAllOpts = {
  // The coding agent (M6.1, config `agent`; absent = opencode). The shell
  // profile's agent and OPENCODE_AUTO_AGENT take precedence (src/agent-choice.ts).
  agent?: AgentChoice
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
  // --permission: 权限请求的处理策略(缺省 ask-deny),透传给 runner 的会话监听。
  permission?: PermissionMode
  // --interactive: 常驻 stdin 旁路接收人工输入注入当前会话(与 --verbose 互斥,
  // 终端明细静默,日志文件保持完整记录)。
  interactive?: boolean
  // driver 托管脚本(test)的看门狗: 持续无输出的判定窗口与绝对时长上限(毫秒),
  // 透传给 runScript(config 的 idleTime / idleMax 以分钟设定)。
  idleMs?: number
  maxMs?: number
  // --test-by-driver: 测试执行协议——执行类会话把测试脚本写入
  // tmp/test.sh 由 driver 执行,输出反馈回会话;--handover-test: 测试失败且上下文
  // 达上限时交接新会话续跑。均透传给 runTask。
  testByDriver?: boolean
  handoverTest?: boolean
  // -m/--mode 场景模式(缺省 migrate),透传给 runTask 的提示词渲染。
  mode?: ModeSpec
  // --phases (plans/0006, config): "m" (default) = the manual single phase
  // R-01/P01-implement (no planning or handover session, plans/0047 L2); any
  // other value runs the phase loop — current phase → planning session writes
  // tasks.md + task units → task loop → handover (distill + completion rename +
  // commit) → next phase.
  phases?: string
  // 调用方已托管的 server 句柄(外壳的前置会话与主循环共用一个实例): 提供
  // 时不再自行 manage/close,生命周期归调用方。
  managed?: AgentHost
  // --new-session: 中断恢复时跳过会话复用(仅放弃旧会话上下文,阶段精确重入
  // 保留),透传给 runTask。
  newSession?: boolean
  // 自动编号(config.autoNumber): 任务编号在目标目录永不重复——阶段规划会话自
  // .auto/next-task 记录续接编号,记录缺失先经 AI 恢复会话推导恢复(见
  // src/numbering.ts)。
  autoNumber?: boolean
  // --no-wrapup(config.wrapup,缺省 true): 关闭任务收尾会话,透传给 runTask。
  wrapup?: boolean
  // config.acceptanceGate: phase types gated on a human's acceptance
  // (plans/0049 G7).
  acceptanceGate?: string[]
  // config.build: the target's build command for the round-close report at the
  // complete route (plans/0049 G8).
  build?: string
  // config.parallel (MP.1, plans/0046 D8): the planning-guidance level injected
  // into the planning sessions; absent = none.
  parallel?: ParallelLevel
  // --max-sessions (plans/0046 D9): concurrent AI sessions. Reserved until the
  // MP.3 scheduler exists: only 1 (the default) is accepted.
  maxSessions?: number
  // plan's stop condition (plans/0053 D6): the run stops once a planning step
  // has succeeded, or where an execute route would start, and prints what to
  // review. Absent = run: the loop goes on through execution.
  stopBefore?: "execute"
  // The planning input plan hands the run (plans/0053 D9): the first planning
  // step persists it to its phase's plan-input.md and plans against it.
  planInput?: PlanInput
  // plan --append (plans/0053 D23): with planInput, the planning step appends
  // tasks to the phase the route names now instead of planning it afresh; m
  // mode implies the append from an input on a non-empty index, so the flag
  // only matters for the phased execute and handover routes.
  append?: boolean
}

// 预检段: 产出 runAll 后续仍用的 agentName 与两个计时器句柄(finally 中关闭);
// 报错出口回传 { exit },时序与副作用残留同搬运前(见文件头)。
// registry: the model registry loaded at run start (undefined = none).
export async function preflight(
  directory: string,
  opts: RunAllOpts,
): Promise<{ agentName: string; watcher?: { close(): void }; progress: { close(): void }; registry?: ModelRegistry } | { exit: number }> {
  // Legacy layout (M3.7, plans/0047 R3): an old-layout project is a usage error
  // before anything is read or written — no compatibility read, no migration.
  const legacy = await legacyLayoutProblem(directory)
  if (legacy) {
    log(legacy)
    return { exit: 1 }
  }
  // 提示词库: 装载目标目录 .opencode/auto/prompts/ 覆盖(协议敏感模板做关键
  // 内容校验,失败按用法错误退出)。之后 render* 同步渲染,无需再感知目录。
  // 意图包同点装载(M1.2): 目标目录 .opencode/auto/intents/ 覆盖/新增,非法
  // 意图包文件在此起即按用法错误报出。
  // 自定义阶段类型(M3.6,.opencode/auto/phases/)同点校验: 非法类型文件与
  // OPENCODE_AUTO_MODEL 中不存在的阶段类型键均按用法错误退出。
  // The model registry loads at the same point (loadRunRegistry), once per
  // run and against the phase type list with the custom types — and ahead of
  // the switches' first parse, because a registry in force changes what the
  // switches accept: OPENCODE_AUTO_MODEL values may be internal names and
  // OPENCODE_AUTO_MODEL_FALLBACK is a usage error (plans/0055 §9 R7).
  let registry: ModelRegistry | undefined
  try {
    usePromptLibrary(directory)
    useIntentPacks(directory)
    // plan's sessions (stopBefore === "execute") render question-rule's
    // human-answer branch: a person attends plan, so questions wait for the
    // human with no timeout and never get an AUTO-RESOLVE proxy answer (the
    // driver side of the same rule is Opts.humanQuestions, watch.ts).
    useHumanQuestions(opts.stopBefore === "execute")
    const loaded = loadPhaseTypes(directory)
    const custom = loaded.filter((entry) => entry.origin === "project").map((entry) => entry.type)
    const types = loaded.map((entry) => entry.type)
    registry = await loadRunRegistry(directory, types)
    setSwitchModelRegistry(registry ? switchModelRegistryInfo(registry) : undefined)
    // A dispatch the run can send with a list the agent filter emptied is a
    // usage error, never a silent wait (plans/0055 §6.3, §10 item 7).
    const coverage = registry ? dispatchCoverageProblems(registry, routingFacts(registry, opts.agent).agentFilter, dispatchNeeds(opts, loaded)) : []
    const problems = [...phaseTypeRoleProblems(custom), ...modelTypeProblems(autoSwitches().model, types), ...coverage]
    if (problems.length) throw new Error(problems.join("\n"))
  } catch (error) {
    log(error instanceof Error ? error.message : String(error))
    return { exit: 1 }
  }
  // The driver's own traffic (plans/0055 §8.10): it reaches a managed opencode
  // server over loopback with Bun's fetch, which does not bypass loopback on
  // its own, so a proxy in the driver's environment that NO_PROXY does not
  // steer around loopback would carry that traffic (src/agent-env.ts). Proxies
  // for agents belong on their agent profiles. A warning, never a refusal.
  // AUTO-RESOLVE: does the loopback proxy warning fire without a model registry? -> no, only under a registry with an opencode profile (a run without a registry stays byte-identical, and a registry of claude profiles alone starts no opencode server to reach)
  if (registry && [...registry.agents.values()].some((profile) => profile.adapter === "opencode")) {
    const warning = loopbackProxyWarning(process.env)
    if (warning) log(warning)
  }
  // --max-sessions is reserved (plans/0046 D9): there is no scheduler yet, so a
  // request for concurrent sessions is refused instead of silently run serially.
  if (opts.maxSessions !== undefined && opts.maxSessions !== 1) {
    log(`max sessions ${opts.maxSessions}: concurrent execution is not supported yet (only 1)`)
    return { exit: 1 }
  }
  // A project intent pack without the level's subsection injects nothing; say so
  // once rather than let the setting silently do nothing.
  if (opts.parallel && !activeIntentText("parallelism", opts.parallel)) {
    log(`⚠ parallel ${opts.parallel}: the active intent pack has no \`## parallelism\` / \`### ${opts.parallel}\` subsection; planning sessions get no parallelism guidance`)
  }

  // The agent contract written by init (CONTRACT_AGENT); pre-run integrity
  // check: with the contract file missing the server only answers UnknownError
  // (no root cause), so report it here with the shell profile's recovery hint
  // (src/shell.ts); a contract differing from the template only warns.
  const agentName = CONTRACT_AGENT
  const agentFile = join(directory, ".opencode/agent", `${agentName}.md`)
  const agentText = await Bun.file(agentFile).text().catch(() => undefined)
  const { program, bin, agentRecovery } = shellProfile()
  if (agentText === undefined) {
    log(`⏸ agent contract file missing: .opencode/agent/${agentName}.md(its absence makes task dispatch fail: UnknownError)`)
    log(
      agentRecovery === "startup"
        ? `  recovery: re-run ${program}(the default contract is rebuilt from the template at startup), or restore the file manually`
        : `  recovery: run ${bin} fix ${directory} to rebuild the file (or restore it manually), then re-run`,
    )
    return { exit: 1 }
  }
  // init 写入的是按当时 testByDriver 渲染后的契约,比对须用当前配置同样
  // 渲染(与原始模板全文比对会因 {{#if}} 标记恒不一致,口径同 renderAgentContract)。
  if (agentText !== (await renderAgentContract(Boolean(opts.testByDriver)))) {
    log(
      `⚠ .opencode/agent/auto.md differs from the current template (possibly a legacy contract); ` +
        (agentRecovery === "startup" ? `re-running ${program} refreshes it from the template` : `run ${bin} fix ${directory} to refresh it`),
    )
  }

  const watcher = opts.verbose ? watchFiles(directory) : undefined
  // 统计装载(plans/STATS_PLAN.md §1): 读盘 → 折旧上一进程遗留段 → 轮次滚动 → 开
  // 本进程首段;有旧文档时打印续接横幅(§4.6)。必须先于 trackSubtasks(其心跳读
  // 数依赖已装载句柄与 statsTask 设定的桶身份)。
  const resumed = await loadStats(directory)
  if (resumed) log(resumeBanner(resumed))
  // 每 10 分钟上报当前任务的子任务进度与预计剩余时间(subtasks.md,状态文件为准)。
  const progress = trackSubtasks(directory)
  // Driver-owned files go read-only for the whole run; driver writes
  // re-apply it, and the finally below restores writability so a human can
  // edit the files (e.g. opencode.json after a permission block).
  await protect(directory)
  // 交接文档的现场复原(测试交接中断恢复 F3,plans/0023-test-handover-early-design.md §I):
  // 必须早于启动 clean 门禁——上一次运行可能把已落账的在途交接文档删掉,那道删除
  // 本身就是脏区,门禁会在这里当场拦下整次运行。复原即消脏,随后的恢复状态机也
  // 才拿得到判定所需的文件。
  if (!opts.dryrun) await restoreTestHandoffs(directory)
  // The retired task mirror (plans/0054 D3): a CURRENT.md an earlier release
  // left behind — recognised by the header it always wrote — is removed ahead
  // of the start gate, whose carryover commits the deletion as a driver write
  // (git.ts DRIVER_STATE). Any other CURRENT.md belongs to the project.
  if (!opts.dryrun && (await removeRetiredCurrent(directory))) log("removed: CURRENT.md (task mirror retired; an earlier release wrote it)")
  // 启动 clean 门禁(plans/0021-commit-boundary-design.md P3): 提交启用时要求工作区 clean——
  // 此后所有执行单元(任务/子任务/隐藏任务)依赖的信息全部由上一次提交固定。
  // 人工遗留脏区阻塞交人工(替代旧"⚠ 会被下一次提交吸纳"提示:吸纳会把人工改动
  // 混入 driver 审计轨迹,破坏提交即隔离边界);driver 独占状态文件(索引勾选、
  // 单元改名)的遗留走 beginUnit 的 carryover 补提交自愈——上一次运行以非提交
  // 路径退出(如单元门禁不净直接 return 2)会留下它们的写盘,那是 driver 自己的
  // 落账、不是人工改动,拦在这里只会让下一次运行永远起不来。
  if (opts.commit !== false && !opts.dryrun) {
    const gate = await beginUnit(directory, opts, { id: "PLAN", title: "pre-run baseline close-out" })
    if (gate.type === "dirty") {
      // The round-start gate (plans/0049 G1): the command that establishes
      // the round (plan; init and continue did before their round steps
      // retired) leaves the setup uncommitted on purpose — committing it is
      // the human's review of the round. Its mark is a phase index that git
      // has never seen.
      const round = await currentRound(directory)
      const index = phaseIndexPath(round)
      if (gate.files.includes(index) && !(await fileTracked(directory, index))) {
        const phased = opts.phases !== undefined && opts.phases !== "m"
        log(
          `⏸ round-start gate: the setup of round ${round} is not committed yet. Review it` +
            `${phased ? `, fill in ${roundBriefPath(round)} (goal, acceptance and release criteria)` : ""}, commit, and re-run:`,
        )
      } else {
        log("⏸ the worktree has uncommitted changes; to ensure execution units start on a clean baseline, handle them manually (commit or clean) and re-run:")
      }
      for (const file of gate.files) log(`  ${file}`)
      return { exit: 2 }
    }
  }
  // 中断恢复: 上次运行被 kill/Ctrl+C 可能遗留 in_progress 标记(无会话在跑),
  // 重置为 pending;主循环经 next() 照样续跑,attempts 保留。距中断较近时链上
  // 会话的进度记录(.auto/progress.json)使 runTask 复用原会话继续。标记是运行态
  // (.auto/units.json,不入 git,M3.4),不产生提交。dryrun 不改任何状态文件。
  if (!opts.dryrun) {
    const stale = await resetInProgress(directory)
    if (stale.length) log(`↻ resuming interrupted state: ${stale.join(", ")} reset from in_progress to pending`)
  }
  // 启动会话前确保 AGENTS.md 的 opencode-auto 块与当前配置渲染一致(缺失则追加、
  // 内容与渲染不一致则整块替换、旧版/多余的带名标记块一律清理)。AGENTS.md 在
  // run 期间只读(protect.ts),会话不维护它(plans/0054 D2);ensurePointer 写入
  // 前后自行解锁与重新保护。
  const ensured = await ensurePointer(directory, { testByDriver: opts.testByDriver })
  if (ensured.block === "inserted") log("inserted: AGENTS.md opencode-auto block")
  if (ensured.block === "replaced") log("refreshed: AGENTS.md opencode-auto block (differed from the current config rendering)")
  if (ensured.legacyRemoved) log(`cleaned: ${ensured.legacyRemoved} legacy/redundant opencode-auto marker block(s) in AGENTS.md`)
  if (await ensureGitignore(directory)) log("updated: .gitignore now ignores tmp/ and .auto/(driver working directory and runtime state)")
  // housekeeping 收口提交: ensurePointer/ensureGitignore 的补写是 driver 改动,立即
  // 落账使首个执行单元启动时工作区 clean;提交失败按环境阻塞退出 2
  // (plans/0021-commit-boundary-design.md P3)。dryrun 不做任何提交。
  if (opts.commit !== false && !opts.dryrun && (await changedFiles(directory)).length) {
    const settled = await commitTree(directory, { id: "PLAN", title: "pre-run baseline close-out" }, {
      stage: "housekeeping",
      subject: "PLAN housekeeping pre-run baseline close-out (AGENTS.md pointer block/.gitignore/interrupted-state reset)",
    })
    if (!settled.ok) {
      log(`⏸ pre-run baseline close-out commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}, handle git manually and re-run`)
      return { exit: 2 }
    }
  }
  return { agentName, watcher, progress, registry }
}

// The dispatches this run can send (plans/0055 §6.3): every role its
// reachable phase types dispatch, plus the run-level roles no phase owns.
// The reachable types are the configured phases (custom types included,
// resolved against the loaded type list); "m" is the implicit implement
// phase. Per type with tasks: the task sessions take the type's execute tier
// (`whole` outside the auto subtask mode, `subtask` in every mode — a
// checklist a person wrote dispatches too —, and the merged understand/
// decompose session in the auto mode), and the wrap-up session runs unless
// wrapup is off; a type without tasks runs its own knowledge session.
// Run-level: the bypass one-offs in every mode (confirm turns, context-base
// rebuilds, the dryrun precheck), the phased loop's planning and handover
// sessions, and m mode's planning scan. number-recovery (a rare recovery
// path inside a run) and prior-knowledge (shell-orchestrated outside runAll)
// stay off the list: both are simple sessions, so the bypass need keeps
// their tier covered.
// AUTO-RESOLVE: does the default m mode need the deep tier? -> yes, through the decompose sessions of its implicit implement phase (the default subtask mode runs the merged understand/decompose session, a deep role of that phase; §6.3 makes an emptied needed list a preflight error rather than a mid-run wait, and the previous trigger — deep only when the run plans or scans — would leave those dispatches waiting silently; a run that really wants no deep tier says subtask: off, whose whole-task sessions take the implement type's simple tier)
function dispatchNeeds(opts: RunAllOpts, types: readonly PhaseTypeEntry[]): DispatchNeed[] {
  // An invalid phases value fails at its own validation (config load, the
  // loop's routing); the coverage check stays total on the implicit type.
  const entries = resolvePhases(opts.phases ?? "m", types) ?? [phaseType(REQUIRED_TYPE)!]
  const phased = opts.phases !== undefined && opts.phases !== "m"
  const needs: DispatchNeed[] = [{ role: "bypass" }]
  if (phased) needs.push({ role: "phase-plan" }, { role: "phase-handover" })
  else if (opts.planInput !== undefined) needs.push({ role: "implement-scan" })
  for (const entry of entries) {
    if (!entry.hasTasks) {
      needs.push({ role: "knowledge", entry })
      continue
    }
    if ((opts.subtask ?? "auto") === "auto") needs.push({ role: "decompose", entry })
    else needs.push({ role: "whole", entry })
    needs.push({ role: "subtask", entry })
    if (opts.wrapup !== false) needs.push({ role: "wrapup", entry })
  }
  return needs
}

// The model registry at run start (plans/0055 §4.1, §4.3): both layers read
// once, strictly, and held by the run (runAll puts it on the loop context);
// the driver never writes or locks them. undefined = no registry, and then
// nothing is logged and nothing changes. Every refusal throws, and preflight
// logs it and exits 1, like a bad config:
//   - a project layer that git does not ignore, checked before its content is
//     read: the unified commit would commit it. The line names fix, which
//     adds the .gitignore entry init writes; a tracked layer must be
//     untracked first, since ignore rules skip tracked files;
//   - a strict load failure (ModelRegistryError: one line per problem, each
//     naming its layer and field);
//   - a broken reference: a variable unset or empty, a file missing or
//     unreadable. Each line names the field, the layer and the reference,
//     never a value.
// The refusal of a project layer that git would commit is shared with the
// models command (projectLayerRefusal, src/models-describe.ts), so both name
// the same fix.
// AUTO-DECISION: preflight calls the shared projectLayerRefusal instead of its own copy of the check, and keeps its own load and reference steps (the refusal line stays byte-identical, and preflight still stops before reading an unignored layer's content)
// AUTO-DECISION: the load sits in preflight's validation block with the prompt library and the phase types, so it runs inside the run lock, before the start gate and every write, and under dryrun too (a bad registry then fails plan, run and a dryrun alike, and the custom phase types are already loaded there)
// AUTO-DECISION: the registry rides the preflight result into the loop context instead of RunAllOpts (the options are the caller's input; the registry is state the run derives from disk once)
async function loadRunRegistry(directory: string, phaseTypes: readonly string[]): Promise<ModelRegistry | undefined> {
  const refusal = await projectLayerRefusal(directory)
  if (refusal) throw new Error(refusal)
  const registry = await loadModels(directory, { phaseTypes })
  if (!registry) return undefined
  const broken = checkModelReferences(registry)
  if (broken.length) throw new Error(broken.map((problem) => problem.message).join("\n"))
  return registry
}

// The first line of every CURRENT.md the driver wrote before the mirror
// retired (plans/0054 D3).
const RETIRED_CURRENT_HEADER = "# Current task (maintained by opencode-auto, do not edit manually)"

// Removes the root CURRENT.md when it is the retired task mirror; returns
// whether it did. A file with any other first line is the project's own.
export async function removeRetiredCurrent(dir: string): Promise<boolean> {
  const file = join(dir, "CURRENT.md")
  const text = await Bun.file(file).text().catch(() => undefined)
  if (text?.split("\n")[0] !== RETIRED_CURRENT_HEADER) return false
  await rm(file, { force: true })
  return true
}

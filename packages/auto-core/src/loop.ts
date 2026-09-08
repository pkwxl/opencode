import { createInterface } from "node:readline/promises"
import { mkdir, rm, stat } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { appendFinalTask, finalIndex, finalProposalFile, generateFinalTask, routeFinal, type FinalProposal } from "./final"
import { commitTree, pendingChanges, repoRoots } from "./git"
import { extractKnowledge, priorKnowledgeDigest } from "./knowledge"
import { advanceNextTask, ensureNumbering, NEXT_TASK_FILE, taskNumber } from "./numbering"
import { startInteractive, type Interactive } from "./interactive"
import { banner, log, vlog } from "./log"
import type { ModeSpec } from "./mode"
import { block, countSubtasks, load, next, resetInProgress, setStatus, type Plan } from "./plan"
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
  validHandover,
  type Phase,
} from "./phases"
import { renderDryrun, renderPhaseHandover, renderPhasePlan, stageText } from "./prompt"
import { allowWrite, protect, reprotect, unprotect } from "./protect"
import { peekProgress } from "./resume"
import { requireArtifact, runOnce, runTask, type PermissionMode, type SubtaskMode } from "./runner"
import { shellProfile } from "./shell"
import { manage, type ServerHandle } from "./server"
import { stepPause } from "./step"
import { renderText, usePromptLibrary } from "./template"
import templateAgent from "../templates/.opencode/agent/auto.md" with { type: "file" }

// AGENTS.md 指针块: CURRENT.md 由 driver 整文件重写,指针本身永不变更。
// AGENTS.md 作为 system context 每个 provider turn 现场重读,不随上下文压缩丢失;
// 它有更新时 driver 会在下一个新会话前重启 server,使新会话必定加载最新内容。
// AGENTS.md 不置只读(任务可更新它),run/init 只确保指针块存在。
const POINTER = `<!-- opencode-auto:start -->
本目录由 opencode-auto 驱动。每个会话开始必须先读 \`CURRENT.md\`(若存在),其中是当前
任务的完整内容与进度,优先于一切会话记忆。不要编辑 \`CURRENT.md\` 与 \`PLAN.md\`,
它们由 driver 独占维护。
<!-- opencode-auto:end -->`

// AGENTS.md 验证原则块: 独立于指针块的第二个标记块,重复运行也能补写。
const VERIFY_PRINCIPLE = `<!-- opencode-auto:verify:start -->
验证原则: 任务级验证脚本与验证命令一律由 driver 在会话外执行,任何会话不要直接
运行它们来下验收结论;验收标准写在任务的 verify 字段。若会话认为验证脚本本身有
问题,可编写新的验证脚本替换指定脚本(tmp/verify.sh,目标目录下 driver 管理的
工作目录),由 driver 重新执行并把输出回传给独立判定会话。判定会话另可在 driver
授权下更新 PLAN.md 中后续未完成任务的 verify 字段(把验证经验沉淀到后续任务,
仅限 verify 字段),除此之外 PLAN.md 与 CURRENT.md 由 driver 独占维护。任务描述
与项目规范不要出现与此相违背的指示。
<!-- opencode-auto:verify:end -->`

// AGENTS.md 提交原则块: 第三个标记块,与验证原则对等——提交执行权在 driver。
const COMMIT_PRINCIPLE = `<!-- opencode-auto:commit:start -->
提交原则: 会话结束后由 driver 递归统一提交全部改动(先嵌套子仓库后本仓库),
提交信息携带任务编号与阶段;任何会话不要执行 git commit/amend/rebase 等提交
类命令,也不要修改提交历史。需要留档的变更背景写入 docs/ 文档,由 driver 的
提交一并纳入。任务描述与项目规范不要出现与此相违背的指示。
<!-- opencode-auto:commit:end -->`

// AGENTS.md 测试执行原则块: 与验证/提交原则对等的第四类执行权原则块——
// 编译/测试/构建/lint 等命令的执行权在 driver(由 config.testByDriver 启用)。
// 与验证原则块同样按开关补写/移除:未启用时 AGENTS.md 不得保留其描述。
const TEST_PRINCIPLE = `<!-- opencode-auto:test:start -->
测试执行原则: 编译、测试、构建、lint 等可能耗时长或产生大量输出的命令一律由
driver 在会话外执行,任何会话不要直接运行它们;需要时把命令写成脚本放入 test/
目录,再把脚本路径写入 tmp/test.sh 告知 driver 执行。driver 运行后把退出码与
输出文件路径(stdout 与 stderr 合并落入单个文件)反馈回会话,由 AI 直读文件
判断结果。任务描述与项目规范不要出现与此相违背的指示。
<!-- opencode-auto:test:end -->`

// AGENTS.md 维护规则块: 第四个标记块,约束 AGENTS.md 保持工作流入口定位、
// 不膨胀为知识库(长迁移中它每个 provider turn 都进入上下文,膨胀侵蚀全部会话
// 的有效上下文);细节路由到 docs/agents/<主题>.md,由 check 命令的行数 note
// 做唯一机器观测。见 docs/init-config-agents-design.md D.1。
const MAINT_RULE = `<!-- opencode-auto:maint:start -->
AGENTS.md 维护规则(本文件是工作流入口,不是知识库):
1. 保持精简: 全文不超过 150 行;不写入实现细节、长解释、命令输出或单任务知识。
2. 路由不复制: 模块/阶段/任务特定的信息写入 docs/agents/<主题>.md,本文件只保留
   一行路由条目(主题 → 路径)。
3. 更新不追加: 新增信息前先检查既有规则或路由条目是否应修改;淘汰过时内容,
   不要累积历史备注。
4. 只沉淀持久的工作流知识: 仅记录会影响未来多数任务执行方式的约定;临时调试
   状态、一次性决策、对话过程不写入(一次性决策按 AUTO-DECISION 记入相关文档)。
<!-- opencode-auto:maint:end -->`

// AGENTS.md 引用规范块: 第六个标记块(stable-refs P4 下沉),内容 = 设计文档
// docs/stable-refs-design.md §3 规范的精编全文: 存放(R2 永久性/R3 目录化/R4
// 角色文件名/R5 归档语义/R7 轮次表达)、引用语法(§3.2)与一致性检查三层(§3.3)。
// 无条件补写(路径稳定性不依赖任何开关,§8)。
const REFS_SPEC = `<!-- opencode-auto:refs:start -->
引用与存放规范(稳定引用,细则见 stable-refs 设计文档):
1. 存放: 任务文档只在 docs/T-NNN/ 内(context/subtasks/report/audit/fix/handoff/
   testhandoff.md),子任务产物只在 docs/T-NNN/S<两位序号>/ 内(index.md、
   testhandoff.md),终审产物在 docs/T-F<k>/ 内;阶段交接在 docs/handovers/、
   迁移知识在 docs/migration-kb/、前置知识在 docs/prior-kb/。这些路径一经创建
   即为永久路径: 永不移动、永不改名;docs/phases/ 只放过期状态文件。
2. 引用: 文档间引用与对代码的引用一律写目标目录根相对路径(如
   \`docs/T-003/S04/index.md\`、\`src/runner.ts:120\`,反引号或链接,可带 :行号
   锚);不要引用 docs/phases/ 下的状态文件;轮次差异经文件名 R<N>- 前缀与
   台账表达,不靠搬移目录。
3. 检查: driver 在统一提交前自动改写 rename 引用并报告失效引用;check 子命令
   全量扫描活文档;verify 启用时任务产物文档的失效引用会被验收门禁拦截进
   修复轮。代码围栏内的路径与行内标注 已删除/已归档/历史 的引用豁免。
<!-- opencode-auto:refs:end -->`

// 幂等维护 AGENTS.md 的 opencode-auto 块: 指针块、验证原则块、测试执行原则块、
// 提交原则块、维护规则块与引用规范块各自独立判断、只追加,从不改写已有内容。
// 返回补写了哪些块。verify(任务级验收开关)为 false 时不补写验证原则块,并
// 移除已存在的;testByDriver(编译/测试等命令执行权)为 false 时同样不补写
// 测试执行原则块并移除已存在的——机制不存在时,AGENTS.md 不得保留与其相关的
// 描述。引用规范块与维护规则块无条件补写(不依赖开关)。
export async function ensurePointer(
  directory: string,
  opts: { verify?: boolean; testByDriver?: boolean } = {},
): Promise<
  { pointer: boolean; principle: boolean; principleRemoved: boolean; test: boolean; testRemoved: boolean; commit: boolean; maint: boolean; refs: boolean }
> {
  const agentsFile = join(directory, "AGENTS.md")
  const existing = await Bun.file(agentsFile).text().catch(() => "")
  let text = existing
  const pointer = !text.includes("opencode-auto:start")
  if (pointer) text = text ? `${text.trimEnd()}\n\n${POINTER}\n` : `# AGENTS.md\n\n${POINTER}\n`
  const principle = Boolean(opts.verify) && !text.includes("opencode-auto:verify:start")
  if (principle) text = `${text.trimEnd()}\n\n${VERIFY_PRINCIPLE}\n`
  const principleRemoved = !opts.verify && text.includes("opencode-auto:verify:start")
  if (principleRemoved) {
    // 吞掉块与其后全部换行: 块前空行分隔保留(前文与后文之间仍是单空行),
    // 块在文件尾时不留尾部空行。测试执行原则块的移除同策略。
    text = text.replace(/<!-- opencode-auto:verify:start -->[\s\S]*?<!-- opencode-auto:verify:end -->\n*/, "")
    text = text.replace(/\n{2,}$/, "\n")
  }
  const test = Boolean(opts.testByDriver) && !text.includes("opencode-auto:test:start")
  if (test) text = `${text.trimEnd()}\n\n${TEST_PRINCIPLE}\n`
  const testRemoved = !opts.testByDriver && text.includes("opencode-auto:test:start")
  if (testRemoved) {
    text = text.replace(/<!-- opencode-auto:test:start -->[\s\S]*?<!-- opencode-auto:test:end -->\n*/, "")
    text = text.replace(/\n{2,}$/, "\n")
  }
  const commit = !text.includes("opencode-auto:commit:start")
  if (commit) text = `${text.trimEnd()}\n\n${COMMIT_PRINCIPLE}\n`
  const maint = !text.includes("opencode-auto:maint:start")
  if (maint) text = `${text.trimEnd()}\n\n${MAINT_RULE}\n`
  const refs = !text.includes("opencode-auto:refs:start")
  if (refs) text = `${text.trimEnd()}\n\n${REFS_SPEC}\n`
  if (text !== existing) await Bun.write(agentsFile, text)
  return { pointer, principle, principleRemoved, test, testRemoved, commit, maint, refs }
}

// 确保 .gitignore 忽略 driver 工作目录: tmp/(verify 脚本与输出,位于目标目录内)
// 与 .auto/(运行日志、进度恢复记录与判定文件等运行时状态)。统一提交会提交全部
// 未提交改动,不忽略会把它们带进提交。已有等价条目则跳过;非 git 目录(无 .git
// 且无 .gitignore)不做任何事。返回是否追加了条目。
export async function ensureGitignore(directory: string): Promise<boolean> {
  const file = join(directory, ".gitignore")
  const existing = await Bun.file(file).text().catch(() => undefined)
  // .git 可能是目录(普通仓库)或文件(worktree/子模块),stat 两者皆可。
  if (existing === undefined && !(await stat(join(directory, ".git")).then(() => true, () => false))) return false
  const ignored = (entry: string) =>
    (existing ? existing.split("\n") : []).some((line) => {
      const normalized = line.trim().replace(/^\//, "").replace(/\/$/, "")
      return normalized === entry.replace(/\/$/, "")
    })
  const missing = ["tmp/", ".auto/"].filter((entry) => !ignored(entry))
  if (!missing.length) return false
  await Bun.write(file, `${existing ? `${existing.trimEnd()}\n` : ""}${missing.join("\n")}\n`)
  return true
}

// Exit codes: 0 = all tasks done, 1 = usage/setup error, 2 = blocked, waiting
// for a human to resolve the issue outside the session and re-run,
// 130 = force-killed by double Ctrl+C. A blocked
// task needs no `answer`: re-running resumes it directly.

// agent 契约渲染文本: 按 verify/testByDriver 两态渲染内置模板。外壳的契约维护
// 写入与 runAll 的完整性检查共用本函数,防止写入与比对口径漂移(模板含
// {{#if}} 条件块,拿原始文本比对渲染后的文件必然不一致)。
export async function renderAgentContract(verify: boolean, testByDriver: boolean): Promise<string> {
  return renderText(await Bun.file(templateAgent).text(), { verify, testByDriver })
}

export async function runAll(
  directory: string,
  opts: {
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
  },
): Promise<number> {
  const path = join(directory, "PLAN.md")
  if (!(await Bun.file(path).exists())) {
    log(`未找到计划文件: ${path}`)
    return 1
  }

  // 提示词库: 装载目标目录 .opencode/auto/prompts/ 覆盖(协议敏感模板做关键
  // 内容校验,失败按用法错误退出)。之后 render* 同步渲染,无需再感知目录。
  try {
    usePromptLibrary(directory)
  } catch (error) {
    log(error instanceof Error ? error.message : String(error))
    return 1
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
    return 1
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
  // 每 10 分钟上报当前任务的子任务进度与预计剩余时间(基于 PLAN.md 勾选状态)。
  const progress = trackSubtasks(path)
  // Driver-owned files go read-only for the whole run; driver writes
  // re-apply it, and the finally below restores writability so a human can
  // edit the files (e.g. opencode.json after a permission block).
  await protect(directory)
  // 启动会话前确保 AGENTS.md 指针块与验证/测试/提交原则块、维护规则块就位(缺失
  // 则补写;verify/testByDriver 未启用时不补写对应块、已存在的会移除)。AGENTS.md
  // 本身保持可写,任务可更新它的其余内容(有更新时 driver 会在新会话前重启 server)。
  const ensured = await ensurePointer(directory, { verify: opts.verify, testByDriver: opts.testByDriver })
  if (ensured.pointer) log("已补写: AGENTS.md 指针块")
  if (ensured.principle) log("已补写: AGENTS.md 验证原则块")
  if (ensured.principleRemoved) log("已移除: AGENTS.md 验证原则块(任务级验收未启用)")
  if (ensured.test) log("已补写: AGENTS.md 测试执行原则块")
  if (ensured.testRemoved) log("已移除: AGENTS.md 测试执行原则块(测试由 driver 执行未启用)")
  if (ensured.commit) log("已补写: AGENTS.md 提交原则块")
  if (ensured.maint) log("已补写: AGENTS.md 维护规则块")
  if (ensured.refs) log("已补写: AGENTS.md 引用规范块")
  if (await ensureGitignore(directory)) log("已更新: .gitignore 忽略 tmp/ 与 .auto/(driver 工作目录与运行时状态)")
  // 工作区已有未提交改动会被 driver 的下一次提交一并纳入(统一提交为全量清扫
  // 语义,与此前会话清扫提交一致),提前提示用户。dryrun 不做任何提交,不提示。
  if (opts.commit !== false && !opts.dryrun && (await pendingChanges(directory))) {
    log("⚠ 工作区已有未提交改动,driver 的下一次统一提交会将它们一并纳入(如需隔离请先自行提交)")
  }
  let server: ServerHandle | undefined
  // --interactive 旁路输入控制器;server 就绪后创建,finally 中关闭。
  let repl: Interactive | undefined
  // 单次 Ctrl+C 不终止(运行期间事件流/子进程可能吞掉或挂起默认退出),
  // 窗口期内连续第二次按下才强制终止:尽力恢复文件可写并关闭 server 后退出。
  let sigintAt = 0
  const onSigint = () => {
    const now = Date.now()
    if (now - sigintAt > 3000) {
      sigintAt = now
      log("⚠ 已捕获 Ctrl+C,3 秒内再次按下将强制终止运行")
      return
    }
    log("✋ 收到连续 Ctrl+C,强制终止")
    server?.close()
    void unprotect(directory).finally(() => process.exit(130))
    // 兜底:清理挂起时也要退出。
    setTimeout(() => process.exit(130), 1000).unref()
  }
  process.on("SIGINT", onSigint)
  try {
    // 阶段化流程: 台账非法为环境错误(H 节),提前于 server 启动求值一次路由,
    // 免得白白拉起服务再退出;正式路由在阶段循环内逐轮重新求值(推导式状态)。
    const phases = opts.phases ?? "m"
    if (phases !== "m") {
      const pre = await routePhase(directory, await load(path), phases)
      if (pre.type === "blocked") {
        log(`⏸ 阶段流程受阻: ${pre.reason}`)
        return 1
      }
    }
    server = opts.managed ?? (await manage(directory, opts.server))
    if (opts.interactive) {
      repl = startInteractive(server.client, agentName)
      log("💬 交互模式: 回车把输入作为额外消息发往当前会话(无活动会话时丢弃)")
    }
    if (opts.dryrun) {
      const result = await runOnce(server.client, "权限预检", renderDryrun(), {
        agent: agentName,
        dir: directory,
        verbose: opts.verbose,
        waitAnswer: opts.waitAnswer,
        dryrun: true,
        contextLimit: opts.contextLimit,
        interactive: repl,
        server,
      })
      if (result.type === "blocked") {
        log(`⏸ 预检会话受阻:\n${result.question}`)
        return 2
      }
      log(`✓ 权限预检完成,报告已写入 .auto/dryrun.md,要点:\n\n${result.lastText}`)
      return 0
    }
    let ran = 0
    // 中断恢复: 上次运行被 kill/Ctrl+C 可能遗留 in_progress 标记(无会话在跑),
    // 重置为 pending;主循环经 next() 照样续跑,attempts 保留。距中断较近时链上
    // 会话的进度记录(.auto/progress.json)使 runTask 复用原会话继续。
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
    // advanceFinal 闭包内引用会失去窄化,以 const 捕获已就绪的 server 句柄。
    const serverHandle = server
    // --final-review 终审闭环推进(设计文档 B.2/C): 路由纯函数依(带 final 标记的
    // 任务及其状态,终审产物 docs/T-F<k>/)决定下一步——开生成会话产出提案、提案已
    // 产出直接解析追加(C.3)、熔断/报告异常 block 对应终审任务(B.5/C.4);追加后
    // 主循环 next() 按文件顺序自然拾取,无新增持久化状态。announce 为真时
    // (next() 为空的启动挂点)先打印终审横幅;runTask 完成后的路由挂点不打印。
    // 返回 appended = 已追加任务续跑、stopped = 阻塞退出(退出码 2)、
    // idle = 无需推进(存在未完成终审任务或终审已完成)。
    const advanceFinal = async (plan: Plan, announce = false): Promise<"appended" | "stopped" | "idle"> => {
      const route = await routeFinal(directory, plan, opts.finalReview ?? 0)
      if (route.type === "wait" || route.type === "complete") return "idle"
      if (route.type === "block") {
        await block(path, route.task, route.question)
        log(`⏸ ${route.task} 已阻塞,问题已写入 PLAN.md:\n${route.question}`)
        return "stopped"
      }
      if (announce) banner("全部任务完成,进入终审闭环")
      const append = async (proposal: FinalProposal) => {
        const id = await appendFinalTask(path, plan, route.stage, route.round, proposal)
        log(`✓ 已追加终审任务 ${id}「${stageText(route.stage)}」,主循环继续执行`)
        return "appended" as const
      }
      if (route.type === "append") {
        log(`↻ 终审提案 ${finalProposalFile(route.stage, route.round, finalIndex(plan))} 已产出(追加前中断),直接解析追加`)
        return append(route.proposal)
      }
      log(`▶ 终审闭环: 开生成会话规划「${stageText(route.stage)}」任务(第 ${route.round} 轮)`)
      const generated = await generateFinalTask(serverHandle.client, plan, route.stage, route.round, route.prior, {
        agent: agentName,
        dir: directory,
        verbose: opts.verbose,
        waitAnswer: opts.waitAnswer,
        contextLimit: opts.contextLimit,
        permission: opts.permission,
        interactive: repl,
        server: serverHandle,
        mode: opts.mode,
      })
      if (generated.type === "blocked") {
        log(`⏸ 终审任务生成会话受阻(隐性阻塞,请检查后重新运行):\n${generated.question}`)
        return "stopped"
      }
      return append(generated.proposal)
    }
    // 主任务循环: 依次执行 PLAN.md 中全部任务(子任务/verify/review/统一提交/
    // 进度恢复零改动)。phase 为当前阶段字母(缺省单次运行取 "m"): ① finalGate
    // —— --final-review 终审闭环的挂接门控,阶段化流程下仅 m(迁移实现)阶段挂接
    // (G 节);② 透传 runTask,v(验收)阶段任务据此豁免任务级验收与 --review
    // (phases-design.md D.3)。返回 0 = 全部完成,2 = 阻塞/未完成(问题已写入
    // PLAN.md)。
    const runTaskLoop = async (phase: Phase): Promise<number> => {
      const finalGate = phase === "m"
      for (;;) {
        const plan = await load(path)
        const task = next(plan)
        if (!task) {
          // --final-review: next() 为空且终审未完成 → 推进终审闭环(生成/追加下一
          // 阶段任务后续跑循环);终审完成则照常退出。
          if (finalGate && (opts.finalReview ?? 0) > 0) {
            const advanced = await advanceFinal(plan, true)
            if (advanced === "stopped") return 2
            if (advanced === "appended") continue
          }
          log("✓ 全部任务已完成")
          return 0
        }
        // 首个任务不等待;仅当存在后继任务时在任务之间暂停。
        if (ran > 0 && opts.waitBetween) await waitBetweenTasks(opts.waitBetween, task.id, repl)
        if (task.status === "blocked" && task.question) {
          log(`↻ ${task.id} 此前因问题阻塞,未填写 answer,直接续跑:\n${task.question}`)
        }
        banner(`${task.id} ${task.title}`)
        log(`▶ ${task.id} 开始执行(第 ${task.attempts + 1} 次尝试)`)
        const start = Date.now()
        const outcome = await runTask(serverHandle.client, plan, task, {
          agent: agentName,
          dir: directory,
          verbose: opts.verbose,
          waitAnswer: opts.waitAnswer,
          commit: opts.commit,
          subtask: opts.subtask,
          contextLimit: opts.contextLimit,
          review: opts.review,
          early: opts.early,
          verify: opts.verify,
          permission: opts.permission,
          interactive: repl,
          server: serverHandle,
          idleMs: opts.idleMs,
          maxMs: opts.maxMs,
          testByDriver: opts.testByDriver,
          handoverTest: opts.handoverTest,
          mode: opts.mode,
          newSession: opts.newSession,
          phase,
        })
        if (outcome.type === "blocked") {
          await block(path, task.id, outcome.question)
          log(`⏸ ${task.id} 已阻塞,问题已写入 PLAN.md:\n${outcome.question}`)
          // 中断现场也提交: 保存断点(阻塞问题、CURRENT.md 中断备注),支持回滚到断点。
          if (opts.commit !== false) {
            await commitTree(directory, task, { stage: "interrupted", subject: `${task.id} blocked ${task.title}` })
          }
          return 2
        }
        if (outcome.type === "incomplete") {
          log(`⏸ ${task.id} 未完成,已回退为 pending。请改进 PLAN.md 中该任务的描述后重新运行:\n${outcome.reason}`)
          if (opts.commit !== false) {
            await commitTree(directory, task, { stage: "interrupted", subject: `${task.id} pending ${task.title}` })
          }
          return 2
        }
        log(`✓ ${task.id} 完成(用时 ${formatDuration(Date.now() - start)})`)
        ran++
        // 任务完成的终态提交: PLAN.md 的 [done]/verified 与 CURRENT.md 的删除在此
        // 一并落账(各会话产出已随会话提交,这里是收口);终审路由追加的下一任务
        // 改动归入其生成/执行会话的提交。
        if (opts.commit !== false) {
          await commitTree(directory, task, { stage: "done", subject: `${task.id} done ${task.title}` })
        }
        // 步进暂停(task 边界,OPENCODE_AUTO_STEP ≥ task): 任务终态提交后、终审
        // 路由与下一任务前硬暂停,回车放行。
        await stepPause("task", `任务 ${task.id} ${task.title}`, { interactive: repl })
        // --final-review 路由挂点: runTask 完成且任务带 final 标记 → 解析阶段报告
        // 路由追加下一任务(设计文档 B.2);熔断/报告异常立即阻塞退出,追加的任务
        // 由下一次 next() 按文件顺序拾取。
        if (finalGate && (opts.finalReview ?? 0) > 0 && task.final) {
          const advanced = await advanceFinal(await load(path))
          if (advanced === "stopped") return 2
        }
      }
    }

    if (phases === "m") return await runTaskLoop("m")

    // 阶段规划会话(E 节): 旁路一次性,复用 requireArtifact 骨架,产物 = 直接编辑
    // 填充的 PLAN.md——会话被 driver 专门授权写它(临时放行写权限,其余状态文件
    // 仍只读)。伪任务 PLAN 不进任务链、不写进度记录。返回 0 = 规划完成。
    const planPhase = async (phase: Phase): Promise<number> => {
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
        if (numbering.type === "blocked") {
          log(`⏸ 编号记录恢复会话受阻(隐性阻塞,请检查后重新运行):\n${numbering.question}`)
          return 2
        }
        numberStart = numbering.next
      }
      const brief = await Bun.file(join(directory, ".opencode", "auto", "brief.md")).text().catch(() => undefined)
      // 前序阶段交接注入(E 节注入纪律): 只注入 handover 蒸馏产物,不注入前序
      // 原始 docs/。台账中早于当前阶段且已 done 的各阶段逐个拼接;交接文档为永久
      // 路径 docs/handovers/R<N>-…(D3),P2 前完成的阶段落在归档目录内(读回落);
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
              const modern = handoverDoc(round, letter)
              const text =
                (await Bun.file(join(directory, modern)).text().catch(() => undefined)) ??
                (await Bun.file(join(directory, phaseArchive(letter), "handover.md")).text().catch(() => undefined))
              return [`### ${letter} ${phaseText(letter)}(${modern})`, "", text?.trim() || "(无交接文档)"].join("\n")
            }),
        )
      ).join("\n\n")
      // 本轮首个规划会话的额外注入(台账为空时): ① 前置知识(外壳启动时的已有
      // 迁移结果蒸馏,docs/prior-kb/,见 src/knowledge.ts);② 上一轮结论(轮次
      // 归档存在时,phases-design.md M 节)。后续阶段照常走 handovers 蒸馏链,
      // 不重复注入。
      let prevRound: string | undefined
      if (!ledger.done.length) {
        const parts = [await priorKnowledgeDigest(directory), await prevRoundDigest(directory)].filter((part): part is string => Boolean(part?.trim()))
        prevRound = parts.length ? parts.join("\n\n") : undefined
        if (prevRound) log("ℹ 注入既有迁移结论(前置知识与上一轮归档摘录)")
      }
      log("▶ 开阶段规划会话填充 PLAN.md")
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
            verify: opts.verify,
            finalReview: opts.finalReview,
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
              await Bun.write(path, renderPlanScaffold(opts.verify === true))
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
          log(`⏸ 阶段规划会话受阻(隐性阻塞,请检查后重新运行):\n${planned.question}`)
          return 2
        }
        // 自动编号: 规划成功即把编号记录推进到本次最大编号 + 1(只增不减),
        // 后续阶段/轮次的规划会话自该记录续接,编号在目标目录永不重复。
        if (numberStart !== undefined) {
          const next = await advanceNextTask(directory, (await load(path)).tasks.map((task) => task.id))
          log(`✓ 编号记录推进: 下一可用任务编号 T-${String(next).padStart(3, "0")}(${NEXT_TASK_FILE})`)
        }
        log(`✓ 阶段规划完成: PLAN.md 已填入 ${planned} 个任务`)
        return 0
      } finally {
        await reprotect(path)
      }
    }

    // 阶段交接(F 节,stable-refs P2 起 docs 永不移动): ① 蒸馏会话(AI 唯一职责,
    // 旁路一次性)产出永久路径 docs/handovers/R<N>-<字母>-<slug>.md(driver 先建目录,
    // 落定不移动)→ ② PLAN.md 拷贝进归档目录后重置空模板(归档只收过期状态文件,
    // 本阶段 docs/ 产物不动)→ ③ 台账追加 → ④ 统一提交(Auto-Stage:
    // phase-transition)。各步幂等,中断重跑自然续完(C.2)。返回 0 = 交接完成,
    // 2 = 蒸馏会话隐性阻塞。
    const handoverPhase = async (phase: Phase): Promise<number> => {
      const letters = [...phases] as Phase[]
      const nextLetter = letters[letters.indexOf(phase) + 1]
      const next = nextLetter ? `${nextLetter} ${phaseText(nextLetter)}` : undefined
      const target = next ?? "流程完成"
      banner(`阶段交接: ${phase} ${phaseText(phase)} → ${target}`)
      // driver 先建 handovers/ 目录再开会话;handoverDoc 不在 protect 名单,无需 allowWrite。
      const handover = handoverDoc(await currentRound(directory), phase)
      const handoverFile = join(directory, handover)
      await mkdir(dirname(handoverFile), { recursive: true })
      log(`▶ 开交接蒸馏会话产出 ${handover}`)
      const distilled = await requireArtifact(
        serverHandle.client,
        { id: "PLAN", title: `阶段交接蒸馏(${phase} ${phaseText(phase)})`, status: "in_progress", attempts: 0, body: "" },
        renderPhaseHandover({ phase, handover, next, verify: opts.verify }),
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
          artifact: `有效交接文档 ${handover}(四个必备小节齐备)`,
          detail: "缺失或小节不全",
          requirement:
            `必须把交接文档写入 ${handover},并包含标题逐字为` +
            "「## 关键决策」「## 约束与坑」「## 下一阶段必读清单」「## 产物索引」的四个小节。",
          commit: { stage: "phase-handover", subject: `PLAN handover ${phase} ${phaseText(phase)}` },
          reset: () => rm(handoverFile, { force: true }),
          collect: async () => {
            const text = await Bun.file(handoverFile).text().catch(() => "")
            return validHandover(text) || undefined
          },
        },
      )
      if (distilled !== true) {
        log(`⏸ 交接蒸馏会话受阻(隐性阻塞,请检查后重新运行):\n${distilled.question}`)
        return 2
      }
      const archivedPlan = join(directory, phaseArchive(phase), "PLAN.md")
      await mkdir(dirname(archivedPlan), { recursive: true })
      await Bun.write(archivedPlan, await Bun.file(path).text())
      await allowWrite(path)
      await Bun.write(path, renderPlanScaffold(opts.verify === true))
      await reprotect(path)
      log("  本阶段 PLAN.md 已归档,PLAN.md 重置为空模板")
      await appendLedger(directory, phase)
      // AGENTS.md 只校验不改写(F.2): 超 150 行在交接提交信息与终端 note 提示人工精简。
      const agentsLines = (await Bun.file(join(directory, "AGENTS.md")).text().catch(() => "")).trimEnd().split("\n").length
      const fat = agentsLines > 150 ? `AGENTS.md ${agentsLines} 行超过 150 行上限,请人工精简` : undefined
      if (fat) log(`ℹ ${fat}`)
      if (opts.commit !== false) {
        await commitTree(directory, { id: "PLAN", title: `阶段交接(${phase} ${phaseText(phase)})` }, {
          stage: "phase-transition",
          subject: `PLAN transition ${phase} ${phaseText(phase)} → ${target}${fat ? `(${fat})` : ""}`,
        })
      }
      return 0
    }

    // --phases 阶段循环(D.1): 推导 currentPhase → PLAN.md 空则开规划会话 → 主循环
    // 执行 → 本阶段任务全 done 交接 → 台账追加推导下一阶段;全部阶段完成退出 0。
    // 台账非法等环境错误退出 1(H 节)。--final-review 终审闭环仅 m 阶段挂接
    // (runTaskLoop 的 finalGate),其余阶段忽略并提示。
    // 步进暂停(phase 边界,OPENCODE_AUTO_STEP ≥ phase): 交接(归档+台账+提交)
    // 完成后、下一轮路由前硬暂停——最后一个阶段暂停后回车即「全部阶段已完成」退出。
    const handoverWithStep = async (phase: Phase): Promise<number> => {
      const code = await handoverPhase(phase)
      if (code !== 0) return code
      await stepPause("phase", `阶段 ${phase} ${phaseText(phase)} 交接`, { interactive: repl })
      return 0
    }
    const runPhaseLoop = async (): Promise<number> => {
      if ((opts.finalReview ?? 0) > 0) {
        log("ℹ 终审闭环(--final-review)仅作用于 m(迁移实现)阶段,其余阶段完成时不进入")
      }
      for (;;) {
        const route = await routePhase(directory, await load(path), phases)
        if (route.type === "blocked") {
          log(`⏸ 阶段流程受阻: ${route.reason}`)
          return 1
        }
        if (route.type === "complete") {
          log("✓ 全部阶段已完成")
          return 0
        }
        if (route.type === "plan") {
          // 交接中断恢复(C.2 幂等性): 归档目录内已有归档 PLAN.md 而台账未记录 =
          // 交接在"重置 PLAN.md 之后、台账追加之前"中断——补写台账并提交,不重新
          // 规划本阶段(更早中断时 PLAN.md 仍有任务,路由为 handover,完整重跑交接)。
          const interrupted =
            (await stat(join(directory, phaseArchive(route.phase), "PLAN.md")).then(() => true, () => false)) &&
            !(await readLedger(directory)).done.includes(route.phase)
          if (interrupted) {
            log(`↻ 恢复中断: ${route.phase} ${phaseText(route.phase)} 阶段交接已归档与重置,补写台账后进入下一阶段`)
            await appendLedger(directory, route.phase)
            if (opts.commit !== false) {
              await commitTree(directory, { id: "PLAN", title: `阶段交接(${route.phase} ${phaseText(route.phase)})` }, {
                stage: "phase-transition",
                subject: `PLAN transition ${route.phase} ${phaseText(route.phase)}(中断恢复补账)`,
              })
            }
            continue
          }
          // k(知识提炼)阶段整体认领 --extract-knowledge 设计(P4): 不开规划会话、
          // 不向 PLAN.md 填任务——plan 路由直接进入知识提取旁路会话(产物
          // docs/migration-kb/R<N>-…,永久路径不随交接移动;本轮前缀文档已产出则
          // 幂等跳过),随后照常交接。提取失败只打 ⚠ 警告、不污染退出码(迁移成功
          // 不被文档生成失败反向污染);人工在 k 阶段自行向 PLAN.md 填任务时走通用
          // execute/handover 路由,提取挂点不触发。
          if (route.phase === "k") {
            banner("k 知识提炼: 迁移知识沉淀")
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
            if (extracted.type === "ok") log(`✓ 迁移知识文档已产出: ${extracted.file}`)
            else if (extracted.type === "skipped") log(`↻ 迁移知识文档已产出(${extracted.file}),跳过提取,直接进入交接`)
            else {
              log(
                `⚠ 迁移知识沉淀未完成(knowledge_extraction_error),退出码不受影响,k 阶段照常交接;` +
                  `可修复问题后按人工回退规程(删台账 k 行与 docs/migration-kb/ 内本轮 R<N>- 前缀文档)重跑单独重试。受阻详情:\n${extracted.question}`,
              )
            }
            const code = await handoverWithStep("k")
            if (code !== 0) return code
            continue
          }
          banner(`${route.phase} ${phaseText(route.phase)} 阶段规划`)
          const code = await planPhase(route.phase)
          if (code !== 0) return code
          continue
        }
        if (route.type === "execute") {
          const code = await runTaskLoop(route.phase)
          if (code !== 0) return code
          continue
        }
        const code = await handoverWithStep(route.phase)
        if (code !== 0) return code
      }
    }
    return await runPhaseLoop()
  } finally {
    process.off("SIGINT", onSigint)
    repl?.close()
    watcher?.close()
    progress?.close()
    // 托管句柄(managed)的生命周期归调用方,此处不关闭。
    if (!opts.managed) server?.close()
    await unprotect(directory)
  }
}

// --wait-between: 任务完成后、下一任务开始前暂停等待人工;回车(任意输入)
// 立即继续,超时自动继续。与 runner 的 askHuman 一样转发 readline 截获的 ^C,
// 使暂停期间连续两次 Ctrl+C 同样能强制终止。
// --interactive 下改由常驻输入行接收(语义不变),避免两个 readline 争抢 stdin。
async function waitBetweenTasks(minutes: number, nextID: string, repl?: Interactive) {
  const promptText = `⏸ 任务间暂停: 回车立即开始 ${nextID},或等待 ${minutes} 分钟自动继续: `
  if (repl) {
    const answer = await repl.question(promptText, minutes)
    log(answer === undefined ? `⏳ 等待超时,自动继续 ${nextID}` : `→ 人工确认,继续 ${nextID}`)
    return
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  rl.on("SIGINT", () => process.kill(process.pid, "SIGINT"))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const answer = await Promise.race([
      rl.question(promptText),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), minutes * 60_000)
      }),
    ])
    log(answer === undefined ? `⏳ 等待超时,自动继续 ${nextID}` : `→ 人工确认,继续 ${nextID}`)
  } finally {
    clearTimeout(timer)
    rl.close()
  }
}

// Verbose mode: every 10s list files newly appearing in `git status`
// (modified, staged, or untracked), so a human watching the terminal can
// follow the agent's progress on disk.
function watchFiles(directory: string) {
  let seen = new Set<string>()
  const timer = setInterval(async () => {
    const changed = await gitChangedFiles(directory).catch(() => [] as string[])
    const fresh = changed.filter((file) => !seen.has(file))
    seen = new Set(changed)
    if (fresh.length) vlog(`  ✎ 变更文件:\n${fresh.map((file) => `    ${file}`).join("\n")}`)
  }, 10_000)
  return { close: () => clearInterval(timer) }
}

// 变动文件只取 git status 的输出:目标目录自身(可能位于更大的仓库中,
// 用 pathspec `-- .` 限定该子树)加上所有含 .git 的子目录(嵌套仓库,
// 含 worktree/子模块的 .git 文件;仓库发现复用 src/git.ts 的 repoRoots)。
// 返回相对目标目录的路径。
async function gitChangedFiles(directory: string): Promise<string[]> {
  const lists = await Promise.all((await repoRoots(directory)).map((root) => gitStatusFiles(directory, root)))
  return lists.flat()
}

// --porcelain -z --no-renames -uall: 逐文件 NUL 分隔输出,不带改名箭头;每条为
// "XY <path>",路径相对仓库根(worktree 顶层),需换算为相对目标目录的路径。
// -uall 下仍以 "?? dir/" 折叠输出的只有嵌套仓库目录(其内部文件由该仓库自身
// 的 status 单独列出),跳过以免重复。
async function gitStatusFiles(directory: string, root: string): Promise<string[]> {
  const top = Bun.spawn(["git", "-C", root, "rev-parse", "--show-toplevel"], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const toplevel = (await new Response(top.stdout).text()).trim()
  if ((await top.exited) !== 0 || !toplevel) return []
  const proc = Bun.spawn(
    ["git", "-C", root, "status", "--porcelain", "-z", "--no-renames", "-uall", "--", "."],
    { stdout: "pipe", stderr: "ignore" },
  )
  const output = await new Response(proc.stdout).text()
  if ((await proc.exited) !== 0) return []
  return output
    .split("\0")
    .filter((entry) => entry && !(entry.startsWith("?? ") && entry.endsWith("/")))
    .map((entry) => relative(directory, join(toplevel, entry.slice(3))))
}

// 每 10 分钟重读 PLAN.md,上报当前任务的子任务勾选进度与剩余时间估计(估计为
// 已完成项的线性外推,精度受该检查间隔约束)。
function trackSubtasks(path: string) {
  let current = { id: "", since: 0 }
  const timer = setInterval(async () => {
    const plan = await load(path).catch(() => undefined)
    const task = plan && (plan.tasks.find((t) => t.status === "in_progress") ?? next(plan))
    if (!task) return
    if (task.id !== current.id) current = { id: task.id, since: Date.now() }
    const { done, total } = countSubtasks(task.body)
    if (!total) return
    const elapsed = Date.now() - current.since
    const estimate = done ? formatDuration((elapsed / done) * (total - done)) : "未知(尚无已完成的子任务)"
    log(`  ⏳ ${task.id} 子任务进度 ${done}/${total},已用时 ${formatDuration(elapsed)},预计剩余 ${estimate}`)
  }, 10 * 60_000)
  return { close: () => clearInterval(timer) }
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  if (!minutes) return `${seconds} 秒`
  return `${minutes} 分 ${seconds % 60} 秒`
}

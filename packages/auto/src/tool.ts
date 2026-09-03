// 专用二次迁移工具的主编排(设计文档 docs/specialized-tool-design.md): 无子命令,
// 每次启动按"前置知识提取 → 参数推断 → 完整 admtvk 二次迁移"自动推进至结束;
// 中断后再次运行依推导式状态(台账 + PLAN.md + .auto/progress.json + 本模块的
// .auto/tool.json 完成标记)从断点恢复。index.ts 只做参数解析与配置固化/冲突
// 校验,然后委托本模块。
import { rm, stat } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import { formatProjectConfig, saveProjectConfig, type ProjectConfig } from "./config"
import { extractPriorKnowledge } from "./knowledge"
import { banner, log } from "./log"
import { runAll } from "./loop"
import type { ModeSpec } from "./mode"
import { parse } from "./plan"
import { archiveRound, currentRound, formatPhases, PHASE_ORDER, readLedger, renderPlanScaffold } from "./phases"
import { renderInferSource } from "./prompt"
import type { PermissionMode } from "./runner"
import { requireArtifact } from "./runner"
import { manage } from "./server"
import { renderText, usePromptLibrary } from "./template"
import templateConfig from "../templates/opencode.json" with { type: "file" }
import templateAgent from "../templates/.opencode/agent/auto.md" with { type: "file" }

// 完成标记(非版本化,设计文档 §1): 二次迁移全部完成后写入 {done: true};
// 再次运行报告完成并退出 0。删除该文件可显式开启新一轮。
const STATE_FILE = join(".auto", "tool.json")

export type ToolState = { done?: boolean }

export async function readToolState(dir: string): Promise<ToolState> {
  const state = (await Bun.file(join(dir, STATE_FILE)).json().catch(() => undefined)) as ToolState | undefined
  return state && typeof state === "object" ? state : {}
}

async function writeToolState(dir: string, state: ToolState): Promise<void> {
  await Bun.write(join(dir, STATE_FILE), JSON.stringify(state) + "\n")
}

// 参数推断会话的产物协议(.auto/infer.json,设计文档 §4): 成功形态三键均为相对
// 工作目录、不含 .. 的非空相对路径;blocked 形态表示 AI 无法可靠推断(合法产物,
// 由调用方转阻塞退出)。非法 JSON/缺键/路径越界 → undefined(视为未产出,带反馈
// 重试一次)。
export function parseInferOutput(
  text: string,
): { sourceDir: string; sourcePath: string; destDir: string } | { blocked: string } | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined
  const record = parsed as Record<string, unknown>
  if (record.blocked !== undefined) {
    return typeof record.blocked === "string" && record.blocked.trim() ? { blocked: record.blocked.trim() } : undefined
  }
  const rel = (value: unknown) =>
    typeof value === "string" && value.trim() && !isAbsolute(value) && !value.split(/[\\/]+/).includes("..") ? value : undefined
  const sourceDir = rel(record.sourceDir)
  const sourcePath = rel(record.sourcePath)
  const destDir = rel(record.destDir)
  if (!sourceDir || !sourcePath || !destDir) return undefined
  return { sourceDir, sourcePath, destDir }
}

// 占位模板态判定(沿用原 init 语义): PLAN.md 仅含从未编辑的占位任务视为缺失,
// 以空模板重建交给阶段规划会话。解析失败视为非占位态(保留)。
function isPristinePlan(text: string): boolean {
  try {
    const tasks = parse("PLAN.md", text).tasks
    return tasks.length > 0 && tasks.every((task) => task.title === "<任务标题>" && task.status === "pending" && !task.attempts && !task.verify && !task.verified && !task.question)
  } catch {
    return false
  }
}

// 主流程。input.config 为生效配置(首跑已固化/再跑已经冲突校验);除 brief 与
// 推断写回外本模块不改配置。返回进程退出码(语义与行为约定一致)。
export async function runTool(
  directory: string,
  input: {
    config: ProjectConfig
    mode: ModeSpec
    // 首次运行(配置文件刚由本次创建): 打印一次性提示(如 v 阶段与 verify 正交)。
    firstRun: boolean
    // -p/--prompt 文本: 每次运行均可整写覆盖 .opencode/auto/brief.md。
    brief?: string
    server?: string
    verbose?: boolean
    interactive?: boolean
    waitAnswer?: number
    waitBetween?: number
    review?: number
    early?: boolean
    permission?: PermissionMode
    dryrun?: boolean
    finalReview?: number
  },
): Promise<number> {
  // 提示词库最先装载(协议校验失败按用法错误退出),前置会话与 runAll 都依赖它。
  try {
    usePromptLibrary(directory)
  } catch (error) {
    log(error instanceof Error ? error.message : String(error))
    return 1
  }
  const config = { ...input.config }

  // 模板维护(每次运行幂等): PLAN.md 缺失/占位态 → 空模板(阶段化流程由规划会话
  // 填充);opencode.json 缺失才创建;agent 契约与模板不一致即替换(契约漂移以
  // 模板为准)。PLAN.md 按 verify 条件渲染(验收未启用时不含 verify 描述)。
  {
    const planFile = resolve(directory, "PLAN.md")
    const existing = await Bun.file(planFile).text().catch(() => undefined)
    if (existing === undefined || isPristinePlan(existing)) {
      await Bun.write(planFile, renderPlanScaffold(config.verify))
      log(existing === undefined ? "已创建: PLAN.md(空模板,由阶段规划会话填充)" : "已替换: PLAN.md(占位模板换为空模板,由阶段规划会话填充)")
    }
    const opencodeFile = resolve(directory, "opencode.json")
    if (!(await Bun.file(opencodeFile).exists())) {
      await Bun.write(opencodeFile, await Bun.file(templateConfig).text())
      log("已创建: opencode.json")
    }
    const agentRaw = await Bun.file(templateAgent).text()
    const agentFile = resolve(directory, ".opencode", "agent", "auto.md")
    const agentContent = renderText(agentRaw, { verify: config.verify, testByDriver: config.testByDriver })
    if ((await Bun.file(agentFile).text().catch(() => undefined)) !== agentContent) {
      await Bun.write(agentFile, agentContent)
      log("已写入: .opencode/agent/auto.md(与模板保持一致)")
    }
  }

  // -p/--prompt: 项目意图整写覆盖 brief.md(版本化、人工可编辑,阶段规划会话与
  // 前置会话消费);不传则保留既有。
  if (input.brief !== undefined) {
    await Bun.write(join(directory, ".opencode", "auto", "brief.md"), input.brief.trimEnd() + "\n")
    log("已写入: .opencode/auto/brief.md(项目意图)")
  }

  if (input.firstRun && !config.verify) {
    log("ℹ 流程含 v(验收)阶段而任务级验收未启用: v 阶段任务自身即检验、不受影响,其余阶段任务将不做任务级三段式验收(如需启用: 编辑 .opencode/auto/config.json 的 verify 为 true)")
  }

  log(`⚙ 项目配置(.opencode/auto/config.json): ${formatProjectConfig(config)}`)
  if (config.testByDriver) {
    log(
      `⚙ 测试由 driver 执行: 会话把脚本放 test/、把脚本路径写入 tmp/test.sh 请求执行,driver 合并 stdout/stderr 落 tmp/test.<n>.out 并反馈回会话判断` +
        (config.handoverTest ? ";测试失败且上下文达上限时写交接文档换新会话" : ""),
    )
  }

  // 完成标记: 二次迁移已全部完成 → 报告完成,退出 0(决策 4)。
  const state = await readToolState(directory)
  if (state.done) {
    log("✓ 二次迁移已全部完成(删除 .auto/tool.json 可显式开启新一轮)")
    return 0
  }

  // 全程一个 server 实例: 前置会话与 runAll 共用(runAll 经 managed 注入,不再
  // 自行拉起/关闭)。
  const server = await manage(directory, input.server)
  try {
    if (!input.dryrun) {
      // 归档上一轮: 仅在本工具从未建立完成标记、且台账已覆盖 admtvk 全部字母时——
      // 既有完整轮次是"已有迁移结果"(知识提取的输入),不是本轮的工作;归档后
      // 台账与 PLAN.md 重置,本轮从头规划。台账未覆盖全部字母的既有轮次视为进行
      // 中的本轮,由 runAll 续跑完成(断点恢复)。标记存在时永不归档(台账满 =
      // 本轮刚跑完,由下方退出码写 done)。
      if (!(await Bun.file(join(directory, STATE_FILE)).exists())) {
        const ledger = await readLedger(directory)
        if (PHASE_ORDER.split("").every((letter) => (ledger.done as string[]).includes(letter))) {
          const round = await archiveRound(directory)
          log(`✓ 已有完整迁移轮次(第 ${round} 轮)已归档: docs/phases/round-${round}/;其结论将作为本轮输入`)
          await Bun.write(resolve(directory, "PLAN.md"), renderPlanScaffold(config.verify))
        }
      }

      // 前置知识提取(设计文档 §3): 已有迁移结果的蒸馏产物 docs/prior-kb/,
      // 是本轮首个阶段规划会话与参数推断的输入。失败仅警告后继续(决策 3)。
      banner("前置知识提取: 已有迁移结果复盘")
      const brief = await Bun.file(join(directory, ".opencode", "auto", "brief.md")).text().catch(() => undefined)
      const extracted = await extractPriorKnowledge(server.client, directory, {
        agent: config.agent,
        dir: directory,
        verbose: input.verbose,
        waitAnswer: input.waitAnswer,
        commit: config.commit,
        contextLimit: config.contextLimit * 1000,
        permission: input.permission,
        server,
        mode: input.mode,
      }, brief)
      if (extracted.type === "ok") log(`✓ 前置知识文档已产出: ${extracted.file}`)
      else if (extracted.type === "skipped") log(`↻ 前置知识文档已存在(${extracted.file}),跳过提取`)
      else log(`⚠ 前置知识提取未完成,继续推进(参数推断会话可直读原始 docs/)。受阻详情:\n${extracted.question}`)

      // 参数推断(设计文档 §4): source/destDir 任一缺失时,AI 依据前置知识与目录
      // 勘察推断,结论经 .auto/infer.json 协议回传,driver 校验后仅采纳缺失键并
      // 固化进配置(二次执行自然与首次对齐);AI 报 blocked 或会话受阻 → 退出码 2。
      if (!config.source || !config.destDir) {
        const inferFile = join(".auto", "infer.json")
        const known = [
          config.source && `- 迁移源: 源系统目录 ${config.source.dir},源模块相对路径 ${config.source.path}`,
          config.destDir && `- 迁移目标目录: ${config.destDir}`,
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n")
        log("▶ 开参数推断会话(迁移源/目标未完全固化)")
        const inferred = await requireArtifact(
          server.client,
          { id: "PLAN", title: "迁移参数推断(源/目标)", status: "in_progress", attempts: 0, body: "" },
          renderInferSource({ file: inferFile, brief, priorKb: extracted.type === "failed" ? undefined : `- ${extracted.file}`, known }),
          {
            agent: config.agent,
            dir: directory,
            verbose: input.verbose,
            waitAnswer: input.waitAnswer,
            commit: config.commit,
            contextLimit: config.contextLimit * 1000,
            permission: input.permission,
            server,
            mode: input.mode,
          },
          {
            kind: "参数推断",
            artifact: `有效结论文件 ${inferFile}`,
            detail: "缺失、非法 JSON 或路径校验失败",
            requirement:
              `必须把结论整写为 ${inferFile}: 单个 JSON 对象,成功形态 ` +
              `{"sourceDir","sourcePath","destDir"}(均为相对工作目录、不含 .. 的相对路径,` +
              `sourceDir 须为现存目录且 sourcePath 在其下存在),无法推断形态 {"blocked": "原因"}。`,
            commit: { stage: "infer", subject: "PLAN infer 迁移参数推断" },
            reset: () => rm(join(directory, inferFile), { force: true }),
            collect: async () => {
              const parsed = parseInferOutput(await Bun.file(join(directory, inferFile)).text().catch(() => ""))
              if (!parsed || "blocked" in parsed) return parsed
              const dirIsDir = await stat(join(directory, parsed.sourceDir)).then((s) => s.isDirectory(), () => false)
              const pathExists = await stat(join(directory, parsed.sourceDir, parsed.sourcePath)).then(() => true, () => false)
              return dirIsDir && pathExists ? parsed : undefined
            },
          },
        )
        if ("question" in inferred) {
          log(`⏸ 参数推断会话受阻(隐性阻塞,请检查后重新运行):\n${inferred.question}`)
          return 2
        }
        if ("blocked" in inferred) {
          log(`⏸ 无法可靠推断迁移源/目标参数: ${inferred.blocked}\n请显式给出(--source-dir <目录> --source-path <相对路径> --dest-dir <相对路径>)或直接编辑 .opencode/auto/config.json 后重新运行`)
          return 2
        }
        if (!config.source) config.source = { dir: inferred.sourceDir, path: inferred.sourcePath }
        if (!config.destDir) config.destDir = inferred.destDir
        await saveProjectConfig(directory, config)
        log(`✓ 迁移参数已推断并固化: 源 ${config.source.dir}/${config.source.path} → 目标 ${config.destDir}`)
      }
    }

    // 阶段进度行(✓=台账已记录,▶=当前;续轮归档存在时带轮次标注)。台账非法
    // 仅提示,硬失败在 runAll 的阶段路由预检。
    try {
      const round = await currentRound(directory)
      log(`阶段${round > 1 ? `(第 ${round} 轮)` : ""}: ${formatPhases(PHASE_ORDER, (await readLedger(directory)).done)}`)
    } catch (error) {
      log(`⚠ 阶段台账(docs/phases.md)非法: ${error instanceof Error ? error.message : String(error)}`)
    }

    const code = await runAll(directory, {
      agent: config.agent,
      verbose: input.verbose,
      waitAnswer: input.waitAnswer,
      waitBetween: input.waitBetween,
      commit: config.commit,
      subtask: config.subtask,
      dryrun: input.dryrun,
      contextLimit: config.contextLimit * 1000,
      review: input.review,
      early: input.early,
      verify: config.verify,
      permission: input.permission,
      interactive: input.interactive,
      idleMs: config.idleTime * 60_000,
      maxMs: config.idleMax > 0 ? config.idleMax * 60_000 : undefined,
      testByDriver: config.testByDriver,
      handoverTest: config.handoverTest,
      mode: input.mode,
      finalReview: input.finalReview,
      // 流程固定为完整 admtvk(设计文档 §2: config.phases 键保留在 schema 中,
      // 工具恒定以此驱动)。
      phases: PHASE_ORDER,
      source: config.source,
      destDir: config.destDir,
      managed: server,
    })
    if (code === 0 && !input.dryrun) await writeToolState(directory, { done: true })
    return code
  } finally {
    server.close()
  }
}

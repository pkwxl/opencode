// 任务收尾会话(wrapup): runner 主收尾与 review 修复轮收尾两处调用点共用。
// 会话后的 report.md 存在性 + 形检门禁(session-boundary-hardening 设计 §4.5 D5,
// S3b)——此前 wrapup 会话后无任何产物校验(runSession 结束直接 afterSession 提交),
// 空壳/截断报告静默通过;report.md 是跨任务收尾叙事载体(L2 压制对象),截断/空壳
// 在此直接放大事故面。存在/非平凡/末行终止符任一不过 → 带反馈重提示一次 → 仍不过
// → blocked(隐性阻塞)。只查本次会话产出,不追溯存量。
// 依赖方向: 位于 session/unit-commit 之上、runner 与 review 之下(module-split-plan §D.2)。

import { dirname, join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import type { SessionChain } from "./chain"
import { docShapeProblems, EOF_MARK } from "./doccheck"
import { taskDoc } from "./docpaths"
import { autobanner, log } from "./log"
import type { Opts, UnitStop } from "./opts"
import type { Plan, Task } from "./plan"
import { renderWrapup } from "./prompt"
import { runSession } from "./session"
import { forkEndedSession } from "./session-api"
import { afterSession, commitBlocked, wrapupResolves } from "./unit-commit"

// report.md 形检问题清单(空 = 通过): 路径 driver 已知固定(wrapup 模板定死
// docs/<id>/report.md),无需声明清单;缺失/为空单列一案,存在则过非平凡 + 终止符。
async function reportProblems(dir: string, task: Task): Promise<string[]> {
  const rel = taskDoc(task.id, "report")
  const text = await Bun.file(join(dir, rel)).text().catch(() => "")
  if (!text.trim()) return [`${rel} 缺失或为空`]
  return docShapeProblems(text, rel)
}

// 跑一次任务收尾会话并收口: 横幅/subject/resolves 组装 + runSession + report.md
// 门禁 + 统一提交。label 为提交失败时的单元名(runner 主收尾「收尾会话」/review
// 修复轮「修复后收尾会话」);solo 为 off/ondemand 整任务模式(报告为产出摘要而非
// 索引式)。返回 undefined = 收尾完成。
export async function runWrapup(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
  input: { solo: boolean; label: string },
): Promise<UnitStop | undefined> {
  const dir = opts.dir ?? dirname(plan.path)
  autobanner(`${task.id} ${task.title}: 收尾`)
  const subject = `${task.id} wrapup ${task.title}`
  chain.subject = subject
  const resolves = await wrapupResolves(dir, task.id)
  let feedback = ""
  // 形检重提示经 fork 刚结束的会话下发时(2026-09-18 修订),下一回合只带反馈
  // 本身——副本已含完整提示词与全部收尾上下文,重发整份只会诱导从头重做。
  let shapeForked = false
  for (let i = 0; ; i++) {
    const brief = shapeForked
    shapeForked = false
    const result = await runSession(
      client,
      task,
      brief ? feedback.trimStart() : renderWrapup(plan, task, { mode: opts.mode, verify: opts.verify, solo: input.solo, resolves }) + feedback,
      opts,
      chain,
    )
    if (result.type === "blocked") return result
    const problems = await reportProblems(dir, task)
    if (!problems.length) {
      const committed = await afterSession(dir, opts, task, { stage: "wrapup", subject })
      if (committed.type === "failed") return commitBlocked(`${task.id} ${input.label}`, committed)
      return undefined
    }
    const rel = taskDoc(task.id, "report")
    if (i === 1) {
      return {
        type: "blocked",
        question:
          `收尾会话两次结束但 ${rel} 未过检查(${problems.join("; ")},隐性阻塞)。` +
          `请检查该文件后重新运行。Agent 最后的输出:\n${result.lastText.trim().slice(-2000) || "(无输出)"}`,
      }
    }
    feedback =
      `\n\n你上次结束会话但 ${rel} 未过检查: ${problems.join("; ")}。这是硬性要求:` +
      `把任务报告写入该文件,内容完整并以 \`${EOF_MARK}\` 独占最后一行正文后再结束会话。`
    // 重提示基于刚结束的会话 fork 续做(带全部收尾上下文);fork 不可用回退
    // 全新会话 + 完整提示词。
    shapeForked = await forkEndedSession(client, chain, subject)
    log(`↻ ${task.id} 收尾会话产出的 ${rel} 未过检查,${shapeForked ? "已从原会话分叉、" : ""}带反馈重试一次`)
  }
}

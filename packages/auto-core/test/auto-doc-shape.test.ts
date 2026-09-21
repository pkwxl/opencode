// 自动会话产物形检(D5)的单测(session-boundary-hardening 设计 §4.5/S3b):
// 合并理解与分解会话(M1.0,plans/0030)在「存在性 + 重试环」上校验四组产物
// (context.md/shared.md/subtasks.md/各子任务 todo.md 非平凡 + 末行终止符);
// wrapup(src/wrapup.ts runWrapup,runner 主收尾与 review 修复轮共用)新增存在性 +
// 形检门禁。不过 → 带反馈重提示一次 → 仍不过 → blocked;「已存在即跳过/直接注入」
// 路径不受影响(只查本次会话产出,不追溯存量)。
// 走完整 runSession 链路(fake client + 真实 git 仓库),替 AI 落盘的脚本写在事件流
// 生成器里(与 subtask-shape.test.ts 同款接线)。

import { rm } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import type { SessionChain } from "../src/chain"
import { EOF_MARK } from "../src/doccheck"
import { ensureDecomposed } from "../src/execute"
import type { Opts } from "../src/opts"
import { load, subtasks } from "../src/plan"
import { runWrapup } from "../src/wrapup"
import { fakeClient, freshRepo, git } from "./fixtures/runner"

// 干净 git 仓库 + 已提交的 PLAN.md(无检查项的正文)与 README;.auto/ 忽略,
// 统计/进度落盘不污染提交。
async function docRepo(): Promise<string> {
  const dir = await freshRepo()
  await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
  await Bun.write(join(dir, "README.md"), "# 示例\n\n背景说明。\n")
  await Bun.write(join(dir, "PLAN.md"), "## T-001: 示例任务 [in_progress]\n\n正文。\n")
  await git(dir, "add", "-A")
  await git(dir, "commit", "-q", "-m", "init")
  return dir
}

const makeChain = (): SessionChain => ({ pct: 10, used: 0, at: 0 })

// 每回合会话的替身脚本: 事件流建立时执行一次(第 n 回合消费 scripts[n-1],清单
// 耗尽后重复末份——「仍不补正」的形态),随后立即 idle 结束回合。
function scriptedClient(scripts: Array<() => Promise<unknown>>) {
  let round = 0
  return fakeClient({
    events: (sid) =>
      (async function* () {
        const script = scripts[Math.min(round++, scripts.length - 1)]
        if (script) await script()
        yield { type: "session.idle", properties: { sessionID: sid } }
      })(),
  })
}

const promptText = (call: { parts: unknown[] }): string => String((call.parts[0] as { text?: string } | undefined)?.text ?? "")

// 非平凡且末行终止符合规的文档正文素材。
const filler = "占位素材甲乙丙。".repeat(30)
const contextProper = `# 理解\n\n## 相关文件与关键符号\n\n${filler}\n\n## 约束与前提\n\n无。\n\n## 已有决策与现状\n\n无。\n\n## 风险与未知\n\n无。\n\n${EOF_MARK}\n`
const sharedProper = `# 公共上下文索引\n\n- src/x.ts: 数据模型入口。\n\n${filler}\n\n${EOF_MARK}\n`
const subtasksProper = `# 分解\n\n- [ ] 子任务甲 产出: docs/T-001/S01/index.md\n\n${filler}\n\n${EOF_MARK}\n`
const todoProper = `# S01: 子任务甲\n\n## Scope\n\n${filler}\n\n## Artifacts\n\n- docs/T-001/S01/index.md\n\n${EOF_MARK}\n`
const reportProper = `# 报告\n\n${filler}\n\n${EOF_MARK}\n`

// 合并理解与分解会话(M1.0)的全部合规产物。
async function writeMergedArtifacts(dir: string) {
  await Bun.write(join(dir, "docs/T-001/context.md"), contextProper)
  await Bun.write(join(dir, "docs/T-001/shared.md"), sharedProper)
  await Bun.write(join(dir, "docs/T-001/subtasks.md"), subtasksProper)
  await Bun.write(join(dir, "docs/T-001/S01/todo.md"), todoProper)
}

describe("ensureDecomposed 合并理解与分解产物形检(D5,M1.0)", () => {
  test("分解结果已存在(旧版产物,无终止符): 直接注入检查项,不开会话", async () => {
    const dir = await docRepo()
    try {
      await Bun.write(join(dir, "docs/T-001/subtasks.md"), "# 分解\n\n- [ ] 子任务甲\n")
      const { client, calls } = scriptedClient([])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await ensureDecomposed(client, plan, plan.tasks[0]!, { dir, commit: true }, makeChain())
      expect(result.type).toBe("ok")
      expect(calls.prompts.length).toBe(0)
      const reloaded = await load(join(dir, "PLAN.md"))
      expect(subtasks(reloaded.tasks[0]!.body).map((item) => item.text)).toEqual(["子任务甲"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("context.md 已存在但无分解产物: 合并会话仍运行(摘要存在不再幂等跳过)", async () => {
    const dir = await docRepo()
    try {
      await Bun.write(join(dir, "docs/T-001/context.md"), contextProper)
      const { client, calls } = scriptedClient([async () => writeMergedArtifacts(dir)])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await ensureDecomposed(client, plan, plan.tasks[0]!, { dir, commit: true }, makeChain())
      expect(result.type).toBe("ok")
      expect(calls.prompts.length).toBe(1)
      expect(subtasks((await load(join(dir, "PLAN.md"))).tasks[0]!.body).map((item) => item.text)).toEqual([
        "子任务甲 产出: docs/T-001/S01/index.md",
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("产物齐全但 subtasks.md 缺末行终止符: 带反馈重试一次,补正后注入并按 decompose 提交", async () => {
    const dir = await docRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await writeMergedArtifacts(dir)
          await Bun.write(join(dir, "docs/T-001/subtasks.md"), `# 分解\n\n- [ ] 子任务甲\n\n${filler}\n`)
        },
        async () => writeMergedArtifacts(dir),
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await ensureDecomposed(client, plan, plan.tasks[0]!, { dir, commit: true }, makeChain())
      expect(result.type).toBe("ok")
      expect(calls.prompts.length).toBe(2)
      // 重提示基于刚结束的会话 fork 下发,只带反馈本身(2026-09-18 修订)。
      expect(calls.forks).toEqual(["ses_new_1"])
      expect(calls.prompts[1]!.sessionID).toBe("ses_fork_1")
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("did not pass checks")
      expect(feedback).toContain("missing last-line terminator")
      expect(feedback).toContain(EOF_MARK)
      expect(feedback).not.toContain("Relevant files and key symbols") // 不重发整份合并提示词
      const reloaded = await load(join(dir, "PLAN.md"))
      expect(subtasks(reloaded.tasks[0]!.body).map((item) => item.text)).toEqual(["子任务甲 产出: docs/T-001/S01/index.md"])
      // 合并会话成功即记录 session 模式 fork 基点(plans/0030 D4)
      expect(reloaded.tasks[0]!.forkBase).toBe("ses_fork_1")
      const message = await git(dir, "log", "-1", "--format=%B")
      expect(message).toContain("Auto-Stage: decompose")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("子任务 todo.md 缺失: 反馈点名该状态文件,补正后注入", async () => {
    const dir = await docRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await writeMergedArtifacts(dir)
          await rm(join(dir, "docs/T-001/S01/todo.md"))
        },
        async () => writeMergedArtifacts(dir),
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await ensureDecomposed(client, plan, plan.tasks[0]!, { dir, commit: true }, makeChain())
      expect(result.type).toBe("ok")
      expect(calls.prompts.length).toBe(2)
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("docs/T-001/S01/todo.md")
      expect(feedback).toContain("missing or empty")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("todo.md 缺协议章节锚(M1.4 spec 驱动): 反馈点名缺失章节,补正后注入", async () => {
    const dir = await docRepo()
    try {
      const todoNoList = `# S01: 子任务甲\n\n## Scope\n\n${filler}\n\n${EOF_MARK}\n`
      const { client, calls } = scriptedClient([
        async () => {
          await writeMergedArtifacts(dir)
          await Bun.write(join(dir, "docs/T-001/S01/todo.md"), todoNoList)
        },
        async () => writeMergedArtifacts(dir),
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await ensureDecomposed(client, plan, plan.tasks[0]!, { dir, commit: true }, makeChain())
      expect(result.type).toBe("ok")
      expect(calls.prompts.length).toBe(2)
      expect(promptText(calls.prompts[1]!)).toContain('docs/T-001/S01/todo.md is missing section "## Artifacts"')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("仍不补正 → blocked 引用未过关项,检查项不注入", async () => {
    const dir = await docRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/subtasks.md"), `# 分解\n\n- [ ] 子任务甲\n\n${filler}\n`)
        },
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await ensureDecomposed(client, plan, plan.tasks[0]!, { dir, commit: true }, makeChain())
      expect(result.type).toBe("blocked")
      expect((result as { question: string }).question).toContain("context.md")
      expect(calls.prompts.length).toBe(2)
      const reloaded = await load(join(dir, "PLAN.md"))
      expect(subtasks(reloaded.tasks[0]!.body).length).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("runWrapup 收尾报告门禁(D5,runner 主收尾与 review 修复轮共用)", () => {
  const wrapOpts = (dir: string): Opts => ({ dir, commit: true })

  test("报告缺失: 带反馈重试一次,仍缺 → blocked,不提交", async () => {
    const dir = await docRepo()
    try {
      const { client, calls } = scriptedClient([async () => {}])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await runWrapup(client, plan, plan.tasks[0]!, wrapOpts(dir), makeChain(), { solo: false, label: "收尾会话" })
      expect(result).toMatchObject({ type: "blocked" })
      expect((result as { question: string }).question).toContain("docs/T-001/report.md 缺失或为空")
      expect(calls.prompts.length).toBe(2)
      expect(promptText(calls.prompts[1]!)).toContain("未过检查")
      // 未收口提交: HEAD 仍在 init
      expect((await git(dir, "log", "-1", "--format=%s")).trim()).toBe("init")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("报告缺末行终止符: 带反馈重试一次,补正后通过并按 wrapup 提交", async () => {
    const dir = await docRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/report.md"), `# 报告\n\n${filler}\n`)
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/report.md"), reportProper)
        },
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await runWrapup(client, plan, plan.tasks[0]!, wrapOpts(dir), makeChain(), { solo: false, label: "收尾会话" })
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(2)
      // 重提示基于刚结束的收尾会话 fork 下发(2026-09-18 修订)。
      expect(calls.forks).toEqual(["ses_new_1"])
      expect(calls.prompts[1]!.sessionID).toBe("ses_fork_1")
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("missing last-line terminator")
      expect(feedback).toContain(EOF_MARK)
      const message = await git(dir, "log", "-1", "--format=%B")
      expect(message).toContain("Auto-Stage: wrapup")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("报告合规: 单会话通过并收口提交", async () => {
    const dir = await docRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/report.md"), reportProper)
        },
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await runWrapup(client, plan, plan.tasks[0]!, wrapOpts(dir), makeChain(), { solo: true, label: "修复后收尾会话" })
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(1)
      const message = await git(dir, "log", "-1", "--format=%B")
      expect(message).toContain("Auto-Stage: wrapup")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

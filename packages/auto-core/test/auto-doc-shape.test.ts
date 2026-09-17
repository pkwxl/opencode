// 自动会话产物形检(D5)的单测(session-boundary-hardening 设计 §4.5/S3b):
// understand/decompose 在既有「存在性 + 重试环」上追加非平凡 + 末行终止符;
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
import { ensureDecomposed, ensureUnderstood } from "../src/execute"
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
const subtasksProper = `# 分解\n\n- [ ] 子任务甲 产出: docs/T-001/S01/index.md\n\n${filler}\n\n${EOF_MARK}\n`
const reportProper = `# 报告\n\n${filler}\n\n${EOF_MARK}\n`

describe("ensureUnderstood 理解摘要形检(D5)", () => {
  test("摘要已存在(存量无终止符): 幂等跳过,不开会话、不追溯存量", async () => {
    const dir = await docRepo()
    try {
      await Bun.write(join(dir, "docs/T-001/context.md"), "# 旧摘要\n\n略。\n")
      const { client, calls } = scriptedClient([])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await ensureUnderstood(client, plan, plan.tasks[0]!, { dir, commit: true }, makeChain())
      expect(result.type).toBe("ok")
      expect(calls.prompts.length).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("新建摘要缺末行终止符: 带反馈重试一次,补正后通过并按 understand 提交", async () => {
    const dir = await docRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/context.md"), `# 理解\n\n${filler}\n`)
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/context.md"), contextProper)
        },
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await ensureUnderstood(client, plan, plan.tasks[0]!, { dir, commit: true }, makeChain())
      expect(result.type).toBe("ok")
      expect(calls.prompts.length).toBe(2)
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("未过形检")
      expect(feedback).toContain("末行终止符缺失")
      expect(feedback).toContain(EOF_MARK)
      const message = await git(dir, "log", "-1", "--format=%B")
      expect(message).toContain("Auto-Stage: understand")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("摘要空壳(带终止符但过短)仍不补正 → blocked 引用未过关项", async () => {
    const dir = await docRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/context.md"), `# 理解\n\n(略)\n${EOF_MARK}\n`)
        },
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await ensureUnderstood(client, plan, plan.tasks[0]!, { dir, commit: true }, makeChain())
      expect(result.type).toBe("blocked")
      expect((result as { question: string }).question).toContain("内容过短")
      expect(calls.prompts.length).toBe(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("ensureDecomposed 分解结果形检(D5)", () => {
  test("分解结果已存在(存量无终止符): 直接注入检查项,不开会话", async () => {
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

  test("有检查项但缺末行终止符: 带反馈重试一次,补正后注入并按 decompose 提交", async () => {
    const dir = await docRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/subtasks.md"), `# 分解\n\n- [ ] 子任务甲\n\n${filler}\n`)
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/subtasks.md"), subtasksProper)
        },
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await ensureDecomposed(client, plan, plan.tasks[0]!, { dir, commit: true }, makeChain())
      expect(result.type).toBe("ok")
      expect(calls.prompts.length).toBe(2)
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("未过形检")
      expect(feedback).toContain("末行终止符缺失")
      const reloaded = await load(join(dir, "PLAN.md"))
      expect(subtasks(reloaded.tasks[0]!.body).map((item) => item.text)).toEqual(["子任务甲 产出: docs/T-001/S01/index.md"])
      const message = await git(dir, "log", "-1", "--format=%B")
      expect(message).toContain("Auto-Stage: decompose")
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
      expect((result as { question: string }).question).toContain("末行终止符缺失")
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
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("末行终止符缺失")
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

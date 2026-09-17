// src/execute.ts runSubtask 产物形检(D2/D4)与 src/doccheck.ts 的单测
// (session-boundary-hardening 设计 §4.3/S3): 零落盘→重提示→仍零→blocked;
// 清单缺失/截断→同环;形检全过→正常勾选;dryrun/testHandover 豁免。
// 走完整 runSubtask 链路(fake client + 真实 git 仓库),替 AI 落盘的脚本写在
// 事件流生成器里(与 session.test.ts 的 handoverStream 同款接线)。

import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import type { SessionChain } from "../src/chain"
import { docShapeProblems, endsWithEof, EOF_MARK, MIN_DOC_CHARS, shapeCheckOn } from "../src/doccheck"
import { runSubtask } from "../src/execute"
import type { Opts } from "../src/opts"
import { load, subtasks } from "../src/plan"
import { fakeClient, freshRepo, git } from "./fixtures/runner"

const BODY = "调研并落盘记录 产出: docs/T-001/S01/record.md"

// 干净 git 仓库 + 已提交的 PLAN.md(含声明产出的检查项)与 README;tmp/ 与
// .auto/ 按 loop-preflight 的 ensureGitignore 口径忽略,统计落盘不污染 clean 门禁。
async function shapeRepo(item: string = BODY): Promise<string> {
  const dir = await freshRepo()
  await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
  await Bun.write(join(dir, "README.md"), "# 示例\n\n背景说明。\n")
  await Bun.write(join(dir, "PLAN.md"), `## T-001: 示例任务 [in_progress]\n\n- [ ] ${item}\n`)
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

// 非平凡且末行终止符合规的新建文档(正文占位不含「背景/结论」字样,供章节用例区分)。
const filler = "占位素材甲乙丙。".repeat(30)
const properDoc = `# 记录\n\n${filler}\n\n${EOF_MARK}\n`

describe("doccheck 纯函数(非平凡 + 末行终止符)", () => {
  test("endsWithEof: 终止符独占末行(尾随空行容忍、行内空白容忍、终止符后有正文即不过)", () => {
    expect(endsWithEof(`# 标题\n\n正文\n${EOF_MARK}`)).toBe(true)
    expect(endsWithEof(`# 标题\n\n正文\n${EOF_MARK}\n\n`)).toBe(true)
    expect(endsWithEof(`# 标题\n\n正文\n ${EOF_MARK} \n`)).toBe(true)
    expect(endsWithEof(`# 标题\n\n正文`)).toBe(false)
    expect(endsWithEof(`${EOF_MARK}\n追加在终止符之后\n`)).toBe(false)
    expect(endsWithEof("")).toBe(false)
  })

  test("docShapeProblems: 过短与缺终止符分别成案,阈值边界恰过", () => {
    expect(docShapeProblems(properDoc, "docs/a.md")).toEqual([])
    const atThreshold = `# 标\n\n${"甲".repeat(MIN_DOC_CHARS)}\n${EOF_MARK}\n`
    expect(docShapeProblems(atThreshold, "docs/a.md")).toEqual([])
    const stub = `# 标\n\n略\n${EOF_MARK}\n`
    expect(docShapeProblems(stub, "docs/a.md")).toEqual([`docs/a.md: 内容过短(${stub.trim().length} 字符 < 阈值 ${MIN_DOC_CHARS}),疑似空壳或截断`])
    const long = `# 标\n\n${filler}\n`
    expect(docShapeProblems(long, "docs/a.md")).toEqual([`docs/a.md: 末行终止符缺失(最后一行正文须为 ${EOF_MARK})`])
  })

  test("shapeCheckOn: dryrun / commit off / 空基线(非 git)/ testHandover 收场不启用", () => {
    const baseline = [{ root: "/x", sha: "abc1234" }]
    expect(shapeCheckOn({ commit: true }, baseline, false)).toBe(true)
    expect(shapeCheckOn({ dryrun: true }, baseline, false)).toBe(false)
    expect(shapeCheckOn({ commit: false }, baseline, false)).toBe(false)
    expect(shapeCheckOn({}, undefined, false)).toBe(false)
    expect(shapeCheckOn({}, [], false)).toBe(false)
    expect(shapeCheckOn({}, baseline, true)).toBe(false)
  })
})

describe("runSubtask 产物形检(D2/D4)", () => {
  test("零落盘: 重提示一次(反馈复述权威状态)仍零 → blocked,不勾选", async () => {
    const dir = await shapeRepo()
    try {
      const { client, calls } = scriptedClient([async () => {}])
      const plan = await load(join(dir, "PLAN.md"))
      const opts: Opts = { dir, commit: true }
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, opts, makeChain())
      expect(result).toMatchObject({ type: "blocked" })
      expect((result as { question: string }).question).toContain("零变更")
      expect(calls.prompts.length).toBe(2)
      // 反馈复述权威状态(L1)并直指误判
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("产物形检未过")
      expect(feedback).toContain("T-001.S01")
      expect(feedback).toContain("S01 尚未勾选")
      expect(feedback).toContain("不要据此判断本子任务已完成")
      // 未勾选、未推进
      expect(subtasks((await load(join(dir, "PLAN.md"))).tasks[0]!.body)[0]!.done).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("声明产出缺失(有其他落盘,非零落盘): 重提示后补齐 → 正常勾选", async () => {
    const dir = await shapeRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/notes.md"), "顺带笔记\n")
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
        },
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir, commit: true }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(2)
      expect(promptText(calls.prompts[1]!)).toContain("docs/T-001/S01/record.md 不存在")
      expect(subtasks((await load(join(dir, "PLAN.md"))).tasks[0]!.body)[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("新建文档缺末行终止符(内容非平凡): 重提示后补正 → 勾选", async () => {
    const dir = await shapeRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), `# 记录\n\n${filler}\n`)
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
        },
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir, commit: true }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(2)
      expect(promptText(calls.prompts[1]!)).toContain("末行终止符缺失")
      expect(subtasks((await load(join(dir, "PLAN.md"))).tasks[0]!.body)[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("新建文档空壳(带终止符但过短)且仍不补正 → blocked 引用未过关项", async () => {
    const dir = await shapeRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), `# 记录\n\n(略)\n${EOF_MARK}\n`)
        },
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir, commit: true }, makeChain())
      expect(result).toMatchObject({ type: "blocked" })
      expect((result as { question: string }).question).toContain("内容过短")
      expect(calls.prompts.length).toBe(2)
      expect(subtasks((await load(join(dir, "PLAN.md"))).tasks[0]!.body)[0]!.done).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("声明必填章节缺失 → 同环;补齐后勾选", async () => {
    const body = "写记录 产出: docs/T-001/S01/record.md(背景、结论)"
    const dir = await shapeRepo(body)
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), `# 记录\n\n背景: 见正文。\n结论: 如上。\n${filler}\n${EOF_MARK}\n`)
        },
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await runSubtask(client, plan, plan.tasks[0]!, body, 1, { dir, commit: true }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(2)
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("缺少章节「背景」")
      expect(feedback).toContain("缺少章节「结论」")
      expect(subtasks((await load(join(dir, "PLAN.md"))).tasks[0]!.body)[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("形检全过: 单会话正常勾选并带基线统一提交", async () => {
    const dir = await shapeRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
        },
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir, commit: true }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(1)
      expect(subtasks((await load(join(dir, "PLAN.md"))).tasks[0]!.body)[0]!.done).toBe(true)
      // 单元收口提交发生且带 Auto-Stage trailer
      const message = await git(dir, "log", "-1", "--format=%B")
      expect(message).toContain("Auto-Stage: subtask 1")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("修改型声明产物(已跟踪、无终止符): 存在性恒真,不要求终止符", async () => {
    const body = "更新说明 产出: README.md"
    const dir = await shapeRepo(body)
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "README.md"), "# 示例\n\n背景说明。\n补充一行。\n")
        },
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await runSubtask(client, plan, plan.tasks[0]!, body, 1, { dir, commit: true }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(1)
      expect(subtasks((await load(join(dir, "PLAN.md"))).tasks[0]!.body)[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("dryrun: 零产物自然结束不启用形检,照常勾选", async () => {
    const dir = await shapeRepo()
    try {
      const { client, calls } = scriptedClient([async () => {}])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir, dryrun: true }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(1)
      expect(subtasks((await load(join(dir, "PLAN.md"))).tasks[0]!.body)[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

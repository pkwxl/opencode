// src/execute.ts runSubtask 产物形检(D2/D4/D6)与 src/doccheck.ts 的单测
// (session-boundary-hardening 设计 §4.3/§4.6,S3/S3c): 零落盘→重提示→仍零→blocked;
// 清单缺失/截断→同环;全量文档终止符扫描(修改后 eof 不在末行→拦截、豁免清单、
// 未声明顺带文档);形检全过→正常勾选;dryrun/testHandover 豁免。
// 走完整 runSubtask 链路(fake client + 真实 git 仓库),替 AI 落盘的脚本写在
// 事件流生成器里(与 session.test.ts 的 handoverStream 同款接线)。

import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { opencodeAgent } from "../src/agent/opencode/client"
import type { SessionChain } from "../src/chain"
import { docShapeProblems, endsWithEof, EOF_MARK, eofScanExempt, MIN_DOC_CHARS, shapeCheckOn } from "../src/doccheck"
import { runSubtask } from "../src/execute"
import { unitBaseline, unitChangedFiles } from "../src/git"
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
    expect(docShapeProblems(stub, "docs/a.md")).toEqual([`docs/a.md: content too short (${stub.trim().length} chars < threshold ${MIN_DOC_CHARS}), suspected stub or truncation`])
    const long = `# 标\n\n${filler}\n`
    expect(docShapeProblems(long, "docs/a.md")).toEqual([`docs/a.md: missing last-line terminator (the last line of body text must be ${EOF_MARK})`])
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

  test("eofScanExempt: driver 状态文件(含轮次布局链接目标)/ .auto/ / 交接文档族豁免,普通文档不豁免", () => {
    for (const rel of [
      "PLAN.md",
      "CURRENT.md",
      "docs/R-01/PLAN.md", // 轮次专用目录布局下根 PLAN.md 的符号链接目标
      ".auto/state.md",
      "docs/T-001/handoff.md",
      "docs/T-001/testhandoff.md",
      "docs/T-001/testhandoff-2.md",
      "docs/T-001/S01/testhandoff.md",
      "docs/T-001.testhandoff.md", // 旧平铺名
      "docs/T-001-S2.testhandoff-3.md", // 旧平铺归档份
    ]) {
      expect(eofScanExempt(rel), rel).toBe(true)
    }
    for (const rel of ["docs/T-001/report.md", "docs/T-001/S01/record.md", "README.md", "docs/notes.md"]) {
      expect(eofScanExempt(rel), rel).toBe(false)
    }
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
      expect((result as { question: string }).question).toContain("zero disk writes")
      expect(calls.prompts.length).toBe(2)
      // 反馈复述权威状态(L1)并直指误判
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("artifacts did not pass the shape check")
      expect(feedback).toContain("T-001.S01")
      expect(feedback).toContain("S01 is not ticked yet")
      expect(feedback).toContain("do not judge this subtask complete on that basis")
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
          // 顺带文档同样受 D6 全量扫描约束(须非平凡 + 末行终止符)。
          await Bun.write(join(dir, "docs/notes.md"), `# 顺带笔记\n\n${filler}\n\n${EOF_MARK}\n`)
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
        },
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir, commit: true }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(2)
      expect(promptText(calls.prompts[1]!)).toContain("declared artifact docs/T-001/S01/record.md does not exist")
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
      expect(promptText(calls.prompts[1]!)).toContain("missing last-line terminator")
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
      expect((result as { question: string }).question).toContain("content too short")
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
      expect(feedback).toContain('is missing section "背景"')
      expect(feedback).toContain('is missing section "结论"')
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

  test("修改型声明产物(已跟踪): 存在性恒真,但受 D6 全量扫描约束——改写后缺终止符 → 重提示补正 → 勾选", async () => {
    const body = "更新说明 产出: README.md"
    const dir = await shapeRepo(body)
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "README.md"), "# 示例\n\n背景说明。\n补充一行。\n")
        },
        async () => {
          await Bun.write(join(dir, "README.md"), `# 示例\n\n背景说明。\n\n${filler}\n\n${EOF_MARK}\n`)
        },
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await runSubtask(client, plan, plan.tasks[0]!, body, 1, { dir, commit: true }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(2)
      // D4 存在性恒真(不报「声明产出 … 不存在」),D6 以非平凡 + 末行终止符拦截修改型文档
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).not.toContain("declared artifact README.md does not exist")
      expect(feedback).toContain("README.md")
      expect(feedback).toContain("missing last-line terminator")
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

// 形检重提示 fork 原会话(2026-09-18 修订,kernel-spi-nor T-030 S13 现场): 重提示
// 基于刚结束的会话 fork 副本下发,只带形检反馈本身(副本已含完整提示词与全部工作
// 上下文);fork 不可用回退全新会话 + 完整提示词 + 反馈。
describe("runSubtask 形检重提示 fork 续做", () => {
  test("fork 成功: 重提示只带形检反馈(不重发整份子任务提示词),补正后勾选", async () => {
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
      // 重提示会话 = 原会话的 fork 副本,且只带反馈(不含子任务正文/整份提示词)。
      expect(calls.forks).toEqual(["ses_new_1"])
      expect(calls.prompts.length).toBe(2)
      expect(calls.prompts[1]!.sessionID).toBe("ses_fork_1")
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("artifacts did not pass the shape check")
      expect(feedback).toContain("missing last-line terminator")
      expect(feedback).not.toContain("调研并落盘记录")
      expect(subtasks((await load(join(dir, "PLAN.md"))).tasks[0]!.body)[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("fork 失败: 回退全新会话 + 完整提示词 + 反馈(与修订前行为一致)", async () => {
    const dir = await shapeRepo()
    try {
      const { sdk, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), `# 记录\n\n${filler}\n`)
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
        },
      ])
      // fork 路由不可用(旧版 server / 会话已失效)→ forkSession 回退 undefined。
      const stubbed = opencodeAgent({
        ...sdk,
        session: { ...sdk.session, fork: async () => ({ error: { message: "no fork" } }) },
      } as unknown as OpencodeClient)
      const plan = await load(join(dir, "PLAN.md"))
      const result = await runSubtask(stubbed, plan, plan.tasks[0]!, BODY, 1, { dir, commit: true }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(2)
      // 全新会话重发完整提示词(含子任务正文)+ 反馈。
      expect(calls.prompts[1]!.sessionID).toBe("ses_new_2")
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("调研并落盘记录")
      expect(feedback).toContain("artifacts did not pass the shape check")
      expect(subtasks((await load(join(dir, "PLAN.md"))).tasks[0]!.body)[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("runSubtask 全量文档终止符扫描(D6)", () => {
  test("未声明的顺带文档截断(新建、缺终止符): 拦截,补正后勾选", async () => {
    const dir = await shapeRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
          await Bun.write(join(dir, "docs/notes.md"), `# 顺带分析\n\n${filler}\n`)
        },
        async () => {
          await Bun.write(join(dir, "docs/notes.md"), `# 顺带分析\n\n${filler}\n\n${EOF_MARK}\n`)
        },
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir, commit: true }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(2)
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("docs/notes.md")
      expect(feedback).toContain("missing last-line terminator")
      expect(subtasks((await load(join(dir, "PLAN.md"))).tasks[0]!.body)[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("修改既有文档后终止符不在末行(追加在终止符之后): 拦截,恢复末行终止符后勾选", async () => {
    const dir = await shapeRepo()
    try {
      // 既有文档自带终止符;会话中途改写把正文追加在终止符之后 = 截断形态
      await Bun.write(join(dir, "docs/existing.md"), `# 既有\n\n${filler}\n\n${EOF_MARK}\n`)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-q", "-m", "existing")
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
          await Bun.write(join(dir, "docs/existing.md"), `# 既有\n\n${filler}\n\n${EOF_MARK}\n\n## 追加\n\n后续内容。\n`)
        },
        async () => {
          await Bun.write(join(dir, "docs/existing.md"), `# 既有\n\n${filler}\n\n## 追加\n\n后续内容。\n\n${EOF_MARK}\n`)
        },
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir, commit: true }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(2)
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("docs/existing.md")
      expect(feedback).toContain("missing last-line terminator")
      expect(subtasks((await load(join(dir, "PLAN.md"))).tasks[0]!.body)[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("豁免文档族(handoff/testhandoff/driver 状态文件)不受影响: 全过正常收口", async () => {
    const dir = await shapeRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
          // 豁免清单内的文件短且无终止符,不得触发形检
          await Bun.write(join(dir, "docs/T-001/handoff.md"), "# 交接\n\n状态: 继续\n")
          await Bun.write(join(dir, "docs/T-001/testhandoff-1.md"), "# 测试交接归档\n")
          await Bun.write(join(dir, "docs/R-01/PLAN.md"), "# 轮次台账\n")
        },
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir, commit: true }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(1)
      expect(subtasks((await load(join(dir, "PLAN.md"))).tasks[0]!.body)[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("单元期间已随 driver 提交落账的文档同样纳入扫描(基线..工作树取数)", async () => {
    const dir = await shapeRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
          // 模拟交接边界的 driver 提交: 单元期间文档已落账(缺终止符),
          // 工作区 changedFiles 看不到,基线 diff 仍须捞回
          await Bun.write(join(dir, "docs/committed.md"), `# 落账文档\n\n${filler}\n`)
          await git(dir, "add", "-A")
          await git(dir, "commit", "-q", "-m", "mid-unit\n\nAuto-Stage: subtask 1")
        },
        async () => {
          await Bun.write(join(dir, "docs/committed.md"), `# 落账文档\n\n${filler}\n\n${EOF_MARK}\n`)
        },
      ])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir, commit: true }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(2)
      expect(promptText(calls.prompts[1]!)).toContain("docs/committed.md")
      expect(subtasks((await load(join(dir, "PLAN.md"))).tasks[0]!.body)[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("unitChangedFiles(D6 取数)", () => {
  test("基线..工作树: 已提交改动/未提交修改/未跟踪新建均入列,删除项排除", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, "a.md"), "甲\n")
      await Bun.write(join(dir, "b.md"), "乙\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-q", "-m", "init")
      const baseline = await unitBaseline(dir)
      await Bun.write(join(dir, "c.md"), "丙\n")
      await git(dir, "add", "c.md")
      await git(dir, "commit", "-q", "-m", "mid")
      await Bun.write(join(dir, "a.md"), "甲\n改\n")
      await Bun.write(join(dir, "d.md"), "丁\n")
      await rm(join(dir, "b.md"))
      const files = await unitChangedFiles(dir, baseline)
      expect(files).toEqual(new Set(["a.md", "c.md", "d.md"]))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("空基线(非 git 环境/门禁关闭)返回空集", async () => {
    expect(await unitChangedFiles(join(tmpdir(), "nonexistent-dir"), [])).toEqual(new Set())
  })
})

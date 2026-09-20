// 事故回归场景集(M0.2,plans/AUTO_NEXT_REFACTOR_PLAN.md F7): 从现场事故库提炼的
// driver 级 fake-client 场景,此后每里程碑退出标准必跑(§7-3)。与 watch.test.ts /
// subtask-shape.test.ts 等单元用例不同,本文件按事故叙事组织,覆盖"现场加固行为"
// 的端到端链路。场景出处:
//   I1 半开连接悬挂     —— kernel-dm T-068(传输层半开 44 分钟无超时,session-boundary-hardening D3)
//   I2 输出截断续跑     —— kernel-spi-nor T-030 S13(session-boundary-hardening §8,S9)
//   I3 误判已完成零落盘 —— kernel-dm T-068 S01(读入前任务收尾叙事误判,session-boundary-hardening D2)
//   I4 测试脚本原地改写 —— kernel-spi-nor T-028(rustfmt apply,test-handover-early §H:先交接后运行,无 stash)
//   I5 交接链收口       —— test-handover-early §N F4(单元完成必清链,不留恢复误判面)

import { describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { attempt } from "../src/attempt"
import type { SessionChain } from "../src/chain"
import { EOF_MARK } from "../src/doccheck"
import { runExecSession } from "../src/exec-session"
import { runSubtask } from "../src/execute"
import { recallHandover } from "../src/handover"
import { load, subtasks } from "../src/plan"
import { runSession } from "../src/session"
import { parseSwitches } from "../src/switches"
import { fakeClient, freshRepo, git } from "./fixtures/runner"

const NO_WAIT = parseSwitches({ OPENCODE_AUTO_RETRY_WAITS: "0,0", OPENCODE_AUTO_RECOVERY_WAIT: "0" })
const makeChain = (): SessionChain => ({ pct: 100, used: 0, at: 0 })

// 每回合会话的替身脚本(与 subtask-shape.test.ts 同款): 第 n 回合消费 scripts[n-1],
// 清单耗尽后重复末份;随后 idle 结束回合。
function scriptedClient(scripts: Array<(sid: string) => Promise<unknown>>) {
  let round = 0
  return fakeClient({
    events: (sid) =>
      (async function* () {
        const script = scripts[Math.min(round++, scripts.length - 1)]
        if (script) await script(sid)
        yield { type: "session.idle", properties: { sessionID: sid } }
      })(),
  })
}

// 带 git 的临时仓库: .gitignore 按 loop-preflight 口径忽略 tmp/ 与 .auto/。
async function incidentRepo(planText: string): Promise<string> {
  const dir = await freshRepo()
  await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
  await Bun.write(join(dir, "src.ts"), "// 源码基线\n")
  await Bun.write(join(dir, "PLAN.md"), planText)
  await git(dir, "add", "-A")
  await git(dir, "commit", "-q", "-m", "init")
  return dir
}

// message.updated 事件(用量推进;input 超 contextLimit 即达测试交接判据)。
const usageMsg = (sid: string, id: string, input: number) => ({
  type: "message.updated",
  properties: {
    info: {
      id,
      sessionID: sid,
      role: "assistant",
      time: { completed: Date.now() },
      tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      providerID: "zai",
      modelID: "glm",
    },
  },
})

describe("I1 半开连接悬挂(kernel-dm T-068)", () => {
  test("探针两连败 → abort 会话 + 可重试会话错误,不无限悬挂", async () => {
    const { client, calls } = fakeClient({
      get: () => ({ error: { name: "UnknownError", data: {} } }),
      // 半开形态: 事件流永不产事件(无 FIN/RST,客户端永远收不到结束信号)。
      events: () =>
        (async function* () {
          await new Promise(() => {})
        })(),
    })
    const task = (await loadFromText()).tasks[0]!
    const result = await attempt(client, task, "提示词", { idleMs: 20 }, makeChain(), undefined, undefined, NO_WAIT)
    expect(result.type).toBe("blocked")
    expect((result as { errorClass?: string }).errorClass).toBe("transient")
    expect(calls.aborts).toContain("ses_new_1")
  })
})

// attempt 只需要一个 Task;经 load 落盘太重,直接 parse。
import { parse } from "../src/plan"
async function loadFromText() {
  return parse("PLAN.md", "## T-001: 示例任务 [pending]\n正文。\n")
}

describe("I2 输出截断续跑(kernel-spi-nor T-030 S13)", () => {
  const stepFinish = (sid: string, id: string, reason: string) => ({
    type: "message.part.updated",
    properties: {
      part: {
        id,
        sessionID: sid,
        messageID: "msg_1",
        type: "step-finish",
        reason,
        cost: 0,
        tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1 },
      },
    },
  })
  const idle = (sid: string) => ({ type: "session.idle", properties: { sessionID: sid } })

  test("length 收场不作自然结束: steer「从截断处继续」让原会话接着做", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield stepFinish(sid, "pt_1", "length")
          yield idle(sid)
          yield stepFinish(sid, "pt_2", "stop")
          yield idle(sid)
        })(),
    })
    const task = (await loadFromText()).tasks[0]!
    const result = await runSession(client, task, "提示词", {}, makeChain(), undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    // 续跑经 steer 进原会话: 不新建会话、不重发提示词。
    expect(calls.steers.length).toBe(1)
    expect(calls.steers[0]).toContain("截断")
    expect(calls.steers[0]).toContain("继续")
    expect(calls.creates).toBe(1)
    expect(calls.prompts.length).toBe(1)
  })

  test("连续截断以 3 次为限: 第 4 次按自然结束收口(交形检环处置)", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          for (let i = 0; i < 4; i++) {
            yield stepFinish(sid, `pt_${i}`, "length")
            yield idle(sid)
          }
        })(),
    })
    const task = (await loadFromText()).tasks[0]!
    const result = await runSession(client, task, "提示词", {}, makeChain(), undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.steers.length).toBe(3)
  })
})

describe("I3 误判已完成零落盘(kernel-dm T-068 S01)", () => {
  const BODY = "调研并落盘记录 产出: docs/T-001/S01/record.md"

  test("会话零产物收场: 带反馈重提示一次(复述权威状态)→ 仍零 → blocked,不勾选", async () => {
    const dir = await incidentRepo(`## T-001: 示例任务 [in_progress]\n\n- [ ] ${BODY}\n`)
    try {
      const { client, calls } = scriptedClient([async () => {}])
      const plan = await load(join(dir, "PLAN.md"))
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir, commit: true }, makeChain())
      expect(result).toMatchObject({ type: "blocked" })
      expect((result as { question: string }).question).toContain("zero disk writes")
      // 首发 + 一次带反馈重提示,反馈复述权威状态(L1)防叙事误判。
      expect(calls.prompts.length).toBe(2)
      const feedback = String((calls.prompts[1]!.parts[0] as { text?: string })?.text ?? "")
      expect(feedback).toContain("artifacts did not pass the shape check")
      expect(feedback).toContain("T-001.S01")
      expect(feedback).toContain("do not judge this subtask complete on that basis")
      expect(subtasks((await load(join(dir, "PLAN.md"))).tasks[0]!.body)[0]!.done).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("I4 测试脚本原地改写源码(kernel-spi-nor T-028)", () => {
  const HANDOFF = "docs/T-001/S01/testhandoff.md"

  test("顺序态: 定版提交 → 归档+提交 #2 → 之后跑脚本;脚本改写留在工作区不提交,全程无 stash", async () => {
    const dir = await incidentRepo(`## T-001: 示例任务 [in_progress]\n\n- [ ] 实现逻辑\n`)
    try {
      // 回合 1: 用量超限 → 发起测试(脚本原地改写 src.ts,rustfmt apply 形态)→ 定版;
      // 收尾写出交接文档(状态: 继续)→ testHandover 收场。回合 2(续跑): 自然结束。
      // 逐事件编排与 session.test.ts handoverStream 同款。
      let round = 0
      const { client: driver, calls } = fakeClient({
        events: (sid) =>
          (async function* () {
            if (round++ === 0) {
              yield usageMsg(sid, "m_limit", 2000)
              await Bun.write(join(dir, "tmp", "test.sh"), "echo '// 格式化改写' >> src.ts")
              yield { type: "session.idle", properties: { sessionID: sid } }
              await Bun.write(join(dir, HANDOFF), "# 交接\n\n进度与后续步骤。\n\n状态: 继续\n")
              yield usageMsg(sid, "m_wrapup", 2100)
              yield { type: "session.idle", properties: { sessionID: sid } }
            } else {
              yield { type: "session.idle", properties: { sessionID: sid } }
            }
          })(),
      })
      const plan = await load(join(dir, "PLAN.md"))
      const chain: SessionChain = { pct: 100, used: 0, at: 0, subject: "T-001 S1 实现逻辑", phase: { kind: "subtasks", index: 1 } }
      const result = await runExecSession(
        driver,
        plan,
        plan.tasks[0]!,
        "提示词",
        { dir, commit: true, testByDriver: true, handoverTest: true, contextLimit: 1000 },
        chain,
        undefined,
        1,
      )
      expect(result.type).toBe("idle")
      // 交接文档已归档落账(testhandoff-1.md 在 git 里;续跑自然结束后当前份被清链,
      // 在途记录随之作废——闭环语义由 I5 断言,这里只核对归档份在账)。
      const tracked = await git(dir, "ls-files")
      expect(tracked).toContain("docs/T-001/S01/testhandoff-1.md")
      // 关键时序(T-028): 脚本在收口提交之后跑——HEAD 里的 src.ts 仍是基线,
      // 改写留在工作区未提交,由下一单元吸纳;全程未动 stash(重测守卫已退役)。
      expect(await git(dir, "show", "HEAD:src.ts")).not.toContain("格式化改写")
      expect(await Bun.file(join(dir, "src.ts")).text()).toContain("格式化改写")
      expect((await git(dir, "status", "--porcelain")).trimEnd()).toBe(" M src.ts")
      expect((await git(dir, "stash", "list")).trim()).toBe("")
      // 续跑回合只补一句 continuation,不从头重发: 两次 prompt(首发+续跑)。
      expect(calls.prompts.length).toBe(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("I5 交接链收口(test-handover-early §N F4)", () => {
  const BODY = "调研并落盘记录 产出: docs/T-001/S01/record.md"
  const filler = "占位素材甲乙丙。".repeat(30)

  test("单元完成必清链: 交接发生、续跑完成 → testhandoff 全链删除并随单元提交落账,工作区干净", async () => {
    const dir = await incidentRepo(`## T-001: 示例任务 [in_progress]\n\n- [ ] ${BODY}\n`)
    try {
      let round = 0
      const { client } = fakeClient({
        events: (sid) =>
          (async function* () {
            if (round++ === 0) {
              yield usageMsg(sid, "m_limit", 2000)
              await Bun.write(join(dir, "tmp", "test.sh"), "echo ok")
              yield { type: "session.idle", properties: { sessionID: sid } }
              await Bun.write(join(dir, "docs/T-001/S01/testhandoff.md"), "# 交接\n\n进度。\n\n状态: 继续\n")
              yield usageMsg(sid, "m_wrapup", 2100)
              yield { type: "session.idle", properties: { sessionID: sid } }
            } else {
              // 续跑回合: 补上声明产物(非平凡 + 末行终止符),自然结束。
              await Bun.write(join(dir, "docs/T-001/S01/record.md"), `# 记录\n\n${filler}\n\n${EOF_MARK}\n`)
              yield { type: "session.idle", properties: { sessionID: sid } }
            }
          })(),
      })
      const plan = await load(join(dir, "PLAN.md"))
      const result = await runSubtask(
        client,
        plan,
        plan.tasks[0]!,
        BODY,
        1,
        { dir, commit: true, testByDriver: true, handoverTest: true, contextLimit: 1000 },
        makeChain(),
      )
      expect(result).toBeUndefined()
      // 交接确实发生过(归档又删除,历史由 git 承载),当前盘面无任何 testhandoff 文件。
      const tracked = await git(dir, "ls-files")
      expect(tracked).not.toContain("testhandoff")
      expect(await Bun.file(join(dir, "docs/T-001/S01/testhandoff.md")).exists()).toBe(false)
      // 子任务勾选、单元提交落账、工作区干净(删除已随提交落账,不留脏区撞下一单元门禁)。
      expect(subtasks((await load(join(dir, "PLAN.md"))).tasks[0]!.body)[0]!.done).toBe(true)
      expect((await git(dir, "status", "--porcelain")).trim()).toBe("")
      expect(await git(dir, "log", "--format=%s")).toContain("test handover #1")
      // 在途记录已作废(闭环即清)。
      expect(await recallHandover(dir, "T-001", "docs/T-001/S01/testhandoff.md")).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

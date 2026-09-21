// src/testrun.ts 的单测: 交接 steer 构造(handoffSteer)与交接判据(MA.3 起在 src/usage.ts:
// sessionHandoverDue/testHandoverDue,此处按 opencode 的 events 档断言)、测试脚本定版(resolveTestScript)、
// 交接文档清理与复原(cleanTestHandoffs/restoreTestHandoffs)。
// 拆分自 test/runner.test.ts(plans/0024-module-split-plan.md S18,纯搬运)。

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { changedFiles, commitTree } from "../src/git"
import { saveHandover } from "../src/handover"
import { parse } from "../src/plan"
import {
  cleanTestHandoffs,
  handoffSteer,
  resolveTestScript,
  restoreTestHandoffs,
} from "../src/testrun"
import { sessionHandoverDue, testHandoverDue } from "../src/usage"
import { task } from "./fixtures/runner"

// 交接 steer 构造与交接判定的纯函数单测(接线在 executeWhole/runSubtask;完整
// 流水线行为由 packages/auto 的 e2e 覆盖)。

describe("handoffSteer / sessionHandoverDue(OPENCODE_AUTO_STEER 接线)", () => {
  const cap = 64_000

  test("steer=on: 构造 2×cap 交接 steer,提示文案指向交接文档", () => {
    const steer = handoffSteer(true, cap, task)!
    expect(steer).toBeDefined()
    expect(steer.limit).toBe(cap * 2)
    expect(steer.text).toContain("docs/T-001/handoff.md")
  })

  test("steer=off: 不构造交接 steer(会话中不注入交接提示)", () => {
    expect(handoffSteer(false, cap, task)).toBeUndefined()
  })

  test("steer=off: 会话自然完成即收——用量远超 2×cap 也不索要交接文档(交接判定停用)", () => {
    expect(sessionHandoverDue("events", undefined, cap * 10)).toBe(false)
  })

  test("steer=on: 用量达到 2×cap 才要求交接,阈值下自然完成", () => {
    const steer = handoffSteer(true, cap, task)!
    expect(sessionHandoverDue("events", steer, steer.limit)).toBe(true)
    expect(sessionHandoverDue("events", steer, steer.limit + 1)).toBe(true)
    expect(sessionHandoverDue("events", steer, steer.limit - 1)).toBe(false)
    expect(sessionHandoverDue("events", steer, 0)).toBe(false)
  })
})

// 测试交接判据(交接触发解耦,D1): 与 handoverDue 并列——两套阈值两套语义,
// 前者是 ondemand 上下文交接的 2×cap,这里是 --handover-test 的 contextLimit
// 单条件,且判定时点固定在"AI 发起测试的那一刻"。
describe("testHandoverDue(--handover-test 判据)", () => {
  const test64k = { handover: true, limit: 64_000, startUsed: 0 }

  test("解耦: 不看测试成败,上下文达 contextLimit 单条件即交接", () => {
    expect(testHandoverDue(test64k, 64_000)).toBe(true)
    expect(testHandoverDue(test64k, 64_001)).toBe(true)
    expect(testHandoverDue(test64k, 63_999)).toBe(false)
  })

  test("开关关闭(未启用 --handover-test): 冲多高都不交接", () => {
    expect(testHandoverDue({ ...test64k, handover: false }, 640_000)).toBe(false)
  })

  test("实时用量拿不到时回落起跑值: 复用会话起跑就超限,首次测试请求即判得出来", () => {
    const resumed = { handover: true, limit: 64_000, startUsed: 120_000 }
    expect(testHandoverDue(resumed, 0)).toBe(true)
    // 实时值一到就以实时值为准(单调增,回落值只在 used=0 的窗口起作用)。
    expect(testHandoverDue(resumed, 1_000)).toBe(false)
  })

  test("全新/fork 会话起跑值归零: 不被上一个会话的残值误判为超限", () => {
    expect(testHandoverDue(test64k, 0)).toBe(false)
  })
})

// 请求标记的消费(测试交接顺序化 E1): 顺序态在定版那一刻就把脚本定下来、标记拿走,
// 执行推迟到交接收口之后,所以"定出脚本"必须独立于"执行"可测。
describe("resolveTestScript(消费 tmp/test.sh 请求标记)", () => {
  let dir = ""
  let tmp = ""

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-test-script-"))
    tmp = join(dir, "tmp")
    await mkdir(tmp, { recursive: true })
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("test/ 路径形态: 直取该脚本,不另产 tmp/test.<n>.sh", async () => {
    await mkdir(join(dir, "test"), { recursive: true })
    await writeFile(join(dir, "test", "build.sh"), "echo hi")
    await writeFile(join(tmp, "test.sh"), "test/build.sh")
    const run = { dir, tmp, seq: 0 }
    expect(await resolveTestScript(run)).toEqual({ script: join(dir, "test", "build.sh"), seq: 1 })
    expect(await Bun.file(join(tmp, "test.1.sh")).exists()).toBe(false)
  })

  // 判据是"trim 后单行": printf/echo 落盘常带尾随换行——AI 写文件的常态——
  // 不应因此掉进内联回落(内联快照由 bash 把该路径当命令执行,脚本缺 +x 即 126)。
  test("路径后带尾随换行: 按 trim 后单行判定,仍走 test/ 路径形态", async () => {
    await mkdir(join(dir, "test"), { recursive: true })
    await writeFile(join(dir, "test", "build.sh"), "echo hi")
    await writeFile(join(tmp, "test.sh"), "test/build.sh\n")
    const pending = await resolveTestScript({ dir, tmp, seq: 0 })
    expect(pending).toEqual({ script: join(dir, "test", "build.sh"), seq: 1 })
    expect(await Bun.file(join(tmp, "test.1.sh")).exists()).toBe(false)
  })

  // AI 写脚本常忘 chmod +x: 路径形态由 driver best-effort 补上,会话无需为此排查。
  test("test/ 路径形态: 脚本缺执行位时 driver 补 chmod +x", async () => {
    await mkdir(join(dir, "test"), { recursive: true })
    const target = join(dir, "test", "build.sh")
    await writeFile(target, "echo hi", { mode: 0o644 })
    await writeFile(join(tmp, "test.sh"), "test/build.sh")
    const pending = await resolveTestScript({ dir, tmp, seq: 0 })
    expect(pending.script).toBe(target)
    const mode = (await stat(target)).mode & 0o777
    expect(mode & 0o111).not.toBe(0)
  })

  test("内联形态回落: 整写为 tmp/test.<n>.sh 保留执行快照", async () => {
    await writeFile(join(tmp, "test.sh"), "set -e\necho inline\n")
    const run = { dir, tmp, seq: 4 }
    const pending = await resolveTestScript(run)
    expect(pending).toEqual({ script: join(tmp, "test.5.sh"), seq: 5 })
    expect(await Bun.file(pending.script).text()).toBe("set -e\necho inline\n")
  })

  test("单行但指向不存在的文件: 当内联脚本处理(不误判为路径)", async () => {
    await writeFile(join(tmp, "test.sh"), "make check")
    const run = { dir, tmp, seq: 0 }
    const pending = await resolveTestScript(run)
    expect(pending.script).toBe(join(tmp, "test.1.sh"))
    expect(await Bun.file(pending.script).text()).toBe("make check")
  })

  test("标记读完即删且序号递增: 会话收尾期重写标记不会让 driver 跑错脚本", async () => {
    await writeFile(join(tmp, "test.sh"), "echo one")
    const run = { dir, tmp, seq: 0 }
    expect((await resolveTestScript(run)).seq).toBe(1)
    expect(await Bun.file(join(tmp, "test.sh")).exists()).toBe(false)
    expect(run.seq).toBe(1)

    await writeFile(join(tmp, "test.sh"), "echo two")
    expect((await resolveTestScript(run)).seq).toBe(2)
    expect(run.seq).toBe(2)
  })
})

// 测试交接文档的陈旧清理与现场复原(中断恢复 F3/F4): 真实临时 git 仓库驱动
// ——判据本身就是"被 git 跟踪与否",替身无法覆盖。
describe("cleanTestHandoffs / restoreTestHandoffs(测试交接中断恢复)", () => {
  const t028 = parse("PLAN.md", `## T-028: 落码 [in_progress]\n正文。\n`).tasks[0]!

  async function fixture() {
    const dir = await mkdtemp(join(tmpdir(), "auto-handover-runner-"))
    const proc = Bun.spawn(["git", "-C", dir, "init", "-q"], { stdout: "ignore", stderr: "ignore" })
    await proc.exited
    await mkdir(join(dir, "docs", "T-028", "S03"), { recursive: true })
    await writeFile(join(dir, "PLAN.md"), "# PLAN\n")
    return dir
  }

  test("已落账的在途文档不删: 删它等于制造脏区,撞停下一个执行单元的 clean 门禁", async () => {
    const dir = await fixture()
    try {
      const rel = join("docs", "T-028", "S03", "testhandoff.md")
      await writeFile(join(dir, rel), "交接正文\n\n状态: 继续\n")
      await commitTree(dir, { id: "T-028", title: "落码" }, { stage: "subtask 3 handoff-1", subject: "T-028 测试交接 #1" })
      await cleanTestHandoffs(join(dir, "PLAN.md"), t028)
      expect(await Bun.file(join(dir, rel)).exists()).toBe(true)
      expect(await changedFiles(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("未跟踪的遗留照删", async () => {
    const dir = await fixture()
    try {
      await writeFile(join(dir, "PLAN.md"), "# PLAN\n")
      await commitTree(dir, { id: "T-028", title: "落码" }, { stage: "execute", subject: "T-028 基线" })
      const rel = join("docs", "T-028", "S03", "testhandoff.md")
      await writeFile(join(dir, rel), "上一次尝试的遗留")
      await cleanTestHandoffs(join(dir, "PLAN.md"), t028)
      expect(await Bun.file(join(dir, rel)).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("有在途交接记录时整段跳过(未跟踪的当前份同样保留)", async () => {
    const dir = await fixture()
    try {
      const rel = join("docs", "T-028", "S03", "testhandoff.md")
      await writeFile(join(dir, rel), "会话正在写")
      await saveHandover(dir, { task: "T-028", scope: rel, unit: "subtask 3", n: 1 })
      await cleanTestHandoffs(join(dir, "PLAN.md"), t028)
      expect(await Bun.file(join(dir, rel)).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("现场复原: 被上一次运行删掉的已落账文档取回,脏区随之消失", async () => {
    const dir = await fixture()
    try {
      const rel = join("docs", "T-028", "S03", "testhandoff.md")
      await writeFile(join(dir, rel), "交接正文\n\n状态: 继续\n")
      await commitTree(dir, { id: "T-028", title: "落码" }, { stage: "subtask 3 handoff-1", subject: "T-028 测试交接 #1" })
      await rm(join(dir, rel), { force: true })
      expect(await changedFiles(dir)).toEqual([rel])
      await restoreTestHandoffs(dir, t028)
      expect(await Bun.file(join(dir, rel)).text()).toContain("状态: 继续")
      expect(await changedFiles(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("现场复原只认本任务的交接文档", async () => {
    const dir = await fixture()
    try {
      await mkdir(join(dir, "docs", "T-029"), { recursive: true })
      const mine = join("docs", "T-028", "S03", "testhandoff.md")
      const other = join("docs", "T-029", "testhandoff.md")
      const report = join("docs", "T-028", "S03", "index.md")
      for (const rel of [mine, other, report]) await writeFile(join(dir, rel), "正文\n")
      await commitTree(dir, { id: "T-028", title: "落码" }, { stage: "execute", subject: "T-028 基线" })
      for (const rel of [mine, other, report]) await rm(join(dir, rel), { force: true })
      await restoreTestHandoffs(dir, t028)
      expect(await Bun.file(join(dir, mine)).exists()).toBe(true)
      expect(await Bun.file(join(dir, other)).exists()).toBe(false)
      expect(await Bun.file(join(dir, report)).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

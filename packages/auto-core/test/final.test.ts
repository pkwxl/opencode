import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { appendFinalTask, finalIndex, finalProposalFile, finalReportFile, parseConclusion, parseProposal, parseStrategy, routeFinal } from "../src/final"
import { load, parse, setStatus } from "../src/plan"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "auto-final-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function write(rel: string, text: string) {
  await mkdir(dirname(join(dir, rel)), { recursive: true })
  await Bun.write(join(dir, rel), text)
}

// 通用 fixture: 已完成的原任务 + 若干终审任务(id / final 标记 / 状态)。
const ORIGINAL = `## T-001: 原任务 [done]
  - verify: command: bun test
正文。
`

const finalTask = (id: string, mark: string, status = "done") =>
  `## ${id}: 终审任务 ${mark} [${status}]\n  - final: ${mark}\n正文。\n`

const planWith = (...tasks: string[]) => parse("PLAN.md", [ORIGINAL, ...tasks].join("\n"))

const auditReport = (strategy: string, conclusion = "发现若干差距") => `# 审计报告\n\n正文。\n\n结论: ${conclusion}\n策略: ${strategy}\n`

const validateReport = (conclusion: string) => `# 回归验证报告\n\n正文。\n\n结论: ${conclusion}\n`

describe("协议解析", () => {
  test("parseStrategy 取末行策略,容忍中文冒号与紧排", () => {
    expect(parseStrategy("结论: x\n策略: 重构\n")).toBe("重构")
    expect(parseStrategy("策略:修补")).toBe("修补")
    expect(parseStrategy("策略： 无")).toBe("无")
    expect(parseStrategy("策略: 重构\n正文\n策略: 无\n")).toBe("无")
  })

  test("parseStrategy 缺失或取值非法返回 undefined", () => {
    expect(parseStrategy("")).toBeUndefined()
    expect(parseStrategy("无策略行")).toBeUndefined()
    // 末行策略取值非法:不回溯更早的合法策略行
    expect(parseStrategy("策略: 重构\n正文\n策略: 大改\n")).toBeUndefined()
  })

  test("parseConclusion 解析通过/差距与差距原文", () => {
    expect(parseConclusion("结论: 通过\n")).toEqual({ type: "pass" })
    expect(parseConclusion("正文\n结论:差距 回归仍失败\n")).toEqual({ type: "gap", gap: "回归仍失败" })
    expect(parseConclusion("结论: 差距")).toEqual({ type: "gap", gap: "" })
    expect(parseConclusion("结论: 差距 甲\n结论: 通过\n")).toEqual({ type: "pass" })
  })

  test("parseConclusion 缺失或取值非法返回 undefined", () => {
    expect(parseConclusion("")).toBeUndefined()
    expect(parseConclusion("没有结论")).toBeUndefined()
    expect(parseConclusion("结论: 重验 脚本有问题\n")).toBeUndefined()
  })

  test("parseProposal 解析标题/自包含正文/可选末行 verify", () => {
    expect(parseProposal("# 全面审计\n\n审计正文。\n\nverify: command: bun test\n")).toEqual({
      title: "全面审计",
      body: "审计正文。",
      verify: "command: bun test",
    })
    expect(parseProposal("# 标题\n正文无 verify\n")).toEqual({ title: "标题", body: "正文无 verify", verify: undefined })
  })

  test("parseProposal 缺失、无标题或无正文返回 undefined", () => {
    expect(parseProposal("")).toBeUndefined()
    expect(parseProposal("无标题\n正文\n")).toBeUndefined()
    expect(parseProposal("# 只有标题\n")).toBeUndefined()
  })
})

describe("finalIndex(P1-D1 锚定编号)", () => {
  test("plan 内带 final 字段任务数 + 1(与 appendFinalTask 编号同源)", () => {
    expect(finalIndex(planWith())).toBe(1)
    expect(finalIndex(planWith(finalTask("T-F1", "audit@1")))).toBe(2)
    expect(finalIndex(planWith(finalTask("T-F1", "audit@1"), finalTask("T-F2", "remediate@1")))).toBe(3)
  })

  test("finalProposalFile/finalReportFile 锚定 docs/T-F<k>/ 目录", () => {
    expect(finalProposalFile("audit", 1, 1)).toBe(join("docs", "T-F1", "plan-audit-r1.md"))
    expect(finalReportFile("audit", 2, undefined, 4)).toBe(join("docs", "T-F4", "audit-r2.md"))
    expect(finalReportFile("remediate", 1, "patch", 2)).toBe(join("docs", "T-F2", "patch-r1.md"))
    expect(finalReportFile("remediate", 1, "refactor", 2)).toBe(join("docs", "T-F2", "refactor-r1.md"))
    expect(finalReportFile("validate", 1, undefined, 3)).toBe(join("docs", "T-F3", "validate-r1.md"))
    expect(finalReportFile("finalize", 1, undefined, 4)).toBe(join("docs", "T-F4", "finalize.md"))
  })
})

describe("路由表: 终审启动与未完成状态", () => {
  test("无终审任务 → 生成 audit@1(prior 为空)", async () => {
    const route = await routeFinal(dir, planWith(), 2)
    expect(route).toEqual({ type: "generate", stage: "audit", round: 1, prior: "" })
  })

  test("提案已产出未追加 → 直接解析追加(C.3)", async () => {
    await write(finalProposalFile("audit", 1, 1), "# 全面审计\n\n审计任务正文。")
    const route = await routeFinal(dir, planWith(), 2)
    expect(route).toEqual({
      type: "append",
      stage: "audit",
      round: 1,
      proposal: { title: "全面审计", body: "审计任务正文。", verify: undefined },
    })
  })

  test("提案无效(无正文)仍走 generate", async () => {
    await write(finalProposalFile("audit", 1, 1), "# 只有标题\n")
    const route = await routeFinal(dir, planWith(), 2)
    expect(route).toEqual({ type: "generate", stage: "audit", round: 1, prior: "" })
  })

  test("存在未完成终审任务(pending/in_progress/blocked)→ 主循环处理(C.1)", async () => {
    for (const status of ["pending", "in_progress", "blocked"] as const) {
      expect(await routeFinal(dir, planWith(finalTask("T-F1", "audit@1", status)), 2)).toEqual({ type: "wait" })
    }
  })

  test("最后终审任务 final 字段非法 → 阻塞提示修正", async () => {
    const route = await routeFinal(dir, planWith(finalTask("T-F1", "audit")), 2)
    expect(route.type).toBe("block")
    if (route.type !== "block") return
    expect(route.task).toBe("T-F1")
    expect(route.question).toContain("final 字段无效")
  })
})

describe("路由表: audit 策略", () => {
  test("策略: 无 → 直达 finalize(跳过 remediate 与 validate)", async () => {
    await write(finalReportFile("audit", 1, undefined, 1), auditReport("无", "整体质量合格"))
    const route = await routeFinal(dir, planWith(finalTask("T-F1", "audit@1")), 2)
    expect(route.type).toBe("generate")
    if (route.type !== "generate") return
    expect(route.stage).toBe("finalize")
    expect(route.round).toBe(1)
    expect(route.prior).toContain("策略: 无")
    expect(route.prior).toContain(finalReportFile("audit", 1, undefined, 1))
  })

  test("策略: 重构|修补 → 生成 remediate@同轮", async () => {
    for (const strategy of ["重构", "修补"]) {
      await write(finalReportFile("audit", 1, undefined, 1), auditReport(strategy))
      const route = await routeFinal(dir, planWith(finalTask("T-F1", "audit@1")), 2)
      expect(route.type).toBe("generate")
      if (route.type !== "generate") return
      expect(route.stage).toBe("remediate")
      expect(route.round).toBe(1)
      expect(route.prior).toContain(strategy)
      expect(route.prior).toContain(finalReportFile("validate", 1, undefined, 3))
    }
  })

  test("报告缺失或策略非法 → 阻塞提示人工核查(C.4)", async () => {
    const missing = await routeFinal(dir, planWith(finalTask("T-F1", "audit@1")), 2)
    expect(missing.type).toBe("block")
    if (missing.type !== "block") return
    expect(missing.task).toBe("T-F1")
    expect(missing.question).toContain(finalReportFile("audit", 1, undefined, 1))
    expect(missing.question).toContain("人工")

    await write(finalReportFile("audit", 1, undefined, 1), "# 报告\n\n结论: 有差距\n策略: 大改\n")
    const invalid = await routeFinal(dir, planWith(finalTask("T-F1", "audit@1")), 2)
    expect(invalid.type).toBe("block")
  })

  test("下一阶段任务已存在 → 不重复生成(C.2)", async () => {
    await write(finalReportFile("audit", 1, undefined, 1), auditReport("重构"))
    const plan = planWith(`## T-002: 人工预置 [done]\n  - final: remediate@1\n正文。\n`, finalTask("T-F1", "audit@1"))
    expect(await routeFinal(dir, plan, 2)).toEqual({ type: "wait" })
  })
})

describe("路由表: remediate 与 validate", () => {
  const round1Done = [finalTask("T-F1", "audit@1"), finalTask("T-F2", "remediate@1")]

  test("remediate done → 生成 validate@同轮,修复报告按策略指向 refactor|patch", async () => {
    await write(finalReportFile("audit", 1, undefined, 1), auditReport("重构"))
    const refactor = await routeFinal(dir, planWith(...round1Done), 2)
    expect(refactor.type).toBe("generate")
    if (refactor.type !== "generate") return
    expect(refactor.stage).toBe("validate")
    expect(refactor.round).toBe(1)
    expect(refactor.prior).toContain(finalReportFile("remediate", 1, "refactor", 2))

    await write(finalReportFile("audit", 1, undefined, 1), auditReport("修补"))
    const patch = await routeFinal(dir, planWith(...round1Done), 2)
    expect(patch.type).toBe("generate")
    if (patch.type !== "generate") return
    expect(patch.prior).toContain(finalReportFile("remediate", 1, "patch", 2))
  })

  test("validate done + 结论: 通过 → 生成 finalize", async () => {
    await write(finalReportFile("validate", 1, undefined, 3), validateReport("通过"))
    const route = await routeFinal(dir, planWith(...round1Done, finalTask("T-F3", "validate@1")), 2)
    expect(route.type).toBe("generate")
    if (route.type !== "generate") return
    expect(route.stage).toBe("finalize")
    expect(route.round).toBe(1)
    expect(route.prior).toContain("回归验证通过")
  })

  test("validate done + 结论: 差距 → 回退 audit@下一轮,prior 含差距原文", async () => {
    await write(finalReportFile("validate", 1, undefined, 3), validateReport("差距 回归测试仍失败"))
    const route = await routeFinal(dir, planWith(...round1Done, finalTask("T-F3", "validate@1")), 2)
    expect(route.type).toBe("generate")
    if (route.type !== "generate") return
    expect(route.stage).toBe("audit")
    expect(route.round).toBe(2)
    expect(route.prior).toContain("回归测试仍失败")
    expect(route.prior).toContain(finalReportFile("validate", 1, undefined, 3))
  })

  test("validate 差距且审计轮耗尽 → 熔断 block 本任务,question 引用报告与差距原文(B.5)", async () => {
    await write(finalReportFile("validate", 1, undefined, 3), validateReport("差距 回归仍失败"))
    const route = await routeFinal(dir, planWith(...round1Done, finalTask("T-F3", "validate@1")), 1)
    expect(route.type).toBe("block")
    if (route.type !== "block") return
    expect(route.task).toBe("T-F3")
    expect(route.question).toContain("终审闭环连续 1 轮仍未通过")
    expect(route.question).toContain(finalReportFile("validate", 1, undefined, 3))
    expect(route.question).toContain(finalReportFile("audit", 1, undefined, 1))
    expect(route.question).toContain("回归仍失败")
  })

  test("轮计数跨轮推进: validate@2 差距在 limit 内回退 audit@3、limit=2 熔断", async () => {
    const tasks = [
      finalTask("T-F1", "audit@1"),
      finalTask("T-F2", "remediate@1"),
      finalTask("T-F3", "validate@1"),
      finalTask("T-F4", "audit@2"),
      finalTask("T-F5", "remediate@2"),
      finalTask("T-F6", "validate@2"),
    ]
    await write(finalReportFile("validate", 2, undefined, 6), validateReport("差距 第二轮仍未通过"))
    const advance = await routeFinal(dir, planWith(...tasks), 3)
    expect(advance.type).toBe("generate")
    if (advance.type !== "generate") return
    expect(advance.stage).toBe("audit")
    expect(advance.round).toBe(3)
    const fuse = await routeFinal(dir, planWith(...tasks), 2)
    expect(fuse.type).toBe("block")
    if (fuse.type !== "block") return
    expect(fuse.question).toContain("连续 2 轮")
  })

  test("finalize done → 终审完成(C.5)", async () => {
    expect(await routeFinal(dir, planWith(finalTask("T-F1", "audit@1"), finalTask("T-F2", "finalize@1")), 2)).toEqual({
      type: "complete",
    })
  })
})

describe("appendFinalTask", () => {
  let path: string

  beforeEach(async () => {
    path = join(dir, "PLAN.md")
    await Bun.write(path, ORIGINAL)
  })

  const appended = async (...args: Parameters<typeof appendFinalTask>) => {
    const id = await appendFinalTask(...args)
    return { id, task: (await load(path)).tasks.find((task) => task.id === id)! }
  }

  test("audit: T-F 编号、final 字段、不写 verify 字段、标题带阶段前缀;提案 verify 被忽略", async () => {
    const { id, task } = await appended(path, await load(path), "audit", 1, {
      title: "全面审计",
      body: "审计正文。",
      verify: "command: bun test",
    })
    expect(id).toBe("T-F1")
    expect(task.title).toBe("终审审计(第 1 轮): 全面审计")
    expect(task.status).toBe("pending")
    expect(task.final).toBe("audit@1")
    expect(task.body).toBe("审计正文。")
    expect(task.verify).toBeUndefined()
  })

  test("validate: 同样不写 verify 字段(终审任务强制跳过任务级验收)", async () => {
    const { task } = await appended(path, await load(path), "validate", 2, { title: "回归验证", body: "验证正文。" })
    expect(task.final).toBe("validate@2")
    expect(task.title).toBe("回归验证(第 2 轮): 回归验证")
    expect(task.verify).toBeUndefined()
  })

  test("remediate: 提案 verify 行一律忽略,不写入任务", async () => {
    const { task } = await appended(path, await load(path), "remediate", 1, {
      title: "修复差距",
      body: "修复正文。",
      verify: "command: bun test",
    })
    expect(task.final).toBe("remediate@1")
    expect(task.verify).toBeUndefined()
  })

  test("finalize: 不写 verify 字段;编号按既有终审任务数递增", async () => {
    const first = await appended(path, await load(path), "audit", 1, { title: "审计", body: "正文。" })
    expect(first.id).toBe("T-F1")
    const second = await appended(path, await load(path), "finalize", 1, { title: "收尾", body: "正文。" })
    expect(second.id).toBe("T-F2")
    expect(second.task.title).toBe("终审收尾: 收尾")
    expect(second.task.final).toBe("finalize@1")
    expect(second.task.verify).toBeUndefined()
    const override = await appended(path, await load(path), "finalize", 2, { title: "收尾", body: "正文。", verify: "command: bun test" })
    expect(override.task.final).toBe("finalize@2")
    expect(override.task.verify).toBeUndefined()
  })

  test("追加后经 begin/edit 重写保留 final 字段与正文(往返)", async () => {
    await appendFinalTask(path, await load(path), "audit", 1, { title: "审计", body: "审计正文。" })
    await setStatus(path, "T-F1", "in_progress")
    const task = (await load(path)).tasks[1]!
    expect(task.status).toBe("in_progress")
    expect(task.final).toBe("audit@1")
    expect(task.body).toBe("审计正文。")
  })
})

describe("状态重建(闭环全程推进)", () => {
  test("append → 执行 done → 依报告逐阶段推进,finalize done 后 complete", async () => {
    const path = join(dir, "PLAN.md")
    await Bun.write(path, ORIGINAL)

    // audit@1: 提案已产出(C.3)→ 追加 → 任务 pending 时主循环直接拾取(C.1)→
    // 模拟执行: 会话写出审计报告、任务标 done → 路由 remediate
    await write(finalProposalFile("audit", 1, 1), "# 全面审计\n\n审计正文。")
    let route = await routeFinal(dir, await load(path), 2)
    expect(route.type).toBe("append")
    if (route.type !== "append") return
    await appendFinalTask(path, await load(path), route.stage, route.round, route.proposal)
    expect(await routeFinal(dir, await load(path), 2)).toEqual({ type: "wait" })
    await write(finalReportFile("audit", 1, undefined, 1), auditReport("修补"))
    await setStatus(path, "T-F1", "done")
    route = await routeFinal(dir, await load(path), 2)
    expect(route.type).toBe("generate")
    if (route.type !== "generate") return
    expect(route.stage).toBe("remediate")

    // remediate@1 追加(done 后)→ 路由 validate
    await appendFinalTask(path, await load(path), "remediate", 1, { title: "修补差距", body: "修复正文。", verify: "command: bun test" })
    await setStatus(path, "T-F2", "done")
    route = await routeFinal(dir, await load(path), 2)
    expect(route.type).toBe("generate")
    if (route.type !== "generate") return
    expect(route.stage).toBe("validate")

    // validate@1 追加(done 后通过)→ 路由 finalize
    await appendFinalTask(path, await load(path), "validate", 1, { title: "回归验证", body: "验证正文。" })
    await setStatus(path, "T-F3", "done")
    await write(finalReportFile("validate", 1, undefined, 3), validateReport("通过"))
    route = await routeFinal(dir, await load(path), 2)
    expect(route.type).toBe("generate")
    if (route.type !== "generate") return
    expect(route.stage).toBe("finalize")

    // finalize@1 追加(done)→ 终审完成(C.5)
    await appendFinalTask(path, await load(path), "finalize", 1, { title: "收尾", body: "收尾正文。" })
    await setStatus(path, "T-F4", "done")
    expect(await routeFinal(dir, await load(path), 2)).toEqual({ type: "complete" })
  })
})

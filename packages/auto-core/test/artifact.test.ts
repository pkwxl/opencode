// src/artifact.ts 的单测: requireArtifact 阶段步骤恢复(spec.step)、独立单元门禁(spec.unitStart)、严格恢复(STRICT_RESUME)。
// 拆分自 test/runner.test.ts(plans/0024-module-split-plan.md S18,纯搬运)。

import { beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { opencodeAgent } from "../src/agent/opencode/client"
import { requireArtifact } from "../src/artifact"
import { clearSticky, resetFailback } from "../src/failback"
import { changedFiles, unitBaseline } from "../src/git"
import { readPlanInput, savePlanInput } from "../src/plan-input"
import { openStep, recallProgress, saveProgress } from "../src/resume"
import { parseSwitches, SWITCH_ENV } from "../src/switches"

// ---- 阶段步骤恢复点(requireArtifact spec.step: 会话恢复优先于文件推导)----

describe("requireArtifact 阶段步骤恢复(spec.step)", () => {
  // 零等待阶梯: 本块只验恢复点语义,不该被重试退避拖成分钟级。
  const STEP_NO_WAIT = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.recoveryWait]: "0" })
  // 专用 fake client: 记录 create 次数与每个 prompt 的目标会话;messages 返回一条
  // 真实 assistant 轮次(tokens>0)使 sessionUsage 判为可复用、非报错桩;事件流对
  // "当前会话"(新建则随之更新,复用则保持)发一个 idle 让 watch 正常结算。
  function artifactClient(current?: string) {
    const state = { creates: 0, prompts: [] as string[], current }
    const sdk = {
      session: {
        create: async () => {
          state.creates++
          state.current = `ses_new_${state.creates}`
          return { data: { id: state.current } }
        },
        fork: async () => ({ data: { id: "ses_fork" } }),
        get: async (params: { sessionID: string }) => ({ data: { id: params.sessionID } }),
        update: async () => ({}),
        prompt: async (params: { sessionID: string }) => {
          state.prompts.push(params.sessionID)
          return {}
        },
        promptAsync: async () => ({}),
        abort: async () => ({}),
        messages: async () => ({
          data: [
            { info: { role: "user" } },
            { info: { role: "assistant", providerID: "kimi", modelID: "k2", tokens: { input: 5000, output: 200, reasoning: 0, cache: { read: 1000, write: 0 } } } },
          ],
        }),
      },
      provider: { list: async () => ({ data: { all: [] } }) },
      event: {
        subscribe: async () => ({
          stream: (async function* () {
            yield { type: "session.idle", properties: { sessionID: state.current } }
          })(),
        }),
      },
    } as unknown as OpencodeClient
    return { client: opencodeAgent(sdk), state, sdk }
  }

  const planTask = { id: "PLAN", title: "阶段规划(m 迁移实现)", status: "in_progress" as const, attempts: 0, body: "" }
  const spec = (reset: () => void) => ({
    kind: "阶段规划",
    step: { step: "phase-plan" as const, unit: "R-01.P01" },
    artifact: "已填充的 PLAN.md",
    requirement: "写入 PLAN.md",
    reset: async () => {
      reset()
    },
    collect: async () => 4,
  })

  test("未收口 step 记录 + 会话存活: 复用原会话、不重置产物、提示词进原会话", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-step-resume-"))
    try {
      await saveProgress(dir, { task: "PLAN", session: "ses_plan_old", at: 1, active: true, phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" } })
      const { client, state } = artifactClient("ses_plan_old")
      let resetCalled = false
      const value = await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => (resetCalled = true)))
      expect(value).toBe(4)
      expect(resetCalled).toBe(false) // 复用会话 → 保留产物现场,不重置
      expect(state.creates).toBe(0) // 复用,不新建
      expect(state.prompts).toEqual(["ses_plan_old"]) // 提示词进原会话
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("无 step 记录(全新步骤): 重置产物、开新会话,且下发即写 active 恢复点", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-step-fresh-"))
    try {
      const { client, state } = artifactClient()
      let resetCalled = false
      const value = await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => (resetCalled = true)))
      expect(value).toBe(4)
      expect(resetCalled).toBe(true)
      expect(state.creates).toBe(1)
      // 伪任务 PLAN 携带 step 阶段 → 下发成功即落盘(此前 T- 门控会漏掉旁路会话)
      const rec = await recallProgress(dir, "PLAN")
      expect(rec?.active).toBe(true)
      expect(rec?.session).toBe("ses_new_1")
      expect(rec?.phase).toEqual({ kind: "step", step: "phase-plan", unit: "R-01.P01" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("step 记录存在但会话已死(get 失败): 不复用,重置并开新会话", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-step-dead-"))
    try {
      await saveProgress(dir, { task: "PLAN", session: "ses_dead", at: 1, active: true, phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" } })
      const { client, state, sdk } = artifactClient("ses_dead")
      ;(sdk as unknown as { session: { get: unknown } }).session.get = async () => ({ error: { name: "NotFound" } })
      let resetCalled = false
      const value = await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => (resetCalled = true)))
      expect(value).toBe(4)
      expect(resetCalled).toBe(true) // 会话不可复用 → 重置重做
      expect(state.creates).toBe(1)
      expect(state.prompts).toEqual(["ses_new_1"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("spec.restart (plans/0053 D9): an open record with a live session is not reused; the step starts afresh", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-step-restart-"))
    try {
      await saveProgress(dir, { task: "PLAN", session: "ses_plan_old", at: 1, active: true, phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" } })
      const { client, state } = artifactClient("ses_plan_old")
      let resetCalled = false
      const value = await requireArtifact(client, planTask, "planning prompt", { dir }, { ...spec(() => (resetCalled = true)), restart: "the planning input changed" })
      expect(value).toBe(4)
      expect(resetCalled).toBe(true)
      expect(state.prompts).toEqual(["ses_new_1"])
      const rec = await recallProgress(dir, "PLAN")
      expect(rec?.session).toBe("ses_new_1")
      expect(rec?.active).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("可重试错误耗尽进等待-探测: 恢复后步骤正常完成,中途失败不删步骤认领", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-step-retry-"))
    try {
      // 前三次会话(阶梯 0,0 的三次尝试)全部可重试错误 → 阶梯耗尽进入等待-探测
      // → 探测会话(第 4 次 create)成功 → 空白新会话重发(第 5 次 create)成功。
      const queue: unknown[] = []
      let seq = 0
      let n = 0
      const enqueue = (id: string) => {
        n++
        if (n <= 3) {
          queue.push({ type: "session.error", properties: { sessionID: id, error: { name: "APIError", data: { message: "net", isRetryable: true } } } })
        }
        queue.push({ type: "session.idle", properties: { sessionID: id } })
      }
      const client = opencodeAgent({
        session: {
          create: async () => {
            const id = `ses_new_${++seq}`
            enqueue(id)
            return { data: { id } }
          },
          fork: async () => {
            const id = `ses_fork_${++seq}`
            enqueue(id)
            return { data: { id } }
          },
          get: async (params: { sessionID: string }) => ({ data: { id: params.sessionID } }),
          update: async () => ({}),
          prompt: async () => ({}),
          promptAsync: async () => ({}),
          abort: async () => ({}),
          messages: async () => ({ data: [] }),
        },
        provider: { list: async () => ({ data: { all: [] } }) },
        event: { subscribe: async () => ({ stream: (async function* () { while (queue.length) yield queue.shift() })() }) },
      } as unknown as OpencodeClient)
      const result = await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => {}), STEP_NO_WAIT)
      expect(result).toBe(4)
      // 中途失败从未删除步骤认领(openStep 全程可重入本步骤);成功后由调用方收口,
      // 此处直接验证记录仍指向本步骤的会话谱系而非被删。
      const open = await openStep(dir)
      expect(open?.step).toBe("phase-plan")
      expect(open?.unit).toBe("R-01.P01")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ---- requireArtifact 独立单元门禁(spec.unitStart,plans/0021-commit-boundary-design.md)----

describe("requireArtifact 独立单元门禁(spec.unitStart)", () => {
  // 复用 step 恢复块的 fake client 形态: 单会话 + idle 结算,记录 create/prompt;
  // produce 使会话回合内落一个文件(模拟 AI 写产物,供统一提交有物可提)。
  function unitClient(produce?: () => Promise<void>) {
    const state = { creates: 0, prompts: [] as string[] }
    const client = opencodeAgent({
      session: {
        create: async () => {
          state.creates++
          return { data: { id: `ses_new_${state.creates}` } }
        },
        fork: async () => ({ data: { id: "ses_fork" } }),
        get: async (params: { sessionID: string }) => ({ data: { id: params.sessionID } }),
        update: async () => ({}),
        prompt: async (params: { sessionID: string }) => {
          state.prompts.push(params.sessionID)
          return {}
        },
        promptAsync: async () => ({}),
        abort: async () => ({}),
        messages: async () => ({ data: [{ info: { role: "user" } }] }),
      },
      provider: { list: async () => ({ data: { all: [] } }) },
      event: {
        subscribe: async () => ({
          stream: (async function* () {
            if (produce) await produce()
            yield { type: "session.idle", properties: { sessionID: `ses_new_${state.creates}` } }
          })(),
        }),
      },
    } as unknown as OpencodeClient)
    return { client, state }
  }

  const planTask = { id: "PLAN", title: "知识提取(k)", status: "in_progress" as const, attempts: 0, body: "" }
  const unitSpec = {
    kind: "知识提取",
    unitStart: true,
    artifact: "非空知识文档",
    requirement: "写入文档",
    collect: async () => "产出",
  }

  async function git(dir: string, ...args: string[]) {
    const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    if (code !== 0) throw new Error(`git ${args.join(" ")} 退出码 ${code}: ${err || out}`)
    return out
  }

  test("启动前工作区脏(人工改动)→ dirty,不开会话", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-unit-gate-"))
    try {
      await git(dir, "init", "-q")
      await writeFile(join(dir, "human.txt"), "人工遗留")
      const { client, state } = unitClient()
      const value = await requireArtifact(client, planTask, "提取提示词", { dir }, unitSpec)
      expect(value).toEqual({ type: "dirty", files: ["human.txt"] })
      expect(state.creates).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("driver 状态文件(CURRENT.md)遗留 → carryover 自愈后照常开会话产出", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-unit-gate-"))
    try {
      await git(dir, "init", "-q")
      await writeFile(join(dir, "seed.txt"), "s")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "seed")
      // 上次提交失败遗留的 driver 状态落账: 只含 CURRENT.md → 自愈补提交
      await writeFile(join(dir, "CURRENT.md"), "# 当前任务\n")
      const { client, state } = unitClient()
      const value = await requireArtifact(client, planTask, "提取提示词", { dir }, unitSpec)
      expect(value).toBe("产出")
      expect(state.creates).toBe(1)
      const log = await git(dir, "log", "--pretty=%B")
      expect(log).toContain("Auto-Stage: carryover")
      // .auto/ 运行时状态(stats)不属纳管内容,排除后工作区应干净
      expect((await changedFiles(dir)).filter((file) => !file.startsWith(".auto/"))).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("spec.commit 提交失败(pre-commit 拒绝)→ blocked,不视为完成", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-unit-gate-"))
    try {
      await git(dir, "init", "-q")
      await mkdir(join(dir, "hooks"))
      await writeFile(join(dir, "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 })
      // 先落账 hook 脚本本身(保持工作区 clean),再启用 hooksPath 使后续提交失败
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "hooks")
      await git(dir, "config", "core.hooksPath", "hooks")
      const { client } = unitClient(async () => {
        await writeFile(join(dir, "kb.md"), "知识")
      })
      const value = await requireArtifact(client, planTask, "提取提示词", { dir }, {
        ...unitSpec,
        commit: { stage: "knowledge", subject: "PLAN knowledge 提取" },
      })
      expect(typeof value === "object" && "type" in value && value.type).toBe("blocked")
      if (typeof value === "object" && "type" in value && value.type === "blocked") {
        expect(value.question).toContain("unified commit failed")
        expect(value.question).toContain("not considered complete")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("恢复复用原会话(step 记录存活)豁免 clean 检查: 脏的产物现场照常续跑", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-unit-gate-"))
    try {
      await git(dir, "init", "-q")
      // 半途产物 + active step 记录 + 存活会话 → 复用续跑而非 dirty 阻塞
      await writeFile(join(dir, "docs-kb.md"), "半途产物")
      await saveProgress(dir, { task: "PLAN", session: "ses_alive", at: 1, active: true, phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" } })
      const state = { creates: 0, prompts: [] as string[] }
      const client = opencodeAgent({
        session: {
          create: async () => {
            state.creates++
            return { data: { id: `ses_new_${state.creates}` } }
          },
          fork: async () => ({ data: { id: "ses_fork" } }),
          get: async (params: { sessionID: string }) => ({ data: { id: params.sessionID } }),
          update: async () => ({}),
          prompt: async (params: { sessionID: string }) => {
            state.prompts.push(params.sessionID)
            return {}
          },
          promptAsync: async () => ({}),
          abort: async () => ({}),
          messages: async () => ({
            data: [
              { info: { role: "user" } },
              { info: { role: "assistant", providerID: "kimi", modelID: "k2", tokens: { input: 5000, output: 200, reasoning: 0, cache: { read: 1000, write: 0 } } } },
            ],
          }),
        },
        provider: { list: async () => ({ data: { all: [] } }) },
        event: {
          subscribe: async () => ({
            stream: (async function* () {
              yield { type: "session.idle", properties: { sessionID: "ses_alive" } }
            })(),
          }),
        },
      } as unknown as OpencodeClient)
      const value = await requireArtifact(client, planTask, "续跑提示词", { dir }, {
        ...unitSpec,
        step: { step: "phase-plan", unit: "R-01.P01" },
      })
      expect(value).toBe("产出")
      expect(state.prompts).toEqual(["ses_alive"]) // 复用原会话,未因脏区分叉
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("requireArtifact 严格恢复(OPENCODE_AUTO_STRICT_RESUME + 单元基线/模型核对)", () => {
  // 注入开关: 严格恢复 on + 模型路由(严格恢复要求记录带生效模型,未配路由一律不复用)
  // + 零等待重试阶梯(本块只验恢复判据,不该被退避拖成分钟级)。
  const STRICT = parseSwitches({
    [SWITCH_ENV.strictResume]: "on",
    [SWITCH_ENV.model]: "*=kimi/k2",
    [SWITCH_ENV.retryWaits]: "0,0",
    [SWITCH_ENV.recoveryWait]: "0",
  })
  const LOOSE = parseSwitches({
    [SWITCH_ENV.model]: "*=kimi/k2",
    [SWITCH_ENV.retryWaits]: "0,0",
    [SWITCH_ENV.recoveryWait]: "0",
  })

  beforeEach(() => {
    // 严格恢复的模型求值链含 sticky / /failback 覆写(src/failback.ts 模块态),
    // 与其他用例共享进程 → 每例前复位,避免串扰。
    clearSticky()
    resetFailback()
  })

  async function git(dir: string, ...args: string[]) {
    const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    if (code !== 0) throw new Error(`git ${args.join(" ")} 退出码 ${code}: ${err || out}`)
    return out
  }

  // 记录了阶段步骤恢复点的临时仓库: 种子提交 + active step 记录(基线/模型由入参给定)。
  async function seeded(record: { model?: string; withBaseline?: boolean } = {}) {
    const dir = await mkdtemp(join(tmpdir(), "auto-strict-resume-"))
    await git(dir, "init", "-q")
    await writeFile(join(dir, "seed.txt"), "s")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "seed")
    const baseline = await unitBaseline(dir)
    await saveProgress(dir, {
      task: "PLAN",
      session: "ses_plan_old",
      at: 1,
      active: true,
      phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" },
      ...(record.withBaseline === false ? {} : { baseline }),
      ...(record.model === undefined ? {} : { model: record.model }),
    })
    return { dir, head: (await git(dir, "rev-parse", "--short", "HEAD")).trim() }
  }

  function stepClient(current?: string, alive = true) {
    const state = { creates: 0, prompts: [] as string[], current }
    const client = opencodeAgent({
      session: {
        create: async () => {
          state.creates++
          state.current = `ses_new_${state.creates}`
          return { data: { id: state.current } }
        },
        fork: async () => ({ data: { id: "ses_fork" } }),
        get: async (params: { sessionID: string }) => (alive ? { data: { id: params.sessionID } } : { error: { name: "NotFound" } }),
        update: async () => ({}),
        prompt: async (params: { sessionID: string }) => {
          state.prompts.push(params.sessionID)
          return {}
        },
        promptAsync: async () => ({}),
        abort: async () => ({}),
        messages: async () => ({
          data: [
            { info: { role: "user" } },
            { info: { role: "assistant", providerID: "kimi", modelID: "k2", tokens: { input: 5000, output: 200, reasoning: 0, cache: { read: 1000, write: 0 } } } },
          ],
        }),
      },
      provider: { list: async () => ({ data: { all: [] } }) },
      event: {
        subscribe: async () => ({
          stream: (async function* () {
            yield { type: "session.idle", properties: { sessionID: state.current } }
          })(),
        }),
      },
    } as unknown as OpencodeClient)
    return { client, state }
  }

  const planTask = { id: "PLAN", title: "阶段规划(m 迁移实现)", status: "in_progress" as const, attempts: 0, body: "" }
  const spec = (reset: () => void) => ({
    kind: "阶段规划",
    step: { step: "phase-plan" as const, unit: "R-01.P01" },
    artifact: "已填充的 PLAN.md",
    requirement: "写入 PLAN.md",
    reset: async () => {
      reset()
    },
    collect: async () => 4,
  })

  test("基线完好 + 模型一致 + 会话存活 → 复用原会话、保留产物现场", async () => {
    const { dir } = await seeded({ model: "kimi/k2" })
    try {
      const { client, state } = stepClient("ses_plan_old")
      let resetCalled = false
      expect(await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => (resetCalled = true)), STRICT)).toBe(4)
      expect(resetCalled).toBe(false)
      expect(state.creates).toBe(0)
      expect(state.prompts).toEqual(["ses_plan_old"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("模型不一致 → 回滚到单元基线(现场进 stash)后开新会话重做本步骤", async () => {
    const { dir, head } = await seeded({ model: "kimi/old" })
    try {
      const { client, state } = stepClient("ses_plan_old")
      let resetCalled = false
      expect(await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => (resetCalled = true)), STRICT)).toBe(4)
      expect(resetCalled).toBe(true)
      expect(state.creates).toBe(1)
      expect(state.prompts).toEqual(["ses_new_1"])
      expect((await git(dir, "rev-parse", "--short", "HEAD")).trim()).toBe(head)
      expect(await git(dir, "stash", "list")).toContain("auto-rollback")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("原会话已死 → 同样回滚后重做(不在陌生脏区上续跑)", async () => {
    const { dir } = await seeded({ model: "kimi/k2" })
    try {
      const { client, state } = stepClient("ses_plan_old", false)
      let resetCalled = false
      expect(await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => (resetCalled = true)), STRICT)).toBe(4)
      expect(resetCalled).toBe(true)
      expect(state.creates).toBe(1)
      expect(await git(dir, "stash", "list")).toContain("auto-rollback")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("基线以来混入外部提交 → dirty 交人工(不回滚、不开会话)", async () => {
    const { dir } = await seeded({ model: "kimi/k2" })
    try {
      await writeFile(join(dir, "human.txt"), "人工改动")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "人工提交")
      const { client, state } = stepClient("ses_plan_old")
      const value = await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => {}), STRICT)
      expect(typeof value === "object" && "type" in value && value.type).toBe("dirty")
      expect(state.creates).toBe(0)
      expect(await git(dir, "stash", "list")).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("严格恢复启用前的旧记录(无基线)→ 不复用也不回滚,开新会话重做", async () => {
    const { dir } = await seeded({ withBaseline: false })
    try {
      const { client, state } = stepClient("ses_plan_old")
      let resetCalled = false
      expect(await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => (resetCalled = true)), STRICT)).toBe(4)
      expect(resetCalled).toBe(true)
      expect(state.creates).toBe(1)
      expect(await git(dir, "stash", "list")).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("开关缺省 off: 同一条模型不一致的记录仍按既有语义复用(等价现状)", async () => {
    const { dir } = await seeded({ model: "kimi/old" })
    try {
      const { client, state } = stepClient("ses_plan_old")
      let resetCalled = false
      expect(await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => (resetCalled = true)), LOOSE)).toBe(4)
      expect(resetCalled).toBe(false)
      expect(state.creates).toBe(0)
      expect(state.prompts).toEqual(["ses_plan_old"])
      expect(await git(dir, "stash", "list")).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("spec.restart after a planning-input commit: no rollback, the input commit stays, a new session plans (plans/0053 D9)", async () => {
    const { dir } = await seeded({ model: "kimi/k2" })
    try {
      await git(dir, "config", "user.email", "t@t")
      await git(dir, "config", "user.name", "t")
      await writeFile(join(dir, ".gitignore"), ".auto/\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "ignore .auto", "-m", "Auto-Stage: housekeeping")
      // The recorded baseline predates the input commit: a rollback to it
      // would reset past the commit and stash the input away.
      const phase = { round: "R-01", id: "P01", dir: join("docs", "R-01", "P01-implement") }
      expect(await savePlanInput(dir, phase, { text: "A changed input." }, "P01-implement Implementation")).toEqual({ type: "saved" })
      const head = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      const { client, state } = stepClient("ses_plan_old")
      let resetCalled = false
      const value = await requireArtifact(
        client,
        planTask,
        "planning prompt",
        { dir },
        { ...spec(() => (resetCalled = true)), unitStart: true, restart: "the planning input changed" },
        STRICT,
      )
      expect(value).toBe(4)
      expect(resetCalled).toBe(true)
      expect(state.prompts).toEqual(["ses_new_1"])
      expect((await git(dir, "rev-parse", "--short", "HEAD")).trim()).toBe(head)
      expect(await git(dir, "stash", "list")).toBe("")
      expect(await readPlanInput(dir, phase)).toBe("A changed input.\n")
      expect(await changedFiles(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

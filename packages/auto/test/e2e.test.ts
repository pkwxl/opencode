import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { load } from "../src/plan"
import { runAll } from "../src/loop"
import { renderText } from "../src/template"

// Opt-in end-to-end test: requires `opencode` on PATH (or
// OPENCODE_AUTO_SERVER pointing at a running serve) plus provider credentials.
//   OPENCODE_AUTO_E2E=1 bun test test/e2e.test.ts
const E2E = process.env.OPENCODE_AUTO_E2E === "1"

const PLAN = `## T-001: 创建 hello.txt [pending]
  - verify: command: test -f hello.txt && grep -q hello hello.txt
在当前目录创建 hello.txt,内容为 "hello"。

## T-002: 请求写权限并写入 greeting.txt [pending]
  - verify: command: test -f greeting.txt
这个任务需要先获得用户授权。调用 question 工具询问用户:
"是否允许在 opencode.json 中放行 greeting.txt 的写权限?"
拿到肯定答复后把问候语 "hello" 写入 greeting.txt。

## T-003: 汇总 [pending]
  - verify: command: test -f SUMMARY.md
创建 SUMMARY.md,列出生成的文件。
`

test.skipIf(!E2E)(
  "端到端: 三任务计划,含一次阻塞与人工介入续跑",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-e2e-"))
    try {
      await Bun.write(join(dir, "PLAN.md"), PLAN)
      await Bun.write(
        join(dir, "opencode.json"),
        await Bun.file(new URL("../templates/opencode.json", import.meta.url)).text(),
      )
      // run 前完整性检查要求 agent 契约文件存在(缺失时服务端只回 UnknownError)。
      // 与 init 一致: 写入按本次运行开关渲染后的契约(run 的不一致检查同样按渲染后比对)。
      await Bun.write(
        join(dir, ".opencode/agent/auto.md"),
        renderText(await Bun.file(new URL("../templates/.opencode/agent/auto.md", import.meta.url)).text(), {}),
      )

      // 第一轮: T-001 完成,T-002 触发 question → 阻塞停机
      expect(await runAll(dir, {})).toBe(2)
      const blocked = await load(join(dir, "PLAN.md"))
      expect(blocked.tasks[0]!.status).toBe("done")
      expect(blocked.tasks[1]!.status).toBe("blocked")
      expect(blocked.tasks[1]!.question).toBeTruthy()

      // 模拟人工介入: 阻塞的问题是会话外事务,无需填写 answer,直接重启续跑
      // 第二轮: T-002 携带"问题已在会话外解决,不要重问"的提示续跑,T-003 完成,全部 done
      expect(await runAll(dir, {})).toBe(0)
      const done = await load(join(dir, "PLAN.md"))
      expect(done.tasks.every((t) => t.status === "done")).toBe(true)
      expect(await Bun.file(join(dir, "SUMMARY.md")).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  { timeout: 600_000 },
)

// 阶段化流程 P3 端到端(phases=mv,台账已记录 m): v(验收)阶段任务豁免任务级
// 验收与 --review(与终审任务共路径),交接由蒸馏会话产出 handover.md(四小节
// 协议),归档重置后台账推进,全部阶段完成退出 0。
test.skipIf(!E2E)(
  "端到端: v 阶段验收豁免与蒸馏交接(phases=mv)",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-e2e-phase-"))
    try {
      // 台账记录 m 已完成 → 当前阶段 v;PLAN.md 预填 v 阶段任务(带 verify 字段,
      // 用于证明豁免: 即使 verify/review 启用也不做任务级验收)。
      await Bun.write(join(dir, "docs/phases.md"), "- [done] m 迁移实现 → docs/phases/m-migrate/(交接: docs/phases/m-migrate/handover.md)\n")
      await Bun.write(
        join(dir, "PLAN.md"),
        `## T-001: 验收通过性检查 [pending]
  - verify: command: test -f acceptance.md
在当前目录创建 acceptance.md,内容为 "accepted"。
`,
      )
      await Bun.write(
        join(dir, "opencode.json"),
        await Bun.file(new URL("../templates/opencode.json", import.meta.url)).text(),
      )
      await Bun.write(
        join(dir, ".opencode/agent/auto.md"),
        renderText(await Bun.file(new URL("../templates/.opencode/agent/auto.md", import.meta.url)).text(), { verify: true }),
      )

      expect(await runAll(dir, { phases: "mv", verify: true, review: 3 })).toBe(0)
      // v 阶段任务被标 done 但未写 verified 字段(豁免任务级验收),也没有跑
      // verify 脚本与质量审核的产物。
      const archived = await Bun.file(join(dir, "docs/phases/v-acceptance/PLAN.md")).text()
      expect(archived).toContain("[done]")
      expect(archived).not.toContain("verified:")
      expect(await Bun.file(join(dir, "tmp/verify.sh")).exists()).toBe(false)
      expect(await Bun.file(join(dir, ".auto/verify.md")).exists()).toBe(false)
      expect(await Bun.file(join(dir, ".auto/review.md")).exists()).toBe(false)
      // 蒸馏交接: handover.md 四小节齐备;台账推进 v 后根目录 PLAN.md 重置空模板。
      const handover = await Bun.file(join(dir, "docs/phases/v-acceptance/handover.md")).text()
      for (const section of ["## 关键决策", "## 约束与坑", "## 下一阶段必读清单", "## 产物索引"]) {
        expect(handover).toContain(section)
      }
      expect(await Bun.file(join(dir, "docs/phases.md")).text()).toContain("- [done] v 验收")
      expect((await load(join(dir, "PLAN.md"))).tasks).toEqual([])
      expect((await Bun.file(join(dir, "acceptance.md")).text()).trim()).toBe("accepted")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  { timeout: 600_000 },
)

// CLI 解析用例不需要 opencode 与 provider 凭证,始终运行: 以子进程运行源码入口,
// 用法错误经 stderr 报文与退出码 1 断言;合法组合以空目录"未找到计划文件"退出
// (解析全部通过、在 spawn server 之前),证明未误报组合用法错误。
async function runCli(args: string[]) {
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "..", "src", "index.ts"), ...args], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code: await proc.exited, out, err }
}

describe("CLI 解析: run 侧选项与配置", () => {
  test("run 拒绝已固化选项(退出码 1 + 修订指引)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const fixed = [
        ["-m", "migrate"],
        ["--mode", "migrate"],
        ["--agent", "auto"],
        ["--context-limit", "64"],
        ["--subtask", "auto"],
        ["--verify"],
        ["--verify=false"],
        ["--idle-time", "10"],
        ["--idle-max", "0"],
        ["--commit", "true"],
        ["--phases", "admtvk"],
        ["--source-dir", "/tmp"],
        ["--source-path", "src/mod.ts"],
        ["--dest-dir", "target"],
        ["--test-by-driver"],
        ["--handover-test"],
        ["--auto-number"],
        ["--no-auto-number"],
      ]
      for (const extra of fixed) {
        const run = await runCli(["run", dir, ...extra])
        expect(run.code).toBe(1)
        expect(run.err).toContain("已在 init 固化")
        expect(run.err).toContain(".opencode/auto/config.json")
        expect(run.err).toContain("opencode-auto init <dir>")
      }
      // 自动编号两键的修订指引为成对形式
      const numbering = await runCli(["run", dir, "--auto-number"])
      expect(numbering.err).toContain("--auto-number(关闭用 --no-auto-number)")
      // 迁移源两键的修订指引为成对形式
      const source = await runCli(["run", dir, "--source-dir", "/tmp"])
      expect(source.err).toContain("--source-dir <目录> --source-path <相对路径>")
      // -m/--mode 报文同型(短选项形式给出修订指引)
      expect((await runCli(["run", dir, "-m", "migrate"])).err).toContain("-m/--mode 已在 init 固化")
      // --commit-subtask 移除报文保留
      const removed = await runCli(["run", dir, "--commit-subtask"])
      expect(removed.code).toBe(1)
      expect(removed.err).toContain("--commit-subtask 已移除")
      // 看门狗旧名给出更名指引
      const renamed = await runCli(["run", dir, "--verify-idle", "10"])
      expect(renamed.code).toBe(1)
      expect(renamed.err).toContain("已更名为 --idle-time")
      expect((await runCli(["init", dir, "--verify-max", "30"])).err).toContain("已更名为 --idle-max")
      // --handover-test 需搭配 --test-by-driver(init 侧宪法级校验,run 已整体拒绝)
      const lonely = await runCli(["init", dir, "--handover-test"])
      expect(lonely.code).toBe(1)
      expect(lonely.err).toContain("--handover-test 需搭配 --test-by-driver")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("run 合法选项组合照旧,不误报用法错误", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const combos = [
        ["--final-review", "2", "--review", "3"],
        ["--final-review", "2", "--early-review", "2"],
        ["--final-review", "2", "--review", "3", "--early"],
        ["--permission", "ask-allow", "--wait-answer", "5", "--wait-between", "2"],
        ["--dryrun"],
      ]
      for (const extra of combos) {
        const run = await runCli(["run", dir, ...extra])
        // 组合合法: 配置取缺省、解析全部通过后进入 runAll,因空目录缺少
        // PLAN.md 退出 1(driver 报文走 stdout,与用法错误的 stderr 区分)。
        expect(run.code).toBe(1)
        expect(run.out).toContain("未找到计划文件")
        expect(run.err).toBe("")
        expect(run.out).toContain("⚙ 项目配置(.opencode/auto/config.json)")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("--final-review 显式值须为 1..5 整数,否则用法错误(退出码 1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      for (const value of ["0", "6", "x"]) {
        const run = await runCli(["run", dir, "--final-review", value])
        expect(run.code).toBe(1)
        expect(run.err).toContain("--final-review 取值范围为 1..5")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("旧项目回落: 仅 .auto/config.json 有 mode 时 run 提示沿用旧位置", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await Bun.write(join(dir, ".auto/config.json"), JSON.stringify({ mode: "migrate" }))
      const run = await runCli(["run", dir])
      expect(run.out).toContain("模式沿用旧位置 .auto/config.json 的持久化值,重跑 init 可固化完整配置")
      expect(run.out).toContain("未找到计划文件")
      expect(run.err).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("配置文件坏值 → run 退出码 1,报错含键名与期望", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ idleTime: 999 }))
      const run = await runCli(["run", dir])
      expect(run.code).toBe(1)
      expect(run.err).toContain("idleTime")
      expect(run.err).toContain("1..120")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --mode 未注册名为用法错误(退出码 1),报文列出支持的模式", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--mode", "nope"])
      expect(init.code).toBe(1)
      expect(init.err).toContain("--mode 取值须为已注册的模式")
      expect(init.err).toContain("migrate")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: init 固化项目配置", () => {
  async function readConfig(dir: string) {
    return JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())
  }

  test("init 写出完整 config(全键缺省)并打印摘要", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir])
      expect(init.code).toBe(0)
      expect(init.out).toContain("⚙ 项目配置(.opencode/auto/config.json)")
      expect(init.out).toContain("编辑 PLAN.md 填入任务后运行")
      expect(await readConfig(dir)).toEqual({
        mode: "migrate",
        agent: "auto",
        contextLimit: 64,
        subtask: "auto",
        verify: false,
        idleTime: 10,
        idleMax: 0,
        commit: true,
        testByDriver: false,
        handoverTest: false,
        autoNumber: false,
        phases: "m",
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init amend 仅改写显式给出的键,重复 init 无参数不重置", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["init", dir, "--verify", "--context-limit", "128", "--commit", "false"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual({
        mode: "migrate",
        agent: "auto",
        contextLimit: 128,
        subtask: "auto",
        verify: true,
        idleTime: 10,
        idleMax: 0,
        commit: false,
        testByDriver: false,
        handoverTest: false,
        autoNumber: false,
        phases: "m",
      })
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await readConfig(dir)).commit).toBe(false)
      expect((await readConfig(dir)).verify).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --auto-number/--no-auto-number 固化与 amend;两开关同现为用法错误;phases = m 打提示", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      // 启用: 固化 true,摘要含自动编号段;phases = m(缺省)无规划会话 → ℹ 提示
      const init = await runCli(["init", dir, "--auto-number"])
      expect(init.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ autoNumber: true })
      expect(init.out).toContain("自动编号 on")
      expect(init.out).toContain("无规划会话消费编号记录")
      // 阶段化流程(phases 含规划会话)不打该提示
      const staged = await runCli(["init", dir, "--phases", "am"])
      expect(staged.code).toBe(0)
      expect(staged.out).not.toContain("无规划会话消费编号记录")
      // amend: --no-auto-number 覆盖回 false;无参数重复 init 保留
      expect((await runCli(["init", dir, "--no-auto-number"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ autoNumber: false })
      expect((await runCli(["init", dir, "--auto-number"])).code).toBe(0)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ autoNumber: true })
      // =false 形式视同未给出
      expect((await runCli(["init", dir, "--auto-number=false"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ autoNumber: true })
      // 两开关同现且均未带 =false → 用法错误(init/continue 共用分支,continue 同样拦截)
      const both = await runCli(["init", dir, "--auto-number", "--no-auto-number"])
      expect(both.code).toBe(1)
      expect(both.err).toContain("互斥")
      const contBoth = await runCli(["continue", dir, "--auto-number", "--no-auto-number"])
      expect(contBoth.code).toBe(1)
      expect(contBoth.err).toContain("互斥")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init 显式键取值非法为用法错误(退出码 1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const bad = [
        ["--subtask", "fast"],
        ["--context-limit", "0"],
        ["--idle-time", "999"],
        ["--idle-max", "0.5"],
        ["--commit", "maybe"],
      ]
      for (const extra of bad) {
        const init = await runCli(["init", dir, ...extra])
        expect(init.code).toBe(1)
        expect(init.err).not.toBe("")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --test-by-driver/--handover-test 固化配置并补写/移除 AGENTS.md 测试执行原则块", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--test-by-driver", "--handover-test"])
      expect(init.code).toBe(0)
      expect(init.out).toContain("已补写: AGENTS.md 测试执行原则块")
      expect(await readConfig(dir)).toMatchObject({ testByDriver: true, handoverTest: true })
      const agents = await Bun.file(join(dir, "AGENTS.md")).text()
      expect(agents).toContain("opencode-auto:test:start")
      expect(agents).toContain("编译、测试、构建、lint")
      // agent 契约同步带测试协议段(内联在工作契约第 2 条)
      const agent = await Bun.file(join(dir, ".opencode/agent/auto.md")).text()
      expect(agent).toContain("编译、测试、构建、lint 等可能耗时长")
      expect(agent).toContain("tmp/test.sh")
      // amend 关闭 handover-test 保留 test-by-driver;再关闭 test-by-driver 移除块
      expect((await runCli(["init", dir, "--handover-test", "false"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ testByDriver: true, handoverTest: false })
      const off = await runCli(["init", dir, "--test-by-driver", "false"])
      expect(off.code).toBe(0)
      expect(off.out).toContain("已移除: AGENTS.md 测试执行原则块(测试由 driver 执行未启用)")
      expect(await Bun.file(join(dir, "AGENTS.md")).text()).not.toContain("opencode-auto:test:start")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("status 先打印配置摘要再列任务清单;配置非法不阻塞清单", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      const status = await runCli(["status", dir])
      expect(status.code).toBe(0)
      expect(status.out).toContain("⚙ 项目配置(.opencode/auto/config.json): 模式 migrate · agent auto")
      expect(status.out).toContain("阶段 m")
      expect(status.out).toContain("[pending] T-001")
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ subtask: "fast" }))
      const broken = await runCli(["status", dir])
      expect(broken.code).toBe(0)
      expect(broken.out).toContain("⚠ 项目配置(.opencode/auto/config.json) 非法")
      expect(broken.out).toContain("subtask")
      expect(broken.out).toContain("[pending] T-001")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: phases / source / brief(阶段化流程 P1)", () => {
  async function readConfig(dir: string) {
    return JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())
  }

  async function writeLedger(dir: string, letters: string[]) {
    await Bun.write(
      join(dir, "docs/phases.md"),
      letters.map((letter) => `- [done] ${letter} 阶段 → docs/phases/${letter}-x/`).join("\n") + "\n",
    )
  }

  test("init --phases 非法取值为用法错误,报文给出合法形式", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      for (const value of ["tma", "adk", "mm", "x", ""]) {
        const init = await runCli(["init", dir, "--phases", value])
        expect(init.code).toBe(1)
        expect(init.err).toContain("--phases 取值须为 admtvk 的子序列且包含 m")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --phases 合法值固化进 config;摘要含阶段;结束语按 phases 分两态", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--phases", "admtvk"])
      expect(init.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "admtvk" })
      expect(init.out).toContain("阶段 admtvk")
      expect(init.out).toContain("开始 a(分析)阶段规划")
      expect(init.out).not.toContain("编辑 PLAN.md 填入任务")
      // amend: 无 --phases 保留既有值;显式给值可改
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "admtvk" })
      expect((await runCli(["init", dir, "--phases", "amt"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "amt" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init 前缀护栏: 台账非空时改 --phases 须以已完成阶段为前缀", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "admtvk"])).code).toBe(0)
      await writeLedger(dir, ["a", "d"])
      // "ad" 不是 "amt" 的前缀 → 拒绝并指引人工修订台账
      const bad = await runCli(["init", dir, "--phases", "amt"])
      expect(bad.code).toBe(1)
      expect(bad.err).toContain("阶段台账")
      expect(bad.err).toContain("ad")
      expect(bad.err).toContain("前缀")
      // 兼容值通过;台账已完成的 a/d 之后,下一阶段提示 m(迁移实现)
      const ok = await runCli(["init", dir, "--phases", "admtk"])
      expect(ok.code).toBe(0)
      expect(ok.out).toContain("开始 m(迁移实现)阶段规划")
      // 无 --phases 时不受护栏影响(不显式改写即无冲突)
      expect((await runCli(["init", dir])).code).toBe(0)
      // 台账非法时 init 报环境错误并给人工修订指引
      await Bun.write(join(dir, "docs/phases.md"), "- [done] a\n")
      const broken = await runCli(["init", dir, "--phases", "admtvk"])
      expect(broken.code).toBe(1)
      expect(broken.err).toContain("docs/phases.md")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --source-dir/--source-path 必须成对、须为工作目录下相对路径并校验存在性;--dest-dir 固化", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const onlyDir = await runCli(["init", dir, "--source-dir", "legacy"])
      expect(onlyDir.code).toBe(1)
      expect(onlyDir.err).toContain("必须成对")
      const onlyPath = await runCli(["init", dir, "--source-path", "src/mod.ts"])
      expect(onlyPath.code).toBe(1)
      expect(onlyPath.err).toContain("必须成对")
      // source-dir/dest-dir 均须为工作目录下的相对路径(绝对路径与 .. 逃逸拒绝)
      const absolute = await runCli(["init", dir, "--source-dir", dir, "--source-path", "src/mod.ts"])
      expect(absolute.code).toBe(1)
      expect(absolute.err).toContain("工作目录下的相对路径")
      const missing = await runCli(["init", dir, "--source-dir", "nope", "--source-path", "src/mod.ts"])
      expect(missing.code).toBe(1)
      expect(missing.err).toContain("现存目录")
      const escape = await runCli(["init", dir, "--source-dir", "legacy", "--source-path", "../mod.ts"])
      expect(escape.code).toBe(1)
      expect(escape.err).toContain("相对路径")
      const destAbs = await runCli(["init", dir, "--dest-dir", join(dir, "target")])
      expect(destAbs.code).toBe(1)
      expect(destAbs.err).toContain("--dest-dir 须为工作目录下的相对路径")
      expect((await runCli(["init", dir, "--dest-dir", "../up"])).code).toBe(1)
      // 合法迁移参数: source 在 <dir>/<source-dir>/<source-path> 存在;dest-dir
      // 只固化路径、不校验存在性(目标目录常由迁移过程创建)
      const sourcePath = "src/mod.ts"
      await Bun.write(join(dir, "legacy", sourcePath), "export {}\n")
      const ok = await runCli(["init", dir, "--source-dir", "legacy", "--source-path", sourcePath, "--dest-dir", "target"])
      expect(ok.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ source: { dir: "legacy", path: sourcePath }, destDir: "target" })
      // amend: 不给迁移参数则保留既有值;--dest-dir 单独修订
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ source: { dir: "legacy", path: sourcePath }, destDir: "target" })
      expect((await runCli(["init", dir, "--dest-dir", "app"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ source: { dir: "legacy", path: sourcePath }, destDir: "app" })
      // source-dir 接受软链接: 存在性校验经 stat 跟随解析,可把源系统大树留在
      // 工作目录外、以链接接入(断链仍按不存在拒绝)
      const outside = await mkdtemp(join(tmpdir(), "auto-cli-src-"))
      await Bun.write(join(outside, "pkg/legacy.ts"), "export {}\n")
      await symlink(outside, join(dir, "linked"))
      const linked = await runCli(["init", dir, "--source-dir", "linked", "--source-path", "pkg/legacy.ts"])
      expect(linked.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ source: { dir: "linked", path: "pkg/legacy.ts" } })
      await symlink(join(dir, "nowhere"), join(dir, "broken"))
      expect((await runCli(["init", dir, "--source-dir", "broken", "--source-path", "x"])).code).toBe(1)
      await rm(outside, { recursive: true, force: true })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init -p 写 brief.md(覆盖重写),无 -p 保留既有;init 不启动 AI 会话", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const brief = join(dir, ".opencode/auto/brief.md")
      const first = await runCli(["init", dir, "-p", "把 legacy 迁移到 bun"])
      expect(first.code).toBe(0)
      expect(first.out).toContain("已写入: .opencode/auto/brief.md")
      expect(first.out).toContain("brief 已记录")
      expect(await Bun.file(brief).text()).toBe("把 legacy 迁移到 bun\n")
      // 无 -p 保留既有
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await Bun.file(brief).text()).toBe("把 legacy 迁移到 bun\n")
      // 重复 init -p 覆盖重写(amend 语义);空文本为用法错误
      expect((await runCli(["init", dir, "-p", "修订后的意图"])).code).toBe(0)
      expect(await Bun.file(brief).text()).toBe("修订后的意图\n")
      const empty = await runCli(["init", dir, "-p", "  "])
      expect(empty.code).toBe(1)
      expect(empty.err).toContain("-p/--prompt 需要非空的提示词文本")
      // 阶段化流程下结束语引导开始首个阶段规划
      const staged = await runCli(["init", dir, "--phases", "am", "-p", "意图"])
      expect(staged.out).toContain("brief 已记录")
      expect(staged.out).toContain("开始 a(分析)阶段规划")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("phases 含 v 而 verify 未启用时 init 打 note;启用后不再打", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--phases", "mvk"])
      expect(init.code).toBe(0)
      expect(init.out).toContain("phases 含 v(验收)阶段而任务级验收未启用")
      const enabled = await runCli(["init", dir, "--verify"])
      expect(enabled.code).toBe(0)
      expect(enabled.out).not.toContain("任务级验收未启用")
      // 不含 v 时不提示
      const plain = await runCli(["init", dir, "--phases", "am"])
      expect(plain.out).not.toContain("任务级验收未启用")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: 阶段化流程 P2(空模板 / 阶段行 / 台账预检)", () => {
  test("init --phases amt → PLAN.md 为空模板(无任务);status 打印阶段进度行", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--phases", "amt"])
      expect(init.code).toBe(0)
      const plan = await Bun.file(join(dir, "PLAN.md")).text()
      expect(plan).not.toContain("## T-")
      expect(plan).toContain("阶段规划会话")
      const status = await runCli(["status", dir])
      expect(status.code).toBe(0)
      expect(status.out).toContain("阶段: a▶ m t")
      // 空模板无任务,清单为空
      expect(status.out).not.toContain("[pending] T-001")
      // 台账推进后进度行随之更新
      await Bun.write(join(dir, "docs/phases.md"), "- [done] a 分析 → docs/phases/a-analysis/(交接: docs/phases/a-analysis/handover.md)\n")
      expect((await runCli(["status", dir])).out).toContain("阶段: a✓ m▶ t")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("phases = m 维持占位模板;切换 --phases 时占位模板态替换为空模板,已填任务保留", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await Bun.file(join(dir, "PLAN.md")).text()).toContain("## T-001: <任务标题> [pending]")
      // 占位模板态(从未编辑)在切换 --phases 时视为缺失,替换为空模板
      const staged = await runCli(["init", dir, "--phases", "am"])
      expect(staged.code).toBe(0)
      expect(staged.out).toContain("已替换(占位模板换为空模板")
      expect(await Bun.file(join(dir, "PLAN.md")).text()).not.toContain("## T-")
      // 已填真实任务的 PLAN.md 不被替换
      await Bun.write(join(dir, "PLAN.md"), "## T-001: 真实任务 [pending]\n正文\n")
      expect((await runCli(["init", dir, "--phases", "amt"])).code).toBe(0)
      expect(await Bun.file(join(dir, "PLAN.md")).text()).toContain("真实任务")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("run 打印阶段进度行;台账非法为环境错误退出 1(先于 server 启动)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "amt"])).code).toBe(0)
      // 台账行非法 → 预检退出 1,报文给人工修订指引
      await Bun.write(join(dir, "docs/phases.md"), "- [done] a\n")
      const broken = await runCli(["run", dir])
      expect(broken.code).toBe(1)
      expect(broken.out).toContain("阶段流程受阻")
      expect(broken.out).toContain("docs/phases.md")
      // 台账含 phases 外字母(k 不在 amt)→ 同为环境错误
      await Bun.write(join(dir, "docs/phases.md"), "- [done] k 知识提炼 → docs/phases/k-knowledge/\n")
      const outside = await runCli(["run", dir])
      expect(outside.code).toBe(1)
      expect(outside.out).toContain("之外的阶段字母")
      // 合法台账通过预检;阶段进度行在配置摘要后打印(删掉 PLAN.md 使 run 在
      // server 启动前退出,仅断言横幅)
      await Bun.write(join(dir, "docs/phases.md"), "- [done] a 分析 → docs/phases/a-analysis/(交接: docs/phases/a-analysis/handover.md)\n")
      await rm(join(dir, "PLAN.md"))
      const banner = await runCli(["run", dir])
      expect(banner.out).toContain("阶段: a✓ m▶ t")
      expect(banner.out).toContain("未找到计划文件")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("status 台账非法仅提示不阻塞;phases = m 不打印阶段进度行", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "amt"])).code).toBe(0)
      await Bun.write(join(dir, "docs/phases.md"), "随便一行\n")
      const status = await runCli(["status", dir])
      expect(status.code).toBe(0)
      expect(status.out).toContain("⚠ 阶段台账(docs/phases.md)非法")
      // phases = m 的项目不打印阶段行(缺省单次运行,无阶段语义)
      const plain = await mkdtemp(join(tmpdir(), "auto-cli-"))
      try {
        expect((await runCli(["init", plain])).code).toBe(0)
        expect((await runCli(["status", plain])).out).not.toContain("阶段: ")
      } finally {
        await rm(plain, { recursive: true, force: true })
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: continue 子命令(续轮迁移,M 节)", () => {
  async function readConfig(dir: string) {
    return JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())
  }

  async function writeLedger(dir: string, letters: string[]) {
    await Bun.write(
      join(dir, "docs/phases.md"),
      letters.map((letter) => `- [done] ${letter} 阶段 → docs/phases/${letter}-x/`).join("\n") + "\n",
    )
  }

  test("--continue 不是选项: init/run 出现即指向 continue 子命令", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--continue"])
      expect(init.code).toBe(1)
      expect(init.err).toContain("独立子命令 opencode-auto continue")
      const run = await runCli(["run", dir, "--continue"])
      expect(run.code).toBe(1)
      expect(run.err).toContain("独立子命令 opencode-auto continue")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("非阶段化项目 / 台账未完成 / --phases m / 跨轮固定选项 → 退出码 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      // phases = m(缺省)的项目没有轮的概念
      expect((await runCli(["init", dir])).code).toBe(0)
      const plain = await runCli(["continue", dir])
      expect(plain.code).toBe(1)
      expect(plain.err).toContain("continue 仅用于阶段化流程项目")
      // 阶段化但台账为空(上一轮尚未开始/未完成)
      expect((await runCli(["init", dir, "--phases", "am"])).code).toBe(0)
      const empty = await runCli(["continue", dir])
      expect(empty.code).toBe(1)
      expect(empty.err).toContain("为空")
      expect(empty.err).toContain("尚缺 a、m")
      // 台账半程
      await writeLedger(dir, ["a"])
      const partial = await runCli(["continue", dir])
      expect(partial.code).toBe(1)
      expect(partial.err).toContain("尚缺 m")
      // --phases m 显式给出
      const m = await runCli(["continue", dir, "--phases", "m"])
      expect(m.code).toBe(1)
      expect(m.err).toContain('不可为 "m"')
      // 台账含 phases 之外字母 → 环境错误
      await writeLedger(dir, ["a", "m", "k"])
      const outside = await runCli(["continue", dir])
      expect(outside.code).toBe(1)
      expect(outside.err).toContain("之外的阶段字母")
      await writeLedger(dir, ["a", "m"])
      // 迁移同一性选项跨轮固定: -m 与迁移三键显式给出即用法错误
      for (const extra of [["-m", "migrate"], ["--mode", "migrate"], ["--source-dir", "legacy", "--source-path", "x"], ["--dest-dir", "target"]]) {
        const locked = await runCli(["continue", dir, ...extra])
        expect(locked.code).toBe(1)
        expect(locked.err).toContain("跨轮固定")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("上一轮全部完成 → 归档重置 + 参数按轮修订 + 新一轮状态正确", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "am", "-p", "第一轮意图"])).code).toBe(0)
      await writeLedger(dir, ["a", "m"])
      // 轮后手工留下的任务也一并归档留痕(台账完整 = 完成态,routePhase complete)
      await Bun.write(join(dir, "PLAN.md"), "## T-009: 轮后手工任务 [pending]\n正文\n")
      // 新 phases "admtvk" 不以台账 "am" 为前缀——归档重置后不受前缀护栏约束
      const cont = await runCli(["continue", dir, "--phases", "admtvk", "-p", "第二轮聚焦补齐差距", "--context-limit", "128"])
      expect(cont.code).toBe(0)
      expect(cont.out).toContain("上一轮(第 1 轮)已归档")
      expect(cont.out).toContain("docs/phases/round-1/")
      expect(cont.out).toContain("已开启第 2 轮继续迁移")
      expect(cont.out).toContain("开始 a(分析)阶段规划")
      expect(await readConfig(dir)).toMatchObject({ phases: "admtvk", contextLimit: 128 })
      // 归档内容与状态重置
      expect(await Bun.file(join(dir, "docs/phases/round-1/phases.md")).text()).toContain("- [done] a")
      expect(await Bun.file(join(dir, "docs/phases/round-1/PLAN.md")).text()).toContain("轮后手工任务")
      expect(await Bun.file(join(dir, "docs/phases.md")).exists()).toBe(false)
      // 根 PLAN.md 由模板循环重建为空模板
      const plan = await Bun.file(join(dir, "PLAN.md")).text()
      expect(plan).not.toContain("## T-")
      expect(plan).toContain("阶段规划会话")
      // -p 覆盖为新轮意图
      expect(await Bun.file(join(dir, ".opencode/auto/brief.md")).text()).toBe("第二轮聚焦补齐差距\n")
      // status: 阶段进度行带轮次标注
      const status = await runCli(["status", dir])
      expect(status.out).toContain("阶段(第 2 轮): a▶ d m t v k")
      // 重复 continue: 台账已重置(新一轮未开始)→ 拒绝并指引先跑 run
      const again = await runCli(["continue", dir])
      expect(again.code).toBe(1)
      expect(again.err).toContain("尚缺 a、d、m、t、v、k")
      expect(again.err).toContain(`opencode-auto run ${dir}`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("continue 不带 --phases 保留既有阶段;run 横幅带轮次标注", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "am"])).code).toBe(0)
      await writeLedger(dir, ["a", "m"])
      const cont = await runCli(["continue", dir])
      expect(cont.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "am" })
      expect(cont.out).toContain("开始 a(分析)阶段规划")
      // run 启动横幅的阶段进度行带轮次标注(删除 PLAN.md 使 run 在 server 前退出)
      await rm(join(dir, "PLAN.md"))
      const banner = await runCli(["run", dir])
      expect(banner.out).toContain("阶段(第 2 轮): a▶ m")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

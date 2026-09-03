import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { load } from "../src/plan"
import { runAll } from "../src/loop"

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
      await Bun.write(
        join(dir, ".opencode/agent/auto.md"),
        await Bun.file(new URL("../templates/.opencode/agent/auto.md", import.meta.url)).text(),
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
        await Bun.file(new URL("../templates/.opencode/agent/auto.md", import.meta.url)).text(),
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

// CLI 解析用例不需要 opencode 与 provider 凭证,始终运行: 以子进程运行源码入口。
// 用法/环境错误经 stderr 报文与退出码 1 断言;合法路径预置 .auto/tool.json
// {done:true} 完成标记,使主程序在启动 server 之前报告"已完成"退出 0。
async function runCli(args: string[]) {
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "..", "src", "index.ts"), ...args], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code: await proc.exited, out, err }
}

async function readConfig(dir: string) {
  return JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())
}

// 预置完成标记: 合法路径在启动 server 前报告完成退出 0(无需 opencode 环境)。
async function seedDone(dir: string) {
  await Bun.write(join(dir, ".auto/tool.json"), JSON.stringify({ done: true }))
}

describe("CLI: 去子命令化与历史选项拦截", () => {
  test("旧子命令(init/continue/run/check/status)出现即报错指向新用法", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      for (const cmd of ["init", "continue", "run", "check", "status"]) {
        const run = await runCli([cmd, dir])
        expect(run.code).toBe(1)
        expect(run.err).toContain(`子命令 ${cmd} 已移除`)
        expect(run.err).toContain("opencode-auto [dir]")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("--phases/--continue/--commit-subtask/看门狗旧名均拦截", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const phases = await runCli([dir, "--phases", "admtvk"])
      expect(phases.code).toBe(1)
      expect(phases.err).toContain("--phases 已移除")
      expect(phases.err).toContain("admtvk")
      const cont = await runCli([dir, "--continue"])
      expect(cont.code).toBe(1)
      expect(cont.err).toContain("--continue 已移除")
      const sub = await runCli([dir, "--commit-subtask"])
      expect(sub.code).toBe(1)
      expect(sub.err).toContain("--commit-subtask 已移除")
      expect((await runCli([dir, "--verify-idle", "10"])).err).toContain("已更名为 --idle-time")
      expect((await runCli([dir, "--verify-max", "30"])).err).toContain("已更名为 --idle-max")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("非法取值为用法错误(退出码 1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const bad: string[][] = [
        ["--subtask", "fast"],
        ["--context-limit", "0"],
        ["--idle-time", "999"],
        ["--idle-max", "0.5"],
        ["--commit", "maybe"],
        ["--review", "11"],
        ["--permission", "yolo"],
        ["--handover-test"],
      ]
      for (const extra of bad) {
        const run = await runCli([dir, ...extra])
        expect(run.code).toBe(1)
        expect(run.err).not.toBe("")
      }
      for (const value of ["0", "6", "x"]) {
        const run = await runCli([dir, "--final-review", value])
        expect(run.code).toBe(1)
        expect(run.err).toContain("--final-review 取值范围为 1..5")
      }
      const early = await runCli([dir, "--early"])
      expect(early.code).toBe(1)
      expect(early.err).toContain("--early 需搭配 --review")
      const both = await runCli([dir, "--review", "3", "--early-review", "2"])
      expect(both.code).toBe(1)
      expect(both.err).toContain("快捷糖")
      const mutex = await runCli([dir, "--interactive", "--verbose"])
      expect(mutex.code).toBe(1)
      expect(mutex.err).toContain("互斥")
      expect((await runCli([dir, "-p", "  "])).err).toContain("-p/--prompt 需要非空的提示词文本")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("非法取值在固化前拦截: 新目录不留 .opencode/auto/config.json", async () => {
    const bad: string[][] = [
      ["--wait-answer", "99"],
      ["--wait-between", "0"],
      ["--review", "11"],
      ["--early-review", "x"],
      ["--final-review", "6"],
      ["--permission", "yolo"],
      ["--interactive", "--verbose"],
      ["--early"],
      ["--review", "3", "--early-review", "2"],
      ["--handover-test"],
      ["--mode", "nope"],
    ]
    for (const extra of bad) {
      const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
      try {
        const run = await runCli([dir, ...extra])
        expect(run.code).toBe(1)
        expect(run.err).not.toBe("")
        expect(await readdir(dir)).toEqual([])
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    }
  })

  test("--help 打印用法并退出 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const help = await runCli([dir, "--help"])
      expect(help.code).toBe(0)
      expect(help.out).toContain("opencode-auto [dir]")
      expect(help.out).toContain("关键参数")
      expect(help.out).toContain("运行参数")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: 首次运行固化配置", () => {
  test("缺省固化(全键缺省 + phases 固定 admtvk);模板生成;done 标记预置时报告完成", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await seedDone(dir)
      const run = await runCli([dir])
      expect(run.code).toBe(0)
      expect(run.err).toBe("")
      expect(run.out).toContain("已固化项目配置(.opencode/auto/config.json)")
      expect(run.out).toContain("二次迁移已全部完成")
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
        phases: "admtvk",
      })
      // 模板: PLAN.md 为空模板(无任务,交给阶段规划会话);opencode.json 与
      // agent 契约生成
      const plan = await Bun.file(join(dir, "PLAN.md")).text()
      expect(plan).not.toContain("## T-")
      expect(plan).toContain("阶段规划会话")
      expect(await Bun.file(join(dir, "opencode.json")).exists()).toBe(true)
      expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).exists()).toBe(true)
      // verify 未启用的首跑提示(流程含 v 阶段)
      expect(run.out).toContain("v(验收)阶段而任务级验收未启用")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("显式关键参数固化;-p 写 brief.md;verify 启用后不再打 v 阶段提示", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await seedDone(dir)
      await Bun.write(join(dir, "legacy/src/mod.ts"), "export {}\n")
      const run = await runCli([
        dir,
        "-p",
        "把 legacy 迁移到 bun",
        "--verify",
        "--subtask",
        "ondemand",
        "--context-limit",
        "128",
        "--commit",
        "false",
        "--test-by-driver",
        "--handover-test",
        "--source-dir",
        "legacy",
        "--source-path",
        "src/mod.ts",
        "--dest-dir",
        "target",
      ])
      expect(run.code).toBe(0)
      expect(run.err).toBe("")
      expect(await readConfig(dir)).toMatchObject({
        verify: true,
        subtask: "ondemand",
        contextLimit: 128,
        commit: false,
        testByDriver: true,
        handoverTest: true,
        source: { dir: "legacy", path: "src/mod.ts" },
        destDir: "target",
      })
      expect(await Bun.file(join(dir, ".opencode/auto/brief.md")).text()).toBe("把 legacy 迁移到 bun\n")
      expect(run.out).not.toContain("任务级验收未启用")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("--mode 未注册名为用法错误;旧 .auto/config.json 的 mode 在首跑回落生效", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const bad = await runCli([dir, "--mode", "nope"])
      expect(bad.code).toBe(1)
      expect(bad.err).toContain("--mode 取值须为已注册的模式")
      expect(bad.err).toContain("migrate")
      await Bun.write(join(dir, ".auto/config.json"), JSON.stringify({ mode: "migrate" }))
      await seedDone(dir)
      expect((await runCli([dir])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ mode: "migrate" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("--source-dir/--source-path 成对与路径校验(首跑)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const onlyDir = await runCli([dir, "--source-dir", "legacy"])
      expect(onlyDir.code).toBe(1)
      expect(onlyDir.err).toContain("必须成对")
      const absolute = await runCli([dir, "--source-dir", dir, "--source-path", "src/mod.ts"])
      expect(absolute.code).toBe(1)
      expect(absolute.err).toContain("工作目录下的相对路径")
      const missing = await runCli([dir, "--source-dir", "nope", "--source-path", "src/mod.ts"])
      expect(missing.code).toBe(1)
      expect(missing.err).toContain("现存目录")
      const escape = await runCli([dir, "--source-dir", "legacy", "--source-path", "../mod.ts"])
      expect(escape.code).toBe(1)
      expect(escape.err).toContain("相对路径")
      expect((await runCli([dir, "--dest-dir", "../up"])).code).toBe(1)
      // source-dir 接受软链接(stat 跟随解析);断链按不存在拒绝
      const outside = await mkdtemp(join(tmpdir(), "auto-cli-src-"))
      try {
        await Bun.write(join(outside, "pkg/legacy.ts"), "export {}\n")
        await symlink(outside, join(dir, "linked"))
        await seedDone(dir)
        const linked = await runCli([dir, "--source-dir", "linked", "--source-path", "pkg/legacy.ts"])
        expect(linked.code).toBe(0)
        expect(await readConfig(dir)).toMatchObject({ source: { dir: "linked", path: "pkg/legacy.ts" } })
      } finally {
        await rm(outside, { recursive: true, force: true })
      }
      const fresh = await mkdtemp(join(tmpdir(), "auto-cli-"))
      try {
        await symlink(join(fresh, "nowhere"), join(fresh, "broken"))
        expect((await runCli([fresh, "--source-dir", "broken", "--source-path", "x"])).code).toBe(1)
      } finally {
        await rm(fresh, { recursive: true, force: true })
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: 二次运行关键参数与首次对齐", () => {
  test("与固化值不一致即退出码 1(报文含生效值与修订指引);一致视同未给出", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await seedDone(dir)
      expect((await runCli([dir, "--verify", "--context-limit", "128", "--dest-dir", "target"])).code).toBe(0)
      const conflict = await runCli([dir, "--verify", "false"])
      expect(conflict.code).toBe(1)
      expect(conflict.err).toContain("与首次运行固化的配置不一致")
      expect(conflict.err).toContain("--verify")
      expect(conflict.err).toContain(".opencode/auto/config.json")
      const conflict2 = await runCli([dir, "--context-limit", "64"])
      expect(conflict2.code).toBe(1)
      expect(conflict2.err).toContain("--context-limit")
      expect((await runCli([dir, "--dest-dir", "other"])).code).toBe(1)
      // 与固化值一致可正常通过;-p 每次均可重写 brief
      const ok = await runCli([dir, "--verify", "--context-limit", "128", "--dest-dir", "target", "-p", "修订意图"])
      expect(ok.code).toBe(0)
      expect(ok.out).toContain("二次迁移已全部完成")
      expect(await Bun.file(join(dir, ".opencode/auto/brief.md")).text()).toBe("修订意图\n")
      // 无参数重复运行不报错、不重置配置
      expect((await runCli([dir])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ verify: true, contextLimit: 128 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("配置文件坏值 → 退出码 1,报错含键名与期望", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ idleTime: 999 }))
      const run = await runCli([dir])
      expect(run.code).toBe(1)
      expect(run.err).toContain("idleTime")
      expect(run.err).toContain("1..120")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("合法运行参数组合不误报用法错误", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await seedDone(dir)
      const combos = [
        ["--final-review", "2", "--review", "3"],
        ["--final-review", "2", "--early-review", "2"],
        ["--final-review", "2", "--review", "3", "--early"],
        ["--permission", "ask-allow", "--wait-answer", "5", "--wait-between", "2"],
        ["--dryrun"],
      ]
      for (const extra of combos) {
        const run = await runCli([dir, ...extra])
        expect(run.code).toBe(0)
        expect(run.err).toBe("")
        expect(run.out).toContain("⚙ 项目配置(.opencode/auto/config.json)")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadPlan } from "@opencode-ai/auto-core/tasks"
import { runAll } from "@opencode-ai/auto-core/loop"
import { completePhase, establishRound, readPhases } from "@opencode-ai/auto-core/phases"
import { renderText } from "@opencode-ai/auto-core/template"
import templateConfig from "@opencode-ai/auto-core/templates/opencode.json" with { type: "file" }
import templateAgent from "@opencode-ai/auto-core/templates/.opencode/agent/auto.md" with { type: "file" }

// Opt-in end-to-end test: requires `opencode` on PATH (or
// OPENCODE_AUTO_SERVER pointing at a running serve) plus provider credentials.
//   OPENCODE_AUTO_E2E=1 bun test test/e2e.test.ts
const E2E = process.env.OPENCODE_AUTO_E2E === "1"

// List tasks in a phase's task index with their todo.md (the unit layout,
// M3.4): [id, title, body] each.
async function listTasks(dir: string, phaseDir: string, phase: string, tasks: [string, string, string][]) {
  await Bun.write(join(dir, phaseDir, "tasks.md"), `# Tasks\n\n${tasks.map(([id, title]) => `- [ ] ${id} ${title}\n`).join("")}`)
  for (const [id, title, body] of tasks) {
    await Bun.write(join(dir, "docs", id, "todo.md"), `# ${id}: ${title}\nPhase: ${phase}\n\n## Goal\n\n${body}\n`)
  }
}

const TASKS: [string, string, string][] = [
  ["T-001", "创建 hello.txt", '在当前目录创建 hello.txt,内容为 "hello"。'],
  [
    "T-002",
    "请求写权限并写入 greeting.txt",
    '这个任务需要先获得用户授权。调用 question 工具询问用户:\n"是否允许在 opencode.json 中放行 greeting.txt 的写权限?"\n拿到肯定答复后把问候语 "hello" 写入 greeting.txt。',
  ],
  ["T-003", "汇总", "创建 SUMMARY.md,列出生成的文件。"],
]

const P01 = { round: "R-01", id: "P01", dir: "docs/R-01/P01-implement" }

test.skipIf(!E2E)(
  "端到端: 三任务计划,含一次阻塞与人工介入续跑",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-e2e-"))
    try {
      await establishRound(dir, { phases: "m" })
      await listTasks(dir, P01.dir, "R-01.P01", TASKS)
      await Bun.write(
        join(dir, "opencode.json"),
        await Bun.file(templateConfig).text(),
      )
      // run 前完整性检查要求 agent 契约文件存在(缺失时服务端只回 UnknownError)。
      // 与 init 一致: 写入按本次运行开关渲染后的契约(run 的不一致检查同样按渲染后比对)。
      await Bun.write(
        join(dir, ".opencode/agent/auto.md"),
        renderText(await Bun.file(templateAgent).text(), {}),
      )

      // 第一轮: T-001 完成,T-002 触发 question → 阻塞停机
      expect(await runAll(dir, {})).toBe(2)
      const blocked = await loadPlan(dir, P01)
      expect(blocked.tasks[0]!.status).toBe("done")
      expect(blocked.tasks[1]!.status).toBe("blocked")
      // 阻塞原因不写进任务文档(只在运行日志里)
      expect(await Bun.file(join(dir, "docs/T-002/todo.md")).text()).not.toContain("question:")

      // 模拟人工介入: 阻塞的问题是会话外事务,直接重启续跑
      // 第二轮: T-002 续跑,T-003 完成,全部 done
      expect(await runAll(dir, {})).toBe(0)
      const done = await loadPlan(dir, P01)
      expect(done.tasks.every((t) => t.status === "done")).toBe(true)
      expect(await Bun.file(join(dir, "SUMMARY.md")).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  { timeout: 600_000 },
)

// Mark the current round's phases of these preset letters complete, the way
// the driver does (completePhase: todo.md → done.md + index tick).
async function completeLetters(dir: string, letters: string[]) {
  for (const unit of (await readPhases(dir))!.phases) if (letters.includes(unit.entry.letter ?? "")) await completePhase(dir, unit)
}

// 阶段化流程 P3 端到端(phases=mv,m 阶段已完成): v(验收)阶段任务照常执行,
// 交接由蒸馏会话产出阶段目录内 handover.md(四小节协议),阶段 done.md 推进,
// 全部阶段完成退出 0。
test.skipIf(!E2E)(
  "端到端: v 阶段任务与蒸馏交接(phases=mv)",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-e2e-phase-"))
    try {
      // m 阶段已完成 → 当前阶段 P02-acceptance;其任务索引预列 v 阶段任务。
      await establishRound(dir, { phases: "mv" })
      await completeLetters(dir, ["m"])
      await listTasks(dir, "docs/R-01/P02-acceptance", "R-01.P02", [
        ["T-001", "验收通过性检查", '在当前目录创建 acceptance.md,内容为 "accepted"。'],
      ])
      await Bun.write(
        join(dir, "opencode.json"),
        await Bun.file(templateConfig).text(),
      )
      await Bun.write(
        join(dir, ".opencode/agent/auto.md"),
        renderText(await Bun.file(templateAgent).text(), {}),
      )

      expect(await runAll(dir, { phases: "mv" })).toBe(0)
      expect(await Bun.file(join(dir, "docs/R-01/P02-acceptance/tasks.md")).text()).toContain("- [x] T-001")
      expect(await Bun.file(join(dir, "docs/T-001/done.md")).exists()).toBe(true)
      // 蒸馏交接: handover.md 四小节齐备;阶段 done.md 推进。
      const handover = await Bun.file(join(dir, "docs/R-01/P02-acceptance/handover.md")).text()
      for (const section of ["## 关键决策", "## 约束与坑", "## 下一阶段必读清单", "## 产物索引"]) {
        expect(handover).toContain(section)
      }
      expect(await Bun.file(join(dir, "docs/R-01/P02-acceptance/done.md")).exists()).toBe(true)
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [x] P02 acceptance")
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
async function runCli(args: string[], env?: Record<string, string>) {
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "..", "src", "index.ts"), ...args], {
    cwd: join(import.meta.dir, ".."),
    env: env ? { ...process.env, ...env } : undefined,
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
        ["--wrapup"],
        ["--no-wrapup"],
      ]
      for (const extra of fixed) {
        const run = await runCli(["run", dir, ...extra])
        expect(run.code).toBe(1)
        expect(run.err).toContain("was frozen by init")
        expect(run.err).toContain(".opencode/auto/config.json")
        expect(run.err).toContain("opencode-auto init <dir>")
      }
      // 自动编号两键的修订指引为成对形式
      const numbering = await runCli(["run", dir, "--auto-number"])
      expect(numbering.err).toContain("--auto-number (use --no-auto-number to turn off)")
      // wrapup 两键的修订指引为成对形式
      const wrapup = await runCli(["run", dir, "--wrapup"])
      expect(wrapup.err).toContain("--wrapup (use --no-wrapup to turn off)")
      // 迁移源两键的修订指引为成对形式
      const source = await runCli(["run", dir, "--source-dir", "/tmp"])
      expect(source.err).toContain("--source-dir <dir> --source-path <relative-path>")
      // -m/--mode 报文同型(短选项形式给出修订指引)
      expect((await runCli(["run", dir, "-m", "migrate"])).err).toContain("-m/--mode was frozen by init")
      // --commit-subtask 移除报文保留
      const removed = await runCli(["run", dir, "--commit-subtask"])
      expect(removed.code).toBe(1)
      expect(removed.err).toContain("--commit-subtask removed")
      // 看门狗旧名给出更名指引
      const renamed = await runCli(["run", dir, "--verify-idle", "10"])
      expect(renamed.code).toBe(1)
      expect(renamed.err).toContain("was renamed to --idle-time")
      expect((await runCli(["init", dir, "--verify-max", "30"])).err).toContain("was renamed to --idle-max")
      // --handover-test 需搭配 --test-by-driver(init 侧宪法级校验,run 已整体拒绝)
      const lonely = await runCli(["init", dir, "--handover-test"])
      expect(lonely.code).toBe(1)
      expect(lonely.err).toContain("--handover-test requires --test-by-driver")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("run 合法选项组合照旧,不误报用法错误", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const combos = [
        ["--permission", "ask-allow", "--wait-answer", "5", "--wait-between", "2"],
        ["--dryrun"],
      ]
      for (const extra of combos) {
        const run = await runCli(["run", dir, ...extra])
        // 组合合法: 配置取缺省、解析全部通过后进入 runAll,因空目录缺少
        // agent 契约文件退出 1(driver 报文走 stdout,与用法错误的 stderr 区分)。
        expect(run.code).toBe(1)
        expect(run.out).toContain("agent contract file missing")
        expect(run.err).toBe("")
        expect(run.out).toContain("⚙ project config (.opencode/auto/config.json)")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("未知选项拦截: 拼错旗标退出 1 并给近似名提示;check/status 拒绝任何选项;写盘前拦截", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      // init 侧: 拼错的旗标不再被静默忽略
      const typo = await runCli(["init", dir, "--next"])
      expect(typo.code).toBe(1)
      expect(typo.err).toContain("unknown option --next")
      // 前缀近似名给出提示
      const similar = await runCli(["init", dir, "--idle"])
      expect(similar.err).toContain("unknown option --idle")
      expect(similar.err).toContain("--idle-time")
      expect(similar.err).toContain("--idle-max")
      // = 形式同样拦截;拦截发生在任何写盘之前(init 未固化配置)
      const eq = await runCli(["init", dir, "--nex=1"])
      expect(eq.code).toBe(1)
      expect(eq.err).toContain("unknown option --nex")
      expect(await readdir(dir)).toEqual([])
      // check/status 只接受目录参数,出现旗标即拒绝
      const checkFlag = await runCli(["check", dir, "--verbose"])
      expect(checkFlag.code).toBe(1)
      expect(checkFlag.err).toContain("unknown option --verbose")
      expect(checkFlag.err).toContain("only accept a directory argument")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("完成侧三机制退役: 五个旗标在 init/continue/run 一律用法错误(退出码 1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const retired = [["--verify"], ["--verify=false"], ["--review", "3"], ["--early"], ["--early-review", "2"], ["--final-review", "2"]]
      for (const command of ["init", "continue", "run"]) {
        for (const extra of retired) {
          const run = await runCli([command, dir, ...extra])
          expect(run.code).toBe(1)
          expect(run.err).toContain(`${extra[0]!.split("=")[0]} is retired`)
          expect(run.err).toContain("Result: FAIL")
        }
      }
      // 拦截发生在任何写盘之前
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("旧项目回落: 仅 .auto/config.json 有 mode 时 run 提示沿用旧位置", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await Bun.write(join(dir, ".auto/config.json"), JSON.stringify({ mode: "migrate" }))
      const run = await runCli(["run", dir])
      expect(run.out).toContain("mode taken from the legacy persisted value in .auto/config.json")
      expect(run.out).toContain("agent contract file missing")
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
      expect(init.err).toContain("--mode must be a registered mode")
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
      expect(init.out).toContain("⚙ project config (.opencode/auto/config.json)")
      expect(init.out).toContain("auto-number on")
      expect(init.out).toContain("list tasks in docs/R-01/P01-implement/tasks.md")
      expect(await readConfig(dir)).toEqual({
        mode: "migrate",
        agent: "auto",
        contextLimit: 64,
        subtask: "auto",
        idleTime: 10,
        idleMax: 0,
        commit: true,
        testByDriver: false,
        handoverTest: false,
        autoNumber: true,
        wrapup: true,
        phases: "m",
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  const DEFAULT_CONFIG = {
    mode: "migrate",
    agent: "auto",
    contextLimit: 64,
    subtask: "auto",
    idleTime: 10,
    idleMax: 0,
    commit: true,
    testByDriver: false,
    handoverTest: false,
    autoNumber: true,
    wrapup: true,
    phases: "m",
  }

  test("init --amend 仅改写显式给出的键,未给出的键保留既有配置", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["init", dir, "--amend", "--test-by-driver", "--context-limit", "128", "--subtask", "ondemand"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual({ ...DEFAULT_CONFIG, contextLimit: 128, testByDriver: true, subtask: "ondemand" })
      // 再 amend 一个无关键: 上一轮改过的三个键原样保留
      expect((await runCli(["init", dir, "--amend", "--agent", "custom"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual({ ...DEFAULT_CONFIG, contextLimit: 128, testByDriver: true, subtask: "ondemand", agent: "custom" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init 缺省全量覆盖: 未给出的键强制回落默认值,与干净环境无参 init 一致", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--test-by-driver", "--context-limit", "128", "--subtask", "ondemand", "--agent", "custom"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual({ ...DEFAULT_CONFIG, contextLimit: 128, testByDriver: true, subtask: "ondemand", agent: "custom" })
      // 无参 init: 上面改过的四个键全部回到默认值
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).toEqual(DEFAULT_CONFIG)
      // 与干净环境下直接无参 init 的产物严格一致
      const clean = await mkdtemp(join(tmpdir(), "auto-cli-"))
      try {
        expect((await runCli(["init", clean])).code).toBe(0)
        expect(await readConfig(dir)).toEqual(await readConfig(clean))
      } finally {
        await rm(clean, { recursive: true, force: true })
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("--commit false / none 已退役: init 与 continue 均用法错误退出 1,--commit true 照常", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const off = await runCli(["init", dir, "--commit", "false"])
      expect(off.code).toBe(1)
      expect(off.err).toContain("is retired")
      expect((await runCli(["init", dir, "--commit", "none"])).code).toBe(1)
      // 缺省/显式 true 照常固化(提交恒开)
      expect((await runCli(["init", dir, "--commit", "true"])).code).toBe(0)
      expect((await readConfig(dir)).commit).toBe(true)
      expect((await runCli(["continue", dir, "--commit", "false"])).code).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init 幂等: 相同参数连续多次执行产物恒定", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--test-by-driver", "--subtask", "ondemand"])).code).toBe(0)
      const first = await readConfig(dir)
      const agentFirst = await Bun.file(join(dir, ".opencode/agent/auto.md")).text()
      const agentsFirst = await Bun.file(join(dir, "AGENTS.md")).text()
      for (let i = 0; i < 2; i++) {
        expect((await runCli(["init", dir, "--test-by-driver", "--subtask", "ondemand"])).code).toBe(0)
      }
      expect(await readConfig(dir)).toEqual(first)
      expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).text()).toBe(agentFirst)
      expect(await Bun.file(join(dir, "AGENTS.md")).text()).toBe(agentsFirst)
      // 无参 init 连跑三次同样恒定
      expect((await runCli(["init", dir])).code).toBe(0)
      const bare = await readConfig(dir)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).toEqual(bare)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init 全量覆盖清除可选键 source/destDir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await mkdir(join(dir, "src-sys", "mod"), { recursive: true })
      expect((await runCli(["init", dir, "--source-dir", "src-sys", "--source-path", "mod", "--dest-dir", "out"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ source: { dir: "src-sys", path: "mod" }, destDir: "out" })
      // 无参 init: 两个可选键直接消失(CONFIG_DEFAULTS 不含它们)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).toEqual(DEFAULT_CONFIG)
      // --amend 则保留
      expect((await runCli(["init", dir, "--source-dir", "src-sys", "--source-path", "mod"])).code).toBe(0)
      expect((await runCli(["init", dir, "--amend", "--test-by-driver"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ source: { dir: "src-sys", path: "mod" }, testByDriver: true })
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
      expect(init.out).toContain("auto-number on")
      expect(init.out).toContain("has no planning session to consume the numbering record")
      // 阶段化流程(phases 含规划会话)不打该提示
      const staged = await runCli(["init", dir, "--phases", "am"])
      expect(staged.code).toBe(0)
      expect(staged.out).not.toContain("has no planning session to consume the numbering record")
      // --no-auto-number 覆盖回 false;--amend 不给该键时保留,无 --amend 则回落缺省 true
      expect((await runCli(["init", dir, "--no-auto-number"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ autoNumber: false })
      expect((await runCli(["init", dir, "--amend"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ autoNumber: false })
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ autoNumber: true })
      // =false 形式视同未给出(全量覆盖下即回落缺省 true)
      expect((await runCli(["init", dir, "--auto-number=false"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ autoNumber: true })
      // 两开关同现且均未带 =false → 用法错误(init/continue 共用分支,continue 同样拦截)
      const both = await runCli(["init", dir, "--auto-number", "--no-auto-number"])
      expect(both.code).toBe(1)
      expect(both.err).toContain("mutually exclusive pair")
      const contBoth = await runCli(["continue", dir, "--auto-number", "--no-auto-number"])
      expect(contBoth.code).toBe(1)
      expect(contBoth.err).toContain("mutually exclusive pair")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --wrapup/--no-wrapup 固化与 amend;两开关同现为用法错误", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      // 缺省(不给任一键)固化 true
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ wrapup: true })
      // --no-wrapup 固化为 false;摘要现"收尾 off"
      const off = await runCli(["init", dir, "--no-wrapup"])
      expect(off.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ wrapup: false })
      expect(off.out).toContain("wrapup off")
      // --amend 不给任一键时保留既有 false;无 --amend 的无参 init 则回落默认 true
      expect((await runCli(["init", dir, "--amend"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ wrapup: false })
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ wrapup: true })
      expect((await runCli(["init", dir, "--no-wrapup"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ wrapup: false })
      // --wrapup 覆盖回 true
      expect((await runCli(["init", dir, "--wrapup"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ wrapup: true })
      // =false 形式视同未给出(全量覆盖下即回落默认 true)
      expect((await runCli(["init", dir, "--no-wrapup=false"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ wrapup: true })
      // 两开关同现且均未带 =false → 用法错误(init/continue 共用分支,continue 同样拦截)
      const both = await runCli(["init", dir, "--wrapup", "--no-wrapup"])
      expect(both.code).toBe(1)
      expect(both.err).toContain("mutually exclusive pair")
      const contBoth = await runCli(["continue", dir, "--wrapup", "--no-wrapup"])
      expect(contBoth.code).toBe(1)
      expect(contBoth.err).toContain("mutually exclusive pair")
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

  test("init --test-by-driver/--handover-test 固化配置并刷新 AGENTS.md opencode-auto 块的测试段落", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--test-by-driver", "--handover-test"])
      expect(init.code).toBe(0)
      expect(init.out).toContain("appended: AGENTS.md opencode-auto block")
      expect(await readConfig(dir)).toMatchObject({ testByDriver: true, handoverTest: true })
      const agents = await Bun.file(join(dir, "AGENTS.md")).text()
      expect(agents).toContain("Test principle:")
      expect(agents).toContain("build, test, compile, and lint")
      // agent 契约同步带测试协议段(内联在工作契约第 2 条)
      const agent = await Bun.file(join(dir, ".opencode/agent/auto.md")).text()
      expect(agent).toContain("编译、测试、构建、lint 等可能耗时长")
      expect(agent).toContain("tmp/test.sh")
      // --amend 关闭 handover-test 保留 test-by-driver;再关闭 test-by-driver 时块内容
      // 与渲染不一致(测试段落应消失),整块刷新
      expect((await runCli(["init", dir, "--amend", "--handover-test", "false"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ testByDriver: true, handoverTest: false })
      const off = await runCli(["init", dir, "--amend", "--test-by-driver", "false"])
      expect(off.code).toBe(0)
      expect(off.out).toContain("refreshed: AGENTS.md opencode-auto block (differed from the current config render)")
      expect(await Bun.file(join(dir, "AGENTS.md")).text()).not.toContain("Test principle:")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("status 先打印配置摘要再列任务清单;配置非法不阻塞清单", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      await Bun.write(join(dir, "docs/R-01/P01-implement/tasks.md"), "# Tasks\n\n- [ ] T-001 示例任务\n")
      await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: 示例任务\nPhase: R-01.P01\n\n## Goal\n\n示例。\n")
      const status = await runCli(["status", dir])
      expect(status.code).toBe(0)
      expect(status.out).toContain("⚙ project config (.opencode/auto/config.json): mode migrate · agent auto")
      expect(status.out).toContain("phases m")
      expect(status.out).toContain("[▶] P01-implement")
      expect(status.out).toContain("[ ] T-001 示例任务")
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ subtask: "fast" }))
      const broken = await runCli(["status", dir])
      expect(broken.code).toBe(0)
      expect(broken.out).toContain("⚠ project config (.opencode/auto/config.json) is invalid")
      expect(broken.out).toContain("subtask")
      expect(broken.out).toContain("[ ] T-001 示例任务")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: phases / source / brief(阶段化流程 P1)", () => {
  async function readConfig(dir: string) {
    return JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())
  }

  test("init --phases 非法取值为用法错误,报文给出合法形式", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      for (const value of ["tma", "adk", "mm", "x", ""]) {
        const init = await runCli(["init", dir, "--phases", value])
        expect(init.code).toBe(1)
        expect(init.err).toContain("--phases is invalid")
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
      expect(init.out).toContain("phases admtvk")
      expect(init.out).toContain("to start analysis (分析) phase planning")
      expect(init.out).not.toContain("list tasks in")
      // --amend 无 --phases 保留既有值;显式给值可改
      expect((await runCli(["init", dir, "--amend"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "admtvk" })
      expect((await runCli(["init", dir, "--phases", "amt"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "amt" })
      // 无 --amend 的无参 init 全量覆盖: phases 回落缺省 "m"(台账为空,不受前缀护栏约束)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "m" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init 前缀护栏: 已有完成阶段时改 --phases 须以已完成阶段为前缀", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "admtvk"])).code).toBe(0)
      await completeLetters(dir, ["a", "d"])
      // "ad" 不是 "amt" 的前缀 → 拒绝并指引人工回退阶段索引
      const bad = await runCli(["init", dir, "--phases", "amt"])
      expect(bad.code).toBe(1)
      expect(bad.err).toContain("phase index")
      expect(bad.err).toContain("analysis,design")
      expect(bad.err).toContain("prefix")
      // 兼容值通过: 已完成的 P01/P02 与相同前缀保留,尾部待开始阶段按新值重写;
      // 下一阶段提示 m(迁移实现)
      const ok = await runCli(["init", dir, "--phases", "admtk"])
      expect(ok.code).toBe(0)
      expect(ok.out).toContain("to start implement (迁移实现) phase planning")
      expect((await runCli(["status", dir])).out).toContain("  [✓] P01-analysis\n  [✓] P02-design\n  [▶] P03-implement\n  [ ] P04-test\n  [ ] P05-knowledge\n")
      expect(await stat(join(dir, "docs/R-01/P05-acceptance")).catch(() => undefined)).toBeUndefined()
      // 护栏判的是本次生效值,不是"是否显式给出": 无参 init 全量覆盖会把 phases
      // 回落为缺省 "m",与台账已完成的 "ad" 不兼容 → 拦在任何写盘之前,并指引 --amend
      const bare = await runCli(["init", dir])
      expect(bare.code).toBe(1)
      expect(bare.err).toContain("--amend")
      expect(bare.err).toContain("analysis,design")
      expect(await readConfig(dir)).toMatchObject({ phases: "admtk" })
      // --amend 下生效值 = 既有配置值,天然满足前缀条件
      expect((await runCli(["init", dir, "--amend"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "admtk" })
      // 阶段索引非法时 init 报环境错误并给人工修订指引
      await Bun.write(join(dir, "docs/R-01/phases.md"), "- [ ] X1 analysis\n")
      const broken = await runCli(["init", dir, "--amend", "--phases", "admtvk"])
      expect(broken.code).toBe(1)
      expect(broken.err).toContain("docs/R-01/phases.md")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --phases type-id list: custom types from .opencode/auto/phases, repeats allowed, prefix guard by type", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      // Unknown custom id → usage error listing the known types
      const unknown = await runCli(["init", dir, "--phases", "analysis,security-review,implement"])
      expect(unknown.code).toBe(1)
      expect(unknown.err).toContain("security-review")
      await mkdir(join(dir, ".opencode/auto/phases"), { recursive: true })
      await Bun.write(
        join(dir, ".opencode/auto/phases/security-review.md"),
        "# Security review\n\nGate: verdict\nTask-artifacts: review.md\n\n## plan duties\n\nList the review tasks.\n",
      )
      const init = await runCli(["init", dir, "--phases", "analysis, security-review ,implement,security-review"])
      expect(init.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "analysis,security-review,implement,security-review" })
      expect(init.out).toContain("to start analysis (分析) phase planning")
      expect((await runCli(["status", dir])).out).toContain(
        "  [▶] P01-analysis\n  [ ] P02-security-review\n  [ ] P03-implement\n  [ ] P04-security-review\n",
      )
      // Completed analysis → a list not starting with analysis is refused
      await completeLetters(dir, ["a"])
      const bad = await runCli(["init", dir, "--phases", "security-review,implement"])
      expect(bad.code).toBe(1)
      expect(bad.err).toContain("prefix")
      // An invalid type file is a usage error naming the file
      await Bun.write(join(dir, ".opencode/auto/phases/broken.md"), "# Broken\n\nTasks: no\n\n## plan duties\n\nx\n")
      const broken = await runCli(["init", dir, "--amend"])
      expect(broken.code).toBe(1)
      expect(broken.err).toContain("broken.md")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --source-dir/--source-path 必须成对、须为工作目录下相对路径并校验存在性;--dest-dir 固化", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const onlyDir = await runCli(["init", dir, "--source-dir", "legacy"])
      expect(onlyDir.code).toBe(1)
      expect(onlyDir.err).toContain("must be given as a pair")
      const onlyPath = await runCli(["init", dir, "--source-path", "src/mod.ts"])
      expect(onlyPath.code).toBe(1)
      expect(onlyPath.err).toContain("must be given as a pair")
      // source-dir/dest-dir 均须为工作目录下的相对路径(绝对路径与 .. 逃逸拒绝)
      const absolute = await runCli(["init", dir, "--source-dir", dir, "--source-path", "src/mod.ts"])
      expect(absolute.code).toBe(1)
      expect(absolute.err).toContain("relative path under the working directory")
      const missing = await runCli(["init", dir, "--source-dir", "nope", "--source-path", "src/mod.ts"])
      expect(missing.code).toBe(1)
      expect(missing.err).toContain("must be an existing directory under the working directory")
      const escape = await runCli(["init", dir, "--source-dir", "legacy", "--source-path", "../mod.ts"])
      expect(escape.code).toBe(1)
      expect(escape.err).toContain("relative path")
      const destAbs = await runCli(["init", dir, "--dest-dir", join(dir, "target")])
      expect(destAbs.code).toBe(1)
      expect(destAbs.err).toContain("--dest-dir must be a relative path under the working directory")
      expect((await runCli(["init", dir, "--dest-dir", "../up"])).code).toBe(1)
      // 合法迁移参数: source 在 <dir>/<source-dir>/<source-path> 存在;dest-dir
      // 只固化路径、不校验存在性(目标目录常由迁移过程创建)
      const sourcePath = "src/mod.ts"
      await Bun.write(join(dir, "legacy", sourcePath), "export {}\n")
      const ok = await runCli(["init", dir, "--source-dir", "legacy", "--source-path", sourcePath, "--dest-dir", "target"])
      expect(ok.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ source: { dir: "legacy", path: sourcePath }, destDir: "target" })
      // --amend 不给迁移参数则保留既有值;--dest-dir 单独修订
      expect((await runCli(["init", dir, "--amend"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ source: { dir: "legacy", path: sourcePath }, destDir: "target" })
      expect((await runCli(["init", dir, "--amend", "--dest-dir", "app"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ source: { dir: "legacy", path: sourcePath }, destDir: "app" })
      // source-dir 接受软链接: 存在性校验经 stat 跟随解析,可把源系统大树留在
      // 工作目录外、以链接接入(断链仍按不存在拒绝)
      const outside = await mkdtemp(join(tmpdir(), "auto-cli-src-"))
      await Bun.write(join(outside, "pkg/legacy.ts"), "export {}\n")
      await symlink(outside, join(dir, "linked"))
      const linked = await runCli(["init", dir, "--amend", "--source-dir", "linked", "--source-path", "pkg/legacy.ts"])
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
      expect(first.out).toContain("written: .opencode/auto/brief.md")
      expect(first.out).toContain("brief recorded")
      expect(await Bun.file(brief).text()).toBe("把 legacy 迁移到 bun\n")
      // 无 -p 保留既有
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await Bun.file(brief).text()).toBe("把 legacy 迁移到 bun\n")
      // 重复 init -p 覆盖重写(amend 语义);空文本为用法错误
      expect((await runCli(["init", dir, "-p", "修订后的意图"])).code).toBe(0)
      expect(await Bun.file(brief).text()).toBe("修订后的意图\n")
      const empty = await runCli(["init", dir, "-p", "  "])
      expect(empty.code).toBe(1)
      expect(empty.err).toContain("-p/--prompt requires non-empty prompt text")
      // 阶段化流程下结束语引导开始首个阶段规划
      const staged = await runCli(["init", dir, "--phases", "am", "-p", "意图"])
      expect(staged.out).toContain("brief recorded")
      expect(staged.out).toContain("to start analysis (分析) phase planning")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("config.json verify 键退役: true 严格失败,false(存量 init 产物)接受并在下次 init 时消失", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      const file = join(dir, ".opencode/auto/config.json")
      const config = await readConfig(dir)
      await Bun.write(file, JSON.stringify({ ...config, verify: true }, null, 2) + "\n")
      const on = await runCli(["run", dir])
      expect(on.code).toBe(1)
      expect(on.err).toContain("verify is retired")
      await Bun.write(file, JSON.stringify({ ...config, verify: false }, null, 2) + "\n")
      expect((await runCli(["init", dir, "--amend"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual(config)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

})

// 快捷模式用例只覆盖起会话前的用法校验(二选一/非空/phases 兼容/文件存在性/
// 任务索引覆盖防护/子命令拦截),不触发真实计划生成会话——那需要 opencode 与
// provider 凭证,按仓库既有约定归入顶部的 OPENCODE_AUTO_E2E 门控端到端用例。
describe("CLI: init --implement-file/--implement-prompt(单阶段 m 快捷模式)", () => {
  test("二选一: 同时给出为用法错误;值须非空", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const both = await runCli(["init", dir, "--implement-file", "a.md", "--implement-prompt", "做点什么"])
      expect(both.code).toBe(1)
      expect(both.err).toContain("mutually exclusive: they are two input sources")
      const emptyFile = await runCli(["init", dir, "--implement-file", ""])
      expect(emptyFile.code).toBe(1)
      expect(emptyFile.err).toContain("--implement-file requires a non-empty file path")
      const emptyPrompt = await runCli(["init", dir, "--implement-prompt", "  "])
      expect(emptyPrompt.code).toBe(1)
      expect(emptyPrompt.err).toContain("--implement-prompt requires non-empty prompt text")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("仅用于单阶段(phases = m): 与非 m 的 --phases 组合(显式给出或既有配置)为用法错误", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const explicit = await runCli(["init", dir, "--phases", "am", "--implement-prompt", "做点什么"])
      expect(explicit.code).toBe(1)
      expect(explicit.err).toContain('only apply to the single-phase (phases = "m") shortcut mode')
      expect(explicit.err).toContain("the --phases given here")
      // --amend 沿用既有配置的阶段化 phases,不显式给 --phases 同样拦截
      expect((await runCli(["init", dir, "--phases", "am"])).code).toBe(0)
      const implicit = await runCli(["init", dir, "--amend", "--implement-prompt", "做点什么"])
      expect(implicit.code).toBe(1)
      expect(implicit.err).toContain("the existing config phases")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("--implement-file 指定的文件必须存在且为常规文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const missing = await runCli(["init", dir, "--implement-file", join(dir, "no-such-plan.md")])
      expect(missing.code).toBe(1)
      expect(missing.err).toContain("does not exist or is not a regular file")
      const isDir = await runCli(["init", dir, "--implement-file", dir])
      expect(isDir.code).toBe(1)
      expect(isDir.err).toContain("does not exist or is not a regular file")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // 隐式阶段 R-01/P01-implement 已列一个任务(索引行 + todo.md)。
  async function listTask(dir: string) {
    await Bun.write(join(dir, "docs/R-01/P01-implement/tasks.md"), "# Tasks\n\n- [ ] T-001 已有任务\n")
    await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: 已有任务\nPhase: R-01.P01\n\n## Goal\n\n做点什么。\n")
  }

  test("任务索引已列任务时拒绝快捷模式(防误覆盖已有计划)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      await listTask(dir)
      const blocked = await runCli(["init", dir, "--implement-prompt", "重新生成"])
      expect(blocked.code).toBe(1)
      expect(blocked.err).toContain("docs/R-01/P01-implement/tasks.md already lists tasks")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("continue 与 run 均不接受这两个选项", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const cont = await runCli(["continue", dir, "--implement-file", "a.md"])
      expect(cont.code).toBe(1)
      expect(cont.err).toContain("continue is for phased-flow round continuation and does not support")
      const run = await runCli(["run", dir, "--implement-prompt", "做点什么"])
      expect(run.code).toBe(1)
      expect(run.err).toContain("init-only shortcut-mode option")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // config 固化先于任务索引覆盖防护与计划生成会话,故经防护拦截路径即可验证
  // 缺省档(不触发真实 AI 会话)。
  test("快捷模式下 --subtask 缺省固化为 ondemand、wrapup 缺省固化为 false;显式给出时按给出值", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      await listTask(dir)
      const blocked = await runCli(["init", dir, "--implement-prompt", "重新生成"])
      expect(blocked.code).toBe(1)
      expect(blocked.err).toContain("docs/R-01/P01-implement/tasks.md already lists tasks")
      const config = JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())
      expect(config.subtask).toBe("ondemand")
      expect(config.wrapup).toBe(false)
      const explicit = await runCli(["init", dir, "--implement-prompt", "重新生成", "--subtask", "auto", "--wrapup"])
      expect(explicit.code).toBe(1)
      const explicitConfig = JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())
      expect(explicitConfig.subtask).toBe("auto")
      expect(explicitConfig.wrapup).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: 阶段化流程 P2(轮次目录 / 空模板 / 阶段行 / 台账预检)", () => {
  test("init --phases amt → 轮首建立 R-01(阶段索引 + 阶段目录,无 PLAN.md);status 打印阶段树", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--phases", "amt"])
      expect(init.code).toBe(0)
      expect(init.out).toContain("✓ round directory: docs/R-01/")
      // 任务单元布局(M3.4): 不再有根/轮内 PLAN.md
      expect(await Bun.file(join(dir, "PLAN.md")).exists()).toBe(false)
      expect(await Bun.file(join(dir, "docs/R-01/PLAN.md")).exists()).toBe(false)
      // 轮首 AGENTS.md 快照(避免被当指令加载,.bak 后缀)
      expect((await Bun.file(join(dir, "docs/R-01/AGENTS.md.bak")).text()).length).toBeGreaterThan(0)
      const status = await runCli(["status", dir])
      expect(status.code).toBe(0)
      expect(status.out).toContain("R-01 (0/3 phases done)\n  [▶] P01-analysis\n  [ ] P02-implement\n  [ ] P03-test\n")
      // 阶段索引与阶段目录随轮首建立
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [ ] P01 analysis\n- [ ] P02 implement\n- [ ] P03 test\n")
      expect(await Bun.file(join(dir, "docs/R-01/P02-implement/todo.md")).exists()).toBe(true)
      // 尚未规划,无任务行
      expect(status.out).not.toContain("T-0")
      // 阶段完成(done.md)后阶段树随之更新
      await completeLetters(dir, ["a"])
      expect((await runCli(["status", dir])).out).toContain("  [✓] P01-analysis\n  [▶] P02-implement\n  [ ] P03-test\n")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("phases = m 即隐式阶段 R-01/P01-implement;切换 --phases 重写未开工阶段,已列任务的阶段拒绝丢弃", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [ ] P01 implement\n")
      expect(await Bun.file(join(dir, "docs/R-01/P01-implement/todo.md")).exists()).toBe(true)
      // 未开工的隐式阶段随 --phases 切换重写
      expect((await runCli(["init", dir, "--phases", "am"])).code).toBe(0)
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [ ] P01 analysis\n- [ ] P02 implement\n")
      expect(await Bun.file(join(dir, "docs/R-01/P01-implement/todo.md")).exists()).toBe(false)
      // 已列任务的阶段目录不被静默删除
      await Bun.write(join(dir, "docs/R-01/P01-analysis/tasks.md"), "# Tasks\n\n- [ ] T-001 真实任务\n")
      const refused = await runCli(["init", dir, "--phases", "dmt"])
      expect(refused.code).toBe(1)
      expect(refused.err).toContain("already holds work (tasks.md)")
      expect(await Bun.file(join(dir, "docs/R-01/P01-analysis/tasks.md")).text()).toContain("真实任务")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("run 打印阶段进度行;阶段索引非法为环境错误退出 1(先于 server 启动)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "amt"])).code).toBe(0)
      const index = await Bun.file(join(dir, "docs/R-01/phases.md")).text()
      // 索引行非法 → 预检退出 1,报文给人工修订指引
      await Bun.write(join(dir, "docs/R-01/phases.md"), "- [ ] P01 nonsense\n")
      const broken = await runCli(["run", dir])
      expect(broken.code).toBe(1)
      expect(broken.out).toContain("phase flow blocked")
      expect(broken.out).toContain("docs/R-01/phases.md")
      // 阶段目录状态文件缺失(neither)→ 同为环境错误
      await Bun.write(join(dir, "docs/R-01/phases.md"), index)
      await rm(join(dir, "docs/R-01/P03-test/todo.md"))
      const missing = await runCli(["run", dir])
      expect(missing.code).toBe(1)
      expect(missing.out).toContain("P03-test/ has neither todo.md nor done.md")
      // 合法索引通过预检;阶段进度行在配置摘要后打印(删掉 agent 契约文件使 run
      // 在 server 启动前退出,仅断言横幅)
      await Bun.write(join(dir, "docs/R-01/P03-test/todo.md"), "# R-01.P03: 测试\n")
      await completeLetters(dir, ["a"])
      await rm(join(dir, ".opencode/agent/auto.md"))
      const banner = await runCli(["run", dir])
      expect(banner.out).toContain("phases: P01-analysis✓ P02-implement▶ P03-test")
      expect(banner.out).toContain("agent contract file missing")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("status 台账非法仅提示不阻塞;phases = m 不打印阶段进度行(阶段树照常)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "amt"])).code).toBe(0)
      await Bun.write(join(dir, "docs/R-01/phases.md"), "随便一行\n")
      const status = await runCli(["status", dir])
      expect(status.code).toBe(0)
      expect(status.out).toContain("⚠ phase index docs/R-01/phases.md is invalid")
      // phases = m 的项目不打印阶段行(缺省单次运行,无阶段语义)
      const plain = await mkdtemp(join(tmpdir(), "auto-cli-"))
      try {
        expect((await runCli(["init", plain])).code).toBe(0)
        const out = (await runCli(["status", plain])).out
        expect(out).not.toContain("phases: ")
        expect(out).toContain("[▶] P01-implement")
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

  test("--continue 不是选项: init/run 出现即指向 continue 子命令", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--continue"])
      expect(init.code).toBe(1)
      expect(init.err).toContain("dedicated subcommand opencode-auto continue")
      const run = await runCli(["run", dir, "--continue"])
      expect(run.code).toBe(1)
      expect(run.err).toContain("dedicated subcommand opencode-auto continue")
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
      expect(plain.err).toContain("continue only applies to phased-flow projects")
      // 阶段化但尚无完成阶段(上一轮尚未开始/未完成)
      expect((await runCli(["init", dir, "--phases", "am"])).code).toBe(0)
      const empty = await runCli(["continue", dir])
      expect(empty.code).toBe(1)
      expect(empty.err).toContain("still has pending phases P01-analysis, P02-implement")
      // 半程
      await completeLetters(dir, ["a"])
      const partial = await runCli(["continue", dir])
      expect(partial.code).toBe(1)
      expect(partial.err).toContain("still has pending phases P02-implement")
      // --phases m 显式给出
      const m = await runCli(["continue", dir, "--phases", "m"])
      expect(m.code).toBe(1)
      expect(m.err).toContain('cannot be "m"')
      // 阶段索引(人工编辑)含 phases 之外的已完成阶段 → 环境错误
      await completeLetters(dir, ["m"])
      const index = await Bun.file(join(dir, "docs/R-01/phases.md")).text()
      await Bun.write(join(dir, "docs/R-01/phases.md"), index + "- [x] P03 knowledge\n")
      await Bun.write(join(dir, "docs/R-01/P03-knowledge/done.md"), "# R-01.P03: 知识提炼\n")
      const outside = await runCli(["continue", dir])
      expect(outside.code).toBe(1)
      expect(outside.err).toContain("records completed phases outside phases (am): k")
      await Bun.write(join(dir, "docs/R-01/phases.md"), index)
      await rm(join(dir, "docs/R-01/P03-knowledge"), { recursive: true })
      // 迁移同一性选项跨轮固定: -m 与迁移三键显式给出即用法错误
      for (const extra of [["-m", "migrate"], ["--mode", "migrate"], ["--source-dir", "legacy", "--source-path", "x"], ["--dest-dir", "target"]]) {
        const locked = await runCli(["continue", dir, ...extra])
        expect(locked.code).toBe(1)
        expect(locked.err).toContain("fixed across rounds")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("上一轮全部完成 → 轮首建立 R-02 + 参数按轮修订 + 新一轮状态正确", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "am", "-p", "第一轮意图"])).code).toBe(0)
      await completeLetters(dir, ["a", "m"])
      // 轮后手工留下的任务留在上一轮的阶段任务索引与任务目录里,落盘即永久,
      // 不随续轮移动
      await Bun.write(join(dir, "docs/R-01/P02-implement/tasks.md"), "# Tasks\n\n- [ ] T-009 轮后手工任务\n")
      await Bun.write(join(dir, "docs/T-009/todo.md"), "# T-009: 轮后手工任务\nPhase: R-01.P02\n\n## Goal\n\n正文\n")
      // 新 phases "admtvk" 不以已完成的 "am" 为前缀——新一轮从头规划,不受前缀护栏约束
      const cont = await runCli(["continue", dir, "--phases", "admtvk", "-p", "第二轮聚焦补齐差距", "--context-limit", "128"])
      expect(cont.code).toBe(0)
      expect(cont.out).toContain("✓ round directory: docs/R-02/")
      expect(cont.out).toContain("round 2 of the migration started")
      expect(cont.out).toContain("to start analysis (分析) phase planning")
      expect(await readConfig(dir)).toMatchObject({ phases: "admtvk", contextLimit: 128 })
      // 上一轮轮次目录原样保留(绝不搬移/删除): 阶段索引、阶段目录与任务索引均在 R-01 内
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [x] P01 analysis")
      expect(await Bun.file(join(dir, "docs/R-01/P02-implement/done.md")).exists()).toBe(true)
      // 新一轮阶段索引按新 phases 建立
      expect(await Bun.file(join(dir, "docs/R-02/phases.md")).text()).toContain("- [ ] P06 knowledge")
      expect(await Bun.file(join(dir, "docs/R-01/P02-implement/tasks.md")).text()).toContain("T-009 轮后手工任务")
      expect(await Bun.file(join(dir, "docs/T-009/todo.md")).exists()).toBe(true)
      // 不做旧式归档: docs/phases/ 不创建
      expect(await stat(join(dir, "docs/phases")).catch(() => undefined)).toBeUndefined()
      // 新一轮尚未规划: 阶段目录无任务索引,不再有 PLAN.md
      expect(await Bun.file(join(dir, "docs/R-02/P01-analysis/tasks.md")).exists()).toBe(false)
      expect(await Bun.file(join(dir, "PLAN.md")).exists()).toBe(false)
      // 新轮 AGENTS.md 快照
      expect((await Bun.file(join(dir, "docs/R-02/AGENTS.md.bak")).text()).length).toBeGreaterThan(0)
      // -p 覆盖为新轮意图
      expect(await Bun.file(join(dir, ".opencode/auto/brief.md")).text()).toBe("第二轮聚焦补齐差距\n")
      // status: 阶段树展示当前轮
      const status = await runCli(["status", dir])
      expect(status.out).toContain("R-02 (0/6 phases done)\n  [▶] P01-analysis\n  [ ] P02-design\n")
      // 重复 continue: 新一轮阶段全未完成 → 拒绝并指引先跑 run
      const again = await runCli(["continue", dir])
      expect(again.code).toBe(1)
      expect(again.err).toContain("still has pending phases P01-analysis, P02-design")
      expect(again.err).toContain(`opencode-auto run ${dir}`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("continue 不带 --phases 保留既有阶段;run 横幅带轮次标注", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "am"])).code).toBe(0)
      await completeLetters(dir, ["a", "m"])
      const cont = await runCli(["continue", dir])
      expect(cont.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "am" })
      expect(cont.out).toContain("to start analysis (分析) phase planning")
      // run 启动横幅的阶段进度行带轮次标注(删除 agent 契约文件使 run 在 server 前退出)
      await rm(join(dir, ".opencode/agent/auto.md"))
      const banner = await runCli(["run", dir])
      expect(banner.out).toContain("phases (round 2): P01-analysis▶ P02-implement")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// check 子命令的引用检查(stable-refs P4,D6 第二层): 原则检查之外全量扫描活文档
// 失效引用,命中退出码 1;干净项目退出 0。无需 opencode/provider,始终运行。
// 受 OPENCODE_AUTO_REF_CHECK 管控(refcheck-scope-design D3,缺省 off 空转):
// 挂点行为用例注入 on 运行(核心内解析环境变量,CLI 壳零改动)。
const REFCHECK_ON = { OPENCODE_AUTO_REF_CHECK: "on" }
describe("CLI: check 引用检查(stable-refs P4)", () => {
  test("活文档失效引用命中退出 1 并逐条报文;豁免行不报告", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      await Bun.write(join(dir, "docs/T-001/todo.md"), ["# T-001: 任务", "实现功能。", ""].join("\n"))
      await Bun.write(
        join(dir, "docs/T-001/report.md"),
        ["正常引用 `docs/T-001/todo.md`。", "失效引用 `src/gone.ts`。", "已删除 的 `docs/old.md` 豁免。"].join("\n"),
      )
      const check = await runCli(["check", dir], REFCHECK_ON)
      expect(check.code).toBe(1)
      expect(check.out).toContain("+ doc references")
      expect(check.out).toContain("⚠ stale reference docs/T-001/report.md:2 → src/gone.ts (path not found)")
      expect(check.out).toContain("1 stale reference(s) (update to current paths, or exempt with the inline markers")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("引用全部有效退出 0;init 产出含引用规范段落", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir])
      expect(init.out).toContain("appended: AGENTS.md opencode-auto block")
      await Bun.write(join(dir, "docs/T-001/todo.md"), ["# T-001: 任务", "实现功能。", ""].join("\n"))
      await Bun.write(join(dir, "src/mod.ts"), "l1\n")
      await Bun.write(join(dir, "docs/T-001/report.md"), "引用 `src/mod.ts:1` 与 [任务](docs/T-001/todo.md)。\n")
      const check = await runCli(["check", dir], REFCHECK_ON)
      expect(check.code).toBe(0)
      expect(check.out).toContain("✓ no statements violating the commit principles; all doc reference checks passed")
      expect(await Bun.file(join(dir, "AGENTS.md")).text()).toContain("Reference and storage conventions")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("缺省 off: 引用检查空转——失效引用不命中(退出 0),目标目录零改动", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      await Bun.write(join(dir, "docs/T-001/report.md"), "失效引用 `src/gone.ts`。\n")
      const before = await Bun.file(join(dir, "docs/T-001/report.md")).text()
      const check = await runCli(["check", dir])
      expect(check.code).toBe(0)
      expect(check.out).not.toContain("失效引用")
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe(before)
      expect(await Bun.file(join(dir, ".auto/invalid-refs.md")).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: reset 反初始化", () => {
  test("reset 移除配置层产物,docs/ 任务单元 / .auto/ 运行时状态不受影响", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      await mkdir(join(dir, ".auto", "logs"), { recursive: true })
      await writeFile(join(dir, ".auto", "logs", "run.log"), "日志\n")
      await mkdir(join(dir, "docs", "T-001"), { recursive: true })
      await writeFile(join(dir, "docs/T-001/todo.md"), "# T-001: 我的任务\n")

      const reset = await runCli(["reset", dir])
      expect(reset.code).toBe(0)
      expect(reset.out).toContain("the following cleanup will run in")
      expect(reset.out).toContain(".opencode/auto/config.json")
      expect(reset.out).toContain("restored to the uninitialized state")

      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).exists()).toBe(false)
      expect(await Bun.file(join(dir, "opencode.json")).exists()).toBe(false)
      expect(await Bun.file(join(dir, "AGENTS.md")).exists()).toBe(false)
      expect(await readdir(dir)).not.toContain(".opencode")
      // 工作成果与运行时状态原样保留
      expect(await Bun.file(join(dir, "docs/T-001/todo.md")).text()).toBe("# T-001: 我的任务\n")
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).exists()).toBe(true)
      expect(await Bun.file(join(dir, ".auto/logs/run.log")).text()).toBe("日志\n")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init → reset → init: 两次 init 产物逐字节一致", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      const config = await Bun.file(join(dir, ".opencode/auto/config.json")).text()
      const agent = await Bun.file(join(dir, ".opencode/agent/auto.md")).text()
      const agents = await Bun.file(join(dir, "AGENTS.md")).text()
      expect((await runCli(["reset", dir])).code).toBe(0)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).text()).toBe(config)
      expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).text()).toBe(agent)
      expect(await Bun.file(join(dir, "AGENTS.md")).text()).toBe(agents)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("reset 保留被改过的 opencode.json 并说明原因", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      await writeFile(join(dir, "opencode.json"), '{"model":"我自己的配置"}\n')
      const reset = await runCli(["reset", dir])
      expect(reset.code).toBe(0)
      expect(reset.out).toContain("keep: opencode.json")
      expect(await Bun.file(join(dir, "opencode.json")).text()).toBe('{"model":"我自己的配置"}\n')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("未初始化目录: reset 报无需清理并退出 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const reset = await runCli(["reset", dir])
      expect(reset.code).toBe(0)
      expect(reset.out).toContain("no init artifacts found")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("reset only accepts a directory argument and -f/--force", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const bad = await runCli(["reset", dir, "--test-by-driver"])
      expect(bad.code).toBe(1)
      expect(bad.err).toContain("reset only accepts a directory argument and -f/--force")
      expect((await runCli(["reset", dir, "--force"])).code).toBe(0)
      expect((await runCli(["reset", dir, "-f"])).code).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: 工作区干净度闸门", () => {
  async function readConfigAt(dir: string) {
    return JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())
  }
  async function git(dir: string, ...args: string[]) {
    const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "ignore", stderr: "ignore" })
    expect(await proc.exited).toBe(0)
  }
  async function commitAll(dir: string) {
    await git(dir, "add", "-A")
    await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "wip")
  }

  test("非 git 目录不受闸门影响(与 ensureGitignore 同款口径)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["reset", dir])).code).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("脏工作区拦截覆盖型 init,列出未提交文件;-f 跳过", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await git(dir, "init")
      // 首次 init(无既有配置)不受闸门约束,即使工作区因此变脏
      expect((await runCli(["init", dir])).code).toBe(0)
      const dirty = await runCli(["init", dir])
      expect(dirty.code).toBe(1)
      expect(dirty.err).toContain("requires a clean worktree")
      expect(dirty.err).toContain("opencode.json")
      expect(dirty.err).toContain("-f/--force")
      // 拦截发生在任何写盘之前
      expect(await readConfigAt(dir)).toMatchObject({ agent: "auto" })
      // -f 跳过
      expect((await runCli(["init", dir, "-f", "--agent", "custom"])).code).toBe(0)
      expect(await readConfigAt(dir)).toMatchObject({ agent: "custom" })
      // 提交后不再拦截
      await commitAll(dir)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfigAt(dir)).toMatchObject({ agent: "auto" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("--amend 不是全量覆盖,不受闸门约束", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await git(dir, "init")
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["init", dir, "--amend", "--test-by-driver"])).code).toBe(0)
      expect(await readConfigAt(dir)).toMatchObject({ testByDriver: true })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("脏工作区拦截 reset,清单中的文件完好;-f 跳过", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await git(dir, "init")
      expect((await runCli(["init", dir])).code).toBe(0)
      await commitAll(dir)
      await writeFile(join(dir, "untracked.ts"), "export {}\n")
      const dirty = await runCli(["reset", dir])
      expect(dirty.code).toBe(1)
      expect(dirty.err).toContain("requires a clean worktree")
      expect(dirty.err).toContain("untracked.ts")
      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).exists()).toBe(true)
      expect((await runCli(["reset", dir, "-f"])).code).toBe(0)
      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("嵌套仓库/子模块的未提交改动同样拦截", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await git(dir, "init")
      expect((await runCli(["init", dir])).code).toBe(0)
      await commitAll(dir)
      await mkdir(join(dir, "vendor", "lib"), { recursive: true })
      await git(join(dir, "vendor", "lib"), "init")
      await writeFile(join(dir, "vendor", "lib", "index.ts"), "export {}\n")
      await commitAll(join(dir, "vendor", "lib"))
      await writeFile(join(dir, "vendor", "lib", "index.ts"), "export const x = 1\n")
      const dirty = await runCli(["reset", dir])
      expect(dirty.code).toBe(1)
      expect(dirty.err).toContain("vendor/lib/index.ts")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("run 拒绝 --amend 与 -f/--force", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const amend = await runCli(["run", dir, "--amend"])
      expect(amend.code).toBe(1)
      expect(amend.err).toContain("--amend is an init-only option")
      const force = await runCli(["run", dir, "-f"])
      expect(force.code).toBe(1)
      expect(force.err).toContain("is an init/reset-only option")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

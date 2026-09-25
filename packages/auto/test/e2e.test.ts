import { describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"
import { loadPlan, taskStatePaths } from "@opencode-ai/auto-core/tasks"
import { RUN_LOCK_FILE } from "@opencode-ai/auto-core/lock"
import { renderProjectBrief } from "@opencode-ai/auto-core/brief"
import { CONFIG_DEFAULTS } from "@opencode-ai/auto-core/config"
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

// Fill in the round brief's `## Close` restatement listing, which the
// round-close gate requires before the next round opens (plans/0049 G8;
// plan's prelude enforces it).
async function fillClose(dir: string, round = "R-01") {
  await Bun.write(join(dir, `docs/${round}/round.md`), `# Round ${round}\n\n## Close\n\n- Restated: none needed.\n- Accepted as lost: none.\n`)
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
      for (const section of ["## Key decisions", "## Constraints and pitfalls", "## Required reading for the next phase", "## Artifact index"]) {
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

// 自定义阶段类型端到端(M3.8): 项目自定义类型经完整 plan→execute→handover 跑通,
// 证明阶段注册表化不只服务内置 admtvk——.opencode/auto/phases/<type>.md 声明的
// 规划职责驱动阶段规划会话,任务照常执行,交接蒸馏同样产出四小节协议文档。
test.skipIf(!E2E)(
  "端到端: 自定义阶段类型的完整流水线(plan→execute→handover)",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-e2e-custom-phase-"))
    try {
      await mkdir(join(dir, ".opencode/auto/phases"), { recursive: true })
      await Bun.write(
        join(dir, ".opencode/auto/phases/security-review.md"),
        "# Security review\n\n## plan duties\n\nPlan exactly one task: create a file security-review.md in the current\n" +
          'directory containing the word "reviewed".\n',
      )
      await establishRound(dir, { phases: "security-review,implement" })
      await Bun.write(
        join(dir, "opencode.json"),
        await Bun.file(templateConfig).text(),
      )
      await Bun.write(
        join(dir, ".opencode/agent/auto.md"),
        renderText(await Bun.file(templateAgent).text(), {}),
      )

      // P01-security-review has no pre-listed tasks.md: the phase-planning
      // session must write both the task index and the task document itself.
      expect(await runAll(dir, { phases: "security-review,implement" })).toBe(0)
      expect(await Bun.file(join(dir, "docs/R-01/P01-security-review/tasks.md")).exists()).toBe(true)
      expect((await Bun.file(join(dir, "security-review.md")).text())).toContain("reviewed")
      const handover = await Bun.file(join(dir, "docs/R-01/P01-security-review/handover.md")).text()
      for (const section of ["## Key decisions", "## Constraints and pitfalls", "## Required reading for the next phase", "## Artifact index"]) {
        expect(handover).toContain(section)
      }
      expect(await Bun.file(join(dir, "docs/R-01/P01-security-review/done.md")).exists()).toBe(true)
      // The second phase (builtin implement, still task-less at round start)
      // gets planned and executed the same way, proving the custom and
      // builtin types share one pipeline.
      expect(await Bun.file(join(dir, "docs/R-01/P02-implement/done.md")).exists()).toBe(true)
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [x] P02 implement")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  { timeout: 600_000 },
)

// 新布局三阶段端到端(M3.8): phases=adm 走满 P01-analysis/P02-design/P03-implement
// 一整轮,证明单元布局(D14/0047)全链路成立——阶段轮内局部编号目录、tasks.md +
// 任务永久平铺于 docs/T-NNN/todo.md(不嵌入阶段目录)、todo.md→done.md 改名随
// driver 收口提交(工作区跑完后干净,不留手工提交动作)、轮次完成不设独立标记,
// 由三个阶段目录各自的 done.md 存在性推出。
test.skipIf(!E2E)(
  "端到端: 新布局三阶段(phases=adm)——P01-P03、tasks.md/T-*/todo.md、改名随提交、由 done.md 推导轮次完成",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-e2e-adm-"))
    try {
      const git = async (...args: string[]) => {
        const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "ignore", stderr: "ignore" })
        expect(await proc.exited).toBe(0)
      }
      await git("init")

      await establishRound(dir, { phases: "adm" })
      await listTasks(dir, "docs/R-01/P01-analysis", "R-01.P01", [
        ["T-001", "勘察产出", '在当前目录创建 analysis.md,内容为 "surveyed"。'],
      ])
      await listTasks(dir, "docs/R-01/P02-design", "R-01.P02", [
        ["T-002", "设计产出", '在当前目录创建 design.md,内容为 "designed"。'],
      ])
      await listTasks(dir, "docs/R-01/P03-implement", "R-01.P03", [
        ["T-003", "实现产出", '在当前目录创建 implement.md,内容为 "implemented"。'],
      ])
      await Bun.write(join(dir, "opencode.json"), await Bun.file(templateConfig).text())
      await Bun.write(join(dir, ".opencode/agent/auto.md"), renderText(await Bun.file(templateAgent).text(), {}))
      // 建轮脚手架一次性提交为基线,使首个执行单元启动时工作区 clean
      // (0021 P3 启动门禁,非 git 目录的既有用例不受此约束,这里特意起了 git 仓库来验)。
      await git("add", "-A")
      await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "round baseline")

      expect(await runAll(dir, { phases: "adm" })).toBe(0)

      // 阶段轮内局部编号目录 + 该阶段自己的 tasks.md;任务内容永久平铺于
      // docs/T-NNN/,不嵌进阶段目录。
      expect(await Bun.file(join(dir, "docs/R-01/P01-analysis/tasks.md")).text()).toContain("- [x] T-001")
      expect(await Bun.file(join(dir, "docs/R-01/P02-design/tasks.md")).text()).toContain("- [x] T-002")
      expect(await Bun.file(join(dir, "docs/R-01/P03-implement/tasks.md")).text()).toContain("- [x] T-003")
      for (const id of ["T-001", "T-002", "T-003"]) {
        expect(await Bun.file(join(dir, "docs", id, "done.md")).exists()).toBe(true)
        expect(await Bun.file(join(dir, "docs", id, "todo.md")).exists()).toBe(false)
      }
      expect(await Bun.file(join(dir, "analysis.md")).text()).toContain("surveyed")
      expect(await Bun.file(join(dir, "design.md")).text()).toContain("designed")
      expect(await Bun.file(join(dir, "implement.md")).text()).toContain("implemented")

      // 改名随提交: 全程跑完后工作区干净,todo→done 的改名没有留手工提交步骤。
      const status = Bun.spawn(["git", "-C", dir, "status", "--porcelain"], { stdout: "pipe" })
      expect((await new Response(status.stdout).text()).trim()).toBe("")
      expect(await status.exited).toBe(0)

      // 轮次完成不设独立标记,由三个阶段目录各自的 done.md 推导。
      for (const phaseDir of ["P01-analysis", "P02-design", "P03-implement"]) {
        expect(await Bun.file(join(dir, "docs/R-01", phaseDir, "done.md")).exists()).toBe(true)
        expect(await Bun.file(join(dir, "docs/R-01", phaseDir, "todo.md")).exists()).toBe(false)
      }
      const phasesIndex = await Bun.file(join(dir, "docs/R-01/phases.md")).text()
      expect(phasesIndex).toContain("- [x] P01 analysis")
      expect(phasesIndex).toContain("- [x] P02 design")
      expect(phasesIndex).toContain("- [x] P03 implement")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  { timeout: 900_000 },
)

// CLI 解析用例不需要 opencode 与 provider 凭证,始终运行: 以子进程运行源码入口,
// 用法错误经 stderr 报文与退出码 1 断言;合法组合以空目录"未找到计划文件"退出
// (解析全部通过、在 spawn server 之前),证明未误报组合用法错误。
// The subprocess never inherits the ambient OPENCODE_AUTO_* layer (this test
// process's own driver environment — a hibernate window would make every run
// sleep, a model policy would reroute): the base is a scrubbed copy, and a
// case that wants a switch passes it in `env`, merged on top.
const CLI_ENV_BASE = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^OPENCODE_AUTO_/.test(key)))

async function runCli(args: string[], env?: Record<string, string>) {
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "..", "src", "index.ts"), ...args], {
    cwd: join(import.meta.dir, ".."),
    env: env ? { ...CLI_ENV_BASE, ...env } : CLI_ENV_BASE,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code: await proc.exited, out, err }
}

// A git helper over a fixture dir: asserts exit 0 and returns stdout. The
// close / --force-close / new-project-flow fixtures all commit through it.
const gitOf = (dir: string) => {
  return async (...args: string[]) => {
    const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    expect(code, `git ${args.join(" ")}: ${err}`).toBe(0)
    return out
  }
}

// The fake agent's environment (the B6/C5 convention): a PATH with the fake
// `claude` first, plus the adapter selection. runCli's scrubbed base keeps the
// ambient OPENCODE_AUTO_* switches out, so the subprocess's experiment
// switches are deterministic.
async function fakeClaude() {
  const binDir = await mkdtemp(join(tmpdir(), "auto-cli-agent-"))
  await Bun.write(
    join(binDir, "claude"),
    `#!/bin/sh\nexec bun ${JSON.stringify(join(import.meta.dir, "fixtures", "fake-claude.ts"))} "$@"\n`,
  )
  await chmod(join(binDir, "claude"), 0o755)
  const env: Record<string, string> = { PATH: `${binDir}:${process.env.PATH ?? ""}`, OPENCODE_AUTO_AGENT: "claude" }
  const run = (args: string[]) => runCli(args, env)
  return { run, done: () => rm(binDir, { recursive: true, force: true }) }
}

describe("CLI 解析: run 侧选项与配置", () => {
  test("run 拒绝已固化选项(退出码 1 + 修订指引)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const fixed = [
        ["-m", "migrate"],
        ["--mode", "migrate"],
        ["--agent", "claude"],
        ["--context-limit", "64"],
        ["--subtask", "auto"],
        ["--idle-time", "10"],
        ["--idle-max", "0"],
        ["--commit", "true"],
        ["--phases", "admtvk"],
        ["--test-by-driver"],
        ["--handover-test"],
        ["--auto-number"],
        ["--no-auto-number"],
        ["--wrapup"],
        ["--no-wrapup"],
        ["--parallel", "low"],
      ]
      for (const extra of fixed) {
        const run = await runCli(["run", dir, ...extra])
        expect(run.code).toBe(1)
        expect(run.err).toContain("was frozen by init")
        expect(run.err).toContain(".opencode/auto/config.json")
        expect(run.err).toContain("opencode-auto amend <dir>")
      }
      // 自动编号两键的修订指引为成对形式
      const numbering = await runCli(["run", dir, "--auto-number"])
      expect(numbering.err).toContain("--auto-number (use --no-auto-number to turn off)")
      // wrapup 两键的修订指引为成对形式
      const wrapup = await runCli(["run", dir, "--wrapup"])
      expect(wrapup.err).toContain("--wrapup (use --no-wrapup to turn off)")
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

  test("完成侧三机制退役: 五个旗标在 init/run 一律用法错误(退出码 1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const retired = [["--verify"], ["--verify=false"], ["--review", "3"], ["--early"], ["--early-review", "2"], ["--final-review", "2"]]
      for (const command of ["init", "run"]) {
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

  test("migration parameters retired (plans/0052 D1): --source-dir/--source-path/--dest-dir are usage errors on init/run, pointing to brief.md", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const retired = [["--source-dir", "legacy"], ["--source-path", "src/mod.ts"], ["--dest-dir=target"], ["--source-dir", "legacy", "--source-path", "pkg"]]
      for (const command of ["init", "run"]) {
        for (const extra of retired) {
          const run = await runCli([command, dir, ...extra])
          expect(run.code).toBe(1)
          expect(run.err).toContain(`${extra[0]!.split("=")[0]} is retired`)
          expect(run.err).toContain("state them in .opencode/auto/brief.md")
        }
      }
      // 拦截发生在任何写盘之前
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("旧布局退役(M3.7): 根 PLAN.md 或无阶段目录的 docs/R-NN → init/status/run 用法错误退出 1,不写盘;check 照常", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await Bun.write(join(dir, "PLAN.md"), "# plan\n")
      await Bun.write(join(dir, "docs/R-01/phases.md"), "# phases\n")
      for (const command of ["init", "status", "run"]) {
        const run = await runCli([command, dir])
        expect(run.code, command).toBe(1)
        expect(run.err).toContain("legacy layout: start a new project")
        expect(run.err).toContain("root PLAN.md, docs/R-01/ without phase directories")
      }
      expect((await readdir(dir)).sort()).toEqual(["PLAN.md", "docs"])
      expect(await readdir(join(dir, "docs"))).toEqual(["R-01"])
      expect((await runCli(["check", dir])).err).not.toContain("legacy layout")
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

  test("init 写出完整 config(全键缺省)并打印摘要;只写配置层,结束语指向 plan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir])
      expect(init.code).toBe(0)
      expect(init.out).toContain("⚙ project config (.opencode/auto/config.json)")
      expect(init.out).toContain("auto-number on")
      // config-only init (auto-core plans/0053 D31): plan owns the rounds, so
      // init writes nothing under docs/ and points at plan's establish route.
      expect(init.out).toContain(`next: opencode-auto plan ${dir} (establishes round R-01 and stops at the round-start gate)`)
      expect(init.out).not.toContain("list tasks in")
      expect(await stat(join(dir, "docs")).catch(() => undefined)).toBeUndefined()
      // the brief stub is still init's (written when missing)
      expect(await Bun.file(join(dir, ".opencode/auto/brief.md")).exists()).toBe(true)
      expect(await readConfig(dir)).toEqual({
        mode: "migrate",
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

  test("amend 仅改写显式给出的键,未给出的键保留既有配置(init --amend 已退役)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["amend", dir, "--test-by-driver", "--context-limit", "128", "--subtask", "ondemand"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual({ ...DEFAULT_CONFIG, contextLimit: 128, testByDriver: true, subtask: "ondemand" })
      // 再 amend 一个无关键: 上一轮改过的三个键原样保留
      expect((await runCli(["amend", dir, "--agent", "claude"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual({ ...DEFAULT_CONFIG, contextLimit: 128, testByDriver: true, subtask: "ondemand", agent: "claude" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init 缺省全量覆盖: 未给出的键强制回落默认值,与干净环境无参 init 一致", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--test-by-driver", "--context-limit", "128", "--subtask", "ondemand", "--agent", "claude"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual({ ...DEFAULT_CONFIG, contextLimit: 128, testByDriver: true, subtask: "ondemand", agent: "claude" })
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

  test("--commit false / none 已退役: init 用法错误退出 1,--commit true 照常", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const off = await runCli(["init", dir, "--commit", "false"])
      expect(off.code).toBe(1)
      expect(off.err).toContain("is retired")
      expect((await runCli(["init", dir, "--commit", "none"])).code).toBe(1)
      // 缺省/显式 true 照常固化(提交恒开)
      expect((await runCli(["init", dir, "--commit", "true"])).code).toBe(0)
      expect((await readConfig(dir)).commit).toBe(true)
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

  test("stored retired keys (plans/0052 D3/D4): run and --amend fail strictly; a full-overwrite init drops them and names each with its value", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--context-limit", "128"])).code).toBe(0)
      const file = join(dir, ".opencode/auto/config.json")
      const stored = { ...(await readConfig(dir)), source: { dir: "legacy", path: "pkg" }, destDir: "app", commit: false }
      await Bun.write(file, JSON.stringify(stored, null, 2) + "\n")
      const run = await runCli(["run", dir])
      expect(run.code).toBe(1)
      expect(run.err).toContain("commit: false is retired")
      // a key rule repairs it, so the strict failure names fix (plans/0052 D11)
      expect(run.err).toContain(`fix: opencode-auto fix ${dir}`)
      delete (stored as { commit?: boolean }).commit
      await Bun.write(file, JSON.stringify(stored, null, 2) + "\n")
      const status = await runCli(["status", dir])
      expect(status.out).toContain('source is retired (the migration source and target are intent, not configuration): copy its value {"dir":"legacy","path":"pkg"} into .opencode/auto/brief.md, then remove the key')
      expect(status.out).toContain(`  fix: opencode-auto fix ${dir}`)
      // an amend would carry the keys over, so it stays strict
      const amend = await runCli(["amend", dir, "--test-by-driver"])
      expect(amend.code).toBe(1)
      expect(amend.err).toContain("source is retired")
      expect(amend.err).toContain(`fix: opencode-auto fix ${dir}`)
      expect(await readConfig(dir)).toEqual(stored)
      // the full overwrite discards them anyway: it succeeds (no longer blocked by a
      // stored retired key, DF2) and names each discarded key with its value
      await Bun.write(file, JSON.stringify({ ...stored, commit: false }, null, 2) + "\n")
      const init = await runCli(["init", dir])
      expect(init.code).toBe(0)
      expect(init.out).toContain("full overwrite drops the retired key commit = false")
      expect(init.out).toContain('full overwrite drops the retired key source = {"dir":"legacy","path":"pkg"}: the migration source and target are intent — state them in .opencode/auto/brief.md')
      expect(init.out).toContain('full overwrite drops the retired key destDir = "app"')
      expect(await readConfig(dir)).toEqual(DEFAULT_CONFIG)
      expect((await runCli(["init", dir])).out).not.toContain("retired key")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --auto-number/--no-auto-number 固化与 amend;两开关同现为用法错误", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      // 启用: 固化 true,摘要含自动编号段。m-mode planning consumes the numbering
      // record too (auto-core plans/0053 D12), so phases = m gets no "no effect" note.
      const init = await runCli(["init", dir, "--auto-number"])
      expect(init.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ autoNumber: true })
      expect(init.out).toContain("auto-number on")
      expect(init.out).not.toContain("numbering record")
      expect((await runCli(["init", dir, "--phases", "am"])).code).toBe(0)
      // --no-auto-number 覆盖回 false;amend 不给该键时保留,无 amend 则回落缺省 true
      expect((await runCli(["init", dir, "--no-auto-number"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ autoNumber: false })
      expect((await runCli(["amend", dir, "--commit", "true"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ autoNumber: false })
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ autoNumber: true })
      // =false 形式视同未给出(全量覆盖下即回落缺省 true)
      expect((await runCli(["init", dir, "--auto-number=false"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ autoNumber: true })
      // 两开关同现且均未带 =false → 用法错误
      const both = await runCli(["init", dir, "--auto-number", "--no-auto-number"])
      expect(both.code).toBe(1)
      expect(both.err).toContain("mutually exclusive pair")
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
      // amend 不给任一键时保留既有 false;无 amend 的无参 init 则回落默认 true
      expect((await runCli(["amend", dir, "--commit", "true"])).code).toBe(0)
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
      // 两开关同现且均未带 =false → 用法错误
      const both = await runCli(["init", dir, "--wrapup", "--no-wrapup"])
      expect(both.code).toBe(1)
      expect(both.err).toContain("mutually exclusive pair")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --agent freezes the coding agent; opencode drops the key; a contract name is refused (M6.1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const plain = await runCli(["init", dir])
      expect(plain.code).toBe(0)
      expect(await readConfig(dir)).not.toHaveProperty("agent")
      expect(plain.out).toContain("· agent opencode ·")
      const claude = await runCli(["init", dir, "--agent", "claude"])
      expect(claude.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ agent: "claude" })
      expect(claude.out).toContain("· agent claude ·")
      // amend keeps it; amend --agent opencode removes it
      expect((await runCli(["amend", dir, "--commit", "true"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ agent: "claude" })
      expect((await runCli(["amend", dir, "--agent", "opencode"])).code).toBe(0)
      expect(await readConfig(dir)).not.toHaveProperty("agent")
      // the retired contract-name use of --agent is a usage error
      const named = await runCli(["init", dir, "--agent", "auto"])
      expect(named.code).toBe(1)
      expect(named.err).toContain("--agent takes opencode|claude")
      // a pre-M6.1 config holding a contract name fails loading with a hint
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ agent: "auto" }))
      const run = await runCli(["run", dir])
      expect(run.code).toBe(1)
      expect(`${run.out}${run.err}`).toContain("looks like an agent contract name")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --parallel freezes the planning level; none drops the key; run --max-sessions is reserved (MP.1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      // default: no key written, no summary mention
      const plain = await runCli(["init", dir])
      expect(plain.code).toBe(0)
      expect(await readConfig(dir)).not.toHaveProperty("parallel")
      expect(plain.out).not.toContain("parallel")
      // a level is frozen and shown in the summary
      const high = await runCli(["init", dir, "--parallel", "high"])
      expect(high.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ parallel: "high" })
      expect(high.out).toContain("· parallel high")
      // amend keeps it; amend --parallel none removes it; a plain init falls back to none
      expect((await runCli(["amend", dir, "--commit", "true"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ parallel: "high" })
      expect((await runCli(["amend", dir, "--parallel", "none"])).code).toBe(0)
      expect(await readConfig(dir)).not.toHaveProperty("parallel")
      expect((await runCli(["init", dir, "--parallel", "low"])).code).toBe(0)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).not.toHaveProperty("parallel")
      // bad level, and --max-sessions outside run, are usage errors
      const bad = await runCli(["init", dir, "--parallel", "max"])
      expect(bad.code).toBe(1)
      expect(bad.err).toContain("--parallel takes none|low|medium|high")
      const initSessions = await runCli(["init", dir, "--max-sessions", "1"])
      expect(initSessions.code).toBe(1)
      expect(initSessions.err).toContain("--max-sessions is a run option")
      // run: above 1 is not supported yet; a non-integer is a usage error
      const two = await runCli(["run", dir, "--max-sessions", "2"])
      expect(two.code).toBe(1)
      expect(two.err).toContain("concurrent execution is not supported yet")
      const zero = await runCli(["run", dir, "--max-sessions", "0"])
      expect(zero.code).toBe(1)
      expect(zero.err).toContain("--max-sessions takes a positive integer")
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
      // The agent contract carries the test protocol too (inline in contract item 2)
      const agent = await Bun.file(join(dir, ".opencode/agent/auto.md")).text()
      expect(agent).toContain("Build, test, compile, lint and other commands that can be slow")
      expect(agent).toContain("tmp/test.sh")
      // amend 关闭 handover-test 保留 test-by-driver;再关闭 test-by-driver 时块内容
      // 与渲染不一致(测试段落应消失),整块刷新
      expect((await runCli(["amend", dir, "--handover-test", "false"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ testByDriver: true, handoverTest: false })
      const off = await runCli(["amend", dir, "--test-by-driver", "false"])
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
      // init no longer establishes the round (plans/0053 D31); plan does
      expect((await runCli(["plan", dir])).code).toBe(0)
      await Bun.write(join(dir, "docs/R-01/P01-implement/tasks.md"), "# Tasks\n\n- [ ] T-001 示例任务\n")
      await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: 示例任务\nPhase: R-01.P01\n\n## Goal\n\n示例。\n")
      const status = await runCli(["status", dir])
      expect(status.code).toBe(0)
      expect(status.out).toContain("⚙ project config (.opencode/auto/config.json): mode migrate · agent opencode")
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

  test("init --phases 合法值固化进 config;摘要含阶段;结束语统一指向 plan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--phases", "admtvk"])
      expect(init.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "admtvk" })
      expect(init.out).toContain("phases admtvk")
      // config-only init (plans/0053 D31): 结束语不再按 phases 分两态,统一指向
      // plan 的建轮路由;docs/ 下不写任何东西
      expect(init.out).toContain(`next: opencode-auto plan ${dir} (establishes round R-01 and stops at the round-start gate)`)
      expect(init.out).not.toContain("to start analysis")
      expect(await stat(join(dir, "docs")).catch(() => undefined)).toBeUndefined()
      // amend 无 --phases 保留既有值;init 显式给值可改
      expect((await runCli(["amend", dir, "--commit", "true"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "admtvk" })
      expect((await runCli(["init", dir, "--phases", "amt"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "amt" })
      // 无 amend 的无参 init 全量覆盖: phases 回落缺省 "m"(无完成阶段,不受前缀护栏约束)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "m" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init/amend 前缀护栏: 轮中改 --phases 不得丢弃已完成阶段;本轮完成后放开(plans/0053 D31–D32)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "adm"])).code).toBe(0)
      // init 不建轮:plan 建立当前轮后才有阶段索引可判
      expect((await runCli(["plan", dir])).code).toBe(0)
      await completeLetters(dir, ["a"])
      // "d" 开头的值会丢弃已完成的 P01-analysis → 拒绝(plannedPhaseUnits 的
      // 只读检查,任何写盘之前)
      const bad = await runCli(["init", dir, "--phases", "dmt"])
      expect(bad.code).toBe(1)
      expect(bad.err).toContain('phases "dmt" would drop the completed phase docs/R-01/P01-analysis/ from docs/R-01/phases.md')
      expect(bad.err).toContain("once the current round is complete, any value applies to the next round")
      const badAmend = await runCli(["amend", dir, "--phases", "dmt"])
      expect(badAmend.code).toBe(1)
      expect(badAmend.err).toContain("would drop the completed phase docs/R-01/P01-analysis/")
      // 兼容值通过:已完成阶段保留;init/amend 不再重写尾部阶段——新值与索引的
      // 差异表现为 drift,由 plan 的重同步路由处理(其行为属 D34)
      const ok = await runCli(["init", dir, "--phases", "admt"])
      expect(ok.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "admt" })
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [x] P01 analysis\n- [ ] P02 design\n- [ ] P03 implement\n")
      // 覆盖型 init(轮已建立)结束语为纯 plan 指针,不再声称建立 R-01
      expect(ok.out).toContain(`next: opencode-auto plan ${dir}`)
      expect(ok.out).not.toContain("establishes round")
      // 护栏判的是本次生效值: 无参 init 全量覆盖会把 phases 回落为 "m",
      // 与已完成的 "a" 不兼容 → 拦在任何写盘之前
      const bare = await runCli(["init", dir])
      expect(bare.code).toBe(1)
      expect(bare.err).toContain('phases "m" would drop the completed phase docs/R-01/P01-analysis/')
      expect(await readConfig(dir)).toMatchObject({ phases: "admt" })
      // 本轮完成后护栏放开: 任何合法值适用于 plan 建立的下一轮(D32)
      await completeLetters(dir, ["d", "m"])
      const fresh = await runCli(["init", dir, "--phases", "amt"])
      expect(fresh.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "amt" })
      const relaxed = await runCli(["amend", dir, "--phases", "admtvk"])
      expect(relaxed.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "admtvk" })
      // 完成轮的索引原样保留(绝不改写)
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [x] P01 analysis\n- [x] P02 design\n- [x] P03 implement\n")
      // 阶段索引非法时 init/amend 报环境错误并给人工修订指引
      await Bun.write(join(dir, "docs/R-01/phases.md"), "- [ ] X1 analysis\n")
      const broken = await runCli(["amend", dir, "--phases", "admtvk"])
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
      expect(init.out).toContain(`next: opencode-auto plan ${dir} (establishes round R-01`)
      // plan 建轮后 status 打印阶段树(按索引)
      expect((await runCli(["plan", dir])).code).toBe(0)
      expect((await runCli(["status", dir])).out).toContain(
        "  [▶] P01-analysis\n  [ ] P02-security-review\n  [ ] P03-implement\n  [ ] P04-security-review\n",
      )
      // Completed analysis → a list not starting with analysis is refused
      await completeLetters(dir, ["a"])
      const bad = await runCli(["init", dir, "--phases", "security-review,implement"])
      expect(bad.code).toBe(1)
      expect(bad.err).toContain('phases "security-review,implement" would drop the completed phase docs/R-01/P01-analysis/')
      // An invalid type file is a usage error naming the file
      await Bun.write(join(dir, ".opencode/auto/phases/broken.md"), "# Broken\n\nTasks: no\n\n## plan duties\n\nx\n")
      const broken = await runCli(["amend", dir, "--commit", "true"])
      expect(broken.code).toBe(1)
      expect(broken.err).toContain("broken.md")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init validates before it writes (plans/0052 D7): the retired -p or a broken prompt override leaves the config layer untouched", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const empty = await runCli(["init", dir, "-p", "  "])
      expect(empty.code).toBe(1)
      expect(empty.err).toContain("--prompt is retired")
      expect(await readdir(dir)).toEqual([])
      await mkdir(join(dir, ".opencode/auto/prompts"), { recursive: true })
      await Bun.write(join(dir, ".opencode/auto/prompts/decompose.md"), "Decompose the task.\n")
      const fresh = await runCli(["init", dir])
      expect(fresh.code).toBe(1)
      expect(fresh.err).toContain("decompose.md")
      expect(await readdir(join(dir, ".opencode/auto"))).toEqual(["prompts"])
      expect(await readdir(dir)).toEqual([".opencode"])
      await rm(join(dir, ".opencode/auto/prompts"), { recursive: true })
      expect((await runCli(["init", dir])).code).toBe(0)
      const config = await Bun.file(join(dir, ".opencode/auto/config.json")).text()
      await mkdir(join(dir, ".opencode/auto/prompts"), { recursive: true })
      await Bun.write(join(dir, ".opencode/auto/prompts/decompose.md"), "Decompose the task.\n")
      const overwrite = await runCli(["init", dir, "-f", "--context-limit", "32"])
      expect(overwrite.code).toBe(1)
      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).text()).toBe(config)
      expect(await Bun.file(join(dir, ".opencode/auto/brief.md")).text()).toBe(renderProjectBrief())
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init -p 已退役(plans/0053 D31): 报文指向 brief.md 与 plan -p;人工 brief 不被触碰", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const brief = join(dir, ".opencode/auto/brief.md")
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await Bun.file(brief).text()).toBe(renderProjectBrief())
      // 人工改写 brief 后,带 -p 的 init 一律退役报文退出,文件原样保留
      await Bun.write(brief, "把 legacy 迁移到 bun\n")
      const refused = await runCli(["init", dir, "-p", "修订后的意图"])
      expect(refused.code).toBe(1)
      expect(refused.err).toBe("--prompt is retired: init no longer writes the project brief: edit .opencode/auto/brief.md (the stub is there); planning input is plan -p\n")
      expect(await Bun.file(brief).text()).toBe("把 legacy 迁移到 bun\n")
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
      // amend 重写既有键(verify:false 为存量产物被静默丢弃);--commit true 是无变化键
      expect((await runCli(["amend", dir, "--commit", "true"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual(config)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init prerequisite: a git repository whose identity cannot commit is refused before any write; once configured, init proceeds and writes the full ignore rules", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    const home = await mkdtemp(join(tmpdir(), "auto-cli-home-"))
    try {
      const git = (...args: string[]) => Bun.spawn(["git", "-C", dir, ...args], { stdout: "ignore", stderr: "ignore" }).exited
      await git("init", "-q")
      // Shield the subprocess from the global/system git config, so the
      // repository has no identity source at all (its commits would fail).
      const env = { HOME: home, XDG_CONFIG_HOME: join(home, "xdg"), GIT_CONFIG_NOSYSTEM: "1" }
      const refused = await runCli(["init", dir], env)
      expect(refused.code).toBe(1)
      expect(refused.err).toContain("git cannot commit")
      expect(refused.err).toContain("user.email")
      // The check runs before any write (validate-then-write, plans/0052 D7)
      expect(await readdir(dir)).toEqual([".git"])
      // With an identity configured, init proceeds and writes the full ignore
      // rules (the driver workdir + the local-only files).
      await git("config", "user.name", "t")
      await git("config", "user.email", "t@t")
      const init = await runCli(["init", dir], env)
      expect(init.code).toBe(0)
      expect(init.out).toContain("updated: .gitignore")
      const gitignore = await Bun.file(join(dir, ".gitignore")).text()
      for (const entry of ["tmp/", ".auto/", "/.gitignore", "/.env", "/AGENTS.md", "/opencode.json"]) {
        expect(gitignore).toContain(`${entry}\n`)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  })

})

// The init shortcut retired with auto-core's implement.ts (plans/0053 D13): its
// planning session is plan's now (-p | --file). The flags stay value-parsed and
// every command refuses them with the retired notice before it writes anything.
describe("CLI: --implement-file/--implement-prompt retired (plans/0053 D13)", () => {
  test("every command refuses them with the retired notice; nothing is written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      for (const [flag, args] of [
        ["implement-prompt", ["init", dir, "--implement-prompt", "做点什么"]],
        ["implement-file", ["init", dir, "--phases", "am", "--implement-file", "plan.md"]],
        ["implement-prompt", ["init", dir, "--amend", "--implement-prompt", "做点什么"]],
        ["implement-file", ["amend", dir, "--phases", "m", "--implement-file", "plan.md"]],
        ["implement-prompt", ["run", dir, "--implement-prompt", "做点什么"]],
      ] as const) {
        const refused = await runCli([...args])
        expect(refused.code).toBe(1)
        expect(refused.err).toContain(
          `--${flag} is retired: plan tasks with opencode-auto plan <dir> -p <text> | --file <path> (after plan establishes the round and its setup is committed)`,
        )
      }
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// init config-only and amend without the round step (auto-core plans/0053
// D31–D32, C1): init's -p and --amend retire with notices naming their
// replacements, init writes the config layer only and points at plan (fresh
// and overwrite alike), and amend never touches the rounds.
describe("CLI: init config-only; init -p/--amend retired (plans/0053 D31)", () => {
  test("init -p and init --amend print their retired notices on every command that has no use for them; nothing is written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const prompt = await runCli(["init", dir, "-p", "意图"])
      expect(prompt.code).toBe(1)
      expect(prompt.err).toBe("--prompt is retired: init no longer writes the project brief: edit .opencode/auto/brief.md (the stub is there); planning input is plan -p\n")
      const flag = await runCli(["init", dir, "--amend"])
      expect(flag.code).toBe(1)
      expect(flag.err).toBe("--amend is retired: init is the stateless full overwrite; to change individual keys use opencode-auto amend <dir> --<key> <value>\n")
      // plan 的 -p 照常解析(规划输入)
      expect((await runCli(["plan", dir, "-p", "text", "--file", "f.md"])).err).toContain("-p/--prompt and --file are mutually exclusive")
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init writes the config layer only (fresh and overwrite) and prints the plan-pointing closing line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir])
      expect(init.code).toBe(0)
      expect(init.out).toContain(`next: opencode-auto plan ${dir} (establishes round R-01 and stops at the round-start gate)`)
      // 只写配置层:docs/ 下没有任何产物(无轮目录、无 round.md 桩——轮次
      // 产物全是 plan 的),brief 桩照写
      expect(await stat(join(dir, "docs")).catch(() => undefined)).toBeUndefined()
      expect(await stat(join(dir, "docs/R-01")).catch(() => undefined)).toBeUndefined()
      expect(await Bun.file(join(dir, "docs/R-01/round.md")).exists()).toBe(false)
      expect(await Bun.file(join(dir, "docs/R-01/AGENTS.md.bak")).exists()).toBe(false)
      expect(await Bun.file(join(dir, ".opencode/auto/brief.md")).exists()).toBe(true)
      // 覆盖型 init(轮未建立):同一结束语,仍不建轮
      const overwrite = await runCli(["init", dir, "--phases", "amt"])
      expect(overwrite.code).toBe(0)
      expect(overwrite.out).toContain(`next: opencode-auto plan ${dir} (establishes round R-01 and stops at the round-start gate)`)
      expect(await stat(join(dir, "docs")).catch(() => undefined)).toBeUndefined()
      // plan 建轮后,覆盖型 init 的结束语为纯 plan 指针(不再声称建立 R-01)
      expect((await runCli(["plan", dir])).code).toBe(0)
      const again = await runCli(["init", dir])
      expect(again.code).toBe(0)
      expect(again.out).toContain(`next: opencode-auto plan ${dir}`)
      expect(again.out).not.toContain("establishes round")
      // 既有轮原样保留
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [ ] P01 analysis\n- [ ] P02 implement\n- [ ] P03 test\n")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: 阶段化流程 P2(轮次目录 / 空模板 / 阶段行 / 台账预检)", () => {
  test("init --phases amt 只写配置层;plan 轮首建立 R-01(阶段索引 + 阶段目录,无 PLAN.md);status 打印阶段树", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--phases", "amt"])
      expect(init.code).toBe(0)
      // init 不建轮(plans/0053 D31):docs/ 不存在,结束语指向 plan
      expect(await stat(join(dir, "docs")).catch(() => undefined)).toBeUndefined()
      expect(init.out).toContain(`next: opencode-auto plan ${dir} (establishes round R-01 and stops at the round-start gate)`)
      const made = await runCli(["plan", dir])
      expect(made.code).toBe(0)
      expect(made.out).toContain("✓ round R-01 established: P01-analysis, P02-implement, P03-test")
      // 任务单元布局(M3.4): 不再有根/轮内 PLAN.md
      expect(await Bun.file(join(dir, "PLAN.md")).exists()).toBe(false)
      expect(await Bun.file(join(dir, "docs/R-01/PLAN.md")).exists()).toBe(false)
      // 轮首不再快照 AGENTS.md(AGENTS.md.bak 退役,auto-core plans/0054 D1)
      expect(await Bun.file(join(dir, "docs/R-01/AGENTS.md.bak")).exists()).toBe(false)
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

  test("phases = m 即隐式阶段 R-01/P01-implement;init 改 --phases 不再重写轮,持工作的阶段目录拒绝丢弃", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [ ] P01 implement\n")
      expect(await Bun.file(join(dir, "docs/R-01/P01-implement/todo.md")).exists()).toBe(true)
      // 未开工的隐式阶段目录仍在(无任务、无 done):init --phases am 允许(值兼容),
      // 但索引不再被重写——差异表现为 drift,由 plan 处理(D31/D34)
      expect((await runCli(["init", dir, "--phases", "am"])).code).toBe(0)
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [ ] P01 implement\n")
      expect(await Bun.file(join(dir, "docs/R-01/P01-implement/todo.md")).exists()).toBe(true)
      expect(JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())).toMatchObject({ phases: "am" })
      // 已列任务的阶段目录不被静默丢弃(前缀护栏的 plannedPhaseUnits 检查)
      await Bun.write(join(dir, "docs/R-01/P01-implement/tasks.md"), "# Tasks\n\n- [ ] T-001 真实任务\n")
      const refused = await runCli(["init", dir, "--phases", "dmt"])
      expect(refused.code).toBe(1)
      expect(refused.err).toContain("already holds work (tasks.md)")
      expect(await Bun.file(join(dir, "docs/R-01/P01-implement/tasks.md")).text()).toContain("真实任务")
      // refused before any write (plans/0052 D7): config.json keeps the old phases
      expect(JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())).toMatchObject({ phases: "am" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("run 打印阶段进度行;阶段索引非法为环境错误退出 1(先于 server 启动)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "amt"])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
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
      expect((await runCli(["plan", dir])).code).toBe(0)
      await Bun.write(join(dir, "docs/R-01/phases.md"), "随便一行\n")
      const status = await runCli(["status", dir])
      expect(status.code).toBe(0)
      expect(status.out).toContain("⚠ phase index docs/R-01/phases.md is invalid")
      // phases = m 的项目不打印阶段行(缺省单次运行,无阶段语义)
      const plain = await mkdtemp(join(tmpdir(), "auto-cli-"))
      try {
        expect((await runCli(["init", plain])).code).toBe(0)
        expect((await runCli(["plan", plain])).code).toBe(0)
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

// `continue` retired (auto-core plans/0053 D33): plan owns the rounds — its
// prelude runs the round-close checks and opens the next round once the
// current one is complete — so the dedicated subcommand is a usage error. The
// notice is the one answer whatever follows the command; the routes it used
// to serve (the previous round's completeness re-check, the round-close gate,
// establishing the next round) are plan's, covered by the plan describe.
describe("CLI: continue retired (auto-core plans/0053 D33)", () => {
  const NOTICE =
    "continue is retired: once the round is complete, fill in ## Close of docs/R-NN/round.md, commit, and run opencode-auto plan <dir> — it runs the round-close checks and opens the next round\n"

  test("--continue 不是选项: init/run/plan 出现即指向 plan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--continue"])
      expect(init.code).toBe(1)
      expect(init.err).toContain("--continue is not an option")
      expect(init.err).toContain("run opencode-auto plan <dir> (it runs the round-close checks and opens the next round)")
      expect(init.err).not.toContain("continue is retired")
      const run = await runCli(["run", dir, "--continue"])
      expect(run.code).toBe(1)
      expect(run.err).toContain("--continue is not an option")
      expect(run.err).toContain("run opencode-auto plan <dir> (it runs the round-close checks and opens the next round)")
      // plan shares run's option machinery (refuseFrozenFlags), so its
      // --continue message names plan the same way.
      const plan = await runCli(["plan", dir, "--continue"])
      expect(plan.code).toBe(1)
      expect(plan.err).toContain("--continue is not an option")
      expect(plan.err).toContain("run opencode-auto plan <dir> (it runs the round-close checks and opens the next round)")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("continue 一律退役报文退出 1: 早于旗标处理与锁检查,目录零写盘", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      // 裸调用与任意旗标组合(含已退役旗标与 -p)都只得到这一句报文
      const plain = await runCli(["continue", dir])
      expect(plain.code).toBe(1)
      expect(plain.err).toBe(NOTICE)
      const flagged = await runCli(["continue", dir, "--phases", "admtvk", "-p", "第二轮意图", "--verify", "--context-limit", "128"])
      expect(flagged.code).toBe(1)
      expect(flagged.err).toBe(NOTICE)
      // 早于锁检查: 活锁在场同样是退役报文,不是锁拒绝
      await Bun.write(join(dir, ".auto/run.lock"), JSON.stringify({ pid: process.pid, host: hostname(), command: "plan", started: "2026-09-23T10:00:00.000Z" }))
      const locked = await runCli(["continue", dir])
      expect(locked.code).toBe(1)
      expect(locked.err).toBe(NOTICE)
      // 全程零写盘
      expect(await readdir(dir)).toEqual([".auto"])
      expect(await readdir(join(dir, ".auto"))).toEqual(["run.lock"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("已初始化的项目同样得到退役报文;plan 开新一轮的路径不变", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "am"])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      // 即便上一轮已完成(continue 旧语义本可生效),退役优先于一切行为判断
      await completeLetters(dir, ["a", "m"])
      await fillClose(dir)
      const cont = await runCli(["continue", dir])
      expect(cont.code).toBe(1)
      expect(cont.err).toBe(NOTICE)
      // plan 仍照常开新一轮(退役只是拿走了子命令,不是轮次能力)
      const opened = await runCli(["plan", dir])
      expect(opened.code).toBe(0)
      expect(opened.out).toContain("✓ round R-02 established: P01-analysis, P02-implement")
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
        ["正常引用 `docs/T-001/todo.md`。", "失效引用 `src/gone.ts`。", "deleted 的 `docs/old.md` 豁免。"].join("\n"),
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

describe("CLI: amend (plans/0052 D25)", () => {
  async function readConfig(dir: string) {
    return JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())
  }

  test("refusals: no config.json, no key, and every non-config option", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const fresh = await runCli(["amend", dir, "--phases", "am"])
      expect(fresh.code).toBe(1)
      expect(fresh.err).toContain(`nothing to amend: ${dir} has no .opencode/auto/config.json; run opencode-auto init ${dir}`)
      expect(await readdir(dir)).toEqual([])
      expect((await runCli(["init", dir])).code).toBe(0)
      const config = await readConfig(dir)
      const none = await runCli(["amend", dir])
      expect(none.code).toBe(1)
      expect(none.err).toContain("name at least one key to change")
      expect(none.err).toContain(`opencode-auto fix ${dir}`)
      const refused: [string[], string][] = [
        [["-p", "意图"], "-p/--prompt is not an amend option: the brief is not config — edit .opencode/auto/brief.md directly"],
        [["--implement-prompt", "计划"], "--implement-prompt is retired: plan tasks with opencode-auto plan <dir>"],
        [["-f", "--phases", "am"], "-f/--force is not an amend option"],
        // --amend 旗标已全局退役(init 不再接受它,没有任何命令接受)
        [["--amend", "--phases", "am"], "--amend is retired: init is the stateless full overwrite; to change individual keys use opencode-auto amend <dir> --<key> <value>"],
        [["--server", "http://x", "--phases", "am"], "--server is not an amend option: amend takes only config flags (-m/--mode, --agent,"],
        [["--max-sessions", "1", "--phases", "am"], "--max-sessions is not an amend option"],
        [["--source-dir", "legacy"], "--source-dir is retired"],
      ]
      for (const [args, message] of refused) {
        const result = await runCli(["amend", dir, ...args])
        expect(result.code).toBe(1)
        expect(result.err).toContain(message)
      }
      expect(await readConfig(dir)).toEqual(config)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("changes the named keys only, re-renders the contract and the AGENTS.md block, leaves the rounds alone (D32)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--context-limit", "32", "--phases", "am", "--parallel", "low", "--agent", "claude"])).code).toBe(0)
      // plan 建立当前轮;amend 只写配置层,不再重同步阶段尾部
      expect((await runCli(["plan", dir])).code).toBe(0)
      await rm(join(dir, "opencode.json"))
      await rm(join(dir, ".opencode/auto/brief.md"))
      const amended = await runCli(["amend", dir, "--test-by-driver", "--phases", "amt", "--parallel", "none", "--agent", "opencode"])
      expect(amended.code).toBe(0)
      expect(amended.out).toContain("✓ amended (--agent --test-by-driver --phases --parallel); the other keys are unchanged")
      const config = await readConfig(dir)
      expect(config).toMatchObject({ contextLimit: 32, phases: "amt", testByDriver: true })
      expect(config).not.toHaveProperty("parallel")
      expect(config).not.toHaveProperty("agent")
      expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).text()).toBe(renderText(await Bun.file(templateAgent).text(), { testByDriver: true }))
      expect(await Bun.file(join(dir, "AGENTS.md")).text()).toContain("tmp/test.sh")
      // the round step is gone (plans/0053 D32): the new value's extra phase is
      // NOT created — the index keeps "am" and the difference is a drift for
      // plan to reconcile
      expect(await stat(join(dir, "docs/R-01/P03-test")).catch(() => undefined)).toBeUndefined()
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [ ] P01 analysis\n- [ ] P02 implement\n")
      // amend writes only what renders from the config: the rest is init's and fix's
      expect(await Bun.file(join(dir, "opencode.json")).exists()).toBe(false)
      expect(await Bun.file(join(dir, ".opencode/auto/brief.md")).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("same checks as init, before any write: bad values, handoverTest ⇒ testByDriver, the prefix guard, a stored retired key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "adm"])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      await completeLetters(dir, ["a"])
      const config = await readConfig(dir)
      for (const [args, message] of [
        [["--subtask", "sometimes"], "--subtask takes off|auto|ondemand"],
        [["--handover-test"], "--handover-test requires --test-by-driver"],
        [["-m", "nope"], "--mode must be a registered mode"],
        [["--phases", "dm"], 'phases "dm" would drop the completed phase docs/R-01/P01-analysis/ from docs/R-01/phases.md'],
      ] as [string[], string][]) {
        const result = await runCli(["amend", dir, ...args])
        expect(result.code).toBe(1)
        expect(result.err).toContain(message)
        expect(await readConfig(dir)).toEqual(config)
      }
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ ...config, destDir: "app" }, null, 2) + "\n")
      const retired = await runCli(["amend", dir, "--context-limit", "32"])
      expect(retired.code).toBe(1)
      expect(retired.err).toContain("destDir is retired")
      expect(retired.err).toContain(`fix: opencode-auto fix ${dir}`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: fix (plans/0052 D10/D11)", () => {
  async function readConfig(dir: string) {
    return JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())
  }

  test("uninitialized refuses, a consistent layer has nothing to fix, options are refused", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const fresh = await runCli(["fix", dir])
      expect(fresh.code).toBe(1)
      expect(fresh.err).toContain(`nothing to fix: ${dir} has no .opencode/auto/config.json; run opencode-auto init ${dir}`)
      expect(await readdir(dir)).toEqual([])
      expect((await runCli(["init", dir])).code).toBe(0)
      const clean = await runCli(["fix", dir])
      expect(clean.code).toBe(0)
      expect(clean.out).toContain("✓ nothing to fix")
      const bad = await runCli(["fix", dir, "--phases", "am"])
      expect(bad.code).toBe(1)
      expect(bad.err).toContain("fix only accepts a directory argument and -f/--force")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("repairs retired keys and missing artifacts, keeps the other keys, is idempotent; run works again", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--context-limit", "128"])).code).toBe(0)
      const { commit: _, ...kept } = await readConfig(dir)
      const stored = { ...kept, commit: false, verifyIdle: 20, source: { dir: "legacy", path: "pkg" }, destDir: "app" }
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify(stored, null, 2) + "\n")
      await rm(join(dir, ".opencode/agent/auto.md"))
      const fix = await runCli(["fix", dir])
      expect(fix.code).toBe(0)
      expect(fix.out).toContain("  fix: .opencode/auto/config.json: commit: false is retired")
      expect(fix.out).toContain("fixed: .opencode/auto/config.json: move its value into .opencode/auto/brief.md under ## Target, then drop the key")
      expect(fix.out).toContain("verifyIdle was renamed to idleTime, which is also set → drop the key")
      expect(fix.out).toContain("fixed: .opencode/agent/auto.md: write it from the template")
      expect(fix.out).toContain("✓ config layer repaired")
      // every key no rule names survives; commit falls back to its default (on)
      expect(await readConfig(dir)).toEqual(kept)
      const brief = await Bun.file(join(dir, ".opencode/auto/brief.md")).text()
      expect(brief).toContain("`legacy`")
      expect(brief).toContain("`app`")
      expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).exists()).toBe(true)
      expect((await runCli(["fix", dir])).out).toContain("✓ nothing to fix")
      // --server 指向关闭端口:不依赖本机 opencode 服务(修复后的配置与契约全部
      // 装载通过,只在连接处快速失败),证明 run 不再因退役键拒绝。
      expect((await runCli(["run", dir, "--dryrun", "--server", "http://127.0.0.1:1"])).err).not.toContain("retired")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("manual findings exit 1 after the fixable ones are applied; artifact checks wait for a loadable config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ ...CONFIG_DEFAULTS, verify: true, handoverTest: true }, null, 2) + "\n")
      await rm(join(dir, ".opencode/agent/auto.md"))
      const fix = await runCli(["fix", dir])
      expect(fix.code).toBe(1)
      expect(fix.out).toContain("  manual: .opencode/auto/config.json: handoverTest requires testByDriver: true")
      expect(fix.out).toContain("  skipped: the agent contract, AGENTS.md block, .gitignore, opencode.json and brief checks (.opencode/auto/config.json does not load)")
      expect(fix.err).toContain("1 finding(s) need a person")
      expect(await readConfig(dir)).not.toHaveProperty("verify")
      expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the worktree gate refuses a dirty tree before any write; -f skips it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await Bun.spawn(["git", "-C", dir, "init", "-q"]).exited)).toBe(0)
      expect((await runCli(["init", dir])).code).toBe(0)
      await rm(join(dir, ".opencode/agent/auto.md"))
      const dirty = await runCli(["fix", dir])
      expect(dirty.code).toBe(1)
      expect(dirty.err).toContain("fix will delete or modify files on disk and requires a clean worktree")
      expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).exists()).toBe(false)
      expect((await runCli(["fix", dir, "-f"])).code).toBe(0)
      expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: the run lock (auto-core plans/0053 D3)", () => {
  // A lock held by this test process: alive, and not the CLI child's own pid.
  async function plantLock(dir: string, pid = process.pid) {
    await Bun.write(join(dir, ".auto/run.lock"), JSON.stringify({ pid, host: hostname(), command: "plan", started: "2026-09-23T10:00:00.000Z" }))
  }

  test("init, amend, fix, reset and run refuse while another process holds it; status shows it first", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      const config = await Bun.file(join(dir, ".opencode/auto/config.json")).text()
      await plantLock(dir)
      const refusal = `⏸ another opencode-auto process holds the run lock of ${dir}: plan, pid ${process.pid} on ${hostname()}, since 2026-09-23T10:00:00.000Z.`
      for (const args of [["init", dir], ["init", dir, "-f"], ["amend", dir, "--context-limit", "64"], ["fix", dir, "-f"], ["reset", dir, "-f"]]) {
        const refused = await runCli(args)
        expect(refused.code).toBe(1)
        expect(refused.err).toContain(refusal)
      }
      const run = await runCli(["run", dir])
      expect(run.code).toBe(1)
      expect(run.out).toContain(refusal)
      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).text()).toBe(config)
      const status = await runCli(["status", dir])
      expect(status.code).toBe(0)
      expect(status.out.split("\n")[0]).toBe(`▶ plan in progress (pid ${process.pid} on ${hostname()}, since 2026-09-23T10:00:00.000Z)`)
      expect(status.out).toContain("⚙ project config")
      expect((await runCli(["check", dir])).err).not.toContain("run lock")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a lock whose process is gone is not live: init proceeds and status does not show it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const gone = Bun.spawn(["true"])
      await gone.exited
      await plantLock(dir, gone.pid)
      expect((await runCli(["init", dir])).code).toBe(0)
      const status = await runCli(["status", dir])
      expect(status.out).not.toContain("in progress")
      expect(status.out.split("\n")[0]).toStartWith("⚙ project config")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// plan (auto-core plans/0053 D14–D15): every route the prelude settles without
// an agent — the refusals, establishing a round, the round-close gate, the
// notices — plus the argument checks. The loop paths (planning itself, the
// stop after it) need an agent and live in the A7 loop harness / the
// OPENCODE_AUTO_E2E block.
describe("CLI: plan (auto-core plans/0053 D14–D15)", () => {
  test("argument refusals: the input flags, run-only and config options, the unconfigured directory; nothing is written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const refusals: [string[], string][] = [
        [["plan", dir, "-p", "text", "--file", "f.md"], "-p/--prompt and --file are mutually exclusive"],
        [["plan", dir, "-p", "  "], "-p/--prompt requires non-empty text"],
        [["plan", dir, "--file"], "--file requires a path"],
        [["plan", dir, "--file", join(dir, "nope.md")], "no such file"],
        [["plan", dir, "--phases", "am"], "--phases was frozen by init"],
        [["plan", dir, "--dryrun"], "--dryrun is a run option"],
        [["plan", dir, "--wait-between", "2"], "--wait-between is a run option"],
        [["plan", dir, "--max-sessions", "1"], "--max-sessions is a run option"],
        [["plan", dir, "-f"], "-f/--force is an init/reset/fix option"],
        // --append 是 plan 专用(D23): 无输入为用法错误,其他命令一律指向 plan。
        [["plan", dir, "--append"], "--append requires a planning input"],
        [["run", dir, "--append"], "--append is a plan option"],
        [["init", dir, "--append"], "--append is a plan option"],
        [["close", "T-001", dir, "--append"], "--append is a plan option"],
        [["fix", dir, "--append"], "--append is a plan option"],
        // 无 config.json:拒绝规划而不是用缺省建轮
        [["plan", dir], `nothing to plan: ${dir} has no .opencode/auto/config.json; run opencode-auto init`],
        [["run", dir, "-p", "text"], "-p/--prompt is a plan option: run takes no planning input"],
        [["init", dir, "--file", "f.md"], "--file is a plan option"],
      ]
      for (const [args, notice] of refusals) {
        const refused = await runCli(args)
        expect(refused.code).toBe(1)
        expect(refused.err).toContain(notice)
      }
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("establishes a missing round (m) with the round-start gate; input on it is refused before any write; re-runs show the empty-index notice", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      // init 只写配置层,轮本就未建立(config-only init,plans/0053 D31)
      // D5:建轮路由上的输入先拒绝,任何写盘之前
      const refused = await runCli(["plan", dir, "-p", "输入"])
      expect(refused.code).toBe(1)
      expect(refused.err).toContain(`round R-01 is not established yet: run opencode-auto plan ${dir} without input to establish it, commit the setup, then pass the input.`)
      expect(await stat(join(dir, "docs")).catch(() => undefined)).toBeUndefined()
      const made = await runCli(["plan", dir])
      expect(made.code).toBe(0)
      expect(made.out).toContain("✓ round R-01 established: single phase P01-implement")
      expect(made.out).toContain(`next (round-start gate): review the setup and commit it; then list tasks in docs/R-01/P01-implement/tasks.md by hand, or run: opencode-auto plan ${dir} -p <text> | --file <path>`)
      expect(await Bun.file(join(dir, "docs/R-01/P01-implement/todo.md")).exists()).toBe(true)
      // 再跑:任务索引为空、无输入 → 提示手工列任务或带输入规划(D15)
      const again = await runCli(["plan", dir])
      expect(again.code).toBe(0)
      expect(again.out).toContain(`ℹ no tasks listed in docs/R-01/P01-implement/tasks.md yet: list them there by hand (docs/T-NNN/todo.md per task), or run: opencode-auto plan ${dir} -p <text> | --file <path>`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("m mode with tasks listed: the run notice without input; --append needs an input, and a mid-pipeline task stops the append (D26)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      await listTasks(dir, "docs/R-01/P01-implement", "R-01.P01", [["T-001", "任务", "正文"]])
      const notice = await runCli(["plan", dir])
      expect(notice.code).toBe(0)
      expect(notice.out).toContain(
        `ℹ docs/R-01/P01-implement/tasks.md lists 1 task(s) (1 pending); next: opencode-auto run ${dir}, ` +
          `or add tasks with opencode-auto plan ${dir} -p <text> | --file <path>`,
      )
      // --append 挂在规划输入上(D23): 无输入即用法错误。
      const bare = await runCli(["plan", dir, "--append"])
      expect(bare.code).toBe(1)
      expect(bare.err).toContain("--append requires a planning input: pass -p <text> | --file <path>")
      // 输入在已列任务索引上即追加;T-001 半途(有恢复点)时 D26 守卫在任何
      // server 启动前拒绝。
      await Bun.write(join(dir, ".auto/progress.json"), JSON.stringify({ task: "T-001", at: 1, active: true }))
      for (const args of [["plan", dir, "-p", "再加点"], ["plan", dir, "--append", "-p", "再加点"]]) {
        const guarded = await runCli(args)
        expect(guarded.code).toBe(1)
        expect(guarded.err).toContain("T-001 is mid-pipeline (its resume point is in .auto/progress.json); finish it with run, or close it, before appending")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("phased, execute route: the planned notice without input; input is a mistake (D7)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "am"])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      await completeLetters(dir, ["a"])
      await listTasks(dir, "docs/R-01/P02-implement", "R-01.P02", [["T-001", "任务", "正文"]])
      const notice = await runCli(["plan", dir])
      expect(notice.code).toBe(0)
      expect(notice.out).toContain(
        `ℹ R-01.P02 implement is planned (1 of 1 tasks pending); next: opencode-auto run ${dir} ` +
          `— or add tasks with opencode-auto plan ${dir} --append -p <text>, or close units with opencode-auto close <ref>`,
      )
      const withInput = await runCli(["plan", dir, "-p", "输入"])
      expect(withInput.code).toBe(1)
      expect(withInput.err).toContain(
        `R-01.P02 implement already lists tasks, so the planning input would not be used; ` +
          `add tasks with opencode-auto plan ${dir} --append -p <text> | --file <path>`,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a complete round: the round-close gate fails with exit 2 (input refused too); passing opens R-02 with the G1 lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "am"])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      await completeLetters(dir, ["a", "m"])
      // 轮完成:G8 不过(`## Close` 未填)→ 退出码 2(D4;continue 时代是 1)
      const fail = await runCli(["plan", dir])
      expect(fail.code).toBe(2)
      expect(fail.err).toContain("round R-01 does not pass its round-close checks, so round R-02 cannot open yet")
      expect(fail.err).toContain("`## Close` is empty")
      expect(fail.err).toContain(`then re-run: opencode-auto plan ${dir}`)
      expect(await stat(join(dir, "docs/R-02")).catch(() => undefined)).toBeUndefined()
      // 完成路由上的输入同样在任何写盘前拒绝
      const withInput = await runCli(["plan", dir, "-p", "输入"])
      expect(withInput.code).toBe(1)
      expect(withInput.err).toContain("round R-01 is complete and round R-02 is not established yet")
      await fillClose(dir)
      const pass = await runCli(["plan", dir])
      expect(pass.code).toBe(0)
      expect(pass.out).toContain("✓ round R-02 established: P01-analysis, P02-implement")
      expect(pass.out).toContain(`then run: opencode-auto plan ${dir} to plan R-02.P01 analysis (or run to plan and execute)`)
      expect(await Bun.file(join(dir, "docs/R-02/phases.md")).text()).toContain("- [ ] P01 analysis")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("plan refuses while another process holds the run lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      await Bun.write(join(dir, ".auto/run.lock"), JSON.stringify({ pid: process.pid, host: hostname(), command: "run", started: "2026-09-23T10:00:00.000Z" }))
      const refused = await runCli(["plan", dir])
      expect(refused.code).toBe(1)
      expect(refused.err).toContain(`⏸ another opencode-auto process holds the run lock of ${dir}: run, pid ${process.pid} on ${hostname()}`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// The phase-index drift at CLI level (auto-core plans/0053 D34): a hand-edited
// docs/R-NN/phases.md whose unstarted tail disagrees with config `phases`. run
// never re-syncs (lifecycle is plan's — a silent re-sync would start work on a
// phase list nobody reviewed) and exits 1 naming plan; plan re-syncs the tail,
// leaves the change uncommitted like any round setup and stops for review.
// Both stops precede any agent, so no fixture agent is needed.
describe("CLI: the phase-index drift (auto-core plans/0053 D34)", () => {
  test("run exits 1 naming plan on a hand-edited index and writes nothing; plan re-syncs it with its exit-0 line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-drift-"))
    try {
      expect((await runCli(["init", dir, "--phases", "amt"])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      // A person drops the unstarted test phase from the index by hand (its
      // directory stays): the index's unstarted tail no longer matches config.
      const edited = "- [ ] P01 analysis\n- [ ] P02 implement\n"
      await Bun.write(join(dir, "docs/R-01/phases.md"), edited)
      const stopped = await runCli(["run", dir])
      expect(stopped.code).toBe(1)
      expect(stopped.out).toContain(
        `⏸ the phase index of round R-01 (P01-analysis, P02-implement) differs from config phases ` +
          `(P01-analysis, P02-implement, P03-test): run opencode-auto plan ${dir} to re-sync its unstarted phases`,
      )
      // run wrote nothing: the index keeps the hand edit, the phase directory stays.
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toBe(edited)
      expect(await Bun.file(join(dir, "docs/R-01/P03-test/todo.md")).exists()).toBe(true)
      // Input on the drift route is refused before any write (D5): the
      // re-synced tail must be reviewed before anything plans into it.
      const refused = await runCli(["plan", dir, "-p", "输入"])
      expect(refused.code).toBe(1)
      expect(refused.err).toContain(
        `the phase index of round R-01 differs from config phases: run opencode-auto plan ${dir} without input to re-sync it, commit the change, then pass the input.`,
      )
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toBe(edited)
      // plan without input re-syncs the tail and stops for review (exit 0),
      // the change left uncommitted like any round setup. The re-synced index
      // is the canonical render again, done ticks preserved.
      const resync = await runCli(["plan", dir])
      expect(resync.code).toBe(0)
      expect(resync.out).toContain(
        `✓ phase index of round R-01 re-synced to config phases (+ P03-test); ` +
          `review docs/R-01/phases.md, commit, then re-run: opencode-auto plan ${dir}`,
      )
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [ ] P01 analysis\n- [ ] P02 implement\n- [ ] P03 test\n")
      expect(await Bun.file(join(dir, "docs/R-01/P03-test/todo.md")).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// close (auto-core plans/0053 D22): the shell half — the argument order (the
// ref first, the directory second), the flag whitelist, the run lock, and one
// happy-path task close on a git fixture (exit code, output lines, the close
// commit and its trailers). The behavioural refusals (done or closed units,
// another round, the m-mode phase, dependents, the dirty tree, the mechanical
// handover, the cleared records) are closeUnit's and live in auto-core's
// close.test.ts.
describe("CLI: close (auto-core plans/0053 D22)", () => {
  // An initialized m-mode git fixture with two open tasks, all committed, so
  // a refused close leaves a byte-identical tree.
  async function closeFixture() {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-close-"))
    const git = gitOf(dir)
    await git("init")
    expect((await runCli(["init", dir])).code).toBe(0)
    expect((await runCli(["plan", dir])).code).toBe(0)
    await listTasks(dir, P01.dir, "R-01.P01", [
      ["T-001", "被取代的任务", "正文"],
      ["T-002", "隐式依赖者", "正文"],
    ])
    await git("add", "-A")
    await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")
    return { dir, git }
  }

  test("argument errors: missing or invalid ref (never mistaken for the directory), the reason, both change flags, non-close flags; nothing is written", async () => {
    const { dir, git } = await closeFixture()
    try {
      const refusals: [string[], string][] = [
        // The ref is required and comes first: a positional[0] that is not a
        // ref (the bare directory, the natural mistake) is a missing or
        // invalid ref, never silently taken as the directory.
        [["close"], "close requires a unit reference"],
        [["close", "--reason", "r"], "close requires a unit reference"],
        [["close", dir, "--reason", "r"], `${dir}: not a unit reference`],
        [["close", "T-5", dir, "--reason", "r"], "T-5: not a unit reference"],
        [["close", "T-001.S01", dir, "--reason", "r"], "T-001.S01: not a unit reference"],
        // --reason: required, non-empty, one line.
        [["close", "T-001", dir], "close requires --reason <text>"],
        [["close", "T-001", dir, "--reason", "  "], "--reason requires non-empty text"],
        [["close", "T-001", dir, "--reason", "two\nlines"], "--reason must be one line"],
        // The two change flags are mutually exclusive.
        [["close", "T-001", dir, "--reason", "r", "--commit-changes", "--stash-changes"], "--commit-changes and --stash-changes are mutually exclusive"],
        // Only close's own flags are accepted (unknown, session and lifecycle
        // options alike); config flags and -p/--file get their own notices.
        [["close", "T-001", dir, "--reason", "r", "--verbose"], "--verbose is not a close option"],
        [["close", "T-001", dir, "--reason", "r", "--cascad"], "did you mean --cascade"],
        [["close", "T-001", dir, "--reason", "r", "-f"], "--force is not a close option"],
        [["close", "T-001", dir, "--reason", "r", "--dryrun"], "--dryrun is not a close option"],
        [["close", "T-001", dir, "--reason", "r", "--phases", "am"], "--phases was frozen by init"],
        [["close", "T-001", dir, "--reason", "r", "-p", "text"], "-p/--prompt is a plan option"],
        [["close", "T-001", dir, "--reason", "r", "--file", "f.md"], "--file is a plan option"],
        [["close", "T-001", dir, "--reason", "r", "--verify"], "--verify is retired"],
        // F8: --commit is a value flag, but the ref comes first and parsing
        // matches whole flag names, so it can never swallow the ref — the
        // command refuses on the config flag instead of mis-reading the
        // arguments (the change flags were named to avoid exactly this).
        [["close", "--commit", "T-001", "--reason", "r"], "--commit is a config flag frozen by init"],
        [["close", "--commit", "T-001", "--reason", "r"], "the close options for a dirty worktree are --commit-changes and --stash-changes"],
      ]
      for (const [args, notice] of refusals) {
        const refused = await runCli(args)
        expect(refused.code, args.join(" ")).toBe(1)
        expect(refused.err, args.join(" ")).toContain(notice)
      }
      // Nothing was written and nothing committed: both tasks untouched.
      expect(await Bun.file(join(dir, taskStatePaths("T-001").pending)).exists()).toBe(true)
      expect(await Bun.file(join(dir, taskStatePaths("T-002").pending)).exists()).toBe(true)
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("close refuses while another process holds the run lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      await listTasks(dir, P01.dir, "R-01.P01", [["T-001", "任务", "正文"]])
      await Bun.write(join(dir, RUN_LOCK_FILE), JSON.stringify({ pid: process.pid, host: hostname(), command: "run", started: "2026-09-23T10:00:00.000Z" }))
      const refused = await runCli(["close", "T-001", dir, "--reason", "r"])
      expect(refused.code).toBe(1)
      expect(refused.err).toContain(`⏸ another opencode-auto process holds the run lock of ${dir}: run, pid ${process.pid} on ${hostname()}`)
      expect(await Bun.file(join(dir, taskStatePaths("T-001").pending)).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("closes a task on a git fixture: exit 0, the output lines, the close commit and its trailers", async () => {
    const { dir, git } = await closeFixture()
    try {
      // The ref comes first, the directory second (D22 argument order).
      const closed = await runCli(["close", "T-001", dir, "--reason", "superseded by the follow-up design"])
      expect(closed.err).toBe("")
      expect(closed.code).toBe(0)
      expect(closed.out).toContain("✓ closed T-001: superseded by the follow-up design")
      // T-002 follows T-001 with no Depends: field → the implicit-dependent note.
      expect(closed.out).toContain("ℹ T-002 has no Depends: field, so its prerequisite T-001 counts as satisfied; do not assume T-001's deliverables exist")
      expect(closed.out).toContain("⚠ closed units skip the unit-close reference scan; the whole-tree scan at round close still applies")
      // The undo pointer names the close commit's short sha; the next line points on.
      const sha = (await git("rev-parse", "--short", "HEAD")).trim()
      expect(closed.out).toContain(`to undo before anything else runs: git revert ${sha}`)
      expect(closed.out).toContain(`next: opencode-auto run ${dir} to continue, or opencode-auto plan ${dir}`)
      // The close commit: subject, body and the force-close trailers.
      const message = await git("log", "-1", "--pretty=%B")
      expect(message).toContain("T-001 closed: superseded by the follow-up design")
      expect(message).toContain("Units closed:\n- T-001")
      expect(message).toContain("Auto-Task: T-001")
      expect(message).toContain("Auto-Stage: force-close")
      // State: the Closed: field with the rename, the index tick, the other
      // task still pending, and a clean tree (the close commit took it all).
      expect(await Bun.file(join(dir, taskStatePaths("T-001").complete)).text()).toContain("Closed: superseded by the follow-up design")
      expect(await Bun.file(join(dir, taskStatePaths("T-001").pending)).exists()).toBe(false)
      expect(await Bun.file(join(dir, P01.dir, "tasks.md")).text()).toContain("- [x] T-001")
      expect(await Bun.file(join(dir, taskStatePaths("T-002").pending)).exists()).toBe(true)
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // The phase target of close (plans/0053 D18): its open tasks close with it,
  // the mechanical handover stands in for the distillation, and the phase
  // index is ticked — the close-side counterpart of the force-close phase
  // test, which reaches the same closeUnit through plan.
  test("closes a phase on a git fixture: the tasks close with it, the mechanical handover is written, phases.md is ticked", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-close-phase-"))
    const git = gitOf(dir)
    try {
      await git("init")
      expect((await runCli(["init", dir, "--phases", "amt"])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      await completeLetters(dir, ["a"])
      await listTasks(dir, "docs/R-01/P02-implement", "R-01.P02", [["T-001", "被跳过的任务", "正文"]])
      await git("add", "-A")
      await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")

      const closed = await runCli(["close", "R-01.P02", dir, "--reason", "skipped this round"])
      expect(closed.err).toBe("")
      expect(closed.code).toBe(0)
      expect(closed.out).toContain("✓ closed T-001: skipped this round")
      expect(closed.out).toContain("✓ closed R-01.P02 implement: skipped this round")
      expect(closed.out).toContain("ℹ mechanical handover written: docs/R-01/P02-implement/handover.md")
      const sha = (await git("rev-parse", "--short", "HEAD")).trim()
      expect(closed.out).toContain(`to undo before anything else runs: git revert ${sha}`)
      // The phase state: closed done.md (task and phase), the four handover
      // sections, the phase index tick, and P03 untouched.
      expect(await Bun.file(join(dir, "docs/R-01/P02-implement/done.md")).text()).toContain("Closed: skipped this round")
      expect(await Bun.file(join(dir, "docs/R-01/P02-implement/todo.md")).exists()).toBe(false)
      expect(await Bun.file(join(dir, taskStatePaths("T-001").complete)).text()).toContain("Closed: skipped this round")
      const handover = await Bun.file(join(dir, "docs/R-01/P02-implement/handover.md")).text()
      for (const section of ["## Key decisions", "## Constraints and pitfalls", "## Required reading for the next phase", "## Artifact index"]) {
        expect(handover).toContain(section)
      }
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [x] P02 implement")
      expect(await Bun.file(join(dir, "docs/R-01/P03-test/todo.md")).exists()).toBe(true)
      // One close commit covering both units, then a clean tree.
      const message = await git("log", "-1", "--pretty=%B")
      expect(message).toContain("R-01.P02 closed: skipped this round")
      expect(message).toContain("Units closed:\n- T-001\n- R-01.P02 (gates skipped:")
      expect(message).toContain("Auto-Task: R-01.P02")
      expect(message).toContain("Auto-Stage: force-close")
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// plan --force-close (auto-core plans/0053 D28): close a unit and continue
// planning in the same process, under one lock. The shell half validated
// here: the argument checks (close's flag set on plan), the refusal contract
// (exit 1, nothing written), and the two deterministic follow-ups — a task
// force-close whose exit code is plan's notice route, and a phase force-close
// skipping into the next phase. The loop-level paths (planning after the
// close, the combined --force-close --append) need an agent and stay with the
// B6 loop-harness / OPENCODE_AUTO_E2E cases.
describe("CLI: plan --force-close (auto-core plans/0053 D28)", () => {
  // An initialized m-mode git fixture with two open tasks, all committed, so
  // a refused force-close leaves a byte-identical tree.
  async function forceCloseFixture() {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-fc-"))
    const git = gitOf(dir)
    await git("init")
    expect((await runCli(["init", dir])).code).toBe(0)
    expect((await runCli(["plan", dir])).code).toBe(0)
    await listTasks(dir, P01.dir, "R-01.P01", [
      ["T-001", "被取代的任务", "正文"],
      ["T-002", "隐式依赖者", "正文"],
    ])
    await git("add", "-A")
    await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")
    return { dir, git }
  }

  test("argument errors: the ref shape, the reason, the change pair, the close-family flags without --force-close, other commands refusing --force-close; nothing is written", async () => {
    const { dir, git } = await forceCloseFixture()
    try {
      const refusals: [string[], string][] = [
        // The ref is a value: missing (the bare flag) or not one of the three
        // canonical shapes is a usage error before anything is read.
        [["plan", dir, "--force-close"], "--force-close requires a unit reference"],
        [["plan", dir, "--force-close", "T-5"], "T-5: not a unit reference"],
        [["plan", dir, "--force-close", "T-001.S01", "--reason", "r"], "T-001.S01: not a unit reference"],
        [["plan", dir, "--force-close", "T-001"], "--force-close requires --reason <text>"],
        [["plan", dir, "--force-close", "T-001", "--reason", "  "], "--reason requires non-empty text"],
        [["plan", dir, "--force-close", "T-001", "--reason", "two\nlines"], "--reason must be one line"],
        [["plan", dir, "--force-close", "T-001", "--reason", "r", "--commit-changes", "--stash-changes"], "--commit-changes and --stash-changes are mutually exclusive"],
        // The close-family flags belong to the close step only: on plan they
        // are meaningless without --force-close.
        [["plan", dir, "--reason", "r"], '--reason is a close option of "plan --force-close <ref> --reason <text>"'],
        [["plan", dir, "--cascade"], "--cascade is a close option of"],
        [["plan", dir, "--stash-changes"], "--stash-changes is a close option of"],
        // --force-close is plan's alone: every other command points at plan
        // (close keeps its positional ref).
        [["run", dir, "--force-close", "T-001", "--reason", "r"], "--force-close is a plan option: run takes no --force-close"],
        [["init", dir, "--force-close", "T-001"], "--force-close is a plan option"],
        [["fix", dir, "--force-close", "T-001"], "--force-close is a plan option"],
        [["close", "T-001", dir, "--reason", "r", "--force-close", "T-002"], "--force-close is a plan option: close takes no --force-close"],
      ]
      for (const [args, notice] of refusals) {
        const refused = await runCli(args)
        expect(refused.code, args.join(" ")).toBe(1)
        expect(refused.err, args.join(" ")).toContain(notice)
      }
      // Nothing was written and nothing committed: both tasks untouched.
      expect(await Bun.file(join(dir, taskStatePaths("T-001").pending)).exists()).toBe(true)
      expect(await Bun.file(join(dir, taskStatePaths("T-002").pending)).exists()).toBe(true)
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a refused close exits 1 with nothing written (the dirty tree), and the lock is released with it", async () => {
    const { dir, git } = await forceCloseFixture()
    try {
      await Bun.write(join(dir, "stray.ts"), "export {}\n")
      const refused = await runCli(["plan", dir, "--force-close", "T-001", "--reason", "superseded"])
      expect(refused.code).toBe(1)
      expect(refused.err).toContain("the worktree has changes beyond the driver's own state files")
      expect(refused.err).toContain("stray.ts")
      // closeUnit refuses before any write: the task untouched, no close
      // commit, the stray file kept.
      expect(await Bun.file(join(dir, taskStatePaths("T-001").pending)).exists()).toBe(true)
      expect(await Bun.file(join(dir, taskStatePaths("T-001").complete)).exists()).toBe(false)
      expect((await git("log", "--oneline")).trim().split("\n")).toHaveLength(1)
      // The single lock plan took is gone with the process (.auto/ was
      // created for it alone and removed empty on release).
      expect(await stat(join(dir, ".auto")).catch(() => undefined)).toBeUndefined()
      expect(await Bun.file(join(dir, "stray.ts")).text()).toBe("export {}\n")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("force-closes a task and continues planning: the close commit lands and the exit code is plan's (the m notice)", async () => {
    const { dir, git } = await forceCloseFixture()
    try {
      const run = await runCli(["plan", dir, "--force-close", "T-001", "--reason", "superseded by a follow-up"])
      expect(run.err).toBe("")
      // Plan's stop (the m-mode notice over the remaining task) is exit 0 —
      // plan's code, not close's.
      expect(run.code).toBe(0)
      // closeUnit's lines print first: the closed task, the implicit
      // dependent, the undo pointer.
      expect(run.out).toContain("✓ closed T-001: superseded by a follow-up")
      expect(run.out).toContain("ℹ T-002 has no Depends: field, so its prerequisite T-001 counts as satisfied; do not assume T-001's deliverables exist")
      expect(run.out).toMatch(/to undo before anything else runs: git revert [0-9a-f]+/)
      // Then plan's own stop: the notice over the listed tasks (1 pending).
      expect(run.out).toContain(
        `ℹ docs/R-01/P01-implement/tasks.md lists 2 task(s) (1 pending); next: opencode-auto run ${dir}, ` +
          `or add tasks with opencode-auto plan ${dir} -p <text> | --file <path>`,
      )
      // The close commit: subject, body and the force-close trailers.
      const message = await git("log", "-1", "--pretty=%B")
      expect(message).toContain("T-001 closed: superseded by a follow-up")
      expect(message).toContain("Units closed:\n- T-001")
      expect(message).toContain("Auto-Task: T-001")
      expect(message).toContain("Auto-Stage: force-close")
      // State: the Closed: field with the rename, the index tick, the other
      // task still pending, and a clean tree (the close commit took it all).
      expect(await Bun.file(join(dir, taskStatePaths("T-001").complete)).text()).toContain("Closed: superseded by a follow-up")
      expect(await Bun.file(join(dir, taskStatePaths("T-001").pending)).exists()).toBe(false)
      expect(await Bun.file(join(dir, P01.dir, "tasks.md")).text()).toContain("- [x] T-001")
      expect(await Bun.file(join(dir, taskStatePaths("T-002").pending)).exists()).toBe(true)
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("force-closes a phase and skips to the next phase: the mechanical handover is written and plan stops on the next phase's notice", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-fc-phase-"))
    const git = gitOf(dir)
    try {
      await git("init")
      expect((await runCli(["init", dir, "--phases", "amt"])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      // P01 done, P02 current with a task to skip over, P03 already planned
      // (its tasks listed by hand), so the follow-up planning stops on the
      // deterministic execute notice naming P03.
      await completeLetters(dir, ["a"])
      await listTasks(dir, "docs/R-01/P02-implement", "R-01.P02", [["T-001", "被跳过的任务", "正文"]])
      await listTasks(dir, "docs/R-01/P03-test", "R-01.P03", [["T-002", "下一阶段任务", "正文"]])
      await git("add", "-A")
      await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")
      const run = await runCli(["plan", dir, "--force-close", "R-01.P02", "--reason", "skipped this round"])
      expect(run.err).toBe("")
      expect(run.code).toBe(0)
      // The phase's open task closes with it, then the phase itself, with
      // the mechanical handover close writes for a closed phase.
      expect(run.out).toContain("✓ closed T-001: skipped this round")
      expect(run.out).toContain("✓ closed R-01.P02 implement: skipped this round")
      expect(run.out).toContain("ℹ mechanical handover written: docs/R-01/P02-implement/handover.md")
      // Plan continues in the same process: the next phase is current now,
      // and its planned state is the notice plan stops on (exit 0, plan's).
      expect(run.out).toContain(
        `ℹ R-01.P03 test is planned (1 of 1 tasks pending); next: opencode-auto run ${dir} ` +
          `— or add tasks with opencode-auto plan ${dir} --append -p <text>, or close units with opencode-auto close <ref>`,
      )
      // Phase state: closed done.md, the four handover sections, the index
      // tick, P03 untouched.
      expect(await Bun.file(join(dir, "docs/R-01/P02-implement/done.md")).text()).toContain("Closed: skipped this round")
      expect(await Bun.file(join(dir, "docs/R-01/P02-implement/todo.md")).exists()).toBe(false)
      const handover = await Bun.file(join(dir, "docs/R-01/P02-implement/handover.md")).text()
      for (const section of ["## Key decisions", "## Constraints and pitfalls", "## Required reading for the next phase", "## Artifact index"]) {
        expect(handover).toContain(section)
      }
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [x] P02 implement")
      expect(await Bun.file(join(dir, "docs/R-01/P03-test/todo.md")).exists()).toBe(true)
      // The close commit covers both units; the tree is clean after it.
      const message = await git("log", "-1", "--pretty=%B")
      expect(message).toContain("R-01.P02 closed: skipped this round")
      expect(message).toContain("Units closed:\n- T-001\n- R-01.P02 (gates skipped:")
      expect(message).toContain("Auto-Task: R-01.P02")
      expect(message).toContain("Auto-Stage: force-close")
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// plan --append end to end (auto-core plans/0053 §8, B6): the leftover CLI
// loop-level flows, driven deterministically over a fake `claude` CLI on PATH
// (test/fixtures/fake-claude.ts; OPENCODE_AUTO_AGENT=claude selects the claude
// adapter, so plan's appending session runs with no provider credentials).
// The agent-driving logic itself is auto-core's loop harness
// (test/append-loop.test.ts); what these cases pin is the shell flow: the
// input commit → append unit commit → appended tasks with the snapshot prefix
// unchanged, the combined --force-close --append (replace a task), and the
// plain phase close (its mechanical handover is closeUnit's, so it needs no
// agent and lives in the close describe).
describe("CLI: plan --append end to end (auto-core plans/0053 D23–D25)", () => {
  // A task document that passes the planning shape checks.
  const doc = (id: string, phase: string) => `# ${id}: task ${id}\nPhase: ${phase}\n\n## Goal\n\ndeliver it.\n\n## Scope\n\nsrc only.\n\n## Acceptance\n\nholds.\n\n<!-- auto: eof -->\n`

  test("plan --append on a phased execute route: input commit → append unit commit → tasks appended, the snapshot prefix unchanged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-append-"))
    const agent = await fakeClaude()
    const git = gitOf(dir)
    try {
      await git("init")
      expect((await runCli(["init", dir, "--phases", "am"])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      // P01 done, P02 current with one pending task (the execute route).
      await completeLetters(dir, ["a"])
      await listTasks(dir, "docs/R-01/P02-implement", "R-01.P02", [["T-001", "既有任务", "正文"]])
      await git("add", "-A")
      await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")
      const seededIndex = await Bun.file(join(dir, "docs/R-01/P02-implement/tasks.md")).text()
      const seededDoc = await Bun.file(join(dir, "docs/T-001/todo.md")).text()

      const run = await agent.run(["plan", dir, "--append", "-p", "Add a fix task for the retry policy."])
      expect(run.err).toBe("")
      expect(run.code).toBe(0)
      // The step ran end to end: the input saved on its own commit, the
      // appending session, the summary over the appended task.
      expect(run.out).toContain("✓ planning input saved to docs/R-01/P02-implement/plan-input.md")
      expect(run.out).toContain("▶ starting the task-append session to append to docs/R-01/P02-implement/tasks.md")
      expect(run.out).toContain("✓ task append complete: docs/R-01/P02-implement/tasks.md gained 1 task(s)")
      expect(run.out).toContain("✓ planned R-01.P02 implement: 1 task(s) in docs/R-01/P02-implement/tasks.md")
      // The input commit, then the append unit commit.
      const subjects = (await git("log", "--format=%s", "-2")).trim().split("\n")
      expect(subjects).toEqual(["PLAN append P02-implement Implementation", "PLAN plan-input P02-implement Implementation"])
      const bodies = await git("log", "--format=%B", "-2")
      expect(bodies).toContain("Auto-Stage: phase-append")
      expect(bodies).toContain("Auto-Stage: plan-input")
      // The snapshot prefix is unchanged: the existing line and document are
      // byte-identical, the new task follows them, the input is verbatim.
      expect(await Bun.file(join(dir, "docs/R-01/P02-implement/tasks.md")).text()).toBe(`${seededIndex}- [ ] T-002 task T-002\n`)
      expect(await Bun.file(join(dir, "docs/T-001/todo.md")).text()).toBe(seededDoc)
      expect(await Bun.file(join(dir, "docs/T-002/todo.md")).text()).toContain("Phase: R-01.P02")
      expect(await Bun.file(join(dir, "docs/R-01/P02-implement/plan-input.md")).text()).toBe("Add a fix task for the retry policy.\n")
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await agent.done()
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  test("plan --force-close --append replaces a task: the close commit lands, the cleared resume point lets the append run, the exit code is plan's", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-fc-append-"))
    const agent = await fakeClaude()
    const git = gitOf(dir)
    try {
      await git("init")
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      await listTasks(dir, P01.dir, "R-01.P01", [
        ["T-001", "被取代的任务", "正文"],
        ["T-002", "后继任务", "正文"],
      ])
      // T-001 mid-pipeline: a plain append stops on D26's guard; the
      // force-close clears the record, so the append runs in the same process.
      await Bun.write(join(dir, ".auto/progress.json"), JSON.stringify({ task: "T-001", at: 1, active: true }))
      await git("add", "-A")
      await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")

      const run = await agent.run(["plan", dir, "--force-close", "T-001", "--reason", "superseded by the redesign", "--append", "-p", "Do X instead."])
      expect(run.err).toBe("")
      expect(run.code).toBe(0)
      // closeUnit's lines first: the closed task, the implicit dependent, the
      // undo pointer naming the close commit.
      expect(run.out).toContain("✓ closed T-001: superseded by the redesign")
      expect(run.out).toContain("ℹ T-002 has no Depends: field, so its prerequisite T-001 counts as satisfied; do not assume T-001's deliverables exist")
      expect(run.out).toMatch(/to undo before anything else runs: git revert [0-9a-f]+/)
      // Then the append: input saved, one replacement task appended (the
      // closed number is never reused), plan's m-mode summary.
      expect(run.out).toContain("✓ planning input saved to docs/R-01/P01-implement/plan-input.md")
      expect(run.out).toContain("✓ task append complete: docs/R-01/P01-implement/tasks.md gained 1 task(s)")
      expect(run.out).toContain("✓ planned 1 task(s) (T-003) into docs/R-01/P01-implement/tasks.md")
      // The close commit, then plan's two.
      const subjects = (await git("log", "--format=%s", "-3")).trim().split("\n")
      expect(subjects).toEqual(["PLAN append P01-implement Implementation", "PLAN plan-input P01-implement Implementation", "T-001 closed: superseded by the redesign"])
      // The mid-pipeline record is gone (the close cleared it), the closed
      // task carries its field, and the replacement task follows the index.
      expect(await Bun.file(join(dir, ".auto/progress.json")).exists()).toBe(false)
      expect(await Bun.file(join(dir, taskStatePaths("T-001").complete)).text()).toContain("Closed: superseded by the redesign")
      expect(await Bun.file(join(dir, P01.dir, "tasks.md")).text()).toBe(
        "# Tasks\n\n- [x] T-001 被取代的任务\n- [ ] T-002 后继任务\n- [ ] T-003 task T-003\n",
      )
      expect(await Bun.file(join(dir, "docs/T-003/todo.md")).text()).toContain("Phase: R-01.P01")
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await agent.done()
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

// The new-project flow end to end (auto-core plans/0053 §8, C5): the P3c
// lifecycle in one pass per mode — init writes the config layer only, plan
// establishes the round and stops at the round-start gate, a person commits
// the setup, plan -p runs the planning session (over the fake `claude` on
// PATH, the B6 fixture convention: no provider credentials, the ambient
// OPENCODE_AUTO_* layer scrubbed) and stops for review, and the follow-up
// plan lands on the execute-route notice. What these cases pin is the shell
// flow and the stop lines; the planning logic itself is the core loop
// harness's (test/plan-loop.test.ts).
describe("CLI: the new-project flow end to end (auto-core plans/0053 §8, C5)", () => {
  test("m mode: init → plan establishes R-01 (G1) → commit → plan -p plans T-001 and stops → plan shows the execute notice", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-flow-m-"))
    const agent = await fakeClaude()
    const git = gitOf(dir)
    try {
      await git("init")
      // init writes the config layer only; the closing line names plan
      const init = await runCli(["init", dir])
      expect(init.code).toBe(0)
      expect(init.out).toContain(`next: opencode-auto plan ${dir} (establishes round R-01 and stops at the round-start gate)`)
      expect(await stat(join(dir, "docs")).catch(() => undefined)).toBeUndefined()
      // plan establishes the round and stops at the round-start gate (G1)
      const made = await agent.run(["plan", dir])
      expect(made.code).toBe(0)
      expect(made.out).toContain("✓ round R-01 established: single phase P01-implement")
      expect(made.out).toContain(
        `next (round-start gate): review the setup and commit it; then list tasks in docs/R-01/P01-implement/tasks.md by hand, ` +
          `or run: opencode-auto plan ${dir} -p <text> | --file <path>`,
      )
      expect(await Bun.file(join(dir, "docs/R-01/P01-implement/todo.md")).exists()).toBe(true)
      // The gate: a person reviews and commits the setup
      await git("add", "-A")
      await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "round setup")
      // plan -p: the input is committed on its own, the planning session
      // writes the index and one task document, and plan stops for review
      const planned = await agent.run(["plan", dir, "-p", "Add a hello task."])
      expect(planned.err).toBe("")
      expect(planned.code).toBe(0)
      expect(planned.out).toContain("✓ planning input saved to docs/R-01/P01-implement/plan-input.md")
      expect(planned.out).toContain("▶ starting the phase planning session to write docs/R-01/P01-implement/tasks.md and the task documents")
      expect(planned.out).toContain("✓ phase planning complete: docs/R-01/P01-implement/tasks.md lists 1 task(s)")
      expect(planned.out).toContain("✓ planned 1 task(s) (T-001) into docs/R-01/P01-implement/tasks.md")
      expect(planned.out).toContain(`next: review them, then run: opencode-auto run ${dir}`)
      // The artifacts: the input verbatim, the index with one task, the task
      // document carrying the phase field, the numbering record advanced.
      expect(await Bun.file(join(dir, "docs/R-01/P01-implement/plan-input.md")).text()).toBe("Add a hello task.\n")
      expect(await Bun.file(join(dir, "docs/R-01/P01-implement/tasks.md")).text()).toBe("# Tasks (R-01.P01)\n\n- [ ] T-001 task T-001\n")
      expect(await Bun.file(join(dir, "docs/T-001/todo.md")).text()).toContain("Phase: R-01.P01")
      expect(await Bun.file(join(dir, ".auto/next-task")).text()).toBe("2\n")
      // The input commit, then the planning unit commit; the tree is clean.
      const subjects = (await git("log", "--format=%s", "-3")).trim().split("\n")
      expect(subjects).toEqual(["PLAN plan P01-implement Implementation", "PLAN plan-input P01-implement Implementation", "round setup"])
      expect((await git("status", "--porcelain")).trim()).toBe("")
      // The follow-up plan (no input) lands on the execute-route notice
      const again = await runCli(["plan", dir])
      expect(again.code).toBe(0)
      expect(again.out).toContain(
        `ℹ docs/R-01/P01-implement/tasks.md lists 1 task(s) (1 pending); next: opencode-auto run ${dir}, ` +
          `or add tasks with opencode-auto plan ${dir} -p <text> | --file <path>`,
      )
    } finally {
      await agent.done()
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  test("phased (am): init → plan establishes R-01 (G1) → fill round.md and commit → plan -p plans P01 and stops → plan shows the execute notice", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-flow-am-"))
    const agent = await fakeClaude()
    const git = gitOf(dir)
    try {
      await git("init")
      const init = await runCli(["init", dir, "--phases", "am"])
      expect(init.code).toBe(0)
      expect(await stat(join(dir, "docs")).catch(() => undefined)).toBeUndefined()
      // plan establishes the round and stops at the round-start gate (G1)
      const made = await agent.run(["plan", dir])
      expect(made.code).toBe(0)
      expect(made.out).toContain("✓ round R-01 established: P01-analysis, P02-implement")
      expect(made.out).toContain(
        `next (round-start gate): review the round setup, fill in docs/R-01/round.md (goal, acceptance and release criteria), and commit it; ` +
          `then run: opencode-auto plan ${dir} to plan R-01.P01 analysis (or run to plan and execute)`,
      )
      // The gate: a person fills in the round brief and commits the setup
      await Bun.write(join(dir, "docs/R-01/round.md"), "# Round R-01\n\n## Goal\n\nSurvey the target.\n")
      await git("add", "-A")
      await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "round setup")
      // plan -p: the phased planning session plans P01-analysis and plan
      // stops for review (the stop is the review point of the round's tasks)
      const planned = await agent.run(["plan", dir, "-p", "Add a survey task."])
      expect(planned.err).toBe("")
      expect(planned.code).toBe(0)
      expect(planned.out).toContain("✓ planning input saved to docs/R-01/P01-analysis/plan-input.md")
      expect(planned.out).toContain("▶ starting the phase planning session to write docs/R-01/P01-analysis/tasks.md and the task documents")
      expect(planned.out).toContain("✓ phase planning complete: docs/R-01/P01-analysis/tasks.md lists 1 task(s)")
      expect(planned.out).toContain("✓ planned R-01.P01 analysis: 1 task(s) in docs/R-01/P01-analysis/tasks.md")
      expect(planned.out).toContain(`next: review them (edit, close, or plan --append), then run: opencode-auto run ${dir}`)
      // The artifacts: the index with one task, the task document, the commits.
      expect(await Bun.file(join(dir, "docs/R-01/P01-analysis/plan-input.md")).text()).toBe("Add a survey task.\n")
      expect(await Bun.file(join(dir, "docs/R-01/P01-analysis/tasks.md")).text()).toBe("# Tasks (R-01.P01)\n\n- [ ] T-001 task T-001\n")
      expect(await Bun.file(join(dir, "docs/T-001/todo.md")).text()).toContain("Phase: R-01.P01")
      const subjects = (await git("log", "--format=%s", "-3")).trim().split("\n")
      expect(subjects).toEqual(["PLAN plan P01-analysis Analysis", "PLAN plan-input P01-analysis Analysis", "round setup"])
      expect((await git("status", "--porcelain")).trim()).toBe("")
      // The follow-up plan (no input) lands on the phased execute notice
      const again = await runCli(["plan", dir])
      expect(again.code).toBe(0)
      expect(again.out).toContain(
        `ℹ R-01.P01 analysis is planned (1 of 1 tasks pending); next: opencode-auto run ${dir} ` +
          `— or add tasks with opencode-auto plan ${dir} --append -p <text>, or close units with opencode-auto close <ref>`,
      )
    } finally {
      await agent.done()
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

describe("CLI: the project brief stub (plans/0052 D9)", () => {
  test("init writes the stub only when brief.md is missing; -p is retired; reset removes only the untouched stub", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const brief = join(dir, ".opencode/auto/brief.md")
      const first = await runCli(["init", dir])
      expect(first.out).toContain("created: .opencode/auto/brief.md (project brief stub")
      expect(await Bun.file(brief).text()).toBe(renderProjectBrief())
      await Bun.write(brief, `${renderProjectBrief()}\nMigrate legacy/pkg to app/.\n`)
      expect((await runCli(["init", dir])).out).toContain("already exists, skipped: .opencode/auto/brief.md")
      expect(await Bun.file(brief).text()).toContain("Migrate legacy/pkg to app/.")
      const reset = await runCli(["reset", dir])
      expect(reset.out).toContain("keep: .opencode/auto/brief.md (filled in, not the init stub, kept)")
      expect(await Bun.file(brief).text()).toContain("Migrate legacy/pkg to app/.")
      // init 的 -p 已退役(plans/0053 D31):桩在,人工直接编辑;带 -p 一律拒绝
      await rm(brief)
      const refused = await runCli(["init", dir, "-p", "意图"])
      expect(refused.code).toBe(1)
      expect(refused.err).toContain("--prompt is retired")
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await Bun.file(brief).text()).toBe(renderProjectBrief())
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
      expect((await runCli(["plan", dir])).code).toBe(0)
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
      expect(dirty.err).toContain(".opencode/auto/config.json")
      // init's ignore rules keep the local-only files out of the dirty list
      expect(dirty.err).not.toContain("opencode.json")
      expect(dirty.err).toContain("-f/--force")
      // 拦截发生在任何写盘之前
      expect(await readConfigAt(dir)).not.toHaveProperty("agent")
      // -f 跳过
      expect((await runCli(["init", dir, "-f", "--agent", "claude"])).code).toBe(0)
      expect(await readConfigAt(dir)).toMatchObject({ agent: "claude" })
      // 提交后不再拦截
      await commitAll(dir)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfigAt(dir)).not.toHaveProperty("agent")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("amend 不是全量覆盖,不受闸门约束", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await git(dir, "init")
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["amend", dir, "--test-by-driver"])).code).toBe(0)
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

  test("run 拒绝已退役的 --amend 与 -f/--force", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const amend = await runCli(["run", dir, "--amend"])
      expect(amend.code).toBe(1)
      expect(amend.err).toContain("--amend is retired: init is the stateless full overwrite; to change individual keys use opencode-auto amend <dir> --<key> <value>")
      const force = await runCli(["run", dir, "-f"])
      expect(force.code).toBe(1)
      expect(force.err).toContain("is an init/reset/fix option")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

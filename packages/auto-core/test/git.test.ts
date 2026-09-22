import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { baselineIntact, beginUnit, changedFiles, commitPending, commitTitle, commitTree, deletedFiles, fileCommitted, fileTracked, pendingChanges, removeIfUntracked, restoreFile, rollbackUnit, suffixedTitle, trackedSourceChanges, unitBaseline, unitViolations } from "../src/git"

async function git(dir: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`git ${args.join(" ")} 退出码 ${code}: ${err || out}`)
  return out
}

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), "auto-git-"))
  await git(dir, "init", "-q")
  return dir
}

const task = { id: "T-001", title: "实现迁移" }

describe("commitTree", () => {
  test("非 git 目录: 空操作不报错,pendingChanges 为 false", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-git-"))
    try {
      await writeFile(join(dir, "a.txt"), "a")
      await commitTree(dir, task, { stage: "execute", subject: "T-001 实现迁移: 执行" })
      expect(await pendingChanges(dir)).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("git 仓库: 提交带标题行与 Auto-Task/Auto-Stage trailer;无改动时跳过不产生新提交", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "a.txt"), "a")
      await commitTree(dir, task, { stage: "subtask 2", subject: "T-001: 子任务 2 编写 schema" })
      const message = await git(dir, "log", "-1", "--pretty=%B")
      expect(message).toContain("T-001: 子任务 2 编写 schema")
      expect(message).toContain("Auto-Task: T-001")
      expect(message).toContain("Auto-Stage: subtask 2")
      expect(await pendingChanges(dir)).toBe(false)
      // 无改动: 不再产生新提交
      await commitTree(dir, task, { stage: "wrapup", subject: "T-001 实现迁移: 收尾" })
      expect((await git(dir, "rev-list", "--count", "HEAD")).trim()).toBe("1")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("嵌套仓库先提交;父仓库提交信息以 Auto-Nested 记录其路径与 SHA", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "pkg"))
      await git(join(dir, "pkg"), "init", "-q")
      await writeFile(join(dir, "root.txt"), "r")
      await writeFile(join(dir, "pkg", "inner.txt"), "i")
      await commitTree(dir, task, { stage: "subtask 1", subject: "T-001: 子任务 1 搭建骨架" })
      expect((await git(dir, "rev-list", "--count", "HEAD")).trim()).toBe("1")
      expect((await git(join(dir, "pkg"), "rev-list", "--count", "HEAD")).trim()).toBe("1")
      const message = await git(dir, "log", "-1", "--pretty=%B")
      expect(message).toMatch(/Auto-Nested: pkg @ [0-9a-f]{7,}/)
      expect(await pendingChanges(dir)).toBe(false)
      expect(await pendingChanges(join(dir, "pkg"))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("仓库身份为空(user.email 未配置): 身份兜底仍可提交", async () => {
    const dir = await fresh()
    try {
      // 本地置空身份,模拟全新环境(全局未配置 user.email)的确定性路径
      await git(dir, "config", "user.email", "")
      await git(dir, "config", "user.name", "")
      await writeFile(join(dir, "a.txt"), "a")
      await commitTree(dir, task, { stage: "done", subject: "T-001 实现迁移: 完成" })
      expect((await git(dir, "log", "-1", "--pretty=%an")).trim()).toBe("opencode-auto")
      expect((await git(dir, "log", "-1", "--pretty=%ae")).trim()).toBe("opencode-auto@local")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("过长的标题行截断到 100 字符", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "a.txt"), "a")
      await commitTree(dir, task, { stage: "execute", subject: `${task.id} ${task.title}: ${"x".repeat(150)}` })
      const subject = (await git(dir, "log", "-1", "--pretty=%s")).trimEnd()
      expect(subject.length).toBe(101)
      expect(subject.endsWith("…")).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ---- 单元提交边界(plans/0021-commit-boundary-design.md)----

// pre-commit hook 恒失败: 构造确定性的提交失败环境。
async function failHooks(dir: string) {
  await mkdir(join(dir, "hooks"))
  await writeFile(join(dir, "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 })
  await git(dir, "config", "core.hooksPath", "hooks")
}

describe("commitTree 失败上报", () => {
  test("pre-commit hook 拒绝: ok=false,失败清单带仓库相对路径与错误;改动保留在工作区", async () => {
    const dir = await fresh()
    try {
      await failHooks(dir)
      await writeFile(join(dir, "a.txt"), "a")
      const result = await commitTree(dir, task, { stage: "execute", subject: "T-001 执行" })
      expect(result.ok).toBe(false)
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0]!.rel).toBe(".")
      expect(result.failures[0]!.error.length).toBeGreaterThan(0)
      expect(await pendingChanges(dir)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("Auto-Nested 覆盖全部嵌套仓库: 本轮未动的嵌套仓库也记其当前 HEAD SHA", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "pkg"))
      await git(join(dir, "pkg"), "init", "-q")
      await writeFile(join(dir, "pkg", "inner.txt"), "i")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: 内包初始化" })
      const pkgHead = (await git(join(dir, "pkg"), "rev-parse", "--short", "HEAD")).trim()
      // 本轮只改根仓库,嵌套仓库无改动 —— root 提交仍须记录 pkg 的最新 SHA
      await writeFile(join(dir, "root.txt"), "r")
      const result = await commitTree(dir, task, { stage: "wrapup", subject: "T-001: 收尾" })
      expect(result.ok).toBe(true)
      const message = await git(dir, "log", "-1", "--pretty=%B")
      expect(message).toMatch(new RegExp(`Auto-Nested: pkg @ ${pkgHead}`))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("unitBaseline / unitViolations(单元收口校验)", () => {
  test("driver 提交区间通过;外部提交与遗留脏区分别检出", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "a.txt"), "a")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: 基线前提交" })
      const baseline = await unitBaseline(dir)
      // ① driver 提交(带 Auto-Stage trailer)→ 无违规
      await writeFile(join(dir, "b.txt"), "b")
      await commitTree(dir, task, { stage: "subtask 1", subject: "T-001: 子任务 1" })
      expect(await unitViolations(dir, baseline)).toEqual([])
      // ② 外部提交(无 Auto-Stage trailer)→ 检出
      await writeFile(join(dir, "c.txt"), "c")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "人工提交")
      const violations = await unitViolations(dir, baseline)
      expect(violations).toHaveLength(1)
      expect(violations[0]).toContain("non-driver commit")
      // ③ 遗留未提交改动 → 检出
      await git(dir, "commit", "--amend", "-qm", "人工提交") // 把工作区复原为干净
      await writeFile(join(dir, "d.txt"), "d")
      const dirty = await unitViolations(dir, baseline)
      expect(dirty.some((problem) => problem.includes("uncommitted changes"))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("空基线(门禁关闭/非 git 环境)恒通过", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-git-"))
    try {
      expect(await unitViolations(dir, [])).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("beginUnit(单元启动门禁)", () => {
  test("clean → 记基线;门禁关闭(--commit false / dryrun)→ 直通无基线", async () => {
    const dir = await fresh()
    try {
      const gate = await beginUnit(dir, {}, task)
      expect(gate.type).toBe("ok")
      if (gate.type === "ok") expect(gate.baseline).toHaveLength(1)
      const off = await beginUnit(dir, { commit: false }, task)
      expect(off).toEqual({ type: "ok", baseline: undefined })
      const dry = await beginUnit(dir, { dryrun: true }, task)
      expect(dry).toEqual({ type: "ok", baseline: undefined })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("driver 独占状态写入(CURRENT.md、索引勾选、单元 todo→done 改名)遗留 → carryover 补提交自愈", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "docs/R-01/P01-implement"), { recursive: true })
      await mkdir(join(dir, "docs/T-001"), { recursive: true })
      await writeFile(join(dir, "docs/R-01/phases.md"), "- [ ] P01 implement\n")
      await writeFile(join(dir, "docs/R-01/P01-implement/tasks.md"), "- [ ] T-001 示例\n")
      await writeFile(join(dir, "docs/T-001/todo.md"), "# T-001: 示例\n")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: 种子" })
      // markDone 之后、终态提交之前中断的现场
      await rename(join(dir, "docs/T-001/todo.md"), join(dir, "docs/T-001/done.md"))
      await writeFile(join(dir, "docs/R-01/P01-implement/tasks.md"), "- [x] T-001 示例\n")
      await writeFile(join(dir, "CURRENT.md"), "镜像\n")
      const gate = await beginUnit(dir, {}, task)
      expect(gate.type).toBe("ok")
      expect(await changedFiles(dir)).toEqual([])
      const message = await git(dir, "log", "-1", "--pretty=%B")
      expect(message).toContain("Auto-Stage: carryover")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("其他脏区(人工改动/AI 半途产物)→ dirty 交人工,不自动清扫", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "src.ts"), "x")
      const gate = await beginUnit(dir, {}, task)
      expect(gate).toEqual({ type: "dirty", files: ["src.ts"] })
      // 脏区原样保留(driver 不动 git)
      expect(await changedFiles(dir)).toEqual(["src.ts"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("轮次与任务目录内的非状态文件脏区仍 dirty 交人工(子任务状态文件不属 carryover)", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "docs/R-01/P01-implement"), { recursive: true })
      await mkdir(join(dir, "docs/T-001/S01"), { recursive: true })
      await writeFile(join(dir, "docs/R-01/phases.md"), "- [ ] P01 implement\n")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: 种子" })
      await writeFile(join(dir, "docs/R-01/P01-implement/handover.md"), "a\n")
      await writeFile(join(dir, "docs/T-001/S01/done.md"), "a\n")
      expect(await beginUnit(dir, {}, task)).toEqual({ type: "dirty", files: ["docs/R-01/P01-implement/handover.md", "docs/T-001/S01/done.md"] })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("commitPending(隐藏任务 ③ 补提交)", () => {
  test("产物在未提交清单 → 补提交并返回结果;不在 → clean;门禁关闭 → clean", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "seed.txt"), "s")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: 种子" })
      await mkdir(join(dir, "docs"))
      await writeFile(join(dir, "docs", "kb.md"), "知识")
      const committed = await commitPending(dir, {}, task, { stage: "knowledge", subject: "PLAN knowledge 迁移知识沉淀" }, [join("docs", "kb.md")])
      expect(committed !== "clean" && committed.ok).toBe(true)
      expect(await changedFiles(dir)).toEqual([])
      const message = await git(dir, "log", "-1", "--pretty=%B")
      expect(message).toContain("Auto-Stage: knowledge")
      // 已提交 → clean 无动作
      expect(await commitPending(dir, {}, task, { stage: "knowledge", subject: "x" }, [join("docs", "kb.md")])).toBe("clean")
      // 门禁关闭 → clean 空转
      await writeFile(join(dir, "docs", "kb2.md"), "知识2")
      expect(await commitPending(dir, { commit: false }, task, { stage: "knowledge", subject: "x" }, [join("docs", "kb2.md")])).toBe("clean")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ---- 恢复保真(plans/0022-session-recovery-fidelity-design.md 3.1 ③ / 3.3)----

describe("baselineIntact(恢复时的基线核对)", () => {
  test("HEAD == 基线 / 区间全 driver 提交 → 通过;外部提交检出;**未提交脏区不报**", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "a.txt"), "a")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: 基线前提交" })
      const baseline = await unitBaseline(dir)
      // ① HEAD == 基线
      expect(await baselineIntact(dir, baseline)).toEqual([])
      // ② 基线..HEAD 全是 driver 提交(带 Auto-Stage trailer)
      await writeFile(join(dir, "b.txt"), "b")
      await commitTree(dir, task, { stage: "subtask 1", subject: "T-001: 子任务 1" })
      expect(await baselineIntact(dir, baseline)).toEqual([])
      // ③ 半途脏区正是恢复对象: 核对不看未提交改动(与 unitViolations 的关键差异)
      await writeFile(join(dir, "c.txt"), "c")
      expect(await baselineIntact(dir, baseline)).toEqual([])
      expect((await unitViolations(dir, baseline)).some((problem) => problem.includes("uncommitted changes"))).toBe(true)
      // ④ 外部提交(无 Auto-Stage trailer)混入 → 认知失真
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "人工提交")
      const problems = await baselineIntact(dir, baseline)
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain("non-driver commit")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("空基线恒通过;基线在册但仓库不可读 → HEAD 不可读", async () => {
    const dir = await fresh()
    try {
      expect(await baselineIntact(dir, [])).toEqual([])
      const problems = await baselineIntact(dir, [{ root: join(dir, "missing"), sha: "abc1234" }])
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain("HEAD unreadable")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("空仓库基线(单元启动时尚无提交): driver 提交通过,外部提交检出", async () => {
    const dir = await fresh()
    try {
      const baseline = await unitBaseline(dir)
      expect(baseline).toEqual([{ root: dir, sha: "" }])
      expect(await baselineIntact(dir, baseline)).toEqual([])
      await writeFile(join(dir, "a.txt"), "a")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: 单元内首个提交" })
      expect(await baselineIntact(dir, baseline)).toEqual([])
      await writeFile(join(dir, "b.txt"), "b")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "人工提交")
      expect((await baselineIntact(dir, baseline))[0]).toContain("non-driver commit")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("rollbackUnit(不可保真时的回滚协议)", () => {
  const info = { task: "T-001", unit: "子任务 1" }

  test("脏区 + 本单元 driver 提交 → stash×2 + soft reset 回基线,工作区净、现场在 stash", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "seed.txt"), "s")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: 基线前提交" })
      const baseline = await unitBaseline(dir)
      const base = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      await writeFile(join(dir, "done.txt"), "已落账的半截工作")
      await commitTree(dir, task, { stage: "subtask 1", subject: "T-001: 子任务 1 半途" })
      await writeFile(join(dir, "wip.txt"), "未提交的半截工作")
      const result = await rollbackUnit(dir, baseline, info)
      expect(result.ok).toBe(true)
      expect(result.stashes).toBe(2)
      expect(result.resets).toEqual(["."])
      expect(result.skipped).toEqual([])
      expect((await git(dir, "rev-parse", "--short", "HEAD")).trim()).toBe(base)
      expect(await changedFiles(dir)).toEqual([])
      const stashes = await git(dir, "stash", "list")
      expect(stashes).toContain("auto-rollback")
      expect(stashes.trim().split("\n")).toHaveLength(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("外部提交混入 → ok=false 且该仓库原样(不动人工提交,交人工处置)", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "seed.txt"), "s")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: 基线前提交" })
      const baseline = await unitBaseline(dir)
      await writeFile(join(dir, "human.txt"), "人工改动")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "人工提交")
      const head = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      await writeFile(join(dir, "wip.txt"), "半截工作")
      const result = await rollbackUnit(dir, baseline, info)
      expect(result.ok).toBe(false)
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0]!.rel).toBe(".")
      expect(result.stashes).toBe(0)
      expect((await git(dir, "rev-parse", "--short", "HEAD")).trim()).toBe(head)
      expect(await changedFiles(dir)).toEqual(["wip.txt"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("检测到 upstream → 只 stash 不动分支历史(计入 skipped)", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "seed.txt"), "s")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: 基线前提交" })
      const baseline = await unitBaseline(dir)
      await writeFile(join(dir, "done.txt"), "已落账")
      await commitTree(dir, task, { stage: "subtask 1", subject: "T-001: 子任务 1 半途" })
      const head = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      // 自引用 upstream(无需远端): 当前分支的 upstream 指向本地镜像分支
      const current = (await git(dir, "rev-parse", "--abbrev-ref", "HEAD")).trim()
      await git(dir, "branch", "upstream-mirror")
      await git(dir, "config", `branch.${current}.remote`, ".")
      await git(dir, "config", `branch.${current}.merge`, "refs/heads/upstream-mirror")
      await writeFile(join(dir, "wip.txt"), "半截工作")
      const result = await rollbackUnit(dir, baseline, info)
      expect(result.ok).toBe(true)
      expect(result.stashes).toBe(1)
      expect(result.resets).toEqual([])
      expect(result.skipped).toEqual(["."])
      expect((await git(dir, "rev-parse", "--short", "HEAD")).trim()).toBe(head)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("空仓库基线(单元启动时尚无提交)→ 只 stash 不回退历史", async () => {
    const dir = await fresh()
    try {
      const baseline = await unitBaseline(dir)
      await writeFile(join(dir, "a.txt"), "a")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: 单元内首个提交" })
      const head = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      await writeFile(join(dir, "wip.txt"), "半截工作")
      const result = await rollbackUnit(dir, baseline, info)
      expect(result.ok).toBe(true)
      expect(result.stashes).toBe(1)
      expect(result.resets).toEqual([])
      expect(result.skipped).toEqual(["."])
      expect((await git(dir, "rev-parse", "--short", "HEAD")).trim()).toBe(head)
      expect(await changedFiles(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("嵌套仓库各自回滚到各自基线(深度优先,先内后外)", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "pkg"))
      await git(join(dir, "pkg"), "init", "-q")
      await writeFile(join(dir, "root.txt"), "r")
      await writeFile(join(dir, "pkg", "inner.txt"), "i")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: 基线前提交" })
      const baseline = await unitBaseline(dir)
      const bases = Object.fromEntries(baseline.map((line) => [line.root, line.sha]))
      // 两仓库各落一个 driver 提交 + 各留一份脏区
      await writeFile(join(dir, "root2.txt"), "r2")
      await writeFile(join(dir, "pkg", "inner2.txt"), "i2")
      await commitTree(dir, task, { stage: "subtask 1", subject: "T-001: 子任务 1 半途" })
      await writeFile(join(dir, "wip.txt"), "半截")
      await writeFile(join(dir, "pkg", "wip.txt"), "半截")
      const result = await rollbackUnit(dir, baseline, info)
      expect(result.ok).toBe(true)
      expect(result.resets.sort()).toEqual([".", "pkg"])
      expect(result.stashes).toBe(4)
      expect((await git(dir, "rev-parse", "--short", "HEAD")).trim()).toBe(bases[dir])
      expect((await git(join(dir, "pkg"), "rev-parse", "--short", "HEAD")).trim()).toBe(bases[join(dir, "pkg")])
      expect(await changedFiles(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("交接漂移登记: trackedSourceChanges", () => {
  test("非 git 目录: 无改动可言,返回空数组", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-git-"))
    try {
      await writeFile(join(dir, "src.ts"), "a")
      expect(await trackedSourceChanges(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("只认已跟踪的非文档改动: 文档面与未跟踪新增都不登记", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "docs", "T-001"), { recursive: true })
      await mkdir(join(dir, "test"), { recursive: true })
      await writeFile(join(dir, "src.ts"), "v1")
      await writeFile(join(dir, "test", "build.sh"), "echo v1")
      await writeFile(join(dir, "docs", "T-001", "testhandoff.md"), "旧")
      await writeFile(join(dir, "CURRENT.md"), "镜像")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: 定版" })
      expect(await trackedSourceChanges(dir)).toEqual([])

      // 文档面改动(docs/** 与 CURRENT.md)不计。
      await writeFile(join(dir, "docs", "T-001", "testhandoff.md"), "新")
      await writeFile(join(dir, "CURRENT.md"), "镜像 2")
      // 未跟踪新增不计(已知取舍)。
      await writeFile(join(dir, "fresh.ts"), "新文件")
      expect(await trackedSourceChanges(dir)).toEqual([])

      // 已跟踪源码与 test/ 脚本改动才计。
      await writeFile(join(dir, "src.ts"), "v2")
      await writeFile(join(dir, "test", "build.sh"), "echo v2")
      expect((await trackedSourceChanges(dir)).sort()).toEqual([join("test", "build.sh"), "src.ts"].sort())
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("嵌套仓库同样覆盖: 内外两仓的已跟踪改动合并成一张清单", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "src.ts"), "v1")
      const nested = join(dir, "vendor")
      await mkdir(nested, { recursive: true })
      await git(nested, "init", "-q")
      await writeFile(join(nested, "lib.ts"), "n1")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: 定版" })
      expect(await trackedSourceChanges(dir)).toEqual([])

      await writeFile(join(dir, "src.ts"), "v2")
      await writeFile(join(nested, "lib.ts"), "n2")
      expect((await trackedSourceChanges(dir)).sort()).toEqual(["src.ts", join("vendor", "lib.ts")].sort())
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("交接文档的现场复原(测试交接中断恢复 F3)", () => {
  test("已落账却被删掉的文档: 列得出、取得回,复原即消脏", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "docs", "T-028", "S03"), { recursive: true })
      const rel = join("docs", "T-028", "S03", "testhandoff.md")
      await writeFile(join(dir, rel), "交接正文\n\n状态: 继续\n")
      await commitTree(dir, task, { stage: "subtask 3 handoff-1", subject: "T-001 测试交接 #1" })
      expect(await fileTracked(dir, rel)).toBe(true)
      expect(await fileCommitted(dir, rel)).toBe(true)
      expect(await deletedFiles(dir, "docs")).toEqual([])

      // 上一次运行的陈旧清理把在途文档删掉: 删除本身即脏区
      await rm(join(dir, rel), { force: true })
      expect(await deletedFiles(dir, "docs")).toEqual([rel])
      expect(await changedFiles(dir)).toEqual([rel])

      expect(await restoreFile(dir, rel)).toBe(true)
      expect(await Bun.file(join(dir, rel)).text()).toBe("交接正文\n\n状态: 继续\n")
      expect(await changedFiles(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("未跟踪文件: 不算已落账、不算被删", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "docs"), { recursive: true })
      await writeFile(join(dir, "docs", "stray.md"), "遗留")
      expect(await fileTracked(dir, join("docs", "stray.md"))).toBe(false)
      expect(await fileCommitted(dir, join("docs", "stray.md"))).toBe(false)
      expect(await deletedFiles(dir, "docs")).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // steer 交接文档(handoff.md)陈旧清理的共用原语(F4 语义上收): 已跟踪的属未收口
  // 单元的在途状态,删它即脏区——保留给恢复语义;未跟踪的陈旧遗留照删。
  test("removeIfUntracked: 已跟踪的不删且不产生脏区,未跟踪的照删", async () => {
    const dir = await fresh()
    try {
      const rel = join("docs", "T-028", "handoff.md")
      await mkdir(join(dir, "docs", "T-028"), { recursive: true })
      await writeFile(join(dir, rel), "交接正文\n\n状态: 继续\n")
      await commitTree(dir, { id: "T-028", title: "落码" }, { stage: "subtask 1 handoff", subject: "T-028 S1 交接" })
      await removeIfUntracked(dir, rel)
      expect(await Bun.file(join(dir, rel)).exists()).toBe(true)
      expect(await changedFiles(dir)).toEqual([])
      const stray = join("docs", "T-028", "handoff-legacy.md")
      await writeFile(join(dir, stray), "遗留")
      await removeIfUntracked(dir, stray)
      expect(await Bun.file(join(dir, stray)).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("已跟踪但工作区有改动: 不算已落账(提交 #2 还没发生)", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "a.md"), "一")
      await commitTree(dir, task, { stage: "execute", subject: "T-001 执行" })
      await writeFile(join(dir, "a.md"), "二")
      expect(await fileTracked(dir, "a.md")).toBe(true)
      expect(await fileCommitted(dir, "a.md")).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("非 git 目录: 一律安全回落", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-git-"))
    try {
      expect(await deletedFiles(dir, "docs")).toEqual([])
      expect(await fileTracked(dir, "a.md")).toBe(false)
      expect(await fileCommitted(dir, "a.md")).toBe(false)
      expect(await restoreFile(dir, "a.md")).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("suffixedTitle(交接提交标题 = 单元标题 + 交接标记)", () => {
  test("短标题原样拼接", () => {
    expect(suffixedTitle("T-028 S3 参数确定主链族落码", "测试交接 #1 定版")).toBe("T-028 S3 参数确定主链族落码 测试交接 #1 定版")
  })

  test("超长时截主体、保后缀,总长不超过 commitTitle 的上限(不被二次截断)", () => {
    const base = `T-028 S3 ${"标".repeat(120)}`
    const title = suffixedTitle(base, "测试交接 #2 定版")
    expect(title.endsWith("… 测试交接 #2 定版")).toBe(true)
    expect(title.length).toBeLessThanOrEqual(100)
    // 关键: #n 与"定版"是区分同一子任务多次交接提交的唯一信息,不能被截掉
    expect(commitTitle(title)).toBe(title)
  })

  test("恰好卡在上限: 不截", () => {
    const suffix = "测试交接 #1"
    const base = "x".repeat(100 - suffix.length - 1)
    expect(suffixedTitle(base, suffix)).toBe(`${base} ${suffix}`)
    expect(suffixedTitle(base, suffix).length).toBe(100)
  })
})

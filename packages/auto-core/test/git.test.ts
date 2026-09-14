import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beginUnit, changedFiles, commitPending, commitTree, pendingChanges, unitBaseline, unitViolations } from "../src/git"

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

// ---- 单元提交边界(commit-boundary-design.md)----

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
      expect(violations[0]).toContain("非 driver 提交")
      // ③ 遗留未提交改动 → 检出
      await git(dir, "commit", "--amend", "-qm", "人工提交") // 把工作区复原为干净
      await writeFile(join(dir, "d.txt"), "d")
      const dirty = await unitViolations(dir, baseline)
      expect(dirty.some((problem) => problem.includes("未提交改动"))).toBe(true)
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

  test("driver 独占状态文件(PLAN.md/CURRENT.md)遗留 → carryover 补提交自愈", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "seed.txt"), "s")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: 种子" })
      await writeFile(join(dir, "PLAN.md"), "## T-001: 示例 [done]\n")
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

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { commitTree, pendingChanges } from "../src/git"

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

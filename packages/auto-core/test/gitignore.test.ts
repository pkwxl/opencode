import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureGitignore } from "../src/gitignore"

const gitInit = (cwd: string) => Bun.spawnSync(["git", "init", "-q"], { cwd })

describe("ensureGitignore", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-gitignore-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("非 git 目录(无 .git 与 .gitignore)不做任何事", async () => {
    expect(await ensureGitignore(dir)).toBe(false)
    expect(await Bun.file(join(dir, ".gitignore")).exists()).toBe(false)
  })

  test("git 仓库: 缺失条目被追加,重复调用幂等", async () => {
    gitInit(dir)
    expect(await ensureGitignore(dir)).toBe(true)
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("tmp/\n.auto/\n")
    expect(await ensureGitignore(dir)).toBe(false)
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("tmp/\n.auto/\n")
  })

  test("嵌于大仓库子目录(本目录无 .git/.gitignore)同样补写(2026-09-17 审查 H5)", async () => {
    gitInit(dir)
    const sub = join(dir, "packages", "sub")
    await mkdir(sub, { recursive: true })
    expect(await ensureGitignore(sub)).toBe(true)
    expect(await Bun.file(join(sub, ".gitignore")).text()).toBe("tmp/\n.auto/\n")
  })

  test("已有等价条目(无斜杠/带前导斜杠)不重复追加", async () => {
    await writeFile(join(dir, ".gitignore"), "node_modules\n/tmp/\n")
    expect(await ensureGitignore(dir)).toBe(true)
    const text = await Bun.file(join(dir, ".gitignore")).text()
    expect(text).toBe("node_modules\n/tmp/\n.auto/\n")
    expect(await ensureGitignore(dir)).toBe(false)
  })

  test("无 .git 但已有 .gitignore 也维护", async () => {
    await writeFile(join(dir, ".gitignore"), "dist\n")
    expect(await ensureGitignore(dir)).toBe(true)
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("dist\ntmp/\n.auto/\n")
  })
})

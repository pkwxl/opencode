import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureGitignore, ensureInitGitignore } from "../src/gitignore"

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

describe("ensureInitGitignore", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-gitignore-init-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("a non-git directory (no .git and no .gitignore) is left alone", async () => {
    expect(await ensureInitGitignore(dir)).toEqual([])
    expect(await Bun.file(join(dir, ".gitignore")).exists()).toBe(false)
  })

  test("a git repository gets the workdir and the local-only entries in one pass, idempotently", async () => {
    gitInit(dir)
    expect(await ensureInitGitignore(dir)).toEqual(["tmp/", ".auto/", "/.gitignore", "/.env", "/AGENTS.md", "/opencode.json"])
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("tmp/\n.auto/\n/.gitignore\n/.env\n/AGENTS.md\n/opencode.json\n")
    expect(await ensureInitGitignore(dir)).toEqual([])
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("tmp/\n.auto/\n/.gitignore\n/.env\n/AGENTS.md\n/opencode.json\n")
  })

  test("nested git repositories in the tree (including nested-in-nested) are ignored; node_modules is not descended into", async () => {
    gitInit(dir)
    await mkdir(join(dir, "vendor", "pkg"), { recursive: true })
    gitInit(join(dir, "vendor", "pkg"))
    await mkdir(join(dir, "vendor", "pkg", "inner"), { recursive: true })
    gitInit(join(dir, "vendor", "pkg", "inner"))
    await mkdir(join(dir, "node_modules", "dep"), { recursive: true })
    gitInit(join(dir, "node_modules", "dep"))
    const appended = await ensureInitGitignore(dir)
    expect(appended).toContain("/vendor/pkg/")
    expect(appended).toContain("/vendor/pkg/inner/")
    expect(appended).not.toContain("/node_modules/dep/")
    expect(await Bun.file(join(dir, ".gitignore")).text()).toContain("/vendor/pkg/\n")
  })

  test("existing equivalent entries (slash-less spellings) are not duplicated", async () => {
    gitInit(dir)
    await writeFile(join(dir, ".gitignore"), "node_modules\n.env\nAGENTS.md\n")
    expect(await ensureInitGitignore(dir)).toEqual(["tmp/", ".auto/", "/.gitignore", "/opencode.json"])
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("node_modules\n.env\nAGENTS.md\ntmp/\n.auto/\n/.gitignore\n/opencode.json\n")
  })
})

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import templateConfig from "../templates/opencode.json" with { type: "file" }
import { ensurePointer } from "../src/agents-block"
import { renderProjectBrief } from "../src/brief"
import { ensureGitignore, ensureInitGitignore, removeGitignoreEntries } from "../src/gitignore"
import { MODELS_FILE } from "../src/models"
import { applyReset, planReset, type ResetEntry } from "../src/reset"

// A minimal replica of init's output (without running the real CLI): the
// four config-layer files + the two shared files + the gitignore entries.
async function seedInit(dir: string) {
  await mkdir(join(dir, ".opencode", "auto"), { recursive: true })
  await mkdir(join(dir, ".opencode", "agent"), { recursive: true })
  await writeFile(join(dir, ".opencode", "auto", "config.json"), '{"mode":"migrate"}\n')
  await writeFile(join(dir, ".opencode", "auto", "brief.md"), renderProjectBrief())
  await writeFile(join(dir, ".opencode", "agent", "auto.md"), "# auto agent\n")
  await writeFile(join(dir, "opencode.json"), await Bun.file(templateConfig).text())
  await ensurePointer(dir)
  await writeFile(join(dir, ".gitignore"), "")
  await ensureGitignore(dir)
}

async function reset(dir: string): Promise<ResetEntry[]> {
  const entries = await planReset(dir)
  await applyReset(dir, entries)
  return entries
}

const exists = (path: string) => Bun.file(path).exists()

describe("reset: config-layer cleanup", () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-reset-"))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("removes every config-layer artifact; once reclaimed, the directory matches the uninitialized state", async () => {
    await seedInit(dir)
    await reset(dir)
    expect(await exists(join(dir, ".opencode", "auto", "config.json"))).toBe(false)
    expect(await exists(join(dir, ".opencode", "auto", "brief.md"))).toBe(false)
    expect(await exists(join(dir, ".opencode", "agent", "auto.md"))).toBe(false)
    expect(await exists(join(dir, "opencode.json"))).toBe(false)
    expect(await exists(join(dir, "AGENTS.md"))).toBe(false)
    expect(await readdir(dir)).toEqual([])
  })

  test("an uninitialized directory: the list is empty, no error", async () => {
    expect(await planReset(dir)).toEqual([])
  })

  test("idempotent: two resets in a row give the same result", async () => {
    await seedInit(dir)
    await reset(dir)
    expect(await planReset(dir)).toEqual([])
    await reset(dir)
    expect(await readdir(dir)).toEqual([])
  })

  test("the old .auto/config.json belongs to the config layer and goes with it; the rest of .auto/ stays untouched", async () => {
    await seedInit(dir)
    await mkdir(join(dir, ".auto", "logs"), { recursive: true })
    await writeFile(join(dir, ".auto", "config.json"), '{"mode":"migrate"}\n')
    await writeFile(join(dir, ".auto", "stats.json"), '{"tasks":3}\n')
    await writeFile(join(dir, ".auto", "logs", "run.log"), "log\n")
    await reset(dir)
    expect(await exists(join(dir, ".auto", "config.json"))).toBe(false)
    expect(await Bun.file(join(dir, ".auto", "stats.json")).text()).toBe('{"tasks":3}\n')
    expect(await Bun.file(join(dir, ".auto", "logs", "run.log")).text()).toBe("log\n")
  })
})

describe("reset: boundary safety", () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-reset-"))
    await seedInit(dir)
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  // plans/0052 D9 (DF6): the brief is human intent; only the untouched stub is init's.
  test("a filled brief.md is kept; the untouched stub is removed", async () => {
    await writeFile(join(dir, ".opencode", "auto", "brief.md"), `${renderProjectBrief()}\nMigrate legacy/pkg to app/.\n`)
    const entries = await reset(dir)
    expect(entries.find((entry) => entry.path === ".opencode/auto/brief.md")).toMatchObject({ action: "keep", reason: "filled in, not the init stub, kept" })
    expect(await Bun.file(join(dir, ".opencode", "auto", "brief.md")).text()).toContain("Migrate legacy/pkg to app/.")
    expect(await exists(join(dir, ".opencode", "auto", "config.json"))).toBe(false)
  })

  test("an opencode.json that was modified is kept (byte-for-byte comparison with the template)", async () => {
    await writeFile(join(dir, "opencode.json"), '{"model":"my own config"}\n')
    const entries = await reset(dir)
    expect(entries.find((entry) => entry.path === "opencode.json")).toMatchObject({ action: "keep" })
    expect(await Bun.file(join(dir, "opencode.json")).text()).toBe('{"model":"my own config"}\n')
  })

  test("a .opencode/auto/prompts/ the user created is not reclaimed", async () => {
    await mkdir(join(dir, ".opencode", "auto", "prompts"), { recursive: true })
    await writeFile(join(dir, ".opencode", "auto", "prompts", "whole.md"), "my override template\n")
    await reset(dir)
    expect(await Bun.file(join(dir, ".opencode", "auto", "prompts", "whole.md")).text()).toBe("my override template\n")
    expect(await exists(join(dir, ".opencode", "auto", "config.json"))).toBe(false)
  })

  test("the user's own other agent contracts are not reclaimed", async () => {
    await writeFile(join(dir, ".opencode", "agent", "reviewer.md"), "# reviewer\n")
    await reset(dir)
    expect(await Bun.file(join(dir, ".opencode", "agent", "reviewer.md")).text()).toBe("# reviewer\n")
    expect(await exists(join(dir, ".opencode", "agent", "auto.md"))).toBe(false)
  })

  test("AGENTS.md holding user-written prose: only the marker block is stripped, the prose is kept as-is", async () => {
    const text = await Bun.file(join(dir, "AGENTS.md")).text()
    await writeFile(join(dir, "AGENTS.md"), `# AGENTS.md\n\n## My conventions\n\nIndent with two spaces.\n\n${text.split("\n\n").slice(1).join("\n\n")}`)
    const entries = await reset(dir)
    expect(entries.find((entry) => entry.path === "AGENTS.md")).toMatchObject({ action: "strip" })
    const after = await Bun.file(join(dir, "AGENTS.md")).text()
    expect(after).toContain("Indent with two spaces.")
    expect(after).not.toContain("opencode-auto:start")
  })

  test(".gitignore: the user's own entries are kept, only tmp/ and .auto/ are removed", async () => {
    await writeFile(join(dir, ".gitignore"), "node_modules/\ntmp/\n.auto/\n*.log\n")
    const entries = await reset(dir)
    expect(entries.find((entry) => entry.path === ".gitignore")).toMatchObject({ action: "strip" })
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("node_modules/\n*.log\n")
  })

  test("PLAN.md, docs/ and tmp/ are never touched", async () => {
    await mkdir(join(dir, "docs", "R-01"), { recursive: true })
    await mkdir(join(dir, "tmp"), { recursive: true })
    await writeFile(join(dir, "PLAN.md"), "## T-001: my task [pending]\n")
    await writeFile(join(dir, "docs", "R-01", "phases.md"), "- [done] a\n")
    await writeFile(join(dir, "tmp", "verify.sh"), "#!/bin/sh\n")
    await reset(dir)
    expect(await Bun.file(join(dir, "PLAN.md")).text()).toBe("## T-001: my task [pending]\n")
    expect(await Bun.file(join(dir, "docs", "R-01", "phases.md")).text()).toBe("- [done] a\n")
    expect(await Bun.file(join(dir, "tmp", "verify.sh")).text()).toBe("#!/bin/sh\n")
  })

  // plans/0055 §4.1: the model registry's project layer is the operator's file,
  // never the driver's, so reset takes back init's entry for it and keeps it.
  test("the model registry's project layer: its .gitignore entry is removed, the file and its directory stay", async () => {
    await Bun.spawn(["git", "-C", dir, "init", "-q"]).exited
    await writeFile(join(dir, ".gitignore"), "node_modules/\n")
    expect(await ensureInitGitignore(dir)).toContain("/.opencode/auto/models.json")
    const registry = '{ "models": {} }\n'
    await writeFile(join(dir, MODELS_FILE), registry)
    const entries = await reset(dir)
    expect(entries.map((entry) => entry.path)).not.toContain(MODELS_FILE)
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("node_modules/\n")
    expect(await Bun.file(join(dir, MODELS_FILE)).text()).toBe(registry)
    expect(await exists(join(dir, ".opencode", "auto", "config.json"))).toBe(false)
  })

  test("planReset only computes, never deletes: the files are still there once the list is drawn up", async () => {
    const entries = await planReset(dir)
    expect(entries.length).toBeGreaterThan(0)
    expect(await exists(join(dir, ".opencode", "auto", "config.json"))).toBe(true)
    expect(await exists(join(dir, "opencode.json"))).toBe(true)
    expect(await exists(join(dir, "AGENTS.md"))).toBe(true)
  })
})

describe("removeGitignoreEntries", () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-reset-gi-"))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("no file: nothing happens", async () => {
    expect(await removeGitignoreEntries(dir)).toEqual({ removed: false, emptied: false })
  })

  test("only the two driver entries left: the whole file is deleted", async () => {
    await writeFile(join(dir, ".gitignore"), "tmp/\n.auto/\n")
    expect(await removeGitignoreEntries(dir)).toEqual({ removed: true, emptied: true })
    expect(await exists(join(dir, ".gitignore"))).toBe(false)
  })

  test("normalized comparison: the /tmp and .auto spellings are removed as well", async () => {
    await writeFile(join(dir, ".gitignore"), "/tmp\n.auto\nkeep/\n")
    expect(await removeGitignoreEntries(dir)).toEqual({ removed: true, emptied: false })
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("keep/\n")
  })

  test("dryRun only computes, never writes", async () => {
    await writeFile(join(dir, ".gitignore"), "tmp/\nkeep/\n")
    expect(await removeGitignoreEntries(dir, { dryRun: true })).toEqual({ removed: true, emptied: false })
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("tmp/\nkeep/\n")
  })

  test("the inverse of ensureGitignore: add back, then remove, back to the original state", async () => {
    await writeFile(join(dir, ".gitignore"), "node_modules/\n")
    expect(await ensureGitignore(dir)).toBe(true)
    await removeGitignoreEntries(dir)
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("node_modules/\n")
  })

  test("the init entries are removed too (local-only files and nested repository entries); the user's own entries are kept", async () => {
    await Bun.spawn(["git", "-C", dir, "init", "-q"]).exited
    await mkdir(join(dir, "pkg"))
    await Bun.spawn(["git", "-C", join(dir, "pkg"), "init", "-q"]).exited
    await writeFile(join(dir, ".gitignore"), "node_modules/\n")
    expect(await ensureInitGitignore(dir)).toEqual(["tmp/", ".auto/", "/.gitignore", "/.env", "/AGENTS.md", "/opencode.json", "/.opencode/auto/models.json", "/pkg/"])
    expect(await removeGitignoreEntries(dir)).toEqual({ removed: true, emptied: false })
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("node_modules/\n")
  })

  test("a file holding only init entries is deleted whole", async () => {
    await writeFile(join(dir, ".gitignore"), "tmp/\n.auto/\n/.gitignore\n/.env\n/AGENTS.md\n/opencode.json\n/.opencode/auto/models.json\n")
    expect(await removeGitignoreEntries(dir)).toEqual({ removed: true, emptied: true })
    expect(await exists(join(dir, ".gitignore"))).toBe(false)
  })
})

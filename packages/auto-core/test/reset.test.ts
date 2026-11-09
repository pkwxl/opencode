import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import templateConfig from "../templates/opencode.json" with { type: "file" }
import { ensurePointer } from "../src/agents-block"
import { ensureGitignore, ensureInitGitignore, removeGitignoreEntries } from "../src/gitignore"
import { MODELS_FILE } from "../src/models"
import { applyReset, planReset, type ResetEntry } from "../src/reset"

// A minimal replica of init's output (without running the real CLI): the
// four config-layer files + the two shared files + the gitignore entries.
async function seedInit(dir: string) {
  await mkdir(join(dir, ".opencode", "auto"), { recursive: true })
  await mkdir(join(dir, ".opencode", "agent"), { recursive: true })
  await writeFile(join(dir, ".opencode", "auto", "config.json"), '{"mode":"migrate"}\n')
  // The brief seed (plans/0081 D11): a plain init writes none, the fixture
  // seeds one like --brief would.
  await writeFile(join(dir, ".opencode", "auto", "brief.md"), "migrate legacy to bun\n")
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

  test("removes every config-layer artifact except the brief; once reclaimed, only the brief's tree remains", async () => {
    await seedInit(dir)
    await reset(dir)
    expect(await exists(join(dir, ".opencode", "auto", "config.json"))).toBe(false)
    // The brief is kept (plans/0081 D11: a seed or a generated brief; delete
    // it by hand if you mean to).
    expect(await exists(join(dir, ".opencode", "auto", "brief.md"))).toBe(true)
    expect(await exists(join(dir, ".opencode", "agent", "auto.md"))).toBe(false)
    expect(await exists(join(dir, "opencode.json"))).toBe(false)
    expect(await exists(join(dir, "AGENTS.md"))).toBe(false)
    expect(await readdir(dir)).toEqual([".opencode"])
  })

  test("an uninitialized directory: the list is empty, no error", async () => {
    expect(await planReset(dir)).toEqual([])
  })

  test("idempotent: two resets in a row give the same result (the kept brief survives both)", async () => {
    await seedInit(dir)
    await reset(dir)
    // The kept brief keeps .opencode/auto/ non-empty: the residual plan holds
    // only keep and rmdir-if-empty entries, and the second reset removes
    // nothing more.
    const residual = await planReset(dir)
    expect(residual.map((entry) => entry.action)).toEqual(["keep", "rmdir", "rmdir"])
    await reset(dir)
    expect(await readdir(dir)).toEqual([".opencode"])
    expect(await exists(join(dir, ".opencode", "auto", "brief.md"))).toBe(true)
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

  // plans/0081 D11: the stub and its remove-while-stub rule retired — every
  // brief (an installed approved proposal or a person's amend --brief write) is kept.
  test("the brief is always kept (a seed or a generated brief alike)", async () => {
    await writeFile(join(dir, ".opencode", "auto", "brief.md"), "Migrate legacy/pkg to app/.\n")
    const entries = await reset(dir)
    expect(entries.find((entry) => entry.path === ".opencode/auto/brief.md")).toMatchObject({ action: "keep", reason: "the project brief (an installed approved proposal or a person's amend --brief write) is kept; delete it by hand if you mean to" })
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
    expect(await ensureInitGitignore(dir)).toEqual(["tmp/", ".auto/", "/.env", "/AGENTS.md", "/.opencode/auto/models.json", "/pkg/"])
    expect(await removeGitignoreEntries(dir)).toEqual({ removed: true, emptied: false })
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("node_modules/\n")
  })

  test("a file holding only init entries is deleted whole", async () => {
    await writeFile(join(dir, ".gitignore"), "tmp/\n.auto/\n/.env\n/AGENTS.md\n/.opencode/auto/models.json\n")
    expect(await removeGitignoreEntries(dir)).toEqual({ removed: true, emptied: true })
    expect(await exists(join(dir, ".gitignore"))).toBe(false)
  })

  // plans/0138: the retired /.gitignore and /opencode.json lines are a
  // pre-0138 init's, and their retirement is fix's rule — reset mirrors the
  // current init and leaves them as the person's own entries.
  test("a pre-0138 init's retired entries survive reset (fix owns their retirement)", async () => {
    await Bun.spawn(["git", "-C", dir, "init", "-q"]).exited
    await writeFile(join(dir, ".gitignore"), "tmp/\n.auto/\n/.gitignore\n/.env\n/AGENTS.md\n/opencode.json\n/.opencode/auto/models.json\n")
    expect(await removeGitignoreEntries(dir)).toEqual({ removed: true, emptied: false })
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("/.gitignore\n/opencode.json\n")
  })
})

// plans/0239 D2 (finding 0165-208): the person's bytes stand — the driver's
// rewrite reaches exactly its own lines. removePointer cleans only the seam
// each removal creates (the blank-line run where the block stood collapses
// to at most one blank line; a seam ending the file normalizes the tail to
// one newline); the .gitignore strip writes the kept lines verbatim; a
// stale nested-repository entry is reported, never stripped.
describe("reset: the person's bytes stand (plans/0239 D2)", () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-reset-person-"))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("AGENTS.md: a deliberate 3+ blank-line run away from the block keeps its bytes through the strip", async () => {
    await ensurePointer(dir)
    const text = await Bun.file(join(dir, "AGENTS.md")).text()
    const block = text.slice(text.indexOf("<!-- opencode-auto:start -->"))
    const before = "# My notes\n\nIntro.\n\n\n\nWide gap — mine to keep.\n\nTail prose.\n\n"
    await writeFile(join(dir, "AGENTS.md"), before + block)
    const entries = await reset(dir)
    expect(entries.find((entry) => entry.path === "AGENTS.md")).toMatchObject({ action: "strip" })
    // The seam where the block stood (at the file's end) normalizes its tail
    // to one newline; the wide gap three paragraphs earlier keeps all three
    // of its blank lines.
    const after = await Bun.file(join(dir, "AGENTS.md")).text()
    expect(after).toBe("# My notes\n\nIntro.\n\n\n\nWide gap — mine to keep.\n\nTail prose.\n")
  })

  test("AGENTS.md: leading blank lines and a mid-file seam (prose continues after the block)", async () => {
    await ensurePointer(dir)
    const text = await Bun.file(join(dir, "AGENTS.md")).text()
    const block = text.slice(text.indexOf("<!-- opencode-auto:start -->"))
    // Leading blank lines the person wrote, the block mid-file, prose after.
    await writeFile(join(dir, "AGENTS.md"), "\n\n# Heading\n\nBefore.\n\n" + block + "\nAfter.\n\n\n")
    const entries = await reset(dir)
    expect(entries.find((entry) => entry.path === "AGENTS.md")).toMatchObject({ action: "strip" })
    const after = await Bun.file(join(dir, "AGENTS.md")).text()
    // The seam (one blank line before the block + the block's own line
    // break) collapses to one blank line; everything else keeps its bytes.
    expect(after).toBe("\n\n# Heading\n\nBefore.\n\nAfter.\n\n\n")
  })

  test("AGENTS.md: a file the strip empties to the heading shell still reports emptied", async () => {
    await ensurePointer(dir)
    const entries = await reset(dir)
    expect(entries.find((entry) => entry.path === "AGENTS.md")).toMatchObject({ action: "remove" })
    expect(await exists(join(dir, "AGENTS.md"))).toBe(false)
  })

  test(".gitignore: the person's leading and trailing blank lines survive the strip", async () => {
    await writeFile(join(dir, ".gitignore"), "\n\n# mine\ntmp/\n.auto/\ndist/\n\n\n")
    const entries = await reset(dir)
    expect(entries.find((entry) => entry.path === ".gitignore")).toMatchObject({ action: "strip" })
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("\n\n# mine\ndist/\n\n\n")
  })

  test(".gitignore: a stale nested-repository entry is reported, never stripped", async () => {
    await Bun.spawn(["git", "-C", dir, "init", "-q"]).exited
    // init stamped /pkg/ for a repository that has since been deleted; the
    // person's /live-dir/ entry points at a real directory and is not
    // reported even though nothing git lives in it.
    await mkdir(join(dir, "live-dir"))
    await writeFile(join(dir, ".gitignore"), "tmp/\n.auto/\n/pkg/\n/live-dir/\n")
    const entries = await reset(dir)
    const gitignore = entries.find((entry) => entry.path === ".gitignore")
    expect(gitignore).toMatchObject({ action: "strip" })
    expect(gitignore?.reason).toContain("nested-repository-shaped line(s) whose directories no longer exist (/pkg/)")
    expect(gitignore?.reason).toContain("never stripped")
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("/pkg/\n/live-dir/\n")
  })

  test(".gitignore: stale lines alone still surface (a keep entry, nothing to strip)", async () => {
    await writeFile(join(dir, ".gitignore"), "/gone-repo/\n*.log\n")
    const entries = await planReset(dir)
    const gitignore = entries.find((entry) => entry.path === ".gitignore")
    expect(gitignore).toMatchObject({ action: "keep" })
    expect(gitignore?.reason).toContain("(/gone-repo/)")
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("/gone-repo/\n*.log\n")
  })
})

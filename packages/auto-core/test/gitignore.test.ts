import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  ensureGitignore,
  ensureInitGitignore,
  ensureModelsGitignore,
  ensureNestedGitignore,
  ENTRIES,
  MODELS_ENTRY,
  removeGitignoreEntry,
  retiredGitignoreEntries,
  RETIRED_ENTRIES,
  staleNestedEntryLines,
} from "../src/gitignore"
import { WORKDIR_ROOTS } from "../src/git"
import { MODELS_FILE } from "../src/models"

const gitInit = (cwd: string) => Bun.spawnSync(["git", "init", "-q"], { cwd })

describe("ensureGitignore", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-gitignore-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("a non-git directory (no .git and no .gitignore) does nothing", async () => {
    expect(await ensureGitignore(dir)).toBe(false)
    expect(await Bun.file(join(dir, ".gitignore")).exists()).toBe(false)
  })

  test("a git repository: missing entries are appended, repeated calls are idempotent", async () => {
    gitInit(dir)
    expect(await ensureGitignore(dir)).toBe(true)
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("tmp/\n.auto/\n")
    expect(await ensureGitignore(dir)).toBe(false)
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("tmp/\n.auto/\n")
  })

  test("a subdirectory of a larger repository (no .git/.gitignore of its own) is filled in too (2026-09-17 review H5)", async () => {
    gitInit(dir)
    const sub = join(dir, "packages", "sub")
    await mkdir(sub, { recursive: true })
    expect(await ensureGitignore(sub)).toBe(true)
    expect(await Bun.file(join(sub, ".gitignore")).text()).toBe("tmp/\n.auto/\n")
  })

  test("existing equivalent entries (slash-less / with a leading slash) are not appended again", async () => {
    await writeFile(join(dir, ".gitignore"), "node_modules\n/tmp/\n")
    expect(await ensureGitignore(dir)).toBe(true)
    const text = await Bun.file(join(dir, ".gitignore")).text()
    expect(text).toBe("node_modules\n/tmp/\n.auto/\n")
    expect(await ensureGitignore(dir)).toBe(false)
  })

  test("no .git but an existing .gitignore is maintained too", async () => {
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
    expect(await ensureInitGitignore(dir)).toEqual(["tmp/", ".auto/", "/.env", "/AGENTS.md", "/.opencode/auto/models.json"])
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("tmp/\n.auto/\n/.env\n/AGENTS.md\n/.opencode/auto/models.json\n")
    expect(await ensureInitGitignore(dir)).toEqual([])
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("tmp/\n.auto/\n/.env\n/AGENTS.md\n/.opencode/auto/models.json\n")
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
    expect(await ensureInitGitignore(dir)).toEqual(["tmp/", ".auto/", "/.opencode/auto/models.json"])
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("node_modules\n.env\nAGENTS.md\ntmp/\n.auto/\n/.opencode/auto/models.json\n")
  })

  test("the model registry's project layer entry is the registry's own path", () => {
    expect(MODELS_ENTRY).toBe(`/${MODELS_FILE}`)
  })

  // plans/0141 D1: the unit start gate's workdir exemption spells the roots
  // in git.ts (which cannot import this module back) — the pin keeps the two
  // spellings one law.
  test("the gate's WORKDIR_ROOTS are exactly the ignore set's workdir entries", () => {
    expect(WORKDIR_ROOTS.map((root) => `${root}/`)).toEqual(ENTRIES)
  })
})

// fix's rule for a project initialized before init ignored the model
// registry's project layer (plans/0055 §4.1). The fixture is a pre-0138
// .gitignore (it still holds the retired entries — the models rule appends
// its one entry and never strips; the retirement rules live below).
describe("ensureModelsGitignore", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-gitignore-models-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("an older init's .gitignore gets the one entry; dryRun only reports; a second call is a no-op", async () => {
    gitInit(dir)
    const older = "tmp/\n.auto/\n/.gitignore\n/.env\n/AGENTS.md\n/opencode.json\n"
    await writeFile(join(dir, ".gitignore"), older)
    expect(await ensureModelsGitignore(dir, { dryRun: true })).toBe(true)
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe(older)
    expect(await ensureModelsGitignore(dir)).toBe(true)
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe(`${older}/.opencode/auto/models.json\n`)
    expect(await ensureModelsGitignore(dir)).toBe(false)
  })

  test("the other local-only entries are left to the person; an equivalent spelling counts", async () => {
    gitInit(dir)
    await writeFile(join(dir, ".gitignore"), "node_modules\n")
    expect(await ensureModelsGitignore(dir)).toBe(true)
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("node_modules\n/.opencode/auto/models.json\n")
    await writeFile(join(dir, ".gitignore"), ".opencode/auto/models.json\n")
    expect(await ensureModelsGitignore(dir)).toBe(false)
  })

  test("a non-git directory without a .gitignore is left alone", async () => {
    expect(await ensureModelsGitignore(dir)).toBe(false)
    expect(await Bun.file(join(dir, ".gitignore")).exists()).toBe(false)
  })
})

// fix's rule for the nested repositories (plans/0138): init stamps the set at
// init time; a repository that appears later gets its entry appended.
describe("ensureNestedGitignore", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-gitignore-nested-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("a nested repository that appeared after init gets its entry; dryRun only reports; idempotent", async () => {
    gitInit(dir)
    await writeFile(join(dir, ".gitignore"), "tmp/\n.auto/\n")
    await mkdir(join(dir, "vendor", "pkg"), { recursive: true })
    gitInit(join(dir, "vendor", "pkg"))
    expect(await ensureNestedGitignore(dir, { dryRun: true })).toEqual(["/vendor/pkg/"])
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("tmp/\n.auto/\n")
    expect(await ensureNestedGitignore(dir)).toEqual(["/vendor/pkg/"])
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("tmp/\n.auto/\n/vendor/pkg/\n")
    expect(await ensureNestedGitignore(dir)).toEqual([])
  })

  test("a tree without nested repositories appends nothing", async () => {
    gitInit(dir)
    await writeFile(join(dir, ".gitignore"), "tmp/\n.auto/\n")
    expect(await ensureNestedGitignore(dir)).toEqual([])
  })
})

// The retired entries (plans/0138): the pre-0138 local-only ruling ignored
// the .gitignore itself and opencode.json — the two lines fix's findings key
// on, the self-entry stripped by rule, the opencode.json line the person's.
describe("retiredGitignoreEntries / removeGitignoreEntry", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-gitignore-retired-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("a pre-0138 file reports both entries; a current file or a missing file reports none", async () => {
    await writeFile(join(dir, ".gitignore"), "tmp/\n.auto/\n/.gitignore\n/.env\n/AGENTS.md\n/opencode.json\n/.opencode/auto/models.json\n")
    expect(await retiredGitignoreEntries(dir)).toEqual(RETIRED_ENTRIES)
    await writeFile(join(dir, ".gitignore"), "tmp/\n.auto/\n/.env\n/AGENTS.md\n/.opencode/auto/models.json\n")
    expect(await retiredGitignoreEntries(dir)).toEqual([])
    await rm(join(dir, ".gitignore"))
    expect(await retiredGitignoreEntries(dir)).toEqual([])
  })

  test("the strip removes one entry's line, keeps the rest, and empties a file that held only it; dryRun reports without writing", async () => {
    await writeFile(join(dir, ".gitignore"), "node_modules/\n/.gitignore\n/opencode.json\n")
    expect(await removeGitignoreEntry(dir, "/.gitignore", { dryRun: true })).toBe(true)
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("node_modules/\n/.gitignore\n/opencode.json\n")
    expect(await removeGitignoreEntry(dir, "/.gitignore")).toBe(true)
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("node_modules/\n/opencode.json\n")
    expect(await removeGitignoreEntry(dir, "/.gitignore")).toBe(false)
    // An equivalent spelling (slash-less) counts as the same entry.
    await writeFile(join(dir, ".gitignore"), "opencode.json\n")
    expect(await removeGitignoreEntry(dir, "/opencode.json")).toBe(true)
    expect(await Bun.file(join(dir, ".gitignore")).exists()).toBe(false)
  })
})

// plans/0239 D2b/D2d (finding 0165-208): the append preserves the person's
// trailing blank lines (a newline is added only when their last line lacks
// one — the driver's entries need a fresh line, nothing more), and the
// stale-nested reader reports exactly the grammar-shaped lines whose
// directories no longer exist.
describe("the person's bytes stand (plans/0239 D2b/D2d)", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-gitignore-person-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("an append over trailing blank lines keeps them byte-identical", async () => {
    gitInit(dir)
    await writeFile(join(dir, ".gitignore"), "# mine\ndist/\n\n\n")
    expect(await ensureGitignore(dir)).toBe(true)
    // The person's two trailing blank lines stand; the entries follow on
    // their own fresh line.
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("# mine\ndist/\n\n\ntmp/\n.auto/\n")
  })

  test("an append over a last line without a newline adds exactly one", async () => {
    gitInit(dir)
    await writeFile(join(dir, ".gitignore"), "# mine")
    expect(await ensureGitignore(dir)).toBe(true)
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("# mine\ntmp/\n.auto/\n")
  })

  test("staleNestedEntryLines: exactly the grammar-shaped lines whose directories are gone", async () => {
    await mkdir(join(dir, "live"), { recursive: true })
    await writeFile(join(dir, ".gitignore"), "/gone-repo/\n/live/\n/pkg/nested/\nnode_modules/\n*.log\n/opencode.json\n")
    expect(await staleNestedEntryLines(dir)).toEqual(["/gone-repo/", "/pkg/nested/"])
  })

  test("staleNestedEntryLines: no file, nothing reported", async () => {
    expect(await staleNestedEntryLines(dir)).toEqual([])
  })
})

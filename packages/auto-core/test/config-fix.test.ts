import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import templateConfig from "../templates/opencode.json" with { type: "file" }
import { ensurePointer } from "../src/agents-block"
import { appendToSection, projectBriefText, renderProjectBrief } from "../src/brief"
import { CONFIG_DEFAULTS, loadProjectConfig, saveConfigRecord } from "../src/config"
import { applyFix, fixHint, formatFixPlan, planFix, renderAgentContract, type FixPlan } from "../src/config-fix"

const CONFIG = ".opencode/auto/config.json"
const BRIEF = ".opencode/auto/brief.md"

// What a plain init leaves behind (outside git, so no .gitignore).
async function seedInit(dir: string, record: object = CONFIG_DEFAULTS) {
  await saveConfigRecord(dir, record)
  await Bun.write(join(dir, ".opencode/agent/auto.md"), await renderAgentContract(false))
  await Bun.write(join(dir, "opencode.json"), await Bun.file(templateConfig).text())
  await Bun.write(join(dir, BRIEF), renderProjectBrief())
  await ensurePointer(dir)
}

const readConfig = async (dir: string) => JSON.parse(await Bun.file(join(dir, CONFIG)).text())
const fixable = (plan: FixPlan) => plan.findings.filter((finding) => finding.class === "fixable")
const manual = (plan: FixPlan) => plan.findings.filter((finding) => finding.class === "manual")

describe("project brief (plans/0052 D9)", () => {
  test("an untouched stub injects nothing; a filled one injects its text without the hints", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-brief-"))
    try {
      expect(await projectBriefText(dir)).toBeUndefined()
      await Bun.write(join(dir, BRIEF), renderProjectBrief())
      expect(await projectBriefText(dir)).toBeUndefined()
      await Bun.write(join(dir, BRIEF), appendToSection(renderProjectBrief(), "## Source", "legacy/pkg"))
      const text = (await projectBriefText(dir))!
      expect(text).toContain("## Source\n\nlegacy/pkg")
      expect(text).not.toContain("<!--")
      // A brief written by init -p has no headings at all.
      await Bun.write(join(dir, BRIEF), "migrate legacy to bun\n")
      expect(await projectBriefText(dir)).toBe("migrate legacy to bun")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the stub's hints keep deliverables out of docs/ and .opencode/", () => {
    const stub = renderProjectBrief()
    for (const heading of ["## Goal", "## Source", "## Target", "## Constraints"]) expect(stub).toContain(`\n${heading}\n`)
    expect(stub).toContain("Keep deliverables out of docs/ and\n     .opencode/")
  })

  test("appendToSection: end of the section, before the next heading; heading added when absent", () => {
    const text = "# Brief\n\n## Source\n\n<!-- hint -->\n\n## Target\n\nkeep\n"
    expect(appendToSection(text, "## Source", "- a")).toBe("# Brief\n\n## Source\n\n<!-- hint -->\n\n- a\n\n## Target\n\nkeep\n")
    expect(appendToSection(text, "## Target", "- b")).toBe("# Brief\n\n## Source\n\n<!-- hint -->\n\n## Target\n\nkeep\n\n- b\n")
    expect(appendToSection("migrate it\n", "## Source", "- a")).toBe("migrate it\n\n## Source\n\n- a\n")
    expect(appendToSection("", "## Source", "- a")).toBe("## Source\n\n- a\n")
  })
})

describe("planFix / applyFix (plans/0052 D10)", () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-fix-"))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("no config.json and no legacy mode: uninitialized, nothing planned", async () => {
    expect(await planFix(dir)).toEqual({ uninitialized: true, findings: [], writes: [] })
  })

  test("a consistent config layer has no findings", async () => {
    await seedInit(dir)
    const plan = await planFix(dir)
    expect(plan.findings).toEqual([])
    expect(plan.skipped).toBeUndefined()
  })

  test("retired keys are dropped, renamed or moved; other keys, unknown keys included, survive", async () => {
    await seedInit(dir, {
      mode: "migrate",
      contextLimit: 32,
      commit: false,
      verify: false,
      agent: "build",
      verifyIdle: 15,
      verifyMax: 30,
      idleMax: 60,
      source: { dir: "legacy", path: "pkg" },
      destDir: "app",
      futureKey: "kept",
    })
    await Bun.write(join(dir, BRIEF), `${renderProjectBrief()}\nMigrate the parser first.\n`)
    const plan = await planFix(dir)
    expect(manual(plan)).toEqual([])
    expect(plan.skipped).toBeUndefined()
    const text = formatFixPlan(plan)
    expect(text).toContain("  fix: .opencode/auto/config.json: commit: false is retired (unified commit is a completion condition) → drop the key")
    expect(text).toContain("verify: false is retired")
    expect(text).toContain('agent "build" is a retired agent contract name')
    expect(text).toContain("verifyIdle was renamed to idleTime → rename it to idleTime")
    expect(text).toContain("verifyMax was renamed to idleMax, which is also set → drop the key")
    expect(text).toContain("source is retired (the migration source and target are intent, not configuration) → move its value into .opencode/auto/brief.md under ## Source, then drop the key")
    expect(text).toContain("destDir is retired")
    await applyFix(plan)
    expect(await readConfig(dir)).toEqual({ mode: "migrate", contextLimit: 32, idleTime: 15, idleMax: 60, futureKey: "kept" })
    const brief = await Bun.file(join(dir, BRIEF)).text()
    expect(brief).toContain("## Source\n\n<!--")
    expect(brief).toContain("- Source-system directory (relative to the working directory): `legacy`\n- Source-module path (relative to the source-system directory): `pkg`\n\n## Target")
    expect(brief).toContain("- Migration-target directory (relative to the working directory): `app` — migrated code is written here\n\n## Constraints")
    expect(brief).toContain("Migrate the parser first.")
    expect(await loadProjectConfig(dir)).toMatchObject({ contextLimit: 32, idleTime: 15, idleMax: 60 })
    // Idempotent: a second pass finds nothing.
    expect((await planFix(dir)).findings).toEqual([])
  })

  test("moving source into a missing brief starts from the stub", async () => {
    await seedInit(dir, { ...CONFIG_DEFAULTS, source: { dir: "legacy", path: "pkg" } })
    await rm(join(dir, BRIEF))
    const plan = await planFix(dir)
    expect(plan.findings.map((finding) => finding.path)).toEqual([CONFIG])
    await applyFix(plan)
    const brief = await Bun.file(join(dir, BRIEF)).text()
    expect(brief.startsWith(renderProjectBrief().split("## Source")[0]!)).toBe(true)
    expect(brief).toContain("`legacy`")
    expect(await readConfig(dir)).not.toHaveProperty("source")
  })

  test("a legacy .auto/config.json mode with no config.json: config.json is written", async () => {
    await mkdir(join(dir, ".auto"), { recursive: true })
    await writeFile(join(dir, ".auto/config.json"), '{"mode":"migrate"}\n')
    const plan = await planFix(dir)
    expect(plan.uninitialized).toBe(false)
    expect(formatFixPlan(plan)).toContain('fix: .opencode/auto/config.json: missing; the legacy .auto/config.json holds mode "migrate" → write it with mode "migrate" and the defaults')
    await applyFix(plan)
    expect(await readConfig(dir)).toEqual(CONFIG_DEFAULTS)
    // The artifacts it lacks are planned in the same pass.
    expect((await planFix(dir)).findings).toEqual([])
  })

  test("manual findings are reported only, and the artifact rules are skipped", async () => {
    await seedInit(dir, { commit: false, handoverTest: true })
    await rm(join(dir, ".opencode/agent/auto.md"))
    const plan = await planFix(dir)
    expect(fixable(plan).map((finding) => finding.problem)).toEqual(["commit: false is retired (unified commit is a completion condition)"])
    expect(manual(plan)).toEqual([{ class: "manual", path: CONFIG, problem: "handoverTest requires testByDriver: true" }])
    expect(plan.skipped).toBe(".opencode/auto/config.json does not load")
    expect(formatFixPlan(plan)).toContain("  skipped: the agent contract, AGENTS.md block, .gitignore, opencode.json and brief checks (.opencode/auto/config.json does not load)")
    await applyFix(plan)
    expect(await readConfig(dir)).not.toHaveProperty("commit")
    expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).exists()).toBe(false)
  })

  test("invalid JSON is manual; nothing is written", async () => {
    await seedInit(dir)
    await writeFile(join(dir, CONFIG), "{ not json")
    const plan = await planFix(dir)
    expect(manual(plan)[0]!.problem).toStartWith("not valid JSON")
    expect(plan.writes).toEqual([])
    expect(plan.skipped).toBe(".opencode/auto/config.json does not parse")
  })

  test("artifact rules: missing or stale artifacts are rewritten; opencode.json and brief.md only when missing", async () => {
    await seedInit(dir, { ...CONFIG_DEFAULTS, testByDriver: true })
    await rm(join(dir, "opencode.json"))
    await rm(join(dir, BRIEF))
    const agents = await Bun.file(join(dir, "AGENTS.md")).text()
    await writeFile(join(dir, "AGENTS.md"), `${agents}\n<!-- opencode-auto:old:start -->\nstale\n<!-- opencode-auto:old:end -->\n`)
    const plan = await planFix(dir)
    expect(plan.findings.map((finding) => `${finding.path}: ${finding.problem}`)).toEqual([
      ".opencode/agent/auto.md: differs from the template rendered for testByDriver = true",
      "AGENTS.md: the opencode-auto block differs from the current config render; 1 legacy/stray opencode-auto marker block(s)",
      "opencode.json: missing",
      ".opencode/auto/brief.md: missing",
    ])
    await applyFix(plan)
    expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).text()).toBe(await renderAgentContract(true))
    expect(await Bun.file(join(dir, "AGENTS.md")).text()).not.toContain("opencode-auto:old")
    expect(await Bun.file(join(dir, BRIEF)).text()).toBe(renderProjectBrief())
    expect((await planFix(dir)).findings).toEqual([])
    // A person's opencode.json is never compared, only written when missing.
    await writeFile(join(dir, "opencode.json"), '{"model":"mine"}\n')
    expect((await planFix(dir)).findings).toEqual([])
  })

  test("inside git, a .gitignore without the driver entries is fixable", async () => {
    await seedInit(dir)
    expect((await Bun.spawn(["git", "-C", dir, "init", "-q"]).exited)).toBe(0)
    const plan = await planFix(dir)
    expect(plan.findings).toEqual([
      { class: "fixable", path: ".gitignore", problem: "lacks the tmp/ or .auto/ entry", change: "append the missing entries" },
      {
        class: "fixable",
        path: ".gitignore",
        problem: "lacks the /.opencode/auto/models.json entry (the model registry's project layer is local-only)",
        change: "append the entry",
      },
    ])
    await applyFix(plan)
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("tmp/\n.auto/\n/.opencode/auto/models.json\n")
  })

  // plans/0055 §4.1: a project initialized before init ignored the model
  // registry's project layer gets the entry, and nothing else changes.
  test("an older init's .gitignore without the project layer entry: fix appends it and names it in the plan", async () => {
    await seedInit(dir, { ...CONFIG_DEFAULTS, contextLimit: 128, custom: "kept" })
    expect((await Bun.spawn(["git", "-C", dir, "init", "-q"]).exited)).toBe(0)
    const older = "node_modules/\ntmp/\n.auto/\n/.gitignore\n/.env\n/AGENTS.md\n/opencode.json\n"
    await writeFile(join(dir, ".gitignore"), older)
    const config = await Bun.file(join(dir, CONFIG)).text()
    const plan = await planFix(dir)
    expect(formatFixPlan(plan)).toBe(
      "  fix: .gitignore: lacks the /.opencode/auto/models.json entry (the model registry's project layer is local-only) → append the entry",
    )
    expect(plan.writes.map((write) => write.path)).toEqual([".gitignore"])
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe(older)
    await applyFix(plan)
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe(`${older}/.opencode/auto/models.json\n`)
    expect(await Bun.file(join(dir, CONFIG)).text()).toBe(config)
    expect((await planFix(dir)).findings).toEqual([])
  })

  test("planFix writes nothing", async () => {
    await seedInit(dir, { commit: false })
    await rm(join(dir, ".opencode/agent/auto.md"))
    const before = await Bun.file(join(dir, CONFIG)).text()
    await planFix(dir)
    expect(await Bun.file(join(dir, CONFIG)).text()).toBe(before)
    expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).exists()).toBe(false)
  })

  test("fixHint names fix only when a key rule applies", async () => {
    await seedInit(dir)
    expect(await fixHint(dir)).toBeUndefined()
    await saveConfigRecord(dir, { ...CONFIG_DEFAULTS, destDir: "app" })
    expect(await fixHint(dir)).toBe(`fix: opencode-auto fix ${dir}`)
    await saveConfigRecord(dir, { ...CONFIG_DEFAULTS, contextLimit: 0 })
    expect(await fixHint(dir)).toBeUndefined()
  })
})

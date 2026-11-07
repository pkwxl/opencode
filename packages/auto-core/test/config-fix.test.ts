import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import templateConfig from "../templates/opencode.json" with { type: "file" }
import { ensurePointer } from "../src/agents-block"
import { appendToSection, briefProposal, projectBriefText } from "../src/brief"
import { CONFIG_DEFAULTS, loadProjectConfig, saveConfigRecord } from "../src/config"
import { applyFix, fixHint, formatFixPlan, planFix, renderAgentContract, type FixPlan } from "../src/config-fix"
import { freshRepo, git } from "./fixtures/runner"

const CONFIG = ".opencode/auto/config.json"
const BRIEF = ".opencode/auto/brief.md"

// What a plain init leaves behind (outside git, so no .gitignore). The stub
// retired (plans/0081 D11): a plain init writes no brief — the seed is
// --brief's, the fixture writes one only where a test needs it.
async function seedInit(dir: string, record: object = CONFIG_DEFAULTS) {
  await saveConfigRecord(dir, record)
  await Bun.write(join(dir, ".opencode/agent/auto.md"), await renderAgentContract(false))
  await Bun.write(join(dir, "opencode.json"), await Bun.file(templateConfig).text())
  await ensurePointer(dir)
}

const readConfig = async (dir: string) => JSON.parse(await Bun.file(join(dir, CONFIG)).text())
const fixable = (plan: FixPlan) => plan.findings.filter((finding) => finding.class === "fixable")
const manual = (plan: FixPlan) => plan.findings.filter((finding) => finding.class === "manual")
const info = (plan: FixPlan) => plan.findings.filter((finding) => finding.class === "info")

describe("project brief (plans/0052 D9; the stub retired by plans/0081 D11)", () => {
  test("a missing or comment-only brief injects nothing; a seed or a generated brief injects its text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-brief-"))
    try {
      expect(await projectBriefText(dir)).toBeUndefined()
      await Bun.write(join(dir, BRIEF), "<!-- only a comment -->\n")
      expect(await projectBriefText(dir)).toBeUndefined()
      // A seed (--brief's text, verbatim) has no headings at all.
      await Bun.write(join(dir, BRIEF), "migrate legacy to bun\n")
      expect(await projectBriefText(dir)).toBe("migrate legacy to bun")
      // A generated brief (the installed ## Project brief proposal).
      await Bun.write(join(dir, BRIEF), "## Goal\n\nA clean-room reimplementation.\n")
      const text = (await projectBriefText(dir))!
      expect(text).toContain("## Goal")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("briefProposal: the survey's ## Project brief section body, or undefined (plans/0081 D15.1)", () => {
    expect(briefProposal("# Survey\n\nFork: scope?\n")).toBeUndefined()
    expect(briefProposal("# Survey\n\n## Project brief\n\n\n")).toBeUndefined()
    const survey = [
      "# Survey",
      "",
      "Fork: scope — core only?",
      "",
      "## Project brief",
      "",
      "The goal, the reference location and wall kind, the target,",
      "the constraints that bind every round.",
      "",
      "## Environment",
      "",
      "e2fsprogs missing.",
    ].join("\n")
    expect(briefProposal(survey)).toBe("The goal, the reference location and wall kind, the target,\nthe constraints that bind every round.")
    // Document-level punctuation never installs (plans/0133 D8): a survey
    // whose section is the document's last carries the person's release mark
    // and the eof terminator inside the body — the aster-mig baseline's
    // installed brief the field case.
    const last = ["# Survey", "", "## Project brief", "", "The constants.", "", "Clarified: yes", "", "<!-- auto: eof -->", ""].join("\n")
    expect(briefProposal(last)).toBe("The constants.")
    // Plans/0158: comments strip ahead of the extraction — the round-brief
    // extractor's discipline exactly, the two proposal channels one rule (an
    // editorial comment inside the proposal installs without the comment).
    const commented = ["# Survey", "", "## Project brief", "", "The constants.", "", "<!-- an editorial note, never installed -->", "", "<!-- auto: eof -->", ""].join("\n")
    expect(briefProposal(commented)).toBe("The constants.")
    const hinted = "# Survey\n\n## Project brief\n\n<!-- the stub's hint -->\n\n## Environment\n\ngap.\n"
    expect(briefProposal(hinted)).toBeUndefined()
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

  test("a covering roadmap line records an info note only when its phases diverge from the config key's — agreement is silent, nothing written (plans/0114 D2; 0135 the class; 0136 divergence-only)", async () => {
    await seedInit(dir, { ...CONFIG_DEFAULTS, phases: "mt" })
    // A real divergence, both values named: config "mt", the line "mtv".
    await Bun.write(join(dir, "docs/analysis.md"), ["# Project analysis", "", "- R-01 mtv — port the core", "", "Clarified: yes", ""].join("\n"))
    const plan = await planFix(dir)
    // The note is the whole plan: an expected posture with no person act —
    // never a manual finding whose trailer would send the pen after the one
    // key the design forbids amending.
    expect(plan.findings).toEqual([
      {
        class: "info",
        path: CONFIG,
        problem: 'phases (config "mt"): R-01\'s line establishes "mtv" under the released roadmap of docs/analysis.md — nothing to repair (reshape the round by moving its line)',
      },
    ])
    expect(plan.writes).toEqual([])
    expect(formatFixPlan(plan)).toBe(
      `  info: ${CONFIG}: phases (config "mt"): R-01's line establishes "mtv" under the released roadmap of docs/analysis.md — nothing to repair (reshape the round by moving its line)`,
    )
    // Agreement is the designed state — the line establishes exactly what
    // init stamped — and names nothing (the field case behind 0136).
    await Bun.write(join(dir, "docs/analysis.md"), ["# Project analysis", "", "- R-01 mt — port the core", "", "Clarified: yes", ""].join("\n"))
    expect((await planFix(dir)).findings).toEqual([])
    // Spelling equivalence: a letter preset and its type-id list are one
    // value through the establishment registry, never a divergence.
    await Bun.write(join(dir, "docs/analysis.md"), ["# Project analysis", "", "- R-01 implement,test — port the core", "", "Clarified: yes", ""].join("\n"))
    expect((await planFix(dir)).findings).toEqual([])
    // A line value that does not resolve reads as divergent (fail loud): it
    // is the person's word and establishment will judge it.
    await Bun.write(join(dir, "docs/analysis.md"), ["# Project analysis", "", "- R-01 svai — port the core", "", "Clarified: yes", ""].join("\n"))
    expect(info(await planFix(dir)).map((finding) => finding.problem)).toContain(
      `phases (config "mt"): R-01's line establishes "svai" under the released roadmap of docs/analysis.md — nothing to repair (reshape the round by moving its line)`,
    )
    // The note follows the coverage, not the document: a round the
    // released roadmap does not cover keeps the key as its live authority.
    await Bun.write(join(dir, "docs/analysis.md"), ["# Project analysis", "", "- R-02 mtv — later round", "", "Clarified: yes", ""].join("\n"))
    expect((await planFix(dir)).findings).toEqual([])
    // And an unreleased roadmap never rules.
    await Bun.write(join(dir, "docs/analysis.md"), ["# Project analysis", "", "- R-01 mtv — port the core", ""].join("\n"))
    expect((await planFix(dir)).findings).toEqual([])
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
    await Bun.write(join(dir, BRIEF), "Migrate the parser first.\n")
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
    // The moved keys append their sections to the plain brief (the empty
    // baseline adds each heading at the end, plans/0081 D11: no stub).
    expect(brief).toContain("Migrate the parser first.\n\n## Source\n\n- Source-system directory (relative to the working directory): `legacy`\n- Source-module path (relative to the source-system directory): `pkg`\n\n## Target")
    expect(brief).toContain("- Migration-target directory (relative to the working directory): `app` — migrated code is written here")
    expect(await loadProjectConfig(dir)).toMatchObject({ contextLimit: 32, idleTime: 15, idleMax: 60 })
    // Idempotent: a second pass finds nothing.
    expect((await planFix(dir)).findings).toEqual([])
  })

  test("moving source into a missing brief starts from empty (plans/0081 D11: no stub, no missing-brief finding)", async () => {
    await seedInit(dir, { ...CONFIG_DEFAULTS, source: { dir: "legacy", path: "pkg" } })
    await rm(join(dir, BRIEF), { force: true })
    const plan = await planFix(dir)
    expect(plan.findings.map((finding) => finding.path)).toEqual([CONFIG])
    await applyFix(plan)
    const brief = await Bun.file(join(dir, BRIEF)).text()
    expect(brief.startsWith("## Source\n")).toBe(true)
    expect(brief).toContain("`legacy`")
    expect(await readConfig(dir)).not.toHaveProperty("source")
  })

  // Plans/0215 D1 (0165-155): applyFix orders the brief write before the
  // config write — correct, the value is never lost — so a kill between the
  // two writes leaves the moved block on disk while the config still holds
  // the retired key. The re-run's re-derivation must recognize its own
  // block, never append it twice.
  test("the source/destDir move is idempotent across the brief→config write gap: the interrupted re-run recognizes its own landed block (plans/0215 D1)", async () => {
    await seedInit(dir, { ...CONFIG_DEFAULTS, source: { dir: "legacy", path: "pkg" }, destDir: "app" })
    await Bun.write(join(dir, BRIEF), "Migrate the parser first.\n")
    const first = await planFix(dir)
    // The crash: only the brief write landed.
    const briefWrite = first.writes.find((write) => write.path === BRIEF)!
    await briefWrite.apply()
    const landed = await Bun.file(join(dir, BRIEF)).text()
    expect(landed).toContain("## Source")
    // The re-run plans the config write alone: the brief already holds the
    // moved blocks, and each finding's remedy states what fix will do.
    const reRun = await planFix(dir)
    expect(reRun.writes.map((write) => write.path)).toEqual([CONFIG])
    expect(formatFixPlan(reRun)).toContain("source is retired (the migration source and target are intent, not configuration) → its value already sits in .opencode/auto/brief.md under ## Source; drop the key")
    expect(formatFixPlan(reRun)).toContain("destDir is retired (the migration source and target are intent, not configuration) → its value already sits in .opencode/auto/brief.md under ## Target; drop the key")
    await applyFix(reRun)
    const brief = await Bun.file(join(dir, BRIEF)).text()
    // Exactly once — the pre-fix re-run appended the same block again (the
    // finding's own repro: "moved line occurrences after re-run: 2").
    expect(brief.match(/Source-system directory/g)).toHaveLength(1)
    expect(brief.match(/Migration-target directory/g)).toHaveLength(1)
    expect(brief).toBe(landed)
    expect(await readConfig(dir)).not.toHaveProperty("source")
    expect(await readConfig(dir)).not.toHaveProperty("destDir")
    expect((await planFix(dir)).findings).toEqual([])
  })

  // The D1 floor: the recognition is byte-exact over the tool's own
  // rendering — a person's differently-worded value never matches and keeps
  // today's append.
  test("a differently-worded moved value never matches — the canonical block still lands beside it (plans/0215 D1)", async () => {
    await seedInit(dir, { ...CONFIG_DEFAULTS, destDir: "app" })
    await Bun.write(join(dir, BRIEF), "## Target\n\n- the deliverable goes to app, I think\n")
    const plan = await planFix(dir)
    expect(formatFixPlan(plan)).toContain("destDir is retired (the migration source and target are intent, not configuration) → move its value into .opencode/auto/brief.md under ## Target, then drop the key")
    expect(plan.writes.map((write) => write.path)).toEqual([BRIEF, CONFIG])
    await applyFix(plan)
    expect(await Bun.file(join(dir, BRIEF)).text()).toBe(
      "## Target\n\n- the deliverable goes to app, I think\n\n- Migration-target directory (relative to the working directory): `app` — migrated code is written here\n",
    )
    expect((await planFix(dir)).findings).toEqual([])
  })

  // Plans/0215 D3 (0165-157): the move's brief write is write-tmp-then-rename
  // — the read-only brief (a killed run's stale protect bit) is the
  // deterministic stand-in for the crash mid-write: the pre-fix in-place
  // Bun.write answers EACCES, the rename replaces the entry and heals.
  test("fix's brief write replaces the file: a read-only brief is healed, not EACCES (plans/0215 D3)", async () => {
    await seedInit(dir, { ...CONFIG_DEFAULTS, source: { dir: "legacy", path: "pkg" } })
    await Bun.write(join(dir, BRIEF), "Migrate the parser first.\n")
    await chmod(join(dir, BRIEF), 0o444)
    try {
      const plan = await planFix(dir)
      await applyFix(plan)
      const brief = await Bun.file(join(dir, BRIEF)).text()
      expect(brief).toContain("`legacy`")
      expect(await readConfig(dir)).not.toHaveProperty("source")
      // The tmp rode .auto/ and was consumed by the rename; the workdir's
      // directory is not left behind (the lock's own discipline).
      expect(await Bun.file(join(dir, ".auto")).exists()).toBe(false)
    } finally {
      await chmod(join(dir, BRIEF), 0o644).catch(() => {})
    }
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

  test("artifact rules: missing or stale artifacts are rewritten; the brief is never written (plans/0081 D11)", async () => {
    await seedInit(dir, { ...CONFIG_DEFAULTS, testByDriver: true })
    await rm(join(dir, "opencode.json"))
    await rm(join(dir, BRIEF), { force: true })
    const agents = await Bun.file(join(dir, "AGENTS.md")).text()
    await writeFile(join(dir, "AGENTS.md"), `${agents}\n<!-- opencode-auto:old:start -->\nstale\n<!-- opencode-auto:old:end -->\n`)
    const plan = await planFix(dir)
    expect(plan.findings.map((finding) => `${finding.path}: ${finding.problem}`)).toEqual([
      ".opencode/agent/auto.md: differs from the template rendered for testByDriver = true",
      "AGENTS.md: the opencode-auto block differs from the current config render; 1 legacy/stray opencode-auto marker block(s)",
      "opencode.json: missing",
    ])
    await applyFix(plan)
    expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).text()).toBe(await renderAgentContract(true))
    expect(await Bun.file(join(dir, "AGENTS.md")).text()).not.toContain("opencode-auto:old")
    // A missing brief is no finding and no write: seed it with init/amend --brief.
    expect(await Bun.file(join(dir, BRIEF)).exists()).toBe(false)
    expect((await planFix(dir)).findings).toEqual([])
    // A person's opencode.json is never overridden — but since plans/0147 it
    // is compared for the knowledge boundary: a file lacking the deny/`/tmp`
    // pair gains one fixable finding (the additive insert; every person key
    // kept and still winning the tie). With the boundary present, no finding.
    await writeFile(join(dir, "opencode.json"), '{"model":"mine"}\n')
    const personPlan = await planFix(dir)
    expect(fixable(personPlan)).toEqual([
      {
        class: "fixable",
        path: "opencode.json",
        problem: "permission.external_directory lacks the working-directory knowledge boundary (default-deny outside the working directory, /tmp excepted)",
        change: "insert the knowledge boundary (deny /** , allow /tmp/**)",
      },
    ])
    await applyFix(personPlan)
    expect((await planFix(dir)).findings).toEqual([])
    expect((JSON.parse(await Bun.file(join(dir, "opencode.json")).text()) as any).model).toBe("mine")
  })

  // plans/0122: the root-symlink external_directory allows — the template
  // write carries the stamp, an existing file gains the entries additively,
  // and stale or unshapeable files are report-only.
  test("a root symlink's allow is stamped into a missing opencode.json; without symlinks the template stays byte-identical", async () => {
    await seedInit(dir)
    await rm(join(dir, "opencode.json"))
    const plan = await planFix(dir)
    await applyFix(plan)
    expect(await Bun.file(join(dir, "opencode.json")).text()).toBe(await Bun.file(templateConfig).text())

    const corpus = await mkdtemp(join(tmpdir(), "auto-fix-corpus-"))
    await symlink(corpus, join(dir, "linux"))
    try {
      await rm(join(dir, "opencode.json"))
      const stamped = await planFix(dir)
      expect(fixable(stamped).map((finding) => `${finding.path}: ${finding.problem}`)).toEqual(["opencode.json: missing"])
      await applyFix(stamped)
      const written = JSON.parse(await Bun.file(join(dir, "opencode.json")).text()) as any
      // The template's boundary (plans/0147) beneath the symlink's read-only
      // composite: the deny first, the corpus allow after it (it must win
      // the tie), /tmp excepted, the edit layer closing the write side in
      // every form the live tools ask (plans/0188 D3: the target, its
      // worktree-relative form, the door name).
      const rel = relative(dir, corpus).replaceAll("\\", "/")
      expect(written.permission.external_directory).toEqual({ "/**": "deny", [`${corpus}/**`]: "allow", "/tmp/**": "allow" })
      expect(written.permission.edit).toEqual({ "*": "allow", [`${corpus}/**`]: "deny", [`${rel}/**`]: "deny", "linux/**": "deny" })
      expect((await planFix(dir)).findings).toEqual([])
    } finally {
      await rm(corpus, { recursive: true, force: true })
    }
  })

  test("an existing opencode.json gains the allow additively; person keys and actions are never overridden", async () => {
    await seedInit(dir)
    const corpus = await mkdtemp(join(tmpdir(), "auto-fix-corpus-"))
    await symlink(corpus, join(dir, "linux"))
    await writeFile(
      join(dir, "opencode.json"),
      JSON.stringify({ model: "mine", permission: { read: "allow", external_directory: { "/person/**": "deny" } } }, null, 2) + "\n",
    )
    try {
      const rel = relative(dir, corpus).replaceAll("\\", "/")
      const plan = await planFix(dir)
      expect(fixable(plan)).toEqual([
        {
          class: "fixable",
          path: "opencode.json",
          problem: "permission.external_directory lacks the working-directory knowledge boundary (default-deny outside the working directory, /tmp excepted)",
          change: "insert the knowledge boundary (deny /** , allow /tmp/**)",
        },
        {
          class: "fixable",
          path: "opencode.json",
          problem: `the root-symlink stamps are incomplete (${corpus}/**, edit ${corpus}/**, edit ${rel}/**, edit linux/**)`,
          change: "insert the root-symlink allow(s) and their read-only edit deny(s)",
        },
      ])
      await applyFix(plan)
      const written = JSON.parse(await Bun.file(join(dir, "opencode.json")).text()) as any
      // The boundary's deny first, the corpus allow after it (winning the
      // tie), the person's own key last (still winning its ties).
      expect(Object.keys(written.permission.external_directory)).toEqual(["/**", `${corpus}/**`, "/tmp/**", "/person/**"])
      expect(written.permission.external_directory["/person/**"]).toBe("deny")
      expect(written.permission.edit).toEqual({ "*": "ask", [`${corpus}/**`]: "deny", [`${rel}/**`]: "deny", "linux/**": "deny" })
      expect(written.model).toBe("mine")
      expect((await planFix(dir)).findings).toEqual([])
      // A person-owned entry on any of the deny keys reads as present: no
      // finding — with the boundary beside it, the file is clean.
      await writeFile(
        join(dir, "opencode.json"),
        JSON.stringify({ permission: { external_directory: { "/**": "deny", "/tmp/**": "allow", [`${corpus}/**`]: "deny" }, edit: { "*": "allow", [`${corpus}/**`]: "ask", [`${rel}/**`]: "ask", "linux/**": "ask" } } }, null, 2) + "\n",
      )
      expect((await planFix(dir)).findings).toEqual([])
    } finally {
      await rm(corpus, { recursive: true, force: true })
    }
  })

  test("a stale allow and an unshapeable file are manual findings, never writes", async () => {
    await seedInit(dir)
    const corpus = await mkdtemp(join(tmpdir(), "auto-fix-corpus-"))
    await symlink(corpus, join(dir, "linux"))
    try {
      const rel = relative(dir, corpus).replaceAll("\\", "/")
      await writeFile(
        join(dir, "opencode.json"),
        JSON.stringify({ permission: { external_directory: { "/**": "deny", "/tmp/**": "allow", [`${corpus}/**`]: "allow", "/gone/**": "allow" }, edit: { "*": "allow", [`${corpus}/**`]: "deny", [`${rel}/**`]: "deny", "linux/**": "deny" } } }, null, 2) + "\n",
      )
      const stale = await planFix(dir)
      expect(manual(stale)).toEqual([
        {
          class: "manual",
          path: "opencode.json",
          problem: "permission.external_directory allows /gone/** but that path does not exist (the symlink or its target is gone) — remove the entry if the reference moved",
        },
      ])
      expect(stale.writes).toEqual([])

      await writeFile(join(dir, "opencode.json"), "not json")
      const malformed = await planFix(dir)
      // A malformed file reports both stamp families' manual findings — the
      // boundary's and the symlink composite's — never a guess of a write.
      expect(manual(malformed)).toEqual([
        {
          class: "manual",
          path: "opencode.json",
          problem: "the permission.external_directory section cannot hold the working-directory knowledge boundary (malformed file or a flat action) — add it by hand",
        },
        {
          class: "manual",
          path: "opencode.json",
          problem: "the permission.external_directory or permission.edit section cannot hold the root-symlink read-only stamps (malformed file or a flat action) — add them by hand",
        },
      ])
      expect(malformed.writes).toEqual([])
    } finally {
      await rm(corpus, { recursive: true, force: true })
    }
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

  // plans/0055 §4.1 (the models entry) under plans/0138's retirement rules:
  // a pre-0138 .gitignore also holds the retired /.gitignore and /opencode.json
  // lines — the self-entry is stripped by rule, the opencode.json line is the
  // person's visibility call and stays a manual finding until they act.
  test("an older init's .gitignore: fix appends the models entry, strips the retired self-entry, and reports the /opencode.json line", async () => {
    await seedInit(dir, { ...CONFIG_DEFAULTS, contextLimit: 128, custom: "kept" })
    expect((await Bun.spawn(["git", "-C", dir, "init", "-q"]).exited)).toBe(0)
    const older = "node_modules/\ntmp/\n.auto/\n/.gitignore\n/.env\n/AGENTS.md\n/opencode.json\n"
    await writeFile(join(dir, ".gitignore"), older)
    const config = await Bun.file(join(dir, CONFIG)).text()
    const plan = await planFix(dir)
    expect(formatFixPlan(plan)).toBe(
      "  fix: .gitignore: lacks the /.opencode/auto/models.json entry (the model registry's project layer is local-only) → append the entry\n" +
        "  fix: .gitignore: holds the retired /.gitignore entry (the ignore set is a tracked project surface since plans/0138 — a self-ignored file never reached git, and every fresh clone lost the whole set) → remove the entry (the file surfaces untracked and lands in git with the next commit)\n" +
        "  manual: .gitignore: holds the retired /opencode.json entry (opencode.json is a tracked project surface since plans/0138) — remove the line by hand to surface the file, or keep it and own it if the file must stay local",
    )
    expect(plan.writes.map((write) => write.path)).toEqual([".gitignore", ".gitignore"])
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe(older)
    await applyFix(plan)
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("node_modules/\ntmp/\n.auto/\n/.env\n/AGENTS.md\n/opencode.json\n/.opencode/auto/models.json\n")
    expect(await Bun.file(join(dir, CONFIG)).text()).toBe(config)
    // The manual /opencode.json finding persists until the person removes the
    // line; with it gone by hand the plan is clean.
    expect((await planFix(dir)).findings.map((finding) => `${finding.class}: ${finding.problem}`)).toEqual([
      "manual: holds the retired /opencode.json entry (opencode.json is a tracked project surface since plans/0138) — remove the line by hand to surface the file, or keep it and own it if the file must stay local",
    ])
    await writeFile(join(dir, ".gitignore"), "node_modules/\ntmp/\n.auto/\n/.env\n/AGENTS.md\n/.opencode/auto/models.json\n")
    expect((await planFix(dir)).findings).toEqual([])
  })

  // plans/0138: a nested repository that appeared after init (or a pre-0138
  // clone whose partial file never carried the entries) gains its entry — the
  // parent's unified commit would otherwise absorb it as a gitlink.
  test("a nested git repository without its .gitignore entry: fix appends it", async () => {
    await seedInit(dir)
    expect((await Bun.spawn(["git", "-C", dir, "init", "-q"]).exited)).toBe(0)
    await mkdir(join(dir, "vendor"))
    await Bun.spawn(["git", "-C", join(dir, "vendor"), "init", "-q"])
    await writeFile(join(dir, ".gitignore"), "tmp/\n.auto/\n/.env\n/AGENTS.md\n/.opencode/auto/models.json\n")
    const plan = await planFix(dir)
    expect(formatFixPlan(plan)).toBe("  fix: .gitignore: lacks an entry for a nested git repository in the tree → append the entry (the parent's unified commit would otherwise absorb the repository as a gitlink)")
    await applyFix(plan)
    expect(await Bun.file(join(dir, ".gitignore")).text()).toBe("tmp/\n.auto/\n/.env\n/AGENTS.md\n/.opencode/auto/models.json\n/vendor/\n")
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

// —— The sealed wall's stamp skip (plans/0189 D3, 0165-038c) ——
//
// A root symlink resolving under (or over) a recorded wall target is a
// reopen: fix never stamps the external_directory allow that would beat the
// wall's front deny under last-match-wins — the manual finding names the
// reopen, and the edit-layer denies still stamp (defense-in-depth). Over a
// real git repository: the wall commit's record is what fix reads.

describe("fix's root-symlink stamps past a sealed wall (plans/0189 D3)", () => {
  test("a corpus-subtree door reports the reopen and stamps no allow; the wall-less floor still stamps it", async () => {
    const dir = await freshRepo()
    const corpus = await mkdtemp(join(tmpdir(), "auto-fix-wall-corpus-"))
    try {
      await mkdir(join(corpus, "sub"), { recursive: true })
      await Bun.write(join(dir, ".gitignore"), ".auto/\ntmp/\nopencode.json\n")
      await mkdir(join(dir, ".opencode/auto/phases"), { recursive: true })
      await Bun.write(
        join(dir, ".opencode/auto/phases/spec-read.md"),
        ["# Spec read", "", "Wall: seal linux", "", "## plan duties", "", "Read the reference.", "", "<!-- auto: eof -->", ""].join("\n"),
      )
      await seedInit(dir)
      // The wall's record: a hand-crafted wall commit (the record grammar
      // is the contract) and the sealed config it leaves behind.
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "the spec room, door standing")
      await git(dir, "commit", "--allow-empty", "-qm", "PLAN wall close Spec read", "-m", "Auto-Stage: wall", "-m", `Wall-door: linux -> ${corpus}`)
      await Bun.write(
        join(dir, "opencode.json"),
        JSON.stringify({ permission: { external_directory: { "/**": "deny", "/tmp/**": "allow", [`${corpus}/**`]: "deny" } } }, null, 2) + "\n",
      )
      // The reopen: a new door into the sealed corpus's subtree.
      await symlink(join(corpus, "sub"), join(dir, "ref"))
      const sealed = await planFix(dir)
      expect(manual(sealed).map((finding) => finding.problem)).toContain(
        `a root symlink resolves to ${join(corpus, "sub")}, under (or over) the sealed reference wall's recorded target — a reopen the wall's boundary checks block; remove the symlink (fix does not stamp allows past a sealed wall)`,
      )
      // The allow is never listed as missing; the edit-layer denies still are.
      const incomplete = fixable(sealed).map((finding) => finding.problem).join("\n")
      expect(incomplete).not.toContain(`(${join(corpus, "sub")}/**,`)
      expect(incomplete).toContain(`edit ${join(corpus, "sub")}/**`)
      await applyFix(sealed)
      const written = JSON.parse(await Bun.file(join(dir, "opencode.json")).text()) as any
      expect(written.permission.external_directory[join(corpus, "sub") + "/**"]).toBeUndefined()
      expect(written.permission.edit[join(corpus, "sub") + "/**"]).toBe("deny")

      // The wall-less floor: a project that declares no wall (the type file
      // gone) stamps the same door's allow exactly as before (P10).
      await rm(join(dir, ".opencode/auto/phases/spec-read.md"))
      await Bun.write(
        join(dir, "opencode.json"),
        JSON.stringify({ permission: { external_directory: { "/**": "deny", "/tmp/**": "allow" } } }, null, 2) + "\n",
      )
      const floor = await planFix(dir)
      expect(fixable(floor).map((finding) => finding.problem).join("\n")).toContain(`(${join(corpus, "sub")}/**,`)
      await applyFix(floor)
      expect((JSON.parse(await Bun.file(join(dir, "opencode.json")).text()) as any).permission.external_directory[join(corpus, "sub") + "/**"]).toBe("allow")
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(corpus, { recursive: true, force: true })
    }
  })
})

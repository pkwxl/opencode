import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadModes, parseModeFile } from "../src/mode"

// A valid mode file sample: title matches the file name, both sections present.
function modeText(name: string, marker = "default"): string {
  return `# ${name}

## init
${marker} intro.

## exec
${marker} note.
`
}

describe("built-in modes", () => {
  test("the built-ins register the five scenario postures (migrate plus the plans/0243 A family), both copy blocks present", () => {
    const modes = loadModes()
    // The family order is the registry's insertion order (plans/0243 A): the
    // migration posture first, then the maintenance pair, then fork and pr.
    expect(Object.keys(modes)).toEqual(["migrate", "debug", "fix", "fork", "pr"])
    const mode = modes.migrate!
    expect(mode.name).toBe("migrate")
    // init lead-in: scenario definition, task-layout principles
    expect(mode.init).toContain("externally visible behaviour stays the same")
    expect(mode.init).toContain("baseline confirmation")
    expect(mode.init).toContain("migration work")
    expect(mode.init).toContain("regression verification")
    // exec note: equivalent behaviour, the compatibility layer and the AUTO-DECISION annotation requirement
    expect(mode.exec).toContain("behaviourally equivalent")
    expect(mode.exec).toContain("compatibility layer")
    expect(mode.exec).toContain("AUTO-DECISION")
  })

  test("the plans/0243 A postures carry their scenario discipline in both blocks", () => {
    const modes = loadModes()
    // debug: reproduction before fix, diagnosis converted to a failing test
    expect(modes.debug!.init).toContain("reproduce → diagnose → fix → verify")
    expect(modes.debug!.init).toContain("no fix task is planned before a failing reproduction exists")
    expect(modes.debug!.exec).toContain("turns green")
    expect(modes.debug!.exec).toContain("Fix the named cause only")
    // fix: one issue per task, the regression-test duty
    expect(modes.fix!.init).toContain("One issue per task")
    expect(modes.fix!.exec).toContain("fails without the fix and passes with it")
    expect(modes.fix!.exec).toContain("No refactors, dependency bumps or format-only changes ride a fix")
    // fork: recorded divergence, the upstream-merge surface
    expect(modes.fork!.init).toContain("small, recorded, and mergeable")
    expect(modes.fork!.exec).toContain("recorded deviation")
    expect(modes.fork!.exec).toContain("upstream-merge surface clean")
    // pr: the one review-ready change set, commit hygiene
    expect(modes.pr!.init).toContain("one review-ready change set")
    expect(modes.pr!.exec).toContain("Commit hygiene is part of the deliverable")
    expect(modes.pr!.exec).toContain("splits into its own task")
  })

  test("unregistered names are absent from the registry (optimize/implement/test must come from the target directory)", () => {
    const modes = loadModes()
    expect(modes.optimize).toBeUndefined()
    expect(modes.implement).toBeUndefined()
    expect(modes.test).toBeUndefined()
  })
})

describe("target-directory mode extension (.opencode/auto/modes/)", () => {
  test("a new mode needs zero source changes; a same name overrides the built-in", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-mode-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "modes")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "optimize.md"), modeText("optimize", "optimized"))
      writeFileSync(join(overlay, "migrate.md"), modeText("migrate", "custom"))
      const modes = loadModes(dir)
      // The five built-ins (plans/0243 A) plus the overlay, sorted.
      expect(Object.keys(modes).sort()).toEqual(["debug", "fix", "fork", "migrate", "optimize", "pr"])
      expect(modes.optimize!.init).toContain("optimized intro")
      // Same-name override: the built-in migrate's copy is replaced by the target-directory version
      expect(modes.migrate!.init).toContain("custom intro")
      expect(modes.migrate!.init).not.toContain("externally visible behaviour stays the same")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("an invalid file name, mismatched title, missing section and unknown section are all parse errors", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-mode-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "modes")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "Bad_Name.md"), modeText("Bad_Name"))
      writeFileSync(join(overlay, "mismatch.md"), modeText("other name"))
      writeFileSync(join(overlay, "incomplete.md"), `# incomplete\n\n## init\nonly one section.\n`)
      writeFileSync(join(overlay, "unknown.md"), `${modeText("unknown")}\n## extra\nextra section.\n`)
      expect(() => loadModes(dir)).toThrow(/Bad_Name\.md is invalid/)
      expect(() => parseModeFile("mismatch", modeText("other name"))).toThrow(/must start with "# mismatch"/)
      expect(() => parseModeFile("incomplete", `# incomplete\n\n## init\nonly one section.\n`)).toThrow(
        /is missing sections: ## exec$/,
      )
      expect(() => parseModeFile("unknown", `${modeText("unknown")}\n## extra\nextra section.\n`)).toThrow(/has unknown section/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("leading and trailing blank lines of a section body are trimmed; an empty section counts as missing", () => {
    const spec = parseModeFile(
      "x",
      `# x\n\n## init\n\n\nintro.\n\n\n## exec\nnote.\n## final: audit\na\n## final: validate\nb\n## final: finalize\n\n\nc\n`,
    )
    expect(spec.init).toBe("intro.")
    // The retired final: three sections (plans/0044 D1) still parse; their bodies are ignored and kept out of ModeSpec
    expect(spec).toEqual({ name: "x", init: "intro.", exec: "note." })
    expect(() => parseModeFile("y", `# y\n\n## init\n\n\n## exec\nnote.\n`)).toThrow(/is missing sections/)
  })
})

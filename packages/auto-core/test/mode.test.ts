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
  test("the built-ins register only migrate, both copy blocks present (migrated verbatim from the old registry)", () => {
    const modes = loadModes()
    expect(Object.keys(modes)).toEqual(["migrate"])
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
      expect(Object.keys(modes).sort()).toEqual(["migrate", "optimize"])
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

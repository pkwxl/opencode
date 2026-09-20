// Intent-pack loader tests (M1.1, plans/0031). Covers the file protocol
// (parse), the built-in registry, the project overlay with wholesale
// same-name override, and degenerate resolution (single active pack).
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadIntents, parseIntentFile, resolveIntent } from "../src/intent/load"
import { DEFAULT_INTENT, INTENT_SECTIONS } from "../src/intent/types"

function packText(name: string, sections: Record<string, string>): string {
  const parts = [`# ${name}`]
  for (const [heading, body] of Object.entries(sections)) parts.push(`## ${heading}`, body)
  return parts.join("\n\n") + "\n"
}

describe("intent file protocol (parseIntentFile)", () => {
  test("a full pack captures all five sections in canonical order", () => {
    const pack = parseIntentFile(
      "x",
      packText("x", {
        quality: "split rules.",
        "phase duties": "duties.",
        acceptance: "acceptance semantics.",
        governance: "decision discipline.",
        "artifact spec": "artifact conventions.",
      }),
    )
    expect(pack.name).toBe("x")
    expect(pack.quality).toBe("split rules.")
    expect(pack.phaseDuties).toBe("duties.")
    expect(pack.acceptance).toBe("acceptance semantics.")
    expect(pack.governance).toBe("decision discipline.")
    expect(pack.artifactSpec).toBe("artifact conventions.")
    expect(Object.keys(pack)).toEqual(["name", ...INTENT_SECTIONS])
  })

  test("partial packs leave absent sections undefined", () => {
    const pack = parseIntentFile("x", packText("x", { quality: "only quality." }))
    expect(pack.quality).toBe("only quality.")
    expect(pack.phaseDuties).toBeUndefined()
    expect(pack.acceptance).toBeUndefined()
    expect(pack.governance).toBeUndefined()
    expect(pack.artifactSpec).toBeUndefined()
  })

  test("section bodies are trimmed; empty sections are treated as absent", () => {
    const pack = parseIntentFile("x", `# x\n\n## quality\n\n\nbody.\n\n\n## acceptance\n\n`)
    expect(pack.quality).toBe("body.")
    expect(pack.acceptance).toBeUndefined()
  })

  test("missing or mismatched title is an error", () => {
    expect(() => parseIntentFile("x", "no title\n")).toThrow(/must start with "# x"/)
    expect(() => parseIntentFile("x", "# y\n\n## quality\nq\n")).toThrow(/must start with "# x"/)
  })

  test("unknown sections are rejected with the available heading list", () => {
    expect(() => parseIntentFile("x", `# x\n\n## vibe\nv\n`)).toThrow(/unknown section "## vibe".*## quality.*## artifact spec/s)
  })
})

describe("built-in registry and project overlay (loadIntents)", () => {
  test("the built-in registry ships the empty default pack (zero-intent baseline)", () => {
    const packs = loadIntents()
    expect(Object.keys(packs)).toEqual([DEFAULT_INTENT])
    const pack = packs[DEFAULT_INTENT]!
    expect(pack.name).toBe(DEFAULT_INTENT)
    for (const section of INTENT_SECTIONS) expect(pack[section]).toBeUndefined()
  })

  test("a project file with a new name adds a pack; invalid file names are rejected", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-intent-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "intents")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "extra.md"), packText("extra", { quality: "extra quality." }))
      const packs = loadIntents(dir)
      expect(Object.keys(packs).sort()).toEqual([DEFAULT_INTENT, "extra"])
      expect(packs.extra!.quality).toBe("extra quality.")
      writeFileSync(join(overlay, "Bad_Name.md"), packText("Bad_Name", {}))
      expect(() => loadIntents(dir)).toThrow(/Bad_Name\.md is invalid/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a same-named project file overrides the built-in wholesale (no merge)", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-intent-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "intents")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, `${DEFAULT_INTENT}.md`), packText(DEFAULT_INTENT, { acceptance: "project acceptance." }))
      const pack = loadIntents(dir)[DEFAULT_INTENT]!
      expect(pack.acceptance).toBe("project acceptance.")
      // Wholesale replacement: sections the project file omits stay absent
      // even if the built-in had them (the built-in is currently empty; the
      // no-merge guarantee is the load-time assignment itself).
      expect(pack.quality).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("degenerate composition (resolveIntent)", () => {
  test("resolution is a plain lookup; the default pack resolves without a name", () => {
    const packs = loadIntents()
    expect(resolveIntent(packs).name).toBe(DEFAULT_INTENT)
    expect(resolveIntent(packs, DEFAULT_INTENT)).toBe(packs[DEFAULT_INTENT])
  })

  test("unknown names fail with the available list", () => {
    expect(() => resolveIntent(loadIntents(), "nope")).toThrow(/unknown intent pack "nope".*default/)
  })
})

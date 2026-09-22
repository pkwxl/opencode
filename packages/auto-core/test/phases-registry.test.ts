// Phase-type registry (M3.2, plans/0047 §5): the builtin entries, the letter
// presets, and the preset validator's equivalence with the pre-registry
// literal whitelist (root plan risk 5: the guards must not weaken).
import { describe, expect, test } from "bun:test"
import { parsePartials, promptTemplateNames } from "../src/template"
import tplPartials from "../templates/prompts/_partials.md" with { type: "file" }
import { readFileSync } from "node:fs"
import {
  BUILTIN_PHASE_TYPES,
  PHASE_LETTERS,
  expandPhases,
  isPhaseLetter,
  phaseType,
  phaseTypeOfLetter,
  planDutiesPartial,
  unitArtifactSpecs,
} from "../src/phases/registry"

// The validator as it stood before M3.2 (src/phases.ts parsePhases at
// 3be164675), kept verbatim as the reference the registry must reproduce.
function legacyParsePhases(raw: string): string[] | null {
  const order = "admtvk"
  if (!raw) return null
  let prev = -1
  let hasM = false
  for (const ch of raw) {
    const index = order.indexOf(ch)
    if (index === -1 || index <= prev) return null
    prev = index
    if (ch === "m") hasM = true
  }
  return hasM ? [...raw] : null
}

describe("builtin phase types", () => {
  test("canonical order follows the admtvk presets", () => {
    expect(BUILTIN_PHASE_TYPES.map((entry) => entry.type)).toEqual(["analysis", "design", "implement", "test", "acceptance", "knowledge"])
    expect(BUILTIN_PHASE_TYPES.map((entry) => entry.letter).join("")).toBe("admtvk")
    expect(PHASE_LETTERS.join("")).toBe("admtvk")
  })

  test("legacy directory slugs are pinned (letter layout lives until M3.3)", () => {
    expect(Object.fromEntries(BUILTIN_PHASE_TYPES.map((entry) => [entry.letter, entry.slug]))).toEqual({
      a: "analysis",
      d: "design",
      m: "migrate",
      t: "testing",
      v: "acceptance",
      k: "knowledge",
    })
  })

  test("display names are pinned (they reach logs, commit subjects and prompts)", () => {
    expect(BUILTIN_PHASE_TYPES.map((entry) => entry.name)).toEqual(["分析", "设计", "迁移实现", "测试", "验收", "知识提炼"])
  })

  test("type ids are unique and fit the phase directory grammar P<nn>-<type>", () => {
    const types = BUILTIN_PHASE_TYPES.map((entry) => entry.type)
    expect(new Set(types).size).toBe(types.length)
    for (const type of types) expect(type).toMatch(/^[a-z][a-z0-9-]*$/)
  })

  test("only knowledge runs without tasks; only acceptance carries the verdict gate", () => {
    expect(BUILTIN_PHASE_TYPES.filter((entry) => !entry.hasTasks).map((entry) => entry.type)).toEqual(["knowledge"])
    expect(BUILTIN_PHASE_TYPES.filter((entry) => entry.gate === "verdict").map((entry) => entry.type)).toEqual(["acceptance"])
  })

  test("standard artifacts follow plans/0047 §5", () => {
    const names = (type: string, level: "phaseArtifacts" | "taskArtifacts") => phaseType(type)![level].map((spec) => spec.path)
    expect(names("analysis", "phaseArtifacts")).toEqual(["findings.md"])
    expect(names("analysis", "taskArtifacts")).toEqual(["analysis.md"])
    expect(names("design", "phaseArtifacts")).toEqual(["design.md", "decisions.md"])
    expect(names("design", "taskArtifacts")).toEqual(["design.md"])
    expect(names("implement", "phaseArtifacts")).toEqual([])
    expect(names("implement", "taskArtifacts")).toEqual([])
    expect(names("test", "phaseArtifacts")).toEqual(["test-report.md"])
    expect(names("test", "taskArtifacts")).toEqual(["test-log.md"])
    expect(names("acceptance", "phaseArtifacts")).toEqual(["verdict.md"])
    expect(names("acceptance", "taskArtifacts")).toEqual(["verification.md"])
    expect(names("knowledge", "phaseArtifacts")).toEqual(["kb.md"])
    expect(names("knowledge", "taskArtifacts")).toEqual([])
    for (const entry of BUILTIN_PHASE_TYPES) {
      for (const spec of [...entry.phaseArtifacts, ...entry.taskArtifacts]) {
        expect(spec.role).toBe("artifact")
        expect(spec.path).toMatch(/^[a-z][a-z0-9-]*\.md$/)
      }
    }
  })

  test("every decompose template and plan-duties partial the registry names exists", () => {
    const templates = promptTemplateNames()
    const partials = parsePartials(readFileSync(tplPartials, "utf8"))
    for (const entry of BUILTIN_PHASE_TYPES) {
      expect(templates).toContain(entry.decomposeTemplate)
      expect(partials[planDutiesPartial(entry)]?.trim()).toBeTruthy()
    }
  })
})

describe("lookups", () => {
  test("phaseType / phaseTypeOfLetter", () => {
    expect(phaseType("implement")?.letter).toBe("m")
    expect(phaseType("migrate")).toBeUndefined()
    expect(phaseType("m")).toBeUndefined()
    for (const letter of PHASE_LETTERS) expect(phaseTypeOfLetter(letter).letter).toBe(letter)
  })

  test("isPhaseLetter", () => {
    for (const letter of PHASE_LETTERS) expect(isPhaseLetter(letter)).toBe(true)
    for (const other of ["", "x", "M", "am", "analysis"]) expect(isPhaseLetter(other)).toBe(false)
  })
})

describe("expandPhases (letter presets)", () => {
  test("expands letters to registry entries in the given order", () => {
    expect(expandPhases("adm")?.map((entry) => entry.type)).toEqual(["analysis", "design", "implement"])
    expect(expandPhases("m")?.map((entry) => entry.type)).toEqual(["implement"])
    expect(expandPhases("admtvk")?.map((entry) => entry.type)).toEqual(BUILTIN_PHASE_TYPES.map((entry) => entry.type))
  })

  test("accepts exactly what the pre-registry whitelist accepted", () => {
    // Every string up to length 4 over the preset alphabet plus two outsiders,
    // then every subset of admtvk in canonical order (all 64) and reversed.
    const alphabet = [..."admtvkxM"]
    const inputs = new Set<string>([""])
    let frontier = [""]
    for (let length = 1; length <= 4; length++) {
      frontier = frontier.flatMap((prefix) => alphabet.map((ch) => prefix + ch))
      for (const raw of frontier) inputs.add(raw)
    }
    for (let mask = 0; mask < 64; mask++) {
      const subset = [..."admtvk"].filter((_, index) => mask & (1 << index))
      inputs.add(subset.join(""))
      inputs.add(subset.reverse().join(""))
    }
    for (const raw of [" m", "m ", "admtvkx", "admtvkm", "amtkv"]) inputs.add(raw)
    for (const raw of inputs) {
      const expanded = expandPhases(raw)
      expect({ raw, got: expanded?.map((entry): string | undefined => entry.letter) ?? null }).toEqual({ raw, got: legacyParsePhases(raw) })
    }
  })
})

describe("unitArtifactSpecs", () => {
  test("joins unit-relative artifact names onto the unit directory", () => {
    expect(unitArtifactSpecs(phaseType("design")!.phaseArtifacts, "docs/R-01/P02-design")).toEqual([
      { path: "docs/R-01/P02-design/design.md", label: "phase design", role: "artifact" },
      { path: "docs/R-01/P02-design/decisions.md", label: "design decisions", role: "artifact" },
    ])
    expect(unitArtifactSpecs([], "docs/T-001")).toEqual([])
  })

  test("does not mutate the registry entries", () => {
    const before = phaseType("analysis")!.taskArtifacts.map((spec) => spec.path)
    unitArtifactSpecs(phaseType("analysis")!.taskArtifacts, "docs/T-009")
    expect(phaseType("analysis")!.taskArtifacts.map((spec) => spec.path)).toEqual(before)
  })
})

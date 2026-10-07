// Default reasoning tiers (plans/0055 §5): defaultTier over every role word and
// every phase type, custom types with and without `Reasoning:`, and m mode,
// which runs without a phase entry.
import { describe, expect, test } from "bun:test"
import { parsePhaseTypeFile } from "../src/phases/custom"
import { BUILTIN_PHASE_TYPES, TIERS, phaseType, type PhaseTypeEntry, type Tier } from "../src/phases/registry"
import { MODEL_ROLES, type ModelRole } from "../src/switches"
import { defaultTier } from "../src/tier"

// The role table of §5, restated: a fixed tier, or "execute" for the phase
// type's execute tier. Its keys must be exactly MODEL_ROLES, so a role word
// added without a tier fails here as well as in the typecheck.
const ROLE_TABLE: Record<string, Tier | "execute"> = {
  "phase-plan": "deep",
  "implement-scan": "deep",
  decompose: "deep",
  whole: "execute",
  subtask: "execute",
  wrapup: "simple",
  "phase-handover": "simple",
  knowledge: "simple",
  "prior-knowledge": "simple",
  "number-recovery": "simple",
  diagnose: "simple",
  bypass: "simple",
}

// The type table of §5: each builtin type's execute tier; m mode (no entry)
// is the implicit implement phase.
const EXECUTE_TIERS: Record<string, Tier> = {
  analysis: "deep",
  design: "deep",
  implement: "simple",
  test: "simple",
  acceptance: "deep",
  knowledge: "simple",
}

const custom = (reasoning?: string): PhaseTypeEntry =>
  parsePhaseTypeFile("review", `# Review\n\n${reasoning ? `Reasoning: ${reasoning}\n\n` : ""}## plan duties\n\nPlan the review.\n`)

describe("defaultTier", () => {
  test("every role word has a tier: the role table covers MODEL_ROLES exactly", () => {
    expect(Object.keys(ROLE_TABLE).sort()).toEqual([...MODEL_ROLES].sort())
    for (const role of MODEL_ROLES) {
      for (const entry of [undefined, ...BUILTIN_PHASE_TYPES]) expect(TIERS).toContain(defaultTier(entry, role))
    }
  })

  test("the whole role × builtin type table", () => {
    expect(Object.keys(EXECUTE_TIERS)).toEqual(BUILTIN_PHASE_TYPES.map((entry) => entry.type))
    for (const role of MODEL_ROLES) {
      for (const entry of BUILTIN_PHASE_TYPES) {
        const expected = ROLE_TABLE[role] === "execute" ? EXECUTE_TIERS[entry.type] : ROLE_TABLE[role]
        expect({ role, type: entry.type, tier: defaultTier(entry, role) }).toEqual({ role, type: entry.type, tier: expected! })
      }
    }
  })

  test("planning and understanding sessions are deep in every phase type", () => {
    for (const role of ["phase-plan", "implement-scan", "decompose"] as ModelRole[]) {
      for (const entry of [undefined, ...BUILTIN_PHASE_TYPES, custom("simple")]) expect(defaultTier(entry, role)).toBe("deep")
    }
  })

  test("report, distillation, extraction and one-off sessions are simple in every phase type", () => {
    const roles: ModelRole[] = ["wrapup", "phase-handover", "knowledge", "prior-knowledge", "number-recovery", "diagnose", "bypass"]
    for (const role of roles) {
      for (const entry of [undefined, ...BUILTIN_PHASE_TYPES, custom(), custom("deep")]) expect(defaultTier(entry, role)).toBe("simple")
    }
  })

  test("task sessions take the phase type's execute tier", () => {
    expect(defaultTier(phaseType("design"), "whole")).toBe("deep")
    expect(defaultTier(phaseType("design"), "subtask")).toBe("deep")
    expect(defaultTier(phaseType("implement"), "subtask")).toBe("simple")
    expect(defaultTier(phaseType("acceptance"), "whole")).toBe("deep")
    expect(defaultTier(phaseType("test"), "whole")).toBe("simple")
  })

  test("a custom type's task sessions follow its Reasoning field; absent = deep", () => {
    for (const role of ["whole", "subtask"] as ModelRole[]) {
      expect(defaultTier(custom(), role)).toBe("deep")
      expect(defaultTier(custom("deep"), role)).toBe("deep")
      expect(defaultTier(custom("simple"), role)).toBe("simple")
    }
  })

  test("m mode (no phase entry) is the implicit implement phase", () => {
    for (const role of MODEL_ROLES) expect(defaultTier(undefined, role)).toBe(defaultTier(phaseType("implement"), role))
    expect(defaultTier(undefined, "whole")).toBe("simple")
    expect(defaultTier(undefined, "subtask")).toBe("simple")
    expect(defaultTier(undefined, "implement-scan")).toBe("deep")
    expect(defaultTier(undefined, "decompose")).toBe("deep")
  })
})

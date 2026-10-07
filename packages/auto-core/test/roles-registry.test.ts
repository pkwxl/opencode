// The session-role registry's completeness and totality (U-R5, plans/0060
// §5.6 / 0064 §5 item 4): the seven work kinds each hold exactly one
// descriptor; the routing-word claims are total against MODEL_ROLES (every
// word claimed by exactly one descriptor, the fallback by none); the
// declared templates exist in the live template library; the collect and
// verdict policy ids are within their vocabularies with no dead entry; the
// tier table roleTiers builds matches plans/0055 §5's role table; and a
// missing descriptor fails loudly (sessionRole / routingRole / roleTiers
// throw naming the offender). Also pins the outside mappings the registry
// cannot import: chain.ts's phaseToRole (types-only contract code) must land
// every pipeline phase inside its role descriptor's routing words.
import { describe, expect, test } from "bun:test"
import { phaseToRole, roleOf } from "../src/chain"
import { BUILTIN_PHASE_TYPES, type Tier } from "../src/phases/registry"
import { promptTemplateNames, usePromptLibrary } from "../src/template"
import { MODEL_ROLES, type ModelRole } from "../src/switches"
import {
  COLLECT_POLICIES,
  ROUTING_FALLBACK,
  ROUTING_FALLBACK_TIER,
  SESSION_ROLE_DESCRIPTORS,
  SESSION_ROLES,
  VERDICT_POLICIES,
  roleTiers,
  routingRole,
  sessionRole,
  type SessionRoleEntry,
} from "../src/roles/registry"
import { defaultTier } from "../src/tier"

// plans/0055 §5's role table, restated (the same pin test/tier.test.ts holds
// over defaultTier): the registry must reproduce it exactly — the descriptor
// is now the table's single home, this keeps a silent flip from passing.
const ROLE_TABLE: Record<ModelRole, Tier | "execute"> = {
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

describe("the session-role registry (U-R5, plans/0060 §5.6)", () => {
  test("the seven work kinds each hold exactly one descriptor", () => {
    expect(SESSION_ROLES).toEqual(["decompose", "whole", "subtask", "wrapup", "planning", "handover", "knowledge"])
    expect(SESSION_ROLE_DESCRIPTORS.map((entry) => entry.role).sort()).toEqual([...SESSION_ROLES].sort())
    for (const role of SESSION_ROLES) {
      expect(sessionRole(role).role).toBe(role)
    }
  })

  test("every descriptor declares template, tier route, usage source, collect policy and verdict policy", () => {
    for (const entry of SESSION_ROLE_DESCRIPTORS) {
      expect(entry.routing.length).toBeGreaterThan(0)
      expect(entry.templates.length).toBeGreaterThan(0)
      expect(["deep", "simple", "execute"]).toContain(entry.tier)
      expect(COLLECT_POLICIES).toContain(entry.collect)
      expect(VERDICT_POLICIES).toContain(entry.verdict)
      for (const flag of ["handover", "testHandover", "forkGuard", "splitGuard"] as const) {
        expect(typeof entry.usage[flag]).toBe("boolean")
      }
    }
  })

  test("routing words: every live word is claimed by exactly one descriptor, the fallback by none", () => {
    const claimed = SESSION_ROLE_DESCRIPTORS.flatMap((entry) => [...entry.routing])
    // Every claim names a live word (the descriptor type enforces this at
    // compile time; the runtime check keeps a forged descriptor honest).
    for (const word of claimed) expect(MODEL_ROLES).toContain(word)
    expect(new Set(claimed).size).toBe(claimed.length)
    for (const word of MODEL_ROLES) {
      if (word === ROUTING_FALLBACK) continue
      expect(routingRole(word).routing).toContain(word)
    }
    expect(claimed).not.toContain(ROUTING_FALLBACK)
  })

  test("roleTiers is total over MODEL_ROLES and reproduces plans/0055 §5's role table", () => {
    const tiers = roleTiers()
    expect(Object.keys(tiers).sort()).toEqual([...MODEL_ROLES].sort())
    for (const word of MODEL_ROLES) expect(tiers[word]).toBe(ROLE_TABLE[word])
    // The table defaultTier actually resolves stays a Tier for every word.
    for (const word of MODEL_ROLES) {
      for (const entry of [undefined, ...BUILTIN_PHASE_TYPES]) {
        expect(["deep", "simple"]).toContain(defaultTier(entry, word))
      }
    }
    expect(tiers[ROUTING_FALLBACK]).toBe(ROUTING_FALLBACK_TIER)
  })

  test("a missing or over-claimed descriptor fails loudly", () => {
    expect(() => sessionRole("review")).toThrow(/unknown session role: review \(known: .*\)/)
    expect(() => routingRole(ROUTING_FALLBACK)).toThrow(/claimed by no session role/)
    expect(() => routingRole("final-plan")).toThrow(/claimed by no session role/)
    // A registry missing one work kind: its routing words turn unclaimed and
    // the tier table's build throws naming the word — the load-time half of
    // totality (the typecheck cannot see a doctored runtime list).
    const withoutWhole = SESSION_ROLE_DESCRIPTORS.filter((entry) => entry.role !== "whole")
    expect(withoutWhole).toHaveLength(SESSION_ROLE_DESCRIPTORS.length - 1)
    expect(() => roleTiers(withoutWhole)).toThrow(/routing word whole is claimed by no session role/)
    // A word claimed by two descriptors is equally loud.
    const twice: SessionRoleEntry[] = SESSION_ROLE_DESCRIPTORS.map((entry): SessionRoleEntry =>
      entry.role === "planning" ? { ...entry, routing: [...entry.routing, "subtask"] } : entry,
    )
    expect(() => routingRole("subtask", twice)).toThrow(/claimed by 2 session roles/)
  })

  test("every declared template exists in the template library", () => {
    usePromptLibrary(undefined)
    const names = new Set(promptTemplateNames())
    for (const entry of SESSION_ROLE_DESCRIPTORS) {
      for (const name of entry.templates) expect(names.has(name)).toBeTrue()
    }
  })

  test("the collect and verdict vocabularies carry no dead id", () => {
    for (const policy of COLLECT_POLICIES) {
      expect(SESSION_ROLE_DESCRIPTORS.some((entry) => entry.collect === policy)).toBeTrue()
    }
    for (const policy of VERDICT_POLICIES) {
      expect(SESSION_ROLE_DESCRIPTORS.some((entry) => entry.verdict === policy)).toBeTrue()
    }
  })

  test("the usage policy matches the mechanisms the driving call sites run", () => {
    // The restated policy (the pin against a silent flip): only the
    // execution sessions run usage-driven mechanisms — whole the handover
    // protocol and the lead's split guard, subtask the handover protocol of
    // its streams, the test handover and the fork-base guard; every one-shot
    // session kind runs none.
    expect(sessionRole("whole").usage).toEqual({ handover: true, testHandover: true, forkGuard: false, splitGuard: true })
    expect(sessionRole("subtask").usage).toEqual({ handover: true, testHandover: true, forkGuard: true, splitGuard: false })
    for (const role of ["decompose", "wrapup", "planning", "handover", "knowledge"] as const) {
      expect(sessionRole(role).usage).toEqual({ handover: false, testHandover: false, forkGuard: false, splitGuard: false })
    }
  })

  test("chain.ts phaseToRole lands every pipeline phase inside its role descriptor's routing", () => {
    // phaseToRole is contract-layer types-only code (src/chain.ts) and cannot
    // read the registry module; this pins its mapping to the descriptors'
    // claims instead — the pipeline phase kinds and the work kinds stay in
    // step.
    expect(phaseToRole({ kind: "decompose" })).toBe("decompose")
    expect(phaseToRole({ kind: "whole" })).toBe("whole")
    expect(phaseToRole({ kind: "subtasks" })).toBe("subtask")
    expect(phaseToRole({ kind: "wrapup" })).toBe("wrapup")
    // phase-append keeps the phase-plan role by design (plans/0053 D23/F6).
    expect(phaseToRole({ kind: "step", step: "phase-plan", unit: "R-01.P01" })).toBe("phase-plan")
    expect(phaseToRole({ kind: "step", step: "phase-append", unit: "R-01.P01" })).toBe("phase-plan")
    expect(phaseToRole({ kind: "step", step: "phase-handover", unit: "R-01.P01" })).toBe("phase-handover")
    for (const [phase, role] of [
      [{ kind: "decompose" }, "decompose"],
      [{ kind: "whole" }, "whole"],
      [{ kind: "subtasks" }, "subtask"],
      [{ kind: "wrapup" }, "wrapup"],
      [{ kind: "step", step: "phase-plan", unit: "R-01.P01" }, "planning"],
      [{ kind: "step", step: "phase-append", unit: "R-01.P01" }, "planning"],
      [{ kind: "step", step: "phase-handover", unit: "R-01.P01" }, "handover"],
    ] as const) {
      const word = phaseToRole(phase)
      expect(word).toBeDefined()
      expect(sessionRole(role).routing).toContain(word!)
    }
    // closeout has no session; a bare chain lands on the fallback.
    expect(phaseToRole({ kind: "closeout" })).toBeUndefined()
    expect(roleOf({ pct: 100, used: 0, at: 0 })).toBe(ROUTING_FALLBACK)
  })

  test("the knowledge family's variants and the planning variants all route inside their descriptors", () => {
    expect(sessionRole("knowledge").routing).toEqual(["knowledge", "prior-knowledge", "number-recovery", "diagnose"])
    expect(sessionRole("planning").routing).toEqual(["phase-plan", "implement-scan"])
    expect(sessionRole("decompose").templates).toEqual(["decompose"])
    expect(sessionRole("subtask").templates).toEqual(["subtask", "fanout"])
  })
})

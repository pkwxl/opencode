// The bundle self-ratchet (plans/0080 §7, T-141): for every built-in intent
// bundle, render the prompts its workflows compose — each phase's phase-plan
// prompt (renderPhasePlan with planDutyText over the bundle's own pack), the
// whole-task, subtask and wrap-up prompts — and evaluate them against the
// bundle's own declared asserts (parseGuaranteeAsserts + guaranteeViolation):
// every applicable assert holds. The render exit runs the same gate
// (renderPrompt throws PromptGuaranteeError), so the renders themselves are
// the ratchet: any drift across the bundle's files — the pack, the mode, the
// custom phase-type files, the core templates — that breaks a declared
// guarantee fails here. This is the test that would have caught every gap the
// clean-room assessment found in the shipped bundle: dead phase duties (the
// pack's `### <dutiesRef>` tier no render would carry), migration-framed
// implement duties (phase-plan(m) would still say "code migration"), and the
// unanchored verdict protocol (phase-plan(audit) would lack "verdict.md" and
// "Result: PASS"). The ratchet also proves itself non-vacuous: every
// (template, phase) pair the bundle declares asserts over is rendered here.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { materializeIntentBundle, parseIntentBundle, resolveIntentBundle } from "../src/bundle"
import { guaranteesProblem, guaranteeViolation, parseGuaranteeAsserts, resolvedVerifyPlan, verifyPlanCharterText } from "../src/intent/guarantees"
import { loadIntents, packSubsection, parseIntentFile } from "../src/intent/load"
import type { IntentPack } from "../src/intent/types"
import { loadModes, type ModeSpec } from "../src/mode"
import { loadPhaseTypes } from "../src/phases/custom"
import { BUILTIN_PHASE_TYPES, phaseType, resolvePhases, type PhaseTypeEntry } from "../src/phases/registry"
import { renderFormulationTodo } from "../src/prompt-plan"
import { promptFacts } from "../src/prompt-facts"
import { renderSubtask, renderWhole, renderWrapup, type PromptFacts } from "../src/prompt"
import { taskDocPaths } from "../src/docpaths"
import { promptViews } from "../src/tasks"
import { plan, task } from "./fixtures/prompt"

// The brief every render carries: it names where the reference implementation
// lives and how it is kept apart — the input shape the bundles' modes and
// charters are written against.
const BRIEF = "The reference implementation lives at ../legacy, outside this worktree; the layout keeps it apart from the clean rooms."

// A materialized bundle: the facts, the pack, the mode and the resolved phase
// sequence a project stamped with the bundle ends up running.
type Stamped = {
  name: string
  facts: PromptFacts
  pack: IntentPack
  mode: ModeSpec
  entries: PhaseTypeEntry[]
  dir: string
}

async function stamped(name: string): Promise<Stamped> {
  const bundle = parseIntentBundle((await resolveIntentBundle(name))!)
  const dir = mkdtempSync(join(tmpdir(), "auto-ratchet-"))
  await materializeIntentBundle(dir, bundle)
  const facts = promptFacts({ dir, intent: name })
  return {
    name,
    facts,
    pack: facts.pack,
    mode: loadModes(dir)[name]!,
    entries: resolvePhases(bundle.phases, [...BUILTIN_PHASE_TYPES, ...loadPhaseTypes(dir)])!,
    dir,
  }
}

// The execution-surface shims (the prompt-family tests' fixtures and views).
const views = promptViews(plan, task)
const docs = taskDocPaths(task.id)
const phasePlanOf = (b: Stamped, entry: PhaseTypeEntry, i: number) => {
  const todo = renderFormulationTodo(b.facts, {
    phase: entry,
    phaseId: `R-01.P${String(i + 1).padStart(2, "0")}`,
    taskIndex: `docs/R-01/P${String(i + 1).padStart(2, "0")}-${entry.type}/tasks.md`,
    brief: BRIEF,
    mode: b.mode,
    numberStart: 2,
    charter: "",
  })
  return `${todo.goal}\n\n## Scope\n\n${todo.scope}`
}

describe("the bundle self-ratchet (plans/0080 §7)", () => {
  test("every built-in bundle's composed prompts hold its own declared asserts — phase-plan per phase, whole, subtask, wrapup — and the precedence block rides along", async () => {
    for (const name of ["cleanroom", "faithful", "faithful-lean"] as const) {
      const b = await stamped(name)
      try {
        // The declared asserts exist and parse (the shipped contract is real).
        const asserts = parseGuaranteeAsserts(b.pack)
        expect(asserts).toBeDefined()
        expect(asserts!.length).toBeGreaterThan(0)

        // Each phase's plan prompt, composed the way planPhase composes it:
        // planDutyText over the bundle's pack (the §4 tier — the wiring whose
        // absence once left the pack's phase duties dead).
        const rendered: Array<{ template: string; phase: string | undefined; text: string }> = []
        b.entries.forEach((entry, i) => {
          const text = phasePlanOf(b, entry, i)
          rendered.push({ template: "phase-plan", phase: entry.letter ?? entry.type, text })
          // The precedence block (§3): the planning prompt is where the human
          // input meets the charter, so the authority order rides every render.
          expect(text).toContain("## Authority order (intent guarantees)")
          expect(text).toContain(packSubsection(b.pack, "guarantees", "precedence")!)
        })

        // The execution surfaces under the bundle's mode and off stamp: whole
        // (the run's unit session — no context-budget protocol under off),
        // subtask (a project that decomposes after all) and wrap-up. The
        // renders went through the render gate.
        for (const [template, text] of [
          ["whole", renderWhole(b.facts, views.plan, views.task, docs, { mode: b.mode })],
          ["subtask", renderSubtask(b.facts, views.plan, views.task, docs, "write the schema part of the migration script", { mode: b.mode })],
          ["wrapup", renderWrapup(b.facts, views.plan, views.task, docs, { solo: true, mode: b.mode })],
        ] as const) {
          rendered.push({ template, phase: "m", text })
          expect(text).toContain("Authority order for everything in this prompt:")
          expect(text).not.toMatch(/\{\{|\}\}/)
        }

        // The ratchet itself: every applicable assert holds on every render —
        // a violation would already have thrown PromptGuaranteeError inside
        // the render exit; the explicit check names it for a readable failure.
        for (const out of rendered) {
          expect(guaranteeViolation(b.pack, asserts!, out.template, out.phase, out.text)).toBeUndefined()
        }

        // Non-vacuous: every (template, phase) the bundle declares asserts
        // over is among the rendered pairs — no assert sits dead beside the
        // ratchet (unqualified asserts pair with the m-tagged execution
        // renders and every phase-plan render alike).
        const pairs = new Set(rendered.map((out) => `${out.template}|${out.phase}`))
        for (const assert of asserts!) {
          expect(pairs.has(`${assert.template}|${assert.phase ?? "m"}`)).toBe(true)
        }
      } finally {
        rmSync(b.dir, { recursive: true, force: true })
      }
    }
  })

  // The assessment's named gaps, spelled out so a failure reads as the gap it
  // is. The asserts above already imply each; these pin the three findings
  // against the exact surfaces they escaped through.
  test("the named gaps stay fixed: the pack tier voices implement (no migration framing), the verdict protocol is anchored, the mode boundary reaches whole/subtask", async () => {
    for (const name of ["cleanroom", "faithful", "faithful-lean"] as const) {
      const b = await stamped(name)
      try {
        const entryOf = (type: string) => b.entries.find((entry) => entry.type === type)!
        // The implement duties come from the pack's own tier: the bundle's
        // voice, never the core partial's migration framing.
        const m = phasePlanOf(b, entryOf("implement"), b.entries.findIndex((entry) => entry.type === "implement"))
        expect(m).toContain(packSubsection(b.pack, "phaseDuties", "m")!.split("\n")[0]!.trim())
        expect(m).not.toContain("code migration")
        // The verdict protocol is anchored where the driver parses it.
        const verdictType = name === "cleanroom" ? "audit" : "acceptance"
        const verdictPlan = phasePlanOf(b, entryOf(verdictType), b.entries.findIndex((entry) => entry.type === verdictType))
        expect(verdictPlan).toContain("verdict.md")
        expect(verdictPlan).toContain("Result: PASS")
        // The mode's boundary text reaches the whole-task and subtask
        // surfaces (the `whole`/`subtask` asserts pin the same literals).
        const whole = renderWhole(b.facts, views.plan, views.task, docs, { mode: b.mode })
        const sub = renderSubtask(b.facts, views.plan, views.task, docs, "write the schema part of the migration script", { mode: b.mode })
        expect(whole).toContain(modeAnchor(name))
        expect(sub).toContain(modeAnchor(name))
      } finally {
        rmSync(b.dir, { recursive: true, force: true })
      }
    }
  })
})

// The mode-exec anchor each bundle's `whole`/`subtask` asserts pin (a stable
// literal of the bundle's own mode text).
function modeAnchor(name: string): string {
  const anchors: Record<string, string> = { cleanroom: "Clean-room boundary", faithful: "Faithful parity rule", "faithful-lean": "Lean boundary" }
  return anchors[name]!
}

// —— the per-phase charter channel (plans/0097 D1) ——

// A pack fixture from raw text (the loader's own parser, so the grammar the
// preflight checks is the grammar the loader accepts).
const packOf = (text: string): IntentPack => {
  const dir = mkdtempSync(join(tmpdir(), "auto-keys-"))
  try {
    writeFileSync(join(dir, "pack.md"), text)
    return parseIntentFile("pack", readFileSync(join(dir, "pack.md"), "utf8"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("the per-phase charter channel (plans/0097 D1; keys canonicalized to type ids by plans/0100 D8–D11)", () => {
  test("key validation: a verify-plan-* suffix must be a phase type id, or a preset letter as a legacy spelling", () => {
    const base = (key: string) => `# pack\n\n## guarantees\n\n### ${key}\n\nCharter text.\n`
    // A builtin type id passes (the canonical form); its preset letter passes
    // too (the legacy spelling); a custom id passes when declared.
    expect(guaranteesProblem(packOf(base("verify-plan-test")))).toBeUndefined()
    expect(guaranteesProblem(packOf(base("verify-plan-t")))).toBeUndefined()
    expect(guaranteesProblem(packOf(base("verify-plan-spec-read")), ["spec-read"])).toBeUndefined()
    // A typo'd key is a strict failure naming the pack, the key, and the
    // canonical form (the steering message).
    expect(guaranteesProblem(packOf(base("verify-plan-tests")))).toContain('intent pack "pack" declares "### verify-plan-tests"')
    expect(guaranteesProblem(packOf(base("verify-plan-tests")))).toContain("the suffix is the phase type id")
    expect(guaranteesProblem(packOf(base("verify-plan-tests")))).toContain("legacy spellings")
    // A custom id the project does not declare fails naming the known ids.
    expect(guaranteesProblem(packOf(base("verify-plan-spec-read")), ["audit"])).toContain("declared custom: audit")
    // Both spellings declared for one builtin type: a duplication error,
    // never silent precedence.
    const both = packOf("# pack\n\n## guarantees\n\n### verify-plan-test\n\nId text.\n\n### verify-plan-t\n\nLetter text.\n")
    expect(guaranteesProblem(both)).toContain('declares both "### verify-plan-test" and "### verify-plan-t"')
    // The pack-global charter and the assert lines stay valid as before.
    expect(guaranteesProblem(packOf("# pack\n\n## guarantees\n\n### verify-plan\n\nCharter.\n"))).toBeUndefined()
  })

  test("resolution: id-first, letter-fallback; phaseKey records the key actually consumed", () => {
    const pack = packOf(
      ["# pack", "", "## guarantees", "", "### verify-plan", "", "Global bar.", "", "### verify-plan-t", "", "Test bar.", ""].join("\n"),
    )
    expect(resolvedVerifyPlan(pack, phaseType("test"))).toEqual({ global: "Global bar.", phase: "Test bar.", phaseKey: "t" })
    expect(resolvedVerifyPlan(pack)).toEqual({ global: "Global bar." })
    expect(resolvedVerifyPlan(pack, phaseType("implement"))).toEqual({ global: "Global bar." })
    const only = packOf("# pack\n\n## guarantees\n\n### verify-plan-t\n\nTest bar.\n")
    expect(resolvedVerifyPlan(only, phaseType("test"))).toEqual({ phase: "Test bar.", phaseKey: "t" })
    expect(verifyPlanCharterText(resolvedVerifyPlan(only, phaseType("test")))).toContain("(verify-plan-t)")
    expect(verifyPlanCharterText(resolvedVerifyPlan(only, phaseType("implement")))).toBeUndefined()
    // The canonical id resolves without the letter, and a custom type's id
    // alone resolves (no letter exists to fall back on).
    const byId = packOf("# pack\n\n## guarantees\n\n### verify-plan-test\n\nId bar.\n")
    expect(resolvedVerifyPlan(byId, phaseType("test"))).toEqual({ phase: "Id bar.", phaseKey: "test" })
    const custom: PhaseTypeEntry = { ...phaseType("survey")!, type: "spec-read", origin: "project" }
    const customPack = packOf("# pack\n\n## guarantees\n\n### verify-plan-spec-read\n\nCustom bar.\n")
    expect(resolvedVerifyPlan(customPack, custom)).toEqual({ phase: "Custom bar.", phaseKey: "spec-read" })
    // Id wins when both spellings are somehow declared (the preflight error is
    // the guard; resolution stays deterministic for an unstamped hand-pack).
    const dup = packOf("# pack\n\n## guarantees\n\n### verify-plan-test\n\nId bar.\n\n### verify-plan-t\n\nLetter bar.\n")
    expect(resolvedVerifyPlan(dup, phaseType("test")).phaseKey).toBe("test")
  })

  test("the shipped bundles declare a valid verify-plan-test under the id key (the letter form retired, plans/0100 D12)", async () => {
    for (const name of ["cleanroom", "faithful", "faithful-lean"] as const) {
      const b = await stamped(name)
      try {
        expect(guaranteesProblem(b.pack, b.entries.filter((entry) => entry.origin === "project").map((entry) => entry.type))).toBeUndefined()
        const resolved = resolvedVerifyPlan(b.pack, phaseType("test"))
        expect(resolved.global).toBeDefined()
        expect(resolved.phase).toBeDefined()
        // The id is canonical in every shipped bundle — no letter-keyed charter.
        expect(resolved.phaseKey).toBe("test")
        // De-migrationed wording: the shared spine's non-negotiables.
        expect(resolved.phase).toContain("never invent them")
        expect(resolved.phase).toContain("Adaptive test planning")
        expect(resolved.phase).not.toContain("migration")
      } finally {
        rmSync(b.dir, { recursive: true, force: true })
      }
    }
  })

  // The closing-phase charters (the acceptance phase's plan quality bar): the
  // faithful family keys its builtin acceptance type by id, cleanroom its
  // custom audit type by id — the same family verify-plan-test established.
  test("the shipped bundles declare the closing phase's charter under its id key (acceptance for the faithful family, audit for cleanroom)", async () => {
    for (const name of ["cleanroom", "faithful", "faithful-lean"] as const) {
      const b = await stamped(name)
      try {
        expect(guaranteesProblem(b.pack, b.entries.filter((entry) => entry.origin === "project").map((entry) => entry.type))).toBeUndefined()
        const closing = b.entries.at(-1)!
        const resolved = resolvedVerifyPlan(b.pack, closing)
        expect(resolved.global).toBeDefined()
        expect(resolved.phase).toBeDefined()
        // The id is canonical — a builtin's letter never keys a shipped charter.
        expect(resolved.phaseKey).toBe(closing.type)
        // The shared spine's non-negotiables: evidence re-run by this phase,
        // criteria derived never invented, the item-by-item adjudication, the
        // honest boundary statement, and the verdict following the findings.
        expect(resolved.phase).toContain("never invent criteria")
        expect(resolved.phase).toContain("Negative scope")
        expect(resolved.phase).toContain("Re-run, never cite")
        expect(resolved.phase).toContain("Gap disposition")
        expect(resolved.phase).toContain("follows the findings")
        expect(resolved.phase).not.toContain("migration")
        // The activation consequence: the composed charter names the key.
        expect(verifyPlanCharterText(resolved)).toContain(`(verify-plan-${closing.type})`)
      } finally {
        rmSync(b.dir, { recursive: true, force: true })
      }
    }
  })
})

// The stage-A ratchet (plans/0100 stage A): no shipped bundle declares a
// letter-keyed charter — the id is canonical in what the tool materializes,
// so a stamp never records a letter key (D12's rename-before-any-stamp).
describe("the letter-key ratchet (plans/0100 D12)", () => {
  test("no shipped bundle declares a letter-keyed verify-plan section", () => {
    const dir = join(import.meta.dir, "..", "templates", "bundles")
    const offenders: string[] = []
    for (const name of readdirSync(dir)) {
      const packFile = join(dir, name, "intents")
      if (!existsSync(packFile)) continue
      for (const file of readdirSync(packFile)) {
        const text = readFileSync(join(packFile, file), "utf8")
        for (const line of text.split("\n")) {
          if (/^###\s+verify-plan-[admtvk]\s*$/.test(line)) offenders.push(`${name}/intents/${file}: ${line.trim()}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

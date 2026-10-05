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
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { materializeIntentBundle, parseIntentBundle, resolveIntentBundle } from "../src/bundle"
import { guaranteeViolation, parseGuaranteeAsserts } from "../src/intent/guarantees"
import { loadIntents, packSubsection } from "../src/intent/load"
import type { IntentPack } from "../src/intent/types"
import { loadModes, type ModeSpec } from "../src/mode"
import { loadPhaseTypes } from "../src/phases/custom"
import { BUILTIN_PHASE_TYPES, resolvePhases, type PhaseTypeEntry } from "../src/phases/registry"
import { planDutyText, renderPhasePlan } from "../src/prompt-plan"
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
const phasePlanOf = (b: Stamped, entry: PhaseTypeEntry, i: number) =>
  renderPhasePlan(b.facts, {
    phase: entry,
    planDuties: planDutyText(b.facts, entry),
    phaseId: `R-01.P${String(i + 1).padStart(2, "0")}`,
    taskIndex: `docs/R-01/P${String(i + 1).padStart(2, "0")}-${entry.type}/tasks.md`,
    brief: BRIEF,
    mode: b.mode,
  })

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

        // The execution surfaces under the bundle's mode and ondemand stamp:
        // whole (the run's unit session), subtask (a project that decomposes
        // after all) and wrap-up. The renders went through the render gate.
        for (const [template, text] of [
          ["whole", renderWhole(b.facts, views.plan, views.task, docs, { mode: b.mode, ondemand: true, budget: true })],
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
        const whole = renderWhole(b.facts, views.plan, views.task, docs, { mode: b.mode, ondemand: true })
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

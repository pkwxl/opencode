import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parsePartials, promptTemplateNames, registerPartial, registerTemplate, renderText, renderTemplate, templateRenders, usePromptLibrary } from "../src/template"
import tplDryrun from "../templates/prompts/dryrun.md" with { type: "file" }

// Restore built-ins only after each case, so overlay state never leaks into other test files.
afterEach(() => usePromptLibrary(undefined))

describe("renderer", () => {
  test("variable substitution: a string replaces directly, boolean/undefined render empty", () => {
    expect(renderText("a{{x}}b", { x: "value" })).toBe("avalueb")
    expect(renderText("a{{x}}b", { x: true })).toBe("ab")
    expect(renderText("a{{x}}b", { x: false })).toBe("ab")
    expect(renderText("a{{x}}b", {})).toBe("ab")
  })

  test("conditional blocks: a non-empty string or true is truthy, an empty string/false/undefined falsy", () => {
    expect(renderText("{{#if x}}yes{{/if}}{{^x}}no{{/if}}", { x: "text" })).toBe("yes")
    expect(renderText("{{#if x}}yes{{/if}}{{^x}}no{{/if}}", { x: true })).toBe("yes")
    expect(renderText("{{#if x}}yes{{/if}}{{^x}}no{{/if}}", { x: "" })).toBe("no")
    expect(renderText("{{#if x}}yes{{/if}}{{^x}}no{{/if}}", {})).toBe("no")
  })

  test("conditional blocks nest", () => {
    expect(renderText("{{#if a}}A{{#if b}}B{{/if}}{{/if}}", { a: true, b: true })).toBe("AB")
    expect(renderText("{{#if a}}A{{#if b}}B{{/if}}{{/if}}", { a: true })).toBe("A")
  })

  test("a block tag alone on its line swallows the whole line, leaving no blank-line residue", () => {
    const text = ["head", "", "{{#if x}}", "middle", "", "{{/if}}", "tail"].join("\n")
    expect(renderText(text, { x: true })).toBe("head\n\nmiddle\n\ntail")
    expect(renderText(text, {})).toBe("head\n\ntail")
  })

  test("unclosed / unmatched closing tags throw", () => {
    expect(() => renderText("{{#if x}}content", { x: true })).toThrow("unclosed")
    expect(() => renderText("{{/if}}", {})).toThrow("unmatched {{/if}}")
    expect(() => renderText("{{#if x}}content{{/each}}", { x: true })).toThrow("unknown closing tag")
  })

  test("partial references: a shared partial renders against the current context (variables usable inside)", () => {
    usePromptLibrary(undefined)
    // state-rule retired with the constitution consolidation (0072 U-B/T-131:
    // its two rules live in the AGENTS.md block alone); question-rule is the
    // variable-carrying partial now: its branch selection reads ctx vars and
    // its zero-intent fallback carries the marker formats.
    expect(renderText("{{> question-rule}}", {})).toContain("do not call the question tool")
    expect(renderText("{{> question-rule}}", {})).toContain("AUTO-DECISION")
    expect(renderText("{{> question-rule}}", { humanQuestions: true })).toContain("no automatic proxy answer")
  })

  test("when a partial stands alone on its line the line's leading indent applies to every line; an inline reference applies only from the second line on (stacking on the partial body's own indent)", () => {
    usePromptLibrary(undefined)
    // A registered fixture partial (engine test, carrier-independent — the
    // constitution ratchet owns the shipped sections' wording).
    registerPartial("indent-fixture", "First rule line.\nSecond rule line.")
    const standalone = renderText("before:\n   {{> indent-fixture}}\nafter", {})
    expect(standalone.split("\n")[1]).toBe("   First rule line.")
    expect(standalone.split("\n")[2]).toBe("   Second rule line.")
    const inline = renderText("before:\n   {{> indent-fixture}};tail", {})
    expect(inline.split("\n").at(-1)).toBe("   Second rule line.;tail")
  })
})

describe("shared partial parsing", () => {
  test("## sections parse into partial bodies with leading/trailing blank lines trimmed; the H1 and out-of-section prose are ignored", () => {
    const partials = parsePartials("# Title\nIntro prose is ignored.\n\n## a\n\nBody A\n\n\n## b\nBody B\n")
    expect(partials.a).toBe("Body A")
    expect(partials.b).toBe("Body B")
  })

  test("the doc-layout section exists and carries no template variables; task templates referencing it render the task-scoped placement rules", () => {
    usePromptLibrary(undefined)
    const text = renderText("{{> doc-layout}}", {})
    expect(text).toContain("Document placement rules")
    expect(text).toContain("docs/T-NNN/")
    expect(text).toContain("S<two-digit index>/index.md")
    expect(text).toContain("do not create flat task files at the top level of docs/")
    // Slimmed to task-scoped placement (0072 U-B/T-131, K9): the permanence
    // doctrine, the reference form and the DRIVER-ownership of state files
    // are the AGENTS.md constitution's wordings now — the drift ratchet
    // (test/constitution-ratchet.test.ts) holds them out of every carrier.
    expect(text).not.toContain("these paths are permanent")
    expect(text).not.toContain("managed by the DRIVER")
    expect(text).not.toContain("phases.md")
    // No template variables: templates without taskId (phase-plan and friends) can reference it too
    expect(text).not.toMatch(/\{\{|\}\}/)
    // Referencing renders: decompose (the task-document writer) and phase-plan (the planner without taskId) both carry the section
    expect(renderTemplate("decompose", { taskId: "T-001", taskBlock: "x" })).toContain("Document placement rules")
    expect(renderTemplate("phase-plan", { phase: "a", phaseName: "analysis" })).toContain("Document placement rules")
  })
})

describe("built-in template registry", () => {
  test("all 32 session templates plus _partials present (understand merged into decompose since M1.0; phase-append see 0053 D27; step-up and classify-error see 0055 §4.5, §7.1; usage notes see 0056; split-rejected see 0059 D4; fanout see 0059 D5; digest-index see 0061 R3)", () => {
    expect(promptTemplateNames()).toEqual([
      "_partials",
      "classify-error",
      "context-base",
      "decompose",
      "decompose-a",
      "decompose-d",
      "decompose-k",
      "decompose-m",
      "decompose-t",
      "decompose-v",
      "digest-index",
      "dryrun",
      "fanout",
      "handoff-steer",
      "implement-plan",
      "knowledge",
      "number-recovery",
      "phase-append",
      "phase-handover",
      "phase-plan",
      "prior-knowledge",
      "split-rejected",
      "step-up",
      "stuck-hint",
      "subtask",
      "test-continue",
      "test-result",
      "test-wrapup",
      "usage-note-info",
      "usage-note-winddown",
      "whole",
      "wrapup",
    ])
  })

  test("every built-in template renders (representative context, no leftover tags)", () => {
    const ctx = {
      taskId: "T-001",
      taskBlock: "# T-001\n\nbody",
      doneList: "- [done] T-000: prerequisite",
      gap: "gap",
      digest: "## Related files and key symbols\n- src/x.ts",
      subtask: "subtask",
      index: "1",
      subtaskList: "1. Task A\n2. Task B",
      outputFile: "docs/T-001/S01/index.md",
      warm: true,
      scriptPath: "/tmp/verify.sh",
      verifyState: "not declared",
      handoffFile: "docs/T-001/handoff.md",
      stageName: "final audit",
      round: "1",
      proposalFile: "docs/final/plan-audit-r1.md",
      runScript: "/x",
      runCode: "0",
      runMs: "1",
      runTimeout: "no",
      runOut: "/out",
      replacement: "/r",
      laterVerifyList: "   (none)",
      final: true,
      early: true,
      solo: true,
      ondemand: true,
      continuation: true,
      reaudit: false,
      stageAudit: true,
      stageRemediate: false,
      stageValidate: false,
      stageFinalize: false,
      blockedAnswered: false,
      blockedUnanswered: false,
      question: "",
      answer: "",
      modeName: "migrate",
      modeInit: "intro",
      modeExec: "note",
      emphasis: "emphasis",
      prior: "upstream",
      file: "docs/R-01/P04-knowledge/kb.md",
      phase: "a",
      phaseName: "analysis",
      brief: "project intent",
      handovers: "### P01-analysis Analysis(docs/R-01/P01-analysis/handover.md)",
      prevRound: "### Previous round (round 1) phase directory index",
      archive: "docs/R-01/P01-analysis",
      next: "P02-implement Implementation",
      finalReview: "2",
      planDuties: "- duties",
      verify: true,
      testByDriver: true,
      handoverTest: true,
      contextBudget: "32.0k",
      fine: true,
      fromFile: true,
      filePath: "docs/rough-plan.md",
      content: "Do A first, then B",
      input: "append-planning input",
      inputPath: "docs/R-01/P02-implement/plan-input.md",
      existingTasks: "- [pending] T-004: existing task",
      fromModel: "prov/model-256k",
      toModel: "prov/model",
      now: "2026-09-26T15:00:00+08:00",
      tz: "Asia/Shanghai",
      error: "429 usage limit reached",
      total: "48.3k",
      cap: "16.0k",
    }
    for (const name of promptTemplateNames().filter((item) => item !== "_partials")) {
      expect(renderTemplate(name, ctx)).not.toMatch(/\{\{|\}\}/)
    }
  })
})

describe("per-phase decompose templates decompose-<phase>", () => {
  const six = ["a", "d", "m", "t", "v", "k"] as const

  // Since M1.2 externalized the intent, the granularity criteria and the
  // phase-duties section are no longer baked into the template; prompt.ts injects
  // the intent-pack content through the decomposeRule/phaseDuties variables. The
  // template layer keeps only the role boundary, the format protocol and the
  // injection hook points. Content assertions live in test/intent.test.ts and
  // test/prompt-exec.test.ts.
  test("all six present: each carries the checklist protocol and the intent-injection hook points, injected content lands in the right place", () => {
    usePromptLibrary(undefined)
    for (const letter of six) {
      const text = renderTemplate(`decompose-${letter}`, {
        taskId: "T-001",
        taskBlock: "# T-001\n\nbody",
        phaseName: "phase name",
        contextBudget: "32.0k",
        decomposeRule: "RULE-SENTINEL",
        phaseDuties: "DUTIES-SENTINEL",
      })
      expect(text).toContain("- [ ]")
      expect(text).toContain("This session completes the task-background understanding and the subtask decomposition; it writes no implementation code")
      expect(text).toContain("The current phase is phase name")
      expect(text).toContain("RULE-SENTINEL")
      expect(text).toContain("DUTIES-SENTINEL")
      // The injection points precede the checklist protocol (5. Write the decomposition into …)
      expect(text.indexOf("DUTIES-SENTINEL")).toBeLessThan(text.indexOf("5. Write the decomposition into"))
      expect(text).not.toMatch(/\{\{|\}\}/)
    }
  })

  test("zero-intent baseline: with the injection variables absent the whole block disappears, no blank-line residue, no leftover tags", () => {
    usePromptLibrary(undefined)
    for (const letter of six) {
      const text = renderTemplate(`decompose-${letter}`, {
        taskId: "T-001",
        taskBlock: "# T-001\n\nbody",
        phaseName: "phase name",
      })
      expect(text).toContain("- [ ]")
      expect(text).not.toMatch(/\{\{|\}\}/)
      expect(text).not.toMatch(/\n\n\n/)
    }
  })
})

describe("target-directory overrides (.opencode/auto/prompts/)", () => {
  test("a same-named template overrides the built-in, the new content takes effect", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "subtask.md"), "Custom subtask prompt: {{subtask}}")
      usePromptLibrary(dir)
      expect(renderTemplate("subtask", { subtask: "Task A" })).toBe("Custom subtask prompt: Task A")
      // A non-overridden template still loads the built-in
      expect(renderTemplate("dryrun", {})).toContain("permission pre-check")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a trailing document terminator line is file metadata, dropped on load", () => {
    // Built-in: phase-handover.md ends with the terminator; the rendered prompt does not.
    expect(renderTemplate("phase-handover", { handover: "handover.md" })).not.toContain("<!-- auto: eof -->")
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "subtask.md"), "Custom subtask prompt: {{subtask}}\n\n<!-- auto: eof -->\n")
      writeFileSync(join(overlay, "dryrun.md"), "End with `<!-- auto: eof -->`")
      usePromptLibrary(dir)
      expect(renderTemplate("subtask", { subtask: "A" })).toBe("Custom subtask prompt: A")
      // Only a line holding the terminator alone is dropped; inline mentions stay prompt text.
      expect(renderTemplate("dryrun", {})).toBe("End with `<!-- auto: eof -->`")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("handoff-steer override: pre-flip status literals are rejected, English loads (M3.7, open question 17)", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "handoff-steer.md"), "交接: 写 {{handoffFile}},末行 `状态: 继续` 或 `状态: 完成`")
      expect(() => usePromptLibrary(dir)).toThrow(/handoff-steer\.md is missing required protocol content: Status: continue, Status: done/)
      usePromptLibrary(undefined)
      writeFileSync(join(overlay, "handoff-steer.md"), "handover: write {{handoffFile}}, last line `Status: continue` or `Status: done`")
      usePromptLibrary(dir)
      expect(renderTemplate("handoff-steer", { handoffFile: "h.md" })).toContain("Status: continue")
      usePromptLibrary(undefined)
      writeFileSync(join(overlay, "handoff-steer.md"), "handover without any status line")
      expect(() => usePromptLibrary(dir)).toThrow(/handoff-steer\.md is missing required protocol content: Status: continue, Status: done/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a protocol-sensitive template override missing a protocol line errors and names the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "wrapup.md"), "an ad-hoc wrap-up prompt with no result-line protocol")
      expect(() => usePromptLibrary(dir)).toThrow(/wrapup\.md is missing required protocol content/)
      expect(() => usePromptLibrary(dir)).toThrow(/Result: PASS/)
      rmSync(join(overlay, "wrapup.md"))
      // A phase-handover override missing the four required section headings → same error; then test decompose after the fix
      writeFileSync(join(overlay, "phase-handover.md"), "a custom handover prompt that dropped the section protocol")
      expect(() => usePromptLibrary(dir)).toThrow(/phase-handover\.md is missing required protocol content/)
      expect(() => usePromptLibrary(dir)).toThrow(/## Key decisions/)
      writeFileSync(
        join(overlay, "phase-handover.md"),
        "a custom handover prompt, protocol kept: ## Key decisions ## Constraints and pitfalls ## Required reading for the next phase ## Artifact index written to {{handover}}",
      )
      // A decompose override losing the context.md/todo.md artifact protocol (M1.0 merged session) → same error
      writeFileSync(join(overlay, "decompose.md"), "a custom decompose prompt that dropped the artifact protocol and the checklist format")
      expect(() => usePromptLibrary(dir)).toThrow(/decompose\.md is missing required protocol content/)
      expect(() => usePromptLibrary(dir)).toThrow(/context\.md/)
      expect(() => usePromptLibrary(dir)).toThrow(/todo\.md/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a phase-append override missing a tier-1 marker (skeleton + {{taskIndex}}/{{existingTasks}}/{{input}}) errors (0053 D27/§6)", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      // The task-unit skeleton is complete but {{existingTasks}} is gone (the existing-task list is the append contract's anchor)
      writeFileSync(
        join(overlay, "phase-append.md"),
        ["Append planning: {{taskIndex}} writes {{input}}", "# T-NNN: <task title>", "Phase: {{phaseId}}", "## Goal", "## Scope", "## Acceptance", "- [ ] T-NNN <task title>"].join("\n"),
      )
      expect(() => usePromptLibrary(dir)).toThrow(/phase-append\.md is missing required protocol content/)
      expect(() => usePromptLibrary(dir)).toThrow(/\{\{existingTasks\}\}/)
      usePromptLibrary(undefined)
      // Skeleton and {{taskIndex}} present, but {{input}} gone (appending always targets the planning input, D23)
      writeFileSync(
        join(overlay, "phase-append.md"),
        ["Append planning: {{taskIndex}}", "# T-NNN: <task title>", "Phase: {{phaseId}}", "## Goal", "## Scope", "## Acceptance", "- [ ] T-NNN <task title>", "{{existingTasks}}"].join("\n"),
      )
      expect(() => usePromptLibrary(dir)).toThrow(/\{\{input\}\}/)
      // Complete (three skeleton sections + index line + three slots) → loads and renders
      writeFileSync(
        join(overlay, "phase-append.md"),
        [
          "Append planning: append after {{taskIndex}}",
          "# T-NNN: <task title>",
          "Phase: {{phaseId}}",
          "## Goal",
          "## Scope",
          "## Acceptance",
          "- [ ] T-NNN <task title>",
          "Existing: {{existingTasks}}",
          "Input: {{input}}",
        ].join("\n"),
      )
      usePromptLibrary(dir)
      expect(renderTemplate("phase-append", { taskIndex: "docs/R-01/P02-implement/tasks.md", existingTasks: "- [pending] T-004: A", input: "B" })).toContain("Existing: - [pending] T-004: A")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a _partials override merges by section name, non-overridden sections keep the built-in; an overridden section must keep its tier-1 protocol markers", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      // state-rule is a tier-1 protocol-sensitive section: an override must keep the
      // todo.md → done.md anchor (overrides written before the CURRENT.md mirror
      // retired carry it too, plans/0054 D3)
      writeFileSync(join(overlay, "_partials.md"), "## state-rule\nCustom state rule: CURRENT.md and the todo.md → done.md renames remain maintained by the DRIVER alone.")
      usePromptLibrary(dir)
      expect(renderText("{{> state-rule}}", {})).toBe("Custom state rule: CURRENT.md and the todo.md → done.md renames remain maintained by the DRIVER alone.")
      expect(renderText("{{> question-rule}}", {})).toContain("AUTO-DECISION")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a protocol-sensitive partial-section override missing a tier-1 marker errors and names the section (M1.3 two-tier markers)", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "_partials.md"), "## state-rule\nCustom state rules, the state-file anchor dropped.")
      expect(() => usePromptLibrary(dir)).toThrow(/section state-rule is missing required protocol content/)
      expect(() => usePromptLibrary(dir)).toThrow(/todo\.md → done\.md/)
      writeFileSync(join(overlay, "_partials.md"), "## eof-rule\nJust write it out; no terminator needed.")
      expect(() => usePromptLibrary(dir)).toThrow(/section eof-rule is missing required protocol content/)
      expect(() => usePromptLibrary(dir)).toThrow(/<!-- auto: eof -->/)
      writeFileSync(join(overlay, "_partials.md"), "## question-rule\nAsk questions freely.")
      expect(() => usePromptLibrary(dir)).toThrow(/section question-rule is missing required protocol content/)
      expect(() => usePromptLibrary(dir)).toThrow(/AUTO-RESOLVE/)
      // An unlisted section (digest-rule, say) is not protocol-sensitive; overriding it needs no markers
      writeFileSync(join(overlay, "_partials.md"), "## digest-rule\nCustom reference discipline.")
      usePromptLibrary(dir)
      expect(renderText("{{> digest-rule}}", {})).toBe("Custom reference discipline.")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("dynamic registration (registerTemplate)", () => {
  test("registering an extra template: immediately renderable (conditional syntax included) and listed among the template names", () => {
    registerTemplate("shell-extra", "Shell extra prompt: {{topic}}{{#if strict}} (strict){{/if}}")
    expect(renderTemplate("shell-extra", { topic: "parameter inference", strict: true })).toBe("Shell extra prompt: parameter inference (strict)")
    expect(renderTemplate("shell-extra", { topic: "parameter inference" })).toBe("Shell extra prompt: parameter inference")
    expect(promptTemplateNames()).toContain("shell-extra")
  })

  test("a registration survives usePromptLibrary reloads; on a built-in name the registered content wins, a target-directory override still outranks both", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      registerTemplate("shell-extra", "Registered version: {{topic}}")
      registerTemplate("dryrun", "The shell's replacement permission pre-check prompt")
      usePromptLibrary(dir)
      expect(renderTemplate("shell-extra", { topic: "A" })).toBe("Registered version: A")
      expect(renderTemplate("dryrun", {})).toBe("The shell's replacement permission pre-check prompt")
      // Same-name precedence: target-directory override > registration > built-in
      // (loading the same directory a second time must reset first; loading short-circuits idempotently)
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "dryrun.md"), "User-overridden pre-check prompt")
      usePromptLibrary(undefined)
      usePromptLibrary(dir)
      expect(renderTemplate("dryrun", {})).toBe("User-overridden pre-check prompt")
      expect(renderTemplate("shell-extra", { topic: "B" })).toBe("Registered version: B")
    } finally {
      rmSync(dir, { recursive: true, force: true })
      // The registry is a module-level global: restore the built-in dryrun copy to avoid
      // cross-test-file pollution (renderDryrun and friends)
      registerTemplate("dryrun", readFileSync(tplDryrun, "utf8"))
    }
  })

  test("registering with markers: a target-directory override missing the protocol line errors", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      registerTemplate("shell-protocol", "Shell protocol template", ["verdict: pass"])
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "shell-protocol.md"), "Override dropped the protocol line")
      expect(() => usePromptLibrary(dir)).toThrow(/shell-protocol\.md is missing required protocol content/)
      expect(() => usePromptLibrary(dir)).toThrow(/verdict: pass/)
      writeFileSync(join(overlay, "shell-protocol.md"), "Override keeps the protocol line: verdict: pass")
      usePromptLibrary(dir)
      expect(renderTemplate("shell-protocol", {})).toBe("Override keeps the protocol line: verdict: pass")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("an empty template name / empty content / registering _partials wholesale is rejected (per section use registerPartial)", () => {
    expect(() => registerTemplate("", "content")).toThrow("template name must not be empty")
    expect(() => registerTemplate("shell-empty", "   ")).toThrow("template shell-empty must not be empty")
    expect(() => registerTemplate("_partials", "## x\ncontent")).toThrow(/whole-file registration is not accepted/)
    expect(() => registerTemplate("_partials", "## x\ncontent")).toThrow(/registerPartial/)
  })
})

describe("per-section partial registration (registerPartial, M1.3)", () => {
  test("registering a shared partial section: immediately renderable and kept across usePromptLibrary reloads", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      registerPartial("shell-note", "Shell note: {{topic}}")
      expect(renderText("{{> shell-note}}", { topic: "A" })).toBe("Shell note: A")
      usePromptLibrary(dir)
      expect(renderText("{{> shell-note}}", { topic: "B" })).toBe("Shell note: B")
    } finally {
      rmSync(dir, { recursive: true, force: true })
      usePromptLibrary(undefined)
      registerPartial("shell-note", "reset")
      usePromptLibrary(undefined)
    }
  })

  test("on a built-in section name the registered content wins, a target-directory _partials.md override still outranks it", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      const builtin = renderText("{{> digest-rule}}", {})
      registerPartial("digest-rule", "Registered reference discipline")
      expect(renderText("{{> digest-rule}}", {})).toBe("Registered reference discipline")
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "_partials.md"), "## digest-rule\nUser-overridden reference discipline.")
      usePromptLibrary(dir)
      expect(renderText("{{> digest-rule}}", {})).toBe("User-overridden reference discipline.")
      // Restore the built-in section copy to avoid cross-test-file pollution
      usePromptLibrary(undefined)
      registerPartial("digest-rule", builtin)
      usePromptLibrary(undefined)
      expect(renderText("{{> digest-rule}}", {})).toBe(builtin)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("registering with markers: a target-directory override missing the section's marker errors", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      registerPartial("shell-rule", "Shell protocol partial: KEEP-ME", ["KEEP-ME"])
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "_partials.md"), "## shell-rule\nOverride dropped the anchor.")
      expect(() => usePromptLibrary(dir)).toThrow(/section shell-rule is missing required protocol content/)
      expect(() => usePromptLibrary(dir)).toThrow(/KEEP-ME/)
      writeFileSync(join(overlay, "_partials.md"), "## shell-rule\nOverride keeps the KEEP-ME anchor.")
      usePromptLibrary(dir)
      expect(renderText("{{> shell-rule}}", {})).toBe("Override keeps the KEEP-ME anchor.")
    } finally {
      rmSync(dir, { recursive: true, force: true })
      usePromptLibrary(undefined)
      registerPartial("shell-rule", "reset")
      usePromptLibrary(undefined)
    }
  })

  test("an empty partial name / empty content is rejected", () => {
    expect(() => registerPartial("", "content")).toThrow("partial name must not be empty")
    expect(() => registerPartial("shell-empty-partial", "   ")).toThrow("partial shell-empty-partial must not be empty")
  })
})

describe("optional slots (templateRenders, plans/0053 D11)", () => {
  // A phase-plan override carrying every tier-1 marker but no {{input}}: one
  // written before the planning-input slot existed.
  const OLD_PHASE_PLAN = [
    "Plan {{phaseId}} into {{taskIndex}}.",
    "- [ ] T-NNN <task title>",
    "# T-NNN: <task title>",
    "Phase: {{phaseId}}",
    "## Goal",
    "## Scope",
    "## Acceptance",
  ].join("\n")

  test("the built-in phase-plan renders {{input}}", () => {
    expect(templateRenders("phase-plan", "input")).toBe(true)
    expect(templateRenders("phase-plan", "noSuchSlot")).toBe(false)
  })

  test("an override without the slot still loads (not a tier-1 marker) and reports it missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "phase-plan.md"), OLD_PHASE_PLAN)
      usePromptLibrary(dir)
      expect(templateRenders("phase-plan", "input")).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a slot rendered through a partial counts", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tpl-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "phase-plan.md"), `${OLD_PHASE_PLAN}\n{{> my-input}}`)
      writeFileSync(join(overlay, "_partials.md"), "## my-input\n\n{{#if input}}Asked for: {{input}}{{/if}}")
      usePromptLibrary(dir)
      expect(templateRenders("phase-plan", "input")).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("an unknown template throws", () => {
    expect(() => templateRenders("no-such-template", "input")).toThrow("unknown prompt template")
  })
})

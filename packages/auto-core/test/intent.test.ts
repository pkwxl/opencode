// Intent-pack loader tests (M1.1, plans/0031). Covers the file protocol
// (parse), the built-in registry, the project overlay with wholesale
// same-name override, and degenerate resolution (single active pack).
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadIntents, packSubsection, parseIntentFile, resolveIntent, dutiesForPhase } from "../src/intent/load"
import { DEFAULT_INTENT, INTENT_SECTIONS, PARALLEL_LEVELS } from "../src/intent/types"

function packText(name: string, sections: Record<string, string>): string {
  const parts = [`# ${name}`]
  for (const [heading, body] of Object.entries(sections)) parts.push(`## ${heading}`, body)
  return parts.join("\n\n") + "\n"
}

describe("intent file protocol (parseIntentFile)", () => {
  test("a full pack captures all six sections in canonical order", () => {
    const pack = parseIntentFile(
      "x",
      packText("x", {
        quality: "split rules.",
        "phase duties": "duties.",
        acceptance: "acceptance semantics.",
        governance: "decision discipline.",
        "artifact spec": "artifact conventions.",
        parallelism: "planning width.",
      }),
    )
    expect(pack.name).toBe("x")
    expect(pack.quality).toBe("split rules.")
    expect(pack.phaseDuties).toBe("duties.")
    expect(pack.acceptance).toBe("acceptance semantics.")
    expect(pack.governance).toBe("decision discipline.")
    expect(pack.artifactSpec).toBe("artifact conventions.")
    expect(pack.parallelism).toBe("planning width.")
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
  test("the built-in registry ships the default pack carrying the migrated decompose intent (M1.2)", () => {
    const packs = loadIntents()
    expect(Object.keys(packs)).toEqual([DEFAULT_INTENT])
    const pack = packs[DEFAULT_INTENT]!
    expect(pack.name).toBe(DEFAULT_INTENT)
    // The decompose family's (b)-class content lives here, not in the core
    // templates: split granularity criteria (quality / ### decompose) and
    // per-phase duties; the subtask family's closing self-check sentences
    // joined in M1.3 (quality / ### self-check-subtask + ### self-check-whole);
    // the subtask output-placement convention joined in M1.4 (artifact spec /
    // ### subtask-output).
    expect(packSubsection(pack, "quality", "decompose")).toContain("Decomposition granularity criteria")
    expect(packSubsection(pack, "quality", "self-check-subtask")).toBe("check for yourself whether this subtask is genuinely complete")
    expect(packSubsection(pack, "quality", "self-check-whole")).toBe("once the whole task is complete, check for yourself whether it is genuinely complete")
    expect(packSubsection(pack, "artifactSpec", "subtask-output")).toContain("Artifact placement convention")
    expect(pack.phaseDuties).toContain("Vertical thin slices first")
    // M2.1: the understand/wrap-up/knowledge family — context.md layout and
    // report forms (artifact spec), knowledge quality bars and the stuck-hint
    // reflection (quality), question-rule's decision catalog and the wrap-up
    // audit scope (governance). The AGENTS.md maintenance rules retired with
    // session-maintained AGENTS.md (plans/0054 D2).
    expect(packSubsection(pack, "artifactSpec", "context-digest")).toContain("## Risks and unknowns")
    expect(packSubsection(pack, "artifactSpec", "report-indexed")).toContain("an indexed report")
    expect(packSubsection(pack, "artifactSpec", "report-solo")).toContain("a summary of the output")
    expect(packSubsection(pack, "quality", "knowledge")).toContain("Final state first")
    expect(packSubsection(pack, "quality", "prior-knowledge")).toContain("deduplicate across documents")
    expect(packSubsection(pack, "quality", "stuck-reflection")).toContain("Write these three things out")
    expect(packSubsection(pack, "governance", "decisions-unattended")).toContain("{{resolveFormat}}")
    expect(packSubsection(pack, "governance", "decisions-ask")).toContain("instead of deciding in the user's place")
    expect(packSubsection(pack, "governance", "wrapup-audit")).toContain("pure implementation trade-offs")
    expect(packSubsection(pack, "governance", "agents-maintenance")).toBeUndefined()
    expect(packSubsection(pack, "acceptance", "result-line")).toContain("Never write PASS for a check you did not run or observe")
    // MP.1: planning guidance per parallel level; none has no subsection.
    for (const level of PARALLEL_LEVELS) expect(packSubsection(pack, "parallelism", level)).toContain("Touches:")
    expect(packSubsection(pack, "parallelism", "high")).toContain("split aggressively")
    expect(packSubsection(pack, "parallelism", "none")).toBeUndefined()
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

describe("subsection addressing (packSubsection, M1.3 generalization)", () => {
  const pack = parseIntentFile(
    "x",
    `# x

## quality

### decompose

split criteria.

### self-check-whole 整任务收尾自查

check the whole task.

## acceptance

flat acceptance text, no subsections.
`,
  )

  test("extracts any section's subsection body by key; headings may carry a suffix", () => {
    expect(packSubsection(pack, "quality", "decompose")).toBe("split criteria.")
    expect(packSubsection(pack, "quality", "self-check-whole")).toBe("check the whole task.")
  })

  test("unknown keys, flat sections, and absent sections yield undefined", () => {
    expect(packSubsection(pack, "quality", "nope")).toBeUndefined()
    // A section without ### subsections has no addressable keys (text before
    // the first ### is never injected).
    expect(packSubsection(pack, "acceptance", "decompose")).toBeUndefined()
    expect(packSubsection(parseIntentFile("y", "# y\n\n## quality\nq\n"), "governance", "x")).toBeUndefined()
  })

  test("dutiesForPhase stays the phaseDuties-keyed wrapper (M3 dutiesRef target)", () => {
    const withDuties = parseIntentFile("z", "# z\n\n## phase duties\n\n### m\n\nduties.\n")
    expect(dutiesForPhase(withDuties, "m")).toBe("duties.")
    expect(dutiesForPhase(withDuties, "v")).toBeUndefined()
  })
})

describe("per-phase duties addressing (dutiesForPhase)", () => {
  const pack = parseIntentFile(
    "x",
    `# x

## phase duties

### a 分析

duties for a.

### m 迁移实现

duties for m,
two lines.
`,
  )

  test("extracts the subsection body by key; headings may carry a suffix", () => {
    expect(dutiesForPhase(pack, "a")).toBe("duties for a.")
    expect(dutiesForPhase(pack, "m")).toBe("duties for m,\ntwo lines.")
  })

  test("unknown keys and absent sections yield undefined (zero-intent baseline)", () => {
    expect(dutiesForPhase(pack, "k")).toBeUndefined()
    expect(dutiesForPhase(parseIntentFile("y", "# y\n\n## quality\nq\n"), "m")).toBeUndefined()
  })

  test("the built-in default pack carries duties for all six letters (M1.2 migration)", () => {
    const builtin = resolveIntent(loadIntents())
    for (const letter of ["a", "d", "m", "t", "v", "k"]) {
      expect(dutiesForPhase(builtin, letter)).toContain("Splitting and artifact criteria for this phase ({{phaseName}})")
    }
  })
})


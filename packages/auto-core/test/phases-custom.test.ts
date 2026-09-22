// Custom phase types (M3.6, plans/0047 §5): the per-type definition file
// .opencode/auto/phases/<type>.md (parsePhaseTypeFile / loadPhaseTypes) and the
// two forms of the phases value (resolvePhases / phasesProblem).
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadPhaseTypes, parsePhaseTypeFile, PHASE_TYPE_DIR, typeNameProblem } from "../src/phases/custom"
import { BUILTIN_PHASE_TYPES, phasesProblem, resolvePhases } from "../src/phases/registry"
import { phaseTypeRoleProblems } from "../src/switches"

const FULL = [
  "# Security review",
  "",
  "Tasks: yes",
  "Gate: verdict",
  "Phase-artifacts: threat-model.md, `notes/scope.md`",
  "Task-artifacts: review.md",
  "",
  "## plan duties",
  "",
  "Plan one review task per trust boundary.",
  "",
  "## decompose duties",
  "",
  "Split by attack surface.",
  "",
  "<!-- auto: eof -->",
  "",
].join("\n")

const MINIMAL = "# Review\n\n## plan duties\n\nPlan the review.\n"

describe("parsePhaseTypeFile", () => {
  test("full file → a project entry with fields, both duty sections and generic decompose", () => {
    expect(parsePhaseTypeFile("security-review", FULL)).toEqual({
      type: "security-review",
      name: "Security review",
      dutiesRef: "security-review",
      planDuties: "Plan one review task per trust boundary.",
      decomposeDuties: "Split by attack surface.",
      decomposeTemplate: "decompose-m",
      phaseArtifacts: [
        { path: "threat-model.md", label: "threat-model.md", role: "artifact" },
        { path: "notes/scope.md", label: "notes/scope.md", role: "artifact" },
      ],
      taskArtifacts: [{ path: "review.md", label: "review.md", role: "artifact" }],
      hasTasks: true,
      gates: ["verdict"],
      origin: "project",
    })
  })

  test("Gate takes a comma list (plans/0049 G7)", () => {
    const entry = parsePhaseTypeFile("review", "# Review\n\nGate: verdict, acceptance\n\n## plan duties\n\nx\n")
    expect(entry.gates).toEqual(["verdict", "acceptance"])
    expect(parsePhaseTypeFile("review", "# Review\n\nGate: none\n\n## plan duties\n\nx\n").gates).toEqual([])
  })

  test("minimal file → defaults: tasks, no gate, no artifacts, no decompose duties", () => {
    const entry = parsePhaseTypeFile("review", MINIMAL)
    expect(entry).toMatchObject({ hasTasks: true, gates: [], phaseArtifacts: [], taskArtifacts: [] })
    expect(entry.decomposeDuties).toBeUndefined()
    expect(entry.letter).toBeUndefined()
  })

  test("invalid files throw naming the file and the offending part", () => {
    const cases: Array<[string, RegExp]> = [
      ["no title\n\n## plan duties\n\nx\n", /must start with a title line/],
      ["# R\n\nTasks: no\n\n## plan duties\n\nx\n", /Tasks: no is not supported/],
      ["# R\n\nTasks: maybe\n\n## plan duties\n\nx\n", /Tasks must be yes/],
      ["# R\n\nGate: strict\n\n## plan duties\n\nx\n", /Gate must be none or a comma list/],
      ["# R\n\nGate: verdict, verdict\n\n## plan duties\n\nx\n", /Gate must be none or a comma list/],
      ["# R\n\nOwner: me\n\n## plan duties\n\nx\n", /unknown field\(s\) owner/],
      ["# R\n\nPhase-artifacts: ../out.md\n\n## plan duties\n\nx\n", /must be relative to the unit directory/],
      ["# R\n\nPhase-artifacts: /abs.md\n\n## plan duties\n\nx\n", /must be relative/],
      ["# R\n\nPhase-artifacts: handover.md\n\n## plan duties\n\nx\n", /driver-owned file name/],
      ["# R\n\nTask-artifacts: report.md\n\n## plan duties\n\nx\n", /driver-owned file name/],
      ["# R\n\n## plan duties\n\n<!-- auto: eof -->\n", /non-empty "## plan duties"/],
      ["# R\n\n## plan duties\n\nx\n\n## notes\n\ny\n", /unknown section "## notes"/],
      ["# R\n\n## plan duties\n\nx\n\n## plan duties\n\ny\n", /repeats section/],
    ]
    for (const [text, pattern] of cases) {
      expect(() => parsePhaseTypeFile("review", text)).toThrow(pattern)
      expect(() => parsePhaseTypeFile("review", text)).toThrow(join(PHASE_TYPE_DIR, "review.md"))
    }
  })
})

describe("typeNameProblem", () => {
  test("accepts directory-grammar names that are not builtin or preset-shaped", () => {
    for (const name of ["review", "security-review", "x", "p2-check"]) expect(typeNameProblem(name)).toBeUndefined()
  })

  test("rejects bad shape, builtin ids and preset-shaped names", () => {
    expect(typeNameProblem("Review")).toContain("lowercase")
    expect(typeNameProblem("2nd")).toContain("lowercase")
    expect(typeNameProblem("implement")).toContain("builtin")
    expect(typeNameProblem("mad")).toContain("letter preset")
  })

  test("role words are rejected by the driver for project types only (phaseTypeRoleProblems)", () => {
    expect(phaseTypeRoleProblems(["review", "wrapup", "final-plan"])).toHaveLength(2)
    expect(phaseTypeRoleProblems(["review"])).toEqual([])
  })
})

describe("loadPhaseTypes", () => {
  test("no dir / no directory → builtins only; project files append in name order", () => {
    expect(loadPhaseTypes()).toEqual([...BUILTIN_PHASE_TYPES])
    const dir = mkdtempSync(join(tmpdir(), "auto-phase-types-"))
    try {
      expect(loadPhaseTypes(dir)).toEqual([...BUILTIN_PHASE_TYPES])
      mkdirSync(join(dir, PHASE_TYPE_DIR), { recursive: true })
      writeFileSync(join(dir, PHASE_TYPE_DIR, "security-review.md"), FULL)
      writeFileSync(join(dir, PHASE_TYPE_DIR, "review.md"), MINIMAL)
      writeFileSync(join(dir, PHASE_TYPE_DIR, "README.txt"), "not a type")
      const types = loadPhaseTypes(dir)
      expect(types.map((entry) => entry.type)).toEqual([...BUILTIN_PHASE_TYPES.map((entry) => entry.type), "review", "security-review"])
      writeFileSync(join(dir, PHASE_TYPE_DIR, "design.md"), MINIMAL)
      expect(() => loadPhaseTypes(dir)).toThrow(/builtin phase type/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("resolvePhases / phasesProblem", () => {
  const types = [...BUILTIN_PHASE_TYPES, parsePhaseTypeFile("review", MINIMAL)]
  const ids = (raw: string) => resolvePhases(raw, types)?.map((entry) => entry.type)

  test("preset form keeps the whitelist rule; list form is ordered, repeatable, must contain implement", () => {
    expect(ids("amt")).toEqual(["analysis", "implement", "test"])
    expect(ids("tma")).toBeUndefined()
    expect(ids("review,implement,review")).toEqual(["review", "implement", "review"])
    expect(ids("implement")).toEqual(["implement"])
    expect(ids("review")).toBeUndefined()
    expect(resolvePhases("review,implement")).toBeNull() // builtins only by default
  })

  test("phasesProblem names the failing rule", () => {
    expect(phasesProblem("tma", types)).toContain("subsequence of admtvk")
    expect(phasesProblem("review,nope,implement", types)).toContain("unknown phase type(s) nope (known: analysis")
    expect(phasesProblem("review,,implement", types)).toContain("without empty items")
    expect(phasesProblem("review,test", types)).toContain("must contain implement")
  })
})

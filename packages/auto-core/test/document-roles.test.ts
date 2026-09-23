// Document role model (M2.3, plans/0045): the path → role classifier, the
// role-derived policies (eof scan exemption, protect list, P1 scope), and the
// P1 prohibition scan with its git input (unitAddedLines). The relocated
// handoff protocol checks keep their cases in handover/phases tests.
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { processReferenceScan } from "../src/document/process-refs"
import { eofScanExempt, p1Scope, PROTECTED_FILES, roleOf, ROLE_POLICIES } from "../src/document/roles"
import { subtaskStateSpec } from "../src/document/spec"
import type { AddedLine } from "../src/document/types"
import { unitAddedLines, unitBaseline } from "../src/git"
import { phaseAcceptanceDoc, phaseArtifacts, phaseHandoverDoc, phaseIndexPath, syncPhaseIndex } from "../src/phases"
import { planInputPath } from "../src/plan-input"
import { freshRepo, git } from "./fixtures/runner"

describe("roleOf", () => {
  const table: [string, string][] = [
    ["CURRENT.md", "driverState"],
    [".auto/progress.json", "driverState"],
    [".auto", "driverState"],
    ["opencode.json", "driverState"],
    [".opencode/auto/config.json", "driverState"],
    ["docs/R-01/phases.md", "ledger"], // phase index
    ["docs/T-001/handoff.md", "handoff"],
    ["docs/T-001/S02/testhandoff-3.md", "handoff"],
    ["docs/R-02/P02-design/handover.md", "handoff"], // phase handover
    ["docs/R-100/P12-custom-type/handover.md", "handoff"],
    ["docs/R-01/P05-acceptance/acceptance.md", "phaseAcceptance"],
    ["docs/R-01/P05-acceptance/acceptance-r2.md", "phaseAcceptance"],
    ["docs/R-01/P02-implement/plan-input.md", "planningInput"], // planning input (plans/0053 D10)
    ["docs/R-01/P02-implement/sub/plan-input.md", "artifact"], // not the phase's planning input
    ["docs/T-001/plan-input.md", "artifact"],
    ["docs/T-001/context.md", "artifact"],
    ["docs/T-001/S01/index.md", "artifact"],
    ["docs/T-001/S01/todo.md", "artifact"],
    ["docs/T-001/S01/done.md", "artifact"],
    ["docs/R-01/P01-analysis/todo.md", "artifact"], // phase state files
    ["docs/R-01/P01-analysis/done.md", "artifact"],
    ["docs/R-01/P06-knowledge/kb.md", "artifact"], // type-standard artifact
    ["docs/R-01/P01-analysis/survey.md", "artifact"], // free phase artifact
    ["docs/R-01/P01-analysis/sub/handover.md", "artifact"], // not the phase handover
    // Retired layouts have no shapes (M3.7): the paths are plain project files.
    ["PLAN.md", "freeform"],
    ["docs/phases.md", "freeform"],
    ["docs/T-001.context.md", "freeform"],
    ["docs/T-001.handoff.md", "freeform"],
    ["docs/T-001-S2.testhandoff-1.md", "freeform"],
    ["docs/handovers/R1-a-analysis.md", "freeform"],
    ["docs/phase-docs/R1-d-design/acceptance.md", "freeform"],
    ["docs/prior-kb/R1-prior-2026-09-07_01-02-03.md", "freeform"],
    ["README.md", "freeform"],
    ["docs/guide.md", "freeform"], // the project's own docs/
    ["docs/agents/build.md", "freeform"],
    ["src/main.c", "freeform"],
    ["AGENTS.md", "freeform"],
    [".opencode/agent/auto.md", "freeform"],
  ]
  for (const [path, role] of table) {
    test(`${path} → ${role}`, () => {
      expect(roleOf(path)).toBe(role as ReturnType<typeof roleOf>)
    })
  }

  test("./-prefixed and backslash paths classify like their plain form", () => {
    expect(roleOf("./docs/T-001/handoff.md")).toBe("handoff")
    expect(roleOf("docs\\T-001\\context.md")).toBe("artifact")
  })

  test("the subtask state pair is an artifact on both sides (state = which file exists)", () => {
    const spec = subtaskStateSpec("T-004", 3)
    expect(roleOf(spec.pending.path)).toBe("artifact")
    expect(roleOf(spec.complete.path)).toBe("artifact")
    expect(spec.pending.role).toBe("artifact")
  })

  test("the phase directory builders produce paths the classifier reads correctly", async () => {
    const dir = await freshRepo()
    try {
      for (const unit of await syncPhaseIndex(dir, 2, "admtvk")) {
        expect(roleOf(phaseAcceptanceDoc(unit))).toBe("phaseAcceptance")
        expect(roleOf(phaseHandoverDoc(unit))).toBe("handoff")
        expect(roleOf(planInputPath(unit))).toBe("planningInput")
        expect(roleOf(`${unit.dir}/todo.md`)).toBe("artifact")
        for (const spec of phaseArtifacts(unit)) expect(roleOf(spec.path)).toBe("artifact")
      }
      expect(roleOf(phaseIndexPath(2))).toBe("ledger")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("role-derived policies", () => {
  test("eofScanExempt follows the role policy", () => {
    for (const rel of ["CURRENT.md", ".auto/x.md", "docs/R-01/phases.md", "docs/R-01/P03-implement/handover.md", "docs/R-01/P05-acceptance/acceptance.md", "docs/R-01/P03-implement/plan-input.md"]) {
      expect(eofScanExempt(rel), rel).toBe(true)
    }
    for (const rel of ["docs/T-001/S01/todo.md", "docs/T-001/report.md", "README.md"]) {
      expect(eofScanExempt(rel), rel).toBe(false)
    }
  })

  test("every protected file is driverState", () => {
    for (const file of PROTECTED_FILES) expect(roleOf(file), file).toBe("driverState")
  })

  test("only freeform is a deliverable-side role", () => {
    const deliverable = Object.entries(ROLE_POLICIES).filter(([, policy]) => !policy.process).map(([role]) => role)
    expect(deliverable).toEqual(["freeform"])
  })

  test("p1Scope: deliverable files in, process documents and agent-contract surfaces out", () => {
    for (const rel of ["src/main.c", "README.md", "docs/guide.md", "test/build.sh", "docs/agents/build.md"]) expect(p1Scope(rel), rel).toBe(true)
    for (const rel of ["docs/T-001/report.md", "CURRENT.md", ".auto/progress.json", "AGENTS.md", ".opencode/auto/prompts/subtask.md", "docs/R-01/phases.md", "docs/R-01/P02-implement/plan-input.md"]) {
      expect(p1Scope(rel), rel).toBe(false)
    }
  })
})

describe("processReferenceScan", () => {
  const lines = (...texts: string[]): AddedLine[] => texts.map((text, i) => ({ line: i + 1, text }))

  test("each tool-owned path shape is a violation, with file:line in the message", () => {
    const { problems } = processReferenceScan(
      new Map([
        ["src/a.c", lines("// see docs/T-003/S01/index.md for the layout")],
        ["src/b.c", lines("x", "/* per docs/R-02/P02-design/handover.md */")],
        ["tools/run.sh", lines('cat ./.auto/progress.json')],
      ]),
    )
    expect(problems).toHaveLength(3)
    const a = problems.find((p) => p.startsWith("src/a.c"))
    expect(a).toContain('src/a.c:1 references "docs/T-003/S01/index.md"')
    expect(a).toContain("must not reference process documents")
    expect(problems.find((p) => p.startsWith("src/b.c"))).toContain('src/b.c:2 references "docs/R-02/P02-design/handover.md"')
    expect(problems.find((p) => p.startsWith("tools/run.sh"))).toContain('".auto/progress.json"')
  })

  test("look-alikes are not violations", () => {
    const { problems } = processReferenceScan(
      new Map([
        [
          "src/a.c",
          lines(
            "see docs/guide.md",
            "mydocs/T-1 is unrelated",
            "x.auto/ is a build dir",
            "docs/Tutorial.md",
            // Retired layouts (M3.7): a project's own PLAN.md or docs/phases/ is no process document.
            "Progress lives in PLAN.md.",
            "# notes in docs/phases/round-1/",
          ),
        ],
      ]),
    )
    expect(problems).toEqual([])
  })

  test("process documents and contract surfaces may reference process paths", () => {
    const { problems } = processReferenceScan(
      new Map([
        ["docs/T-001/report.md", lines("see docs/T-001/S01/index.md")],
        ["AGENTS.md", lines("Read .auto/progress.json first")],
        [".opencode/auto/prompts/subtask.md", lines("read docs/{{taskId}}/context.md and docs/T-001/x")],
      ]),
    )
    expect(problems).toEqual([])
  })

  test("AUTO-* marks: self-contained is fine, a pointer into the process side is not", () => {
    const ok = processReferenceScan(new Map([["src/a.c", lines("// AUTO-DECISION: keep the ring buffer at 64 entries (measured peak 41)")]]))
    expect(ok.problems).toEqual([])
    const bad = processReferenceScan(new Map([["src/a.c", lines("// AUTO-DECISION: see docs/T-004/report.md")]]))
    expect(bad.problems).toHaveLength(1)
  })

  test("a bare task id only warns", () => {
    const { problems, warnings } = processReferenceScan(new Map([["src/a.c", lines("// fixed in T-012", "int T-0x;")]]))
    expect(problems).toEqual([])
    expect(warnings).toEqual(["src/a.c: 1 added line(s) mention a task id (T-NNN); deliverable text should not point at process records"])
  })

  test("hits per file are capped in the message", () => {
    const { problems } = processReferenceScan(new Map([["src/a.c", lines(...Array.from({ length: 5 }, (_, i) => `// docs/T-00${i}/x.md`))]]))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("src/a.c:3")
    expect(problems[0]).not.toContain("src/a.c:4")
    expect(problems[0]).toContain("(and 2 more in this file)")
  })
})

describe("unitAddedLines", () => {
  test("only lines added since the baseline: tracked edits, commits inside the unit, untracked files", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, "a.c"), "// old docs/T-001/x.md\nint a;\n")
      await Bun.write(join(dir, "gone.c"), "int g;\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-q", "-m", "init")
      const baseline = await unitBaseline(dir)
      // Committed inside the unit (a handover boundary) still counts.
      await Bun.write(join(dir, "mid.c"), "int m;\n")
      await git(dir, "add", "mid.c")
      await git(dir, "commit", "-q", "-m", "mid")
      await Bun.write(join(dir, "a.c"), "// old docs/T-001/x.md\nint a;\n++ plus-prefixed content\nint b;\n")
      await Bun.write(join(dir, "new.c"), "one\ntwo\n")
      await rm(join(dir, "gone.c"))
      const added = await unitAddedLines(dir, baseline)
      expect(added.get("a.c")).toEqual([
        { line: 3, text: "++ plus-prefixed content" },
        { line: 4, text: "int b;" },
      ])
      expect(added.get("mid.c")).toEqual([{ line: 1, text: "int m;" }])
      expect(added.get("new.c")?.slice(0, 2)).toEqual([
        { line: 1, text: "one" },
        { line: 2, text: "two" },
      ])
      expect(added.has("gone.c")).toBe(false)
      // The pre-existing reference in a.c is outside the unit's scope.
      expect(processReferenceScan(added).problems).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("empty baseline (non-git / gate off) yields nothing from git", async () => {
    expect((await unitAddedLines(join(tmpdir(), "nonexistent-dir"), [])).size).toBe(0)
  })
})

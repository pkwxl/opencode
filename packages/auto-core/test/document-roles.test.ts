// Document role model (M2.3, plans/0045): the path → role classifier, the
// role-derived policies (eof scan exemption, protect list, P1 scope), and the
// P1 prohibition scan with its git input (unitAddedLines). The relocated
// handoff protocol checks keep their cases in handover/phases tests.
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { processReferenceScan } from "../src/document/process-refs"
import { eofScanExempt, p1Scope, PROTECTED_FILES, roleOf, ROLE_POLICIES, scanExempted } from "../src/document/roles"
import { subtaskStateSpec } from "../src/document/spec"
import type { AddedLine } from "../src/document/types"
import { driverBaseline, unitAddedLines, unitBaseline } from "../src/git"
import { phaseAcceptanceDoc, phaseArtifacts, phaseHandoverDoc, phaseIndexPath, syncPhaseIndex } from "../src/phases"
import { planInputPath } from "../src/plan-input"
import { freshRepo, git } from "./fixtures/runner"

describe("roleOf", () => {
  const table: [string, string][] = [
    // The retired task mirror (plans/0054 D3) has no role of its own.
    ["CURRENT.md", "freeform"],
    [".auto/progress.json", "driverState"],
    [".auto", "driverState"],
    ["opencode.json", "driverState"],
    [".opencode/auto/config.json", "driverState"],
    ["docs/R-01/phases.md", "ledger"], // phase index
    ["docs/T-001/handoff.md", "handoff"],
    ["docs/T-001/S02/testhandoff-3.md", "handoff"],
    // the per-stream session handoff of lane streams (plans/0068 S5): the
    // family reads by file name, wherever under docs/ it sits
    ["docs/T-001/S02/handoff.md", "handoff"],
    ["docs/R-02/P02-design/handover.md", "handoff"], // phase handover
    ["docs/R-100/P12-custom-type/handover.md", "handoff"],
    ["docs/R-01/P05-acceptance/acceptance.md", "phaseAcceptance"],
    ["docs/R-01/P05-acceptance/acceptance-r2.md", "phaseAcceptance"],
    ["docs/R-01/P02-implement/plan-input.md", "planningInput"], // planning input (plans/0053 D10)
    ["docs/R-01/P02-implement/sub/plan-input.md", "artifact"], // not the phase's planning input
    ["docs/T-001/plan-input.md", "artifact"],
    ["docs/analysis.md", "analysisDoc"], // the pre-round project analysis (plans/0084)
    ["docs/T-001/analysis.md", "artifact"], // not the project analysis — task-level
    ["docs/R-01/P01-analysis/analysis.md", "artifact"], // not the project analysis — phase-level
    ["docs/T-001/context.md", "artifact"],
    ["docs/T-001/S01/index.md", "artifact"],
    ["docs/T-001/S01/todo.md", "artifact"],
    ["docs/T-001/S01/done.md", "artifact"],
    // The test-lane plan and receipts (plans/0096 D4): the task-role family's
    // free content — no own role, the artifact policy as-is.
    ["docs/T-001/testplan.md", "artifact"],
    ["docs/T-001/testhands/lint.md", "artifact"],
    ["docs/T-001/testhands/gate.md", "artifact"],
    ["docs/T-001/testhands/nested/x.md", "artifact"],
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
    for (const rel of ["opencode.json", ".auto/x.md", "docs/R-01/phases.md", "docs/R-01/P03-implement/handover.md", "docs/R-01/P05-acceptance/acceptance.md", "docs/R-01/P03-implement/plan-input.md"]) {
      expect(eofScanExempt(rel), rel).toBe(true)
    }
    for (const rel of ["docs/T-001/S01/todo.md", "docs/T-001/report.md", "README.md"]) {
      expect(eofScanExempt(rel), rel).toBe(false)
    }
    // The lane receipts carry the eof terminator (plans/0096 D4): no
    // exemption, whatever a scanExempt glob says (the roles keep their
    // policies) — the plan document likewise follows its family's policy.
    for (const rel of ["docs/T-001/testplan.md", "docs/T-001/testhands/lint.md"]) {
      expect(eofScanExempt(rel), rel).toBe(false)
      expect(eofScanExempt(rel, ["docs/**"]), rel).toBe(false)
      expect(p1Scope(rel), rel).toBe(false)
    }
  })

  test("every protected file is driverState", () => {
    for (const file of PROTECTED_FILES) expect(roleOf(file), file).toBe("driverState")
  })

  test("only freeform is a deliverable-side role", () => {
    const deliverable = Object.entries(ROLE_POLICIES).filter(([, policy]) => !policy.process).map(([role]) => role)
    expect(deliverable).toEqual(["freeform"])
  })

  test("p1Scope: deliverable-side roles in, process documents out; workspace surfaces are in by role — the scan's nested gate keeps them out (plans/0108)", () => {
    for (const rel of ["src/main.c", "README.md", "docs/guide.md", "test/build.sh", "docs/agents/build.md", "AGENTS.md", ".opencode/auto/prompts/subtask.md", "prompts/run.md"]) expect(p1Scope(rel), rel).toBe(true)
    for (const rel of ["docs/T-001/report.md", ".auto/progress.json", "docs/R-01/phases.md", "docs/R-01/P02-implement/plan-input.md"]) {
      expect(p1Scope(rel), rel).toBe(false)
    }
  })
})

describe("scan exemptions (config scanExempt, plans/0059 X2)", () => {
  const globs = ["test/fixtures/**", "templates/prompts/", "docs/*.sample.md", "pkg/{a,b}/golden"]

  test("scanExempted: a glob matches the path or one of its parent directories", () => {
    for (const rel of [
      "test/fixtures/report.md",
      "test/fixtures/deep/nested/x.ts",
      "templates/prompts/subtask.md",
      "templates/prompts/sub/dir.md",
      "./templates/prompts/x.md",
      "docs/plan.sample.md",
      "pkg/a/golden/x.md",
      "pkg/b/golden",
    ]) {
      expect(scanExempted(rel, globs), rel).toBe(true)
    }
    for (const rel of ["test/other.ts", "templates/intents/default.md", "docs/sub/plan.sample.md", "pkg/c/golden/x.md", "README.md"]) {
      expect(scanExempted(rel, globs), rel).toBe(false)
    }
    expect(scanExempted("test/fixtures/report.md")).toBe(false)
    expect(scanExempted("test/fixtures/report.md", [])).toBe(false)
  })

  test("only deliverable paths are exempted: a process document stays scanned, a matching glob cannot widen or narrow the role policy", () => {
    // A glob over docs/ would reach the task records; the terminator scan still covers them.
    expect(scanExempted("docs/T-001/report.md", ["docs/**"])).toBe(false)
    expect(eofScanExempt("docs/T-001/report.md", ["docs/**"])).toBe(false)
    expect(scanExempted("docs/guide.md", ["docs/**"])).toBe(true)
    // Exempt by role already, whatever the list says.
    expect(eofScanExempt("docs/R-01/phases.md", [])).toBe(true)
  })

  test("p1Scope and eofScanExempt consult the list", () => {
    expect(p1Scope("test/fixtures/report.md")).toBe(true)
    expect(p1Scope("test/fixtures/report.md", globs)).toBe(false)
    expect(p1Scope("src/main.c", globs)).toBe(true)
    expect(eofScanExempt("templates/prompts/subtask.md")).toBe(false)
    expect(eofScanExempt("templates/prompts/subtask.md", globs)).toBe(true)
    expect(eofScanExempt("README.md", globs)).toBe(false)
  })

  test("processReferenceScan skips exempted files (destination paths, plans/0108 scope)", () => {
    const added = new Map<string, AddedLine[]>([
      ["dest/test/fixtures/report.md", [{ line: 1, text: "see docs/T-003/S01/index.md (T-003)" }]],
      ["dest/src/a.c", [{ line: 2, text: "// see .auto/progress.json" }]],
    ])
    const nested = { nested: ["dest"] as const }
    expect(processReferenceScan(added, [], nested).problems).toEqual([])
    expect(processReferenceScan(added, [], nested).deferredCount).toBe(2)
    const scan = processReferenceScan(added, ["dest/test/fixtures/**"], nested)
    expect(scan.deferredCount).toBe(1)
    expect(processReferenceScan(added, ["dest/**"], nested).deferredCount).toBe(0)
  })
})

describe("processReferenceScan", () => {
  const lines = (...texts: string[]): AddedLine[] => texts.map((text, i) => ({ line: i + 1, text }))

  test("each tool-owned path shape is a finding — counted in rounds, itemized with file:line at release (plans/0103 D2's second addendum)", () => {
    const added = new Map([
      ["dest/src/a.c", lines("// see docs/T-003/S01/index.md for the layout")],
      ["dest/src/b.c", lines("x", "/* per docs/R-02/P02-design/handover.md */")],
      ["dest/tools/run.sh", lines('cat ./.auto/progress.json')],
    ])
    const rounds = processReferenceScan(added, [], { nested: ["dest"] })
    expect(rounds.problems).toEqual([])
    expect(rounds.deferredCount).toBe(3)
    const { problems } = processReferenceScan(added, [], { nested: ["dest"], release: true })
    expect(problems).toHaveLength(3)
    const a = problems.find((p) => p.startsWith("dest/src/a.c"))
    expect(a).toContain('dest/src/a.c:1 references "docs/T-003/S01/index.md"')
    expect(a).toContain("must not reference process documents")
    expect(problems.find((p) => p.startsWith("dest/src/b.c"))).toContain('dest/src/b.c:2 references "docs/R-02/P02-design/handover.md"')
    expect(problems.find((p) => p.startsWith("dest/tools/run.sh"))).toContain('".auto/progress.json"')
  })

  test("look-alikes are not violations", () => {
    const { problems } = processReferenceScan(
      new Map([
        [
          "dest/src/a.c",
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
      [],
      { nested: ["dest"] },
    )
    expect(problems).toEqual([])
  })

  test("the working directory's own files are never scanned — process workspace, whatever they reference (plans/0108)", () => {
    // The deliverable is the nested destination repositories' own files;
    // test tooling, the manual-driver prompts/ suite and the agent-contract
    // surfaces are workspace, and process documents keep their referenced-side
    // standing.
    const { problems, deferredCount } = processReferenceScan(
      new Map([
        ["src/a.c", lines("see docs/T-003/S01/index.md for the layout")],
        ["test/lane.sh", lines("tail .auto/run.lock; docs/T-004/report.md")],
        ["AGENTS.md", lines("Read .auto/progress.json first")],
        [".opencode/auto/prompts/subtask.md", lines("read docs/{{taskId}}/context.md and docs/T-001/x")],
        ["prompts/run.md", lines("tail docs/T-NNN/handoff.md; .auto/run.lock holds the driver")],
        ["docs/T-001/report.md", lines("see docs/T-001/S01/index.md")],
      ]),
      [],
      { nested: ["dest"] },
    )
    expect(problems).toEqual([])
    expect(deferredCount).toBe(0)
  })

  test("AUTO-* marks: self-contained is fine, a pointer into the process side is a recorded finding", () => {
    const ok = processReferenceScan(new Map([["dest/src/a.c", lines("// AUTO-DECISION: keep the ring buffer at 64 entries (measured peak 41)")]]), [], { nested: ["dest"] })
    expect(ok.problems).toEqual([])
    expect(ok.deferredCount).toBe(0)
    const bad = processReferenceScan(new Map([["dest/src/a.c", lines("// AUTO-DECISION: see docs/T-004/report.md")]]), [], { nested: ["dest"] })
    expect(bad.problems).toEqual([])
    expect(bad.deferredCount).toBe(1)
    expect(processReferenceScan(new Map([["dest/src/a.c", lines("// AUTO-DECISION: see docs/T-004/report.md")]]), [], { nested: ["dest"], release: true }).problems).toHaveLength(1)
  })

  test("a bare task id is fine in the outer workspace, recorded inside a nested repository, blocking at release (plans/0103 D2; the record is a count, plans/0109 D6)", () => {
    // The workspace's own scripts name tasks freely — no check runs there.
    const outer = processReferenceScan(new Map([["test/lane.sh", lines("// fixed in T-012", "echo T-012 done")]]))
    expect(outer.problems).toEqual([])
    expect(outer.deferredCount).toBe(0)
    // While rounds run the finding is recorded as the aggregate count, never
    // blocking and never itemized (the release gate's output is the fix
    // list).
    const rounds = processReferenceScan(
      new Map([["vendor/src/a.c", lines("// the geometry slot (T-012 §2.2)", "int T-0x;")]]),
      [],
      { nested: ["vendor"] },
    )
    expect(rounds.problems).toEqual([])
    expect(rounds.deferredCount).toBe(1)
    // The release posture is the enforcement moment.
    const release = processReferenceScan(
      new Map([["vendor/src/a.c", lines("// the geometry slot (T-012 §2.2)", "int T-0x;")]]),
      [],
      { nested: ["vendor"], release: true },
    )
    expect(release.deferredCount).toBe(0)
    expect(release.problems).toEqual([
      "vendor/src/a.c: 1 line(s) mention a task id (T-NNN) — restate the content in place and remove the id: the destination must stand alone to release",
    ])
  })

  test("inside a nested repository, no path may lead outside its own root — recorded in rounds, blocking at release (plans/0103 D2)", () => {
    const dir = "/work/target"
    const added = new Map([
      // A climb within the file's depth inside the repository stays in.
      ["vendor/kernel/lib/a.rs", lines('include_str!("../../rust-toolchain.toml")')],
      // Past the file's depth escapes; an absolute path under the target
      // directory names the workspace the repository ships out of.
      ["vendor/src/b.c", lines('path = "../../outside"', "// verified by /work/target/test/t053_ktest.sh")],
      // /usr and friends are system paths, not workspace references.
      ["vendor/src/c.c", lines('open("/dev/null")', '#include "/usr/include/stdio.h"')],
    ])
    const rounds = processReferenceScan(added, [], { nested: ["vendor"], dir })
    expect(rounds.problems).toEqual([])
    expect(rounds.deferredCount).toBe(2)
    const release = processReferenceScan(added, [], { nested: ["vendor"], dir, release: true })
    expect(release.deferredCount).toBe(0)
    expect(release.problems).toHaveLength(1)
    expect(release.problems[0]).toContain('vendor/src/b.c:1 references "../../outside"')
    expect(release.problems[0]).toContain("no path may lead outside the destination's own root")
  })

  test("hits per file are capped in the release message; the round-time count is not", () => {
    const added = new Map([["dest/src/a.c", lines(...Array.from({ length: 5 }, (_, i) => `// docs/T-00${i}/x.md`))]])
    const rounds = processReferenceScan(added, [], { nested: ["dest"] })
    expect(rounds.deferredCount).toBe(5)
    const { problems } = processReferenceScan(added, [], { nested: ["dest"], release: true })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("dest/src/a.c:3")
    expect(problems[0]).not.toContain("dest/src/a.c:4")
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

describe("driverBaseline (plans/0119: git's modified view replaces the whole tree)", () => {
  // The driver commit shape the unified commit writes (git.ts message): a
  // subject plus the Auto-Task/Auto-Stage trailers.
  const driverMessage = (subject: string) => `${subject}\n\nAuto-Task: T-001\nAuto-Stage: implement`

  test("a pristine person history never enters the scan: the baseline is HEAD itself", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, "a.c"), "// see docs/T-001/report.md\nint a;\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-q", "-m", "person work")
      const head = (await git(dir, "rev-parse", "HEAD")).trim()
      expect(await driverBaseline(dir)).toBe(head)
      // The scan that follows sees only uncommitted/untracked state — the
      // committed person content is not the migration's ledger.
      const added = await unitAddedLines(dir, [{ root: dir, sha: await driverBaseline(dir) }])
      expect(added.size).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the run of driver commits back from HEAD is the scan's range; a person commit on top closes it", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, "seed.c"), "int s;\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-q", "-m", "person seed")
      const seed = (await git(dir, "rev-parse", "HEAD")).trim()
      await Bun.write(join(dir, "first.c"), "// wiring per docs/T-002/report.md\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-q", "-m", driverMessage("first driver write"))
      await Bun.write(join(dir, "second.c"), "int n;\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-q", "-m", driverMessage("second driver write"))
      expect(await driverBaseline(dir)).toBe(seed)
      const added = await unitAddedLines(dir, [{ root: dir, sha: await driverBaseline(dir) }])
      expect(added.has("first.c")).toBe(true)
      expect(added.has("second.c")).toBe(true)
      expect(added.has("seed.c")).toBe(false)
      // A person commit on top of the run closes it: the baseline moves to
      // their commit, the buried driver run stays unscanned.
      await Bun.write(join(dir, "person.c"), "// the T-009 slot\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-q", "-m", "person on top")
      const top = (await git(dir, "rev-parse", "HEAD")).trim()
      expect(await driverBaseline(dir)).toBe(top)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a history of driver commits alone, and a repository without any commit, take the empty baseline", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, "a.c"), "int a;\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-q", "-m", driverMessage("the whole history is the project's"))
      expect(await driverBaseline(dir)).toBe("")
      const empty = await mkdtemp(join(tmpdir(), "auto-runner-"))
      try {
        await git(empty, "init", "-q")
        expect(await driverBaseline(empty)).toBe("")
      } finally {
        await rm(empty, { recursive: true, force: true })
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

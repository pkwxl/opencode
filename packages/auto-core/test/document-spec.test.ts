// Document-domain artifact spec machinery (M1.4, plans/0034): the `Artifacts:`
// declaration parser (moved from plan.ts — cases carried over), the spec
// builders (decompose artifact table, subtask state pair) and the generic
// spec-driven checker under both policies ("mandatory" for the merged
// decompose session, "declared" for subtask-loop declarations).

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { EOF_MARK } from "../src/doccheck"
import { checkArtifactSpecs, declaredArtifacts, decomposeArtifactSpecs, directoryArtifactSpecs, SUBTASK_TODO_SECTIONS, subtaskStateSpec } from "../src/document/spec"
import type { ArtifactSpec } from "../src/document/types"

describe("declaredArtifacts (the Artifacts: field parser, session-boundary-hardening §4.3 D4)", () => {
  test("no declaration / a purely natural-language declaration: no artifact list", () => {
    expect(declaredArtifacts("investigate migration strategies and write them down")).toEqual([])
    expect(declaredArtifacts("write docs Artifacts: research findings and recommendations")).toEqual([])
    // A wording like "Effort:" does not contain the "Artifacts:" field
    expect(declaredArtifacts("Effort: docs/a.md")).toEqual([])
  })

  test("single-path / multi-path lists: comma, ideographic comma, semicolon, whitespace and the full-width colon all separate; role is always artifact", () => {
    expect(declaredArtifacts("investigate X Artifacts: docs/T-001/S01/record.md")).toEqual([{ path: "docs/T-001/S01/record.md", role: "artifact" }])
    expect(declaredArtifacts("Artifacts：docs/a.md、src/b.ts")).toEqual([
      { path: "docs/a.md", role: "artifact" },
      { path: "src/b.ts", role: "artifact" },
    ])
    expect(declaredArtifacts("Artifacts: docs/a.md,src/b.ts;docs/c.md")).toEqual([
      { path: "docs/a.md", role: "artifact" },
      { path: "src/b.ts", role: "artifact" },
      { path: "docs/c.md", role: "artifact" },
    ])
    expect(declaredArtifacts("Artifacts: docs/a.md and src/b.ts。")).toEqual([
      { path: "docs/a.md", role: "artifact" },
      { path: "src/b.ts", role: "artifact" },
    ])
  })

  test("optional section-anchor lists: parentheses after the path (attached directly or as a standalone paren item); separators inside the parens do not cut the path", () => {
    expect(declaredArtifacts("Artifacts: docs/T-001/S01/index.md(background, conclusions)")).toEqual([
      { path: "docs/T-001/S01/index.md", role: "artifact", sectionAnchors: ["background", "conclusions"] },
    ])
    expect(declaredArtifacts("Artifacts: docs/a.md (background, conclusions) docs/b.md(risks)")).toEqual([
      { path: "docs/a.md", role: "artifact", sectionAnchors: ["background", "conclusions"] },
      { path: "docs/b.md", role: "artifact", sectionAnchors: ["risks"] },
    ])
    // A standalone paren item with no path to attach to: ignored
    expect(declaredArtifacts("Artifacts: (background)")).toEqual([])
  })

  test("markdown backticks are shelled; a path with an extension but no slash is a valid declaration", () => {
    expect(declaredArtifacts("Artifacts: `docs/a.md`")).toEqual([{ path: "docs/a.md", role: "artifact" }])
    expect(declaredArtifacts("Artifacts: README.md")).toEqual([{ path: "README.md", role: "artifact" }])
  })

  test("a trailing-slash directory declaration parses as a path and is picked out as unsatisfiable (plans/0065 F2)", () => {
    const item = "record the turn traces Artifacts: docs/T-001/S01/golden/, docs/T-001/S01/notes.md"
    // The parser is honest about what the session wrote: the directory form is
    // a path declaration (it contains `/`), so it must be rejected where the
    // declaration is collected, not silently dropped here.
    expect(declaredArtifacts(item)).toEqual([
      { path: "docs/T-001/S01/golden/", role: "artifact" },
      { path: "docs/T-001/S01/notes.md", role: "artifact" },
    ])
    expect(directoryArtifactSpecs(item).map((spec) => spec.path)).toEqual(["docs/T-001/S01/golden/"])
    // File declarations (with or without fields) pick out nothing.
    expect(directoryArtifactSpecs("Artifacts: docs/a.md, src/b.ts")).toEqual([])
    expect(directoryArtifactSpecs("record findings Artifacts: research notes")).toEqual([])
  })
})

describe("spec table construction (the data declaration points)", () => {
  test("decomposeArtifactSpecs: four artifact groups (context/subtasks with the D4 fallback reads), todo expanded per subtask", () => {
    const specs = decomposeArtifactSpecs("T-001", 2)
    expect(specs.map((spec) => spec.path)).toEqual([
      "docs/T-001/context.md",
      "docs/T-001/shared.md",
      "docs/T-001/subtasks.md",
      "docs/T-001/S01/todo.md",
      "docs/T-001/S02/todo.md",
    ])
    expect(specs.every((spec) => spec.role === "artifact")).toBe(true)
    // Feedback naming and the todo.md protocol section anchors
    expect(specs[0]!.label).toBe("understanding digest")
    expect(specs[1]!.label).toBe("shared-context index")
    expect(specs[2]!.label).toBe("subtask checklist")
    expect(specs[3]!.sectionAnchors).toEqual([...SUBTASK_TODO_SECTIONS])
    // Zero subtasks (checklist parse failure) = only the first three groups
    expect(decomposeArtifactSpecs("T-001", 0)).toHaveLength(3)
  })

  test("subtaskStateSpec: pending = todo.md (with anchors and a label) / complete = done.md (path only)", () => {
    const spec = subtaskStateSpec("T-001", 3)
    expect(spec.pending.path).toBe("docs/T-001/S03/todo.md")
    expect(spec.pending.sectionAnchors).toEqual(["## Scope", "## Artifacts"])
    expect(spec.pending.label).toBe("subtask scope file")
    expect(spec.pending.role).toBe("artifact")
    expect(spec.complete).toEqual({ path: "docs/T-001/S03/done.md" })
  })
})

// —— The generic checker (real files on disk, temporary directory) ——

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "doc-spec-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const filler = "Placeholder filler material. ".repeat(30)
const properDoc = `# Record\n\n${filler}\n\n${EOF_MARK}\n`

async function put(rel: string, text: string) {
  const abs = join(dir, rel)
  await Bun.write(abs, text)
}

describe('checkArtifactSpecs(policy "declared", subtask-loop declared artifacts)', () => {
  test("a declared path missing → does not exist; present passes (non-.md gets no deeper check)", async () => {
    await put("src/b.ts", "export const x = 1\n")
    const specs: ArtifactSpec[] = [
      { path: "docs/a.md", role: "artifact" },
      { path: "src/b.ts", role: "artifact" },
    ]
    const result = await checkArtifactSpecs(specs, { dir, policy: "declared" })
    expect(result.problems).toEqual(["declared artifact docs/a.md does not exist"])
    expect(result.shaped).toEqual([])
  })

  test("fresh .md shape check (non-trivial + last-line terminator) and counted as shaped; non-fresh is not shape-checked", async () => {
    await put("docs/new.md", `# Record\n\n${filler}\n`)
    await put("docs/old.md", "# Existing\n\nshort\n")
    const specs: ArtifactSpec[] = [
      { path: "docs/new.md", role: "artifact" },
      { path: "docs/old.md", role: "artifact" },
    ]
    const result = await checkArtifactSpecs(specs, { dir, policy: "declared", fresh: new Set(["docs/new.md"]) })
    expect(result.problems).toEqual(["docs/new.md: missing last-line terminator (the last line of body text must be <!-- auto: eof -->)"])
    expect(result.shaped).toEqual(["docs/new.md"])
  })

  test("section anchors: an existing (non-fresh) .md is anchor-checked too; a missing anchor is a finding, complete ones pass", async () => {
    await put("docs/a.md", properDoc)
    await put("docs/b.md", `# Record\n\nbackground: see the body.\n\n${filler}\n\n${EOF_MARK}\n`)
    const specs: ArtifactSpec[] = [
      { path: "docs/a.md", role: "artifact", sectionAnchors: ["background", "conclusions"] },
      { path: "docs/b.md", role: "artifact", sectionAnchors: ["background"] },
    ]
    const result = await checkArtifactSpecs(specs, { dir, policy: "declared", fresh: new Set() })
    expect(result.problems).toEqual([
      'declared artifact docs/a.md is missing section "background"',
      'declared artifact docs/a.md is missing section "conclusions"',
    ])
  })

  test("a trailing-slash path is unsatisfiable: an existing non-empty directory still reads as missing (plans/0065 F2 — the file test stays, the accept-directories alternative is rejected)", async () => {
    // The exact T-066 S01 shape: the golden directory exists with the recorded
    // golden inside, and the declaration still cannot pass — the existence
    // check is a file check. This is the case that would have caught F2's
    // hole since M1.4.
    await put("docs/T-001/S01/golden/trace.txt", "golden trace\n")
    const result = await checkArtifactSpecs([{ path: "docs/T-001/S01/golden/", role: "artifact" }], { dir, policy: "declared" })
    expect(result.problems).toEqual(["declared artifact docs/T-001/S01/golden/ does not exist"])
  })

  test("non-artifact roles do not enter this checker (reserved by the M2.3 role policies)", async () => {
    const specs: ArtifactSpec[] = [{ path: "docs/x.md", role: "freeform" }]
    const result = await checkArtifactSpecs(specs, { dir, policy: "declared" })
    expect(result.problems).toEqual([])
  })
})

describe('checkArtifactSpecs(policy "mandatory", the merged decompose session\'s unit artifacts)', () => {
  test("missing or empty content → <path> <label> missing or empty (no further shape check)", async () => {
    await put("docs/T-001/shared.md", "  \n")
    const specs: ArtifactSpec[] = [
      { path: "docs/T-001/context.md", label: "understanding digest", role: "artifact" },
      { path: "docs/T-001/shared.md", label: "shared-context index", role: "artifact" },
    ]
    const result = await checkArtifactSpecs(specs, { dir, policy: "mandatory" })
    expect(result.problems).toEqual([
      "docs/T-001/context.md understanding digest missing or empty",
      "docs/T-001/shared.md shared-context index missing or empty",
    ])
  })

  test("without a label the problem line carries only the path; short content / missing terminator get the shape-check wording", async () => {
    await put("docs/a.md", "# Stub\n\n(omitted)\n")
    const result = await checkArtifactSpecs([{ path: "docs/a.md", role: "artifact" }], { dir, policy: "mandatory" })
    expect(result.problems.join("; ")).toContain("docs/a.md: content too short")
    expect(result.problems.join("; ")).toContain("missing last-line terminator")
  })

  test("no legacy flat-layout read (M3.7): canonical path missing, old flat file present → missing", async () => {
    await put("docs/T-001.context.md", properDoc)
    const specs: ArtifactSpec[] = [{ path: "docs/T-001/context.md", label: "understanding digest", role: "artifact" }]
    const result = await checkArtifactSpecs(specs, { dir, policy: "mandatory" })
    expect(result.problems).toEqual(["docs/T-001/context.md understanding digest missing or empty"])
  })

  test("English artifact declaration parses; pre-flip 产出: is not read (M3.7)", () => {
    expect(declaredArtifacts("write notes Artifacts: docs/a.md, src/b.ts")).toEqual([
      { path: "docs/a.md", role: "artifact" },
      { path: "src/b.ts", role: "artifact" },
    ])
    expect(declaredArtifacts("Artifacts: docs/a.md(background)")).toEqual([
      { path: "docs/a.md", role: "artifact", sectionAnchors: ["background"] },
    ])
    expect(declaredArtifacts("write docs 产出: docs/a.md")).toEqual([])
    // A lower-cased token must not silently yield zero specs (0035 D2)
    expect(declaredArtifacts("write notes artifacts: docs/a.md")).toEqual([{ path: "docs/a.md", role: "artifact" }])
  })

  test("pre-flip todo.md headings no longer satisfy the section anchors (M3.7)", async () => {
    // The two Chinese headings below are the rejected pre-flip spellings — they must keep failing the anchor check.
    await put("docs/T-001/S01/todo.md", `# S01\n\n## 范围声明\n\n${filler}\n\n## 产出清单\n\n- docs/x.md\n\n${EOF_MARK}\n`)
    const result = await checkArtifactSpecs([subtaskStateSpec("T-001", 1).pending], { dir, policy: "mandatory" })
    expect(result.problems).toEqual([
      'declared artifact docs/T-001/S01/todo.md is missing section "## Scope"',
      'declared artifact docs/T-001/S01/todo.md is missing section "## Artifacts"',
    ])
  })

  test("todo.md protocol section anchors: a missing anchor is a finding; both anchors present passes (the M1.4 handover item of 0030 §4)", async () => {
    await put("docs/T-001/S01/todo.md", `# S01\n\n## Scope\n\n${filler}\n\n${EOF_MARK}\n`)
    await put("docs/T-001/S02/todo.md", `# S02\n\n## Scope\n\n${filler}\n\n## Artifacts\n\n- docs/x.md\n\n${EOF_MARK}\n`)
    const specs = [subtaskStateSpec("T-001", 1).pending, subtaskStateSpec("T-001", 2).pending]
    const result = await checkArtifactSpecs(specs, { dir, policy: "mandatory" })
    expect(result.problems).toEqual(['declared artifact docs/T-001/S01/todo.md is missing section "## Artifacts"'])
  })
})

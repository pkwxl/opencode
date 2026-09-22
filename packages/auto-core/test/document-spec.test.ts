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
import { checkArtifactSpecs, declaredArtifacts, decomposeArtifactSpecs, SUBTASK_TODO_SECTIONS, subtaskStateSpec } from "../src/document/spec"
import type { ArtifactSpec } from "../src/document/types"

describe("declaredArtifacts(Artifacts: 字段解析,session-boundary-hardening §4.3 D4)", () => {
  test("无声明 / 纯自然语言声明: 不构成产物清单", () => {
    expect(declaredArtifacts("调研迁移策略并落盘")).toEqual([])
    expect(declaredArtifacts("写文档 Artifacts: 调研结论与建议")).toEqual([])
    // 「投入:」一类字样不含「Artifacts:」字段
    expect(declaredArtifacts("投入: docs/a.md")).toEqual([])
  })

  test("单路径/多路径清单: 逗号、顿号、分号、空白、全角冒号均可分隔,role 恒为 artifact", () => {
    expect(declaredArtifacts("调研 X Artifacts: docs/T-001/S01/record.md")).toEqual([{ path: "docs/T-001/S01/record.md", role: "artifact" }])
    expect(declaredArtifacts("Artifacts：docs/a.md、src/b.ts")).toEqual([
      { path: "docs/a.md", role: "artifact" },
      { path: "src/b.ts", role: "artifact" },
    ])
    expect(declaredArtifacts("Artifacts: docs/a.md,src/b.ts;docs/c.md")).toEqual([
      { path: "docs/a.md", role: "artifact" },
      { path: "src/b.ts", role: "artifact" },
      { path: "docs/c.md", role: "artifact" },
    ])
    expect(declaredArtifacts("Artifacts: docs/a.md 和 src/b.ts。")).toEqual([
      { path: "docs/a.md", role: "artifact" },
      { path: "src/b.ts", role: "artifact" },
    ])
  })

  test("可选章节锚清单: 路径后圆括号(紧跟或独立括号项),括号内分隔符不切断路径", () => {
    expect(declaredArtifacts("Artifacts: docs/T-001/S01/index.md(背景、结论)")).toEqual([
      { path: "docs/T-001/S01/index.md", role: "artifact", sectionAnchors: ["背景", "结论"] },
    ])
    expect(declaredArtifacts("Artifacts: docs/a.md (背景、结论) docs/b.md(风险)")).toEqual([
      { path: "docs/a.md", role: "artifact", sectionAnchors: ["背景", "结论"] },
      { path: "docs/b.md", role: "artifact", sectionAnchors: ["风险"] },
    ])
    // 无路径可归属的独立括号项: 忽略
    expect(declaredArtifacts("Artifacts: (背景)")).toEqual([])
  })

  test("markdown 反引号剥壳;带扩展名但无斜杠的路径是合法声明", () => {
    expect(declaredArtifacts("Artifacts: `docs/a.md`")).toEqual([{ path: "docs/a.md", role: "artifact" }])
    expect(declaredArtifacts("Artifacts: README.md")).toEqual([{ path: "README.md", role: "artifact" }])
  })
})

describe("spec 表构造(数据声明点)", () => {
  test("decomposeArtifactSpecs: 四组产物(context/subtasks 带 D4 回落读),todo 逐子任务展开", () => {
    const specs = decomposeArtifactSpecs("T-001", 2)
    expect(specs.map((spec) => spec.path)).toEqual([
      "docs/T-001/context.md",
      "docs/T-001/shared.md",
      "docs/T-001/subtasks.md",
      "docs/T-001/S01/todo.md",
      "docs/T-001/S02/todo.md",
    ])
    expect(specs.every((spec) => spec.role === "artifact")).toBe(true)
    // 反馈命名与 todo.md 协议章节锚
    expect(specs[0]!.label).toBe("understanding digest")
    expect(specs[1]!.label).toBe("shared-context index")
    expect(specs[2]!.label).toBe("subtask checklist")
    expect(specs[3]!.sectionAnchors).toEqual([...SUBTASK_TODO_SECTIONS])
    // 零子任务(检查项解析失败)= 只有前三组
    expect(decomposeArtifactSpecs("T-001", 0)).toHaveLength(3)
  })

  test("subtaskStateSpec: pending=todo.md(带锚与命名)/ complete=done.md(仅路径)", () => {
    const spec = subtaskStateSpec("T-001", 3)
    expect(spec.pending.path).toBe("docs/T-001/S03/todo.md")
    expect(spec.pending.sectionAnchors).toEqual(["## Scope", "## Artifacts"])
    expect(spec.pending.label).toBe("subtask scope file")
    expect(spec.pending.role).toBe("artifact")
    expect(spec.complete).toEqual({ path: "docs/T-001/S03/done.md" })
  })
})

// —— 通用检查器(真实落盘,临时目录)——

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "doc-spec-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const filler = "占位素材甲乙丙。".repeat(30)
const properDoc = `# 记录\n\n${filler}\n\n${EOF_MARK}\n`

async function put(rel: string, text: string) {
  const abs = join(dir, rel)
  await Bun.write(abs, text)
}

describe('checkArtifactSpecs(policy "declared",子任务循环声明产出)', () => {
  test("声明路径缺失 → does not exist;存在即过(非 .md 不再深查)", async () => {
    await put("src/b.ts", "export const x = 1\n")
    const specs: ArtifactSpec[] = [
      { path: "docs/a.md", role: "artifact" },
      { path: "src/b.ts", role: "artifact" },
    ]
    const result = await checkArtifactSpecs(specs, { dir, policy: "declared" })
    expect(result.problems).toEqual(["declared artifact docs/a.md does not exist"])
    expect(result.shaped).toEqual([])
  })

  test("fresh .md 形检(非平凡 + 末行终止符)并计入 shaped;非 fresh 不形检", async () => {
    await put("docs/new.md", `# 记录\n\n${filler}\n`)
    await put("docs/old.md", "# 既有\n\n短\n")
    const specs: ArtifactSpec[] = [
      { path: "docs/new.md", role: "artifact" },
      { path: "docs/old.md", role: "artifact" },
    ]
    const result = await checkArtifactSpecs(specs, { dir, policy: "declared", fresh: new Set(["docs/new.md"]) })
    expect(result.problems).toEqual(["docs/new.md: missing last-line terminator (the last line of body text must be <!-- auto: eof -->)"])
    expect(result.shaped).toEqual(["docs/new.md"])
  })

  test("章节锚: 既有(非 fresh).md 同样校验锚;缺失成案、齐备通过", async () => {
    await put("docs/a.md", properDoc)
    await put("docs/b.md", `# 记录\n\n背景: 见正文。\n\n${filler}\n\n${EOF_MARK}\n`)
    const specs: ArtifactSpec[] = [
      { path: "docs/a.md", role: "artifact", sectionAnchors: ["背景", "结论"] },
      { path: "docs/b.md", role: "artifact", sectionAnchors: ["背景"] },
    ]
    const result = await checkArtifactSpecs(specs, { dir, policy: "declared", fresh: new Set() })
    expect(result.problems).toEqual([
      'declared artifact docs/a.md is missing section "背景"',
      'declared artifact docs/a.md is missing section "结论"',
    ])
  })

  test("非 artifact 角色不进本检查器(M2.3 角色策略预留)", async () => {
    const specs: ArtifactSpec[] = [{ path: "docs/x.md", role: "freeform" }]
    const result = await checkArtifactSpecs(specs, { dir, policy: "declared" })
    expect(result.problems).toEqual([])
  })
})

describe('checkArtifactSpecs(policy "mandatory",合并分解会话单元产物)', () => {
  test("缺失或空内容 → <path> <label> missing or empty(不继续形检)", async () => {
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

  test("无 label 时问题行只含路径;短内容/缺终止符走形检文案", async () => {
    await put("docs/a.md", "# 空壳\n\n(略)\n")
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
    expect(declaredArtifacts("写文档 产出: docs/a.md")).toEqual([])
    // A lower-cased token must not silently yield zero specs (0035 D2)
    expect(declaredArtifacts("write notes artifacts: docs/a.md")).toEqual([{ path: "docs/a.md", role: "artifact" }])
  })

  test("pre-flip todo.md headings no longer satisfy the section anchors (M3.7)", async () => {
    await put("docs/T-001/S01/todo.md", `# S01\n\n## 范围声明\n\n${filler}\n\n## 产出清单\n\n- docs/x.md\n\n${EOF_MARK}\n`)
    const result = await checkArtifactSpecs([subtaskStateSpec("T-001", 1).pending], { dir, policy: "mandatory" })
    expect(result.problems).toEqual([
      'declared artifact docs/T-001/S01/todo.md is missing section "## Scope"',
      'declared artifact docs/T-001/S01/todo.md is missing section "## Artifacts"',
    ])
  })

  test("todo.md 协议章节锚: 缺锚成案,双锚齐备通过(0030 §4 的 M1.4 交接项)", async () => {
    await put("docs/T-001/S01/todo.md", `# S01\n\n## Scope\n\n${filler}\n\n${EOF_MARK}\n`)
    await put("docs/T-001/S02/todo.md", `# S02\n\n## Scope\n\n${filler}\n\n## Artifacts\n\n- docs/x.md\n\n${EOF_MARK}\n`)
    const specs = [subtaskStateSpec("T-001", 1).pending, subtaskStateSpec("T-001", 2).pending]
    const result = await checkArtifactSpecs(specs, { dir, policy: "mandatory" })
    expect(result.problems).toEqual(['declared artifact docs/T-001/S01/todo.md is missing section "## Artifacts"'])
  })
})

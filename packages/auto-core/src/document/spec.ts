// Document domain — artifact spec machinery (M1.4, plans/0034): the single
// declaration point for artifact specs and the generic spec-driven checker.
// The driver's mechanical checks (existence / non-triviality / eof terminator
// / declared section anchors) are data-driven here; call sites (execute.ts)
// hold no per-document check logic and no hardcoded role names.
//
// Three spec surfaces:
//   1. declaredArtifacts — the `产出:` declaration parser (moved from plan.ts;
//      the document domain owns the declaration format end to end: syntax +
//      check semantics). The `产出:` token itself is a driver protocol string
//      (English translation registers with M1.5, dual-read per plan open
//      question 11).
//   2. decomposeArtifactSpecs — the merged understand+decompose session's four
//      artifact groups (plans/0030 D3) as a spec table, incl. the D4 legacy
//      fallback-read paths for the pre-directory layout.
//   3. subtaskStateSpec — the subtask-directory state protocol (M1.0) as spec
//      data: pending (todo.md, written by the decompose session, anchor-
//      checked) / complete (done.md, DRIVER rename target). State semantics,
//      existence checks and illegal-state detection all consume this pair;
//      the file names have one source.
//   4. taskTodoSpec — a planned task's content document docs/T-NNN/todo.md
//      (M3.4, plans/0047 L3): written by the planning session, checked under
//      the mandatory policy (non-trivial, eof, the three section anchors).
import { join } from "node:path"
import { docShapeProblems } from "../doccheck"
import { legacyTaskDoc, subtaskDoc, taskDoc } from "../docpaths"
import type { ArtifactSpec } from "./types"

// —— 1. `Artifacts:` declaration parsing (session-boundary-hardening §4.3 D4) ——

// Structured artifact declaration inside a checklist item: a path list led by
// `Artifacts:` (legacy `产出:` still read). The driver checks existence/shape from these specs (no hardcoded
// workspace conventions like index.md — the list comes entirely from the
// declaration). Syntax aligns with the decompose prompt's "declare artifacts
// per item" convention, parsed leniently:
//   - [ ] 调研 X Artifacts: docs/T-001/S01/record.md、src/y.ts
//   - [ ] 写文档 Artifacts: docs/T-001/S01/index.md(背景、结论)
// Paths separate by comma/ideographic comma/semicolon/whitespace; parenthesized
// text after a path lists optional required section anchors (attached directly
// or as a standalone paren item); backtick-wrapped paths are shelled; tokens
// without `/` and without an extension (natural language, e.g. 「调研结论」)
// are not paths and are skipped — a pure-prose declaration leaves zero specs,
// covered separately by the zero-disk-writes criterion (unit baseline diff).
export function declaredArtifacts(text: string): ArtifactSpec[] {
  // Dual-read (M2.4): `产出:` is the pre-flip spelling, still present in PLAN.md task bodies written before it.
  // Case-insensitive on the English token: a session writing `artifacts:` must
  // not silently yield zero specs (plans/0035 D2).
  const decl = /(?:^|\s)(?:Artifacts|产出)\s*[:：]\s*(.+)$/i.exec(text)?.[1]
  if (!decl) return []
  const out: ArtifactSpec[] = []
  let current: ArtifactSpec | undefined
  for (const raw of splitTopLevel(decl)) {
    const token = raw.replace(/^`+/, "").replace(/`+$/, "")
    const attached = /^([^\s()（）]+)[(（]([^)）]*)[)）]$/.exec(token)
    if (attached) {
      current = declarePath(out, attached[1]!)
      addSections(current, attached[2]!)
    } else if (/^[(（][^)）]*[)）]$/.test(token)) {
      addSections(current, token.slice(1, -1))
    } else {
      current = declarePath(out, token)
    }
  }
  return out
}

// Top-level tokenizing (no split inside parens): separators between paths must
// not leak into the parenthesized section anchors; a stray closing paren is
// noise and is dropped.
function splitTopLevel(text: string): string[] {
  const tokens: string[] = []
  let depth = 0
  let cur = ""
  for (const ch of text) {
    if (ch === "(" || ch === "（") depth++
    else if (ch === ")" || ch === "）") {
      if (depth > 0) depth--
      else continue
    }
    if (depth === 0 && /[\s,，、;；。]/.test(ch)) {
      if (cur) tokens.push(cur)
      cur = ""
      continue
    }
    cur += ch
  }
  if (cur) tokens.push(cur)
  return tokens
}

// Path-likeness criterion: contains / or carries an extension; anything else
// is natural language and forms no declaration.
function declarePath(out: ArtifactSpec[], token: string): ArtifactSpec | undefined {
  if (!/(\/|\.[A-Za-z0-9]+$)/.test(token)) return undefined
  const item: ArtifactSpec = { path: token, role: "artifact" }
  out.push(item)
  return item
}

function addSections(item: ArtifactSpec | undefined, text: string) {
  if (!item) return
  const anchors = (item.sectionAnchors ??= [])
  for (const section of text.split(/[,，、;；|]/).map((part) => part.trim()).filter(Boolean)) {
    anchors.push(section)
  }
}

// —— 2. Merged decompose session artifact table (plans/0030 D3, M1.4) ——

// The four artifact groups of the merged understand+decompose session as spec
// data: understanding digest, shared-context index, subtask checklist (the
// checklist-items requirement itself stays a driver-side parse-input check in
// execute.ts, plans/0034 D9) and one scope file per subtask. context.md and
// subtasks.md carry the legacy flat-layout fallback read (D4; the write target
// is always the canonical path).
export function decomposeArtifactSpecs(taskId: string, subtaskCount: number): ArtifactSpec[] {
  return [
    {
      path: taskDoc(taskId, "context"),
      fallbackPath: legacyTaskDoc(taskId, "context"),
      label: "understanding digest",
      role: "artifact",
    },
    { path: taskDoc(taskId, "shared"), label: "shared-context index", role: "artifact" },
    {
      path: taskDoc(taskId, "subtasks"),
      fallbackPath: legacyTaskDoc(taskId, "subtasks"),
      label: "subtask checklist",
      role: "artifact",
    },
    ...Array.from({ length: subtaskCount }, (_, i) => subtaskStateSpec(taskId, i + 1).pending),
  ]
}

// —— 3. Subtask-directory state protocol specs (M1.0, plans/0030; M1.4 D6) ——

// todo.md's two protocol sections (tier-1 anchors: the driver checks them and
// DRIVER-authored injected files write them; the decompose template instructs
// them). One source for checks, injected writes and (via basename) messages.
export const SUBTASK_TODO_SECTIONS = ["## Scope", "## Artifacts"]

// Pre-flip headings still accepted in pending todo.md files written before
// the M2.4 flip (dual-read, plans/0035 D5).
const SUBTASK_TODO_SECTION_ALIASES: Record<string, string[]> = {
  "## Scope": ["## 范围声明"],
  "## Artifacts": ["## 产出清单"],
}

// The state-file pair of one subtask: exactly one of the two paths exists once
// the protocol is active (both/neither = illegal). `pending` doubles as the
// creation-time artifact spec (the decompose session writes it; shape and
// anchors checked there, plans/0030 D11); `complete` is the DRIVER rename
// target — content carried over unchanged, never re-checked. Both files play
// the artifact role (roles.ts, M2.3); the state is which one exists, read by
// document/state.ts.
export type SubtaskStateSpec = {
  pending: ArtifactSpec
  complete: { path: string }
}

export function subtaskStateSpec(taskId: string, index: number): SubtaskStateSpec {
  return {
    pending: {
      path: subtaskDoc(taskId, index, "todo"),
      sectionAnchors: [...SUBTASK_TODO_SECTIONS],
      anchorAliases: SUBTASK_TODO_SECTION_ALIASES,
      label: "subtask scope file",
      role: "artifact",
    },
    complete: { path: subtaskDoc(taskId, index, "done") },
  }
}

// —— 4. Task documents (M3.4) ——

// Section anchors of a task's todo.md: new English protocol literals (plans/0035
// §3), no dual-read — there is no pre-flip spelling.
export const TASK_TODO_SECTIONS = ["## Goal", "## Scope", "## Acceptance"] as const

export function taskTodoSpec(taskId: string): ArtifactSpec {
  return { path: join("docs", taskId, "todo.md"), sectionAnchors: [...TASK_TODO_SECTIONS], label: "task document", role: "artifact" }
}

// —— Generic spec-driven checks ——

// Check policy, per call (the two call sites are homogeneous, plans/0034 D3):
// - "mandatory": unit-protocol artifacts the session must produce now —
//   empty content is rejected outright and shape is checked regardless of
//   freshness (merged decompose session).
// - "declared": `Artifacts:`-declared artifacts — the file must exist; shape is
//   checked only for .md files new (untracked) in this unit; existing files'
//   edits are covered by the caller's whole-unit eof scan (subtask session).
export type SpecCheckPolicy = "mandatory" | "declared"

export type SpecCheck = {
  dir: string
  policy: SpecCheckPolicy
  // Untracked (new-in-unit) paths; consumed by the "declared" policy.
  fresh?: ReadonlySet<string>
}

export type SpecCheckResult = {
  problems: string[]
  // Paths already shape-checked here; the caller's whole-unit eof scan skips
  // them so one path never forms two cases.
  shaped: string[]
}

// Section-anchor miss message (one format for both policies; the substring
// `is missing section "…"` is feedback-consumed).
const missingSection = (path: string, section: string): string => `declared artifact ${path} is missing section "${section}"`

export async function checkArtifactSpecs(specs: readonly ArtifactSpec[], check: SpecCheck): Promise<SpecCheckResult> {
  const problems: string[] = []
  const shaped: string[] = []
  for (const spec of specs) {
    // Specs declare artifacts; every other role carries its own policy in
    // roles.ts (handoff protocol checks, eof exemption, protect list).
    if (spec.role !== "artifact") continue
    const isMd = spec.path.toLowerCase().endsWith(".md")
    if (check.policy === "declared") {
      if (!(await Bun.file(join(check.dir, spec.path)).exists())) {
        problems.push(`declared artifact ${spec.path} does not exist`)
        continue
      }
      if (!isMd) continue
      const content = await Bun.file(join(check.dir, spec.path)).text().catch(() => "")
      if (check.fresh?.has(spec.path)) {
        problems.push(...docShapeProblems(content, spec.path))
        shaped.push(spec.path)
      }
      for (const section of spec.sectionAnchors ?? []) {
        if (!hasSection(content, spec, section)) problems.push(missingSection(spec.path, section))
      }
      continue
    }
    const content = (await readSpec(check.dir, spec)).trim()
    if (!content) {
      problems.push(`${spec.path}${spec.label ? ` ${spec.label}` : ""} missing or empty`)
      continue
    }
    if (isMd) problems.push(...docShapeProblems(content, spec.path))
    for (const section of spec.sectionAnchors ?? []) {
      if (!hasSection(content, spec, section)) problems.push(missingSection(spec.path, section))
    }
  }
  return { problems, shaped }
}

const hasSection = (content: string, spec: ArtifactSpec, section: string): boolean =>
  content.includes(section) || (spec.anchorAliases?.[section] ?? []).some((alias) => content.includes(alias))

// Content read with the D4 fallback: canonical path first, legacy flat path
// when the canonical is absent (mirrors docpaths.resolveTaskDoc for the specs
// that carry a fallbackPath).
async function readSpec(dir: string, spec: ArtifactSpec): Promise<string> {
  const primary = Bun.file(join(dir, spec.path))
  if (await primary.exists()) return await primary.text().catch(() => "")
  if (spec.fallbackPath) {
    const fallback = Bun.file(join(dir, spec.fallbackPath))
    if (await fallback.exists()) return await fallback.text().catch(() => "")
  }
  return ""
}

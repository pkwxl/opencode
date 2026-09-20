// Intent-pack loader (M1.1, design plans/0031). Evolved from src/mode.ts:
// same sectioned-file protocol, generalized to the five intent sections of
// intent/types.ts. Built-in presets live in templates/intents/<name>.md
// (embedded at compile time via `with { type: "file" }`; adding one = add the
// file + one import), and the target directory's
// .opencode/auto/intents/<name>.md adds packs or overrides a same-named
// built-in wholesale (no merge — degenerate composition, F8).
//
// Unlike mode files, all sections are optional: an absent or empty section
// contributes nothing (the zero-intent baseline is current behavior). Content
// migrates out of the core templates into packs per loop milestone (M1.2+);
// the loader is consumed by the prompt assembly point from its first consumer
// onward.
//
// Section bodies may use the prompt template syntax ({{var}}/{{#if}}), same
// license as mode files (prompt.ts renders mode sections with the render
// context); the assembly point renders them with the prompt context before
// injecting them as data. The `## phase duties` section is addressed per
// phase by `### <key>` subsections (dutiesForPhase); the M3 phase registry's
// dutiesRef will point at these.
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { DEFAULT_INTENT, INTENT_SECTIONS, type IntentPack, type IntentSection } from "./types"
import builtinDefault from "../../templates/intents/default.md" with { type: "file" }

// Pack file protocol: first line `# <name>` (must match the file name),
// sections introduced by the human-readable headings below. Unknown sections
// are rejected; empty sections are treated as absent.
const SECTION_HEADINGS: Record<string, IntentSection> = {
  quality: "quality",
  "phase duties": "phaseDuties",
  acceptance: "acceptance",
  governance: "governance",
  "artifact spec": "artifactSpec",
}

// File-facing headings in canonical section order (for diagnostics).
const HEADING_LIST = INTENT_SECTIONS.map((s) => `## ${Object.keys(SECTION_HEADINGS).find((h) => SECTION_HEADINGS[h] === s)}`).join(", ")

// Pack name constraint: lowercase letter followed by letters/digits/hyphens
// (same rule as mode names, so both overlays share one naming discipline).
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/

// Load all intent packs: the built-in registry plus the target directory's
// .opencode/auto/intents/<name>.md (a same-named file overrides the built-in
// wholesale). Invalid files throw (the CLI turns this into an exit-1 usage
// error). With dir omitted, only the built-ins are loaded.
export function loadIntents(dir?: string): Record<string, IntentPack> {
  const packs: Record<string, IntentPack> = { [DEFAULT_INTENT]: parseIntentFile(DEFAULT_INTENT, readFileSync(builtinDefault, "utf8")) }
  if (!dir) return packs
  const overlayDir = join(dir, ".opencode", "auto", "intents")
  let files: string[] = []
  try {
    files = readdirSync(overlayDir)
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : ""
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error
  }
  for (const file of files.sort()) {
    if (!file.endsWith(".md")) continue
    const name = file.slice(0, -3)
    if (!NAME_PATTERN.test(name)) {
      throw new Error(`intent pack file name ${join(".opencode", "auto", "intents", file)} is invalid: must be a lowercase letter followed by letters/digits/hyphens`)
    }
    packs[name] = parseIntentFile(name, readFileSync(join(overlayDir, file), "utf8"))
  }
  return packs
}

// Degenerate composition (F8): exactly one active pack, selected by name
// (default: the DEFAULT_INTENT pack). Any project override has already
// replaced the same-named built-in at load time, so resolution is a plain
// lookup — no merging, no precedence beyond built-in < project.
export function resolveIntent(packs: Record<string, IntentPack>, name: string = DEFAULT_INTENT): IntentPack {
  const pack = packs[name]
  if (!pack) {
    throw new Error(`unknown intent pack "${name}" (available: ${Object.keys(packs).sort().join(", ")})`)
  }
  return pack
}

// Per-phase duties addressing: the `## phase duties` section is subdivided by
// `### <key>` subsections (key = phase letter today; the heading may carry a
// human-readable suffix after the key, e.g. `### m 迁移实现`). Returns the
// trimmed body of the matching subsection; undefined when the section or the
// key is absent (zero-intent baseline: the template then renders no duties).
// Text before the first `###` heading is not addressable and never injected.
export function dutiesForPhase(pack: IntentPack, key: string): string | undefined {
  const lines = pack.phaseDuties?.split("\n")
  if (!lines) return undefined
  const bodies = new Map<string, string[]>()
  let current: string | undefined
  for (const line of lines) {
    const heading = /^###\s+(\S+)/.exec(line)
    if (heading) {
      current = heading[1]!
      if (!bodies.has(current)) bodies.set(current, [])
      continue
    }
    if (current !== undefined) bodies.get(current)!.push(line)
  }
  const body = bodies.get(key)
  if (!body) return undefined
  const text = trimBody(body).join("\n")
  return text || undefined
}

// Parse a pack file; throws on a missing/mismatched title or an unknown
// section, naming the offending section.
export function parseIntentFile(name: string, text: string): IntentPack {
  const lines = text.split("\n")
  const title = /^#\s+(.+?)\s*$/.exec(lines[0] ?? "")
  if (!title || title[1] !== name) throw new Error(`intent pack ${name}.md must start with "# ${name}"`)
  const bodies = new Map<IntentSection, string[]>()
  let section: IntentSection | undefined
  for (const line of lines.slice(1)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) {
      const key = SECTION_HEADINGS[heading[1]!]
      if (!key) {
        throw new Error(`intent pack ${name}.md has unknown section "## ${heading[1]}" (available: ${HEADING_LIST})`)
      }
      section = key
      if (!bodies.has(section)) bodies.set(section, [])
      continue
    }
    if (section) bodies.get(section)!.push(line)
  }
  const body = (key: IntentSection) => trimBody(bodies.get(key) ?? []).join("\n")
  const pack: IntentPack = { name }
  for (const key of INTENT_SECTIONS) {
    const text = body(key)
    if (text) pack[key] = text
  }
  return pack
}

function trimBody(lines: string[]): string[] {
  const copy = [...lines]
  while (copy.length && !copy[0].trim()) copy.shift()
  while (copy.length && !copy[copy.length - 1].trim()) copy.pop()
  return copy
}

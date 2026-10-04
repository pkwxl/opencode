// Intent bundles (plans/0079 §3): the named policy bundle that turns "an
// intent" from a prompt-content pack (0031's degenerate form) into a
// materializable unit — one directory carrying custom phase-type files, an
// intent pack, a mode, and a manifest with the phase sequence and config
// stamps. The runtime never reads a bundle: init materializes its files into
// the target's .opencode/auto/{phases,intents,modes}/ and stamps the config
// keys, and from then on the driver sees only the ordinary surfaces it
// always reads. There is no drift copy — re-running init --intent
// re-materializes the same bytes.
//
// Sources: a directory on disk (bundle.json plus the phases/ intents/ modes/
// subtrees) or a shell registration (registerIntentBundle, the
// registerTemplate pattern — a shell ships bundles without the core
// embedding template files). Parsing validates every piece through the
// existing per-surface parsers (parsePhaseTypeFile, parseIntentFile,
// parseModeFile) and resolves the manifest's phase sequence against the
// builtins plus the bundle's own types, so a refused parse writes nothing;
// materialization then writes the original file texts verbatim.
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { parseIntentFile } from "./intent/load"
import type { ParallelLevel } from "./intent/types"
import { parseModeFile } from "./mode"
import { SUBTASK_MODES, type SubtaskMode } from "./opts"
import { parsePhaseTypeFile } from "./phases/custom"
import { BUILTIN_PHASE_TYPES, PRESET_FORM, phasesProblem, resolvePhases, type PhaseTypeEntry } from "./phases/registry"

export const BUNDLE_MANIFEST = "bundle.json"

// A bundle as files: relative path → content. The allowed keys are
// bundle.json, phases/<type>.md, intents/<name>.md and modes/<name>.md.
export type IntentBundleFiles = Record<string, string>

// A parsed bundle: everything materialization and stamping need. The file
// entries keep the original texts — validation parses them, materialization
// writes them verbatim.
export type IntentBundle = {
  // The bundle's name; also the pack name and, when the bundle carries a
  // mode file, the mode name.
  name: string
  // The phases value to stamp: the comma form of full type ids, never the
  // letter preset (plans/0079 §5), resolving against the builtins plus the
  // bundle's own types and containing implement.
  phases: string
  // The mode stamp: the manifest's `mode`, else the bundle's own mode file's
  // name when present, else none (the default mode stays).
  mode?: string
  // Further config stamps the manifest may carry.
  stamps: { subtask?: SubtaskMode; parallel?: ParallelLevel; wrapup?: boolean }
  // The materializable files (repository-relative suffix → text).
  files: { phases: Record<string, string>; pack?: string; mode?: string }
}

// Same naming discipline as mode and intent pack files (the shared rule the
// three surfaces keep in their own copies).
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/

const SUBDIRS = ["phases", "intents", "modes"] as const

// Parse a bundle's files; throws naming the offending part, writing nothing.
// Everything the manifest claims is checked here: the name grammar, the
// comma-form phase sequence against the builtins plus the bundle's own
// types, the one-pack/one-mode rule (each named exactly like the bundle),
// and the stamp values' config shapes.
export function parseIntentBundle(files: IntentBundleFiles): IntentBundle {
  const manifestText = files[BUNDLE_MANIFEST]
  if (manifestText === undefined) throw new Error(`an intent bundle needs a ${BUNDLE_MANIFEST} manifest`)
  let raw: unknown
  try {
    raw = JSON.parse(manifestText)
  } catch (error) {
    throw new Error(`${BUNDLE_MANIFEST} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${BUNDLE_MANIFEST} must be a JSON object`)
  const manifest = raw as Record<string, unknown>
  const known = ["name", "phases", "mode", "subtask", "parallel", "wrapup"]
  const unknownFields = Object.keys(manifest).filter((key) => !known.includes(key))
  if (unknownFields.length) throw new Error(`${BUNDLE_MANIFEST} has unknown field(s) ${unknownFields.join(", ")} (available: ${known.join(", ")})`)
  const name = manifest.name
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    throw new Error(`${BUNDLE_MANIFEST} name must be a lowercase letter followed by letters/digits/hyphens; got ${JSON.stringify(name)}`)
  }
  // The file layout: only the three subtrees beside the manifest.
  const layout = new Map<string, string>()
  for (const [path, text] of Object.entries(files)) {
    if (path === BUNDLE_MANIFEST) continue
    const slash = path.indexOf("/")
    if (!path.endsWith(".md") || slash === -1 || !(SUBDIRS as readonly string[]).includes(path.slice(0, slash))) {
      throw new Error(`intent bundle file "${path}" is outside the bundle layout (allowed: ${SUBDIRS.map((sub) => `${sub}/*.md`).join(", ")} beside ${BUNDLE_MANIFEST})`)
    }
    layout.set(path, text)
  }
  // Phase types: parsed through the custom-type parser, so a bundle's types
  // meet the same rules as a project's hand-dropped ones.
  const phaseFiles: Record<string, string> = {}
  const types: PhaseTypeEntry[] = [...BUILTIN_PHASE_TYPES]
  for (const path of [...layout.keys()].filter((key) => key.startsWith("phases/")).sort()) {
    const type = path.slice("phases/".length, -".md".length)
    types.push(parsePhaseTypeFile(type, layout.get(path)!))
    phaseFiles[type] = layout.get(path)!
  }
  // The phases value: the comma form of full type ids only (plans/0079 §5 —
  // a manifest is machine-stamped and never uses the human letter shorthand),
  // resolving against the builtins plus the bundle's own types.
  const phases = manifest.phases
  if (typeof phases !== "string" || !phases.trim()) throw new Error(`${BUNDLE_MANIFEST} phases is required (the comma form of phase type ids, e.g. "spec-read,design,implement,test,audit")`)
  if (PRESET_FORM.test(phases)) {
    throw new Error(`${BUNDLE_MANIFEST} phases "${phases}" is a letter preset; a bundle manifest uses the comma form of full type ids (plans/0079 §5), e.g. "analysis,design,implement"`)
  }
  if (resolvePhases(phases, types) === null) throw new Error(`${BUNDLE_MANIFEST} phases is invalid: ${phasesProblem(phases, types)}`)
  // The pack: exactly one, named exactly like the bundle (the config's
  // intent key selects it by that name).
  const packPaths = [...layout.keys()].filter((key) => key.startsWith("intents/"))
  if (packPaths.length !== 1) {
    throw new Error(`an intent bundle carries exactly one intent pack (intents/${name}.md, named like the bundle); found ${packPaths.length}`)
  }
  const packName = packPaths[0]!.slice("intents/".length, -".md".length)
  if (packName !== name) throw new Error(`the intent pack intents/${packName}.md must be named like the bundle ("${name}") — the config's intent key selects it by that name`)
  parseIntentFile(name, layout.get(packPaths[0]!)!)
  // The mode: at most one, also named like the bundle.
  const modePaths = [...layout.keys()].filter((key) => key.startsWith("modes/"))
  if (modePaths.length > 1) throw new Error(`an intent bundle carries at most one mode (modes/${name}.md, named like the bundle); found ${modePaths.length}`)
  let modeStamp: string | undefined
  if (modePaths.length === 1) {
    const modeName = modePaths[0]!.slice("modes/".length, -".md".length)
    if (modeName !== name) throw new Error(`the mode modes/${modeName}.md must be named like the bundle ("${name}")`)
    parseModeFile(name, layout.get(modePaths[0]!)!)
    modeStamp = name
  }
  if (manifest.mode !== undefined) {
    if (typeof manifest.mode !== "string" || !manifest.mode.trim()) {
      throw new Error(`${BUNDLE_MANIFEST} mode must be a registered mode's name (the config's mode stamp); got ${JSON.stringify(manifest.mode)}`)
    }
    modeStamp = manifest.mode
  }
  // The further stamps: config-shaped values only.
  const stamps: IntentBundle["stamps"] = {}
  if (manifest.subtask !== undefined) {
    if (typeof manifest.subtask !== "string" || !(SUBTASK_MODES as readonly string[]).includes(manifest.subtask)) {
      throw new Error(`${BUNDLE_MANIFEST} subtask must be ${SUBTASK_MODES.join("|")}; got ${JSON.stringify(manifest.subtask)}`)
    }
    stamps.subtask = manifest.subtask as SubtaskMode
  }
  if (manifest.parallel !== undefined) {
    if (typeof manifest.parallel !== "string" || manifest.parallel === "none" || !(["low", "medium", "high"] as readonly string[]).includes(manifest.parallel)) {
      throw new Error(`${BUNDLE_MANIFEST} parallel must be low|medium|high (none is the absence of the stamp); got ${JSON.stringify(manifest.parallel)}`)
    }
    stamps.parallel = manifest.parallel as ParallelLevel
  }
  if (manifest.wrapup !== undefined) {
    if (typeof manifest.wrapup !== "boolean") throw new Error(`${BUNDLE_MANIFEST} wrapup must be true|false; got ${JSON.stringify(manifest.wrapup)}`)
    stamps.wrapup = manifest.wrapup
  }
  return {
    name,
    phases,
    ...(modeStamp !== undefined ? { mode: modeStamp } : {}),
    stamps,
    files: {
      phases: phaseFiles,
      pack: layout.get(packPaths[0]!),
      ...(modePaths.length ? { mode: layout.get(modePaths[0]!) } : {}),
    },
  }
}

// Write a parsed bundle's files into the target directory's
// .opencode/auto/ surfaces; returns the repository-relative paths written.
// The config stamps are the caller's (init's) to apply — materialization
// writes files only, never config. Bun.write creates parent directories.
export async function materializeIntentBundle(dir: string, bundle: IntentBundle): Promise<string[]> {
  const written: string[] = []
  const write = async (rel: string, text: string) => {
    await Bun.write(join(dir, rel), text)
    written.push(rel)
  }
  for (const [type, text] of Object.entries(bundle.files.phases)) {
    await write(join(".opencode", "auto", "phases", `${type}.md`), text)
  }
  if (bundle.files.pack !== undefined) await write(join(".opencode", "auto", "intents", `${bundle.name}.md`), bundle.files.pack)
  if (bundle.files.mode !== undefined) await write(join(".opencode", "auto", "modes", `${bundle.name}.md`), bundle.files.mode)
  return written
}

// The shell registrations (the registerTemplate pattern): a shell ships
// bundles in-process; registering a name again replaces it.
const registered = new Map<string, IntentBundleFiles>()

export function registerIntentBundle(name: string, files: IntentBundleFiles): void {
  if (!name.trim() || name.includes("\n")) throw new Error("a registered intent bundle needs a non-empty one-line name")
  registered.set(name, { ...files })
}

export function registeredIntentBundles(): string[] {
  return [...registered.keys()].sort()
}

// Resolve a bundle source: a registered name, or a directory holding
// bundle.json (its phases/ intents/ modes/ subtrees read in). undefined =
// the source names no bundle (the value is a plain pack name instead).
export async function resolveIntentBundle(source: string): Promise<IntentBundleFiles | undefined> {
  const reg = registered.get(source)
  if (reg !== undefined) return { ...reg }
  return readBundleDirectory(source)
}

async function readBundleDirectory(path: string): Promise<IntentBundleFiles | undefined> {
  const manifest = await Bun.file(join(path, BUNDLE_MANIFEST)).text().catch(() => undefined)
  if (manifest === undefined) return undefined
  const files: IntentBundleFiles = { [BUNDLE_MANIFEST]: manifest }
  for (const sub of SUBDIRS) {
    const dir = join(path, sub)
    let names: string[]
    try {
      names = Array.from(await readdir(dir))
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : ""
      if (code === "ENOENT" || code === "ENOTDIR") continue
      throw error
    }
    for (const name of names.sort()) {
      if (!name.endsWith(".md")) throw new Error(`the intent bundle's ${sub}/ holds a non-markdown file "${name}"`)
      files[`${sub}/${name}`] = await Bun.file(join(dir, name)).text()
    }
  }
  return files
}

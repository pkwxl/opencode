// The -m/--mode layer (design doc A.1): prompt-level scenario guidance that does
// not affect the driver's scheduling state machine.
// Modes are managed as file templates — built-ins in templates/modes/<name>.md
// (embedded at compile time via `with { type: "file" }`; adding a built-in mode =
// add the file + one import), and the target directory's
// .opencode/auto/modes/<name>.md may add a mode or override a same-named
// built-in, so a new mode needs zero source changes.
// Injection points of the two ModeSpec texts: init → the mode preamble of the
// phase-planning session (plans/0006-phases-design.md §E, consumed from P2);
// exec → the notes section of execution-class prompts (decompose / whole task /
// subtask / wrapup).
import { readFileSync } from "node:fs"
import { overlayMarkdownFiles } from "./overlay"
import builtinMigrate from "../templates/modes/migrate.md" with { type: "file" }

export type ModeSpec = {
  name: string
  // Mode preamble of the phase-planning session: scenario definition, task
  // arrangement principles.
  init: string
  // Mode notes appended to execution-class prompts (decompose / whole task /
  // subtask / wrapup).
  exec: string
}

// Mode file protocol: first line `# <name>` (must match the file name), both
// sections present, no unknown section.
const SECTIONS = ["init", "exec"]

// Sections of the retired final-review loop (plans/0044 D1): a project mode
// file written before the retirement still loads; their bodies are ignored.
const RETIRED_SECTIONS = ["final: audit", "final: validate", "final: finalize"]

// Load all modes: the built-in registry plus the target directory's
// .opencode/auto/modes/<name>.md (a same-named file overrides the built-in;
// the shared overlay loader reads the directory and enforces the name
// grammar). Invalid files throw (the CLI turns this into an exit-1 usage
// error). With dir omitted, only the built-ins are loaded.
export function loadModes(dir?: string): Record<string, ModeSpec> {
  const modes: Record<string, ModeSpec> = { migrate: parseModeFile("migrate", readFileSync(builtinMigrate, "utf8")) }
  if (!dir) return modes
  for (const file of overlayMarkdownFiles(dir, "modes", "mode")) {
    modes[file.name] = parseModeFile(file.name, file.text)
  }
  return modes
}

// Parse a mode file's content; throws on an invalid file, naming the missing or
// offending section.
export function parseModeFile(name: string, text: string): ModeSpec {
  const lines = text.split("\n")
  const title = /^#\s+(.+?)\s*$/.exec(lines[0] ?? "")
  if (!title || title[1] !== name) throw new Error(`mode file ${name}.md must start with "# ${name}"`)
  const bodies = new Map<string, string[]>()
  let section: string | undefined
  for (const line of lines.slice(1)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) {
      section = heading[1]
      if (RETIRED_SECTIONS.includes(section)) {
        section = undefined
        continue
      }
      if (!SECTIONS.includes(section)) {
        throw new Error(`mode file ${name}.md has unknown section "## ${section}" (available: ${SECTIONS.map((key) => `## ${key}`).join(", ")})`)
      }
      if (!bodies.has(section)) bodies.set(section, [])
      continue
    }
    if (section) bodies.get(section)!.push(line)
  }
  const body = (key: string) => trimBody(bodies.get(key) ?? []).join("\n")
  const missing = SECTIONS.filter((key) => !body(key))
  if (missing.length) {
    throw new Error(`mode file ${name}.md is missing sections: ${missing.map((key) => `## ${key}`).join(", ")}`)
  }
  return {
    name,
    init: body("init"),
    exec: body("exec"),
  }
}

function trimBody(lines: string[]): string[] {
  const copy = [...lines]
  while (copy.length && !copy[0].trim()) copy.shift()
  while (copy.length && !copy[copy.length - 1].trim()) copy.pop()
  return copy
}

// Contract surface for claude (MA.5, plans/0041 §4; root plan open question
// 7). The driver renders one agent contract per project — the opencode-shaped
// `.opencode/agent/<name>.md` (preflight checks it, init and reset own it) —
// and one permission policy, the target directory's `opencode.json`. Rather
// than a second, claude-shaped copy of each (which would need its own
// preflight, reset and drift checks), the adapter translates both at every
// process start:
//
// | driver contract                   | claude                                           |
// |-----------------------------------|--------------------------------------------------|
// | .opencode/agent/<name>.md body    | --append-system-prompt (frontmatter stripped)    |
// | AGENTS.md                         | read natively (built-in AGENTS.md support)       |
// | opencode.json `permission` rules  | --settings {"permissions": {allow, deny}}        |
// | --permission preset (MA.4)        | allow → --permission-mode bypassPermissions;     |
// |                                   | deny / block → --permission-prompts none         |
// | question tool                     | AskUserQuestion disallowed (capability off)      |
import { join } from "node:path"
import type { PermissionPreset } from "../types"

// The contract's body: YAML frontmatter is opencode configuration (mode,
// description), not instructions.
export function contractBody(text: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text)
  return (match ? text.slice(match[0].length) : text).trim()
}

// opencode permission keys → claude tool names. `list` has no claude
// counterpart (Glob covers it); `question` is handled by disallowing
// AskUserQuestion outright.
const TOOLS: Record<string, string[]> = {
  read: ["Read"],
  glob: ["Glob"],
  grep: ["Grep"],
  edit: ["Edit", "Write", "NotebookEdit"],
  write: ["Write"],
  bash: ["Bash"],
  webfetch: ["WebFetch"],
  websearch: ["WebSearch"],
  task: ["Task"],
}

export type ClaudePermissions = { allow: string[]; deny: string[] }

// opencode.json → claude permission rules. A rule value is "allow", "deny" or
// "ask"; "ask" maps to nothing (the preset settles it, as a permission request
// would be). A tool's value is either one rule or a pattern table
// (`bash: { "git status*": "allow" }`), where "*" is the bare tool and any
// other pattern becomes `Tool(pattern)`. A top-level string applies to every
// mapped tool. Unknown shapes are skipped: the file is the user's.
export function claudePermissions(config: unknown): ClaudePermissions {
  const out: ClaudePermissions = { allow: [], deny: [] }
  const permission = (config as { permission?: unknown } | undefined)?.permission
  const add = (rule: unknown, names: string[]) => {
    if (rule === "allow") out.allow.push(...names)
    if (rule === "deny") out.deny.push(...names)
  }
  if (typeof permission === "string") {
    for (const names of Object.values(TOOLS)) add(permission, names)
  }
  if (typeof permission !== "object" || permission === null) return dedupe(out)
  for (const [key, value] of Object.entries(permission)) {
    const names = TOOLS[key]
    if (!names) continue
    if (typeof value === "string") {
      add(value, names)
      continue
    }
    if (typeof value !== "object" || value === null) continue
    for (const [pattern, rule] of Object.entries(value)) {
      add(rule, pattern === "*" ? names : names.map((name) => `${name}(${pattern})`))
    }
  }
  return dedupe(out)
}

function dedupe(p: ClaudePermissions): ClaudePermissions {
  return { allow: [...new Set(p.allow)], deny: [...new Set(p.deny)] }
}

// Arguments of a process start that come from the target directory. Read
// fresh every start, so an edited opencode.json or a re-rendered contract
// takes effect with the next process. A missing contract for a named agent
// is an error (the dispatch fails; attempt adds the recovery hint).
export async function contractArgs(directory: string, agent: string | undefined, preset: PermissionPreset): Promise<{ args: string[] } | { error: string }> {
  const args: string[] = ["--disallowed-tools", "AskUserQuestion"]
  if (preset === "allow") args.push("--permission-mode", "bypassPermissions")
  else args.push("--permission-prompts", "none")
  if (agent !== undefined) {
    const file = `.opencode/agent/${agent}.md`
    const text = await Bun.file(join(directory, file)).text().catch(() => undefined)
    if (text === undefined) return { error: `agent contract file missing: ${file}` }
    const body = contractBody(text)
    if (body) args.push("--append-system-prompt", body)
  }
  const config = await Bun.file(join(directory, "opencode.json"))
    .text()
    .then((text) => JSON.parse(text) as unknown)
    .catch(() => undefined)
  const rules = claudePermissions(config)
  if (rules.allow.length || rules.deny.length) args.push("--settings", JSON.stringify({ permissions: rules }))
  return { args }
}

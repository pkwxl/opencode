// De-initialization (the inverse of init): precisely removes the config-layer
// artifacts init wrote, restoring the worktree to the uninitialized state and
// clearing config leftovers that would interfere with the opencode host
// program and other extension components.
//
// Boundaries (design points, read them all before changing anything):
//   1. Clears the config layer only. .auto/'s runtime state (logs,
//      stats/resolves/progress), docs/ (including the round directories R-NN
//      and task directories T-NNN) and tmp/ are never touched — that is the
//      work of humans and AI, not init's output.
//   2. The list is an enumerated whitelist: no globs, no recursive deletion.
//   3. Directory reclamation always uses rmdir (throws on non-empty, skipped)
//      and never rm -r. This is the mechanism that protects
//      .opencode/auto/prompts/ (the user's own prompt overlay directory, read
//      by template.ts) and the user's other agent contracts under
//      .opencode/agent/.
//   4. Files shared with the host program are touched only after a
//      byte-for-byte comparison: opencode.json is deleted only while its
//      content equals the template, kept once modified; AGENTS.md only has
//      the opencode-auto marker block stripped.
//   5. The project brief holds human intent: it is removed only while it equals
//      the stub init wrote, a filled brief is kept (plans/0052 D9, DF6).
import { rm, rmdir, stat } from "node:fs/promises"
import { join } from "node:path"
import templateConfig from "../templates/opencode.json" with { type: "file" }
import { removePointer } from "./agents-block"
import { BRIEF_FILE, renderProjectBrief } from "./brief"
import { removeGitignoreEntries } from "./gitignore"

export type ResetAction = "remove" | "strip" | "rmdir" | "keep"

export type ResetEntry = {
  // The path relative to the target directory, used to print the list.
  path: string
  action: ResetAction
  // Required for keep (why it is kept); optional extra note for the rest.
  reason?: string
}

// The config-layer artifacts init writes, in the order inverse to the writing.
const CONFIG_JSON = join(".opencode", "auto", "config.json")
// The legacy config holding only mode (config.ts's LEGACY_FILE): it lives
// under .auto/, but its nature is config, not runtime state, so it is in
// scope; the rest of .auto/ is untouched.
const LEGACY_CONFIG = join(".auto", "config.json")
const AGENT_MD = join(".opencode", "agent", "auto.md")
// Directories reclaimed when empty, from the inside out.
const PRUNE_DIRS = [join(".opencode", "auto"), join(".opencode", "agent"), ".opencode"]

async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists()
}

// Bun.file(...).exists() is always false for directories; directory existence
// must go through stat.
async function dirExists(path: string): Promise<boolean> {
  return stat(path).then((entry) => entry.isDirectory(), () => false)
}

// Computes the list but writes nothing: the CLI first prints it for the user,
// confirms, and only then applyReset.
export async function planReset(dir: string): Promise<ResetEntry[]> {
  const entries: ResetEntry[] = []

  if (await fileExists(join(dir, CONFIG_JSON))) entries.push({ path: CONFIG_JSON, action: "remove" })
  const brief = await Bun.file(join(dir, BRIEF_FILE)).text().catch(() => undefined)
  if (brief !== undefined) {
    entries.push(
      brief === renderProjectBrief()
        ? { path: BRIEF_FILE, action: "remove" }
        : { path: BRIEF_FILE, action: "keep", reason: "filled in, not the init stub, kept" },
    )
  }
  if (await fileExists(join(dir, LEGACY_CONFIG))) entries.push({ path: LEGACY_CONFIG, action: "remove" })

  // The agent contract is not compared: init already overwrites it
  // unconditionally from the template (replacing on any content difference) —
  // it is a pure auto artifact, and a hand edit does not earn it the status
  // of "the user's own content".
  if (await fileExists(join(dir, AGENT_MD))) entries.push({ path: AGENT_MD, action: "remove" })

  // opencode.json is read by the host program and may hold the user's own
  // model/permission settings: deleted only when byte-for-byte equal to the
  // template, otherwise kept.
  const configFile = join(dir, "opencode.json")
  if (await fileExists(configFile)) {
    const [current, template] = await Promise.all([Bun.file(configFile).text(), Bun.file(templateConfig).text()])
    entries.push(
      current === template
        ? { path: "opencode.json", action: "remove" }
        : { path: "opencode.json", action: "keep", reason: "content modified, not the init template original, kept" },
    )
  }

  const agents = join(dir, "AGENTS.md")
  if (await fileExists(agents)) {
    const preview = await removePointer(dir, { dryRun: true })
    if (preview.emptied) entries.push({ path: "AGENTS.md", action: "remove", reason: "only an empty shell title remains after stripping the marker block" })
    else if (preview.removed) entries.push({ path: "AGENTS.md", action: "strip", reason: "strip the opencode-auto marker block" })
  }

  const gitignore = join(dir, ".gitignore")
  if (await fileExists(gitignore)) {
    const preview = await removeGitignoreEntries(dir, { dryRun: true })
    if (preview.emptied) entries.push({ path: ".gitignore", action: "remove", reason: "file is empty after removing the entries" })
    else if (preview.removed) entries.push({ path: ".gitignore", action: "strip", reason: "remove the entries init wrote (tmp/, .auto/, the local-only files and nested git repositories)" })
  }

  for (const rel of PRUNE_DIRS) {
    if (await dirExists(join(dir, rel))) entries.push({ path: `${rel}/`, action: "rmdir", reason: "reclaim only when empty" })
  }

  return entries
}

// Executes the list. rmdir throws on a non-empty directory and is skipped —
// that is exactly the mechanism protecting prompts/ and the user's other
// agent contracts; do not change it to rm -r.
export async function applyReset(dir: string, entries: ResetEntry[]): Promise<void> {
  for (const entry of entries) {
    if (entry.action === "keep") continue
    if (entry.action === "rmdir") {
      await rmdir(join(dir, entry.path)).catch(() => {})
      continue
    }
    if (entry.path === "AGENTS.md") {
      if (entry.action === "remove") await rm(join(dir, "AGENTS.md"), { force: true })
      else await removePointer(dir)
      continue
    }
    if (entry.path === ".gitignore") {
      if (entry.action === "remove") await rm(join(dir, ".gitignore"), { force: true })
      else await removeGitignoreEntries(dir)
      continue
    }
    await rm(join(dir, entry.path), { force: true })
  }
}

// The human-readable render of the list (shared by the CLI and the tests, so
// "what is printed" and "what is deleted" come from the same source).
export function formatResetPlan(entries: ResetEntry[]): string {
  const label: Record<ResetAction, string> = { remove: "remove", strip: "strip", rmdir: "rmdir-if-empty", keep: "keep" }
  return entries.map((entry) => `  ${label[entry.action]}: ${entry.path}${entry.reason ? ` (${entry.reason})` : ""}`).join("\n")
}

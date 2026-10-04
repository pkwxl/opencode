// Maintenance of the driver's .gitignore entries (paired with reset, hence a
// near-leaf module — its only internal dependency is git.ts's repository
// discovery: exporting from loop.ts would drag reset.ts into the whole
// loop → runner → … chain, the same reason changedFiles was lifted into
// git.ts). loop.ts re-exports ensureGitignore so the existing import path
// @opencode-ai/auto-core/loop stays valid.
import { rm } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import { repoRoots } from "./git"

// The driver workdir: tmp/ (the driver-run test script requests and outputs,
// inside the target directory) and .auto/ (run logs, progress recovery records
// and other runtime state).
const ENTRIES = ["tmp/", ".auto/"]

// The model registry's project layer (plans/0055 §4.1). It belongs to whoever
// operates this checkout, not to the project, so it is local-only like
// opencode.json. The path is src/models.ts MODELS_FILE, spelled out here to
// keep this module near-leaf; test/gitignore.test.ts pins the two together.
export const MODELS_ENTRY = "/.opencode/auto/models.json"

// The local-only entries init writes on top of the workdir entries:
// .gitignore itself (the ignore rules are a local arrangement), .env
// (secrets), AGENTS.md / opencode.json (agent instructions and session
// configuration) and the model registry's project layer are not committed.
// reset removes the entries only: a project layer stays on disk, since the
// driver never wrote it.
const INIT_ENTRIES = ["/.gitignore", "/.env", "/AGENTS.md", "/opencode.json", MODELS_ENTRY]

// Line-normalized equivalence: a leading / and a trailing / are both
// disregarded (`/tmp`, `tmp/`, `tmp` are equivalent).
function normalize(line: string): string {
  return line.trim().replace(/^\//, "").replace(/\/$/, "")
}

// The nested git repositories inside the target tree (including
// worktrees/submodules whose .git is a file), as root-anchored directory
// entries. Ignoring them keeps the parent repository from absorbing a nested
// repository as a gitlink; nested repositories are still committed on their
// own by the unified commit (git.ts repoRoots discovers them on the
// filesystem, unaffected by ignore rules).
async function nestedRepoEntries(directory: string): Promise<string[]> {
  return (await repoRoots(directory))
    .filter((root) => root !== directory)
    .map((root) => `/${relative(directory, root).split(sep).join("/")}/`)
}

// Whether the directory is inside a git work tree. Same criterion as git.ts
// repoRoots (git rev-parse --is-inside-work-tree): the target directory may be
// a subdirectory of a larger repository (.git above it), so checking only for
// a local .git misjudges — the cost of a miss is .auto/ and tmp/ being carried
// into the parent repository by the unified commit, and the stats heartbeat
// rewriting the tracked stats.json, blocking every unit start with a dirty
// area of the driver's own making (2026-09-17 review H5).
async function insideWorkTree(directory: string): Promise<boolean> {
  const proc = Bun.spawn(["git", "-C", directory, "rev-parse", "--is-inside-work-tree"], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const out = await new Response(proc.stdout).text()
  return (await proc.exited) === 0 && out.trim() === "true"
}

// The shared append logic: entries with an existing equivalent line are
// skipped; outside git (not in any work tree and no .gitignore) nothing is
// done. Returns the entries actually appended (or, under dryRun, that would
// be appended).
// The non-git branch (plans/0073): init bootstraps a repository before
// ensureInitGitignore runs (git.ts bootstrapRepository), so a production
// init always has a work tree and writes the ignore set; the no-op remains
// for the callers that reach a non-git directory directly (run's
// ensureGitignore seam, the tests) — the production non-git tier is gone
// with the bootstrap.
async function appendEntries(directory: string, entries: string[], opts: { dryRun?: boolean }): Promise<string[]> {
  const file = join(directory, ".gitignore")
  const existing = await Bun.file(file).text().catch(() => undefined)
  if (existing === undefined && !(await insideWorkTree(directory))) return []
  const lines = existing ? existing.split("\n") : []
  const missing = [...new Set(entries)].filter((entry) => !lines.some((line) => normalize(line) === normalize(entry)))
  if (!missing.length) return []
  if (!opts.dryRun) await Bun.write(file, `${existing ? `${existing.trimEnd()}\n` : ""}${missing.join("\n")}\n`)
  return missing
}

// Ensure .gitignore ignores the driver workdir. The unified commit commits all
// uncommitted changes, so without the entries they would be carried along.
// Returns whether entries were appended. dryRun only reports whether
// it would append (for `fix`'s plan).
export async function ensureGitignore(directory: string, opts: { dryRun?: boolean } = {}): Promise<boolean> {
  return (await appendEntries(directory, ENTRIES, opts)).length > 0
}

// fix's rule for a project initialized before init wrote MODELS_ENTRY: append
// that one entry (the other local-only entries are the person's to keep or
// drop). Same equivalence and git criterion as ensureGitignore; returns whether
// it appended (dryRun: whether it would).
// AUTO-RESOLVE: does fix skip a .gitignore whose broader pattern (such as /.opencode/) already ignores the project layer? -> no, the rule looks for an equivalent line, as init does, not for git's verdict (such a file gets one redundant line, and the .gitignore then holds exactly the entry init writes and reset removes)
export async function ensureModelsGitignore(directory: string, opts: { dryRun?: boolean } = {}): Promise<boolean> {
  return (await appendEntries(directory, [MODELS_ENTRY], opts)).length > 0
}

// init's .gitignore initialization: on top of the driver workdir entries,
// append the local-only entries (INIT_ENTRIES) and an entry per nested git
// repository in the target tree. Returns the appended entries (for the log line).
export async function ensureInitGitignore(directory: string): Promise<string[]> {
  return appendEntries(directory, [...ENTRIES, ...INIT_ENTRIES, ...(await nestedRepoEntries(directory))], {})
}

// The inverse of ensureGitignore/ensureInitGitignore (for reset): removes every
// entry init wrote (the workdir, the local-only entries and the currently
// present nested repository entries); the user's own entries are kept as they
// are. If only blank remains after the removal the file is deleted (init
// created it). dryRun computes the result without writing, so reset can print
// the plan before asking.
export async function removeGitignoreEntries(
  directory: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ removed: boolean; emptied: boolean }> {
  const file = join(directory, ".gitignore")
  const existing = await Bun.file(file).text().catch(() => undefined)
  if (existing === undefined) return { removed: false, emptied: false }
  const targets = [...ENTRIES, ...INIT_ENTRIES, ...(await nestedRepoEntries(directory))].map(normalize)
  const kept = existing.split("\n").filter((line) => !targets.includes(normalize(line)))
  const removed = kept.length !== existing.split("\n").length
  const text = kept.join("\n").trim()
  const emptied = removed && text === ""
  if (!opts.dryRun && removed) {
    if (emptied) await rm(file, { force: true })
    else await Bun.write(file, `${text}\n`)
  }
  return { removed, emptied }
}

// Maintenance of the driver's .gitignore entries (paired with reset, hence a
// near-leaf module — its only internal dependency is git.ts's repository
// discovery: exporting from loop.ts would drag reset.ts into the whole
// loop → runner → … chain, the same reason changedFiles was lifted into
// git.ts). loop.ts re-exports ensureGitignore so the existing import path
// @opencode-ai/auto-core/loop stays valid.
import { rm, stat } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import { repoRoots } from "./git"

// The driver workdir: tmp/ (the driver-run test script requests and outputs,
// inside the target directory) and .auto/ (run logs, progress recovery records
// and other runtime state). Exported for test/gitignore.test.ts's pin against
// git.ts WORKDIR_ROOTS — the unit start gate's workdir exemption spells the
// roots leaf-side (git.ts cannot import this module back).
export const ENTRIES = ["tmp/", ".auto/"]

// The model registry's project layer (plans/0055 §4.1). It belongs to whoever
// operates this checkout, not to the project, so it is local-only like
// opencode.json. The path is src/models.ts MODELS_FILE, spelled out here to
// keep this module near-leaf; test/gitignore.test.ts pins the two together.
export const MODELS_ENTRY = "/.opencode/auto/models.json"

// The local-only entries init writes on top of the workdir entries: .env
// (secrets), AGENTS.md (the driver's block — derived byte-identically from
// the committed config and re-rendered by ensurePointer at every run start,
// so the file itself stays out of git while its source travels) and the
// model registry's project layer (the operator's, plans/0055 §4.1). The
// .gitignore itself and opencode.json are NOT here: they are committed
// project surfaces (plans/0138) — the ignore set is law every machine needs
// identically (a self-ignored file never reached git, and every fresh clone
// lost the whole set, the first run's housekeeping commit then tracking a
// partial file), and opencode.json holds the project's host posture
// (permission table, timeout keys, external-directory allows). reset removes
// the entries only: a project layer stays on disk, since the driver never
// wrote it.
const INIT_ENTRIES = ["/.env", "/AGENTS.md", MODELS_ENTRY]

// The retired entries (plans/0138): pre-0138 init ignored the .gitignore
// itself and opencode.json. fix strips the self-entry (the file surfaces
// untracked and lands in git with the next commit) and reports opencode.json's
// line for the person — the visibility of a file that holds person settings
// is a person act, and a person who must keep it local owns their own line.
export const RETIRED_ENTRIES = ["/.gitignore", "/opencode.json"]

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
  // The person's trailing blank lines are theirs to keep (plans/0239 D2b):
  // the base is the existing text verbatim when it already ends in a
  // newline, and one newline is added only when their last line lacks it —
  // the driver's entries need a fresh line, nothing more.
  if (!opts.dryRun) {
    const base = existing ? (existing.endsWith("\n") ? existing : `${existing}\n`) : ""
    await Bun.write(file, `${base}${missing.join("\n")}\n`)
  }
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

// fix's rule for the nested repositories in the tree (plans/0138): init
// stamps the set at init time, and a repository that appears later (or a
// pre-0138 clone whose partial .gitignore never carried the entries) would
// be absorbed by the parent's unified commit as a gitlink. Returns the
// entries appended (or, under dryRun, that would be).
export async function ensureNestedGitignore(directory: string, opts: { dryRun?: boolean } = {}): Promise<string[]> {
  return appendEntries(directory, await nestedRepoEntries(directory), opts)
}

// Which of the retired entries (RETIRED_ENTRIES) the .gitignore still holds,
// line-normalized — fix's findings read this; the two entries take different
// classes there (the self-entry is the tool's own surface to keep true, the
// opencode.json line a visibility decision that belongs to the person).
export async function retiredGitignoreEntries(directory: string): Promise<string[]> {
  const existing = await Bun.file(join(directory, ".gitignore")).text().catch(() => undefined)
  if (existing === undefined) return []
  return RETIRED_ENTRIES.filter((entry) => existing.split("\n").some((line) => normalize(line) === normalize(entry)))
}

// fix's strip of one retired entry: removes the equivalent line, deleting the
// file when nothing else remains (the same emptied rule as reset's). Returns
// whether a line was removed (dryRun computes without writing).
export async function removeGitignoreEntry(directory: string, entry: string, opts: { dryRun?: boolean } = {}): Promise<boolean> {
  return (await stripEntries(directory, [entry], opts)).removed
}

// init's .gitignore initialization: on top of the driver workdir entries,
// append the local-only entries (INIT_ENTRIES) and an entry per nested git
// repository in the target tree. Returns the appended entries (for the log line).
export async function ensureInitGitignore(directory: string): Promise<string[]> {
  return appendEntries(directory, [...ENTRIES, ...INIT_ENTRIES, ...(await nestedRepoEntries(directory))], {})
}

// The shared strip logic: removes the lines equivalent to the given entries;
// if only blank remains after the removal the file is deleted (init created
// it). The kept lines are written verbatim — the split/join round-trip
// carries the file's own trailing shape, and the person's leading and
// trailing blank lines survive the strip (plans/0239 D2c: the driver's
// rewrite reaches exactly its own lines, never a normalization of the
// person's formatting). dryRun computes the result without writing, so
// reset can print the plan before asking.
async function stripEntries(
  directory: string,
  entries: string[],
  opts: { dryRun?: boolean },
): Promise<{ removed: boolean; emptied: boolean }> {
  const file = join(directory, ".gitignore")
  const existing = await Bun.file(file).text().catch(() => undefined)
  if (existing === undefined) return { removed: false, emptied: false }
  const targets = entries.map(normalize)
  const kept = existing.split("\n").filter((line) => !targets.includes(normalize(line)))
  const removed = kept.length !== existing.split("\n").length
  const text = kept.join("\n")
  const emptied = removed && kept.every((line) => line.trim() === "")
  if (!opts.dryRun && removed) {
    if (emptied) await rm(file, { force: true })
    else await Bun.write(file, text)
  }
  return { removed, emptied }
}

// The inverse of ensureGitignore/ensureInitGitignore (for reset): removes every
// entry init wrote (the workdir, the local-only entries and the currently
// present nested repository entries); the user's own entries are kept as they
// are — including, on a project initialized before plans/0138, the retired
// /.gitignore and /opencode.json lines: fix owns their retirement, and what
// reset leaves behind is the person's.
export async function removeGitignoreEntries(
  directory: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ removed: boolean; emptied: boolean }> {
  return stripEntries(directory, [...ENTRIES, ...INIT_ENTRIES, ...(await nestedRepoEntries(directory))], opts)
}

// The .gitignore lines shaped like a nested-repository entry whose directory
// no longer exists on disk (plans/0239 D2d): possibly init's entry for a
// repository deleted after init — removeGitignoreEntries cannot strip it
// (it derives nested entries from the live tree, and no durable init-time
// record distinguishes init's stale line from the person's own), so reset
// reports them instead, never consuming what it cannot prove its own. The
// grammar is nestedRepoEntries' own write shape: a root-anchored,
// slash-closed relative path (glob metacharacters excluded — init never
// writes them).
export async function staleNestedEntryLines(directory: string): Promise<string[]> {
  const existing = await Bun.file(join(directory, ".gitignore")).text().catch(() => undefined)
  if (existing === undefined) return []
  const stale: string[] = []
  for (const raw of existing.split("\n")) {
    const line = raw.trim()
    if (!/^\/[^*?]+\/$/.test(line) || stale.includes(line)) continue
    if (!(await stat(join(directory, line)).then((entry) => entry.isDirectory(), () => false))) stale.push(line)
  }
  return stale
}

// External-directory allows for root symlinks (plans/0122): a project that
// plants a corpus or reference behind a top-level symlink (`linux` →
// /workspace/linux) reads it through the symlink in relative form without any
// permission cost, but the moment a session names the real path — the read
// tool resolving the symlink, a model-built absolute path — opencode raises
// its separate `external_directory` consent, and an unattended driver session
// (the default ask-deny posture) has the ask auto-denied after a timeout; the
// first T-002 exec session died exactly there. The structural rule (P16 — no
// project path enters code; the root symlink itself is the declared surface):
// every top-level symlink of the target directory whose real path lies
// outside the project root contributes `"<realpath>/**": "allow"` under
// `permission.external_directory` of the target's own opencode.json. init
// stamps the entries (into the template when it creates the file, additively
// into an existing one — the one conscious widening of "a person's file is
// only written when missing": exactly these allow entries are inserted,
// nothing else); fix keeps them in sync as a fixable finding. The write is a
// mechanical grammar (P7) and pure derivation from disk (P6 — re-running
// reproduces the same bytes; the machine-specific real path lives only in the
// gitignored opencode.json, never in git); with no root symlinks nothing is
// written and every byte stays as before (P10).
//
// Ordering: opencode evaluates a permission object's rules last-match-wins,
// so the driver inserts its entries at the FRONT of external_directory — a
// person's later rules (the compliance wall's deny) always win the tie, and a
// key the person already set, to any action, is never inserted over.
import { chmod, readdir, realpath, stat, writeFile } from "node:fs/promises"
import { join, sep } from "node:path"

// The opencode config file at the target root (the shell's template path;
// named here once so both commands and the tests agree).
export const OPENCODE_CONFIG_FILE = "opencode.json"

// The real paths of the target directory's top-level symlinks that resolve
// outside the project root: the declared external surfaces the stamp allows.
// Broken symlinks are skipped (nothing to allow), a real path that IS the
// root or one of its ancestors is excluded (allowing a parent of the project
// would be near-global, not a corpus), and the result is sorted and deduped —
// several symlinks onto one corpus contribute one entry.
export async function rootSymlinkRealPaths(dir: string): Promise<string[]> {
  const root = await realpath(dir).catch(() => dir)
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const external: string[] = []
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue
    const real = await realpath(join(dir, entry.name)).catch(() => undefined)
    if (real === undefined || real === root || root.startsWith(real + sep)) continue
    if (real.startsWith(root + sep)) continue
    external.push(real)
  }
  return [...new Set(external)].sort()
}

// The same scan keeping names beside targets (plans/0132): the reference
// doors — each top-level symlink with its resolved external real path, the
// pair the wall close records and removes. The same exclusion rules as
// rootSymlinkRealPaths; sorted by name.
export async function rootSymlinkDoors(dir: string): Promise<{ name: string; target: string }[]> {
  const root = await realpath(dir).catch(() => dir)
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const doors: { name: string; target: string }[] = []
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue
    const real = await realpath(join(dir, entry.name)).catch(() => undefined)
    if (real === undefined || real === root || root.startsWith(real + sep)) continue
    if (real.startsWith(root + sep)) continue
    doors.push({ name: entry.name, target: real })
  }
  return doors.sort((a, b) => a.name.localeCompare(b.name))
}

// The permission entries contributed by the real paths: `"<path>/**": "allow"`
// for each, in the same sorted order.
export function externalDirectoryEntries(realPaths: readonly string[]): Record<string, "allow"> {
  const entries: Record<string, "allow"> = {}
  for (const real of realPaths) entries[`${real}/**`] = "allow"
  return entries
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// The entry keys the file does not yet carry — absent from its
// permission.external_directory object entirely (a key the person already
// set, to any action, counts as present: person rules are never overridden).
// undefined when the text is malformed or its permission shape cannot hold
// per-pattern entries (a flat external_directory action) — the caller
// reports that instead of guessing.
export function missingExternalDirectoryAllows(text: string, entries: Record<string, "allow">): string[] | undefined {
  const value = parseConfig(text)
  if (value === undefined) return undefined
  const permission = value.permission
  if (permission === undefined) return Object.keys(entries)
  if (!isPlainObject(permission)) return undefined
  const external = permission.external_directory
  if (external === undefined) return Object.keys(entries)
  if (!isPlainObject(external)) return undefined
  return Object.keys(entries).filter((key) => !(key in external))
}

// The pure stamp: parse, insert the missing entry keys at the front of
// permission.external_directory (creating the section when absent), keep every
// other key and the person's key order untouched, serialize with the
// template's 2-space indent and trailing newline. Returns the text unchanged
// when nothing is missing, and undefined when the text is malformed or its
// permission shape cannot hold per-pattern entries — never a guess.
export function stampExternalDirectories(text: string, entries: Record<string, "allow">): string | undefined {
  const value = parseConfig(text)
  if (value === undefined) return undefined
  const missing = missingExternalDirectoryAllows(text, entries)
  if (missing === undefined || !missing.length) return missing === undefined ? undefined : text
  const permission = isPlainObject(value.permission) ? value.permission : {}
  const personExternal = isPlainObject(permission.external_directory) ? permission.external_directory : {}
  const inserted: Record<string, unknown> = {}
  for (const key of missing) inserted[key] = entries[key]
  // external_directory moves to the front of permission (key order inside
  // permission carries no matching meaning — order matters only within one
  // action's patterns), the person's other permission keys keep their order.
  const { external_directory: _replaced, ...personPermission } = permission
  const next = { ...value, permission: { external_directory: { ...inserted, ...personExternal }, ...personPermission } }
  return JSON.stringify(next, null, 2) + "\n"
}

// The stale allows of an existing file — entry keys `"<path>/**": "allow"`
// whose path is neither a current root-symlink real path nor present on disk:
// the corpus moved or the symlink was deleted, and the entry now allows a
// place that no longer exists. Report-only (fix's manual class); undefined
// when the file is malformed.
export async function staleExternalDirectoryAllows(text: string, currentRealPaths: readonly string[]): Promise<string[] | undefined> {
  const value = parseConfig(text)
  if (value === undefined) return undefined
  const permission = value.permission
  if (!isPlainObject(permission) || !isPlainObject(permission.external_directory)) return []
  const current = new Set(currentRealPaths)
  const stale: string[] = []
  for (const [key, action] of Object.entries(permission.external_directory)) {
    if (action !== "allow" || !key.endsWith("/**")) continue
    const base = key.slice(0, -3)
    if (current.has(base)) continue
    if (await stat(base).then(() => true, () => false)) continue
    stale.push(key)
  }
  return stale
}

// The planning half of the sync (no writes): what the stamp would do with the
// file as it stands. `no-symlinks` and `unchanged` are the byte-identical
// floor; `missing`/`malformed` hand the decision to their callers (init
// creates the file; fix reports it).
export async function externalAllowsStatus(dir: string): Promise<
  { status: "no-symlinks" } | { status: "missing" } | { status: "malformed" } | { status: "unchanged" } | { status: "needs-stamp"; missing: string[] }
> {
  const realPaths = await rootSymlinkRealPaths(dir)
  if (!realPaths.length) return { status: "no-symlinks" }
  const entries = externalDirectoryEntries(realPaths)
  const text = await Bun.file(join(dir, OPENCODE_CONFIG_FILE)).text().catch(() => undefined)
  if (text === undefined) return { status: "missing" }
  const missing = missingExternalDirectoryAllows(text, entries)
  if (missing === undefined) return { status: "malformed" }
  if (!missing.length) return { status: "unchanged" }
  return { status: "needs-stamp", missing }
}

// The apply half: re-derive from disk and write the stamp when it changes
// anything (chmod 0644 first when the file is read-only — the
// saveProjectConfig precedent). Idempotent; a no-op on the floor states.
export async function applyExternalAllows(dir: string): Promise<boolean> {
  const realPaths = await rootSymlinkRealPaths(dir)
  if (!realPaths.length) return false
  const entries = externalDirectoryEntries(realPaths)
  const file = join(dir, OPENCODE_CONFIG_FILE)
  const text = await Bun.file(file).text().catch(() => undefined)
  if (text === undefined) return false
  const stamped = stampExternalDirectories(text, entries)
  if (stamped === undefined || stamped === text) return false
  await chmod(file, 0o644).catch(() => {})
  await writeFile(file, stamped)
  return true
}

function parseConfig(text: string): Record<string, unknown> | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  return isPlainObject(value) ? value : undefined
}

// —— The wall-side entries (plans/0132 D2) ——
//
// The closed predicate's allow half: the wall is closed iff the door is
// absent and no live external_directory entry covers the recorded target.
// These pure readers and writers work on the same permission shape the
// 0122 stamp built; the driver-stamp identification is byte-exact — the
// stamp for a target is `"<target>/**": "allow"`, re-derivable while the
// door exists — so any OTHER key covering the target is a person-authored
// entry the driver never removes (the person-entry split).

// The live permission.external_directory entries of a config text:
// undefined when the text is malformed or the section cannot hold
// per-pattern entries (the same fail-loud shapes as the stamp readers).
export function externalDirectoryLive(text: string): Record<string, string> | undefined {
  const value = parseConfig(text)
  if (value === undefined) return undefined
  const permission = value.permission
  if (permission === undefined) return {}
  if (!isPlainObject(permission)) return undefined
  const external = permission.external_directory
  if (external === undefined) return {}
  if (!isPlainObject(external)) return undefined
  const out: Record<string, string> = {}
  for (const [key, action] of Object.entries(external)) out[key] = String(action)
  return out
}

// One allow entry's base path (a `<path>/**` pattern names `<path>`), or
// undefined for a non-allow entry or a pattern the wall does not read as a
// directory allow.
export function allowBase(key: string): string | undefined {
  return key.endsWith("/**") ? key.slice(0, -3) : undefined
}

// Whether an allow entry's pattern covers a path: the target itself or
// anything beneath it.
export function allowCovers(key: string, path: string): boolean {
  const base = allowBase(key)
  return base !== undefined && (path === base || path.startsWith(base + sep))
}

// The live allow entries covering any of the targets (sorted, deduped).
export function coveringAllowKeys(text: string, targets: readonly string[]): string[] {
  const live = externalDirectoryLive(text)
  if (live === undefined) return []
  return [...new Set(Object.keys(live).filter((key) => live[key] === "allow" && targets.some((target) => allowCovers(key, target))))].sort()
}

// The driver-stamp key for one target (0122's exact bytes).
export const stampKey = (target: string): string => `${target}/**`

// The wall's write to opencode.json (plans/0132 D2): retire the driver's own
// stamps — remove exactly the stamp keys of the targets — and stamp a
// standing deny on each, additively (no 0122 exception invoked: the deny is
// a new key, the retired stamp the driver withdrawing its own). Person keys
// and their order are kept; the deny lands at the front of
// external_directory beside the stamp's own ordering discipline (a person's
// later rules keep winning the tie). Returns the next text (the input
// unchanged when nothing moves), or undefined when the text is malformed.
export function stampWallClosure(text: string, targets: readonly string[]): string | undefined {
  const value = parseConfig(text)
  if (value === undefined) return undefined
  const permission = isPlainObject(value.permission) ? value.permission : {}
  const external = isPlainObject(permission.external_directory) ? permission.external_directory : {}
  const retiring = new Set(targets.map(stampKey))
  const denies: Record<string, unknown> = {}
  for (const target of [...new Set(targets)].sort()) denies[stampKey(target)] = "deny"
  // Keep every person key in its order (a deny the person already set on the
  // exact key keeps its action only when it is the wall's own deny — an
  // allow on a stamp key is the stamp itself, retired; a person deny stays a
  // deny, the same bytes the wall would write).
  const person: Record<string, unknown> = {}
  for (const [key, action] of Object.entries(external)) {
    if (retiring.has(key) && action === "allow") continue
    person[key] = denies[key] !== undefined && action === "allow" ? "deny" : action
  }
  const { external_directory: _replaced, ...personPermission } = permission
  const next = { ...value, permission: { external_directory: { ...denies, ...person }, ...personPermission } }
  const out = JSON.stringify(next, null, 2) + "\n"
  return out === text ? text : out
}

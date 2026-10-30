// External-directory allows for root symlinks (plans/0122) and the
// working-directory knowledge boundary (plans/0147): a project that
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
// `permission.external_directory` of the target's own opencode.json — and,
// since plans/0147 D2, the matching `"<realpath>/**": "deny"` under
// `permission.edit`: the symlink's target is reference knowledge, opened
// read-only (the t083 incident's first fork read a sibling checkout's future
// state through exactly such an opening and ported it as a "fix"). init
// stamps the entries (into the template when it creates the file, additively
// into an existing one — the one conscious widening of "a person's file is
// only written when missing": exactly these entries are inserted, nothing
// else); fix keeps them in sync as a fixable finding. The write is a
// mechanical grammar (P7) and pure derivation from disk (P6 — re-running
// reproduces the same bytes; the machine-specific real path lives only in the
// gitignored opencode.json, never in git); with no root symlinks nothing is
// written and every byte stays as before (P10).
//
// The boundary (plans/0147 D1): the template ships
// `external_directory: { "/**": "deny", "/tmp/**": "allow" }` — every path
// outside the working directory denied (sibling checkouts, other forks, the
// main checkout — the knowledge the agent must not read), /tmp excepted (the
// standing receipts convention the target projects' own test scripts mount);
// the person widens by later keys, never the agent. fix carries the boundary
// to standing projects as its own fixable finding.
//
// Ordering: opencode evaluates a permission object's rules last-match-wins,
// so order matters only within one action's patterns. The driver inserts its
// allow entries AFTER any `"/**"` key (the boundary's catch-all deny —
// whoever set it — so the allows function), and otherwise at the front of
// external_directory — a person's later rules (the compliance wall's deny)
// always win the tie, and a key the person already set, to any action, is
// never inserted over. The edit-layer denies insert after a leading `"*"`
// key of the edit object (so they beat the blanket action) and otherwise at
// its front — again with every person key that follows still winning.
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

// The edit-layer entries of the read-only composite (plans/0147 D2):
// `"<path>/**": "deny"` for each — the write side of a symlink target
// closed while the external_directory allow opens the read side.
export function readOnlyEditEntries(realPaths: readonly string[]): Record<string, "deny"> {
  const entries: Record<string, "deny"> = {}
  for (const real of realPaths) entries[`${real}/**`] = "deny"
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

// The edit-layer denies the file does not yet carry (plans/0147 D2): absent
// from permission.edit entirely — the same person-key split (an edit key the
// person already set, to any action, is never inserted over). An absent or
// bare-action edit rule means every deny is missing (the stamp materializes
// the object form, the blanket action preserved as its leading `"*"` entry);
// undefined when the text is malformed or the edit rule is neither an action
// nor a pattern object.
export function missingReadOnlyEditDenies(text: string, entries: Record<string, "deny">): string[] | undefined {
  const value = parseConfig(text)
  if (value === undefined) return undefined
  const permission = value.permission
  if (permission === undefined) return Object.keys(entries)
  if (!isPlainObject(permission)) return undefined
  const edit = permission.edit
  if (edit === undefined || typeof edit === "string") return Object.keys(entries)
  if (!isPlainObject(edit)) return undefined
  return Object.keys(entries).filter((key) => !(key in edit))
}

// Rebuild a pattern object with `inserted` placed after its `"*"` key when
// one exists (the blanket action the inserted denies must beat), else at
// the front — every existing key keeps its relative order (a person's later
// keys keep winning the tie).
function objectWithInserted<T>(existing: Record<string, unknown>, inserted: Record<string, T>): Record<string, unknown> {
  const keys = Object.keys(existing)
  const cut = keys.includes("*") ? keys.indexOf("*") + 1 : 0
  const out: Record<string, unknown> = {}
  for (const key of keys.slice(0, cut)) out[key] = existing[key]
  Object.assign(out, inserted)
  for (const key of keys.slice(cut)) out[key] = existing[key]
  return out
}

// Rebuild external_directory with the missing entries placed after its
// `"/**"` key when present (the boundary's catch-all deny — whoever set it —
// so the allows function beneath it), else at the front (0122's own
// ordering, the file without a boundary). Shared by the symlink-allow stamp
// and the boundary pair (plans/0155 D3: the /tmp allowance must win its tie
// against a person-set `"/**"` the same way a corpus allow does).
function externalWithAllows(existing: Record<string, unknown>, inserted: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(existing)
  const cut = keys.indexOf("/**") + 1
  const out: Record<string, unknown> = {}
  for (const key of keys.slice(0, cut)) out[key] = existing[key]
  Object.assign(out, inserted)
  for (const key of keys.slice(cut)) out[key] = existing[key]
  return out
}

// The pure stamp: parse, insert the missing entry keys into
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
  const inserted: Record<string, "allow"> = {}
  for (const key of missing) inserted[key] = entries[key]
  // external_directory moves to the front of permission (key order inside
  // permission carries no matching meaning — order matters only within one
  // action's patterns), the person's other permission keys keep their order.
  const { external_directory: _replaced, ...personPermission } = permission
  const next = { ...value, permission: { external_directory: externalWithAllows(personExternal, inserted), ...personPermission } }
  return JSON.stringify(next, null, 2) + "\n"
}

// The read-only composite's edit-layer stamp (plans/0147 D2): insert the
// missing `"<realpath>/**": "deny"` keys into permission.edit — an absent or
// bare-action rule materializes as the object form with the blanket action
// preserved as its leading `"*"` entry; an existing object keeps its order
// with the denies placed to function (after a leading `"*"` key, else at the
// front). Returns the text unchanged when nothing is missing, undefined on
// the malformed shapes — never a guess.
export function stampReadOnlyEdits(text: string, entries: Record<string, "deny">): string | undefined {
  const value = parseConfig(text)
  if (value === undefined) return undefined
  const missing = missingReadOnlyEditDenies(text, entries)
  if (missing === undefined || !missing.length) return missing === undefined ? undefined : text
  const permission = isPlainObject(value.permission) ? value.permission : {}
  const inserted: Record<string, "deny"> = {}
  for (const key of missing) inserted[key] = entries[key]
  let edit: Record<string, unknown>
  const existing = permission.edit
  if (existing === undefined || typeof existing === "string") {
    edit = { "*": existing ?? "ask", ...inserted }
  } else {
    edit = objectWithInserted(existing as Record<string, unknown>, inserted)
  }
  const { edit: _replaced, ...personPermission } = permission
  const next = { ...value, permission: { ...personPermission, edit } }
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
// creates the file; fix reports it). Since plans/0147 D2 the stamp is the
// read-only composite — `missing` names either layer's absent keys.
export async function externalAllowsStatus(dir: string): Promise<
  { status: "no-symlinks" } | { status: "missing" } | { status: "malformed" } | { status: "unchanged" } | { status: "needs-stamp"; missing: string[] }
> {
  const realPaths = await rootSymlinkRealPaths(dir)
  if (!realPaths.length) return { status: "no-symlinks" }
  const entries = externalDirectoryEntries(realPaths)
  const editEntries = readOnlyEditEntries(realPaths)
  const text = await Bun.file(join(dir, OPENCODE_CONFIG_FILE)).text().catch(() => undefined)
  if (text === undefined) return { status: "missing" }
  const missing = missingExternalDirectoryAllows(text, entries)
  const editMissing = missingReadOnlyEditDenies(text, editEntries)
  if (missing === undefined || editMissing === undefined) return { status: "malformed" }
  const all = [...missing, ...editMissing.map((key) => `edit:${key}`)]
  if (!all.length) return { status: "unchanged" }
  return { status: "needs-stamp", missing: all }
}

// The apply half: re-derive from disk and write the read-only composite (the
// external_directory allows and, since plans/0147 D2, the edit-layer denies)
// when either layer changes anything (chmod 0644 first when the file is
// read-only — the saveProjectConfig precedent). Idempotent; a no-op on the
// floor states.
export async function applyExternalAllows(dir: string): Promise<boolean> {
  const realPaths = await rootSymlinkRealPaths(dir)
  if (!realPaths.length) return false
  const file = join(dir, OPENCODE_CONFIG_FILE)
  const text = await Bun.file(file).text().catch(() => undefined)
  if (text === undefined) return false
  let next = stampExternalDirectories(text, externalDirectoryEntries(realPaths))
  if (next === undefined) return false
  next = stampReadOnlyEdits(next, readOnlyEditEntries(realPaths))
  if (next === undefined || next === text) return false
  await chmod(file, 0o644).catch(() => {})
  await writeFile(file, next)
  return true
}

// —— The working-directory knowledge boundary (plans/0147 D1) ——
//
// The template ships it; fix carries it to standing projects (their committed
// opencode.json keeps the pre-boundary bytes — init only writes the file when
// missing). The boundary is exactly two keys, inserted at the front of
// external_directory in this order: `"/**": "deny"` (everything outside the
// working directory denied) then `"/tmp/**": "allow"` (the receipts
// convention) — a later key beats the deny, so the person widens by appending
// their own keys, and existing symlink allows (0122's front-inserted stamps)
// land after the deny by this very insertion and keep functioning. A file
// that already carries a `"/**"` key (the person's own catch-all, to any
// action — never inserted over) takes the missing pair right after it
// (plans/0155 D3): a front insert there would leave the /tmp allowance
// before the person's deny and silently disable the receipts convention.

// The boundary keys in their canonical order (the deny first — anything
// inserted after it wins the tie against it).
export const KNOWLEDGE_BOUNDARY: Record<string, "deny" | "allow"> = { "/**": "deny", "/tmp/**": "allow" }

// Whether the file carries the boundary: every boundary key present, to any
// action (a person's own `/**` rule is the same wall — never inserted over).
// undefined on the malformed shapes (the fix rule reports those as manual).
export function knowledgeBoundaryMissing(text: string): boolean | undefined {
  const value = parseConfig(text)
  if (value === undefined) return undefined
  const permission = value.permission
  if (permission === undefined) return true
  if (!isPlainObject(permission)) return undefined
  const external = permission.external_directory
  if (external === undefined) return true
  if (!isPlainObject(external)) return undefined
  return Object.keys(KNOWLEDGE_BOUNDARY).some((key) => !(key in external))
}

// The boundary's stamp: insert the missing boundary keys in canonical order
// (creating the section when absent) — at the front, or right after an
// existing `"/**"` key when the file carries one (externalWithAllows'
// placement, plans/0155 D3), every existing key kept in its order — existing
// allows and person rules end up after the deny and therefore win their
// ties, and the /tmp allowance wins its tie against a person-set catch-all
// too. Returns the text unchanged when the boundary is present, undefined on
// the malformed shapes.
export function stampKnowledgeBoundary(text: string): string | undefined {
  const value = parseConfig(text)
  if (value === undefined) return undefined
  const missing = knowledgeBoundaryMissing(text)
  if (missing === undefined || !missing) return missing === undefined ? undefined : text
  const permission = isPlainObject(value.permission) ? value.permission : {}
  const personExternal = isPlainObject(permission.external_directory) ? permission.external_directory : {}
  const inserted: Record<string, "deny" | "allow"> = {}
  for (const [key, action] of Object.entries(KNOWLEDGE_BOUNDARY)) if (!(key in personExternal)) inserted[key] = action
  const { external_directory: _replaced, ...personPermission } = permission
  const next = { ...value, permission: { external_directory: externalWithAllows(personExternal, inserted), ...personPermission } }
  return JSON.stringify(next, null, 2) + "\n"
}

// Whether a live external_directory key is the boundary's own canonical
// entry (the exact key at its canonical action — re-derivable from the
// template, the same argument as a 0122 stamp's bytes): never a
// person-authored widening for the wall's split, never retired.
export function isBoundaryKey(live: Record<string, string>, key: string): boolean {
  return live[key] === KNOWLEDGE_BOUNDARY[key]
}

// The targets the boundary's canonical allowances cover (plans/0147, the
// wall interplay): a reference inside the allowed /tmp subtree cannot seal —
// the receipts convention's standing allowance beats the wall's per-target
// deny under last-match-wins, so the seal cannot hold. The wall's close
// refuses such targets, teaching the move.
export function boundaryAllowedTargets(live: Record<string, string> | undefined, targets: readonly string[]): string[] {
  if (live === undefined) return []
  const allowed = Object.entries(KNOWLEDGE_BOUNDARY).filter(([, action]) => action === "allow").map(([key]) => key)
  return targets.filter((target) => allowed.some((key) => isBoundaryKey(live, key) && allowCovers(key, target)))
}

// The boundary's apply half (fix's fixable rule): write the stamp when it
// changes anything. Idempotent; a no-op when present or the file is missing
// (init owns the missing-file case).
export async function applyKnowledgeBoundary(dir: string): Promise<boolean> {
  const file = join(dir, OPENCODE_CONFIG_FILE)
  const text = await Bun.file(file).text().catch(() => undefined)
  if (text === undefined) return false
  const stamped = stampKnowledgeBoundary(text)
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
// and their order are kept — except at the retiring stamp keys, where the
// wall's deny always stands (plans/0155 D3: the person's action at that slot
// is overridden by the seal they invoked at transfer; an allow there is the
// stamp itself, retired, and a weaker action must not erase the deny the
// close records); the deny lands at the front of external_directory beside
// the stamp's own ordering discipline (a person's later rules keep winning
// the tie). Returns the next text (the input unchanged when nothing moves),
// or undefined when the text is malformed.
export function stampWallClosure(text: string, targets: readonly string[]): string | undefined {
  const value = parseConfig(text)
  if (value === undefined) return undefined
  const permission = isPlainObject(value.permission) ? value.permission : {}
  const external = isPlainObject(permission.external_directory) ? permission.external_directory : {}
  const retiring = new Set(targets.map(stampKey))
  const denies: Record<string, unknown> = {}
  for (const target of [...new Set(targets)].sort()) denies[stampKey(target)] = "deny"
  // Keep every person key in its order; a retiring key contributes nothing
  // of the person's — the wall's deny in `denies` is the entry that stands.
  const person: Record<string, unknown> = {}
  for (const [key, action] of Object.entries(external)) {
    if (retiring.has(key)) continue
    person[key] = action
  }
  const { external_directory: _replaced, ...personPermission } = permission
  const next = { ...value, permission: { external_directory: { ...denies, ...person }, ...personPermission } }
  const out = JSON.stringify(next, null, 2) + "\n"
  return out === text ? text : out
}

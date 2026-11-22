// The wall-side entries of the external-directory permission shape (plans/
// 0132 D2) and the one door scan they derive from. The init/fix stamp family
// that once lived here — the root-symlink allows and the read-only edit
// denies stamped into the target's opencode.json (plans/0122/0147/0188) — is
// gone with plans/0296: the host's configuration file is never the tool's,
// written by no command and read by no rule. What remains serves the sealed
// reference wall (the push path's boundary machinery, demolition-docketed
// under plans/0279's track): the pure readers and the coverage question the
// wall's closed predicate answers over the permission section, in opencode's
// own evaluation semantics, and the wall's own closure stamp — dead-path
// beside its dead callers until the track deletes the family whole.
import { readdir, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { join, sep } from "node:path"

// The opencode config file at the target root — named here once so the wall's
// readers and the tests agree. The tool never writes it (plans/0296).
export const OPENCODE_CONFIG_FILE = "opencode.json"

// The one scan (plans/0132): each top-level symlink with its resolved
// external real path — the reference doors the wall close records and
// removes. Broken symlinks are skipped, the root and its ancestors excluded,
// in-tree targets excluded; sorted by name.
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

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// opencode judges every permission key with its own wildcard matcher
// (packages/core/src/util/wildcard.ts: escape the specials, `*` → `.*`,
// `?` → `.`, anchored) and evaluates an object's rules last-match-wins in
// file key order. The coverage question must answer with that matcher. The
// core carries no dependency on opencode's packages (P14 — the SDK seam is
// the adapter's, and the matcher is not in it), so the translation is
// mirrored here, in this one home, and test/helpers/perm-oracle.ts pins the
// mirror against the matcher itself (imported from the workspace source) over
// a spelling corpus: divergence is a red test, never a silent drift.
function opencodeMatch(input: string, pattern: string): boolean {
  const normalized = input.replaceAll("\\", "/")
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"
  return new RegExp("^" + escaped + "$", process.platform === "win32" ? "si" : "s").test(normalized)
}

// —— The working-directory knowledge boundary keys (plans/0147 D1) ——
//
// The canonical pair the template once shipped (`"/**": "deny"` — everything
// outside the working directory denied, /tmp excepted). The stamp arms are
// gone; the wall's readers still consult the pair to split a canonical
// allowance from a person-authored widening.

// The boundary keys in their canonical order (the deny first — anything
// inserted after it wins the tie against it).
export const KNOWLEDGE_BOUNDARY: Record<string, "deny" | "allow"> = { "/**": "deny", "/tmp/**": "allow" }

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
// retired 0122 stamp built; the driver-stamp identification is byte-exact —
// the stamp for a target is `"<target>/**": "allow"`, re-derivable while the
// door exists — so any OTHER key covering the target is a person-authored
// entry the driver never removes (the person-entry split).

// The live permission.external_directory entries of a config text:
// undefined when the text is malformed or the section cannot hold
// per-pattern entries.
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

// Whether two paths name the same tree, one beneath the other, or one over
// the other (plans/0189 D3): a symlink resolving OVER a recorded wall target
// (an ancestor of it) re-admits the target as surely as one resolving inside
// it — reads through `<ancestor>/<target-tail>/…` reach it lexically
// in-tree. The wall's door relation shares this one predicate.
export function pathsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(b + sep) || b.startsWith(a + sep)
}

// The driver-stamp key for one target (0122's exact bytes).
export const stampKey = (target: string): string => `${target}/**`

// —— The wall's coverage question, evaluated with opencode's own semantics
// (plans/0189 D3) ——
//
// opencode answers a read of an out-of-tree path by asserting
// external_directory with the absolute `<dirname>/*` glob, judged by findLast
// over the section's rules in file key order, `~`/`$HOME` expanded at load,
// the unmatched default ask. The closed predicate's allow half must answer
// the same question the same way: a recorded target is OPEN when any ask
// beneath it answers other than deny. The asks are derived from the section
// itself — `<target>/*` (which every catch-all and ancestor key matches)
// plus each live key's scope ask (the key minus its trailing wildcards,
// `*`-capped) wherever it names a path beneath the target, which is what
// carries the segment-specific keys (`<target>/sub/**`) no flat probe
// reaches. The matcher is 0188's mirror, the expansion opencode's own
// (test/helpers/perm-oracle.ts pins both against the imported matcher).

function expandPattern(pattern: string): string {
  if (pattern.startsWith("~/")) return homedir() + pattern.slice(1)
  if (pattern === "~") return homedir()
  if (pattern.startsWith("$HOME/")) return homedir() + pattern.slice(5)
  if (pattern.startsWith("$HOME")) return homedir() + pattern.slice(5)
  return pattern
}

function scopeAskOf(expandedKey: string): string {
  return expandedKey.replace(/[\*\?]+$/, "") + "*"
}

// One decisive open finding over the recorded targets: `target` and the
// first `ask` beneath it whose last matching rule answers other than deny;
// `key` names the winning entry (undefined = NOTHING matched the ask — even
// the wall's standing deny is gone from the section), `action` the answer
// (a person "ask" counts open — P12's conservative direction: an attended
// click admits).
export type CoveringOpen = { target: string; ask: string; key?: string; action: "allow" | "ask" }

export function admittingCoverage(text: string, targets: readonly string[]): CoveringOpen[] {
  const live = externalDirectoryLive(text)
  if (live === undefined || !targets.length) return []
  return admittingCoverageLive(live, targets)
}

// The same scan over the already-parsed section (0238 D5c): the wall's
// closed predicate reads the section once for its own boundary keys and
// calls this half, never re-parsing the text inside the coverage question.
export function admittingCoverageLive(live: Record<string, string>, targets: readonly string[]): CoveringOpen[] {
  if (!targets.length) return []
  const entries = Object.entries(live)
  const open: CoveringOpen[] = []
  for (const target of targets) {
    const asks = [`${target}/*`]
    for (const [key] of entries) {
      const ask = scopeAskOf(expandPattern(key))
      if (ask.startsWith(target + sep) && !asks.includes(ask)) asks.push(ask)
    }
    for (const ask of asks) {
      let winner: { key: string; action: string } | undefined
      for (const [key, action] of entries) if (opencodeMatch(ask, expandPattern(key))) winner = { key, action }
      if (winner === undefined) {
        open.push({ target, ask, action: "ask" })
        break
      }
      if (winner.action !== "deny") {
        open.push({ target, ask, key: winner.key, action: winner.action === "allow" ? "allow" : "ask" })
        break
      }
    }
  }
  return open
}

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
// or undefined when the text is malformed. Dead-path beside the wall's own
// dead callers (plans/0296's docket: the push demolition track deletes the
// family whole).
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

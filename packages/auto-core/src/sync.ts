// Bundle sync (plans/0100 D4/D5): the person's upgrade command for a
// materialized intent bundle — plan-then-apply on the fix/install-prompts
// pattern. Detection is everywhere (preflight, fix, status read the
// provenance sidecar); propagation is this one explicit, confirmed command:
// never silent, never automatic, and it never touches config.json
// (materialization writes files only; config stamps are init's, 0079 §3).
//
//   stamped project   unedited managed files fast-forward byte-identically
//                     to the running binary's bundle and the stamp rewrites
//                     with the new digests; person-edited files are reported
//                     with the headings delta and never written; files the
//                     running bundle no longer ships are reported, never
//                     deleted; files the bundle newly ships land as adds.
//   unstamped project the bootstrap (D5): for each file the running bundle
//                     (resolved by the config's intent key) would write,
//                     byte-identical → adopt (write the stamp, report
//                     "adopted"); differing → report-only with the delta —
//                     `--from-bundle` opts into overwriting them (the
//                     person's assertion that the pack is pristine-but-old).
//   extras            files under the materialized homes the bundle set
//                     does not name (a person-added phases/<type>.md):
//                     reported, never deleted (the 0093 extras rule).
//
// The stamp after a sync records exactly the tool's last-written bytes:
// fast-forwarded/added/adopted/overwritten paths take the binary's digests,
// person-edited paths keep their original stamp entry (so detection keeps
// naming the binary's offer while no write ever reaches them), and paths
// that stayed unmanaged stay out. The open-round warning proceeds, never
// refuses: a round in flight means later phases would plan under changed
// charters, which is the person's call to make at a boundary, not the
// tool's to forbid. The run-lock refusal is the shell's (the config-command
// family rule); this module writes nothing but the managed files and the
// sidecar — no git, the person commits.
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { bundleFileMap, resolveIntentBundle, parseIntentBundle } from "./bundle"
import { loadProjectConfig } from "./config"
import {
  PROVENANCE_FILE,
  compareProvenance,
  headingLines,
  headingsDelta,
  parseProvenanceStamp,
  provenanceStampOfEntries,
  renderProvenanceStamp,
  sha256Text,
  type ProvenanceFile,
} from "./provenance"

// The materialized homes whose contents sync scans for extras.
const HOMES = [join(".opencode", "auto", "phases"), join(".opencode", "auto", "intents"), join(".opencode", "auto", "modes")] as const

export type SyncEntry =
  // Stamped, disk = stamp = binary: nothing to do (kept in the report so a
  // dryrun shows the whole managed set).
  | { action: "current"; path: string }
  // Stamped, disk = stamp, the binary's bytes differ and still ship: the
  // write — byte-identical fast-forward. The direction is named (a binary
  // predating the materialization downgrades on confirm; the plan says so).
  | { action: "fast-forward"; path: string; direction: "binary-newer" | "binary-older" | "diverged"; added: string[]; removed: string[] }
  // Stamped, the running bundle no longer ships the file: reported, never
  // deleted; it leaves the managed set (the stamp drops it).
  | { action: "retired"; path: string; removed: string[] }
  // Stamped, disk ≠ stamp: person-owned — reported with the person's own
  // edit and the bundle's offer, never written; the stamp entry stands so
  // detection keeps its visibility.
  | { action: "edited"; path: string; onDisk: boolean; stampAdded: string[]; stampRemoved: string[]; added: string[]; removed: string[] }
  // The bundle ships a path the stamp never managed: it lands (byte-identical
  // or missing on disk); a person file already sitting at the path collides
  // and is reported — `--from-bundle` overwrites.
  | { action: "add"; path: string }
  | { action: "collision"; path: string; added: string[]; removed: string[]; missing: boolean }
  // Unstamped bootstrap: byte-identical → adopt (the stamp alone is written);
  // differing → report-only, or the `--from-bundle` overwrite.
  | { action: "adopt"; path: string }
  | { action: "differ"; path: string; added: string[]; removed: string[]; missing: boolean }
  // Under a materialized home, named by neither the bundle set nor the
  // stamp: reported, never deleted.
  | { action: "extra"; path: string }

export type SyncPlan = {
  // The running bundle the plan syncs to; undefined on the nothing-to-do
  // paths (nothing names a bundle).
  bundle?: string
  // Why there is nothing to sync; the shell prints it and exits 0.
  nothing?: string
  entries: SyncEntry[]
  // The file writes behind the actionable entries, in order; the sidecar
  // rewrite rides as the last write (stampText), never first.
  writes: { path: string; text: string }[]
  stampText?: string
  // The open-round warning (unticking lines in some docs/R-NN/phases.md):
  // proceeds, never refuses.
  openRound?: string
}

export type SyncOpts = { fromBundle?: boolean }

// Compute the whole plan without writing. A stamped project syncs by the
// stamp's bundle name; an unstamped one bootstraps over the bundle the
// config's intent key names (no stamp and no bundle → nothing to do).
export async function planSync(dir: string, opts: SyncOpts = {}): Promise<SyncPlan> {
  const stampText = await Bun.file(join(dir, PROVENANCE_FILE)).text().catch(() => undefined)
  const stamp = stampText === undefined ? undefined : parseProvenanceStamp(stampText)
  const bundleName = stamp?.bundle ?? (await bundleNameOfConfig(dir))
  if (bundleName === undefined) {
    return { nothing: stamp === undefined ? "no provenance stamp and the config's intent names no bundle — nothing materialized to sync" : undefined, entries: [], writes: [] }
  }
  const files = await resolveIntentBundle(bundleName)
  if (files === undefined) {
    return { nothing: `the materialized bundle "${bundleName}" does not resolve in this binary (no built-in, no registration, no directory) — nothing to sync against`, bundle: bundleName, entries: [], writes: [] }
  }
  const binary = bundleFileMap(parseIntentBundle(files))
  const disk: Record<string, string> = {}
  for (const path of new Set([...Object.keys(stamp?.files ?? {}), ...Object.keys(binary)])) {
    const text = await Bun.file(join(dir, path)).text().catch(() => undefined)
    if (text !== undefined) disk[path] = text
  }
  const entries: SyncEntry[] = []
  const writes: SyncPlan["writes"] = []
  // The next stamp: the tool's last-written bytes per managed path.
  const nextFiles: Record<string, ProvenanceFile> = {}
  const see = (path: string, text: string) => {
    nextFiles[path] = { sha256: sha256Text(text), headings: headingLines(text) }
  }
  if (stamp !== undefined) {
    for (const [path, state] of Object.entries(compareProvenance(stamp, disk, binary).files)) {
      if (state.state === "current") {
        entries.push({ action: "current", path })
        see(path, binary[path]!)
        continue
      }
      if (state.state === "stale") {
        if (!state.inBinary) {
          entries.push({ action: "retired", path, removed: state.removed })
          continue
        }
        entries.push({ action: "fast-forward", path, direction: state.direction, added: state.added, removed: state.removed })
        writes.push({ path, text: binary[path]! })
        see(path, binary[path]!)
        continue
      }
      entries.push({ action: "edited", path, onDisk: state.onDisk, stampAdded: state.stampAdded, stampRemoved: state.stampRemoved, added: state.added, removed: state.removed })
      // The stamp entry stands: the tool's last-written bytes, so the person
      // edit stays person-edited (authoritative) in every later comparison.
      nextFiles[path] = stamp.files[path]!
    }
  }
  // Paths the bundle ships that the stamp never managed: the stamped-new
  // adds and (unstamped) the whole bootstrap set.
  for (const path of Object.keys(binary).sort()) {
    if (stamp !== undefined && stamp.files[path] !== undefined) continue
    const text = binary[path]!
    const onDisk = disk[path]
    if (onDisk === undefined || onDisk === text) {
      entries.push({ action: stamp === undefined ? "adopt" : "add", path })
      if (onDisk === undefined) writes.push({ path, text })
      see(path, text)
    } else {
      const { added, removed } = headingsDelta(headingLines(onDisk), headingLines(text))
      if (opts.fromBundle) {
        entries.push({ action: "fast-forward", path, direction: "binary-newer", added, removed })
        writes.push({ path, text })
        see(path, text)
      } else {
        entries.push({ action: stamp === undefined ? "differ" : "collision", path, added, removed, missing: false })
      }
    }
  }
  // The extras: everything under the materialized homes neither the bundle
  // set nor the stamp names.
  for (const extra of await extrasOf(dir, new Set([...Object.keys(binary), ...Object.keys(stamp?.files ?? {})]))) {
    entries.push({ action: "extra", path: extra })
  }
  const stampText2 = writes.length > 0 || Object.keys(nextFiles).length > 0 ? renderProvenanceStamp(provenanceStampOfEntries(bundleName, nextFiles)) : undefined
  const openRound = await openRoundWarning(dir)
  return { bundle: bundleName, entries, writes, ...(stampText2 !== undefined ? { stampText: stampText2 } : {}), ...(openRound !== undefined ? { openRound } : {}) }
}

// The bundle name the config's intent key resolves to (the bootstrap's
// source): undefined when the intent names a plain pack, not a bundle.
async function bundleNameOfConfig(dir: string): Promise<string | undefined> {
  let intent: string | undefined
  try {
    intent = (await loadProjectConfig(dir)).intent
  } catch {
    return undefined
  }
  if (intent === undefined) return undefined
  return (await resolveIntentBundle(intent)) !== undefined ? intent : undefined
}

async function extrasOf(dir: string, named: ReadonlySet<string>): Promise<string[]> {
  const extras: string[] = []
  for (const home of HOMES) {
    let names: string[]
    try {
      names = Array.from(await readdir(join(dir, home)))
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : ""
      if (code === "ENOENT" || code === "ENOTDIR") continue
      throw error
    }
    for (const name of names.sort()) {
      const path = [home, name].join("/")
      if (!named.has(path)) extras.push(path)
    }
  }
  return extras
}

// The open-round warning (proceeds, never refuses): any phase index holding
// unticking lines means a round is in flight, and later phases would plan
// under changed charters — the person's boundary call.
async function openRoundWarning(dir: string): Promise<string | undefined> {
  let docs: string[]
  try {
    docs = Array.from(await readdir(join(dir, "docs")))
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : ""
    if (code === "ENOENT" || code === "ENOTDIR") return undefined
    throw error
  }
  const open: string[] = []
  for (const name of docs.sort()) {
    if (!/^R-\d+$/.test(name)) continue
    const index = ["docs", name, "phases.md"].join("/")
    const text = await Bun.file(join(dir, index)).text().catch(() => undefined)
    if (text !== undefined && text.split("\n").some((line) => line.startsWith("- [ ] "))) open.push(index)
  }
  return open.length ? `a round is in flight (${open.join(", ")} holds open phases): later phases would plan under changed charters — the boundary call is yours` : undefined
}

// Apply exactly the plan's writes (the sidecar last). Never throws partway
// silently: a failed write rejects and the shell reports it.
export async function applySync(dir: string, plan: SyncPlan): Promise<void> {
  for (const write of plan.writes) await Bun.write(join(dir, write.path), write.text)
  if (plan.stampText !== undefined) await Bun.write(join(dir, PROVENANCE_FILE), plan.stampText)
}

// The plan as the shell prints it (and the tests read it): one line per
// entry, the writes and the report-only alike, then the open-round warning.
export function formatSyncPlan(plan: SyncPlan): string {
  const lines: string[] = []
  for (const entry of plan.entries) {
    const delta = (added: readonly string[], removed: readonly string[]) => {
      const parts: string[] = []
      if (added.length) parts.push(`adds ${added.join(", ")}`)
      if (removed.length) parts.push(`drops ${removed.join(", ")}`)
      return parts.length ? ` (${parts.join(", ")})` : ""
    }
    switch (entry.action) {
      case "current":
        lines.push(`  = ${entry.path}: current`)
        break
      case "fast-forward":
        lines.push(
          `  → ${entry.path}: fast-forward to the running bundle${delta(entry.added, entry.removed)}${entry.direction === "binary-older" ? " (the running binary's bundle predates your materialized pack — this writes its bytes; upgrade the tool if that is not intended)" : ""}`,
        )
        break
      case "retired":
        lines.push(`  ⚠ ${entry.path}: no longer shipped by the running bundle — left in place, remove it by hand if the retirement is intended (drops ${entry.removed.join(", ")})`)
        break
      case "edited":
        lines.push(`  ✋ ${entry.path}: edited after materialization${entry.onDisk ? ` (you ${entry.stampAdded.length ? `added ${entry.stampAdded.join(", ")}` : ""}${entry.stampAdded.length && entry.stampRemoved.length ? " and " : ""}${entry.stampRemoved.length ? `removed ${entry.stampRemoved.join(", ")}` : ""})` : " (deleted)"} — person-owned, never written${entry.added.length || entry.removed.length ? `; the running bundle ${entry.added.length ? `adds ${entry.added.join(", ")}` : ""}${entry.added.length && entry.removed.length ? " and " : ""}${entry.removed.length ? `drops ${entry.removed.join(", ")}` : ""}` : ""}`)
        break
      case "add":
        lines.push(`  + ${entry.path}: newly shipped by the running bundle — lands byte-identically`)
        break
      case "collision":
        lines.push(`  ⚠ ${entry.path}: the running bundle now ships this path and it differs from your file${delta(entry.added, entry.removed)} — left alone; --from-bundle overwrites it`)
        break
      case "adopt":
        lines.push(`  ✓ ${entry.path}: byte-identical to the running bundle — adopted (the stamp starts managing it)`)
        break
      case "differ":
        lines.push(`  ⚠ ${entry.path}: ${entry.missing ? "missing" : "differs from the running bundle"}${delta(entry.added, entry.removed)} — report-only; --from-bundle overwrites it (your call that the pack is pristine-but-old)`)
        break
      case "extra":
        lines.push(`  ⚠ ${entry.path}: not named by the running bundle — kept (remove it by hand if unwanted)`)
        break
    }
  }
  if (plan.openRound) lines.push(`  ${plan.openRound}`)
  return lines.join("\n")
}

// Whether the plan would change anything on disk (files or stamp): the
// dryrun exit-code gate — report-only entries inform but do not move it.
export function syncWritesAnything(plan: SyncPlan): boolean {
  return plan.writes.length > 0 || plan.stampText !== undefined
}

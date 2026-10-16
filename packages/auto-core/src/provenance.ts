// Bundle provenance (plans/0100 D1–D2): the committed sidecar
// .opencode/auto/provenance.json records what init's bundle materialization
// wrote — per managed file the sha256 of the bytes and the file's heading
// lines — so any later tool can compute the three-state truth against the
// files on disk and the bundle the running binary resolves by name:
//
//   current        file bytes = the stamp, and the binary's bundle = the stamp
//   stale          file bytes = the stamp, the binary differs
//                  (fast-forwardable; the direction is named)
//   person-edited  file bytes ≠ the stamp (authoritative, never written)
//
// The incident this closes: a committed, semantic, never-resynced surface
// (the pack's `### verify-plan-test` charter) can silently predate the
// running binary — materialization records nothing about itself, so no gate
// could say so. The stamp is detection state, never a gate: a stale pack
// still loads and still runs.
//
// This module is the pure half (the D2 comparison and the stamp's
// build/serialize/parse): nothing here writes, spawns, or reads env; callers
// read the sidecar and the managed files and hand the texts in. The writer
// is materialization itself (src/bundle.ts writes the sidecar beside the
// files it lands, and derives the bundle's file map); `sync` (src/sync.ts)
// is the person's upgrade command. A hand-written pack with no stamp is
// person-owned by construction and produces no findings.

// The sidecar's repository-relative home: beside the materialized files,
// inside .opencode/auto/ but committed state (a .auto/ home would be
// local-only — a second checkout on a machine running a different binary
// must detect the same gap, which is the stamp's whole point).
export const PROVENANCE_FILE = ".opencode/auto/provenance.json"

// One managed file's record: the sha256 of the bytes written plus the file's
// heading lines (`^## ` / `^### `, trimmed, in order) — the cheap
// human-readable delta every message reports ("your pack lacks
// `### verify-plan-test`", never "digest mismatch").
export type ProvenanceFile = { sha256: string; headings: string[] }

// The sidecar's shape. bundle names the materialized bundle (the key the
// running shell re-resolves it by); bundleDigest digests the managed set
// (sorted path + per-file sha256), so one comparison names a bundle-level
// change before any per-file walk.
export type ProvenanceStamp = { bundle: string; bundleDigest: string; files: Record<string, ProvenanceFile> }

export function sha256Text(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex")
}

// A text's heading lines, trimmed, in order — the delta vocabulary. Only the
// two pack-grammar levels count (`## sections`, `### subsections`); deeper
// headings are body prose.
export function headingLines(text: string): string[] {
  const headings: string[] = []
  for (const raw of text.split("\n")) {
    if (/^##\s/.test(raw) || /^###\s/.test(raw)) headings.push(raw.trim())
  }
  return headings
}

// The headings delta from one heading list to another (order-insensitive:
// sections move, and a move is not a semantic change worth reporting).
export function headingsDelta(from: readonly string[], to: readonly string[]): { added: string[]; removed: string[] } {
  const a = new Set(from)
  const b = new Set(to)
  return {
    added: to.filter((heading) => !a.has(heading)),
    removed: from.filter((heading) => !b.has(heading)),
  }
}

// Build a stamp from the bytes a materialization wrote (or would write):
// files maps repository-relative path → text, exactly the managed set.
export function provenanceStampOf(bundle: string, files: Record<string, string>): ProvenanceStamp {
  const out: Record<string, ProvenanceFile> = {}
  for (const path of Object.keys(files).sort()) {
    const text = files[path]!
    out[path] = { sha256: sha256Text(text), headings: headingLines(text) }
  }
  const bundleDigest = sha256Text(
    Object.keys(out)
      .sort()
      .map((path) => `${path}\0${out[path]!.sha256}`)
      .join("\n"),
  )
  return { bundle, bundleDigest, files: out }
}

// Serialize the sidecar (stable key order, trailing newline — house style).
export function renderProvenanceStamp(stamp: ProvenanceStamp): string {
  const files: Record<string, ProvenanceFile> = {}
  for (const path of Object.keys(stamp.files).sort()) files[path] = stamp.files[path]!
  return `${JSON.stringify({ bundle: stamp.bundle, bundleDigest: stamp.bundleDigest, files }, null, 2)}\n`
}

// Parse the sidecar; undefined when the text is not a stamp (an unparsable
// or hand-mangled sidecar degrades to the unstamped floor — report-only,
// never a failure: the pack itself stays loadable).
export function parseProvenanceStamp(text: string): ProvenanceStamp | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  if (typeof record.bundle !== "string" || !record.bundle.trim()) return undefined
  if (typeof record.bundleDigest !== "string" || !record.bundleDigest) return undefined
  if (typeof record.files !== "object" || record.files === null || Array.isArray(record.files)) return undefined
  const files: Record<string, ProvenanceFile> = {}
  for (const [path, entry] of Object.entries(record.files as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return undefined
    const file = entry as Record<string, unknown>
    if (typeof file.sha256 !== "string" || !file.sha256) return undefined
    if (!Array.isArray(file.headings) || file.headings.some((heading) => typeof heading !== "string")) return undefined
    files[path] = { sha256: file.sha256, headings: file.headings as string[] }
  }
  return { bundle: record.bundle, bundleDigest: record.bundleDigest, files }
}

// The three-state truth for one managed file (plans/0100 D2). The direction
// is named from the headings delta and both directions carry: binary-newer
// (the running bundle carries sections the stamped pack lacks — the
// fast-forward case), binary-older (the stamped pack carries sections the
// running bundle does not — a binary predating the materialization disables
// features just as silently), diverged (both). inBinary: false marks a file
// the running bundle no longer ships at all.
export type ProvenanceFileState =
  | { state: "current" }
  | { state: "stale"; direction: "binary-newer" | "binary-older" | "diverged"; inBinary: boolean; added: string[]; removed: string[] }
  // added/removed: what the running bundle would change vs the on-disk file
  // (the upgrade story every message tells). stampAdded/stampRemoved: the
  // person's own edit vs the stamp. onDisk: false = deleted since
  // materialization — an edit of the strongest kind.
  | { state: "person-edited"; onDisk: boolean; added: string[]; removed: string[]; stampAdded: string[]; stampRemoved: string[] }

export type ProvenanceComparison = {
  bundle: string
  // Exactly the stamp's files, keyed repository-relative.
  files: Record<string, ProvenanceFileState>
  // The running bundle's own stamp over the same managed set (the
  // bundle-level counterpart the direction story reads from).
  binaryStamp: ProvenanceStamp
}

// The pure three-state comparison (plans/0100 D2). stamp is the parsed
// sidecar; disk maps the repository-relative paths present on disk to their
// texts (a stamp file missing from disk is person-edited/deleted); binary
// maps the paths the running shell's bundle carries to their texts (from
// resolveIntentBundle + bundleFileMap, never git). The stamp-vs-binary
// comparison is symmetric: a project materialized from a newer bundle than
// the running binary names the binary-older direction, not a false stale.
export function compareProvenance(stamp: ProvenanceStamp, disk: Record<string, string>, binary: Record<string, string>): ProvenanceComparison {
  const files: Record<string, ProvenanceFileState> = {}
  for (const path of Object.keys(stamp.files).sort()) {
    const record = stamp.files[path]!
    const onDiskText = disk[path]
    const binaryText = binary[path]
    if (onDiskText !== undefined && sha256Text(onDiskText) === record.sha256) {
      if (binaryText !== undefined && sha256Text(binaryText) === record.sha256) {
        files[path] = { state: "current" }
        continue
      }
      const { added, removed } = headingsDelta(record.headings, binaryText === undefined ? [] : headingLines(binaryText))
      files[path] = {
        state: "stale",
        direction: !binaryText ? "binary-older" : removed.length === 0 ? "binary-newer" : added.length === 0 ? "binary-older" : "diverged",
        inBinary: binaryText !== undefined,
        added,
        removed,
      }
      continue
    }
    const diskHeadings = onDiskText === undefined ? [] : headingLines(onDiskText)
    const binaryHeadings = binaryText === undefined ? [] : headingLines(binaryText)
    const { added, removed } = headingsDelta(diskHeadings, binaryHeadings)
    const stampDelta = headingsDelta(record.headings, diskHeadings)
    files[path] = {
      state: "person-edited",
      onDisk: onDiskText !== undefined,
      added,
      removed,
      stampAdded: stampDelta.added,
      stampRemoved: stampDelta.removed,
    }
  }
  return { bundle: stamp.bundle, files, binaryStamp: provenanceStampOf(stamp.bundle, binary) }
}

// —— the detection messages (plans/0100 D3) ——
//
// Pure formatters over one comparison: the single ⚠ line the preflight log
// gains beside the intent-pack line (stale files only — either direction;
// the person's own edits are theirs, fix and status report those), and one
// finding text per non-current managed file for fix's manual findings and
// status's rows. Every message names the headings delta, never a digest.

function deltaText(added: readonly string[], removed: readonly string[]): string {
  const parts: string[] = []
  if (added.length) parts.push(`adds ${added.join(", ")}`)
  if (removed.length) parts.push(`drops ${removed.join(", ")}`)
  return parts.join(", ")
}

function editText(added: readonly string[], removed: readonly string[]): string {
  const parts: string[] = []
  if (added.length) parts.push(`adds ${added.join(", ")}`)
  if (removed.length) parts.push(`removes ${removed.join(", ")}`)
  return parts.join(", ")
}

// One finding per stale or person-edited managed file (fix's manual class,
// status's rows); empty when everything is current — the quiet floor.
export function provenanceFindings(comparison: ProvenanceComparison): { path: string; problem: string }[] {
  const findings: { path: string; problem: string }[] = []
  for (const [path, state] of Object.entries(comparison.files)) {
    if (state.state === "stale") {
      const direction = !state.inBinary
        ? "the running bundle no longer ships this file"
        : state.direction === "binary-newer"
          ? "the running bundle is newer"
          : state.direction === "binary-older"
            ? "the running binary's bundle predates your materialized pack"
            : "the running bundle diverged from your materialized pack"
      findings.push({ path, problem: `stale — ${direction} (${deltaText(state.added, state.removed)}); run sync to fast-forward the unedited files` })
    } else if (state.state === "person-edited") {
      const own = state.onDisk ? editText(state.stampAdded, state.stampRemoved) : "the file was deleted"
      const offer = deltaText(state.added, state.removed)
      findings.push({
        path,
        problem: `edited after materialization (${own}${offer ? `; the running bundle ${offer}` : ""}) — person-owned, sync never writes it`,
      })
    }
  }
  return findings
}

// The preflight clause: one line when any managed file is stale (either
// direction), undefined on the quiet floor. Names the direction and the
// headings delta; a fast-forwardable pack says so.
export function provenanceNoticeLine(comparison: ProvenanceComparison): string | undefined {
  const stale = Object.entries(comparison.files).filter(([, state]) => state.state === "stale")
  if (!stale.length) return undefined
  const older = stale.some(([, state]) => state.state === "stale" && state.direction === "binary-older")
  const parts = stale.map(([path, state]) => {
    if (state.state !== "stale") return ""
    const delta = deltaText(state.added, state.removed)
    return `${path}: ${!state.inBinary ? "no longer shipped by the running bundle" : state.direction === "binary-older" ? "your pack predates it, the running bundle lacks sections you have" : delta ? `the running bundle ${delta}` : "the running bundle differs"}`
  })
  return `⚠ intent bundle ${comparison.bundle}: ${stale.length} materialized file(s) ${older ? "differ from the running binary's bundle (a stale binary disables sections just as silently — upgrade the tool)" : "can fast-forward to the running binary's bundle (sync)"} — ${parts.join("; ")}`
}

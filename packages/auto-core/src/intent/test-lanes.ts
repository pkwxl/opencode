// The test-lane table (plans/0096 D3): the intent pack's optional
// `### test-lanes` subsection under `## quality`, beside the self-check
// sections — the project's declared dependency vocabulary of tests, the same
// standing `Depends:`/`Touches:` holds for tasks. One field block per suite:
//   <name>:
//   Command: <the project's own runner — a container harness, a make target>
//   Cost: cheap | anchor
//   Surfaces: <comma-separated repository-relative paths>
//   Exclusive: yes | no
// Per-project and versioned in the pack overlay: the project declares its
// suites once, and sessions and the driver both read this same parse (Stage
// 3's driver-run lane scheduler consumes it; a task's `## Acceptance` names
// which row is its anchor — prompt guidance only, no driver validation).
// Strict like the pack file itself: a malformed row throws naming the pack
// and the offending line, so preflight (testLanesProblem, mirroring
// guaranteesProblem) turns it into a usage error ahead of any render. A pack
// without the subsection is the byte-identical zero-intent floor (the 0080
// optionality precedent): parseTestLanes returns undefined, nothing renders,
// nothing changes.
import type { IntentPack } from "./types"
import { packSubsection } from "./load"

// One suite row. name doubles as the lane id (the receipt file
// docs/T-NNN/testhands/<name>.md), so it must be filename-safe — the loader's
// pack/mode naming discipline. exclusive: the suite must run alone in the
// tree (two lanes invoking the same build directory collide; an exclusive
// lane is serialized against its peers). surfaces: the directories/files the
// suite exercises — the vocabulary carry-forward and narrow re-runs select
// lanes by.
export type TestLane = {
  name: string
  command: string
  cost: "cheap" | "anchor"
  surfaces: string[]
  exclusive: boolean
}

// The suite-header line (`lint:`); a field line (`Command: …`). A header with
// content after the colon matches neither and is malformed.
const SUITE_HEAD = /^([a-z][a-z0-9-]*):\s*$/
const FIELD_LINE = /^(Command|Cost|Surfaces|Exclusive):[ \t]*(.*)$/
const GRAMMAR = "grammar: <suite>: then Command:, Cost: cheap|anchor, Surfaces: <comma-separated repository-relative paths>, Exclusive: yes|no — one block per suite"

// Parse the active pack's lane table; undefined when the pack declares none
// (or the section holds comments only — the zero-intent floor). Throws
// load-style on a malformed row, naming the pack and the offending line.
export function parseTestLanes(pack: IntentPack): TestLane[] | undefined {
  const text = packSubsection(pack, "quality", "test-lanes")
  if (text === undefined) return undefined
  const lanes: TestLane[] = []
  const names = new Set<string>()
  let block: { name: string; fields: Map<string, string> } | undefined
  const close = () => {
    if (!block) return
    for (const field of ["Command", "Cost", "Surfaces", "Exclusive"]) {
      if (!block.fields.has(field)) throw new Error(`intent pack "${pack.name}" test-lanes suite "${block.name}" is missing its ${field} line`)
    }
    const command = block.fields.get("Command")!
    if (!command) throw new Error(`intent pack "${pack.name}" test-lanes suite "${block.name}" Command must not be empty`)
    const cost = block.fields.get("Cost")!
    if (cost !== "cheap" && cost !== "anchor") throw new Error(`intent pack "${pack.name}" test-lanes suite "${block.name}" Cost must be cheap or anchor, got: ${cost || "(empty)"}`)
    const exclusive = block.fields.get("Exclusive")!
    if (exclusive !== "yes" && exclusive !== "no") throw new Error(`intent pack "${pack.name}" test-lanes suite "${block.name}" Exclusive must be yes or no, got: ${exclusive || "(empty)"}`)
    lanes.push({ name: block.name, command, cost, surfaces: parseSurfaces(pack.name, block.name, block.fields.get("Surfaces")!), exclusive: exclusive === "yes" })
    block = undefined
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const head = SUITE_HEAD.exec(line)
    if (head) {
      close()
      if (names.has(head[1]!)) throw new Error(`intent pack "${pack.name}" declares test-lanes suite "${head[1]}" twice`)
      names.add(head[1]!)
      block = { name: head[1]!, fields: new Map() }
      continue
    }
    const field = FIELD_LINE.exec(line)
    if (!field || !block) {
      throw new Error(`intent pack "${pack.name}" has a malformed test-lanes line: ${line} (${GRAMMAR})`)
    }
    if (block.fields.has(field[1]!)) {
      throw new Error(`intent pack "${pack.name}" test-lanes suite "${block.name}" repeats its ${field[1]} line`)
    }
    block.fields.set(field[1]!, field[2]!.trim())
  }
  close()
  return lanes.length ? lanes : undefined
}

// Surfaces carry the `Touches:` discipline: repository-relative paths, never
// absolute, never `..`.
function parseSurfaces(packName: string, suite: string, text: string): string[] {
  const surfaces = text.split(",").map((token) => token.trim()).filter(Boolean)
  for (const surface of surfaces) {
    if (surface.startsWith("/") || surface.split("/").includes("..")) {
      throw new Error(`intent pack "${packName}" test-lanes suite "${suite}" Surfaces must be comma-separated repository-relative paths (no absolute paths, no ..), got: ${text}`)
    }
  }
  if (!surfaces.length) {
    throw new Error(`intent pack "${packName}" test-lanes suite "${suite}" Surfaces must name at least one path`)
  }
  return surfaces
}

// Preflight-side validation (loop-preflight.ts): the first problem with the
// pack's declared lane table, undefined when clean — the testLanes counterpart
// of guaranteesProblem.
export function testLanesProblem(pack: IntentPack): string | undefined {
  try {
    parseTestLanes(pack)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

// —— Stage 3, the driver's read of the same table (plans/0096 D5) ——
// The receipt format the `test-lanes` partial prescribes ("the lane line, the
// tree HEADs, start and end times, the verdict, and for a failure the bounded
// evidence … plus the log path; it ends with the terminator line") as the
// driver writes it and parses it back — one field line per element:
//   Lane: <suite name>
//   Heads: <root>=<sha>[; <root>=<sha>…]   (one pair per repository, the
//                                           target-relative root, "." = the
//                                           target directory itself)
//   Start: <ISO 8601> / End: <ISO 8601>
//   Verdict: green | red
//   Log: <the lane's log path under /tmp/opencode/>
//   Carried: <receipt path>                (carry receipts only)
// The three machine fields (Lane/Heads/Verdict) are what carry-forward and
// the anchor pre-gate read; everything else is evidence for the sessions.

// One receipt's machine-read fields. heads are the tree HEADs the receipt's
// verdict vouches for — the carry-forward diff's range end (git diff
// <heads>..HEAD); an empty list (a receipt born outside git) never carries.
// end is the ISO end time, the "last green receipt" ordering key.
export type LaneReceipt = {
  lane: string
  heads: { root: string; sha: string }[]
  verdict: "green" | "red"
  end?: string
}

// Parse a receipt's machine fields; undefined when the text does not carry
// them (the caller treats an unparsable receipt as absent — a lane without a
// readable green receipt re-runs, the fail-safe direction).
export function parseLaneReceipt(text: string): LaneReceipt | undefined {
  let lane: string | undefined
  let heads: { root: string; sha: string }[] | undefined
  let verdict: "green" | "red" | undefined
  let end: string | undefined
  for (const raw of text.split("\n")) {
    const field = /^(Lane|Heads|Verdict|End):[ \t]*(.*)$/.exec(raw.trim())
    if (!field) continue
    const value = field[2]!.trim()
    if (field[1] === "Lane") {
      if (lane === undefined) lane = value
    } else if (field[1] === "Heads") {
      if (heads === undefined) heads = parseHeads(value)
    } else if (field[1] === "Verdict") {
      if (verdict === undefined) verdict = value === "green" || value === "red" ? value : undefined
    } else if (end === undefined) end = value
  }
  if (!lane || heads === undefined || verdict === undefined) return undefined
  return { lane, heads, verdict, ...(end ? { end } : {}) }
}

// `.=abc1234; nested=def5678` → the heads list; [] for an empty value (a
// receipt born outside git); undefined on a malformed token.
function parseHeads(value: string): { root: string; sha: string }[] | undefined {
  if (!value) return []
  const heads: { root: string; sha: string }[] = []
  for (const token of value.split(";")) {
    const pair = /^([^=]+)=([0-9a-f]{4,40})$/.exec(token.trim())
    if (!pair) return undefined
    heads.push({ root: pair[1]!.trim(), sha: pair[2]! })
  }
  return heads
}

// Whether a lane's declared surfaces intersect a set of changed paths — the
// `Touches:` matching discipline (a directory surface contains every path
// inside it; equal paths match). The twin of pathsOverlap in src/lanes.ts,
// reimplemented here because the intent domain may not import driver modules;
// the two must stay in step.
const pathSegments = (path: string): string[] => path.split(/[\\/]+/).filter((part) => part !== "" && part !== ".")

export function laneTouches(surfaces: readonly string[], paths: readonly string[]): boolean {
  return surfaces.some((surface) =>
    paths.some((path) => {
      const a = pathSegments(surface)
      const b = pathSegments(path)
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return false
      return true
    }),
  )
}

// The `## Acceptance` section of a task document's body (the charter text the
// anchor resolution scans; "" when the body carries no such section).
export function acceptanceSection(body: string): string {
  const lines = body.split("\n")
  const start = lines.findIndex((line) => /^##\s+Acceptance\s*$/.test(line.trim()))
  if (start < 0) return ""
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break
    out.push(line)
  }
  return out.join("\n").trim()
}

// The unit's anchor row (plans/0096 D3): the table row the task's
// `## Acceptance` names — the partial's wording ("a task's `## Acceptance`
// names which row is its anchor") is the protocol both sides read, so the
// driver scans the section's text for lane names (word-boundary; names are
// lowercase words). The smallest honest rule: exactly one name resolves the
// anchor; none named falls back to the table's anchor-cost rows when exactly
// one exists; anything else (no name and zero or several anchor-cost rows, or
// more than one name) is no pre-gate — an ambiguous anchor never gates
// mechanically, the verify session judges the receipts by inspection.
export function anchorLaneOf(acceptance: string, lanes: readonly TestLane[]): TestLane | undefined {
  const named = lanes.filter((lane) => new RegExp(`(^|[^a-z0-9-])${escapeRe(lane.name)}($|[^a-z0-9-])`).test(acceptance))
  if (named.length === 1) return named[0]
  if (named.length > 1) return undefined
  const anchors = lanes.filter((lane) => lane.cost === "anchor")
  return anchors.length === 1 ? anchors[0] : undefined
}

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

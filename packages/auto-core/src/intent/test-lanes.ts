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

// The docs-truth pin (auto-core plans/0227, 0166 step 067): this package's
// surfaces that name the code — README, MANUAL, AGENTS.md and the CLI's own
// comment/refusal/help strings — hold the truth the code rules, restated from
// 0125/0126/0151/0191/0211 D3/0081 D11 and the 18-command table, each
// verified against HEAD before the ruling worded them (0165-086, 0165-213,
// 0165-215, 0165-216, 0165-217, 0165-064's CLI halves). The 0221/0225/0226
// docs-pin pattern: if any of these rows silently reverts to the drift the
// review measured, this pin goes red rather than the operator guide or the
// CLI's own teaching outrunning the code again. Anchoring a needle means
// moving it in the same change as a sanctioned ruling, never to silence it.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { formatSwitches, parseSwitches, RETIRED_SWITCHES, SWITCH_ENV } from "@opencode-ai/auto-core/switches"

const readme = readFileSync(join(import.meta.dir, "..", "README.md"), "utf8")
const manual = readFileSync(join(import.meta.dir, "..", "MANUAL.md"), "utf8")
const agents = readFileSync(join(import.meta.dir, "..", "AGENTS.md"), "utf8")
const index = readFileSync(join(import.meta.dir, "..", "src", "index.ts"), "utf8")

// The corrected rows and teaching lines (0227 D2/D3): [name, doc, needle].
const TRUTH_PINS: [name: string, doc: string, needle: string][] = [
  // The parallel contract (0125/0126 — width alone activates; doc lanes at
  // tier 0; a level adds code depth and the conflict posture).
  ["README parallel config row", readme, "documentation-scoped tasks run side by side as their declarations allow with no level at all"],
  ["README --max-sessions row", readme, "concurrent execution is active by width alone (auto-core plans/0125)"],
  ["README treeLanes config row", readme, "doc lanes side by side plus serial code task sessions"],
  ["README section intro", readme, "width alone activates concurrent execution, auto-core plans/0125"],
  ["README tier-0 bullet", readme, "as **doc lanes** in the main tree (auto-core plans/0099"],
  ["README lane branch grammar", readme, "auto-lane/<task-id>-<digest>` (the digest is the first 8 hex of the target"],
  // The repair boundary (0211 D3 — no lane in flight, never serial-only).
  ["README --repair row", readme, "Not serial-only (auto-core plans/0211 D3): repair rounds open wherever the FAIL or held gate is judged with no lane in flight"],
  ["CLI --repair help", index, "with no lane in flight (the serial path, the lane loops' post-drain degrades, the doc loop's finishBlocked"],
  ["CLI --tree-lanes help", index, "documentation-scoped task sessions run side by side as doc lanes"],
  // The human surface at width (0068 D11 — no /exit channel; step mode a pause).
  ["README human-surface bullet", readme, "There is no `/exit` channel at width"],
  // Reset's true boundary (the bundle and the brief survive the whitelist).
  ["README reset prose", readme, "The removal is exact\nfor the whitelist, not the whole uninitialized worktree"],
  ["README reset table brief row", readme, "**Kept unconditionally** — an installed approved proposal"],
  ["README reset preserves sentence", readme, "Reclaiming only empty directories also preserves three things"],
  ["CLI reset summary", index, "(the project brief and a materialized intent bundle's landed files are kept)"],
  ["CLI reset completion line", index, "✓ config layer removed (docs/, .auto/ runtime state and tmp/ untouched"],
  ["MANUAL reset row", manual, "the project brief and a materialized bundle's landed files are kept"],
  // The retirement pointer (the continue notice names transfer).
  ["README retirement row", readme, "(pointing at `transfer` — it runs the round-close checks and opens the next round)"],
  // The 18-command enumerations and the brief's channels.
  ["AGENTS.md command list", agents, "land/fork/remove-fork/fix/sync/release/reset/status/models/install-prompts/driver-helper subcommands"],
  ["AGENTS.md amend brief channels", agents, "plus the project brief's manual revision (`--brief`/`--brief-file`, plans/0081 D11's channel"],
  ["MANUAL fork row", manual, "| `fork <T-NNN \\| sha> <worktree-path> [dir]` |"],
  ["MANUAL remove-fork row", manual, "| `remove-fork <worktree-path> [dir] [--force]` |"],
  ["MANUAL driver-helper row", manual, "| `driver-helper [dir]` |"],
  ["CLI eighteen comment", index, "the public eighteen plus `_lane`"],
  ["CLI -f refusal owner set", index, "-f/--force is an init/reset/fix/sync option"],
]

// The retired wordings: the drift the findings measured. Their return is the
// surface drifting behind the code again, caught directly.
const RETIRED: [name: string, doc: string, needle: string][] = [
  // 0165-086: the pre-0125 parallel contract.
  ["README's no-level usage error (config row)", readme, "usage error pointing at `init --parallel`"],
  ["README's no-level usage error (run row)", readme, "without a level it is a usage error (exit code 1)"],
  ["README's serial-only repair", readme, "Serial runs only (no effect under `--max-sessions ≥ 2` or `plan`)"],
  ["README's digest-less lane branch", readme, "auto-lane/<task-id>` — driven"],
  ["README's /exit scheduling stop", readme, "/exit` and step mode stop"],
  ["CLI's serial-only repair tail", index, "serial runs only, never persisted"],
  ["CLI's serial-only tree-lanes tail", index, "task sessions run serially in the main tree while"],
  // 0165-213: the stale count and the incomplete owner set.
  ["CLI's public sixteen", index, "the public sixteen"],
  // 0165-215 / 0165-064: the retired brief rules.
  ["README's stub-identical brief deletion", readme, "byte-identical to the project brief stub"],
  ["CLI's brief stub", index, "the brief stub"],
  ["AGENTS.md's brief stub", agents, "the brief stub"],
  // 0165-216: the stale retirement pointer.
  ["README's continue-notice pointer", readme, "(pointing at `plan`)"],
]

describe("docs truth (0227)", () => {
  test("the corrected surfaces carry their truth needles", () => {
    for (const [name, doc, needle] of TRUTH_PINS) {
      expect(doc.includes(needle), `${name}: ${needle}`).toBe(true)
    }
  })

  test("the retired wordings are gone", () => {
    for (const [name, doc, needle] of RETIRED) {
      expect(doc.includes(needle), `${name}: ${needle}`).toBe(false)
    }
  })

  test("the pin tables themselves are non-empty and named", () => {
    expect(TRUTH_PINS.length).toBe(24)
    expect(RETIRED.length).toBe(12)
  })
})

// The switch census (auto-core plans/0229 D2, finding 0165-200/S17-09): the
// README's switch table is the complete person-facing reference over the
// core's frozen OPENCODE_AUTO_* layer, and it is a pinned mirror of the
// registry — never a second source. Every expectation below is derived from
// the registry at run time (the declared subpath seam; the core never knows
// this package), so a switch that lands in the registry without its README
// row, a row the registry does not own, or a default that moves in code
// without the table all go red here rather than the reference silently
// outrunning the code — the census shape of agent-env.test.ts's prefix
// check, applied to the person-facing table.

// The README's switch section (from its heading to the next `## ` heading).
const SWITCH_SECTION_START = "### Experiment switches (`OPENCODE_AUTO_*`)"
const switchSection = (() => {
  const at = readme.indexOf(SWITCH_SECTION_START)
  if (at < 0) return ""
  const rest = readme.slice(at)
  const next = rest.indexOf("\n## ")
  return next < 0 ? rest : rest.slice(0, next)
})()

// The registry's own names: the parsed switches (everything SWITCH_ENV owns
// except the two env-only non-switches) and the retired tombstones.
const parsedSwitches = Object.values(SWITCH_ENV).filter((name) => name !== SWITCH_ENV.models && name !== SWITCH_ENV.server)
const retiredSwitches = Object.keys(RETIRED_SWITCHES)

// Names the section may state that the driver never parses: the two env-only
// registrations and opencode's own two flags (the X1 scrub passes them
// through; src/agent/env.ts's AGENT_FLAGS).
const NON_DRIVER_NAMES = [SWITCH_ENV.models, SWITCH_ENV.server, "OPENCODE_AUTO_SHARE", "OPENCODE_AUTO_HEAP_SNAPSHOT"]

// The registry's defaults as one name→value map — formatSwitches renders
// every parsed switch's default in `NAME=value` form over an empty
// environment; the empty render is the table's "unset".
const defaultOf = new Map(
  formatSwitches(parseSwitches({}))
    .split(", ")
    .map((item) => {
      const eq = item.indexOf("=")
      const value = item.slice(eq + 1)
      return [item.slice(0, eq), value === "" ? "unset" : value]
    }),
)

describe("the switch census (0229)", () => {
  test("the section exists", () => {
    expect(switchSection).not.toBe("")
    expect(switchSection.length).toBeGreaterThan(0)
  })

  test("every parsed switch has its row", () => {
    for (const name of parsedSwitches) {
      expect(switchSection.includes(name), name).toBe(true)
    }
  })

  test("every retired tombstone is stated", () => {
    for (const name of retiredSwitches) {
      expect(switchSection.includes(name), name).toBe(true)
    }
  })

  test("no dead rows: every OPENCODE_AUTO_* token in the section is parsed, retired or a stated non-driver name", () => {
    const owned = new Set([...parsedSwitches, ...retiredSwitches, ...NON_DRIVER_NAMES])
    const tokens = new Set(switchSection.match(/OPENCODE_AUTO_[A-Z_]+/g) ?? [])
    expect(tokens.size).toBeGreaterThan(0)
    for (const token of tokens) {
      expect(owned.has(token), token).toBe(true)
    }
  })

  test("every default the table states is the registry's own render", () => {
    for (const name of parsedSwitches) {
      const expected = defaultOf.get(name)!
      // The table row: `| `NAME` | default | …` — the default cell between
      // the variable cell and the next pipe.
      const row = switchSection.split("\n").find((line) => line.includes(`\`${name}\``) && line.startsWith("|"))
      const stated = row?.split("|")[2]?.trim()
      expect(stated, `${name}: no table row`).toBeDefined()
      expect(stated!, `${name}: stated ${stated}, registry ${expected}`).toBe(expected)
    }
  })

  test("the registry and the census agree on the counts", () => {
    expect(parsedSwitches.length).toBe(24)
    expect(retiredSwitches.length).toBe(4)
  })
})

// The key-ring walk paragraph (plans/0239 D6, finding 0165-218): 0178's
// code truth — the earlier-keys-only bound (D1), the consumed-fork skip
// (D2), the doc-lane deferral (D3) — reached the code in step 018 but the
// README paragraph kept asserting the invariant 0178's own measurement
// refuted ("The walk never oscillates", with a reason that was never true:
// the fork did walk, and under a short stated reset the walk undid the
// rotation — 80 restarts over 40 failures). These pins hold the paragraph
// to the code's three gates so it cannot outrun the code silently again.
describe("the key-ring walk paragraph (0239)", () => {
  const keyRingSection = (() => {
    const at = readme.indexOf("### Key ring")
    if (at < 0) return ""
    const rest = readme.slice(at)
    const next = rest.indexOf("\n### ")
    return next < 0 ? rest : rest.slice(0, next)
  })()

  test("the section exists", () => {
    expect(keyRingSection).not.toBe("")
  })

  test("the refuted invariant and its false reason are gone", () => {
    expect(keyRingSection).not.toContain("never oscillates")
    expect(keyRingSection).not.toContain("rides the held key it landed on")
  })

  test("the three gates the code has are stated (0178 D1/D2/D3)", () => {
    expect(keyRingSection).toContain("only ever moves to an *earlier* key")
    expect(keyRingSection).toContain("a consumed fork skips it")
    expect(keyRingSection).toContain("a doc-lane session defers it whole")
  })
})

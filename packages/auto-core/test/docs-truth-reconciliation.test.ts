// The docs-truth reconciliation pin (plans/0227, 0166 step 067): the surfaces
// that name the code — shell-contract's boundary tables, the glossary's
// package section, reset's boundary header — hold the truth the code rules,
// verified against HEAD before the ruling worded them (0165-064, 0165-207,
// the 0226 handoff row). The 0221/0225/0226 docs-pin pattern: if any of
// these rows silently reverts to the drift the review measured, this pin
// goes red rather than the onboarding contract or the boundary claim
// outrunning the code again. Anchoring a needle means moving it in the same
// change as a sanctioned ruling, never to silence it.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const shellContract = readFileSync(join(import.meta.dir, "..", "docs", "shell-contract.md"), "utf8")
const glossary = readFileSync(join(import.meta.dir, "..", "docs", "glossary.md"), "utf8")
const reset = readFileSync(join(import.meta.dir, "..", "src", "reset.ts"), "utf8")

// The corrected enumerations and boundary statements (0227 D2/D3): [name,
// needle from the surface].
const TRUTH_PINS: [name: string, doc: string, needle: string][] = [
  // §A's core row: the mechanism list without the phantom `server` (every
  // remaining name is a real src module, verified at HEAD).
  ["§A mechanism list", shellContract, "brief/mode/prompt/template/knowledge/interactive/log/shell)"],
  // §A's auto row: the 18 public subcommands in COMMANDS table order.
  ["§A auto row 18 commands", shellContract, "init/run/plan/transfer/clarify/close/land/fork/remove-fork/amend/fix/sync/release/reset/status/models/install-prompts/driver-helper subcommands"],
  // §C's export sentence: CONTRACT_FILE is the renderer's module-internal
  // constant (config-fix.ts's `const CONTRACT_FILE`), never an export.
  ["§C CONTRACT_FILE truth", shellContract, "(`CONTRACT_FILE` is its module-internal constant there, not an export)"],
  // The glossary's package section: the service-shell row beside the
  // general/simple shells (0226's handoff — the daemon/service vocabulary's
  // package home).
  ["glossary service shell", glossary, "| 服务壳 | service shell | `packages/auto-server`, bin `opencode-auto-server`"],
  // reset's header: the boundary statement — the bundle's landed files are
  // person-owned and survive the whitelist.
  ["reset bundle boundary", reset, "Person-owned once landed — delete them by hand if you mean to."],
  ["reset whitelist claim", reset, "removes the config-layer artifacts init wrote"],
]

// The retired wordings: the drift the findings measured. Their return is the
// surface drifting behind the code again, caught directly.
const RETIRED: [name: string, doc: string, needle: string][] = [
  // 0165-064: the phantom core module in §A's mechanism list.
  ["§A's phantom `server` module", shellContract, "brief/server/mode"],
  // 0165-207: the overclaim that a materialized bundle survives.
  ["reset's uninitialized-state claim", reset, "restoring the worktree to the uninitialized state"],
]

describe("docs-truth reconciliation (0227)", () => {
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
    expect(TRUTH_PINS.length).toBe(6)
    expect(RETIRED.length).toBe(2)
  })
})

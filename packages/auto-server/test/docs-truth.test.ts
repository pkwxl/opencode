// The docs-truth pin (auto-core plans/0227, 0166 step 067): this package's
// surfaces that name the code — daemon.md's honestly-absent list and ops.ts's
// status-vocabulary comment — hold the truth the served surface rules
// (0165-221's live half, 0165-222; the finding's other two comments were
// verified healed at HEAD and recorded in the ruling, D4). The 0221/0225/
// 0226 docs-pin pattern: if either surface silently reverts to the drift the
// review measured, this pin goes red rather than the shell's boundary
// description outrunning what it serves again. Anchoring a needle means
// moving it in the same change as a sanctioned ruling, never to silence it.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const daemon = readFileSync(join(import.meta.dir, "..", "docs", "daemon.md"), "utf8")
const ops = readFileSync(join(import.meta.dir, "..", "src", "ops.ts"), "utf8")

// The corrected surfaces (0227 D2/D4): [name, doc, needle].
const TRUTH_PINS: [name: string, doc: string, needle: string][] = [
  // The honestly-absent list names release and install-prompts beside the
  // five standing rows (the section's own standard: stated once and plainly).
  ["daemon.md release row", daemon, "`release` (the person's release gate"],
  ["daemon.md install-prompts row", daemon, "`install-prompts` (the manual-driver prompt suite's resync"],
  // ops.ts's 501 parenthetical without the probe clause (the probe has been
  // served since P4b — the module's own header and daemon.md's 501 row say
  // so).
  ["ops.ts 501 parenthetical", ops, "501 a route this version refuses (agent planning needs\n// the interactive transport of P3)."],
]

// The retired wordings: the drift the findings measured. Their return is the
// surface drifting behind the served surface again, caught directly.
const RETIRED: [name: string, doc: string, needle: string][] = [
  ["ops.ts's probe-not-exposed clause", ops, "the models probe is not exposed"],
]

describe("server docs truth (0227)", () => {
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
    expect(TRUTH_PINS.length).toBe(3)
    expect(RETIRED.length).toBe(1)
  })
})

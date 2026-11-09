// The due-cut reconciliation pin (plans/0230, 0166 step 070) — re-anchored at
// the v0.4.0 cut (2026-11-09), the sanctioned act the pin's own law names:
// anchoring a needle means moving it in the same change as a sanctioned
// ruling, never to silence it. The v0.4.0 cut consumed the prepared state
// this pin held (the due-cut section's census, the register's five rows, the
// prepared-not-cut boundary) into the v0.4.0 release section — the register
// cleared, the 0230 section's standing body retired to its consumed note,
// the census superseded by the cut-moment re-measurement, the tag decision
// resolved by the cut's tag acts. This pin now holds the consumed state: if
// the v0.4.0 section's record of its own cut silently reverts — the register
// rows reappearing without a new sanctioned edit, the consumed note losing
// its consumption, the census or tag sentences drifting — the pin goes red
// rather than the cut's record going unrecorded. The register table returns
// only with a new mid-cycle edit, whose row this pin does not hold (each
// future row lands with its own ruling).
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const releases = readFileSync(join(import.meta.dir, "..", "docs", "releases.md"), "utf8")

// The consumed sentences: [name, needle]. Each needle is a distinctive phrase
// of the v0.4.0 cut's own record (the section, the cleared register, the
// consumed 0230 section), fail-red against the pre-cut document (the state
// the previous anchoring held — proven by this cut's swap of the prepared
// state back in).
const PINS: [name: string, needle: string][] = [
  // The v0.4.0 section and its census
  ["section heading", "## v0.4.0 — 2026-11-09 — the three-package review and its remediation program"],
  ["census at the cut", "One hundred fifteen rulings since v0.3.0 ship together"],
  ["census measurement", "115 open rows at the pre-cut HEAD `f82a06dd5`"],
  // The register consumed and cleared
  ["register cleared", "The register stands empty — its five rows (0146, 0166 step 006, 0221, 0225, 0226) were consumed into the v0.4.0 release section's principle deltas at the v0.4.0 cut (2026-11-09)"],
  // The 0230 section consumed
  ["0230 consumed", "**consumed at the v0.4.0 cut (2026-11-09)**"],
  ["0230 superseded census", "Its census (105 open rows at the preparing HEAD `6f2cf849c`) was superseded by the cut-moment re-measurement recorded in the v0.4.0 section below"],
  // The audits the cut owes and records
  ["replay passed", "**Falsification replay — passed.** Run at the cut (2026-11-09) under the stated method"],
  ["family check lapse recorded", "22 requirement-bearing rulings (0142–0161, 0163, 0164) originally carried no Category scope section"],
  // The tag decision resolved
  ["tag rows closed", "the v0.3.0 git tag created at its recorded anchor `07036c2b5`"],
  ["v0.4.0 tag at this commit", "the v0.4.0 tag at this commit"],
  // The determination, said in words
  ["pre-1.0 determination", "carried by this minor release said so in words"],
]

// The retired prepared-state sentences: each must be ABSENT — the cut's
// consumption retired them (their return without a new sanctioned edit is
// the silent revert this pin exists to catch).
const RETIRED: [name: string, needle: string][] = [
  ["the register's dated rows", "| 2026-11-08 | 0221"],
  ["the register's first row", "| 2026-10-28 | 0146"],
  ["the prepared-not-cut boundary", "the register not cleared, no release section written"],
  ["the prepared census as standing law", "105 rulings open against the next release"],
]

describe("the v0.4.0 cut's consumed reconciliation (0230, consumed 2026-11-09)", () => {
  test("every consumed sentence stands where the cut put it", () => {
    for (const [name, needle] of PINS) {
      expect(releases.includes(needle), `${name}: ${needle}`).toBe(true)
    }
  })

  test("the prepared state stays consumed, never silently reverted", () => {
    for (const [name, needle] of RETIRED) {
      expect(releases.includes(needle), `${name} (must stay retired): ${needle}`).toBe(false)
    }
  })

  test("the sections hold their standing positions", () => {
    // The consumed 0230 note stays between the per-release audit duty and
    // the `---` spine (standing material's position, now a consumed marker).
    const auditDuty = releases.indexOf("## The per-release audit duty")
    const reconciliation = releases.indexOf("## The due-cut reconciliation")
    const spine = releases.indexOf("\n---\n")
    expect(reconciliation).toBeGreaterThan(auditDuty)
    expect(reconciliation).toBeLessThan(spine)
    // The v0.4.0 section is the last release section, after v0.3.0's.
    const v030 = releases.indexOf("## v0.3.0 —")
    const v040 = releases.indexOf("## v0.4.0 —")
    expect(v040).toBeGreaterThan(v030)
    expect(v040).toBeGreaterThan(spine)
    // The cleared register sits between its law and the audit duty.
    const registerLaw = releases.indexOf("## The mid-cycle amendment register")
    const cleared = releases.indexOf("The register stands empty")
    expect(cleared).toBeGreaterThan(registerLaw)
    expect(cleared).toBeLessThan(auditDuty)
  })
})

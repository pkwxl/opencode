// The due-cut reconciliation pin (plans/0230, 0166 step 070): the release
// record's standing material between cuts — the fired trigger's owed
// statement (the dated census, the programs, the W1/W6 gate, the tag
// decision, the not-cut boundary), the mid-cycle amendment register
// completed against the constitution-edit census (0221's retroactive row)
// and restated as the principle-delta draft, and the assessment material
// step 081 consumes (0165-070/F14, S02-06: a trigger fired with no
// reconciliation). The 0221 docs-pin pattern (the 0225/0226/0227 lineage):
// if the section silently reverts, the register loses its retroactive row,
// or the census sentence drifts from the dated snapshot it records, this
// pin goes red rather than the due state going unrecorded again. The census
// is pinned as the dated snapshot it is, never a live oracle — a live count
// against INDEX would go red at every later step's INDEX row, falsifying a
// record that is already true. Anchoring a needle means moving it in the
// same change as a sanctioned ruling, never to silence it.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const releases = readFileSync(join(import.meta.dir, "..", "docs", "releases.md"), "utf8")

// The reconciled sentences: [name, needle]. Each needle is a distinctive
// phrase of a 0230 decision (D1 the section, D2 the register, D3 the
// assessment material), fail-red against the pre-0230 document (proven at
// the step's landing).
const PINS: [name: string, needle: string][] = [
  // D1 — the section, its census and its boundary
  ["section heading", "## The due-cut reconciliation (0230, prepared not cut)"],
  ["census count", "105 rulings open against the next release"],
  ["census span", "rows spanning 0125–0229"],
  ["census snapshot law", "A dated snapshot, never a live count"],
  ["the programs", "the 0155–0160 ruled program completed 2026-10-30 (the trigger's first firing)"],
  ["W1/W6 gate", '"should not ship before W1 and W6 land"'],
  ["gate re-check", "step 081 re-checks the gate at its own moment"],
  ["tag riding the cut", "the maintainer tags `07036c2b5` as v0.3.0, or the tag rides the next explicitly instructed cut alongside it"],
  ["not-cut boundary", "preparation, never the cut — the version spine unmoved, the principles.md stamp unchanged, the register not cleared, no release section written"],
  // D2 — the register completed and restated as the draft
  ["register 0221 retroactive row", "| 2026-11-08 | 0221 (`be3daccb1`)"],
  ["register 0221 retroactive name", "added retroactively by 0230 (the edit pre-dated this register, 0146's precedent)"],
  ["register restated, five rows", "the mid-cycle amendment register above carries five rows — 0146, 0166 step 006, 0221, 0225, 0226"],
  ["principle-delta draft", "the principle-delta draft the next release section absorbs at the cut"],
  ["consumption prepared, never enacted", "The consumption is prepared here, never enacted"],
  // D3 — the audits the cut owes (step 081's draft input)
  ["traceability both directions", "the traceability chain both directions (rule→principle: orphans and gaps; principle→code: divergences)"],
  ["replay under the stated method", "the falsification replay under 0225 D7's stated method"],
  ["family check, S02-01's lapse recorded", "22 requirement-bearing rulings — 0142–0161, 0163, 0164 — carry no Category scope section"],
  ["step 081 the consuming step", "step 081 (release-assessment) hands the material over"],
]

describe("the due-cut reconciliation (0230, 0166 step 070)", () => {
  test("every reconciled sentence stands where its ruling put it", () => {
    for (const [name, needle] of PINS) {
      expect(releases.includes(needle), `${name}: ${needle}`).toBe(true)
    }
  })

  test("the section and the retroactive row hold their standing positions", () => {
    // D1's placement: standing material between cuts — after the per-release
    // audit duty, before the `---` spine.
    const auditDuty = releases.indexOf("## The per-release audit duty")
    const reconciliation = releases.indexOf("## The due-cut reconciliation")
    const spine = releases.indexOf("\n---\n")
    expect(reconciliation).toBeGreaterThan(auditDuty)
    expect(reconciliation).toBeLessThan(spine)
    // D2's placement: the retroactive row in the register's date order,
    // between step 006's row and 0225's.
    const step006 = releases.indexOf("| 2026-11-05 | 0166 step 006")
    const row0221 = releases.indexOf("| 2026-11-08 | 0221")
    const row0225 = releases.indexOf("| 2026-11-09 | 0225")
    expect(row0221).toBeGreaterThan(step006)
    expect(row0221).toBeLessThan(row0225)
  })
})

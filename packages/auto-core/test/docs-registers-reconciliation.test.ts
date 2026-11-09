// The glossary/registers reconciliation pin (plans/0226, 0166 step 066): the
// two documentation registers — docs/glossary.md's one-concept-one-term map
// and docs/principles.md's trade-off/risk tables — reconciled with the
// vocabulary and rulings they serve. The 0165 review measured both stale
// (S02-07: a dozen terms with no glossary entry; S02-08: the registers'
// "last showed" cells behind the corpus, T8 unannotated, two candidate
// trade-off rows unrecorded). The 0221/0225 docs-pin pattern: if any of these
// rows or cells silently reverts or drifts from its ruling, this pin goes red
// rather than the register outrunning the corpus again. Anchoring a needle
// means moving it in the same change as a sanctioned ruling, never to
// silence it.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const glossary = readFileSync(join(import.meta.dir, "..", "docs", "glossary.md"), "utf8")
const principles = readFileSync(join(import.meta.dir, "..", "docs", "principles.md"), "utf8")
const releases = readFileSync(join(import.meta.dir, "..", "docs", "releases.md"), "utf8")

// The glossary's twelve measured terms (S02-07's list; "launcher /
// confinement" is two concepts, two rows): [term, needle from its row].
const GLOSSARY_PINS: [name: string, needle: string][] = [
  ["key hold", "UNSTATED_KEY_HOLD_MS"],
  ["new-session walk", "(`RingWalk`, `src/keyring.ts`, plans/0163 D2)"],
  ["sealed reference wall", "closed predicate re-derived from disk and git at every boundary"],
  ["knowledge boundary", "an `edit` deny in every form the live tools ask, 0188 D3"],
  ["lane worker launcher", "the self-invocation derived per process shape"],
  ["confinement launcher", "the one lawful env route to a run"],
  ["adoption", "readable drift alone (plans/0145; 0183 D3's bound)"],
  ["info class", "an expected posture with nothing to repair — a note, exit 0"],
  ["tree lanes", "sparse CoW worktrees materialized over the unit's `Touches`"],
  ["regression lane", "The complete tier of the two-level pass"],
  ["clarify", "byte-identical to a correct hand edit plus its commit"],
  ["driver-helper", "the brief a coding-agent session holding the person's pen needs"],
  ["width", "documentation waves run at the width out of the box"],
]

// The refreshed registers (S02-08): the three risk cells, T8's extension, the
// two new trade-off rows, and the mid-cycle register row the principles.md
// edit owes 0225 D6's rule.
const REGISTER_PINS: [name: string, doc: string, needle: string][] = [
  ["R2 last showed", principles, "re-shown 0198→0201"],
  ["R4 last showed", principles, "0146's threshold import into P2's Tier I line (retired by 0225 D4)"],
  ["R7 last showed", principles, "41 rulings (0124–0164) unreleased in 9 days"],
  ["T8 key hold clause", principles, "an unstated key failure holds five minutes, never a long driver-invented park"],
  ["T8 ruled cell", principles, "0163 D1; 0219 D2 (eligible-with-wait)"],
  ["T10 tension", principles, "the lock's writer gate vs the read-only channel's reach"],
  ["T10 reopen floor", principles, "fact is this row's floor"],
  ["T11 tension", principles, "the driver-exclusive commit right vs the person's own commits in an interrupted unit's range"],
  ["T11 choice", principles, "adopted as readable drift, the close-out re-anchoring at the current HEAD"],
  // Re-anchored at the v0.4.0 cut (2026-11-09): the register's 0226 row was
  // consumed into that release section's principle deltas per 0225 D6's own
  // rule — the needle now holds the row's consumed home there (the pin's
  // law's sanctioned move; the register row itself stands in git history).
  ["mid-cycle register row, consumed into v0.4.0", releases, "**0226 (reconciliation, 2026-11-09)** — the trade-off/risk registers refreshed to the corpus"],
]

// The retired wordings: the stale cells the finding measured. Their return is
// the register drifting behind the corpus again, caught directly.
const RETIRED: [name: string, doc: string, needle: string][] = [
  ["R2's pre-0161 cell", principles, "deliberate (T1's row) | 0103 |"],
  ["R4's pre-review cell", principles, "the 0110 diagnosis (the corpus's 108 documents, no index)"],
  ["R7's pre-review cell", principles, "plans stay retired-once-obsolete | the 0110 diagnosis |"],
  ["T8's pre-0163 ruled cell", principles, "hints before halts | 0015/0016, 0057 |"],
  ["the two-class finding row", glossary, "The two classes of a config-fix finding"],
]

describe("the glossary/registers reconciliation (0226, 0166 step 066)", () => {
  test("every measured term has its glossary row", () => {
    for (const [name, needle] of GLOSSARY_PINS) {
      expect(glossary.includes(needle), `${name}: ${needle}`).toBe(true)
    }
  })

  test("the refreshed register cells stand where their rulings put them", () => {
    for (const [name, doc, needle] of REGISTER_PINS) {
      expect(doc.includes(needle), `${name}: ${needle}`).toBe(true)
    }
  })

  test("the stale cells stay retired", () => {
    for (const [name, doc, needle] of RETIRED) {
      expect(doc.includes(needle), `${name}: ${needle}`).toBe(false)
    }
  })
})

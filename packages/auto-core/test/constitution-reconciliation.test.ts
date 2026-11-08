// The constitution/releases reconciliation pin (plans/0225, 0166 step 065):
// the ruling surface docs/principles.md + docs/releases.md (and AGENTS.md's
// one lockstep clause) reconciled with the rulings they record — P4's
// adoption (0145, the re-anchor that keeps the close-out range pure), P8's
// recorded-state (info) class (0135/0136), the practiced two-track
// deprecation lifecycle (0137, 0150 D2, 0052 D3/D4, 0053 §10 B4), P2's line
// current to 0198 without the threshold, the five definitional sentences
// (0129, 0068/0099, 0140/0150, 0143, the tier test), the mid-cycle amendment
// register (0165-069's silence never recurring), and the replay method
// (never inside the repository). The 0221 docs-pin pattern (itself the 0216
// D3 single-owner shape): each finding this step fixed was a blind reader
// concluding the wrong thing from the constitution alone — if any of these
// texts silently reverts or drifts from its ruling, this pin goes red rather
// than the letter outrunning the rulings again. Anchoring a probe means
// moving it in the same change as a sanctioned ruling, never to silence it.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const principles = readFileSync(join(import.meta.dir, "..", "docs", "principles.md"), "utf8")
const releases = readFileSync(join(import.meta.dir, "..", "docs", "releases.md"), "utf8")
const agents = readFileSync(join(import.meta.dir, "..", "AGENTS.md"), "utf8")

// The reconciled texts: [doc, needle, what the pin holds]. Each needle is a
// distinctive phrase of a 0225 decision (D1–D8), fail-red against the
// pre-0225 documents (proven at the step's landing).
const PINS: [name: string, doc: string, needle: string][] = [
  // D1 — P4's derivations reconciled with 0145 (0165-007/F18)
  ["P4 adoption", principles, "a resume that finds the person's commits in an interrupted unit's range adopts them — readable drift alone"],
  ["P4 re-anchor", principles, "the person's commits sitting before the close-out range"],
  ["P4 0076 restated", principles, "they never stop or roll back a run"],
  // D2 — P8's recorded-state (info) class (0165-071/F19)
  ["P8 statement note", principles, "informational notes — detection that needs no person act is a note, never a finding"],
  ["P8 info derivation", principles, "The recorded-state (info) class"],
  ["P8 default note", principles, "a note (the recorded-state class), never a finding"],
  // D3 — the two-track deprecation lifecycle (0165-068/F11)
  ["P13 two-track", principles, "a vocabulary's tombstone is its permanent teaching refusal (0225's two-track rule)"],
  ["releases vocabulary track", releases, "the tombstone is the retirement"],
  ["releases behavior track", releases, "with no surface left to refuse"],
  // D4 — P2's line rephrased, current to 0198 (0165-069/F12)
  ["P2 progress wording", principles, "blocking only when the gap count stops improving, 0146 amending 0083 D5, 0198 the best-count key"],
  // D5 — the five definitional sentences (0165-182/F20)
  ["lock scope", principles, "the retry fork takes no lock, loud on collision"],
  ["shared git state", principles, '"Shared git state" names the repository\'s administrative surfaces'],
  ["task-id uniqueness", principles, "Task ids never repeat within one corpus"],
  ["safe boundary", principles, "A safe boundary is a committed, resumable stopping point"],
  ["tier precedence", principles, "Tier I governs: a Tier II default bends to a Tier I principle"],
  // D6 — the mid-cycle amendment register (0165-069/F12)
  ["principles register pointer", principles, "mid-cycle amendment register"],
  ["releases register section", releases, "## The mid-cycle amendment register (0225)"],
  ["register 0146 retroactive row", releases, "this row is the retroactive record"],
  ["register 0225 row", releases, "| 2026-11-09 | 0225 |"],
  // D7 — the replay method (0165-183/F21)
  ["replay method", releases, "the replay never runs inside the repository"],
  // D8 — the derivation wording aligned to the corpus's form (0165-181/F17)
  ["how-to-rule consolidated form", principles, "one consolidated Derives/Derivation paragraph covering every decision block is the corpus's settled form"],
  ["agents consolidated form", agents, "one consolidated Derives paragraph covering every decision block is the corpus's settled form (0225)"],
]

// The retired wordings: each was the defect's own text (the half-sentence the
// blind replay leaned on, the misreadable threshold phrase, the never-run
// single-track lifecycle). Their return is a regression of the reconciliation
// itself, caught directly.
const RETIRED: [name: string, doc: string, needle: string][] = [
  ["P4's bare audit threat (0076's old tail)", principles, "it breaks the SHA-baseline audit"],
  ["P2's misreadable threshold phrase", principles, "two consecutive no-gap rounds block"],
  ["the single-track lifecycle bullet", releases, "tombstone → one release of visible warning → removal in a named later release"],
]

describe("the constitution/releases reconciliation (0225, 0166 step 065)", () => {
  test("every reconciled text stands where its ruling put it", () => {
    for (const [name, doc, needle] of PINS) {
      expect(doc.includes(needle), `${name}: ${needle}`).toBe(true)
    }
  })

  test("the retired wordings stay retired", () => {
    for (const [name, doc, needle] of RETIRED) {
      expect(doc.includes(needle), `${name}: ${needle}`).toBe(false)
    }
  })
})

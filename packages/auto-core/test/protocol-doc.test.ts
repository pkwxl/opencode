// The protocol-doc ratchet, core arm (plans/0279's documentation ruling,
// enacted by 0280): docs/protocol.md is the protocol's standing single
// source — every future protocol change amends it in the same change — and
// this pin holds the doc's enumerated vocabularies against the code's
// constants, both directions, so the spec cannot drift from the
// implementation. The core half pins what the core owns: the wire version
// literal, the grant-kind vocabulary, the stage words, the tombstone
// record. The server half (auto-server/test/protocol-doc.test.ts) pins the
// routes, the scopes and the frame version. A vocabulary that grows in
// code without the doc, or in the doc without code, is red either way —
// the conscious lockstep P13 demands, made mechanical.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { EXECUTOR_PROTOCOL, executorTypeCatalog, SHARE_STAGE_WORDS, WORK_TYPE_IDS } from "../src/executor-coordinator"

const doc = readFileSync(join(import.meta.dir, "..", "docs", "protocol.md"), "utf8")

// The first ```protocol fenced block under a `## <heading>` section, its
// non-empty lines. The doc's vocabulary blocks are the machine-checked
// half of the spec; the prose around them is the human half.
function block(heading: string): string[] {
  const section = doc.split(/^## /m).find((part) => part.startsWith(`${heading}\n`))
  if (section === undefined) throw new Error(`docs/protocol.md carries no "## ${heading}" section`)
  const fenced = /```protocol\n([\s\S]*?)```/.exec(section)
  if (fenced === null) throw new Error(`the "## ${heading}" section carries no \`\`\`protocol block`)
  return fenced[1]!.split("\n").filter((line) => line.trim())
}

describe("protocol-doc ratchet (core, plans/0280)", () => {
  test("the doc's wire version equals the code's literal", () => {
    const [stated] = block("Wire version")
    expect(stated).toBe(`version: ${EXECUTOR_PROTOCOL}`)
    expect(EXECUTOR_PROTOCOL).toBe(0.1)
  })

  test("the doc's grant kinds equal WORK_TYPE_IDS and the catalog's work ids", () => {
    expect(block("Grant kinds")).toEqual([...WORK_TYPE_IDS])
    // The catalog renders exactly the same ids beside its two person
    // entries — one vocabulary, two renderings (P5).
    const catalog = executorTypeCatalog()
    expect(Object.keys(catalog)).toEqual([...WORK_TYPE_IDS])
  })

  test("the doc's stage words equal the coordinator's table", () => {
    expect(block("Share stage words")).toEqual([...SHARE_STAGE_WORDS])
  })

  test("the tombstone section names the retired pre-0280 version literal", () => {
    const entries = block("Tombstones")
    expect(entries.length).toBeGreaterThanOrEqual(1)
    expect(entries[0]).toContain("protocol: 1")
    expect(entries[0]).toContain("premature")
  })

  test("the spec names itself the single source and the ratchet its enforcement", () => {
    expect(doc).toContain("single, maintained specification")
    expect(doc).toContain("protocol-doc ratchet")
  })
})

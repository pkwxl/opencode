// The protocol-doc ratchet, server arm (plans/0279's documentation ruling,
// enacted by 0280): the spec lives in auto-core's docs/protocol.md — the
// single source — and this pin holds its route and scope enumerations
// against THIS package's constants (the routes the daemon serves, the
// scopes the store issues, the frame version the bridge speaks), both
// directions. The core arm (auto-core/test/protocol-doc.test.ts) pins the
// version literal, the grant kinds and the stage words. A route or scope
// that lands in code without the doc, or in the doc without code, is red
// either way.
import { describe, expect, test } from "bun:test"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { EXECUTOR_PROTOCOL } from "@opencode-ai/auto-core/executor-coordinator"
import { SCOPES } from "../src/store"
import { executorRoutes, PROTOCOL_VERSION } from "../src/ws-protocol"

// The spec's published doc, resolved by its package specifier (0196 D1: the
// specifier the only route from a shell — never a relative path) and read
// raw: Bun's markdown import attribute transforms cross-package, so the
// ratchet reads the file the specifier resolves to.
const require = createRequire(import.meta.url)
const doc = readFileSync(require.resolve("@opencode-ai/auto-core/docs/protocol.md"), "utf8")

function block(heading: string): string[] {
  const section = doc.split(/^## /m).find((part) => part.startsWith(`${heading}\n`))
  if (section === undefined) throw new Error(`docs/protocol.md carries no "## ${heading}" section`)
  const fenced = /```protocol\n([\s\S]*?)```/.exec(section)
  if (fenced === null) throw new Error(`the "## ${heading}" section carries no \`\`\`protocol block`)
  return fenced[1]!.split("\n").filter((line) => line.trim())
}

describe("protocol-doc ratchet (server, plans/0280)", () => {
  test("the doc's routes equal executorRoutes", () => {
    expect(block("Routes")).toEqual([...executorRoutes])
  })

  test("the doc's scopes equal SCOPES", () => {
    expect(block("Token scopes")).toEqual([...SCOPES])
  })

  test("the frame version and the envelope literal are one version", () => {
    // Two constants, one version: the WS frame stamp and the reply
    // envelope's protocol field carry the same preview literal, and the
    // doc states it once.
    expect(PROTOCOL_VERSION).toBe(EXECUTOR_PROTOCOL)
    expect(block("Wire version")[0]).toBe(`version: ${PROTOCOL_VERSION}`)
  })
})

// Direct unit coverage for src/format.ts (plans/0102 stage C, tests-11): the
// pure formatters over the agent plane's values were only exercised
// indirectly through session-api paths — and the namesake-but-different
// formatTokens in src/log.ts IS unit-tested (test/log.test.ts), easy to
// mistake for coverage that does not exist. No fixtures: real-shaped
// AgentPart values, assertions on the exact rendered lines the terminal and
// the audit log see.
import { describe, expect, test } from "bun:test"
import type { AgentPart } from "../src/agent/types"
import { describePart, formatClientError, formatTokens, isApproval } from "../src/format"

const part = (over: AgentPart): AgentPart => over

describe("describePart", () => {
  test("a final reasoning part renders trimmed text under the reasoning header; a growing one has nothing to output yet", () => {
    const final = part({ kind: "reasoning", id: "p1", text: "  thinking it through  ", final: true })
    expect(describePart(final)).toBe("  reasoning:\nthinking it through")
    const growing = part({ kind: "reasoning", id: "p2", text: "half a thought", final: false })
    expect(describePart(growing)).toBeUndefined()
  })

  test("tool parts: completed renders the tool's own title or the bare done fallback; error renders the error text; in-flight renders nothing", () => {
    const titled = part({ kind: "tool", id: "t1", tool: "read", status: "completed", output: "bytes", title: "read src/git.ts" })
    expect(describePart(titled)).toBe("  tool read: read src/git.ts")
    const untitled = part({ kind: "tool", id: "t2", tool: "bash", status: "completed", output: "" })
    expect(describePart(untitled)).toBe("  tool bash: done")
    const failed = part({ kind: "tool", id: "t3", tool: "bash", status: "error", error: "exit 3" })
    expect(describePart(failed)).toBe("  tool bash error: exit 3")
    const noErrorText = part({ kind: "tool", id: "t4", tool: "bash", status: "error" })
    expect(describePart(noErrorText)).toBe("  tool bash error: ")
    expect(describePart(part({ kind: "tool", id: "t5", tool: "edit", status: "running" }))).toBeUndefined()
    expect(describePart(part({ kind: "tool", id: "t6", tool: "edit", status: "pending" }))).toBeUndefined()
  })

  test("long tool error text truncates at the 2000-character cap; long final reasoning truncates the same way", () => {
    const longError = "x".repeat(2500)
    const rendered = describePart(part({ kind: "tool", id: "t7", tool: "bash", status: "error", error: longError }))
    expect(rendered).toBe(`  tool bash error: ${"x".repeat(2000)}`)
    const reasoning = describePart(part({ kind: "reasoning", id: "p3", text: "y".repeat(2500), final: true }))
    expect(reasoning).toBe(`  reasoning:\n${"y".repeat(2000)}`)
  })

  test("step boundaries: finish carries the reason with both token counts through formatTokens, start is the bare marker", () => {
    const finish = part({
      kind: "step-finish",
      id: "s1",
      reason: "stop",
      tokens: { input: 12_345, output: 9876, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      cost: 0,
    })
    expect(describePart(finish)).toBe("  step finish (stop): input 12.3k / output 9876 tokens")
    expect(describePart(part({ kind: "step-start", id: "s2" }))).toBe("  step start")
  })

  test("a note part renders its adapter-rendered one-liner; a text part renders nothing (prose is not terminal output)", () => {
    expect(describePart(part({ kind: "note", id: "n1", text: "patch applied" }))).toBe("  patch applied")
    expect(describePart(part({ kind: "text", id: "x1", text: "hello", final: true }))).toBeUndefined()
  })
})

describe("formatTokens", () => {
  test("counts below ten thousand render as-is; the threshold itself included", () => {
    expect(formatTokens(0)).toBe("0")
    expect(formatTokens(9999)).toBe("9999")
  })

  test("counts at or above ten thousand render in k with one decimal; the boundary rounds exactly", () => {
    expect(formatTokens(10_000)).toBe("10.0k")
    expect(formatTokens(12_345)).toBe("12.3k")
    expect(formatTokens(1_234_567)).toBe("1234.6k")
  })
})

describe("formatClientError", () => {
  test("an Error instance yields its message (so wording like a timeout reaches the blocked-problem text); anything else serializes", () => {
    expect(formatClientError(new Error("request timed out"))).toBe("request timed out")
    expect(formatClientError({ name: "APIError", message: "quota exceeded" })).toBe(`{"name":"APIError","message":"quota exceeded"}`)
    expect(formatClientError("plain text")).toBe(`"plain text"`)
  })
})

describe("isApproval", () => {
  test("every approval word in any case and padding counts; anything else does not", () => {
    for (const answer of ["allow", "YES", "  y  ", "OK", "Approve", "always"]) expect(isApproval(answer)).toBe(true)
    for (const answer of ["no", "never", "allowed", "", "a llow", "yessir"]) expect(isApproval(answer)).toBe(false)
  })
})

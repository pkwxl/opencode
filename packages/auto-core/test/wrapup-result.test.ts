// Task report result line (plans/0044 §3.1): the only completion-side verdict
// left after D13 retired verify/review/final-review.
import { describe, expect, test } from "bun:test"
import { parseResult } from "../src/wrapup"

describe("parseResult", () => {
  test("PASS and FAIL with a reason", () => {
    expect(parseResult("# report\n\nResult: PASS\n")).toEqual({ type: "pass" })
    expect(parseResult("Result: FAIL build breaks on arm64")).toEqual({ type: "fail", reason: "build breaks on arm64" })
  })

  test("separators after the verdict are not part of the reason", () => {
    expect(parseResult("Result: FAIL — tests red")).toEqual({ type: "fail", reason: "tests red" })
    expect(parseResult("Result: FAIL: tests red")).toEqual({ type: "fail", reason: "tests red" })
    expect(parseResult("Result: FAIL")).toEqual({ type: "fail", reason: "" })
  })

  test("the last Result: line decides", () => {
    expect(parseResult("Result: FAIL first attempt\n\nResult: PASS\n")).toEqual({ type: "pass" })
    expect(parseResult("Result: PASS\nResult: FAIL regression")).toEqual({ type: "fail", reason: "regression" })
  })

  test("indentation around the line is tolerated", () => {
    expect(parseResult("   Result: PASS   \n<!-- auto: eof -->\n")).toEqual({ type: "pass" })
  })

  test("no line, another value or a partial word is no verdict", () => {
    expect(parseResult("")).toBeUndefined()
    expect(parseResult("# report\n\nall good\n")).toBeUndefined()
    expect(parseResult("Result: PARTIAL")).toBeUndefined()
    expect(parseResult("Result: PASSED")).toBeUndefined()
    expect(parseResult("Result: FAIL-SAFE ok")).toBeUndefined()
    // A later non-verdict Result: line overrides an earlier verdict.
    expect(parseResult("Result: FAIL x\nResult: unknown")).toBeUndefined()
  })

  test("case-sensitive and decorated lines do not count", () => {
    expect(parseResult("result: FAIL x")).toBeUndefined()
    expect(parseResult("Result: fail x")).toBeUndefined()
    expect(parseResult("**Result: FAIL x**")).toBeUndefined()
    expect(parseResult("- Result: FAIL x")).toBeUndefined()
  })
})

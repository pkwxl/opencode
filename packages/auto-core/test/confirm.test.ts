import { describe, expect, test } from "bun:test"
import { PassThrough } from "node:stream"
import { confirm } from "../src/confirm"

// Injected io spares us a real TTY: only an explicit tty: true takes the Q&A branch.
async function ask(answer: string | undefined, tty = true): Promise<boolean> {
  const input = new PassThrough()
  const output = new PassThrough()
  output.resume()
  const pending = confirm("Continue? [y/N] ", { input, output, tty })
  if (answer === undefined) input.end()
  else input.end(`${answer}\n`)
  return pending
}

describe("confirm", () => {
  test("only y/yes (case-insensitive) is true", async () => {
    expect(await ask("y")).toBe(true)
    expect(await ask("Y")).toBe(true)
    expect(await ask("yes")).toBe(true)
    expect(await ask("YES")).toBe(true)
    expect(await ask("  y  ")).toBe(true)
  })

  test("an empty line and anything else is false (default: do not run)", async () => {
    expect(await ask("")).toBe(false)
    expect(await ask("n")).toBe(false)
    expect(await ask("no")).toBe(false)
    expect(await ask("yep")).toBe(false)
  })

  test("stdin closed (pipe end) falls back to false, so a destructive operation is not let through by a broken input", async () => {
    expect(await ask(undefined)).toBe(false)
  })

  test("non-TTY counts as pre-approved and passes through (input never read)", async () => {
    expect(await confirm("Continue? ", { tty: false })).toBe(true)
  })
})

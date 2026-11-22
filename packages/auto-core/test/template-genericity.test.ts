// The template genericity scan (plans/0239 D3, finding 0165-209): the files
// under templates/ are the materialization surfaces init stamps into every
// target directory, so a host-layout literal there (the review measured the
// since-removed permission template's `"/home/*": "allow"` bash grant,
// inherited from the pre-core 2026-08 template — the file itself left with
// plans/0296, the host's configuration never the tool's) is genericity debt
// in every new project. The scan is a shape rule over the shipped bytes — the
// home-directory path families a real host's layout leaks through (P16's
// enforcement example); the separately ruled path conventions are named below
// so the scan's exclusions are rulings, not gaps.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const templatesRoot = join(import.meta.dir, "..", "templates")

const templateFiles = ((): string[] => {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else out.push(path)
    }
  }
  walk(templatesRoot)
  return out
})()

// The home-directory families: absolute paths naming a user's home on the
// three shipped-OS shapes. Everything else (relative paths, /tmp, /opt,
// schema URLs) is allowed — /tmp is the separately ruled receipts
// convention (plans/0147's knowledge boundary keeps /tmp readable beside
// the default deny).
const HOME_FAMILIES = ["/home/", "/Users/", "/root/", "C:\\Users\\"]

describe("the template genericity scan (plans/0239 D3)", () => {
  test("the scan walks the shipped templates", () => {
    expect(templateFiles.length).toBeGreaterThan(30)
    // The host permission template is gone (plans/0296): nothing init or any
    // other command copies into a target directory any more.
    expect(templateFiles.some((path) => path.endsWith(join("opencode.json")))).toBe(false)
  })

  test("no shipped template carries a home-directory path literal", () => {
    for (const path of templateFiles) {
      const text = readFileSync(path, "utf8")
      for (const family of HOME_FAMILIES) {
        const at = text.indexOf(family)
        expect(at, `${path}: carries the home path family "${family}" (a host-layout literal in generic materialization — plans/0165 S24-06, retired by plans/0239 D3)`).toBe(-1)
      }
    }
  })
})

// The template genericity scan (plans/0239 D3, finding 0165-209): the files
// under templates/ are the materialization surfaces init stamps into every
// target directory, so a host-layout literal there (the review measured
// templates/opencode.json's since-removed `"/home/*": "allow"` bash grant,
// inherited from the pre-core 2026-08 template) is genericity debt in every
// new project. The scan is a shape rule over the shipped bytes — the
// home-directory path families a real host's layout leaks through
// (P16's enforcement example); the separately ruled path conventions are
// named below so the scan's exclusions are rulings, not gaps.
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
// the default deny), and the agent contract's example paths are relative.
const HOME_FAMILIES = ["/home/", "/Users/", "/root/", "C:\\Users\\"]

describe("the template genericity scan (plans/0239 D3)", () => {
  test("the scan walks the shipped templates", () => {
    expect(templateFiles.length).toBeGreaterThan(30)
    expect(templateFiles.some((path) => path.endsWith(join("opencode.json")))).toBe(true)
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

  test("the permission template's bash section: the ruled rows stand, the host grant stays gone", async () => {
    const config = JSON.parse(readFileSync(join(templatesRoot, "opencode.json"), "utf8"))
    const bash = config.permission.bash as Record<string, string>
    // The separately ruled exception and the shipped contract's own rows.
    expect(bash["/tmp/*"]).toBe("allow")
    expect(bash["*"]).toBe("allow")
    expect(bash["bun test*"]).toBe("allow")
    // The host-specific grant the finding measured — redundant under "*"
    // and unruled; its absence is this pin's needle.
    expect(Object.keys(bash)).not.toContain("/home/*")
    expect(Object.keys(bash).every((key) => !key.startsWith("/home/"))).toBe(true)
  })
})

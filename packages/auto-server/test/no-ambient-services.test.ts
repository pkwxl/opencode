// The ambient-holder boundary (auto-core plans/0194, finding 0165-089): a
// shell's production sources never import the core's ambient services
// holder — the `@opencode-ai/auto-core/services` module — in any form. The
// holder is the run's own state, installed by the run (`installServices` in
// the core's loop) and reached through the SERVICE_ENTRIES allowlist, a
// CORE ratchet whose scan walks auto-core's src alone; a shell import would
// stand outside its reach forever, an unwitnessed dependence on the
// holder's install order (the worker transport's control channel once took
// exactly that route — the finding this guard exists for). The sideband's
// control words ride the core-owned seam instead (`requestControl`,
// auto-core src/interactive.ts). Tests are exempt by design: installing a
// fresh holder is the core's own tests' lifecycle pattern
// (`createServices`/`installServices` exist for it), and this package's
// suites verifying the control channel through an installed holder are
// that pattern's continuation — the boundary is production reach, not test
// observation. The exports boundary itself (whether the module should be a
// subpath at all) is a separate ruling (0165-174); this scan holds this
// shell's src regardless.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

// The holder module's specifier, quoted: an import (static or dynamic)
// names it in quotes; prose naming the path without them is not an import.
const HOLDER_IMPORT = /["']@opencode-ai\/auto-core\/services["']/

function srcFiles(): string[] {
  const root = join(import.meta.dir, "..", "src")
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name.endsWith(".ts")) files.push(`src/${relative(root, p).replaceAll("\\", "/")}`)
    }
  }
  walk(root)
  return files
}

// Pure so the bite rows below can feed it crafted text.
function holderImports(entries: Array<{ file: string; text: string }>): string[] {
  return entries.filter((e) => HOLDER_IMPORT.test(e.text)).map((e) => e.file)
}

describe("the ambient-holder boundary (auto-core plans/0194)", () => {
  test("no src file imports auto-core/services in any form", () => {
    const files = srcFiles()
    // The scan reads real sources: the package's src is a known-shape tree
    // (the flat modules plus web/client.ts), never a vacuous pass.
    expect(files.length).toBeGreaterThanOrEqual(15)
    const hits = holderImports(files.map((file) => ({ file, text: readFileSync(join(import.meta.dir, "..", file), "utf8") })))
    expect(hits.join("\n")).toBe("")
  })

  test("the scan bites: crafted sources flagged in every import shape, prose not", () => {
    // A real static import of the holder — the transport's pre-0194 shape,
    // the violation this guard exists for…
    expect(holderImports([{ file: "src/worker-interactive.ts", text: `import { services } from "@opencode-ai/auto-core/services"` }])).toEqual(["src/worker-interactive.ts"])
    // …the dynamic form too…
    expect(holderImports([{ file: "src/x.ts", text: `const s = await import("@opencode-ai/auto-core/services")` }])).toEqual(["src/x.ts"])
    // …while other core subpaths are not the holder…
    expect(holderImports([{ file: "src/x.ts", text: `import { requestControl } from "@opencode-ai/auto-core/interactive"` }])).toEqual([])
    expect(holderImports([{ file: "src/x.ts", text: `import { log } from "@opencode-ai/auto-core/log"` }])).toEqual([])
    // …and prose naming the path without the quoted specifier is not an
    // import (headers may teach the rule they enforce).
    expect(holderImports([{ file: "src/x.ts", text: `// never import the ambient holder (auto-core/services) from here` }])).toEqual([])
  })
})

// The core boundary, shell side — two rules, one home:
//
// 1. The ambient-holder boundary (auto-core plans/0194, finding 0165-089): a
//    shell's production sources never import the core's ambient services
//    holder — the `@opencode-ai/auto-core/services` module — in any form. The
//    holder is the run's own state, installed by the run (`installServices`
//    in the core's loop) and reached through the SERVICE_ENTRIES allowlist, a
//    CORE ratchet whose scan walks auto-core's src alone; a shell import would
//    stand outside its reach forever, an unwitnessed dependence on the
//    holder's install order (the worker transport's control channel once took
//    exactly that route — the finding this guard exists for). The sideband's
//    control words ride the core-owned seam instead (`requestControl`,
//    auto-core src/interactive.ts). Tests are exempt by design: installing a
//    fresh holder is the core's own tests' lifecycle pattern
//    (`createServices`/`installServices` exist for it), and this package's
//    suites verifying the control channel through an installed holder are
//    that pattern's continuation — the boundary is production reach, not test
//    observation.
//
// 2. The specifier-only rule (auto-core plans/0196 D3, finding 0165-174): a
//    shell reaches the core through the package specifier alone — no relative
//    import may escape this package into any sibling (the core, another
//    shell, the repo root). The exports map is the declared seam, and it
//    cannot see relative imports (0196's probe: they resolve straight past
//    it), so the route rule lives here, where the boundary's shell side is
//    visible. The exports question itself is RULED OPEN by 0196 D1 (`./*`
//    stays, pinned core-side in the import-direction suite); these two
//    guards hold this shell's side of it.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

// The holder module's specifier, quoted: an import (static or dynamic)
// names it in quotes; prose naming the path without them is not an import.
const HOLDER_IMPORT = /["']@opencode-ai\/auto-core\/services["']/

// A relative specifier named in an import (static `from "…"`, dynamic
// `import("…")`) — the only forms that can carry a reach-around.
const RELATIVE_SPECIFIER = /(?:from\s*|import\(\s*)["'](\.{1,2}\/[^"']+)["']/g

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

// Every .ts file under this package's src/ and test/, package-relative.
function pkgFiles(): string[] {
  const pkg = join(import.meta.dir, "..")
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name.endsWith(".ts")) files.push(relative(pkg, p).replaceAll("\\", "/"))
    }
  }
  for (const sub of ["src", "test"]) walk(join(pkg, sub))
  return files
}

// Pure so the bite rows below can feed it crafted text.
function holderImports(entries: Array<{ file: string; text: string }>): string[] {
  return entries.filter((e) => HOLDER_IMPORT.test(e.text)).map((e) => e.file)
}

// Pure: the relative specifiers of each entry whose resolved path leaves the
// package root — the reach-around shapes (0196 D3).
function escapeImports(entries: Array<{ file: string; text: string }>, pkgRoot: string): string[] {
  const hits: string[] = []
  for (const e of entries) {
    for (const m of e.text.matchAll(RELATIVE_SPECIFIER)) {
      const resolved = resolve(pkgRoot, dirname(e.file), m[1]!)
      if (!resolved.startsWith(pkgRoot + "/")) hits.push(`${e.file}: ${m[1]}`)
    }
  }
  return hits
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

describe("the specifier-only boundary (auto-core plans/0196 D3)", () => {
  // The one file the real-sources scan must skip: this suite itself — its
  // bite rows below quote the violation shapes as data, and a scanner that
  // flags its own examples would force the examples out of the suite.
  const SELF = "test/no-ambient-services.test.ts"

  test("no src or test file reaches outside this package by a relative import", () => {
    const pkgRoot = resolve(import.meta.dir, "..")
    const files = pkgFiles().filter((f) => f !== SELF)
    // The scan reads real sources: both planes are present, never a vacuous
    // pass (measured at 0196: no escape exists — this guard holds it so).
    expect(files).toContain("src/worker-interactive.ts")
    expect(files.some((f) => f.startsWith("test/"))).toBe(true)
    const hits = escapeImports(files.map((file) => ({ file, text: readFileSync(join(pkgRoot, file), "utf8") })), pkgRoot)
    expect(hits.join("\n")).toBe("")
  })

  test("the scan bites: every relative-escape shape flagged, in-package and bare paths not", () => {
    const pkgRoot = "/pkg"
    // The reach-around into the core — static, from the transport module…
    expect(escapeImports([{ file: "src/worker-interactive.ts", text: `import { unitViolations } from "../../auto-core/src/git"` }], pkgRoot)).toEqual(["src/worker-interactive.ts: ../../auto-core/src/git"])
    // …and dynamic, from a test (the two shapes a map cannot see)…
    expect(escapeImports([{ file: "test/ws-protocol.test.ts", text: `const core = await import("../../auto-core/src/services")` }], pkgRoot)).toEqual(["test/ws-protocol.test.ts: ../../auto-core/src/services"])
    // …while relative paths staying inside the package are legitimate…
    expect(escapeImports([{ file: "test/worker.test.ts", text: `import { x } from "../src/worker"` }], pkgRoot)).toEqual([])
    expect(escapeImports([{ file: "src/web/client.ts", text: `import { y } from "../request"` }], pkgRoot)).toEqual([])
    // …and the package specifier is the sanctioned route, not a violation…
    expect(escapeImports([{ file: "src/worker-interactive.ts", text: `import { requestControl } from "@opencode-ai/auto-core/interactive"` }], pkgRoot)).toEqual([])
    // …and prose without a quoted relative specifier after from/import( is
    // not an import (headers may teach the rule they enforce).
    expect(escapeImports([{ file: "src/worker-interactive.ts", text: `// reach the core only through @opencode-ai/auto-core/* — never a relative path out` }], pkgRoot)).toEqual([])
  })
})

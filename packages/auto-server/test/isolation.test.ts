// Dependency isolation of the server shell (constitutional, per the headless
// service evolution draft, auto-core plans/0067): this package imports
// @opencode-ai/auto-core and Node/Bun builtins only — never @opencode-ai/core,
// @opencode-ai/protocol, @opencode-ai/sdk, the monorepo server/opencode
// packages or any Effect infrastructure. The auto family holds the SDK-only
// line, and the server is self-contained on Bun.serve (HTTP + SSE + WebSocket,
// zero added runtime dependencies): event-id cursoring and bounded
// subscribers are re-implemented here if needed, never imported from the
// monorepo server. Verbal conventions decay (auto-core's
// test/import-direction.test.ts is the pattern, untouched); this suite makes
// the line an assertion — a planted forbidden dependency or import fails it.
//
// Since P4a the line covers the Web client's sources too (web/): the browser
// bundle is part of this package's shipped surface, and the task's own scope
// holds the isolation line "for every file" — the client is plain TypeScript
// over web standards (DOM, fetch, WebSocket) whose only imports are its
// sibling modules and the protocol module of src/ itself.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { builtinModules } from "node:module"
import { dirname, join, relative, resolve } from "node:path"

const PACKAGE_ROOT = resolve(import.meta.dir, "..")

// The one runtime dependency this package may declare: the workspace core.
const ALLOWED_DEPENDENCIES = ["@opencode-ai/auto-core"]

// The forbidden names the close-out guard names explicitly (T-098): the
// monorepo's server-side packages and Effect infrastructure — none may appear
// anywhere in the package's manifest, dev dependencies included (a dev
// dependency is one `import` away from shipping).
const FORBIDDEN_DEPENDENCIES = ["@opencode-ai/core", "@opencode-ai/protocol", "@opencode-ai/sdk", "@opencode-ai/server", "@opencode-ai/opencode", "effect", "@effect/langchain", "@effect/ai"]

// Whether an external import specifier is legal: the core (the package root,
// any submodule or template path) or a Node/Bun builtin ("node:…", "bun:…",
// or a bare Node builtin name such as "url").
function allowedImport(spec: string): boolean {
  if (spec === "@opencode-ai/auto-core" || spec.startsWith("@opencode-ai/auto-core/")) return true
  if (spec.startsWith("node:") || spec.startsWith("bun:")) return true
  const head = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]
  return builtinModules.includes(head)
}

type ImportFinding = { file: string; spec: string }

// Every import specifier of the shipped source (src/ and script/): `… from
// "spec"` statements, bare side-effect imports and dynamic imports, type-only
// edges included — isolation is total, erased or not. Cross-package template
// imports keep the `with { type: "file" }` form, which this scan sees as a
// legal core import.
function scanImports(): ImportFinding[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(name)) files.push(p)
    }
  }
  for (const dir of ["src", "script", "web"]) walk(join(PACKAGE_ROOT, dir))
  const specs: ImportFinding[] = []
  for (const file of files) {
    const text = readFileSync(file, "utf8")
    const record = (spec: string): void => {
      specs.push({ file: relative(PACKAGE_ROOT, file), spec })
    }
    for (const m of text.matchAll(/from\s*["']([^"']+)["']/g)) record(m[1]!)
    for (const m of text.matchAll(/^import\s*["']([^"']+)["']/gm)) record(m[1]!)
    for (const m of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) record(m[1]!)
  }
  return specs
}

describe("server dependency isolation (constitutional)", () => {
  test("package.json declares exactly the workspace core dependency", async () => {
    const pkg = await Bun.file(join(PACKAGE_ROOT, "package.json")).json()
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(ALLOWED_DEPENDENCIES)
    expect(pkg.dependencies?.["@opencode-ai/auto-core"]).toBe("workspace:*")
    // Close-out hardening (T-098): the forbidden server-side names stay out
    // of the whole manifest — dependencies and devDependencies alike.
    const declared = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]
    const present = declared.filter((name) => FORBIDDEN_DEPENDENCIES.includes(name))
    expect(present.join(", ")).toBe("")
  })

  test("shipped source imports only the core and Node/Bun builtins", () => {
    const problems = scanImports()
      .filter((item) => !item.spec.startsWith("."))
      .filter((item) => !allowedImport(item.spec))
      .map((item) => `${item.file} imports "${item.spec}": this package reaches only @opencode-ai/auto-core and Node/Bun builtins`)
    expect(problems.join("\n")).toBe("")
  })

  test("relative imports stay inside this package (no sibling reach-through)", () => {
    const problems = scanImports()
      .filter((item) => item.spec.startsWith("."))
      .filter((item) => relative(PACKAGE_ROOT, resolve(dirname(join(PACKAGE_ROOT, item.file)), item.spec)).startsWith(".."))
      .map((item) => `${item.file} imports "${item.spec}": the specifier escapes the package — cross-package code goes through @opencode-ai/auto-core`)
    expect(problems.join("\n")).toBe("")
  })
})

#!/usr/bin/env bun
// The Web client's build pipeline (P4a, auto-core plans/0067 §三.4): the
// browser sources under web/ are bundled into ONE generated module the daemon
// imports — src/web/client.ts, exporting the page and the script as string
// constants. Serving them from memory (not from a directory beside the
// daemon) is what makes the client work in every layout this package ships:
// the source layout (bun src/index.ts serve), the test harness (in-process
// startDaemon) and the compiled binary (script/build.ts) — a string constant
// compiles into the binary, a sibling file does not.
//
// The pipeline itself is dependency-free: Bun.build over web/main.ts
// (target browser, format iife — the whole client is one <script src>), the
// page web/index.html taken verbatim, both embedded into the generated module
// through JSON.stringify (the bundle's own backticks and ${…} must not be
// interpreted by the generated literal). Output is deterministic for a given
// input (same bundler, same sources), so test/web-build.test.ts pins the
// committed module against a fresh run: edit web/, run `bun run build:web`,
// and a stale bundle fails the suite.
//
// Usage: bun run build:web   (or: bun ./script/build-web.ts)
import { fileURLToPath } from "url"

const packageDir = fileURLToPath(new URL("..", import.meta.url))
const ENTRY = "web/main.ts"
const PAGE = "web/index.html"
const OUT = "src/web/client.ts"

// Bundles the client and reads the page, returning the two assets the daemon
// serves. Exported for the build test (which re-runs the pipeline and compares
// against the committed module).
export async function buildWebClient(): Promise<{ js: string; html: string }> {
  const built = await Bun.build({ entrypoints: [`${packageDir}/${ENTRY}`], target: "browser", format: "iife" })
  if (!built.success) {
    for (const log of built.logs) console.error(log)
    throw new Error(`the web client build failed: ${ENTRY} did not bundle`)
  }
  // One entrypoint in, one chunk out (no code splitting, no assets).
  const [output] = built.outputs
  if (output === undefined || output.kind !== "entry-point") throw new Error(`the web client build produced no entry chunk`)
  const js = await output.text()
  const html = await Bun.file(`${packageDir}/${PAGE}`).text()
  return { js, html }
}

// The generated module's text: the banner naming its provenance, then the two
// constants the daemon serves.
export function renderClientModule(assets: { js: string; html: string }): string {
  return [
    "// GENERATED FILE — the daemon's Web client assets (P4a), produced by",
    "// script/build-web.ts from web/ (the browser sources). Do not edit by",
    "// hand: edit web/, then run `bun run build:web` (test/web-build.test.ts",
    "// pins this module against a fresh build of the sources).",
    `export const CLIENT_INDEX_HTML = ${JSON.stringify(assets.html)}`,
    "",
    `export const CLIENT_APP_JS = ${JSON.stringify(assets.js)}`,
    "",
  ].join("\n")
}

if (import.meta.main) {
  const module = renderClientModule(await buildWebClient())
  await Bun.write(`${packageDir}/${OUT}`, module)
  console.log(`✓ web client bundled: ${ENTRY} + ${PAGE} → ${OUT} (${module.length} bytes)`)
}

// The Web client's build pipeline (T-096, P4a): script/build-web.ts bundles
// web/ (the browser sources) into src/web/client.ts — the string constants
// the daemon serves as the page and the script. This suite pins the pipeline
// itself:
//   - the committed module is exactly what a fresh build produces (a stale
//     bundle after editing web/ fails here: re-run `bun run build:web`);
//   - the served page wires the served script (the page loads /app.js, the
//     one route the daemon answers with the bundle);
//   - the bundle is self-contained (an IIFE with no runtime imports — the
//     browser fetches exactly one script, and the isolation line holds: the
//     bundler inlined the relative modules, nothing external is reached).
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { buildWebClient, renderClientModule } from "../script/build-web"
import { CLIENT_APP_JS, CLIENT_INDEX_HTML } from "../src/web/client"

describe("the web client build pipeline", () => {
  test("the committed bundle is what a fresh build of web/ produces", async () => {
    const fresh = renderClientModule(await buildWebClient())
    const committed = await Bun.file(join(import.meta.dir, "..", "src", "web", "client.ts")).text()
    expect(committed).toBe(fresh)
  })

  test("the served page loads the served script", () => {
    expect(CLIENT_INDEX_HTML).toContain('<script src="/app.js"></script>')
    expect(CLIENT_APP_JS.length).toBeGreaterThan(1000)
  })

  test("the bundle is a self-contained IIFE (no runtime imports)", () => {
    expect(CLIENT_APP_JS.startsWith("(() => {")).toBe(true)
    // No static import/export reaches the browser at runtime — the bundler
    // inlined every module (the ws-protocol module included).
    for (const line of CLIENT_APP_JS.split("\n")) if (/^\s*import\s/.test(line) && !/^\s*\/\/.*import/.test(line)) throw new Error(`the bundle still imports at runtime: ${line.trim()}`)
  })

  test("the client's honesty vocabulary is in the bundle it ships", () => {
    // The rules the page renders ride the bytes the daemon serves: the
    // commit-verdict rendering and the frozen-flag form are the shipped
    // script's own code, not a different build's.
    expect(CLIENT_APP_JS).toContain("verdictRows")
    expect(CLIENT_APP_JS).toContain("START_OPTION_FIELDS")
    expect(CLIENT_APP_JS).toContain("frozen by init")
  })
})

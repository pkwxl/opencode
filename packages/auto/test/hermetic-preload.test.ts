// The preload's contract (plans/0232 D1, finding 0165-059/S00-02): this
// package's test process carries no operator model registry, whatever the
// operator's machine exports. The mechanism is test/preload.ts (bunfig.toml
// [test] preload): OPENCODE_AUTO_MODELS names a file that does not exist —
// a set value defeats the registry's XDG fallback (src/models.ts
// operatorLayerPath reads the env form first), so no $XDG_CONFIG_HOME/
// opencode-auto/models.json on the operator's machine can reach an
// in-process read either. The behavioral half is the consequence: the core's
// loadModels over an empty directory with its DEFAULT env (process.env)
// finds no operator layer. Pre-fix (no preload), on a machine exporting
// OPENCODE_AUTO_MODELS at a real registry, the same call reads it — the
// pin is red there, green under the preload.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadModels } from "@opencode-ai/auto-core/models"

describe("test-process hermeticity (the bunfig preload)", () => {
  test("OPENCODE_AUTO_MODELS names a file that does not exist (the no-operator-layer pointer)", () => {
    const pointer = process.env.OPENCODE_AUTO_MODELS
    expect(pointer, "the preload sets the pointer").toBeDefined()
    expect(existsSync(pointer!), `the pointer must name a missing file: ${pointer}`).toBe(false)
  })

  test("the default-env registry read finds no operator layer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-hermetic-"))
    try {
      // loadModels with no env option reads process.env (the operator layer
      // at $OPENCODE_AUTO_MODELS, else the XDG fallback) — undefined means
      // no layer was read in this process.
      expect(await loadModels(dir, { phaseTypes: [] })).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// The preload's contract (plans/0232 D1, finding 0165-059/S00-02): this
// package's test process carries no operator model registry, whatever the
// operator's machine exports. The mechanism is test/preload.ts (bunfig.toml
// [test] preload), mirroring the auto-core precedent: XDG_CONFIG_HOME at an
// empty temporary directory and a set OPENCODE_AUTO_MODELS dropped — the
// registry's operator layer reads the env form first and falls back to the
// config home (src/models.ts operatorLayerPath), so both routes must go
// (the pre-fix hand-rolled per-file line covered only the XDG half; an
// ambient OPENCODE_AUTO_MODELS defeated it). The behavioral half is the
// consequence: the core's loadModels over an empty directory with its
// DEFAULT env (process.env) finds no operator layer. Pre-fix (no preload),
// on a machine exporting either form, the same call reads it — the pin is
// red there, green under the preload.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadModels } from "@opencode-ai/auto-core/models"

describe("test-process hermeticity (the bunfig preload)", () => {
  test("XDG_CONFIG_HOME is the preload's temp and carries no operator registry; no ambient OPENCODE_AUTO_MODELS survives", () => {
    const xdg = process.env.XDG_CONFIG_HOME
    expect(xdg, "the preload sets the config home").toBeDefined()
    expect(existsSync(xdg!), `the config home must exist: ${xdg}`).toBe(true)
    // The contract is the absence of the operator registry, not emptiness:
    // a run's own opencode server legitimately writes its config inside
    // whatever config home it finds (an `opencode/` directory), and the
    // daemon suites run real workers in this process — into the preload's
    // temp, never the operator's real home. That is the redirection working.
    expect(existsSync(join(xdg!, "opencode-auto", "models.json")), "no operator registry may exist in the config home").toBe(false)
    expect(process.env.OPENCODE_AUTO_MODELS, "a set operator-registry pointer must be dropped").toBeUndefined()
  })

  test("the default-env registry read finds no operator layer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-server-hermetic-"))
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

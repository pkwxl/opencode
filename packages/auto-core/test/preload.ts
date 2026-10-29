// Test preload (bunfig.toml [test] preload): keeps the operator's real model
// registry out of every core test. Preflight loads the registry's operator
// layer at each run start ($OPENCODE_AUTO_MODELS, otherwise
// $XDG_CONFIG_HOME/opencode-auto/models.json, src/models.ts), so any test that
// reaches runAll or preflight in this process would otherwise read a
// developer's own file, and fail on its references or be steered by it.
// XDG_CONFIG_HOME points at an empty temporary directory for the whole run and
// OPENCODE_AUTO_MODELS is dropped. A test of the operator layer passes its
// paths explicitly (loadModels' env option).
// Children started with Bun.spawn without an explicit env keep the environment
// of the process start, so git in the fixtures still reads its own config.
// AUTO-DECISION: one preload instead of an env override in each fixture that reaches preflight (the in-process runAll and preflight callers are spread over several test files without a shared fixture, and a preload also covers the ones written later)
//
// The preload also installs a fresh run-services instance before every test
// (the module-level beforeEach registered here applies to every test file in
// the process): the run's clock, the process-level time keepers it wires
// (the stats module), the router's decision state (the failback holders,
// the down marks, the logged usage windows, the model-step cache claims,
// the key rings, the classifier's answer cache and call budget), the
// control service's /exit request flag and the git service's strategy (a
// test that turns committing off installs the no-commit double through its
// own holder's override slot; the fresh holder here carries the production
// delegation again) never leak from one test into the next. A test that
// steers time installs its own holder the same way; a test that needs
// fresh marks or an unset /exit flag mid-way reinstalls a holder keeping
// the current clock.
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeEach } from "bun:test"
import { createServices, installServices } from "../src/services"

const xdg = mkdtempSync(join(tmpdir(), "auto-core-xdg-"))
process.env.XDG_CONFIG_HOME = xdg
delete process.env.OPENCODE_AUTO_MODELS
process.on("exit", () => rmSync(xdg, { recursive: true, force: true }))

// The lane-log seam (plans/0151 D1): a driver-run lane or regression lane
// whose caller injects no logDir writes the shared default /tmp/opencode —
// a machine-wide directory other tenants of the host use. The preload points
// the seam at a per-global scratch dir instead (under `bun test --parallel`
// every file runs in its own worker global, its own preload run, its own
// dir — concurrent workers never share a lane-log path). captureRun keeps
// the seam across its OPENCODE_AUTO_* scrub (an output redirect, not a
// switch); a helper with its own scrub takes the redirect from the test
// that launches lanes. Tests that inject their own logDir, and the seam's
// unit tests passing explicit env records, are unaffected: the explicit
// value always wins over the environment. The afterAll cleans per file
// (parallel workers do not reliably run process exit handlers; the handler
// stays as the serial-run belt).
const laneLogs = mkdtempSync(join(tmpdir(), "auto-core-lanelog-"))
process.env.OPENCODE_AUTO_LANE_LOG_DIR = laneLogs
process.on("exit", () => rmSync(laneLogs, { recursive: true, force: true }))
afterAll(() => rmSync(laneLogs, { recursive: true, force: true }))

installServices(createServices())
beforeEach(() => {
  installServices(createServices())
})

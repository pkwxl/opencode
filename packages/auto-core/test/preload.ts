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
// (the stats module) and the router's decision state (the failback holders,
// the down marks, the logged usage windows, the model-step cache claims,
// the key rings) never leak from one test into the next. A test that steers
// time installs its own holder the same way; a test that needs fresh marks
// mid-way reinstalls a holder keeping the current clock.
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach } from "bun:test"
import { createServices, installServices } from "../src/services"

const xdg = mkdtempSync(join(tmpdir(), "auto-core-xdg-"))
process.env.XDG_CONFIG_HOME = xdg
delete process.env.OPENCODE_AUTO_MODELS
process.on("exit", () => rmSync(xdg, { recursive: true, force: true }))

installServices(createServices())
beforeEach(() => {
  installServices(createServices())
})

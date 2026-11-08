// Test preload (bunfig.toml [test] preload): keeps the operator's real model
// registry out of this package's test process — the auto-core precedent
// (auto-core/test/preload.ts, plans/0055 §4.1 "Hermetic tests"), mirrored
// exactly: XDG_CONFIG_HOME points at an empty temporary directory for the
// whole run and a set OPENCODE_AUTO_MODELS is dropped. The registry's
// operator layer reads $OPENCODE_AUTO_MODELS first, else
// $XDG_CONFIG_HOME/opencode-auto/models.json (src/models.ts
// operatorLayerPath), so both routes must go. This replaces the per-file
// hand-rolled line (`process.env.XDG_CONFIG_HOME = scrubbedEnv().XDG_CONFIG_HOME`,
// formerly repeated in fourteen test files) that covered only the XDG
// fallback — an ambient OPENCODE_AUTO_MODELS on the operator's machine
// defeated it, and a fifteenth file written without the line got nothing
// (plans/0232 D1). The in-process daemon suites pass dataDir explicitly and
// no test here needs the operator's real opencode config, so unlike the auto
// package's preload this one redirects XDG outright. Subprocess environments
// are built from scrubbedEnv() (test/fixtures/project.ts), which spreads this
// post-preload env — the same empty config home, one home per process. The
// ambient OPENCODE_AUTO_* switch layer is NOT stripped in-process: the
// daemon strips it off its own worker spawns (src/daemon.ts spawnWorker) and
// every direct spawn builds on scrubbedEnv(); the per-run switches a worker
// honors ride the request payload. The directory is removed at process exit.
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const xdg = mkdtempSync(join(tmpdir(), "auto-server-xdg-"))
process.env.XDG_CONFIG_HOME = xdg
delete process.env.OPENCODE_AUTO_MODELS
process.on("exit", () => rmSync(xdg, { recursive: true, force: true }))

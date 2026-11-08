// Test preload (bunfig.toml [test] preload): keeps the operator's real model
// registry out of this package's test PROCESS — the auto-core precedent
// (auto-core/test/preload.ts, plans/0055 §4.1 "Hermetic tests"), in the form
// 0055 §4.1's AUTO-DECISION already ruled for this package's in-process runs:
// OPENCODE_AUTO_MODELS names a file that does not exist. A set (even to a
// missing file) is required, not a deletion: the registry's operator layer
// reads $OPENCODE_AUTO_MODELS first and falls back to
// $XDG_CONFIG_HOME/opencode-auto/models.json (src/models.ts operatorLayerPath),
// so only a set value defeats the XDG fallback — deletion would leave the
// operator's real config home reachable. XDG_CONFIG_HOME itself stays
// untouched on purpose: the opt-in real-server e2e runs (OPENCODE_AUTO_E2E=1)
// call runAll in this process and need the operator's real opencode config for
// the server they start (0055 §4.1's AUTO-DECISION, promoted here from one
// test file's module body to the package's own home — every test file now
// carries the guard from load, not only the files loaded after e2e.test.ts's
// module body evaluated; the recorded incident of the hand-rolled shape is
// that file's own T-127 scene, a scrub that forgot the re-plant).
// The ambient OPENCODE_AUTO_* switch layer is NOT stripped here: this suite's
// own opt-in gates ride OPENCODE_AUTO_* names (OPENCODE_AUTO_E2E and its
// *_E2E_* knobs), and the only in-process switch readers are the e2e's own
// per-test scrubs (the 0165 S28 measurement). Subprocesses never inherit the
// ambient layer regardless — the e2e harness's CLI_ENV_BASE strips it from
// every spawn. The pointer's directory is removed at process exit.
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const scratch = mkdtempSync(join(tmpdir(), "auto-test-xdg-"))
process.env.OPENCODE_AUTO_MODELS = join(scratch, "no-operator-layer.json")
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }))

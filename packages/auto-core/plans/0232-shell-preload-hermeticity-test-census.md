# 0232 — the shells' test-process hermeticity: one preload per package; the census's four missing test homes

Status: active-authority (0166 remediation step 072, wave WB-test; findings 0165-059 =
S00-02 (S3, PLAUSIBLE, TEST — the shells' test suites have no bunfig preload, not
hermetic against the operator's model registry and ambient `OPENCODE_AUTO_*`) and
0165-063 = S01-05 (S3, CONFIRMED, TEST — five auto-core modules had no direct test
import; the review's principles measure is "How to rule": a requirement names its test
home)).

One family — **the test homes of the registry-loading contract and of the census's
uncovered modules**. 0055 §4.1's "Hermetic tests" bullet is the standing case law:
auto-core's `bunfig.toml` preloads `test/preload.ts` (empty-temp `XDG_CONFIG_HOME`,
`OPENCODE_AUTO_MODELS` dropped), the shell e2e's `CLI_ENV_BASE` gives subprocesses an
empty `XDG_CONFIG_HOME`, and its in-process runs get an `OPENCODE_AUTO_MODELS` naming a
missing file. The finding measures that contract's shell half as spawn-side-only: the
shells' **test process itself** has no owning home for it. Beside it, the census half:
the review measured five auto-core modules no test file imports directly. 0165 is the
evidence, not the authorization.

## The measured ground (what each surface does today)

### 059 — the hermeticity half

- **The spawn side is scrubbed** (S28's own finding, re-verified at this step's HEAD):
  packages/auto's e2e spawns through `CLI_ENV_BASE` (every ambient `OPENCODE_AUTO_*`
  stripped, `XDG_CONFIG_HOME` at an empty temp, `OPENCODE_AUTO_ANALYSIS=off`,
  `GIT_CONFIG_GLOBAL` pinned); packages/auto-server's direct spawns build on
  `scrubbedEnv()` (the same strip + its own empty-temp XDG); the daemon's own worker
  spawns strip the `OPENCODE_AUTO_*` layer from their parent (src/daemon.ts
  `spawnWorker`). The finding's impact line — "a shell e2e spawned with the operator
  environment" — is answered by S28: no such spawn exists.
- **The test-process side has no owning home.** What an unscrubbed test process can
  read, measured from the core sources the shells import in-process:
  `loadModels(dir)` with no env option reads `process.env` (the operator layer at
  `$OPENCODE_AUTO_MODELS`, else `$XDG_CONFIG_HOME/opencode-auto/models.json` — the XDG
  form **preceded only by the env var**, so an ambient `OPENCODE_AUTO_MODELS` defeats
  the XDG redirect without one); `autoSwitches()` parses `process.env` at its first
  call. In packages/auto the in-process guard is **one module-level assignment in
  e2e.test.ts** (`process.env.OPENCODE_AUTO_MODELS = <a missing file>`) — it protects
  exactly the files loaded after e2e.test.ts's module body and nothing else in the
  package; the measured bite is that file's own T-127 comment: a host whose operator
  registry (via the XDG fallback, when a test had scrubbed the env var) made an
  in-process `runAll` exit 1 mid-round — the hand-rolled per-test scrub pattern
  forgetting the re-plant is a defect class with one recorded incident. In
  packages/auto-server the in-process guard is a **hand-rolled line repeated in 14
  test files** (`process.env.XDG_CONFIG_HOME = scrubbedEnv().XDG_CONFIG_HOME`) — it
  covers only the XDG fallback: an ambient `OPENCODE_AUTO_MODELS` on the operator's
  machine defeats it, a fifteenth file written without the line gets nothing, and the
  line's own temp is a second empty config home beside whatever a preload would own.
- Neither shell package has a `bunfig.toml`; `bun test` run from the package root (the
  packages' own `test` script) applies no preload. The workspace root's `bunfig.toml`
  is not read from a subdirectory cwd (the shells' suites run today with none of its
  `[test]` settings applying).

### 063 — the census half, re-measured at this step's HEAD

| module | lines | direct test import at HEAD |
| --- | --- | --- |
| `src/stats-schema.ts` | 658 | none — the store's own suite (test/stats.test.ts) exercises the loader and the booking paths; the schema half's pure laws (lenient parse, absent-when-empty sections, the copy/merge functions, the stint record assembly) ride only indirectly |
| `src/engine/fx.ts` | 141 | none — the spine/replay scenarios and the concern suites (over the fx double) never import the production constructor |
| `src/engine/sources.ts` | 133 | **test/turn-sources.test.ts** — step 069's ruling 0229 D4 delivered it; the finding's list predates that step |
| `src/overlay.ts` | 38 | none — reached only through the mode/intent loaders' suites |
| `src/clean.ts` | 35 | none — reached only through the CLI reset/init e2e paths |

The finding's secondary notes, recorded not ruled here: `status.ts` has no dedicated
test file but IS imported by three suites (provenance, tasks, wall — the finding's own
"indirect coverage only" class); `loop-plan`/`loop-phase` thinness is carried by
findings 0177/0189/0190/0224, whose own step is 075 (the wc-loop-plan-size split).

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P19** (measured evidence): both halves rule on measurement, not plausibility. The
  census is a count (the table above, re-measured at this HEAD, one row already
  resolved by an earlier step). The hermeticity fix's shape is measured from what the
  shells' test processes actually read: the registry half is the read with a recorded
  incident (T-127) and a named ambient precedence (env var over XDG); the switches
  half has **no measured in-process reader** outside the e2e's own per-test scrubs
  (S28's finding) — so the preload guards the registry half, and the switches half is
  named as what it is (per-test, where the only readers live), not speculatively
  centralized.
- **P5** (single ownership): every hermeticity policy gets exactly one owning home —
  the package's preload, applied by `bun test` itself. The 14 hand-rolled per-file XDG
  lines and `scrubbedEnv()`'s private temp retire onto auto-server's preload; the e2e
  module-level `OPENCODE_AUTO_MODELS` assignment retires onto auto's preload; the
  spawn bases keep their own job (stripping the ambient layer for children — a
  different policy, one home each, no mirror).
- **P12** (conservative under uncertainty): a test run on an unknown host resolves
  toward **no operator layer** — machine state a test did not plant must not steer or
  gate it. An ambient `OPENCODE_AUTO_MODELS` on the operator's machine is exactly the
  uncertain input the conservative reading removes.
- **P10** (the byte-identical floor): the change is test infrastructure — zero runtime
  source, zero behavior of the tools. The floors are part of the ruling: auto's
  preload must NOT touch `XDG_CONFIG_HOME` (0055 §4.1's own AUTO-DECISION carried to
  the package level — the opt-in real-server in-process runs keep the operator's real
  opencode config; a missing-file pointer already defeats the registry's XDG fallback,
  so nothing more is needed); auto-server's preload mirrors the core exactly (no
  in-process consumer of the operator's opencode config exists there — its in-process
  daemon takes `dataDir` explicitly); the spawned children's environments are
  byte-identical in effect (empty config homes before and after, different temps).
- **P21** (machinery waits for its consumer): the preload does not grow a
  general ambient-scrub or services-reset half. The auto e2e's own opt-in knobs ride
  `OPENCODE_AUTO_*` names (`OPENCODE_AUTO_E2E`, `_E2E_STEPS`, `_E2E_KEYS`,
  `_E2E_CLASSIFIER`) — a blanket strip would kill the suite's own gates; no measured
  non-E2E in-process switch read exists to serve. The core preload's services-reset
  half is the core's test lifecycle (its suites install holders in-process); the
  shells' suites do not reach the ambient holder (0194's boundary — production reach
  is none, and no shell test installs one).
- **How to rule** ("requirements live with their mechanisms" — a code home owes its
  test home in the same change): the census half is this discipline applied to four
  modules whose homes never landed with them. The direct suites pin each module's own
  stated laws (the header contracts), not tautologies over internals.

## Decisions

### D1 (0165-059) — one preload per shell package, the registry half, each in its measured form

- **packages/auto**: `bunfig.toml` (`[test] preload = ["./test/preload.ts"]`) +
  `test/preload.ts` that sets `process.env.OPENCODE_AUTO_MODELS` to a file inside a
  fresh temp directory that is never written (removed at process exit) and touches
  nothing else — the in-process half of 0055 §4.1's AUTO-DECISION, promoted from one
  test file's module body to the package's own home: every in-process registry read
  in every test file (the core's `loadModels` default env, any future in-process
  preflight/runAll) finds no operator layer whatever the operator's machine exports,
  while the opt-in real-server runs keep the operator's real opencode config (XDG
  untouched). The e2e's module-level assignment retires; its comment block teaches
  the preload's ownership (the subprocess half — `CLI_ENV_BASE`, git pinning — stays
  the e2e's own, unchanged). The lane-worker scene's own scrub-restore contract is
  untouched (it re-plants its pointer explicitly; only its comment's "this module's"
  wording is corrected to the preload's).
- **packages/auto-server**: `bunfig.toml` + `test/preload.ts` mirroring the core's
  registry half — `process.env.XDG_CONFIG_HOME` to a fresh empty temp (removed at
  exit), ambient `OPENCODE_AUTO_MODELS` deleted. The 14 per-file
  `process.env.XDG_CONFIG_HOME = scrubbedEnv().XDG_CONFIG_HOME` lines retire (their
  teaching comments shrink to the preload pointer); `scrubbedEnv()` simplifies to the
  one job left to it — the ambient `OPENCODE_AUTO_*` strip over the post-preload
  process env, the preload's temp riding its spread (its own temp dir and exit
  handler die; the spawn bases' XDG is the same empty-temp posture as before, now the
  process's own one home).
- **The pins** (fail-red pre-fix, green post-fix): `test/hermetic-preload.test.ts` per
  shell — the mechanism's contract (auto: the pointer is set and names a file that
  does not exist; auto-server: the config home is an existing empty directory and no
  ambient `OPENCODE_AUTO_MODELS` survives) and the behavioral consequence in one
  (the core's `loadModels` over an empty directory with its default env reads no
  operator layer).
- **Named residuals**: (1) auto's in-process ambient-switch half stays per-test — the
  suite's opt-in gates are themselves `OPENCODE_AUTO_*` names, and the only
  in-process switch readers are the e2e's own scrubbing tests (S28); a measured
  non-E2E in-process reader would reopen this. (2) The registry's **project layer**
  (`.opencode/auto/models.json` inside a target fixture) is a fixture's own planted
  state, deliberately out of the preload's reach. (3) auto-server's spawned lane
  workers' lane-log default (`/tmp/opencode-auto` unless a run sets `logDir`) is
  machine-state pollution of a different family (the core's preload guards it for
  core tests via `OPENCODE_AUTO_LANE_LOG_DIR`; the daemon's spawn strip removes that
  name from workers) — observed here, not ruled; no ledger row exists for it.

### D2 (0165-063) — the four direct suites, each pinning its module's own stated laws

- `test/stats-schema.test.ts` — the schema half's pure laws: the empty-value
  constructors' exact shapes; lenient parsing (bad fields read as missing, never a
  throw; bad JSON → undefined); the optional sections' absent-when-empty rule (the
  load→write round trip byte-identical for a document without them);
  `parseBucket`'s fallback id and the stint stamps carried only when present;
  `parseDecomposeRun`'s enum survival; `parseLaneStats`' `booked` only when true;
  `addUsage`'s lenient deltas; `copyTotals`' no-aliasing deep copy;
  `mergeModelStats`/`mergeDigestStats` lazy section creation and summation;
  `taskStintRecord`'s assembly (bucket stamp with the close-moment fallback, the
  session log ordered by last-active, embedded copies that never alias the live
  document).
- `test/engine-fx.test.ts` — the production fx's own invariants: the kernel guard
  (commitFreeze/runTest/resolveTest/saveHandover throw on a turn without a test run);
  the `contextLimits` memoization (one client fetch over two calls, the same map
  both times); steer's model resolution (a named model wins, the `steerModel` getter
  defaults the unnamed call, a changed getter value is seen by the steers that
  follow — the mid-turn step-up the getter exists for); a failed dispatch answers
  false; the text reaches the usage source; and the journaling wrap's event
  discipline over a started journal — the call event for every member, `fx-result`
  for answered members (sync and resolved promises), `fx-reject` for a rejection that
  still rethrows, no answer event for the pure sinks — with `stopRunEvents` in a
  finally (the journal fd is process-global).
- `test/overlay.test.ts` — `overlayMarkdownFiles`: sorted and `.md`-filtered with the
  shared name grammar; a missing or non-directory overlay the empty overlay; any
  other read error rethrown; the invalid-name error naming the file class and the
  full overlay path.
- `test/clean.test.ts` — `checkCleanTree`: a clean tree undefined; a dirty tree the
  ready-to-print message (the first ten files, the "…and N more files" line past
  ten, the two ways out); a directory outside any repository undefined (the stated
  let-through); nested-repository dirt counted (the `repoRoots` descent).
- **Census disposition**: `engine/sources`' home is step 069's (0229 D4) — this step
  adds no second one; `status.ts`'s "no test file" note is recorded above with its
  three indirect importers; `loop-plan`/`loop-phase` thinness stays its own findings'
  step (075).

## Derivation and Category scope

Derives: **P19** (both halves rule on the measured census and the recorded T-127
incident, the preload's shape from the measured precedence of the registry's env form
over its XDG form; showing: the ground table and D1's per-package forms), **P5** (one
owning home per hermeticity policy — the preload — with the 14 hand-rolled lines, the
private temp and the e2e module-level assignment retired onto it; showing: D1),
**P12** (an unknown host resolves toward no operator layer; showing: D1's
conservative direction and the pin), **P10** (test infrastructure only, the floors
stated — auto's XDG untouched, auto-server's spawn postures unchanged in effect;
showing: D1's floors and the byte-identical spawn bases), **P21** (no speculative
ambient-scrub or services half grows in the shells' preloads; showing: D1's scoping
and residual 1), and the **How-to-rule** test-home discipline (a code home owes its
test home; showing: D2's four suites). Amends: none — 0055 §4.1's "Hermetic tests"
bullet is completed, not changed (its letter already states the shells' discipline;
the preload gives the in-process half the one home P5 wants), and S28's finding is
consumed as the spawn-side measurement. Tier: **tests + documentation** (zero runtime
behavior; no shell or core src file changes).

### Category scope

The family: **test-process hermeticity against operator machine state + the direct
test homes of the census's uncovered modules** (0055 §4.1's hermetic-tests bullet and
the How-to-rule test-home rule are the family's authorities).

| home | role | this ruling |
| --- | --- | --- |
| `auto-core/bunfig.toml` + `test/preload.ts` | the precedent preload (registry + lane-log + services reset) | untouched — the model the shells' preloads mirror |
| `packages/auto/bunfig.toml` + `test/preload.ts` | auto's in-process registry guard | **created** (D1) |
| `packages/auto/test/e2e.test.ts` | the subprocess base + the retired module-level in-process assignment | **edited** — the assignment retires onto the preload; the comment block and the lane-worker scene's wording teach the ownership; `CLI_ENV_BASE` and the git pinning unchanged |
| `packages/auto/test/hermetic-preload.test.ts` | auto's hermeticity pin | **created** (D1) |
| `packages/auto-server/bunfig.toml` + `test/preload.ts` | auto-server's in-process registry guard (the core's mirror) | **created** (D1) |
| the 14 auto-server test files carrying `process.env.XDG_CONFIG_HOME = scrubbedEnv().XDG_CONFIG_HOME` | the retired hand-rolled guard | **edited** — the line and its per-file comment retire onto the preload |
| `packages/auto-server/test/fixtures/project.ts` (`scrubbedEnv`) | the spawn-side ambient strip | **edited** — the private temp dies, the strip spreads the post-preload env; the comment restated |
| `packages/auto-server/test/hermetic-preload.test.ts` | auto-server's hermeticity pin | **created** (D1) |
| `auto-core/test/stats-schema.test.ts` / `test/engine-fx.test.ts` / `test/overlay.test.ts` / `test/clean.test.ts` | the four census modules' direct homes | **created** (D2) |
| `auto-core/test/turn-sources.test.ts` | `engine/sources`' direct home (step 069's) | untouched — acknowledged in the census |
| `plans/INDEX.md` | the corpus manifest | **edited** — row 0232 |

## premises this ruling changes: none

0055 §4.1's "Hermetic tests" bullet re-read standing (its shell half describes the
spawn bases and the e2e's in-process pointer — both alive, the latter now owned by
the preload it always described); S28's record re-read standing (the spawn-side
scrub it measured is unchanged in effect); 0229 D4 re-read standing (the sources
suite is engine/sources' one home). No ruling's premise rests on the absence of a
shell bunfig.

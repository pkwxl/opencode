# Step 072 — wb-hermetic-preload

Wave WB-test · findings 0165-059 (S00-02) + 0165-063 (S01-05) · status:
**done** 2026-11-09 · start HEAD `e53dedfac`.

## Scope (the findings' family)

The test-infrastructure family: every package's test process hermeticity
against the operator's own machine state (the model registry layers and the
ambient `OPENCODE_AUTO_*` layer), and the direct-test census for the
auto-core modules the review measured with no direct test import.

- **0165-059 (S00-02, S3, PLAU, TEST)** — "the shells' test suites have no
  bunfig preload — not hermetic against the operator's model registry and
  ambient OPENCODE_AUTO_*". Measures: P12, 0055 §4.1 (the "Hermetic tests"
  bullet — the standing contract: core preload + the auto e2e's two-sided
  discipline). Evidence: auto-core/bunfig.toml preloads test/preload.ts;
  neither shell has a bunfig.toml. S28's record already measured the spawn
  side scrubbed (auto's CLI_ENV_BASE, auto-server's scrubbedEnv bases and
  the daemon's own spawn scrub) — the open gap is the shells' TEST PROCESS
  itself and the policy's owning home (auto-server hand-rolls
  `process.env.XDG_CONFIG_HOME = scrubbedEnv().XDG_CONFIG_HOME` in 14 test
  files; auto's in-process registry guard is one module-level assignment in
  e2e.test.ts that protects only files loaded after it). The measured bite:
  the e2e's own T-127 comment — a host whose operator registry (via the XDG
  fallback) made an in-process runAll exit 1 mid-round.
- **0165-063 (S01-05, S3, CONF, TEST)** — "five auto-core modules have no
  direct test import (stats-schema 635 lines, engine/fx, engine/sources,
  overlay, clean); loop-plan/loop-phase thinly tested; status has no test
  file". Measures: principles "How to rule" — a requirement names its test
  home in the same change. Remedy: per owning step. Census re-measured at
  this step's HEAD: `engine/sources` gained its direct suite in step 069
  (ruling 0229 D4, test/turn-sources.test.ts); the remaining four
  (stats-schema, engine/fx, overlay, clean) still have none.

## Plan (before editing)

1. Ruling **0232** written first (next free number verified by `ls plans/`
   — 0231 the last). Answer the boundary from docs/principles.md first
   (P19 the measured census and the T-127 incident; P5 one owning home per
   hermeticity policy — the preload — over 14 hand-rolled applications;
   P12 conservative under an unknown host environment; P10 the
   byte-identical floor — test infrastructure only, zero runtime change;
   the "How to rule" test-home discipline for the census). 0165 evidence,
   not authorization; Category scope enumerated; premises guard checked
   (0055 §4.1's hermetic-tests bullet, 0229 D4's sources suite, S28's
   record).
2. Enact D1: `bunfig.toml` + `test/preload.ts` per shell — auto's the
   registry half in 0055 §4.1's E2E-compatible form (OPENCODE_AUTO_MODELS
   naming a missing file, XDG untouched for the opt-in real-server runs),
   auto-server's the core's mirror (empty-temp XDG + OPENCODE_AUTO_MODELS
   dropped); the hand-rolled per-file lines and scrubbedEnv's own temp
   retire onto the preload; a hermeticity pin per shell.
3. Enact D2: direct suites for the four census modules —
   test/stats-schema.test.ts, test/engine-fx.test.ts, test/overlay.test.ts,
   test/clean.test.ts (engine/sources' suite already step 069's).
4. Fail-before proof: the preload pins red in pre-fix /tmp copies of the
   shell packages (no bunfig/preload there, the operator scene planted);
   the census red at HEAD (no direct importer) by measurement.
5. INDEX row 0232; ledger dispositions 0165-059 + 0165-063; program
   bookkeeping; commit.

## Execution log

- 2026-11-09 (delegated worker): step opened after step 071's commit
  (`e53dedfac`, verified `git log -1 --format=%h`). Evidence read: the
  register rows (l.241, l.245) + S00-02/S01-05 records; S28's e2e
  hermeticity finding; 0055 §4.1's "Hermetic tests" bullet; the shells'
  test setups (auto e2e.test.ts's CLI_ENV_BASE block l.596-645 + the
  T-127 lane-worker scene l.5711-5760; auto-server's scrubbedEnv fixture +
  the 14 per-file XDG lines; the daemon's own spawn scrub l.522-527); the
  core's bunfig.toml + test/preload.ts; the census re-measurement
  (stats-schema/engine-fx/overlay/clean no direct importer at HEAD;
  engine/sources = step 069's turn-sources.test.ts).
- 2026-11-09: **ruling 0232 written first**
  (`plans/0232-shell-preload-hermeticity-test-census.md` — the boundary
  answered from principles.md before any edit: P19 the measured census and
  the T-127 incident, P5 one owning preload per hermeticity policy, P12 the
  conservative no-operator-layer reading of an unknown host, P10 the floors
  (auto's XDG untouched, the spawn postures unchanged in effect), P21 no
  speculative ambient-scrub half, the How-to-rule test-home discipline;
  Amends none — 0055 §4.1's hermetic-tests bullet completed, S28's
  measurement and 0229 D4 re-read standing; Tier tests + documentation;
  premises this ruling changes: none; Category scope an 11-row table).
- 2026-11-09: enacted D1. Created `packages/auto/bunfig.toml` +
  `test/preload.ts` (the missing-file MODELS pointer, exit-cleaned; XDG
  untouched) + `test/hermetic-preload.test.ts`; `packages/auto-server/bunfig.toml`
  + `test/preload.ts` (the core's mirror) + `test/hermetic-preload.test.ts`.
  Edited `packages/auto/test/e2e.test.ts` (the module-level assignment
  retired, the two comment blocks re-taught to the preload's ownership, the
  lane-worker scene's "this module's" wording re-pointed); the fourteen
  auto-server test files (the per-file XDG line retired; five carrying
  comments re-taught as preload pointers, nine with the bare line and the
  orphaned import dropped); `packages/auto-server/test/fixtures/project.ts`
  (scrubbedEnv simplified to the OPENCODE_AUTO_* strip, its private temp and
  exit handler dead) and `worker.test.ts`'s env comment restated.
- 2026-11-09: enacted D2. Created `test/stats-schema.test.ts` (12),
  `test/engine-fx.test.ts` (7), `test/overlay.test.ts` (5), `test/clean.test.ts`
  (4); `test/lanes.ts` registered the four files (clean → repo, the other
  three → unit). Two test-side corrections during bring-up, both the tests'
  own expectations wrong against the modules' stated behavior (no src
  change): overlay's `nested.md` directory pins the conservative EISDIR
  rethrow (never a silent skip), and the merge fixtures must be
  fully-shaped records (the counters sum with plain `+=`; leniency is
  addUsage's own letter — recorded below as an observation).
- 2026-11-09: fail-before proven (see Verification); verification runs and
  bookkeeping (INDEX row 0232, ledger rows 059/063, program row 072,
  Current position) completed; committed.

## Verification (the step's close)

- auto-core `bun typecheck` exit 0. Full suite **3277 pass / 0 fail** (165
  files = the 3249/161 baseline + the four census files' 28 net-new tests).
  Four consecutive complete green runs; one earlier intermediate run (after
  the manifest fix) carried a single failure whose name was not captured
  before the following runs cleared it — it never recurred (runs 3–6 green,
  the manifest repair itself verified standalone first). The first run's
  named failure — the lane manifest's "every test file on disk is in the
  manifest exactly once" — was the step's own new files unregistered,
  repaired in-change (step 065's known requirement).
- packages/auto `bun x tsgo --noEmit` exit 0 (one round: the pin's first
  `loadModels(dir)` call missing the required `phaseTypes` — fixed to
  `loadModels(dir, { phaseTypes: [] })`, the default-env form). Full suite
  **170 pass / 8 skip / 6 fail** — the 168/8/6 baseline + the pin's 2; the
  6 fails the known pre-existing set by name (the phased-P1 e2e, fork ×2,
  remove-fork ×3).
- packages/auto-server `bun x tsgo --noEmit` exit 0 (same one-round
  signature fix). Full suite **173 pass / 1 fail** — the 171/1 baseline +
  the pin's 2; the one failure "planPrelude boundary matrix", the known
  step-050 drift by name; the observe/status-events load flakes of step
  064's note not observed this session.
- **Fail-before (the preload half)**: the pre-fix state is the files'
  absence — simulated by renaming the new bunfig.toml aside (restored
  after, verified by the green re-run). The operator scene planted at
  /tmp/072-scene (a valid registry as the env form and as
  `$XDG_CONFIG_HOME/opencode-auto/models.json`). packages/auto's pin:
  **0 pass / 2 fail** with the ambient env form (the pointer assertion red
  AND the behavioral `loadModels` half red — the operator layer read), and
  **0 pass / 2 fail** with no ambient at all (no pointer in force);
  restored, **2 pass / 0 fail** over the planted ambient form. packages/
  auto-server's pin: **2 fail** in each of the ambient XDG form, the
  ambient env form and no-ambient scenes; restored, **2 pass / 0 fail**
  over both planted forms at once.
- **Fail-before (the census half)**: by measurement at HEAD `e53dedfac` —
  zero direct test importers for stats-schema, engine/fx, overlay, clean
  (engine/sources → test/turn-sources.test.ts, step 069's); in tree one
  each (the four new suites). The behavioral pins are green on the
  unruled code — the P10 floor stated honestly: no core src file touched,
  the finding's defect is the missing test homes themselves.
- **In-change repair**: the server pin's first assertion demanded an EMPTY
  config home; the full-suite bisect (file-by-file pairing against the pin)
  found ops.test.ts — its in-process daemon spawns a real worker whose
  opencode server writes its own `opencode/` config inside whatever config
  home it finds, i.e. into the preload's temp (the redirection working as
  designed). The assertion corrected to the contract's own letter: the
  config home exists, carries no operator registry
  (`opencode-auto/models.json` absent), and the env pointer is dropped.
  Re-verified green after ops.test.ts in one process, and the fail-before
  re-proven with the corrected pin (2 fail in both no-preload scenes).
- The 0165 probe: **P4 empty** (0232 carries Derives + Category scope);
  P1's "plan file without INDEX row: 0232" cleared by the row landing; the
  remaining P1/P2/P3/P5 flags the standing pre-existing set (0193's
  seven-cell row, 0224's bare-path row, the two AGENTS.md refs, E2E_KEYS).

## Dispositions

- **0165-059 (S00-02, S3, PLAUSIBLE, TEST)** — fixed (step 072, ruling
  0232 D1): one bunfig preload per shell package owns the test process's
  registry hermeticity, each in its measured form — packages/auto's the
  0055 §4.1 AUTO-DECISION (the missing-file OPENCODE_AUTO_MODELS pointer,
  XDG real for the opt-in real-server runs), packages/auto-server's the
  core's mirror (empty-temp XDG + the pointer dropped); the fourteen
  hand-rolled per-file lines, scrubbedEnv's private temp and the e2e's
  module-level assignment retired onto the preloads (P5); the spawn side
  stays the spawn bases' own job (S28: already scrubbed); pins red pre-fix
  in every scene, green over the planted operator registry. Named
  residuals: auto's in-process ambient-switch half stays per-test (the
  suite's opt-in gates are themselves OPENCODE_AUTO_* names; no measured
  non-E2E in-process switch reader); the auto-server lane workers'
  machine-shared `/tmp/opencode-auto` lane-log default observed out of
  family, unruled (no ledger row exists for it).
- **0165-063 (S01-05, S3, CONFIRMED, TEST)** — fixed (step 072, ruling
  0232 D2): the census's four remaining modules gained their direct homes
  (stats-schema 12 tests, engine-fx 7, overlay 5, clean 4), each pinning
  its module's own stated laws; engine/sources' home is step 069's
  (0229 D4); status.ts's "no test file" note recorded with its three
  indirect importers; loop-plan/loop-phase thinness stays findings
  0177/0189/0190/0224's own step (075).
- Recorded observations (out of this step's family, no ledger row):
  `mergeModelStats`/`mergeDigestStats` sum their counters with plain `+=`
  over fully-shaped records — a partial hand-built `from` yields NaN —
  where `addUsage` is lenient by its own stated letter; in-contract (the
  merges' inputs are parsed or store-built buckets), pinned as such in the
  new suite's comment; a directory named `x.md` inside an overlay directory
  rethrows EISDIR (the conservative arm over a silent skip) — pinned
  as behavior, the module header's "any other read error rethrows" letter.

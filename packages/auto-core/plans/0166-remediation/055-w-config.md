# Step 055 — w-config: the brief-move's idempotence, sync's broken-config verdict, the committed-state writes' atomicity

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W-config, findings **0165-155** (S22-03, S3), **0165-156** (S22-04,
S3) and **0165-157** (S22-05, S3). Started 2026-11-08 at HEAD `13729880c`
(steps 001–054 done); ruled by
[../0215-config-state-crash-windows.md](../0215-config-state-crash-windows.md).

## Findings (from plans/0165-review/S22-config.md)

- **0165-155 (S22-03, S3, STATE, P6)** — fix's source/destDir→brief move
  is not idempotent across the brief→config write gap: applyFix orders the
  brief write before the config write (correct — never loses the value),
  but planKeys re-derives the brief from the config record each run and
  appendToSection appends unconditionally, so a re-run after a crash
  between the two writes duplicates the moved lines in the committed
  brief.md (the repro measured "moved line occurrences after re-run: 2").
- **0165-156 (S22-04, S3, FAIL, P12)** — sync answers a broken config.json
  with ✓ exit 0: bundleNameOfConfig swallows the load failure
  (`catch { return undefined }`), so an invalid-JSON config or a strict
  retired-key failure is indistinguishable from "intent names a plain
  pack" — the shell prints "✓ nothing to sync: … the config's intent
  names no bundle" and exits 0, while run/status/amend exit 1 over the
  same file. The register's family note names auto-server's sync row
  (S30's outstanding check).
- **0165-157 (S22-05, S3, PLAUSIBLE, STATE, P6/P12/P20)** — the config
  layer's committed-state writes are plain Bun.write, not
  write-then-rename: saveConfigRecord's own comment claims "no atomic
  write needed" because init is a full overwrite — but re-init first reads
  the baseline (loadOverwriteBaseline → readConfigRecord throws "not valid
  JSON") and fix reports the same as a *manual* finding, so a kill
  mid-write leaves state that blocks the very commands that would rewrite
  it (init/amend/fix all exit until the person hand-repairs the JSON).
  brief.md (installBriefProposal) and applySync's managed-file/sidecar
  writes share the shape. Reproduction infeasible (a single truncated
  write syscall); every consequence enumerated from the read paths.

## Plan (enactment order; each ingredient lands green)

1. Read docs/principles.md; answer the boundary per finding first (P6
   idempotent re-derivation for 155/157, P12 fail loud for 156). Verify
   157's reachability from the evidence before ruling (the read paths,
   the healing commands' own refusals). Write ruling **0215** first.
2. Check the S30 note: does auto-server carry sync's twin? (OP_DEFINITIONS
   enumerates the ops — no sync segment exists; the finding's shape
   cannot live there. runFix delegates to core planFix, which reports an
   unparsable config honestly as manual.)
3. Enact per decision; regression pins that fail on pre-fix source (the
   crash-window re-run, the broken-config verdict, the atomic-write
   shapes).
4. Full verification (`bun typecheck`, `bun test`; baseline 3172/0/155);
   packages/auto touched for D2's shell row → its typecheck + suite
   against the recorded baseline (159/8/6 with the named drift).
5. Docs lockstep (INDEX row, AGENTS.md navigation line if mapping
   changes, structure.md rows), ledger rows for 155/156/157, program
   position; single commit.

## Work log

- 2026-11-08: step record created; status table marked `doing` (starting
  HEAD `13729880c`). Read the S22-03/S22-04/S22-05 evidence, the source
  homes (config-fix.ts planKeys' move loop; sync.ts bundleNameOfConfig's
  catch and applySync's plain writes; config.ts saveConfigRecord; brief.ts
  appendToSection/installBriefProposal; protect.ts's allowWrite/reprotect
  seam and document/roles.ts DRIVER_STATE_PATHS — brief.md and config.json
  are both protected during run), the atomic-write precedents (resume.ts
  saveProgress pid+seq, tasks.ts updateUnits pid, stats.ts atomicWrite),
  the shells (auto's sync row prints plan.nothing with exit 0 and wraps
  nothing in try/catch; land/status/amend's catch + fixHint + exit 1 the
  established broken-config shape), auto-server's ops (no sync segment in
  OP_DEFINITIONS; runFix over core planFix — the S30 twin check resolves
  negative), plans/0052 D10/D11, 0100 D4/D5, 0135, 0158, 0214 and
  docs/principles.md (P6, P8, P10, P12, P20). Ruling 0215 written first.
- 2026-11-08: enactment — config-fix.ts (D1 the `sectionHolds`
  recognition — byte-exact whole-line run over the section's
  appendToSection bounds; the recognized re-run's change line "its value
  already sits …; drop the key"; `brief` returned only when an append
  changed it; D3 the move write through writeBrief), sync.ts (D2 the
  catch removed from bundleNameOfConfig, `SyncPlan` exported for the
  shell row, the header and planSync comments; D3 `writeManaged` +
  applySync through it), config.ts (D3 saveConfigRecord's tmp→rename, the
  pre-chmod retired with its EACCES story), brief.ts (D3 the exported
  `writeBrief` — the one home of the brief's whole-file writes),
  config-op.ts (D3 amend --brief through writeBrief), bundle.ts (D3
  materializeIntentBundle's writes), packages/auto/src/index.ts (D2 the
  sync row's catch: the error, the fixHint, exit 1 — land's own shape).
- 2026-11-08: test homes — config-fix.test.ts (+3: the interrupted re-run
  pin, the differently-worded floor, the move-write heal pin), sync.test.ts
  (+4: the unparsable and retired-key rejection pins, the stamped
  broken-config floor, applySync's heal pin), config.test.ts (+1: the
  inode-replacement pin with the foreign-stale-tmp floor), config-op.test.ts
  (+1: the amend --brief heal pin), bundle.test.ts (+1: the
  materialization heal pin), brief.test.ts (new, +1: the install's heal
  pin), lanes.ts (the new file's unit-lane assignment). Two in-change
  repairs: (a) the pre-existing "no stamp and a config naming no bundle"
  test's fixture reused withConfig's bundle-shaped phases key, which never
  validates in an unmaterialized project — the pre-fix green was the
  swallowed catch answering a broken config, 0165-156's own scene; the
  fixture now writes a loading config naming a plain pack; (b) the first
  .auto-tmp draft left the workdir's directory behind after init, breaking
  the shell's force-close footprint pin ("the lock … removed empty on
  release" — the lock's rmdir keys on createdDir); every writer gained the
  best-effort empty-rmdir tail, the pins asserting the stronger footprint
  (no .auto left), the ruling's D3 amended to state it.
- 2026-11-08: fail-before proof over /tmp/055-fixed (the six changed core
  src files backed up, `git show HEAD:./` pre-fix versions swapped in,
  the pins run, the fixed files restored and cmp-verified byte-identical);
  full verification; docs lockstep (the 0215 INDEX row + the 0100 D5
  annotation, the AGENTS.md config-fix/brief/provenance-sync navigation
  lines, the structure.md Project config/Config fix/Bundle sync/Project
  brief rows); the program status/ledger/position updated; committed.

## Verification

`bun typecheck` exit 0; auto-core full suite **3183 pass / 0 fail** (156
files = the 3172/155 baseline + 11 net new and the new test/brief.test.ts,
zero regressions). Fail-before proof over /tmp/055-fixed: **8 pins red on
pre-fix source** —

- D1 (1 pin): the interrupted re-run's `writes` received
  `[BRIEF, CONFIG]` — the duplicated append re-fires — where `[CONFIG]`
  is expected (the finding's own repro shape: the moved block appended
  twice on re-run).
- D2 (2 pins): `planSync` RESOLVED over the broken config (the
  `rejects.toThrow` assertions fail — the swallowed catch answering the
  green nothing), for both the unparsable-JSON and the strict
  retired-key shapes.
- D3 (5 pins): the read-only stand-ins (a killed run's stale protect bit)
  all threw EACCES out of the pre-fix in-place writes — the fix move's
  brief write, applySync, materializeIntentBundle,
  installBriefProposal — and saveConfigRecord's pin received the same
  inode (an in-place write where the replacement is expected).

The floors green on pre-fix source (the differently-worded value still
appending, the stamped project syncing over a broken config untouched,
the honest nothing-path, the foreign-stale-tmp tolerance, and every
other pre-existing test of the touched files). Shells: auto typecheck
clean, **159 pass / 8 skip / 6 fail** — the exact recorded baseline (the
five pre-existing fork/remove-fork failures plus the "roadmap-driven
establishment" e2e drift, every name identical); auto-server typecheck
clean, **142 pass / 2 fail** (a guard run — no auto-server source
touched; the two step-050 drift names verbatim: "planPrelude boundary
matrix", "malformed requests").

## Dispositions

- **0165-155 (S22-03, S3)** — fixed (ruling 0215 D1): the move recognizes
  its own landed block byte-exact; the interrupted re-run plans the
  config write alone with a truthful change line; the third run the
  ordinary clean no-op. Named residuals: the recognition covers the
  block, not the section's history (a person holding both their wording
  and the canonical block keeps both).
- **0165-156 (S22-04, S3)** — fixed (ruling 0215 D2): the load failure
  propagates; the auto shell's sync row answers the config-command
  family's exit 1 with the fix hint; the honest nothing-path
  byte-identical; a stamped project never reads the config. The
  register's S30 auto-server twin note checked negative (no sync segment
  in OP_DEFINITIONS; runFix delegates to core planFix) — nothing to fix
  there, the guard run confirming its baseline.
- **0165-157 (S22-05, S3 PLAUSIBLE)** — fixed (ruling 0215 D3), the
  reachability verified from the read paths before ruling (init's
  loadOverwriteBaseline, fix's manual "not valid JSON", run/status/amend
  exit 1 — every healing command refusing to heal): saveConfigRecord,
  the brief's three whole-file writers (one `writeBrief` home), applySync
  and materializeIntentBundle all write-tmp-then-rename, the tmp riding
  `.auto/` (never-dirt by 0141's law) with the empty-rmdir tail keeping
  the footprint. Named residuals: the append-only .gitignore writes, the
  opencode.json/agent-contract template writes (unmeasured by 0165), the
  six pre-0215 .auto-resident atomic writers (migration on their own next
  touch), the exotic cross-device mount (EXDEV fails loudly), the stale
  foreign-pid tmp never swept, the crash window itself unpinnable (the
  finding's own statement — the inode/read-only stand-ins the oracle).
- Premise guard: 0100 D5 re-read and its INDEX row annotated in the same
  change; 0052 D10 and 0209 D2 re-read, standing unannotated
  (completions, not premise changes).
- Commit: the step's single coherent commit (subject "0166: step 055
  done — ruling 0215 …", finding ids in the body's trailing
  parenthetical); the SHA recorded in the program table's row by the
  next step's start HEAD convention.

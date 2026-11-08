# Step 069 — wa-switch-census

Wave WA-docs · findings 0165-197 (S14-07), 0165-200 (S17-09) · status:
**done** 2026-11-09 · start HEAD `60d74d936` (commit: this step's own).

## Scope (the findings' families)

Two documentation-truth findings of the same WA-docs accuracy family
(0227 D1's rule the standing case law), one with a test-home obligation:

- **0165-200 (S17-09, S4, CONF, DOC, P13/P8/R6)** — the switch census. Of
  the six names S01-04 counted as undocumented, two are tombstones
  (`HANDOVER_CONCURRENT`, `TASK_CONTEXT` — self-documenting via the
  run-start notice), two are opencode's own flags the X1 scrub deliberately
  passes (`SHARE`, `HEAP_SNAPSHOT` — never parsed by the driver), two were
  live switches documented nowhere (`FORK`, `SYNTHESIS_TIMEOUT`). Beyond the
  six, most parsed switches lived only in core design docs. No dead switch
  (P21 clean, the finding's own verdict); the gap is the person-facing
  reference — the operator learns STEP/HIBERNATE and the emergency exits
  (REGRESSION, DOC_LANES, PARK, SYNTHESIS, REMEDIATE) only from core docs.
  Remedy: one switch table in the CLI README pinned against `SWITCH_ENV` +
  `RETIRED_SWITCHES`, with a census test like agent-env.test.ts's prefix
  check.
- **0165-197 (S14-07, S4, CONF, DOC, 0061 §4.3/§4.4)** — the engine I/O
  contract truth. `contract.ts:8`'s "All I/O goes through the TurnFx" is
  false four measured ways: the classifier ask's model call
  (recovery.ts:86 — its answer re-enters as the synthetic `answer` input,
  so replay holds), the questions concern's `emitStatus` journal writes
  (questions.ts:37-41), the router's `noteWindows` log line (windows.ts:18)
  and the cache-claim arming (step-up.ts:63). TurnContext's "immutable
  per-turn facts" carries the mutable cross-turn `TestRun` the test concern
  writes (`test.pending`, `resumeWrapup`, test.ts:186/209). And fx.ts /
  sources.ts have no direct suite — their invariants ride the trace/replay
  scenarios, two uncovered: answerWith-before-attach and a late probe
  verdict after detach. Impact: none at runtime today; a reader trusting
  the seam claim assumes the audit or the replay covers effects they never
  see.

## Plan (before editing)

1. Ruling **0229** written first (next free number verified by `ls plans/`
   — 0228 the last). Answer the boundary from docs/principles.md first
   (P13/P8/P19/P12/P5/P21 for the census; P12/P18 + 0227 D1's docs-accuracy
   rule for the seam truth; "a requirement names its test home" for the two
   sources cases). 0165 evidence, not authorization; Category scope
   enumerated; premises named.
2. Enact the census (0165-200): a new `### Experiment switches
   (OPENCODE_AUTO_*)` section in `packages/auto/README.md` (the shell's own
   person-facing home, after the registry env table) — the complete parsed
   table (name/default/governs), the retired names as notices, the
   non-switch env names (MODELS/SERVER) and opencode's own two flags stated
   as never the driver's; the census ratchet in
   `packages/auto/test/docs-truth.test.ts` (the 0227 docs-truth pattern,
   shell-side over its own README, the registries imported through the
   declared subpath seam): every parsed name present, every retired name
   present, defaults live-checked against `formatSwitches(parseSwitches(
   {}))`, and no `OPENCODE_AUTO_*` token in the section that is neither
   parsed, retired nor one of the four stated non-driver names (the R6
   dead-literal half). One teaching line in `src/switches.ts`'s registry
   comment (generic — the core names no shell): the person-facing table and
   its census follow the registry; a new switch lands its row in the same
   change.
3. Enact the seam truth (0165-197): `src/engine/contract.ts`'s header
   restated — the fx is the audited seam for the effects the arbitration
   orders; the four out-of-seam effects named each with its reason;
   TurnContext's comment marks `test` as the mutable cross-turn protocol
   record; `src/engine/fx.ts`'s "the one I/O path of a turn" header line
   restated in lockstep (same wrong family, 0227 D1's category
   completeness); `docs/structure.md`'s "Turn fx and sources" row carries
   the same restatement.
4. Enact the two sources cases (0165-197's test-home half): new
   `test/turn-sources.test.ts` over `makeTurnSources` with the
   scenarioClock fixture — the live shape (fire → one probe emission, the
   timer re-armed, cleanup cancels), answerWith-before-attach throws, and a
   probe verdict resolving after the cleanup is dropped (no emission, no
   re-arm). Registered in `test/lanes.ts` (unit lane).
5. Byte-identical runtime behavior everywhere (comment/doc/test changes
   only); fail-before proofs over /tmp/069-fixed (the census red on HEAD's
   README — the section absent; the sources cases red at the file level);
   `bun typecheck` + full `bun test` in auto-core; the auto package's
   suite (README touched) — `bun test` there against its 162/8/6 baseline.
6. INDEX row 0229 (6-cell); AGENTS.md navigation only if a mapping
   genuinely changes (expected: no — no module moves, no responsibility
   shifts); program bookkeeping; one commit.

## Execution log

- 2026-11-09 (delegated worker): step opened at HEAD `60d74d936` (verified
  `git log -1 --format=%h`, tree clean). Evidence read: the two register
  rows + the S14-07 record (S14-engine.md) and S17-09 record
  (S17-models.md) with S01-04 (the originating probe census); the owning
  code at HEAD — `src/engine/contract.ts` (the header claim, TurnContext),
  `src/engine/concerns/{recovery,questions,windows,step-up,test}.ts` (the
  four out-of-seam effects, the TestRun writes), `src/engine/sources.ts`
  (the two uncovered invariants), `src/engine/fx.ts` (the twin header
  claim), `src/switches.ts` (SWITCH_ENV, RETIRED_SWITCHES, SWITCH_DEFAULTS,
  formatSwitches), `src/agent/env.ts` (AGENT_FLAGS), the README's current
  OPENCODE_AUTO_* mentions, `packages/auto/test/docs-truth.test.ts` (the
  0227 pin pattern), `test/fixtures/turn-trace.ts` (scenarioClock),
  `test/lanes.ts`. Census re-measured at HEAD (P19): 24 parsed switches, 13
  in README prose, 11 nowhere person-facing (the finding's "STEP absent"
  and "FORK/SYNTHESIS_TIMEOUT live nowhere" drifted — STEP, FORK,
  FORK_BASE and DECOMPOSE_FINE gained prose mentions since the review; the
  finding's shape — no one reference table — stands).
- 2026-11-09: ruling **0229** written first (next free number verified —
  0228 the last; Derives P13/P8/P19/P12/P5/P21 with showings, Amends none,
  Tier documentation-and-tests, premises this ruling changes: none with six
  re-reads — 0061 §4.3/§4.4, 0035, 0059 X1/0157 D4, 0225 D3, 0227 D1,
  0221's docs-pin pattern; Category scope a 12-row table; 0165 evidence,
  not authorization). Enacted in order: D1 the README section (after the
  registry chapter's env table) + the registry teaching line, D2 the census
  ratchet (six tests, the defaults live-derived from
  formatSwitches(parseSwitches({})) — one mid-write shape fix: bun's
  expect message arg needs the non-null cells, tsgo caught it), D3 the
  boundary statement in contract.ts's header + TurnContext's cross-turn
  note + fx.ts's header line + structure.md's row, D4 the sources suite
  (four tests over scenarioClock; one mid-write type fix: the attach
  cleanup is optional on the TurnSources type, a settled default suffices)
  + the lanes.ts unit-lane row. INDEX row 0229 landed; AGENTS.md held (no
  module → responsibility mapping changed — the ruling's Category scope
  records the hold with reason). Verification green against both baselines;
  fail-before proofs over /tmp/069-head; dispositions and program updates
  in the same commit.

## Verification (the step's close)

- auto-core: `bun typecheck` exit 0; full suite **3244 pass / 0 fail**
  (160 files = the 3240/159 baseline + the turn-sources file's 4 tests).
- packages/auto (README + docs-truth touched): `bun x tsgo --noEmit` exit 0;
  full suite **168 pass / 8 skip / 6 fail** (the 162/8/6 step-067 baseline +
  the census's 6 tests; the 6 fails the pre-existing set by name — the
  phased-P1 e2e, the two fork cases, the three remove-fork cases, step 067's
  own "reproduced pre-existing at a detached HEAD worktree" record; nothing
  new, nothing moved).
- Fail-before over /tmp/069-head (HEAD's bytes via `git show`, the fixed
  README backed up, swapped, tested, restored, cmp-verified byte-identical):
  the census **5/5 README-dependent tests red** on HEAD's README (the
  section absent; the sixth test — registry↔census counts — registry-internal
  and correctly green at both states); the **0165 probe's P5 at HEAD flags
  exactly the finding's six names** (FORK, HANDOVER_CONCURRENT,
  HEAP_SNAPSHOT, SHARE, SYNTHESIS_TIMEOUT, TASK_CONTEXT — S17-09's census
  verbatim) and the code-side arm is **empty** at the fix; the engine's
  retired wordings 3/3 present at HEAD ("All I/O goes through the TurnFx",
  "the one I/O path of a turn", TurnContext's exception-less "Immutable
  per-turn facts") and the boundary statements 3/3 absent; the two test
  homes absent at HEAD (file-level: `git show HEAD:…` errors for both).
- The 0165 probe: **P4 empty** (0229 carries Derives + Category scope);
  P1/P2 the standing pre-existing set (the 0193 seven-cell row, the 0224
  bare server path); P5's doc-side flag (OPENCODE_AUTO_E2E_KEYS — the e2e
  harness's own variable, read by tests not src) pre-existing, unchanged.
- Byte-identical runtime behavior: the src changes are comment text only
  (contract.ts, fx.ts, switches.ts); no golden, no output line moved.

## Dispositions

- **0165-197 (S14-07)** — fixed (step 069, ruling 0229 D3+D4): the seam's
  boundary stated where the false claim stood (contract.ts's header — the
  fx the audited seam of the effects the arbitration orders, the four
  out-of-seam effects named with reasons), the twin claim in fx.ts's header
  and structure.md's row restated in the same change (0227 D1's category
  completeness), TurnContext's `test` marked the mutable cross-turn
  protocol record, and the two uncovered sources invariants given their
  suite (test/turn-sources.test.ts: the live single-flight shape with the
  cleanup cancel, answerWith-before-attach throws, a late probe verdict
  after the cleanup dropped — no emission, no re-arm; plus the synthetic
  answer emission). No behavior change ruled or made — the four effects are
  the design, now stated.
- **0165-200 (S17-09)** — fixed (step 069, ruling 0229 D1+D2): the
  person-facing switch reference — one `### Experiment switches
  (OPENCODE_AUTO_*)` section in packages/auto/README.md (the 24-row parsed
  table with defaults exactly the registry's render, the four retired
  tombstones as notices, MODELS/SERVER as the env-only registrations,
  SHARE/HEAP_SNAPSHOT as opencode's own the driver never parses), the
  registry comment's teaching line (the table and its census follow
  SWITCH_ENV/RETIRED_SWITCHES; a new switch lands its row in the same
  change), and the census ratchet in packages/auto/test/docs-truth.test.ts
  (every parsed name present, every retired name present, no
  registry-unowned OPENCODE_AUTO_* token — the R6 dead-literal half — and
  every stated default the registry's own live render). The probe's P5
  code-side arm closed (the finding's six names verbatim → empty). The
  daemon.md switch table deliberately deferred (S31's cross-reference row,
  the ruling's Category scope names the deferral); the MANUAL untouched (a
  second copy would be the mirror P5 forbids).


# Step 067 — wa-docs-accuracy

Wave WA-docs · findings 0165-064 (S3), 0165-086 (S3), 0165-207 (S4), 0165-213 (S4),
0165-215 (S4), 0165-216 (S4), 0165-217 (S4), 0165-221 (S4), 0165-222 (S4) · status:
**done** 2026-11-09 · start HEAD `696966685`.

Plus the step-066 handoff: the glossary's package section lacks an `auto-server` row
(ruling 0226's Residuals name this step's family — server docs — as its owner).

## Scope (the findings' one family)

Docs accuracy across the three packages — every finding is the same shape: a
documentation or comment surface that stopped tracking the code it describes. No
behavior changes; the two e2e assertions that pin a reworded refusal/teaching line
move in lockstep with the ruled text (P13's conscious one-change rule).

- **0165-064 (S3)** — shell-contract §A names a nonexistent core module (`server`),
  the auto row omits clarify/fork/remove-fork/release/driver-helper (13 of 18
  subcommands), §C claims `CONTRACT_FILE` is exported (a module-internal const);
  auto/AGENTS.md's Overview list carries the same 15-of-18 omission and its amend
  row still names the retired brief stub.
- **0165-086 (S3)** — the CLI README's parallel contract predates 0099/0125/0126/0151:
  the level coupling ("requires the `parallel` level", "without a level it is a usage
  error"), tier 0 taught as serial task sessions (doc lanes run concurrently by
  default), `--repair` taught serial-only (0211 D3's no-lane-in-flight boundary),
  the lane branch taught digest-less (`auto-lane/<task-id>`), `/exit` taught as a
  scheduling stop at width (no /exit channel exists there).
- **0165-207 (S4)** — reset's header claims "restoring the worktree to the
  uninitialized state" while a materialized intent bundle's files (the pack/mode/
  phase files, provenance.json) survive reset; the same overclaim rides the CLI's
  reset texts (the family the finding names).
- **0165-213 (S4)** — index.ts's KNOWN_COMMANDS comment says "the public sixteen"
  (18 rows); the `-f` refusal teaches "an init/reset/fix option" while sync accepts
  the flag too (its own OPTION_HELP row says "shared by init, reset, fix and sync").
- **0165-215 (S4)** — README's reset table teaches the retired brief rule ("deleted
  only when byte-identical to the project brief stub"); reset keeps it
  unconditionally.
- **0165-216 (S4)** — README's retirement row says the `continue` notice points at
  `plan`; the notice names `transfer`.
- **0165-217 (S4)** — MANUAL's cheat sheet omits fork, remove-fork and driver-helper
  (15 of 18 public commands).
- **0165-221 (S4)** — three auto-server comments older than the shipped surface; at
  HEAD only ops.ts's 501 parenthetical ("the models probe is not exposed") survives
  — worker.ts's phasesLine comment was rewritten by the 0193 banner work and
  profile.ts's agentRecovery rationale states fix as a live operation (verified at
  HEAD; recorded, not re-changed).
- **0165-222 (S4)** — daemon.md's honestly-absent list omits `release` and
  `install-prompts`.
- **Handoff** — the glossary's Repository-and-packages section lacks the
  service-shell row (0226 Residuals).

## Plan (before editing)

1. Ruling **0227** written first (next free number verified by `ls plans/`) — one
   docs-accuracy ruling over all nine findings plus the handoff: the per-surface
   truth each doc owes, the boundary statements (reset's bundle survival, repair's
   no-lane-in-flight rule, width activation), the lockstep moves for the pinned
   e2e assertions, and the pins. Wave WA-docs: 0165 is evidence, not authorization.
2. Enact auto-core: `docs/shell-contract.md` (§A mechanism list minus `server`, the
   auto row's 18 subcommands, §C's CONTRACT_FILE truth), `src/reset.ts` header (the
   bundle boundary), `docs/glossary.md` (the service-shell row).
3. Enact auto: `src/index.ts` (the eighteen comment, the -f refusal's sync, the
   reset summary/extended-help/completion-line boundary wording), `README.md` (the
   parallel rows, the reset table row, the retirement pointer, the reset prose),
   `AGENTS.md` (the 18-command list, the amend row's brief wording), `MANUAL.md`
   (the three cheat-sheet rows, the reset row's boundary).
4. Enact auto-server: `src/ops.ts` (the 501 parenthetical), `docs/daemon.md` (the
   two honestly-absent rows).
5. Pins per the 0225/0226 docs-pin pattern, one in each owning package:
   auto-core `test/docs-truth-reconciliation.test.ts` (+ its `test/lanes.ts` row),
   auto `test/docs-truth.test.ts`, auto-server `test/docs-truth.test.ts`; the two
   e2e lockstep moves in `test/e2e.test.ts`. Fail-before over `/tmp/067-head`
   (HEAD's bytes via `git show`).
6. INDEX row 0227; AGENTS.md navigation only if a mapping genuinely changes (none
   does — docs truth only); program bookkeeping; commit.

## Execution log

- 2026-11-09 (delegated worker): step opened at HEAD `696966685` (verified
  `git log -1`). Evidence read: the 0165 register rows + the S01/S05/S22/S26/S28/S31
  records; step 066's record and ruling 0226's Residuals (the handoff); the owning
  code at HEAD — `src/config-fix.ts` (`CONTRACT_FILE` a const), the CLI `COMMANDS`
  table (18 rows), `SYNC_FLAGS`/`OPTION_HELP` (force shared by init/reset/fix/sync),
  `src/loop-preflight.ts` (0125's ℹ note, the width refusals, the human-surface
  comment), `src/lanes.ts` (`laneBranch`'s digest grammar), reset.ts's whitelist,
  auto-server's ops/worker/profile comments, daemon.md's absent list.
- 2026-11-09: ruling **0227** written first (Derives P18/P19/P13/P8, Tier
  documentation, premises this ruling changes: none — every restated ruling re-read,
  restated not amended; Category scope enumerated; 0165 evidence, not authorization).
  Two scope findings from the survey recorded in the ruling: 0165-221's worker.ts and
  profile.ts halves already healed at HEAD (0193's banner rewrite; the standing
  agentRecovery rationale — fix stated as a live operation), only ops.ts's 501
  parenthetical live; and two CLI help tails carried the same retired clauses the
  findings measured in the README (--tree-lanes' tier-0 "task sessions run serially",
  --repair's "serial runs only" — 0125/0126 reworded the two help strings they named
  and left these), ruled in by D1 item 2 (category completeness); index.ts's second
  "brief stub" mention (line 2546, beside the AGENTS.md one the finding named) and
  README's treeLanes config row joined the same families. Enacted in order:
  auto-core (shell-contract §A/§C, reset.ts's header, the glossary row), auto
  (index.ts's five text sites, the two e2e lockstep moves, README's eleven rows,
  AGENTS.md's two rows, MANUAL's four rows), auto-server (ops.ts's parenthetical,
  daemon.md's two rows), the three pin files + the lanes.ts row, the INDEX row
  (its code-homes cell immediately repaired to fully-qualified paths after the
  0165 probe flagged the bare `test/e2e.test.ts`/`docs/daemon.md` as new P2 entries
  — back to the standing set, none added). Fail-before proven before the
  bookkeeping; verification green against all three baselines; dispositions and
  program updates landed in the same commit.

## Verification (the step's close)

- auto-core: `bun typecheck` exit 0; full suite **3221 pass / 0 fail** (159 files =
  the 3218/158 baseline + the pin file's 3 tests, 10 expects).
- auto: `bun typecheck` exit 0; full suite **162 pass / 8 skip / 6 fail** (the
  159/8/6 baseline + the pin file's 3 tests). The 6 failures (the fork/remove-fork
  e2e pair and the phased-P1 e2e) verified **pre-existing at HEAD**: reproduced in a
  detached `git worktree` at `696966685` (bun install isolated there, worktree
  removed after) — the same fork family fails identically without this step's
  changes. The two moved e2e assertions (the -f refusal, the reset completion line)
  pass against the new texts.
- auto-server: `bun typecheck` exit 0; full suite **171 pass / 1 fail** in the
  stable set (the 168/1 baseline + the pin file's 3 tests; "planPrelude boundary
  matrix" the known drift). Two load flakes came and went across the three full runs
  (the observe e2e and the status-events live fixture) — both pass in isolation;
  the same observe flake is on record from step 064 (0165-220, step 073's repair).
- Fail-before proof over `/tmp/067-head` (HEAD's pre-fix bytes extracted read-only
  via `git show`, the three pin files' tables mirrored and evaluated against them):
  **33/33 truth pins red, 15/15 retired wordings still present** — the exact state
  the findings measured (the phantom `server`, the 13-of-18 lists, the level-coupled
  parallel rows, the serial-only repair texts, the digest-less branch, the /exit
  scheduling stop, the public-sixteen comment, the three-owner -f refusal, the
  stub-identical brief row, the plan pointer, the probe-not-exposed clause, the
  absent release/install-prompts rows, the missing glossary row, the
  uninitialized-state claims). Working-tree pins green (core 3, auto 3, server 3).
- The 0165 probe: **P4 empty** (ruling 0227 carries Derives + Category scope);
  P1 (the 0193 INDEX row), P2 (the 0224 test-path flag) and P3 (the
  placeholder-class refs) identical to the standing pre-existing set, none added —
  the one new P2 flag the first probe run showed (the 0227 row's bare paths) was
  repaired in this change by fully qualifying the code-homes cell.

## Dispositions

- **0165-064 (S01-06, S3)** — fixed (ruling 0227 D2): shell-contract §A's mechanism
  list drops the phantom `server` (every other name verified a real src module), the
  auto row carries all 18 subcommands in COMMANDS table order, §C states
  `CONTRACT_FILE` as config-fix's module-internal constant; auto/AGENTS.md's
  Overview list carries the 18, its amend row's "the brief stub" retired for 0081
  D11's channels; pinned fail-red at HEAD.
- **0165-086 (S05-09, S3)** — fixed (ruling 0227 D3, category-complete per D1
  item 2): README's parallel contract restated from 0125 (width alone activates, a
  ℹ note never a refusal — both the `parallel` config row and the `--max-sessions`
  row), 0126 (doc lanes at tier 0 in the section intro, the tier-0 bullet and the
  treeLanes config row; the level the code-depth and posture key), 0211 D3 (the
  `--repair` row's no-lane-in-flight boundary, never serial-only), 0151 D2 + 0191
  D5 (the lane branch's realpath digest), 0068 D11 (no /exit channel at width; step
  mode a pause, never a scheduling stop); the two CLI help tails (--tree-lanes'
  tier-0 clause, --repair's serial-only tail) moved with them; pinned fail-red at
  HEAD.
- **0165-207 (S22-06, S4)** — fixed (ruling 0227 D3): reset.ts's header states the
  boundary — the whitelist is the boundary, a materialized bundle's landed files
  (0079 §3, 0100's sidecar) person-owned once landed and surviving by the same
  rmdir-if-empty mechanism that protects prompts/; the same claim retired across the
  CLI's reset texts (summary, extended help, the completion line, the command-block
  comment) and README's usage row and section prose, the bundle named in README's
  preserves sentence and the CLI's extended help; S22-06's optional keep-rows arm
  declined (a behavior change no ruling makes — P21); pinned fail-red at HEAD.
- **0165-213 (S26-05, S4)** — fixed (ruling 0227 D2): the KNOWN_COMMANDS comment
  says "the public eighteen" (18 rows, verified); the -f refusal and its comment
  teach init/reset/fix/sync (the OPTION_HELP force row's own set); the two e2e
  assertions moved in lockstep; pinned fail-red at HEAD.
- **0165-215 (S28-01, S4)** — fixed (ruling 0227 D3): README's reset table brief
  row to the keep rule (kept unconditionally, the channels named, delete by hand) —
  the retired stub-identical deletion rule never fires; pinned fail-red at HEAD.
- **0165-216 (S28-02, S4)** — fixed (ruling 0227 D3): the retirement row's continue
  notice points at `transfer` with the notice's own clause; pinned fail-red at HEAD.
- **0165-217 (S28-03, S4)** — fixed (ruling 0227 D2): MANUAL's cheat sheet carries
  fork, remove-fork and driver-helper (wording from README's rows, cheat-sheet
  compression) and its reset row states the boundary; pinned fail-red at HEAD.
- **0165-221 (S31-01, S4)** — fixed (ruling 0227 D4): ops.ts's 501 parenthetical
  drops the probe-not-exposed clause (the probe served since P4b — the module's own
  header and daemon.md's corrected 501 row the truth); worker.ts's and profile.ts's
  halves verified healed at HEAD by later rulings' enactments (0193's banner
  rewrite; the standing agentRecovery rationale stating fix as a live operation and
  re-judging the value) — recorded in the ruling, not re-changed; pinned fail-red at
  HEAD.
- **0165-222 (S31-02, S4)** — fixed (ruling 0227 D2): daemon.md's honestly-absent
  list gains `release` and `install-prompts` beside the five standing rows; pinned
  fail-red at HEAD.
- **The 0226 handoff** — fixed (ruling 0227 D2): the glossary's package section
  carries the service-shell row (服务壳 / service shell /
  `packages/auto-server`, bin `opencode-auto-server`) beside the general/simple
  shells, the term shell-contract §A itself uses; 0226's residual discharged.

Residuals (the ruling's named list): the pins name today's truths and must move
with the next vocabulary change (they do not mechanize completeness); README's
parallel section keeps its measured architecture (the false claims repaired, no
rewrite ruled); 0226's other residuals stand. Standing program residuals
unchanged (0126's imprecision step 080; the resumed-chain count restart 0168 D2;
the v0.3.0 tag the maintainer's act step 081; 0169 D4's forged-mark residual;
0170 D4's cross-task/index-tick residuals; the lane-landing receipt rewrite;
S10-02's e2e regression deferred; 0171's–0226's named residuals).

Step done 2026-11-09. Ruling 0227 active-authority; the INDEX row, the ledger
rows, the status row and the program's current position land in this step's
commit.

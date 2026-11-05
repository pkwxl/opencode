# 0159 — the CLI shell: option policy and documentation truth — a typo never silently starts a run, and the help is the code's word

Ruled from the 2026-10-30 three-package review of the auto tool family (its CLI-shell pass; every
finding re-verified against HEAD 11f2a9109 before the change). The review measured the shell against
its own stated invariant — `src/index.ts`'s "every flag outside its command's policy below is an
error with exit 1, so a typo is never silently ignored" — and found the invariant twice falsified by
omission and once by parse shape; the same pass measured the usage text and the user documents
against the code and found five passages teaching mechanisms the code had retired.

## The measurement (the three option-policy holes, the help outlier, the doc drift)

- **plan never refused the lane value flags.** `refuseLaneValueFlags(command: "run" | "transfer")`
  exists with the right rationale (each of `--unit`/`--merge` "swallows the next token as its value
  (the directory would be eaten)"); run and transfer call it beside `refuseCloseFamilyFlags`, but
  the plan block — which shares their option machinery through `refuseFrozenFlags` /
  `refuseRunOptions` — never picked the check up. Verified by execution: `plan <dir> --unit T-001`
  and `--merge auto-lane/T-005` sail into a real planning dispatch with the flag silently dropped.
- **`--from-bundle` passed the global whitelist for every command.** It sits in `BOOLEAN_FLAGS`, so
  `KNOWN_FLAGS` accepts it everywhere, but only `sync` consumes it; `init` refused it with a pinned
  pointer, fix/reset/models and the flagless/close/land families refused it through their narrow
  sets — and run, plan and transfer had no refusal at all. Verified: `run <dir> --from-bundle`
  starts a full run (the token-spending kind) with the flag silently ignored.
- **`--probe` was not a real boolean.** Unlike every other boolean, `probe` was absent from
  `BOOLEAN_FLAGS` and read by bare presence (`if (flags.has("probe"))`), so `models --probe=false`
  set the flag with the value `"false"` and ran the probe — which "starts agents … and costs tokens"
  per the help — against the person's explicit opt-out; and since a non-BOOLEAN flag never swallows
  a following `true`/`false`, `models --probe true <dir>` left `"true"` as `positional[0]`, the
  directory resolving to `./true` and the intended directory silently ignored. (Joining
  `BOOLEAN_FLAGS` also puts `probe` on the global whitelist, which without a refusal would have
  opened a fourth hole on run/plan/transfer — the widening and the refusal are one lockstep.)
- **The help's EXIT_CODES omitted exit 3.** `/exit` under `--interactive`, converted at a safe
  boundary by the core (`src/exit.ts`, plans/0143), was documented in README and MANUAL but absent
  from the help text — "the one source of the usage text" — and from the core AGENTS.md exit-codes
  line: one vocabulary, three surfaces, two of them behind.
- **README/MANUAL drift on two retired mechanisms.** init's brief stub (retired by 0133 D9 — the
  analysis flow owns the start) was still taught by README's init-options tail ("init writes the
  project brief stub when the file is missing … edit it directly") and MANUAL §1 ("and the project
  brief stub … **Fill in the brief**"), each contradicting its own file's correct rows elsewhere;
  `amend --phases` (retired outright by 0137 — the config key is init-stamped machinery, the roadmap
  line the one reshape channel) was still taught by README's amend section (listed among amend's
  options, "runs only the read-only prefix guardrail … left as drift for plan to re-sync") and
  MANUAL's reshape passage ("a config-governed round by `amend --phases`", mid-phase refusal and
  all) plus the cheat sheet's "`--phases` at a boundary reshapes the round's unstarted tail". The
  amend **help row** carried the same pre-0137 story — and the amend section omitted three live
  channels (`--intent`, `--isolate`, the `--brief`/`--brief-file` revision).

## D1 — the refusals: plan joins the lane refusal, the owned-flag rows, probe a boolean

- `refuseLaneValueFlags` widened to `"run" | "plan" | "transfer"` and called in the plan block
  beside its option-machinery siblings — same pointer text, exit 1.
- **Two owned-flag rows**: `--from-bundle` (owner `sync`) and `--probe` (owner `models`) join
  `OWNED_FLAGS` — the file's existing mechanism for exactly this shape ("flags one command owns:
  every other command refuses them with a pointer at the owning invocation"), firing ahead of the
  whitelist, so one row covers run, plan, transfer, `_lane` and every future command at once. The
  sync row names the consumer and the materialization channel ("a bundle itself is materialized by
  `init --intent` alone" — init's teaching, now generic); the models row names the cost reason.
  init's pinned `--from-bundle` pointer entry retired as dead wording (the owned row answers first).
- **`probe` joins `BOOLEAN_FLAGS`** and the models block reads it `!== "false"` like every other
  boolean: `--probe=false` (and `--probe false`) runs no probe; `--probe true <dir>` swallows the
  `true`, and the directory resolves. The models synopsis and help row document the `=false` form
  per the file's convention.

## D2 — the enumeration guard and the uncovered commands

- **No test enumerated the vocabulary — exactly why D1 could land silently** (the existing test
  spot-checked run/transfer only). The new guard derives the flag vocabulary from the parser's own
  constants in `src/index.ts` (read from source — `VALUE_FLAGS`/`BOOLEAN_FLAGS` tokens,
  `RETIRED_FLAGS` keys, the whitelist line's literal extras — never hand-copied, so a flag added
  there joins the enumeration with no one remembering), declares each of run/plan/transfer's
  consumed sets (the commands' public option policy, changed only in the same change as the parser),
  and asserts every other flag exits 1 with a refusal naming it. The refusals fire in argument
  policy before any directory work, so the ~165 cases share one empty temp dir, never write, and
  run in small concurrent batches (≈2 s).
- **The help table's own integrity**: every `COMMANDS[].options` key must exist in `OPTION_HELP`
  (or be `"frozen"`) — `renderCommandHelp`'s non-null assertion would otherwise print a literal
  `undefined` paragraph; a static source check, no subprocess.
- **Three public commands the shell suite had never driven**: clarify's whole exit mapping through
  the shell row (released 0 / held 2 — nothing awaiting, problems holding, already released — /
  error 1, an unreadable phase index) beside its flagless, missing-config and live-lock refusals;
  driver-helper's six-block render and its unloadable-config refusal; install-prompts's
  uninitialized refusal, its happy path and the never-delete-extra invariant.

## D3 — documentation truth

- **EXIT_CODES gains exit 3** (`/exit` under `--interactive`, paused at a safe boundary, rerunning
  recovers) in the help string; the core AGENTS.md exit-codes operational line gains the same
  clause — one vocabulary across help, README, MANUAL and the invariants line (P13's lockstep).
- **The brief-stub story corrected** in README (init-options tail; the reset row's "a seed" aligned
  with the CLI's own reset row: "an installed approved proposal or a person's `amend --brief`
  write") and MANUAL §1 (what it writes: no brief, nothing under docs/; the analysis flow proposes
  and the release installs).
- **The amend story corrected everywhere it was stale**: README's amend section (the options list
  drops `--phases` and gains `--intent`, `--isolate` and the `--brief`/`--brief-file` channel, the
  prefix-guard clause retired with the flag, the "What it writes" bullet never mentions drift
  again), the amend help row (the 0137 retirement, the brief channel carried), MANUAL's reshape
  passage (the roadmap line the one channel, an uncovered round covered the moment its line exists,
  `amend --phases` refuses outright) and the cheat sheet's amend row; README's compatibility row for
  the lane flags now names plan beside run/transfer/init.
- No other load-bearing drift found: the review's verified-accurate rows (parallel lanes/tiers,
  lane-log-dir, interruption recovery, key rings `/failback`, auto-number, clarify, sync, release)
  were left untouched.

## The named residuals (deferred, standing)

- Extra positionals are still silently ignored (e.g. `plan a b --scaffold` runs on `a`); the
  review's sketch of a "one directory" refusal is a behavior change beyond truth-restoration, its
  own small ruling.
- `fix --dryrun`'s exit 1 on manual findings (beside info's exit 0) remains a documented deviation
  from "exit 1 = usage/environment" — recorded here, not changed.
- `packages/auto/AGENTS.md`'s transfer row still says the amend row "calls the core's
  `amendPhasesHold` past the prefix guard" (pre-0137 wording; the shell stopped calling it when
  `amend --phases` retired) — the file is outside this change's scope, named for the next
  shell-package doc pass.

Derives: **P13** (frozen additive-only vocabularies — the showing: the exit-codes vocabulary and
the flag-policy grammar change only in one conscious lockstep, here carried across help text,
README, MANUAL, the core invariants line and the refusals together; the new owned-flag rows are
additions, never silent dual meanings), **P8** (deliberate enforcement moments — the showing: every
new refusal names the owning command and the channel that actually consumes the flag, the surfaced
line teaching its remedy; the enumeration guard is the detection record that keeps the invariant
from silently decaying again), **P2** (the person brackets every boundary — the showing: a person's
typo (`run --from-bundle`, `plan --unit T-001`, `--probe=false`) never silently starts a
token-spending run or runs a probe against an explicit opt-out; the error at the command line is
the cheap bracket). Tier touched: **mechanism** — shell (`packages/auto/src/index.ts`,
`packages/auto/README.md`, `packages/auto/MANUAL.md`, `packages/auto/test/e2e.test.ts`) + the
core's `AGENTS.md` exit-codes line.

## Category scope (0123 D1's discipline — reconstructed 2026-11-05 by 0166 step 003 from this ruling's D-blocks, landing commit 8e138e3f6 and its residual commit)

Family: *the CLI's option-policy truth — the refusal grammar, the enumeration guard that holds it,
and the user documentation that states it.* Home-set reconstructed from D1–D3 and the residuals:

| home | disposition |
|---|---|
| `packages/auto/src/index.ts` (refuseLaneValueFlags widened to plan; the `--from-bundle`/`--probe` owned-flag rows; probe a boolean; the source-derived enumeration guard and the COMMANDS/OPTION_HELP table check) | changed — D1/D2 |
| `packages/auto/README.md` and `packages/auto/MANUAL.md` (exit 3 in the vocabulary; the brief-stub, amend and compatibility stories corrected) | changed — D3 |
| `AGENTS.md` (the core exit-codes operational line gains the exit-3 clause — one vocabulary across help, README, MANUAL and the invariants line) | changed — D3 |
| `packages/auto/AGENTS.md` (the transfer row's pre-0137 amend wording — the named residual, landed by the follow-up commit) | changed |
| The verified-accurate documentation rows (parallel lanes/tiers, lane-log-dir, interruption recovery, key rings `/failback`, auto-number, clarify, sync, release) | held, untouched — D3 |
| Extra positionals silently ignored; `fix --dryrun`'s exit-1 deviation | held, untouched — the named residuals, deferred to their own rulings |
| Test homes: `packages/auto/test/e2e.test.ts` (the enumeration-guard describe; the clarify/driver-helper/install-prompts describe; the extended lane-flag and models tests) | changed |

Tests: `packages/auto/test/e2e.test.ts` — the enumeration-guard describe (the source-derived
vocabulary, the consumed-or-refused matrix over run/plan/transfer, the COMMANDS/OPTION_HELP table
check), the clarify/driver-helper/install-prompts describe (clarify's exit mapping and refusals,
the helper's unloadable config, the suite installer's refusal/happy/never-delete), the extended
lane-flag test (plan's `--unit`/`--merge`, `--from-bundle` on run/plan/transfer with the sync
pointer, init's owned-row answer) and the extended models test (`--probe=false`/`--probe false`
run no probe, `--probe true <dir>` resolves the directory through a project-layer finding). The
shell suite: 154 pass / 8 E2E-gated skips / 0 fail (the standing 148 + 6 new); both packages'
typecheck clean.

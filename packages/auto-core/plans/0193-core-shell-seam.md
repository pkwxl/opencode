# 0193 — the shell mirror's shared halves live in the core: one emitter family, one init/amend sequence, one served surface, one fake

Status: active-authority (0166 remediation step 033, wave W3-shell-seam; finding 0165-056 =
S32-02 (∪7), CONFIRMED — every member defect re-verified against HEAD at ruling time except
S26-04's amend half, already answered by init/amend's own notice block; the drift mechanism
verified by census: `runOptions` in `auto/src/index.ts:2186` and `auto-server/src/worker.ts:380`
key-for-key, the init/amend sequence twice (`auto/src/index.ts:2481–3061` and
`auto-server/src/ops.ts` `runConfigOp`), the banner twice + the phases line four times (both
shells' `phasesLine`, `status.ts:98`, `phases.ts:518`), the frozen-key hint tables twice
(`amendHint` / `CONFIG_KEYS`), fake-claude three times — the core's own copy the stalest, 111
diff-lines behind the maintained reference).

One finding, one family: **the core/shell contract left the shells owning shared logic by
mirroring, and mirrors drift by lockstep misses — every confirmed break in the family is a
rule the CLI grew after the mirror was written (0142's banner clause never reached the worker,
0137's amend retirement not enforced or mis-taught on the server side, 0073's bootstrap and
0122/0147's stamps absent from the server's init, 0101's transfer teaching not reached by
either shell's phases line, the served stop lines naming subcommands a service shell
refuses).** The remedy is not better mirroring (P5: no second sources of truth): the shared
halves move into the core behind declared seams, and the shells render.

Derives: **P14** — one-way dependencies through declared seams: the core never knows shells;
the shared logic is core logic (it already exists in the core's own copies — `status.ts`,
`phases.ts`, `renderAgentContract`), and the shell-specific parts (input grammar, gate
mechanics, surface naming) inject through the profile and parameters. **P5** — single
ownership: every emitter, table and sequence this change touches ends with exactly one owning
home; the shells keep adapters, never copies. **P10** — the byte-identical floor: every lift
is behavior-preserving for the shell that already had the rule, proven by pinned outputs; the
behavior changes are exactly the ruled defect fixes, each fail-before covered. Amends: none —
no principle restated; the ruling works inside P13's lockstep discipline for the changed
refusal lines (the pins change in the same change). Tier: core code (`src/banner.ts` new,
`src/config.ts`, `src/shell.ts`, `src/plan.ts`, `src/status.ts`), shell code
(`packages/auto/src/index.ts`, `packages/auto-server/src/{ops,worker,profile,request}.ts`),
tests in all three packages.

premises this ruling changes: **0053 D25** (amend as a shell-only command — the *sequence*
underneath becomes a core export the shells call; the command surface stays the shell's),
**0067 §三 item 5** (the server's frozen-key refusal naming the CLI's `amend` "because that is
today's revision surface" — the hint *table* moves to the core and the phases entry changes;
the CLI stays the named surface for the flag-shaped keys, the standing AUTO-DECISION's
remainder re-read below), **shell-contract §C.1** (the profile's field list grows the served
surface — the contract file updated in this change). Each re-read in this document where its
premise is touched.

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P5** — single ownership: the mirror is the defect's whole mechanism. One home each for:
  the run banner and phase-progress line (`src/banner.ts`), the config-key revision hints
  (`src/config.ts`), the runAll options' config threading (`src/banner.ts`), the init/amend
  check-and-write sequence (`src/config-op.ts`), the fake agent (`auto-core/test/fixtures/`).
  The shells keep what is genuinely theirs: input grammar (argv flags vs JSON body), gate
  mechanics (TTY confirm vs confirm/cleanTree fields), surface naming (subcommands vs
  operations), exit mapping.
- **P14** — declared seams: nothing shell-specific enters the core. The banner reads
  `shellProfile().bin`; the init/amend sequence takes its I/O (line sink, refusal sink, gate
  hook) and its wording carriers as parameters; the served stop lines read a new profile field
  (`surface`) whose absence is the CLI's exact shape. The core never learns there is a server.
- **P13** — frozen vocabularies change only by conscious lockstep: the changed refusal lines
  (the phases hint, the server's amend-phases refusal, the worker banner clause, the gitignore
  closing line, the `_lane` extras notices) land with their pins in the same change; no
  vocabulary gains a second meaning (the roadmap teaching restates 0137's own words).
- **P8** — every surfaced line teaches its remedy: the phases hint stops teaching a command
  that refuses (0137 retired it) and teaches the roadmap line; the served stop lines stop
  naming subcommands a binary refuses and name that shell's true surfaces; the worker's
  missing banner clause carried 0142's code-work boundary teaching — restored by sharing the
  one banner.
- **P4** — committing is the completion condition: the server's init without 0073's bootstrap
  produced runs that complete with no commit anywhere; the shared sequence carries the
  bootstrap for every shell.
- **P10** — the byte-identical floor: a shell that already had the rule renders byte-identical
  output after the lift (pinned); the floors stay (no root symlinks → no stamp lines; an
  in-repo init → no bootstrap lines).
- **P6** — derived state: the phases line derives its remedy from the config's own phases
  value (the phased/m split), as `status.ts` already did; no new state anywhere.
- **P21** — machinery waits for its consumer: the served-surface seam is shaped by the
  state-driven stop lines a service shell actually serves (the pending-tasks line, the
  no-round and not-established teachings, the boundary next lines); flag-grammar refusals that
  cannot fire under a service shell's request shapes are not re-rendered speculatively.

## D1 — one emitter family: `src/banner.ts`

- `runBannerLines(dir, config): Promise<string[]>` — the legacy-mode note, the driver-run
  tests line (0142's full clause included), the config summary, and — when phased — the phase
  progress line. The CLI's `logRunBanner` (run/plan/`_lane`) and the server worker's inline
  banner render these lines; the worker's copy lacked 0142's clause (**S29-08's first half,
  fail-before**).
- `phasesLine(dir): Promise<string>` — one home for the banner's phase line: the progress
  shape (`phases (round N): P01-analysis✓ …`) and the missing-index warning, now
  phased-aware — `run ${bin} ${phased ? "transfer" : "plan"} to establish the round` (0101
  D4's own split, `status.ts`'s existing rule; **S29-08's second half, fail-before** — both
  shells taught `plan` unconditionally, sending every phased project with a missing index to
  the command that cannot establish a phased round). `status.ts`'s early-return missing-index
  line adopts the same renderer (one wording — the parenthesized path shape; status's line
  gains the parens, a ruled alignment). `phases.ts:518`'s blocked-refusal shape ("establish
  the round with X first") is a different grammar (a block reason, not a banner line) and
  keeps its own words — counted, not unified.
- `configRunOptions(config, mode): RunAllOpts` — the config-threading half of the shells'
  `runOptions` (agent, subtask, contextLimit×1000, idle/max ms, mode, intent, phases,
  testByDriver, handoverTest, autoNumber, wrapup, acceptanceGate, build, parallel, treeLanes,
  lanes, scanExempt, isolate). Its home is `src/loop-preflight.ts` beside the `RunAllOpts`
  type it returns (not `src/banner.ts` — the emitter family is line assembly; this is options
  threading, and its natural seat is the type's own module). The CLI's and the worker's
  `runOptions` spread it and add their per-run halves (session flags vs request options, the
  transport's `interactive`, the plan payload's stop/input/append). The worker's verbatim unit
  assertion keeps passing — the object's shape is unchanged.

## D2 — one frozen-key hint table: `src/config.ts`

`CONFIG_KEY_HINTS` maps every constitutional key to its revision clause: the flag shape
(`-m <value>`, `--context-limit <value>`, the auto-number/wrapup on/off pairs) — and `phases`
to the roadmap teaching (0137's own words: the key is init-stamped machinery; a round's
phases reshape by its `- R-NN <phases> — <goal>` line in docs/analysis.md). The CLI's
`amendHint` and both refusal sites (`refuseFrozenFlags`, the close/land strict ladder), and
the server's `CONFIG_KEYS`/`frozenRefusal`, render from the one table (**S29-07,
fail-before**: the phases refusal stopped teaching `opencode-auto amend <dir> --phases
<value>`, the command 0137 retired). 0067 §三 item 5's AUTO-DECISION re-read: its premise
("the server's own REST config ops arrive with P1d and can take the hint over then") — P1d's
operations exist; the ruling keeps the CLI as the *named* surface for the flag-shaped keys
(the CLI remains the escape hatch beside any daemon, and the server's request grammar speaks
config-file spellings the hint's flag shapes still teach correctly through the amend
operation's field names), and phases — whose true remedy is not a command at all — teaches
the roadmap line on both shells. The remainder of the AUTO-DECISION (an operation-shaped
hint) is declined on P8 grounds: the named remedy must exist for the caller, and the CLI
command does.

## D3 — the served surface: a profile seam (S30-04)

`ShellProfile` gains `surface?: { run(dir): string; plan(dir, flags?): string; transfer(dir):
string }` — how the core's person-facing stop lines name this shell's task-running, planning
and advancing channels. Absent = the CLI subcommand shape (`${bin} run <dir>` etc.) —
byte-identical for the general shell, no re-render of flag-grammar refusals that cannot fire
under another shell's request shapes (P21). The server profile supplies its true names (the
run and plan operations with their routes; `transfer <dir>` stays the subcommand — the server
binary has it). `plan.ts`'s state-driven sites (the pending-tasks line, the no-round and
not-established teachings, the boundary next lines, the proposal next line, the re-run line)
route through the renderers (**fail-before**: under the server profile the lines stopped
answering `opencode-auto-server run <dir>` — the usage refusal — with exit 1). shell-contract
§C.1's field list gains the seam in this change.

## D4 — one init/amend sequence: `src/config-op.ts`

The core owns the sequence both shells currently mirror: baseline load (amend strict /
overwrite tolerant, `fixHint` on failure), the handoverTest-requires-testByDriver check, the
round/phase-state read, the mode check, the merge with the dropper semantics, the intent
pack-existence check (on the merged value), the read-only prefix guard (`plannedPhaseUnits`),
the prompt-library load, init's git bootstrap + commit-identity prerequisite (0073), the
retired-key warnings, the overwrite gates (injected), the config save, the opencode.json and
agent-contract writes (one renderer — `renderAgentContract`, byte-equal to the CLI's inlined
template render), init's root-symlink external-directory stamps (0122/0147), the AGENTS.md
block sync, init's gitignore set, and the closing lines. The shells keep: their input grammar
(flags / JSON body — value validation included), their pre-checks' placement (the CLI's
argv-time legacy/lock block; the server's request-shape-first order), their gate mechanics
(TTY confirm + `-f` vs the two-field confirm/cleanTree flow), their exit mapping
(`process.exit` vs `OpOutcome`), and their closing-line surfaces (the CLI names `<bin>
plan/transfer <dir>`; the server names its operations with routes) — injected as carriers.
What the engine carries that a mirror lacked, each **fail-before** on the server:

- **0073's bootstrap** (S29-04): the server's init bootstraps the repository exactly as the
  CLI's — the created line, the cannot-initialize refusal — and keeps its identity refusal
  (no `--name/--email` channel on a request body; the refusal's remedy list stays the
  server's own, minus the flag pair it cannot teach).
- **0122/0147's stamps** (S30-02): after the opencode.json write, the allows status → stamp
  lines, byte-identical to the CLI's; no root symlinks writes nothing (the floor).
- **0137's amend retirement** (S30-01): the engine refuses a `phases` key on amend with the
  roadmap-line teaching (the CLI's own refusal restated in the request grammar), before any
  value validation — mirroring the CLI's keying on the command.
- **The gitignore closing line** aligns to the CLI's full clause (the "committed project
  surfaces — commit them with the config layer" teaching is 0138's posture, not a CLI
  decoration; the server's shorter line was the lockstep miss).

0053 D25 re-read: "amend as a command is shell-only" — the *command* stays shell-only (argv
surface, its own option ladder and notices); the sequence underneath (what D25's own text
describes: "loads strictly … and writes config.json, the contract and the AGENTS.md block")
is core logic the shells now share. The premise's remainder stands.

## D5 — `_lane` joins the retired-extras refusal (S26-04's live half)

The extras `--commit-subtask` / `--verify-idle` / `--verify-max` are refused with their
notices on `_lane` too (the run/plan/transfer family's `refuseFrozenFlags` covers the hidden
entry — it is a run-shaped entry, and a silently ignored retired flag on it is the same
defect the family already refuses; the call carries the whole shared vocabulary with it:
the frozen config keys, the brief pair, the identity pair, `-f` and `--continue`). The
amend half of the finding was already answered at HEAD (the notices inside the init/amend
block). The 0159 enumeration guard gains a scoped `_lane` column: the shared-vocabulary
layers (the globally retired flags, the frozen config keys, the extras, the revision
pairs) each refused with exit 1 naming the flag. The layers that are each public command's
own surface — plan's input flags (`-p`/`--file`), the close family, run's execution
shaping — are not re-enumerated for the hidden machine entry: its argv is the parent's
lane launcher's own (`--unit`/`--merge` plus the session flags), and a stray flag there
beyond the shared vocabulary is the launcher's bug — recorded as this ruling's named
residual (a stricter machine-entry policy is step 035's parser wave to rule, not this
one's).

## D6 — one fake: `auto-core/test/fixtures/fake-claude.ts`

The maintained reference (`packages/auto`'s copy: the 0095 formulation-line append rule,
`pendingTask`, the FORK_MODULES/NESTED lane knobs) unifies with the extensions the other two
copies carried — `FAKE_CLAUDE_DELAY_MS` and `FAKE_CLAUDE_LOG` (env-gated, 0/unset = the
reference's immediate, unlogged behavior) and the two T-094 interruption-resume branches
(prompt-gated: the fresh-session item prompt and the shape-check re-prompt; the reference's
suites never meet them). One file; `packages/auto`'s and `packages/auto-server`'s copies are
deleted and their PATH shims exec the core's copy by monorepo-relative path (test-time
plumbing only — no package export, no src dependency; the exports boundary is step 036's
ruling, not preempted here).

## Category scope (0123 D1's discipline)

- **Code homes**: `src/banner.ts` (new), `src/config.ts` (the hint table), `src/shell.ts`
  (the `surface` field and `surfaceOf`), `src/plan.ts` (the renderer-routed stop lines),
  `src/status.ts` (the shared phases line), `src/loop-preflight.ts` (`configRunOptions` beside
  `RunAllOpts`), `src/config-op.ts` (new — the sequence); `packages/auto/src/index.ts`
  (banner/hint/runOptions adapters, the init/amend block onto the engine, `_lane`'s refusal);
  `packages/auto-server/src/ops.ts` (runConfigOp onto the engine, the amend-phases shape
  refusal ahead of value validation), `src/worker.ts` (the shared banner, `runOptions`),
  `src/request.ts` (the hint table render), `src/profile.ts` (the served surface),
  `src/worker-interactive.ts` (the transport's `detach` — see the in-family discovery below).
- **Test homes**: `test/banner.test.ts` (new — the emitter family: the cross-profile banner
  equality, the phases-line split, the served-surface renderers, the hint table);
  `test/config-op.test.ts` (new — the sequence engine shell-neutral: bootstrap, identity,
  stamps, the amend-phases belt, the gates hook's timing, the droppers, the wording
  carriers); `packages/auto/test/e2e.test.ts` (the CLI's byte-identical floor + the phases
  hint and `_lane` extras pins); `packages/auto-server/test/ops.test.ts` (the server's
  fail-before pins: bootstrap, stamps, the gitignore closing line, the amend-phases
  refusal, the served-surface lines, the roadmap-line reshape) and `test/worker.test.ts`
  (the frozen-key phases pin); `test/fixtures/fake-claude.ts` (the union) with the shells'
  shims repointed (`packages/auto/test/e2e.test.ts`'s and
  `packages/auto-server/test/fixtures/project.ts`'s PATH shims, the two copies deleted).
  The status view's missing-index line needed no pin updates — no suite pinned its old
  un-parenthesized shape; the unified line is pinned by `test/banner.test.ts`.
- **Documentation**: this document; the INDEX row; AGENTS.md's navigation line;
  `docs/shell-contract.md` §C.1 (the `surface` field); `docs/structure.md` (the banner and
  config-op module rows, the shell/config rows' additions); the program's ledger row.

### In-family discovery at verification (recorded, fixed in this change)

`packages/auto-server/src/worker-interactive.ts` did not implement the `Interactive.detach`
member 0181 D1 added to the core's type (step 021's lockstep miss — the step's typecheck ran
in auto-core and the CLI shell only): the engine's `attempt.ts` finally calls
`opts.interactive?.detach()` at every dispatch's end, so the server's WebSocket transport —
the one shell whose sideband it is — threw a TypeError there and left the idle session bound
between turns, exactly 0181 D1's defect surviving on the mirror. The same mechanism as the
∪7 (a core seam change the shell mirror missed), found by this step's three-package
typecheck; the member ships here (`detach()` clearing the session binding, the reconnect
frame re-binding nothing until the next attach) rather than as a ledger row — the 0165
register predates step 021, and the final audit's row census covers the register, not this
younger sibling.

## Floors and proofs

- Byte-identical (pinned before/after): the CLI's banner, frozen refusals, init/amend happy
  path and every unchanged refusal; the worker's `runOptions` verbatim shape; a no-symlink
  server init (no stamp lines); an in-repo init (no bootstrap lines).
- Fail-before (each red on pre-fix source): the worker's banner clause; the phases-line
  split (both shells); the phases hint (both shells); the server's amend-phases refusal; the
  server's bootstrap; the server's stamps; the gitignore closing line; the `_lane` extras;
  the served-surface lines under the server profile.

## Residuals

- The CLI's init/amend keeps its argv-time option ladder (whitelists, notices, pointers) —
  shell grammar, not sequence; a future parser wave (step 035) touches it, not this one.
- `_lane`'s policy owns the shared vocabulary alone (D5): plan's input flags, the close
  family and run's execution shaping pass the hidden entry unrefused — its argv is the
  launcher's own; a stricter machine-entry policy is step 035's to rule.
- `phases.ts`'s blocked-refusal wording ("establish the round with X first") stays its own —
  different grammar, one home already.
- The deeper CLI-grammar teachings in `plan.ts` (the `--export`/`--adopt` and `--append`
  refusal rows) are not re-rendered through the surface seam: they cannot fire under the
  server's request shapes (P21); if a future shell carries those flags, the seam renders
  them then.

## Tests

Named in Category scope; the exact red pins are enumerated in the step record
(`plans/0166-remediation/033-w3-core-seam.md`).

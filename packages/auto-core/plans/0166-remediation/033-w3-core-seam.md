# Step 033 — w3-core-seam: one core init/amend sequence, one option/banner/hint emitter family, shared fake fixture

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W3-shell-seam, finding **0165-056** (S32-02, ∪7). Started 2026-11-07 at
HEAD `7b7a923f2` (tree clean; steps 001–032 done).

## Finding

0165-056 (S2, CONF, DUP, P5): the shell mirror is maintained by hand and
drifts by lockstep misses — runOptions ×2 (`auto/src/index.ts`,
`auto-server/src/worker.ts`), init/amend ×2 (`ops.ts` re-implements the CLI's
sequence minus 0073/0122/0147), the banner/phasesLine/frozen-key hint tables
×2, the option ladders (S26-04 mirrored in S30-01), fake-claude ×3 (the core
carries its own behind copy). Member enumeration (∪7): **S29-04** (server init
lacks the 0073 git bootstrap — a server-initialized non-git target runs to
completion with no commit anywhere), **S29-07** (both shells' frozen-key
refusal for `phases` teaches `amend --phases`, the command 0137 retired),
**S29-08** (the worker's run banner lacks 0142's testByDriver clause; both
shells' phasesLine teach `plan to establish the round` where the core's own
copies teach `transfer` for phased), **S30-01** (the server's amend accepts
`config.phases` — the key 0137 retired on amend), **S30-02** (the server's
init stamps no root-symlink external_directory allows), **S30-04** (under the
server profile the core's served lines teach `run`/`plan` subcommands the
server binary refuses), **S26-04** (the retired extras
`--commit-subtask`/`--verify-idle`/`--verify-max` silently ignored on `_lane`;
the amend half already answered by init/amend's own notice block at HEAD).

## Current state at start (verified against HEAD)

- All member defects re-verified live except S26-04's amend half (the
  notices at `auto/src/index.ts` refuse the three extras inside the
  init/amend block — fixed since the review; the `_lane` half remains: no
  refusal, `KNOWN_FLAGS` waves them through).
- Three fake-claude copies: `auto/test/fixtures/fake-claude.ts` (the
  maintained reference), `auto-core/test/fixtures/fake-claude.ts` (behind:
  lacks the 0095 append rule, `pendingTask`, the FORK_MODULES/NESTED knobs;
  has DELAY_MS/LOG), `auto-server/test/fixtures/fake-claude.ts` (auto's copy
  + DELAY_MS + the two T-094 interruption branches).
- The `renderAgentContract` core function is byte-equal to the CLI's inlined
  template render (the contract write unifies trivially).

## Plan (enactment order; each ingredient lands green)

1. Ruling 0193 written first (Derives/Amends, Category scope, premise guard).
2. Emitter family lift: new core `src/banner.ts` — `runBannerLines`,
   `phasesLine` (phased-aware, profile bin), `configRunOptions` (the config
   half of both shells' runOptions). CLI/worker/status rewired.
3. Frozen-key hint table lift into the core (phases carrying the roadmap-line
   teaching); both shells' refusal tables render from it.
4. The served-surface profile seam (S30-04) and its plan.ts rewrites.
5. The server init/amend defect fixes (bootstrap, allows stamp, amend-phases
   refusal, gitignore closing-line alignment).
6. `_lane`'s retired-extras refusal.
7. The one core init/amend sequence (`src/config-op.ts`), both shells
   rewired onto it.
8. Fake fixture union (one home in auto-core, shims repointed).
9. Full verification (both/three packages), fail-before red proofs,
   byte-identical pins; docs (INDEX, AGENTS nav), ledger, commit.

## Verification

All three packages touched; every item below measured on the committed state
(fail-before reds measured on pre-fix source over `/tmp` backups, files
restored and `cmp`-verified byte-identical, suites re-run green).

- **auto-core**: `bun typecheck` clean; full suite **3089 pass 0 fail**
  (155 files; 3075 at step 032's close + 6 banner pins + 8 config-op
  engine pins; the core's copy of the fake fixture unioned, the two shells'
  copies deleted with their PATH shims repointed at the core's).
- **packages/auto**: `bun typecheck` clean; full suite **151 pass / 8 skip /
  5 fail** — the baseline 150/8/5 plus the new `_lane` guard test; the 5 =
  the pre-existing fork/remove-fork trailer-scan failures, untouched.
- **packages/auto-server**: `bun typecheck` clean after the step's own fix
  (see the in-family discovery below — at HEAD the package did not typecheck).
  Suite measured two ways, both honestly: **ambient environment 118 pass /
  18 fail** — pre-existing at HEAD (measured on a pristine HEAD worktree:
  the identical 118/18; the machine's operator layer
  `~/.config/opencode-auto/models.json` references four env keys unset in
  this environment, preflight's loud registry check refuses every
  daemon-spawned run, and the daemon passes its environment through to
  workers by design — the hermetic suites scrub `XDG_CONFIG_HOME`, the
  daemon-spawning ones inherit; step 072's hermeticity wave owns that
  condition). With the operator layer hidden (`XDG_CONFIG_HOME` → an empty
  directory): **137 pass / 1 fail** — the 1 = the observe e2e's `sawDirty`
  poll race, the known **0165-220** (step 073's), reproduced identical at
  HEAD with the layer hidden. The step's own suites green:
  `ops.test.ts` + `worker.test.ts` 29 pass / 0 fail (their env is scrubbed
  by their own fixtures), `daemon.test.ts` 21/0 with the layer hidden.
- **Fail-before red** (pre-fix source, tests fixed):
  - server src (ops/request/worker/daemon/profile/worker-interactive at
    HEAD): ops+worker **6 red** — the shared-sequence test (no bootstrap
    line, no stamp line, no 0138 gitignore clause), the amend-phases
    retirement (409 where 400 is pinned), the worker banner clause, the
    frozen-key vocabulary (`--phases <value>` taught), the planPrelude
    boundary matrix and the plan unlock (the served lines naming
    `opencode-auto-server run` — and the detach TypeError verbatim:
    `opts.interactive?.detach is not a function` as a driver fault);
    daemon **16/5** (the detach family — HEAD-with-clean-env's own count).
  - CLI src (index.ts at HEAD): **3 red** — the frozen-options test (the
    phases hint teaching `amend <dir> --phases`), the boundary test's
    `_lane` extras pins (silently ignored, exit 1 only from the later
    load), the new `_lane` guard column.
  - core src (config.ts at HEAD): `banner.test.ts` file-level red
    (`configKeyRevision` not exported); with config.ts kept and
    plan.ts/status.ts reverted, the ops boundary matrix red alone (the
    S30-04 core half isolated — every other ops pin green, the sequence
    engine present).
- **Byte-identical floors pinned green on both sides**: the CLI's frozen
  refusals (the pre-existing e2e usage pins), init/amend happy path, the
  worker's `runOptions` verbatim shape, a no-symlink init (no stamp lines)
  and an in-repo init (no bootstrap lines) — the last two as config-op
  floor tests.

## Dispositions

The ∪7 members of 0165-056, each fixed under ruling 0193:

- **S29-04** (server init lacks 0073's git bootstrap) — **fixed**: the
  sequence carries bootstrap + identity for every shell (0193 D4);
  fail-before red (the ops bootstrap pin; the engine half pinned in
  `config-op.test.ts`).
- **S29-07** (frozen-key hint for `phases` teaches the retired
  `amend --phases`) — **fixed**: the one hint table (0193 D2), phases
  teaches the roadmap line with no file-edit offer; red on both shells.
- **S29-08** (worker banner lacks 0142's testByDriver clause; both shells'
  phasesLine teach `plan` for phased) — **fixed**: the one emitter family
  (0193 D1); red via the worker banner pin and the boundary matrix; the
  phased split pinned in `banner.test.ts` (the pre-fix teachings verified
  by census in the ruling: both shells' local copies taught `plan`
  unconditionally).
- **S30-01** (server amend accepts `config.phases`) — **fixed**: the
  shape-phase refusal before value validation (an invalid value meets the
  retirement refusal too — pinned) plus the engine's belt beneath both
  shells; red (409 where 400 is pinned).
- **S30-02** (server init stamps no root-symlink allows) — **fixed**: the
  sequence's stamps for every shell; red (the ops stamp pin).
- **S30-04** (served lines teach `run`/`plan` subcommands under the server
  profile) — **fixed**: the served-surface seam (0193 D3) with plan.ts's
  state-driven lines routed through it; red isolated on both halves (the
  server profile alone; the core plan.ts alone).
- **S26-04** (`_lane` silently ignores `--commit-subtask`/`--verify-idle`/
  `--verify-max`) — **fixed** (the run half; the amend half was already
  answered at HEAD): `refuseFrozenFlags("_lane")` (the whole shared
  vocabulary with it) + the scoped 0159 guard column + the direct pins;
  red. The layers beyond the shared vocabulary (plan's input flags, the
  close family, run's execution shaping) stay the launcher's own argv —
  0193 D5's named residual, step 035's to rule.

Beyond the ∪7, one in-family discovery fixed in this change (no ledger row
— the 0165 register predates step 021): **worker-interactive.ts's missing
`Interactive.detach`** (0181's own lockstep miss — the engine's attempt.ts
calls it at every dispatch's end; the server's transport threw a driver
fault there and left the idle session bound between turns). Proven red by
the daemon suite (16/5 at HEAD-with-clean-env → 21/0 after) and verbatim in
the ops fail-before output; also the cause of auto-server's HEAD typecheck
failure (the only red `tsgo` line — the package now typechecks clean).

Residuals recorded (0193's own list): the CLI's argv-time option ladder
(step 035), `_lane`'s non-shared vocabulary (step 035), phases.ts's
blocked-refusal wording (its own grammar), the deeper plan.ts CLI-grammar
teachings not re-rendered through the seam (P21).

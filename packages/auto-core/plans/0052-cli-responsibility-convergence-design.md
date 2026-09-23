# 0052 — CLI responsibility convergence: config-only `init`, migration parameters as intent, `plan` and `close` (design)

Status: **design, ruled** (2026-09-23, rulings U1–U6). **Not implemented**: every step in §6 is unticked. Source: user proposal of 2026-09-23 (§0), with a same-day follow-up (§0 item 4, rulings U5–U6). Line numbers are as of auto-core `d9e563234`; search by symbol if they drift. A read-only design review of the same day (§8.1) is folded in.

## 0. The proposal

1. Converge `init` on initializing configuration only. A later `init --auto-fix` repairs conflicting or inconsistent configuration by rule.
2. Remove `--dest-dir`, `--source-dir` and `--source-path`. What they express is user intent, not configuration.
3. A future `plan` command starts an AI session that plans the next step from the current state. Its `--force-close` option forcibly ends the previous round, phase or task, so work continues on the new plan.
4. **Follow-up (same day).** Replace `init --auto-fix` with a `fix` command: `init` reads as setting everything up again and could overwrite existing settings. Likewise, turn `--amend` into an `amend` command, which says plainly that it changes individual existing settings.

The request: weigh the strengths and weaknesses, name what can be improved, and propose a better plan.

## 1. Rulings

| # | Question | Ruling (user, 2026-09-23) |
|---|---|---|
| U1 | Scope of this round | **Design document only.** No code change. |
| U2 | Shape of `--force-close` | **A standalone `close` primitive.** It is a core `closeUnit` plus a `close <ref> --reason` subcommand, with no AI. `plan --force-close <ref>` is only a shortcut for "close, then plan". |
| U3 | `continue` | **Fold it into `plan` and retire it.** Opening the next round becomes a `plan` route. |
| U4 | Target boundary of `init` | **Config layer only.** `init` writes exactly what `reset` removes. Round establishment, `-p` and `--implement-*` move to `plan`. |
| U5 | Shape and scope of auto-fix | **A standalone `fix` command** (`fix [dir] [-f]`) instead of `init --auto-fix`. It covers the whole config layer: broken `config.json` keys, and config-layer artifacts that are missing or out of step with the current config. |
| U6 | Shape of `--amend` | **A standalone `amend` command** (`amend [dir] --<key> <value>…`). It is added in P2. `init --amend` is retired in P3c, together with `-p` and `--implement-*`. |

## 2. Fact baseline

- **F1 — what `init`/`continue` do** (`packages/auto/src/index.ts:406-944`). Six kinds of work, only the first two of them configuration:
  1. **Config.** Writes `config.json` as a full overwrite, or under `--amend`. Includes the prefix guard (:750-765) and the handoverTest ⇒ testByDriver check (:676-686).
  2. **Config-layer artifacts.** `opencode.json`, `.opencode/agent/auto.md`, the AGENTS.md block and `.gitignore` (:825-853).
  3. **Process state.** `establishRound` writes `docs/R-NN/`: `phases.md`, `P<nn>-<type>/todo.md`, the `round.md` stub and `AGENTS.md.bak` (:860-873; `phases.ts:419-433`).
  4. **Intent.** `-p` writes `.opencode/auto/brief.md` (:879-887).
  5. **An AI session.** `--implement-*` starts `implementPlan` (:893-922; `implement.ts`), m-mode only. It is the only path on which `init` starts a session.
  6. **Lifecycle.** `continue` runs its prechecks, the round-close gate (:740-748) and next-round establishment.
- **F2 — `reset` is config-only** (`reset.ts:50-115`). It removes `config.json`, `brief.md`, the contract, the legacy `.auto/config.json`, the AGENTS.md block, the `.gitignore` entries and an unmodified `opencode.json`. It never touches `docs/`, `.auto/` or `tmp/`. The asymmetry between `init` and `reset` is exactly F1 items 3–6. It also deletes `brief.md` unconditionally (`reset.ts:53-55`), although that file holds human intent.
- **F3 — `source`/`destDir` are prompt text only.**
  - **One reader.** `loop-phase.ts:137-138` passes them to `renderPhasePlan` (`prompt.ts:374-410`), which fills two sections of `phase-plan.md:29-44`. `phase-plan.md:13` mentions "migration-source parameters" even when none are set.
  - **Unused paths.** Never used in the default m mode (the loop never plans there). `implementPlan` does not pass them.
  - **Nothing mechanical reads them.** Not git or the clean gate, not the P1 scan (`document/roles.ts:150` `p1Scope`), protect, refcheck, or the round-close build (`round-close.ts:69`, `cwd` = workdir). `formatProjectConfig` does not print them.
  - The README claim "migrated code is written to `<dir>/<dest-dir>`" holds only as far as the planning session follows its prompt.
- **F4 — `infer-source` is dead here.** The `infer-source` template and `renderInferSource` (`prompt.ts:520-535`, `template.ts:35/73/106`) are called only by the frozen migrate shell, which keeps its own core snapshot.
- **F5 — the other `destDir`.** 0036 F18/D4's "configurable `destDir`" means the root of the process documents. It is a different concept from `ProjectConfig.destDir`.
- **F6 — routing and planning.**
  - **Routing is a pure function of the files** (`phases.ts:303-328`): `complete` / `plan` (phase has no tasks) / `execute` / `handover` / `blocked`. Once a phase has tasks it never routes to `plan` again, so mid-phase re-planning does not exist.
  - **m mode.** `P01-implement` never completes, and the plan route only prints "add tasks" (`loop-phase.ts:426-438`).
  - **A planner cannot say "nothing to do".** It must write at least one task (`loop-phase.ts:167`).
  - **Reviewing a plan before execution** is possible only through `OPENCODE_AUTO_STEP ≥ phase` (0049 G5).
- **F7 — `planPhase` vs `implementPlan`.**
  - `planPhase` (`loop-phase.ts:52-202`) owns:
    - numbering recovery and advance (`.auto/next-task`);
    - injection of the handover chain, `brief.md`, `round.md` and `prevRound`;
    - `requireArtifact`: clean gate, SHA baseline, shape-check retry and unified commit;
    - the `openStep`/`closeStep` resume points.
  - `implementPlan` is a parallel copy:
    - it starts its own agent;
    - it injects neither `round.md` nor the handovers;
    - it numbers from the highest taken id + 1 and never advances `.auto/next-task` (`implement.ts:34-35`).
- **F8 — `resetPlanning` deletes pending tasks.** It deletes every task directory listed in the phase's index that is not taken elsewhere, i.e. the phase's pending tasks (`tasks.ts:497-507`). `plannedTaskProblems` rejects ids in its `before` set and any listed `done.md` (`tasks.ts:428-466`).
- **F9 — unit state.**
  - **Two file states.** A unit is `todo.md` / `done.md`, exactly one (0047). Runtime state (`in_progress`, `blocked`) lives in `.auto/units.json` (`tasks.ts:49`). 0047 §8 rejected a third file state (`blocked.md`).
  - **Default dependency.** A missing `Depends:` means "the previous sibling" (`document/unit.ts:204-213`). `nextReady` treats done as satisfied (`unit.ts:277-280`).
  - **Blocked tasks.** A blocked task is resumed on every run, and nothing clears it.
  - **Accept or reject is done by hand.** Accepting a `Result: FAIL` (`runner.ts:422-425`) or rejecting a phase (`loop-phase.ts:359-362`) is a manual rename or edit. Manual renames bypass the G7 gates, which live only in `completePhase`.
  - **Rounds have no state.** A round counts as closed only once the next round exists.
- **F10 — no run lock.** `protect.ts` only chmods the config files to 0444 during `run`.
- **F11 — shell contract.** CLI shape belongs to the shell, mechanisms to the core (`docs/shell-contract.md` §A:13). §A's command list omits `reset` (drift).
- **F12 — the round-start gate G1.** `init`/`continue` leave the round setup uncommitted. `run`'s preflight names the gate when the current `phases.md` has never been committed (`loop-preflight.ts:201-220`).
- **F13 — `--amend` and refreshing the config layer.**
  - **A flag that flips the baseline.** `--amend` changes only the baseline, from `CONFIG_DEFAULTS` to the existing config (`index.ts:633-637`). `continue` is always amend. With no `config.json`, `loadProjectConfig` returns the defaults (`config.ts:102-107`), so `init --amend` in a fresh directory is plain `init`.
  - **The overwrite guard** (clean tree, then confirm) applies only to a full overwrite (`index.ts:783-801`). In a non-TTY the confirm passes.
  - **Hints name the full overwrite.** Messages that tell a person how to change one key name `init <dir> --<key>`, which resets every other key: `index.ts:179`, `:186-193`, `:285`, `:652`, `:682` and `:714`. Only `:762` names `--amend` (DF8).
  - **Refresh.** `run`'s preflight rewrites the AGENTS.md block and `.gitignore` and commits them (`loop-preflight.ts:233-247`). A missing or differing agent contract only stops or warns there, naming `init` to rebuild or refresh it (`:158-175`). `check`'s AGENTS.md notes name `init` too (`check.ts:69-87`). Refreshing the contract without restating every key takes `init --amend` with no keys.

## 3. Classification criterion

A setting's home is decided by **what the driver does with its value**:

| Layer | Test | Carrier | Examples |
|---|---|---|---|
| **Config** | The driver *interprets* the value: it branches on it, runs it, or checks it against disk | `.opencode/auto/config.json`, written by `init` or `amend`, repaired by `fix` | `agent`, `contextLimit`, `subtask`, `idleTime`/`idleMax`, `testByDriver`, `handoverTest`, `autoNumber`, `wrapup`, `phases`, `acceptanceGate`, `build` |
| **Intent: selectors** | An enumerated value that picks which intent-pack text is injected | Stays in config | `mode`, `parallel` |
| **Intent: content** | The driver only *forwards* the value word for word into a prompt | Human-edited documents: `brief.md` (project), `round.md` (round), planning input (one planning step) | migration source/target (today's `source`/`destDir`) |
| **Lifecycle** | A transition of process state | `plan`, `run`, `close` | round establishment, planning, execution, closing |

Consequences:
- `source`/`destDir` are intent content (F3).
- `establishRound`, `continue` and `--implement-*` are lifecycle.
- `phases` is config. Its materialization, the phase index, is lifecycle state (D22).
- `brief.md` holds intent content in a file whose *stub* belongs to the config layer: `init` writes the stub and `reset` removes it only while it is untouched (D9).

## 4. Evaluation

### 4.1 Config-only `init`: right direction, three additions

- **Strengths.**
  - Single responsibility.
  - `init` and `reset` become exact inverses.
  - `init` is deterministic, needs no AI or network, and suits CI.
  - The special case "init starts a session" disappears.
- **Addition 1: give every duty a new owner before moving it.** `run` writes none of the following today: round establishment, the tail re-sync after a `--phases` change, the `round.md` stub, `AGENTS.md.bak`, and the `continue` prechecks. Under U3/U4 the new owner is `plan` (D13–D14, D20–D22).
- **Addition 2: validate everything, then write.** Today three checks run after the config, templates, AGENTS.md block and round are already written:
  - empty `-p` (`index.ts:879-887`);
  - the implement shortcut's "task index already lists tasks" (:894-903);
  - prompt-library validation (:816-821).

  The e2e test at `auto/test/e2e.test.ts:1092-1110` asserts this ordering. It must be inverted, not merely updated (D7).
- **Addition 3: relax the prefix guard when the current round is complete.** A revised `phases` then applies to the next round, which is what `continue` offered. `init` only reads the index for this check and never writes `docs/` (D22).

### 4.2 Retiring `source`/`destDir`: recommended, but never silently

- **Strengths.**
  - The values are prompt text only (F3), so calling them configuration misleads users.
  - `brief.md` can say more than two paths: several modules, mappings, exclusions.
  - The general config schema loses a migration-only concept.
  - The dead `infer-source` path goes too (F4).
- **Risk 1: silent loss.** Config ignores unknown keys, so a stored `source` would silently stop reaching planning. Follow the D13 precedent (`verify: true`, `commit: false`): fail strictly with an exact fix (D3), and automate the move in P2 (D10).
- **Risk 2: a strict failure blocks `init` itself.** `init` loads the existing config strictly before overwriting it (`index.ts:619-625`). A stored `commit: false` already makes even a full re-init impossible. The full-overwrite baseline read must tolerate retired keys (D4).
- **Risk 3: the structured slot and the init-time existence check are lost.** Mitigations:
  - The `brief.md` stub gets `## Source` / `## Target` sections (D9).
  - The discipline "keep migrated code out of the process files" moves to the stub hints and the README.
  - It does **not** go into `modes/migrate.md`: `migrate` is every project's default mode, only phase-plan renders its `## init` (so the default m flow would never see it), and it would change every phase-plan golden (D6).
- **Risk 4: the cross-round identity guard is lost.** Acceptable: it guarded intent.
- **Carrier choice.** Use `brief.md`, not `round.md`: a new round gets a fresh stub, so a target written into `round.md` would be lost in round 2.
- **Name collision.** F18's future process-doc root must not reuse `destDir`. Otherwise a stale key would be quietly reinterpreted. `source` and `destDir` become permanent tombstones (D3).

### 4.3 `fix` (was `init --auto-fix`): valuable, with rules

- **Value.** Every key retirement so far has only been an error text telling a person what to edit: `commit: false`, `verify`, the contract name in `agent`, `verifyIdle`/`verifyMax`, and now `source`/`destDir`. A rule table turns each retirement into a migration step that can be executed.
- **A command, not an `init` flag** (U5).
  - `init` means "declare the whole config", and a plain `init` *is* a full overwrite. A person reading `init --auto-fix` has reason to fear a re-initialization.
  - As a flag it had to exclude every other `init` option. An option that excludes all the others is another command.
  - `fix` must read the raw JSON leniently, because the strict load failure is what it repairs. As its own command, that loading path stays out of `init`.
  - Its interaction matches `reset`: print the plan, apply the clean-tree gate, confirm, apply. `-f` skips the gate and the confirmation.
  - **Cost: `fix` is a broad word.** In an AI coding tool it can read as "have the AI fix the code", and a top-level `fix` invites scope creep. The usage text therefore states the scope, the config layer, and phase-index repair stays with `plan` (D22). No existing term is called `fix` (checked against the glossary and `src/`).
- **Rules for the rules.**
  - Config layer only: `config.json` and the artifacts `init` writes from it. Phase-index inconsistencies belong to `plan` (D22).
  - Two classes. **fixable** means deterministic and meaning-preserving. **manual** means report only, never guess (for example `handoverTest` without `testByDriver`: which side to change is a human decision).
  - Only keys that fail to load or silently lose their meaning are "broken". Valid alternative spellings are not rewritten: a `phases` array, `parallel: "none"`, `agent: "opencode"`.
  - A config-layer artifact that is missing, or differs from what the current config renders, is fixable (U5). Refreshing therefore has a home once `amend` requires a key (D25). Files a person may have edited (`opencode.json`, `brief.md`) are only written when missing, as `init` does.
  - The read-only 0444 residue left by a killed run needs no rule: `saveProjectConfig` already chmods (`config.ts:128-131`). Without a lock, `fix` also could not tell residue from a live run.
  - Starts from the existing config, never resets other keys, and takes no config flags.
  - Prints each change and is idempotent.
  - `run`/`status` add the hint "fix: `opencode-auto fix <dir>`" to a strict failure when the rule is fixable.

### 4.4 `plan`: a real need, defined by the current route

- **Strengths.**
  - An explicit human gate between planning and execution, replacing an environment variable.
  - A proper planning entry for m mode, so `implementPlan` can merge back into the main path.
  - A place for course correction.
- **Pitfall: a second orchestrator.** `plan` must be the same state machine with a stop condition. Then preflight, resume-point precedence, the clean gate and SHA baseline, numbering, protect, stats and hibernation all behave identically for free (D13).
- **Behaviour per route** (D14). `plan` never executes a task.
  - No round yet, or the round is complete: establish the round (running the round-close gate first for the next round) and stop at G1.
  - `plan` route: plan the phase, then stop.
  - `handover` or knowledge extraction: advance to the next planning point, plan it, then stop.
  - `execute` (pending tasks remain): refuse, pointing to `run`, `close` or `--append`.
- **Missing capability: append planning** (D18). Mid-phase re-planning and incremental m-mode planning both need it, and it is the part of `plan` that is genuinely new. It cannot reuse `planPhase` as it stands: `resetPlanning` would delete the pending tasks (F8). Worse, an interrupted append would leave a `phase-plan` resume point that the next `run` re-enters through a full `planPhase` (`loop-phase.ts:455-470`), and that wipes them.
- **Persist the planning input** (D16). Otherwise an interrupted planning step loses it on re-run; `implementPlan` has this problem today.
- **A run lock** (D12). `plan` and `run` in the same directory at once would corrupt state.
- **Cost: one more step for a new project** (D24).

### 4.5 `--force-close` → standalone `close` (U2)

- **Need.**
  - Nothing clears a blocked task.
  - Accepting a FAIL or rejecting a phase is manual file surgery that bypasses the gates (F9).
  - A planner cannot close a phase that has nothing to do (F6).
- **Why a standalone primitive** (U2). Bundling an irreversible state change into an AI command violates the same single-responsibility argument that motivates the `init` change. `close` is also useful without re-planning, for example to accept a FAIL and continue `run`.
- **Carrier.** A `Closed:` field in the unit's field block, written and committed by the driver (D17).
  - It keeps the two-state invariant, and `git revert` undoes it.
  - Rejected alternatives: a third file state (0047 §8), and `units.json` (not versioned, lost on clone).
  - A sibling `closed.md` marker was also considered: it would leave a subtask's `done.md` artifact untouched. The field is preferred because the field block is already driver protocol and keeps one file per state.
- **Hard parts** (all in D17):
  - explicit targets;
  - cascade;
  - explicit versus default dependencies (a missing `Depends:` means the previous sibling, so a naive "refuse on dependents" would refuse almost always);
  - the handover chain (the handover is the only memory passed between phases);
  - the dirty tree a killed session leaves;
  - clearing every resumable record;
  - keeping the round-close integrity gates.

### 4.6 `--amend` → standalone `amend` (U6)

- **Strengths.**
  - **One command, one contract.** `init` declares the whole config: stateless and reproducible. `amend` changes the named keys and keeps the rest. Today a single flag flips the baseline of the same command (F13).
  - **A stricter contract becomes possible.** `amend` can refuse without a `config.json` (today `init --amend` there is plain `init`, F13), require at least one key, and load strictly.
  - **Hints can name the right command.** Every "change one key" hint names `amend` instead of a full overwrite (DF8).
  - **The timing fits.** Once D21 retires `continue`, "`continue` is always amend" is gone and nothing else shares the amend path.
- **Costs.**
  - **A breaking CLI change.** It touches the README, messages, e2e tests and the shell contract's §C mention of `--amend --agent opencode`. By precedent, `--amend` becomes a usage error that names `amend`.
  - **Shared flag parsing.** `init` and `amend` accept the same config flags, so the parsing leaves the `init` block for one shared function.
  - `git commit --amend` is a precedent for a flag, but there the verb is still "commit". Under `--amend` the verb is no longer "init".
- **Transition.** Until P3c, `init --amend -p` and `init --amend --implement-*` are the only way to use `init`'s lifecycle flags without resetting the config.
  - `-p` has a replacement: edit `brief.md`.
  - `--implement-*` has none before `plan -p`. Retiring `--amend` in P2 would open a gap for m-mode projects that already have a config.

  So `amend` arrives in P2, and every hint names it from then on. `init --amend` stays until P3c and retires with `-p` and `--implement-*` (D20).
- **Resulting command surface.**
  - Config layer: `init`, `amend`, `fix`, `reset`.
  - Lifecycle: `plan`, `close`, `run`.
  - Read-only: `check`, `status`.
  - `continue` is retired (D21).

  CLI shape belongs to the shell (F11): the commands live in `packages/auto`, and the core adds only `config-fix.ts` and message text. The frozen migrate shell is unaffected.

## 5. Decisions

### P1 — retire the migration parameters; `init` validates before it writes

- **D1** `--source-dir`, `--source-path` and `--dest-dir` become usage errors (exit 1) on `init`, `continue` and `run`, with the hint "state the migration source and target in `.opencode/auto/brief.md`".
  - `RETIRED_FLAGS` (`index.ts:131`, `:147-155`) hard-codes the verify-family message; it becomes a map from flag to message.
  - The `run` freeze list (:183-196) and the `continue` identity guard (:428-435) drop the three flags. The guard keeps `-m`.
- **D2** Removals:
  - `ProjectConfig.source`/`destDir` with `sourceOf`/`destDirOf`;
  - `RunAllOpts.source`/`destDir` (`loop-preflight.ts:70-74`) and the pass-through in `loop-phase.ts:137-138`;
  - the `renderPhasePlan` inputs and `phase-plan.md:29-44`;
  - `phase-plan.md:13` is reworded so it no longer mentions migration-source parameters.

  The phase-plan goldens pass a brief and no `sourceDir`, so they should stay byte-identical; confirm during implementation.
- **D3** A stored `source` or `destDir` fails strictly, like `verify: true`. The message gives the exact fix: copy the value into `brief.md`, then delete the key. The two names are permanent tombstones: no future key reuses them, so F18's process-doc root needs another name.
- **D4** The full-overwrite baseline read in `init` tolerates retired keys. The overwrite discards them anyway, but it prints each discarded retired key with its value, so a stored `source` is never lost without notice. `init --amend` (and `amend` from P2) still fails strictly, because it would carry them over. From P2 that message names `fix`. This also removes the latent trap that a stored `commit: false` blocks every re-init.
- **D5** Delete `infer-source`:
  - the template and `renderInferSource`;
  - its registration and tier-1 markers (`template.ts:35/73/106`);
  - its golden and test entries.

  The frozen migrate shell keeps its snapshot.
- **D6** Leave `templates/modes/migrate.md` unchanged (§4.2 Risk 3).
- **D7** `init` becomes validate-then-write. Every check runs before the first write:
  - flag values;
  - non-empty `-p`;
  - "the task index already lists tasks", checked only when the index exists;
  - prompt-library and intent-pack validation;
  - the mode;
  - the prefix guard.

  Invert the test at `e2e.test.ts:1092-1110` to assert that `config.json` is unchanged when a guard fails.
- **D8** Documentation, all in the same change:
  - **README:** the config table, the init options, the migration-parameter paragraph and the `continue` section.
  - **Package notes:** remove the three flags from the constitutional-attribute list in `CLAUDE.md`.
  - **Shell contract:** add a §C bullet for the retired keys and flags; add `reset` to §A; add a §E note that the reference shell's migration parameters are gone.
  - **0035:** update the registry for the removed marker entry.
  - **Message fix:** the m-mode closing line of `init -p` (`index.ts:927`) says "run … to start task planning", but `run` never plans in m mode.

### P2 — the brief stub, `fix` and `amend`

- **D9** `brief.md` becomes an intent document with a stub, modelled on `round.md`.
  - `init` writes the stub when the file is missing. It has sections `## Goal`, `## Source`, `## Target` and `## Constraints`, each holding only an HTML-comment hint. The hints carry the "keep deliverables out of `docs/` and `.opencode/`" discipline.
  - Planning strips the comments before injecting, reusing the `round-brief.ts` logic. An untouched stub injects nothing.
  - `reset` removes `brief.md` only while it equals the stub, as it does for `opencode.json`. A filled brief is kept.
- **D10** `src/config-fix.ts` holds a rule table over the raw JSON and the config-layer artifacts, returning findings of class `fixable` or `manual`. `validateProjectConfig` stays strict.

  | Class | Rule | Fix |
  |---|---|---|
  | fixable | `commit: false` | drop the key |
  | fixable | `verify` (any value) | drop the key |
  | fixable | `agent` holding a contract name | drop the key |
  | fixable | `verifyIdle` / `verifyMax` | rename when the new key is absent, drop when it is present |
  | fixable | `source` / `destDir` | append to `brief.md` under `## Source` / `## Target` (adding the headings if absent), then drop the keys |
  | fixable | legacy `.auto/config.json` mode with no `config.json` | write `config.json` |
  | fixable | agent contract missing, or differing from the render for the current `testByDriver` | rewrite it (`renderAgentContract`) |
  | fixable | AGENTS.md block missing, stale, or with legacy/stray marker blocks | `ensurePointer` |
  | fixable | `.gitignore` lacks the `tmp/` or `.auto/` entry | `ensureGitignore` |
  | fixable | `opencode.json` or the `brief.md` stub missing | write it; never overwrite (both may hold a person's edits) |
  | manual | anything else `validateProjectConfig` rejects | report only |

  The artifact rules render from the config, so they run only when the config loads strictly after the key rules. Otherwise they are reported as skipped.
- **D11** `fix [dir] [-f]` (U5), in place of `init --auto-fix`:
  - Its baseline is the existing config, read raw. It takes no config flags: any option but `-f` is a usage error, as for `reset`.
  - Like `reset`, it prints the plan, then applies the clean-tree gate and the confirmation unless `-f`. With nothing to fix it says so and exits 0.
  - It applies all fixable findings and prints each change, then exits 1 if manual findings remain.
  - It does not commit: like `init`, it leaves the diff for review.
  - It is idempotent.
  - **Hints.**
    - `run` and `status` end a strict failure with "fix: `opencode-auto fix <dir>`" when the failing rule is fixable.
    - The contract hints in preflight (`loop-preflight.ts:158-175`) and the AGENTS.md notes in `check.ts:69-87` name `fix` instead of `init`.
    - The shell-profile value `agentRecovery: "init"` keeps its name; only the text changes.
- **D25** `amend [dir] --<key> <value>…` (U6):
  - **Flags.** It accepts exactly the config flags `init` accepts (`-m`, `--agent`, `--phases`, …), parsed by one shared function. `-p`, `--implement-*`, `-f` and `--amend` are usage errors.
  - **Refusals.**
    - Without `config.json`: "nothing to amend; run `init`".
    - With no key flag: "name at least one key". Refreshing is `fix`.
  - **Load.** It loads the existing config strictly; a retired key fails with the `fix` hint.
  - **Checks.** The same as `init`'s, on the effective values: flag values, the mode, handoverTest ⇒ testByDriver, and the prefix guard. It validates, then writes (D7).
  - **Writes.**
    - `config.json`, plus the artifacts rendered from it (the agent contract and the AGENTS.md block), since `testByDriver` changes them.
    - Until P3c it also runs `init`'s round step (`establishRound`, which re-syncs the unstarted tail after a `--phases` change), so moving from `init --amend` loses nothing. P3c removes the step from both (D20, D22).
    - No overwrite guard, since nothing is discarded. No commit.
  - **Key removal.** `--parallel none` and `--agent opencode` drop their keys, as today.
  - **Hints (DF8).** Every "change one key" hint names `amend`: `index.ts:179`, `:186-193`, `:285`, `:652`, `:682` and `:714`. `:762` moves from `init --amend` to `amend`.
  - **Transition.** `init --amend` keeps working until P3c (D20).
  - **Docs, with D11.**
    - The README.
    - The shell contract's §A command list, which gains `fix` and `amend`.
    - The config-semantics section of `packages/auto/AGENTS.md`: its watershed `base = amend ? existing : CONFIG_DEFAULTS` becomes the split between the two commands.
    - The glossary.

### P3 — lifecycle commands (detailed design and 0035 registration come before code)

- **D12 — run lock.** `.auto/run.lock` records the pid, command and start time. It is stale when the pid is not alive (kill -9 is the main case). `run`, `plan` and `close` acquire it; `init` and `reset` refuse while a live lock is held. Under MP.3 the parent holds it, and each child's worktree has its own `.auto/`.

**P3a — `plan`**

- **D13 — `plan` is a stop condition.** `runAll` gains `stopBefore: "execute"`. `runPhaseLoop` returns **0** at the first `execute` route after at least one planning step, or at the route decisions in D14. It does not return 3, which means "re-run to resume".
  - Everything else is reused: preflight (G1, the clean gate, `resetInProgress`, protect, the housekeeping commit), `openStep` precedence, numbering, stats and hibernation.
  - The G5 pause point (`loop-phase.ts:395-401`) is where the stop lands.
- **D14 — route table.**

  | State | `plan` does |
  |---|---|
  | No round (fresh project) | Establish R-01: deterministic, no AI, left uncommitted. Print G1. Exit 0. |
  | Round complete (phased) | Run the G8 round-close gate (it blocks as `continue` did), establish R-(N+1), stop at G1. The two human steps stay: fill in `## Close` before, review and commit after. This is the retired `continue`. |
  | `plan` route (phased) | Phase-planning session, then stop. |
  | `handover` / knowledge extraction | Advance through them to the next planning point, plan it, stop. |
  | `execute` | Refuse and point to `run`, `close` or `plan --append`. |
  | m mode | With input (`-p`/`--file`), implement-style planning, appending when tasks exist (D18). Without input, establish the round if missing, otherwise print "list tasks or pass input". Hand-written tasks keep working. |
- **D15 — `implementPlan` merges into `planPhase`.** m-mode planning renders the `implement-plan` template on the `planPhase` machinery: next-task numbering and advance, resume points, and brief/round injection. `implement.ts` and its separate agent start are deleted. This fixes the next-task gap (F7). It also makes moot the inferred defect DF5 (§8.3).
- **D16 — planning input is persisted.** `plan -p <text>` / `--file <path>` writes the input into the phase directory before the session starts, as `plan-input.md` (or numbered per append, see Q1). It gets a new process role in `document/roles.ts`, so the P1 scan and the eof scan classify it. A resumed planning step reads it back. `-p` means only this once `init -p` retires (D20).

**P3b — `close`, append planning, `--force-close`**

- **D17 — `closeUnit(ref, reason, opts)`.**
  - **Targets** are explicit: `T-NNN`, `R-NN.P<nn>` or `R-NN`. A bare flag is never accepted.
  - **Effect:** writes `Closed: <reason>` into the unit's field block, renames `todo.md` → `done.md` and ticks the index. The field text also records the gates it skipped.
  - **Commit:** the driver commits with `Auto-Stage: force-close`, the reason in the body. The unit-commit close-out check applies to that commit.
  - **Cascade:** round → open phases → open tasks → open subtasks.
  - **Dependencies.** An open unit whose *explicit* `Depends:` names a closing unit makes `close` refuse and list it; `--cascade` closes it too. An *implicit* previous-sibling dependency counts as satisfied, and the dependent's session prompt notes that its predecessor was closed, not done.
  - **Records in flight.**
    - Refuse when an MP.3 worktree record exists (0051 D4).
    - Otherwise clear: the `units.json` entry, *every* resumable record in `progress.json` (the task graph changes under any session that could be reused), `handover.json` and the test-handover chain, and `CURRENT.md`.
    - A dirty tree is refused unless `--commit` (fold the changes into the close commit) or `--discard` (restore to HEAD, with confirmation).
  - **Closing a phase.** The driver writes a mechanical `handover.md` with the four required sections: tasks done, tasks closed with reasons, why the phase was closed, and the task directories as required reading. The handover chain and `prevRoundDigest` thus stay informative. `plan --force-close` instead runs the normal distillation session with the closure in view.
  - **Closing a round.** Close its open phases; the round then counts as complete. `plan` applies G8 unchanged: only the completeness precondition is relaxed, never the integrity gates. In m mode `close R-01` is refused, because the single implicit phase never closes; close tasks instead.
  - **P1 scan.** Closed units skip the unit-close P1 scan, so `close` warns that the whole-tree scan at round close still applies.
  - **Readers:**
    - `scanUnitStates` returns a closed set;
    - `nextReady` counts closed as satisfied;
    - `takenTaskIds` includes closed ids (never reused);
    - `doneList` shows `[closed]`;
    - `status` uses a distinct mark (⊘);
    - the handover prompt lists closed tasks as not done;
    - `prevRoundDigest` labels closed phases;
    - `trimmedPhases` counts only non-closed analysis/design phases.
  - **Pointers:** the FAIL message (`runner.ts:422-425`) and the phase-reject procedure (`loop-phase.ts:359-362`) point to `close` instead of manual renames.
  - **Invariant:** the package `CLAUDE.md` invariant "a unit is done only when its artifacts are on disk and committed" gains "or explicitly closed by a person through `close`, recorded in its `Closed:` field".
- **D18 — `plan --append`.**
  - It gets its own resume step kind, `phase-append`, so an interrupted append never re-enters a full `planPhase`.
  - Its reset removes only ids absent from the pre-session snapshot; the collect checks only the new ids, with the snapshot as `before`.
  - New tasks are appended after the existing index lines. The template gets the existing tasks with their states.
  - Allowed on the `execute` route and in m mode. Ids come from `.auto/next-task` (under MP.3, the parent's).
- **D19 — `plan --force-close <ref> [--reason]`** is `closeUnit`, then `plan`, in one process that holds the lock throughout.

**P3c — lifecycle leaves `init`**

- **D20** `init` writes the config layer only: `config.json`, the contract, `opencode.json`, the AGENTS.md block, `.gitignore` and the brief stub. `establishRound`, `-p` and `--implement-*` leave it; each becomes a usage error with a hint (`plan`, or edit `brief.md`). `--amend` retires in the same step, as a usage error that names `amend` (D25), and `amend` drops its round step.
- **D21** `continue` is retired: a usage error pointing to `plan`.
- **D22 — phases sync.** When the current round's unstarted tail differs from `config.phases`, `plan` re-syncs it (`syncPhaseIndex` with the prefix guard). `run` detects the mismatch and stops with exit 1, pointing to `plan` (see Q4). `init` keeps a read-only prefix-guard check so a bad value fails at `init`; the check is relaxed when the current round is complete.
- **D23 — messages.** Messages that say "run init to establish the round" point to `plan`: `phases.ts:314`, `status.ts:27` and `packages/auto/src/index.ts:1026` (`implement.ts:31` goes away with D15). The config-layer hints (the AGENTS.md-block notes in `check.ts:69-87` and the contract hints in preflight) already name `fix` from P2 (D11).
- **D24 — the new-project flow, documented.**
  1. `init`
  2. `plan` (R-01, stops at G1)
  3. Fill in `brief.md`/`round.md` and commit.
  4. `plan` (plans, stops for review; optional, since `run` also plans)
  5. `run`

  That is one invocation more than today, in exchange for a single owner of round establishment.

## 6. Stages and steps

Order: P1 → P2 → P3a → P3b → P3c.
- P1 stands alone.
- P2 ships the migration tool for the keys P1 retires. Until then, D3's message gives the exact manual fix, and D4 keeps `init` usable.
- P3 relies on P2's "`init` is config" boundary.
- **Within P3:**
  - P3a merges the two planning paths first, so `--append` and `close` build on one planner.
  - P3b adds the mid-course tools.
  - P3c moves ownership last, when `plan` can take it.
- **MP.3.** P3 overlaps MP.3 in the driver domain (`loop*`, `packages/auto/src/index.ts`). MP is deferred, so there is no conflict today. D12, D17 and D18 already state their MP.3 behaviour.

Each step is verified with `bun typecheck` and `bun test` in `packages/auto-core` and `packages/auto`.

- [ ] **P1** D1–D8: retire the three flags and the two keys, drop `infer-source`, make `init` validate-then-write, fix the m-mode `-p` message, update the docs.
- [ ] **P2** D9–D11, D25: brief stub and reset comparison, `config-fix.ts`, the `fix` and `amend` commands, `fix` hints in `run`/`status`/preflight/`check`, `amend` hints (DF8).
- [ ] **P3 design pass**: a detailed design document for P3 with 0035 registrations (§7) before any code.
- [ ] **P3a** D12–D16: run lock, `plan` as a stop condition, route table, `implementPlan` merged into `planPhase`, persisted planning input.
- [ ] **P3b** D17–D19: `closeUnit` and `close`, `plan --append`, `plan --force-close`.
- [ ] **P3c** D20–D24: `init` config-only (`-p`, `--implement-*` and `--amend` retired), `continue` retired, phases sync owned by `plan`, messages and README flow.

## 7. Protocol-string impact (0035 registration, P3 design pass)

- **`Closed:`** — a new field in the unit field block. Driver-parsed, English, case-insensitive like `Depends:`/`Touches:`.
- **`Auto-Stage: force-close`** — a new commit trailer stage. An append planning commit needs its own stage too, for example `phase-append`.
- **`plan-input.md`** — a new process-document name and role.
- **`phase-append`** — a new step kind in `.auto/progress.json`. Driver-internal, not visible to sessions.
- **The `brief.md` stub headings** (`## Source`, `## Target`, …) are scaffolding the driver does not parse, like the non-`## Close` headings of `round.md`. `fix` *writes* them; it never reads them back.
- **`.auto/run.lock`** — driver-internal, not visible to sessions.
- **Removed:** the `infer-source` tier-1 markers (`"sourceDir"`, `"blocked"`).

## 8. Review notes, dissent and open questions

### 8.1 Design review (2026-09-23)

A read-only review of the draft is folded in. It contributed:
- the interpret-vs-forward criterion (§3);
- `brief.md` over `round.md` (§4.2);
- the init self-blocking trap (D4);
- the per-flag retirement messages (D1);
- dropping the `migrate.md` line (D6);
- the inverted e2e test (D7);
- the tombstones (D3);
- narrowing auto-fix to broken keys (D10);
- the append/`resetPlanning`/resume hazard (D18);
- explicit-vs-implicit dependencies, the informative phase handover stub, `--commit`/`--discard`, clearing every resumable record, and the m-mode round-close refusal (D17);
- exit 0 for `plan` (D13);
- the invariant amendment (D17);
- splitting P3 (§6).

### 8.2 Recorded dissent (U3/U4 stand)

The review recommended:
- keeping R-01 establishment and the tail sync in `init` as "config-derived scaffolding";
- keeping `continue` as its own gated command outside `plan`.

Its arguments:
- m-mode users need `P01-implement/` to write tasks by hand;
- G1 relies on `init`'s output staying uncommitted;
- `establishRound` is deterministic and uses no AI.

The rulings stand, and each argument has a mitigation:
- `plan` establishes the round just as deterministically, without AI, and leaves it uncommitted, so G1 is unchanged (D14).
- In m mode, `plan` without input only establishes the round, so hand-written tasks keep working (D14).
- The extra step is documented (D24).

Revisit if field use after P3c shows the extra step costs more than the single owner is worth.

### 8.3 Defects found by the survey

These do not depend on this design. Each is scheduled in a stage.

- **DF1.** `init` validates after it writes (`index.ts:816-821`, `:879-887`, `:894-903`), and `e2e.test.ts:1092-1110` asserts it. → D7.
- **DF2.** A stored retired key (`commit: false`) blocks even a full-overwrite `init` (`index.ts:619-625`). → D4.
- **DF3.** In m mode, `init -p` prints "run … to start task planning" (`index.ts:927`), but `run` never plans in m mode. → D8.
- **DF4.** `implementPlan` neither consumes nor advances `.auto/next-task` (`implement.ts:34-35`). → D15.
- **DF5 (inferred from code, not reproduced).** A first-time `init --implement-*` in a git repository leaves `init`'s own writes uncommitted. The planning unit's clean gate (`implement.ts:64` `unitStart`) then refuses, and the refusal is reported as blocked (`implement.ts:84-94`). The e2e suite never creates a git repository, so this is untested. → moot after D15/D20.
- **DF6.** `reset` deletes a human-written `brief.md` (`reset.ts:53-55`). → D9.
- **DF7.** Shell-contract §A omits `reset`. → D8.
- **DF8.** Hints that tell a person how to change one key name `init <dir> --<key>`, a full overwrite that resets every other key: `index.ts:179`, `:186-193`, `:285`, `:652`, `:682`, `:714` (F13). In a TTY the overwrite asks first; in CI it passes silently. The contract and AGENTS.md-block hints (`loop-preflight.ts:158-175`, `check.ts:69-87`) name `init` for a refresh. → D25 and D11.

### 8.4 Open questions (for the P3 design pass)

- **Q1** Persisting planning input: one `plan-input.md` per planning step, or one numbered file per append?
- **Q2** Append template: a variant of `phase-plan.md`, or a new `phase-append.md`?
- **Q3** Lock staleness across hosts on a shared filesystem: out of scope, or record the hostname?
- **Q4** D22: should `run` itself re-sync an unstarted tail? The sync is deterministic, but it is a lifecycle step, and U4 gives lifecycle to `plan`.
- **Q5** m mode has no `round.md`: how should the G1 message and the `plan` stop line read there?
- **Q6** Is a `reopen <ref>` command worth having, or is `git revert` of the close commit enough?
- **Q7** `mode` and `parallel` stay config as intent selectors (§3). Revisit if intent packs gain their own selection mechanism.
- **Q8** Should `check` also list `fix`'s findings, read-only? `fix` already prints its plan before it asks. Decide in P2.

## 9. Relationship to other designs

- **0004 (init config) / 0006 (phases, `continue`)**: this document narrows `init`, splits `--amend` into the `amend` command and retires `continue`. Both are historical and not updated.
- **0036 F18/D4, 0013 MP.3**: `destDir` there is the process-doc root, a different concept, and needs a new key name (D3). The run lock and `close`/`--append` state their MP.3 behaviour (D12, D17, D18).
- **0047**: the two-file-state invariant holds. `Closed:` is a field, not a state (D17).
- **0049**: G1, G7 and G8 are preserved. `plan` gives the G5 review point a command, and the environment switch stays.
- **0044**: `close` becomes the sanctioned way to accept a `Result: FAIL`.
- **0021**: the close commit is a driver commit with an `Auto-Stage` trailer, inside the unit-commit close-out check.

<!-- auto: eof -->

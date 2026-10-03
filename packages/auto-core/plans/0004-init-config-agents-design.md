# init Project Config Persistence and AGENTS.md Maintenance Rules — Design Notes

> This document is the sole design baseline for "migrating run options into init persistence" (the `.opencode/auto/config.json` project config layer) and
> the "AGENTS.md slim-down maintenance rules" (the fourth marker block `opencode-auto:maint`):
> implementation tasks defer to this document. Phases P1..P4 are all implemented (the init/run option surfaces match §B/§C;
> the maintenance-rules block, the check line-count note, and the README/in-package AGENTS.md docs are all in effect).

## Background and Motivation

1. **Cross-run drift of constitutional-level options**: `run` re-accepts `-m/--mode`, `--agent`,
   `--verify`, `--commit`, `--subtask`, `--context-limit` and other switches that "determine how the session is instructed,
   how verification and commit semantics operate". Running the same target directory on another day or by another person without the flags falls back to defaults,
   mismatching the previous run's semantics. The mode persistence in `.auto/config.json` and the "init and run should use
   the same mode" warning (src/index.ts resolveModeFlag) were the first patch for that symptom — a patch
   that should be generalized into a principle: **project attributes are persisted at init; run only controls the current execution**.
2. **Mismatch between the AGENTS.md principle blocks and run options**: init writes the verification-principles block and the commit-principles block, the PLAN.md
   template's verify-field explanation, and the init -p planning prompt, all assuming jointly that "verification/commit execution authority sits
   with the driver"; yet `--verify false` / `--commit false` are run options — switched off, the session reads an
   AGENTS.md contract describing a pipeline that does not actually run, and the principle blocks become dead letter. Likewise, `--agent` /
   `--context-limit` respectively determine the system-prompt contract and the model context budget; swapping them mid-run amends the
   constitution mid-flight.
3. **AGENTS.md bloat risk**: AGENTS.md is not on the read-only list (tasks may update the rest of it), and nothing in a long migration
   (dozens of tasks × many sessions) stops it accumulating implementation details, command output, one-off decisions, gradually
   degenerating into a "project encyclopedia + junk heap"; meanwhile, as system context it enters the context window on every provider turn,
   so bloat directly erodes every session's effective context. A minimal maintenance protocol is needed (the external
   discussion already gave the direction: workflow entry point + routing + update discipline, not a knowledge-base architecture).

## 1. Relation to the Status Quo (invariants)

- Zero changes to the driver-exclusive state writes, unified commits, single global session, progress resume, final-review loop and other mechanisms;
- The Opts shape of `runAll` / `runTask` is unchanged: config is parsed by `src/index.ts` and injected as before
  (loop/runner never learns the config's source; e2e calling `runAll(dir, {})` directly is unaffected);
- The three existing AGENTS.md marker blocks (pointer/verification/commit) keep their mechanism; the fourth block reuses the same idempotent-append
  mechanism (the principle that the driver only appends marker blocks and never rewrites the rest is unchanged);
- The mode layer stays prompt-level guidance and stays out of the scheduling state machine; the `loadModes` / `parseModeFile` protocol
  is unchanged.

## 2. Adaptation Map for the External (ChatGPT) Suggestions

Those suggestions target a "generic linear development workflow"; this package is a migration-automation driver, adapted per the table below:

| External suggestion | Disposition |
| --- | --- |
| Workflow / Current Task / linear phase state machine | **Already covered by existing mechanisms, not restated in AGENTS.md**: phase = the PLAN.md task order, current task = the CURRENT.md mirror, roles = assigned by the session prompt; restating the flow in AGENTS.md would create a second source of truth drifting from PLAN/prompts |
| Context Routing (`docs/agents/*.md`) | **Adopted (lightweight)**: as the routing convention of maintenance rule 2; no architecture/implementation/testing skeletons pre-seeded — the migration project's topic files are created by sessions as needed |
| ≤150 lines / Update don't append / distill only durable knowledge | **Adopted**: maintenance rules 1/3/4, compressed into four Chinese rules |
| An AGENTS.md Maintenance Rules section | **Adopted as the fourth marker block** `opencode-auto:maint`: same mechanism as the pointer/verification/commit blocks, idempotently backfilled by init/run, equally visible to sessions and humans |
| An explicit Architect→Implementer→Tester role flow | **The literal flow is not adopted**: this package's execution flow is scheduled by the driver (decomposition/subtasks/wrap-up/verdict/review); AGENTS.md carries only the entry point and the discipline |
| Heavyweight mechanisms such as knowledge base / Memory GC / ADR | **Not adopted**: the migration scenario is covered by PLAN.md + docs/ process artifacts + knowledge distillation (fixme-knowledge-design §D, future); AGENTS.md keeps its entry-point positioning |

## 3. Confirmed Decisions

| Decision point | Conclusion |
| --- | --- |
| Config carrier | `.opencode/auto/config.json` (new; **versioned, shared via the repo, human-editable**). Not `.auto/config.json` — the entire `.auto/` tree is gitignored runtime state, while the constitution belongs in git history for audit. Unknown keys are ignored (forward compatible) |
| Config content | All keys explicit: `mode / agent / contextLimit / subtask / verify / verifyIdle / verifyMax / commit` (schema in §A); init writes out the complete file |
| Options migrated to init | `-m/--mode`, `--agent`, `--context-limit`, `--subtask`, `--verify`, `--verify-idle`, `--verify-max`, `--commit` (full classification table in §4) |
| run-side disposition | Any of the above appearing on `run` is a usage error (exit code 1); the message gives remediation guidance (`init --<flag> <值>` — `<值>` meaning the value — or editing the config directly), mirroring the existing precedent of the `--commit-subtask` removal |
| init merge semantics | **Revised (see §B.1)**. Original conclusion: write only the keys explicitly given on the command line, keep the existing config values for keys not given → init carried the dual identity of creation and amendment (amend). Current: init defaults to **stateless full overwrite**, with amend demoted to the explicit `--amend` |
| Manual revision channel | Edit `.opencode/auto/config.json` directly; bad JSON / out-of-range values / unregistered mode → both run and init exit 1 naming the key (strict failure over silent fallback) |
| Mode resolution funnelled to one place | `-m` is accepted by init only; resolveModeFlag's "inconsistent with the persisted value" warning disappears with persistence (no run-side divergence exists anymore); run reads `config.mode` → `loadModes` lookup, an unregistered name exits 1 as an environment error |
| Principle-block wording | The three existing AGENTS.md blocks keep their **config-independent invariant** wording (sessions run no verification / make no commits) and are not rewritten along with the verify/commit switches — avoiding config and AGENTS.md as dual sources; the effective config is printed by run's startup banner and status |
| Options staying on run | `--server / --verbose / -i / --wait-answer / --wait-between / --permission / --review / --early(--early-review) / --final-review / --dryrun` (rationale in §4) |
| AGENTS.md maintenance rules | Fourth marker block `opencode-auto:maint` (full text in §D.1): stay lean (≤150 lines) / route, don't duplicate (docs/agents/) / update, don't append / distill only durable workflow knowledge |
| agent contract sync | `templates/.opencode/agent/auto.md` updates the AGENTS.md-related clauses: never rewrite any opencode-auto marker block; updates to the rest must follow the maintenance-rules block (init always replaces this file → one init upgrades an old project) |
| config read-only guardrail | `.opencode/auto/config.json` added to src/protect.ts's FILES (chmod 0o444 during run; manual revision happens outside a run) |
| check extension | AGENTS.md over 150 lines emits a note (not counted in findings, no effect on the exit code) — the maintenance rules' only machine-observable point |

## 4. Option Classification Table

Each current run option classified one by one ("migrate" = moved into init and persisted to config):

| Option | Home | Rationale |
| --- | --- | --- |
| `-m/--mode` | **Migrate** | Mode-related (named by the user); prompt-level scenario guidance should be consistent project-wide, and the existing persistence + warning is already a symptom patch |
| `--agent` | **Migrate** | AGENTS.md/contract-content related: the agent file is the system-prompt contract; init generates and maintains auto.md; switching agent mid-run = amending the behavioral constitution mid-flight |
| `--context-limit` | **Migrate** | Model-related: the context budget depends on the context window of the model the agent is bound to, chosen together with the agent |
| `--subtask` | **Migrate** | Plan-shape related: the auto tier injects checklist items into PLAN.md via the decomposition session (the task body's persisted shape), unlike the off/ondemand whole-task pipeline prompts; switching mid-way mixes execution shapes within one plan and is inconsistent across runs |
| `--verify` | **Migrate** | AGENTS.md-content related: the verification-principles block + the PLAN verify field + the init -p prompt all assume this mechanism already at init time; turned off at run, the principle block and the verify field become dead letter, and the meaning of "done" (verified or not) drifts per run |
| `--verify-idle` / `--verify-max` | **Migrate** | They parameterize the established acceptance mechanism and belong to the acceptance constitution together with verify; machine differences are tuned by hand-editing config (config itself is the revision channel) |
| `--commit` | **Migrate** | AGENTS.md-content related: the commit-principles block is landed at init; with `--commit false` the block's "the driver commits uniformly" wording no longer matches reality, and the audit trail (git history) semantics drift per run |
| `--server` | Stays on run (+ init -p) | Environment access (whether this machine already has a live instance), not a project attribute |
| `--verbose` / `-i` | Stays on run | Terminal UX |
| `--wait-answer` / `--wait-between` | Stays on run | The human-machine interaction rhythm of this run (supervision intensity), weighed per invocation |
| `--permission` | Stays on run | This run's permission-supervision policy (ask-* needs a human present, interlocks with dryrun); the allow rules in opencode.json are themselves an init artifact while the policy is runtime supervision — the two are orthogonal |
| `--review` / `--early` / `--early-review` | Stays on run | Review depth and scheduling optimization are per-run cost trade-offs; their artifacts (audit report / fix checklist items) are additive documents that change neither the AGENTS.md contract nor the plan's static shape (fix injection is an additive repair mechanism, and so is verify-gap repair) |
| `--final-review` | Stays on run | The final-review loop is an "after all tasks are done" wrap-up trigger; whether to enter it is decided per run |
| `--dryrun` | Stays on run | One-shot check mode |

The discriminating criterion (to be written into the README): **"changing it requires also changing the wording of AGENTS.md / PLAN / the contract, or it
describes a model/project attribute" → init; "only describes how this run goes and how the human watches" → run.**

## A. Project config layer `src/config.ts` (new)

```ts
import type { SubtaskMode } from "./runner"

// Full schema of .opencode/auto/config.json; unknown keys are ignored (forward compatible).
export type ProjectConfig = {
  mode: string          // must be a name already registered by loadModes(dir)
  agent: string         // default "auto"; existence is still backstopped by the pre-run completeness check
  contextLimit: number  // thousands of tokens (same unit as the CLI; injected into Opts ×1000 on the run side)
  subtask: SubtaskMode
  verify: boolean
  verifyIdle: number    // minutes, 1..120
  verifyMax: number     // minutes, 0 = unset, 1..1440
  commit: boolean
}

export const CONFIG_DEFAULTS: ProjectConfig = {
  mode: "migrate", agent: "auto", contextLimit: 64, subtask: "auto",
  verify: false, verifyIdle: 10, verifyMax: 0, commit: true,
}

// Read + validate: file missing → defaults + legacy fallback (the mode in `.auto/config.json`);
// bad JSON / out-of-range key value / unregistered mode (loadModes) → throw (Chinese error message naming the key and the expectation),
// converted to exit code 1 on the CLI side. Both run and init -p go through this entry.
export async function loadProjectConfig(dir: string): Promise<ProjectConfig>

// For init: explicitly given keys override the existing values, the rest are kept; returns the complete config to write back.
export function mergeProjectConfig(existing: ProjectConfig, explicit: Partial<ProjectConfig>): ProjectConfig

// Plain whole-file write (mkdir -p .opencode/auto; the write is not inside a protect window, no atomic write needed).
export async function saveProjectConfig(dir: string, config: ProjectConfig): Promise<void>

// The one-line summary shared by run's startup banner / status, e.g.:
// 模式 migrate · agent auto · 子任务 auto · 验收 off · 看门狗 idle 10m/max 不设 · 提交 on · 上下文上限 64k (mode · agent · subtask · verify off · watchdog idle 10m/max unset · commit on · context limit 64k)
export function formatProjectConfig(config: ProjectConfig): string
```

- Value ranges validated after persisting match the existing parse\* (contextLimit a positive integer; verifyIdle 1..120;
  verifyMax 0..1440; subtask/commit value enums); init's CLI parsing reuses
  src/index.ts's existing parseCommit/parseSubtask/parseContextLimit/parseVerifyIdle/
  parseVerifyMax — both gates share one standard;
- The legacy fallback applies only while the new file does not exist; once the new file is written out, `.auto/config.json` is no
  longer read (not deleted; left inside gitignore to sink naturally);
- Mode validation depends on `loadModes(dir)`, so config.ts thereby depends on mode.ts (direction: config →
  mode, same direction as prompt → mode, no cycle); mode.ts's readPersistedMode/
  writePersistedMode are deleted, their responsibility absorbed into this module.

## B. init rework (src/index.ts)

Option surface (usage text kept in sync):

```
opencode-auto init [dir] [-p|--prompt <prompt-text>] [-m|--mode <name>] [--agent <name>]
    [--subtask [off|auto|ondemand]] [--verify [true|false]] [--verify-idle [1-120]]
    [--verify-max [1-1440]] [--commit [true|false]] [--context-limit [n]] [--server <url>]
```

Flow (keeping the existing ordering skeleton):

1. Parse the explicit keys (reusing the existing parse\* functions; `-m` validates the registered name through a slimmed resolveMode:
   explicit value > existing config value > default);
2. `loadProjectConfig` (with legacy fallback) → `mergeProjectConfig` → validate →
   `saveProjectConfig`;
3. Print the effective config (formatProjectConfig);
4. Existing steps unchanged: usePromptLibrary → template copy (PLAN/opencode.json skip existing,
   auto.md always replaced) → ensurePointer (including the new maint block, see §D) → ensureGitignore;
5. The `-p` session's agent comes from the merged config;
6. An explicit `--agent` value is persisted only (no existence check, same as now; left to the pre-run completeness check).

### B.1 Revision: stateless full overwrite + `--amend` (a later change, superseding the "init merge semantics" row in §3)

**Motivation**: the original design gave init the dual identity of creation and amendment, so the output depends on the on-disk history —
after `init --agent foo --verify true`, running a bare `init` leaves those two keys untouched. The same command
yields two different `config.json` files in a clean versus a dirty environment; the user cannot get a deterministic state from a single init
without first knowing "what was passed last time".

**Current conclusion**:

- `init` defaults to **stateless full overwrite**: the output is decided solely by the arguments passed in this invocation; keys not given always fall back
  to `CONFIG_DEFAULTS`, with no incremental merge against old on-disk config. Optional keys `source` / `destDir` simply
  disappear from the file when not given (`CONFIG_DEFAULTS` does not contain them, so no special case is needed for "key deletion").
- `--amend` explicitly switches back to the original merge semantics; `continue` is always amend (continuation rounds depend on the existing config; cross-round fixed
  items are already rejected by the front guard, so "full overwrite" is beside the point).
- Implementation-wise there is a single watershed `base = amend ? existing : CONFIG_DEFAULTS`; every other place that takes a baseline
  reads `base` instead.
- **The phase-ledger prefix guard now judges this invocation's effective value** (`effectivePhases = phases ?? base.phases`), no longer
  judging "was `--phases` explicitly given". Otherwise a bare init on a phased project already progressed to `admt`
  would silently reset phases to the default `"m"`, whereupon the root `PLAN.md`'s round symlinks are restored into ordinary files —
  the round layout breaks on the spot with no error at all. This is the only real destructive risk the full overwrite introduces.
- **Two misfire-prevention gates** (both placed before the first write point `saveProjectConfig`: intercept first, then ask):
  ① workspace cleanliness (`src/clean.ts`, reusing `git.ts`'s `changedFiles`, covering the repo containing the target directory
  and every nested repo/submodule under the tree); ② interactive confirmation (`src/confirm.ts`; non-TTY counts as authorized and passes
  straight through). Both take effect only when "a config already exists and this invocation is a full overwrite"; `-f/--force` skips both.
  The non-TTY prompt exemption and the cleanliness gate **do not override each other**: scripts and CI are equally stopped by a dirty workspace.
- `brief.md` is not wiped by the config's full overwrite: it is a standalone file, overwritten whole only when `-p` is given.

**The inverse operation** is `src/reset.ts` (the `reset` subcommand): the exact inverse of init, precisely removing the config-layer artifacts. The manifest and
  boundary rules are in that file's header comment.

## C. run rework (src/index.ts)

Option surface:

```
opencode-auto run [dir] [--server <url>] [--verbose [true|false]] [--interactive|-i]
    [--wait-answer [1-60]] [--wait-between [1-60]] [--permission [auto-allow|ask-allow|ask-deny|ask-fail]]
    [--review [1-10]] [--early] [--early-review [1-10]] [--final-review [1-5]] [--dryrun [true|false]]
```

- The argument-parsing loop is untouched (`-m`/`--verify` etc. still go into the flags Map as before); **the run branch uniformly rejects the persisted options
  up front**: any of `mode / agent / context-limit / subtask / verify / verify-idle /
  verify-max / commit` appearing → exit code 1, with a message shaped like
  `--verify 已在 init 固化(.opencode/auto/config.json)。变更方式: opencode-auto init <dir> --verify <值>,或直接编辑该文件` (the `-m` message has the same shape; it reads: --verify is already persisted at init in .opencode/auto/config.json — to change it, run opencode-auto init <dir> --verify <value>, or edit that file directly);
  the existing `--commit-subtask` removal message is kept;
- `loadProjectConfig` failure → exit code 1; on success
  `log("⚙ 项目配置(.opencode/auto/config.json): " + formatProjectConfig(cfg))` (the prefix reads "project config")
  (the existing "沿用上次持久化的模式" notice — "reusing the mode persisted last time" — is deleted along with this);
- Mode resolution: `loadModes(directory)[cfg.mode]`; unregistered → exit code 1 (the message lists the supported
  modes);
- Injected into runAll Opts (shape unchanged): `agent: cfg.agent`,
  `contextLimit: cfg.contextLimit * 1000`, `subtask/commit/verify` passed straight through,
  `verifyIdleMs/verifyMaxMs` converted, `mode: ModeSpec`; `--review/--early/
  --permission/...` parsed and passed through as before;
- The loop's existing downgrade notice (early without a verify window) fires naturally per the config values, zero changes;
- The `status` command: on a successful config load, prints the same one-line config summary before the task list (on failure it only notes
  the missing/invalid config without blocking the task list).

## D. AGENTS.md prompt optimization

### D.1 Fourth marker block `opencode-auto:maint` (src/loop.ts constant + appended by ensurePointer)

```text
<!-- opencode-auto:maint:start -->
AGENTS.md 维护规则(本文件是工作流入口,不是知识库):
1. 保持精简: 全文不超过 150 行;不写入实现细节、长解释、命令输出或单任务知识。
2. 路由不复制: 模块/阶段/任务特定的信息写入 docs/agents/<主题>.md,本文件只保留
   一行路由条目(主题 → 路径)。
3. 更新不追加: 新增信息前先检查既有规则或路由条目是否应修改;淘汰过时内容,
   不要累积历史备注。
4. 只沉淀持久的工作流知识: 仅记录会影响未来多数任务执行方式的约定;临时调试
   状态、一次性决策、对话过程不写入(一次性决策按 AUTO-DECISION 记入相关文档)。
<!-- opencode-auto:maint:end -->
```

- ensurePointer gains a fourth boolean return value `maint` (idempotent: skipped once the text contains
  `opencode-auto:maint:start`); both call sites — init and runAll — print it in sync;
- The existing three blocks' text is untouched (they describe config-independent invariants; see the "principle-block wording" row in §3).

### D.2 agent contract (templates/.opencode/agent/auto.md)

The AGENTS.md paragraph in item 2 becomes (the template text below is quoted verbatim in Chinese; gist: AGENTS.md may be updated when a task needs it, opencode-auto marker blocks must never be deleted or rewritten, and other updates follow the maintenance-rules block):

> AGENTS.md 不在只读之列: 任务需要时可以更新它,但不得删除或改写任何
> opencode-auto 标记块(指针/验证/提交/维护规则,`<!-- opencode-auto:*:start -->`
> 到 `<!-- opencode-auto:*:end -->`);更新其余内容时遵守 AGENTS.md 维护规则块
> (保持精简、路由到 docs/agents/、更新不追加、只沉淀持久工作流知识)。

(init always replaces this file → one init upgrades an old target directory.)

### D.3 docs/agents/ routing convention

- Semantic split: `docs/agents/<主题>.md` (`<主题>` = topic) = **cross-task** workflow knowledge (norms, mapping conventions,
  environment quirks); the existing artifacts at the docs/ root (subtasks/report/fix/final etc.) = **single-task**
  process artifacts. Both land in the repo through the driver's unified commits;
- No skeleton files are pre-seeded; a session creates the topic file on first need and maintains a one-line route in AGENTS.md
  (maintenance rule 2 is the protocol, with no driver-side parsing — a purely prompt-level contract);
- `check` does not scan docs/agents/ (what it scans for are statements that "violate verification execution authority"; that scope is unchanged).

### D.4 check extension (src/check.ts)

- notes gains one entry: AGENTS.md total lines > 150 →
  `AGENTS.md 当前 <n> 行,超过 150 行上限(维护规则块第 1 条),建议按规则精简并把细节路由到 docs/agents/` (i.e. AGENTS.md is currently <n> lines, over the 150-line cap of maintenance rule 1; slim it per the rules and route the details to docs/agents/);
  the note does not enter findings and does not affect the exit code (same level as the existing notes).

## E. Compatibility and Migration

| Scenario | Behavior |
| --- | --- |
| Old projects (only `.auto/config.json` has a mode) | loadProjectConfig falls back to reading mode, and run prints `ℹ 模式沿用旧位置 .auto/config.json 的持久化值,重跑 init 可固化完整配置` ("mode reuses the value persisted at the old location .auto/config.json; re-run init to persist the full config"); once init writes the new file, the fallback ends |
| Old scripts like `run -m xxx` / `run --verify` | Exit code 1 + remediation guidance (release notes flag it as breaking) |
| Repeated `init` (no arguments) | **All keys fall back to the defaults** (after the §B.1 revision; formerly "config unchanged"); templates/blocks stay idempotent as usual |
| `init --verify false` | Writes the verify key; the other keys fall back to the defaults |
| `init --amend --verify false` | Rewrites only the verify key, keeping the rest (the original amend semantics) |
| Flipping verify on→off mid-way | The verified field of already-done tasks is not rewritten retroactively; unfinished tasks become done at wrap-up from then on; the existing `--review`/`--early` interplay (serial review / downgrade notice) takes effect per the new value |
| Switching subtask mid-way | Tasks with injected checklist items keep resuming from their checked state (the progress phase is recorded per task, never confused across tasks); new tasks execute per the new tier; the README notes that mid-way switching is discouraged |
| Switching mode mid-way | Only the prompt wording changes (the existing guarantee that modes never enter the scheduling state machine); reports the final review has already produced are unaffected |
| Turning commit off mid-way | The workspace starts accumulating uncommitted changes (the pendingChanges notice at run startup already exists) |
| Bad values in `.opencode/auto/config.json` | Both run/init exit 1, the error naming the key and its expected value range |

## F. Combined-behavior matrix (run-side resident options × config)

| Combination | Behavior |
| --- | --- |
| config verify=false + `--review n` | Existing semantics: reviews run serially, startup prints the downgrade notice |
| config verify=false + `--early` | Existing semantics: no parallel window exists, downgrade notice (the check that `--early` still requires `--review` is unchanged) |
| config verify=true + `--review --early` | Parallel review as before (the watchdog takes verifyIdle/verifyMax from config) |
| `--dryrun` | Reads agent/contextLimit from config; verify/commit/subtask do not participate |
| `--final-review` | The final-review task still forcibly skips task-level acceptance (no interaction with config.verify) |
| `-i` / `--verbose` / `--wait-*` / `--permission` / `--server` | Zero interaction with config, unchanged |
| `status` | Prints the config summary + the task list |

## G. File-level change list and phasing

| File | Change | Phase |
| --- | --- | --- |
| `src/config.ts` (new) | ProjectConfig / CONFIG_DEFAULTS / loadProjectConfig / mergeProjectConfig / saveProjectConfig / formatProjectConfig (with legacy fallback and value-range validation) | P1 |
| `src/mode.ts` | Delete readPersistedMode / writePersistedMode (responsibility absorbed into config.ts; loadModes / parseModeFile untouched) | P1 |
| `test/config.test.ts` (new) | defaults / merge / amend / legacy fallback / bad JSON / out-of-range values / unregistered mode / unknown keys ignored | P1 |
| `test/mode.test.ts` | Persistence cases moved to config.test.ts | P1 |
| `src/index.ts` | run branch rejects the persisted options + loadProjectConfig injection; init branch option-surface expansion + merge/save + config printing; resolveModeFlag slimmed to the init side; usage text rewritten | P2 |
| `src/protect.ts` | FILES gains `.opencode/auto/config.json` | P2 |
| `test/e2e.test.ts` | run rejects each persisted option (exit code 1 + message); init writes the complete config; init amend changes only the explicit keys; status printing | P2 |
| `src/loop.ts` | MAINT_RULE constant + ensurePointer fourth block (return value / printing at both call sites) | P3 |
| `templates/.opencode/agent/auto.md` | D.2 clause revision | P3 |
| `src/check.ts` | AGENTS.md line-count note | P3 |
| `test/prompt.test.ts` / `test/check.test.ts` | Assertion that auto.md references maint (drift protection); line-count note cases | P3 |
| `README.md` / in-package `AGENTS.md` | init/run option-table rewrite, config-file section, maintenance-rules block and docs/agents/ conventions, compatibility/migration notes | P4 |

Phase boundaries: P1 (pure logic, independently mergeable; once merged, config.ts temporarily has no callers) → P2 (the CLI's two
commands switch over — the point where behavior takes effect; release notes flag the breaking change and the migration guidance) → P3 (the AGENTS.md prompt
side, developable in parallel with P2 but recommended to merge after it) → P4 (docs).

## H. Risks, Boundaries, and Known Limitations

- **The extra "revision requires init" step**: persistence cures the drift but front-loads the change cost; both revision channels
  (init amend / editing the config directly) are kept, and config lands in git history so changes are auditable;
- **The maintenance rules are prompt-level constraints**: the 150-line cap and the routing discipline have no hard validation (the note only reminds),
  a session can still bloat AGENTS.md — the only machine-observable point is check's note; the marker blocks themselves are protected by
  the "no rewriting" contract and idempotent backfill;
- **Versioned config vs machine differences**: running the same target directory on a different machine shares the watchdog/context-limit
  parameters; that machine edits config locally when needed (the design accepts this friction in exchange for a single source of truth for the constitution);
- **The docs/agents/ vs docs/-root split rests on convention**: a session may write process artifacts into agents/
  (low risk; the final-review audit's side-view perspective can correct it);
- **Mixed task shapes from switching subtask/verify mid-way** (see §E): the README says explicitly that it is discouraged;
- **New protect entry**: config is read-only during a run; manual revision must wait for the run to end (consistent with the existing guardrails
  such as PLAN);
- **Dogfooding order**: during implementation the running driver is still the old version; new behavior takes effect from the next run;
  this package's own AGENTS.md option descriptions disagree with the code until P4 (implementation sessions must defer to this document).

## I. Testing and Verification

- `bun typecheck` + `bun test`: P1 pure functions; P2 e2e parsing cases mirror the existing style (temporary
  directories, no dependency on a server or the network);
- Manual verification: run on an old target directory (containing `.auto/config.json`) and observe the fallback notice; after init,
  AGENTS.md has all four blocks and the config is complete; `init --verify true` amend changes only one key;
  `run --verify` exits 1 with guidance; run's startup banner / status prints the config summary;
- AGENTS.md maintenance-rules trigger path: build a >150-line AGENTS.md and run check to observe the note;
- After everything is done, a `bun run build` smoke run (the auto.md template is still embedded via `type: "file"`,
  no new files under templates/).

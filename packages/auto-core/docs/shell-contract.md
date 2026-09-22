# Core/shell contract (package boundary and merge flow)

> AGENTS.md keeps only navigation; the core/shell boundary, dependency direction, difference-injection extension points, branch merge flow, and the new-shell onboarding checklist are concentrated in this file. Effective since the physical package split (phase two); later new shell branches onboard per this file.

## A. Boundary

| Package | Role | Contents |
|---|---|---|
| `packages/auto-core` (`@opencode-ai/auto-core`, no bin) | **Core** | Mechanisms (runner/loop/resume/numbering/phases/plan/script/git/protect/config/server/mode/prompt/template/knowledge/interactive/log/shell/check) + built-in templates (`templates/`) + design documents (`docs/`) |
| `packages/auto` (`@opencode-ai/auto`, bin `opencode-auto`) | General CLI shell | `src/index.ts` with init/continue/run/check/status subcommands, build scripts, CLI parsing/e2e tests |
| `packages/<name>` (`@opencode-ai/<name>`, bin `<bin>`) | Simple CLI shell (per shell branch) | Shape and artifact naming are decided by each shell branch, using the existing simple shell branch as reference; the core does not record specific names |

Decision rule: session pipeline, state-file protocol, prompt rendering, acceptance/commit mechanisms belong to the **core**; CLI shape (subcommands or not, usage text, argument parsing and config fixation policy, build artifact naming) belongs to the **shell**.

## B. One-way dependency

- Shells import `@opencode-ai/auto-core/*` (core `package.json` `exports`: `"./*": "./src/*.ts"`, `"./templates/*": "./templates/*"`); templates are imported from `@opencode-ai/auto-core/templates/<file>` via `with { type: "file" }` (embedded into the binary at compile time).
- **The core does not know shells**: packages/auto-core must not import any shell package; default behavior = the general shell's status quo — with no profile set, core messages are byte-identical to historical behavior.
- **Shells never depend on each other**: shell packages never import one another; they share only the core.
- Each shell package must ship its own `src/templates.d.ts` shim (path-string types for `*.md`/`*.json` imports; without it, cross-package template imports all go red); do not remove `resolveJsonModule: false` from `tsconfig.json`.

## C. Difference injection (shell extension points)

Shell differences are injected exclusively through the following extension points; **shell branches must not modify packages/auto-core** — core needs get their extension points added on the auto-core branch first:

1. `setShellProfile` (src/shell.ts): message program name (program/bin), recovery guidance for a missing agent contract (agentRecovery: `"init"` | `"startup"`), log audit semantics (auditLog), and the agent profile (agent: `{ name, host }` — the `AgentHostFactory` that starts the shell's coding agent; absent = the built-in adapter chosen by `OPENCODE_AUTO_AGENT` — opencode by default, or the claude headless adapter `claudeHost` from `agent/claude/host`, plans/0041; what the agent cannot do is read from its client capabilities and degraded by the core at run start, plans/0040); set once at shell entry startup. Example for a simple shell: `{ program: "<shell name>", bin: "<bin>", agentRecovery: "startup", auditLog: true }`.
2. `registerTemplate` (src/template.ts): registers additional prompt templates and tier-1 protocol markers; takes precedence over built-ins, with target-directory overrides highest; `_partials` refuses wholesale registration — individual shared-partial sections register via `registerPartial(name, text, markers?)`, and target-directory `_partials.md` overlays of protocol-sensitive sections are validated against tier-1 markers (same enforcement as template-level markers). Project-local override surfaces need no shell code: `.opencode/auto/prompts/` (templates), `.opencode/auto/modes/` (modes), `.opencode/auto/intents/` (intent packs, since M1; loaded by the core at preflight, same-named file replaces the whole built-in pack). **Trust boundary** (same as modes, which set the precedent): these overlays are project-local files injected verbatim into prompts, so a checked-out target repository that ships `.opencode/auto/` is trusted exactly as far as its own `AGENTS.md` and source are — the core validates only structure (tier-1 protocol markers of templates and partial sections, pack headings), never intent. Running the driver on an untrusted repository means running that repository's instructions; review `.opencode/auto/` like any other code before a run.
3. Parameter passing: shell CLI parsing results flow in via runAll Opts / runTool arguments (newSession, managed server handle, testByDriver/handoverTest and other existing switches).

**Changes shells must absorb when refreshing the core snapshot (task loop, M2, 2026-09-21):**

- **Retired switches** (D13, `plans/0044`): the `Opts` fields `verify` / `review` / `early` / `finalReview` and the config key `verify` are gone — a stored `verify: true` fails strictly. A shell still carrying `--verify` / `--review` / `--early-review` / `--early` / `--final-review` must drop them; `packages/auto` (`RETIRED_FLAGS`: usage error with a retirement notice) is the reference. The watchdog keys stay (`idleTime` / `idleMax`; `--verify-idle` / `--verify-max` get the rename hint).
- **New tier-1 markers**: an override of `wrapup` must keep `Result: PASS` and `Result: FAIL` — the report result line is the only completion-side verdict left, and `Result: FAIL` blocks the task.
- **Protocol strings flipped to English** (M2.4, `plans/0035` Amendment): `Status: continue|done`, `Artifacts:`, `## Scope` / `## Artifacts`. The pre-flip Chinese spellings are no longer read (M3.7, root plan open question 17 (a)): an override that still carries them fails the tier-1 check at startup as a usage error, so overrides must carry the English forms.
- **Legacy layouts refused** (M3.7, `plans/0047` §6 R3): `legacyLayoutProblem(dir)` (`auto-core/phases`) reports a root `PLAN.md` or a non-empty `docs/R-NN/` without `P<nn>-<type>/` directories. `runAll`'s preflight exits 1 with it before reading or writing anything. A shell should call it too before its own commands write to disk (`packages/auto` checks `init` / `continue` / `status` / `run` and leaves `reset` / `check` available). There is no compatibility read and no migration: old-layout projects finish on the release they started with.
- **Phase-face protocol strings flipped to English, no dual-read** (M3.8, `plans/0035` Amendment): `HANDOVER_SECTIONS` (`## Key decisions` / `## Constraints and pitfalls` / `## Required reading for the next phase` / `## Artifact index`), the `PHASE_NAMES` / `phaseText` vocabulary (Analysis/Design/Implementation/Testing/Acceptance/Knowledge distillation), the knowledge-doc terminator (`完成` → `DONE`), and refcheck's inline exemption markers (`已删除|已归档|历史` → `deleted|archived|historical`). An override template or a project doc still carrying the pre-flip spellings fails the tier-1 check (templates) or the exemption match (refcheck) at run time — there is no compatibility read, per the M3.7 ruling. A shell surfacing any of these strings in its own messages (as `packages/auto`'s stale-reference CLI hint does for the refcheck markers) must update the literal text too.
- **Agent contract and remaining AI-facing text in English** (M4.3): `templates/.opencode/agent/auto.md` is translated with its meaning unchanged. A project initialized earlier therefore holds a contract that differs from the template: `runAll`'s preflight warns, and re-running `init` refreshes it. A shell that writes the contract itself (`packages/auto` `init`) needs no code change, only the refreshed snapshot. The driver's inline AI-facing messages (the auto-answer, truncation steer, retry/recovery notes and the previous-round digest headings) are English too. None of them is a protocol string: no parser reads them, and the `AUTO-RESOLVE` / `AUTO-DECISION` line formats are unchanged.
- **Parallel planning level and reserved session count** (MP.1, `plans/0046` §8): the optional config key `parallel` (`none|low|medium|high`, absent = none, `PARALLEL_LEVELS` from `auto-core/config`) selects the `## parallelism` intent subsection injected into the planning prompts; pass it to `runAll` as `parallel` and to `implementPlan` in its config. `RunAllOpts.maxSessions` is reserved: `runAll` exits 1 for anything but 1. A shell that exposes neither needs no change — absence is today's behaviour. `packages/auto` is the reference (`init --parallel`, frozen on `run`; `run --max-sessions`).

## D. Branches and merge flow

| Branch | Responsibility |
|---|---|
| `auto-core` | Core development branch (packages/auto-core + packages/auto general shell; the general shell evolves with the core branch) |
| `migrate` | Simple shell development branch (auto-core snapshot + packages/auto + simple shell package; package name on that branch) |
| `auto` | Integration branch (all three packages; releases/tags are cut from auto) |

- **Core changes land only on the auto-core branch**; migrate shell changes land on the migrate branch.
- Shell branches periodically `git merge auto-core` to refresh the core snapshot — packages/auto is identical on both sides (always taking the auto-core side), conflict-free by construction.
- After compatibility, merge into the `auto` integration branch; releases and tags follow the auto branch.

## E. New-shell onboarding checklist

Create `packages/<name>` (bin named independently), using the existing simple shell branch's package as reference:

1. `package.json`: name `@opencode-ai/<name>`, bin `<independent name>`, `dependencies: { "@opencode-ai/auto-core": "workspace:*" }` (omit if the shell does not import the sdk directly), typecheck/test/build scripts.
2. Entry point calls `setShellProfile({ program, bin, agentRecovery, auditLog })` to set the shell profile.
3. Ship its own `src/templates.d.ts` shim and `tsconfig.json` (copy the shell package's version).
4. Ship its own `script/build.ts` (artifact `dist/<bin>`); templates keep the cross-package `with { type: "file" }` import.
5. Additional prompt templates are registered via `registerTemplate` (protocol-sensitive templates provide markers).
6. Run `bun install` at the repo root to refresh the lockfile; run tests inside package directories (tests cannot run at the repository root).

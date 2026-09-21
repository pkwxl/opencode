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

# AGENTS.md

Package-level notes for coding agents, kept lean: the core-mechanism documentation lives in the `../auto-core` package — file-level structure index in [../auto-core/docs/structure.md](../auto-core/docs/structure.md), the core/shell contract (boundary / dependency direction / merge flow) in [../auto-core/docs/shell-contract.md](../auto-core/docs/shell-contract.md), the retired target-directory behavior contract (historical, not maintained) in [../auto-core/plans/0029-behavior-historical.md](../auto-core/plans/0029-behavior-historical.md), and design documents in numbered `../auto-core/plans/NNNN-*.md`; user documentation in [README.md](./README.md).

## Overview

`@opencode-ai/auto` is the general CLI shell (bin `opencode-auto`): the init/continue/run/reset/check/status subcommands and argument parsing are concentrated in `src/index.ts`, and all mechanisms are implemented in the core library `@opencode-ai/auto-core` (workspace dependency, subpath imports, driving opencode through its v2 SDK interface for per-task automated execution). Comments and user-facing messages are written in English, using the terms in [../auto-core/docs/glossary.md](../auto-core/docs/glossary.md).

## Commands (run inside this package directory)

- `bun run dev -- <args>` — run the CLI directly from source.
- `bun run build [--target <platform>]` — produce the standalone executable `dist/opencode-auto`.
- `bun typecheck` — `tsgo --noEmit`.
- `bun test` — runs `test/` (CLI parsing / e2e).

## Package boundary

- This package contains only the CLI shell (`src/index.ts`), build scripts, and e2e tests; core src, templates, and design documents live in `../auto-core`.
- **The core does not know shells**: never duplicate core logic here; when a need touches a core extension point, change `../auto-core` first (shell differences are injected via the `setShellProfile` profile or `registerTemplate`).

## Build conventions (developing this program)

- **Templates must keep the `with { type: "file" }` import** (via the `@opencode-ai/auto-core/templates/*` subpath) — the only way to embed them into the binary at compile time. New init copy templates → the `templates` mapping in `src/index.ts`; prompt/mode templates are changed in the `../auto-core` package.
- `src/templates.d.ts` provides path-string types for `*.md` / `*.json` imports; do not remove `resolveJsonModule: false` from `tsconfig.json`.

## Config semantics of init / reset (read before changing)

- `init` defaults to **stateless full overwrite**: `.opencode/auto/config.json` is decided solely by the parameters given this time, with absent keys falling back to `CONFIG_DEFAULTS` (the flagless hand-edited keys `acceptanceGate` / `build` are kept). The only watershed is `base = amend ? existing : { ...CONFIG_DEFAULTS, ...handEdited }` in `src/index.ts`; `--amend` and `continue` take the existing config as the baseline. The two baselines load differently (plans/0052 D4): an amend carries every stored key over, so it loads strictly (`loadProjectConfig`); a full overwrite discards them, so `loadOverwriteBaseline` tolerates retired keys and `init` names each dropped one with its value.
- **Validate, then write** (plans/0052 D7): every refusal `init` can make — flag values, empty `-p`, mode, prefix guard, phase-directory sync (`plannedPhaseUnits`, the read-only half of `syncPhaseIndex`), the shortcut's non-empty task index, prompt-library and intent-pack validation — happens before the overwrite guard and the first write. A new check goes there too, never after `saveProjectConfig`.
- The phase-index prefix guard (completed phases in `docs/R-NN/phases.md` order must prefix the new value) judges the **effective value of this run** (`effectivePhases`), not "whether `--phases` was explicitly given" — otherwise a no-arg init would silently reset a staged project's phases to `"m"` and destroy the round layout. Any new path that affects `phases` must preserve this rule.
- The cleanup list and boundary rules of `reset` are documented in the header comment of `../auto-core/src/reset.ts` — read that entire comment before changing the list: only the config layer is cleaned, directories are always removed with `rmdir` (reclaimed only when empty, never `rm -r`), and the `opencode.json` shared with the main program is deleted only after a byte-for-byte comparison against the template.
- The two destructive paths (`reset`, and `init` overwriting an existing config) pass through the worktree-cleanliness gate (`../auto-core/src/clean.ts`) and the interactive confirmation (`confirm.ts`) before executing; `-f/--force` skips both; both checks must run before the first write to disk.

## Core invariants (read before changing)

See `../auto-core/AGENTS.md` (exit codes, constitutional config fixation, driver-exclusive state writes, unified commit, completion-decision contract; changes to the task-unit format must be synced with this package's e2e tests and the README format description).

## Maintaining this document

Keep it lean: new mechanisms add one navigation line here; details go into the corresponding `../auto-core/plans/` numbered document (stage-scoped) or `../auto-core/docs/` (durable architecture).

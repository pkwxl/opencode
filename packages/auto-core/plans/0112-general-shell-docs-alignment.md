# 0112 — The general shell's docs alignment: the post-v0.2.0 refresh and F5's landing

Status: **executed 2026-10-21 — the checkpoint ruled (all as drafted), W1 + W2 + the 0112 INDEX row landed; verification identical to the baseline.** This round Derives: **P14** (one-way dependencies through declared seams — the shells' own docs carry the shell-side posture, the core's constitution deliberately silent; 0111 F5's routing realized), **P5** (single ownership — the disclaimer's one governing home stays `docs/principles.md`; the README section renders with a pointer, never a second governance copy) and **P19** (measured evidence — §1's census, every claim cited). Tier touched: **documentation only** — no principle, no requirement, no mechanism; no release (no design-axis change).

## 0. What this round is

The core landed two documentation-layer rounds since the general shell's last doc pass — 0110 (the constitution family created, the core AGENTS.md/structure.md re-keyed) and 0111 (P21, the boundary disclaimer, the development conventions, v0.2.0). Zero src change in either. The general shell evolves with the core branch (shell-contract §D), so its code is current; what drifted is its documentation: the shell's AGENTS.md never learned the constitution family exists, and F5's routing (the shell-side security posture lives with the shells' docs) is recorded only in the core's releases.md — not in the shell a user actually reads. This round closes both, changes no code, and touches no core file.

## 1. The measured ground (the census, all citations)

- **The shell's currency.** `packages/auto` last changed at `486e93893` (0103 addendum two, 2026-10-18); the rounds 0105–0103-addendum-two each landed their README/AGENTS updates in-commit, so the shell's docs are current through 0109. Since then the core landed exactly 0110 and 0111 — both documentation-layer, both verified "zero src change" in their journals.
- **The code baseline, measured today.** `packages/auto`: `bun typecheck` clean; `bun test` **134 tests / 0 fail / 8 skip** (2061 expect() calls, one file). This is the round's verification baseline — a doc-only change must leave it identical.
- **Gap 1 — the shell's AGENTS.md never learned the constitution family.** Its pointer paragraph (line 3) lists structure.md, shell-contract.md, the retired 0029 and "design documents in numbered `../auto-core/plans/NNNN-*.md`" — the re-keyed family (`docs/principles.md`, `plans/INDEX.md`, `docs/releases.md`, the derivation discipline) is absent. A coding agent working in the shell and reading only this file never learns the constitution exists or that the why-layer is answered from `docs/principles.md`, never by searching the corpus.
- **Gap 2 — F5's routing is nowhere in the shell's user documentation.** The README already carries the two guardrail statements in place (the read-only protections paragraph: "it is not a security boundary"; the test-channel paragraph: "a convenience trade-off, not a security boundary") — but no consolidated posture section, no naming of the secrets family as the standing hard security requirement (it lives only inside the registry section's prose), and no statement of where the daemon's operational posture lives.
- **F5 needs no authoring in the service shell.** `packages/auto-server/docs/daemon.md` already documents all four posture facts — the whitelist (its own section), token auth and scopes (its own section), the `127.0.0.1` default bind ("The daemon binds `127.0.0.1` by default", line 23), and the probe-as-POST ruling ("the probe is a POST on the models segment, not `?probe` on the GET"). The landing is the general shell's own statements plus the pointer.
- **MANUAL.md: no drift found** (current through 0109; 0110/0111 changed no user-facing command) — untouched by this round, a finding, not an edit.
- **No branch shell exists to refresh.** `migrate` and `auto` are frozen by contract (shell-contract §D); the service shell is in-tree and documented. There is no snapshot merge to do anywhere.
- **The README's core-corpus references** are exactly two `packages/auto-core/plans/` mentions (both to 0002) — both resolve; nothing to repair.

## 2. W1 — the shell AGENTS.md gains the constitution-family pointers

One line, the pointer paragraph (line 3) widened in the file's own lean style:

> Package-level notes for coding agents, kept lean: the core-mechanism documentation lives in the `../auto-core` package — the design constitution (the P-numbered principles, the requirement families) in [../auto-core/docs/principles.md](../auto-core/docs/principles.md), the design changelog in [../auto-core/docs/releases.md](../auto-core/docs/releases.md), file-level structure index in [../auto-core/docs/structure.md](../auto-core/docs/structure.md), the core/shell contract (boundary / dependency direction / merge flow) in [../auto-core/docs/shell-contract.md](../auto-core/docs/shell-contract.md), the corpus manifest [../auto-core/plans/INDEX.md](../auto-core/plans/INDEX.md) over the numbered design documents `../auto-core/plans/NNNN-*.md` (every decision block states its `Derives:`/`Amends:` and the tier touched — the derivation discipline, plans/0110), the retired target-directory behavior contract (historical, not maintained) in [../auto-core/plans/0029-behavior-historical.md](../auto-core/plans/0029-behavior-historical.md); user documentation in [README.md](./README.md).

Nothing else in the file changes; the "Core invariants" pointer (line 43) still resolves — every topic it names lives in the core AGENTS.md's Operational specifics after the re-key.

## 3. W2 — the README gains "Security posture and boundaries"

Placement: a new top-level section appended after "Blocking and recovery", before the eof marker — the end of the README is where the reference material lives, and the section is reference material. The two existing inline statements stay exactly where they are; this section consolidates the posture and routes each fact to its home. Drafted in full:

> ## Security posture and boundaries
>
> The guardrails this tool ships are accident prevention, not security boundaries — where a hard security
> property is required it is stated as a requirement, never assumed from a guardrail (the design
> constitution's boundary disclaimer, `packages/auto-core/docs/principles.md`):
>
> - **Read-only protections** — during `run` the driver makes the config files, the project brief, AGENTS.md
>   and the registry's project layer read-only and restores write access at run end: a guard rail against
>   accidental writes by the sessions it spawns; a same-user process can still bypass it.
> - **Driver-run test scripts** (`--test-by-driver`) — bypass the agent's permission system as a convenience
>   trade-off, equivalent to running the tests locally yourself.
> - **The standing hard security requirement** — the secrets family: registry keys and env values are
>   references (`{env:NAME}` / `{file:path}`), never literals, and logs, `models` output and error lines name
>   the reference, never a value (see the model registry section).
> - **The agent server** — the managed `opencode serve` child's lifecycle belongs to this tool (auto-start,
>   restart, shutdown; see "opencode server and agent selection"); an external instance reused through
>   `--server <url>` / `OPENCODE_AUTO_SERVER` is the operator's own to secure and repair.
> - **The headless service shell** — the daemon behind `opencode-auto-server` carries its own operational
>   security posture (the target-directory allowlist, token auth with scopes, the loopback-by-default bind,
>   the POST-not-GET model probe); it is documented with that package (`packages/auto-server/docs/daemon.md`),
>   not here — this CLI shares only the core with it.

The P5 note: the disclaimer's one governing home is `docs/principles.md`; this section is the user-facing rendering with its source named — the same pattern as AGENTS.md's principle summary ("full statements there alone"), not a second governance copy.

## 4. What this round deliberately does not do

- **No core change** — 0111 F5's record says core unchanged; the constitution, the disclaimer and the daemon posture docs are already landed where they belong.
- **No cross-shell coupling** — shells never depend on each other (shell-contract §B); the README's daemon mention is a factual user-doc pointer to where that product's posture lives, not an import and not a re-documentation.
- **No MANUAL.md change** — the census found no drift.
- **No code change, no release** — no design-axis delta (no principle, no mechanism); the INDEX row's release cell stays open until the next release event carries it.

## 5. Execution stages

1. **CHECKPOINT** — this document presented; proceeding requires the journal's approval line below (the D10 person gate transposed: an absent or unparseable line reads *awaiting review*, never *approved*).
2. **Land** — W1 (`packages/auto/AGENTS.md`) → W2 (`packages/auto/README.md`) → the 0112 row in `plans/INDEX.md` (post-baseline table, release cell *(open — ships with the next release)*); journal line per file.
3. **Verify** — `packages/auto`: `bun typecheck` clean and `bun test` identical to the baseline (134 tests / 0 fail / 8 skip); the references audit (every `../auto-core/...` link in the shell's files resolves on disk); the landed texts present; `git diff --name-only` names exactly `packages/auto/AGENTS.md`, `packages/auto/README.md`, `plans/INDEX.md` and this document — the core's docs/ and src untouched.
4. **Journal + commit at the maintainer's direction.**

*Resume: journal + `git diff` name the remaining work; stages 2–3 freely re-runnable; the checkpoint gate un-passable without the approval line.*

## 6. Checkpoint questions

1. **W1**: the AGENTS.md pointer line as drafted — approve / adjust?
2. **W2**: the README "Security posture and boundaries" section as drafted, appended after "Blocking and recovery" — approve / adjust / decline?
3. **Scope confirmations**: no core change, MANUAL.md untouched, no code change, no release — confirm?
4. **The 0112 INDEX row** at execution, release cell *(open — ships with the next release)* — confirm?

## Execution record

- 2026-10-21 — drafted: the census (§1, all claims cited), the two drafted edits (W1 the constitution-family pointers; W2 the security-posture section with F5's routing realized), the deliberate non-goals (§4), and the verification baseline (typecheck clean; 134/0/8). **CHECKPOINT: awaiting the maintainer's rulings — stages 2–4 held.**
- 2026-10-21 — **CHECKPOINT RULED (the approval line).** On the maintainer's direction "commit all changes and then execute `plans/0112-general-shell-docs-alignment.md`", the checkpoint questions were presented and the maintainer ruled, all answers as drafted: **W1 — approved** (the AGENTS.md pointer line widened exactly as drafted, §2); **W2 — approved** (the README "Security posture and boundaries" section as drafted, appended after "Blocking and recovery" before the eof marker; the two inline statements stay in place); **scope — confirmed** (no core change, MANUAL.md untouched, no code change, no release); **the 0112 INDEX row — confirmed** (post-baseline table, release cell *(open — ships with the next release)*). Stages 2–4 proceed, the closing commit under this same direction.
- 2026-10-21 — **stage 2, landed per the rulings**, one file at a time in the plan's order:
  - **packages/auto/AGENTS.md (W1)** — the pointer paragraph (line 3) widened exactly as drafted: the constitution and the design changelog added ahead of structure.md, the corpus manifest over the numbered documents with the Derives/Amends discipline named; nothing else in the file changed, the "Core invariants" pointer (line 43) untouched and still resolving.
  - **packages/auto/README.md (W2)** — the "Security posture and boundaries" section appended after "Blocking and recovery", before the eof marker, exactly as drafted: the disclaimer lead with the constitution cited, the five bullets (read-only protections, driver-run test scripts, the secrets family, the managed/external agent-server split, the service-shell daemon routed to `packages/auto-server/docs/daemon.md`). Pure insertion — 22 lines added, 0 removed; the two existing inline statements byte-untouched.
  - **plans/INDEX.md** — the 0112 row appended to the post-baseline table: principles P5, P14, P19; code homes the two shell files; release cell *(open — ships with the next release)*.
- 2026-10-21 — **stage 3, verification PASSED**: `packages/auto` `bun typecheck` clean; `bun test` **134 tests / 0 fail / 8 skip** (2061 expect() calls, one file) — identical to the §1 baseline; the references audit over AGENTS.md / README.md / MANUAL.md found every `../auto-core/...` link resolving on disk (no broken link); the landed texts present in all three targets; `git diff --name-only` names exactly the four ruled files — `packages/auto/AGENTS.md`, `packages/auto/README.md`, `plans/INDEX.md`, this document — the core's docs/ and src untouched, every other plans/NNNN-* original untouched. MANUAL.md unmodified (no drift found, §1's finding stands).
- 2026-10-21 — **stage 4, journaled and committed** under the maintainer's direction (the approval line's own instruction carries the commit).

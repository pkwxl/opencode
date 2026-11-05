# Step 005 — w0-premise-guard

Wave W0-governance · findings F22 (cross, no twin), 0165-201 (S18-05) · status: **done** 2026-11-05
Started 2026-11-05 · start HEAD 2e266c6ed · verified and committed same day.

## Scope (as enacted)

**F22** — the cross-ruling premise-drift pattern (S16/S18/S20): a later ruling amends a shared
surface without re-reading dependent rules (0057's wait, 0055's caches and tiers, 0041's permission
map); the process-level root of about a fifth of the register. Proposed guard: one template line —
"premises this ruling changes". **0165-201 (S18-05)** — the restated `SERVER_ENV` literal has no
drift ratchet against the switch registry; a rename in switches.ts would leave `manage()` reading
the old name silently.

The wave's ruling is **[plans/0167-premise-guard.md](../0167-premise-guard.md)** (Derives: P19;
tier: none — a development convention; Category scope with three changed homes), per the program's
rule that each wave gets its own numbered ruling.

## Changes

1. `plans/0167-premise-guard.md` (created) — the ruling: D1 the line and the duty (the decision
   block states `premises this ruling changes: <ids>`, the same change re-reads each named
   dependent; advisory grammar, never boilerplate, no parser — the bite at review and audit time);
   D2 the census it answers; D3 the companion ratchet.
2. `AGENTS.md` — the premise-guard line in Development conventions, beside the requirement-intake
   line (the corpus's ruling discipline is stated there; there is no template file to carry it).
3. `src/agent/opencode/server.ts` — `SERVER_ENV` exported (comment extended to name the ratchet);
   no behavior change.
4. `test/agent-env.test.ts` — the identity assertion `SERVER_ENV === SWITCH_ENV.server` inside the
   existing X1 describe block (the import test-side, D8-legal — the file already imports from that
   module), mirroring the file's registry enumeration.
5. `plans/INDEX.md` — the 0167 row (subject, census, D1–D3, homes).

## Verification

- `bun typecheck` — clean (exit 0).
- `bun test test/agent-env.test.ts` — **16 pass, 0 fail** (15 before; the ratchet test runs and
  passes; failure-for-the-defect confirmed by construction: the assertion compares the two
  spellings, either side renaming fails it).
- `bun plans/0165-review/tools/probe.ts` — P1–P5 sections all empty (INDEX grammar holds with the
  new row; P4 sees 0167's Derives tag and Category scope section).
- `bun plans/0165-review/tools/family-check.ts` — run post-commit (the tool reads the working tree
  but resolves chains from git, so an untracked plan crashes it mid-step): **0167: 3 rows, 3
  changed-paths, commits 1 — ok**; 0132 stays ok; 0126/0138 unchanged (out of scope, see the
  step-004 record).
- No other suite due: one exported const, no template, no prompt copy.

## Dispositions

- **F22** — fixed (step 005, this commit, ruling 0167): the guard line landed as a standing
  development convention with its citable ruling; the pattern's named instances stay recorded in
  0167 D2 and each rides its own finding's step (0057's wait → step 018/019; 0055's caches/tiers →
  step 057; 0041's permission map → steps 028–030).
- **0165-201** — fixed (step 005, this commit, 0167 D3): the ratchet asserts the identity test-side;
  `src/agent/env.ts`'s restated prefix confirmed already exercised through `driverVariable()` in
  the same file — no twin needed (S18-05's family note).

Residuals: none for these rows. The guard's effect is prospective (0166's remaining waves are its
first consumers — each wave ruling that changes a shared premise states the line); no retrospective
re-derivation of the corpus was attempted (the findings already enumerate the drifted pairs).

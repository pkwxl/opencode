# Step 008 — w0-tag-disposition

Wave W0-governance · findings 0165-178 (S02-05), F13 · status: **done** 2026-11-05
Started 2026-11-05 · start HEAD ad96f96db · verified and committed same day.

## Scope (as enacted)

The v0.3.0 git tag was never created (`git tag -l`: v0.1.0, v0.2.0 — re-verified this step); the
release spine's anchor missing for v0.3.0. The worker protocol forbids tagging without explicit
instruction, and the cut commit's own message already rules the act's owner ("the v0.3.0 git tag
the maintainer's act at this commit, as with v0.1.0 and v0.2.0" — `07036c2b5`, 2026-10-25,
verified this step). So the disposition is **deferred to the maintainer's explicitly instructed
act**, and this step's work is the durable record: the missing anchor named in the release's own
section so the next cut (step 070's reconciliation, step 081's release assessment) and any reader
of the spine finds it stated, not discovered.

## Changes

1. `docs/releases.md` (the v0.3.0 section) — a "Tag anchor — recorded missing" block after the
   findings disposition: the evidence, the cut commit `07036c2b5` as the anchor, and the
   disposition (the maintainer tags `07036c2b5` as v0.3.0, or the tag rides the next explicitly
   instructed cut alongside it).
2. This step record; the ledger rows (0165-178, F13 → deferred with the named act); the program.

No code, no templates; no numbered ruling needed — the disposition restates what the cut commit
and the 0166 program already rule (release, tagging and publication remain separate, explicitly
instructed actions).

## Verification

- Evidence re-verified this step: `git tag -l` → v0.1.0, v0.2.0; `git show -s 07036c2b5` → the
  v0.3.0 cut commit, 2026-10-25, its message naming the tag the maintainer's act.
- Documentation-only change; `bun typecheck` clean; no product suite due.

## Dispositions

- **0165-178** — deferred (step 008, this commit): the maintainer's explicitly instructed act —
  tag `07036c2b5` as v0.3.0 (or alongside the next cut); the missing anchor durably recorded in
  releases.md's v0.3.0 section so the final release assessment (step 081) carries it.
- **F13** — deferred with its twin (same act, same record).

Residuals: none beyond the deferred act itself. Step 081's release assessment must surface this
row to the maintainer at the W1/W6 gate.

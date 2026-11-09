# Step 001 — init: the 0240 program initialized

Program wave (no coverage item of its own — this record, the program document
and the INDEX row are the step's product) · status: **done** 2026-11-09
(started from HEAD `7a3f018f8` — the v0.4.0 cut commit; worked, verified and
committed in one session).

## Context

The 0166 remediation program completed (steps 001–081) and the v0.4.0 cut
landed at `7a3f018f8` with tags `v0.3.0` (at `07036c2b5`) and `v0.4.0`. The
maintainer instructed the durable continuation pattern ("build a prompt file
so that I can run it to continue all the jobs in sessions even if a session
breaks"): the 0166 protocol — same-text executable prompt, position on disk,
consecutive committed recoverable steps, the standing delegation amendment —
applied to the post-release queue the coordinating session enumerated and the
maintainer endorsed.

## What this step did

1. Created `plans/0240-post-release-continuation.md`: the executable prompt
   (Part A gate, Part B worker rules, the shell-merge step rules with the
   sanctioned `git merge --abort` exception and the frozen-branch exclusion,
   the append-steps rule, the no-push law), the status table (001–004 with
   the investigation and survey steps before the final audit), the coverage
   list (the seven standing failures by name, the D3 timing observation, the
   shell-snapshot refresh), the observations list (opt-in residuals), and
   this initial current position.
2. Created this step record; the `0240-continuation/` directory exists from
   now on for its steps' records.
3. Landed the INDEX row (0240, active-authority, P18/P6/P4 method-only,
   homes —, open).

## Design decisions recorded

- **Red-tests wave before shell-refresh**: the six auto failures and the one
  server drift live in packages the shell branches snapshot; fixing them on
  auto-core first means each shell merge lands green at 0 fail. A merge first
  would deliver the known-red suites to every shell.
- **The survey step before any merge**: the shell-contract's branch table
  names `auto` and `migrate` frozen (never merged into); `translate`,
  `quota`, `migrate-hw` and `dev` are not named by the contract and their
  roles (live shell branches or other work) are measured, not assumed — the
  census (shell-package presence, merge base, divergence) is the merge
  targets' authority, recorded in the program before the first merge.
- **Append-steps rule**: the 0166 table was fixed at init; this program's
  table grows by explicit append (next number, never renumber) because the
  red-tests wave's enactment shape is unknown until step 002 investigates,
  and the survey appends one merge step per confirmed branch.
- **No push, anywhere**: every push (including merged shell branches) is the
  maintainer's own act — stated in the prompt's first paragraph and the
  merge rules.

## Verification

No code, test or documentation home changed beyond `plans/INDEX.md` and this
program; the recorded baselines are the v0.4.0 cut's own verification at
`7a3f018f8` (core typecheck clean + 3319/0; auto typecheck clean + 173 pass /
8 skip / 6 fail — coverage items 1–3 by name; server typecheck clean +
177/1 — item 4 by name). The maintainer's push of the cut and tags may or may
not have happened; nothing here depends on it.

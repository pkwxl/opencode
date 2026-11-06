# Step 020 — w-secrets

Wave: W-secrets. Findings: 0165-130 (S17-04, S3, CONFIRMED — a credentialed external-server URL
printed whole on three driver lines), 0165-131 (S17-05, S3, CONFIRMED — the env-overlay name
check quotes a pasted .env line whole), 0165-133 (S17-07, S3, CONFIRMED — the X1 scrub's gaps:
the claude --version child without a profile env, and every driver-run project command
inheriting OPENCODE_AUTO_*). Started 2026-11-06 at HEAD `34c570655`.

## Scope

The secrets family's print and spawn surfaces: the one server-URL display rule, the env-name
echo's value side, and X1's letter extended to every child the driver runs with the spawn
census as the ratchet.

## Design ruling

Ruling **0180** ([0180-secrets-display-scrub.md](../0180-secrets-display-scrub.md)): D1
`displayUrl` in a new agent-domain leaf (src/agent/urls.ts — the models-describe helper lifted
to the one home) read by every URL-naming line, the driver domain reading the leaf through a
widened domain entry; D2 the env-name echo stops at the first `=`; D3 X1's scope extended —
the four project-command spawns over scrubDriverEnv(), the claude version child scrubbed
unconditionally, and the spawn census making every naked Bun.spawn site a documented allowlist
entry or a failure. Derives the Security family with P5/P12/P20/P16; premises — 0059 X1's
scope extended (the launcher crossing recorded), 0157 D4's "the one version child" corrected.

## Implementation order (the recovery map)

1. src/agent/urls.ts + the four URL lines + models-describe's lift.
2. models.ts's echo; host.ts's cliVersion.
3. The four scrubs (script ×2, regression, round-close) + the census test.
4. Pins (switches, models); fail-before; suites; bookkeeping; commit.

## Execution log

- 2026-11-06: step opened after step 019's commit (34c570655) in the same worker stretch; all
  three findings' records already in context from step 018's S17 read.
- The display rule's home went through three placements in one session, each rejected by the
  direction suite's own assertions — a driver leaf (the agent domain cannot import driver
  modules), the opencode entry's re-export (models-describe may not import the agent host, the
  one-way invariant) — and landed as a widened agent domain entry (a pure leaf beside the
  adapters): the suite's assertions doing exactly their job.
- The census initially flagged the direct git probes in git.ts and wall.ts — allowlisted as
  the git-children class they are (git reads no OPENCODE_AUTO_*; the git() helper scrubs
  regardless).

## Verification

- `bun typecheck` clean in packages/auto-core and packages/auto.
- auto-core full suite: **2991 pass, 0 fail** (153 files; the census test added, its lane
  manifest row landed with it).
- Fail-before: `git stash push -u -- src/` → the URL pin (the password in the run-start line),
  the echo pin (the secret quoted whole) and the census (the naked spawns) all red on the
  pre-change code; `git stash pop` restored everything.
- packages/auto suite: 157 pass, 5 fail — the same pre-existing fork/remove-fork baseline
  (step 031's wave).

## Close-out

Step done 2026-11-06. Ruling 0180 active-authority; the INDEX row, the AGENTS.md security
family's note, ledger rows 0165-130/131/133 and the program's status/current-position land in
the same commit. Residuals: the lane launcher's own children inherit the switches by design
(the driver's recursion); the masked URL still names host and port (the operator's endpoint).
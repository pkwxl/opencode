# 0180 — One display rule for server URLs, the env-name echo never quotes the value side, and X1's letter over every child the driver runs

Status: **active**. Ruled 2026-11-06 by 0166 step 020 (wave W-secrets), enacting 0165-130
(S17-04, S3, CONFIRMED — a credentialed external-server URL printed whole on three driver
lines), 0165-131 (S17-05, S3, CONFIRMED — the env-overlay name check quotes a pasted .env line
whole, echoing the secret into the strict-failure line the values are carefully withheld from)
and 0165-133 (S17-07, S3, CONFIRMED — the X1 scrub's gaps: the claude `--version` child without
a profile env, and every driver-run project command inheriting OPENCODE_AUTO_* — W1's exact
mechanism through the driver's own channel).

## Derives

Derives: the AGENTS.md Security family — "logs, models output and error lines name the name or
the reference, never a value" — all three halves are its letter. P5 shows in the first (one
display rule, one home: `displayUrl` in the agent domain's `agent/urls` leaf, every line that
names a server URL reading it — the `models` output's own copy lifted from models-describe; the
driver domain reads the leaf through a widened domain entry, the one-way invariant keeping it
off the agent host); P12 shows in the second (a strict-failure line that echoes the very secret
its neighbor lines withhold is the loud line teaching the wrong thing — the echo shows the part
before the first `=`, the value side never quoted; the section-name echoes stay verbatim, the
identifier positions they are); P20/P16 show in the third (X1's letter extended from "agent
processes" to EVERY child the driver runs — the script runner, the lane batch, the regression
slot and the round-close build spawn over scrubDriverEnv(), the claude version child scrubs
unconditionally, and the naked spawn is made a census matter: every Bun.spawn site states its
env or is a documented allowlist entry — file-copy helpers, git children, and the shell's lane
launcher, the driver's own `_lane` child that legitimately needs the switches). Tier: operating
— the security family's letter applied to named sites; no Tier I statement changes.

premises this ruling changes: 0059 X1's scope ("every process the agent's binary is" —
extended to every process the DRIVER runs; the lane-launcher exception recorded as the
deliberate crossing it always was); 0157 D4's "the one version child" (the claude adapter's own
`--version` child was the missed twin — scrubbed now, the pool's child already was). 
Re-readings: 0055 C4 stands (displayUrl is its enforcement at the URL lines); models-describe's
AUTO-DECISION stands (its helper became the shared home); agent/env.ts's crossing comment
stands (the domain entry list widened by one pure leaf).

## Category scope (0123 D1's discipline)

Family: *the secrets family's print and spawn surfaces*. Home-set: `src/agent/urls.ts` (new —
the one display rule), `src/models-describe.ts` (the lifted copy replaced by the shared rule),
`src/switches.ts` (the run-start switch line), `src/agent/opencode/server.ts` (the external
-server restart refusal), `src/agent/claude/host.ts` (the --server warning; cliVersion's
unconditional scrub), `src/models.ts` (the env-name echo), `src/script.ts`, `src/regression.ts`,
`src/round-close.ts` (the scrubbed spawns), `test/import-direction.test.ts` (the widened agent
entry list), `test/switches.test.ts`, `test/models.test.ts`, `test/spawn-census.test.ts` (new).
No frozen vocabulary changes: the masked URL forms and the `=…` echo are new line shapes, no
protocol literal or exit code touched.

## D1 — one display rule for server URLs

`displayUrl(server)` in `src/agent/urls.ts` (the models-describe helper lifted, made the one
home): the URL shown without its user information, as written when it carries none. Every line
that names a server URL reads it — the run-start switch line (`OPENCODE_AUTO_SERVER=<masked>`),
the opencode host's external-server restart refusal, the claude host's --server warning, the
`models` output. The agent domain keeps its leaf; the driver domain reads it through the
widened domain entry (a pure leaf beside the adapters — the one-way invariant keeps
models-describe off the agent host).

## D2 — the env-name echo never quotes the value side

The profile env parser's name check shows the part before the first `=` when the "name"
contains one (`"OPENAI_API_KEY=…"` — the natural misplaced .env line), never the text past it;
a name without one is shown verbatim (identifier positions are safe — the section-name echoes
stay as they are, the registry's own grammar).

## D3 — X1's letter over every child the driver runs; the census holds it

The script runner, the lane batch, the regression slot and the round-close build spawn over
`scrubDriverEnv()`; the claude adapter's `--version` child scrubs unconditionally
(claudeEnv(undefined) scrubs the base — the no-env profile was the gap). The ratchet is the
spawn census: every `Bun.spawn` site in src states its `env` or matches the documented
allowlist — file-copy helpers (cp over the tree, no project code), git children (git reads no
OPENCODE_AUTO_*; the git() helper scrubs regardless), and the shell's lane launcher (the
driver's own `_lane` child, which legitimately needs the switches — the crossing recorded).

## Residuals

- The lane launcher's own children (the `_lane` process and what it spawns) inherit the
  switches by design — the driver's own recursion; out of this family's scope.
- The userinfo-stripped URL still names the host and port (by design — the operator's own
  endpoint); only credentials are masked.

## Tests

- switches.test.ts: the run-start line over a credentialed URL shows the masked form (fail-
  before: the password in the line).
- models.test.ts: the pasted .env line as an env name fails with the prefix-only echo — the
  value never appears (fail-before: quoted whole).
- spawn-census.test.ts: the census over src (fail-before: the four naked project-command sites
  and the version child flag).

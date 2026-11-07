# Step 030 — w4-claude-boundary: claude adapter boundary + wall commit staleness vs 0138

Wave W4-wall-perms, findings 0165-040 (S20-04, S2), 0165-147 (S20-10, S3). Started 2026-11-07 at HEAD
`9c0152b97`; the tree was clean.

## Scope

The wall's session-side reach and its record's truth against 0138's committed-surface posture: the
claude headless adapter's contract translation (`src/agent/claude/contract.ts`, capabilities in
`src/agent/claude/client.ts`, `src/agent/opencode/client.ts`, the frozen `src/agent/types.ts`, the
fleet intersection `src/capability.ts` + `src/agent-pool.ts`), the wall close (`src/wall.ts`, its
WallCtx over LoopCtx in `src/loop-task.ts`/`src/loop.ts`), `src/external-dirs.ts`'s header comment,
and `src/status.ts`'s read-only rendering. Standing rulings 0041 (D2/D6/D7 the adapter and its key
map), 0055 (§8.5 the capability intersection), 0122/0147 (the stamps and the boundary), 0132/0155/
0188/0189 (the wall family as just landed), 0138 (the committed surfaces). The translation-vs-
capability fork the finding poses is resolved by the capability arm here; finding 033 (S18-01, step
058) keeps the adapter-wave translation question (probe, `//`-grammar, `additionalDirectories`).

## Recovery state (maintained during the step)

- Ruling: `plans/0190-wall-agent-boundary-commit.md` (created).
- Code: `src/agent/types.ts`, `src/agent/opencode/client.ts`, `src/agent/claude/client.ts`,
  `src/agent/claude/contract.ts` (comment row), `src/capability.ts`, `src/agent-pool.ts`,
  `src/loop-task.ts`, `src/loop.ts`, `src/wall.ts`, `src/external-dirs.ts` (comment), `src/status.ts`.
- Tests: `test/wall.test.ts`, `test/capability.test.ts`, `test/agent-claude.test.ts`; completed
  in-change (the recovery session): `test/agent-pool.test.ts` (the threading pin, the leadSplit
  precedent) + `test/fixtures/agent.ts` (FULL_CAPABILITIES carries the posture), and
  `packages/auto/test/e2e.test.ts` — the two wall e2e tests drove the seal under the fake claude
  fleet and now pin D1's refusal at CLI level (the close vocabulary stays at auto-core's wall and
  transfer-wall suites, which drive the boundary directly under a carrying fleet).
- Bookkeeping: this record, the program row/ledger/Current position, `plans/INDEX.md` (the 0190 row;
  the 0138 row annotated), `AGENTS.md` (navigation line), `packages/auto/README.md` (the agent table
  and contract paragraphs), `docs/structure.md` if a row's wording moves (checked: its wall row makes
  no untracked claim — no move).
- Next action if interrupted: see the program's Current position.

## Findings → decisions (summary; the ruling is the authority)

| finding | decision |
|---|---|
| 0165-040 | 0190 D1 — the carried posture is a declared capability (`AgentCapabilities.externalDirectory`, opencode true, claude explicitly false — the ninth conscious amendment of the frozen file); the fleet intersection (degradeAgents) carries the fact to the run (`Degradation.externalDirectory` → `StartedPool` → `LoopCtx` → `WallCtx`); the wall close refuses loudly ahead of the admission scan when the fleet lacks it (nothing mutated), teaching the opencode advance; status renders the limit for the statically resolvable agent choices. The translation arm is declined here on P19 grounds (the grammar claims are PLAUSIBLE-not-run) and stays step 058's (finding 033) — the capability seam is what makes its flip one line |
| 0165-147 | 0190 D2 — the wall commit carries its own deny: `opencode.json` joins the commit's pathspec exactly when git tracks it (the pre-0138/local-only floor byte-identical — an ignored file would fail the add); the commit message's false "(opencode.json is untracked machine state)" clause is restated (the record is the door→target ledger, redundant with the tracked deny when the file is tracked); the stale "untracked" comments in wall.ts and external-dirs.ts restated; 0138's INDEX row annotated with the missed homes; 0188's README residual (the contract paragraph's translation claim) disposes with the limit stated |

## Verification (2026-11-07, HEAD 9c0152b97 → the step's commit)

Recovery: the prior invocation landed the ruling and the full D1/D2 code and test homes (every
Category-scope row checked against the diff); owed were the INDEX row + 0138 annotation, the AGENTS.md
line, this section, and the program bookkeeping. The recovery session completed those and repaired
two consequences in-change: the shell e2e's two wall tests drove the seal under the fake claude fleet
— D1's refusal (the ruled behavior) made them fail — so they now pin the refusal's CLI shape (exit 2
ahead of the admission scan, nothing mutated, the remedy line, status's ⚠ row; the close vocabulary
itself stays at auto-core's wall/transfer-wall suites, which drive the boundary directly), and the
ruling's D1 threading claim (StartedPool at both start sites) gained the leadSplit-precedent pin in
`test/agent-pool.test.ts` with `FULL_CAPABILITIES` carrying the posture in `test/fixtures/agent.ts`.

- `bun typecheck` (auto-core): exit 0. `bun typecheck` (packages/auto): exit 0.
- auto-core `bun test`: **3062 pass, 0 fail** (153 files; 3056 at step 029's close + the 6 new pins:
  wall 3 — the refusal, the 0138 atomic commit, the status row; capability 1; agent-claude 1;
  agent-pool 1).
- packages/auto `bun test`: **149 pass, 8 skip, 5 fail** — exactly the standing baseline (2 fork +
  3 remove-fork, pre-existing, reproduced at HEAD by step 014); the two reshaped wall tests pass.
- Fail-before proven on pre-fix source (the five touched src files reverted to HEAD, tests kept
  fixed): **8 pins red** — wall's three-step-close message pins (the stale "untracked machine state"
  clause), the 0138 atomic commit, the D1 refusal, the status row's default-agent half, agent-claude's
  capability record + no-translation pin's capability half, agent-pool's threading pin, capability's
  intersection pin; the other 97 tests of the four suites green. The fixed files restored and
  verified byte-identical (`cmp` against backups; the claude client's backup name collided with the
  opencode client's in the proof scaffold — the file reconstructed from HEAD plus its exact 7-line
  hunk, the diff re-verified against the recovery-audit capture).
- Dispositions: 0165-040 → fixed (0190 D1); 0165-147 → fixed (0190 D2). 0188's README residual (the
  contract paragraph's translation claim) disposes with the limit stated. Residuals: 0190's named
  set (status's shell-injected agent, no run-start note for the general gap — 033/step 058's, the
  translation itself step 058's, a registry fleet's narrowing the operator's edit) beside 0189's
  standing set.

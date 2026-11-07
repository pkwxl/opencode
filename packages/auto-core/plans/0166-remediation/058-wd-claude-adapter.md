# Step 058 — wd-claude-adapter: the claude adapter's boundary teaching and its waits

Wave WD-routing, findings 0165-033 (S18-01, S2), 0165-136 (S18-03, S3), 0165-202 (S18-06, S4),
0165-203 (S18-07, S4). Started 2026-11-08 at HEAD `12772a9b6` (step 057's commit); the tree was
clean.

## Scope

The claude headless adapter's contract surface and process machinery (`src/agent/claude/contract.ts`,
`src/agent/claude/client.ts`), the opencode host's external connect health probe
(`src/agent/opencode/server.ts`), the capability degradation note family (`src/capability.ts`) and
its one caller with the directory (`src/agent-pool.ts`). Standing rulings: 0041 (D6/D7 the
translation contract and presets), 0122/0147 (the external_directory surface the translation skips),
0157 (the deferred P20 ceiling, its residual S18-03), 0190 (D1 the declared capability and the
translation arm deferred here with finding 033), 0040/0055 §8.5 (degradation and the fleet
intersection). The 0190 step-030 record read before ruling, as the program directs.

## Recovery state (maintained during the step)

- Ruling: `plans/0218-claude-adapter-boundary-waits.md` (created first).
- Code: `src/agent/claude/client.ts` (D2 the bounded closing wait + the kill ladder, D4 the busy
  model-mismatch refusal), `src/agent/opencode/server.ts` (D3 the health probe's timeout),
  `src/capability.ts` (D1's declared-section note, the opt), `src/agent-pool.ts` (D1's read of the
  target's section, threaded at both start arms), `src/agent/claude/contract.ts` + the capability
  comments (the translation arm's standing disposition restated).
- Tests: `test/agent-claude.test.ts` (D2, D4), `test/agent-server.test.ts` (D3),
  `test/capability.test.ts` + `test/agent-pool.test.ts` (D1).
- Bookkeeping: this record, the program row/ledger/Current position, `plans/INDEX.md` (the 0218 row),
  `AGENTS.md` (navigation lines), `docs/structure.md` (rows).
- Next action if interrupted: see the program's Current position.

## Findings → decisions (summary; the ruling is the authority)

| finding | decision |
| --- | --- |
| 0165-033 | 0218 D1 — the translation arm stays declined on P19 grounds (no `claude` CLI on any measured host; the three grammar claims of 0190's declined arm remain unrun); the enacted arm is the teaching one: one run-start degradation note when the target's `opencode.json` holds live `external_directory` entries and the fleet carries the posture nowhere, naming what the boundary loses and the opencode remedy |
| 0165-136 | 0218 D2 — the closing wait is bounded: `send`'s `await live.done` races a ceiling (5 s, the kill ladder's own scale); on the ceiling the kill ladder fires (`kill()`'s SIGTERM→5 s→SIGKILL) with one teaching line, and the wait that follows the kill resolves through the same ladder — the dispatch can no longer hang on a wedged child |
| 0165-202 | 0218 D3 — `defaultConnect`'s health probe carries `AbortSignal.timeout` (5 s, the managed spawn's own start bound); a timed-out probe teaches the timeout in the unavailable line |
| 0165-203 | 0218 D4 — a model change reaching a busy claude process is refused loudly (`ok: false`, the process's model fixed per start named) instead of silently running the wrong model; the idle model-change restart and the model-matching steer floors byte-identical |

## Verification (2026-11-08, HEAD `12772a9b6` → the step's commit)

- `bun typecheck` (auto-core): exit 0. `bun typecheck` (packages/auto, packages/auto-server): exit 0.
- auto-core `bun test`: **3197 pass / 0 fail** (156 files = the 3190 baseline + 7 net new pins:
  agent-claude 3 — the wedged-ceiling pin, the delayed-close floor, the busy-model refusal;
  agent-server 2 — the never-answering socket with the timeout taught, the refused-connection
  floor; capability 1 — the note unit with both labels and both floors; agent-pool 1 — the
  threading pin over a declared target, registry and single-host arms, the bare-target floor).
- Fail-before proven on pre-fix source (the six changed src files swapped to `git show HEAD:`,
  tests kept fixed, over /tmp/058-fixed): **5 pins red** — D2's wedged pin red by its own 10 s
  timeout (the finding's unbounded `await live.done` verbatim — the dispatch never resolved),
  D4's refusal pin red on `{ok: true}` (the silently-ignored model change, the message written to
  the fixed-model process), D1's capability pin and D1's pool pin red on the absent note, and
  agent-server red at the file level (`Export named 'defaultConnect' not found` — step 024's
  precedent for a pin over a surface the pre-fix module does not export). The floors green on
  pre-fix source (the delayed-close child waited out with no ladder and no line; the other 76
  pre-existing tests of the four touched files). The fixed files restored and cmp-verified
  byte-identical against the /tmp/058-fixed backups.
- Shells: packages/auto **159 pass / 8 skip / 6 fail** — the exact recorded baseline (the five
  pre-existing fork/remove-fork failures plus the "roadmap-driven establishment" step-050 drift,
  an exit-2 gate stop unchanged by this step). One in-change repair beyond the fixtures, the
  step-030 precedent: the wall e2e "undeclared floor" test pinned its whole run log free of the
  word "wall", and the ruled note (D1) lawfully names "any wall's standing deny" in that run —
  the pin reshaped to the wall MACHINERY's own markers ("plan wall close", "wall-door:",
  "wall-sealed:", "the wall cannot close"), absent exactly as before, the git-history check
  untouched. packages/auto-server **142 pass / 2 fail** — the exact recorded baseline (the two
  step-050 drift names verbatim, no auto-server source touched).
- Dispositions: 0165-033 → fixed (0218 D1); 0165-136 → fixed (0218 D2); 0165-202 → fixed
  (0218 D3); 0165-203 → fixed (0218 D4). 0157's deferred P20-ceiling residual discharged (D2).
  Residuals: 0218's named set (the translation arm's probe recipe, the SIGKILL-surviving child,
  the pump-side timerless await, the connect-path-alone clock, the mid-turn model-change
  adapter guard's two routes) beside 0190's standing set.

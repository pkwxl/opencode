# Step 059 — wd-restart-serialization: the clamp's remedy, the window-curable resume, the host's close

Wave WD-routing, findings 0165-128 (S16-06, S3, CONFIRMED), 0165-129 (S16-08, S3, CONFIRMED),
0165-135 (S18-02, S3, PLAUSIBLE). Started 2026-11-08 at HEAD `a7d312f6e` (step 058's commit); the
tree was clean.

## Scope

The capability clamp's one blocking error (`src/capability.ts`), the strict-resume eligibility
verdicts (`src/router.ts` over `src/select.ts`, consumed by `src/resume-gate.ts` through
`src/unit-commit.ts`), and the managed opencode host's restart/close overlap
(`src/agent/opencode/server.ts`). Standing rulings read before ruling: 0040/0083 D9 (the clamp and
its error's condition), 0055 §8.3/§10 item 11 (the eligibility and dead-session verdicts),
0022 3.1③④ (the strict rollback), 0178 (the restart-safe-boundary family), 0186 D2 (the
one-in-flight restart), 0218 (step 058's ruling over the same server.ts — the seams and ceiling
vocabulary kept consistent). Evidence: plans/0165-review/S16-routing.md (S16-06, S16-08),
plans/0165-review/S18-agent-adapters.md (S18-02), the register rows at 0165 §5.

## Recovery state (maintained during the step)

- Ruling: `plans/0219-clamp-remedy-window-curability-host-close.md` (created first).
- Code: `src/capability.ts` (D1 the error's remedy), `src/router.ts` + `src/select.ts` (D2 the
  window-curability arm; comments restated in `src/resume-gate.ts`/`src/unit-commit.ts`),
  `src/agent/opencode/server.ts` (D3 the closed host's restart guard and the in-flight drain).
- Tests: `test/capability.test.ts` (D1), `test/unit-commit.test.ts` + `test/resume-gate.test.ts`
  (D2 — the 0055 §10 item 11 pin re-pointed in the same lockstep), `test/agent-fake.test.ts`
  (D2 — the binding suite's dead pin re-pointed to the gone-model shape, the window shape becoming
  the failover pin; the full run discovered this suite pin encoding the amended letter), 
  `test/agent-server.test.ts` (D3).
- Bookkeeping: this record, the program row/ledger/Current position, `plans/INDEX.md` (the 0219 row
  + 0055's annotation + the repair of step 058's malformed row — written with 3 cells against the
  table's 6, split mechanically with no content change), `AGENTS.md` (four navigation lines),
  `docs/structure.md` (three rows).
- Discovered outside scope, recorded not fixed: none new (the 0218 INDEX row repair is bookkeeping,
  enacted in passing beside the adjacent row this step adds; S18-04 — a restart that throws
  mid-way leaving the host on a closed server — is finding 137's, owned by WC-hygiene, untouched).
- Next action if interrupted: see the program's Current position.

## Findings → decisions (summary; the ruling is the authority)

| finding | decision |
| --- | --- |
| 0165-128 | 0219 D1 — the clamp's error teaches the per-key remedy (`opencode-auto amend <dir> --test-by-driver false --handover-test false`, the pair amend's own refusal honored) and, under a registry that names the forcing agent, the fleet alternative — the re-init teaching is gone |
| 0165-129 | 0219 D2 — the eligibility verdict splits by curability: a recorded model blocked only by its window (not down, not ring-spent, not filtered, not below the cap, still in the call's list, opening at a known instant) is eligible-with-wait — the session is not dead, the reuse keeps the accumulated context and the next dispatch waits or fails over per §6.2's own law; rollback stays for gone/filtered/marked/never-opening shapes. 0055 §10 item 11's "outside its windows … not eligible" letter amended |
| 0165-135 | 0219 D3 — the host's close and restart are made safe against overlap: a `closed` flag refuses restarts before they spawn and drains the spawn of an in-flight restart (the fresh instance closed at once, one teaching line) — the 0186 D2 join unchanged, the serial driver's close byte-identical |

## Verification (filled at the step's end)

- `bun typecheck` exit 0.
- auto-core full suite **3204 pass / 0 fail** over 156 files (the 3197 baseline + 7 net new:
  capability +1, unit-commit +1, resume-gate +1, agent-fake +1, agent-server +3), zero regressions.
- Fail-before proof over /tmp/059-fixed (the six changed src files backed up, `git show HEAD:./`
  pre-fix versions swapped in, the pins run, the fixed files restored and cmp-verified
  byte-identical): **7 pins red on pre-fix source** — D1's remedy pin (the "Re-init" tail, neither
  remedy clause), D2's verdict pin (eligible false + the dead why — the finding's own trace), D2's
  ladder pin (the strict rollback), D2's binding pin (the redo path, the session never prompted),
  D3's drain pin (the fresh instance unclosed, the url moved to it — the orphan verbatim), D3's
  joiner pin (both true, the fresh instance unclosed), D3's after-close pin (the late restart
  spawning, answering true). The floors green on pre-fix source (223 pre-existing tests of the five
  touched files).
- The re-pointed pins: unit-commit's item-11 pin (the outside-its-windows arm moved to the new
  eligible-with-wait pin; the dead arm keeps marked-down/gone) and agent-fake's binding dead pin
  (moved to the gone-model shape; the window shape became the failover pin) — 051's 0059 D7
  precedent, ruled in 0219's premises-changed clause.
- No shell suite re-measured — no packages/auto or auto-server surface touched.
- Status: **done** 2026-11-08; step 059's commit is this step's own commit (the SHA recovered from
  git history by the next invocation).

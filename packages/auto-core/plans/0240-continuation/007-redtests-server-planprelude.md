# Step 007 — redtests-server-planprelude

Program 0240, wave red-tests · status: **done** 2026-11-10 (opened at HEAD
`03c7d93f4` — step 006's commit; worked, verified and committed in one
session, branch `auto-core`). Authority: ruling
[0241](../0241-redtests-root-causes.md) **D3** (finding 3, coverage item 4) —
the wave's ruling, already written and landed by step 002; this step is
enactment only, no new ruling number.

## Scope

The planPrelude boundary matrix in `packages/auto-server/test/ops.test.ts`
(row 3, the drift row at :628–:648) lockstepped to 0206 D2's refusal shape:
after the released analysis's `R-01 adm` roadmap line widens the round,
`POST /projects/<name>/plan` returns **409, code 1**, the differs/transfer
fragments, and **nothing written** — the index byte-identical to its
established shape, no widened-phase directory (P02-design), no moved
open-todo seed (P03-implement absent, P02-implement still present). The
row's comment and the file header's "drift re-sync" phrase (:22) restate
the 0206 channel (plan refuses before any write naming transfer as the
reshape's apply; the committed re-derivation is the advance's alone). The
product stands (0206 D2's refusal): no auto-core and no auto-server src
change — 0206's own category completeness completed late (the family's
home-set had a member the change missed). The form mirrored is
`packages/auto/test/e2e.test.ts`'s lockstepped drift describe (0206's own
diff). Fail-before is the standing red (the known step-050 drift).

## Session log

- 2026-11-10 (this worker): step opened at HEAD `03c7d93f4` (verified
  `git log -1 --format=%h`, tree clean, branch `auto-core`). Program and
  ruling 0241 read (D3's disposition and the Category-scope row naming this
  file's :22 and :628–644); step marked `doing`, this record created. The
  0206 D2 text and the CLI mirror (packages/auto's drift describe) read as
  the form. The "re-sync" route-label mentions in auto-server's src
  comments (ops.ts :171/:837/:896) and docs/daemon.md :287 checked: they
  label the m-mode arm 0206 D2 explicitly kept (its tail the single phase,
  `phaseTailDrift` never reports one — unreachable), not the retired
  phased apply — 0241's Category scope already measured these homes
  untouched; no new observation.
- 2026-11-10 (fail-before at this HEAD): the focused matrix run
  (`bun test test/ops.test.ts -t "the planPrelude boundary matrix"`)
  **0 pass / 1 fail** — red at `expect(resynced.status).toBe(200)`:
  received **409** (the exact standing red of 0241 finding 3, unchanged
  from step 002's reproduction and every recorded baseline since 0166
  step 050). A one-run body-dump probe (a console.log beside the failing
  expect, replaced by the real edit below) captured the 409 body verbatim
  at this HEAD — byte-identical to step 002's measurement: `code: 1`,
  `lines` carrying "the phase index of round R-01 differs from the roadmap
  of docs/analysis.md: transfer re-derives the unstarted tail on its own
  commit — run: opencode-auto-server transfer <dir>".
- 2026-11-10 (the edit): row 3 rewritten to the refusal shape — 409,
  `code` 1, three `has()` pins (the differs opening naming the roadmap
  source, the transfer-apply teaching, the full `run: opencode-auto-server
  transfer ${dir}` command — the dump showed the plain dir form), then the
  nothing-written block (the index read before the POST and asserted
  byte-identical after; P02-design absent, P03-implement absent,
  P02-implement's open todo still in place — the moved-seed arm the old
  row pinned from the other side). The row's comment now teaches the 0206
  channel and names the CLI mirror; the file header's "the drift re-sync"
  became "the drift refusal naming transfer".
- 2026-11-10 (green at the fix): the same focused run **1 pass / 0 fail**
  (56 expects, up from 29 — every refusal and nothing-written assertion
  reached).

## Verification

- `packages/auto-server` full suite (`bun test`): **177 pass / 1 fail**
  (178 tests, 26 files, 2292 expects, 96.7 s) — the drift row green; the
  one fail is the recorded host-environment IPv6 row ("an IPv6 bind writes
  a bracketed transport URL (0165-169)", `EADDRNOTAVAIL` on `::1` — the
  program's observation, not a coverage item). This host therefore reads
  exactly the predicted post-fix state (pre-fix 176/2; the recorded
  177/1 v0.4.0-cut baseline was this suite minus the now-fixed drift on an
  IPv6-capable host — which now reads 178/0).
- `packages/auto-server` typecheck (`bun x tsgo --noEmit`, the touched
  shell): exit 0.
- `packages/auto-core` `bun typecheck`: exit 0; full suite **3319 pass /
  0 fail** (the recorded baseline) — no core source changed, the
  tree-state check.
- No auto-core src/ or template/ path and no auto-server src/ path touched
  (`git status` names only the three step paths at commit time); 0206 D2's
  refusal in the core and the daemon's serving of it stand untouched.

## Dispositions

- **Coverage item 4 (auto-server planPrelude boundary matrix)** — FIXED by
  this step (0241 D3): the server's row 3 lockstepped to 0206 D2's refusal
  shape; the product's refusal stands; the row green at the fix, fail-before
  the standing red re-confirmed at this step's HEAD (the 409 body captured
  verbatim). With this, the server half of the seven-name baseline is gone
  — the red-tests wave's remaining step is 008 (the frozen-key split), then
  the shell-refresh wave (003+).

Committed as `0240: step 007 done — …` over the step's three paths (the
program document, this record, the test file); the commit's SHA lands as
the next step's start HEAD when that step opens (the program's start-HEAD
chain, the 0166 convention).

# Step 017 — w-cleanroom-policy

Wave: W-cleanroom-policy. Findings: 0165-051 (S25-05, S2, CONFIRMED — the charter's
verify-plan-audit sends every dimension's findings to shared audit.md, contradicting the
phase's declared per-task findings.md owner), 0165-052 (S25-06, S2, CONFIRMED — the
source-free receipt rule has no enforcement at the raw-log boundary: driver and manual
receipts copy arbitrary red-lane evidence into session-visible files). Started 2026-11-06 at
HEAD `5eda65465`.

## Scope

The cleanroom compliance policy's two ownership holes: the charter's audit-plan artifact
ownership (taught to match the phase's declared contract) and the source-free receipt rule's
enforcement (the declared `Evidence:` channel at the raw-log boundary — driver receipts, the
synthesized gap list, the regression run record, and the manual master's copy).

## Design ruling

Ruling **0177** ([0177-cleanroom-evidence-channel.md](../0177-cleanroom-evidence-channel.md)):
D1 the charter's verify-plan-audit ownership sentence repaired to the declared owners (each
dimension's own `docs/T-NNN/findings.md`, the closing task consolidating into audit.md), pinned
by a bundle test joining the charter's artifact sentences to the declared sets; D2 the lane
table's optional `Evidence: <repository-relative path>` field — the declared source-safe
evidence channel: a declaring lane's red evidence (receipt, gap list, regression run record)
quotes the channel file alone, never the raw log; a missing/empty channel is itself the loud
evidence line; an undeclared row keeps today's bounded log tail (the floor); the manual master's
rule mirrors it (the verdict from the wrapper's exit-code line alone for a declaring row); the
cleanroom pack's divergence example declares the channel and the charter names it as the
mechanism behind "counts and note ids alone". Derives P5 with P7/P16/P10/P12; premises — 0096
D3's grammar grows additively (the lockstep in this change), 0121 D5/D10's clauses stand and
gain their mechanism, 0098 D3/D5's evidence source changes only for declaring rows.

## Implementation order (the recovery map)

1. `src/intent/test-lanes.ts`: the Evidence field (grammar, validation, the type).
2. `src/script.ts`: redLaneEvidence + laneOutcome's channel read (dir threaded in);
   `src/regression.ts`: the slot's evidence through the helper.
3. `templates/bundles/cleanroom/intents/cleanroom.md`: the three text sites;
   `prompts/run.md`: the manual receipt rule's channel clause.
4. Tests (lane-table grammar + the channel flow, the bundle pin, the ratchet clause); fail-before;
   full suites; bookkeeping; commit.

## Execution log

- 2026-11-06: step opened after step 016's commit (5eda65465) in the same worker stretch. The
  shipped pack's lane table read (the rows are commented examples the person fills — the
  channel is taught by the example, enforced by the parser); the manual ratchet's pinned
  literals and its P16 no-family-name line checked before touching run.md (the new clause
  speaks the grammar alone); the MANIFEST digests confirmed computed-at-install (no pinned
  bytes broken by a prompts edit).
- Implementation landed per the map. The channel-flow fixture needed its tmp/ created (the
  redirect fails without it — which the missing-channel case pins anyway).

## Verification

- `bun typecheck` clean in packages/auto-core and packages/auto.
- auto-core full suite: **2982 pass, 0 fail** (152 files; 2980 at step 016's close).
- Fail-before: `git stash push -- src/intent/test-lanes.ts src/script.ts src/regression.ts
  templates/bundles/cleanroom/intents/cleanroom.md prompts/run.md` → all four new tests red on
  the pre-change code (the grammar rejects the Evidence line; the receipt carries the raw log's
  dirty line verbatim — the finding's byte flow; both text pins missing); `git stash pop`
  restored everything.
- packages/auto suite: 157 pass, 5 fail — the same pre-existing fork/remove-fork baseline
  (step 031's wave).

## Close-out

Step done 2026-11-06. Ruling 0177 active-authority; the INDEX row, the AGENTS.md cleanroom
navigation line, ledger rows 0165-051/052 and the program's status/current-position land in the
same commit. Residuals: the channel's content is the command author's warrant (the driver
checks the grammar, never judges source-freeness — the compliance monitor's audit finding); the
raw log remains readable at its path by a session that goes looking (the standing Log-field
design — this ruling closes the receipt-and-gap-list boundary the finding measured).
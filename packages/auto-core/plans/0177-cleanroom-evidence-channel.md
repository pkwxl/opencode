# 0177 — The cleanroom policy's two ownership holes: the charter teaches the declared artifact owners, and the source-free receipt rule gains its enforcing channel

Status: **active**. Ruled 2026-11-06 by 0166 step 017 (wave W-cleanroom-policy), enacting
0165-051 (S25-05, S2, CONFIRMED — the charter's verify-plan-audit sends every dimension's
findings to shared audit.md, contradicting the phase's declared per-task findings.md owner) and
0165-052 (S25-06, S2, CONFIRMED — the source-free receipt rule has no enforcement at the raw-log
boundary: driver and manual receipts copy arbitrary red-lane evidence into session-visible
files).

## Derives

Derives: P5 — single ownership — the ruling's spine, both halves. 051 is the direct case: the
charter (which claims precedence over the phase template) assigns every audit dimension's
findings to the one file the phase reserves for the closing consolidation — the exact
many-writers-one-document collapse 0120/0124 retired, taught by the corpus's own precedence
rule. 052 is ownership of a boundary: the raw log is the driver-side monitor's lawfully-dirty
record, and the receipt is a session-readable document — nothing owned the transformation
between them, so `writeLaneReceipt` (and the manual master's copy) pasted the log's tail
verbatim, breaching the output wall the charter's "counts and note ids alone" clause promises.
P7 shows in the enforcement's shape (a grammar the driver defines — the `Evidence:` row field,
the receipt's evidence block — never a judgment of content); P16 in the category-wide rule (the
policy rides a DECLARED lane capability; no core code keys on a lane or family name, the
ratchet's own no-cleanroom-in-run.md line standing); P10 in the floor (an undeclared row's
receipt is byte-identical — every existing non-compliance lane unchanged); P12 in the missing
channel's loud line (the absence is surfaced, never papered over with the log). Tier: operating
— P5/P7 statements applied to the cleanroom bundle's policy surfaces and the lane-table grammar;
no Tier I statement changes.

premises this ruling changes: 0096 D3's lane-table grammar grows the optional `Evidence:` field
(additive, strict-parsed, the lockstep in this one change: parser, pack teaching, receipt read,
manual rule, tests); 0121 D5/D10's charter clauses STAND and gain their mechanism (the
"counts and note ids alone" sentence was a promise with no enforcer — the channel is it);
0098 D3/D5's receipt evidence source changes only for declaring rows (the floor unchanged).
Re-readings: 0120 D2/0124 D1 (the audit artifact owners) stand — the charter now teaches them;
0154's receipt provenance stands (the evidence block is content, the machine fields untouched);
0151 D1's lane-log seam stands (the log stays where it is — the monitor's record).

## Category scope (0123 D1's discipline)

Family: *the cleanroom compliance policy* (the charter's audit-plan ownership and the
source-free receipt rule's enforcement). Home-set:
`templates/bundles/cleanroom/intents/cleanroom.md` (verify-plan-audit's ownership sentence; the
divergence clause's mechanism sentence; the divergence example row's channel declaration),
`src/intent/test-lanes.ts` (the `Evidence:` field — grammar, validation, the type),
`src/script.ts` (redLaneEvidence; laneOutcome's channel read), `src/regression.ts` (the slot's
evidence through the same helper), `prompts/run.md` (the manual master's receipt rule — the
channel clause, the exit-code-line verdict read for declaring rows), `test/lane-table.test.ts`,
`test/bundle.test.ts`, `test/manual-prompts-ratchet.test.ts` (the pins). No frozen vocabulary
retired: the lane-table grammar grows additively (P13's lockstep honored in this change); the
receipt's machine fields (Lane/Heads/Start/End/Verdict/Log/Carried) are untouched; the evidence
block of a DECLARING row changes source (the channel), an undeclared row's bytes identical.

## D1 — the charter teaches the declared artifact owners

verify-plan-audit's ownership sentence is repaired to the phase's declared contract (0124's one
grammar): each compliance dimension is its own audit task with its findings written to **its
own findings document** (`docs/T-NNN/findings.md`, the phase's declared task artifact), the
closing task consolidating the findings documents into `audit.md` — the shared-audit.md
wording that contradicted the declaration is gone. A bundle pin joins the charter's artifact
sentences to the declared sets (the phase's Phase-artifacts audit.md verdict.md /
Task-artifacts findings.md and the charter's own text), so the contradictory sentence cannot
ship green again.

## D2 — the source-free evidence channel: a declared lane capability

The raw-log boundary is ruled category-wide: a lane row may declare
`Evidence: <repository-relative path>` — the lane's **source-safe evidence channel**, a file
the command writes beside its raw log (its source-free summary: counts, note ids, risk bands).
For a declaring row, the red receipt's evidence block (and the synthesized gap list, and the
regression slot's run record — every session-readable surface) quotes the **channel alone**,
bounded by the same evidence cap; the raw log is never quoted into any session-readable record.
A missing or empty channel on a red run is itself the evidence line — the absence surfaced,
naming the monitor as the log's reader, never papered over with the log's tail (P12). An
undeclared row keeps today's bounded raw-log tail — the byte-identical floor. The manual
master's rule mirrors it: for a declaring row, the verdict comes from the log's exit-code line
(the wrapper's own line, source-free by construction — no other line of the log read) and the
receipt's failure region from the channel file. The shipped cleanroom pack's divergence example
declares the channel, and the charter's divergence clause names it as the mechanism behind
"counts and note ids alone". No core code names a lane or family (P16): the policy is the
declaration's, the machinery generic.

## Residuals

- The channel's CONTENT is the command author's warrant (the driver checks the grammar, never
  judges source-freeness — P7: content quality is acceptance work); a lying channel is the
  compliance monitor's audit finding, the same posture as the charter's other declared facts.
- The raw log itself remains readable at its path by a session that goes looking (the receipt's
  Log field names it — the standing design); this ruling closes the RECEIPT-and-gap-list
  boundary the finding measured, not the filesystem's.

## Tests

- lane-table.test.ts: the `Evidence:` field parses (with the divergence-example shape), the
  path discipline rejects absolute and `..`, the undeclared floor keeps no key; a red
  runTestLanes over a declaring row — the receipt quotes the channel's line and never the log's
  dirty line; a missing channel's loud absence line (fail-before: the receipt carries the raw
  log's dirty line verbatim).
- bundle.test.ts: the charter↔declaration pin (the findings-document sentence present, the
  shared-audit.md sentence absent, the channel sentence and the example row's declaration
  present).
- manual-prompts-ratchet.test.ts: the channel clause pinned in run.md's regression hold (and
  the P16 line still green — no family name in run.md).

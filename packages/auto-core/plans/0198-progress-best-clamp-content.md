# 0198 — The progress bound is the loop's best, and the clamp re-records only a content-proven line

Status: **active**. Ruled 2026-11-07 by 0166 step 038 (wave W7-verify), enacting 0165-003
(S11-02, S1, CONFIRMED — 0146's progress rule compares with the previous round's gap count, not
the best: an oscillating count 2,1,2,1… resets the no-progress streak on every down step, so a
whack-a-mole verifier/fixer pair never blocks and the unattended loop spends rounds without
mechanical bound; the ruled `2 + N` bound is false in code, and false in arithmetic besides) and
0165-022 (S12-03, S2, CONFIRMED — the charter clamp's re-record locates its line by the first
index that matches by recorded position OR by a substring-equal question: a stale line number
rewrites whatever line now sits there, and an earlier unrelated marker whose question is a
substring of the flagged item's is overwritten — its recorded decision destroyed — while the
flagged wide default stays in force in the document; the OPEN line still tells the person the
clamp took effect).

## D1 — the progress rule keys on the loop's best

**The defect.** `noProgress = gapsNow < lastGaps ? 0 : noProgress + 1` compares each FAIL's
count with the **previous** count. Oscillation — round n closes a gap and round n+1's fresh
verification breaks another (the common LLM shape, measured at 0165 verification as 11 fix
rounds over 2,1,2,1…, never blocked) — resets the streak on every down step. 0146 D3's bound
("between two no-progress rounds a progress round must strictly shrink the count, so a loop
starting from N gaps runs at most 2 + N rounds") was a proof error twice over: the shrink it
leans on is against the previous round (which oscillation satisfies every other round), and even
a best-count comparison yields 2N+2, never 2+N. The block condition (`round >= FIX_ROUNDS &&
noProgress >= FIX_ROUNDS`) was therefore reachable only by monotone or constant stalls, never by
oscillation — P2's "every automatic escalation is bounded" was not true of the loop's own
escalation.

**The rule.** Progress is measured against the **best** — the minimum count this loop instance
has measured, seeded by the loop's first FAIL and lowered only by a FAIL that strictly beats it:
`noProgress = gapsNow < bestGaps ? 0 : noProgress + 1; bestGaps = min(bestGaps, gapsNow)`. A
round that re-closes a gap its own predecessor's regression re-opened (2 → 1 → 2 → 1) is not
progress — the count must beat the loop's best, which oscillation never does twice.

**The bound, corrected.** A progress round strictly lowers the best; the best starts at N (the
seed FAIL's count) and, on the FAIL path, cannot go below 1 (the shape gate demands at least one
countable heading). So at most N−1 progress rounds can fire, each followed by at most one
non-progress round without blocking, plus the two terminal no-progress rounds that block: at
most **2N** rounds in practice, **2N + 2** as the ruled bound (holding even if a zero-count
measurement were ever possible). The header comment and this ruling carry the corrected
arithmetic; 0146's D2/D3 wording is amended below.

**Persistence.** The wrapup stage's `gaps` field becomes the best (the minimum measured) — the
field's name, shape, sanitize rule (`sanitizePhaseRound`) and every persist site are unchanged;
only the meaning is restated (resume.ts's and runner.ts's field comments, wrapup.ts's
`wrapupStage` comment). Monotone and constant sequences are **byte-identical** under either
reading (best equals last there — the two readings differ exactly on the defect's oscillation
shape), so every existing pin, the block message ("the last two fix rounds closed no gap (N fix
rounds spent, the gap list still counts K)") and the booking/lifecycle rules stand verbatim. A
record persisted by the pre-0198 code (last, not best) resumes as a looser best after a
run that had oscillated — the transient cross-version window named as a residual; the sanitize
floor (a lost baseline delays the streak by one FAIL, never blocks early) is 0146 D4's own and
stands.

## D2 — the clamp's re-record is content-proven

**The defect.** `lines.findIndex((line, index) => index === lineText - 1 || sameIssueLine(line,
item))` takes the **first** index satisfying either disjunct. The position disjunct checks no
content at all (a line number stale since the scan — the document edited, the marker moved —
rewrites whatever line now sits at that index, marker or not); the question disjunct is
`sameIssue` — substring containment after whitespace removal — so an **earlier** marker whose
question is a substring of the flagged item's ("wire format" inside "wire format for exports")
wins the race: the earlier marker's recorded decision is erased by the re-record, the flagged
wide default stays in force in the document the handover and the prompts read, and the ⚡ OPEN
line still tells the person the clamp took effect. The module's own header ("a marker whose
line no longer matches (edited, moved) is ledger-clamped only") promised a content test the
code never ran.

**The rule.** The recorded line number is a **hint, never an authority**: the line at the
recorded index is accepted only when it parses (`parseResolveLine`) to the item's **exact**
question — equal after `normalize` (whitespace- and case-insensitive), never substring
containment — **and** to the same option (equal after `normalize`, undefined matching
undefined, the malformed-marker shape included). Otherwise the file is searched for lines
passing the same exact test: exactly one match re-records there (the moved-but-unchanged
marker, found by content — the header's "moved" case now actually handled); no match, or
several (an ambiguous duplicate), rewrites **nothing** — the item is ledger-clamped only, the
ledger mark and the ⚡ OPEN line still landing (the person's surface is never suppressed by the
document's own ambiguity). Position alone, and substring likeness, never authorize a write into
a process document's content.

**What stands.** `sameIssue` itself is unchanged for its own consumers (the driver↔agent ledger
pairing and the repeated-question escalation, 0020/0082's pairing rule) — those matches pair
ledger entries, they never rewrite a document line; the substring latitude is a pairing rule,
not a write authority. `clampMarkerLine`'s re-recorded form, the clamp grammar, the ledger
fields and the surfacing line are verbatim. `normalize` is exported from resolve.ts (additive)
as the one normalization home the exact test reads — no second normalizer (P5).

## Derives

Derives: **P2** (the person brackets every boundary — the showing: "every automatic escalation
is bounded, and the terminal of every bounded path is the person" is P2's own sentence, and the
oscillating loop's escalation was unbounded — the fix grounds the bound on the loop's measured
best, 2N+2 rounds, still terminating at the person via 0146's ladder) — D1. **P3** (progress is
measured from the verification channel's committed artifact, the countable gap list, never the
fix session's claims — unchanged in kind, made true in arithmetic) — D1. **P6** (derived,
minimal state: the measure re-derives from the committed gaps file at every verification; what
persists stays the existing two numbers riding the existing stage record — no new kind, no new
field) — D1. **P7** (grammars, never content — D1's comparison is arithmetic over the heading
count alone; D2's rewrite is a mechanical re-record of a marker-grammar line, and precisely
because the driver writes content-shaped lines only under its own grammar, the locator must
prove the line **is** this item's marker by that grammar's parse — position and substring
likeness prove nothing a write can lean on) — both. **P12** (fail loud, conservative under
uncertainty — an uncertain location resolves toward no-rewrite, ledger-only, never a guess that
destroys a neighboring decision while leaving the flagged grant in force) — D2. Tier: operating
— no Tier I statement changes; P2's derivation line in principles.md ("fix rounds
(progress-gated, never count-capped…, 0146 amending 0083 D5)") stays true as written, the
arithmetic beneath it corrected here.

premises this ruling changes: **0146 D2/D3** (the progress arithmetic — the comparison base
becomes the loop's best, the bound 2N+2; the block condition, the message, the booking and the
lifecycle rules stand); **0146 D4** (the `gaps` field's gloss — "the count the last FAIL
measured" becomes "the minimum this loop's FAILs have measured"; the shape, the sanitize rule
and the persist sites stand); **0082 D12's re-record half** (the clamp's document rewrite — its
locator premise, recorded position or question likeness, is replaced by the content-proven
test; the ledger half, the surfacing line, the charter-check caller and the floors stand).

Re-readings: 0083 D5/D7 stand (the ladder, the stage record's shape and the round's booking —
untouched); 0146's named residuals (gap trading at a constant count; grammar compliance
backstopped by the shape gate) stand as ruled — the oscillation case was **not** among them and
was a defect, now fixed; 0184 D1 stands (the charter's range derivation shares no surface with
the measurement); S11-07's whole-file marker re-booking (the item set the clamp iterates) stays
step 039's scope, untouched here.

## Category scope (0123 D1's discipline)

Two families, one change:

- **D1 — the fix-loop progress rule.** Code homes: `src/wrapup.ts` (the measurement, the
  `FIX_ROUNDS` comment block and header, `wrapupStage`'s comment), `src/resume.ts` (the stage
  field's meaning comment; `sanitizePhaseRound` unchanged), `src/runner.ts` (the resume
  threading's comment). Test homes: `test/verify-loop.test.ts` (the oscillation case that must
  block, and the persisted-best pin; the existing monotone, resume and lane-gate pins
  byte-identical), `test/repair-loop.test.ts` and `test/incident-regression.test.ts` (monotone
  scripts — unchanged, green as-is). Vocabulary: none changed — the block message verbatim, the
  stage record's field names and shapes untouched (internal driver state, meaning restated in
  comments; P13 untripped).
- **D2 — the charter clamp's re-record.** Code homes: `src/charter-clamp.ts` (`clampItem`'s
  locator, the module header's promise), `src/resolve.ts` (`normalize` exported, additive).
  Test homes: `test/charter-clamp.test.ts` (the two-marker substring shape, the moved-line
  shape, the ambiguous-duplicate ledger-only floor). Vocabulary: none changed — the marker
  grammar, the re-recorded line's form and the ⚡ OPEN line verbatim.

## Residuals

- The cross-version resume window (a pre-0198 record's `gaps` read as a looser best after an
  oscillating run) — transient, self-correcting at the next persist; accepted with D1.
- 0146's standing residuals (constant-count gap trading; grammar compliance) — as ruled there.
- `sameIssue`'s substring latitude for **pairing** stands by 0082's design (recorded, not
  reopened); no write path consumes it after this change.

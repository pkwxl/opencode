# 0176 — The release gate reads strict: an unreadable destination blocks, never certifies

Status: **active**. Ruled 2026-11-06 by 0166 step 016 (wave W-release), enacting 0165-034
(S19-02, S2, CONFIRMED — release certifies a destination whose git it cannot read: the
clean-tree check takes the legacy-typed statusEntries (unreadable → []), unitAddedLines skips a
failed diff, and a corrupt index yields two ⚠ lines then "✓ … no process references" with exit
0).

## Derives

Derives: P12 — fail loud; conservative under uncertainty — a failed git read is never a clean
verdict, and the release gate read exactly that: the unreadable status answered [] (check 1
passed), the failed scan diff contributed no lines (check 2 scanned nothing), and the ✓ certified
a destination whose repository the driver could not read — after two ⚠ lines that a scripted
release step scrolls past. P1 shows in the same defect's consequence (the release moment is P1's
only enforcement, and a degenerate scan presented as a pass is the same construction that closed
0165-004's S1 — the certificate must state what was actually scanned). P10 in the floors: a
readable destination certifies byte-identically; the round-time callers of the same reads keep
the recorded-count posture their own plans rule (the flag is additive, the partial data
unchanged). Tier: operating — P12/P1 statements applied to the release gate's reads; no Tier I
statement changes.

premises this ruling changes: none — 0103's gate ruling stands (its two checks, the removal
wording); 0155 D1's NAMED DEFERRAL ("release's clean check stays quiet-clean") closes here, the
discipline extended to the gate that deferral carved out. The round-time callers' floors stand
(0119 D2's ledger, the round scans) — visibly unchanged, the flag ignored where no verdict rides.

## Category scope (0123 D1's discipline)

Family: *the release gate's read posture* (what the gate's two checks read, and how the scan
inputs carry a failed read). Home-set: `src/release.ts` (the clean-tree check, the scan block's
unreadable problem), `src/git.ts` (unitAddedLines' and unitChangedFiles' read state — the
`unreadable` flag beside the unchanged partial data), the round-time callers' mechanical access
(`src/execute.ts`, `src/round-close.ts`, `src/work-order.ts`), `test/release.test.ts` (the
S19-02 repro), `test/doc-lanes.test.ts` and `test/document-roles.test.ts` (the access shape).
No frozen vocabulary changes: the gate's exit codes and the ✓ line's shape are untouched; the
two functions' return types are internal surfaces (module-exported, all callers in this change).

## D1 — the clean-tree check reads strict; the scan blocks on its input's read state

releaseCheck's check 1 asks `statusEntriesRead` — an undefined read is a blocking problem
("… git status unreadable …; repair the repository, then re-run release"), never the legacy
typed empty list. Check 2's input carries its own state: a destination whose scan could not be
read (the toplevel probe or the diff failed over any of its repositories) is a blocking problem
naming the same remedy — the ✓ line states what was scanned (0173 D1), and a scan that read
nothing over an unreadable repository states nothing.

## D2 — the scan inputs carry the unreadable flag beside the unchanged data

`unitAddedLines` answers `{ lines, unreadable }` and `unitChangedFiles` `{ files, unreadable }`:
the lines/files are the same partial set as before (a failed repository contributes nothing,
exactly today's per-repository skip — the round-time callers' data is byte-identical), and
`unreadable` names that at least one repository's read failed. The callers consult it where a
verdict rides: release blocks (D1); the round-time scans (execute's round scan, round-close's
ledger, work-order's standalone scan, the shape checks) keep the recorded-count floor their
owning plans rule — the flag is present at each site, a future ruling's ready input (P21: the
surface is a fact, not a half-built mechanism).

## Residuals

- None named for the gate. The round-time callers' record-vs-block decisions remain their owning
  plans' (the loop-side clean gates' family, 0155's standing residual list).

## Tests

- release.test.ts: the S19-02 repro — a destination whose index is corrupted after the driver
  commit: check 1's blocking problem names the unreadable status, no ✓ line lands, exit 2's
  problems list is non-empty (fail-before: the current code prints the ⚠ lines and certifies).
- The access-shape updates in doc-lanes/document-roles pin the flag's default (false over a
  readable repository).

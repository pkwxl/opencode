# 0158 — the documents/parsers lockstep completions — CRLF never a silent empty parse, the person's AGENTS.md prose never rewritten, a near-miss round brief never rides verbatim, and two lockstep leftovers carried (the default pack's scaffold, the manual twin's lane-log wording)

Ruled from the 2026-10-30 three-package review of the auto tool family (the same review as
0155–0157, its documents/parsers/templates pass): the grammar parsers of the target directory's
own documents were walked asking two questions — *does a byte-level variant of the same content
yield a different verdict*, and *did every lockstep change of the recent plans actually reach
every surface of its vocabulary*. Five findings, each verified against HEAD 89122329b before the
change, plus a hygiene set the same review surfaced.

## The measurement (the review's file:line evidence, all verified)

- **A CRLF checklist is an empty checklist** (`src/tasks.ts` `subtasks()`): the item regex ends
  `(.*)$`, and `.` never matches `\r` — a line ending `\r` (a CRLF file split on `\n`) fails the
  match wholesale, so a Windows-line-ended `docs/T-NNN/subtasks.md` parses as an EMPTY checklist:
  `readChecklist` returns `[]`, `scanSubtaskStates` sees the protocol inactive, the pipeline
  silently routes a decomposed task down the whole-task path. No error anywhere — the P12
  "swallowed into a clean verdict" class, verified by execution.
- **A CRLF roadmap is not a roadmap** (`src/roadmap.ts` `ROADMAP_LINE`, the same `(.+)$` shape):
  `roadmapRounds` finds nothing, while `analysisProblems`' near-miss scan
  (`ROUNDLIKE_BULLET`, unanchored at the end) flags every well-formed CRLF line as a
  non-parsing bullet — so the release was held fail-loud, but over lines a correct reader of the
  same grammar would parse, and the hold's message named decorated bullets as the cause.
- **`ensurePointer` normalizes the person's own prose even when the driver block is unchanged**
  (`src/agents-block.ts`): `text.replace(/\n{3,}/g, "\n\n")` ran unconditionally, BEFORE the
  canonical-block comparison — a file whose driver block already matched (`"unchanged"`) but whose
  person prose held 3+ consecutive newlines (deliberate spacing) was rewritten with the person's
  whitespace collapsed, a write outside the driver's own block reported as "unchanged". The
  sibling collapse fix one line below was already correctly gated on `legacyRemoved`.
- **A near-miss round-brief heading drafted after a released subsection installs as the wrong
  round's content** (`src/analysis.ts` `roundBriefProposals`): any line under `## Round briefs`
  that was neither a `#{1,2}` heading nor an exact `### R-NN` head joined the CURRENT
  subsection's body — so `#### R-06 notes` drafted after a valid `### R-05` in an
  already-released document was silently absorbed into R-05's body, and
  `releasedRoundBriefProposal` installed it verbatim into R-05's `round.md`. The near-miss
  discipline (`analysisProblems`) runs only at the project-start release; the living-governance
  flow (0115: "a subsection added to a released document later installs at that round's open")
  never re-checks — and the scan's own comment claimed such a heading "would silently install
  nothing", wrong for exactly this shape.
- **The 0109 lockstep missed the default pack's planning-input scaffold**
  (`templates/intents/default.md`): commit 906568bdc (0109) retired the round user report to a
  person-commissioned optional document and re-keyed the three bundles' `## planning-input`
  scaffolds to the standing surfaces (the round's AUTO-RESOLVE records, `driver-helper`'s list) —
  but missed the default pack, the majority surface and the one `plan --scaffold` prints for
  non-bundle projects: it still pointed the person's answers at `docs/R-NN/report-for-user.md`'s
  needs-attention items, a document the rounds no longer write.
- **The manual twin kept the pre-0151 lane-log wording** (`prompts/run-task.md`): the 0151 second
  lockstep re-keyed the driver-channel copy (`templates/prompts/_partials.md`) to "under the
  lane-log dir (/tmp/opencode/ by default)" — the `OPENCODE_AUTO_LANE_LOG_DIR` seam 0151 was
  ruled from — but never touched the manual suite, nor recorded the divergence as deliberate.
  Manual-suite children inherit the person's environment (no driver env scrub in that mode), so
  with the redirect set — the fork-comparison backtest scenario — concurrent manual arms collide
  in the shared `/tmp/opencode/` again. Not pinned by `test/manual-prompts-ratchet.test.ts`.

## D1 — CRLF reads as content, never as a silent empty parse

Both parsers normalize `\r\n` → `\n` once at entry (the phase-type file's precedent,
`src/phases/custom.ts` — normalize the text, never the regex): `subtasks()` in `src/tasks.ts`,
and `roadmapRounds()` in `src/roadmap.ts` through the exported `normalizeNewlines`. The release
gate's near-miss scan (`analysis.ts` `nearMissHeads`) reads the SAME normalized view — one
grammar, one verdict: a line the reader parses is never flagged as a non-parsing bullet, and the
rounds a CRLF document plans are the rounds its release admits. The review's sketch of instead
extending the release-hold message to name CRLF as a cause was dropped as dead wording: with
both readers on one view, CRLF alone can no longer reach the near-miss list (a lone `\r` not
preceded by `\n`, the classic-Mac ending, remains unparseable — exotic, and the message's
decorated-bullet population is unchanged and still accurately named).

## D2 — the collapse is the removal's cleanup, never a normalization pass

The `\n{3,}` collapse (and the trailing-newline fix beside it) now runs only when a legacy block
was actually removed (`legacyRemoved`) — the only shape that opens gaps the collapse exists to
clean. The person's prose is never rewritten while the driver block is unchanged, and a replaced
block rewrites only the block slice itself (the person's spacing around it stands there too).

## D3 — the grammar decides: a near-miss heading terminates the subsection it follows

In `roundBriefProposals`, a heading-shaped line (`#{3,6} ` — levels 1/2 already end the section)
that is not an exact `### R-NN` head now terminates the current subsection: body collection
stops until the next exact head, so a near-miss drafted after a valid subsection never rides
verbatim into that round's installed brief — the living-governance flow's own extractor holds
the line the release scan cannot (it never re-runs). A near-miss still installs nothing as its
own round (the exact head alone parses, the unpadded `### R-6` form still legal). The
`analysisProblems` comment now states the true behavior. And the round's open — the one moment
the person is looking — names what happened: `roundBriefNearMissNote` (analysis.ts) returns one
ℹ teaching line when a RELEASED document carries a near-miss heading naming the round being
opened, wired beside the round-start-gate teaching of transfer's `establishStop` and plan's
m-mode establishment (both bounded by the brief-still-stub condition — once the person fills
`round.md` by hand or fixes the heading, the line stops). Heads naming other rounds stay silent
at this round's open: their own rounds' opens name them, so a document is never scanned loud for
a round it is not opening.

## D4 — the default pack's scaffold re-keyed (the 0109 completion)

The default pack's two scaffold lines now read exactly as the three bundles' — the intro names
the round's own records ("the last round recorded"), the answer source the standing surfaces
(`the round's AUTO-RESOLVE records — the task reports' "Proxy-answered questions" sections;
driver-helper renders the standing list`), never the retired report. One wording across all
four packs; `plan --scaffold` prints it for every non-bundle project. The INDEX row annotates
0109's completion.

## D5 — the manual twin's lane-log wording (the 0151 completion)

`prompts/run-task.md`'s testing phase and `prompts/run.md`'s regression-lane launch (the same
defect class in the same suite, found while re-keying the first) now name the lane-log dir as
the seam it is — "under the lane-log dir (/tmp/opencode/ by default)" — the driver channel's
exact 0151 wording. The ratchet test pins both (`run-task.md` beside the lane-protocol paths,
`run.md` beside the phase-close literals). The INDEX row annotates 0151's completion.

## The hygiene (same change, each trivial)

- `src/intent/test-lanes.ts` (`anchorLaneOf`'s comment): the closing sentence contradicted the
  code — regression rows are filtered out of `rows` first, so a task naming one falls to the
  none-named fallback and may still receive the table's single anchor-cost row. The comment now
  says that.
- `src/phases.ts` `currentRound`: the `^R-(\d+)$` readdir scan now checks `entry.isDirectory()`
  (the sibling `legacyLayoutProblem` already did) — a regular file named like a round is not a
  round.
- `src/brief.ts` `briefProposal`: strips HTML comments ahead of the extraction, the
  round-brief extractor's discipline exactly — the two proposal channels one rule (an editorial
  comment inside a brief proposal installs without the comment; the eof terminator, previously
  filtered by its own punctuation-set entry, is now simply a stripped comment).
- `src/status.ts`: the round header reuses `roundDirName(round)` (docpaths the single
  construction point, P5) instead of hand-formatting `R-${padStart}`.
- `src/provenance.ts` `provenanceNoticeLine`: the aggregate clause's advice now matches the
  divergence it names — only a file the running bundle still SHIPS without the stamped sections
  draws "a stale binary disables sections just as silently — upgrade the tool"; a file the
  bundle no longer ships (which also reads `direction: "binary-older"` in the comparison) is a
  divergence in either direction — a newer binary may have retired it deliberately — and names
  the gap with sync as the reporting channel, never the upgrade. The per-file part was already
  accurate and is unchanged.
- `src/sync.ts` `planSync`: the sidecar rewrite rides only when the rendered stamp differs from
  the sidecar on disk — a report-only plan over a stamped project (person-edited paths keep
  their original entries, current paths re-derive the same ones) renders the byte-identical
  stamp, and the dryrun's exit gate (`syncWritesAnything`) counts nothing; a real change (a
  fast-forward's new digest, an add, a retirement shrinking the managed set, the bootstrap's
  first sidecar) always differs and always rides.
- `src/tasks.ts` `syncChecklistTicks` (the lanes tick re-derivation, only caller
  `src/lanes.ts`): its first direct test home — the fixture drives the parser, the state scan
  and the writer the lane landing composes.

## The floors and named residuals

- The floors: a bare `\r` (not part of `\r\n`) inside a line still fails both line grammars —
  conservative, and no such document has been observed; `ensurePointer`'s insert/replace
  branches byte-identical (they never depended on the unconditional collapse); an EXACT
  `### R-NN` head still absorbs its body to the next heading exactly as before; the bundles'
  scaffolds untouched; `_partials.md` untouched; `syncWritesAnything`'s signature and the
  bootstrap's adopt-write unchanged; the person-edited stamp entry still never rewritten.
- The named residuals: a near-miss heading that names no round at all (`#### Notes`) silently
  terminates the subsection it follows — the release scan names it only at the project start,
  and the note at the round's open keys on the round being named (the grammar's own round id);
  a CRLF `docs/T-NNN/todo.md`-family document outside the two fixed parsers keeps whatever
  tolerance its own reader already had (the unit-document readers all trim — safe — and no
  other grammar of this family splits lines without one). The driver-helper "Needs your
  attention" free-content scan (`src/driver-helper.ts`) — an unregistered English-phrase scan
  over free content, the mildest P7/P13 smell — is deferred to its own small ruling, named
  here.

Derives: **P12** (the showing: D1 — a CRLF checklist parsed as empty and the pipeline silently
routed on it; the fixed parsers read the same bytes as content), **P13** (the showing: D4/D5 —
the two lockstep vocabularies carried in one change, the retired report's wording gone from the
last surface, the lane-log seam named in the manual twin; D1 — the release scan and the runtime
reader share one view of one grammar, never two verdicts for the same bytes), **P15** (the
showing: D4 — the scaffold is policy data in the template, re-keyed with the bundles' standing
surfaces, no code involved), **P5** (the showing: status.ts's one construction point reused;
the two brief-proposal channels one extraction rule), **P7** (the showing: D3 — the near-miss
rule is the grammar's own heading shape, never a content judgment; the install-time note keys
on the same grammar's round id), **P2** (the showing: D3's ℹ line at the round's open — the
person's drafted-looking subsection surfaces at the boundary they are looking at), **P10** (the
showing: the floors above — LF documents byte-identical everywhere, the unchanged AGENTS.md
block now truly unwritten, the report-only sync dryrun exiting 0). Amends: **0109** (the
default pack's planning-input scaffold re-keyed — the lockstep completion, the bundles'
standing-surfaces wording now all four packs) and **0151** (the manual suite's lane-log
wording — the lockstep completion, both files of the manual twin) in the trailer and INDEX
annotations, plus **0115's D2/D3 extraction semantics** (a near-miss heading now terminates the
subsection it follows instead of joining its body — the install-at-that-round's-open rule holds
for exact heads alone). Tier touched: **mechanism** — core (`src/tasks.ts`, `src/roadmap.ts`,
`src/analysis.ts`, `src/transfer.ts`, `src/plan.ts`, `src/agents-block.ts`, `src/phases.ts`,
`src/brief.ts`, `src/status.ts`, `src/provenance.ts`, `src/sync.ts`, `src/intent/test-lanes.ts`
comment) + templates (`templates/intents/default.md`) + prompts (`prompts/run-task.md`,
`prompts/run.md`).

## Category scope (0123 D1's discipline — reconstructed 2026-11-05 by 0166 step 003 from this ruling's D-blocks and landing commit 11f2a9109)

Family: *the document parsers and their lockstep surfaces — one view of each grammar between the
runtime reader and the release scan, and the two vocabulary completions carried with it.* Home-set
reconstructed from D1–D5, the hygiene, the floors and the residuals:

| home | disposition |
|---|---|
| `src/tasks.ts` and `src/roadmap.ts` (normalizeNewlines at entry — subtasks, roadmapRounds) with `src/analysis.ts`'s nearMissHeads reading the same view | changed — D1 |
| `src/agents-block.ts` (the collapse only when a legacy block was removed; a replaced block rewrites its own slice) | changed — D2 |
| `src/analysis.ts`'s roundBriefNearMissNote and its wiring in `src/transfer.ts` and `src/plan.ts` (the ℹ line at the round's open, bounded by the brief-still-stub condition) | changed — D3 |
| `templates/intents/default.md` (the scaffold re-keyed to the standing surfaces — the 0109 completion) | changed — D4 |
| `prompts/run-task.md` and `prompts/run.md` (the lane-log dir named as the 0151 seam — the manual-twin completion) | changed — D5 |
| The hygiene: `src/intent/test-lanes.ts`'s comment, `src/phases.ts`'s directory check, `src/brief.ts`'s comment stripping, `src/status.ts`'s one construction point, `src/provenance.ts`'s direction-honest notice, `src/sync.ts`'s diff-gated sidecar rewrite and `src/tasks.ts`'s syncChecklistTicks first direct test home | changed |
| LF documents everywhere, ensurePointer's branches, exact `### R-NN` heads, the bundles' scaffolds, `_partials.md`, the person-edited stamp entries | held, untouched — the floors |
| The near-miss heading naming no round, the other unit-document CRLF readers, the driver-helper free-content scan | held, untouched — the named residuals (the last deferred to its own small ruling) |
| Test homes: `test/tasks.test.ts`, `test/analysis.test.ts`, `test/protect.test.ts`, `test/phases.test.ts`, `test/config-fix.test.ts`, `test/provenance.test.ts`, `test/sync.test.ts`, `test/intent.test.ts`, `test/manual-prompts-ratchet.test.ts` | changed |

Tests: `test/tasks.test.ts` — the CRLF checklist describe (the parser, the readChecklist
composition) and `syncChecklistTicks`' first direct home (the stale-tick re-derivation over
S<nn> state files, idempotence, the no-checklist floor); `test/analysis.test.ts` — the CRLF
roadmap/one-view pair, the near-miss termination (extractor, release scan, install path) and
`roundBriefNearMissNote` (released-only, the named round only, the missing-document floor);
`test/protect.test.ts` — the unchanged-block/prose pair and the legacy-removal collapse pin;
`test/phases.test.ts` — the file-not-a-round line; `test/config-fix.test.ts` — the
comment-stripping briefProposal cases; `test/provenance.test.ts` — the notice's two directions
(no-longer-shipped never prescribes the upgrade, true binary-older keeps it);
`test/sync.test.ts` — the report-only dryrun counting nothing, the retirement's real stamp
write; `test/intent.test.ts` — the default pack's standing-surfaces scaffold pin;
`test/manual-prompts-ratchet.test.ts` — the lane-log dir pins for both manual files; the prompt
trio after the template edits.

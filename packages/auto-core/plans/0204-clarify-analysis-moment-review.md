# 0204 — clarify resolves the analysis by the gate's own moment, and the review prints the round-brief proposals

Status: **active**. Ruled 2026-11-07 by 0166 step 044 (wave W8-planning), enacting 0165-012
(S07-02, S2, CONFIRMED — `clarifyGate` resolves the analysis gate **first in every state**:
0116 D1's two surfaces were ordered "sequential by construction: the analysis releases before
any round exists", but establishment never requires the analysis — `OPENCODE_AUTO_ANALYSIS=off`
establishes from config with the stub on disk (0101 D8), and the analysis is a living document a
person may draft at any time — so past R-01's establishment an unreleased `docs/analysis.md`
captures the command: the stub holds the held survey's release under analysis problems (the
survey gate unreleasable by the command its own stop names first), and a valid later-drafted
analysis is released and committed **in the survey's place** under a false "R-01 opens / the
approved brief installs" next line — a consequential release the person never chose, whose
brief-install promise only projectStart honors) and 0165-096 (S07-08, S3, CONFIRMED — the
analysis review print omits the `## Round briefs` proposals its release puts in force: 0116 D3's
print list predates 0115's channel and never names it, yet each released `### R-NN` installs
verbatim at that round's open and passes the round-start gate on the strength of this one mark,
so a stale or agent-drafted proposal rides the release unseen).

This ruling Amends: **0116 D1/D3** (the construction premise and the review list — see
Premises). It Derives: **P2** (the person brackets every boundary — the release act must land
on the document of the person's moment: releasing the analysis where the survey was awaited
consumes a consequential decision mid-project that no stop surfaced, and the review print is
the person's consent surface, so it must show everything the mark accepts), **P5** (single
ownership — the analysis gate's *moment* has exactly one owning predicate, the project-start
condition plan's rows and transfer's projectStart already hold; clarify resolves through that
same predicate, never a second state source beside it) and **P8** (every surfaced line teaches
its remedy — the note and the refusal's third bullet spelling teach the passed moment and the
hand channel; the false next line dies with the branch it rode). Tier touched: **mechanism
only** — a person-facing command's state resolution and print over existing gate grammar; no
principle change, no vocabulary change (the additions are new lines, the frozen
two-moments refusal line byte-identical).

### Category scope

- **Derives**: P2, P5, P8 (statements unchanged; the showing clauses above).
- **Amends**: no principle. The plans-level amendment is 0116 D1's "sequential by
  construction" premise (restated in D1 below) and 0116 D3's review list (extended additively
  in D2) — 0116's own moment definition ("the unreleased analysis **at the project start**")
  is the truth this ruling enacts, not a change to it.
- **Tier**: mechanism. Code home `src/clarify.ts`; test home `test/clarify.test.ts`
  (the two probe shapes of the finding, the refusal's third spelling, the review pins);
  documentation homes: this document, its INDEX row, the AGENTS.md clarify navigation line.
  No `src/phases.ts`, `src/analysis.ts`, `src/plan.ts`, `src/transfer.ts` or shell change —
  the gate predicate, the round-brief parser and the shell row's "at the project start"
  were already in place and truthful.

## D1 — the analysis branch is taken only at the gate's own moment; past it, a note

**The defect.** `clarifyGate` resolved its first surface by document state alone:
`docs/analysis.md` exists and is unreleased → it is the target, whatever the project's state.
The analysis gate's own moment is a state predicate, not a document fact — plan's rows 0a–0d
and transfer's `projectStart` hold the analysis walkthrough only under
`analysisOn && round === 1 && !roundRoot(dir, 1)` (0101 D4/D8). Every field shape the finding
measured lives in the gap: a stub persisted by an off-posture establishment, an analysis
drafted later — documents on disk in states where no gate awaits them.

**The rule.** The analysis branch is taken only while **no round is established**:
`currentRound(directory) === 1 && !(await roundRoot(directory, 1))` — the gate's own state
half, verbatim (the R-02-without-R-01 deletion shape included through the `currentRound` term,
exactly as the gate sees it). Inside the moment the branch is unchanged: problems hold, the
release commits, the next line's promises are true there. Past the moment an unreleased
analysis is **never the target** — the survey branch resolves on its own, and the unreleased
analysis appears as **one note line** beside its result:

- appended (ℹ) to every non-error result of the survey branch that is not the general
  refusal — a survey release (the repro (b) shape: the survey releases, the analysis stays
  unreleased, no `PLAN clarify the analysis release` commit) and the held shapes alike;
- as the general refusal's analysis bullet, which gains its third spelling (the refusal's
  what-was-checked list is where the person with an unreleased analysis on disk asks "release
  mine" — the bullet is the teaching home there; the ℹ note is not appended to a refusal,
  one statement per output).

Both renderings teach the same truth: the release moment is the project start and it has
passed; this command does not release the document; a hand `Clarified: yes` edit remains the
person's channel, and it is consequential — it puts the roadmap and the round-brief proposals
in force for the rounds and phases not yet started (0114's supersession readers and 0115's
proposal installs are posture- and moment-blind by design: living governance the person edits
directly). The refusal's frozen "releases exactly two moments: the unreleased analysis at the
project start, …" line was already this rule's statement and stands byte-identical.

**The switch stays out.** The gate's `analysisOn` half is deliberately not imported: the
experiment layer is this-run-only posture (P13), while the release's consequences are not —
the roadmap and round-brief readers apply whatever the run's posture, so making the command's
*target* ride the posture would resolve the same on-disk state differently across invocations.
Every measured stub-on-disk shape is post-establishment and is closed by the state half
alone. Recorded residual (unmeasured, named for its consumer): pre-round, an off-posture run,
and a stray *valid* analysis on disk together still release with the next line's
brief-install promise — the walkthrough's continuation sentence, half of which the off
posture does not honor (the roadmap half does: the establishment readers are posture-blind).

**The floor.** Every state the finding did not name is byte-identical: a released or absent
analysis resolves exactly as today (the refusal's two existing bullet spellings unchanged),
and inside the project-start moment the analysis branch's behavior, commit and print are
unchanged except for D2's additive review lines.

## D2 — the review prints the round-brief proposals

0116 D3 made the command the review: "print what the release accepts". The release now
accepts a third proposal family 0116's list never saw — since 0115, each `### R-NN`
subsection under `## Round briefs` installs verbatim as that round's round.md at its open
(transfer's establishStop for phased, plan's m-mode establishment, the loop-preflight
re-dispatch — all three readers), **passing that round's round-start gate on the strength of
this one mark**. A review that shows the roadmap, the forks and the project brief but not
the round briefs approves the largest verbatim installs silently.

The review therefore lists every round-brief proposal present, one line per round, from
`roundBriefProposals` (src/analysis.ts's own parser — the one extraction the problems gate
and the install path already share, P5), in document order, placed with the roadmap lines
(the per-round family):

- present: `  - R-NN — its round-brief proposal installs verbatim as its round.md when it
  opens (that round's round-start gate passes on this release)` — one line per `### R-NN`;
- absent (no section, or a section with no proposals): one line teaching the posture —
  every round keeps its round-start gate, where the person writes its round.md by hand.

The empty-body and near-miss shapes cannot reach a release (`analysisProblems` holds them,
0115 D2 / 0158 D3), so the listing is exactly the set that will install. The brief-presence
line stands unchanged; the print now covers the whole proposal-install family the release
puts in force (roadmap lines, forks, round briefs, project brief).

## D3 — the header's construction claim restated

The header's "Two surfaces, resolved in state order (sequential by construction: the analysis
releases before any round exists)" is the falsified premise in source form; it now states the
predicate: the analysis surface resolves only at the gate's own project-start moment (no
round established), and past it an unreleased analysis is a note, never the target. The
two-surfaces model, the gates' authority, the dirty-tree discipline and the write/commit
shapes are 0116's and unchanged.

## Enactment notes

- `src/clarify.ts` gains the imports `roundBriefProposals`, `ROUND_BRIEFS_HEADING`
  (./analysis) and `roundRoot`, `currentRound` (./phases) — all already exported; no other
  source file changes. The survey branch is restructured as an inner resolution whose
  non-error, non-refusal results gain the appended note (the refusal's bullet carries the
  teaching in its own shape — one statement per output).
- Pins in `test/clarify.test.ts`: (a) a stub beside a held survey — the survey releases, the
  stub's problems never surface, the stub stays unreleased; (b) a valid analysis beside a
  held survey — the survey releases, no analysis-release commit exists, the note line rides
  the output; (c) the general refusal's third spelling past establishment; (d) the review's
  per-proposal lines and the absent-posture line at the project start. Fail-before proven on
  pre-fix source: (a) and (b) reproduce the capture verbatim, (c) prints the released
  bullet's false claim, (d) omits the proposals.
- No shell change: the clarify row's "the unreleased docs/analysis.md at the project start"
  was already the truthful statement of the moment (truer after this ruling).
- P13: additive lines only; no frozen string changes; the mark, the gates, the released
  readers and the commit subjects untouched.

## Premises

premises this ruling changes: **0116 D1 (construction claim), 0116 D3 (review list)**.
Re-read in this change: 0116 D1's moment definition ("at the project start") stands — this
ruling enacts it; the "sequential by construction" parenthetical is falsified by the
measured stub shapes and restated (D1/D3 here); D2's detection order (analysis first) holds
within the moment. 0116 D3's list is extended additively by D2 (the round-brief family
postdates the ruling). 0114's supersession readers and 0115's proposal channel are
unchanged — the note teaches their truth; 0158 D3's near-miss discipline already gates the
release this review serves.

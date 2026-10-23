# 0104 — The round-brief proposal channel

## Evidence

The net driver-helper session (`sess_85d835e2`, "Close R-04, plan R-05 igb migration alignment",
2026-10-22): on the decide side the person-proxy session settled everything — R-04's close listing,
igb as the fork, the dm-flash test method, the base sync to v0.19.0, the two-round renumbering
(R-05 sync, R-06 igb), the common-first roadmap with the C-16a split, the ready-to-paste charter
for the sibling project. On the apply side every decision then had to be transcribed by hand: the
round brief `docs/R-05/round.md` is the person's own writing and commit (the helper brief's channel
rule: "the pen discusses on request and never fills or commits it"), and the two-round shape had no
channel at all at that stop — net carries no released `docs/analysis.md`, so the roadmap lines had
to be hand-created, hand-written and hand-released. The decisions existed; no document the driver
reads carried them; the person was the copy step.

## D1 — the ruling: the round brief joins the proposal-install family

The round brief is the last person-gate artifact with no proposal channel. The project brief got
one (the survey release, 0081 D15, generalized to the analysis release by 0084:
`## Project brief` → released whole-line `Clarified: yes` → `installBriefProposal` installs
verbatim). The roadmap lines are one (0101 D5: a released line is the round's phase list; 0103: a
covered round never reads the config key). The round brief — the one document every phase's
planning session consumes — was still write-only-by-hand, which is exactly the residue the fleet
session hit.

The channel, the third member of the family: an optional `## Round briefs` section of
`docs/analysis.md`, one `### R-NN` subsection per round whose body is that round's brief; released
by the existing whole-document `Clarified: yes`; installed verbatim into `docs/R-NN/round.md` by
the advance at the round's open. The person's per-round review act moves from hand-writing and
committing the file to releasing (or having already released) the drafted proposal — the same move
0081 D15 made for the project brief, with the same authorship honesty: the person's words are the
released proposal, the mark is the signature, the install is a mechanical copy on the driver's own
commit.

The round-brief proposal is living governance exactly as the roadmap is: a subsection may be added
to an already-released document later (drafted between rounds, refined after the previous round's
findings — the re-derivable-tail philosophy extended from the phase tail to the brief), and the
next advance installs it. No new release mark is needed for the edit, the same rule 0103 set for a
moved roadmap line.

## D2 — the grammar

- `## Round briefs` is optional — deliberately NOT added to `ANALYSIS_SECTIONS` (the required
  list); an analysis without it releases exactly as before.
- `### R-NN` subsections (the round id alone on the heading line — `### R-05`; unpadded ids parse
  as they do in the roadmap's line grammar, a level-4 heading or a suffix on the line does not);
  the body is free markdown, read to the next `###`/`##` heading; comments strip with the shared
  rule.
- `analysisProblems` checks the section when present, the near-miss discipline (the decorated-
  bullet lesson of 0084): a present-but-empty `### R-NN` subsection is a problem (it reads as
  drafted and would install nothing), and a heading under the section that looks like a round
  brief but does not parse (`#### R-05`, `### R-5`, a trailing suffix) is named as one.
- The analysis stub gains a commented hint teaching the section and its release semantics.
- The installed file composes as `# Round R-NN` + the proposal body verbatim + the `## Close`
  stub section (the protocol heading the round-close gate reads, kept in place by construction).

## D3 — the apply: one install, three reach points

`installRoundBrief` (src/round-brief.ts, beside the stub and the readers): writes the composed
file, lands the driver's own `Auto-Stage: round-start` commit (`PLAN start R-NN (round brief
installed from docs/analysis.md)`), never clobbers — a round.md that already holds real content
stands (an ℹ line; the person's file wins), and an equal re-run only re-commits (the interrupted-
install shape: the write landed, the commit did not). The commit failure is a ⚠ line, the caller's
stop owning the exit — the brief-install precedent.

1. **transfer's establishment** (`establishStop`): when a released proposal exists for the round
   being established and round.md is still the stub, the round-start gate is skipped — the
   release was the person's review — and the advance continues into the construct in the same
   invocation (`advanceToReview`), stopping at the formulation review. The install lands inside
   that continuation, its round-start commit sweeping the uncommitted setup (establishment
   leaves it uncommitted for the person's gate commit; with the gate passed, the driver's own
   commit replaces it).
2. **the advance's apply seam** (`advanceToReview`, beside `rederiveTail`): whenever the
   construction is the next step and the round brief is still the stub, a released proposal
   installs first. This covers every later shape — the held gate where the person drafts
   `### R-NN` into the released analysis and commits, the hand-added-task state — and keeps the
   install to one implementation.
3. **m mode's establishment** (plan's `establish`): the install after the setup, the stop naming
   plan's input step instead of the gate fill. m mode keeps the analysis flow (0084's rows are
   m-mode-first), so it keeps the channel.

Around them: plan's stub-round dispatch refusal (0101 D3's guard) gains the alternative — release
an `### R-NN` proposal and commit, and the next transfer installs it; the preflight round-start
gate block names the channel when a released proposal waits; the construct's review stop flips
the AGENTS.md guidance to the phase-preparation state (the document of the moment after a passed
gate is the phase's planning input — the states-flip-at-boundaries rule of 0084, the review stop
a command boundary).

Floors byte-identical: no analysis, unreleased, no proposal for the round, or
`OPENCODE_AUTO_ANALYSIS=off` — today's shapes everywhere.

## D4 — the guidance and surfaces

- `analysisState` teaches the section (what a subsection is, that the release installs it, that
  it can be drafted into the living document later).
- `roundState` (rendered only at a held gate, by construction) names the alternative: drafting
  the proposal into the released analysis and committing installs verbatim at the next advance —
  the hand-written file is the round's own when no proposal covers it.
- `DRIVER_PRIMER` carries one clause beside the roadmap sentence.
- Core AGENTS.md (the 0101/0084 navigation lines), docs/structure.md (the analysis row), the
  shell README/MANUAL (the transfer section, the new-project flow, the round-start gate
  description).

## D5 — rejected alternatives

- **transfer reading a file outside the analysis** (a tmp/ draft, a chat export, an option):
  unreleased or unversioned content must never drive establishment — the release discipline is
  the point, and `docs/analysis.md` is the one carrier that has it.
- **the pen (or any session) writing round.md directly**: no release discipline — the content
  would drive every planning session with no person mark on it; and it keeps two documents where
  one (the analysis) already carries the decisions. The helper-brief channel rule ("never fills
  or commits it") stands: the pen's channel is the analysis document, whose proposal the person
  releases.
- **a new document role** (`docs/round-briefs.md` or per-round proposal files): a new surface to
  teach, gate and render for no gain — the analysis is already the pre-round decision home and
  already rides into planning (`analysisText`).
- **releasing per-round** (a separate mark per `### R-NN`): the document releases as a whole
  (the roadmap's rule since 0084); per-round marks would multiply the person's acts in the name
  of precision nobody asked for. A round's proposal is read at that round's open, so later
  refinement is naturally late-bound.
- **auto-syncing round.md back into the analysis**: the install is one-way; after it round.md is
  the person's document to revise in place (mid-round edits are today's normal — every planning
  session reads the current file).

## D6 — enactment and the lineage note

Core only; no shell flags (the channel is document grammar, not an option surface). Tests:
analysis grammar (parsing, problems, stub hint), transfer's three reach points over real git
repositories (establishment continuation with the round-start commit, the held-gate apply, the
never-clobber and idempotent shapes, the floors), m mode's establishment, the ratchet pins for
the new guidance wording, the shell e2e walkthrough extended with a proposal.

The deployed fleet binary is a sibling lineage (its plans/0103 is `release`, its plans/0105 the
`driver-helper` brief; this branch's 0103 is the config-phases supersession — a number collision
to resolve when the streams merge). Its driver-helper CHANNELS block does not yet name the
analysis channel at the round-start stop; when the lineages merge, the brief's round-start
channel row gains the same both-ways wording the guidance states carry here.

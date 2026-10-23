# 0114 — config `phases` under a released roadmap: supersession named, never synced

> Renumbered from 0103 at the 2026-10-23 merge of the parallel auto-core line: both streams numbered plans from the shared 0101 fork point, and this line's 0103 was already the retained line's plan (0103 names destination containment there). The numbers here continue the retained line's series; the D-ids below are this document's own.

Ruled 2026-10-23, from the aster-mig-root/common fleet session (the R-03 → R-04
transition): once the project's `docs/analysis.md` was released with roadmap
lines, config `phases` became permanently inert — yet nothing said so. The
stale value (the previous round's list) sat in `.opencode/auto/config.json`
inviting "must I amend it?" confusion, and the held survey gate's D6 reshape
line even pointed at `amend --phases`, a channel that is inert for a round the
roadmap covers — the fleet's driver-helper session moved the roadmap line
instead, the working channel the message never named.

This ruling Derives: **P2** (the person's surfaces name the working channel — the fleet
incident was a stop line advising an inert `amend --phases`; the reshape line, the
awaiting parenthetical and the primer authority-branch to the moved roadmap line a covered
round actually reads), **P5** (single ownership — supersession named, never synced: once
the released roadmap covers a round, its line is the one phase-list authority and nothing
reads the key; the line grammar and released readers split into their one home
`src/roadmap.ts`) and **P6** (derived state — a covered round's phases re-derive from the
released line at every boundary, the specific round's coverage the truth, never "a roadmap
exists"; the stale config value is never a second source). Tier touched: **mechanism
only** — a config-key supersession over existing surfaces plus a module split (retiring
plans/0101 D5's post-amend precedence note); no principle change; the INDEX release cell
stays open until the next release event.

## The regimes (D1)

The consumption picture is a clean two-regime split with no mixing (every
reader — establishment through `resolveRoundPhases`, the boundary tail
re-derivation, plan's mid-phase drift re-sync — composes the one resolution,
and `roundOpen` past the roadmap's last line stops at the
extend-the-document channel rather than falling back):

- **roadmap regime** — a released roadmap that plans ≥ 1 line: every round
  establishes under its covering line; the round past the last line is the
  exhausted stop. Config `phases` is read by nothing, ever.
- **config regime** — no released roadmap plans any line (m mode, analysis
  off, never released, released with an empty roadmap): config governs every
  round forever. Partial coverage is expressible (lines for R-02 while R-01
  runs): config governs exactly the uncovered prefix — the coverage of the
  specific round is the truth, never "a roadmap exists".

**Ruling: keep the key, never sync it, never retire it.** The key is
load-bearing for the config regime — the bootstrap value init writes, m-mode
and analysis-off establishment forever. Syncing (transfer or fix writing the
round's value) is semantically empty: the next round always establishes under
the *next* roadmap line, which differs from whatever would be written — the
file goes stale again one round later while a freshly written value falsely
implies authority the roadmap holds. And driver writes to config stay
confined to config commands (init/amend/fix); transfer is a run-surface
command and config is read-only during runs. The fleet question — "what is
the point of a configuration that must be modified yet never takes effect?"
— is answered by making it *never need modifying* and saying so, not by
having the tool modify it.

## D2 — the naming surfaces

- **status**: one ℹ line when the current round is covered —
  `ℹ phases (config "<value>"): superseded — R-NN establishes under the roadmap of docs/analysis.md; reshape the round by moving its line there, never by amending the key`
  — and the awaiting-clarification parenthetical branches the same way (the
  line-move channel for a covered round, the `amend --phases` channel for a
  config-governed one). m mode and uncovered rounds name nothing: the key is
  their live establishment authority.
- **fix**: a manual finding (the rule table's own "silently lose their
  meaning" class, report-only, never rewritten) —
  `phases "<value>" is superseded — R-NN establishes under the released roadmap of docs/analysis.md; nothing to repair (reshape rounds by moving its lines)`.
  Nobody amends the key "to clean up" once the repair site itself explains
  the supersession.

## D3 — the refusal and the wording branch

- **amendPhasesHold's coverage refusal**, ahead of every other guard: the
  round this amendment would shape — the live round, or the next one when
  the live round is complete (the same target the shell's prefix guard
  judges) — never reads the config value when the released roadmap covers
  it; the write is inert at any phase state, so it is refused outright
  (exit 1) naming the line-move channel, agreeing values alike (the key is
  not maintained under a covering roadmap at all). This **retires 0101 D5's
  post-amend precedence note** (the note accepted the inert write and its
  promise — "config phases applies to rounds the roadmap does not cover" —
  is dead in a governed sequence, where no future round reads config); the
  note's `releasedRoadmapPhases` reader goes with it. The mid-phase timing
  refusal keeps its shape, its "the next transfer applies the value" tail
  now only ever printing for config-governed rounds.
- **logGateStop's reshape line authority-branched**: a covered round's held
  gate names moving its `- R-NN <phases> — <goal>` line in
  `docs/analysis.md`; the `amend --phases` wording is kept for
  config-governed rounds. The D6 message previously named the config channel
  unconditionally — on the fleet's roadmap-governed project it advised an
  action that silently did nothing.
- **DRIVER_PRIMER's reshape sentence** branched the same way (one primer,
  both modes; the pinned boundary-grammar substring kept).

Accepted edges: a complete round past the roadmap's last line amends quietly
(the value would target a round that never opens — the next transfer's
exhausted stop names the extend-the-document channel); m mode never consults
the roadmap (D8 unchanged).

## D4 — src/roadmap.ts

The roadmap line grammar (`ROADMAP_LINE`, `roadmapRounds`, `roadmapPhases`)
and the released readers (`releasedRoadmapRound`, `releasedRoadmapRounds`)
split from `src/analysis.ts` into `src/roadmap.ts`, placed in the runtime
sub-domain — provenance's precedent (plans/0100): the detection sites on the
runtime plane (`fix`'s D2 finding) reach the readers without binding a
`runtime → pipeline` edge, which SUBDOMAIN_EDGES does not allow and which
would be an architecture event far heavier than the split. analysis keeps
the release grammar gates and the establishment resolution
(`resolveRoundPhases`, the one authority — unmoved); the split binds no new
driver edge at all (roadmap reaches only the provider domains docpaths and
phases).

## Rejected alternatives

- **Transfer/fix re-syncing the key** (the fleet proposal): stale one round
  later, a false authority signal, and a run-surface write into a
  config-command-owned key.
- **Retiring the key under the roadmap regime**: state-dependent key
  validity for marginal gain; the config-regime population needs it forever,
  and a wiped or unreleased analysis would strand a retired key.
- **Branching on "a released roadmap exists"** rather than the specific
  round's coverage: the partial-coverage edge would name a live key
  superseded.

## Enactment

Core: `src/roadmap.ts` (new), `src/analysis.ts` (the split, imports),
`src/transfer.ts` (amendPhasesHold), `src/loop-phase.ts` (logGateStop async
+ branch), `src/status.ts`, `src/config-fix.ts`, `src/agents-block.ts`
(DRIVER_PRIMER). Shell: the amend row's note removed with its
`releasedRoadmapPhases` import, the row's comment extended; README
(the `--phases` row, the re-derivable-tail bullet), MANUAL (the reshaping
row), the shell AGENTS.md transfer bullet. Tests: transfer.test.ts (the
coverage refusal — mid-phase precedence, the held boundary, the
partial-coverage quiet; the config-governed gate-stop pin),
survey-gate.test.ts (the covered gate names the line-move channel; the amend
on the covered round refused), tasks.test.ts (the status ℹ line and its
absences), config-fix.test.ts (the manual finding, coverage-following),
analysis.test.ts (imports re-keyed to roadmap), import-direction.test.ts
(roadmap classified driver/runtime), the shell e2e's D5 walkthrough re-keyed
to the refusal with the status supersession line pinned.

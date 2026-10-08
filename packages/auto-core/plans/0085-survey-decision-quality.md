# 0085 — Survey decision quality: the analysis as the survey's input, Settled lines, and the Recommend-default fork bar

The working rulings, kept verbatim as the design record. Status: landed 2026-10-08.

## The problem

The spi-nor-glm incident (target `/home/wxl/workspace/root/spi-nor-glm`, session of
2026-10-08) exposed two defects in the survey stage as shipped by 0081 D14/D15 and
0084:

1. **The analysis dropped out after its release.** The release's mechanical
   survivors are the installed `## Project brief` section and the roadmap's
   `<phases>` token (one advisory line per establish). The survey phase's planning
   prompt carried no analysis slot and the bundle survey duties never named
   `docs/analysis.md` — so the survey planner re-derived every scope decision cold
   and raised all of them as `Fork:` lines. In the incident, 15 of the 18 recorded
   items (10 forks + 8 depth/grading questions) were already settled by the approved
   analysis; the person spent four interactive turns re-stating their own recorded
   principles before the surplus dissolved.
2. **The decision items were undecidable as presented, and the posture refused to
   pre-resolve.** The fork bar ("options, consequences and a recommended default")
   was unenforced prose with no requirement that consequences be project-level, so
   forks arrived as technical option pairs (errno-parity vs class-parity) the person
   could not map onto goal, rounds, cost or acceptance. The blanket "the survey
   proposes, the person disposes — never decide a fork" bounced even
   principle-implied decisions back to the person, and the ungated
   "depth/grading questions" category let two decisions linger past the human gate
   until an explicit pushback. What finally engaged the person was the decision
   register the session improvised: classification, a goal tie, a round tie, a
   default — generated after the fact, by hand.

## The rulings

- **A1 — the approved analysis is the survey planning session's input.**
  `analysisText(dir)` (src/analysis.ts, the brief's reader pattern: comments
  stripped, undefined when missing or comment-only) feeds a new `analysis` slot on
  `renderPhasePlan`, rendered by `loop-plan.ts` **only for phases carrying the
  `human` gate** — the one planning session that raises decisions. The template
  block (`phase-plan.md`, after the round brief) frames it: "What this analysis
  settles is settled: carry its decisions forward, never re-raise them as open
  questions; a decision its goals, constraints or roadmap implies is decided the
  same way, with the derivation recorded." Later phases keep the round brief and
  handover chain (the analysis's roadmap prose already reaches them through the
  round brief the person's agent derives under the 0084 guidance states). An absent
  analysis (the switch off, a pre-0084 project) injects nothing — the survey then
  plans from the brief alone, as before.
- **A2 — the survey duties carry the decision discipline** (all three bundles'
  `phases/survey.md`, materialized at `init --intent`):
  - *Settled first.* Every candidate decision is checked against the person's
    approved words — the analysis (the duties name `docs/analysis.md` so a
    manual-mode planner reads the file too), else the brief and round brief. What
    the analysis settles, explicitly or through its goals/constraints/roadmap, is
    already made; what its principles imply is decided the same way. Both land as
    `Settled:` lines, each naming the line that settles it — a marker chosen to not
    match the gate's `Fork:` regex — and neither is ever re-raised.
  - *The fork bar.* A `Fork:` line is reserved for a decision the approved words
    leave genuinely open **and** that materially shapes the project — scope,
    compatibility, security, acceptance, cost. It is stated in the project's terms,
    not the technique's: what each option changes for the goal, the rounds it
    reshapes, the cost or risk it adds, the acceptance it tightens or loosens —
    then `Recommend:` one default. The person must be able to decide from the line
    alone; technical detail supports the survey's prose, it never carries the
    decision.
  - *The question category is retired.* No separate depth/grading question list: a
    grading depth the analysis or round brief implies is answered in the survey
    with its derivation; a genuinely person-owned policy call is a `Fork:` line
    like any other. Nothing the person must decide sits outside the fork list —
    the incident's lingering Q3/Q6 leak is closed.
  - *The posture.* "The survey decides what the person's approved decisions
    already decide and records the derivation for the person to veto; the person
    disposes only of the genuine forks — never write the person's `Clarified:`
    line." The blanket "never decide a fork" is gone; the veto, not adjudication,
    is the person's role for settled lines. survey.md's contents enumeration
    becomes the decisions ledger (`Settled:` lines with derivations, `Fork:` lines
    with project-level consequences and defaults) beside the map, environment
    facts and gaps, the MUST baseline and the `## Project brief` proposal.
- **A3 — the gate enforces the fork grammar lightly.** `forksWithoutRecommend`
  (src/phases.ts): while the phase is held, every `Fork:` line lacking a
  `Recommend:` clause is a second `clarification:` problem ("the person decides
  from project consequences plus one default"). The person's `Clarified: yes`
  still passes regardless (their act overrides, D15.2 unchanged); the open-fork
  message and the gate-stop release line now state the accept-all-defaults
  semantics — `Clarified: yes` accepts every line's `Recommend:` default, overrides
  go beside the lines. The analysis stub's `## Goals` hint teaches the same line
  shape; the analysis release gate stays count-only (0084 D4: person-authored,
  grammar only).
- **A4 — the round report's needs-attention items carry the same framing bar.**
  The charter (src/round-report.ts and the `report-duty` partial) now requires
  each item "phrased by its project consequence (what it changes for the goal,
  the rounds, the cost, the acceptance — never the technique alone)" beside its
  options, implications and override path — the report and the survey speak one
  decision language.

## What is deliberately not done

- No retro-fix for existing targets: a project that already materialized
  `.opencode/auto/phases/survey.md` keeps it; the reworked duties reach new
  `init --intent` materializations (spi-nor-glm's survey was resolved by hand in
  the incident's session).
- No mechanical check on `Settled:` lines (derivation quality is the survey
  session's own work; the person's veto is the control) and no fork-count ceiling
  (a genuinely fork-heavy project should record its forks).
- The manual driver suite (`prompts/`) is untouched: it drives tasks only, the
  duties file is the carrier, and the reworked duties name the analysis file so a
  manual-mode planning agent reads it unprompted.

## The evidence

`test/round-gates.test.ts` (the Recommend check, both gate problems, the
message wording), `test/analysis.test.ts` (`analysisText` three states),
`test/prompt-phase.test.ts` (the analysis block present/absent/ordered),
`test/survey-gate.test.ts` (the e2e: the survey's planning prompt alone carries
the analysis; the stop names the accept-all-defaults release), `test/bundle.test.ts`
(the duties ratchet over the three shipped bundles).

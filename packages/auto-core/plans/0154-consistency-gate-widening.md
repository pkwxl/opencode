# 0154 — the widened consistency gate: the pair diff covers what propagates, and the spec-read verification duties

The maintainer's ruling (2026-10-29, over the aster-mig cleanroom workspace — the
fork-comparison studies the workspace distilled the same day into its methodology
constitution's §7/§9 widening; the tool-side half is this document): *"how do you think
if we can apply this to our spec-read?"* (over the same-survey A/B comparison session
that had found each run independently distilling contracts the other proved wrong
against the reference) / *"I think not only for spec-read, but also for survey, which
might affect spec-read much more"* / *"remember that the tool side should not be
specific to our migration."* The studies' findings carry the ruling: survey variance is
real but concentrated in the decisions layer (three same-phase surveys produced three
disjoint fork sets over a byte-stable enumeration core), that layer propagates
faithfully into the specification (an interface family one survey never named vanished
wholesale from its run's specification; one appended ruling line restructured a whole
acceptance layer), and a wrong contract in a note is the wall's silent failure — the
later phases implement and test it faithfully, so nothing downstream catches it.

## The measurement (the workspace's fork-comparison studies, 2026-10-28/29)

- **Same-survey spec-read runs each carried wrong contracts.** Six comparator sessions
  over one phase pair (same survey, same model, pure A/B re-run) found per-run factual
  errors on both sides — placement contracts, requeue semantics, queue-draining
  corners, state-edge occupancies — each verified wrong against the reference at
  file:line. No shipped gate checks distilled contracts against the reference: the
  identifier scan checks vocabulary, not truth; downstream tests are written from the
  same wrong note.
- **Survey variance is bimodal.** Across three independent survey consolidations of one
  generation, the enumerated core (capabilities, files, line counts, export counts)
  was byte-stable — while the decisions layer varied freely: disjoint fork sets,
  MUST baselines of 5/8/9 differently-shaped items, unstable gap ids, area
  partitioning swinging task counts 2×, and a drifting corpus perimeter (satellite
  companions in one enumeration, absent from the next).
- **The decisions layer propagates; the 0153 gate diffed the stable layer.** A by-id
  and -level catalog diff (0153 D3) stabilizes the layer the studies measured as
  already deterministic and is blind to the layer that propagates: a descope ruling
  erased a whole named knob family from one run's specification; an unnamed adjacent
  interface family never reached the wall at all; a ruling appended to one arm's
  survey restructured that arm's entire acceptance layer while its sibling stayed
  neutral under the open fork.

## D1 — the survey pair diff widens to the propagating surfaces

The consistency paragraph's diff grows from the catalog rows alone to **every surface
the survey hands downstream**: the catalog rows diffed id by id (0153's rule, kept),
the **decision records** — `Fork:` and `Settled:` lines, recorded gaps — **diffed by
their subject** (a fork one run raises and the other never names is a difference like
any other; the studies measured the disjoint fork sets), and **the closed anchor set
itself** — an anchor one run carries and the other never names is a difference, for
the completeness criterion binds the set only if the pair checks it (the perimeter
drift measured). Generic per P16: the surfaces named are the phase's own artifacts,
never an environment's.

## D2 — the pair resolves at the survey's close

The gate's timing becomes a duty: the pair resolves **before the phase closes** — what
a survey settles propagates into every later phase, so its differences are adjudicated
before anything builds on them, never after. No mechanism rides (P21): the
orchestration stays with the person's comparative arrangement and the driver-side
workflow, as in 0153.

## D3 — spec-read sampled accuracy verification

Each spec-read task **re-reads the reference for its riskiest distilled contracts —
exact values, bounds and limits, corner and state-edge semantics — before its notes
stand**, riding the existing evidence layer: verdicts and counts in-tree, the anchors
and citations out-of-tree in the compliance home (0132's rule, unchanged). The duty
names the failure it guards: a wrong contract in a note is the wall's silent failure,
the later phases implementing and testing it faithfully so nothing downstream catches
it. The riskiest classes are named generically — the classes the studies found the
errors concentrated in, stated without any environment's vocabulary.

## D4 — the spec-read pair clause

Where the person's comparative arrangement pairs the phase's runs, the survey's pair
rule applies to the specifications too: the two are diffed **entry against entry,
binding on the consolidated document** (a consolidation may drop what the notes
carried — measured), every difference adjudicated against the reference (lawful
pre-wall) and landing Unresolved for the person — never one run silently kept. The
clause teaches the shape only; whether a project ever pairs its specification is the
person's arrangement, never a duty-mandated run.

## The floors

- **The 0085 decision discipline is untouched** — the widened diff reads the
  `Fork:`/`Settled:` lines; it never changes how they are recorded or ruled.
- **The 0121 compliance gates and 0132 wall are untouched** — the sampled
  verification rides the existing evidence layer's in-tree/out-of-tree split.
- **0153's rulings stand** — the anchors, the catalog, the status semantics, the
  completeness criterion and the delta rule are unchanged; this widens the pair-diff
  sentence and adds the verification duties beside them.
- **The faithful postures keep their shapes** — the duties are cleanroom's.
- **No phase-document grammar change** — duty text alone, no new artifact (the
  verification reports were already the phase's evidence layer).

Derives: **P19** (measured evidence — the fork-comparison studies are the
measurement), **P2** (the person's adjudication — differences land Unresolved; the
specification pair rides the person's comparative arrangement), **P16** (genericity —
no migration's specifics ride; the riskiest-contract classes and the diff surfaces are
named in the phase's own vocabulary), **P15** (the duties are committed policy, the
pin test holding them), **P21** (no mechanism — the orchestration stays with the
person's fork arms and the driver-side workflow). Amends: none — 0153's duties compose
with the widened diff; 0085's and 0121's floors stand. Tier touched: **policy** —
`templates/bundles/cleanroom/` duty text + the shipped-text pin.

Tests: `test/bundle.test.ts` — the 0154 pin test (cleanroom-only, wrap-insensitive:
the decisions-by-subject and closed-anchor-set clauses, the close-time binding, the
riskiest-contracts and silent-failure clauses, the spec-read pair rule).

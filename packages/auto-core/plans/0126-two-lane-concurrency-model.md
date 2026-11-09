# 0126 — the two-lane concurrency model: doc waves ride the width; code parallelism the deliberate tier; the handover-test exclusion mechanized

The maintainer's ruling from the fielded sequence: docs and source code parallel differently — they are
different — and the configuration must be comfortable. The model in one sentence: **`--max-sessions N`
gives documentation waves out of the box (the declarations arranged by planning at that width); code
parallelism is the deliberate `--tree-lanes` choice with `parallel` as its depth key; no
cross-refusals.** Three gaps stood against it: doc-phase planning arranged declarations only under a
level (the `## parallelism` doc paragraphs — carried by none of the three shipped bundles, so on every
bundle project the width bought a scheduler with nothing to schedule), `--handover-test` refused the
whole run under doc-lane activation (0099 D2), and the help surface did not state the model.

This ruling Derives: **P17** (declared concurrency — the showing: the declaration teaching now rides
the same surface that executes it — the width keys the doc teaching exactly as the width keys the doc
scheduler, and the tier keys the code teaching exactly as the tier keys the code machinery), **P10**
(the byte-identical floor — the showing: at width 1 a doc phase renders neither guidance block; a
level alone still changes only code-phase prompts; a pack without the section injects nothing),
**P8** (deliberate enforcement moments — the showing: 0099 D2's run-shape refusal replaced by the
mechanical exclusion at the request site plus one teaching steer, blocking reserved for the person's
moments), **P15** (policy is data — the doc teaching is pack text in one canonical section, not
renderer copy; the level texts become code-depth alone), **P5** (single ownership — one
doc-concurrency text with one home (`## doc-parallelism`), the doc paragraph leaving the three level
texts it was triplicated across), **P13** (frozen additive-only vocabularies — `INTENT_SECTIONS`
grows `docParallelism` additively, the AGENTS-block clause and the ratchet pins move in conscious
lockstep), and **P19** (measured evidence — the incidents and the census below, each cited). It
**Amends 0099 D2** (the `--handover-test` refusal half: the run-shape mutual exclusion retired, the
exclusion re-keyed to the request site — the rule restated: no script ever executes against the tree
while doc lanes are in flight, because a doc-lane session's marker is consumed and refused with a
steer, and every other session runs alone; provenance carried: D2's own finding that the idle test
is the one driver-run surface with no landing window stands — the drain is no longer needed because
the run never happens) and **completes 0125 D7's doc half** (the bundle packs' missing guidance
landing as `## doc-parallelism`; the code-depth `## parallelism` for bundles stays deferred, P21 —
its consumer a bundle project that sets a level for code depth, none fielded). Tier touched:
**mechanism and data** — core src, engine, templates, four packs, the shell's help, tests; no
principle text.

## Category scope (0123 D1's discipline)

Family: *the concurrency configuration family — the two knobs' meanings, the planning teachings that
feed each, and the exclusion between the test channel and doc lanes.* Home-set enumerated at ruling
time:

| home | disposition |
|---|---|
| `src/intent/types.ts`, `src/intent/load.ts` (the section registry) | changed — D1 |
| `src/prompt.ts` (`docConcurrencyVars`; the parallelism comments) | changed — D1/D2 |
| `src/prompt-plan.ts` (both planning inputs; the two blocks, split by phase kind) | changed — D1/D2 |
| `src/loop-plan.ts` (the four width pass-throughs) | changed — D1 |
| `templates/prompts/phase-append.md` (the doc-concurrency block) | changed — D1 |
| `src/opts.ts` (`Opts.docLane`, the site flag), `src/loop-task.ts` (the doc-lane dispatch) | changed — D3 |
| `src/engine/concerns/test.ts` (the marker refusal branch) | changed — D3 |
| `src/loop-preflight.ts` (the refusal retired; the pack warning; the note reword) | changed — D3/D1/D5 |
| `src/agents-block.ts` (`TEST_PRINCIPLE`'s doc-lane clause) | changed — D4 |
| `templates/prompts/_partials.md` (the protocol partial's `{{^docLane}}`) | changed — D4 |
| `templates/intents/default.md` (the section; the three level texts' doc paragraphs moved out) | changed — D1/D2 |
| `templates/bundles/{cleanroom,faithful,faithful-lean}/intents/*.md` (the canonical section) | changed — D1 (materialized targets take it through `sync`; the provenance drift the designed upgrade path) |
| `packages/auto/src/index.ts` (the two help strings) | changed — D5 |
| `templates/prompts/whole.md`, `decompose.md` (the task-side level guidance) | consistent, untouched — the level text itself narrowed by D2's pack change; their framing is code-side |
| `src/testrun.ts`, `src/script.ts` (the protocol and the side-effect guard) | consistent, untouched — the guard's "ran alone" assumption now guaranteed by D3's exclusion rather than by the refusal |
| `src/lanes.ts` (the schedulers) | consistent, untouched — 0125's width-keyed activation is exactly this model's substrate |
| `prompts/run.md` | consistent, untouched — the manual suite's `parallel: <n>` hand-over phrase is its own person-driven channel |
| `docs/principles.md` | consistent, untouched — no principle statement names the guidance channel; P17/P10 stand as written |
| `docs/structure.md` | consistent, untouched — the rows name homes, not the channel |
| test homes: `test/intent.test.ts`, `test/parallel.test.ts`, `test/session-opts.test.ts`, `test/turn-test-protocol.test.ts`, `test/agent-fake.test.ts`, `test/loop-preflight.test.ts`, `test/bundle.test.ts` + the four moving goldens | changed |
| `test/golden.test.ts` (the golden runner) | consistent, untouched — the four goldens moved, the runner itself not edited (the first draft's enumeration wrongly listed the runner among the touched homes; corrected 0166 step 080 over the S02 audit's triage, never registered as a finding) |

## The evidence

- **The incident sequence** (2026-10-25): the cleanroom baseline refusal (0125's evidence), then the
  dm-glm run — `run --max-sessions 6 --boundary flow` on an `admtvk` project with
  `test-by-driver on(handover)` — refused by 0099 D2's `--handover-test` × doc-lane exclusion,
  although on that project the implement/test phases' units all touch source (serial at tier 0
  whatever the width) and the doc phases never request driver tests through their own prompts.
- **The guidance census**: the doc-parallel declaration teaching lived only inside the default
  pack's three `### level` texts — absent from every bundle — so at width without a level, doc-phase
  planning was never told to write `Depends: none` / `Touches: docs/T-NNN/` and the chained plan
  spent none of the width (the admission is the declarations, `resolveDepends`' implicit chain).
- **The exclusion's true shape**: the idle test's danger is a script running against the tree while
  a sibling doc lane writes (the side-effect guard's snapshot/restore attributes "the delta between
  the two reads" to the script on the assumption "it ran alone between them", `src/script.ts`). The
  channel's engine gate is `testByDriver && codeWork(phase)` — doc-phase sessions are already inert
  (0083 D9); the reachable conflict is exactly a doc lane inside a code-work phase; and the
  teaching reaches every session through the AGENTS block, so the exclusion had to be mechanical,
  not prose.

## The ruling

**D1 — the doc-concurrency teaching keys on width + doc phase, in a new level-free pack section.**
`## doc-parallelism` (registry key `docParallelism`, additive): the canonical declaration teaching
(medium's paragraph verbatim, including the "spends the width" tail), injected into the formulation
Scope and the phase-append prompt when the run's `maxSessions ≥ 2` and the phase is a doc phase
(`input.phase` present, `codeWork !== true`; m mode gets nothing). All four shipped packs carry it.
Preflight warns at width when the active pack lacks the section (the `## parallelism` warning's
sibling).

**D2 — the level becomes purely the code-depth key.** The `## Parallelism (level)` block narrows to
code-work phases and m mode; the three level texts drop their doc paragraphs; at width 1 a doc phase
renders neither block. `--parallel`'s two meanings (code planning depth, landing-conflict posture)
are otherwise untouched.

**D3 — the `--handover-test` exclusion mechanized; the preflight refusal retired.** Session `Opts`
gains `docLane` (set by the doc-lane dispatch through the `SessionSite`, the `stream` precedent).
The test concern, at the pending marker: a doc-lane session's request is consumed (`fx.resolveTest`)
and refused with a steer — no script runs beside sibling writes; the wrap-up's test lanes (which
drain, 0099 D9) cover the verification — and the session continues. Safety: doc-phase sessions are
already inert; doc-lane sessions never run scripts; every other session runs through the serial
degrade alone, after the drain — no script ever executes against the tree while doc lanes are in
flight. Tier ≥ 1 unchanged (a lane worker tests against its own worktree). Measured detail: the
marker `tmp/test.sh` is per-tree and shared — under concurrent doc lanes a sibling's concern may
consume the marker first; both consumers refuse, no script runs either way, and the channel is not
taught to doc-lane sessions at all (D4), so the collision is theoretical.

**D4 — the teaching layers beside the mechanism.** The test-exec protocol partial renders
`{{^docLane}}` (a doc-lane session's own prompt never teaches the channel); the AGENTS block's
`TEST_PRINCIPLE` gains one clause (a documentation-lane session does not use the channel
mid-session; the wrap-up's lanes cover it) — the ratchet's containment probes still match, the
preamble golden moving with its source.

**D5 — the config surface states the model.** The shell's `--max-sessions` help (doc waves out of
the box, declarations arranged at width, code concurrent only under `--tree-lanes`), the
`--parallel` help (code-phase depth + posture; doc phases read the width-keyed section), and the
0125 D4 preflight note reworded to the same truth (still no-level-only).

## Enactment

The registry (`types.ts`, `load.ts`), the extractor (`prompt.ts`), the two planning blocks
(`prompt-plan.ts`, `phase-append.md`), the four width pass-throughs (`loop-plan.ts`), the four
packs, the opts threading (`opts.ts`, `loop-task.ts`), the concern branch (`engine/concerns/test.ts`),
the preflight changes, the two teaching sites, the shell help. Tests: the registry count and field;
the parallel.test doc-block trio (width-keyed, phase-split, the pack-less floor); the session-opts
pin; the turn-protocol refusal (marker consumed, steer, no `runTest`); the agent-fake loop case (a
doc-lane execution session requesting a run gets the steer, the loop completes, the marker gone);
the preflight composition test (the retired refusal) and the reworded note; the bundle ratchet (all
four packs carry the section, no bundle ships `## parallelism`); the four goldens moving with their
sources (the three parallel goldens' doc paragraphs, the work-order preamble's clause).

Verification: full typecheck clean; both suites green; the closing read ran the real CLI on a
scratch project — `init --handover-test true` + `run --max-sessions 6 --boundary flow` passes the
retired refusal into preflight (the reworded note, the tier line with `doc lanes on`, no
`--handover-test` line), and a doc-phase formulation render at width 2 carries the `## Doc
concurrency` block (unit-pinned) while width 1 renders neither block.

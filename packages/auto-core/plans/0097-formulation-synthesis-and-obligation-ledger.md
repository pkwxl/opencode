# 0097 — Formulation synthesis and the obligation ledger (0095 D7, Stage 2)

0095 D7 sketched Stage 2 as a charter-gated constructor session replacing the
deterministic Scope assembly. This document designs that change and extends it
one step further, because synthesis alone does not reach the objective: **a
phase's plan must demonstrably cover everything its sources demand**. Today
completeness rests on two holistic LLM reads — `verifyPlanStep` before the
session, the wrap-up after — and neither *enumerates* the requirements. An
incomplete plan fails (or worse, passes) without anyone able to name *which*
obligation went missing, or *where* it went missing: never extracted? extracted
but uncovered by any task? covered on paper but under-delivered? Stage 2
therefore lands two halves:

- **synthesis** (the sketch): where the pack declares a plan charter, a
  constructor session re-voices the evidential sources under the charter,
  instead of stacking them verbatim;
- **checkability** (the addition): the same session derives an **obligation
  ledger** — the enumerated, quoted list of what the sources demand — which the
  formulation session plans against, the driver totality-checks, and the
  wrap-up judges row by row. Every gap becomes a named row with a source and a
  quote; the fix loop gets pinpointed input instead of a holistic FAIL.

The failure policy throughout is the same principle the blockage machinery
(0082) and the park honesty gate (0096 D6) already carry: never fail silently,
never continue silently — degrade loudly with the information a person (or a
fix session) needs. The ledger is the park's honesty philosophy lifted to
planning: declared consumables are checked before a task parks; declared
obligations are checked before a plan is accepted.

Status: **settled** (ruled 2026-10-15) — all seven open points (⚖, collected at
the end) adopted as proposed, including ⚖5: D8's per-row wrap-up consciously
amends 0095 D2's "no wrapup-template change" for ledger-bearing formulation
tasks. Default-intent projects keep the deterministic floor forever (0095's
ruling stands).

## The crux — every input source: does it exist, in what form, what goes wrong

The three failure modes that recur across every source:

- **omission** — a source never reaches the planning session (empty brief,
  missing handover, analysis not yet written), so the plan misses obligations
  and the miss is discovered late or never;
- **dilution** — all sources dumped verbatim (today's block stack), so the
  session reconciles a long heterogeneous document in which the charter's
  priorities are implicit; attention spreads thin. (The raw-material charter's
  "do not merely enumerate test categories" is the same disease at task level —
  the block stack is category enumeration at input level;)
- **uncheckable conflict resolution** — the authority order *instructs* how
  disagreeing sources are resolved (charter wins, surface the conflict), but
  nothing ever checks that a given plan actually resolved its actual conflicts
  consciously.

Per source, the verdict — every source stays; what changes is its **form**
(verbatim evidence / protocol frame / derived) and its **detection point**:

- **Project brief** (`.opencode/auto/brief.md`) — must exist (project
  constants; for migration intents, where the reference lives). Form: verbatim
  evidence, forever — person's words. Its scope posture and locations become
  ledger rows quoting it. A missing/empty brief renders today's "Not provided"
  fallback **plus** a source-health finding in the audit, never silence.
- **Round brief + round rules** (`round.md` + the pack's `### round-brief`) —
  must exist. The brief is verbatim evidence (person-authored); the rules are
  pack protocol (frame). The round's goals and criteria become ledger rows —
  today they bind only through the generic charter's soft mention.
- **Approved analysis** (`docs/analysis.md`, human-gated phases) — must exist
  when gated. Verbatim evidence; the richest obligation source (the raw
  material's "requirements, analysis and design artifacts"). Its decisions,
  constraints and roadmap items become rows; its settled points stay settled
  (the block's framing discipline unchanged).
- **Planning input** (`plan-input.md`) — must exist (m mode refuses without
  it). Verbatim, the strongest person-channel discipline — quoted under its own
  heading, never paraphrased (0095 D5 stands). Its asks become rows quoting it.
  The admission warn (0082 D14b) keeps its place.
- **Mode preamble** — exists as config text when a scenario mode is set;
  protocol frame; rarely obligation-bearing; no rows required.
- **Authority order** (`### precedence`) — must exist when declared; protocol
  frame; a constitution, not evidence. The change: the constructor enumerates
  the *conflicts it actually found between sources* as ledger conflict rows
  ("input asks X; analysis settles Y — analysis wins, record the deviation"),
  and the wrap-up checks each conflict row was consciously recorded — conflict
  resolution stops being instructed-only and becomes checked.
- **Prior-phase handovers** — must exist for phases after the first; verbatim
  (driver-gated distillates). Their "required reading / open questions /
  carried obligations" content is *the* obligation source for later phases —
  the test phase's design objectives live in the design phase's handover. The
  four-section protocol is already quasi-structured, so row extraction is
  reliable.
- **Prior-round digest** — must exist on continuation rounds; verbatim
  (driver-computed, already capped with the digest-index form, 0061 R3). Its
  "gaps and misses" are priority obligations → rows.
- **Phase duties** — pack/custom-type protocol text; protocol frame, never
  re-voiced. This is also what keeps the guarantee asserts holding (the pinned
  literals live in duty text). The registry's standard artifacts and verdict
  protocols are seeded into the ledger *mechanically* (below), so protocol
  obligations are always ledged even if the session under-extracts.
- **Report duty, parallelism, protocol skeleton, Constraints, doc-layout** —
  pure protocol; protocol frame; never re-voiced, never LLM-owned.

So: nothing is eliminated from the input side. The pipeline adds a derived,
checkable organizing layer above the sources while the verbatim layer stays
beneath them as ground truth — the brief cites the sources; the fidelity pass
and the wrap-up re-read the sources; nobody trusts the distillation alone.

## D1 — The per-phase charter channel (`### verify-plan-<phaseKey>`)

`## guarantees` keeps its three pack-global subsections and gains an optional
per-phase family, keyed like the assert qualifier's vocabulary (builtin letter
or declared custom type id):

- `packSubsection(pack, "guarantees", "verify-plan")` — the pack-global
  charter, binds every phase (cleanroom's two-room walls must ride everywhere);
- `packSubsection(pack, "guarantees", "verify-plan-<phaseKey>")` — the phase's
  plan charter (e.g. `verify-plan-t`, `verify-plan-spec-read`), refines the
  global one for that phase's formulations.

**Resolution** (`resolvedVerifyPlan(pack, phaseKey?)`, pure, in
`src/intent/guarantees.ts`): `{ global?, phase? }` — both may be present, both
bind. **Activation rule**: the plan verifier and the synthesis path activate
iff the *resolved* charter for that formulation is non-empty — a pack declaring
only `verify-plan-t` gets charter semantics (verifier, synthesis, ledger) for
test phases and pure Stage-1 floor for every other phase; a pack declaring the
global charter gets it everywhere, refined by `verify-plan-t` for test.

**Acceptance composition** (`formulationAcceptance(facts, phaseKey?)`): the
generic core (unchanged), then "The project's intent charter binds this plan in
addition:" + the global charter, then — when present — the phase charter under
its own lead-in. `verifyPlanStep` and the append path's verification resolve
the same way (the append prompt itself is untouched — ⚖ open whether append
ever synthesizes; proposal: no, out of scope).

**Preflight** (`guaranteesProblem` extension): every `verify-plan-*` key's
suffix must be a builtin letter or a declared custom phase type id — a typo'd
key is a strict usage error naming the pack (parsed-strictly culture; other
unknown `###` keys under `## guarantees` keep today's tolerance).

## D2 — The obligation ledger

The derived contract layer. **Grammar** (strict, driver-parsed; lives as a
`## Obligations ledger` section *inside the todo's Scope* — the todo stays the
session's single input, no sidecar file):

```
- O-01 | round.md | "error semantics preserved for the parser" | the plan's tests exercise parser error paths and record observed evidence
- C-01 | plan-input.md vs analysis.md | "input asks a rewrite of the config layer" / "analysis settles the config layer as stable this round" | analysis wins (authority order); the plan records the deviation, never silent
```

- `O-<nn>` obligation rows: source path · verbatim quote · obligation phrasing
  (what the plan must cover — a task, or an explicit deferral with reason).
- `C-<nn>` conflict rows: the two sources · both quotes · the authority
  order's verdict · what the plan must record (deviation or provisional
  default), never a silent resolution.

**Mechanical seeding**: the driver seeds protocol rows itself before the
session adds judgment rows — the phase type's standard artifacts
(`phaseArtifacts`/`taskArtifacts` from the registry or custom file), the
verdict protocol (`Result:` line) where the type carries one, the round report
duty when `finalPhase`. Seeded rows' quotes locate in the composed Scope's own
duties frame, so the same locate-check applies.

**Boundaries** (honest limits, stated in the template): the ledger enumerates
what the *sources* name — it cannot invent requirements (the fidelity pass
guards that direction), and the repository survey stays the formulation
session's own first duty (protocol item 1, unchanged). The ledger carries this
round's obligations under the charter; the charter carries the standing bar.

## D3 — The constructor session and the synthesized Scope

**Shape — driver frame + session brief** (⚖ alternative noted below): the
synthesized Scope is assembled by the driver around one session-authored
block:

- **frame** (driver-owned, verbatim, never re-voiced): the single-input
  preamble (reworded: frame + constructor's brief), the planning input quoted,
  the mode preamble, the authority order, the phase duties (+ report duty,
  parallelism, the trimmed-pipeline note), the format protocol skeleton, the
  Constraints — i.e. every protocol-bearing block, which is also where assert
  literals live, so the guarantee gate keeps holding by construction;
- **`## Sources brief (constructor session, under the charter)`** — the
  session re-voices the evidential sources (project brief, round brief,
  analysis, handovers, prevRound digest) organized as the charter directs —
  for a test phase under the raw-material charter: coverage / design
  verification / quality-and-risk / evidence-and-limitations sections —
  quoting load-bearing lines verbatim and naming their sources;
- **`## Obligations ledger`** — D2.

Goal and Acceptance stay driver-owned exactly as today (`formulationAcceptance`
now phase-aware).

**The session**: tool-less one-shot (the `oneShot` primitive, `bare: true` —
read-only by construction, no worktree pollution, no session commit; the
driver owns every write and commit, the blockage-diagnose pattern) at the
**planning role's route** (deep tier — ⚖ open: cheap classifier entry instead).
New template `templates/prompts/formulate-synthesize.md` (registered in the
embedded registry): the sources as data, the resolved charter(s), the duties,
the row grammar, the brief contract, strict output delimiters and a closing
`Rationale: <one line>` (→ the audit). Bounded: one feedback retry.

## D4 — Mechanical validation and the degradation ladder

Before anything lands, the driver checks — all cheap, all deterministic:

1. row grammar parses; ids unique/sequential; sources are among the actual
   input sources;
2. **every quote locates in its named source** (the blockage-span precedent,
   content-tolerant matching carried over);
3. the guarantee asserts over the whole composed Scope (the gate itself stays;
   a miss here is a *retry cause*, not exit 2);
4. frame blocks are verbatim by construction (nothing to check — that is the
   point of the frame).

**Degradation ladder** (⚖ open: fail-closed alternative): unparsable /
assert-miss / fidelity-fail after the one retry → land the **Stage-1
deterministic floor** instead (the charter still rides the Acceptance,
`verifyPlanStep` and the wrap-up — Stage-1 semantics, judgment-equivalent to
today), append the audit entry `synthesis: FALLBACK — <reason>`, surface the
fallback in the round report's needs-attention section, continue the run. A
misbehaving constructor degrades quality, never blocks planning; and the floor
is always available because it is the same code Stage 1 runs.

## D5 — The fidelity pass

A second cheap one-shot (the `verifyPlanPrompt` shape: classifier entry,
tools denied, strict last-line verdict, one retry, fail → the D4 ladder):
given the sources and the session's ledger + brief as data, judge that
nothing load-bearing was dropped, nothing invented, no obligation weakened.
Because anchoring is already mechanical (D4.2), the fidelity pass's job is
*relevance judgment*: did any real demand of the sources fail to become a row?
Verdict line `Fidelity: pass | fail — <evidence>`; the evidence is the retry's
feedback text. New template `templates/prompts/formulate-fidelity.md`.

## D6 — Construction, idempotence, audit, switch

- **Idempotence** keyed on the deterministic floor, not on model output: the
  formulation unit's runtime record (`.auto/units.json`) gains an optional
  digest field of the floor assembly. Pending + digest unchanged → `current`
  (the landed synthesized todo stands; no churn from model nondeterminism);
  fresh or digest changed → re-construct through the full pipeline. A pending
  Stage-1 formulation at upgrade (no digest recorded) re-synthesizes once — a
  one-time migration rewrite, acceptable.
- **Audit**: `docs/R-NN/prompt-audit.md` gains synthesis entries in the
  existing line format, committed pre-construction (stage `prompt-audit`):
  `- <ISO> formulation <phaseId> synthesis: charters [verify-plan, verify-plan-t] — <Rationale>`,
  `… fidelity: pass | FAIL — <evidence>`, `… synthesis: FALLBACK — <reason>`.
  The committed artifacts (todo with ledger, coverage map, audit lines)
  reconstruct the whole chain from git history alone — what the planner saw,
  what it claimed, what was checked.
- **Switch**: `OPENCODE_AUTO_SYNTHESIS` (default on; env-only, never
  persisted). Off = the deterministic floor even for charter packs — the
  charter still rides Acceptance and the verifier; the switch can only remove
  the enhancement, never a check (the `OPENCODE_AUTO_PLAN_VERIFY` precedent).
- **Cost**: per formulation, charter packs only — one deep one-shot (+ ≤1
  retry), two cheap one-shots (+ ≤1 retry each). The formulation step already
  runs a full task session; this is bounded addition.

## D7 — The coverage map

The formulation session's closing write: `docs/T-NNN/coverage.md` (the
formulation task's own directory — a new standard artifact with a document
role, write policy and eof rule), strict rows mapping the ledger:

```
- O-01 -> T-012 (the parser error-path suite)
- O-02 -> deferred(this round defers DO-3 verification: blocked on the fixture infra gap, reason recorded in T-018's document)
- C-01 -> conflict-recorded(T-018's document records the deviation per the authority order)
```

The driver checks totality mechanically inside the existing formulation
collect (beside `plannedTaskProblems`): every ledger row appears exactly
once; every referenced task id exists in the index; deferral rows carry a
reason. Missing rows are named problems — the outcome is `blocked` with the
row list (the collect's existing behavior; a re-run dispatches a fresh
session over the surviving files).

## D8 — Per-row wrap-up and targeted fix rounds

A conscious amendment of 0095 D2's "no wrapup-template change" (flagged for
the ruling): a formulation task whose Scope carries a ledger gets the per-row
framing — for each ledger row, judge by inspection whether the mapped task's
scope and acceptance actually cover the quoted obligation. `gaps.md` entries
must name the row (`O-02 (analysis.md: "…") — T-014's scope does not cover
…`), so the bounded fix rounds (0083, `FIX_ROUNDS` unchanged) edit the named
tasks — bounded *re-planning* becomes targeted re-planning. Formulation tasks
without a ledger (floor packs, fallbacks) keep today's holistic judgment
word-for-word.

## D9 — The bundles' test charters (the raw material fitted)

The person's test-phase plan charter (the raw material) lands as
`### verify-plan-t` in each shipped bundle, per derivation axis — shared
spine, axis framing (drafts here; full texts land in the bundle files at
Stage A):

**Shared spine** (all three, de-migrationed wording): the test plan must
establish a verifiable path to the round's coverage targets, the validation
of the applicable design objectives, and an honest quality assessment of the
round's delivered work; independently inspect the round's requirements,
analysis and design artifacts, the implementation changes, `<axis
authority>`, existing tests and project tooling; derive scope, coverage
strategy, behavioral assertions, risk-based cases and acceptance criteria
from these — never invent them. Explicitly address:

- **Coverage** — how required line/branch coverage is measured, how gaps are
  identified, which tests close them;
- **Design verification** — how each applicable design objective and core
  behavioral requirement maps to implementation areas, test cases, assertions
  and verifiable evidence;
- **`<axis quality>`** — see below;
- **Evidence and limitations** — actual results distinguished from
  assumptions; uncovered code, unverified requirements, environmental
  constraints, unresolved discrepancies reported openly.

…and the actionable-plan admonition (no category enumeration; derive
implementation-specific detail from the repository and artifacts), plus the
**adaptive test planning** block (the five failure-handling steps:
investigate origin → scope decision against the round's objectives → fix
in-scope without weakening assertions or acceptance criteria → regression
coverage per fix → deferred issues recorded with rationale; critical failures
and unresolved mandatory requirements never reported as passed;
verified/failed/blocked/deferred distinguished in the final assessment).

**Axis deltas** — `<axis authority>` and `<axis quality>`:

- **cleanroom**: authority = *the specification notes the spec-read phase
  distilled*; quality = conformance divergence from the specification —
  boundary defects, failure-handling errors, resource lifecycle issues — with
  the wall sentence restated for planning: no test reads, searches or
  reconstructs the reference or its quarantined paths; independence defects
  (structural cloning) are findings the plan must be able to surface;
- **faithful**: authority = *the behavior baseline the analysis phase
  distilled* (the reference observed); quality = parity — how the plan exposes
  behavioral divergence from the baseline, boundary defects, failure-handling
  errors, resource lifecycle issues;
- **faithful-lean**: faithful's, plus debt-removal accounting — tests prove
  each deliberate removal changed nothing observable (public interfaces,
  effects, state and error semantics).

The default pack stays charter-less forever — no `## guarantees`, floor only
(0095's ruling). Project overlays may declare `verify-plan`/`verify-plan-<key>`
for their own axes (the migration project this raw material came from being
the first customer).

## D10 — Modes, lanes, append, manual suite

- **m mode**: no phase key → the pack-global charter alone; sources are brief
  + plan file (+ seeded report-duty row); the same machinery, the manual
  variant's frame.
- **Custom phase types**: key = the type id (`verify-plan-spec-read`);
  custom files may keep carrying their own `## plan duties` untouched — the
  charter channel is orthogonal to the duty channel.
- **Trimmed pipelines / continuation rounds**: fewer sources, same flow.
- **Lanes**: unchanged — the formulation task runs serially in the plan
  branch, ahead of the scheduler (0095 D5).
- **`plan --append`**: no synthesis, no ledger (out of scope); its
  `verifyPlanStep` resolves the phase's charter composition (a two-line
  consistency win riding D1).
- **Manual prompt suite** (`prompts/`): no mirror this change — the suite
  stays floor-only; the coverage map and ledger are driver machinery whose
  grammar the manual driver does not produce. Revisit if the suite ever
  adopts charters.

## D11 — Staged landing and test surface

- **Stage 0** — this document; AGENTS.md navigation line; docs/structure.md.
- **Stage A** — D1 (charter channel, resolution, preflight validation,
  acceptance/verifier wiring) + D9 (the three bundles' `verify-plan-t`).
  No sessions; immediately useful (charter rides Acceptance + verifier under
  the floor).
- **Stage B** — D2 + D3 + the frame renderer (`renderFormulationTodo` gains
  the synthesis shape) + D4's mechanical validation + D6 (digest idempotence,
  audit entries, switch) + the synthesize template.
- **Stage C** — D5 (the fidelity pass + template).
- **Stage D** — D7 + D8 (coverage map role/spec, totality check in the
  formulation collect, per-row wrap-up framing, gaps row-naming, round-report
  fallback line).

Tests: new `test/formulate-synthesis.test.ts` (gate, resolution, grammar,
locate-check, ladder/fallback, digest idempotence, switch, audit lines);
amend `test/formulate.test.ts` (phase-aware acceptance),
`test/intent-guarantees.test.ts` (key validation), `test/golden/` (the frame
shape with a fixed fake brief+ledger), `test/prompt-template.test.ts` (the
two templates), `test/verify-loop.test.ts` (per-row wrap-up, row-named gaps),
`test/fixtures/loop.ts` (a constructor-marker turn), and the pinned suites
the D6/D7 grammar touches (tasks, plan, plan-loop, artifact, close, resume).

## Open points for the ruling (⚖)

1. **Scope shape** — driver frame + session brief + ledger (proposed), vs the
   session composing the whole Scope with machine-checked verbatim anchors.
   The proposal keeps every protocol line driver-owned by construction and
   shrinks the fidelity pass to relevance judgment; the alternative gives the
   session full document flow at the cost of LLM-reproduced protocol text.
2. **Failure policy** — degrade to the floor + loud audit (proposed), vs
   fail-closed exit 2 once a charter is declared.
3. **Constructor tier** — the planning route (deep, proposed: it is planning
   work and the ledger is load-bearing), vs the classifier entry (cheap, the
   verifier's precedent).
4. **Ledger home** — inside the todo's Scope (proposed: single-input
   discipline), vs a sibling document the todo references.
5. **Wrapup amendment** — D8 consciously breaks 0095 D2's "no wrapup-template
   change" for ledger-bearing formulation tasks; confirm.
6. **Default-pack duty enrichment** — whether the default pack's `### t
   testing` splitting criteria also absorb the axis-neutral spine (proposed:
   no — default keeps the floor untouched this change; a separate copy-only
   change can enrich duties later).
7. **Append path** — out of scope (proposed), or append also synthesizes /
   updates the ledger when its sources change.

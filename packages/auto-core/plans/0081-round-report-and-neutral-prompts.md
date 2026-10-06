# 0081 — The round user report and work-type-neutral prompts

Status: **implemented** (2026-10-06). The findings were settled from the R-01 records in
`/home/wxl/workspace/cleanroom` (the first cleanroom-bundle run: ext4 → ext4x, in-tree
replication); the document is the design record — later changes are not tracked here
(the plans/ retirement rule), the surfaces it names carry the living truth.

The problem, in one paragraph: everything the pipeline writes is addressed to the process — later
sessions, driver gates, the next migration — so the person who started a run gets no durable
summary and must read the raw process documents to learn what happened and what needs their
attention. And the core prompt surfaces still speak the tool's original dialect, migration between
two systems, which misframes every other kind of work: the core ships exactly one mode
(`templates/modes/migrate.md`), the continuation-round block, both knowledge skeletons and four of
the six default duty partials say "migration" / "the source system", and the cleanroom mode's wall
assumes a layout separation that in-tree replication cannot offer. In the recorded run both gaps
were closed by hand: four long mid-session interjections (~100 KB of analysis injected into the
planning session, `.auto/run-events.jsonl`) adapted the generic six-concern duties to a 65k-line
filesystem, reconciled the mode text with the playbook's taint model, and repaired a scope
misunderstanding the question flow had produced.

> **The fix, in three moves: a planned closing task writes a human-facing round report that the
> round-close gate requires — the core prompt surfaces become work-type-neutral, with scenario
> vocabulary owned by modes and intent bundles only — and every surface where the person speaks
> into the pipeline (the brief, the planning input, the greenfield charter, the re-work survey
> gate) teaches its own shape instead of assuming a reference exists.**

## §0 The record analyzed

- Target `/home/wxl/workspace/cleanroom`: `init --intent cleanroom` (mode `cleanroom`, phases
  `spec-read,design,implement,test,audit`, `subtask: off`, `wrapup: true`, 2026-10-05); brief
  filled by the person (goal: clean-room ext4 as `./ext4x`, reference `./linux`, vethxx as the
  build/test precedent).
- The attended `plan` run: R-01 established with the five phases; two planning steps of P01
  spec-read, each judged `consistent` by the plan verifier (`docs/R-01/prompt-audit.md` — the 0080
  §5 machinery worked); one question cycle (MUST scope + journal treatment, answered free-text
  "reimplement jbd2 too"); one corrective interjection ("all of ext4 should be reimplemented");
  ten tasks T-001..T-010 planned; nothing executed yet (`.auto/units.json` empty).
- The person-side methodology: `CLEANROOM-PLAYBOOK.md` (taint clock, oracle roles, SPEC-READ exit
  discipline) and the completed `vethxx/` precedent (SPEC/INTERFACE/ACCEPTANCE docs).

## §1 Findings (each with its evidence)

- **F1 — no human-facing wrap-up anywhere in the plan structure.** The ten planned tasks produce
  per-task `notes.md` plus `spec-notes.md`; the round's only closing artifacts are the audit
  verdict (a driver gate string) and, at round close, kb.md (machine-facing, migration-framed).
  `docs/R-01/round.md` is still the unfilled stub. The run's terminal conclusion (stats,
  proxy-answer tallies) is stdout, not a durable artifact. Meanwhile T-009's Scope buries exactly
  what the person needs surfaced: the `kdev` image lacks e2fsprogs, an environment gap the test
  phase will hit.
- **F2 — migration framing baked into core surfaces that render regardless of intent.**
  `templates/prompts/phase-plan.md` (the `prevRound` block: "a full round of phased migration …
  fuller agreement with the source system"); `templates/prompts/knowledge.md` and
  `prior-knowledge.md` (whole skeletons: "Migration knowledge base", "reuse by the next
  migration"); `templates/prompts/_partials.md` (`plan-duties-a/m/t/k`: "the source system's …
  external behaviour", "Complete the code migration", "migration/backfill of the test suite",
  "migration-knowledge distillation"); `templates/intents/default.md` (`### m migration
  implementation`); `src/brief.ts` (the stub's Source hint: "For a migration: what is migrated
  from"). None of this reached the R-01 planner through the pack (the cleanroom pack overrode its
  phase duties), but every continuation round of this project will render the `prevRound` block,
  and any default-intent project renders all of it.
- **F3 — the two-room model assumes a layout the in-tree case cannot offer.** The cleanroom mode
  preamble demands "the brief also states how the source is kept apart from the target worktree
  the clean rooms work in" (`templates/bundles/cleanroom/modes/cleanroom.md`). Here the reference
  (`./linux`) sits in the same tree the clean rooms work in; the actual wall is rule-based
  (path/name quarantine, per the playbook §6), and the platform-vs-reference boundary (is jbd2 a
  platform library or reference?) is precisely the question the two-system mental model has no slot
  for — it became the planning question cycle. The first interjection spent its opening paragraphs
  reconciling this mode text with the playbook's taint model.
- **F4 — duty text does not scale with the reference.** The spec-read duties name six concerns as
  if one task each; ext4 is ~65k lines + ~9.6k of jbd2. The interjections had to decide that a
  concern may span several tasks (the planner explicitly worried whether splitting was legal), that
  the on-disk format is "public interface" for a filesystem, and how to map ~25 feature areas onto
  concerns. The planned result is good — the gap is that ~100 KB of external reasoning produced it.
- **F5 — question-flow friction.** A free-text answer to an options question ("reimplement jbd2
  too" for both scope and journal) was genuinely ambiguous, and the same-question re-ask ban made
  the planner resolve it by interpretation instead of a confirming follow-up; the person then had
  to interject the correction ("all of ext4 should be reimplemented"), and already-written T-001
  was rewritten mid-plan. The deeper diagnosis (D16's rule): real time is the wrong medium for
  consequential questions — an answer given before the implications are understood carries no
  guiding value; the correction that arrived later, after reflection, is the model.
- **F6 — round.md has no owner at establishment.** The stub's comments assign it to the human, but
  nothing tells the attending human that filling it is expected before the first phase plans; R-01
  planned against brief + planning input only.
- **F7 — the brief's ask is undiscoverable at the moment it fires.** The brief is the only channel
  of project intent into planning (0052 D9), an untouched stub injects nothing (comments stripped,
  `src/brief.ts` `stubbedText`), and under cleanroom it is indispensable by the mode's own words
  ("The brief must name where the reference implementation lives") — so every cleanroom plan run
  with a stub brief hits the ask. What the person gets at that moment is one line from the prompt's
  fallback branch (`templates/prompts/phase-plan.md`: "ask a human to write
  .opencode/auto/brief.md and rerun") — no structure, no mention that init left a stub with hint
  comments. The CLI's retirement messages do point at the file, but only when a retired flag is
  tried; the person who never touches a flag sees nothing. And the mechanics after the edit are
  equally silent: the driver never writes or commits the brief (only init's stub, reset's
  stub-removal, fix's retired-key moves), so the hand edit must also be a hand commit or the
  clean-tree gate blocks the next start. The R-01 record shows the full cost: the person
  reverse-engineered all of this mid-run and landed the filled brief as a bare hand commit
  (`727f2ca`, no `Auto-Stage` trailer) between two planning steps.
- **F8 — the planning input is a free-text box with no shape.** The planning input is the person's
  only steering wheel at plan time, persisted verbatim (`src/plan-input.ts`, committed on its own
  before the session) — and nothing anywhere teaches what a good one names. R-01's
  `docs/R-01/P01-spec-read/plan-input.md` is a verbatim restatement of the brief's Goal paragraph:
  no scope posture, no priorities, no acceptance anchor, no environment facts. Everything the input
  should have carried surfaced instead through the session's question cycle and the ~100 KB of
  interjections (F4/F5's cost). The same gap stands for every intent: the default experience is an
  empty `-p` with no template, no example, no intent-aware guidance.
- **F9 — greenfield work has no front door.** The work-type family is re-work only: the default
  pack presumes a migration source, cleanroom/faithful presume a reference implementation, the
  brief's `## Source` heading points at existing material, and the analysis duties survey "the
  existing implementation". For entirely greenfield work — no reference, nothing to survey, no
  experience to leverage — every one of those surfaces misfires, and the person faces `init`'s
  flags and an empty `-p` with nothing to negotiate against. Yet greenfield is where the baseline
  needs the most deliberate construction: goal, external contracts, acceptance model and harness
  are all decisions, and `plan` cannot plan soundly before they exist. That negotiation today
  happens ad hoc in whatever helper session the person happens to open — the R-01 interjections
  show the cost even for re-work; greenfield has no shaped place for it at all.
- **F10 — re-work's scoping decisions are made cold, at deep-phase planning time.** The scope
  forks of migration/replication work (what is MUST, what depth, which subsystems, which platform
  boundary) decide the shape of every later phase — yet today they surface as questions asked by
  the *planner of the deep phase itself*, before any survey artifact exists: R-01's spec-read
  planning asked the MUST-scope and journal questions cold, the free-text answer's ambiguity
  produced a guess corrected by interjection (F5), and the survey-level reasoning that should have
  grounded the decisions arrived as ~100 KB of external steering (F4). T-001 (the feature matrix)
  ended up improvising the survey role *inside* spec-read — the two-stage shape the run needed,
  assembled by hand. Rushing the full analysis workflow — especially spec-read — from a standing
  start commits the deep phases before the person has seen the reference's lay of the land; the
  mechanism already knows how to wait for a human (the acceptance gate's `Accepted: yes`), it just
  has no front-end counterpart.

## §2 Direction 1 — the round user report

- **D1 — the artifact.** `docs/R-NN/report-for-user.md`, one per round, written by a task (never
  by the driver). The name is self-describing and greppable, and cannot collide with the task-level
  wrap-up `docs/T-NNN/report.md` or the knowledge `kb.md`. It is a process document: it may
  reference anything; deliverables still must not reference it (P1 unchanged).
- **D2 — a planned closing task, not a driver side-channel.** The phase-plan facts
  (`src/prompt-plan.ts`, assembled where the planning step knows the round's phase list) gain
  `finalPhase: boolean` — true on the round's last **task-bearing** phase (a trailing knowledge
  phase is skipped by the duty; see D6). When set, `templates/prompts/phase-plan.md` renders one
  extra duty paragraph beside `{{planDuties}}`: this is the round's final phase — end the task
  list with one wrap-up task whose deliverable is the round report, placed after the
  verdict/consolidation closing task (a FAIL verdict is one of its findings, not a reason to
  skip it). The paragraph carries the D3 charter in full so the planner can restate it into the
  task document (self-contained, as every task document must be). No new session template: the
  report task runs as an ordinary whole-task session against its task document. Non-final phases
  render nothing; the no-phase implicit round (its single phase is final) gets the duty like any
  other.
- **D3 — the charter (what the report must contain).** Audience: the person who started the run,
  plain prose, path links, no driver-protocol obligations beyond the eof terminator:
  1. What this round set out to do, in the person's own terms (brief, round goal, planning input).
  2. What happened, phase by phase: what each phase delivered, its verdict, headline counts
     (tasks done / failed / blocked / closed by hand).
  3. **Needs your attention** — the section the whole artifact exists for: every
     provisionally-defaulted planning question with its options, implications and override path
     (D16 — spelled out for leisure analysis, not seconds); open questions and the safe defaults
     currently in force; the round's AUTO-RESOLVE proxy decisions with enough context to confirm
     or overturn each; FAIL verdicts and what they mean; environment gaps (the e2fsprogs kind);
     recorded deviations and assumption notes.
  4. Where to look deeper: an artifact index (spec-notes, verdicts, notable task reports), one line
     each — the report links, it never copies at length.
- **D4 — the driver guarantee.** `roundCloseProblems` (`src/round-close.ts`) gains a fourth
  read-only check: the round report exists, is non-empty and eof-terminated. A missing report is a
  blocking problem in the existing shape (the next round refuses to open, exit 2, the message
  naming the file and the phase that should have planned its task). The check self-heals before it
  ever blocks: when the final phase completes without the report, the driver appends exactly one
  report task through the existing append machinery (0079 §4's held-verdict append pattern,
  bounded once) — which also carries legacy rounds whose final phase was planned before the duty
  landed (the record's own open R-01 among them, §7 A2). The complete route's conclusion
  (`src/conclusion.ts`) gains one line pointing at the report path, so the terminal itself names
  where to read.
- **D5 — relation to the knowledge phase.** kb.md stays what it is — machine-facing distillation
  for the next round or project — and keeps its config gate (`wrapup`). The user report is
  unconditional: human attention is not optional. The two may overlap in material; they do not
  overlap in audience, and the knowledge session may read the report as an input (no wiring
  change beyond the D7 retitling).
- **D6 — wiring the report across the surfaces.** (a) *Placement and role*: report-for-user.md is
  a round-level process artifact, the verdict.md treatment — a process role in
  `src/document/roles.ts` (eof-scan exempt like its siblings, out of P1 scope by role), with the
  final-phase duty carrying the placement exception the way the audit verdict duty already carries
  its phase-directory write. (b) *The k-final rule*: when the round's last phase is knowledge —
  the default `admtvk` pipeline — that phase lays out no tasks (`hasTasks: false`), so the report
  is written by the knowledge side-channel session as its second artifact: one session, two
  artifacts (kb.md machine-facing, the report human-facing — D3's charter appended to
  knowledge.md beside D7's retitle); in every other pipeline the last task-bearing phase's
  planner ends its index with the report task (D2). (c) *Protect*: `.opencode/auto/brief.md`
  joins `PROTECTED_FILES` with D15 (§7 A4) — driver writes pass, sessions never touch it.

## §3 Direction 2 — work-type-neutral core wording

- **D7 — the neutralization inventory** (prompt copy only; no parsed protocol string changes —
  `Result:` lines, field names, section heads the driver parses are untouched):
  - `phase-plan.md` `prevRound` block → "a full phased round of work … build on the existing
    results" (drop "migration", "the source system").
  - `knowledge.md` / `prior-knowledge.md` → "this round of work" / "the earlier work already in
    this directory"; skeleton title "Work knowledge base"; "reuse by the next round or project".
  - `_partials.md` `plan-duties-a/m/t/k` → "the existing implementation's external behaviour,
    where the brief names one"; "Complete the implementation work"; "bring the test suite to cover
    the delivered work"; "knowledge distillation".
  - `templates/intents/default.md` `### m migration implementation` → `### m implementation`.
  - `src/brief.ts`: the stub retires with D11 (nothing left to reword); what stays is `fix`'s
    retired-key move under `## Source` / `## Target` (unchanged).
  - `templates/modes/migrate.md` stays as is — an explicitly opt-in scenario mode is exactly where
    migration vocabulary belongs; no neutral core mode is added (modes are bundle/scenario
    territory, 0079 §5).
- **D8 — the cleanroom wall, generalized to the in-tree case.**
  `templates/bundles/cleanroom/modes/cleanroom.md` (and the materialized copy semantics): the brief
  names where the reference lives **and which wall keeps it apart — layout separation (the
  reference outside the worktrees the clean rooms use) or rule separation (a shared tree with the
  reference's paths quarantined: never read, searched or reconstructed)**; under rule separation
  the brief also names the platform boundary (the parts of the shared tree the clean rooms may
  still read). The pack's `### verify-plan` gains the matching sentence so the plan verifier
  judges planning prompts against the declared wall kind.
- **D9 — the scaling clause.** The spec-read duties (bundle `phases/spec-read.md` + the pack's
  `### spec-read` section) gain: the concern list is a floor, not a ceiling — a concern may span
  several tasks sized to a session, and every feature area of the reference is assigned to exactly
  one task (a coverage/accounting task may hold the mapping, as T-001 ended up doing).
- **D10 — question-flow softening (P2, wording only; scope after D16: execution-phase questions
  only — planning no longer asks).** The answer relay names the question it
  answers, so a free-text answer that mismatches an options question is visible in the session; and
  the question rule gains one sentence: a follow-up that states what was understood and asks only
  about the part an answer left ambiguous is a new question, not the banned re-ask.
- **D11 — the person seeds a pointer, never a prose file (F7; completed by D15).** In an
  attended automated flow nothing may require the person to fill or maintain a document by hand:
  1. `init --brief <text> | --brief-file <path>` is the optional **seed** — a one-line pointer
     (what the project is, where the reference lives, where the deliverable goes), written
     verbatim to `.opencode/auto/brief.md` and committed with init's config layer. **Omitted → no
     file is written**: the stub model retires (superseding 0052 D9's stub-and-hand-edit design;
     the old unshaped `init -p` stays retired — the new flag is named and single-purpose), and
     `reset`'s remove-while-stub rule goes with it. Re-init's stateless overwrite replaces
     brief.md only while it equals the verbatim seed — a generated, installed brief (D15)
     survives re-init (§7 A5). The seed is *not* the brief — the analysis
     phase generates that (D15); the seed only points the first survey at the reference.
  2. `amend --brief <text> | --brief-file <path>` stays as the person's rare manual override and
     as the default path's install channel (D15.4) — an escape hatch, not the path.
  3. Discoverability replaces the stub: the `planPrelude` notice fires when no brief exists — "no
     project brief yet; the survey phase will propose one — seed it optionally with
     `init --brief <one line>`, or name the reference in this round's planning input" — and the
     phase-plan `^brief` fallback names the same channels.
  4. The brief's **purpose**, stated once: the project's *constants* — what this project is, where
     the reference/source lives, where the deliverable goes, the constraints every round must
     respect. Every planning session of every round reads it. It is not the round's goal
     (round.md), not the step's ask (the planning input), not generated evidence (survey.md) —
     and its author is the analysis phase, approved by the person (D15).
- **D12 — the planning-input scaffold (F8).** The person's ask deserves the same teaching the brief
  got (D11); wording and one reader, no flow change:
  1. Core: a new optional intent-pack section `## planning-input` — the scaffold text the person
     completes, parsed beside `## guarantees` (same section registration and validation; no grammar
     of its own). The default pack ships the neutral scaffold — what this step is for (one
     sentence, the person's terms); in scope / out of scope; constraints and environment facts
     (missing tools, quotas, layout); priorities and the trade-offs that are the person's call;
     corrections to the provisionally-defaulted questions the last round's report flagged (D16);
     what would convince you it is done. The cleanroom bundle ships its own naming what a
     cleanroom ask should carry: the reference location and wall kind (D8's layout-or-rule, plus
     the platform boundary), the scope posture (bounded core vs full parity, multi-round
     expectation), the acceptance anchor (the build/test precedent to follow), and environment
     gaps. One core reader `planningInputScaffold(dir)`: the active pack's section, falling back to
     the default pack's — the only per-section fallback, explicit at that reader (`intentText`
     reads the active pack alone; the fallback is a scaffold-specific decision, not a loader
     change).
  2. Shell: `plan --scaffold` prints the scaffold to stdout and exits 0 — nothing written into the
     target, the verbatim-input contract untouched (no stub file a `git clean` or a planning step
     could mistake for input). The person completes it into a file and runs `plan --file <path>`.
  3. Prelude complement: when a planning step starts with no input, one advisory notice in D11's
     family — "no planning input given; `plan --scaffold` prints a template to complete".
  Explicitly not: the driver never scores, rewrites or refuses an input (the person's words stay
  the person's words); no interactive prompting; no scaffold text ever lands in plan-input.md or in
  a session prompt.
- **D13 — the charter prompt: a discussion runbook for greenfield baselines (F9).** A new sibling
  of `prompts/run.md` in the manual-driver suite (0078's idiom: a role-defining title, a "hand
  this file to a coding-agent session" usage paragraph, nothing to fill in):
  - **`prompts/charter.md` — "# charter — discuss a working baseline for greenfield work".** For a
    directory with no initialized driver state and no reference implementation: the person hands
    the file to an interactive coding-agent session, then **discusses**. The session is the
    chartering partner, never a driver and never a decider.
  - **The agenda** — what must be settled before `plan` can plan soundly, each item a discussion
    with the person owning the call: (1) problem and users — who feels the pain, what changes when
    this exists; (2) the goal in the target's own terms, no solution language; (3) deliverable
    shape and its **primary external contract** — for greenfield the contract *is* the oracle that
    re-work extracts from a reference; (4) the smallest honest walking skeleton for R-01 plus
    explicit non-goals; (5) the acceptance and harness model — black-box criteria provable with no
    reference, how the thing builds and proves itself, environment facts and gaps recorded
    explicitly (they become the round report's needs-attention items); (6) the round shape — what
    R-01 delivers end to end, what later rounds own; (7) risks and unknowns, with the first round
    sized to retire the biggest.
  - **The protocol** — the session asks and proposes, drafts in the discussion, and lands them
    only on the person's explicit go, **through the flags rather than hand-edited files**:
    `init --brief <text>` (D11) carries the brief, `plan --file <path>` (D12's scaffold) carries
    the first planning input, and the settled `init` flags (phases, intent, agent…) ride the same
    command. After that, `prompts/run.md` or the driver itself takes over.
  - **The prompt states its own difference from re-work**: with a reference the baseline is
    *distilled* (spec-read) and experience is leveraged; greenfield's baseline is *negotiated* —
    every scope sentence is a decision, so the agent proposes and never decides scope.
  - Ratchet: `test/manual-prompts-ratchet.test.ts` extends to pin the file's cross-references
    (the brief's four headings, the D12 scaffold flow, the `init`/`plan` command shapes) to the
    driver's own surfaces, per 0078's consistency discipline.
- **D14 — the two-stage analysis for re-work: a survey phase with a size-conditional human gate
  (F10).** Migration and replication rounds open with a cheap, shallow pass whose results are
  handed to the person **when the pass reveals a scope worth handing over**; only the person's
  clarifications unlock the deep analysis. The person brackets the round — a clarification gate
  at the front where it fires, the user report at the close (D1):
  1. **The phase type**: `survey`, shipped as the re-work bundles' custom phase file
     (`phases/survey.md`, comma-form id like spec-read/audit today — no preset-letter change,
     0079 §5). `Gate: human`, `Phase-artifacts: survey.md`. The bundles' phase lists lead with it:
     cleanroom `survey,spec-read,design,implement,test,audit`; faithful/faithful-lean
     `survey,analysis,design,implement,test,acceptance`.
  2. **The survey's charter** (the type's plan duties, re-voiced per bundle): inventory-level
     reading of the reference only — no distillation, no spec; the deliverable is one document
     written for the person: the reference's map (subsystem areas, sizes, structure), each scope
     fork stated with its options, consequences and a recommended default, the depth/grading
     questions, environment facts and gaps, and a proposed MUST baseline. **Sizing comes first and
     sets the posture**: a reference of a few hundred to ~1k lines in one or two areas with no
     open scope decisions is planned as exactly one task that reads it, writes the short survey,
     and records `Forks: none` — the round then flows straight into the deep phase (the split
     costs one short session, no hold); a reference of tens of thousands of lines, many areas, or
     genuine MUST/depth/platform forks gets the full posture — every fork recorded as a `Fork:`
     line. Explicitly not the specification: the survey proposes, the person disposes.
  3. **The gate — conditional on the recorded forks, holding the phase open the acceptance way**:
     a third `PHASE_GATES` kind `human`, its check mechanical over the phase directory's
     survey.md — **a missing survey.md is a gate problem, never a silent pass** (§7 A6); a
     present file with **zero `Fork:` lines completes the phase like an ungated one**
     (`Forks: none` with the inventory backing it — a claim the person and the audit phase can
     check afterwards); **at least one `Fork:` line holds the phase open** — the acceptance
     gate's control point: done.md waits, exit 2, a designed awaiting-person pause, not a
     failure — until the person's `Clarified: yes` line, which simultaneously releases the phase
     and approves the brief (D15.2's install). The stop message names the file, the line to add,
     and the richer answer channel: `plan --file` with the deep phase's input (D12's scaffold
     shapes it; short answers may be appended beside the forks in survey.md itself). The next
     phase's planning reads the survey through the prior-phase handover like any phase.
  4. **Cross-links**: D12's re-work scaffolds note that the scope-posture item defers to the
     survey when one leads (and when forks fired, to the person's clarified answer); D13's charter
     names the survey as its re-work counterpart (greenfield negotiates with no reference; re-work
     surveys first, then clarifies only when the survey says it matters); the survey's
     environment-gap findings feed D1's round report verbatim.
  5. **The survey pipeline — how survey.md is generated** (no new session kind; the ordinary
     phase machinery, three sessions at most):
     1. **The survey phase's planning session** (the ordinary phase-plan session, carrying D14.2's
        duties as its `planDuties`, judged by the 0080 plan verifier like every planning step)
        does the sizing in its built-in step-1 read-only survey: it enumerates the reference at
        the location the brief names — areas, line counts, structure, the platform interfaces at
        the boundary — and decides the posture. Small: it writes exactly one task document ("read
        the reference, write survey.md, record `Forks: none`"). Forked: it writes the inventory
        tasks it needs (usually one — inventory is enumeration, not reading) plus a **closing
        consolidation task that owns survey.md** — the only writer of the file.
     2. **The task sessions** (whole-task sessions under the bundles' `subtask: off` stamp) read
        the reference at inventory level only and leave notes in their task directories; the
        closing task's session consolidates those into `survey.md` — the map, the `Fork:` lines
        each with options/consequences/recommended default, the proposed MUST baseline, the
        environment gaps — and ends.
     3. **The driver** never authors content: it commits the artifacts, evaluates the gate
        mechanically (zero `Fork:` lines → pass through; else hold), distills the handover on
        release. **The person** never writes the survey — they only clarify it (`Clarified: yes`
        plus appended answers in survey.md, and/or the deep phase's planning input via
        `plan --file`).
  6. **Transition (§7 A7)**: bundles materialize once (0079's no-drift-copy) — the survey-leading
     phase list applies to new materializations, and in an existing target from its NEXT round:
     mutating an open round's phase index trips 0053 D34's drift rule (run exits 1 on drift). The
     record's own open R-01 takes its survey in R-02.

- **D15 — the generated brief: the analysis phase owns brief.md (F8/F10's conclusion).** The
  person cannot write a sound brief before the survey exists — R-01's hand-written brief was a
  one-paragraph restatement of the goal, while everything durable (the parity decision, the
  jbd2 ruling, the platform boundary) was produced *by* the analysis. So the brief becomes an
  artifact of the analysis phase — generated, person-approved, maintained at defined moments:
  1. **Proposal**: the survey phase's closing task writes, beside survey.md's evidence, a
     `## Project brief` section — the goal in the target's own terms, the reference location and
     wall kind, the target, the constraints that bind every round (platform boundary,
     environment facts), and the scope posture with each fork's recommended default. This is the
     analysis phase answering "what should be maintained globally".
  2. **Approval = the gate release**: the person's `Clarified: yes` (D14.3) approves the forks
     *and* the proposed brief in one act; on release the driver installs the section into
     `.opencode/auto/brief.md` verbatim — one mechanical copy, a driver-exclusive write through
     protect, its own commit. The brief's provenance is always generated-then-approved, like
     every other driver write.
  3. **Maintenance at appropriate times, through the same channel**: a later round that opens
     with a survey refreshes it (new constraints, revised posture); the round report (D1) flags
     mid-round decisions that belong in the brief (append/repair verdicts, accepted deviations)
     and the next survey folds them in; `amend --brief` remains for the rare case nothing else
     covers.
  4. **The default path** (no survey phase): the `a` analysis phase's closing task writes the
     same proposal as a phase artifact; installing it is one person command — `amend
     --brief-file <the proposal>` — taken or left at the person's discretion. No ungated session
     text ever becomes config.
  5. **What planning reads is unchanged**: round 1's survey planning reads the seed or the
     planning input — the pointer the person gave (the mode's "the brief must name where the
     reference lives" is satisfied by the pointer until the first release); from the first
     release onward, every planning session reads the installed brief.

- **D16 — planning questions are recorded and defaulted, never asked in real time (F5's deeper
  diagnosis).** A consequential question answered in seconds — before the answerer can understand
  its implications — has no guiding value; the medium was the failure. So the ask retires from
  plan routes:
  1. **The rule**: a planning session that hits a scope, requirements or approach question does
     not call the question tool — it takes the recommended option as a *provisional default*,
     records the question in the affected task documents (the context, the options with their
     consequences, the default taken, how to override it), and continues planning. Permission
     problems stay askable — a mechanical enablement needing no analysis; everything else in the
     ask catalog becomes a recorded default.
  2. **The report is the asking surface**: D3's needs-your-attention section lists every
     provisionally-defaulted question of the round, spelled out for leisure analysis — what was
     asked, why it matters, each option's implications, the default the round ran on, and the
     override path. The person reads, analyzes, then responds — exactly the sequence the R-01
     correction actually followed.
  3. **The answer channel is asynchronous**: the response arrives as the next round's planning
     input (D12's scaffold carries the corrections item) or as a mid-round append — the existing
     machinery; a default that proves wrong is bounded rework (0079 §4's repair), never a guess
     encoded in real time.
  4. **Layering with D14**: the survey gate stays the *blocking* clarification — the forks that
     shape the whole round are held before deep work and answered at leisure. D16 covers what
     surfaces during planning despite a survey: non-blocking, defaulted, reported.
  5. **Supersessions (§7 A9, same-change sweep)**: the plan-route question invariant (AGENTS.md's
     "plan's sessions ... never proxy-answer — a non-permission question waits for the human with
     no timeout") becomes "plan's sessions never ask — they default and record"; the phase-plan
     constraint text and the packs' `### precedence` "or as a question when the call is the
     person's" wording follow; execution phases keep the attended ask (D10's shrunken scope).

  **The purpose-and-generation map — what each person-facing text is for, and which workflow
  produces it (D11–D16 in one view):**
  - `.opencode/auto/brief.md` — **purpose: the project's constants** (the goal, the
    reference/source location, the target, the constraints every round must respect; read by
    every planning session of every round). Generator: the survey phase's closing task proposes,
    the person's clarification approves, the driver installs (D15); seeded by the person's
    optional one-liner (`init --brief`, D11); drafted by the charter discussion for greenfield
    (D13); `amend --brief` is the manual escape hatch.
  - the planning input (`plan -p` / `--file`) — **purpose: this planning step's ask** (what
    these tasks should accomplish now; ephemeral, one step). Generator: the person, shaped by
    D12's scaffold; after a forked survey, the clarification answers double as it.
  - `docs/R-NN/P01-survey/survey.md` — **purpose: the generated evidence brief of the
    reference** (the sized map and the recorded forks, so the person's scope decisions are made
    from generated evidence in one sitting, and the deep phase plans against a clarified
    scope). Generator: the survey pipeline (D14.5) — the planning session sizes and shapes, the
    task sessions inventory, the closing task writes; the person clarifies, never writes.
  - `docs/R-NN/round.md` — **purpose: this round's goal, acceptance criteria and close
    record.** Generator: the person's hand (F6's notice points at it).
  - `docs/R-NN/report-for-user.md` — **purpose: the round's account to the person** (what
    happened, what needs their attention — including the provisionally-defaulted planning
    questions awaiting their considered answer, D16). Generator: the final phase's wrap-up task
    (D2/D3).

## §4 Smaller findings, optional fixes

- **F6 fix (P2):** when `plan` establishes a round while a human attends, log one notice line if
  `round.md` is still the stub ("the round brief is unfilled; the first phase plans without it").
- Positive: the 0080 machinery (prompt-audit verdicts, guarantees rendering) behaved exactly as
  designed in this run — both planning steps were judged, the precedence block rendered, no assert
  tripped.

## §5 Explicitly not

- No new constitutional config key — the report is unconditional core behavior, not `wrapup`'s
  sibling; exit codes unchanged (a missing report blocks through the existing round-close exit 2).
- No driver-authored report and no report content parsed by the driver beyond existence/shape —
  the report is planner-planned, session-written, human-read; the driver never ticks, parses or
  rewrites it.
- No generalization of the default intent pack into a cleanroom — derivation-axis semantics stay
  in the bundle family (0080 §6); the core only stops assuming migration.
- No `greenfield` intent bundle in this document — a bundle variant with no spec-read phase and
  its own scaffold/mode text is the natural follow-up at the no-reference end of 0080 §6's axis,
  decided separately once the charter prompt has seen use.
- The default pipeline stays `admtvk` — the survey phase ships with the re-work bundles only; the
  letterless default path adopting it is a separate decision after the bundles prove it.
- The survey artifact is `survey.md`, not `brief.md` — "brief" is already three senses in this
  system (the project brief, the round brief, the planning input's role); the survey is the
  person-facing brief *of the reference*, and gets its own name.
- The attended question wait retires from plan routes only (D16) — execution phases keep it, and
  permission problems stay askable in both.
- The question re-ask ban is not lifted — only the D10 carve-out is added.

## §6 Test surface

- `test/prompt-phase.test.ts` / `test/prompt-template.test.ts`: goldens for the `finalPhase`
  branch (present on the last phase, absent otherwise) and every D7 retitle.
- `test/round-close.test.ts` (or its home): missing/empty/unterminated report → blocking problem
  naming the path.
- The 0080 §7 bundle-family tests extended for the D8/D9 cleanroom wording.
- `test/prompt-phase.test.ts`: the goldens for the no-brief notice and the `^brief` fallback
  branch, both naming `init --brief`/`amend --brief` (D11.3), and the no-input scaffold pointer
  (D12.3); the shell's init/amend `--brief`/`--brief-file` flag handling — text written verbatim,
  nothing written when omitted, amend's revision committing (D11.1–2).
- The intent loader's section tests extended for `## planning-input`, and the
  `planningInputScaffold` reader's fallback (active pack wins, default pack serves; D12.1); the
  shell's plan block prints the scaffold and exits 0 (D12.2).
- `test/manual-prompts-ratchet.test.ts` extended for `prompts/charter.md`'s cross-references
  (D13); otherwise untouched — no driver protocol literal changes.
- The `human` gate (D14.3): `PHASE_GATES` validation and custom-phase `Gate:` parsing accept it;
  the check is conditional — zero `Fork:` lines in survey.md passes through, at least one holds
  the phase open (exit 2, the awaiting-person message) until `Clarified: yes` releases it (and
  installs the approved `## Project brief` section verbatim, D15.2; the default path installs
  through `amend --brief-file`, D15.4); `planPrelude`/`status` report the awaiting state.
- The 0080 §7 bundle-family tests extended for the leading survey phase: the phase lists, the
  survey plan duties rendering per bundle, and the D12 scaffold's scope-posture deferral note.
- Doc sync in the same change (§7 A8): the shell's retired-flag notices and amend's `-p`
  refusal text, the README's brief/reset/fix rows, AGENTS.md's brief invariant and navigation
  lines, `roles.ts`'s new entries (A3), `fix`'s write-stub rule, `PROTECTED_FILES` (A4).
- The plan-route question-rule goldens (D16): the phase-plan constraint carries the
  default-and-record rule instead of the attended wait; the report charter's questions section;
  the packs' `### precedence` wording sync.

## §7 Conflict audit (the design corpus and the implementation, re-examined)

Checked against AGENTS.md's invariants and plans/0047 (unit model), 0049 G7/G8 (phase and round
gates), 0052 (the brief and the config layer), 0053 (plan's routes and input), 0058, 0059,
0061 C4/C6, 0078 (the manual suite), 0079 (bundles and phase vocabulary), 0080 (guarantees and
the family), plus the implementation surfaces they name.

**Holds without change (verified in code):**
- Pack subsection keys are the first token after `###` (`intent/load.ts` `packSubsection`) —
  D7's `### m migration implementation` → `### m implementation` rename keeps key `m`; no
  lookup breaks.
- Unknown `##` sections load strictly (`load.ts` rejects with the heading list) — D12's
  `## planning-input` registers exactly the way `## guarantees` did (`INTENT_SECTIONS` +
  `SECTION_HEADINGS`); packs without it load unchanged, and the fallback reader is scaffold-side
  only.
- The manual suite (`prompts/`, 0078) quotes none of the strings D7 retitles and never mentions
  kb.md — the ratchet is isolated from D7 except the planned charter.md addition (D13).
- The question repeat-block is mechanical only over proxy-answered questions
  (`engine/concerns/questions.ts`, `sameIssue` over `autoAnswered`); D10's carve-out is prompt
  text plus the answer relay, and an ambiguity-only follow-up is not a `sameIssue` repeat — no
  detector conflict.
- Exit codes: D4's missing-report block and D14's hold both land on exit 2 ("blocked ... for
  human attention"), the family of the existing round-close refusals and the acceptance wait.
- Driver-exclusive writes: D15's install and D4's self-heal are driver actions at defined
  transitions; the session-written artifacts (report, survey) are docs/ artifacts like verdict.md
  — unified-commit, P1-clean by role.
- The `subtask: off` flip (landed 2026-10-05) vs 0080 §6's on-demand prose: 0080 is landed
  history ("never maintained to track later changes"); the flip lives in the manifests and the
  test ratchet. Consistent with the corpus rule.
- `finalPhase` is derivable where the phase-plan facts are assembled (the planning step holds
  the round's phase list) — no new state anywhere in D2/D14; the gates read files only, keeping
  routing a pure function of the files (round-close.ts's own rule).

**Conflicts found, amendments folded into the decisions above:**
- **A1 — the k-final pipeline (D2/D6).** `admtvk`'s last phase is knowledge, which lays out no
  tasks (`hasTasks: false`) — a "final task" cannot be planned there. Amendment: the duty lands
  on the last task-bearing phase; when the round ends in k, the knowledge side-channel session
  writes the report as its second artifact (D6b).
- **A2 — legacy and planner-skipped rounds vs the round-close check (D4).** `previousRoundClose`
  re-checks round N-1 when opening round N; a final phase planned before the duty landed (the
  record's own R-01) or a planner that skipped the task would deadlock the gate. Amendment: the
  final phase completing without the report self-heals through one appended report task (0079
  §4's append pattern), bounded once.
- **A3 — the report's placement and role (D2/D6a).** The doc-layout rule anchors task documents
  to docs/T-NNN/; a round-level artifact written by a task needs the verdict.md treatment — a
  process role in roles.ts and an explicit placement exception in the duty text.
- **A4 — brief.md is not in the protect list today (D15).** `PROTECTED_FILES` is opencode.json +
  config.json (plus AGENTS.md, models.json); brief.md is guarded by prompt contract alone. Once
  the driver installs it, it joins the list (D6c).
- **A5 — init's stateless overwrite vs the generated brief (D11.1).** Re-init without `--brief`
  must not delete a brief the analysis produced: replacement only while it equals the verbatim
  seed.
- **A6 — the hold's control point and the missing-file case (D14.3).** Gates hold the *phase*
  open (acceptance's `Accepted:` waits before done.md), not "the round"; and zero-fork
  pass-through requires survey.md to exist — a missing survey is a gate problem, never a silent
  pass.
- **A7 — bundle changes do not propagate (D8/D9/D14 vs 0079's no-drift-copy).** Initialized
  targets keep their materialized surfaces and stamped phases list; the survey-leading list
  applies to new materializations and, in an existing target, from the next round (D14.6) —
  mid-round phase-index edits trip 0053 D34's drift rule.
- **A8 — retirement notices turn false (D7/D11/D15).** The shell's retired-flag notices
  ("init no longer writes the project brief: edit .opencode/auto/brief.md (the stub is there)"),
  amend's `-p` refusal ("the brief is not config — edit BRIEF_FILE directly"), the README's
  brief/reset/fix rows and AGENTS.md's brief invariant all describe the superseded stub model —
  the implementing change must sweep them together (§6's doc-sync line).
- **A9 — D16's supersessions (added with D16, after the audit pass).** The plan-route question
  invariant (AGENTS.md: plan's sessions never proxy-answer, a non-permission question waits for
  the human with no timeout — `Opts.humanQuestions` wiring at the render callers) and the packs'
  `### precedence` "or as a question when the call is the person's" wording both describe the
  real-time ask D16 retires from plan routes; the same-change sweep as A8 covers them. Execution
  phases and permission asks are untouched, so the questions concern and the ask catalog keep
  their current consumers.

Net: no decision is withdrawn; D6 is filled (it also repairs a numbering gap), and D2, D4, D11,
D14 are amended as above; D16 (added after the audit) supersedes the plan-question invariant
under A9. The design now states its own supersessions (0052 D9's stub model, 0053 D34's drift
boundary respected) and carries its transition rules for the one open target.

# The design-principles draft — 0110 stage 2 (DRAFT, awaiting the maintainer's rulings)

- date: 2026-10-21
- input: `plans/.0110-work/batch-01..11.md` + `batch-carriers.md` (the stage-1 combing; 108 documents, AGENTS.md, docs/structure.md, docs/glossary.md, a 20-file src-header sample)
- status: **DRAFT — presented for review, not approved.** Nothing is re-keyed until the journal carries the approval line (D10's person gate).

Notes for the reviewer:

- **Numbering.** P1 keeps its established name and identity ("process documents are not design dependencies"). The `P-1`/`P-2` labels inside middle-era documents (0046, 0049, 0070) are *person-ruling* locators within those documents, unrelated to this constitution numbering; the final glossary row will say so.
- **Count.** Twenty principles. The eighteen seeds became fifteen principles (two seed-pairs merged, one seed split across two), and the combing surfaced five the seeds did not name: derived-state discipline (P6), grammars-never-content (P7), declared concurrency (P17), the record outlives the tool (P18), in-flight work never destroyed (P20). All five are heavily attested in the corpus (each has three or more independent first-class rulings); none is speculative.
- Statements are the synthesis's own compression; quoted material inside derivations and rationale is the corpus's own phrasing, cited. Where a statement coins a formulation the corpus never states in one sentence, it is flagged in §Questions.

---

## P1 — Process documents are not design dependencies: the deliverable stands alone

**Statement.** The shipped artifact — exactly what a nested destination repository's git manages — must stand alone: every reference from it to the process side (a process-document path, a bare task id, a path leading outside its own root) is a defect, recorded while rounds run and enforced at the person's release moment.

**Rationale.** The tool's process documents exist to steer long-range work to its goal; they are scaffolding that will be deleted. A deliverable that needs them to build, test or be readable is coupled to its own construction site. From the first statement: "The target code has to stand alone once the process documents are gone" (0036 §4.1).

**Derivations** (the five clause-families, each with code home and first ruling):
- **Scope / structural definition** — the deliverable is what a nested repo's git manages; everything else in the working directory (test tooling, `prompts/`, `tmp/`) is process workspace, never reference-scanned; a project with no nested repo has no P1 surface at all. Homes: `src/document/process-refs.ts` (the nested gate), `src/document/roles.ts` (`p1Scope`), `src/git.ts` (`nestedRepoPrefixes`). First ruled 0103 (destination-only); completed 0108 (the maintainer's general model).
- **Timing** — during the working rounds every finding family is *recorded* (one aggregate count), never blocking; the release posture alone itemizes and enforces. Homes: `process-refs.ts` (`deferredCount`), `src/release.ts`. First ruled 0103's addendum ("only when we are ready to release the destination must such references be removed"); unified over all three families by 0103's addendum two.
- **Remedy** — restatement, never bare deletion: the fix rewrites the true information the reference implied, read from what it pointed at, written self-contained in the destination's own terms, then removes the pointer; "deleting the id or path without carrying its information across is not a fix (never delete the record the id anchored)". Homes: the release gate's wording, `src/driver-helper.ts`'s containment channel. First ruled 0106; sharpened 0108 D8.2.
- **Finding families** — process-document paths (`docs/T-*`, `docs/R-*`, `.auto/`), bare task ids, out-of-root paths; AUTO-\* marker lines are legal self-contained content, deliberately not demanded away. Home: `process-refs.ts`. First ruled 0045 D12 / 0036 §11 Q7; the family set completed by 0103 + addendum two.
- **Presentation** — rounds render one aggregate count line (the close-out ⚠ and the round-close warning); the release gate's itemized output is the fix list. Homes: `src/round-close.ts`, `src/execute.ts`, `src/work-order.ts`. First ruled 0109 D6.

**Provenance.** Stated exactly once, 0036 §4.1 (2026-09-21), adopted by the now-absent root plan (reconstructable through 0045's citation); then re-derived five times in three days (0103, 0103 addendum, 0106, 0108, 0103 addendum two, 0109) — the accretion pattern this initiative exists to end.

**Known tensions.** The manual suite keeps the stricter line — "no release gate stands behind an agent-driven run", so its verification child enforces what the driver's rounds defer (0103). Recording trades audit verbosity against velocity, resolved by P9 (counts). The enforcement delay trades against fail-early (P12): the ruling is explicit that restatement churn during rounds "would tax the migration's velocity for a property only the shipped state needs" (0103 D2).

## P2 — The person brackets every boundary; the person's decisions are never taken or consumed silently

**Statement.** Every boundary of consequence — project start, phase and round closes, round opens, acceptance, release — is a person's act. The pipeline proposes, defaults, records and clamps, but a decision that belongs to the person is surfaced for them and never consumed as closed; every automatic escalation is bounded, and the terminal of every bounded path is the person.

**Rationale.** Autonomy is bought for the mechanical span only. "Human attention does not scale with `--max-agents`" (0036); "real time is the wrong medium for consequential questions — an answer given before the implications are understood carries no guiding value" (0081 F5/D16); human intervention "is a halt event rather than a task" (0005).

**Derivations.**
- The boundary stop and the single advance command (`transfer`, one advance per invocation; `run` stops at the current phase's clean end) — `src/transfer.ts`, `src/loop-phase.ts`; first ruled 0101 ("the person brackets every boundary, the documents decide, the driver applies").
- Human gates: the survey's `Clarified: yes`, the acceptance `Accepted: yes` ("A draft that carries an `Accepted:` line fails the check, because an AI must not sign"), the blockage `Choice:` with ratification semantics ("the marked text becomes the person's words") — `src/phases.ts`, `src/blockage*.ts`; 0081 D14, 0049 G7, 0082 D6.
- Acceptance gates never auto-repair; a FAIL verdict stops the run for a person to accept with `close` or rework; mode choice is a human judgment ("the program does not make it for them") — 0079 §4, 0044 D9, 0020 §K-5.
- AUTO-RESOLVE defaults are recorded and charter-clamped, never consumed as closed ("a decision is never closed in real time — *and the pipeline never consumes it as closed*") — `src/charter-clamp.ts`, `src/resolve.ts`; 0082 D12.
- The proxy's mandate bound: "the person's instruction is the only scope… every stop a command reaches is a report point, never a runway"; marks over recorded decisions stay delegable, authorship does not — `src/driver-helper.ts`; 0107.
- Bounded escalation, human terminal: fix rounds → `--repair` → the human (0083 D5); two consecutive reblocks suspend diagnosis (0082 D8); consent is the budget — "every remediation needs a fresh mark; there is no pre-authorized budget".
- The person's words ride verbatim and are never rewritten: the planning input quoted not paraphrased (0095 D5), "the driver never scores, rewrites or refuses an input" (0081 D12), "Rewrite it, or amend the intent — the driver never rewrites your words" (0082 D2).
- Person-input surfaces teach their own shape instead of assuming a reference exists (the planning-input scaffold, the ASSIST_RULE enumerate-ask-record discipline, the survey fork grammar) — 0081's headline move, 0084 D1.

**Provenance.** 0101's ruling (2026-10-17: a formulation dispatched against an untouched round-brief stub); the lineage runs through 0049's human-gate convergence, 0044 D9 and 0082's consent economics.

**Known tensions.** Trades unattended velocity for review — `run --boundary flow` is the declared continuous escape, "a run-side width, never a switch". The roadmap governs establishment but the config stays constitutional ("the driver never amends it", 0084 D6, superseded only in that resolution-at-establishment writes nothing — 0101 D5). Authorship vs delegation is a deliberate line (0107 D2).

## P3 — Completion is never judged by agent self-report

**Statement.** A unit is done only when its artifacts are on disk and committed, or when a person closed it; work is checked by planned, independent verification judging the work itself; flow and recovery advance on driver-persisted evidence, never on a session's narrative.

**Rationale.** Sessions narrate success. The founding pivot retired "the AI self-maintains PLAN.md status" (0007); the T-068 silent-session incident showed a subtask ending with zero artifacts after reading a prior task's completion narrative (0026); "The wrap-up session narrates; it does not verify" (0083).

**Derivations.**
- The two-state invariant and the driver's exclusive renames/ticks; the index is order and membership, files win — `src/document/state.ts`, `src/tasks.ts`; 0047 U2/U3.
- Shape checks are deterministic only: existence, non-triviality, last-line terminator, declared anchors — "`eof` only proves 'finished writing' (mechanically decidable); quality belongs to verify/review" — `src/doccheck.ts`, `src/document/spec.ts`; 0026 D5/D6, 0034.
- The verdict protocol: `Result: PASS|FAIL` driver-parsed from the report; the wrap-up as a **fresh** verification session "judging every `## Acceptance` criterion by inspection of the work, never from the work sessions' claims"; a FAIL never clears anything — "only a gate or artifact re-earned does" — `src/wrapup.ts`; 0044 D9, 0083.
- Lane and regression verdicts parsed from log tails and receipts, never session claims ("receipts are the truth, the record is the liveness pointer") — `src/script.ts`, `src/regression.ts`; 0096, 0098.
- Flow control keys on driver-persisted records: "Flow control must not be based on AI-generated files… only state the driver actually persists (and clears at close-out) can serve as the basis for advancing the flow" — `src/resume.ts`; 0018.
- Zero-persist natural ends re-prompt once, then block for a human (the designed exit) — 0026 D2.

**Provenance.** 0007's phase-2 pivot (the founding retirement of self-maintained status); restated at 0044 §3 and 0064 §1 as a differentiator.

**Known tensions.** Fresh-session verification costs a session per unit and re-buys no context — deliberate ("re-buying a ten-thousand-line session's context defeats it", 0083). The mechanical half can never judge quality — that division is P7.

## P4 — Committing is the completion condition

**Statement.** Work exists when it is committed: the driver holds the commit right exclusively, a unit completes only through its unified commit, and git history is the audit trail and the rollback anchor.

**Rationale.** Without an enforced git boundary, completion has no durable definition and rollback has no anchor. "Done ⟺ persisted and committed… unified-commit failure → block and halt (exit code 2), pending manual attention, no longer 'warn without blocking'" (0021 §1.1).

**Derivations.**
- The unified commit: after any session the driver recursively commits (nested repos first), subjects and `Auto-Stage` trailers machine-addressable; AI sessions never run commit-type commands — `src/git.ts`; 0021, 0029.
- The SHA baseline and close-out purity: every commit in `baseline..HEAD` carries the driver trailer; multiple driver commits legal, empty commits forbidden — `src/git.ts` (`unitViolations`, `beginUnit`); 0021 §1.3/§6.
- Clean worktree at unit start and run start (driver-state leftovers self-heal; other dirt blocks for a human); foreign commits are never rolled back — "the authority over git state belongs to a human"; 0021 D5, 0022.
- `--commit false` retired entirely (tombstoned); the commit side idles only under dryrun and non-git test doubles — 0021 D7, 0061 R13.
- The person's completion paths: `close` (the `Closed:` field, `git revert` the undo) and `land` (squash default) — 0052 D17, 0074.
- Session ends are commit boundaries in the manual twin ("the boundary a session's end makes should be a commit") — shares at handovers, workers still never commit — 0087.
- The person must not hand-commit inside a unit's range (it breaks the SHA-baseline audit) — 0076.

**Provenance.** 0021 (2026-09-14), generalizing the prior-knowledge "persisted and committed" protocol into the universal check.

**Known tensions.** The branch-isolation trade-off is stated, not hidden: after `land` the deliverable holds one curated commit while the full per-unit trail remains in the driven root's git (0074) — which is P18's division of labor. Init demands a committable git identity and bootstraps git rather than silently disabling the condition (0073).

## P5 — Every kind of state has exactly one home and exactly one writer

**Statement.** Content lives in unit documents, runtime state in `.auto/`, the constitution in `config.json`; each state file has exactly one writer — the driver for progress, index and protocol state; no mirrors, no second sources of truth.

**Rationale.** Dual homes drift and dual writers race. The CURRENT.md mirror was "a pure mirror of committed documents… Nothing on the resume path depends on it" (0054); a generated PLAN.md would be "a second source of truth, and every rewrite enters commits and the clean gate" (0047 §8); session-maintained AGENTS.md "produced unversioned state that the completion condition and the rollback could not see" (0054).

**Derivations.**
- One classifier, one policy table — "classifies any target-relative path by shape only (never content or existence)" — `src/document/roles.ts`; 0045 D1.
- Runtime state is not a document (`in_progress`, attempts, fork base live in `.auto/units.json`); the index is order and membership only — 0047 U3/U4.
- The mirrors retired: CURRENT.md deleted (0054 D3), the AGENTS.md round snapshot retired, AGENTS.md holds only the driver's block, read-only during runs (0054 D1/D2).
- The brief is driver-written state through named channels only (seed, survey install, `fix`'s move) — 0081 D6c.
- The config layer is constitutional: fixed by init, revised per-key by amend, repaired by rule by fix, read-only during runs; init and reset are exact inverses — 0004, 0052.
- One lock per directory (`.auto/run.lock`): one driver process per directory — 0053 D1–D3.

**Provenance.** 0047's unit-layout rulings and 0054's retirement assessment (the two-state work).

**Known tensions.** The person revises the brief and config only through the commands, never by hand mid-run — the trade P2 sanctions. Documents are readable by all, writable by one; the verify-era write exception was reverted as overreach (0009 §H, judge-session authorization).

## P6 — State is derived where possible; every step is idempotent, and recovery is re-derivation

**Statement.** Prefer state derived from durable evidence (files, git, directory shape) over newly persisted state; what persists must be minimal and idempotent; every recovery re-derives from disk rather than trusting memory or self-report, and human-facing surfaces render from live state rather than frozen copies.

**Rationale.** Persisted state rots and mirrors go stale: "derived, with zero new rot-prone state" (0006); "A hand-written copy drifts the moment the next advance lands, and nothing flags the drift" (0105).

**Derivations.**
- Routing as a pure function of the files: `routePhase` reads only the phase directories and indexes; round derivation from `docs/R-NN` directories; no state is written at the gates — 0006, 0049 G8.
- Idempotent construction and steps: `establishRound`, the formulation todo's rewrite-on-diff, append's snapshot-reset-collect — 0006, 0095 D1, 0053 D24/D25.
- `/exit` is a scheduled stop at an existing safe boundary, "fully isomorphic to the recovery path of any real crash/kill interruption, introducing no new recovery mechanism" — `src/exit.ts`; 0014.
- Hibernation checks only "am I in-window right now", never predicting the next unit — 0027 D5.
- Strict resume's fidelity bar: uncertainty → no reuse, roll back to the unit baseline — 0022.
- The person-proxy brief renders from the same state derivation the stops use — "it can never be stale and never misname the role" — `src/driver-helper.ts`; 0105.
- Recovery keys on driver-persisted records (openStep precedence over file-derived routing), and progress records are claimed at dispatch and restored on failure — 0018.

**Provenance.** 0006's phase-state ruling; 0018's recovery-precedence incident (the unclosed 196.8k planning session silently skipped).

**Known tensions.** Some state must persist (units.json, windows.json, stats); the rule is minimality and single-purpose reading ("read it for two purposes only… never for disabling a model", 0057 §8), and persisted state never becomes a second source of truth (P5). Re-derivation costs recomputation at every boundary — paid gladly for crash-isomorphism.

## P7 — The driver judges grammars it defines, never the meaning of content

**Statement.** The driver may check and write only mechanical grammars — paths, markers, trailers, index lines, field blocks, and the agent event and tool-call streams; content quality is judged by planned acceptance work, sessions and people, never by driver-side heuristics.

**Rationale.** "A driver-side scan that judges content re-implements acceptance work in the wrong layer, with heuristics instead of a model" (0060 §3). The precise restatement: "The driver may judge and write only grammars it defines… It never judges or rewrites the meaning of prose" (0061 R15).

**Derivations.**
- The grammar criterion itself, replacing 0060 §3 line 3 — 0061 R15.
- refcheck and `check` retired as content policing; "keeping references valid is each session's own work, not a driver check" — 0061 R1/A3–A5.
- The standardization boundary: the driver's protocol markers constrain exactly the index/state files it parses and the handoff documents; "Everything else a session writes under `docs/T-NNN/` is free content… no schema, no required headings" — `src/document/roles.ts`; 0045 §3.
- Gates check grammar only; depth is the guidance's and the person's bar — "a machine check cannot see thoroughness, and pretending to would cheapen it" — 0084 D4; the round-close `## Close` listing "checks presence, not content" — `src/round-close.ts`; 0049 G8.
- Intelligence recorded, not ambient: "plan writes the decision as a document field; the driver executes it mechanically" (the `Decompose:` field) — `src/runner.ts`; 0075.
- The tier belongs to the work, the fleet to the operator — the conceptual seam that keeps capability judgment out of content judgment — 0055 §3.
- The stuck detector kept as tool-call-stream grammar, and the classifier advisory-only — "it never lowers a class, never judges completion" — 0061 R15, 0055 C6.

**Provenance.** 0060 §3 (the operator's ruling, 2026-09-27), restated as the grammar criterion by 0061 R15.

**Known tensions.** None that bend it: P1's scan reads paths and ids — grammars. The manual suite and acceptance sessions carry the judgment half. The positioning fence "not a content judge" is this principle's strategic face (0064 §4).

## P8 — A check's enforcement moment is deliberate: detection records; the person's moments enforce

**Statement.** A mechanical finding names its own moment: most checks record and surface (counts, warnings, findings), blocking is reserved for the stop's own work and the person's moments, and every surfaced line teaches the remedy it wants.

**Rationale.** Blocking on everything taxes velocity for properties only later moments need (0103 D2); blocking on nothing hides drift (0067's not-chartered header). "✗ is this stop's work, ⚠ is a record — each names its own moment" (0106 D3).

**Derivations.**
- Provenance detection everywhere, none of it a gate: "a stale pack still loads and still runs — staleness is a visibility problem, not a validity problem"; propagation is one explicit confirmed command — `src/provenance.ts`, `src/sync.ts`; 0100 D3/D6.
- Containment recorded during rounds, enforced at release — P1's timing clause; 0103 D2/D3.
- The ✗/⚠ reading rule and the remedy channels riding the rendered surfaces ("the gates check outcomes, the surfaces teach remedies") — `src/round-close.ts`, `src/driver-helper.ts`; 0106.
- The split between fail-closed verification of the person's charter (the plan verifier: one retry then block, exit 2) and loudly-degrading enhancement (the synthesis: audit lines, FALLBACK, the deterministic floor) — `src/prompt-verify.ts` vs `src/formulate-synthesis.ts`; 0080 vs 0097 D4.
- The manual suite's stricter line: no release gate stands behind an agent-driven run — 0103.

**Provenance.** 0100 D6 (detection-is-not-a-gate, ruled when runtime layering was rejected) and 0103's record-then-enforce; the 0106 field round taught the remedy-teaching half.

**Known tensions.** Trades against fail-closed (P12): the plan verifier and the guarantees render gate block precisely because a person's charter is being violated *now*. The distinction is whether the finding's moment has come — never whether the check is cheap.

## P9 — Counts, not lists, on human-facing surfaces

**Statement.** Surfaces a person reads carry aggregate counts; enumerations remain only where the list is itself the work — the release gate's fix list and a stop's own blocking problems.

**Rationale.** "The per-item T-NNN reference listings are too verbose and unreadable, only an aggregate total count is needed" (the maintainer, 0109).

**Derivations.**
- `deferredCount` and the one-⚠ containment lines at close-out and round close — `src/document/process-refs.ts`, `src/round-close.ts`, `src/execute.ts`; 0109 D6.
- Standing-decisions counts (`resolvesOf`/`clampedItemsOf`, "never lists") in the person-proxy brief — `src/driver-helper.ts`; 0109 D5.
- The ⚑ proxy-answer summaries at task/phase/round ends — `src/conclusion.ts`; 0081 D16 (re-keyed 0109 D5).
- AUTO-DECISION collapsed into counts at phase/round level — 0020 §H.
- The two deliberate enumerations pinned: the release gate itemizes ("its output is the fix list a person's agent works from — a count there would leave nothing to act on") and blocking ✗ problems stay itemized ("they are the stop's own work") — 0109 D6.

**Provenance.** 0109 (the maintainer's review, 2026-10-20).

**Known tensions.** Counts hide actionable detail — which is exactly why the two enumerations survive where the list is the work.

## P10 — The byte-identical floor

**Statement.** Every opt-in mechanism degrades to the unchanged baseline: unset switches, absent declarations, missing capabilities and disabled machinery leave behavior byte-identical to the serial floor; only ruled defect fixes change every run.

**Rationale.** An existing project's behavior must not change under a feature it never asked for — the freeze-period invariant (0036 D17) that every later opt-in inherited. "`--parallel none` must be byte-identical to today's behaviour."

**Derivations.**
- The switch discipline: experiment switches read the environment only, persist nothing, unset = byte-for-byte status quo — `src/switches.ts`; 0003 §9.8, 0017 F.
- Kill switches remove machinery, never checks: `OPENCODE_AUTO_PLAN_VERIFY` (0080), `OPENCODE_AUTO_SYNTHESIS` (0097 D6), `OPENCODE_AUTO_REGRESSION` (0098 D8), `OPENCODE_AUTO_DOC_LANES` (0099), `OPENCODE_AUTO_PARK` (0096 D7).
- Declaration-as-opt-in floors: a pack without `## guarantees` is the zero-intent floor (0080); without regression rows, byte-identical (0098); without test-lanes, the serial channel unchanged (0096); the unnamed manual run keeps the serial loop (0104 D1).
- No registry, no change (0055 C2); every run still has a registry — the implicit synthesis (0061 F2).
- Lanes floor at one session for any project (0068 D10); doc lanes' silent serial degrade (0099 D2).
- Capability degradation lands on existing fallbacks ("every missing flag lands on an existing fallback"; the one exception refuses at start rather than failing mid-unit) — `src/capability.ts`; 0040 D1/D3.
- Manual-suite twins: "without the phrase the loop is exactly as written today" (0104 D1); install-prompts resyncs byte-identically, extras never deleted (0093 D2).

**Provenance.** 0036 D17; the switch layer's founding discipline (0003).

**Known tensions.** "C2's 'byte-identical without a registry' was written for features" — defects fix behavior for every run (0057 §11.1: "They are defects, not features"). A floor must never be allowed to mask a defect; the dead-protocol-field cleanup (0069) is the audit that prunes floors whose reason died.

## P11 — One home per mechanism

**Statement.** Every mechanism, rule and vocabulary has exactly one owning home — module, layer or carrier; duplicates are consolidated, and the consolidation is held by ratchets that only shrink.

**Rationale.** Duplication is drift waiting to happen: "Two listings of one rule table would drift" (0052 Q8); "The disease is the manual sync, not the carrier count" (0072).

**Derivations.**
- The consolidation: one spine with declared arbitration order, concerns each owning one state slice; `chain-transitions.ts` as "the one home of every SessionChain field write"; `RunServices` as the one constructed holder — 0061 R7/R11.
- The ratchet family: `test/import-direction.test.ts` (SUBDOMAIN_EDGES, SERVICE_ENTRIES — allowlists that may only shrink), `test/chain-writes.test.ts` (the write ratchet reaching zero), the constitution ratchet (0072), the manual-suite ratchet (0078/0093).
- One strict loader ("one strict loader to keep honest", 0053); one classification point (0045 D1); the single routing path (0061 F2/C4).
- One owning layer per rule with the audience tag deciding it; `agents-block.ts` constants the single source ("one source two renderings") — 0072.
- Single-source data: docpaths as the single path-construction point (0034 D10); the models registry the single routing authority.
- The 0102 cleanup as the standing reflex (dedup batches, shared helpers, the git split with its type-counted graph).

**Provenance.** 0061 (the consolidation program); 0024's pure-relocation discipline as the earlier expression.

**Known tensions.** Compatibility re-exports and seams cost indirection (0024 D2, deliberately temporary); the ratchet tables are themselves maintained state. "No flat file-splitting without entry modules — the unit of modularity is the interface, not the file" (0060 D7).

## P12 — Fail loud; under uncertainty take the conservative direction; degrade visibly

**Statement.** Failures are surfaced, never swallowed into a clean verdict; uncertain readings resolve conservatively (toward dirty, toward not carrying context forward, toward no reuse); degradation renders its fallback; nothing is guessed silently.

**Rationale.** The founding review's diagnosis: risk concentrates in "text-protocol parsing that is too lax, process/timeout boundaries, and git command failures being swallowed into a 'clean' verdict" (0025).

**Derivations.**
- Git command failures distinguished from empty results, "always conservative toward dirty / foreign commits present" (0025 M1); exit-0-with-uncommitted-changes made impossible (M2).
- Strict failure over silent fallback for stored configuration (0004); the registry validates strictly — "a misspelled `aviod` would otherwise silently put a model back into its peak hours" (0055 §4.1); parsed-strictly charter keys ("never silent precedence", 0100 D10).
- Unknown resolves conservatively: usage unknown → "toward the side that neither carries context forward nor ends a session on a guess" (0038 D2); classification uncertain → do not switch (0017 D6); recovery fidelity uncertain → no reuse, roll back (0022); unparsable receipts never cover (0098 D3).
- Catch-alls re-throw unknown shapes — driver programming errors never enter the infinite recovery loop (0025 M6).
- Retired switches warn instead of failing unattended runs (0061 R17); retired-key discards are named with their values (0052 D4).
- Loud degradation: `synthesis:`/`fidelity:`/`FALLBACK` audit lines (0097); the hibernation/tier logging; "never fail silently, never continue silently — degrade loudly with the information a person (or a fix session) needs" (0097 header).

**Provenance.** 0025 (the 2026-09-17 review); 0004's strictness ruling.

**Known tensions.** Strictness is calibrated by whether a wrong value silently changes behavior: config's unknown keys are ignored (forward compatibility) while registry fields are not — the difference is stated, not accidental. Loudness trades against P9's quietness — warnings are counts and one-liners, failures are itemized.

## P13 — Frozen additive-only vocabularies

**Statement.** Protocol literals, event vocabularies, exit codes and document grammars change only by conscious lockstep — parser, templates, markers and pinning tests in one change — grow additively, and retire through tombstones; never by drift, never with silent dual meanings.

**Rationale.** "A flip commit must change the marker literal, the template, and the parser together — otherwise the built-in template itself fails its own guard, or an override carrying the old literal passes while the driver no longer parses it" (0035 D6).

**Derivations.**
- The protocol-string registry and its lockstep procedure (0035; retired with the flip program closed, its procedure now the convention).
- `RunStatusEvent` frozen additive-only; consumers parse defensively — "a line that does not parse is skipped, never an error"; the three event vocabularies pairwise disjoint — 0067 P2a, 0071 §3.
- Exit codes stable across the whole evolution (0029 and every later contract).
- Tombstoned key names never reused with a new meaning (0052 D3); retired flags are usage errors, never silently ignored ("silently ignoring a close attempt would let a person believe a unit was closed when nothing happened", 0053 §10 B4).
- Letters stay human shorthand, ids the durable protocol (0079 §5); charter keys canonicalized before any stamp recorded a letter as canonical (0100 D8/D12).
- A name never renames or removes; the planted-rename ratchet enforces it (0071 §3).

**Provenance.** 0035 (M1.5, the flip program); 0071's consumer contract.

**Known tensions.** Temporary dual-read compatibility was used during the flip and retired deliberately when in-flight risk passed (0035 M3.7) — the principle permits bounded compatibility windows, never silent precedence. The exit-1 findings convention of fix/sync deviates from exit-2 wording deliberately (0102 invariants-4).

## P14 — Dependencies point one way through declared seams

**Statement.** The core does not know shells — never imports a shell package, never imports HTTP; shells inject differences through profiles, registrations and parameters; inside the core, layers point downward through entry modules held by ratchets; agent SDKs are confined to their adapters.

**Rationale.** Injection keeps the core honest and shells cheap: "shell differences are injected exclusively via the `src/shell.ts` profile or parameter passing"; the servicization ruling — "Do not fork or rewrite it; just add a shell package… The core never knows HTTP" (0067).

**Derivations.**
- The shell contract and its branch model (`setShellProfile`, `registerTemplate`, `registerIntentBundle`, `registerAgentAdapter`) — `src/shell.ts`; 0055 C3, docs/shell-contract.md.
- "The core imports no HTTP" as a constitutional assertion in the direction test — 0067 T-098.
- The agent domain self-contained ("`agent/types.ts` imports nothing from src/"); "No driver file imports `@opencode-ai/sdk`" — 0037 D1, 0039.
- The layering ratchets: session-driving strictly layered, lower layers never import upward, testrun never imports the session layer — 0024 §D.2; domains through entry modules with shrink-only allowlists — 0061 R10.
- Extension is registries inside the process, consumers outside it — "no plugin marketplace… no multi-user orchestration" — 0060 §5.8, 0064 T2.
- The core/shell contract's missing enforcement leg recorded as a finding-shaped gap (0069 §5.1) — the direction test is the leg.

**Provenance.** 0024's module split; 0055 §8 and 0067's servicization rulings.

**Known tensions.** The boundary-UX track sanctions named core seams — "the substrate is core; the consumers stay outside" (0071 §2) — the seam is core because two shells share it and only the core's run can write it.

## P15 — Policy is data; renderers assemble; governance text stays pinned in committed state

**Statement.** Prompt copy lives in templates, judgment and quality content in intent packs and bundles; code assembles data and never authors copy; the runtime reads only the surfaces a bundle materializes and never interprets intent; committed governance text never floats with whichever binary passes through.

**Rationale.** Copy in code is unreviewable and un-overridable; floating governance breaks the record. "The runtime never interprets 'intent'… Intent is an init-time packaging and deployment concept for policy, entirely upstream of the mechanism" (0079).

**Derivations.**
- Templates as embedded data (`with { type: "file" }`), renderers only assemble; "to change prompt wording touch only the template files" — 0005, 0029.
- The two-tier marker discipline: tier-1 driver-enforced anchors stay core; tier-2 intent content is marker-free — 0033 D4.
- Intent packs and bundles as the carrier of judgment content; "the key selects; it never composes" — 0031–0034, 0079.
- Provenance stamps and `sync`: detection everywhere, propagation one explicit command; runtime layering rejected — "governance text stays pinned in the repo, never floating with whichever binary passes through… the committed record must keep explaining the rules each phase ran under" — 0100 D6; person-edited files authoritative and never written.
- The mode layer as registered data ("a new mode = one protocol-complete .md file, zero source changes") — 0005/0029.
- The manual suite: no runtime code renders it; the ratchet binds it — 0093 D4.

**Provenance.** The M1.x intent externalization (0031–0034); 0079 and 0100.

**Known tensions.** Person-edited packs freeze the tool's last-written bytes (upgrade convenience vs person ownership — 0100 D2); embedded prompt templates float precisely because they were never committed project state (0100 D6's own line).

## P16 — Tool source carries no environment-specific facts

**Statement.** No real project's paths, layout or special cases enter core or shell code, and no secret value is ever read into anything the tool builds: project facts ride the target's declared surfaces (config, packs, brief, roadmap); secrets ride as references and are never logged.

**Rationale.** Genericity: "Any future change that would need to name a real project inside `auto-core`/`auto` (or any shell's) source is wrong by construction… the need to special-case a known project is the signal that the structural rule is still missing" (0108 D8.1). Hygiene: "The file holds no secret, the driver never reads a key's value into a string it builds" (0055 §4.3).

**Derivations.**
- The structural deliverable definition replacing dm-flash's first-aid exemption — 0108 D8.1, pinned in AGENTS.md.
- Keys and env values as references (`{env:NAME}`/`{file:path}`), literal keys refused, references named in every log; resolved env values go only into the child's environment — `src/models.ts`, `src/keyring.ts`, `src/agent-env.ts`; 0055 §4.3/C4.
- The quota probe lives in a separate process/package precisely because a driver-side HTTP call would need the credential in-process — 0057 §9, 0066.
- The driver's own `OPENCODE_AUTO_*` variables never reach agent processes; adapter spawn hygiene drops inherited identities — 0059 X1, 0041 D10.
- Project-declared surfaces as the only carrier of project facts: `scanExempt`, test-lanes, `lanes.caches`, brief, roadmap — 0059 X2, 0096 D3/D11.

**Provenance.** 0108 D8.1 (from dm-flash's R-01 close); 0055 §4.3 (from the registry design).

**Known tensions.** None recorded; the principle is standing. The escape is always a structural rule or a declared surface, never an exemption in code.

## P17 — Concurrency is declared, not discovered

**Statement.** Parallelism is admitted on declarations (`Depends:`/`Touches:`), bought at the cheapest isolation tier that fits, and bounded by disjoint scopes with one sole writer of shared git state; a wrong declaration surfaces loudly — a landing conflict, a dirty tree, a failing commit — never as corruption or silently unlanded work.

**Rationale.** "The work order is declare → isolate → schedule, not schedule → discover conflicts" (0036). Declarations stay advisory because the failure that matters is discoverable at the boundaries: "two lanes editing different hunks of one function produce a clean textual merge and broken semantics, invisible to every gate" — hence admission by disjointness, not conflict repair (0068 D21).

**Derivations.**
- Declared dependencies with shallow semantics and conservative defaults ("missing `Touches` = touches everything, never disjoint; forgetting the field costs width, never correctness") — `src/document/unit.ts`; 0036 D14, 0046 D3/0047 G3.
- The readiness scheduler pure over declared facts; level-independent admission; `Touches` advisory — a wrong declaration is a landing conflict, never corruption — `src/lanes.ts`; 0068 D5/D21.
- The tier ladder: processes before trees; pay for a second tree only for true concurrent code edits, at the cheapest materialization the filesystem allows — 0096 D9 (the review's ruling demoting worktree-per-lane).
- Doc lanes: the declaration is the safety argument ("disjoint scopes mean no shared mutable path, so isolation is unnecessary rather than merely expensive"); the await chain as the mutex; every shared-state read-modify-write serialized; the parent the sole git writer through the seam decorator — `src/git-ops.ts`, `src/loop-task.ts`; 0099 D3/D4/D8.
- Phases drain before closing; never end a session with a lane in flight; the regression background slot never dirties a start gate — 0068 D20, 0096 D1, 0098 D4.
- The manual twin: `parallel: <n>` waves with the same admission, the serial floor without the phrase — 0104.

**Provenance.** 0036/0046/0068 (the parallelism line); 0096's review ruling and 0099's measured serial waves.

**Known tensions.** Declaration discipline costs the planner honesty ("name real paths and real prerequisites, never restructure the plan to create independent tasks", 0104 D6); isolation costs trees and caches — the tiers exist because both prices are real.

## P18 — The record outlives the tool

**Statement.** The durable state of any run is plain files and git history — documents, indexes, receipts, append-only journals, JSON state — readable and manipulable by any human, agent or script without the driver present; document paths are permanent once landed.

**Rationale.** "The record outlives the tool… This is the deepest moat: not lock-in but its absence — adoption costs little because leaving costs nothing, and audits need no special tooling" (0064 §1).

**Derivations.**
- Permanence: documents under `docs/` never move or get renamed once created; task paths permanent so tasks are never nested under rounds or phases — 0010 R2, 0047 §1.
- Machine-addressable history: per-task commit subjects and `Auto-Task`/`Auto-Stage`/`Auto-Nested` trailers; "git history is the audit trail of AI changes, with rollback granularity = one session" — `src/git.ts`; 0021, 0029.
- Append-only journals as the interchange: `.auto/run-events.jsonl`, `.auto/run-status.jsonl` — consumers parse the typed lines, "never log prose" — 0061 R4, 0067, 0071 §3.
- Deletion is safe only after distillation, and pairs directories with index lines in one commit; "git history retains everything; the audit trail (per-task commits) never leaves" — 0070.
- Human-readable state files over databases (the Temporal-shape choice: "the state store is git+files rather than a database", 0064 §2).
- The daemon writes nothing under any target's `.auto/` — the record stays the driver's alone — 0067 T-098.

**Provenance.** 0010 (stable references); 0064's positioning thesis.

**Known tensions.** The deliverable's history is the person's to curate — `land` squashes by default while the driven root keeps the full trail (0074); P1 already frees the deliverable from the process record entirely. Journals are best-effort by design ("Recording is best-effort… never a run failure", 0071 §3) — the record tolerates truncation at run starts, never corruption of the committed trail.

## P19 — Mechanisms are ruled from measured evidence

**Statement.** A design ruling is grounded in measured field evidence — incidents, censuses, live probes, cost tables — and every claim carries its citation; speculation is not a basis; compensation machinery is re-audited on schedule as agent capabilities improve; platform moves need triggers.

**Rationale.** "Every claim below carries a `file:line` / `doc §` citation or a named census — the evidence rule bound every unit" (0069). The alternative was measured: T-008's 3× cost overrun was "waste, not the price of decomposition" (0059).

**Derivations.**
- Measured rounds as the ruling trigger: dm-glm's 95 full-gate runs / 20.4 h (0098), the serial doc waves (0099), T-008's cost tables (0059 §12).
- Censuses and live re-counting: the AST de-export census (0102), the plans corpus census (0069), "diagnosing live behavior from the worktree source yields wrong conclusions — work from the installed binary" (0015).
- Adapter facts observed, not documented: "Everything below was observed with real `claude -p` runs… not taken from documentation" (0041); verification honesty about what was *not* runnable (0055 S3).
- Independent assessment before big programs (0062 verifying 0061's claims by re-measurement).
- Trigger-gated platform moves: Rust only on 0063 §5's triggers, re-read on schedule; "not a rewrite for taste".
- The compensation audit: "treat capability-driven shrinkage as a scheduled cost audit, not an identity crisis" — quarterly stats reads prune what stopped paying (0064 T1); the counters that make it possible (0069 T-111).
- Falsification criteria stated with the thesis (0064 §6).

**Provenance.** The corpus's own practice, stated as doctrine by 0069's evidence rule and 0064's falsifiability.

**Known tensions.** Some rulings precede complete evidence and carry their open gaps explicitly (0057 S0) — the discipline is honesty about what is measured, not delay; "a pre-emptive rule needs its own evidence" (0057 §11.10).

## P20 — In-flight work is never destroyed

**Statement.** Running work is preserved: transient faults are waited out and recovered with the accumulated context kept, control changes land only at safe boundaries, fallible heuristics advise before they enforce, and probes never pollute the real session.

**Rationale.** "Prime directive: guarantee that a session failure never exits the program — under any quota limit, the program should wait until the quota recovers, then continue" (0015). And the asymmetry that bounds intervention: "however sound, the criteria can still misjudge… and the cost of a shutdown far exceeds one superfluous hint" (0016).

**Derivations.**
- The wait-and-probe loop with disposable probe sessions ("never probe with the interrupted session — pushing probe rounds into the real session pollutes its context") — `src/session.ts`; 0015 correction three.
- The most-valuable-session criterion: always fork a copy; the failed session with content outranks blanks ("the 100k+ of verified output inside it is the round's most valuable asset") — `src/chain-transitions.ts`; 0015's corrections.
- Scheduled waits naming the instant ("weekly limit resets …; sleeping until then", 0057 §6); the silence budget; the escalation order key → model → wait (0055 §7).
- Stuck detection hint-only, capped, never halting — `src/stuck.ts`; 0016.
- Liveness probes on fresh connections (half-open detection); truncation resumed by steer, not restart — 0026 §8; 0026 D3.
- Control at boundaries only: `/exit` deferred to the next safe boundary (0014); hibernate stops at unit ends (0027); windows gate dispatches, never running turns (0055 §4.4); phases drain before closing (0068 D20); run's boundary stop at a clean phase end (0101 D1).
- Executed means done (a pinned script's result persists; recovery never re-runs on suspicion) — 0023 M-D1.

**Provenance.** 0015 (the T-062 postmortem) and 0016; extended by 0057's quota work.

**Known tensions.** Waiting trades latency for survival, and the terminal of every bounded wait is the person (P2): `/exit` and double-Ctrl+C remain inside the waits. Hints can be superfluous — the accepted cost of never killing real work on a heuristic.

---

## How to rule (the derivation discipline — goes into `docs/principles.md`'s closing section at stage 5)

Every future `plans/NNNN` decision block states its derivation:

- `Derives: P-NN` — with the one clause showing how the ruling follows from the principle.
- `Amends: P-NN` — when the ruling genuinely extends the constitution: the principle is restated and its provenance carried forward, in the same change.

A ruling that matches no principle is a red flag to resolve **before** landing: either the constitution is incomplete (fix the set, in the same change) or the ruling is drift (fix the ruling). Answering a boundary question starts from `docs/principles.md`, not from a corpus search. Rulings may derive from more than one principle (name each); a documented tension between two principles is a ruling's material, never an excuse to skip the derivation.

---

## Seeds disposition (the plan's eighteen seeds → this draft)

| seed | landed | note |
|---|---|---|
| P1 stands alone | P1 | the worked example |
| person brackets every boundary | P2 | + the bounded-escalation half of seed 17 |
| completion never agent self-report | P3 | |
| committing is the completion condition | P4 | |
| driver-exclusive state writes | P5 | **merged** with one-home-per-state-kind |
| one home per state kind | P5 | merged (same failure class: dual homes/writers drift) |
| references are references, never literals | P16 | **merged** with no-environment-specific-knowledge |
| no environment-specific knowledge in tool source | P16 | merged (same shape: no environment facts in tool source; different failure classes — flagged in §Questions) |
| detection is not a gate unless it is the person's moment | P8 | |
| counts, not lists | P9 | |
| the byte-identical floor | P10 | |
| one home per mechanism | P11 | |
| fail loud, degrade visibly | P12 | + the conservative-under-uncertainty family the combing surfaced |
| frozen additive-only vocabularies | P13 | |
| the core does not know shells | P14 | generalized to one-way dependencies through declared seams |
| templates are data, provenance pinned | P15 | |
| bounded agency, the human the unbounded backstop | P2 + P20 | split: bounded-escalation-terminal → P2; preserve-in-flight-work → P20 |
| mechanisms ruled from measured field rounds | P19 | |

New from the combing (not seeded): **P6** (derived/idempotent state), **P7** (grammars never content), **P17** (declared concurrency), **P18** (record outlives tool), **P20** (in-flight work preserved). Twenty total — at the plan's target, not under it by hiding material.

## Questions for the maintainer (rulings requested)

1. **The two merges.** (a) driver-exclusive-writes + one-home-per-state-kind → one principle P5; (b) references-never-literals + no-environment-specific-knowledge → one principle P16. Both merges are shape-motivated; the failure classes differ (authority vs location; genericity vs credential hygiene). Keep merged, or split into four?
2. **The count.** Twenty principles, five of them combing-surfaced beyond the seeds (P6, P7, P17, P18, P20). Too many, right-sized, or should any further merge (e.g. P8 into P7; P18 into P4)?
3. **P20's framing.** The draft states it as "in-flight work is never destroyed", unifying fault-resilience (0015/0016/0057) with control-at-boundaries (0014/0027/0055) and hint-before-halt. The seeds had only "bounded agency". Confirm the unification or split it.
4. **Statements coined by the synthesis.** Where a principle's one-sentence statement compresses rulings the corpus never states in one breath (most visibly P5, P6, P8, P15, P17, P18, P20), the maintainer should read the statement as *proposed generalization of their own rulings* — correct any that over- or under-reach.
5. **P7's rank.** The grammars-never-content principle was not among the seeds, yet the corpus attests it as the consolidation's central doctrine (0060 §3, 0061 R15, 0064's first fence). Proposed rank: P7, immediately after the state family — or should it rank higher?

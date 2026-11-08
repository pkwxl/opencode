# Design principles

This is the design constitution of the auto tool family: the ruled set of principles every design decision in `plans/NNNN` derives from, and the frame that governs how the set itself changes. It compresses the plans corpus (0001–0109, baselined `pre`) into one positioning statement, six constitutional principles, thirteen operating principles and two registers — every entry carrying its provenance and code homes, so a reader can check the ruling rather than trust the summary. Concrete requirements (formats, grammars, exit codes, thresholds, security mechanics) are not here: they live with their mechanisms, and the tier test keeps them out. The plans corpus remains the detail record; this document is the ruling surface.

Current as of release v0.3.0. The plans corpus before this initiative is baselined `pre`.

## 0. The positioning statement

Every principle must trace to a clause of this statement; the trace is the tier test below. Each clause is corpus-grounded, not coined.

- **What it is.** A **person-governed driver for long-range software work**. It does not think, judge, or remember as an agent does; it drives replaceable coding-agent sessions through a ruled structure — rounds, phases, task units — inside a target directory the person owns, from stated intent to a shippable deliverable.
- **For whom.** One person (or a handful) governing work too long for any single session — migrations, reworks, cleanroom builds. The corpus's field projects (dm-flash, dm-glm, spi-nor-glm, aster-net, common) are the shape; every major mechanism was ruled from one of their measured rounds.
- **The exchange.** The person supplies intent and the consequential decisions, at brackets the tool designs for them; the driver supplies the mechanical span between brackets — unattended, bounded, recoverable. "Human attention does not scale with `--max-agents`" (0036); autonomy is bought for the mechanical span only.
- **The guarantees — the pillars.** Completion is verifiable, never narrated (P3). The deliverable stands alone (P1). The person's decisions are never taken or consumed silently (P2). The record outlives the tool — plain files and git, no lock-in, no special tooling (P18; 0064 §1: "not lock-in but its absence").
- **The fences — what it is not.** Not a content judge (P7; 0064 §4's first fence). Not unattended automation — every escalation's terminal is the person (P2). Not a platform, marketplace, or multi-user orchestrator (0060 §5.8, 0064 T2). Not project-specific — no target's facts in tool source (P16-genericity; 0108 D8.1).
- **The substrate.** Git and plain files are the only durable state (0064 §2: "the state store is git+files rather than a database"); agents and models are replaceable means — the tier belongs to the work, the fleet to the operator (0055 §3).

**The tier test.** Applied to every candidate: remove it and ask what breaks. A principle is constitutional — Tier I — only if its removal breaks a clause of this statement (a pillar, a fence, or a contract); the tool becomes a different tool. If removal merely degrades how the tool runs without changing what it is, the principle is Tier II — an operating principle, held as a standing trade-off with its choice, chosen default and revisit trigger stated. Mechanical, testable, right-or-wrong-by-inspection rules are concrete requirements; they live with their mechanisms — code headers, `docs/structure.md` rows, INDEX pointers — never in this constitution. A requirement ranks by criticality, not importance-to-positioning: a security requirement is a requirement precisely because it has a right answer, not because it matters less.

```
Positioning (§0 — what/why, pillars, fences, substrate)
  └─ Tier I constitutional principles (identity; versioned amendment)
       └─ Tier II operating principles (standing trade-offs: choice / default / trigger)
            └─ concrete requirements (with their mechanisms: code, structure.md, INDEX)
Trade-off register (open decisions)      Risk register (watched conflicts)
```

## I. Constitutional principles

Six principles: four pillars, one fence, one contract. Removal of any breaks a clause of §0. Amended only through the versioned `Amends:` discipline (see How to rule). Each carries five parts: **Statement** (one general sentence) / **Rationale** (the failure class) / **Derivations** (the rule families it generates today, each with its code home and the plans pointer of the family's first ruling — this is what makes the principle falsifiable) / **Provenance** (first ruling and provoking incident) / **Known tensions** (where it bends, and which principle it trades against).

### P1 — Process documents are not design dependencies: the deliverable stands alone

**Statement.** The shipped artifact — exactly what a nested destination repository's git manages — must stand alone: every reference from it to the process side (a process-document path, a bare task id, a path leading outside its own root) is a defect, recorded while rounds run and enforced at the person's release moment.

**Rationale.** Process documents are scaffolding that steers work to its goal and will be deleted; a deliverable that needs them to build, test or be readable is coupled to its own construction site. "The target code has to stand alone once the process documents are gone" (0036 §4.1).

**Derivations** (the five clause-families — the worked example of this format):
- **Scope / structural definition** — the deliverable is what a nested repo's git manages; everything else in the working directory (test tooling, `prompts/`, `tmp/`) is process workspace, never reference-scanned; no nested repo, no P1 surface. Homes: `src/document/process-refs.ts` (the nested gate), `src/document/roles.ts` (`p1Scope`), `src/git.ts` (`nestedRepoPrefixes`). First ruled 0103 (destination-only); completed 0108 (the structural model).
- **Timing** — during rounds every finding family is *recorded* (one aggregate count), never blocking; the release posture alone itemizes and enforces. Homes: `process-refs.ts` (`deferredCount`), `src/release.ts`. First ruled 0103's addendum; unified over all families by addendum two.
- **Remedy** — restatement, never bare deletion: rewrite the true information the reference implied, self-contained in the destination's own terms, then remove the pointer — "never delete the record the id anchored". Homes: the release gate's wording, `src/driver-helper.ts`'s containment channel. First ruled 0106; sharpened 0108 D8.
- **Finding families** — process-document paths (`docs/T-*`, `docs/R-*`, `.auto/`), bare task ids, out-of-root paths; AUTO-\* marker lines are legal self-contained content, deliberately not demanded away. Home: `process-refs.ts`. First ruled 0045 D12 / 0036 §11 Q7; the family set completed by 0103 + addendum two.
- **Presentation** — rounds render one aggregate count line (the close-out ⚠ and the round-close warning); the release gate's itemized output is the fix list. Homes: `src/round-close.ts`, `src/execute.ts`, `src/work-order.ts`. First ruled 0109 D6.

**Provenance.** Stated exactly once, 0036 §4.1 (2026-09-21); then re-derived six times in three days (0103, 0103 addendum, 0106, 0108, 0103 addendum two, 0109) — the accretion pattern this constitution exists to end.

**Known tensions.** The manual suite keeps the stricter line — its verification child enforces what the driver's rounds defer (0103). Recording trades audit verbosity against velocity, resolved by the counts convention (P9's tombstone). The enforcement delay trades against fail-early (P12): restatement churn during rounds "would tax the migration's velocity for a property only the shipped state needs" (0103 D2).

### P2 — The person brackets every boundary; the person's decisions are never taken or consumed silently

**Statement.** Every boundary of consequence — project start, phase and round closes, round opens, acceptance, release — is a person's act; the pipeline proposes, defaults, records and clamps, but a decision that belongs to the person is surfaced for them and never consumed as closed; every automatic escalation is bounded, and the terminal of every bounded path is the person.

**Rationale.** Autonomy is bought for the mechanical span only. "Human attention does not scale with `--max-agents`" (0036); "real time is the wrong medium for consequential questions" (0081 F5/D16); human intervention "is a halt event rather than a task" (0005).

**Derivations.**
- The boundary stop and the single advance command (`transfer`, one advance per invocation; `run` stops at the current phase's clean end) — `src/transfer.ts`, `src/loop-phase.ts`; first ruled 0101 ("the person brackets every boundary, the documents decide, the driver applies").
- Human gates: the survey's `Clarified: yes`, acceptance's `Accepted: yes` ("an AI must not sign"), the blockage `Choice:` with ratification semantics ("the marked text becomes the person's words") — `src/phases.ts`, the `src/blockage*.ts` family; 0081 D14, 0049 G7, 0082 D6.
- Acceptance gates never auto-repair; a FAIL verdict stops the run for a person to accept with `close` or rework; mode choice is a human judgment ("the program does not make it for them") — 0079 §4, 0044 D9, 0020 §K-5.
- AUTO-RESOLVE defaults are recorded and charter-clamped, never consumed as closed ("a decision is never closed in real time — *and the pipeline never consumes it as closed*") — `src/charter-clamp.ts`, `src/resolve.ts`; 0082 D12.
- The proxy's mandate bound: "the person's instruction is the only scope… every stop a command reaches is a report point, never a runway"; marks over recorded decisions stay delegable, authorship does not — `src/driver-helper.ts`; 0107.
- Bounded escalation, human terminal: fix rounds (progress-gated, never count-capped — blocking only when the gap count stops improving, 0146 amending 0083 D5, 0198 the best-count key) → `--repair` → the human; two consecutive reblocks suspend diagnosis (0082 D8); consent is the budget — "every remediation needs a fresh mark; there is no pre-authorized budget".
- The person's words ride verbatim, never rewritten: the planning input quoted not paraphrased (0095 D5), "the driver never scores, rewrites or refuses an input" (0081 D12), "the driver never rewrites your words" (0082 D2).
- Person-input surfaces teach their own shape instead of assuming a reference exists (the planning-input scaffold, the ASSIST_RULE enumerate-ask-record discipline, the survey fork grammar) — 0081's headline move, 0084 D1.

**Provenance.** 0101's ruling (2026-10-17: a formulation dispatched against an untouched round-brief stub); the lineage runs through 0049's human-gate convergence, 0044 D9 and 0082's consent economics.

**Known tensions.** Trades unattended velocity for review — `run --boundary flow` is the declared continuous escape, "a run-side width, never a switch". The roadmap governs establishment but the config stays constitutional ("the driver never amends it", 0084 D6, superseded only in that resolution-at-establishment writes nothing — 0101 D5). Authorship vs delegation is a deliberate line (0107 D2).

### P3 — Completion is never judged by agent self-report

**Statement.** A unit is done only when its artifacts are on disk and committed, or when a person closed it; work is checked by planned, independent verification judging the work itself; flow and recovery advance on driver-persisted evidence, never on a session's narrative.

**Rationale.** Sessions narrate success. The founding pivot retired "the AI self-maintains PLAN.md status" (0007); the T-068 silent-session incident showed a subtask ending with zero artifacts after reading a prior task's completion narrative (0026); "The wrap-up session narrates; it does not verify" (0083).

**Derivations.**
- The two-state invariant and the driver's exclusive renames/ticks; the index is order and membership, files win — `src/document/state.ts`, `src/tasks.ts`; 0047 U2/U3.
- Shape checks are deterministic only: existence, non-triviality, last-line terminator, declared anchors — "`eof` only proves 'finished writing' (mechanically decidable)" — `src/doccheck.ts`, `src/document/spec.ts`; 0026 D5/D6, 0034.
- The verdict protocol: `Result: PASS|FAIL` driver-parsed from the report; the wrap-up as a **fresh** verification session judging every `## Acceptance` criterion "by inspection of the work, never from the work sessions' claims"; a FAIL never clears anything — "only a gate or artifact re-earned does" — `src/wrapup.ts`; 0044 D9, 0083.
- Lane and regression verdicts parsed from log tails and receipts, never session claims ("receipts are the truth, the record is the liveness pointer") — `src/script.ts`, `src/regression.ts`; 0096, 0098.
- Flow control keys on driver-persisted records: "only state the driver actually persists (and clears at close-out) can serve as the basis for advancing the flow" — `src/resume.ts`; 0018.
- Zero-persist natural ends re-prompt once, then block for a human — 0026 D2.

**Provenance.** 0007's phase-2 pivot (the founding retirement of self-maintained status); restated at 0044 §3 and 0064 §1 as a differentiator.

**Known tensions.** Fresh-session verification costs a session per unit and re-buys no context — deliberate ("re-buying a ten-thousand-line session's context defeats it", 0083). The mechanical half can never judge quality — that division is P7.

### P4 — Committing is the completion condition (contract-grade)

**Statement.** Work exists when it is committed: the driver holds the commit right exclusively, a unit completes only through its unified commit, and git history is the audit trail and the rollback anchor.

**Rationale.** Without an enforced git boundary, completion has no durable definition and rollback has no anchor. "Done ⟺ persisted and committed… unified-commit failure → block and halt (exit code 2), pending manual attention" (0021 §1.1).

**Derivations.**
- The unified commit: after any session the driver recursively commits (nested repos first), subjects and `Auto-Stage` trailers machine-addressable; AI sessions never run commit-type commands — `src/git.ts`; 0021, 0029.
- The SHA baseline and close-out purity: every commit in `baseline..HEAD` carries the driver trailer; multiple driver commits legal, empty commits forbidden — `src/git.ts` (`unitViolations`, `beginUnit`); 0021 §1.3/§6. The audit's purity target is the sessions' own commits: a resume that finds the person's commits in an interrupted unit's range adopts them — readable drift alone, no reuse of the recorded session, no rollback, no stop — because both resume entry points re-record the unit baseline at the current HEAD, the person's commits sitting before the close-out range — `src/resume-gate.ts`; 0145, 0183 D3's readable bound.
- Clean worktree at unit start and run start (driver-state leftovers self-heal; other dirt blocks for a human); foreign commits are never rolled back, and on an interrupted resume they are adopted as the continuation scene — "the authority over git state belongs to a human" — 0021 D5, 0022, 0145.
- `--commit false` retired entirely (tombstoned); the commit side idles only under dryrun and non-git test doubles — 0021 D7, 0061 R13.
- The person's completion paths: `close` (the `Closed:` field, `git revert` the undo) and `land` (squash default) — `src/close.ts`, `src/land.ts`; 0053 D17, 0074.
- Session ends are commit boundaries in the manual twin (shares at handovers; workers still never commit) — 0087. The person must not hand-commit inside a live unit's range (0076): such commits forfeit session reuse and land as adopted drift at the resume — the audit re-anchors around them, and the authority over git state stays the person's (0021 D5) — they never stop or roll back a run.

**Provenance.** 0021 (2026-09-14), generalizing the prior "persisted and committed" protocol into the universal check.

**Known tensions.** The branch-isolation trade-off is stated, not hidden: after `land` the deliverable holds one curated commit while the full per-unit trail remains in the driven root's git (0074) — P18's division of labor. Init demands a committable git identity and bootstraps git rather than silently disabling the condition (0073).

### P7 — The driver judges grammars it defines, never the meaning of content (fence-grade)

**Statement.** The driver may check and write only mechanical grammars — paths, markers, trailers, index lines, field blocks, and the agent event and tool-call streams; content quality is judged by planned acceptance work, sessions and people, never by driver-side heuristics.

**Rationale.** "A driver-side scan that judges content re-implements acceptance work in the wrong layer, with heuristics instead of a model" (0060 §3). The precise restatement: "The driver may judge and write only grammars it defines… It never judges or rewrites the meaning of prose" (0061 R15).

**Derivations.**
- The grammar criterion itself, replacing 0060 §3 line 3 — 0061 R15.
- refcheck and `check` retired as content policing; "keeping references valid is each session's own work, not a driver check" — 0061 R1/A3–A5.
- The standardization boundary: the driver's protocol markers constrain exactly the index/state files it parses and the handoff documents; "Everything else a session writes under `docs/T-NNN/` is free content… no schema, no required headings" — `src/document/roles.ts`; 0045 §3.
- Gates check grammar only; depth is the guidance's and the person's bar — "a machine check cannot see thoroughness, and pretending to would cheapen it" (0084 D4); the round-close `## Close` listing "checks presence, not content" — `src/round-close.ts`; 0049 G8.
- Intelligence recorded, not ambient: "plan writes the decision as a document field; the driver executes it mechanically" (the `Decompose:` field) — `src/runner.ts`; 0075.
- The tier belongs to the work, the fleet to the operator — the seam that keeps capability judgment out of content judgment — 0055 §3.
- The stuck detector kept as tool-call-stream grammar; the classifier advisory-only — "it never lowers a class, never judges completion" — `src/stuck.ts`, `src/classify.ts`; 0061 R15, 0055 C6.

**Provenance.** 0060 §3 (the operator's ruling, 2026-09-27), restated as the grammar criterion by 0061 R15.

**Known tensions.** None that bend it: P1's scan reads paths and ids — grammars. The manual suite and acceptance sessions carry the judgment half. The positioning fence "not a content judge" is this principle's strategic face (0064 §4).

### P18 — The record outlives the tool

**Statement.** The durable state of any run is plain files and git history — documents, indexes, receipts, append-only journals, JSON state — readable and manipulable by any human, agent or script without the driver present; document paths are permanent once landed.

**Rationale.** "The record outlives the tool… This is the deepest moat: not lock-in but its absence — adoption costs little because leaving costs nothing, and audits need no special tooling" (0064 §1).

**Derivations.**
- Permanence: documents under `docs/` never move or get renamed once created; task paths permanent so tasks are never nested under rounds or phases — `src/docpaths.ts`; 0010 R2, 0047 §1. Task ids never repeat within one corpus: numbering derives from the surviving artifacts alone (0150), documents are write-once so deletion is off-protocol, and a restart's re-issued numbers open a new corpus — the downstream machinery corpus-bounded so the two never collide (0140).
- Machine-addressable history: per-task commit subjects and `Auto-Task`/`Auto-Stage`/`Auto-Nested` trailers; "git history is the audit trail of AI changes, with rollback granularity = one session" — `src/git.ts`; 0021, 0029.
- Append-only journals as the interchange: `.auto/run-events.jsonl`, `.auto/run-status.jsonl` — consumers parse the typed lines, "never log prose" — `src/engine/events.ts`, `src/run-status.ts`; 0061 R4, 0067, 0071 §3.
- Deletion is safe only after distillation, and pairs directories with index lines in one commit; "git history retains everything; the audit trail (per-task commits) never leaves" — 0070.
- Human-readable state files over databases ("the state store is git+files rather than a database", 0064 §2). The daemon writes nothing under any target's `.auto/` — the record stays the driver's alone — 0067 T-098.

**Provenance.** 0010 (stable references); 0064's positioning thesis.

**Known tensions.** The deliverable's history is the person's to curate — `land` squashes by default while the driven root keeps the full trail (0074); P1 already frees the deliverable from the process record entirely. Journals are best-effort by design ("Recording is best-effort… never a run failure", 0071 §3) — the record tolerates truncation at run starts, never corruption of the committed trail.

## II. Operating principles

Thirteen principles: removal degrades how the tool runs without changing what the tool is. Each is a standing trade-off — the same five parts as Tier I plus three fields: **Choice** (the tension), **Chosen default** (where it stands today), **Revisit trigger** (what would reopen it). A Tier II default may flip without identity change, by `Amends:` at a release boundary.

### P5 — Single ownership (two scopes: state and mechanism; absorbs P11)

**Statement.** Each kind of state has exactly one home and exactly one writer — content in unit documents, runtime state in `.auto/`, the constitution in `config.json`, the driver the sole writer of progress, index and protocol state — and every mechanism, rule and vocabulary has exactly one owning home; no mirrors, no second sources of truth; duplicates are consolidated and the consolidation held by ratchets that only shrink.

**Rationale.** Dual homes drift and dual writers race. The CURRENT.md mirror was "a pure mirror of committed documents… Nothing on the resume path depends on it" (0054); a generated PLAN.md would be "a second source of truth, and every rewrite enters commits and the clean gate" (0047 §8); session-maintained AGENTS.md "produced unversioned state that the completion condition and the rollback could not see" (0054). And duplication is drift waiting to happen: "Two listings of one rule table would drift" (0052 Q8); "The disease is the manual sync, not the carrier count" (0072).

**Derivations — the state scope.**
- One classifier, one policy table — "classifies any target-relative path by shape only (never content or existence)" — `src/document/roles.ts`; 0045 D1.
- Runtime state is not a document (status, attempts, fork base in `.auto/units.json`); the index is order and membership only — `src/tasks.ts`; 0047 U3/U4.
- The mirrors retired: CURRENT.md deleted (0054 D3), the AGENTS.md round snapshot retired, AGENTS.md holds only the driver's block, read-only during runs (0054 D1/D2).
- The brief is driver-written state through named channels only (seed, survey install, `fix`'s move) — `src/brief.ts`; 0081 D6c.
- The config layer is constitutional: fixed by init, revised per-key by amend, repaired by rule by fix, read-only during runs; init and reset are exact inverses — `src/config.ts`; 0004, 0052.
- One lock per directory (`.auto/run.lock`): one driver per working directory, held for the run's whole life; the lock's scope is commands that write what a running driver reads, never read-only channels — the retry fork takes no lock, loud on collision — `src/lock.ts`; 0053 D1–D3 (the owning concern), 0129 (the scope).

**Derivations — the mechanism scope.**
- The consolidation: one spine with declared arbitration order, concerns each owning one state slice; `chain-transitions.ts` as "the one home of every SessionChain field write"; `RunServices` the one constructed holder — `src/engine/`, `src/chain-transitions.ts`, `src/services.ts`; 0061 R7/R11.
- The ratchet family: `test/import-direction.test.ts` (SUBDOMAIN_EDGES, SERVICE_ENTRIES — allowlists that may only shrink), `test/chain-writes.test.ts` (the write ratchet reaching zero), the manual-suite ratchet (`test/manual-prompts-ratchet.test.ts`, 0078/0093).
- One strict loader ("one strict loader to keep honest", 0053); one classification point (0045 D1); the single routing path (0061 F2/C4).
- One owning layer per rule, the audience tag deciding it; `agents-block.ts` constants the single source ("one source two renderings") — 0072. Single-source data: docpaths the single path-construction point (0034 D10); the models registry the single routing authority.
- The 0102 cleanup as the standing reflex (dedup batches, shared helpers, the git split).

**Provenance.** State scope: 0047's unit-layout rulings and 0054's retirement assessment. Mechanism scope: 0061's consolidation program, with 0024's pure-relocation discipline as the earlier expression. Folded into one principle with P11 by 0110: same failure class, same ratchet family — separate ids duplicated the policy.

**Known tensions.** The person revises the brief and the config only through the commands, never by hand mid-run — the trade P2 sanctions. Documents are readable by all, writable by one; the verify-era write exception was reverted as overreach (0009 §H). Compatibility re-exports and seams cost indirection (0024 D2, deliberately temporary); the ratchet tables are themselves maintained state; "the unit of modularity is the interface, not the file" (0060 D7).

**Choice.** Consolidate to exactly one home and one writer, held by shrink-only ratchets, versus the convenience of local copies and manual sync.
**Chosen default.** One home and one writer for every state kind; one owning home for every mechanism, rule and vocabulary; duplication is consolidation debt (the 0102 reflex); the ratchet allowlists may only shrink.
**Revisit trigger.** A seam or ratchet whose maintenance and indirection measurably cost more than the drift they prevent — compatibility re-exports are the sanctioned temporary exception (0024 D2), retired when the migration they serve lands.

### P6 — State is derived where possible; every step is idempotent, and recovery is re-derivation

**Statement.** Prefer state derived from durable evidence (files, git, directory shape) over newly persisted state; what persists must be minimal and idempotent; every recovery re-derives from disk rather than trusting memory or self-report, and human-facing surfaces render from live state rather than frozen copies.

**Rationale.** Persisted state rots and mirrors go stale: "derived, with zero new rot-prone state" (0006); "A hand-written copy drifts the moment the next advance lands, and nothing flags the drift" (0105).

**Derivations.**
- Routing as a pure function of the files: `routePhase` reads only the phase directories and indexes; round derivation from `docs/R-NN` directories; no state written at the gates — `src/phases.ts`; 0006, 0049 G8.
- Idempotent construction and steps: `establishRound`, the formulation todo's rewrite-on-diff, append's snapshot-reset-collect — 0006, 0095 D1, 0053 D24/D25.
- `/exit` is a scheduled stop at an existing safe boundary, "fully isomorphic to the recovery path of any real crash/kill interruption" — `src/exit.ts`; 0014.
- Hibernation checks only "am I in-window right now", never predicting the next unit — `src/hibernate.ts`; 0027 D5.
- Strict resume's fidelity bar: uncertainty → no reuse, roll back to the unit baseline — `src/resume-gate.ts`; 0022.
- The person-proxy brief renders from the same state derivation the stops use — "it can never be stale and never misname the role" — `src/driver-helper.ts`; 0105.
- Recovery keys on driver-persisted records (openStep precedence over file-derived routing); progress records claimed at dispatch, restored on failure — `src/resume.ts`; 0018.

**Provenance.** 0006's phase-state ruling; 0018's recovery-precedence incident (the unclosed 196.8k planning session silently skipped).

**Known tensions.** Some state must persist (units.json, windows.json, stats); the rule is minimality and single-purpose reading ("read it for two purposes only… never for disabling a model", 0057 §8), and persisted state never becomes a second source of truth (P5). Re-derivation costs recomputation at every boundary — paid gladly for crash-isomorphism.

**Choice.** Derive state from durable evidence (recompute at each boundary) versus persist fresh state (rot risk) — serving P3 and P18.
**Chosen default.** Derive; what persists is minimal, idempotent, single-purpose; every recovery re-derives from disk.
**Revisit trigger.** Boundary recomputation measurably dominating the boundary's own cost in the stats.

### P8 — A check's enforcement moment is deliberate: detection records; the person's moments enforce

**Statement.** A mechanical finding names its own moment: most checks record and surface (counts, warnings, findings, informational notes — detection that needs no person act is a note, never a finding), blocking is reserved for the stop's own work and the person's moments, and every surfaced line teaches the remedy it wants.

**Rationale.** Blocking on everything taxes velocity for properties only later moments need (0103 D2); blocking on nothing hides drift (0067's not-chartered header). "✗ is this stop's work, ⚠ is a record — each names its own moment" (0106 D3).

**Derivations.**
- Provenance detection everywhere, none of it a gate: "a stale pack still loads and still runs — staleness is a visibility problem, not a validity problem"; propagation is one explicit confirmed command — `src/provenance.ts`, `src/sync.ts`; 0100 D3/D6.
- Containment recorded during rounds, enforced at release — P1's timing clause; 0103 D2/D3.
- The ✗/⚠ reading rule and the remedy channels riding the rendered surfaces ("the gates check outcomes, the surfaces teach remedies") — `src/round-close.ts`, `src/driver-helper.ts`; 0106.
- Fail-closed verification of the person's charter (the plan verifier: one retry then block, exit 2) versus loudly-degrading enhancement (the synthesis: audit lines, FALLBACK, the deterministic floor) — `src/prompt-verify.ts` vs `src/formulate-synthesis.ts`; 0080 vs 0097 D4.
- The recorded-state (info) class: detection that names a state needing no person act is a note, never a finding — an expected posture with nothing to repair (a superseded-but-diverging config key) reports `info` with exit 0, firing on divergence alone (agreement the designed state), the hand-remedy trailer never riding it — `src/config-fix.ts`; first ruled 0135, the trigger sharpened 0136.
- The manual suite's stricter line: no release gate stands behind an agent-driven run — 0103.

**Provenance.** 0100 D6 (detection-is-not-a-gate, ruled when runtime layering was rejected) and 0103's record-then-enforce; the 0106 field round taught the remedy-teaching half.

**Known tensions.** Trades against fail-closed (P12): the plan verifier and the guarantees render gate block precisely because a person's charter is being violated *now*. The distinction is whether the finding's moment has come — never whether the check is cheap.

**Choice.** Record-and-surface versus block — decided per finding by whether its moment has come, never by whether the check is cheap.
**Chosen default.** Detection records everywhere; blocking is reserved for the stop's own work and the person's moments; every surfaced line teaches its remedy; a detection that needs no person act is a note (the recorded-state class), never a finding.
**Revisit trigger.** A field round where the accumulated release-blocking set proves late and expensive to restate (T1; the 0045 and 0103-carve-out drifts are the history).

### P10 — The byte-identical floor

**Statement.** Every opt-in mechanism degrades to the unchanged baseline: unset switches, absent declarations, missing capabilities and disabled machinery leave behavior byte-identical to the serial floor; only ruled defect fixes change every run.

**Rationale.** An existing project's behavior must not change under a feature it never asked for — the freeze-period invariant (0036 D17) every later opt-in inherited. "`--parallel none` must be byte-identical to today's behaviour."

**Derivations.**
- The switch discipline: experiment switches read the environment only, persist nothing, unset = byte-for-byte status quo — `src/switches.ts`; 0003 §9.8, 0017 F.
- Kill switches remove machinery, never checks: `OPENCODE_AUTO_SYNTHESIS` (0097 D6), `OPENCODE_AUTO_REGRESSION` (0098 D8), `OPENCODE_AUTO_DOC_LANES` (0099), `OPENCODE_AUTO_PARK` (0096 D7).
- Opt-in checks (0113): `OPENCODE_AUTO_PLAN_VERIFY` ships default off — off removes exactly the semantic check (the skip reason's own words) while the mechanical layers always hold (the render gate, the precedence blocks, the wrap-up's charter acceptance); its earlier listing among the kill switches (0080's framing) was reversed by 0113's default flip, the line corrected 2026-11-05 (0165-101, 0166 step 006 — wording only, no behavior ruled).
- Declaration-as-opt-in floors: a pack without `## guarantees` is the zero-intent floor (0080); without regression rows, byte-identical (0098); without test-lanes, the serial channel unchanged (0096); the unnamed manual run keeps the serial loop (0104 D1).
- No registry, no change (0055 C2); every run still has a registry — the implicit synthesis (0061 F2).
- Lanes floor at one session for any project (0068 D10); doc lanes' silent serial degrade (0099 D2).
- Capability degradation lands on existing fallbacks; the one exception refuses at start rather than failing mid-unit — `src/capability.ts`; 0040 D1/D3. Manual-suite twins: "without the phrase the loop is exactly as written today" (0104 D1); install-prompts resyncs byte-identically, extras never deleted (0093 D2).

**Provenance.** 0036 D17; the switch layer's founding discipline (0003).

**Known tensions.** Defects fix behavior for every run — "They are defects, not features" (0057 §11.1); a floor must never be allowed to mask a defect. The dead-protocol-field cleanup (0069) is the audit that prunes floors whose reason died.

**Choice.** Opt-in mechanisms preserving an unchanged baseline versus always-on behavior change; ruled defect fixes are exempt (0057 §11.1).
**Chosen default.** Every opt-in degrades byte-identically to the serial floor; kill switches remove machinery, never checks.
**Revisit trigger.** A floor masking a defect (R3) — the scheduled dead-protocol audits (0069) are the pruning pass.

### P12 — Fail loud; under uncertainty take the conservative direction; degrade visibly

**Statement.** Failures are surfaced, never swallowed into a clean verdict; uncertain readings resolve conservatively (toward dirty, toward not carrying context forward, toward no reuse); degradation renders its fallback; nothing is guessed silently.

**Rationale.** The founding review's diagnosis: risk concentrates in "text-protocol parsing that is too lax, process/timeout boundaries, and git command failures being swallowed into a 'clean' verdict" (0025).

**Derivations.**
- Git command failures distinguished from empty results, "always conservative toward dirty / foreign commits present" (0025 M1); exit-0-with-uncommitted-changes made impossible (M2) — `src/git.ts`.
- Strict failure over silent fallback for stored configuration (0004); the registry validates strictly — "a misspelled `aviod` would otherwise silently put a model back into its peak hours" (0055 §4.1); parsed-strictly charter keys ("never silent precedence", 0100 D10).
- Unknown resolves conservatively: usage unknown → "toward the side that neither carries context forward nor ends a session on a guess" (0038 D2); classification uncertain → do not switch (0017 D6); recovery fidelity uncertain → no reuse, roll back (0022); unparsable receipts never cover (0098 D3).
- Catch-alls re-throw unknown shapes — driver programming errors never enter the infinite recovery loop (0025 M6).
- Retired switches warn instead of failing unattended runs (0061 R17); retired-key discards are named with their values (0052 D4).
- Loud degradation: `synthesis:`/`fidelity:`/`FALLBACK` audit lines (0097); "never fail silently, never continue silently — degrade loudly with the information a person (or a fix session) needs" (0097 header).

**Provenance.** 0025 (the 2026-09-17 review); 0004's strictness ruling.

**Known tensions.** Strictness is calibrated by whether a wrong value silently changes behavior: config's unknown keys are ignored (forward compatibility) while registry fields are not — the difference is stated, not accidental. Loudness trades against the counts convention's quietness — warnings are counts and one-liners, failures are itemized.

**Choice.** Where strictness applies: strict where a wrong value silently changes behavior (registry fields, charter keys, stored config), lenient where consumers must survive unknown lines (event streams, journals) — T9.
**Chosen default.** Fail loud — surface, never swallow; uncertain readings resolve conservative; degradation renders its fallback.
**Revisit trigger.** A compatibility incident in either direction (T9).

### P13 — Frozen additive-only vocabularies

**Statement.** Protocol literals, event vocabularies, exit codes and document grammars change only by conscious lockstep — parser, templates, markers and pinning tests in one change — grow additively, and retire through tombstones; never by drift, never with silent dual meanings.

**Rationale.** "A flip commit must change the marker literal, the template, and the parser together — otherwise the built-in template itself fails its own guard, or an override carrying the old literal passes while the driver no longer parses it" (0035 D6).

**Derivations.**
- The protocol-string registry and its lockstep procedure (0035; retired with the flip program closed, its procedure now the convention).
- `RunStatusEvent` frozen additive-only; consumers parse defensively — "a line that does not parse is skipped, never an error"; the three event vocabularies pairwise disjoint — `src/run-status-schema.ts`; 0067 P2a, 0071 §3.
- Exit codes stable across the whole evolution (0029 and every later contract).
- Tombstoned key names never reused with a new meaning (0052 D3); retired flags are usage errors, never silently ignored ("silently ignoring a close attempt would let a person believe a unit was closed when nothing happened", 0053 §10 B4).
- Letters stay human shorthand, ids the durable protocol (0079 §5); charter keys canonicalized before any stamp recorded a letter as canonical (0100 D8/D12).
- A name never renames or removes; the planted-rename ratchet enforces it (0071 §3).

**Provenance.** 0035 (M1.5, the flip program); 0071's consumer contract.

**Known tensions.** Temporary dual-read compatibility was used during the flip and retired deliberately when in-flight risk passed (0035 M3.7) — bounded compatibility windows are permitted, never silent precedence. The exit-1 findings convention of fix/sync deviates from exit-2 wording deliberately (0102 invariants-4).

**Choice.** Frozen vocabularies grown additively versus free renaming; bounded compatibility windows permitted, never silent precedence.
**Chosen default.** Change only by conscious lockstep (parser, templates, markers, pinning tests in one change); grow additively; retire through tombstones — a vocabulary's tombstone is its permanent teaching refusal (0225's two-track rule), a silently-changing behavior takes one release of visible warning, then removal in a named later release.
**Revisit trigger.** Dead literals accumulating past the scheduled audits (R6; 0069's dead-field cleanup is the precedent).

### P14 — Dependencies point one way through declared seams

**Statement.** The core does not know shells — never imports a shell package, never imports HTTP; shells inject differences through profiles, registrations and parameters; inside the core, layers point downward through entry modules held by ratchets; agent SDKs are confined to their adapters.

**Rationale.** Injection keeps the core honest and shells cheap: shell differences are injected "exclusively via the `src/shell.ts` profile or parameter passing"; the servicization ruling — "Do not fork or rewrite it; just add a shell package… The core never knows HTTP" (0067).

**Derivations.**
- The shell contract and its branch model: `setShellProfile` and `registerAgentAdapter` in `src/shell.ts`; `registerTemplate` in `src/template.ts`; `registerIntentBundle` in `src/bundle.ts` — docs/shell-contract.md; 0055 C3.
- "The core imports no HTTP" as a constitutional assertion in the direction test — 0067 T-098.
- The agent domain self-contained ("`agent/types.ts` imports nothing from src/"); "No driver file imports `@opencode-ai/sdk`" — `src/agent/types.ts`; 0037 D1, 0039.
- The layering ratchets: session-driving strictly layered, lower layers never import upward, testrun never imports the session layer — `test/import-direction.test.ts`; 0024 §D.2; domains through entry modules with shrink-only allowlists — 0061 R10.
- Extension is registries inside the process, consumers outside it — "no plugin marketplace… no multi-user orchestration" — 0060 §5.8, 0064 T2.
- The core/shell contract's missing enforcement leg recorded as a finding-shaped gap (0069 §5.1) — the direction test is the leg.

**Provenance.** 0024's module split; 0055 §8 and 0067's servicization rulings.

**Known tensions.** The boundary-UX track sanctions named core seams — "the substrate is core; the consumers stay outside" (0071 §2) — the seam is core because two shells share it and only the core's run can write it.

**Choice.** One-way dependencies through declared seams (registries inside the process, injection from consumers) versus direct cross-boundary imports.
**Chosen default.** The core never imports a shell package or HTTP; shells inject through the profile and registration seams; core layers point downward through entry modules held by shrink-only ratchets; agent SDKs confined to their adapters.
**Revisit trigger.** A substrate two consumers need that no seam expresses without contortion — ruled a named core seam (0071 §2's precedent), never a silent import.

### P15 — Policy is data; renderers assemble; governance text stays pinned in committed state

**Statement.** Prompt copy lives in templates, judgment and quality content in intent packs and bundles; code assembles data and never authors copy — the two named renderer-owned classes excepted (0221): driver document-grammar teaching (the durable documents the driver itself writes and parses, first the formulation todo's protocol) and dynamic driver feedback (sentences naming measured run state); the runtime reads only the surfaces a bundle materializes and never interprets intent; committed governance text never floats with whichever binary passes through.

**Rationale.** Copy in code is unreviewable and un-overridable; floating governance breaks the record. "The runtime never interprets 'intent'… Intent is an init-time packaging and deployment concept for policy, entirely upstream of the mechanism" (0079).

**Derivations.**
- Templates as embedded data (`with { type: "file" }`), renderers only assemble; "to change prompt wording touch only the template files" — `src/template.ts`, `src/prompt.ts`; 0005, 0029.
- The two-tier marker discipline: tier-1 driver-enforced anchors stay core; tier-2 intent content is marker-free — 0033 D4.
- Intent packs and bundles as the carrier of judgment content; "the key selects; it never composes" — `src/intent/`, `src/bundle.ts`; 0031–0034, 0079.
- Provenance stamps and `sync`: detection everywhere, propagation one explicit command; runtime layering rejected — "governance text stays pinned in the repo… the committed record must keep explaining the rules each phase ran under" — `src/provenance.ts`, `src/sync.ts`; 0100 D6; person-edited files authoritative and never written.
- The mode layer as registered data ("a new mode = one protocol-complete .md file, zero source changes") — `src/mode.ts`; 0005/0029. The manual suite: no runtime code renders it; the ratchet binds it — 0093 D4.
- The renderer-owned boundary named (0221): driver document-grammar teaching — the durable documents the driver itself writes and parses, first the formulation todo's protocol (0095 D4's consciously code-built assembly, its pack-carried policy channels — duties, precedence, round-brief rules — flowing from the packs/partials as always) — and dynamic driver feedback — state-naming joins over measured run state (0083 D11's violation lines, 0053 D16's prerequisite notes; 0080 §8 scoped them out of the gate) — stay in src; their authority is the driver's own grammar and measurement. A named boundary, never an open door: any third class of code-authored session-facing prose remains a defect of this principle — `src/prompt-plan.ts`, `src/prompt.ts`, `src/intent/guarantees.ts`, `src/formulate.ts`; 0221.

**Provenance.** The M1.x intent externalization (0031–0034); 0079 and 0100.

**Known tensions.** Person-edited packs freeze the tool's last-written bytes (upgrade convenience vs person ownership — 0100 D2); embedded prompt templates float precisely because they were never committed project state (0100 D6's own line); the two renderer-owned classes are un-overridable and reviewable only in source — the cost this principle's rationale names, accepted for grammar authority (0221).

**Choice.** Person ownership of materialized packs versus upgrade convenience (T6).
**Chosen default.** Copy in templates, judgment in packs and bundles; code assembles, never authors (the two named renderer-owned classes of 0221 excepted); the runtime reads materialized surfaces and never interprets intent; person-edited files authoritative and never written; propagation one explicit confirmed command.
**Revisit trigger.** A security-critical charter fix blocked by a stale pack (T6).

### P16 — Genericity: no environment-specific facts in tool source

**Statement.** No real project's paths, layout or special cases enter core or shell code; project facts ride the target directory's declared surfaces (config, packs, brief, roadmap). The need to special-case a known project is the signal that the structural rule is still missing.

**Rationale.** "Any future change that would need to name a real project inside `auto-core`/`auto` (or any shell's) source is wrong by construction… the need to special-case a known project is the signal that the structural rule is still missing" (0108 D8.1).

**Derivations.**
- The structural deliverable definition — what a nested destination repository's git manages — replacing dm-flash's test-tooling exemption; 0108 D8.1, pinned in the AGENTS.md invariants.
- Project-declared surfaces as the only carrier of project facts: `scanExempt`, test-lanes, `lanes.caches`, the brief, the roadmap — 0059 X2, 0096 D3/D11.

**Provenance.** 0108 D8.1 (from dm-flash's R-01 close). The references-never-literals half that once shared the P16 id is demoted to the security requirement family (see Tombstones).

**Known tensions.** None recorded; the principle is standing. The escape is always a structural rule or a declared surface, never an exemption in code.

**Choice.** Structural rules and declared surfaces versus special cases for known projects.
**Chosen default.** Never name a real project in core or shell code; project facts ride the target's declared surfaces; a special-case need is the signal to find the structural rule.
**Revisit trigger.** None recorded — the principle is standing; the escape stays a structural rule or a declared surface, never an exemption in code.

### P17 — Concurrency is declared, not discovered

**Statement.** Parallelism is admitted on declarations (`Depends:`/`Touches:`), bought at the cheapest isolation tier that fits, and bounded by disjoint scopes with one sole writer of shared git state; a wrong declaration surfaces loudly — a landing conflict, a dirty tree, a failing commit — never as corruption or silently unlanded work.

**Rationale.** "The work order is declare → isolate → schedule, not schedule → discover conflicts" (0036). Declarations stay advisory because the failure that matters is discoverable at the boundaries: "two lanes editing different hunks of one function produce a clean textual merge and broken semantics, invisible to every gate" — hence admission by disjointness, not conflict repair (0068 D21).

**Derivations.**
- Declared dependencies with shallow semantics and conservative defaults ("missing `Touches` = touches everything, never disjoint; forgetting the field costs width, never correctness") — `src/document/unit.ts`; 0036 D14, 0046 D3/0047 G3.
- The readiness scheduler pure over declared facts; level-independent admission; `Touches` advisory — a wrong declaration is a landing conflict, never corruption — `src/lanes.ts`; 0068 D5/D21.
- The tier ladder: processes before trees; a second tree only for true concurrent code edits, at the cheapest materialization the filesystem allows — 0096 D9.
- Doc lanes: the declaration is the safety argument ("disjoint scopes mean no shared mutable path, so isolation is unnecessary rather than merely expensive"); the await chain as the mutex; shared-state read-modify-writes serialized; the parent the sole git writer through the seam decorator — `src/git-ops.ts`, `src/loop-task.ts`; 0099 D3/D4/D8.
- "Shared git state" names the repository's administrative surfaces — refs, the index, worktree registrations, every read-modify-write of repository state — with the objects database append-only and exempt; one sole writer means the parent driver under lanes (landings flow through it — 0068; the seam decorator — 0099 D4), never concurrent administrative writes by workers.
- Phases drain before closing; never end a session with a lane in flight; the regression background slot never dirties a start gate — 0068 D20, 0096 D1, 0098 D4.
- The manual twin: `parallel: <n>` waves with the same admission, the serial floor without the phrase — 0104.

**Provenance.** 0036/0046/0068 (the parallelism line); 0096's review ruling and 0099's measured serial waves.

**Known tensions.** Declaration discipline costs the planner honesty ("name real paths and real prerequisites, never restructure the plan to create independent tasks", 0104 D6); isolation costs trees and caches — the tiers exist because both prices are real.

**Choice.** Isolation cost versus conflict risk: pay for isolation only at the tier the admitted work needs (T7).
**Chosen default.** Admission on declarations with disjoint effective scopes; the cheapest fitting tier — process parallelism before same-tree doc lanes before worktrees; one sole writer of shared git state; wrong declarations surface loudly, never as corruption.
**Revisit trigger.** A measured landing-conflict or serialization pattern — the tier probe decides (T7).

### P19 — Mechanisms are ruled from measured evidence

**Statement.** A design ruling is grounded in measured field evidence — incidents, censuses, live probes, cost tables — and every claim carries its citation; speculation is not a basis; compensation machinery is re-audited on schedule as agent capabilities improve; platform moves need triggers.

**Rationale.** "Every claim below carries a `file:line` / `doc §` citation or a named census — the evidence rule bound every unit" (0069). The alternative was measured: T-008's 3× cost overrun was "waste, not the price of decomposition" (0059).

**Derivations.**
- Measured rounds as the ruling trigger: dm-glm's 95 full-gate runs / 20.4 h (0098), the serial doc waves (0099), T-008's cost tables (0059 §12).
- Censuses and live re-counting: the AST de-export census (0102), the plans corpus census (0069); "diagnosing live behavior from the worktree source yields wrong conclusions — work from the installed binary" (0015).
- Adapter facts observed, not documented: "Everything below was observed with real `claude -p` runs… not taken from documentation" (0041); verification honesty about what was *not* runnable (0055 S3).
- Independent assessment before big programs (0062 verifying 0061's claims by re-measurement).
- Trigger-gated platform moves: Rust only on 0063 §5's triggers, re-read on schedule; "not a rewrite for taste".
- The compensation audit: "treat capability-driven shrinkage as a scheduled cost audit, not an identity crisis" — quarterly stats reads prune what stopped paying (0064 T1); the counters that make it possible (0069 T-111). Falsification criteria stated with the thesis (0064 §6).

**Provenance.** The corpus's own practice, stated as doctrine by 0069's evidence rule and 0064's falsifiability.

**Known tensions.** Some rulings precede complete evidence and carry their open gaps explicitly (0057 S0) — the discipline is honesty about what is measured, not delay; "a pre-emptive rule needs its own evidence" (0057 §11.10).

**Choice.** Ruling from measurement versus pre-emptive rules ahead of need.
**Chosen default.** Admission on measured field evidence or a named incident, every claim cited; pre-emptive rules carry their open gaps explicitly and their own re-audit trigger; compensation machinery re-audited on schedule.
**Revisit trigger.** A pre-emptive rule's own evidence arriving (0057 §11.10), or the scheduled capability audit finding machinery that stopped paying (0064 T1).

### P20 — In-flight work is never destroyed

**Statement.** Running work is preserved: transient faults are waited out and recovered with the accumulated context kept, control changes land only at safe boundaries, fallible heuristics advise before they enforce, and probes never pollute the real session.

**Rationale.** "Prime directive: guarantee that a session failure never exits the program — under any quota limit, the program should wait until the quota recovers, then continue" (0015). And the asymmetry that bounds intervention: "however sound, the criteria can still misjudge… and the cost of a shutdown far exceeds one superfluous hint" (0016).

**Derivations.**
- The wait-and-probe loop with disposable probe sessions ("never probe with the interrupted session — pushing probe rounds into the real session pollutes its context") — `src/session.ts`; 0015 correction three.
- The most-valuable-session criterion: always fork a copy; the failed session with content outranks blanks ("the 100k+ of verified output inside it is the round's most valuable asset") — `src/chain-transitions.ts`; 0015's corrections.
- Scheduled waits naming the instant ("weekly limit resets …; sleeping until then", 0057 §6); the silence budget; the escalation order key → model → wait (0055 §7).
- Stuck detection hint-only, capped, never halting — `src/stuck.ts`; 0016.
- Liveness probes on fresh connections (half-open detection); truncation resumed by steer, not restart — `src/engine/concerns/liveness.ts`; 0026 §8/D3.
- Control at boundaries only: `/exit` deferred to the next safe boundary (0014); hibernate stops at unit ends (0027); windows gate dispatches, never running turns (0055 §4.4); phases drain before closing (0068 D20); run's boundary stop at a clean phase end (0101 D1). A safe boundary is a committed, resumable stopping point — a unit close, a phase or task boundary, and (0143) a session handover or the wrap-up entry inside a unit — where stopping leaves every artifact committed and the recovery record sufficient; control changes wait for the next such point.
- Executed means done (a pinned script's result persists; recovery never re-runs on suspicion) — `src/testrun.ts`; 0023 M-D1.

**Provenance.** 0015 (the T-062 postmortem) and 0016; extended by 0057's quota work.

**Known tensions.** Waiting trades latency for survival, and the terminal of every bounded wait is the person (P2): `/exit` and double-Ctrl+C remain inside the waits. Hints can be superfluous — the accepted cost of never killing real work on a heuristic.

**Choice.** Wait-and-preserve versus fail-fast (T8).
**Chosen default.** Wait out transient faults naming the instant; keep accumulated context (fork a copy before abandoning); hints before halts; control changes only at safe boundaries; the terminal of every bounded wait is the person.
**Revisit trigger.** Waits dominating productive wall-clock in the stats (T8).

### P21 — Machinery waits for its consumer

**Statement.** Interfaces, generality and mechanisms are built when a real consumer locks the shape; until then a reserved surface is a name, never a half-built mechanism; speculative generality is recorded as cost, never accrued silently.

**Rationale.** Machinery built ahead of its consumer guesses the shape and then defends it; the consumer arrives, the guess bends, and the bending costs more than the waiting did (0034 D2's first-consumer amendment; 0046 D9's inert reservation).

**Derivations.** The unwired loader (0031 D4 → 0032); the first-consumer amendment (0034 D2); composition deferred to the second consumer (0036); reserved-inert names (`--max-sessions`, 0046 D9); deferred cleanup of retired mechanisms (0044 D6); trigger-gated non-builds (0063's Rust deferral — the triggers are the consumer's stand-in). Homes: review-held like P19 (the principle rules at design time); its surfaces are the reservation sites — `src/config.ts` (the key set), the shells' command surfaces, `src/intent/load.ts` (the loader seam 0031 D4 deferred).

**Provenance.** First stated as a family by 0110's stage-4 audit (two children independently); the family's earliest ruling is 0031 D4.

**Known tensions.** Waiting serializes a second consumer's work — the 0036 deferral ended exactly when that wait was paid; the reserved name covers the *certainty* of a consumer, the machinery still waits for its *shape*. A pre-emptive mechanism, like a pre-emptive rule, needs its own evidence (0057 §11.10; P19's tensions).

**Choice.** Wait for the consumer versus build ahead.
**Chosen default.** Wait; reserve names inertly at most; speculative generality recorded as cost.
**Revisit trigger.** A field case where the wait measurably serializes two consumers' work — then build to the named consumer, still not to the guess.

## Tombstones and requirement families

Ids are never reused — P13's own discipline: a tombstoned id never returns with a new meaning.

- **P9 — demoted** to the counts-not-lists presentation convention (a concrete requirement, ruled 0109): human-facing surfaces carry aggregate counts; enumeration only where the list is the work (the release gate's fix list, a stop's own blocking problems). It lives on its surfaces — `src/round-close.ts` (the containment count lines), `src/conclusion.ts` (the ⚑ proxy-answer summaries), `src/driver-helper.ts` (the standing-decisions counts, rendering `resolvesOf`/`clampedItemsOf`, the latter defined in `src/charter-clamp.ts`) — not in the constitution; re-decidable per surface (T5).
- **P11 — folded into P5.** One ownership principle, two scopes: state and mechanism. The id tombstones; nothing else changes meaning.
- **P16's secrets half — demoted** to the security requirement family: registry keys are references (`{env:NAME}`/`{file:path}`), never literals — refused otherwise; a registry profile's env values are literal (`~` expanded) or references by design (0055 §4.2), and nothing is ever printed — logs, `models` output and error lines name the name or the reference, never a value; a resolved value reaches only the managed agent child's environment through the spawn overlay, never anything the tool builds. Hard, testable, right-or-wrong by inspection: held by code (`src/models.ts`, `src/keyring.ts`, `src/agent-env.ts`; 0055 §4.2/§4.3, C4) and by review — the AGENTS.md invariants keep carrying it. (Restated 2026-11-05, 0165-132, 0166 step 006: the earlier letter — "env values are references, never literals" — was false of the profile env surface it seemed to name; the code was already this shape, no behavior ruled. Named residual: nothing warns on a literal env value under a secret-shaped name — declined for now, P21.)
- **The boundary disclaimer** — the driver's protections and driver-run scripts are accidental-write guardrails and convenience stops, not security boundaries (0007 T-016, 0009 §D); where a hard security property is required it is stated as a requirement (the secrets family above), never assumed from a guardrail.

## How to rule

**The derivation tags.** Every future `plans/NNNN` document states its derivation — one consolidated Derives/Derivation paragraph covering every decision block is the corpus's settled form (each block's showing clause named in it; per-block tags equally legal):

- `Derives: P-NN` — with the one clause showing how the ruling follows from the principle.
- `Amends: P-NN` — when the ruling genuinely extends the constitution: the principle is restated and its provenance carried forward, in the same change.
- Every ruling also states the tier it touches (constitutional / operating / requirement).

Rulings may derive from more than one principle (name each); a documented tension between two principles is a ruling's material, never an excuse to skip the derivation. When principles conflict, Tier I governs: a Tier II default bends to a Tier I principle (or is amended), never the reverse; a tension inside one tier is a ruling's material in the same way. Answering a boundary question starts from this document, not from a corpus search.

**The category scope.** A requirement enters through its family, never through the surfaces an incident happened to touch (amended at v0.3.0 by plans/0123, from the measured aftermath of plans/0120: a principled ruling enacted surface-enumerated, leaving six same-family surfaces teaching against it). Every requirement-bearing ruling document carries a **Category scope** section: the requirement family named in one line, then the family's home-set enumerated at ruling time — every surface that carries, declares, or teaches the family — each home marked changed by this ruling, consistent and untouched (with reason), or deliberately deferred (with reason and the deferral's home). The section is written before the enactment (it is the measuring step, not the changelog); the enactment is complete against the enumeration, and an enactment touching a proper subset of its own enumeration is an audit finding at the next release. Enumerating where a boundary answer lives is measurement — the evidence rule (P19) applied to the corpus itself; the operative intake procedure for this repository's sessions lives in AGENTS.md's development conventions.

**The red-flag rule.** A ruling that matches no principle is a red flag to resolve **before** landing: either the constitution is incomplete (fix the set, in the same change) or the ruling is drift (fix the ruling).

**Admission — the evidence rule (P19).** A ruling enters on measured field evidence or a named incident; every claim carries its citation; speculation is not a basis. Pre-emptive rules carry their open gaps explicitly and their own re-audit trigger (0057 §11.10; 0064 T1).

**Requirements live with their mechanisms.** A requirement ruling names its code home and its test home in the same change. Formats, grammars, exit codes, thresholds and security mechanics stay in code headers, `docs/structure.md` rows and INDEX pointers — never in this constitution; a requirement never migrates upward without an `Amends:` ruling. The constitution is bounded by the tier test, never a quota; size is an audit finding (AGENTS.md's 65-bullet navigation is the precedent-documented failure mode); orphan requirements are audit findings.

**Repository-development rules.** Rules governing this repository's own development — not the tool's behavior contract — live in AGENTS.md's development conventions; the tier test keeps them out of the constitution.

**The traceability chain.** positioning → Tier I principle → Tier II policy → concrete requirement → code home → test home — audited in both directions at each release: rule→principle (orphans, gaps) and principle→code (divergences), findings numbered and append-only.

**Change control and the release axis.** Between releases, findings accumulate; the version spine, the stamp and the release sections move only at a release event, while the constitution's text may be edited mid-cycle in exactly two recorded classes — **reconciliation** (a wording repair bringing the text back to what a ruling already ruled) and a **mid-cycle `Amends:` ruling** landing its change with the ruling itself — each recorded in `docs/releases.md`'s mid-cycle amendment register as it lands and consumed into the next release section at the cut (0225, from 0165-069: the defect was the edit's silence, never its timing). The release spine is semver: **major** — a Tier I amendment or a breaking contract change; **minor** — a new opt-in mechanism (floor-preserving, P10) or a Tier II default change; **patch** — ruled defect fixes; while pre-1.0, minor may carry breaking changes, said so in words in the release record. `docs/releases.md` is the maintained design changelog (version, date, principle deltas with tiers, mechanisms added and retired with plans pointers, tombstones, the audit findings' disposition); `plans/INDEX.md` rows carry the release each plan's rulings shipped in. An `Amends:` ruling names the release it amends; this document carries the stamp "current as of release vX.Y". Retiring a mechanism or vocabulary runs the deprecation lifecycle's two tracks (0225): a vocabulary's tombstone is its permanent teaching refusal — the retired surface a parse-time refusal naming the successor, never silently ignored; a silently-changing behavior takes one release of visible warning (P8's detection-not-a-gate), then removal in a named later release. A release is cut when a ruled program completes; the maintainer cuts it. The corpus before this constitution is baselined `pre`; the first release (v0.1.0) records this constitution's adoption itself.
## The trade-off register

Each row: the tension → the choice made → where it was ruled → the trigger that reopens it. A trade-off row is never closed; it is a standing decision with its reopening condition stated.

| # | tension | choice | ruled | reopen when |
|---|---|---|---|---|
| T1 | record during rounds vs block early (P1/P8 against P12) | defer enforcement to the release moment; one count line during rounds | 0103 D2 + addendum two | a field round where the accumulated release-blocking set proves late and expensive to restate (the 0045 and 0103-carve-out drifts are the history) |
| T2 | fresh verification vs session cost (P3) | a fresh session per unit judging by inspection, no context re-buy | 0083 | verification cost measurably dominating execution in the stats buckets |
| T3 | boundary stops vs unattended velocity (P2) | one advance per invocation; stops at clean phase ends | 0101 | a field project where the rhythm measurably starves throughput — `--boundary flow` and the 0089 mode phrases are the sanctioned pressure valves |
| T4 | curated deliverable history vs full trail (P4/P18) | `land` squashes by default; the driven root keeps the per-unit trail | 0074 | a person needing per-unit granularity in the shipped history (`--merge` is the flip) |
| T5 | counts vs itemization on human surfaces (P9 → convention) | aggregate counts; enumeration only where the list is the work (the release fix list, a stop's own problems) | 0109 | a surface where the count repeatedly sends the person hunting for the items |
| T6 | person-edited packs vs upgrade convenience (P15) | person edits win; the tool keeps offering its bytes | 0100 D2 | a security-critical charter fix blocked by a stale pack |
| T7 | isolation vs cost (P17) | the cheapest fitting tier: processes → same-tree doc lanes → worktrees | 0096 D9, 0099 | a measured landing-conflict or serialization pattern (the tier probe decides) |
| T8 | wait-and-preserve vs fail-fast (P20) | wait out quota windows, keep accumulated context, hints before halts | 0015/0016, 0057 | waits dominating productive wall-clock in the stats |
| T9 | strict parse vs forward compatibility (P12/P13) | strict where a wrong value silently changes behavior (registry, charter keys); lenient where consumers must survive unknown lines (event streams, journals) | 0055 §4.1, 0067 P2a | a compatibility incident in either direction |

## The risk register

Each row: the risk → what it threatens → the mitigation → where it last showed. Risk rows are watched, never resolved by wording.

| # | risk | threatens | mitigation | last showed |
|---|---|---|---|---|
| R1 | deferred-enforcement drift — a codification narrower than the ruling it records | P1's integrity; the trigger-incident family of this constitution | the derivation discipline (How to rule) + the per-release traceability audits | 0103's process-path carve-out, corrected only when aster-net tripped (addendum two) |
| R2 | channel divergence — the manual suite enforces what the driver's rounds defer | one truth across the two channel families (P1's stricter twin) | the ratchet test pins shared literals; the divergence recorded as deliberate (T1's row) | 0103 |
| R3 | floor-masks-defect — a byte-identical floor preserves behavior later ruled a defect | P10 against correctness | 0057 §11.1's defect exemption; scheduled dead-protocol audits (0069) | 0069's dead-field cleanup |
| R4 | constitution creep — requirements migrating upward into principles | the constitution's usability (AGENTS.md's 65-bullet precedent) | the tier test at every `Amends:`; size is an audit finding | the 0110 diagnosis (the corpus's 108 documents, no index) |
| R5 | person-gate throughput — every boundary a person act vs long unattended spans | P2's cadence against real projects' scale | delegated channels (0107), the standing surfaces (driver-helper), the 0089 modes; authorship never delegates | watch, not incident |
| R6 | vocabulary freeze vs cleanup — additive-only accumulates dead literals | P13 against maintainability | versioned deprecation (How to rule's lifecycle); scheduled audits | 0069 |
| R7 | corpus-as-requirements growth — rulings accrete without governance | discoverability of the rule space | this constitution + the release organization; plans stay retired-once-obsolete | the 0110 diagnosis |


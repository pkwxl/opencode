# 0238 — Hygiene B: the runner's missed 0156-D5 log surface, resolve.ts's comment language, the dead export and the record's unvalidated kinds, the STATS_PLAN citations, the external-dirs dedup with protect's silent chmod, the task-store hygiene

Status: active-authority (0166 remediation step 078, wave WC-hygiene; findings
0165-192 = S10-09, 0165-193 = S11-11, 0165-194 = S12-11, 0165-198 = S15-05,
0165-205 = S20-14, 0165-206 = S21-06, all S4 CONFIRMED).

One family — **the store and module hygiene the 0165 review's per-scope
sweeps named**: a resume log that still names the wrong handover document for
a lane stream (the one surface 0156 D5's letter did not reach), comments that
state the premises later rulings retired (a cleanup that spares tracked
copies, a tick "on trust" a shape check now gates, an "earlier release" read
that is the live mechanism's own seeding, a fix-subject grammar 0148 D1
rewrote, a stats header that still calls two concurrent runs an accepted
boundary six rulings after the run lock), the one source file whose comments
never left Chinese, a dead export kept alive by its own test, a progress
record's phase kind read without validation, 32 citations to a plan file that
never existed in this repository's history, a door scan written twice beside
its deriving sibling, a protection chmod that swallows its own failure to
arm, a config parsed twice inside one predicate, a park-problem remedy that
points at a document when the fact lives in runtime state, a header claim
about checks that happen elsewhere, CR bytes riding every task prompt, and an
artifact gate an outside-the-root file can satisfy. 0165 is the evidence, not
the authorization: every locus below was re-measured at this step's HEAD
`5199a8b73` before the remedy was chosen, and four of the records' remedy
arms are declined or consumed on measurement (one already landed by an
earlier step's ruling, one a false dedup, one's comment premise already
healed, one consumed as landed with its own INDEX row).

## The measured ground (this step's own, at HEAD `5199a8b73`)

- **192 (S10-09)**: runner.ts:356 — the strict-resume invalid-handover log
  names `handoffFile(task)` while the read it reports (:326-328) took
  `subtaskDoc(task.id, opts.stream, "handoff")` whenever `opts.stream !==
  undefined`; `handoffFile(task, opts.stream)` is the identical selection —
  0156 D5's letter ("the resume logs beside the read use the same
  streamHandoff selection") has exactly this one surface unenacted. The
  comments: runner.ts:36-38 narrates a private duration formatter's
  historical deletion (no import follows — runner.ts imports only `log` from
  ./log; the note also cites STATS_PLAN §5); runner.ts:~186 says an illegal
  switch value "throws its Chinese error message here" (switches.ts's errors
  are English, measured at :510-560); execute.ts:361 says a leftover handover
  document "is cleaned up by the caller (the pipeline) after its recovery
  determination" — since 0171 the cleanup is `removeIfUntracked`
  (runner.ts:578/:598): an untracked copy removed, a tracked one spared for
  its verdict to retire; execute.ts:988 says runSubtask "ticks the checklist
  item on trust" — since 0171 the artifact shape check gates the tick
  (execute.ts:1319-1341, "any hit means no tick and no advance"); 
  execute.ts:993-999 says the interruption-recovery seeding "still reads a
  handover document left by a run of an earlier release" — the read is the
  live handover engine's consumed-state seeding (execute.ts:1104-1110's own
  comment states it: "The text is still read unconditionally: it seeds the
  handover engine's consumed state below"), and the task-level file an
  in-lane serial stream or planned subtask reads is a same-run earlier
  stage's leftover, not an earlier release's. handover.ts's saveHandover is
  tmp+rename at HEAD — 0183 D2 landed it (step 023, 0165-113's row) — the
  record's arm (4) consumed as landed. The tests: no test in test/ names
  either recovery-skip line (grep empty — execute.ts:521 "marks execution
  complete; skipping the whole-task session", :1122 "marks the subtask
  complete; verifying its artifacts"); the chain behaviors the record
  bundled here have oracles since their own fix waves (the advisory :282,
  the chain bound :305, the re-armed retry :100 of test/execute-handover).
- **193 (S11-11)**: resolve.ts carries 128 comment lines of Chinese (the
  review counted 119; later steps added more) — and zero code-side CJK (a
  comment-stripping scan over all 505 lines found none), so the translation
  is a pure comment change. testrun.ts:131 teaches "a fix round gets
  `T-NNN fix<n> <title>`" while the writer (wrapup.ts:364, since 0148 D1)
  is `${task.id} fix ${round}.${ordinal} ${shortTitle(task.title)}`.
  git.ts:95-115 nextFixSession scans `git log --format=%s` over every
  repository root's whole history — unbounded by the task's corpus (0140's
  bound; the 0165-204 ledger row assigns this arm here). wrapup.ts's
  once-false `2 + N` comment is healed at HEAD (:77-93 states 0198 D1's
  at-most-2N+2 / 2N-on-the-FAIL-path bound with its citations) — consumed
  as landed.
- **194 (S12-11)**: unit-commit.ts:123 `resumeModelNow` has no production
  caller (grep over src/, packages/auto, packages/auto-server: only its
  definition and test/unit-commit.test.ts's import); resume-gate.ts:242-246
  AUTO-DECISION records the drop ("both callers used to compute
  resumeModelNow beside this check and never read it … the merge drops the
  dead computation") — the export survived the merge. resume.ts:258-289
  parseProgress maps legacy kinds ("understand"→decompose,
  "verify"/"review"→closeout) then passes any other kind through
  sanitizePhaseRound, which returns every non-wrapup phase as-is — a
  hand-edited or future-vintage record's `{kind:"bogus"}` reaches
  unitReruns' switch with no case (undefined → falsy) and phaseText's
  handover fallthrough (resume-gate.ts:337-357 — `step` words other than
  phase-plan/phase-append render "producing the handover document").
- **198 (S15-05)**: 32 comments in 17 src files cite `plans/STATS_PLAN.md`
  by section (loop-preflight, hibernate, session-api, chain, runner ×2,
  conclusion ×2, loop-task ×2, stats-schema ×2, stats, attempt ×4,
  loop-progress ×2, session, step, loop-phase ×4, log ×5, loop,
  engine/result) — `git log --all -- '**/STATS_PLAN.md'` is empty: the file
  was the self-hosted build's plan document (0019's header names it), never
  a file of this repository. stats.ts:24-27 still says two concurrent runs
  in one directory are "an accepted boundary, no lock file added" — 0053 D1
  landed the run lock (one driver per directory). stats.ts:1027 cites "the
  risks section of context.md" — also never in this repository's history.
  0019's sections A–H carry the same conventions (§B the confirmed
  conventions incl. waitMs and the hit-rate rule, §C the persistence
  schema, §D the timing model with incremental persistence and
  depreciation, §E the hook table and the formatter consolidation, §F the
  six messages — its items 1–6 are STATS_PLAN §4.1–§4.6 one for one, §H
  risks and boundaries).
- **205 (S20-14)**: external-dirs.ts:72-100 — rootSymlinkRealPaths and
  rootSymlinkDoors run the identical loop (same entries, same realpath
  catches, same three exclusions), one collecting targets, the other
  name+target pairs; the derivation is exactly `[...new Set(doors.map(d =>
  d.target))].sort()`. protect.ts:58-60 — `set()` is
  `chmod(path, mode).catch(() => {})`: a read-only filesystem or foreign
  owner makes the guardrail fail to arm (or fail to restore) with no line
  anywhere. wall.ts:269-270 — openFindingsOf parses the config text with
  `externalDirectoryLive(text)` for isBoundaryKey, then calls
  `admittingCoverage(text, targets)` which re-parses the same text
  internally (external-dirs.ts:594). fork.ts:74-77 `within()` is a
  directional containment predicate (relative()-based, the "..foo" sibling
  edge handled) used twice with two distinct refusal teachings (fork.ts:145
  "cannot lie inside the project", :148 "cannot contain the project"),
  both pinned (fork.test.ts:376/:379, the symlinked-prefix case :660);
  pathsOverlap (external-dirs.ts:550, 0189 D3's deliberately created shared
  predicate) is symmetric overlap; allowCovers (:539) is pattern coverage —
  three grammars, not one mechanism written three times.
- **206 (S21-06)**: tasks.ts:602-607 — when unitProblems' graph includes a
  park problem (`T-005 parks on unknown T-009`, document/unit.ts:398), the
  wrapper's remedy teaches "`Depends:` in docs/T-NNN/todo.md names tasks …
  fix the field lines manually and re-run" — but the park fact is a runtime
  record (`parked` on the task's .auto/units.json entry, tasks.ts:442-444),
  and no Depends line was ever wrong. tasks.ts:21-25 header claims "The
  graph is checked on load — a bad graph makes the index invalid — and in
  the planning and decompose collects": loadPlan does throw on the TASK
  graph (tasks.ts:600-607) but runs no checklistProblems — the SUBTASK
  graph is checked at the subtask loop entry (runner.ts:1170), the
  decompose collect (execute.ts:929), the split's plan walk (split.ts:109)
  and the work-order export (work-order.ts:217). tasks.ts:294-313 taskBody
  splits on `\n` and keeps `\r` — a CRLF todo.md rides CR bytes into every
  prompt body and scope section (0158's re-read confirmed the readers all
  trim; subtasks() normalizes at entry, tasks.ts:172-174, the phase-type
  file's precedent). document/spec.ts declarePath accepts any path token;
  checkArtifactSpecs (spec.ts:217-256) existence-checks
  `join(check.dir, spec.path)` — `Artifacts: ../x.md` or an absolute path
  is a gate satisfiable by a file outside the target directory, while
  Touches rejects exactly those shapes (document/unit.ts:412-413).

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P19** (mechanisms ruled from measured evidence): showing for the whole
  ruling's method — every locus re-measured at HEAD before the remedy was
  chosen, and four arms declined or consumed on the measurement (the
  handover write already atomic under 0183 D2; wrapup's bound comment
  already stating 0198's bound; the within() "duplication" three distinct
  grammars with their teachings pinned; the chain-test arm already covered
  by its own waves' oracles). It also shows in D6c: the CRLF normalization
  follows the measured corpus precedent (subtasks(), phases/custom.ts)
  rather than inventing a new tolerance.
- **P5** (single ownership): showings for D3a (the dead export removed —
  an export with no consumer is a second home for a computation the merged
  check no longer performs), D5a (rootSymlinkDoors becomes the one scan
  home; rootSymlinkRealPaths derives, as the module's own comment already
  promised), D5c (the config text parsed once inside one predicate) and
  D6d (the path-escape rule one exported predicate at the home the Touches
  arm already owns, the artifact checker its second consumer).
- **P6** (derived state, idempotence, re-derivation): showings for D2c
  (nextFixSession's ordinal derived from the task's own corpus — the same
  bound taskFirstCommit and taskChangedPaths read; underivable boundary →
  the whole-log floor, byte-identical where no re-issuance) and D3b
  (parseProgress's validated read: a record that is not a Phase reads as no
  phase and the flow re-derives from the default — recovery keys on
  well-formed driver-persisted evidence, never on a hand-edited shape).
- **P12** (fail loud; conservative under uncertainty): showings for D3b
  (an unknown kind resolves toward the default flow, never a phantom
  "producing the handover document" description), D5b (the chmod that
  failed to arm — or to restore — is named, ENOENT excepted as the
  expected absent file) and D6d (an escaping artifact declaration is a
  named problem, never an existence check outside the root that could pass
  silently).
- **P8** (detection records; every surfaced line teaches its remedy):
  showings for D1a (the resume log names the document an obedient session
  must judge — the same file the read took), D5b (the ⚠ names the file and
  its consequence) and D6a (the park problem's remedy names the record and
  its file, teaching the one edit that resolves it, never a document field
  that was never wrong).
- **P18** (the record outlives the tool — a citation must resolve):
  showing for D4 (32 citations re-pointed to plans/0019's measured
  sections; the stats header's stale locklessness note replaced by the run
  lock's truth) and D2a (the last wholesale-Chinese source file joins the
  corpus's English convention — AGENTS.md's own Overview promise).
- **P7** (grammars, never content): showing for D6d (the artifact path
  rule judges the declaration's shape — absolute or `..`-bearing — never
  the artifact's content) and D3b (the Phase union's own words are the
  grammar; nothing about the record's meaning is judged).
- **P10** (the byte-identical floor): showings for every mechanism arm —
  no root symlinks (the derived scan returns what it returned), a
  well-formed progress record (the validation passes it through
  unchanged), an underivable corpus bound (the whole-log scan stands), a
  LF-only document (taskBody byte-identical), an in-root artifact
  declaration (no problem line), a successful chmod (no ⚠), a non-stream
  resume (the log names the task-level file exactly as before).
- **P21** (machinery waits for its consumer): showing for D3a (the export
  deleted rather than kept "for the next consumer" — a reserved surface is
  a name, never a half-built mechanism, and a dead function with a test is
  machinery whose consumer never came) and for the declined within()
  unification (a shared helper with no second consumer of its grammar would
  be generality bought for symmetry).

## Decisions

**D1 — 192: the log beside the read names the read's own document; the
stale pipeline comments restated; the recovery-skip oracles landed.**
(a) runner.ts:356's strict-resume invalid-handover log names
`handoffFile(task, opts.stream)` — the identical selection the read at
:326-328 made (a stream's per-stream document, the task-level file
otherwise): 0156 D5's letter completed at its one missed surface, with a
regression case seeding a stream record whose per-stream handoff.md lacks a
valid status line and asserting the log names `docs/T-NNN/S01/handoff.md`.
(b) The comments restated to the standing truth, behavior byte-identical:
runner.ts:36-38's orphan note replaced by the consolidation's durable fact
(the compact duration format lives in src/log.ts, plans/0019 §E — no import
here, no STATS_PLAN cite); runner.ts's "throws its Chinese error message"
→ "throws its error message"; execute.ts:361 → the caller removes an
untracked leftover after its recovery determination, a tracked copy spared
for its verdict to retire (0171); execute.ts:988 → the session runs, then
the artifact shape check gates the tick (completion never judged by
self-report, P3; the wrap-up report accounts for the whole task);
execute.ts:993-999 → the seeding below reads the scope's handover document
(the live stream mechanism's own; for a planned subtask the task-level file
— a same-run earlier stage's leftover) to seed the handover engine's
consumed state, so a stale document is never fresh. (c) handover.ts's
atomic write consumed as landed (0183 D2 — measured tmp+rename). (d) The
recovery-skip oracles: one whole-scope case (a TRACKED handoff.md carrying
`Status: done` under an active record — the session skipped, the close-out
runs, the skip line asserted) and one subtask-scope case (a tracked
per-stream handoff.md carrying `Status: done` — the artifacts verified,
then the close-out, the skip line asserted) in test/execute-handover.test.ts
— the tracked-document shape the record named, the cleanup-spared copy the
recovery path actually sees.

**D2 — 193: resolve.ts's comments in English; the subject comment's real
grammar; the fix-session ordinal bounded by the task's corpus.** (a)
resolve.ts's comments translated to English — a pure comment change (zero
code-side CJK measured; every string literal byte-identical), the file
joining the corpus convention AGENTS.md's Overview states. (b)
testrun.ts:131's comment restated to the writer 0148 D1 ruled: a fix round
gets `T-NNN fix <round>.<session> <short title>`. (c) git.ts
nextFixSession gains the task-corpus bound the 0165-204 row assigned here —
the taskChangedPaths pattern at its sibling home: the root repository's
corpus via taskCorpusBound + corpusSince, nested roots via
nestedTaskCorpus, subjects filtered by sha membership (the log read gains
`%H` beside `%s`); underivable boundary → the whole-log floor (0140's own
letter: with no re-issuance the bound changes nothing — the byte-identical
floor), the 0174 D5 failed-read ⚠ and its floor unchanged. The re-issued
id's first fix session numbers from its own lineage (the review's cosmetic
skip closed). (d) wrapup.ts's bound comment consumed as landed (measured
stating 0198's bound).

**D3 — 194: the dead export deleted; the progress record's phase read
validated.** (a) `resumeModelNow` deleted from unit-commit.ts together with
its two pure tests; the nested eligibility describe keeps its subjects
(resumeModelEligible / deadSessionWhy — both live in resume-gate.ts:188/:247)
with its pick premises re-pointed through the router's own target call (the
production path the wrapper wrapped — factsOf + router.target at the
routing facts the tests already build). (b) parseProgress validates the
phase kind against the Phase union's words ("decompose", "whole",
"subtasks", "wrapup", "closeout", "step") after the legacy mappings, and a
"step" phase additionally requires its `step` word in StepKind and a string
`unit`; anything else reads as phase undefined — the default flow, P12's
conservative direction. Well-formed records byte-identical (the floor); a
hand-edited or future-vintage record no longer reaches unitReruns' switch
with a kind no case names, nor phaseText's handover fallthrough under a
word that is not one.

**D4 — 198: the STATS_PLAN sweep — every citation resolves.** The 32
citations re-pointed to plans/0019-stats-timing-design.md's measured
sections: §4.1–§4.6 → §F items 1–6 (one for one); §1's
load/depreciation/close-out → §D; the hook points (task switch, phase
switch, the three human waits, token collection, session segments) → §E;
the wait and hit-rate conventions → §B; the schema cites → §C; the
formatter family → §E's formatter-consolidation note; log.ts:221's stray
"§:" → §B's hit-rate rule. stats.ts's header sentence replaced: one driver
per directory (the run lock, 0053 D1); the stats layer adds no lock of its
own — its per-directory write queue stays the serialization it always was.
stats.ts:1027's "risks section of context.md" → plans/0019 §H. Comment-only,
behavior byte-identical.

**D5 — 205: the one scan, the named chmod, the one parse; the containment
"dedup" declined.** (a) rootSymlinkRealPaths derives from
rootSymlinkDoors — the doors scan is the one loop (entries, catches,
exclusions); the real paths are `[...new Set(doors.map(d => d.target))].sort()`,
byte-identical output (the module's own comment already read "The same
exclusion rules as rootSymlinkRealPaths"). (b) protect.ts `set()` names
what it could not do: one ⚠ per file whose chmod failed (ENOENT excepted —
an absent protected file is the expected floor), naming the file, the mode
it was asked for and the error code — a guardrail that failed to arm (or
failed to restore at unprotect) is never silently armed (or left read-only
after the run). (c) admittingCoverage splits into the pure
`admittingCoverageLive(live, targets)` over the parsed section beside its
text-reading wrapper (the exported API and its oracle-pinned tests
unchanged); wall.ts openFindingsOf computes `live` once and calls the pure
half — one parse inside the predicate. (d) The within() unification
DECLINED on measurement: fork's directional predicate, 0189 D3's symmetric
pathsOverlap and the pattern-grammar allowCovers are three grammars with
three question semantics; fork's two checks carry two distinct teachings
both pinned by tests — a shared helper would lose the direction or add a
conversion heavier than the duplicated line. Recorded, not enacted.

**D6 — 206: the park remedy names the record; the header tells where the
graphs are checked; CRLF normalized once; the artifact declaration
confined.** (a) tasks.ts's graph-problems wrapper, when a problem is a park
problem (a `parks on` line), appends the park's own remedy: the park fact
is a runtime record — the task's `parked` field in `.auto/units.json`
(driver-written, gitignored) — not a document field; a park naming an id
that exists nowhere cannot resolve (0096 D7's collect-problem letter);
remove the task's `parked` entry there and re-run. The Depends/Decompose
sentence stays for the document-field problems it teaches. (b) The header
restated: the task graph is checked on load (a bad graph makes the index
invalid, loadPlan throws) and in the planning collect; the SUBTASK graph is
never checked at load — it is checked at the subtask loop entry, the
decompose collect, the split's plan walk and the work-order export. (c)
taskBody normalizes `\r\n` → `\n` once at entry, subtasks()'s precedent:
the CR bytes no longer ride the prompt bodies and scope sections of a CRLF
todo.md; LF-only documents byte-identical. (d) The Touches path rule gains
its second consumer at one predicate home: document/unit.ts exports the
escape predicate its Touches arm already applies (absolute — POSIX or
drive-letter — or `..`-bearing), and spec.ts's checkArtifactSpecs consumes
it before any existence test: an escaping declaration is a problem line
teaching the in-root declaration, never an existence check outside the
root. Both policies (declared and mandatory) and every declaration surface
(subtask checklist items, split streams, the task-level field) inherit the
rule through the one checker; in-root declarations byte-identical.

Derives: P19, P5, P6, P12, P8, P18, P7, P10, P21 (the showings above).
Amends: none — 0156 D5 STANDS and is completed (its one missed surface
enacted, the letter's own selection rule); 0148 D1 STANDS (the ordinal rule
unchanged — one past the round's highest session; only the scan's range
gains 0140's corpus bound, the bound 0140 ruled for every task-fact
derivation from git history); 0140 STANDS (extended to the third
history-deriving scan, the same floor); 0019 STANDS (its sections become
the citation target its header always claimed to be); 0053 D1 STANDS (the
stats header now cites it); 0096 D7 STANDS (its park letters taught by the
load wrapper's new tail); 0158 D1 STANDS (CRLF reads as content — taskBody
normalizes after the read, the tolerance law untouched); 0171 STANDS (the
comments its remedies retired now state those remedies).

Tier: **code** (the log's stream-aware path, the corpus-bounded ordinal,
the validated phase read and the deleted export, the derived door scan, the
chmod ⚠, the single parse, the CRLF normalization, the artifact escape
rule, the park tail — each with its regression pin) beside
**documentation** (resolve.ts's translation, the STATS_PLAN sweep, the
stale comments, the task-store header, the ruling itself).

premises this ruling changes: none — re-read standing: 0156 D5 (the resume
logs' selection — the one missed log joins it; the execute.ts surfaces it
ruled unchanged), 0148 D1 (nextFixSession's derivation — same rule, the
range corpus-bounded, the ⚠ and floor byte-identical), 0140 (the corpus
machinery — one more consumer, no shape change), 0019 (the stats design —
citations only), 0053 D1 (the run lock — the header sentence now states
it), 0174 D5 (nextFixSession's failed-read teaching — byte-identical),
0096 D7 (the park letters — the load wrapper now teaches the record's
home), 0047 §7 (the dependency grammar — the wrapper's remedy tail
extended, its document-field sentence unchanged), 0158 D1 (CRLF tolerance —
taskBody's normalization after the read), 0171 (the tracked-copy sparing,
the shape-check gate — the comments restated to them), 0183 D2
(saveHandover's atomic write — consumed as landed, its comment unchanged),
0189 D3 (pathsOverlap — the one shared predicate of the overlap question;
fork's directional question stays its own), 0122 (the door scan — one loop
home, the outputs byte-identical), 0146 D3 + 0198 D1 (the fix bound — the
comment consumed as landed), 0228 D2 (the field-block near-miss scan —
untouched beside taskBody's entry normalization).

## Category scope (0123 D1 — the family: the store and module hygiene surfaces above, measured at ruling time)

| home | kind | what |
| --- | --- | --- |
| src/runner.ts | code+doc | the invalid-handover log's stream-aware path (D1a); the orphan note and the language comment (D1b) |
| src/execute.ts | doc | the three stale comments restated (D1b) |
| src/handover.ts | — | consumed as landed (0183 D2) — untouched |
| test/execute-handover.test.ts | test | the two tracked-document recovery-skip oracles (D1d) |
| test/resume.test.ts | test | the stream resume log names the per-stream document (D1a) |
| src/resolve.ts | doc | the comment translation, 128 lines (D2a) |
| src/testrun.ts | doc | the subject comment's real grammar (D2b) |
| src/git.ts | code | nextFixSession corpus-bounded (D2c) |
| test/git.test.ts | test | the re-issued id's fix ordinals bounded by the corpus (D2c) |
| src/unit-commit.ts | code | resumeModelNow deleted (D3a) |
| test/unit-commit.test.ts | test | the pure resumeModelNow tests deleted; the eligibility picks re-pointed (D3a) |
| src/resume.ts | code | parseProgress's kind/step validation (D3b) |
| test/resume.test.ts | test | unknown kind and unknown step read as no phase (D3b) |
| 17 src files (stats family) | doc | the 32 STATS_PLAN citations re-pointed to plans/0019; the header sentence; the context.md cite (D4) |
| src/external-dirs.ts | code | rootSymlinkRealPaths derived from the doors scan (D5a); admittingCoverageLive split (D5c) |
| src/protect.ts | code | set()'s ⚠ on chmod failure, ENOENT excepted (D5b) |
| src/wall.ts | code | openFindingsOf parses once (D5c) |
| src/fork.ts | — | the within() unification declined (D5d) — untouched |
| test/external-dirs.test.ts | test | the derived scan's equivalence pin (D5a) |
| test/protect.test.ts | test | the chmod-failure ⚠ and the ENOENT floor (D5b) |
| src/tasks.ts | code+doc | the park remedy tail (D6a); the header restated (D6b); taskBody's CRLF normalization (D6c) |
| src/document/unit.ts | code | the escape predicate exported, the Touches arm on it (D6d) |
| src/document/spec.ts | code | checkArtifactSpecs consumes the escape rule (D6d) |
| test/tasks.test.ts | test | the park wrapper tail; the header's truth; CRLF taskBody (D6a-c) |
| test/document-spec.test.ts | test | the escaping artifact declaration refused, in-root byte-identical (D6d) |
| plans/0238-hygiene-modules.md + plans/INDEX.md | doc | this ruling and its row |
| plans/0166-remediation/078-wc-hygiene-modules.md + plans/0166-three-package-remediation.md | doc | the step record, the ledger dispositions, the program row |

AGENTS.md and docs/structure.md: no key-file attribution changes — every
mechanism keeps its home (the corpus bound's row already names git.ts;
protect's row names protect.ts; the task-store row names tasks.ts) — held.

# 0237 — Runtime hygiene A: the handover rollback's sibling guard at its one home, the unknown-id park's honest verdicts, the round-close build's bounded wait, the rotation restart's teaching line, the weak Choice oracles re-pointed, the loop-root comments, the run-control aggregates

Status: active-authority (0166 remediation step 077, wave WC-hygiene; findings
0165-019 = S10-08, S2 CONFIRMED CONC; 0165-075 = S04-05, 0165-102 = S09-02,
0165-137 = S18-04, 0165-175 = S32-05, all S3; 0165-184 = S04-10,
0165-186 = S06-09, S4).

One family — **the run's ordinary hygiene at its runtime seams** (P12's
fail-loud and P17's never-as-corruption applied at five mechanism windows, one
test-oracle repair, and two aggregate surfaces): a strict rollback whose scope
silently crosses every sibling lane's state, a park verdict that escalates the
session's own invention to exit 1, a build cap that bounds nothing because the
wait rides a pipe a grandchild holds, a rotation whose rarest failure mode
teaches nothing before it stops the run, a test family that pins the driver's
marks with a weaker grammar than the reader it guards, stale maintenance text
with one latent TDZ, and the run-control aggregates' small lies (a duration
format that crosses its own unit, an install stack one slot shallower than
ruled, a CLI comment claiming atomicity a check-then-act cannot have). 0165 is
the evidence, not the authorization: every locus below was re-measured at this
step's HEAD `0f7251504` before the remedy was chosen, and six of the records'
remedy arms are declined or consumed on measurement (already landed by steps
050/051/060/071/076, unreachable, or structurally impossible).

## The measured ground (this step's own, at HEAD `0f7251504`)

- **019**: unit-commit.ts rollbackUnitState :171-199 calls git.ts rollbackUnit
  directly — no sibling fact, no guard. Its four callers: runner.ts :353/:421
  (the ladder, pre-checked against `input.siblingScopes` at :352/:420 —
  0210 D3's landed refusal) and execute.ts :547/:1207 (executeWhole's and
  runSubtask's rollbackRedo closures — unguarded: `if (!strict || !chain.baseline)
  return undefined; rollbackUnitState(dir, task, …, chain.baseline, …)`).
  runner.ts's own comment :230-233 names the deeper rollback "0165-019's,
  guarded at rollbackUnitState" — a promise, not code. The doc-lane dispatch
  (loop-task.ts :1294-1298) and the recovery flatten (:1435) thread
  `siblingScopes` into runTask's `input` alone; executeWhole receives
  `{ docLane: input.docLane }` (runner.ts :625) and runSubtask the same opts —
  the engine's closures cannot see the fact. Reachability at HEAD: a doc lane's
  whole-task session past the wall without a valid document, strict resume on
  (the default) — rollbackRedo runs tree-wide beside live siblings, exactly
  the finding's sweep, needing no kill.
- **075**: execute.ts parkCheck :291-307 answers `{type:"foreign", known}` for
  every id outside the phase's index — `known:false` (the id exists nowhere in
  the target directory) included; the caller :629-638 throws for both arms
  (driveRun's catch rethrows → runLocked's failure bracket, exit 1), the
  message teaching "Reorder the phase's tasks … so T-009 runs before" for an
  id that exists nowhere. park.test.ts :280-290 pins the throw as behavior
  over the `known:false` shape (T-009 has no state file in wholeSetup). 0096
  D7's deadlock letter: "A park naming a nonexistent id is a collect problem";
  its readiness letter says a cross-phase park "is a planning failure, stop
  and report" — the exit code was never named; the throw cites 0053 D34's
  drift grammar, which is a pre-run refusal's grammar.
- **102**: round-close.ts runBuild :118-140 — plain `Bun.spawn(["sh","-c",cmd])`
  with piped stdio, `setTimeout(() => { timedOut = true; proc.kill() })` at
  BUILD_TIMEOUT_MS, then `Promise.all([stdout.text(), stderr.text(), exited])`:
  the kill reaches only `sh`, and the text() reads end only when every holder
  of the pipes exits — the finding's repro (a 1000 ms cap over `sleep 6; echo
  built` returned at 6004 ms) holds at HEAD unchanged. The corpus's own
  process-control machinery exists since 0175: script.ts killGroup :89,
  detached spawn :136-147 (output redirected by the shell into a file — "no
  pipe is left behind after a kill"), watchProcess :166-226 (the idle/max
  watchdog with TERM→grace→KILL escalation, exported). runBuild uses none of
  it. 0156 D7's bounded escalation and 0175 D1's group kill are the standing
  letters; runBuild is simply not their consumer.
- **137**: server.ts restart :204-256 — 0219 D3's serialization in place (the
  closed flag, one-in-flight, the in-flight-close drain); a spawn failure
  inside the restarting IIFE still rejects (defaultSpawn fails loudly after
  5 s). session.ts rotateProviderKey :387-393 — `commitRotation` then
  `setConfig(spawnKeyConfig())` then `await host.restart(…)`, the fallback
  parenthetical printed only when restart resolves false (external/closed
  hosts); on the throw path nothing prints before the failure bracket. The
  record's remedy arm "move commitRotation after a successful restart" is
  structurally impossible: setConfig must write the landed key BEFORE the
  restart so the respawn reads it — a restart-first ordering would re-spawn
  on the old key (spawnKeyConfig reads the ring state commitRotation writes).
- **175**: the one live arm — blockage-diagnosis.test.ts :236/:239
  `expect(doc1).toMatch(/Choice: A/)` (whole-text, unanchored) and :237 the
  `Executed:` match in the same weakness; the ruled grammar is blockage.ts
  choiceMark :356-374 — the Decision region alone, line-anchored
  `/^Choice:\s*([A-Z])\s*(.*)$/` — and renderBlockageDocument neutralizes
  look-alike heads outside it (0170 D3). The record's other four arms are
  consumed as landed, each by its own fix wave re-pointing its oracle in the
  same change (the record's own remedy): 0187 D4 re-blessed the two turn
  goldens; 0220 D1 replaced the census's permissive fixture and pinned the
  marker sets to the parser's constants; 0198 D1 re-pointed the progress
  tests; 0203 ruled the manual ratchet's oracle boundary and extended it to
  the ruled relationships' producers.
- **184**: loop.ts :43-46 the exit-code comment lists 0/1/2/130 and omits 3
  (driveRun returns 3 at :362); the setClampCaller closure :287-289 reads
  `serverHandle`, a const declared at :333 after the dryrun branch — a TDZ
  trap for any clamp invocation before :333 (unreachable today: afterSession
  skips the clamp under dryrun, git-ops.ts :69; the clamp swallows its own
  errors); phases/registry.ts :46-47 "Builtins are Chinese until the M3.8
  translation batch" over the English names at :110-180; protect.ts :13-15
  "runAll restores writability in a finally block" — true again for the whole
  run only since 0236 D3 gave preflight's stopBlocked exits their own
  unprotect, which the sentence does not name. The record's fifth arm
  (loop-phase.ts :329-330, "the Clarified mark the install itself re-checks")
  is TRUE at HEAD — installApprovedBrief is mark-gated (loop-phase.ts
  :474-477, 0169 D2): consumed as landed, nothing owed.
- **186**: log.ts formatDurationCompact :182-190 — `seconds.toFixed(1)` renders
  59_960 ms as "60.0s" and `remainingSeconds.toFixed(0)` renders 119_600 ms as
  "1m60s"; log.test.ts :104 pins `59_950 → "60.0s"` as behavior. The verbose
  sibling formatDuration :170-176 already rounds to whole seconds first and
  its test :86-89 pins the tier-carry convention ("carried by Math.round,
  steps up a tier — original loop behavior"). services.ts :122-151 — one
  `previous` slot: install A,B,C then uninstall twice leaves `installed`
  undefined (A and B both lost); 0061's AUTO-DECISION rules "the installs
  restore in LIFO order" with no depth qualifier, and the header repeats it.
  auto/src/index.ts :1296-1314 — the config family's lock refusal is
  `liveRunLock` then the command's writes with no acquire, the comment
  calling it "one atomic check → write → commit" (0116 D6's own words: a
  check-then-act, "nothing for a second process to interleave with" — false
  for the milliseconds between the check and the commit). S17-10's deferred
  README/comment half (0165-057's row): GONE at HEAD — step 071's 0231
  removed "numbering recovery" from auto/README.md:1292, 0178 D5 restated
  attempt.ts's comment and landed the pool's no-op restart, keyring.ts's
  walk comment matches the landed before-position bound: nothing owed.

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P17** (declared concurrency; wrong declarations surface loudly, never as
  corruption): showing for 019 — the tree-wide stash-and-reset is exactly the
  "silently unlanded work" shape P17 rules out: one unit's context-wall miss
  would retract a sibling's landed share and yank its in-flight files into a
  stash named for the other unit. 0099 D10 built the refusal for the ladder;
  the engine's deeper rollback is the same mechanism at another caller and
  takes the same posture at the one home every caller shares.
- **P20** (in-flight work is never destroyed): showing for 019 (the sibling
  lanes' running sessions keep their tree), for 102 (a hung grandchild is
  killed with its group — the round close does not wait on a pipe it no
  longer owns; before the fix the wait was unbounded, after it the survivor
  cannot keep writing into the tree past the cap either), for 075's
  known:false arm (the spent session's work stays in the worktree for the
  relaunch, never discarded by an exit-1 escalation).
- **P5** (single ownership): showings for 019 (the guard lives at
  rollbackUnitState — one home, every caller inherits; the sibling fact rides
  the session options exactly as docLane was carried onto them by 0126 D3,
  replacing runTask's input-level duplicate carrier) and for 186b (0061's
  AUTO-DECISION "the installs restore in LIFO order" gets the one honest
  implementation of the ruled semantics — a real stack, not a one-slot
  approximation that silently falls to the process default at depth 3).
- **P2** (the person brackets every boundary) and **P8** (every surfaced line
  teaches its remedy): showings for 075 (a cross-phase park is a planning
  failure — the person's reorder, surfaced as the blocked verdict with its
  remedy, never an exit-1 usage error after a session already spent work;
  an invented id is the session's collect problem — the relaunch's feedback
  names it, the second failure the hidden-blockage block, both 0096's own
  letters), for 137 (the rotation's rarest failure prints its fallback
  teaching line — the rotation is committed, the new key applies at the next
  spawn — before the loud stop), for 184's comment arms (maintenance text
  that misstates the exit vocabulary, the protection lifecycle or the
  registry's names is a teaching defect).
- **P12** (fail loud; degrade visibly; nothing guessed silently): showings
  for 102 (the escalation's ⚠ line is additive and honest; the cap now
  bounds the wait it always claimed to), for 137 (the catch teaches and
  RETHROWS — the failure stays loud, never swallowed into a clean
  continuation), for 186a (a duration never renders in a unit it has
  outgrown — "60.0s"/"1m60s" were silent misstatements), for 186b (a silent
  fall to the process default is the swallowed degradation P12 rules out),
  for 186c (the comment's "atomic" claim retired for the true check-then-act
  with its loud collision).
- **P13** (frozen additive-only vocabularies): the park's foreign arm changes
  from a thrown Error to the blocked UnitStop — the EXIT CODE moves from 1
  (usage/environment, wrong: a session ran and the person must reorder) to 2
  (blocked for human attention — the vocabulary's own meaning, AGENTS.md's
  table); no protocol literal, event word or document grammar changes; the
  park feedback's invented-id problem line is additive; runBuild's failure
  message wording is byte-identical (`\`cmd\` timed out after N minutes` /
  `exited N`), its output tail now read from the merged file. The internal
  ParkCheck union loses its never-more-produced `known:false` foreign shape —
  a module-private type, no frozen surface.
- **P19** (measured evidence): every locus measured at HEAD before ruling;
  six remedy arms declined or consumed on measurement (137's reorder arm
  structurally impossible — setConfig must precede the respawn; 184's
  loop-phase arm true at HEAD since 0169 D2; 175's four arms landed by their
  own waves; 186's S17-10 half landed by 071/0178); the regression pins
  carry the fail-before proofs.
- **P21** (machinery waits for its consumer): showings in the declines —
  186c's take-the-lock arm declined (no measured incident; the collision is
  loud — git's index.lock or the run-start dirty gate — and recoverable;
  plan/close keep their own lock-taking for their own long pipelines), 019's
  "confine the stash and refuse the reset" alternative declined (a
  half-executed rollback writing a stash that holds nothing of the unit's
  own is machinery without a consumer; the D10 refusal shape — nothing
  touched, the serial remedy — is the landed, pinned posture).
- The **How-to-rule** test-home discipline (0233): 175's repairs land in the
  tests' own homes; a defect in a TEST is not a runtime defect — the runtime
  writer is correct (choiceMark accepts what appendChoiceLine writes), the
  oracle was weaker than the ruled grammar. The proof is the repaired
  tests' green runs beside a teeth row that would fail any whole-text
  matcher (0233's non-vacuous discipline), not a fail-before at HEAD.

Derives: P17, P20, P5, P2, P8, P12, P13, P19, P21, and the How-to-rule
test-home discipline (the showings above). Amends: none — 0096 D7 STANDS
(its deadlock letter — "a park naming a nonexistent id is a collect
problem" — is enacted for the known:false arm, and its readiness letter's
"stop and report" gains the exit code its own vocabulary table always
meant: 2, the person's posture; the letter never said 1); 0099 D10 STANDS
and is completed (its refusal becomes the shared voice at the one home it
named); 0116 D6 STANDS (clarify keeps its ruled locklessness; the false
"nothing for a second process to interleave with" claim was the record's
own finding, not the ruling's mechanism); 0061's install AUTO-DECISION
STANDS (enacted whole).

Tier: **code** (runtime behavior: the sibling guard and its opts threading,
the park's two verdicts, the group-spawn build runner, the rotation's
teaching line, the duration rounding, the install stack — each with its
regression pin) beside **test-home** repairs (175's re-pointed oracles,
075's rewritten pin, 186a's re-pointed format pins — the tests that pinned
the defects as behavior) and **documentation** (the comment restatements,
the CLI comment, the ruling itself).

premises this ruling changes: none — re-read standing: 0099 D10 (the ladder
refusal — byte-identical, its fact's carrier moved from runTask's input onto
Opts beside docLane, the message and both call sites' behavior unchanged),
0210 D3 (the siblingScopes threading — same fact, same sites, the one
carrier; its pinned tests keep their verdicts), 0126 D3 (the docLane ride
pattern — extended by one conditional member), 0096 D7 (the park letters —
enacted, see Amends), 0053 D34 (the drift grammar — a pre-run refusal's
exit 1, its citation withdrawn from the mid-run park throw), 0156 D7 (the
bounded escalation — runBuild joins its consumers), 0175 D1 (the group-kill
machinery — runBuild its new consumer, killGroup/watchProcess untouched),
0186 D2 (the one-in-flight restart — untouched; the catch sits at the
caller), 0219 D3 (the closed-flag serialization — untouched; the throw path
beside it now teaches), 0116 D6 (clarify's locklessness — standing, its
comment restated), 0061 C1 + the install AUTO-DECISION (the LIFO restore —
enacted at any depth, depths ≤ 2 byte-identical), 0150 D2 (numbering
recovery retired — S17-10's README half consumed as landed by step 071),
0169 D2 (the install's mark gate — 184's fifth arm consumed as landed),
0187 D4 / 0198 D1 / 0220 D1 / 0203 (175's consumed arms — each re-read,
their oracle repairs standing, the blockage Choice oracles the one arm this
ruling repairs).

## Decisions

**D1 — 019: the sibling guard at rollbackUnitState, the fact carried on the
session options.** `Opts` gains `siblingScopes?: readonly string[]` (set only
by the doc-lane dispatch — "the live sibling scopes beside this doc-lane
unit, D10's refusal fact carried onto the session options the way docLane
was (0126 D3); never by a person's CLI"), the sessionOpts task site gains
the matching conditional member, and runDocUnit threads its input's sibling
scopes into the site — runTask's `input.siblingScopes` carrier is RETIRED
(the ladder's two pre-checks and rollbackRefused read `opts.siblingScopes`;
the messages byte-identical). `rollbackUnitState`'s `extra` gains
`siblingScopes?: readonly string[]`; when present and non-empty it returns
the D10-refusal blocked verdict BEFORE any git call — nothing stashed,
nothing reset:

  `${task.id} ${unit}: strict resume would roll the unit back to its
  baseline, but sibling doc lanes' state is in the tree (${scopes}); a
  rollback is tree-wide and would sweep it. Handle the sibling state
  (commit or clean it) and re-run serially (--max-sessions 1) so the
  rollback can proceed safely`

— the ladder refusal's tail verbatim (one voice, P5). Both execute.ts
rollbackRedo closures pass `opts.siblingScopes`; the blocked UnitStop flows
the engine's existing stop path (`if (redone) return …`) to runTask's
blocked outcome — the lane's finishBlocked commits the interrupted scene
under the unit's own scope and the run holds at exit 2, exactly the
recovery flatten's landed posture. artifact.ts's phase-step caller passes
nothing (phase steps run under no doc lanes — the guard is opt-in by the
fact's absence, P10's floor: every non-doc-lane rollback byte-identical).
The declined alternative — confining the stash and refusing only the reset
— would write a stash holding nothing of the unit's own: machinery without
a consumer (P21).

**D2 — 075: the unknown-id park joins the invalid arm; the cross-phase park
returns blocked.** parkCheck: for an id outside the phase's index, the
state-file probe decides — no `todo.md`/`done.md` anywhere in the target
directory (`known:false`) answers `{type:"invalid", problems: […]}` with
the line `` `${blocker} is not a task of this target directory — no
docs/${blocker}/ state exists; the id was invented or mistyped. Park on a
real blocker of this phase's index, or end with the honest status lines` ``
(the collect problem, 0096's deadlock letter — the one relaunch with
feedback, then the hidden-blockage block, the invalid arm's existing
machinery byte-identical); a real task of the directory outside this phase
answers `{type:"foreign"}` and the CALLER returns the blocked UnitStop with
today's cross-phase message verbatim minus the throw — the person's reorder
at exit 2, the session's work in the worktree. The thrown Error, its
exit-1 grammar and the phantom-task remedy die; driveRun's catch keeps its
shape for genuinely unexpected errors. park.test.ts's throw pin is
rewritten to the two ruled verdicts.

**D3 — 102: runBuild over the 0175 machinery — detached group spawn, output
in a file, the fixed cap through watchProcess.** runBuild spawns
`["sh","-c", 'exec >"$0" 2>&1\n' + command, outPath]` detached (its own
process group) with the scrubbed base, the output file under the run's
driver workdir (`scriptTmpDir(dir)`, truncated first — runScript's own
no-pipe trick: a grandchild holding the fd cannot hang a read that never
waits on a pipe), and hands the proc to watchProcess with
`idleMs = maxMs = BUILD_TIMEOUT_MS` (a fixed wall cap: growth resets the
idle clock but the absolute cap fires at 30 minutes; on the timeout the
group gets SIGTERM, the grace escalates to SIGKILL — 0156 D7's letters, the
⚠ escalation line additive). The tail is read from the file bounded
(readLogTail) and the failure message keeps today's wording byte-identical
(`\`${command}\` timed out after ${BUILD_TIMEOUT_MS / 60_000} minutes` /
`exited ${code}`; out and err now interleaved in one stream — the pinned
round-gates row's expected tail unchanged). runBuild is exported with an
optional `timeoutMs` (the same knob shape runScript/watchProcess expose)
so the regression pins the bounded wait without waiting 30 minutes.

**D4 — 137: the rotation restart's catch-teach-rethrow.** rotateProviderKey
wraps the `host.restart` call: on a throw it logs the fallback teaching line
— `` `⚠ ${task.id} ${why}; provider ${plan.provider} key ${from} marked
down, but the managed server could not be restarted onto key ${to} (the
rotation is committed; the new key applies at its next spawn): ${message}` ``
— and RETHROWS (the spawn failure stays the loud driver-fault stop it
always was; P12's fail-loud kept, P8's teaching added). The reorder arm is
declined as structurally impossible (setConfig must precede the respawn);
walkProviderKey's void restart stays by design (a non-failure act — a false
needs no line, and a throw there is the same loud stop with no "continuing"
sentence to qualify; recorded as the record's own milder family note).

**D5 — 175: the Choice oracles re-pointed to the reader's ruled grammar.**
blockage-diagnosis.test.ts's whole-text `toMatch(/Choice: A/)` and
`toMatch(/Executed: A …/)` rows assert through the executor's own readers —
`choiceMark(doc1)?.choice === "A"`, `executedMark(doc1)` matching the
execution record — beside line-anchored pins; the declining test asserts
`choiceMark(doc)` stays undefined over the placeholder document. A teeth
row proves the re-point non-vacuous (0233's discipline): a document whose
verbatim Analysis body carries an indented ` Choice: A` (the 0170 D3
mark-head neutralization) answers undefined to choiceMark while any
whole-text matcher would pass. The four consumed arms are recorded with
their landing rulings; no other oracle changes.

**D6 — 184: the comment restatements and the serverHandle reorder.** (a)
loop.ts's exit-code comment lists the whole vocabulary — 0 complete, 1
usage/setup, 2 blocked waiting for the person, 3 /exit paused at a safe
boundary (re-run resumes), 130 double Ctrl+C (with 143/129's signal rows
named where the force-terminate family already names them). (b) `const
serverHandle = server` moves above the setClampCaller wiring (the same
narrowed capture, taken earlier — the TDZ trap retired; behavior
byte-identical, the existing narrowing comment kept beside it). (c)
registry.ts's name field comment: builtins render English; a custom type's
name is its file's title line (the "Chinese until M3.8" sentence retired).
(d) protect.ts's lifecycle sentence names both homes: driveRun's finally
and preflight's stopBlocked exits (0236 D3) — "every exit path restores
writability so a human can edit the files after the driver stops". (e) the
loop-phase Clarified arm declined as consumed (true since 0169 D2).

**D7 — 186: the run-control aggregates.** (a) formatDurationCompact rounds
to whole seconds before splitting, mirroring formatDuration's ruled carry
(Math.round first; the sub-minute arm keeps its tenth from the raw value —
within the arm the rounded total is ≤ 59 so the tenth never crosses; the
half-second carry at the minute boundary steps the tier exactly as the
verbose sibling's pinned convention does: 59_500 → "1m"); the log.test pin
that blessed "60.0s" is re-pointed (59_950 → "1m", 119_600 → "2m", the
floor rows unchanged) and the "verbatim identical to runner.ts's private
copy" title retired. (b) installServices/uninstallServices keep a real
stack (push/pop, `services()` reads the top; depths ≤ 2 byte-identical,
the header restating the LIFO at any depth); the depth-3 row pins the
ruled restore. (c) the CLI lock-refusal comment's "one atomic check →
write → commit" restated: a check, then the write — the milliseconds
between are unheld, and a run starting there meets git's index.lock or the
run-start dirty gate, both loud, both recovered by re-running once the
other process finishes; the take-the-lock arm declined (P21 — no measured
incident; plan and close keep their own lock-taking for their own long
pipelines). S17-10's deferred README/comment half: measured GONE at HEAD
(step 071's 0231 README lockstep; 0178 D5's comment and no-op restart;
keyring's bound comment) — recorded, nothing owed.

## Category scope (0123 D1 — the family: the runtime hygiene seams above, measured at ruling time)

| home | kind | what |
| --- | --- | --- |
| src/unit-commit.ts | code | rollbackUnitState's siblingScopes guard (D1) |
| src/opts.ts | code | Opts.siblingScopes + the sessionOpts task-site member (D1) |
| src/loop-task.ts | code | runDocUnit threads the fact into the site; runTask's input carrier retired (D1) |
| src/runner.ts | code | rollbackRefused and the ladder pre-checks read opts.siblingScopes (D1) |
| src/execute.ts | code | the park's invalid-foreign split and the blocked cross-phase verdict (D2); both rollbackRedo closures pass the fact (D1) |
| src/round-close.ts | code | runBuild over the group spawn + watchProcess + file output, exported with the cap knob (D3) |
| src/session.ts | code | the rotation restart's catch-teach-rethrow (D4) |
| src/log.ts | code | formatDurationCompact rounds before splitting (D7a) |
| src/services.ts | code | the install stack (D7b) |
| src/loop.ts | doc/code | the exit-code comment (D6a), the serverHandle reorder (D6b) |
| src/phases/registry.ts | doc | the name-field comment (D6c) |
| src/protect.ts | doc | the lifecycle sentence (D6d) |
| packages/auto/src/index.ts | doc | the lock-refusal comment (D7c) |
| test/unit-commit.test.ts | test | the sibling-refused rollback, nothing stashed (D1) |
| test/execute-handover.test.ts | test | the engine's rollbackRedo refused under a live sibling scope over real git (D1) |
| test/session-opts.test.ts | test | the siblingScopes key rides the doc-lane task site (D1) |
| test/park.test.ts | test | the unknown-id relaunch-and-block pin, the cross-phase blocked pin (D2) |
| test/round-gates.test.ts | test | the hung-grandchild build returns at the cap, the group dead (D3) |
| test/agent-fake.test.ts | test | the rotation restart throw: the teaching line, the rethrow (D4) |
| test/blockage-diagnosis.test.ts | test | the Choice/Executed oracles through the readers, the teeth row (D5) |
| test/log.test.ts | test | the re-pointed compact pins (D7a) |
| test/services.test.ts | test | the depth-3 LIFO row (D7b) |
| plans/0237-runtime-hygiene-a.md + plans/INDEX.md | doc | this ruling and its row |
| plans/0166-remediation/077-wc-runtime-hygiene.md + plans/0166-three-package-remediation.md | doc | the step record, the ledger dispositions, the program row |

AGENTS.md and docs/structure.md: no key-file attribution changes (every
mechanism keeps its home; the navigation lines' file lists already name
unit-commit.ts, execute.ts, round-close.ts's family row, services.ts and
log.ts where their modules are indexed) — held.

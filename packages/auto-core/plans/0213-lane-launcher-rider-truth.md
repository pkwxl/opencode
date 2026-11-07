# 0213 — the compiled binary's lane launcher, the decorator rider's sibling sweep, and loop-task's stated truths

Status: active (ruled by 0166 step 053, 2026-11-08). Three findings of the
0165 register: **0165-011** (S06-05, S2 — the default lane launcher cannot
re-invoke a compiled binary), **0165-084** (S05-07, S3 — the doc-lane
decorator's driver-state rider sweeps a sibling's in-transit completion into
this unit's commit) and **0165-185** (S05-10, S4 — loop-task's comments
state behavior the code does not have, beside three small mechanisms that
differ from their siblings' shape). One family thematically (the lane
machinery's edges the source-layout suites cannot see), three independent
defects; each is ruled on its own principle ground.

The boundary answers first (the requirement-intake rule): the family is
*the lane machinery's spawn, commit and loop surfaces*. Home-set:
`src/shell.ts` (the profile seam's default lane launcher),
`src/git-ops.ts` (the doc-lane decorator's queued commit core),
`src/loop-task.ts` (the loop shapes' comments and three mechanisms), the
test homes `test/shell.test.ts`, `test/doc-lanes.test.ts`,
`test/lanes-scheduler.test.ts`, `test/agent-fake.test.ts`,
`test/repair-loop.test.ts`, and the documentation homes (plans/INDEX.md,
AGENTS.md's navigation, docs/structure.md). 0165 is the evidence, not the
authorization: every decision below is ruled here.

## D1 — the launcher derives its self-invocation from the process shape, not from argv[1] alone (0165-011)

The defect: `defaultLaneLauncher` spawns
`[process.execPath, process.argv[1]!, "_lane", …]`. Under `bun build
--compile` (the shipped form, `packages/auto/script/build.ts`) the embedded
entry lives on Bun's virtual `$bunfs` filesystem and `process.argv[1]` IS
that virtual path (`/$bunfs/root/<name>`) — the child reads it as its
command and refuses ("'…' is not a command", exit 1), the parent relays the
line and stops scheduling. The old comment's premise — "process.argv[1] is
the CLI entry this process started from, so a shell's run spawning lanes
reproduces its own invocation" — holds only where the entry is a spawnable
script path (the source layout `bun src/index.ts`, every test). The
compiled CLI (packages/auto, which sets no profile of its own — the core
defaults, this launcher included) has no spawnable entry path at all: the
binary *is* the entry. The service shell solved its twin long ago
(`auto-server/src/worker-command.ts`: "under $bunfs … process.execPath
already IS the server binary").

The ruling (**P12** — the launcher must actually work in the shipped form,
and a failure must not wear a relayed line that teaches nothing true;
**P14/P16** — the fix stays inside the core's own profile seam and names no
shell, no entry file, no project: the only fact it encodes is a structural
property of the process shape, Bun's virtual entry prefix; **P10** — every
shape but the compiled one must spawn byte-identically): the launcher's
self-invocation is derived by one exported helper,

- `selfInvoke(argv1)`: a real entry path (`argv1` defined and not starting
  `/$bunfs/`) answers `{ command: process.execPath, prefix: [argv1] }` —
  today's vector exactly; a virtual or absent entry answers
  `{ command: process.execPath, prefix: [] }` — the binary re-invokes
  itself, its argv going straight to command dispatch. The launcher spawns
  `[...command, ...prefix, "_lane", worktree, "--unit", unit, …]` from it.

The compiled-shape arm is what the twin's probe corroborates: under compile
every embedded module's `import.meta.dir` lies under `$bunfs` too (the
server twin keys on that witness; the core keys on argv[1] because the core
cannot know a shell's entry file name — argv[1] *is* the entry fact, and
under compile the entry path itself is the virtual one, so the test is
exact). An absent argv[1] reads as the bare-binary shape — no entry path
exists to re-invoke, and `process.execPath` is the only self that surely
is.

- The floor (**P10**): the source layout, every bundle-under-bun shape and
  every shell that overrides `laneLauncher` (auto-server does) are
  byte-identical — a real argv[1] produces today's vector component for
  component.
- The seam discipline holds: shells that own their workers differently
  keep injecting through the profile field (the comment's own letter);
  `packages/auto` needs no change — the fix reaches the compiled binary
  through the defaults it already runs.
- The sharing half of the register's remedy (both shells' self-spawns
  through one core helper) is **declined on P14/P21 grounds**: the server
  twin's source-layout arm probes its own sibling entry (`index.ts`) — a
  shell fact the core cannot own — so its `workerCommand` stays the
  shell's; the core helper answers only the shared structural question
  (can this entry be spawned as a script path) and a shell may adopt it
  when a real consumer locks that shape.
- Coverage: the pure-shape pins (both arms, the absent-entry arm, the
  floor arm) over the exported helper, plus a launcher-assembly pin that
  drives `defaultLaneLauncher` itself over a stubbed `Bun.spawn` under a
  planted compiled-shape `process.argv` — asserting the spawned vector
  `[execPath, "_lane", …]` with no `/$bunfs` component for the child to
  misparse. A real compiled-binary e2e is out of the suite (compiling in a
  test costs the budget and the cross-platform environment; the compiled
  reality was measured by the register's probe and the vector pin covers
  the derivation).

Named residual: the detection covers Bun's own compile shape (the only
packaged form this family ships); a hypothetical non-Bun packaging that
mangles argv[1] differently is not detected — that would be a packaging
fact, and P16 bars encoding one before it exists.

## D2 — the rider admits driver-state files outside every LIVE scope; the sibling's completion lands in its own commit (0165-084)

The defect: the doc-lane decorator's queued commit core adds to a live
unit's commit "the dirty driver-exclusive state files" —
`dirty.filter((rel) => driverStateFile(rel) && !withinScopes(rel, scope))`
— excluding only the unit's OWN scope. A sibling lane's `markDone` rename
(`docs/T-B/todo.md` → `done.md`, inside the sibling's own live scope) is a
driver-state file outside this unit's scope, so whichever unit's queued
commit runs in the window lands the sibling's completion under its own
`Auto-Task`/`Auto-Stage` trailers. The measured window is real: `runTask`'s
close-out awaits the rename, then an agent round-trip, before the unit's
own commit enqueues. 0099 stage B's letter birthed the rider for the index
tick ("the close-out's index tick rides the unit's own commit exactly as
the serial world's done commit does, dm-glm's measured shape") — the tick,
a driver write OUTSIDE every doc scope; 0099 D8 names only the tick as the
shared committed write. The enactment's predicate was wider than its
letter.

The ruling (**P18** — machine-addressable history: a unit's completion is
recorded under its own trailer key, and trailer-keyed readers (fork's
corpus bounds, the task-usage studies, a person's `git log --grep 'T-002
done'`) must not misattribute it; **P4** — git history is the audit trail;
**P17** — the sibling's scope is the sibling's: one sole writer per
declared scope, its close-out commit its own): the rider admits a dirty
driver-state file only **outside every live scope** — the unit's own ∪ the
live siblings'. The sibling's rename then stays dirty through this unit's
commit and lands in the sibling's own queued close-out commit (its
effective scope contains it), under its own trailers, in its terminal
`done` shape — the serial world's attribution restored.

- The index tick keeps riding whichever unit's commit lands first
  (0099 D8's shared-write posture, unchanged): the phase index lives
  outside every doc scope, so no live-scope exclusion ever touches it.
- A *dead* unit's leftover state-file rename (no live scope holds it)
  still rides the rider — 0021's carryover family posture (an interrupted
  driver close of another task heals through the next `beginUnit`'s
  carryover), deliberately unchanged; restoring it here would destroy a
  legitimate driver write (P20).
- The afterSession close-out check already tolerates the sibling's in-transit
  driver-state dirt (its exclude list adds `dirty.filter(driverStateFile)`)
  — with the rider narrowed, that tolerance is what keeps the sibling's
  rename from *blocking* this unit's close-out while it waits for its own
  commit; both halves now say the same thing.
- Premise: 0099 stage B's rider letter ("plus the dirty driver-exclusive
  state files", unqualified) is restated — outside every live scope; the
  decorator's comment corrected with it; INDEX row annotated.

## D3 — loop-task's stated truths: the boundary comments, the stream merge title, the doc loop's wait-between key, the repair round's budget (0165-185)

Five items the register enumerated; one is already dead — the park arm's
"the boundary hooks run at the next unit" comment was killed by 0211 D2
(verified at HEAD: the park arm now runs `closeOutAudit` and `taskBoundary`
at its own landing, its comment true). The live remainder:

**(a) The "stops scheduling and drains" comment family (P8/P15 — the
comment is the first carrier of design, and a reader told the parent drains
on a step pause is told wrong).** Three sites claim a step pause "stops
scheduling" (the isolation loop's landing, the scheduler loop's header, the
scheduler landing). The truth of `taskBoundary`: the **step pause** waits
for Enter *at* the landing — scheduling resumes after; only the **/exit**
stops dispatching (the probe form records the label and takes effect —
throws — after the last lane lands; the plain form's checkpoint throws at
the boundary). All three comments restated to that truth; the /exit halves
of the same sentences were already true and stay.

**(b) A stream unit's repair-merge title (the owning task's document —
0156 D3's own pattern).** `runLaneUnit`'s merge-instruction block reads the
title off `taskStatePaths(unit)` — for a stream unit `T-NNN.S<nn>` that is
the never-existing `docs/T-NNN.S<nn>/{done,todo}.md` (the same
never-existing path 0156 D3 found in `laneReportOf`), so both reads fail,
`parseUnitDoc("")` yields no title, and the merge commit's subject falls
back to the bare unit id ("T-001.S01 merge repair T-001.S01" — a degraded
subject). The fix: read the OWNING task's document
(`streamUnitOf(unit)?.task ?? unit`) — the task's `# T-NNN: title` line,
the same owning-task rule 0156 D3 ruled for the phase field (a stream's own
S<nn>/ files carry no task-level grammar; the title belongs to the task
document). Pre-routing there is still no plan to read a title from, so the
document read stands; the comment beside it states the stream shape.

**(c) The doc loop's wait-between keys on `ctx.ran` like its siblings
(P5 — one home for the "did anything run before this landing" fact, the
field whose own declaration comment says exactly this: "it decides whether
--wait-between pauses before the first task of a later phase; demoting it
to a function local would zero it on every call").** The doc loop's pause
was keyed on a per-invocation `landings` local — zeroed at every
`runDocLaneLoop` call, so a later phase's first doc landing never paused,
where the serial loop (`ctx.ran > 0`) and the lane loop (`firstLanding =
ctx.ran === 0` captured at the landing) key on the run-accumulated counter
and pause across the phase boundary. The fix: the pause keys on
`ctx.ran > 1` at the landing (this landing's own increment already inside —
the doc world's increments happen in the pipelines, not the landing
continuations): the first landing of the run never pauses, every later
landing pauses — the siblings' rule. The `landings` local is retired
(P5 — no dead state). Named residual, stated honestly: under doc
concurrency the pause may fire after the run's first landing when a
sibling's pipeline already completed behind the mutex (its work committed,
only its landing bookkeeping pending) — still a pause *between landings*,
and the same `ctx.ran` caliber the siblings use (it counts units run,
repair rounds and the flatten's driven leftovers included).

**(d) A repair round consumes budget only when it opens (P12's calibration
— a wrong value silently changing behavior; 0079 §4's "each round consumes
budget" means a round that opened).** `repairRoundAppend`'s task site
bumped `ctx.repairs` *before* `closeUnit` — a refused close (a dirty tree,
a cascade refusal, an unlisted id) logged "blocking as usual" with the
round spent, silently shrinking the next FAIL's budget. The fix: the round
number is derived (`ctx.repairs + 1`) for the reason string and the
close's records, and the counter takes it only once `closeUnit` closed —
the header's own invariant ("the round number exists only once the counter
bumped") kept: the number the evidence quotes is the number the counter
holds when the round opens. The gate sites (regression/verdict) keep their
unconditional bump — nothing can fail between their budget check and the
round's opening.

Derives: **P12** (D1 — a launcher that cannot re-invoke the shipped binary
and relays a line pointing at the person's command line; D3d — a budget
consumed by a round that never opened is a wrong value silently shrinking
the next), **P14** (D1 — the fix lives in the core's own profile seam, no
shell named; the sharing-half decline), **P16** (D1 — the one encoded fact
is structural, the `$bunfs` virtual-entry prefix; the non-Bun packaging
residual named), **P10** (D1's source-layout and override floors; D3c's
first-landing floor), **P18** (D2 — the completion recorded under its own
trailer key), **P4** (D2 — history as the audit trail), **P17** (D2 — one
sole writer per declared scope), **P5** (D2 — the rider's one admission
rule beside the guard's own sibling set; D3c — the `landings` local
retired, `ctx.ran` the one home), **P8/P15** (D3a — every comment states
the behavior the code has; D2's comment corrected with its rule),
**P19** (every defect measured: the register's compiled-binary repro, the
rider's interleaving repro, the merge-subject fallback, the cross-phase
pause, the budget shrink — each pinned red on pre-fix source in this
change), **P6** (D1 — the derivation reads the process shape, persists
nothing), **P20** (D2 — the dead sibling's leftover deliberately
untouched). Amends: none — 0099's stage-B rider letter is restated through
the premise guard below, its INDEX row annotated (as 0207 D1 did for D4's
pathspec premise); 0068 §6.4 D2's "re-invoke this shell's CLI" holds in
both shapes (the compiled binary re-invokes itself). Tier touched:
**mechanism** — core only (`src/shell.ts` is the core's seam; no shell
package source changes).

## Category scope (0123 D1's discipline)

Family: *the lane machinery's spawn, commit and loop surfaces.* Home-set:

| home | disposition |
|---|---|
| `src/shell.ts` (D1 the `selfInvoke` derivation + `defaultLaneLauncher` through it; the launcher's comment restated over both shapes) | changed |
| `src/git-ops.ts` (D2 the rider's sibling-scope exclusion; the rider comment restated) | changed |
| `src/loop-task.ts` (D3a the three boundary comments; D3b the merge title's owning-task read + comment; D3c the pause keyed on `ctx.ran`, the `landings` local retired; D3d the bump after the close) | changed |
| `test/shell.test.ts` (D1 the shape pins + the launcher-assembly pin) | changed |
| `test/doc-lanes.test.ts` (D2 the sibling-sweep pin, the finding's repro scene) | changed |
| `test/lanes-scheduler.test.ts` (D3b the stream merge-subject pin over a real worktree) | changed |
| `test/agent-fake.test.ts` (D3c the cross-phase pause pin + the first-landing floor) | changed |
| `test/repair-loop.test.ts` (D3d the refused-close budget pin + the opened-round floor) | changed |
| `plans/INDEX.md` (this row; 0099's row annotated) | changed |
| `AGENTS.md` (the navigation lines restated: the launcher's both shapes, the rider's live-scope rule) | changed |
| `docs/structure.md` (the shell-profile row's launcher note) | changed |
| The spawn census ratchet (`test/spawn-census.test.ts` — `process.execPath` still the launcher's command), the shells' own sources, the templates | held, untouched |

## Premise guard

`premises this ruling changes: 0099 stage B's rider letter` (the decorator's
admission predicate — "plus the dirty driver-exclusive state files"
unqualified; now outside every live scope; 0099's INDEX row annotated in
this change, the decorator's comment corrected with it). Re-read standing:
0068 §6.4 D2 (the launcher's letter — "re-invoke this shell's CLI with the
hidden lane subcommand" holds in both shapes; the old *enactment's* premise
— argv[1] is a spawnable entry — is what D1 corrects, in `src/shell.ts`'s
own comment), 0099 D8 (the shared write — the tick still rides, now the
rider's only shared shape), 0021's carryover posture (the dead sibling's
leftover untouched), 0156 D3 (the owning-task document rule — D3b extends
its pattern to the merge subject), 0079 §4 (the budget's letter — D3d
enacts "each round consumes budget" as *opened* rounds), 0143/0068 D11 (the
boundary comments' /exit halves — the probe form's drain rule, already
true). Step 051's 0211 D2 verified as landed before this step (the park
comment dead, `closeOutAudit`/`taskBoundary` at the park and repair arms).

## Named residuals

D1: the non-Bun packaging shape undetected (P16 — named above); the real
compiled-binary e2e out of the suite (the vector pin the coverage). D2: the
dead sibling's leftover rename still riding the rider (0021's posture,
deliberate); the tick's first-commit riding (0099 D8, standing). D3b: a
stream whose owning task's document is absent at both paths falls back to
the bare unit id (today's shape — the document exists by construction when
a stream unit is dispatchable). D3c: the concurrency artifact (the pause
may fire after the first landing when a sibling's completed pipeline waits
behind the mutex — between landings in the doc world's own terms, the
`ctx.ran` caliber stated). D3d: a closeUnit *failure* (as opposed to
refusal) after the writes started consumes its round — the close's own
partial state is the person's recovery surface (0207 D2's family), not the
budget's.

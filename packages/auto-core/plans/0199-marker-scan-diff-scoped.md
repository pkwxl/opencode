# 0199 — The proxy-answer scan reads the session's added lines, and the verify FAIL return consumes its own dead marker

Status: **active**. Ruled 2026-11-07 by 0166 step 039 (wave W7-verify), enacting 0165-109
(S11-07, S3, CONFIRMED — `collectAgentResolves` reads every marker in each changed file, not
the session's diff: the dedup key is `source + task + question`, so a later task touching a
file that already carries committed markers re-books the earlier task's AUTO-RESOLVE as its
own and inflates its AUTO-DECISION count — the ⚑ highlight tells the person a task
proxy-answered questions it never saw, and the phase/round counts grow with every re-edit of a
long-lived document; the module's own counting premise, "each scan sees only this session's
uncommitted changes", was stated at file granularity and is false at line granularity) and
0165-111 (S11-10, CONFIRMED — 0142's dead-marker consumption skips the verify FAIL return:
a verify session's unservable `tmp/test.sh` survives into the fix round, is read as wiring by
every fix session of the round, and the round's close then blocks **naming the fix session**
for a request the fix session never made — 0156 D8's declination "the FAIL paths are unchanged
(their fix-round close already consumes and blocks)" forgot that consuming at the wrong scope
both leaks the wiring into the round and blames the wrong session).

## D1 — the scan's unit is the session's added lines

**The defect.** The scan's input was `changedFiles(dir)` — the *files* with uncommitted
changes — followed by a whole-file line scan. In committed mode (the only mode: committing
cannot be turned off, afterSession commits right after scanning) a later session that edits a
file re-reads every line earlier sessions committed into it. The ledger's dedup key
(`source + task + question`) absorbs only same-task re-sees; a marker committed under T-001
and re-seen during T-002's scan is a **new item** under T-002, and the per-task AUTO-DECISION
count has no line-level dedup at all. The repro (S11-07): T-001 commits one AUTO-RESOLVE and
two AUTO-DECISION lines in docs/design.md; T-002 appends an unrelated paragraph to the same
file; T-002's scan returns `{resolves: 1, decisions: 2}` and books the v1 wire-format question
under T-002.

**The rule.** The scan's unit is the **added line**, not the changed file: what a session
proxy-answered is what that session *wrote*, and the marker grammar (0020 §D) is a line
grammar, so the driver can scope its collection mechanically — `git diff HEAD -U0` over the
same repository traversal `changedFiles` uses (repoRoots, nested repositories included),
plus the untracked files whole ("all": beginUnit's clean start makes untracked mean this
unit's own new write — every line of it added). New in `src/git.ts` (the git plumbing home,
0020 §N's own placement of the scan's repository traversal): `addedLines(dir)` → a map from
target-relative path to its added line numbers (or `"all"`). `collectAgentResolves` scans
exactly those line numbers; the item's `file` field keeps its `<path>:<line>` spelling, the
line now proven to be one this session added.

Selection is mechanical (P7): the diff's line numbers, never a judgment about which markers
"belong" to a session — a session that *edits* a committed marker line (new question text)
books the edited line, which is correct: the session made a new decision statement; a session
that only touches neighboring lines books nothing.

**The floors.** A non-git directory returns an empty map (unchanged no-op). Every shape whose
changed files are untracked — the whole existing suite — scans whole files, byte-identical.
A repository whose HEAD does not resolve (unborn) falls back to whole-file for its tracked
entries: nothing committed exists there, so whole-file *is* the added-lines truth, not a
degrade; a failed diff read over a repository with commits keeps today's whole-file behavior
for that repository (the anomaly floor — the scan is best-effort auditing, 0020 §F: a lost
read never affects flow or exit code, and the ledger tolerates restart, §K-6). The dryrun
accumulation boundary stands, transposed: dryrun skips the commits, so the diff against HEAD
grows across a run's sessions and later sessions re-see earlier ones' lines — the exact shape
0020 §K-10 accepted for the removed `--commit false`, on the only no-commit world left (the
AUTO-RESOLVE side still absorbed by the same-task dedup key, the count side still inflated;
a gut-feel indicator, never a source of truth).

**What stands.** The ledger schema, the dedup key, `sameIssue` pairing, the charter clamp's
inputs (`pendingClampItems` iterates agent items with a `file` — its locator already
content-proven by 0198 D2, so a re-booked item could no longer rewrite a neighbor's marker
even without this change; this change removes the re-booked item itself), the highlight
lines, the decisions map and its caps: all verbatim. `changedFiles` and `untrackedFiles`
stand unchanged for their own consumers.

## D2 — the verify FAIL return consumes its own dead marker

**The defect.** `verifySession`'s FAIL return commits the gap list and returns without
consuming `tmp/test.sh`. A verify session that wrote the marker on FAIL (the T-058 shape:
it read the task's gap list or document naming the driver-test protocol) hands the whole fix
round a dead marker to read as wiring — the exact harm 0142 D1 was ruled against ("left on
disk it reads as wiring to every later session") — and the round's close (0142 D2) then
blocks with "the fix session of T-001 (round N) ended with a driver-test request pending":
a false attribution (the fix session made no request), so the person investigates the wrong
session, and a possibly-successful round turns into an exit-2 block.

**The rule.** The verify session's **own close consumes on the FAIL return too**, through
the same `consumeDeadTestMarker` seam, same label shape as the PASS site (`task.id` —
attributed to this task, the log line already teaching which side of the channel is off and
what was consumed): consume + log, no block — the FAIL verdict is already rendered, the
round's own close remains the judge of **its own sessions'** markers. The fix round inherits
a clean workdir; if a fix session then writes its own marker, the round's close blocks on it
correctly attributed (0142 D2 unchanged). 0156 D8's declination is amended: its reasoning
("their fix-round close already consumes and blocks") held only the consumption half true —
the block fires at the wrong scope, over the wrong session's request.

**The floors.** The channel-on world (a code-work phase under `--test-by-driver`) is
untouched — `consumeDeadTestMarker` no-ops there. The wrap-up entry consume (0142 D1), the
exec close and the fix round's close stand verbatim; the PASS site stands; the FAIL return's
stop paths (a blocked exit, a commit failure) still return without consuming — the re-run's
wrap-up entry consume owns that stale marker, the standing-project shape.

## Derives

Derives: **P2** (the person brackets every boundary; their decisions are never consumed
silently — the showing, D1: the ⚑ highlight and the phase/round counts are the person's
review surface for proxied decisions ("AUTO-RESOLVE defaults are recorded and
charter-clamped, never consumed as closed" rides this ledger); an entry the task never made
is noise that drowns the real ones — the surface must carry only decisions that task
actually took) — D1. **P7** (grammars, never content — D1's scoping is the diff's own line
numbers, a mechanical grammar; the alternative remedy (deduping agent items by `file +
question` across tasks) was declined because it keys on line numbers that drift with every
edit above the marker — a fragile heuristic where a mechanical truth exists) — D1.
**P8** (every surfaced line teaches its remedy — D2: the ⚠ consume line and the 0142 D2
block are teaching surfaces; a block that names the fix session for the verify session's
request teaches the person to investigate a session that made no request, and the dead
marker left through the round reads as wiring to every fix session it dispatches) — D2.
**P12** (fail loud, conservative under uncertainty — D2's misattributed block is a false
verdict direction; D1's anomaly floors resolve toward today's behavior on a failed read and
toward the diff's own truth on the ruled path, never toward a heuristic guess) — both.
Tier: operating — no Tier I statement changes.

premises this ruling changes: **0020 §F** (the scan-scope sentence "takes uncommitted
changed files … line-by-line regex" — the unit becomes the added lines of those files; the
repository traversal, the size/binary skips and the collection hook stand) and **0020
§K-10** (the counting premise "each scan sees only this session's uncommitted changes" —
now enforced at line granularity; the accepted-boundary clause transposes from the removed
`--commit false` to dryrun, the only no-commit world left); **0156 D8** (the FAIL-path
declination "The FAIL paths are unchanged (their fix-round close already consumes and
blocks)" — the FAIL return now consumes its own marker before the fix round; the PASS site,
the entry consume and the fix-round close stand).

Re-readings: 0142 D1 stands and is honored further (its own direction — consumed at every
scope's close — gains the site its rule already implied; the wrap-up entry, exec close and
fix-round consume unchanged); 0142 D2 stands verbatim (the round's close, its block message,
its unbooked-round rewind — now firing only over its own sessions' markers); 0082 D12 stands
(the clamp iterates `pendingClampItems`; with D1 the item set is the session's own markers,
and 0198 D2 already content-proves the locator); 0198 D1/D2 untouched (different surfaces of
the same wave).

## Category scope (0123 D1's discipline)

Two families, one change:

- **D1 — the proxy-answer marker scan (0020's family).** Code homes: `src/git.ts`
  (`addedLines` — new, additive, the git plumbing home 0020 §N already chose for the scan's
  repository traversal), `src/resolve.ts` (`collectAgentResolves` over the added lines; the
  module header's counting-premise comments and `addDecisions`' §K comment restated),
  `src/git-ops.ts` (`collectSessionMarks`' scan-scope comment restated — no behavior change
  there). Test homes: `test/resolve.test.ts` (the committed re-booking pin — a later task's
  unrelated edit books nothing; the added-marker pin — a marker line added to a tracked file
  is booked with its line number; the existing untracked-file pins byte-identical).
  Vocabulary: none changed — the marker grammar, the ledger schema, the dedup key and every
  highlight line verbatim (P13 untripped).
- **D2 — the dead-marker consumption on the verify FAIL path (0142's family).** Code homes:
  `src/wrapup.ts` (`verifySession`'s FAIL return consume; the PASS-site comment's false last
  sentence restated). Test homes: `test/verify-loop.test.ts` (the FAIL-path consumption pin —
  the marker gone before the fix round dispatches, the ⚠ line attributing to this task; the
  fix-round block pin unchanged, green as-is). Vocabulary: none changed — the ⚠ line rides
  `consumeDeadTestMarker` verbatim.

## Residuals

- The dryrun accumulation (D1's floor): under dryrun the diff against HEAD grows across the
  run's sessions — 0020 §K-10's accepted boundary transposed; not reopened here.
- The anomaly floor (D1): a failed diff read over a repository with commits keeps the
  whole-file scan for that repository — today's behavior, never a silent empty (the
  fallback is whole-file, not nothing).
- The requireArtifact bypass sessions (formulation, knowledge, handover distill — S11-10's
  family note) still never consume a dead marker themselves; their marker reaches the next
  exec close or wrap-up entry under the next task's name — the seam recorded in the finding,
  outside this step's ruled scope (no measured incident; P21).

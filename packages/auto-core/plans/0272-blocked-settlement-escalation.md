# 0272 — The blocked settlement escalation letter

Status: **fix ruling, 2026-11-20.** [0262](0262-executor-preview-second-findings.md)
finding 03's remedy family enacted — the blocked settlement escalation
letter — the [protocol completion program](0267-protocol-completion-program.md)
docket's 0272 slice. The finding's measured shape: T-004's verify settlement
answered `blocked / commitFailed / "Verification must write one valid PASS
report or one countable FAIL gap list."` — a remedy for the wrong diagnosis —
while the actual cause sat outside the child's write perimeter (`.gitignore`,
fenced from it by the same contract); the person channel was reached only
because the verify child raised `d17366a8` on its own judgment, nothing in
the response named a ladder, and no replay could ever succeed. The design
residual the finding left open — "which blocked causes are
replayable-by-holder (keep teaching the replay) vs person-necessary
(auto-raise) — a small classification letter, not new machinery" — is ruled
below, as one classification table over every cause the report settlement
produces today.

Derives P2 (the bounded escalation terminating at the person: the holder's
blocked report was already honest — the raise is the coordinator's act at
the blocked verdict, the person's bracket the missing half; the escalation
rides a channel that already terminates at a person decision, and the
holder's own further claims hold at the standing asker wait while the item
is pending — the loop bounded, never self-consuming), P5 (one home: the
classification derived from exactly the tables the fence and the catalog
already read — `standingRefusal`/`permitted`/`driverExclusive` — never a
second hand-maintained list; the pending-question dedup predicate extracted
into the one named home `findPendingQuestion()` that the holder's own
`question` route and the settlement's raise both read; the internal
`escalated` marker read by exactly one wire boundary, `settle()`'s wrapper),
P7 (mechanical, never content judgment: the arm decided by cause site
through the never-set tables, and for the path-shaped causes at runtime
through `neverSetRows()` — every offending path refused for every grant
kind — never by reading anyone's intent; the raised item's text a fixed
template over the cause's own detail and the step's identity, never
authored content), P8 (every blocked line teaching its remedy: the replay
arm's detail already teaches the holder's own remedy — that arm's ladder,
pinned; the escalated arm's detail naming which ladder applies, the item
raised, and that retrying cannot fix the cause), P10 (the floor: a holder
who can fix the cause itself gets exactly today's blocked answer — no
raise, no new shape, no field — pinned byte-identical; a mixed
path-shaped cause at the boundary reads replay-side), P12 (conservative
under uncertainty: the classification's boundary goes replay-side; blocked
never silently retried past the person — the escalation is fail-loud at
exactly the verdicts no permitted write can move), P13 (the vocabulary
ruling below: no new wire field, the frozen `reason` words untouched, the
ladder named inside `detail` — rendering, not vocabulary), P19 (the
finding's measured chain the basis: the unbounded retry loop over a cause
the holder could never fix, the person reached by accident; the composition
measured against the two freshest letters — 0269's catalog supplying the
never-set rendering's own source, 0271's `menu.pending` the read surface
the raised item becomes visible on), and P20 (in-flight work never
destroyed: the blocked evidence kept — the booking stands, the holder's
untracked share survives the person's world repair, the retry landing it;
nothing here rolls anything back). Amends none — 0248 D5's settlement
letters, 0250's channel and 0246's envelope all stand exactly as written,
this ruling reading each (the premise guard below).

## Category scope

Tier: mechanism — code home and test home in this change (0110 D13): the
classification marker, the never-set derivation and the raise in
`src/executor-coordinator.ts` (the settlement's sites, the wrapper, the
dedup home); test homes `test/executor-steps.test.ts` (the arms, the
boundary, the floor, the closed loop) and `test/manual-prompts-ratchet.test.ts`
(the executor.md coupling arm); the teaching `prompts/executor.md` (one
clause); no auto-server change — the worker passes the blocked response
through untouched, the wire shape unchanged.

Premises this ruling changes: none. Re-read in this change: **0262**
(finding 03 — stands as measured; its remedy family's "or at minimum the
detail names the escalation ladder" both halves enacted, the raise the
primary), **0250** (the person settlement — the raise reuses the channel
whole: the durable records, the dedup-while-pending by asker/task/text, the
issuance order, the answer's delivery through the brief machinery; the
route's live-pair guard is the holder-initiated entry's own and stands —
the settlement's raise is the coordinator's entry at a verdict over a
report already accepted for settlement, the asker the authenticated
reporting holder, so a holder could not obtain this raise for a lease it
does not own), **0267** (the docket's 0272 row — "causes outside the
holder's permitted set auto-raising the question item through the existing
channel, replayable-by-holder causes keeping the replay teaching, every
blocked answer naming the ladder" — enacted exactly), and **0248 D5's
settlement letters** (the landing-time path check — its driver-exclusive
arm already rules the remedy "the person resolves the tree," a letter the
flattened detail string had stopped distinguishing; this ruling restores
the distinction mechanically through the same never-set D5 names, the
out-of-scope-but-unconflicting arm's ride-to-verify letter untouched). All
stand.

## The ruling

### The classification table

Every blocked cause the report settlement produces today — `settle()`'s
body, its `finishShare`/`closeVerified` arms, and the worktree machinery's
`ExecutorWorktreeError` renderings — classified by one mechanical test:
would the remedy require a write the holder's grant kind cannot make?
Git ground truth (history, HEAD, the index — the catalog's frozen
`git: "coordinator-only"` letter), the never-set (`standingRefusal`'s own
table: the driver workdir roots, the config directory, every `AGENTS.md`
segment, `driverExclusive`'s documents), driver state, and the worktree's
own machinery are outside every grant's permitted set — those causes are
**person-necessary** and auto-raise. Causes whose remedy is a write inside
the holder's own permitted set — its own artifact, its own uncommitted
edit — are **replayable** and keep today's answer byte-identical.

| Cause (the blocked detail) | Arm | Why |
|---|---|---|
| "Main HEAD moved outside the executor's settled shares. Inspect the retained lane before retrying." | person | git history |
| "The lane share no longer matches the booked landing." | person | git history |
| "HEAD moved outside the booked share. Inspect the commit and executor progress before resuming." | person | git history |
| "HEAD moved outside the executor's settled shares." | person | git history |
| "HEAD moved outside the booked task close-out." | person | git history |
| "The landed fix input is missing from Git." | person | git history |
| "Git status is unreadable. Inspect the index before replaying." (`commitFailed`) | person | git index state |
| "Git status is unreadable after retiring the gap list." (`commitFailed`) | person | git index state |
| "The staged tree contains an unverified path. Inspect the index before replaying." | person | the index — staging is the coordinator's alone |
| "The new commit differs from the booked share. Inspect Git history before resuming." | person | git witness |
| "The dependency park record changed outside the booked share." | person | driver state (`.auto/`, the never-set) |
| "A close-out has no verification grant." | person | protocol invariant — no holder write fixes it |
| "The task documents no longer match the close-out's before or after state." | person | `driverExclusive` documents — the remedy a driver write |
| "The staged task close-out differs from the expected rename and tick." | person | the coordinator's own staging — a mismatch is interference |
| "The staged task documents differ from the expected rename and tick." | person | same |
| "The task close-out commit differs from its booked changes." | person | git witness |
| every `ExecutorWorktreeError` rendering (open, prepare, land, remove) | person | the worktree's machinery state — existence and lifecycle, never a path inside a checkout |
| "Resolve out-of-scope edits before replaying: \<paths\>." | **derived at runtime** | `neverSetRows()`: every offending path in the never-set → person (0248 D5's own letter — the out-of-contract writes the person's to resolve); otherwise replay |
| "Inspect unexpected workspace changes before replaying task close-out." | **derived at runtime** | the same `neverSetRows()` over the unexpected rows |
| "Unexpected workspace changes appeared during task close-out." | **derived at runtime** | the same |
| "The executor requires a single repository inside a lane checkout." | replay | the holder removes its own leftover nested repository inside its own checkout (0258's lane letter) |
| "The parked task is outside the current phase." (`commitFailed`) | replay | the holder's own handoff |
| the park-check problems / foreign blocker (`commitFailed`) | replay | the holder's own handoff |
| "The handoff needs a recognized Status line for this step." (`commitFailed`) | replay | the holder's own handoff |
| "Verification must write one valid PASS report or one countable FAIL gap list." (`commitFailed`) | replay | the remedy the fence itself names is the holder's own artifact (report/gaps — verify's permitted set) |
| "The booked fix's changes are missing. Restore them before replaying." (all three sites) | replay | the holder restores its own edits |
| "The share's landing anchors the target repository's own commit; … Include a top-repository path such as the unit's handoff." | replay | the holder's own handoff |
| "The workspace no longer matches the booked share. Restore its contents / them before replaying." (both sites) | replay | the holder restores its own edits |
| "The staged fix must include work and retire the previous gap list." | replay | the holder's own changes' shape |
| "The staged verdict or handoff differs from the evidence read on disk." | replay | the holder's own artifact |
| the hooked commit's `commitFailed` (git's own stderr) | replay | freeform git output admits no mechanical table reading; the boundary reads conservative (P12) |

The two freeform-stderr rows are the recorded edge of the mechanical rule:
a commit that fails for identity, hook or fsck reasons is often
person-necessary, but the detail carries no table-readable shape, and
guessing would escalate on holder-fixable hook rejections — the boundary
goes replay-side (P12), the residual named below. The claim-time blocked
shapes (the admission and preview arms, `attemptsExhausted`, the
brief-size config block) and `settleGate`'s blocked answers are outside
this letter's scope: the finding is the *report settlement's* loop, and
the gate settlement's blocked answers return to the person channel that
already brackets them (the worker-claim exposure riding the same
inspection teaching).

### The raise: mechanics, provenance, dedup

When the wrapper sees an `escalated` block it raises one question item
through the standing 0250 channel — no second channel, no new record
shape: the same `Question` records in `.auto/executor-questions.json`,
the same shared issuance order (`position: questions.length + gates.length`),
the same rendering on 0271's `menu.pending` and the same person claim and
answer routes.

- **Provenance**: the asker is the reporting holder (token and channel —
  the report authenticated the identity; the answer returns to the same
  holder's briefs through `applicableAnswers`, which is why the asker
  cannot be a coordinator identity), the task the grant's own unit (the
  answer task-scoped to the unit the settlement was for), and the raise's
  identity mechanical in the text — the fixed template names the
  settlement's raise, so no record field is added (P13's least; a
  `raisedBy` record field declined, P21 — no consumer reads it: the person
  reads the text, the holder the blocked answer's ladder clause, the wire
  nothing new).
- **Text**: `Executor step <grant.id> blocked (<reason>): <detail> The
  cause is outside the lease's permitted writes; a person decision is
  required.` — the cause's own detail plus the step's identity, a fixed
  template, never authored content (P7).
- **Dedup**: the standing dedup-while-pending — same asker, task and
  exact text, while the item is unanswered. The outside family's details
  are fixed strings per cause site (the worktree errors' messages
  deterministic per state), so a retrying holder's repeated blocked
  reports raise one item, not many — pinned across both settlement
  entries (the report replay and a successor claim's settle, which route
  through the same wrapper). After an answer, a still-blocked retry
  re-raises as a new item: 0250's own letter ("a retry after settlement
  can raise the same text as a new question") — each answer one person
  bracket, the re-raise the honest report that the remedy did not land.
- **The guards**: 0250's task-scoped raise requires the holder to own the
  live step/lease pair — the holder-initiated *route's* guard, standing
  unchanged. The settlement's raise is the coordinator's entry: the
  report was already accepted for settlement (the booking exists), so
  there is no live pair to guard and no holder can obtain this raise for
  a lease it does not own — the raise fires on the holder whose booking
  blocked, at most one pending item per cause text per task.
- **The holder's own holds**: while the item is pending the holder's
  claims read the standing asker wait (`"Your question is awaiting an
  answer."`) once the blocked booking has settled or been superseded;
  while it pends settlement the claim path replays the settlement (the
  standing `in-flight` letter), the raise deduplicating through the same
  wrapper. Both holds are standing select() behavior, unchanged here.

### The ladder naming and the vocabulary ruling

Every blocked answer names its ladder. The replay arm's detail already
teaches the holder's own remedy — "Resolve … before replaying", "Restore
them", "write one valid PASS report", "Include a top-repository path" —
that teaching *is* that arm's ladder naming, verified across the table and
pinned byte-identical (P10). The escalated arm's detail grows one fixed
clause: `<detail> The cause is outside this lease's permitted writes;
question <id> is raised for a person decision — retrying cannot fix it.`
— which arm applies, the item raised with its id, and the stop-retry
teaching.

**The vocabulary ruling**: no new wire field. The blocked response's
`reason` vocabulary (`isolation` | `commitFailed`) is frozen untouched; an
additive `escalated` marker or a raised-item id field on the response was
considered and declined — the least vocabulary change is none: the
classification marker (`escalated?: true` on the internal
`SettlementBlocked` type) never leaves the coordinator (the wrapper strips
it — the worker's passthrough and the e2e's pinned wire shapes unchanged),
the ladder and the item id ride inside `detail`, which is rendering (the
standing details already interpolate paths and deadlines), and the item's
mechanical read surface is 0271's `menu.pending`, already carried and
already split by authority. Growing `detail` strings is rendering; new
`reason` words would be vocabulary — this change adds none.

### The composition

The raised item is an ordinary question item, so the standing surfaces
compose with no change: `menu.pending` lists it (`{ kind, id }` for every
reader, its text and task for a channel `questionAuthority` admits —
0271's split, one home); the person claim routes offer it
(`claimPerson`/`claimQuestion`); the answer settles once with provenance
preserved; and the holder's subsequent brief for the task carries the
answer through the standing `answerCursor` machinery — `withAnswers()`
renders it into the next grant's prompt for the same unit (a continuation
grant, a fix round, a later attempt), `briefAnswers` paging it. One
honest gap named rather than papered: `brief()` requires a *live* lease,
and a blocked settlement's entry is booked, so the answer cannot reach
the holder through a brief refresh while the block stands — it arrives on
the first grant the holder receives for the task after the world allows
progress (the closed-loop test pins exactly this: blocked → raised →
answered → the person repairs the world → the retry lands → the
continuation grant's prompt carries the answer). person.md needs nothing:
the item arrives through the standing question surface its `On question`
bullet already teaches; the 0271 arm's pending-listing sentence covers its
read side. executor.md's settlement paragraph gains one clause — a
`blocked` remedy naming a raised question puts the cause outside the
lease's permitted writes: do not retry it; the person holds the item, and
its answer returns with a later brief for the task — pinned by the
ratchet's new coupling arm beside the producer's anchors.

### Declined here

A new write route for the holder (the holder "fixing" a never-set path or
git state under a widened grant — the write contract is the fence's whole
point; the person's bracket is the remedy, P2/P7); any auto-fix or
auto-repair of outside causes by the coordinator (the coordinator judges
and commits, but rewriting history, driver documents or a person's edit on
a settlement's own initiative destroys in-flight work and the evidence —
P20; the person's answer is the authority for what happens next);
auto-raising on the replay arm (the holder can fix it — an item per
holder mistake would drown the person, P8's remedy-teaching half);
settleGate's blocked answers joining the raise (the gate settlement's
bracket is already person-side — its blocked answers return to the person
claimant); a `raisedBy` provenance field on the question record (no
consumer, P21); a dedicated escalation wire field (the vocabulary ruling
above — rendering is the least); and auto-raising on the freeform
commit-stderr arm (no mechanical reading exists; the boundary reads
replay-side, P12 — the residual below).

## Residuals

- The hooked commit's `commitFailed` (git's own stderr) stays replay-side:
  a person-necessary commit failure there loops on today's teaching until
  the holder's own question or the operator intervenes — the price of the
  conservative boundary, measured acceptable against escalating on
  holder-fixable hook rejections.
- The re-raise after an answer: a retry that still blocks raises a fresh
  item per 0250's dedup-while-pending letter — one person bracket per
  answer cycle, by design.
- The runtime never-set derivation names only the paths the cause carries:
  the close-out arms' fixed prose names no paths in the detail, so a
  person reading the raised item learns the cause class from the template
  and the offending paths from the coordinator state, not the item text.

## Companion changes and verification

The INDEX row; the AGENTS.md executor-leases navigation line's 0272
pointer. Test evidence: `test/executor-steps.test.ts`'s three new tests —
the outside arm (the raise, the ladder-named detail verbatim, the item's
provenance and mechanical text, `menu.pending`'s existence and
authority-split arms, the dedup holding across the report replay and a
successor claim's settle), the replay floor and boundary (the
out-of-scope edit byte-identical, the mixed never-set-plus-own-edit cause
byte-identical with nothing raised, the never-set-alone escalation
emerging once the holder's own edit is gone), and the closed loop (blocked
→ raised → the person answers → the world repaired → the retry lands →
the continuation grant's prompt carrying the answer) — beside the standing
suite green; the ratchet's new executor.md coupling arm (the file at 39
tests). auto-core full suite 3479 across 171 files, typecheck exit 0;
auto-server untouched — 206 pass beside the container's pre-existing
IPv6-bind failure, failing on the committed tree identically (0265's
record), typecheck exit 0.

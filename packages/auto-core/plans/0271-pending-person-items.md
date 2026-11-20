# 0271 — Pending person items on the read surface

Status: **fix ruling, 2026-11-20.** [0262](0262-executor-preview-second-findings.md)
finding 04's remedy family enacted — pending person items exposed on the read
surface — the [protocol completion program](0267-protocol-completion-program.md)
docket's 0271 slice. The finding's measured shape: igb's survey release real
and waiting (the phase closed and verified through the whole autonomous
chain), yet a `person-questions`-scoped read saw "No pending questions." and
nothing else — correct per 0250's content-scoping letter, but no surface
listed item *existence*; the delegated attendant (the run's own supervisor
shape — the evaluation phase's harness-driven person sub-agent, 0267's gate
letter) inferred the gate from gate-wait strings. The design residual the
finding left open — the surface's shape only (which fields, which scopes) —
is ruled below.

Derives P2 (the bracket, as routing precision never authority widening:
existence — kind and id — for every reader of the menu, question content only
for question-authority channels through the same admitted-set check the claim
path reads, the gate's content never on the read surface at all — its
disclosure the offer route's own behind release authority; answering
unchanged, no new write route, no eligibility moved), P5 (one home: the
authority split reads `questionAuthority` alone, the coordinator's own check
— never a second hand-maintained list; the offerable-gate predicate extracted
into the one named home `offerable()` that the offer, the listing and the
wait arm all read; the id's read home the menu alone, the wait arm naming
existence only), P6 (derived state: the listing renders from the same durable
records `personStep` and `offerGate` read — the unanswered questions and the
offerable gates — no new persisted state, no git read, read-only exactly as
0250 words `ready`), P7 (mechanical grammars alone: kind and id — a frozen
two-word vocabulary and the routes' own identifiers — nothing judged, no
content authored), P10 (the floor: nothing pending and the list renders the
empty shape; a reader that ignores the field byte-identical, the stripped
menu pinned on both sides of the wire), P13 (additive under the frozen
`protocol: 1`: the menu grows exactly one field, the kind vocabulary frozen
additive (`question` | `gate`), no response envelope, route or step shape
touched), P15 (the listing is data the coordinator renders; the worker passes
the menu through untouched, threading only the delegation the daemon already
derives — no second author), P19 (the finding's measured chain the consumer:
the delegated attendant that could not see what it was attending to — 0267's
evaluation gate names this slice as the read surface that makes the attendant
viable, and nothing here speculates past that consumer), and P21 (the
declines: a dedicated pending route and an envelope sibling both declined —
0261's dedicated-fetch decline at the field scale, 0270's envelope
reservation; no consumer needs a standalone fetch or a second dispatch
surface). Amends none — 0250's content-scoping letter and issuance order
stand exactly as written, the listing reading both.

## Category scope

Tier: mechanism — code home and test home in this change (0110 D13): the
listing, the predicate's named home and the wait arm in
`src/executor-coordinator.ts`; the delegation threading
`packages/auto-server/src/executor-worker.ts`; test homes
`test/executor-steps.test.ts` (the behavior), `test/executor-catalog.test.ts`
(the floor), `test/manual-prompts-ratchet.test.ts` (the person.md arm),
`packages/auto-server/test/executor-e2e.test.ts` (the wire pins); the
teaching `prompts/person.md`; the operator-guide truth pass
`packages/auto-server/README.md`.

Premises this ruling changes: none. Re-read in this change: **0262** (finding
04 — stands as measured; its remedy family worded "kind, id, and for eligible
channels the proposal," the proposal letter applying to question content —
the question's text — while the gate's own letter is release/hold, its
content already carried by the offer route and declined here as a read-surface
rendering), **0250** (the person settlement — item content scoping, the
shared issuance order and the id-persistence letter all stand, the listing
reading each; the delegation envelope's vocabulary the authority split's one
source), **0267** (the docket's 0271 row — "kind and id for every reader, the
proposal only for question-authority channels, answering unchanged: P2
routing precision never authority widening" — enacted exactly), **0269** (the
freshest menu letter — the single dispatch-time payload; the carrier pin
below rides it, and its floor test grows the stripped shape), **0270** (the
envelope-sibling letter — handshake/identity data, never dispatch data;
pending is dispatch data, the sibling declined on its own reservation),
**0252** (the prompt pair and ratchet — person.md's pending sentence joins
the pinned set). All stand.

## The ruling

### The carrier pin: `menu.pending`

0269 ruled the menu "the single dispatch-time payload" (its sibling-field
decline the catalog's — dispatch data needing no standalone fetch); 0270
ruled the envelope siblings handshake/identity data (the build fingerprint,
its under-menu decline expressly reserving the menu for dispatch data).
Pending person items are dispatch-time data — what person work exists to
route attendance to — so the carrier is the menu: **`menu.pending`**, an
array riding both of `menu()`'s arms (the leases-held early return too, beside
`types`), the response envelope untouched (`{ protocol: 1, build, menu }`,
the e2e's menu-keys pin growing additively to
`["claimable","leases","pending","types"]`). An envelope sibling beside
`menu` declined (0270's reservation); a dedicated pending route declined the
same way (0261's dedicated-fetch decline at the field scale, P21). The field
name pinned **`pending`** — it names exactly what rides (the pending person
items, the finding's own word), beside `waiting` and `items` declined as
respectively a state description rather than a list, and generic past
meaning.

### The rendering: derived from the live records, one source

`pendingItems()` renders from the same durable records the claim path reads
— no new persisted state, read-only exactly as `ready` itself (0250: "`ready`
only derives state"):

- **Question items**: the unanswered questions (`!item.answer`,
  `personStep`'s own filter), the id exactly the ones the answer routes key
  on (`question.id`).
- **Gate items**: the offerable gates — not superseded, not booked into a
  release intent — the record `offerGate`'s own `findLast` selects, the id
  exactly offerGate's derived gate-item id. The predicate is extracted into
  the one named home `offerable()` (a pure move, the offer byte-identical),
  read now by the offer, the listing and the wait arm (P5). A booked gate
  (intent without commit) is the coordinator's settlement, not a person
  item — the person's act is complete. Before an eligible person claim first
  records an occurrence, no id exists and the listing honestly carries only
  what has one (0250: "Persist an item ID when an eligible person derivation
  first records that occurrence").
- **Order**: the one shared issuance order (0250) — `position`, legacy
  questions before legacy gates (the same defaults `nextPerson`'s tiebreak
  reads).

### The authority split: question text for question-authority channels alone

Existence — `{ kind, id }` — for every reader of the menu, the plain worker
channel included (the finding's point: routing knowledge, not authority).
Question content only for a channel `questionAuthority` admits: the
privileged item is exactly the question step's own shape
`{ kind: "question", id, text, task? }` — the same content the claim route
already discloses to the same authority, nothing new disclosed and nothing
withheld (P2). The gate item carries no text beyond its id for any reader:
its letter is release/hold — the proposal, document and review are the offer
route's own disclosure behind `releaseAuthority`, and rendering them on the
read surface would widen the remedy past 0250's content-scoping letter. The
check is the same admitted set the coordinator already uses — one home (P5).
The threading: `ready(holder, person?)` and `heartbeat(holder, leases,
person?)` take the reader's delegation, the worker building the person from
the token's delegation when one rides the request (the daemon derives it for
every route already) — the menu's split decided coordinator-side, the worker
passing the menu through with no second author (P15).

### The wait arm: naming pending gate existence

`personStep`'s no-questions arm — the finding's exact blind spot ("a
`person-questions`-scoped read sees 'No pending questions.'") — now names
pending gate existence when an offerable gate stands: **"No pending
questions. A gate item is pending."** The person can then act through the
gate's own route (a claim — the offer carries the id, proposal and review; an
answer for a release-holding channel), and a questions-only attendant knows
to hold the item for the human (person.md's standing teaching). The arm names
existence, not the id — the menu is the id's one read home (P5). The
answering routes themselves are unchanged: no new write route, no eligibility
moved, the standing person answer/gate flows pinned by the same tests as
before.

### The prompt ruling

person.md taught claiming without knowing pending items exist — the minimal
sentence added (its own bullet beside the claim bullet): a token that also
carries the executor scope can poll `ready`; the menu's `pending` list names
each pending person item by `kind` (`question` or `gate`) and `id`, with
question text only for a grant that answers questions; answer items through
the standing routes. The executor-scope clause is the honest floor of the
daemon's own route gate — `ready` needs the executor grant (the e2e's pinned
403 for a person-only token), and the evaluation attendant's token is 0250's
dual shape (executor beside the person grant, the e2e's `dual` token
exercising exactly this reader). executor.md untouched, ruled: 0269's catalog
sentence and 0270's protocol sentence are not staled — the pending list is
person-surface data riding a field the additive-fields letter already covers
for worker readers, and the worker prompt holds no person-role teaching to
grow.

### Declined here

A dedicated pending route and an envelope sibling (above, P21); gate
proposal, document or review on the read surface (the offer route's
disclosure, never widened); naming the gate id inside the wait arm's detail
string (the menu the id's one read home, the claim's offer carrying it for
every eligible reader); widening the daemon's `ready` route gate to
person-only tokens (the route authorization is 0250's own letter, pinned by
the e2e's 403 — this slice moves no authority, and a person-only reader
reaches the person surfaces through claim, which the finding itself measured
working); a per-reader render of the menu (one menu — the authority split is
one field's presence or absence, the same reader and authority reading the
same shape on `heartbeat` too).

## Residuals

- The listing's gate arm names the durable record, not the live proposal: a
  gate whose proposal changed but whose supersede has not yet run (no
  eligible claim since) stays listed until the claim boundary supersedes it —
  the same window `offerGate`'s own prior comparison holds today, bounded by
  the next eligible person claim, the listing naming what the durable state
  holds (P12).

## Companion changes and verification

The INDEX row; the AGENTS.md executor-leases navigation line's 0271 pointer;
the auto-server README truth pass (the person paragraph's pending sentence).
Test evidence: `test/executor-steps.test.ts`'s new test — the existence
floor before a gate id exists, the plain-worker kind+id for both kinds with
no text, the question-authority text arm (the question step's own shape),
the releases-authority no-text arm, the no-questions-but-gate wait arm
verbatim, answering unchanged through the standing routes — beside its two
whole-menu assertions grown; `test/executor-catalog.test.ts`'s floor (the
stripped menu, the empty shape, both menu arms); the ratchet's person arm
(the file at 38 tests); the e2e's wire pins (the menu keys, the stripped
floor, the plain-worker and dual-token pending arms over the live question,
the whole-menu deep-equal, the gate-wait arm on the wire); the standing
suites green — auto-core full suite 3475 across 171 files, typecheck exit 0;
auto-server 206 pass beside the container's pre-existing IPv6-bind failure,
failing on the committed tree identically (0265's record), typecheck exit 0.

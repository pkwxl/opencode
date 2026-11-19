# 0248 — The executor protocol's contract amendments: the 0246 review ruled into D4

Status: **active-authority** — the amendment ruling over
[plans/0246](./0246-executor-protocol.md) (the executor protocol design). An
external review of the uploaded document (Kimi, 2026-11-18 — verdict: the
direction approved, changes requested to the D4 wire contract before
freezing it) is verified here finding-by-finding against the document's own
text; the accepted findings are ruled as amendments **before the first
enactment slice** — zero consumers exist, so every amended shape is revised
in one conscious lockstep (P13's letter at its cheapest: nothing that shipped
is reinterpreted, nothing lands twice). What ships: lease **fencing** on
`report`/`release` (a stale holder can no longer land a successor's tree nor
evict a successor's lease); the **idempotency arms completed** (the attempt
ledger's home, the replay keys, the 5xx retry claim scoped to what is
proven); the **normative route table** (every route's request and response
shapes, the envelope's payloads reconciled, the open-mode routes' home
named); the open arm's **composition and containment** (create-and-init one
arm under `projects`, the config grant named, never smuggled; canonical-path
containment); the **landing-time path check** (the write contract enforced
where it is violated, not only where it is visible); **verify independence
at token level** (the solo flow corrected — a second channel is structural,
not decorative); **person delivery eligibility-filtered**, with the `role`
discriminator and settle-once answers; and the semantic normalizations
(heartbeat's label, the blocking scope named, the dedup scope, "attached"
defined, the derivation table's precedence, the slice order corrected). No
code lands with this document; slice 1 (the read-only extraction) is
untouched by every finding and may proceed — the amendments bind every
slice that lands the contract, from slice 2 onward.

## Derivation

Derives: **P2** (the open arm's config grant named in the bracket —
`projects` openly implies config-power-within-a-declared-root, the root the
bound; every stale answer and every refusal names its holder, its paths or
its remedy to the person), **P3** (independence stated honestly —
token-distinctness is what the protocol can enforce, fresh-context
separation what it trusts; the review's correction of "independence by
construction" adopted, verification never weakened below the push floor),
**P5** (the attempt ledger one home — the progress record's extension beside
the leases, no second ledger anywhere), **P6** (replay keyed on
deterministic facts — step plus lease, the dedup key, by-target, settle-once;
every crash window re-derived, nothing a fresh read cannot answer), **P7**
(the route table and the path check are grammar — shapes and path
intersection, never content; out-of-scope-but-unconflicting edits ride to
verify by design), **P8** (blocking reserved for the stop's own work — the
landing refusal, the stale answer; each naming what it names), **P12** (the
stale report never silently honored; a crashed landing read conservative —
the booked key recognized, never double-booked), **P13** (the amended word
sets — the `lease` field on two requests, the `menu` payload, the `role`
pair, `isolation`'s widened letter — one conscious lockstep in this document
over a vocabulary with zero consumers), **P16** (containment structural —
canonical path resolution, never an enumerated list), **P17** (fencing the
sole-writer grant's teeth — a live sibling's declared scope never silently
absorbed by a concurrent landing; the tier-0 mechanics ruled, the tiered
shape staged with its tier), **P19** (the review the measured admission —
every finding verified against the text, three corrected with citations, the
declined halves named with reasons), **P20** (the zombie holder's dirt
absorbed by the successor's landing, never destroyed; release and takeover
unchanged in their letter), **P21** (nothing speculative — every amendment
answers a named finding; client request ids declined with the deterministic
keys that buy the same safety). Amends: **plans/0246** (D4 blocks a–l;
D5's idle-out term; D6's composition; D8's scope letter; D10's slice order;
the category table's slice cells; Residuals). Tier: **mechanism** — still a
design ruling; no code lands with it.

## The measured findings

The review's own scope declaration — "based on the uploaded document alone; I
have not validated the referenced prior plans or implementation machinery" —
is honored here by validating both halves: each finding checked against
0246's text, and the surfaces it rests on re-read through the corpus
(premise guard below). The disposition counts: of the four blocking
findings, three confirmed whole and one half; of the four high-priority
findings, all confirmed with two narrowed by text the review had no cause to
weigh; three review claims corrected by the document's own letter. The
review's recommended disposition — proceed with the read-only
decision-layer extraction, revise D4 before the write and takeover slices —
is adopted as this document's staging.

| the review's finding | the verification | the ruling here |
| --- | --- | --- |
| 1 — takeover unfenced: `report`/`release` name only the step; a delayed report, a replayed release, a same-channel retry, a resuming zombie are all unrejected | **confirmed** — the step id is reused over takeover by design (D4 f), the idempotency receipt is the landed share's presence (D4 e), so the takeover window — same step id, no share landed — is covered by neither; a stale release evicts a successor outright | **D1** — the lease joins both bodies; honored only from the live holder; stale answers named; the zombie writer a recorded residual |
| 2 — idempotency covers only landing reports; failed attempts, zero writes, crashed ledger mutations, untargeted claim retries unruled; "5xx safe to retry" too strong | **confirmed in part** — the failed-report arm books an attempt and lands nothing, so no receipt exists; but the untargeted-claim retry *is* ruled (D4 e: every `ready`/`claim` answer carries the channel's live leases — a lost response reconciles) | **D2** — the attempt ledger's home and replay keys ruled; the 5xx claim enumerated per route; the blind-retry additional lease a residual |
| 3 — the wire schema incomplete: no menu shape, no heartbeat/release/answer responses, the question shape contradicts the envelope, no field for live leases, the open-mode routes absent | **confirmed** on every point — the envelope names two payloads (D4 a) while `ready` answers a menu, `question`'s inline pair (D4 b) contradicts the object envelope, and the open-mode requests are waved at (D7) without a route home | **D3** — the normative route table: every route's body, payload, scope and retry class; the envelope reconciled to three payloads; the open-mode routes' home named |
| 4 — open-mode authorization unresolved: `projects` an indirect config grant, or two tokens; containment needs a normative filesystem rule | **confirmed in part** — D6's composition runs init inside creation while D8 says "init stays the `config` op it is": the grant is real and unnamed; but the trust posture is already a named residual (the root "a directory the operator trusts wholly") | **D4** — create-and-init one arm, the grant named openly; canonical-path containment on 0067's own realpath discipline |
| 5 — the write contract's enforcement point unconvincing: forbidden edits ride the coordinator's own commit, invisible to the close-out audit | **confirmed** — the audit catches foreign *commits* (D2); an out-of-contract *edit* lands inside the driver's own share commit | **D5** — the landing-time changed-path check against the write contract; `isolation`'s letter widened in the same lockstep |
| 6 — verify independence contradicts the solo flow; client-chosen channel ids are not independence "by construction"; verifier-vs-fixer undefined | **confirmed** — `verify` claimable by a different channel (D4 c) against a solo diagram that shows one worker through verify (D4 k); channel ids are client-chosen (D4 a) | **D6** — token-distinct verify, the solo flow redrawn with its second session, the single-token cost named |
| 7 — person delivery can head-of-line block and race; concurrent answers and dual-scope tokens unruled | **confirmed in part** — the escalation rendering already serves the narrow agent (D4 h), but strict oldest-first blocks in-envelope items behind an escalated head; concurrent settles are serialized by the coordinator's sole-writer discipline, only the conflict answer is missing | **D7** — eligibility-filtered oldest-first; settle-once answers; the `role` field |
| 8 — heartbeat mislabeled pure; blocking scope ambiguous; dedup scopeless; "attached" undefined; table precedence implicit; slice 3 promises takeover before slice 4 brings expiry; the category table's slice numbers differ from D10 | **confirmed** on every mechanical point — including the slice-order defect and the category-table cell that names slice 4 for what D10 rules at slice 5 (and the `executor` scope, which slice 2's routes already need) | **D8** — each normalized; the slice order corrected; the cells reconciled |

The three corrections, recorded for the reply the person owes the reviewer:
the untargeted-claim retry is reconciled by 0246 D4 e's own letter (the
live-lease carriage); the root's trust posture is 0246's recorded residual,
so finding 4 narrows to the composition and the mechanics; the escalation
rendering already serves a narrow agent its escalation work, so finding 7
narrows to the head-of-line effect. None of the three rescues a blocking
finding; each narrows one.

## Category scope

The requirement family is 0246's own — the driving-model family; this
document amends within it, crossing nothing new.

| home | carries | this ruling |
| --- | --- | --- |
| this document | the amendments | **landed** — the fencing, the idempotency arms, the route table, the open-arm composition, the path check, the independence rule, the person delivery, the normalizations |
| `plans/INDEX.md` | the corpus manifest | **changed** — the 0248 row lands; the 0246 row gains the amendment pointer |
| the staged homes (0246's category table) | the enactment | **unchanged in location, amended in shape** — the slices land the contracts ruled here; the category table's slice cells corrected below |

## Decisions

### D1 — lease fencing on report and release (blocking finding 1)

The `lease` joins the two turn-ending bodies: `report` becomes
`{ "channel"?, "step", "lease", "outcome", "note"? }` and `release` becomes
`{ "channel"?, "step", "lease", "note"? }` — the opaque id the work steps
already carry inline (0246 D4 c), now the fencing token on the requests that
consume a lease. The lease grammar (0246 D4 l) gains one letter: **each lease
id is issued exactly once** — the step id names the share (reused over
takeover by design), the lease id names the holder's epoch (never reused; a
takeover's grant is a fresh lease over the same step). The coordinator
honors `report` and `release` only when the named lease is the step's live
lease **and** the requesting channel is its holder; the stale cases, all
workflow-plane (0246 D4 g's split stands — transport truth rides HTTP,
workflow truth rides steps):

- a `report`/`release` naming a lease held by another channel, or expired
  and retaken — answers `wait lease-held` naming the current holder (the
  wait reason 0246 already rules for claims; zero new vocabulary, D4 d's
  row extended to the turn-ending requests);
- a `report` whose share already landed — 0246 D4 e's replay rule unchanged:
the next derived step re-answered, nothing lands twice (this is the
successor's own landing recognized, and also the honest answer to a delayed
report that lost no race at all);
- a step/lease pairing never issued, or a lease id no live derivation knows
  — a 400 shape error, 0246 D4 e's never-issued rule extended to the pair.

The hub arm stays coherent under fencing: a hub that claims holds the lease
and reports/releases its own; a self-served child holds and reports its own
(0246 D4 a's two shapes unchanged). The resuming zombie — a partitioned or
paused holder that returns after takeover — is refused on every protocol
act by the rules above, but its **file writes** are beyond the protocol's
reach at the shared-tree tiers: named as a residual (below), cooperative
fleet, the successor's landing absorbing whatever the tree holds and the
verdict machinery judging it — exactly as 0246 D4 f already rules for the
dead holder's dirt, now stated for the live-but-stale one.

### D2 — the idempotency arms completed (blocking finding 2)

The attempt ledger gains its home: **the progress record's own extension in
`.auto/`, beside the leases** (P5's one home — 0246 D4 e already rules
leases extend the progress record; attempts join them). A booking is keyed
`(unit, step-id, lease)` — deterministic facts the coordinator re-derives,
never a second journal. The arms:

- `report outcome: failed` — books the attempt, lands nothing; a retry
  carrying the same `(step, lease)` is recognized by the booked key and
  re-answers the next derived step, never books twice.
- the zero-write and handover-verdict arms — the landing's own outcomes book
  through the same key when they consume an attempt (0246 D4 d's rows
  unchanged in their routing, their booking now keyed).
- the crash windows — report handling is ordered **book → land → respond**
  inside the coordinator's serialized handling; every kill point
  re-derives: a retry after a kill before the landing finds the booked key;
  after the landing, the share's presence; before the booking, nothing — a
  fresh booking. The standing windows (0149, 0183) carry as 0246 D3 rules.

The blanket "5xx … safe to retry" (0246 D4 g) is retired for the enumerated
truth, per route, in D3's table: `ready`/`brief` pure; `heartbeat`
idempotent (deadline arithmetic); `claim` by-target idempotent, untargeted
convergent; `report`/`release` lease-keyed (D1); `question` dedup-keyed
(D8); `answer` settle-once (D7). The one residual the review's question
surfaced, ruled a residual and not a defect: at tier 1 and above, a blind
retry of an untargeted `claim` may grant an **additional** lease — a fleet
that asked twice receives two units; convergent, never duplicative of one
lease, and visible in every `menu.leases` the next poll returns.

### D3 — the normative route table (blocking finding 3)

Every route's contract in one table — the shapes the slices pin test by
test. The envelope is reconciled to **exactly one payload of three**:
`{ "protocol": 1, "step" | "question" | "menu": { … } }` — `step` one step
object per 0246 D4 c's table; `question` the raise's answer as an object
`{ "id", "state": "raised" }` (0246 D4 b's inline pair and D4 a's envelope
letter reconciled — the pair becomes the object's fields; the payload is
not the step kind of the same name: a person's claim answering pending work
rides the `step` payload with `kind: "question"`); `menu` the
pollers' answer, new in this lockstep:
`{ "claimable": [ { "unit", "title", "kinds", "depends"?, "touches"? } ],
"leases": [ { "step", "lease", "kind", "deadline", "attempt" } ] }` — the
claimable set 0246 D4 b rules for `ready`, plus the channel's live leases,
which 0246 D4 e promises every poll answer carries and which now have their
defined place. `heartbeat` answers the same `menu` (its deadlines refreshed
as the side effect) — one payload word, not two.

| route | scope | body | payload | retry class |
| --- | --- | --- | --- | --- |
| `ready` | executor | `{ "channel"? }` | `menu` | pure |
| `claim` | executor or person | `{ "channel"?, "role"?, "task"?, "kind"? }` | `step` | by-target idempotent; untargeted convergent (D2's residual) |
| `brief` | executor | `{ "channel"?, "task", "kind" }` | `step` (the held step re-answered) | pure |
| `report` | executor | `{ "channel"?, "step", "lease", "outcome", "note"? }` | `step` (the next derived) | lease-keyed (D1) |
| `heartbeat` | executor | `{ "channel"? }` | `menu` (deadlines refreshed) | idempotent |
| `release` | executor | `{ "channel"?, "step", "lease", "note"? }` | `step` (the next derived) | lease-keyed (D1) |
| `question` | executor | `{ "channel"?, "text", "task"? }` | `question` | dedup-keyed (D8) |
| `answer` | person | `{ "channel"?, "item", "decision", "rationale"? }` | `step` (the next derived; a settled item acknowledged, D7) | settle-once (D7) |

Error bodies are the daemon's standing error shape, reused — no new grammar
(this ruling adds request/response payload shapes, never a second error
vocabulary; 400 names the field, 401/403/404/423 as 0246 D4 g rules them).
The stale-holder answers of D1 ride the workflow plane inside the `step`
payload. The **open-mode routes are named, not executor routes**: project
creation, adoption, registration and listing join the daemon's standing ops
surface under `/projects`, `projects`-scoped, their schemas ruled at slice 5
with the arm itself — 0246 D7's "projects created and listed through the
open-mode requests" reconciled to that surface, the executor protocol's
eight-route surface unchanged (P13: the boundary between the two surfaces
named rather than blurred).

### D4 — the open arm's composition and containment (blocking finding 4)

**Create-and-init is one arm.** The `projects` scope owns the whole
composition 0246 D6 sequences — root-containment check → directory creation
or adoption → dynamic registration → the standing init op — performed
server-side as one request. The grant is named openly, per P2's letter:
**`projects` implies config-power-within-a-declared-root** — the root is the
bracket's bound, the operator's own acts (start the daemon open, bound the
roots, issue the tokens) unchanged; a separate `config`-scoped token is
never required for the arm, and the standalone `config`-scoped init op
stands unchanged for registered projects (0246 D8's "init stays the
`config` op it is" reconciled: the op is the same code path, its open-mode
caller the daemon under the root bound — the grant named in the scope
table, never smuggled through a composition).

**Containment is canonical.** Judged on realpath-resolved paths at every
request that names a project path — the discipline 0067 already rules for
the registry match (one realpath before the exact match), extended to the
arm: a project path any of whose components resolves outside every declared
root is refused with the standing remedy (the operator registers by CLI, or
restarts with the root); a created path is re-resolved after creation and
before registration (a symlink planted inside the creation window changes
nothing); adoption of an existing directory and the remaining mechanics are
ruled at slice 5 with the arm — the constraint (canonical containment,
re-checked at each step of the composition) named here. The trust posture
is 0246's recorded residual, unchanged and cross-referenced: a root is not
a sandbox — the driver reads, writes and runs test channels under it; the
operator trusts the root wholly, and the remedy is the operator's own root
choice.

### D5 — the landing-time path check (finding 5)

0246 D4 i's write contract gains its enforcement point — the moment of
violation, not only the moment of visibility. Before a share lands (the
`report` handling's landing acts, ahead of the
commit), the coordinator reads the work tree's changed paths — the standing
porcelain read the unified commit already performs — and intersects them
with the write contract's permitted set: the unit's effective scope (its
`Touches:` declaration resolved) plus the artifact paths per kind
(`docs/T-NNN/handoff.md`, `gaps.md` on a verify's INCOMPLETE, `report.md`
on a verify's PASS). The tier-0 mechanics:

- **driver-exclusive surfaces touched** — `todo.md`/`done.md`, the phase
  index, `subtasks.md`, the config, `AGENTS.md`, anything under `.auto/`,
  git metadata — the landing refuses: `blocked isolation`, the offending
  paths named, the remedy taught (the person resolves the tree — the
  out-of-contract writes are theirs to inspect, keep by hand or remove; the
  unit stays mid-flight under its record, everything else resumable); the
  attempt books through D2's key (an out-of-contract writer is detector 4's
  server-side judgment — an attempt failure, never a task verdict), and the
  violation persists in the derivation: an evaluation over an active record
  whose tree still violates answers `blocked isolation` until the person
  resolves it.
- **a live sibling lease's declared scope intersected** — refused loudly
  (P17: wrong surface loudly, never corruption); at tier 0 no sibling can
  be live (one lease, the admission's scope disjointness), so this arm
  exists only where concurrent leases do — its exact wait/blocked shape is
  ruled at slice 7 with the tier it belongs to, the principle staged here.
- **out-of-scope but unconflicting edits** — ride: the landing commits them,
  and the unit's verify judges the range it already judges (content
  judgment is session work by construction — P7; recorded as a residual so
  no one expects the landing to catch what only judgment can).

`isolation`'s letter widens in this lockstep, consciously and here alone:
from "the close-out audit found foreign commits in the unit's range" to
"the write contract violated — foreign commits in the unit's range, or
changed paths outside the permitted set at landing" — one code, zero
consumers, the widening named. The close-out audit stands as the second
line (a person-side foreign commit is still possible); the read-only gates
stand as they stand.

### D6 — verify independence at token level; the solo flow corrected (finding 6)

The grant rule moves from channel to **token**: a `verify` step never grants
to the token that held the unit's immediately preceding `execute` or `fix`
share — the work the verified range contains; `fix` grants freely (any
channel, the original executor included — fix is work, not judgment, and
its output is judged by the next verify). Channel ids never discriminate
independence: they are client-chosen (0246 D4 a), and the same session can
present another — the token is the protocol's identity for independence,
the strongest distinction it can see. "Independence by construction"
(0246 D4 c) is retired as a phrase; the honest statement: fresh-context
separation, token-distinctness enforced, same-token context separation
trusted (the cooperative-fleet residual, below).

The solo flow is corrected — a second session is structural, not
decorative:

```
the solo path, corrected — verification needs a second token
worker (token W, session 1)                     coordinator
   │  POST claim                                  │
   │─────────────────────────────────────────────▶│  admission · beginUnit · the lease
   │◀── execute  T-012 exec 1 ────────────────────│
   │  (the work; sources, handoff)                 │
   │  POST report {step, lease, ended}             │
   │─────────────────────────────────────────────▶│  the share lands · the verdict artifacts read
   │◀── wait {in-flight} ─────────────────────────│  (the session ends)
verifier (token V — the person relaunches with the second token,
or a hub spawns a verifier child)
   │  POST claim {task: T-012, kind: verify}       │
   │─────────────────────────────────────────────▶│  the token-distinct grant
   │◀── verify  T-012 verify 1 ────────────────────│
   │  … fix rounds as claimable; done as ever      │
```

The operational cost is named, not hidden: **executor mode needs at least
two tokens to close a unit** — verification independence is constitutional
(P3), and a protocol that let one token judge its own work would sit below
the push floor (which buys freshness by spawning the session itself); a
single-token deployment's evaluations answer `wait` with the requirement in
the detail (issue a second token — the operator's act, the bracket's own
letter), and the executor prompt teaches it. The verifier-vs-fixer question
is the same rule's other reading: verify differs from the latest fixer
because it differs from the immediately preceding share of any kind — one
rule, both edges.

### D7 — person delivery: eligibility, settle-once, the role field (finding 7)

**Eligibility-filtered oldest-first.** A person channel's `claim` returns
the oldest pending item **its delegation envelope covers**; the escalation
rendering (0246 D4 h) becomes the fallback, not the head-of-line blocker: it
is delivered when the channel's claim finds nothing in-envelope pending but
out-of-envelope items stand — the obligation to say "this one is yours" —
and the human's own channel sees everything, as 0246 rules. No in-envelope
item waits behind an escalated head again.

**Settle-once.** Answers are serialized per project inside the coordinator
(0246 D5's sole-writer discipline — an `answer` settles through a driver
write, the journal entry or the gate release, so it takes the same
serialization every driver write takes); a second `answer` on an
already-settled item is acknowledged with the next derived step and changes
nothing — the journal keeps the first settle's provenance alone, the second
answer's channel recorded in the request log and nowhere else.

**The `role` field.** `claim` gains `{ "role"?: "worker" | "person" }` —
one additive word pair, this lockstep; absent, the token's scopes decide,
and a dual-scope token defaults to worker (the heavier traffic; a
person-role posture on a dual token is an explicit claim away, taught in
the person prompt). 0246 D4 j's "two roles in one session — the protocol
still sees two" now has its wire discriminator.

### D8 — the semantic normalizations and the slice order (finding 8)

- **heartbeat's label** — `Pure` retired for it: it is stateful
  (deadline ← now + the refresh window, never past the hard cap) and
  non-committing; 0246 D4 l's "the pure polls are `ready`, `brief` and
  `heartbeat`" becomes "the non-committing polls" — the invariant that
  always held (polling can never commit) stated, the false label dropped.
- **the blocking scope named** — v1 and tier 0: any pending person item
  answers workers' evaluations `wait gate`, **project-scoped** —
  deliberately the one-driver floor's own semantics (a raised question
  blocks the run today); keying the block to the asking unit's scope at
  the concurrent tiers is deferred to the concurrency slices with its
  trigger (the over-blocking, measured when sibling leases exist).
- **the dedup scope** — identical unsettled text **from the same channel**
  (the raise's task qualifying: same task, or both taskless) returns the
  same question id — network-retry safety, which is all dedup ever was;
  different channels never merge (distinct askers to resume, provenance
  kept — two workers asking the same words are two questions).
- **"attached" defined** — a channel is attached while it holds a live
  lease or has made a request within the idle window (the value configured
  at slice 2, never hardcoded per project); the coordinator idles out when
  no channel is attached and no step is in flight — 0246 D5's condition now
  standing on a defined term (attach/detach remain declined as requests;
  this is a derivation, not a vocabulary).
- **the derivation table's precedence** — ordered, first match top-to-bottom,
  the lazy-expiry row first among state reads; stated in the table's
  preamble (0246 D4 d's rows unchanged in content, their order now law).
- **the slice order corrected** — takeover end-to-end moves from slice 3 to
  slice 4 (lazy expiry, `release` and the attempt ledger are its
  prerequisites and all three land at 4); slice 3 keeps the write arm and
  the standing relaunch-resume (a relaunched executor's mid-unit
  continuation — 0246 D3's machinery, no lease family needed). The
  category table's cells reconciled: the `executor` scope arrives at
  **slice 2** (the routes accept it from their first landing), the
  `projects` scope, the root-bounded registration arm and the serve flags
  at **slice 5**.

### D9 — declined amendments

- **Task-scoped person-item blocking at v1** — declined: the floor's
  semantics are the letter (the relaxation deferred with its trigger, D8);
  splitting the blocking scope before concurrent leases exist would rule a
  shape no v1 deployment can exercise (P21).
- **Cross-channel question merging** — declined: dedup is retry safety per
  channel; merging distinct askers' identical words would lose the asker
  provenance the resume depends on.
- **Client-supplied request ids** — declined: the deterministic keys buy
  the safety the review asks for — `(step, lease)` for the turn-ending
  requests, the dedup key for raises, by-target for claims, settle-once
  for answers — without a second id vocabulary to freeze and maintain; a
  future route that cannot key deterministically grows its id additively
  then, with its consumer named (P21).
- **Person-scope `heartbeat`/`ready`** — declined: a person channel holds
  no leases to refresh and attends by `claim`; the menu is the workers'
  surface.

## Premise guard

premises this ruling changes: **plans/0246** (D4 a's envelope letter and
route surface; b's request bodies and response shapes; c's `verify` letter
and the `lease` grammar's uniqueness; e's idempotency letter and the 5xx
claim; f's takeover letter — fencing added, continuation semantics
unchanged; h's delivery ordering; l's word sets and the declined list —
heartbeat's label, the payload words, the role pair, `isolation`'s widened
letter; D5's idle-out term; D6's composition; D8's scope letter; D10's
slice order; the category table's slice cells; Residuals — the zombie
writer named, the single-token cost named). Re-read in this change:
**plans/0067** (§五 and the P1c letter — stands: the closed default and the
amendment's letter unchanged; the open arm's composition clarified, its
canonical-path discipline an extension of the registry's own realpath
rule), **plans/0053 / plans/0183** (the run lock — stand: the coordinator a
single process, the one driver per directory; fencing changes what a
request must carry, never who holds the lock), **plans/0149 / 0183**
(interruption recovery and the carryover — stand, reused unchanged; the
attempt ledger extends the progress record beside the leases, their windows
their own), **plans/0203** (the ratchet's two-sided pin form — stands,
extends to the executor prompt at slice 6 with the amended bodies among its
pins), **the 0078 lineage** (the manual suite — stands as the no-server
floor, untouched by every amendment here). Each stands as written for every
surface this ruling does not touch.

## Residuals

- **The zombie writer** — a partitioned or paused holder that resumes after
  takeover is refused on every protocol act (D1's fencing) but its file
  writes land in the shared tree at tiers 0–1; the successor's landing
  absorbs whatever the tree holds, the verdict machinery judges it, and the
  remedy ladder is 0246's own (peer `release`, expiry, the person's channel
  kill); tier 2's worktrees are the structural isolation, each lease its
  own tree. Cooperative fleet, named here — the protocol's reach ends at
  the request surface.
- **Same-token context separation trusted** — token-distinctness is the
  enforceable floor of independence; a host that relaunches a session on
  the same token with the old context still warm is indistinguishable from
  a fresh one (nothing protocol-side can see context — P3's freshness is
  bought by the host's session boundary, as it is bought by the spawn in
  the push model).
- **Blind untargeted-claim retries at tier ≥1 grant additional leases** —
  convergent, visible in `menu.leases`, never duplicative of one lease
  (D2); the fleet asked twice.
- **Out-of-scope-but-unconflicting edits ride to verify by design** (D5) —
  the landing checks grammar; only judgment judges work.
- **Tier-scoped person-item blocking deferred** (D8) — v1 blocks
  project-wide on any pending item, the floor's own semantics; the
  relaxation waits for the concurrency slices and its measured trigger.

## Tests

None land with this document — still a design ruling; the amendments'
contracts become the named slices' pinned tests, the review's conformance
list adopted whole and mapped: **slice 2** pins the route table row by row
(every route's body and payload shapes, the envelope's three payloads, the
`role` default, `menu.leases` carriage) beside 0246's derivation table with
its precedence; **slice 3** the landing path check's refusal arms
(driver-exclusive surfaces named in the refusal, the persistent blocked
evaluation until resolved, the riding arm landing what verify then judges)
and the standing relaunch-resume; **slice 4** the fencing and funnel
properties — lost responses on every mutating route, stale reports after
takeover, a replayed `release` against a successor's lease, crashed
landings on both idempotency arms (booked-not-landed, landed-not-answered),
competing person answers (settle-once, provenance kept for the first
alone), eligibility-filtered person delivery within and past envelopes, the
token-distinct verify grant refused to the executing token; **slice 5** the
open arm — root-escape attempts, symlinked components, the re-resolution
after creation, the create-and-init composition's one-arm grant; **slice
6** the prompt pins extended by the amended bodies (the `lease` field, the
`role` posture, the second-token teaching). The INDEX row — and the 0246
row's amendment pointer — is this document's only companion change.

# 0308 — Addressed stops: every wait/blocked names its actor

## Category scope

Tier: the executor wire (protocol vocabulary and read surface). The
person's liveness ruling drove the change: **if every role plays properly,
the workflow never halts** — every answer the wire can give must be
progress, a workflow wait grounded in claimable work, or an *addressed*
stop: one that names an actor whose repertoire can clear it. The field
records (0297–0300) measured the class — a stop whose addressee lives only
in prose inference is a stop a willing role cannot play. The census behind
this change enumerated every wait/blocked construction site in
`executor-steps.ts` and `executor-coordinator.ts` (~90) and classified
each: the addressing splits per site, never per reason (a `commitFailed`
settlement refusal the holder corrects against a git-mechanical failure;
an `isolation` whose workspace the holder can restore against one needing
inspection; person-act `not-ready` waits — the open round, the
continuation pin, an unknown target — against the dependency family's
poll default).

Premises this ruling changes: 0294, 0272, 0287, 0282, 0270.

## Decisions

- The addressing vocabulary, frozen additive (P13): `Actor = workflow |
  executor | person | operator` — `ACTORS` in `src/executor-steps.ts`, the
  one home beside `WAIT_REASONS` and `BLOCK_REASONS` (the wire-wide reason
  vocabularies, including the two words other constructors own — the
  coordinator's `lease-held` and the worker's `gate` rendering — so the
  doc's pinned table is one source). `ACTOR_OF_REASON` carries the family
  defaults; the splitting sites set their literal at construction, the
  field always winning over the family.
- The field is required on every wait/blocked shape — `ExecutorPreview`'s
  wait variant, `BlockedReport`, `LeaseWait`, `BudgetBlock`, and the
  menu's wait/blocked held rows. TypeScript is the totality proof: no
  construction site compiles without its actor.
- The serializer (`auto-server/src/executor-worker.ts`) carries `actor` on
  the blocked arm (beside the renamed `code`/`remedy` pair, unchanged) and
  the wait arm; the `human` gate renders `actor: "person"`. `retryAfter`
  stamps only workflow-addressed waits — a person-act wait carrying one
  taught the reading agent to poll a gate forever (the ruled defect this
  fixes; the one deliberate byte change on the wire, every other answer
  additive).
- The menu gains `waiting`: `{ unit, title, blocker }` rows for every
  parked unit whose blocker is not done — the dependency waits ordinary
  progress clears, surfaced so a non-claimable unit reads as waiting
  rather than absent. `parkedWaiting` in `src/tasks.ts` is the predicate's
  one home (`strandedParks` reads it at the pick's empty moment for the
  mutual-park blocked answer, the person's reorder — never a waiting
  row's meaning).
- `docs/protocol.md` states the invariant and each actor's clearing
  repertoire (executor: correct-and-retry/release/park; person: documents,
  the `clarify`/`transfer`/`reconcile` operations, config, replanning,
  direct git; operator: stop run, restart, tool-tree inspection; workflow:
  none — progress clears it), with the fenced default table pinned by the
  protocol-doc ratchet both directions. `prompts/executor.md`'s response
  letter re-keys to the actor regime; the 0272/0282 anchors stand.

Derives: P2 (the person's bracket machine-visible on every stop), P5 (the
vocabulary, its defaults and the park predicate each one home), P8 (every
surfaced line teaches its addressee, not only its remedy), P13 (additive
frozen vocabulary in one lockstep — code, doc, ratchet, manual), P19
(grounded in the site census and the 0297–0300 field records; the
person-act-wait and gate-polling defects measured there).

## Premise re-readings

- **0294** (the step reply key, the not-ready cause class): standing as
  amended — the `step` key carries the actor beside the cause class; the
  brief-replay byte pin holds (both sides gain the field identically).
- **0272** (the blocked-cause escalation ladder): standing as formalized —
  the escalated sentence remains the perimeter arm's detail; the actor
  field now states machine-readably what the sentence taught.
- **0287** (the held rows): standing — the rows carry `actor` beside their
  standing shapes.
- **0282** (the plain blocked surface): standing — the actor field is
  additive to the same plain answer; no channel is added.
- **0270** (the menu's envelope letters): standing — `waiting` rides the
  menu body, never the envelope.

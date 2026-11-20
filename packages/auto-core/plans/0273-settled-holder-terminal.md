# 0273 — The settled-holder terminal shape

Status: **fix ruling, 2026-11-20.** [0264](0264-adoption-standdown-findings.md)
finding 05's remedy family enacted — the settled-holder terminal shape — the
[protocol completion program](0267-protocol-completion-program.md) docket's
0273 slice. The finding's measured shape: both reporting children saw the
same-token verification wait at share rotation, unable to distinguish
"accepted; the share rotated — this token's work on the unit is done" from
"wrong token, cannot report" — executor.md's lost-response letters cover
retriable losses only (a lost report retried with its original pair, a
successor claim resuming settlement), a rotated share is terminal for the
holder, and the one wait line answered both, so a well-behaved holder's clean
exit depended on reading intent into a wait that can never clear for it (the
wrong readings — retry the report, poll forever, mint a successor itself —
exactly what the ambiguity invites). The design residual the finding left
open — "the shape's wording only" — is ruled below, as one split at the
wait's own site plus the vocabulary act that carries it.

Derives P3 (completion never judged by self-report, and its inverse here
made visible on the wire: the holder does not infer its report's fate from a
wait's silence — the coordinator states the booked evidence, the settlement's
own durable record, and the different token that judges the work next), P5
(one home: the terminal derives from the booking state `verification()`
already reads — the findLast producer with a landed receipt — and names the
one evidence record the settlement already writes (`receipt.commit`,
`settleShare`'s `finish`); no second source, no mirror, nothing persisted),
P6 (derived state: no new state, no field, no record — the shape a rendering
of what already sits in `.auto/executor-progress.json`, re-derivable at every
read across restarts), P10 (the floor: every neighboring answer byte-identical
— a live share still answers the lease-held wait, a pending report the
settlement waits, a different token the grant, the isolation witnesses their
blocks; the retired wait's own site is by construction the booked state, the
findLast filter having pinned the producer landed since 0248, so no holder
for whom the wait was the honest answer loses it — the wait was never the
honest answer for a live share, the finding's own remedy-family letter
reading "unchanged for every live holder" as exactly this), P12 (the
ambiguity resolved fail-loud: the state that can never clear for the token
now says so terminally instead of wearing a wait's maybe-transient shape),
P13 (the vocabulary ruling below: one new additive step-kind word under the
frozen `protocol: 1`, `done`'s single meaning held — the decline states why),
P19 (the finding's measured chain the basis: the two children's reports, the
rotation, the one wait line; the neighbors measured before writing — 0246
D4 k's corrected solo diagram, 0248 D6's single-token wait letter, 0249's
lost-response letters, 0261 D1's same-token successor, 0270's
unknown-kind stop-and-ask all re-read, the premise guard below), and P20
(rotation at safe boundaries: the rotated successor's first duty is to stop
writing — the terminal is the surface that finally tells it its predecessor's
report landed, so stopping is reconciling, not guessing; nothing here rolls
anything back, the settled share kept). Amends none — the principle set
untouched; 0248 D6's single-token wait letter is amended at its booked edge
through the premise guard below (a plan ruling's letter, never a principle),
and every other letter of the re-read set stands.

## Category scope

Tier: mechanism — code home and test home in this change (0110 D13): the
split, the `SettledStep` type and its rendering in
`src/executor-coordinator.ts` (`verification()`'s same-token arm); the wire
arm `packages/auto-server/src/executor-worker.ts` (`wireStep`); the teaching
`prompts/executor.md` (two clauses); test homes
`test/executor-steps.test.ts` (the split, the floor, the independence
behavior, the reconciliation path), `test/manual-prompts-ratchet.test.ts`
(the pin move and the new coupling arm) and
`packages/auto-server/test/executor-e2e.test.ts` (the wire rendering, both
same-token sites); the README truth pass `packages/auto-server/README.md`.

Premises this ruling changes: **0248 D6** — its letter "a single-token
deployment's evaluations answer `wait` with the requirement in the detail"
ruled the wait the answer for *every* same-token verify evaluation; this
ruling splits the booked state out (the producer landed, its evidence
recorded) to a terminal naming that evidence, because the wait there can
never clear for the token (the producer is pinned in history — D6's own
token-distinct rule) and reads indistinguishably from a wrong-token refusal
(the finding's ambiguity). D6's rule itself — token-distinct verify, the
strongest distinction the protocol can see — is untouched and enforced by
the same check; a different token reads the grant exactly as before, and
the wait letter keeps every state the arm never reached. Re-read
in this change: **0264** (finding 05 — stands as measured; its remedy
family's first arm enacted, the menu-carrying alternative declined below),
**0267** (the docket's 0273 row — "a booked report answers with a distinct
terminal shape naming the booked commit; live holders' wait byte-identical,
P10" — enacted exactly), **0246 D4 k** (the corrected solo diagram's
post-report wait arrow — the diagram's second-session shape unchanged; the
terminal states the same fact terminally, the operator's rotation letter
untouched), **0249** (recovery — the lost-report retry with the original
pair and the successor claim's settlement replay both stand byte-identical,
pinned; the terminal is the additional reconciliation for the response the
holder never read), **0261 D1** (holder fungibility — the same-token
successor inherits the terminal through the ordinary claim path, exactly the
reader the finding names), and **0270** (the protocol sentence's
unknown-kind stop-and-ask — the additive-kind growth route this slice
exercises; unknown extra fields remain additive, an unknown step kind
remains the update signal).

## The ruling

### The split

The same-token arm of `verification()` splits on the booking state the
check already reads. The arm is reached only after the producer walk —
`findLast` over the unit's non-verify entries with a **landed** receipt,
`outcome === "ended"`, `booking.intent` present, the git witnesses holding —
so the state at the arm is by construction *the report already booked*: the
execute share settled, its evidence recorded. Two readings of that state:

- **Report already booked** (the arm's own state): the same-token verify
  claim answers with the **settled terminal** — the holder's report was
  accepted; the evidence is booked at `<receipt.commit>`; this token's claim
  on the unit has ended; a different token performs the verification. The
  producer's grant id names which share's report landed (execute or fix —
  the walk's findLast covers both, one rendering). This is the
  reconciliation the finding wants: the rotated successor on the same token
  (0261 D1's inheritance shape) and the original holder that lost its report
  response both read the booked evidence off the claim they were going to
  make anyway, instead of waiting forever on a wait that can never clear
  for the token.
- **Live holders** (every neighboring state): byte-identical, pinned. A
  live share — the report not booked, the lease running — answers the
  lease-held wait on every channel of the token; a report booked but
  unsettled answers the settlement waits (the claim path replaying the
  settlement first, as today); a different token reads the verify grant;
  the isolation witnesses still answer their blocks ahead of the arm (the
  terminal never masks a moved HEAD — P12). The retired wait line's own
  site was never reachable in a live state, so no honest wait is lost.

The terminal's fields: `kind: "settled"`, `unit`, `commit` (the booked
evidence), `detail` (the mechanical rendering — the report's acceptance, the
booked commit, the ended claim, the different-token verification; a fixed
template over the settlement's own record, never authored content). The
wire renders `{ kind, unit, commit, remedy }` — the `blocked` /
`phase-boundary` terminal family's shape, no `retryAfter` (nothing to
retry).

### The vocabulary ruling: a new additive step-kind word

**One new step-kind word: `settled`.** It joins the response vocabulary
additively under the frozen `protocol: 1` (P13): unknown to old clients,
which stop and ask the operator to update per executor.md's standing
teaching — the route 0270's protocol letter already rules for exactly this
growth ("Stop and ask the operator to update the client if the protocol or a
step kind is unknown; unknown extra fields are additive, not an unknown
protocol"). The word is the corpus's own: the finding, the docket row and
the settlement's own verb all say *settled* — the share settled, the
holder's part in it done.

**The declined alternative: growing `done` with a payload** naming the
booked evidence. Declined on three grounds. First, P13's single meanings:
`done`'s frozen meaning is the round's own completion (the preview's
`round.complete` arm; executor.md's "Show the summary and end at `done`") —
the settled holder's state is the opposite face of the same moment, the
round *not* complete, verification by a different token the pending work;
giving `done` a second meaning is the silent duality P13 exists to refuse.
Second, the remedial teaching differs: at `done` the client shows the round
summary; at settled it reconciles against a named commit and ends without
retrying — an old client reading grown-`done` would render "The round is
complete.", a false statement, which is not a floor but a lie (P12), and
precisely the ambiguity 0264-05 measured, recreated one layer up as
vocabulary. Third, the honest old-client behavior already exists at the
unknown-kind route (stop and ask) — declining it to preserve a wire shape
old clients misread anyway serves no one. A third shape — carrying the
booking on the menu for the stale holder (the finding's alternative arm) —
is declined below.

### The derivation source

The terminal derives from the booking state `verification()` already reads
(P5/P6): the producer walk's landed receipt, `booking.outcome === "ended"`,
`booking.intent`. The booked commit is the evidence the settlement already
records — `settleShare`'s `finish` writing `receipt.commit` into
`.auto/executor-progress.json` — the one home the landing proof already has;
the terminal renders it, persists nothing, and re-derives at every read
across restarts (the restart test pins the terminal surviving coordinator
close and reopen).

### The reconciliation letter and the teaching

executor.md gains two clauses. The terminal family's paragraph (:29's
letters) gains the settled sentence — what it means (a claim from a token
whose share's report was already accepted), what it carries (`commit`
naming where the evidence is booked, the ended claim, the different-token
verification), what the client does (reconcile against the commit and end
the session). The lost-response paragraph (:31's letters) is extended to
name it: a `settled` answer to a same-token claim also reconciles a lost
report response — the report landed, the booked commit named, do not retry
it — so the two letters a reporting child can now receive after a lost
response are both terminal-honest (the retry returns the receipt; the claim
returns the terminal naming it), never a wait read by intent. The ratchet
pins move with them (0203's both-sides oracle): the retired wait-line pin
becomes the independence check's own anchor (`producer.holder.token ===
holder.token`), and a new coupling arm holds executor.md's two sentences to
the coordinator's rendering.

### Declined here

Growing `done` (the vocabulary ruling above); carrying the settled lease's
booking on the menu for the stale holder (the finding's alternative remedy
arm — a second read surface for a fact the claim already answers, and one
every holder would poll instead of claim; P21 beside it: no consumer
beyond the claim path the terminal already serves); extending the terminal
to the fix grant's same-token claims (fix grants freely by 0248 D6's own
letter — fix is work, not judgment; there is no same-token wait to split);
a `settled` receipt kind or any persisted marker (nothing persists — P6);
hoisting the same-token check above the git witnesses (the isolation blocks
must keep answering first — a moved HEAD is never papered over by a
terminal, P12); and touching person.md (no person surface reads this arm).

## Residuals

- The terminal states the claim ended for *this share's* verification: if a
  later fix share lands from a different token, the earlier token may claim
  the next verify (the walk's findLast re-pins to the new producer — 0248
  D6's "differs from the immediately preceding share of any kind"). The
  detail's wording states what already happened, not a forever-claim — the
  finding's own "the surface states what already happened" letter.
- The report route's own response still returns the receipt (the standing
  shape); the worker's `next`-step payload after a landed report changes
  from the retired wait to the terminal for the producing token — the
  finding's primary reader, and a byte change on that one response's step
  payload, named here rather than in the floor (the wait it replaces was
  the defect being fixed).

## Companion changes and verification

The INDEX row; the AGENTS.md executor-leases navigation line's 0273
pointer. Test evidence: `test/executor-steps.test.ts` — the new test (the
live-share floor byte-identical on both channels, the settled terminal's
exact shape and detail over a booked report, the rotated same-token
successor and the `verification`/`next` routes reading the same terminal,
the standing lost-report retry beside it, the progress state untouched, no
lease granted, the different-token grant unchanged) beside the four
standing pins moved to the terminal (the restart test, the independent
verifier's gating arm, the doc-lease same-token claim, the fix-producer
arm in the FAIL-routing test) and the lane test's same-token claim (the
booked lane share named); the ratchet's pin move and new coupling arm (the
file at 40 tests); the e2e's two wire sites rendering
`{ kind: "settled", unit, commit, remedy }` beside the README truth pass.
The standing suites green: the full auto-core suite 3481 across 171 files
(3479 + the two new tests), typecheck exit 0; auto-server typecheck exit 0,
206 pass beside the container's pre-existing IPv6-bind failure, failing on
the committed tree identically (0265's record).

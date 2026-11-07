# 0217 — The formulation rides the planning route; the probe reads its own evidence; the classifier's cached instant is per-time-evidence

Status: active (ruled by 0166 step 057, 2026-11-08). Three findings of the
0165 register out of the S16 routing review: **0165-031** (S16-04, S2 — since
0095 the phase's planning, the formulation task, routes as an ordinary
`whole` task on the phase type's execute tier — `simple` for
implement/test/knowledge — while 0055 §5's tier table, tier.ts's header,
0113 D2 and the role registry's `planning: deep` still describe the deep
planning route, and an operator's `routes.phase-plan` silently stops
reaching the session it was written for), **0165-032** (S16-05, S2 — the
wait-and-probe loop's probe candidate is the first in-window candidate in
list order "ignoring the down marks", so a primary held spent until a stated
reset is probed every poll round — its `until` mark cleared for the probe
and lost when the probe round itself errors — while a fallback whose
recovery is unknown, the one candidate a probe can learn something about, is
never probed) and **0165-127** (S16-03, S3 — the classifier's run cache keys
on the message with its times and digits masked, but the cached answer
carries an absolute `resetAt` computed against the first ask's clock, so a
later failure of the same wording with a different stated reset inherits the
first instant — too early, the mark lapses into a spent window, or already
past, dropped). One family, the S16 review's own diagnosis: "cross-ruling
drift is the dominant defect class here — 0057's scheduled wait, 0055 §7.1's
time-masked cache and 0055 §5's planning tier were each sound when written;
later rulings changed a premise and did not re-read the dependent rule."

The boundary answers first (the requirement-intake rule): the family is
*tier routing's three premise drifts* — the planning session's route word,
the probe's candidate rule, the classifier cache's instant reuse. Home-set:
the formulation recognition and its dispatch role (`src/runner.ts` runTask's
chain, `src/formulate.ts`'s `Formulate:` predicate as the recognition it
keys on, `src/loop-preflight.ts` dispatchNeeds' planning need), the probe
decision (`src/select.ts`'s probe arm, `src/router.ts` probeSelection /
ProbeTarget, `src/session.ts` awaitRecovery's re-mark sites), the classifier
cache (`src/classify.ts` classifierTimeKey / the reuse rule / the known and
join paths, `src/router.ts`'s cache value and accessors), the descriptors
that state the route words' tiers (`src/tier.ts`'s header,
`src/roles/registry.ts`'s planning descriptor comment), the test homes
(`test/agent-fake.test.ts`, `test/select.test.ts`, `test/classify.test.ts`,
`test/turn-recovery.test.ts`, `test/services.test.ts`) and the documentation
homes (plans/INDEX.md, AGENTS.md navigation, docs/structure.md). 0165 is the
evidence, not the authorization: every decision below is ruled here.

## Derivation and Category scope

Derives: P15 (policy is data — D1's showing: the tier is policy the registry
table declares, and the formulation session silently stopped reading the row
written for it; no code authors a tier, the session is simply returned to
the word whose descriptor declares deep), P19 (measured evidence — D2's
showing: the probe's own `until` marks are evidence the driver holds, and
the probe choice ignored them, spending a probe's tokens per poll round on a
certain failure while the unknown-recovery candidate waited behind a stated
reset; D3's showing: the finding's measured key collisions, "resets at
15:00" vs "resets at 21:00" and "3 hours" vs "1 hours", are the cached
instant serving a failure it was never evidence for), P12 (conservative
under uncertainty — D3's differing-time repeat resolves toward no instant,
never a guessed stale one; D2's known-spent candidate is probed only when
nothing better stands), P6 (derived state — D2's preserved mark rides the
existing mark shape, no second store; D3's time evidence derives from the
redacted input the ask already built), P10 (the floors: an implicit registry
— both tier lists identical, routes only from the switches — dispatches the
formulation byte-identically under the planning word; a cache entry without
an instant, a probe list without `until` marks, a classifier-less run: every
untouched shape byte-identical), P13 (no vocabulary word moves: the probe
decision's shape, the ⏳/⏸ lines, the role words and the tier words are all
unchanged; `implement-scan` stays a claimable routing word exactly as
since 0095), P5 (one home per rule: D1's role override sits at the one
recognition predicate every dispatch already reads through roleOf; D2's
ordering sits in select's one probe arm; D3's comparison policy sits in
classify.ts, the router holding state only, per its own comment).

premises this ruling changes: **0055 §6.3's probe-choice letter** ("The
probe uses the first candidate that is inside its window, ignoring down
marks") — AMENDED: the probe prefers the first in-window candidate whose
mark carries no `until` (unknown recovery, the probe's own constituency)
over one whose `until` lies ahead (held evidence of spent-until-then); the
first in-window candidate stands when every in-window candidate is known
spent, and the no-in-window backstop is unchanged. **0055 §7.1 Cost's cache
letter** ("keyed by the message with its digits, ids and times masked") —
AMENDED for the instant half: the class stays keyed by the masked message,
the cached instant is served only when the failure's own time evidence
matches the ask's (ids excluded, times and digits compared); a differing
repeat receives the class alone. **0095 D1's m-mode bullet** ("the routing
role is the task site's ordinary phase key") — CORRECTED by D1: the
formulation task's session routes under the planning word (a chain role
override at the recognition), the bullet's actual retirement — 0053 D12's
m-mode `implement-scan` special role — stands. The 0055 and 0095 INDEX rows
are annotated in this change.

Re-readings, standing: 0057 S4 (recoveryAt's withholding — now aligned: the
until-less candidate the schedule waits for is the candidate the probe
targets), 0057 §5.3 (stated resets outrank answers — untouched), 0113 D2
("the deep tier the planning sessions … dispatch on" — D1 restores its
premise rather than changing it), 0163 D1 (the key-mark shape — untouched),
0178 D1/D4 (the walk's bound and the owed re-key — untouched; the probe's
ring-clear stays their bounded consequence), 0179 D1 and its residual (the
*key*-mark wholesale clear stays 0178's family; D2 here draws the *model*-
mark half — the choice and the dance — that 0179 explicitly left
"never re-drawn here"), 0053 D12 F5 (spec.role reaches the model check —
D1 threads the formulation's role through the same parameter's task-caller
arm).

Tier: mechanism (a routing-role application, a selection ordering, a cache
policy — no constitutional principle moved).

### Category scope

- Code homes: `src/runner.ts` (D1 the formulation's chain role and the
  ladder's role), `src/loop-preflight.ts` (D1 the m-mode planning need's
  word), `src/tier.ts` + `src/roles/registry.ts` (D1 the headers restated),
  `src/select.ts` (D2 the probe arm's evidence ordering),
  `src/router.ts` (D2 ProbeTarget carries the remembered mark; D3 the
  cache value `{answer, timeKey}` and the accessors' signatures),
  `src/session.ts` (D2 the failed-probe re-marks restore the remembered
  fields), `src/classify.ts` (D3 classifierTimeKey, the reuse rule, the
  known fast path and the join's wrapped resolution).
- Test homes: `test/agent-fake.test.ts` (D1 the formulation dispatch pin),
  `test/select.test.ts` (D2 the mixed-evidence probe pins),
  `test/classify.test.ts` (D3 the time-evidence pins, the join reshaped),
  `test/turn-recovery.test.ts` + `test/services.test.ts` (the cache
  accessors' new signatures), `test/loop-preflight.test.ts` (D1's m-mode
  need, if its word is pinned — it is not today; the phased pin's title
  already says the truth D1 makes real).
- No packages/auto or auto-server surface (the shells print the core's
  lines verbatim; the routing words are the core's).
- Documentation homes: plans/INDEX.md (the 0217 row + the 0055/0095
  annotations), AGENTS.md (the formulation navigation line names the
  routing role), docs/structure.md (the Formulation task row).

## D1 — the formulation task's session routes under the planning word (the defect ruled: routing drift, not an accepted reshape)

The judge question first, answered explicitly: **the formulation unit's
tier is a defect — routing drift since 0095 — not an accepted reshape.**
The showing, from the tier table's own letter:

- 0055 §5's row is the ruled policy: `phase-plan` (incl. append planning)
  deep, "splits a phase into tasks with dependencies; **every later session
  inherits their mistakes**". The formulation task *is* that session — 0095
  D1's own words: its todo is "the single synthesized prompt input" of "the
  same blocks today's `phase-plan`/`implement-plan` templates stacked", the
  one session that writes every task document the phase executes. The
  rationale applies with full force, and the implement type's execute tier
  is simple *because* "subtasks come out of a deep decompose" — the deep
  planning that justified simple execution is the very session 0095 dropped
  onto the simple tier.
- 0095 D1 changed the machinery (planning as the phase's first ordinary
  task unit, the single todo input, wrap-up verification) and its m-mode
  bullet retired 0053 D12's `implement-scan` special role — but no decision
  block of 0095 amended §5's planning-deep row or confronted the tier
  consequence. The role registry's annotation ("the formulation task's
  session runs under the whole-task role") recorded the enacted fact, not a
  tier ruling. 0113 D2 — written after 0095 — still states "the deep tier
  the planning sessions … dispatch on" as live truth; preflight checks the
  `phase-plan` coverage as "the planning need" while nothing dispatches it.
  That incoherence is the drift signature: three surfaces assert a route
  the dispatch layer no longer takes (P12 — an operator route that stops
  applying says nothing).

The fix: the formulation task's session is dispatched with the planning
role — `chain.role = "phase-plan"` on runTask's chain construction, keyed on
the recognition formulate.ts owns (`task.formulate !== undefined`, the
`Formulate:` field). Every selection site reads `roleOf` — attempt's target,
the failover, recoverySleep, probeSelection, the probe chain's copy — so
the formulation session rides the planning word end to end: the descriptor's
deep tier, the operator's `routes.phase-plan` route and `OPENCODE_AUTO_
MODEL` phase-plan key, the deep tier's no-borrowing rule. The wrap-up stays
the wrapup role (0055 §5's letter: a report over finished, committed work;
0095 D2 kept the wrap-up machinery unchanged — the deep plan check is the
optional verifier's, 0113 D2, which already routes `phase-plan`). The
strict-resume ladder receives the same role through its existing `run.role`
parameter (the parameter's own design, "the session's explicit routing
role … absent = derived from the phase"), so the recorded model's
eligibility is judged against the list the dispatch will use — a routed
planning entry would otherwise be declared dead by a check reading the
whole tier's list.

Preflight's coverage need follows the word that dispatches: the m-mode arm
(a planning input given) reads `{ role: "phase-plan" }` — `implement-scan`
has dispatched nothing since 0095 retired the planning session, the same
dead-word shape as the phased arm the finding names. `implement-scan`
itself stays in MODEL_ROLES and the planning descriptor's routing words
(P13: no vocabulary change, no tombstone — an operator's existing key keeps
loading exactly as it has since 0095, matching no dispatch).

Floors (P10): the implicit registry holds both tier lists identical and
builds routes only from the switches' own keys, so a run without a
`phase-plan` key dispatches the formulation on the same list `whole`
dispatches on — byte-identical. The correction reaches exactly the
layer-backed registry's tier split and the operator's explicit planning
route. One deliberate letter to state plainly: a `whole`-keyed route (a
registry `routes.whole` or an `OPENCODE_AUTO_MODEL` `whole=` key) stops
reaching the formulation session — that route was never the planning's
home; the formulation took it only through this defect.

## D2 — the probe reads its until evidence, and the probe dance never destroys a stated reset

0055 §6.3's probe letter was written in the scope-marks era — a mark meant
"cleared at the next failback boundary", and "ignoring the down marks" was
the whole rule. `until` arrived with 0057 §5.3 (a stated reset outlives the
boundary), every key mark carried one from 0163 D1, and 0179 D1 made the
ring's instants schedule input for recoveryAt while explicitly leaving the
probe seam undrawn ("the probe's wholesale key-mark clear … never re-drawn
here"). The probe choice never re-read the rule after its input changed
meaning.

Two halves:

1. **The candidate order.** The probe prefers the first in-window candidate
   whose mark carries no `until` — recovery unknown, the probe is the only
   way it comes back (0057 S4's own premise, and the reason recoveryAt
   withholds the instant for the whole list) — over one whose `until` lies
   ahead: held evidence the candidate is spent until then, and probing it
   buys a certain failure (one probe's tokens and a stats `probe` count per
   poll round, the finding's measured waste). When every in-window
   candidate is known spent, the first in-window one stands (the list's own
   order — the current choice, unchanged); when none is in-window, the
   first filtered candidate stands in (§10 item 7's never-opens backstop,
   unchanged). recoveryAt is unchanged: its withholding rule and the probe
   now agree on who the poll is for.
2. **The dance preserves the instant.** The probe realizes the mark-clear
   by clearing the candidate's model mark before the dispatch (the ruled
   mechanism, unchanged); probeSelection now captures the cleared mark
   (`until`, `classifier`) and hands it back on the probe target, and the
   failed-probe re-marks restore it: the errored-probe arm re-marks with
   the remembered fields (today it writes a bare mark, erasing a stated
   reset the probe itself never touched), and the failed-probe arm uses the
   probe failure's own stated reset when it has one (fresher evidence wins)
   and the remembered instant otherwise. A successful probe leaves the mark
   cleared exactly as before.

The key-mark half of the finding's family — probeSelection's
`clearRingMarks` clearing every key's `until` — stays 0178 D1's bounded
consequence (the exhausted-ring shape the walk's bound answers), a named
residual there and not re-drawn here.

## D3 — the classifier's cached instant is served only on matching time evidence; the class stays shared

0055 §7.1's Cost clause is right for the class: a provider repeats its
wording across models and windows, and the masked key makes the repeat
free. It is wrong for the instant: the answer's `resetAt` is absolute —
"the prompt gives the current time in the registry's `tz`, so 'resets at
3pm' becomes an absolute time" (§7.1's own words) — and the masked key
erases exactly the digits that say whether that instant still applies. The
finding's collisions are measured: "该模型的使用额度已用完，将于 <time> 重置"
(15:00 vs 21:00) and "Usage limit reached. Please try again in # hours."
(3 hours vs 1 hour).

The rule: the cache entry stores the answer beside the ask's **time
evidence** — the redacted input with ids masked and whitespace collapsed,
times and digits kept (`classifierTimeKey`: a differing request id is not
differing time evidence; a differing reset hour or duration count is). A
later failure under the same masked key receives the full answer only when
its time evidence equals the ask's; otherwise the class alone — the cached
instant is not this failure's evidence (P12: the stale instant read as
fresh is the finding's own measure), the mark clears at the scope boundary
(the classifier's no-instant answer's standing behavior, and with D2 the
until-less mark is the probe's preferred target). Never re-asked: the
budget clause stands — a repeated wording costs one call; re-asking every
differing-time repeat would spend the 20-call budget on one provider's
stable wording, which is the opposite of what the clause buys. The in-flight
join stays keyed by the masked key (digit-differing repeats join — §7.1's
own "retry 3 of 10 / retry 4 of 12" example is one message); the joiner's
resolution passes through the same comparison, the entry being stored
before the joined promise resolves outward.

What the comparison keeps: the absolute-time repeat — the common provider
shape, the same wording with the same "resets at 21:00" — reuses its
instant correctly. What it concedes (a named residual): the
relative-duration repeat at a later clock (the same "in 3 hours" words, a
different true reset) reuses a wrong-but-future instant for one mark —
bounded to one wasted dispatch per lapse, the finding's own bound, after
which the next wording's differing digits answer honestly.

The router's cache value becomes `{ answer, timeKey }` (an internal state
shape, no protocol surface); the policies — the time key's derivation and
the reuse rule — stay in classify.ts, per the router's own comment that the
policies over this state live there.

## Residuals

- D1: the formulation's wrap-up session keeps the wrapup role (simple) —
  0055 §5's letter; the optional plan verifier (0113 D2) is the deep plan
  check. A `whole`-keyed operator route stops reaching the formulation (the
  correction's own letter, stated in D1). `implement-scan` remains a
  routing word that matches no dispatch (its state since 0095, unchanged).
- D2: the scene where every in-window candidate is known spent while an
  until-less candidate sits window-blocked — recoveryAt withholds (the
  window-blocked candidate is not probeable), the loop polls and probes the
  spent in-window candidate each round; bounded to one probe per poll
  round, its instant preserved through the dance. The probe's ring-mark
  wholesale clear stays 0178 D1's bounded consequence.
- D3: the relative-duration repeat at a later clock reuses a wrong-but-
  future instant for one mark (one wasted dispatch per lapse); three or
  more concurrent same-wording failures with differing times may read a
  later ask's stored entry through the join (the two-failure case is
  exact).

## Tests

- agent-fake.test.ts: the formulation dispatch pin — an m-mode formulation
  run over a two-tier fleet (deep [a], simple [s]) dispatches the
  formulation session's prompt on the planning route's model (`a`); on
  pre-fix source the prompt carries `s` (the simple tier's first), the
  finding's own scene. The preflight m-arm need is pinned at its new word
  (a deep-less registry with a planning input exits 1 naming the
  phase-plan sessions).
- select.test.ts: the mixed-evidence probe pins — the finding's repro
  (list [a, b], a marked until +5 h, b until-less: the probe takes b) red
  on pre-fix source (the probe takes a); the all-until-less floor (the
  first in-window candidate, byte-identical); the all-known-spent fallback
  (the first in-window stands); the no-in-window backstop unchanged.
- classify.test.ts: the time-evidence pins — the differing-time repeat
  (same masked key, "21:00" then "22:00") receives the class alone, red on
  pre-fix source (the stale instant verbatim); the matching-time repeat
  receives the full answer; the join reshaped to assert the shared call
  and the served answers (the identity assertion of the old pin replaced —
  the wrap serves the joiner through the same comparison).
- turn-recovery.test.ts / services.test.ts: the accessors' new signatures
  (the seeded entry carries its timeKey).

# 0219 — the clamp's per-key remedy, the window-curable resume, and the host's close against its restart

Status: active-authority (0166 remediation step 059, wave WD-routing; findings 0165-128 = S16-06
(S3, CONFIRMED), 0165-129 = S16-08 (S3, CONFIRMED), 0165-135 = S18-02 (S3, PLAUSIBLE) — 128 and 129
by the S16 record's deterministic traces, 135 by the S18 record's interleaving trace over the
landed 0186 D2 join).

Three defects of the routing family's run-start and recovery surfaces, ruled in one family pass:

- **The capability clamp's one blocking line teaches the most destructive remedy** (0165-128): the
  `--test-by-driver` steer-less error ends "Re-init the project without --test-by-driver" — a
  re-init overwrites every other constitutional key with its default (the shell's own init
  confirm says so), while `amend --test-by-driver false --handover-test false` (the pair amend's
  own refusal honored: amend refuses the flip while handover-test stays on) is the per-key remedy,
  and under a registry the module header's own "choosing a fleet without the weak agent" (0055
  §8.5) is the remedy that keeps the key.
- **The strict-resume eligibility verdict treats a scheduled, self-curing condition as fatal**
  (0165-129): a recorded model outside its `avoid`/`only` window at the re-run instant reads as
  "not usable now" — a dead session; strict (the default) rolls the unit back to its baseline
  (the in-flight work stashed, the unit redone from scratch after the window reopens) and
  non-strict abandons the alive session's accumulated context for a fresh session — though the
  window's opening is a *known instant* the dispatch layer already knows how to wait for (0057 §6,
  0179), and the redo's own dispatch waits just the same when nothing else is usable.
- **`manage.restart` and `close` are unserialized** (0165-135): 0186 D2 serialized restart against
  restart (the one-in-flight join), but `close()` racing an in-flight restart still orphans a
  spawned `opencode serve` — close closes the current (already-closed) instance, the restart's
  spawn then lands in `server` and nothing ever closes it: live, unreferenced, holding its port
  and ring keys until machine reboot. Unreachable in today's serial driver (every restart trigger
  sits inside the one session-driving loop), but nothing enforces it and 0163 added a third
  trigger at new-session starts.

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P8** — every surfaced line teaches its remedy, *a true, minimal one*: the clamp's error names
  the per-key amend (both flags, so the command works as given) and, under a registry, the fleet
  alternative; the re-init teaching is withdrawn (it is never the minimal remedy for one key). The
  host-close teaching lines name what each refused or drained act did.
- **P20** — in-flight work is never destroyed: the interrupted session's accumulated context is
  the in-flight work; a *schedule* (the operator's own declared window) is not evidence of death,
  and "wait out transient faults … naming the instant" (T8) is exactly what the window wait does
  — the instant known, the wait already machinery (0057 §6, 0179's ring half, §6.3's window half).
  Rolling a unit back over a condition that cures itself at a known instant destroys context to
  buy nothing. On the host half: a close during an in-flight restart drains the *fresh* instance
  at once — the close is the run's own terminal act, never a mid-turn kill (the restart path
  itself is the idle-only restart the rotation family already rules).
- **P12** — conservative under uncertainty: the curability arm admits *only* the window fault — a
  down mark, a spent ring, the agent filter, a sub-cap window, a gone entry and a window that
  never reopens all keep today's not-eligible verdict (uncertain readings resolve toward
  no-reuse); the host's closed flag refuses a restart *before* it spawns rather than trusting the
  caller's ordering.
- **P10** — the byte-identical floor: a usable recorded model (the pick arm) byte-identical; a
  registry-less record (no model to judge) byte-identical; the serial driver's close (no restart
  in flight) byte-identical; the 0186 D2 join, the external-server arms and every other clamp
  note byte-identical. The three defects' own bytes are the exemption.
- **P13** — frozen additive-only vocabularies: the error's and the two host lines' wording is
  teaching copy, not protocol; no exit code, marker or event vocabulary moves; `select.ts` gains
  one exported pure function (machine surface, the `recoveryAt`/`nextOpening` family's own
  idiom), no frozen grammar touched.
- **P5** — single ownership: the curability verdict is computed beside `faultsOf` in `select.ts`
  (the one home of the four faults), consumed by `resumeModelEligible` (the one home of the
  eligibility verdict) — no second faults copy in router.ts; the closed flag lives on the host
  beside the `restarting` promise it composes with (one owner of the host's lifecycle state).
- **P17** — declared concurrency, one sole writer: the host's lifecycle (`server`, `restarting`,
  `closed`) has one writer home in `manage`'s closure; the flag makes close's claim ("nothing
  spawns after me") structural instead of assumed, the same shape the agent pool's own `closed`
  guard already holds for starts (a start resolving past close closes itself).
- **P19** — measured evidence: 128 and 129 are the S16 record's deterministic traces (the amend
  refusal read off the shell's own usage arms; the eligibility trace over a one-entry `only`
  window); 135 is the interleaving trace over the landed code — no concurrent-driver harness
  exists, so the pin is the deterministic interleaving over injected spawn/close doubles, not a
  live two-driver reproduction (the finding's own "reproduction infeasible here").

## D1 — the clamp's error teaches the per-key remedy and the fleet alternative (0165-128)

The error's tail "Re-init the project without --test-by-driver." is replaced by two remedies, in
cost order:

> `… this agent cannot[ (<label>)]. Turn both keys off per key: opencode-auto amend <dir>
> --test-by-driver false --handover-test false[; or point the run at an agent that takes messages
> mid-turn (OPENCODE_AUTO_AGENT=opencode, or the config's agent key) and keep --test-by-driver]`

— the per-key clause names the pair (amend refuses `--test-by-driver false` alone while
handover-test stays on, so the command must carry both to work as given — the shell's own
`handoverRemedy` line spells the same pairing); the fleet clause rides the registry label
(`labelNotes && weakSteer`, the forcing-agent mechanism the other notes use) and follows 0218 D1's
wording for the agent switch. The bin name is the standing core-side literal
(`opencode-auto amend <dir>`, config.ts's own `AMEND_COMMAND` shape — the CLI named in every
shell). The error still fires on exactly today's condition (0083 D9's derived code-work fact,
dryrun exempt); only the remedy moves. The module header's steer row keeps its "startup error"
wording — the ruling's tail is the error's own business.

**The floor.** Every non-error degradation note, the single-agent wording (no label, no fleet
clause), and the error's firing condition: byte-identical.

## D2 — the eligibility verdict splits by curability: a window-blocked recorded model is eligible-with-wait (0165-129)

`resumeModelEligible` keeps its first arm unchanged — a continuation pick of the recorded model
(usable now, §6.2's own keep) is eligible. A second arm is added: the recorded model is *also*
eligible when it is blocked **only by its window and opens at a known instant** — still in the
call's candidate list (the tier list, route or override of the record's role/phase), passing the
agent filter, holding the recorded key (the continuation branch's own `holds` identity), not
marked down, its ring not spent, its known window not below the cap, and `nextOpening` naming the
instant. The verdict is computed beside `faultsOf` (select.ts exports one pure function —
`windowCurableAt`, the `recoveryAt` family's own idiom) so the four faults keep their one home;
`resumeModelEligible` remains the one eligibility verdict, and `deadSessionWhy` — which asks it —
stops declaring a window-curable session dead on both its consumers (the shared recovery ladder's
strict `modelOk`/`dead` pair and the non-strict reuse arm).

The session is then reused, and what its next dispatch does is §6.2's own law, untouched: a
continuation keeps the chain's model *while usable* — outside its window the dispatch takes the
first candidate usable now (another model's failover, the same choice a fresh session gets, the
mid-prompt window-close semantics) or, with nothing usable, waits for the earliest opening
(the ⏸/→ wait lines the person already reads). Either way the accumulated context is kept —
P20's letter — where the rollback bought a stash and a cold redo.

Rollback (and the non-strict fresh session) stays for every other shape: the model gone from the
registry, excluded by the agent filter (the recorded-agent half — a true dead verdict, the
finding's own family note), marked down, its ring spent, its known window below the cap, absent
from the call's list, or outside a window that never reopens (`nextOpening` undefined — no
instant to wait for; the conservative direction). The strict rollback's why line and the
dead-session line are unchanged for those shapes.

**0055 §10 item 11 amended** (the finding's own directive): "the recorded model becomes an
internal name plus agent, and eligibility replaces equality (§8.3). A window change alone does not
roll a unit back" — the eligibility's letter is completed: a recorded model blocked only by its
windows, opening at a known instant, is *eligible* (eligible-with-wait); the dead verdict is
reserved for the shapes above. 0055 §8.3's helper description ("`resumeModelEligible` (a
continuation selection over the recorded internal name …)") grows the second arm in the same
reading; the pin that encoded item 11's old letter (unit-commit.test.ts's "not eligible: … outside
its windows") is re-pointed in the same lockstep — 051's 0059 D7 precedent.

**The floor.** A usable recorded model, a registry-less record, a gone/down/filtered model, the
recorded-agent half, and both callers' every other rung: byte-identical.

## D3 — the host's close is safe against its own restart (0165-135)

`manage`'s host gains a `closed` flag beside the 0186 D2 `restarting` promise — the pool's own
closed-guard shape, moved down one layer to the lifecycle's owner:

- `close()` sets the flag and closes the current server (today's act, unchanged).
- A `restart` arriving after close refuses before spawning — no new instance, the false answer
  (the external arm's own "did not restart"), one teaching line (`⚠ <reason>; but the host is
  already closed — no server restarts after close`).
- A restart already in flight when close lands spawns as it must (its `server.close()` ran before
  close); the spawn's result is checked against the flag the moment it resolves: a fresh instance
  into a closed host is closed at once — never assigned, never leaked — with one teaching line
  (`⚠ the host closed while a restart was in flight; the freshly spawned opencode server was shut
  down`), and the restart answers false (nothing restarted: the host is closed).

The 0186 D2 join is untouched (joiners of a drained restart share its false); the flag's
post-spawn check and the entry check are the two deterministic points of the interleaving —
`close()` is synchronous, so no third window exists between the check and the assignment.

**The floor.** The serial driver's close (no restart in flight — every restart trigger sits inside
the one session-driving loop): one flag write and the same single `server.close()` —
byte-identical. The external-server arms, the join, `setConfig`, `syncContext`'s restart, and the
proxy's always-current targeting: unchanged.

premises this ruling changes: **0055** (§10 item 11's eligibility letter completed by D2 — a
window-only block with a known opening is eligible, not dead; §8.3's helper description grows the
arm; re-read in the same change: the §6.2 continuation keep, the §6.3 window wait and the §8.3
agent half all stand — D2 composes with them and changes no dispatch behavior; 0055's INDEX row
annotated). 0083 D9 re-read and stands (the error's condition is untouched; only its remedy
moves). 0186 D2 re-read and stands (the join is the restart/restart half; D3 is its close/restart
complement, the flag composing with the promise, never replacing it). 0178 re-read and stands (the
restart-safe-boundary family: rotation restarts stay immediate, the walk's gates untouched; D3
adds no gate on any restart the serial driver takes). 0218 re-read and stands (D3's host is the
same `manage` whose connect clock 0218 D3 ruled; the ceiling vocabulary is untouched — the drained
instance is idle by the restart path's own precondition, no ladder involved).

Derives: **P8** (the two remedy-bearing errors and the two host teaching lines), **P20** (the
context kept over a self-curing schedule; the close never a mid-turn act), **P12** (the curability
arm's narrow admission; the closed-host refusal before spawn), **P10** (the floors above),
**P13** (teaching copy only; one additive pure export), **P5** (the faults' one home; the host
lifecycle's one owner), **P17** (the close's claim made structural — one sole writer of the host's
lifecycle), **P19** (the traces the ruling rests on, and 135's deterministic-interleaving pin
named as what it is). Tier touched: **mechanism** — `src/capability.ts`, `src/select.ts`,
`src/router.ts`, `src/agent/opencode/server.ts`, the comments of `src/resume-gate.ts` and
`src/unit-commit.ts`, the test homes; no principle text moves.

## Category scope (0123 D1's discipline)

Family: *the run-start clamp's refusal copy, the strict-resume eligibility verdicts, and the
managed host's restart/close lifecycle* (0040/0083 D9's clamp, 0055 §8.3/§10 item 11's verdicts
over select.ts's faults, 0186 D2's one-in-flight restart). Home-set enumerated at ruling time:

| home | disposition |
|---|---|
| `src/capability.ts` (the error's remedy tail; the steer row's comment) | changed — D1 |
| `src/select.ts` (`windowCurableAt` exported beside `faultsOf`; the header note) | changed — D2 |
| `src/router.ts` (`resumeModelEligible`'s second arm; the §8.3/§10-item-11 comments restated) | changed — D2 |
| `src/resume-gate.ts` + `src/unit-commit.ts` (the verdict comments restated to the curability letter) | comment — D2 |
| `src/agent/opencode/server.ts` (the `closed` flag: the entry refusal, the post-spawn drain, the two lines; `close` sets the flag) | changed — D3 |
| `plans/INDEX.md` (the 0219 row; 0055's row annotated) | changed — D2 |
| `AGENTS.md` (navigation lines: the routing row gains 0219, the model-registry row's resume clause, the opencode-adapter row's close) | restated |
| `docs/structure.md` (select.ts, router.ts, server.ts rows) | restated |
| Test homes: `test/capability.test.ts` (D1's remedy pins), `test/unit-commit.test.ts` (D2's verdict pins; the item-11 pin re-pointed) + `test/resume-gate.test.ts` (D2's ladder pin), `test/agent-server.test.ts` (D3's interleaving pins) | changed |
| `src/agent-pool.ts` (its own closed guard), `src/session.ts`/`src/attempt.ts` (the restart triggers), `src/keyring.ts`, `src/model-window.ts` | held, untouched — the pool guard stands beside the host guard; the triggers and the window math unchanged |
| The dispatch-side window wait (`src/engine/dispatch.ts`, `waitPayload`), the strict rollback machinery (`rollbackUnitState`) | held, untouched — D2 feeds them, never changes them |
| The claude adapter (`src/agent/claude/*`) | held, untouched — 0218's seams; D3 is the opencode host's own lifecycle |

## Residuals

- **D2's curability arm admits the window fault alone by design**: a model both window-blocked and
  down-marked (the mark outliving the window) stays dead — the mark is failure evidence the window
  cannot cure; a ruling that wants the conjunction admitted needs its own incident (P19).
- **D2's reused session may fail over at its next dispatch** (another model usable now): the
  context is kept, the model is not — §6.2's letter, restated here so nobody reads D2 as a
  model-pinning promise.
- **D3's drained restart answers false to its joiners**: a caller that keyed on `true` to conclude
  "a fresh server exists" must re-check — today's callers log-and-continue on false (the external
  arm already answers false), no caller measured to key on it.
- **D3 covers close-against-restart on one host**: two *hosts* over one project store (two pool
  profiles of one adapter) remain the pool's layer — the finding's "second driving loop" shape
  needs the pool-level serialization a measured incident does not yet demand (P21).
- 0186 D2's residuals otherwise stand (the external-server refusal, the restart-under-live-siblings
  deferral riding 0178).

## Tests

- `test/capability.test.ts` (D1): the error names the per-key amend command (both flags) and —
  under `degradeAgents` with a labeled forcing agent — the fleet alternative with the agent
  switch; "Re-init" is absent; the single-agent (`degrade`) error carries the amend clause and no
  fleet clause; the firing condition's existing pins stand. Fail-before red (the tail taught
  re-init; the clauses did not exist).
- `test/unit-commit.test.ts` (D2): the finding's scene — a one-entry registry, the recorded model
  outside its `only` window at the re-run instant — `resumeModelEligible` true and
  `deadSessionWhy` undefined (the item-11 pin re-pointed from its old false expectation in the
  same lockstep); the floors — a down-marked model, a gone model, the agent-filter half — keep
  their false verdicts; a never-opening `avoid`-all entry stays not eligible. Fail-before red (the
  pre-fix verdict is the pin's old expectation, `false`/`"not usable now"`).
- `test/resume-gate.test.ts` (D2): the ladder pin — strict, an alive usable session, a
  window-curable recorded model (a routing facts injection) → `reuse`, not the rollback. Fail-before
  red (the pre-fix ladder rolls back with the dead why).
- `test/agent-server.test.ts` (D3): the interleaving — a restart whose injected spawn resolves
  slowly, `close()` landing mid-spawn → the spawned instance closed exactly once, `server` never
  reassigned (the url unchanged), the restart answering false, the drain line logged; and a
  restart after close → no spawn, false, the refusal line; and the floor — close with no restart
  in flight closes the current instance once (byte-identical). Fail-before red (the pre-fix host
  assigns the fresh instance and never closes it; the late restart spawns).

# 0105 — driver-helper: the person-proxy brief, rendered from live state

Ruled from dm-flash's R-01→R-02 boundary (2026-10-18). The project sat at
its first round boundary — R-01 complete, `transfer` the next act — and the
person wanted R-02 to adopt the verification method of a sibling workspace
(`../dm-all`). Handing that wish to a coding-agent session working in the
target directory required a hand-drafted paste-prompt, and the drafting
exposed two failure modes that make the hand-written form the wrong
permanent answer:

1. **Staleness by hand.** Every fact the brief needed — which round and
   phase, which gate holds, which documents are open to the person's pen,
   which command recovers — is state the driver already derives and prints
   at its stops. A hand-written copy drifts the moment the next advance
   lands, and nothing flags the drift.
2. **Role recruitment.** The installed manual suite (`prompts/`, 0093) is
   the designed reading for a coding-agent session in the target directory —
   and its master control recruits its reader as the *driver*
   (`prompts/run.md`: "The session takes the role of the driver
   (`opencode-auto run`)"). An agent told to "learn the system from
   `prompts/`" and handed a wish will hand-drive the round, or stall at the
   boundary the suite deliberately leaves out (0088: the round close stays
   out; the round open with it — both are `transfer`'s).

What the person needed is a third role beside the two the tool already
renders context for: the **driver** (the manual suite, 0093) and the **guest
task session** (the work order, 0076). This plan adds the **person's
proxy** — a coding-agent session holding the person's pen at the brackets
`run` cannot cross — and its context is rendered by the tool, from live
state, so it can never be stale and never misname the role.

## The ruling

One read-only command, `driver-helper [dir]`: it renders, from the same
state derivation the stop lines already use, the brief a person-proxy
session needs — and does nothing else. It writes no file, parses nothing
back, and changes no existing command's behavior. The proxy's writes land
in person-owned channels that already exist (the round brief, the planning
input, the release marks, `Choice:` lines, `close`/`amend`/`sync`/`fix`),
and the next `transfer`/`plan`/`run` recovers by the re-derivation it
always performs. The 0101 thesis — state lives on disk, the documents
decide, every invocation re-derives — makes the recovery half of this
feature zero machinery; the entire cost is one renderer and one map.

## D1 — read-only, stdout, flagless

`driver-helper [dir]` joins `status`/`models`/`install-prompts`/`release`
in the shell's FLAGLESS read-only family (`packages/auto/src/index.ts`). It
takes no run lock — a live lock is *reported* in the brief (D3), never
refused on, because the brief is exactly the thing a person reads while a
run sits blocked. The `plan --scaffold` precedent governs the shape: print
to stdout, exit 0, nothing written into the target. Rejected: a committed
helper document under `docs/` (the blockage-dossier pattern, 0082) —
dossiers are decision documents with a grammar the driver parses; a brief
is ephemeral rendering, and committing it would create the second
interface D4 forbids.

## D2 — the brief is state-keyed

One brief per stop state, resolved by the predicates the router and the
stop lines already use — no new state model: `analysisGate`'s shapes and
`routePhase` (plan/execute/complete/blocked) in `src/plan.ts`/`src/phases.ts`,
`phaseGateProblems(["human"])` and the acceptance gate (`phases.ts`
`phaseGates`), `awaitingFormulation` (`src/formulate.ts`),
`roundCloseProblems` (`src/round-close.ts`), the live-lock check
(`src/lock.ts` `lockLines`), and preflight's notices. A healthy mid-state
(work pending, nothing holding) renders the rhythm brief — "`run` executes;
the boundary follows" — not an error: the command is consultable at any
moment, not only at stops.

## D3 — content blocks

The brief is six blocks, in order:

- **ROLE** — the proxy pin, the load-bearing block: the session holds the
  person's pen; the CLI is the driver; it never writes implementation
  code, never launches task sessions, and never takes the manual-driver
  role of `prompts/run.md` — the suite is reference material, not the
  execution path. It names the hard rules (no writes to `.auto/`, phase
  ticks, `todo.md`/`done.md` renames, `brief.md`, `AGENTS.md`; no
  in-flight writes while a run holds the lock; the one person-commit is
  the round-start `round.md`).
- **PRIMER** — `DRIVER_PRIMER` verbatim from `src/agents-block.ts` (the
  same literal the guidance states render — one working-model text, D6).
- **STATE** — the live facts and the stop's own lines. The emitters that
  return lines are reused verbatim (`establishStopLines`,
  `roundCloseRefusalLines`, the transfer refusals); the `log()`-style ones
  (`logGateStop`) gain a lines-returning twin if they lack one — a brief
  that could disagree with the terminal is worse than none.
- **CHANNELS** — this state's rows of the D5 map: each open document with
  its path, its grammar, and its commit ownership (the round-start
  `round.md` is committed by the person; `plan-input.md` is written by the
  person and committed by the driver; release marks are whole lines the
  next advance reads).
- **POLICY** — `ASSIST_RULE` verbatim (`src/agents-block.ts`) plus the
  state's recorded defaults (`Recommend:` lines on held forks, recorded
  AUTO-RESOLVE defaults, the round report's needs-attention section), and
  the boundary: everything else is stop-and-ask.
- **RECOVERY** — the exact commands for this state, the same next-lines
  the stop prints (rendered with the brief's own `[dir]` argument).

## D4 — no parse-back

`run`, `transfer` and `plan` gain zero new inputs. The proxy's only
outputs are writes into already-parsed channels and invocations of
existing commands. A free-form "helper context" read back by the driver
would be an unauditable instruction channel beside the fixed documents —
the exact hole 0082's charter-clamp work closed — and it is refused here
as a hard boundary, pinned by test (see Verification).

## D5 — the state→channels map

The heart of the renderer: one table, each row carrying its detection
predicate (by import, never re-implemented), the channels open at that
state, and the recovery command. Every grammar and command already
exists — the map invents nothing; it names, per stop, what the person's
pen may touch.

| State (detection) | Open channels | Recovery |
|---|---|---|
| project start, analysis stub unreleased (`analysisGate`) | `docs/analysis.md` — its sections, `Fork:` lines, `## Project brief`, `## Roadmap`; release by whole-line `Clarified: yes` | `transfer` |
| round-start gate G1 (`establishStop`/`establishStopLines`) | `docs/R-NN/round.md` — goal, acceptance and release criteria; the person commits it (the review act) | `transfer` |
| formulation review stop (`stopBefore: "formulate"`, `awaitingFormulation`) | the phase's `plan-input.md` (a changed text restarts the open step); the round brief and the project brief are the other fixed inputs | edit, then `transfer`; then `plan`, `run` |
| human gates (`phaseGateProblems(["human"])`, acceptance gate) | survey's `survey.md` — fork answers, `Recommend:` defaults, whole-line `Clarified: yes` (the brief proposal rides the release); acceptance's `Accepted: yes` where declared | `transfer` |
| phase boundary stop (run's default `--boundary stop`, `logGateStop`) | read the phase handover and task reports; the next phase's `plan-input.md` may be written ahead | `transfer` |
| round-close gate held (`roundCloseProblems`) | `## Close` of `docs/R-NN/round.md` (filled and committed by the person); a missing report self-heals through `run` | `run`, then `transfer` |
| roadmap-exhausted stop | extend `## Roadmap` of `docs/analysis.md` with the next round's line | `transfer` |
| task FAIL / blocked (exit 2) | accept with `close <T-NNN> --reason`, or rework | `close`; `run --repair <n>` |
| blockage dossier held | one `Choice:` line in `docs/R-NN/blockage-<seq>.md` | the next advance's executor row |
| config / provenance findings (`fix`, `sync` reports) | `amend --<key> <value>`; `sync`; `fix` | themselves |
| dirty-tree block at a start gate | the person resolves the tree (driver-exclusive leftovers self-heal) | `run` |
| release-gate containment findings (0103) | the nested repository's own fixes | `release` |
| nothing to advance (pending tasks) | none — the next act is execution | `run` |
| run lock live | none — wait for the run to end | — |

## D6 — reuse over new text

PRIMER and POLICY render the existing `agents-block.ts` literals verbatim;
STATE and RECOVERY reuse the stop-line emitters. The dm-flash prompt that
motivated this plan was hand-built from exactly these materials plus the
map — the implementation is that document minus its author.

## D7 — stop lines unchanged in v1

The terminal stops keep their bytes (the ratchet families pin them);
discovery of the command rides usage, the shell README and this record.
If field use shows the stops should name it, the change is one uniform
suffix across the person-gate stops, a conscious ratchet edit in one
change — never piecemeal.

## D8 — trust model unchanged

The proxy holds the person's pen under the same backstops that bound any
session: `protect.ts` (config, brief and AGENTS.md read-only during runs),
the clean-tree start gates, the close-out SHA audit, the P1 and
containment scans. The brief renders references, never values (the 0055
registry rule): models and keys appear as the references they are. Nothing
new enforces the ROLE block because the existing gates already do.

## D9 — deliberately not replicated

No work-order adoption path (0076 stays the guest *execution* channel;
driver-helper is the *decision* channel — a proxy never executes task
units). No new document roles or protocol literals. No driver-side launch
or scheduling of the proxy session — the person pastes the brief into the
coding agent of their choice, the same posture as install-prompts: the
tool renders, the person launches. No changes to `run`'s input surface.

## Implementation sketch

- `src/driver-helper.ts` (core): the map constant plus
  `renderHelperBrief(dir, opts)` — pure rendering over the existing
  predicates; no writes, no lock, no services.
- the shell row: the FLAGLESS read-only family, print + exit 0.
- `test/driver-helper.test.ts`: one case per map row pinning the rendered
  sections (the manual-prompts-ratchet precedent — literals pinned so
  drift is loud); a D4 pin (the module imports no writer; a render
  against a fixture target leaves the tree byte-identical); the
  ROLE block pinned to name `prompts/run.md` as reference-not-role.

## Verification

A new read-only command touches no existing surface: core typecheck
clean, the new suite green, the full suite byte-identical expectations
(zero pin edits) — the same shape as 0093's verification. The first
customer is dm-flash's R-02 opening: the G1 brief there renders the
round-brief channel, the survey gates ahead, and the `transfer` rhythm —
the hand-drafted prompt of the ruling, minus its author and his staleness.

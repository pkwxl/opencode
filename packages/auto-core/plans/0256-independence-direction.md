# 0256 — the independence direction: the wake-up daemon, the slim-down, and the opencode decoupling

Status: **direction ruling, 2026-11-19.** The maintainer's decision, recorded
as the program it is: (1) the AgentClient component splits off, and on its
foundation a **daemon-style coding-agent wake-up tool** is built — a resident
proxy for coding agents that talks to the coordinator and wakes a CLI coding
agent (claude, codex) when work is claimed; (2) the core **slims down**,
removing what reverse-control makes unneeded — the subtask family, push-path
glue, the daemon's push run host — keeping only what works beside the
coordinator; (3) the project **decouples from opencode entirely** — its own
repository, its own name, no dependency on opencode's implementation. No
code lands with this document; it records the decision, the censuses that
ground it, the three programs, and the stage plan with its gate.

Derives: P2 (the direction is the person's own boundary act — and every
stage still terminates at the person: the demolition is gated on the
convergence review's verdict, never taken by momentum), P6 (relocation, not
rewrites — one ingredient per move, every step green), P10 (the transition
keeps the push path standing until the gate; the manual suite kept as the
only no-server floor), P13 (the rename and every retirement are conscious
locksteps with their remedy families — tombstones for retired keys and
flags, a mechanical migration for the renamed surfaces), P14 (the split
extends the declared-seam discipline — the SDK confinement held, so the
decoupling is extraction; the wake-up tool a new client on the protocol's
public wire, never a core dependency), P18 (after the split the core carries
zero runtime dependencies — plain files and git made literal), P19 (the
censuses below are measured; the gate is measured dogfooding, not design
elegance), P21 (each stage's machinery waits for its consumer — the fine
inventories belong to the slices that move them). Amends **0246 D11** (the
endgame's disposition half decided: the push path is demoted-then-removed
once convergence completes and the review rules go — the *whether* the
person's settled act, the *when* still the review's measured verdict) and
**0255** (its revisit trigger's maintainer-order arm exercised as direction:
the review re-runs at the convergence milestone over the dogfood counts,
its verdict the demolition gate — stage 5 below).

## Category scope

Tier: direction — a ruling over programs, not a mechanism; the stages carry
their own tiers and homes.

Premises this ruling changes: enumerated in the premise guard below.

## Census A — the relocation map (measured 2026-11-19)

**The executor surface already stands on the decision layer alone.** The
measured import set of `src/executor-{coordinator,steps,worktree}.ts` is 22
local modules — git, tasks, document/*, phases, formulate, clarify, execute,
lanes, lock, resume, config, mode, prompt, prompt-facts, doccheck, docpaths
— with **zero imports** of chain/session/engine/models. The protocol surface
is today independent of the machinery being relocated; the split is a move
along a seam that already exists.

| Family (auto-core src) | Lines | Disposition |
|---|---|---|
| Agent domain (`src/agent/**`, incl. both adapters) | 2,520 | **Moves** to the wake-up tool |
| Engine (`src/engine/**`) | 3,237 | **Moves** |
| Session driving (chain, session, session-api, attempt, watch, exec-session) | 3,265 | **Moves** |
| Model registry family (models*, model-*, select, routing, keyring, classify, agent-env, failback, tier, quota-windows) | 4,113 | **Moves** (the wake-up tool owns model choice for the agents it wakes — the coordinator needs none, 0246 D9) |
| Agent plumbing (agent-pool, agent-choice, capability) | 923 | agent-pool **moves**; agent-choice/capability **die** at the demolition (core glue with no executor consumer) |
| Subtask family (split.ts, execute's subtask arms, the config key, fanout.md, subtasks.md machinery) | — | **Dies** at the demolition (the maintainer's decision; the whole-task split rule already delegates decomposition inside one session) |
| Journals (run-events, stats, conclusion) | — | **Shared-or-push-only, decided at the demolition slice** by consumer census — the coordinator's report ledger is git's log (0246 D4), but stats/conclusion rendering may have executor-side consumers |

auto-server, classified: the **protocol and person surface stays** (daemon's
executor routes, executor-request/bridge/worker, ws-protocol, store,
project-creation, question-journal, ops' config/units/plan arms); the **push
run host dies** at the demolition (worker.ts, worker-command.ts,
worker-interactive.ts, interactive-ws.ts, observe's run arm, src/web) —
measured consumers of agent-pool/models-describe/engine-events are exactly
observe.ts, ops.ts (the models probe arm), and worker-interactive.ts.
ws-protocol's typed frames are shared by the interactive bridge and the
executor wire; the demolition slice decides their split.

## Census B — the opencode touchpoints (measured 2026-11-19)

| Touchpoint | Where | Program |
|---|---|---|
| `@opencode-ai/sdk` — auto-core's **only** runtime dep, confined to 3 files (`src/agent/opencode/{client,events,server}.ts`) | verified | Moves with the agent domain; the core is zero-dep after |
| `opencode serve` managed host (agent-pool's spawn, the registry's server validation, keyring substitution) | agent family | Moves; opencode becomes at most one more CLI the wake-up tool may drive |
| Names: `@opencode-ai/*` packages, `opencode-auto`/`opencode-auto-server` bins, the CLI README | everywhere | Stage 7's rename lockstep |
| Target-directory surfaces: the `.opencode/auto/` home, `templates/opencode.json` (the committed project surface), `.opencode/auto/models.json` (local-only), the AGENTS.md block | config.ts, templates/, the shells | Stage 7 rules the new home + the mechanical migration (the breaking family carried by the independence cut); `opencode.json` and `models.json` stop being core surfaces — agent config becomes the wake-up tool's business |
| Monorepo embedding: `workspace:*`/`catalog:`, the branch model, the shell branches (migrate +43 frozen by contract, migrate-hw +44, quota, translate, auto) | repo level | Stage 7's extraction, one mechanical move at the final shape |

## Program W — the wake-up daemon

0246's **hub posture, productized**: a resident proxy holding the executor
channel, claiming work, waking a CLI coding agent per step with the rendered
brief, reporting, heartbeating. **Zero protocol change** — the wire was
designed agent-neutral with task-addressed claims ("a hub assigns, a child
self-serves") from slice one. Design boundaries pinned here: the daemon
holds a **worker channel, never person scope** (0246's named residual — an
agent granted releases can release surveys the human never read); it owns
its leases' heartbeats and **releases cleanly on shutdown** (a dead daemon
strands leases to the deadline — the release ladder is its own duty); the
claude adapter (0218) is the template, a codex adapter is new work; the
model registry and keyring relocate to it as the chooser of which agent and
model to wake. It is built inside the monorepo first (stage 3) — fast
iteration — and extracts with the whole family at stage 7.

## Program S — the slim-down

Relocate-then-delete, never delete-what-you-still-import: the relocations
happen at stage 3 (the split), the deletions at stage 6 (after the gate), so
the core is never broken mid-transition. What dies: the subtask family, the
push glue (agent-choice, capability, the run-start routing wiring),
auto-server's push run host. What stays: the coordinator and its decision
layer, the git/commit machinery, the tasks/document/phases families, the
person commands, the prompts — and **the manual suite**, which becomes the
only no-server floor once the push path dies and is kept deliberately
(P10's floor made of prompt copy).

## Program D — the decoupling

The rename is ruled: independence includes the name — a new project name,
new package namespace, new bins, and a new config home replacing
`.opencode/auto/`, with a **mechanical migration** as the remedy family
(one command moving the old home to the new, refusing on unknown shapes).
The independence cut carries this breaking family in words, as the spine
requires. The repository extracts **last, in one mechanical move** — moving
earlier would relocate code twice and drag the shell branches through
unnecessary merge pain; the shell contract is re-homed by that move (the
shell branches' merge model becomes the independent repo's own; their
standing census observations carry over as history).

## The stage plan (the D10 pattern continued)

1. **This ruling** — the decision, the censuses, the programs. No code.
2. **Coordinator-side convergence** — three slices: formulation steps, the
   transfer advance's session work, the close-audit, each riding the
   protocol with its derivation and tests.
3. **The wake-up tool split** — in-monorepo; the five families relocate one
   ingredient per change; the codex adapter; the heartbeat/release ladder;
   the ratchet's executor prompt gains the daemon's postures beside the
   suite's existing pins.
4. **Dogfood** — this repository runs protocol-only through the wake-up
   daemon: adoption site #1 by the maintainer's own record, filling 0255's
   instruments (adoption counted, the incident ledger started).
5. **The convergence review re-run** — 0255's instrument at the
   maintainer's order, over real counts. Its verdict — the protocol carries
   the full round lifecycle — is **the gate**: nothing in stages 6–7 starts
   before it rules go.
6. **The core slim-down** — the deletions, each family its own change with
   tombstone and remedy; the journals' shared-or-push-only split decided by
   consumer census here.
7. **The extraction and rename** — one mechanical move to the independent
   repository; the rename lockstep; the independence cut.

## The gate

Stage 5's verdict is the demolition's formal go. Until then the push path
stands unchanged (P10) and every convergence slice lands additive. A review
verdict of not-go amends nothing: the stages hold, the dogfooding continues,
the demolition waits — the direction is decided, the timing stays measured.

## Premise guard

premises this ruling changes: **plans/0246** (D11 — the endgame's
disposition half decided, the staging extended past D10's eight slices into
this document's seven stages), **plans/0255** (the review's role extended
from convergence trigger to demolition gate). Re-read in this change:
**plans/0037–0057 / 0218 / 0219** (the adapter lineage — stands, its homes
scheduled to move at stage 3; the letters unchanged), **plans/0061 / 0185 /
0186 / 0187** (the session-driving family — stands, relocates), **plans/
0055 and the model-registry line** (stands, relocates; the coordinator's
no-registry letter already ruled in 0246 D9), **plans/0059 / 0171 / 0211**
(the subtask family — stands until stage 6 tombstones it with its remedy),
**the 0078 lineage** (the manual suite — stands, re-affirmed the only
floor), **plans/0067** (the daemon lineage — the ops/protocol surface
stands; the push run host dies at stage 6), **docs/shell-contract.md** (the
branch model — stands until stage 7 re-homes it), **the security family in
AGENTS.md** (the keyring/env letters stand; their homes move at stage 3).
Each stands as written for every surface this ruling does not touch.

## Residuals

- The engine's double life between stages 3 and 6: two homes, drift risk —
  the wake-up tool's copy is the live one, the core's frozen at the split
  commit and deleted at the demolition; no fix lands in the frozen copy.
- The rename's blast radius is every existing target checkout; the
  migration must be mechanical and refuse unknown shapes — anything it
  cannot prove, it names for the person.
- The wake-up daemon inherits the hub-relay trust class (a daemon
  misreporting its child meets the verdict machinery; the residual named in
  0246 stands) and the lease-stranding clock (its shutdown ladder is the
  remedy, named in Program W).
- The shell branches are frozen on the pre-independence shape once stage 6
  starts; their refresh is stage 7's move, not a merge — the census will
  record the divergence as intended, not as drift.

## Tests

None land — a direction ruling. The stages carry their own test homes
(stage 2 the coordinator derivations' suites; stage 3 the wake-up tool's
adapter and ladder homes beside the moved suites; stage 4 the recorded
adoption note; stage 5 the re-measured counts; stages 6–7 the tombstone
pins and the migration's tests). The INDEX row, the amendment pointers on
rows 0246 and 0255, and the AGENTS.md navigation line are this document's
only companion changes.

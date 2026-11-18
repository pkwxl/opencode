# 0246 — The executor protocol: reverse-control driving over an open, persistent auto-server

Status: **active-authority** — the design ruling for the reverse-control driving
model: a session started in **any** coding agent (the **executor**, named by a
new suite prompt) sends standardized requests to auto-server and receives the
next step derived from request content and project state, making opencode-auto
a pure workflow-control tool for long-horizon continuous development, bound to
no coding agent — not opencode, not claude, none. The server is the driver:
every driver-exclusive state write and every commit is its own act, inside a
per-project **coordinator** process holding the run lock — the one driver per
directory, unchanged. The protocol's vocabulary is frozen additive. The daemon
gains a specially authorized **open startup mode** (authenticated clients
create and initialize projects under declared roots — no pre-registered
whitelist) and stands as the persistent background service; executor mode is
the primary operating posture this tool invests in. Channels claim work by
task id and kind — solo workers, or a hub session acting as scheduler-only
over child sessions; failure is identified by a four-detector funnel
(self-report, staleness, hub observation, server-side judgment), and a
failed or dead holder's lease is taken over with its dirt absorbed. One
executor session works across many projects, several across one — the
concurrency ladder staged (serial, doc-scoped same-tree, worktree lanes).
The person rides a coding agent too: one channel holds the **person
role** — attending pending questions and gates through the same protocol,
a person-role agent deciding automatically within a delegation envelope
whose every decision is provenance-recorded — the web never required.
The protocol itself — the load-bearing surface — is
ruled to the wire in D4: request and step schemas, the state-derivation
table, correlation and idempotency, failure identification and takeover, the
error planes, the write contract,
the client-side obligations and the canonical flows. **No code lands with
this document**: the enactment is staged (D10), each slice its own numbered
landing.

## Derivation

Derives: **P2** (the person brackets every boundary — the open mode's envelope
is the person's own three acts, starting the daemon open, bounding the roots,
issuing the tokens; every consequential gate inside the envelope — the human
gates, the releases, the closes — still terminates at the person through the
existing channels, and no automatic escalation in the protocol consumes a
**P2** (the person brackets every boundary — and in this mode the person
rides a coding agent: the bracket composes the operator's acts — start the
daemon open, bound the roots, issue the tokens, grant the delegations —
with the delegation envelopes; person work, the questions, gates and
releases, is protocol work claimed and answered by person channels within
their envelopes, every decision provenance-recorded, out-of-envelope
escalation terminating at the human's own channel; no automatic escalation
consumes a closed decision unrecorded), **P3** (completion is never judged by agent self-report —
strengthened, not weakened: the executor's `report` is a turn-ended trigger,
never evidence; the coordinator judges what landed by reading the tree and the
git history, exactly as the automated driver judges a session's end; a
`failed` outcome fails an attempt, never a task — the funnel's only
task-failing detector is the server's own judgment), **P4**
(committing is the completion condition — strengthened: the commit right
returns to a process; the executor prompt teaches no git grammar at all, a
narrower grant than the manual suite's role interpretation), **P5** (single
ownership — the decision layer gets one extracted home shared by every driving
model; each vocabulary one owner: the requests and steps in the server's
request layer, the bridge frames in the ws-protocol, the scopes in the store;
the coordinator is the one owner of a project's dispatch), **P6** (derived
state, idempotence, re-derivation — every request is answered from disk and
git alone; the coordinator idles out and respawns by re-derivation; leases
expire and re-derive; no protocol-session state persists beyond the run record
and the lock; the log is the report ledger — step ids the share grammar
reuses, a replay recognized by the landed share's presence, no request needs
exactly-once delivery; leases extend the progress record and expire lazily
at the next evaluation — no timers, no persisted clock state), **P7** (grammars, never content — the protocol is grammar; the
coordinator measures, gates, intersects and commits; content judgment stays in
the rendered briefs and the verification artifacts, session work by
construction), **P8** (deliberate enforcement moments — blocking reserved for
the stop's own work and the person's moments; every `blocked` step names its
remedy; detections render as observations in `done` summaries), **P10** (the
byte-identical floor — the closed-whitelist default is byte-identical; no
executor run started, nothing changes anywhere), **P13** (frozen additive-only
vocabularies — the requests, the steps, the bridge frames, the scopes, the
registry's channel kind grow additively in one conscious lockstep per slice,
the v1 word sets enumerated once in D4 k; zero new document grammar: the
executor's artifact writes are the existing handoff/gaps/report grammars), **P14** (one-way dependencies through declared
seams — the core's extracted step functions know no HTTP; the server shell
wraps them; the executor sits outside the dependency graph entirely, a client
of the daemon's surface), **P15** (policy is data; governance pinned — the
step prompts are rendered by the existing template renderers, zero copy
authored by code; the executor prompt is registered suite copy), **P16**
(genericity — the open mode's bound is structural, a root directory, never an
enumerated project list; no agent's facts enter core, the protocol
agent-neutral by construction), **P17** (declared concurrency — the
coordinator is the sole writer of a project's shared git state and the
admission authority; fleet concurrency rides the standing
`Depends:`/`Touches:` declarations — claims admitted per them, leases the
grant, takeovers bounded by the attempt cap — bought at the cheapest
fitting tier, wrong declarations surfacing loudly as
ever), **P18** (the record outlives the tool — the durable trail stays plain
files plus git; the protocol adds no durable state of its own), **P19**
(measured evidence — the admission is the corpus's own ledger: the adapter
family's cost, the manual suite's ratchet cost, and this direction's field
origin; the push path's endgame disposition is ruled to be decided by
measurement, never by ambition), **P20** (in-flight work is never destroyed —
mid-unit dirt rides the resumed unit through the standing recovery machinery;
leases expire but the work waits; release and takeover absorb the holder's
dirt, never sweep it; the kill ladder releases the lock without
touching the tree), **P21** (machinery waits for its consumer — v1 rides the
fleet protocol at the serial tier with the hub posture and multi-project
breadth; the concurrency tiers, the subtask pipeline, the phase-level
sessions and the
convergence review are staged with their triggers recorded in C and D10).
Amends: **plans/0067** (§五, the absolute whitelist — additively: the closed
default stands unchanged, and the open startup mode adds the root-bounded
registration arm, the one ruled exception). Tier: **mechanism** — ruled here,
enactment staged per D10.

## The measured findings

The person's direction (2026-11-18): the current default treats opencode as
the invoked coding agent, driving its work by sending prompts to it; the
reverse mechanism instead starts a session in a specific coding agent via the
prompt and sends requests to auto-server, which responds from request content
and project state — work that previously required active invocation completes
inside the coding agent, decoupling opencode-auto from every coding agent's
configuration. Executor mode is to be the primary operating mode: auto-server
gains a specially authorized startup mode needing no pre-configured project
list, subsequent clients create and initialize new projects, and the daemon
runs as a persistent background service. Later: multiple coding agents
collaborating on one project (some work by A, other work by B), and each
coding agent handling work across multiple projects concurrently in the same
session. And the same day's third direction: the person is themselves on a
coding agent — one of the channels *is* the person; sub-agents are workers
or person-role agents making decisions automatically within a delegation;
the server works with coding agents, **never via the web to a person**.

Read against the corpus:

- **F1 — every supported agent is an adapter family.** opencode (0039, 0055,
  0219) and claude (0041, 0055, 0218) each cost an adapter, a capability
  table, and a degradation machinery (0040, 0218, 0219 — the declared
  external_directory posture, the health-probe clock, the strict-resume
  eligibility splits). Each new agent re-pays this; the AgentClient seam
  quarantines the cost but does not remove it.
- **F2 — the manual suite proved the decision layer agent-agnostic, and priced
  the proof.** The suite (0078–0245, roughly fifteen rulings; a 1077-line
  ratchet) hands a prose session the driver's role on any agent: unit picking,
  gates, the verify/fix loop, phase transfer, all in taught rules. But every
  grammar change pays a dual-side prose↔src pin (0203's oracle boundary exists
  precisely because the two halves drift), and the prose session's judgments
  are trusted, not enforced — the suite's own preflight refuses
  driver-machinery features (`testByDriver`, `handoverTest`,
  `acceptanceGate`) rather than emulate them.
- **F3 — auto-server already holds the apparatus a pull protocol needs.** The
  whitelist and scoped tokens, the run registry with worker supervision and
  exit-code mapping, the per-run bridge WebSocket with its per-run secret, the
  question journal with replay, the SSE status tails (0067, 0160, 0162, 0222,
  0223, 0224) — and the ops family shows the in-process library-call pattern
  (`ops.ts` calling core subpaths, workers owning the target writes). Yet
  every run still pushes: the worker runs the classic loop that drives agents
  through AgentClient.
- **F4 — the inversion is not an adapter.** AgentClient presumes push: the
  driver injects a prompt and observes an event stream to idle. A session
  living in a foreign host — the person's coding agent of choice — cannot be
  addressed that way; there is nothing to POST into and no event stream to
  subscribe. What inverts is the loop's direction; what is shared is the
  decision layer (unit picking, gates, verdict judging, the commit boundary —
  agent-neutral today: `src/loop-task.ts` `runSerialUnit`, `src/git-ops.ts`
  `afterSession`, the renderers in `src/prompt.ts`). The manual suite is that
  layer's prose twin; the protocol is its code twin.
- **F5 — registration today is an operator CLI act, and the daemon's letter is
  closed.** `register` writes the data dir directly (the bootstrap problem,
  0160), the whitelist is ruled absolute (0067 §五, trust-boundary
  amplification: a request's `project` resolves only against the registry),
  and init is the `config`-scoped op over registered projects — with confirm
  and clean-tree gates (428/409) and git bootstrapping (0073) already in
  place. A persistent self-serving daemon needs client-driven onboarding; the
  machinery for everything downstream of registration exists.
- **F6 — the corpus already keys multi-agent collaboration.** Declared
  concurrency is a standing family (P17; `Depends:`/`Touches:`), the doc-lane
  lineage runs same-tree concurrency for documentation-scoped units (0099,
  0210, with the race, flatten and rollback discipline), and the worktree
  lanes buy code-depth isolation (0068, 0126). Multi-executor dispatch has a
  keying and a tier ladder to stand on — none of it executor-shaped yet.
- **F7 — the person-facing surfaces presumed a browser.** The question
  channel's answer arm, the gates, the web console's write surface — the
  daemon-run operator's furniture. In this mode the person rides a coding
  agent; if person work stayed web-bound, every question and gate would
  force a context switch out of the agent fleet into a browser the design
  otherwise never mentions. Person work must be protocol work — claimable,
  answerable, provenance-recorded — and the standing machinery already
  carries the truth half (the question journal's settled entries; the
  gates' release marks; proxy-decision audit precedents in the resolve
  family's AUTO-RESOLVE discipline and the person-proxy brief).

## Category scope

The requirement family: **the driving-model family** — who executes the work
and who holds the state — crossing the manual suite's copy family (0078's
corpus, the no-server floor), the server shell's surface family (0067/0160),
and the core's decision-layer homes. This document rules; the homes change
only in the staged slices.

| home | carries | this ruling |
| --- | --- | --- |
| this document | the ruling | **landed** — the vocabulary, the coordinator, the open mode, the staging |
| `plans/INDEX.md` | the corpus manifest | **changed** — the 0246 row lands with this document |
| the core decision layer (a new `src/` home at slice 1; today `src/loop-task.ts`, `src/runner.ts`, `src/git-ops.ts`, `src/prompt.ts` hold it entangled with the loop) | unit picking, gates, verdict judging, prompt rendering, the commit boundary | **staged** (D10 slice 1): extracted as pure step functions, the read-only arm first |
| `packages/auto-server/src/daemon.ts` + `worker.ts` + `ws-protocol.ts` + `request.ts` | the daemon surface, the worker entry, the bridge frames, the request validators | **staged** (D10 slices 2–4): the coordinator entry, the step frames, the executor routes, the open mode |
| `packages/auto-server/src/store.ts` + `src/index.ts` | the scopes, the whitelist, the CLI | **staged** (D10 slice 4): the `executor` and `projects` scopes, the root-bounded registration arm, the serve flags |
| `prompts/executor.md` (name final at slice 5) + `src/install-prompts.ts` + `test/manual-prompts-ratchet.test.ts` | the executor prompt, its installer registration, its ratchet pins | **staged** (D10 slice 5) |
| `packages/auto-server/test/` (daemon, ops, worker, ws-protocol homes) + a new core test file | the slices' behavior contracts | **staged** (each slice lands its own test home with its code — 0110 D13) |

## Decisions

### D1 — the inversion, the three driving models, the primary posture (findings 1–4)

The executor protocol is a third driving model beside the two standing ones.
The automated driver pushes: it renders a prompt, injects it through
AgentClient into a session it hosts or addresses, and observes the event
stream to idle. The manual suite delegates the whole driver role to a prose
session on any agent. The executor protocol **inverts the direction**: the
person starts a session in their coding agent of choice with the executor
prompt; the session — the executor — sends standardized requests to
auto-server and receives the next step; the server derives that step from
project state and performs every driver act itself. The three models share
one decision layer and one commit grammar; they differ in who executes the
work and who holds the git right — the automated driver: a process, both; the
manual suite: the prose session, both; the executor protocol: **the server
drives and commits, the agent executes**. Ruled: this is **not a fourth
AgentClient adapter** (F4) — no adapter can be written for a session the
driver cannot address; the protocol is the decision layer's second code
surface, the loop turned inside out. Executor mode is the **primary operating
posture** — the investment direction, the documented default for
server-mediated work — while the push path and the manual suite remain
supported floors (D11 rules the convergence; nothing is deleted by ambition).

### D2 — server-side drivership (P4)

In executor mode the server is the driver. Every driver-exclusive write and
every commit — the unit-start clean gate and SHA baseline (`beginUnit`), the
session-share landing (`afterSession`), the wrapup report commit, the
close-out (`todo.md` → `done.md`, the index tick, the `.auto/units.json`
cleanup), the park commit, the housekeeping commits — happens inside the
coordinator process, through the core's existing boundaries. The executor's
writes are confined to task-scoped work artifacts: the sources it edits, and
the content of `docs/T-NNN/handoff.md`, `gaps.md` and `report.md` as the
rendered briefs instruct. The executor prompt teaches **no git grammar at
all** — not commit subjects, not trailers, not pathspecs: P4's letter (the
driver holds the commit right exclusively) returns to a process, a narrower
and stronger grant than the manual suite's role interpretation. A commit made
inside an executor session is a protocol violation the close-out audit
catches exactly as it catches any foreign commit in a unit's range.

### D3 — stateless re-derivation; reports are triggers, never evidence (P3, P6)

Every request is answered from disk and git alone: the phase index and unit
files, `.auto/units.json`, the handoff `Status:` lines, the existence and
shape of `gaps.md`, the `Result:` line of `report.md`, the git log and the
recorded baselines. The executor's `report` is a turn-ended signal plus an
optional free-text note surfaced to the person — never evidence: the
coordinator judges what landed by reading the tree, precisely as the automated
driver judges a session's end from artifacts rather than transcript claims.
No protocol-session state persists server-side beyond the run record and the
lock; a coordinator that dies, idles out or respawns loses nothing a fresh
read cannot re-derive. Every crash window is the standing machinery's own
(0149, 0183): mid-unit dirt under an active progress record is the interrupted
unit's resumable progress; the recovery point is written when the execute step
is issued, so a relaunched executor's first `claim` resumes mid-unit. The
machinery is reused, not reimplemented — the protocol adds no recovery story
of its own.

### D4 — the protocol in detail (P7, P13)

The frozen vocabulary, ruled to the wire for a **cooperating fleet**, not a
solo puller. Two authorities, cleanly split: the **coordinator is the
admission authority** — readiness, declarations, scope disjointness, lease
grants, every state write and commit; the **executor side may schedule** —
a hub session (or any channel) sees the claimable set and directs work by
task id, and any number of channels may hold leases at once, per admission.
The vocabulary is additive-only, one owner per surface (the requests and
steps in the server's request layer), and shaped so that **no request needs
exactly-once delivery**: retries converge, crash windows re-derive, and a
dead holder's lease expires by the coordinator's own clock. The blocks:

**a — transport, addressing, channels, roles.** Eight routes under the
daemon's project surface: `POST /projects/<project>/executor/ready|claim|
brief|report|heartbeat|release|question|answer`. Bearer auth; the routes
accept the `executor` and `person` scopes, and **what a channel may claim
derives from its token's scopes** (D8); the project resolves against the
registry exactly as every project route does (open-mode registrations
included). A **channel** is the request identity `(token, channel-id)` —
the id an optional client-chosen field on every request (a hub assigns its
children ids; a solo worker omits it and the token alone is the channel);
whether one channel is a lone session or a hub relaying for children is
the executor's own business — the protocol never distinguishes, and both
shapes are first-class: a child may self-serve (the local-only connection
file is readable in-repo) or ride its hub's requests. Channels carry
**roles**: the default **worker** (holds leases, does execute/verify/fix
work) and the **person role** — the human rides a coding agent in this
mode, so one of the channels *is* the person, or a **person-role agent**
stands for them under a delegation envelope (D8): person work — pending
questions, standing gates, releases — is protocol work those channels
claim and answer (blocks b, h), never a browser surface. Bodies are JSON, bounded by the ops family's 64 KiB carriage
(`REQUEST_BYTE_LIMIT`); responses carry rendered briefs, bounded provisionally
at 256 KiB — measured at enactment against the largest standing template.
Every response is one envelope, `{ "protocol": 1, "step": { … } }` (a raise
answers `{ "protocol": 1, "question": { … } }`); each side ignores unknown
fields in the other's messages — forward compatibility inside a version is
P13's additive letter made mechanical.

**b — the requests.**

- `ready` — body `{ "channel"?: … }`. **Pure**: the claimable set, one entry
  per unit — id, title, the kinds available to claim (`execute` on a clean
  unstarted unit, `verify` on a landed share, `fix` on standing gaps), and
  the declaration summaries (`Depends:`/`Touches:`) — plus this channel's
  own live leases. The hub-as-scheduler's menu; a poll that can never
  commit.
- `claim` — body `{ "channel"?: …, "task"?: "<unit>", "kind"?: "<execute|
  verify|fix>" }`. **The taking request** — it changes state, so it is not a
  poll. Without `task`: admit and grant the server's best pick among the
  claimable set. With `task` (and `kind`): the task-addressed form — a hub
  assigns, a child self-serves — granted only if admission passes (ready,
  no live lease, scope-disjoint from every in-flight lease at the tier in
  force); the grant performs the unit start (the beginUnit gate, the
  baseline, the progress record) where the kind demands it. Idempotent
  per target: a channel claiming a unit it already leases gets the same
  lease and step re-answered, nothing twice. The response is a step.
- `brief` — body `{ "channel"?: …, "task": "<unit>", "kind": … }`. **Pure**:
  re-fetch the rendered brief of a step this channel already holds — the
  relaunched child that knows only its task id, the hub filling a child's
  prompt. Not a lease; a unit not leased by this channel answers a wait
  naming the holder.
- `report` — body `{ "channel"?: …, "step": "<step-id>", "outcome":
  "ended"|"failed", "note"?: "<a few lines>" }`. The turn-end trigger for
  the named step — the only signal that the turn ended, and the exclusive
  authorization for the landing acts: the commit boundary, the verdict
  reading, the close-out. `outcome: failed` is the executor's own wall
  report — it **fails the attempt, never the task** (P3: the landing judges
  the work from disk either way; the outcome word routes the standing
  retry arms and books the attempt). The note is free text for the person,
  never evidence. The response returns the next derived step directly.
- `heartbeat` — body `{ "channel"?: … }`. **Pure**: refresh every lease this
  channel holds (deadline ← now + the refresh window, never past the hard
  cap). For hubs whose children work long turns, and for any worker whose
  host can call out mid-turn.
- `release` — body `{ "channel"?: …, "step": "<step-id>", "note"?: … }`. The
  voluntary give-back: the hub whose child died, the worker declining the
  brief. Expiry now rather than at the deadline — and P20's letter held
  exactly: releasing never touches the tree; whatever the holder wrote
  stays for the successor to absorb, exactly as an expiry's does.
- `question` — body `{ "channel"?: …, "text": …, "task"?: … }`. Raises a
  pending person item through the standing journal; deduplicated: an
  identical unsettled text returns the same question id — a network retry
  never double-raises. Response `{ "question": "<id>", "state": "raised" }`.
- `answer` — body `{ "channel"?: …, "item": "<question-or-gate id>",
  "decision": …, "rationale"?: "<a few lines>" }`. **The person-role act**:
  settles a pending item this channel may attend — a question's answer into
  the journal, a gate's release landed by the coordinator — with the
  decision's provenance recorded (the channel, the delegation envelope, the
  rationale). Bounded by the envelope (block h): an out-of-envelope answer
  is refused with the escalation teaching, never silently honored. The
  decision words per gate kind are ruled at the person slice (v1:
  `release`/`hold` beside free text).

**c — the steps.** The `kind` field discriminates; fields beyond each kind's
table are absent, not null. The three work kinds carry their **lease**
inline: `lease` (an opaque id), `deadline`, `attempt` (the unit's attempt
count — observability), and `workspace` — the path the brief's work happens
in: the project tree itself at the serial and doc tiers, a worktree path at
the worktree tier (the standing lanes machinery, D9's staging — the field
rides v1 always naming the main tree, so the tier grows with **zero
vocabulary change**).

| kind | fields | meaning |
| --- | --- | --- |
| `execute` | `id`, `unit`, `title`, `prompt`, `budget`, `lease`, `deadline`, `attempt`, `workspace` | do the rendered whole-task brief (the continuation brief when a handoff stands — the same kind, the derivation knows); `budget` is wall-clock minutes, v1 the suite's own default 60, advisory: the lease deadline is budget plus grace, the work is judged on disk regardless (P20) |
| `verify` | `id`, `unit`, `baseline`, `head`, `prompt`, `lease`, `deadline`, `attempt`, `workspace` | judge the unit's commit range `<baseline>..<head>` as a fresh pair of eyes — claimable by a **different** channel than the executor's, independence by construction; write `report.md` on PASS, `gaps.md` on INCOMPLETE |
| `fix` | `id`, `unit`, `round`, `prompt`, `lease`, `deadline`, `attempt`, `workspace` | close exactly the gaps the standing `gaps.md` lists; `round` is the `round.session` ordinal, log-derived |
| `wait` | `reason`, `detail?`, `retryAfter` | sleep `retryAfter` seconds, then re-evaluate; v1's reasons: `question` (an unsettled question of this channel's own stands), `gate` (a person-pending item stands — a question or a gate another channel raised, or the state raised; a person channel can attend it mid-flight), `lease-held` (the named task is leased to another channel until its deadline — takeover waits for expiry or release), `not-ready` (dependencies, or a scope conflict with a live lease at the tier in force), `in-flight` (nothing claimable now, work outstanding — the poller's answer between landings) |
| `blocked` | `code`, `remedy` | stop and render the remedy to the person; the codes are a frozen additive set — v1: `config` (driver-machinery keys set, or the target uninitialized), `cleanTree`, `unreadable`, `subtask` (a subtask-configured project refuses executor runs), `fixBudget` (the progress rule exhausted — 0198/0199's bound), `attemptsExhausted` (the unit's attempt ledger past its cap — takeovers included), `mutualPark`, `commitFailed` (a landing failed; the unit stays mid-flight under its record, the person investigates), `isolation` (the close-out audit found foreign commits in the unit's range) |
| `human` | `id`, `gate`, `proposal`, `remedy` | **person-channel work**: a designed person-gate stands — claimable by a person-role channel, decided by `answer` within its delegation (the coordinator lands the release with the decision's provenance); v1's gates: `project-start` (no round established — the assisted analysis), `survey-release` (the release mark). Workers never receive this step — their evaluations answer `wait gate` while it pends |
| `question` | `id`, `text`, `context` | **person-channel work**: a raised question awaits its answer — claimable, answerable within the delegation; on `answer` the reply is rendered into the asker's resumed brief (block h) |
| `phase-boundary` | `phase`, `remedy` | the phase's tasks are all done; v1 stops here — the remedy names the person's `transfer` |
| `done` | `summary`, `observations?` | the round is complete; the summary the driver's own closing report renders, observations included (P1 counts and the like); ends sessions, not the protocol — a later round resumes through the same `claim` |

**d — the state-derivation table.** The protocol's semantic core: every
standing decision point, one row, now lease-aware. This table is the manual
suite's loop rendered as derivation — the prose twin's sections map onto its
rows almost one-to-one, which is the design's own proof of completeness.

| the derivation reads | the answer |
| --- | --- |
| config refuses executor mode (`testByDriver`/`handoverTest`/`acceptanceGate` set, or no init) | `blocked config` |
| initialized, no round established | a pending person item (`human project-start`) — the assisted analysis is person work here too |
| a subtask-configured project | `blocked subtask` |
| a claim or evaluation begins | **lazy expiry first**: every lease past its deadline without a refresh expires inline — the units return to the claimable set, takeover semantics below (no timers, no persisted clock state — P6) |
| `claim {task}` on a unit live-leased to another channel | `wait lease-held` (the holder and deadline named) |
| `claim {task}` on a ready unit (deps met, scope-disjoint at the tier, tree clean where the kind demands) | granted — the lease + the step (unit-start writes ride the grant) |
| a lease held, the share not yet in the log | the holder's re-`claim`/`brief` re-answers the same step — same id, idempotent |
| an unsettled question of the claiming channel's own | `wait question` |
| any pending person item (a raised question, a standing gate) | a worker's evaluation answers `wait gate`; a person channel's `claim` returns the oldest pending item as a `question`/`human` step |
| a person channel's `answer` within its envelope | the settle lands with provenance (the journal entry or the gate release); the asker's next brief carries the answer |
| a person channel's `answer` outside its envelope | refused with the escalation teaching — the item stays pending for the human's own channel |
| `report` accepted → landing runs (the share commit, the verdict artifacts, the zero-write and handover-verdict arms unchanged — serialized per project inside the coordinator, the sole writer) | the landing's own outcome decides the next row |
| verdict INCOMPLETE, fix budget remains | `fix` claimable (round log-derived) |
| verdict INCOMPLETE, budget exhausted | `blocked fixBudget` |
| verdict PASS | close-out lands (wrapup + done commits, `todo.md`→`done.md`, the tick) → the next row |
| handoff `Status: park` | the park commit lands inside the report handling → the next row |
| `report outcome: failed` | the attempt books; the standing retry/incomplete arms decide — re-claimable, or `blocked attemptsExhausted` at the cap |
| nothing claimable, leases outstanding | `wait in-flight` |
| tree dirty, no active record | `blocked cleanTree` |
| repository unreadable | `blocked unreadable` |
| no ready unit, phase incomplete, mutual parks | `blocked mutualPark` |
| phase tasks complete | `phase-boundary` |
| a human gate standing (the survey unreleased) | a pending person item — workers `wait gate`, the person channel claims it (`human survey-release`) |
| round complete | `done` |

**e — correlation and idempotency: the log is the report ledger.** Step ids
are deterministic — `<unit> <kind> <n>`, the share ordinal the log already
owns (`T-012 exec 2`, `T-012 fix 2.3`, `T-012 verify 1`): one grammar, two
uses, zero new words (P13's economy). Because the id names the share the
step will land, **git's log is the report's receipt**: a `report` replay is
recognized by the landed share's presence in the log — the coordinator
re-derives the current step and answers it, nothing lands twice; a `report`
naming a step that was never issued is a 400 shape error. A crashed holder
that did work but never reported leaves the dirt under the active record —
the next claim over the expired lease re-answers the same step with the
continuation brief, and the successor's landing absorbs the tree exactly as
the manual suite's park/resume rules do (the standing interrupted-restart
semantics, 0149's exemption). Leases are the progress record's own
extension — holder, kind, deadline (P5: the in-flight state keeps its one
home in `.auto/`); a coordinator respawn re-derives them from the record
and the clock. No server-side step state exists anywhere: the coordinator
holds the lock and the derivation; git and the documents hold the truth.
The one deliberately stateful request is `claim` (taking changes state);
its retry discipline: by-target idempotent, and every `ready`/`claim`
answer carries the channel's live leases, so a hub that lost a response
reconciles rather than duplicates.

**f — failure identification and takeover.** The question the fleet exists
to answer: **how is a failure identified?** Four detectors, one funnel:

1. **Self-report** — `report outcome: failed`: the holder hit its wall.
   Signals an *attempt* failure, never a task verdict (P3); the landing
   still judges whatever landed on disk; the attempt books; the standing
   retry arms route.
2. **Staleness** — the lease deadline passes with no refresh from the
   holder (death, hang, host loss — the silent cases). Detected lazily at
   the next evaluation (block d's first row); effect: the lease expires,
   the unit returns to the claimable set, the next claimant takes over.
3. **Hub observation** — a hub's child ended without completing (the host's
   own completion notification — the manual suite's wait discipline). The
   hub acts on the child's behalf: `report outcome: failed`, or `release`
   when no work began. Child death is otherwise invisible to the server,
   and correctly so — the hub owns what it launched.
4. **Server-side judgment** — the landing and verdict machinery: zero
   writes with no handoff, a verify's INCOMPLETE past the fix budget, the
   close-out audit's isolation violation. The only detector that can fail
   a **task**.

**Takeover** is claim-over-expiry (or over `release`): continuation
semantics — the same log-derived step id when no share landed, the
successor's brief carrying the handoff, the dead holder's dirt absorbed by
the successor's landing (P20 — never destroyed, never cleaned around).
Every takeover books an attempt; the cap (`blocked attemptsExhausted`)
bounds the flapping a lying or crashing holder could cause. The hard cap on
refresh (heartbeat extends deadlines but never past issued + the hard
multiple, ruled at the lease slice) bounds the lease a live-but-stuck hub
could hold forever.

**g — the two error planes.** Transport truth rides HTTP, workflow truth
rides steps — never mixed. HTTP (the daemon's standing vocabulary, reused):
401/403 auth and scope, 404 unknown project or route, 400 malformed JSON or
shape (naming the field), 423 a foreign live run lock (a CLI run owns the
directory; the person resolves it), 5xx a coordinator fault mid-handling
(safe to retry — block e). The workflow plane is the step vocabulary
itself: `wait`, `blocked`, `human`, `phase-boundary` and `done` are
**answers**, delivered 200 — an executor that renders them as errors has
misread the protocol; a lease conflict is a `wait` naming the holder, not a
409; a landing failure the coordinator survives is `blocked commitFailed`,
not a 500 (P12: fail loud at the workflow plane; P8: the refusal teaches).

**h — the person lifecycle: questions and gates.** The person rides a
coding agent in this mode — one of the channels *is* the person, or a
person-role agent stands for them under a delegation envelope (D8). A raise
opens the journal entry; a standing gate (the survey release, the project
start) derives from state. Both are **pending person items**, and person
work is protocol work: delivered by `claim` to a person-role channel (the
oldest first), decided by `answer` within the channel's envelope — every
decision provenance-recorded (which channel, which envelope, the
rationale), restart-safe by the standing journal replay. An item outside
the envelope escalates: it stays pending for the human's own channel, and
a person-role agent claiming it sees the escalation rendering instead —
the obligation to say "this one is yours" (block j), never to decide past
the envelope. The asker's side: while its item pends, its evaluations
answer `wait`; on `answer`, the reply is **rendered into the resumed
step's prompt** by the coordinator — a driver notice line beside the
brief, exactly as steers and feedback lines ride prompts today (P15: the
renderer assembles; the answer is data). The web console is an observer
here, never a required surface: the server's person-facing contract in
this mode is the protocol (the standing daemon-run surface unchanged —
P10's floor).

**i — the write contract.** The worker (any channel holding a lease) may
write, inside its `workspace`: sources within the unit's effective scope,
`docs/T-NNN/handoff.md` (its grammar, the `Status:` line last),
`docs/T-NNN/gaps.md` (on a verify's INCOMPLETE), and `docs/T-NNN/report.md`
(on a verify's PASS under the wrapup key). It must never: run any
commit-type git command; create, rename or edit `todo.md` / `done.md`, the
phase index or `subtasks.md`; touch the config, `AGENTS.md` or anything
under `.auto/`. The teaching rides the executor prompt and the target's
AGENTS.md block; the enforcement is the close-out audit (`blocked
isolation`) and the standing read-only gates; protect's applicability to
channel lifetimes is ruled at the write-arm slice, not here.

**j — the obligations, worker and hub.** What the executor prompt teaches —
the same file, two postures:

| the worker's obligation (any channel holding a lease) | |
| --- | --- |
| `execute` / `verify` / `fix` | do exactly the brief, in its `workspace`; write only per block i; end the turn with `report` — `outcome: failed` when the wall was hit, the note a few honest lines, never a completion claim |
| `wait` | sleep `retryAfter`, then re-evaluate (`ready`, or `claim` again) |
| `blocked` / `human` / `phase-boundary` | render the remedy to the person; end the session (the person acts; a later session resumes through `claim`) |
| `done` | render the summary; end the session (a later round resumes the same way) |

| the hub's obligation (the scheduler-only posture) | |
| --- | --- |
| schedule | `ready` for the menu; assign by task id — spawn a child per claim (the child self-serves `claim {task, kind}`, or the hub claims and hands the child the fetched `brief`) |
| keep alive | `heartbeat` while children work (the hub is the lease's clock when children cannot call out) |
| observe | a child's end is the hub's fact: `report outcome: failed` on its step, or `release` when nothing began — never silence |
| hands off | no implementation work of its own unless it, too, claims; never a commit; context discipline as the manual suite teaches it (pointer facts, verdict lines — the menu and the steps already carry them) |

| the person channel's obligation (the human's own session, or a person-role agent under its delegation) | |
| --- | --- |
| attend | `claim` within the role — the pending items arrive as `question`/`human` steps, the proposal and context carried |
| decide | `answer` within the delegation envelope only; the rationale a few honest lines — the decision is recorded under the channel's name, forever |
| escalate | an item outside the envelope is the human's: render it to them and leave it pending — never decide past the envelope, never let an automatic answer stand unrecorded |
| hands off | no work leases, no implementation writes (a token carrying both scopes is two roles in one session — the protocol still sees two) |

**k — canonical flows.** The solo happy path, the hub fleet with a takeover:

```
the solo path
worker                              coordinator
   │  POST claim                       │
   │──────────────────────────────────▶│  admission · beginUnit · the lease (progress record)
   │◀── execute  T-012 exec 1 ─────────│
   │  (the work; sources, handoff)     │
   │  POST report {step, ended}        │
   │──────────────────────────────────▶│  the share commit lands · the verdict artifacts read
   │◀── …verify, fix, done as ever     │
```

```
the hub fleet, with a takeover
hub                child A            child B        coordinator
   │ ready ─────────────────────────────────────────────▶│  the claimable menu
   │◀─ [T-012 execute, T-013 execute; Touches disjoint] ──│
   │ "claim T-012" ────────────────────────────────────▶ │  ┌ lease T-012 → hub/A
   │ spawn A(task T-012)              │                 │  │ (A self-serves or rides the hub)
   │ "claim T-013" ────────────────────────────────────▶ │  └ lease T-013 → hub/B · spawn B
   │ heartbeat · heartbeat · …        │ (works T-012)  │  (works T-013)
   │              ✕ A dies silently — no report, no dirt swept
   │ heartbeat stops extending A? no — the hub knows:  │
   │ release/report-failed on A's step ────────────────▶│  A's lease ends · T-012 claimable
   │ (or the hub is gone too: the deadline passes —     │  lazy expiry, same effect)
   │ "claim T-012" ────────────────────────────────────▶│  takeover: continuation brief,
   │ spawn A′                                          │  A's dirt absorbed by A′'s landing
   │ report {B's step, ended} ◀────────────────────────│  B's share lands · verify claimable
   │ "claim T-013 verify" (or C does) ─────────────────▶│  fresh eyes — a different channel
```

```
the person attends mid-flight
worker                     person channel                coordinator
   │  POST question {text}                                 │
   │──────────────────────────────────────────────────────▶│  the journal opens the item
   │  POST claim                        │  POST claim       │
   │◀─ wait {reason: gate} ──────────── │──────────────────▶│  the oldest pending item
   │        (bounded poll)              │◀─ question {id, …}│
   │                                    │  the human decides — or the person-role
   │                                    │  agent, within its envelope
   │                                    │  POST answer {item, decision}
   │                                    │──────────────────▶│  the settle lands, provenance recorded
   │  POST claim                        │                   │
   │◀─ the resumed brief — the answer ──│                   │  rendered into the prompt
```

**l — v1's frozen word sets.** The enumerations P13 pins: the eight
requests; the nine step kinds (the two person-delivered among them); the
nine `blocked` codes; the two `human` gate kinds; the five `wait` reasons;
the two report `outcome` words; the delegation envelope's kinds (v1:
`questions`, `releases` — `closes` deferred); the answer provenance fields;
the step-id grammar (the share grammar reused); the lease grammar
(holder = the channel, deadline = issued + budget + grace, refresh window,
hard cap multiple — values ruled at the lease slice); the envelope's
`protocol` field. Growth is
additive through conscious lockstep; an executor meeting an unknown `kind`
fails loud — stop, tell the person to update — never guess (P12). Declined
beyond D2's foreclosures: a `continue` step kind (the derivation already
knows); an `attach`/`detach` pair (channels are `(token, id)` pairs,
materialized lazily, idled out); an `ack`-then-`claim` report dance (one
round trip; the pure polls are `ready`, `brief` and `heartbeat` — polling
can still never commit); server-visible child liveness (the hub owns what
it launches — the lease's clock is the protocol's only liveness truth).
Reversed from this document's own first draft, honestly: the draft declined
a `cancel` — the fleet model needs the voluntary give-back, and `release`
is it, P20's letter held (the tree is never touched).

### D5 — the per-project coordinator (findings 3, 6; P17)

An executor-driven project is served by one **coordinator** worker process:
spawned by the daemon through the existing `spawnWorker` machinery on the
first executor attach, holding `.auto/run.lock` for its lifetime — the
coordinator *is* the one driver per directory (0053, 0183 stand; the lock's
pid-namespace and start-time identity apply to it as to any run), idling
between steps. Executors are **channels, not processes**: registry records
without a child process, authenticated request streams routed daemon →
coordinator over the existing per-run bridge WebSocket (`ws-protocol.ts`
grows an additive step-request/step-done frame pair; the per-run secret and
the X1 scrub carry as they carry every bridge). The coordinator serializes
every driver write and commit for the project — the sole writer of shared git
state, P17's letter held by construction — **is the admission authority**
(readiness, declarations, scope disjointness at the tier in force, every
lease grant; the executor side may schedule among what it admits — D4's
split), renders the step prompts, and judges the verdicts from disk.
Lifecycle: spawn on first attach; idle out when
no channel is attached and no step is in flight, releasing the lock; respawn
on the next attach re-derives state from disk (P6); a crash is a stale lock,
recovered by the existing identity machinery at the next attach. The daemon's
registry refuses a second coordinator per project (the standing per-project
in-flight guard). Declined: **per-executor resident workers** (N executors
means N lock claimants — one-driver-per-directory breaks); **per-step
short-lived workers** (lock churn between steps opens a concurrent-writer
window — a foreign run could start between two steps of a live executor
session); **in-daemon step execution** (a needless 0067 amendment — the
worker's crash isolation is the point); **an executor mode inside `runAll`**
(drags the engine, the ladder and the router into a path that uses none of
them — P21).

### D6 — the open daemon mode (P2, P10, P16)

`serve` gains a specially authorized startup mode (name fixed at enactment;
the shape: an open flag plus one or more declared **roots**): a **persistent
background daemon** whose projects arrive at runtime — authenticated clients
create and initialize new projects, with no pre-registered whitelist. The
bound is **structural, never enumerated**: a client may create a new project
directory, or adopt an existing one, only **under a declared root**;
everything outside is refused with the remedy (the operator registers the
directory by CLI, or restarts the daemon with the root — the operator's own
acts, named in the refusal). Project creation is the composition of standing
machinery: root-containment check → directory creation → dynamic registration
into the daemon's store → the existing `config`-scoped init op, which already
bootstraps git where absent (0073) and writes every surface with its confirm
and clean-tree gates intact (428/409) — reused wholesale, not mirrored. The
person's bracket (P2's envelope, composed): starting the daemon in open
mode, bounding the roots, issuing the tokens, and granting the delegations
are the person's acts; within the envelopes, every consequential gate —
the human gates, the releases, the closes, the round-close checks — still
terminates at the person, and the person rides a coding agent: person work
is protocol work (D4 h) — pending items claimed and answered by a person
channel within its delegation, or escalated to the human's own channel;
nothing in this mode requires the web.
The default closed-whitelist mode is byte-identical (P10); this ruling
amends 0067 §五's "absolute whitelist" letter additively — the closed default
stands, the root-bounded open arm is the one ruled exception.

### D7 — the executor prompt (P15, P10)

A new suite file — working name `prompts/executor.md`, the name final at
enactment; the manual `run.md` and its companions are untouched (the
no-server floor). Content: connection discovery through a local-only
connection file (the `models.json` local-only precedent — `{url, token}`,
never committed, the security family's law); the request vocabulary in curl
form; the working rules — do exactly the returned brief's work, never run a
commit-type command, never touch driver-exclusive state (the AGENTS.md block
already carries the target-side rules; the hands-off list mirrors the manual
suite's); report and failure discipline (the turn-ended report, `outcome:
failed` when the wall was hit — the note a few honest lines, never a claim
of completion); **two postures** — the solo worker and the hub/scheduler
(D4 j's two obligation tables its teaching core: `ready`, assign by task
id, spawn children, heartbeat, observe, hands off); **multi-project
awareness** — per-project request loops against per-project endpoints,
projects created and listed through the open-mode requests; and the
person-facing failure modes (every `blocked` step renders its remedy).
Measured target: tens of lines, not hundreds — every judgment the manual
suite teaches in prose moves server-side
into code. Beside it a sibling thin prompt — working name
`prompts/person.md` — the **attend role** for the human's own agent session
or a person-role agent: claim within the role, decide within the envelope,
escalate out-of-envelope, hands off (D4 j's person table its teaching
core). `install-prompts` registers both files in the suite registry; the
ratchet pins their literals to the coordinator's step renderers (0203's
two-sided form — the manual side pinned to the producing code, the ruled
divergences pinned as explicit absence).

### D8 — the security posture

The store's scope schema grows additively (today `read`, `control`, `config`,
`answer`, `probe`): an **`executor`** scope — narrower than `control` (no
ops, no run spawn, no kill), wider than `read` (its steps trigger commits) —
owning the executor requests; a **`projects`** scope owning the open
mode's create/adopt/register arm; and a **`person`** scope — the heaviest
grant after `control`: its channels receive the pending person items and
may `answer` within a **delegation envelope** carried as token metadata
(v1's kinds: `questions`, `releases`; `closes` deferred — D4 l), every
decision provenance-recorded, an out-of-envelope answer refused with the
escalation teaching. A token may carry both `executor` and `person`
scopes — two roles in one session, the protocol still sees two. init stays
the `config` op it is. The web console's write arm stays the daemon-run
surface it is; executor mode's person path is the protocol, a browser
never required (the standing surface unchanged — P10's floor). The roots
ride startup flags — a structural bound, never an enumerated project list
(P16's shape: the escape is the rule, not a list). Tokens remain
operator-issued through the CLI (the bootstrap act, unchanged); the
connection file is local-only and gitignored by its own law; logs and error
lines name the token or the executor channel by name, never a value (the
security family's letter). The whitelist's closed letter governs every
request the open mode does not itself satisfy.

### D9 — v1's scope and the concurrency staging (P21, cost recorded)

**In the protocol from day one, because the fleet model is the protocol:**
task-addressed claims (`claim {task, kind}` — a hub assigns, a child
self-serves), leases extending the progress record, heartbeats, `release`,
lazy expiry, the failure funnel and takeover (D4 b–f), the hub/scheduler
posture beside the solo worker (D4 j), the **person role** — pending
questions and gates as claimable protocol work, `answer` within the
delegation envelope (questions and releases in v1; closes stay the
human's), provenance on every decision (D4 h) — and **one executor session across
many projects** — free with per-project coordinators and per-project
endpoints: independent request streams, one hub context, no protocol
addition. Whole-task units; the execute/verify/fix loop with the
server-side progress rule (the log-derived fix budget of 0198/0199 — read
from git by the coordinator, never from any channel's claims); park (the
coordinator lands the park commit from the handoff `Status:` line);
interruption recovery (D3 — a takeover is a relaunch by another name). What
stages is **how many leases may be live at once, and where they work** —
the concurrency ladder on the standing machinery, each tier its own
numbered landing:

- **Tier 0 — serial:** one lease at a time per project (the coordinator
  grants nothing else); takeovers and releases already exercised, the
  protocol identical to the fleet's — only admission is narrower.
- **Tier 1 — documentation-scoped same-tree:** doc-scoped units lease
  concurrently (the 0099/0210 doc-lane lineage, with its race, flatten and
  rollback discipline); code-touching units still serialize.
- **Tier 2 — worktree lanes:** code units lease into worktrees — the
  `workspace` field already in every work step's payload names the
  worktree path, the standing git-worktree landing machinery (0068/0126)
  lands from it; **zero vocabulary change**, the field stops naming the
  main tree.

**Out of v1, each the person's existing command, not a hole:** subtask
decomposition (subtask-configured projects refuse executor runs with the
remedy — the person runs the driver itself); phase transfer, formulation
and close (`phase-boundary` stops; the person's `transfer` and `plan`); the
engine's protections (liveness, stuck, overflow, failover — the channel's
host owns them; the protocol's liveness truth is the lease clock, never a
probe into a session); model routing (no AgentClient in the path, no
registry need — every channel's host owns its model).

### D10 — the staged enactment

Each slice is its own numbered landing, always-green, category-complete with
its code home and test home in the same change (0110 D13):

1. **The core decision-layer extraction** — the loop's decision points
   (admission and the claimable set, gates, verdict judging, prompt
   rendering, the lease-aware derivation) as pure step functions over
   project state; the read-only arm first (the claimable menu, the rendered
   briefs, no writes); a new core test file over fixtures.
2. **The coordinator, solo path** — the worker entry, the bridge step
   frames, the registry's channel kind, the routes' read-only arm, and the
   tier-0 `claim`/`report`/`question` loop (one lease at a time).
3. **The write arm** — `beginUnit`/`afterSession`/close-out wired into
   coordinator steps; recovery and takeover continuation end to end; the
   daemon and ops test homes extend.
4. **The lease family and the person role** — `ready`, claim-by-id,
   `brief`, `heartbeat`, `release`, lazy expiry, the attempt ledger, the
   failure funnel's four detectors, `wait`'s full reason set; the person
   role — pending items, `answer`, the envelope, provenance; the hub
   posture exercised by a script double playing hub-and-children, the
   person role by a double attending and answering within and past its
   envelope.
5. **The open daemon mode** — the serve flags, root-bounded dynamic
   registration, create-and-init, the two scopes, the persistent-posture
   documentation (daemon.md, README's operator loop).
6. **The prompts** — `prompts/executor.md` (both worker postures) and
   `prompts/person.md` (the attend role) — D4 j's obligation tables their
   teaching core, the installer registration, the ratchet's two-sided
   pins.
7. **The concurrency tiers** — tier 1's doc-scoped same-tree leases, then
   tier 2's worktree leases (the `workspace` field activated).
8. **The convergence review** — D11's trigger, by measurement.

### D11 — the primary-mode convergence (P19, P21)

The endgame: every session-work kind rides the executor protocol —
execute/verify/fix first, then the formulation sessions, the transfer
advance's sessions, and the close-audit — one driving surface for agent work,
the push path remaining for embedded and no-server use and as the standing
floor. The push path's demotion or tombstone is revisited **only by
measurement** at the convergence review (D10 slice 8): adoption counted,
adapter incidents counted, the manual suite's usage counted — P19's letter;
never deleted by ambition (P13's deliberate-act discipline; a tombstone is a
conscious lockstep with its remedy family, not a mood).

### C — declined and deferred (P21)

- **Unbounded client-named registration** — declined: an init-anywhere
  request is remote-code-execution-shaped (the driver commits, runs test
  channels, reads files); the root is the structural rule.
- **Step-level git vocabulary** — declined (D2 forecloses it).
- **Per-executor lock holders** — declined (D5).
- **The concurrency tiers** — staged per D9 (tier 1 doc-scoped same-tree,
  tier 2 worktree leases, the 0068/0126 machinery the standing key); tier 0
  lands with the protocol itself.
- **The subtask pipeline over the protocol** — deferred; the whole-task split
  rule already delegates decomposition inside one session.
- **Server-visible child liveness** — declined (D4 f: the hub owns what it
  launches; the lease clock is the protocol's only liveness truth).
- **Lease-expiry tuning** — deferred to D10 slice 4; the window, the refresh
  and the hard cap are configured, never hardcoded per project (P16).
- **Glossary terms** (executor, coordinator) — deferred to enactment, when
  the terms name shipping surfaces.

## Premise guard

premises this ruling changes: **plans/0067** (§五, the absolute whitelist —
amended above: the closed default stands, the open root-bounded arm is the
ruled exception). Re-read in this change: **plans/0053 / plans/0183** (the run
lock — stands: the coordinator is a single process, the one driver per
directory; executor channels are request streams, not drivers, and hold no
lock), **plans/0160 / 0162 / 0222 / 0223 / 0224** (the daemon reboot, the
spawn boundary, the bridge secret, the registry — vocabularies grow
additively, machinery reused as the ruling states), **plans/0099 / 0210**
(doc-tier concurrency — the concurrency tiers' keying stands on them),
**plans/0149 / 0183** (interruption recovery and the carryover — stand,
reused unchanged), **the 0078 lineage** (the manual suite — stands as the
no-server floor, its rulings untouched by this direction), **plans/0203**
(the ratchet's two-sided pin form — extends to the executor prompt at slice
6, its oracle boundary unchanged). Each stands as written for every surface
this ruling does not touch.

## Residuals

- The executor's honesty is still trusted for the **work** — the same trust
  class as any session: verification judges outcomes from artifacts, not
  obedience; an executor that ignores its brief produces the same verdicts an
  incorrect session produces today.
- A single-session worker's context is the host agent's concern; a long
  phase may outlive one session's hygiene, and the person relaunches the
  worker (the `claim` after relaunch resumes mid-unit — D3).
- A dead channel's lease runs to its deadline (the hard cap included)
  before takeover — the protocol's liveness truth is the lease clock,
  deliberately coarse; a hub that stops heartbeating while its children
  work strands their leases to the same clock. The remedy ladder:
  `release` from a live peer, expiry at the deadline, the person's channel
  kill.
- A hub's relay is trusted as its children's voice — the same trust class
  as any session; a hub that misreports a child's outcome meets the same
  verdict machinery a lying session meets today.
- A person-role agent's within-envelope decisions are the human's by
  delegation — the same trust class again, heavier in consequence: an
  agent granted `releases` can release surveys the human never read. The
  bounds are the envelope and the provenance; the remedy is the human's
  own grant (narrow envelopes first) and the recorded trail.
- Between a coordinator's idle-out and its respawn the directory is briefly
  unlocked — the daemon's registry still refuses a second coordinator; a
  foreign CLI run in that window meets the clean gate and the progress
  record, the standing residual, named here.
- The open mode's root is a directory the operator trusts wholly: everything
  under it is creatable, adoptable and driver-writable by token holders. The
  remedy is the operator's own root choice; the daemon teaches it in every
  refusal outside a root.

## Tests

None land with this document — the ruling's test homes arrive with their
slices (D10): the core step functions' test file (slice 1); the daemon,
worker and ws-protocol test homes' extensions (slices 2–4) — slice 2's
pinning the D4 state-derivation table row by row, the replay and
idempotency properties of block e, and the two error planes of block g;
slice 4 the failure funnel and takeover of block f exercised by a script
double playing hub-and-children (a dead child, a silent hub, a wall
report, an expired lease taken over); the ratchet's two-sided
executor-prompt pins (slice 6); the concurrency tiers (slice 7); the
convergence review's measured counts (slice 8). The INDEX
row is this document's only companion change.

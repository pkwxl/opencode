# 0279 — The pull-only program: the push demolition, the preview posture, and the protocol's standing spec

The maintainer's direct order, recorded here as the ruling that rules the
docket below: the executor protocol's pull mode replaces the push mode
completely — the protocol does nothing via push, ever again. Every
instructional prompt the push mode rendered to its opencode sessions (how to
do a task, how to verify, the construction's re-voicing, the distillation,
the audit) rides the protocol to executor workers as grants carrying that
same prompt. The daemon serves coding agents only — never a web client. No
ask channel exists anywhere: not the driver-side askHuman, not a wire
question/answer pair — a coding agent blocked mid-grant resolves the block
itself and records its decision in its artifact (the prompts' standing
AUTO-DECISION rule), and the person's bracketed acts are document writes and
deterministic operations, their gates derived from document state. The
protocol's specification lives in [docs/protocol.md](../docs/protocol.md) —
the single source, maintained — never inside a numbered plan again. The wire
version is **`0.1`, preview**: adding and removing vocabulary stay open, and
the preview's exit criterion is sustained field testing, never a freeze
claim. Nothing drains: at the order's moment no live push run remained (the
2026-11-20 erofs/igb/squashfs runs had all ended), so every push interface
is simply removed.

## Category scope

Tier: direction — a ruling over programs, not a mechanism; the docket's
slices carry their own tiers and homes.

Premises this ruling changes: **plans/0256** (stage 4's dogfood and stage
5's convergence-review gate — the maintainer's order supplies the gate's
verdict directly; the demolition track (stages 6–7) is unblocked now, and
0255's instrument is repurposed as the preview's field-testing record),
**plans/0267** (§"The freeze procedure" — no freeze; the vocabulary is
preview-open at `0.1`; §"The evaluation gate"'s person-role harness stands
and simplifies — the person is an agent over the deterministic ops and
document writes, no person wire grants), **plans/0271** (the pending person
items' read surface — question items are removed; gate items stay,
document-derived), **plans/0272** (the blocked-settlement escalation
question — removed; the plain `blocked` answer with its remedy is the whole
surface, the round waits), **plans/0276 / 0277 / 0278** (each convergence
slice's "the push twin stands unchanged, the demotion/tombstone gated on
the convergence review" P10 letter — the gate is answered by the
maintainer's order, the demotion is this program). Re-read in this change:
**plans/0246–0255** (the protocol's founding rulings — the wire mechanics
stand; the question channel and the person claim/answer arms retire),
**plans/0097** (the synthesis pipeline — its sessions converge here, its
deterministic floor already complete), **plans/0116 / 0204** (the clarify
surface — the command's act becomes a deterministic op; the CLI twin
tombstones), **the 0078 lineage** (the manual prompt suite — `executor.md`
grows with the docket; `person.md` retires with the person routes, its
letter recorded here), **plans/0061** (the session-driving family — stands
until the demolition track deletes it callerless). Each stands as written
for every surface this ruling does not touch.

## The demolition letters

**Push interfaces.** The census (2026-11-20, this program's own
measurement, P19): the daemon's `transfer` and `plan` loop route spawn
worker children that run agent sessions themselves
(`packages/auto-server/src/ops.ts:969,1007` →
`packages/auto-server/src/daemon.ts:1257–1332`; the construction's
synthesis/fidelity one-shots at `src/formulate-synthesis.ts:330,506` inside
`runTransfer`'s `runAll(stopBefore:"formulate")`, `src/transfer.ts:222`);
plain `POST /runs` starts fully push runs (`daemon.ts:855`); the CLI's
`run`/`plan`/`transfer`/`clarify` commands drive the same twins
(`packages/auto/src/index.ts`). All removed: the transfer/plan/clarify
operations become in-daemon deterministic applies (the session-free halves
of `runTransfer`/`planPrelude` — git and document writes only, the class
`close`/`task-add` already run in-daemon); `POST /runs` is removed (the
executor route is the only run starter); the worker payload accepts only
`{executor, directory, transport}`; `spawnPlanningRun`/`spawnTransferRun`
are deleted; `serve --launch` and `--open`/`--root` are removed (nothing
left to confine, no web flow to open); the CLI push commands become
permanent tombstones (P13) naming the executor surface. The push lane
payload dies with them — lanes ride the protocol's scoped/doc tiers
(`src/executor-coordinator.ts:2092–2119`).

**The web client.** The daemon serves coding agents only:
`packages/auto-server/src/web/`, `GET /`, `/app.js`, `/session`
(`daemon.ts:976–1001`) are deleted; `GET /projects` stays as the whitelist
read. The surface is authenticated JSON/WS for agents holding tokens.

**The ask channel.** No ask channel exists anywhere. The driver-side
`askHuman` (`src/engine/fx.ts:119`, `src/session-api.ts:338`, the
`humanQuestions` waits at `src/opts.ts:436,466`) goes callerless with the
push sessions and is deleted by the demolition track; the interactive WS
endpoints (`daemon.ts:1100–1171`, `src/interactive-ws.ts`) are removed in
the same slice as the runs that used them. On the wire, the `question` and
`answer` routes are removed (`packages/auto-server/src/ws-protocol.ts`,
`executor-request.ts:11,85`, `daemon.ts:1044–1090`, the coordinator's
question/gate claim/answer arms at `src/executor-coordinator.ts:2274–2317`
and `raiseSettlementQuestion` at `:1667`) with the
`.auto/executor-questions.json` store; the scopes `answer`, `person`,
`person-questions`, `person-releases` tombstone
(`packages/auto-server/src/store.ts:39`), leaving `read`, `control`,
`config`, `probe`, `executor`, `projects`. The person's gates —
`project-start`, `survey-release`, the formulation review stop — derive
from document state exactly as the admission derivation already reads them
(`src/executor-steps.ts:71–86`); the person's acts are the document edits
(`Clarified: yes` regions, `Wall:` lines, `## Close`) and the deterministic
operations; `person.md` retires with the routes.

**The construction determinized.** The formulation construction's floor is
complete without any session (0097's Stage-1 floor — the pre-0097
construction verbatim); the synthesis/fidelity one-shots are enhancements.
They converge: a new `synthesize` grant kind carries the identical prompt
(`templates/prompts/formulate-synthesize.md`) to an external executor over
the standing floor todo, and the settlement runs the same mechanical
validation the push loop ran (`parseLedger`, `sessionRowProblems`, the
guarantee assert — `src/formulate-synthesis.ts:94,172–198`, the caller's
`validate` at `src/loop-plan.ts:320–336`) and lands through the standing
`constructFormulation` path. The fidelity classifier one-shot is not
rebuilt (P21).

## The version and documentation rulings

**`protocol: 0.1` — preview.** The wire's `protocol` literal
(`packages/auto-server/src/ws-protocol.ts`, read at `daemon.ts:83`) flips
from `1` to `0.1`; the `1` is recorded as premature (a tombstone note in
the spec, not a frozen vocabulary). Preview means: adding and removing
routes, kinds, scopes and stage words stay open while `0.1` carries; the
exit criterion is sustained field testing — the practice rounds recorded
under 0255's instrument — and any future freeze is its own ruling.

**`docs/protocol.md` — the single source.** The protocol's specification is
[docs/protocol.md](../docs/protocol.md), maintained: every future protocol
change amends it in the same change. Numbered plans record rulings and
history, never the spec — this document's docket describes its slices, it
does not restate the wire. The doc is enforced by a **protocol-doc ratchet**
(`test/protocol-doc.test.ts`, both directions): the doc's enumerated
vocabularies — route names, `WORK_TYPE_IDS`, scopes, stage words, the
tombstone list — are pinned against the code's constants, so the spec
cannot drift from the implementation. The AGENTS.md documentation-system
family gains `protocol.md` when it lands (0280); the INDEX's protocol rows
point at it as the standing home.

## The docket (0280–0284, then the demolition track; each its own always-green change, category-complete per 0110 D13)

- **0280 — the spec established.** `docs/protocol.md` written over the wire
  as it stands at the change (the six grant kinds, the routes, the fences
  and catalog, the gates, the lifecycle ops, the scopes), the version
  ruling applied (`0.1`), the protocol-doc ratchet landed, the AGENTS.md
  docs-family entry and INDEX note landed, the auto-server README pointed
  at the spec. auto-core + auto-server.
- **0281 — the `synthesize` grant kind.** Per 0261 D2's id-growth letter
  (own enactment, fence entry, ratchet pin): `WORK_TYPE_IDS` grows
  `synthesize` (`src/executor-coordinator.ts:383`); the grant derives over
  a standing floor todo whose phase awaits construction (pending
  formulation unit, charter resolved, `OPENCODE_AUTO_SYNTHESIS` not off —
  the push compose's predicate family, `src/loop-plan.ts:140–369`);
  serial lease, main tree; the grant carries `phase`, `index` and the
  sources brief (the same assembly `src/loop-plan.ts:286–302` builds); the
  brief renders the identical `formulate-synthesize` prompt plus sources;
  the fence admits exactly the phase's formulation todo path; the
  settlement validates mechanically and lands via `constructFormulation`
  under a new `phase-synthesize` stage word; the review stop surfaces as
  the document-derived gate it is. Tests:
  `test/executor-synthesize.test.ts`, the catalog letter and grown id set,
  the manual-prompts ratchet arm, the protocol-doc ratchet growth, the e2e
  wire pins; `docs/protocol.md` gains the kind. auto-core + auto-server.
- **0282 — the daemon pull-only.** The demolition letters land on the
  daemon: transfer/plan/clarify become in-daemon deterministic ops
  (`packages/auto-server/src/ops.ts`; `spawnPlanningRun` and
  `spawnTransferRun` deleted); `POST /runs` removed; the worker payload
  narrowed to `{executor, directory, transport}`
  (`packages/auto-server/src/worker.ts:189–241`); the interactive WS
  endpoints, `--launch`, `--open`/`--root` and the web client removed; the
  `question`/`answer` routes and the person claim/answer arms removed with
  the executor-questions store; the scopes reduced to the six; 0272's
  escalation replaced by the plain `blocked` answer; the boundary
  teachings name protocol operations only (the `phase-boundary` remedy
  reads "advance it with POST /projects/<project>/transfer" —
  `packages/auto-server/src/executor-worker.ts:64`). Tests: the op-surface
  suite, the e2e suite's removed-surface pins (404/401), the ratchet arms;
  `docs/protocol.md` amended. auto-server + auto-core.
- **0283 — the CLI tombstones and the standing dispositions.** The CLI's
  `run`, `plan`, `transfer`, `clarify` (and the `transfer <dir>` self-spawn
  at `packages/auto-server/src/index.ts:382–397`) become P13 tombstones
  naming the executor surface; the push lane payload and the worker's
  plain-run path go with them; the ask-channel call sites leave the pull
  path (append/repair-append, blockage-diagnosis, knowledge extraction,
  the charter verifier — the dispositions below); `person.md` retires.
  Tests: the CLI usage-error pins, the ratchet arms; `docs/protocol.md`'s
  tombstone list lands. packages/auto + auto-core + auto-server.
- **0284 — the project lifecycle over REST.** `DELETE
  /projects/<project>` (`projects` scope; 409 beside a live
  coordinator/run with the stop taught, else the coordinator bridge
  stopped and the entry removed); `POST /projects` generalized beyond
  `--open`; `store.unregister` gains the live-refusal conditions shared
  with the route (`packages/auto-server/src/store.ts:152–161`). Tests: the
  store and route suites; `docs/protocol.md` gains the project lifecycle.
  auto-server.
- **0285+ — the demolition track** (each its own change, numbers as
  landed): the now-unreachable push session layer deleted kind-by-kind
  with its tests migrated — each push twin, the decompose/subtask
  pipeline, then `runSession`/`attempt`/`chain`/`engine/` once callerless
  — ending in 0256's stage-6 slim-down and stage-7 extraction/rename.

## The disposition table (every push residue from the census, explicit)

| Item (source) | Disposition | Slice |
|---|---|---|
| construction synthesis/fidelity one-shots (0097) | converged: the `synthesize` grant; the fidelity classifier not rebuilt (P21) | 0281 |
| task-append session (`src/loop-append.ts:338`) | removed from the pull path; appends ride task-add and re-formulation | 0283 |
| repair-append budget machinery (`src/loop-task.ts:435–487`) | removed; FAIL verdicts surface as state — the coding agent overcomes failures its own way, the fix grant repairs verify FAILs | 0283 |
| blockage-diagnosis session (`src/blockage-diagnose.ts:156`) | removed from the pull path; a blocked answer carries its remedy | 0283 |
| knowledge/prior-knowledge extraction (`src/knowledge.ts:106,265`) | retired (0277's residual confirmed) | 0283 |
| charter verifier (`src/prompt-verify.ts:145`) | off; its plan/append call sites go deterministic | 0282/0283 |
| classifier / recovery probes (`src/classify.ts:439`, `src/session.ts:664`) | unreachable with no driver sessions; deleted callerless by the track | 0285+ |
| `models --probe` (`src/agent-pool.ts:543`) | stays — an explicit person diagnostic over REST, not round-driving | — |
| subtask/decompose pipeline (`src/execute.ts:791,850,1260`) | removed (executor mode already required `subtask: off`) | 0283/0285+ |
| push lane workers (`src/shell.ts:65–78`) | removed; lanes ride the protocol's scoped/doc tiers | 0283 |
| regression lanes (`src/script.ts:343`) | stays — driver-run shell lanes, no agent sessions | — |
| dryrun preflight / fork-base rebuild one-shots | unreachable; deleted callerless | 0285+ |
| `askHuman` / `humanQuestions` / interactive WS | removed (the ask-channel letter) | 0282/0283 |
| question/answer routes, person scopes, `person.md` | removed (the ask-channel letter) | 0282/0283 |
| the web client | removed (the web-client letter) | 0282 |

## Residuals

- The pull path's blocked states have no escalation: a holder that cannot
  remedy its own block lets the lease lapse or reports `failed`; the round
  waits until a person looks at the state — the honest cost of no ask
  channel, accepted by the order (P2 keeps the person's bracket: they look,
  they act on documents and ops).
- The executor-questions store retires without a journal successor; gate
  items (`.auto/executor-gates.json`) stay derived, replayed from disk on
  every coordinator start (P6).
- The demolition track's test migration is enumerated, not scheduled: each
  deletion lands when its caller set empties, measured at that change
  (P19/P21).
- Preview honesty: `0.1` carries breaking removals (the routes, the
  scopes, the version literal) — old clients fail loudly at the handshake;
  the spec's tombstone section is the compatibility record.

## Tests and verification

Each docket slice lands category-complete: code home and test home in the
same change, `bun typecheck` and `bun test` green in both packages (the
standing baselines recorded in the slice's commit), the protocol-doc
ratchet green, every removed surface pinned by a test answering
404/401/usage errors. The e2e suite grows a full round over the wire (all
seven kinds, the document-derived gates, every deterministic op, the
project lifecycle) as the preview's standing regression. The field test is
the practice itself: a squashfs round driven wholly over the protocol —
`synthesize` claimed externally with the identical prompt, `formulate`
following, spec-read tasks as execute/verify/fix grants, the boundary
advanced by the deterministic transfer op — with zero `opencode` processes
spawned daemon-side, checked by `ps` across the round and recorded under
0255's instrument.

Derives P2 (the person's bracket held by documents and deterministic ops,
never a consumed channel), P3 and P4 (completion still judged from
committed artifacts; the commit right stays the coordinator's), P5 and P6
(one wire vocabulary, one spec home; gates derived from disk, never
persisted channels), P7 (the fence and the settlement judge grammars
alone), P10's exemption letter (the push interfaces are ruled defects of
the end state, removed by order — the floor does not mask them), P13 (the
tombstones; the preview-open vocabulary at `0.1`), P19 (the census and the
practice rounds as the measured record), P21 (the fidelity one-shot and
every deferred residue wait for consumers); Amends P10's letter as carried
by 0276–0278 (the push twins' byte-identical floor — the gate answered,
the floor retired) and 0256/0267's stage sequencing (above). Tier touched:
direction (this document); each slice names its own.

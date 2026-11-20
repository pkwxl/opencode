# 0282 — The daemon pull-only: the push interfaces removed, the deterministic ops landed, the ask channel gone

The 0279 docket's third slice — the demolition letters land on the daemon.
The protocol does nothing via push, ever again: `POST /runs` is removed
(the executor route is the only run starter), the worker payload narrows
to `{executor, directory, transport}`, the interactive WebSocket endpoints
and their modules (`src/interactive-ws.ts`, `src/worker-interactive.ts`,
`src/question-journal.ts`), the web client (`web/`, `src/web/`,
`script/build-web.ts`, the `GET /`, `/app.js`, `/session` routes) and
`serve --launch` are deleted, the `question`/`answer` routes and the
person claim/answer arms are removed with the executor-questions store,
the scopes tombstone to six (`read`, `control`, `config`, `probe`,
`executor`, `projects`), and 0272's escalation is replaced by the plain
`blocked` answer. The person's gates stay document-derived (the menu's
`pending` names the awaiting gate and its document, derived from the
admission block — no store, no replay, P6); their acts are the document
writes and the deterministic operations.

## Category scope

Tier: mechanism (the wire and the daemon), direction enacted. Derives P2
(the person's bracket held by documents and deterministic ops, never a
consumed channel), P4 (the commit right stays the coordinator's; the
deterministic applies commit through the core's own functions), P5/P6 (one
bridge socket surface; the gates derived from disk), P7 (the settlement's
grammars unchanged), P10's exemption letter (the push interfaces are ruled
defects of the end state, removed by order — the floor does not mask
them), P13 (the tombstones — the spec's tombstone section the
compatibility record), P14 (the core's deterministic entries exported, no
shell re-walk), P18/P21 as ever.

## The deterministic operations

- **transfer** — `transferDeterministic` (auto-core `src/transfer.ts`):
  the same state resolution under the same lock, the advance's one session
  dispatch replaced by the apply. The boundary walk: pending tasks stop
  naming the claim surface; a missing/invalid handover stops naming the
  distill grant; a valid handover applies (the resume point closed, the
  gates and the wall read-only first, the approved brief installed, the
  completion rename, the transition commit) and re-routes; the next
  phase's floor is constructed through `constructPhaseFloor` (the shared
  `readFormulationBaseInput` derivation — one home the synthesize assembly
  and the settlement's composition already read) and stops at the review
  seam; the round close runs the close-audit construction, the round-close
  checks and the baselines. The loop's repair-append arms are the stops
  the pull-only world rules (never an appended session). The op answers
  the exit vocabulary's meaning; the lines stream to the daemon's console
  (an honest residual — the ops' line capture is the follow-up).
- **plan** — the prelude's no-agent routes stand; the loop route answers
  the protocol teaching (the planning session is the formulate grant's).
- **clarify** — the new op over the 0116 core (`clarifyGate`, already
  deterministic): the person's release act as one command, the ask
  channel's replacement for the release.

## The coordinator's ask channel

The `Question`/`Gate` records, the `.auto/executor-questions.json` and
`executor-gates.json` stores, the `question` route, the
`claimPerson`/`answerPerson`/`claimQuestion`/`answerQuestion`/`claimGate`/
`answerGate` arms, the brief's answer paging and the delegation grammar
are removed; `settle()` answers the plain blocked report naming the
person-necessary cause ("a person must inspect the state") — no raise, no
store, the round waiting (0279's accepted cost). The catalog's person
entries die with the channel; `person.md` retires with the routes (the
docket's 0283 letter honored early — its pinned wire arms no longer
exist); `executor.md`'s blocked and gate teachings name the person's own
acts.

## Residuals

- The ops' line capture (the transfer/advance lines stream to the
  console; the outcome body carries the vocabulary's meaning) — the
  follow-up wires the core's log seam into the op bodies.
- `docs/daemon.md` carries a retirement banner naming the removed
  sections (kept as the historical record until the demolition track's
  doc pass rewrites them); `--open`/`--root` and `POST /projects` stand
  until 0284's generalization (the flags' removal rides that slice, not
  this one — the docket's letter consciously deferred).
- The boundary apply's walk is the loop's deterministic tail restated
  (a temporary twin — the loop's own walk dies in the 0285+ track when
  its callers empty; noted here, not hidden).

## Tests and verification

The removed-surface suites deleted (question-queue×2, interactive×2,
web×5, plan-e2e, lanes-e2e, service-e2e — every removed surface pinned by
a test answering 404/401/usage errors instead: daemon's POST /runs 404,
cli's --launch retirement, worker's tombstone teachings, ws-protocol's
route refusal, the spec's tombstone section under the protocol-doc
ratchet, the exports-map amendment under the 0196 pin); the standing
suites re-keyed (executor-e2e's five tests, ops' deterministic transfer,
daemon's harness, observe/status-events' disk arms kept and their live
run arms retired with POST /runs); the core's escalation tests re-keyed
to the plain blocked answer and the gate pending list to the
document-derived rows. Both packages green: auto-core 3520 across 176
files, typecheck exit 0; auto-server 110 across 19 files, typecheck exit
0 — the container's pre-existing IPv6-bind failure failing on the
committed tree identically (0265's record).

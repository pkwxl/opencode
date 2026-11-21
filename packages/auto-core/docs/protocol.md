# The executor protocol

The single, maintained specification of the executor wire — the protocol an
external coding agent speaks with a project's coordinator over the daemon's
executor routes. Every future protocol change amends this document in the
same change; numbered plans record rulings and history, never the spec. The
doc is enforced by the protocol-doc ratchet (`test/protocol-doc.test.ts` in
this package and in `auto-server`): the enumerated vocabularies below —
routes, grant kinds, stage words, scopes, the tombstone list — are pinned
against the code's constants, both directions, so the spec cannot drift
from the implementation.

The daemon's own HTTP surface (runs, observability, the operations, the
whitelist, token issue) is documented in the server package's
[README](../../auto-server/README.md) and
[docs/daemon.md](../../auto-server/docs/daemon.md); this document covers the
executor protocol alone.

## Wire version

```protocol
version: 0.1
```

**`0.1`, preview.** Adding and removing routes, kinds, scopes and stage
words stay open while `0.1` carries; the exit criterion is sustained field
testing (the practice rounds recorded under 0255's instrument), never a
freeze claim, and any future freeze is its own ruling. The literal appears
in two places: every successful reply envelope's `protocol` field, and the
`v` field of every WebSocket step frame (the coordinator bridge). A frame
or client speaking a different version fails loudly at the handshake, both
versions named.

The reply envelope: every 200 reply body carries
`{ "protocol": <version>, …payload }`; 400/500 replies carry
`{ "error": "…" }`.

## Routes

`POST /projects/<project>/executor/<route>` over the daemon, authenticated
with a Bearer token; the coordinator bridge carries the same routes as
WebSocket step-request frames.

```protocol
ready
claim
brief
report
heartbeat
release
```

- **ready** — the dispatch menu: `claimable` units with their claimable
  kinds, the caller's live `leases`, the `types` restriction catalog, the
  `pending` person items. The envelope carries `build` beside `protocol` —
  the bridge's own line: a stamped build names its commit, a source-mode
  bridge names the tool tree's own commit plus dirt at its spawn (`dev`
  only when git cannot name the tree), the daemon's `/health` `line` the
  comparison home (plans/0270, its source-mode line widened plans/0293).
  Idempotent; safe to poll.
- **claim** — take the next step (untargeted), or a targeted
  `{ task, kind }`. Returns a leased grant, or a wait/blocked/terminal
  step. A held lease answers the same grant (brief refresh) for its holder.
- **brief** — re-read the live grant's brief for `{ task, kind }`; with
  `cursor`, the paged person answers (`answers`/`next`).
- **report** — `{ step, lease, outcome: ended|failed, note? }`: the share's
  result. `ended` settles (the coordinator stages, commits, closes out);
  `failed` books the attempt without landing. Ambiguous delivery: retry the
  same report; a same-token claim resumes settlement first. A late report
  over a dead lease whose unit the record already closed is answered with
  the `reconciled` receipt (plans/0287): the lease ended without the share —
  the receipt says so, whatever outcome the report claims. A landed receipt
  carrying the continuation flag — the holder's `Status: continue` handoff
  statement — holds the designed continuation until the person's evidence
  corrects it: an amended (committed) Status line or the unit's completion
  strips the flag at the next wire act's sweep (plans/0289), the verify
  share following the corrected receipt; a completion-closed landing carries
  `closed: "person"` and never verifies (a person-closed unit is done).
- **heartbeat** — renew the listed leases (the window derived from the
  grant's own budget, capped at twice it) and read the menu.
- **release** — surrender a live lease without a report.
- **report** carries `note`; a holder blocked on a cause outside its
  permitted writes is answered `blocked` naming the person-necessary cause
  in the detail — no escalation channel exists anywhere (plans/0282): the
  plain `blocked` answer with its remedy is the whole surface, the round
  waiting until a person looks at the state. A coding agent blocked
  mid-grant resolves the block itself and records its decision in its
  artifact (the prompts' standing AUTO-DECISION rule).

## Grant kinds

The work vocabulary — `WORK_TYPE_IDS`, each its own grant shape and landing
fence:

```protocol
execute
verify
fix
formulate
synthesize
distill
audit
```

- **execute** — a task unit's whole-task share. Address: the task id. The
  grant carries `prompt` (the whole-task brief), `budget`, `lease`,
  `deadline`, `attempt`, `workspace`, `answerCursor`. Writes: the unit's
  effective scope (`touches`/declared scope) or the freeform floor, plus
  the handoff document.
- **verify** — the independent wrap-up judgment over a landed execute
  share. Requires a different token from the producer. Writes exactly one
  artifact: a PASS `report.md` or a countable FAIL `gaps.md`. A PASS
  close-out ticks the index row and renames `todo.md` → `done.md`
  (driver-exclusive shapes, the coordinator's alone). A FAIL opens a fix
  round. A same-token claim over its own booked report answers the terminal
  `settled` naming the booked commit.
- **fix** — a repair round over a FAIL verdict. Carries the gap context;
  the settlement retires the consumed gap list. A fix round over a
  formulation unit carries the formulation context (`phase`, `index`); over
  a close-audit unit, the audit context (`findings`).
- **formulate** — the phase's planning session as claimable work. Address:
  the formulation unit's own task id; `phase` and `index` ride the grant.
  Writes the formulation family: the phase's task index, the planned tasks'
  pending documents (minus the unit's own input todo), the coverage map,
  the handoff.
- **synthesize** — the formulation construction's re-voicing session (the
  constructor one-shot converged). Address: the construction unit's own
  task id; `phase` and `index` ride the grant; the brief is the identical
  `formulate-synthesize` prompt over the same evidential sources the push
  compose renders. The holder writes its reply (the prescribed
  `<<<SOURCES-BRIEF …` / `<<<LEDGER …` blocks plus the `Rationale:` line)
  at the unit's `todo.md` path — the one write surface, the reply channel.
  The settlement validates mechanically (the ledger grammar, the seeded
  sequence, the quote anchoring, the guarantee asserts), composes the
  synthesized todo and lands it through the standing construction path —
  one `PLAN formulate` commit under the `phase-synthesize` stage. Terminal:
  no verify share follows a synthesis; the unit continues as formulate
  work over the synthesized todo. Derives only while the standing todo is
  the floor (its Scope carries no obligations ledger), a charter resolves,
  and the synthesis switch is not off — otherwise the formulate floor is
  byte-identical.
- **distill** — the phase-boundary distillation (the handover document).
  Address: the phase's qualified id; `handover` (the one write path) rides
  the grant. Terminal: no verify share follows a distillation; the
  completion rename and tick are the person's transfer act.
- **audit** — the round's standing close-audit adjudication session.
  Address: the standing unit's task id; `findings` and `round` ride the
  grant. The share lands whatever its verdict (the no-fix rule: a FAIL
  finding is the person's, surfaced at the round's close, never a repair
  input).

Claim addresses are the durable records' own shapes: task ids for
task-shaped units (execute/verify/fix/formulate/audit producers), the
qualified phase id for the boundary (distill).

## The menu, the catalog, and the fence

`ready`'s menu carries beside `claimable` and `leases`:

- **`types`** — the restriction catalog, one letter per kind, rendered from
  the same tables the landing fence reads: `never` (the standing refusal
  set as path grammar plus `git: "coordinator-only"` — the coordinator
  alone stages and commits) and `writes` (the per-kind artifact paths, with
  the scope letter: `unit-effective` + the `undeclared: "freeform"` floor,
  or `none`).
- **`pending`** — the pending person items: `gate` rows (the gate and its
  document), derived from the documents, and — when the claimable set is
  empty — the lane's own held row (plans/0287): the derivation's first
  `wait`/`blocked` answer (`kind`, `reason`, `detail` — the step
  vocabulary's own shapes), so an empty `claimable` never sits beside a
  silent cause (0285's honesty gap).

The landing fence admits per grant exactly: the standing refusal set
refused for every kind (the driver workdir `.auto/`/`tmp/`, the config
directory, every `AGENTS.md`, the unit state documents `todo.md`/`done.md`,
the index family `phases.md`/`tasks.md`, `subtasks.md`, `opencode.json`),
then the per-kind arms stated above. An out-of-scope edit blocks the
settlement replayable; a never-set cause (every offending path refused for
every kind) is the person's.

The settlement is grammars alone (P7): the fence admits the write
**surface**, the collect judges the **grammar** — the per-kind validations
(the formulation collect's fixed prefix and planned-document problems, the
handover's four mandatory sections, the findings' `Result:` line and
due-row naming, the verify report/gap shapes) are the same mechanical
checks the push path ran. Content quality is acceptance work and the
person's boundaries, never the coordinator's judgment.

## Gates and terminal steps

The person's gates derive from document state (the admission derivation):
`project-start` (no round established) and `survey-release` (the survey's
human gate, `Fork:`/`Clarified:` regions in the survey document). The
person's acts are document writes and the daemon's deterministic
operations — the release act is the `clarify` operation (or the document
edit itself), the boundary advance the `transfer` operation, and the
executor ledger's dead-letter reconciliation the `reconcile` operation
(plans/0287, its booked non-landing class widened plans/0292; the sweep
itself runs automatically at every wire act, booking dead leases and
booked `without-landing` receipts whose units the record closed — the
operation is the person's forced arm, naming a unit whose dead lease or
booked `without-landing` receipt books whatever the unit's state); the
same sweep re-derives a booked continuation whose evidence the
person corrected — the handoff's Status line amended, or the unit completed
(plans/0289; evidence-gated alone, the operation naming a unit whose
continuation still stands answering with the two document channels); the
menu's `pending` list names the awaiting gate and its document.

The step vocabulary a claim can answer beside the grants: `wait` (with
`reason`: `lease-held`, `in-flight`, `question`, `gate`, `not-ready` and a
`retryAfter` where it applies), `blocked` (`isolation`, `commitFailed`,
`attemptsExhausted`, `fixBudget`, `config`, `subtask`, `unreadable`,
`cleanTree`, `mutualPark`), `human` (a gate naming its document),
`phase-boundary` (the phase awaiting the person's transfer), `settled` (the
same-token terminal naming the booked commit), and `done` (the round
complete).

## Share stage words

Every coordinator commit carries the `Auto-Stage` trailer; the protocol's
own stage words (each the push family's own word, never an invented one):

```protocol
exec
wrapup
fix
phase-formulate
phase-synthesize
phase-handover
close-audit
park
done
clarify
```

The first seven are the per-kind share words; `park` is the dependency-park
share; `done` is the verify close-out; `clarify` is the gate release
commit. Nested-root landings add the lane family's `landing` /
`landing-sync` / `merge-repair` words on the main tree.

## Token scopes

The daemon's authorization tiers (`SCOPES` in the server's store):

```protocol
read
control
config
probe
executor
projects
```

The executor routes require `executor`.

## The project lifecycle

The registry the whole surface resolves against is itself served over REST
(plans/0284): `GET /projects` lists it (the `read` scope), `POST /projects`
creates into it (`projects` scope) and `DELETE /projects/<project>` removes
from it (`projects` scope). Creation is generalized beyond the retired
`--open` roots: the request names the directory to create — `{"directory":
"<absolute path>"}`, the destination's own parent the anchor (operator-owned,
no group or public write), the basename the project name (a `"name"` field
overrides), an optional `"config"` object the init the staged creation runs
with. The staging is the same engine: a private stage directory, the init,
the no-replace publication, the registration — every kill point
re-derivable, a retried request idempotent. Removal refuses 409 beside a
live coordinator or run (the stop taught: `DELETE /runs/<id>`, the run id
named) and beside a run lock held by a driver the daemon does not know (the
same shared condition the CLI's `unregister` meets); past both, the entry
is removed — the directory itself is never touched.

## Tombstones

The compatibility record — vocabulary this spec has removed. A removed
route, kind, scope or stage word is listed here with its ruling, never
silently reused (ids are never reused).

```protocol
protocol: 1 — premature: the pre-0280 literal, retired by 0279's version ruling (preview-open at 0.1; old clients fail loudly at the handshake)
routes: question, answer — the ask channel (plans/0282): the holder's question route and the person claim/answer arms; a blocked coding agent resolves its block itself, the person acts on documents and the deterministic ops
scopes: answer, person, person-questions, person-releases — the person grants (plans/0282); six scopes remain
worker payloads: options, switches, plan, transfer, lane — the push run carriage (plans/0282); the executor coordinator is the only spawn, its payload {executor, directory, transport}
POST /runs — the plain push run starter (plans/0282); the executor route is the only run starter
GET /, /app.js, /session — the web client (plans/0282); the daemon serves coding agents only
cli commands: run, plan, transfer, clarify, _lane (opencode-auto) and transfer <dir> (opencode-auto-server) — the push CLI commands (plans/0283): their channels are the daemon's operations and the protocol's grants, and each binary answers the word with a permanent usage tombstone naming the surface
```

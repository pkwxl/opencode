# 0160 — the auto-server absorb: the service shell boots again on the 0159 core — every retired export replaced, every config key threaded, the advance command real

Ruled from the 2026-10-30 three-package review's auto-server pass (the sixth
and final plan of the review's fix wave, plans 0155–0159 having landed in
auto-core and auto; every finding re-verified against HEAD 8e138e3f6 before
the change): the service shell's history ends around T-108 while the core
landed 0100–0159 underneath it, and the review found it broken end to end —
not one drifted behavior but the whole absorb missing. The deliberate absorb
is this change: make it boot, make its suite green, close the semantic drift.

## The measurement (the review's findings, each verified against the current code)

- **The bin cannot boot.** `src/ops.ts:51` imports `renderProjectBrief` from
  `@opencode-ai/auto-core/brief` — an export 0133 retired with the whole
  brief-stub mechanism (init never writes the project brief; the analysis
  flow owns the start; `projectBriefText` treats comment-only text as
  empty). Live-verified: `bun src/index.ts --version` dies with
  `SyntaxError: Export named 'renderProjectBrief' not found`, and the import
  chain src/index.ts → daemon.ts (`OP_DEFINITIONS`) → ops.ts means
  serve/worker/register/token ALL die at module load. The dead import sat in
  two test files beside it (test/ops.test.ts:38, test/web-write-serve.test.ts:36),
  and `src/ops.ts:636-641` still wrote the stub with the "fill in the goal,
  the migration source and target" teaching the core retired.
- **Runs through the daemon silently drop four constitutional config keys.**
  `src/worker.ts` `runOptions` (~276-304) passed everything the CLI's
  `runOptions` passed circa T-108 — but the CLI's
  (packages/auto/src/index.ts:2134-2165) now also threads `intent`,
  `treeLanes`, `lanes`, `isolate`. A cleanroom project
  (`"intent": "cleanroom"`) run through the daemon planned on the DEFAULT
  intent pack — different prompts, guarantees and compliance gates,
  silently. The same four were missing from `src/ops.ts`
  `CONFIG_REQUEST_KEYS` (the init/amend API could not set three of them) and
  from `src/request.ts` `CONFIG_KEYS`/`HAND_EDITED_KEYS` (a run request
  carrying `"intent"` got the generic "is not a run option" refusal instead
  of the frozen-key refusal; `lanes` was hand-edited-only in the core but in
  neither table). The CLI's planPrelude call also passes `isolate` and
  `testByDriver` (packages/auto/src/index.ts:1546-1569) — the ops layer's
  plan/task-add prelude calls passed neither, so a daemon-side round
  establishment ran without branch isolation.
- **The fix op mishandles the 0135 `info` finding class.** Core findings
  carry `class: "fixable" | "manual" | "info"`; `src/ops.ts`'s fix op
  filtered fixable+manual only, so dryrun info-only findings reached the
  409/code-1 refusal where the CLI's `fix --dryrun` exits 0 ("exit 0 … when
  only informational notes remain", packages/auto/src/index.ts:3066), and an
  apply with info-only findings fell through to "✓ config layer repaired" —
  claiming a repair that applied nothing, inviting an empty commit.
- **Headless project start is untrue.** Since 0101, `planPrelude` for a
  phased not-established project returns the transferStartLine stop
  (auto-core src/plan.ts:1259-1264) whose text renders with the profile bin:
  "the project start … is transfer's; run: opencode-auto-server transfer
  ${dir}" — and `opencode-auto-server transfer` did not exist (the command
  surface: serve/register/unregister/projects/token/worker). The API's own
  answer pointed at a nonexistent command of itself; the phased complete
  round's refusal (plan row 2) and every phased run's natural boundary stop
  name the same nonexistent command. The per-run surface had drifted beside
  it: the CLI's `run` gained `--repair` (0079), `--stop-after` (0128) and
  `--boundary flow` (0101); the request vocabulary carried none, while
  presenting `maxSessions` as usable though `parseOptions` caps it at 1 (a
  deliberate reserved call citing plans/0069 §6 item 5 that no doc stated).
- **The suite could not run.** 43 pass / 22 fail / 13 load errors at HEAD
  8e138e3f6: the load errors all the D1 import; the ws-protocol first
  assertion deterministic-failing on a race (`opened` resolves on the
  client-side handshake while the server's hello arrives in a LATER message
  event, so frames[0] is read before it exists — the same shape twice more
  in interactive-ws.test.ts and question-queue.test.ts); and the package's
  fake-claude fixture 144 diff-lines behind the maintained reference in
  packages/auto (still carrying 0150's retired numbering-recovery branch,
  rewriting the phase index against 0095's formulation-line rule, missing
  the reference's lane-era branches), with the e2e fixtures riding
  CONFIG_DEFAULTS' subtask default that flipped from `auto` to `off` on
  2026-10-04 — the split flow every interactive scenario needs never ran.

## D1 — the brief-stub retirement, init's teaching re-keyed

The dead import and the stub write retire whole: init (plain and the API's
amend path alike) writes no brief file, exactly the CLI's behavior since
0133 — the analysis flow owns the start. Init's closing line re-keys to the
CLI's own current shape (plans/0101 D4 + 0084): the rounds' opening command —
**transfer** on a phased project, the plan operation in m mode — with the
fresh-project pointer naming the assisted analysis ("you and your agent fill
docs/analysis.md, guided through AGENTS.md; round R-NN opens on its release —
never a project brief: the analysis flow owns the start"). The test fixtures
stop writing stubs; where a suite needs a brief present (reset's keep rule),
it writes plain brief content, and reset's keep-reason assertion moves to the
core's current wording (an installed approved proposal or a person's
`amend --brief` write is kept — the stub-remove rule retired with the stub).

## D2 — the four keys reach the run, the CLI's threading the reference

The CLI's `runOptions` is the single reference the worker mirrors, key for
key: `intent`, `treeLanes`, `lanes`, `isolate` thread from the strict-loaded
config into every `runAll` and `runTransfer` call (src/worker.ts
`runOptions`, exported for the direct unit assertion — the pure mapping,
never the entry called in-process). The plan and task-add operations' prelude
calls gain `isolate` and `testByDriver` (the establishment and analysis-gate
facts the CLI passes). The request vocabulary's key tables gain all four
names: `intent`/`treeLanes`/`isolate` in `CONFIG_KEYS` with their amend-flag
hints (both spellings for tree-lanes), `lanes` in `HAND_EDITED_KEYS` beside
`acceptanceGate`/`build` (its class: hand-edited table, no flag). The
init/amend API accepts the three settable keys with the CLI's own validation
(`isolateProblem` per path, `treeLanes` off/auto/on with off the dropper,
`intent` a pack name existence-checked against the loaded packs on the merged
value — a key every run would silently ignore is the drift the frozen-key
design exists to prevent; the bundle-materialization channel stays the
CLI's `init --intent`, stated in the refusal). The web client's config form
gains the three fields (the hand-edited trio stays fieldless). The new tests
surfaced a sibling bug of the same family that the review had not named: a
**positive `scanExempt` never reached the merge** — the parse kept it in a
side field no merge input read, and `[]` (the documented key dropper)
collapsed into absent — so the person's scan-exempt revision silently
vanished. Fixed with the same ruling: the carried list rides whole, `[]`
deletes the key, and the amend "✓ amended (…)" line names exactly the keys
the request touched (its old double-count of positive parallel/treeLanes
values fixed beside it).

## D3 — informational notes never gate

The fix op filters to the 0135 semantics the CLI holds: dryrun with only
informational notes answers the success shape (200, `code: 0`, the header
saying "config-layer notes", the closing line "nothing to repair"), fixable
or manual findings keep the 409/code-1 drift-gate shape; an apply with
nothing fixable asks no gate and claims no repair ("✓ nothing to fix: the
note(s) above are informational — nothing to repair"), the file untouched.

## D4 — the advance command real, the run vocabulary current

- **The transfer operation** (`POST /projects/<p>/transfer`, the control
  scope, request field `resynthesize` alone): the core's `runTransfer` has
  no prelude seam splitting the no-agent routes from the advance — the
  whole state resolution (m mode's refusal included) lives inside its one
  entry — so the entire advance runs as a spawned worker run carrying a
  transfer payload (the worker calls `runTransfer`, one process per
  advance, the same one-run-per-process topology as every run; re-implementing
  the split at the ops layer would be the constitution-erosion risk ops.ts's
  own header names). The run's exit vocabulary maps the outcome: 0 a
  review, round-open or roadmap-exhausted stop; 1 a state error; 2 a gate
  held or nothing to advance.
- **The `transfer <dir>` CLI subcommand** of this binary: a thin
  self-spawn of the same worker (deriveWorkerCommand, the daemon's own
  resolution), exit code verbatim — every core text naming
  `opencode-auto-server transfer <dir>` (the plan refusal over an unstarted
  project, the complete-round refusal, each phased run's boundary stop, the
  round-start gate's next line) now points at a runnable command. Headless
  by construction: its questions degrade the hand-spawned worker's way; the
  daemon's transfer operation is the interactive surface.
- **The run vocabulary** gains `repair` (0..10, 0 = the serialized default's
  absent), `stopAfter` (a T-NNN id) and `boundary` (stop|flow) — validated
  like the CLI's parse helpers, refused under a plan or transfer payload
  (the core carries no budget under a stop condition; the CLI refuses the
  same pairs on its flags). The maxSessions=1 cap stays, now documented
  where the field is advertised (README + daemon.md naming the reserved
  call, plans/0069 §6 item 5).
- **The docs' truth pass**: the round-establishment wording (plan no longer
  establishes phased rounds — transfer's since 0101), init's closing line,
  the per-run options list, the honestly-absent surfaces stated once and
  plainly (clarify, sync, land, fork/remove-fork, driver-helper stay
  CLI-side; the daemon's own release teaching names the manual path), and
  the shell-contract §A row's command list.

## D5 — the suite green, the fixtures absorbed

The fake-claude fixture is rebuilt from the maintained reference
(packages/auto/test/fixtures/fake-claude.ts) with this package's own
extensions kept (FAKE_CLAUDE_DELAY_MS, the T-094 interruption-resume
branches); the e2e fixtures pin `subtask: "auto"` explicitly (the split flow
their scenarios ride — the CLI's own split fixtures pin it the same way; the
core default flipped to off on 2026-10-04 and the fixtures silently lost
their flow). The three frames[0]-at-`opened` races await the hello frame
itself (nextOf, the helper every later assertion already used). The
status-events backpressure case proves the cursor over a short tail (a
resume replaying the whole 6000-line backlog is itself bounded by the same
subscriber cap — the replay's enqueue out-runs any reader's drain — so the
second batch + `?after=6000` is the deterministic shape). plan-e2e and the
cross-stack service e2e restructure to the current phased grammar: plan
refuses the unstarted project naming transfer → transfer opens the analysis
→ the person releases it (their document, their commit) → transfer installs
the approved brief and establishes R-01 at the round-start gate → the person
fills the round brief and the phase's plan-input.md (the input's home since
0095) → transfer constructs the formulation todo at the review seam → plan
dispatches the session → … → the closing transfer advance runs the handover,
closes the phase and the round, stopping at the person's moment. The in-process
daemon now applies the server profile at startDaemon (an embedding host and
the test harness are shell entries of their own; without it the daemon's
in-process core texts named the default bin). Suite: 43 pass / 22 fail / 13
load errors before → **132 pass / 0 fail** after (22 files), typecheck clean.

## Hygiene (the same change)

`register` refuses a regular file at the path (the error text always said
"not a directory"); the worker-bridge secret compares timing-safely over
SHA-256 digests (the token store's own pattern), its query-string carriage
noted as the documented v1 loopback posture; `compactJournal`'s first-raise
survival carries the one-line why (a re-raise restates the same ask — the
original wording is the record — against foldJournal's last-wins on timer
state); the ops.ts header's core-function list matches the current import
set.

## Deferred, named

- Run-registry eviction in a long-lived daemon (each record keeps an 8 KiB
  tail; the documented P1 decision "Run history does not survive a restart"
  stands).
- Any surface beyond D4's set (clarify/sync/land/fork/driver-helper stay
  CLI-side, now stated honestly in README and daemon.md).
- The web start form offers none of repair/stopAfter/boundary (the daemon
  accepts them; the form's minimalism is the client's own posture).

Derives: **P13** (the showing: the frozen config keys, the run vocabulary
and the retired stub's tombstone all moved in one lockstep — the four names
entered CONFIG_KEYS, CONFIG_REQUEST_KEYS, the worker's threading and the web
form together, and the retired export's last writer was deleted, not
renamed), **P2** (the person's config never silently ignored — the showing:
the four keys and the scanExempt revision reach the run/the file, and the
intent name is refused when no pack loads it rather than accepted and
ignored), **P5** (one source of truth — the showing: the CLI's runOptions
threading is the reference the worker mirrors key for key, asserted directly
so a future key cannot silently diverge), **P18** (the showing: the absorb
keeps the daemon on plain files, git and one spawned process per advance —
no new state, no mirrors), **P16** (the showing: the honest-gap statement is
a documented boundary, never an in-code project fact; the headless start
teaches the person's own document, the analysis). Amends: **the service
shell's recorded shape** (docs/shell-contract.md §A's auto-server row and
the §E closing context, the plans/0067-era record — its operation set gains
transfer, its one-process-per-run rule now covers the advance, the §A row
updated in the same change). Tier touched: **mechanism — shell
(packages/auto-server: src/*, test/*, web/*, README.md, docs/daemon.md) +
the core plans corpus (this document, the INDEX row) and the shell-contract
§A row — no core src change (the core bent for no shell; every semantic
 mismatch was absorbed shell-side).**

## Category scope (0123 D1's discipline — reconstructed 2026-11-05 by 0166 step 003 from this ruling's D-blocks and landing commit 6c344f9d8)

Family: *the auto-server service shell's absorption — its config/run vocabularies brought onto the
core's current semantics, the advance command made real, and the suite made green.* Home-set
reconstructed from D1–D5, the hygiene and the deferrals:

| home | disposition |
|---|---|
| `packages/auto-server/src/worker.ts` (runOptions mirroring the CLI's threading key for key; the transfer payload; the `transfer <dir>` subcommand) | changed — D2/D4 |
| `packages/auto-server/src/ops.ts` and `packages/auto-server/src/request.ts` (the brief-stub retirement; the four keys with the CLI's own validation; the scanExempt merge fix; fix filtered to the 0135 semantics; the transfer operation; the run vocabulary's repair/stopAfter/boundary) | changed — D1/D2/D3/D4 |
| `packages/auto-server/src/daemon.ts`, `packages/auto-server/src/store.ts`, `packages/auto-server/src/question-journal.ts` (the server profile at startDaemon; register's not-a-directory refusal; the timing-safe secret; compactJournal's first-raise survival) | changed — D5/hygiene |
| `packages/auto-server/web/api.ts`, `packages/auto-server/web/ops.ts`, `packages/auto-server/web/render.ts` and `packages/auto-server/src/web/client.ts` (the config form's three new fields) | changed — D2 |
| `packages/auto-server/README.md` and `packages/auto-server/docs/daemon.md` (the docs' truth pass: the honestly-absent surfaces stated once, the reserved maxSessions call named) | changed — D4 |
| `docs/shell-contract.md` (the §A row gains transfer; the one-process-per-run rule covers the advance) | changed — the amend |
| Core `src/` (no core change — every semantic mismatch absorbed shell-side; the core bent for no shell) | held, untouched |
| Run-registry eviction in a long-lived daemon; the CLI-side surfaces (clarify, sync, land, fork, driver-helper); the web start form's minimalism | held, untouched — deferred, named |
| Test homes: `packages/auto-server/test/worker.test.ts`, `test/daemon.test.ts`, `test/ops.test.ts`, `test/plan-e2e.test.ts`, `test/service-e2e.test.ts`, `test/ws-protocol.test.ts`, `test/interactive-ws.test.ts`, `test/question-queue.test.ts`, `test/status-events.test.ts`, `test/web-write.test.ts`, the fixtures `packages/auto-server/test/fixtures/fake-claude.ts` and `project.ts` (the suite 43/22/13 before → 132 pass / 0 fail after) | changed — D5 |

Tests: `test/worker.test.ts` — the four keys' frozen refusals with their
amend hints, the lanes hand-edited refusal, the transfer-payload vocabulary
(plan/transfer exclusion, the run-side widths refused under both payloads,
repair/stopAfter/boundary shapes), the `runOptions` verbatim-threading unit
case beside a real run carrying the new keys; `test/daemon.test.ts` — the
four keys' refusals on POST /runs and the `transfer` field's; `test/ops.test.ts`
— the init/amend vocabulary for intent/treeLanes/isolate (droppers, bad
values, the pack-existence refusal, the isolate-over-init nested
repository), the fix info shapes (dryrun 200, apply honest, the file
untouched), the boundary matrix's transfer refusals, and the transfer
operation's suite (the request shape, m mode's failed/1, the construction
stop, the analysis-open and released-establishment runs); `test/plan-e2e.test.ts`
and `test/service-e2e.test.ts` — the full phased grammar end to end;
`test/ws-protocol.test.ts` / `test/interactive-ws.test.ts` /
`test/question-queue.test.ts` — the hello races; `test/status-events.test.ts`
— the deterministic cursor-resume shape; `test/web-write.test.ts` — the
widened config-form vocabulary.

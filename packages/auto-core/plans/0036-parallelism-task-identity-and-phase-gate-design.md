# 0036 Parallelism, task identity and the phase acceptance gate

> **Status (2026-10-02): the executional half is superseded by
> `0068-parallel-execution-lanes-design.md`.** N4/tier 3 — intra-run parallel
> execution, §6.4 — is designed and implemented there (S1–S6, 2026-10-02):
> one git worktree and one child worker process per lane, the readiness
> scheduler, the landing protocol and orphan recovery, built on this
> document's declaration half (`plans/0046`) and upholding its D15 (per-agent
> worktrees, id allocation central) and D17 (byte-identical at one session).
> The rulings 0068 kept of this document are recorded in its §12 (Q5(a) → its
> D3, Q10 → 0046 D9, Q12 → its D10; D16's per-unit state list dissolved by
> its D6, D18's test-queue item by per-worktree `tmp/`, the observability
> half lands as its D13). N3 landed earlier in 0045/0049; N1/D3 (the id
> namespace) stays retired per 0068 §1 until topic merges become real. Not
> maintained further.

> **Status: proposal. Nothing here is implemented. Exactly one point is
> confirmed so far — D13's reading of `high/medium/low` as planning guidance
> rather than agent counts (user, 2026-09-21, question 11); every other
> decision below is unconfirmed.** Produced from a design discussion on
> 2026-09-20 that
> started as an evaluation of a five-level `docs/` directory scheme and turned
> out to be about three requirements the directory scheme was standing in for;
> revised 2026-09-21 to add the governing principle **P1** (§4.1), which
> constrains all of them and should be read first, and a fourth requirement
> **N4** — parallelism as a first-class capability with a concrete `--parallel`
> / `--max-agents` interface (§1, designed in §6.4, interface choices in §11
> questions 10–12). Revised again later on 2026-09-21 after verifying the
> marker-lifecycle question: F21 restated, **F29–F31** added, **D11 narrowed to
> a recommendation of (c)** and §9's marker-table warning corrected (the tier-1
> table does not move). The root plan now points here (its D12, open question 15,
> risk 12, the reserved `MP` track, and candidate-scope notes under M2–M4;
> integration-repo commit `2884099`), so a session starting from the documented
> entry point can find this document.
> Stage-assisting document per D6: consumed by **M2.1** (marker wording — see
> §9), **M2.2–M2.3** (governance intent section, document role model and
> standardization boundary),
> **M3** (phase loop — the plan states the human review gate for
> plan/handover lives at this layer), **M4.1–M4.2** (human-intervention
> surface inventory and convergence), and — for N2's tier 2 and all of N4 — a
> new orchestration milestone that does not exist today.
> Retires when each recommendation below is either implemented or explicitly
> rejected; it is not maintained against later code.
>
> Requirement labels are `N1`–`N4` (not `R1`–`R4`) to avoid colliding with the
> stable-refs path rules R1–R7 cited throughout `src/docpaths.ts`.

## 1. The four requirements

| # | Requirement (as stated by the user) |
|---|---|
| N1 | When topics are merged, references must not become ambiguous because two `T-XXX` numbers collide — **especially references to the numbering system inside comments in the target source code**. |
| N2 | Raise parallelism: run as much as possible via parallel tasks (or subtasks) to shorten the wall-clock span of a round. |
| N3 | A phase may need several rounds of human ↔ AI interaction before it is complete and may advance; that interaction mechanism needs to be completed. |
| N4 | Parallelism as a **first-class capability** (added 2026-09-21, supersedes N2's "is tier 3 needed?" framing): the tool should arrange tasks and subtasks so they *can* run in parallel, and make the dependencies between them explicit, so that when parallel execution is allowed it launches several AI sessions at once and finishes the development process in the shortest time. Interface proposed by the user: `--parallel [high\|medium\|low\|none]` frozen at `init`, `--max-agents <N>` at `run`. |

## 2. The proposal under evaluation (recorded faithfully)

Under `docs/`, introduce a topic level (`fs` filesystem, `dm` device model,
`net` network); below the topic, round directories, then phase, task and
subtask directories. Each level numbers internally; references must be written
as full paths or they risk being misidentified. Stated advantage: several
parallel topics merge naturally and without conflict. Topic / round / phase
levels are all optional — without them the task numbering system still lands
flat in `docs/`, i.e. it degenerates to today's layout.

Evaluation in §7. Short version: it answers N1 by **relocation**, which is the
weakest of the three available levers (prevent at issuance, isolate at the run,
rewrite after the fact), and it does not touch N2 or N3 at all.

## 3. Fact baseline

All paths relative to `packages/auto-core/`.

### Reference integrity (N1)

- **F1 — refcheck is one-directional and off by default.** Scan scope =
  `docs/**/*.md` (`src/refcheck.ts:117-119`, `activeDocs`), excluding
  `docs/phases/**` and round phase archives. Rewrite scope is the same set
  (`autoCorrectRefs` `src/refcheck.ts:609-613`; `script/fix-refs.ts` shares the
  primitive). Reference **targets** may be any file in the tree (`validateRefs`
  resolves against a whole-tree index; `walkTree` prunes `node_modules`/`.git`
  and descends symlinks). So `docs → source` is checked and **`source → docs`
  is not scanned at all**. The whole layer sits behind
  `OPENCODE_AUTO_REF_CHECK`, default **off** (`plans/0013` D3).
- **F2 — task ids have already escaped `docs/`, some into immutable media.**
  Git trailers `Auto-Task: <id>` / `Auto-Stage:` (`src/git.ts:19,26-32`) cannot
  be rewritten without rewriting history; PLAN.md headings `## T-NNN: <title>
  [status]` are parsed back by `/^## (T-\d+): /` (`src/numbering.ts:59`); the
  phase ledger (`src/phases.ts:65`), `.auto/progress.json`, the prompt
  ground-state block's fully qualified `T-NNN.SNN`, and `.auto/invalid-refs.md`
  all carry ids too.
- **F3 — numbering would not notice a topic level.** `taskNumberFloor` scans
  depth-agnostic globs `docs/**/T-*.md` and `docs/**/T-*/*.md` and takes the
  first `T-<digits>` path segment (`src/numbering.ts:66-80`), then returns
  `max + 1` from the singleton `.auto/next-task`. Inserting a directory level
  neither breaks nor helps it: it silently takes the **global** max, so ids that
  already collided before a merge stay collided after it, forever.
- **F4 — an id namespace inside the id is already precedented.** `T-F<k>`
  (final-review tasks) is a separate derived namespace; `src/numbering.ts:20-23`
  explicitly excludes it from the numeric space (`/^T-(\d+)$/`).
- **F5 — a mechanical rewrite primitive exists but is docs-only.** `rewriteRefs`
  (`src/refcheck.ts:86-107`) replaces whole-path tokens at word boundaries,
  already guards `docs/T-1.md` against `docs/T-11.md`, and is byte-identical on
  zero hits. It cannot reach git trailers.
- **F6 — `docs/` has exactly two top-level namespaces today**: `T-NNN`
  (cross-round permanent task docs) and `R-NN` (self-contained round
  containers) — `src/docpaths.ts:61-63`. Task dirs are deliberately **not**
  under rounds because task paths are permanent (stable-refs R2) while rounds
  get archived. Phases own only free artifacts
  (`docs/R-NN/phase-docs/<letter>-<slug>/`, `src/phases.ts:146`) and never own
  tasks; root `PLAN.md` is a symlink to `docs/R-NN/PLAN.md`
  (`src/phases.ts:313`), and `T-F<k>` spans phases.

### Parallelism (N2)

- **F7 — execution is strictly sequential at every level.** Task loop
  `src/loop-task.ts:111-290`; subtask loop picks the first unticked item
  (`src/runner.ts:461-528`, selection at `:484`); one live session per subtask
  (`src/execute.ts:386-398`); the reuse chain holds a single `chain.id`
  (`src/runner.ts:134`).
- **F8 — the commit boundary forbids two units in one worktree.** `beginUnit`
  requires a clean tree at unit start (`src/git.ts:343-362`; dirty → exit 2 at
  `src/loop-task.ts:151-155`); `commitTree` stages with `git add -A`
  (`src/git.ts:63,71`), so it would sweep another session's half-written files;
  `unitViolations` requires every commit in `baseline..HEAD` to carry
  `Auto-Stage:` (`src/git.ts:155-171`, `foreignCommits` `:214-220`); rollback is
  a soft reset to the unit baseline (`src/unit-commit.ts:149-182`), which would
  revert the other unit's work.
- **F9 — every piece of mutable driver state is whole-run or per-task.**
  `.auto/progress.json` holds **one** record `{task, session?, active, phase?,
  baseline?, model?}` (`src/resume.ts:96-116`); `CURRENT.md` mirrors *the*
  running task (`src/runner.ts:280`); `.auto/handover.json`, `.auto/next-task`,
  `.auto/stats.json`, `.auto/verify.md`, `.auto/review.md` are one file each;
  `tmp/test.sh` is a **single well-known slot** by which a session asks the
  driver to run a test (`templates/prompts/subtask.md`). The only
  parallelism-safe granularity today is `docs/T-NNN/S<nn>/todo.md|done.md`
  (written by `src/subtask-state.ts`, renamed at `src/execute.ts:488`).
- **F10 — there is no dependency model.** `src/plan.ts` has no
  `depends`/`blockedBy`; task order is file order (`next()` `src/plan.ts:96-98`)
  and subtask order is checklist order. Independence is asserted **only in
  prompt prose** (`templates/prompts/_partials.md:54-59`: previously completed
  tasks are independent, other items belong to other sessions) — an epistemic
  guard against misreading progress, not a machine-checked property.
- **F11 — the only existing overlap is not unit-level.**
  `OPENCODE_AUTO_HANDOVER_CONCURRENT` (`src/switches.ts:29`,
  `src/watch.ts:159-183`) starts the test script without awaiting it, i.e. it
  overlaps a **test run** with the **same session's** wrapup. `--early` overlaps
  an audit session with a verify-script window (`src/runner.ts:543-552`). No two
  AI sessions ever run concurrently.
- **F12 — M1.4 produced the first machine-checkable per-subtask output
  declaration.** `declaredArtifacts` parses the `产出:` token
  (`src/document/spec.ts`), so each subtask now declares the paths it will
  write. This is the missing prerequisite for path-scoped staging and for any
  disjointness check.

### Parallelism as a capability (N4, added 2026-09-21)

- **F24 — the two-class flag mechanism already exists, and the proposed split
  matches it exactly.** Constitutional attributes are frozen by `init` into
  `.opencode/auto/config.json` (versioned, shared with the repo,
  human-editable), and **passing one to `run` is a usage error**
  (`packages/auto/src/index.ts:141,1054`; schema and defaults
  `src/config.ts:17-70`, file path `:75`). The other class is run-time flags
  (`--review`, `--early`, `--wait-answer`, `--interactive`, `--new-session`,
  `--dryrun`). So `--parallel` at `init` and `--max-agents <N>` at `run` need no
  new mechanism — they slot into the two existing classes as proposed.
- **F25 — `--agent` is already taken, and means something else.** It is a
  constitutional attribute naming the agent (`src/config.ts:17`, default `"auto"`
  at `:61`, echoed in the config summary line at `:129`), and M6.1 turns it into
  the backend selector `--agent opencode|claude`. A command line reading
  `--agent claude --max-agents 4` therefore uses "agent" in two senses at once.
- **F26 — model-failback and exit state are module-level globals.**
  `sticky`, `pending` and `override` at `src/failback.ts:33-35`; `resetFailback`
  exists only because that module-level state leaks across test files inside one
  process (`src/failback.ts:83-84`). `src/exit.ts:9` holds a module-level
  `pending` flag for `/exit`. With N concurrent sessions in one driver process,
  one session exhausting its quota redefines the model order for **all** of them,
  and `/exit` has no way to address a single agent.
- **F27 — PLAN.md task records carry no dependency field.** Parsed fields are
  `status`, `verify`, `verified`, `attempts`, `final`, `fork-base`
  (`src/plan.ts:84-88`); field lines must be contiguous directly under the
  heading (`src/plan.ts:68`); re-rendering is a fixed list
  (`src/plan.ts:248-249`). Adding a field is a known-shaped change (parse +
  render + the contiguity rule + the `## T-NNN:` heading protocol and its 0035
  lockstep), not an open-ended one.
- **F28 — the intent pack already supports keyed subsections.**
  `packSubsection(pack, section, key)` (`src/intent/load.ts:90`), used today for
  `## phase duties` keyed by phase letter (`src/intent/load.ts:19,113`). A
  `## parallelism` section with `### high` / `### medium` / `### low`
  subsections is the same mechanism and costs one new `IntentSection` member.

### Phase interaction (N3)

- **F13 — phase advancement is purely file-derived and the gate is a shape
  check.** `routePhase` = the first declared letter absent from the ledger
  (`src/phases.ts:179-201`); `appendLedger` (`:160-168`) has exactly two call
  sites — `handoverPhase` (`src/loop-phase.ts:280`) and the interruption-recovery
  path that finds the handover archived and PLAN.md reset but the ledger line
  unwritten (`src/loop-phase.ts:400-407`); the gate is that the handover
  document has its four mandatory sections (`validHandover` `src/phases.ts:232`)
  plus a successful commit. **No human is in the gate.**
- **F14 — human Q&A in PLAN.md was deliberately retired.** `block()` now only
  sets `status: blocked` and actively clears the legacy
  `question`/`answer`/`blocked-at` fields (`src/plan.ts:135-144`), with the
  rationale in the comment: reason and resolution are already complete in the
  run log and terminal, and every PLAN.md rewrite has to be ledgered and
  participates in the next unit's clean gate.
- **F15 — the channels exist; durability and gating do not.** `--interactive`
  runs a persistent readline whose lines are injected into the **live** session
  fire-and-forget via `promptAsync` (`src/interactive.ts:1-2,99-104`), with
  `/exit` (`:64-73`) and `/failback` (`:78-93`); `--wait-answer N` blocks on
  stdin before auto-answering (`src/watch.ts:399`,
  `src/session-api.ts:304-334`), otherwise the first non-permission question is
  auto-answered and logged to `.auto/resolves.json` (`src/resolve.ts:80`);
  `OPENCODE_AUTO_STEP` hard-pauses at phase/task/subtask boundaries
  (`src/step.ts:31`); `--wait-between` pauses between tasks
  (`src/loop-progress.ts:23`). The ledger itself is documented as
  human-editable (`src/phases.ts:57`) — deleting a line re-runs a phase.
- **F16 — bounded multi-round loops already exist and can be reused as shape
  precedent.** verify fix rounds (`FIX_ROUNDS`/`REVERIFY_ROUNDS` defined at
  `src/opts.ts:24,27`, consumed at `src/review.ts:138,159`); quality review
  rounds with `injectFix` appending
  fix checklist items to PLAN.md (`src/runner.ts:417-507`, cap → blocked at
  `:587`); final review's `audit → remediate → validate → finalize` state
  machine as real PLAN tasks carrying `final: <stage>@<round>`
  (`src/final.ts:11,19,116-193`), where a validate gap re-enters
  `audit@round+1` (`:182`) and the round cap fuses to blocked (`:175-181`).

### Process-document ↔ target-code coupling (added 2026-09-21)

- **F19 — `docs/` ships in the target repo.** `.gitignore` maintenance covers
  exactly two entries, `tmp/` and `.auto/` (`src/gitignore.ts:10`), so process
  documents, the round PLAN.md and its root symlink are all committed into the
  target tree and stay there permanently. Nothing marks them as disposable and
  nothing checks that the code does not depend on them.
- **F20 — the prompts instruct sessions to put process markers into source
  comments.** `templates/prompts/_partials.md:29,35`: a call touching
  architecture or code changes "is annotated in the design document **or in a
  code comment**" with an `AUTO-DECISION: <decision> (<reason>)` line;
  `templates/prompts/test-continue.md:2`: mark a leftover with `AUTO-FIXME:
  <reason and plan>` "**in a code comment** or in a document under docs/"; the
  agent contract says the same (`templates/.opencode/agent/auto.md:40-41`).
- **F21 — the durable record of a decision is *one* marker line, and the target
  tree is only one of its two permitted sites.** (Restated 2026-09-21 after
  verification; the original wording — "by stated intent, the marker line inside
  the target tree" — overstated the intent, see F29.) `collectAgentResolves`
  scans the session's changed files across nested repos for both markers
  (`src/resolve.ts:301-317`), and its comment is explicit: `AUTO-DECISION` is
  only counted, not persisted line-wise, because "its durable trace is precisely
  the marker line that goes into git" (`src/resolve.ts:293-296`) — but that
  comment describes the *scanner's* bookkeeping, not the prompts' instruction,
  and the scanner does not care which kind of changed file the line is in (F30).
  `AUTO-RESOLVE` by contrast is ledgered to `.auto/resolves.json`
  (`src/resolve.ts:80`) — which F19 shows is gitignored, i.e. disposable. The
  genuine asymmetry is therefore narrower than first stated: it is that
  `AUTO-DECISION` has no line-wise process-side ledger, not that its only record
  is in the target tree.
- **F22 — the k phase harvests markers back out of source comments.**
  `templates/prompts/knowledge.md:50-51` and `prior-knowledge.md:73-74` tell the
  distillation session to preferentially collect deviations and trade-offs
  "annotated in docs/ **and in code comments** as AUTO-DECISION". So the markers
  are load-bearing for the process: they cannot simply be banned without
  providing an alternative carrier — though note the `docs/` branch is already
  listed first, and F29 shows the report side is mandatory rather than optional,
  so the alternative carrier is not something option (c) has to invent.
- **F23 — the marker vocabulary is already content-bearing, not path-bearing.**
  `AUTO-DECISION: <decision> (<reason>)` and `AUTO-RESOLVE: <original question>
  -> <chosen option> (<reason>)` are self-contained prose; no template asks a
  session to cite a `docs/T-NNN/…` path inside a source comment, and the tool's
  own source uses the markers that way (`src/attempt.ts:294-313`,
  `src/conclusion.ts:43,87`, `src/log.ts:118`, `src/stats.ts:86,239,449`). The
  "restate, do not reference" half of §4.1 is therefore already the de facto
  form — it is unstated and unenforced rather than absent.
- **F29 — the process-document carrier is already mandatory; the code comment is
  a duplicate site the prompts themselves half-forbid.** (Verified 2026-09-21.)
  `templates/prompts/_partials.md:27-29` makes the primary obligation "write the
  reasoning and the alternatives you considered (and rejected) into the relevant
  document (a design document or report under docs/)", and only then offers "the
  design document **or in a code comment**" for the architecture-or-code-change
  subclass. `src/unit-commit.ts:43-44` does the same in the ask=off tier (record
  the reasoning and rejected alternatives in a document under `docs/`, *and*
  annotate the decision "in the design document or a code comment").
  `templates/prompts/wrapup.md:30-31` goes further and is unconditional: the
  report must carry a dedicated 「自动代答问题」 section listing **every**
  driver-proxied question as an `AUTO-RESOLVE:` line, original question copied
  verbatim. Meanwhile `_partials.md:38` already warns "annotate a given decision
  under one kind only, **never twice**" — yet today the same decision may
  legitimately appear twice, once in the report and once in a code comment. So
  P1 does not invert the tool's intent here; it deletes one disjunct of a
  duplication the prompts already discourage.
- **F30 — the scanner was built to accept markers in either location.**
  `src/resolve.ts:94-95` states it outright: the two prefix forms are equally
  legal — a code comment `// AUTO-RESOLVE: …` and a markdown list item
  `- AUTO-RESOLVE: …` — so the parser locates by the marker itself and
  constrains no line start. `collectAgentResolves` iterates `changedFiles` with
  no extension filter (`:306-311`); `readScannable` (`:367-373`) skips only
  directories, missing files, files over `MAX_SCAN_BYTES`, and NUL-bearing
  binaries. Process documents under `docs/` are changed files of the unit and are
  scanned exactly like source. `template.ts:137-138`'s comment already describes
  the target as "the session's **documents**".
- **F31 — under option (c) the tier-1 marker table does not move.**
  `PARTIAL_MARKERS["question-rule"] = ["question tool", "AUTO-RESOLVE",
  "AUTO-DECISION"]` (`src/template.ts:142`) exists because those tokens are what
  `resolve.ts` scans for (F30) — and under (c) they still are, just only in
  documents. So the table is **unchanged**, contradicting §9's original warning;
  only the affected goldens flip, which is the M2.1 batch's normal cost. The
  `decisionsOf` count also survives, since the report carrying the annotations is
  itself a changed file — though per `src/conclusion.ts:43-45` that count is
  folded into the proxy-answer highlight block's last line and never reaches the
  terminal when there are no proxy answers, so its observability value was always
  parasitic on `AUTO-RESOLVE`.

### Planning context

- **F17 — M4's declared scope is "mechanism preserved, minimal refactoring
  surface"** (root plan §M4 preamble), and M3's preamble states the human
  review gate for plan/handover belongs to the phase layer. A new level above
  rounds contradicts M4's scope; a phase acceptance gate belongs in M3.
- **F18 — open question 10** (in-package bootstrap run artifacts) is deferred,
  with the recorded default "document roles (M2.3) support configurable
  `destDir`, no special exemption" (`plans/0001-auto-next-design.md:114-116`,
  root). **Open question 14** is confirmed and implemented in M1.0
  (`auto-core/plans/0030`): shared context = task-dir `shared.md`, `todo.md`
  carries scope + artifact list. Neither is an open item for this design except
  as cited.

## 4. Thesis

Identity and isolation belong to **the run and the identifier**, not to the
directory tree.

1. N1 is an identifier problem. Identifiers have already reached immutable
   media (F2), so a collision must be **prevented at issuance**; relocating
   paths afterwards cannot repair trailers, git history, or id references
   already written into the target tree — the last of which P1 forbids but
   nothing prevents today (F20, D9).
2. N2 is a run-boundary problem. Every structural blocker (F8, F9) is a
   property of *one worktree holding one unit*, so parallelism is bought by
   adding worktrees, not by adding directory levels.
3. N3 is a gate problem. The channels and the loops already exist (F15, F16);
   what is missing is an acceptance gate on phase exit and a durable carrier
   for the human's input (F13, F14).
4. N4 is a **declaration** problem before it is a scheduling problem. The
   scheduler is the easy part; the driver cannot safely run two units at once
   until something machine-checkable says they are independent, and today that
   assurance is prose in a prompt (F10). So the work order is declare → isolate
   → schedule, not schedule → discover conflicts.

N1 and N2 are the same design seen from two sides: isolation makes the runs
independent, a namespace makes their merge safe — and N4 reuses both, since
merging the work of N concurrent agents back into one tree is the topic merge of
N1 in miniature (D15).

### 4.1 Governing principle P1 (proposed 2026-09-21)

> The process documents this tool maintains exist to guarantee that a
> long-range development goal is reached. They are **not** a design dependency
> of the target code. Target code must contain no reference to a process
> document; where a comment must carry such content, it restates the content in
> its own words rather than citing a path. The target code has to stand alone
> once the process documents are gone.

Formalized as an invariant plus a testable corollary:

- **P1-a (one-way dependency).** The dependency arrow runs from process
  documents to target code and never the reverse. This is the same shape as the
  refactor's own D8 rule (domain interfaces, one-way dependencies between
  domains), and it is what refcheck already assumes without having decided it:
  F1's scope is docs → anything, and the missing code → docs direction is a gap,
  not a choice. P1-a turns it into a choice.
- **P1-b (disposability).** Removing `docs/`, the root `PLAN.md` symlink,
  `AGENTS.md.bak` and the already-ignored `.auto/` + `tmp/` in a single commit
  must leave the target tree building, passing its own tests, and readable — no
  comment loses its meaning, no build step or runtime read breaks. Today this
  holds **by accident rather than by decision**: no build step or runtime read
  touches `docs/`, but nothing marks it as removable either (F19), and the marker
  record is deliberately load-bearing for the *process* (F21, F22) — so a
  well-meaning cleanup would silently destroy a round's decision trail.
  Correction after F29–F31: that trail is **not** confined to the target tree,
  since the report side is already mandatory; but this makes P1-b sharper rather
  than softer, because under option (c) (D11) the *whole* trail is process-side
  and disposability therefore removes all of it. That is exactly why D12's
  restatement obligation is load-bearing rather than decorative: it is the only
  thing that decides which rationales survive the removal P1-b permits.

P1 does not contradict the thesis; it strengthens it. If target code carries no
process references, then N1's "especially the comments in the target source"
half is **prevented by prohibition** rather than repaired by resolution — which
is strictly better, because a prohibition is cheap to check and has no ambiguity
about a project's own pre-existing `docs/`.

**Four current tensions** (all four are design decisions made earlier, recorded
here without judgement): F19 ships the process documents in the target repo;
F20 instructs sessions to annotate decisions in code comments; F21 shows the
target tree is one of two permitted annotation sites while `AUTO-DECISION` has no
line-wise process-side ledger — and F29 shows the second site is not merely
permitted but mandatory, so the code comment is a duplicate the prompts
themselves discourage ("never twice"); F22 makes the k phase read those markers
back out of the source, though its `docs/` branch already covers the alternative.

**What already complies:** F23 — the marker vocabulary is self-contained prose,
so "restate rather than reference" is already the de facto form. No template
asks a session to cite a `docs/T-NNN/…` path from inside a source comment. And
F29–F30 — the process-document carrier is already mandatory and the scanner is
already location-agnostic by design, so moving the markers out of source deletes
one disjunct from three prompt strings rather than retrofitting a mechanism. The
principle needs stating and enforcing far more than it needs building.

**The cost P1 moves rather than removes:** if a decision's rationale is to
outlive the process documents, it must be restated into the target project's
*own* documentation (its `Documentation/`, module READMEs, or a substantive
comment), because the tool-owned task report under `docs/T-NNN/` goes away with
the rest. That is real work, it lands on the k phase and on the governance
intent, and it is the part most likely to be skipped — so it needs a check, not
just an instruction.

## 5. Decisions (proposed — not confirmed)

| # | Decision | Content |
|---|---|---|
| D1 | Identity ≠ location | A task's identity is its id; its path is a consequence. Do not introduce a directory level whose only job is to disambiguate ids — fix the ids. This preserves stable-refs R2 (a path, once created, is permanent) and keeps `resolveTaskDoc`/`resolveSubtaskDoc`'s fallback ladder from growing another generation. |
| D2 | Prevent collisions at issuance; never renumber after a merge | Post-merge renumbering cannot reach `Auto-Task:` trailers or git history (F2, F5), so the residue stays ambiguous permanently. `rewriteRefs` is retained as a last-resort primitive for docs only, not as the mechanism. |
| D3 | Two candidate namespace shapes; recommend the id infix | **A (recommended)**: topic as an id component, `T-<TOPIC>-NNN` (e.g. `T-DM-007`), degenerating to `T-NNN` with no topic. Self-describing wherever a reader has no config file to hand — commit messages and `Auto-Task:` trailers, PLAN.md, task reports, and human conversation about a task. (Not source comments: under P1 those must carry no id at all, D9.) Cost: the numeric-extraction regexes (`src/numbering.ts:23,59,78`) must accept an optional topic component. **B (cheaper)**: keep the `T-NNN` shape and give each topic a numeric block via a config floor (`taskNumberFloor` already computes `max + 1`; add a configured base). Zero regex, protocol, refcheck and golden change; cost: ids do not say which topic they came from, and the block allocation must be recorded in the target directory's `config.json`. Under N4 the same requirement applies *within* one run — N concurrent agents issuing ids must not collide (D15) — so the namespace is a prerequisite for parallel sessions, not only for topic merges. |
| D4 | Isolation boundary = the run (one worktree per topic) | Each worktree brings its own `.auto/`, PLAN.md, ledger, clean gate and commit range, so all of F8/F9 are satisfied by construction with **zero core changes**. The enabling action is the already-recorded default of F18: make `destDir` configurable at M2.3. Merging becomes a one-time git prefix/subtree operation performed by a human, safe because of D3. |
| D5 | Intra-run concurrency is an orchestration milestone, never a path change | Making two sessions run in one worktree requires: per-unit `progress.json` records, per-unit `CURRENT`, per-unit handover/test slots (F9's `tmp/test.sh` included), a machine-checked dependency model replacing F10's prose, a scheduler, and replacing the clean-tree gate with path-scoped staging plus per-unit commit ranges. That is a milestone of its own and must not be smuggled in as a directory reorganization. N4 accepts that cost; §6.4 turns this list into a staged plan in which the first two stages ship value on their own. |
| D6 | Path-scoped staging is the one cheap same-tree step, worth doing on its own | Replace `git add -A` (`src/git.ts:71`) with staging the paths the unit declared, using `declaredArtifacts` (F12) plus a disjointness check between concurrently eligible subtasks. Independently valuable without any parallelism: it stops a unit from sweeping unrelated dirt into its commit. It does **not** by itself enable concurrency (D5's list still stands). |
| D7 | The phase gate is acceptance, not shape — and it must not move back into PLAN.md | `validHandover` proves the AI wrote four sections (F13); it says nothing about whether a human accepts the phase. Adding the acceptance record to PLAN.md is excluded by F14's rationale (every PLAN.md rewrite is ledgered and feeds the next unit's clean gate) — that decision was made deliberately in Sept 2026 and this design does not reopen it. |
| D8 | The human's input gets a typed document role; the ledger stays the state machine | A per-phase acceptance document becomes a new `DocumentRole` (M2.3's `src/document/roles.ts`), so it inherits role-derived `eofScanExempt`, protect policy and shape checking rather than adding a bespoke exemption list. `appendLedger` refuses to record the phase until that document carries an acceptance marker. Rounds reuse the `stage@round` precedent (F16); pause points reuse `stepPause` / `waitBetweenTasks` (F15). No new hidden state: `routePhase` remains a pure function of (ledger, PLAN.md). |
| D9 | The source-side face is a **prohibition** check, not a resolution check (revised 2026-09-21, supersedes the original D9) | The original D9 proposed resolving `docs/…` references found in changed source files. Under P1 that is the wrong mechanism: such a reference should not exist at all, so there is nothing to resolve. The check becomes a scan of the unit's changed non-process files (the set is already available — `changedFiles`, used at `src/resolve.ts:306`) for **tool-owned path shapes** (`docs/T-`, `docs/R-`, `docs/phases/`, root `PLAN.md`, `.auto/`) → violation. Bare `T-NNN` id mentions are a **warning** only: too many plausible false positives (register names, hardware designators, unrelated project conventions). Keying on tool-owned shapes rather than the bare word `docs/` is what makes this safe in a tree that has its own documentation directory. Scope is the unit's changes, never the existing tree — the same non-retroactive scoping the shape checks already use. |
| D10 | Adopt P1; its durable homes are the standardization-boundary clause and the governance intent | P1 is a documentation-regime principle, so it belongs in M2.3's "standardization boundary" section (which already delimits what the protocol-marker minimal set constrains) rather than only in this stage-assisting document. Its prompt-side enforcement belongs in the intent pack's `## governance` section — M2.2's target, currently empty (`templates/intents/default.md`), which is a natural fit: governance is exactly "rules about how the work is recorded", and an intent-pack section makes it replaceable per project instead of hardcoded. |
| D11 | Marker lifecycle: recommend **(c) never in source**, as governance intent rather than core code (revised 2026-09-21; previously "recommend (b) or (c)") | F20–F22 mean `AUTO-DECISION`/`AUTO-FIXME`/`AUTO-RESOLVE` lines inside target source are process protocol embedded in the deliverable, and the k phase currently reads them back. **(a)** keep them permanently (status quo; defensible under F23 since they are self-contained prose, but `AUTO-FIXME` shipping in delivered code is process state, not code documentation — a delivered one means the leftover was never closed, which is a defect rather than a comment). **(b)** treat them as a *transport* form — harvested by the k phase, then stripped at round close, leaving an ordinary prose comment; this matches an existing idiom (a marker is consumed then transformed: `todo.md` → `done.md`, `testhandoff.md` → `testhandoff-<n>.md`). **(c)** never let them enter source: the decision's **content** is restated as ordinary prose in the code comment (P1's restatement clause) while the *marker line* lives only in process documents. **Recommend (c)**, because verification changed the cost picture (F29–F31): the process-document carrier is already mandatory (`wrapup.md:30-31` requires the report's 「自动代答问题」 section verbatim; `_partials.md:27-29` and `unit-commit.ts:43-44` make the document the primary record), the scanner is location-agnostic by design (`resolve.ts:94-95` treats a code comment and a markdown list item as equally legal, and `collectAgentResolves` filters by size and NUL, never by extension), and `PARTIAL_MARKERS["question-rule"]` **does not move** because both tokens remain the driver's scan targets. So (c) does not require fixing an asymmetry — the alternative carrier F22 demands already exists. **Concrete edit surface: delete one disjunct in four strings** — `_partials.md:29`, `unit-commit.ts:44` (both "or in a code comment"), `test-continue.md:2`'s "in a code comment or" for `AUTO-FIXME` (the unconditional case), and the agent contract `templates/.opencode/agent/auto.md:40-41` (F20). `agents-block.ts:34` is **not** an edit site — MAINT_RULE item 4 already routes one-off decisions to "the relevant document", so the AGENTS.md injection block complies with (c) today. **The one real loss** is a greppable in-code decision trail, and P1's own restatement clause covers it: the reasoning stays in the code as prose, only the token goes. **Reject (b)**: it builds a round-close stripper to undo what the prompts instructed, needs its own commit stage (F8's unit range admits only that unit's `Auto-Stage:` commits), risks mangling comments and string literals, and its single advantage — keeping the cheap signal during the run — is worth nothing, because the signal never required the marker to be in source. **Framing**: express the discipline as the intent pack's `## governance` section (M2.2's target, currently empty) rather than as core code, so (c) is the strict built-in default and a project that genuinely wants an in-code audit trail overrides one section to obtain (a) — which turns "pick a letter" into "pick a default", per D1/D8. |
| D12 | A disposability gate at round close, carrying the restatement obligation | P1-b becomes real only if something tests it. At round close — M4's human gate, which already exists — run once over the whole tree: the D9 prohibition scan (whole-tree, not changed-files, since this is the one moment it is worth the cost) plus the project's own build. Failure means the round is not closed. The gate is also where the restatement obligation of §4.1 is checked: a decision whose rationale must outlive the process documents has to have landed in the target project's own documentation, and the k phase is the natural producer of that landing. |
| D13 | `--parallel` is **intent**; `--max-agents` is **mechanism** — **[confirmed 2026-09-21]** | The two flags answer different questions and must not be conflated. `--parallel <level>` tells the *planning and decomposition sessions* how to arrange work — how hard to try to make items independent, and how much merge overhead to accept — so it is intent-pack content: a `## parallelism` section with `### high` / `### medium` / `### low` subsections addressed by `packSubsection` (F28), injected into the phase-plan and decompose prompts the way `ModeSpec.init`/`exec` are injected today. `--max-agents <N>` bounds the scheduler and affects no prompt. The split makes `--parallel high --max-agents 1` coherent and useful: plan for parallelism, execute serially — which is exactly how the feature should be rolled out and how it can be tested by golden and dryrun without ever launching two sessions. **The user confirmed this reading of the levels on 2026-09-21** (question 11); it is the only decision in this table confirmed so far. |
| D14 | Dependencies are **declared**, never inferred — and two declarations are needed | Inference from file paths after the fact is too late (the sessions are already running) and inference by an AI at plan time is unverifiable. So the plan carries an explicit dependency field on each task record (F27 shows the change is known-shaped: parse, render, contiguity rule) and each subtask declares what it **touches**, not only what it **produces** — `产出:` lists artifacts, and a subtask that modifies `src/foo.c` does not thereby produce it, so `declaredArtifacts` alone cannot support a disjointness check. Both literals are driver-parsed protocol strings and go through 0035. Semantics must stay shallow: a dependency edge means "start after", not a data-flow contract, because the driver has no way to verify anything deeper. |
| D15 | Isolation model: per-agent git worktrees; the N1 namespace is a hard prerequisite | Two candidates. **(i) one worktree per agent** — each gets its own clean gate, SHA baseline and commit range *unchanged* (F8 is satisfied by construction rather than redesigned), and a failure becomes a merge conflict instead of a corrupted tree. **(ii) one tree with path-scoped staging** (D6) — no merge step, but the clean gate must go, commit ranges interleave, and any error in the disjointness check corrupts the tree. Recommend (i), with D6 built anyway because the disjointness *declaration* of D14 is needed under both models: under (i) it is what tells the scheduler two tasks are worth running at once instead of deferring the conflict to merge time. Note the consequence: merging N agents' task documents back is the topic-merge problem of N1 in miniature, so **D3's id namespace is a prerequisite for tier 3, not an independent item** — and id allocation must stay **central to the parent run**: each agent worktree must not independently derive `max + 1` via `taskNumberFloor`, because N worktrees created from the same base would all issue the same ids (F3). The parent allocates an id before it launches an agent, which also means `.auto/next-task` stays a singleton of the parent rather than becoming one per worktree. |
| D16 | Per-unit state is the actual work list, and it includes module-level globals | Before any concurrency: `.auto/progress.json` from one record to a keyed set (F9), `CURRENT.md` from one mirror to a per-unit or tabular form, `.auto/handover.json` and `tmp/test.sh` per unit, `.auto/verify.md`/`review.md` per unit, and — not visible in the file layout — the module-level globals of F26 (`failback.ts`'s `sticky`/`pending`/`override`, `exit.ts`'s `pending`) must become per-agent or be explicitly ruled global-with-documented-semantics. This list is worth doing **even if tier 3 never ships**: every item on it is also a recovery-fidelity improvement, since a single-record `progress.json` is the reason a resumed run can only ever re-enter one unit. |
| D17 | `--parallel none` must be byte-identical to today's behaviour | `none` is the default and keeps `next()`'s file-order selection, no dependency field rendered, no scheduler, no worktrees. This is what makes the feature reviewable: the golden files, the incident-regression tests and every existing gate stay untouched at `none`, and the new behaviour is reachable only by an explicit `init` choice frozen into `config.json` (F24). It also preserves the freeze-period invariant that an existing project's behaviour does not change under it. |
| D18 | Two shared resources need explicit design, not incidental sharing | **Tests**: `--test-by-driver` currently uses the single slot `tmp/test.sh` (F9) and tests routinely cannot run concurrently in one tree (build directories, fixed ports, `rustfmt`-style in-place rewrites — the very failure that produced the handover redesign). A per-unit slot plus a serialized test queue is the minimum; whether tests may run in parallel at all should be a declared property of the script, not a guess. **Observability and addressing**: the log stream, the `◈` model line, the stats heartbeat and `--interactive`'s steer all assume one session (F15, F26); with N agents every line needs an agent prefix and both steer and `/exit` need an addressing scheme, otherwise a human cannot tell which agent they are talking to or stop just one. |

## 6. Design

### 6.1 N1 — id namespace + the P1 prohibition

Adopt D2 + D3. Under D4 each topic is its own worktree and its own run, so
`.auto/next-task` is already per-topic and no cross-run coordinator is needed;
the namespace only has to guarantee that two independently issued ids cannot be
equal, which a prefix (A) or disjoint blocks (B) both achieve.

**P1 changes the D3 cost calculus, in favour of A.** The objection to an id-shape
change was that ids have leaked into a kernel-sized target tree and cannot be
chased down. Under P1 they must not be there at all (D9), so a shape change
touches only tool-owned media: PLAN.md headings, the phase ledger, `Auto-Task:`
trailers, prompt templates, `.auto/` state and `docs/` paths — all of which the
driver already parses and all of which are reachable by the 0035 lockstep
procedure. D3-B's "zero protocol change" advantage survives, but D3-A's
"self-describing id" advantage no longer has to pay for a tree-wide comment
sweep. Note the trailers remain the one irreversible surface (F2), which is
precisely why D2 says prevent rather than repair.

Consequences to settle before implementing (see §11): whether `T-F<k>` becomes
`T-<TOPIC>-F<k>`; who assigns topic codes; and whether the topic is also
recorded as round metadata so reports can group by it without a path change.

The doc-side grouping the original proposal wanted is obtained by **an index,
not containment** — the codebase's own idiom (`shared.md` is a reference index,
not a copy; `phase-docs/<letter>-<slug>/` groups free artifacts without moving
task docs). A `docs/<topic>.md` or `docs/R-NN/` metadata line may reference
permanent `docs/T-NNN/…` paths; `T-NNN` never sinks a level and never gains a
directory prefix, so `resolveTaskDoc`, `eofScanExempt`, `activeDocs` and the
whole read-fallback ladder are untouched. Index → permanent path is the P1-a
direction and stays legal.

**Placement of the D9 prohibition check.** It does *not* belong in refcheck:
refcheck is a docs-hygiene layer, default off behind `OPENCODE_AUTO_REF_CHECK`
(F1), and its semantics are "this reference no longer resolves". The prohibition
means "this unit's output is not acceptable", which is the semantics of the
unit-close-out shape checks (`src/doccheck.ts`, consumed at unit close-out). So
it belongs to the document domain next to `checkArtifactSpecs`
(`src/document/spec.ts`), sharing their gating — inactive under dryrun and in
non-git environments, active otherwise, with the same re-prompt-then-block
escalation the shape checks use. Being a prohibition rather than a resolution it
needs no tree index, no symlink descent and no ambiguity handling, so the cost
objection that scoped the original D9 to changed files mostly disappears; the
changed-file scope is retained anyway because retroactively failing an existing
tree is not the driver's business.

### 6.2 N2 — parallelism in tiers

| Tier | What | Cost | Enables |
|---|---|---|---|
| 0 | Today: strictly sequential (F7) | — | — |
| 1 | Path-scoped staging from declared artifacts (D6) | Small; `src/git.ts` + `src/document/spec.ts` + tests | Safer commits; a **prerequisite** for tier 3, not sufficient for it |
| 2 | One worktree per topic, parallel independent runs, human-performed git merge (D4) | Near zero in core: configurable `destDir` (F18) + D3 namespace + a written merge procedure | Real wall-clock reduction across topics — the actual ask in N2 |
| 3 | Intra-run concurrency across tasks/subtasks (N4) | Large: D14–D18, designed in §6.4 | Parallelism *within* one topic |

Tier 2 and tier 3 are **complementary, not alternatives**: tier 2 parallelizes
across topics (each its own run), tier 3 parallelizes within one run. N4 asks
for tier 3 explicitly, so the question in §11 is no longer whether it is wanted
but in what order it is built — §6.4 gives a staged answer in which every stage
is independently useful.

Two honest caveats that no directory design changes. First, the real ceiling is
usually model quota and rate limits, not the driver: `--max-agents 8` against a
quota that supports two concurrent sessions buys nothing and burns retries, and
F26 shows the failback ladder is currently global state, so one agent's quota
exhaustion would today rewrite the model order for all of them. Second, parallel
work only pays when the decomposition is genuinely disjoint — which today is
prose (F10). A machine-checkable disjointness declaration (D14) is therefore
tier 3's true prerequisite; `declaredArtifacts` covers produced artifacts, and
the touched-source side is new.

### 6.3 N3 — phase acceptance gate

Split the requirement in two, because conflating them is what makes it feel
vague:

- **Mid-phase steering** — already exists (`--interactive` lines into the live
  session, `--wait-answer`, `--step`). The gap is only durability: a steered
  line is fire-and-forget (F15) and survives only in the run log. Optional
  improvement: append human-originated steered lines to the acceptance document
  so the phase's human input is diffable.
- **Phase-exit acceptance** — missing entirely (F13). Design per D8:
  1. New document role `phase-acceptance`, one file per phase per round, e.g.
     `docs/R-NN/phase-docs/<letter>-<slug>/acceptance-r<n>.md` (round number
     following F16's `stage@round` idiom).
  2. `handoverPhase` writes the handover doc as today, then **stops at the
     existing boundary** (`stepPause` / `waitBetweenTasks`) instead of calling
     `appendLedger`.
  3. `appendLedger` gains a precondition: the acceptance document exists, passes
     the role's shape check, and carries an acceptance marker written by the
     human. The precondition must live **inside `appendLedger`**, not in
     `handoverPhase`, because `appendLedger` has a second call site on the
     interruption-recovery path (F13) — gating only the normal path would make
     "interrupt between handover and ledger" a way around the human gate. Absent
     the marker, `routePhase` keeps returning the same phase, so the phase
     simply runs again — the same re-entry shape as `injectFix` (F16), with the
     human's notes available to the next session as an input document. The
     recovery path needs the same treatment: it must re-check rather than
     append unconditionally.
  4. Iteration bound and fuse follow the existing conventions (cap → `blocked`,
     as in `src/review.ts` and `src/final.ts:175-181`).

The acceptance marker is a **driver protocol string**: it must be registered in
`plans/0035` §3 and flipped only at a lockstep step, and the prompt that tells
the human or the AI about it must name the literal verbatim (0035 D2).

### 6.4 N4 — parallelism as a capability

**Flag surface.** `--parallel [high|medium|low|none]` joins the constitutional
attribute list frozen by `init` into `.opencode/auto/config.json` (F24), so
passing it to `run` is a usage error like every other attribute, and it is
human-editable in the config file afterwards. Default `none` (D17).
`--max-agents <N>` is a run-time flag beside `--review`/`--early`, default `1`,
and is meaningful only when the frozen `--parallel` is not `none`. Naming: F25's
collision with `--agent` is real — `--jobs <N>` or `--max-sessions <N>` would be
unambiguous; if `--max-agents` is kept, the help text must say plainly that it
counts concurrent sessions and has nothing to do with `--agent`.

**Level semantics.** The levels are *planning guidance*, not agent counts
(D13). Each is a `### <level>` subsection of a new `## parallelism` intent-pack
section (F28), so a project can rewrite what "high" means without touching core:

| Level | What the planning and decomposition sessions are told to do |
|---|---|
| `none` | Nothing changes. No dependency field, no disjointness declaration, file-order execution. |
| `low` | Declare dependencies and touched paths honestly, but do not restructure the plan to create parallelism. The scheduler runs whatever happens to be independent. |
| `medium` | Actively prefer arrangements whose items are independent: split work along file and module boundaries rather than along layers, keep shared-file edits in one item, and accept somewhat more items in exchange for width. |
| `high` | Optimize for maximum width: split aggressively, push shared-file changes into short serial items that gate the rest, and accept the extra merge and coordination overhead. Appropriate when the wall clock matters more than the token spend. |

**Scheduler.** `next(plan)` — first non-done task in file order
(`src/plan.ts:96-98`) — becomes a readiness function: *ready* = status not done,
every declared dependency done, declared touched-paths disjoint from all
in-flight units, and an agent slot free (fewer than `--max-agents` units in
flight). The
subtask loop's "first unticked item" (`src/runner.ts:484`) gets the same
treatment within a task. At `none` the readiness function must reduce to
today's file order exactly (D17).

**Rollout order.** Four stages, each independently useful and independently
revertable:

1. **Declaration only** (D14): the dependency field and the touched-paths
   declaration are parsed, rendered and *validated* (a cycle or an unknown id is
   a plan error), but the scheduler still runs one unit at a time. Value on its
   own: the plan becomes machine-checkable for the first time, and a
   decomposition that claims every item touches the same file is caught at plan
   time instead of at merge time. Testable entirely by golden and dryrun
   (`--parallel high --max-agents 1`, per D13).
2. **Per-unit state** (D16): `progress.json` keyed by unit, `CURRENT.md`,
   `handover.json`, the test slot, and the module-level globals of F26. Value on
   its own: recovery fidelity — a resumed run can re-enter more than one unit.
3. **Worktree isolation + scheduler** (D15-i): launch ready units in separate
   worktrees, merge back on unit completion, serialize merges. This is the first
   stage that actually runs two sessions, and it needs D3's namespace already in
   place.
4. **Shared-resource polish** (D18): test queue, per-agent log prefixes, steer
   and `/exit` addressing.

Stages 1 and 2 are worth doing even if 3 is never scheduled; stage 3 without
them is not worth doing at all.

**What remains hard.** Quota is the ceiling and is outside the driver's control
(§6.2). Merging N agents' work is a real git merge with real conflicts, and the
driver has no way to resolve a semantic conflict — the honest failure mode is
"merge conflict → that unit goes back to a session with the conflict as
feedback", which is a new re-prompt path. Human attention does not scale with
`--max-agents`: one person supervising four sessions is the actual bottleneck in
an interactive run, which argues for keeping `--parallel` low when `-i` is in
use. And P1 constrains the design usefully here — since target code carries no
process references (D9), a merged tree from N agents has no cross-agent
reference tangle to unwind, only ids to keep unique.

## 7. Why not the five-level directory scheme

The proposal's advantages are real: a merge is a one-shot `git mv docs
docs/dm`; the hierarchy is self-describing to a human; making every level
optional shows compatibility awareness. Four shortcomings decide it:

1. **The level order inverts the permanence rule.** `topic/R-NN/<phase>/T-NNN/
   S<nn>` puts tasks under rounds and phases, but task paths are permanent
   (stable-refs R2) while rounds are archived and phases are re-runnable; a task
   spanning R-01 and R-02 acquires two homes, which breaks `resolveTaskDoc`,
   refcheck's git-history recovery and `eofScanExempt`. The phase level in
   particular is structure without semantics — phases own free artifacts today
   precisely because they must not own tasks (F6).
2. **"References must be full paths or they get misidentified" is the symptom,
   not a requirement.** Short forms are safe today because `T-NNN` is globally
   unique; when it was not, the fix was the fully qualified `T-NNN.SNN` in the
   ground-state block (after the T-068 S01 incident), not a longer path. A topic
   level pushes that id to `<topic>.T-NNN.SNN` across the prompt partial, the
   incident-regression tests, `.auto/progress.json` and `Auto-Task:` trailers —
   i.e. it converts a path change into a **protocol-string change** requiring
   the 0035 lockstep and dual-read, for no gain that D3 does not give directly.
3. **It namespaces `docs/` but not the state singletons.** PLAN.md, the ledger,
   `.auto/next-task`, `.auto/progress.json` remain global (F9), so merging two
   topics turns a path collision into permanently ambiguous duplicate ids while
   `taskNumberFloor` keeps issuing from the global max (F3). The proposal
   therefore does not actually solve N1.
4. **Optional levels multiply the fallback ladder.** Three layout generations
   already coexist behind `resolveTaskDoc`/`resolveSubtaskDoc`, and
   `plans/0013` D2 explicitly rejects move-adaptation (legacy layouts are
   read-fallback only, never migrated). Adding a fourth generation with optional
   intermediate levels is exactly the cost that decision was made to avoid.

## 8. Landing points

| Item | Milestone | Note |
|---|---|---|
| D9 prohibition check | M2.3 | Document domain, next to `checkArtifactSpecs`; gated with the unit close-out shape checks, **not** behind `OPENCODE_AUTO_REF_CHECK` (§6.1) |
| D10 P1 principle text | M2.3 (standardization-boundary clause) + M2.2 (`## governance` intent section) | The clause and the intent section are both already scheduled and currently empty of this content |
| D11 marker lifecycle | M2.1 (the `question-rule` / AUTO-DECISION wording lives in the understanding/wrapup/knowledge family) + M2.2 (the `## governance` section carries the discipline) | Under the recommended (c) the edit is **delete one disjunct in four places**: `_partials.md:29`, `unit-commit.ts:43-44` (missed by the original list), `test-continue.md:2` (`AUTO-FIXME`), and `templates/.opencode/agent/auto.md:40-41`. `knowledge.md:50-51` / `prior-knowledge.md:73-74` need no change beyond dropping "and in code comments" — their `docs/` branch is already listed first (F22). `agents-block.ts:34` (MAINT_RULE item 4) needs **no change at all**: it already routes one-off decisions to "an `AUTO-DECISION` entry **in the relevant document**", so the AGENTS.md injection block complies with (c) today — further evidence that the document side is the intended default and the code comment is the outlier. `src/resolve.ts:293-296`'s durable-trace comment needs **restating**, not the mechanism changing (F21, F30). Marker table unchanged (F31). |
| D12 disposability gate | M4.1–M4.2 | M4.1 inventories the human-intervention surface, M4.2 converges the release criteria — the gate is a release criterion |
| D3 id namespace (A or B) | M2.3, with F18's `destDir` | Any id-shape change goes through §9 |
| D6 path-scoped staging | M2 (its declared range already includes the commit boundary) | Independent value; can ship before any parallelism |
| D8 acceptance document **role** | M2.3 | It is a `DocumentRole`; role-derived exemptions, protect policy and shape checks come free |
| D8 acceptance **gate** | M3 | M3's preamble already places the plan/handover human review gate at this layer |
| Acceptance criteria **content** | M4.2 | "Round goals / acceptance criteria / release criteria" externalized into intent-pack sections is literally M4.2's scope |
| Human-surface inventory | M4.1 | M4.1 already asks for the full list of human intervention points |
| Tier 2 parallel runs (across topics) | **new milestone** (none exists) | Orchestration-level; do not attach it to M2/M3 |
| N4 stage 1 — declaration only (D14) | **new milestone**, first stage | Protocol strings via §9; fully golden/dryrun testable at `--max-agents 1` |
| N4 stage 2 — per-unit state (D16) | **new milestone**, second stage | Also a recovery-fidelity improvement; independently justified |
| N4 stage 3 — worktree isolation + scheduler (D15) | **new milestone**, third stage | Requires D3's namespace already shipped |
| N4 stage 4 — test queue, log prefixes, steer addressing (D18) | **new milestone**, last stage | Interacts with `--interactive` and `-i` usability |
| `--parallel` as a constitutional attribute | With N4 stage 1 | Joins the `init`-frozen list (F24); `--max-agents` joins the run-time flags |
| `## parallelism` intent-pack section | With N4 stage 1 | One new `IntentSection` member + `### <level>` subsections (F28) |

## 9. Protocol-string implications

Everything in this document that changes a literal the driver parses is subject
to `plans/0035`: registration in its §3, flip only at a lockstep step (M2.4
task face / M3.4 ledger face), dual-read for state that outlives a run, tier-1
marker tables moved in the same commit, and prompts naming each literal
verbatim (0035 D2). Concretely: the acceptance marker (new, D8), the id shape
if D3-A is chosen (touches PLAN.md heading parse, trailers, prompt ground-state,
`incident-regression` tests), any new ledger column, and — from N4 — the PLAN.md
dependency field and the subtask touched-paths declaration token (D14). The last
three are **new** literals: they should be introduced in English from the start,
so they need registration in 0035 §3 and the tier-1 marker treatment but **no**
dual-read of a legacy Chinese form, since no in-flight project carries them.
That is a materially cheaper class of protocol-string work than the M2.4/M3.4
flips, and it is a reason to prefer introducing new protocol surface over
repurposing existing Chinese literals. Choosing D3-B still avoids the id-shape
item entirely, which remains its main argument — though §6.1 notes P1 has
lowered D3-A's cost considerably.

One interaction worth flagging early: D11's marker-lifecycle work necessarily
edits `question-rule`, a **tier-1** partial in `PARTIAL_MARKERS` whose markers
M1.5 just reworded, so the affected golden files flip a second time and D11
should not be scheduled as a casual wording tweak inside M2.1. **Correction
(2026-09-21, F31):** this paragraph originally also warned that per 0035 D6 the
marker table must move in the same commit. It must not — under the recommended
option (c) both `AUTO-RESOLVE` and `AUTO-DECISION` remain what `src/resolve.ts`
scans for, so `PARTIAL_MARKERS["question-rule"]` keeps all three anchors and a
project overriding that partial is still required to preserve them. Only the
prose changes, which is the M2.1 batch's normal golden cost. The table would
shrink only if the marker *vocabulary* were retired outright, which no option
here proposes.

## 10. How we would know it worked

- N1: two topics issued ids independently, merged into one tree, and the merged
  tree passes both directions — `check` reports zero unresolved references from
  process documents into code, and the D9 prohibition scan finds zero
  tool-owned references (`docs/T-`, `docs/R-`, `.auto/`, root `PLAN.md`) in any
  target source file — with no renumbering pass and no history rewrite.
- P1: the disposability test of P1-b passes on a real project — one commit
  removing `docs/`, the root `PLAN.md` symlink and `AGENTS.md.bak` leaves the
  tree building and its own tests passing, and a spot-check of the removed
  round's decisions finds each one either restated in the target's own
  documentation or deliberately accepted as lost.
- N2 (tier 2): two worktrees ran the same round concurrently against disjoint
  topics, each with a clean unit-commit range, and the merged tree passed the
  same `check`.
- N3: a phase was held at its boundary, the human wrote notes into the
  acceptance document, the phase re-ran with those notes visible to the session,
  and the ledger line appeared only after the marker was present — verifiable in
  a golden/dryrun test without a live model, matching how the existing gates are
  tested.
- N4: two halves. **Regression half** — `--parallel none` produces
  byte-identical prompts, plan rendering and goldens to today's behaviour
  (D17), so every existing test passes untouched. **Capability half** — a real
  round on a sample project with `--parallel medium --max-agents 3` completes in
  measurably less wall-clock time than the same round at `--max-agents 1`, with
  an equivalent final tree; a plan containing a dependency cycle or an unknown
  dependency id is rejected at plan time; and an induced merge conflict between
  two agents is routed back to a session as feedback instead of leaving a
  corrupted unit or a silently dropped change.

## 11. Open questions (for the user)

1. D3-A (topic infix, self-describing, regex changes) or D3-B (config block
   floor, zero protocol change)? This is the single highest-leverage choice in
   the document.
2. Under D3-A, does `T-F<k>` become `T-<TOPIC>-F<k>`, or does the final-review
   namespace stay topic-free and inherit the run's topic from its worktree?
3. Who assigns topic codes, and where are they recorded — `config.json`
   (init-frozen, per F18's neighbour clause) or a registry?
4. Is the tier-2 merge procedure human-only, or should the driver grow a
   merge-assist command that re-runs D9's check afterwards?
5. N4 settles that tier 3 is wanted, which leaves two ordering questions. **(a)**
   Task-level or subtask-level parallelism first? Task-level is coarser and
   safer (a task is already a commit-bounded unit with its own `docs/T-NNN/`);
   subtask-level gets more width but needs within-task disjointness and makes
   the `todo.md`/`done.md` pair concurrent. **(b)** How should the touched-paths
   declaration treat a source file a subtask *modifies* but does not produce —
   a new token alongside `产出:`, an extension of `产出:`'s grammar, or a
   per-item field in PLAN.md? `declaredArtifacts` alone cannot support the
   disjointness check (D14).
6. For N3, is the acceptance author always a human, or may an AI session
   pre-fill the document and the human only sign the marker? (The latter fits
   `final: stage@round`'s existing shape.)
7. **D11 marker lifecycle: (a) keep, (b) transport-then-strip, or (c) never in
   source?** — **recommendation recorded 2026-09-21: (c), expressed as
   governance intent** (see D11 for the full argument; F29–F31 for the evidence
   that changed the cost picture). Still open for adjudication. This is the most
   time-sensitive question in the document, because `question-rule` is a tier-1
   partial in the M2.1 batch (§9): choosing (b) or (c) changes wording that M1.5
   just reworded, so the affected goldens flip a second time — **but the marker
   table does not move**, contrary to what this question originally claimed
   (F31: both tokens remain the driver's scan targets, only their location
   changes). Choosing (a) is a real option — F23 shows the markers are
   self-contained prose, and F29 shows a project may legitimately want a greppable
   in-code audit trail — but then P1 needs an explicit carve-out saying that
   process *markers* in target code are acceptable while process *references* are
   not. Under the recommended framing that carve-out is not needed, because (a)
   becomes a per-project `## governance` override rather than the built-in
   default.
   **[ruled 2026-09-21 by the user: (a), refined — (c) and (b) rejected.]**
   The markers (`AUTO-DECISION` / `AUTO-FIXME` / `AUTO-RESOLVE`, and the
   `AUTO-TODO` idiom the phase-plan template mentions) are an important
   *result* of the process and a key quality-assurance device; their place in
   target code is justified because later development iterations are meant to
   work them off, and they must stand **self-consistently** in the source. So
   this is exactly the carve-out named above: process *markers* in target code
   are legitimate, process *references* are not — a marker line states its
   question/decision/reason in full and never points into `docs/T-…` or other
   process documents (D12's restatement duty applies to the marker itself, and
   D9's forbidden-shape check still covers it). Lifecycle = debt retired by
   ordinary later iterations, not by a tool (so (b)'s stripper stays rejected).
   Consequences: the four "or in a code comment" disjuncts stay; M2.1 moved the
   decision catalog into `## governance` unchanged (package plans/0043); the
   self-containment wording for markers is prompt-side P1 work and lands with
   M2.2's `## governance` text.
8. **F19: should process documents be detached at project close?** They are
   committed into the target repo today, and nothing marks them removable. Three
   shapes: leave them committed permanently (status quo); archive them to a
   branch/tag and remove them from the working tree at close; or move them out
   of the target repo entirely (a sibling directory, which needs F18's
   configurable `destDir` and changes what `docs/` means everywhere).
9. **Is the restatement obligation (D12) a hard gate or an instruction?** A hard
   gate needs a mechanical criterion for "this rationale had to survive", which
   does not obviously exist; an instruction relies on the k phase doing it. A
   middle form: the acceptance document must list which decisions were restated
   into the target's own documentation and which were accepted as lost, making
   the omission visible to the human at the M4 gate instead of invisible.
10. **Flag naming (F25).** Keep `--max-agents <N>` as proposed, or use
    `--jobs <N>` / `--max-sessions <N>` to avoid reading "agent" in two senses
    on one command line once M6.1 makes `--agent` the backend selector?
11. ~~Do the four level semantics of §6.4 match the intent?~~ **[answered
    2026-09-21]** Yes: `high/medium/low` denote **planning guidance** as
    formulated in §6.4, not concurrency directly. D13's intent/mechanism split
    therefore stands as written — `--parallel` shapes how the planning and
    decomposition sessions arrange work, `--max-agents` alone sets the degree of
    parallelism, and `--parallel high --max-agents 1` is a supported
    configuration.
12. **Is `init`-frozen the right granularity for `--parallel`?** Frozen means a
    project cannot run one delicate round serially without editing
    `.opencode/auto/config.json` (which is human-editable and versioned, so it is
    possible, just not per-invocation). The alternative — a run-time override
    that may only *lower* parallelism, never raise it above the frozen level —
    keeps the constitutional guarantee that a run cannot silently become more
    concurrent than the project was planned for, while allowing a serial round.

## 12. Status

Written 2026-09-20; revised 2026-09-21 to add the governing principle P1 (§4.1)
and the fourth requirement N4 (§1), after the user proposed both — together with
facts F19–F28, decisions D10–D18, the §6.4 design, a revised D9 (prohibition
instead of resolution) and open questions 7–12. Question 11 was answered the
same day, confirming D13's level semantics. Revised a second time on 2026-09-21
after verifying the marker-lifecycle question against the templates and
`src/resolve.ts`: **F21 restated**, **F29–F31 added**, **D11 narrowed from
"recommend (b) or (c)" to a specific recommendation of (c)** with its edit
surface and framing, and **§9's marker-table warning corrected**. The
verification made (c) cheaper than this document originally claimed, not dearer:
the process-document carrier is already mandatory, the scanner is already
location-agnostic, and the tier-1 marker table does not move.

Otherwise proposal only: no code changed, and D13 remains the single confirmed
decision. **The root-plan amendment this section called for has been made**
(integration repo `master`, commit `2884099`): D12 records P1, M2.1/M2.2/M2.3,
the M2 and M3 preambles, M4.1 and M4.2 carry candidate-scope pointers here, the
reserved `MP` track is the home of N2's tier 2 and all of N4, and open question
15 plus risk 12 are the tracking entries. Question 7 now carries a recommendation
but is **still open** — it is the only question gating already-scheduled work
(the M2.1 batch), so it should be adjudicated before M2.1 starts. If the user
confirms a further subset, §11's answers get recorded in §5 before any
implementation step is scheduled.

<!-- auto: eof -->

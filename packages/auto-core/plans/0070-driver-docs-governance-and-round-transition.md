# 0070 — Driver-docs governance, R-01→R-02 transition, and the next-round program

Status: **ruled, 2026-10-03 — P-1..P-10 all as recommended; executed the same day as
T-114..T-129: the R-01→R-02 transition (target plans/0014) and the full R-02 program
(target plans/0015) — §3's distillation and deletion, §4's transition, and §5.2's U-1..U-9
all landed (P-7's verdict: no Rust spike, recorded in 0063 §5). Open by design: U-10
(0057 S0 evidence captures) stays gated on the next spent quota window; P-8's falsifier
evaluation is dated ~2026-12, its instrument being T-129's record artifact.**
Drafted at the person's direct instruction (not a driver
unit; no T-number). Grounded in three read-only investigations run 2026-10-03 over the
target repo's task corpus (`docs/T-001..T-113`, `docs/R-01/`, `docs/temp/`, `docs/agents/`)
and the auto-core tree at `27ffad490` (post plans-translation): (1) a reference census of
the target repo, (2) a code-coupling audit of the driver against target-directory
documents, (3) a per-task value census of all 113 task dirs. Nothing has been deleted and
no round state has been touched; every action proposed below needs the person's rulings
(§6) first.

## 0. Executive summary

1. **The coupling between the driver's code and the target's task documents is mechanical,
   not informational.** The code reads task documents through three live obligations — the
   task index (`docs/R-01/P01-implement/tasks.md` requires every listed `docs/T-NNN/` to
   hold exactly one of todo.md/done.md, checked on every run), the done-id globs
   (`docs/T-*/done.md` feed dependency validation), and the current unit's own files.
   Nothing in src/, templates, or the package docs extracts *content* from completed task
   documents. Specific task numbers appear in code and plans only as provenance citations
   (§1.2) that survive deletion via git history.
2. **Most of the corpus is process record whose canonical content lives elsewhere.** ~89 of
   113 dirs are pure execution record already collected in the owning plans' implementation
   sections (0053 §10, 0055 §13, 0059 §12, 0061 §10, 0068 §13), in code comments, and in
   the target repo's own git history. The unique-value residue is concentrated: T-043/T-044
   measurements, the T-066 incident record, the T-086..T-098 program rationale (plans/0067
   deliberately kept no implementation record), and the T-105..T-113 review-execution
   rationale (§2).
3. **Deletion is mechanically safe after distillation, and only after.** Two ordering
   constraints bind: the P01 close runs a handover distillation session that *reads* the
   phase's task documents, and the k (knowledge) phase session reads what the handovers
   point at. Deleting before closing the round destroys the distillation input. After the
   round closes, deletion + index-line removal + one commit is clean (§3.3).
4. **The round transition the person described is already implemented machinery.** Amend
   `phases` "m"→"mk", run: P01 closes with handover distillation, the k phase produces
   `docs/R-01/P02-knowledge/kb.md`, the round completes; `plan` then establishes R-02 with
   the previous round's digest injected into its first planning session (§4). Knowledge
   distillation as the end of one round and the beginning of the next is exactly the
   shipped mechanism.
5. **The next-round program splits cleanly into ten person-rulings and eight
   execution/experiment workstreams** (§5), all sourced from 0069's open register plus the
   T-109..T-113 execution reports.

## 1. The relationship between the driver corpus and the code (census)

### 1.1 What the code actually reads at runtime

- **Task index obligation** — `loadPlan` (`src/tasks.ts:417-433` via
  `src/document/unit.ts:94-112`): every id listed in the current phase's `tasks.md` must
  have `docs/T-NNN/` holding exactly one of todo.md/done.md; otherwise every run/status/
  plan exits 1. Completed tasks' done.md full text and checklists are re-read every load
  (dependency graph, `Closed:` fields) — cheap but real.
- **Done-id globs** — `doneTaskIds` (`docs/T-*/done.md`, `src/tasks.ts:807-813`) and
  `takenTaskIds` (`docs/R-*/P*/tasks.md`): inputs to planning validation and external
  `Depends:` resolution. A pending task depending on a deleted done id would fail
  validation; none exists (all 106 indexed tasks are done, no pending unit).
- **Numbering** — `taskNumberFloor` scans `docs/**/T-*/*.md` only when `.auto/next-task`
  is missing. The record exists (`114`), so deletion does not disturb numbering; a fresh
  clone (`.auto/` gitignored) with a lost record could re-allocate deleted numbers — the
  recovery session's git-history check is the backstop, and validation only enforces "not
  below the floor".
- **Round-close, digests, stats** — read only `docs/R-*` and `.auto/`: `prevRoundDigest`
  (`src/phases.ts:521-557`: previous round's phase index, last done phase's handover.md,
  kb.md docs), `priorKnowledgeDigest` (`src/knowledge.ts:297-318`: every round's
  prior-kb.md), stats accumulators (`.auto/stats.json`). None re-read `docs/T-*`.
- **Recovery paths** — resume-gate, ladder, chain transitions, `.auto/progress.json`,
  `.auto/handover.json`, orphan-lane landing: all read `.auto/` state and session chains
  only. `restoreTestHandoffs` restores only *uncommitted* worktree deletions; the
  start-clean gate (`src/loop-preflight.ts:398-420`) refuses uncommitted deletions of
  docs — deletion must be committed to take effect.

### 1.2 Specific-number citations (provenance, not live pointers)

src: `engine/ladder.ts:49,161,184` (T-109), `execute.ts:837,957` (T-068 S01),
`execute.ts:846` (T-066 S01/S02), `testrun.ts:291` (foreign project), `loop-phase.ts:182`
(T-006). Package docs: `docs/shell-contract.md:135` (T-098), `docs/glossary.md:54`
(T-068.S01 example). Plans: 0065 (T-113, T-062..T-066, T-015, T-079), 0069 (T-086–T-098,
T-094–T-097, T-099–T-104). auto-server src/test headers: T-086, T-087, T-089, T-093,
T-094, T-096–T-098. Templates use only generic `{{taskId}}`/T-NNN placeholders. All
specific citations are evidence pointers ("the T-066 S01/S02 incidents"); after deletion
they resolve through the target repo's git history, which retains every task dir and every
per-task commit ("T-NNN …" subjects) — the audit trail survives the working tree.

### 1.3 The one hard requirement

Deleting task dirs **without** removing their `tasks.md` index lines bricks the run
(loadPlan throws for every missing dir). Deletion therefore always pairs: `git rm -r` the
dirs + delete the index lines + one commit. There is no driver command that does this;
it is a manual operation by design (`src/reset.ts:8-10`: de-init never touches docs/ —
"the work of humans and AI").

## 2. What the corpus holds that the future needs (value census)

Classes: **A** pure process (canonical record elsewhere) · **B** unique technical ·
**C** unique decision rationale · **D** open thread.

| cluster | class | what is unique | canonical home today |
|---|---|---|---|
| T-001..T-007 (stats program) | A | nothing beyond verification counts | root `plans/0007-stats-plan.md` + `docs/temp/PLAN.001-007.md` |
| T-008..T-020 (0053 lifecycle) | A | — | plans/0053 §10 (20 AUTO-* markers) + code |
| T-021..T-042 (0055/0059) | A | — | code comments at decision sites + 0055 §13 / 0059 §12 |
| **T-043** | B | raw A/B artifacts (`ab/`: $5.62 true vs $2.66 auto, 2026-09-27) + 6 AUTO-RESOLVEs | table duplicated in 0059 §12 |
| **T-044** | B | `measure/` timing/import-graph dumps at two snapshots + 3 report-only AUTO-RESOLVEs | verdict distilled into 0060/0061/0062 |
| T-045..T-065, T-067..T-085 (0061 A–F) | A | — | 0061 §10 (all 190 AUTO-* markers with rejected alternatives) |
| **T-066** | B | the S01/S02 artifact-declaration incident, firsthand (`S01/index.md`) | distilled (not verbatim) into plans/0065; fixes landed T-113 |
| **T-086..T-098** (0067 program) | **B/C** | per-unit AUTO-DECISION rationale (7–11 per unit), discovered defects (ops.ts dropping `config.agent`; git-status poller `.git/index.lock`; `#ops-wrap` hidden class), fake-claude workaround patterns, macOS e2e caveats | **none** — 0067's banner deliberately defers to auto-server docs, which carry only a 10-line trail (`auto-server/docs/daemon.md`) |
| T-099..T-104 (0068 lanes) | A | — | 0068 §13 per-stage implementation records |
| **T-105..T-108** | C | banner-fix rationale, re-verified censuses, fold/identify decisions | outcomes in 0069 §4; rationale report-only |
| **T-109..T-113** (review execution) | **B/C** | execution rationale, environment findings (no git identity; `GIT_CONFIG_GLOBAL` workaround; master/main), not-taken alternatives (F1 deeper move, F3 first-line cap), T-112's landing-conflict construction note | 0069 records the *what*; the *why/how-verified* is report-only |

`docs/temp/`: `provider-timeout-analysis-20260912.md` (unique: the 1.18.x binary-vs-source
timeout divergence, fork-retry unreachability under `REUSE_SESSION=off`, reproduction
recipes — conclusions feed the 0015 lineage) and `session-interruption-field-audit-20260915.md`
(unique: quantitative tables, log-citation index — conclusions already written back into
0022/0023). `docs/temp/TODO.md` item T3 is stale (completed by 0061 C6).

**Open threads (D): all already homed in plans** — 0069 §2.3 (R1/R2/R3/R5, D5, D10),
0069 §3.2/§6 (three switch decides, boundary-UX, 0035 disposition, falsifier evaluation,
0063 T-3 re-read), 0055 §13 later-row, 0057 S0, 0026 S6–S8. No open thread lives only in
task documents. The de-facto cross-task knowledge artifact is
`docs/agents/auto-core-deliverables.md` (target repo), actively maintained.

## 3. Extraction, distillation, and the deletion policy

### 3.1 Principle

Distill-then-delete. Distillation targets are the B/C clusters; the A majority needs no
per-task distillation because its canonical record already exists. All distillation
products land in durable homes (plans/ implementation records, the deliverables guide),
following the corpus's own pattern (0061 §10, 0068 §13).

### 3.2 Distillation units (proposed, in order)

- **D-1 · plans/0067 gains an implementation record** — one section, one entry per unit
  T-086..T-098: landed set, the durable AUTO-DECISIONs (defect discoveries and their
  fixes; the fake-claude question-capability workaround pattern; the poller `--no-optional-
  locks` fix), pointers to the auto-server trail. Source: the 13 reports. This is the
  largest unique-value rescue (~the only place the 0067 program's reasoning lives).
- **D-2 · plans/0069 gains an execution record (§8)** — one entry per T-105..T-113:
  what was executed, report-only rationale worth keeping (re-verified censuses, T-112's
  landing-conflict construction note, the not-taken F1/F3 alternatives), environment
  findings (git-identity prerequisite, master/main expectation — feeds U-8 below).
- **D-3 · measurement/incident dirs** — T-043 `ab/` and T-044 `measure/`: fold the
  summary tables and the three T-044 AUTO-RESOLVEs into 0059 §12 / 0062 respectively
  (short amendment), then the raw artifacts may go; T-066: already distilled into 0065
  (fixes landed T-113) — may go as-is.
- **D-4 · docs/temp analyses** — append a short "field-evidence" amendment to plans/0015
  (binary-vs-source timeout divergence; fork-retry unreachability) and plans/0022
  (audit-table pointer), then the two analysis files may go (their conclusions already
  reached the plans once; the amendment preserves the unique measurements' existence and
  where the raw files remain findable — git history).
- **D-5 · deliverables-guide refresh** — `docs/agents/auto-core-deliverables.md` gains
  the T-113-era additions (fresh-item re-read semantics; directory declarations rejected
  at decompose time) if not already implied.

### 3.3 Deletion (after §4's round close, or independently of it after D-1..D-4)

Delete: all A-class dirs (T-001..T-042, T-045..T-065, T-067..T-085, T-099..T-108 — after
D-1..D-4 also T-043, T-044, T-066, T-086..T-098) **plus their 106 index lines** in
`docs/R-01/P01-implement/tasks.md`, one commit. Keep: `docs/R-01/` in full (ledger, phase
dirs, the new handover.md and kb.md — they are the round's distilled record and R-02's
digest source), `docs/agents/`, and — recommended — the most recent development history
(T-109..T-113) until the person is satisfied the §8 execution record suffices. Net effect:
docs/ shrinks from 113 task dirs (~3.3 MB) to the round record + recent units. Git history
retains everything; the audit trail (per-task commits) never leaves.

**If the person prefers zero deletion**: the census still stands — nothing below changes;
the corpus is merely 3.3 MB of mostly-duplicated process record (0069 §4.1's
preserve-originals verdict applied to plans/ extends here by the same logic).

## 4. Round transition R-01 → R-02 (the mechanism, as shipped)

State today: R-01.P01-implement open (todo.md, 106/106 tasks done), `phases: "m"` is the
**no-phase mode** — its single phase stays open by design (`src/phases.ts:23-25`), so the
round never self-completes. Transition steps (all existing machinery, no code changes):

1. **Amend config** `phases: "m"` → `"mk"` (hand-edit `.opencode/auto/config.json`; `plan`
   owns the re-sync of the phase index tail, 0053 D34 — P01 is started, so only
   P02-knowledge is appended).
2. **Run** — P01 has no pending task: the loop completes the phase (gate check
   `completePhase`, `src/phases.ts:347-353`) with the **handover distillation session**
   (`phase-handover.md`: reads this phase's task units — this is why deletion waits);
   routing reaches P02-knowledge, a task-less phase → `extractKnowledge`
   (`src/knowledge.ts:59-127`) produces `docs/R-01/P02-knowledge/kb.md`; P02 hands over
   and completes; the round is complete.
3. **Round close** — reported on the next route; requires a clean tree and (optionally)
   the build gate (`roundCloseProblems`).
4. **`plan` establishes R-02** (no input → scaffold, commit the setup), then the round
   input (from §5 / this document) — the first planning session receives the
   **prevRoundDigest** (P02's handover.md + kb.md) and prior-knowledge digests, capped at
   25% of context. Distillation as the end of one round and the beginning of the next.

Cost note: steps 2–4 open real AI sessions (one handover distillation, one knowledge
extraction, one planning session, plus the round scaffold commits) — minutes, not hours.
Alternative if even that is unwanted: keep `phases: "m"` and treat R-01 as an open
append-forever round (0069's program continues via `plan --append`); the deletion policy
(§3.3) then applies directly, but no digest is ever produced — not recommended, it wastes
the built-in transition.

## 5. The next-round program (from 0069, post-T-113 baseline)

### 5.1 For the person — decisions that gate or shape the program

| # | decision | 0069 home | recommendation |
|---|---|---|---|
| P-1 | `OPENCODE_AUTO_STRICT_RESUME`: promote to default-on or set an expiry | §3.2, §6.2 | promote (20 tests, 17+ days gray, no field incidents) |
| P-2 | `OPENCODE_AUTO_TASK_CONTEXT`: discard or keep | §3.2, §6.2 | discard (ownerless wording knob, 8+3 sites) |
| P-3 | `_DECOMPOSE_FINE`: keep or delete | §3.2, §6.2 | keep (5 days old, consciously ruled) |
| P-4 | boundary-UX ownership: charter the standing track (sanctioning its core seams) or fold under auto-server | §3.2, §6.3 | charter (the seams — run-status, io/Interactive — have core consumers) |
| P-5 | 0035's final disposition: retired-as-history vs live registry record | §6.4 | retired-as-history (flip program closed; A9 already fixed) |
| P-6 | A14's user-facing refusal message + root-plan explanatory note placement | §6.5 | shell-owner wording choice; any placement is fine |
| P-7 | 0063 T-3 trigger re-read (Rust option; first clause fired 2026-10-02) — schedule it | §1.4, §3.2 | schedule as a reading unit in R-02 |
| P-8 | falsifier evaluation (0064 §6, window closes ~2026-12): owner + whether to build the publish-the-record surfacing artifact as its instrument | §1.4, §6.6 | own it in R-02; build the minimal artifact (U-7) |
| P-9 | R-02 sequencing: role registry (R5) first, or the D1/D4/D6 refactors first | §2.3 | R5 after U-1 (both touch session.ts/execute.ts; registry-first converts the refactors' surgery into descriptor work) |
| P-10 | this document: approve §3 (distill-then-delete), §4 (transition), and the deletion extent | here | as written; keep T-109..T-113 initially |

### 5.2 Execution / experiment units (driver-workable once scheduled)

| # | unit | source | shape |
|---|---|---|---|
| U-1 | R1: extract the fork-seeding helper; lift `runSession`'s closures (D1) | 0069 §2.3 | refactor; session-visible note strings are protocol — pinned by tests |
| U-2 | R2: one ondemand-handover engine in execute.ts (D4 remnant + D7/D8 leftovers) | 0069 §2.3 | refactor; retry-semantics difference is deliberate — pinned |
| U-3 | R3: one recovery-ladder module (D6; home `resume-gate.ts`) | 0069 §2.3 | refactor; highest blast radius; resume*.test.ts pins fidelity |
| U-4 | D5 lane-exit/task-bracket merges + D10 session-api formatter split | 0069 §2.2 | mechanical; byte-identical floors |
| U-5 | R5: the role registry | 0064 §5 item 4, 0069 §2.3 R5 | positive architecture; sequencing per P-9 |
| U-6 | distillation units D-1..D-5 of §3.2 | here | documentation units (no code) |
| U-7 | publish-the-record surfacing artifact (stats → a report artifact) | 0064 item 8, 0069 §1.3 | minimal; first consumer is P-8's evaluation |
| U-8 | e2e environment stabilization: git-identity prerequisite, master/main expectation | T-109..T-113 reports | test-only; makes the suite green on identity-less hosts |
| U-9 | smalls: A13 import-direction comment, 0063:65 refresh, 0026 S7/S8 checkbox closes, 0055 later-row triage | 0069 §4.2/§5, reports | bookkeeping |
| U-10 | opportunistic: 0057 S0 evidence captures (Zhipu APIError body/headers) | 0057 S0 | gated on the next spent quota window |

### 5.3 Suggested sequence

1. Person rules P-1..P-10 (§5.1).
2. §4 transition runs (R-01 closes; kb.md + handover.md produced — they become R-02's
   digest and the deletion gate).
3. R-02 opens with U-6 (distillation) first — it unblocks §3.3 deletion — then the
   P-ruling-dependent units, then U-1..U-5 per P-9, with U-8/U-9 as gap fillers and
   U-7/P-8 closing the quarter (falsifier evaluation ~2026-12).

## 6. What this document needs from the person

The ten rulings of §5.1 (P-1..P-10). Everything else is execution. Where a ruling
disagrees with a recommendation, the corresponding unit is dropped or reshaped, not
silently overridden.

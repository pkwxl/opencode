# Stable References and File Storage Conventions: Design Baseline and Implementation Plan (stable-refs)

> **Historical record (2026-09-28, `plans/0061` A3/A5): retired in part, not maintained.** The storage half of
> this design lives on unchanged (permanent `docs/T-NNN/` task directories and round directories, `src/docpaths.ts`,
> the AGENTS.md block's reference conventions). Its checking half is retired: `src/refcheck.ts` (existence/line-cap
> validation, rename rewrite, rename-history recovery, `@sha` range reconfirmation), the `OPENCODE_AUTO_REF_CHECK`
> switch, the pre-commit gate and the `.auto/invalid-refs.md` stale list are deleted, and the block no longer names
> any checking — keeping references valid is each session's own work. The successor rulings are `plans/0061` R6/R15.
> Originally preserved untranslated; translated to English 2026-10-03 with the plans/ corpus
> (protocol-string citations inside backticks keep their original Chinese spelling).

> Status: **Design finalized (2026-09-06)**. Implementation is split into four stages P1..P4, one dedicated session per stage recommended;
> P1 is implemented (2026-09-07, see §7); P1's executable spec, settled decisions (P1-D1..D9), and session split
> (P1-S1..S4) are in [plans/0011-stable-refs-p1-plan.md](./0011-stable-refs-p1-plan.md).
> The kickoff session reads this file in full first, then plans/0006-phases-design.md (F/M sections), plans/0001-auto-number-design.md, and
> plans/0003-fork-decompose-design.md (§ artifact naming) as needed. After each stage completes, tick the §5 checklist and write back §7 implementation progress;
> when implementation and design conflict, the implementation wins — write back to the corresponding subsection of this file with the date noted (mirroring the headnote precedent of plans/0009-verify-review-design.md).

## 0. Problem Background

Three classes of instability, all confirmed by the code as it currently stands:

1. **Doc-to-doc references break as phases/rounds change**: phase handover moves the phase's whole docs/ change set into
   `docs/phases/<letter>-<slug>/` (snapshotDocs/archivePhaseDocs in src/phases.ts, decided by mtime
   differences); a continue into the next round moves them again into `docs/phases/round-<N>/` (archiveRound). Document paths change with phase/round,
   so report A referencing report B's path, and the handover must-read list referencing artifact paths, all dangle after the move.
2. **Doc-to-code references drift as the code evolves**: source paths in reports/audits/design docs go unchecked after
   code refactoring (renames/moves/deletions) and gradually rot.
3. **Two coexisting path models**: task documents are flat suffix files (`docs/<id>.context.md` / `.subtasks.md` /
   `.report.md` / `.audit.md` / `.fix.md` / `.handoff.md` / `.testhandoff.md`, subtask-level
   `<id>-S<n>.testhandoff.md`), while subtask artifacts are single files in directories, `docs/<id>/S<NN>.md`; and testhandoff
   leftover detection relies on the `name.startsWith(task.id-S)` string prefix (src/runner.ts) while taskNumberFloor relies on a flat
   regex (src/numbering.ts). The driver's construction, the ~16 prompt templates, and in-document references — three sides — disagree.

## 1. Goals and Non-Goals

**Goals** (core identity):

> Reference stability = globally unique T-NNN task numbers × permanent paths (documents never move once landed) × only stale state ever gets archived

1. The driver, prompt templates, and in-document references converge on one rule for where documents live (task documents →
   `docs/T-NNN/`, subtask documents → `docs/T-NNN/S<kk>/`).
2. Documents under `docs/` never move once created; phase/round differences are expressed via the filename prefix (`R<N>-`) and ledger derivation.
3. Doc-to-code/doc references are deterministically checked before the driver's unified commit; whatever is mechanically repairable is auto-repaired.

**Non-goals**:

- No semantic-level document validation (content correctness still belongs to the judge/review sessions); only deterministic validation of path existence and the line-number cap.
- No new persisted state: rounds, numbering, and the extraction guard stay derived (ledger/directory derivation).
- No change to the core/shell boundary: this feature has no shell delta, and shell branches inherit it automatically via merge auto-core.

## 2. Confirmed Decisions (user-approved, 2026-09-06)

| # | Decision |
|---|---|
| D1 | Subtask artifact = `docs/T-003/S04/index.md`; temporary files such as testhandoff.md live in the same directory |
| D2 | Phase artifact directories collapse: a/d/t/v artifacts and final-review artifacts are all task-anchored (e.g. `docs/T-F1/audit-r1.md`); `PHASE_PRODUCTS` and the phases-design A.1 artifact-directory conventions are deleted |
| D3 | Handovers become permanent: `docs/handovers/R<N>-<字母>-<slug>.md` (<字母> = the phase letter), landed and never moved; `docs/phases/` and `round-<N>/` hold only stale state files |
| D4 | Legacy compatibility = read fallback (fall back to the old flat path when the new path is missing) + automatic migration at run startup (housekeeping unified commit) |
| D5 | `autoNumber` default flips to `true` (the fundamental rule); `--no-auto-number` is kept as the opt-out switch |
| D6 | Consistency checking in three layers: tool auto-repair (auto-correct) + `check` subcommand scan + verify gate |
| D7 | Stale AGENTS.md snapshots are archived **every round** (into `round-<N>/` together with the end-of-round PLAN.md; AGENTS.md is mostly static within a round, so phase-level snapshots are redundant) |

## 3. The Specification Proper (imposed on the target directory; init sinks it down via the AGENTS.md marker block)

### 3.1 Identity and Storage

Target-directory document layout (the new rules in full):

```
docs/
  T-003/                    # all documents of task 003 (permanent, R2)
    context.md              # understanding summary (understand session)
    subtasks.md             # decomposition checklist (decompose session)
    report.md               # wrapup index report (wrapup)
    audit.md / fix.md       # independent review report / fix checklist
    handoff.md              # ondemand context handoff (temporary, driver deletes)
    testhandoff.md          # task-level test handoff (temporary, driver deletes)
    S04/                    # subtask 04 (permanent)
      index.md              # subtask artifact body (mechanically named by driver)
      testhandoff.md        # subtask-level test handoff (temporary, driver deletes)
  T-F1/                     # final-review task documents: audit-r<r>.md / refactor-r<r>.md /
                            #   patch-r<r>.md / validate-r<r>.md / finalize.md
                            #   (each final-review task anchors its own docs/T-F<k>/, incrementing
                            #    across rounds with the task; see the P1 implementation design P1-D1)
  handovers/                # phase-handover distillates (old flat, permanent, read fallback): R<N>-<字母>-<slug>.md
  migration-kb/             # migration knowledge (old flat, permanent, read fallback): R<N>-migration-<时间戳>.md (<时间戳> = timestamp)
  prior-kb/                 # prior knowledge (old flat, permanent, read fallback)
  agents/                   # cross-phase knowledge routed by the AGENTS.md maintenance-rules block (unchanged)
  R-01/                     # round 1's round directory (created at round start, permanent once on disk, R2)
    PLAN.md                 # this round's task ledger (the root PLAN.md is a relative symlink to it)
    phases.md               # this round's phase ledger (the root docs/phases.md dies out under the new layout)
    AGENTS.md.bak           # AGENTS.md snapshot taken at round start (.bak avoids being auto-loaded as instructions)
    a-analysis/PLAN.md      # phase PLAN.md snapshot (pure stale state, referenced by no document)
    handovers/              # phase-handover distillates (permanent): <字母>-<slug>.md (minus the R<N>- prefix)
    phase-docs/             # phase-level free artifacts: <字母>-<slug>/ (minus the R<N>- prefix)
    prior-kb.md             # this round's prior knowledge (fixed name within the round)
    migration-kb.md         # this round's migration knowledge (fixed name within the round)
  phases/                   # old layout (legacy read fallback): pure stale state, referenced by no document
    a-analysis/PLAN.md      # phase PLAN.md snapshot
    round-1/                # phases.md + end-of-round PLAN.md + AGENTS.md + per-phase archive directories
```

> **2026-09-08 dedicated round-directory scheme (plans/ROUND_WORKDIR_PLAN.md)**: one
> `docs/R-NN/` per round (two zero-padded digits after R, natural carry; alongside `docs/T-NNN/` = the two
> top-level namespaces under docs/: T = task documents with permanent cross-round numbers, R = self-contained round containers), created at round start;
> everything inside it is permanent once written to disk, replacing "shared directory + filename prefix + end-of-round move-to-archive" (archiveRound
> is deleted). Legacy compatibility = read-only fallback: the old flat `docs/handovers/R<N>-*.md`,
> `docs/prior-kb|migration-kb/`, `docs/phases/round-N/`, and the root `docs/phases.md`
> stay in place as read-fallback sources and are never moved; writes go only to the new layout.

Rule clauses:

- **R1 fundamental numbering rule**: T-NNN globally unique, growing only (`autoNumber` on by default, D5); document identity is anchored to the
  task number; T-F<k> final-review numbering is a separate namespace and does not enter the auto-numbering record (existing semantics).
- **R2 permanence**: documents under `docs/` (`docs/T-*/`, `docs/R-*/`, the old flat `docs/handovers/`, 
  `docs/migration-kb/`, `docs/prior-kb/`, `docs/agents/`) never move and are never renamed once created.
- **R3 directories**: task documents appear only inside `docs/T-NNN/`; subtask documents only inside `docs/T-NNN/S<kk>/`
  (two-digit zero padding, S04).
- **R4 fixed role filenames**: context / subtasks / report / audit / fix / handoff / testhandoff / index.
- **R5 archive semantics**: stale state files (each phase's PLAN.md snapshot) are kept inside the round directory
  `docs/R-NN/<字母>-<slug>/` (same design as the old layout's `docs/phases/`, legacy read fallback);
  state files are referenced by no document.
- **R6 temporary files**: the handoff.md / testhandoff.md lifecycle = execution scope; the driver deletes them on completion
  (existing semantics, only the location moves into the directory).
- **R7 phase-difference expression**: rounds are expressed via the `docs/R-NN/` round directory and ledger derivation (the old layout used the filename
  prefix `R<N>-`, legacy read fallback), not by moving directories.

### 3.2 Reference Syntax

- The only legal form: **paths relative to the target-directory root**, in backticks or as a Markdown link; `path:line` line anchors are allowed.
- Doc-to-doc references point at `docs/T-NNN/...` permanent paths; referencing state files inside round directories
  (the phases.md ledger, PLAN snapshots inside phase archives; likewise the old layout's `docs/phases/`) or
  handover paths is forbidden (handover is a driver injection channel, not a reference target).
- Exemptions: paths inside code fences (``` pairs); references on lines carrying the `已删除` / `已归档` / `历史` markers ("deleted" / "archived" / "historical")
  (they describe past states).
- Validation semantics: the path exists; line number ≤ the file's total line count.

### 3.3 Consistency Checking in Three Layers (D6)

| Layer | Timing | Behavior |
|---|---|---|
| auto-correct | before every unified commit (driver, deterministic) | old paths successfully paired by git rename → mechanically rewrite live-document references; deletion-type hits cannot be auto-repaired → finding |
| check subcommand | manual / CI | full scan of live documents doc→doc / doc→code, exit code 1 on hits |
| verify gate | task boundary (inside the verifyTask flow, driver deterministic pre-scan) | dangling references in task artifact documents = gap → existing fix rounds; silent block with exit code 2 on exhaustion; degrades to a log hint when verify is disabled (preserving the "no verify = lenient" contract) |

Live-document scope: `docs/**/*.md`, excluding `docs/phases/**`; fences and marker lines are exempt.

## 4. Mechanism Design (file level)

### 4.1 `src/docpaths.ts` (new, P1)

The single construction point for all task-document paths (this module enforces the code side of the "three-way shared understanding"):

- `taskDir(id)` / `taskDoc(id, role)` / `subtaskDir(id, k)` / `subtaskDoc(id, k, role)` /
  `knowledgeDoc(round, ts)` / `priorKnowledgeDoc(round, ts)` / `finalDoc(id, name)`。
  **Deviation note (2026-09-07, implemented in P2)**: `handoverDoc(round, phase)` lives in
  `src/phases.ts` rather than in this module — the filename depends on the phase slug table (PHASE_SLUGS belongs to phases.ts),
  and placing it there avoids a docpaths→phases reverse dependency; `knowledgeDoc`/`priorKnowledgeDoc`
  land in this module as designed.
- `resolveTaskDoc(dir, id, role)`: on read, new path missing → fall back to the old flat path (D4 read fallback, mirroring
  the config.ts legacyModeFallback precedent); it dies out naturally once migration completes.
- Consumer refactors: src/runner.ts (context/subtasks/handoff/testhandoff path construction and legacy sweep),
  src/prompt.ts (handoffFile/testHandOffFile), src/resume.ts, src/numbering.ts (floor scan),
  src/knowledge.ts, src/final.ts (final-review artifact paths).

### 4.2 Automatic Legacy Migration (P1)

- Hook point: run startup (loop.ts, before the server is brought up); idempotent — skipped when there are no flat files, producing no empty commit.
- Scan and move mapping:
  - `docs/T-003.context.md` → `docs/T-003/context.md` (subtasks/report/audit/fix/handoff/testhandoff likewise);
  - `docs/T-003-S2.testhandoff.md` → `docs/T-003/S02/testhandoff.md`;
  - `docs/T-003/S04.md` → `docs/T-003/S04/index.md`;
  - old final-review artifacts `docs/final-audit.md`, `docs/final/audit-r<r>.md`, etc. → `docs/T-F1/` (filenames unchanged).
- After the move, references in live documents are rewritten (old path → new path, whole-path word-boundary matching; reusing the §4.5
  extract/rewrite base functions, **those two functions land early in P1**, validate and wiring come in P4).
- housekeeping unified commit: new stage label `doc-migrate` (the pseudo-task label list in src/git.ts,
  synced in behavior.md/structure.md).

### 4.3 Archive Reduction (P2: src/phases.ts / src/loop.ts / src/knowledge.ts)

- **Delete**: `snapshotDocs` / `archivePhaseDocs` / `PHASE_PRODUCTS` / `.auto/phase-snapshot.json`
  across the whole chain (the snapshot call in loop.planPhase, the phase-k "snapshot not refreshed" special case, the rm in archiveRound).
- **Handover** (handoverPhase): the distillation session's artifact = `docs/handovers/R<N>-<字母>-<slug>.md`
  (filename derived from currentRound × phaseArchive, the driver creates the directory first); the PLAN.md snapshot is still copied into
  `docs/phases/<letter>-<slug>/`; appendLedger new-line protocol
  `→ docs/phases/<letter>-<slug>/(交接: docs/handovers/R<N>-...md)` (the parenthetical reads "handover: ..."); **parseLedger stays
  compatible with old lines** (lines whose handover pointer points at docs/phases/.../handover.md do not throw; the letter and archive-directory columns are still read unchanged).
  **Implementation note (2026-09-07)**: planPhase's prior-handover injection reads from the permanent handovers/ path,
  with read fallback to handover.md inside the archive directory for phases completed before P2 (mid-round upgrade compatibility).
- **archiveRound**: + a root AGENTS.md snapshot (D7, copied not moved, no directory created when there is nothing to archive);
  migration-kb / prior-kb are no longer moved; `round-<N>/` = per-phase archive directories + phases.md +
  the end-of-round PLAN.md + AGENTS.md.
- **knowledge.ts**: knowledgeFile → `docs/migration-kb/R<N>-migration-<时间戳>.md`;
  existingKnowledge switches to a round-derivation guard — **implementation refinement (2026-09-07)**: guard = non-empty .md with this round's
  `R<round>-` prefix (covering both windows, interrupted-before-handover and already-completed; when the ledger's k line is done
  the extraction hook simply never fires, so the ledger need not be read); in round 1, legacy files without the `R<N>-` prefix are treated as this round's
  output via read fallback; archivePriorKnowledge is deleted outright — the round-prefix guard replaces the between-round move
  (priorKnowledgeFile likewise `R<N>-prior-<时间戳>.md`; **when the migrate shell merges into P2, the
  archivePriorKnowledge call site must be deleted and the existingKnowledge(round) signature adapted**, see
  the shell-contract merge process).
- **prevRoundDigest**: (1) the archive index is unchanged; (2) the final handover is now read from `docs/handovers/R<N>-<字母>-<slug>.md`
  (derived from the last completed letter; **for pre-P2 rounds, read fallback to handover.md inside the round's own archive directory**); (3) knowledge collection =
  `R<N>-`-prefixed files in `docs/migration-kb/` (unprefixed legacy files leniently folded into the previous round; **for pre-P2 rounds,
  collected via read fallback from migration-kb/ inside the round archive**, otherwise the upgraded project's existing knowledge disappears from the digest).
- renderPhaseHandover / phase-handover.md / phase-plan.md / knowledge.md /
  prior-knowledge.md / number-recovery.md template copy synced (artifact conventions change to docs/T-NNN/ and
  handovers/, the A.1 artifact-directory wording is deleted). **Implementation note (2026-09-07)**: number-recovery.md
  gets zero changes after review (the evidence-list dual-layout wording is still accurate); the phase-handover protocol marker changes to `{{handover}}` as `{{archive}}`
  is variabilized (template.ts PROTOCOL_MARKERS synced).

### 4.4 Numbering On by Default (P3: src/config.ts / src/index.ts)

- `CONFIG_DEFAULTS.autoNumber = true`; the formatProjectConfig summary logic is unchanged (still conditionally displayed).
- init/run copy, README, and behavior.md usage synced; plans/0001-auto-number-design.md gets a revision headnote
  (default flipped, zero mechanism change).
- e2e / config test snapshots updated.

### 4.5 Reference Consistency in Three Layers (P4: src/refcheck.ts (new) / src/check.ts / src/runner.ts / src/loop.ts)

refcheck core (extract/rewrite land early in P1 for migration reuse; P4 fills in the rest):

- `extractRefs(text)`: backtick paths and md links; filters out code fences and marker lines
  (`已删除|已归档|历史` — "deleted|archived|historical"); produces `{ path, line?, at }`.
- `validateRefs(dir, refs)`: existence + line number ≤ total line count; produces findings (file/line/text).
- `renamePairs(root)`:`git diff --find-renames --diff-filter=R HEAD` → `{ old, new }`。
- `rewriteRefs(docs, pairs)`: mechanical replacement, whole-path word-boundary matches only; **renames only — deletions/semantic
  changes are not auto-rewritten** (to avoid mis-repairing historical narrative); **rewriting never touches layout** (2026-09-08 requirement addendum) — only
  the matched token itself is replaced in place; line structure/whitespace/table alignment/trailing newline are preserved as-is, and files with no hits are not written back.

Wiring:

- **Pre-commit auto-correct**: before commitTree at the loop/runner task boundary — renamePairs →
  rewriteRefs (live documents) → re-scan for findings; findings enter a fix round when verify is enabled (the existing
  fix-round semantics), otherwise they are logged as ⚠.
- **check subcommand**: findings merged into the return structure and CLI report, exit code 1 on hits; a note is given when the target directory lacks
  the reference-spec block.
- **verify gate**: before the verifyTask judge session the driver first runs validateRefs over the task artifact documents —
  deterministic gaps go straight into a fix round, without spending a judge session.
- **init sink-down**: ensurePointer gains a sixth marker block `opencode-auto:refs:start/end` (the full §3 spec,
  idempotently backfilled); wrapup.md (report reference requirements), verify-script-gen.md, and fix.md gain
  reference-spec reminder copy.

> **2026-09-07 implementation notes (stable-refs P4, implementation wins)**:
> - The validateRefs signature converges on `(dir, refs) → Map<path, problem>`; backfilling the findings' position
>   (file/line/text) is assembled by scanRefs (the scan entry point); validation exemptions are refined on top of §3.2 —
>   URL/absolute-path/`~`/`./`/../` forms and pure version-number tokens (e.g. `v1.2`; only extensions starting with a letter count as path-like)
>   are not validated; md-link `#fragment`s are stripped before validation; directory references are checked for existence only (line anchors ignored).
> - renamePairs stages with `git add -A` first, then `git diff --cached --find-renames HEAD` — untracked
>   new paths (the AI's common bare-mv renames) otherwise take no part in pairing; staging is anyway the prelude to the next unified commit and does not
>   change the commit result; paths are converted from repo-root-relative to target-directory-relative.
> - The auto-correct hook point is the runner's afterSession (the common entry of all unified commits, including
>   requireArtifact bypass sessions); before the loop task-boundary commit a session commit has always covered it already, so loop is not hooked
>   separately; findings are uniformly logged as ⚠, and "enter a fix round when verify is enabled" is borne by the verify gate (next item).
> - The verify gate runs before every judge session (including re-judging after a fix round); gap copy is assembled by formatRefGap;
>   off mode has the same semantics as judge gaps (fall back to pending), and FIX_ROUNDS exhaustion blocks with exit code 2.
> - check's non-git note is given only when docs/ exists (the reference mechanism has an object to work on).
> - **Suffix resolution and the invalid-refs list (2026-09-07, requirement addendum)**: for paths that miss directly, validateRefs
>   looks for a unique file match by segment-boundary suffix inside the target-directory tree — a context-relative reference
>   (written with the referencing document's own directory as base, especially non-docs references) counts as valid on a unique hit and resolves to
>   the matched file for line-number validation; multiple matches are contextual ambiguity and count as missing (FileIndex is a lazy full file inventory,
>   pruned of node_modules/.git, one instance shared across the whole scanRefs run); autoCorrectRefs additionally maintains the invalid-refs
>   list `.auto/invalid-refs.md` (key = `文件 → 路径(problem)`, i.e. "file → path(problem)"; it carries no line number or original text —
>   those drift with edits and cannot serve as identity; fully rewritten each round from current findings, auto-removed once fixed, recurrence
>   treated as newly appearing); recorded keys no longer get ⚠, and warning logs are emitted only for newly appearing invalid references — the list is
>   the manual verification/correction entry point and also prevents endless repeated warnings; the check subcommand is an explicit invocation, and its report is not
>   deduplicated against the list. The same day also landed `script/fix-refs.ts` (bun run fix-refs [dir]):
>   a one-shot manual entry for autoCorrectRefs, used before a migration-driven run to pre-clean leftover worktree references reorganized under
>   the new directory structure (rename-pair rewriting + the list written to disk; exit code 1 = invalid references remain);
>   `script/fix-docs.ts` (bun run fix-docs [dir]) is the all-in-one pipeline = migrateLegacyDocs directory-
>   tree restoration + autoCorrectRefs reference cleanup. Migration-conflict arbitration is upgraded to newest-first: candidates are
>   grouped by target new path; within each group they are moved in mtime-descending order (lexicographic by path on equal mtime); the newest takes the
>   free target slot, while conflicting parties are not moved and stay in place (P1-D3: never overwrite, never break); an empty directory in the target slot
>   does not count as a conflict — it is vacated and then filled. The same day fills P2's leftover placement gap (P2 fixed only the task-anchoring rule and gave no
>   placement for phase-level free artifacts — survey/design batches/coverage matrices/verification records): a new permanent directory
>   `docs/phase-docs/R<N>-<字母>-<slug>/<name>.md` (the same paradigm as D3 handovers: landed,
>   never moved, not part of round archiving; R7 round prefix; name-paired with handoverDoc — distillate =
>   the `<slug>.md` file, original artifacts = the same-named directory; constructor phases.ts phaseDocsDir),
>   doc-layout storage spec synced. Old-tool round archives get promoted (docpaths.phasesArchivePair
>   as the single mapping source, shared by the migration scan and old-reference rewriting): task documents (incl. T-F<k>)/companion S artifacts
>   (S<k>.<name>.md)/handover variants (T-NNN.handover.md is really a phase handover)/final/ and
>   migration-kb, prior-kb (R<N> prefix backfilled)/phase free artifacts (first-level phase subdirectory stripped)/
>   scattered project documents (the numbered series at the top of docs/) each return to their permanent slots; PLAN.md/phases.md/AGENTS.md
>   stale state stays in the archive (R5); promotion candidates and flat candidates join the same pool for mtime arbitration, and same-numbered task documents
>   across rounds automatically keep the newest version.
> - The AGENTS.md reference-spec block is a condensed rendering of the full §3 spec (a verbatim full text would push the six marker blocks cumulatively close to the
>   150-line budget of the maintenance-rules block); the spec's details defer to this design document.

> **2026-09-08 revision note (refcheck-scope-design, revising §4.5/D6)**:
> - The whole of refcheck is governed by the `OPENCODE_AUTO_REF_CHECK=on/off` switch, **default off** —
>   when off, all three hook points (pre-commit auto-correct, check reference scan, verify-gate pre-scan) run
>   as no-ops: zero reference-checking behavior in the target directory; the manual fix-refs script is not constrained (implemented in P1).
> - The move-to-adapt approach is abandoned: the migrateLegacyDocs legacy migration (including the run-startup hook and round-archive promotion) and
>   the fix-docs script are retired together; the old flat layout stays in place, read fallback stays permanently, and broken legacy references now go through
>   git-history-tracking recovery instead (refcheck-scope-design §4, implemented in P2).
> - The checking scope converges on three classes (missing recovery / pre-commit move correction / range-reconfirmation `@sha` version markers,
>   implemented in P3 — the line-anchor-drift topic's landing is exactly this item, see §8); see plans/0013-refcheck-scope-design.md
>   D4 and §4-§6 for details.

## 5. Implementation Stages and Checklist (one dedicated session per stage)

### P1 Path Unification (behavior-equivalent renames + legacy migration)

- [x] `src/docpaths.ts` added (constructors + read fallback)
- [x] runner / prompt / numbering / final consume docpaths (resume / knowledge zero changes per P1-D5)
- [x] testhandoff leftover detection switches to scope enumeration (`docs/T-NNN/**/testhandoff.md`, replacing `startsWith(task.id-S)`; the old flat-prefix scan kept for the compatibility window)
- [x] taskNumberFloor scan switches to `docs/**/T-*/*.md` (also scanning legacy flat `docs/T-*.md` during the compatibility window)
- [x] template path copy in 16 places (understand / decompose×6 / subtask / context-base / handoff-steer /
      test (three sections) / wrapup / verify-judge / review / review-fix / final-task / phase-plan /
      number-recovery) + `_partials.md` gains a shared 「文档存放规范」 section (doc-layout; "document storage conventions"); checked
      PROTOCOL_MARKERS (understand's `context.md` marker is a substring match and still matches after path prefixing; P1-D7 all unchanged)
- [x] refcheck base functions landed (extractRefs / rewriteRefs, §4.5; validate/renamePairs left for P4)
- [x] automatic legacy migration (§4.2) + `doc-migrate` commit label (git.ts / behavior / structure)
- [x] tests: prompt / runner / template / numbering snapshot updates + new docpaths / migrate tests
- [x] docs: behavior.md (path contract and doc-migrate), structure.md (docpaths / refcheck entries),
      the package AGENTS.md navigation line
- Wrap-up: `bun typecheck` + `bun test` all green (2026-09-07, 340 pass); manual smoke — new task artifacts land in
  `docs/T-NNN/`, flat legacy files migrated, live-document references rewritten (pending execution by the auto/ worktree integration session, see §7)

### P2 Archive Reduction (docs never move)

- [x] phases.ts drops the snapshot/archive chain; handoverPhase now produces `docs/handovers/`; appendLedger
      new-line protocol (parseLedger tolerates old lines without throwing — LEDGER_ENTRY constrains only up to the archive-directory column, so both old and new
      pointer forms match)
- [x] archiveRound gains the AGENTS.md snapshot and drops the migration-kb / prior-kb moves
- [x] knowledge.ts round guard + `R<N>-` prefix; prevRoundDigest now reads permanent paths
      (implementation refinement and migrate-shell adaptation points in the §4.3 note)
- [x] loop.ts planPhase drops snapshotDocs; the phase-k snapshot special case is deleted
- [x] templates and prompts (phase-handover / phase-plan / knowledge / prior-knowledge /
      number-recovery — the latter zero changes after review, see the §4.3 note)
- [x] tests: phases / knowledge / prompt snapshots (incl. pre-P2-layout read-fallback cases;
      archivePriorKnowledge tests deleted along with the function)
- [x] docs: revision notes in plans/0006-phases-design.md F/M sections (plus A.1/C.1/D.4/E), behavior.md,
      structure.md, the shell package `packages/auto` README (archive-layout change) + src/index.ts continue copy
- Wrap-up: `bun typecheck` + `bun test` all green (2026-09-07, auto-core 340 pass + the shell package at
  27 pass/2 skip); smoke — one full admtvk round + a continue into the next round, verifying that before vs. after the round
  the `docs/` top level and `docs/handovers/` paths are unchanged and `round-1/` contains only state files
  (pending execution by the auto/ worktree integration session, same as P1)

### P3 Numbering On by Default

- [x] config.ts default flip + config / e2e snapshots
- [x] index.ts / README / behavior copy; revision note in plans/0001-auto-number-design.md
- Wrap-up: typecheck + test; init smoke confirms the default summary 「自动编号 on」 ("auto numbering on")

### P4 Reference Consistency in Three Layers

- [x] refcheck.ts fills in validateRefs / renamePairs; live-document enumeration activeDocs (excluding `docs/phases/`;
      the docs/phases.md ledger counts as a live document) + scanRefs (per-document extract→validate→findings) +
      taskRefFindings/formatRefGap (gate pre-scan scope and gap copy) + gitAvailable/check form exemptions
- [x] pre-commit auto-correct + findings repair-path wiring (hooked at runner afterSession, covering all
      unified commits; degrades to logging when verify is disabled)
- [x] check.ts extended (refs merged into the return structure and CLI report + exit code 1 + missing-spec-block note + non-git note)
- [x] verifyTask deterministic pre-scan (before every judge session; off mode falls back to pending, exhaustion blocks with exit 2)
- [x] ensurePointer spec block (opencode-auto:refs) + wrapup / verify-script-gen / fix template copy
- [x] tests: new refcheck / check tests + e2e (CLI check exits 1 on reference hits / clean exit 0)
- [x] docs: behavior.md (checking contract), structure.md, plans/0009-verify-review-design.md note, package AGENTS.md navigation
- Wrap-up: typecheck + test all green (2026-09-07, auto-core 351 pass + the shell package at 29 pass/2 skip); smoke —
  rename a code file → live documents auto-rewritten; delete a file → findings; check exits 1 on hits (unit-test-level coverage;
  the real-run smoke is pending, to be executed together by the auto/ worktree integration session)

## 6. Session Handover Conventions

- Each stage kickoff: read this file + `git log --oneline -10` to confirm prior stages are merged; from P2 also read
  the plans/0006-phases-design.md F/M sections (revised).
- Each stage wrap-up: tick the §5 checklist, write back §7 implementation progress (date / commit / verification result); conventional
  commit (`type(scope): summary`); **get user confirmation before committing** (repo convention).
- Deviation write-back: when implementation and design conflict, the implementation wins — write back to the corresponding subsection of this file with the date noted.
- Integration smoke (all three packages, in full) happens in the `auto/` worktree, per the root AGENTS.md conventions.

## 7. Implementation Progress

| Stage | Status | Date | Commit | Verification |
|---|---|---|---|---|
| P1 | code complete, integration smoke pending | 2026-09-07 | feat(refs): P1-S1..S4 (four-session commit, see plans/0011-stable-refs-p1-plan.md §8) | this package's `bun typecheck` + `bun test` all green (340 pass); three-package integration smoke in the auto/ worktree pending |
| P2 | code complete, integration smoke pending | 2026-09-07 | feat(refs): stable-refs P2 archive reduction (single-session commit) | this package's typecheck + test all green (340 pass); shell package packages/auto typecheck + test green (27 pass/2 skip); three-package integration smoke pending (P1 smoke made up together) |
| P3 | code complete, integration smoke pending | 2026-09-07 | feat(refs): stable-refs P3 numbering on by default (single-session commit) | this package's typecheck + test all green (340 pass); shell package packages/auto typecheck + test green (27 pass/2 skip); init smoke confirms the default summary 「自动编号 on」 ("auto numbering on") and the phases="m" ℹ hint; structure.md default note synced |
| P4 | code complete, integration smoke pending | 2026-09-07 | feat(refs): stable-refs P4 reference consistency in three layers (single-session commit) | this package's typecheck + test all green (351 pass); shell package packages/auto typecheck + test green (29 pass/2 skip); all three layers in place (auto-correct hooked on all unified commits, check subcommand exits 1 on hits, verify gate enters repair rounds); real-run smoke pending for the auto/ worktree integration session (P1..P3 made up together) |

## 8. Residual Risks and Boundaries

- **Line-number anchor drift (already handled by refcheck-scope P3, landed 2026-09-08)**: after a file is edited, the
  `:N`/`:N-M` line ranges cited by references drift out of truth as content shifts — current contract: inconsistent line anchors in changed files get an
  `@<sha>` version marker auto-appended before the unified commit (the original range is kept; semantics = the range is valid only for the marked historical
  version, exempt from the line-cap validation; marked references are no longer updated, left for manual correction), see
  plans/0013-refcheck-scope-design.md §6. Automatic tracking of content displacement (e.g. anchor-line content fingerprints) is still out of scope.
  The user additionally confirmed: brace
  expansion (`{a,b}.rs`), wildcards (`*_test.rs`), and prose identifiers (`.ctr` etc.) are not single-path references,
  excluded from the validation contract; the invalid list serves only as a manual triage entry point and recorded keys are not warned about twice (the migration-conflict skip
  works the same way, registered in `.auto/migrate-skips.md`).
- **parseLedger old-pointer-line compatibility**: the current round's ledger strict parsing must tolerate old-format lines (no throw); lenient parsing of ledgers inside round
  archives already exists and is unaffected. P2 implementation check: LEDGER_ENTRY constrains only up to the archive-directory column,
  so both old and new handover-pointer forms match naturally — compatible with zero changes (2026-09-07).
- **auto-correct boundary**: rename-pair rewriting only; deletions/semantic changes produce findings and go through the repair path,
  never auto-rewriting historical narrative.
- **Legacy migration-kb without the `R<N>-` prefix**: prevRoundDigest collects them leniently into the previous round; new output always
  carries the prefix.
- **Phase-k re-extraction procedure**: after existingKnowledge switched to the round guard (P2 implementation wording in §4.3), manual
  re-extraction = delete the ledger's k line + delete this round's `R<N>-`-prefixed documents in docs/migration-kb/, then re-run
  (the pre-P2 procedure "delete the archive directory" is retired along with the differential-archive chain; the README rollback procedure is synced).
- **Non-git target directory**: renamePairs depends on git, so auto-correct is unavailable (validate still runs);
  check reports a note for this.
- **--no-auto-number projects**: the directory and permanence rules still apply (path stability does not depend on number uniqueness;
  number uniqueness only affects the trustworthiness of cross-task references); template copy gets no special branching.
- **migrate-shell merge-into-P2 adaptation points (2026-09-07)**: `archivePriorKnowledge` is already deleted from core
  (the round-prefix guard replaces the between-round move); the `existingKnowledge(dir, round)` /
  `priorKnowledgeFile(round)` / `existingPriorKnowledge(dir, round)` signatures changed —
  after the migrate branch merges auto-core, it must delete tool.ts's archivePriorKnowledge call and adapt to the
  signatures (shell-branch adaptation, zero backflow into core).
- **Round-number drift when re-running after an interrupted existing archiveRound (outside P2 scope, observation note 2026-09-07)**: when archiving is
  interrupted "after the directory is created, before the ledger is moved", a re-run of continue derives N+1 via currentRound and the remaining entries
  get split into round-(N+1) (the M section's "naturally finishes" wording does not hold in this window); this boundary has existed ever since
  the M section was implemented; P2 did not change its behavior, and a fix, if wanted, should come as a separate later design (e.g. reuse the existing
  round-N directory without phases.md when the ledger is present).

### Rulings Settled During the P1 Implementation Stage (2026-09-06, details in plans/0011-stable-refs-p1-plan.md §3)

- **Final-review artifacts anchored to the producing task**: derived as `k = final 字段任务数 + 1` ("k = the number of tasks in the final field + 1"); the same round's four phases and cross-round ones each anchor
  their own `docs/T-F<k>/` (the T-F1/ comment in §3.1 is a filename illustration).
- **--review final-review audit merged into the task audit path**: `docs/final-audit.md` → `docs/<taskId>/audit.md`;
  the old file migrates to `docs/T-F1/final-audit.md` (filename unchanged, purely a historical archive).
- **knowledge.ts / resume.ts get zero changes in P1** (the R<N>- prefix and handovers/ belong to P2; resume does not
  construct task-document paths) — the §4.1 consumer list is narrowed accordingly.
- **Common shell copy synced along** (packages/auto's --handover-test help text and README path wording).

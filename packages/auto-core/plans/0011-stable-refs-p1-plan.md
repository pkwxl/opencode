# stable-refs P1 Implementation Design: Path Unification (behavior-equivalent rename + stock (existing-file) migration)

> Status: **Implementation design finalized (2026-09-06); the four implementation stages S1..S4 all landed on 2026-09-07/08 (§8 progress table), and were later superseded by upstream evolution -- the checking half (refcheck) was retired along with `plans/0061` A3/A5, while the storage half (docpaths and the T-NNN task-directory layout) survives to this day** (correction dated 2026-10-02, `plans/0069` §4.2 A5). Upstream design: [plans/0010-stable-refs-design.md](./0010-stable-refs-design.md)
> (§2 decisions, §3 normative body, §4.1/4.2/4.5 mechanisms, §5 P1 checklist); on conflict with upstream, upstream prevails; implementation-side
> deviations follow this file's §3 settled decisions and are written back upstream.
> This file = P1's executable spec + session split + **baseline summary**; per the §0 protocol it is provided for multiple independent implementation sessions to execute.

## 0. Session Kickoff Protocol (required reading for every implementation session)

- **Three kickoff steps**: (1) read §1 of this file (the baseline summary, i.e. this plan's "fork point" -- the current-state
  understanding shared by all implementation sessions, equivalent to the context.md summary the fork pipeline injects into each session) + the section for this session; (2)
  `git log --oneline -5` to confirm prior sessions are merged; (3) in the `packages/auto-core` directory run
  `bun typecheck && bun test` to confirm the baseline is fully green.
- **Three wrap-up steps**: (1) `bun typecheck && bun test` fully green; (2) tick the §8 progress table, and write deviations back into the corresponding
  section of this file with the implementation as authoritative; (3) conventional commit (`feat(refs): …`), **obtain the user's confirmation before committing**
  (repo convention).
- Each section is self-contained (files, functions, exact changes); no exploration notes beyond this file are needed; line-number hints are all
  "approx. L..." (they drift as prior sessions land; locate by function name/quoted text).
- All changes land in the `opencode/` worktree (auto-core branch); core changes land only on this branch; copy syncs for the generic shell
  `packages/auto` that track core evolution are allowed on this branch (see P1-D8).
- Integration smoke (all three packages, full) runs in the `auto/` worktree, aligned with the root AGENTS.md; each P1 session only guarantees this
  package's typecheck + test green.

## 1. Baseline Summary (the current-state understanding shared by all sessions)

### 1.1 Problem and Goals

Three classes of instability (see upstream §0 for details): docpaths breaking as documents move across phases/rounds, document-to-code reference drift, and flat/directory
two path notions coexisting. P1 does **path unification** only -- task documents move from flat suffix files (`docs/<id>.<role>.md`)
into task directories (`docs/T-NNN/<role>.md`, `docs/T-NNN/S<kk>/…`), and final-review artifacts move from `docs/final/`
into task-anchored directories (`docs/T-F<k>/…`); the three parties' notions -- driver/templates/read fallback -- are unified via the single
construction point `src/docpaths.ts`; plus a stock (existing-file) auto-migration at run startup (`doc-migrate` unified commit). Archive reduction
(docs never move, handovers/ made permanent), the numbering default flip, and reference checking are P2/P3/P4 respectively,
**P1 does not touch them**.

### 1.2 Current-State Code Map (index of change points)

| File | Key points (P1-relevant) |
|---|---|
| `src/prompt.ts` | three path-construction functions: `testHandoffFile` (approx. L60, `docs/<id>[-S<n>].testhandoff.md`), `subtaskOutputFile` (approx. L171, `docs/<id>/S<NN>.md`), `handoffFile` (approx. L385, `docs/<id>.handoff.md`); `renderFinalTask` inlines the proposal path `docs/final/plan-…` (approx. L252, inlined to avoid a prompt↔final cycle -- having docpaths provide it keeps things acyclic) |
| `src/runner.ts` | 14 task-doc path consumption points (listed point by point in §4.4); the `startsWith(task.id-S)` prefix scan in `testHandoffExists`/`cleanTestHandoffs` (approx. L1607-1626); `pipeline`'s fixFile construction (approx. L449), `planReviewFix` (approx. L1414) |
| `src/final.ts` | `finalProposalFile` (approx. L16) / `finalReportFile` (approx. L22), all with the `docs/final/` prefix; `appendFinalTask`'s id counting (approx. L202); routeFinal's after* routes read the report |
| `src/numbering.ts` | `taskNumberFloor` (approx. L41-69): scans PLAN.md, `docs/phases/**/PLAN.md`, and the flat glob `docs/**/T-*.md` |
| `src/loop.ts` | `runAll` hook: after usePromptLibrary, before the "phased-flow preflight" inside the try block (§4.7); `ensurePointer`'s marker-block mechanism (the refs block only arrives in P4; P1 leaves it alone) |
| `src/git.ts` | the pseudo-task stage label list in the `message()` comment (approx. L12-13; add `doc-migrate`) |
| `src/knowledge.ts` / `src/resume.ts` / `src/phases.ts` | **zero changes in P1** (P1-D5/P1-D9, see §4.9) |
| `templates/prompts/*.md` | 16 path mentions (per-file table in §4.8); `_partials.md` currently has four sections: head/question-rule/state-rule/decompose-rule |
| `src/template.ts` | `PROTOCOL_MARKERS` (approx. L94-113): all unchanged in P1 (P1-D7); the `registerTemplate`/override mechanism is untouched |
| Tests | `test/prompt.test.ts` (1093 lines, dense path assertions), `test/runner.test.ts` (handoffSteer copy approx. L26; the ensureForkBase fixture writes `docs/T-001.context.md` approx. L180/194), `test/numbering.test.ts` (floor cases), `test/final.test.ts`, `test/template.test.ts` (partials) |
| Shell package `packages/auto` | the `--handover-test` help copy around `src/index.ts` L791 carries the old naming; `README.md` has several flat-path statements (approx. L242-479, L628, L697-706); `test/e2e.test.ts` does **not** assert flat task-doc paths (verified; no change needed) |

### 1.3 Key Invariants (P1 must not break them)

- Exit-code semantics, constitutional-level config, driver-exclusive state writes, unified commits, independent verdict sessions not forking -- none
  of these are involved; P1 is a pure path-equivalent rename + migration.
- **Every session must wrap up fully green**: the session split (§5) ensures each session ends behaviorally self-consistent (S2 completes the whole
  task-doc rename in one pass; an intermediate state like "driver writes path A while the prompt demands path B" must not survive across sessions).
- Templates must keep the `with { type: "file" }` import; new src files need no exports registration; the core must not
  import the shell package.
- The exported names and signatures of `prompt.ts`'s `handoffFile`/`testHandoffFile`/`subtaskOutputFile` are unchanged
  (they delegate to docpaths internally); zero changes to the runner/template call surface.
- Chinese comments and user-visible copy; `bun typecheck` (`tsgo --noEmit`) and `bun test` run in this package's directory.

### 1.4 Verification Commands

```bash
cd packages/auto-core && bun typecheck && bun test
# must run after changing prompt templates:
bun test test/prompt.test.ts
# path-residue check (for wrap-up; expected leftovers: only docpaths/legacy construction points, compatibility cleanup, and comments):
rg -n "\.context\.md|\.subtasks\.md|\.report\.md|\.audit\.md|\.fix\.md|\.handoff\.md|testhandoff\.md|docs/final/" src templates
```

## 2. Path Mapping Master Table (P1's single source of truth)

| Object | Old (flat) | New (P1) | Construction point |
|---|---|---|---|
| Understanding summary | `docs/T-003.context.md` | `docs/T-003/context.md` | `taskDoc(id,"context")` |
| Decomposition checklist | `docs/T-003.subtasks.md` | `docs/T-003/subtasks.md` | `taskDoc(id,"subtasks")` |
| Wrap-up report | `docs/T-003.report.md` | `docs/T-003/report.md` | `taskDoc(id,"report")` |
| Review report | `docs/T-003.audit.md` | `docs/T-003/audit.md` | `taskDoc(id,"audit")` |
| Fix checklist | `docs/T-003.fix.md` | `docs/T-003/fix.md` | `taskDoc(id,"fix")` |
| Context handover | `docs/T-003.handoff.md` | `docs/T-003/handoff.md` | `taskDoc(id,"handoff")` |
| Test handover (task-level) | `docs/T-003.testhandoff.md` | `docs/T-003/testhandoff.md` | `taskDoc(id,"testhandoff")` |
| Test handover (subtask-level) | `docs/T-003-S2.testhandoff.md` | `docs/T-003/S02/testhandoff.md` | `subtaskDoc(id,2,"testhandoff")` |
| Subtask artifact | `docs/T-003/S04.md` | `docs/T-003/S04/index.md` | `subtaskDoc(id,4,"index")` |
| Final-review proposal | `docs/final/plan-audit-r1.md` | `docs/T-F1/plan-audit-r1.md` | `finalDoc(k,name)` |
| Final-review per-stage reports | `docs/final/audit-r1.md` etc. | `docs/T-F<k>/audit-r1.md` etc. | `finalDoc(k,name)` |
| --review final audit | `docs/final-audit.md` | `docs/<当前任务>/audit.md` (P1-D2; <当前任务> = the current task) | `taskDoc(taskId,"audit")` |
| handover / knowledge / archive | - | **P2** (`docs/handovers/`, `R<N>-` prefix, archive reduction) | - |

- Subtask numbers are zero-padded to two digits (`S2 → S02`), carrying naturally into three digits (consistent with the current `subtaskOutputFile`'s
  `padStart(2,"0")` convention).
- **Read fallback (D4)**: read points prefer the new path; new missing while old exists → old; neither present → new (reading empty matches
  current behavior). **The write target is always the new path** (prompts require the AI to write new paths; the driver sweeps both old and new spots).
- Derivation of the final-review anchor `k` is in P1-D1; `docs/T-F1/final-audit.md` is merely the migration landing spot of the old `docs/final-audit.md`
  (filename unchanged; a pure historical archive, never produced anew).

## 3. Settled Decisions (adjudication of implementation ambiguities; S4 writes back to upstream §8)

| # | Decision |
|---|---|
| P1-D1 | **Final-review artifacts are anchored by their producing task**: `k = plan 内带 final 字段任务数 + 1` (k = the number of tasks with the final field in the plan + 1; `finalIndex`). The four same-round stages and cross-round tasks each anchor their own directory: audit-r1@T-F1, refactor/patch-r1@T-F2, validate-r1@T-F3, finalize@T-F4, next round's audit-r2@T-F5 ... routeFinal evaluates before appending, so `(plan, stage, round) → k` holds deterministically (re-evaluation on interrupt recovery yields the same value). Upstream §3.1 lists the five filenames under the `T-F1/` comment as an illustration; this entry prevails. |
| P1-D2 | **The --review final audit merges into the task audit path**: `docs/final-audit.md` → `docs/{{taskId}}/audit.md` (final and non-final share one path; the review.md output-line conditional block is deleted); the old file migrates to `docs/T-F1/final-audit.md` (filename unchanged). |
| P1-D3 | **Migration conflict strategy**: target new path already exists → keep the new file, skip the move, list it in a `⚠` log; never overwrite. |
| P1-D4 | **Reference rewriting derives pairs from "old-path tokens observed in live documents"** (static mapping rules, §4.7) and does not depend on this run's move list -- crash recovery (interrupted after moves, before rewriting) and repeated runs are naturally idempotent. |
| P1-D5 | **knowledge.ts / resume.ts get zero changes in P1**: knowledgeFile's `R<N>-` prefix and handovers/ belong to P2 (upstream §4.3); resume.ts constructs no task-doc paths (a deviation from the upstream §4.1 consumer list). |
| P1-D6 | **dryrun skips the startup migration** (the preflight must not modify the worktree); `--commit false` still migrates, just does not commit. |
| P1-D7 | **PROTOCOL_MARKERS all unchanged**: understand's `context.md` is a substring match and still hits once paths are directory-ized; each session just runs the prompt/template tests to check. |
| P1-D8 | **Generic-shell copy is synced along** (not listed in the upstream P1 checklist, but consistency requires it): the `--handover-test` help copy in `packages/auto/src/index.ts` and the flat-path statements in `packages/auto/README.md` are updated in S4. |
| P1-D9 | **phase-plan.md only injects the doc-layout shared section in P1**; edits/deletions of the A.1 artifact-directory (docs/analysis/ etc.) wording are left to P2. |

## 4. File-Level Specification

### 4.1 `src/docpaths.ts` (new, S1)

The single construction point for task-doc paths (the code-side "three parties agree" is enforced by this module); the file-header comment cites upstream
clauses R1..R7 and the read-fallback semantics (mirroring the `config.ts` `legacyModeFallback` precedent). P1 does not include
`handoverDoc`/`knowledgeDoc`(P2)。

```ts
// Task document roles (R4: role filenames are fixed)
export type TaskRole = "context" | "subtasks" | "report" | "audit" | "fix" | "handoff" | "testhandoff"

const pad2 = (k: number) => String(k).padStart(2, "0")

// -- new-layout constructors (return paths relative to the target directory) --
export function taskDir(id: string): string                                  // docs/T-003
export function taskDoc(id: string, role: TaskRole): string                  // docs/T-003/context.md
export function subtaskDir(id: string, k: number): string                    // docs/T-003/S04
export function subtaskDoc(id: string, k: number, role: "index" | "testhandoff"): string
export function finalDir(index: number): string                              // docs/T-F1
export function finalDoc(index: number, name: string): string                // docs/T-F1/audit-r1.md

// -- old flat layout (shared by read fallback and the migration mapping; naturally dies out once migration completes) --
export function legacyTaskDoc(id: string, role: TaskRole): string            // docs/T-003.context.md
export function legacySubtaskTestHandoff(id: string, k: number): string      // docs/T-003-S2.testhandoff.md
export function legacySubtaskArtifact(id: string, k: number): string         // docs/T-003/S04.md

// -- read fallback (D4): new path exists → new; else old exists → old; else new (reads empty) --
export async function resolveTaskDoc(dir: string, id: string, role: TaskRole): Promise<string>
export async function resolveSubtaskDoc(dir: string, id: string, k: number, role: "index" | "testhandoff"): Promise<string>

// -- stock (existing-file) migration (S4, §4.7) --
export async function migrateLegacyDocs(dir: string): Promise<{ moved: string[]; rewritten: string[] }>
```

### 4.2 `src/refcheck.ts` (new, S1; P1 lands only the two basic functions)

The P1 subset of the reference-consistency layer; `validateRefs`/`renamePairs`/live-document enumeration are left to P4 (noted in the file header).

```ts
export type Ref = { path: string; line?: number; at: number }   // at = the 1-based line number where it occurs

// Extraction rules:
// 1. Lines inside ``` fences are skipped (exemption);
// 2. Lines containing 已删除|已归档|历史 (deleted|archived|historical markers) are skipped (marker-line exemption);
// 3. All other lines: extract tokens from backtick spans (`…`) and md links ([x](…)); after stripping the optional
//    `:行号` (":line-number") tail anchor, a token must contain no whitespace and "contain / or contain ." (path-like) to count as a reference.
export function extractRefs(text: string): Ref[]

// Mechanical rewriting: for each pair, replace with a whole-path word-boundary regex and count --
//   new RegExp(`(?<![-\\w./\\\\])${escapeRegexp(old)}(?![\\w./\\\\-])`, "g")
// (prevents docs/T-1.md from mismatching docs/T-11.md, and prevents truncated half-paths)
export function rewriteRefs(text: string, pairs: Array<{ old: string; new: string }>): { text: string; count: number }
```

### 4.3 `src/prompt.ts`(S2 + S3)

- `handoffFile(task)` → `taskDoc(task.id, "handoff")`;`testHandoffFile(task, subtask?)` →
  `subtask === undefined ? taskDoc(id,"testhandoff") : subtaskDoc(id, subtask, "testhandoff")`;
  `subtaskOutputFile(task, index)` → `subtaskDoc(task.id, index, "index")`. The three keep their exported
  names/signatures/file location; internally they import docpaths (prompt→docpaths stays acyclic).
- `renderFinalTask` (S3): ctx gains `finalTask` (value `T-F${k}`, where k = `plan.tasks.filter(t=>t.final).length+1`
  is derived inside the function); `proposalFile` becomes `finalDoc(k, \`plan-${stage}-r${round}.md\`)`.
- Also sync the old-naming wording in the comments of the three functions and around `Opts.handoverTest`.

### 4.4 `src/runner.ts` consumption points (S2, point by point)

| # | Location | Change |
|---|---|---|
| 1 | `runTask` handedOff check (approx. L317) | the read changes to `join(dir, await resolveTaskDoc(dir, task.id, "handoff"))` |
| 2 | `testHandoffExists` (approx. L1607) | rewritten: (1) task-level `taskDoc`/`legacyTaskDoc` two exists checks; (2) subtask-level scope enumeration `new Bun.Glob(join("docs", task.id, "**", "testhandoff.md")).scan({cwd: dir})` (** matches zero segments, covering the task-level file of the same name); (3) the compatibility-period old-flat `docs/<id>-S*.testhandoff.md` prefix scan is kept (replacing the original `startsWith` implementation with glob/prefix coexisting; semantics unchanged, scope narrowed to this task) |
| 3 | `pipeline` auto-branch stale cleanup (approx. L402) | after rm of the new path, append `rm(join(dirname, legacyTaskDoc(task.id,"handoff")), {force:true})` |
| 4 | `cleanTestHandoffs` (approx. L1618) | rm task-level new+old; subtask-level enumeration `docs/<id>/S*/testhandoff.md` + compatibility old-flat `docs/<id>-S*.testhandoff.md` (replacing the startsWith scan) |
| 5 | `pipeline` ondemand-branch handoff rm (approx. L412) | same as #3 |
| 6 | `pipeline` fixFile (approx. L449) | construction changes to the relative path with `taskDoc(task.id,"fix")` semantics; reads go through `resolveTaskDoc` |
| 7 | `executeWhole` (approx. L580) | `file` write target = new path; three reads (prior/status checks) go through resolve; messages reference the `handoffFile(task)` value (automatically new) |
| 8 | `ensureUnderstood` (approx. L797) | `file = join(dirname, taskDoc(task.id,"context"))`; two reads via resolve; block messages reference the new path |
| 9 | `ensureForkBase` digest read (approx. L924) | via `resolveTaskDoc(dir, task.id, "context")` |
| 10 | `ensureDecomposed` (approx. L972) | `taskDoc(id,"subtasks")`; two reads via resolve |
| 11 | `runSubtask` (approx. L1042) | two handoff reads via resolve; after completion rm new+old handoff and `testHandoffFile(task,index)` new+old (`legacySubtaskTestHandoff`) |
| 12 | `runExecSession` (approx. L1562) | `TestRun.handoffFile` = new path (the session's write target); continuation seeding reads via `resolveSubtaskDoc` (`resolveTaskDoc` when there is no subtask) |
| 13 | `planReviewFix` (approx. L1414) | `file = join(dirname, taskDoc(task.id,"fix"))`; reset/collect use the same path (collect read via resolve) |
| 14 | Comments | the `docs/<id>[-S<n>].testhandoff.md` wording in the `Opts.handoverTest`, `TestRun`, and handover-loop comments → new naming |

### 4.5 `src/final.ts`(S3)

- Add `export function finalIndex(plan: Plan): number` (`finals.length + 1`);
  `appendFinalTask`'s id counting reuses it (the two places are bound to one convention, preventing drift).
- `finalProposalFile(stage, round, index)` / `finalReportFile(stage, round, remediate?, index)`
  → internally `finalDoc(index, name)`.
- `routeFinal`/`stageRoute`/`afterAudit`/`afterRemediate`/`afterValidate`/`generateFinalTask`
  each call site passes `finalIndex(plan)`; prior copy references the `finalReportFile` return value (automatically the new path).

### 4.6 `src/numbering.ts` taskNumberFloor(S2)

- Kept: the current PLAN.md, `docs/phases/**/PLAN.md`, and the old flat glob `docs/**/T-*.md` (compatibility period,
  covering `docs/T-005.subtasks.md` and the archived `docs/phases/m-migrate/T-020.handoff.md`).
- Added: the glob `docs/**/T-*/*.md` (covering `docs/T-003/context.md` and the archived
  `docs/phases/m-migrate/T-003/report.md`); from each relative path take the first segment matching `/^T-\d+$/`
  into `seen`; `T-F<k>` segments are naturally filtered out by `taskNumber`.
- Comments (approx. L37-40) are synced to the dual-layout wording.

### 4.7 Stock (existing-file) auto-migration and the run hook (S4)

`migrateLegacyDocs(dir)` algorithm (idempotent; missing docs/ → empty result):

```
① Flat task documents: docs/ top-level filenames matching
   /^T-(\d+)\.(context|subtasks|report|audit|fix|handoff|testhandoff)\.md$/ → taskDoc
   /^T-(\d+)-S(\d+)\.testhandoff\.md$/ → subtaskDoc(id, k, "testhandoff")
② Old subtask artifacts inside task directories: under docs/T-<id>/, /^S(\d+)\.md$/ → subtaskDoc(id, k, "index")
③ Old final-review paths: docs/final-audit.md → finalDoc(1,"final-audit.md");
   docs/final/*.md → finalDoc(1, <original filename>) (the empty directory is deleted once emptied)
   Each step: target already exists → ⚠ log, keep the new file and skip (P1-D3); otherwise mkdir the parent directory + rename
④ Live-document reference rewriting (P1-D4): walk docs/**/*.md, excluding docs/phases/**
   For each file, derive pairs from the old-path tokens in its text via the §2 mapping (seven-role flat / -S<k>.testhandoff /
   S<kk>.md old artifact names / final-audit.md / final/<name>.md), replace via rewriteRefs, write back when count>0
Return { moved, rewritten } (lists of relative paths)
```

`src/loop.ts` `runAll` hook: insert at the head of the try block, before the "phased-flow preflight" comment section (the snippet below keeps its Chinese runtime strings verbatim: the log line means "legacy task-doc migration to directories: moved N items, rewrote M live-document reference files"; the commit title/subject means "task-doc directory migration"):

```ts
// Stock task-doc directory migration (stable-refs P1): flat old layout → docs/T-NNN/; idempotent,
// skipped for the dryrun preflight, which must not modify the worktree (P1-D6).
if (!opts.dryrun) {
  const migrated = await migrateLegacyDocs(directory)
  if (migrated.moved.length || migrated.rewritten.length) {
    log(`↻ 存量任务文档目录化迁移: 搬移 ${migrated.moved.length} 项,活文档引用改写 ${migrated.rewritten.length} 个文件`)
    if (opts.commit !== false) {
      await commitTree(directory, { id: "PLAN", title: "任务文档目录化迁移" }, { stage: "doc-migrate", subject: "PLAN doc-migrate 任务文档目录化迁移" })
    }
  }
}
```

`src/git.ts`: add `doc-migrate` to the pseudo-task stage label list in the `message()` comment.

### 4.8 Templates and `_partials.md` (file by file; S2 rows / S3 rows)

`_partials.md` gains a shared section (section name `doc-layout`, **containing no template variables** -- templates without a
taskId, such as phase-plan, must reference it too; the body below is the literal template text, kept verbatim -- gist: every task's documents live in docs/T-NNN/ role files and docs/T-NNN/S<NN>/index.md, paths are permanent once created, and no flat task files may be created at the docs/ top level):

```
## doc-layout
文档存放规范: 每个任务(T-NNN)的全部文档写入该任务自己的目录 docs/T-NNN/ 内(理解摘要
context.md、分解检查项 subtasks.md、收尾报告 report.md、审核报告 audit.md、修复检查项
fix.md);子任务产物写入 docs/T-NNN/S<两位序号>/index.md,子任务级测试交接写同目录
testhandoff.md。这些路径一经创建即为永久路径——不移动、不改名;引用其他任务的文档时
一律使用其 docs/T-NNN/… 永久路径,不要在 docs/ 顶层另建平铺任务文件。
```

| Template | Literal changes | doc-layout | Session |
|---|---|---|---|
| understand.md | `docs/{{taskId}}.context.md` → `docs/{{taskId}}/context.md` | ✓ | S2 |
| decompose.md + decompose-{a,d,m,t,v,k}.md (7 files) | `docs/{{taskId}}.subtasks.md` → `docs/{{taskId}}/subtasks.md` | ✓ | S2 |
| subtask.md | warm/cold, two spots: `docs/{{taskId}}.context.md` → directory-ized | ✓ | S2 |
| context-base.md | `docs/{{taskId}}.context.md 全文` (full text) → directory-ized | - (minimal confirmation session) | S2 |
| handoff-steer.md | no literal paths (via the `{{handoffFile}}` variable) | - | S2 (check) |
| test-result / test-handover / test-continue | no literal paths (via variables) | - | S2 (check) |
| wrapup.md | `docs/{{taskId}}.report.md` → directory-ized; `docs/{{taskId}}/S<NN>.md` → `docs/{{taskId}}/S<NN>/index.md` | ✓ | S2 |
| verify-judge.md | `docs/{{taskId}}.report.md` → directory-ized | - | S2 |
| review.md | `docs/{{taskId}}.report.md` → directory-ized; the output line merges into `docs/{{taskId}}/audit.md` (P1-D2, the final conditional block deleted) | ✓ | S2 |
| review-fix.md | audit.md ×2, fix.md ×2 → directory-ized | ✓ | S2 |
| phase-plan.md | no literal task paths; only injects `{{> doc-layout}}` (P1-D9) | ✓ | S2 |
| number-recovery.md | the evidence list switches to dual layout: "docs/ 下的任务产物(T-NNN/<用途>.md 与 T-NNN/S<NN>/index.md,如 T-001/subtasks.md;旧平铺 T-NNN.<用途>.md 与归档目录内的同样有效)" (task artifacts under docs/ -- T-NNN/<role>.md and T-NNN/S<NN>/index.md, e.g. T-001/subtasks.md; old flat T-NNN.<role>.md and those inside archive directories are equally valid) | ✓ | S2 |
| final-task.md | 5 spots `docs/final/…` → `docs/{{finalTask}}/…` (audit-r/refactor-r/patch-r/validate-r/finalize) | ✓ | S3 |

`templates/PLAN.md`, `templates/.opencode/agent/auto.md`, and `templates/modes/` contain no task-document
path literals (verified); leave them unchanged.

### 4.9 Explicit No-Change List (to prevent sessions from over-scoping)

`src/knowledge.ts`, `src/resume.ts`, `src/phases.ts` (snapshot/archive chain = P2), `src/check.ts`
(P4 extension), `src/verify.ts`, `src/protect.ts`, `src/loop.ts`'s `ensurePointer` (refs
marker block = P4), `plans/0006-phases-design.md` (P2 revision), and the shell-package e2e. After S2 lands, the `rg` check (§1.4)
leaves only docpaths' legacy construction, runner's compatibility cleanup/read fallback, and comments.

## 5. Session Split (each session independently wraps up fully green)

### P1-S1 Foundation layer: docpaths + refcheck (P1 subset)

- **Prerequisite**: none (first session).
- **Changes**: add `src/docpaths.ts` (§4.1, without migrateLegacyDocs) + `src/refcheck.ts`
  (§4.2) + `test/docpaths.test.ts` + `test/refcheck.test.ts`. Zero consumers, zero behavior change.
- **Tests**: constructor naming (incl. pad2 and three-digit carry), resolve's three states (new present / old present / neither),
  finalDir/finalDoc; extractRefs (fence exemption, marker-line exemption, backtick/md links, `:行号` (":line-number") tail,
  non-path tokens ignored), rewriteRefs (word-boundary hit / no prefix mismatch / counting).
- **Wrap-up**: §0's three wrap-up steps; suggested commit `feat(refs): docpaths/refcheck 基础层(P1-S1)`.

### P1-S2 Task-doc directory-ization (the core behavior-equivalent rename)

- **Prerequisite**: S1 merged.
- **Changes**: `src/prompt.ts` (the three constructors delegating + comments), `src/runner.ts` (all 14 points of §4.4),
  `src/numbering.ts` (floor dual scan), all template S2 rows (incl. the `_partials.md` doc-layout section and
  the phase-plan/number-recovery injection and wording).
- **Test updates**: `test/prompt.test.ts` (the full set of path assertions: subtasks/context/handoff/
  testhandoff(`-S2` → `/S02/`)/`S01.md` → `S01/index.md`/report/audit/fix/final-audit →
  task audit, not-contains assertions synced), `test/runner.test.ts` (handoffSteer copy,
  ensureForkBase fixture on the new layout + new legacy-fallback cases), `test/numbering.test.ts` (floor
  new cases: directory-ized artifacts, directory-ized artifacts inside archives, old-flat compatibility retained), `test/template.test.ts`
  (doc-layout section presence and reference rendering).
- **Wrap-up**: §0's three steps + the §1.4 residue rg check; suggested commit
  `feat(refs): 任务文档目录化与读回落(P1-S2)`.

### P1-S3 Final-review artifact task anchoring

- **Prerequisite**: S2 merged (no file conflicts with S2; review.md was already finished in S2).
- **Changes**: `src/final.ts` (§4.5), `src/prompt.ts` renderFinalTask (finalTask ctx),
  `templates/prompts/final-task.md` (the §4.8 S3 row).
- **Test updates**: `test/final.test.ts` (finalProposalFile/finalReportFile new signatures and paths,
  finalIndex, routeFinal fixture reports written to the new paths), the final-review section of `test/prompt.test.ts`
  (`docs/T-F1/plan-audit-r1.md` etc., finalTask rendering, no `docs/final/` residue).
- **Wrap-up**: §0's three steps + `rg "docs/final/" src templates` leaving only the migration mapping (before S4, docpaths
  may legitimately lack this string); suggested commit `feat(refs): 终审产物任务锚定(P1-S3)`.

### P1-S4 Stock (existing-file) migration + doc wrap-up

- **Prerequisite**: S3 merged.
- **Changes**: `src/docpaths.ts` gains `migrateLegacyDocs` (§4.7) + the `src/loop.ts` hook +
  the `src/git.ts` comment + doc write-back (§7) + `packages/auto/src/index.ts` help copy +
  `packages/auto/README.md` path wording (P1-D8).
- **New tests** (merged into `test/docpaths.test.ts` or a new `test/migrate.test.ts`): flat → directory-ized,
  `-S2` → `S02/testhandoff`, `S04.md` → `S04/index.md`, final old paths → T-F1, live-document reference
  rewriting (backticks/links/word boundaries/fence and marker-line exemptions), idempotence (second run is a no-op), conflict keeps the new file,
  crash-recovery semantics (residual old-reference tokens alone still get rewritten).
- **Wrap-up**: §0's three steps; tick the upstream §5 P1 checklist and write back upstream §7 progress and §8 deviations (P1-D1/D2/D5/D8);
  suggested commit `feat(refs): 存量迁移与文档收口(P1-S4)`; record the end-to-end smoke run in the §8 notes
  (executed by an integration session in the auto/ worktree).

## 6. Test Plan Summary

New: `test/docpaths.test.ts` (constructors/resolve/migration), `test/refcheck.test.ts`.
Updated: `test/prompt.test.ts`, `test/runner.test.ts`, `test/numbering.test.ts`,
`test/final.test.ts`, `test/template.test.ts`. Not updated: `test/phases.test.ts`,
`test/knowledge.test.ts`, `test/git.test.ts` (comments only), and the shell-package e2e.

## 7. Doc Write-Back Checklist (S4)

- `plans/0010-stable-refs-design.md`: tick each §5 P1 item; §7 progress row (date/commit/verification); §8 append
  P1-D1/D2/D5/D8 deviation notes; at the §3.1 `T-F1/` comment add "各终审任务锚定自己的 docs/T-F<k>/" (each final-review task anchors its own docs/T-F<k>/).
- `docs/behavior.md`: add an entry titled "任务文档路径契约(P1)" (task document path contract (P1)) covering (the directory-ized layout, read fallback, startup migration
  doc-migrate, dryrun skip); sync the path wording of the unified-commit label list, --review, --test-by-driver, and subtask
  three tiers, the task pipeline, and the final-review loop entries.
- `docs/structure.md`: new entries for `src/docpaths.ts` and `src/refcheck.ts`; sync the path wording of the prompt/runner/
  numbering/final/loop entries; check the templates entry.
- Package `AGENTS.md`: add a pointer to this file in the stable-references navigation line.
- `packages/auto`: README + index.ts help copy (P1-D8).

## 8. Session Progress Table

| Session | Scope | Status | Date | Commit | Verification |
|---|---|---|---|---|---|
| P1-S1 | docpaths + refcheck foundation layer | Done | 2026-09-07 | pending commit feat(refs): docpaths/refcheck 基础层(P1-S1) | typecheck + test green |
| P1-S2 | task-doc directory-ization (core) | Done | 2026-09-07 | pending commit feat(refs): 任务文档目录化与读回落(P1-S2) | typecheck + test green; §1.4 residue rg leaves only legacy/compat/comments |
| P1-S3 | final-review artifact task anchoring | Done | 2026-09-07 | pending commit feat(refs): 终审产物任务锚定(P1-S3) | typecheck + test green; rg docs/final/ leaves only the phases.ts comment (P2) |
| P1-S4 | stock (existing-file) migration + doc wrap-up | Done | 2026-09-07 | pending commit feat(refs): 存量迁移与文档收口(P1-S4) | this package 340 pass; shell package typecheck + test 27 pass (P1-D8 copy synced) |
| Integration smoke | auto/ worktree, all three packages in full + manual smoke (new task artifacts land in docs/T-NNN/, flat stock gets migrated, live-document references get rewritten) | Not started | - | - | - |

Implementation notes (deviations defer to the implementation):

- rewriteRefs, like extractRefs, acts only on candidate lines (fence and marker-line exemptions) -- so the S4 migration
  tests' "fence and marker-line exemption" lands in the same primitive; §4.2's "mechanical rewriting" is implemented with this convention.
- numbering's directory-ized scan glob is `docs/**/T-*/*.md` (path segments taken from files directly under the task directory);
  deeper files like `docs/T-NNN/S<kk>/index.md` follow the same convention as the old layout and never participate in the floor anyway (task
  numbering is covered by the role files in the same directory).
- template.test.ts once failed after file-order changes due to global pollution of the registration surface (dryrun registrations leaking across files);
  it was fixed by restoring the built-in copy in the registration test's finally (a test-hygiene fix, not a behavior change).

## 9. Risks and Rollback

- **Intermediate-state compatibility**: after S2 lands and before S4, flat documents in old projects work entirely via read fallback -- S2 must ensure every
  read point goes through resolve (checked against the §4.4 list); all write points use the new paths, so behavior is self-consistent. When S1..S4 are released externally as one merge
  window, this intermediate state never appears.
- **e2e**: shell-package e2e does not assert task-doc paths (verified 2026-09-06); if a run reveals an assertion, update it to the new paths
  and note it in §8.
- **`.auto/phase-snapshot.json`**: migration precedes this phase's snapshot (within one run, planPhase comes after the hook),
  and mid-round upgrades move the archive by relative path -- no special handling needed.
- **`--no-auto-number` projects**: directory-ization is unrelated to numbering uniqueness (upstream §8); no branching.
- **Rollback**: each session is an independent commit, so `git revert` of a single session's commit suffices; migration is rename + text rewriting,
  idempotent and manually reversible.

<!-- auto: eof -->

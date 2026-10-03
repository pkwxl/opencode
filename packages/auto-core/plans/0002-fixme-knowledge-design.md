# --track-fixme Design Deviation Tracking and --extract-knowledge Migration Knowledge Distillation — Design Notes

> This document is the sole design baseline for the two CLI capabilities `--track-fixme` and
> `--extract-knowledge`, revised from the "CLI Extension Requirements Specification: Design Deviation Tracking
> and Migration Knowledge Distillation" (hereafter "the requirements specification"). Implementation tasks follow
> this document; where it conflicts with the requirements specification, this document prevails (each conflict is
> justified item by item in the §2 mapping table and the §3 decision table). `--extract-knowledge` has, per the P4
> revision below, been merged into the k (knowledge distillation) phase of `--phases` and implemented; `--track-fixme`
> was never implemented (census: 0 hits across src, test, templates, and the shell; no CLI flag was ever shipped) and is permanently blocked by the completion-side retirement of `plans/0044` D1 (0069 §3.1 rules it a hard deprecation), no longer left for future sessions (status correction 2026-10-02, `plans/0069` §4.2 A2).

> **Revision (baseline change)**: the `--final-review` final-review task now forcibly skips task-level three-stage
> acceptance and no longer writes the verify field (final review does not re-verify verification; report-protocol anomalies
> are backstopped by the routing-time brokenReport block). Conflicting descriptions in this document are void accordingly -
> the §3 "audit task verify" row, §4.1's "verify structure-check extension", §C.3's appendFinalTask verify extension, and
> §C.4's self-healing path for a "report missing the FIXME line" no longer exist; a missing/invalid FIXME protocol line
> uniformly goes through the routing-time brokenReport block for manual inspection, and P1..P4 implementation adjusts to this baseline.

> **Revision (P4 merged into the phased pipeline)**: `--extract-knowledge` has been **wholly claimed** and implemented
> by the k (knowledge distillation) phase of `--phases` (plans/0006-phases-design.md sections D.4/J, item P4); the CLI
> option no longer exists separately. §D's mapping onto the k phase:
> - Trigger hook (§D.2) → in the k phase, the plan routing (PLAN.md empty-template state) goes directly into the
>   knowledge-extraction side session, opening no planning session and filling no tasks into PLAN.md; when a human fills
>   tasks into PLAN.md themselves during the k phase, the generic execute/handover routing applies and the extraction hook does not trigger (manual-takeover semantics);
> - Source list (§D.3) changed to the phased artifacts: the phase ledger `docs/phases.md` and each phase's archive
>   directory `docs/phases/<字母>-<名称>/` (<letter>-<name>; read handover.md first and closely, consume the raw artifacts
>   via their artifact index) - the earlier raw docs/ were archived at handover, so the original locations `docs/*.report.md`,
>   `docs/final/` etc. no longer exist;
> - In the section skeleton, Design Deviations now takes AUTO-DECISION annotations as its source (`--track-fixme`
>   was not merged in, so the Final Status audit field is absent along with it; it can be wired back once track-fixme lands);
> - Failure semantics (§D.5) unchanged: extraction failure is only a ⚠ warning, the exit code is unaffected, and the k phase hands over as usual;
> - The "knowledge documents are not auto-committed" decision is retired along with the option: as a k-phase artifact, the
>   knowledge document is committed with the session's unified commit and archived into the repository at handover (the
>   unified commit takes commit authority back from the AI, git history is the audit trail, and manual vetting becomes
>   follow-up revision of already-committed documents); the `--extract-knowledge=<path>` explicit path accordingly no longer exists, while the default path `docs/migration-kb/migration-<时间戳>.md` (timestamp) is unchanged;
> - Recovery paths: interrupted before handover → idempotently skip the already-produced document (any non-empty .md in
>   the directory counts as already extracted); retrying after handover completes → the manual rollback procedure (delete the ledger's k row and the archive directory, then rerun).
> In the §H phasing, the P3/P4 parts of this capability are complete per the mapping above; `--track-fixme` is unaffected and
> remains to be implemented per §H P1/P2.

## Background and Motivation

1. **Making deviations explicit**: migrate mode requires the new implementation to be behaviorally equivalent to the old,
   but real migrations always produce forced trade-offs that "cannot fully follow the established design/original interface".
   Today these can only scatter across `AUTO-DECISION` lines or report prose - unscannable, uncountable, and unfocused at
   final review. `--track-fixme` turns deviations into structured anchors in the code (`AUTO-FIXME`), deterministically
   scanned by the driver at the final-review audit stage and verified and graded item by item by the audit session, with CRITICAL deviations blocking the pipeline pending manual review.
2. **Knowledge distillation**: the API mappings, pitfalls, and reusable rules produced by a migration currently live only in
   session context and process reports, beyond reuse by the next migration. After the final-review loop passes,
   `--extract-knowledge` has a one-shot side session distill the **finally verified** migration experience into a
   structured Markdown knowledge document; extraction failure does not contaminate the migration result itself.

## 1. Relation to the Current State (Invariants)

- Both options are **optional capabilities**; by default they do not affect the existing pipeline at all.
- **Zero newly persisted state**: FIXME entries are factual records in code comments, not a state machine; the audit routing
  reuses `routeFinal`'s pure-function evaluation of "(tasks tagged final and their statuses, docs/final/ artifacts)";
  knowledge extraction writes nothing to `.auto/progress.json` (a one-shot side session, requireArtifact skeleton).
- **Scan execution authority stays with the driver** (same origin as the verify three-stage flow): the driver's local
  deterministic scan produces `tmp/fixme-scan.md`, and the audit session only reads it to judge/adjust grades - neither blindly trusting self-reports nor letting the session run scan commands.
- **The global single-session invariant holds**: the FIXME scan is a purely local process (no session opened); audit/gates
  all hang on the existing serial flow, with no parallel window and no worktree needed.

## 2. Requirements Specification → Repository Terminology Mapping

| Concept in the requirements specification | Counterpart in this repository |
| --- | --- |
| Planning | the PLAN.md produced by `init -p` (renderInit) |
| Implementation | the runTask execution chain (auto: decompose → subtask sessions; off, ondemand: whole-task sessions) |
| Review | `--review` per-task quality review (reviewTask, REVIEW_FILE) |
| Audit | the audit task of the `--final-review` final-review loop (`T-F<k>`, `final: audit@<r>`) |
| Final Review | the `--final-review` loop as a whole (audit→remediate→validate→finalize) |
| Migration Completed | all PLAN tasks done (including the final-review tasks) |
| Pipeline BLOCKED | `block()` writes into PLAN.md + exit code 2 |
| FixmeParser/FixmeScanner | `src/fixme.ts` pure-logic module (mirrors the verify.ts/check.ts shape) |
| FixmeAudit | the session-side duty of the audit task (renderFinalTask audit branch) + the parseFixmeSummary gate in `routeFinal` |
| `.artifacts/audit/fixme.json` | `tmp/fixme-scan.md` (driver working directory, gitignored); the persistent anchor is the audit report `docs/final/audit-r<N>.md` |
| KnowledgeExtractor (three-piece set) | a single one-shot side session renderKnowledge (requireArtifact skeleton, mirroring generateFinalTask); no Collector/Synthesizer/Writer object layer is split out |
| `docs/migration-kb/<task_id>.md` | `docs/migration-kb/migration-<时间戳>.md` (timestamp; this package's migration unit is the whole PLAN, not a single task; see §3) |

## 3. Confirmed Decisions

| Decision point | Conclusion |
| --- | --- |
| CLI form | `--track-fixme` boolean option (BOOLEAN_FLAGS); `--extract-knowledge[=<path>]` optional value with a dedicated parsing branch (mirrors the `-p` value-swallowing rule, but does not swallow when the next token starts with `-`, avoiding eating a following option; the `=` form is naturally supported) |
| Dependencies | **both must be paired with `--final-review`**, otherwise a usage error with exit code 1 (mirrors the existing precedent of `--early` requiring `--review`). Rationale: the host of FIXME auditing is the final-review audit task, and the pass gate of knowledge extraction is completion of the final-review loop; standalone forms without the host are listed as future extensions (§4) |
| FIXME carrier | anchors in code comments with a uniform four-line format (§A); no separate state file/database/lifecycle |
| Scan scope | full scan of the target directory: each git root (including nested repos, reusing loop.ts's root-discovery logic) via `git ls-files --cached --others --exclude-standard`; non-git directories fall back to filesystem traversal (skipping `.git`/`node_modules`/`tmp`/`.auto`, binary and oversized files). **The "git baseline diff from run start" approach is not adopted** - `--commit subtask/task` clears working-tree state before the audit, a baseline would need a new persisted file, violating the zero-new-state principle; the cost of a full scan (possibly picking up historically leftover FIXMEs) is acceptable: they are unresolved deviations anyway, discovered by the first audit round and handled manually |
| Report protocol extension | with track-fixme on, the last three lines of the audit report are fixed as `结论: <概述>` (conclusion: overview), `策略: 重构\|修补\|无` (strategy: refactor, patch, or none), and `FIXME: CRITICAL=<n> WARN=<n> INFO=<n>` (n is the final post-audit-adjustment count); the driver adds `parseFixmeSummary`, parsing in the style of parseStrategy |
| CRITICAL gate (after audit) | report count CRITICAL≥1 → `block()` the audit task, exit code 2, **no remediate routing** - the deviation is "known and forced", automatic-repair semantics do not hold, and the requirements specification requires manual review; continue after a manual downgrade (edit the comment's Severity and rerun) or after fixing the deviation |
| Second gate (before finalize) | the two finalize routes afterAudit (策略: 无, strategy: none) and afterValidate (passed) share `finalGate`: rescan once, CRITICAL≥1 → fall back to `audit@<r+1>` (focused on the new CRITICAL list, bounded by the `--final-review` audit-round limit, circuit-breaking when exhausted) - covering deviations newly introduced by remediate/fix rounds after the last audit; the audit session after the fallback re-verifies the self-reported grades, and if still CRITICAL it goes through the gate in the previous row |
| malformed FIXME | markers that fail to parse (missing Severity line/broken format) do not block and are not counted in the three tiers; they are listed separately as MALFORMED; the audit reports them as WARN-level findings prompting comment-format fixes (requirements specification §16) |
| audit task verify | **(voided by the final-review baseline revision)** final-review tasks no longer write the verify field and do no task-level acceptance; a missing/invalid FIXME protocol line is uniformly blocked at routing time as brokenReport for manual inspection, with no fix-round self-healing |
| Knowledge trigger gate | extraction only after the final-review loop completes (routeFinal complete); the circuit-break/block/exit-code-2 paths never pass the extraction hook → the requirements specification's TC-08 (SKIPPED) holds by construction, with no "skip after FAIL" branch to get wrong |
| Knowledge failure semantics | two failures to produce by the session (requireArtifact exhausted) → print a ⚠ warning (`knowledge_extraction_error` recorded in the run log), **exit code stays 0**; migration success is not contaminated in return by document-generation failure (requirements specification §16) |
| Knowledge document commit | **no auto-commit**: the extraction hook sits after the `--commit once` bulk commit, so under every commit mode the knowledge document stays a working-tree file and enters the repository only after manual vetting (consistent with the principle that "knowledge must be verified") |
| Default path | `docs/migration-kb/migration-<时间戳>.md` (timestamp), the timestamp in the same form as `.auto/logs/run-<时间戳>.log` (`log.ts setLogFile` format); `--extract-knowledge=<path>` overrides explicitly (relative to the target directory) |
| Data-model forward compatibility | the parser ignores unknown keys (e.g. `Status:`) and unknown TYPEs, reserving room for the Deviation Record evolution suggested by the requirements specification (§F); V1 does not implement its semantics |

## 4. Scope This Round and Future Extensions

### 4.1 Implemented This Round

1. `src/fixme.ts`: AUTO-FIXME parser + target-directory scanner + scan-report writing (pure logic, zero dependencies);
2. `--track-fixme`: injection of the marker spec into execution prompts → audit-task integration (scan-and-inject before
   generation, report protocol lines) → the CRITICAL gate and the second gate before finalize;
3. `--extract-knowledge`: CLI parsing + the side extraction session after final review completes + default/explicit paths +
   failure not contaminating the exit code;
4. Tests (§J) and README / in-package AGENTS.md documentation.

### 4.2 Future Extensions (Explicitly Not Done This Round, with Reasons)

| Item | Reason/prerequisite |
| --- | --- |
| `--fixme-fail-on=WARN` custom blocking policy | requirements specification §17 already lists it as a non-goal; the protocol line already carries per-tier counts, and the extension only changes the gate comparison |
| FIXME lifecycle state machine (Accepted/Fixed/Rejected semantics, standalone store, Web UI, auto-close/fix/merge) | requirements specification §17; the V1 data model already reserves parsing tolerance for unknown keys such as `Status:` (§F) |
| FIXME awareness (dimension injection) in `--review` per-task review sessions | deviations found in the per-task window → should convert into added markers rather than gaps, semantics need separate design; in V1 deviation convergence is uniformly pressed into final review |
| a standalone form of `--track-fixme` without `--final-review` (driver scan + print + gate, no LLM verification) | dual-path cost; the grade verification of the audit session (false-positive removal, up/downgrading) is the requirements specification's core value, and a standalone form has no host |
| `--extract-knowledge` without `--final-review` (gated on "all tasks done + per-task verify passed") | the requirements specification explicitly requires Final Review PASS; relaxing the gate requires first defining "verification sufficiency without final review" |
| knowledge-extraction strict mode (failure changes the exit code) / KB auto-commit / cross-task knowledge merging, recommendation, Embedding, knowledge graph | requirements specification §17 lists all of these as non-goals |
| incremental scan (git baseline at run start, covering nested repos) | requires a persisted baseline state file, violating zero new state; a full scan is acceptable at migration-project scale |
| `fixme.json` machine-readable artifact | allowed by the requirements specification; the internal FixmeRecord is already structured and tmp/fixme-scan.md already contains all fields |
| adding a knowledge copy section to ModeSpec | V1 reuses `mode.exec` as the scenario-background injection, the registration surface unchanged |
| adding a FIXME principles block to AGENTS.md / a check subcommand scanning for violation descriptions | marking is a session-side duty (sessions write comments anyway), and prompt injection already covers every execution session; no need to push it down into init |

## A. AUTO-FIXME Marker Specification (Prompt-Level Contract)

### A.1 Format

```text
// AUTO-FIXME [<TYPE>]: <偏差简述>
// Spec: <参照文档、原始设计或原接口的具体位置>
// Rationale: <偏离原因>
// Severity: <CRITICAL | WARN | INFO>
```

- Anchor line `AUTO-FIXME [<TYPE>]: <简述>` (brief deviation summary); TYPE missing or unknown → recorded as `UNKNOWN`
  (lenient parsing, future extensions do not break old code - requirements specification §3.2);
- Subsequent lines attach to the nearest anchor as `Spec:` / `Rationale:` / `Severity:` key lines (reference location /
  deviation reason / severity tier); full-width colons are tolerated (consistent with the last-line protocol parsing
  style); **unknown keys (e.g. `Status:`) are ignored**, forward-compatible with Deviation Record evolution;
- Lenient comment prefixes: strip a leading `//`, `#`, `--`, `*`, `;`, `%`, `<!--` before matching
  (covers C-family/Shell/SQL/block-comment continuation lines);
- `Severity` missing or its value outside the three tiers → recorded in the **malformed** list (parseable fields kept),
  not counted in the three tiers, no blocking; the audit reports it as a WARN-level finding prompting a fix;
- Do not mark what is not a "design deviation" (requirements specification §4.2, injected verbatim into the prompt):
  ordinary TODOs, unimplemented items whose phase has not arrived, compile warnings, style differences, semantically equivalent free choices, ordinary comments.

### A.2 Severity and Gate Semantics (This Repository's Rendering of Requirements Specification §3.3)

| Scan/report result | audit task | pipeline |
| --- | --- | --- |
| no records (the report writes the all-zero line) | routes by strategy as usual | continue |
| INFO only | pass (report includes the list) | continue |
| contains WARN | pass (report includes the list) | continue (with strategy refactor/patch it still enters the remediate loop as usual; WARN does not block the loop) |
| contains CRITICAL | block (the audit task, exit code 2) | blocked, manual review |
| malformed | pass | continue (the report prompts fixes as WARN-level findings) |

### A.3 Relation to AUTO-DECISION (Stated Explicitly in the Prompt)

- `AUTO-DECISION` (pre-existing; migrate exec copy and QUESTION_RULE/AUTO_ANSWER): records the
  **decision process** - why B over A; recorded even when no deviation exists;
- `AUTO-FIXME` (this design): a structured anchor for a **known deviation from the established design/original
  implementation**, scannable, countable, verifiable at final review;
- with track-fixme on, when a migration trade-off constitutes a deviation, both are written: the decision record goes
  into docs/comments, and the deviation anchor lands at the corresponding code in the four-line format.

## B. `src/fixme.ts` — Parsing and Scanning (Pure Logic)

Mirrors the verify.ts / check.ts shape: no dependency on the SDK or the runner, independently unit-testable.

```ts
export type FixmeSeverity = "CRITICAL" | "WARN" | "INFO"
export type FixmeRecord = {
  type: string        // unknown TYPE kept as-is; missing recorded as "UNKNOWN"
  message: string     // the anchor line's brief summary
  spec: string        // the Spec: line (may be absent)
  rationale: string   // the Rationale: line (may be absent)
  severity?: FixmeSeverity  // missing/invalid → classified as malformed
  file: string        // relative to the target directory
  line: number        // anchor line number (1-based)
}
export type MalformedFixme = { file: string; line: number; text: string; reason: string }

// single-file text → records + malformed (parsing rules in §A.1)
export function parseFixmes(text: string, file: string): { records: FixmeRecord[]; malformed: MalformedFixme[] }

// target-directory scan (scope rules in §3 "Scan scope"); files that fail to read are skipped and summarized as a note
export async function scanFixmes(dir: string): Promise<{ records: FixmeRecord[]; malformed: MalformedFixme[]; scanned: number; skipped: string[] }>

// write the scan result wholesale to tmp/fixme-scan.md (overwriting; direct-read input for the audit session and the knowledge-extraction session)
export async function writeFixmeScan(dir: string, scan: Awaited<ReturnType<typeof scanFixmes>>): Promise<string>
```

- Scan report `tmp/fixme-scan.md` structure: a header count line (Total/CRITICAL/WARN/INFO/
  MALFORMED), per-record entries (`[SEVERITY] file:line` + the Type/Spec/Rationale verbatim),
  a malformed list, skipped notes - the fields cover the seven-field requirement of requirements specification §5.1;
- File enumeration: extract loop.ts's nested-git-root discovery logic into a shared function (`gitRoots`),
  shared by `gitChangedFiles` (verbose watch) and `scanFixmes`; each root lists files with
  `git ls-files --cached --others --exclude-standard -- .`; when the target directory is in no
  git repository, fall back to filesystem traversal (skipping the directories listed in §3 and files >1MB).

## C. `--track-fixme` Integration

### C.1 CLI(`src/index.ts`)

- Goes into BOOLEAN_FLAGS (supports turning it off via `--track-fixme false`);
- Validation: `--track-fixme` while `--final-review` is not enabled (value ≤0) → error with exit code 1, the
  message explaining that the final-review audit is needed as the audit host; usage text updated to match.

### C.2 Prompt Injection (`src/prompt.ts`)

- prompt.ts's local `Opts` gains `trackFixme?: boolean` (passed through in sync in the runner Opts);
- A new `FIXME_RULE` constant (all of §A: format, TYPE/Severity tables, must-mark/must-not-mark lists, the
  division of labor with AUTO-DECISION, and deleting the corresponding marker once a fix eliminates the deviation) is injected into the three execution templates:
  `renderSubtask` / `renderWhole` (including ondemand resume runs) / `renderFix`;
- **Not injected** into renderDecompose (decomposition writes no code), renderWrapup (wrap-up only writes docs and
  commits), or the review templates (V1 per-task review is not FIXME-aware, see §4.2);
- The remediate / finalize final-review tasks naturally go through the above templates via the runTask pipeline and
  equally receive the marker spec - forced deviations newly introduced by a remediate session must land markers, which is exactly the input of the second gate before finalize.

### C.3 audit Task Integration (`src/final.ts` + `src/loop.ts`)

```
routeFinal(dir, plan, { limit, trackFixme })
  ├─ stage=audit generation routing and trackFixme:
  │    scanFixmes → writeFixmeScan(tmp/fixme-scan.md)
  │    prior += 「FIXME 审计输入: 扫描报告 tmp/fixme-scan.md,计数 …,malformed …」 (FIXME audit input: scan report tmp/fixme-scan.md, counts ..., malformed ...)
  │    (the scan is a purely local process; failure/empty does not block - the report may simply write the all-zero line)
  ├─ renderFinalTask(audit branch, trackFixme):
  │    duty section appended: check the scan records one by one - verify the grading is appropriate (up/downgrade with
  │    reasons given), drop false positives (not counted), prompt fixes for malformed as WARN-level findings;
  │    the report contains a "FIXME Audit Report" section (per record [SEVERITY] file:line / Type / Spec /
  │    Reason / Final Status: Accepted|Adjusted|FalsePositive);
  │    the stageReport(audit) protocol changes to the last three lines: 结论 (conclusion) / 策略 (strategy) / FIXME: CRITICAL=… WARN=… INFO=…
  ├─ appendFinalTask(…, fixme): writes no verify field (final-review baseline revision; the fixme parameter only feeds
  │    the generation-session prompt and the routing gate)
  ├─ afterAudit(trackFixme): parseFixmeSummary (the report's last-line protocol)
  │    missing/invalid → brokenReport (final review does no task-level acceptance; a backstop block at routing time for manual inspection)
  │    CRITICAL≥1 → FinalRoute block: the question carries the counts, pointers to the report and scan files,
  │      and the manual handling (fix the deviation; or downgrade the comment and rerun) - no remediate routing
  │    CRITICAL=0 → routes by strategy as usual
  └─ finalGate (shared by afterAudit with 策略:无 (strategy: none) and afterValidate (passed)):
       with trackFixme, rescan; CRITICAL≥1 → round+1 over the limit ? circuit-break block
         : stageRoute(audit, round+1, prior = new CRITICAL list + rescan counts)
       otherwise stageRoute(finalize, round, prior)
```

- Scan timing: the scan for audit@r happens **before the generation session** (generation is read-only; the code does
  not change between generation and execution); the audit task's own fix rounds only change report structure and never touch code (the existing renderFix constraint);
- `--review`/`--early` do not interact with this mechanism (audit tasks already force review=0).

### C.4 Failure Semantics Summary

| Case | Behavior |
| --- | --- |
| scanner hits unreadable/binary files | skip, record in skipped; never block the pipeline over a scan failure |
| malformed FIXME | see §A.2, no blocking |
| report missing the FIXME line | routing-time brokenReport block for manual inspection (final-review tasks do no task-level acceptance, no self-healing path - final-review baseline revision) |
| CRITICAL (report count) | block, exit code 2 |
| CRITICAL (rescan, self-reported grade) | fall back to audit@r+1 for re-verification (see the second gate in §3) |

### C.5 Interruption Recovery

- The scan is an idempotent, stateless pure function; rerunning at any moment rescans;
- interrupted before audit generation → the next routeFinal rescans and re-injects (the scan file is overwritten);
- interrupted inside the audit task → the existing recallProgress/peekProgress mechanism, zero additions;
- after a CRITICAL block, a manual comment downgrade → rerun: the blocked task resumes directly (existing semantics).

## D. `--extract-knowledge`

### D.1 CLI(`src/index.ts`)

- Dedicated parsing branch: bare option = enabled + default path; `--extract-knowledge=<path>` or an immediately
  following token not starting with `-` = explicit path (resolved relative to the target directory);
- Validation: without `--final-review` → exit code 1 (rationale in §3); not triggered under `--dryrun`
  (dryrun returns early, satisfied by construction).

### D.2 Trigger Hook (`src/loop.ts` runAll)

Location: after `next()` is empty, advanceFinal has ruled the final review complete, and the `--commit once` bulk
commit has happened, i.e. **after** that commit and before `return 0`. This location guarantees:

- The circuit-break/block/any exit-code-2 paths never pass the hook → SKIPPED holds by construction (TC-08);
- The knowledge document enters no automatic commit (§3);
- Rerun after everything completes: next() still empty, final review still complete → only knowledge extraction reruns
  (idempotent overwrite; with an explicit path, the same-named file is overwritten) - this is itself the recovery path of "fix and retry after an extraction failure".

### D.3 Extraction Session (`src/knowledge.ts` new + `renderKnowledge`)

- Reuses the `requireArtifact` skeleton exported by the runner (pseudo-task id `PLAN`, mirroring final.ts
  planningTask; retries once with feedback when the artifact is missing, and if it still fails ends per §D.5);
- `renderKnowledge(plan, path, opts)` consists of:
  - **Source list (structured artifact pointers, a subset of requirements specification §11)**: PLAN.md, `docs/*.report.md`,
    `docs/*.audit.md` (`--review` artifacts), `docs/final/*` (the final-review reports and proposals),
    `tmp/fixme-scan.md` (process evidence when track-fixme is combined; the persistent anchor is the audit report),
    and a git log overview hint;
  - **Section skeleton** (the eight sections of requirements specification §13: Migration Summary / API & Type Mappings /
    Implementation Patterns / Gotchas & Edge Cases / Reusable Rules / Design
    Deviations (filled only when track-fixme is on, citing the audit report and Final Status) /
    Validation Evidence / References);
  - **Hard quality constraints** (requirements specification §14): deduplicate; do not copy session dialogue/logs/
    intermediate reasoning verbatim; solutions rejected by final review must not be recorded as the current solution
    (only as general lessons explicitly labeled "rejected"); every important piece of knowledge carries a verifiable anchor (file/API/Spec/commit/test/report);
  - Scenario background: inject the `mode.exec` copy (no new ModeSpec field);
  - Constraints: read-only analysis, the only writable file is the output path; QUESTION_RULE / STATE_RULE used as-is;
    producing the file is a hard requirement (even with sparse information, write out the skeleton and explain);
- Lenient collect validation: the file exists and is non-empty (section completeness is a prompt-level requirement;
  excessive structural validation would create meaningless retries); reset deletes the old artifact.

### D.4 Output

- Success: print the knowledge document path; default `docs/migration-kb/migration-<时间戳>.md` (timestamp);
- The `<task_id>` adaptation deviation (§2 table) is explained in the README: this package's migration unit is the whole PLAN.

### D.5 Failure Semantics

- The session is stuck (blocked, e.g. a silent block/permission halt) or fails to produce twice →
  `⚠ 迁移已全部成功,但知识沉淀未完成(knowledge_extraction_error),退出码不受影响;
  可修复后重新运行(opencode-auto run … --extract-knowledge…)单独重试`; (the migration has fully succeeded, but knowledge distillation did not complete (knowledge_extraction_error); the exit code is unaffected; fix it and rerun (opencode-auto run ... --extract-knowledge ...) to retry it alone)
- The exit code stays 0; error details go to `.auto/logs/run-*.log`;
- Strict mode (failure changes the exit code) is listed as a future extension (§4.2).

## E. Combination Behavior Matrix

| Combination | Behavior |
| --- | --- |
| neither option | status quo unchanged |
| `--track-fixme` (no `--final-review`) | usage error, exit code 1 |
| `--extract-knowledge` (no `--final-review`) | usage error, exit code 1 |
| `--track-fixme --final-review [n]` | execution-time marking → audit scan/verification/protocol line → CRITICAL gate → rescan before finalize → done |
| `--extract-knowledge --final-review [n]` | final review completes → commit handling → knowledge extraction (failure does not affect the exit code) |
| both options + `--final-review [n]` | the full chain; the knowledge document's Design Deviations cites the audit report and scan evidence (TC-10) |
| + `--review` / `--early` | orthogonal: per-task review proceeds as before, V1 is not FIXME-aware (§4.2) |
| + `--dryrun` | neither option triggers |
| + `-m migrate` | the exec copy (AUTO-DECISION requirement) and FIXME_RULE coexist; division of labor in §A.3 |
| + `--commit once` | the bulk commit stays after final review completes and before knowledge extraction (the knowledge document is not committed) |
| + `--wait-between` / `--interactive` / `--subtask off` etc. | no interaction; final-review tasks do no task-level acceptance, so the verify-gap fallback under off does not exist (final-review baseline revision) |

## F. Data Model and Evolution Path (Deviation Record)

The requirements specification's appendix suggests evolving FIXME into a stateful Design Deviation Record. V1's reserved room:

1. `FixmeRecord` fields align fully with requirements specification §20 (type/message/spec/rationale/severity/
   file/line), and `parseFixmes` ignores unknown keys - when the comment format later appends a `Status: Accepted|
   Fixed|Rejected` line, old scanners are not broken; the new semantics (state transitions, auto-close) are designed separately;
2. The audit report's Final Status field (Accepted/Adjusted/FalsePositive) is already a first level of "post-audit
  state", kept in the report body rather than PLAN.md/a database - state does not enter the driver's persistence layer;
3. Evolution preconditions: before any of standalone state storage, the `--fixme-fail-on` policy, or per-task review
   awareness lands, extend this document first rather than the code.

## G. Acceptance Criteria Mapping (Requirements Specification §18/§19 → This Repository's Semantics)

| Use case | Acceptance in this repository |
| --- | --- |
| TC-01 no FIXME | the audit report writes `FIXME: CRITICAL=0 WARN=0 INFO=0`, routes by strategy as usual, no blocking |
| TC-02 INFO only | same as above, pass; the report contains the INFO list |
| TC-03 WARN only | pass; with strategy refactor/patch it still enters the loop as usual (WARN does not block the loop) |
| TC-04 contains CRITICAL | the driver parses a report count ≥1 → block that audit task (the issue written into PLAN.md, with pointers to the report and scan files), exit code 2 |
| TC-05 location information | `tmp/fixme-scan.md` and the audit report contain file/line/type/severity/rationale/spec per record |
| TC-06 default path | after final review completes, `docs/migration-kb/migration-<时间戳>.md` (timestamp) is generated |
| TC-07 explicit path | `--extract-knowledge=<path>` writes to the specified path |
| TC-08 final review not passed | the circuit-break/block paths return 2 before the extraction hook, never generating (no "skip after FAIL" branch) |
| TC-09 consistent with the final implementation | hard prompt requirements (final state takes precedence) + gates (extract only after final review passes, sources limited to final artifacts) + no auto-commit backstopped by manual vetting - **the driver cannot enforce the truthfulness of document content; listed as a known limitation (§I)** |
| TC-10 FIXME linkage | the knowledge document's Design Deviations section is hard-required to cite `docs/final/audit-r<N>.md` and Final Status (tmp/fixme-scan.md as the process-evidence pointer) |

## H. File-Level Change List and Phasing

| File | Change | Phase |
| --- | --- | --- |
| `src/fixme.ts` (new) | FixmeRecord/parseFixmes/scanFixmes/writeFixmeScan; the gitRoots extraction contract | P1 |
| `src/loop.ts` | extract gitRoots for sharing; runAll opts gain trackFixme/knowledge; advanceFinal passes them through; the knowledge-extraction hook | P1/P2/P3 |
| `src/index.ts` | parsing of both options (track-fixme boolean; the extract-knowledge dedicated branch with the `-` guard), dependency validation, usage text | P2/P3 |
| `src/prompt.ts` | FIXME_RULE constant; Opts.trackFixme; injection into the three execution templates; the renderFinalTask audit branch (trackFixme) and the stageReport protocol; renderKnowledge | P2/P3 |
| `src/runner.ts` | Opts.trackFixme pass-through rendering | P2 |
| `src/final.ts` | routeFinal gains opts; scan-and-inject before audit generation; parseFixmeSummary; the afterAudit CRITICAL gate; the finalGate second gate | P2 |
| `src/knowledge.ts` (new) | extraction orchestration (requireArtifact + renderKnowledge invocation) | P3 |
| `test/fixme.test.ts` (new) | parser golden cases, scan scope (gitignore honored/nested repos/non-git fallback), report format | P1 |
| `test/final.test.ts` (additions) | parseFixmeSummary; the CRITICAL gate does not route remediate; finalGate fallback/circuit-break | P2 |
| `test/prompt.test.ts` (additions) | injection present/absent assertions; the renderFinalTask audit duty section; the renderKnowledge skeleton and source pointers | P2/P3 |
| `test/e2e.test.ts` (additions) | CLI parsing: dependency-validation exit code 1, value swallowing and the `-` guard, the `=path` form | P2/P3 |
| `README.md` / in-package `AGENTS.md` | option table, behavior conventions, structure section, notes on adaptation deviations from the requirements specification | P4 |

Phase boundaries: P1 (pure logic, zero integration) → P2 (track-fixme end to end) → P3 (extract-knowledge)
→ P4 (documentation). Each phase is independently mergeable and takes effect per this document upon merge.
**Revision**: the extract-knowledge side's P3/P4 (the P3/P4 parts of the `src/knowledge.ts`,
`renderKnowledge`, and README-revision rows in the table above) are complete via the k phase per the P4 revision at the top;
the track-fixme side's P1/P2 (and the shared test rows) remain to be implemented per the table above.

## I. Risks, Boundaries, and Known Limitations

- **Truthfulness of knowledge content cannot be enforced**: TC-09 relies on prompt constraints and manual vetting (no
  auto-commit); the driver can only guarantee the gate (extraction after final review passes) and the source restriction;
- **The rescan gate rests on self-reported grades**: a CRITICAL found by the pre-finalize rescan falls back to audit
  without LLM verification - the fallback itself is "submitting to audit verification", so the loop is self-consistent;
  in the extreme case (a self-reported CRITICAL that is actually a false positive) the cost is one extra audit round, acceptable;
- **Full-scan noise**: historically leftover AUTO-FIXMEs (residue from earlier runs) enter the first audit round; treat
  this as a feature (unresolved deviations ought to be found) - it disappears after manual cleanup;
- **Deviations newly introduced by the finalize task itself are not rescanned** (wrap-up is mostly document syncing);
  listed as a known residual risk; rerun audit manually when needed;
- **The audit task's fix rounds could in theory change code** (renderFix only constrains "fixing the gap"): the actual
  gap is a report-structure issue, so the risk is minimal;
- **Empty PLAN / empty scan**: audit proceeds as usual (the all-zero line), knowledge extraction proceeds as usual (a skeleton document), no special-casing;
- **Dogfooding order**: the driver running during implementation is still the old version; the new behavior takes effect from the next run.

## J. Testing and Verification

- `bun typecheck` + `bun test`: the fixme/final/prompt tests depend on neither the opencode server nor
  the network (parsing is a pure function; reports/scans use fixture files; the git-related cases mirror the
  temporary-repository technique of gitignore.test.ts);
- e2e (`OPENCODE_AUTO_E2E=1`, requires credentials) is optional manual verification: run `--final-review 1
  --track-fixme --extract-knowledge` once through a dry closed-loop pass containing a WARN deviation, observing
  tmp/fixme-scan.md, the audit report's last-three-line protocol, T-F task routing, and knowledge document output;
  the CRITICAL path is verified separately for block behavior with a fixture comment;
- After everything completes, `bun run build` as a smoke check (no additions under templates/, `type: "file"` imports unaffected).

<!-- auto: eof -->

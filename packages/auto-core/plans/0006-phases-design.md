# Phased Flow (--phases) and Migration Parameter Persistence — Design Note

> This document is the sole design baseline for the `--phases` phased flow (a analysis → d design → m migration implementation → t testing → v acceptance →
> k knowledge distillation), persistence of the migration parameters (`--source-dir`/`--source-path`/`--dest-dir`), the AI-freeing of init
> (`-p` lands in brief.md), and continued-round migration (the `continue` subcommand, section M): implementation tasks defer to this document.
> **Implementation is complete in stages per section J (P1..P4); section M (continue for continued rounds) is already implemented.**

## Background and motivation

1. **Context pollution in long flows**: migration projects are naturally phased (survey the source system first, then design, then implement,
   then test and accept). Driving from a single PLAN.md start to finish forces later-phase sessions to drag along all earlier
   artifacts; AGENTS.md and docs/ only ever grow, and context quality degrades steadily as the flow advances. What is needed is
   driver-enforced phase boundaries: after each phase completes — archive, reset, distill — so the next phase continues
   in a lean context.
2. **The structural flaw of init -p**: generating PLAN.md in one shot at init cannot see each phase's artifacts
   (analysis conclusions and design documents do not exist yet), so planning quality is inevitably low. The phased flow demands that "tasks for a phase are planned
   only right before that phase begins", so planning sessions must move from init to the phase boundaries inside run.
3. **Structuring the migration parameters**: the source system's location and the source module paths can today only live in prompt natural language,
   unverifiable and unrepeatable. They are project attributes (changing one requires changing the contract wording) and, like the other constitutional-level
   options, should be persisted at init.

## Confirmed decisions

| Decision point | Conclusion |
| --- | --- |
| phases values | a **subsequence of `admtvk` that must contain m** (e.g. `m`, `amt`, `dmvk` are legal; `tma`, `adk`, repeated letters, and the empty string are illegal). Order is part of the semantics — free permutation only produces meaningless combinations; a one-line validation eliminates a whole class of misuse |
| Phase registry | a fixed six-letter built-in registry (src/phases.ts) + `phaseText()` Chinese display names, **not open to customization** (phases carry driver-side semantics — artifact conventions, v's acceptance exemption, the final-review hook point — not mere prompt copy; no `.opencode/auto/phases/` override directory) |
| CLI shape (migration parameters) | `init <工作目录> --source-dir <dir> --source-path <相对路径> [--dest-dir <相对路径>]` (where <工作目录> = the working directory and <相对路径> = a relative path). The positional argument is the driver working directory (where the flow files PLAN.md/docs/ live); **layout convention**: the migration source sits at `<工作目录>/<source-dir>` (source-path is the module's relative path under it) and the migration target at `<工作目录>/<dest-dir>` — the driver working directory and the migration target are kept apart via dest-dir. **The `<src-dir>/<src-path>` concatenation form is rejected** (the directory-boundary ambiguity cannot be made self-explanatory; "longest existing prefix" guessing is implicit magic); giving only one of the two source parameters errors (they must come as a pair), while `--dest-dir` is persisted/revised independently; all three must be relative paths without `..` (the session cwd is the working directory, so relative paths work directly, and the config shared with the repo stays portable) |
| Phase state carrier | **derived, with zero new rot-prone state**: the phase ledger (from the per-round directory scheme onward = the in-round `docs/R-NN/phases.md`; legacy layout = the root `docs/phases.md`, read fallback; versioned, committed with the repo, human-editable) records completed phases and artifact pointers; the current phase = the first letter in the phases string that does not appear in the ledger. The same paradigm as final-review's routeFinal |
| Cross-phase rollback | **V1 is linear; no automatic rollback routing**. Manual rollback = edit the ledger (drop the last line) + delete the corresponding archive directory, then re-run run — the rollback capability is a byproduct of the derived design and needs no dedicated code; gaps within the t/v phases go through the existing appendSubtasks/fix rounds, and v's residual gaps mimic the final-review circuit-breaker block (exit code 2) |
| v vs config.verify | **orthogonal**. v is a flow phase (its tasks are themselves the verification: task-level three-stage acceptance and per-task review are forcibly skipped, reusing the final-exemption path of final-review tasks); config.verify is the task-level acceptance mechanism (tasks in m and the other phases proceed as usual). When `--phases` contains v but verify=false, init/run print a note; it is not enforced |
| --final-review hookup | **m phase only**: the final-review loop is designed for code changes, a/d artifacts are documents, and t/v are themselves verification. run enables it for the m phase and ignores it for the other phases with a note |
| AI-free init | init **no longer starts any AI session** (the manage/runOnce paths are deleted); the `-p` text is written to `.opencode/auto/brief.md` (versioned, human-editable, amend semantics — repeated init -p overwrites and rewrites it) and is consumed by every phase's planning session |
| brief injection scope | brief.md is injected into **every** phase's planning session (not just the next one) — it is project-level intent, and the tone set in phase a is just as needed in phase k |
| Cross-phase memory channel | **handover.md is the only channel, and the driver controls the injection**: a phase-planning session's input = brief.md + each preceding handover.md + AGENTS.md + the source/destDir specs + mode.init; **the raw docs/ of preceding phases is not injected**. The "lean context" is achieved by the driver cutting things off on the input side, not by the handover session behaving itself |
| Handover restructuring | **archive + reset + distill**: the driver executes the mechanics (docs archived into the round directory `docs/R-NN/<letter>-<name>/`, PLAN.md archived then reset to the template, ledger append, unified commit); the AI does exactly one thing — a bypass session distills out handover.md. The AI does not rewrite contract files, in line with the driver's exclusive state writes and the maintenance rules block |
| PLAN.md audit trail | at handover, this phase's PLAN.md is archived as `docs/R-NN/<letter>-<name>/PLAN.md` (including attempts/verified/blocking Q&A) and then reset; digging through history does not depend on git operations, isomorphic to the docs/final/ artifact convention |
| k phase and --extract-knowledge | the k phase **wholesale-claims** the `--extract-knowledge` design of plans/0002-fixme-knowledge-design.md (produces docs/migration-kb/; extraction failure does not pollute the exit code); that option no longer exists on its own; `--track-fixme` is not folded in and keeps evolving independently |
| Guardrail for init amending phases | amending `--phases` while the ledger is non-empty validates that the letters already in the ledger form a prefix of the new string; otherwise it errors and points at manually revising the ledger — preventing amend from knocking the flow state underivable |
| phases default | `"m"` (no phase declaration = a single run, behavior exactly as today; the key to backward compatibility) |
| status enhancement | print a phase progress line after the config summary (derived from the ledger, zero cost): `阶段: a✓ d✓ m▶ t v k` ("Phase: ..." — ✓ = recorded in the ledger, ▶ = current) |

## A. Concepts and configuration

### A.1 Phase registry (src/phases.ts)

```ts
export type Phase = "a" | "d" | "m" | "t" | "v" | "k"
export const PHASE_ORDER = "admtvk"  // the only legal order; shared by validation and derivation
export function phaseText(phase: Phase): string
// a=analysis d=design m=migration implementation t=testing v=acceptance k=knowledge distillation
```

- Validation `parsePhases(raw)`: non-empty, letters ∈ admtvk, no repeats, contains m, and a subsequence of
  `admtvk`; invalid returns null (the CLI turns it into exit code 1, with the message explaining the legal forms).
- Per-phase responsibilities and artifact conventions (planning prompts are injected accordingly — see section E). **Revision of 2026-09-07
  (stable-refs P2, D2 artifact-directory folding)**: the phase-specific artifact directory convention in the "Primary artifacts" column of the table below
  (docs/analysis/ etc.) has been removed — a/d/t/v phase artifacts and final-review artifacts are uniformly task-anchored at
  `docs/T-NNN/` (final review `docs/T-F<k>/`); the k knowledge document is the fixed in-round name
  `docs/R-NN/migration-kb.md`, a permanent path (legacy-layout stock `docs/migration-kb/R<N>-…`
  stays in place as read fallback); m's artifacts are the source-code changes and the `docs/T-NNN/` task report:

| Phase | Responsibility | Primary artifacts (post-P2 wording) |
| --- | --- | --- |
| a analysis | map out the source system's and source module's external behavior, dependencies, and boundaries | docs/T-NNN/ (task-anchored; behavior baseline, dependency inventory) |
| d design | module design on the target-system side (interfaces, data structures, adaptation points) | docs/T-NNN/ (task-anchored) |
| m migration implementation | code migration and rework (mandatory phase) | source code + docs/T-NNN/ task report (final review docs/T-F<k>/) |
| t testing | migrate/fill out the test system; regression coverage of baseline behavior | test code + docs/T-NNN/ (task-anchored) |
| v acceptance | overall acceptance (against baseline and requirements) | docs/T-NNN/ (task-anchored; acceptance conclusion) |
| k knowledge distillation | distilling migration knowledge | docs/R-NN/migration-kb.md (fixed in-round name, permanent path; claims the --extract-knowledge design) |

### A.2 Config keys (src/config.ts)

```jsonc
{
  "phases": "admtvk",                          // default "m"
  "source": { "dir": "...", "path": "..." },   // optional; default undefined (non-migration scenarios)
  "destDir": "..."                             // optional; default undefined (migration output lands directly in the working directory)
}
```

- `phases`: validateProjectConfig reuses the same-source parsePhases validation; invalid → throws
  (a Chinese error naming the key and the expectation); both run and init exit with code 1.
- `source`: defaults to undefined; when present, dir must be a relative path without `..`, relative to the working directory,
  and path must be a non-empty relative path (no `..`) relative to dir; **at init** it checks that `<工作目录>/dir` (<工作目录> = the working directory)
  is an existing directory and that `dir/path` exists (environment error, exit code 1) — the existence check goes through stat, following
  symlinks, so **dir may be a symlink pointing outside the working directory** (the source system's large tree need not be copied into the working directory;
  wiring it in via a link is enough; a broken link is rejected as non-existent); at run time existence is no longer checked
  (the source system may already be offline — the ledger and docs/ already hold what is needed).
- `destDir`: defaults to undefined (migration output lands directly in the working directory); when present it must be, relative to the working directory, a
  relative path without `..`, through which the driver working directory's flow files are isolated from the migration output. Existence is not checked
  (the target directory is usually created by the migration process).
- run rejection-list extension: `phases`, `source-dir`, `source-path`, or `dest-dir` appearing at all is a usage
  error with exit code 1; the message gives `init --phases <值>` (<值> = value) / `init --source-dir <dir>
  --source-path <path>` / `init --dest-dir <相对路径>` (<相对路径> = a relative path) guidance.

### A.3 brief.md(`.opencode/auto/brief.md`)

- The carrier for `-p`: versioned, shared with the repo, human-editable; init -p writes the whole file over it (amend semantics).
- No -p and brief.md already exists → kept; no -p and it does not exist → not created (the planning session renders as brief-less,
  with the template containing a `{{^brief}}` conditional block prompting "未提供项目意图,请人工补充或按 source
  规范推进" — "no project intent provided; add it manually or proceed per the source spec").
- **Not set read-only** during run (it is not a state file; protect.ts leaves it alone).

## B. CLI surface (src/index.ts)

### B.1 init

```
opencode-auto init <working-dir> [--phases <admtvk subsequence containing m>]
                              [--source-dir <dir> --source-path <relative-path>]
                              [--dest-dir <relative-path>]
                              [-p|--prompt <prompt-text>] [existing constitutional options...]
```

- `--phases`/`--source-dir`/`--source-path`/`--dest-dir` go into VALUE_FLAGS; accepted by init only,
  going through mergeProjectConfig's "explicit-keys-only override" (the two source keys come as a pair — supplying either one replaces the whole object;
  dest-dir is persisted/revised independently).
- The prefix guardrail for amending `--phases` while the ledger is non-empty (see Confirmed decisions); amending `source` has no guardrail
  (pure prompt input — changing it does not break state derivation).
- `-p`: drop the manage/runOnce calls and write brief.md instead; init becomes pure environment configuration,
  with the closing message in two states by phases: `phases ≠ "m"` → "brief 已记录,运行 run 开始
  a(分析)阶段规划" ("brief recorded; run run to start a (analysis) phase planning"); `phases = "m"` → "brief 已记录,运行 run 开始任务规划" ("brief recorded; run run to start task planning").
- PLAN.md template strategy: when `phases ≠ "m"`, keep the empty template (filled by the planning session) and no longer prompt
  "编辑 PLAN.md 填入任务" ("edit PLAN.md and fill in the tasks"); `phases = "m"` keeps the status quo.
- The note for v present with verify=false is printed here once.

### B.2 run

- The rejection list gains `phases`/`source-dir`/`source-path`/`dest-dir` (the message gives revision guidance, same as the existing persisted options).
- run startup banner: add `阶段: <进度行>` ("Phase: <progress line>") after the config summary (shares formatPhases with status).
- `--final-review` combined with phases: the final-review loop is hooked into the m phase only; when other phases complete it does not enter
  routeFinal, printing the note "终审闭环仅作用于 m(迁移实现)阶段" ("the final-review loop applies only to the m (migration implementation) phase").
- `--dryrun` triggers no phase action (status quo: permission precheck only).

### B.3 status

- Print the phase progress line after the config summary: `阶段: a✓ d✓ m▶ t v k` (✓ = recorded in the ledger, ▶ = current,
  the rest = not started); a missing/invalid ledger only warns, it does not block (the same treatment as invalid config).

## C. Phase-state derivation (phase ledger: new layout in-round docs/R-NN/phases.md, legacy layout root docs/phases.md)

### C.1 Ledger format (versioned, human-editable)

```markdown
# 阶段台账(opencode-auto 维护;人工修订见设计文档 C.3)

- [done] a 分析 → docs/R-01/a-analysis/(交接: docs/R-01/handovers/a-analysis.md)
- [done] d 设计 → docs/R-01/d-design/(交接: docs/phases/d-design/handover.md)
```

- One completed phase per line, in completion order; the driver appends the line after the handover finishes and before the unified commit.
- Parsing: tolerates blank lines and comments; the line protocol is `- [done] <letter> <名称> → <归档目录>(交接: <handover>)` (done marker, phase letter, Chinese name, → archive directory, and an optional handover pointer),
  with the driver reading only the letter column — everything else is human-readable information; the handover pointer is an optional column — the second example line above is the pre-P2 legacy
  form (handover inside the archive directory), equally tolerated (from the per-round directory scheme onward, new output is always the in-round
  handovers/ path; legacy-layout docs/handovers/R<N>-… and the pre-P2 form stay in place as read fallback).

### C.2 Derivation rules

```
currentPhase = the first letter of the phases string not present in the ledger's letter set
all present → flow complete (run exits 0, printing "全部阶段已完成" ["all phases completed"])
ledger contains letters outside phases / repeated letters → environment error, exit 1 (pointing at manual ledger revision)
```

Interrupt recovery adds zero new state: run re-evaluates at startup; an interruption inside a phase goes through the existing recallProgress/
peekProgress; an interruption at a phase boundary (archiving done but the ledger line not yet written) is backstopped by the idempotency of the handover actions
(if the archive directory already exists, the move is skipped; the ledger line is appended after a duplicate check).

**Session recovery takes precedence over file-derivation routing** (2026-09-10, plans/0018-session-resume-precedence-design.md):
routePhase's (ledger, PLAN.md) derivation remains the default routing, but for **phase-level bypass steps** (planning / handover
distillation) an extra driver-state-first layer is added — these sessions, through requireArtifact's spec.step, write a step
recovery point into `.auto/progress.json` (phase.kind="step") when the prompt goes down; the driver deletes it via
closeStep after wrapping up. Before consuming the route, runPhaseLoop checks openStep: an unclosed recovery point exists whose owning phase ==
the currently routed phase and which is not yet in the ledger → re-enter that step and resume (reusing the interrupted session), even if PLAN.md
already has tasks / the handover document already exists. Rationale: PLAN.md tasks and handover documents are written by the AI (or backfilled by the driver
only after the session broke off), so their existence does not prove the session was wrapped up; only the driver recovery point being deleted counts as wrapped up. Manual
rollback (editing the ledger) and stale records whose letters disagree still let file routing win (with a warning); the rollback procedure is unchanged.

### C.3 Manual rollback procedure (written into README and the ledger header comment)

Rolling back to a phase = ① delete that phase and every line after it from the ledger; ② delete the corresponding
`docs/R-NN/<letter>-*/` archive directory (or copy its PLAN.md back to the in-round PLAN.md and resume; the legacy layout
uses `docs/phases/<letter>-*/`); ③ re-run run.
Derived state means rollback needs no driver code support.

## D. run lifecycle and routing (src/phases.ts)

### D.1 The phase loop of a single run

```
run starts
 ├─ load config (phases/source/brief pointers)
 ├─ phases == "m" and no phase semantics beyond --final-review → take the current path (zero changes)
 ├─ derive currentPhase (C.2); all complete → exit 0
 └─ loop:
     ├─ PLAN.md has no unfinished tasks and no tasks for this phase → phase-planning session (section E; bypass
     │   requireArtifact skeleton, artifact = the filled-in PLAN.md)
     ├─ the main loop runAll runs as usual (subtasks/verify/review/unified commit/progress recovery unchanged)
     ├─ currentPhase == "m" and finalReview > 0 → the existing routeFinal final-review loop
     ├─ all done → phase handover (section F) → ledger append → unified commit (Auto-Stage:
     │   phase-transition)
     └─ derive the next phase; none → exit 0
```

### D.2 routePhase pseudocode (a pure routing function, mirroring routeFinal's style)

```ts
export type PhaseRoute =
  | { type: "complete" }                          // all phases complete
  | { type: "plan"; phase: Phase }                // open a planning session
  | { type: "execute"; phase: Phase }             // the main loop has tasks to run
  | { type: "handover"; phase: Phase }            // all tasks done; enter handover
  | { type: "blocked"; reason: string }           // invalid ledger etc.; exit code 1/2

export async function routePhase(dir, plan, config): Promise<PhaseRoute> {
  const ledger = await readLedger(dir)            // C.1; invalid → blocked
  const phase = PHASE_ORDER.filter(p => config.phases.includes(p))
    .find(p => !ledger.done.includes(p))
  if (!phase) return { type: "complete" }
  if (plan.tasks.some(t => t.status !== "done")) return { type: "execute", phase }
  if (plan.tasks.length) return { type: "handover", phase }  // this phase's tasks are all done
  return { type: "plan", phase }                  // PLAN.md empty (template state / reset)
}
```

Idempotency: the plan route no longer fires once PLAN.md has tasks; the handover route naturally
disappears after the ledger append; every route is derived from the two files (ledger, PLAN.md), with no hidden state. **k-phase exception
(P4/D.4)**: the plan route does not open a planning session — it goes straight into the knowledge-extraction bypass session and then handover;
routePhase itself is unchanged; the k branch lives in run's phase loop.

### D.3 Acceptance exemption for v-phase tasks

v-phase tasks are themselves the verification: runTask, seeing `config.phases` contain v and currentPhase == "v",
forces review=0 and skips task-level three-stage acceptance (markDone directly after wrap-up) — sharing the same code path as the final-review tasks
final exemption (an internal flag: it writes no final field and does not pollute the PLAN.md protocol).
Residual gaps: once the v-phase tasks are all done, handover happens — no circuit breaker; the gap conclusions in the acceptance report are consumed by k/humans
(the V1 linear decision). **Revision option**: if a v gap circuit breaker is needed later, mimic afterValidate by parsing
the acceptance report's last line `结论: 通过|差距` ("conclusion: pass|gap") before the handover route; this document reserves that hook point.

### D.4 k phase: wholesale claim of --extract-knowledge (implemented in P4)

The k (knowledge distillation) phase wholesale-claims the `--extract-knowledge` design of plans/0002-fixme-knowledge-design.md
(the revision section "P4 并入阶段化流程" ("P4 merged into the phased flow") at the head of that document gives a point-by-point mapping of the two designs); `--track-fixme`
is not folded in and keeps evolving independently. The key differences between the k phase and the generic phase loop:

- **No planning session, no tasks filled into PLAN.md**: the plan route (PLAN.md in empty-template state) goes straight into
  the one-shot knowledge-extraction bypass session (src/knowledge.ts, reusing the requireArtifact skeleton, a pseudo-task
  PLAN); the artifact = the fixed in-round name `docs/R-NN/migration-kb.md` (a permanent path; a legacy-layout stock project
  without a round directory uses `docs/migration-kb/R<N>-migration-<时间戳>.md` (<时间戳> = a timestamp)). The session input is this round's phase
  ledger and this round's per-phase handover documents (in-round docs/R-NN/ first; raw artifacts are consulted via the artifact index); the section
  skeleton / quality constraints / mode.exec injections are in templates/prompts/knowledge.md;
- **Extraction failure does not pollute the exit code**: session blocked, or twice without output → ⚠ warning (knowledge_extraction_error,
  details to the run log), then handover proceeds as usual and the exit-code semantics are unchanged — migration success is not polluted in reverse by a document-generation failure;
- **Idempotency and recovery**: this round's knowledge document already exists (new layout: in-round migration-kb.md non-empty; legacy layout:
  this round's non-empty `R<N>-`-prefixed .md) → skip re-extraction (earlier rounds' documents do not count as this round's extraction; in the legacy layout, round 1's
  prefixless stock is treated as this round's artifact via read fallback); an interrupted handover goes through the existing idempotent ledger backfill; retrying the extraction after the handover
  completes = the manual rollback procedure (delete the ledger's k line and this round's knowledge document, then re-run);
- **Knowledge document committed to the repo**: committed with the session (stage=knowledge); once landed, the permanent path never moves
  (the fixme design's "no auto-commit" decision is retired along with the standalone option; before P2 it was once archived
  as a phase artifact into docs/phases/k-knowledge/);
- When a human fills tasks into PLAN.md themselves during the k phase, the generic execute/handover routes apply and the extraction hook
  does not fire (manual-takeover semantics); the extraction session's only writable file is the output path, and the remaining constraints (state files
  read-only, no commits) match all other bypass sessions.

## E. Phase-planning session

- Shape: a one-shot bypass session reusing runner's requireArtifact skeleton (missing artifact → one retry with feedback;
  still failing → silent block with exit code 2); the pseudo-task PLAN does not enter the task chain and writes no progress record.
- Template `templates/prompts/phase-plan.md` (protocol-sensitive, override-checked: the PLAN.md fill-in
  requirements and the task-format protocol are mandatory); variables:

```ts
renderPhasePlan({
  phase, phaseName,             // the current phase's letter and Chinese name
  brief,                        // the brief.md verbatim text (may be empty)
  sourceDir, sourcePath,        // config.source (may be empty)
  destDir,                      // config.destDir (may be empty): the migration target directory injected; code tasks point at it
  handovers,                    // pre-joined string of every preceding handover document (assembled by the caller; reads this round's in-round handovers/, legacy-layout docs/handovers/, pre-P2 read fallback from the archive directory)
  modeName, modeInit,           // orthogonal mode injection (rendered via modeText)
  verify,                       // config.verify (the conditional block describing the verify field)
  finalReview,                  // when in the m phase and enabled, prompts the task layout to reserve room for the final review
})
```

- Artifact requirements (written into the template protocol): edit PLAN.md directly and fill it in (the driver temporarily allows writes,
  then checkPlanEdit validates afterwards — legal task format, no rewriting of marker blocks); each task is self-contained,
  artifact conventions follow the A.1 table; the first phase (a) additionally requires scheduling the source-system survey plan as the first batch of tasks.
- **Injection discipline** (confirmed decision): preceding raw docs/ is not injected; handovers are read and joined by the driver,
  and a phase missing a handover is marked "(无交接文档)" ("(no handover document)") in the list.

## F. Phase handover (archive + reset + distill)

> **Revision of 2026-09-07 (stable-refs P2, docs never move)**: the handover distillation artifact switches to the permanent path
> `docs/handovers/R<N>-<字母>-<slug>.md` (<字母> = the phase letter; landed, never moved); this section's original delta-archive chain of "diff against the docs/ snapshot and
> move this phase's additions/changes into the archive directory" (snapshotDocs/archivePhaseDocs/
> `.auto/phase-snapshot.json`) has been deleted — phase artifact documents (docs/T-*/ etc.) stay permanently in
> place; the archive directory `docs/phases/<letter>-<slug>/` now only holds the phase PLAN.md snapshot; round-to-round
> differences are expressed via the `R<N>-` prefix and ledger derivation. The ledger line protocol gained a handover pointer (see C.1).

Once all tasks are done, execute in order:

1. **Distillation session** (the AI's only duty): one-shot bypass, template
   `templates/prompts/phase-handover.md` (protocol-sensitive); read through this phase's PLAN.md and
   docs/ artifacts and produce this round's in-round `docs/R-NN/handovers/<字母>-<slug>.md` (<字母> = the phase letter; the driver creates the
   directory first; a legacy-layout stock round uses `docs/handovers/R<N>-<字母>-<slug>.md`).
   The protocol requires these subsections: key decisions, constraints and pitfalls, the must-read list for the next phase, and the artifact index;
   requireArtifact checks the subsections are all present. The k phase has no next phase but still writes a handover (for later reference).
   The template carries fallback wording for a phase with no task list (k), added 2026-09-08: an empty PLAN.md / a missing CURRENT.md
   is expected, and distillation takes this round's migration-kb.md artifact as its basis; the "下一阶段" ("next phase") wording does not assume it opens a planning session
   (k's reader is the knowledge-extraction bypass session) — otherwise the distillation session would idle away on a survey because of contradictory prompts.
2. **Driver mechanical archiving**: PLAN.md is copied to the PLAN.md inside the archive directory, then reset to the template (including
   the conditional verify rendering); this phase's docs/ artifact documents are untouched (permanent paths); AGENTS.md is not rewritten —
   only checked against ≤150 lines; over the limit, the handover commit message and a terminal note prompt manual trimming.
3. **Ledger append** of the C.1 line; 4. **unified commit**: title `阶段交接: <letter> <名称> →
   <下一字母> <名称>` ("phase handover: <letter> <name> → <next letter> <name>"), trailer `Auto-Stage: phase-transition`.

## G. Interaction with the existing mechanisms

| Mechanism | Interaction |
| --- | --- |
| Task-level verify | tasks in every phase as usual (gated by config.verify); v-phase tasks exempt (D.3) |
| --review/--early-review | tasks in every phase as usual; v phase exempt (D.3) |
| --final-review | hooked into the m phase only (confirmed decision) |
| subtask three tiers | phase-unaware; uniform across phases |
| Progress recovery | inside a phase = the existing recallProgress/peekProgress; at phase boundaries = derived idempotency (C.2) |
| Unified commit | in-phase sessions as before; the handover is a single commit (F.4) |
| protect.ts | unchanged (brief.md not set read-only; PLAN.md temporarily allowed + validated during planning sessions) |
| --dryrun | triggers no phase action |
| --interactive | planning/distillation sessions likewise receive bypass input (attach is covered by runner's existing hooks) |
| mode | orthogonal to phases: the init preamble goes into planning sessions, exec annotations into execution sessions, and the final emphasis into the m-phase final review |
| check | unchanged (scans AGENTS.md/PLAN.md; phase-agnostic) |
| k and the fixme design | k claims --extract-knowledge; --track-fixme evolves independently |

## H. Exit codes and exceptions

- Invalid config (phases/source): 1 (strict failure over silent fallback).
- Invalid ledger (letters outside phases / duplicates / unparseable protocol lines): 1, with the message giving manual-revision guidance.
- Planning/distillation session silent block: 2 (existing requireArtifact semantics).
- Task blocked inside a phase: 2 (existing semantics; the ledger is unaffected — a re-run resumes the current phase).
- All phases complete: 0.

## J. Staged implementation

- **P1 (config and CLI surface)**: config gains the `phases`/`source` keys and validation; the AI-freeing of init
  (-p lands in brief.md; the manage/runOnce paths deleted); run rejection-list extension; the `phases:"m"`
  compatibility path (run behavior unchanged); the init prefix guardrail; tests: config/CLI parsing, brief writing.
- **P2 (phase skeleton)**: src/phases.ts (registry/parsePhases/ledger read-write/routePhase);
  wiring run's phase loop; the phase-planning session (phase-plan.md); the mechanical part of handover (archive + reset +
  ledger + commit); the status phase line. In this stage the distillation session is a template placeholder (writes a minimal handover directly).
- **P3 (distillation and injection)**: the phase-handover.md distillation session; handovers injected into planning sessions;
  v-phase exemption wiring; the note that --final-review hooks into m only.
- **P4 (k phase, implemented)**: claims --extract-knowledge from plans/0002-fixme-knowledge-design.md
  (docs/migration-kb/ output, failure does not pollute the exit code; the behavior spec is in D.4); that document's head already carries the merged
  revision note.

## K. File-level change list

| File | Change |
| --- | --- |
| src/phases.ts | **added**: the Phase registry, parsePhases, phaseText, ledger read/write (readLedger/appendLedger), routePhase, formatPhases (shared by status/run) |
| src/config.ts | ProjectConfig gains `phases: string`, `source?: {dir, path}`, `destDir?: string`; CONFIG_DEFAULTS.phases="m"; validates each key; formatProjectConfig appends the phases summary |
| src/index.ts | VALUE_FLAGS gains the four keys; init-side parse and merge, the prefix guardrail, -p landing in brief.md (delete manage/runOnce), the v+verify=false note, the closing message in two states; run rejection-list extension and phase progress line; the status phase line; usage text |
| src/loop.ts | the runAll entry derives currentPhase and the phase loop (D.1); handover orchestration (section F); the final-review loop hookup gated by phase |
| src/runner.ts | the internal flag for the v-phase exemption (D.3, sharing the path with the final exemption); the temporary PLAN.md allowance for planning/distillation sessions and reuse of checkPlanEdit |
| src/prompt.ts | assembles renderPhasePlan/renderPhaseHandover; FinalStage unaffected |
| src/knowledge.ts | **added** (P4/D.4): knowledge-extraction orchestration — default path knowledgeFile, idempotency check existingKnowledge, extractKnowledge (requireArtifact + renderKnowledge call) |
| templates/prompts/knowledge.md | **added** (P4/D.4): the knowledge-extraction session template; registered in the src/template.ts embedded registry (collect is lenient; not in the protocol-sensitive list) |
| templates/prompts/phase-plan.md, phase-handover.md | **added**; registered in the src/template.ts embedded registry and the protocol-sensitive validation list |
| src/protect.ts | no changes (brief.md not protected; confirmed against the checklist) |
| src/loop.ts (P4 delta) | the plan route of runPhaseLoop gains the k branch: extraction (failure only ⚠) → handoverPhase("k") → the ledger derives complete |
| plans/0002-fixme-knowledge-design.md | the P4 revision note has been merged in (the "P4 并入阶段化流程" ("P4 merged into the phased flow") section at the document head): --extract-knowledge is folded into the phases design as the k phase |
| README.md | usage, the --phases/source options, brief.md, the manual rollback procedure (C.3) |
| test/ | config/CLI parsing, ledger derivation and routePhase idempotency, template-protocol drift protection (prompt.test.ts extension) |

## L. Things not done (out of scope)

- Automatic cross-phase rollback routing (t/v gaps automatically rolling back to m for replanning) — manual ledger rollback already covers it.
- Custom phases and a phase override directory — phases carry driver semantics; they are not mere copy.
- Sub-phases inside a phase / nested phases — YAGNI.
- Generating PLAN.md on the spot at init — superseded by the phase-planning session; init is pure configuration.
- An automatic circuit breaker on v-phase gaps — the hook point is reserved (the D.3 revision option); not implemented in V1.

## M. Continued-round migration (the continue subcommand, implemented)

> **Revision of 2026-09-08 (per-round directory scheme, plans/ROUND_WORKDIR_PLAN.md)**: each round gets one
> dedicated round directory `docs/R-NN/` (two zero-padded digits after R, carrying over naturally; alongside `docs/T-NNN/` it forms
> the two top-level namespaces under docs/), **created at round start, with everything written inside permanent the moment it lands** (no renaming, no path changes,
> no deletion), replacing "shared directory + filename prefix + end-of-round move-to-archive" (archiveRound is deleted).
> In-round layout: `PLAN.md` (this round's task ledger; the root PLAN.md is a relative symlink pointing to it — a single
> source of truth, zero drift, zero change to how sessions and runner/protect perceive the "PLAN.md" path; writes land inside the round via the link
> (the environment fallback when link creation fails is a copy)), `phases.md` (this round's phase ledger; the root
> `docs/phases.md` dies out in the new layout), `AGENTS.md.bak` (an AGENTS.md snapshot at round start; the .bak
> suffix keeps it from being auto-loaded as instructions), `<字母>-<slug>/` (<字母> = the phase letter; phase archive), `handovers/<字母>-
> <slug>.md` (phase handover; the filename drops the R<N>- prefix), `phase-docs/<字母>-<slug>/`,
> `migration-kb.md` and `prior-kb.md` (fixed in-round names; the old timestamped names are dropped).
> Stock compatibility = **read fallback only, never move old files**: the old flat `docs/handovers/R<N>-*.md`,
> flat `docs/prior-kb|migration-kb/`, the old `docs/phases/round-N/` archives, and the root
> `docs/phases.md` old ledger stay in place as read-fallback sources; writes go only to the new layout.
> `phases = "m"` pure-manual mode (no rounds): no round directory is created; the root PLAN.md stays a regular file.
>
> <details><summary>Revision of 2026-09-07 (stable-refs P2, historical)</summary>
>
> The archive layout gains a per-round snapshot of the root AGENTS.md (a copy) and no longer moves `docs/migration-kb/` (knowledge documents
> switch to permanent paths + an `R<N>-` prefix guard, re-extracted each new round); `.auto/phase-snapshot.json` goes away with
> the snapshot chain's deletion, so a state reset reduces to the ledger vanishing + PLAN.md being rebuilt; conclusion injection ②③ reads the permanent paths instead.
> </details>

After one round of phased migration fully completes, continued migration (filling omissions, aligning with the source system) proceeds as a "new round": at round start
the new round directory is established and state is naturally isolated (the new round directory is always empty); the previous round's conclusions are injected into the new round's first planning session —
the goal is to **make the migration result more complete and more consistent with the source**, not to redo finished work.

| Decision point | Conclusion |
| --- | --- |
| CLI shape | a standalone subcommand `continue [dir] [--phases <新值>] [-p <brief>] [其余可修订选项]` (<新值> = the new value, 其余可修订选项 = the other revisable options; init's options are not reused: it is an action, not an attribute); `--continue` is not an option — appearing on init/run errors and points to the subcommand; `init --continue` semantics = the continue subcommand |
| Relation to init | continue = init's amend machinery + establishing a new round at round start: it reuses the same branches (parse*/merge/template loop/ensurePointer/ensureGitignore/-p), with the differences gated by cont; constitutional options keep single-entry semantics (config.json is written only via init/continue) |
| Preconditions | the existing phases ≠ "m" and the ledger covers every letter of the existing phases (judged by the **existing** config, not the new --phases); non-phased / empty ledger / missing phases / letters outside / new --phases being "m" → exit code 1, with "先跑 run 完成本轮" ("finish this round by running run first") or manual-rollback guidance |
| Round-start establishment | `establishRound` (src/phases.ts): create `docs/R-NN/` (N = nextRound) + the in-round PLAN.md initial value (default empty template; when switching modes m → phased, the existing regular root PLAN.md's content is copied as R-01's initial value) + rebuild the root PLAN.md relative symlink + write the `AGENTS.md.bak` snapshot; idempotent (an existing round directory's contents are not rewritten). The new round directory is always empty — **there is no scene to clean up** — and the old mechanism's scene cleanup (needsSceneCleanup/archiveRound/PLAN reset) was deleted together with the end-of-round move |
| State reset | not needed: ledger/PLAN/handover/knowledge are all self-contained within the round, and an always-empty new round directory is "already reset"; zero change on the run side (routePhase naturally returns to the plan route for an empty ledger + empty template) |
| Round derivation | `currentRound`: `docs/R-NN/` exists → the highest R-series directory number (**no +1**; created at round start); with no R-series directory, fall back to the old semantics (highest `docs/phases/round-<N>` + 1) — mixed projects (old round-1..4 + new R-05) continue the numbering naturally. `nextRound`: the current round already taken (R-NN created, or the legacy-layout root ledger present) → +1, otherwise the currently derived value. Zero new persisted state; the run/status phase progress line carries a `第 N 轮` ("Round N") annotation (when round > 1) |
| Parameter lock matrix | **fixed across rounds** (migration identity; supplying them explicitly is exit code 1): -m/--mode, --source-dir, --source-path, --dest-dir — switching source/target/mode is not "continuing the same migration"; to switch, init a new project in a new directory; **revisable per round**: --phases (not subject to the prefix guardrail — the ledger naturally resets with the round directory, so any legal value may be set, e.g. running mtvk in round 2), -p (the brief switches to the new round's intent), --agent/--context-limit/--subtask/--verify/--idle-time/--idle-max/--commit |
| Conclusion injection | the **first** phase-planning session when the new round's ledger is empty injects `prevRoundDigest` (src/phases.ts): ① an index of every phase's archive directory; ② the full text of the final completed phase's handover document (new layout: read the in-round `docs/R-NN/handovers/<字母>-<slug>.md`; legacy layout: read the permanent path `docs/handovers/R<N>-…`, pre-P2 rounds read-fallback from the archive directory); ③ the full text of the migration knowledge document (new layout: in-round `migration-kb.md`; legacy layout: the `R<N>-`-prefixed file in `docs/migration-kb/`, with prefixless stock leniently attributed to the previous round and pre-P2 stock collected by read fallback from the in-archive migration-kb/; lenient parsing — bad lines do not abort). Injection discipline matches the in-round one — distilled artifacts are the only channel; raw artifacts are not injected but reachable via the index (the round directory sits inside the working directory); later phases go through this round's handover distillation chain as usual, with no repeated injection. The `{{#if prevRound}}` conditional block of phase-plan.md carries the continued-round goal copy (hunt down omissions and gaps; don't redo) |
| Idempotency and recovery | every round-start establishment step is idempotent (existing directories/files are not rewritten; symlinks are rebuilt); a repeated continue while the new round is unfinished is rejected by the preconditions (the current round's ledger is empty → all letters still missing) |
| Exit codes | same as init: 0 success (round-start establishment + config revision complete), 1 usage/environment error; the run side notices nothing (an empty ledger + empty template just opens a planning session normally) |
| Manual round rollback | rolling back a continued round = delete the new round's `docs/R-NN/` directory (or manually empty its phases.md ledger) and re-run run; round derivation falls back naturally as the directory disappears |

File-level changes (2026-09-08 per-round directory scheme): src/phases.ts (new currentRound derivation/nextRound/roundRoot/establishRound + ledger path ledgerPath + layout-aware phaseArchive/handoverDoc/phaseDocsDir + dual-layout prevRoundDigest; archiveRound deleted), src/docpaths.ts (roundDir/roundDirName + the fixed in-round names knowledgeDoc/priorKnowledgeDoc + legacyKnowledgeDoc/legacyPriorKnowledgeDoc turned into read-fallback constants), src/knowledge.ts (layout-aware knowledgeFile/priorKnowledgeFile, existing* new layout + old-flat fallback, dual-layout existingDistilledDocs/priorKnowledgeDigest), src/plan.ts (writeTarget: rename lands on the symlink target, the root symlink survives), src/numbering.ts (the numbering scan gains docs/R-*/**/PLAN.md), src/loop.ts (handover/archive paths made async), src/prompt.ts + templates/prompts (path-related copy), test/ (phases/knowledge/numbering/docpaths/prompt/protect).

# 0045 Document role model close-out (M2.3)

Root plan item M2.3 (`plans/AUTO_NEXT_REFACTOR_PLAN.md`, document domain part
two), with the two residuals 0044 §4 moved to its front and the three
open-question-15 candidates the user ruled on 2026-09-21.

## 1. Rulings (root open question 15, 2026-09-21)

| # | Candidate | Ruling |
|---|---|---|
| R1 | P1 prohibition check (0036 D9) | **In M2.3, blocking** — a hit in the unit's added deliverable lines is a close-out problem (re-prompt once, then blocked); a bare task id only warns; the whole-tree scan stays a round-close gate (M4) |
| R2 | Phase acceptance document role (0036 D8, role half) | **Now** — a new `DocumentRole` plus its path constructor; no reader until the M3 gate, which also owns the acceptance marker literal |
| R3 | Id namespace (0036 D3-A/B) + configurable `destDir` (F18) | **Deferred, both** — decided when MP comes up; `T-NNN` and the fixed `destDir` stay |

P1 principle text (0036 D10) was not a candidate: root D12 already adopted
it; M2.3 only writes it down.

## 2. Decisions

| # | Decision | Content |
|---|---|---|
| D1 | One classifier, one policy table | `src/document/roles.ts`: `roleOf(rel)` classifies any target-relative path by shape only (never content or existence); `ROLE_POLICIES` carries per-role `eofScan` and `process`. Legacy flat names classify like their directory successors (D4). |
| D2 | Six roles | The five of the M1.1 freeze plus `phaseAcceptance` (R2). `todo.md`/`done.md` are **artifact** on both sides: the content is the decompose session's scope statement; the state is which file of the pair exists, interpreted only by `document/state.ts` — state is not a role. |
| D3 | eof-scan exemption derived | `eofScanExempt = !ROLE_POLICIES[roleOf].eofScan`; the name list in `doccheck.ts` is gone. Delta vs. the old list: the ledger, phase handovers and acceptance records become exempt — none of them appears in a subtask unit's changes in normal operation (driver- or human-written, outside subtask sessions). |
| D4 | Protect list hung on the role | `PROTECTED_FILES` (roles.ts) feeds `protect.ts`; a test asserts every entry is `driverState`. `.auto/` is driverState but not chmod-guarded (the driver rewrites it continuously). |
| D5 | Handoff checks move to the document domain | `handoffStatus` (from `handover.ts`) and `HANDOVER_SECTIONS`/`validHandover` (from `phases.ts`) live in roles.ts as the handoff role's two protocol shapes (session status line, phase four sections). Literals untouched — they flip at M2.4 (0035). |
| D6 | State protocol moves into the domain | `src/subtask-state.ts` → `src/document/state.ts` (git mv, behavior unchanged; dead imports dropped). |
| D7 | Acceptance record path | `phases.ts phaseAcceptanceDoc` → `<phaseDocsDir>/acceptance.md` (`PHASE_ACCEPTANCE_NAME` in docpaths.ts). Deviation from 0036 §6.3's example `acceptance-r<n>.md`: the round is already the `R-NN` directory; the classifier also accepts `acceptance-r<n>.md` so M3 may choose per-iteration naming without a role change. |
| D8 | P1 scan = added lines of deliverable files | `document/process-refs.ts processReferenceScan` (pure) over `git.ts unitAddedLines` (the `+` lines of baseline..worktree, plus whole untracked files; binary and >1 MiB skipped). Scope `p1Scope`: non-process roles minus agent-contract surfaces (root `AGENTS.md` — its pointer block names PLAN.md — and `.opencode/**`, which holds the contract and prompt overlays). Shapes: `docs/T-…`, `docs/R-<n>…`, `docs/phases/…`, root `PLAN.md`, `.auto/…`. Added lines, not whole files: a unit touching a file with older references is not blamed for them (0036's "never the existing tree", made line-exact). |
| D9 | Wired into subtask close-out only | `subtaskArtifactProblems` (execute.ts), sharing the shape checks' gating and re-prompt-then-block loop. Whole-task sessions and wrap-up have no natural-end check loop today; they get the prompt discipline (D10) but no mechanical check — a known gap, not a new loop in M2.3. |
| D10 | P1 prompt discipline is intent | `## governance` / `### process-references`, injected into subtask.md and whole.md (`processRefs`). Carries the marker ruling: AUTO-* lines may sit in code comments, each self-contained, never pointing at a process document. The pack states the rule, not the mechanism (the whole-task path has no check, D9). |
| D11 | test-wrapup split, byte-identical | The two completeness sentences move to `## governance` / `### test-handover-finish` and `### test-handover-leftover`; the protocol (what to write, where, the status line) stays in the template. The built-in render is byte-identical (golden unchanged); an empty pack yields "…handover notes. Remaining work that you do not list here…". |
| D12 | Where the text lives | Standardization boundary + P1: the roles.ts header (code is the first carrier) and one invariant line in the package AGENTS.md. Intent-pack trust boundary (F17b): shell-contract §C.2, at parity with modes. |

## 3. Standardization boundary (as written in roles.ts)

The driver's protocol markers constrain exactly two kinds of file: the index
and state files it parses (PLAN.md, the ledger, subtasks.md checklist items and
their `产出:` declarations, the todo.md anchors, the report result line) and the
handoff documents (status line, four handover sections). Everything else a
session writes under `docs/T-NNN/` is free content: the only mechanical demands
are the shape check and the section anchors a decomposition declared for
itself. New protocol surface should prefer a marker in an index or handoff file
over a schema on free content.

## 4. Verification

- auto-core: typecheck clean; `bun test` 1035 pass / 0 fail (981 + 54 new:
  `test/document-roles.test.ts` classifier table, policies, scan shapes and
  look-alikes, `unitAddedLines` git fixture; two runSubtask close-out cases in
  `test/subtask-shape.test.ts`; two prompt cases in `test/prompt-exec.test.ts`).
- Golden: only `subtask.golden.md` and `whole.golden.md` change (the P1
  paragraph); `test-wrapup.golden.md` byte-identical (D11).
- Import direction: `document/state` and `document/process-refs` join the
  document entries; `protect` freezes `["document/roles"]`; the `AddedLine`
  type lives in `document/types.ts` so the document domain never imports
  driver `git.ts`.
- packages/auto: typecheck clean, 52 pass / 2 skip, zero changes.

## 5. Not done here

- Id namespace and `destDir` (R3) — MP.
- Acceptance marker literal and the `appendLedger` gate — M3.
- Whole-tree P1 scan at round close — M4.
- Protocol-string flips (`状态:`, handover sections) — M2.4; 0035's parse-point
  column for them now reads `src/document/roles.ts`.

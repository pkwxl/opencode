# 0028 — M0.6 F4 bilingual golden mapping review

Status: done (2026-09-19). Retires when all M1-M4 template translation batches have landed (the mapping table below is their consumption list; delete this file at MA/M4 closure).

## Scope

F4 gate for M0.6 (AUTO_NEXT_REFACTOR_PLAN.md): paragraph-by-paragraph manual mapping review of the bilingual golden corpus, plus a spot-check that batches 1-4 changed translation only, no mechanism.

Corpus: `test/golden/*.golden.md`, 47 files, rendered by `test/golden.test.ts` (31 session templates + agent contracts, fixed fixtures, `UPDATE_GOLDEN=1` to regenerate).

## Findings

1. **Zero golden drift from M0.6.** Batches 1-4 touched only `src/` human-facing strings and test assertions; no template was touched, and no code-injected segment leaks into any golden. Suite green throughout (auto-core 897 pass, packages/auto 54 pass).
2. **Golden corpus is Chinese-template + protocol/data segments; no English prose anywhere.** Per-file line audit (non-CJK non-empty lines): agent-contract-* → 3 lines each, all YAML frontmatter (`---`, `mode: primary`); infer-source / prior-knowledge → 1 line each, a fixture path (`docs/R-0N/prior-kb.md`). Everything else is template prose (Chinese) or protocol fragments (`- [done]`, `状态:`, `产出:`, `<!-- auto: eof -->`).
3. Consequence: the M0.6 English code surface and the golden corpus are **disjoint** — golden byte-equivalence (F9 搬移段校验) is unaffected by M0.6, and each future template translation batch flips exactly the goldens of its own template (one `UPDATE_GOLDEN=1 bun test test/golden.test.ts` regen per batch, no cross-batch coupling).

## Mapping: golden group → template source → owning loop (flips at that loop's template translation step)

| Golden files | Template source | Owning loop |
|---|---|---|
| subtask, understand, decompose-generic, decompose-{a,d,m,t,v,k}, fix, stuck-hint-{1,2,3}, handoff-steer, test-continue, test-result, test-wrapup | `templates/prompts/{subtask,understand,decompose,decompose-*,fix,stuck-hint,handoff-steer,test-*}.md` | **M1** subtask loop (18 files) |
| whole, wrapup, review-{task,fix,final}, final-task-{audit,audit-r2,remediate,validate,finalize}, verify-judge, verify-script-gen, dryrun | `templates/prompts/{whole,wrapup,review,review-fix,final-task,verify-*,dryrun}.md` | **M2** task loop (13 files; dryrun = run startup precheck, entry of this loop) |
| phase-plan-{a,d,m,t,v,k}, phase-handover, knowledge, number-recovery, infer-source, prior-knowledge, implement-plan, implement-plan-file | `templates/prompts/{phase-plan,phase-handover,knowledge,number-recovery,infer-source,prior-knowledge,implement-plan}.md` | **M3** phase loop (12 files; implement-* = single-phase m shortcut planning family) |
| agent-contract-{plain,verify,testbydriver}, context-base | `renderAgentContract` (loop-preflight) / `renderContextBase` | **MA** parallel track (4 files; context-base = session fork-base digest, session infra) |

Shared-vocabulary caveats for the consuming batches:

- `fix` template serves subtask fix rounds; if task-level fix injection reuses it, the M1 batch's flip covers both (single template source).
- Protocol strings inside templates (`状态:`, `结论:`, `- [done]`, `产出:`, `<!-- auto: eof -->`, `testhandoff` naming family, AUTO-DECISION/AUTO-RESOLVE markers) flip **only** at the driver-protocol lockstep step (open question 11, registered at M1.5), never inside a prose translation batch.
- `phaseText` phase names (分析/设计/…) and ledger line protocol are M3.4 scope; phase-plan-* prose may flip earlier without touching them.

## Spot-check: translation only, no mechanism (commit 83f327ef9)

Diff audit over all `src/` changes in the M0.6 commit (1580 +/- lines):

- Only identifier-level change: `classZh` → `classLabel` rename in `session.ts` (mechanical, 3 use sites + declaration; tests updated in same commit).
- All other changes are string-literal content or comments. No control-flow, signature, or import changes.
- Behavioral verification: full suites green post-commit (auto-core 897 pass / typecheck clean; packages/auto 54 pass / typecheck clean), including the incident regression set and golden byte-equivalence.

Verdict: M0.6 code surface = translation + one rename; mechanism unchanged.

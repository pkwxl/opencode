# 0072 — AGENTS.md retirement and prompt-carrier consolidation

Status: **proposal, 2026-10-03.** Drafted after the R-02 program landed (T-114..T-129),
per the person's ruling of 2026-10-03 (follow-ups enter via `plan --append`, each behind
its own design doc + ruling). Covers original requirements 1 and 6: retire the tailored
AGENTS.md the driver maintains in the target directory, folding its conventions into the
agent contract and the prompt hierarchy — and make that hierarchy contradiction-free
first. Nothing here is ruled yet.

## 1. Problem

The behavioral rules a session must obey (task-pointer discipline, the test-by-driver
protocol, the commit prohibition, the no-closing-summary rule, the reference/storage
conventions) currently travel in **three manually-synced carriers**:

1. the AGENTS.md marker block — `src/agents-block.ts` (POINTER / TEST_PRINCIPLE /
   COMMIT_PRINCIPLE / SUMMARY_PRINCIPLE / REFS_SPEC), written by init/amend/fix, read-only
   during run, gitignored;
2. the agent contract — `templates/.opencode/agent/auto.md` (items 1, 2, 5 overlap the
   block nearly verbatim);
3. the prompt partials — `_partials.md` `state-rule` (inlined by 15 templates) plus inline
   copies (e.g. the test protocol inlined again in `whole.md`).

No audit has ever checked the three carriers against each other for contradictions,
drift, or staleness — they stay in sync by hand. 0054 already retired session-maintained
AGENTS.md and the CURRENT.md mirror; the file now holds only the driver's block, whose
sole remaining function is per-turn system-context injection — which the agent contract
already provides (both are system context every provider turn; the claude adapter
appends the `auto.md` body to its system prompt per process start, `src/opts.ts`
CONTRACT_AGENT).

## 2. Proposal — two units

**U-A · prompt contradiction audit (read-only, first).** A review unit in 0069's own
pattern: bounded read lists over `templates/prompts/*.md`, `_partials.md`,
`templates/intents/default.md`, the `auto.md` contract, and `src/agents-block.ts`;
deliverable a findings table — contradiction / duplication / stale, every finding cited.
Constraints preserved: tier-1 driver-enforced markers and the `test/prompt-*.test.ts`
goldens are inputs to read, not things to change. Now that the role registry exists
(T-123), role-owned prompt assembly is descriptor-backed — the audit maps each finding to
its owning carrier (contract / partial / role descriptor / intent pack), which is exactly
the consolidation target list.

**U-B · consolidation and retirement.** One carrier per rule:
- behavioral contract (pointer, test protocol, commit prohibition, summary rule,
  reference/storage conventions — REFS_SPEC lives only in the block today and must move)
  → the `auto.md` contract (already rendered conditionally on `testByDriver`);
- per-role specifics → partials and role descriptors, per the audit's mapping.
- Retire: `ensurePointer`/`removePointer` and their init/amend/fix/reset/`fix`-hint
  call sites; `protect.ts`'s AGENTS.md write-lock (config protection stays); the
  `AGENTS.md` entry of the init gitignore set; `agents-block` tests.
- Preflight gains an idempotent janitor that removes a block an earlier release left
  (the pattern is `removeRetiredCurrent`); it prints what it cleaned.
- The two-tier marker discipline is untouched: tier-1 grammar stays minimal; tier-2
  intent guidance stays marker-free.

## 3. The trade-off that needs the person

Retirement narrows scope: AGENTS.md is injected for **every** session in the directory —
including the person's own interactive opencode sessions and other agent tools — while
`auto.md` binds only the `auto` agent's sessions. After U-B, an interactive session that
commits or edits state files no longer reads the prohibition. The mechanical backstop
still holds (close-out's SHA-baseline check detects any non-`Auto-Stage` commit in range
and blocks), and the person's own sessions are theirs to govern — but this is a real
policy change, not just cleanup. Recommendation: accept the narrowing; the driver's
mechanical fences, not prose in a gitignored file, are the protection that matters.

## 4. Risks

- The claude-adapter translation path (contract → claude system prompt) must be re-pinned
  by tests in the same unit (it reads the same `auto.md` source — no behavior change
  expected, only more content).
- Compaction safety is preserved by construction (agent body = per-turn system context);
  the audit should still verify no rule depends on AGENTS.md being workspace-level.
- Migration is one release long: the janitor is self-limiting debris cleanup (0069 D15
  pattern); schedule its deletion when old releases age out.

## 5. Rulings asked

1. Accept the scope narrowing (§3)?
2. U-A and U-B as separate units (audit first, consolidation second), or one?
3. Does the round input for these units reference this doc only, or also pre-rule the
   carrier mapping (recommend: let the audit produce it, then the person approves it as
   part of U-B's acceptance)?

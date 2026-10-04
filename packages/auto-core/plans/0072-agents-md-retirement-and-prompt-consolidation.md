# 0072 — Prompt-carrier consolidation (AGENTS.md kept as the constitution layer)

Status: **proposal, amended 2026-10-03.** The first draft proposed retiring the AGENTS.md
block; re-weighed against the standalone prompt-session direction (plans/0076, settled in
discussion the same day) the retirement is **dropped** — the block stays as the
constitution layer. Still covers original requirements 1 and 6: every behavioral rule
reaches every session exactly once, from one source, contradiction-free under every
parameter decision. Ruled 2026-10-04: all three rulings accepted as recommended (§5).

## 1. Problem

The behavioral rules a session must obey (task-pointer discipline, the test-by-driver
protocol, the commit prohibition, the no-closing-summary rule, the reference/storage
conventions) currently travel in **three manually-synced carriers**:

1. the AGENTS.md marker block — `src/agents-block.ts` (POINTER / TEST_PRINCIPLE /
   COMMIT_PRINCIPLE / SUMMARY_PRINCIPLE / REFS_SPEC), written by init/amend/fix, read-only
   during run, gitignored;
2. the agent contract — `templates/.opencode/agent/auto.md` (items 1, 2, 5 overlap the
   block nearly verbatim);
3. the prompt partials — `_partials.md` `state-rule` (inlined by 14 templates) plus inline
   copies (e.g. the test protocol inlined again in `whole.md`).

No audit has ever checked the three carriers against each other for contradictions,
drift, or staleness — they stay in sync by hand, and the drift is already real (REFS_SPEC
points at a "stable-refs design document" that exists in no target directory, and the
reference checker it referred to retired with 0061).

The disease is the manual sync, not the carrier count. Each carrier reaches a different
audience, and 0076's hand-driven sessions make the split load-bearing:

| carrier | audience | hand-driven session (0076) |
|---|---|---|
| AGENTS.md block | every session in the directory | reached |
| `auto.md` contract | driver-started sessions only | not reached |
| rendered prompt | the session it is rendered into | reached |

Retiring the block would leave the sessions the person drives inside other coding agents
with no rule carrier at all. So: keep all three carriers, give each rule exactly one
owning layer, and mechanize the sync.

## 2. Proposal — two units

**U-A · prompt contradiction audit (read-only, first).** A review unit in 0069's own
pattern: bounded read lists over `templates/prompts/*.md`, `_partials.md`,
`templates/intents/default.md`, the `auto.md` contract, and `src/agents-block.ts`;
deliverable a findings table — contradiction / duplication / stale, every finding cited —
**with an audience tag per rule**: *every session* → block, *driver sessions* → contract,
*this role* → partial / role descriptor. The tag decides the owning layer; the person
approves the mapping as part of U-B's acceptance. Constraints preserved: tier-1
driver-enforced markers and the `test/prompt-*.test.ts` goldens are inputs to read, not
things to change.

**U-B · layer-ownership consolidation.** One wording per rule, at its owning layer:
- **constitution** — the AGENTS.md block, generated from the `agents-block.ts` constants:
  pointer, state-file ownership, commit prohibition, summary rule, reference/storage
  conventions (REFS_SPEC stays here — its audience is every session);
- **operating manual** — the `auto.md` contract, slimmed to driver-operational protocol:
  role naming, question escalation and proxy-answer semantics, problem handling; the
  sentences restating constitution rules (the pointer of item 1, the state-file and
  test sentences of item 2, the commit prohibition of item 5) are deleted — the AGENTS.md
  note in item 2 stays, still accurate;
- **work order** — partials and role descriptors keep role-specific text only;
  `state-rule` slims to what no other layer states.

Mechanization: the constants in `src/agents-block.ts` become the single source — beside
the block they also render 0076's constitution preamble (one source, two renderings) —
and a **drift ratchet test** (the `chain-writes` pattern) fails when any other carrier
restates a constitution rule's wording.

Dropped from the first draft: the preflight janitor, the protect/gitignore/call-site
removal, the agents-block test deletions — the block is permanent.

## 3. The trade-off, resolved

The first draft's §3 — the scope narrowing where, after retirement, the person's own
interactive sessions would no longer read the prohibitions — is moot: AGENTS.md keeps its
every-session reach and gains 0076's hand-driven audience. The mechanical backstops
(SHA-baseline audit; 0076's adopt-step validation) fence the runs and the close-out; the
constitution prose fences everything else, as it does today.

## 4. Risks

- The ratchet is wording-based: paraphrase drift (same rule, different words) is caught
  by the audit cadence, not the ratchet. Name the trigger: any edit to a carrier (block,
  contract, partial, descriptor) reruns the audit's contradiction case.
- The claude adapter path shrinks, not grows (the contract loses items, gains none);
  its translation tests re-pin in the same unit.
- Compaction safety unchanged: block and contract are both per-turn system context.

## 5. Rulings (decided 2026-10-04 — all as recommended)

1. Layer ownership decided by the audit's audience tag (recommended)?
2. `agents-block.ts` constants as the single source (block + 0076 preamble + ratchet), or
   ratchet-only without the shared rendering?
3. U-A then U-B as separate units (recommended)?

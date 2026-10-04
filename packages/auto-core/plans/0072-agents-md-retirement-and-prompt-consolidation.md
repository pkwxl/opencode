# 0072 — Prompt-carrier consolidation (AGENTS.md kept as the constitution layer)

Status: **proposal, amended 2026-10-03.** The first draft proposed retiring the AGENTS.md
block; re-weighed against the standalone prompt-session direction (plans/0076, settled in
discussion the same day) the retirement is **dropped** — the block stays as the
constitution layer. Still covers original requirements 1 and 6: every behavioral rule
reaches every session exactly once, from one source, contradiction-free under every
parameter decision. Ruled 2026-10-04: all three rulings accepted as recommended (§5).
**U-A executed 2026-10-04 (T-130):** the read-only contradiction audit is complete —
4 contradictions, 12 duplications, 3 stale findings, and the full rule-to-layer mapping
are in §6; the mapping goes to the person for approval as part of U-B's (T-131's)
acceptance. Audit cadence (§4, in force from now): any later edit to a carrier — the
block (`src/agents-block.ts`), the contract (`templates/.opencode/agent/auto.md`), a
partial (`templates/prompts/_partials.md`), a template/descriptor
(`templates/prompts/*.md`, `templates/intents/default.md`) — reruns §6's contradiction
case before it lands.

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

## 6. U-A findings — the contradiction audit (T-130, executed 2026-10-04)

Read-only, per §2 U-A. All paths below are relative to `packages/auto-core/` unless they
start with `plans/`.

### 6.1 Inputs and method

Read in full: `src/agents-block.ts` (the five block constants + `renderAgentsBlock`),
`templates/.opencode/agent/auto.md` (contract, 5 items), `templates/prompts/_partials.md`
(all 15 sections), all 31 files of `templates/prompts/*.md`, and
`templates/intents/default.md` (all intent subsections). The `test/prompt-*.test.ts`
goldens under `test/golden/` (49 golden files, including
`agent-contract-{plain,testbydriver}.golden.md`) were read as pins: every wording this
audit marks for change is golden-pinned, so U-B re-pins in the same unit. Mechanical
facts were diff-verified, not eyeballed: the six `decompose-{a,d,k,m,t,v}.md` files are
byte-identical to each other (the generic `decompose.md` differs only by the
phase-name/duties variables and the item numbering), and the inline test protocol in
`whole.md:38` and `subtask.md:48` is byte-identical (no drift — yet).

AUTO-DECISION: the unit of "rule instance" is one carrier wording that must be kept in
sync by hand — a block paragraph, a contract item or clause, a partial section, an inline
protocol text in a template, an intent subsection. A `{{> partial}}` reference is a *use*
of the partial's instance, not a second instance (uses cannot drift on their own); the
per-partial inlining-site counts below state where each partial lands. Every instance
appears in §6.3 exactly once per rule it carries — a wording stating two rules (the
planners' constraint 1 carries both the state-file and the commit rule) is cited in both
rules' rows, once each; §6.5 accounts for every file of the five surfaces, so there are
zero unclassified instances.

### 6.2 Findings

Markers: ✕ contradiction, ○ duplication, ◈ stale. Every finding carries its citations.

**Contradictions (4)**

| # | finding | citations |
|---|---|---|
| K1 ✕ | The question policy's ask/humanQuestions branches contradict the statically-rendered contract. The contract's item 3b says, unconditionally: "do not call the question tool [for non-permission problems]: decide how to proceed on your own … Calling the question tool for a non-permission problem gets an automatic reply from the DRIVER". The contract is rendered with exactly one switch — `{ testByDriver }` — so every session in every ask mode reads that text. Under `humanQuestions=true` the same session's prompt says the opposite: "ask with the question tool — a human is attending this planning run and the DRIVER waits for the answer with no timeout; **there is no automatic proxy answer**"; under `ask=true` it says to ask and carry on per the recorded proxy answer. Two carriers, one parameter set, opposite instructions. | `templates/.opencode/agent/auto.md:27-34` (static text); `src/config-fix.ts:52-53` (`renderAgentContract` passes only `testByDriver`); `templates/prompts/_partials.md:27-30` (humanQuestions branch), `:35-39` (ask branch); switch threading at `src/prompt.ts:165-191` |
| K2 ✕ | The summary prohibition is contradicted by the dryrun preflight prompt — and the prohibition's premise is mechanically false there. The block tells every session "do not produce a closing summary … in your final chat turn … DRIVER is non-interactive and never reads chat text"; the dryrun template ends with "your final message restates the report's key points", and the driver then prints that final message as the run log's "highlights" — it *does* read chat text for this session. Same session, same turn, both texts (the block is in the target directory's AGENTS.md; the dryrun session runs there). | `src/agents-block.ts:39` (SUMMARY_PRINCIPLE); `templates/prompts/dryrun.md:15`; consumer `src/loop.ts:262` (`result.lastText`) |
| K3 ✕ | The test rule's command class differs between carriers. The block's class is closed — "build, test, compile, and lint commands … are always run by DRIVER"; the contract extends it — "Build, test, compile, lint **and other commands that can be slow or produce large amounts of output**"; the inline copies say "or similar commands". Under `testByDriver=on`, `knowledge.md`, `prior-knowledge.md` and `split-rejected.md` tell the session to run `git log --oneline` (or `git log`/`git diff`) itself: inside the contract's open class (a large repository's log is slow/large), outside the block's closed class. A session asking "may I run git log myself?" gets different answers from the block and from the contract. | `src/agents-block.ts:35` (closed class) vs `templates/.opencode/agent/auto.md:17-18` (open class) vs `templates/prompts/whole.md:38`, `subtask.md:48` ("or similar"); the caught sessions: `templates/prompts/knowledge.md:19-20`, `prior-knowledge.md:40-41`, `split-rejected.md:1` |
| K4 ✕ | The t-phase planner duty asserts the test protocol regardless of the switch. `### t testing` says "Test execution follows the test execution protocol (with --test-by-driver enabled, scripts are handed to the DRIVER to run)" and is injected into every `decompose-t` render ungated (only a parenthetical carries the condition). Under `testByDriver=off` the planner still reads the protocol as the asserted mode of test execution, while no other carrier states any test rule at all — a planner following it writes subtask descriptions that hand scripts to a DRIVER that will not run them. | `templates/intents/default.md:88`; ungated injection at `src/prompt.ts:337` (`phaseDuties: duties && renderText(duties, ctx)` — no testByDriver branch) |

**Duplications (12)**

| # | finding | citations |
|---|---|---|
| K5 ○ | Contract items 1/2/5 restate the block nearly verbatim (the §1 lead, confirmed; item 2's first sentence included). Item 1 ≈ POINTER (pointer discipline, "normally don't need to read state files", reread-after-compaction); item 2 s1 ≈ POINTER s3 + `state-rule`; item 2's testByDriver branch ≈ TEST_PRINCIPLE; item 5 ≈ COMMIT_PRINCIPLE. All four are U-B's planned deletions; the item-2 tail (the AGENTS.md marker-block note) stays by §2's ruling. | `templates/.opencode/agent/auto.md:13-15`, `:16`, `:17-22`, `:36-39` vs `src/agents-block.ts:33`, `:35`, `:37`; the staying note `auto.md:23-25` |
| K6 ○ | The test protocol exists as four full wordings plus two short forms plus one duty paraphrase, all hand-synced: block, contract branch, and the byte-identical inline copies in `whole.md` and `subtask.md` (the §1 lead "inlined again in whole.md", confirmed and extended — subtask.md carries the same inline copy, and the re-run mechanics exist only in the prompt copies). Root cause is the partials header's rule that conditional blocks are not partials — but `question-rule` proves same-line-tag conditional partials are feasible, so a `test-protocol` partial is buildable. | full: `src/agents-block.ts:35`, `templates/.opencode/agent/auto.md:17-22`, `templates/prompts/whole.md:37-38`, `subtask.md:47-48`; short: `test-continue.md:1-2`, `test-result.md:7`; paraphrase: `templates/intents/default.md:88`; engine constraint `templates/prompts/_partials.md:8-10` vs the feasible pattern `:11-16`, `:26-39` |
| K7 ○ | The commit prohibition travels in five wordings: the block, the contract item 5, `state-rule`'s second line (which smuggles it into 14 templates), the constraint-1 tail of all four planning/handover templates, and fanout's "The DRIVER's commit is this stream's record" variant. | `src/agents-block.ts:37`; `templates/.opencode/agent/auto.md:36-39`; `templates/prompts/_partials.md:42` (14 sites listed in §6.5); `implement-plan.md:70-73`, `phase-plan.md:124-127`, `phase-append.md:118-122`, `phase-handover.md:90-93`; `fanout.md:26` |
| K8 ○ | State-file ownership is the most-restated rule in the system: the block, the contract, the `state-rule` partial, two clauses of `doc-layout`, an inline sentence in `subtask.md` that duplicates the `state-rule` include *of the same template* (one render states it twice), decompose's constraint 4 (×6 files), whole's split clause, fanout (×2), and the four planning/handover constraints. | `src/agents-block.ts:33`; `auto.md:16`; `_partials.md:41`, `:66-67`, `:72-73`; `subtask.md:25` (+ its `:42` include); `decompose.md:57-58`, `decompose-{a,d,k,m,t,v}.md:58-59`; `whole.md:35`; `fanout.md:12`, `:26`; the four constraints of K7 |
| K9 ○ | Two storage-convention texts with drifting enumerations: REFS_SPEC item 1 (block) and `doc-layout` (partial) both legislate what lives where and the permanence doctrine, but each names files the other lacks — `doc-layout` adds `shared.md`, the flat-file ban and phase-artifact placement; REFS_SPEC adds `prior-kb.md`, `kb.md` and the handoff/testhandoff roles. Neither contradicts the other today; both must be edited in tandem for any placement change. | `src/agents-block.ts:42` vs `templates/prompts/_partials.md:62-73` |
| K10 ○ | `wrapup.md` item 2 restates REFS_SPEC items 2–3 nearly verbatim, specialized to `report.md` — relative-path reference form, confirm-before-writing, the post-0061 "the DRIVER does not check references afterwards" sentence (the 0061 R6 replacement text now maintained in two places), and the round-state-file reference ban. | `templates/prompts/wrapup.md:14-18` vs `src/agents-block.ts:43-44`; replacement ruled at `plans/0061-driver-consolidation-plan.md:116-119` (R6) |
| K11 ○ | Six byte-identical template files: `decompose-{a,d,k,m,t,v}.md` carry no phase-specific text of their own (all differences travel as `{{phaseName}}`/`{{phaseDuties}}`/`{{decomposeRule}}` variables, selected per phase), so any wording fix to the decompose family must be applied six times to files that differ in nothing. | diff-verified identical: `templates/prompts/decompose-{a,d,k,m,t,v}.md`; selection `src/prompt.ts:317-319`, `src/template.ts:34-39`, `:82-87` |
| K12 ○ | The context-budget handover protocol is restated per surface with ~90 % shared text: the task, subtask and stream variants plus the two driver steers and the wall notice — six wordings of "write {{handoffFile}}, end it with the verbatim `Status: continue\|done` line, then end the session". Per-surface naming is by design; the invariant core is hand-copied. | `whole.md:20`; `subtask.md:45`; `fanout.md:31`; `handoff-steer.md:1`; `usage-note-winddown.md:1`; `test-wrapup.md:9` (continue-only, deliberately — see `src/document/roles.ts:213-221`) |
| K13 ○ | The decision-marker discipline drifts between carriers: the contract's item 3b hardcodes `AUTO-DECISION: <decision and reason>` (and omits AUTO-RESOLVE entirely), while the canonical formats are core-owned constants — `AUTO-DECISION: <decision> (<reason>)` — injected into the partial, which also carries AUTO-RESOLVE. The driver scans this marker family (`src/resolve.ts`); two punctuation shapes for one scanned marker is drift on a protocol-adjacent string. | `templates/.opencode/agent/auto.md:28-32` vs `src/prompt.ts:183-184` (RESOLVE_FORMAT/DECISION_FORMAT) and `_partials.md:34` |
| K14 ○ | The rationale sentence "so that the next session can understand the current progress from the files on disk alone" appears verbatim in the contract's item 4 and in wrapup's step 1. | `templates/.opencode/agent/auto.md:35`; `templates/prompts/wrapup.md:12` |
| K15 ○ | The block's own anti-contradiction clause ("Task descriptions and project conventions must not contain instructions that contradict this") is appended to three of its five paragraphs (test, commit, summary) and absent from two (pointer, refs) — an intra-block inconsistency of the meta-rule U-A itself exemplifies. | `src/agents-block.ts:35`, `:37`, `:39` vs `:33`, `:41-44` |
| K16 ○ | The chmod prohibition ("must not restore write permission with chmod or the like") is split between the contract and the four planning/handover constraints, in two wordings — and is absent from the block, so the sessions 0076 adds (hand-driven, not driver-started, not planners) receive no chmod rule at all. A duplication whose real content is a coverage gap. | `templates/.opencode/agent/auto.md:17`; `implement-plan.md:71-72`, `phase-plan.md:125-126`, `phase-append.md:121-122`, `phase-handover.md:92-93`; absent from `src/agents-block.ts` (whole file) |

**Stale (3)**

| # | finding | citations |
|---|---|---|
| K17 ◈ | REFS_SPEC's header points at a document no target directory holds. "see the stable-refs design document for the full rationale" — that document is `plans/0010-stable-refs-design.md`, a plan of this tool repository; AGENTS.md is rendered into *target* directories, whose `docs/` holds only that project's own task and round documents, so the instruction is unfulfillable for every reader it addresses. It also predates 0061: the reference checker whose rationale that document mainly records retired with 0061 (REFS_SPEC item 3 is already the post-0061 text; only the header pointer is stale). | `src/agents-block.ts:41`; the document's only home `plans/0010-stable-refs-design.md`; retirement `plans/0061-driver-consolidation-plan.md:13`, `:32-33` (F13), `:116-119` (R6), executed as T-051 (`git log`: `9b578a466`); residual cleanup `src/loop-preflight.ts:382` |
| K18 ◈ | The P1-exemption comment rests on retired vocabulary: "the AGENTS.md **pointer block** tells sessions where docs/T-NNN lives". No distinct pointer block exists since the merge to one canonical block — the legacy named blocks (including a pointer-only block) are deleted by `LEGACY_BLOCK`, and the merged block's REFS_SPEC names far more process paths than `docs/T-NNN`. Comment-only staleness; the substance (AGENTS.md is an agent-contract surface outside P1 scope) remains true. | `src/document/roles.ts:180-188` vs `src/agents-block.ts:22-31` (`CANONICAL_BLOCK`, `LEGACY_BLOCK`) |
| K19 ◈ | Adjacent-surface drift found while counting: `src/prompt.ts`'s comment claims `question-rule` "is referenced by 23 templates"; the actual count is 17. Same class as K18 — a maintenance comment describing the carrier surface has drifted. | `src/prompt.ts:168` vs `grep -l '{{> question-rule}}' templates/prompts/*.md | wc -l` = 17 |

Checked and deliberately **not** findings: (a) `classify-error.md`'s "reply with exactly
one line of JSON" and `context-base.md`'s "a short acknowledgement reply is enough" do
not contradict the summary prohibition — the reply *is* those sessions' deliverable, not
wrap-up narration, and the classifier runs on the adapter's default agent, outside the
contract surface (`src/classify.ts:16-18`); (b) the "add to docs/ but not modify it"
rule (whole/subtask/fanout) vs wrapup's "update the documents in docs/" is role
separation, not a parameter-set conflict — no session receives both; (c) the
prompt-side P1 discipline vs the mechanical prohibition scan is the designed two-layer
enforcement (`src/document/roles.ts:41-44`), not drift; (d) the `{{^ask}}` gating of the
AUTO-DECISION annotation clause (`whole.md:17`, `subtask.md:42`, `fanout.md:12`) is
branch-consistent with the ask semantics.

### 6.3 The rule-to-layer mapping

Tags per §2 U-A: **[E]** every session → owning layer the AGENTS.md block; **[D]**
driver sessions → owning layer the `auto.md` contract; **[R]** this role → owning layer
the partial / role descriptor (rendered prompt). The tag is U-A's recommendation from
actual audience; the person approves it as part of T-131's acceptance (ruling 1). In the
instances column: **owner** marks the wording that should survive at the owning layer,
**dup** a duplicate to collapse in U-B, **keep** a role-specific text that survives
as-is; findings from §6.2 are cross-referenced.

**[E] every session — owned by the AGENTS.md block**

| rule | instances |
|---|---|
| E1 Pointer discipline (prompt inlines the task; `docs/T-NNN/` documents are the source of progress; reread on compaction/uncertainty; AGENTS.md is not a notes place) | `src/agents-block.ts:33` **owner** · `auto.md:13-15` **dup** (K5) · `auto.md:23-25` **keep** (the AGENTS.md marker-block note, stays per §2) |
| E2 State-file ownership (`todo.md`→`done.md` renames, index ticks and state files are DRIVER's alone) | `src/agents-block.ts:33` (s3) **owner** · `auto.md:16` **dup** (K5) · `_partials.md:41` (state-rule, 14 sites) **dup** (K8) · `_partials.md:66-67`, `:72-73` (doc-layout clauses) **keep, slimmed** (K9) · `subtask.md:25` **dup** (K8) · `decompose.md:57-58` + `decompose-{a,d,k,m,t,v}.md:58-59` **dup** (K8, K11) · `whole.md:35` (split clause) **keep** (role-specific: which files the DRIVER writes from split lines) · `fanout.md:12`, `:26` **keep** (stream-scoped) · `implement-plan.md:70-71`, `phase-plan.md:124-125`, `phase-append.md:118-120`, `phase-handover.md:90-91` **dup** (K8) |
| E2a chmod/protected-files (no chmod-restoring write permission on read-only surfaces) — *recommendation: fold into E2 at the block, closing the 0076 gap* | `auto.md:17` **dup** (K16) · `implement-plan.md:71-72`, `phase-plan.md:125-126`, `phase-append.md:121-122`, `phase-handover.md:92-93` **dup** (K16) |
| E3 Test-by-driver principle (slow/large-output commands run by DRIVER via `test/` + `tmp/test.sh`) — conditional on `testByDriver`; command class must be unified (K3) | `src/agents-block.ts:35` **owner** · `auto.md:17-22` **dup** (K5, K6) · `whole.md:37-38` **dup** (K6; keep only the operational extras: end-turn-to-wait, re-run, handoverTest rhythm) · `subtask.md:47-48` **dup** (K6, same) · `test-continue.md:1-2`, `test-result.md:7` **keep** (short re-anchors mid-conversation) · `default.md:88` **dup** (K4 — gate or reword to a conditional) |
| E4 Commit prohibition (one unified recursive DRIVER commit; no session commit/history command) | `src/agents-block.ts:37` **owner** · `auto.md:36-39` **dup** (K5) · `_partials.md:42` (state-rule line 2) **dup** (K7) · `implement-plan.md:72-73`, `phase-plan.md:126-127`, `phase-append.md:122`, `phase-handover.md:92-93` **dup** (K7) · `fanout.md:26` (first clause) **keep** (stream-scoped "commit is the record") |
| E5 Summary prohibition (no closing summary in the final turn) — needs the K2 carve-out resolved at the owner | `src/agents-block.ts:39` **owner** · `dryrun.md:15` **contradicts** (K2 — resolve with the owner: carve-out wording, or drop the restatement) |
| E6 Reference & storage conventions (permanent paths, storage layout, reference form, no round-state-file references, check-before-write) | `src/agents-block.ts:41-44` **owner** (`:41` stale header — K17) · `_partials.md:62-73` (doc-layout) **keep, slimmed to task-scoped placement** (K9) · `wrapup.md:14-18` **dup** (K10; keep only the report-specific instruction "every reference in the report …") · `_partials.md:76-82` (task-depends), `:83-88` (subtask-depends) **keep** (driver-parsed protocol descriptors) · format-block literals `phase-plan.md:96-108`, `phase-append.md:87-99`, `implement-plan.md:40-52` **keep** (by construction: they show the strings to write) |
| E-meta anti-contradiction clause (task descriptions must not contradict the constitution) | `src/agents-block.ts:35`, `:37`, `:39` **owner, harmonize to one rendering** (K15) |

**[D] driver sessions — owned by the `auto.md` contract**

| rule | instances |
|---|---|
| D1 Question/problem handling (permission problems → question tool; non-permission → decide-and-record under unattended semantics; proxy-answer machinery; re-ask = block) — the invariant core owns here; the per-branch wording must move to the partial (K1) | `auto.md:26-34` **owner, made branch-invariant** (K1, K13) · `_partials.md:26-39` (question-rule, 17 sites, incl. its zero-intent format fallback) **keep** (owns the branch wordings; K1) · `auto.md:6-8` (frontmatter permission comment) — maintainer comment, not a session rule (see §6.5) |
| D2 Contract housekeeping (role naming "decompose / single subtask / wrap-up"; documents under `docs/`) | `auto.md:2` (description), `:13` (role naming) **owner** · `auto.md:35` (item 4) **owner** — drop the duplicated rationale sentence (K14) |

**[R] this role — owned by partials / role descriptors**

| rule | instances |
|---|---|
| R1 Decision-record discipline (AUTO-RESOLVE/AUTO-DECISION, who-should-have-owned catalogs; formats are core-owned constants) | `src/prompt.ts:183-184` (canonical formats) **owner (code)** · `default.md:130-143` (decisions-unattended), `:145-154` (decisions-ask), `:156-159` (wrapup-audit) **keep** · `wrapup.md:25-33` (proxy-answered-questions section; `:32` hardcodes the AUTO-RESOLVE literal in the constant's shape, `:33`'s `{{auditScope}}` is wrapup-audit's only use site — `src/prompt.ts:562`) **keep** · `auto.md:28-32` **dup, delete with K5/K13** · `whole.md:17`, `subtask.md:42`, `fanout.md:12` (annotation clause) **keep** |
| R2 docs/ add-only (add, don't modify; unavoidable modification annotated and recorded) | `whole.md:17` · `subtask.md:42` · `fanout.md:12` — one wording each, **keep** (or promote to a partial in U-B if desired) |
| R3 eof terminator (`<!-- auto: eof -->` last line) | `_partials.md:57-61` **owner** (10 sites) · format-block literals of E6 **keep** (by construction) |
| R4 Context-budget handover protocol | `whole.md:20` · `subtask.md:45` · `fanout.md:31` · `handoff-steer.md:1` · `usage-note-info.md:1` · `usage-note-winddown.md:1` · `test-wrapup.md:9` — **keep** the per-surface naming, share the invariant core in U-B (K12) |
| R5 Verification scope (own changes' checks, not the full suite; last item runs the full acceptance once) | `subtask.md:27` · `fanout.md:24` · `default.md:13-15` (granularity criterion) — **keep** |
| R6 Role scoping & read scope (one task/subtask/stream only; other items belong to other sessions; plan-only/distill-only/read-only openings) | `_partials.md:21-25` (head, 10 sites) · `_partials.md:43-48` (ground-state, 1 site) · `whole.md:10` · `subtask.md:12-20`, `:24` · `fanout.md:1`, `:14-22` · `decompose.md:10` (+6 variants) · `implement-plan.md:1-3` · `phase-plan.md:1-2` · `phase-append.md:1-11` · `phase-handover.md:1-5` · `knowledge.md:1-3` · `prior-knowledge.md:1-5` · `dryrun.md:1` · `number-recovery.md:1-5` · `context-base.md:7-8` · `digest-index.md:7` — **keep** (per-role by nature) |
| R7 Planner duties (granularity, per-phase splitting criteria, parallelism levels, task/subtask document formats, auto-numbering) | `default.md:5-20` (decompose granularity) · `default.md:55-102` (phase duties a/d/m/t/v/k) · `default.md:197-217` (parallelism) · `_partials.md:89-123` (plan-duties-*) · `decompose.md:12-42` (+6 variants) · `phase-plan.md:66-121` · `phase-append.md:60-115` · `implement-plan.md:32-66` · `number-recovery.md:11-12` (number-protocol: the floor rule, "a number may be skipped but never reused") — **keep** |
| R8 P1 deliverable/process separation (no process-doc pointers in the deliverable) | `default.md:161-163` (process-references) **owner (intent)** · mechanical side `src/document/roles.ts:193-196` — designed two-layer, **keep** |
| R9 Leftover marking (AUTO-FIXME) | `stuck-hint.md:15` · `test-continue.md:2` — **keep** |
| R10 In-session git log/diff reads (knowledge, prior-knowledge, split-rejected) | `knowledge.md:19-20` · `prior-knowledge.md:40-41` · `split-rejected.md:1` — **keep**, and K3's class unification must leave them explicitly legal (bounded read-only git reads) |
| R11 Driver-parsed document protocols (result line; handover four sections; prior-knowledge DONE mark) | `default.md:106-112` (result-line) · `wrapup.md:20-24` · `_partials.md:115-117` (plan-duties-v) · `phase-handover.md:41-62` (four-sections literal) · `prior-knowledge.md:46-50` (DONE mark) · parse side `src/document/roles.ts:238-251`, `:264-274` — **keep** |
| R12 dryrun final-message restatement | `dryrun.md:15` — **resolve with K2** (either the restatement or the summary rule's carve-out) |
| R13 Utility-session reply discipline (one-line JSON; ack-only) | `classify-error.md:14-15` · `context-base.md:7-8` — **keep** (outside the contract surface; default agent) |
| R14 Self-check, knowledge quality, stuck reflection, round-brief respect, acceptance drafting, artifact specs, test-handover finish/leftover, digest discipline | `default.md:22-28`, `:30-45`, `:47-53`, `:114-118`, `:120-126`, `:165-171`, `:173-195` · `_partials.md:49-56` (digest-rule) · `knowledge.md:71-72`, `prior-knowledge.md:97-98` (distil-not-enumerate knowledge quality) · `phase-handover.md:48-49` (the AUTO-DECISION-priority clause of the Key-decisions literal) · `test-wrapup.md:1-10` — **keep** (single-carrier role text, no cross-carrier overlap) |

### 6.4 The known leads, settled

1. REFS_SPEC's "see the stable-refs design document" — **confirmed** (K17): the document
   exists only as `plans/0010-stable-refs-design.md` in this tool repository, never in a
   target directory, and the checker whose rationale it records retired with 0061
   (`plans/0061-driver-consolidation-plan.md` F13/R6, executed as T-051).
2. The test protocol inlined again in `whole.md` beside `state-rule` — **confirmed and
   extended** (K6): `whole.md:37-38` inline beside the `state-rule` include at `:18`,
   plus a byte-identical copy in `subtask.md:47-48` and two short forms (K6's citations).
3. The contract's items 1/2/5 restate the block nearly verbatim — **confirmed** (K5),
   including item 2's first sentence; the item-2 AGENTS.md note stays accurate, as §2
   already records.
4. `document/roles.ts`'s P1-exemption comment rests on "the pointer block" —
   **confirmed** (K18): stale vocabulary only; the exemption's substance survives the
   block merge unchanged.

None refuted.

### 6.5 Coverage ledger (zero unclassified instances)

Every file of the five read surfaces, accounted for: `src/agents-block.ts` — five block
paragraphs (E1–E6 rows) plus code comments (maintainer documentation, not session
rules). `templates/.opencode/agent/auto.md` — frontmatter + permission comment
(maintainer comment), items 1–5 (E1, E2, E2a, E3, E4, D1, D2, R1 rows). All 15 sections
of `templates/prompts/_partials.md` — header (maintainer doc), `head` (R6),
`question-rule` (D1, R1), `state-rule` (E2, E4), `ground-state` (R6), `digest-rule`
(R14), `eof-rule` (R3), `doc-layout` (E2, E6), `task-depends`/`subtask-depends`
(E6), `plan-duties-{a,d,m,t,v,k}` (R7, R11). All 31 template files:
`classify-error.md` (R13), `context-base.md` (R13), `decompose.md` + six identical
variants (E2, E3-via-duty, R6, R7 + `{{>}}` uses), `digest-index.md` (R6),
`dryrun.md` (E5/R12 + `{{> state-rule}}`), `fanout.md` (E2, E4, R2, R4, R5, R6),
`handoff-steer.md` (R4), `implement-plan.md` (E2, E2a, E4, E6 literals, R6, R7),
`knowledge.md` (E2/E4 via partial, R6, R10, R14), `number-recovery.md` (E2/E4 via
partial, R6, R7), `phase-append.md` (E2, E2a, E4, E6 literals, R6, R7),
`phase-handover.md` (E2, E2a, E4, R6, R11/R14), `phase-plan.md` (E2, E2a, E4, E6
literals, R6, R7), `prior-knowledge.md` (E2/E4 via partial, R6, R10, R11, R14),
`split-rejected.md` (R10), `step-up.md` (informational driver note, no session rule),
`stuck-hint.md` (R9 + `default.md:47-53` reflection), `subtask.md` (E2, E3, R2, R4, R5,
R6), `test-continue.md` (E3, R9), `test-result.md` (E3), `test-wrapup.md` (R4, R14),
`usage-note-{info,winddown}.md` (R4), `whole.md` (E1-via-head, E2, E3, R1, R2, R4, R6),
`wrapup.md` (E2/E4 via partial, E6, R1 — the `:25-33` proxy-answered-questions section —
R11). `templates/intents/default.md` — every
subsection appears in §6.3 (E3's `:88`; R1, which includes the `:156-159` wrapup-audit
subsection; R5, R7, R11, R14 rows enumerate them all).
Partial inlining sites (uses, not instances): `state-rule` 14, `question-rule` 17,
`doc-layout` 13, `eof-rule` 10, `head` 10, `digest-rule` 7, `subtask-depends` 7,
`task-depends` 3, `ground-state` 1 — counts grep-verified 2026-10-04.

### 6.6 What this leaves for U-B (T-131)

The mapping above is the input §2 promised: each rule's tag names its owning layer, and
every **dup** instance is a collapse candidate with its finding attached. The four
contradictions (K1–K4) each name their resolution side: K1/K13 rewrite the contract's
item 3 to its branch-invariant core; K2 decides the dryrun carve-out at the summary
rule's owner; K3 unifies the command class (one wording, and R10's bounded git reads
stay explicitly legal); K4 gates or conditionalizes the t-phase duty. K17's stale header
and K18/K19's stale comments are wording fixes; K11's six identical files are a
mechanical dedup (one template + variable selection already does the work). Per §4, any
edit this triggers to a carrier reruns this section's contradiction case.

AUTO-DECISION: closed this audit by appending the missing `<!-- auto: eof -->`
terminator to this document (every sibling plan ends with one; the section above
completes the body, and the eof discipline treats a finished document as terminated).

<!-- auto: eof -->

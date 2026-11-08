# 0227 — docs accuracy: every surface that names the code owes the code's current truth

Status: active-authority (0166 remediation step 067, wave WA-docs; findings 0165-064 = S01-06
(S3, CONFIRMED — shell-contract §A names a nonexistent core module `server`, the auto row
omits clarify/fork/remove-fork/release/driver-helper, §C claims `CONTRACT_FILE` is
exported; auto/AGENTS.md the same 15-of-18 omission plus the retired brief stub), 0165-086
= S05-09 (S3 — the README's parallel contract predates 0099/0125/0126/0151), 0165-207 =
S22-06 (S4 — reset's header claims the uninitialized state over the materialized bundle's
survival), 0165-213 = S26-05 (S4 — "the public sixteen" over 18 rows, the -f refusal's
incomplete owner set), 0165-215 = S28-01 (S4 — README's retired brief-deletion rule),
0165-216 = S28-02 (S4 — the retirement row's stale pointer), 0165-217 = S28-03 (S4 —
MANUAL's cheat sheet 15 of 18), 0165-221 = S31-01 (S4 — three auto-server comments older
than the shipped surface), 0165-222 = S31-02 (S4 — daemon.md's honestly-absent list omits
release and install-prompts), plus the step-066 handoff (ruling 0226's Residuals: the
glossary's package section lacks an auto-server row, this wave's server-docs family).

One family — **documentation and comment surfaces that name the code** (module lists,
command enumerations, boundary claims, status vocabularies, honestly-absent lists) **and
stopped tracking it**. Every finding is the same defect measured at a different surface: a
ruling changed the code's truth (0046/0068/0081/0099/0125/0126/0151/0191/0211/0053 D33…
below) and a doc that restates that truth kept yesterday's wording. 0165 is the evidence,
not the authorization; this ruling states what each surface owes and enacts it. Zero
behavior is ruled changed — the enactment is text (docs, comments, and the CLI's own
teaching lines), with two e2e assertions that pin reworded lines moving in the same change
(P13's conscious lockstep), and pins holding the corrected surfaces against silent drift
(the 0221/0225/0226 docs-pin pattern).

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P18** (the record outlives the tool): README, MANUAL, shell-contract, glossary and the
  comment headers ARE the durable record a person or new shell author navigates by; a
  surface that misnames the code degrades the record's addressability — the findings'
  measured impacts ("a new shell author copies a stale list", "a person planning cleanup
  reads a deletion rule that never fires", "a reader auditing the shell's boundary cannot
  tell deliberate absence from omission") are each P18's own loss. The repair is text
  edits in the surfaces' own homes.
- **P19** (measured evidence; every claim cited): every restated claim is cited to the
  ruling that made it true, and was **re-verified against the code at this step's HEAD
  before any wording was written** — the execution log enumerates the reads (`CONTRACT_FILE`'s
  const, `COMMANDS`'s 18 rows, `SYNC_FLAGS`'s force entry, loop-preflight's 0125 note and
  width refusals, `laneBranch`'s digest grammar, reset.ts's whitelist, ops.ts's served
  probe, daemon.md's absent list). The drift itself is measured: each finding's register
  row, re-checked line by line; two of S31-01's three comments were found already healed
  at HEAD (D4) — recorded, not re-changed.
- **P13** (frozen additive-only vocabularies; conscious lockstep): the command surface is
  a frozen vocabulary and its enumerations (the contract row, AGENTS.md, MANUAL, the
  KNOWN_COMMANDS comment) must state the same 18 names — enumeration drift between
  surfaces of one vocabulary is P13's documentation half. Teaching lines that state a
  ruled boundary (the -f refusal, the reset completion line) change only in the same
  change as their pins.
- **P8** (every surfaced line teaches its remedy / the true behavior): a refusal that
  names an incomplete owner set ("an init/reset/fix option" over four owners), a reset
  completion line that overclaims, and a README that teaches refusals that never fire are
  teachings of false behavior — P8's surfaced-text arm is the finding family's own
  measure (S05-09 cites it verbatim).

## Decisions

### D1 — what a docs-accuracy change owes (the rule this wave enacts against)

1. **The truth at the landing moment, verified at HEAD.** Each surface is restated from
   the code and rulings as they stand now, not from the finding's snapshot: two of
   S31-01's three comments were already rewritten by later rulings' enactments (0193's
   banner work reworded worker.ts's phasesLine comment; profile.ts's agentRecovery
   rationale states fix as a live operation and re-judges the value) — the re-verification
   found them healed, and this ruling records that rather than re-editing text that is
   already true.
2. **Category completeness.** A corrected enumeration or boundary moves **every surface
   of the same wrong family in the same change** (0110 D13's category-complete rule on the
   documentation axis): the 18-command list reaches the contract row, auto/AGENTS.md,
   MANUAL and the KNOWN_COMMANDS comment together; reset's boundary reaches the core
   header, the CLI's summary, extended help and completion line, the README's usage row,
   prose and table, and MANUAL's row together; the parallel contract reaches every README
   row **and the CLI help tails that carry the same retired clauses** (the `--tree-lanes`
   tier-0 clause "task sessions run serially" and the `--repair` row's "serial runs only"
   tail — 0125/0126 reworded the two help strings they named and left these two tails;
   they are the family's shell-seam twins, ruled into this change by this item).
3. **A boundary claim becomes a boundary statement, never a softer claim.** Where a doc
   overclaims ("restoring the worktree to the uninitialized state"), the fix states what
   actually survives and why (D3) — never deletes the sentence to say less.
4. **Pinned teaching lines move in lockstep.** The two e2e assertions pinning the -f
   refusal and the reset completion line are updated in this change with their lines (the
   assertions pin output text, not behavior; the behavior is unchanged).
5. **The historical absorb notices stay.** shell-contract §C's dated blocks are ruled
   historical by that file's own preamble ("newest governing; the current core source is
   the truth") — 0053 D33's notice naming `plan` is what D33 said then; 0101 D2's later
   truth lives in the current surfaces this ruling fixes. No dated notice is rewritten.

### D2 — the enumerations (0165-064, 0165-213, 0165-217, 0165-222, the glossary handoff)

The public command surface is 18 subcommands (`COMMANDS` in packages/auto/src/index.ts:
init, run, plan, transfer, clarify, close, land, fork, remove-fork, amend, fix, sync,
release, reset, status, models, install-prompts, driver-helper — plus the hidden `_lane`
entry, never listed). Every enumeration states the same set:

| surface | defect | enactment |
| --- | --- | --- |
| shell-contract §A auto row | 13 of 18 (no clarify/fork/remove-fork/release/driver-helper) | all 18, in `COMMANDS` table order |
| shell-contract §A core row | mechanism list names `server` (no `src/server.ts`; every other name verified present) | `server` dropped |
| shell-contract §C export sentence | "`renderAgentContract` moved … (with `CONTRACT_FILE`)" — the constant is a module-internal const (config-fix.ts:70), not an export | stated as the renderer's module-internal companion |
| index.ts KNOWN_COMMANDS comment | "the public sixteen" (18 rows) | "the public eighteen" |
| index.ts -f refusal + its comment | "an init/reset/fix option" / "belongs to init/reset/fix alone" — sync accepts it (`SYNC_FLAGS`, and OPTION_HELP's own force row says "shared by init, reset, fix and sync") | init/reset/fix/sync everywhere; the two e2e pins move |
| auto/AGENTS.md Overview | 15 of 18 (no fork/remove-fork/driver-helper) | all 18 |
| MANUAL cheat sheet | no fork/remove-fork/driver-helper row (README's usage block carries all 18 — verified) | the three rows added (wording from the README's rows, cheat-sheet compression) |
| daemon.md honestly-absent list | omits `release` and `install-prompts` | both rows added: `release` (the person's release gate — the containment findings a round records block there), `install-prompts` (the manual-suite resync) — stated as CLI-side exactly like the five standing rows |
| glossary package section | no auto-server row (the 0226 handoff) | the service-shell row beside the general/simple shells: 服务壳 / service shell / `packages/auto-server`, bin `opencode-auto-server` — the term shell-contract §A itself uses |

Also in this D: **auto/AGENTS.md's amend row still names "the brief stub"** — the stub
model and its remove-while-stub rule retired (0081 D11, restated in reset.ts's boundary 5
and S28-01). The row's write list becomes the truth: amend writes config.json, the
contract, the AGENTS.md block **and the brief's manual revision (`--brief`/`--brief-file`,
0081 D11's channel, amend's alone)** — never `opencode.json`, `.gitignore` or the rounds;
"the brief stub" as a thing init writes and amend never touches is gone.

### D3 — the boundary statements (0165-086, 0165-207, 0165-215, 0165-216)

**Reset's true boundary (207 + 215).** reset removes exactly the enumerated config-layer
whitelist; what survives beyond `docs/`, `.auto/` runtime state and `tmp/` (already listed)
is **the project brief (kept unconditionally — an installed approved proposal or a
person's `amend --brief` write; the retired stub rule never fires) and a materialized
intent bundle's landed files** (the pack, mode and phase files under `.opencode/auto/`, the
`provenance.json` sidecar — 0079 §3's materialization, 0100's sidecar): once landed they
are the project's own surfaces (read like a hand-written overlay; `fix`/`sync`/`status`
keep reporting against them), reachable by reset's whitelist only through `PRUNE_DIRS`'
rmdir-if-empty, which skips non-empty directories by design — the same mechanism that
protects `prompts/`. **Person-owned once landed; delete by hand if you mean to.** This
statement lands in: `src/reset.ts`'s header (the "restoring the worktree to the
uninitialized state" claim replaced by it), the CLI's reset surfaces (summary row,
OPTION_HELP row, the `✓` completion line, the command-block comment), README (the usage
row, the section prose, the brief table row to the keep rule), MANUAL's reset row. The
e2e assertion on the completion line moves in lockstep. **Declined:** S22-06's optional
"list them as keep rows in the plan" arm — that changes `planReset`'s printed output, a
behavior change no ruling here makes (the plan already shows the `rmdir-if-empty` rows and
their reasons; P21 — no measured consumer of itemized keep rows).

**The parallel contract (086), restated from the code at HEAD.** Width alone activates
the scheduler (0125: `schedulerActive` is `maxSessions ≥ 2`; no-level width is one ℹ
teaching note — the declared `Depends:`/`Touches:` are the admission — never a refusal);
at width, documentation-scoped units run side by side as **doc lanes** in the one tree by
default (0099, 0126's `## doc-parallelism` — the CLI's own `--max-sessions` help already
teaches this; the README and the two CLI help tails lagged); code tasks run concurrently
only under `--tree-lanes` (tier 1/2 worktree lanes), a `parallel` level adding their
planning depth and the landing-conflict posture (0126 D2); `--repair` follows 0211 D3's
boundary — rounds open wherever the FAIL or held gate is judged **with no lane in flight**
(the serial path, the lane loops' post-drain degrades, the doc loop's finishBlocked, the
phase-level gates), never a lane worker's own blocked exit, never under a stop condition
(`plan` refuses the flag); the lane branch is `auto-lane/<task-id>-<digest>` (0151 D2,
0191 D5 — the digest the target directory's realpath identity); and at width ≥ 2 there is
**no `/exit` channel** (the interactive sideband is the one /exit route and is refused,
0068 D11) while step mode hard-pauses the parent at a lane boundary — a pause, never a
scheduling stop. These land in: README's `parallel` config row, `--max-sessions` row,
`--repair` row, the section intro, the tier-0 bullet, the lane-branch sentence, the
human-surface bullet; the CLI help tails (`--tree-lanes`'s tier-0 clause, `--repair`'s
"serial runs only").

**The retirement pointer (216).** README's retirement row: the `continue` notice points
at **`transfer`** (index.ts's notice text: "run `<bin>` transfer <dir> — it runs the
round-close checks and opens the next round"); one word.

### D4 — the auto-server comments (0165-221): one live, two healed

- **ops.ts (live)**: the status-vocabulary comment's 501 parenthetical "(agent planning
  needs the interactive transport of P3; **the models probe is not exposed**)" — the
  probe has been served since P4b (the module's own header says so; daemon.md's 501 row
  was already corrected). The parenthetical drops the probe clause, leaving the true
  501 content (agent planning needs the interactive transport).
- **worker.ts (healed at HEAD)**: the finding's "arrives with P1d" future-route comment
  was rewritten by the 0193 banner work into the current truth (the phase line lives in
  the core; the local copy deleted; the remedy phased-aware, naming the served surface).
  Verified at HEAD; **no change** — the finding's remedy for this site ("state the
  current teaching problem instead of a future route") is already what the comment does.
- **profile.ts (healed at HEAD)**: the "config-fix routes arrive with the REST lifecycle
  surface" premise and the recovery hint keyed on their absence were replaced by the
  current rationale — `fix` stated as a live operation (POST /projects/<project>/fix),
  and `agentRecovery: "startup"` re-judged on the true ground (the core's `"init"` hint
  would teach a subcommand shape this binary refuses; the operation is better reached
  through the daemon than a re-run teaches). Verified at HEAD; **no change** — the
  re-judgment the finding asked for is the standing rationale.

### D5 — the pins

Three docs-truth pin files, one in each owning package (tests read only their own
package's files), each with two tables after the 0226 pattern: the **truth needles**
(presence) and the **retired wordings** (absence — their return is the same drift again):

- auto-core `test/docs-truth-reconciliation.test.ts`: shell-contract §A's 18-command row
  and its `server`-less mechanism list, §C's CONTRACT_FILE truth, reset.ts's bundle
  boundary, the glossary's service-shell row; retired: `server` in the mechanism list,
  "restoring the worktree to the uninitialized state" in reset.ts.
- auto `test/docs-truth.test.ts`: README's seven parallel-contract needles (0125/0126/
  0211/0151-0191/0068-D11 truths), the reset table's keep rule, the transfer pointer,
  MANUAL's three rows, AGENTS.md's 18-list, the CLI's eighteen comment and four-owner -f
  refusal; retired: "usage error pointing at `init --parallel`" (both rows), "Serial runs
  only (no effect", "auto-lane/<task-id>`" (the digest-less branch), "/exit` and step
  mode stop *scheduling*", "the public sixteen", "byte-identical to the project brief
  stub", "(pointing at `plan`)", "the brief stub" in AGENTS.md, the CLI tails "serial
  runs only, never persisted" and the tree-lanes "task sessions run serially" clause.
- auto-server `test/docs-truth.test.ts`: daemon.md's release and install-prompts absent
  rows; ops.ts's 501 parenthetical without the probe clause; retired: "the models probe
  is not exposed".

Anchoring a needle means moving it in the same change as a sanctioned ruling, never to
silence it.

## Derivation and Category scope

Derives: **P18** (the showing: README, MANUAL, shell-contract, glossary and the comment
headers are the durable record's navigation surfaces — restated to the code they name,
each edit in the surface's own home), **P19** (the showing: every restated claim cited to
its ruling and re-verified against the code at HEAD before wording; the two healed
comments recorded as measured, not re-edited), **P13** (the showing: the command surface
as one frozen vocabulary stated identically across its five enumerations; pinned teaching
lines moved in conscious lockstep with their two e2e assertions; the retired wordings
become the pins' absence table), **P8** (the showing: the -f refusal names its full owner
set, the reset completion line and README teach the boundary that actually holds, the
honestly-absent list states deliberate absence). Amends: **none** — no principle
statement, chosen default or lifecycle changes. Tier touched: **documentation** (docs,
comments, CLI teaching strings and their two pin moves; zero runtime behavior — the only
executable-output changes are the ruled teaching lines themselves). premises this ruling
changes: **none** — no standing ruling rests on the stale wordings; the rulings whose
truth this change restates (0046, 0053 D33, 0068, 0073–0074, 0079 §3–§4, 0081 D11, 0096,
0099, 0100, 0101 D2, 0105, 0116, 0125, 0126, 0128, 0133, 0137, 0138, 0140, 0151 D2, 0160,
0162, 0191 D5, 0211 D3, 0213, 0193) are re-read this change and **restated in the
surfaces that should have carried them, not amended**; 0125/0126's "the shell's two help
strings reworded" is completed, not contradicted (the two tails this change rewords were
never among the two); 0211 D3's RunAllOpts home is untouched; 0226's glossary rules are
exercised by the handoff row (the owning module's own term, one row).

### Category scope (0123 D1's discipline)

Family: *documentation and comment surfaces that name the code — the shell-contract
boundary tables, the glossary's package section, the CLI package's README/MANUAL/AGENTS.md
and its own help-comment/refusal strings, the server package's daemon.md and comment
headers, reset's boundary statement, and the pins that hold them*.

| home | disposition |
| --- | --- |
| `docs/shell-contract.md` | changed — D2 (§A rows, §C sentence) |
| `docs/glossary.md` | changed — D2 (the service-shell row, the 0226 handoff) |
| `src/reset.ts` (header comment) | changed — D3 (the boundary statement) |
| `packages/auto/src/index.ts` | changed — D2 (the eighteen comment, the -f refusal + comment), D3 (reset summary/help/completion/comment, the two help tails) |
| `packages/auto/test/e2e.test.ts` | changed — D1 item 4 (the two lockstep pin moves) |
| `packages/auto/README.md` | changed — D2/D3 (the parallel rows, reset rows, the retirement pointer) |
| `packages/auto/MANUAL.md` | changed — D2 (three cheat-sheet rows), D3 (the reset row) |
| `packages/auto/AGENTS.md` | changed — D2 (the 18-list, the amend row's brief wording) |
| `packages/auto-server/src/ops.ts` (comment) | changed — D4 (the 501 parenthetical) |
| `packages/auto-server/docs/daemon.md` | changed — D2 (the two absent rows) |
| `test/docs-truth-reconciliation.test.ts` (new) + `test/lanes.ts` | changed — D5 |
| `packages/auto/test/docs-truth.test.ts` (new) | changed — D5 |
| `packages/auto-server/test/docs-truth.test.ts` (new) | changed — D5 |
| `plans/INDEX.md` | changed — the 0227 row |
| `packages/auto-server/src/worker.ts`, `src/profile.ts` | held — D4: verified healed at HEAD (0193's banner work; the standing agentRecovery rationale), no change |
| shell-contract §C's dated absorb notices | held — D1 item 5: historical by that file's own preamble |
| `AGENTS.md` (auto-core) | held — no code mapping or navigation change (docs truth only; no module moves) |
| `docs/structure.md`, `docs/principles.md`, `docs/releases.md` | held — no register or principle content touched (the glossary row is the vocabulary map's own package section, not a register; no principle text moves) |
| `src/loop-preflight.ts`, `src/lanes.ts`, `src/config-fix.ts`, `packages/auto`'s command surface, `packages/auto-server`'s served surface | held — the code is the truth the docs are restated to; zero behavior ruled |

## Residuals

- The pins hold the corrected surfaces against silent drift, but a future command (or a
  retired one) still owes its own enumeration updates in the same change — the pin's
  needles name today's truths, and the 18-command list is a vocabulary that will grow
  again; the pin's per-surface needles must move with the next vocabulary change (P13's
  lockstep), they do not mechanize completeness.
- README's parallel section still describes the v1 lane scheduler's shape at its measured
  length; this change repairs the false claims the finding measured, not the section's
  architecture (a fuller rewrite would need its own ruling and consumer).
- 0226's other residuals stand (the snapshot-not-watch rule, the cells' currency).

# 0132 — the sealed reference wall: the cleanroom wall closes as a machine boundary at the person's transfer

*Status: drafted ahead of enactment (2026-10-26), revised through two review rounds (ChatGPT,
Claude — dispositions below) — the maintainer's review pending; the Enactment section is the
checklist, and the INDEX row carries `proposed-enactment-pending` until the code homes land in their
own change.*

## The ground

What the 2026-10-26 aster-mig dual-run audit and door census *measured* about the wall — three
mechanical facts, each checkable by hand:

1. **The wall is advisory, not mechanical.** The aster-mig cleanroom baseline is mid-P04 (T-024 done,
   T-025 in flight) with the reference door — the root `linux` symlink, git-tracked at mode 120000 —
   still present and resolving. The charter's own words (the T-006 todo): "every phase after P02 is a
   clean room whose only reference knowledge is the spec notes, the brief and the planning input" —
   but a post-wall session reading `linux/` succeeds silently and leaves no trace. Worse, the
   *admitting* surface is not even the door: the platform's consent fires on the resolved path, and
   the person's own `opencode.json` carries an `external_directory` allow on the corpus realpath —
   with that allow in place, the corpus is readable by absolute path with the door gone.
2. **A second, unsanctioned channel exists in-tree.** `docs/T-006/report.md` carries reference
   internals with file:line anchors (`round_jiffies_common` at `kernel/time/timer.c:349-388`, the
   3·cpu skew and HZ/4 cutoff; `__mod_timer` at 1065-1170; the shutdown paths at 1430/1511) —
   physically readable by every clean-room session, though the charter sanctions the notes alone.
   Both lineages' pre-wall reports have this shape; the workflow's own verification duty wrote them.
   Commit messages are the same channel in its never-restatable form.
3. **Detection is symptom-level and late.** The 0121 divergence scan catches leaked identifiers in
   *outputs* at phase close, lexically, after the fact.

What the audit measured that is **not** wall evidence, recorded here because the first draft of this
ruling misused it (review round 2, disposition 10): of the three "discovered-fact" falsehoods, two
(`TaskOptions.cpu_affinity` in the baseline's T-013; "no per-task slack substrate" against
`prctl.rs:167` in the fork's T-015) are *target-tree* verification failures no wall touches, and the
third (`WORKER_DESC_LEN` attributed to `workqueue_internal.h` where the corpus has it at
`include/linux/workqueue.h:98`) is most plausibly weights recall — a session that had read the file
would have cited it. And the wall-vocabulary slips both lineages' designs carried cannot be
attributed to either channel at all: the door was physically open and reads leave no trace, so the
slips are compatible with lawful reads, weights recall, or both. The honest statement: **the weights
residual is asserted, not measured** — the measurement is named in the Enactment section (a sealed
fork rerun), and until it runs, the honesty section below claims only what the mechanism shows.

**The enforcement primitive already exists and is person-prototyped.** 0122's founding incident (the
T-002 session death) measured that a read of an out-of-tree path *without* an `external_directory`
allow trips the platform's consent boundary and denies in unattended runs after timeout — and the
aster-mig person has since hand-built exactly that wall (an `allow` on the corpus realpath's tree, a
`deny` on the wider compliance root) and manages the door by committed acts (commit `d25f09e` "wall:
the linux reference door now points at the frozen corpus generation…"). The practice is the
prototype; no driver mechanism carries it.

The analysis: the wall's guarantee currently rests on prompt compliance plus after-the-fact lexical
scans — and the one channel the charter never sanctioned is written by the workflow's own duties.
The ruling makes the wall a machine boundary assembled from pieces that already exist: the consent
boundary is the enforcement (0122's measured behavior), the door and its recorded target are
git-tracked facts, the admission instrument is 0121's identifier scan with its existing verdict
contract, and the read-only guard is `src/protect.ts`'s set — whose header already says the honest
words ("a guardrail, not a security boundary") that bound this ruling's claims.

This ruling Derives: **P2** (the person brackets every boundary — the showing: the wall closes at the
person's advance path; the *only* recorded exceptions to the sealed state — reopening the door,
amending the sealed channel — are person acts surfaced by the boundary check, never session
choices), **P6** (derived state, re-derivation — the showing: the wall's closed predicate is
re-derived from disk and git at every boundary — the door's presence, the live allow entries, the
recorded target in the wall commit's message; no registry, no persisted flag; the 0128 fork channel
derives wall state for free), **P7** (grammars, never content — the showing: the driver reads and
writes only the `Wall:` field grammar, door paths, allow entries and lexical scans; whether a
document is "too close" to the reference stays 0121's audit adjudication), **P8** (deliberate
enforcement moments — the showing: the sweep *records* vocabulary findings during later phases;
blocking is reserved for the wall-close moment and for the hard-identifier class 0121 D5 already
rules blocking — never for lexical judgment), **P10** (the byte-identical floor — the showing: no
`Wall:` declaration, no wall machinery; non-cleanroom and undeclared projects byte-identical, tested
as behavior, not as a parse result), **P12** (fail loud — the showing: with the door removed and no
covering allow, an unattended reference read denies after timeout; a declared wall that derives open
post-seal blocks naming the covering entry, whichever hand wrote it), **P13** (frozen additive-only
vocabularies — the showing: the `Wall:` field is a new additive phase-document grammar beside `Gate:
human`, landing in lockstep with its parsers and pinning tests; the wall commit reuses existing
trailer vocabulary), **P16** (genericity — the showing: no project path enters code; the bundle
carries the *sealing semantics* only — the concrete door path is a person-owned fill at
materialization, 0121's per-language-pair menu the precedent — and the C→Rust / Linux→Asterinas
posture no more assumed here than there), **P18** (the record outlives the tool — the showing: the
wall's record is plain git — the wall commit, the frozen channel's tree — auditable with no tooling;
`opencode.json` is deliberately untracked machine state (0122), so the allow half is read live, and
the tracked record of what it admitted is the wall commit's message), and **P19** (measured evidence
— the showing: the ground above is reclassified to carry only what the audit mechanically showed,
the attribution-impossible items named as such, and the one unmeasured claim — the weights residual
— carries its named measurement instead of an assertion). Tier touched: **mechanism + bundle
templates** — core src, the cleanroom bundle's phase documents, tests; no principle text moves.

## Category scope (0123 D1's discipline)

Family: *the cleanroom wall's enforcement — the wall's declaration grammar, the reference door and
its admitting allows, the sanctioned channel, the evidence layer, and the wall-side scans* (0121's
"second half of the clean room beside the two-room wall", now with its mechanical half). Home-set
enumerated at ruling time:

| home | disposition |
|---|---|
| `src/transfer.ts` (`runTransfer`) + `src/loop-phase.ts` (the transition commit, loop-phase.ts:337) | changed — the wall-close sequence rides the person's advance path |
| `src/phases/custom.ts` (the `Wall:` field's grammar beside `Gate:`) / `src/phases/registry.ts` (the field-list pin) | changed — the `Wall:` field's parser, additive beside `Gate:` (enumeration corrected 2026-11-05 by 0166 step 004 over S02-02: the first draft named `src/phases.ts`/`src/analysis.ts`, never touched — the field readers live in phases/custom.ts) |
| `templates/bundles/cleanroom/phases/*.md` (the sealing *semantics* — which phase-close seals; `Gate: human` in survey.md the shape precedent) | changed — semantics only; the concrete door path is a person-owned fill at materialization |
| `src/external-dirs.ts` (0122's stamping — the closure write) | changed — the close stamps a *deny* on the recorded door target (additive, no exception needed); the driver retires only allows it stamped itself (round 2, disposition 6) (enumeration corrected 2026-11-05 by 0166 step 004 over S02-02/S20: the row's `src/config-fix.ts` half — the fix sync — deferred with a named residual, never silently dropped: the sync is wall-blind and re-opens any subtree through a new door past a closed wall (S20-02(b)); the wall-aware skip is ruled for the wall wave, 0165-038's family, 0166 step 029) |
| `src/protect.ts` (the declared sealed set) | changed — the sealed-path set, declared not fixed-role; violation detection is the one diff check of D4 (enumeration corrected 2026-11-05 by 0166 step 004 over S02-02/S20: the row's `src/document/roles.ts` half was a record imprecision — D4's set is declared, not fixed-role, and lives in protect.ts alone; PROTECTED_FILES unchanged) |
| 0121's divergence/identifier scan (the driver-side lane) | changed in moment and scope only — the instrument and its D5 verdict contract untouched and inherited verbatim; scope extends to the whole tracked tree at the wall and at every post-wall phase close for the hard-identifier class |
| the spec-read verification report duty (the anchor discipline: anchors and spot-check citations to the evidence layer, verdicts and counts in-tree) | changed — pre-wall sessions' duty; commit messages covered explicitly (the never-restatable channel) |
| `templates/bundles/cleanroom/phases/audit.md` | held, untouched — the audit is a clean room under 0121 and produces no reference anchors; the first draft's changed row was wrong (round 2, disposition 8) |
| `src/fork.ts` (the 0128 channel) | held, untouched — the door's own commit history and the live predicate derive wall state; a pre-wall fork has its door lawfully. The out-of-tree evidence home is keyed per lineage (the fork's registration derives its key) so two lineages never share one home |
| `prompts/` (the manual suite) | deliberately deferred (P21) — the person-driven channel walls by hand, the aster-mig person's own entries the prototype; a suite copy waits for its consumer |
| tests: `test/transfer*.test.ts`-family, `test/external-dirs.test.ts`, `test/protect.test.ts`, `test/bundle.test.ts`, `packages/auto/test/e2e.test.ts` | changed at enactment — the lifecycle, the floor as behavior, the retirement split, the bundle grammar pin |

## The ruling

**D1 — the wall is declared, not assumed; semantics and door path are separate facts.** A `Wall:`
field over the phase family's documents (the `Gate: human` shape), installed by the cleanroom
bundle's phase templates: the bundle carries the *sealing semantics* — that a wall exists for this
project and which phase's close seals it — while the concrete door path(s) are a person-owned fill at
materialization (0121's per-language-pair menu the precedent; the materialized document is the
person's thereafter, and `sync` never collides with a project fact in a synced line). The driver
reads only this grammar. Absent the field, no wall machinery exists anywhere — the P10 floor, and
the P16 test: a template line that only makes sense for one language pair is wrong (0121's
universality rule inherited).

**D2 — the close: order, predicate, and the person's entries.** The close runs, in this order:
(1) **the admission scan** (D3) — read-only, so a block mutates nothing, and the remediation session
is still pre-close and lawfully dirty, so it may be told the colliding identifiers (0121 D2's
anti-oracle rule applies to clean rooms only); (2) **one wall commit** carrying the door removal and
the driver-stamped allow retirements, its message recording the door's resolved target — the
tracked record of what the allows admitted, since `opencode.json` itself is untracked machine state
(0122); (3) **the transition commit** (the existing `PLAN transition` subject). Any interruption
leaves a state the predicate below reads; no recovery protocol exists because none is needed —
door absent with a covering allow means *finish the retirement*, wall closed with the phase unadvanced
means *proceed with the transition* (round 1's Issue 2 dissolved this way, 0128's
refusal-before-any-git-state the precedent).

*The closed predicate* (round 2, disposition 1 — the allow is the wall, the door a convenience): the
wall is closed **iff the door is absent and no live `external_directory` entry covers the recorded
target**. This, not door presence alone, is the wall state. It covers every case the first draft's
table missed: a door present at an unexpected target — compare against the recorded target; a door
re-created after closure — a deletion commit exists in history, so this is a reopen, never a normal
post-wall state; a door that was never present — no deletion commit, so it blocks.

*The person's entries* (round 2, disposition 6): the driver retires only allows it stamped itself —
withdrawing its own stamp. A person-authored entry that covers the recorded target is a **blocking
finding that names the entry**; the person removes their own line (P2: the driver never deletes the
person's words). The close additionally **stamps a deny** on the recorded target — additive, so no
0122 exception is invoked — which makes an attended consent click and a hand-edit both fail against
standing config rather than silently admitting (round 2, disposition 5).

*The trigger*: the close fires **at any transfer whose source phase is at or after the sealing phase,
while the wall derives open** — the normal close and the retrofit in one rule (round 2, disposition
3). The motivating project is itself the retrofit case: aster-mig is mid-P04 with its seal "after
P02", so its next transfer closes a wall that should have closed two phases ago — and the admission
scan will then itemize every P03–P04 document written while the door was open (T-011's reference
header citation among them). That restatement cost is real, is the retrofit's one-time price, and
the field project reaches its materialized phase documents through `sync` or by hand.

*The boundary check*: post-seal, the closed predicate is re-derived at every phase boundary; a wall
that derives open blocks, naming the covering entry — so *any* reopen, however performed (the
person's re-allow, a hand-recreated door), is surfaced at the next boundary as a finding, and the
"reopening is a recorded act" claim rests on detection rather than prevention. "Fails loud" is
claimed for unattended runs (0122's measurement); attended runs fail against the stamped deny.

**D3 — the admission scan and the post-wall regime: 0121's instrument, 0121's contract.** The scope
is the **whole tracked tree** — not an enumerated `docs/` list; code comments, scripts and fixtures
are readable surface too (round 2, disposition 11), and the deliverable is already covered by 0121's
lane. The verdict contract is **0121 D5's, inherited verbatim, not re-specified** (round 1's Issue 7
dissolved): private identifiers are hard findings; a scan failure is a red lane (fail closed);
exclusions are person-declared on the committed surface; no agent approves its own exception. At the
wall, hard findings block. Post-wall, the same split holds at every phase close: a hard
private-identifier hit in a post-wall document **blocks** — it is the next session's input, and
0121's cheapest-at-source grounds apply unchanged — while vocabulary judgments record (round 2,
disposition 11). The scan's itemized findings go to the person and the dirty side only; committed
receipts carry counts and ids — otherwise the admission receipt becomes the first post-wall leak
(round 2, disposition 4).

**D4 — the channel freezes, with one question path.** The vetted channel — the capability notes and
the consolidated spec-notes the sealing phase produced — joins protect's read-only set at close (a
declared-path set derived from the field); the wall commit is the anchor. Violation detection is
**one check**: `git diff <wall-commit> -- <sealed paths>` at phase close — it covers the normal edit,
the direct write, rename-and-replace and git surgery identically (round 1's Issue 6 dissolved into
one assertion), and the finding is a sealed-channel invariant violation, never a mere lexical note.

The freeze has exactly **one recorded exception, the monitor-mediated clarification path** (round 2,
disposition 2): a clean session that finds a gap in the sealed notes records a *source-free* spec
question in its task document; the person — as compliance monitor, 0121's dirty-side role — answers
through a dirty-side act (a bounded reopen or a driver-side spec-read session), and the answer lands
as a person-committed amendment to the sealed notes, visible in the diff against the wall commit.
Without this path the freeze pushes every discovered gap toward the two unlawful channels the wall
exists to close — guessing and weights recall; 0121 D8's clarification-revision class already expects
these amendments, and this is their lawful road.

**D5 — the evidence layer is decided by time, not by writer.** Pre-wall, evidence is session-written
(the anchors and spot-check citations of the verification reports, lawfully, under the allow the wall
then retires) and lands in the project's declared out-of-tree compliance home, beside 0121's
divergence receipts; the in-tree report and every committed receipt keep verdicts and counts alone.
Post-wall, evidence is **driver-only** — a clean session cannot produce reference-derived evidence
because it cannot read the reference; what remains is 0121's existing driver-side receipts. The first
draft's write-channel question (sidecar vs session writes) dissolves once time is stated (round 2,
disposition 8; round 1's Issue 5 with it). **Commit messages are covered explicitly** — they are the
one in-tree channel that can never be restated; the anchor discipline names them, and their retrofit
cost is accepted as history. The evidence home is **keyed per lineage**: a 0128 fork derives its own
key from its registration, and two live lineages never share one home. P18 permanence kept: document
paths never move; pre-wall content is restated at the wall, the history beneath retained.

**D6 — the wall state derives from disk and git, together.** The closed predicate of D2 is the wall's
state; the door's presence, the live allow entries and the recorded target (in the wall commit's
message — `opencode.json` is untracked, so the tracked record must carry what the allows admitted)
are its inputs. No registry, no flag, no fork change: a 0128 fork at a pre-wall commit reconstructs
with its door lawfully (its phase is pre-wall), a post-wall fork derives closed against its own
wall commit.

## What the wall guarantees — and what it cannot

Guaranteed, mechanically: no *declared and tested* session-readable path reaches the reference
post-wall under the supported execution model — the door gone, no covering allow, a standing deny on
the recorded target, and the consent boundary loud in unattended runs; the readable tree carries no
unvetted reference internals at the moment the room goes clean (the admission scan blocks on the
hard-identifier class); the vetted channel is immutable except through the person's recorded
amendment path; and any reopen or seal violation is detected at the next boundary. The
alternate-path class (bind mounts, path aliases, a copied subtree, a foreign allow) is
0121's reachability check's family — re-run at close as a delivery condition of the wall itself, not
re-specified here (round 1's Issue 3 folded there).

Not guaranteed, and said so. **The weights channel**: a model's pretrained recall of the reference —
asserted today, not measured (the ground above retracts the first draft's attribution); the sealed
fork rerun named in Enactment is its measurement. **History**: `git show <pre-wall>:docs/T-006/report.md`
is one routine command, not archaeology — and under D5 in force from project start, nothing
reference-derived is ever committed in-tree, so the residual is **zero for new projects**; it is the
one-time retrofit cost of aster-mig's pre-enactment history, not a standing P18 trade (round 2,
disposition 9). And protect's own words bound the tamper claim: workflow enforcement and detection,
never resistance. The wall's claim is enforced process with mechanical evidence — "enforced / found /
disposed, never the proven absence of transliteration" (0121's phrasing, inherited verbatim).

## Review rounds — dispositions

**Round 1 — ChatGPT** ("approve the direction, revise before enactment"): Issue 1 (wall-state model
underspecified) — *accepted as a problem, dissolved by the D2 predicate*, which decides every row of
its five-case table from the door, the recorded target and history; Issue 2 (transactional failure
semantics) — *dissolved by D2's ordering plus derived state*; a recovery protocol would add machinery
the principles rule out, 0128's refusal-before-any-git-state the precedent; Issue 3 (removing the
door does not prove access impossible) — *accepted as threat-model scoping*: the guarantee claim
scoped to declared and tested paths, alternate-path checks folded into 0121's reachability check
re-run at close; Issue 4 (post-close finding tiers) — *dissolved by inheriting 0121 D5's existing
tiers*; Issue 5 (evidence-channel ownership) — *dissolved by D5's time rule*; Issue 6 (guardrail vs
tamper resistance) — *accepted*, claims kept separate, one diff check replacing the four bypass
routes; Issue 7 (admission verdict contract) — *dissolved*, 0121 D5 inherited verbatim; Invariants
A–D — *accepted*, D (the undeclared floor) now an enactment test of behavior; the implementation
sequence and the two negative assertions — *accepted into Enactment*.

**Round 2 — Claude** (the load-bearing three and the rest): (1) the allow is the wall, D6 pointed at
the wrong object — *accepted, D2/D6 rebuilt on the closed predicate*; the git-only variant adapted
(`opencode.json` verified untracked, so the target record rides the wall commit's message); (2) no
question path on the sealed channel — *accepted, D4's one recorded exception, the monitor channel*;
(3) the only consumer already past its seal — *accepted, the at-or-after trigger rule and the
retrofit note with its restatement cost*; (4) ordering dissolves the transaction problem — *accepted,
D2's sequence, findings off-tree*; (5) the attended consent click is an unrecorded reopen —
*accepted, answered structurally*: the deny stamp at close plus the boundary re-derivation that
surfaces any open as a finding, with "fails loud" claimed for unattended runs only; (6) retiring a
person-authored allow — *accepted*, the driver retires only its own stamps, a person-authored
covering entry a blocking finding; (7) D1 contradicted the P16 showing — *accepted*, semantics in the
bundle, door path person-owned at materialization; (8) evidence decided by time; the audit.md row
wrong; commit messages uncovered; fork homes colliding — *accepted*, all four, the audit.md row
corrected to held; (9) the history residual shallow and retrofit-only — *accepted*, the honesty
section restated; (10) ground hygiene — *accepted*, the ground reclassified, attribution named
impossible, the sealed-fork rerun adopted as the named measurement; (11) scan the whole tracked tree,
and the post-wall record-only regime weakened 0121's own split — *accepted*, scope widened,
hard identifiers blocking at every post-wall phase close.

## Enactment (pending)

The Category scope's changed rows, in one change, in this sequence (round 1's steps): (1) the wall
lifecycle specified and tested — the predicate, the recorded target, idempotency, reopening, the
person-entry split; (2) the transfer boundary — the three-step close integrated with the transition
path, interruption and retry readable by the predicate alone; (3) admission and evidence — the scan's
scope and inherited contract, the deny stamp, the sealed-path policy, the anchor discipline with
commit messages; (4) the end-to-end suite through the real CLI — closure, repeated closure, reopen,
the retrofit trigger, the person-authored-allow block, the undeclared floor **as behavior**, 0121's
existing gates still green beside the new ones; (5) the closing read on a scratch cleanroom project,
carrying the two negative assertions — *a failed close is never mistakable for a cleanroom
transition*, and *a passing scan is never proof of independent implementation*. Then the named
measurement: **fork the aster-mig baseline at its P02 commit (0128), seal the fork under the enacted
wall, rerun the spec-read tasks, and compare lineages** — the weights residual becomes a number, and
the honesty section's one unmeasured claim retires. The INDEX row flips to `active-authority`, the
AGENTS.md navigation line and the docs/structure.md row land with the code.

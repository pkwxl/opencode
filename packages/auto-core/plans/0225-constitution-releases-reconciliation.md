# 0225 — the constitution/releases reconciliation: P4's adoption, the info class, the practiced deprecation lifecycle, the mid-cycle register, five definitions, the replay method

Status: active-authority (0166 remediation step 065, wave WA-docs; findings 0165-007 = S03-01
(S2, CONFIRMED — the blind falsification replay answered "stop for the person" where 0145
ruled "adopt the person's foreign commits, never a stop"; the constitution misleads every
reader, agents included, on the person's commits in a unit's range) and 0165-071 = S03-02
(S3, CONFIRMED — no principle states the informational class, so the replay read a divergent
superseded key as an exit-1 finding where 0135/0136 ruled an `info` note, exit 0) and
0165-068 = S02-03 (S3, CONFIRMED — the written deprecation lifecycle "tombstone → one release
of visible warning → removal" is not the practiced one; 0150 D2 broke a v0.3.0-valid operator
registry with no warning release, 0137 retired a flag by parse-time refusal) and 0165-069 =
S02-04 (S3, CONFIRMED — the constitution was edited between releases once, silently: 0146's
commit `7401fe7b5` rewrote Tier I P2's bounded-escalation line with the stamp unchanged, and
the line imports a threshold and the misreadable "no-gap rounds" phrase) and 0165-181 =
S02-09 (S4, CONFIRMED — How-to-rule asks a derivation per decision block; the corpus states
one consolidated Derives paragraph per document) and 0165-182 = S03-03 (S4, CONFIRMED — five
constitution silences the replay exposed: lock scope, "shared git state", task-id uniqueness,
"safe boundary", Tier I/II precedence) and 0165-183 = S03-04 (S4, CONFIRMED, TEST — the
replay protocol leaks: an agent session started inside the package auto-loads AGENTS.md,
whose navigation names the rulings; a replay run there is never blind), with the F-twins F18,
F19, F11, F12, F17, F20, F21 the same findings from the release-audit register).

One family — the ruling surface reconciled with the rulings it records. Every finding here is
the same shape measured twice (0165's S02 corpus audit and S03 blind replay): a
`docs/principles.md` or `docs/releases.md` text that contradicts a standing ruling (P4 vs
0145), lags one (the deprecation lifecycle vs the practiced tombstones; the derivation-wording
vs the corpus's own form; P2's line vs 0198), stays silent where the corpus has ruled (the
info class; the five definitions), or states a protocol whose method leaks (the replay). The
falsification-replay rule (releases.md l.31) makes the repair immediate, never cut-gated: "the
principle set returns to synthesis — never to the ruling". Zero code behavior is ruled; the
enactment is the two documents, one AGENTS.md clause in lockstep, and the pin that holds the
reconciled texts against silent drift (the 0221 docs-pin pattern).

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P18** (the record outlives the tool — plain files and git the only durable state): the
  constitution and the release record ARE the durable design record; a constitution text that
  contradicts a ruling is the record corrupting itself, and a mid-cycle edit no durable record
  states (0165-069's finding) is state git proves but no governed surface names. The register
  this ruling creates is plain-file, append-only, consumed at the cut — P18's own shape.
- **P19** (measured evidence; every claim cited): every reconciliation here is measured — the
  replay's two blind mismatches (Q1, Q5) with their transcripts, the corpus audit's diffs
  (0146's commit verified verbatim; 0137/0150 D2's tombstones; 0156 l.239's consolidated
  Derives), and the practiced-vs-written lifecycle measured as zero warning releases ever cut
  against at least four instant tombstones landed. The lifecycle ruling picks the practiced
  track on this evidence, and the mid-cycle rule picks the recorded-two-classes form on the
  measured practice (0146 and 0166 step 006 both edited mid-cycle; the rule as written was
  already dead letter).
- **P8** (deliberate enforcement moments): the info class is P8's own third arm — detection
  that needs no person act is a note, never a finding (0135's own derivation). The replay's
  exit-1 reading was the constitution under-determining the principle two rulings rely on.
- **P13** (frozen additive-only vocabularies): the deprecation lifecycle is P13's chosen
  default on the version axis; this ruling amends that default's letter to the two-track
  practiced rule — vocabulary tombstones teach at the surface forever, behavioral retirements
  take the warning release — keeping "no silent dual meanings, no unversioned breaks" intact.
- **P2/P4** are the subjects of D1 and D4, not its bases: D1 reconciles their derivation text
  with 0145's own P2/P8 derivation (the re-run is the person's bracket; the stop was a
  driver-invented ritual), and D4's rephrase carries no new rule at all.

## Decisions

### D1 — P4's derivations reconciled with 0145: adoption, the re-anchor, and the 0076 line restated (0165-007/F18)

The blind reader's "stop" was correctly read from the text as it stood: bullet two said every
commit in `baseline..HEAD` carries the driver trailer, bullet three said foreign commits are
never rolled back (a refusal — read against the purity claim, the only remaining act looks
like a stop), and the 0076 tail said the person must not hand-commit inside a unit's range
because "it breaks the SHA-baseline audit". 0145 ruled the opposite composition: **adopt and
continue** — and the mechanism's own re-anchoring is why the audit never breaks. The
amendments, all in P4's Derivations (the Statement, Rationale and Provenance stand):

1. The SHA-baseline bullet gains the scoping and the adoption: the audit's purity target is
   the sessions' own commits, and a resume that finds the person's commits in an interrupted
   unit's range **adopts** them — readable drift alone (0183 D3's bound), no reuse of the
   recorded session, no rollback, no stop — because both resume entry points re-record the
   unit baseline at the current HEAD: the person's commits sit **before** the close-out range,
   which therefore still contains only driver commits. Home: `src/resume-gate.ts`; 0145, 0183
   D3.
2. The clean-worktree bullet's "foreign commits are never rolled back" keeps its refusal and
   gains the adoption's name (0145) so the two bullets teach one composition.
3. The 0076 tail is restated to teach rather than threaten: the person must not hand-commit
   inside a live unit's range (0076) because such commits forfeit session reuse and land as
   adopted drift at the resume — the audit re-anchors around them, the authority over git
   state stays the person's (0021 D5) — they never stop or roll back a run. The old bare "it
   breaks the SHA-baseline audit" (the half-sentence the replay leaned on) is retired with the
   restate.

The Tier-precedence half of the finding's remedy is D5's fifth sentence.

### D2 — P8 gains the recorded-state (info) class (0165-071/F19)

Three coordinated additions to P8, the class vocabulary itself staying with its mechanism
(`src/config-fix.ts`, the README table — the tier test keeps exit codes out of the
constitution):

1. The Statement's parenthetical grows the fourth recorded shape: "(counts, warnings,
   findings, informational notes)" with the class's rule inline — detection that needs no
   person act is a note, never a finding.
2. A Derivations bullet records the family: the recorded-state (info) class — an expected
   posture with nothing to repair (a superseded-but-diverging config key) reports `info` with
   exit 0, firing on divergence alone (agreement the designed state), the hand-remedy trailer
   never riding it — `src/config-fix.ts`; first ruled 0135, the trigger sharpened 0136.
3. The Chosen default line gains the clause "; a detection that needs no person act is a note
   (the recorded-state class), never a finding".

### D3 — the deprecation lifecycle amended to the practiced two-track rule (0165-068/F11)

The written single-track lifecycle ("tombstone → one release of visible warning → removal in a
named later release") has zero landed instances; the practiced retirement is the instant
parse-time tombstone — 0137 (the `--phases` flag on amend: a parse-time retirement notice, the
`--amend`/`init --brief` precedent it cites), 0150 D2 (a registry route naming
`number-recovery` fails validation today), 0052 D3/D4 (tombstoned key names never reused;
retired-key discards named), 0053 §10 B4 (retired flags are usage errors, never silently
ignored — "a person [would] believe a unit was closed when nothing happened"). On P19's
evidence the practiced convention IS the rule; the warning-release arm is retained for the one
class where a tombstone cannot teach. Both homes amended in lockstep (releases.md §Amendment
and deprecation; principles.md P13's Chosen default):

- **A vocabulary retirement** (a flag, a config key, a registry role, a protocol word): **the
  tombstone is the retirement** — the retired surface becomes a permanent parse-time teaching
  refusal (a usage error or a strict validation failure naming the successor channel), never
  silently ignored; no warning release, because the refusal itself teaches on every use
  (detection at the surface — P8). Ids are never reused (P13's own discipline).
- **A behavior retirement** (a mechanism whose removal silently changes what happens, with no
  surface left to refuse): **one release of visible warning (P8's detection-not-a-gate), then
  removal in a named later release** — the written lifecycle survives exactly here.

This is the rule step 071 (w-vocab, "retired route words as tombstones per the
deprecation-lifecycle ruling") enacts against.

### D4 — P2's bounded-escalation line rephrased, current to 0198 (0165-069/F12's second half)

The line 0146 wrote mid-cycle — "fix rounds (progress-gated, never count-capped — two
consecutive no-gap rounds block, 0146 amending 0083 D5)" — imports a threshold ("two
consecutive") and a misreadable phrase ("no-gap rounds" reads as rounds without gaps, i.e.
passing rounds; it means rounds making no gap-count progress), and lags 0198's re-rule (the
progress key is the loop's best gap count; oscillation blocks too; the bound 2N+2). Rephrased
without the numbers and current to the standing rule: **"fix rounds (progress-gated, never
count-capped — blocking only when the gap count stops improving, 0146 amending 0083 D5, 0198
the best-count key) → `--repair` → the human"**. The thresholds stay with their mechanism
(`src/wrapup.ts`; AGENTS.md's verification-loop navigation line already carries "the
progress-based fix budget keyed on the loop's best gap count — oscillation blocks too, bound
2N+2"). The mid-cycle edit itself is recorded by D6's register (the retroactive 0146 row).

### D5 — the five definitional sentences (0165-182/F20)

One sentence each, placed where the term lives:

1. **Lock scope** (P5's lock derivation bullet): one lock per directory — one driver per
   working directory, held for the run's whole life; the lock's scope is commands that write
   what a running driver reads, never read-only channels — the retry fork takes no lock, loud
   on collision (0129; 0053 D1–D3's owning concern).
2. **"Shared git state"** (P17's Derivations, beside the doc-lanes bullet): the repository's
   administrative surfaces — refs, the index, worktree registrations, every read-modify-write
   of repository state — with the objects database append-only and exempt; one sole writer
   means the parent driver under lanes (landings flow through it, 0068; the seam decorator,
   0099 D4) — never concurrent administrative writes by workers.
3. **Task-id uniqueness** (P18's permanence bullet): task ids never repeat within one corpus;
   numbering derives from the surviving artifacts alone (0150), documents are write-once so
   deletion is off-protocol, and a restart's re-issued numbers open a new corpus — the
   downstream machinery corpus-bounded so the two never collide (0140).
4. **"Safe boundary"** (P20's control-at-boundaries derivation): a committed, resumable
   stopping point — a unit close, a phase or task boundary, and (0143) a session handover or
   the wrap-up entry inside a unit — where stopping leaves every artifact committed and the
   recovery record sufficient; control changes wait for the next such point. P6's `/exit`
   bullet, which uses the term, now leans on this definition.
5. **Tier precedence** (How-to-rule, after the tension sentence): when principles conflict,
   Tier I governs — a Tier II default bends to a Tier I principle (or is amended), never the
   reverse; a tension inside one tier is a ruling's material, never an excuse to skip the
   derivation. (The tier test's own consequence: a Tier II default may flip without identity
   change; a Tier I principle cannot bend without the tool becoming another tool.)

### D6 — the mid-cycle amendment register: the change-control rule amended, 0146 recorded, the two classes named (0165-069/F12's first half)

The change-control letter ("a release event is the only moment the constitution or a Tier II
default changes") was broken twice by the corpus's own practice — 0146 (a real Tier I
derivation rewrite, silent) and 0166 step 006 (wording reconciliations, unrecorded in any
release surface) — and this very step depends on editing between cuts (the replay-failure rule
makes the constitution's repair immediate). On P19 the rule is amended to the measured shape,
in both homes (principles.md's change-control paragraph; releases.md's intro):

- **The version spine, the stamp and the release sections move only at a cut** — unchanged.
- **Between releases the constitution's text may be edited in exactly two classes, each
  recorded as it lands**: **reconciliation** (a wording repair bringing the text back to what
  a ruling already ruled — texts lagging or contradicting their own rulings; step 006's and
  this step's class) and **mid-cycle amendment** (an `Amends:` ruling landing its change with
  the ruling itself — 0146's class). A Tier II default flip mid-cycle rides the same record,
  named as the default change it is.
- **The register**: `docs/releases.md` gains the mid-cycle amendment register — append-only,
  one row per edit (date, ruling/plans pointer, principle or surface, the delta in a clause,
  the finding) — consumed into the next release section's principle deltas at the cut and
  cleared there. The defect 0165-069 names was the edit's **silence**, never its timing: a
  mid-cycle edit the register states is durable, auditable and versioned at the next cut; one
  it does not state is an audit finding (the stamp misdating the text).
- **The retroactive row**: 0146's edit enters the register now, dated 2026-10-28, named as the
  retroactive record (0165-069's own remedy); step 006's two edits enter likewise; this
  ruling's edits enter as they land. Step 070 (wa-release-due) consumes the register into the
  next release section.

### D7 — the replay method named in the audit duty (0165-183/F21)

releases.md's per-release audit duty, item 2, gains the method sentence: **the replay never
runs inside the repository** — any agent session started there auto-loads AGENTS.md, whose
navigation names the rulings (S03 run 1's own isolation-breach note); the blind child starts
in an isolated directory holding the amended `docs/principles.md` alone, questions neutrally
phrased (no plan numbers, no mechanism names), plans closed. Ruled from the measured breach,
prospective: the v0.3.0 replay's isolation is unverifiable retroactively and its recorded
confirmation stands as recorded (named residual below); the next cut's replay runs under the
stated method.

### D8 — the derivation-wording aligned to the corpus's settled form (0165-181/F17)

How-to-rule's "Every future `plans/NNNN` decision block states its derivation" is aligned to
the practice: **every future `plans/NNNN` document states its derivation — one consolidated
Derives/Derivation paragraph covering every decision block is the corpus's settled form**
(each block's showing clause named in it; per-block tags equally legal). AGENTS.md's
development-conventions sentence — the same discipline's operative restatement — gains the
same consolidation clause in the same lockstep, so the two homes cannot drift apart again
(P5). No past document is nonconforming: the consolidated paragraph satisfied the discipline's
intent all along; the defect was the letter, never the corpus.

## Derivation and Category scope

Derives: **P18** (the showing: the constitution and release record are the durable design
record — reconciled to their rulings, and the mid-cycle register a plain-file append-only
durable record where none stated 0146's edit), **P19** (the showing: every reconciliation
cited — the two blind replay transcripts, 0146's verified commit diff, the four landed
tombstones against zero warning releases, the corpus's consolidated-Derives form measured
across its rulings; the lifecycle and mid-cycle rules ruled from the measured practice, never
taste), **P8** (the showing: the info class is P8's own third arm — detection that needs no
person act is a note, never a finding — and the vocabulary tombstone's teaching-at-the-surface
is the principle's detection channel), **P13** (the showing: the two-track lifecycle keeps the
additive-only discipline on the version axis — no silent dual meanings, no unversioned breaks
— while its letter states the retirement convention actually practiced). Amends: **the
change-control framework sentence** (principles.md's change-control paragraph and
releases.md's intro — the release-only letter restated as the two recorded classes with the
register; a Tier II documentation-default change riding D6's own register), **P13's
chosen-default lifecycle line** (the single-track wording restated as the two-track rule — a
Tier II default change, likewise registered), **P2's bounded-escalation derivation line**
(the threshold and the "no-gap rounds" phrase restated per D4 — reconciliation class: 0146's
own rule and 0198's, wording only), **P4's derivation bullets** (the adoption and re-anchor
stated per D1 — reconciliation class: 0145's own rule, wording only). Tier touched:
**documentation** (the constitution and the release framework; zero code, zero runtime
behavior). premises this ruling changes: **0110 D14** (the release framework's premise that "a
release event is the only moment the constitution changes" — amended by D6 to the two recorded
classes; 0110's version spine, stamp discipline, audit duties and falsification replay all
stand), **0053 §10 B4 / 0052 D3–D4** (none — their tombstone practice is what D3 codifies;
standing, re-read). No other standing ruling's premises are disturbed: 0145, 0183 D3, 0135,
0136, 0137, 0150, 0129, 0140, 0143, 0146, 0198 are each **re-read this change and restated,
not amended** — their text in the constitution now matches them.

### Category scope (0123 D1's discipline)

Family: *the constitution/releases documentation pair — the ruled design surfaces
`docs/principles.md` and `docs/releases.md`, their lockstep carriers, and the pin that holds
them*.

| home | disposition |
| --- | --- |
| `docs/principles.md` — P4 Derivations (bullets: SHA baseline, clean worktree, the 0076 tail) | changed — D1 |
| `docs/principles.md` — P8 (Statement parenthetical, Derivations, Chosen default) | changed — D2 |
| `docs/principles.md` — P13 Chosen default (the lifecycle line) | changed — D3 (Amends) |
| `docs/principles.md` — P2 Derivations (bounded escalation) | changed — D4 |
| `docs/principles.md` — P5 lock bullet; P17 Derivations; P18 permanence bullet; P20 control-at-boundaries bullet; How-to-rule (Tier precedence, D8's sentence) | changed — D5, D8 |
| `docs/principles.md` — change-control paragraph | changed — D6 (Amends) |
| `docs/releases.md` — intro (change-control sentence); §Amendment and deprecation (lifecycle); the mid-cycle amendment register (new); §The per-release audit duty item 2 (replay method) | changed — D3, D6, D7 |
| `AGENTS.md` — development conventions, the derivation-discipline sentence | changed — D8's lockstep clause (one clause; no navigation line changes — no code home moved) |
| `test/constitution-reconciliation.test.ts` (new) | changed — the pin (the 0221 docs-pin pattern: the reconciled texts' distinctive phrases asserted in both homes, fail-red at HEAD) |
| `plans/INDEX.md` | changed — the 0225 row |
| `docs/structure.md`, `docs/glossary.md`, `docs/shell-contract.md` | held — no module mapping or term changes ruled; the glossary's registers are step 066's |
| `plans/NNNN` originals (0145, 0146, 0135, 0136, 0137, 0150, 0129, 0140, 0143, 0198) | held untouched — the constitution moves toward them, never they toward it |
| The shells' README/AGENTS (packages/auto, auto-server docs) | held — the old wordings have no carriers there (grepped: the lifecycle sentence and the P4 phrases live in the two core docs alone) |
| Step 071 (w-vocab) | consumed — D3 is the deprecation-lifecycle rule its register row names |

## Residuals

- **The v0.3.0 replay's isolation** is unverifiable retroactively (F21's own impact note);
  its recorded confirmation stands as recorded, and the next cut's replay runs under D7's
  stated method — consumed at step 070/081.
- **The register's consumption** is a cut-time act: rows accumulate until step 070's due-cut
  reconciliation writes them into the next release section and clears the register; no test
  pins that consumption (the cut is the maintainer's act, 0110 D14's own frame).
- **The derivation-wording's oracle** is one pin over two homes; a future ruling reverting to
  per-block tags is legal (D8 says so) and must move the pin in the same change.
- 0165-182's five silences are stated, not mechanized: no test can force a definition to
  exist; the pin holds the five sentences against silent removal, and the next replay is the
  living audit.

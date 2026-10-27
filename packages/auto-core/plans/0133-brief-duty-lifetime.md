# 0133 — the project brief's duty and lifetime stated, and the analysis's with it

The ground (2026-10-27, the maintainer's question plus the doc census it prompted): the duties of
`docs/analysis.md` and `.opencode/auto/brief.md` had drifted unclear — inconsistent with the intent
bundles' duty text and with the docs family — and the brief's home in `.opencode/auto/` was questioned.
The census found six concrete drifts, each cited:

1. **Terminology collision.** Every planning prompt labeled the brief block `## Input: project intent`
   (`src/prompt-plan.ts`, `templates/prompts/phase-append.md`, `templates/prompts/prior-knowledge.md`)
   while every other surface — glossary, agents-block, mode templates, docs — says "project brief";
   `intent` is already the config key naming the bundle/pack family; the default pack's round-brief
   duty used "the brief" for the round brief and "the project intent" for the project brief in one
   sentence.
2. **Docs drift.** The glossary's "project brief stub" entry still described the 0052 D9 model retired
   by 0081 D11 (init writes a stub; `reset` removes-while-stub — the code keeps the brief always);
   there was no glossary entry at all for the pre-round `docs/analysis.md` (only the `a` phase-letter
   row, a different surface); `reset`'s keep reason said "the analysis phase's generated brief"; the
   shell README's whole brief block still taught the retired stub-and-hand-edit model.
3. **The cleanroom wall contradiction.** `templates/bundles/cleanroom/modes/cleanroom.md` said "the
   brief states the wall kind and the divergence corpus location" — but the charter (the pack's
   `### verify-plan`) makes a corpus path in any session-rendered surface a wall breach, the survey
   template keeps the location driver-side ("never session-visible content"), and the brief is
   rendered verbatim into every planning prompt. Read literally the mode text instructed the breach
   the charter forbids.
4. **The unstated lifetime.** `installBriefProposal` replaces the brief wholesale, from two gates (the
   analysis release, then every human-gated survey release) — the brief is the person's *latest
   approved* re-statement, never an accumulating file — while every description called it "the
   project's constants" as standing law, and no text said the analysis's proposal is provisional or
   that a survey's replaces it.
5. **Precedence backwards.** All three re-work bundles' survey duties read "the person's approved words
   first: the approved project analysis …, else the project brief and round brief" — analysis above
   brief — though the brief is the newer person approval whenever a survey has re-released it, and the
   replace semantics make it mechanically supreme among the brief-class text.
6. **Lane-row duplication.** The cleanroom survey proposed the lane rows "named and commanded" as part
   of its `## Project brief` proposal while the person installs the same rows into the materialized
   pack — lane commands in two homes against the pack's declared single home.

The follow-up census (2026-10-27, the maintainer's order question — *in what order are the two
documents filled and processed?*, the aster-mig tree the field case) added two measured findings:

7. **The brief-first start.** All three aster-mig feature projects (`features/erofs`, `features/igb`,
   `features/squashfs` — initialized cleanroom driver projects) carry hand-authored 76–77-line
   briefs with **no `docs/analysis.md` at all**: the person's start prepared the brief instead of the
   analysis. The machinery holds (the first `plan`/`transfer` still stops at the analysis), but
   nothing taught the order — and under the wholesale-replace semantics every hand-authored brief is
   silently clobbered at its project's analysis release, the D2 footgun live in the field with three
   projects' worth of careful content. The baseline project, by contrast, ran the designed lifetime
   (`analysis & brief` in one commit, the survey's completed proposal replacing the provisional brief
   at establishment) — with one visible defect, below.
8. **The punctuation leak.** The baseline's installed brief ends with the survey's `Clarified: yes`
   and `<!-- auto: eof -->`: the survey's `## Project brief` section is its document's last, and
   `briefProposal` — unlike the round-brief extractor, which explicitly skips the release mark with a
   comment explaining why — carried the document's trailing punctuation verbatim into standing law.
9. **The tool's own flag inviting the wrong start.** The maintainer's ruling question (2026-10-27):
   *maybe init should never prepare brief.md, and the tool should tell the user plainly how to start
   a project.* The `--brief`/`--brief-file` seed on init is a 0081-era relic — it predates the
   analysis flow (0084), from an era when seeding was the only way to name the reference at start —
   and it now teaches against the ruled order: the flag is precisely the brief-first start the
   features census caught, offered by the tool itself.

This ruling Derives: **P13** (frozen additive-only vocabularies — one name for one document, the
"project intent" label retired, the stub entry tombstoned rather than deleted, the init seed flag
retired through its tombstone notices; the config `intent` key's own meaning untouched), **P15**
(policy is data — the duty copy lives in the packs, bundles and templates; the label flip is copy, no
grammar moves), **P18** (the record outlives the tool — the glossary and README kept true to the
mechanisms they describe), **P19** (measured evidence — the doc census above is the ground; every
finding cited to its file), **P5** (single ownership — the lane commands' one home the pack; the
brief's one writer the driver), **P8** (deliberate enforcement moments — the order notice a
detection line that teaches its remedy, never a block), and **P21** inverted (machinery retired when
its consumer — the pre-analysis start — ceased to exist: a channel may lose its reason, not just
gain one). Tier touched: **Tier II operating** (duty text, prompt copy, docs, one advisory notice,
one extraction guard, one CLI flag retirement); no constitutional movement, no grammar change beyond
the punctuation guard.

## Category scope (0123 D1's discipline)

Family: *the brief/analysis duty texts and their document homes — the proposal-install family 0081
D15 / 0084 built (the two install gates, the release grammar) plus the cleanroom bundle's brief
duties.* Home-set enumerated at ruling time:

| home | disposition |
|---|---|
| `src/prompt-plan.ts` (the planning prompt's brief label and its not-provided fallback) | changed — `project intent` → `project brief` |
| `templates/prompts/phase-append.md`, `templates/prompts/prior-knowledge.md` (the same label) | changed — the same flip |
| `templates/intents/default.md` (`### round-brief`: "the brief and the project intent" → both briefs named) | changed |
| `templates/bundles/cleanroom/modes/cleanroom.md` (the corpus-location sentence) | changed — the brief never states the corpus location |
| `templates/bundles/{cleanroom,faithful,faithful-lean}/phases/survey.md` (the precedence sentence; cleanroom also the lane-row and corpus clauses) | changed — newest first; the decision in the brief, the commands in the pack |
| `src/brief.ts` (the module header; D8's punctuation guard in `briefProposal`) | changed — the lifetime and duty-split statement; document punctuation never brief content |
| `src/document/roles.ts` + `src/phases.ts` (D8's re-home: `CLARIFIED_MARK` to the document grammar's module, phases re-exporting) | changed — the literal's one home moved so the document domain reads it lawfully |
| `src/plan.ts` (`analysisOrderLines` + the three `analysisGate` stop branches) | changed — D7's notice |
| `src/driver-helper.ts` (the analysis-flow renders) | changed — the notice beside the held/awaiting lines and the no-analysis fact |
| `src/analysis.ts` (the stub's `## Project brief` comment) | changed — the order and replace-on-release taught at the founding moment |
| `src/agents-block.ts` (the analysis guidance's `## Project brief` parenthetical) | changed — the provisional-word and seed-only-before-release note |
| `src/reset.ts` (the keep reason) + `test/reset.test.ts` + `packages/auto/test/e2e.test.ts` (the same reason pinned through the real CLI) | changed — the reason names the two channels that remain (an approved proposal, a person's `amend --brief` write) |
| `packages/auto/src/index.ts` (init's `--brief`/`--brief-file` retired via the command-scoped entry; the brief write block amend's alone; the `-p` and migration notices, the run/plan refusal, the usage and help rows re-pointed) | changed — D9 |
| `test/config-fix.test.ts` (briefProposal's punctuation cases), `test/plan.test.ts` (the order-notice case + the no-brief notice re-pointed), `test/driver-helper.test.ts` (the notice in the render), `test/isolate.test.ts`/`test/config.test.ts`/`test/prompt-phase.test.ts` (the re-pointed strings), the e2e brief-channel blocks | changed — D7/D8/D9 pinned |
| `src/config.ts` (the retired-keys comment), `src/prompt.ts` (one comment word) | changed |
| `docs/glossary.md`, `docs/structure.md`, `AGENTS.md` (the brief navigation phrase), `packages/auto/README.md` (the brief block, the synopsis, the retired-options rows, and the intent-bundle walkthrough section — the maintainer's closing ask, *show the steps of working with opencode-auto and those intents*: the cleanroom walk keyed to the plain flow's steps, the person's materialization declarations named, faithful/faithful-lean one paragraph each) | changed — the drift repaired, the project analysis entry added, the walkthrough added |
| `test/prompt-phase.test.ts`, `test/template.test.ts`, `test/golden/*.golden.md` (11 files) | changed — re-pinned to the new label |
| The install machinery (`installBriefProposal`, `installApprovedBrief`, the two gates), the analysis grammar (`ANALYSIS_SECTIONS`, the roadmap/round-brief readers), the wall machinery (`src/wall.ts`), the pack's lane grammar (`src/intent/test-lanes.ts`) | held, untouched — the ruling states what the machinery already does; no semantics move |
| The brief's path `.opencode/auto/brief.md` | held, deliberately — D2 answers the home question |

## The ruling

**D1 — the duty split stated.** `docs/analysis.md` is the *engagement contract*: released once by the
person's `Clarified: yes`, its `## Roadmap` lines and `## Round briefs` proposals stay living law
(each round's phase list, each round's installed brief), its narrative sections (`## Analysis`,
`## Goals`, `## Project brief`) the standing background the surveys read — the record of what the
person approved, not law that outranks a later approval. `.opencode/auto/brief.md` is the *standing
constants every session reads*: the latest person-approved statement of what this project is, where
the reference lives, where the deliverable goes, the constraints that bind every round. Stated in the
`src/brief.ts` header, the glossary's two entries, and the structure.md rows.

**D2 — the lifetime stated, and the home question answered.** The brief is the person's latest
approved re-statement, never an accumulating file: `installBriefProposal` replaces it wholesale, so
the newer approval *is* the whole brief. Two gates install it — the analysis release installs the
provisional constants at the project start; every human-gated survey release installs the completed or
revised ones (the re-work bundles' survey adds the wall kind, the platform contract, the reference
door, the round's scope posture). A hand edit between approvals is silently replaced at the next
install — and that is why the file lives in the driver-owned plane: the replace semantics makes the
brief derived state (P6) whose source of truth is the sequence of approved proposals in git history,
and a hand-editable `docs/` home would turn every install into a clobber trap. The classification is
taught honestly with it: person words, driver-owned write channel — the person's channel is the
proposal (and `init/amend --brief` the rare manual override), never the pen. A `docs/` home would be
right only under an accumulating-file model, which no mechanism implements; that model is not built
here (P21 — it waits for a consumer).

**D3 — the terminology unified.** "Project brief" is the one name; the planning prompt's label flips
(`## Input: project brief (.opencode/auto/brief.md)`), the not-provided fallback with it, the two
prompt templates, and the default pack's round-brief duty now names both documents ("Where the round
brief and the project brief disagree, the round brief is the newer word for this round" — the
precedence the duty already ruled, now with unambiguous names). The config `intent` key keeps its own
meaning (the bundle/pack family); nothing that says "intent pack" moves.

**D4 — the cleanroom wall consistency.** The mode text now states the brief's cleanroom content duties
as the charter already rules them: the brief states the wall kind and declares the platform contract,
and it **never** states the divergence corpus location — the corpus is a driver-side location outside
the platform boundary whose exact path is the person's driver-side fact, an environment fact for the
person, never session-visible content, "a corpus path in any session-rendered surface, the brief
included, is a wall breach". The survey's declaration paragraph splits the lane rows the same way:
the brief proposal carries the *decision* (which lanes exist and why), the lane commands live in the
pack alone, their single home (P5), the person installing the approved rows there.

**D5 — the survey precedence fixed.** All three re-work bundles' survey duties now read newest first:
the current project brief (the latest approved proposal — it replaces every earlier one wholesale)
and this round's round brief, then the approved project analysis as the standing background — a
decision a later approval revised does not revive, and where the analysis settles what no later
approval touches, its line binds. This matches the replace semantics and the default pack's
round-brief duty instead of contradicting them.

**D6 — the docs drift repaired.** The glossary gains the project analysis entry and carries the
lifetime in the project brief entry; the stub entry is tombstoned (retired with 0081 D11, the
reference-check row's pattern); `reset`'s keep reason names "a person seed or the latest installed
approved proposal"; the shell README's brief block is rewritten off the retired stub-and-hand-edit
model; structure.md's two rows and AGENTS.md's navigation phrase carry the ruling with its pointer.

**D7 — the order stated and guarded.** The fill order and the processing, stated once and taught at
every surface the person meets: (1) `init` writes the config layer and no brief (D9); (2) the first
`plan`/`transfer` opens
`docs/analysis.md` — the person and their agent fill *all* its sections, the `## Project brief`
section the provisional proposal; (3) the release (`clarify` or the hand mark) installs that section
verbatim as the whole brief and opens R-01 under the roadmap line; (4) every human-gated survey
release installs the completed or revised proposal the same way — newest approval the entire file.
The runtime half: `analysisOrderLines` (`src/plan.ts`) appends one advisory line to every
unreleased-analysis stop shape (opened, held, awaiting — `analysisGate`'s three branches) and to
`driver-helper`'s renders (including the no-analysis-yet fact): *a project brief is already on disk;
the analysis still comes first — the approved `## Project brief` section replaces the whole brief on
release, so carry the disk brief's content into that section (or restore it with `amend --brief`
afterwards)* — the notice fires exactly in the aster-mig features shape and stays empty (the
byte-identical floor) when no brief is on disk. The teaching half: the analysis stub's
`## Project brief` comment, the agents-block analysis guidance, the README's brief block and the
glossary entry all state the order and the replace-on-release.

**D8 — document punctuation never brief content.** `briefProposal` skips whole-line
`Clarified: yes` and `<!-- auto: eof -->` inside the section body — the round-brief extractor's
discipline (analysis.ts `roundBriefProposals`) extended to the project brief after the baseline's
installed brief carried both into standing law. The mark literal re-homes with it:
`CLARIFIED_MARK` now lives in `document/roles.ts` (its grammar's module — the document domain's
extractors must read it without crossing D8's domain edge, the import-direction ratchet the
enforcer that caught the first attempt) with `phases.ts` re-exporting it, so no importer moves.
The already-installed baseline brief keeps its trailing lines until the next approved install (or
`amend --brief`) — a person-side remedy, named here rather than mechanized: no migration machinery
for a cosmetic residue.

**D9 — init never writes a brief; the start path is the analysis flow.** The `--brief`/`--brief-file`
pair retires on init (the `-p` precedent — a command-scoped `RETIRED_FLAGS` entry, exit 1 with a
notice naming the flow: the first `plan`/`transfer` opens `docs/analysis.md`, its approved
`## Project brief` proposal installs the brief on release, `amend --brief` the later manual
override); amend keeps the pair as the brief's revision channel alone. With the seed gone, no brief
exists before a project's analysis release by design, and the start path is taught with one voice:
init's own closing line (already "next: transfer|plan … opens the assisted project analysis: you and
your agent fill docs/analysis.md … round R-01 opens on its release"), the no-brief planning notice
and the planning prompt's not-provided fallback (both re-pointed from the seed to the analysis's
proposal), the analysis stub's comment, the agents-block guidance ("no brief exists before this
release"), the glossary, and the README's synopsis and brief block. `amend --brief` stays the
person's manual override — written pre-release it meets D7's notice, so even the off-channel path is
taught at the stop it creates. The retirement rides the tombstone discipline: one change, every
notice and pin moved with it, existing projects untouched (their briefs, however authored, are read
as ever — the replace semantics owns them at the next approval).

**The byte-identical floor (P10).** No grammar, gate, install path or mechanism changes; the labels
and duty texts are copy. Materialized projects keep their shipped text until `sync` carries it — the
same channel every upstream duty-text change rides; the label flip changes no parsed protocol string
(nothing parses the block heading back).

## The rename considered and declined

The maintainer's follow-up question (2026-10-27): the analysis document serves before any round *and*
between rounds — should `docs/analysis.md` be renamed (`roadmap.md` or some other name) so the name
covers the whole lifetime? Declined, on four grounds:

1. **The name is load-bearing teaching for the founding moment.** The document's highest-leverage
   content is `## Analysis` / `## Goals` — "done thoroughly, this analysis determines the key work of
   the rounds that follow". A file named `roadmap.md` at project start invites the outline-is-the-work
   failure the guidance exists to prevent; the analysis name teaches where the bar sits.
2. **`roadmap` names only the living half, and not even all of it.** The between-rounds editing is the
   `## Roadmap` line and the `### R-NN` round-brief subsection — the round briefs are not roadmap
   lines — and a `## Roadmap` section inside a file named roadmap.md forces a section-grammar
   restructure, turning a path rename into a document-grammar change.
3. **The cost is a full lockstep (P13/P18) against a cosmetic gain (P19).** The path is a permanent
   document surface: ~10 source modules and 17 named mentions, the AGENTS-block primer's person-facing
   teaching, 16 test files, the three bundles' survey duties, the docs family — plus a migration or
   dual-read for every existing project. No field incident of the name misleading anyone is on
   record; the discomfort was the unstated lifetime, which D1 just stated everywhere.
4. **The split variant is the same trade worse.** Splitting the living law (`## Roadmap` + `## Round
   briefs`) into a `docs/roadmap.md` with the narrative frozen in `analysis.md` matches the duty split
   structurally, but fragments the person's one engagement artifact (one sitting, one release gate,
   one `Clarified: yes`) into two permanent surfaces and two-home governance — against the one-home
   discipline the single document serves today.

The trigger that would reopen this: field evidence (persons or sessions repeatedly misreading the
document's standing at round boundaries) — and then the name would still need to cover both halves
better than `roadmap` does ("charter" is taken by the intent charter), as its own numbered change
with the migration designed in.

## Enactment

The homes of the Category scope table, this file, the INDEX row. Verification: full typecheck clean
(both packages); the prompt trio (prompt-exec / prompt-phase / prompt-template) green with the
goldens regenerated; `test/reset.test.ts`, `test/bundle.test.ts` (the cleanroom text),
`test/config-fix.test.ts` (D8's cases), `test/plan.test.ts` + `test/driver-helper.test.ts` (D7's
notice, D9's re-pointed strings), the full auto-core suite green, the shell suite green (the
E2E-gated skips aside, the brief-channel e2e blocks re-pinned for the retirement).

## The closing read

The census re-run as greps over the tree: the label `project intent` occurs nowhere outside the
historical plans/ corpus and the intent-pack usages that mean the pack; `modes/cleanroom.md` and the
survey now agree with the charter (the corpus location driver-side, never brief content); the
glossary's brief cluster states the lifetime and the analysis has its entry; the regenerated goldens
show `## Input: project brief` in every planning render; `init --brief` appears nowhere as a live
channel (the retirement notices and the historical plans/ corpus aside). The order, read against the
field: the baseline's survey release would now install a clean brief (the trailing mark and
terminator stripped), and each of the three features projects, at its first `plan`, meets the stop
that says the analysis comes first and names the replace-on-release rescue for the hand-authored
brief on its disk — the person-side act (carrying that content into the analysis's `## Project
brief` section) stays theirs.

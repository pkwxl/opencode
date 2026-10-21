# The positioning anchor and the tiered rule space — 0110 stage 2b (DRAFT, awaiting the maintainer's rulings)

- date: 2026-10-21
- input: `principles-draft.md` (stage 2) + the batch corpus, re-read against the maintainer's redirect (recorded verbatim in the plan's §Redirect ruling)
- status: **DRAFT — presented at checkpoint 2b, not approved.** The stage-2 draft is not superseded; this file restructures it. Nothing is re-keyed until the journal carries the approval line (D10).

The redirect, verbatim: *"let us re-examine the positioning and requirements of the entire project, and subsequently restructure the design … some can serve as genuine design principles, while others are merely minor requirements with limited impact. We need to identify which principles are vital to our positioning and requirements, and which are trivial, concrete requirements; which are optional trade-offs, and which are decisions that might cause conflicts or deviate from our goals … how should we constrain and govern requirements, and organize future software evolution around the concept of release versions."*

---

## 1. The positioning statement (the anchor above the principles)

The constitution's first section. Every principle must trace to a clause of this statement; the trace is the tier test of §2. Each clause is corpus-grounded, not coined:

- **What it is.** A **person-governed driver for long-range software work**. It does not think, judge, or remember as an agent does; it drives replaceable coding-agent sessions through a ruled structure — rounds, phases, task units — inside a target directory the person owns, from stated intent to a shippable deliverable.
- **For whom.** One person (or a handful) governing work too long for any single session — migrations, reworks, cleanroom builds. The field projects of the corpus (dm-flash, dm-glm, spi-nor-glm, aster-net, common) are the shape; every major mechanism in the corpus was ruled from one of their measured rounds.
- **The exchange.** The person supplies intent and the consequential decisions, at brackets the tool designs for them; the driver supplies the mechanical span between brackets — unattended, bounded, recoverable. "Human attention does not scale with `--max-agents`" (0036); autonomy is bought for the mechanical span only.
- **The guarantees — the pillars.** Completion is verifiable, never narrated (P3). The deliverable stands alone (P1). The person's decisions are never taken or consumed silently (P2). The record outlives the tool — plain files and git, no lock-in, no special tooling (P18; 0064 §1: "not lock-in but its absence").
- **The fences — what it is not.** Not a content judge (P7; 0064 §4's first fence). Not an unattended automation — every escalation's terminal is the person (P2). Not a platform, marketplace, or multi-user orchestrator (0060 §5.8, 0064 T2). Not project-specific — no target's facts in tool source (P16-genericity; 0108 D8.1).
- **The substrate.** Git and plain files are the only durable state (0064 §2: "the state store is git+files rather than a database"); agents and models are replaceable means — the tier belongs to the work, the fleet to the operator (0055 §3).

## 2. The rule space is tiered (the architecture under the positioning)

The tier test, applied to every candidate: **remove it and ask what breaks.**

- **Tier I — constitutional principles.** Removal breaks a positioning pillar, fence, or contract; the tool becomes a different tool. Amended only through the versioned `Amends:` discipline (D5, D15). Target: a handful — bounded by the positioning, never a quota.
- **Tier II — operating principles.** Removal degrades how the tool runs without changing what it is. Each is a **standing trade-off**: a stated choice, its chosen default, and the trigger that reopens it. Changed by `Amends:` on the same versioned discipline, but more cheaply than Tier I — the trade-off may flip without identity change.
- **Concrete requirements.** Mechanical, testable, right-or-wrong by inspection; stable once set (formats, grammars, exit codes, thresholds, security mechanics). They **live with their mechanisms** — code headers, `docs/structure.md` rows, INDEX pointers — never in the constitution. "Requirement" ranks by criticality, not importance-to-positioning: a security requirement is a requirement precisely because it has a right answer, not because it matters less.
- **The trade-off register.** The point resolutions: tension → choice made → the release/incident that made it → the trigger to revisit. This is where the maintainer's "optional trade-offs" live — decisions genuinely open to flipping, with their reopening conditions stated.
- **The risk register.** The known conflict and deviation points: risk → what it threatens → mitigation → where it last showed. This is where "decisions that might cause conflicts or deviate from our goals" live — not as principles, as watched items.

```
Positioning (§0 — what/why, pillars, fences, substrate)
  └─ Tier I constitutional principles (identity; versioned amendment)
       └─ Tier II operating principles (standing trade-offs: choice/default/trigger)
            └─ concrete requirements (with their mechanisms: code, structure.md, INDEX)
Trade-off register (open decisions)      Risk register (watched conflicts)
```

## 3. The disposition of the twenty (proposal — checkpoint item)

| draft | disposition | the one-line reason (the tier test applied) |
|---|---|---|
| P1 stands alone | **Tier I** | the deliverable pillar — remove it and the tool steers work toward artifacts coupled to their own construction site |
| P2 person brackets | **Tier I** | the governance pillar — remove it and the tool is unattended automation, a different product |
| P3 never self-report | **Tier I** | the trust pillar — the founding pivot (0007); remove it and every guarantee above it is built on narrative |
| P4 committing = completion | **Tier I** (contract-grade) | the completion contract on the git substrate; removal weakens P3 and P18 together (no audit trail, no rollback anchor) |
| P5 one home/writer | **Tier II**, **merge with P11** | universal single-ownership policy — state and mechanism are its two scopes; no positioning clause names it |
| P6 derived state | **Tier II** | state policy with a real trade-off (recompute vs persist; chosen: derive) serving P3/P18 |
| P7 grammars never content | **Tier I** (fence-grade) | the "not a content judge" fence — remove it and the driver drifts toward being a judge, 0064's first fence |
| P8 enforcement moments | **Tier II** | timing policy derivable from P1+P2 but attested as its own family (0100 D6, 0103, 0106) |
| P9 counts not lists | **demote — presentation convention** (a concrete requirement) | one review's readability ruling (0109); surface-local, re-decidable per surface, no positioning trace |
| P10 byte-identical floor | **Tier II** | the change-discipline trade-off; becomes the release compatibility statement (§6) |
| P11 one home per mechanism | **merged into P5** | same failure class and same ratchet family as P5; separate ids duplicated the policy |
| P12 fail loud | **Tier II** | operational discipline, universal; the strictness calibration is its trade-off |
| P13 frozen vocabularies | **Tier II** | the additive-only compatibility contract; its lifecycle half becomes the versioned deprecation discipline (§6) |
| P14 one-way dependencies | **Tier II** | architecture policy; the core/shell seam is tool-specific but structural, not identity |
| P15 policy is data | **Tier II** | the extension model; the "key selects, never composes" clause is fence-adjacent but the whole is a mechanism policy |
| P16 no env facts / references | **split**: genericity → **Tier II** (fence-adjacent); references-never-literals → **demote — the security requirement family** | genericity serves "not project-specific" (positioning); credential hygiene has right answers — hard, testable, enforced in code and review, not a trade-off |
| P17 declared concurrency | **Tier II** | domain policy; the concurrency machinery could be redesigned without identity change |
| P18 record outlives tool | **Tier I** | the record pillar — 0064's moat thesis; remove it and the substrate claim dies |
| P19 measured evidence | **Tier II** (the governance pillar) | how rulings are ruled — it governs the development process, becoming the evidence rule of §5 |
| P20 in-flight preserved | **Tier II** | resilience policy; the latency-vs-survival trade-off, unified as the draft proposed (its Q3) |

Outcome: **six Tier I** (P1, P2, P3, P4, P7, P18 — four pillars, one fence, one contract), **twelve Tier II** (ownership [P5+P11], P6, P8, P10, P12, P13, P14, P15, P16-genericity, P17, P19, P20), **two demotions** (P9 → presentation convention; P16's secrets half → security requirement family). Numbering: ids are never reused (P13's own discipline) — P9 and P11 tombstone in the numbering note ("demoted", "folded into P5"), P16 restated as genericity alone.

The draft's five questions, dispositioned by the restructure: (1) P5 stays merged, P16 splits **by tier** — the merge question dissolves once tier exists; (2) the count question dissolves into the tier question — 6 + 12 + 2, each tier bounded by its own test; (3) P20's unification confirmed, as Tier II; (4) the coined statements are re-presented here in tiered form — read both rounds; (5) P7's rank answered: Tier I.

## 4. Tier I restated (the constitution's core — full treatment stays the draft's)

1. **P1 — the deliverable stands alone.** The pillar that makes the tool a *migration* driver rather than a note-keeper: process documents are scaffolding, deleted at the end; the shipped artifact must not need them.
2. **P2 — the person brackets every boundary.** The pillar that makes it *governed*: bounded agency, the human the unbounded backstop, decisions surfaced never consumed.
3. **P3 — completion is never judged by agent self-report.** The pillar that makes its guarantees *checkable*: artifacts, commits, receipts, and fresh verification — never narrative.
4. **P4 — committing is the completion condition** *(contract-grade)*. The trust pillar's contract on the record pillar's substrate: one writer (the driver), one boundary (the unified commit), one audit trail (SHA baseline), one rollback anchor.
5. **P7 — the driver judges grammars it defines, never the meaning of content** *(fence-grade)*. The boundary that keeps the driver a driver: mechanical grammars only; judgment belongs to planned acceptance work, sessions, and people.
6. **P18 — the record outlives the tool.** The pillar that makes adoption cheap and audits toolless: plain files and git, permanent paths, machine-addressable history, best-effort journals over a committed trail.

## 5. The trade-off register (the open decisions — proposed entries, checkpoint item)

Each row: the tension → the choice made → where it was ruled → the trigger that reopens it. A trade-off row is never closed; it is a standing decision with its reopening condition stated.

| # | tension | choice | ruled | reopen when |
|---|---|---|---|---|
| T1 | record during rounds vs block early (P1/P8 against P12) | defer enforcement to the release moment; one count line during rounds | 0103 D2 + addendum two | a field round where the accumulated release-blocking set proves late and expensive to restate (the 0045 and 0103-carve-out drifts are the history) |
| T2 | fresh verification vs session cost (P3) | a fresh session per unit judging by inspection, no context re-buy | 0083 | verification cost measurably dominating execution in the stats buckets |
| T3 | boundary stops vs unattended velocity (P2) | one advance per invocation; stops at clean phase ends | 0101 | a field project where the rhythm measurably starves throughput — `--boundary flow` and the 0089 mode phrases are the sanctioned pressure valves |
| T4 | curated deliverable history vs full trail (P4/P18) | `land` squashes by default; the driven root keeps the per-unit trail | 0074 | a person needing per-unit granularity in the shipped history (`--merge` is the flip) |
| T5 | counts vs itemization on human surfaces (P9 → convention) | aggregate counts; enumeration only where the list is the work (the release fix list, a stop's own problems) | 0109 | a surface where the count repeatedly sends the person hunting for the items |
| T6 | person-edited packs vs upgrade convenience (P15) | person edits win; the tool keeps offering its bytes | 0100 D2 | a security-critical charter fix blocked by a stale pack |
| T7 | isolation vs cost (P17) | the cheapest fitting tier: processes → same-tree doc lanes → worktrees | 0096 D9, 0099 | a measured landing-conflict or serialization pattern (the tier probe decides) |
| T8 | wait-and-preserve vs fail-fast (P20) | wait out quota windows, keep accumulated context, hints before halts | 0015/0016, 0057 | waits dominating productive wall-clock in the stats |
| T9 | strict parse vs forward compatibility (P12/P13) | strict where a wrong value silently changes behavior (registry, charter keys); lenient where consumers must survive unknown lines (event streams, journals) | 0055 §4.1, 0067 P2a | a compatibility incident in either direction |

## 6. The risk register (the watched conflicts — proposed entries, checkpoint item)

Each row: the risk → what it threatens → the mitigation → where it last showed. Risk rows are watched, never resolved by wording.

| # | risk | threatens | mitigation | last showed |
|---|---|---|---|---|
| R1 | deferred-enforcement drift — a codification narrower than the ruling it records | P1's integrity; the exact trigger-incident family of this initiative | the derivation discipline (D5) + the falsification replay (D9) | 0103's process-path carve-out, corrected only when aster-net tripped (addendum two) |
| R2 | channel divergence — the manual suite enforces what the driver's rounds defer | one truth across the two channel families (P1's stricter twin) | the ratchet test pins shared literals; the divergence recorded as deliberate (T1's row) | 0103 |
| R3 | floor-masks-defect — a byte-identical floor preserves behavior later ruled a defect | P10 against correctness | 0057 §11.1's defect exemption; scheduled dead-protocol audits (0069) | 0069's dead-field cleanup |
| R4 | constitution creep — requirements migrating upward into principles | the constitution's usability (AGENTS.md's 65-bullet precedent) | the tier test at every `Amends:`; size is an audit finding | this initiative's diagnosis (§0 of the plan) |
| R5 | person-gate throughput — every boundary a person act vs long unattended spans | P2's cadence against real projects' scale | delegated channels (0107), the standing surfaces (driver-helper), the 0089 modes; authorship never delegates | watch, not incident |
| R6 | vocabulary freeze vs cleanup — additive-only accumulates dead literals | P13 against maintainability | versioned deprecation (the §8 lifecycle); scheduled audits | 0069 |
| R7 | corpus-as-requirements growth — rulings accrete without governance | discoverability of the rule space (108 documents, no index) | INDEX + the release organization (§8); plans stay retired-once-obsolete | this initiative's diagnosis |

## 7. Requirements governance (how requirements are constrained and governed)

The corpus's diagnosed disease (§0 of the plan: 108 documents, no index, supersession inconsistent) is **requirements accretion without governance**. The framework:

- **Admission.** A requirement enters only through a `plans/NNNN` ruling that states `Derives: P-NN` or `Amends: P-NN` (D5) **plus the tier it touches** (constitutional / operating / requirement). A ruling matching no principle is resolved before landing — constitution incomplete or ruling drift — and a *requirement* ruling names its code home and its test home in the same change.
- **The evidence rule (P19).** Measured field evidence or a named incident; every claim cited; speculation is not a basis. Pre-emptive rules carry their open gaps explicitly and their own re-audit trigger (0057 §11.10; 0064 T1).
- **The traceability chain.** positioning → Tier I principle → Tier II policy → concrete requirement → code home → test home. Both directions audited (D6) — rule→principle (orphans, gaps) and principle→code (divergences) — with findings numbered and append-only.
- **Growth constraints.** The constitution is bounded by the tier test, never a quota; concrete requirements never migrate upward without an `Amends:` ruling; AGENTS.md's navigation is the precedent-documented failure mode (65 bullets, ~69k chars of embedded rulings) and stays pruned by D3; orphan requirements are audit findings.
- **Change control.** Between releases, findings accumulate; **a release event is the only moment the constitution or a Tier II default changes** (§6). This is what converts the corpus's 110-document accretion into versioned, reviewable steps.

## 8. Release-version organization (evolution around releases)

There is no version practice today: no git tags, `version: 0.0.0`, the plans corpus the only history. The framework starts from zero and stays documentation-layer in this initiative (D8's zero-code rule holds; tooling is follow-up findings):

- **The version spine.** Semver on the package family, as the design-evolution axis: **major** — a Tier I amendment or a breaking contract change; **minor** — a new opt-in mechanism (floor-preserving, P10) or a Tier II default change; **patch** — ruled defect fixes (0057 §11.1: defects change every run, exempt from the floor). While pre-1.0, minor may carry breaking changes — the release record says so in words; semver discipline tightens at 1.0.
- **`docs/releases.md` — the release record** (a new maintained file; D8's list extended by this ruling). One section per release: version, date, the principles deltas (`Amends:`/`Derives:` with P-ids and tier), mechanisms added/retired with plans pointers, tombstones, the falsification-replay confirmation (D9), and the audit findings' disposition. Git history stays the code audit trail (P18); the release record is the *design* changelog.
- **The INDEX release column.** `plans/INDEX.md` rows gain the release each plan's rulings shipped in; supersession pointers name the release that superseded. The corpus 0001–0109 maps to `pre` (pre-versioning) — no retroactive versioning of history; originals untouched.
- **The amendment lifecycle.** An `Amends:` ruling names the release it amends; `docs/principles.md` carries the stamp "current as of release vX.Y". The falsification replay runs against each release's constitution.
- **The deprecation lifecycle.** Retiring a mechanism or vocabulary: tombstone → one release of visible warning (detection-not-a-gate, P8) → removal in a *named* later release. P13's additive-only discipline on the version axis: no silent dual meanings, no unversioned breaks.
- **Cadence.** A release is cut when a ruled program completes; the maintainer cuts it. The first release entry records this initiative itself: the constitution adopted, the tiers ruled, INDEX born, the corpus baselined as `pre`.

## 9. Questions for the maintainer (checkpoint 2b rulings requested)

1. **Tier I membership.** Six proposed: the four pillars (P1, P2, P3, P18) plus P4 (contract-grade) and P7 (fence-grade). The judgment calls are P4 — its derivability from P3+P18 argues Tier II to a strict reading; the corpus treats it as constitutional — and P7 as a fence rather than a pillar. Confirm or adjust.
2. **The two demotions.** P9 → the presentation convention; P16's references/secrets half → the security requirement family (genericity stays, restated). Confirm.
3. **The merge.** P5+P11 → one ownership principle with two scopes (state, mechanism). Confirm or keep separate.
4. **Tier II's shape.** Each operating principle gains choice / chosen default / revisit trigger beside its statement (the draft's five-part format plus three fields), and the two registers join the constitution as closing sections. Confirm, or hold trade-offs only in the register and keep Tier II statements pure.
5. **The release framework.** `docs/releases.md` as a new maintained file; INDEX's release column with the corpus baselined `pre`; the semver mapping (major = Tier I amendment; minor = mechanism/default change; patch = defect); the maintainer cuts releases at program completion; versioning stays documentation-layer in this initiative, tooling as findings. Confirm or reshape — including whether the first release is this initiative's landing.
6. **The governance tier tag.** Future rulings carry `Derives:`/`Amends:` plus the tier touched (D5 extended). Confirm.

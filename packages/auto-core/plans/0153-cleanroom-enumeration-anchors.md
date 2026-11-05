# 0153 — the cleanroom enumeration anchors: the capability catalog, closed observable surfaces, and the spec-read provenance duties

The maintainer's ruling (2026-10-29, over the aster-mig cleanroom workspace — the
migration-methodology review the workspace distilled the same day into its own constitution;
the tool-side half is this document): *"What actually suppresses multi-run deviation is: the
externally observable surface as the closed enumeration anchor + a fixed schema with stable
IDs + workload-driven layering criteria + a multi-run diff as the gate."* / *"Every
specification entry must record its source (man page, standard, black-box test observation,
directed source reading), so it can be audited after the fact."* / *"An L3 specification
describes only properties and invariants … never mechanisms."* — with the multi-round
baseline rule from the same review's principles document: *"No round may unnecessarily
repeat the full Survey and Spec-Read, nor silently change confirmed specifications,
capability classifications, or migration scope without an explicit record."* The
workspace-side half (the methodology constitution, the per-project brief
restatements, the platform-contract evolution clause) landed in the cleanroom workspace the same
day; this document carries the bundle's duties.

## The measurement (the first baseline circuit's own survey artifact)

- **The shipped survey duty enumerated the source tree.** "enumerate the reference at the
  location the brief names — subsystem areas, line counts, structure" — and the workspace's
  first baseline circuit executed it faithfully: its R-01 survey is wholly source-derived
  (16,674 enumerated lines across eight files, per-file function and export counts,
  complexity grades, the boundary families enumerated from the source's own exported
  symbols). The review's three deviation sources are all measured in that one artifact:
  the enumeration object is **unclosed** (every run of "survey the subsystem" picks its own
  cut and granularity), the output has **no fixed schema** (the capability split's
  granularity varies run to run — two results cannot be compared item by item), and there
  is **no completeness criterion** (nothing says when a survey is done).
- **No catalog artifact existed anywhere.** The capability set lived as prose rows in the
  workspace's roadmap and analysis documents — re-derived per project, never diffable
  against a prior enumeration, statuses like "deferred" carried in sentences rather than
  on entries.
- **The spec notes' traceability ran to note-task sections, not evidence kinds.** The
  consolidation mapped every source section to its home, but nothing recorded whether a
  stated behavior came from a published specification, a standard, a black-box observation,
  or a directed source read — the audit trail independence adjudication wants after the
  fact.

## D1 — the survey's enumeration instrument moves to the closed observable surface

The duty text enumerates **capabilities against the closed observable surface the brief's
methodology names** — published specifications, device documentation, consumer-facing entry
families with the declared consumer set — a finite, listable anchor set. The reference at
the location the brief names keeps its two lawful roles — sizing (subsystem areas, line
counts, structure, the boundary and wall facts) and the targeted reading of specific
entries — and loses the third it never should have had: being the enumeration instrument.
Generic per P16: the template names no environment's anchors; the brief carries them (the
workspace's briefs name theirs — format specifications for filesystem features, device
documentation for drivers, consumer entry families for kernel-internal capabilities).

## D2 — the standing capability catalog, with status semantics and a completeness criterion

The closing consolidation task now writes/updates `docs/capability-catalog.md` beside the
MUST baseline: one row per capability — stable id (derived from its anchor, so two
enumerations of the same service diff id by id), anchor, level, contract strength, status,
dependencies, evidence, spec version, acceptance case. The statuses carry their own rules
in the duty: Required / Deferred / Optional / Retired / **Unresolved — never silently
treated as Optional, it is the person's adjudication queue** (P2). Completeness is a
criterion, not a feeling: the enumeration is complete when **every anchor of the closed set
has its row**, gap rows included — a row whose finding is "no consumer / out of target" is
a recorded row, not an open-ended "more reading".

## D3 — the consistency design and the delta rule (teaching, no mechanism)

The first survey's enumeration is **built to run as an independent pair** under the
person's comparative arrangement (fork arms of the project), the pair diffed id by id,
every difference landing as an Unresolved row — never one run silently kept. Later rounds
are **delta enumerations over new ids alone**: recorded entries are frozen at their spec
version, and a challenge to a frozen entry is a recorded baseline change (evidence, impact,
the person's decision, re-validation of the affected work) — never a re-survey side effect.
No mechanism rides: the pair's orchestration and the diff stay with the person and the
driver-side workflow — the fork machinery (0129) and the comparative arms already exist,
and P21 holds (the duties teach the shape; the consumers own the runs).

## D4 — the spec-read provenance and property-first duties

Every specification entry records its **evidence kind** — published specification /
standard / black-box observation / directed source read — so independence is auditable
from the notes alone. Capabilities with no public interface of their own (**internal
enablers**) are specified **property-first**: invariants and guarantees (no lost wakeup,
ordering and flush visibility, latency bounds, never-fail reserves), never mechanism
narration, with consumer-shaped acceptance criteria where a consumer is imminent — the
highest cleanroom-risk class gets the discipline that names what must hold without
teaching a mechanism to copy.

## The floors

- **The 0085 decision discipline is untouched** — analysis-first, `Settled:` lines, the
  `Recommend:`-on-the-line fork bar; the new duties compose inside the same survey.
- **The 0121 compliance gates are untouched** — the wall, the divergence lanes, the audit
  dimensions; the methodology changes what enumerates and what a spec entry records, never
  the compliance bar.
- **The faithful postures keep their survey shapes** — the discipline is cleanroom's (its
  clean rooms are why enumeration anchors and provenance exist); no shared pin moves.
- **No phase-document grammar change** — `Phase-artifacts:` stays `survey.md` /
  `spec-notes.md`; the catalog is a project document the duty names, not a phase artifact
  the machinery tracks.

Derives: **P15** (policy is data, pinned in committed state — the duties are the bundle's
committed policy and the pin test holds them), **P19** (measured evidence — the first
circuit's survey artifact is the measurement), **P2** (the person's adjudication — the
Unresolved queue, the status flips and baseline changes are the person's brackets, never
silent), **P16** (genericity — the anchors ride the brief, never the template). Amends:
none — 0085's decision discipline and 0121's gates stand; the duties compose beside them.
Tier touched: **policy** — `templates/bundles/cleanroom/` duty text + the shipped-text pin.

## Category scope (0123 D1's discipline — reconstructed 2026-11-05 by 0166 step 003 from this ruling's D-blocks, landing commit f8835775f and its review-completion commit)

Family: *the cleanroom bundle's survey and spec-read duties — what enumerates capabilities, what a
spec entry records, and what the closing consolidation writes.* Home-set reconstructed from D1–D4
and the floors:

| home | disposition |
|---|---|
| `templates/bundles/cleanroom/phases/survey.md` (the enumeration duty against the closed observable surface; the capability-catalog duty with status semantics and the completeness criterion; the pair-diff and delta rules) | changed — D1/D2/D3 |
| `templates/bundles/cleanroom/phases/spec-read.md` (the evidence-kind provenance; property-first internal enablers) | changed — D4 |
| The 0085 decision discipline in the same survey (analysis-first, `Settled:` lines, the `Recommend:`-on-the-line fork bar) | held, untouched — the floors |
| The 0121 compliance gates (the wall, the divergence lanes, the audit dimensions) and the faithful postures' survey shapes | held, untouched — the floors; no shared pin moves |
| The phase-document grammar (`Phase-artifacts:` stays `survey.md` / `spec-notes.md` — the catalog a project document the duty names) | held, untouched — the floors |
| Test homes: `test/bundle.test.ts` (the 0153 pin — cleanroom-only, wrap-insensitive) | changed |

Tests: `test/bundle.test.ts` — the 0153 pin test (cleanroom-only, wrap-insensitive: the
anchor clause, the never-the-instrument clause, the catalog artifact with its status
semantics and completeness criterion, the pair-diff and recorded-baseline-change rules,
the spec-read evidence-kind and never-mechanism-narration clauses).

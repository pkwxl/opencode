# 0124 — the phase-document contract: one declared grammar, every teaching surface defers

The family 0120 touched piecemeal gets its one home, and the grammar that home needs already exists
and is consumed. Phase types declare their documents — `Phase-artifacts:` / `Task-artifacts:` headers
for custom and bundle types (parsed in `src/phases/custom.ts`, driver-owned names refused, the refusal
test-pinned), the registry's `phaseArtifacts`/`taskArtifacts` for builtins — and the formulation
synthesis seeds one obligation row per declared artifact (`protocolFrameText` / `seededLedgerRows`,
0097): a declared path is a judged row at wrap-up. What was missing on 0120's day is what this ruling
completes — the shipped family's declarations, and the copy surfaces deferring instead of teaching
parallel artifact lists of their own.

This ruling Derives: **P5** (single ownership — the showing: the declared grammar is the one home of
"the documents this phase and its tasks produce"; the packs' splitting criteria, the floor partial and
the handover surveys stop asserting parallel lists and defer), **P7** (grammars, never content — the
showing: a document's name and its writer are grammar; whether a findings document is any good stays
with acceptance judgment, untouched here), **P15** (policy is data — the showing: the declared sets
ride the phase-type files and the registry, materialized targets take them through sync/provenance,
renderers assemble), and **P13** (frozen additive-only vocabularies — the showing: the corrections are
a ruled defect fix in conscious lockstep — copy sites, goldens and ratchet pins in one change, 0120's
reservation phrase family reused verbatim in shape; the floor never masks a ruled defect, P10's
exemption clause). Tier touched: **mechanism and data** — templates, prompts copy, tests; no src
change.

## Category scope (0123 D1's discipline, first application)

Family: *the documents a phase and its tasks must produce, and the writer of each.* Home-set
enumerated at ruling time:

| home | disposition |
|---|---|
| `src/phases/registry.ts` (builtin declarations) | consistent; guarded — D4 |
| `src/phases/custom.ts` (the grammar; driver-owned names refused) | consistent, untouched (refusal pinned: `test/phases-custom.test.ts`) |
| `templates/bundles/cleanroom/phases/audit.md` | changed — D1 |
| `templates/bundles/cleanroom/phases/spec-read.md` | changed — D1 |
| `templates/bundles/{cleanroom,faithful,faithful-lean}/phases/survey.md` | consistent, untouched — survey tasks produce no per-task documents; the omitted field is the grammar's own "none" |
| `templates/bundles/{cleanroom,faithful,faithful-lean}/intents/*.md` (implement-phase item 4) | changed — D2 (three files) |
| `templates/intents/default.md` | consistent, untouched — its implement section teaches no artifact-report tie (measured) |
| `templates/prompts/_partials.md` (`## plan-duties-m`) | changed — D2 |
| `templates/prompts/phase-handover.md` | changed — D3 |
| `prompts/run-handover.md` | changed — D3 (joins 0120's three manual sites) |
| `prompts/run-plan.md`, `run-task.md`, `plan-append.md`, `run-verify.md` | consistent, untouched — 0120's reservation verbatim |
| `templates/prompts/wrapup.md` + `src/wrapup.ts` | consistent, untouched — report.md's owning writer |
| `src/document/roles.ts`, `src/docpaths.ts` | consistent, untouched — the role documents' definitions home |
| `src/formulate-synthesis.ts` | consistent, untouched — the declared sets' consumer; the new declarations feed it automatically |
| test homes: `test/phases-registry.test.ts` (changed, D4), `test/bundle.test.ts` (changed, D5), `test/manual-prompts-ratchet.test.ts` (changed, D5), `test/golden/phase-append.golden.md`, `test/golden/phase-handover.golden.md` (changed with their sources, D2/D3) | changed |

## D1 — the shipped family completes its declarations

`audit.md` gains `Task-artifacts: findings.md` — the duty prose has named it since 0120; the
declaration makes it a seeded obligation row ("each task the type's duties give this artifact
declares it in its own directory"), a row the wrap-up judges. `spec-read.md` gains `Task-artifacts:
notes.md` and its duty names the document (`notes.md`, one standalone behavior-only specification
notes document per task). The builtins already declare (measured, registry); survey declares none per
task — omission is the grammar's "none", no ceremony added.

## D2 — write-side teaching defers to the grammar

Four sites, one phrase family (0120's shape, reused): each shipped pack's implement-phase item 4 —
"each item declares the source files it changes plus its task report" → declares the source files and
the check, then "— a document deliverable carries its own name, and `docs/T-NNN/report.md` is never
one (the verification child's wrap-up report, reserved)"; the floor's `## plan-duties-m` partial —
"artifacts are the source-code changes plus the task reports under docs/T-NNN/" → "the source-code
changes and documents carrying their own names under docs/T-NNN/ — never docs/T-NNN/report.md, the
verification child's reserved wrap-up report". The goldens pinning the old bytes move with their
sources in this change (the ruled-defect exemption; a floor never masks one).

## D3 — read-side enumerations stop presenting report.md as an artifact example

The two handover surveys (`templates/prompts/phase-handover.md`, `prompts/run-handover.md`): "done.md
is the task content, plus artifacts such as report.md" → "plus the task's own artifacts and the
verification's report.md". The surveys still read the report — named as the verification's, no longer
listed among the task's artifacts.

## D4 — the builtin registry guarded

A `phases-registry.test.ts` pin: no builtin phase's `phaseArtifacts` or `taskArtifacts` names a
driver-owned file (the reserved lists' names, inline). No runtime parser for code-internal data (P21
— the registry is authored in src; the review is the guard, and the pin holds the line).

## D5 — the ratchet lockstep (P13)

`bundle.test.ts` pins the shipped family: `audit.md`'s `Task-artifacts: findings.md` and
`spec-read.md`'s `Task-artifacts: notes.md` with its named duty; each shipped pack's implement-phase
section carrying the reservation phrase and not "plus its task report".
`manual-prompts-ratchet.test.ts` extends 0120's test with the run-handover line. The goldens move
with D2/D3.

## D6 — deliberately not done

0120's three manual sites stand verbatim (their ratchet pins untouched). default.md's implement
section is measured consistent, no edit. Survey keeps no per-task declaration. No migration of
materialized targets — the pack and phase-file changes ride `sync`/provenance, 0120 D2's channel. No
runtime parser change (it already parses `Task-artifacts` and refuses driver-owned names). No new src.

## Enactment notes

- AGENTS.md's bundle navigation line gains the 0124 pointer; INDEX rows for 0123 and 0124 land in this
  change; `bun typecheck` clean and the full suite green; no commit (the person commits at command
  boundaries).

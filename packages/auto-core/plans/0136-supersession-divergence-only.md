# 0136 — the supersession note fires on divergence, not coverage: agreement is the designed state

The field incident (2026-10-27, the maintainer's report on the aster-mig cleanroom baseline — `status`
there printing, beside the config line's own `phases survey,spec-read,design,implement,test,audit`
segment, the 0114 D2 note `phases (config "survey,…"): superseded — R-01 establishes under the roadmap
of docs/analysis.md; …`): the config key and R-01's covering roadmap line held **the same list**, and
the note still fired — the maintainer's words: "when phases in config.json [is] the same [as]
analysis.md, such information might lead to confusion". 0135 had fixed the framing (the info class, the
green exits); this incident exposed the trigger: the note fired on **coverage alone**, so an agreement
printed "superseded" about two identical lists and `status` showed the same value twice.

The analysis: the note's two jobs are (a) to teach the reshape channel (the line, never the key) and
(b) to flag that someone reading config.json alone would be misled about the current round. Job (b) is
the load-bearing one, and it exists **only when the two homes disagree** — an agreeing pair is the
designed state (the line establishes exactly what init stamped; nothing differs, nothing misleads, and
`status`'s config-line segment is then simply the round's true list). Job (a) survives silence: the
teaching rides the act's own moments (`amend --phases`' refusal under coverage names the line channel;
the survey's awaiting-clarification stop names the line-move). The comparison is mechanical (P7):
`RoadmapRound.phases` and the config key share one grammar, and both values resolve through the same
registry establishment uses — so a letter preset (`mt`) and its type-id list (`implement,test`) spell
one value and never a false divergence; a line value that fails to resolve reads as divergent (P12 —
it is the person's word and establishment will judge it; the config side is strict-loaded before every
caller reaches the comparison).

This ruling Derives: **P8** (deliberate enforcement moments — the note's moment is "the two homes
disagree"; agreement is detection that records nothing, and the surfaced lines stop implying drift that
isn't there), **P13** (the copy and predicate change in conscious lockstep with the status, fix,
driver-helper and e2e pins in this one change; the note's class — info, 0135 — and the coverage
predicate's other consumers are untouched), and **P19** (the agreement case measured in the field: the
maintainer's own screenshot, the second field report on this note). Tier touched: **predicate + copy**
— one comparison helper in the roadmap's home, two consumer call sites, pins, documents; the info
class, the exit codes, the coverage-follows semantics and `amend --phases`' refusal are byte-identical.

## Category scope (0123 D1's discipline)

Family: *the supersession note's trigger and copy (0114 D2's note, 0135's info class — when it fires
and what it says).* Home-set enumerated at ruling time:

| home | disposition |
|---|---|
| `src/roadmap.ts` (`phasesDiverge` the resolved comparison, `supersedingPhases` the covering wrapper) | changed — the one home of the divergence predicate |
| `src/status.ts` (the ℹ line) | changed — divergence-only, both values named in the copy; the reshape-note branch keeps its own coverage read (`releasedRoadmapRound`), coverage and divergence being different questions |
| `src/config-fix.ts` (the info finding) | changed — the same predicate through `supersedingPhases`, the same both-values copy shape |
| The info class, the exit codes, `driver-helper` row 10's exclusion, the coverage-follows semantics, `amend --phases`' refusal, m mode's exclusion | held — byte-identical; 0135's ruling untouched |
| `test/config-fix.test.ts`, `test/tasks.test.ts` (renderStatus), `test/driver-helper.test.ts`, `packages/auto/test/e2e.test.ts` | changed — divergence fires (both values pinned), agreement and spelling-equivalence silent, the unresolvable-line case pinned conservative |
| `packages/auto/README.md` (the fix table's Info row, the transfer section's phrase), `docs/structure.md`, `AGENTS.md` | changed — the divergence wording |

## The ruling

**D1 — the predicate: coverage AND divergence.** The note (status's ℹ line, fix's info finding)
fires only when a released roadmap line covers the current round **and** its phases value resolves to
a different type-id sequence than the config key's. The comparison lives in `src/roadmap.ts`
(`phasesDiverge`), resolving both values through the registry establishment uses; status keeps its own
coverage read for the reshape-note branch (a covered round's teaching), coverage and divergence being
different questions asked by different lines.

**D2 — the copy names both values.** `phases (config "X"): R-NN's line establishes "Y" under the
(released) roadmap of docs/analysis.md` — the one case where both homes are visible at once is the
point: the person sees exactly which two lists disagree and which one wins. The bare "superseded" lead
word retires (the word read as drift classification); status's longer variant keeps the line-move
remedy and the anti-amend tail.

**D3 — agreement and spelling equivalence are silent.** An agreeing pair prints nothing anywhere
(`fix` fully green, exit 0; `status` shows only its config line, whose value is then simply the
round's list). A letter preset and its equivalent type-id list are one value — never a divergence, so
the note never false-fires on spelling.

**D4 — unresolvable reads as divergent.** A covering line whose phases value fails to resolve fires
the note (fail loud): it is the person's word and establishment will judge it at its own gate; the
comparison never swallows it into silence.

## Enactment

`src/roadmap.ts`, `src/status.ts`, `src/config-fix.ts`, the four test files re-pinned/extended,
`packages/auto/README.md`, `docs/structure.md`, `AGENTS.md`, this file, the INDEX row. Verification:
full typecheck clean; both suites green.

## The closing read

The incident's own shape through the re-built surfaces: the pin suite replays it exactly — a config of
`"mt"` under a released `- R-01 mt — port the core` line renders no note anywhere (the agreement case,
`fix` exiting 0 on a fully green plan), while `- R-01 mtv — port the core` records the one info line
with both values named. The person-facing answer to the incident: agreement is the designed state, and
the tool now says so by saying nothing.

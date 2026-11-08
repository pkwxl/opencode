# 0231 — the retired route words' permanent tombstones: one table, every parse surface, the teaching refusal

Status: active-authority (0166 remediation step 071, wave W-vocab; finding 0165-134 =
S17-08 (S3, CONFIRMED, UX — retired route words fail strict validation as unknown
words, never as tombstones: a v0.3.0-valid `routes.number-recovery` (0150 D2) or
`understand` (0030 D12) reads "is not a role word (…)" — like a typo — and, in the
operator layer, stops every project's run on the machine; the remedy 0150 names
("removing the route entry") is never said).

One family — **the frozen model-route/role vocabulary and its retirement discipline**
(P13's own fence): the words a model policy key may take (role words, phase type ids,
preset letters), every parse surface that reads them, and what meets the person when a
**retired** word appears there. 0225 D3's two-track rule is the standing authority this
enacts: a vocabulary's tombstone IS its retirement — a permanent parse-time teaching
refusal naming the retirement and the remedy, never a silently ignored word, never an
unknown-word shrug. 0165 is the evidence, not the authorization.

## The measured ground (what each surface does today)

The ten retired words, each with the ruling that retired it:

| word | retired by | teaching tail |
| --- | --- | --- |
| `understand` | 0030 D12 (M1.0) | the understand session merged into decompose |
| `verify-generate`, `verify-exec`, `verify-judge`, `verify-fix` | 0044 D1 (M2.2) | the verify mechanism was removed |
| `review-audit`, `review-planfix`, `review-fixrun` | 0044 D1 (M2.2) | the review mechanism was removed |
| `final-plan` | 0044 D1 (M2.2) | the final-review loop was removed; the v (acceptance) phase plans its tasks |
| `number-recovery` | 0150 D2 | the numbering recovery session was removed; task numbers are derived from the surviving artifacts |

Three parse surfaces (enumerated from the code, 0123's family-first discipline):

1. **The registry `routes` validator** (`src/models.ts` `Validator.routes`): a retired
   key falls into the generic unknown-word refusal — "is not a role word (…), a phase
   type id (…) or a preset letter (…)" — indistinguishable from a typo, teaching
   nothing about the retirement or the remedy. The finding's primary surface.
2. **The `OPENCODE_AUTO_MODEL` entry-list parse** (`src/switches.ts`
   `parseModelPolicy`): `RETIRED_MODEL_ROLES` (introduced M3.6, `84ab43869`) holds
   **five of 0044's eight words** (`verify-judge`, `verify-fix`, `review-audit`,
   `review-fixrun`, `final-plan`) — those five are excluded from the phase-type-key
   branch and fail the generic invalid-key line; the **five missing words**
   (`understand`, `verify-generate`, `verify-exec`, `review-planfix`,
   `number-recovery`) match the type-id shape and are **silently parsed into
   `byType`**, failing only later at run preflight with "names no phase type" — the
   retired word re-entering the live vocabulary through the type-id door, refused
   under a message that names nothing of the retirement (P12's silent-then-misleading
   shape; the M3.6 table's own comment — "still a strict parse failure, not read as
   phase type ids" — was never true for those five).
3. **The custom phase-type collision guard** (`src/switches.ts`
   `phaseTypeRoleProblems`): a project phase type named after a live-or-retired role
   word is refused — but over the same incomplete five-word table, so a project CAN
   today declare a custom type named `understand` or `number-recovery`, resurrecting
   a tombstoned id into the routing grammar (P13's "a tombstoned id never returns
   with a new meaning").

Beside them, the person-facing surfaces: the CLI README's routes passage teaches the
key grammar without the tombstone; its retirement paragraph names only 0044's words
("error the same way"); and its default-tier prose still lists **"numbering
recovery"** among the live simple roles — stale since 0150 D2 (0227 D1's docs-truth
rule: every surface naming the code owes the code's current truth).

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P13** (frozen additive-only vocabularies): the route/role vocabulary is exactly
  the principle's subject — a driver-parsed grammar word set. Its chosen default now
  reads "retire through tombstones — a vocabulary's tombstone is its permanent
  teaching refusal (0225's two-track rule)". A retired word refused as an unknown
  word, or worse parsed as a fresh type id, is neither: the retirement left no
  tombstone at two of the three surfaces and half of one at the third. The same
  principle's id-discipline line ("a tombstoned id never returns with a new meaning")
  is what the custom-type collision guard owes — the incomplete table made
  `understand` a legal phase-type id again. Ids stay never-reused: the tombstone
  entries are permanent, and no live vocabulary grows a retired word back.
- **P8** (every surfaced line teaches its remedy): the refusal is the one moment this
  vocabulary ever surfaces — 0150 D2 already named the remedy ("the remedy is
  removing the route entry") and the current line never says it. The tombstone line
  teaches three things in one breath: the word is retired (not misspelled), the
  ruling that retired it, and the act (remove the entry). 0225 D3's own letter:
  detection at the surface, the refusal itself teaches on every use — no warning
  release needed.
- **P5** (single ownership): one tombstone table, one owner — beside `MODEL_ROLES` in
  `src/switches.ts`, the vocabulary's declared home (models.ts already imports the
  live words from there); every surface composes its refusal from the one table. The
  prose retirement narration in the `MODEL_ROLES` comment yields to a pointer at the
  table (the table the one machine-readable home).
- **P12** (fail loud): the five words silently parsed as phase-type keys are the
  principle's worst shape — a strict vocabulary that quietly re-reads a retired word
  as a fresh type id, then refuses it elsewhere under an unrelated message. The
  tombstone refuses at the surface where the word appears, at parse time.
- **P10** (the byte-identical floor): nothing changes for any live word or any
  genuine unknown: the generic unknown-word refusal (registry routes), the generic
  invalid-key line (env entry list) and the live-word collision message (custom
  types) keep their exact bytes; only the retired words' own path changes — the ruled
  defect fix, never masked by the floor.
- **P19** (measured evidence): the ten words and their rulings are the measured set —
  every word that ever left `MODEL_ROLES`, verified against the table's git history
  (M1.0's merged session, M2.2's parent `779a8f9da~1` holding the eight, 0150's
  lockstep). No speculative entries; a future retirement joins the table in its own
  lockstep change.

## Decisions

### D1 — `RETIRED_MODEL_ROLES` becomes the complete, exported tombstone table

The table (still in `src/switches.ts`, beside `MODEL_ROLES`) grows to all ten retired
words, each entry mapping the word to its ruling citation and teaching tail
(the table above). It is exported (models.ts consumes it); its type is
`Readonly<Record<string, string>>` — policy as data, never code-authored copy at the
refusal sites (each site composes the same entry into its own grammar's line shape).
Its contract comment states the law: entries are never removed, words are never
reused, every retirement lands its row in the same lockstep change (the standing
convention RETIRED_SWITCHES already carries). The `MODEL_ROLES` comment's prose
retirement narration is replaced by the pointer at the table — the narration was the
family's only "table" for the five words M3.6 missed, and prose is not a parse-time
refusal.

### D2 — the registry routes tombstone (`src/models.ts` `Validator.routes`)

A route key found in the table fails before the vocabulary check, with:

`is a retired role word (<citation — tail>); remove the route entry`

e.g. `routes.number-recovery: is a retired role word (plans/0150 D2 — the numbering
recovery session was removed; task numbers are derived from the surviving artifacts);
remove the route entry` — 0150 D2's own remedy sentence, at last on the line. The
generic unknown-word refusal for non-retired keys keeps its exact bytes (P10); the
`*` refusal keeps its place.

### D3 — the env entry-list tombstone and the type-id door closed (`src/switches.ts`)

In `parseModelPolicy`, a key found in the table — checked after the live
`MODEL_ROLES` branch and before the type-id branch — throws:

`env OPENCODE_AUTO_MODEL invalid key: "<word>" (a retired role word, <citation —
tail>; remove the entry)`

The five words that previously slipped into `byType` now fail at the surface where
they appear (parse time, exit 1 — the same code, earlier and honest); the five that
already failed the generic line now fail the tombstone line. The redundant
`!RETIRED_MODEL_ROLES.includes(key)` guard on the type-id branch is removed — dead
code once the tombstone branch precedes it. In `phaseTypeRoleProblems`, a retired
word is refused with its own line — `phase type "<word>" is a retired model-routing
role word (<citation — tail>); rename .opencode/auto/phases/<word>.md` — closing the
resurrection door (P13's never-reuse); the live-word message keeps its exact bytes.

### D4 — the person-facing and registry homes

- **The CLI README** (packages/auto/README.md): the default-tier prose drops the
  stale "numbering recovery" from the live simple roles (0227 D1's rule, the
  finding's family's own drift); the routes passage gains the tombstone sentence
  (a retired role word is refused naming the ruling that retired it and the remedy —
  remove the entry); the completion-side retirement paragraph names all three
  generations and the tombstone shape (it currently teaches only 0044's words "error
  the same way"); the custom-phase-type collision rule reads "a model-routing role
  word (live or retired)".
- **The protocol-string registry** (plans/0035): gains the amendment row the
  finding's remedy names — the retired route words registered as a permanent
  tombstone face (0035 D3's own scope: literals a driver parser matches; the
  tombstones match, to refuse), the table in `src/switches.ts` the home, the refusal
  shapes D2/D3 ruled, ids never reused.
- **AGENTS.md** (auto-core): the Model registry navigation line's plans list gains
  0231 — a new mechanism (the tombstone table and its three-surface refusal) landed
  in that line's homes; no new navigation line (no module moves).

## Derivation and Category scope

Derives: **P13** (the showing: RETIRED_MODEL_ROLES completed to the measured ten
words and exported as the one tombstone table; the refusal at every parse surface;
the custom-type resurrection door closed — the principle's chosen default enacted
onto this vocabulary, 0225 D3's rule consumed as ruled), **P8** (the showing: every
refusal line names the retirement, the ruling and the remedy — 0150 D2's "remove the
route entry" sentence reaching the surface that owes it; the README's four teaching
passages), **P5** (the showing: one table beside MODEL_ROLES, every surface composes
from it; the prose narration retired to a pointer), **P12** (the showing: the five
silently-type-parsed words now fail loudly at parse, under a line that names the
actual cause), **P10** (the showing: the generic refusals and the live-word messages
keep their exact bytes — only the retired words' path changes), **P19** (the
showing: the ten-word set measured from MODEL_ROLES' own git history, no speculative
entries, each citation the ruling that retired the word).

Amends: none. 0030 D12, 0044 D1 and 0150 D2 are re-read and stand: each ruled the
word leaves `MODEL_ROLES` and fails strictly — that operational content is untouched;
the refusal's wording was never pinned by them, and its refinement (the tombstone
line) is 0225 D3's later rule enacted here, exactly that ruling's own division of
labor.

Tier: code (src behavior — the table, the three surfaces' refusal paths; plus the
person-facing docs and the registry row in lockstep).

premises this ruling changes: none. Re-read in the same change: 0030 D12, 0044 D1,
0150 D2 (the retirements themselves — standing, the failure shape refined per 0225
D3), M3.6's `RETIRED_MODEL_ROLES` premise (`84ab43869`'s "still a strict parse
failure, not read as phase type ids" — never true for the five missing words; the
table completed, the premise now true as written), 0225 D3 (the consuming rule —
enacted, not amended), 0229 D1/D2 (the README switch census — the edits stay outside
the pinned switch section and add no `OPENCODE_AUTO_*` token; the census re-run
green), 0035 D3 (the registry scope — the tombstones are parser-matched literals,
registered by the new row), 0227 D1 (the README truth rule — the stale "numbering
recovery" repaired under it).

### Category scope (0123 D1's discipline)

Family: *the frozen model-route/role vocabulary — its parse surfaces (registry
routes, the OPENCODE_AUTO_MODEL entry list, the phase-type collision guard), its
tombstone table, the tests that pin it, and the person-facing surfaces that teach
it*.

| home | disposition |
| --- | --- |
| `src/switches.ts` | changed — D1 (the complete exported table, its contract comment, the MODEL_ROLES comment's pointer), D3 (the parse-time tombstone branch, the dead guard removed, phaseTypeRoleProblems' retired line) |
| `src/models.ts` | changed — D2 (Validator.routes' tombstone refusal ahead of the vocabulary check; the import) |
| `test/switches.test.ts` | changed — D3 (the retired-words pin rewritten to the ten words and the tombstone shape; the byType-slip regression — the five words throw at parse; the generic-key floor pins stand) |
| `test/models.test.ts` | changed — D2 (the registry-routes tombstone pin — all ten words, the exact lines; the generic-refusal floor pin stands) |
| `test/phases-custom.test.ts` | changed — D3 (the collision guard's retired-word line; the live-word message pin) |
| `packages/auto/README.md` | changed — D4 (the stale "numbering recovery" dropped; the routes passage's tombstone sentence; the retirement paragraph's three generations; "live or retired") |
| `plans/0035-protocol-string-registry.md` | changed — D4 (the amendment row registering the tombstone face) |
| `AGENTS.md` (auto-core) | changed — D4 (0231 joins the Model registry navigation line's plans list) |
| `plans/INDEX.md` | changed — the 0231 row |
| `packages/auto/test/docs-truth.test.ts` | held — the census pins the switch section and the registry render; the README edits stay outside both (re-run green) |
| `src/tier.ts`, `src/roles/registry.ts`, `src/models-describe.ts`, `src/model-route.ts` | held — they iterate the live `MODEL_ROLES` only; no retired word reaches them |
| `docs/structure.md`, `docs/principles.md`, `docs/releases.md` | held — no module mapping moves, no principle text changes (0225 D3 already carries the rule), the amendment register is for constitution edits |
| `test/lanes.ts` | held — the new tests live in the three already-registered files |

## Residuals

- The tombstone teaches the citation and the remedy; it does not name the live
  vocabulary (the generic line already does, one breath away in the same failure
  report — a registry can carry both a retired and an unknown key and the person
  reads both lines). Pinned as the shape by the tests.
- `switches.ts`'s `OPENCODE_AUTO_FORK`/`FORK_BASE` comments and the README's two
  switch-table rows still narrate "the understand session" (0030-era pipeline
  wording, a switch-comment/docs question in 0229 D1's census family, not the route
  vocabulary — the census renders those descriptions from the registry's own
  comments, so README and source agree with each other); recorded for the WA-docs
  family, out of this step's scope.
- `src/artifact.ts`'s `spec.unitStart` comment still lists "numbering recovery"
  among the hidden-unit examples (a mechanism-comment staleness of 0227's class, not
  route vocabulary); recorded, same disposition.

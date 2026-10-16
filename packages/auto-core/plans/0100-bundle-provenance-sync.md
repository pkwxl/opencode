# 0100 — Bundle provenance, the sync command, and charter key ids

Two changes, one incident. On 2026-10-15 the spi-nor-glm project
(`/home/wxl/workspace/root/spi-nor-glm`, initialized 10-07 with
`--intent faithful-lean`) ran its R-01.P05 formulation — the round's most
consequential planning session — on a materialized pack that predated 0097
stage A by two days: the `### verify-plan-t` charter section (added to the
shipped bundles 10-15 13:35) was absent, the phase planned without it, and
**no gate could have said so** — materialization records nothing about
itself (0079's "no drift copy" left no provenance either), so staleness of a
committed, semantic, never-resynced surface is invisible to preflight,
`fix`, `status` and every other check. The same diagnosis exposed a naming
defect in the very feature that was silently missing: the per-phase charter
family is keyed by preset letters for builtins (`verify-plan-t`) but by type
ids for customs (`verify-plan-survey` is the valid spelling today, because
`survey` is a bundle-declared custom type), so `verify-plan-test` is a
strict preflight usage error while `test` is the durable id everywhere else
(`--phases`, `P05-test/`, the registry) — a direct violation of 0079 §5's
"letters stay human shorthand, ids stay the durable protocol" in a protocol
position.

- **Provenance stamps.** Init's bundle materialization writes a committed
  sidecar recording, per materialized file, the digest of the bytes written
  and the file's heading lines. Any later tool — preflight, `fix`, `status`,
  `sync` — can then compute the three-state truth: current, stale
  (fast-forwardable), or person-edited (authoritative, never touched).
- **`sync`, the person's upgrade command.** Plan-then-apply on the
  `fix`/`install-prompts` pattern: unedited files fast-forward byte-identically
  to the running binary's bundle; edited files are reported with a headings
  delta and never written; extras are reported, never deleted. Detection is
  everywhere; propagation is one explicit, confirmed command — never silent,
  never automatic.
- **Charter keys canonicalized to ids.** `verify-plan-<type id>` is the
  canonical form (`verify-plan-test`); preset letters remain accepted legacy
  spellings in resolution; both spellings declared for one type is a strict
  usage error. The three shipped bundles switch to the id form now — the
  feature is one day old, so the compat surface is the bundle templates
  themselves and nothing else worth counting.
- **The layering alternative is rejected and recorded** (D6): runtime
  composition (binary bundle as base, project pack as overlay) would
  auto-propagate but makes governance text float with whichever binary passes
  through. The committed record must keep explaining the rules each phase ran
  under.

## Decisions

### Part 1 — provenance and sync

**D1 — the stamp.** `materializeIntentBundle` (src/bundle.ts) writes
`.opencode/auto/provenance.json` beside the files it materializes: the bundle
name, a bundle-level digest, and per repository-relative file — exactly the
set `materializeIntentBundle` wrote: `intents/<name>.md`, `modes/<name>.md`,
`phases/<type>.md` — the sha256 of the bytes written plus the file's heading
lines (`^##\s` / `^###\s`, in order). The sidecar is committed state in
init's home: it travels with the repo, so a second checkout on a machine
running a different binary detects the same gap (a `.auto/` home would be
local-only and is rejected for exactly that reason). Headings are the cheap
human-readable delta — every message below says "your pack lacks
`verify-plan-test`", never "digest mismatch". The stamp manages exactly the
files it records: a hand-written pack with no stamp is person-owned by
construction and produces no findings.

**D2 — the comparison is pure and three-state, both directions named.** New
`src/provenance.ts`: given the stamp, the files on disk, and the bundle the
running shell resolves by name (the builtin table or a registered bundle —
`resolveIntentBundle`, never git), each file resolves to exactly one of:
*current* (file bytes = stamp, binary bundle = stamp), *stale* (file bytes =
stamp, binary differs — fast-forwardable), *person-edited* (file bytes ≠
stamp — authoritative, never written). The stamp-vs-binary comparison is
symmetric and the *binary-older* direction (project materialized from a
newer bundle) is named too — it silently disables features just as
effectively. Nothing in this module writes, spawns, or reads env.

**D3 — detection sites, none of them gates.** The preflight intent line
(src/loop-preflight.ts:362, `ℹ intent pack …`) gains the provenance clause:
one line naming the direction and the headings delta when any managed file
is stale or the binary is older. `fix` (src/config-fix.ts `planFix`) gains a
**manual** finding per stale or edited managed file — report-only, naming
the delta and the `sync` command; a charter change is not
meaning-preserving, so it stays out of the fixable class by the rule table's
own contract. `status` (src/status.ts) gains a row in the same shape. A stale
pack still loads and still runs: staleness is a visibility problem, not a
validity problem, and no run is blocked or exits nonzero because of it.

**D4 — the `sync` command.** Core exports plan/apply/format from a new
`src/sync.ts` on the `src/config-fix.ts` shape; the shell adds the `sync`
command (a directory argument, `-f/--force` and `--dryrun`, the `fix` UX;
flag discipline beside the `reset`/`fix` block). Semantics: unedited managed
files fast-forward byte-identically to the running binary's bundle and the
stamp rewrites with the new digests; person-edited files are reported with
the headings delta and never written; extras (files under the materialized
homes that the bundle set does not name — e.g. a person-added
`phases/<type>.md`) are reported, never deleted (the 0093 extras rule).
`sync` refuses while a run lock is live (`liveRunLock`, exit 1 naming the
holder — the config-command family rule) and warns — proceeds, never
refuses — when any phase index holds unticked lines: a round in flight means
later phases would plan under changed charters, which is the person's call
to make at a boundary, not the tool's to forbid. `sync` never touches
`config.json` (materialization writes files only; config stamps are init's,
0079 §3).

**D5 — bootstrap for unstamped legacy projects.** No stamp: for each file
the running bundle would write, byte-identical → adopt (write the stamp,
report "adopted"); differing → report-only with the headings delta.
`--from-bundle` opts into overwriting the differing ones (behind the same
confirmation gate; the flag is the person's assertion that the pack is
pristine-but-old). Unstamped differing files are never written without the
flag — spi-nor-glm's pack is exactly this case today, and its report will
read "pack lacks `verify-plan-test`" (after Part 2) rather than a raw digest
complaint.

**D6 — the layering alternative, rejected.** Runtime composition — read the
binary's built-in bundle as base, overlay the project pack section-by-section
— would propagate additive sections automatically while preserving person
edits per-section. Rejected on the audit model: this ecosystem's records
(receipts, registers, ledgers, phase documents citing pack sections) assume
governance text is pinned in the repo; layering makes charters float with
whichever binary passes through, and the committed record stops explaining
the rules each phase ran under. Embedded prompt templates float because they
were never committed project state; pack files are. 0079's no-drift-copy
decision stands; this plan buys visibility and an upgrade path instead.

**D7 — scope fence.** Only the bundle-materialized homes are managed. The
agent contract, `AGENTS.md` block, `.gitignore` and `opencode.json` stay
`fix`'s (meaning-preserving renders of config); `prompts/` stays
install-prompts' (0093, already byte-identical-resync with extras reported);
`config.json` evolution stays defaults/retirement/`fix`. No kill switch: the
detection sites are log lines and findings, and `sync` runs only when a
person types it.

### Part 2 — the charter key ids

**D8 — canonical key = the phase type id.** `### verify-plan-test`,
`### verify-plan-survey`, `### verify-plan-spec-read` — uniform with
`P<nn>-<type>`, `--phases` and the registry, and self-explanatory in the
strict preflight errors that quote them. The family is already mixed today
(customs key by id, builtins by letter); this decision finishes the
migration the custom types started.

**D9 — resolution accepts letters as legacy spellings, scoped.**
`resolvedVerifyPlan` (src/intent/guarantees.ts) resolves id-first,
letter-fallback — and only for builtins with a preset letter; custom types
resolve their id alone, as today. The signature threads the resolved
`PhaseTypeEntry` instead of the bare phaseTag (the callers already hold it:
`Opts.phase` is the `PhaseKey { id, entry }`), and the five call sites move
with it — `src/loop-plan.ts:346`, `src/formulate.ts:169`,
`src/formulate-synthesis.ts:340` and `:349`, `src/prompt-verify.ts:85`. No
global alias table: a phase instance's entry is known at every call site, so
at most two candidate keys exist and both derive from that entry.

**D10 — the grammar rule.** `guaranteesProblem`'s known-suffix list becomes
the builtin type ids (derived from `BUILTIN_PHASE_TYPES`, not a new literal)
∪ the preset letters (`PHASE_LETTERS`) ∪ the declared custom ids. A pack
declaring **both** spellings for one builtin type is a strict usage error
naming the duplication — never silent precedence. The error message steers
to the canonical form: "the suffix is the phase type id (`test`); preset
letters are accepted legacy spellings".

**D11 — the consumed key stays named.** `ResolvedVerifyPlan.phaseKey`
records the key the charter actually came from, and `verifyPlanCharterText`'s
lead-in keeps quoting it — audit lines and the composer's rendering show
which spelling was in force, so a legacy-letter pack is visible as one.

**D12 — the shipped bundles switch now.** `### verify-plan-t` →
`### verify-plan-test` in cleanroom, faithful and faithful-lean (the
template files, their prompt/golden tests, and any fixture quoting the old
key). The feature landed 10-15 13:35; the deployment surface of the letter
form is the three bundle templates plus projects initialized with a same-day
binary — renaming before any stamp exists means no stamp ever records a
letter key as canonical, and once sync ships, the renamed section
fast-forwards to legacy projects' unedited packs: the charter fix and the
naming fix travel together.

**D13 — the collision guard.** A custom phase type whose id equals a preset
letter (`phases/t.md`) is ambiguous against `--phases` letter expansion and
against the fallback resolution; `loadPhaseTypes` (src/phases/custom.ts)
rejects it as a strict usage error naming the letter table. Add the check if
it is absent today; pin it with a test either way.

**D14 — the frozen vocabularies, recorded.** The assert-qualifier family
(`phase-plan(a)`, `phase-plan(m)`, `phase-plan(v)`, …) and the builtin
`dutiesRef` letters stay letters: both are deployed verbatim inside every
materialized pack of every faithful/cleanroom project and parsed by live
machinery; unifying them churns every shipped pack and every legacy diff for
zero behavioral gain. Out of scope here, deliberately; if ever worth doing,
`sync` is the vehicle — the same way D12 rides it.

## Stages

- **Stage A — the key canonicalization** (first, so nothing downstream
  stamps a letter key as canonical): D8–D14 — `resolvedVerifyPlan` and
  `guaranteesProblem` over the entry-derived candidates, the both-spellings
  error, the collision guard in `loadPhaseTypes`, the three bundle renames,
  the five call sites, the affected prompt goldens regenerated, and the
  AGENTS.md 0097 navigation line amended (one clause: ids canonical, letters
  legacy). Tests: the guarantees suite (id resolution, letter fallback,
  both-declared error, the survey-form custom id, the steering message), the
  preflight usage-error cases, and a ratchet that no shipped bundle declares
  a letter-keyed charter (grep `verify-plan-[admtvk]$` over
  `templates/bundles/` → zero).
- **Stage B — the stamp**: D1–D2 — the sidecar type and writer in
  `src/bundle.ts` (init's materialization call site writes it; re-running
  init rewrites it), the digest/headings helpers, and the pure three-state
  comparison in `src/provenance.ts`. Tests over fixtures: materialize →
  stamp → mutate the fixture bundle → stale with the named delta; touch the
  file → person-edited; older binary fixture → the direction named.
- **Stage C — detection**: D3 — the preflight clause on the intent line, the
  `fix` manual finding (asserting report-only: the write list stays empty),
  the `status` row. Tests for each site, including that a stale pack neither
  blocks nor exits nonzero anywhere.
- **Stage D — `sync`**: D4–D5 — `src/sync.ts` (plan/apply/format) and the
  shell command row with its flag refusal set, the live-lock refusal, the
  open-round warning, bootstrap adoption and `--from-bundle`. Tests: the
  never-overwrite-edited invariant, extras never deleted, fast-forward
  updates the stamp, lock refusal, and the unstamped adopt/report split.
- **Stage E — close**: the AGENTS.md navigation line for this plan beside
  the 0079 formulation-synthesis line, the `docs/structure.md` rows
  (`src/provenance.ts`, `src/sync.ts`), full `bun test` and `bun typecheck`
  clean.

## The legacy walkthrough (spi-nor-glm, after this lands)

The project's pack is unstamped and differs from the current bundle by
exactly the charter family: `fix` reports the manual finding naming
`verify-plan-test`; `sync --dryrun` shows adopt-vs-report per file (the pack
differing → report with the delta; the phase/mode files likely
byte-identical → adopt); the person either runs `sync --from-bundle` or
ports the section surgically, at a round boundary of their choosing. The
next test-phase formulation (R-02's P05) then renders the charter this round's
P05 never saw — and if it ever drifts again, the preflight line says so on
every run.

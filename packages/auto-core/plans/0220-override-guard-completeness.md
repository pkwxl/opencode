# 0220 — the override guard's completeness and the assert target's vocabulary

Status: active-authority (0166 remediation step 060, wave WE-policy; findings 0165-044 = S23-01
(S2, CONFIRMED), 0165-045 = S23-02 (S2, CONFIRMED), 0165-046 = S23-03 (S2, CONFIRMED) — all three
by the S23 record's deterministic traces, each reproduced by the record's probe suite).

Three defects of one family — the surfaces that keep a target directory's person-owned policy
(config overlays, intent packs) from silently dropping the driver↔session contract — ruled in one
pass:

- **The decomposition override guard omits the Artifacts protocol it claims to protect**
  (0165-044): every one of the seven `decompose*` marker sets guards only `- [ ]`, `context.md`
  and `todo.md`, while the templates also teach the driver-parsed `Artifacts:` token (the
  `declaredArtifacts` parser, spec.ts) and the scope file's `## Scope` / `## Artifacts` headings
  (`SUBTASK_TODO_SECTIONS`, the shape checker's anchors). An overlay accepted as tier-1-complete
  teaches no artifact declaration: a following decomposition's checklist parses to zero
  declared-output specs and every per-subtask existence/shape check silently stops running. The
  existing override test blesses exactly such an incomplete overlay as protocol-complete.
- **The handover and split protocols of the execution family are removable by overlays that pass
  the tier-1 guard** (0165-045): `whole` and `subtask` have no marker entries at all, `fix`
  guards only `{{taskBlock}}`/`{{gapsFile}}`, `handoff-steer` and `fanout` guard the status
  values but not `{{handoffFile}}`. Their templates carry `Status: continue`/`Status: done` (the
  strings `handoffStatus` parses), `whole` additionally `Status: park` and the adaptive split's
  `Depends:`/`Artifacts:` grammar. An overlay loading cleanly but teaching no handover grammar
  sends a due session to the handover wall with no protocol: `handoverVerdict` reads no valid
  status, retries once, then blocks — on work whose prompt never carried the required line.
- **A guarantee assertion naming an unknown template or phase passes preflight and is silently
  inert** (0165-046): `guaranteesProblem` parses the assert grammar and validates the
  `verify-plan-*` key family, but never checks `assert.template` or `assert.phase` against a
  known vocabulary; `guaranteeViolation` filters by exact equality, so `whloe:` (a one-character
  typo) matches no render and returns undefined forever — the machine check the project declared
  is disabled while every visible preflight and render stays green, which is exactly the drift
  0080's gate exists to catch.

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P7** — the driver judges grammars it defines. The marker table and the assert vocabulary are
  exactly that: mechanical grammars (protocol literals, template names, phase tags), never
  content judgments. Completing them is the principle's own maintenance, not a new power: the
  guard still checks only presence of literals it can name.
- **P15** — the two-tier marker discipline (0033 D4): tier-1 driver-enforced anchors stay core
  and guarded; tier-2 intent content stays marker-free. Every literal added here is tier-1 by
  0033's own criterion — a string the driver itself parses out of session output or a template
  slot whose loss silently breaks the driver↔session contract (`Artifacts:` → `declaredArtifacts`,
  `## Scope`/`## Artifacts` → `SUBTASK_TODO_SECTIONS`, the `Status:` values → `handoffStatus`,
  `Depends:`/`Artifacts:` → the split's checklist parser, `{{handoffFile}}`/`{{subtasksFile}}` →
  the paths the steer and split point the session at, `{{remaining}}` → the winddown steer's
  figure slot). Nothing tier-2 (quality bars, duties) is guarded — the split stands.
- **P13** — frozen vocabularies grow additively and in conscious lockstep. The marker additions
  are guard data over already-frozen protocol strings (no session-visible vocabulary changes; the
  refusal message text is untouched), and the lockstep owed is internal: the fixtures that
  blessed incomplete overlays are repaired in this same change, the decompose sets are pinned to
  their parser-side source (`SUBTASK_TODO_SECTIONS` + the `Artifacts:` token) by a new ratchet so
  the hand-maintained three-way correspondence cannot drift silently again, and the assert
  vocabulary's two new refusal messages name the available values (the same shape the
  `verify-plan-*` family's message already carries).
- **P12** — fail loud, conservative under uncertainty. The inert assertion is the principle's
  exact anti-shape: a silent green over a contract that does not exist. The preflight rejection
  resolves the uncertain reading (a typo? a retired name?) toward the loud failure with the
  remedy in the message.
- **P8** — deliberate enforcement moments: the marker guard fires at load time (the overlay's
  own moment, unchanged since 0033), the assert vocabulary at preflight (the guarantees
  contract's existing moment, 0080 §2 — no new moment is created).
- **P10** — the byte-identical floor: a project with no overlays and no `### asserts` section is
  untouched (the default pack declares no asserts; the marker check only ever sees an overlay
  file). The known-breakage class is 0033 D6's own: an existing overlay that already dropped a
  now-guarded anchor was silently defective — it now fails at load with the remedy line, the
  acceptance 0033 D4/D6 already ruled on for the same guard.

## Decisions

### D1 (0165-044) — the decompose family's marker sets completed, pinned to the parser's own grammar

All seven `decompose*` entries in `PROTOCOL_MARKERS` gain `"Artifacts:"`, `"## Scope"` and
`"## Artifacts"` beside the existing `- [ ]` / `context.md` / `todo.md`:

- `Artifacts:` is the token `declaredArtifacts` (src/document/spec.ts) parses a checklist item's
  declaration from — its loss is zero specs, which is zero per-subtask existence/shape checks
  (the finding's impact, and 0035 D2's own warning that dropping the token must not be silent).
  The guard's literal is the exact canonical spelling; the parser's case-insensitive leniency is
  the parser's own, unchanged.
- `## Scope` / `## Artifacts` are `SUBTASK_TODO_SECTIONS` verbatim — the headings the scope-file
  shape check requires of every `S<nn>/todo.md` the decomposition writes (spec.ts:152,170). An
  override teaching other headings produces scope files that fail the shape check at every
  subtask close-out.

The three-way parser/template/marker correspondence is the S23 record's own named weakness ("it
has already drifted, and one test blesses an incomplete decomposition override"). The lockstep is
made mechanical: a new ratchet pin in test/template.test.ts asserts every `decompose*` marker set
contains exactly `- [ ]`, `context.md`, `todo.md`, `Artifacts:` and both `SUBTASK_TODO_SECTIONS`
entries (imported from the parser side, the single source — P5), so a future grammar change that
touches either side goes red until the marker table follows. The permissive fixture
(test/prompt-exec.test.ts, "keeping the protocol: - [ ] items, artifacts context.md and each
todo.md") — the test that blessed the defect — is replaced by one keeping the real grammar, and
its acceptance is asserted on the rendered prompt (through `decOf`, the render exit), not only on
raw source substring presence. One rejection case is added per newly-guarded anchor family
(the `Artifacts:` token; the scope-file headings).

### D2 (0165-045) — the execution family's handover and split protocols guarded

`PROTOCOL_MARKERS` gains the entries and anchors the finding's inventory names (the parser
counterpart of every literal is named above, under P15):

- `whole`: `"Status: park"`, `"Status: continue"`, `"Status: done"`, `"{{handoffFile}}"`,
  `"{{subtasksFile}}"`, `"Depends:"`, `"Artifacts:"` — the three status values `handoffStatus`
  parses (park is whole's alone: the dependency-park directive), the handover path the steer and
  the park clause point at, the split file, and the adaptive split's two protocol fields
  (`Depends:` ordering, `Artifacts:` declarations — both driver-parsed from `subtasks.md` lines).
  An override may re-voice all of it; it may no longer silently drop the channels.
- `subtask`: `"Status: continue"`, `"Status: done"`, `"{{handoffFile}}"` — the budget handover
  protocol of its close-out block.
- `fix`: the existing `{{taskBlock}}`/`{{gapsFile}}` plus `"Status: continue"`,
  `"Status: done"`, `"{{handoffFile}}"` — the fix round's own budget handover.
- `fanout`: the existing `{{subtask}}`/status pair plus `"{{handoffFile}}"` — a stream lane
  hitting its wall is steered to the same protocol; the path is the steer's whole target.
- `handoff-steer`: the existing status pair plus `"{{handoffFile}}"` — the wall notice's one
  write target; an override keeping the statuses but dropping the path teaches a handover with
  nowhere to land.
- `usage-note-winddown` (the finding's family note, same defect class in the same table):
  `"{{remaining}}"` joins its existing figures — a winddown notice without the remaining figure
  steers at no information. (`usage-note-info` carries no `{{remaining}}` slot; `test-wrapup`
  stays out — `fillHandoffStatus` backfills its missing status, the S23 record's refuted probe.)

Two existing fixtures that bless protocol-free `subtask.md` overlays (test/template.test.ts's
override-acceptance and terminator-dropping cases) are repaired in the same lockstep to keep the
protocol; the accepted-arm assertions render the enabled branch (`budget` on) so the status
grammar appears in the rendered prompt, per the finding's remedy clause. No shell package, no
bundle and no golden touches an overlay of these templates (grepped before the change); the
refusal message text is unchanged — the vocabulary growth is the guard's own data.

### D3 (0165-046) — the assert target's vocabulary validated at preflight, the vocabulary threaded by the caller

`guaranteesProblem` (src/intent/guarantees.ts) keeps its signature shape and gains one optional
parameter: `templates?: readonly string[]` — the template names in effect. The intent layer stays
pure and library-blind (P14's layering made explicit: the vocabulary is a *fact about the run*
the preflight caller owns, because the library is directory- and registration-state); the check
runs exactly when the caller supplies the vocabulary, and the one production caller — preflight —
always does, right after `usePromptLibrary(directory)`, passing `["phase-plan",
...promptTemplateNames()]`:

- **Unknown template**: an assert whose `template` is not in the supplied vocabulary is a strict
  usage error naming the pack, the offending target and the available values. The vocabulary
  includes the retired `phase-plan` name (0095 D4: the retired template's asserts keep their
  meaning on the formulation todo assembly, still gated under that key at prompt-plan's compose)
  beside every live library name — built-ins, shell registrations and target-directory overlay
  additions alike, because `promptTemplateNames()` reads the loaded library.
- **Unknown phase qualifier**: an assert whose `(<phase>)` qualifier is neither a builtin preset
  letter (`PHASE_LETTERS`) nor a declared custom type id (`customTypes`, already a parameter) is
  the same strict error — the qualifier is compared by exact equality against the render ctx's
  `phase` var, whose values are exactly `phaseTag`'s range (`entry.letter ?? entry.type`): a
  builtin's letter or a custom's id. A builtin's *type id* (`whole(analysis)`) is rejected with
  the letter spelling taught — it never matches a render and is the same silent inertness under a
  different spelling. (The `verify-plan-*` key family keeps its own deliberately wider
  id-canonical/letter-legacy resolution — that family resolves by lookup, not by equality against
  a render; no premise of 0100 D8/D9 changes.)

Both messages follow the `verify-plan-*` family's established shape (the pack named, the
offending line's target, the available values in parentheses). The shipped bundles stay green at
their own preflight (their asserts name `phase-plan`/`whole`/`subtask` and qualify by letters or
by their own declared custom ids — `spec-read`, `audit`), and their census test is strengthened
onto the real vocabulary in the same change (it now passes `["phase-plan",
...promptTemplateNames()]`, so a future bundle typo is caught by the census too, not only by
preflight over a materialized project). A hand-dropped project pack reaches the same check at
run preflight — the bundle-parse boundary (finding 047, step 061) is untouched here.

## Derivation and Category scope

Derives: P7, P15, P13, P12, P8, P10, P5. P7 shows in the guard and the vocabulary judging only
mechanical grammars the driver itself parses; P15 shows in the two-tier split kept (tier-1
completed, tier-2 untouched) and in the assert contract validated as data at its declared moment;
P13 shows in the additive vocabulary growth with its internal lockstep (fixtures repaired, the
decompose↔parser ratchet, the messages naming available values); P12 shows in the inert reading
resolved toward the loud failure; P8 shows in the two existing enforcement moments reused, no new
one; P10 shows in the no-overlay/no-asserts floor byte-identical and the known-breakage class
accepted per 0033 D6's precedent; P5 shows in the marker table pinned to the parser's single
source and the vocabulary threaded from the one caller that owns the fact. Tier: mechanism (the
load-time guard's data and the preflight validation — src behavior, not copy).

### Category scope

- **Code homes**: `src/template.ts` (the marker table, D1+D2), `src/intent/guarantees.ts`
  (`guaranteesProblem` D3), `src/loop-preflight.ts` (D3 the caller's threading).
- **Test homes**: `test/template.test.ts` (the repaired subtask fixtures, the new rejection and
  render arms, the decompose↔SUBTASK_TODO_SECTIONS ratchet), `test/prompt-exec.test.ts` (the
  repaired decompose-m fixture and its render assertion), `test/intent.test.ts` (D3 unit arms),
  `test/loop-preflight.test.ts` (D3 the preflight arm), `test/intent-guarantees.test.ts` (the
  census strengthened).
- **Documentation homes**: this document, `plans/INDEX.md` (the 0220 row), `AGENTS.md` (the
  prompt-copy and intent-selection navigation lines), `docs/structure.md` (the template-registry
  and intent rows).
- No config key, no exit code, no event vocabulary, no document grammar changes. The refusal
  message text of the marker guard is unchanged; the two new preflight messages are new arms of
  the guarantees contract's existing message family.

premises this ruling changes: none. 0033 D4's tier criterion is applied, not amended (every
added literal passes its own test); 0080 §2's grammar is extended only by validation of targets
its own header comment already claimed ("`<template>` is a prompt template name"; "the optional
(<phase>) qualifier restricts the line to renders whose ctx carries that `phase` var — a builtin
type's preset letter … or a custom type's id") — the ruled grammar and the documented spelling
were always this; the defect was that nothing enforced it. Re-read standing: 0033 D6
(the known-breakage acceptance covers the newly-rejected overlays — the same guard, the same
class), 0095 D4 (the phase-plan assert key's meaning untouched, its name now part of the
validated vocabulary), 0100 D8/D9 (the verify-plan-* resolution family untouched by the assert
qualifier's narrower equality rule).

## Residuals (named)

- The raw-marker check still accepts markers inside a never-rendered conditional — the S23
  record's ruled posture: the guard is an accident guard for trusted project configuration, not
  a sandbox; the render-side acceptance arms added here (rendering the enabled branch) cover the
  fixtures, not the mechanism.
- A pack asserting on a library name that exists but is never rendered (e.g. `_mode-brief`,
  which mode text assembles rather than renderPrompt) stays vacuously valid — the non-vacuous
  census is the shipped bundles' own ratchet; a project-pack vacuousness census would need a
  render-inventory oracle this step does not build (P21).
- The assert-template vocabulary is the preflight library state: a template registered by a
  shell only after preflight would make an assert on it reject at preflight while rendering
  later — no such caller exists today (registrations precede `usePromptLibrary` in every
  production shell; the S23 record's verified-clean note), recorded as the seam's standing fact.
- `_partials.md` overlay sections outside `PARTIAL_MARKERS` stay marker-free by design (tier-2);
  no census pins the partial-section marker table to a parser source the way D1's ratchet now
  does for decompose (the partial sections' parsers are template-side partial references, no
  mechanical counterpart to pin).

## Verification

Filled by the step record (plans/0166-remediation/060-we-override-guards.md): typecheck, the
full auto-core suite, and the fail-before proof over the pre-fix sources (/tmp/060-fixed).

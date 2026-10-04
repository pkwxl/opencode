# 0079 — Intent as a first-class policy bundle

Status: **executed, 2026-10-04.** The design document for the intent layer's second stage: turning
"intent" from a prompt-content pack (0031's degenerate form) into a named, materializable
**policy bundle**, plus the one control-flow hook an intent's workflow needs (a bounded
repair round). The concrete instance validating the design is the Clean-Room Redesign
protocol — a cyclically executable prompt protocol (state file → phase prompt → artifacts
→ exit criteria) for copyright-risk-free reimplementation work.

## 1. What "intent" is (the definition this change ships)

**Intent is a named, coherent policy bundle for a kind of work.** Policy = everything the
driver is *told* (phase duties, quality bars, governance, scenario rules, the phase
sequence, config defaults). **Mechanism = the driver's control flow, unchanged**: the
derived routing state machine (`routePhase`), the unit model (todo.md → done.md, index
ticks, `.auto/units.json`), the commit boundary, the gates, the protocol-string parsers.

The separation rule, restated as the boundary contract:

> **The runtime never interprets "intent".** It reads only the surfaces a bundle
> materializes into — phase-type files, an intent pack, a mode, config stamps — all of
> which are already-existing data surfaces. Intent is an init-time packaging and
> deployment concept for policy, entirely upstream of the mechanism.

This is the two-tier marker doctrine (0033 D4) generalized one level up: tier-1 flow
anchors stay core-owned and marker-guarded; a bundle is tier-2 through and through — it
rewords and adds prose, selects and stamps, but never forks the grammar.

### 1.1 The Clean-Room protocol maps onto existing mechanism

The external design's own principles — "the state file determines the current phase, the
phase prompt determines the current action, artifacts determine the context, and tests
determine whether advancement is permitted" — are the driver's existing shape:

| Clean-Room element | auto-core surface | class |
| --- | --- | --- |
| The dispatcher (AGENTS.md routing loop) | the driver itself (`phaseLoop` / `routePhase`) | mechanism — exists |
| STATE.md (current phase, machine-readable) | the driver-owned unit model: `phases.md` + `todo.md`/`done.md` + `.auto/units.json`; **derived** from artifacts, never agent-written | mechanism — exists, strictly stronger (the protocol's weak point is that the agent writes its own state) |
| REQUIREMENTS.md contract matrix (REQ/AT rows) | the unified unit model: `tasks.md` index + `docs/T-NNN/todo.md` (Goal/Scope/Acceptance) + `Depends:`/`Touches:` graph + `nextReady` | mechanism — exists |
| Phase prompts 01–07 | per-phase-type plan/decompose duties + intent-pack `## phase duties` | policy data |
| INIT / SPEC-READ | custom phase type `spec-read` (analysis-class work, `Phase-artifacts: spec-notes.md`) | data file |
| DESIGN / IMPLEMENT / VERIFY | builtin `d` / `m` / `t`, duties specialized by the pack | data |
| AUDIT (spec-compliance, not code review) | custom phase type `audit`, `Gate: verdict`, `Phase-artifacts: audit.md` | data file |
| REPAIR → VERIFY re-verification | the bounded repair run option (§4); FAIL-blocks-for-human stays the terminal state | new mechanism hook |
| FINALIZE | wrapup (`report.md`, `Result:` line) + the `k` phase | mechanism — exists |
| SPEC.md / ACCEPTANCE.md / INTERFACE.md inputs | `plan-input.md` (committed before the planning unit) + `.opencode/auto/brief.md` | mechanism — exists |
| Master system prompt (immutable rules) | the driver-rendered AGENTS.md block (read-only during run) + the mode's init preamble | mechanism + data |
| Clean-room boundary (never access the reference source) | the mode's exec notes + the pack's governance section; git worktree isolation (`isolate`, 0074) as the mechanism-level enforcement | policy + existing mechanism |

Roughly nine tenths of the protocol is already mechanism here. What is genuinely missing
is exactly three things, each added as a conscious, minimal extension (§2–§4).

## 2. The selection surface: config key `intent` (0031 D2 unblocked)

0031 deferred the pack-selection key until "a second real consumer appears". The bundle
is that consumer. The key:

- `intent?: string` in `ProjectConfig` — absent = `default` (the built-in pack; the key
  is not written for default-only projects, keeping today's configs byte-identical).
- Validated at config load exactly the way `mode` is: the value must match the pack-name
  grammar and name a pack `loadIntents(dir)` resolves (built-in plus
  `.opencode/auto/intents/`). A missing pack is a strict failure; the fix table reports
  it as a **manual** finding (`fix` never resets a key — the person restores the pack or
  amends the key).
- `amend --intent <name>` revises it per-key; appearing at run time is exit 1
  (constitutional doctrine).
- `promptFacts` selects the pack by the configured name — the one call site that
  hardcoded `DEFAULT_INTENT` becomes config-driven; the name rides `Opts.intent` /
  `RunAllOpts.intent` (filled by the shell from config, threaded by `sessionOpts` like
  `mode`), so every session render sees the same pack the run's preflight validated.
- Preflight logs the active pack and its provenance (`IntentSource`, frozen in 0031 for
  exactly this moment): `intent <name> (<builtin|project>)`.

Composition stays degenerate (0031 F8): exactly one active pack, no merging. The key
selects; it never composes.

## 3. The bundle format and its init-time materializer (zero runtime surface)

A bundle is a directory of files:

```
<bundle>/
  bundle.json            # manifest: name, phases, optional config stamps
  phases/<type>.md       # custom phase-type files (custom.ts format, verbatim)
  intents/<name>.md      # the intent pack (name must equal the bundle name)
  modes/<name>.md        # the mode (name must equal the bundle name)
```

`bundle.json` fields: `name` (required, pack-name grammar), `phases` (required — the
comma form of full type ids, never the letter preset, see §5), and optional stamps
`subtask`, `parallel`, `wrapup` (config-shaped values). The mode stamp is the bundle's
own mode file when present (a bundle ships its mode or uses a registered one via
`mode` in the manifest); the intent stamp is always the bundle name.

`src/bundle.ts` owns three functions:

- `parseIntentBundle(files)` — validates every piece through the **existing** parsers
  (`parsePhaseTypeFile`, `parseIntentFile`, `parseModeFile`) plus the manifest checks
  (comma-form phases that resolve against builtins ∪ the bundle's own types,
  `implement` required, stamp values config-valid). Nothing is written on a parse
  failure.
- `materializeIntentBundle(dir, bundle)` — writes the files into the target's
  `.opencode/auto/{phases,intents,modes}/` and returns the config stamps for init to
  merge (explicit CLI flags win over manifest stamps).
- `registerIntentBundle(name, files)` — the shell registration path (mirrors
  `registerTemplate`): a shell ships bundles without the core embedding template files.
  A registered name and a directory path are the two bundle sources `init --intent`
  resolves.

No runtime module reads a bundle. The target keeps only the materialized files — there
is no drift copy; re-running `init --intent` re-materializes idempotently (same bytes).
Provenance travels in the `intent` key plus the pack's own header. The fixture bundle
that validates the mechanism **is** the Clean-Room one (§1.1's `spec-read` + `audit`
types, the cleanroom pack, the cleanroom mode) — the concrete example ships as a test
fixture, not (yet) as a built-in template family; a shell registers one when it wants
one shipped.

## 4. The one control-flow hook: the bounded repair run option

The Clean-Room protocol wants AUDIT/VERIFY failures to loop back through REPAIR
automatically ("never REPAIR → FINALIZE; all fixes must undergo re-verification"). The
driver's doctrine (0044) is the opposite pole: a FAIL verdict blocks the run for a
person — completion is never agent-judged, and the person's documented rework path is
`plan --force-close … --append` or hand-listed fix tasks.

The ruling (the person, this change): repair becomes a **run option**, modeled on the
existing driver-owned control-flow precedents — `/exit` (a boundary the control service
honors) and failover (bounded automatic recovery with the human block as the terminal
state):

- `--repair <n>` on `run` (never a config key; run-side width like `--max-sessions`),
  default 0 = today's behavior byte for byte. Budget 1..10, parsed by the shell.
- **Phase level** (the gate-held handover): when `completePhase` returns verdict-gate
  problems and budget remains, the driver runs one repair round — an appending session
  over the gate evidence (`appendPlan`, stage `phase-append`, which already removes the
  stale handover per 0053 D25) — then the loop re-derives: the appended tasks execute,
  the phase distills again, the gate re-checks the rewritten `verdict.md`. Acceptance
  gates never auto-repair: `Accepted: yes` is the human's alone. Budget exhausted, or
  the append blocked → today's gate stop with the human's ways on.
- **Task level** (the report `Result: FAIL`): one repair round automates the person's
  documented rework path — `closeUnit` the failed task (reason: repair round), then
  append repair tasks over the report's FAIL evidence. The closed task is done for
  scheduling, its `Closed:` field records why; the appended tasks carry the remaining
  work and re-verify. A refused close (explicit dependents without cascade) or a failed
  append falls through to today's block.
- Doctrine guards, in code and here: the driver still parses every verdict from files
  (completion is never agent self-report); each round consumes budget; rounds are
  interruption-resumable through the existing append/close machinery and resume points,
  with no new state kinds (the round count lives on the loop context, not on disk);
  under lanes (the scheduler, `--max-sessions ≥ 2`) and under plan's stop condition the
  option does not apply — v1 is the serial run path.
- The intent layer's role is the *content*: the pack's governance section supplies the
  repair duties (how to repair, what evidence to re-check); the mechanism supplies only
  the bounded loop. The fixture pack carries a `### repair` subsection under
  `## governance` demonstrating the split.

## 5. Phase vocabulary rules (the m/migrate, i/implement, v/verify question)

Considered and ruled out, as normative rules rather than code:

- **The two-layer vocabulary stays.** The `admtvk` letters are human `--phases` input
  shorthand only — never durable; the type ids (`analysis`, `design`, `implement`,
  `test`, `acceptance`, `knowledge`) are the durable protocol (`P<nn>-<type>`
  directories, config values, names, commit subjects). The meaningful long form already
  exists and is first-class: `--phases analysis,design,implement,test,acceptance`
  (any order, repeats allowed, custom ids mixed in).
- **No builtin renames** (`acceptance` → `verify`): it would orphan every existing
  `P<nn>-acceptance` directory and stored phases value, and the current word carries
  doctrine — the v phase is the *independent judgment* behind the verdict gate (the
  Clean-Room protocol itself splits VERIFY the activity from ACCEPTANCE the criteria).
  If ever done, it is a versioned protocol event with old-form compatibility reading.
- **No letter aliases** (`i` for implement): zero expressive gain (the comma form spells
  it), and it breaks the frozen subsequence grammar and the preset-shape invariant.
  `"m"` alone remains the no-phase single run — distinct from the list `implement`, a
  phased flow with a planning session.
- **`migrate` is a scenario, not a work shape**: a builtin `migrate` phase type would
  invert the separation — every scenario would then deserve a registry twin, which is
  the proliferation the mode/pack layer exists to absorb. `mode: migrate` + type
  `implement` already compose; the mode's exec notes and the pack's `### m` duties
  specialize the generic phase.
- **Bundle manifests use the comma form with full type ids only** — never letters.
  A manifest's sequence reads `spec-read,design,implement,test,audit`; the parse
  rejects a preset-shaped value.
- **Custom types carry their own display names** (the file's title line), so a bundle's
  phases read in the intent's own vocabulary in logs, commits and the `phaseName`
  prompt var — the expressiveness the question asked for, without touching the frozen
  surfaces.
- Known wart, recorded: builtin `dutiesRef` keys packs and `plan-duties-<key>` partials
  by **letter** (`### v`), not id. Left as is; re-keying is the same class of versioned
  protocol event.

## 6. Explicitly-not list

- No phase-registry changes: custom types stay `hasTasks: true` and decompose-`m`
  (the Clean-Room fixture needs neither relaxed); the gate vocabulary stays
  `verdict`/`acceptance`.
- Pack composition stays degenerate; no multi-pack merge.
- No built-in bundle shipped in core templates this change (a shell registers one via
  `registerIntentBundle` when wanted).
- No repair under lanes or under plan's stop condition (serial run path, v1).
- No new exit codes: repair-then-block still exits 2 exactly as today.

## 7. Tests

- `test/bundle.test.ts`: the Clean-Room fixture bundle — parse/materialize/stamp; a
  materialized project resolves its pack through the selection key and establishes a
  round with the custom types; invalid bundles fail named (bad manifest, preset-form
  phases, mismatched pack/mode names, unknown type reference).
- `test/config.test.ts` + prompt suites: the intent key's validation, absent-key
  default, the facts' selection, the preflight provenance line.
- `test/agent-fake.test.ts`: FAIL → repair round (close + append) → re-run → PASS
  completes; FAIL × (N+1) → blocks exactly as today; the phase-gate variant
  (verdict held → append → re-verify), and an acceptance-held gate never repairing.
- Session-opts ratchet: the new `intent` field on every session options set.

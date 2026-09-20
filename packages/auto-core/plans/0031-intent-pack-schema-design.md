# 0031 Intent pack schema (M1.1): domain interface freeze + sectioned intent packs

> Milestone M1.1 of `plans/AUTO_NEXT_REFACTOR_PLAN.md` (root), implementing
> D1 (modes extended into composable intent packs) and D8 (interface-first
> domains). Stage-assisting document per D6: retires as history once the
> refactor closes. Open questions 1/2 are settled **only in their degenerate
> form** here (F8); composition algebra generalizes when a second real
> consumer appears.

## 1. Scope

Four workpieces:

1. **Frozen domain interfaces (D8)** — `src/intent/types.ts` (IntentPack /
   IntentSection / IntentSource / DEFAULT_INTENT) and
   `src/document/types.ts` (DocumentRole / ArtifactSpec). These are the
   contract surfaces other domains may depend on; changing them is a
   conscious architecture event (enforced via the import-direction suite's
   entry lists).
2. **Intent-pack loader** — `src/intent/load.ts`, evolved from `src/mode.ts`:
   same sectioned-file protocol, generalized to the five intent sections.
   Built-in presets embed from `templates/intents/<name>.md`
   (`with { type: "file" }`); the target directory's
   `.opencode/auto/intents/<name>.md` adds packs or overrides a same-named
   built-in.
3. **Built-in preset** — `templates/intents/default.md`: the empty default
   pack. It anchors the override target and documents the file protocol;
   sections fill in as (b)-class content migrates out of the core templates
   (M1.2 decompose family, M1.3 subtask family, M2 task-loop families).
4. **Degenerate composition** — `resolveIntent` is a plain lookup: exactly
   one active pack (default: `default`), project override applied wholesale
   at load time. No merge, no selection surface, no config key.

## 2. Decisions

| # | Decision | Content |
|---|---|---|
| D1 | Pack file protocol | First line `# <name>` (must match the file name, same rule as modes); sections introduced by the human-readable headings `## quality` / `## phase duties` / `## acceptance` / `## governance` / `## artifact spec`; unknown sections rejected; **all sections optional** — absent or empty sections contribute nothing (zero-intent baseline = current behavior). Unlike mode files (five mandatory sections), optionality is required because packs accrete content per loop milestone. |
| D2 | Degenerate composition | Single active pack + wholesale same-name override. A project overrides the default pack by providing `.opencode/auto/intents/default.md`; there is no merge and no pack-selection config key yet. Rationale (F8): the only consumer is the core itself until M1.2 wires injection; composition precedence (builtin < project < mode < task-level, root design §4-2) is recorded but not implemented. |
| D3 | Override is wholesale, not per-section | A project `default.md` replaces the built-in pack entirely; omitted sections stay absent even if the built-in had them. Merging section-by-section would already be composition algebra. |
| D4 | Loader unwired until first consumer | `loadIntents`/`resolveIntent` ship with tests but no production call site; the prompt assembly point starts consuming them in M1.2 alongside the first content migration, so the injection shape is locked by a real consumer, not by anticipation. A malformed project intent file is therefore not yet validated at startup — acceptable for one milestone, called out so it is not mistaken for an oversight. |
| D5 | Headings are human-readable | File headings use spaced forms (`## phase duties`, `## artifact spec`); the parser maps them to the camelCase type keys. Diagnostics list the file-facing headings, not the type keys. |
| D6 | document/types frozen per root design §3.2 | `DocumentRole` five-value union (driverState / ledger / handoff / artifact / freeform) + `ArtifactSpec` { path, sectionAnchor?, role }. First consumers: M1.4 (spec-driven artifact checks, incl. the M1.0 todo.md/done.md state files) and M2.3 (role close-out: eof-exempt lists, protect policy, handoff shape checks become role-derived). |
| D7 | Domain entry publishing | `intent/load` added to the import-direction suite's DOMAIN_ENTRIES next to `intent/types` — the loader is the published acquisition surface; driver code must not reach past these two modules into the domain. `document/types` was already published. |

## 3. Non-goals (explicitly deferred)

- Content migration into packs → M1.2/M1.3 (golden byte-equivalence per §7-2
  of the plan applies there, not here: this milestone changes no prompt
  template).
- `artifactSpec` section consumption by the document domain → M1.4.
- Mode ↔ pack interplay (a mode referencing pack sections) → open question 1,
  second consumer.
- Pack selection surface (config key / CLI) → open question 2, second
  consumer.
- Shell-side registration of intent packs (à la `registerTemplate`) → when a
  shell actually needs it.

## 4. Verification

- `test/intent.test.ts`: 10 cases — parse (full/partial/trim/title/unknown
  section), built-in registry (empty default pack), overlay (add / invalid
  name / wholesale override), degenerate resolve (default, named, unknown).
- Import-direction suite: new files auto-classify via domain dirs; entry-list
  extension is the only table edit.
- Full suite: 924 pass / 0 fail (914 + 10 new), `bun typecheck` clean;
  packages/auto 54 pass / typecheck clean, zero shell changes. Golden
  snapshots untouched (no template changed).

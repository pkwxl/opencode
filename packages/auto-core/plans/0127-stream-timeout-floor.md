# 0127 — the streaming-timeout floor: the managed server's spawn config guarantees provider streaming windows long enough for the driver's dispatches

The maintainer's ruling from the 2026-10-26 cleanroom baseline stall (measured, the run's own journals):
task T-020 ("Consolidate and verify the design corpus", a design-phase unit whose deliverable is one large
document written in a single Write call) entered a four-hour zero-output retry storm. The managed opencode
server's provider fetch carried 300s streaming windows — `headerTimeout` (response headers) and
`chunkTimeout` (between SSE chunks), the server's own defaults for the provider class — while the
provider's reply latency for a long single-shot generation structurally exceeds them: every model step
died at ~5m20s with zero output tokens ("Provider response headers timed out after 300000ms", "SSE read
timed out"), each death was classified a transient session error, and the designed recovery re-forked the
failed session — keeping both its 415.9k-token context and the very one-call plan that kept failing —
through the full 0/1/2/4/8-minute ladder, a 30-minute wait-and-probe round, and a key-ring rotation the
storm itself provoked (~2.5M cache-read tokens replayed against a 7-day quota; key 1 marked down until
its stated reset). 4h14m accumulated on the one task, no artifact written, the run looking "still
running" — every mechanism doing exactly what it was designed to do around a config value nobody had set.

The boundary question answered from [docs/principles.md](../docs/principles.md) first: this is the
**managed-server spawn configuration family** (0055 §4.3's injection — the driver-owned
`OPENCODE_CONFIG_CONTENT`), not a target-config family. The person's requirement: running `opencode-auto`
alone, on any project, with no per-project or per-machine hand configuration, must not be able to enter
that storm. init/fix stamping was ruled out — the driver writing person-visible provider options into the
target's `opencode.json` adds a second writer to a person-owned surface (P5) and still demands a fix pass;
the spawn config is already the driver's single-owned injection seam (P14) and reaches every managed
spawn, existing projects included, with no action at all.

The mechanism, in one sentence: **`spawnKeyConfig()` sets `headerTimeout`/`chunkTimeout` to a 1,200,000 ms
floor for every provider the run's model registry names — ringed or ringless, since a ringless provider
can receive a dispatch — and the adapter strips any key the target's `opencode.json` declares, so an
explicit person value always wins.** `STREAM_TIMEOUT_FLOOR_MS` lives in `src/router.ts` beside the
composition; `registryProviders()` (the registry's whole provider surface, the loader's per-entry
`provider` derivation) joins `buildRings()` in `src/keyring.ts`; `withoutDeclaredTimeouts()` in
`src/agent/opencode/server.ts` reads the target's `opencode.json`/`opencode.jsonc` at spawn time (JSON
only — an unparseable or comment-bearing body reads as undeclared and the floor applies) and removes
exactly the declared timeout keys from the content copy, the apiKey references and everything else
passing through untouched. The person-wins strip is required by the layering, read off the server's own
config loader: `OPENCODE_CONFIG_CONTENT` merges **after** the project's config files, so an undeclared
floor key would otherwise override a declared value.

This ruling Derives: **P19** (measured evidence — the incident above, its journals cited: the 300s
defaults, the ~5m20s step cadence, the per-attempt ~415.9k token replays, the 4h14m unit total), **P14**
(one-way dependencies through declared seams — the guarantee rides the driver's own spawn-config seam
into the adapter it already owns; the core learns nothing new, no shell or target surface is touched),
**P5** (single ownership — the spawn content stays the router's composition and the adapter's
spawn-time transformation; the target's `opencode.json` keeps its one writer, the person, whose declared
keys win through omission rather than through any driver write), **P10** (the byte-identical floor — a
registry naming no provider, an external server, or a config the person fully declares leave the spawn
content exactly as 0055 sent it: undefined content keeps `OPENCODE_CONFIG_CONTENT = "{}"` byte for byte,
and a declared value is never overridden, so the mechanism degrades to precisely the person's config),
and **P13** (frozen additive-only vocabularies — the content's provider options grow two keys
additively; the apiKey reference semantics are untouched, every existing key keeps its meaning). It
**extends 0055 §4.3** (the spawn config's content widens from "the active rings' current keys" to "the
driver's provider options for its managed servers" — the keys half unchanged, the floor half new;
provenance carried: §4.3's injection channel, its reference-only security property, and its
undefined-equals-"{} rule all stand, the last now keyed on the provider set rather than the ring set).
Tier touched: **mechanism** — core src and tests; no principle text, no templates, no shell surface.

The value, 20 minutes: it covers the measured latency class (the storm's steps were not slow — they
were cut off; a session that survived 6+ minutes completed its step on the first raised try), while a
genuinely dead endpoint costs at most one 20-minute silent wait per ladder step — a bounded price the
same retry ladder, rotation and window machinery already govern (P20's bounded escalation unchanged;
only the wait per attempt grows). The floor is a default, never a policy: a person or operator who wants
another number declares it in the target's `opencode.json` (`provider.<id>.options.headerTimeout`/
`chunkTimeout`, any value including `false`) and wins at the next spawn; interactive sessions (no driver
spawn, no spawn config) remain the person's own global-config domain — this ruling deliberately claims
nothing there.

Non-goal, recorded: retry-spend capping (the storm's ~2.5M token replay is real cost, but the floor
removes its cause; a per-task fork-retry budget would be its own ruling with its own measured evidence —
P21's machinery-waits-for-its-consumer).

## Category scope (0123 D1's discipline)

Family: *the managed-server spawn configuration — the driver-owned provider options injected as
`OPENCODE_CONFIG_CONTENT` (0055 §4.3's channel).* Home-set enumerated at ruling time:

| home | disposition |
|---|---|
| `src/router.ts` (`STREAM_TIMEOUT_FLOOR_MS`, the `providers` activation state, `spawnKeyConfig()`, the interface comment) | changed — the composition |
| `src/keyring.ts` (`registryProviders()`, the module header) | changed — the registry derivation |
| `src/agent/opencode/server.ts` (`withoutDeclaredTimeouts()`, `declaredProviderOptions()`, `inputs()` async, the two spawn sites) | changed — the person-wins strip at spawn |
| `src/agent-pool.ts` (the pool's `spawnKeyConfig` read), `src/session.ts` (the rotation's `setConfig`) | held — the two consumers, their signatures and call shapes unchanged; the content widens beneath them |
| `test/keyring.test.ts`, `test/agent-fake.test.ts` | changed — the spawn-config truth tables re-pinned (the ring entries carry the floor; the ringless provider gains its timeout-only entry) |
| `test/agent-server.test.ts` | changed — the strip's own suite (declared keys removed per key, `false` a declaration, empty entries, missing/unparseable/jsonc files, undefined config) |
| `docs/structure.md` (the "Key rings" row) | changed — the row's "spawn config content" phrase gains the floor |
| `AGENTS.md` (the model-registry navigation line) | changed — the floor named with its 0127 pointer |
| `packages/auto` (the shell) | held — no shell surface names the spawn content; the help and README untouched |
| the target's `opencode.json`, `src/external-dirs.ts`, `src/config-fix.ts` (the person-config writer family) | held — no driver write is added; the person's declaration wins through omission, never through a stamp |
| `templates/`, `prompts/` | held — no prompt or pack surface carries the content |

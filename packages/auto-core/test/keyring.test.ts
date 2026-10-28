// Key rings (plans/0055 §4.3, §6.4, §7 step 1; the key-failure state split
// and the order-first search of plans/0144): the per-provider rings built
// from a registry, the in-memory position (never moved back on its own, but
// searched from declared order at every rotation and rewound by /failback),
// the one-shot skip flags and `until` marks, the spawn config content
// (references only — no key value ever appears), the usable-key predicate of
// §6.2 rule 4, and the labels the logs show. The ring run state lives in the
// router service; every test reads the fresh instance the preload installed.
import { describe, expect, test } from "bun:test"
import { buildRings, ringKeyLabel, type RingRotation } from "../src/keyring"
import type { ModelEntry, ModelReference, ModelRegistry } from "../src/models-schema"
import { createServices, installServices, services } from "../src/services"

const envKey = (name: string): ModelReference => ({ kind: "env", name, ref: `{env:${name}}`, label: name })
const fileKey = (path: string, written: string): ModelReference => ({ kind: "file", path, ref: `{file:${path}}`, label: written })

const entry = (name: string, fields: Partial<ModelEntry> = {}): ModelEntry => ({
  name,
  layer: "operator",
  agent: "opencode",
  ...fields,
})

const KEY_A = envKey("ZHIPU_KEY_A")
const KEY_B = envKey("ZHIPU_KEY_B")
const KEY_C = fileKey("/home/op/.secrets/zhipu-c", "~/.secrets/zhipu-c")

// deep: glm (zhipuai, ringed) → k2 (moonshotai, shares the ring by the
// loader's rule); simple: plain (no ring).
const registry = (models?: ModelEntry[]): ModelRegistry => {
  const list =
    models ??
    [
      entry("glm", { model: "zhipuai/glm-4.6", provider: "zhipuai", keys: [KEY_A, KEY_B, KEY_C] }),
      entry("k2", { model: "zhipuai/kimi-k2", provider: "zhipuai", keys: [KEY_A, KEY_B, KEY_C] }),
      entry("plain", { model: "other/plain" }),
    ]
  return {
    layers: [{ name: "operator", path: "/fleet/models.json" }],
    tz: "UTC",
    agents: new Map([["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }]]),
    models: new Map(list.map((item) => [item.name, item])),
    tiers: {},
    routes: new Map(),
    unused: [],
  }
}

const NOW = Date.parse("2026-09-26T12:00:00Z")

// The ring state and the key marks both live in the run's router; each test
// reads the fresh instance the preload installed (a mid-test "before
// activation" reinstalls a holder, whose fresh router has no rings).
const router = (): ReturnType<typeof services>["router"] => services().router
const freshRouter = (): ReturnType<typeof services>["router"] => {
  installServices(createServices())
  return services().router
}

describe("buildRings (pure, from the registry)", () => {
  test("one ring per provider in registry order; the first entry on the provider defines it; keyless entries contribute nothing", () => {
    const rings = buildRings(registry())
    expect([...rings.keys()]).toEqual(["zhipuai"])
    expect(rings.get("zhipuai")).toEqual([KEY_A, KEY_B, KEY_C])
    // The ring is a copy: mutating it cannot reach the registry's entries.
    rings.get("zhipuai")!.pop()
    expect(buildRings(registry()).get("zhipuai")).toHaveLength(3)
  })
})

describe("activation and the spawn config (§4.3 injection)", () => {
  test("the managed server's config names each ring's current key as the provider apiKey reference, every registry provider carrying the streaming-timeout floor (plans/0127)", () => {
    router().activateRings(registry(), false)
    expect(router().ringsActive()).toBe(true)
    expect(router().spawnKeyConfig()).toEqual({
      provider: { zhipuai: { options: { apiKey: "{env:ZHIPU_KEY_A}", headerTimeout: 1_200_000, chunkTimeout: 1_200_000 } } },
    })
  })

  test("a rotated ring changes the apiKey reference; a {file:} key is the absolute path reference", () => {
    router().activateRings(registry(), false)
    const rotation = router().ringRotation("zhipuai", NOW)!
    router().commitRotation(rotation)
    router().commitRotation(router().ringRotation("zhipuai", NOW)!)
    expect(router().spawnKeyConfig()).toEqual({
      provider: { zhipuai: { options: { apiKey: "{file:/home/op/.secrets/zhipu-c}", headerTimeout: 1_200_000, chunkTimeout: 1_200_000 } } },
    })
  })

  test("a ringless registry provider gets the floor alone (no apiKey entry); entries without a provider contribute nothing", () => {
    const mixed = registry([
      entry("glm", { model: "zhipuai/glm-4.6", provider: "zhipuai", keys: [KEY_A] }),
      entry("plain", { model: "other/plain", provider: "other" }),
      entry("bare", { model: "strange" }),
    ])
    router().activateRings(mixed, false)
    expect(router().spawnKeyConfig()).toEqual({
      provider: {
        zhipuai: { options: { apiKey: "{env:ZHIPU_KEY_A}", headerTimeout: 1_200_000, chunkTimeout: 1_200_000 } },
        other: { options: { headerTimeout: 1_200_000, chunkTimeout: 1_200_000 } },
      },
    })
  })

  test("a registry whose entries name no provider sends no config at all", () => {
    router().activateRings(registry([entry("plain", { model: "other/plain" })]), false)
    expect(router().spawnKeyConfig()).toBeUndefined()
  })

  test("inactive rings (external server) and unactivated rings send no config at all", () => {
    router().activateRings(registry(), true)
    expect(router().ringsActive()).toBe(false)
    expect(router().spawnKeyConfig()).toBeUndefined()
    expect(freshRouter().spawnKeyConfig()).toBeUndefined()
  })

  test("no key value ever appears: the config and its JSON hold references only", () => {
    router().activateRings(registry(), false)
    const text = JSON.stringify(router().spawnKeyConfig())
    expect(text).toContain("{env:ZHIPU_KEY_A}")
    // Nothing but the reference syntaxes: no bare secret shape, and both
    // reference kinds round-trip through the spawn config untouched.
    expect(text.match(/\{env:[A-Z_]+\}|\{file:\/[^}]+\}/g)).toEqual(["{env:ZHIPU_KEY_A}"])
  })
})

describe("rotation (plans/0144 D2: the search is order-first; the position never moves back on its own)", () => {
  const rotate = (provider = "zhipuai"): RingRotation | undefined => {
    const search = router().ringRotation(provider, NOW)
    if (search?.to !== undefined) router().commitRotation(search)
    return search
  }

  test("each search lands on the earliest declared key the run holds no evidence against; the refusal applies the passed consumption", () => {
    router().activateRings(registry(), false)
    // From A: the search starts at index 0, skips A itself (the failure
    // being rotated away from) and lands on B.
    expect(rotate()?.to).toMatchObject({ index: 1, total: 3 })
    // From B: the search starts at index 0 again — A carries the skip flag
    // of its own failure, is passed over (the flag clears at the commit)
    // and C lands.
    expect(rotate()?.to).toMatchObject({ index: 2, total: 3 })
    // From C: A's flag was consumed by the search that passed it, so the
    // order-first search lands back on A — a recovered earlier key is
    // re-preferred the moment a rotation fires at all.
    expect(rotate()?.to).toMatchObject({ index: 0, total: 3 })
    // From A: B and C both carry their flags and the search refuses to
    // land, naming both in `passed`; applying the refusal consumes them
    // (the next search considers them again) and writes A's failure, the
    // position staying where it is.
    const refusal = router().ringRotation("zhipuai", NOW)!
    expect(refusal.to).toBeUndefined()
    expect(refusal.passed).toEqual([KEY_B.ref, KEY_C.ref])
    expect(router().isKeyDown("zhipuai", KEY_B.ref, NOW)).toBe(true)
    router().commitRotation(refusal)
    expect(router().isKeyDown("zhipuai", KEY_B.ref, NOW)).toBe(false)
    expect(router().isKeyDown("zhipuai", KEY_C.ref, NOW)).toBe(false)
    expect(router().isKeyDown("zhipuai", KEY_A.ref, NOW)).toBe(true)
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_A.ref)
  })

  test("a skip flag is one-shot: the applying search consumes it; deciding clears nothing", () => {
    router().activateRings(registry(), false)
    const first = router().ringRotation("zhipuai", NOW)!
    expect(router().isKeyDown("zhipuai", KEY_A.ref, NOW)).toBe(false)
    router().commitRotation(first)
    expect(router().isKeyDown("zhipuai", KEY_A.ref, NOW)).toBe(true)
    // The second search passes A's flag — deciding collects it (`passed`)
    // without clearing it, so a decided-but-uncommitted search stays
    // replayable.
    const second = router().ringRotation("zhipuai", NOW)!
    expect(second.passed).toEqual([KEY_A.ref])
    expect(router().isKeyDown("zhipuai", KEY_A.ref, NOW)).toBe(true)
    router().commitRotation(second)
    expect(router().isKeyDown("zhipuai", KEY_A.ref, NOW)).toBe(false)
  })

  test("an `until` mark holds its key to the stated instant, then the order-first search lands on it", () => {
    router().activateRings(registry(), false)
    // B's failure stated a reset an hour out: a rotation from A passes B
    // (evidence, not a flag — B never joins `passed`) and lands on C.
    router().markKeyDown("zhipuai", KEY_B.ref, NOW + 3_600_000)
    const held = router().ringRotation("zhipuai", NOW)!
    expect(held.passed).toEqual([])
    expect(held.to).toMatchObject({ index: 2, total: 3 })
    router().commitRotation(held)
    // Past the instant B is eligible again, and the next search starts at
    // declared order: A carries its flag (passed, cleared at the commit),
    // B lands.
    const released = router().ringRotation("zhipuai", NOW + 3_600_001)!
    expect(released.passed).toEqual([KEY_A.ref])
    expect(released.to).toMatchObject({ index: 1, total: 3 })
    router().commitRotation(released)
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_B.ref)
  })

  test("a boundary clear moves nothing: the position stays, key state survives, and the next rotation's search decides", () => {
    router().activateRings(registry(), false)
    rotate()
    rotate()
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_C.ref)
    // A scope boundary clears model marks only (plans/0144 D1) — the key
    // state is not boundary state, and nothing rewinds the position without
    // a failure (§6.4's restart-churn floor).
    router().clearDownMarks("task", "task")
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_C.ref)
    expect(router().spawnKeyConfig()).toEqual({
      provider: { zhipuai: { options: { apiKey: "{file:/home/op/.secrets/zhipu-c}", headerTimeout: 1_200_000, chunkTimeout: 1_200_000 } } },
    })
    // The next rotation's order-first search lands on A — B's flag stands,
    // A's was consumed by the search that passed it.
    expect(rotate()?.to).toMatchObject({ index: 0, total: 3 })
  })

  test("a flagged or held key is skipped: rotation lands on the next key with no evidence against it", () => {
    router().activateRings(registry(), false)
    // Key B flagged out-of-band (a bare auth failure, say): a failure of
    // key A skips straight to key C.
    router().markKeyDown("zhipuai", KEY_B.ref)
    expect(router().ringRotation("zhipuai", NOW)?.to).toMatchObject({ index: 2, total: 3 })
  })

  test("rotation mutates nothing until committed: deciding leaves the key state and the position alone", () => {
    router().activateRings(registry(), false)
    const rotation = router().ringRotation("zhipuai", NOW)
    expect(rotation).toBeDefined()
    expect(router().keyDownMark("zhipuai", KEY_A.ref)).toBeUndefined()
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_A.ref)
    router().commitRotation(rotation!)
    expect(router().isKeyDown("zhipuai", KEY_A.ref, NOW)).toBe(true)
  })

  test("a single-key ring always refuses; an unknown provider, inactive rings and unactivated rings answer nothing", () => {
    const single = registry([entry("solo", { model: "prov/m", provider: "prov", keys: [envKey("ONLY")] })])
    router().activateRings(single, false)
    // The lone key is its own `from`, so the search never lands — but it
    // still answers, and applying the refusal writes the failure (the
    // escalation's path), so rule 4 can hold the provider out.
    const refusal = router().ringRotation("prov", NOW)!
    expect(refusal.to).toBeUndefined()
    expect(refusal.passed).toEqual([])
    expect(router().ringRotation("other", NOW)).toBeUndefined()
    router().activateRings(registry(), true)
    expect(router().ringRotation("zhipuai", NOW)).toBeUndefined()
    expect(freshRouter().ringRotation("zhipuai", NOW)).toBeUndefined()
  })
})

describe("the usable-key predicate (§6.2 rule 4)", () => {
  test("a ring with a key that is not excluded is usable; an exhausted ring is not; the probe's clear restores it", () => {
    router().activateRings(registry(), false)
    expect(router().ringHasUsableKey("zhipuai", NOW)).toBe(true)
    for (const key of [KEY_A, KEY_B, KEY_C]) router().markKeyDown("zhipuai", key.ref)
    expect(router().ringHasUsableKey("zhipuai", NOW)).toBe(false)
    // Not a boundary clear — key state never clears at one (plans/0144 D1);
    // the recovery probe's wholesale clear is what restores the ring.
    router().clearDownMarks("task", "task")
    expect(router().ringHasUsableKey("zhipuai", NOW)).toBe(false)
    router().clearRingMarks("zhipuai")
    expect(router().ringHasUsableKey("zhipuai", NOW)).toBe(true)
  })

  test("providers without a ring, inactive rings and unactivated rings are always usable", () => {
    router().activateRings(registry(), false)
    expect(router().ringHasUsableKey("other", NOW)).toBe(true)
    router().activateRings(registry(), true)
    expect(router().ringHasUsableKey("zhipuai", NOW)).toBe(true)
    expect(freshRouter().ringHasUsableKey("zhipuai", NOW)).toBe(true)
  })
})

describe("/failback rewinds the rings (plans/0144 D3)", () => {
  test("the person's reset command clears all key state and every position to the first key", () => {
    router().activateRings(registry(), false)
    // Two rotations deep (position C), a stated reset holding B, a flag on A.
    router().commitRotation(router().ringRotation("zhipuai", NOW)!)
    router().commitRotation(router().ringRotation("zhipuai", NOW)!)
    router().markKeyDown("zhipuai", KEY_B.ref, NOW + 3_600_000)
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_C.ref)
    router().requestFailback()
    expect(router().consumeFailback()).toBe(true)
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_A.ref)
    expect(router().isKeyDown("zhipuai", KEY_B.ref, NOW)).toBe(false)
    expect(router().isKeyDown("zhipuai", KEY_A.ref, NOW)).toBe(false)
    expect(router().spawnKeyConfig()).toEqual({
      provider: { zhipuai: { options: { apiKey: "{env:ZHIPU_KEY_A}", headerTimeout: 1_200_000, chunkTimeout: 1_200_000 } } },
    })
  })

  test("a late classifier reset upgrades a skip flag to an `until` mark; no state reads false", () => {
    router().activateRings(registry(), false)
    // A bare failure flagged B; the classifier's resetAt arrives after the
    // turn ended — the fact replaces the guess.
    router().markKeyDown("zhipuai", KEY_B.ref)
    expect(router().extendKeyDownMark("zhipuai", KEY_B.ref, NOW + 3_600_000)).toBe(true)
    expect(router().keyDownMark("zhipuai", KEY_B.ref)).toEqual({ until: NOW + 3_600_000 })
    expect(router().isKeyDown("zhipuai", KEY_B.ref, NOW + 3_600_000)).toBe(false)
    // An `until` mark extends to a later instant; a key with no state at
    // all is not resurrected.
    expect(router().extendKeyDownMark("zhipuai", KEY_B.ref, NOW + 7_200_000)).toBe(true)
    expect(router().extendKeyDownMark("zhipuai", KEY_C.ref, NOW + 3_600_000)).toBe(false)
  })
})

describe("the recovery probe's ring half (§6.3)", () => {
  test("clearRingMarks clears the provider's key marks without moving the position; markCurrentKeyDown re-marks the key the probe ran on", () => {
    router().activateRings(registry(), false)
    router().commitRotation(router().ringRotation("zhipuai", NOW)!)
    // The current key (B) and the tail (C) both fail: the ring is exhausted.
    router().markKeyDown("zhipuai", KEY_B.ref)
    router().markKeyDown("zhipuai", KEY_C.ref)
    expect(router().ringHasUsableKey("zhipuai", NOW)).toBe(false)
    router().clearRingMarks("zhipuai")
    expect(router().ringHasUsableKey("zhipuai", NOW)).toBe(true)
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_B.ref)
    router().markCurrentKeyDown("zhipuai")
    expect(router().isKeyDown("zhipuai", KEY_B.ref, NOW)).toBe(true)
    // A provider without a ring and an unknown provider are no-ops.
    expect(() => router().clearRingMarks("other")).not.toThrow()
    expect(() => router().markCurrentKeyDown("other")).not.toThrow()
  })
})

describe("labels and the startup note (§6.5, §4.3 limits)", () => {
  test("ringKeyLabel names the position and the reference, never a value", () => {
    expect(ringKeyLabel({ ref: KEY_B, index: 1, total: 3 })).toBe("2/3 ZHIPU_KEY_B")
    expect(ringKeyLabel({ ref: KEY_C, index: 2, total: 3 })).toBe("3/3 ~/.secrets/zhipu-c")
  })

  test("ringLabel: the live position while active, the declared count before activation and under an external server", () => {
    const glm = registry().models.get("glm")!
    const plain = registry().models.get("plain")!
    expect(router().ringLabel(glm)).toBe("3")
    expect(router().ringLabel(plain)).toBe("0")
    router().activateRings(registry(), false)
    expect(router().ringLabel(glm)).toBe("1/3 ZHIPU_KEY_A")
    router().commitRotation(router().ringRotation("zhipuai", NOW)!)
    expect(router().ringLabel(glm)).toBe("2/3 ZHIPU_KEY_B")
    router().activateRings(registry(), true)
    expect(router().ringLabel(glm)).toBe("3")
  })

  test("the inactive note fires only for declared rings under an external server", () => {
    expect(router().ringInactiveNote()).toBeUndefined()
    router().activateRings(registry(), false)
    expect(router().ringInactiveNote()).toBeUndefined()
    router().activateRings(registry(), true)
    expect(router().ringInactiveNote()).toContain("key rings are inactive")
    // A registry without rings has nothing to be inactive about.
    router().activateRings(registry([entry("plain", { model: "other/plain" })]), true)
    expect(router().ringInactiveNote()).toBeUndefined()
  })
})

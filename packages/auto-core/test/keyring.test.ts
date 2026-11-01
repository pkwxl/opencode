// Key rings (plans/0055 §4.3, §6.4, §7 step 1; the order-first search of
// plans/0144, the hold marks and the new-session walk of plans/0163): the
// per-provider rings built from a registry, the in-memory position (moved
// only when a search lands — rotations searched from declared order, every
// new session walked the same order — and rewound by /failback), the key
// marks (a stated reset held to its instant, an unstated failure held the
// five-minute hold), the spawn config content (references only — no key
// value ever appears), the usable-key predicate of §6.2 rule 4, and the
// labels the logs show. The ring run state lives in the router service;
// every test reads the fresh instance the preload installed.
import { describe, expect, test } from "bun:test"
import { buildRings, ringKeyLabel, UNSTATED_KEY_HOLD_MS, type RingRotation } from "../src/keyring"
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
    router().commitRotation(rotation, NOW + UNSTATED_KEY_HOLD_MS)
    router().commitRotation(router().ringRotation("zhipuai", NOW)!, NOW + UNSTATED_KEY_HOLD_MS)
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

describe("rotation (plans/0144 D2, 0163 D1: the search is order-first; the position moves only when a search lands)", () => {
  const rotate = (provider = "zhipuai", now = NOW): RingRotation | undefined => {
    const search = router().ringRotation(provider, now)
    if (search?.to !== undefined) router().commitRotation(search, now + UNSTATED_KEY_HOLD_MS)
    return search
  }

  test("each search lands on the earliest declared key the run holds no evidence against; a refusal marks the current key and moves nothing", () => {
    router().activateRings(registry(), false)
    // From A: the search starts at index 0, skips A itself (the failure
    // being rotated away from) and lands on B.
    expect(rotate()?.to).toMatchObject({ index: 1, total: 3 })
    // From B: the search starts at index 0 again — A carries the hold of
    // its own failure and is passed over, so C lands.
    expect(rotate()?.to).toMatchObject({ index: 2, total: 3 })
    // From C: A and B are both held and the search refuses to land;
    // applying the refusal writes C's failure and the position stays.
    const refusal = router().ringRotation("zhipuai", NOW)!
    expect(refusal.to).toBeUndefined()
    router().commitRotation(refusal, NOW + UNSTATED_KEY_HOLD_MS)
    expect(router().isKeyDown("zhipuai", KEY_C.ref, NOW)).toBe(true)
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_C.ref)
    // Past the holds the order-first search lands back on A — a recovered
    // earlier key is re-preferred the moment a rotation fires at all.
    expect(rotate("zhipuai", NOW + UNSTATED_KEY_HOLD_MS + 1)?.to).toMatchObject({ index: 0, total: 3 })
  })

  test("an unstated failure holds its key for the five-minute hold, no longer", () => {
    router().activateRings(registry(), false)
    router().commitRotation(router().ringRotation("zhipuai", NOW)!, NOW + UNSTATED_KEY_HOLD_MS)
    expect(router().keyDownMark("zhipuai", KEY_A.ref)).toEqual({ until: NOW + UNSTATED_KEY_HOLD_MS })
    expect(router().isKeyDown("zhipuai", KEY_A.ref, NOW)).toBe(true)
    // Deciding a search mutates nothing: a decided-but-uncommitted search
    // stays replayable, the mark standing to its instant.
    const second = router().ringRotation("zhipuai", NOW)!
    expect(second.to).toMatchObject({ index: 2, total: 3 })
    expect(router().isKeyDown("zhipuai", KEY_A.ref, NOW)).toBe(true)
    expect(router().isKeyDown("zhipuai", KEY_A.ref, NOW + UNSTATED_KEY_HOLD_MS)).toBe(false)
  })

  test("an `until` mark holds its key to the stated instant, then the order-first search lands on it", () => {
    router().activateRings(registry(), false)
    // B's failure stated a reset an hour out: a rotation from A passes B
    // (evidence, not a guess) and lands on C, A's own failure stated two
    // hours.
    router().markKeyDown("zhipuai", KEY_B.ref, NOW + 3_600_000)
    const held = router().ringRotation("zhipuai", NOW)!
    expect(held.to).toMatchObject({ index: 2, total: 3 })
    router().commitRotation(held, NOW + 7_200_000)
    // Past B's instant B is eligible again, and the next search starts at
    // declared order: A still held (two hours), B lands.
    const released = router().ringRotation("zhipuai", NOW + 3_600_001)!
    expect(released.to).toMatchObject({ index: 1, total: 3 })
    router().commitRotation(released, NOW + UNSTATED_KEY_HOLD_MS)
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_B.ref)
  })

  test("a boundary clear moves nothing: the position stays, key state survives, and the next rotation's search decides", () => {
    router().activateRings(registry(), false)
    router().commitRotation(router().ringRotation("zhipuai", NOW)!, NOW + UNSTATED_KEY_HOLD_MS)
    router().commitRotation(router().ringRotation("zhipuai", NOW)!, NOW + 7_200_000)
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_C.ref)
    // A scope boundary clears model marks only (plans/0144 D1, 0163 D1) —
    // the key state is not boundary state, and nothing rewinds the
    // position without a search landing (§6.4's restart-churn floor).
    router().clearDownMarks("task", "task")
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_C.ref)
    expect(router().spawnKeyConfig()).toEqual({
      provider: { zhipuai: { options: { apiKey: "{file:/home/op/.secrets/zhipu-c}", headerTimeout: 1_200_000, chunkTimeout: 1_200_000 } } },
    })
    // The next rotation's order-first search lands on A — its hold has
    // passed, B's stated reset stands.
    expect(rotate("zhipuai", NOW + UNSTATED_KEY_HOLD_MS + 1)?.to).toMatchObject({ index: 0, total: 3 })
  })

  test("a held key is skipped: rotation lands on the next key with no evidence against it", () => {
    router().activateRings(registry(), false)
    // Key B held out-of-band (a stated reset, say): a failure of key A
    // skips straight to key C.
    router().markKeyDown("zhipuai", KEY_B.ref, NOW + 3_600_000)
    expect(router().ringRotation("zhipuai", NOW)?.to).toMatchObject({ index: 2, total: 3 })
  })

  test("rotation mutates nothing until committed: deciding leaves the key state and the position alone", () => {
    router().activateRings(registry(), false)
    const rotation = router().ringRotation("zhipuai", NOW)
    expect(rotation).toBeDefined()
    expect(router().keyDownMark("zhipuai", KEY_A.ref)).toBeUndefined()
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_A.ref)
    router().commitRotation(rotation!, NOW + UNSTATED_KEY_HOLD_MS)
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
    expect(router().ringRotation("other", NOW)).toBeUndefined()
    router().activateRings(registry(), true)
    expect(router().ringRotation("zhipuai", NOW)).toBeUndefined()
    expect(freshRouter().ringRotation("zhipuai", NOW)).toBeUndefined()
  })
})

describe("the new-session walk (plans/0163 D2)", () => {
  test("a passed hold on an earlier key walks the ring back: decide mutates nothing, commit moves the position alone and the spawn config names the landed key", () => {
    router().activateRings(registry(), false)
    // A failed unstated (held five minutes) and the rotation landed on B.
    router().commitRotation(router().ringRotation("zhipuai", NOW)!, NOW + UNSTATED_KEY_HOLD_MS)
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_B.ref)
    // Before the hold passes the walk answers nothing — the session stays
    // on B, no restart.
    expect(router().ringWalk("zhipuai", NOW)).toBeUndefined()
    // Past the instant the walk lands back on A — the current key included
    // in the search, nothing failed, the maintainer's "every new session
    // tries the keys in order".
    const walk = router().ringWalk("zhipuai", NOW + UNSTATED_KEY_HOLD_MS + 1)!
    expect(walk.from).toMatchObject({ index: 1, total: 3 })
    expect(walk.to).toMatchObject({ index: 0, total: 3 })
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_B.ref)
    router().commitWalk(walk)
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_A.ref)
    expect(router().spawnKeyConfig()).toEqual({
      provider: { zhipuai: { options: { apiKey: "{env:ZHIPU_KEY_A}", headerTimeout: 1_200_000, chunkTimeout: 1_200_000 } } },
    })
    // The walk wrote no mark: the from key did not fail.
    expect(router().keyDownMark("zhipuai", KEY_B.ref)).toBeUndefined()
  })

  test("a key with no mark never triggers a walk: the probe's cleared ring stays on the current key; a still-held earlier key walks nowhere either", () => {
    router().activateRings(registry(), false)
    // Rotate to B (A held), then the recovery probe clears the provider's
    // marks: every key unmarked — the probe's session must test the
    // current key, not walk.
    router().commitRotation(router().ringRotation("zhipuai", NOW)!, NOW + 3_600_000)
    router().clearRingMarks("zhipuai")
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_B.ref)
    expect(router().ringWalk("zhipuai", NOW + 7_200_000)).toBeUndefined()
    // A still-held earlier key (a stated reset) does not walk.
    router().markKeyDown("zhipuai", KEY_A.ref, NOW + 7_200_000)
    expect(router().ringWalk("zhipuai", NOW)).toBeUndefined()
    // The recovered key being the current one answers nothing — the ring
    // already stands where the walk would land.
    router().markKeyDown("zhipuai", KEY_B.ref, NOW + UNSTATED_KEY_HOLD_MS)
    expect(router().ringWalk("zhipuai", NOW + UNSTATED_KEY_HOLD_MS + 1)).toBeUndefined()
    // No ring, an unknown provider, inactive rings and unactivated rings
    // answer nothing.
    expect(router().ringWalk("other", NOW)).toBeUndefined()
    router().activateRings(registry(), true)
    expect(router().ringWalk("zhipuai", NOW)).toBeUndefined()
    expect(freshRouter().ringWalk("zhipuai", NOW)).toBeUndefined()
  })
})

describe("the usable-key predicate (§6.2 rule 4)", () => {
  test("a ring with a key that is not excluded is usable; an exhausted ring is not; the probe's clear restores it", () => {
    router().activateRings(registry(), false)
    expect(router().ringHasUsableKey("zhipuai", NOW)).toBe(true)
    for (const key of [KEY_A, KEY_B, KEY_C]) router().markKeyDown("zhipuai", key.ref, NOW + 3_600_000)
    expect(router().ringHasUsableKey("zhipuai", NOW)).toBe(false)
    // Not a boundary clear — key state never clears at one (plans/0144 D1,
    // 0163 D1); the recovery probe's wholesale clear is what restores the
    // ring (and past the marks' instants they age out by themselves).
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
    // Two rotations deep (position C), a stated reset holding B, a hold on A.
    router().commitRotation(router().ringRotation("zhipuai", NOW)!, NOW + UNSTATED_KEY_HOLD_MS)
    router().commitRotation(router().ringRotation("zhipuai", NOW)!, NOW + UNSTATED_KEY_HOLD_MS)
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

  test("a late classifier reset extends an existing mark; no state reads false", () => {
    router().activateRings(registry(), false)
    // An unstated failure held B five minutes; the classifier's resetAt
    // arrives after the turn ended — the fact replaces the guess.
    router().markKeyDown("zhipuai", KEY_B.ref, NOW + UNSTATED_KEY_HOLD_MS)
    expect(router().extendKeyDownMark("zhipuai", KEY_B.ref, NOW + 3_600_000)).toBe(true)
    expect(router().keyDownMark("zhipuai", KEY_B.ref)).toEqual({ until: NOW + 3_600_000 })
    expect(router().isKeyDown("zhipuai", KEY_B.ref, NOW + 3_600_000)).toBe(false)
    // A mark extends to a later instant; a key with no state at
    // all is not resurrected.
    expect(router().extendKeyDownMark("zhipuai", KEY_B.ref, NOW + 7_200_000)).toBe(true)
    expect(router().extendKeyDownMark("zhipuai", KEY_C.ref, NOW + 3_600_000)).toBe(false)
  })
})

describe("the recovery probe's ring half (§6.3)", () => {
  test("clearRingMarks clears the provider's key marks without moving the position; markCurrentKeyDown re-marks the key the probe ran on", () => {
    router().activateRings(registry(), false)
    router().commitRotation(router().ringRotation("zhipuai", NOW)!, NOW + 3_600_000)
    // The current key (B) and the tail (C) both fail: the ring is exhausted.
    router().markKeyDown("zhipuai", KEY_B.ref, NOW + 3_600_000)
    router().markKeyDown("zhipuai", KEY_C.ref, NOW + 3_600_000)
    expect(router().ringHasUsableKey("zhipuai", NOW)).toBe(false)
    router().clearRingMarks("zhipuai")
    expect(router().ringHasUsableKey("zhipuai", NOW)).toBe(true)
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_B.ref)
    router().markCurrentKeyDown("zhipuai", NOW + UNSTATED_KEY_HOLD_MS)
    expect(router().isKeyDown("zhipuai", KEY_B.ref, NOW)).toBe(true)
    // A provider without a ring and an unknown provider are no-ops.
    expect(() => router().clearRingMarks("other")).not.toThrow()
    expect(() => router().markCurrentKeyDown("other", NOW + UNSTATED_KEY_HOLD_MS)).not.toThrow()
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
    router().commitRotation(router().ringRotation("zhipuai", NOW)!, NOW + UNSTATED_KEY_HOLD_MS)
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

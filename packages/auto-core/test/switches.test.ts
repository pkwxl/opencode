import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test"
import {
  autoSwitches,
  formatSwitches,
  modelTypeProblems,
  nonDefaultSwitches,
  parseSwitches,
  RETIRED_SWITCHES,
  retiredSwitchNotes,
  setSwitchModelRegistry,
  SWITCH_ENV,
  type SwitchModelRegistry,
} from "../src/switches"

// The startup line reads the external server URL from the environment, so an
// ambient OPENCODE_AUTO_SERVER (a documented invocation shape, templates/
// README.md) must not leak into every expectation below — masked for the file,
// restored after (same pattern as test/agent-server.test.ts).
const ambientServer = process.env[SWITCH_ENV.server]
beforeAll(() => {
  delete process.env[SWITCH_ENV.server]
})
afterAll(() => {
  if (ambientServer !== undefined) process.env[SWITCH_ENV.server] = ambientServer
})

describe("parseSwitches (the experiment-switch environment layer)", () => {
  test("default combination: everything unset takes the defaults (fork on / digest / fine off / steer on / step off / stuck on / taskContext off / ask off / model off / strictResume off / hibernate unset)", () => {
    expect(parseSwitches({})).toEqual({
      fork: true,
      forkBase: "digest",
      fine: false,
      steer: true,
      step: "off",
      stuck: true,
      taskContext: "off",
      ask: false,
      model: { byLetter: {}, byType: {}, byRole: {}, fallback: [] },
      modelFailbackScope: "task",
      retryWaits: [0, 1, 2, 4, 8],
      recoveryWait: 30,
      strictResume: false,
      hibernate: undefined,
      agent: undefined,
      laneIsolation: false,
    })
  })

  test("an empty string counts as unset (all seventeen variables tested together)", () => {
    expect(
      parseSwitches({
        [SWITCH_ENV.fork]: "",
        [SWITCH_ENV.forkBase]: "",
        [SWITCH_ENV.fine]: "",
        [SWITCH_ENV.steer]: "",
        [SWITCH_ENV.step]: "",
        [SWITCH_ENV.stuck]: "",
        [SWITCH_ENV.taskContext]: "",
        [SWITCH_ENV.ask]: "",
        [SWITCH_ENV.model]: "",
        [SWITCH_ENV.modelFallback]: "",
        [SWITCH_ENV.modelFailbackScope]: "",
        [SWITCH_ENV.retryWaits]: "",
        [SWITCH_ENV.recoveryWait]: "",
        [SWITCH_ENV.strictResume]: "",
        [SWITCH_ENV.hibernate]: "",
        [SWITCH_ENV.agent]: "",
        [SWITCH_ENV.laneIsolation]: "",
      }),
    ).toEqual({
      fork: true,
      forkBase: "digest",
      fine: false,
      steer: true,
      step: "off",
      stuck: true,
      taskContext: "off",
      ask: false,
      model: { byLetter: {}, byType: {}, byRole: {}, fallback: [] },
      modelFailbackScope: "task",
      retryWaits: [0, 1, 2, 4, 8],
      recoveryWait: 30,
      strictResume: false,
      hibernate: undefined,
      agent: undefined,
      laneIsolation: false,
    })
  })

  test("valid values: every switch set explicitly", () => {
    expect(
      parseSwitches({
        [SWITCH_ENV.fork]: "off",
        [SWITCH_ENV.forkBase]: "session",
        [SWITCH_ENV.fine]: "on",
        [SWITCH_ENV.steer]: "on",
        [SWITCH_ENV.step]: "subtask",
        [SWITCH_ENV.stuck]: "off",
        [SWITCH_ENV.taskContext]: "large",
        [SWITCH_ENV.ask]: "on",
        [SWITCH_ENV.modelFailbackScope]: "subtask",
        [SWITCH_ENV.retryWaits]: "0,3",
        [SWITCH_ENV.recoveryWait]: "5",
        [SWITCH_ENV.strictResume]: "on",
        [SWITCH_ENV.hibernate]: "04:00+6",
        [SWITCH_ENV.agent]: "claude",
      }),
    ).toEqual({
      fork: false,
      forkBase: "session",
      fine: true,
      steer: true,
      step: "subtask",
      stuck: false,
      taskContext: "large",
      ask: true,
      model: { byLetter: {}, byType: {}, byRole: {}, fallback: [] },
      modelFailbackScope: "subtask",
      retryWaits: [0, 3],
      recoveryWait: 5,
      strictResume: true,
      hibernate: { startMin: 240, durationMin: 360 },
      agent: "claude",
      laneIsolation: false,
    })
  })

  test("explicitly setting the default values is equivalent to unset", () => {
    expect(
      parseSwitches({
        [SWITCH_ENV.fork]: "on",
        [SWITCH_ENV.steer]: "on",
        [SWITCH_ENV.fine]: "off",
        [SWITCH_ENV.forkBase]: "digest",
        [SWITCH_ENV.step]: "off",
        [SWITCH_ENV.stuck]: "on",
        [SWITCH_ENV.taskContext]: "off",
        [SWITCH_ENV.ask]: "off",
        [SWITCH_ENV.modelFailbackScope]: "task",
        [SWITCH_ENV.strictResume]: "off",
      }),
    ).toEqual(parseSwitches({}))
  })

  test("step value domain: phase/task/subtask all parse", () => {
    for (const value of ["phase", "task", "subtask"] as const) {
      expect(parseSwitches({ [SWITCH_ENV.step]: value }).step).toBe(value)
    }
  })

  test("taskContext value domain: small/medium/large all parse", () => {
    for (const value of ["small", "medium", "large"] as const) {
      expect(parseSwitches({ [SWITCH_ENV.taskContext]: value }).taskContext).toBe(value)
    }
  })

  test("modelFailbackScope value domain: phase/task/subtask/session all parse, default task (= the status quo)", () => {
    expect(parseSwitches({}).modelFailbackScope).toBe("task")
    for (const value of ["phase", "task", "subtask", "session"] as const) {
      expect(parseSwitches({ [SWITCH_ENV.modelFailbackScope]: value }).modelFailbackScope).toBe(value)
    }
  })

  test("ask value domain: on/off, default off (the question-policy switch, plans/0020-auto-resolve-design.md §E)", () => {
    expect(parseSwitches({}).ask).toBe(false)
    expect(parseSwitches({ [SWITCH_ENV.ask]: "on" }).ask).toBe(true)
    expect(parseSwitches({ [SWITCH_ENV.ask]: "off" }).ask).toBe(false)
    expect(parseSwitches({ [SWITCH_ENV.ask]: "" }).ask).toBe(false)
  })

  test("strictResume value domain: on/off, default off (the strict-resume switch, plans/0022-session-recovery-fidelity-design.md S3)", () => {
    expect(parseSwitches({}).strictResume).toBe(false)
    expect(parseSwitches({ [SWITCH_ENV.strictResume]: "on" }).strictResume).toBe(true)
    expect(parseSwitches({ [SWITCH_ENV.strictResume]: "off" }).strictResume).toBe(false)
    expect(parseSwitches({ [SWITCH_ENV.strictResume]: "" }).strictResume).toBe(false)
    expect(() => parseSwitches({ [SWITCH_ENV.strictResume]: "yes" })).toThrow(/OPENCODE_AUTO_STRICT_RESUME/)
    expect(() => parseSwitches({ [SWITCH_ENV.strictResume]: "yes" })).toThrow(/default off/)
  })

  test("agent: opencode (default) | claude, a shell profile overrides it (MA.5, plans/0041)", () => {
    expect(parseSwitches({}).agent).toBeUndefined()
    expect(parseSwitches({ [SWITCH_ENV.agent]: "opencode" }).agent).toBe("opencode")
    expect(nonDefaultSwitches(parseSwitches({ [SWITCH_ENV.agent]: "opencode" }))).toBe("OPENCODE_AUTO_AGENT=opencode")
    expect(parseSwitches({ [SWITCH_ENV.agent]: "claude" }).agent).toBe("claude")
    expect(nonDefaultSwitches(parseSwitches({ [SWITCH_ENV.agent]: "claude" }))).toBe("OPENCODE_AUTO_AGENT=claude")
    expect(() => parseSwitches({ [SWITCH_ENV.agent]: "codex" })).toThrow(/OPENCODE_AUTO_AGENT.*expected opencode\|claude/)
  })

  test("hibernate value domain: HH:MM+H (a daily UTC window, H may be fractional), default unset = no hibernation (plans/0027-hibernate-design.md)", () => {
    expect(parseSwitches({}).hibernate).toBeUndefined()
    expect(parseSwitches({ [SWITCH_ENV.hibernate]: "" }).hibernate).toBeUndefined()
    expect(parseSwitches({ [SWITCH_ENV.hibernate]: "04:00+6" }).hibernate).toEqual({ startMin: 240, durationMin: 360 })
    expect(parseSwitches({ [SWITCH_ENV.hibernate]: "22:00+8.5" }).hibernate).toEqual({ startMin: 1320, durationMin: 510 })
    expect(parseSwitches({ [SWITCH_ENV.hibernate]: "0:30+0.5" }).hibernate).toEqual({ startMin: 30, durationMin: 30 })
    // an invalid value: the error carries the variable name and the expected domain
    expect(() => parseSwitches({ [SWITCH_ENV.hibernate]: "4am+6" })).toThrow(/OPENCODE_AUTO_HIBERNATE/)
    expect(() => parseSwitches({ [SWITCH_ENV.hibernate]: "4am+6" })).toThrow(/HH:MM\+H/)
    expect(() => parseSwitches({ [SWITCH_ENV.hibernate]: "24:00+6" })).toThrow(/HH ∈ 00\.\.23/)
    expect(() => parseSwitches({ [SWITCH_ENV.hibernate]: "04:60+6" })).toThrow(/MM ∈ 00\.\.59/)
    expect(() => parseSwitches({ [SWITCH_ENV.hibernate]: "04:00+0" })).toThrow(/H ∈ \(0,24\)/)
    expect(() => parseSwitches({ [SWITCH_ENV.hibernate]: "04:00+24" })).toThrow(/H ∈ \(0,24\)/)
    expect(() => parseSwitches({ [SWITCH_ENV.hibernate]: "04:00-6" })).toThrow(/invalid value/)
  })

  test("retry ladder: a comma-separated minutes list, off = an empty list (no automatic retry)", () => {
    expect(parseSwitches({ [SWITCH_ENV.retryWaits]: "0,1,2,4,8" }).retryWaits).toEqual([0, 1, 2, 4, 8])
    expect(parseSwitches({ [SWITCH_ENV.retryWaits]: " 0 , 0.5 " }).retryWaits).toEqual([0, 0.5])
    expect(parseSwitches({ [SWITCH_ENV.retryWaits]: "off" }).retryWaits).toEqual([])
    expect(parseSwitches({ [SWITCH_ENV.recoveryWait]: "0" }).recoveryWait).toBe(0)
    expect(parseSwitches({ [SWITCH_ENV.recoveryWait]: "90" }).recoveryWait).toBe(90)
    expect(parseSwitches({ [SWITCH_ENV.recoveryWait]: "0.5" }).recoveryWait).toBe(0.5)
  })

  test("invalid values: the error carries the variable name and the expected domain", () => {
    expect(() => parseSwitches({ [SWITCH_ENV.fork]: "yes" })).toThrow(/OPENCODE_AUTO_FORK/)
    expect(() => parseSwitches({ [SWITCH_ENV.fork]: "yes" })).toThrow(/on\|off/)
    expect(() => parseSwitches({ [SWITCH_ENV.forkBase]: "hybrid" })).toThrow(/OPENCODE_AUTO_FORK_BASE/)
    expect(() => parseSwitches({ [SWITCH_ENV.forkBase]: "hybrid" })).toThrow(/session\|digest/)
    expect(() => parseSwitches({ [SWITCH_ENV.fine]: "1" })).toThrow(/OPENCODE_AUTO_DECOMPOSE_FINE/)
    expect(() => parseSwitches({ [SWITCH_ENV.steer]: "disable" })).toThrow(/OPENCODE_AUTO_STEER/)
    expect(() => parseSwitches({ [SWITCH_ENV.step]: "step" })).toThrow(/OPENCODE_AUTO_STEP/)
    expect(() => parseSwitches({ [SWITCH_ENV.step]: "Step" })).toThrow(/off\|phase\|task\|subtask/)
    expect(() => parseSwitches({ [SWITCH_ENV.stuck]: "1" })).toThrow(/OPENCODE_AUTO_STUCK/)
    expect(() => parseSwitches({ [SWITCH_ENV.stuck]: "1" })).toThrow(/default on/)
    expect(() => parseSwitches({ [SWITCH_ENV.taskContext]: "big" })).toThrow(/OPENCODE_AUTO_TASK_CONTEXT/)
    expect(() => parseSwitches({ [SWITCH_ENV.taskContext]: "big" })).toThrow(/off\|small\|medium\|large/)
    expect(() => parseSwitches({ [SWITCH_ENV.ask]: "ask" })).toThrow(/OPENCODE_AUTO_ASK/)
    expect(() => parseSwitches({ [SWITCH_ENV.ask]: "ask" })).toThrow(/on\|off/)
    expect(() => parseSwitches({ [SWITCH_ENV.ask]: "ask" })).toThrow(/default off/)
    expect(() => parseSwitches({ [SWITCH_ENV.modelFailbackScope]: "turn" })).toThrow(/OPENCODE_AUTO_MODEL_FAILBACK_SCOPE/)
    expect(() => parseSwitches({ [SWITCH_ENV.modelFailbackScope]: "turn" })).toThrow(/phase\|task\|subtask\|session/)
    expect(() => parseSwitches({ [SWITCH_ENV.modelFailbackScope]: "turn" })).toThrow(/default task/)
    expect(() => parseSwitches({ [SWITCH_ENV.retryWaits]: "1,-2" })).toThrow(/OPENCODE_AUTO_RETRY_WAITS/)
    expect(() => parseSwitches({ [SWITCH_ENV.retryWaits]: "1,,2" })).toThrow(/non-negative minutes/)
    expect(() => parseSwitches({ [SWITCH_ENV.retryWaits]: "soon" })).toThrow(/0,1,2,4,8/)
    expect(() => parseSwitches({ [SWITCH_ENV.recoveryWait]: "-1" })).toThrow(/OPENCODE_AUTO_RECOVERY_WAIT/)
    expect(() => parseSwitches({ [SWITCH_ENV.recoveryWait]: "soon" })).toThrow(/non-negative minutes/)
    // the message hints at the empty-string semantics and the default value
    expect(() => parseSwitches({ [SWITCH_ENV.steer]: "disable" })).toThrow(/empty string = unset/)
    expect(() => parseSwitches({ [SWITCH_ENV.step]: "1" })).toThrow(/default off/)
  })

  test("model case (1): empty string = the default empty policy (unset)", () => {
    expect(parseSwitches({ [SWITCH_ENV.model]: "" }).model).toEqual({ byLetter: {}, byType: {}, byRole: {}, fallback: [] })
  })

  test("model case (2): a bare prov/model value ⇒ the wildcard full override", () => {
    expect(parseSwitches({ [SWITCH_ENV.model]: "kimi/k2" }).model).toEqual({
      wildcard: "kimi/k2",
      byLetter: {},
      byType: {},
      byRole: {},
      fallback: [],
    })
  })

  test("model case (3): an entry list ⇒ wildcard/letter/role all filled (separator =, values may contain colons)", () => {
    expect(
      parseSwitches({
        [SWITCH_ENV.model]: "*=kimi/k2,m=anthropic/c-4,t=kimi/k2-lite,wrapup=kimi/k2-lite,decompose=anthropic/c-4",
      }).model,
    ).toEqual({
      wildcard: "kimi/k2",
      byLetter: { m: "anthropic/c-4", t: "kimi/k2-lite" },
      byType: {},
      byRole: { wrapup: "kimi/k2-lite", decompose: "anthropic/c-4" },
      fallback: [],
    })
  })

  test("model: the retired session role keys (verify-*/review-*/final-plan, plans/0044 D1) fail strictly as out-of-range keys", () => {
    for (const role of ["verify-judge", "verify-fix", "review-audit", "review-fixrun", "final-plan"]) {
      expect(() => parseSwitches({ [SWITCH_ENV.model]: `${role}=kimi/k2` })).toThrow(/invalid key/)
    }
  })

  test("model case (4): an out-of-range key ⇒ the error names the variable and the key", () => {
    expect(() => parseSwitches({ [SWITCH_ENV.model]: "X=kimi/k2" })).toThrow(/OPENCODE_AUTO_MODEL/)
    expect(() => parseSwitches({ [SWITCH_ENV.model]: "X=kimi/k2" })).toThrow(/invalid key/)
    expect(() => parseSwitches({ [SWITCH_ENV.model]: "X=kimi/k2" })).toThrow(/"X"/)
  })

  test("model type-id keys (M3.6): parsed into byType, checked against the loaded types by modelTypeProblems", () => {
    const model = parseSwitches({ [SWITCH_ENV.model]: "m=anthropic/c-4,implement=openai/g-5,security-review=kimi/k2" }).model
    expect(model.byLetter).toEqual({ m: "anthropic/c-4" })
    expect(model.byType).toEqual({ implement: "openai/g-5", "security-review": "kimi/k2" })
    expect(modelTypeProblems(model, ["implement", "security-review"])).toEqual([])
    const problems = modelTypeProblems(model, ["implement"])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('"security-review"')
    // The startup line renders the type keys between letters and roles
    expect(formatSwitches(parseSwitches({ [SWITCH_ENV.model]: "m=anthropic/c-4,implement=openai/g-5,wrapup=kimi/k2" }))).toContain(
      "OPENCODE_AUTO_MODEL=m=anthropic/c-4,implement=openai/g-5,wrapup=kimi/k2",
    )
  })

  test("model case (5): a value missing / ⇒ error", () => {
    expect(() => parseSwitches({ [SWITCH_ENV.model]: "*=kimik2" })).toThrow(/OPENCODE_AUTO_MODEL/)
    expect(() => parseSwitches({ [SWITCH_ENV.model]: "*=kimik2" })).toThrow(/invalid value/)
    // the bare form requires a slash too
    expect(() => parseSwitches({ [SWITCH_ENV.model]: "kimik2" })).toThrow(/invalid value/)
  })

  test("modelFallback: an ordered candidate list ⇒ the fallback array keeps the order", () => {
    expect(parseSwitches({ [SWITCH_ENV.modelFallback]: "kimi/k2,anthropic/c-4" }).model.fallback).toEqual([
      "kimi/k2",
      "anthropic/c-4",
    ])
    // empty string / unset = no failover (empty array)
    expect(parseSwitches({ [SWITCH_ENV.modelFallback]: "" }).model.fallback).toEqual([])
  })

  test("modelFallback: a bad value (missing /) ⇒ error", () => {
    expect(() => parseSwitches({ [SWITCH_ENV.modelFallback]: "kimi/k2,bad" })).toThrow(/OPENCODE_AUTO_MODEL_FALLBACK/)
    expect(() => parseSwitches({ [SWITCH_ENV.modelFallback]: "kimi/k2,bad" })).toThrow(/invalid value/)
  })
})

describe("nonDefaultSwitches / formatSwitches (the startup log)", () => {
  test("the default combination is silent: non-default items undefined; the full listing names all seventeen", () => {
    const defaults = parseSwitches({})
    expect(nonDefaultSwitches(defaults)).toBeUndefined()
    expect(formatSwitches(defaults)).toBe(
      "OPENCODE_AUTO_FORK=on, OPENCODE_AUTO_FORK_BASE=digest, OPENCODE_AUTO_DECOMPOSE_FINE=off, OPENCODE_AUTO_STEER=on, OPENCODE_AUTO_STEP=off, OPENCODE_AUTO_STUCK=on, OPENCODE_AUTO_TASK_CONTEXT=off, OPENCODE_AUTO_ASK=off, OPENCODE_AUTO_MODEL=, OPENCODE_AUTO_MODEL_FALLBACK=, OPENCODE_AUTO_MODEL_FAILBACK_SCOPE=task, OPENCODE_AUTO_RETRY_WAITS=0,1,2,4,8, OPENCODE_AUTO_RECOVERY_WAIT=30, OPENCODE_AUTO_STRICT_RESUME=off, OPENCODE_AUTO_HIBERNATE=, OPENCODE_AUTO_AGENT=, OPENCODE_AUTO_LANE_ISOLATION=off",
    )
  })

  test("non-default items listed one by one, defaults absent; the full listing always complete", () => {
    const changed = parseSwitches({ [SWITCH_ENV.fork]: "off", [SWITCH_ENV.fine]: "on" })
    expect(nonDefaultSwitches(changed)).toBe("OPENCODE_AUTO_FORK=off, OPENCODE_AUTO_DECOMPOSE_FINE=on")
    expect(formatSwitches(changed)).toBe(
      "OPENCODE_AUTO_FORK=off, OPENCODE_AUTO_FORK_BASE=digest, OPENCODE_AUTO_DECOMPOSE_FINE=on, OPENCODE_AUTO_STEER=on, OPENCODE_AUTO_STEP=off, OPENCODE_AUTO_STUCK=on, OPENCODE_AUTO_TASK_CONTEXT=off, OPENCODE_AUTO_ASK=off, OPENCODE_AUTO_MODEL=, OPENCODE_AUTO_MODEL_FALLBACK=, OPENCODE_AUTO_MODEL_FAILBACK_SCOPE=task, OPENCODE_AUTO_RETRY_WAITS=0,1,2,4,8, OPENCODE_AUTO_RECOVERY_WAIT=30, OPENCODE_AUTO_STRICT_RESUME=off, OPENCODE_AUTO_HIBERNATE=, OPENCODE_AUTO_AGENT=, OPENCODE_AUTO_LANE_ISOLATION=off",
    )
    const all = parseSwitches({ [SWITCH_ENV.forkBase]: "session", [SWITCH_ENV.steer]: "off" })
    expect(nonDefaultSwitches(all)).toBe("OPENCODE_AUTO_FORK_BASE=session, OPENCODE_AUTO_STEER=off")
    const stepped = parseSwitches({ [SWITCH_ENV.step]: "task" })
    expect(nonDefaultSwitches(stepped)).toBe("OPENCODE_AUTO_STEP=task")
    const unstuck = parseSwitches({ [SWITCH_ENV.stuck]: "off" })
    expect(nonDefaultSwitches(unstuck)).toBe("OPENCODE_AUTO_STUCK=off")
    const widened = parseSwitches({ [SWITCH_ENV.taskContext]: "medium" })
    expect(nonDefaultSwitches(widened)).toBe("OPENCODE_AUTO_TASK_CONTEXT=medium")
    const asking = parseSwitches({ [SWITCH_ENV.ask]: "on" })
    expect(nonDefaultSwitches(asking)).toBe("OPENCODE_AUTO_ASK=on")
    expect(formatSwitches(asking)).toContain("OPENCODE_AUTO_ASK=on")
    // model in effect: the routing entries reconstruct the env value in the stable wildcard→letter→role order; the failover candidates stand as their own item
    const routed = parseSwitches({ [SWITCH_ENV.model]: "*=kimi/k2,m=anthropic/c-4,decompose=anthropic/c-4" })
    expect(nonDefaultSwitches(routed)).toBe("OPENCODE_AUTO_MODEL=*=kimi/k2,m=anthropic/c-4,decompose=anthropic/c-4")
    const failed = parseSwitches({ [SWITCH_ENV.modelFallback]: "kimi/k2,anthropic/c-4" })
    expect(nonDefaultSwitches(failed)).toBe("OPENCODE_AUTO_MODEL_FALLBACK=kimi/k2,anthropic/c-4")
    // failback scope: default task is silent, a non-default scope stands as its own item
    const scoped = parseSwitches({ [SWITCH_ENV.modelFailbackScope]: "session" })
    expect(nonDefaultSwitches(scoped)).toBe("OPENCODE_AUTO_MODEL_FAILBACK_SCOPE=session")
    expect(formatSwitches(scoped)).toContain("OPENCODE_AUTO_MODEL_FAILBACK_SCOPE=session")
    const both = parseSwitches({ [SWITCH_ENV.model]: "kimi/k2", [SWITCH_ENV.modelFallback]: "b/y" })
    expect(nonDefaultSwitches(both)).toBe("OPENCODE_AUTO_MODEL=*=kimi/k2, OPENCODE_AUTO_MODEL_FALLBACK=b/y")
    // strict resume: default off is silent, on stands as its own item
    const strict = parseSwitches({ [SWITCH_ENV.strictResume]: "on" })
    expect(nonDefaultSwitches(strict)).toBe("OPENCODE_AUTO_STRICT_RESUME=on")
    expect(formatSwitches(strict)).toContain("OPENCODE_AUTO_STRICT_RESUME=on")
    // hibernate window: default unset is silent; once set it stands as its own item in the canonical HH:MM+H spelling
    const hibernating = parseSwitches({ [SWITCH_ENV.hibernate]: "4:00+6.5" })
    expect(nonDefaultSwitches(hibernating)).toBe("OPENCODE_AUTO_HIBERNATE=04:00+6.5")
    expect(formatSwitches(hibernating)).toContain("OPENCODE_AUTO_HIBERNATE=04:00+6.5")
    expect(formatSwitches(parseSwitches({}))).toContain("OPENCODE_AUTO_HIBERNATE=")
    // lane isolation (plans/0068 D10/S2): default off is silent, on stands as
    // its own item
    const isolated = parseSwitches({ [SWITCH_ENV.laneIsolation]: "on" })
    expect(isolated.laneIsolation).toBe(true)
    expect(nonDefaultSwitches(isolated)).toBe("OPENCODE_AUTO_LANE_ISOLATION=on")
    expect(() => parseSwitches({ [SWITCH_ENV.laneIsolation]: "maybe" })).toThrow(/OPENCODE_AUTO_LANE_ISOLATION/)
  })
})

describe("OPENCODE_AUTO_MODELS (the model registry's operator layer path)", () => {
  test("registered in SWITCH_ENV, but a path: parseSwitches ignores it and the switch lines never list it", () => {
    expect(SWITCH_ENV.models).toBe("OPENCODE_AUTO_MODELS")
    const withPath = parseSwitches({ [SWITCH_ENV.models]: "/srv/fleet/models.json" })
    expect(withPath).toEqual(parseSwitches({}))
    expect(nonDefaultSwitches(withPath)).toBeUndefined()
    expect(formatSwitches(withPath)).toBe(formatSwitches(parseSwitches({})))
    expect(formatSwitches(withPath)).not.toContain(SWITCH_ENV.models)
  })
})

describe("OPENCODE_AUTO_SERVER (the external opencode server URL)", () => {
  test("registered in SWITCH_ENV, but a URL: parseSwitches ignores it; the startup line names it when set", () => {
    expect(SWITCH_ENV.server).toBe("OPENCODE_AUTO_SERVER")
    const withUrl = parseSwitches({ [SWITCH_ENV.server]: "http://127.0.0.1:4096" })
    expect(withUrl).toEqual(parseSwitches({}))
    expect(nonDefaultSwitches(withUrl, { [SWITCH_ENV.server]: "http://127.0.0.1:4096" })).toBe(
      "OPENCODE_AUTO_SERVER=http://127.0.0.1:4096",
    )
    // Unset and empty count as unset: the line stays byte-identical to a run
    // that spawns its own server.
    expect(nonDefaultSwitches(parseSwitches({}), {})).toBeUndefined()
    expect(nonDefaultSwitches(parseSwitches({}), { [SWITCH_ENV.server]: "" })).toBeUndefined()
    // Beside the parsed switches' own non-default items, appended last.
    expect(nonDefaultSwitches(parseSwitches({ [SWITCH_ENV.step]: "task" }), { [SWITCH_ENV.server]: "http://127.0.0.1:4096" })).toBe(
      "OPENCODE_AUTO_STEP=task, OPENCODE_AUTO_SERVER=http://127.0.0.1:4096",
    )
    // The full listing stays complete without it: a URL is not a parsed switch.
    expect(formatSwitches(withUrl)).toBe(formatSwitches(parseSwitches({})))
    expect(formatSwitches(withUrl)).not.toContain(SWITCH_ENV.server)
  })
})

// OPENCODE_AUTO_MODEL under a model registry (plans/0055 §9 R7): a value is
// an internal model name or a raw provider/model string; an unknown bare
// name is a parse failure, and OPENCODE_AUTO_MODEL_FALLBACK is a usage error
// naming the tier lists. Without the registry facts the bare name keeps its
// old refusal and the fallback ring parses, byte for byte.
describe("model values under a model registry (plans/0055 §9 R7)", () => {
  const registry: SwitchModelRegistry = { names: new Set(["opus", "k3"]), tiers: "deep: opus, k3; simple: glm (not declared)" }
  const NAMES = "known internal names: opus, k3"

  test("a bare internal name parses, per key and as the wildcard", () => {
    expect(parseSwitches({ [SWITCH_ENV.model]: "opus" }, registry).model).toMatchObject({ wildcard: "opus" })
    expect(parseSwitches({ [SWITCH_ENV.model]: "wrapup=k3,m=opus" }, registry).model).toMatchObject({
      byRole: { wrapup: "k3" },
      byLetter: { m: "opus" },
    })
    // A raw provider/model string parses as before.
    expect(parseSwitches({ [SWITCH_ENV.model]: "zai/glm-4.6" }, registry).model.wildcard).toBe("zai/glm-4.6")
  })

  test("an unknown bare name is refused listing the known internal names", () => {
    expect(() => parseSwitches({ [SWITCH_ENV.model]: "kimik2" }, registry)).toThrow(/OPENCODE_AUTO_MODEL/)
    expect(() => parseSwitches({ [SWITCH_ENV.model]: "kimik2" }, registry)).toThrow(/internal model name/)
    expect(() => parseSwitches({ [SWITCH_ENV.model]: "kimik2" }, registry)).toThrow(new RegExp(NAMES))
    expect(() => parseSwitches({ [SWITCH_ENV.model]: "*=opus,wrapup=nope" }, registry)).toThrow(/"nope"/)
  })

  test("without the registry facts the bare name keeps today's refusal", () => {
    expect(() => parseSwitches({ [SWITCH_ENV.model]: "opus" })).toThrow(/bare value must be provider\/model with a slash/)
    expect(() => parseSwitches({ [SWITCH_ENV.model]: "*=opus" })).toThrow(/must be provider\/model with a slash/)
  })

  test("OPENCODE_AUTO_MODEL_FALLBACK under a registry is a usage error naming the tier lists", () => {
    expect(() => parseSwitches({ [SWITCH_ENV.modelFallback]: "kimi/k2" }, registry)).toThrow(/OPENCODE_AUTO_MODEL_FALLBACK/)
    expect(() => parseSwitches({ [SWITCH_ENV.modelFallback]: "kimi/k2" }, registry)).toThrow(
      /the tier lists are the failover order \(deep: opus, k3; simple: glm \(not declared\)\)/,
    )
    // Without a registry the ring parses exactly as before.
    expect(parseSwitches({ [SWITCH_ENV.modelFallback]: "kimi/k2" }).model.fallback).toEqual(["kimi/k2"])
  })

  test("setSwitchModelRegistry re-parses the memoized switches when the facts change", () => {
    const savedModel = process.env[SWITCH_ENV.model]
    process.env[SWITCH_ENV.model] = "opus"
    try {
      setSwitchModelRegistry(registry)
      expect(autoSwitches().model.wildcard).toBe("opus")
    } finally {
      // Restore the environment before dropping the registry facts, so the
      // re-parse that follows cannot hit the bare value without them.
      if (savedModel === undefined) delete process.env[SWITCH_ENV.model]
      else process.env[SWITCH_ENV.model] = savedModel
      setSwitchModelRegistry(undefined)
    }
    expect(autoSwitches().model).toEqual({ byLetter: {}, byType: {}, byRole: {}, fallback: [] })
  })
})

describe("the retired-switch registry (a removed mechanism's variable)", () => {
  const NAME = "OPENCODE_AUTO_REF_CHECK"

  test("the variable no longer parses: parseSwitches ignores it and the switch lines never list it", () => {
    const withRetired = parseSwitches({ [NAME]: "on" })
    expect(withRetired).toEqual(parseSwitches({}))
    expect(nonDefaultSwitches(withRetired)).toBeUndefined()
    expect(formatSwitches(withRetired)).toBe(formatSwitches(parseSwitches({})))
    expect(formatSwitches(withRetired)).not.toContain(NAME)
  })

  test("a set variable produces exactly one notice line; unset and empty stay silent", () => {
    expect(RETIRED_SWITCHES[NAME]).toBe("the reference check was removed")
    const note = `⚠ ${NAME} is retired (the reference check was removed); the variable is ignored`
    expect(retiredSwitchNotes({ [NAME]: "on" })).toEqual([note])
    // even a value the live grammar would have refused: the notice replaces the error
    expect(retiredSwitchNotes({ [NAME]: "1" })).toEqual([note])
    expect(retiredSwitchNotes({})).toEqual([])
    expect(retiredSwitchNotes({ [NAME]: "" })).toEqual([])
  })

  test("the switch-diet tranche-1 retirements: in-chain reuse and concurrent test handover", () => {
    const entries: Record<string, string> = {
      OPENCODE_AUTO_REUSE_SESSION: "in-chain session reuse was removed; every prompt opens a fresh session",
      OPENCODE_AUTO_HANDOVER_CONCURRENT: "concurrent test handover was removed; the tests run after the handover close-out",
    }
    for (const [name, reason] of Object.entries(entries)) {
      expect(RETIRED_SWITCHES[name]).toBe(reason)
      // The variable no longer parses and the switch lines never list it.
      const withRetired = parseSwitches({ [name]: "on" })
      expect(withRetired).toEqual(parseSwitches({}))
      expect(nonDefaultSwitches(withRetired)).toBeUndefined()
      expect(formatSwitches(withRetired)).toBe(formatSwitches(parseSwitches({})))
      expect(formatSwitches(withRetired)).not.toContain(name)
      // One notice per set variable, whatever the value; unset and empty stay silent.
      expect(retiredSwitchNotes({ [name]: "on" })).toEqual([`⚠ ${name} is retired (${reason}); the variable is ignored`])
      expect(retiredSwitchNotes({ [name]: "1" })).toEqual([`⚠ ${name} is retired (${reason}); the variable is ignored`])
      expect(retiredSwitchNotes({ [name]: "" })).toEqual([])
    }
  })

  test("autoSwitches prints the notice at the parse, beside the switch lines", () => {
    // Force a re-parse (the memo is process state) and scrub the ambient
    // OPENCODE_AUTO_* layer so the ⚙ line cannot join the capture.
    const ambient = Object.entries(process.env).filter(([key]) => key.startsWith("OPENCODE_AUTO_"))
    for (const [key] of ambient) delete process.env[key]
    process.env[NAME] = "on"
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "))
    })
    const registry: SwitchModelRegistry = { names: new Set(["opus"]), tiers: "deep: opus" }
    try {
      setSwitchModelRegistry(registry)
      autoSwitches()
    } finally {
      printed.mockRestore()
      delete process.env[NAME]
      setSwitchModelRegistry(undefined)
      for (const [key, value] of ambient) if (value !== undefined) process.env[key] = value
    }
    expect(lines).toEqual([`⚠ ${NAME} is retired (the reference check was removed); the variable is ignored`])
  })
})

describe("autoSwitches (memoized once, consistent across the whole pipeline)", () => {
  test("repeated calls return the same object", () => {
    expect(autoSwitches()).toBe(autoSwitches())
  })
})

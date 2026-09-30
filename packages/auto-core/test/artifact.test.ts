// Unit tests for src/artifact.ts: requireArtifact phase-step recovery (spec.step), the standalone unit gate (spec.unitStart), strict resume (STRICT_RESUME).
// Split out of test/runner.test.ts (plans/0024-module-split-plan.md S18, pure move).

import { beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { opencodeAgent } from "../src/agent/opencode/client"
import { requireArtifact } from "../src/artifact"
import { changedFiles, unitBaseline } from "../src/git"
import { readPlanInput, savePlanInput } from "../src/plan-input"
import { openStep, recallProgress, saveProgress } from "../src/resume"
import { parseSwitches, SWITCH_ENV } from "../src/switches"

// ---- Phase-step recovery points (requireArtifact spec.step: session recovery takes precedence over file-based derivation) ----

describe("requireArtifact phase-step recovery (spec.step)", () => {
  // Zero-wait ladder: this block only checks recovery-point semantics; retry backoff must not stretch it into minutes.
  const STEP_NO_WAIT = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.recoveryWait]: "0" })
  // Dedicated fake client: records the create count and each prompt's target
  // session; messages returns one real assistant turn (tokens > 0) so
  // sessionUsage judges it reusable rather than an error stub; the event
  // stream emits one idle for the "current session" (updated on create, kept
  // on reuse) so watch settles normally.
  function artifactClient(current?: string) {
    const state = { creates: 0, prompts: [] as string[], current }
    const sdk = {
      session: {
        create: async () => {
          state.creates++
          state.current = `ses_new_${state.creates}`
          return { data: { id: state.current } }
        },
        fork: async () => ({ data: { id: "ses_fork" } }),
        get: async (params: { sessionID: string }) => ({ data: { id: params.sessionID } }),
        update: async () => ({}),
        prompt: async (params: { sessionID: string }) => {
          state.prompts.push(params.sessionID)
          return {}
        },
        promptAsync: async () => ({}),
        abort: async () => ({}),
        messages: async () => ({
          data: [
            { info: { role: "user" } },
            { info: { role: "assistant", providerID: "kimi", modelID: "k2", tokens: { input: 5000, output: 200, reasoning: 0, cache: { read: 1000, write: 0 } } } },
          ],
        }),
      },
      provider: { list: async () => ({ data: { all: [] } }) },
      event: {
        subscribe: async () => ({
          stream: (async function* () {
            yield { type: "session.idle", properties: { sessionID: state.current } }
          })(),
        }),
      },
    } as unknown as OpencodeClient
    return { client: opencodeAgent(sdk), state, sdk }
  }

  const planTask = { id: "PLAN", title: "phase planning (m implementation)", status: "in_progress" as const, attempts: 0, body: "" }
  const spec = (reset: () => void) => ({
    kind: "phase planning",
    step: { step: "phase-plan" as const, unit: "R-01.P01" },
    artifact: "a filled-in PLAN.md",
    requirement: "write PLAN.md",
    reset: async () => {
      reset()
    },
    collect: async () => 4,
  })

  test("an open step record + a live session: reuse the original session, keep the artifact scene (no reset), prompt goes into the original session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-step-resume-"))
    try {
      await saveProgress(dir, { task: "PLAN", session: "ses_plan_old", at: 1, active: true, phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" } })
      const { client, state } = artifactClient("ses_plan_old")
      let resetCalled = false
      const value = await requireArtifact(client, planTask, "planning prompt", { dir }, spec(() => (resetCalled = true)))
      expect(value).toBe(4)
      expect(resetCalled).toBe(false) // reuse → keep the artifact scene, no reset
      expect(state.creates).toBe(0) // reuse, no new session
      expect(state.prompts).toEqual(["ses_plan_old"]) // prompt goes into the original session
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("no step record (fresh step): reset the artifact, open a new session, and write the active recovery point on dispatch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-step-fresh-"))
    try {
      const { client, state } = artifactClient()
      let resetCalled = false
      const value = await requireArtifact(client, planTask, "planning prompt", { dir }, spec(() => (resetCalled = true)))
      expect(value).toBe(4)
      expect(resetCalled).toBe(true)
      expect(state.creates).toBe(1)
      // The pseudo task PLAN carries a step phase → written on successful dispatch
      // (the earlier T- gating missed bypass sessions)
      const rec = await recallProgress(dir, "PLAN")
      expect(rec?.active).toBe(true)
      expect(rec?.session).toBe("ses_new_1")
      expect(rec?.phase).toEqual({ kind: "step", step: "phase-plan", unit: "R-01.P01" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("step record exists but the session is dead (get fails): no reuse, reset and open a new session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-step-dead-"))
    try {
      await saveProgress(dir, { task: "PLAN", session: "ses_dead", at: 1, active: true, phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" } })
      const { client, state, sdk } = artifactClient("ses_dead")
      ;(sdk as unknown as { session: { get: unknown } }).session.get = async () => ({ error: { name: "NotFound" } })
      let resetCalled = false
      const value = await requireArtifact(client, planTask, "planning prompt", { dir }, spec(() => (resetCalled = true)))
      expect(value).toBe(4)
      expect(resetCalled).toBe(true) // session not reusable → reset and redo
      expect(state.creates).toBe(1)
      expect(state.prompts).toEqual(["ses_new_1"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("spec.restart (plans/0053 D9): an open record with a live session is not reused; the step starts afresh", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-step-restart-"))
    try {
      await saveProgress(dir, { task: "PLAN", session: "ses_plan_old", at: 1, active: true, phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" } })
      const { client, state } = artifactClient("ses_plan_old")
      let resetCalled = false
      const value = await requireArtifact(client, planTask, "planning prompt", { dir }, { ...spec(() => (resetCalled = true)), restart: "the planning input changed" })
      expect(value).toBe(4)
      expect(resetCalled).toBe(true)
      expect(state.prompts).toEqual(["ses_new_1"])
      const rec = await recallProgress(dir, "PLAN")
      expect(rec?.session).toBe("ses_new_1")
      expect(rec?.active).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("retryable errors exhaust into the wait-and-probe loop: after recovery the step completes normally; a mid-way failure does not delete the step claim", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-step-retry-"))
    try {
      // The first three sessions (three attempts of the 0,0 ladder) all fail
      // with retryable errors → the ladder exhausts into the wait-and-probe
      // loop → the probe session (4th create) succeeds → the blank new
      // session re-dispatch (5th create) succeeds.
      const queue: unknown[] = []
      let seq = 0
      let n = 0
      const enqueue = (id: string) => {
        n++
        if (n <= 3) {
          queue.push({ type: "session.error", properties: { sessionID: id, error: { name: "APIError", data: { message: "net", isRetryable: true } } } })
        }
        queue.push({ type: "session.idle", properties: { sessionID: id } })
      }
      const client = opencodeAgent({
        session: {
          create: async () => {
            const id = `ses_new_${++seq}`
            enqueue(id)
            return { data: { id } }
          },
          fork: async () => {
            const id = `ses_fork_${++seq}`
            enqueue(id)
            return { data: { id } }
          },
          get: async (params: { sessionID: string }) => ({ data: { id: params.sessionID } }),
          update: async () => ({}),
          prompt: async () => ({}),
          promptAsync: async () => ({}),
          abort: async () => ({}),
          messages: async () => ({ data: [] }),
        },
        provider: { list: async () => ({ data: { all: [] } }) },
        event: { subscribe: async () => ({ stream: (async function* () { while (queue.length) yield queue.shift() })() }) },
      } as unknown as OpencodeClient)
      const result = await requireArtifact(client, planTask, "planning prompt", { dir }, spec(() => {}), STEP_NO_WAIT)
      expect(result).toBe(4)
      // A mid-way failure never deleted the step claim (openStep keeps the
      // step re-enterable throughout); the caller closes it out on success —
      // here we only verify the record still points at this step's session
      // lineage rather than being deleted.
      const open = await openStep(dir)
      expect(open?.step).toBe("phase-plan")
      expect(open?.unit).toBe("R-01.P01")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ---- requireArtifact standalone unit gate (spec.unitStart, plans/0021-commit-boundary-design.md) ----

describe("requireArtifact standalone unit gate (spec.unitStart)", () => {
  // Reuses the step-recovery block's fake client shape: single session + idle
  // settle, records create/prompt; produce drops a file within the session
  // turn (simulating the AI writing the artifact, giving the unified commit
  // something to commit).
  function unitClient(produce?: () => Promise<void>) {
    const state = { creates: 0, prompts: [] as string[] }
    const client = opencodeAgent({
      session: {
        create: async () => {
          state.creates++
          return { data: { id: `ses_new_${state.creates}` } }
        },
        fork: async () => ({ data: { id: "ses_fork" } }),
        get: async (params: { sessionID: string }) => ({ data: { id: params.sessionID } }),
        update: async () => ({}),
        prompt: async (params: { sessionID: string }) => {
          state.prompts.push(params.sessionID)
          return {}
        },
        promptAsync: async () => ({}),
        abort: async () => ({}),
        messages: async () => ({ data: [{ info: { role: "user" } }] }),
      },
      provider: { list: async () => ({ data: { all: [] } }) },
      event: {
        subscribe: async () => ({
          stream: (async function* () {
            if (produce) await produce()
            yield { type: "session.idle", properties: { sessionID: `ses_new_${state.creates}` } }
          })(),
        }),
      },
    } as unknown as OpencodeClient)
    return { client, state }
  }

  const planTask = { id: "PLAN", title: "knowledge distillation (k)", status: "in_progress" as const, attempts: 0, body: "" }
  const unitSpec = {
    kind: "knowledge distillation",
    unitStart: true,
    artifact: "a non-empty knowledge document",
    requirement: "write the document",
    collect: async () => "output",
  }

  async function git(dir: string, ...args: string[]) {
    const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    if (code !== 0) throw new Error(`git ${args.join(" ")} exit code ${code}: ${err || out}`)
    return out
  }

  test("dirty worktree before start (human edits) → dirty, no session opened", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-unit-gate-"))
    try {
      await git(dir, "init", "-q")
      await writeFile(join(dir, "human.txt"), "human leftover")
      const { client, state } = unitClient()
      const value = await requireArtifact(client, planTask, "distillation prompt", { dir }, unitSpec)
      expect(value).toEqual({ type: "dirty", files: ["human.txt"] })
      expect(state.creates).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("driver state file (phase index) left over → carryover self-heals, then the session opens and produces as usual", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-unit-gate-"))
    try {
      await git(dir, "init", "-q")
      await writeFile(join(dir, "seed.txt"), "s")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "seed")
      // Driver state left on disk by a failed previous commit: phase index only → self-healing backfill commit
      await mkdir(join(dir, "docs/R-01"), { recursive: true })
      await writeFile(join(dir, "docs/R-01/phases.md"), "- [ ] P01 implement\n")
      const { client, state } = unitClient()
      const value = await requireArtifact(client, planTask, "distillation prompt", { dir }, unitSpec)
      expect(value).toBe("output")
      expect(state.creates).toBe(1)
      const log = await git(dir, "log", "--pretty=%B")
      expect(log).toContain("Auto-Stage: carryover")
      // .auto/ runtime state (stats) is not managed content; with it excluded the worktree should be clean
      expect((await changedFiles(dir)).filter((file) => !file.startsWith(".auto/"))).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("spec.commit commit failure (pre-commit rejects) → blocked, not considered complete", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-unit-gate-"))
    try {
      await git(dir, "init", "-q")
      await mkdir(join(dir, "hooks"))
      await writeFile(join(dir, "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 })
      // Commit the hook script itself first (keeping the worktree clean), then enable hooksPath so later commits fail
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "hooks")
      await git(dir, "config", "core.hooksPath", "hooks")
      const { client } = unitClient(async () => {
        await writeFile(join(dir, "kb.md"), "knowledge")
      })
      const value = await requireArtifact(client, planTask, "distillation prompt", { dir }, {
        ...unitSpec,
        commit: { stage: "knowledge", subject: "PLAN knowledge distillation" },
      })
      expect(typeof value === "object" && "type" in value && value.type).toBe("blocked")
      if (typeof value === "object" && "type" in value && value.type === "blocked") {
        expect(value.question).toContain("unified commit failed")
        expect(value.question).toContain("not considered complete")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("recovery reusing the original session (live step record) is exempt from the clean check: the dirty artifact scene continues as usual", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-unit-gate-"))
    try {
      await git(dir, "init", "-q")
      // Half-done artifact + active step record + live session → reuse and continue instead of a dirty block
      await writeFile(join(dir, "docs-kb.md"), "half-done artifact")
      await saveProgress(dir, { task: "PLAN", session: "ses_alive", at: 1, active: true, phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" } })
      const state = { creates: 0, prompts: [] as string[] }
      const client = opencodeAgent({
        session: {
          create: async () => {
            state.creates++
            return { data: { id: `ses_new_${state.creates}` } }
          },
          fork: async () => ({ data: { id: "ses_fork" } }),
          get: async (params: { sessionID: string }) => ({ data: { id: params.sessionID } }),
          update: async () => ({}),
          prompt: async (params: { sessionID: string }) => {
            state.prompts.push(params.sessionID)
            return {}
          },
          promptAsync: async () => ({}),
          abort: async () => ({}),
          messages: async () => ({
            data: [
              { info: { role: "user" } },
              { info: { role: "assistant", providerID: "kimi", modelID: "k2", tokens: { input: 5000, output: 200, reasoning: 0, cache: { read: 1000, write: 0 } } } },
            ],
          }),
        },
        provider: { list: async () => ({ data: { all: [] } }) },
        event: {
          subscribe: async () => ({
            stream: (async function* () {
              yield { type: "session.idle", properties: { sessionID: "ses_alive" } }
            })(),
          }),
        },
      } as unknown as OpencodeClient)
      const value = await requireArtifact(client, planTask, "continuation prompt", { dir }, {
        ...unitSpec,
        step: { step: "phase-plan", unit: "R-01.P01" },
      })
      expect(value).toBe("output")
      expect(state.prompts).toEqual(["ses_alive"]) // reuses the original session; no fork over the dirty area
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("requireArtifact strict resume (OPENCODE_AUTO_STRICT_RESUME + unit baseline/model check)", () => {
  // Injected switches: strict resume on + model routing (strict resume requires
  // the record to carry the effective model; without routing configured nothing
  // is ever reused) + the zero-wait retry ladder (this block only checks the
  // recovery criteria; backoff must not stretch it into minutes).
  const STRICT = parseSwitches({
    [SWITCH_ENV.strictResume]: "on",
    [SWITCH_ENV.model]: "*=kimi/k2",
    [SWITCH_ENV.retryWaits]: "0,0",
    [SWITCH_ENV.recoveryWait]: "0",
  })
  const LOOSE = parseSwitches({
    [SWITCH_ENV.model]: "*=kimi/k2",
    [SWITCH_ENV.retryWaits]: "0,0",
    [SWITCH_ENV.recoveryWait]: "0",
  })


  async function git(dir: string, ...args: string[]) {
    const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    if (code !== 0) throw new Error(`git ${args.join(" ")} exit code ${code}: ${err || out}`)
    return out
  }

  // A temp repository with a recorded phase-step recovery point: seed commit + active step record (baseline/model given by the arguments).
  async function seeded(record: { model?: string; withBaseline?: boolean } = {}) {
    const dir = await mkdtemp(join(tmpdir(), "auto-strict-resume-"))
    await git(dir, "init", "-q")
    await writeFile(join(dir, "seed.txt"), "s")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "seed")
    const baseline = await unitBaseline(dir)
    await saveProgress(dir, {
      task: "PLAN",
      session: "ses_plan_old",
      at: 1,
      active: true,
      phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" },
      ...(record.withBaseline === false ? {} : { baseline }),
      ...(record.model === undefined ? {} : { model: record.model }),
    })
    return { dir, head: (await git(dir, "rev-parse", "--short", "HEAD")).trim() }
  }

  function stepClient(current?: string, alive = true) {
    const state = { creates: 0, prompts: [] as string[], current }
    const client = opencodeAgent({
      session: {
        create: async () => {
          state.creates++
          state.current = `ses_new_${state.creates}`
          return { data: { id: state.current } }
        },
        fork: async () => ({ data: { id: "ses_fork" } }),
        get: async (params: { sessionID: string }) => (alive ? { data: { id: params.sessionID } } : { error: { name: "NotFound" } }),
        update: async () => ({}),
        prompt: async (params: { sessionID: string }) => {
          state.prompts.push(params.sessionID)
          return {}
        },
        promptAsync: async () => ({}),
        abort: async () => ({}),
        messages: async () => ({
          data: [
            { info: { role: "user" } },
            { info: { role: "assistant", providerID: "kimi", modelID: "k2", tokens: { input: 5000, output: 200, reasoning: 0, cache: { read: 1000, write: 0 } } } },
          ],
        }),
      },
      provider: { list: async () => ({ data: { all: [] } }) },
      event: {
        subscribe: async () => ({
          stream: (async function* () {
            yield { type: "session.idle", properties: { sessionID: state.current } }
          })(),
        }),
      },
    } as unknown as OpencodeClient)
    return { client, state }
  }

  const planTask = { id: "PLAN", title: "phase planning (m implementation)", status: "in_progress" as const, attempts: 0, body: "" }
  const spec = (reset: () => void) => ({
    kind: "phase planning",
    step: { step: "phase-plan" as const, unit: "R-01.P01" },
    artifact: "a filled-in PLAN.md",
    requirement: "write PLAN.md",
    reset: async () => {
      reset()
    },
    collect: async () => 4,
  })

  test("intact baseline + matching model + live session → reuse the original session, keep the artifact scene", async () => {
    const { dir } = await seeded({ model: "kimi/k2" })
    try {
      const { client, state } = stepClient("ses_plan_old")
      let resetCalled = false
      expect(await requireArtifact(client, planTask, "planning prompt", { dir }, spec(() => (resetCalled = true)), STRICT)).toBe(4)
      expect(resetCalled).toBe(false)
      expect(state.creates).toBe(0)
      expect(state.prompts).toEqual(["ses_plan_old"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("model mismatch → roll back to the unit baseline (scene goes into a stash), then open a new session to redo the step", async () => {
    const { dir, head } = await seeded({ model: "kimi/old" })
    try {
      const { client, state } = stepClient("ses_plan_old")
      let resetCalled = false
      expect(await requireArtifact(client, planTask, "planning prompt", { dir }, spec(() => (resetCalled = true)), STRICT)).toBe(4)
      expect(resetCalled).toBe(true)
      expect(state.creates).toBe(1)
      expect(state.prompts).toEqual(["ses_new_1"])
      expect((await git(dir, "rev-parse", "--short", "HEAD")).trim()).toBe(head)
      expect(await git(dir, "stash", "list")).toContain("auto-rollback")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("original session dead → same rollback then redo (no continuing on a foreign dirty area)", async () => {
    const { dir } = await seeded({ model: "kimi/k2" })
    try {
      const { client, state } = stepClient("ses_plan_old", false)
      let resetCalled = false
      expect(await requireArtifact(client, planTask, "planning prompt", { dir }, spec(() => (resetCalled = true)), STRICT)).toBe(4)
      expect(resetCalled).toBe(true)
      expect(state.creates).toBe(1)
      expect(await git(dir, "stash", "list")).toContain("auto-rollback")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("external commits since the baseline → dirty for a human (no rollback, no session)", async () => {
    const { dir } = await seeded({ model: "kimi/k2" })
    try {
      await writeFile(join(dir, "human.txt"), "human edit")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "human commit")
      const { client, state } = stepClient("ses_plan_old")
      const value = await requireArtifact(client, planTask, "planning prompt", { dir }, spec(() => {}), STRICT)
      expect(typeof value === "object" && "type" in value && value.type).toBe("dirty")
      expect(state.creates).toBe(0)
      expect(await git(dir, "stash", "list")).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("old record from before strict resume was enabled (no baseline) → neither reuse nor rollback; open a new session to redo", async () => {
    const { dir } = await seeded({ withBaseline: false })
    try {
      const { client, state } = stepClient("ses_plan_old")
      let resetCalled = false
      expect(await requireArtifact(client, planTask, "planning prompt", { dir }, spec(() => (resetCalled = true)), STRICT)).toBe(4)
      expect(resetCalled).toBe(true)
      expect(state.creates).toBe(1)
      expect(await git(dir, "stash", "list")).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("switch default off: a record without the strict fields is still reused under the existing semantics (status-quo equivalent)", async () => {
    // A loose run writes no model into the record; nothing is checked, the
    // session reuses.
    const { dir } = await seeded({})
    try {
      const { client, state } = stepClient("ses_plan_old")
      let resetCalled = false
      expect(await requireArtifact(client, planTask, "planning prompt", { dir }, spec(() => (resetCalled = true)), LOOSE)).toBe(4)
      expect(resetCalled).toBe(false)
      expect(state.creates).toBe(0)
      expect(state.prompts).toEqual(["ses_plan_old"])
      expect(await git(dir, "stash", "list")).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a record naming a model this run's registry does not know is dead even with strict off (the registry form: the implicit registry judges records like every registry)", async () => {
    const { dir } = await seeded({ model: "kimi/old" })
    try {
      const { client, state } = stepClient("ses_plan_old")
      let resetCalled = false
      expect(await requireArtifact(client, planTask, "planning prompt", { dir }, spec(() => (resetCalled = true)), LOOSE)).toBe(4)
      expect(resetCalled).toBe(true)
      expect(state.creates).toBe(1)
      expect(await git(dir, "stash", "list")).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("spec.role reaches the model check (plans/0053 D12): an m-mode planning record routed under implement-scan is reused", async () => {
    // The dispatch routed by the explicit role (roleOf), so the recorded model
    // is implement-scan's; derived from the step alone, the check would expect
    // phase-plan's model, report a mismatch and roll back.
    const routed = parseSwitches({
      [SWITCH_ENV.strictResume]: "on",
      [SWITCH_ENV.model]: "implement-scan=kimi/scan,*=kimi/k2",
      [SWITCH_ENV.retryWaits]: "0,0",
      [SWITCH_ENV.recoveryWait]: "0",
    })
    const { dir } = await seeded({ model: "kimi/scan" })
    try {
      const { client, state } = stepClient("ses_plan_old")
      let resetCalled = false
      const value = await requireArtifact(client, planTask, "planning prompt", { dir }, { ...spec(() => (resetCalled = true)), role: "implement-scan" }, routed)
      expect(value).toBe(4)
      expect(resetCalled).toBe(false)
      expect(state.creates).toBe(0)
      expect(state.prompts).toEqual(["ses_plan_old"])
      expect(await git(dir, "stash", "list")).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("spec.restart after a planning-input commit: no rollback, the input commit stays, a new session plans (plans/0053 D9)", async () => {
    const { dir } = await seeded({ model: "kimi/k2" })
    try {
      await git(dir, "config", "user.email", "t@t")
      await git(dir, "config", "user.name", "t")
      await writeFile(join(dir, ".gitignore"), ".auto/\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "ignore .auto", "-m", "Auto-Stage: housekeeping")
      // The recorded baseline predates the input commit: a rollback to it
      // would reset past the commit and stash the input away.
      const phase = { round: "R-01", id: "P01", dir: join("docs", "R-01", "P01-implement") }
      expect(await savePlanInput(dir, phase, { text: "A changed input." }, "P01-implement Implementation")).toEqual({ type: "saved" })
      const head = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      const { client, state } = stepClient("ses_plan_old")
      let resetCalled = false
      const value = await requireArtifact(
        client,
        planTask,
        "planning prompt",
        { dir },
        { ...spec(() => (resetCalled = true)), unitStart: true, restart: "the planning input changed" },
        STRICT,
      )
      expect(value).toBe(4)
      expect(resetCalled).toBe(true)
      expect(state.prompts).toEqual(["ses_new_1"])
      expect((await git(dir, "rev-parse", "--short", "HEAD")).trim()).toBe(head)
      expect(await git(dir, "stash", "list")).toBe("")
      expect(await readPlanInput(dir, phase)).toBe("A changed input.\n")
      expect(await changedFiles(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

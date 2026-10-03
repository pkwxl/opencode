// Ondemand context handover (plans/0056): the one post-session decision both
// execution scopes run — the ondemand-handover engine handoverVerdict in
// src/execute.ts (D4, plans/0069 §2.2), parameterized by retry policy:
// executeWhole's "fresh" (the retry re-sends the full whole-task prompt) and
// runSubtask's stream "fork" (the retry demands the document in a fork of the
// ended session with the feedback alone). A fresh handoff.md (differing from
// what the dispatch was seeded with) is honored whatever the usage figure —
// the session handed itself over at a natural boundary; a document the
// session did not touch means a natural finish; the hard-wall path (the hint
// in watch + the usage figure) still demands the document. The notices and
// the wall clamp of watch are covered in test/agent-fake.test.ts, the steer
// construction in test/testrun.test.ts.

import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SessionChain } from "../src/chain"
import { executeWhole, runSubtask } from "../src/execute"
import { noCommitGit } from "../src/git-ops"
import { clampSwitches } from "../src/switches"
import { ev, fakeAgent, MODEL, type TurnScript } from "./fixtures/agent"
import { planOf } from "./fixtures/units"

// The fake's default turn measures 1000 tokens — far under the wall
// (min(max(2×64k budget, 100k window/4), 80%×100k window) = 80k), so a session
// that does not script a big figure runs quiet: no notices, no hint.
describe("executeWhole (ondemand self-directed handover)", () => {
  const setup = async (turn?: TurnScript, limits?: Record<string, number>) => {
    const dir = await mkdtemp(join(tmpdir(), "auto-ondemand-"))
    const plan = planOf(
      `## T-001: sample task [pending]
Body.
`,
      dir,
    )
    const agent = fakeAgent({ ...(turn ? { turn } : {}), ...(limits ? { limits } : {}) })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    // The fake session writes the handover document itself (the driver never
    // pre-creates it); the directory must exist for that write.
    const writeHandoff = (text: string) => {
      mkdirSync(join(dir, "docs", "T-001"), { recursive: true })
      writeFileSync(join(dir, "docs", "T-001", "handoff.md"), text)
    }
    return { dir, plan, task: plan.tasks[0]!, agent, chain, writeHandoff }
  }

  test("a fresh Status: continue document hands the session over under the wall; the continuation reads it, and a natural finish ends the loop", async () => {
    const { dir, plan, task, agent, chain, writeHandoff } = await setup((ctx) => {
      if (ctx.n === 1) writeHandoff("# Handover\n\nHalf done; next: the rest.\n\nStatus: continue\n")
      return undefined
    })
    try {
      expect(await executeWhole(agent.client, plan, task, { dir, git: noCommitGit() }, chain, true)).toBeUndefined()
      // Two sessions: the first handed itself over, the second continued from
      // the document and finished the task naturally.
      expect(agent.prompts).toHaveLength(2)
      expect(agent.prompts[0]!.text).toContain("Context-budget protocol")
      expect(agent.prompts[1]!.text).toContain("First read docs/T-001/handoff.md")
      // Under the wall all the way: no notices, no hard-wall hint.
      expect(agent.steers).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("no document written and no wall hit: a single natural session, nothing demanded", async () => {
    const { dir, plan, task, agent, chain } = await setup()
    try {
      expect(await executeWhole(agent.client, plan, task, { dir, git: noCommitGit() }, chain, true)).toBeUndefined()
      expect(agent.prompts).toHaveLength(1)
      expect(agent.steers).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("OPENCODE_AUTO_STEER=off: no protocol in the prompt, and a spontaneously written document is ignored — one session, natural finish", async () => {
    clampSwitches({ steer: false })
    const { dir, plan, task, agent, chain, writeHandoff } = await setup((ctx) => {
      if (ctx.n === 1) writeHandoff("# Handover\n\nStatus: continue\n")
      return undefined
    })
    try {
      expect(await executeWhole(agent.client, plan, task, { dir, git: noCommitGit() }, chain, true)).toBeUndefined()
      expect(agent.prompts).toHaveLength(1)
      expect(agent.prompts[0]!.text).not.toContain("Context-budget protocol")
      expect(agent.steers).toEqual([])
    } finally {
      clampSwitches({ steer: true })
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("over the wall: the hard-wall hint goes in once, and the post-session check demands the document (one retry with feedback)", async () => {
    const { dir, plan, task, agent, chain } = await setup((ctx) =>
      ctx.n === 1 ? [ev.message(ctx.session, "m_big", 90_000), ev.text(ctx.session, "t1", "still working"), ev.idle(ctx.session)] : undefined,
    )
    try {
      expect(await executeWhole(agent.client, plan, task, { dir, git: noCommitGit() }, chain, true)).toBeUndefined()
      // One steer only: the single measurement crossed the wall, so the hard-
      // wall hint went out and the notice bands were spent with it.
      expect(agent.steers).toHaveLength(1)
      expect(agent.steers[0]).toContain("reached the wall")
      // The first session ended without the document: one retry with the hard
      // requirement, then the quiet second session finishes naturally.
      expect(agent.prompts).toHaveLength(2)
      expect(agent.prompts[1]!.text).toContain("This is a hard requirement")
      // The fresh retry policy (D4): the whole-task prompt is re-sent whole
      // (the protocol section exists only in the full render) with the demand
      // appended — the demand never travels alone, and the ended session is
      // never forked for it.
      expect(agent.prompts[1]!.text).toContain("Context-budget protocol")
      expect(agent.prompts[1]!.text).not.toStartWith("The last time you ended the session")
      expect(agent.argsOf("fork")).toHaveLength(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a large window raises the wall (plans/0059 D6): a session finishing past the 2×cap budget but under a quarter of the window is a natural finish, nothing demanded", async () => {
    const { dir, plan, task, agent, chain } = await setup(
      (ctx) => (ctx.n === 1 ? [ev.message(ctx.session, "m_big", 150_000), ev.text(ctx.session, "t1", "all done"), ev.idle(ctx.session)] : undefined),
      { [MODEL]: 1_000_000 },
    )
    try {
      expect(await executeWhole(agent.client, plan, task, { dir, git: noCommitGit() }, chain, true)).toBeUndefined()
      // 150k is past the 128k budget but only 60% of the 250k wall: the 50%
      // notice, no hard-wall hint, and one session with no document demanded.
      expect(agent.steers).toHaveLength(1)
      expect(agent.steers[0]).toContain("wall 250.0k")
      expect(agent.prompts).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// The same engine's other retry policy (D4): a stream of auto's taken split
// (runSubtask with a split baseline) that hits the wall without a handover
// document is demanded in a fork of the ended session, with the feedback
// alone — the working context the document must summarize lives there. The
// no-commit git double keeps strict resume off (its records flag is false),
// so the rollback redo declines and the retry itself runs; the strict paths
// are the resume suites' subject, the end-to-end stream loop agent-fake's
// (test/agent-fake.test.ts:2960/:2995).
describe("runSubtask stream handover (the fork retry policy)", () => {
  test("a handover due with no document: the retry is the demand alone in a fork of the ended session; the quiet fork then finishes the stream", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-ondemand-"))
    try {
      const plan = planOf(`## T-001: sample task [pending]\nBody.\n`, dir)
      const agent = fakeAgent({
        turn: (ctx) =>
          ctx.n === 1
            ? [ev.message(ctx.session, "m_big", 90_000), ev.text(ctx.session, "t1", "still working"), ev.idle(ctx.session)]
            : undefined,
      })
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const text = "runs stream T-001.S01"
      // split = [] marks a stream of a taken split (the steer is built for
      // it); the no-commit double keeps the unit boundary off (no git repo).
      const result = await runSubtask(agent.client, plan, plan.tasks[0]!, text, 1, { dir, git: noCommitGit() }, chain, undefined, false, [])
      expect(result).toBeUndefined()
      // The hard-wall hint went out once: the first session crossed the wall.
      expect(agent.steers).toHaveLength(1)
      // The retry is the demand alone — the full subtask prompt is not re-sent
      // (the protocol section exists only in the full render) — and it names
      // the subtask, exactly what executeWhole's fresh retry does not do.
      expect(agent.prompts).toHaveLength(2)
      expect(agent.prompts[1]!.text).toStartWith("The last time you ended the session a handover was due")
      expect(agent.prompts[1]!.text).toContain("for this subtask")
      expect(agent.prompts[1]!.text).not.toContain("Context-budget protocol")
      // The demand went to a fork of the ended session (the fork policy's
      // dispatch), not a new session of the whole prompt.
      expect(agent.argsOf("fork")).toHaveLength(1)
      expect(agent.argsOf("fork")[0]![0]).toBe(agent.prompts[0]!.session)
      expect(agent.prompts[1]!.session).not.toBe(agent.prompts[0]!.session)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("without a split there is no steer and no handover protocol at all: a plain subtask session runs once and ends naturally", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-ondemand-"))
    try {
      const plan = planOf(`## T-001: sample task [pending]\nBody.\n`, dir)
      const agent = fakeAgent()
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const text = "a plain planned-pipeline subtask"
      const result = await runSubtask(agent.client, plan, plan.tasks[0]!, text, 1, { dir, git: noCommitGit() }, chain)
      expect(result).toBeUndefined()
      expect(agent.prompts).toHaveLength(1)
      expect(agent.prompts[0]!.text).not.toContain("Context-budget protocol")
      expect(agent.argsOf("fork")).toHaveLength(0)
      expect(agent.steers).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

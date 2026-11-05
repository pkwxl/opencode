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
import { createControl, ExitRequested } from "../src/exit"
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
      expect(await executeWhole(agent.client, plan, task, { dir, git: noCommitGit() }, chain)).toBeUndefined()
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

  // Freshness required for every due verdict (plans/0171 D3, enacting
  // S10-07): a due session is judged only by a document THIS session wrote.
  // Before the fix, the predecessor's consumed `Status: continue` satisfied
  // the due check — the phantom handover: the retry built for exactly this
  // never ran, and the continuation resumed from next steps two sessions old
  // while the log asserted a handover happened.
  test("a due session over the consumed document is the retry case, never a phantom handover", async () => {
    const { dir, plan, task, agent, chain, writeHandoff } = await setup((ctx) => {
      if (ctx.n === 1) {
        writeHandoff("# Handover\n\nHalf done; next: the rest.\n\nStatus: continue\n")
        return [ev.message(ctx.session, "m_big", 90_000), ev.text(ctx.session, "t1", "working"), ev.idle(ctx.session)]
      }
      if (ctx.n === 2) return [ev.message(ctx.session, "m2", 90_000), ev.text(ctx.session, "t2", "still going"), ev.idle(ctx.session)]
      return undefined
    })
    try {
      expect(await executeWhole(agent.client, plan, task, { dir, git: noCommitGit() }, chain)).toBeUndefined()
      // Session 1 handed itself over (its document fresh); session 2 was due
      // again and wrote nothing — the consumed document is not its handover,
      // so the demand goes out (the retry), and session 3 finishes quietly.
      expect(agent.prompts).toHaveLength(3)
      expect(agent.prompts[1]!.text).toContain("First read docs/T-001/handoff.md")
      expect(agent.prompts[2]!.text).toContain("This is a hard requirement")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // The retry re-arms on every accepted handover (plans/0171 D3): the
  // feedback promises one retry per handover, and a chain's later invalid
  // document gets its own — not a "failed twice" block on its first failure.
  test("the invalid-document retry re-arms after an accepted handover: a later failure retries instead of blocking as failed twice", async () => {
    const { dir, plan, task, agent, chain, writeHandoff } = await setup((ctx) => {
      if (ctx.n === 1) return [ev.message(ctx.session, "m1", 90_000), ev.text(ctx.session, "t1", "working"), ev.idle(ctx.session)]
      if (ctx.n === 2) {
        writeHandoff("# Handover\n\nHalf done; next: the rest.\n\nStatus: continue\n")
        return [ev.message(ctx.session, "m2", 90_000), ev.text(ctx.session, "t2", "continuing"), ev.idle(ctx.session)]
      }
      if (ctx.n === 3) return [ev.message(ctx.session, "m3", 90_000), ev.text(ctx.session, "t3", "again"), ev.idle(ctx.session)]
      return undefined
    })
    try {
      expect(await executeWhole(agent.client, plan, task, { dir, git: noCommitGit() }, chain)).toBeUndefined()
      // 1: due, no document → the first retry (retried spent). 2: due, a
      // fresh continue → accepted (the retry re-armed). 3: due, nothing →
      // its own retry, not a block. 4: quiet natural finish.
      expect(agent.prompts).toHaveLength(4)
      expect(agent.prompts[1]!.text).toContain("This is a hard requirement")
      expect(agent.prompts[2]!.text).toContain("First read docs/T-001/handoff.md")
      expect(agent.prompts[3]!.text).toContain("This is a hard requirement")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("no document written and no wall hit: a single natural session, nothing demanded", async () => {
    const { dir, plan, task, agent, chain } = await setup()
    try {
      expect(await executeWhole(agent.client, plan, task, { dir, git: noCommitGit() }, chain)).toBeUndefined()
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
      expect(await executeWhole(agent.client, plan, task, { dir, git: noCommitGit() }, chain)).toBeUndefined()
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
      expect(await executeWhole(agent.client, plan, task, { dir, git: noCommitGit() }, chain)).toBeUndefined()
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
      expect(await executeWhole(agent.client, plan, task, { dir, git: noCommitGit() }, chain)).toBeUndefined()
      // 150k is past the 128k budget but only 60% of the 250k wall: the 50%
      // notice, no hard-wall hint, and one session with no document demanded.
      expect(agent.steers).toHaveLength(1)
      expect(agent.steers[0]).toContain("wall 250.0k")
      expect(agent.prompts).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // plans/0143: the handover point is an /exit boundary — the session's work
  // is committed before the verdict and the handoff document rides the
  // commit, so the pause leaves the scene a kill at that spot would and the
  // continuation session is never dispatched.
  test("an /exit pending when the session hands itself over: the exit takes effect at the handover, no continuation dispatched (plans/0143)", async () => {
    const { dir, plan, task, agent, chain, writeHandoff } = await setup((ctx) => {
      if (ctx.n === 1) writeHandoff("# Handover\n\nHalf done; next: the rest.\n\nStatus: continue\n")
      return undefined
    })
    const control = createControl()
    control.requestExit()
    try {
      let caught: unknown
      try {
        await executeWhole(agent.client, plan, task, { dir, git: noCommitGit(), control }, chain)
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(ExitRequested)
      const error = caught as ExitRequested
      expect(error.boundary).toBe("handover")
      expect(error.label).toBe("T-001 session handover")
      // Exactly one session ran — the continuation the verdict opened never
      // launched; a re-run seeds it from the handoff document.
      expect(agent.prompts).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // The steer chain's two bounds (plans/0168 D1, finding 0165-018): every
  // session hands itself over with a fresh document, exactly the confirmed
  // defect's shape (a chain that never ends on anything but the session's
  // self-report). Past the advisory count the continuation prompt carries the
  // chain's length and the honest-assessment teaching (the 0023 shape); past
  // the bound the verdict blocks for the person (P2's terminal), the question
  // naming the count and the bound.
  test("past the advisory count the continuation prompt carries the chain advisory; below it, nothing", async () => {
    let k = 0
    const { dir, plan, task, agent, chain, writeHandoff } = await setup((ctx) => {
      // Sessions 1..12 keep handing over (each document fresh; the turn
      // script runs once per session, k counts them); session 13 writes
      // nothing and ends naturally, closing the chain short of the bound.
      if (++k <= 12) writeHandoff(`# Handover ${k}\n\nStill going.\n\nStatus: continue\n`)
      return undefined
    })
    try {
      expect(await executeWhole(agent.client, plan, task, { dir, git: noCommitGit() }, chain)).toBeUndefined()
      expect(agent.prompts).toHaveLength(13)
      // The 11th continuation dispatched the 12th session: its prompt is the
      // first carrying the advisory, naming the count.
      expect(agent.prompts[10]!.text).not.toContain("handed over")
      expect(agent.prompts[11]!.text).toContain("handed over 11 times in a row")
      expect(agent.prompts[11]!.text).toContain("after 20 continuations")
      expect(agent.prompts[12]!.text).toContain("handed over 12 times in a row")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("past the chain bound the verdict blocks for the person, naming the count and the bound", async () => {
    let k = 0
    const { dir, plan, task, agent, chain, writeHandoff } = await setup(() => {
      writeHandoff(`# Handover ${++k}\n\nStill going.\n\nStatus: continue\n`)
      return undefined
    })
    try {
      const result = await executeWhole(agent.client, plan, task, { dir, git: noCommitGit() }, chain)
      // The 21st handover crosses the bound (STEER_CHAIN_BOUND = 20): 21
      // sessions ran, the 21st continuation attempt never dispatches.
      expect(result).toEqual({
        type: "blocked",
        question: expect.stringContaining("21 continuations of this scope so far (bound 20, the advisory teaching from 10)"),
      })
      expect(agent.prompts).toHaveLength(21)
      expect(agent.prompts[20]!.text).toContain("handed over 20 times in a row")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
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

  test("a lane stream's handover-due retry names its OWN per-stream file (plans/0156 D5): the feedback, never the task-level path an obedient session would wrongly write", async () => {
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
      // laneStream = true: the side-by-side stream-lane shape — the steer,
      // the reads and the verdict's own document are all the per-stream file
      // (plans/0068 S5); the serial in-lane stream above keeps the
      // task-level one.
      const result = await runSubtask(agent.client, plan, plan.tasks[0]!, text, 1, { dir, git: noCommitGit() }, chain, undefined, false, [], true)
      expect(result).toBeUndefined()
      expect(agent.prompts).toHaveLength(2)
      // The retry's demand names the per-stream document — the file an
      // obedient session must write for this subtask.
      expect(agent.prompts[1]!.text).toStartWith("The last time you ended the session a handover was due, but no valid docs/T-001/S01/handoff.md was written")
      expect(agent.prompts[1]!.text).toContain("for this subtask")
      expect(agent.prompts[1]!.text).not.toContain("docs/T-001/handoff.md")
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

  // plans/0143: a stream's handover is the same /exit boundary as the whole
  // task's — the verdict consumed the document, the continuation fork never
  // launches.
  test("an /exit pending when a stream hands itself over: the exit takes effect at the stream's handover (plans/0143)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-ondemand-"))
    try {
      const plan = planOf(`## T-001: sample task [pending]\nBody.\n`, dir)
      const agent = fakeAgent({
        turn: (ctx) => {
          if (ctx.n === 1) {
            mkdirSync(join(dir, "docs", "T-001"), { recursive: true })
            writeFileSync(join(dir, "docs", "T-001", "handoff.md"), "# Handover\n\nStream half done; next: the rest.\n\nStatus: continue\n")
          }
          return undefined
        },
      })
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const control = createControl()
      control.requestExit()
      let caught: unknown
      try {
        await runSubtask(agent.client, plan, plan.tasks[0]!, "runs stream T-001.S01", 1, { dir, git: noCommitGit(), control }, chain, undefined, false, [])
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(ExitRequested)
      const error = caught as ExitRequested
      expect(error.boundary).toBe("handover")
      expect(error.label).toBe("T-001 subtask 1 session handover")
      expect(agent.prompts).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// Ondemand context handover (plans/0056): executeWhole's document-
// authoritative post-session decision. A fresh handoff.md (differing from
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
import { executeWhole } from "../src/execute"
import { clampSwitches } from "../src/switches"
import { ev, fakeAgent, type TurnScript } from "./fixtures/agent"
import { planOf } from "./fixtures/units"

// The fake's default turn measures 1000 tokens — far under the wall
// (min(2×64k budget, 80%×100k window) = 80k), so a session that does not
// script a big figure runs quiet: no notices, no hint.
describe("executeWhole (ondemand self-directed handover)", () => {
  const setup = async (turn?: TurnScript) => {
    const dir = await mkdtemp(join(tmpdir(), "auto-ondemand-"))
    const plan = planOf(
      `## T-001: sample task [pending]
Body.
`,
      dir,
    )
    const agent = fakeAgent(turn ? { turn } : {})
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
      expect(await executeWhole(agent.client, plan, task, { dir, commit: false }, chain, true)).toBeUndefined()
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
      expect(await executeWhole(agent.client, plan, task, { dir, commit: false }, chain, true)).toBeUndefined()
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
      expect(await executeWhole(agent.client, plan, task, { dir, commit: false }, chain, true)).toBeUndefined()
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
      expect(await executeWhole(agent.client, plan, task, { dir, commit: false }, chain, true)).toBeUndefined()
      // One steer only: the single measurement crossed the wall, so the hard-
      // wall hint went out and the notice bands were spent with it.
      expect(agent.steers).toHaveLength(1)
      expect(agent.steers[0]).toContain("reached the wall")
      // The first session ended without the document: one retry with the hard
      // requirement, then the quiet second session finishes naturally.
      expect(agent.prompts).toHaveLength(2)
      expect(agent.prompts[1]!.text).toContain("This is a hard requirement")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

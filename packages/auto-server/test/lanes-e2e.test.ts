// The lane scheduler through the daemon (plans/0162): width ≥ 2 on a
// treeLanes-on project routes the task loop through the core's readiness
// scheduler, and every lane child is a WORKER OF THIS BINARY — the profile's
// laneLauncher (src/profile.ts) self-spawns `worker '<json lane payload>'`,
// the machine shape of the CLI's hidden _lane entry (the shell-contract §E
// item 8 obligation met through the profile override). What these cases pin:
//   - a two-lane round dispatches both lanes as real child worker processes
//     (the parent's prefix relay carries their own start lines), lands them
//     serialized, and the daemon's run record settles completed/0;
//   - the wide run carried no interactive transport (the daemon's own skip —
//     the core's one-channel rule), so the worker's width banner names the
//     question semantics the run actually took;
//   - the lane payload's exclusivities hold at the worker entry (the usage
//     table of worker.test.ts pins the refusals; the e2e pins the positive
//     path — the launcher's payload really runs).
// The fixture mirrors the CLI shell's S4 scheduler e2e (packages/auto
// test/e2e.test.ts): treeLanes on opts the round into the full worktree
// lanes, the tasks declare disjoint Touches, and the fake agent's
// fork-module knob writes exactly one per-task module — the conflict-free
// landing shape.
import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { CONFIG_DEFAULTS, saveProjectConfig } from "@opencode-ai/auto-core/config"
import { renderAgentContract } from "@opencode-ai/auto-core/config-fix"
import { ensureGitignore } from "@opencode-ai/auto-core/gitignore"
import { establishRound } from "@opencode-ai/auto-core/phases"
import { startDaemon, type DaemonHandle } from "../src/daemon"
import { DaemonStore } from "../src/store"
import { fakeAgent, gitOf, scrubbedEnv } from "./fixtures/project"

// The worker children spawn from the daemon's environment (this test
// process): the scrubbedEnv conventions — no ambient OPENCODE_AUTO_* layer,
// no operator model registry.
process.env.XDG_CONFIG_HOME = scrubbedEnv().XDG_CONFIG_HOME

type RunView = {
  id: string
  state: string
  code: number | null
  tail: string
  live: boolean
}

const laneDoc = (id: string, title: string, touches: string) =>
  [
    `# ${id}: ${title}`,
    "Phase: R-01.P01",
    "Depends: none",
    `Touches: ${touches}`,
    "",
    "## Goal",
    "",
    `Deliver ${title}.`,
    "",
    "## Scope",
    "",
    "src only.",
    "",
    "## Acceptance",
    "",
    "The modules read back.",
    "",
    "<!-- auto: eof -->",
    "",
  ].join("\n")

// A committed two-task project in m mode, opted into the full worktree lanes
// (treeLanes on) with a parallel level (the CLI S4 fixture's own shape — the
// level is planning guidance, width alone activates the scheduler since
// auto-core plans/0125): two independent tasks over disjoint files.
async function laneProject(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  const git = gitOf(dir)
  await git("init")
  await git("config", "user.email", "lanes@auto-server.test")
  await git("config", "user.name", "lanes e2e")
  await establishRound(dir, { phases: "m" })
  await Bun.write(join(dir, "docs/R-01/P01-implement/tasks.md"), "# Tasks\n\n- [ ] T-001 the alpha module\n- [ ] T-002 the beta module\n")
  for (const [id, title, touches] of [
    ["T-001", "the alpha module", "src/T-001.ts"],
    ["T-002", "the beta module", "src/T-002.ts"],
  ] as const) {
    await mkdir(join(dir, "docs", id), { recursive: true })
    await Bun.write(join(dir, "docs", id, "todo.md"), laneDoc(id, title, touches))
  }
  await mkdir(join(dir, ".opencode", "agent"), { recursive: true })
  await Bun.write(join(dir, ".opencode", "agent", "auto.md"), await renderAgentContract(false))
  await saveProjectConfig(dir, { ...CONFIG_DEFAULTS, subtask: "auto", treeLanes: "on", parallel: "low" })
  await ensureGitignore(dir)
  await git("add", "-A")
  await git("commit", "-qm", "baseline")
  return dir
}

describe("daemon: the lane scheduler through this shell's own lane launcher (plans/0162)", () => {
  test("a two-lane round at maxSessions 2: both lanes run as child workers of this binary, land serialized, the run completes 0 with no interactive channel", async () => {
    const dir = await laneProject("auto-server-lanes-")
    const agent = await fakeAgent({ FAKE_CLAUDE_FORK_MODULES: "1" })
    const dataDir = await mkdtemp(join(tmpdir(), "auto-server-lanes-data-"))
    // The fake `claude` on the daemon's PATH: the lane children inherit the
    // parent worker's environment (the launcher's inheritance contract), so
    // one installation covers parent and children alike.
    const before: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(agent.env)) {
      before[key] = process.env[key]
      process.env[key] = value
    }
    let daemon: DaemonHandle | undefined
    try {
      const store = new DaemonStore(dataDir)
      store.register(dir)
      const token = store.issueToken("read,control", "driver").token
      daemon = await startDaemon({ dataDir, port: 0 })
      const res = await fetch(`${daemon.url}/runs`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ project: basename(dir), options: { maxSessions: 2 }, switches: { OPENCODE_AUTO_AGENT: "claude" } }),
      })
      expect(res.status).toBe(202)
      const started = (await res.json()) as RunView & { note?: string }
      // The wide run's 202 names the width and the no-channel rule.
      expect(started.note ?? "").toContain("width 2")
      let done = started
      const deadline = Date.now() + 240_000
      for (;;) {
        done = (await (await fetch(`${daemon.url}/runs/${started.id}`, { headers: { authorization: `Bearer ${token}` } })).json()) as RunView
        if (!done.live) break
        if (Date.now() > deadline) throw new Error(`the lane run never settled: ${JSON.stringify(done)}`)
        await Bun.sleep(300)
      }
      expect(done.state, done.tail).toBe("completed")
      expect(done.code).toBe(0)
      // The parent relays each lane child's own start line with its lane's
      // id — the witness that the children were real worker processes of
      // this binary (the profile laneLauncher's self-spawn), not in-process
      // calls: their stdout arrives re-emitted through the parent.
      expect(done.tail).toContain("[T-001] ▶ T-001 lane worker: running the unit")
      expect(done.tail).toContain("[T-002] ▶ T-002 lane worker: running the unit")
      // Both lanes landed; the scheduler's own lines rode the parent.
      expect(done.tail).toContain("T-001 done (lane landed:")
      expect(done.tail).toContain("T-002 done (lane landed:")
      // The width banner named the question semantics (and no transport
      // banner exists for this run — the daemon attached none).
      expect(done.tail).toContain("🛣 width 2:")
      expect(done.tail).not.toContain("interactive transport:")
      // The work really landed: each task's own module (the fake's
      // fork-module knob — disjoint files, the conflict-free shape), both
      // units closed, the index ticked, the tree clean, the parks gone.
      expect(await Bun.file(join(dir, "src", "T-001.ts")).text()).toContain("T-001")
      expect(await Bun.file(join(dir, "src", "T-002.ts")).text()).toContain("T-002")
      expect(await Bun.file(join(dir, "docs", "T-001", "done.md")).exists()).toBe(true)
      expect(await Bun.file(join(dir, "docs", "T-002", "done.md")).exists()).toBe(true)
      expect(await Bun.file(join(dir, "docs/R-01/P01-implement/tasks.md")).text()).toContain("- [x] T-001 the alpha module")
      expect(await Bun.file(join(dir, "docs/R-01/P01-implement/tasks.md")).text()).toContain("- [x] T-002 the beta module")
      expect((await gitOf(dir)("status", "--porcelain")).trim()).toBe("")
      expect(await readdir(join(dir, ".auto/worktrees")).catch(() => [])).toEqual([])
    } finally {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      await agent.done()
      await daemon?.stop()
      await rm(dataDir, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }, 300_000)
})

// Shared fixture helpers of the auto-server suites (the worker e2e of P1b
// and the daemon suite of P1c): a committed one-task project in m mode over
// the core's own writers, the fake `claude` on PATH, and the scrubbed
// environment every subprocess spawn builds on — the packages/auto e2e
// CLI_ENV_BASE convention: no ambient OPENCODE_AUTO_* layer, no operator
// model registry (an empty XDG_CONFIG_HOME).
import { expect } from "bun:test"
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { renderAgentContract } from "@opencode-ai/auto-core/config-fix"
import { CONFIG_DEFAULTS, saveProjectConfig, type ProjectConfig } from "@opencode-ai/auto-core/config"
import { ensureGitignore } from "@opencode-ai/auto-core/gitignore"
import { establishRound } from "@opencode-ai/auto-core/phases"

// One empty config home per test module (registered as an exit cleanup): a
// subprocess reading an operator model registry would fail its references or
// steer, so none may exist.
let emptyConfigHome: string | undefined

export function scrubbedEnv(): Record<string, string | undefined> {
  if (!emptyConfigHome) {
    emptyConfigHome = mkdtempSync(join(tmpdir(), "auto-server-env-"))
    process.on("exit", () => rmSync(emptyConfigHome!, { recursive: true, force: true }))
  }
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^OPENCODE_AUTO_/.test(key))),
    XDG_CONFIG_HOME: emptyConfigHome,
  }
}

// The fake agent's environment (the B6/C5 convention): a PATH with the fake
// `claude` first; adapter selection rides the request's per-run switches
// (OPENCODE_AUTO_AGENT=claude). `extra` goes into the same environment (the
// fake's own FAKE_CLAUDE_* knobs).
export async function fakeAgent(extra: Record<string, string> = {}) {
  const binDir = await mkdtemp(join(tmpdir(), "auto-server-agent-"))
  await Bun.write(join(binDir, "claude"), `#!/bin/sh\nexec bun ${JSON.stringify(join(import.meta.dir, "fake-claude.ts"))} "$@"\n`)
  await chmod(join(binDir, "claude"), 0o755)
  return { env: { PATH: `${binDir}:${process.env.PATH ?? ""}`, ...extra }, done: () => rm(binDir, { recursive: true, force: true }) }
}

// A git helper over a fixture dir: asserts exit 0 and returns stdout.
export const gitOf = (dir: string) => {
  return async (...args: string[]) => {
    const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    expect(code, `git ${args.join(" ")}: ${err}`).toBe(0)
    return out
  }
}

export const TASK = "T-001"
export const TASK_DOC = `# ${TASK}: the widget\nPhase: R-01.P01\n\n## Goal\n\nBuild the widget.\n\n## Scope\n\nsrc only.\n\n## Acceptance\n\nThe modules read back.\n\n<!-- auto: eof -->\n`
// The second task's document (the two-task fixture the interactive e2e
// uses: waitBetween's between-tasks pause only fires with a next task
// waiting — the question the WebSocket client answers).
export const TASK_2 = "T-002"
export const TASK_2_DOC = `# ${TASK_2}: the second widget\nPhase: R-01.P01\n\n## Goal\n\nBuild the second widget.\n\n## Scope\n\nsrc only.\n\n## Acceptance\n\nThe modules read back.\n\n<!-- auto: eof -->\n`

// A committed one-task (or two-task) project in m mode. With no `config` the
// core's defaults apply (exactly the values init would freeze); with one, the full
// config is written through the core's own saver — the acceptance-gate
// variant (acceptanceGate: ["implement"], no acceptance document) is how a
// fixture run reaches the phase gate's exit 2. The agent contract is the one
// artifact preflight hard-requires; the round setup and the task documents
// ride the core's own writers (establishRound), committed as the clean
// baseline the start gate demands.
export async function fixtureProject(prefix: string, config?: Partial<ProjectConfig>, tasks: 1 | 2 = 1): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  const git = gitOf(dir)
  await git("init")
  // A repo-local identity: the run's commits are the core's, but their
  // identity must resolve deterministically here (the auto package's e2e
  // leans on the ambient account, which a shielded environment lacks).
  await git("config", "user.email", "worker@auto-server.test")
  await git("config", "user.name", "worker e2e")
  await establishRound(dir, { phases: "m" })
  const index = tasks === 2 ? `# Tasks\n\n- [ ] ${TASK} the widget\n- [ ] ${TASK_2} the second widget\n` : `# Tasks\n\n- [ ] ${TASK} the widget\n`
  await Bun.write(join(dir, "docs/R-01/P01-implement/tasks.md"), index)
  await mkdir(join(dir, "docs", TASK), { recursive: true })
  await Bun.write(join(dir, "docs", TASK, "todo.md"), TASK_DOC)
  if (tasks === 2) {
    await mkdir(join(dir, "docs", TASK_2), { recursive: true })
    await Bun.write(join(dir, "docs", TASK_2, "todo.md"), TASK_2_DOC)
  }
  await mkdir(join(dir, ".opencode", "agent"), { recursive: true })
  await Bun.write(join(dir, ".opencode", "agent", "auto.md"), await renderAgentContract(false))
  if (config) await saveProjectConfig(dir, { ...CONFIG_DEFAULTS, ...config })
  // The ignore set init writes (tmp/, .auto/): without it the run's own
  // state files (its log, the lock, the stats segment) would reach the
  // start-clean gate as untracked dirt.
  await ensureGitignore(dir)
  await git("add", "-A")
  await git("commit", "-qm", "baseline")
  return dir
}

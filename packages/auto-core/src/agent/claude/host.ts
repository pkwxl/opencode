// claude headless host (MA.5, plans/0041): the AgentHostFactory a shell hands
// to setShellProfile, or that OPENCODE_AUTO_AGENT=claude selects. Where the
// opencode host keeps one server alive, there is nothing long-lived here: the
// client starts one `claude -p` process per working session and lets it exit
// at idle. The host checks the CLI is there, and kills whatever still runs at
// close.
import type { AgentHost, AgentHostFactory } from "../types"
import { claudeAgent, type ClaudeSpawn } from "./client"

export type ClaudeHostOptions = {
  // The CLI to run; absent = "claude" on PATH.
  bin?: string
  // Test seams: the subprocess spawner and the startup version check.
  spawn?: ClaudeSpawn
  version?: (bin: string) => Promise<string | undefined>
}

export function createClaudeHost(host: ClaudeHostOptions = {}): AgentHostFactory {
  const bin = host.bin ?? "claude"
  return async (directory, options) => {
    const version = await (host.version ?? cliVersion)(bin)
    if (version === undefined) throw new Error(`claude CLI unavailable: \`${bin} --version\` failed (install Claude Code or put it on PATH)`)
    options.log(`◇ claude ${version}`)
    if (options.server) options.log(`⚠ --server ${options.server} names an opencode server; the claude agent runs its own processes and ignores it`)
    const client = claudeAgent({ directory, permission: options.permission, bin, log: options.log, ...(host.spawn ? { spawn: host.spawn } : {}) })
    const handle: AgentHost = {
      client,
      // Every process start rereads AGENTS.md and the contract.
      async syncContext() {},
      // No server to replace; a network failure is not cured by new processes.
      async restart() {
        return false
      },
      close: () => client.close(),
    }
    return handle
  }
}

export const claudeHost: AgentHostFactory = createClaudeHost()

async function cliVersion(bin: string): Promise<string | undefined> {
  try {
    const child = Bun.spawn([bin, "--version"], { stdout: "pipe", stderr: "ignore", stdin: "ignore" })
    const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
    return code === 0 ? text.trim() : undefined
  } catch {
    return undefined
  }
}

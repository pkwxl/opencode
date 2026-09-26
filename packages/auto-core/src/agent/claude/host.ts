// claude headless host (MA.5, plans/0041): the AgentHostFactory a shell hands
// to setShellProfile, or that the project config `agent: "claude"` (or
// OPENCODE_AUTO_AGENT=claude) selects via src/agent-choice.ts. Where the
// opencode host keeps one server alive, there is nothing long-lived here: the
// client starts one `claude -p` process per working session and lets it exit
// at idle. The host checks the CLI is there, and kills whatever still runs at
// close.
import type { AgentEnv, AgentHost, AgentHostFactory } from "../types"
import { claudeAgent, claudeEnv, type ClaudeSpawn } from "./client"

// The adapter's static capabilities, re-exported through this entry module so
// the agent pool can degrade over the capability intersection before any host
// starts (plans/0055 §8.5; the record is the same constant the started
// client reports).
export { CLAUDE_CAPABILITIES } from "./client"

export type ClaudeHostOptions = {
  // The CLI to run; absent = "claude" on PATH. An agent profile's bin
  // (AgentHostOptions.bin) takes precedence.
  bin?: string
  // Test seams: the subprocess spawner and the startup version check.
  spawn?: ClaudeSpawn
  version?: (bin: string, env?: AgentEnv) => Promise<string | undefined>
}

// The agent profile's bin and env (AgentHostOptions, plans/0055 F14) reach
// the version check and every claude process; the env also decides the
// transcript directory (CLAUDE_CONFIG_DIR).
// AUTO-DECISION: the profile's bin wins over the bin a shell built its host with (the registry is the operator's per-machine choice, the shell's bin a program default)
export function createClaudeHost(host: ClaudeHostOptions = {}): AgentHostFactory {
  return async (directory, options) => {
    const bin = options.bin ?? host.bin ?? "claude"
    const version = await (host.version ?? cliVersion)(bin, options.env)
    if (version === undefined) throw new Error(`claude CLI unavailable: \`${bin} --version\` failed (install Claude Code or put it on PATH)`)
    options.log(`◇ claude ${version}`)
    if (options.server) options.log(`⚠ --server ${options.server} names an opencode server; the claude agent runs its own processes and ignores it`)
    const client = claudeAgent({
      directory,
      permission: options.permission,
      bin,
      log: options.log,
      ...(options.env ? { env: options.env } : {}),
      ...(host.spawn ? { spawn: host.spawn } : {}),
    })
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

// `<bin> --version`. Without a profile env the child inherits the driver's
// environment as it always did; with one it runs in the environment the
// sessions will get.
async function cliVersion(bin: string, env?: AgentEnv): Promise<string | undefined> {
  try {
    const child = Bun.spawn([bin, "--version"], { stdout: "pipe", stderr: "ignore", stdin: "ignore", ...(env ? { env: claudeEnv(env) } : {}) })
    const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
    return code === 0 ? text.trim() : undefined
  } catch {
    return undefined
  }
}

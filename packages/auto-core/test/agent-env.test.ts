// Agent environments (plans/0055 §4.2, §8.10, F14; src/agent-env.ts and the
// profile half of src/agent-choice.ts): a profile's env resolved into the
// overlay a host starts with, the run's agent taking its registry profile, and
// the loopback proxy warning. No resolved value may reach a log line (C4).
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loopbackProxyWarning, profileLine, resolveProfileEnv } from "../src/agent-env"
import { agentProfileFor, startAgent } from "../src/agent-choice"
import { claudeHost } from "../src/agent/claude/host"
import { loadModels, type ModelRegistry, type ProfileEnvValue, type RegistryAgentProfile } from "../src/models"
import { autoSwitches, clampSwitches } from "../src/switches"

const PHASE_TYPES = ["analysis", "design", "implement", "test", "acceptance", "knowledge"]

const dirs: string[] = []
const temp = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

// Sets variables for one test and restores them afterwards.
const touched = new Map<string, string | undefined>()
const setEnv = (vars: Record<string, string | undefined>) => {
  for (const [key, value] of Object.entries(vars)) {
    if (!touched.has(key)) touched.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

afterEach(async () => {
  for (const [key, value] of touched) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  touched.clear()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

// A registry loaded from one operator-layer file (the path given explicitly,
// so the operator's own registry never takes part).
async function registry(content: unknown, home = "/home/op"): Promise<ModelRegistry> {
  const dir = await temp("auto-agent-env-")
  const file = join(dir, "models.json")
  await writeFile(file, JSON.stringify(content))
  const loaded = await loadModels(dir, { phaseTypes: PHASE_TYPES, env: { OPENCODE_AUTO_MODELS: file }, home })
  if (!loaded) throw new Error("no registry")
  return loaded
}

const profile = (env: RegistryAgentProfile["env"]): RegistryAgentProfile => ({ name: "claude-b", layer: "operator", adapter: "claude", env })

describe("resolveProfileEnv", () => {
  test("a literal as loaded (~ expanded), {env:NAME}, {file:path} trimmed, null kept as a removal", async () => {
    const dir = await temp("auto-agent-env-")
    await writeFile(join(dir, "proxy"), "  http://user:pw@proxy:3128\n")
    const loaded = await registry(
      {
        agents: {
          "claude-b": {
            adapter: "claude",
            env: { CLAUDE_CONFIG_DIR: "~/.claude-b", HTTPS_PROXY: "{env:AUTO_TEST_PROXY}", ALL_PROXY: `{file:${join(dir, "proxy")}}`, NO_PROXY: null },
          },
        },
      },
      "/home/op",
    )
    const resolved = await resolveProfileEnv(loaded.agents.get("claude-b")!, { AUTO_TEST_PROXY: "http://127.0.0.1:7890" })
    expect(resolved).toEqual({
      env: { CLAUDE_CONFIG_DIR: "/home/op/.claude-b", HTTPS_PROXY: "http://127.0.0.1:7890", ALL_PROXY: "http://user:pw@proxy:3128", NO_PROXY: null },
    })
  })

  test("a profile without env resolves to an empty overlay; an empty file is an empty value", async () => {
    expect(await resolveProfileEnv(profile(undefined), {})).toEqual({ env: {} })
    const dir = await temp("auto-agent-env-")
    await writeFile(join(dir, "empty"), "\n")
    expect(await resolveProfileEnv(profile(new Map([["X", { kind: "file", path: join(dir, "empty"), ref: "", label: "empty" }]])), {})).toEqual({ env: { X: "" } })
  })

  test("problems name the profile, the variable and the reference, never a value", async () => {
    const env = new Map<string, ProfileEnvValue>([
      ["HTTPS_PROXY", { kind: "env", name: "AUTO_TEST_UNSET", ref: "{env:AUTO_TEST_UNSET}", label: "AUTO_TEST_UNSET" }],
      ["HTTP_PROXY", { kind: "env", name: "AUTO_TEST_EMPTY", ref: "{env:AUTO_TEST_EMPTY}", label: "AUTO_TEST_EMPTY" }],
      ["ALL_PROXY", { kind: "file", path: "/nonexistent/proxy", ref: "{file:/nonexistent/proxy}", label: "~/.secrets/proxy" }],
      ["NO_PROXY", "literal-that-resolves"],
    ])
    expect(await resolveProfileEnv(profile(env), { AUTO_TEST_EMPTY: "" })).toEqual({
      problems: [
        "agent profile claude-b: env HTTPS_PROXY: env AUTO_TEST_UNSET is not set",
        "agent profile claude-b: env HTTP_PROXY: env AUTO_TEST_EMPTY is empty",
        "agent profile claude-b: env ALL_PROXY: file ~/.secrets/proxy does not exist",
      ],
    })
  })

  test("profileLine names the variables it sets and removes, never a value or the server URL", async () => {
    const loaded = await registry({
      agents: {
        opencode: { adapter: "opencode", bin: "~/bin/opencode", server: "http://user:pw@127.0.0.1:4096", env: { HTTPS_PROXY: "http://secret@proxy", NO_PROXY: null } },
      },
    })
    const line = profileLine(loaded.agents.get("opencode")!)
    expect(line).toBe("◇ agent profile opencode (opencode, operator layer): bin /home/op/bin/opencode; external server; env: HTTPS_PROXY; env removed: NO_PROXY")
    expect(line).not.toContain("secret")
    expect(line).not.toContain("pw@")
    expect(profileLine((await registry({ models: {} })).agents.get("opencode")!)).toBe("◇ agent profile opencode (opencode, implied)")
  })
})

describe("agentProfileFor: the profile the run's single agent starts with", () => {
  const claude = { name: "claude", host: claudeHost }

  test("the profile named like the chosen agent, else the first of its adapter in registry order, else none", async () => {
    const loaded = await registry({
      agents: {
        "claude-a": { adapter: "claude" },
        claude: { adapter: "claude", env: { CLAUDE_CONFIG_DIR: "~/.claude" } },
        direct: { adapter: "opencode" },
      },
    })
    expect(agentProfileFor(loaded, claude)?.name).toBe("claude")
    expect(agentProfileFor(loaded, undefined)?.name).toBe("direct")
    const unnamed = await registry({ agents: { "claude-b": { adapter: "claude" }, "claude-c": { adapter: "claude" } } })
    expect(agentProfileFor(unnamed, claude)?.name).toBe("claude-b")
    expect(agentProfileFor(unnamed, undefined)).toBeUndefined()
  })

  test("a registry without agents implies the opencode profile, which the default agent takes", async () => {
    const loaded = await registry({ models: { glm: { agent: "opencode", model: "zhipuai/glm-4.6" } } })
    expect(agentProfileFor(loaded, undefined)).toMatchObject({ name: "opencode", layer: "implied", adapter: "opencode" })
    expect(agentProfileFor(loaded, claude)).toBeUndefined()
  })
})

// A fake `opencode` that records its environment and announces a server, and
// a fake `claude` that records the environment of its version check.
async function fakes(): Promise<{ dir: string; env(name: string): Promise<Map<string, string>> }> {
  const dir = await temp("auto-agent-env-bin-")
  const scripts: Record<string, string[]> = {
    "opencode-profile": ["#!/bin/sh", 'env > "$(dirname "$0")/opencode.env"', 'echo "opencode server listening on http://127.0.0.1:4999"', "exec sleep 30"],
    "claude-profile": ["#!/bin/sh", 'env > "$(dirname "$0")/claude.env"', 'echo "2.1.278 (Claude Code)"'],
  }
  for (const [name, lines] of Object.entries(scripts)) {
    await writeFile(join(dir, name), `${lines.join("\n")}\n`)
    await chmod(join(dir, name), 0o755)
  }
  return {
    dir,
    async env(name) {
      const env = new Map<string, string>()
      for (const line of (await readFile(join(dir, name), "utf8")).split("\n")) {
        const at = line.indexOf("=")
        if (at > 0) env.set(line.slice(0, at), line.slice(at + 1))
      }
      return env
    },
  }
}

describe("startAgent under a registry: the run's agent starts with its profile", () => {
  const switches = autoSwitches()
  let printed: ReturnType<typeof spyOn>
  let lines: string[]

  beforeEach(() => {
    lines = []
    printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "))
    })
    setEnv({ OPENCODE_AUTO_SERVER: undefined })
    clampSwitches({ agent: undefined })
  })

  afterEach(() => {
    printed.mockRestore()
    clampSwitches(switches)
  })

  test("opencode: bin and resolved env reach the managed server; the log names the variables, never a value", async () => {
    const bin = await fakes()
    await writeFile(join(bin.dir, "secret-file"), "file-secret-value\n")
    setEnv({ AUTO_TEST_SECRET: "http://user:hunter2@proxy:3128", AUTO_TEST_DROP: "inherited" })
    const loaded = await registry({
      agents: {
        opencode: {
          adapter: "opencode",
          bin: join(bin.dir, "opencode-profile"),
          env: { HTTPS_PROXY: "{env:AUTO_TEST_SECRET}", AUTO_TEST_FILE: `{file:${join(bin.dir, "secret-file")}}`, AUTO_TEST_DROP: null },
        },
      },
    })
    const started = await startAgent("/work", { registry: loaded })
    try {
      expect(started.error).toBeUndefined()
      const env = await bin.env("opencode.env")
      expect(env.get("HTTPS_PROXY")).toBe("http://user:hunter2@proxy:3128")
      expect(env.get("AUTO_TEST_FILE")).toBe("file-secret-value")
      expect(env.has("AUTO_TEST_DROP")).toBe(false)
      expect(env.get("OPENCODE_CONFIG_CONTENT")).toBe("{}")
      expect(lines).toContain(`◇ agent profile opencode (opencode, operator layer): bin ${join(bin.dir, "opencode-profile")}; env: HTTPS_PROXY, AUTO_TEST_FILE; env removed: AUTO_TEST_DROP`)
      const all = lines.join("\n")
      expect(all).not.toContain("hunter2")
      expect(all).not.toContain("file-secret-value")
    } finally {
      started.host?.close()
    }
  })

  test("claude: the version check runs under the profile env, with the profile's bin", async () => {
    const bin = await fakes()
    clampSwitches({ agent: "claude" })
    const loaded = await registry({
      agents: { claude: { adapter: "claude", bin: join(bin.dir, "claude-profile"), env: { CLAUDE_CONFIG_DIR: "/home/op/.claude-b" } } },
    })
    const started = await startAgent("/work", { registry: loaded })
    try {
      expect(started.error).toBeUndefined()
      expect((await bin.env("claude.env")).get("CLAUDE_CONFIG_DIR")).toBe("/home/op/.claude-b")
      expect(lines.slice(0, 3)).toEqual([
        `◇ agent profile claude (claude, operator layer): bin ${join(bin.dir, "claude-profile")}; env: CLAUDE_CONFIG_DIR`,
        "◇ claude 2.1.278 (Claude Code)",
        "◇ agent: claude",
      ])
    } finally {
      started.host?.close()
    }
  })

  test("a reference that no longer resolves stops before any host starts, naming the reference only", async () => {
    const bin = await fakes()
    setEnv({ AUTO_TEST_GONE: undefined })
    const loaded = await registry({
      agents: { opencode: { adapter: "opencode", bin: join(bin.dir, "opencode-profile"), env: { HTTPS_PROXY: "{env:AUTO_TEST_GONE}" } } },
    })
    const started = await startAgent("/work", { registry: loaded })
    expect(started).toEqual({ error: "agent profile opencode: env HTTPS_PROXY: env AUTO_TEST_GONE is not set" })
    expect(await Bun.file(join(bin.dir, "opencode.env")).exists()).toBe(false)
  })

  test("no profile of the agent's adapter: a note, and the agent starts as without a registry", async () => {
    const loaded = await registry({ agents: { "claude-b": { adapter: "claude" } } })
    const managed = { client: { capabilities: { resume: true, fork: "message", steer: true, abort: true, question: true, permission: true, history: true, usage: "events" } } } as never
    // A managed host is taken as is: the profile does not apply to it.
    const taken = await startAgent("/work", { registry: loaded, managed })
    expect(taken.host).toBe(managed)
    expect(lines).toEqual([])
    const bin = await fakes()
    setEnv({ PATH: `${bin.dir}:${process.env.PATH}` })
    await writeFile(join(bin.dir, "opencode"), `#!/bin/sh\necho "opencode server listening on http://127.0.0.1:4998"\nexec sleep 30\n`)
    await chmod(join(bin.dir, "opencode"), 0o755)
    const started = await startAgent("/work", { registry: loaded })
    try {
      expect(started.error).toBeUndefined()
      expect(lines).toEqual(["◇ the model registry has no agent profile of adapter opencode; the agent starts without one"])
    } finally {
      started.host?.close()
    }
  })
})

describe("loopbackProxyWarning (§8.10, measured on Bun 1.4.2)", () => {
  test("no http proxy variable: no warning (HTTPS_PROXY and ALL_PROXY leave http loopback direct)", () => {
    expect(loopbackProxyWarning({})).toBeUndefined()
    expect(loopbackProxyWarning({ HTTPS_PROXY: "http://p:1", https_proxy: "http://p:1", ALL_PROXY: "http://p:1" })).toBeUndefined()
    expect(loopbackProxyWarning({ HTTP_PROXY: "" })).toBeUndefined()
  })

  test("NO_PROXY covering both loopback names, in any spelling Bun accepts: no warning", () => {
    for (const noProxy of ["127.0.0.1,localhost", " LOCALHOST , 127.0.0.1 ", "*", ".localhost,127.0.0.1", "example.com,localhost,127.0.0.1"]) {
      expect(loopbackProxyWarning({ HTTP_PROXY: "http://p:1", NO_PROXY: noProxy })).toBeUndefined()
    }
    expect(loopbackProxyWarning({ http_proxy: "http://p:1", no_proxy: "localhost,127.0.0.1" })).toBeUndefined()
    // An empty no_proxy falls back to NO_PROXY.
    expect(loopbackProxyWarning({ HTTP_PROXY: "http://p:1", no_proxy: "", NO_PROXY: "localhost,127.0.0.1" })).toBeUndefined()
  })

  test("a proxy with loopback not covered warns, naming what is missing and where", () => {
    expect(loopbackProxyWarning({ HTTP_PROXY: "http://user:secret@p:1" })).toBe(
      "⚠ HTTP_PROXY is set in the driver's environment and NO_PROXY does not cover 127.0.0.1 or localhost: " +
        "Bun does not bypass loopback on its own, so the driver's requests to its opencode server would go through the proxy. " +
        "Add 127.0.0.1,localhost to NO_PROXY, and give an agent that needs the proxy its own through its agent profile's env in the model registry",
    )
    const one = loopbackProxyWarning({ HTTP_PROXY: "http://p:1", http_proxy: "http://p:1", NO_PROXY: "127.0.0.1" })!
    expect(one).toStartWith("⚠ HTTP_PROXY and http_proxy are set in the driver's environment and NO_PROXY does not cover localhost:")
    expect(one).toContain("Add localhost to NO_PROXY")
    // A non-empty no_proxy wins over NO_PROXY, as in Bun.
    expect(loopbackProxyWarning({ HTTP_PROXY: "http://p:1", no_proxy: "example.com", NO_PROXY: "localhost,127.0.0.1" })).toContain("no_proxy does not cover 127.0.0.1 or localhost")
    // Forms Bun does not honour for loopback: CIDR, wildcards, ports, ";".
    for (const noProxy of ["127.0.0.0/8,localhost", "127.*,localhost", "127.0.0.1:4096,localhost", "127.0.0.1;localhost"]) {
      expect(loopbackProxyWarning({ HTTP_PROXY: "http://p:1", NO_PROXY: noProxy })).toBeDefined()
    }
    expect(loopbackProxyWarning({ HTTP_PROXY: "http://user:secret@p:1" })).not.toContain("secret")
  })
})

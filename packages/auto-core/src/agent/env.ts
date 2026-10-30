// The driver's own variables never reach an agent's processes (plans/0059
// X1). The OPENCODE_AUTO_* variables configure the driver: it reads them once
// at run start, and a session and the tools it launches have no use for them.
// Inherited, they leak into whatever the session runs. A session that ran a
// project's end-to-end test inherited OPENCODE_AUTO_AGENT=claude, and the
// test's CLI started real claude sessions. So both spawns leave them out: the
// claude processes (claude/client.ts claudeEnv) and the managed opencode
// server (opencode/server.ts serverEnv), whose tools and shells inherit its
// environment. A profile's env overlay is applied after the scrub, so a
// profile that sets one of them explicitly still gets it. The one
// driver-domain child that is the agent's own executable — the pool's
// `<bin> --version` preflight check (plans/0157 D4) — scrubs through the same
// predicate (scrubDriverEnv below), so the X1 letter holds over every process
// the agent's binary is.
//
// Part of the agent domain, imported by the adapters — and reached by the
// agent pool (the driver domain) through the opencode entry's re-export of
// scrubDriverEnv, the domain's one D8-legal crossing point for it: the
// driver's switch registry (src/switches.ts) sits in the driver domain, which
// this domain may not import, so the prefix is restated
// here. test/agent-env.test.ts checks that every variable the registry names
// matches it.

const DRIVER_ENV_PREFIX = "OPENCODE_AUTO_"

// opencode's own flags that share the driver's prefix: OPENCODE_AUTO_SHARE
// (packages/opencode runtime flags) and OPENCODE_AUTO_HEAP_SNAPSHOT
// (packages/core flags). They configure the agent, not the driver, and an
// operator who sets one means the opencode server to see it.
// AUTO-RESOLVE: the design drops every OPENCODE_AUTO_* variable; do opencode's own flags with that prefix go too? -> no, they are kept (they are opencode's switches, not the driver's; dropping them would silently change the agent the operator configured, and no driver code reads them)
const AGENT_FLAGS: ReadonlySet<string> = new Set(["OPENCODE_AUTO_SHARE", "OPENCODE_AUTO_HEAP_SNAPSHOT"])

// Whether an inherited variable is the driver's and stays out of an agent's
// environment.
export function driverVariable(name: string): boolean {
  return name.startsWith(DRIVER_ENV_PREFIX) && !AGENT_FLAGS.has(name)
}

// The base with the driver's own variables scrubbed: the environment shape
// every child that runs the agent's own executable starts from (the adapters
// apply the same predicate inline over their bases with their extra rules —
// the config-reference retention of serverEnv, the session-variable removal
// of claudeEnv — so they keep their builders; this is the plain scrub for the
// pool's version-check child, applied before the profile overlay).
export function scrubDriverEnv(base: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const [name, value] of Object.entries(base)) if (!driverVariable(name)) env[name] = value
  return env
}

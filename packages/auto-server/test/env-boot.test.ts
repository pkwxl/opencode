// The environment carrier pinned (plans/0265 — 0264-01's fix): the parse,
// the manifest, the boot report's two arms (the lost-names diff, the
// registry reference check), and the serve entry's --env-file wiring. Every
// assertion is over NAMES — the security family's display rule is the point
// of the mechanism, so a value appearing anywhere in a warning is the test
// failing, not passing.
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { environmentBootReport, manifestOf, parseEnvFile, MANIFEST_NAME } from "../src/env-boot"
import { startDaemon } from "../src/daemon"

const ENV_BASE: Record<string, string | undefined> = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^OPENCODE_AUTO_/.test(key)),
)

// The scrubbed base every injected environment carries (the preload points
// XDG_CONFIG_HOME at an empty temp — without it an injected record falls
// back to the operator's real registry, whose unset keys are exactly the
// field finding this mechanism exists to catch).
const BASE: Record<string, string | undefined> = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, PATH: "/usr/bin" }

async function runServer(args: string[]) {
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "..", "src", "index.ts"), ...args], {
    cwd: join(import.meta.dir, ".."),
    env: ENV_BASE,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code: await proc.exited, out, err }
}

describe("env-file parsing", () => {
  test("NAME=VALUE lines: pairs, empty values, '=' inside values, comments and blanks skipped, duplicates last-win", () => {
    expect(
      parseEnvFile(["# a comment", "", "  ", "K3_KEY=abc", "EMPTY=", "WITH_EQ=a=b=c", "K3_KEY=late", "  TRIMMED =  no"].join("\n")),
    ).toEqual({ K3_KEY: "late", EMPTY: "", WITH_EQ: "a=b=c", TRIMMED: "no" })
  })

  test("a malformed line refuses at its number, never echoing the line's bytes", () => {
    expect(() => parseEnvFile("GOOD=1\nNOT_A_DECLARATION\n")).toThrow("line 2 is not a NAME=VALUE declaration")
    expect(() => parseEnvFile("BAD NAME=1")).toThrow("line 1 is not a NAME=VALUE declaration")
  })
})

describe("the boot manifest", () => {
  test("sorted names, presence only, the switch layer never a carrier name", () => {
    const manifest = manifestOf({ OPENCODE_AUTO_STEER: "on", Z_KEY: "secret-value", A_KEY: "other-value" }, new Date("2026-11-19T15:08:01Z"))
    expect(manifest).toEqual({ v: 1, at: "2026-11-19T15:08:01.000Z", names: ["A_KEY", "Z_KEY"] })
  })
})

describe("environmentBootReport", () => {
  test("a fresh boot writes the manifest and warns about nothing", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "env-boot-"))
    try {
      const warnings = await environmentBootReport(dataDir, { ...BASE, A_KEY: "1", OPENCODE_AUTO_STEER: "on" })
      expect(warnings).toEqual([])
      const manifest = JSON.parse(await Bun.file(join(dataDir, MANIFEST_NAME)).text())
      expect(manifest.names).toContain("A_KEY")
      expect(manifest.names).not.toContain("OPENCODE_AUTO_STEER")
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test("the second boot names the names the carrier lost; a restored carrier warns about nothing", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "env-boot-"))
    try {
      await environmentBootReport(dataDir, { ...BASE, K_KEY_1101: "a-value", Z_KEY_8903: "b-value" })
      const warnings = await environmentBootReport(dataDir, { ...BASE })
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain("K_KEY_1101, Z_KEY_8903")
      expect(warnings[0]).toContain("serve --env-file")
      expect(warnings[0]).not.toContain("a-value")
      expect(await environmentBootReport(dataDir, { ...BASE, K_KEY_1101: "x", Z_KEY_8903: "y" })).toEqual([])
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test("a corrupt previous manifest warns, skips the diff, and is rewritten for the next boot", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "env-boot-"))
    try {
      await writeFile(join(dataDir, MANIFEST_NAME), "{ not json", "utf8")
      const warnings = await environmentBootReport(dataDir, { ...BASE, A_KEY: "1" })
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain("manifest could not be read")
      expect(await environmentBootReport(dataDir, { ...BASE, A_KEY: "1" })).toEqual([])
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test("the registry arm: an unresolvable env reference warns with the core's own wording; resolved references stay silent", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "env-boot-"))
    const registry = join(dataDir, "models.json")
    try {
      await writeFile(registry, JSON.stringify({ models: { k3: { agent: "opencode", model: "prov/k3", keys: ["{env:BOOT_KEY_A}", "{env:BOOT_KEY_B}"] } } }), "utf8")
      const env = { ...BASE, OPENCODE_AUTO_MODELS: registry }
      const warnings = await environmentBootReport(dataDir, env)
      expect(warnings).toHaveLength(2)
      expect(warnings[0]).toContain("models.k3.keys[0]: env BOOT_KEY_A is not set")
      expect(warnings[1]).toContain("models.k3.keys[1]: env BOOT_KEY_B is not set")
      expect(
        await environmentBootReport(dataDir, { ...BASE, OPENCODE_AUTO_MODELS: registry, BOOT_KEY_A: "value-never-shown", BOOT_KEY_B: "also-never" }),
      ).toEqual([])
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test("a broken registry layer is one boot warning naming its first problem, never a crash", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "env-boot-"))
    const registry = join(dataDir, "models.json")
    try {
      await writeFile(registry, "{ \"models\": { \"x\": { \"agent\": \"no-such-adapter\" } } }", "utf8")
      const warnings = await environmentBootReport(dataDir, { ...BASE, OPENCODE_AUTO_MODELS: registry })
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain("the model registry could not be loaded at boot")
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

describe("the daemon's boot report surface", () => {
  test("startDaemon computes the report and writes the manifest into its data dir", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "env-boot-daemon-"))
    const daemon = await startDaemon({ dataDir, port: 0 })
    try {
      expect(daemon.bootWarnings).toEqual([])
      expect(JSON.parse(await Bun.file(join(dataDir, MANIFEST_NAME)).text()).names.length).toBeGreaterThan(0)
    } finally {
      await daemon.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

describe("serve --env-file wiring", () => {
  test("a missing declaration file is refused at the flag", async () => {
    const run = await runServer(["serve", "--env-file", join(tmpdir(), "env-file-absent-4711.env")])
    expect(run.code).toBe(1)
    expect(run.err).toContain("--env-file takes the daemon's environment declaration — a readable file")
  })

  test("a malformed line refuses naming its number, never the line's bytes", async () => {
    const file = join(tmpdir(), `env-file-bad-${process.pid}.env`)
    await writeFile(file, "GOOD=never-print-this\nNOT_A_DECLARATION\n", "utf8")
    try {
      const run = await runServer(["serve", "--env-file", file])
      expect(run.code).toBe(1)
      expect(run.err).toContain("line 2 is not a NAME=VALUE declaration")
      expect(run.err).not.toContain("never-print-this")
    } finally {
      await rm(file, { force: true })
    }
  })

  test("the flag without a value is the usage refusal", async () => {
    const run = await runServer(["serve", "--env-file"])
    expect(run.code).toBe(1)
    expect(run.err).toContain("--env-file takes the daemon's environment declaration file")
  })
})

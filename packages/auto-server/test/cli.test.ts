// The stub entry over a subprocess: --help/--version are the whole command
// surface of the skeleton, and --version stays in step with the manifest.
// The spawn environment is scrubbed of the ambient OPENCODE_AUTO_* layer the
// way the general shell's e2e scrubs its CLI runs (a driver environment must
// not reach a subprocess), even though the stub reads no switch yet — the
// scrub is the pattern every later server test builds on.
import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const ENV_BASE: Record<string, string | undefined> = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^OPENCODE_AUTO_/.test(key)),
)

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

describe("server stub entry", () => {
  test("--help prints the usage and exits 0", async () => {
    const run = await runServer(["--help"])
    expect(run.code).toBe(0)
    expect(run.out).toContain("usage:")
    expect(run.out).toContain("opencode-auto-server --version")
  })

  test("--version prints the manifest version and exits 0", async () => {
    const pkg = await Bun.file(join(import.meta.dir, "..", "package.json")).json()
    const run = await runServer(["--version"])
    expect(run.code).toBe(0)
    expect(run.out.trim()).toBe(`opencode-auto-server ${pkg.version}`)
  })

  test("a bare or unknown invocation refuses with the usage on stderr, exit 1", async () => {
    for (const args of [[], ["daemon"]]) {
      const run = await runServer(args)
      expect(run.code).toBe(1)
      expect(run.err).toContain("usage:")
    }
  })
})

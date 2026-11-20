// The stub entry over a subprocess: --help/--version are the whole command
// surface of the skeleton, and --version stays in step with the manifest.
// The spawn environment is scrubbed of the ambient OPENCODE_AUTO_* layer the
// way the general shell's e2e scrubs its CLI runs (a driver environment must
// not reach a subprocess), even though the stub reads no switch yet — the
// scrub is the pattern every later server test builds on.
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"

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

// serve --launch resolution (plans/0223 D3, the 0165-172 finding): a
// relative launcher reached the spawn verbatim — resolving against the
// spawn cwd, the package's src/ in the source layout, where every run died
// bash's 127 — and nothing checked the script exists. The entry resolves
// the path against the serve command's working directory (one truth for
// both layouts) and refuses (exit 1) a launcher that is not a readable
// file, at the banner that would otherwise announce it active.
describe("server serve entry: --launch is retired (plans/0282)", () => {
  test("the flag is a usage refusal naming the retirement", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "auto-server-launch-retired-"))
    try {
      const proc = Bun.spawn([process.execPath, join(import.meta.dir, "..", "src", "index.ts"), "serve", "--launch", "launch.sh", "--port", "0", "--data-dir", join(scratch, "data")], {
        cwd: scratch,
        env: ENV_BASE,
        stdout: "pipe",
        stderr: "pipe",
      })
      const code = await proc.exited
      expect(code).toBe(1)
      const err = await new Response(proc.stderr).text()
      expect(err).toContain("--launch is retired (plans/0282)")
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  })
})

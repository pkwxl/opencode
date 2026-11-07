// The run banner's emitter family (plans/0193 D1, finding 0165-056): one
// home — runBannerLines/phasesLine in src/banner.ts — serving the CLI's
// run/plan/`_lane` entries, the service shell's worker and the status view.
// This suite pins the cross-profile equality the shells' hand-maintained
// copies could not keep (S29-08: the worker's banner had lost 0142's
// testByDriver clause; both shells' missing-index remedy taught `plan` where
// the core's own status view taught `transfer` for phased projects), the
// phases-line split, the served-surface renderers (S30-04) and the frozen-key
// revision table (S29-07: phases teaches the roadmap line, never the amend
// flag 0137 retired).
import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { establishRound } from "../src/phases"
import { configKeyRevision } from "../src/config"
import { runBannerLines, phasesLine } from "../src/banner"
import { setShellProfile, surfaceOf } from "../src/shell"
import { withDirFactory } from "./fixtures/dir"

const withDir = withDirFactory("auto-banner-")

// The service shell's profile shape (packages/auto-server/src/profile.ts —
// the fields this suite renders through, never the shell itself).
const SERVER_SURFACE = {
  run: () => "the run operation (POST /runs)",
  plan: () => "the plan operation (POST /projects/<p>/plan)",
}

async function commitAll(dir: string) {
  const { git } = await import("../src/git")
  const run = (args: string[]) => git(dir, args)
  await run(["init", "-q"])
  await run(["config", "user.email", "t@example.com"])
  await run(["config", "user.name", "t"])
  writeFileSync(join(dir, ".gitignore"), "tmp/\n.auto/\n")
  await run(["add", "-A"])
  await run(["commit", "-qm", "setup"])
}

describe("runBannerLines: the one banner, byte-identical across profiles (S29-08)", () => {
  test(
    "the tests line carries 0142's full code-work clause under every profile",
    withDir(async (dir) => {
      await commitAll(dir)
      await establishRound(dir, { phases: "m" })
      const config = { testByDriver: true, handoverTest: true, phases: "m" } as Parameters<typeof runBannerLines>[1]
      const underDefault = await runBannerLines(dir, config)
      setShellProfile({ program: "opencode-auto-server", bin: "opencode-auto-server", surface: SERVER_SURFACE })
      try {
        const underServer = await runBannerLines(dir, config)
        // The tests line and the config line are profile-independent; the
        // pre-fix worker copy lacked the trailing 0142 clause ("the channel
        // serves code-work phases (elsewhere a session runs such a check
        // itself, never through tmp/test.sh)") — pinned here for both.
        const testsLine = underDefault.find((line) => line.startsWith("⚙ tests run by the driver"))!
        expect(testsLine).toContain("feeds it back to the session; the channel serves code-work phases (elsewhere a session runs such a check itself, never through tmp/test.sh)")
        expect(testsLine).toContain("; on test failure with context at its cap, a handover document switches to a fresh session")
        expect(underServer.find((line) => line.startsWith("⚙ tests run by the driver"))).toBe(testsLine)
        expect(underServer.find((line) => line.startsWith("⚙ project config"))).toBe(underDefault.find((line) => line.startsWith("⚙ project config")))
      } finally {
        setShellProfile({ program: "opencode-auto run", bin: "opencode-auto", surface: undefined })
      }
    }),
  )

  test(
    "the missing-index remedy is phased-aware: transfer for a phased project, plan in m mode (S29-08)",
    withDir(async (dir) => {
      await commitAll(dir)
      // A phased project whose phase index is missing: the remedy names
      // transfer (the command that establishes a phased round), never plan
      // (which cannot) — through the served surface, so a service shell
      // names its own operation.
      await establishRound(dir, { phases: "am" })
      // The missing-index state: the round exists, its phase index does not.
      rmSync(join(dir, "docs", "R-01", "phases.md"))
      mkdirSync(join(dir, ".opencode", "auto"), { recursive: true })
      writeFileSync(join(dir, ".opencode/auto/config.json"), JSON.stringify({ version: 1, mode: "migrate", phases: "am" }))
      const phased = await phasesLine(dir, "am")
      expect(phased).toContain("is missing")
      expect(phased).toContain("run opencode-auto transfer to establish the round")
      expect(phased).not.toContain("run opencode-auto plan")
      // m mode keeps plan.
      writeFileSync(join(dir, ".opencode/auto/config.json"), JSON.stringify({ version: 1, mode: "migrate" }))
      const mMode = await phasesLine(dir, "m")
      expect(mMode).toContain("run opencode-auto plan to establish the round")
      // Under a service profile the same line names the shell's true plan
      // operation, never a subcommand its binary refuses.
      setShellProfile({ program: "opencode-auto-server", bin: "opencode-auto-server", surface: SERVER_SURFACE })
      try {
        const served = await phasesLine(dir, "m")
        expect(served).toContain("run the plan operation (POST /projects/<p>/plan) to establish the round")
        expect(served).not.toContain("opencode-auto-server plan")
        const servedPhased = await phasesLine(dir, "am")
        expect(servedPhased).toContain("run opencode-auto-server transfer to establish the round")
      } finally {
        setShellProfile({ program: "opencode-auto run", bin: "opencode-auto", surface: undefined })
      }
    }),
  )
})

describe("surfaceOf: the served-surface renderers (S30-04, plans/0193 D3)", () => {
  test("the default renders the CLI subcommand shape byte-identically", () => {
    const surface = surfaceOf()
    expect(surface.run("/tmp/proj")).toBe("opencode-auto run /tmp/proj")
    expect(surface.plan("/tmp/proj", "-p <text> | --file <path>")).toBe("opencode-auto plan /tmp/proj -p <text> | --file <path>")
    expect(surface.plan()).toBe("opencode-auto plan")
    expect(surface.transfer("/tmp/proj")).toBe("opencode-auto transfer /tmp/proj")
  })

  test("a service shell's override replaces only its channels; the flags tail is the renderer's to drop", () => {
    setShellProfile({ program: "opencode-auto-server", bin: "opencode-auto-server", surface: SERVER_SURFACE })
    try {
      const surface = surfaceOf()
      expect(surface.run("/tmp/proj")).toBe("the run operation (POST /runs)")
      expect(surface.plan("/tmp/proj", "--append -p <text>")).toBe("the plan operation (POST /projects/<p>/plan)")
      // transfer not overridden: the default subcommand shape over the
      // profile's bin.
      expect(surface.transfer("/tmp/proj")).toBe("opencode-auto-server transfer /tmp/proj")
    } finally {
      setShellProfile({ program: "opencode-auto run", bin: "opencode-auto", surface: undefined })
    }
  })
})

describe("configKeyRevision: the one frozen-key hint table (S29-07, plans/0193 D2)", () => {
  test("phases teaches the roadmap line, never the retired amend flag", () => {
    const revision = configKeyRevision("phases")
    expect(revision.file).toBe(false)
    expect(revision.clause).toContain("nothing on amend — a round's phases reshape by moving or adding its `- R-NN <phases> — <goal>` line in docs/analysis.md")
    expect(revision.clause).not.toContain("--phases")
  })

  test("the flag-shaped keys teach the amend command with their flag spellings", () => {
    expect(configKeyRevision("mode").clause).toBe("opencode-auto amend <dir> -m <value>")
    expect(configKeyRevision("contextLimit").clause).toBe("opencode-auto amend <dir> --context-limit <value>")
    expect(configKeyRevision("context-limit").clause).toBe("opencode-auto amend <dir> --context-limit <value>")
    expect(configKeyRevision("autoNumber").clause).toBe("opencode-auto amend <dir> --auto-number (use --no-auto-number to turn off)")
    expect(configKeyRevision("no-auto-number").clause).toBe("opencode-auto amend <dir> --auto-number (use --no-auto-number to turn off)")
    expect(configKeyRevision("wrapup").clause).toBe("opencode-auto amend <dir> --wrapup (use --no-wrapup to turn off)")
    expect(configKeyRevision("isolate").clause).toBe("opencode-auto amend <dir> --isolate <value>")
    expect(configKeyRevision("treeLanes").clause).toBe("opencode-auto amend <dir> --tree-lanes <value>")
    for (const key of ["mode", "agent", "contextLimit", "subtask", "testByDriver", "autoNumber", "phases", "parallel", "intent", "treeLanes", "isolate", "scanExempt"]) {
      expect(configKeyRevision(key).file).toBe(key === "phases" ? false : true)
    }
  })
})

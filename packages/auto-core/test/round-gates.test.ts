// Human-gate convergence (M4.2, plans/0049): the round brief, the phase gates
// inside completePhase, the round-close gate, the new config keys and the
// prompt slots that carry them.
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadProjectConfig } from "../src/config"
import { acceptanceMark, p1Scope, roleOf } from "../src/document/roles"
import { completePhase, establishRound, phaseGates, readPhases } from "../src/phases"
import { renderPhaseHandover, renderPhasePlan } from "../src/prompt"
import { closeSection, renderRoundBrief, roundBriefText } from "../src/round-brief"
import { roundCloseLines, roundCloseProblems } from "../src/round-close"
import { phaseType } from "../src/phases/registry"

function withDir(fn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-round-gates-"))
    try {
      await fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

async function git(dir: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`git ${args.join(" ")} exited ${code}: ${err}`)
}

async function gitRepo(dir: string) {
  await git(dir, "init", "-q")
  await git(dir, "config", "user.email", "t@example.com")
  await git(dir, "config", "user.name", "t")
}

const FILLED_CLOSE = "## Close\n\n- Restated: the retry policy, in src/net/README.md.\n- Accepted as lost: none.\n"

describe("round brief (plans/0049 G2/G3)", () => {
  test("an untouched stub is no planning input and has an empty close section", async () => {
    const stub = renderRoundBrief(3)
    expect(stub).toStartWith("# Round R-03\n")
    expect(closeSection(stub)).toBe("")
    await withDir(async (dir) => {
      mkdirSync(join(dir, "docs/R-03"), { recursive: true })
      writeFileSync(join(dir, "docs/R-03/round.md"), stub)
      expect(await roundBriefText(dir, 3)).toBeUndefined()
      writeFileSync(join(dir, "docs/R-03/round.md"), stub.replace("## Goal\n", "## Goal\n\nPort the driver to arm64.\n"))
      const text = (await roundBriefText(dir, 3))!
      expect(text).toContain("Port the driver to arm64.")
      expect(text).not.toContain("<!--")
    })()
  })

  test("closeSection: missing heading → undefined; body runs to the next level-1/2 heading", () => {
    expect(closeSection("# R\n\n## Goal\n\nx\n")).toBeUndefined()
    expect(closeSection(`# R\n\n${FILLED_CLOSE}\n## Notes\n\nlater\n`)).toBe(
      "- Restated: the retry policy, in src/net/README.md.\n- Accepted as lost: none.",
    )
    expect(closeSection("## Close\n\n### Restated\n\n- a\n")).toBe("### Restated\n\n- a")
  })

  test("roles: round.md is the human-written roundBrief role (process, eof-exempt); .gitignore is outside P1 scope", () => {
    expect(roleOf("docs/R-01/round.md")).toBe("roundBrief")
    expect(roleOf("docs/R-01/P01-design/round.md")).toBe("artifact")
    expect(p1Scope("docs/R-01/round.md")).toBe(false)
    expect(p1Scope(".gitignore")).toBe(false)
    expect(p1Scope("src/main.rs")).toBe(true)
  })

  test(
    "establishRound writes the stub once for phased flows, never for m",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "amt" })
      expect(await Bun.file(join(dir, "docs/R-01/round.md")).text()).toBe(renderRoundBrief(1))
      writeFileSync(join(dir, "docs/R-01/round.md"), "# mine\n")
      await establishRound(dir, { phases: "amt" })
      expect(await Bun.file(join(dir, "docs/R-01/round.md")).text()).toBe("# mine\n")
      const other = mkdtempSync(join(tmpdir(), "auto-round-gates-m-"))
      try {
        await establishRound(other, { phases: "m" })
        expect(await Bun.file(join(other, "docs/R-01/round.md")).exists()).toBe(false)
      } finally {
        rmSync(other, { recursive: true, force: true })
      }
    }),
  )
})

describe("phase gates in completePhase (plans/0049 G7)", () => {
  test("acceptanceMark: the last Accepted: line must be exactly the sign-off", () => {
    expect(acceptanceMark("# a\n\nsummary\n")).toEqual({ present: false, accepted: false })
    expect(acceptanceMark("Accepted: yes\n")).toEqual({ present: true, accepted: true })
    expect(acceptanceMark("  Accepted: yes  \n")).toEqual({ present: true, accepted: true })
    expect(acceptanceMark("Accepted: yes\nAccepted: no\n")).toEqual({ present: true, accepted: false })
    expect(acceptanceMark("accepted: yes\n")).toEqual({ present: false, accepted: false })
    expect(acceptanceMark("Accepted: Yes\n")).toEqual({ present: true, accepted: false })
  })

  test("phaseGates: the type's own gates plus acceptance from config acceptanceGate", () => {
    const unit = (type: string) => ({ round: "R-01", id: "P01", type, entry: phaseType(type)!, dir: "" })
    expect(phaseGates(unit("design"))).toEqual([])
    expect(phaseGates(unit("design"), ["design"])).toEqual(["acceptance"])
    expect(phaseGates(unit("acceptance"))).toEqual(["verdict"])
    expect(phaseGates(unit("acceptance"), ["acceptance", "design"])).toEqual(["verdict", "acceptance"])
  })

  test(
    "acceptance gate: missing or unsigned acceptance.md holds the phase; the sign-off completes it",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "dm" })
      const design = (await readPhases(dir))!.phases[0]!
      expect(await completePhase(dir, design, ["acceptance"])).toEqual(["acceptance: docs/R-01/P01-design/acceptance.md is missing"])
      writeFileSync(join(dir, design.dir, "acceptance.md"), "# Acceptance\n\nLooks right.\n")
      expect(await completePhase(dir, design, ["acceptance"])).toEqual([
        "acceptance: docs/R-01/P01-design/acceptance.md has no `Accepted: yes` line",
      ])
      expect((await readPhases(dir))!.done.size).toBe(0)
      writeFileSync(join(dir, design.dir, "acceptance.md"), "# Acceptance\n\nLooks right.\n\nAccepted: yes\n")
      expect(await completePhase(dir, design, ["acceptance"])).toEqual([])
      expect([...(await readPhases(dir))!.done]).toEqual(["P01"])
    }),
  )

  test(
    "verdict gate: Result: FAIL holds the phase; no verdict file or line passes, like a task report",
    withDir(async (dir) => {
      await establishRound(dir, { phases: "mv" })
      const acceptance = (await readPhases(dir))!.phases[1]!
      writeFileSync(join(dir, acceptance.dir, "verdict.md"), "# Verdict\n\nResult: FAIL login flow regressed\n")
      expect(await completePhase(dir, acceptance, ["verdict"])).toEqual([
        "verdict: docs/R-01/P02-acceptance/verdict.md concludes Result: FAIL (login flow regressed)",
      ])
      writeFileSync(join(dir, acceptance.dir, "verdict.md"), "# Verdict\n\nResult: PASS\n")
      expect(await completePhase(dir, acceptance, ["verdict"])).toEqual([])
      const other = (await readPhases(dir))!.phases[0]!
      expect(await completePhase(dir, other, ["verdict"])).toEqual([])
    }),
  )
})

describe("round-close gate (plans/0049 G8)", () => {
  test(
    "empty close listing and a process reference in the deliverable are problems; .gitignore's .auto/ is not",
    withDir(async (dir) => {
      await gitRepo(dir)
      await establishRound(dir, { phases: "am" })
      mkdirSync(join(dir, "src"), { recursive: true })
      writeFileSync(join(dir, "src/lib.rs"), "// see docs/T-004/report.md for the reason\nfn main() {}\n")
      writeFileSync(join(dir, ".gitignore"), "tmp/\n.auto/\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "round")
      const close = await roundCloseProblems(dir, 1)
      expect(close.problems).toHaveLength(2)
      expect(close.problems[0]).toStartWith('process reference: src/lib.rs:1 references "docs/T-004/report.md"')
      expect(close.problems[1]).toContain("docs/R-01/round.md `## Close` is empty")
      expect(close.warnings).toEqual(["build: no build command configured (config `build`); the target build was not checked"])
      expect(roundCloseLines(close)[0]).toStartWith("⚠ round close checks")
    }),
  )

  test(
    "a clean tree, a filled close listing and a passing build pass; a failing build is a problem with its output",
    withDir(async (dir) => {
      await gitRepo(dir)
      await establishRound(dir, { phases: "am" })
      writeFileSync(join(dir, "docs/R-01/round.md"), `# Round R-01\n\n${FILLED_CLOSE}`)
      writeFileSync(join(dir, "main.c"), "int main(void) { return 0; }\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "round")
      const pass = await roundCloseProblems(dir, 1, { build: "true" })
      expect(pass).toEqual({ problems: [], warnings: [] })
      expect(roundCloseLines(pass)).toEqual(["✓ round close checks passed"])
      const fail = await roundCloseProblems(dir, 1, { build: "echo compiling; echo broken >&2; exit 3" })
      expect(fail.problems).toHaveLength(1)
      expect(fail.problems[0]).toStartWith("build: `echo compiling; echo broken >&2; exit 3` exited 3; output tail:\ncompiling\nbroken")
    }),
  )

  test(
    "untracked deliverable files are scanned too; a missing round.md is a problem",
    withDir(async (dir) => {
      await gitRepo(dir)
      mkdirSync(join(dir, "docs/R-01"), { recursive: true })
      writeFileSync(join(dir, "notes.txt"), "state lives in .auto/progress.json\n")
      const close = await roundCloseProblems(dir, 1, { build: "true" })
      expect(close.problems.map((problem) => problem.split(":")[0])).toEqual(["process reference", "close listing"])
      expect(close.problems[1]).toBe("close listing: docs/R-01/round.md is missing")
    }),
  )
})

describe("config keys acceptanceGate / build (plans/0049 G9)", () => {
  const write = (dir: string, config: object) => {
    mkdirSync(join(dir, ".opencode/auto"), { recursive: true })
    writeFileSync(join(dir, ".opencode/auto/config.json"), JSON.stringify(config))
  }

  test(
    "valid values load; absent keys stay undefined",
    withDir(async (dir) => {
      write(dir, { phases: "adm", acceptanceGate: ["design", "implement"], build: "make" })
      const config = await loadProjectConfig(dir)
      expect(config.acceptanceGate).toEqual(["design", "implement"])
      expect(config.build).toBe("make")
      write(dir, { phases: "adm" })
      const bare = await loadProjectConfig(dir)
      expect(bare.acceptanceGate).toBeUndefined()
      expect(bare.build).toBeUndefined()
    }),
  )

  test(
    "unknown types, repeats, non-arrays and an empty build are rejected",
    withDir(async (dir) => {
      for (const [value, pattern] of [
        [{ acceptanceGate: ["nope"] }, /unknown phase type\(s\) nope/],
        [{ acceptanceGate: ["design", "design"] }, /lists a phase type twice/],
        [{ acceptanceGate: "design" }, /must be an array/],
        [{ build: "" }, /build must be a non-empty string/],
      ] as const) {
        write(dir, { phases: "adm", ...value })
        await expect(loadProjectConfig(dir)).rejects.toThrow(pattern)
      }
    }),
  )
})

describe("prompt slots (plans/0049 G3/G7)", () => {
  const design = phaseType("design")!

  test("phase-plan injects the round brief with its intent rules only when there is one", () => {
    const base = { phase: design, phaseId: "R-01.P02", taskIndex: "docs/R-01/P02-design/tasks.md" }
    const withBrief = renderPhasePlan({ ...base, round: "## Goal\n\nPort the driver to arm64." })
    expect(withBrief).toContain("## Input: round brief (this round's round.md)")
    expect(withBrief).toContain("Port the driver to arm64.")
    expect(withBrief).toContain("never edit round.md")
    expect(renderPhasePlan(base)).not.toContain("round brief")
  })

  test("phase-handover asks for the acceptance draft and forbids the sign-off only when the gate is on", () => {
    const base = { phase: design, handover: "docs/R-01/P02-design/handover.md" }
    const gated = renderPhaseHandover({ ...base, acceptance: "docs/R-01/P02-design/acceptance.md" })
    expect(gated).toContain("## Artifact: acceptance draft")
    expect(gated).toContain("Never write a line starting with `Accepted:`")
    expect(gated).toContain("may write are docs/R-01/P02-design/handover.md and docs/R-01/P02-design/acceptance.md")
    expect(gated).toContain("decisions the reviewer should confirm or")
    const plain = renderPhaseHandover(base)
    expect(plain).not.toContain("acceptance draft")
    expect(plain).toContain("The only file this session may write is docs/R-01/P02-design/handover.md;")
  })
})

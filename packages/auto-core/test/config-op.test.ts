// The one init/amend sequence's engine suite (plans/0193 D4, finding
// 0165-056): runConfigSequence is the check-and-write order both shells call
// with their parsed keys, I/O adapter and wording record — this suite pins
// the engine itself, shell-neutral: 0073's git bootstrap and the identity
// prerequisite, 0122/0147's root-symlink stamps, 0137's amend retirement
// (the belt beneath both shells' shape refusals), the injected overwrite
// gates, the dropper spellings and the wording carriers (the shells' own
// e2e suites — packages/auto's e2e.test.ts, packages/auto-server's
// ops.test.ts — pin the same sequence through their entries).
import { describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, mkdir, rm, symlink, chmod } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runConfigSequence, type ConfigOpIo, type ConfigOpWording } from "../src/config-op"
import { CONFIG_DEFAULTS, CONFIG_FILE, loadProjectConfig } from "../src/config"
import { freshRepo, git } from "./fixtures/runner"
import { withDirFactory } from "./fixtures/dir"

const withDir = withDirFactory(() => freshRepo())

// A refusal captured, not thrown past the harness: the shells map refusals
// to their own surfaces (process.exit / OpOutcome); the engine's contract is
// the lines alone.
class Refused extends Error {
  constructor(readonly lines: string[]) {
    super(lines.join("\n"))
  }
}

// The I/O adapter: lines captured in order, refusals as Refused, the gates
// hook injectable per test (its calls counted — the gates themselves are the
// shell's mechanics, the engine's contract is only when the hook runs and
// what its lines do).
function makeIo(over: { gates?: ConfigOpIo["gates"] } = {}) {
  const lines: string[] = []
  let gateRuns = 0
  const io: ConfigOpIo & { lines: string[]; gateRuns: () => number } = {
    lines,
    line: (text) => lines.push(text),
    refuse: (refusalLines) => {
      throw new Refused(refusalLines)
    },
    gates: over.gates ?? (async () => undefined),
    gateRuns: () => gateRuns,
  }
  const inner = io.gates
  io.gates = async (context) => {
    gateRuns++
    return inner(context)
  }
  return io
}

// The wording carriers, both shells' shapes (the CLI's and the request
// grammar's own records, restated here so the carrier threading is pinned):
// initClosing's arguments are captured — the phased/established/round facts
// the engine derives and hands the shell's own closing line.
function makeWording(shape: "cli" | "api"): ConfigOpWording & { initClosingArgs: (phased: boolean, established: boolean, round: number) => void } {
  const calls: unknown[][] = []
  return {
    initClosingArgs: (...args: unknown[]) => calls.push(args),
    modeKey: shape === "cli" ? "--mode" : "config.mode",
    handoverKey: shape === "cli" ? "--handover-test" : "config.handoverTest",
    handoverTestKey: shape === "cli" ? "--test-by-driver" : "config.testByDriver: true",
    handoverRemedy:
      shape === "cli"
        ? "give --test-by-driver as well (or --handover-test false)"
        : 'send both ({"config":{"testByDriver":true,"handoverTest":true}}), or handoverTest false',
    intentKey: shape === "cli" ? "--intent" : "config.intent",
    intentTail: "",
    identityPairRemedy: shape === "cli" ? ", or pass --name <name> --email <email>" : "",
    amendGiven: "the given keys",
    initClosing: (phased, established, round) => {
      calls.push([phased, established, round])
      return `closing(phased=${phased}, established=${established}, round=${round})`
    },
  } as ConfigOpWording & { initClosingArgs: (phased: boolean, established: boolean, round: number) => void }
}

describe("runConfigSequence: init's git halves (0073, 0122/0147, 0138)", () => {
  test(
    "a plain directory inside no work tree is bootstrapped, loudly — in-repo init changes nothing",
    async () => {
      // The S29-04 mechanism, engine half: the service shell's init used to
      // skip the bootstrap entirely (a plain directory accepted, every run
      // after it completing with no commit anywhere); the engine carries the
      // CLI's own ruling for every shell.
      const plain = await mkdtemp(join(tmpdir(), "auto-configop-nogit-"))
      try {
        const io = makeIo()
        await runConfigSequence({ kind: "init", dir: plain, keys: { explicit: {} }, io, wording: makeWording("api"), identity: { name: "t", email: "t@t" } })
        expect(io.lines.some((line) => line.startsWith("✓ initialized git repository (branch ") && line.includes(" — the driver's record and rollback need it"))).toBe(true)
        expect(join(plain, ".git", "HEAD")).toBeTruthy()
        expect(await Bun.file(join(plain, ".git", "HEAD")).exists()).toBe(true)
        expect(JSON.parse(await Bun.file(join(plain, CONFIG_FILE)).text()).phases).toBe("m")
      } finally {
        await rm(plain, { recursive: true, force: true })
      }
      // The floor: a directory already inside a work tree prints no
      // bootstrap line.
      await withDir(async (dir) => {
        const io = makeIo()
        await runConfigSequence({ kind: "init", dir, keys: { explicit: {} }, io, wording: makeWording("cli") })
        expect(io.lines.some((line) => line.startsWith("✓ initialized git repository"))).toBe(false)
      })
    },
  )

  test(
    "a repository that cannot commit is refused before any write; the identity pair is the repository-local remedy",
    async () => {
      await withDir(async (dir) => {
        // Blank the identity locally — the deterministic shape of a fresh
        // environment (a locally blanked value overrides any global config).
        await git(dir, "config", "user.name", "")
        await git(dir, "config", "user.email", "")
        const wording = makeWording("cli")
        const io = makeIo()
        let refused: Refused | undefined
        try {
          await runConfigSequence({ kind: "init", dir, keys: { explicit: {} }, io, wording })
        } catch (error) {
          refused = error as Refused
        }
        expect(refused).toBeInstanceOf(Refused)
        expect(refused!.lines[0]).toContain("git cannot commit in")
        expect(refused!.lines[0]).toContain(", or pass --name <name> --email <email>")
        // A refusal leaves nothing written (every check precedes the first
        // write — the bootstrap's empty repository aside).
        expect(await Bun.file(join(dir, CONFIG_FILE)).exists()).toBe(false)
        // The request grammar's identity refusal carries no flag-pair clause
        // (a request body has no --name/--email fields).
        const apiWording = makeWording("api")
        let apiRefused: Refused | undefined
        try {
          await runConfigSequence({ kind: "init", dir, keys: { explicit: {} }, io: makeIo(), wording: apiWording })
        } catch (error) {
          apiRefused = error as Refused
        }
        expect(apiRefused!.lines[0]).toContain("git cannot commit in")
        expect(apiRefused!.lines[0]).not.toContain("--name")
        // The identity pair writes repository-local config and prints its
        // line — never --global.
        const withIdentity = makeIo()
        await runConfigSequence({ kind: "init", dir, keys: { explicit: {} }, io: withIdentity, wording: makeWording("cli"), identity: { name: "ops", email: "ops@t" } })
        expect(withIdentity.lines).toContain("✓ commit identity written as repository-local config (user.name/user.email from --name/--email; never --global)")
        expect((await git(dir, "config", "--local", "user.name")).trim()).toBe("ops")
        expect((await git(dir, "config", "--local", "user.email")).trim()).toBe("ops@t")
      })
    },
  )

  test(
    "the root-symlink read-only stamps ride every shell's init; no root symlinks writes nothing (0122/0147)",
    async () => {
      await withDir(async (dir) => {
        const corpus = await mkdtemp(join(tmpdir(), "auto-configop-corpus-"))
        try {
          await symlink(corpus, join(dir, "linux"))
          const io = makeIo()
          await runConfigSequence({ kind: "init", dir, keys: { explicit: {} }, io, wording: makeWording("api") })
          expect(io.lines.some((line) => line.startsWith("stamped: opencode.json the root-symlink read-only stamps (external_directory allow + edit deny) for linux"))).toBe(true)
          const permission = JSON.parse(await Bun.file(join(dir, "opencode.json")).text()).permission
          expect(permission.external_directory[`${realpathSync(corpus)}/**`]).toBe("allow")
          expect(permission.edit[`${realpathSync(corpus)}/**`]).toBe("deny")
          // amend never stamps (init's halves alone).
          const amendIo = makeIo()
          await runConfigSequence({ kind: "amend", dir, keys: { explicit: { contextLimit: 96 } }, io: amendIo, wording: makeWording("api") })
          expect(amendIo.lines.some((line) => line.startsWith("stamped:"))).toBe(false)
        } finally {
          await rm(corpus, { recursive: true, force: true })
        }
        // The floor: a tree with no root symlinks writes no stamp lines.
        const plain = await freshRepo()
        try {
          const io = makeIo()
          await runConfigSequence({ kind: "init", dir: plain, keys: { explicit: {} }, io, wording: makeWording("cli") })
          expect(io.lines.some((line) => line.startsWith("stamped:"))).toBe(false)
          // 0138's committed-surfaces teaching rides the gitignore closing
          // line on every shell (the service shell's mirror dropped it).
          expect(io.lines.some((line) => line.startsWith("updated: .gitignore now ignores ") && line.includes("the file itself and opencode.json are committed project surfaces — commit them with the config layer"))).toBe(true)
        } finally {
          await rm(plain, { recursive: true, force: true })
        }
      })
    },
  )
})

describe("runConfigSequence: amend's shape (0137, droppers, gates, wordings)", () => {
  test(
    "the phases key on amend is refused by the engine itself — the belt beneath both shells' shape refusals",
    async () => {
      await withDir(async (dir) => {
        await runConfigSequence({ kind: "init", dir, keys: { explicit: { phases: "am" } }, io: makeIo(), wording: makeWording("cli") })
        let refused: Refused | undefined
        try {
          await runConfigSequence({ kind: "amend", dir, keys: { explicit: { phases: "m" } }, io: makeIo(), wording: makeWording("api") })
        } catch (error) {
          refused = error as Refused
        }
        expect(refused).toBeInstanceOf(Refused)
        expect(refused!.lines[0]).toContain("the phases key is retired on amend")
        expect(refused!.lines[0]).toContain("`- R-NN <phases> — <goal>` line in docs/analysis.md")
        // The config is untouched by the refusal.
        expect((await loadProjectConfig(dir)).phases).toBe("am")
      })
    },
  )

  test(
    "the dropper spellings delete their keys; the amend closing line carries the shell's given-keys text",
    async () => {
      await withDir(async (dir) => {
        await runConfigSequence({
          kind: "init",
          dir,
          keys: { explicit: { agent: "claude", parallel: "low", treeLanes: "on", scanExempt: ["vendor/"], isolate: ["nested"] } },
          io: makeIo(),
          wording: makeWording("cli"),
        })
        let configured = await loadProjectConfig(dir)
        expect(configured.agent).toBe("claude")
        expect(configured.parallel).toBe("low")
        expect(configured.treeLanes).toBe("on")
        expect(configured.scanExempt).toEqual(["vendor/"])
        expect(configured.isolate).toEqual(["nested"])
        // The scanExempt/isolate carriers need a real target for the
        // isolate path validation on the CLI; through the engine they ride
        // as parsed lists ([] = the dropper).
        const io = makeIo()
        await runConfigSequence({
          kind: "amend",
          dir,
          keys: { explicit: {}, agent: "opencode", parallel: "none", treeLanes: "off", scanExempt: [], isolate: [] },
          io,
          wording: makeWording("api"),
        })
        configured = await loadProjectConfig(dir)
        expect(configured.agent).toBeUndefined()
        expect(configured.parallel).toBeUndefined()
        expect(configured.treeLanes).toBeUndefined()
        expect(configured.scanExempt).toBeUndefined()
        expect(configured.isolate).toBeUndefined()
        expect(io.lines).toContain("✓ amended (the given keys); the other keys are unchanged. Review the change and commit it")
      })
    },
  )

  test(
    "the brief revision replaces the file (write-tmp-then-rename): a read-only brief is healed, not a thrown EACCES (plans/0215 D3)",
    async () => {
      // The read-only brief (a killed run's stale protect bit) is the
      // deterministic stand-in for the crash mid-write: the pre-fix
      // in-place Bun.write answers EACCES out of the sequence, the rename
      // replaces the entry and the revision lands.
      await withDir(async (dir) => {
        await runConfigSequence({ kind: "init", dir, keys: { explicit: {} }, io: makeIo(), wording: makeWording("cli") })
        const brief = join(dir, ".opencode/auto/brief.md")
        await Bun.write(brief, "first revision\n")
        await chmod(brief, 0o444)
        try {
          const io = makeIo()
          await runConfigSequence({ kind: "amend", dir, keys: { explicit: {} }, briefSeed: "second revision", io, wording: makeWording("cli") })
          expect(await Bun.file(brief).text()).toBe("second revision\n")
          expect(io.lines).toContain("replaced: .opencode/auto/brief.md (the brief, verbatim)")
        } finally {
          await chmod(brief, 0o644).catch(() => {})
        }
      })
    },
  )

  test(
    "the gates hook runs on plain init over an existing config alone; its lines refuse; amend and fresh init never gate",
    async () => {
      await withDir(async (dir) => {
        let gateRuns = 0
        const gating = makeIo({
          gates: async () => {
            gateRuns++
            return ["the tree is dirty"]
          },
        })
        await runConfigSequence({ kind: "init", dir, keys: { explicit: {} }, io: makeIo(), wording: makeWording("cli") })
        expect(gateRuns).toBe(0)
        // Fresh init above wrote the config; init again over it gates.
        let refused: Refused | undefined
        try {
          await runConfigSequence({ kind: "init", dir, keys: { explicit: {} }, io: gating, wording: makeWording("cli") })
        } catch (error) {
          refused = error as Refused
        }
        expect(refused).toBeInstanceOf(Refused)
        expect(refused!.lines).toEqual(["the tree is dirty"])
        expect(gateRuns).toBe(1)
        // amend never gates (it discards no key).
        const amendIo = makeIo({ gates: async () => {
          gateRuns++
          return ["never"]
        } })
        await runConfigSequence({ kind: "amend", dir, keys: { explicit: { contextLimit: 32 } }, io: amendIo, wording: makeWording("cli") })
        expect(gateRuns).toBe(1)
      })
    },
  )

  test(
    "handoverTest requires testByDriver on the effective values — the remedy clause through the wording carrier",
    async () => {
      await withDir(async (dir) => {
        let refused: Refused | undefined
        try {
          await runConfigSequence({ kind: "init", dir, keys: { explicit: { handoverTest: true } }, io: makeIo(), wording: makeWording("api") })
        } catch (error) {
          refused = error as Refused
        }
        expect(refused).toBeInstanceOf(Refused)
        expect(refused!.lines[0]).toContain("config.handoverTest requires config.testByDriver: true")
        expect(refused!.lines[0]).toContain('send both ({"config":{"testByDriver":true,"handoverTest":true}}), or handoverTest false')
        // An amend turning test-by-driver off under a stored handoverTest is
        // caught on the same effective-values rule.
        await runConfigSequence({ kind: "init", dir, keys: { explicit: { testByDriver: true, handoverTest: true } }, io: makeIo(), wording: makeWording("cli") })
        let amendRefused: Refused | undefined
        try {
          await runConfigSequence({ kind: "amend", dir, keys: { explicit: { testByDriver: false } }, io: makeIo(), wording: makeWording("cli") })
        } catch (error) {
          amendRefused = error as Refused
        }
        expect(amendRefused).toBeInstanceOf(Refused)
        expect(amendRefused!.lines[0]).toContain("the existing handoverTest requires --test-by-driver")
      })
    },
  )

  test(
    "a full overwrite names each retired key it drops; init's closing line derives phased/established/round for the shell's carrier",
    async () => {
      await withDir(async (dir) => {
        await mkdir(join(dir, ".opencode", "auto"), { recursive: true })
        await Bun.write(join(dir, CONFIG_FILE), `${JSON.stringify({ ...CONFIG_DEFAULTS, commit: false }, null, 2)}\n`)
        const io = makeIo()
        const wording = makeWording("cli")
        await runConfigSequence({ kind: "init", dir, keys: { explicit: {} }, io, wording })
        expect(io.lines.some((line) => line.startsWith("⚠ full overwrite drops the retired key commit = false"))).toBe(true)
        // The fresh project: m mode by default, no round established, R-01.
        expect(io.lines).toContain("closing(phased=false, established=false, round=1)")
        expect(JSON.parse(await Bun.file(join(dir, CONFIG_FILE)).text()).commit).toBeUndefined()
      })
    },
  )
})

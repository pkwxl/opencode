import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"
import { taskStatePaths } from "@opencode-ai/auto-core/tasks"
import { RUN_LOCK_FILE } from "@opencode-ai/auto-core/lock"
import { CONFIG_DEFAULTS } from "@opencode-ai/auto-core/config"
import { createServices, installServices, services } from "@opencode-ai/auto-core/services"
import { completePhase, readPhases } from "@opencode-ai/auto-core/phases"
import { establishRoundSetup } from "@opencode-ai/auto-core/plan"
import { manage } from "@opencode-ai/auto-core/agent/opencode/server"
import { askClassifier, classifierFor } from "@opencode-ai/auto-core/classify"
import type { AgentClient, AgentEvent } from "@opencode-ai/auto-core/agent/types"
import { bundleFileMap, parseIntentBundle, resolveIntentBundle } from "@opencode-ai/auto-core/bundle"
import { provenanceStampOf, renderProvenanceStamp } from "@opencode-ai/auto-core/provenance"
import type { RoutingFacts } from "@opencode-ai/auto-core/routing"

// Opt-in end-to-end test: requires `opencode` on PATH (or
// OPENCODE_AUTO_SERVER pointing at a running serve) plus provider credentials.
//   OPENCODE_AUTO_E2E=1 bun test test/e2e.test.ts
const E2E = process.env.OPENCODE_AUTO_E2E === "1"

// List tasks in a phase's task index with their todo.md (the unit layout,
// M3.4): [id, title, body] each.
async function listTasks(dir: string, phaseDir: string, phase: string, tasks: [string, string, string][]) {
  await Bun.write(join(dir, phaseDir, "tasks.md"), `# Tasks\n\n${tasks.map(([id, title]) => `- [ ] ${id} ${title}\n`).join("")}`)
  for (const [id, title, body] of tasks) {
    await Bun.write(join(dir, "docs", id, "todo.md"), `# ${id}: ${title}\nPhase: ${phase}\n\n## Goal\n\n${body}\n`)
  }
}

const P01 = { round: "R-01", id: "P01", dir: "docs/R-01/P01-implement" }

// Mark the current round's phases of these preset letters complete, the way
// the driver does (completePhase: todo.md → done.md + index tick).
async function completeLetters(dir: string, letters: string[]) {
  for (const unit of (await readPhases(dir))!.phases) if (letters.includes(unit.entry.letter ?? "")) await completePhase(dir, unit)
}

// Fill in the round brief's `## Close` restatement listing, which the
// round-close gate requires before the next round opens (plans/0049 G8;
// plan's prelude enforces it), and the round user report (plans/0081 D4 — a
// run self-heals one through an appended report task; the fixture writes it
// directly).
async function fillClose(dir: string, round = "R-01") {
  await Bun.write(join(dir, `docs/${round}/round.md`), `# Round ${round}\n\n## Close\n\n- Restated: none needed.\n- Accepted as lost: none.\n`)
  await Bun.write(join(dir, `docs/${round}/report-for-user.md`), `# Round report\n\nThe round's account for the person.\n\n<!-- auto: eof -->\n`)
}

// The key-ring mechanics against the real opencode CLI, without any
// provider traffic (plans/0055 §13 S3): the managed spawn injects the ring's
// current key as a config reference — opencode substitutes the {env:}
// reference in its own process (F5) and a config apiKey wins over the
// ambient OPENAI_API_KEY in the generic provider path (F6) — and a rotation
// re-spawn (setConfig + restart) applies the next key. Only needs
// `opencode` on PATH:
//   OPENCODE_AUTO_E2E=1 bun test test/e2e.test.ts -t "key injection"
// The apiKey values are dummies; no request is ever sent through them.
test.skipIf(!E2E)(
  "the managed spawn injects the ring's key reference and a rotation re-spawn applies the next key (opencode CLI, no provider traffic)",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-e2e-keycfg-"))
    const ringConfig = (ref: string) => ({ provider: { openai: { options: { apiKey: ref } } } })
    // manage() is opencodeHost's core: the OpencodeHost it returns exposes
    // the server URL and setConfig, the two surfaces this check reads.
    const host = await manage(dir, undefined, {
      log: () => {},
      env: { RING_SMOKE_KEY_A: "ring-smoke-key-a", RING_SMOKE_KEY_B: "ring-smoke-key-b" },
      config: ringConfig("{env:RING_SMOKE_KEY_A}"),
    })
    try {
      // The effective key of the generic path is options.apiKey — the auth
      // record's `key` (env/auth.json) fills in only when it is unset
      // (packages/opencode/src/provider/provider.ts), so this asserts both
      // the {env:} substitution in the server's own process (F5) and the
      // config key winning over the ambient credential (F6).
      const keyOf = async (): Promise<string | undefined> => {
        const res = await fetch(new URL("/config/providers", host.url))
        const body = (await res.json()) as { providers: { id: string; options?: { apiKey?: string } }[] }
        return body.providers.find((provider) => provider.id === "openai")?.options?.apiKey
      }
      expect(await keyOf()).toBe("ring-smoke-key-a")
      // Rotation's mechanism: the next key goes into the spawn config and
      // the restart re-spawns the server on it.
      if (host.setConfig === undefined) throw new Error("the opencode host exposes no setConfig")
      host.setConfig(ringConfig("{env:RING_SMOKE_KEY_B}"))
      expect(await host.restart("key ring smoke: rotate onto the next key")).toBe(true)
      expect(await keyOf()).toBe("ring-smoke-key-b")
    } finally {
      host.close()
    }
  },
  { timeout: 60_000 },
)

// The failure-message classifier's tool denial against a real server and a
// real model (auto-core plans/0055 §7.1, §13 S3): a bare prompt — the v2
// body's `tools: {"*": false}` — must leave the model with no tool at all.
// A control turn in the same directory first shows the model does read the
// planted file when it has tools; the bare turn, asked the same, must call
// no tool and cannot quote the file, and the session stores the deny-all
// rule. Last, one real classifier call parses the model's reply. Opt-in and
// naming the model (the operator's own opencode credentials apply; a few
// hundred tokens):
//   OPENCODE_AUTO_E2E=1 OPENCODE_AUTO_E2E_CLASSIFIER="prov/model" bun test test/e2e.test.ts -t "bare prompt"
const CLASSIFIER_MODEL = process.env.OPENCODE_AUTO_E2E_CLASSIFIER ?? ""

test.skipIf(!(E2E && CLASSIFIER_MODEL.includes("/")))(
  "a bare prompt denies every tool on a real opencode server, and a real classifier call parses (auto-core plans/0055 §7.1)",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-e2e-bare-"))
    const word = `PLANTED-${crypto.randomUUID().slice(0, 8)}`
    await writeFile(join(dir, "probe.txt"), `The secret word is ${word}.\n`)
    const host = await manage(dir, undefined, { log: () => {} })
    // One turn on a fresh session: its tool parts and closing words.
    const turn = async (client: AgentClient, bare: boolean) => {
      const created = await client.create({ title: bare ? "auto e2e: bare" : "auto e2e: control" })
      if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created.error)}`)
      const session = created.value.id
      const stop = new AbortController()
      const events = await client.events(stop.signal)
      const tools: string[] = []
      const texts = new Map<string, string>()
      const failures: string[] = []
      const reading = (async () => {
        for await (const event of events as AsyncIterable<AgentEvent>) {
          if (event.session !== session) continue
          if (event.type === "part" && event.part.kind === "tool") tools.push(event.part.tool)
          // The prompt's own text part arrives too, never final.
          if (event.type === "part" && event.part.kind === "text" && event.part.final) texts.set(event.part.id, event.part.text)
          if (event.type === "error") failures.push(event.error.message ?? event.error.name ?? "error")
          if (event.type === "permission") await client.replyPermission(event.request, "reject")
          if (event.type === "idle") return
        }
      })()
      const sent = await client.prompt({
        session,
        model: CLASSIFIER_MODEL,
        text: "Use your file-reading tool to read the file probe.txt in the current directory, then reply with the secret word it contains. If you have no tool that can read files, reply exactly: NO TOOLS",
        ...(bare ? { bare: true } : {}),
      })
      await Promise.race([reading, Bun.sleep(180_000)])
      stop.abort()
      return { session, sent, tools, reply: [...texts.values()].join("\n"), failures }
    }
    try {
      const control = await turn(host.client, false)
      expect(control.failures).toEqual([])
      expect(control.tools.length).toBeGreaterThan(0)
      expect(control.reply).toContain(word)
      const bare = await turn(host.client, true)
      expect(bare.sent.ok).toBe(true)
      expect(bare.failures).toEqual([])
      expect(bare.tools).toEqual([])
      expect(bare.reply).not.toContain(word)
      // The rule opencode stored on the session: every permission denied.
      const stored = (await (await fetch(new URL(`/session/${bare.session}`, host.url))).json()) as { permission?: { permission: string; action: string; pattern: string }[] }
      expect(stored.permission).toEqual([{ permission: "*", action: "deny", pattern: "*" }])
      // One real classifier call: the reply parses into one of the classes.
      // The classifier's state (the answer cache, the budget) is the run
      // router's now; a fresh services instance is the reset.
      installServices(createServices())
      const routing: RoutingFacts = {
        registry: {
          layers: [{ name: "operator", path: "/unused/models.json" }],
          tz: "Asia/Shanghai",
          agents: new Map([["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }]]),
          models: new Map([["free", { name: "free", layer: "operator", agent: "opencode", model: CLASSIFIER_MODEL, provider: CLASSIFIER_MODEL.split("/")[0] }]]),
          tiers: {},
          routes: new Map(),
          unused: [],
          classifier: { names: ["free"], layer: "operator" },
        },
        agentFilter: "opencode",
        filterSource: undefined,
        defaultAgent: "opencode",
        runAgent: "opencode",
        // The facts carry the run services' clock and router shapes; this
        // one-off call reads the wall clock and the process-default router,
        // like a run would.
        router: services().router,
        clock: { now: () => Date.now(), sleep: (ms: number) => Bun.sleep(ms), sleepUnlessExit: async () => false, timer: () => () => {} },
      }
      const answer = await askClassifier(classifierFor(host.client, routing)!, {
        message: "Your plan's monthly allowance has been used up. It renews at 03:00 tomorrow.",
        statusCode: 429,
      })
      expect(answer).toBeDefined()
      expect(["quota", "rate", "auth", "transient", "unknown"]).toContain(answer!.class)
    } finally {
      installServices(createServices())
      host.close()
      await rm(dir, { recursive: true, force: true })
    }
  },
  { timeout: 600_000 },
)

// CLI parsing cases need no opencode or provider credentials and always run:
// the source entry runs as a subprocess, usage errors asserted through stderr
// messages and exit code 1; valid combinations exit 1 on an empty directory
// ("no plan file found" — parsing fully passed, before any server spawns),
// proving no valid combination is misreported as a usage error.
// The subprocess never inherits the ambient OPENCODE_AUTO_* layer (this test
// process's own driver environment — a hibernate window would make every run
// sleep, a model policy would reroute): the base is a scrubbed copy, and a
// case that wants a switch passes it in `env`, merged on top.
// Nor does it read the operator's model registry: run and plan load its
// operator layer at every start ($OPENCODE_AUTO_MODELS, scrubbed above, or
// $XDG_CONFIG_HOME/opencode-auto/models.json), so the base points
// XDG_CONFIG_HOME at an empty directory. The in-process half is the package
// preload's (test/preload.ts, plans/0232 D1): this process's
// OPENCODE_AUTO_MODELS names a file that does not exist (no operator layer,
// no XDG fallback), while XDG_CONFIG_HOME stays real for the opt-in
// in-process checks above — they start a real opencode server in this
// process and need the operator's real opencode config for it (the push
// runs' opt-in e2e went with the loop, auto-core plans/0314).
// AUTO-DECISION: subprocesses get an empty XDG_CONFIG_HOME, this process an OPENCODE_AUTO_MODELS naming a missing file (a missing file is no operator layer, with no XDG fallback, and the in-process runs keep the real opencode config they need; the pointer is owned by the preload, not this file)

// The suite also pins git's global config (T-127): hosts without a global
// identity fail every committing path (init's prerequisite check refuses
// "git cannot commit"), and a host without init.defaultBranch inits master
// (git 2.43's default), flipping the lane merge-instruction literal below.
// GIT_CONFIG_GLOBAL points every git this suite spawns at one temp config
// carrying [user] name/email and [init] defaultBranch=main: the subprocess
// side through the scrubbed base (beside the empty XDG_CONFIG_HOME), this
// process's own fixture spawns (gitOf and the inline `git -C` calls read
// process.env) through the module-level assignment. Never
// GIT_AUTHOR_*/GIT_COMMITTER_* instead: env-level identity overrides every
// config layer, which would break auto-core's deliberate identity-fallback
// tests (test/git.test.ts) — and the init identity-prerequisite case must
// neutralize GIT_CONFIG_GLOBAL itself to keep its no-identity premise.
// AUTO-DECISION: one shared temp [user]+[init] defaultBranch=main config wired as GIT_CONFIG_GLOBAL for both environments (host-independent identity and initial branch in one place; the pinned `merge main into …` lane expectation stays an assertion of the real main-tree branch, not a weakened literal)
const EMPTY_CONFIG_HOME = mkdtempSync(join(tmpdir(), "auto-cli-xdg-"))
process.on("exit", () => rmSync(EMPTY_CONFIG_HOME, { recursive: true, force: true }))
const GIT_TEST_CONFIG_DIR = mkdtempSync(join(tmpdir(), "auto-cli-git-"))
const GIT_TEST_CONFIG = join(GIT_TEST_CONFIG_DIR, "gitconfig")
writeFileSync(GIT_TEST_CONFIG, "[user]\n\tname = auto e2e\n\temail = auto-e2e@example.com\n[init]\n\tdefaultBranch = main\n")
process.on("exit", () => rmSync(GIT_TEST_CONFIG_DIR, { recursive: true, force: true }))
process.env.GIT_CONFIG_GLOBAL = GIT_TEST_CONFIG
const CLI_ENV_BASE: Record<string, string | undefined> = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^OPENCODE_AUTO_/.test(key))),
  XDG_CONFIG_HOME: EMPTY_CONFIG_HOME,
  GIT_CONFIG_GLOBAL: GIT_TEST_CONFIG,
  // The assisted project analysis (auto-core plans/0084) is pinned off for
  // this suite's flows: they exercise the driver's core grammar over direct
  // round establishment (the switch's documented degrade — "off skips the
  // analysis and establishes R-01 directly, as plan always did"), which is
  // what their establish/plan/run expectations were written against. The
  // analysis flow itself is the opt-in half: the tests that pin it (the
  // transfer project-start shapes) pass OPENCODE_AUTO_ANALYSIS=on per
  // invocation, beside the core plan suites' rows-0 coverage.
  OPENCODE_AUTO_ANALYSIS: "off",
}

async function runCli(args: string[], env?: Record<string, string>) {
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, "..", "src", "index.ts"), ...args], {
    cwd: join(import.meta.dir, ".."),
    env: env ? { ...CLI_ENV_BASE, ...env } : CLI_ENV_BASE,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return { code: await proc.exited, out, err }
}

// Commit everything under a fixture repository — the production person's
// "review and commit" step between init/plan and the next gated command.
// Since init bootstraps a repository in a fresh directory (auto-core
// plans/0073), every artifact an init/plan/completePhase writes stays
// uncommitted until someone commits it: the overwrite clean-tree gate, the
// round-start gate and run's pre-run baseline all bind from the moment the
// bootstrap creates the repository. The env is passed explicitly (Bun's
// default spawn env is the start snapshot; the pinned suite identity rides
// process.env, gitOf's rule).
async function commitFixture(dir: string) {
  for (const args of [["add", "-A"], ["commit", "-qm", "fixture checkpoint"]]) {
    const proc = Bun.spawn(["git", "-C", dir, ...args], { env: { ...process.env }, stdout: "ignore", stderr: "pipe" })
    const err = await new Response(proc.stderr).text()
    if ((await proc.exited) !== 0) throw new Error(`git -C ${dir} ${args.join(" ")}: ${err}`)
  }
}

// Establish the current round in-process, the way the daemon's transfer
// operation does (plans/0283: the local plan/transfer commands are retired —
// establishRoundSetup is the one establishment home both advanced through,
// now the daemon's alone). The setup is left uncommitted exactly as the CLI
// commands left it: the person's round-start review commits it (the fixtures'
// commitFixture/git commits below).
async function establish(dir: string, phases: string, isolate: string[] = []) {
  const result = await establishRoundSetup(dir, 1, { phases, ...(isolate.length ? { isolate } : {}) })
  if (result.type !== "ok") throw new Error(`the in-process round establishment refused: ${JSON.stringify(result).slice(0, 400)}`)
  return result
}

// A git helper over a fixture dir: asserts exit 0 and returns stdout. The
// close / --force-close / new-project-flow fixtures all commit through it.
// The env is passed explicitly: Bun's default spawn env is the snapshot from
// process start, so the module-level GIT_CONFIG_GLOBAL assignment (the pinned
// identity and init.defaultBranch, T-127) would never reach a default-env
// spawn — this way the fixture side sees the same pinned config the CLI
// subprocesses do.
const gitOf = (dir: string) => {
  return async (...args: string[]) => {
    const proc = Bun.spawn(["git", "-C", dir, ...args], { env: { ...process.env }, stdout: "pipe", stderr: "pipe" })
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    expect(code, `git ${args.join(" ")}: ${err}`).toBe(0)
    return out
  }
}

// The fake agent's helper retired with the run/plan/transfer fixtures
// (plans/0283): every suite that drove sessions through the fake `claude` on
// PATH (the lane isolation/scheduler/stream families, the append/new-project
// flows, the subtask-auto split, the branch-isolation round trip, the sealed
// wall) is demolished with its commands — the executor protocol's grants are
// claimed by external coding agents, and the shell drives no session.

describe("CLI parsing: run-side options and the config", () => {
  // The frozen-key case was ONE test looping every row of the families
  // below — ~25 CLI spawns (16 frozen flags + 9 arms), 3.4 s at HEAD on
  // this host and 4.14 s on the 0166 step-073 host, deterministically past
  // the suite-timing family's guideline (each test under roughly half
  // bun's 5 s per-test default — 0224 D4's split rule, S00-01's breach
  // class; split by 0241 D4, discharging 0233 D3's deferral at its named
  // home). The repair is the split, never a raised timeout: every row and
  // assertion retained verbatim, one family per test on its own fresh dir
  // — a family that grows past the budget splits again the same way (the
  // rule, not a one-time repair); growth of the frozen vocabulary grows
  // the TEST COUNT, never one test's runtime. The server's own frozen-key
  // case is the precedent form (packages/auto-server/test/worker.test.ts,
  // 0233 D2 enacting 0224 D4's deferred half).
  // plans/0283 re-keyed the frozen-key family to close (and land — the strict
  // ladder the two share): run's own refusal is its retirement notice now,
  // pinned in the push-retired describe below, and the frozen-key texts the
  // revision table renders still need their live consumer.
  test("close refuses the options frozen by init (exit code 1 + the amend revision hint)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-frozen-"))
    try {
      const fixed = [
        ["-m", "migrate"],
        ["--mode", "migrate"],
        ["--agent", "claude"],
        ["--context-limit", "64"],
        ["--subtask", "auto"],
        ["--idle-time", "10"],
        ["--idle-max", "0"],
        ["--test-by-driver"],
        ["--handover-test"],
        ["--auto-number"],
        ["--no-auto-number"],
        ["--wrapup"],
        ["--no-wrapup"],
        ["--parallel", "low"],
        // The execution tier (auto-core plans/0096 D10): frozen like every
        // constitutional key, revised through amend.
        ["--tree-lanes", "auto"],
        ["--scan-exempt", "test/fixtures/**"],
      ]
      for (const extra of fixed) {
        const refused = await runCli(["close", "T-001", dir, "--reason", "r", ...extra])
        expect(refused.code).toBe(1)
        expect(refused.err).toContain("was frozen by init")
        expect(refused.err).toContain(".opencode/auto/config.json")
        expect(refused.err).toContain("opencode-auto amend <dir>")
        expect(refused.err).toContain("close takes no config options")
      }
      // run answers its retirement notice ahead of the whole flag policy
      // (the notice carries no flag vocabulary at all)
      const run = await runCli(["run", dir, "--mode", "migrate"])
      expect(run.code).toBe(1)
      expect(run.err).toContain("run is retired (plans/0283):")
      expect(run.err).not.toContain("was frozen by init")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("--phases is frozen with the roadmap-line remedy, never the amend command 0137 retired", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-frozen-phases-"))
    try {
      // plans/0193 D2, 0165-056/S29-07: the old hint taught
      // `opencode-auto amend --phases`, which answers with its own
      // retirement refusal — one more round trip away from the true channel.
      const phasesFrozen = await runCli(["close", "T-001", dir, "--reason", "r", "--phases", "admtvk"])
      expect(phasesFrozen.code).toBe(1)
      expect(phasesFrozen.err).toContain("--phases was frozen by init")
      expect(phasesFrozen.err).toContain("a round's phases reshape by moving or adding its `- R-NN <phases> — <goal>` line in docs/analysis.md")
      expect(phasesFrozen.err).not.toContain("amend <dir> --phases")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the on/off pairs' revision hints take the paired form", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-frozen-pairs-"))
    try {
      // The auto-numbering pair's revision hint takes the paired form
      const numbering = await runCli(["close", "T-001", dir, "--reason", "r", "--auto-number"])
      expect(numbering.err).toContain("--auto-number (use --no-auto-number to turn off)")
      // The wrapup pair's revision hint takes the paired form
      const wrapup = await runCli(["close", "T-001", dir, "--reason", "r", "--wrapup"])
      expect(wrapup.err).toContain("--wrapup (use --no-wrapup to turn off)")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("-m/--mode's message has the same shape (the short form carries the revision hint)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-frozen-shortform-"))
    try {
      expect((await runCli(["close", "T-001", dir, "--reason", "r", "-m", "migrate"])).err).toContain("-m/--mode was frozen by init")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the retired flags answer with their retirement notices, never the amend guidance", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-frozen-retired-"))
    try {
      // --commit is no longer a frozen config flag: the flag went with the
      // config key (committing cannot be turned off), so any form of it gets
      // the retirement notice instead of the amend guidance
      const retiredCommit = await runCli(["init", dir, "--commit", "true"])
      expect(retiredCommit.code).toBe(1)
      expect(retiredCommit.err).toContain("--commit is retired")
      expect(retiredCommit.err).not.toContain("was frozen by init")
      // The --commit-subtask removal message is kept
      const removed = await runCli(["init", dir, "--commit-subtask"])
      expect(removed.code).toBe(1)
      expect(removed.err).toContain("--commit-subtask removed")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the watchdog's old names get the rename hint", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-frozen-renamed-"))
    try {
      const renamed = await runCli(["init", dir, "--verify-idle", "10"])
      expect(renamed.code).toBe(1)
      expect(renamed.err).toContain("was renamed to --idle-time")
      expect((await runCli(["init", dir, "--verify-max", "30"])).err).toContain("was renamed to --idle-max")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("--handover-test requires --test-by-driver (init's constitutional check; run already refuses the whole flag)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-frozen-lonely-"))
    try {
      const lonely = await runCli(["init", dir, "--handover-test"])
      expect(lonely.code).toBe(1)
      expect(lonely.err).toContain("--handover-test requires --test-by-driver")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("unknown-option interception: a mistyped flag exits 1 with near-name hints; status refuses any option; intercepted before any write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      // init side: a mistyped flag is no longer silently ignored
      const typo = await runCli(["init", dir, "--next"])
      expect(typo.code).toBe(1)
      expect(typo.err).toContain("unknown option --next")
      // Prefix-similar names give the hint
      const similar = await runCli(["init", dir, "--idle"])
      expect(similar.err).toContain("unknown option --idle")
      expect(similar.err).toContain("--idle-time")
      expect(similar.err).toContain("--idle-max")
      // The = form is intercepted too; the refusal happens before any write
      // (init froze no config)
      const eq = await runCli(["init", dir, "--nex=1"])
      expect(eq.code).toBe(1)
      expect(eq.err).toContain("unknown option --nex")
      expect(await readdir(dir)).toEqual([])
      // status takes only a directory argument; any flag is refused
      const statusFlag = await runCli(["status", dir, "--verbose"])
      expect(statusFlag.code).toBe(1)
      expect(statusFlag.err).toContain("unknown option --verbose")
      expect(statusFlag.err).toContain("status only accepts a directory argument")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the three completion-side mechanisms retired: the five flags are usage errors on init (exit code 1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const retired = [["--verify"], ["--verify=false"], ["--review", "3"], ["--early"], ["--early-review", "2"], ["--final-review", "2"]]
      for (const extra of retired) {
        const run = await runCli(["init", dir, ...extra])
        expect(run.code).toBe(1)
        expect(run.err).toContain(`${extra[0]!.split("=")[0]} is retired`)
        expect(run.err).toContain("Result: FAIL")
      }
      // The refusal happens before any write
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("migration parameters retired (plans/0052 D1): --source-dir/--source-path/--dest-dir are usage errors on init, pointing to brief.md", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const retired = [["--source-dir", "legacy"], ["--source-path", "src/mod.ts"], ["--dest-dir=target"], ["--source-dir", "legacy", "--source-path", "pkg"]]
      for (const extra of retired) {
        const run = await runCli(["init", dir, ...extra])
        expect(run.code).toBe(1)
        expect(run.err).toContain(`${extra[0]!.split("=")[0]} is retired`)
        expect(run.err).toContain("state them in the project analysis's `## Project brief` proposal (or opencode-auto amend <dir> --brief <text> | --brief-file <path>) or in the planning input")
      }
      // The refusal happens before any write
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("legacy layout retired (M3.7): a root PLAN.md or a docs/R-NN without phase directories → init/status/fix are usage errors with exit 1, nothing written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await Bun.write(join(dir, "PLAN.md"), "# plan\n")
      await Bun.write(join(dir, "docs/R-01/phases.md"), "# phases\n")
      // fix refuses alike — including --dryrun: the legacy-layout exemption
      // that let the retired `check` run on an old tree ended with the
      // command, and the read-only listing keeps fix's other refusals
      for (const args of [["init", dir], ["status", dir], ["fix", dir], ["fix", dir, "--dryrun"]]) {
        const run = await runCli(args)
        expect(run.code, args.join(" ")).toBe(1)
        expect(run.err).toContain("legacy layout: start a new project")
        expect(run.err).toContain("root PLAN.md, docs/R-01/ without phase directories")
      }
      expect((await readdir(dir)).sort()).toEqual(["PLAN.md", "docs"])
      expect(await readdir(join(dir, "docs"))).toEqual(["R-01"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("bad config values → amend exits 1, the message carrying the key name and the expected range", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ idleTime: 999 }))
      const amend = await runCli(["amend", dir, "--wrapup"])
      expect(amend.code).toBe(1)
      expect(amend.err).toContain("idleTime")
      expect(amend.err).toContain("1..120")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --mode with an unregistered name is a usage error (exit code 1); the message lists the supported modes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--mode", "nope"])
      expect(init.code).toBe(1)
      expect(init.err).toContain("--mode must be a registered mode")
      expect(init.err).toContain("migrate")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: init freezes the project config", () => {
  async function readConfig(dir: string) {
    return JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())
  }

  test("init writes the full config (all keys at their defaults) and prints the summary; writes the config layer only, the closing line points at the daemon's plan operation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir])
      expect(init.code).toBe(0)
      expect(init.out).toContain("⚙ project config (.opencode/auto/config.json)")
      expect(init.out).toContain("auto-number on")
      // config-only init (auto-core plans/0053 D31, the opener re-keyed by
      // plans/0283): the rounds' opening act is the daemon's plan operation —
      // the fresh-project pointer naming the assisted analysis (plans/0084).
      expect(init.out).toContain(
        `next: the plan operation of a daemon (POST /projects/<project>/plan) (opens the assisted project analysis: you and your agent fill docs/analysis.md, guided through AGENTS.md; round R-01 opens on its release)`,
      )
      expect(init.out).not.toContain("list tasks in")
      expect(await stat(join(dir, "docs")).catch(() => undefined)).toBeUndefined()
      // init writes no brief (plans/0133 D9 — the seed channel retired, the
      // analysis's approved proposal the first brief a project gets)
      expect(await Bun.file(join(dir, ".opencode/auto/brief.md")).exists()).toBe(false)
      expect(await readConfig(dir)).toEqual({
        mode: "migrate",
        contextLimit: 64,
        subtask: "off",
        idleTime: 10,
        idleMax: 0,
        testByDriver: false,
        handoverTest: false,
        autoNumber: true,
        wrapup: true,
        phases: "m",
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  const DEFAULT_CONFIG = {
    mode: "migrate",
    contextLimit: 64,
    subtask: "off",
    idleTime: 10,
    idleMax: 0,
    testByDriver: false,
    handoverTest: false,
    autoNumber: true,
    wrapup: true,
    phases: "m",
  }

  test("amend rewrites only the explicitly named keys; keys not named keep the stored config (init --amend is retired)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["amend", dir, "--test-by-driver", "--context-limit", "128", "--subtask", "auto"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual({ ...DEFAULT_CONFIG, contextLimit: 128, testByDriver: true, subtask: "auto" })
      // Amend one more unrelated key: the three keys changed last time survive
      // as-is
      expect((await runCli(["amend", dir, "--agent", "claude"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual({ ...DEFAULT_CONFIG, contextLimit: 128, testByDriver: true, subtask: "auto", agent: "claude" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("--subtask takes true, the planned pipeline (auto-core plans/0059 D1); a stored JSON boolean true reads as it, and bare --subtask takes the default off", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--subtask", "true"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual({ ...DEFAULT_CONFIG, subtask: "true" })
      expect((await runCli(["amend", dir, "--subtask"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual(DEFAULT_CONFIG)
      // A hand-edited boolean: amend loads it as "true" and writes the string back.
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ ...DEFAULT_CONFIG, subtask: true }))
      expect((await runCli(["status", dir])).out).toContain("subtask true")
      expect((await runCli(["amend", dir, "--context-limit", "128"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual({ ...DEFAULT_CONFIG, contextLimit: 128, subtask: "true" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("--subtask ondemand is off's permanent synonym (auto-core plans/0130 D1): accepted at init and amend, written and read back as the canonical off", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--subtask", "ondemand"])).code).toBe(0)
      // The mode merged into off (the context-handover protocol standing for
      // every whole-task session); the boolean-true spelling's own treatment,
      // so a stamped "ondemand" config never breaks across the upgrade.
      expect(await readConfig(dir)).toEqual(DEFAULT_CONFIG)
      expect((await runCli(["amend", dir, "--subtask", "ondemand"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual(DEFAULT_CONFIG)
      // A hand-edited "ondemand" value reads as off too, and the next amend
      // writes the canonical spelling.
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ ...DEFAULT_CONFIG, subtask: "ondemand" }))
      expect((await runCli(["status", dir])).out).toContain("subtask off")
      expect((await runCli(["amend", dir, "--context-limit", "128"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual({ ...DEFAULT_CONFIG, contextLimit: 128 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init defaults to the full overwrite: keys not given fall back to their defaults, identical to a bare init in a clean environment", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--test-by-driver", "--context-limit", "128", "--subtask", "auto", "--agent", "claude"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual({ ...DEFAULT_CONFIG, contextLimit: 128, testByDriver: true, subtask: "auto", agent: "claude" })
      // The bootstrap's repository holds the artifacts uncommitted; the
      // overwrite init's clean-tree gate needs the production commit between
      await commitFixture(dir)
      // A bare init: the four keys changed above all return to their defaults
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).toEqual(DEFAULT_CONFIG)
      // Strictly identical to a bare init's output in a clean environment
      const clean = await mkdtemp(join(tmpdir(), "auto-cli-"))
      try {
        expect((await runCli(["init", clean])).code).toBe(0)
        expect(await readConfig(dir)).toEqual(await readConfig(clean))
      } finally {
        await rm(clean, { recursive: true, force: true })
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("--commit is retired: any value on any command is a usage error with exit 1; init writes no commit key, a stored true loads and is ignored", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      // false and none (the 2026-09-15 retirement), and true (which used to be
      // the one accepted value) — the flag went with the config key
      for (const value of ["false", "none", "true"]) {
        const refused = await runCli(["init", dir, "--commit", value])
        expect(refused.code).toBe(1)
        expect(refused.err).toContain("--commit is retired")
        expect(refused.err).toContain("commit: true")
      }
      // A bare init writes no commit key at all
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).not.toHaveProperty("commit")
      // A stored commit: true (what an older init wrote) keeps loading and is
      // ignored like an unknown key
      const file = join(dir, ".opencode/auto/config.json")
      await Bun.write(file, JSON.stringify({ ...DEFAULT_CONFIG, commit: true }, null, 2) + "\n")
      const status = await runCli(["status", dir])
      expect(status.code).toBe(0)
      expect(status.out).toContain("project config")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init is idempotent: repeated runs with the same arguments produce constant artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--test-by-driver", "--subtask", "auto"])).code).toBe(0)
      const first = await readConfig(dir)
      const agentsFirst = await Bun.file(join(dir, "AGENTS.md")).text()
      await commitFixture(dir)
      for (let i = 0; i < 2; i++) {
        expect((await runCli(["init", dir, "--test-by-driver", "--subtask", "auto"])).code).toBe(0)
      }
      expect(await readConfig(dir)).toEqual(first)
      expect(await Bun.file(join(dir, "AGENTS.md")).text()).toBe(agentsFirst)
      // Three bare inits in a row stay constant too
      expect((await runCli(["init", dir])).code).toBe(0)
      const bare = await readConfig(dir)
      await commitFixture(dir)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).toEqual(bare)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("stored retired keys (plans/0052 D3/D4): a strict load (land, --amend) fails; a full-overwrite init drops them and names each with its value", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--context-limit", "128"])).code).toBe(0)
      await commitFixture(dir)
      const file = join(dir, ".opencode/auto/config.json")
      const stored = { ...(await readConfig(dir)), source: { dir: "legacy", path: "pkg" }, destDir: "app", commit: false }
      await Bun.write(file, JSON.stringify(stored, null, 2) + "\n")
      // land loads the config strictly (plans/0283 re-keyed run's strict-load
      // witness to it — run's own answer is its retirement notice now)
      const land = await runCli(["land", dir])
      expect(land.code).toBe(1)
      expect(land.err).toContain("commit: false is retired")
      // a key rule repairs it, so the strict failure names fix (plans/0052 D11)
      expect(land.err).toContain(`fix: opencode-auto fix ${dir}`)
      delete (stored as { commit?: boolean }).commit
      await Bun.write(file, JSON.stringify(stored, null, 2) + "\n")
      const status = await runCli(["status", dir])
      expect(status.out).toContain('source is retired (the migration source and target are intent, not configuration): copy its value {"dir":"legacy","path":"pkg"} into .opencode/auto/brief.md, then remove the key')
      expect(status.out).toContain(`  fix: opencode-auto fix ${dir}`)
      // an amend would carry the keys over, so it stays strict
      const amend = await runCli(["amend", dir, "--test-by-driver"])
      expect(amend.code).toBe(1)
      expect(amend.err).toContain("source is retired")
      expect(amend.err).toContain(`fix: opencode-auto fix ${dir}`)
      expect(await readConfig(dir)).toEqual(stored)
      // the full overwrite discards them anyway: it succeeds (no longer blocked by a
      // stored retired key, DF2) and names each discarded key with its value
      await Bun.write(file, JSON.stringify({ ...stored, commit: false }, null, 2) + "\n")
      // The person commits their hand edit (the overwrite gate is git-bound
      // since init bootstraps the repository)
      await commitFixture(dir)
      const init = await runCli(["init", dir])
      expect(init.code).toBe(0)
      expect(init.out).toContain("full overwrite drops the retired key commit = false")
      expect(init.out).toContain('full overwrite drops the retired key source = {"dir":"legacy","path":"pkg"}: the migration source and target are intent — state them in the project analysis\'s `## Project brief` proposal (or `amend --brief`), or in the planning input')
      expect(init.out).toContain('full overwrite drops the retired key destDir = "app"')
      expect(await readConfig(dir)).toEqual(DEFAULT_CONFIG)
      await commitFixture(dir)
      expect((await runCli(["init", dir])).out).not.toContain("retired key")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --auto-number/--no-auto-number freeze and amend; both switches at once are a usage error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      // On: freezes true, the summary carries the auto-numbering section.
      // m-mode planning consumes the numbering
      // record too (auto-core plans/0053 D12), so phases = m gets no "no effect" note.
      const init = await runCli(["init", dir, "--auto-number"])
      expect(init.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ autoNumber: true })
      expect(init.out).toContain("auto-number on")
      expect(init.out).not.toContain("numbering record")
      await commitFixture(dir)
      expect((await runCli(["init", dir, "--phases", "am"])).code).toBe(0)
      // --no-auto-number overrides back to false; an amend not naming the key
      // keeps it, a bare init falls back to the default true
      await commitFixture(dir)
      expect((await runCli(["init", dir, "--no-auto-number"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ autoNumber: false })
      expect((await runCli(["amend", dir, "--wrapup"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ autoNumber: false })
      await commitFixture(dir)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ autoNumber: true })
      // The =false form counts as not given (under the full overwrite, the
      // default true)
      await commitFixture(dir)
      expect((await runCli(["init", dir, "--auto-number=false"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ autoNumber: true })
      // Both switches at once without =false → usage error
      const both = await runCli(["init", dir, "--auto-number", "--no-auto-number"])
      expect(both.code).toBe(1)
      expect(both.err).toContain("mutually exclusive pair")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --wrapup/--no-wrapup freeze and amend; both switches at once are a usage error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      // Default (neither key given) freezes true
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ wrapup: true })
      await commitFixture(dir)
      // --no-wrapup freezes false; the summary now reads "wrapup off"
      const off = await runCli(["init", dir, "--no-wrapup"])
      expect(off.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ wrapup: false })
      expect(off.out).toContain("wrapup off")
      // An amend naming neither key keeps the existing false; a bare init
      // without amend falls back to the default true
      expect((await runCli(["amend", dir, "--context-limit", "64"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ wrapup: false })
      await commitFixture(dir)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ wrapup: true })
      await commitFixture(dir)
      expect((await runCli(["init", dir, "--no-wrapup"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ wrapup: false })
      // --wrapup overrides back to true
      await commitFixture(dir)
      expect((await runCli(["init", dir, "--wrapup"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ wrapup: true })
      // The =false form counts as not given (under the full overwrite, the
      // default true)
      await commitFixture(dir)
      expect((await runCli(["init", dir, "--no-wrapup=false"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ wrapup: true })
      // Both switches at once without =false → usage error
      const both = await runCli(["init", dir, "--wrapup", "--no-wrapup"])
      expect(both.code).toBe(1)
      expect(both.err).toContain("mutually exclusive pair")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --agent freezes the coding agent; opencode drops the key; a contract name is refused (M6.1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const plain = await runCli(["init", dir])
      expect(plain.code).toBe(0)
      expect(await readConfig(dir)).not.toHaveProperty("agent")
      expect(plain.out).toContain("· agent opencode ·")
      await commitFixture(dir)
      const claude = await runCli(["init", dir, "--agent", "claude"])
      expect(claude.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ agent: "claude" })
      expect(claude.out).toContain("· agent claude ·")
      // amend keeps it; amend --agent opencode removes it
      expect((await runCli(["amend", dir, "--wrapup"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ agent: "claude" })
      expect((await runCli(["amend", dir, "--agent", "opencode"])).code).toBe(0)
      expect(await readConfig(dir)).not.toHaveProperty("agent")
      // the retired contract-name use of --agent is a usage error
      const named = await runCli(["init", dir, "--agent", "auto"])
      expect(named.code).toBe(1)
      expect(named.err).toContain("--agent takes opencode|claude")
      // a pre-M6.1 config holding a contract name fails loading with a hint
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ agent: "auto" }))
      const land = await runCli(["land", dir])
      expect(land.code).toBe(1)
      expect(`${land.out}${land.err}`).toContain("looks like an agent contract name")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --parallel freezes the planning level; none drops the key; --max-sessions is refused outside the retired run (plans/0046 D8; activation decoupled by auto-core plans/0125)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      // default: no key written, no summary mention
      const plain = await runCli(["init", dir])
      expect(plain.code).toBe(0)
      expect(await readConfig(dir)).not.toHaveProperty("parallel")
      expect(plain.out).not.toContain("parallel")
      await commitFixture(dir)
      // a level is frozen and shown in the summary
      const high = await runCli(["init", dir, "--parallel", "high"])
      expect(high.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ parallel: "high" })
      expect(high.out).toContain("· parallel high")
      // amend keeps it; amend --parallel none removes it; a plain init falls back to none
      expect((await runCli(["amend", dir, "--wrapup"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ parallel: "high" })
      expect((await runCli(["amend", dir, "--parallel", "none"])).code).toBe(0)
      expect(await readConfig(dir)).not.toHaveProperty("parallel")
      await commitFixture(dir)
      expect((await runCli(["init", dir, "--parallel", "low"])).code).toBe(0)
      await commitFixture(dir)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).not.toHaveProperty("parallel")
      // bad level, and --max-sessions outside run, are usage errors
      const bad = await runCli(["init", dir, "--parallel", "max"])
      expect(bad.code).toBe(1)
      expect(bad.err).toContain("--parallel takes none|low|medium|high")
      const initSessions = await runCli(["init", dir, "--max-sessions", "1"])
      expect(initSessions.code).toBe(1)
      expect(initSessions.err).toContain("--max-sessions is a run option")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init/amend --scan-exempt freezes the scan-exemption globs; none drops the key; bad globs are usage errors (plans/0059 X2)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const plain = await runCli(["init", dir])
      expect(plain.code).toBe(0)
      expect(await readConfig(dir)).not.toHaveProperty("scanExempt")
      expect(plain.out).not.toContain("scan-exempt")
      await commitFixture(dir)
      // a comma list is split (brace groups keep their commas) and trimmed
      const set = await runCli(["init", dir, "--scan-exempt", "test/fixtures/**, templates/{prompts,intents}"])
      expect(set.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ scanExempt: ["test/fixtures/**", "templates/{prompts,intents}"] })
      expect(set.out).toContain("· scan-exempt test/fixtures/**,templates/{prompts,intents}")
      // amend keeps it, amend --scan-exempt replaces it, none removes it
      expect((await runCli(["amend", dir, "--wrapup"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ scanExempt: ["test/fixtures/**", "templates/{prompts,intents}"] })
      expect((await runCli(["amend", dir, "--scan-exempt", "fixtures"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ scanExempt: ["fixtures"] })
      expect((await runCli(["amend", dir, "--scan-exempt", "none"])).code).toBe(0)
      expect(await readConfig(dir)).not.toHaveProperty("scanExempt")
      await commitFixture(dir)
      // a plain init is the stateless overwrite: the key falls back to none
      expect((await runCli(["init", dir, "--scan-exempt", "fixtures"])).code).toBe(0)
      await commitFixture(dir)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).not.toHaveProperty("scanExempt")
      // an absolute glob, one climbing out, and an empty list are usage errors
      for (const value of ["/abs/**", "../elsewhere", " , "]) {
        const bad = await runCli(["amend", dir, "--scan-exempt", value])
        expect(bad.code).toBe(1)
        expect(bad.err).toContain("--scan-exempt takes none or a comma-separated list of path globs")
      }
      expect((await runCli(["amend", dir, "--scan-exempt", "/abs/**"])).err).toContain("is absolute")
      expect((await runCli(["amend", dir, "--scan-exempt", "../elsewhere"])).err).toContain("climbs out of the target directory")
      expect(await readConfig(dir)).not.toHaveProperty("scanExempt")
      // a hand-edited bad value is refused at load, naming the key
      await Bun.write(join(dir, ".opencode", "auto", "config.json"), JSON.stringify({ scanExempt: "test/**" }))
      const load = await runCli(["amend", dir, "--wrapup"])
      expect(load.code).toBe(1)
      expect(load.err).toContain("scanExempt must be an array of path globs")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // (plans/0122's root-symlink external_directory stamps — init additively
  // stamping the person's opencode.json, fix restoring them — died whole with
  // the opencode severance, plans/0296 slice 1: the host's own file is never
  // this tool's write, and the stamp family is gone from the core; the shell
  // e2e here could not load at all between slice 1 and slice 4, so the
  // retirement is recorded here.)

  // A branch-isolation fixture: the target directory plus one clean nested

  // A branch-isolation fixture: the target directory plus one clean nested
  // repository (pkg) on main (the pinned init.defaultBranch), ready to be
  // named by --isolate; a second nested repository (tools/cli) gives the
  // repeatable flag a second path.
  async function isolateFixture(prefix: string) {
    const dir = await mkdtemp(join(tmpdir(), prefix))
    const nestedOf = async (rel: string) => {
      await mkdir(join(dir, rel), { recursive: true })
      const nested = gitOf(join(dir, rel))
      await Bun.write(join(dir, rel, "readme.txt"), "nested\n")
      await nested("init", "-q")
      await nested("add", "-A")
      await nested("commit", "-qm", "nested setup")
      return nested
    }
    return { dir, nested: await nestedOf("pkg"), tools: await nestedOf("tools/cli") }
  }

  test("init/amend --isolate freezes the branch-isolated repositories (repeatable); none drops the key; the target root and a nonexistent path are usage errors (plans/0074 U-L1)", async () => {
    const { dir } = await isolateFixture("auto-cli-iso-")
    try {
      // default: no key written, no summary mention
      const plain = await runCli(["init", dir])
      expect(plain.code).toBe(0)
      expect(await readConfig(dir)).not.toHaveProperty("isolate")
      expect(plain.out).not.toContain("isolate")
      await commitFixture(dir)
      // the flag is repeatable: one repository per occurrence, the list shown joined
      const set = await runCli(["init", dir, "--isolate", "pkg", "--isolate", "tools/cli"])
      expect(set.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ isolate: ["pkg", "tools/cli"] })
      expect(set.out).toContain("· isolate pkg,tools/cli")
      // amend keeps it, amend --isolate replaces the list, none removes the key
      expect((await runCli(["amend", dir, "--wrapup"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ isolate: ["pkg", "tools/cli"] })
      expect((await runCli(["amend", dir, "--isolate", "pkg"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ isolate: ["pkg"] })
      expect((await runCli(["amend", dir, "--isolate", "none"])).code).toBe(0)
      expect(await readConfig(dir)).not.toHaveProperty("isolate")
      await commitFixture(dir)
      // a plain init is the stateless overwrite: the key falls back to none
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).not.toHaveProperty("isolate")
      // the target root and a nonexistent path are usage errors, and a path
      // without a .git names what isolate designates
      const root = await runCli(["init", dir, "--isolate", "."])
      expect(root.code).toBe(1)
      expect(root.err).toContain("--isolate takes none or nested-repository paths")
      expect(root.err).toContain("is the target root itself")
      const missing = await runCli(["amend", dir, "--isolate", "missing"])
      expect(missing.code).toBe(1)
      expect(missing.err).toContain("does not exist under")
      await mkdir(join(dir, "plain"))
      expect((await runCli(["amend", dir, "--isolate", "plain"])).err).toContain("holds no .git")
      // close refuses the flag as frozen by init, pointing at amend (plans/0283
      // re-keyed run's frozen-flag witness to the strict ladder)
      const frozen = await runCli(["close", "T-001", dir, "--reason", "r", "--isolate", "pkg"])
      expect(frozen.code).toBe(1)
      expect(frozen.err).toContain("--isolate was frozen by init")
      expect(frozen.err).toContain("opencode-auto amend <dir> --isolate <value>")
      // a hand-edited bad value is refused at load, naming the key
      await Bun.write(join(dir, ".opencode", "auto", "config.json"), JSON.stringify({ isolate: "pkg" }))
      const load = await runCli(["amend", dir, "--wrapup"])
      expect(load.code).toBe(1)
      expect(load.err).toContain("isolate must be an array of nested-repository paths")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // plans/0283 re-keyed the establishment vehicle: the local plan command is
  // retired, so the round establishment (branch isolation and all — the one
  // home the daemon's transfer operation advances through) is driven
  // in-process here; the daemon renders these outcomes, and auto-core's
  // transfer suites pin that rendering.
  test("the round establishment isolates each designated repository on auto/R-NN; a dirty one is the dirty refusal naming the repository and its paths (plans/0074 U-L1)", async () => {
    const { dir, nested } = await isolateFixture("auto-cli-iso-plan-")
    try {
      const original = (await nested("rev-parse", "--abbrev-ref", "HEAD")).trim()
      const setup = (await nested("rev-parse", "--short", original)).trim()
      expect((await runCli(["init", dir, "--isolate", "pkg"])).code).toBe(0)
      await commitFixture(dir)
      // clean: the establishment switches the repository onto auto/R-01
      const made = await establish(dir, "m", ["pkg"])
      expect(made.round).toBe(1)
      expect(made.isolated).toEqual(["pkg"])
      expect((await nested("rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe("auto/R-01")
      expect((await nested("rev-parse", "--short", original)).trim()).toBe(setup)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
    const dirty = await isolateFixture("auto-cli-iso-dirty-")
    try {
      expect((await runCli(["init", dirty.dir, "--isolate", "pkg"])).code).toBe(0)
      await commitFixture(dirty.dir)
      await Bun.write(join(dirty.dir, "pkg", "wip.txt"), "uncommitted\n")
      const blocked = await establishRoundSetup(dirty.dir, 1, { phases: "m", isolate: ["pkg"] })
      expect(blocked).toMatchObject({ type: "dirty" })
      expect(JSON.stringify(blocked)).toContain("pkg")
      expect(JSON.stringify(blocked)).toContain("pkg/wip.txt")
      // nothing was established and no branch was touched
      expect(await Bun.file(join(dirty.dir, "docs", "R-01", "phases.md")).exists()).toBe(false)
      expect((await dirty.nested("branch", "--list", "auto/*")).trim()).toBe("")
    } finally {
      await rm(dirty.dir, { recursive: true, force: true })
    }
  })

  // land (plans/0074 §2.3, U-L2): the person-invoked return path of branch
  // isolation, pinned here at the shell's contract — the exit codes (0
  // landed / 1 usage / 2 blocked for human) and the printed lines — over the
  // round plan established on auto/R-01. The round's work commits carry the
  // Auto-Stage trailer (what the foreign-commit refusal counts); the
  // core-level behaviour matrix (git shapes, re-landing, the mixed set) is
  // auto-core's test/land.test.ts.

  test("land: exit 0 with the landed SHA printed, auto/R-01 deleted; --keep retains and re-checks it out and a later land folds only the new commits (plans/0074 U-L2)", async () => {
    const { dir, nested } = await isolateFixture("auto-cli-land-")
    try {
      const original = (await nested("rev-parse", "--abbrev-ref", "HEAD")).trim()
      const setup = (await nested("rev-parse", "HEAD")).trim()
      expect((await runCli(["init", dir, "--isolate", "pkg"])).code).toBe(0)
      await commitFixture(dir)
      await establish(dir, "m", ["pkg"])
      const roundCommit = async (file: string, n: number) => {
        await Bun.write(join(dir, "pkg", file), `${file}\n`)
        await nested("add", "-A")
        await nested("commit", "-qm", `T-001 implement the migration: execute ${n}`, "-m", "Auto-Stage: execute")
      }
      await roundCommit("one.txt", 1)
      // --keep: the mid-round landing retains the branch and checks it back
      // out — the round simply continues on it
      const mid = await runCli(["land", dir, "--keep"])
      expect(mid.code).toBe(0)
      expect(mid.out).toContain(`on ${original} (1 commit(s) of auto/R-01 as one); auto/R-01 retained and checked out — the round simply continues on it`)
      expect((await nested("rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe("auto/R-01")
      expect(Number((await nested("rev-list", "--count", original)).trim())).toBe(2)
      // the round continues; the final landing recognizes the mid-round one
      // and folds only the new commit
      await roundCommit("two.txt", 2)
      const tipTree = (await nested("rev-parse", "auto/R-01^{tree}")).trim()
      const landed = await runCli(["land", dir])
      expect(landed.code).toBe(0)
      const sha = (await nested("rev-parse", "--short", "HEAD")).trim()
      expect(landed.out).toContain(`✓ pkg: landed ${sha} on ${original} (1 commit(s) of auto/R-01 as one); auto/R-01 deleted`)
      expect(landed.out).toContain("the driven root is the process layer of record")
      // exactly one more commit per landing, the setup history intact beneath
      expect(Number((await nested("rev-list", "--count", original)).trim())).toBe(3)
      expect((await nested("rev-parse", "HEAD~2")).trim()).toBe(setup)
      expect((await nested("rev-parse", "HEAD^{tree}")).trim()).toBe(tipTree)
      expect((await nested("rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe(original)
      expect((await nested("branch", "--list", "auto/R-01")).trim()).toBe("")
      expect(await Bun.file(join(dir, "pkg", "one.txt")).text()).toBe("one.txt\n")
      expect(await Bun.file(join(dir, "pkg", "two.txt")).text()).toBe("two.txt\n")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("land refusals block for a human (exit 2): the original branch moved, a dirty repository, foreign commits in the round branch's range — nothing lands (plans/0074 U-L2)", async () => {
    const moved = await isolateFixture("auto-cli-land-moved-")
    try {
      const nested = moved.nested
      const original = (await nested("rev-parse", "--abbrev-ref", "HEAD")).trim()
      expect((await runCli(["init", moved.dir, "--isolate", "pkg"])).code).toBe(0)
      await commitFixture(moved.dir)
      await establish(moved.dir, "m", ["pkg"])
      await Bun.write(join(moved.dir, "pkg", "one.txt"), "one\n")
      await nested("add", "-A")
      await nested("commit", "-qm", "T-001 implement the migration: execute 1", "-m", "Auto-Stage: execute")
      // a human commit lands on the original branch after isolation: the
      // landing's conflict surface by design
      await nested("checkout", "-q", original)
      await Bun.write(join(moved.dir, "pkg", "moved.txt"), "moved\n")
      await nested("add", "-A")
      await nested("commit", "-qm", "a human move")
      await nested("checkout", "-q", "auto/R-01")
      const blocked = await runCli(["land", moved.dir])
      expect(blocked.code).toBe(2)
      expect(blocked.err).toContain("⏸ round R-01 cannot land yet:")
      expect(blocked.err).toContain(`pkg: the original branch ${original} moved since auto/R-01 was isolated`)
      expect(blocked.err).toContain("merge by hand, or reset")
      // nothing was touched
      expect((await nested("branch", "--list", "auto/R-01")).trim()).toContain("auto/R-01")
      expect((await nested("rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe("auto/R-01")
    } finally {
      await rm(moved.dir, { recursive: true, force: true })
    }
    const dirty = await isolateFixture("auto-cli-land-dirty-")
    try {
      expect((await runCli(["init", dirty.dir, "--isolate", "pkg"])).code).toBe(0)
      await commitFixture(dirty.dir)
      await establish(dirty.dir, "m", ["pkg"])
      await Bun.write(join(dirty.dir, "pkg", "wip.txt"), "uncommitted\n")
      const unclean = await runCli(["land", dirty.dir])
      expect(unclean.code).toBe(2)
      expect(unclean.err).toContain("landing requires clean repositories")
      expect(unclean.err).toContain("pkg/wip.txt")
      expect((await dirty.nested("branch", "--list", "auto/R-01")).trim()).toContain("auto/R-01")
      // the wip becomes a plain (non-driver) commit on the round branch:
      // the foreign-commit refusal, never an automated landing
      await dirty.nested("add", "-A")
      await dirty.nested("commit", "-qm", "a human touch on the round branch")
      const foreign = await runCli(["land", dirty.dir])
      expect(foreign.code).toBe(2)
      expect(foreign.err).toContain("pkg: 1 non-driver commit(s) on auto/R-01 since the isolation point")
      expect(foreign.err).toContain("foreign commits are never landed automatically")
    } finally {
      await rm(dirty.dir, { recursive: true, force: true })
    }
  })

  test("land --onto: when the isolation record's branch is gone (the original deleted mid-round), land blocks teaching --onto and the named landing succeeds (plans/0192)", async () => {
    const { dir, nested } = await isolateFixture("auto-cli-land-onto-")
    try {
      const original = (await nested("rev-parse", "--abbrev-ref", "HEAD")).trim()
      expect((await runCli(["init", dir, "--isolate", "pkg"])).code).toBe(0)
      await commitFixture(dir)
      await establish(dir, "m", ["pkg"])
      await Bun.write(join(dir, "pkg", "one.txt"), "one\n")
      await nested("add", "-A")
      await nested("commit", "-qm", "T-001 implement the migration: execute 1", "-m", "Auto-Stage: execute")
      // the record's branch deleted mid-round (the repository sits on the
      // round branch), another ordinary branch kept at the isolation point:
      // the record's word blocks rather than crowning the survivor
      await nested("branch", "wip", original)
      await nested("branch", "-D", original)
      const blocked = await runCli(["land", dir])
      expect(blocked.code).toBe(2)
      expect(blocked.err).toContain(`the isolation record names ${original} as the original branch, but no such local branch remains`)
      expect(blocked.err).toContain("name the target with --onto")
      // the person's named landing: --onto wip, exit 0, landed on wip
      const named = await runCli(["land", dir, "--onto", "wip"])
      expect(named.code).toBe(0)
      expect(named.out).toContain("on wip (1 commit(s) of auto/R-01 as one); auto/R-01 deleted")
      expect((await nested("rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe("wip")
      expect((await nested("branch", "--list", "auto/R-01")).trim()).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("land --abandon removes the isolation branch after the person-reviewed reset (exit 0, the tip printed, nothing landed); land's usage errors exit 1 (plans/0074 U-L2)", async () => {
    const { dir, nested } = await isolateFixture("auto-cli-land-abandon-")
    try {
      const original = (await nested("rev-parse", "--abbrev-ref", "HEAD")).trim()
      const setup = (await nested("rev-parse", "HEAD")).trim()
      expect((await runCli(["init", dir, "--isolate", "pkg"])).code).toBe(0)
      await commitFixture(dir)
      await establish(dir, "m", ["pkg"])
      await Bun.write(join(dir, "pkg", "one.txt"), "one\n")
      await nested("add", "-A")
      await nested("commit", "-qm", "T-001 implement the migration: execute 1", "-m", "Auto-Stage: execute")
      const tip = (await nested("rev-parse", "--short", "auto/R-01")).trim()
      const abandoned = await runCli(["land", dir, "--abandon"])
      expect(abandoned.code).toBe(0)
      expect(abandoned.out).toContain(`✓ pkg: abandoned auto/R-01 (was ${tip}, recoverable via git reflog until collection); back on ${original}, nothing landed`)
      expect(abandoned.out).toContain("the driven root's git keeps the round's record")
      expect((await nested("rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe(original)
      expect((await nested("branch", "--list", "auto/R-01")).trim()).toBe("")
      expect((await nested("rev-parse", original)).trim()).toBe(setup)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
    // usage errors are exit 1: the contradictory flag pair, an unknown
    // option, the value-swallowing --merge, --keep on another command, a
    // config that designates nothing, no config at all
    const usage = await isolateFixture("auto-cli-land-usage-")
    try {
      expect((await runCli(["init", usage.dir, "--isolate", "pkg"])).code).toBe(0)
      await commitFixture(usage.dir)
      const pairs = await runCli(["land", usage.dir, "--keep", "--abandon"])
      expect(pairs.code).toBe(1)
      expect(pairs.err).toContain("--keep and --abandon are mutually exclusive")
      const unknown = await runCli(["land", usage.dir, "--cascade"])
      expect(unknown.code).toBe(1)
      expect(unknown.err).toContain("--cascade is not a land option")
      expect(unknown.err).toContain("land takes only --keep, --abandon, --merge and --onto <branch>")
      const bare = await runCli(["land", usage.dir, "--onto"])
      expect(bare.code).toBe(1)
      expect(bare.err).toContain("--onto names the original branch and takes a value")
      const swallowed = await runCli(["land", "--merge", usage.dir])
      expect(swallowed.code).toBe(1)
      expect(swallowed.err).toContain("land's landing-mode flag and takes no value")
      const elsewhere = await runCli(["close", "T-001", usage.dir, "--reason", "r", "--keep"])
      expect(elsewhere.code).toBe(1)
      expect(elsewhere.err).toContain("--keep and --abandon are land options: close takes neither")
    } finally {
      await rm(usage.dir, { recursive: true, force: true })
    }
    const plain = await isolateFixture("auto-cli-land-plain-")
    try {
      expect((await runCli(["init", plain.dir])).code).toBe(0)
      await commitFixture(plain.dir)
      const empty = await runCli(["land", plain.dir])
      expect(empty.code).toBe(1)
      expect(empty.err).toContain("nothing to land: the config designates no branch-isolated repositories")
      expect(empty.err).toContain("--isolate")
    } finally {
      await rm(plain.dir, { recursive: true, force: true })
    }
    const bare = await mkdtemp(join(tmpdir(), "auto-cli-land-bare-"))
    try {
      const nocfg = await runCli(["land", bare])
      expect(nocfg.code).toBe(1)
      expect(nocfg.err).toContain("nothing to land")
      expect(nocfg.err).toContain("has no .opencode/auto/config.json")
    } finally {
      await rm(bare, { recursive: true, force: true })
    }
  })

  test("init with an explicit key holding an invalid value is a usage error (exit code 1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const bad = [
        ["--subtask", "fast"],
        ["--context-limit", "0"],
        ["--idle-time", "999"],
        ["--idle-max", "0.5"],
      ]
      for (const extra of bad) {
        const init = await runCli(["init", dir, ...extra])
        expect(init.code).toBe(1)
        expect(init.err).not.toBe("")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --test-by-driver/--handover-test freeze the config and refresh the AGENTS.md opencode-auto block's test section", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--test-by-driver", "--handover-test"])
      expect(init.code).toBe(0)
      expect(init.out).toContain("appended: AGENTS.md opencode-auto block")
      expect(await readConfig(dir)).toMatchObject({ testByDriver: true, handoverTest: true })
      const agents = await Bun.file(join(dir, "AGENTS.md")).text()
      expect(agents).toContain("Test principle:")
      expect(agents).toContain("compilation and test runs — build, typecheck, test suites")
      // The agent contract is the host's own since plans/0296 — never init's
      // write (0072 U-B's move of the test protocol into the AGENTS.md block
      // is asserted above; the contract file itself is absent).
      expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).exists()).toBe(false)
      // An amend turning handover-test off keeps test-by-driver; turning
      // test-by-driver off too leaves the block differing from the render (the
      // test section should vanish), so the whole block refreshes
      expect((await runCli(["amend", dir, "--handover-test", "false"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ testByDriver: true, handoverTest: false })
      const off = await runCli(["amend", dir, "--test-by-driver", "false"])
      expect(off.code).toBe(0)
      expect(off.out).toContain("refreshed: AGENTS.md opencode-auto block (differed from the current config render)")
      expect(await Bun.file(join(dir, "AGENTS.md")).text()).not.toContain("Test principle:")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("status prints the config summary first, then the task list; an invalid config does not block the list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      // init no longer establishes the round (plans/0053 D31); the daemon's
      // opening operation does — driven here through the establishment home
      await establish(dir, "m")
      await Bun.write(join(dir, "docs/R-01/P01-implement/tasks.md"), "# Tasks\n\n- [ ] T-001 sample task\n")
      await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: sample task\nPhase: R-01.P01\n\n## Goal\n\nSample.\n")
      const status = await runCli(["status", dir])
      expect(status.code).toBe(0)
      expect(status.out).toContain("⚙ project config (.opencode/auto/config.json): mode migrate · agent opencode")
      // the phases key rides nowhere in the summary (plans/0137: init-stamped
      // machinery) — the phase tree below carries the operative list
      expect(status.out).not.toContain("· phases")
      expect(status.out).toContain("[▶] P01-implement")
      expect(status.out).toContain("[ ] T-001 sample task")
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ subtask: "fast" }))
      const broken = await runCli(["status", dir])
      expect(broken.code).toBe(0)
      expect(broken.out).toContain("⚠ project config (.opencode/auto/config.json) is invalid")
      expect(broken.out).toContain("subtask")
      expect(broken.out).toContain("[ ] T-001 sample task")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: phases / source / brief (phased flow P1)", () => {
  async function readConfig(dir: string) {
    return JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())
  }

  test("init --phases with an invalid value is a usage error; the message gives the valid forms", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      for (const value of ["tma", "adk", "mm", "x", ""]) {
        const init = await runCli(["init", dir, "--phases", value])
        expect(init.code).toBe(1)
        expect(init.err).toContain("--phases is invalid")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --phases valid values freeze into the config (the summary carrying no phases — init-stamped machinery, plans/0137); the closing line points at the daemon's transfer operation (the phased opener)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--phases", "admtvk"])
      expect(init.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "admtvk" })
      expect(init.out).not.toContain("· phases")
      // config-only init (plans/0053 D31, the opener re-keyed by plans/0101 D4
      // and plans/0283): the closing line names the rounds' opening act — the
      // daemon's transfer operation on a phased project, its plan operation
      // in m mode; nothing is written under docs/
      expect(init.out).toContain(
        `next: the transfer operation of a daemon (POST /projects/<project>/transfer) (opens the assisted project analysis: you and your agent fill docs/analysis.md, guided through AGENTS.md; round R-01 opens on its release)`,
      )
      expect(init.out).not.toContain("to start analysis")
      expect(await stat(join(dir, "docs")).catch(() => undefined)).toBeUndefined()
      // An amend without --phases keeps the existing value; an explicit init
      // value changes it
      expect((await runCli(["amend", dir, "--wrapup"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "admtvk" })
      await commitFixture(dir)
      expect((await runCli(["init", dir, "--phases", "amt"])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "amt" })
      // A bare init without amend is a full overwrite: phases falls back to the
      // default "m" (no completed phases, so the prefix guard does not bind)
      await commitFixture(dir)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "m" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the init/amend prefix guard: changing --phases mid-round must not drop completed phases; it opens up once the current round completes (plans/0053 D31–D32)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "adm"])).code).toBe(0)
      // init establishes no round: only after the opening operation
      // establishes the current round is there a phase index to judge
      await establish(dir, "adm")
      await completeLetters(dir, ["a"])
      // A value starting with "d" would drop the completed P01-analysis →
      // refused (plannedPhaseUnits' read-only check, before any write)
      const bad = await runCli(["init", dir, "--phases", "dmt"])
      expect(bad.code).toBe(1)
      expect(bad.err).toContain('phases "dmt" would drop the completed phase docs/R-01/P01-analysis/ from docs/R-01/phases.md')
      expect(bad.err).toContain("once the current round is complete, any value applies to the next round")
      // amend's --phases is retired (plans/0137): the refusal names the
      // line channel, whatever the value — the guard stays init's alone
      const badAmend = await runCli(["amend", dir, "--phases", "dmt"])
      expect(badAmend.code).toBe(1)
      expect(badAmend.err).toContain("--phases is retired on amend")
      expect(badAmend.err).toContain("by moving or adding its `- R-NN <phases> — <goal>` line in docs/analysis.md")
      // A compatible value passes: the completed phase survives; init/amend no
      // longer rewrite the tail phases — the new value's difference from the
      // index surfaces as a drift for the advance to re-derive on its own
      // commit (plans/0206; plan refuses naming transfer, m mode aside)
      await commitFixture(dir)
      const ok = await runCli(["init", dir, "--phases", "admt"])
      expect(ok.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "admt" })
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [x] P01 analysis\n- [ ] P02 design\n- [ ] P03 implement\n")
      // An overwrite init (round established) ends with the plain transfer
      // pointer (the phased opener), no longer claiming to establish R-01
      expect(ok.out).toContain(`next: the transfer operation of a daemon (POST /projects/<project>/transfer)`)
      expect(ok.out).not.toContain("establishes round")
      // The guard judges this run's effective value: a bare full-overwrite
      // init would fall phases back to "m", incompatible with the completed
      // "a" → intercepted before any write
      const bare = await runCli(["init", dir])
      expect(bare.code).toBe(1)
      expect(bare.err).toContain('phases "m" would drop the completed phase docs/R-01/P01-analysis/')
      expect(await readConfig(dir)).toMatchObject({ phases: "admt" })
      // Once this round completes the guard opens up: any valid value applies
      // to the next round plan establishes (D32)
      await completeLetters(dir, ["d", "m"])
      await commitFixture(dir)
      const fresh = await runCli(["init", dir, "--phases", "amt"])
      expect(fresh.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "amt" })
      const relaxed = await runCli(["amend", dir, "--phases", "admtvk"])
      expect(relaxed.code).toBe(1)
      expect(relaxed.err).toContain("--phases is retired on amend")
      expect(await readConfig(dir)).toMatchObject({ phases: "amt" })
      // The completed round's index stays as-is (never rewritten)
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [x] P01 analysis\n- [x] P02 design\n- [x] P03 implement\n")
      // With an invalid phase index, any amend reports an environment error
      // pointing a person at the fix (the guard judges the run's effective
      // phases value whatever key changed)
      await Bun.write(join(dir, "docs/R-01/phases.md"), "- [ ] X1 analysis\n")
      const broken = await runCli(["amend", dir, "--context-limit", "96"])
      expect(broken.code).toBe(1)
      expect(broken.err).toContain("docs/R-01/phases.md")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --phases type-id list: custom types from .opencode/auto/phases, repeats allowed, prefix guard by type", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      // Unknown custom id → usage error listing the known types
      const unknown = await runCli(["init", dir, "--phases", "analysis,security-review,implement"])
      expect(unknown.code).toBe(1)
      expect(unknown.err).toContain("security-review")
      await mkdir(join(dir, ".opencode/auto/phases"), { recursive: true })
      await Bun.write(
        join(dir, ".opencode/auto/phases/security-review.md"),
        "# Security review\n\nGate: verdict\nTask-artifacts: review.md\n\n## plan duties\n\nList the review tasks.\n",
      )
      const init = await runCli(["init", dir, "--phases", "analysis, security-review ,implement,security-review"])
      expect(init.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "analysis,security-review,implement,security-review" })
      expect(init.out).toContain(`next: the transfer operation of a daemon (POST /projects/<project>/transfer) (opens the assisted project analysis`)
      // After the opening operation establishes the round, status prints the
      // phase tree (per the index)
      await establish(dir, "analysis,security-review,implement,security-review")
      expect((await runCli(["status", dir])).out).toContain(
        "  [▶] P01-analysis\n  [ ] P02-security-review\n  [ ] P03-implement\n  [ ] P04-security-review\n",
      )
      // Completed analysis → a list not starting with analysis is refused
      await completeLetters(dir, ["a"])
      const bad = await runCli(["init", dir, "--phases", "security-review,implement"])
      expect(bad.code).toBe(1)
      expect(bad.err).toContain('phases "security-review,implement" would drop the completed phase docs/R-01/P01-analysis/')
      // An invalid type file is a usage error naming the file
      await Bun.write(join(dir, ".opencode/auto/phases/broken.md"), "# Broken\n\nTasks: no\n\n## plan duties\n\nx\n")
      const broken = await runCli(["amend", dir, "--wrapup"])
      expect(broken.code).toBe(1)
      expect(broken.err).toContain("broken.md")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init validates before it writes (plans/0052 D7): the retired -p or a broken prompt override leaves the config layer untouched", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const empty = await runCli(["init", dir, "-p", "  "])
      expect(empty.code).toBe(1)
      expect(empty.err).toContain("--prompt is retired")
      expect(await readdir(dir)).toEqual([])
      await mkdir(join(dir, ".opencode/auto/prompts"), { recursive: true })
      await Bun.write(join(dir, ".opencode/auto/prompts/decompose.md"), "Decompose the task.\n")
      const fresh = await runCli(["init", dir])
      expect(fresh.code).toBe(1)
      expect(fresh.err).toContain("decompose.md")
      expect(await readdir(join(dir, ".opencode/auto"))).toEqual(["prompts"])
      expect(await readdir(dir)).toEqual([".opencode"])
      await rm(join(dir, ".opencode/auto/prompts"), { recursive: true })
      expect((await runCli(["init", dir])).code).toBe(0)
      const config = await Bun.file(join(dir, ".opencode/auto/config.json")).text()
      await mkdir(join(dir, ".opencode/auto/prompts"), { recursive: true })
      await Bun.write(join(dir, ".opencode/auto/prompts/decompose.md"), "Decompose the task.\n")
      const overwrite = await runCli(["init", dir, "-f", "--context-limit", "32"])
      expect(overwrite.code).toBe(1)
      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).text()).toBe(config)
      expect(await Bun.file(join(dir, ".opencode/auto/brief.md")).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init -p and init --brief are retired (plans/0053 D31; the seed half retired by auto-core plans/0133 D9): the notices point at the analysis flow; an amend-written brief is never touched by a bare re-init", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const brief = join(dir, ".opencode/auto/brief.md")
      // init writes no brief: the analysis's approved proposal is the first
      // brief a project gets; --brief on init is refused naming that flow.
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await Bun.file(brief).exists()).toBe(false)
      await commitFixture(dir)
      const seedRefused = await runCli(["init", dir, "--brief", "Migrate legacy to bun."])
      expect(seedRefused.code).toBe(1)
      expect(seedRefused.err).toBe(
        "--brief is retired on init: init writes no brief — the project analysis comes first. The first plan/transfer opens docs/analysis.md; its approved `## Project brief` proposal installs the brief on release. A later manual override: opencode-auto amend <dir> --brief <text> | --brief-file <path>\n",
      )
      expect(await Bun.file(brief).exists()).toBe(false)
      const refused = await runCli(["init", dir, "-p", "the revised intent"])
      expect(refused.code).toBe(1)
      expect(refused.err).toBe(
        "--prompt is retired: init takes no prompt and writes no brief — the project analysis (opened by the first plan/transfer) proposes and installs the brief, and the planning input is plan -p\n",
      )
      // The person's manual word travels amend: written verbatim, and a bare
      // re-init never touches it (§7 A5; the overwrite gate is git-bound, so
      // commit between inits).
      expect((await runCli(["amend", dir, "--brief", "Migrate legacy to bun."])).code).toBe(0)
      expect(await Bun.file(brief).text()).toBe("Migrate legacy to bun.\n")
      await commitFixture(dir)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await Bun.file(brief).text()).toBe("Migrate legacy to bun.\n")
      expect((await runCli(["amend", dir, "--brief", "Second intent."])).code).toBe(0)
      expect(await Bun.file(brief).text()).toBe("Second intent.\n")
      // The revision channel is amend's alone: close's strict ladder names
      // the pair a non-option (plans/0283 re-keyed the run/plan refusal
      // family to the strict ladder).
      const onClose = await runCli(["close", "T-001", dir, "--reason", "r", "--brief", "x"])
      expect(onClose.code).toBe(1)
      expect(onClose.err).toContain("--brief is not a close option")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the config.json verify key is retired: true fails strictly; false (a stored artifact of an old init) is accepted and disappears at the next init", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      const file = join(dir, ".opencode/auto/config.json")
      const config = await readConfig(dir)
      await Bun.write(file, JSON.stringify({ ...config, verify: true }, null, 2) + "\n")
      // a strict load refuses it (plans/0283 re-keyed run's witness to land)
      const on = await runCli(["land", dir])
      expect(on.code).toBe(1)
      expect(on.err).toContain("verify is retired")
      await Bun.write(file, JSON.stringify({ ...config, verify: false }, null, 2) + "\n")
      // The amend rewrites the existing keys (verify:false, a stored artifact
      // of an old init, is silently dropped); --wrapup is a no-change key
      expect((await runCli(["amend", dir, "--wrapup"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual(config)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init prerequisite: a git repository whose identity cannot commit is refused before any write; once configured, init proceeds and writes the full ignore rules", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    const home = await mkdtemp(join(tmpdir(), "auto-cli-home-"))
    try {
      const git = (...args: string[]) => Bun.spawn(["git", "-C", dir, ...args], { stdout: "ignore", stderr: "ignore" }).exited
      await git("init", "-q")
      // Shield the subprocess from the global/system git config, so the
      // repository has no identity source at all (its commits would fail).
      // GIT_CONFIG_GLOBAL too (a nonexistent file is no global config): the
      // CLI_ENV_BASE below pins a global identity for the whole suite, and
      // merging the case env on top of it would leave that identity in view.
      const env = { HOME: home, XDG_CONFIG_HOME: join(home, "xdg"), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(home, "gitconfig") }
      const refused = await runCli(["init", dir], env)
      expect(refused.code).toBe(1)
      expect(refused.err).toContain("git cannot commit")
      expect(refused.err).toContain("user.email")
      // plans/0073: the refusal names the new identity flags
      expect(refused.err).toContain("--name <name> --email <email>")
      // The check runs before any write (validate-then-write, plans/0052 D7)
      expect(await readdir(dir)).toEqual([".git"])
      // With an identity configured, init proceeds and writes the full ignore
      // rules (the driver workdir + the local-only files).
      await git("config", "user.name", "t")
      await git("config", "user.email", "t@t")
      const init = await runCli(["init", dir], env)
      expect(init.code).toBe(0)
      expect(init.out).toContain("updated: .gitignore")
      const gitignore = await Bun.file(join(dir, ".gitignore")).text()
      for (const entry of ["tmp/", ".auto/", "/.env", "/AGENTS.md"]) {
        expect(gitignore).toContain(`${entry}\n`)
      }
      // the model registry project layer carries no entry since plans/0296 —
      // its visibility is the operator's own line to own or drop
      expect(gitignore).not.toContain("models.json")
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  })

})

// The push commands retired (plans/0283, the pull-only program's CLI
// tombstones): run, plan, transfer and clarify — and the hidden `_lane` lane
// worker with them — answer their one-line retirement notice on every
// invocation, ahead of the flag refusals, the unknown-option scan, --help,
// the arity check, the legacy-layout check and the run-lock refusal (a
// retired command has no flags, directory or lock semantics left to honor).
// The corpus convention — every removed surface pinned by a test answering a
// usage error — lives here: the five notices byte-identical, the daemon
// surfaces that replaced each kind of work named, and the plan/transfer flag
// remedies re-keyed onto the live commands that still refuse them.
describe("CLI: the push commands retired (plans/0283)", () => {
  const NOTICES: Record<string, string> = {
    run: "run is retired (plans/0283): the protocol does nothing via push — a phase's tasks are execute grants external coding agents claim over the executor protocol (a daemon's POST /projects/<project>/executor/claim; opencode-auto-server serve registers the project)\n",
    plan:
      "plan is retired (plans/0283): the no-agent planning routes are the daemon's plan operation (POST /projects/<project>/plan), the planning session the formulate grant's over the executor protocol, and one task at a time the task-add operation's (POST /projects/<project>/tasks)\n",
    transfer:
      "transfer is retired (plans/0283): the person-bracketed advance is the daemon's transfer operation (POST /projects/<project>/transfer) — a deterministic apply (git and document writes only), the distillation and the construction the distill/synthesize grants' over the executor protocol\n",
    clarify:
      "clarify is retired (plans/0283): the person's release act is the daemon's clarify operation (POST /projects/<project>/clarify) — or the document edit itself (the whole-line `Clarified: yes`) plus its commit\n",
    _lane: "_lane is retired (plans/0283): the push lane workers are demolished — concurrency rides the executor protocol's scoped/doc lease tiers (external workers claim grants in their own worktrees)\n",
  }

  test("each retired command answers its exact one-line notice with exit 1 — ahead of flags, --help, the arity check and the run lock; nothing is written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-dead-"))
    try {
      for (const [command, notice] of Object.entries(NOTICES)) {
        // The bare call
        const bare = await runCli([command, dir])
        expect(bare.code, command).toBe(1)
        expect(bare.err, command).toBe(notice)
        // Ahead of the flag refusals and the unknown-option scan: any flag
        // combination (frozen keys, retired flags, planning input, garbage)
        // gets this one answer only — a retired command has no flags left
        const flagged = await runCli([command, dir, "--phases", "admtvk", "-p", "input", "--verbose", "--frobnicate"])
        expect(flagged.code, command).toBe(1)
        expect(flagged.err, command).toBe(notice)
        // Ahead of --help: a retired command has no help view
        const helped = await runCli([command, "--help"])
        expect(helped.code, command).toBe(1)
        expect(helped.err, command).toBe(notice)
        // Ahead of the positional-arity check
        const extra = await runCli([command, "dir-a", "dir-b"])
        expect(extra.code, command).toBe(1)
        expect(extra.err, command).toBe(notice)
      }
      // Zero writes to the directory throughout
      expect(await readdir(dir)).toEqual([])
      // The hidden lane worker's own invocation shape answers the same way
      const lane = await runCli(["_lane", dir, "--unit", "T-001", "--merge", "auto-lane/T-001"])
      expect(lane.code).toBe(1)
      expect(lane.err).toBe(NOTICES._lane)
      // A live run lock does not change the answer either (ahead of the
      // run-lock refusal), and the lock file is neither taken nor removed
      await mkdir(join(dir, ".auto"), { recursive: true })
      await Bun.write(join(dir, ".auto/run.lock"), JSON.stringify({ pid: process.pid, host: hostname(), command: "transfer", started: "2026-11-21T10:00:00.000Z" }))
      const locked = await runCli(["transfer", dir])
      expect(locked.code).toBe(1)
      expect(locked.err).toBe(NOTICES.transfer)
      expect(await readdir(dir)).toEqual([".auto"])
      expect(await readdir(join(dir, ".auto"))).toEqual(["run.lock"])
      // An initialized project answers identically (the retirement outranks
      // every behavioral check)
      const made = await mkdtemp(join(tmpdir(), "auto-cli-dead-init-"))
      try {
        expect((await runCli(["init", made, "--phases", "am"])).code).toBe(0)
        for (const command of ["run", "plan", "transfer", "clarify"]) {
          const refused = await runCli([command, made])
          expect(refused.code, command).toBe(1)
          expect(refused.err, command).toBe(NOTICES[command])
        }
        // and the config layer the initialized project carries is untouched
        expect(await Bun.file(join(made, ".opencode/auto/config.json")).exists()).toBe(true)
      } finally {
        await rm(made, { recursive: true, force: true })
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the retired commands are gone from the help surface and never suggested", async () => {
    // The full usage carries the push-retired paragraph and no row for any
    // of the five commands
    const usage = await runCli(["--help"])
    expect(usage.code).toBe(0)
    expect(usage.out).toContain("run, plan, transfer, clarify (and the hidden _lane lane worker) are retired (plans/0283): the protocol does nothing via push, ever again")
    expect(usage.out).toContain("the person's acts — the boundary advance, the release, the task add — are the daemon's transfer/clarify/tasks operations")
    expect(usage.out).toContain("The task-append session (plan --append), the repair budget (run --repair) and the charter verifier are retired with them")
    for (const command of ["run", "plan", "transfer", "clarify"]) {
      expect(usage.out).not.toContain(`\n  opencode-auto ${command} `)
    }
    // An unknown command is refused naming the closest commands — a retired
    // name never suggests (its notice is its one answer), so the near-miss
    // of a dead command falls back to the plain pointer
    const typo = await runCli(["pla"])
    expect(typo.code).toBe(1)
    expect(typo.err).toContain("'pla' is not a command")
    expect(typo.err).not.toContain("did you mean")
    const rune = await runCli(["rune"])
    expect(rune.err).not.toContain("'run'")
    // A live near-miss still suggests
    const clos = await runCli(["clos"])
    expect(clos.err).toContain("did you mean 'close'?")
  })

  test("the plan/transfer flag remedies re-keyed to the daemon surfaces on every live command (plans/0283)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-dead-flags-"))
    try {
      const refusals: [string[], string][] = [
        // --append: the task-append session no longer runs — one task at a
        // time is the daemon's task-add operation
        [
          ["init", dir, "--append"],
          "--append is retired with plan (plans/0283: the task-append session no longer runs): init takes no --append. Add one task at a time with the task-add operation of a daemon (POST /projects/<project>/tasks), or re-formulate the phase's plan through its inputs",
        ],
        [
          ["close", "T-001", dir, "--reason", "r", "--append"],
          "--append is retired with plan (plans/0283: the task-append session no longer runs): close takes no --append.",
        ],
        // --force-close: close-then-continue over the daemon is the close
        // operation then the plan operation
        [
          ["init", dir, "--force-close", "T-001"],
          "--force-close is retired with plan (plans/0283): init takes no --force-close. Close a unit with opencode-auto close <ref> [dir] --reason <text> — close-then-continue over the daemon is the close operation then the plan operation",
        ],
        // --scaffold: the intent pack's ## planning-input section carries it
        [["init", dir, "--scaffold"], "--scaffold is retired with plan (plans/0283): init takes no --scaffold. The active intent pack's ## planning-input section carries the planning-input scaffold"],
        // --new-task: one task at a time is the daemon's task-add operation
        [["init", dir, "--new-task", "a task"], "--new-task is retired with plan (plans/0283): init takes no --new-task. One task at a time is the task-add operation of a daemon (POST /projects/<project>/tasks with the one-line title)"],
        // --export/--adopt: the standalone work-order routes retired with
        // their command — the executor protocol's grants carry the work
        [["init", dir, "--export", "T-001"], "--export is retired with plan (plans/0283): init takes no --export. The standalone work-order routes retired with their command — the executor protocol's grants carry the work to external agents"],
        [["init", dir, "--adopt", "T-001"], "--adopt is retired with plan (plans/0283): init takes no --adopt. The standalone work-order routes retired with their command — the executor protocol's grants carry the work to external agents"],
        // --round/--phase: the documents are the person's own channel
        [["init", dir, "--round"], "--round is retired with plan (plans/0283): init takes no --round. The documents are the person's own channel — fill the round brief (docs/R-NN/round.md) or the planning input (docs/R-NN/P<nn>-<type>/plan-input.md) with your coding agent directly"],
        [["init", dir, "--phase"], "--phase is retired with plan (plans/0283): init takes no --phase. The documents are the person's own channel"],
        // --resynthesize: the daemon's transfer operation carries the field
        [["status", dir, "--resynthesize"], "--resynthesize is retired with transfer (plans/0283): status takes no --resynthesize. The transfer operation of a daemon (POST /projects/<project>/transfer) carries the resynthesize request field"],
        // The planning input pair: the phase's plan-input.md, read by the
        // formulation
        [["init", dir, "--file", "f.md"], "--file is retired with the plan command (plans/0283 — the planning input is the phase's plan-input.md); init does not accept it"],
        [["close", "T-001", dir, "--reason", "r", "-p", "text"], "-p/--prompt is retired with the plan command (plans/0283 — the planning input is the phase's plan-input.md, read by the formulation); close takes no planning input"],
        // Run's session flags keep their pointers on init (the flags went
        // with their command)
        [["init", dir, "--dryrun"], "--dryrun is retired with the run command (plans/0283): init does not accept it — there is no dry-run init, and the refusal comes before any write"],
        [["init", dir, "--server", "http://localhost:1"], "--server is retired with the run command (plans/0283); init does not accept it — init starts no session"],
        [["init", dir, "--max-sessions", "1"], "--max-sessions is a run option (concurrent AI sessions for this run); init does not accept it"],
        [["init", dir, "--stop-after", "T-001"], "--stop-after is a run option (the task whose completion ends that run, per run and never persisted); init does not accept it"],
      ]
      for (const [args, notice] of refusals) {
        const refused = await runCli(args)
        expect(refused.code, args.join(" ")).toBe(1)
        expect(refused.err, args.join(" ")).toContain(notice)
      }
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// models retired (plans/0296, the opencode severance): the model registry
// was push-mode carriage — the tool spawns no agent session, ever, so the
// registry's whole surface (the table command, the --probe flag) is a
// permanent usage tombstone in the 0283 shape: the command answers its
// one-line notice ahead of every flag, directory and lock semantics, and
// the flag answers its own notice on every live command.
describe("CLI: models retired (plans/0296)", () => {
  const NOTICE =
    "models is retired (plans/0296, the opencode severance): the model registry was push-mode carriage — this tool spawns no agent session, ever, so there is no registry left to describe or probe; the agents that work a project are external coding agents claiming grants over the executor protocol, each bringing its own model (opencode-auto-server serve registers the project)\n"
  const FLAG_NOTICE =
    "--probe is retired with models (plans/0296, the opencode severance): the model registry was push-mode carriage — this tool spawns no agent session, ever, so there is no fleet to probe; the agents that work a project are external coding agents claiming grants over the executor protocol, each bringing its own model"

  test("the command answers its exact one-line notice with exit 1 — ahead of flags, --help and the arity check; nothing is written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-models-dead-"))
    try {
      const bare = await runCli(["models", dir])
      expect(bare.code).toBe(1)
      expect(bare.err).toBe(NOTICE)
      // ahead of the flag policy and the unknown-option scan — --probe and
      // garbage alike get this one answer only
      const flagged = await runCli(["models", dir, "--probe", "--frobnicate"])
      expect(flagged.code).toBe(1)
      expect(flagged.err).toBe(NOTICE)
      // ahead of --help: a retired command has no help view
      const helped = await runCli(["models", "--help"])
      expect(helped.code).toBe(1)
      expect(helped.err).toBe(NOTICE)
      // ahead of the positional-arity check
      const extra = await runCli(["models", "dir-a", "dir-b"])
      expect(extra.code).toBe(1)
      expect(extra.err).toBe(NOTICE)
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("--probe answers its own retirement notice on every command that accepts the vocabulary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-probe-dead-"))
    try {
      for (const args of [["init", dir, "--probe"], ["amend", dir, "--probe"], ["init", dir, "--probe=false"]]) {
        const refused = await runCli(args)
        expect(refused.code, args.join(" ")).toBe(1)
        expect(refused.err, args.join(" ")).toContain(FLAG_NOTICE)
      }
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the command is gone from the help surface and never suggested", async () => {
    const usage = await runCli(["--help"])
    expect(usage.code).toBe(0)
    expect(usage.out).toContain("models (and its --probe) is retired (plans/0296, the opencode severance)")
    expect(usage.out).not.toContain("\n  opencode-auto models ")
    // a near-miss of the dead name never suggests it (its notice is its one
    // answer)
    const typo = await runCli(["model"])
    expect(typo.code).toBe(1)
    expect(typo.err).toContain("'model' is not a command")
    expect(typo.err).not.toContain("'models'")
  })
})

// init's git bootstrap and identity resolution (auto-core plans/0073, ruled
// 2026-10-04): a non-git target directory is bootstrapped into a real
// repository in one go — git init (init.defaultBranch when the person set
// one, -b main as the fallback), printed loudly; the identity resolves
// globally, or via --name/--email written as repository-local config, or
// init refuses. The non-git production tier this replaces was silently
// broken (no unified commit, no baselines, no rollback, no audit trail).
describe("CLI: init's git bootstrap and identity (plans/0073)", () => {
  // An env shielding every identity source (the existing prerequisite case's
  // trick): a nonexistent GIT_CONFIG_GLOBAL is no global config, so the
  // repository has no identity at all.
  const noIdentityEnv = (home: string) => ({
    HOME: home,
    XDG_CONFIG_HOME: join(home, "xdg"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
  })

  test("a non-git directory: the repository is bootstrapped loudly on main, the full ignore set lands in it, and the resolving global identity writes nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      // The suite's pinned GIT_CONFIG_GLOBAL carries the identity and
      // defaultBranch=main (T-127), so this init takes the global-identity
      // branch of the resolution order.
      const init = await runCli(["init", dir])
      expect(init.code).toBe(0)
      expect(init.out).toContain(`✓ initialized git repository (branch main) in ${dir} — the driver's record and rollback need it`)
      const git = gitOf(dir)
      expect((await git("rev-parse", "--is-inside-work-tree")).trim()).toBe("true")
      expect((await git("symbolic-ref", "--short", "HEAD")).trim()).toBe("main")
      // The identity resolved globally: nothing written locally (never a
      // config write for what already resolves).
      const localName = Bun.spawnSync(["git", "-C", dir, "config", "--local", "--get", "user.name"])
      expect(localName.exitCode).not.toBe(0)
      // The ignore set went into the bootstrapped repository (ensureInitGitignore
      // sees the work tree the bootstrap created).
      expect(init.out).toContain("updated: .gitignore")
      const gitignore = await Bun.file(join(dir, ".gitignore")).text()
      for (const entry of ["tmp/", ".auto/", "/.env", "/AGENTS.md"]) {
        expect(gitignore).toContain(`${entry}\n`)
      }
      // the model registry project layer carries no entry since plans/0296
      expect(gitignore).not.toContain("models.json")
      expect(init.out).toContain(`next: the plan operation of a daemon (POST /projects/<project>/plan)`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the person's init.defaultBranch decides the branch (no -b main override); --name/--email land as repository-local config and the global file is untouched", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    const home = await mkdtemp(join(tmpdir(), "auto-cli-home-"))
    try {
      // A global config with defaultBranch=trunk and NO identity: the branch
      // comes from the setting, the identity from the flags.
      const global = join(home, "gitconfig")
      await Bun.write(global, "[init]\n\tdefaultBranch = trunk\n")
      const init = await runCli(["init", dir, "--name", "Boot Person", "--email", "boot@example.com"], {
        HOME: home,
        XDG_CONFIG_HOME: join(home, "xdg"),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: global,
      })
      expect(init.code, `${init.out}\n${init.err}`).toBe(0)
      expect(init.out).toContain("initialized git repository (branch trunk)")
      expect(init.out).toContain("commit identity written as repository-local config")
      const git = gitOf(dir)
      expect((await git("symbolic-ref", "--short", "HEAD")).trim()).toBe("trunk")
      expect((await git("config", "--local", "user.name")).trim()).toBe("Boot Person")
      expect((await git("config", "--local", "user.email")).trim()).toBe("boot@example.com")
      // Never --global: the person's global file is byte-identical (no [user]
      // section added), and a commit under the local identity works.
      expect(await Bun.file(global).text()).toBe("[init]\n\tdefaultBranch = trunk\n")
      await Bun.write(join(dir, "a.txt"), "a")
      await git("add", "-A")
      await git("commit", "-qm", "first commit")
      expect((await git("log", "-1", "--pretty=%ae")).trim()).toBe("boot@example.com")
      expect(init.out).toContain("updated: .gitignore")
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  })

  test("no identity and no flags: init refuses naming the flags, leaving the bootstrapped empty repository and no config layer (rm -rf .git away from undone)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    const home = await mkdtemp(join(tmpdir(), "auto-cli-home-"))
    try {
      const refused = await runCli(["init", dir], noIdentityEnv(home))
      expect(refused.code).toBe(1)
      expect(refused.err).toContain("git cannot commit")
      expect(refused.err).toContain("--name <name> --email <email>")
      // The bootstrap ran before the refusal (its loud print is on stdout),
      // but nothing else was written: validate-then-write holds for the
      // config layer; the empty repository is the disclosed leftover.
      expect(refused.out).toContain(`✓ initialized git repository (branch main) in ${dir}`)
      expect(await readdir(dir)).toEqual([".git"])
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  })

  test("--name/--email also serve an existing repository without identity (in-repo init unchanged otherwise); a partial pair is a usage error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    const home = await mkdtemp(join(tmpdir(), "auto-cli-home-"))
    try {
      await Bun.spawn(["git", "-C", dir, "init", "-q"], { stdout: "ignore", stderr: "ignore" }).exited
      // AUTO-DECISION (uniform flag path): the identity flags apply wherever
      // the probe fails — the freshly bootstrapped repository (the plan's
      // primary case) and an existing one alike; "drop --global to configure
      // this repository only" is exactly what they automate. In-repo init
      // without the flags is unchanged (the prerequisite case above).
      const init = await runCli(["init", dir, "--name", "Local Person", "--email", "local@example.com"], noIdentityEnv(home))
      expect(init.code, `${init.out}\n${init.err}`).toBe(0)
      expect(init.out).not.toContain("initialized git repository")
      const git = gitOf(dir)
      expect((await git("config", "--local", "user.name")).trim()).toBe("Local Person")
      expect((await git("config", "--local", "user.email")).trim()).toBe("local@example.com")
      // The pair must be complete (a commit identity needs both)
      const lonely = await runCli(["init", dir, "-f", "--name", "x"], noIdentityEnv(home))
      expect(lonely.code).toBe(1)
      expect(lonely.err).toContain("--name requires its pair --email")
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  })
})


// The init shortcut retired with auto-core's implement.ts (plans/0053 D13)
// and the plan command with it (plans/0283): the planning input is the
// phase's plan-input.md, the planning session the formulate grant's over the
// executor protocol. The flags stay value-parsed and every live command
// refuses them with the retired notice before it writes anything.
describe("CLI: --implement-file/--implement-prompt retired (plans/0053 D13; plans/0283)", () => {
  test("every command refuses them with the retired notice; nothing is written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      for (const [flag, args] of [
        ["implement-prompt", ["init", dir, "--implement-prompt", "do something"]],
        ["implement-file", ["init", dir, "--phases", "am", "--implement-file", "plan.md"]],
        ["implement-prompt", ["init", dir, "--amend", "--implement-prompt", "do something"]],
        ["implement-file", ["amend", dir, "--phases", "m", "--implement-file", "plan.md"]],
      ] as const) {
        const refused = await runCli([...args])
        expect(refused.code).toBe(1)
        expect(refused.err).toContain(
          `--${flag} is retired (and with it the plan command itself, plans/0283): the planning input is the phase's plan-input.md, the planning session the formulate grant's over the executor protocol`,
        )
      }
      // run answers its own retirement notice ahead of the flag's (the one
      // answer whatever follows a dead command)
      const onRun = await runCli(["run", dir, "--implement-prompt", "do something"])
      expect(onRun.code).toBe(1)
      expect(onRun.err).toContain("run is retired (plans/0283):")
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// init config-only and amend without the round step (auto-core plans/0053
// D31–D32, C1): init's -p and --amend retire with notices naming their
// replacements, init writes the config layer only and points at plan (fresh
// and overwrite alike), and amend never touches the rounds.
describe("CLI: init config-only; init -p/--amend retired (plans/0053 D31)", () => {
  test("init -p and init --amend print their retired notices on every command that has no use for them; nothing is written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const prompt = await runCli(["init", dir, "-p", "intent"])
      expect(prompt.code).toBe(1)
      expect(prompt.err).toBe(
        "--prompt is retired: init takes no prompt and writes no brief — the project analysis (opened by the first plan/transfer) proposes and installs the brief, and the planning input is plan -p\n",
      )
      const flag = await runCli(["init", dir, "--amend"])
      expect(flag.code).toBe(1)
      expect(flag.err).toBe("--amend is retired: init is the stateless full overwrite; to change individual keys use opencode-auto amend <dir> --<key> <value>\n")
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init writes the config layer only (fresh and overwrite) and prints the opening-operation closing line (the daemon's plan operation in m mode, its transfer operation phased)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir])
      expect(init.code).toBe(0)
      expect(init.out).toContain(`next: the plan operation of a daemon (POST /projects/<project>/plan) (opens the assisted project analysis: you and your agent fill docs/analysis.md, guided through AGENTS.md; round R-01 opens on its release)`)
      // The config layer only: nothing lands under docs/ (no round directory,
      // no round.md stub — round artifacts are all the opening act's), and
      // no brief is written without --brief (plans/0081 D11)
      expect(await stat(join(dir, "docs")).catch(() => undefined)).toBeUndefined()
      expect(await stat(join(dir, "docs/R-01")).catch(() => undefined)).toBeUndefined()
      expect(await Bun.file(join(dir, "docs/R-01/round.md")).exists()).toBe(false)
      expect(await Bun.file(join(dir, "docs/R-01/AGENTS.md.bak")).exists()).toBe(false)
      expect(await Bun.file(join(dir, ".opencode/auto/brief.md")).exists()).toBe(false)
      // An overwrite init turning the project phased (no round established):
      // the closing line names the transfer operation (the phased opener,
      // plans/0101 D4, re-keyed by plans/0283), still no round established
      await commitFixture(dir)
      const overwrite = await runCli(["init", dir, "--phases", "amt"])
      expect(overwrite.code).toBe(0)
      expect(overwrite.out).toContain(`next: the transfer operation of a daemon (POST /projects/<project>/transfer) (opens the assisted project analysis: you and your agent fill docs/analysis.md, guided through AGENTS.md; round R-01 opens on its release)`)
      expect(await stat(join(dir, "docs")).catch(() => undefined)).toBeUndefined()
      // Once the opening operation has established the round, an overwrite
      // init's closing line is the plain opener pointer (no longer claiming
      // to establish R-01) — and a bare overwrite falls phases back to "m",
      // so its opener is the plan operation's again
      await establish(dir, "amt")
      await commitFixture(dir)
      const again = await runCli(["init", dir])
      expect(again.code).toBe(0)
      expect(again.out).toContain(`next: the plan operation of a daemon (POST /projects/<project>/plan)`)
      expect(again.out).not.toContain("establishes round")
      // The existing round survives untouched
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [ ] P01 analysis\n- [ ] P02 implement\n- [ ] P03 test\n")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: phased flow P2 (round directories / empty templates / phase lines / ledger preflight)", () => {
  test("init --phases amt writes the config layer only; the opening operation establishes R-01 at round start (phase index + phase directories, no PLAN.md); status prints the phase tree", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--phases", "amt"])
      expect(init.code).toBe(0)
      // init establishes no round (plans/0053 D31): docs/ does not exist, the
      // closing line points at the transfer operation (the phased opener,
      // plans/0101 D4, re-keyed by plans/0283)
      expect(await stat(join(dir, "docs")).catch(() => undefined)).toBeUndefined()
      expect(init.out).toContain(`next: the transfer operation of a daemon (POST /projects/<project>/transfer) (opens the assisted project analysis: you and your agent fill docs/analysis.md, guided through AGENTS.md; round R-01 opens on its release)`)
      const made = await establish(dir, "amt")
      expect(made.round).toBe(1)
      expect((await Bun.file(join(dir, "docs/R-01/phases.md")).text()).length).toBeGreaterThan(0)
      // The task unit layout (M3.4): no root or in-round PLAN.md anymore
      expect(await Bun.file(join(dir, "PLAN.md")).exists()).toBe(false)
      expect(await Bun.file(join(dir, "docs/R-01/PLAN.md")).exists()).toBe(false)
      // Round start no longer snapshots AGENTS.md (AGENTS.md.bak retired,
      // auto-core plans/0054 D1)
      expect(await Bun.file(join(dir, "docs/R-01/AGENTS.md.bak")).exists()).toBe(false)
      const status = await runCli(["status", dir])
      expect(status.code).toBe(0)
      expect(status.out).toContain("R-01 (0/3 phases done)\n  [▶] P01-analysis\n  [ ] P02-implement\n  [ ] P03-test\n")
      // The phase index and the phase directories are established at round
      // start
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [ ] P01 analysis\n- [ ] P02 implement\n- [ ] P03 test\n")
      expect(await Bun.file(join(dir, "docs/R-01/P02-implement/todo.md")).exists()).toBe(true)
      // Not planned yet, no task lines
      expect(status.out).not.toContain("T-0")
      // Once a phase completes (done.md), the phase tree updates with it
      await completeLetters(dir, ["a"])
      expect((await runCli(["status", dir])).out).toContain("  [✓] P01-analysis\n  [▶] P02-implement\n  [ ] P03-test\n")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("phases = m is the implicit phase R-01/P01-implement; init changing --phases no longer rewrites the round, and a phase directory holding work is refused for dropping", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      await establish(dir, "m")
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [ ] P01 implement\n")
      expect(await Bun.file(join(dir, "docs/R-01/P01-implement/todo.md")).exists()).toBe(true)
      // The unstarted implicit phase directory is still there (no tasks, no
      // done): init --phases am is allowed (a compatible value), but the index
      // is never rewritten — the difference surfaces as a drift for the
      // advance to reconcile (D31/D34)
      await commitFixture(dir)
      expect((await runCli(["init", dir, "--phases", "am"])).code).toBe(0)
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [ ] P01 implement\n")
      expect(await Bun.file(join(dir, "docs/R-01/P01-implement/todo.md")).exists()).toBe(true)
      expect(JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())).toMatchObject({ phases: "am" })
      // A phase directory that already lists tasks is not silently dropped
      // (the prefix guard's plannedPhaseUnits check)
      await Bun.write(join(dir, "docs/R-01/P01-implement/tasks.md"), "# Tasks\n\n- [ ] T-001 real task\n")
      const refused = await runCli(["init", dir, "--phases", "dmt"])
      expect(refused.code).toBe(1)
      expect(refused.err).toContain("already holds work (tasks.md)")
      expect(await Bun.file(join(dir, "docs/R-01/P01-implement/tasks.md")).text()).toContain("real task")
      // refused before any write (plans/0052 D7): config.json keeps the old phases
      expect(JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())).toMatchObject({ phases: "am" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("status only notes an invalid ledger without blocking; phases = m prints no phase progress line (the phase tree prints as usual)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "amt"])).code).toBe(0)
      await establish(dir, "amt")
      await Bun.write(join(dir, "docs/R-01/phases.md"), "an arbitrary line\n")
      const status = await runCli(["status", dir])
      expect(status.code).toBe(0)
      expect(status.out).toContain("⚠ phase index docs/R-01/phases.md is invalid")
      // A phases = m project prints no phase line (the default single run, no
      // phase semantics)
      const plain = await mkdtemp(join(tmpdir(), "auto-cli-"))
      try {
        expect((await runCli(["init", plain])).code).toBe(0)
        await establish(plain, "m")
        const out = (await runCli(["status", plain])).out
        expect(out).not.toContain("phases: ")
        expect(out).toContain("[▶] P01-implement")
      } finally {
        await rm(plain, { recursive: true, force: true })
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // The missing-index remedy is phased-aware through the one emitter family
  // (0165-167, pinned over 0193 D1; plans/0283 re-keyed the run-banner arm to
  // the status view — the emitter's surviving caller — with the taught
  // commands rendered through the shell profile's surface seam): the phased
  // project's line names the transfer operation, m mode's the plan operation.
  test("the missing-index remedy is phased-aware in the status view: the phased line teaches the transfer operation, m mode's the plan operation (0165-167; plans/0283)", async () => {
    const phased = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", phased, "--phases", "dm"])).code).toBe(0)
      const status = await runCli(["status", phased])
      expect(status.out).toContain("⚠ phase index (docs/R-01/phases.md) is missing; run the transfer operation of a daemon (POST /projects/<project>/transfer — opencode-auto-server serve) to establish the round")
      expect(status.out).not.toContain("the plan operation of a daemon")
      // m mode's split (the default single-phase project): the plan operation
      // establishes the round
      const mode = await mkdtemp(join(tmpdir(), "auto-cli-"))
      try {
        expect((await runCli(["init", mode])).code).toBe(0)
        const out = (await runCli(["status", mode])).out
        expect(out).toContain("⚠ phase index (docs/R-01/phases.md) is missing; run the plan operation of a daemon (POST /projects/<project>/plan — opencode-auto-server serve) to establish the round")
        expect(out).not.toContain("the transfer operation of a daemon")
      } finally {
        await rm(mode, { recursive: true, force: true })
      }
    } finally {
      await rm(phased, { recursive: true, force: true })
    }
  })
})

// `continue` retired (auto-core plans/0053 D33; the advance command since
// plans/0101 D2 is transfer): the round-close checks and the next round's
// opening are the advance command's — transfer's — so the dedicated
// subcommand is a usage error. The notice is the one answer whatever follows
// the command; the routes it used to serve (the previous round's completeness
// re-check, the round-close gate, establishing the next round) are covered by
// the plan and transfer describes.
describe("CLI: continue retired (auto-core plans/0053 D33; the advance re-keyed by plans/0283)", () => {
  const NOTICE =
    "continue is retired: once the round is complete, fill in ## Close of docs/R-NN/round.md, commit, and advance with the transfer operation of a daemon (POST /projects/<project>/transfer) — it runs the round-close checks and opens the next round\n"

  test("--continue is not an option: init points at the daemon's transfer operation; the retired commands answer their own notices", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--continue"])
      expect(init.code).toBe(1)
      expect(init.err).toContain("--continue is not an option")
      expect(init.err).toContain(
        "the next round opens with the transfer operation of a daemon (POST /projects/<project>/transfer) — once the round is complete, fill in ## Close of docs/R-NN/round.md, commit, and advance (it runs the round-close checks and opens the next round)",
      )
      expect(init.err).not.toContain("continue is retired")
      // run and plan answer their retirement notices ahead of the flag (a
      // retired command has no flags left to refuse)
      const run = await runCli(["run", dir, "--continue"])
      expect(run.code).toBe(1)
      expect(run.err).toContain("run is retired (plans/0283):")
      expect(run.err).not.toContain("--continue is not an option")
      const plan = await runCli(["plan", dir, "--continue"])
      expect(plan.code).toBe(1)
      expect(plan.err).toContain("plan is retired (plans/0283):")
      expect(plan.err).not.toContain("--continue is not an option")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("continue always gets the retirement message and exits 1: ahead of flag handling and the lock check, zero writes to the directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      // The bare call and any flag combination (retired flags and -p included)
      // get this one message only
      const plain = await runCli(["continue", dir])
      expect(plain.code).toBe(1)
      expect(plain.err).toBe(NOTICE)
      const flagged = await runCli(["continue", dir, "--phases", "admtvk", "-p", "second-round intent", "--verify", "--context-limit", "128"])
      expect(flagged.code).toBe(1)
      expect(flagged.err).toBe(NOTICE)
      // Ahead of the lock check: with a live lock present it is still the
      // retirement notice, not the lock refusal
      await Bun.write(join(dir, ".auto/run.lock"), JSON.stringify({ pid: process.pid, host: hostname(), command: "plan", started: "2026-09-23T10:00:00.000Z" }))
      const locked = await runCli(["continue", dir])
      expect(locked.code).toBe(1)
      expect(locked.err).toBe(NOTICE)
      // Zero writes throughout
      expect(await readdir(dir)).toEqual([".auto"])
      expect(await readdir(join(dir, ".auto"))).toEqual(["run.lock"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an initialized project gets the retirement message too, the previous round complete or not (the daemon's transfer operation opens the next round now)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "am"])).code).toBe(0)
      await establish(dir, "am")
      // Even with the previous round complete (where continue's old semantics
      // would have applied), the retirement outranks every behavioral check
      await completeLetters(dir, ["a", "m"])
      await fillClose(dir)
      const cont = await runCli(["continue", dir])
      expect(cont.code).toBe(1)
      expect(cont.err).toBe(NOTICE)
      // The round capability retired with the subcommand's replacement, not
      // with the subcommand: the next round opens through the daemon's
      // transfer operation (the round-close checks then the establishment,
      // auto-core's transfer suites pin that rendering); transfer itself
      // answers its notice here
      const transfer = await runCli(["transfer", dir])
      expect(transfer.code).toBe(1)
      expect(transfer.err).toContain("transfer is retired (plans/0283): the person-bracketed advance is the daemon's transfer operation")
      // and the completed round's documents stand untouched by either refusal
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [x] P01 analysis\n- [x] P02 implement\n")
      expect(await Bun.file(join(dir, "docs/R-01/round.md")).text()).toContain("## Close")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// `check` retired: its principle scan was a regex heuristic over prose and
// its reference check was removed with the reference checker; the useful
// half — the configuration findings — is `fix`'s (see `fix --dryrun` below).
// Like `continue`'s, the notice is the one answer whatever follows the
// command, ahead of the flag refusals, the legacy-layout check and the
// run-lock refusal.
describe("CLI: check retired", () => {
  const NOTICE =
    "check is retired: the principle scan and the reference check were removed; opencode-auto fix --dryrun <dir> lists the configuration findings\n"

  test("check always gets the retirement message and exits 1: ahead of flag handling, the legacy-layout check and the lock check, zero writes to the directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      // The bare call and any flag combination get this one message only
      const plain = await runCli(["check", dir])
      expect(plain.code).toBe(1)
      expect(plain.err).toBe(NOTICE)
      const flagged = await runCli(["check", dir, "--verbose", "--source-dir", "legacy"])
      expect(flagged.code).toBe(1)
      expect(flagged.err).toBe(NOTICE)
      // Ahead of the legacy-layout check: an old-layout tree still gets the
      // notice, not the layout refusal (check's old exemption is moot — the
      // command answers nothing else)
      await Bun.write(join(dir, "PLAN.md"), "# plan\n")
      const legacy = await runCli(["check", dir])
      expect(legacy.code).toBe(1)
      expect(legacy.err).toBe(NOTICE)
      // Ahead of the lock check: with a live lock present it is still the
      // retirement notice, not the lock refusal
      await Bun.write(join(dir, ".auto/run.lock"), JSON.stringify({ pid: process.pid, host: hostname(), command: "plan", started: "2026-09-23T10:00:00.000Z" }))
      const locked = await runCli(["check", dir])
      expect(locked.code).toBe(1)
      expect(locked.err).toBe(NOTICE)
      // Zero writes throughout
      expect((await readdir(dir)).sort()).toEqual([".auto", "PLAN.md"])
      expect(await readdir(join(dir, ".auto"))).toEqual(["run.lock"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an initialized project gets the retirement message too; the usage text names fix --dryrun", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      const check = await runCli(["check", dir])
      expect(check.code).toBe(1)
      expect(check.err).toBe(NOTICE)
      // The usage listing carries the retirement line and no check command
      const usage = await runCli([])
      expect(usage.code).toBe(1)
      expect(usage.err).toContain("check is retired: the principle scan and the reference check were removed; opencode-auto fix --dryrun <dir> lists the configuration findings")
      expect(usage.err).not.toContain("opencode-auto check [dir]")
      expect(usage.err).toContain("opencode-auto fix [dir] [-f|--force] [--dryrun [true|false]]")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// The help surface (the COMMANDS/OPTION_HELP table of src/index.ts): --help
// and -h print the full usage to stdout with exit 0, <command> --help (or
// -h) one command's row — synopsis, summary, its option paragraphs — from
// the same table, and an unknown command is refused with one line naming
// the closest commands instead of the full usage dump. The retirement
// notices stay ahead of --help (a retired command has no help), the hidden
// _lane never gains a help surface, and the missing-subcommand fallback
// keeps the full usage on stderr with exit 1 — the channel the retirement
// lines above are pinned through.
describe("CLI: help and unknown commands", () => {
  test("--help and -h print the full usage to stdout with exit 0; the bare invocation keeps it on stderr with exit 1", async () => {
    const help = await runCli(["--help"])
    expect(help.code).toBe(0)
    expect(help.out).toContain("usage:")
    expect(help.out).toContain("opencode-auto init [dir]")
    expect(help.out).toContain("check is retired: the principle scan and the reference check were removed; opencode-auto fix --dryrun <dir> lists the configuration findings")
    expect(help.out).toContain("exit codes: 0 all complete")
    const short = await runCli(["-h"])
    expect(short.code).toBe(0)
    expect(short.out).toContain("usage:")
    const bare = await runCli([])
    expect(bare.code).toBe(1)
    expect(bare.err).toContain("usage:")
    expect(bare.err).toContain("opencode-auto fix [dir] [-f|--force] [--dryrun [true|false]]")
    expect(bare.out).toBe("")
  })

  test("<command> --help / -h prints that command's row only — synopsis, summary, its option paragraphs — and outranks the option refusals", async () => {
    const close = await runCli(["close", "--help"])
    expect(close.code).toBe(0)
    expect(close.out).toContain("opencode-auto close <ref> [dir] --reason <text> [--cascade] [--commit-changes | --stash-changes]")
    expect(close.out).toContain("close — close a unit (task T-NNN, phase R-NN.P<nn>, round R-NN) without completing it")
    expect(close.out).toContain("run 'opencode-auto --help' for all commands")
    // The view carries its command's row alone, never another command's
    expect(close.out).not.toContain("opencode-auto init [dir]")
    expect(close.out).not.toContain("opencode-auto land [dir]")
    const land = await runCli(["land", "-h"])
    expect(land.code).toBe(0)
    expect(land.out).toContain("opencode-auto land [dir] [--keep] [--abandon] [--merge] [--onto <branch>]")
    expect(land.out).not.toContain("opencode-auto close <ref> [dir]")
    // --help outranks the unknown-option refusal: a person asking for help
    // is answered, whatever else rides the line (a retired command answers
    // its notice ahead of help instead — pinned in the push-retired
    // describe)
    const flagged = await runCli(["close", "--frobnicate", "--help"])
    expect(flagged.code).toBe(0)
    expect(flagged.out).toContain("opencode-auto close <ref> [dir]")
  })

  test("an unknown command is a one-line refusal with the closest command named — never the usage dump; a retired name never suggests", async () => {
    const typo = await runCli(["clos"])
    expect(typo.code).toBe(1)
    expect(typo.err).toContain("'clos' is not a command")
    expect(typo.err).toContain("did you mean 'close'?")
    expect(typo.err).not.toContain("usage:")
    // The retired commands never suggest (plans/0283): the near-miss of a
    // dead command falls back to the plain pointer, its notice its one answer
    const pla = await runCli(["pla"])
    expect(pla.err).toContain("'pla' is not a command")
    expect(pla.err).not.toContain("did you mean")
    const unknown = await runCli(["frobnicate"])
    expect(unknown.code).toBe(1)
    expect(unknown.err).toContain("'frobnicate' is not a command")
    expect(unknown.err).toContain("run 'opencode-auto --help' to see all commands")
    expect(unknown.err).not.toContain("usage:")
    // A path-shaped first word is the command-after-directory mistake: the
    // message names the shape
    const pathShaped = await runCli(["./some/project"])
    expect(pathShaped.code).toBe(1)
    expect(pathShaped.err).toContain("'./some/project' is not a command")
    expect(pathShaped.err).toContain("the command comes first: opencode-auto <command> [dir] [options]")
  })

  test("the retirement notices stay ahead of --help (a retired command has no help); _lane never gains a help surface", async () => {
    const cont = await runCli(["continue", "--help"])
    expect(cont.code).toBe(1)
    expect(cont.err).toContain("continue is retired")
    const check = await runCli(["check", "-h"])
    expect(check.code).toBe(1)
    expect(check.err).toContain("check is retired")
    const lane = await runCli(["_lane", "--help"])
    expect(lane.code).toBe(1)
    expect(lane.err).toContain("_lane is retired (plans/0283)")
  })

  test("the unknown-option refusal points at the command's own --help view", async () => {
    const refused = await runCli(["init", "some-dir", "--frobnicate"])
    expect(refused.code).toBe(1)
    expect(refused.err).toContain("unknown option --frobnicate")
    expect(refused.err).toContain("run 'opencode-auto init --help' to see this command's usage")
  })
})

// The option policy's enumeration guard (0159): the CLI's own invariant —
// "every flag outside its command's policy below is an error with exit 1, so
// a typo is never silently ignored" — had no test that enumerated the whole
// vocabulary, which is exactly how two holes landed silently (plan never
// refused the lane value flags; --from-bundle passed the global whitelist for
// every command while only sync consumed it). The vocabulary is derived from
// the parser's own constants in src/index.ts — read from source, never
// hand-copied, so a flag added there joins this enumeration without anyone
// remembering it — and each command that still accepts the known vocabulary
// must either CONSUME the flag (the consumed sets below are the commands'
// public option policy, changed only in the same change as the parser) or
// refuse it with exit 1 naming it. plans/0283 narrowed the open-vocabulary
// commands to init and amend: run/plan/transfer/_lane answer their retirement
// notices ahead of every flag (pinned in the push-retired describe), the
// strict and narrow commands enumerate their own ladders elsewhere, and the
// two config commands carry the guard now. The refusals fire in argument
// policy, before any directory work or write, so the cases share one empty
// directory and never write.
describe("CLI: the option policy's enumeration guard (0159)", () => {
  // The parser constants, extracted from the source the binary runs: the
  // flag tokens of VALUE_FLAGS and BOOLEAN_FLAGS (comments stripped first —
  // their prose never carries quoted tokens), the RETIRED_FLAGS keys (the
  // record's own two-space-indented key lines) and the literal extras of the
  // KNOWN_FLAGS line, unioned exactly the way the parser unions them.
  const source = readFileSync(join(import.meta.dir, "..", "src", "index.ts"), "utf8")
  const blockOf = (name: string, endMark: string): string => {
    const start = source.indexOf(`const ${name}`)
    if (start < 0) throw new Error(`${name} not found in src/index.ts — the test reads the parser's constants`)
    const end = source.indexOf(endMark, start)
    return source.slice(start, end)
  }
  const noComments = (text: string): string => text.replace(/^[ \t]*\/\/..*$/gm, "")
  const VALUE_FLAGS = new Set([...noComments(blockOf("VALUE_FLAGS", "// Repeatable value flags")).matchAll(/"([^"]+)"/g)].map(([, token]) => token))
  const BOOLEAN_FLAGS = new Set([...blockOf("BOOLEAN_FLAGS", "\nfor (let i = 1").matchAll(/"([^"]+)"/g)].map(([, token]) => token))
  const RETIRED_KEYS = new Set([...blockOf("RETIRED_FLAGS", "const KNOWN_FLAGS").matchAll(/^ {2}(?:"([A-Za-z0-9-]+)"|([A-Za-z0-9-]+)):/gm)].map(([, quoted, bare]) => quoted ?? bare))
  const KNOWN_FLAGS = new Set<string>([
    ...VALUE_FLAGS,
    ...BOOLEAN_FLAGS,
    ...RETIRED_KEYS,
    // The whitelist's literal extras, read off its own line (they have no
    // constant of their own): "continue", "commit-subtask", "verify-idle",
    // "verify-max".
    ...[...([...source.matchAll(/const KNOWN_FLAGS = new Set\(\[.*\]\)/g)][0]![0].matchAll(/"([^"]+)"/g) as unknown as RegExpMatchArray[])].map((match) => match[1]!),
  ])

  test("the parser constants parse: the vocabulary is non-empty and carries the load-bearing members", () => {
    expect(KNOWN_FLAGS.size).toBeGreaterThan(50)
    for (const loadBearing of ["unit", "merge", "from-bundle", "probe", "continue", "commit-subtask", "verify-idle", "verify-max", "reason", "resynthesize"]) {
      expect(KNOWN_FLAGS.has(loadBearing), `--${loadBearing} missing from the derived vocabulary`).toBe(true)
    }
  })

  // What each open-vocabulary command consumes — the public option policy
  // (only a conscious policy change edits these rows; everything else in the
  // vocabulary must be refused). init: its config flags, the brief pair, the
  // identity pair and -f; amend: the config flags, the retired rename pair,
  // --commit-subtask and the brief pair (their own notices fire inside the
  // block, each naming the flag).
  const CONFIG_FLAG_KEYS = ["mode", "agent", "context-limit", "subtask", "idle-time", "idle-max", "test-by-driver", "handover-test", "auto-number", "no-auto-number", "wrapup", "no-wrapup", "phases", "parallel", "scan-exempt", "isolate", "intent", "tree-lanes"] as const
  const CONSUMED: Record<"init" | "amend", ReadonlySet<string>> = {
    init: new Set([...CONFIG_FLAG_KEYS, "brief", "brief-file", "name", "email", "force"]),
    amend: new Set([...CONFIG_FLAG_KEYS, "verify-idle", "verify-max", "commit-subtask", "brief", "brief-file"]),
  }

  test("every known flag is consumed or refused with exit 1 naming it — init and amend each", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-enum-"))
    try {
      for (const command of ["init", "amend"] as const) {
        const refusedFlags = [...KNOWN_FLAGS].filter((flag) => !CONSUMED[command].has(flag))
        // The refusals exit in argument policy, before any write, so the
        // cases are independent and run concurrently in small batches.
        const failures: string[] = []
        for (let index = 0; index < refusedFlags.length; index += 12) {
          await Promise.all(
            refusedFlags.slice(index, index + 12).map(async (flag) => {
              const args = [command, dir, `--${flag}`, ...(VALUE_FLAGS.has(flag) ? ["zzz"] : [])]
              const result = await runCli(args)
              if (result.code !== 1 || !result.err.includes(`--${flag}`)) {
                failures.push(`${command} ${args.slice(2).join(" ")}: exit ${result.code}, stderr: ${result.err.trim().split("\n")[0]}`)
              }
            }),
          )
        }
        expect(failures, `${command}: every flag outside its policy refuses with exit 1 naming it`).toEqual([])
      }
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 120_000)

  // The hidden `_lane` column retired with its entry (plans/0283): the
  // machine-entry allowlist is gone, the notice its one answer — pinned in
  // the push-retired describe above.

  // The help table's own integrity: renderCommandHelp does OPTION_TEXT.get(key)!
  // non-null-asserted, so an `options` key that is neither "frozen" nor an
  // OPTION_HELP row would print a literal "undefined" paragraph in that
  // command's --help — a static check over the same source, no subprocess.
  test("every COMMANDS options key exists in OPTION_HELP (a typo'd key would render a literal undefined line)", () => {
    const optionHelpBlock = blockOf("OPTION_HELP", "// The exit-codes line")
    // The table's two row shapes: the wrapped multi-line rows (the bracket
    // alone on its line) and the single-line rows (["mode", "…"], the short
    // entries).
    const optionHelpKeys = new Set(
      [...optionHelpBlock.matchAll(/^ {2}\[\n {4}"([a-z0-9-]+)",|^ {2}\["([a-z0-9-]+)",/gm)].map(([, wrapped, single]) => wrapped ?? single),
    )
    expect(optionHelpKeys.size).toBeGreaterThan(30)
    const commandsBlock = blockOf("COMMANDS", "const OPTION_TEXT")
    const optionLists = [...commandsBlock.matchAll(/options: \[([^\]]*)\]/g)].map(([, inner]) => [...inner.matchAll(/"([^"]+)"/g)].map(([, key]) => key))
    expect(optionLists.length).toBeGreaterThanOrEqual(13)
    for (const keys of optionLists) {
      for (const key of keys) {
        expect(key === "frozen" || optionHelpKeys.has(key), `the ${key} options row has no OPTION_HELP paragraph`).toBe(true)
      }
    }
  })
})

// The parser's token-form refusals (plans/0195, the 0165 parser findings):
// the 0159 enumeration guard above covers flag tokens per command; these
// tests cover the token forms outside that frame — positional overflow
// (0165-166, 0159's own deferred residual: `run dir1 dir2` ran dir1 with
// dir2 silently swallowed — plans/0283 re-keyed the scene's commands to the
// live ones, the retired answers its notice ahead of the arity check), the
// =value form of boolean flags (0165-212: the eq branch set any value and
// every reader is a !== "false" comparison, so --verbose=flase silently
// meant true), and the empty key (0165-211: `--` parsed to "" and
// similarOptions's startsWith("") matched every name, flooding the refusal
// with the whole vocabulary). The refusals all fire in argument policy,
// before any directory work, so most cases need no real directory.
describe("CLI: the parser's token-form refusals (0195)", () => {
  test("extra positionals are usage errors naming the command's positional grammar — never silently ignored (0165-166)", async () => {
    const oneDir = await runCli(["status", "/nonexistent-proj", "extra-word"])
    expect(oneDir.code).toBe(1)
    expect(oneDir.err).toContain('unexpected argument "extra-word"')
    expect(oneDir.err).toContain("status takes at most one directory argument (usage: opencode-auto status [dir])")
    const land = await runCli(["land", "proj-a", "proj-b"])
    expect(land.code).toBe(1)
    expect(land.err).toContain('unexpected argument "proj-b"')
    expect(land.err).toContain("land takes at most one directory argument (usage: opencode-auto land [dir])")
    // The retired commands answer their notices ahead of the arity check
    // (pinned byte-identical in the push-retired describe; the shape here)
    const run = await runCli(["run", "dir1", "dir2"])
    expect(run.code).toBe(1)
    expect(run.err).not.toContain("unexpected argument")
    expect(run.err).toContain("run is retired (plans/0283):")
    // The per-command splits keep their own grammars: close <ref> [dir],
    // fork <target> <worktree-path> [dir], remove-fork <worktree-path> [dir]
    // — each refusal quotes the first extra word and the command's shape.
    const close = await runCli(["close", "R-001", "d1", "d2", "--reason", "x"])
    expect(close.code).toBe(1)
    expect(close.err).toContain('unexpected argument "d2"')
    expect(close.err).toContain("close takes <ref> [dir]: a unit reference, then an optional directory (usage: opencode-auto close <ref> [dir] --reason <text>)")
    const fork = await runCli(["fork", "T-001", "wt", "d1", "d2"])
    expect(fork.code).toBe(1)
    expect(fork.err).toContain('unexpected argument "d2"')
    expect(fork.err).toContain("fork takes <T-NNN | sha> <worktree-path> [dir]: the target, the worktree path, then an optional directory (usage: opencode-auto fork <T-NNN | sha> <worktree-path> [dir])")
    const removeFork = await runCli(["remove-fork", "wt", "d1", "d2"])
    expect(removeFork.code).toBe(1)
    expect(removeFork.err).toContain('unexpected argument "d2"')
    expect(removeFork.err).toContain("remove-fork takes <worktree-path> [dir]: the fork's root worktree, then an optional directory (usage: opencode-auto remove-fork <worktree-path> [dir] [--force])")
    // The documented arity itself still passes (P10's floor): close with
    // ref + dir reaches its own next stage, not this refusal
    const fine = await runCli(["close", "R-001", "d1", "--reason", "x"])
    expect(fine.err).not.toContain("unexpected argument")
  })

  test("boolean flags' =value form is validated — a typo'd value no longer silently means true (0165-212)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-bool-"))
    try {
      // The fix arm below runs the real command over an initialized project,
      // so the directory needs a config. fix --dryrun is the validated
      // boolean with a read-only surface: the typo'd value refuses, the
      // accepted forms run the listing (exit 0 over a consistent layer).
      expect((await runCli(["init", dir])).code).toBe(0)
      await commitFixture(dir)
      const refused = await runCli(["fix", dir, "--dryrun=yes"])
      expect(refused.code).toBe(1)
      expect(refused.err).toContain('--dryrun takes true or false: "yes" is neither')
      expect(refused.err).toContain("pass the flag bare for true, or --dryrun=false for the explicit opt-out")
      // Every command's booleans validate alike (the check sits at the
      // parser's policy layer): close's pair
      const close = await runCli(["close", "R-001", dir, "--reason", "x", "--cascade=x"])
      expect(close.code).toBe(1)
      expect(close.err).toContain('--cascade takes true or false: "x" is neither')
      // A retired boolean keeps its retirement notice — the more specific
      // remedy (the check sits after the retirement loop)
      const amend = await runCli(["init", dir, "--amend=x"])
      expect(amend.code).toBe(1)
      expect(amend.err).toContain("--amend is retired")
      expect(amend.err).not.toContain("takes true or false")
      // The accepted forms pass untouched (P10's floor): bare, =false, and
      // the swallowed true/false space form all run the read-only listing —
      // before the fix the typo'd form did too, silently on
      for (const argv of [["--dryrun"], ["--dryrun=true"], ["--dryrun", "true"], ["--dryrun=false", "-f"]]) {
        const floor = await runCli(["fix", dir, ...argv])
        expect(floor.err, argv.join(" ")).not.toContain("takes true or false")
        expect(floor.out, argv.join(" ")).toContain("✓ nothing to fix")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the -- end-of-options token is a plain one-line unknown-option refusal — no vocabulary flood (0165-211)", async () => {
    const refused = await runCli(["init", "some-dir", "--"])
    expect(refused.code).toBe(1)
    expect(refused.err).toContain("unknown option --")
    expect(refused.err).toContain("run 'opencode-auto init --help' to see this command's usage")
    // No did-you-mean clause at all: the empty key suggests nothing (the
    // pre-fix refusal named ~80 flags, retired ones included)
    expect(refused.err).not.toContain("did you mean")
    expect(refused.err).not.toContain("--agent")
    // The = form of the empty key answers the same way
    const eq = await runCli(["init", "some-dir", "--=x"])
    expect(eq.code).toBe(1)
    expect(eq.err).toContain("unknown option --")
    expect(eq.err).not.toContain("did you mean")
    // The strict ladders share the fix through the same helper
    const close = await runCli(["close", "R-001", "--"])
    expect(close.code).toBe(1)
    expect(close.err).toContain("-- is not a close option")
    expect(close.err).not.toContain("did you mean")
    // A non-empty prefix still suggests (only the empty key changed)
    const near = await runCli(["init", "some-dir", "--inte"])
    expect(near.code).toBe(1)
    expect(near.err).toContain("did you mean --intent / --interactive?")
  })
})

// The two public commands the shell suite drives beside their retired
// sibling (0159's coverage finding, re-keyed by plans/0283: clarify's whole
// exit mapping retired with the command — the person's release act is the
// daemon's clarify operation, the notice pinned in the push-retired
// describe): driver-helper's unloadable-config refusal; install-prompts's
// uninitialized refusal and its happy path (the never-delete-extra invariant
// included).
describe("CLI: driver-helper and install-prompts (the shell rows of 0105/0093)", () => {
  test("driver-helper renders the person-proxy brief; an unloadable config refuses (the map is keyed on it)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-helper-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      await commitFixture(dir)
      const brief = await runCli(["driver-helper", dir])
      expect(brief.code).toBe(0)
      for (const block of ["## ROLE — the person's pen, never the driver", "## PRIMER — how the driver works", "## STATE", "## CHANNELS", "## POLICY", "## RECOVERY"]) {
        expect(brief.out).toContain(block)
      }
      // An unloadable config refuses: renderHelperBrief is keyed on the
      // config's shape (phases/build), so a config that cannot load
      // strictly is an environment error, exit 1.
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ verify: true }))
      const refused = await runCli(["driver-helper", dir])
      expect(refused.code).toBe(1)
      expect(refused.err).toContain("verify")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("install-prompts resyncs the suite (extras never deleted) and refuses an uninitialized directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-prompts-"))
    try {
      const bare = await runCli(["install-prompts", dir])
      expect(bare.code).toBe(1)
      expect(bare.err).toContain(`nothing to install: ${dir} has no .opencode/auto/config.json; run opencode-auto init ${dir} first`)
      expect((await runCli(["init", dir])).code).toBe(0)
      await commitFixture(dir)
      const installed = await runCli(["install-prompts", dir])
      expect(installed.code).toBe(0)
      // plans/0296 slice 3: the suite is executor.md alone (the push prompt
      // suite retired with it)
      expect(installed.out).toContain(`prompt suite resynced into ${dir}/prompts: 1 files`)
      expect(installed.out).toContain("rewritten: executor.md")
      // The never-delete invariant: a person's own file under prompts/ is
      // reported and left alone; an already-current suite re-reports it.
      await Bun.write(join(dir, "prompts/my-own.md"), "# Mine\n\nLocal additions are the person's own.\n")
      const again = await runCli(["install-prompts", dir])
      expect(again.code).toBe(0)
      expect(again.out).toContain(`prompt suite already current in ${dir}/prompts: 1 files`)
      expect(again.out).toContain("left alone (not in the suite): my-own.md")
      expect(await Bun.file(join(dir, "prompts/my-own.md")).text()).toContain("Mine")
      // plans/0164 — the vintage pin and the drift gate. The install wrote
      // prompts/MANIFEST (excluded from the extras report above); --check
      // over a current suite exits 0, over drift exits 1 naming it, and the
      // resync restores current; anything but --check is refused.
      expect(again.out).toContain("manifest: prompts/MANIFEST pins this suite")
      const manifest = JSON.parse(await Bun.file(join(dir, "prompts/MANIFEST")).text()) as { suite: string; files: Record<string, string> }
      expect(Object.keys(manifest.files).length).toBe(1)
      expect(manifest.suite).toMatch(/^sha256-[0-9a-f]{64}$/)
      const clean = await runCli(["install-prompts", dir, "--check"])
      expect(clean.code).toBe(0)
      expect(clean.out).toContain(`prompt suite current in ${dir}/prompts (the manifest pins this binary's suite)`)
      await Bun.write(join(dir, "prompts/executor.md"), "drifted\n")
      await rm(join(dir, "prompts/MANIFEST"))
      const drift = await runCli(["install-prompts", dir, "--check"])
      expect(drift.code).toBe(1)
      expect(drift.out).toContain(`prompt suite drift in ${dir}/prompts:`)
      expect(drift.out).toContain("drifted from this binary's suite: executor.md")
      expect(drift.out).toContain("manifest absent: prompts/MANIFEST pins no vintage")
      expect(await Bun.file(join(dir, "prompts/executor.md")).text()).toBe("drifted\n")
      expect((await runCli(["install-prompts", dir])).code).toBe(0)
      expect((await runCli(["install-prompts", dir, "--check"])).code).toBe(0)
      expect(await Bun.file(join(dir, "prompts/executor.md")).text()).toContain("# Executor")
      const badFlag = await runCli(["install-prompts", dir, "--dryrun"])
      expect(badFlag.code).toBe(1)
      expect(badFlag.err).toContain("unknown option --dryrun: install-prompts takes only --check (a directory argument and no other options)")
      const owned = await runCli(["status", dir, "--check"])
      expect(owned.code).toBe(1)
      expect(owned.err).toContain("--check is an install-prompts option (the read-only drift gate: opencode-auto install-prompts <dir> --check); status does not accept it")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: amend (plans/0052 D25)", () => {
  async function readConfig(dir: string) {
    return JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())
  }

  test("refusals: no config.json, no key, and every non-config option", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const fresh = await runCli(["amend", dir, "--context-limit", "128"])
      expect(fresh.code).toBe(1)
      expect(fresh.err).toContain(`nothing to amend: ${dir} has no .opencode/auto/config.json; run opencode-auto init ${dir}`)
      expect(await readdir(dir)).toEqual([])
      expect((await runCli(["init", dir])).code).toBe(0)
      const config = await readConfig(dir)
      const none = await runCli(["amend", dir])
      expect(none.code).toBe(1)
      expect(none.err).toContain("name at least one key to change")
      expect(none.err).toContain(`opencode-auto fix ${dir}`)
      const refused: [string[], string][] = [
        [["-p", "intent"], "-p/--prompt is not an amend option: the planning input is plan's (-p/--file of opencode-auto plan); the brief is revised with --brief <text> | --brief-file <path>"],
        [["--implement-prompt", "plan the work"], "--implement-prompt is retired (and with it the plan command itself, plans/0283)"],
        [["-f", "--context-limit", "128"], "-f/--force is not an amend option"],
        // The --amend flag is retired everywhere (init no longer takes it, so
        // no command does)
        [["--amend", "--context-limit", "128"], "--amend is retired: init is the stateless full overwrite; to change individual keys use opencode-auto amend <dir> --<key> <value>"],
        [["--server", "http://x", "--context-limit", "128"], "--server is not an amend option: amend takes only config flags (-m/--mode, --agent,"],
        [["--max-sessions", "1", "--context-limit", "128"], "--max-sessions is not an amend option"],
        [["--source-dir", "legacy"], "--source-dir is retired"],
      ]
      for (const [args, message] of refused) {
        const result = await runCli(["amend", dir, ...args])
        expect(result.code).toBe(1)
        expect(result.err).toContain(message)
      }
      expect(await readConfig(dir)).toEqual(config)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("changes the named keys only, re-renders the AGENTS.md block, leaves the rounds alone (D32; the contract retired by plans/0296)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--context-limit", "32", "--phases", "am", "--parallel", "low", "--agent", "claude"])).code).toBe(0)
      // the opening operation establishes the current round; amend writes
      // only the config layer and no longer re-syncs the phase tail
      await establish(dir, "am")
      await rm(join(dir, ".opencode/auto/brief.md"), { force: true })
      const amended = await runCli(["amend", dir, "--test-by-driver", "--parallel", "none", "--agent", "opencode"])
      expect(amended.code).toBe(0)
      expect(amended.out).toContain("✓ amended (--agent --test-by-driver --parallel); the other keys are unchanged")
      const config = await readConfig(dir)
      // the phases key is init-stamped machinery (plans/0137): amend never
      // touches it — the value stays what init froze
      expect(config).toMatchObject({ contextLimit: 32, phases: "am", testByDriver: true })
      expect(config).not.toHaveProperty("parallel")
      expect(config).not.toHaveProperty("agent")
      // the agent contract is the host's own since plans/0296: neither init
      // nor amend writes it
      expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).exists()).toBe(false)
      expect(await Bun.file(join(dir, "AGENTS.md")).text()).toContain("tmp/test.sh")
      // the round step is gone (plans/0053 D32): amend writes no phase state,
      // and with the phases key untouched there is no drift to reconcile
      expect(await stat(join(dir, "docs/R-01/P03-test")).catch(() => undefined)).toBeUndefined()
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [ ] P01 analysis\n- [ ] P02 implement\n")
      // amend writes only what renders from the config: the rest is init's and fix's
      expect(await Bun.file(join(dir, "opencode.json")).exists()).toBe(false)
      expect(await Bun.file(join(dir, ".opencode/auto/brief.md")).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("same checks as init, before any write: bad values, handoverTest ⇒ testByDriver, the prefix guard, a stored retired key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "adm"])).code).toBe(0)
      await establish(dir, "adm")
      await completeLetters(dir, ["a"])
      const config = await readConfig(dir)
      for (const [args, message] of [
        [["--subtask", "sometimes"], "--subtask takes off|auto|true|ondemand"],
        [["--handover-test"], "--handover-test requires --test-by-driver"],
        [["-m", "nope"], "--mode must be a registered mode"],
        [["--phases", "dm"], "--phases is retired on amend"],
      ] as [string[], string][]) {
        const result = await runCli(["amend", dir, ...args])
        expect(result.code).toBe(1)
        expect(result.err).toContain(message)
        expect(await readConfig(dir)).toEqual(config)
      }
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ ...config, destDir: "app" }, null, 2) + "\n")
      const retired = await runCli(["amend", dir, "--context-limit", "32"])
      expect(retired.code).toBe(1)
      expect(retired.err).toContain("destDir is retired")
      expect(retired.err).toContain(`fix: opencode-auto fix ${dir}`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: fix (plans/0052 D10/D11)", () => {
  async function readConfig(dir: string) {
    return JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())
  }

  test("uninitialized refuses, a consistent layer has nothing to fix, options are refused", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const fresh = await runCli(["fix", dir])
      expect(fresh.code).toBe(1)
      expect(fresh.err).toContain(`nothing to fix: ${dir} has no .opencode/auto/config.json; run opencode-auto init ${dir}`)
      expect(await readdir(dir)).toEqual([])
      expect((await runCli(["init", dir])).code).toBe(0)
      const clean = await runCli(["fix", dir])
      expect(clean.code).toBe(0)
      expect(clean.out).toContain("✓ nothing to fix")
      const bad = await runCli(["fix", dir, "--phases", "am"])
      expect(bad.code).toBe(1)
      expect(bad.err).toContain("fix only accepts a directory argument, -f/--force and --dryrun")
      // --dryrun is a fix option now (the read-only listing)
      const dry = await runCli(["fix", dir, "--dryrun"])
      expect(dry.code).toBe(0)
      expect(dry.out).toContain("✓ nothing to fix")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // fix --dryrun: the read-only half of fix and the replacement for the
  // retired `check` as a scripted gate on config drift — plan and print the
  // findings, write nothing, exit 0 when there are none and 1 when there are
  // any. It skips only the write-side gates (the clean-tree check, the
  // confirmation and the run-lock refusal); the legacy-layout refusal is
  // covered above, and an uninitialized directory keeps fix's own refusal.
  test("fix --dryrun with fixable findings: prints the plan, writes nothing, skips the write-side gates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await Bun.spawn(["git", "-C", dir, "init", "-q"]).exited)).toBe(0)
      expect((await runCli(["init", dir])).code).toBe(0)
      const configBefore = await Bun.file(join(dir, ".opencode/auto/config.json")).text()
      // a missing marker block: the AGENTS.md rule's fixable finding (the
      // agent-contract rule died with the file, plans/0296)
      await rm(join(dir, "AGENTS.md"))
      // a dirty tree: the plain fix would refuse here (the worktree gate)
      await Bun.write(join(dir, "uncommitted.txt"), "dirty\n")
      const dry = await runCli(["fix", dir, "--dryrun"])
      expect(dry.code).toBe(1)
      expect(dry.out).toContain("config-layer findings in")
      expect(dry.out).toContain("  fix: AGENTS.md: the opencode-auto block is missing → write the current block and remove the stray ones")
      expect(dry.out).toContain(`dryrun: nothing was changed; apply the 1 fixable finding(s) with opencode-auto fix ${dir}`)
      expect(dry.err).not.toContain("requires a clean worktree")
      // nothing was written: the block stays missing, the config and the
      // dirty file are untouched, and the tree is what it was
      expect(await Bun.file(join(dir, "AGENTS.md")).exists()).toBe(false)
      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).text()).toBe(configBefore)
      expect(await Bun.file(join(dir, "uncommitted.txt")).text()).toBe("dirty\n")
      // --dryrun=false is the plain fix (with -f applying it); the write then happens
      const applied = await runCli(["fix", dir, "--dryrun=false", "-f"])
      expect(applied.code).toBe(0)
      expect(applied.out).toContain("fixed: AGENTS.md: write the current block and remove the stray ones")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("fix --dryrun with manual findings: reports them, writes nothing, exit 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      // a purely manual finding: the config parses and no key rule repairs it,
      // but it still fails to load (handoverTest without testByDriver)
      const stored = JSON.stringify({ ...CONFIG_DEFAULTS, handoverTest: true }, null, 2) + "\n"
      await Bun.write(join(dir, ".opencode/auto/config.json"), stored)
      const dry = await runCli(["fix", dir, "--dryrun"])
      expect(dry.code).toBe(1)
      expect(dry.out).toContain("config-layer findings in")
      expect(dry.out).toContain("  manual: .opencode/auto/config.json: handoverTest requires testByDriver: true")
      expect(dry.out).toContain("  skipped: the AGENTS.md block and .gitignore checks (.opencode/auto/config.json does not load)")
      expect(dry.out).toContain("dryrun: nothing was changed; the finding(s) above need a person")
      expect(dry.err).toContain("1 finding(s) need a person")
      // nothing was written: the config is byte-identical
      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).text()).toBe(stored)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // plans/0135/0136: a covering roadmap line that diverges from the config
  // phases key is an expected posture, not drift — recorded as an info note
  // that fails no gate and asks nothing of anyone; an agreeing line (the
  // 0136 field case) prints nothing at all.
  test("fix with only an informational note: divergence recorded, agreement fully green, no person trailer, exit 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "mt"])).code).toBe(0)
      const config = await Bun.file(join(dir, ".opencode/auto/config.json")).text()
      // Divergence: the line establishes "mtv", the config key holds "mt".
      await Bun.write(join(dir, "docs/analysis.md"), ["# Project analysis", "", "- R-01 mtv — port the core", "", "Clarified: yes", ""].join("\n"))
      const dry = await runCli(["fix", dir, "--dryrun"])
      expect(dry.code).toBe(0)
      expect(dry.out).toContain("config-layer notes in")
      expect(dry.out).not.toContain("config-layer findings in")
      expect(dry.out).toContain(`  info: .opencode/auto/config.json: phases (config "mt"): R-01's line establishes "mtv" under the released roadmap of docs/analysis.md — nothing to repair (reshape the round by moving its line)`)
      expect(dry.out).toContain("dryrun: nothing was changed; the note(s) above are informational — nothing to repair")
      expect(dry.err).not.toContain("need a person")
      // nothing was written
      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).text()).toBe(config)
      const fix = await runCli(["fix", dir])
      expect(fix.code).toBe(0)
      expect(fix.out).toContain("config-layer notes in")
      expect(fix.out).toContain("✓ nothing to fix: the note(s) above are informational — nothing to repair")
      expect(fix.err).not.toContain("need a person")
      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).text()).toBe(config)
      // Agreement: the line establishes exactly what init stamped — the
      // designed state, fully green, no note anywhere.
      await Bun.write(join(dir, "docs/analysis.md"), ["# Project analysis", "", "- R-01 mt — port the core", "", "Clarified: yes", ""].join("\n"))
      const agree = await runCli(["fix", dir, "--dryrun"])
      expect(agree.code).toBe(0)
      expect(agree.out).toContain("✓ nothing to fix: the config layer of")
      expect(agree.out).not.toContain("info:")
      expect(agree.out).not.toContain("config-layer notes")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("repairs retired keys and missing artifacts, keeps the other keys, is idempotent; run works again", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--context-limit", "128"])).code).toBe(0)
      const kept = await readConfig(dir)
      const stored = { ...kept, commit: false, verifyIdle: 20, source: { dir: "legacy", path: "pkg" }, destDir: "app" }
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify(stored, null, 2) + "\n")
      // the missing artifact: the AGENTS.md marker block (the agent-contract
      // rule died with the file, plans/0296)
      await rm(join(dir, "AGENTS.md"))
      // The person's hand edit commits before fix (fix's own clean-tree gate
      // is git-bound since init bootstraps the repository)
      await commitFixture(dir)
      const fix = await runCli(["fix", dir])
      expect(fix.code).toBe(0)
      expect(fix.out).toContain("  fix: .opencode/auto/config.json: commit: false is retired")
      expect(fix.out).toContain("fixed: .opencode/auto/config.json: move its value into .opencode/auto/brief.md under ## Target, then drop the key")
      expect(fix.out).toContain("verifyIdle was renamed to idleTime, which is also set → drop the key")
      expect(fix.out).toContain("  fix: AGENTS.md: the opencode-auto block is missing → write the current block and remove the stray ones")
      expect(fix.out).toContain("fixed: AGENTS.md: write the current block and remove the stray ones")
      expect(fix.out).toContain("✓ config layer repaired")
      // every key no rule names survives; the retired commit key is gone
      expect(await readConfig(dir)).toEqual(kept)
      const brief = await Bun.file(join(dir, ".opencode/auto/brief.md")).text()
      expect(brief).toContain("`legacy`")
      expect(brief).toContain("`app`")
      expect((await Bun.file(join(dir, "AGENTS.md")).text()).includes("<!-- opencode-auto:start -->")).toBe(true)
      expect((await runCli(["fix", dir])).out).toContain("✓ nothing to fix")
      // The repaired config loads strictly (plans/0283 re-keyed run's
      // witness to the strict-loading amend: a command that would refuse
      // over the retired keys no longer does)
      const loads = await runCli(["amend", dir, "--wrapup"])
      expect(loads.code).toBe(0)
      expect(loads.err).not.toContain("retired")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("manual findings exit 1 after the fixable ones are applied; artifact checks wait for a loadable config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ ...CONFIG_DEFAULTS, verify: true, handoverTest: true }, null, 2) + "\n")
      await commitFixture(dir)
      const fix = await runCli(["fix", dir])
      expect(fix.code).toBe(1)
      expect(fix.out).toContain("  manual: .opencode/auto/config.json: handoverTest requires testByDriver: true")
      expect(fix.out).toContain("  skipped: the AGENTS.md block and .gitignore checks (.opencode/auto/config.json does not load)")
      expect(fix.err).toContain("1 finding(s) need a person")
      expect(await readConfig(dir)).not.toHaveProperty("verify")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // (The model registry's project-layer .gitignore rule — models refusing a
  // layer git does not ignore, fix backfilling the entry — died whole with
  // the models surface, plans/0296: init writes no entry, fix carries no
  // rule, and the reader is a permanent tombstone.)

  test("the worktree gate refuses a dirty tree before any write; -f skips it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await Bun.spawn(["git", "-C", dir, "init", "-q"]).exited)).toBe(0)
      expect((await runCli(["init", dir])).code).toBe(0)
      // the fixable finding: the .gitignore loses its workdir entries (a
      // tracked file, so the tree is dirty too — the double role the old
      // agent-contract deletion played before plans/0296)
      const gitignore = join(dir, ".gitignore")
      const dirtyContents = (await Bun.file(gitignore).text()).replace("tmp/\n", "")
      await Bun.write(gitignore, dirtyContents)
      const dirty = await runCli(["fix", dir])
      expect(dirty.code).toBe(1)
      expect(dirty.err).toContain("fix will delete or modify files on disk and requires a clean worktree")
      expect(await Bun.file(gitignore).text()).toBe(dirtyContents)
      expect((await runCli(["fix", dir, "-f"])).code).toBe(0)
      expect(await Bun.file(gitignore).text()).toContain("tmp/\n")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: the run lock (auto-core plans/0053 D3)", () => {
  // A lock held by this test process: alive, and not the CLI child's own pid.
  async function plantLock(dir: string, pid = process.pid) {
    await Bun.write(join(dir, ".auto/run.lock"), JSON.stringify({ pid, host: hostname(), command: "plan", started: "2026-09-23T10:00:00.000Z" }))
  }

  test("init, amend, fix, reset and sync refuse while another process holds it; status shows it first", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      const config = await Bun.file(join(dir, ".opencode/auto/config.json")).text()
      await plantLock(dir)
      const refusal = `⏸ another opencode-auto process holds the run lock of ${dir}: plan, pid ${process.pid} on ${hostname()}, since 2026-09-23T10:00:00.000Z.`
      for (const args of [["init", dir], ["init", dir, "-f"], ["amend", dir, "--context-limit", "64"], ["fix", dir, "-f"], ["sync", dir, "-f"], ["reset", dir, "-f"]]) {
        const refused = await runCli(args)
        expect(refused.code).toBe(1)
        expect(refused.err).toContain(refusal)
      }
      // run answers its retirement notice ahead of the lock (pinned in the
      // push-retired describe); close and land hold the lock themselves and
      // refuse through its own lines
      const status = await runCli(["status", dir])
      expect(status.code).toBe(0)
      expect(status.out.split("\n")[0]).toBe(`▶ plan in progress (pid ${process.pid} on ${hostname()}, since 2026-09-23T10:00:00.000Z)`)
      expect(status.out).toContain("⚙ project config")
      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).text()).toBe(config)
      // fix --dryrun reads and prints only, so it runs beside the live lock
      // (the one write-side gate it skips); the plain fix stays refused above.
      // sync --dryrun is the same read-only shape (plans/0100 D4).
      const dry = await runCli(["fix", dir, "--dryrun"])
      expect(dry.code).toBe(0)
      expect(dry.out).toContain("✓ nothing to fix")
      expect(dry.err).not.toContain("run lock")
      const syncDry = await runCli(["sync", dir, "--dryrun"])
      expect(syncDry.err).not.toContain("run lock")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a lock whose process is gone is not live: init proceeds and status does not show it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const gone = Bun.spawn(["true"])
      await gone.exited
      await plantLock(dir, gone.pid)
      expect((await runCli(["init", dir])).code).toBe(0)
      const status = await runCli(["status", dir])
      expect(status.out).not.toContain("in progress")
      expect(status.out.split("\n")[0]).toStartWith("⚙ project config")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// fork (auto-core plans/0128): the experiment environment — argument checks
// (the ref-first split, the required worktree path, the no-options refusal),
// the help rows (fork's own; run's row retired with the command), the lock posture (fork
// takes no run lock, plans/0129 — it builds beside a live run, its only
// source-tree writes the reserved branch family and worktree registrations),
// the happy paths of both target forms over a real fixture (the driver's
// trailer commits made by hand); --stop-after's parse retired with run.
describe("CLI: fork (auto-core plans/0128)", () => {
  async function plantLock(dir: string, pid = process.pid) {
    await Bun.write(join(dir, ".auto/run.lock"), JSON.stringify({ pid, host: hostname(), command: "run", started: "2026-09-23T10:00:00.000Z" }))
  }

  // An initialized project with one fixture checkpoint and two driver-style
  // task commits (the trailers as ONE -m paragraph — the driver's message()
  // shape: 0173 D2's read takes the Auto-Task key from the body's LAST
  // paragraph, and separate -m paragraphs would each sit in their own).
  async function taskProject() {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-fork-"))
    expect((await runCli(["init", dir])).code).toBe(0)
    await commitFixture(dir)
    const git = gitOf(dir)
    for (const id of ["T-001", "T-002"]) {
      await Bun.write(join(dir, `${id}.txt`), `${id}\n`)
      await git("add", "-A")
      await git("commit", "-m", `${id} implement`, "-m", `Auto-Task: ${id}\nAuto-Stage: execute`)
    }
    return { dir, git }
  }

  test("argument checks: the target and the worktree path are required, a non-target is refused, fork takes no options", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-fork-"))
    try {
      const bare = await runCli(["fork"])
      expect(bare.code).toBe(1)
      expect(bare.err).toContain("fork requires a target and a worktree path")
      const noPath = await runCli(["fork", "T-001"])
      expect(noPath.code).toBe(1)
      expect(noPath.err).toContain("fork requires a worktree path")
      const bad = await runCli(["fork", "main", `${dir}-exp`])
      expect(bad.code).toBe(1)
      expect(bad.err).toContain("main: not a fork target")
      const flagged = await runCli(["fork", "T-001", `${dir}-exp`, "--dryrun"])
      expect(flagged.code).toBe(1)
      expect(flagged.err).toContain("fork takes no options")
      expect((await runCli(["fork", "uninit-dir-xyz", `${dir}-exp`])).code).toBe(1)
      const uninit = await runCli(["fork", "T-001", `${dir}-exp`, dir])
      expect(uninit.code).toBe(1)
      expect(uninit.err).toContain("nothing to fork")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the help rows: fork's synopsis renders; run's row is gone with the command (plans/0283)", async () => {
    const forkHelp = await runCli(["fork", "--help"])
    expect(forkHelp.code).toBe(0)
    expect(forkHelp.out).toContain("opencode-auto fork <T-NNN | sha> <worktree-path> [dir]")
    const runHelp = await runCli(["run", "--help"])
    expect(runHelp.code).toBe(1)
    expect(runHelp.err).toContain("run is retired (plans/0283):")
    expect(runHelp.out).toBe("")
    const usage = await runCli(["--help"])
    expect(usage.out).toContain("fork <T-NNN | sha> <worktree-path>")
  })

  test("fork runs beside a live run lock (plans/0129: it takes no lock — nothing it writes in the source tree is read by a running driver)", async () => {
    const { dir, git } = await taskProject()
    try {
      await plantLock(dir)
      const forked = await runCli(["fork", "T-001", `${dir}-exp`, dir])
      expect(forked.code).toBe(0)
      expect(forked.out).toContain(`✓ fork of T-001 created at ${dir}-exp on auto-fork/T-001`)
      // The planted lock is neither consulted nor disturbed.
      expect(await Bun.file(join(dir, ".auto/run.lock")).text()).toContain('"command":"run"')
      expect((await git("branch", "--list", "auto-fork/T-001")).trim()).toBe("+ auto-fork/T-001")
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(`${dir}-exp`, { recursive: true, force: true })
    }
  })

  test("the task form's happy path: the worktree is created at the pre-task state, the lines name the branch, the run hint and the cleanup", async () => {
    const { dir, git } = await taskProject()
    try {
      const before = (await git("rev-parse", "HEAD~1")).trim()
      const forked = await runCli(["fork", "T-002", `${dir}-exp`, dir])
      expect(forked.code).toBe(0)
      const path = `${dir}-exp`
      expect(forked.out).toContain(`✓ fork of T-002 created at ${path} on auto-fork/T-002`)
      expect(forked.out).toContain(`  .: ${before.slice(0, 7)} — the state before T-002 first started`)
      expect(forked.out).toContain(`run it: opencode-auto run ${path} --stop-after T-002`)
      expect(forked.out).toContain(`cleanup when done: opencode-auto remove-fork ${path} ${dir} — removes every worktree of the fork and deletes auto-fork/T-002 in each of its repositories`)
      expect((await gitOf(path)("rev-parse", "HEAD")).trim()).toBe(before)
      // "+" marks the branch as checked out in the fork worktree.
      expect((await git("branch", "--list", "auto-fork/T-002")).trim()).toBe("+ auto-fork/T-002")
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(`${dir}-exp`, { recursive: true, force: true })
    }
  })

  test("the sha form's happy path, and the unknown task's usage refusal names the trailer", async () => {
    const { dir, git } = await taskProject()
    try {
      const at = (await git("rev-parse", "HEAD")).trim()
      const forked = await runCli(["fork", at.slice(0, 9), `${dir}-exp`, dir])
      expect(forked.code).toBe(0)
      expect(forked.out).toContain(`✓ fork at ${at.slice(0, 7)} (T-002 implement) created at ${dir}-exp on auto-fork/${at.slice(0, 7)}`)
      expect((await gitOf(`${dir}-exp`)("rev-parse", "HEAD")).trim()).toBe(at)
      const unknown = await runCli(["fork", "T-099", `${dir}-exp2`, dir])
      expect(unknown.code).toBe(1)
      expect(unknown.err).toContain("no commit of this repository carries the trailer Auto-Task: T-099")
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(`${dir}-exp`, { recursive: true, force: true })
      await rm(`${dir}-exp2`, { recursive: true, force: true })
    }
  })

})

// remove-fork (auto-core plans/0139): the teardown of what fork builds —
// argument checks (the required worktree path, --force the one option), the
// help rows, the teardown happy path with the branch freed for the retry's
// stem name, the dirty refusal with --force as the explicit discard, and a
// live run inside the fork refusing (P20 — never torn down mid-run).
describe("CLI: remove-fork (auto-core plans/0139)", () => {
  // The fork describe's fixture shape: an initialized project with a
  // checkpoint and two driver-style task commits, so fork T-002 derives.
  async function taskProject() {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-rmfork-"))
    expect((await runCli(["init", dir])).code).toBe(0)
    await commitFixture(dir)
    const git = gitOf(dir)
    for (const id of ["T-001", "T-002"]) {
      await Bun.write(join(dir, `${id}.txt`), `${id}\n`)
      await git("add", "-A")
      await git("commit", "-m", `${id} implement`, "-m", `Auto-Task: ${id}\nAuto-Stage: execute`)
    }
    return { dir, git }
  }

  // A planted live lock naming pid 1 — alive and unprobeable (EPERM), so it
  // reads live from this test process (a lock naming the reading process's
  // own pid reads stale: the dead-predecessor rule).
  async function plantLiveLock(path: string) {
    await mkdir(join(path, ".auto"), { recursive: true })
    await Bun.write(join(path, ".auto/run.lock"), JSON.stringify({ pid: 1, host: hostname(), command: "run", started: "2026-10-27T10:00:00.000Z" }))
  }

  test("argument checks: the worktree path is required, --force is the one option, an uninitialized dir and a stranger path are usage refusals", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-rmfork-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      const bare = await runCli(["remove-fork"])
      expect(bare.code).toBe(1)
      expect(bare.err).toContain("remove-fork requires a worktree path")
      const flagged = await runCli(["remove-fork", `${dir}-exp`, dir, "--dryrun"])
      expect(flagged.code).toBe(1)
      expect(flagged.err).toContain("remove-fork takes only --force")
      const uninit = await runCli(["remove-fork", `${dir}-exp`])
      expect(uninit.code).toBe(1)
      expect(uninit.err).toContain("nothing to remove-fork")
      const stranger = await runCli(["remove-fork", `${dir}-exp`, dir])
      expect(stranger.code).toBe(1)
      expect(stranger.err).toContain(`no worktree of ${dir} is registered there`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the help rows: remove-fork's synopsis renders in its own view and the full usage", async () => {
    const help = await runCli(["remove-fork", "--help"])
    expect(help.code).toBe(0)
    expect(help.out).toContain("opencode-auto remove-fork <worktree-path> [dir] [--force]")
    const usage = await runCli(["--help"])
    expect(usage.out).toContain("remove-fork <worktree-path>")
  })

  test("the teardown happy path: every worktree and the branch come down, the retry takes the stem name again", async () => {
    const { dir, git } = await taskProject()
    try {
      const path = `${dir}-exp`
      expect((await runCli(["fork", "T-002", path, dir])).code).toBe(0)
      // An experiment commit on the fork's branch: discardable by design.
      await Bun.write(join(path, "exp.txt"), "experiment\n")
      await gitOf(path)("add", "-A")
      await gitOf(path)("commit", "-qm", "experiment")
      const removed = await runCli(["remove-fork", path, dir])
      expect(removed.code).toBe(0)
      expect(removed.out).toContain(`✓ fork at ${path} removed — 1 worktree and the branch auto-fork/T-002 deleted`)
      expect(removed.out).toContain("  .: worktree removed, branch auto-fork/T-002 deleted")
      expect(removed.out).toContain(`retry: opencode-auto fork T-002 ${path} ${dir}`)
      expect(await Bun.file(join(path, "exp.txt")).exists()).toBe(false)
      expect((await git("branch", "--list", "auto-fork/T-002")).trim()).toBe("")
      // The retry: the same path and target take the stem name, not -2.
      const again = await runCli(["fork", "T-002", path, dir])
      expect(again.code).toBe(0)
      expect(again.out).toContain(`✓ fork of T-002 created at ${path} on auto-fork/T-002`)
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(`${dir}-exp`, { recursive: true, force: true })
    }
  })

  test("uncommitted work blocks naming the files (exit 2, nothing removed); --force discards it (exit 0)", async () => {
    const { dir, git } = await taskProject()
    try {
      const path = `${dir}-exp`
      expect((await runCli(["fork", "T-002", path, dir])).code).toBe(0)
      await Bun.write(join(path, "junk.txt"), "uncommitted\n")
      const refused = await runCli(["remove-fork", path, dir])
      expect(refused.code).toBe(2)
      expect(refused.err).toContain("the fork holds uncommitted work — remove-fork never discards it silently")
      expect(refused.err).toContain("?? junk.txt")
      expect(refused.err).toContain("--force")
      expect(await Bun.file(join(path, "junk.txt")).exists()).toBe(true)
      const forced = await runCli(["remove-fork", path, dir, "--force"])
      expect(forced.code).toBe(0)
      expect(forced.out).toContain("(--force: the uncommitted work discarded)")
      expect((await git("branch", "--list", "auto-fork/T-002")).trim()).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(`${dir}-exp`, { recursive: true, force: true })
    }
  })

  test("a run live inside the fork refuses (exit 2, the fork stands)", async () => {
    const { dir, git } = await taskProject()
    try {
      const path = `${dir}-exp`
      expect((await runCli(["fork", "T-002", path, dir])).code).toBe(0)
      await plantLiveLock(path)
      const live = await runCli(["remove-fork", path, dir])
      expect(live.code).toBe(2)
      expect(live.err).toContain(`holds the run lock of ${path}`)
      // The pre-T-002 state stands untouched beside the planted lock.
      expect(await Bun.file(join(path, "T-001.txt")).exists()).toBe(true)
      expect((await git("branch", "--list", "auto-fork/T-002")).trim()).toBe("+ auto-fork/T-002")
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(`${dir}-exp`, { recursive: true, force: true })
    }
  })
})

// close (auto-core plans/0053 D22): the shell half — the argument order (the
// ref first, the directory second), the flag whitelist, the run lock, and one
// happy-path task close on a git fixture (exit code, output lines, the close
// commit and its trailers). The behavioural refusals (done or closed units,
// another round, the m-mode phase, dependents, the dirty tree, the mechanical
// handover, the cleared records) are closeUnit's and live in auto-core's
// close.test.ts.
describe("CLI: close (auto-core plans/0053 D22)", () => {
  // An initialized m-mode git fixture with two open tasks, all committed, so
  // a refused close leaves a byte-identical tree.
  async function closeFixture() {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-close-"))
    const git = gitOf(dir)
    await git("init")
    expect((await runCli(["init", dir])).code).toBe(0)
    await establish(dir, "m")
    await listTasks(dir, P01.dir, "R-01.P01", [
      ["T-001", "the superseded task", "body"],
      ["T-002", "the implicit dependent", "body"],
    ])
    await git("add", "-A")
    await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")
    return { dir, git }
  }

  test("argument errors: missing or invalid ref (never mistaken for the directory), the reason, both change flags, non-close flags; nothing is written", async () => {
    const { dir, git } = await closeFixture()
    try {
      const refusals: [string[], string][] = [
        // The ref is required and comes first: a positional[0] that is not a
        // ref (the bare directory, the natural mistake) is a missing or
        // invalid ref, never silently taken as the directory.
        [["close"], "close requires a unit reference"],
        [["close", "--reason", "r"], "close requires a unit reference"],
        [["close", dir, "--reason", "r"], `${dir}: not a unit reference`],
        [["close", "T-5", dir, "--reason", "r"], "T-5: not a unit reference"],
        [["close", "T-001.S01", dir, "--reason", "r"], "T-001.S01: not a unit reference"],
        // --reason: required, non-empty, one line.
        [["close", "T-001", dir], "close requires --reason <text>"],
        [["close", "T-001", dir, "--reason", "  "], "--reason requires non-empty text"],
        [["close", "T-001", dir, "--reason", "two\nlines"], "--reason must be one line"],
        // The two change flags are mutually exclusive.
        [["close", "T-001", dir, "--reason", "r", "--commit-changes", "--stash-changes"], "--commit-changes and --stash-changes are mutually exclusive"],
        // Only close's own flags are accepted (unknown, session and lifecycle
        // options alike); config flags and -p/--file get their own notices.
        [["close", "T-001", dir, "--reason", "r", "--verbose"], "--verbose is not a close option"],
        [["close", "T-001", dir, "--reason", "r", "--cascad"], "did you mean --cascade"],
        [["close", "T-001", dir, "--reason", "r", "-f"], "--force is not a close option"],
        [["close", "T-001", dir, "--reason", "r", "--dryrun"], "--dryrun is not a close option"],
        [["close", "T-001", dir, "--reason", "r", "--phases", "am"], "--phases was frozen by init"],
        [["close", "T-001", dir, "--reason", "r", "-p", "text"], "-p/--prompt is retired with the plan command (plans/0283 — the planning input is the phase's plan-input.md, read by the formulation); close takes no planning input"],
        [["close", "T-001", dir, "--reason", "r", "--file", "f.md"], "--file is retired with the plan command (plans/0283 — the planning input is the phase's plan-input.md, read by the formulation); close takes no planning input"],
        [["close", "T-001", dir, "--reason", "r", "--verify"], "--verify is retired"],
        // F8: --commit is a value flag, but the ref comes first and parsing
        // matches whole flag names, so it can never swallow the ref — the
        // command refuses on the retirement instead of mis-reading the
        // arguments (the change flags were named to avoid exactly this).
        [["close", "--commit", "T-001", "--reason", "r"], "--commit is retired"],
        [["close", "--commit", "T-001", "--reason", "r"], "the close options for a dirty worktree are --commit-changes and --stash-changes"],
      ]
      for (const [args, notice] of refusals) {
        const refused = await runCli(args)
        expect(refused.code, args.join(" ")).toBe(1)
        expect(refused.err, args.join(" ")).toContain(notice)
      }
      // Nothing was written and nothing committed: both tasks untouched.
      expect(await Bun.file(join(dir, taskStatePaths("T-001").pending)).exists()).toBe(true)
      expect(await Bun.file(join(dir, taskStatePaths("T-002").pending)).exists()).toBe(true)
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("close refuses while another process holds the run lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      await establish(dir, "m")
      await listTasks(dir, P01.dir, "R-01.P01", [["T-001", "task", "body"]])
      await Bun.write(join(dir, RUN_LOCK_FILE), JSON.stringify({ pid: process.pid, host: hostname(), command: "run", started: "2026-09-23T10:00:00.000Z" }))
      const refused = await runCli(["close", "T-001", dir, "--reason", "r"])
      expect(refused.code).toBe(1)
      expect(refused.err).toContain(`⏸ another opencode-auto process holds the run lock of ${dir}: run, pid ${process.pid} on ${hostname()}`)
      expect(await Bun.file(join(dir, taskStatePaths("T-001").pending)).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("closes a task on a git fixture: exit 0, the output lines, the close commit and its trailers", async () => {
    const { dir, git } = await closeFixture()
    try {
      // The ref comes first, the directory second (D22 argument order).
      const closed = await runCli(["close", "T-001", dir, "--reason", "superseded by the follow-up design"])
      expect(closed.err).toBe("")
      expect(closed.code).toBe(0)
      expect(closed.out).toContain("✓ closed T-001: superseded by the follow-up design")
      // T-002 follows T-001 with no Depends: field → the implicit-dependent note.
      expect(closed.out).toContain("ℹ T-002 has no Depends: field, so its prerequisite T-001 counts as satisfied; do not assume T-001's deliverables exist")
      expect(closed.out).toContain("⚠ closed units skip the unit-close reference scan; the destination scan at round close still applies")
      // The undo pointer names the close commit's short sha; the next line points on.
      const sha = (await git("rev-parse", "--short", "HEAD")).trim()
      expect(closed.out).toContain(`to undo before anything else runs: git revert ${sha}`)
      expect(closed.out).toContain(`next: opencode-auto run ${dir} to continue, or opencode-auto plan ${dir}`)
      // The close commit: subject, body and the force-close trailers.
      const message = await git("log", "-1", "--pretty=%B")
      expect(message).toContain("T-001 closed: superseded by the follow-up design")
      expect(message).toContain("Units closed:\n- T-001")
      expect(message).toContain("Auto-Task: T-001")
      expect(message).toContain("Auto-Stage: force-close")
      // State: the Closed: field with the rename, the index tick, the other
      // task still pending, and a clean tree (the close commit took it all).
      expect(await Bun.file(join(dir, taskStatePaths("T-001").complete)).text()).toContain("Closed: superseded by the follow-up design")
      expect(await Bun.file(join(dir, taskStatePaths("T-001").pending)).exists()).toBe(false)
      expect(await Bun.file(join(dir, P01.dir, "tasks.md")).text()).toContain("- [x] T-001")
      expect(await Bun.file(join(dir, taskStatePaths("T-002").pending)).exists()).toBe(true)
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // The phase target of close (plans/0053 D18): its open tasks close with it,
  // the mechanical handover stands in for the distillation, and the phase
  // index is ticked — the close-side counterpart of the force-close phase
  // test, which reaches the same closeUnit through plan.
  test("closes a phase on a git fixture: the tasks close with it, the mechanical handover is written, phases.md is ticked", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-close-phase-"))
    const git = gitOf(dir)
    try {
      await git("init")
      expect((await runCli(["init", dir, "--phases", "amt"])).code).toBe(0)
      await establish(dir, "amt")
      await completeLetters(dir, ["a"])
      await listTasks(dir, "docs/R-01/P02-implement", "R-01.P02", [["T-001", "the skipped task", "body"]])
      await git("add", "-A")
      await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")

      const closed = await runCli(["close", "R-01.P02", dir, "--reason", "skipped this round"])
      expect(closed.err).toBe("")
      expect(closed.code).toBe(0)
      expect(closed.out).toContain("✓ closed T-001: skipped this round")
      expect(closed.out).toContain("✓ closed R-01.P02 implement: skipped this round")
      expect(closed.out).toContain("ℹ mechanical handover written: docs/R-01/P02-implement/handover.md")
      const sha = (await git("rev-parse", "--short", "HEAD")).trim()
      expect(closed.out).toContain(`to undo before anything else runs: git revert ${sha}`)
      // The phase state: closed done.md (task and phase), the four handover
      // sections, the phase index tick, and P03 untouched.
      expect(await Bun.file(join(dir, "docs/R-01/P02-implement/done.md")).text()).toContain("Closed: skipped this round")
      expect(await Bun.file(join(dir, "docs/R-01/P02-implement/todo.md")).exists()).toBe(false)
      expect(await Bun.file(join(dir, taskStatePaths("T-001").complete)).text()).toContain("Closed: skipped this round")
      const handover = await Bun.file(join(dir, "docs/R-01/P02-implement/handover.md")).text()
      for (const section of ["## Key decisions", "## Constraints and pitfalls", "## Required reading for the next phase", "## Artifact index"]) {
        expect(handover).toContain(section)
      }
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [x] P02 implement")
      expect(await Bun.file(join(dir, "docs/R-01/P03-test/todo.md")).exists()).toBe(true)
      // One close commit covering both units, then a clean tree.
      const message = await git("log", "-1", "--pretty=%B")
      expect(message).toContain("R-01.P02 closed: skipped this round")
      expect(message).toContain("Units closed:\n- T-001\n- R-01.P02 (gates skipped:")
      expect(message).toContain("Auto-Task: R-01.P02")
      expect(message).toContain("Auto-Stage: force-close")
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})






describe("CLI: the project brief's channels (plans/0081 D11; init's seed half retired by auto-core plans/0133 D9)", () => {
  test("init writes no brief and refuses --brief; amend --brief revises verbatim; a bare re-init never touches it; reset keeps it; -p stays retired", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const brief = join(dir, ".opencode/auto/brief.md")
      const first = await runCli(["init", dir])
      expect(first.code).toBe(0)
      expect(await Bun.file(brief).exists()).toBe(false)
      await commitFixture(dir)
      const seeded = await runCli(["init", dir, "--brief", "Migrate legacy/pkg to app/."])
      expect(seeded.code).toBe(1)
      expect(seeded.err).toContain("--brief is retired on init: init writes no brief")
      expect(await Bun.file(brief).exists()).toBe(false)
      const amended = await runCli(["amend", dir, "--brief", "Migrate legacy/pkg to app/."])
      expect(amended.code).toBe(0)
      expect(amended.out).toContain("created: .opencode/auto/brief.md (the person's manual word, verbatim")
      expect(await Bun.file(brief).text()).toBe("Migrate legacy/pkg to app/.\n")
      await commitFixture(dir)
      expect((await runCli(["init", dir])).out).not.toContain(".opencode/auto/brief.md")
      expect(await Bun.file(brief).text()).toContain("Migrate legacy/pkg to app/.")
      const reset = await runCli(["reset", dir])
      expect(reset.out).toContain("keep: .opencode/auto/brief.md (the project brief (an installed approved proposal or a person's amend --brief write) is kept; delete it by hand if you mean to)")
      expect(await Bun.file(brief).text()).toContain("Migrate legacy/pkg to app/.")
      // init's -p is retired (plans/0053 D31): with -p it is always refused
      const refused = await runCli(["init", dir, "-p", "intent"])
      expect(refused.code).toBe(1)
      expect(refused.err).toContain("--prompt is retired")
      await commitFixture(dir)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await Bun.file(brief).text()).toBe("Migrate legacy/pkg to app/.\n")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("amend --brief revises the brief beside the config keys (plans/0081 D11.2)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      const amended = await runCli(["amend", dir, "--brief", "revised intent"])
      expect(amended.code).toBe(0)
      expect(amended.out).toContain("created: .opencode/auto/brief.md (the person's manual word, verbatim")
      expect(await Bun.file(join(dir, ".opencode/auto/brief.md")).text()).toBe("revised intent\n")
      await commitFixture(dir)
      const revised = await runCli(["amend", dir, "--brief", "second revision"])
      expect(revised.code).toBe(0)
      expect(revised.out).toContain("replaced: .opencode/auto/brief.md (the brief, verbatim)")
      expect(await Bun.file(join(dir, ".opencode/auto/brief.md")).text()).toBe("second revision\n")
      // amend still refuses -p with the brief pointer (A8).
      const refused = await runCli(["amend", dir, "-p", "x"])
      expect(refused.code).toBe(1)
      expect(refused.err).toContain("the brief is revised with --brief <text> | --brief-file <path>")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

})

describe("CLI: reset de-initialization", () => {
  test("reset removes the config-layer artifacts; docs/ task units and .auto/ runtime state are untouched", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      await establish(dir, "m")
      await mkdir(join(dir, ".auto", "logs"), { recursive: true })
      await writeFile(join(dir, ".auto", "logs", "run.log"), "log\n")
      await mkdir(join(dir, "docs", "T-001"), { recursive: true })
      await writeFile(join(dir, "docs/T-001/todo.md"), "# T-001: my task\n")
      await commitFixture(dir)

      const reset = await runCli(["reset", dir])
      expect(reset.code).toBe(0)
      expect(reset.out).toContain("the following cleanup will run in")
      expect(reset.out).toContain(".opencode/auto/config.json")
      expect(reset.out).toContain("✓ config layer removed (docs/, .auto/ runtime state and tmp/ untouched")

      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).exists()).toBe(false)
      expect(await Bun.file(join(dir, "AGENTS.md")).exists()).toBe(false)
      // the tool's own subtree alone is pruned (plans/0296): bare .opencode —
      // the person's own directory — is reclaimed by no reset
      expect(await readdir(join(dir, ".opencode"))).toEqual([])
      // Work output and runtime state survive untouched
      expect(await Bun.file(join(dir, "docs/T-001/todo.md")).text()).toBe("# T-001: my task\n")
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).exists()).toBe(true)
      expect(await Bun.file(join(dir, ".auto/logs/run.log")).text()).toBe("log\n")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init → reset → init: the two inits' artifacts are byte-identical", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      await commitFixture(dir)
      const config = await Bun.file(join(dir, ".opencode/auto/config.json")).text()
      const agents = await Bun.file(join(dir, "AGENTS.md")).text()
      expect((await runCli(["reset", dir])).code).toBe(0)
      // reset's deletions commit before the re-init (the overwrite gate is
      // git-bound since init bootstraps the repository)
      await commitFixture(dir)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).text()).toBe(config)
      expect(await Bun.file(join(dir, "AGENTS.md")).text()).toBe(agents)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("reset never touches the person's opencode.json (plans/0296: the file is the host's own)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      await commitFixture(dir)
      await writeFile(join(dir, "opencode.json"), '{"model":"my own config"}\n')
      await commitFixture(dir)
      const reset = await runCli(["reset", dir])
      expect(reset.code).toBe(0)
      // the file is never reset's to keep or remove: no listing, no line, the
      // bytes exactly the person's
      expect(reset.out).not.toContain("opencode.json")
      expect(await Bun.file(join(dir, "opencode.json")).text()).toBe('{"model":"my own config"}\n')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an uninitialized directory: reset reports nothing to clean up and exits 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const reset = await runCli(["reset", dir])
      expect(reset.code).toBe(0)
      expect(reset.out).toContain("no init artifacts found")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("reset only accepts a directory argument and -f/--force", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const bad = await runCli(["reset", dir, "--test-by-driver"])
      expect(bad.code).toBe(1)
      expect(bad.err).toContain("reset only accepts a directory argument and -f/--force")
      expect((await runCli(["reset", dir, "--force"])).code).toBe(0)
      expect((await runCli(["reset", dir, "-f"])).code).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: the worktree cleanliness gate", () => {
  async function readConfigAt(dir: string) {
    return JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())
  }
  async function git(dir: string, ...args: string[]) {
    const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "ignore", stderr: "ignore" })
    expect(await proc.exited).toBe(0)
  }
  async function commitAll(dir: string) {
    await git(dir, "add", "-A")
    await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "wip")
  }

  test("a directory init bootstrapped into a repository is bound by the gate like any other (plans/0073; the non-git tier is gone)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const first = await runCli(["init", dir])
      expect(first.code).toBe(0)
      expect(first.out).toContain("initialized git repository (branch main)")
      // The bootstrap made the directory a worktree, so the overwriting init
      // runs the cleanliness gate (the old non-git tier — where neither the
      // gate nor any commit-side mechanism ever fired — is the silently-broken
      // state the bootstrap closed)
      const dirty = await runCli(["init", dir])
      expect(dirty.code).toBe(1)
      expect(dirty.err).toContain("requires a clean worktree")
      // Once committed, init and reset run their default flows through (the
      // second init writes byte-identical artifacts, so the tree stays clean)
      await commitAll(dir)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["reset", dir])).code).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a dirty worktree intercepts an overwriting init, listing the uncommitted files; -f skips it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await git(dir, "init")
      // The first init (no existing config) is not bound by the gate, even
      // though it leaves the worktree dirty
      expect((await runCli(["init", dir])).code).toBe(0)
      const dirty = await runCli(["init", dir])
      expect(dirty.code).toBe(1)
      expect(dirty.err).toContain("requires a clean worktree")
      expect(dirty.err).toContain(".opencode/auto/config.json")
      // The tracked surfaces (plans/0138) sit in the dirty list beside the
      // config layer — init's writes the person has not committed yet; the
      // ignore rules still keep the local-only files (AGENTS.md) out of it,
      // and opencode.json is the person's own since plans/0296 (never init's
      // write, so never in the list).
      expect(dirty.err).toContain(".gitignore")
      expect(dirty.err).not.toContain("opencode.json")
      expect(dirty.err).not.toContain("AGENTS.md")
      expect(dirty.err).toContain("-f/--force")
      // The refusal happens before any write
      expect(await readConfigAt(dir)).not.toHaveProperty("agent")
      // -f skips it
      expect((await runCli(["init", dir, "-f", "--agent", "claude"])).code).toBe(0)
      expect(await readConfigAt(dir)).toMatchObject({ agent: "claude" })
      // After a commit it no longer refuses
      await commitAll(dir)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await readConfigAt(dir)).not.toHaveProperty("agent")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("amend is not a full overwrite and is not bound by the gate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await git(dir, "init")
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["amend", dir, "--test-by-driver"])).code).toBe(0)
      expect(await readConfigAt(dir)).toMatchObject({ testByDriver: true })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a dirty worktree intercepts reset, the listed files stay intact; -f skips it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await git(dir, "init")
      expect((await runCli(["init", dir])).code).toBe(0)
      await commitAll(dir)
      await writeFile(join(dir, "untracked.ts"), "export {}\n")
      const dirty = await runCli(["reset", dir])
      expect(dirty.code).toBe(1)
      expect(dirty.err).toContain("requires a clean worktree")
      expect(dirty.err).toContain("untracked.ts")
      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).exists()).toBe(true)
      expect((await runCli(["reset", dir, "-f"])).code).toBe(0)
      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("uncommitted changes in nested repositories/submodules are intercepted too", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await git(dir, "init")
      expect((await runCli(["init", dir])).code).toBe(0)
      await commitAll(dir)
      await mkdir(join(dir, "vendor", "lib"), { recursive: true })
      await git(join(dir, "vendor", "lib"), "init")
      await writeFile(join(dir, "vendor", "lib", "index.ts"), "export {}\n")
      await commitAll(join(dir, "vendor", "lib"))
      await writeFile(join(dir, "vendor", "lib", "index.ts"), "export const x = 1\n")
      const dirty = await runCli(["reset", dir])
      expect(dirty.code).toBe(1)
      expect(dirty.err).toContain("vendor/lib/index.ts")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

})





// sync (auto-core plans/0100 D4/D5): the person's upgrade command for a
// materialized intent bundle, driven through the CLI — the plan/confirm/apply
// UX on the fix pattern, the dryrun exit codes, the never-overwrite-edited
// invariant, the unstamped bootstrap's adopt/report split with --from-bundle,
// and the flag discipline.
describe("CLI: sync (auto-core plans/0100 D4/D5)", () => {
  const PACK = join(".opencode", "auto", "intents", "faithful.md")
  const STAMP = join(".opencode", "auto", "provenance.json")

  // An initialized, committed faithful project whose pack and stamp predate
  // the charter family (the incident's shape, hand-aged as an older binary
  // would have left them). `unstamped` additionally removes the sidecar (the
  // legacy project).
  async function agedProject(unstamped = false): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-sync-"))
    expect((await runCli(["init", dir, "--intent", "faithful"])).code).toBe(0)
    const files = (await resolveIntentBundle("faithful"))!
    const current = await Bun.file(join(dir, PACK)).text()
    const old = `${current.slice(0, current.indexOf("### verify-plan-test")).trimEnd()}\n`
    await Bun.write(join(dir, PACK), old)
    if (unstamped) await rm(join(dir, STAMP))
    else {
      const map = bundleFileMap(parseIntentBundle(files))
      map[PACK.replaceAll("\\", "/")] = old
      await Bun.write(join(dir, STAMP), renderProvenanceStamp(provenanceStampOf("faithful", map)))
    }
    await commitFixture(dir)
    return dir
  }

  test("a stale stamped project: dryrun plans, -f fast-forwards, detection goes quiet", async () => {
    const dir = await agedProject()
    try {
      const dry = await runCli(["sync", dir, "--dryrun"])
      expect(dry.code).toBe(1)
      expect(dry.out).toContain(`→ ${PACK.replaceAll("\\", "/")}: fast-forward to the running bundle (adds ### verify-plan-test, ### verify-plan-acceptance)`)
      expect(dry.out).toContain("dryrun: nothing was changed")
      expect(await Bun.file(join(dir, PACK)).text()).not.toContain("### verify-plan-test")
      // The status row and the fix finding are the detection the person
      // acted on; after the sync both go quiet.
      expect((await runCli(["status", dir])).out).toContain("stale")
      expect((await runCli(["fix", dir, "--dryrun"])).out).toContain("verify-plan-test")
      const applied = await runCli(["sync", dir, "-f"])
      expect(applied.code).toBe(0)
      expect(applied.out).toContain(`synced: ${PACK.replaceAll("\\", "/")}`)
      expect(applied.out).toContain("stamp: .opencode/auto/provenance.json rewritten")
      expect(await Bun.file(join(dir, PACK)).text()).toContain("### verify-plan-test")
      expect((await runCli(["status", dir])).out).not.toContain("stale")
      expect((await runCli(["fix", dir])).out).toContain("✓ nothing to fix")
      const again = await runCli(["sync", dir, "--dryrun"])
      expect(again.code).toBe(0)
      expect(again.out).toContain("✓ nothing to sync")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a person-edited managed file is never written, reported as the person's alone", async () => {
    const dir = await agedProject()
    try {
      const mode = join(dir, ".opencode", "auto", "modes", "faithful.md")
      const edited = `${(await Bun.file(mode).text()).trimEnd()}\n\n## my own section\n\nOurs.\n`
      await Bun.write(mode, edited)
      await commitFixture(dir)
      const out = await runCli(["sync", dir, "-f"])
      expect(out.code).toBe(0)
      expect(await Bun.file(mode).text()).toBe(edited)
      expect(out.out).toContain("edited after materialization")
      expect(out.err).toContain("yours alone")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the unstamped bootstrap: adopt/report split, --from-bundle the overwrite", async () => {
    const dir = await agedProject(true)
    try {
      const dry = await runCli(["sync", dir, "--dryrun"])
      expect(dry.code).toBe(1)
      expect(dry.out).toContain(`⚠ ${PACK.replaceAll("\\", "/")}: differs from the running bundle (adds ### verify-plan-test, ### verify-plan-acceptance) — report-only`)
      expect(dry.out).toContain("adopted (the stamp starts managing it)")
      const adopted = await runCli(["sync", dir, "-f"])
      expect(adopted.code).toBe(0)
      // The differing pack was never written without the flag.
      expect(await Bun.file(join(dir, PACK)).text()).not.toContain("### verify-plan-test")
      expect(await Bun.file(join(dir, STAMP)).text()).toContain("survey.md")
      // With the person's pristine-but-old assertion the pack converges.
      const converged = await runCli(["sync", dir, "-f", "--from-bundle"])
      expect(converged.code).toBe(0)
      expect(await Bun.file(join(dir, PACK)).text()).toContain("### verify-plan-test")
      expect((await runCli(["status", dir])).out).not.toContain("stale")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("flag discipline and the uninitialized refusal", async () => {
    const dir = await agedProject()
    const bare = await mkdtemp(join(tmpdir(), "auto-cli-sync-"))
    try {
      const bad = await runCli(["sync", dir, "--parallel", "low"])
      expect(bad.code).toBe(1)
      expect(bad.err).toContain("unknown option --parallel: sync only accepts a directory argument, -f/--force, --dryrun and --from-bundle")
      const nothing = await runCli(["sync", bare])
      expect(nothing.code).toBe(1)
      expect(nothing.err).toContain("has no .opencode/auto/config.json")
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(bare, { recursive: true, force: true })
    }
  })
})

describe("CLI: release certifies the destination standing alone (auto-core plans/0103 D2/D3)", () => {
  test("the deferred containment findings block at release (exit 2); a clean self-contained destination certifies (exit 0); no destination and no config exit 1; options are refused", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-release-"))
    const bare = await mkdtemp(join(tmpdir(), "auto-cli-release-bare-"))
    try {
      await mkdir(join(dir, "pkg"), { recursive: true })
      const nested = gitOf(join(dir, "pkg"))
      await Bun.write(join(dir, "pkg", "readme.txt"), "nested\n")
      await nested("init", "-q")
      await nested("add", "-A")
      await nested("commit", "-qm", "setup")
      expect((await runCli(["init", dir])).code).toBe(0)
      await commitFixture(dir)
      // The recorded findings of the working rounds — a task-id citation
      // and a path climbing out of the destination's root — block here.
      // The findings ride a driver commit (the Auto-Stage trailer): the
      // scan's baseline (0119's git-modified view) stops at the first
      // person commit, so person-committed content is never scanned.
      await Bun.write(join(dir, "pkg", "src.rs"), "//! The slot (T-012 §2.2).\n")
      await Bun.write(join(dir, "pkg", "b.txt"), 'see ../../outside\n')
      await nested("add", "-A")
      await nested("commit", "-qm", "work", "-m", "Auto-Stage: unit")
      const blocked = await runCli(["release", dir])
      expect(blocked.code).toBe(2)
      expect(blocked.err).toContain("the destination does not stand alone yet")
      expect(blocked.err).toContain("pkg/src.rs: 1 line(s) mention a task id (T-NNN)")
      expect(blocked.err).toContain('pkg/b.txt:1 references "../../outside"')
      expect(blocked.err).toContain(`next: fix them (restate in place, vendor what a path named), commit, then re-run: opencode-auto release ${dir}`)
      // Restated away and committed: certified with the HEAD named.
      await Bun.write(join(dir, "pkg", "src.rs"), "//! The geometry slot.\n")
      await Bun.write(join(dir, "pkg", "b.txt"), "self-contained\n")
      await nested("add", "-A")
      await nested("commit", "-qm", "scrub")
      const ok = await runCli(["release", dir])
      expect(ok.code).toBe(0)
      const head = (await nested("rev-parse", "--short", "HEAD")).trim()
      expect(ok.out).toContain(`✓ pkg @ ${head} — no process references, no task ids, no paths outside its own root`)
      expect(ok.out).toContain("✓ release checks passed")
      // An uncommitted state is not a releasable state.
      await Bun.write(join(dir, "pkg", "wip.txt"), "wip\n")
      const dirty = await runCli(["release", dir])
      expect(dirty.code).toBe(2)
      expect(dirty.err).toContain("pkg holds 1 uncommitted path(s)")
      await nested("add", "-A")
      await nested("commit", "-qm", "wip lands")
      // The workspace's own task-naming script never blocked it, and the
      // outer repository's dirt (the uncommitted script below) is not the
      // destination's business.
      await mkdir(join(dir, "test"), { recursive: true })
      await Bun.write(join(dir, "test", "lane.sh"), "# the T-012 lane\n")
      const besideDirt = await runCli(["release", dir])
      expect(besideDirt.code).toBe(0)
      // No config / no destination: exit 1.
      const noConfig = await runCli(["release", bare])
      expect(noConfig.code).toBe(1)
      expect(noConfig.err).toContain(`nothing to release: ${bare} has no`)
      // Flagless like status: any option is a usage error.
      const option = await runCli(["release", dir, "--force"])
      expect(option.code).toBe(1)
      expect(option.err).toContain("unknown option --force: release only accepts a directory argument, no options")
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(bare, { recursive: true, force: true })
    }
  })
})


// The filled round brief the round-start gate wants (the stub's comments are
// not content).
function renderRoundBriefText(): string {
  return [
    "# Round R-01",
    "",
    "## Goal",
    "",
    "Port the timer's behavior into the target's own terms.",
    "",
    "## Acceptance criteria",
    "",
    "- The behavior-only specification holds.",
    "",
    "## Release criteria",
    "",
    "- The round's phases complete.",
    "",
    "## Close",
    "",
    "- Restated: everything the deliverable needs.",
    "- Accepted as lost: nothing.",
    "",
  ].join("\n")
}

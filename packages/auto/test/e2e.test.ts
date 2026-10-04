import { describe, expect, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { loadPlan, taskStatePaths } from "@opencode-ai/auto-core/tasks"
import { subtaskDoc, taskDoc } from "@opencode-ai/auto-core/docpaths"
import { RUN_LOCK_FILE } from "@opencode-ai/auto-core/lock"
import { renderProjectBrief } from "@opencode-ai/auto-core/brief"
import { CONFIG_DEFAULTS } from "@opencode-ai/auto-core/config"
import { runAll } from "@opencode-ai/auto-core/loop"
import { createServices, installServices, services } from "@opencode-ai/auto-core/services"
import { completePhase, establishRound, readPhases } from "@opencode-ai/auto-core/phases"
import { renderText } from "@opencode-ai/auto-core/template"
import { opencodeHost, manage } from "@opencode-ai/auto-core/agent/opencode/server"
import { stepUpPoint } from "@opencode-ai/auto-core/model-step"
import { askClassifier, classifierFor } from "@opencode-ai/auto-core/classify"
import type { AgentClient, AgentEvent, AgentHost } from "@opencode-ai/auto-core/agent/types"
import { setShellProfile } from "@opencode-ai/auto-core/shell"
import { setSwitchModelRegistry } from "@opencode-ai/auto-core/switches"
import type { RoutingFacts } from "@opencode-ai/auto-core/routing"
import { estimateTokens } from "@opencode-ai/auto-core/usage"
import templateConfig from "@opencode-ai/auto-core/templates/opencode.json" with { type: "file" }
import templateAgent from "@opencode-ai/auto-core/templates/.opencode/agent/auto.md" with { type: "file" }

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

const TASKS: [string, string, string][] = [
  ["T-001", "create hello.txt", 'Create hello.txt in the current directory with the content "hello".'],
  [
    "T-002",
    "request write permission and write greeting.txt",
    'This task must obtain the user\'s authorization first. Call the question tool to ask the user:\n"May the write permission for greeting.txt be allowed in opencode.json?"\nOnce the answer is granted, write the greeting "hello" into greeting.txt.',
  ],
  ["T-003", "summarize", "Create SUMMARY.md listing the generated files."],
]

const P01 = { round: "R-01", id: "P01", dir: "docs/R-01/P01-implement" }

test.skipIf(!E2E)(
  "end to end: a three-task plan with one block and a human-intervention resume",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-e2e-"))
    try {
      await establishRound(dir, { phases: "m" })
      await listTasks(dir, P01.dir, "R-01.P01", TASKS)
      await Bun.write(
        join(dir, "opencode.json"),
        await Bun.file(templateConfig).text(),
      )
      // The pre-run integrity check requires the agent contract file to exist
      // (the server only answers UnknownError when it is missing).
      // Like init: write the contract rendered with this run's switches (run's
      // inconsistency check also compares against the rendered one).
      await Bun.write(
        join(dir, ".opencode/agent/auto.md"),
        renderText(await Bun.file(templateAgent).text(), {}),
      )

      // First run: T-001 done, T-002 triggers question → blocked shutdown
      expect(await runAll(dir, {})).toBe(2)
      const blocked = await loadPlan(dir, P01)
      expect(blocked.tasks[0]!.status).toBe("done")
      expect(blocked.tasks[1]!.status).toBe("blocked")
      // The blocked reason never enters the task document (it lives in the run log only)
      expect(await Bun.file(join(dir, "docs/T-002/todo.md")).text()).not.toContain("question:")

      // Simulated human intervention: the blocking question is settled outside
      // the session — just restart to resume.
      // Second run: T-002 resumes, T-003 completes, everything done
      expect(await runAll(dir, {})).toBe(0)
      const done = await loadPlan(dir, P01)
      expect(done.tasks.every((t) => t.status === "done")).toBe(true)
      expect(await Bun.file(join(dir, "SUMMARY.md")).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  { timeout: 600_000 },
)

// Mark the current round's phases of these preset letters complete, the way
// the driver does (completePhase: todo.md → done.md + index tick).
async function completeLetters(dir: string, letters: string[]) {
  for (const unit of (await readPhases(dir))!.phases) if (letters.includes(unit.entry.letter ?? "")) await completePhase(dir, unit)
}

// Fill in the round brief's `## Close` restatement listing, which the
// round-close gate requires before the next round opens (plans/0049 G8;
// plan's prelude enforces it).
async function fillClose(dir: string, round = "R-01") {
  await Bun.write(join(dir, `docs/${round}/round.md`), `# Round ${round}\n\n## Close\n\n- Restated: none needed.\n- Accepted as lost: none.\n`)
}

// Phased flow P3 end to end (phases=mv, the m phase already done): the v
// (acceptance) phase's tasks run as usual, the handover is the distillation
// session's handover.md inside the phase directory (the four-section
// protocol), the phase's done.md advances, and all phases complete with
// exit 0.
test.skipIf(!E2E)(
  "end to end: v-phase tasks and the distilled handover (phases=mv)",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-e2e-phase-"))
    try {
      // The m phase is done → the current phase is P02-acceptance; its task
      // index pre-lists the v phase's tasks.
      await establishRound(dir, { phases: "mv" })
      await completeLetters(dir, ["m"])
      await listTasks(dir, "docs/R-01/P02-acceptance", "R-01.P02", [
        ["T-001", "acceptance pass check", 'Create acceptance.md in the current directory with the content "accepted".'],
      ])
      await Bun.write(
        join(dir, "opencode.json"),
        await Bun.file(templateConfig).text(),
      )
      await Bun.write(
        join(dir, ".opencode/agent/auto.md"),
        renderText(await Bun.file(templateAgent).text(), {}),
      )

      expect(await runAll(dir, { phases: "mv" })).toBe(0)
      expect(await Bun.file(join(dir, "docs/R-01/P02-acceptance/tasks.md")).text()).toContain("- [x] T-001")
      expect(await Bun.file(join(dir, "docs/T-001/done.md")).exists()).toBe(true)
      // Distilled handover: handover.md has all four sections; the phase's
      // done.md advances.
      const handover = await Bun.file(join(dir, "docs/R-01/P02-acceptance/handover.md")).text()
      for (const section of ["## Key decisions", "## Constraints and pitfalls", "## Required reading for the next phase", "## Artifact index"]) {
        expect(handover).toContain(section)
      }
      expect(await Bun.file(join(dir, "docs/R-01/P02-acceptance/done.md")).exists()).toBe(true)
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [x] P02 acceptance")
      expect((await Bun.file(join(dir, "acceptance.md")).text()).trim()).toBe("accepted")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  { timeout: 600_000 },
)

// Custom phase types end to end (M3.8): a project-defined type runs the full
// plan→execute→handover pipeline, proving the phase-type registry serves more
// than the builtin admtvk — the planning duties declared in
// .opencode/auto/phases/<type>.md drive the phase-planning session, tasks run
// as usual, and the handover distillation likewise produces the four-section
// protocol document.
test.skipIf(!E2E)(
  "end to end: the full pipeline of a custom phase type (plan→execute→handover)",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-e2e-custom-phase-"))
    try {
      await mkdir(join(dir, ".opencode/auto/phases"), { recursive: true })
      await Bun.write(
        join(dir, ".opencode/auto/phases/security-review.md"),
        "# Security review\n\n## plan duties\n\nPlan exactly one task: create a file security-review.md in the current\n" +
          'directory containing the word "reviewed".\n',
      )
      await establishRound(dir, { phases: "security-review,implement" })
      await Bun.write(
        join(dir, "opencode.json"),
        await Bun.file(templateConfig).text(),
      )
      await Bun.write(
        join(dir, ".opencode/agent/auto.md"),
        renderText(await Bun.file(templateAgent).text(), {}),
      )

      // P01-security-review has no pre-listed tasks.md: the phase-planning
      // session must write both the task index and the task document itself.
      expect(await runAll(dir, { phases: "security-review,implement" })).toBe(0)
      expect(await Bun.file(join(dir, "docs/R-01/P01-security-review/tasks.md")).exists()).toBe(true)
      expect((await Bun.file(join(dir, "security-review.md")).text())).toContain("reviewed")
      const handover = await Bun.file(join(dir, "docs/R-01/P01-security-review/handover.md")).text()
      for (const section of ["## Key decisions", "## Constraints and pitfalls", "## Required reading for the next phase", "## Artifact index"]) {
        expect(handover).toContain(section)
      }
      expect(await Bun.file(join(dir, "docs/R-01/P01-security-review/done.md")).exists()).toBe(true)
      // The second phase (builtin implement, still task-less at round start)
      // gets planned and executed the same way, proving the custom and
      // builtin types share one pipeline.
      expect(await Bun.file(join(dir, "docs/R-01/P02-implement/done.md")).exists()).toBe(true)
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [x] P02 implement")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  { timeout: 600_000 },
)

// Three-phase new-layout end to end (M3.8): phases=adm walks one full round of
// P01-analysis/P02-design/P03-implement, proving the unit layout (D14/0047)
// holds along the whole chain — locally numbered phase directories inside the
// round with their own tasks.md, tasks permanently flattened into
// docs/T-NNN/todo.md (never nested in the phase directories), the
// todo.md→done.md rename riding the driver's close-out commit (the worktree is
// clean when the run ends, no manual commit left behind), and round completion
// carrying no dedicated marker — it is derived from the three phase
// directories' done.md files existing.
test.skipIf(!E2E)(
  "end to end: three phases in the new layout (phases=adm) — P01-P03, tasks.md/T-*/todo.md, the rename riding the commit, round completion derived from done.md",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-e2e-adm-"))
    try {
      const git = async (...args: string[]) => {
        const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "ignore", stderr: "ignore" })
        expect(await proc.exited).toBe(0)
      }
      await git("init")

      await establishRound(dir, { phases: "adm" })
      await listTasks(dir, "docs/R-01/P01-analysis", "R-01.P01", [
        ["T-001", "survey output", 'Create analysis.md in the current directory with the content "surveyed".'],
      ])
      await listTasks(dir, "docs/R-01/P02-design", "R-01.P02", [
        ["T-002", "design output", 'Create design.md in the current directory with the content "designed".'],
      ])
      await listTasks(dir, "docs/R-01/P03-implement", "R-01.P03", [
        ["T-003", "implementation output", 'Create implement.md in the current directory with the content "implemented".'],
      ])
      await Bun.write(join(dir, "opencode.json"), await Bun.file(templateConfig).text())
      await Bun.write(join(dir, ".opencode/agent/auto.md"), renderText(await Bun.file(templateAgent).text(), {}))
      // The round-establishment scaffolding is committed once as the baseline,
      // so the worktree is clean when the first execution unit starts (the
      // 0021 P3 start gate; the existing non-git cases are exempt, hence the
      // deliberate git repository here).
      await git("add", "-A")
      await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "round baseline")

      expect(await runAll(dir, { phases: "adm" })).toBe(0)

      // Locally numbered directories inside the round's phases plus each
      // phase's own tasks.md; task content lives permanently under docs/T-NNN/,
      // never nested in a phase directory.
      expect(await Bun.file(join(dir, "docs/R-01/P01-analysis/tasks.md")).text()).toContain("- [x] T-001")
      expect(await Bun.file(join(dir, "docs/R-01/P02-design/tasks.md")).text()).toContain("- [x] T-002")
      expect(await Bun.file(join(dir, "docs/R-01/P03-implement/tasks.md")).text()).toContain("- [x] T-003")
      for (const id of ["T-001", "T-002", "T-003"]) {
        expect(await Bun.file(join(dir, "docs", id, "done.md")).exists()).toBe(true)
        expect(await Bun.file(join(dir, "docs", id, "todo.md")).exists()).toBe(false)
      }
      expect(await Bun.file(join(dir, "analysis.md")).text()).toContain("surveyed")
      expect(await Bun.file(join(dir, "design.md")).text()).toContain("designed")
      expect(await Bun.file(join(dir, "implement.md")).text()).toContain("implemented")

      // The rename rides the commit: the worktree is clean after the full run —
      // the todo→done rename left no manual commit step behind.
      const status = Bun.spawn(["git", "-C", dir, "status", "--porcelain"], { stdout: "pipe" })
      expect((await new Response(status.stdout).text()).trim()).toBe("")
      expect(await status.exited).toBe(0)

      // Round completion has no dedicated marker; it is derived from the three
      // phase directories' done.md files.
      for (const phaseDir of ["P01-analysis", "P02-design", "P03-implement"]) {
        expect(await Bun.file(join(dir, "docs/R-01", phaseDir, "done.md")).exists()).toBe(true)
        expect(await Bun.file(join(dir, "docs/R-01", phaseDir, "todo.md")).exists()).toBe(false)
      }
      const phasesIndex = await Bun.file(join(dir, "docs/R-01/phases.md")).text()
      expect(phasesIndex).toContain("- [x] P01 analysis")
      expect(phasesIndex).toContain("- [x] P02 design")
      expect(phasesIndex).toContain("- [x] P03 implement")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  { timeout: 900_000 },
)

// A real context step-up on a provider that sells one model under several ids
// sharing a prompt cache (auto-core plans/0055 §4.5, the §13 S2 verification).
// Opt-in like the e2e above, and additionally naming the id pair (and an
// optional third field: one padding read's size in k tokens, default 40):
//   OPENCODE_AUTO_E2E=1 OPENCODE_AUTO_E2E_STEPS="prov/model-256k,prov/model" \
//     bun test test/e2e.test.ts -t "step-up"
// (run from packages/auto with the pair of a provider whose ids share a
// cache.) The smoke plants a project-layer registry around the pair, sizes
// the padding from the base id's live window, and runs one task that
// re-reads the padding file until the context crosses the step-up point.
const STEPS_PAIR = (process.env.OPENCODE_AUTO_E2E_STEPS ?? "")
  .split(",")
  .map((part) => part.trim())
  .filter(Boolean)

test.skipIf(!(E2E && STEPS_PAIR.length >= 2))(
  "a real step-up: the same session moves to the wider id at the step-up point (needs a provider with a shared cache)",
  async () => {
    const baseId = STEPS_PAIR[0]!
    const wideId = STEPS_PAIR[1]!
    const dir = await mkdtemp(join(tmpdir(), "auto-e2e-steps-"))
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
    try {
      await establishRound(dir, { phases: "m" })
      await Bun.write(join(dir, "opencode.json"), await Bun.file(templateConfig).text())
      await Bun.write(join(dir, ".opencode/agent/auto.md"), renderText(await Bun.file(templateAgent).text(), {}))
      // The project layer is the whole registry: one stepped entry.
      await Bun.write(
        join(dir, ".opencode/auto/models.json"),
        JSON.stringify({ models: { step: { agent: "opencode", model: baseId, wider: [wideId] } }, tiers: { deep: ["step"], simple: ["step"] } }, null, 2),
      )
      // The base id's live window sizes the padding: one pass ≈ pad tokens,
      // enough passes to cross the step-up point with slack (the count is
      // capped so an expensive pair cannot run away).
      const host = await opencodeHost(dir, { permission: "allow", log: () => {} })
      let window: number | undefined
      try {
        window = (await host.client.contextLimits()).get(baseId)
      } finally {
        host.close()
      }
      expect(window, `${baseId} has no known context window on this server (check the OPENCODE_AUTO_E2E_STEPS pair)`).toBeDefined()
      const point = stepUpPoint(window!)
      const pad = Math.min((STEPS_PAIR[2] ? Number(STEPS_PAIR[2]) : 40) * 1000, Math.max(1000, Math.floor(point / 2)))
      const reads = Math.min(12, Math.max(2, Math.ceil((point * 1.2 + 20_000) / pad)))
      const unit = "the quick brown fox jumps over the lazy dog; "
      let padding = ""
      while (estimateTokens(padding) < pad) padding += unit
      await Bun.write(join(dir, "data.txt"), padding)
      await listTasks(dir, P01.dir, "R-01.P01", [
        [
          "T-001",
          "keep reading until the wider step",
          `Read data.txt from start to end with the read tool (in several offset chunks when needed; skip no line). Each time you have read the whole file, append one line "pass N done" to log.txt (N counting from 1). Repeat the full read ${reads} times. Never summarize from memory — every pass must read the file again. When all passes are done, create done.txt with the content "ok".`,
        ],
      ])
      // The cap sits at the base window, so the handover hint (2×cap) never
      // pre-empts the step-up point (window − max(48k, window/5)).
      expect(await runAll(dir, { contextLimit: window })).toBe(0)
      const stepped = lines.filter((line) => line.includes("reached the step-up point") || line.includes("step-up late"))
      expect(stepped.join("\n")).toContain(`continuing the same session on ${wideId}`)
      // The task itself completed on the stepped entry either way.
      expect(await Bun.file(join(dir, "done.txt")).text()).toContain("ok")
    } finally {
      printed.mockRestore()
      await rm(dir, { recursive: true, force: true })
    }
  },
  { timeout: 900_000 },
)

// A real two-key rotation smoke (auto-core plans/0055 §4.3, §13 S3): a
// deliberately exhausted first key rotates the ring onto a working second
// key by restarting the managed server, and the same model finishes the
// task. Opt-in like the e2e above, and additionally naming the model id and
// the two key references exactly as the registry writes them:
//   OPENCODE_AUTO_E2E=1 OPENCODE_AUTO_E2E_KEYS="prov/model,{env:PROV_KEY_DEAD},{env:PROV_KEY_LIVE}" \
//     bun test test/e2e.test.ts -t "key ring"
// Environment contract (read before running):
//   - every `{env:}` reference's variable must be set and non-empty in this
//     process (the run-start reference check refuses otherwise, and the
//     spawned opencode server substitutes the reference from its own
//     environment, which is this process's);
//   - the first key must be deliberately dead in a way the error-wording
//     classifier recognizes (401/403, quota or balance wording), so the
//     failure settles as auth/quota and escalates to the ring instead of
//     looping through the agent's own retries;
//   - the provider's own environment variable(s) must be UNSET here, so the
//     config apiKey is the only key in play — this is the F6 check: a
//     provider whose loader picks its own env/auth token over a config key
//     never rotates (the first dispatch would succeed on the ambient
//     credential) and this smoke fails, which is the documented answer for
//     whether that provider supports a ring.
const KEYS_SPEC = (process.env.OPENCODE_AUTO_E2E_KEYS ?? "")
  .split(",")
  .map((part) => part.trim())
  .filter(Boolean)

test.skipIf(!(E2E && KEYS_SPEC.length >= 3))(
  "a real key ring: the exhausted first key rotates to the second and the same model finishes (checks the provider honors a config key)",
  async () => {
    const [modelId, deadRef, liveRef] = KEYS_SPEC as [string, string, string]
    const dir = await mkdtemp(join(tmpdir(), "auto-e2e-keys-"))
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
    try {
      await establishRound(dir, { phases: "m" })
      await Bun.write(join(dir, "opencode.json"), await Bun.file(templateConfig).text())
      await Bun.write(join(dir, ".opencode/agent/auto.md"), renderText(await Bun.file(templateAgent).text(), {}))
      // The project layer is the whole registry: one ringed entry, two keys,
      // the dead one first.
      await Bun.write(
        join(dir, ".opencode/auto/models.json"),
        JSON.stringify({ models: { ringed: { agent: "opencode", model: modelId, keys: [deadRef, liveRef] } }, tiers: { deep: ["ringed"], simple: ["ringed"] } }, null, 2),
      )
      await listTasks(dir, P01.dir, "R-01.P01", [
        ["T-001", "create done.txt", 'Create done.txt in the current directory with the content "ok".'],
      ])
      expect(await runAll(dir, {})).toBe(0)
      // One rotation: the line names both positions and references only —
      // key 1/2 marked down, the same model continues on key 2/2 — and the
      // dead key's actual value never appears anywhere the driver printed.
      const rotated = lines.filter((line) => line.includes("marked down, continuing the same model on key"))
      expect(rotated).toHaveLength(1)
      expect(rotated[0]).toContain("key 1/2")
      expect(rotated[0]).toContain("key 2/2")
      const deadName = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(deadRef)?.[1]
      if (deadName !== undefined && process.env[deadName])
        expect(lines.join("\n")).not.toContain(process.env[deadName]!)
      // The task itself completed on the same entry.
      expect(await Bun.file(join(dir, "done.txt")).text()).toContain("ok")
    } finally {
      printed.mockRestore()
      await rm(dir, { recursive: true, force: true })
    }
  },
  { timeout: 900_000 },
)

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
// XDG_CONFIG_HOME at an empty directory. The opt-in in-process runs above
// call runAll in this process, where OPENCODE_AUTO_MODELS names a file that
// does not exist (no operator layer): moving XDG_CONFIG_HOME here would also
// hide the operator's opencode config from the real server they start.
// AUTO-DECISION: subprocesses get an empty XDG_CONFIG_HOME, this process an OPENCODE_AUTO_MODELS naming a missing file (a missing file is no operator layer, with no XDG fallback, and the in-process runs keep the real opencode config they need)

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
}
process.env.OPENCODE_AUTO_MODELS = join(EMPTY_CONFIG_HOME, "no-operator-layer.json")

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

// The fake agent's environment (the B6/C5 convention): a PATH with the fake
// `claude` first, plus the adapter selection. runCli's scrubbed base keeps the
// ambient OPENCODE_AUTO_* switches out, so the subprocess's experiment
// switches are deterministic.
// `extra` goes into the same environment (the fake's own FAKE_CLAUDE_* knobs).
async function fakeClaude(extra: Record<string, string> = {}) {
  const binDir = await mkdtemp(join(tmpdir(), "auto-cli-agent-"))
  await Bun.write(
    join(binDir, "claude"),
    `#!/bin/sh\nexec bun ${JSON.stringify(join(import.meta.dir, "fixtures", "fake-claude.ts"))} "$@"\n`,
  )
  await chmod(join(binDir, "claude"), 0o755)
  const env: Record<string, string> = { PATH: `${binDir}:${process.env.PATH ?? ""}`, OPENCODE_AUTO_AGENT: "claude", ...extra }
  const run = (args: string[]) => runCli(args, env)
  return { run, done: () => rm(binDir, { recursive: true, force: true }) }
}

describe("CLI parsing: run-side options and the config", () => {
  test("run refuses options frozen by init (exit code 1 + revision hints)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const fixed = [
        ["-m", "migrate"],
        ["--mode", "migrate"],
        ["--agent", "claude"],
        ["--context-limit", "64"],
        ["--subtask", "auto"],
        ["--idle-time", "10"],
        ["--idle-max", "0"],
        ["--phases", "admtvk"],
        ["--test-by-driver"],
        ["--handover-test"],
        ["--auto-number"],
        ["--no-auto-number"],
        ["--wrapup"],
        ["--no-wrapup"],
        ["--parallel", "low"],
        ["--scan-exempt", "test/fixtures/**"],
      ]
      for (const extra of fixed) {
        const run = await runCli(["run", dir, ...extra])
        expect(run.code).toBe(1)
        expect(run.err).toContain("was frozen by init")
        expect(run.err).toContain(".opencode/auto/config.json")
        expect(run.err).toContain("opencode-auto amend <dir>")
      }
      // The auto-numbering pair's revision hint takes the paired form
      const numbering = await runCli(["run", dir, "--auto-number"])
      expect(numbering.err).toContain("--auto-number (use --no-auto-number to turn off)")
      // The wrapup pair's revision hint takes the paired form
      const wrapup = await runCli(["run", dir, "--wrapup"])
      expect(wrapup.err).toContain("--wrapup (use --no-wrapup to turn off)")
      // -m/--mode's message has the same shape (the short form carries the
      // revision hint)
      expect((await runCli(["run", dir, "-m", "migrate"])).err).toContain("-m/--mode was frozen by init")
      // --commit is no longer a frozen config flag: the flag went with the
      // config key (committing cannot be turned off), so any form of it gets
      // the retirement notice instead of the amend guidance
      const retiredCommit = await runCli(["run", dir, "--commit", "true"])
      expect(retiredCommit.code).toBe(1)
      expect(retiredCommit.err).toContain("--commit is retired")
      expect(retiredCommit.err).not.toContain("was frozen by init")
      // The --commit-subtask removal message is kept
      const removed = await runCli(["run", dir, "--commit-subtask"])
      expect(removed.code).toBe(1)
      expect(removed.err).toContain("--commit-subtask removed")
      // The watchdog's old names get the rename hint
      const renamed = await runCli(["run", dir, "--verify-idle", "10"])
      expect(renamed.code).toBe(1)
      expect(renamed.err).toContain("was renamed to --idle-time")
      expect((await runCli(["init", dir, "--verify-max", "30"])).err).toContain("was renamed to --idle-max")
      // --handover-test requires --test-by-driver (init's constitutional
      // check; run already refuses the whole flag)
      const lonely = await runCli(["init", dir, "--handover-test"])
      expect(lonely.code).toBe(1)
      expect(lonely.err).toContain("--handover-test requires --test-by-driver")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("run keeps accepting valid option combinations, with no false usage errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const combos = [
        ["--permission", "ask-allow", "--wait-answer", "5", "--wait-between", "2"],
        ["--dryrun"],
      ]
      for (const extra of combos) {
        const run = await runCli(["run", dir, ...extra])
        // The combination is valid: the config takes its defaults, parsing
        // passes and runAll is entered; the empty directory lacks the agent
        // contract file, so it exits 1 (driver messages go to stdout,
        // distinguishing them from usage errors' stderr).
        expect(run.code).toBe(1)
        expect(run.out).toContain("agent contract file missing")
        expect(run.err).toBe("")
        expect(run.out).toContain("⚙ project config (.opencode/auto/config.json)")
      }
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

  test("the three completion-side mechanisms retired: the five flags are usage errors on init and run alike (exit code 1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const retired = [["--verify"], ["--verify=false"], ["--review", "3"], ["--early"], ["--early-review", "2"], ["--final-review", "2"]]
      for (const command of ["init", "run"]) {
        for (const extra of retired) {
          const run = await runCli([command, dir, ...extra])
          expect(run.code).toBe(1)
          expect(run.err).toContain(`${extra[0]!.split("=")[0]} is retired`)
          expect(run.err).toContain("Result: FAIL")
        }
      }
      // The refusal happens before any write
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("migration parameters retired (plans/0052 D1): --source-dir/--source-path/--dest-dir are usage errors on init/run, pointing to brief.md", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const retired = [["--source-dir", "legacy"], ["--source-path", "src/mod.ts"], ["--dest-dir=target"], ["--source-dir", "legacy", "--source-path", "pkg"]]
      for (const command of ["init", "run"]) {
        for (const extra of retired) {
          const run = await runCli([command, dir, ...extra])
          expect(run.code).toBe(1)
          expect(run.err).toContain(`${extra[0]!.split("=")[0]} is retired`)
          expect(run.err).toContain("state them in .opencode/auto/brief.md")
        }
      }
      // The refusal happens before any write
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("legacy layout retired (M3.7): a root PLAN.md or a docs/R-NN without phase directories → init/status/run/fix are usage errors with exit 1, nothing written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await Bun.write(join(dir, "PLAN.md"), "# plan\n")
      await Bun.write(join(dir, "docs/R-01/phases.md"), "# phases\n")
      // fix refuses alike — including --dryrun: the legacy-layout exemption
      // that let the retired `check` run on an old tree ended with the
      // command, and the read-only listing keeps fix's other refusals
      for (const args of [["init", dir], ["status", dir], ["run", dir], ["fix", dir], ["fix", dir, "--dryrun"]]) {
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

  test("legacy project fallback: when only .auto/config.json holds mode, run notes it keeps the legacy location", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await Bun.write(join(dir, ".auto/config.json"), JSON.stringify({ mode: "migrate" }))
      const run = await runCli(["run", dir])
      expect(run.out).toContain("mode taken from the legacy persisted value in .auto/config.json")
      expect(run.out).toContain("agent contract file missing")
      expect(run.err).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("bad config values → run exits 1, the message carrying the key name and the expected range", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ idleTime: 999 }))
      const run = await runCli(["run", dir])
      expect(run.code).toBe(1)
      expect(run.err).toContain("idleTime")
      expect(run.err).toContain("1..120")
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

  test("init writes the full config (all keys at their defaults) and prints the summary; writes the config layer only, the closing line points at plan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir])
      expect(init.code).toBe(0)
      expect(init.out).toContain("⚙ project config (.opencode/auto/config.json)")
      expect(init.out).toContain("auto-number on")
      // config-only init (auto-core plans/0053 D31): plan owns the rounds, so
      // init writes nothing under docs/ and points at plan's establish route.
      expect(init.out).toContain(`next: opencode-auto plan ${dir} (establishes round R-01 and stops at the round-start gate)`)
      expect(init.out).not.toContain("list tasks in")
      expect(await stat(join(dir, "docs")).catch(() => undefined)).toBeUndefined()
      // the brief stub is still init's (written when missing)
      expect(await Bun.file(join(dir, ".opencode/auto/brief.md")).exists()).toBe(true)
      expect(await readConfig(dir)).toEqual({
        mode: "migrate",
        contextLimit: 64,
        subtask: "auto",
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
    subtask: "auto",
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
      expect((await runCli(["amend", dir, "--test-by-driver", "--context-limit", "128", "--subtask", "ondemand"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual({ ...DEFAULT_CONFIG, contextLimit: 128, testByDriver: true, subtask: "ondemand" })
      // Amend one more unrelated key: the three keys changed last time survive
      // as-is
      expect((await runCli(["amend", dir, "--agent", "claude"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual({ ...DEFAULT_CONFIG, contextLimit: 128, testByDriver: true, subtask: "ondemand", agent: "claude" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("--subtask takes true, the planned pipeline (auto-core plans/0059 D1); a stored JSON boolean true reads as it, and bare --subtask stays auto", async () => {
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

  test("init defaults to the full overwrite: keys not given fall back to their defaults, identical to a bare init in a clean environment", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--test-by-driver", "--context-limit", "128", "--subtask", "ondemand", "--agent", "claude"])).code).toBe(0)
      expect(await readConfig(dir)).toEqual({ ...DEFAULT_CONFIG, contextLimit: 128, testByDriver: true, subtask: "ondemand", agent: "claude" })
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
      expect((await runCli(["init", dir, "--test-by-driver", "--subtask", "ondemand"])).code).toBe(0)
      const first = await readConfig(dir)
      const agentFirst = await Bun.file(join(dir, ".opencode/agent/auto.md")).text()
      const agentsFirst = await Bun.file(join(dir, "AGENTS.md")).text()
      await commitFixture(dir)
      for (let i = 0; i < 2; i++) {
        expect((await runCli(["init", dir, "--test-by-driver", "--subtask", "ondemand"])).code).toBe(0)
      }
      expect(await readConfig(dir)).toEqual(first)
      expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).text()).toBe(agentFirst)
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

  test("stored retired keys (plans/0052 D3/D4): run and --amend fail strictly; a full-overwrite init drops them and names each with its value", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--context-limit", "128"])).code).toBe(0)
      await commitFixture(dir)
      const file = join(dir, ".opencode/auto/config.json")
      const stored = { ...(await readConfig(dir)), source: { dir: "legacy", path: "pkg" }, destDir: "app", commit: false }
      await Bun.write(file, JSON.stringify(stored, null, 2) + "\n")
      const run = await runCli(["run", dir])
      expect(run.code).toBe(1)
      expect(run.err).toContain("commit: false is retired")
      // a key rule repairs it, so the strict failure names fix (plans/0052 D11)
      expect(run.err).toContain(`fix: opencode-auto fix ${dir}`)
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
      expect(init.out).toContain('full overwrite drops the retired key source = {"dir":"legacy","path":"pkg"}: the migration source and target are intent — state them in .opencode/auto/brief.md')
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
      const run = await runCli(["run", dir])
      expect(run.code).toBe(1)
      expect(`${run.out}${run.err}`).toContain("looks like an agent contract name")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init --parallel freezes the planning level; none drops the key; run --max-sessions above 1 needs one (plans/0068 D10)", async () => {
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
      // run: above 1 without a level is a usage error (plans/0068 D10); a
      // non-integer always was
      const two = await runCli(["run", dir, "--max-sessions", "2"])
      expect(two.code).toBe(1)
      expect(two.err).toContain("concurrent execution needs a parallel level")
      const zero = await runCli(["run", dir, "--max-sessions", "0"])
      expect(zero.code).toBe(1)
      expect(zero.err).toContain("--max-sessions takes a positive integer")
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
      // run refuses the flag as frozen by init, pointing at amend
      const frozen = await runCli(["run", dir, "--isolate", "pkg"])
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

  test("plan establishing a round isolates each designated repository on auto/R-NN; a dirty one blocks exit 2 naming the repository and its paths (plans/0074 U-L1)", async () => {
    const { dir, nested } = await isolateFixture("auto-cli-iso-plan-")
    try {
      const original = (await nested("rev-parse", "--abbrev-ref", "HEAD")).trim()
      const setup = (await nested("rev-parse", "--short", original)).trim()
      expect((await runCli(["init", dir, "--isolate", "pkg"])).code).toBe(0)
      await commitFixture(dir)
      // clean: the round opens with the repository switched onto auto/R-01
      const plan = await runCli(["plan", dir])
      expect(plan.code).toBe(0)
      expect(plan.out).toContain("✓ round R-01 established")
      expect(plan.out).toContain("✓ branch isolation: pkg on auto/R-01")
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
      const blocked = await runCli(["plan", dirty.dir])
      expect(blocked.code).toBe(2)
      expect(blocked.err).toContain("a repository designated by config isolate is not clean")
      expect(blocked.err).toContain("pkg:")
      expect(blocked.err).toContain("pkg/wip.txt")
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
      expect((await runCli(["plan", dir])).code).toBe(0)
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
      expect((await runCli(["plan", moved.dir])).code).toBe(0)
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
      expect((await runCli(["plan", dirty.dir])).code).toBe(0)
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

  test("land --abandon removes the isolation branch after the person-reviewed reset (exit 0, the tip printed, nothing landed); land's usage errors exit 1 (plans/0074 U-L2)", async () => {
    const { dir, nested } = await isolateFixture("auto-cli-land-abandon-")
    try {
      const original = (await nested("rev-parse", "--abbrev-ref", "HEAD")).trim()
      const setup = (await nested("rev-parse", "HEAD")).trim()
      expect((await runCli(["init", dir, "--isolate", "pkg"])).code).toBe(0)
      await commitFixture(dir)
      expect((await runCli(["plan", dir])).code).toBe(0)
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
      expect(unknown.err).toContain("land takes only --keep, --abandon and --merge")
      const swallowed = await runCli(["land", "--merge", usage.dir])
      expect(swallowed.code).toBe(1)
      expect(swallowed.err).toContain("land's landing-mode flag and takes no value")
      const elsewhere = await runCli(["run", usage.dir, "--keep"])
      expect(elsewhere.code).toBe(1)
      expect(elsewhere.err).toContain("--keep and --abandon are land options: run takes neither")
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
      expect(agents).toContain("build, test, compile, and lint")
      // The agent contract no longer restates the test protocol (0072 U-B,
      // T-131: the AGENTS.md block owns it — asserted above); under
      // test-by-driver its AGENTS.md note names the test section among the
      // block's contents, and the protocol wording itself is gone.
      const agent = await Bun.file(join(dir, ".opencode/agent/auto.md")).text()
      expect(agent).toContain("pointer/test/commit/summary/reference conventions")
      expect(agent).not.toContain("Build, test, compile, lint")
      expect(agent).not.toContain("tmp/test.sh")
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
      // init no longer establishes the round (plans/0053 D31); plan does
      expect((await runCli(["plan", dir])).code).toBe(0)
      await Bun.write(join(dir, "docs/R-01/P01-implement/tasks.md"), "# Tasks\n\n- [ ] T-001 sample task\n")
      await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: sample task\nPhase: R-01.P01\n\n## Goal\n\nSample.\n")
      const status = await runCli(["status", dir])
      expect(status.code).toBe(0)
      expect(status.out).toContain("⚙ project config (.opencode/auto/config.json): mode migrate · agent opencode")
      expect(status.out).toContain("phases m")
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

  test("init --phases valid values freeze into the config; the summary carries the phases; the closing line uniformly points at plan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--phases", "admtvk"])
      expect(init.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "admtvk" })
      expect(init.out).toContain("phases admtvk")
      // config-only init (plans/0053 D31): the closing line no longer splits
      // by phases — it always points at plan's round-establishment route;
      // nothing is written under docs/
      expect(init.out).toContain(`next: opencode-auto plan ${dir} (establishes round R-01 and stops at the round-start gate)`)
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
      // init establishes no round: only after plan establishes the current
      // round is there a phase index to judge
      expect((await runCli(["plan", dir])).code).toBe(0)
      await completeLetters(dir, ["a"])
      // A value starting with "d" would drop the completed P01-analysis →
      // refused (plannedPhaseUnits' read-only check, before any write)
      const bad = await runCli(["init", dir, "--phases", "dmt"])
      expect(bad.code).toBe(1)
      expect(bad.err).toContain('phases "dmt" would drop the completed phase docs/R-01/P01-analysis/ from docs/R-01/phases.md')
      expect(bad.err).toContain("once the current round is complete, any value applies to the next round")
      const badAmend = await runCli(["amend", dir, "--phases", "dmt"])
      expect(badAmend.code).toBe(1)
      expect(badAmend.err).toContain("would drop the completed phase docs/R-01/P01-analysis/")
      // A compatible value passes: the completed phase survives; init/amend no
      // longer rewrite the tail phases — the new value's difference from the
      // index surfaces as a drift for plan's re-sync route to handle (its
      // behavior is D34's)
      await commitFixture(dir)
      const ok = await runCli(["init", dir, "--phases", "admt"])
      expect(ok.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "admt" })
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [x] P01 analysis\n- [ ] P02 design\n- [ ] P03 implement\n")
      // An overwrite init (round established) ends with the plain plan
      // pointer, no longer claiming to establish R-01
      expect(ok.out).toContain(`next: opencode-auto plan ${dir}`)
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
      expect(relaxed.code).toBe(0)
      expect(await readConfig(dir)).toMatchObject({ phases: "admtvk" })
      // The completed round's index stays as-is (never rewritten)
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [x] P01 analysis\n- [x] P02 design\n- [x] P03 implement\n")
      // With an invalid phase index, init/amend report an environment error
      // pointing a person at the fix
      await Bun.write(join(dir, "docs/R-01/phases.md"), "- [ ] X1 analysis\n")
      const broken = await runCli(["amend", dir, "--phases", "admtvk"])
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
      expect(init.out).toContain(`next: opencode-auto plan ${dir} (establishes round R-01`)
      // After plan establishes the round, status prints the phase tree (per
      // the index)
      expect((await runCli(["plan", dir])).code).toBe(0)
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
      expect(await Bun.file(join(dir, ".opencode/auto/brief.md")).text()).toBe(renderProjectBrief())
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init -p is retired (plans/0053 D31): the message points at brief.md and plan -p; a human-written brief is not touched", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const brief = join(dir, ".opencode/auto/brief.md")
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await Bun.file(brief).text()).toBe(renderProjectBrief())
      // After a person rewrites the brief, an init with -p always exits on the
      // retired notice and the file survives untouched
      await Bun.write(brief, "Migrate legacy to bun\n")
      const refused = await runCli(["init", dir, "-p", "the revised intent"])
      expect(refused.code).toBe(1)
      expect(refused.err).toBe("--prompt is retired: init no longer writes the project brief: edit .opencode/auto/brief.md (the stub is there); planning input is plan -p\n")
      expect(await Bun.file(brief).text()).toBe("Migrate legacy to bun\n")
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
      const on = await runCli(["run", dir])
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
      for (const entry of ["tmp/", ".auto/", "/.gitignore", "/.env", "/AGENTS.md", "/opencode.json", "/.opencode/auto/models.json"]) {
        expect(gitignore).toContain(`${entry}\n`)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
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
      for (const entry of ["tmp/", ".auto/", "/.gitignore", "/.env", "/AGENTS.md", "/opencode.json", "/.opencode/auto/models.json"]) {
        expect(gitignore).toContain(`${entry}\n`)
      }
      expect(init.out).toContain(`next: opencode-auto plan ${dir}`)
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

  test("--name/--email also serve an existing repository without identity (in-repo init unchanged otherwise); a partial pair is a usage error; run refuses the flags", async () => {
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
      // run never writes git config: the flags are refused there
      const onRun = await runCli(["run", dir, "--name", "x", "--email", "y@z"])
      expect(onRun.code).toBe(1)
      expect(onRun.err).toContain("--name is an init option")
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  })
})


// The init shortcut retired with auto-core's implement.ts (plans/0053 D13): its
// planning session is plan's now (-p | --file). The flags stay value-parsed and
// every command refuses them with the retired notice before it writes anything.
describe("CLI: --implement-file/--implement-prompt retired (plans/0053 D13)", () => {
  test("every command refuses them with the retired notice; nothing is written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      for (const [flag, args] of [
        ["implement-prompt", ["init", dir, "--implement-prompt", "do something"]],
        ["implement-file", ["init", dir, "--phases", "am", "--implement-file", "plan.md"]],
        ["implement-prompt", ["init", dir, "--amend", "--implement-prompt", "do something"]],
        ["implement-file", ["amend", dir, "--phases", "m", "--implement-file", "plan.md"]],
        ["implement-prompt", ["run", dir, "--implement-prompt", "do something"]],
      ] as const) {
        const refused = await runCli([...args])
        expect(refused.code).toBe(1)
        expect(refused.err).toContain(
          `--${flag} is retired: plan tasks with opencode-auto plan <dir> -p <text> | --file <path> (after plan establishes the round and its setup is committed)`,
        )
      }
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
      expect(prompt.err).toBe("--prompt is retired: init no longer writes the project brief: edit .opencode/auto/brief.md (the stub is there); planning input is plan -p\n")
      const flag = await runCli(["init", dir, "--amend"])
      expect(flag.code).toBe(1)
      expect(flag.err).toBe("--amend is retired: init is the stateless full overwrite; to change individual keys use opencode-auto amend <dir> --<key> <value>\n")
      // plan's -p parses as usual (the planning input)
      expect((await runCli(["plan", dir, "-p", "text", "--file", "f.md"])).err).toContain("-p/--prompt and --file are mutually exclusive")
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("init writes the config layer only (fresh and overwrite) and prints the plan-pointing closing line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir])
      expect(init.code).toBe(0)
      expect(init.out).toContain(`next: opencode-auto plan ${dir} (establishes round R-01 and stops at the round-start gate)`)
      // The config layer only: nothing lands under docs/ (no round directory,
      // no round.md stub — round artifacts are all plan's), the brief stub is
      // written
      expect(await stat(join(dir, "docs")).catch(() => undefined)).toBeUndefined()
      expect(await stat(join(dir, "docs/R-01")).catch(() => undefined)).toBeUndefined()
      expect(await Bun.file(join(dir, "docs/R-01/round.md")).exists()).toBe(false)
      expect(await Bun.file(join(dir, "docs/R-01/AGENTS.md.bak")).exists()).toBe(false)
      expect(await Bun.file(join(dir, ".opencode/auto/brief.md")).exists()).toBe(true)
      // An overwrite init (no round established): the same closing line, still
      // no round established
      await commitFixture(dir)
      const overwrite = await runCli(["init", dir, "--phases", "amt"])
      expect(overwrite.code).toBe(0)
      expect(overwrite.out).toContain(`next: opencode-auto plan ${dir} (establishes round R-01 and stops at the round-start gate)`)
      expect(await stat(join(dir, "docs")).catch(() => undefined)).toBeUndefined()
      // Once plan has established the round, an overwrite init's closing line
      // is the plain plan pointer (no longer claiming to establish R-01)
      expect((await runCli(["plan", dir])).code).toBe(0)
      await commitFixture(dir)
      const again = await runCli(["init", dir])
      expect(again.code).toBe(0)
      expect(again.out).toContain(`next: opencode-auto plan ${dir}`)
      expect(again.out).not.toContain("establishes round")
      // The existing round survives untouched
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [ ] P01 analysis\n- [ ] P02 implement\n- [ ] P03 test\n")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: phased flow P2 (round directories / empty templates / phase lines / ledger preflight)", () => {
  test("init --phases amt writes the config layer only; plan establishes R-01 at round start (phase index + phase directories, no PLAN.md); status prints the phase tree", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--phases", "amt"])
      expect(init.code).toBe(0)
      // init establishes no round (plans/0053 D31): docs/ does not exist, the
      // closing line points at plan
      expect(await stat(join(dir, "docs")).catch(() => undefined)).toBeUndefined()
      expect(init.out).toContain(`next: opencode-auto plan ${dir} (establishes round R-01 and stops at the round-start gate)`)
      const made = await runCli(["plan", dir])
      expect(made.code).toBe(0)
      expect(made.out).toContain("✓ round R-01 established: P01-analysis, P02-implement, P03-test")
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
      expect((await runCli(["plan", dir])).code).toBe(0)
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [ ] P01 implement\n")
      expect(await Bun.file(join(dir, "docs/R-01/P01-implement/todo.md")).exists()).toBe(true)
      // The unstarted implicit phase directory is still there (no tasks, no
      // done): init --phases am is allowed (a compatible value), but the index
      // is never rewritten — the difference surfaces as a drift for plan to
      // handle (D31/D34)
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

  test("run prints the phase progress line; an invalid phase index is an environment error with exit 1 (before the server starts)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "amt"])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      await commitFixture(dir)
      const index = await Bun.file(join(dir, "docs/R-01/phases.md")).text()
      // An invalid index line → preflight exits 1, the message pointing a
      // person at the fix
      await Bun.write(join(dir, "docs/R-01/phases.md"), "- [ ] P01 nonsense\n")
      await commitFixture(dir)
      const broken = await runCli(["run", dir])
      expect(broken.code).toBe(1)
      expect(broken.out).toContain("phase flow blocked")
      expect(broken.out).toContain("docs/R-01/phases.md")
      // A phase directory's state file missing (neither) → the same
      // environment error
      await Bun.write(join(dir, "docs/R-01/phases.md"), index)
      await rm(join(dir, "docs/R-01/P03-test/todo.md"))
      await commitFixture(dir)
      const missing = await runCli(["run", dir])
      expect(missing.code).toBe(1)
      expect(missing.out).toContain("P03-test/ has neither todo.md nor done.md")
      // A valid index passes preflight; the phase progress line prints after
      // the config summary (deleting the agent contract file makes run exit
      // before the server starts — only the banner is asserted)
      await Bun.write(join(dir, "docs/R-01/P03-test/todo.md"), "# R-01.P03: test\n")
      await completeLetters(dir, ["a"])
      await rm(join(dir, ".opencode/agent/auto.md"))
      await commitFixture(dir)
      const banner = await runCli(["run", dir])
      expect(banner.out).toContain("phases: P01-analysis✓ P02-implement▶ P03-test")
      expect(banner.out).toContain("agent contract file missing")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("status only notes an invalid ledger without blocking; phases = m prints no phase progress line (the phase tree prints as usual)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "amt"])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      await Bun.write(join(dir, "docs/R-01/phases.md"), "an arbitrary line\n")
      const status = await runCli(["status", dir])
      expect(status.code).toBe(0)
      expect(status.out).toContain("⚠ phase index docs/R-01/phases.md is invalid")
      // A phases = m project prints no phase line (the default single run, no
      // phase semantics)
      const plain = await mkdtemp(join(tmpdir(), "auto-cli-"))
      try {
        expect((await runCli(["init", plain])).code).toBe(0)
        expect((await runCli(["plan", plain])).code).toBe(0)
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
})

// `continue` retired (auto-core plans/0053 D33): plan owns the rounds — its
// prelude runs the round-close checks and opens the next round once the
// current one is complete — so the dedicated subcommand is a usage error. The
// notice is the one answer whatever follows the command; the routes it used
// to serve (the previous round's completeness re-check, the round-close gate,
// establishing the next round) are plan's, covered by the plan describe.
describe("CLI: continue retired (auto-core plans/0053 D33)", () => {
  const NOTICE =
    "continue is retired: once the round is complete, fill in ## Close of docs/R-NN/round.md, commit, and run opencode-auto plan <dir> — it runs the round-close checks and opens the next round\n"

  test("--continue is not an option: appearing on init/run/plan points at plan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const init = await runCli(["init", dir, "--continue"])
      expect(init.code).toBe(1)
      expect(init.err).toContain("--continue is not an option")
      expect(init.err).toContain("run opencode-auto plan <dir> (it runs the round-close checks and opens the next round)")
      expect(init.err).not.toContain("continue is retired")
      const run = await runCli(["run", dir, "--continue"])
      expect(run.code).toBe(1)
      expect(run.err).toContain("--continue is not an option")
      expect(run.err).toContain("run opencode-auto plan <dir> (it runs the round-close checks and opens the next round)")
      // plan shares run's option machinery (refuseFrozenFlags), so its
      // --continue message names plan the same way.
      const plan = await runCli(["plan", dir, "--continue"])
      expect(plan.code).toBe(1)
      expect(plan.err).toContain("--continue is not an option")
      expect(plan.err).toContain("run opencode-auto plan <dir> (it runs the round-close checks and opens the next round)")
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

  test("an initialized project gets the retirement message too; plan's route for opening the next round is unchanged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "am"])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      // Even with the previous round complete (where continue's old semantics
      // would have applied), the retirement outranks every behavioral check
      await completeLetters(dir, ["a", "m"])
      await fillClose(dir)
      const cont = await runCli(["continue", dir])
      expect(cont.code).toBe(1)
      expect(cont.err).toBe(NOTICE)
      // plan still opens the next round as usual (the retirement took the
      // subcommand, not the round capability)
      const opened = await runCli(["plan", dir])
      expect(opened.code).toBe(0)
      expect(opened.out).toContain("✓ round R-02 established: P01-analysis, P02-implement")
      // run's startup banner carries the round annotation on the phase
      // progress line (deleting the agent contract file makes run exit before
      // the server)
      await rm(join(dir, ".opencode/agent/auto.md"))
      const banner = await runCli(["run", dir])
      expect(banner.out).toContain("phases (round 2): P01-analysis▶ P02-implement")
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

describe("CLI: amend (plans/0052 D25)", () => {
  async function readConfig(dir: string) {
    return JSON.parse(await Bun.file(join(dir, ".opencode/auto/config.json")).text())
  }

  test("refusals: no config.json, no key, and every non-config option", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const fresh = await runCli(["amend", dir, "--phases", "am"])
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
        [["-p", "intent"], "-p/--prompt is not an amend option: the brief is not config — edit .opencode/auto/brief.md directly"],
        [["--implement-prompt", "plan the work"], "--implement-prompt is retired: plan tasks with opencode-auto plan <dir>"],
        [["-f", "--phases", "am"], "-f/--force is not an amend option"],
        // The --amend flag is retired everywhere (init no longer takes it, so
        // no command does)
        [["--amend", "--phases", "am"], "--amend is retired: init is the stateless full overwrite; to change individual keys use opencode-auto amend <dir> --<key> <value>"],
        [["--server", "http://x", "--phases", "am"], "--server is not an amend option: amend takes only config flags (-m/--mode, --agent,"],
        [["--max-sessions", "1", "--phases", "am"], "--max-sessions is not an amend option"],
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

  test("changes the named keys only, re-renders the contract and the AGENTS.md block, leaves the rounds alone (D32)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--context-limit", "32", "--phases", "am", "--parallel", "low", "--agent", "claude"])).code).toBe(0)
      // plan establishes the current round; amend writes only the config
      // layer and no longer re-syncs the phase tail
      expect((await runCli(["plan", dir])).code).toBe(0)
      await rm(join(dir, "opencode.json"))
      await rm(join(dir, ".opencode/auto/brief.md"))
      const amended = await runCli(["amend", dir, "--test-by-driver", "--phases", "amt", "--parallel", "none", "--agent", "opencode"])
      expect(amended.code).toBe(0)
      expect(amended.out).toContain("✓ amended (--agent --test-by-driver --phases --parallel); the other keys are unchanged")
      const config = await readConfig(dir)
      expect(config).toMatchObject({ contextLimit: 32, phases: "amt", testByDriver: true })
      expect(config).not.toHaveProperty("parallel")
      expect(config).not.toHaveProperty("agent")
      expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).text()).toBe(renderText(await Bun.file(templateAgent).text(), { testByDriver: true }))
      expect(await Bun.file(join(dir, "AGENTS.md")).text()).toContain("tmp/test.sh")
      // the round step is gone (plans/0053 D32): the new value's extra phase is
      // NOT created — the index keeps "am" and the difference is a drift for
      // plan to reconcile
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
      expect((await runCli(["plan", dir])).code).toBe(0)
      await completeLetters(dir, ["a"])
      const config = await readConfig(dir)
      for (const [args, message] of [
        [["--subtask", "sometimes"], "--subtask takes off|auto|true|ondemand"],
        [["--handover-test"], "--handover-test requires --test-by-driver"],
        [["-m", "nope"], "--mode must be a registered mode"],
        [["--phases", "dm"], 'phases "dm" would drop the completed phase docs/R-01/P01-analysis/ from docs/R-01/phases.md'],
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
      await rm(join(dir, ".opencode/agent/auto.md"))
      // a dirty tree: the plain fix would refuse here (the worktree gate)
      await Bun.write(join(dir, "uncommitted.txt"), "dirty\n")
      const dry = await runCli(["fix", dir, "--dryrun"])
      expect(dry.code).toBe(1)
      expect(dry.out).toContain("config-layer findings in")
      expect(dry.out).toContain("  fix: .opencode/agent/auto.md: missing → write it from the template")
      expect(dry.out).toContain(`dryrun: nothing was changed; apply the 1 fixable finding(s) with opencode-auto fix ${dir}`)
      expect(dry.err).not.toContain("requires a clean worktree")
      // nothing was written: the contract stays missing, the config and the
      // dirty file are untouched, and the tree is what it was
      expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).exists()).toBe(false)
      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).text()).toBe(configBefore)
      expect(await Bun.file(join(dir, "uncommitted.txt")).text()).toBe("dirty\n")
      // --dryrun=false is the plain fix (with -f applying it); the write then happens
      const applied = await runCli(["fix", dir, "--dryrun=false", "-f"])
      expect(applied.code).toBe(0)
      expect(applied.out).toContain("fixed: .opencode/agent/auto.md: write it from the template")
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
      await rm(join(dir, ".opencode/agent/auto.md"))
      const dry = await runCli(["fix", dir, "--dryrun"])
      expect(dry.code).toBe(1)
      expect(dry.out).toContain("config-layer findings in")
      expect(dry.out).toContain("  manual: .opencode/auto/config.json: handoverTest requires testByDriver: true")
      expect(dry.out).toContain("  skipped: the agent contract, AGENTS.md block, .gitignore, opencode.json and brief checks (.opencode/auto/config.json does not load)")
      expect(dry.out).toContain("dryrun: nothing was changed; the finding(s) above need a person")
      expect(dry.err).toContain("1 finding(s) need a person")
      // nothing was written: the config is byte-identical, the contract stays missing
      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).text()).toBe(stored)
      expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).exists()).toBe(false)
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
      await rm(join(dir, ".opencode/agent/auto.md"))
      // The person's hand edit commits before fix (fix's own clean-tree gate
      // is git-bound since init bootstraps the repository)
      await commitFixture(dir)
      const fix = await runCli(["fix", dir])
      expect(fix.code).toBe(0)
      expect(fix.out).toContain("  fix: .opencode/auto/config.json: commit: false is retired")
      expect(fix.out).toContain("fixed: .opencode/auto/config.json: move its value into .opencode/auto/brief.md under ## Target, then drop the key")
      expect(fix.out).toContain("verifyIdle was renamed to idleTime, which is also set → drop the key")
      expect(fix.out).toContain("fixed: .opencode/agent/auto.md: write it from the template")
      expect(fix.out).toContain("✓ config layer repaired")
      // every key no rule names survives; the retired commit key is gone
      expect(await readConfig(dir)).toEqual(kept)
      const brief = await Bun.file(join(dir, ".opencode/auto/brief.md")).text()
      expect(brief).toContain("`legacy`")
      expect(brief).toContain("`app`")
      expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).exists()).toBe(true)
      expect((await runCli(["fix", dir])).out).toContain("✓ nothing to fix")
      // --server points at a closed port: no local opencode service needed
      // (the repaired config and contract all load, failing fast only at the
      // connect), proving run no longer refuses over the retired keys.
      expect((await runCli(["run", dir, "--dryrun", "--server", "http://127.0.0.1:1"])).err).not.toContain("retired")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("manual findings exit 1 after the fixable ones are applied; artifact checks wait for a loadable config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ ...CONFIG_DEFAULTS, verify: true, handoverTest: true }, null, 2) + "\n")
      await rm(join(dir, ".opencode/agent/auto.md"))
      await commitFixture(dir)
      const fix = await runCli(["fix", dir])
      expect(fix.code).toBe(1)
      expect(fix.out).toContain("  manual: .opencode/auto/config.json: handoverTest requires testByDriver: true")
      expect(fix.out).toContain("  skipped: the agent contract, AGENTS.md block, .gitignore, opencode.json and brief checks (.opencode/auto/config.json does not load)")
      expect(fix.err).toContain("1 finding(s) need a person")
      expect(await readConfig(dir)).not.toHaveProperty("verify")
      expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // auto-core plans/0055 §4.1: the model registry's project layer is
  // local-only; a project initialized before init ignored it lacks the entry.
  test("an older project: run refuses a project layer git does not ignore and names fix; fix adds the entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await Bun.spawn(["git", "-C", dir, "init", "-q"]).exited)).toBe(0)
      expect((await runCli(["init", dir])).code).toBe(0)
      const gitignore = join(dir, ".gitignore")
      const older = (await Bun.file(gitignore).text()).replace("/.opencode/auto/models.json\n", "")
      await Bun.write(gitignore, older)
      // The registry declares both tier lists on its one model: since
      // selection wires the tiers into every dispatch, a needed tier with no
      // candidate is a run-start refusal (auto-core plans/0055 §6.3), and
      // this fixture wants the run to pass the registry checks.
      await Bun.write(
        join(dir, ".opencode/auto/models.json"),
        JSON.stringify({ models: { glm: { agent: "opencode", model: "zhipuai/glm-4.6" } }, tiers: { deep: ["glm"], simple: ["glm"] } }),
      )
      // --server points at a closed port: the run needs no local opencode and
      // stops at the connection once preflight passes.
      const run = () => runCli(["run", dir, "--dryrun", "--server", "http://127.0.0.1:1"])
      const refused = await run()
      expect(refused.code).toBe(1)
      expect(refused.out).toContain(
        `model registry, project layer .opencode/auto/models.json: git does not ignore it, so the unified commit would commit it; run opencode-auto fix ${dir} to add its .gitignore entry, then re-run`,
      )
      const fix = await runCli(["fix", dir, "-f"])
      expect(fix.code).toBe(0)
      expect(fix.out).toContain("  fix: .gitignore: lacks the /.opencode/auto/models.json entry (the model registry's project layer is local-only) → append the entry")
      expect(await Bun.file(gitignore).text()).toBe(`${older}/.opencode/auto/models.json\n`)
      expect((await runCli(["fix", dir])).out).toContain("✓ nothing to fix")
      // After the entry exists the run proceeds past the refusal: the routing
      // block prints, and the lazily started host (the implied opencode
      // profile) reaches the closed --server port — the agent pool starts no
      // host at run start, so the connection stop happens at the first
      // dispatch, with the adapter's own message.
      const after = await run()
      expect(after.out).not.toContain("git does not ignore it")
      expect(after.out).toContain("◇ agent profile opencode (opencode, implied)")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the worktree gate refuses a dirty tree before any write; -f skips it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await Bun.spawn(["git", "-C", dir, "init", "-q"]).exited)).toBe(0)
      expect((await runCli(["init", dir])).code).toBe(0)
      await rm(join(dir, ".opencode/agent/auto.md"))
      const dirty = await runCli(["fix", dir])
      expect(dirty.code).toBe(1)
      expect(dirty.err).toContain("fix will delete or modify files on disk and requires a clean worktree")
      expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).exists()).toBe(false)
      expect((await runCli(["fix", dir, "-f"])).code).toBe(0)
      expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).exists()).toBe(true)
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

  test("init, amend, fix, reset and run refuse while another process holds it; status shows it first", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      const config = await Bun.file(join(dir, ".opencode/auto/config.json")).text()
      await plantLock(dir)
      const refusal = `⏸ another opencode-auto process holds the run lock of ${dir}: plan, pid ${process.pid} on ${hostname()}, since 2026-09-23T10:00:00.000Z.`
      for (const args of [["init", dir], ["init", dir, "-f"], ["amend", dir, "--context-limit", "64"], ["fix", dir, "-f"], ["reset", dir, "-f"]]) {
        const refused = await runCli(args)
        expect(refused.code).toBe(1)
        expect(refused.err).toContain(refusal)
      }
      const run = await runCli(["run", dir])
      expect(run.code).toBe(1)
      expect(run.out).toContain(refusal)
      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).text()).toBe(config)
      const status = await runCli(["status", dir])
      expect(status.code).toBe(0)
      expect(status.out.split("\n")[0]).toBe(`▶ plan in progress (pid ${process.pid} on ${hostname()}, since 2026-09-23T10:00:00.000Z)`)
      expect(status.out).toContain("⚙ project config")
      // fix --dryrun reads and prints only, so it runs beside the live lock
      // (the one write-side gate it skips); the plain fix stays refused above
      const dry = await runCli(["fix", dir, "--dryrun"])
      expect(dry.code).toBe(0)
      expect(dry.out).toContain("✓ nothing to fix")
      expect(dry.err).not.toContain("run lock")
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

// plan (auto-core plans/0053 D14–D15): every route the prelude settles without
// an agent — the refusals, establishing a round, the round-close gate, the
// notices — plus the argument checks. The loop paths (planning itself, the
// stop after it) need an agent and live in the A7 loop harness / the
// OPENCODE_AUTO_E2E block.
describe("CLI: models (auto-core plans/0055 §9)", () => {
  // A registry without windows, so the lines do not depend on the clock.
  const REGISTRY = {
    agents: {
      opencode: { adapter: "opencode", env: { HTTPS_PROXY: "http://127.0.0.1:7890" } },
      claude: { adapter: "claude", env: { HTTPS_PROXY: "{env:CLAUDE_PROXY}" } },
    },
    models: {
      opus: { agent: "claude", model: "opus" },
      k3: { agent: "opencode", model: "moonshotai/kimi-k3-256k", wider: ["moonshotai/kimi-k3"], keys: ["{env:MOONSHOT_KEY_A}", "{env:MOONSHOT_KEY_B}"] },
      k2: { agent: "opencode", model: "moonshotai/kimi-k2", context: 128 },
      free: { agent: "opencode", model: "opencode/some-free-model" },
    },
    tiers: { deep: ["opus", "k3"], simple: ["k2"] },
    routes: { acceptance: "deep" },
    classifier: ["free"],
  }
  const SECRETS = { CLAUDE_PROXY: "http://user:secret-proxy@10.0.0.1:3128", MOONSHOT_KEY_A: "sk-secret-a", MOONSHOT_KEY_B: "sk-secret-b" }

  test("without a layer: the implicit registry's table, exit 0, and nothing is written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const none = await runCli(["models", dir])
      expect(none.code).toBe(0)
      const lines = none.out.split("\n")
      // No layer file exists: the command names the implicit registry the
      // env switches synthesize (0061 F2) and shows its table.
      expect(lines[0]).toBe(
        `model registry: implicit — no layer file (${join(EMPTY_CONFIG_HOME, "opencode-auto", "models.json")} nor .opencode/auto/models.json); a run synthesizes it from OPENCODE_AUTO_MODEL / OPENCODE_AUTO_MODEL_FALLBACK`,
      )
      expect(lines).toContain("  opencode  [implied]  adapter opencode")
      expect(lines).toContain("  default  [implied]  agent opencode (opencode) · the agent's default model")
      expect(none.err).toBe("")
      const missing = join(dir, "missing.json")
      expect((await runCli(["models", dir], { OPENCODE_AUTO_MODELS: missing })).out).toContain(`no layer file (${missing} nor`)
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a registry through OPENCODE_AUTO_MODELS: the table with tiers, candidates, layers, steps and env names, never values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const file = join(dir, "operator.json")
      await Bun.write(file, JSON.stringify(REGISTRY))
      await mkdir(join(dir, ".opencode", "auto"), { recursive: true })
      await Bun.write(join(dir, ".opencode/auto/models.json"), JSON.stringify({ models: { k2: { agent: "opencode", model: "moonshotai/kimi-k2-turbo-preview" } } }))
      // It takes no run lock: a live one does not stop it.
      await Bun.write(join(dir, RUN_LOCK_FILE), JSON.stringify({ pid: process.pid, host: hostname(), command: "run", started: "2026-09-23T10:00:00.000Z" }))
      const shown = await runCli(["models", dir], { OPENCODE_AUTO_MODELS: file, ...SECRETS })
      expect(shown.err).toBe("")
      expect(shown.code).toBe(0)
      const lines = shown.out.split("\n")
      expect(lines[0]).toBe(`model registry: operator layer ${file} · project layer .opencode/auto/models.json`)
      expect(lines).toContain("agent filter: none: models on every agent profile are candidates")
      expect(lines).toContain("project cap: 64k context · default agent: opencode")
      expect(lines).toContain("  opencode  [operator]  adapter opencode · env HTTPS_PROXY (literal)")
      expect(lines).toContain("  claude    [operator]  adapter claude · env HTTPS_PROXY (env CLAUDE_PROXY)")
      expect(lines).toContain("  k3    [operator]  agent opencode (opencode) · steps moonshotai/kimi-k3-256k → moonshotai/kimi-k3 · ring moonshotai (2 keys)")
      expect(lines).toContain("  k2    [project]  agent opencode (opencode) · model moonshotai/kimi-k2-turbo-preview · ring moonshotai (2 keys)")
      expect(lines).toContain("  moonshotai  2 keys: MOONSHOT_KEY_A, MOONSHOT_KEY_B · models k3, k2")
      expect(lines).toContain("classifier: [operator]  free")
      expect(lines).toContain("  implement (m) · builtin · execute tier simple")
      expect(lines).toContain("    decompose, phase-plan, implement-scan: deep → opus ✓ · k3 ✓")
      expect(lines).toContain("    whole, subtask, wrapup, phase-handover, knowledge, prior-knowledge, number-recovery, bypass: simple → k2 ✓ | opus ✓ · k3 ✓")
      expect(lines).toContain("    decompose, whole, subtask, wrapup, phase-plan, phase-handover, knowledge, prior-knowledge, implement-scan, number-recovery, bypass: deep · route acceptance [operator] → opus ✓ · k3 ✓")
      for (const value of [...Object.values(SECRETS), "127.0.0.1:7890"]) expect(shown.out).not.toContain(value)
      expect(await Bun.file(join(dir, RUN_LOCK_FILE)).exists()).toBe(true)

      // The agent filter and the override come from the environment.
      const filtered = await runCli(["models", dir], { OPENCODE_AUTO_MODELS: file, ...SECRETS, OPENCODE_AUTO_AGENT: "claude", OPENCODE_AUTO_MODEL: "bypass=zhipuai/glm-4.6" })
      expect(filtered.code).toBe(0)
      expect(filtered.out).toContain("agent filter: claude (OPENCODE_AUTO_AGENT): only models on claude profiles are candidates")
      expect(filtered.out).toContain("    decompose, phase-plan, implement-scan: deep → opus ✓ · k3 ✗")
      expect(filtered.out).toContain("✗ not usable now: filtered out by the agent filter claude (OPENCODE_AUTO_AGENT)")
      expect(filtered.out).toContain("    bypass: override OPENCODE_AUTO_MODEL → zhipuai/glm-4.6 ✗ (filtered out by the agent filter claude (OPENCODE_AUTO_AGENT); a raw provider/model on the default agent opencode, without window, ring or steps)")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a bad registry: the problems and exit 1; broken references print the table first", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const file = join(dir, "operator.json")
      await Bun.write(file, JSON.stringify({ ...REGISTRY, models: { ...REGISTRY.models, k2: { agent: "opencode", model: "moonshotai/kimi-k2", aviod: [] } } }))
      const bad = await runCli(["models", dir], { OPENCODE_AUTO_MODELS: file, ...SECRETS })
      expect(bad.code).toBe(1)
      expect(bad.out).toBe(
        [
          `⚠ model registry, operator layer ${file}: models.k2: unknown field "aviod" (known: agent, model, wider, variant, context, avoid, only, keys, retry)`,
          "1 problem(s): run and plan refuse to start until they are fixed (exit 1)",
          "",
        ].join("\n"),
      )
      await Bun.write(file, JSON.stringify(REGISTRY))
      const broken = await runCli(["models", dir], { OPENCODE_AUTO_MODELS: file, MOONSHOT_KEY_A: "sk-secret-a" })
      expect(broken.code).toBe(1)
      expect(broken.out).toContain("routing per phase type and role")
      expect(broken.out).toContain(`⚠ model registry, operator layer ${file}: agents.claude.env.HTTPS_PROXY: env CLAUDE_PROXY is not set`)
      expect(broken.out).toContain(`⚠ model registry, operator layer ${file}: models.k3.keys[1]: env MOONSHOT_KEY_B is not set`)
      expect(broken.out.trimEnd().split("\n").at(-1)).toBe("2 problem(s): run and plan refuse to start until they are fixed (exit 1)")
      expect(broken.out).not.toContain("sk-secret-a")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("models takes only --probe; without a registry the probe is a no-op line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const other = await runCli(["models", dir, "--verbose"])
      expect(other.code).toBe(1)
      expect(other.err).toContain("unknown option --verbose: models takes only --probe (a directory argument and no other options)")
      // --probe without a registry probes nothing and keeps exit 0.
      const probe = await runCli(["models", dir, "--probe"])
      expect(probe.code).toBe(0)
      expect(probe.out).toContain("probe: no model registry, nothing to probe")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("CLI: plan (auto-core plans/0053 D14–D15)", () => {
  test("argument refusals: the input flags, run-only and config options, the unconfigured directory; nothing is written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const refusals: [string[], string][] = [
        [["plan", dir, "-p", "text", "--file", "f.md"], "-p/--prompt and --file are mutually exclusive"],
        [["plan", dir, "-p", "  "], "-p/--prompt requires non-empty text"],
        [["plan", dir, "--file"], "--file requires a path"],
        [["plan", dir, "--file", join(dir, "nope.md")], "no such file"],
        [["plan", dir, "--phases", "am"], "--phases was frozen by init"],
        [["plan", dir, "--dryrun"], "--dryrun is a run option"],
        [["plan", dir, "--wait-between", "2"], "--wait-between is a run option"],
        [["plan", dir, "--max-sessions", "1"], "--max-sessions is a run option"],
        [["plan", dir, "-f"], "-f/--force is an init/reset/fix option"],
        // --append is plan's alone (D23): no input is a usage error; every
        // other command points at plan.
        [["plan", dir, "--append"], "--append requires a planning input"],
        [["run", dir, "--append"], "--append is a plan option"],
        [["init", dir, "--append"], "--append is a plan option"],
        [["close", "T-001", dir, "--append"], "--append is a plan option"],
        [["fix", dir, "--append"], "--append is a plan option"],
        // No config.json: refuse to plan rather than establish a round with
        // the defaults
        [["plan", dir], `nothing to plan: ${dir} has no .opencode/auto/config.json; run opencode-auto init`],
        [["run", dir, "-p", "text"], "-p/--prompt is a plan option: run takes no planning input"],
        [["init", dir, "--file", "f.md"], "--file is a plan option"],
      ]
      for (const [args, notice] of refusals) {
        const refused = await runCli(args)
        expect(refused.code).toBe(1)
        expect(refused.err).toContain(notice)
      }
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("establishes a missing round (m) with the round-start gate; input on it is refused before any write; re-runs show the empty-index notice", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      // init writes the config layer only, so no round exists yet
      // (config-only init, plans/0053 D31)
      // D5: input on the round-establishment route is refused first, before
      // any write
      const refused = await runCli(["plan", dir, "-p", "input"])
      expect(refused.code).toBe(1)
      expect(refused.err).toContain(`round R-01 is not established yet: run opencode-auto plan ${dir} without input to establish it, commit the setup, then pass the input.`)
      expect(await stat(join(dir, "docs")).catch(() => undefined)).toBeUndefined()
      const made = await runCli(["plan", dir])
      expect(made.code).toBe(0)
      expect(made.out).toContain("✓ round R-01 established: single phase P01-implement")
      expect(made.out).toContain(`next (round-start gate): review the setup and commit it; then list tasks in docs/R-01/P01-implement/tasks.md by hand, or run: opencode-auto plan ${dir} -p <text> | --file <path>`)
      expect(await Bun.file(join(dir, "docs/R-01/P01-implement/todo.md")).exists()).toBe(true)
      // Run again: task index empty, no input → the notice to list tasks by
      // hand or plan with input (D15)
      const again = await runCli(["plan", dir])
      expect(again.code).toBe(0)
      expect(again.out).toContain(`ℹ no tasks listed in docs/R-01/P01-implement/tasks.md yet: list them there by hand (docs/T-NNN/todo.md per task), or run: opencode-auto plan ${dir} -p <text> | --file <path>`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("m mode with tasks listed: the run notice without input; --append needs an input, and a mid-pipeline task stops the append (D26)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      await listTasks(dir, "docs/R-01/P01-implement", "R-01.P01", [["T-001", "task", "body"]])
      const notice = await runCli(["plan", dir])
      expect(notice.code).toBe(0)
      expect(notice.out).toContain(
        `ℹ docs/R-01/P01-implement/tasks.md lists 1 task(s) (1 pending); next: opencode-auto run ${dir}, ` +
          `or add tasks with opencode-auto plan ${dir} -p <text> | --file <path>`,
      )
      // --append rides a planning input (D23): no input is a usage error.
      const bare = await runCli(["plan", dir, "--append"])
      expect(bare.code).toBe(1)
      expect(bare.err).toContain("--append requires a planning input: pass -p <text> | --file <path>")
      // Input over an index that already lists tasks means append; with T-001
      // mid-pipeline (a resume point exists), the D26 guard refuses before any
      // server starts.
      await Bun.write(join(dir, ".auto/progress.json"), JSON.stringify({ task: "T-001", at: 1, active: true }))
      for (const args of [["plan", dir, "-p", "add a bit more"], ["plan", dir, "--append", "-p", "add a bit more"]]) {
        const guarded = await runCli(args)
        expect(guarded.code).toBe(1)
        expect(guarded.err).toContain("T-001 is mid-pipeline (its resume point is in .auto/progress.json); finish it with run, or close it, before appending")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("phased, execute route: the planned notice without input; input is a mistake (D7)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "am"])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      await completeLetters(dir, ["a"])
      await listTasks(dir, "docs/R-01/P02-implement", "R-01.P02", [["T-001", "task", "body"]])
      const notice = await runCli(["plan", dir])
      expect(notice.code).toBe(0)
      expect(notice.out).toContain(
        `ℹ R-01.P02 implement is planned (1 of 1 tasks pending); next: opencode-auto run ${dir} ` +
          `— or add tasks with opencode-auto plan ${dir} --append -p <text>, or close units with opencode-auto close <ref>`,
      )
      const withInput = await runCli(["plan", dir, "-p", "input"])
      expect(withInput.code).toBe(1)
      expect(withInput.err).toContain(
        `R-01.P02 implement already lists tasks, so the planning input would not be used; ` +
          `add tasks with opencode-auto plan ${dir} --append -p <text> | --file <path>`,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a complete round: the round-close gate fails with exit 2 (input refused too); passing opens R-02 with the G1 lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir, "--phases", "am"])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      await completeLetters(dir, ["a", "m"])
      // Round complete: G8 does not pass (`## Close` unfilled) → exit code 2
      // (D4; in the continue era it was 1)
      const fail = await runCli(["plan", dir])
      expect(fail.code).toBe(2)
      expect(fail.err).toContain("round R-01 does not pass its round-close checks, so round R-02 cannot open yet")
      expect(fail.err).toContain("`## Close` is empty")
      expect(fail.err).toContain(`then re-run: opencode-auto plan ${dir}`)
      expect(await stat(join(dir, "docs/R-02")).catch(() => undefined)).toBeUndefined()
      // Input on the completion route is likewise refused before any write
      const withInput = await runCli(["plan", dir, "-p", "input"])
      expect(withInput.code).toBe(1)
      expect(withInput.err).toContain("round R-01 is complete and round R-02 is not established yet")
      await fillClose(dir)
      const pass = await runCli(["plan", dir])
      expect(pass.code).toBe(0)
      expect(pass.out).toContain("✓ round R-02 established: P01-analysis, P02-implement")
      expect(pass.out).toContain(`then run: opencode-auto plan ${dir} to plan R-02.P01 analysis (or run to plan and execute)`)
      expect(await Bun.file(join(dir, "docs/R-02/phases.md")).text()).toContain("- [ ] P01 analysis")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("plan refuses while another process holds the run lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      await Bun.write(join(dir, ".auto/run.lock"), JSON.stringify({ pid: process.pid, host: hostname(), command: "run", started: "2026-09-23T10:00:00.000Z" }))
      const refused = await runCli(["plan", dir])
      expect(refused.code).toBe(1)
      expect(refused.err).toContain(`⏸ another opencode-auto process holds the run lock of ${dir}: run, pid ${process.pid} on ${hostname()}`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// The phase-index drift at CLI level (auto-core plans/0053 D34): a hand-edited
// docs/R-NN/phases.md whose unstarted tail disagrees with config `phases`. run
// never re-syncs (lifecycle is plan's — a silent re-sync would start work on a
// phase list nobody reviewed) and exits 1 naming plan; plan re-syncs the tail,
// leaves the change uncommitted like any round setup and stops for review.
// Both stops precede any agent, so no fixture agent is needed.
describe("CLI: the phase-index drift (auto-core plans/0053 D34)", () => {
  test("run exits 1 naming plan on a hand-edited index and writes nothing; plan re-syncs it with its exit-0 line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-drift-"))
    try {
      expect((await runCli(["init", dir, "--phases", "amt"])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      await commitFixture(dir)
      // A person drops the unstarted test phase from the index by hand (its
      // directory stays): the index's unstarted tail no longer matches config.
      const edited = "- [ ] P01 analysis\n- [ ] P02 implement\n"
      await Bun.write(join(dir, "docs/R-01/phases.md"), edited)
      await commitFixture(dir)
      const stopped = await runCli(["run", dir])
      expect(stopped.code).toBe(1)
      expect(stopped.out).toContain(
        `⏸ the phase index of round R-01 (P01-analysis, P02-implement) differs from config phases ` +
          `(P01-analysis, P02-implement, P03-test): run opencode-auto plan ${dir} to re-sync its unstarted phases`,
      )
      // run wrote nothing: the index keeps the hand edit, the phase directory stays.
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toBe(edited)
      expect(await Bun.file(join(dir, "docs/R-01/P03-test/todo.md")).exists()).toBe(true)
      // Input on the drift route is refused before any write (D5): the
      // re-synced tail must be reviewed before anything plans into it.
      const refused = await runCli(["plan", dir, "-p", "input"])
      expect(refused.code).toBe(1)
      expect(refused.err).toContain(
        `the phase index of round R-01 differs from config phases: run opencode-auto plan ${dir} without input to re-sync it, commit the change, then pass the input.`,
      )
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toBe(edited)
      // plan without input re-syncs the tail and stops for review (exit 0),
      // the change left uncommitted like any round setup. The re-synced index
      // is the canonical render again, done ticks preserved.
      const resync = await runCli(["plan", dir])
      expect(resync.code).toBe(0)
      expect(resync.out).toContain(
        `✓ phase index of round R-01 re-synced to config phases (+ P03-test); ` +
          `review docs/R-01/phases.md, commit, then re-run: opencode-auto plan ${dir}`,
      )
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [ ] P01 analysis\n- [ ] P02 implement\n- [ ] P03 test\n")
      expect(await Bun.file(join(dir, "docs/R-01/P03-test/todo.md")).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
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
    expect((await runCli(["plan", dir])).code).toBe(0)
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
        [["close", "T-001", dir, "--reason", "r", "-p", "text"], "-p/--prompt is a plan option"],
        [["close", "T-001", dir, "--reason", "r", "--file", "f.md"], "--file is a plan option"],
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
      expect((await runCli(["plan", dir])).code).toBe(0)
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
      expect(closed.out).toContain("⚠ closed units skip the unit-close reference scan; the whole-tree scan at round close still applies")
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
      expect((await runCli(["plan", dir])).code).toBe(0)
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

// plan --new-task (auto-core plans/0058): add one task the person names with
// no session at all. The shell half validated here: the flag's usage errors
// (plan's alone, the mutual exclusions, the one-line title) and the
// end-to-end add over a git fixture — establish, commit the round setup,
// add — with no agent anywhere in the process.
describe("CLI: plan --new-task (auto-core plans/0058)", () => {
  // An initialized m-mode git fixture whose round setup is committed, so the
  // add starts from a clean tree.
  async function newTaskFixture() {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-nt-"))
    const git = gitOf(dir)
    await git("init")
    expect((await runCli(["init", dir])).code).toBe(0)
    expect((await runCli(["plan", dir])).code).toBe(0)
    await git("add", "-A")
    await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "round setup")
    return { dir, git }
  }

  test("argument errors: plan's alone, the exclusions, the one-line title; nothing is written", async () => {
    const { dir, git } = await newTaskFixture()
    try {
      const refusals: [string[], string][] = [
        // --new-task is plan's alone: every other command points at plan.
        [["run", dir, "--new-task", "a task"], "--new-task is a plan option: run takes no --new-task"],
        [["init", dir, "--new-task", "a task"], "--new-task is a plan option"],
        [["close", "T-001", dir, "--reason", "r", "--new-task", "a task"], "--new-task is a plan option: close takes no --new-task"],
        // The title: non-empty and one line.
        [["plan", dir, "--new-task"], "--new-task requires a one-line task title"],
        [["plan", dir, "--new-task", "  "], "--new-task requires a one-line task title"],
        [["plan", dir, "--new-task", "two\nlines"], "--new-task must be one line"],
        // The exclusions: no planning input rides along, and --append is the
        // session-planned path.
        [["plan", dir, "--new-task", "a task", "-p", "input"], "--new-task and -p | --file are mutually exclusive"],
        [["plan", dir, "--new-task", "a task", "--append"], "--new-task and --append are mutually exclusive"],
      ]
      for (const [args, notice] of refusals) {
        const refused = await runCli(args)
        expect(refused.code, args.join(" ")).toBe(1)
        expect(refused.err, args.join(" ")).toContain(notice)
      }
      expect(await Bun.file(join(dir, P01.dir, "tasks.md")).exists()).toBe(false)
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("m mode end to end: the task lands committed, a second add appends, and the uncommitted round setup is refused first", async () => {
    const { dir, git } = await newTaskFixture()
    try {
      const title = "Harden the retry policy against provider throttling"
      const added = await runCli(["plan", dir, "--new-task", title])
      expect(added.code).toBe(0)
      expect(added.out).toContain(`✓ task T-001 added to docs/R-01/P01-implement/tasks.md (no session: --new-task writes it directly)`)
      expect(added.out).toContain(`next: review it (sharpen the Goal / Scope / Acceptance of docs/T-001/todo.md if needed), then run: opencode-auto run ${dir}`)
      expect(await Bun.file(join(dir, "docs/R-01/P01-implement/tasks.md")).text()).toContain(`- [ ] T-001 ${title}`)
      const doc = await Bun.file(join(dir, "docs/T-001/todo.md")).text()
      expect(doc.startsWith(`# T-001: ${title}\nPhase: R-01.P01\n`)).toBe(true)
      expect(doc).toContain("Added by `plan --new-task`")
      expect((await git("log", "--format=%s")).split("\n")[0]).toBe(`PLAN add T-001 ${title}`)
      expect((await git("status", "--porcelain")).trim()).toBe("")
      // A second known task appends after the first.
      const second = await runCli(["plan", dir, "--new-task", "Second known task"])
      expect(second.code).toBe(0)
      expect((await Bun.file(join(dir, "docs/R-01/P01-implement/tasks.md")).text()).endsWith("- [ ] T-002 Second known task\n")).toBe(true)
      // The round-start gate discipline: on an uncommitted setup the add
      // waits for the human (exit 2, nothing written).
      const dirty = await mkdtemp(join(tmpdir(), "auto-cli-nt-"))
      try {
        const git2 = gitOf(dirty)
        await git2("init")
        expect((await runCli(["init", dirty])).code).toBe(0)
        expect((await runCli(["plan", dirty])).code).toBe(0)
        const refused = await runCli(["plan", dirty, "--new-task", title])
        expect(refused.code).toBe(2)
        expect(refused.err).toContain("⏸ worktree not clean before adding the task")
        expect(await Bun.file(join(dirty, "docs/R-01/P01-implement/tasks.md")).exists()).toBe(false)
      } finally {
        await rm(dirty, { recursive: true, force: true })
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// plan --force-close (auto-core plans/0053 D28): close a unit and continue
// planning in the same process, under one lock. The shell half validated
// here: the argument checks (close's flag set on plan), the refusal contract
// (exit 1, nothing written), and the two deterministic follow-ups — a task
// force-close whose exit code is plan's notice route, and a phase force-close
// skipping into the next phase. The loop-level paths (planning after the
// close, the combined --force-close --append) need an agent and stay with the
// B6 loop-harness / OPENCODE_AUTO_E2E cases.
describe("CLI: plan --force-close (auto-core plans/0053 D28)", () => {
  // An initialized m-mode git fixture with two open tasks, all committed, so
  // a refused force-close leaves a byte-identical tree.
  async function forceCloseFixture() {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-fc-"))
    const git = gitOf(dir)
    await git("init")
    expect((await runCli(["init", dir])).code).toBe(0)
    expect((await runCli(["plan", dir])).code).toBe(0)
    await listTasks(dir, P01.dir, "R-01.P01", [
      ["T-001", "the superseded task", "body"],
      ["T-002", "the implicit dependent", "body"],
    ])
    await git("add", "-A")
    await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")
    return { dir, git }
  }

  test("argument errors: the ref shape, the reason, the change pair, the close-family flags without --force-close, other commands refusing --force-close; nothing is written", async () => {
    const { dir, git } = await forceCloseFixture()
    try {
      const refusals: [string[], string][] = [
        // The ref is a value: missing (the bare flag) or not one of the three
        // canonical shapes is a usage error before anything is read.
        [["plan", dir, "--force-close"], "--force-close requires a unit reference"],
        [["plan", dir, "--force-close", "T-5"], "T-5: not a unit reference"],
        [["plan", dir, "--force-close", "T-001.S01", "--reason", "r"], "T-001.S01: not a unit reference"],
        [["plan", dir, "--force-close", "T-001"], "--force-close requires --reason <text>"],
        [["plan", dir, "--force-close", "T-001", "--reason", "  "], "--reason requires non-empty text"],
        [["plan", dir, "--force-close", "T-001", "--reason", "two\nlines"], "--reason must be one line"],
        [["plan", dir, "--force-close", "T-001", "--reason", "r", "--commit-changes", "--stash-changes"], "--commit-changes and --stash-changes are mutually exclusive"],
        // The close-family flags belong to the close step only: on plan they
        // are meaningless without --force-close.
        [["plan", dir, "--reason", "r"], '--reason is a close option of "plan --force-close <ref> --reason <text>"'],
        [["plan", dir, "--cascade"], "--cascade is a close option of"],
        [["plan", dir, "--stash-changes"], "--stash-changes is a close option of"],
        // --force-close is plan's alone: every other command points at plan
        // (close keeps its positional ref).
        [["run", dir, "--force-close", "T-001", "--reason", "r"], "--force-close is a plan option: run takes no --force-close"],
        [["init", dir, "--force-close", "T-001"], "--force-close is a plan option"],
        [["fix", dir, "--force-close", "T-001"], "--force-close is a plan option"],
        [["close", "T-001", dir, "--reason", "r", "--force-close", "T-002"], "--force-close is a plan option: close takes no --force-close"],
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

  test("a refused close exits 1 with nothing written (the dirty tree), and the lock is released with it", async () => {
    const { dir, git } = await forceCloseFixture()
    try {
      await Bun.write(join(dir, "stray.ts"), "export {}\n")
      const refused = await runCli(["plan", dir, "--force-close", "T-001", "--reason", "superseded"])
      expect(refused.code).toBe(1)
      expect(refused.err).toContain("the worktree has changes beyond the driver's own state files")
      expect(refused.err).toContain("stray.ts")
      // closeUnit refuses before any write: the task untouched, no close
      // commit, the stray file kept.
      expect(await Bun.file(join(dir, taskStatePaths("T-001").pending)).exists()).toBe(true)
      expect(await Bun.file(join(dir, taskStatePaths("T-001").complete)).exists()).toBe(false)
      expect((await git("log", "--oneline")).trim().split("\n")).toHaveLength(1)
      // The single lock plan took is gone with the process (.auto/ was
      // created for it alone and removed empty on release).
      expect(await stat(join(dir, ".auto")).catch(() => undefined)).toBeUndefined()
      expect(await Bun.file(join(dir, "stray.ts")).text()).toBe("export {}\n")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("force-closes a task and continues planning: the close commit lands and the exit code is plan's (the m notice)", async () => {
    const { dir, git } = await forceCloseFixture()
    try {
      const run = await runCli(["plan", dir, "--force-close", "T-001", "--reason", "superseded by a follow-up"])
      expect(run.err).toBe("")
      // Plan's stop (the m-mode notice over the remaining task) is exit 0 —
      // plan's code, not close's.
      expect(run.code).toBe(0)
      // closeUnit's lines print first: the closed task, the implicit
      // dependent, the undo pointer.
      expect(run.out).toContain("✓ closed T-001: superseded by a follow-up")
      expect(run.out).toContain("ℹ T-002 has no Depends: field, so its prerequisite T-001 counts as satisfied; do not assume T-001's deliverables exist")
      expect(run.out).toMatch(/to undo before anything else runs: git revert [0-9a-f]+/)
      // Then plan's own stop: the notice over the listed tasks (1 pending).
      expect(run.out).toContain(
        `ℹ docs/R-01/P01-implement/tasks.md lists 2 task(s) (1 pending); next: opencode-auto run ${dir}, ` +
          `or add tasks with opencode-auto plan ${dir} -p <text> | --file <path>`,
      )
      // The close commit: subject, body and the force-close trailers.
      const message = await git("log", "-1", "--pretty=%B")
      expect(message).toContain("T-001 closed: superseded by a follow-up")
      expect(message).toContain("Units closed:\n- T-001")
      expect(message).toContain("Auto-Task: T-001")
      expect(message).toContain("Auto-Stage: force-close")
      // State: the Closed: field with the rename, the index tick, the other
      // task still pending, and a clean tree (the close commit took it all).
      expect(await Bun.file(join(dir, taskStatePaths("T-001").complete)).text()).toContain("Closed: superseded by a follow-up")
      expect(await Bun.file(join(dir, taskStatePaths("T-001").pending)).exists()).toBe(false)
      expect(await Bun.file(join(dir, P01.dir, "tasks.md")).text()).toContain("- [x] T-001")
      expect(await Bun.file(join(dir, taskStatePaths("T-002").pending)).exists()).toBe(true)
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("force-closes a phase and skips to the next phase: the mechanical handover is written and plan stops on the next phase's notice", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-fc-phase-"))
    const git = gitOf(dir)
    try {
      await git("init")
      expect((await runCli(["init", dir, "--phases", "amt"])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      // P01 done, P02 current with a task to skip over, P03 already planned
      // (its tasks listed by hand), so the follow-up planning stops on the
      // deterministic execute notice naming P03.
      await completeLetters(dir, ["a"])
      await listTasks(dir, "docs/R-01/P02-implement", "R-01.P02", [["T-001", "the skipped task", "body"]])
      await listTasks(dir, "docs/R-01/P03-test", "R-01.P03", [["T-002", "next-phase task", "body"]])
      await git("add", "-A")
      await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")
      const run = await runCli(["plan", dir, "--force-close", "R-01.P02", "--reason", "skipped this round"])
      expect(run.err).toBe("")
      expect(run.code).toBe(0)
      // The phase's open task closes with it, then the phase itself, with
      // the mechanical handover close writes for a closed phase.
      expect(run.out).toContain("✓ closed T-001: skipped this round")
      expect(run.out).toContain("✓ closed R-01.P02 implement: skipped this round")
      expect(run.out).toContain("ℹ mechanical handover written: docs/R-01/P02-implement/handover.md")
      // Plan continues in the same process: the next phase is current now,
      // and its planned state is the notice plan stops on (exit 0, plan's).
      expect(run.out).toContain(
        `ℹ R-01.P03 test is planned (1 of 1 tasks pending); next: opencode-auto run ${dir} ` +
          `— or add tasks with opencode-auto plan ${dir} --append -p <text>, or close units with opencode-auto close <ref>`,
      )
      // Phase state: closed done.md, the four handover sections, the index
      // tick, P03 untouched.
      expect(await Bun.file(join(dir, "docs/R-01/P02-implement/done.md")).text()).toContain("Closed: skipped this round")
      expect(await Bun.file(join(dir, "docs/R-01/P02-implement/todo.md")).exists()).toBe(false)
      const handover = await Bun.file(join(dir, "docs/R-01/P02-implement/handover.md")).text()
      for (const section of ["## Key decisions", "## Constraints and pitfalls", "## Required reading for the next phase", "## Artifact index"]) {
        expect(handover).toContain(section)
      }
      expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [x] P02 implement")
      expect(await Bun.file(join(dir, "docs/R-01/P03-test/todo.md")).exists()).toBe(true)
      // The close commit covers both units; the tree is clean after it.
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

// plan --append end to end (auto-core plans/0053 §8, B6): the leftover CLI
// loop-level flows, driven deterministically over a fake `claude` CLI on PATH
// (test/fixtures/fake-claude.ts; OPENCODE_AUTO_AGENT=claude selects the claude
// adapter, so plan's appending session runs with no provider credentials).
// The agent-driving logic itself is auto-core's loop harness
// (test/append-loop.test.ts); what these cases pin is the shell flow: the
// input commit → append unit commit → appended tasks with the snapshot prefix
// unchanged, the combined --force-close --append (replace a task), and the
// plain phase close (its mechanical handover is closeUnit's, so it needs no
// agent and lives in the close describe).
describe("CLI: plan --append end to end (auto-core plans/0053 D23–D25)", () => {
  // A task document that passes the planning shape checks.
  const doc = (id: string, phase: string) => `# ${id}: task ${id}\nPhase: ${phase}\n\n## Goal\n\ndeliver it.\n\n## Scope\n\nsrc only.\n\n## Acceptance\n\nholds.\n\n<!-- auto: eof -->\n`

  test("plan --append on a phased execute route: input commit → append unit commit → tasks appended, the snapshot prefix unchanged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-append-"))
    const agent = await fakeClaude()
    const git = gitOf(dir)
    try {
      await git("init")
      expect((await runCli(["init", dir, "--phases", "am"])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      // P01 done, P02 current with one pending task (the execute route).
      await completeLetters(dir, ["a"])
      await listTasks(dir, "docs/R-01/P02-implement", "R-01.P02", [["T-001", "the existing task", "body"]])
      await git("add", "-A")
      await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")
      const seededIndex = await Bun.file(join(dir, "docs/R-01/P02-implement/tasks.md")).text()
      const seededDoc = await Bun.file(join(dir, "docs/T-001/todo.md")).text()

      const run = await agent.run(["plan", dir, "--append", "-p", "Add a fix task for the retry policy."])
      expect(run.err).toBe("")
      expect(run.code).toBe(0)
      // The step ran end to end: the input saved on its own commit, the
      // appending session, the summary over the appended task.
      expect(run.out).toContain("✓ planning input saved to docs/R-01/P02-implement/plan-input.md")
      expect(run.out).toContain("▶ starting the task-append session to append to docs/R-01/P02-implement/tasks.md")
      expect(run.out).toContain("✓ task append complete: docs/R-01/P02-implement/tasks.md gained 1 task(s)")
      expect(run.out).toContain("✓ planned R-01.P02 implement: 1 task(s) in docs/R-01/P02-implement/tasks.md")
      // The input commit, then the append unit commit.
      const subjects = (await git("log", "--format=%s", "-2")).trim().split("\n")
      expect(subjects).toEqual(["PLAN append P02-implement Implementation", "PLAN plan-input P02-implement Implementation"])
      const bodies = await git("log", "--format=%B", "-2")
      expect(bodies).toContain("Auto-Stage: phase-append")
      expect(bodies).toContain("Auto-Stage: plan-input")
      // The snapshot prefix is unchanged: the existing line and document are
      // byte-identical, the new task follows them, the input is verbatim.
      expect(await Bun.file(join(dir, "docs/R-01/P02-implement/tasks.md")).text()).toBe(`${seededIndex}- [ ] T-002 task T-002\n`)
      expect(await Bun.file(join(dir, "docs/T-001/todo.md")).text()).toBe(seededDoc)
      expect(await Bun.file(join(dir, "docs/T-002/todo.md")).text()).toContain("Phase: R-01.P02")
      expect(await Bun.file(join(dir, "docs/R-01/P02-implement/plan-input.md")).text()).toBe("Add a fix task for the retry policy.\n")
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await agent.done()
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  test("plan --force-close --append replaces a task: the close commit lands, the cleared resume point lets the append run, the exit code is plan's", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-fc-append-"))
    const agent = await fakeClaude()
    const git = gitOf(dir)
    try {
      await git("init")
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      await listTasks(dir, P01.dir, "R-01.P01", [
        ["T-001", "the superseded task", "body"],
        ["T-002", "the successor task", "body"],
      ])
      // T-001 mid-pipeline: a plain append stops on D26's guard; the
      // force-close clears the record, so the append runs in the same process.
      await Bun.write(join(dir, ".auto/progress.json"), JSON.stringify({ task: "T-001", at: 1, active: true }))
      await git("add", "-A")
      await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")

      const run = await agent.run(["plan", dir, "--force-close", "T-001", "--reason", "superseded by the redesign", "--append", "-p", "Do X instead."])
      expect(run.err).toBe("")
      expect(run.code).toBe(0)
      // closeUnit's lines first: the closed task, the implicit dependent, the
      // undo pointer naming the close commit.
      expect(run.out).toContain("✓ closed T-001: superseded by the redesign")
      expect(run.out).toContain("ℹ T-002 has no Depends: field, so its prerequisite T-001 counts as satisfied; do not assume T-001's deliverables exist")
      expect(run.out).toMatch(/to undo before anything else runs: git revert [0-9a-f]+/)
      // Then the append: input saved, one replacement task appended (the
      // closed number is never reused), plan's m-mode summary.
      expect(run.out).toContain("✓ planning input saved to docs/R-01/P01-implement/plan-input.md")
      expect(run.out).toContain("✓ task append complete: docs/R-01/P01-implement/tasks.md gained 1 task(s)")
      expect(run.out).toContain("✓ planned 1 task(s) (T-003) into docs/R-01/P01-implement/tasks.md")
      // The close commit, then plan's two.
      const subjects = (await git("log", "--format=%s", "-3")).trim().split("\n")
      expect(subjects).toEqual(["PLAN append P01-implement Implementation", "PLAN plan-input P01-implement Implementation", "T-001 closed: superseded by the redesign"])
      // The mid-pipeline record is gone (the close cleared it), the closed
      // task carries its field, and the replacement task follows the index.
      expect(await Bun.file(join(dir, ".auto/progress.json")).exists()).toBe(false)
      expect(await Bun.file(join(dir, taskStatePaths("T-001").complete)).text()).toContain("Closed: superseded by the redesign")
      expect(await Bun.file(join(dir, P01.dir, "tasks.md")).text()).toBe(
        "# Tasks\n\n- [x] T-001 the superseded task\n- [ ] T-002 the successor task\n- [ ] T-003 task T-003\n",
      )
      expect(await Bun.file(join(dir, "docs/T-003/todo.md")).text()).toContain("Phase: R-01.P01")
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await agent.done()
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

// The new-project flow end to end (auto-core plans/0053 §8, C5): the P3c
// lifecycle in one pass per mode — init writes the config layer only, plan
// establishes the round and stops at the round-start gate, a person commits
// the setup, plan -p runs the planning session (over the fake `claude` on
// PATH, the B6 fixture convention: no provider credentials, the ambient
// OPENCODE_AUTO_* layer scrubbed) and stops for review, and the follow-up
// plan lands on the execute-route notice. What these cases pin is the shell
// flow and the stop lines; the planning logic itself is the core loop
// harness's (test/plan-loop.test.ts).
describe("CLI: the new-project flow end to end (auto-core plans/0053 §8, C5)", () => {
  test("m mode: init → plan establishes R-01 (G1) → commit → plan -p plans T-001 and stops → plan shows the execute notice", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-flow-m-"))
    const agent = await fakeClaude()
    const git = gitOf(dir)
    try {
      await git("init")
      // init writes the config layer only; the closing line names plan
      const init = await runCli(["init", dir])
      expect(init.code).toBe(0)
      expect(init.out).toContain(`next: opencode-auto plan ${dir} (establishes round R-01 and stops at the round-start gate)`)
      expect(await stat(join(dir, "docs")).catch(() => undefined)).toBeUndefined()
      // plan establishes the round and stops at the round-start gate (G1)
      const made = await agent.run(["plan", dir])
      expect(made.code).toBe(0)
      expect(made.out).toContain("✓ round R-01 established: single phase P01-implement")
      expect(made.out).toContain(
        `next (round-start gate): review the setup and commit it; then list tasks in docs/R-01/P01-implement/tasks.md by hand, ` +
          `or run: opencode-auto plan ${dir} -p <text> | --file <path>`,
      )
      expect(await Bun.file(join(dir, "docs/R-01/P01-implement/todo.md")).exists()).toBe(true)
      // The gate: a person reviews and commits the setup
      await git("add", "-A")
      await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "round setup")
      // plan -p: the input is committed on its own, the planning session
      // writes the index and one task document, and plan stops for review
      const planned = await agent.run(["plan", dir, "-p", "Add a hello task."])
      expect(planned.err).toBe("")
      expect(planned.code).toBe(0)
      expect(planned.out).toContain("✓ planning input saved to docs/R-01/P01-implement/plan-input.md")
      expect(planned.out).toContain("▶ starting the phase planning session to write docs/R-01/P01-implement/tasks.md and the task documents")
      expect(planned.out).toContain("✓ phase planning complete: docs/R-01/P01-implement/tasks.md lists 1 task(s)")
      expect(planned.out).toContain("✓ planned 1 task(s) (T-001) into docs/R-01/P01-implement/tasks.md")
      expect(planned.out).toContain(`next: review them, then run: opencode-auto run ${dir}`)
      // The artifacts: the input verbatim, the index with one task, the task
      // document carrying the phase field, the numbering record advanced.
      expect(await Bun.file(join(dir, "docs/R-01/P01-implement/plan-input.md")).text()).toBe("Add a hello task.\n")
      expect(await Bun.file(join(dir, "docs/R-01/P01-implement/tasks.md")).text()).toBe("# Tasks (R-01.P01)\n\n- [ ] T-001 task T-001\n")
      expect(await Bun.file(join(dir, "docs/T-001/todo.md")).text()).toContain("Phase: R-01.P01")
      expect(await Bun.file(join(dir, ".auto/next-task")).text()).toBe("2\n")
      // The input commit, then the planning unit commit; the tree is clean.
      const subjects = (await git("log", "--format=%s", "-3")).trim().split("\n")
      expect(subjects).toEqual(["PLAN plan P01-implement Implementation", "PLAN plan-input P01-implement Implementation", "round setup"])
      expect((await git("status", "--porcelain")).trim()).toBe("")
      // The follow-up plan (no input) lands on the execute-route notice
      const again = await runCli(["plan", dir])
      expect(again.code).toBe(0)
      expect(again.out).toContain(
        `ℹ docs/R-01/P01-implement/tasks.md lists 1 task(s) (1 pending); next: opencode-auto run ${dir}, ` +
          `or add tasks with opencode-auto plan ${dir} -p <text> | --file <path>`,
      )
    } finally {
      await agent.done()
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  test("phased (am): init → plan establishes R-01 (G1) → fill round.md and commit → plan -p plans P01 and stops → plan shows the execute notice", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-flow-am-"))
    const agent = await fakeClaude()
    const git = gitOf(dir)
    try {
      await git("init")
      const init = await runCli(["init", dir, "--phases", "am"])
      expect(init.code).toBe(0)
      expect(await stat(join(dir, "docs")).catch(() => undefined)).toBeUndefined()
      // plan establishes the round and stops at the round-start gate (G1)
      const made = await agent.run(["plan", dir])
      expect(made.code).toBe(0)
      expect(made.out).toContain("✓ round R-01 established: P01-analysis, P02-implement")
      expect(made.out).toContain(
        `next (round-start gate): review the round setup, fill in docs/R-01/round.md (goal, acceptance and release criteria), and commit it; ` +
          `then run: opencode-auto plan ${dir} to plan R-01.P01 analysis (or run to plan and execute)`,
      )
      // The gate: a person fills in the round brief and commits the setup
      await Bun.write(join(dir, "docs/R-01/round.md"), "# Round R-01\n\n## Goal\n\nSurvey the target.\n")
      await git("add", "-A")
      await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "round setup")
      // plan -p: the phased planning session plans P01-analysis and plan
      // stops for review (the stop is the review point of the round's tasks)
      const planned = await agent.run(["plan", dir, "-p", "Add a survey task."])
      expect(planned.err).toBe("")
      expect(planned.code).toBe(0)
      expect(planned.out).toContain("✓ planning input saved to docs/R-01/P01-analysis/plan-input.md")
      expect(planned.out).toContain("▶ starting the phase planning session to write docs/R-01/P01-analysis/tasks.md and the task documents")
      expect(planned.out).toContain("✓ phase planning complete: docs/R-01/P01-analysis/tasks.md lists 1 task(s)")
      expect(planned.out).toContain("✓ planned R-01.P01 analysis: 1 task(s) in docs/R-01/P01-analysis/tasks.md")
      expect(planned.out).toContain(`next: review them (edit, close, or plan --append), then run: opencode-auto run ${dir}`)
      // The artifacts: the index with one task, the task document, the commits.
      expect(await Bun.file(join(dir, "docs/R-01/P01-analysis/plan-input.md")).text()).toBe("Add a survey task.\n")
      expect(await Bun.file(join(dir, "docs/R-01/P01-analysis/tasks.md")).text()).toBe("# Tasks (R-01.P01)\n\n- [ ] T-001 task T-001\n")
      expect(await Bun.file(join(dir, "docs/T-001/todo.md")).text()).toContain("Phase: R-01.P01")
      const subjects = (await git("log", "--format=%s", "-3")).trim().split("\n")
      expect(subjects).toEqual(["PLAN plan P01-analysis Analysis", "PLAN plan-input P01-analysis Analysis", "round setup"])
      expect((await git("status", "--porcelain")).trim()).toBe("")
      // The follow-up plan (no input) lands on the phased execute notice
      const again = await runCli(["plan", dir])
      expect(again.code).toBe(0)
      expect(again.out).toContain(
        `ℹ R-01.P01 analysis is planned (1 of 1 tasks pending); next: opencode-auto run ${dir} ` +
          `— or add tasks with opencode-auto plan ${dir} --append -p <text>, or close units with opencode-auto close <ref>`,
      )
    } finally {
      await agent.done()
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

// run under the default --subtask auto, end to end over the claude adapter
// (auto-core plans/0059 D2–D5): the fake `claude` on PATH plays the lead, its
// streams, the wrap-up and the phase handover (test/fixtures/fake-claude.ts),
// and records every turn with the session arguments of its process. What
// these cases pin beyond the core's native-fake cases (test/agent-fake.test.ts
// there) is the real adapter underneath: the lead's usage notice arrives on
// the live process's stdin mid-turn, and a fork of the lead is a new claude
// process started with `--resume <lead> --fork-session`. claude has no
// readable session history, so the second stream's fork guard reads the
// lead's figure recorded with the split.
describe("CLI: run under --subtask auto over the claude adapter (auto-core plans/0059)", () => {
  type Turn = { session?: string; resume?: string; fork: boolean; text: string }
  const TASK = "T-001"
  const doc = `# ${TASK}: the widget\nPhase: R-01.P01\n\n## Goal\n\nBuild the widget.\n\n## Scope\n\nsrc only.\n\n## Acceptance\n\nThe modules read back.\n\n<!-- auto: eof -->\n`

  // A committed project with one pending task under the default config
  // (subtask auto, wrap-up on); `lead` = the lead's reported context.
  const setup = async (lead: number) => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-auto-"))
    const log = join(await mkdtemp(join(tmpdir(), "auto-cli-turns-")), "turns.jsonl")
    const agent = await fakeClaude({ FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_LEAD_CONTEXT: String(lead) })
    const git = gitOf(dir)
    await git("init")
    expect((await runCli(["init", dir])).code).toBe(0)
    expect((await agent.run(["plan", dir])).code).toBe(0)
    await Bun.write(join(dir, P01.dir, "tasks.md"), `# Tasks\n\n- [ ] ${TASK} the widget\n`)
    await Bun.write(join(dir, taskStatePaths(TASK).pending), doc)
    await git("add", "-A")
    await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")
    const turns = async (): Promise<Turn[]> =>
      (await Bun.file(log).text().catch(() => ""))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Turn)
    const done = async () => {
      await agent.done()
      await rm(dirname(log), { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
    return { dir, git, agent, turns, done }
  }

  test("a split the guard takes: the notice reaches the lead mid-turn, and every stream is a claude fork of the lead", async () => {
    const { dir, git, agent, turns, done } = await setup(70_000)
    try {
      const run = await agent.run(["run", dir])
      expect(run.code, `${run.out}\n${run.err}`).toBe(0)
      const all = await turns()
      const leadTurn = all.find((turn) => turn.text.includes("Split rule (adaptive decomposition)"))
      expect(leadTurn).toBeDefined()
      const lead = leadTurn!.session!
      expect(lead).toBeDefined()
      expect(leadTurn!.fork).toBe(false)
      expect(leadTurn!.text).toContain("You are the lead session of this task")
      // The first usage notice (criterion (c)) went into the lead's own
      // process while its turn ran: 70k of the 128k wall.
      const notice = all.find((turn) => turn.text.startsWith("[DRIVER] context:"))
      expect(notice?.session).toBe(lead)
      expect(run.out).toContain("steering a usage notice")
      expect(run.out).toContain(`${TASK} the lead split the remaining work into 2 streams (S01, S02); they run next, each a fork of the lead`)
      // Each stream: a new claude session forked from the lead, sent the
      // delta alone; the dependent second one names the file the first
      // changed and runs the task's full verification.
      const streams = all.filter((turn) => turn.text.startsWith("[DRIVER] Your split was taken"))
      expect(streams).toHaveLength(2)
      for (const stream of streams) {
        expect(stream.resume).toBe(lead)
        expect(stream.fork).toBe(true)
        expect(stream.session).not.toBe(lead)
      }
      expect(streams[0]!.session).not.toBe(streams[1]!.session)
      expect(streams[0]!.text).toContain(`runs stream ${TASK}.S01`)
      expect(streams[1]!.text).toContain(`runs stream ${TASK}.S02`)
      expect(streams[1]!.text).toContain("Since the split, the streams that ran before this one changed these files")
      expect(streams[1]!.text).toContain("src/alpha.ts")
      expect(streams[1]!.text).toContain("This is the last stream")
      // No history on claude: the second stream's guard read the recorded
      // figure, so neither stream started cold.
      expect(run.out.split("\n").filter((line) => line.includes(`lead base: session ${lead} on agent claude (70.0k tokens)`))).toHaveLength(2)
      expect(run.out).not.toContain("base usage unknown")
      // The wrap-up is a session of its own, not a fork.
      const wrapup = all.find((turn) => turn.text.includes("This session only performs the wrap-up"))
      expect(wrapup?.fork).toBe(false)
      expect(wrapup?.resume).toBeUndefined()
      // On disk: the lead's foundation, both streams' modules, the scope
      // files done, the checklist ticked, the task done; every commit landed.
      expect(await Bun.file(join(dir, "src/shared.ts")).text()).toBe("export const shared = 1\n")
      expect(await Bun.file(join(dir, "src/alpha.ts")).text()).toBe(`export const alpha = "${TASK}.S01"\n`)
      expect(await Bun.file(join(dir, "src/beta.ts")).text()).toBe(`export const beta = "${TASK}.S02"\n`)
      expect(await Bun.file(join(dir, subtaskDoc(TASK, 1, "done"))).exists()).toBe(true)
      expect(await Bun.file(join(dir, subtaskDoc(TASK, 2, "done"))).exists()).toBe(true)
      expect(await Bun.file(join(dir, taskDoc(TASK, "subtasks"))).text()).not.toContain("- [ ]")
      expect(await Bun.file(join(dir, taskStatePaths(TASK).complete)).exists()).toBe(true)
      const subjects = (await git("log", "--format=%s")).trim().split("\n")
      expect(subjects.some((subject) => subject.startsWith(`${TASK} exec the widget`))).toBe(true)
      expect(subjects.some((subject) => subject.startsWith(`${TASK} S1 alpha`))).toBe(true)
      expect(subjects.some((subject) => subject.startsWith(`${TASK} S2 beta`))).toBe(true)
      expect(subjects.some((subject) => subject.startsWith(`${TASK} wrapup the widget`))).toBe(true)
      expect(subjects.indexOf(subjects.find((subject) => subject.startsWith(`${TASK} S1`))!)).toBeGreaterThan(
        subjects.indexOf(subjects.find((subject) => subject.startsWith(`${TASK} S2`))!),
      )
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await done()
    }
  }, 60_000)

  test("a split the guard rejects (the lead under half the wall): a claude fork of the lead gets the reason and finishes the task, with no streams", async () => {
    const { dir, git, agent, turns, done } = await setup(100)
    try {
      const run = await agent.run(["run", dir])
      expect(run.code, `${run.out}\n${run.err}`).toBe(0)
      const all = await turns()
      const lead = all.find((turn) => turn.text.includes("Split rule (adaptive decomposition)"))?.session
      expect(lead).toBeDefined()
      expect(run.out).toContain(`${TASK} the lead's split was not taken (the lead's context`)
      expect(run.out).toContain("a fork of the lead finishes the task")
      expect(run.out).not.toContain("steering a usage notice")
      const rejected = all.filter((turn) => turn.text.startsWith("[DRIVER] The split was not taken"))
      expect(rejected).toHaveLength(1)
      expect(rejected[0]!.resume).toBe(lead)
      expect(rejected[0]!.fork).toBe(true)
      expect(rejected[0]!.text).toContain("under half the wall")
      expect(all.some((turn) => turn.text.startsWith("[DRIVER] Your split was taken"))).toBe(false)
      // The checklist is gone and no scope file was written; the fork did
      // the work, and the task closed.
      expect(await Bun.file(join(dir, taskDoc(TASK, "subtasks"))).exists()).toBe(false)
      expect(await Bun.file(join(dir, subtaskDoc(TASK, 1, "todo"))).exists()).toBe(false)
      expect(await Bun.file(join(dir, subtaskDoc(TASK, 1, "done"))).exists()).toBe(false)
      expect(await Bun.file(join(dir, "src/alpha.ts")).text()).toBe('export const alpha = "T-001"\n')
      expect(await Bun.file(join(dir, "src/beta.ts")).text()).toBe('export const beta = "T-001"\n')
      expect(await Bun.file(join(dir, taskStatePaths(TASK).complete)).exists()).toBe(true)
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await done()
    }
  }, 60_000)
})

describe("CLI: the project brief stub (plans/0052 D9)", () => {
  test("init writes the stub only when brief.md is missing; -p is retired; reset removes only the untouched stub", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const brief = join(dir, ".opencode/auto/brief.md")
      const first = await runCli(["init", dir])
      expect(first.out).toContain("created: .opencode/auto/brief.md (project brief stub")
      expect(await Bun.file(brief).text()).toBe(renderProjectBrief())
      await Bun.write(brief, `${renderProjectBrief()}\nMigrate legacy/pkg to app/.\n`)
      await commitFixture(dir)
      expect((await runCli(["init", dir])).out).toContain("already exists, skipped: .opencode/auto/brief.md")
      expect(await Bun.file(brief).text()).toContain("Migrate legacy/pkg to app/.")
      const reset = await runCli(["reset", dir])
      expect(reset.out).toContain("keep: .opencode/auto/brief.md (filled in, not the init stub, kept)")
      expect(await Bun.file(brief).text()).toContain("Migrate legacy/pkg to app/.")
      // init's -p is retired (plans/0053 D31): the stub is there, a person
      // edits it directly; with -p it is always refused
      await rm(brief)
      const refused = await runCli(["init", dir, "-p", "intent"])
      expect(refused.code).toBe(1)
      expect(refused.err).toContain("--prompt is retired")
      // reset's deletions commit before the re-init (the overwrite gate is
      // git-bound since init bootstraps the repository)
      await commitFixture(dir)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await Bun.file(brief).text()).toBe(renderProjectBrief())
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
      expect((await runCli(["plan", dir])).code).toBe(0)
      await mkdir(join(dir, ".auto", "logs"), { recursive: true })
      await writeFile(join(dir, ".auto", "logs", "run.log"), "log\n")
      await mkdir(join(dir, "docs", "T-001"), { recursive: true })
      await writeFile(join(dir, "docs/T-001/todo.md"), "# T-001: my task\n")
      await commitFixture(dir)

      const reset = await runCli(["reset", dir])
      expect(reset.code).toBe(0)
      expect(reset.out).toContain("the following cleanup will run in")
      expect(reset.out).toContain(".opencode/auto/config.json")
      expect(reset.out).toContain("restored to the uninitialized state")

      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).exists()).toBe(false)
      expect(await Bun.file(join(dir, "opencode.json")).exists()).toBe(false)
      expect(await Bun.file(join(dir, "AGENTS.md")).exists()).toBe(false)
      expect(await readdir(dir)).not.toContain(".opencode")
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
      const agent = await Bun.file(join(dir, ".opencode/agent/auto.md")).text()
      const agents = await Bun.file(join(dir, "AGENTS.md")).text()
      expect((await runCli(["reset", dir])).code).toBe(0)
      // reset's deletions commit before the re-init (the overwrite gate is
      // git-bound since init bootstraps the repository)
      await commitFixture(dir)
      expect((await runCli(["init", dir])).code).toBe(0)
      expect(await Bun.file(join(dir, ".opencode/auto/config.json")).text()).toBe(config)
      expect(await Bun.file(join(dir, ".opencode/agent/auto.md")).text()).toBe(agent)
      expect(await Bun.file(join(dir, "AGENTS.md")).text()).toBe(agents)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("reset keeps a modified opencode.json and says why", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      await commitFixture(dir)
      await writeFile(join(dir, "opencode.json"), '{"model":"my own config"}\n')
      const reset = await runCli(["reset", dir])
      expect(reset.code).toBe(0)
      expect(reset.out).toContain("keep: opencode.json")
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
      // init's ignore rules keep the local-only files out of the dirty list
      expect(dirty.err).not.toContain("opencode.json")
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

  test("run refuses the retired --amend and -f/--force", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-"))
    try {
      const amend = await runCli(["run", dir, "--amend"])
      expect(amend.code).toBe(1)
      expect(amend.err).toContain("--amend is retired: init is the stateless full overwrite; to change individual keys use opencode-auto amend <dir> --<key> <value>")
      const force = await runCli(["run", dir, "-f"])
      expect(force.code).toBe(1)
      expect(force.err).toContain("is an init/reset/fix option")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// CLI: lane isolation end to end (auto-core plans/0068 §7 S2,
// OPENCODE_AUTO_LANE_ISOLATION): the whole lane machinery running serially —
// one lane at a time, per-task worktrees, spawned worker processes through
// the shell's hidden `_lane` entry, and the landing protocol — over the fake
// `claude` on PATH. What these cases pin: a task round at isolation-on
// produces the same unit outcomes as today's serial path (D10's
// byte-identical floor, at the outcome level); the launcher injection point
// drives a spawned bootstrap that needs no shell (§6.4); and the kill
// property — a lane worker killed mid-lane leaves the main tree clean, and
// the re-dispatched lane resumes in the same worktree from its own progress
// record (D14's crash-recovery-as-lane-local-resume). `--max-sessions` above
// 1 still refuses: the concurrency scheduler is S3's.
describe("CLI: lane isolation (auto-core plans/0068 S2)", () => {
  const TASK = "T-001"
  const doc = `# ${TASK}: the widget\nPhase: R-01.P01\n\n## Goal\n\nBuild the widget.\n\n## Scope\n\nsrc only.\n\n## Acceptance\n\nThe modules read back.\n\n<!-- auto: eof -->\n`

  // A committed project with one pending task under the default config; the
  // fake claude answers run's lead (a small context figure rejects the
  // split, a fork of the lead finishes), the wrap-up and nothing else. An
  // `extra` goes into the fake agent's environment (the isolation switch).
  const setup = async (prefix: string, extra: Record<string, string> = {}) => {
    const dir = await mkdtemp(join(tmpdir(), prefix))
    const agent = await fakeClaude(extra)
    const git = gitOf(dir)
    await git("init")
    expect((await runCli(["init", dir])).code).toBe(0)
    expect((await runCli(["plan", dir])).code).toBe(0)
    await Bun.write(join(dir, P01.dir, "tasks.md"), `# Tasks\n\n- [ ] ${TASK} the widget\n`)
    await Bun.write(join(dir, taskStatePaths(TASK).pending), doc)
    await git("add", "-A")
    await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")
    return { dir, agent, git }
  }

  // The unit-level outcomes a run of this fixture produces (D10: the same
  // outcomes, not the same logs).
  const outcomes = async (dir: string, git: ReturnType<typeof gitOf>) => ({
    alpha: await Bun.file(join(dir, "src", "alpha.ts")).text().catch(() => "missing"),
    beta: await Bun.file(join(dir, "src", "beta.ts")).text().catch(() => "missing"),
    report: await Bun.file(join(dir, "docs", TASK, "report.md")).text().catch(() => "missing"),
    done: await Bun.file(join(dir, taskStatePaths(TASK).complete)).exists(),
    pendingGone: !(await Bun.file(join(dir, taskStatePaths(TASK).pending)).exists()),
    index: await Bun.file(join(dir, P01.dir, "tasks.md")).text(),
    clean: (await git("status", "--porcelain")).trim() === "",
  })

  test("a task round at isolation-on produces the same unit outcomes as today's serial path, landing through the merge protocol", async () => {
    const serial = await setup("auto-cli-lane-serial-")
    const isolated = await setup("auto-cli-lane-iso-", { OPENCODE_AUTO_LANE_ISOLATION: "on" })
    try {
      const plain = await serial.agent.run(["run", serial.dir])
      expect(plain.code, `${plain.out}\n${plain.err}`).toBe(0)
      const lanes = await isolated.agent.run(["run", isolated.dir])
      expect(lanes.code, `${lanes.out}\n${lanes.err}`).toBe(0)
      // Same unit outcomes on both paths.
      expect(await outcomes(isolated.dir, isolated.git)).toEqual(await outcomes(serial.dir, serial.git))
      // The isolated round ran through a lane and landed it.
      expect(lanes.out).toContain(`${TASK} dispatching an isolation lane`)
      expect(lanes.out).toContain(`${TASK} done (lane landed:`)
      const log = await isolated.git("log", "--format=%B")
      expect(log).toContain("Auto-Stage: landing")
      // The park is torn down and the lane branch deleted after landing.
      expect(await readdir(join(isolated.dir, ".auto", "worktrees")).catch(() => [])).toEqual([])
      expect((await isolated.git("branch", "--list", `auto-lane/${TASK}`)).trim()).toBe("")
    } finally {
      await serial.agent.done()
      await isolated.agent.done()
      await rm(serial.dir, { recursive: true, force: true })
      await rm(isolated.dir, { recursive: true, force: true })
    }
  }, 120_000)

  test("a spawned lane-worker fixture that needs no shell: the launcher injection point drives the unit end to end", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-lane-boot-"))
    const binDir = await mkdtemp(join(tmpdir(), "auto-cli-agent-"))
    const git = gitOf(dir)
    await Bun.write(join(binDir, "claude"), `#!/bin/sh\nexec bun ${JSON.stringify(join(import.meta.dir, "fixtures", "fake-claude.ts"))} "$@"\n`)
    await chmod(join(binDir, "claude"), 0o755)
    // The in-process parent never dispatches a session itself (every unit is
    // a lane), so its agent is a stub host; the spawned workers run the
    // bootstrap fixture over the fake claude.
    const stubHost = {
      client: { capabilities: { resume: false, fork: "none", steer: false, abort: false, question: false, permission: false, history: false, usage: "none" } },
      syncContext: async () => {},
      restart: async () => false,
      close: () => {},
    } as unknown as AgentHost
    try {
      await git("init")
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      await Bun.write(join(dir, P01.dir, "tasks.md"), `# Tasks\n\n- [ ] ${TASK} the widget\n`)
      await Bun.write(join(dir, taskStatePaths(TASK).pending), doc)
      await git("add", "-A")
      await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")

      // The isolation switch is per-run environment: plant it, and reset the
      // switch memo so this process parses the planted layer (restored in
      // the finally; the deliverables' driver-variable pattern).
      const ambient = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^OPENCODE_AUTO_/.test(key)))
      for (const key of Object.keys(ambient)) delete process.env[key]
      process.env.OPENCODE_AUTO_LANE_ISOLATION = "on"
      // The scrub above also removed this module's hermetic OPENCODE_AUTO_MODELS
      // pointer, and without it the in-process runAll's preflight falls back to
      // the operator's real XDG registry ($XDG_CONFIG_HOME/opencode-auto/
      // models.json), which may reference env keys this process does not carry
      // (on such hosts preflight refuses and runAll exits 1 — T-127 found this
      // host growing one mid-round). Re-plant the same no-operator-layer
      // pointer the lane worker below runs with, so the parent is as hermetic
      // as its worker.
      // AUTO-DECISION: the in-process parent keeps the scrubbed no-operator layer for the run (the stub host dispatches nothing itself, so no operator routing is needed; the operator's registry must not gate this case)
      process.env.OPENCODE_AUTO_MODELS = join(EMPTY_CONFIG_HOME, "no-operator-layer.json")
      setSwitchModelRegistry(undefined)
      setShellProfile({
        laneLauncher: (worktree, unit) =>
          Bun.spawn([process.execPath, join(import.meta.dir, "fixtures", "lane-worker.ts"), worktree, "--unit", unit], {
            env: {
              ...ambient,
              PATH: `${binDir}:${process.env.PATH ?? ""}`,
              OPENCODE_AUTO_AGENT: "claude",
              OPENCODE_AUTO_LANE_ISOLATION: "on",
              OPENCODE_AUTO_MODELS: join(EMPTY_CONFIG_HOME, "no-operator-layer.json"),
            },
            stdout: "pipe",
            stderr: "pipe",
          }),
      })
      let code: number | undefined
      try {
        code = await runAll(dir, { managed: stubHost })
      } finally {
        setShellProfile({ laneLauncher: undefined })
        delete process.env.OPENCODE_AUTO_LANE_ISOLATION
        delete process.env.OPENCODE_AUTO_MODELS
        for (const [key, value] of Object.entries(ambient)) process.env[key] = value
        setSwitchModelRegistry(undefined)
      }
      expect(code).toBe(0)
      // The unit completed through the bootstrap-driven lane and landed.
      const done = await outcomes(dir, git)
      expect(done.alpha).toBe('export const alpha = "T-001"\n')
      expect(done.done).toBe(true)
      expect(done.index).toContain(`- [x] ${TASK} the widget`)
      expect(done.clean).toBe(true)
      expect(await readdir(join(dir, ".auto", "worktrees")).catch(() => [])).toEqual([])
      expect((await git("log", "--format=%B")).toString()).toContain("Auto-Stage: landing")
    } finally {
      await rm(binDir, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }, 120_000)

  test("kill mid-lane: the main tree stays clean; the re-dispatched lane resumes from its own progress record", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-lane-kill-"))
    const gateDir = await mkdtemp(join(tmpdir(), "auto-cli-gate-"))
    const gate = join(gateDir, "go")
    const turns = join(gateDir, "turns.jsonl")
    const agent = await fakeClaude({ FAKE_CLAUDE_GATE: gate, FAKE_CLAUDE_GATE_DIE: "1", FAKE_CLAUDE_LOG: turns, OPENCODE_AUTO_LANE_ISOLATION: "on" })
    const git = gitOf(dir)
    const units = async () => JSON.parse(await Bun.file(join(dir, ".auto", "units.json")).text().catch(() => '{"tasks":{}}')) as { tasks: Record<string, { pid?: number; attempts?: number }> }
    const worktree = join(dir, ".auto", "worktrees", TASK)
    const parkThere = async () => stat(worktree).then(() => true, () => false)
    try {
      await git("init")
      expect((await runCli(["init", dir])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      await Bun.write(join(dir, P01.dir, "tasks.md"), `# Tasks\n\n- [ ] ${TASK} the widget\n`)
      await Bun.write(join(dir, taskStatePaths(TASK).pending), doc)
      await git("add", "-A")
      await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")

      // First run: the lane worker parks in its first session turn (the
      // gate); kill it mid-lane once the registry names its pid.
      const firstRun = agent.run(["run", dir])
      // Wait until the worker is mid-lane: the registry names its pid and the
      // worktree holds the lane's own progress record (the session in flight,
      // parked at the fake's gate).
      let pid: number | undefined
      let progress: { task: string; active: boolean } | undefined
      for (let i = 0; i < 1200 && (pid === undefined || progress?.active !== true); i++) {
        await Bun.sleep(50)
        pid = (await units()).tasks[TASK]?.pid
        if (pid !== undefined) {
          const raw = await Bun.file(join(worktree, ".auto", "progress.json")).text().catch(() => undefined)
          if (raw !== undefined) progress = JSON.parse(raw)
        }
      }
      expect(pid).toBeGreaterThan(0)
      expect(progress?.task).toBe(TASK)
      expect(progress?.active).toBe(true)
      // The fake records the turn before parking at the gate: only a
      // recorded turn is safely parked (the release then makes it die
      // without writing, so the killed lane's worktree stays as it was).
      let parked = false
      for (let i = 0; i < 600 && !parked; i++) {
        await Bun.sleep(50)
        parked = (await Bun.file(turns).text().catch(() => "")).includes("Split rule (adaptive decomposition)")
      }
      expect(parked).toBe(true)
      process.kill(pid!, "SIGKILL")
      await Bun.write(gate, "released\n")
      const first = await firstRun
      expect(first.code, `${first.out}\n${first.err}`).toBe(2)
      // The kill property: the main tree is clean, the scene kept in the park.
      expect((await git("status", "--porcelain")).trim()).toBe("")
      expect(await parkThere()).toBe(true)

      // Re-run: the dispatch reuses the recorded worktree; the worker
      // resumes from its own progress record (the line lands in the
      // worktree's own run log before the landing tears it down).
      const secondRun = agent.run(["run", dir])
      let resumed = false
      for (let i = 0; i < 600 && !resumed; i++) {
        await Bun.sleep(50)
        const logs = join(worktree, ".auto", "logs")
        for (const file of await readdir(logs).catch(() => [] as string[])) {
          if ((await Bun.file(join(logs, file)).text().catch(() => "")).includes("resume after interruption")) resumed = true
        }
      }
      const second = await secondRun
      expect(second.code, `${second.out}\n${second.err}`).toBe(0)
      expect(resumed).toBe(true)
      expect(second.out).toContain("re-dispatching its lane in the existing worktree")
      // Landed: the unit done, the index ticked, the tree clean, the park
      // torn down, the branch deleted, both dispatches booked.
      expect(await Bun.file(join(dir, taskStatePaths(TASK).complete)).exists()).toBe(true)
      expect(await Bun.file(join(dir, P01.dir, "tasks.md")).text()).toContain(`- [x] ${TASK} the widget`)
      expect((await git("status", "--porcelain")).trim()).toBe("")
      expect(await parkThere()).toBe(false)
      expect((await git("branch", "--list", `auto-lane/${TASK}`)).trim()).toBe("")
      expect((await units()).tasks[TASK]?.attempts).toBe(2)
      expect(await git("log", "--format=%B")).toContain("Auto-Stage: landing")
    } finally {
      await Bun.write(gate, "released\n").catch(() => {})
      await agent.done()
      await rm(gateDir, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }, 180_000)

  test("--max-sessions above 1 without a parallel level is a usage error (plans/0068 D10); under a level the run reaches preflight's concurrency gates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-lane-max-"))
    try {
      expect((await runCli(["init", dir])).code).toBe(0)
      await commitFixture(dir)
      // No level: the request is refused rather than silently run serially
      // ("plan for parallelism first").
      const two = await runCli(["run", dir, "--max-sessions", "2"])
      expect(two.code).toBe(1)
      expect(two.err).toContain("concurrent execution needs a parallel level")
      expect(two.err).toContain("init --parallel")
      // Under a level the max-sessions gate is gone: the run now reaches
      // preflight, where D11's interactive refusal fires (an accepted run
      // would start an agent; the usage error is the cheap deterministic
      // witness that the width was accepted).
      expect((await runCli(["init", dir, "--parallel", "low"])).code).toBe(0)
      await commitFixture(dir)
      const steered = await runCli(["run", dir, "--max-sessions", "2", "--interactive"])
      expect(steered.code).toBe(1)
      // preflight's refusal rides the run log's stdout (the run log is open).
      expect(steered.out).toContain("one human cannot steer 2 concurrent sessions")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// The lane scheduler live (auto-core plans/0068 S3, D10; the S4
// observability cases ride the same entry): --max-sessions 2 under a
// parallel level routes the task loop through the readiness scheduler — the
// lanes spawn through the shell's own `_lane` entry (the default launcher
// re-invoking this CLI), land through the merge protocol, and the failure
// matrix and D21's conflict posture drive the run's exit. S4 adds the
// human-surface cases over a conflict-free two-lane round: the prefix relay
// (every lane line re-emitted with `[<task-id>]`), the status tree's
// in-flight lanes section read mid-run, both reports' usage booked into the
// run stats, and the conclusion's lanes roll-up with its parent-wall note.
describe("CLI: the lane scheduler (auto-core plans/0068 S3)", () => {
  const doc = (id: string, title: string, touches: string) =>
    [`# ${id}: ${title}`, "Phase: R-01.P01", "Depends: none", `Touches: ${touches}`, "", "## Goal", "", `Deliver ${title}.`, "", "## Scope", "", "src only.", "", "## Acceptance", "", "The modules read back.", "", "<!-- auto: eof -->", ""].join("\n")

  // A committed project with one or two pending tasks under a parallel level;
  // the fake claude answers the lead (a small context figure rejects the
  // split, a fork of the lead finishes by writing src/alpha.ts and
  // src/beta.ts), the wrap-up and nothing else.
  const setup = async (prefix: string, parallel: "low" | "medium", tasks: [string, string, string][]) => {
    const dir = await mkdtemp(join(tmpdir(), prefix))
    const agent = await fakeClaude()
    const git = gitOf(dir)
    await git("init")
    expect((await runCli(["init", dir, "--parallel", parallel])).code).toBe(0)
    expect((await runCli(["plan", dir])).code).toBe(0)
    await Bun.write(join(dir, P01.dir, "tasks.md"), `# Tasks\n\n${tasks.map(([id, title]) => `- [ ] ${id} ${title}\n`).join("")}`)
    for (const [id, title, touches] of tasks) await Bun.write(join(dir, taskStatePaths(id).pending), doc(id, title, touches))
    await git("add", "-A")
    await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")
    return { dir, agent, git }
  }

  test("a one-lane round at maxSessions 2 runs through the real _lane entry and lands", async () => {
    const { dir, agent, git } = await setup("auto-cli-lane-s3-one-", "low", [["T-001", "the widget", "src/"]])
    try {
      const run = await agent.run(["run", dir, "--max-sessions", "2"])
      expect(run.code, `${run.out}\n${run.err}`).toBe(0)
      expect(run.out).toContain("T-001 dispatching a lane")
      expect(run.out).toContain("T-001 done (lane landed:")
      expect(run.out).toContain("✓ all tasks complete")
      // Landed: the unit done, the index ticked, the landing trailers in the
      // history, the park torn down, the branch gone, the tree clean.
      expect(await Bun.file(join(dir, taskStatePaths("T-001").complete)).exists()).toBe(true)
      expect(await Bun.file(join(dir, P01.dir, "tasks.md")).text()).toContain("- [x] T-001 the widget")
      expect(await Bun.file(join(dir, "src/alpha.ts")).text()).toContain("alpha")
      expect(await readdir(join(dir, ".auto/worktrees")).catch(() => [])).toEqual([])
      expect((await git("branch", "--list", "auto-lane/T-001")).trim()).toBe("")
      expect((await git("log", "--format=%B")).toString()).toContain("Auto-Stage: landing")
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await agent.done()
      await rm(dir, { recursive: true, force: true })
    }
  }, 180_000)

  test("two lanes whose Touches lie conflict at landing; medium's one repair cannot resolve it and the run blocks naming the park", async () => {
    const { dir, agent, git } = await setup("auto-cli-lane-s3-two-", "medium", [
      ["T-001", "the alpha module", "src/alpha.ts"],
      ["T-002", "the beta module", "src/beta.ts"],
    ])
    try {
      const run = await agent.run(["run", dir, "--max-sessions", "2"])
      expect(run.code, `${run.out}\n${run.err}`).toBe(2)
      // The two lanes run identical fake work as concurrent workers, and
      // landings are serial in completion order, so which lane lands first is
      // scheduling luck, not a guarantee (a probe of the pristine suite
      // failed the old T-001-first literal 4/8 runs). Whichever it is: the
      // first lane landed, the second's landing hit the real conflict (both
      // lanes wrote both modules — the declared Touches lied).
      const first = run.out.includes("T-001 done (lane landed:") ? "T-001" : "T-002"
      const second = first === "T-001" ? "T-002" : "T-001"
      expect(run.out).toContain(`${first} done (lane landed:`)
      expect(run.out).toContain(`${second} landing conflict`)
      // D21 at medium: exactly one repair re-dispatch through the merge
      // instruction. The real conflict is semantic (both lanes rewrote the
      // same files differently), the repair worker's driver-side merge
      // cannot resolve it and blocks with its report — the run stops naming
      // the unit, the report and the park path (a second landing conflict
      // blocks the same way: the one repair is spent either way).
      expect(run.out).toContain("re-dispatching the lane with the merge instruction")
      // `main` is no host luck: the fixture's initial branch is pinned by the
      // suite's global git config (T-127), so the instruction naming it is the
      // real main-tree branch, and the literal cannot drift with the host.
      expect(run.out).toContain(`merge main into auto-lane/${second}`)
      expect(run.out).toContain(`${second} is blocked`)
      expect(run.out).toContain("blocked and its landing hit a conflict")
      expect(await Bun.file(join(dir, taskStatePaths(first).complete)).exists()).toBe(true)
      expect(await Bun.file(join(dir, taskStatePaths(second).complete)).exists()).toBe(false)
      // The blocked lane's scene is kept; the main tree is clean.
      expect(await readdir(join(dir, ".auto/worktrees")).catch(() => [])).toEqual([second])
      expect((await git("branch", "--list", `auto-lane/${second}`)).trim()).toContain(`auto-lane/${second}`)
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await agent.done()
      await rm(dir, { recursive: true, force: true })
    }
  }, 180_000)

  // S4's acceptance round (plans/0068 §7): two lanes over disjoint files
  // (the fake's fork-module knob writes one per-task module, so the declared
  // Touches tell the truth), parked mid-run at the fake's gate so `status`
  // reads the in-flight lanes section while both lanes are live.
  test("a two-lane round lands both: the relay prefixes every lane line, status shows both lanes mid-run, both reports' usage books, the conclusion rolls up", async () => {
    const gateDir = await mkdtemp(join(tmpdir(), "auto-cli-lane-s4-gate-"))
    const gate = join(gateDir, "go")
    const agent = await fakeClaude({ FAKE_CLAUDE_GATE: gate, FAKE_CLAUDE_FORK_MODULES: "1" })
    const { dir, git } = await setup("auto-cli-lane-s4-", "low", [
      ["T-001", "the alpha module", "src/T-001.ts"],
      ["T-002", "the beta module", "src/T-002.ts"],
    ])
    const units = async () =>
      JSON.parse(await Bun.file(join(dir, ".auto", "units.json")).text().catch(() => '{"tasks":{}}')) as {
        tasks: Record<string, { pid?: number }>
      }
    try {
      const running = agent.run(["run", dir, "--max-sessions", "2"])
      // Wait until both lanes are live: the registry names both workers'
      // pids (their sessions parked at the fake's gate).
      let both = false
      for (let i = 0; i < 1200 && !both; i++) {
        await Bun.sleep(50)
        const tasks = (await units()).tasks
        both = tasks["T-001"]?.pid !== undefined && tasks["T-002"]?.pid !== undefined
      }
      expect(both).toBe(true)
      // The status tree mid-run: the in-flight lanes section, one line per
      // lane with its park worktree and worker pid — the read-model section
      // D13 adds, shell-visible beside a live run.
      const mid = await runCli(["status", dir])
      expect(mid.code).toBe(0)
      expect(mid.out).toContain("lanes in flight (2):")
      expect(mid.out).toContain("[▶] T-001 (worktree .auto/worktrees/T-001, pid ")
      expect(mid.out).toContain("[▶] T-002 (worktree .auto/worktrees/T-002, pid ")
      await Bun.write(gate, "released\n")
      const run = await running
      expect(run.code, `${run.out}\n${run.err}`).toBe(0)
      // Both lanes landed their own module; the tree is clean, the park torn
      // down.
      expect(await Bun.file(join(dir, "src", "T-001.ts")).text()).toContain("T-001")
      expect(await Bun.file(join(dir, "src", "T-002.ts")).text()).toContain("T-002")
      expect(run.out).toContain("T-001 done (lane landed:")
      expect(run.out).toContain("T-002 done (lane landed:")
      expect((await git("status", "--porcelain")).trim()).toBe("")
      expect(await readdir(join(dir, ".auto/worktrees")).catch(() => [])).toEqual([])
      // The prefix relay: the workers' own start lines arrived re-emitted
      // through the parent with their lane's id — and no unprefixed copy.
      expect(run.out).toContain("[T-001] ▶ T-001 lane worker: running the unit")
      expect(run.out).toContain("[T-002] ▶ T-002 lane worker: running the unit")
      expect(run.out).not.toContain("\n▶ T-001 lane worker: running the unit")
      // Both reports' usage booked: the per-unit lanes entries (marked
      // booked — the reports carried the detail) and the fold into the round
      // bucket's usage and sessions.
      const stats = JSON.parse(await Bun.file(join(dir, ".auto", "stats.json")).text()) as {
        lanes?: Record<string, { tokens: number; sessions: number; booked?: boolean }>
        roundB: { sessions: number; usage: { input: number } }
      }
      for (const unit of ["T-001", "T-002"]) {
        expect(stats.lanes?.[unit]?.tokens ?? 0).toBeGreaterThan(0)
        expect(stats.lanes?.[unit]?.booked).toBe(true)
      }
      expect(stats.roundB.sessions).toBeGreaterThanOrEqual(4)
      expect(stats.roundB.usage.input).toBeGreaterThan(0)
      // The conclusion's roll-up: the lanes line after the round's tokens
      // line, claiming the booking and noting parent-wall.
      expect(run.out).toContain("■ round 1 complete:")
      expect(run.out).toContain("  lanes: 2 landed / ")
      expect(run.out).toContain("(booked into the totals above)")
      expect(run.out).toContain("the time lines mean parent-wall")
      // After the round no lane is in flight: the section is gone.
      const after = await runCli(["status", dir])
      expect(after.out).not.toContain("lanes in flight")
    } finally {
      await Bun.write(gate, "released\n").catch(() => {})
      await agent.done()
      await rm(gateDir, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }, 240_000)
})

// The scheduler's task-internal width (auto-core plans/0068 S5: D3 stage 2,
// D18, D19, §6.8): a split task at --max-sessions 2 runs its streams as
// lanes — the lead lane stops at its taken split (the report carries the
// split to the parent), the parent lands it and schedules the stream lanes
// T-NNN.S<nn> as cold starts (no fork of the lead: the workers' turns carry
// no --resume/--fork-session), a dependent stream sees the files changed
// since the split (the seeded split record, read in its own worktree), the
// last stream's delta carries the task's full acceptance verification, and
// its lane runs the wrap-up and closes the task.
describe("CLI: stream lanes (auto-core plans/0068 S5)", () => {
  type Turn = { session?: string; resume?: string; fork: boolean; text: string }
  const TASK = "T-001"
  const doc = `# ${TASK}: the widget\nPhase: R-01.P01\n\nDepends: none\n\n## Goal\n\nBuild the widget.\n\n## Scope\n\nsrc only.\n\n## Acceptance\n\nThe modules read back.\n\n<!-- auto: eof -->\n`

  test("a split task at maxSessions 2: the lead lane stops at the split, the streams run as cold-start lanes, the last one carries the full verification and wraps up", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-cli-lane-s5-"))
    const log = join(await mkdtemp(join(tmpdir(), "auto-cli-s5-turns-")), "turns.jsonl")
    const agent = await fakeClaude({ FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_LEAD_CONTEXT: "70000" })
    const git = gitOf(dir)
    const turns = async (): Promise<Turn[]> =>
      (await Bun.file(log).text().catch(() => ""))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Turn)
    try {
      await git("init")
      expect((await runCli(["init", dir, "--parallel", "low"])).code).toBe(0)
      expect((await runCli(["plan", dir])).code).toBe(0)
      await Bun.write(join(dir, P01.dir, "tasks.md"), `# Tasks\n\n- [ ] ${TASK} the widget\n`)
      await Bun.write(join(dir, taskStatePaths(TASK).pending), doc)
      await git("add", "-A")
      await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")

      const run = await agent.run(["run", dir, "--max-sessions", "2"])
      expect(run.code, `${run.out}\n${run.err}`).toBe(0)
      const all = await turns()
      // The lead ran inside its lane under D18's guidance: the split clause
      // names the level the streams will actually get.
      const lead = all.find((turn) => turn.text.includes("Split rule (adaptive decomposition)"))
      expect(lead).toBeDefined()
      expect(lead!.text).toContain("The streams run side by side under this project's parallel level low")
      // The lead's lane stopped at the taken split; the parent landed it and
      // scheduled the streams as lanes of their own (the relayed story).
      expect(run.out).toContain("the lead split the remaining work into 2 streams")
      expect(run.out).toContain("each as a lane of its own")
      expect(run.out).toContain("T-001.S01 dispatching a lane")
      expect(run.out).toContain("T-001.S02 dispatching a lane")
      // The streams are cold starts (D19): fresh sessions, no --resume, no
      // --fork-session — nothing of the lead's server survives its process.
      const streams = all.filter((turn) => turn.text.startsWith("[DRIVER] Your split was taken"))
      expect(streams).toHaveLength(2)
      for (const stream of streams) {
        expect(stream.fork).toBe(false)
        expect(stream.resume).toBeUndefined()
        expect(stream.text).toContain("a fresh session that forks nothing")
      }
      expect(streams[0]!.text).toContain(`runs stream ${TASK}.S01`)
      expect(streams[1]!.text).toContain(`runs stream ${TASK}.S02`)
      // The cold delta carries the task and the stream's own scope file.
      expect(streams[0]!.text).toContain("The task (its document is docs/T-001/todo.md):")
      expect(streams[0]!.text).toContain("Your stream's scope file (docs/T-001/S01/todo.md) in full:")
      // The dependent stream saw the files changed since the split (its
      // worktree's seeded record), and the last stream carries the task's
      // full acceptance verification.
      expect(streams[1]!.text).toContain("Since the split, the streams that ran before this one changed these files")
      expect(streams[1]!.text).toContain("src/alpha.ts")
      expect(streams[1]!.text).toContain("This is the last stream")
      // The wrap-up ran inside the last stream's lane, as a session of its own.
      const wrapup = all.find((turn) => turn.text.includes("This session only performs the wrap-up"))
      expect(wrapup).toBeDefined()
      expect(wrapup!.fork).toBe(false)
      // On disk: the lead's foundation, both streams' modules, the scope
      // files done, the checklist fully ticked, the task done and the index
      // ticked — the lane story ends where the serial one does.
      expect(await Bun.file(join(dir, "src/shared.ts")).text()).toBe("export const shared = 1\n")
      expect(await Bun.file(join(dir, "src/alpha.ts")).text()).toBe(`export const alpha = "${TASK}.S01"\n`)
      expect(await Bun.file(join(dir, "src/beta.ts")).text()).toBe(`export const beta = "${TASK}.S02"\n`)
      expect(await Bun.file(join(dir, subtaskDoc(TASK, 1, "done"))).exists()).toBe(true)
      expect(await Bun.file(join(dir, subtaskDoc(TASK, 2, "done"))).exists()).toBe(true)
      expect(await Bun.file(join(dir, taskDoc(TASK, "subtasks"))).text()).not.toContain("- [ ]")
      expect(await Bun.file(join(dir, taskStatePaths(TASK).complete)).exists()).toBe(true)
      expect(await Bun.file(join(dir, P01.dir, "tasks.md")).text()).toContain(`- [x] ${TASK} the widget`)
      expect(await Bun.file(join(dir, taskDoc(TASK, "report"))).text()).toContain("Result: PASS")
      // The split record travelled: the lead worktree's registry died at
      // teardown, the parent re-persisted the split at landing, re-rooted
      // onto the main tree.
      const units = JSON.parse(await Bun.file(join(dir, ".auto", "units.json")).text()) as { tasks: Record<string, { split?: { root: string; sha: string }[] }> }
      expect(units.tasks[TASK]?.split?.map((line) => line.root)).toEqual([dir])
      // Three landings (the lead, both streams), the park and branches torn
      // down, the tree clean.
      const bodies = await git("log", "--format=%B")
      expect(bodies.match(/Auto-Stage: landing\n/g)?.length).toBe(3)
      expect(await readdir(join(dir, ".auto/worktrees")).catch(() => [])).toEqual([])
      expect((await git("branch", "--list", "auto-lane/*")).trim()).toBe("")
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await agent.done()
      await rm(dirname(log), { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }, 300_000)
})

// Branch isolation's round trip (plans/0074 §2, U-L3): the e2e the design unit
// owes — designate → establish (isolate) → run the round's units → `land`,
// the deliverable's history ending with exactly one commit while its original
// branch otherwise never moved and auto/R-NN is gone. The lanes interplay
// (§2.4) rides the same entry: lanes branch and land in the MAIN repository,
// orthogonal to isolation — the lane park's copy of the nested repository
// sits on the round branch like the main tree's does — and a unit whose
// declared Touches reach the nested repository is not lane-eligible
// (plans/0068 D15) and serializes in the main tree, so its work lands on the
// isolation branch during the round; `land` then squashes the round into the
// deliverable's one commit. The fake's fork writes the nested task's module
// inside pkg (FAKE_CLAUDE_NESTED, the knob beside FAKE_CLAUDE_FORK_MODULES).
describe("CLI: branch isolation round trip (plans/0074 U-L3)", () => {
  const doc = (id: string, title: string, touches: string) =>
    [`# ${id}: ${title}`, "Phase: R-01.P01", "Depends: none", `Touches: ${touches}`, "", "## Goal", "", `Deliver ${title}.`, "", "## Scope", "", "One module, read back.", "", "## Acceptance", "", "The module reads back.", "", "<!-- auto: eof -->", ""].join("\n")

  // A committed project whose nested repository pkg holds one clean commit
  // (on the pinned init.defaultBranch), ready to be designated by --isolate;
  // plan establishes the round and isolates pkg on auto/R-01 before the task
  // documents land (the person's commit that precedes every gated run).
  // `init` carries extra init flags (the lanes case's parallel level);
  // `extra` goes into the fake agent's environment (the fixture knobs).
  const setup = async (prefix: string, tasks: [string, string, string][], init: string[] = [], extra: Record<string, string> = {}) => {
    const dir = await mkdtemp(join(tmpdir(), prefix))
    const agent = await fakeClaude(extra)
    const git = gitOf(dir)
    await mkdir(join(dir, "pkg"), { recursive: true })
    const nested = gitOf(join(dir, "pkg"))
    await Bun.write(join(dir, "pkg", "readme.txt"), "nested\n")
    await nested("init", "-q")
    await nested("add", "-A")
    await nested("commit", "-qm", "nested setup")
    const original = (await nested("rev-parse", "--abbrev-ref", "HEAD")).trim()
    const setupSha = (await nested("rev-parse", "HEAD")).trim()
    await git("init")
    const mainBranch = (await git("symbolic-ref", "--short", "HEAD")).trim()
    expect((await runCli(["init", dir, "--isolate", "pkg", ...init])).code).toBe(0)
    const plan = await runCli(["plan", dir])
    expect(plan.code, `${plan.out}\n${plan.err}`).toBe(0)
    await Bun.write(join(dir, P01.dir, "tasks.md"), `# Tasks\n\n${tasks.map(([id, title]) => `- [ ] ${id} ${title}\n`).join("")}`)
    for (const [id, title, touches] of tasks) await Bun.write(join(dir, taskStatePaths(id).pending), doc(id, title, touches))
    await git("add", "-A")
    await git("commit", "-qm", "baseline")
    return { dir, agent, git, nested, original, setupSha, mainBranch, plan }
  }

  test("isolate → establish → run → land: the round's nested work becomes exactly one commit on the original branch, auto/R-01 gone, the trail in the driven root", async () => {
    const { dir, agent, git, nested, original, setupSha, plan } = await setup("auto-cli-iso-round-", [["T-001", "the nested widget", "pkg/"]], [], {
      FAKE_CLAUDE_FORK_MODULES: "1",
      FAKE_CLAUDE_NESTED: "T-001:pkg",
    })
    try {
      // designate → establish: the round opened with pkg isolated on the
      // round branch, the original tip intact beneath it.
      expect(plan.out).toContain("✓ branch isolation: pkg on auto/R-01")
      expect((await nested("rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe("auto/R-01")
      expect((await nested("rev-parse", original)).trim()).toBe(setupSha)
      // run the round: the unit's fork delivers its module inside pkg.
      const run = await agent.run(["run", dir])
      expect(run.code, `${run.out}\n${run.err}`).toBe(0)
      // During the round the deliverable's work lives on the isolation branch
      // only: the driver's unified commits (Auto-Stage trailers) moved
      // auto/R-01; the original branch never moved.
      expect(await Bun.file(join(dir, "pkg", "src", "T-001.ts")).text()).toBe('export const module = "T-001"\n')
      expect((await nested("rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe("auto/R-01")
      expect(await nested("log", "--format=%B", `${original}..auto/R-01`)).toContain("Auto-Stage: execute")
      expect((await nested("rev-parse", original)).trim()).toBe(setupSha)
      // The task completed; both trees clean.
      expect(await Bun.file(join(dir, taskStatePaths("T-001").complete)).exists()).toBe(true)
      expect((await git("status", "--porcelain")).trim()).toBe("")
      expect((await nested("status", "--porcelain")).trim()).toBe("")
      // land: exactly one commit on the deliverable's branch.
      const landed = await runCli(["land", dir])
      expect(landed.code, `${landed.out}\n${landed.err}`).toBe(0)
      const sha = (await nested("rev-parse", "--short", "HEAD")).trim()
      expect(landed.out).toContain(`✓ pkg: landed ${sha} on ${original} (1 commit(s) of auto/R-01 as one); auto/R-01 deleted`)
      expect(landed.out).toContain("the driven root is the process layer of record")
      expect(Number((await nested("rev-list", "--count", original)).trim())).toBe(2)
      expect((await nested("rev-parse", "HEAD~1")).trim()).toBe(setupSha)
      expect((await nested("rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe(original)
      expect((await nested("branch", "--list", "auto/R-01")).trim()).toBe("")
      expect(await Bun.file(join(dir, "pkg", "src", "T-001.ts")).text()).toBe('export const module = "T-001"\n')
      expect((await nested("status", "--porcelain")).trim()).toBe("")
      // The landing commit is the deliverable's own history entry: no
      // Auto-Stage trailer.
      expect(await nested("log", "-1", "--format=%B")).not.toContain("Auto-Stage:")
      // The full per-unit trail stays in the driven root's git (0064's
      // record model): its own commits recorded the nested repository's SHAs
      // along the way.
      expect(await git("log", "--format=%B")).toContain("Auto-Nested: pkg @")
    } finally {
      await agent.done()
      await rm(dir, { recursive: true, force: true })
    }
  }, 240_000)

  test("lanes inside isolation: the lane parks and lands in the main repository while pkg rides auto/R-01; the nested unit serializes onto the isolation branch and land squashes the round", async () => {
    const gateDir = await mkdtemp(join(tmpdir(), "auto-cli-iso-lane-gate-"))
    const gate = join(gateDir, "go")
    const { dir, agent, git, nested, original, setupSha, mainBranch } = await setup(
      "auto-cli-iso-lane-",
      [
        ["T-001", "the root module", "src/"],
        ["T-002", "the nested widget", "pkg/"],
      ],
      ["--parallel", "low"],
      { FAKE_CLAUDE_FORK_MODULES: "1", FAKE_CLAUDE_NESTED: "T-002:pkg", FAKE_CLAUDE_GATE: gate },
    )
    const units = async () =>
      JSON.parse(await Bun.file(join(dir, ".auto", "units.json")).text().catch(() => '{"tasks":{}}')) as {
        tasks: Record<string, { pid?: number }>
      }
    try {
      const running = agent.run(["run", dir, "--max-sessions", "2"])
      // Wait until the lane is in flight: the registry names its worker pid
      // (its lead parked at the fake's gate).
      let pid: number | undefined
      for (let i = 0; i < 1200 && pid === undefined; i++) {
        await Bun.sleep(50)
        pid = (await units()).tasks["T-001"]?.pid
      }
      expect(pid).toBeGreaterThan(0)
      // §2.4's orthogonality, pinned mid-round: the lane's branch and park
      // live in the MAIN repository (on its main branch, untouched by
      // isolation), while the nested repository rides the round branch — the
      // main tree's pkg and the park's copied pkg both sit on auto/R-01, the
      // original branch never moved by any of it.
      expect((await git("branch", "--list", "auto-lane/T-001")).trim()).toContain("auto-lane/T-001")
      expect((await git("rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe(mainBranch)
      expect((await nested("rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe("auto/R-01")
      const parkPkg = gitOf(join(dir, ".auto", "worktrees", "T-001", "pkg"))
      expect((await parkPkg("rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe("auto/R-01")
      expect((await nested("rev-parse", original)).trim()).toBe(setupSha)
      await Bun.write(gate, "released\n")
      const run = await running
      expect(run.code, `${run.out}\n${run.err}`).toBe(0)
      // The round ran both ways: T-001 as a lane (the serialized landing in
      // the main repository), T-002 through D15's serial degrade — alone, in
      // the main tree, after the lanes drained.
      expect(run.out).toContain("T-001 dispatching a lane")
      expect(run.out).toContain("T-001 done (lane landed:")
      expect(run.out).toContain("T-002 cannot be isolated (its declared Touches reach a nested repository); running it serially in the main tree after the lanes drained (D15)")
      expect(await Bun.file(join(dir, "src", "T-001.ts")).text()).toBe('export const module = "T-001"\n')
      expect(await Bun.file(join(dir, "pkg", "src", "T-002.ts")).text()).toBe('export const module = "T-002"\n')
      // During the round: the lane's serialized landing is in the MAIN
      // repository's history (park and branch torn down after it), while the
      // nested unit's work sits on the isolation branch as driver commits —
      // the original branch still never moved.
      expect(await git("log", "--format=%B")).toContain("Auto-Stage: landing")
      expect((await git("branch", "--list", "auto-lane/*")).trim()).toBe("")
      expect(await readdir(join(dir, ".auto/worktrees")).catch(() => [])).toEqual([])
      expect((await nested("rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe("auto/R-01")
      expect(await nested("log", "--format=%B", `${original}..auto/R-01`)).toContain("Auto-Stage: execute")
      expect((await nested("rev-parse", original)).trim()).toBe(setupSha)
      // land squashes the round's nested work into the deliverable's one
      // commit; the lane's module stays in the main repository's history.
      const landed = await runCli(["land", dir])
      expect(landed.code, `${landed.out}\n${landed.err}`).toBe(0)
      const sha = (await nested("rev-parse", "--short", "HEAD")).trim()
      expect(landed.out).toContain(`✓ pkg: landed ${sha} on ${original} (1 commit(s) of auto/R-01 as one); auto/R-01 deleted`)
      expect(Number((await nested("rev-list", "--count", original)).trim())).toBe(2)
      expect((await nested("rev-parse", "HEAD~1")).trim()).toBe(setupSha)
      expect((await nested("rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe(original)
      expect((await nested("branch", "--list", "auto/R-01")).trim()).toBe("")
      expect(await Bun.file(join(dir, "pkg", "src", "T-002.ts")).text()).toBe('export const module = "T-002"\n')
      expect(await nested("log", "-1", "--format=%B")).not.toContain("Auto-Stage:")
      expect((await nested("status", "--porcelain")).trim()).toBe("")
      expect((await git("status", "--porcelain")).trim()).toBe("")
    } finally {
      await Bun.write(gate, "released\n").catch(() => {})
      await agent.done()
      await rm(gateDir, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }, 240_000)
})

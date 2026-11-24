// The synthesize grant kind's lifecycle proof (plans/0281, 0279's
// construction-determinized letter): the formulation construction's
// re-voicing session — 0097's constructor one-shot — rides the executor
// protocol. The claimable derivation (the push compose's own predicate
// family: a pending formulation unit over a FLOOR todo, a resolved
// charter, the switch not off), the claim address (the construction
// unit's own task id, the phase identity riding the grant), the identical
// formulate-synthesize prompt over the same source assembly, the fence's
// one-path reply channel, the settlement's mechanical collect (the push
// loop's own checks through checkSynthesisReply) and the landing through
// constructFormulation under the phase-synthesize stage — all composed
// with the standing machinery: the byte-identical formulate floor when
// any predicate fails (P10), the landed share terminal (no verify
// follows), the formulate session continuing over the synthesized todo.
import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { BRIEF_FILE } from "../src/brief"
import { CONFIG_FILE } from "../src/config"
import { constructFormulation } from "../src/formulate"
import { ledgerOf, seededLedgerRows } from "../src/formulate-synthesis"
import { readExecutorPreview } from "../src/executor-steps"
import { executorTypeCatalog, openExecutorCoordinator } from "../src/executor-coordinator"
import { clampSwitches } from "../src/switches"
import { phaseType } from "../src/phases/registry"
import { renderTaskIndex } from "../src/tasks"
import type { PhaseUnit } from "../src/phases"

const PHASE: PhaseUnit = { round: "R-01", id: "P01", type: "implement", entry: phaseType("implement")!, dir: "docs/R-01/P01-implement" }

const projects: string[] = []
afterEach(() => {
  for (const dir of projects.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function write(dir: string, path: string, text: string) {
  const file = join(dir, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

function git(dir: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", "-C", dir, ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  })
  if (result.exitCode) throw new Error(result.stderr.toString())
  return result.stdout.toString()
}

function commitFixture(dir: string, message = "Fixture") {
  git(dir, "add", ".")
  git(dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", message)
}

// A charter pack (the synthesis pipeline's own fixture shape): a pack whose
// `## guarantees` declares the pack-global verify-plan charter — the
// resolution the synthesize derivation keys on.
const CHARTER_PACK = [
  "# verify",
  "",
  "## acceptance",
  "",
  "### result-line",
  "",
  "Write it in every report: `Result: PASS` means every acceptance criterion was observed to pass.",
  "",
  "## guarantees",
  "",
  "### verify-plan",
  "",
  "The charter bar the plan must serve: every obligation the sources name becomes a planned task or an explicit deferral.",
  "",
].join("\n")

const PHASE_INDEX = "docs/R-01/P01-implement/tasks.md"
const PLAN_INPUT = "Reimplement the widget from the specification alone."
const WORKER = { token: "worker-1", channel: "solo" }

// The project the synthesize grant derives over: a committed round, the
// phase's standing formulation unit (constructed through the core's own
// construction path — the floor todo, driver-written), the plan input as
// the one evidential source, the charter pack active.
async function synthesisProject() {
  const dir = mkdtempSync(join(tmpdir(), "executor-synthesize-"))
  projects.push(dir)
  git(dir, "init")
  // The ignore set init writes (the driver workdir is never git dirt); the
  // construction's unified commit would otherwise track .auto/ wholesale.
  write(dir, ".gitignore", ".auto/\ntmp/\n")
  write(dir, CONFIG_FILE, JSON.stringify({ subtask: "off", intent: "verify" }))
  mkdirSync(join(dir, ".opencode", "auto", "intents"), { recursive: true })
  writeFileSync(join(dir, ".opencode", "auto", "intents", "verify.md"), CHARTER_PACK)
  write(dir, "docs/R-01/phases.md", "# Phases\n\n- [ ] P01 implement\n")
  write(dir, "docs/R-01/P01-implement/todo.md", "# Phase\n")
  write(dir, "docs/R-01/P01-implement/plan-input.md", `${PLAN_INPUT}\n`)
  commitFixture(dir, "round setup")
  const landed = await constructFormulation(dir, PHASE, {
    goal: "Formulate the complete task plan for the implementation phase from the named sources.",
    scope: "The planning input, the round brief and the prior phases' handovers.",
    acceptance: "Every obligation the Scope's inputs name is covered by a planned task.",
  })
  if (landed.type !== "constructed") throw new Error(JSON.stringify(landed))
  return { dir, unit: landed.id }
}

// The constructor's reply (the push fixture's own shape): the two blocks
// plus the closing Rationale line, the session's rows continuing the
// seeded sequence, the quote locating in the plan input verbatim.
function reply(quote = PLAN_INPUT, rows?: string[]) {
  const entry = phaseType("implement")!
  const nextO = seededLedgerRows(entry).filter((row) => row.kind === "O").length + 1
  return [
    "<<<SOURCES-BRIEF",
    `The input demands the widget's reimplementation: ${quote}`,
    "SOURCES-BRIEF>>>",
    "<<<LEDGER",
    ...(rows ?? [`- O-${String(nextO).padStart(2, "0")} | docs/R-01/P01-implement/plan-input.md | "${quote}" | a task that reimplements the widget from the specification alone`]),
    "LEDGER>>>",
    "Rationale: the sources demand a specification-only reimplementation",
    "",
  ].join("\n")
}

test("the standing floor todo under a resolved charter is claimable synthesize work addressed by its own unit id", async () => {
  const { dir, unit } = await synthesisProject()
  const preview = await readExecutorPreview(dir)
  expect(preview).toMatchObject({ kind: "synthesize", unit, phase: "R-01.P01", index: PHASE_INDEX })
  if (preview.kind !== "synthesize") throw new Error(JSON.stringify(preview))
  // The brief is the identical formulate-synthesize prompt: the template's
  // own voice over the charter and the sources — the same render the push
  // one-shot reads.
  expect(preview.prompt).toContain("You are the constructor session of a formulation step.")
  expect(preview.prompt).toContain("The charter bar the plan must serve")
  expect(preview.prompt).toContain(`### docs/R-01/P01-implement/plan-input.md`)
  expect(preview.prompt).toContain(PLAN_INPUT)

  const coordinator = await openExecutorCoordinator(dir)
  try {
    // The menu names the synthesize row; a targeted ask for another kind
    // waits naming the mismatch; the lease is serial on the main tree.
    expect(await coordinator.ready({ token: "reader", channel: "menu" })).toMatchObject({
      claimable: [{ unit, kinds: ["synthesize"] }],
    })
    expect(await coordinator.claim({ token: "reader", channel: "menu" }, unit, "formulate")).toMatchObject({
      kind: "wait", reason: "not-ready", detail: `${unit} has no formulate step to claim.`,
    })
    const grant = await coordinator.claim(WORKER, unit, "synthesize")
    if (grant.kind !== "synthesize") throw new Error(JSON.stringify(grant))
    expect(grant).toMatchObject({ kind: "synthesize", unit, attempt: 1, workspace: dir, phase: "R-01.P01", index: PHASE_INDEX })
    expect(grant.prompt).toContain("You are the constructor session of a formulation step.")
    expect(await coordinator.claim({ token: "other", channel: "other" })).toMatchObject({ kind: "wait", reason: "lease-held" })
    // The brief refresh replays the same grant.
    expect(await coordinator.brief(WORKER, unit, "synthesize")).toMatchObject({ kind: "synthesize", id: grant.id, lease: grant.lease })
  } finally {
    await coordinator.close()
  }
})

test("the floors: no charter, the switch off, or an already-synthesized todo derive the formulate step unchanged", async () => {
  // A pack without a verify-plan charter (the builtin faithful bundle
  // declares one, so the floor needs its own pack): the resolution the
  // synthesize derivation keys on is absent.
  const noCharter = await synthesisProject()
  write(noCharter.dir, ".opencode/auto/intents/verify.md", CHARTER_PACK.split("## guarantees")[0]!)
  commitFixture(noCharter.dir, "drop the charter")
  expect(await readExecutorPreview(noCharter.dir)).toMatchObject({ kind: "formulate", unit: noCharter.unit })

  // The switch (the push compose's own gate, clamped the fixture suite's
  // way — the parse is memoized per process): off forces the floor.
  const switchedOff = await synthesisProject()
  clampSwitches({ synthesis: false })
  try {
    expect(await readExecutorPreview(switchedOff.dir)).toMatchObject({ kind: "formulate", unit: switchedOff.unit })
  } finally {
    clampSwitches({ synthesis: true })
  }

  // A todo whose Scope already carries a ledger (a completed synthesis):
  // the formulate session continues over the synthesized todo.
  const synthesized = await synthesisProject()
  const todoPath = join(synthesized.dir, "docs", synthesized.unit, "todo.md")
  const floor = readFileSync(todoPath, "utf8")
  writeFileSync(todoPath, floor.replace("## Scope\n\n", "## Scope\n\n## Obligations ledger\n\n- O-01 | phase duties | \"Result: PASS\" | the verdict protocol row\n\n"))
  commitFixture(synthesized.dir, "synthesized todo")
  expect(await readExecutorPreview(synthesized.dir)).toMatchObject({ kind: "formulate", unit: synthesized.unit })
})

test("the synthesize lifecycle: the reply lands through the construction under the phase-synthesize stage, terminal, the formulate session following", async () => {
  const { dir, unit } = await synthesisProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(WORKER)
    if (grant.kind !== "synthesize") throw new Error(JSON.stringify(grant))
    // The session writes its reply at the unit's todo path — the one
    // admitted write surface, the reply channel.
    write(dir, `docs/${unit}/todo.md`, reply())
    const receipt = await coordinator.report(WORKER, grant.id, grant.lease, "ended")
    expect(receipt).toMatchObject({ kind: "landed" })
    if (receipt.kind !== "landed") throw new Error(JSON.stringify(receipt))
    // The landing is the construction commit: the push family's subject
    // under the synthesize stage word.
    expect(git(dir, "show", "-s", "--format=%B", receipt.commit)).toContain("Auto-Stage: phase-synthesize")
    expect(git(dir, "log", "--format=%s", "-1", receipt.commit)).toContain("PLAN formulate")
    // The landed todo carries the composed synthesis: the Sources brief and
    // the obligations ledger with the seeded rows at its head.
    const todo = readFileSync(join(dir, `docs/${unit}/todo.md`), "utf8")
    expect(todo).toContain("## Sources brief (constructor session, under the charter)")
    expect(todo).toContain("## Obligations ledger")
    for (const row of seededLedgerRows(phaseType("implement")!)) {
      expect(todo).toContain(row.quotes[0]!.slice(0, 40))
    }
    // Terminal: no verify share follows a synthesis — the next claim is the
    // formulate session over the synthesized todo, the same token admitted
    // (the construction's judgment is the settlement's alone).
    const next = await coordinator.claim(WORKER)
    expect(next).toMatchObject({ kind: "formulate", unit })
    if (next.kind !== "formulate") throw new Error(JSON.stringify(next))
    expect(next.prompt).toContain("## Sources brief (constructor session, under the charter)")
  } finally {
    await coordinator.close()
  }
})

test("the collect: an invalid reply blocks replayable with the push loop's own findings", async () => {
  const { dir, unit } = await synthesisProject()
  const base = git(dir, "rev-parse", "HEAD").trim()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(WORKER)
    if (grant.kind !== "synthesize") throw new Error(JSON.stringify(grant))
    // A reply without the prescribed delimiters.
    write(dir, `docs/${unit}/todo.md`, "Some prose without the protocol blocks.\n")
    const shape = await coordinator.report(WORKER, grant.id, grant.lease, "ended")
    expect(shape).toMatchObject({ kind: "blocked", reason: "commitFailed" })
    if (shape.kind !== "blocked") throw new Error(JSON.stringify(shape))
    expect(shape.detail).toContain("the synthesis reply is invalid")
    expect(shape.detail).toContain("SOURCES-BRIEF")
    // A quote that locates nowhere: the anchoring check's own voice.
    write(dir, `docs/${unit}/todo.md`, reply("A quote the input never carried."))
    const anchor = await coordinator.report(WORKER, grant.id, grant.lease, "ended")
    expect(anchor).toMatchObject({ kind: "blocked", reason: "commitFailed" })
    if (anchor.kind !== "blocked") throw new Error(JSON.stringify(anchor))
    expect(anchor.detail).toContain("does not locate in docs/R-01/P01-implement/plan-input.md")
    // Nothing landed: the construction never ran.
    expect(git(dir, "rev-parse", "HEAD").trim()).toBe(base)
    // The remedy holds: the rewritten reply lands.
    write(dir, `docs/${unit}/todo.md`, reply())
    expect(await coordinator.report(WORKER, grant.id, grant.lease, "ended")).toMatchObject({ kind: "landed" })
  } finally {
    await coordinator.close()
  }
})

test("a 111-row ledger missing its dashes names the first bad line and the consumed reply can be resubmitted", async () => {
  const { dir, unit } = await synthesisProject()
  const brief = "Keep the existing widget implementation."
  write(dir, BRIEF_FILE, brief)
  commitFixture(dir, "add the project brief")
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(WORKER)
    if (grant.kind !== "synthesize") throw new Error(JSON.stringify(grant))
    expect(grant.prompt).toContain("Start each row with a literal dash and space")
    const path = `docs/${unit}/todo.md`
    const floor = readFileSync(join(dir, path), "utf8")
    const base = git(dir, "rev-parse", "HEAD").trim()
    const seeded = seededLedgerRows(PHASE.entry)
    const input = `${PHASE.dir}/plan-input.md`
    const rows = [
      ...Array.from({ length: 108 }, (_, i) => `O-${String(seeded.length + i + 1).padStart(2, "0")} | ${input} | "${PLAN_INPUT}" | plan widget part ${i + 1}`),
      ...Array.from({ length: 3 }, (_, i) => `C-0${i + 1} | ${input} vs ${BRIEF_FILE} | "${PLAN_INPUT}" / "${brief}" | record the deviation for widget part ${i + 1}`),
    ]
    const ledgerReply = (lines: string[]) => reply(PLAN_INPUT, ["# Widget obligations", "", ...lines])
    write(dir, path, ledgerReply(rows))
    const report = () => coordinator.report(WORKER, grant.id, grant.lease, "ended")
    const refused = await report()
    if (refused.kind !== "blocked") throw new Error(JSON.stringify(refused))
    expect(refused.reason).toBe("commitFailed")
    expect(refused.detail).toContain("ledger line 3 is missing the literal `- ` prefix")
    expect(refused.detail).toContain(rows[0]!.slice(0, 50))
    expect(refused.detail).not.toContain("ledger line 4")
    expect(refused.detail).toContain(`The submitted reply was consumed and ${path} was restored`)
    expect(readFileSync(join(dir, path), "utf8")).toBe(floor)
    expect(git(dir, "rev-parse", "HEAD").trim()).toBe(base)

    write(dir, path, ledgerReply(rows.map(row => `- ${row}`)))
    const landed = await report()
    expect(landed).toMatchObject({ kind: "landed" })
    expect(await report()).toEqual(landed)
    const ledger = ledgerOf(readFileSync(join(dir, path), "utf8"))
    expect(ledger?.problems).toEqual([])
    expect(ledger?.rows).toHaveLength(seeded.length + 111)
    expect(git(dir, "rev-list", "--count", `${base}..HEAD`).trim()).toBe("1")
  } finally {
    await coordinator.close()
  }
})

test("the fence: an edit beside the reply channel is refused, the never-set cause escalating to the person", async () => {
  const { dir, unit } = await synthesisProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(WORKER)
    if (grant.kind !== "synthesize") throw new Error(JSON.stringify(grant))
    // The session edited the phase index — a never-set path for every grant
    // kind, outside the one admitted channel.
    write(dir, PHASE_INDEX, renderTaskIndex("R-01.P01", [{ id: unit, title: "Formulate the implement tasks" }]).replace("- [ ]", "- [x] "))
    write(dir, `docs/${unit}/todo.md`, reply())
    const blocked = await coordinator.report(WORKER, grant.id, grant.lease, "ended")
    expect(blocked).toMatchObject({ kind: "blocked", reason: "isolation" })
    if (blocked.kind !== "blocked") throw new Error(JSON.stringify(blocked))
    expect(blocked.detail).toContain("Resolve out-of-scope edits before replaying")
    expect(blocked.detail).toContain("The cause is outside this lease's permitted writes — a person must inspect the state")
    // No question item is raised (plans/0282): the plain blocked answer is
    // the whole surface; 0287's held row names the booked settlement the
    // lane waits on.
    expect((await coordinator.ready(WORKER)).pending).toEqual([
      { kind: "wait", reason: "in-flight", actor: "workflow", detail: "A previous share requires settlement." },
    ])
  } finally {
    await coordinator.close()
  }
})

test("a zero-write synthesize share reports without landing and the next attempt re-claims", async () => {
  const { dir, unit } = await synthesisProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(WORKER)
    if (grant.kind !== "synthesize") throw new Error(JSON.stringify(grant))
    expect(await coordinator.report(WORKER, grant.id, grant.lease, "ended")).toEqual({ kind: "without-landing", reason: "zero-write" })
    expect(await coordinator.claim(WORKER)).toMatchObject({ kind: "synthesize", unit, attempt: 2 })
  } finally {
    await coordinator.close()
  }
})

test("the crash-window replay: an entry booked without its receipt settles through the construction witness", async () => {
  const { dir, unit } = await synthesisProject()
  const coordinator = await openExecutorCoordinator(dir)
  let commit = ""
  try {
    const grant = await coordinator.claim(WORKER)
    if (grant.kind !== "synthesize") throw new Error(JSON.stringify(grant))
    write(dir, `docs/${unit}/todo.md`, reply())
    const receipt = await coordinator.report(WORKER, grant.id, grant.lease, "ended")
    if (receipt.kind !== "landed") throw new Error(JSON.stringify(receipt))
    commit = receipt.commit
  } finally {
    await coordinator.close()
  }
  // Simulate the crash between the construction's commit and the receipt
  // booking: the progress entry left booked-ended with no receipt — the
  // successor's claim finishes the settlement through the witness and the
  // same commit is booked (0273's replacement-settlement path).
  const file = join(dir, ".auto", "executor-progress.json")
  const entries = JSON.parse(readFileSync(file, "utf8")) as { grant: { id: string }; booking?: { outcome?: string; receipt?: unknown } }[]
  const entry = entries.find(({ grant }) => grant.id.startsWith(`${unit} synthesize`))
  if (entry === undefined) throw new Error("no synthesize entry")
  entry.booking = { outcome: "ended" }
  writeFileSync(file, JSON.stringify(entries))
  const reopened = await openExecutorCoordinator(dir)
  try {
    // The claim answers the formulate step (the settlement completed inside
    // it — never a block), and the receipt is booked with the witness commit.
    expect(await reopened.claim(WORKER)).toMatchObject({ kind: "formulate", unit })
    const settled = JSON.parse(readFileSync(file, "utf8")) as typeof entries
    const booked = settled.find(({ grant }) => grant.id.startsWith(`${unit} synthesize`))!.booking
    expect(booked?.receipt).toMatchObject({ kind: "landed", commit })
  } finally {
    await reopened.close()
  }
})

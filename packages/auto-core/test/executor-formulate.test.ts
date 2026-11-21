// The formulate grant kind's lifecycle proof (plans/0276, 0256 stage 2's
// first convergence kind): the phase's planning session — the one that
// writes every task document — rides the executor protocol beside its push
// twin. The claimable derivation (the same predicate the push dispatch
// keys on), the claim address (the formulation unit's own task id, the
// phase identity riding the grant), the fence's formulation family (the
// write surface admitted, the grammar judged at settlement), the
// settlement's mechanical collect (the push collect's own checks), and the
// follow-up chain — the standing verify kind's independent judgment, the
// fix round carrying the formulation context, the close-out's tick and
// rename — all composed with the standing machinery: 0272's escalation
// over the never-set cause, 0273's settled terminal, the byte-identical
// floors for a phase with no formulation need (P10).
import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { CONFIG_FILE } from "../src/config"
import { readExecutorPreview } from "../src/executor-steps"
import { executorTypeCatalog, openExecutorCoordinator } from "../src/executor-coordinator"
import { renderTaskIndex, renderTaskTodo } from "../src/tasks"

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

function commitFixture(dir: string) {
  git(dir, "add", ".")
  git(dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "Fixture")
}

function project() {
  const dir = mkdtempSync(join(tmpdir(), "executor-formulate-"))
  projects.push(dir)
  git(dir, "init")
  write(dir, CONFIG_FILE, JSON.stringify({ subtask: "off" }))
  return dir
}

// The phase's standing formulation unit (0095 D1's shape): the index's
// first row and its todo, the driver-written `Formulate:` field carrying
// the owning phase's qualified id — exactly the durable record the push
// dispatch keys on.
const PHASE_INDEX = "docs/R-01/P01-implement/tasks.md"
const GOAL = "Formulate the complete task plan for the implementation phase from the named sources."

function formulationProject(rows: string[] = ["T-004"], todos: Record<string, string> = { "T-004": formulationTodo() }) {
  const dir = project()
  write(dir, "docs/R-01/phases.md", "# Phases\n\n- [ ] P01 implement\n")
  write(dir, "docs/R-01/P01-implement/todo.md", "# Phase\n")
  write(dir, PHASE_INDEX, renderTaskIndex("R-01.P01", rows.map((id) => ({ id, title: taskTitle(id) }))))
  for (const [id, todo] of Object.entries(todos)) write(dir, `docs/${id}/todo.md`, todo)
  commitFixture(dir)
  return dir
}

function taskTitle(id: string) {
  return id === "T-004" ? "Formulate the Implement tasks" : `The ${id} deliverable`
}

function formulationTodo(extra = "") {
  return [
    `# T-004: ${taskTitle("T-004")}`,
    "Phase: R-01.P01",
    "Formulate: R-01.P01",
    "Decompose: whole",
    "Depends: none",
    "",
    "## Goal",
    "",
    GOAL,
    "",
    "## Scope",
    "",
    "The planning input, the round brief and the prior phases' handovers.",
    "",
    "## Acceptance",
    "",
    "Every obligation the Scope's inputs name is covered by a planned task.",
    "",
    "<!-- auto: eof -->",
    "",
    ...extra ? [extra] : [],
  ].join("\n")
}

// A planned task's valid document (the collect's mandatory spec passes).
function plannedTodo(id: string) {
  return renderTaskTodo({
    id,
    title: taskTitle(id),
    phase: "R-01.P01",
    goal: `Deliver the ${id} work the plan names, complete and committed.`,
    scope: "src/ only, the named modules.",
    acceptance: "The modules read back with the declared behavior.",
  })
}

const worker = { token: "worker-1", channel: "solo" }
const verifier = { token: "verifier-1", channel: "verify" }
const PASS_REPORT = "# Verification\n\nThe plan's tasks carry the charter's obligations and each acceptance names evidence a later session can check.\n\nResult: PASS\n\n<!-- auto: eof -->\n"
const FAIL_GAPS = "# Verification\n\n## Gaps\n\n### Gap 1 — Cover the second module\n\nThe plan's second task does not name its acceptance evidence.\n\nResult: FAIL acceptance is bare\n"

test("the standing formulation unit is claimable formulate work addressed by its own unit id", async () => {
  const dir = formulationProject()
  expect(await readExecutorPreview(dir)).toMatchObject({
    kind: "formulate",
    unit: "T-004",
    title: "Formulate the Implement tasks",
    phase: "R-01.P01",
    index: PHASE_INDEX,
  })
  const preview = await readExecutorPreview(dir)
  if (preview.kind !== "formulate") throw new Error(JSON.stringify(preview))
  // The brief is the same derivation the push-side planning session reads:
  // renderWhole over the formulation task, its todo the single input.
  expect(preview.prompt).toContain(GOAL)

  const coordinator = await openExecutorCoordinator(dir)
  try {
    // The menu names the formulate row (kinds exactly the new id); a
    // targeted kind ask for another kind waits naming the mismatch; the
    // untargeted claim takes the phase's next step whatever its kind.
    expect(await coordinator.ready({ token: "reader", channel: "menu" })).toMatchObject({
      claimable: [{ unit: "T-004", title: "Formulate the Implement tasks", kinds: ["formulate"] }],
    })
    expect(await coordinator.claim({ token: "reader", channel: "menu" }, "T-004", "execute")).toMatchObject({
      kind: "wait", reason: "not-ready", detail: "T-004 has no execute step to claim.",
    })
    const grant = await coordinator.claim(worker, "T-004", "formulate")
    if (grant.kind !== "formulate") throw new Error(JSON.stringify(grant))
    expect(grant).toMatchObject({
      kind: "formulate", unit: "T-004", attempt: 1, workspace: dir,
      phase: "R-01.P01", index: PHASE_INDEX,
    })
    expect(grant.prompt).toContain(GOAL)
    // The lease is serial on the main tree: another channel waits on it.
    expect(await coordinator.claim(verifier)).toMatchObject({ kind: "wait", reason: "lease-held" })
    // The brief refresh replays the same grant.
    expect(await coordinator.brief(worker, "T-004", "formulate")).toMatchObject({ kind: "formulate", id: grant.id, lease: grant.lease })
  } finally {
    await coordinator.close()
  }
})

test("the floor: a phase with no standing formulation is byte-identical (no formulate row, the standing waits)", async () => {
  const dir = project()
  write(dir, "docs/R-01/phases.md", "# Phases\n\n- [ ] P01 implement\n")
  write(dir, "docs/R-01/P01-implement/todo.md", "# Phase\n")
  commitFixture(dir)
  // The index absent: the pre-change wait, byte-identical — the
  // construction stays the person's transfer/plan act (P2/P6).
  expect(await readExecutorPreview(dir)).toEqual({
    kind: "wait", reason: "not-ready", detail: "The phase needs a task plan or formulation dispatch.",
  })
  // The formulation done: the planned batch's ordinary execute rows.
  write(dir, PHASE_INDEX, renderTaskIndex("R-01.P01", [
    { id: "T-004", title: taskTitle("T-004"), done: true },
    { id: "T-005", title: taskTitle("T-005") },
  ]))
  write(dir, "docs/T-004/done.md", formulationTodo())
  write(dir, "docs/T-005/todo.md", plannedTodo("T-005"))
  commitFixture(dir)
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const menu = await coordinator.ready({ token: "reader", channel: "menu" })
    expect(menu.claimable).toMatchObject([{ unit: "T-005", title: taskTitle("T-005"), kinds: ["execute"] }])
    for (const row of menu.claimable) expect(row.kinds).not.toContain("formulate")
    // The types block carries the formulate entry beside the standing five
    // — the additive growth, one rendering.
    expect(menu.types).toEqual(executorTypeCatalog())
    expect(Object.keys(menu.types)).toContain("formulate")
  } finally {
    await coordinator.close()
  }
})

test("the formulate lifecycle: the session writes the plan, the settlement lands it, verification closes it, the planned task follows", async () => {
  const dir = formulationProject()
  const base = git(dir, "rev-parse", "HEAD").trim()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(worker)
    if (grant.kind !== "formulate") throw new Error(JSON.stringify(grant))
    // The session writes the phase's plan: the index row and the planned
    // task's document — the formulation family, nothing else.
    write(dir, PHASE_INDEX, renderTaskIndex("R-01.P01", [
      { id: "T-004", title: taskTitle("T-004") },
      { id: "T-005", title: taskTitle("T-005") },
    ]))
    write(dir, "docs/T-005/todo.md", plannedTodo("T-005"))
    const receipt = await coordinator.report(worker, grant.id, grant.lease, "ended")
    expect(receipt).toMatchObject({ kind: "landed" })
    if (receipt.kind !== "landed") throw new Error(JSON.stringify(receipt))
    // The share commit carries the phase-formulate stage word (the push
    // construction's own — no new stage vocabulary).
    expect(git(dir, "show", "-s", "--format=%B", receipt.commit)).toContain("Auto-Stage: phase-formulate")
    expect(git(dir, "log", "--format=%s", "-1", receipt.commit)).toContain("T-004 formulate 1")

    // The producer token's further claims read the settled terminal (0273
    // composed): its work on the unit has ended, a different token
    // performs the verification.
    expect(await coordinator.claim(worker)).toMatchObject({
      kind: "settled", unit: "T-004", commit: receipt.commit,
    })
    // A fresh reader's menu names the verify row over the same unit — the
    // standing verify kind, the independent fresh-session judgment (P3),
    // the wrap-up brief the push path's wrap-up session reads.
    expect(await coordinator.ready({ token: "reader", channel: "menu" })).toMatchObject({
      claimable: [{ unit: "T-004", kinds: ["verify"] }],
    })
    const verify = await coordinator.claim(verifier)
    if (verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    expect(verify).toMatchObject({ kind: "verify", unit: "T-004", baseline: base, head: receipt.commit })
    write(dir, "docs/T-004/report.md", PASS_REPORT)
    const closed = await coordinator.report(verifier, verify.id, verify.lease, "ended")
    expect(closed).toMatchObject({ kind: "landed", verdict: "pass", closeCommit: git(dir, "rev-parse", "HEAD").trim() })
    // The close-out ticked the formulation row and renamed its todo — the
    // driver-exclusive shapes, the coordinator's alone, the content carried
    // unchanged.
    expect(readFileSync(join(dir, "docs/T-004/done.md"), "utf8")).toBe(formulationTodo())
    expect(readFileSync(join(dir, PHASE_INDEX), "utf8")).toContain("- [x] T-004")

    // The planned batch follows: the next claim is the planned task's
    // ordinary execute share.
    const next = await coordinator.claim({ token: "worker-2", channel: "next" })
    expect(next).toMatchObject({ kind: "execute", unit: "T-005" })
  } finally {
    await coordinator.close()
  }
})

test("the fence: the unit's own input todo and every never-set path are refused, the edit escalating to the person (0272 composed)", async () => {
  const dir = formulationProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(worker)
    if (grant.kind !== "formulate") throw new Error(JSON.stringify(grant))
    // The session edited its own single input — a never-set path for every
    // grant kind, outside the family by the fence's own exclusion.
    write(dir, "docs/T-004/todo.md", formulationTodo().replace(GOAL, "An edited goal."))
    const blocked = await coordinator.report(worker, grant.id, grant.lease, "ended")
    expect(blocked).toMatchObject({ kind: "blocked", reason: "isolation" })
    if (blocked.kind !== "blocked") throw new Error(JSON.stringify(blocked))
    // The out-of-scope detail escalates (0272 composed): the never-set
    // cause raises the question, the ladder named in the detail.
    expect(blocked.detail).toContain("Resolve out-of-scope edits before replaying: docs/T-004/todo.md.")
    expect(blocked.detail).toContain("The cause is outside this lease's permitted writes — a person must inspect the state")
    expect(blocked.detail).toContain("retrying cannot fix it")
    // The ask channel is gone (0282): no question item is raised — the
    // plain blocked answer is the whole surface (the gates are
    // document-derived and none awaits here); 0287's held row names the
    // booked settlement the lane waits on.
    expect((await coordinator.ready({ token: "reader", channel: "menu" })).pending).toEqual([
      { kind: "wait", reason: "in-flight", detail: "A previous share requires settlement." },
    ])
  } finally {
    await coordinator.close()
  }
})

test("the collect: an invalid planned document blocks replayable; a removed pre-existing row names the prefix discipline", async () => {
  const dir = formulationProject(["T-004", "T-001"], {
    "T-004": formulationTodo(),
    "T-001": plannedTodo("T-001"),
  })
  const base = git(dir, "rev-parse", "HEAD").trim()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(worker)
    if (grant.kind !== "formulate") throw new Error(JSON.stringify(grant))
    // A planned task whose document carries another phase's field — the
    // collect's own voice (the push collect's messages), the holder's
    // remedy, replayable.
    write(dir, PHASE_INDEX, renderTaskIndex("R-01.P01", [
      { id: "T-004", title: taskTitle("T-004") },
      { id: "T-005", title: taskTitle("T-005") },
    ]))
    write(dir, "docs/T-005/todo.md", renderTaskTodo({
      id: "T-005", title: taskTitle("T-005"), phase: "R-99.P01",
      goal: "A goal long enough to pass the shape threshold of the collect.",
      scope: "src/.", acceptance: "It reads back.",
    }))
    const invalid = await coordinator.report(worker, grant.id, grant.lease, "ended")
    expect(invalid).toMatchObject({ kind: "blocked", reason: "commitFailed" })
    if (invalid.kind !== "blocked") throw new Error(JSON.stringify(invalid))
    expect(invalid.detail).toContain("the formulation output is invalid")
    expect(invalid.detail).toContain("Phase: R-01.P01")
    // Nothing landed: the coordinator wrote nothing.
    expect(git(dir, "rev-parse", "HEAD").trim()).toBe(base)

    // The pre-existing row dropped (the person's --new-task row): the
    // fixed-prefix discipline, replayable, its own remedy teaching.
    rmSync(join(dir, "docs/T-005"), { recursive: true, force: true })
    write(dir, PHASE_INDEX, renderTaskIndex("R-01.P01", [{ id: "T-004", title: taskTitle("T-004") }]))
    const prefix = await coordinator.report(worker, grant.id, grant.lease, "ended")
    expect(prefix).toMatchObject({ kind: "blocked", reason: "commitFailed" })
    if (prefix.kind !== "blocked") throw new Error(JSON.stringify(prefix))
    expect(prefix.detail).toContain("lists 1 task(s) but held 2 before the session")
    expect(prefix.detail).toContain("the pre-existing lines are fixed")
    // The dropped own row: the unit's row must stay (the driver ticks and
    // closes through it) — the holder's remedy, restoring its own row.
    write(dir, PHASE_INDEX, renderTaskIndex("R-01.P01", [
      { id: "T-001", title: taskTitle("T-001") },
      { id: "T-006", title: taskTitle("T-006") },
    ]))
    write(dir, "docs/T-006/todo.md", plannedTodo("T-006"))
    const dropped = await coordinator.report(worker, grant.id, grant.lease, "ended")
    expect(dropped).toMatchObject({ kind: "blocked", reason: "commitFailed" })
    if (dropped.kind !== "blocked") throw new Error(JSON.stringify(dropped))
    expect(dropped.detail).toContain("no longer lists the formulation task T-004")
  } finally {
    await coordinator.close()
  }
})

test("a zero-write formulate share reports without landing and the next attempt re-claims", async () => {
  const dir = formulationProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(worker)
    if (grant.kind !== "formulate") throw new Error(JSON.stringify(grant))
    expect(await coordinator.report(worker, grant.id, grant.lease, "ended")).toEqual({
      kind: "without-landing", reason: "zero-write",
    })
    const retry = await coordinator.claim(worker)
    expect(retry).toMatchObject({ kind: "formulate", unit: "T-004", attempt: 2 })
  } finally {
    await coordinator.close()
  }
})

test("a formulate share hands over and resumes as the next attempt on the same unit", async () => {
  const dir = formulationProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(worker)
    if (grant.kind !== "formulate") throw new Error(JSON.stringify(grant))
    // A partial plan beside a `Status: continue` handoff: the share lands
    // as a continuation, and the next claim resumes the unit — the execute
    // continuation machinery joined, not a verification wait.
    write(dir, PHASE_INDEX, renderTaskIndex("R-01.P01", [
      { id: "T-004", title: taskTitle("T-004") },
      { id: "T-005", title: taskTitle("T-005") },
    ]))
    write(dir, "docs/T-005/todo.md", plannedTodo("T-005"))
    write(dir, "docs/T-004/handoff.md", "# Handoff\n\nThe second module's plan remains.\n\nStatus: continue\n\n<!-- auto: eof -->\n")
    expect(await coordinator.report(worker, grant.id, grant.lease, "ended")).toMatchObject({
      kind: "landed", continuation: true,
    })
    const resume = await coordinator.claim(worker)
    if (resume.kind !== "formulate") throw new Error(JSON.stringify(resume))
    // The continuation opens a new step id (the landed formulate shares
    // counted, the fix rounds' own numbering shape), its attempt fresh.
    expect(resume).toMatchObject({ kind: "formulate", unit: "T-004", id: "T-004 formulate 2" })
    // The resumed brief carries the continuation teaching — the handoff the
    // successor reads first, the whole template's own letter.
    expect(resume.prompt).toContain("The previous session ended with a context-budget handover")
    expect(resume.prompt).toContain("docs/T-004/handoff.md")
  } finally {
    await coordinator.close()
  }
})

test("the verify FAIL opens a fix round carrying the formulation context; the repaired plan re-verifies and closes", async () => {
  const dir = formulationProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(worker)
    if (grant.kind !== "formulate") throw new Error(JSON.stringify(grant))
    write(dir, PHASE_INDEX, renderTaskIndex("R-01.P01", [
      { id: "T-004", title: taskTitle("T-004") },
      { id: "T-005", title: taskTitle("T-005") },
    ]))
    write(dir, "docs/T-005/todo.md", plannedTodo("T-005"))
    await coordinator.report(worker, grant.id, grant.lease, "ended")
    const verify = await coordinator.claim(verifier)
    if (verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    write(dir, "docs/T-004/gaps.md", FAIL_GAPS)
    expect(await coordinator.report(verifier, verify.id, verify.lease, "ended")).toMatchObject({
      kind: "landed", verdict: "fail", gapCount: 1,
    })
    // The fix round over the formulation unit carries the formulation
    // context — the phase identity on the grant, the family arm admitting
    // the plan's surfaces for the repair.
    const fix = await coordinator.claim({ token: "fixer", channel: "fix" })
    if (fix.kind !== "fix") throw new Error(JSON.stringify(fix))
    expect(fix).toMatchObject({ kind: "fix", unit: "T-004", round: 1, phase: "R-01.P01", index: PHASE_INDEX })
    write(dir, "docs/T-005/todo.md", renderTaskTodo({
      id: "T-005", title: taskTitle("T-005"), phase: "R-01.P01",
      goal: "Deliver the T-005 work the plan names, complete and committed.",
      scope: "src/ only, the named modules.",
      acceptance: "The modules read back with the declared behavior and the receipt names the run.",
    }))
    expect(await coordinator.report({ token: "fixer", channel: "fix" }, fix.id, fix.lease, "ended")).toMatchObject({ kind: "landed" })
    // The gap list retired with the fix (the standing retireGaps shape);
    // the re-verification passes and the close-out completes.
    const reverify = await coordinator.claim({ token: "verifier-2", channel: "verify" })
    if (reverify.kind !== "verify") throw new Error(JSON.stringify(reverify))
    expect(reverify).toMatchObject({ kind: "verify", unit: "T-004" })
    write(dir, "docs/T-004/report.md", PASS_REPORT)
    expect(await coordinator.report({ token: "verifier-2", channel: "verify" }, reverify.id, reverify.lease, "ended")).toMatchObject({
      kind: "landed", verdict: "pass",
    })
    expect(readFileSync(join(dir, PHASE_INDEX), "utf8")).toContain("- [x] T-004")
  } finally {
    await coordinator.close()
  }
})
